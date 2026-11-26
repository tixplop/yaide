//! Exécution des workflows publiés (REQ-193, REQ-194, REQ-195, DEC-127) : surveillance des
//! déclencheurs par la boucle de 3 s, enchaînement des actions, journal des logs (REQ-186).
use super::{Noeud, Workflow, Workflows};
use crate::agent::agents::{chemin_du_projet, Agents};
use crate::agent::conversation::Gestionnaire;
use crate::agent::declencheurs::{differences, parcourir, relever_planification, Empreinte};
use crate::agent::outils::Resultat;
use crate::agent::outils_config::lire_interface;
use crate::fichiers;
use crate::journal::{Journal, Severite};
use chrono::NaiveDateTime;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Limite d'une « Commande shell » : 10 min, ou `YAIDE_LIMITE_COMMANDE_MS` (variable de test).
fn limite_commande() -> Duration {
    std::env::var("YAIDE_LIMITE_COMMANDE_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .map(Duration::from_millis)
        .unwrap_or(Duration::from_secs(600))
}

/// État gardé d'une vérification à l'autre.
#[derive(Default)]
pub struct Etat {
    /// (fichier du workflow, dossier) → fichiers à la dernière vérification.
    dossiers: HashMap<(String, String), HashMap<String, Empreinte>>,
    /// (fichier du workflow, expression) → dernière minute vérifiée.
    minutes: HashMap<(String, String), NaiveDateTime>,
    /// Fichiers des workflows en cours d'exécution.
    en_cours: HashSet<String>,
}

fn reglage<'a>(n: &'a Noeud, champ: &str) -> &'a str {
    n.reglages.get(champ).and_then(|v| v.as_str()).unwrap_or("")
}

fn declencheur(w: &Workflow) -> Option<&Noeud> {
    w.noeuds
        .iter()
        .find(|n| super::DECLENCHEURS.contains(&n.genre.as_str()))
}

/// Les évènements du dossier surveillé, limités à ceux qui sont cochés.
fn evenement_dossier(
    etat: &mut Etat,
    projet: &Path,
    fichier: &str,
    d: &Noeud,
    vivantes: &mut HashSet<(String, String)>,
) -> Option<String> {
    let chemin = reglage(d, "dossier");
    if !chemin_du_projet(chemin) {
        return None;
    }
    let ecoutes: Vec<&str> = d.reglages["evenements"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| match e.as_str()? {
            "cree" => Some(" créé"),
            "modifie" => Some(" modifié"),
            "supprime" => Some(" supprimé"),
            _ => None,
        })
        .collect();
    let cle = (fichier.to_string(), chemin.to_string());
    vivantes.insert(cle.clone());
    let apres = parcourir(projet, chemin, etat.dossiers.get(&cle));
    let lignes: Vec<String> = match etat.dossiers.get(&cle) {
        // Premier regard : l'état du moment, sans évènement.
        None => Vec::new(),
        Some(avant) => differences(avant, &apres)
            .into_iter()
            .filter(|l| ecoutes.iter().any(|e| l.ends_with(e)))
            .collect(),
    };
    etat.dossiers.insert(cle, apres);
    (!lignes.is_empty()).then(|| {
        format!(
            "Évènement : changements dans le dossier `{}/` :\n{}",
            chemin.trim_end_matches('/'),
            lignes.join("\n")
        )
    })
}

