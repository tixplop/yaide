//! Agents personnalisés : un dossier `.yaide/agents/<dossier>/` par agent (DEC-044).

use super::reglages::{Erreur, Reglages};
use crate::config;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub const COULEURS: [&str; 6] = ["violet", "vert", "orange", "rose", "sarcelle", "gris"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    /// Nom du dossier ; il ne figure pas dans `agent.json`.
    #[serde(default)]
    pub dossier: String,
    pub nom: String,
    #[serde(default)]
    pub avatar: String,
    pub couleur: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profil: Option<String>,
    /// Absente d'`agent.json` quand elle est vide (REQ-163).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub declencheurs: Vec<Declencheur>,
}

/// Un déclencheur : `type` parmi `fichier`, `dossier`, `commit`, `commande`, `configuration`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Declencheur {
    #[serde(rename = "type")]
    pub genre: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chemin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub texte: Option<String>,
}

/// Vérifie la saisie des déclencheurs ; refus : `(rang, champ)`.
fn declencheurs_de(saisie: &Value) -> Result<Vec<Declencheur>, Vec<(usize, &'static str)>> {
    let mut sortie = Vec::new();
    let mut refus = Vec::new();
    for (i, d) in saisie
        .get("declencheurs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let genre = d.get("type").and_then(Value::as_str).unwrap_or("");
        let champ = |c: &str| {
            d.get(c)
                .and_then(Value::as_str)
                .map(|t| t.trim().to_string())
        };
        let mut decl = Declencheur {
            genre: genre.to_string(),
            chemin: None,
            texte: None,
        };
        match genre {
            "fichier" | "dossier" => match champ("chemin") {
                Some(c) if chemin_du_projet(&c) => decl.chemin = Some(c),
                _ => refus.push((i, "chemin")),
            },
            "commande" => match d.get("texte").and_then(Value::as_str) {
                Some(t) if !t.trim().is_empty() => decl.texte = Some(t.to_string()),
                _ => refus.push((i, "texte")),
            },
            "commit" | "configuration" => {}
            _ => refus.push((i, "type")),
        }
        sortie.push(decl);
    }
    if refus.is_empty() {
        Ok(sortie)
    } else {
        Err(refus)
    }
}

/// Relatif, non vide, sans `..` qui sorte du projet ; `.` désigne tout le projet.
fn chemin_du_projet(c: &str) -> bool {
    use std::path::Component;
    if c.is_empty() || c.contains('\0') {
        return false;
    }
    let mut profondeur = 0usize;
    for p in std::path::Path::new(c).components() {
        match p {
            Component::Normal(_) => profondeur += 1,
            Component::CurDir => {}
            Component::ParentDir => match profondeur.checked_sub(1) {
                Some(n) => profondeur = n,
                None => return false,
            },
            _ => return false,
        }
    }
    true
}

#[derive(Serialize, Debug)]
pub struct Liste {
    pub agents: Vec<Agent>,
    /// Chemins des `agent.json` illisibles.
    pub erreurs: Vec<String>,
}

pub struct Agents {
    dossier: PathBuf,
    reglages: Arc<Reglages>,
    verrou: Mutex<()>,
}

fn base(c: char) -> char {
    const TABLE: [(&str, char); 8] = [
        ("àáâãäåāăą", 'a'),
        ("çćčĉċ", 'c'),
        ("èéêëēĕėęě", 'e'),
        ("ìíîïĩīĭį", 'i'),
        ("ñńņň", 'n'),
        ("òóôõöøōŏő", 'o'),
        ("ùúûüũūŭůűų", 'u'),
        ("ýÿ", 'y'),
    ];
    TABLE
        .iter()
        .find(|(lettres, _)| lettres.contains(c))
        .map_or(c, |(_, b)| *b)
}

/// Nom de dossier d'après le nom de l'agent.
fn nom_de_dossier(nom: &str) -> String {
    let mut sortie = String::new();
    for c in nom.to_lowercase().chars().map(base) {
        let c = if c.is_ascii_lowercase() || c.is_ascii_digit() {
            c
        } else {
            '-'
        };
        if c != '-' || !sortie.ends_with('-') {
            sortie.push(c);
        }
    }
    let t = sortie.trim_matches('-');
    if t.is_empty() { "agent" } else { t }.to_string()
}

impl Agents {
    pub fn new(yaide: PathBuf, reglages: Arc<Reglages>) -> Self {
        Agents {
            dossier: yaide.join("agents"),
            reglages,
            verrou: Mutex::new(()),
        }
    }

