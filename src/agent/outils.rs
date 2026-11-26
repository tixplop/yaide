//! Les dix-sept outils de l'agent (REQ-057, REQ-097, REQ-098, REQ-100, REQ-144). Une erreur d'outil n'est pas une erreur Rust :
//! elle part au modèle comme résultat (`echec`), en une phrase courte en anglais.

use super::agents::{Agents, COULEURS};
use super::jdiag;
use super::jdiag_controle;
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

const DESCRIPTION_WHITEBOARD: &str = "Create or replace a whiteboard file (.jdiag), with its parent folders. The whiteboard is refused, and nothing written, if it is not valid. Required keys: version (1), model, boxes, links; arrows (free arrows) is optional. model is a short text that says the essentials of the diagram: one line per element, then one line per relation (name the boxes by their id if useful), with no position and no style; it is required and must be updated at every write, so that it matches the drawing. Box: id, x, y (top-left corner, integer pixels), width, height (integers), text (lines separated by \\n), spans (optional parts of the text with their own style). Link: id, from, to (box ids), text (optional label shown on the link, with spans and textSize). Free arrow: id, x1, y1 (start), x2, y2 (end), integers. Ids are unique across all objects: b<n> for boxes, l<n> for links, a<n> for arrows, n starting at 1. Optional keys and their allowed values, the first one being the default: ";
const FIN_DESCRIPTION_WHITEBOARD: &str = ". align places the box text horizontally and valign vertically; the default valign is middle, except top for symbol shapes (database to sad); they apply to boxes only. A new box is 160x80 (circle 100x100, diamond 160x100, text 160x40). The shapes dot (16x16) and bar (120x8) have no text. A link may give fromSide and toSide together (top, right, bottom, left, center (the box center; the line stops at its border)). A span is {start, end, bold, italic, underline, strike, color}: start and end are positions in characters (not bytes), end excluded, spans must not overlap, and a link label needs a text before its spans. Lists go from the lowest object to the highest. To change a whiteboard, read it with whiteboard_read, then write it whole. The result of whiteboard_write lists layout warnings (estimated sizes; the file is written anyway): overlapping boxes, links over boxes, crossing or overlapping links, texts that overlap or overflow; fix them by moving or enlarging boxes or changing fromSide, toSide or route, then write again.";