/// Une vérification : les exécutions à lancer, (fichier, workflow, entrée). Les évènements d'un
/// workflow en cours, ou tous si la fonction `agents` est inactive, sont vus puis ignorés.
pub fn verifier(
    etat: &mut Etat,
    projet: &Path,
    publies: &[(String, Workflow)],
    actif: bool,
    maintenant: NaiveDateTime,
) -> Vec<(String, Workflow, String)> {
    let mut sortie = Vec::new();
    let mut vivantes = HashSet::new();
    let mut expressions = HashSet::new();
    for (fichier, w) in publies {
        let Some(d) = declencheur(w).filter(|d| d.genre != "appel") else {
            continue;
        };
        let muet = !actif || etat.en_cours.contains(fichier);
        let evenement = if d.genre == "dossier" {
            evenement_dossier(etat, projet, fichier, d, &mut vivantes)
        } else {
            let expression = reglage(d, "cron");
            expressions.insert((fichier.clone(), expression.to_string()));
            relever_planification(&mut etat.minutes, fichier, expression, maintenant, muet)
        };
        if let (false, Some(e)) = (muet, evenement) {
            etat.en_cours.insert(fichier.clone());
            sortie.push((fichier.clone(), w.clone(), e));
        }
    }
    etat.dossiers.retain(|k, _| vivantes.contains(k));
    etat.minutes.retain(|k, _| expressions.contains(k));
    sortie
}

/// Les actions à lancer, dans l'ordre : parcours en profondeur depuis le déclencheur, suivants
/// triés par `y` puis `x`. Chaque élément : (action, nœud dont elle reçoit la sortie).
fn ordre(w: &Workflow, depart: &str) -> Vec<(Noeud, String)> {
    fn visiter(w: &Workflow, id: &str, vus: &mut Vec<String>, sortie: &mut Vec<(Noeud, String)>) {
        let mut suivants: Vec<&Noeud> = w
            .liens
            .iter()
            .filter(|l| l.de == id)
            .filter_map(|l| w.noeuds.iter().find(|n| n.id == l.vers))
            .collect();
        suivants.sort_by(|a, b| a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x)));
        for s in suivants {
            if vus.contains(&s.id) {
                continue;
            }
            vus.push(s.id.clone());
            sortie.push((s.clone(), id.to_string()));
            visiter(w, &s.id, vus, sortie);
        }
    }
    let mut sortie = Vec::new();
    visiter(w, depart, &mut vec![depart.to_string()], &mut sortie);
    sortie
}

/// Une action en échec : la raison et, s'il y en a un, le détail.
#[derive(Debug)]
struct Echec {
    raison: String,
    detail: Option<String>,
}

fn echec(raison: &str) -> Echec {
    Echec {
        raison: raison.to_string(),
        detail: None,
    }
}

/// Plafond de la sortie gardée : les derniers octets seulement, comme l'outil `bash`.
const SORTIE_MAX: usize = 30_000;

/// La fin de la sortie, au plus `SORTIE_MAX` octets, sans couper un caractère.
fn fin_de_sortie(octets: &[u8]) -> String {
    let texte = String::from_utf8_lossy(octets);
    let mut debut = texte.len().saturating_sub(SORTIE_MAX);
    while !texte.is_char_boundary(debut) {
        debut += 1;
    }
    texte[debut..].to_string()
}

type Lecture = (Arc<Mutex<Vec<u8>>>, tokio::task::JoinHandle<()>);

/// Lit un tube en continu (sinon la commande bloquerait) et n'en garde que la fin.
fn lire_en_continu<T: tokio::io::AsyncRead + Unpin + Send + 'static>(flux: Option<T>) -> Lecture {
    use tokio::io::AsyncReadExt;
    let recu = Arc::new(Mutex::new(Vec::new()));
    let r = recu.clone();
    let tache = tokio::spawn(async move {
        let Some(mut flux) = flux else { return };
        let mut tampon = [0u8; 8192];
        while let Ok(n) = flux.read(&mut tampon).await {
            if n == 0 {
                break;
            }
            let mut g = r.lock().unwrap_or_else(|x| x.into_inner());
            g.extend_from_slice(&tampon[..n]);
            if g.len() > 2 * SORTIE_MAX {
                let trop = g.len() - SORTIE_MAX;
                g.drain(..trop);
            }
        }
    });
    (recu, tache)
}

