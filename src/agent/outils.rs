//! Les quinze outils de l'agent (REQ-057, REQ-097, REQ-098, REQ-100). Une erreur d'outil n'est pas une erreur Rust :
//! elle part au modèle comme résultat (`echec`), en une phrase courte en anglais.

use super::agents::{Agents, COULEURS};
use super::outils_config;
use super::provider::DefOutil;
use super::reglages::{self, Erreur, Reglages};
use super::web;
use crate::{connaissance, fichiers, recherche};

use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const SORTIE_MAX: usize = 30_000;
const CHEMINS_MAX: usize = 500;

#[derive(Debug, PartialEq)]
pub struct Resultat {
    pub contenu: String,
    pub echec: bool,
}

/// Délais et adresse de la recherche web, réduits par les tests.
#[derive(Clone)]
pub struct Limites {
    pub bash: Duration,
    pub web: Duration,
    /// `initialize` d'un serveur MCP, et appel d'un outil MCP.
    pub mcp_init: Duration,
    pub mcp_appel: Duration,
    pub recherche: String,
}

impl Default for Limites {
    fn default() -> Self {
        Limites {
            bash: Duration::from_secs(120),
            web: Duration::from_secs(30),
            mcp_init: Duration::from_secs(30),
            mcp_appel: Duration::from_secs(120),
            recherche: "https://html.duckduckgo.com/html/".into(),
        }
    }
}

pub struct Contexte {
    pub projet: PathBuf,
    pub client: reqwest::Client,
    pub limites: Limites,
    pub agents: Arc<Agents>,
    pub reglages: Arc<Reglages>,
}

fn ok(contenu: String) -> Resultat {
    Resultat {
        contenu,
        echec: false,
    }
}

fn echec(contenu: impl Into<String>) -> Resultat {
    Resultat {
        contenu: contenu.into(),
        echec: true,
    }
}

fn def(nom: &str, description: &str, proprietes: Value, requis: &[&str]) -> DefOutil {
    DefOutil {
        nom: nom.into(),
        description: description.into(),
        schema: json!({"type": "object", "properties": proprietes, "required": requis}),
    }
}

pub fn definitions() -> Vec<DefOutil> {
    let texte = |d: &str| json!({"type": "string", "description": d});
    let entier = |d: &str| json!({"type": "integer", "description": d});
    let mut outils = vec![
        def(
            "read",
            "Read a text file of the project. Optionally from a line (1-based) and for a number of lines.",
            json!({"path": texte("File path, relative to the project"), "offset": entier("First line to read, starting at 1"), "limit": entier("Maximum number of lines")}),
            &["path"],
        ),
        def(
            "write",
            "Create or replace a file of the project, with its parent folders.",
            json!({"path": texte("File path, relative to the project"), "content": texte("Whole new content")}),
            &["path", "content"],
        ),
        def(
            "edit",
            "Replace a passage that appears exactly once in a file.",
            json!({"path": texte("File path, relative to the project"), "old": texte("Passage to replace, unique in the file"), "new": texte("Replacement")}),
            &["path", "old", "new"],
        ),
        def(
            "bash",
            "Run a shell command with /bin/sh -c in the project. Returns the output and the exit code.",
            json!({"command": texte("The command")}),
            &["command"],
        ),
        def(
            "glob",
            "List project files matching a glob pattern such as src/**/*.rs. Git-ignored files are left out.",
            json!({"pattern": texte("Glob pattern")}),
            &["pattern"],
        ),
        def(
            "websearch",
            "Search the web. Returns up to 10 results with title, URL and excerpt.",
            json!({"query": texte("Search query")}),
            &["query"],
        ),
        def(
            "webfetch",
            "Fetch an http(s) page and return its text without HTML tags.",
            json!({"url": texte("Page address")}),
            &["url"],
        ),
        def(
            "list_agents",
            "List the custom agents of the project (folder, name, avatar, color, profile, paths of the persona and instructions files), the available colors and the model profiles (id, name, model, default). Read those files with read.",
            json!({}),
            &[],
        ),
        def(
            "save_agent",
            "Create a custom agent (without folder; name is required) or modify the agent of folder (an omitted argument keeps its value). persona and instructions replace the whole persona and instructions files.",
            json!({
                "folder": texte("Folder of the agent to modify, as given by list_agents; omit to create"),
                "name": texte("Agent name, unique whatever the case"),
                "avatar": texte("At most two characters, an emoji counts for one"),
                "color": texte("One of the colors given by list_agents; violet by default"),
                "profile": texte("Id of a model profile; empty for the default profile"),
                "persona": texte("Whole text of the persona file"),
                "instructions": texte("Whole text of the instructions file"),
            }),
            &[],
        ),
        def(
            "subagent",
            "Run a temporary subagent. It starts with an empty context, works alone on the prompt with the same tools as you (except subagent) and returns its final answer. Everything it needs must be in the prompt.",
            json!({"prompt": texte("The task for the subagent, with all the context it needs")}),
            &["prompt"],
        ),
    ];
    outils.extend(outils_config::definitions());
    outils
}

/// L'outil `knowledge_search` (REQ-107), relu à chaque tour : offert seulement si la
/// configuration de la base se lit et qu'elle a au moins une collection.
pub fn definition_connaissance(projet: &Path) -> Option<DefOutil> {
    let base = connaissance::Base::new(projet);
    base.lire_config().ok()??;
    let noms: Vec<String> = base.liste().ok()?.into_iter().map(|c| c.nom).collect();
    if noms.is_empty() {
        return None;
    }
    Some(def(
        "knowledge_search",
        &format!(
            "Search the knowledge base of the project, built from files added by the user. Returns up to 10 passages, closest first, each with its file and lines, collection, score and text. Collections: {}.",
            noms.join(", ")
        ),
        json!({
            "query": json!({"type": "string", "description": "The question or the words to look for"}),
            "collection": json!({"type": "string", "description": "Collection to search; omit to search all of them"}),
        }),
        &["query"],
    ))
}

