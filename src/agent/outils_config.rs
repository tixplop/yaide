//! Outils de configuration de l'agent (REQ-098) : `get_config`, `save_provider`, `save_profile`,
//! `save_mcp_server` et `save_interface`. Ils passent par le code des dialogues et ne touchent jamais une clé d'API.

use super::mcp;
use super::outils::Contexte;
use super::provider::DefOutil;
use super::reglages::{self, Erreur};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

const REPLIS: [(&str, &str); 3] = [
    ("panneau", "left_panel"),
    ("agent", "agent"),
    ("shells", "shells"),
];
const FONCTIONS: [(&str, &str); 5] = [
    ("recherche", "search"),
    ("git", "git"),
    ("shells", "shells"),
    ("agents", "agents"),
    ("claude", "claude"),
];
const EFFORTS: [(&str, &str); 3] = [("faible", "low"), ("moyen", "medium"), ("eleve", "high")];

fn def(nom: &str, description: &str, proprietes: Value, requis: &[&str]) -> DefOutil {
    DefOutil {
        nom: nom.into(),
        description: description.into(),
        schema: json!({"type": "object", "properties": proprietes, "required": requis}),
    }
}

pub fn definitions() -> Vec<DefOutil> {
    let texte = |d: &str| json!({"type": "string", "description": d});
    let bool_ou_null = |d: &str| json!({"type": ["boolean", "null"], "description": d});
    vec![
        def(
            "get_config",
            "Read the whole Yaide configuration: the six providers (id, name, url, has_key), the model profiles, the MCP servers, the interface preferences of the project and the full path of each file. A file that cannot be read is named under unreadable, with its cause.",
            json!({}),
            &[],
        ),
        def(
            "save_provider",
            "Change the URL of a provider (openai, anthropic, google, openrouter, litellm or ollama). API keys cannot be set here: the user types them in \"Providers LLM\" (Ctrl+P).",
            json!({
                "provider": texte("Provider id, as given by get_config"),
                "url": texte("Address starting with http:// or https://"),
            }),
            &["provider", "url"],
        ),
        def(
            "save_profile",
            "Create a model profile (without id; name, provider and model are required), modify the profile of id (an omitted argument keeps its value, null empties an optional field), or delete it (delete). effort accepts low, medium or high.",
            json!({
                "id": texte("Id of the profile to modify or delete, as given by get_config; omit to create"),
                "name": texte("Profile name, unique whatever the case"),
                "provider": texte("Provider id"),
                "model": texte("Model name"),
                "effort": texte("low, medium or high; null for none"),
                "max_output_tokens": json!({"type": ["integer", "null"], "description": "Positive integer; null for none"}),
                "context_window": json!({"type": ["integer", "null"], "description": "Positive integer; null for none"}),
                "temperature": json!({"type": ["number", "null"], "description": "From 0 to 2; null for none"}),
                "default": json!({"type": "boolean", "description": "Make it the default profile"}),
                "delete": json!({"type": "boolean", "description": "Delete the profile of id"}),
            }),
            &[],
        ),
        def(
            "save_mcp_server",
            "Create an MCP server (without server; name and command are required), modify the server named server (an omitted argument keeps its value), or delete it (delete). It is used from the next turn.",
            json!({
                "server": texte("Name of the server to modify or delete, as given by get_config; omit to create"),
                "name": texte("Server name, unique whatever the case"),
                "command": texte("Command that starts the server"),
                "args": json!({"type": "array", "items": {"type": "string"}, "description": "Command arguments"}),
                "env": json!({"type": "object", "additionalProperties": {"type": "string"}, "description": "Environment variables, name to text value"}),
                "delete": json!({"type": "boolean", "description": "Delete the server named server"}),
            }),
            &[],
        ),
        def(
            "save_interface",
            "Change the interface preferences of the project: collapsed panels and disabled features. true or false sets a value; null (collapsed) goes back to \"as last time\", true (features) re-enables a feature. Applied at the next page load.",
            json!({
                "collapsed": json!({
                    "type": "object",
                    "properties": {
                        "left_panel": bool_ou_null("Left panel collapsed"),
                        "shells": bool_ou_null("Shells area collapsed"),
                        "agent": bool_ou_null("Agent column collapsed"),
                    },
                }),
                "features": json!({
                    "type": "object",
                    "properties": {
                        "search": json!({"type": "boolean"}),
                        "git": json!({"type": "boolean"}),
                        "shells": json!({"type": "boolean"}),
                        "agents": json!({"type": "boolean"}),
                        "claude": json!({"type": "boolean"}),
                    },
                }),
            }),
            &[],
        ),
    ]
}

/// L'argument qui résume un appel : `None` si l'outil n'est pas de ce module.
pub fn argument_principal(nom: &str, a: &Value) -> Option<String> {
    let premier = |cles: &[&str]| {
        let c = cles.iter().find(|c| a[**c].is_string()).unwrap_or(&cles[0]);
        a[*c].as_str().unwrap_or("").to_string()
    };
    Some(match nom {
        "get_config" | "save_interface" => String::new(),
        "save_provider" => premier(&["provider"]),
        "save_profile" => premier(&["name", "id"]),
        "save_mcp_server" => premier(&["name", "server"]),
        _ => return None,
    })
}

pub fn lancer(nom: &str, a: &Value, ctx: &Contexte) -> Option<Result<String, String>> {
    Some(match nom {
        "get_config" => Ok(lire_config(ctx)),
        "save_provider" => sauver_provider(a, ctx),
        "save_profile" => sauver_profil(a, ctx),
        "save_mcp_server" => sauver_serveur(a, ctx),
        "save_interface" => sauver_interface(a, ctx),
        _ => return None,
    })
}

