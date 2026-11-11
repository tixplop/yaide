//! Serveurs MCP des agents (REQ-095) : `.yaide/mcp.json`, serveurs lancés en stdio dans le dossier du
//! projet, outils vus du modèle sous `mcp__<serveur>__<outil>` (DEC-063, DEC-064).

use super::outils::{Limites, Resultat};
use super::provider::DefOutil;
use rmcp::model::CallToolRequestParams;
use rmcp::service::{RoleClient, RunningService};
use rmcp::{ServiceError, ServiceExt};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as MutexStd};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::{watch, Mutex};

use crate::shells::{descendants, signaler_pid, vivant};

const STDERR_MAX: usize = 64 * 1024;
const STDERR_LIGNES: usize = 20;
const REPONSE_MAX: usize = 50_000;
const NOM_MAX: usize = 64;

/// Un problème à montrer à l'utilisateur au début d'un tour (AC-095-15).
#[derive(Clone, Debug, PartialEq)]
pub struct Probleme {
    pub message: String,
    pub detail: Option<String>,
}

struct Outil {
    modele: String,
    original: String,
    def: DefOutil,
}

struct Actif {
    nom: String,
    service: RunningService<RoleClient, ()>,
    enfant: Child,
    pgid: i32,
    outils: Vec<Outil>,
}

#[allow(clippy::large_enum_variant)]
enum Entree {
    Actif(Actif),
    Echec(Probleme),
}

#[derive(Default)]
struct Etat {
    /// Contenu du fichier au dernier tour (`None` : absent).
    fichier: Option<String>,
    entrees: Vec<Entree>,
}

/// Les serveurs MCP de l'instance, partagés par toutes les conversations.
pub struct Mcp {
    projet: PathBuf,
    etat: Mutex<Etat>,
    /// Posé dès le début de l'arrêt de Yaide : plus aucun lancement.
    arret: AtomicBool,
    /// Prévient les lancements en cours de l'arrêt de Yaide.
    arret_tx: watch::Sender<bool>,
}

/// Les entrées de `mcpServers`, dans l'ordre du fichier.
struct Ordonnes(Vec<(String, Value)>);

impl<'de> Deserialize<'de> for Ordonnes {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Ordonnes;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("un objet")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Ordonnes, A::Error> {
                let mut v = Vec::new();
                while let Some(paire) = m.next_entry::<String, Value>()? {
                    v.push(paire);
                }
                Ok(Ordonnes(v))
            }
        }
        d.deserialize_map(V)
    }
}

#[derive(Deserialize)]
struct Fichier {
    #[serde(rename = "mcpServers", default)]
    serveurs: Option<Ordonnes>,
}

fn lire(contenu: &str) -> Result<Vec<(String, Value)>, Probleme> {
    serde_json::from_str::<Fichier>(contenu)
        .map(|f| f.serveurs.map_or_else(Vec::new, |o| o.0))
        .map_err(|e| Probleme {
            message: ".yaide/mcp.json est illisible. Corrigez-le pour utiliser ses serveurs."
                .into(),
            detail: Some(e.to_string()),
        })
}