/// Lance la commande comme l'outil `bash` : `/bin/sh -c`, racine du projet, sans terminal.
/// L'entrée est dans `YAIDE_ENTREE`. Sortie : la sortie standard.
async fn commande_shell(
    projet: &Path,
    commande: &str,
    entree: &str,
    limite: Duration,
) -> Result<String, Echec> {
    let mut c = tokio::process::Command::new("/bin/sh");
    c.arg("-c")
        .arg(commande)
        .current_dir(projet)
        .env("YAIDE_ENTREE", entree);
    lancer(c, limite, "la commande /bin/sh est introuvable").await
}

/// Lance `claude -p <demande>` dans la racine du projet, sans terminal (DEC-127).
async fn session_claude(projet: &Path, demande: &str, limite: Duration) -> Result<String, Echec> {
    let mut c = tokio::process::Command::new("claude");
    c.arg("-p").arg(demande).current_dir(projet);
    lancer(c, limite, "la commande claude est introuvable").await
}

/// Lance la commande sans terminal, attend sa fin dans la limite de temps ; sortie standard.
async fn lancer(
    mut commande: tokio::process::Command,
    limite: Duration,
    introuvable: &str,
) -> Result<String, Echec> {
    let mut enfant = commande
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                echec(introuvable)
            } else {
                echec(&format!("impossible de lancer la commande ({e})"))
            }
        })?;
    let pgid = enfant.id().unwrap_or(0) as i32;
    let (o, mut lo) = lire_en_continu(enfant.stdout.take());
    let (e, mut le) = lire_en_continu(enfant.stderr.take());
    let fin = tokio::time::timeout(limite, enfant.wait()).await;
    // Le groupe est tué dans tous les cas : un processus laissé en arrière-plan ne survit pas.
    if pgid > 0 {
        // SAFETY: un appel système sans pointeur ; `-pgid` vise le groupe de la commande.
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
    let Ok(statut) = fin else {
        lo.abort();
        le.abort();
        return Err(echec("limite de temps atteinte"));
    };
    // La fin des tubes suit la mort du groupe ; un processus sorti du groupe ne nous bloque pas.
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        let _ = (&mut lo).await;
        let _ = (&mut le).await;
    })
    .await;
    lo.abort();
    le.abort();
    let o = o.lock().unwrap_or_else(|x| x.into_inner()).clone();
    let e = e.lock().unwrap_or_else(|x| x.into_inner()).clone();
    let statut = statut.map_err(|e| echec(&format!("commande illisible ({e})")))?;
    match statut.code() {
        Some(0) => Ok(fin_de_sortie(&o)),
        code => {
            let texte = String::from_utf8_lossy(&e);
            let texte = texte.trim();
            let debut = texte.char_indices().rev().nth(3999).map_or(0, |(i, _)| i);
            Err(Echec {
                raison: code.map_or("commande interrompue".to_string(), |c| {
                    format!("code de sortie {c}")
                }),
                detail: (!texte.is_empty()).then(|| texte[debut..].to_string()),
            })
        }
    }
}

/// Le texte d'un réglage, `{{entree}}` remplacé par l'entrée.
fn avec_entree(n: &Noeud, champ: &str, entree: &str) -> String {
    reglage(n, champ).replace("{{entree}}", entree)
}

/// Un chemin du projet, revérifié après le remplacement de `{{entree}}`.
fn chemin_verifie(n: &Noeud, champ: &str, entree: &str) -> Result<String, Echec> {
    let c = avec_entree(n, champ, entree);
    if chemin_du_projet(&c) {
        Ok(c)
    } else {
        Err(echec("chemin hors du projet"))
    }
}

fn echec_fichier(e: fichiers::Erreur, chemin: &str) -> Echec {
    use fichiers::Erreur::*;
    echec(&match e {
        Interdit => "chemin hors du projet".to_string(),
        Introuvable => format!("le fichier {chemin} n'existe pas"),
        Existe => format!("{chemin} existe déjà"),
        Binaire | NonUtf8 => format!("le fichier {chemin} n'est pas du texte"),
        TropGros => format!("le fichier {chemin} est trop gros"),
        Conflit(_) => format!("le fichier {chemin} a changé"),
        Droits => format!("droits insuffisants sur {chemin}"),
        Invalide(m) => m.trim_end_matches('.').to_string(),
        Autre(m) => m,
    })
}