/// Préférences d'interface du fichier : seules les clés présentes, dans l'ordre du dialogue.
#[derive(Debug, Default, PartialEq)]
pub struct Interface {
    pub replis: Vec<(&'static str, bool)>,
    pub fonctions: Vec<(&'static str, bool)>,
}

pub fn chemin_interface(projet: &Path) -> PathBuf {
    projet.join(".yaide/interface.json")
}

fn section(
    brut: Option<&Value>,
    connues: &[(&'static str, &'static str)],
) -> Result<Vec<(&'static str, bool)>, String> {
    let Some(brut) = brut else {
        return Ok(Vec::new());
    };
    let o = brut.as_object().ok_or("a section is not an object")?;
    if let Some(k) = o.keys().find(|k| !connues.iter().any(|(c, _)| c == k)) {
        return Err(format!("unknown key {k}"));
    }
    let mut sortie = Vec::new();
    for (c, _) in connues {
        if let Some(v) = o.get(*c) {
            sortie.push((*c, v.as_bool().ok_or(format!("{c} is not true or false"))?));
        }
    }
    Ok(sortie)
}

/// Lit et vérifie `.yaide/interface.json` (règles d'AC-069-8) sans rien écrire. Absent : vide.
pub fn lire_interface(projet: &Path) -> Result<Interface, String> {
    let octets = match std::fs::read(chemin_interface(projet)) {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Interface::default()),
        Err(e) => return Err(e.to_string()),
    };
    let brut: Value = serde_json::from_slice(&octets).map_err(|e| e.to_string())?;
    let o = brut.as_object().ok_or("the content is not an object")?;
    if let Some(k) = o.keys().find(|k| *k != "replis" && *k != "fonctions") {
        return Err(format!("unknown key {k}"));
    }
    Ok(Interface {
        replis: section(o.get("replis"), &REPLIS)?,
        fonctions: section(o.get("fonctions"), &FONCTIONS)?,
    })
}

fn en_anglais(v: &[(&str, bool)], noms: &[(&str, &str)]) -> Value {
    let mut o = Map::new();
    for (c, b) in v {
        let nom = noms.iter().find(|(k, _)| k == c).map_or(*c, |(_, e)| e);
        o.insert(nom.to_string(), json!(b));
    }
    Value::Object(o)
}

fn effort_en_anglais(e: &Value) -> Value {
    e.as_str()
        .and_then(|e| EFFORTS.iter().find(|(f, _)| *f == e))
        .map_or(Value::Null, |(_, a)| json!(a))
}

fn lire_config(ctx: &Contexte) -> String {
    let dossier = ctx.reglages.dossier();
    let (f_config, f_mcp, f_interface) = (
        dossier.join("config.json"),
        dossier.join("mcp.json"),
        chemin_interface(&ctx.projet),
    );
    let mut illisibles: Vec<Value> = Vec::new();
    let vue = ctx.reglages.vue();
    if let Some(e) = vue["erreur"].as_str() {
        let f = if e.contains("config.json") {
            &f_config
        } else {
            &dossier.join("secrets")
        };
        illisibles.push(json!({"file": f.display().to_string(), "cause": e}));
    }
    let providers: Vec<Value> = vue["providers"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| json!({"id": p["id"], "name": p["nom"], "url": p["adresse"], "has_key": p["cle"]}))
        .collect();
    let profils: Vec<Value> = vue["profils"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| {
            json!({
                "id": p["id"], "name": p["nom"], "provider": p["provider"], "model": p["modele"],
                "effort": effort_en_anglais(&p["effort"]),
                "max_output_tokens": p["sortieMax"], "context_window": p["fenetre"],
                "temperature": p["temperature"], "default": p["defaut"],
            })
        })
        .collect();
    let serveurs: Vec<Value> = match mcp::lister_serveurs(&f_mcp) {
        Ok(l) => l
            .iter()
            .map(|s| {
                let mut o = Map::new();
                o.insert("name".into(), json!(s.nom));
                match (&s.command, &s.url) {
                    (Some(c), _) => o.insert("command".into(), json!(c)),
                    (None, Some(u)) => o.insert("url".into(), json!(u)),
                    _ => None,
                };
                o.insert("args".into(), json!(s.args));
                let env: Map<String, Value> =
                    s.env.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
                o.insert("env".into(), Value::Object(env));
                Value::Object(o)
            })
            .collect(),
        Err(p) => {
            let cause = p.detail.unwrap_or(p.message);
            illisibles.push(json!({"file": f_mcp.display().to_string(), "cause": cause}));
            Vec::new()
        }
    };
    let interface = match lire_interface(&ctx.projet) {
        Ok(i) => json!({
            "collapsed": en_anglais(&i.replis, &REPLIS),
            "features": en_anglais(&i.fonctions, &FONCTIONS),
        }),
        Err(cause) => {
            illisibles.push(json!({"file": f_interface.display().to_string(), "cause": cause}));
            json!({"collapsed": {}, "features": {}})
        }
    };
    json!({
        "providers": providers,
        "profiles": profils,
        "mcp_servers": serveurs,
        "interface": interface,
        "files": {
            "config": f_config.display().to_string(),
            "mcp": f_mcp.display().to_string(),
            "interface": f_interface.display().to_string(),
        },
        "unreadable": illisibles,
    })
    .to_string()
}

fn requis<'a>(a: &'a Value, cle: &str) -> Result<&'a str, String> {
    a[cle]
        .as_str()
        .ok_or_else(|| format!("Missing or invalid argument: {cle}."))
}