fn assainir(texte: &str) -> String {
    texte
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Nom vu par le modèle : `mcp__<serveur>__<outil>`, coupé à 64 caractères.
fn nom_modele(serveur: &str, outil: &str) -> String {
    let mut n = format!("mcp__{}__{}", assainir(serveur), assainir(outil));
    n.truncate(NOM_MAX);
    n
}

fn echec_demarrage(nom: &str, cause: impl AsRef<str>, detail: Option<String>) -> Entree {
    Entree::Echec(Probleme {
        message: format!("Le serveur MCP {nom} n'a pas démarré : {}", cause.as_ref()),
        detail,
    })
}

fn signaler(pgid: i32, signal: i32) {
    // SAFETY : kill n'a pas d'effet mémoire ; pgid est le groupe d'un processus lancé par nous.
    unsafe { libc::kill(-pgid, signal) };
}

fn groupe_vivant(pgid: i32) -> bool {
    // SAFETY : le signal 0 ne fait que tester l'existence du groupe.
    unsafe { libc::kill(-pgid, 0) == 0 }
}

fn vingt_dernieres_lignes(tampon: &MutexStd<Vec<u8>>) -> Option<String> {
    let t = tampon.lock().unwrap();
    let texte = String::from_utf8_lossy(&t);
    let lignes: Vec<&str> = texte.lines().collect();
    let debut = lignes.len().saturating_sub(STDERR_LIGNES);
    let r = lignes[debut..].join("\n");
    (!r.trim().is_empty()).then_some(r)
}

/// Lance le serveur `nom` et fait l'échange `initialize` et `tools/list`.
async fn demarrer(
    projet: PathBuf,
    nom: String,
    valeur: Value,
    init: Duration,
    mut arret: watch::Receiver<bool>,
) -> Entree {
    let obj = valeur.as_object();
    let champ = |k: &str| obj.and_then(|o| o.get(k));
    let Some(commande) = champ("command").and_then(Value::as_str) else {
        return match champ("url").and_then(Value::as_str) {
            Some(url) => echec_demarrage(
                &nom,
                format!("url n'est pas pris en charge. Utilisez npx mcp-remote {url}."),
                None,
            ),
            None => echec_demarrage(&nom, "il n'a pas de command.", None),
        };
    };
    let mut args = Vec::new();
    match champ("args") {
        None => {}
        Some(Value::Array(a)) if a.iter().all(Value::is_string) => {
            args.extend(a.iter().filter_map(Value::as_str));
        }
        Some(_) => return echec_demarrage(&nom, "args doit être une liste de textes.", None),
    }
    let mut env = Vec::new();
    match champ("env") {
        None => {}
        Some(Value::Object(e)) if e.values().all(Value::is_string) => {
            env.extend(e.iter().filter_map(|(k, v)| Some((k, v.as_str()?))));
        }
        Some(_) => return echec_demarrage(&nom, "env doit associer des noms à des textes.", None),
    }
    let mut enfant = match Command::new(commande)
        .args(args)
        .envs(env)
        .current_dir(&projet)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
    {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return echec_demarrage(
                &nom,
                format!("la commande {commande} est introuvable."),
                None,
            )
        }
        Err(e) => {
            return echec_demarrage(
                &nom,
                format!("la commande {commande} n'a pas pu être lancée ({e})."),
                None,
            )
        }
    };
    let pgid = enfant.id().map_or(0, |p| p as i32);
    // Les dernières lignes de la sortie d'erreur donnent la cause d'un arrêt ; la lecture continue
    // ensuite pour que le tube ne se remplisse pas.
    let tampon = Arc::new(MutexStd::new(Vec::new()));
    let lecture = enfant.stderr.take().map(|mut e| {
        let t = tampon.clone();
        tokio::spawn(async move {
            let mut bloc = [0u8; 4096];
            while let Ok(n) = e.read(&mut bloc).await {
                if n == 0 {
                    break;
                }
                let mut t = t.lock().unwrap();
                t.extend_from_slice(&bloc[..n]);
                if t.len() > STDERR_MAX {
                    let trop = t.len() - STDERR_MAX;
                    t.drain(..trop);
                }
            }
        })
    });
    let (Some(sortie), Some(entree)) = (enfant.stdout.take(), enfant.stdin.take()) else {
        signaler(pgid, libc::SIGKILL);
        return echec_demarrage(&nom, "ses entrées et sorties sont inaccessibles.", None);
    };
    let debut = async {
        let service = ().serve((sortie, entree)).await.map_err(|e| e.to_string())?;
        let outils = service
            .peer()
            .list_all_tools()
            .await
            .map_err(|e| e.to_string())?;
        Ok::<_, String>((service, outils))
    };
    // L'arrêt de Yaide interrompt l'attente : il ne doit pas attendre `init`.
    let issue = tokio::select! {
        r = tokio::time::timeout(init, debut) => Some(r),
        _ = arret.wait_for(|a| *a) => None,
    };
    let (cause, avec_sortie) = match issue {
        None => ("Yaide s'arrête.".to_string(), false),
        Some(Ok(Ok((service, tools)))) => {
            let outils = tools
                .iter()
                .filter_map(|t| serde_json::to_value(t).ok())
                .filter_map(|t| {
                    let original = t["name"].as_str()?.to_string();
                    Some(Outil {
                        modele: nom_modele(&nom, &original),
                        def: DefOutil {
                            nom: nom_modele(&nom, &original),
                            description: t["description"].as_str().unwrap_or("").to_string(),
                            schema: t
                                .get("inputSchema")
                                .cloned()
                                .unwrap_or_else(|| json!({"type": "object"})),
                        },
                        original,
                    })
                })
                .collect();
            return Entree::Actif(Actif {
                nom,
                service,
                enfant,
                pgid,
                outils,
            });
        }
        Some(Ok(Err(_))) => {
            // Le serveur s'est arrêté, ou a répondu autre chose qu'un serveur MCP.
            match tokio::time::timeout(Duration::from_secs(2), enfant.wait()).await {
                Ok(Ok(statut)) => (
                    match statut.code() {
                        Some(c) => format!("il s'est arrêté (code {c})."),
                        None => "il s'est arrêté.".to_string(),
                    },
                    true,
                ),
                _ => ("il n'a pas répondu comme un serveur MCP.".to_string(), true),
            }
        }
        Some(Err(_)) => (format!("pas de réponse après {} s.", init.as_secs()), false),
    };
    signaler(pgid, libc::SIGKILL);
    let _ = enfant.wait().await;
    if let Some(l) = lecture {
        let _ = tokio::time::timeout(Duration::from_secs(1), l).await;
    }
    let detail = if avec_sortie {
        vingt_dernieres_lignes(&tampon)
    } else {
        None
    };
    echec_demarrage(&nom, cause, detail)
}

