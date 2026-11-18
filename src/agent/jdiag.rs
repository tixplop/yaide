//! Format `.jdiag` (REQ-132) côté Rust, pour les outils `whiteboard_read` et `whiteboard_write`
//! (REQ-144). Calqué sur `web/src/jdiag.js` : mêmes clés dans le même ordre, mêmes valeurs
//! admises, défauts non écrits, `arrows` vide non écrite, mêmes refus ; chaque refus dit sa cause.

use serde_json::{json, Value};
use std::collections::HashSet;

const CLES_BOITE: [&str; 6] = ["id", "x", "y", "width", "height", "text"];
const CLES_LIEN: [&str; 3] = ["id", "from", "to"];
const CLES_LIBRE: [&str; 5] = ["id", "x1", "y1", "x2", "y2"];
const ENTIERS: [&str; 8] = ["x", "y", "width", "height", "x1", "y1", "x2", "y2"];
pub const COTES: [&str; 5] = ["top", "right", "bottom", "left", "center"];

/// Clés de style et valeurs admises ; la première valeur est celle par défaut.
pub type Style = Vec<(&'static str, Vec<Value>)>;

fn textes(l: &[&str]) -> Vec<Value> {
    l.iter().map(|s| json!(s)).collect()
}

pub fn couleurs() -> Vec<Value> {
    textes(&[
        "default", "blue", "green", "yellow", "orange", "red", "purple",
    ])
}

fn traits() -> Vec<Value> {
    textes(&["solid", "dashed", "dotted"])
}

fn epaisseurs() -> Vec<Value> {
    textes(&["thin", "medium", "thick"])
}

pub fn style_boite() -> Style {
    vec![
        (
            "shape",
            textes(&["rectangle", "rounded", "ellipse", "diamond", "note", "text"]),
        ),
        ("color", couleurs()),
        ("line", traits()),
        ("weight", epaisseurs()),
        (
            "opacity",
            vec![json!(100), json!(75), json!(50), json!(25), json!(0)],
        ),
        ("textSize", textes(&["normal", "small", "large", "xlarge"])),
    ]
}

pub fn style_trait() -> Style {
    vec![
        ("route", textes(&["direct", "orthogonal", "curved"])),
        ("ends", textes(&["end", "none", "start", "both"])),
        ("line", traits()),
        ("color", couleurs()),
        ("weight", epaisseurs()),
    ]
}

/// Un nombre entier, écrit `40` ou `40.0` ; `None` sinon.
fn entier(v: &Value) -> Option<i64> {
    if let Some(n) = v.as_i64() {
        return Some(n);
    }
    let f = v.as_f64()?;
    (f.fract() == 0.0 && f.abs() < 9e15).then_some(f as i64)
}

type Objet = Vec<(String, Value)>;

fn objet(
    nom: &str,
    i: usize,
    v: &Value,
    requises: &[&str],
    styles: &Style,
) -> Result<Objet, String> {
    let pre = format!("{nom}[{i}]");
    let o = v
        .as_object()
        .ok_or_else(|| format!("{pre}: not an object."))?;
    let mut sortie: Objet = Vec::new();
    for cle in requises {
        let x = o.get(*cle);
        let valeur = if ENTIERS.contains(cle) {
            x.and_then(entier).map(|n| json!(n))
        } else {
            x.filter(|x| x.is_string()).cloned()
        };
        sortie.push((
            cle.to_string(),
            valeur.ok_or_else(|| format!("{pre}: missing or invalid {cle}."))?,
        ));
    }
    for (cle, valeurs) in styles {
        let Some(x) = o.get(*cle) else { continue };
        let x = entier(x).map(|n| json!(n)).unwrap_or_else(|| x.clone());
        if !valeurs.contains(&x) {
            return Err(format!("{pre}: invalid {cle}."));
        }
        if x != valeurs[0] {
            sortie.push((cle.to_string(), x));
        }
    }
    Ok(sortie)
}

type Partie = (i64, i64, [bool; 4], String);
const STYLES_PARTIE: [&str; 4] = ["bold", "italic", "underline", "strike"];
const CLES_PARTIE: [&str; 7] = [
    "start",
    "end",
    "bold",
    "italic",
    "underline",
    "strike",
    "color",
];

/// Parties du texte → liste normalisée (triée, parties qui se touchent avec les mêmes styles
/// fondues, styles par défaut et parties sans style retirés), ou `None` si elle est refusée.
/// Les positions comptent en caractères Unicode, fin exclue.
fn spans(brut: Option<&Value>, texte: &str) -> Option<Vec<Value>> {
    let Some(brut) = brut else {
        return Some(vec![]);
    };
    let fin = texte.chars().count() as i64;
    let mut parties: Vec<Partie> = Vec::new();
    for p in brut.as_array()? {
        let o = p.as_object()?;
        let (start, end) = (entier(o.get("start")?)?, entier(o.get("end")?)?);
        if start < 0 || start >= end || end > fin {
            return None;
        }
        let mut styles = [false; 4];
        for (i, cle) in STYLES_PARTIE.iter().enumerate() {
            match o.get(*cle) {
                None => {}
                Some(Value::Bool(b)) => styles[i] = *b,
                Some(_) => return None,
            }
        }
        let couleur = match o.get("color") {
            None => "default".to_string(),
            Some(Value::String(c)) if couleurs().contains(&json!(c)) => c.clone(),
            Some(_) => return None,
        };
        parties.push((start, end, styles, couleur));
    }
    parties.sort_by_key(|p| p.0);
    let mut fondues: Vec<Partie> = Vec::new();
    let mut fin_precedente = 0;
    for p in parties {
        if p.0 < fin_precedente {
            return None;
        }
        fin_precedente = p.1;
        if p.2 == [false; 4] && p.3 == "default" {
            continue;
        }
        match fondues.last_mut() {
            Some(d) if d.1 == p.0 && d.2 == p.2 && d.3 == p.3 => d.1 = p.1,
            _ => fondues.push(p),
        }
    }
    Some(
        fondues
            .into_iter()
            .map(|(start, end, styles, couleur)| {
                let mut o = serde_json::Map::new();
                o.insert("start".into(), json!(start));
                o.insert("end".into(), json!(end));
                for (cle, v) in STYLES_PARTIE.iter().zip(styles) {
                    if v {
                        o.insert(cle.to_string(), json!(true));
                    }
                }
                if couleur != "default" {
                    o.insert("color".into(), json!(couleur));
                }
                Value::Object(o)
            })
            .collect(),
    )
}

/// Une liste de parties, sur la ligne de son objet : `[{"start": 0, "end": 5, "bold": true}]`.
fn ecrire_spans(parties: &Value) -> String {
    let objets: Vec<String> = parties
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| {
            let champs: Vec<String> = CLES_PARTIE
                .iter()
                .filter_map(|c| {
                    p.get(c)
                        .map(|v| format!("\"{c}\": {}", serde_json::to_string(v).unwrap()))
                })
                .collect();
            format!("{{{}}}", champs.join(", "))
        })
        .collect();
    format!("[{}]", objets.join(", "))
}