fn erreur_systeme(e: Erreur) -> String {
    match e {
        Erreur::Systeme(m) => format!("Could not write the configuration: {m}"),
        _ => "Refused.".into(),
    }
}

fn sauver_provider(a: &Value, ctx: &Contexte) -> Result<String, String> {
    let (id, url) = (requis(a, "provider")?, requis(a, "url")?);
    match ctx
        .reglages
        .enregistrer_provider(id, &json!({ "adresse": url }))
    {
        Ok(()) => Ok(format!("Saved provider {id} at {}.", url.trim())),
        Err(Erreur::Inconnu) => Err(format!(
            "Unknown provider: {id}. Allowed ids: {}.",
            reglages::ids_providers().join(", ")
        )),
        Err(Erreur::Champs(_)) => {
            Err("Invalid url: it must start with http:// or https://.".into())
        }
        Err(e) => Err(erreur_systeme(e)),
    }
}

fn phrase_champs(champs: &[&str]) -> String {
    let parts: Vec<String> = champs
        .iter()
        .map(|c| match *c {
            "nom" => "name (required, unique whatever the case)".to_string(),
            "provider" => format!("provider (one of {})", reglages::ids_providers().join(", ")),
            "modele" => "model (required)".into(),
            "effort" => "effort (one of low, medium, high)".into(),
            "sortieMax" => "max_output_tokens (a positive integer)".into(),
            "fenetre" => "context_window (a positive integer)".into(),
            "temperature" => "temperature (a number from 0 to 2)".into(),
            autre => autre.to_string(),
        })
        .collect();
    format!("Invalid fields: {}.", parts.join("; "))
}

/// Traduit un argument de l'outil vers le champ de la route ; `None` : l'argument est absent.
fn champ(a: &Value, arg: &str) -> Option<Value> {
    let v = a.get(arg)?.clone();
    Some(match arg {
        "effort" => match &v {
            Value::String(s) => json!(EFFORTS
                .iter()
                .find(|(_, e)| e == s)
                .map_or(s.as_str(), |(f, _)| f)),
            Value::Null => v,
            _ => json!("?"),
        },
        _ => v,
    })
}

fn sauver_profil(a: &Value, ctx: &Contexte) -> Result<String, String> {
    let ids = || ctx.reglages.ids_profils().join(", ");
    let id = match a.get("id") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.as_str()),
        Some(_) => return Err("Invalid argument: id.".into()),
    };
    let inconnu = |id: &str| format!("Unknown profile id: {id}. Known ids: {}.", ids());
    if a["delete"].as_bool() == Some(true) {
        let id = id.ok_or("Missing argument: id.")?;
        return match ctx.reglages.supprimer_profil(id) {
            Ok(()) => Ok(format!("Deleted profile {id}.")),
            Err(Erreur::Inconnu) => Err(inconnu(id)),
            Err(e) => Err(erreur_systeme(e)),
        };
    }
    let mut corps = Map::new();
    if let Some(id) = id {
        let vue = ctx.reglages.vue();
        let existant = vue["profils"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|p| p["id"] == id)
            .ok_or_else(|| inconnu(id))?;
        corps = existant.as_object().cloned().unwrap_or_default();
    }
    for (arg, cle) in [
        ("name", "nom"),
        ("provider", "provider"),
        ("model", "modele"),
        ("effort", "effort"),
        ("max_output_tokens", "sortieMax"),
        ("context_window", "fenetre"),
        ("temperature", "temperature"),
    ] {
        if let Some(v) = champ(a, arg) {
            corps.insert(cle.into(), v);
        }
    }
    match a.get("default") {
        None => {}
        Some(Value::Bool(b)) => {
            corps.insert("defaut".into(), json!(b));
        }
        Some(_) => return Err("Invalid argument: default.".into()),
    }
    match ctx.reglages.enregistrer_profil(&Value::Object(corps)) {
        Ok(id) => Ok(format!("Saved profile {id}.")),
        Err(Erreur::Champs(c)) => Err(phrase_champs(&c)),
        Err(Erreur::Inconnu) => Err(inconnu(id.unwrap_or(""))),
        Err(e) => Err(erreur_systeme(e)),
    }
}

fn texte_ou_refus(v: &Value, arg: &str) -> Result<Option<String>, String> {
    match v.get(arg) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(format!("Invalid argument: {arg} must be a string.")),
    }
}

fn erreur_mcp(e: mcp::ErreurMcp, serveurs: &[String]) -> String {
    match e {
        mcp::ErreurMcp::Refus(r) => {
            let parts: Vec<String> = r
                .iter()
                .map(|r| match r.champ {
                    "nom" if r.message.contains("pris") => {
                        "name (already taken, whatever the case)".to_string()
                    }
                    "nom" => "name (required)".into(),
                    "command" => "command (required)".into(),
                    _ => "env (names must not be empty)".into(),
                })
                .collect();
            format!("Invalid fields: {}.", parts.join("; "))
        }
        mcp::ErreurMcp::Illisible(_) => {
            "mcp.json is not valid JSON: fix it before saving a server.".into()
        }
        mcp::ErreurMcp::Inconnu => {
            format!("Unknown server. Known servers: {}.", serveurs.join(", "))
        }
        mcp::ErreurMcp::Systeme(m) => format!("Could not write the configuration: {m}"),
    }
}