/// L'argument qui résume un appel, pour l'affichage : chemin, commande, motif, requête ou adresse.
pub fn argument_principal(nom: &str, arguments: &Value) -> String {
    if nom.starts_with("mcp__") {
        // Les arguments en JSON compact, rien pour `{}`.
        return match arguments {
            Value::Null => String::new(),
            Value::Object(o) if o.is_empty() => String::new(),
            v => v.to_string(),
        };
    }
    let cle = match nom {
        "read" | "write" | "edit" => "path",
        "bash" => "command",
        "glob" => "pattern",
        "websearch" => "query",
        "webfetch" => "url",
        "subagent" => "prompt",
        "knowledge_search" => "query",
        "save_agent" => {
            let c = if arguments["name"].is_string() {
                "name"
            } else {
                "folder"
            };
            return arguments[c].as_str().unwrap_or("").to_string();
        }
        _ => return outils_config::argument_principal(nom, arguments).unwrap_or_default(),
    };
    arguments[cle].as_str().unwrap_or("").to_string()
}

fn requis<'a>(arguments: &'a Value, cle: &str) -> Result<&'a str, String> {
    arguments[cle]
        .as_str()
        .ok_or_else(|| format!("Missing or invalid argument: {cle}."))
}

fn entier(arguments: &Value, cle: &str) -> Result<Option<usize>, String> {
    match &arguments[cle] {
        Value::Null => Ok(None),
        v => v
            .as_u64()
            .map(|n| Some(n as usize))
            .ok_or_else(|| format!("Invalid argument: {cle}.")),
    }
}

pub async fn executer(nom: &str, arguments: &Value, ctx: &Contexte) -> Resultat {
    match lancer(nom, arguments, ctx).await {
        Ok(r) => r,
        Err(m) => echec(m),
    }
}

async fn lancer(nom: &str, a: &Value, ctx: &Contexte) -> Result<Resultat, String> {
    let projet = ctx.projet.as_path();
    match nom {
        "read" => lire(
            projet,
            requis(a, "path")?,
            entier(a, "offset")?,
            entier(a, "limit")?,
        )
        .map(ok),
        "write" => {
            let (chemin, contenu) = (requis(a, "path")?, requis(a, "content")?);
            if fichiers::resoudre(projet, chemin).map_err(phrase)?.is_dir() {
                return Err("The path is a directory.".into());
            }
            fichiers::ecrire(projet, chemin, None, contenu.as_bytes()).map_err(phrase)?;
            Ok(ok(format!("Wrote {} bytes to {chemin}.", contenu.len())))
        }
        "edit" => remplacer(
            projet,
            requis(a, "path")?,
            requis(a, "old")?,
            requis(a, "new")?,
        )
        .map(ok),
        "bash" => Ok(bash(projet, requis(a, "command")?, ctx.limites.bash).await),
        "glob" => glob(projet, requis(a, "pattern")?).await.map(ok),
        "websearch" => web::chercher(
            &ctx.client,
            &ctx.limites.recherche,
            requis(a, "query")?,
            ctx.limites.web,
        )
        .await
        .map(ok),
        "webfetch" => web::recuperer(&ctx.client, requis(a, "url")?, ctx.limites.web)
            .await
            .map(ok),
        "knowledge_search" => connaissance_chercher(requis(a, "query")?, &a["collection"], ctx)
            .await
            .map(ok),
        "list_agents" => Ok(ok(lister_agents(ctx))),
        "save_agent" => sauver_agent(a, ctx).map(ok),
        _ => match outils_config::lancer(nom, a, ctx) {
            Some(r) => r.map(ok),
            None => Err(format!("Unknown tool: {nom}.")),
        },
    }
}

/// Outil `knowledge_search` : la recherche de REQ-106, rendue en texte.
async fn connaissance_chercher(
    question: &str,
    collection: &Value,
    ctx: &Contexte,
) -> Result<String, String> {
    let base = connaissance::Base::new(&ctx.projet);
    let config = base
        .lire_config()?
        .ok_or("The knowledge base is not configured.")?;
    let provider = reglages::provider(&config.provider)
        .ok_or("The provider of the knowledge base is unknown.")?;
    let cle = ctx.reglages.cle(&config.provider);
    connaissance::verifier_cle(provider, cle.as_deref())?;
    let adresse = ctx
        .reglages
        .adresse(&config.provider)
        .unwrap_or_else(|| provider.adresse_par_defaut().to_string());
    let choisie = match collection {
        Value::Null => None,
        Value::String(n) => match base.trouver(n)? {
            Some(n) => Some(n),
            None => {
                let noms: Vec<String> = base.liste()?.into_iter().map(|c| c.nom).collect();
                return Err(format!(
                    "Unknown collection: {n}. Available: {}.",
                    noms.join(", ")
                ));
            }
        },
        _ => return Err("Missing or invalid argument: collection.".into()),
    };
    let acces = connaissance::Acces {
        client: &ctx.client,
        provider,
        adresse: &adresse,
        cle: cle.as_deref(),
        modele: &config.modele,
    };
    let trouves = base
        .chercher(&acces, question, choisie.as_deref())
        .await
        .map_err(|e| format!("{} {}", e.cause, e.detail).trim().to_string())?;
    if trouves.is_empty() {
        return Ok("No passage found.".into());
    }
    let blocs: Vec<String> = trouves
        .iter()
        .map(|t| {
            format!(
                "{}:{}-{} ({}, score {:.2})\n{}",
                t.chemin, t.debut, t.fin, t.collection, t.score, t.texte
            )
        })
        .collect();
    Ok(blocs.join("\n\n"))
}