fn identifiant(o: &Objet) -> &str {
    o[0].1.as_str().unwrap_or("")
}

fn cote<'a>(v: &'a Value, cle: &str) -> Option<&'a str> {
    v.get(cle)?.as_str().filter(|c| COTES.contains(c))
}

fn liste<'a>(brut: &'a Value, cle: &str, facultative: bool) -> Result<&'a [Value], String> {
    match brut.get(cle) {
        Some(Value::Array(l)) => Ok(l),
        None if facultative => Ok(&[]),
        _ => Err(format!("{cle} must be a list.")),
    }
}

fn ligne(o: &Objet) -> String {
    let champs: Vec<String> = o
        .iter()
        .map(|(c, v)| {
            let v = if c == "spans" {
                ecrire_spans(v)
            } else {
                serde_json::to_string(v).unwrap()
            };
            format!("{}: {}", serde_json::to_string(c).unwrap(), v)
        })
        .collect();
    format!("    {{{}}}", champs.join(", "))
}

fn partie(nom: &str, objets: &[Objet]) -> String {
    if objets.is_empty() {
        return format!("  \"{nom}\": []");
    }
    let lignes: Vec<String> = objets.iter().map(ligne).collect();
    format!("  \"{nom}\": [\n{}\n  ]", lignes.join(",\n"))
}