/// « Fichier » : l'opération par les fonctions de `fichiers.rs`. Sortie : le contenu pour
/// « Lire », l'entrée reçue pour les autres.
fn action_fichier(projet: &Path, n: &Noeud, entree: &str) -> Result<String, Echec> {
    let chemin = chemin_verifie(n, "chemin", entree)?;
    let e = |e| echec_fichier(e, &chemin);
    match reglage(n, "operation") {
        "lire" => fichiers::lire(projet, &chemin).map(|(t, _)| t).map_err(e),
        "ecrire" => {
            let contenu = avec_entree(n, "contenu", entree);
            fichiers::ecrire(projet, &chemin, None, contenu.as_bytes())
                .map(|_| entree.to_string())
                .map_err(e)
        }
        op @ ("copier" | "deplacer") => {
            let destination = chemin_verifie(n, "destination", entree)?;
            fichiers::remplacer(projet, &chemin, &destination, op == "deplacer")
                .map(|_| entree.to_string())
                .map_err(e)
        }
        "supprimer" => fichiers::supprimer(projet, &chemin)
            .map(|_| entree.to_string())
            .map_err(e),
        _ => Err(echec("opération inconnue")),
    }
}

/// « Agent » : un tour déclenché, attendu jusqu'à sa fin ; sortie : la dernière réponse.
async fn action_agent(contexte: &Contexte<'_>, n: &Noeud, entree: &str) -> Result<String, Echec> {
    let dossier = reglage(n, "agent");
    let Some(agent) = contexte.agents.lire(dossier) else {
        let nom = Some(reglage(n, "nom"))
            .filter(|v| !v.is_empty())
            .unwrap_or(dossier);
        return Err(echec(&format!("l'agent « {nom} » n'existe plus")));
    };
    let message = avec_entree(n, "message", entree);
    contexte
        .gestionnaire
        .tour_pour_workflow(&agent, &message)
        .await
        .map_err(|m| echec(m.trim_end_matches('.')))
}

/// Ce que les actions utilisent du serveur.
struct Contexte<'a> {
    projet: &'a Path,
    agents: &'a Agents,
    gestionnaire: &'a Arc<Gestionnaire>,
    limite: Duration,
}

async fn action(contexte: &Contexte<'_>, n: &Noeud, entree: &str) -> Result<String, Echec> {
    let (projet, limite) = (contexte.projet, contexte.limite);
    match n.genre.as_str() {
        "shell" => commande_shell(projet, reglage(n, "commande"), entree, limite).await,
        "claude" => session_claude(projet, &avec_entree(n, "demande", entree), limite).await,
        "fichier" => action_fichier(projet, n, entree),
        "agent" => action_agent(contexte, n, entree).await,
        _ => Err(echec("action non disponible")),
    }
}

/// Une exécution, du déclencheur à la dernière action ; le journal en est la seule trace.
async fn executer(contexte: &Contexte<'_>, w: &Workflow, entree: String, journal: &Journal) {
    journal.ecrire(
        Severite::Information,
        &format!("Workflow « {} » lancé.", w.nom),
    );
    let Some(d) = declencheur(w) else { return };
    let mut sorties = HashMap::from([(d.id.clone(), entree)]);
    for (n, parent) in ordre(w, &d.id) {
        let recu = sorties.get(&parent).cloned().unwrap_or_default();
        match action(contexte, &n, &recu).await {
            Ok(s) => {
                sorties.insert(n.id.clone(), s);
            }
            Err(e) => {
                journal.ecrire_a(
                    crate::journal::maintenant_ms(),
                    Severite::Erreur,
                    &format!(
                        "Workflow « {} » : échec de « {} » : {}.",
                        w.nom, n.titre, e.raison
                    ),
                    e.detail,
                );
                return;
            }
        }
    }
    journal.ecrire(
        Severite::Information,
        &format!("Workflow « {} » terminé.", w.nom),
    );
}