fn sauver_serveur(a: &Value, ctx: &Contexte) -> Result<String, String> {
    let fichier = ctx.reglages.dossier().join("mcp.json");
    let existants = mcp::lister_serveurs(&fichier)
        .map_err(|_| "mcp.json is not valid JSON: fix it before saving a server.".to_string())?;
    let noms: Vec<String> = existants.iter().map(|s| s.nom.clone()).collect();
    let serveur = texte_ou_refus(a, "server")?;
    let actuel =
        match &serveur {
            Some(n) => Some(existants.iter().find(|s| &s.nom == n).ok_or_else(|| {
                format!("Unknown server: {n}. Known servers: {}.", noms.join(", "))
            })?),
            None => None,
        };
    if a["delete"].as_bool() == Some(true) {
        let n = serveur.as_deref().ok_or("Missing argument: server.")?;
        return mcp::supprimer_serveur(&fichier, n)
            .map(|_| format!("Deleted MCP server {n}."))
            .map_err(|e| erreur_mcp(e, &noms));
    }
    let nom = texte_ou_refus(a, "name")?;
    let command = texte_ou_refus(a, "command")?;
    let args: Option<Vec<String>> = match a.get("args") {
        None | Some(Value::Null) => None,
        Some(Value::Array(l)) => Some(
            l.iter()
                .map(|x| x.as_str().map(String::from))
                .collect::<Option<_>>()
                .ok_or("Invalid argument: args must be an array of strings.")?,
        ),
        Some(_) => return Err("Invalid argument: args must be an array of strings.".into()),
    };
    let env: Option<Vec<String>> = match a.get("env") {
        None | Some(Value::Null) => None,
        Some(Value::Object(o)) => Some(
            o.iter()
                .map(|(k, v)| match v.as_str() {
                    Some(v) => Ok(format!("{k}={v}")),
                    None => Err(format!(
                        "Invalid argument: env value of {k} must be a string."
                    )),
                })
                .collect::<Result<_, _>>()?,
        ),
        Some(_) => return Err("Invalid argument: env must be an object of strings.".into()),
    };
    let saisie = mcp::Saisie {
        nom: nom
            .or_else(|| actuel.map(|s| s.nom.clone()))
            .unwrap_or_default(),
        command: command
            .or_else(|| actuel.and_then(|s| s.command.clone()))
            .unwrap_or_default(),
        args: args
            .or_else(|| actuel.map(|s| s.args.clone()))
            .unwrap_or_default(),
        env: env
            .or_else(|| actuel.map(|s| s.env.iter().map(|(k, v)| format!("{k}={v}")).collect()))
            .unwrap_or_default(),
    };
    mcp::enregistrer_serveur(&fichier, serveur.as_deref(), &saisie)
        .map(|_| format!("Saved MCP server {}.", saisie.nom.trim()))
        .map_err(|e| erreur_mcp(e, &noms))
}

/// Lit `collapsed` ou `features` : clés connues, valeurs booléennes (ou `null` si `nul_permis`).
fn valeurs_interface(
    a: &Value,
    arg: &str,
    connues: &[(&'static str, &'static str)],
    nul_permis: bool,
) -> Result<Vec<(&'static str, Option<bool>)>, String> {
    let admises = || {
        connues
            .iter()
            .map(|(_, e)| *e)
            .collect::<Vec<_>>()
            .join(", ")
    };
    let o = match a.get(arg) {
        None => return Ok(Vec::new()),
        Some(Value::Object(o)) => o,
        Some(_) => return Err(format!("Invalid argument: {arg} must be an object.")),
    };
    let mut sortie = Vec::new();
    for (k, v) in o {
        let (interne, _) = connues
            .iter()
            .find(|(_, e)| e == k)
            .ok_or_else(|| format!("Unknown key in {arg}: {k}. Known keys: {}.", admises()))?;
        let valeur = match v {
            Value::Bool(b) => Some(*b),
            Value::Null if nul_permis => None,
            _ => {
                let permis = if nul_permis {
                    "true, false or null"
                } else {
                    "true or false"
                };
                return Err(format!("Invalid value for {arg}.{k}: expected {permis}."));
            }
        };
        sortie.push((*interne, valeur));
    }
    Ok(sortie)
}