fn valeurs_texte(style: &jdiag::Style) -> String {
    style
        .iter()
        .map(|(cle, valeurs)| {
            let v: Vec<String> = valeurs
                .iter()
                .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
                .collect();
            format!("{cle}: {}", v.join(" | "))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn description_whiteboard_write() -> String {
    format!(
        "{DESCRIPTION_WHITEBOARD}box {}; link and free arrow {}{FIN_DESCRIPTION_WHITEBOARD}",
        valeurs_texte(&jdiag::style_boite()),
        valeurs_texte(&jdiag::style_trait())
    )
}

fn schema_whiteboard() -> Value {
    let cote = json!({"type": "string", "enum": jdiag::COTES});
    let partie = json!({
        "type": "object",
        "properties": {
            "start": {"type": "integer"},
            "end": {"type": "integer"},
            "bold": {"type": "boolean"},
            "italic": {"type": "boolean"},
            "underline": {"type": "boolean"},
            "strike": {"type": "boolean"},
            "color": {"type": "string", "enum": jdiag::couleurs()},
        },
        "required": ["start", "end"],
    });
    let spans = json!({"type": "array", "items": partie});
    let objet = |entiers: &[&str], textes: &[&str], style: jdiag::Style, extra: Value| {
        let mut p = serde_json::Map::new();
        for c in textes {
            p.insert(c.to_string(), json!({"type": "string"}));
        }
        for c in entiers {
            p.insert(c.to_string(), json!({"type": "integer"}));
        }
        let mut requis: Vec<&str> = textes.iter().chain(entiers).copied().collect();
        requis.sort_by_key(|c| {
            [
                "id", "x", "y", "width", "height", "text", "from", "to", "x1", "y1", "x2", "y2",
            ]
            .iter()
            .position(|n| n == c)
        });
        for (c, v) in style {
            let type_ = if c == "opacity" { "integer" } else { "string" };
            p.insert(c.to_string(), json!({"type": type_, "enum": v}));
        }
        if let Value::Object(e) = extra {
            p.extend(e);
        }
        json!({"type": "object", "properties": p, "required": requis})
    };
    let boite = objet(
        &["x", "y", "width", "height"],
        &["id", "text"],
        jdiag::style_boite(),
        json!({"spans": spans}),
    );
    let lien = objet(
        &[],
        &["id", "from", "to"],
        jdiag::style_trait(),
        json!({
            "fromSide": cote,
            "toSide": cote,
            "text": {"type": "string"},
            "spans": spans,
            "textSize": {"type": "string", "enum": jdiag::style_boite()[5].1},
        }),
    );
    let libre = objet(
        &["x1", "y1", "x2", "y2"],
        &["id"],
        jdiag::style_trait(),
        json!({}),
    );
    json!({
        "type": "object",
        "description": "The whole whiteboard",
        "properties": {
            "version": {"type": "integer", "enum": [1]},
            "model": {"type": "string", "description": "Short text model of the diagram: one line per element, then one per relation; no position, no style"},
            "boxes": {"type": "array", "items": boite},
            "links": {"type": "array", "items": lien},
            "arrows": {"type": "array", "items": libre},
        },
        "required": ["version", "model", "boxes", "links"],
    })
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
            "whiteboard_read",
            "Read a whiteboard file (.jdiag) of the project and return it in the whiteboard format (see whiteboard_write), as Yaide writes it. An empty file is an empty whiteboard. To understand a diagram, first read its model alone with model_only: true; read the whole whiteboard to change it. The model may be older than a change made by hand in Yaide.",
            json!({"path": texte("Whiteboard path, relative to the project, ending with .jdiag"), "model_only": json!({"type": "boolean", "description": "true to return only the text model (default false: the whole whiteboard)"})}),
            &["path"],
        ),
        def(
            "whiteboard_write",
            &description_whiteboard_write(),
            json!({"path": texte("Whiteboard path, relative to the project, ending with .jdiag"), "whiteboard": schema_whiteboard()}),
            &["path", "whiteboard"],
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
            "Create a custom agent (without folder; name is required) or modify the agent of folder (an omitted argument keeps its value). persona and instructions replace the whole persona and instructions files. Custom agents are permanent: they are saved in the project and listed in the Agents panel. Use this tool only when the user explicitly asks to create or modify a custom agent, never to run a subagent or a task: use subagent for that.",
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
            "Run a temporary subagent. Use it when the user asks to launch, invoke or delegate work to subagents. It starts with an empty context, works alone on the prompt with the same tools as you (except subagent) and returns its final answer. Everything it needs must be in the prompt. Nothing is saved: a subagent is not a custom agent.",
            json!({"prompt": texte("The task for the subagent, with all the context it needs")}),
            &["prompt"],
        ),
        def(
            "run_workflow",
            "Start a published workflow of the project whose trigger is \"Appel par un agent\". It returns at once, without waiting for the end of the workflow and without its outputs. Fails if the workflow is already running.",
            json!({"name": texte("Workflow name, whatever the case"), "input": texte("Text given to the workflow as its input; empty by default")}),
            &["name"],
        ),
    ];
    outils.extend(outils_config::definitions());
    outils
}

/// Les outils intégrés d'un tour : ceux de l'agent, puis ceux de la base de connaissance
/// s'il y a une collection. Source unique du tour d'une conversation et du serveur MCP (REQ-189).
pub fn integres(projet: &Path) -> Vec<DefOutil> {
    let mut outils = definitions();
    outils.extend(definition_connaissance(projet));
    outils
}

/// Les outils `knowledge_list` et `knowledge_search` (REQ-107), relus à chaque tour : offerts
/// seulement si la configuration de la base se lit et qu'elle a au moins une collection.
pub fn definition_connaissance(projet: &Path) -> Vec<DefOutil> {
    let base = connaissance::Base::new(projet);
    if !matches!(base.lire_config(), Ok(Some(_))) {
        return Vec::new();
    }
    let Ok(liste) = base.liste() else {
        return Vec::new();
    };
    if liste.is_empty() {
        return Vec::new();
    }
    let noms: Vec<String> = liste.into_iter().map(|c| c.nom).collect();
    vec![
        def(
            "knowledge_list",
            "List the collections of the knowledge base of the project, one per line, with their number of files and passages.",
            json!({}),
            &[],
        ),
        def(
            "knowledge_search",
            &format!(
                "Search the knowledge base of the project, built from files added by the user. Returns the closest passages, closest first, each with its file and lines, collection, score and text; each collection sets how many passages it returns and their minimum score. Collections: {}.",
                noms.join(", ")
            ),
            json!({
                "query": json!({"type": "string", "description": "The question or the words to look for"}),
                "collections": json!({"type": "array", "items": {"type": "string"}, "description": "Collections to search; omit to search all of them"}),
            }),
            &["query"],
        ),
    ]
}

/// Les noms `#<nom>` des textes qui désignent une collection existante : nom enregistré,
/// sans doublon, par ordre alphabétique (REQ-108).
pub fn collections_nommees<'a>(
    projet: &Path,
    textes: impl Iterator<Item = &'a str>,
) -> Vec<String> {
    let base = connaissance::Base::new(projet);
    let mut noms: Vec<String> = Vec::new();
    for texte in textes {
        for mot in texte.split_whitespace() {
            if let Some(n) = mot.strip_prefix('#') {
                if let Ok(Some(exact)) = base.trouver(n) {
                    if !noms.contains(&exact) {
                        noms.push(exact);
                    }
                }
            }
        }
    }
    noms.sort();
    noms
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
        "read" | "write" | "edit" | "whiteboard_read" | "whiteboard_write" => "path",
        "bash" => "command",
        "glob" => "pattern",
        "websearch" => "query",
        "webfetch" => "url",
        "subagent" => "prompt",
        "run_workflow" => "name",
        "knowledge_search" => "query",
        "knowledge_list" => return String::new(),
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

fn chemin_jdiag(arguments: &Value) -> Result<&str, String> {
    let chemin = requis(arguments, "path")?;
    if !chemin.to_lowercase().ends_with(".jdiag") {
        return Err("The path must end with .jdiag.".into());
    }
    Ok(chemin)
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
        "whiteboard_read" => {
            let chemin = chemin_jdiag(a)?;
            let (texte, _) = fichiers::lire(projet, chemin).map_err(phrase)?;
            if a["model_only"].as_bool() == Some(true) {
                return Ok(ok(jdiag::modele_seul(&texte)?
                    .unwrap_or_else(|| format!("{chemin} has no model."))));
            }
            jdiag::relire(&texte).map(ok)
        }
        "whiteboard_write" => {
            let chemin = chemin_jdiag(a)?;
            if a["whiteboard"].is_null() {
                return Err("Missing or invalid argument: whiteboard.".into());
            }
            let (texte, [b, l, f]) = jdiag::en_texte(&a["whiteboard"])?;
            if a["whiteboard"]["model"]
                .as_str()
                .is_none_or(|m| m.trim().is_empty())
            {
                return Err(
                    "model: missing or empty; give a short text model of the diagram.".into(),
                );
            }
            if fichiers::resoudre(projet, chemin).map_err(phrase)?.is_dir() {
                return Err("The path is a directory.".into());
            }
            fichiers::ecrire(projet, chemin, None, texte.as_bytes()).map_err(phrase)?;
            let avertissements = serde_json::from_str::<Value>(&texte)
                .map(|w| jdiag_controle::bloc(&w))
                .unwrap_or_default();
            Ok(ok(format!(
                "Wrote {chemin}: {b} boxes, {l} links, {f} free arrows.{avertissements}"
            )))
        }
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
        "knowledge_list" => connaissance_lister(ctx).map(ok),
        "knowledge_search" => connaissance_chercher(requis(a, "query")?, &a["collections"], ctx)
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

/// Outil `knowledge_list` : une ligne par collection, sans requête au provider de la base.
fn connaissance_lister(ctx: &Contexte) -> Result<String, String> {
    let base = connaissance::Base::new(&ctx.projet);
    base.lire_config()?
        .ok_or("The knowledge base is not configured.")?;
    let mut liste = base.liste()?;
    liste.sort_by_key(|c| c.nom.to_lowercase());
    if liste.is_empty() {
        return Ok("No collection.".into());
    }
    let lignes: Vec<String> = liste
        .iter()
        .map(|c| {
            format!(
                "{}: {} file{}, {} passage{}",
                c.nom,
                c.fichiers,
                if c.fichiers == 1 { "" } else { "s" },
                c.passages,
                if c.passages == 1 { "" } else { "s" }
            )
        })
        .collect();
    Ok(lignes.join("\n"))
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
    let choisies: Vec<String> = match collection {
        Value::Null => Vec::new(),
        Value::Array(l) => {
            let mut v = Vec::new();
            for n in l {
                let n = n
                    .as_str()
                    .ok_or("Missing or invalid argument: collections.")?;
                match base.trouver(n)? {
                    Some(n) => v.push(n),
                    None => {
                        let noms: Vec<String> = base.liste()?.into_iter().map(|c| c.nom).collect();
                        return Err(format!(
                            "Unknown collection: {n}. Available: {}.",
                            noms.join(", ")
                        ));
                    }
                }
            }
            v
        }
        _ => return Err("Missing or invalid argument: collections.".into()),
    };
    let acces = connaissance::Acces {
        client: &ctx.client,
        provider,
        adresse: &adresse,
        cle: cle.as_deref(),
        modele: &config.modele,
    };
    let trouves = base
        .chercher(&acces, question, &choisies)
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
        saisie["declencheurs"] = serde_json::to_value(&e.declencheurs).unwrap_or_default();
    }
    let agent = ctx.agents.enregistrer(&saisie).map_err(|e| match e {
        Erreur::Champs(c) if c.contains(&"nom") => {
            "The name is empty or already used by another agent.".to_string()
        }
        Erreur::Champs(c) => format!("Invalid value for: {}.", c.join(", ")),
        Erreur::Declencheurs(..) => "Invalid triggers.".into(),
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
    fn REQ107_AC4_argument_principal_de_knowledge_list_vide() {
        assert_eq!(argument_principal("knowledge_list", &json!({})), "");
    }

    #[test]
    fn REQ108_AC6_AC7_AC8_recherche_des_noms_dans_les_textes() {
        let d = dossier("noms108");
        for n in ["notes", "Api"] {
            let c = d.join(".yaide/connaissance/collections").join(n);
            fs::create_dir_all(&c).unwrap();
            fs::write(c.join("passages.json"), "{}").unwrap();
        }
        let noms = |t: &[&str]| collections_nommees(&d, t.iter().copied());
        assert_eq!(noms(&["Que dit #notes sur la connexion ?"]), ["notes"]);
        assert_eq!(noms(&["#notes"]), ["notes"]);
        assert_eq!(noms(&["a\n#NOTES b", "voir #api"]), ["Api", "notes"]);
        assert_eq!(
            noms(&["issue#notes", "#inconnue", "sans", "notes#api"]),
            Vec::<String>::new()
        );
        assert_eq!(noms(&["#notes #notes"]), ["notes"]);
    }

    #[test]
    fn REQ107_AC4_argument_principal_de_knowledge_search() {
        assert_eq!(
            argument_principal(
                "knowledge_search",
                &json!({"query": "Comment se connecter ?", "collections": ["notes"]})
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
                "whiteboard_read",
                "whiteboard_write",
                "bash",
                "glob",
                "websearch",
                "webfetch",
                "list_agents",
                "save_agent",
                "subagent",
                "run_workflow",
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
        assert_eq!(a("run_workflow", json!({"name": "Revue"})), "Revue");
    }

    const DEUX: &str = "{\n  \"version\": 1,\n  \"boxes\": [\n    {\"id\": \"b1\", \"x\": 40, \"y\": 80, \"width\": 160, \"height\": 80, \"text\": \"Début\"},\n    {\"id\": \"b2\", \"x\": 300, \"y\": 80, \"width\": 160, \"height\": 80, \"text\": \"Fin\"}\n  ],\n  \"links\": [\n    {\"id\": \"l1\", \"from\": \"b1\", \"to\": \"b2\"}\n  ]\n}\n";
    const STYLES6: &str = "{\n  \"version\": 1,\n  \"boxes\": [\n    {\"id\": \"b1\", \"x\": 40, \"y\": 80, \"width\": 100, \"height\": 100, \"text\": \"Début\", \"shape\": \"ellipse\", \"color\": \"green\"},\n    {\"id\": \"b2\", \"x\": 300, \"y\": 80, \"width\": 160, \"height\": 80, \"text\": \"Fin\"}\n  ],\n  \"links\": [\n    {\"id\": \"l1\", \"from\": \"b1\", \"to\": \"b2\", \"fromSide\": \"right\", \"toSide\": \"left\", \"route\": \"orthogonal\", \"ends\": \"both\", \"line\": \"dashed\"}\n  ],\n  \"arrows\": [\n    {\"id\": \"a1\", \"x1\": 100, \"y1\": 300, \"x2\": 300, \"y2\": 300, \"ends\": \"none\"}\n  ]\n}\n";
    const STYLES9: &str = "{\n  \"version\": 1,\n  \"boxes\": [\n    {\"id\": \"b1\", \"x\": 40, \"y\": 80, \"width\": 160, \"height\": 80, \"text\": \"Début\", \"color\": \"blue\", \"line\": \"dashed\", \"weight\": \"thick\", \"opacity\": 50, \"textSize\": \"large\"},\n    {\"id\": \"b2\", \"x\": 300, \"y\": 80, \"width\": 160, \"height\": 80, \"text\": \"Fin\"}\n  ],\n  \"links\": [\n    {\"id\": \"l1\", \"from\": \"b1\", \"to\": \"b2\", \"color\": \"red\", \"weight\": \"medium\"}\n  ],\n  \"arrows\": [\n    {\"id\": \"a1\", \"x1\": 100, \"y1\": 300, \"x2\": 300, \"y2\": 300, \"line\": \"dotted\", \"color\": \"green\", \"weight\": \"thick\"}\n  ]\n}\n";

    /// Le texte attendu d'un fichier écrit par `whiteboard_write` : le modèle `m` après `version`.
    fn avec_m(s: &str) -> String {
        s.replacen(
            "\"version\": 1,\n",
            "\"version\": 1,\n  \"model\": \"m\",\n",
            1,
        )
    }

    async fn ecrire_wb(c: &Contexte, chemin: &str, texte: &str) -> Resultat {
        let mut w: Value = serde_json::from_str(texte).unwrap();
        if w.get("model").is_none() {
            w["model"] = json!("m");
        }
        lancer_outil(
            c,
            "whiteboard_write",
            json!({"path": chemin, "whiteboard": w}),
        )
        .await
    }

    #[test]
    fn REQ144_AC1_definitions_des_outils_whiteboard() {
        let defs = definitions();
        let noms: Vec<&str> = defs.iter().map(|d| d.nom.as_str()).collect();
        assert_eq!(noms[3..5], ["whiteboard_read", "whiteboard_write"]);
        let lecture = &defs[3];
        assert_eq!(lecture.schema["required"], json!(["path"]));
        let ecriture = &defs[4];
        assert_eq!(ecriture.schema["required"], json!(["path", "whiteboard"]));
        let wb = &ecriture.schema["properties"]["whiteboard"];
        assert_eq!(
            wb["required"],
            json!(["version", "model", "boxes", "links"])
        );
        let boite = &wb["properties"]["boxes"]["items"]["properties"];
        assert_eq!(boite["opacity"]["enum"], json!([100, 75, 50, 25, 0]));
        assert_eq!(
            boite["textSize"]["enum"],
            json!(["normal", "small", "large", "xlarge"])
        );
        assert_eq!(boite["align"]["enum"], json!(["center", "left", "right"]));
        assert_eq!(boite["valign"]["enum"], json!(["middle", "top", "bottom"]));
        assert!(ecriture
            .description
            .contains("align: center | left | right"));
        assert!(ecriture.description.contains("top for symbol shapes"));
        assert_eq!(boite["shape"]["enum"][5], "text");
        let formes = boite["shape"]["enum"].as_array().unwrap();
        assert_eq!(formes.len(), 33);
        assert_eq!(formes[6], "database");
        assert_eq!(formes[25], "firewall");
        assert_eq!(
            formes[26..],
            ["disk", "internet", "happy", "neutral", "sad", "dot", "bar"]
        );
        assert!(ecriture.description.contains("(database to sad)"));
        assert!(ecriture
            .description
            .contains("dot (16x16) and bar (120x8) have no text"));
        let lien = &wb["properties"]["links"]["items"]["properties"];
        assert_eq!(
            lien["route"]["enum"],
            json!(["direct", "orthogonal", "curved"])
        );
        assert_eq!(
            lien["fromSide"]["enum"],
            json!(["top", "right", "bottom", "left", "center"])
        );
        let libre = &wb["properties"]["arrows"]["items"];
        assert_eq!(libre["required"], json!(["id", "x1", "y1", "x2", "y2"]));
        for m in [
            "160x80",
            "b<n>",
            "l<n>",
            "a<n>",
            "read it with whiteboard_read, then write it whole",
            "top-left",
            "ends: end | none | start | both",
        ] {
            assert!(ecriture.description.contains(m), "{m}");
        }
    }

    const MODELE: &str = "Flux : Début → Fin.\nUne seule étape.";

    async fn ecrire_avec(c: &Contexte, chemin: &str, modele: Value) -> Resultat {
        let mut w: Value = serde_json::from_str(DEUX).unwrap();
        w.as_object_mut().unwrap().remove("model");
        if !modele.is_null() {
            w["model"] = modele;
        }
        lancer_outil(
            c,
            "whiteboard_write",
            json!({"path": chemin, "whiteboard": w}),
        )
        .await
    }

    #[tokio::test]
    async fn REQ151_AC1_model_ecrit_apres_version_et_relu() {
        let d = dossier("wb151a");
        let c = ctx(&d);
        let attendu = avec_m(DEUX).replace("\"m\"", &serde_json::to_string(MODELE).unwrap());
        assert!(attendu.contains("\"model\": \"Flux : Début → Fin.\\nUne seule étape.\","));
        let r = ecrire_avec(&c, "a.jdiag", json!(MODELE)).await;
        assert!(!r.echec, "{r:?}");
        assert_eq!(fs::read_to_string(d.join("a.jdiag")).unwrap(), attendu);
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "a.jdiag"})).await;
        assert_eq!(r, ok(attendu));
        // `model` donné après `links`, avec guillemet, antislash et émoji.
        let special = "a\"b\\c 😀";
        let mut w: Value = serde_json::from_str(DEUX).unwrap();
        w.as_object_mut().unwrap().remove("model");
        let mut texte = serde_json::to_string(&w).unwrap();
        texte.pop();
        texte.push_str(&format!(
            ",\"model\":{}}}",
            serde_json::to_string(special).unwrap()
        ));
        let w: Value = serde_json::from_str(&texte).unwrap();
        let r = lancer_outil(
            &c,
            "whiteboard_write",
            json!({"path": "b.jdiag", "whiteboard": w}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        let ecrit = fs::read_to_string(d.join("b.jdiag")).unwrap();
        assert!(ecrit.starts_with(&format!(
            "{{\n  \"version\": 1,\n  \"model\": {},\n  \"boxes\"",
            serde_json::to_string(special).unwrap()
        )));
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "b.jdiag"})).await;
        assert_eq!(r.contenu, ecrit);
    }

    #[tokio::test]
    async fn REQ151_AC2_model_obligatoire_a_l_ecriture() {
        let d = dossier("wb151b");
        let c = ctx(&d);
        fs::write(d.join("a.jdiag"), DEUX).unwrap();
        let cause = "model: missing or empty; give a short text model of the diagram.";
        for m in [Value::Null, json!(""), json!("  \n ")] {
            let r = ecrire_avec(&c, "a.jdiag", m.clone()).await;
            assert_eq!(r, echec(cause), "{m}");
            assert_eq!(fs::read_to_string(d.join("a.jdiag")).unwrap(), DEUX);
        }
        let r = lancer_outil(
            &c,
            "whiteboard_write",
            json!({"path": "b.jdiag", "whiteboard": {"version": 1, "boxes": [{"id": "b1", "x": 1, "y": 1, "height": 1, "text": ""}], "links": []}}),
        )
        .await;
        assert_eq!(r, echec("boxes[0]: missing or invalid width."));
        assert!(!d.join("b.jdiag").exists());
    }

    #[tokio::test]
    async fn REQ151_AC3_model_non_texte_refuse_par_les_deux_outils() {
        let d = dossier("wb151c");
        let c = ctx(&d);
        fs::write(d.join("a.jdiag"), DEUX).unwrap();
        for m in [json!(3), json!(["a"])] {
            let r = ecrire_avec(&c, "a.jdiag", m.clone()).await;
            assert_eq!(r, echec("model must be a text."), "{m}");
            assert_eq!(fs::read_to_string(d.join("a.jdiag")).unwrap(), DEUX);
            let mut w: Value = serde_json::from_str(DEUX).unwrap();
            w["model"] = m;
            fs::write(d.join("m.jdiag"), w.to_string()).unwrap();
            for a in [
                json!({"path": "m.jdiag"}),
                json!({"path": "m.jdiag", "model_only": true}),
            ] {
                let r = lancer_outil(&c, "whiteboard_read", a).await;
                assert_eq!(r, echec("model must be a text."));
            }
        }
        let vide = avec_m(DEUX).replace("\"m\"", "\"\"");
        fs::write(d.join("v.jdiag"), vide).unwrap();
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "v.jdiag"})).await;
        assert_eq!(r, ok(DEUX.into()));
    }

    #[tokio::test]
    async fn REQ151_AC4_model_only() {
        let d = dossier("wb151d");
        let c = ctx(&d);
        ecrire_avec(&c, "docs/a.jdiag", json!(MODELE)).await;
        let lire = |a: Value| lancer_outil(&c, "whiteboard_read", a);
        assert_eq!(
            lire(json!({"path": "docs/a.jdiag", "model_only": true})).await,
            ok(MODELE.into())
        );
        let entier = fs::read_to_string(d.join("docs/a.jdiag")).unwrap();
        for a in [
            json!({"path": "docs/a.jdiag", "model_only": false}),
            json!({"path": "docs/a.jdiag"}),
        ] {
            assert_eq!(lire(a).await, ok(entier.clone()));
        }
        let sans = DEUX;
        fs::write(d.join("docs/plan.jdiag"), sans).unwrap();
        assert_eq!(
            lire(json!({"path": "docs/plan.jdiag", "model_only": true})).await,
            ok("docs/plan.jdiag has no model.".into())
        );
        fs::write(d.join("vide.jdiag"), "").unwrap();
        assert_eq!(
            lire(json!({"path": "vide.jdiag", "model_only": true})).await,
            ok("vide.jdiag has no model.".into())
        );
        fs::write(d.join("x.jdiag"), r#"{"version":2,"boxes":[],"links":[]}"#).unwrap();
        assert_eq!(
            lire(json!({"path": "x.jdiag", "model_only": true})).await,
            echec("version must be 1.")
        );
    }

    #[test]
    fn REQ151_AC5_definitions_model_et_descriptions() {
        let defs = definitions();
        let lecture = defs.iter().find(|d| d.nom == "whiteboard_read").unwrap();
        assert_eq!(lecture.schema["required"], json!(["path"]));
        assert_eq!(
            lecture.schema["properties"]["model_only"]["type"],
            "boolean"
        );
        for m in ["model_only", "older than a change made by hand"] {
            assert!(lecture.description.contains(m), "{m}");
        }
        let ecriture = defs.iter().find(|d| d.nom == "whiteboard_write").unwrap();
        let wb = &ecriture.schema["properties"]["whiteboard"];
        assert_eq!(wb["properties"]["model"]["type"], "string");
        assert_eq!(
            wb["required"],
            json!(["version", "model", "boxes", "links"])
        );
        for m in [
            "model is a short text",
            "one line per element",
            "no position and no style",
            "required and must be updated at every write",
        ] {
            assert!(ecriture.description.contains(m), "{m}");
        }
    }

    #[tokio::test]
    async fn REQ148_AC1_avertissements_dans_le_resultat() {
        let d = dossier("wb148");
        let c = ctx(&d);
        let proche = DEUX.replace("\"x\": 300", "\"x\": 150").replace(
            "\"y\": 80, \"width\": 160, \"height\": 80, \"text\": \"Fin",
            "\"y\": 100, \"width\": 160, \"height\": 80, \"text\": \"Fin",
        );
        let r = ecrire_wb(&c, "docs/plan.jdiag", &proche).await;
        assert_eq!(
            r,
            ok("Wrote docs/plan.jdiag: 2 boxes, 1 links, 0 free arrows.\nLayout warnings (estimated sizes; the file was written):\n- Boxes b1 and b2 overlap.".into())
        );
        assert_eq!(
            fs::read_to_string(d.join("docs/plan.jdiag")).unwrap(),
            avec_m(&proche)
        );
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "docs/plan.jdiag"})).await;
        assert_eq!(r.contenu, avec_m(&proche));
        let d = description_whiteboard_write();
        assert!(d.contains("layout warnings (estimated sizes; the file is written anyway)"));
        assert!(d.contains("fromSide, toSide or route"));
    }

    #[tokio::test]
    async fn REQ144_AC2_ecriture_exacte_et_resultat() {
        let d = dossier("wb2");
        let c = ctx(&d);
        let r = ecrire_wb(&c, "docs/plan.jdiag", DEUX).await;
        assert_eq!(
            r,
            ok("Wrote docs/plan.jdiag: 2 boxes, 1 links, 0 free arrows.".into())
        );
        assert_eq!(
            fs::read_to_string(d.join("docs/plan.jdiag")).unwrap(),
            avec_m(DEUX)
        );
        let r = ecrire_wb(&c, "docs/plan.jdiag", STYLES6).await;
        assert_eq!(
            r,
            ok("Wrote docs/plan.jdiag: 2 boxes, 1 links, 1 free arrows.".into())
        );
        assert_eq!(
            fs::read_to_string(d.join("docs/plan.jdiag")).unwrap(),
            avec_m(STYLES6)
        );
        ecrire_wb(&c, "docs/plan.jdiag", STYLES9).await;
        assert_eq!(
            fs::read_to_string(d.join("docs/plan.jdiag")).unwrap(),
            avec_m(STYLES9)
        );
    }

    #[tokio::test]
    async fn REQ150_AC7_position_du_texte() {
        let d = dossier("wb150");
        let c = ctx(&d);
        let boite = |id: &str, extra: &str| {
            format!(
                "{{\"id\": \"{id}\", \"x\": 0, \"y\": 0, \"width\": 100, \"height\": 100, \"text\": \"a\"{extra}}}"
            )
        };
        let attendu = |boites: Vec<String>| {
            format!(
                "{{\n  \"version\": 1,\n  \"model\": \"m\",\n  \"boxes\": [\n    {}\n  ],\n  \"links\": []\n}}\n",
                boites.join(",\n    ")
            )
        };
        let entree = r#"{"version":1,"links":[],"boxes":[
            {"id":"b1","x":0,"y":0,"width":100,"height":100,"text":"a","valign":"bottom","align":"right","textSize":"large"},
            {"id":"b2","x":0,"y":0,"width":100,"height":100,"text":"a","shape":"database","valign":"top","align":"center"},
            {"id":"b3","x":0,"y":0,"width":100,"height":100,"text":"a","shape":"database","valign":"middle"},
            {"id":"b4","x":0,"y":0,"width":100,"height":100,"text":"a","valign":"middle","align":"center"}]}"#;
        let r = ecrire_wb(&c, "p.jdiag", entree).await;
        assert!(!r.echec, "{r:?}");
        let voulu = attendu(vec![
            boite(
                "b1",
                ", \"textSize\": \"large\", \"align\": \"right\", \"valign\": \"bottom\"",
            ),
            boite("b2", ", \"shape\": \"database\""),
            boite("b3", ", \"shape\": \"database\", \"valign\": \"middle\""),
            boite("b4", ""),
        ]);
        assert_eq!(fs::read_to_string(d.join("p.jdiag")).unwrap(), voulu);
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "p.jdiag"})).await;
        assert_eq!(r.contenu, voulu);
        // Sur un lien ou une flèche libre, les deux clés sont ignorées et non réécrites.
        let avec = r#"{"version":1,"boxes":[{"id":"b1","x":40,"y":80,"width":160,"height":80,"text":"Début"},
            {"id":"b2","x":300,"y":80,"width":160,"height":80,"text":"Fin"}],
            "links":[{"id":"l1","from":"b1","to":"b2","align":"left","valign":"top"}],
            "arrows":[{"id":"a1","x1":1,"y1":1,"x2":2,"y2":2,"align":"left","valign":"bottom"}]}"#;
        let r = ecrire_wb(&c, "q.jdiag", avec).await;
        assert!(!r.echec, "{r:?}");
        let ecrit = fs::read_to_string(d.join("q.jdiag")).unwrap();
        assert!(!ecrit.contains("align"), "{ecrit}");
    }

    #[tokio::test]
    async fn REQ144_AC3_defauts_ordre_et_cle_inconnue() {
        let d = dossier("wb3");
        let c = ctx(&d);
        let desordre = r#"{"links":[{"to":"b2","from":"b1","id":"l1","route":"direct","ends":"end","line":"solid","couleur":"x"}],
            "arrows":[],"boxes":[{"text":"Début","couleur":"rose","height":80,"width":160,"y":80,"x":40,"id":"b1","shape":"rectangle","opacity":100},
            {"id":"b2","x":300,"y":80,"width":160,"height":80,"text":"Fin","weight":"thin","textSize":"normal","color":"default"}],"version":1}"#;
        let r = ecrire_wb(&c, "a.jdiag", desordre).await;
        assert!(!r.echec, "{r:?}");
        assert_eq!(fs::read_to_string(d.join("a.jdiag")).unwrap(), avec_m(DEUX));
        let texte = "a\"b\\c\nd";
        let w = json!({"version": 1, "model": "m", "boxes": [{"id": "b1", "x": 1, "y": 2, "width": 3, "height": 4, "text": texte}], "links": []});
        lancer_outil(
            &c,
            "whiteboard_write",
            json!({"path": "b.jdiag", "whiteboard": w}),
        )
        .await;
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "b.jdiag"})).await;
        let relu: Value = serde_json::from_str(&r.contenu).unwrap();
        assert_eq!(relu["boxes"][0]["text"], texte);
        assert!(fs::read_to_string(d.join("b.jdiag"))
            .unwrap()
            .contains(r#""text": "a\"b\\c\nd""#));
    }

    #[tokio::test]
    async fn REQ132_AC15_symboles_lus_et_ecrits_a_l_identique() {
        let d = dossier("wb15");
        let c = ctx(&d);
        let fichier = "{\n  \"version\": 1,\n  \"model\": \"m\",\n  \"boxes\": [\n    {\"id\": \"b1\", \"x\": 1, \"y\": 2, \"width\": 100, \"height\": 100, \"text\": \"Clients\", \"shape\": \"database\", \"color\": \"green\"}\n  ],\n  \"links\": []\n}\n";
        fs::write(d.join("s.jdiag"), fichier).unwrap();
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "s.jdiag"})).await;
        let w: Value = serde_json::from_str(&r.contenu).unwrap();
        assert_eq!(w["boxes"][0]["shape"], "database");
        fs::remove_file(d.join("s.jdiag")).unwrap();
        lancer_outil(
            &c,
            "whiteboard_write",
            json!({"path": "s.jdiag", "whiteboard": w}),
        )
        .await;
        assert_eq!(fs::read_to_string(d.join("s.jdiag")).unwrap(), fichier);
        let mauvais = json!({"version": 1, "boxes": [{"id": "b1", "x": 1, "y": 1, "width": 1, "height": 1, "text": "", "shape": "router"}], "links": []});
        let r = lancer_outil(
            &c,
            "whiteboard_write",
            json!({"path": "t.jdiag", "whiteboard": mauvais}),
        )
        .await;
        assert!(!d.join("t.jdiag").exists(), "{}", r.contenu);
    }

    #[tokio::test]
    async fn REQ132_AC11_bout_de_lien_au_centre() {
        let d = dossier("wb11");
        let c = ctx(&d);
        let centre = STYLES6.replace(
            "\"fromSide\": \"right\", \"toSide\": \"left\"",
            "\"fromSide\": \"center\", \"toSide\": \"center\"",
        );
        assert_ne!(centre, STYLES6);
        let r = ecrire_wb(&c, "c.jdiag", &centre).await;
        assert!(!r.echec, "{r:?}");
        assert_eq!(
            fs::read_to_string(d.join("c.jdiag")).unwrap(),
            avec_m(&centre)
        );
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "c.jdiag"})).await;
        assert_eq!(r, ok(avec_m(&centre)));
        let milieu = STYLES6.replace("\"toSide\": \"left\"", "\"toSide\": \"middle\"");
        let r = ecrire_wb(&c, "m.jdiag", &milieu).await;
        assert!(
            r.echec
                && r.contenu
                    .starts_with("links[0]: fromSide and toSide go together"),
            "{r:?}"
        );
        assert!(r
            .contenu
            .contains("center (the box center; the line stops at its border)"));
        assert!(!d.join("m.jdiag").exists());
    }

    #[tokio::test]
    async fn REQ144_AC4_lecture_normalisee_et_fichier_vide() {
        let d = dossier("wb4");
        let c = ctx(&d);
        fs::write(d.join("a.jdiag"), DEUX).unwrap();
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "a.jdiag"})).await;
        assert_eq!(r, ok(DEUX.into()));
        let ligne = r#"{"version":1,"boxes":[{"id":"b1","x":40,"y":80,"width":160,"height":80,"text":"Début","couleur":"x"},{"id":"b2","x":300,"y":80,"width":160,"height":80,"text":"Fin"}],"links":[{"id":"l1","from":"b1","to":"b2"}]}"#;
        fs::write(d.join("b.jdiag"), ligne).unwrap();
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "b.jdiag"})).await;
        assert_eq!(r, ok(DEUX.into()));
        fs::write(d.join("vide.jdiag"), "").unwrap();
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "vide.jdiag"})).await;
        assert_eq!(
            r,
            ok("{\n  \"version\": 1,\n  \"boxes\": [],\n  \"links\": []\n}\n".into())
        );
    }

    #[tokio::test]
    async fn REQ147_AC10_texte_de_lien_blanc_ecrit_sans_texte() {
        let d = dossier("wb147");
        let c = ctx(&d);
        let blanc = r#"{"version":1,"model":"m","boxes":[{"id":"b1","x":40,"y":80,"width":160,"height":80,"text":"Début"},{"id":"b2","x":300,"y":80,"width":160,"height":80,"text":"Fin"}],"links":[{"id":"l1","from":"b1","to":"b2","text":"  \n","spans":[{"start":0,"end":1,"bold":true}]}]}"#;
        let r = lancer_outil(
            &c,
            "whiteboard_write",
            json!({"path": "a.jdiag", "whiteboard": serde_json::from_str::<Value>(blanc).unwrap()}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        let f = fs::read_to_string(d.join("a.jdiag")).unwrap();
        assert!(
            f.contains(r#"{"id": "l1", "from": "b1", "to": "b2"}"#),
            "{f}"
        );
        assert!(!f.contains("spans") && !f.contains("\"text\": \"  "), "{f}");
        fs::write(d.join("b.jdiag"), blanc).unwrap();
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "b.jdiag"})).await;
        assert_eq!(r, ok(f));
        // Texte avec espaces autour : gardé.
        let garde = blanc.replace(r#""text":"  \n""#, r#""text":" par mail ""#);
        let (t, _) =
            crate::agent::jdiag::en_texte(&serde_json::from_str::<Value>(&garde).unwrap()).unwrap();
        assert!(t.contains(r#""text": " par mail ""#), "{t}");
    }

    /// Les objets illisibles d'AC-132-4, -7 et -10, avec la cause attendue.
    fn illisibles() -> Vec<(&'static str, &'static str)> {
        vec![
            (
                r#"{"version":2,"boxes":[],"links":[]}"#,
                "version must be 1.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"height":1,"text":""}],"links":[]}"#,
                "boxes[0]: missing or invalid width.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":"40","y":1,"width":1,"height":1,"text":""}],"links":[]}"#,
                "boxes[0]: missing or invalid x.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":""},{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":""}],"links":[]}"#,
                "duplicate id b1.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":""}],"links":[{"id":"l1","from":"b1","to":"b9"}]}"#,
                "links[0]: unknown box b9.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":"","shape":"triangle"}],"links":[]}"#,
                "boxes[0]: invalid shape.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":""}],"links":[{"id":"l1","from":"b1","to":"b1","route":"zigzag"}]}"#,
                "links[0]: invalid route.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":""}],"links":[{"id":"l1","from":"b1","to":"b1","fromSide":"right"}]}"#,
                "links[0]: fromSide and toSide go together",
            ),
            (
                r#"{"version":1,"boxes":[],"links":[],"arrows":{}}"#,
                "arrows must be a list.",
            ),
            (
                r#"{"version":1,"boxes":[],"links":[],"arrows":[{"id":"a1","x1":"1","y1":1,"x2":1,"y2":1}]}"#,
                "arrows[0]: missing or invalid x1.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":""}],"links":[{"id":"l1","from":"b1","to":"b1"}],"arrows":[{"id":"l1","x1":1,"y1":1,"x2":1,"y2":1}]}"#,
                "duplicate id l1.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":"","weight":"huge"}],"links":[]}"#,
                "boxes[0]: invalid weight.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":"","opacity":30}],"links":[]}"#,
                "boxes[0]: invalid opacity.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":"","opacity":"50"}],"links":[]}"#,
                "boxes[0]: invalid opacity.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":"","textSize":"tiny"}],"links":[]}"#,
                "boxes[0]: invalid textSize.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":"","align":"justify"}],"links":[]}"#,
                "boxes[0]: invalid align.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":"","valign":3}],"links":[]}"#,
                "boxes[0]: invalid valign.",
            ),
            (
                r#"{"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":""}],"links":[{"id":"l1","from":"b1","to":"b1","color":"pink"}]}"#,
                "links[0]: invalid color.",
            ),
            (
                r#"{"version":1,"boxes":[],"links":[],"arrows":[{"id":"a1","x1":1,"y1":1,"x2":1,"y2":1,"weight":2}]}"#,
                "arrows[0]: invalid weight.",
            ),
            ("[]", "The whiteboard must be an object."),
        ]
    }

    #[tokio::test]
    async fn REQ144_AC5_refus_de_whiteboards_illisibles() {
        let d = dossier("wb5");
        let c = ctx(&d);
        fs::write(d.join("a.jdiag"), DEUX).unwrap();
        for (texte, cause) in illisibles() {
            let w: Value = serde_json::from_str(texte).unwrap();
            let r = lancer_outil(
                &c,
                "whiteboard_write",
                json!({"path": "a.jdiag", "whiteboard": w}),
            )
            .await;
            assert!(r.echec && r.contenu.starts_with(cause), "{texte} -> {r:?}");
            assert_eq!(fs::read_to_string(d.join("a.jdiag")).unwrap(), DEUX);
            fs::write(d.join("m.jdiag"), texte).unwrap();
            let r = lancer_outil(&c, "whiteboard_read", json!({"path": "m.jdiag"})).await;
            assert!(r.echec && r.contenu.starts_with(cause), "{texte} -> {r:?}");
        }
        for w in [json!([]), json!("pas du json")] {
            let r = lancer_outil(
                &c,
                "whiteboard_write",
                json!({"path": "a.jdiag", "whiteboard": w}),
            )
            .await;
            assert_eq!(r, echec("The whiteboard must be an object."));
        }
        fs::write(d.join("m.jdiag"), "pas du json").unwrap();
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "m.jdiag"})).await;
        assert_eq!(r, echec("The file is not valid JSON."));
        assert_eq!(fs::read_to_string(d.join("a.jdiag")).unwrap(), DEUX);
    }

    const SPANS12: &str = "{\n  \"version\": 1,\n  \"boxes\": [\n    {\"id\": \"b1\", \"x\": 40, \"y\": 80, \"width\": 160, \"height\": 80, \"text\": \"Début du flux\", \"spans\": [{\"start\": 0, \"end\": 5, \"bold\": true, \"color\": \"red\"}, {\"start\": 9, \"end\": 13, \"italic\": true, \"underline\": true, \"strike\": true}]},\n    {\"id\": \"b2\", \"x\": 300, \"y\": 80, \"width\": 160, \"height\": 80, \"text\": \"Fin\"}\n  ],\n  \"links\": [\n    {\"id\": \"l1\", \"from\": \"b1\", \"to\": \"b2\", \"color\": \"red\", \"text\": \"par mail\", \"spans\": [{\"start\": 4, \"end\": 8, \"bold\": true}], \"textSize\": \"large\"}\n  ]\n}\n";

    fn boite_spans(texte: &str, spans: Value) -> String {
        json!({"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":texte,"spans":spans}],"links":[]}).to_string()
    }

    fn lien_avec(extra: Value) -> String {
        let mut l = json!({"id":"l1","from":"b1","to":"b2"});
        l.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        json!({"version":1,"boxes":[{"id":"b1","x":1,"y":1,"width":1,"height":1,"text":""},{"id":"b2","x":1,"y":1,"width":1,"height":1,"text":""}],"links":[l]}).to_string()
    }

    #[test]
    fn REQ144_AC8_schema_des_parties_du_texte() {
        let defs = definitions();
        let ecriture = defs.iter().find(|d| d.nom == "whiteboard_write").unwrap();
        let wb = &ecriture.schema["properties"]["whiteboard"]["properties"];
        let couleurs = json!(["default", "blue", "green", "yellow", "orange", "red", "purple"]);
        for objets in ["boxes", "links"] {
            let spans = &wb[objets]["items"]["properties"]["spans"];
            assert_eq!(spans["type"], "array", "{objets}");
            let p = &spans["items"]["properties"];
            assert_eq!(p["start"]["type"], "integer");
            assert_eq!(p["end"]["type"], "integer");
            for b in ["bold", "italic", "underline", "strike"] {
                assert_eq!(p[b]["type"], "boolean", "{b}");
            }
            assert_eq!(p["color"]["enum"], couleurs);
        }
        let lien = &wb["links"]["items"]["properties"];
        assert_eq!(lien["text"]["type"], "string");
        assert_eq!(
            lien["textSize"]["enum"],
            json!(["normal", "small", "large", "xlarge"])
        );
        assert!(wb["boxes"]["items"]["properties"].get("text").is_some());
        assert!(wb["arrows"]["items"]["properties"].get("text").is_none());
        assert!(ecriture.description.contains("positions in characters"));
        assert!(ecriture.description.contains("end excluded"));
    }

    #[tokio::test]
    async fn REQ144_AC8_ecriture_et_lecture_des_parties_du_texte() {
        let d = dossier("wb8");
        let c = ctx(&d);
        ecrire_wb(&c, "a.jdiag", SPANS12).await;
        assert_eq!(
            fs::read_to_string(d.join("a.jdiag")).unwrap(),
            avec_m(SPANS12)
        );
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "a.jdiag"})).await;
        assert!(!r.echec);
        assert_eq!(r.contenu, avec_m(SPANS12));
        // AC-132-13 : autre ordre, parties qui se touchent, défauts, partie sans style, liste vide.
        let autre = SPANS12
            .replace(
                "\"spans\": [{\"start\": 0, \"end\": 5, \"bold\": true, \"color\": \"red\"}, {\"start\": 9, \"end\": 13, \"italic\": true, \"underline\": true, \"strike\": true}]",
                "\"spans\": [{\"start\": 9, \"end\": 13, \"strike\": true, \"italic\": true, \"underline\": true, \"bold\": false, \"color\": \"default\"}, {\"start\": 6, \"end\": 8, \"italic\": false}, {\"start\": 2, \"end\": 5, \"bold\": true, \"color\": \"red\"}, {\"start\": 0, \"end\": 2, \"color\": \"red\", \"bold\": true, \"inconnue\": 1}]",
            )
            .replace("\"text\": \"Fin\"}", "\"text\": \"Fin\", \"spans\": []}");
        let mut w: Value = serde_json::from_str(&autre).unwrap();
        w["model"] = json!("m");
        let r = lancer_outil(
            &c,
            "whiteboard_write",
            json!({"path": "b.jdiag", "whiteboard": w}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        assert_eq!(
            fs::read_to_string(d.join("b.jdiag")).unwrap(),
            avec_m(SPANS12)
        );
        fs::write(d.join("c.jdiag"), &autre).unwrap();
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "c.jdiag"})).await;
        assert_eq!(r.contenu, SPANS12);
        // Un lien sans texte est réécrit sans `text`.
        let r = ecrire_wb(&c, "d.jdiag", &lien_avec(json!({"text": ""}))).await;
        assert!(!r.echec, "{r:?}");
        assert!(fs::read_to_string(d.join("d.jdiag"))
            .unwrap()
            .contains("\"to\": \"b2\"}"));
        // Positions en caractères Unicode.
        let emoji = boite_spans("A😀B", json!([{"start": 2, "end": 3, "bold": true}]));
        let r = ecrire_wb(&c, "e.jdiag", &emoji).await;
        assert!(!r.echec, "{r:?}");
        assert!(fs::read_to_string(d.join("e.jdiag")).unwrap().contains(
            "\"text\": \"A😀B\", \"spans\": [{\"start\": 2, \"end\": 3, \"bold\": true}]}"
        ));
        // Une flèche libre qui porte text, spans ou textSize les voit ignorés.
        let libre = r#"{"version":1,"boxes":[],"links":[],"arrows":[{"id":"a1","x1":1,"y1":1,"x2":2,"y2":2,"text":3,"spans":{},"textSize":"tiny"}]}"#;
        let r = ecrire_wb(&c, "f.jdiag", libre).await;
        assert!(!r.echec, "{r:?}");
        assert!(!fs::read_to_string(d.join("f.jdiag"))
            .unwrap()
            .contains("text"));
    }

    #[tokio::test]
    async fn REQ144_AC8_refus_des_parties_du_texte() {
        let d = dossier("wb8r");
        let c = ctx(&d);
        fs::write(d.join("a.jdiag"), DEUX).unwrap();
        let t = "Début du flux";
        let refus = [
            (
                boite_spans(t, json!([{"start": 0, "end": 14, "bold": true}])),
                "boxes[0]: invalid spans.",
            ),
            (
                boite_spans(t, json!([{"start": 5, "end": 5, "bold": true}])),
                "boxes[0]: invalid spans.",
            ),
            (
                boite_spans(t, json!([{"start": -1, "end": 3, "bold": true}])),
                "boxes[0]: invalid spans.",
            ),
            (
                boite_spans(
                    t,
                    json!([{"start": 0, "end": 5, "bold": true}, {"start": 3, "end": 8, "italic": true}]),
                ),
                "boxes[0]: invalid spans.",
            ),
            (
                boite_spans(t, json!([{"start": 0, "end": 5, "bold": "yes"}])),
                "boxes[0]: invalid spans.",
            ),
            (
                boite_spans(t, json!([{"start": 0, "end": 5, "color": "pink"}])),
                "boxes[0]: invalid spans.",
            ),
            (
                boite_spans(t, json!([{"start": 1.5, "end": 5, "bold": true}])),
                "boxes[0]: invalid spans.",
            ),
            (boite_spans(t, json!({})), "boxes[0]: invalid spans."),
            (boite_spans(t, json!([3])), "boxes[0]: invalid spans."),
            (
                boite_spans("A😀B", json!([{"start": 0, "end": 4}])),
                "boxes[0]: invalid spans.",
            ),
            (
                lien_avec(json!({"text": 3})),
                "links[0]: missing or invalid text.",
            ),
            (
                lien_avec(json!({"text": "mail", "textSize": "tiny"})),
                "links[0]: invalid textSize.",
            ),
            (
                lien_avec(json!({"spans": [{"start": 0, "end": 1, "bold": true}]})),
                "links[0]: invalid spans.",
            ),
            (
                lien_avec(json!({"text": "mail", "spans": [{"start": 0, "end": 5}]})),
                "links[0]: invalid spans.",
            ),
        ];
        for (texte, cause) in refus {
            let w: Value = serde_json::from_str(&texte).unwrap();
            let r = lancer_outil(
                &c,
                "whiteboard_write",
                json!({"path": "a.jdiag", "whiteboard": w}),
            )
            .await;
            assert!(r.echec && r.contenu.starts_with(cause), "{texte} -> {r:?}");
            assert_eq!(fs::read_to_string(d.join("a.jdiag")).unwrap(), DEUX);
            fs::write(d.join("m.jdiag"), &texte).unwrap();
            let r = lancer_outil(&c, "whiteboard_read", json!({"path": "m.jdiag"})).await;
            assert!(r.echec && r.contenu.starts_with(cause), "{texte} -> {r:?}");
        }
    }

    #[tokio::test]
    async fn REQ144_AC6_refus_de_chemin() {
        let d = dossier("wb6");
        fs::create_dir_all(d.join("dossier.jdiag")).unwrap();
        fs::write(d.join("gros.jdiag"), vec![b' '; 5 * 1024 * 1024 + 1]).unwrap();
        let c = ctx(&d);
        let w = json!({"version": 1, "model": "m", "boxes": [], "links": []});
        for nom in ["whiteboard_read", "whiteboard_write"] {
            let r = lancer_outil(&c, nom, json!({"whiteboard": w})).await;
            assert_eq!(r, echec("Missing or invalid argument: path."), "{nom}");
            let r = lancer_outil(&c, nom, json!({"path": "plan.json", "whiteboard": w})).await;
            assert_eq!(r, echec("The path must end with .jdiag."), "{nom}");
            let r = lancer_outil(&c, nom, json!({"path": "../x.jdiag", "whiteboard": w})).await;
            assert_eq!(r, echec("The path is outside the project."), "{nom}");
            let r = lancer_outil(&c, nom, json!({"path": "dossier.jdiag", "whiteboard": w})).await;
            assert!(r.echec, "{nom} {r:?}");
        }
        assert!(!d.parent().unwrap().join("x.jdiag").exists());
        assert!(!d.join("plan.json").exists());
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "absent.jdiag"})).await;
        assert_eq!(r, echec("File not found."));
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "gros.jdiag"})).await;
        assert_eq!(r, echec("The file is larger than 5 MB."));
        let r = lancer_outil(&c, "whiteboard_write", json!({"path": "sans.jdiag"})).await;
        assert_eq!(r, echec("Missing or invalid argument: whiteboard."));
        assert!(!d.join("sans.jdiag").exists());
        let r = lancer_outil(
            &c,
            "whiteboard_write",
            json!({"path": "PLAN.JDIAG", "whiteboard": w}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        let r = lancer_outil(&c, "whiteboard_read", json!({"path": "PLAN.JDIAG"})).await;
        assert!(!r.echec, "{r:?}");
    }

    #[test]
    fn REQ144_AC7_argument_principal_des_outils_whiteboard() {
        for nom in ["whiteboard_read", "whiteboard_write"] {
            assert_eq!(
                argument_principal(nom, &json!({"path": "docs/plan.jdiag"})),
                "docs/plan.jdiag"
            );
        }
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
    async fn REQ163_AC4_save_agent_garde_les_declencheurs_et_list_agents_ne_les_rend_pas() {
        let d = dossier("save-declencheurs");
        let c = ctx(&d);
        let decl = json!([{"type": "fichier", "chemin": "docs/a.md"}, {"type": "commit"}]);
        c.agents
            .enregistrer(&json!({"nom": "Relecteur", "couleur": "violet", "declencheurs": decl}))
            .unwrap();
        let r = lancer_outil(
            &c,
            "save_agent",
            json!({"folder": "relecteur", "color": "vert"}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        let j = agent_json(&d, "relecteur");
        assert_eq!(j["couleur"], "vert");
        assert_eq!(j["declencheurs"], decl);
        let r = lancer_outil(&c, "list_agents", json!({})).await;
        assert!(!r.contenu.contains("declencheurs") && !r.contenu.contains("docs/a.md"));
    }

    #[tokio::test]
    async fn REQ174_AC5_save_agent_garde_le_declencheur_planification() {
        let d = dossier("save-planification");
        let c = ctx(&d);
        let decl = json!([{"type": "planification", "cron": "0 9 * * 1-5"}]);
        c.agents
            .enregistrer(&json!({"nom": "Relecteur", "couleur": "violet", "declencheurs": decl}))
            .unwrap();
        let r = lancer_outil(
            &c,
            "save_agent",
            json!({"folder": "relecteur", "color": "vert"}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        let j = agent_json(&d, "relecteur");
        assert_eq!(j["couleur"], "vert");
        assert_eq!(j["declencheurs"], decl);
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