/// La fonction `agents` est active (elle l'est tant que `interface.json` ne la coupe pas).
fn fonction_active(projet: &Path) -> bool {
    lire_interface(projet)
        .map(|i| i.fonctions.iter().all(|(c, v)| *c != "agents" || *v))
        .unwrap_or(true)
}

/// Lance une tâche pour une exécution déjà réservée dans `en_cours`.
fn demarrer(
    etat: &Arc<Mutex<Etat>>,
    projet: &Path,
    (fichier, w, entree): (String, Workflow, String),
    journal: &Arc<Journal>,
    agents: &Arc<Agents>,
    gestionnaire: &Arc<Gestionnaire>,
) {
    let (etat, projet, journal) = (etat.clone(), projet.to_path_buf(), journal.clone());
    let (agents, gestionnaire) = (agents.clone(), gestionnaire.clone());
    tokio::spawn(async move {
        let contexte = Contexte {
            projet: &projet,
            agents: &agents,
            gestionnaire: &gestionnaire,
            limite: limite_commande(),
        };
        executer(&contexte, &w, entree, &journal).await;
        // La surveillance repart de l'état du moment (REQ-164).
        let mut e = etat.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(d) = declencheur(&w).filter(|d| d.genre == "dossier") {
            let chemin = reglage(d, "dossier");
            if chemin_du_projet(chemin) {
                let cle = (fichier.clone(), chemin.to_string());
                let a = parcourir(&projet, chemin, e.dossiers.get(&cle));
                e.dossiers.insert(cle, a);
            }
        }
        e.en_cours.remove(&fichier);
    });
}

/// Une vérification complète : lance une tâche par exécution déclenchée.
pub fn passer(
    etat: &Arc<Mutex<Etat>>,
    projet: &Path,
    publies: Vec<(String, Workflow)>,
    journal: &Arc<Journal>,
    agents: &Arc<Agents>,
    gestionnaire: &Arc<Gestionnaire>,
) {
    let lancer = verifier(
        &mut etat.lock().unwrap_or_else(|e| e.into_inner()),
        projet,
        &publies,
        fonction_active(projet),
        chrono::Local::now().naive_local(),
    );
    for execution in lancer {
        demarrer(etat, projet, execution, journal, agents, gestionnaire);
    }
}