fn sauver_interface(a: &Value, ctx: &Contexte) -> Result<String, String> {
    let nouveaux_replis = valeurs_interface(a, "collapsed", &REPLIS, true)?;
    let nouvelles_fonctions = valeurs_interface(a, "features", &FONCTIONS, false)?;
    let mut actuel = lire_interface(&ctx.projet).map_err(|c| {
        format!(
            "{} cannot be read ({c}): fix it before saving.",
            chemin_interface(&ctx.projet).display()
        )
    })?;
    for (k, v) in nouveaux_replis {
        actuel.replis.retain(|(c, _)| *c != k);
        if let Some(b) = v {
            actuel.replis.push((k, b));
        }
    }
    for (k, v) in nouvelles_fonctions {
        actuel.fonctions.retain(|(c, _)| *c != k);
        if v == Some(false) {
            actuel.fonctions.push((k, false));
        }
    }
    let ecrire = |connues: &[(&str, &str)], v: &[(&str, bool)]| -> String {
        let lignes: Vec<String> = connues
            .iter()
            .filter_map(|(c, _)| v.iter().find(|(k, _)| k == c))
            .map(|(c, b)| format!("    \"{c}\": {b}"))
            .collect();
        lignes.join(",\n")
    };
    let mut sections = Vec::new();
    for (nom, connues, v) in [
        ("replis", &REPLIS[..], &actuel.replis),
        ("fonctions", &FONCTIONS[..], &actuel.fonctions),
    ] {
        if !v.is_empty() {
            sections.push(format!("  \"{nom}\": {{\n{}\n  }}", ecrire(connues, v)));
        }
    }
    let texte = if sections.is_empty() {
        "{}\n".to_string()
    } else {
        format!("{{\n{}\n}}\n", sections.join(",\n"))
    };
    let chemin = chemin_interface(&ctx.projet);
    crate::config::ecrire_atomique(&chemin, texte.as_bytes())
        .map_err(|m| format!("Could not write the configuration: {m}"))?;
    Ok("Saved interface preferences.".into())
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::super::agents::Agents;
    use super::super::outils::{executer, Limites};
    use super::*;
    use std::sync::Arc;

    struct Banc {
        ctx: Contexte,
        config: PathBuf,
        projet: PathBuf,
    }

    fn banc(nom: &str) -> Banc {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let d = std::env::temp_dir().join(format!("outcfg-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let (projet, config) = (d.join("projet"), d.join("xdg/yaide"));
        std::fs::create_dir_all(&projet).unwrap();
        let reglages = Arc::new(reglages::Reglages::new(config.clone(), d.join("cle")));
        let agents = Arc::new(Agents::new(projet.join(".yaide"), reglages.clone()));
        let ctx = Contexte {
            projet: projet.clone(),
            client: reqwest::Client::new(),
            limites: Limites::default(),
            agents,
            reglages,
        };
        Banc {
            ctx,
            config,
            projet,
        }
    }

    async fn appel(b: &Banc, nom: &str, a: Value) -> (bool, String) {
        let r = executer(nom, &a, &b.ctx).await;
        (r.echec, r.contenu)
    }

    async fn ok(b: &Banc, nom: &str, a: Value) -> String {
        let (echec, c) = appel(b, nom, a).await;
        assert!(!echec, "{c}");
        c
    }

    async fn config(b: &Banc) -> Value {
        serde_json::from_str(&ok(b, "get_config", json!({})).await).unwrap()
    }

    fn fichier(b: &Banc) -> String {
        std::fs::read_to_string(b.config.join("config.json")).unwrap()
    }

    #[test]
    fn REQ098_AC1_cinq_definitions_sans_cle() {
        let noms: Vec<String> = definitions().into_iter().map(|d| d.nom).collect();
        assert_eq!(
            noms,
            [
                "get_config",
                "save_provider",
                "save_profile",
                "save_mcp_server",
                "save_interface"
            ]
        );
        for d in definitions() {
            assert!(!d.description.is_empty());
            let p = d.schema["properties"].as_object().unwrap();
            assert!(
                !p.contains_key("key") && !p.contains_key("api_key"),
                "{}",
                d.nom
            );
        }
    }

    #[test]
    fn REQ098_AC11_argument_principal() {
        let a = |n: &str, v: Value| argument_principal(n, &v).unwrap();
        assert_eq!(a("save_provider", json!({"provider": "ollama"})), "ollama");
        assert_eq!(
            a("save_profile", json!({"name": "rapide", "id": "x"})),
            "rapide"
        );
        assert_eq!(a("save_profile", json!({"id": "x"})), "x");
        assert_eq!(a("save_mcp_server", json!({"name": "notes"})), "notes");
        assert_eq!(a("save_mcp_server", json!({"server": "docs"})), "docs");
        assert_eq!(a("get_config", json!({})), "");
        assert_eq!(a("save_interface", json!({"features": {}})), "");
        assert_eq!(argument_principal("bash", &json!({})), None);
    }

    #[tokio::test]
    async fn REQ098_AC2_get_config_complet_sans_cle_ni_creation() {
        let b = banc("ac2");
        // Sans aucun fichier.
        let v = config(&b).await;
        assert_eq!(v["providers"].as_array().unwrap().len(), 6);
        for (p, id) in v["providers"]
            .as_array()
            .unwrap()
            .iter()
            .zip(reglages::ids_providers())
        {
            assert_eq!(p["id"], id);
            assert_eq!(
                p["url"],
                reglages::provider(id).unwrap().adresse_par_defaut()
            );
            assert_eq!(p["has_key"], false);
        }
        assert_eq!(v["profiles"], json!([]));
        assert_eq!(v["mcp_servers"], json!([]));
        assert_eq!(v["interface"], json!({"collapsed": {}, "features": {}}));
        assert_eq!(v["unreadable"], json!([]));
        assert!(!b.config.exists() && !b.projet.join(".yaide").exists());
        // Avec tout.
        b.ctx
            .reglages
            .enregistrer_provider(
                "openai",
                &json!({"adresse": "http://h.test/v1", "cle": "sk-tres-secrete"}),
            )
            .unwrap();
        for (n, d) in [("un", true), ("deux", false)] {
            b.ctx
                .reglages
                .enregistrer_profil(&json!({"nom": n, "provider": "openai", "modele": "m", "effort": "eleve", "temperature": 0.5, "defaut": d}))
                .unwrap();
        }
        std::fs::write(
            b.config.join("mcp.json"),
            r#"{"mcpServers":{"docs":{"command":"mcp-docs","args":["--port","0"],"env":{"TOKEN":"abc"}}}}"#,
        )
        .unwrap();
        std::fs::create_dir_all(b.projet.join(".yaide")).unwrap();
        std::fs::write(
            b.projet.join(".yaide/interface.json"),
            r#"{"fonctions":{"git":false}}"#,
        )
        .unwrap();
        let brut = ok(&b, "get_config", json!({})).await;
        assert!(!brut.contains("sk-tres-secrete"));
        let v: Value = serde_json::from_str(&brut).unwrap();
        let p = v["providers"].as_array().unwrap();
        assert_eq!(p[0]["url"], "http://h.test/v1");
        for (q, id) in p.iter().zip(reglages::ids_providers()).skip(1) {
            assert_eq!(
                q["url"],
                reglages::provider(id).unwrap().adresse_par_defaut()
            );
            assert_eq!(q["has_key"], false);
        }
        assert_eq!(p.iter().filter(|p| p["has_key"] == true).count(), 1);
        assert_eq!(p[0]["has_key"], true);
        let pr = v["profiles"].as_array().unwrap();
        assert_eq!(
            (pr[0]["default"].clone(), pr[1]["default"].clone()),
            (json!(true), json!(false))
        );
        assert_eq!(pr[0]["effort"], "high");
        assert_eq!(pr[0]["temperature"], 0.5);
        assert_eq!(pr[0]["max_output_tokens"], Value::Null);
        assert_eq!(
            v["mcp_servers"][0],
            json!({"name": "docs", "command": "mcp-docs", "args": ["--port", "0"], "env": {"TOKEN": "abc"}})
        );
        assert_eq!(
            v["interface"],
            json!({"collapsed": {}, "features": {"git": false}})
        );
        assert_eq!(
            v["files"]["config"],
            b.config.join("config.json").display().to_string()
        );
        assert_eq!(
            v["files"]["mcp"],
            b.config.join("mcp.json").display().to_string()
        );
        assert_eq!(
            v["files"]["interface"],
            b.projet.join(".yaide/interface.json").display().to_string()
        );
    }

    #[tokio::test]
    async fn REQ098_AC3_fichier_illisible_nomme_avec_sa_cause() {
        for (casse, nom) in [
            ("config.json", "{ cassé"),
            ("mcp.json", "pas du json"),
            ("interface.json", r#"{"fonctions":{"gti":false}}"#),
        ] {
            let b = banc(&format!("ac3-{}", &casse[..3]));
            b.ctx
                .reglages
                .enregistrer_provider("ollama", &json!({"adresse": "http://h.test"}))
                .unwrap();
            b.ctx
                .reglages
                .enregistrer_profil(&json!({"nom": "p", "provider": "openai", "modele": "m"}))
                .unwrap();
            std::fs::write(
                b.config.join("mcp.json"),
                r#"{"mcpServers":{"docs":{"command":"c"}}}"#,
            )
            .unwrap();
            std::fs::create_dir_all(b.projet.join(".yaide")).unwrap();
            std::fs::write(
                b.projet.join(".yaide/interface.json"),
                r#"{"fonctions":{"git":false}}"#,
            )
            .unwrap();
            let chemin = if casse == "interface.json" {
                b.projet.join(".yaide").join(casse)
            } else {
                b.config.join(casse)
            };
            std::fs::write(&chemin, nom).unwrap();
            let v = config(&b).await;
            let u = v["unreadable"].as_array().unwrap();
            assert_eq!(u.len(), 1, "{casse}: {u:?}");
            assert!(u[0]["file"].as_str().unwrap().ends_with(casse), "{u:?}");
            assert!(!u[0]["cause"].as_str().unwrap().is_empty());
            // Les autres sections gardent leur contenu.
            let intact = |c: &str| c != casse;
            assert_eq!(v["providers"].as_array().unwrap().len(), 6);
            if intact("config.json") {
                assert_eq!(v["providers"][5]["url"], "http://h.test");
                assert_eq!(v["profiles"].as_array().unwrap().len(), 1);
            } else {
                assert_eq!(v["profiles"], json!([]));
            }
            if intact("mcp.json") {
                assert_eq!(v["mcp_servers"][0]["name"], "docs");
            } else {
                assert_eq!(v["mcp_servers"], json!([]));
            }
            if intact("interface.json") {
                assert_eq!(v["interface"]["features"], json!({"git": false}));
            } else {
                assert!(u[0]["cause"].as_str().unwrap().contains("gti"));
            }
            // Rien n'est réécrit.
            assert_eq!(std::fs::read_to_string(&chemin).unwrap(), nom);
        }
    }

    #[tokio::test]
    async fn REQ098_AC4_save_provider() {
        let b = banc("ac4");
        b.ctx
            .reglages
            .enregistrer_provider(
                "openai",
                &json!({"adresse": "http://h.test", "cle": "sk-x"}),
            )
            .unwrap();
        let secrets = std::fs::read(b.config.join("secrets")).unwrap();
        ok(
            &b,
            "save_provider",
            json!({"provider": "ollama", "url": "http://localhost:9999/v1"}),
        )
        .await;
        let v: Value = serde_json::from_str(&fichier(&b)).unwrap();
        assert_eq!(
            v["providers"]["ollama"]["adresse"],
            "http://localhost:9999/v1"
        );
        assert_eq!(std::fs::read(b.config.join("secrets")).unwrap(), secrets);
        let avant = fichier(&b);
        let (e, m) = appel(
            &b,
            "save_provider",
            json!({"provider": "ollama", "url": "ftp://x"}),
        )
        .await;
        assert!(e && m.contains("http://"), "{m}");
        let (e, m) = appel(
            &b,
            "save_provider",
            json!({"provider": "mistral", "url": "http://x"}),
        )
        .await;
        assert!(e && m.contains("openai") && m.contains("ollama"), "{m}");
        assert_eq!(fichier(&b), avant);
    }

    #[tokio::test]
    async fn REQ098_AC5_save_profile_creation_modification_suppression() {
        let b = banc("ac5");
        let m = ok(
            &b,
            "save_profile",
            json!({"name": "rapide", "provider": "anthropic", "model": "claude-x", "effort": "high", "temperature": 0.7}),
        )
        .await;
        let p = config(&b).await["profiles"][0].clone();
        assert_eq!(p["name"], "rapide");
        assert_eq!(
            (p["default"].clone(), p["effort"].clone()),
            (json!(true), json!("high"))
        );
        let id = p["id"].as_str().unwrap().to_string();
        assert!(m.contains(&id));
        assert!(fichier(&b).contains("\"eleve\""));
        ok(&b, "save_profile", json!({"id": id, "model": "claude-y"})).await;
        let p = config(&b).await["profiles"][0].clone();
        assert_eq!(
            (
                p["model"].clone(),
                p["name"].clone(),
                p["temperature"].clone()
            ),
            (json!("claude-y"), json!("rapide"), json!(0.7))
        );
        assert_eq!(p["effort"], "high");
        ok(&b, "save_profile", json!({"id": id, "temperature": null})).await;
        assert_eq!(config(&b).await["profiles"][0]["temperature"], Value::Null);
        ok(
            &b,
            "save_profile",
            json!({"name": "second", "provider": "openai", "model": "m", "default": true}),
        )
        .await;
        let v = config(&b).await;
        assert_eq!(v["profiles"][0]["default"], false);
        assert_eq!(v["profiles"][1]["default"], true);
        let id2 = v["profiles"][1]["id"].as_str().unwrap().to_string();
        ok(&b, "save_profile", json!({"id": id2, "delete": true})).await;
        let v = config(&b).await;
        assert_eq!(v["profiles"].as_array().unwrap().len(), 1);
        assert_eq!(v["profiles"][0]["default"], true);
    }

    #[tokio::test]
    async fn REQ098_AC6_save_profile_refus_sans_rien_ecrire() {
        let b = banc("ac6");
        ok(
            &b,
            "save_profile",
            json!({"name": "Rapide", "provider": "openai", "model": "m"}),
        )
        .await;
        let avant = fichier(&b);
        let base = json!({"name": "Autre", "provider": "openai", "model": "m"});
        let avec = |k: &str, v: Value| {
            let mut c = base.clone();
            if v == json!("__retirer") {
                c.as_object_mut().unwrap().remove(k);
            } else {
                c[k] = v;
            }
            c
        };
        let cas = [
            (avec("name", json!("__retirer")), "name"),
            (avec("model", json!("__retirer")), "model"),
            (avec("name", json!("rapide")), "name"),
            (avec("provider", json!("nulle")), "provider"),
            (avec("effort", json!("max")), "low, medium, high"),
            (avec("max_output_tokens", json!(0)), "max_output_tokens"),
            (avec("max_output_tokens", json!(1.5)), "max_output_tokens"),
            (avec("context_window", json!("x")), "context_window"),
            (avec("temperature", json!(3)), "temperature"),
            (json!({"id": "inconnu", "model": "z"}), "inconnu"),
            (json!({"id": "inconnu", "delete": true}), "inconnu"),
        ];
        for (a, attendu) in cas {
            let (e, m) = appel(&b, "save_profile", a.clone()).await;
            assert!(e && m.contains(attendu), "{a} -> {m}");
            assert_eq!(fichier(&b), avant, "{a}");
        }
    }

    fn mcp_json(b: &Banc) -> PathBuf {
        b.config.join("mcp.json")
    }

    fn lire_mcp(b: &Banc) -> Value {
        serde_json::from_str(&std::fs::read_to_string(mcp_json(b)).unwrap()).unwrap()
    }

    fn semer_mcp(b: &Banc) {
        std::fs::create_dir_all(&b.config).unwrap();
        std::fs::write(
            mcp_json(b),
            r#"{"autre":{"x":[3,1,2],"a":null},"mcpServers":{"docs":{"command":"mcp-docs","args":["--port","0"],"env":{"Z":"1","A":"2"}},"echo":{"command":"node"}},"zeta":true}"#,
        )
        .unwrap();
    }

    #[tokio::test]
    async fn REQ098_AC7_save_mcp_server_creation_modification_suppression() {
        use std::os::unix::fs::PermissionsExt;
        let b = banc("ac7");
        semer_mcp(&b);
        let avant = lire_mcp(&b);
        ok(
            &b,
            "save_mcp_server",
            json!({"name": "notes", "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-memory"],
                "env": {"MEMORY_FILE_PATH": "/tmp/notes.json"}}),
        )
        .await;
        let attendu = "{\n  \"autre\": {\n    \"x\": [\n      3,\n      1,\n      2\n    ],\n    \"a\": null\n  },\n  \"mcpServers\": {\n    \"docs\": {\n      \"command\": \"mcp-docs\",\n      \"args\": [\n        \"--port\",\n        \"0\"\n      ],\n      \"env\": {\n        \"Z\": \"1\",\n        \"A\": \"2\"\n      }\n    },\n    \"echo\": {\n      \"command\": \"node\"\n    },\n    \"notes\": {\n      \"command\": \"npx\",\n      \"args\": [\n        \"-y\",\n        \"@modelcontextprotocol/server-memory\"\n      ],\n      \"env\": {\n        \"MEMORY_FILE_PATH\": \"/tmp/notes.json\"\n      }\n    }\n  },\n  \"zeta\": true\n}\n";
        assert_eq!(std::fs::read_to_string(mcp_json(&b)).unwrap(), attendu);
        let mode = std::fs::metadata(mcp_json(&b))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        assert!(!b.projet.join(".yaide").exists());
        // Modification : seul le nom change, au même rang.
        ok(
            &b,
            "save_mcp_server",
            json!({"server": "docs", "name": "docs2"}),
        )
        .await;
        let v = lire_mcp(&b);
        let noms: Vec<&String> = v["mcpServers"].as_object().unwrap().keys().collect();
        assert_eq!(noms, ["docs2", "echo", "notes"]);
        assert_eq!(v["mcpServers"]["docs2"], avant["mcpServers"]["docs"]);
        assert_eq!(v["autre"], avant["autre"]);
        assert_eq!(v["zeta"], true);
        // Suppression.
        ok(
            &b,
            "save_mcp_server",
            json!({"server": "docs2", "delete": true}),
        )
        .await;
        let v = lire_mcp(&b);
        assert!(v["mcpServers"].get("docs2").is_none());
        assert!(v["mcpServers"].get("echo").is_some());
        assert_eq!(v["zeta"], true);
        let mode = std::fs::metadata(mcp_json(&b))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[tokio::test]
    async fn REQ098_AC8_save_mcp_server_refus_sans_rien_ecrire() {
        let b = banc("ac8");
        semer_mcp(&b);
        let avant = std::fs::read_to_string(mcp_json(&b)).unwrap();
        let cas = [
            (json!({"command": "x"}), "name"),
            (json!({"name": "n"}), "command"),
            (json!({"name": "Echo", "command": "x"}), "already taken"),
            (json!({"server": "absent", "name": "n"}), "absent"),
            (json!({"server": "absent", "delete": true}), "absent"),
            (json!({"name": "n", "command": "x", "env": {"A": 1}}), "env"),
            (json!({"name": "n", "command": "x", "args": [1]}), "args"),
        ];
        for (a, attendu) in cas {
            let (e, m) = appel(&b, "save_mcp_server", a.clone()).await;
            assert!(e && m.contains(attendu), "{a} -> {m}");
            assert_eq!(std::fs::read_to_string(mcp_json(&b)).unwrap(), avant, "{a}");
        }
        std::fs::write(mcp_json(&b), "{ cassé").unwrap();
        let (e, m) = appel(&b, "save_mcp_server", json!({"name": "n", "command": "x"})).await;
        assert!(e && m.contains("not valid JSON"), "{m}");
        assert_eq!(std::fs::read_to_string(mcp_json(&b)).unwrap(), "{ cassé");
    }

    fn interface(b: &Banc) -> String {
        std::fs::read_to_string(b.projet.join(".yaide/interface.json")).unwrap()
    }

    #[tokio::test]
    async fn REQ098_AC9_save_interface_fusion_et_format() {
        let b = banc("ac9");
        ok(
            &b,
            "save_interface",
            json!({"collapsed": {"left_panel": true}, "features": {"shells": false}}),
        )
        .await;
        assert_eq!(
            interface(&b),
            "{\n  \"replis\": {\n    \"panneau\": true\n  },\n  \"fonctions\": {\n    \"shells\": false\n  }\n}\n"
        );
        ok(&b, "save_interface", json!({"features": {"git": false}})).await;
        assert_eq!(
            interface(&b),
            "{\n  \"replis\": {\n    \"panneau\": true\n  },\n  \"fonctions\": {\n    \"git\": false,\n    \"shells\": false\n  }\n}\n"
        );
        ok(
            &b,
            "save_interface",
            json!({"collapsed": {"left_panel": null}, "features": {"git": true, "shells": true}}),
        )
        .await;
        assert_eq!(interface(&b), "{}\n");
    }

    #[tokio::test]
    async fn REQ098_AC10_save_interface_refus_sans_rien_ecrire() {
        let b = banc("ac10");
        ok(&b, "save_interface", json!({"features": {"git": false}})).await;
        let avant = interface(&b);
        let cas = [
            (
                json!({"features": {"gti": false}}),
                "search, git, shells, agents, claude",
            ),
            (
                json!({"collapsed": {"nulle": true}}),
                "left_panel, agent, shells",
            ),
            (json!({"features": {"git": "non"}}), "features.git"),
            (json!({"features": {"git": null}}), "features.git"),
            (json!({"collapsed": {"agent": 1}}), "collapsed.agent"),
            // Un argument valide ne s'écrit pas si un autre est refusé.
            (
                json!({"collapsed": {"agent": true}, "features": {"gti": false}}),
                "gti",
            ),
        ];
        for (a, attendu) in cas {
            let (e, m) = appel(&b, "save_interface", a.clone()).await;
            assert!(e && m.contains(attendu), "{a} -> {m}");
            assert_eq!(interface(&b), avant, "{a}");
        }
        std::fs::write(b.projet.join(".yaide/interface.json"), "[1]").unwrap();
        let (e, m) = appel(&b, "save_interface", json!({"features": {"git": false}})).await;
        assert!(e && m.contains("cannot be read"), "{m}");
        assert_eq!(interface(&b), "[1]");
    }
}