    fn lister_sans_verrou(&self) -> Liste {
        let mut agents = Vec::new();
        let mut erreurs = Vec::new();
        let entrees = std::fs::read_dir(&self.dossier)
            .map(|d| d.flatten().collect::<Vec<_>>())
            .unwrap_or_default();
        for e in entrees {
            if !e.path().is_dir() {
                continue;
            }
            let dossier = e.file_name().to_string_lossy().into_owned();
            let lu = std::fs::read(e.path().join("agent.json"))
                .ok()
                .and_then(|o| serde_json::from_slice::<Agent>(&o).ok());
            match lu {
                Some(mut a) => {
                    a.dossier = dossier;
                    agents.push(a);
                }
                None => erreurs.push(format!(".yaide/agents/{dossier}/agent.json")),
            }
        }
        agents.sort_by_key(|a| (a.nom.to_lowercase(), a.dossier.clone()));
        erreurs.sort();
        Liste { agents, erreurs }
    }

    /// Un agent d'après son dossier ; `None` s'il est inconnu ou illisible.
    pub fn lire(&self, dossier: &str) -> Option<Agent> {
        let _g = self.verrouiller();
        self.lister_sans_verrou()
            .agents
            .into_iter()
            .find(|a| a.dossier == dossier)
    }

    /// Ne crée rien (AC-064-8).
    pub fn lister(&self) -> Liste {
        let _g = self.verrouiller();
        self.lister_sans_verrou()
    }

    fn verrouiller(&self) -> std::sync::MutexGuard<'_, ()> {
        self.verrou.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Sans `dossier` : création. Avec : modification de `agent.json` seul.
    pub fn enregistrer(&self, saisie: &Value) -> Result<Agent, Erreur> {
        let _g = self.verrouiller();
        let chaine = |c: &str| saisie.get(c).and_then(Value::as_str);
        let existant = match chaine("dossier") {
            None => None,
            Some(d) => {
                let sain = !d.is_empty() && !d.contains('/') && !d.starts_with('.');
                if !sain || !self.dossier.join(d).is_dir() {
                    return Err(Erreur::Inconnu);
                }
                Some(d.to_string())
            }
        };
        let nom = chaine("nom").unwrap_or("").trim().to_string();
        let avatar = chaine("avatar").unwrap_or("").trim().to_string();
        let couleur = chaine("couleur").unwrap_or("").to_string();
        let profil = chaine("profil").filter(|p| !p.is_empty()).map(String::from);
        let mut champs = Vec::new();
        let pris = self.lister_sans_verrou().agents.iter().any(|a| {
            Some(&a.dossier) != existant.as_ref() && a.nom.to_lowercase() == nom.to_lowercase()
        });
        if nom.is_empty() || pris {
            champs.push("nom");
        }
        if avatar.chars().count() > 16 || avatar.chars().any(char::is_control) {
            champs.push("avatar");
        }
        if !COULEURS.contains(&couleur.as_str()) {
            champs.push("couleur");
        }
        if profil
            .as_ref()
            .is_some_and(|p| !self.reglages.ids_profils().contains(p))
        {
            champs.push("profil");
        }
        let declencheurs = declencheurs_de(saisie);
        let declencheurs = match declencheurs {
            Ok(d) if champs.is_empty() => d,
            Ok(_) => return Err(Erreur::Champs(champs)),
            Err(rangs) => return Err(Erreur::Declencheurs(champs, rangs)),
        };
        let mut agent = Agent {
            dossier: String::new(),
            nom,
            avatar,
            couleur,
            profil,
            declencheurs,
        };
        // Le dossier n'est pas dans `agent.json`.
        let mut fiche = serde_json::json!({
            "nom": agent.nom, "avatar": agent.avatar, "couleur": agent.couleur,
        });
        if let Some(p) = &agent.profil {
            fiche["profil"] = Value::String(p.clone());
        }
        if !agent.declencheurs.is_empty() {
            fiche["declencheurs"] = serde_json::to_value(&agent.declencheurs).unwrap_or_default();
        }
        let octets =
            serde_json::to_vec_pretty(&fiche).map_err(|e| Erreur::Systeme(e.to_string()))?;
        let dossier = match existant {
            Some(d) => d,
            None => {
                let racine = nom_de_dossier(&agent.nom);
                let mut d = racine.clone();
                let mut n = 2;
                while self.dossier.join(&d).exists() {
                    d = format!("{racine}-{n}");
                    n += 1;
                }
                d
            }
        };
        let chemin = self.dossier.join(&dossier);
        std::fs::create_dir_all(&chemin).map_err(|e| Erreur::Systeme(e.to_string()))?;
        config::ecrire_atomique(&chemin.join("agent.json"), &octets).map_err(Erreur::Systeme)?;
        for md in ["AGENTS.md", "PERSONA.md"] {
            let f = chemin.join(md);
            if !f.exists() {
                std::fs::write(&f, b"").map_err(|e| Erreur::Systeme(e.to_string()))?;
            }
        }
        agent.dossier = dossier;
        Ok(agent)
    }
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use serde_json::json;