/// Arrête ces serveurs : SIGTERM à leur groupe et à leurs descendants (même dans une autre session
/// Unix), SIGKILL à ce qui reste après 3 s, même si le chef du groupe a déjà quitté.
async fn tuer(entrees: Vec<Entree>) {
    let mut actifs: Vec<Actif> = entrees
        .into_iter()
        .filter_map(|e| match e {
            Entree::Actif(a) => Some(a),
            Entree::Echec(_) => None,
        })
        .collect();
    if actifs.is_empty() {
        return;
    }
    let suivis: Vec<i32> = actifs.iter().flat_map(|a| descendants(a.pgid)).collect();
    for a in &actifs {
        signaler(a.pgid, libc::SIGTERM);
    }
    for &p in &suivis {
        signaler_pid(p, libc::SIGTERM);
    }
    let debut = Instant::now();
    while debut.elapsed() < Duration::from_secs(3) {
        let chefs_finis = actifs
            .iter_mut()
            .all(|a| matches!(a.enfant.try_wait(), Ok(Some(_))));
        if chefs_finis
            && !suivis.iter().any(|&p| vivant(p))
            && !actifs.iter().any(|a| groupe_vivant(a.pgid))
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    for a in &actifs {
        signaler(a.pgid, libc::SIGKILL);
    }
    for &p in &suivis {
        signaler_pid(p, libc::SIGKILL);
    }
    for a in &mut actifs {
        let _ = a.enfant.wait().await;
    }
}

fn milliers(n: usize) -> String {
    let c = n.to_string();
    let mut r = String::new();
    for (i, ch) in c.chars().enumerate() {
        if i > 0 && (c.len() - i).is_multiple_of(3) {
            r.push(' ');
        }
        r.push(ch);
    }
    r
}

/// Le texte du résultat tel que le modèle le reçoit (AC-095-8, AC-095-16).
fn texte_du_resultat(r: &Value) -> String {
    let mut parties: Vec<String> = Vec::new();
    for c in r["content"].as_array().into_iter().flatten() {
        let s = |v: &Value| v.as_str().unwrap_or("").to_string();
        parties.push(match c["type"].as_str() {
            Some("text") => s(&c["text"]),
            Some("image") => format!("[Image non transmise : {}.]", s(&c["mimeType"])),
            Some("audio") => format!("[Audio non transmis : {}.]", s(&c["mimeType"])),
            Some("resource") => format!("[Fichier non transmis : {}.]", s(&c["resource"]["uri"])),
            Some("resource_link") => format!("[Fichier non transmis : {}.]", s(&c["uri"])),
            _ => "[Contenu non transmis.]".to_string(),
        });
    }
    let mut texte = parties.join("\n");
    if texte.is_empty() {
        if let Some(s) = r.get("structuredContent").filter(|v| !v.is_null()) {
            texte = s.to_string();
        }
    }
    let total = texte.chars().count();
    if total > REPONSE_MAX {
        let fin = texte.char_indices().nth(REPONSE_MAX).map_or(0, |(i, _)| i);
        texte.truncate(fin);
        texte.push_str(&format!(
            "\n[Réponse coupée : {} caractères sur {}.]",
            milliers(REPONSE_MAX),
            milliers(total)
        ));
    }
    texte
}

impl Mcp {
    pub fn new(projet: PathBuf) -> Self {
        Mcp {
            projet,
            etat: Mutex::new(Etat::default()),
            arret: AtomicBool::new(false),
            arret_tx: watch::channel(false).0,
        }
    }

    /// Début d'un tour : relit `.yaide/mcp.json`, lance ou relance les serveurs au besoin, et rend
    /// les définitions des outils et les problèmes, dans l'ordre du fichier.
    pub async fn preparer(&self, limites: &Limites) -> (Vec<DefOutil>, Vec<Probleme>) {
        if self.arret.load(Ordering::SeqCst) {
            return (Vec::new(), Vec::new());
        }
        let mut etat = self.etat.lock().await;
        let contenu = std::fs::read_to_string(self.projet.join(".yaide/mcp.json")).ok();
        let mut anciennes = std::mem::take(&mut etat.entrees);
        if contenu != etat.fichier {
            tuer(std::mem::take(&mut anciennes)).await;
            etat.fichier = contenu.clone();
        }
        let declares = match contenu.as_deref().map(lire) {
            None => Vec::new(),
            Some(Ok(d)) => d,
            Some(Err(p)) => {
                etat.entrees = vec![Entree::Echec(p)];
                return Self::resume(&etat);
            }
        };
        // Un serveur vivant reste ; un serveur arrêté ou en échec est relancé.
        let mut anciennes = anciennes.into_iter();
        let mut a_tuer = Vec::new();
        let mut taches = Vec::new();
        for (nom, valeur) in declares {
            if let Some(Entree::Actif(mut a)) = anciennes.next() {
                if !a.service.is_closed() && matches!(a.enfant.try_wait(), Ok(None)) {
                    taches.push(Err(Entree::Actif(a)));
                    continue;
                }
                a_tuer.push(Entree::Actif(a));
            }
            taches.push(Ok(tokio::spawn(demarrer(
                self.projet.clone(),
                nom,
                valeur,
                limites.mcp_init,
                self.arret_tx.subscribe(),
            ))));
        }
        tuer(a_tuer).await;
        let mut entrees = Vec::new();
        for t in taches {
            entrees.push(match t {
                Err(e) => e,
                Ok(h) => h.await.unwrap_or_else(|e| {
                    Entree::Echec(Probleme {
                        message: format!("Un serveur MCP n'a pas démarré : {e}."),
                        detail: None,
                    })
                }),
            });
        }
        etat.entrees = entrees;
        Self::resume(&etat)
    }

    fn resume(etat: &Etat) -> (Vec<DefOutil>, Vec<Probleme>) {
        let mut outils = Vec::new();
        let mut problemes = Vec::new();
        for e in &etat.entrees {
            match e {
                Entree::Actif(a) => outils.extend(a.outils.iter().map(|o| o.def.clone())),
                Entree::Echec(p) => problemes.push(p.clone()),
            }
        }
        (outils, problemes)
    }

    /// Serveur et outil d'origine derrière un nom `mcp__…` vu du modèle.
    pub async fn identite(&self, nom: &str) -> Option<(String, String)> {
        let etat = self.etat.lock().await;
        etat.entrees.iter().find_map(|e| match e {
            Entree::Actif(a) => a
                .outils
                .iter()
                .find(|o| o.modele == nom)
                .map(|o| (a.nom.clone(), o.original.clone())),
            Entree::Echec(_) => None,
        })
    }

    /// Appelle l'outil `nom` (nom vu du modèle). Une erreur du serveur est un résultat en échec.
    pub async fn appeler(&self, nom: &str, arguments: &Value, limites: &Limites) -> Resultat {
        let trouve = {
            let etat = self.etat.lock().await;
            etat.entrees.iter().find_map(|e| match e {
                Entree::Actif(a) => a
                    .outils
                    .iter()
                    .find(|o| o.modele == nom)
                    .map(|o| (a.nom.clone(), o.original.clone(), a.service.peer().clone())),
                Entree::Echec(_) => None,
            })
        };
        let echec = |contenu: String| Resultat {
            contenu,
            echec: true,
        };
        let Some((serveur, original, peer)) = trouve else {
            return echec(format!("Outil MCP inconnu : {nom}."));
        };
        let mut params = CallToolRequestParams::new(original);
        if let Value::Object(a) = arguments {
            params = params.with_arguments(a.clone());
        }
        match tokio::time::timeout(limites.mcp_appel, peer.call_tool(params)).await {
            Err(_) => echec(format!(
                "Le serveur {serveur} n'a pas répondu en {} s.",
                limites.mcp_appel.as_secs()
            )),
            Ok(Err(ServiceError::McpError(e))) => echec(e.message.to_string()),
            Ok(Err(_)) => echec(format!(
                "Le serveur {serveur} s'est arrêté pendant l'appel."
            )),
            Ok(Ok(r)) => {
                let valeur = serde_json::to_value(&r).unwrap_or(Value::Null);
                Resultat {
                    contenu: texte_du_resultat(&valeur),
                    echec: r.is_error == Some(true),
                }
            }
        }
    }

    /// Arrêt de Yaide : les serveurs et ce qu'ils ont lancé s'arrêtent (SIGKILL après 3 s).
    pub async fn arreter(&self) {
        self.arret.store(true, Ordering::SeqCst);
        self.arret_tx.send_replace(true);
        let entrees = std::mem::take(&mut self.etat.lock().await.entrees);
        tuer(entrees).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Dossier de projet propre au test, sous `TMPDIR` (nextest lance chaque test dans son processus).
    fn projet(test: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("yaide-mcp-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".yaide")).unwrap();
        d.canonicalize().unwrap()
    }

    fn faux() -> String {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/faux-mcp.mjs")
            .display()
            .to_string()
    }

    /// Serveur de test : `node faux-mcp.mjs <options>`.
    fn node(options: &[&str]) -> Value {
        let mut args = vec![faux()];
        args.extend(options.iter().map(|o| o.to_string()));
        json!({"command": "node", "args": args})
    }

    fn ecrire(projet: &Path, serveurs: Value) {
        let f = json!({"mcpServers": serveurs});
        std::fs::write(projet.join(".yaide/mcp.json"), f.to_string()).unwrap();
    }

    /// Comme `ecrire`, mais les serveurs restent dans l'ordre donné.
    fn ecrire_ordre(projet: &Path, serveurs: &[(&str, Value)]) {
        let corps: Vec<String> = serveurs
            .iter()
            .map(|(n, v)| format!("{}:{v}", json!(n)))
            .collect();
        let f = format!("{{\"mcpServers\":{{{}}}}}", corps.join(","));
        std::fs::write(projet.join(".yaide/mcp.json"), f).unwrap();
    }

    fn courtes() -> Limites {
        Limites {
            mcp_init: Duration::from_secs(1),
            mcp_appel: Duration::from_secs(1),
            ..Limites::default()
        }
    }

    fn lancements(note: &Path) -> Vec<Value> {
        std::fs::read_to_string(note)
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn noms(outils: &[DefOutil]) -> Vec<&str> {
        outils.iter().map(|o| o.nom.as_str()).collect()
    }

    #[test]
    fn noms_vus_du_modele() {
        assert_eq!(nom_modele("echo", "dire"), "mcp__echo__dire");
        assert_eq!(nom_modele("mon serveur", "à.b"), "mcp__mon_serveur____b");
        let long = nom_modele(&"s".repeat(40), &"o".repeat(40));
        assert_eq!(long.len(), 64);
        assert!(long.starts_with("mcp__ssss"));
        assert_eq!(milliers(182_431), "182 431");
        assert_eq!(milliers(50_000), "50 000");
    }

    #[tokio::test]
    async fn req095_ac3_dossier_args_et_env() {
        let p = projet("ac3");
        let note = p.join("note.jsonl");
        let mut s = node(&["--note", &note.display().to_string()]);
        s["args"] = json!([
            faux(),
            format!("--note={}", note.display()),
            "--outils=dire"
        ]);
        s["env"] = json!({"FAUX_VAR": "valeur"});
        ecrire(&p, json!({"echo": s}));
        let mcp = Mcp::new(p.clone());
        let (outils, problemes) = mcp.preparer(&courtes()).await;
        assert_eq!(problemes, vec![]);
        assert_eq!(noms(&outils), ["mcp__echo__dire"]);
        assert_eq!(outils[0].description, "Outil dire du faux serveur");
        assert_eq!(outils[0].schema["properties"]["texte"]["type"], "string");
        let l = lancements(&note);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0]["cwd"], p.display().to_string());
        assert_eq!(l[0]["argv"][0], format!("--note={}", note.display()));
        assert_eq!(l[0]["argv"][1], "--outils=dire");
        assert_eq!(l[0]["env"]["FAUX_VAR"], "valeur");
        assert!(l[0]["env"]["PATH"].is_string());
        let r = mcp
            .appeler("mcp__echo__dire", &json!({"texte": "bonjour"}), &courtes())
            .await;
        assert_eq!(
            r,
            Resultat {
                contenu: "dit: bonjour".into(),
                echec: false
            }
        );
        assert_eq!(
            mcp.identite("mcp__echo__dire").await,
            Some(("echo".into(), "dire".into()))
        );
        mcp.arreter().await;
    }

    #[tokio::test]
    async fn req095_ac4_un_seul_processus_liste_relue_processus_relance() {
        let p = projet("ac4");
        let note = p.join("note.jsonl");
        let n = format!("--note={}", note.display());
        ecrire(&p, json!({"echo": node(&[&n])}));
        let mcp = Mcp::new(p.clone());
        let l = courtes();
        let (o1, _) = mcp.preparer(&l).await;
        let (o2, _) = mcp.preparer(&l).await;
        assert_eq!(noms(&o1), noms(&o2));
        assert_eq!(lancements(&note).len(), 1, "deux tours, un seul processus");

        // Fichier modifié : outil renommé et serveur ajouté.
        ecrire_ordre(
            &p,
            &[
                ("echo", node(&[&n, "--outils=redire"])),
                ("autre", node(&[&n])),
            ],
        );
        let (o3, pb) = mcp.preparer(&l).await;
        assert_eq!(pb, vec![]);
        assert_eq!(noms(&o3), ["mcp__echo__redire", "mcp__autre__dire"]);
        assert_eq!(lancements(&note).len(), 3);

        // Processus tué entre deux tours : relancé, l'autre reste.
        let pid = lancements(&note)[1]["pid"].as_i64().unwrap() as i32;
        // SAFETY : tue un processus de test lancé plus haut.
        unsafe { libc::kill(pid, libc::SIGKILL) };
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (o4, pb) = mcp.preparer(&l).await;
        assert_eq!(pb, vec![]);
        assert_eq!(noms(&o4), ["mcp__echo__redire", "mcp__autre__dire"]);
        assert_eq!(lancements(&note).len(), 4);
        mcp.arreter().await;
    }

    #[tokio::test]
    async fn req095_ac5_sans_fichier_ou_sans_serveur_aucun_processus() {
        let p = projet("ac5");
        let mcp = Mcp::new(p.clone());
        let (o, pb) = mcp.preparer(&courtes()).await;
        assert!(o.is_empty() && pb.is_empty());
        assert!(mcp.etat.lock().await.entrees.is_empty());
        ecrire(&p, json!({}));
        let (o, pb) = mcp.preparer(&courtes()).await;
        assert!(o.is_empty() && pb.is_empty());
        assert!(mcp.etat.lock().await.entrees.is_empty());
        std::fs::write(p.join(".yaide/mcp.json"), "{}").unwrap();
        let (o, pb) = mcp.preparer(&courtes()).await;
        assert!(o.is_empty() && pb.is_empty());
    }

    #[tokio::test]
    async fn req095_ac6_json_illisible() {
        let p = projet("ac6");
        std::fs::write(p.join(".yaide/mcp.json"), "{\"mcpServers\": {").unwrap();
        let mcp = Mcp::new(p);
        let (o, pb) = mcp.preparer(&courtes()).await;
        assert!(o.is_empty());
        assert_eq!(pb.len(), 1);
        assert_eq!(
            pb[0].message,
            ".yaide/mcp.json est illisible. Corrigez-le pour utiliser ses serveurs."
        );
        assert!(pb[0].detail.as_deref().unwrap().contains("EOF"));
    }

    #[tokio::test]
    async fn req095_ac7_ac15_un_probleme_par_serveur_dans_l_ordre() {
        let p = projet("ac7");
        ecrire_ordre(
            &p,
            &[
                ("docs", json!({"command": "mcp-docs-introuvable"})),
                ("sortie", node(&["--quitter=1"])),
                ("bon", node(&[])),
                ("muet", node(&["--muet"])),
                ("notion", json!({"url": "https://mcp.notion.com/mcp"})),
                ("vide", json!({})),
            ],
        );
        let mcp = Mcp::new(p);
        let (outils, pb) = mcp.preparer(&courtes()).await;
        assert_eq!(noms(&outils), ["mcp__bon__dire"]);
        let textes: Vec<&str> = pb.iter().map(|x| x.message.as_str()).collect();
        assert_eq!(
            textes,
            [
                "Le serveur MCP docs n'a pas démarré : la commande mcp-docs-introuvable est introuvable.",
                "Le serveur MCP sortie n'a pas démarré : il s'est arrêté (code 1).",
                "Le serveur MCP muet n'a pas démarré : pas de réponse après 1 s.",
                "Le serveur MCP notion n'a pas démarré : url n'est pas pris en charge. Utilisez npx mcp-remote https://mcp.notion.com/mcp.",
                "Le serveur MCP vide n'a pas démarré : il n'a pas de command.",
            ]
        );
        let detail = pb[1].detail.as_deref().unwrap();
        assert_eq!(detail.lines().count(), 20);
        assert_eq!(detail.lines().next(), Some("erreur 6"));
        assert_eq!(detail.lines().last(), Some("erreur 25"));
        assert_eq!(pb[0].detail, None);
        mcp.arreter().await;
    }

    #[tokio::test]
    async fn req095_ac8_ac16_resultats_en_echec_ou_reduits() {
        let p = projet("ac8");
        ecrire(
            &p,
            json!({
                "e1": node(&["--erreur"]),
                "e2": node(&["--delai=5000"]),
                "e3": node(&["--mourir"]),
                "e4": node(&["--image"]),
                "e5": node(&["--ressource"]),
                "e6": node(&["--long=60000"]),
                "e7": node(&["--long=182431"]),
                "e8": node(&["--long=50000"]),
            }),
        );
        let mcp = Mcp::new(p);
        let l = courtes();
        let (_, pb) = mcp.preparer(&l).await;
        assert_eq!(pb, vec![]);
        let appel = |s: &'static str| {
            let mcp = &mcp;
            let l = &l;
            async move { mcp.appeler(&format!("mcp__{s}__dire"), &json!({}), l).await }
        };
        let r = appel("e1").await;
        assert_eq!((r.contenu.as_str(), r.echec), ("boum", true));
        let r = appel("e2").await;
        assert_eq!(
            (r.contenu.as_str(), r.echec),
            ("Le serveur e2 n'a pas répondu en 1 s.", true)
        );
        let r = appel("e3").await;
        assert_eq!(
            (r.contenu.as_str(), r.echec),
            ("Le serveur e3 s'est arrêté pendant l'appel.", true)
        );
        let r = appel("e4").await;
        assert_eq!(
            (r.contenu.as_str(), r.echec),
            ("[Image non transmise : image/png.]", false)
        );
        let r = appel("e5").await;
        assert_eq!(
            (r.contenu.as_str(), r.echec),
            ("[Fichier non transmis : file:///x.txt.]", false)
        );
        let r = appel("e6").await;
        assert!(!r.echec);
        assert!(r
            .contenu
            .ends_with("\n[Réponse coupée : 50 000 caractères sur 60 000.]"));
        assert_eq!(r.contenu.chars().count(), 50_000 + 1 + 48);
        let r = appel("e7").await;
        assert!(r
            .contenu
            .ends_with("[Réponse coupée : 50 000 caractères sur 182 431.]"));
        let r = appel("e8").await;
        assert_eq!(r.contenu.chars().count(), 50_000);
        let r = mcp.appeler("mcp__e1__absent", &json!({}), &l).await;
        assert!(r.echec);
        mcp.arreter().await;
    }

    #[tokio::test]
    async fn req095_ac11_arret_pendant_un_lancement_qui_attend() {
        let p = projet("ac11b");
        ecrire(&p, json!({"muet": node(&["--muet"])}));
        let mcp = Arc::new(Mcp::new(p));
        let limites = Limites {
            mcp_init: Duration::from_secs(30),
            ..Limites::default()
        };
        let m = mcp.clone();
        let tache = tokio::spawn(async move { m.preparer(&limites).await });
        tokio::time::sleep(Duration::from_millis(500)).await;
        let debut = Instant::now();
        mcp.arreter().await;
        assert!(debut.elapsed() < Duration::from_secs(4));
        let (outils, _) = tache.await.unwrap();
        assert!(outils.is_empty());
    }

    #[tokio::test]
    async fn req095_ac11_arret_tue_le_serveur_et_son_enfant() {
        let p = projet("ac11");
        let fichier = p.join("enfant.pid");
        let note = p.join("note.jsonl");
        ecrire(
            &p,
            json!({"dur": node(&[
                "--ignorer-term",
                &format!("--enfant={}", fichier.display()),
                &format!("--note={}", note.display()),
            ])}),
        );
        let mcp = Mcp::new(p);
        let (_, pb) = mcp.preparer(&courtes()).await;
        assert_eq!(pb, vec![]);
        let mut enfant = 0;
        for _ in 0..100 {
            if let Ok(t) = std::fs::read_to_string(&fichier) {
                if let Ok(n) = t.trim().parse::<i32>() {
                    enfant = n;
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(enfant > 0 && vivant(enfant));
        let serveur = lancements(&note)[0]["pid"].as_i64().unwrap() as i32;
        assert!(vivant(serveur));
        let debut = Instant::now();
        mcp.arreter().await;
        assert!(debut.elapsed() < Duration::from_secs(6));
        assert!(!vivant(serveur), "le serveur doit être arrêté");
        assert!(!vivant(enfant), "son enfant doit être arrêté");
        // Après l'arrêt, plus aucun lancement.
        let (o, _) = mcp.preparer(&courtes()).await;
        assert!(o.is_empty());
    }
}