/// Un whiteboard (valeur JSON) → texte du fichier, écrit comme Yaide l'écrit, et le nombre de
/// boîtes, de liens et de flèches libres. Le refus dit l'objet et la clé en cause.
pub fn en_texte(brut: &Value) -> Result<(String, [usize; 3]), String> {
    if !brut.is_object() {
        return Err("The whiteboard must be an object.".into());
    }
    if brut.get("version").and_then(entier) != Some(1) {
        return Err("version must be 1.".into());
    }
    let (b, l, a) = (
        liste(brut, "boxes", false)?,
        liste(brut, "links", false)?,
        liste(brut, "arrows", true)?,
    );
    let mut ids: HashSet<String> = HashSet::new();
    let mut verifier = |o: &Objet| -> Result<(), String> {
        let id = identifiant(o);
        if ids.insert(id.to_string()) {
            Ok(())
        } else {
            Err(format!("duplicate id {id}."))
        }
    };
    let style_b = style_boite();
    let style_t = style_trait();
    let mut boites = Vec::new();
    for (i, v) in b.iter().enumerate() {
        let mut o = objet("boxes", i, v, &CLES_BOITE, &style_b)?;
        let texte = o[5].1.as_str().unwrap_or("").to_string();
        let parties =
            spans(v.get("spans"), &texte).ok_or_else(|| format!("boxes[{i}]: invalid spans."))?;
        if !parties.is_empty() {
            o.insert(6, ("spans".into(), Value::Array(parties)));
        }
        verifier(&o)?;
        boites.push(o);
    }
    let ids_boites: HashSet<String> = boites.iter().map(|o| identifiant(o).to_string()).collect();
    let mut liens = Vec::new();
    for (i, v) in l.iter().enumerate() {
        let mut o = objet("links", i, v, &CLES_LIEN, &style_t)?;
        verifier(&o)?;
        let (de, vers) = (cote(v, "fromSide"), cote(v, "toSide"));
        if v.get("fromSide").is_some() || v.get("toSide").is_some() {
            let (Some(de), Some(vers)) = (de, vers) else {
                return Err(format!(
                    "links[{i}]: fromSide and toSide go together, each one of top, right, bottom, left, center (the box center; the line stops at its border)."
                ));
            };
            o.insert(3, ("fromSide".into(), json!(de)));
            o.insert(4, ("toSide".into(), json!(vers)));
        }
        // Le texte, ses parties et sa taille ne valent que pour les liens, après les styles.
        let texte = match v.get("text") {
            None => String::new(),
            Some(Value::String(t)) => t.clone(),
            Some(_) => return Err(format!("links[{i}]: missing or invalid text.")),
        };
        let parties =
            spans(v.get("spans"), &texte).ok_or_else(|| format!("links[{i}]: invalid spans."))?;
        let taille = match v.get("textSize") {
            None => None,
            Some(t) if style_b[5].1.contains(t) => {
                Some(t.clone()).filter(|t| *t != style_b[5].1[0])
            }
            Some(_) => return Err(format!("links[{i}]: invalid textSize.")),
        };
        if !texte.is_empty() {
            o.push(("text".into(), json!(texte)));
            if !parties.is_empty() {
                o.push(("spans".into(), Value::Array(parties)));
            }
        }
        if let Some(t) = taille {
            o.push(("textSize".into(), t));
        }
        for cle in [1, 2] {
            let boite = o[cle].1.as_str().unwrap_or("");
            if !ids_boites.contains(boite) {
                return Err(format!("links[{i}]: unknown box {boite}."));
            }
        }
        liens.push(o);
    }
    let mut libres = Vec::new();
    for (i, v) in a.iter().enumerate() {
        let o = objet("arrows", i, v, &CLES_LIBRE, &style_t)?;
        verifier(&o)?;
        libres.push(o);
    }
    let mut parties = vec![partie("boxes", &boites), partie("links", &liens)];
    if !libres.is_empty() {
        parties.push(partie("arrows", &libres));
    }
    let texte = format!("{{\n  \"version\": 1,\n{}\n}}\n", parties.join(",\n"));
    Ok((texte, [boites.len(), liens.len(), libres.len()]))
}

/// Texte d'un fichier → texte tel que Yaide l'écrit. Un texte vide est le whiteboard vide.
pub fn relire(texte: &str) -> Result<String, String> {
    if texte.trim().is_empty() {
        return en_texte(&json!({"version": 1, "boxes": [], "links": []})).map(|r| r.0);
    }
    let brut: Value =
        serde_json::from_str(texte).map_err(|_| "The file is not valid JSON.".to_string())?;
    en_texte(&brut).map(|r| r.0)
}