fn chemin_md(dossier: &str, md: &str) -> String {
    format!(".yaide/agents/{dossier}/{md}")
}

fn lister_agents(ctx: &Contexte) -> String {
    let liste = ctx.agents.lister();
    let agents: Vec<Value> = liste
        .agents
        .iter()
        .map(|a| {
            json!({
                "folder": a.dossier, "name": a.nom, "avatar": a.avatar, "color": a.couleur,
                "profile": a.profil.clone().unwrap_or_default(),
                "persona": chemin_md(&a.dossier, "PERSONA.md"),
                "instructions": chemin_md(&a.dossier, "AGENTS.md"),
            })
        })
        .collect();
    let profils: Vec<Value> = ctx.reglages.vue()["profils"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| {
            json!({
                "id": p["id"], "name": p["nom"], "model": p["modele"],
                "default": p["defaut"].as_bool().unwrap_or(false),
            })
        })
        .collect();
    json!({"agents": agents, "unreadable": liste.erreurs, "colors": COULEURS, "profiles": profils})
        .to_string()
}

/// Nombre de graphèmes d'un avatar, sans dépendance : voir DEC-067.
fn graphemes(texte: &str) -> usize {
    let mut n = 0;
    let mut apres_zwj = false;
    let mut indicateur_seul = false;
    for c in texte.chars() {
        let u = c as u32;
        let colle = matches!(u, 0x200D | 0xFE0E | 0xFE0F | 0x1F3FB..=0x1F3FF)
            || matches!(u, 0x300..=0x36F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F);
        if colle {
            apres_zwj = u == 0x200D;
            continue;
        }
        if apres_zwj {
            apres_zwj = false;
            continue;
        }
        if (0x1F1E6..=0x1F1FF).contains(&u) {
            if indicateur_seul {
                indicateur_seul = false;
                continue;
            }
            indicateur_seul = true;
        } else {
            indicateur_seul = false;
        }
        n += 1;
    }
    n
}

fn facultatif<'a>(a: &'a Value, cle: &str) -> Result<Option<&'a str>, String> {
    match &a[cle] {
        Value::Null => Ok(None),
        Value::String(s) => Ok(Some(s)),
        _ => Err(format!("Invalid argument: {cle}.")),
    }
}

fn sauver_agent(a: &Value, ctx: &Contexte) -> Result<String, String> {
    let dossier = facultatif(a, "folder")?;
    let (nom, avatar, couleur, profil) = (
        facultatif(a, "name")?,
        facultatif(a, "avatar")?,
        facultatif(a, "color")?,
        facultatif(a, "profile")?,
    );
    let (persona, instructions) = (facultatif(a, "persona")?, facultatif(a, "instructions")?);
    let existant = match dossier {
        None => None,
        Some(d) => Some(
            ctx.agents
                .lire(d)
                .ok_or_else(|| format!("Unknown agent folder: {d}."))?,
        ),
    };
    if existant.is_none() && nom.is_none_or(|n| n.trim().is_empty()) {
        return Err("The name is required to create an agent.".into());
    }
    if avatar.is_some_and(|v| graphemes(v.trim()) > 2) {
        return Err("The avatar must be at most two characters.".into());
    }
    if couleur.is_some_and(|c| !COULEURS.contains(&c)) {
        return Err(format!(
            "Unknown color; allowed colors: {}.",
            COULEURS.join(", ")
        ));
    }
    let ids = ctx.reglages.ids_profils();
    if profil.is_some_and(|p| !p.is_empty() && !ids.iter().any(|i| i == p)) {
        return Err(format!(
            "Unknown profile; allowed profile ids: {}.",
            if ids.is_empty() {
                "none (use an empty string)".to_string()
            } else {
                ids.join(", ")
            }
        ));
    }
    let (e_nom, e_avatar, e_couleur, e_profil) = match &existant {
        Some(e) => (
            Some(e.nom.clone()),
            Some(e.avatar.clone()),
            Some(e.couleur.clone()),
            e.profil.clone(),
        ),
        None => (None, None, None, None),
    };
    let mut saisie = json!({
        "nom": nom.map(String::from).or(e_nom).unwrap_or_default(),
        "avatar": avatar.map(String::from).or(e_avatar).unwrap_or_default(),
        "couleur": couleur.map(String::from).or(e_couleur).unwrap_or("violet".into()),
        "profil": profil.map(String::from).or(e_profil).unwrap_or_default(),
    });
    if let Some(e) = &existant {
        saisie["dossier"] = e.dossier.clone().into();
    }
    let agent = ctx.agents.enregistrer(&saisie).map_err(|e| match e {
        Erreur::Champs(c) if c.contains(&"nom") => {
            "The name is empty or already used by another agent.".to_string()
        }
        Erreur::Champs(c) => format!("Invalid value for: {}.", c.join(", ")),
        Erreur::Inconnu => "Unknown agent folder.".into(),
        Erreur::Systeme(m) => m,
    })?;
    for (md, texte) in [("PERSONA.md", persona), ("AGENTS.md", instructions)] {
        if let Some(t) = texte {
            let f = ctx.projet.join(chemin_md(&agent.dossier, md));
            crate::config::ecrire_atomique(&f, t.as_bytes())?;
        }
    }
    Ok(json!({
        "folder": agent.dossier, "name": agent.nom, "avatar": agent.avatar,
        "color": agent.couleur, "profile": agent.profil.unwrap_or_default(),
    })
    .to_string())
}