/// L'outil `run_workflow` (REQ-196) : lance sans attendre le workflow publié dont le déclencheur
/// est « Appel par un agent » et que `name` désigne, sans tenir compte de la casse.
pub fn lancer_par_agent(
    etat: &Arc<Mutex<Etat>>,
    gestionnaire: &Arc<Gestionnaire>,
    arguments: &Value,
) -> Resultat {
    let echec = |m: String| Resultat {
        contenu: m,
        echec: true,
    };
    let Some(nom) = arguments["name"].as_str() else {
        return echec("Missing or invalid argument: name.".into());
    };
    let entree = match &arguments["input"] {
        Value::Null => "",
        Value::String(t) => t.as_str(),
        _ => return echec("Missing or invalid argument: input.".into()),
    };
    let contexte = gestionnaire.contexte();
    let projet = contexte.projet.as_path();
    if !fonction_active(projet) {
        return echec("Les workflows sont désactivés.".into());
    }
    let convenables: Vec<(String, Workflow)> = Workflows::new(projet.join(".yaide"))
        .publies()
        .into_iter()
        .filter(|(_, w)| declencheur(w).is_some_and(|d| d.genre == "appel"))
        .collect();
    let Some((fichier, w)) = convenables
        .iter()
        .find(|(_, w)| w.nom.to_lowercase() == nom.to_lowercase())
    else {
        let noms: Vec<&str> = convenables.iter().map(|(_, w)| w.nom.as_str()).collect();
        let dispo = if noms.is_empty() {
            "aucun".to_string()
        } else {
            noms.join(", ")
        };
        return echec(format!(
            "Aucun workflow publié « {nom} » ne se lance par un agent. Workflows disponibles : {dispo}."
        ));
    };
    if !etat
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .en_cours
        .insert(fichier.clone())
    {
        return echec(format!(
            "Le workflow « {} » est déjà en cours. Réessayez à sa fin.",
            w.nom
        ));
    }
    demarrer(
        etat,
        projet,
        (fichier.clone(), w.clone(), entree.to_string()),
        gestionnaire.logs(),
        &contexte.agents,
        gestionnaire,
    );
    Resultat {
        contenu: format!("Workflow « {} » lancé.", w.nom),
        echec: false,
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use crate::workflows::Lien;
    use chrono::NaiveDate;
    use serde_json::json;

    #[test]
    fn REQ194_fin_de_sortie_courte_rendue_entiere() {
        assert_eq!(fin_de_sortie(b"abc\n"), "abc\n");
    }

    #[test]
    fn REQ194_fin_de_sortie_garde_exactement_les_derniers_octets() {
        let mut v = vec![b'a'; 30_000];
        v.extend(vec![b'b'; 30_000]);
        assert_eq!(fin_de_sortie(&v), "b".repeat(SORTIE_MAX));
    }

    #[test]
    fn REQ194_fin_de_sortie_ne_coupe_pas_un_caractere() {
        // 60 001 octets : la coupe (30 001) tombe au milieu d'un « é ».
        let mut v = "é".repeat(SORTIE_MAX).into_bytes();
        v.push(b'a');
        let s = fin_de_sortie(&v);
        assert_eq!(s.len(), SORTIE_MAX - 1);
        assert_eq!(s, format!("{}a", "é".repeat(SORTIE_MAX / 2 - 1)));
    }

    fn noeud(id: &str, genre: &str, y: f64, reglages: serde_json::Value) -> Noeud {
        Noeud {
            id: id.into(),
            genre: genre.into(),
            titre: id.into(),
            x: 0.0,
            y,
            reglages,
        }
    }

    fn le(jour: u32, h: u32, m: u32, s: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 11, jour)
            .unwrap()
            .and_hms_opt(h, m, s)
            .unwrap()
    }

    #[test]
    fn REQ193_AC3_planification_lundi_0930_une_fois_samedi_rien() {
        let w = Workflow {
            nom: "P".into(),
            publie: true,
            noeuds: vec![noeud(
                "t",
                "planification",
                0.0,
                json!({"cron": "30 9 * * 1-5"}),
            )],
            liens: vec![],
        };
        let p = [("p".to_string(), w)];
        let projet = std::env::temp_dir().join("yaide-workflow-planification-inexistant");
        let mut etat = Etat::default();
        let r = verifier(&mut etat, &projet, &p, true, le(23, 9, 30, 1));
        assert_eq!(r.len(), 1);
        assert_eq!(
            r[0].2,
            "Évènement : planification `30 9 * * 1-5` atteinte.\nHeure : 2026-11-23 09:30"
        );
        etat.en_cours.clear();
        assert!(verifier(&mut etat, &projet, &p, true, le(23, 9, 30, 4)).is_empty());
        assert!(verifier(&mut etat, &projet, &p, true, le(23, 9, 31, 1)).is_empty());
        assert!(verifier(&mut etat, &projet, &p, true, le(28, 9, 30, 1)).is_empty());
        // Fonction `agents` inactive : la minute est vue, rien ne se lance.
        assert!(verifier(&mut etat, &projet, &p, false, le(30, 9, 30, 1)).is_empty());
    }

    #[test]
    fn REQ193_AC4_dossier_evenements_coches_et_rien_pendant_l_execution() {
        let projet = std::env::temp_dir().join(format!("workflow-dossier-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&projet);
        std::fs::create_dir_all(projet.join("notes")).unwrap();
        let w = Workflow {
            nom: "D".into(),
            publie: true,
            noeuds: vec![noeud(
                "t",
                "dossier",
                0.0,
                json!({"dossier": "notes", "evenements": ["cree"]}),
            )],
            liens: vec![],
        };
        let p = [("d".to_string(), w)];
        let mut etat = Etat::default();
        let t = le(23, 9, 0, 0);
        assert!(verifier(&mut etat, &projet, &p, true, t).is_empty());
        std::fs::write(projet.join("notes/a.md"), "1").unwrap();
        let r = verifier(&mut etat, &projet, &p, true, t);
        assert_eq!(
            r[0].2,
            "Évènement : changements dans le dossier `notes/` :\n- `notes/a.md` créé"
        );
        // En cours : b.md est vu puis ignoré.
        std::fs::write(projet.join("notes/b.md"), "1").unwrap();
        assert!(verifier(&mut etat, &projet, &p, true, t).is_empty());
        etat.en_cours.clear();
        assert!(verifier(&mut etat, &projet, &p, true, t).is_empty());
        // « Modifié » n'est pas coché.
        std::fs::write(projet.join("notes/a.md"), "22").unwrap();
        assert!(verifier(&mut etat, &projet, &p, true, t).is_empty());
        // Fonction `agents` inactive : vu, ignoré.
        std::fs::write(projet.join("notes/c.md"), "1").unwrap();
        assert!(verifier(&mut etat, &projet, &p, false, t).is_empty());
        assert!(verifier(&mut etat, &projet, &p, true, t).is_empty());
    }

    #[test]
    fn REQ194_AC2_ordre_en_profondeur_suivants_par_position() {
        let mut w = Workflow {
            nom: "O".into(),
            publie: true,
            noeuds: vec![
                noeud("t", "dossier", 0.0, json!({})),
                noeud("A", "shell", 10.0, json!({})),
                noeud("B", "shell", 20.0, json!({})),
                noeud("C", "shell", 30.0, json!({})),
                noeud("D", "shell", 40.0, json!({})),
            ],
            liens: ["tA", "AC", "AB", "BD"]
                .iter()
                .map(|l| Lien {
                    de: l[..1].into(),
                    vers: l[1..].into(),
                })
                .collect(),
        };
        let ids =
            |w: &Workflow| -> String { ordre(w, "t").iter().map(|(n, _)| n.id.clone()).collect() };
        assert_eq!(ids(&w), "ABDC");
        w.noeuds[2].y = 50.0;
        assert_eq!(ids(&w), "ACBD");
    }

    #[tokio::test]
    async fn REQ194_commande_avec_processus_en_arriere_plan_rend_sa_sortie_vite() {
        let d = std::env::temp_dir().join(format!("workflow-fond-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let debut = std::time::Instant::now();
        let s = commande_shell(&d, "sleep 30 & echo ok", "", Duration::from_secs(20))
            .await
            .unwrap();
        assert_eq!(s, "ok\n");
        assert!(debut.elapsed() < Duration::from_secs(5));
        // La sortie gardée est plafonnée.
        let s = commande_shell(&d, "seq 1 100000", "", Duration::from_secs(20))
            .await
            .unwrap();
        assert!(s.len() <= SORTIE_MAX && s.ends_with("100000\n"));
    }

    #[tokio::test]
    async fn REQ195_AC3_commande_shell_racine_du_projet_et_entree_dans_l_environnement() {
        let d = std::env::temp_dir()
            .join(format!("workflow-shell-{}", std::process::id()))
            .join("p");
        std::fs::create_dir_all(&d).unwrap();
        let d = d.canonicalize().unwrap();
        let s = commande_shell(
            &d,
            "pwd; echo \"$YAIDE_ENTREE\"",
            "abc",
            Duration::from_secs(10),
        )
        .await
        .unwrap();
        assert_eq!(s, format!("{}\nabc\n", d.display()));
    }
}