    fn agents(nom: &str) -> (Agents, PathBuf) {
        let d = std::env::temp_dir().join(format!("agents-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let y = d.join("projet/.yaide");
        let r = Arc::new(Reglages::new(y.clone(), d.join("cfg")));
        (Agents::new(y.clone(), r), y)
    }

    fn saisie(nom: &str) -> Value {
        json!({ "nom": nom, "avatar": "", "couleur": "violet" })
    }

    #[test]
    fn REQ064_AC3_creation_trois_fichiers_dont_deux_vides() {
        let (a, y) = agents("ac3");
        let r = a.enregistrer(&saisie("Relecteur")).unwrap();
        assert_eq!(r.dossier, "relecteur");
        let d = y.join("agents/relecteur");
        assert!(d.join("agent.json").is_file());
        assert_eq!(std::fs::read(d.join("AGENTS.md")).unwrap(), b"");
        assert_eq!(std::fs::read(d.join("PERSONA.md")).unwrap(), b"");
        let json = std::fs::read_to_string(d.join("agent.json")).unwrap();
        assert!(!json.contains("dossier") && !json.contains("profil"));
        let l = a.lister();
        assert_eq!(l.agents.len(), 1);
        assert_eq!(l.agents[0].nom, "Relecteur");
        assert_eq!(l.agents[0].couleur, "violet");
        assert!(l.erreurs.is_empty());
    }

    #[test]
    fn REQ064_AC4_dossier_suffixe_2() {
        let (a, y) = agents("ac4");
        a.enregistrer(&saisie("Revue")).unwrap();
        let r = a.enregistrer(&saisie("Revue !")).unwrap();
        assert_eq!(r.dossier, "revue-2");
        assert!(y.join("agents/revue-2/agent.json").is_file());
        assert_eq!(a.enregistrer(&saisie("REVUE?")).unwrap().dossier, "revue-3");
    }

    #[test]
    fn REQ064_AC5_nom_vide_ou_pris_rien_ecrit() {
        let (a, y) = agents("ac5");
        assert_eq!(
            a.enregistrer(&saisie("  ")),
            Err(Erreur::Champs(vec!["nom"]))
        );
        assert!(!y.exists());
        a.enregistrer(&saisie("Relecteur")).unwrap();
        assert_eq!(
            a.enregistrer(&saisie("relecteur")),
            Err(Erreur::Champs(vec!["nom"]))
        );
        assert_eq!(std::fs::read_dir(y.join("agents")).unwrap().count(), 1);
        // Renommer en un nom pris par un autre.
        a.enregistrer(&saisie("Testeur")).unwrap();
        let mut s = saisie("testeur");
        s["dossier"] = json!("relecteur");
        assert_eq!(a.enregistrer(&s), Err(Erreur::Champs(vec!["nom"])));
    }

    #[test]
    fn REQ064_AC6_dossier_supprime_ou_copie() {
        let (a, y) = agents("ac6");
        a.enregistrer(&saisie("Relecteur")).unwrap();
        a.enregistrer(&saisie("Testeur")).unwrap();
        std::fs::remove_dir_all(y.join("agents/relecteur")).unwrap();
        let noms: Vec<_> = a.lister().agents.into_iter().map(|x| x.nom).collect();
        assert_eq!(noms, ["Testeur"]);
        copy(&y.join("agents/testeur"), &y.join("agents/copie"));
        let noms: Vec<_> = a.lister().agents.into_iter().map(|x| x.dossier).collect();
        assert_eq!(noms, ["copie", "testeur"]);
    }

    fn copy(de: &std::path::Path, vers: &std::path::Path) {
        std::fs::create_dir_all(vers).unwrap();
        for e in std::fs::read_dir(de).unwrap().flatten() {
            std::fs::copy(e.path(), vers.join(e.file_name())).unwrap();
        }
    }

    #[test]
    fn REQ064_AC7_agent_json_casse_nomme_le_fichier_les_autres_listes() {
        let (a, y) = agents("ac7");
        a.enregistrer(&saisie("Beta")).unwrap();
        a.enregistrer(&saisie("alpha")).unwrap();
        a.enregistrer(&saisie("Casse")).unwrap();
        let casse = y.join("agents/casse/agent.json");
        std::fs::write(&casse, "{ pas du json").unwrap();
        std::fs::create_dir_all(y.join("agents/vide")).unwrap();
        let l = a.lister();
        let noms: Vec<_> = l.agents.iter().map(|x| x.nom.as_str()).collect();
        assert_eq!(noms, ["alpha", "Beta"]);
        assert_eq!(
            l.erreurs,
            [
                ".yaide/agents/casse/agent.json",
                ".yaide/agents/vide/agent.json"
            ]
        );
        assert_eq!(std::fs::read_to_string(&casse).unwrap(), "{ pas du json");
        assert!(!y.join("agents/vide/agent.json").exists());
    }

    #[test]
    fn REQ065_AC1_modification_garde_le_dossier_et_les_md() {
        let (a, y) = agents("m1");
        let (r, _) = (a.enregistrer(&saisie("Relecteur")).unwrap(), ());
        std::fs::write(y.join("agents/relecteur/AGENTS.md"), "consignes").unwrap();
        let mut s = json!({ "dossier": r.dossier, "nom": "Autre nom", "avatar": "🦉",
            "couleur": "rose" });
        let m = a.enregistrer(&s).unwrap();
        assert_eq!(m.dossier, "relecteur");
        let l = a.lister().agents;
        assert_eq!(l[0].nom, "Autre nom");
        assert_eq!(l[0].avatar, "🦉");
        assert_eq!(l[0].couleur, "rose");
        assert_eq!(l[0].profil, None);
        assert_eq!(
            std::fs::read_to_string(y.join("agents/relecteur/AGENTS.md")).unwrap(),
            "consignes"
        );
        assert_eq!(std::fs::read_dir(y.join("agents")).unwrap().count(), 1);
        s["dossier"] = json!("inconnu");
        assert_eq!(a.enregistrer(&s), Err(Erreur::Inconnu));
        s["dossier"] = json!("../x");
        assert_eq!(a.enregistrer(&s), Err(Erreur::Inconnu));
    }

    #[test]
    fn REQ065_AC4_couleur_et_profil_inconnus_refuses() {
        let (a, y) = agents("ac4b");
        let mut s = saisie("X");
        s["couleur"] = json!("bleu");
        s["profil"] = json!("nope");
        s["avatar"] = json!("a\nb");
        assert_eq!(
            a.enregistrer(&s),
            Err(Erreur::Champs(vec!["avatar", "couleur", "profil"]))
        );
        s["avatar"] = json!("a".repeat(17));
        s["couleur"] = json!("gris");
        s["profil"] = Value::Null;
        assert_eq!(a.enregistrer(&s), Err(Erreur::Champs(vec!["avatar"])));
        assert!(!y.exists());
        s["avatar"] = json!("QA");
        assert!(a.enregistrer(&s).is_ok());
        // Un profil existant est accepté.
        a.reglages
            .enregistrer_profil(&json!({ "nom": "p", "provider": "openai", "modele": "m" }))
            .unwrap();
        let id = a.reglages.ids_profils().remove(0);
        let mut t = saisie("Y");
        t["profil"] = json!(id);
        assert_eq!(a.enregistrer(&t).unwrap().profil, Some(id));
    }

    #[test]
    fn REQ163_AC5_sans_cle_declencheurs_lu_vide_et_reecrit_sans_la_cle() {
        let (a, y) = agents("d5");
        a.enregistrer(&saisie("Relecteur")).unwrap();
        let f = y.join("agents/relecteur/agent.json");
        assert!(!std::fs::read_to_string(&f)
            .unwrap()
            .contains("declencheurs"));
        std::fs::write(&f, r#"{"nom":"Relecteur","avatar":"","couleur":"vert"}"#).unwrap();
        assert!(a.lire("relecteur").unwrap().declencheurs.is_empty());
        let mut s = saisie("Relecteur");
        s["dossier"] = json!("relecteur");
        a.enregistrer(&s).unwrap();
        assert!(!std::fs::read_to_string(&f)
            .unwrap()
            .contains("declencheurs"));
    }

    #[test]
    fn REQ163_chemins_du_projet() {
        for ok in [".", "a", "a/b.md", "a/../b", "./a"] {
            assert!(chemin_du_projet(ok), "{ok}");
        }
        for ko in ["", "/etc/passwd", "..", "../x", "a/../../x"] {
            assert!(!chemin_du_projet(ko), "{ko}");
        }
    }

    #[test]
    fn dossier_sans_accents_ni_symboles() {
        assert_eq!(nom_de_dossier("Éléonore Çà"), "eleonore-ca");
        assert_eq!(nom_de_dossier("  --Revue !! 2--"), "revue-2");
        assert_eq!(nom_de_dossier("🦉"), "agent");
        assert_eq!(nom_de_dossier(""), "agent");
    }
}