fn phrase(e: fichiers::Erreur) -> String {
    use fichiers::Erreur::*;
    match e {
        Interdit => "The path is outside the project.".into(),
        Introuvable => "File not found.".into(),
        Binaire => "The file is binary.".into(),
        NonUtf8 => "The file is not valid UTF-8 text.".into(),
        TropGros => "The file is larger than 5 MB.".into(),
        Droits => "Permission denied.".into(),
        Existe | Conflit(_) => "The file changed meanwhile.".into(),
        Invalide(_) => "Invalid path, or a directory.".into(),
        Autre(m) => m,
    }
}

fn lire(
    projet: &Path,
    chemin: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String, String> {
    let (texte, _) = fichiers::lire(projet, chemin).map_err(phrase)?;
    if offset.is_none() && limit.is_none() {
        return Ok(texte);
    }
    let debut = offset.unwrap_or(1).max(1) - 1;
    let lignes = texte.split_inclusive('\n').skip(debut);
    Ok(match limit {
        Some(n) => lignes.take(n).collect(),
        None => lignes.collect(),
    })
}

fn remplacer(projet: &Path, chemin: &str, ancien: &str, nouveau: &str) -> Result<String, String> {
    let (texte, _) = fichiers::lire(projet, chemin).map_err(phrase)?;
    if ancien.is_empty() {
        return Err("The passage to replace is empty.".into());
    }
    match texte.matches(ancien).count() {
        0 => Err("The passage was not found in the file.".into()),
        1 => {
            let neuf = texte.replacen(ancien, nouveau, 1);
            fichiers::ecrire(projet, chemin, None, neuf.as_bytes()).map_err(phrase)?;
            Ok(format!("Edited {chemin}."))
        }
        n => Err(format!(
            "The passage appears {n} times in the file; give a longer, unique passage."
        )),
    }
}

async fn glob(projet: &Path, motif: &str) -> Result<String, String> {
    let m = globset::GlobBuilder::new(motif)
        .literal_separator(true)
        .build()
        .map_err(|_| "Invalid glob pattern.".to_string())?
        .compile_matcher();
    let racine = projet.to_path_buf();
    let tous = tokio::task::spawn_blocking(move || recherche::lister(&racine))
        .await
        .map_err(|e| e.to_string())?;
    let mut trouves: Vec<String> = tous.into_iter().filter(|c| m.is_match(c)).collect();
    if trouves.is_empty() {
        return Ok("No matching files.".into());
    }
    let trop = trouves.len() > CHEMINS_MAX;
    trouves.truncate(CHEMINS_MAX);
    let mut sortie = trouves.join("\n");
    if trop {
        sortie.push_str(&format!("\n[{CHEMINS_MAX} first matches]"));
    }
    Ok(sortie)
}

/// Tue tout le groupe de processus de la commande, à l'abandon comme à la fin.
struct Garde(i32);

impl Drop for Garde {
    fn drop(&mut self) {
        // SAFETY: un appel système sans pointeur ; `-pgid` vise le groupe créé pour la commande.
        unsafe {
            libc::kill(-self.0, libc::SIGKILL);
        }
    }
}

async fn bash(projet: &Path, commande: &str, limite: Duration) -> Resultat {
    let (mut lecteur, ecrivain) = match std::io::pipe() {
        Ok(p) => p,
        Err(e) => return echec(format!("Could not start the command: {e}")),
    };
    let ecrivain2 = match ecrivain.try_clone() {
        Ok(w) => w,
        Err(e) => return echec(format!("Could not start the command: {e}")),
    };
    let mut cmd = tokio::process::Command::new("/bin/sh");
    cmd.arg("-c")
        .arg(commande)
        .current_dir(projet)
        .stdin(Stdio::null())
        .stdout(Stdio::from(ecrivain))
        .stderr(Stdio::from(ecrivain2))
        .process_group(0)
        .kill_on_drop(true);
    let mut enfant = match cmd.spawn() {
        Ok(e) => e,
        Err(e) => return echec(format!("Could not start the command: {e}")),
    };
    // Les extrémités d'écriture ne doivent survivre que dans la commande.
    drop(cmd);
    let _garde = Garde(enfant.id().unwrap_or(0) as i32);

    // Lecture en continu : une sortie plus grande que le tube bloquerait la commande.
    let recu = Arc::new(Mutex::new((Vec::<u8>::new(), false)));
    let r = recu.clone();
    let lecture = std::thread::spawn(move || {
        let mut tampon = [0u8; 8192];
        while let Ok(n) = lecteur.read(&mut tampon) {
            if n == 0 {
                break;
            }
            let mut g = r.lock().unwrap();
            g.0.extend_from_slice(&tampon[..n]);
            if g.0.len() > 4 * SORTIE_MAX {
                let trop = g.0.len() - 2 * SORTIE_MAX;
                g.0.drain(..trop);
                g.1 = true;
            }
        }
    });

    let fin = tokio::time::timeout(limite, enfant.wait()).await;
    drop(_garde);
    // Le groupe est tué : la fin du tube suit. Un enfant sorti du groupe ne doit pas nous bloquer.
    for _ in 0..40 {
        if lecture.is_finished() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let (octets, coupe) = recu.lock().unwrap().clone();
    let texte = String::from_utf8_lossy(&octets);
    let total = texte.chars().count();
    let mut sortie = if coupe || total > SORTIE_MAX {
        let debut = texte
            .char_indices()
            .nth(total.saturating_sub(SORTIE_MAX))
            .map_or(0, |(i, _)| i);
        format!(
            "[output truncated: last {SORTIE_MAX} characters]\n{}",
            &texte[debut..]
        )
    } else {
        texte.into_owned()
    };
    if !sortie.is_empty() && !sortie.ends_with('\n') {
        sortie.push('\n');
    }
    match fin {
        Err(_) => {
            sortie.push_str(&format!("Command killed after {} s.", limite.as_secs()));
            echec(sortie)
        }
        Ok(Err(e)) => echec(format!("{sortie}Could not wait for the command: {e}")),
        Ok(Ok(statut)) => {
            let code = statut.code().unwrap_or(-1);
            sortie.push_str(&format!("Exit code: {code}"));
            Resultat {
                contenu: sortie,
                echec: code != 0,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use std::fs;

    fn dossier(nom: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("outils-{nom}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    fn ctx(projet: &Path) -> Contexte {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let reglages = Arc::new(Reglages::new(
            projet.join(".yaide"),
            projet.parent().unwrap().join(format!(
                "cfg-{}",
                projet.file_name().unwrap().to_string_lossy()
            )),
        ));
        let agents = Arc::new(Agents::new(projet.join(".yaide"), reglages.clone()));
        Contexte {
            projet: projet.to_path_buf(),
            client: reqwest::Client::new(),
            limites: Limites::default(),
            agents: agents.clone(),
            reglages,
        }
    }

    async fn lancer_outil(c: &Contexte, nom: &str, a: Value) -> Resultat {
        executer(nom, &a, c).await
    }

    fn vivant(pid: i32) -> bool {
        fs::read_to_string(format!("/proc/{pid}/stat"))
            .is_ok_and(|s| s.rsplit(") ").next().is_some_and(|r| !r.starts_with('Z')))
    }

    #[test]
    fn REQ107_AC4_argument_principal_de_knowledge_search() {
        assert_eq!(
            argument_principal(
                "knowledge_search",
                &json!({"query": "Comment se connecter ?", "collection": "notes"})
            ),
            "Comment se connecter ?"
        );
    }

    #[test]
    fn definitions_et_argument_principal() {
        let noms: Vec<String> = definitions().into_iter().map(|d| d.nom).collect();
        assert_eq!(
            noms,
            [
                "read",
                "write",
                "edit",
                "bash",
                "glob",
                "websearch",
                "webfetch",
                "list_agents",
                "save_agent",
                "subagent",
                "get_config",
                "save_provider",
                "save_profile",
                "save_mcp_server",
                "save_interface"
            ]
        );
        assert_eq!(argument_principal("bash", &json!({"command": "ls"})), "ls");
        // REQ100_AC7
        assert_eq!(
            argument_principal("subagent", &json!({"prompt": "Liste les tests lents"})),
            "Liste les tests lents"
        );
        assert_eq!(argument_principal("read", &json!({"path": "a.rs"})), "a.rs");
        assert_eq!(
            argument_principal("glob", &json!({"pattern": "*.rs"})),
            "*.rs"
        );
        assert_eq!(argument_principal("websearch", &json!({"query": "q"})), "q");
        assert_eq!(
            argument_principal("webfetch", &json!({"url": "http://x"})),
            "http://x"
        );
        assert_eq!(argument_principal("inconnu", &json!({})), "");
        // AC-097-6
        let a = |n: &str, v: Value| argument_principal(n, &v);
        assert_eq!(
            a("save_agent", json!({"name": "Relecteur", "folder": "x"})),
            "Relecteur"
        );
        assert_eq!(a("save_agent", json!({"folder": "relecteur"})), "relecteur");
        assert_eq!(a("list_agents", json!({})), "");
    }

    #[tokio::test]
    async fn outil_inconnu_ou_argument_manquant() {
        let d = dossier("inconnu");
        let c = ctx(&d);
        let r = lancer_outil(&c, "rm", json!({})).await;
        assert_eq!((r.echec, r.contenu.as_str()), (true, "Unknown tool: rm."));
        let r = lancer_outil(&c, "read", json!({})).await;
        assert!(r.echec && r.contenu.contains("path"), "{r:?}");
    }

    #[tokio::test]
    async fn REQ057_AC1_read_entier_et_tranche() {
        let d = dossier("read");
        fs::write(d.join("a.txt"), "un\ndeux\ntrois\nquatre\n").unwrap();
        let c = ctx(&d);
        let r = lancer_outil(&c, "read", json!({"path": "a.txt"})).await;
        assert_eq!(r, ok("un\ndeux\ntrois\nquatre\n".into()));
        let r = lancer_outil(
            &c,
            "read",
            json!({"path": "a.txt", "offset": 2, "limit": 2}),
        )
        .await;
        assert_eq!(r, ok("deux\ntrois\n".into()));
        let r = lancer_outil(&c, "read", json!({"path": "a.txt", "offset": 3})).await;
        assert_eq!(r, ok("trois\nquatre\n".into()));
        let r = lancer_outil(&c, "read", json!({"path": "a.txt", "limit": 1})).await;
        assert_eq!(r, ok("un\n".into()));
    }

    #[tokio::test]
    async fn REQ057_AC1_read_refus_binaire_gros_absent_hors_projet_lien() {
        let d = dossier("refus");
        fs::write(d.join("bin"), [1u8, 0, 2]).unwrap();
        fs::write(d.join("gros"), vec![b'a'; 5 * 1024 * 1024 + 1]).unwrap();
        fs::write(d.parent().unwrap().join("dehors-refus.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(d.parent().unwrap().join("dehors-refus.txt"), d.join("lien"))
            .unwrap();
        let c = ctx(&d);
        for (chemin, phrase) in [
            ("bin", "The file is binary."),
            ("gros", "The file is larger than 5 MB."),
            ("absent", "File not found."),
            ("../dehors-refus.txt", "The path is outside the project."),
            ("lien", "The path is outside the project."),
            ("/etc/passwd", "The path is outside the project."),
        ] {
            let r = lancer_outil(&c, "read", json!({"path": chemin})).await;
            assert_eq!(r, echec(phrase), "{chemin}");
        }
    }

    #[tokio::test]
    async fn REQ057_AC2_write_cree_les_parents_et_refuse_hors_projet() {
        let d = dossier("write");
        let c = ctx(&d);
        let r = lancer_outil(
            &c,
            "write",
            json!({"path": "a/b/c.txt", "content": "salut"}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        assert_eq!(fs::read_to_string(d.join("a/b/c.txt")).unwrap(), "salut");
        let r = lancer_outil(&c, "write", json!({"path": "a/b/c.txt", "content": "neuf"})).await;
        assert!(!r.echec);
        assert_eq!(fs::read_to_string(d.join("a/b/c.txt")).unwrap(), "neuf");
        let r = lancer_outil(
            &c,
            "write",
            json!({"path": "../hors-write.txt", "content": "x"}),
        )
        .await;
        assert_eq!(r, echec("The path is outside the project."));
        assert!(!d.parent().unwrap().join("hors-write.txt").exists());
        let r = lancer_outil(&c, "write", json!({"path": "a", "content": "x"})).await;
        assert_eq!(r, echec("The path is a directory."));
    }

    #[tokio::test]
    async fn REQ057_AC3_edit_unique_absent_multiple() {
        let d = dossier("edit");
        fs::write(d.join("f.txt"), "alpha beta alpha gamma").unwrap();
        let c = ctx(&d);
        let r = lancer_outil(
            &c,
            "edit",
            json!({"path": "f.txt", "old": "beta", "new": "BETA"}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        assert_eq!(
            fs::read_to_string(d.join("f.txt")).unwrap(),
            "alpha BETA alpha gamma"
        );
        let r = lancer_outil(
            &c,
            "edit",
            json!({"path": "f.txt", "old": "zzz", "new": "x"}),
        )
        .await;
        assert_eq!(r, echec("The passage was not found in the file."));
        let r = lancer_outil(
            &c,
            "edit",
            json!({"path": "f.txt", "old": "alpha", "new": "x"}),
        )
        .await;
        assert!(r.echec && r.contenu.contains("2 times"), "{r:?}");
        assert_eq!(
            fs::read_to_string(d.join("f.txt")).unwrap(),
            "alpha BETA alpha gamma"
        );
    }

    #[tokio::test]
    async fn REQ057_AC4_bash_sortie_ordonnee_et_code() {
        let d = dossier("bash");
        fs::write(d.join("marque"), "").unwrap();
        let c = ctx(&d);
        let r = lancer_outil(
            &c,
            "bash",
            json!({"command": "echo un; echo deux >&2; echo trois; ls"}),
        )
        .await;
        assert!(
            r.contenu.eq("un\ndeux\ntrois\nmarque\nExit code: 0"),
            "{r:?}"
        );
        let r = lancer_outil(&c, "bash", json!({"command": "echo ok"})).await;
        assert_eq!(r, ok("ok\nExit code: 0".into()));
        let r = lancer_outil(&c, "bash", json!({"command": "echo mal >&2; exit 3"})).await;
        assert_eq!(r, echec("mal\nExit code: 3"));
        let r = lancer_outil(&c, "bash", json!({"command": "pwd"})).await;
        assert_eq!(r, ok(format!("{}\nExit code: 0", d.display())));
    }

    #[tokio::test]
    async fn REQ057_AC4_bash_tue_apres_la_limite_avec_ses_enfants() {
        let d = dossier("limite");
        let mut c = ctx(&d);
        c.limites.bash = Duration::from_secs(1);
        let r = lancer_outil(
            &c,
            "bash",
            json!({"command": "echo debut; sleep 30 & echo $! > enfant; echo $$ > shell; sleep 30"}),
        )
        .await;
        assert_eq!(r, echec("debut\nCommand killed after 1 s."));
        for f in ["enfant", "shell"] {
            let pid: i32 = fs::read_to_string(d.join(f))
                .unwrap()
                .trim()
                .parse()
                .unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(!vivant(pid), "{f} ({pid}) vit encore");
        }
    }

    #[tokio::test]
    async fn REQ057_AC4_bash_abandon_tue_le_groupe() {
        let d = dossier("abandon");
        let c = ctx(&d);
        let projet = d.clone();
        let tache = tokio::spawn(async move {
            executer(
                "bash",
                &json!({"command": "sleep 30 & echo $! > enfant; sleep 30"}),
                &c,
            )
            .await
        });
        let mut pid = None;
        for _ in 0..100 {
            if let Ok(s) = fs::read_to_string(projet.join("enfant")) {
                if let Ok(p) = s.trim().parse::<i32>() {
                    pid = Some(p);
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let pid = pid.expect("la commande n'a pas démarré");
        assert!(vivant(pid));
        tache.abort();
        let _ = tache.await;
        for _ in 0..40 {
            if !vivant(pid) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("l'enfant {pid} vit encore après l'abandon");
    }

    #[tokio::test]
    async fn REQ057_AC4_sortie_coupee_garde_la_fin() {
        let d = dossier("coupe");
        let c = ctx(&d);
        let r = lancer_outil(&c, "bash", json!({"command": "seq 1 20000"})).await;
        assert!(!r.echec);
        let corps = r.contenu.strip_suffix("\nExit code: 0").unwrap();
        let (tete, reste) = corps.split_once('\n').unwrap();
        assert_eq!(tete, "[output truncated: last 30000 characters]");
        // 30 000 caractères de sortie, dont le saut de ligne final retiré avec « Exit code ».
        assert_eq!(reste.chars().count(), 29_999);
        assert!(
            reste.ends_with("\n19999\n20000"),
            "{:?}",
            &reste[reste.len() - 20..]
        );
        let r = lancer_outil(&c, "bash", json!({"command": "seq 1 100"})).await;
        assert!(!r.contenu.contains("truncated"));
    }

    #[tokio::test]
    async fn REQ057_AC5_glob_motif_sans_ignores_et_limite() {
        let d = dossier("glob");
        let git = |args: &[&str]| {
            assert!(std::process::Command::new("git")
                .args(args)
                .current_dir(&d)
                .output()
                .unwrap()
                .status
                .success())
        };
        git(&["init", "-q"]);
        fs::create_dir_all(d.join("src/sous")).unwrap();
        fs::create_dir_all(d.join("cible")).unwrap();
        for f in [
            "src/a.rs",
            "src/sous/b.rs",
            "src/c.txt",
            "cible/x.rs",
            "racine.rs",
        ] {
            fs::write(d.join(f), "").unwrap();
        }
        fs::write(d.join(".gitignore"), "cible/\n").unwrap();
        let c = ctx(&d);
        let r = lancer_outil(&c, "glob", json!({"pattern": "src/**/*.rs"})).await;
        assert_eq!(r, ok("src/a.rs\nsrc/sous/b.rs".into()));
        let r = lancer_outil(&c, "glob", json!({"pattern": "**/*.rs"})).await;
        assert_eq!(r, ok("racine.rs\nsrc/a.rs\nsrc/sous/b.rs".into()));
        let r = lancer_outil(&c, "glob", json!({"pattern": "*.zzz"})).await;
        assert_eq!(r, ok("No matching files.".into()));
        let r = lancer_outil(&c, "glob", json!({"pattern": "[a"})).await;
        assert_eq!(r, echec("Invalid glob pattern."));
        fs::create_dir_all(d.join("beaucoup")).unwrap();
        for i in 0..501 {
            fs::write(d.join(format!("beaucoup/f{i:03}.dat")), "").unwrap();
        }
        let r = lancer_outil(&c, "glob", json!({"pattern": "beaucoup/*.dat"})).await;
        let lignes: Vec<&str> = r.contenu.lines().collect();
        assert_eq!(lignes.len(), 501);
        assert_eq!(lignes[500], "[500 first matches]");
        assert_eq!(lignes[499], "beaucoup/f499.dat");
    }

    #[tokio::test]
    async fn outils_web_par_executer() {
        let d = dossier("web");
        let mut c = ctx(&d);
        c.limites.recherche = "http://127.0.0.1:1/html/".into();
        let r = lancer_outil(&c, "webfetch", json!({"url": "ftp://x"})).await;
        assert!(r.echec);
        let r = lancer_outil(&c, "websearch", json!({"query": "x"})).await;
        assert!(r.echec && r.contenu.starts_with("Request failed"), "{r:?}");
    }

    fn agent_json(d: &Path, dossier: &str) -> Value {
        let o = fs::read(d.join(".yaide/agents").join(dossier).join("agent.json")).unwrap();
        serde_json::from_slice(&o).unwrap()
    }

    fn md(d: &Path, dossier: &str, f: &str) -> String {
        fs::read_to_string(d.join(".yaide/agents").join(dossier).join(f)).unwrap()
    }

    #[tokio::test]
    async fn REQ097_AC2_list_agents() {
        let d = dossier("list-agents");
        let c = ctx(&d);
        let r = lancer_outil(&c, "list_agents", json!({})).await;
        let v: Value = serde_json::from_str(&r.contenu).unwrap();
        assert!(!r.echec);
        assert_eq!(v["agents"], json!([]));
        assert_eq!(
            v["colors"],
            json!(["violet", "vert", "orange", "rose", "sarcelle", "gris"])
        );
        assert!(!d.join(".yaide").exists());
        c.reglages
            .enregistrer_profil(
                &json!({"nom": "Rapide", "provider": "openai", "modele": "m1", "defaut": true}),
            )
            .unwrap();
        for (n, couleur) in [("Zèbre", "vert"), ("alpha", "rose")] {
            let r = lancer_outil(
                &c,
                "save_agent",
                json!({"name": n, "color": couleur, "avatar": "🦉"}),
            )
            .await;
            assert!(!r.echec, "{r:?}");
        }
        fs::create_dir_all(d.join(".yaide/agents/casse")).unwrap();
        fs::write(d.join(".yaide/agents/casse/agent.json"), "{").unwrap();
        let r = lancer_outil(&c, "list_agents", json!({})).await;
        let v: Value = serde_json::from_str(&r.contenu).unwrap();
        let a = v["agents"].as_array().unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(
            a[0],
            json!({"folder": "alpha", "name": "alpha", "avatar": "🦉", "color": "rose", "profile": "",
                "persona": ".yaide/agents/alpha/PERSONA.md", "instructions": ".yaide/agents/alpha/AGENTS.md"})
        );
        assert_eq!(a[1]["name"], "Zèbre");
        assert_eq!(v["unreadable"], json!([".yaide/agents/casse/agent.json"]));
        let p = &v["profiles"][0];
        assert_eq!(
            (p["name"].as_str(), p["model"].as_str()),
            (Some("Rapide"), Some("m1"))
        );
        assert_eq!(p["default"], true);
        assert!(p["id"].is_string());
        assert!(!r.contenu.contains("cle") && !r.contenu.contains("key"));
    }

    #[tokio::test]
    async fn REQ097_AC3_creation() {
        let d = dossier("save-creation");
        let c = ctx(&d);
        let r = lancer_outil(
            &c,
            "save_agent",
            json!({"name": "Relecteur", "persona": "persona-1", "instructions": "memoire-2"}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        let v: Value = serde_json::from_str(&r.contenu).unwrap();
        assert_eq!(v["folder"], "relecteur");
        let j = agent_json(&d, "relecteur");
        assert_eq!(
            (j["nom"].as_str(), j["couleur"].as_str()),
            (Some("Relecteur"), Some("violet"))
        );
        assert_eq!(j["avatar"], "");
        assert!(j.get("profil").is_none());
        assert_eq!(md(&d, "relecteur", "PERSONA.md"), "persona-1");
        assert_eq!(md(&d, "relecteur", "AGENTS.md"), "memoire-2");
        let r = lancer_outil(&c, "save_agent", json!({"name": "Autre"})).await;
        assert!(!r.echec, "{r:?}");
        assert_eq!(md(&d, "autre", "PERSONA.md"), "");
        assert_eq!(md(&d, "autre", "AGENTS.md"), "");
    }

    #[tokio::test]
    async fn REQ097_AC4_modification() {
        let d = dossier("save-modif");
        let c = ctx(&d);
        c.reglages
            .enregistrer_profil(&json!({"nom": "P", "provider": "openai", "modele": "m"}))
            .unwrap();
        let pid = c.reglages.ids_profils().remove(0);
        lancer_outil(
            &c,
            "save_agent",
            json!({"name": "Relecteur", "avatar": "QA", "profile": pid, "persona": "p", "instructions": "i"}),
        )
        .await;
        let avant = agent_json(&d, "relecteur");
        let r = lancer_outil(
            &c,
            "save_agent",
            json!({"folder": "relecteur", "color": "vert"}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        let mut attendu = avant.clone();
        attendu["couleur"] = "vert".into();
        assert_eq!(agent_json(&d, "relecteur"), attendu);
        assert_eq!(md(&d, "relecteur", "PERSONA.md"), "p");
        assert_eq!(md(&d, "relecteur", "AGENTS.md"), "i");
        let r = lancer_outil(
            &c,
            "save_agent",
            json!({"folder": "relecteur", "name": "Correcteur"}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        assert!(d.join(".yaide/agents/relecteur").is_dir());
        assert!(!d.join(".yaide/agents/correcteur").exists());
        assert_eq!(agent_json(&d, "relecteur")["nom"], "Correcteur");
        lancer_outil(
            &c,
            "save_agent",
            json!({"folder": "relecteur", "persona": "neuf"}),
        )
        .await;
        assert_eq!(md(&d, "relecteur", "PERSONA.md"), "neuf");
        assert_eq!(md(&d, "relecteur", "AGENTS.md"), "i");
        let r = lancer_outil(
            &c,
            "save_agent",
            json!({"folder": "relecteur", "profile": ""}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        assert!(agent_json(&d, "relecteur").get("profil").is_none());
    }

    #[tokio::test]
    async fn REQ097_AC5_refus_sans_rien_ecrire() {
        let d = dossier("save-refus");
        let c = ctx(&d);
        let r = lancer_outil(&c, "save_agent", json!({"name": "Relecteur"})).await;
        assert!(!r.echec);
        let instantane = |d: &Path| {
            let mut v = Vec::new();
            for e in walk(&d.join(".yaide")) {
                v.push((e.clone(), fs::read(&e).unwrap_or_default()));
            }
            v.sort();
            v
        };
        let avant = instantane(&d);
        let refus = [
            (json!({"persona": "x"}), "required"),
            (json!({"name": "  "}), "required"),
            (json!({"name": "RELECTEUR", "persona": "x"}), "already used"),
            (
                json!({"name": "N", "avatar": "ABC", "persona": "x"}),
                "avatar",
            ),
            (
                json!({"name": "N", "color": "bleu", "persona": "x"}),
                "violet, vert, orange, rose, sarcelle, gris",
            ),
            (
                json!({"name": "N", "profile": "zzz", "persona": "x"}),
                "Unknown profile",
            ),
            (
                json!({"folder": "inconnu", "persona": "x"}),
                "Unknown agent folder",
            ),
            (
                json!({"folder": "../x", "persona": "x"}),
                "Unknown agent folder",
            ),
            (
                json!({"folder": "relecteur", "name": 3}),
                "Invalid argument",
            ),
            (
                json!({"folder": "relecteur", "avatar": "ABC", "persona": "x"}),
                "avatar",
            ),
        ];
        for (a, mot) in refus {
            let r = lancer_outil(&c, "save_agent", a.clone()).await;
            assert!(r.echec && r.contenu.contains(mot), "{a} : {r:?}");
        }
        assert_eq!(instantane(&d), avant);
        assert!(!d.join(".yaide/agents/n").exists());
        for av in ["🦉", "QA", "👨‍👩‍👧", "🇫🇷", "👍🏽", "é"] {
            let r = lancer_outil(
                &c,
                "save_agent",
                json!({"name": format!("a{av}"), "avatar": av}),
            )
            .await;
            assert!(!r.echec, "{av} : {r:?}");
        }
        for av in ["🇫🇷🇫🇷🇫", "🦉🦉🦉", "ABC"] {
            let r = lancer_outil(&c, "save_agent", json!({"name": "z", "avatar": av})).await;
            assert!(r.echec, "{av}");
        }
    }

    fn walk(d: &Path) -> Vec<PathBuf> {
        let mut v = Vec::new();
        for e in fs::read_dir(d).into_iter().flatten().flatten() {
            if e.path().is_dir() {
                v.extend(walk(&e.path()));
            } else {
                v.push(e.path());
            }
        }
        v
    }
}
