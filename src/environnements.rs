//! Environnements (REQ-182) : `environnements.json` du dossier de configuration de l'utilisateur,
//! en clair, droits 600 (DEC-121). Chaque écriture relit le fichier et ne change que l'environnement visé.

use crate::config;
use serde::de::{MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::path::Path;
use std::sync::Mutex;

static ECRITURE: Mutex<()> = Mutex::new(());

/// Variables dans l'ordre du fichier ; une variable répétée garde sa dernière valeur.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Variables(pub Vec<(String, String)>);

impl Serialize for Variables {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            m.serialize_entry(k, v)?;
        }
        m.end()
    }
}

impl<'de> Deserialize<'de> for Variables {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Variables;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("un objet NOM: valeur")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Variables, A::Error> {
                let mut l: Vec<(String, String)> = Vec::new();
                while let Some((k, v)) = m.next_entry::<String, String>()? {
                    match l.iter_mut().find(|(n, _)| *n == k) {
                        Some(e) => e.1 = v,
                        None => l.push((k, v)),
                    }
                }
                Ok(Variables(l))
            }
        }
        d.deserialize_map(V)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Environnement {
    pub nom: String,
    #[serde(default)]
    pub variables: Variables,
}

#[derive(Default, Deserialize, Serialize)]
struct Fichier {
    #[serde(default)]
    environnements: Vec<Environnement>,
}

#[derive(Debug)]
pub enum Erreur {
    /// Saisie refusée : champ (`nom` ou `variables`) et message.
    Refus(&'static str, &'static str),
    /// Le fichier n'est pas du JSON valide : message de l'analyseur.
    Illisible(String),
    /// L'environnement visé n'est plus dans le fichier.
    Inconnu,
    /// Lecture ou écriture impossible : la raison.
    Systeme(String),
}

fn charger(fichier: &Path) -> Result<Fichier, Erreur> {
    let contenu = match std::fs::read_to_string(fichier) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Fichier::default()),
        Err(e) => {
            return Err(Erreur::Systeme(format!(
                "Impossible de lire {} : {e}.",
                fichier.display()
            )))
        }
    };
    serde_json::from_str(&contenu).map_err(|e| Erreur::Illisible(e.to_string()))
}

fn nom_variable_valide(n: &str) -> bool {
    let mut c = n.chars();
    matches!(c.next(), Some(p) if p.is_ascii_alphabetic() || p == '_')
        && c.all(|x| x.is_ascii_alphanumeric() || x == '_')
}

fn trier(l: &mut [Environnement]) {
    l.sort_by_key(|e| e.nom.to_lowercase());
}

/// Les environnements par ordre alphabétique sans casse ; fichier absent : liste vide, rien n'est créé.
pub fn lister(fichier: &Path) -> Result<Vec<Environnement>, Erreur> {
    let mut l = charger(fichier)?.environnements;
    trier(&mut l);
    Ok(l)
}

fn valider(autres: &[&Environnement], env: &Environnement) -> Result<(), Erreur> {
    if env.nom.trim().is_empty() {
        return Err(Erreur::Refus("nom", "Donnez un nom à l'environnement."));
    }
    let bas = env.nom.to_lowercase();
    if autres.iter().any(|e| e.nom.to_lowercase() == bas) {
        return Err(Erreur::Refus(
            "nom",
            "Ce nom est déjà pris. Choisissez-en un autre.",
        ));
    }
    if env.variables.0.iter().any(|(n, _)| !nom_variable_valide(n)) {
        return Err(Erreur::Refus(
            "variables",
            "Variables : une par ligne, sous la forme NOM=valeur (lettres, chiffres et _ dans le nom).",
        ));
    }
    Ok(())
}

fn ecrire(fichier: &Path, f: &Fichier) -> Result<(), Erreur> {
    let mut texte = serde_json::to_string_pretty(f).map_err(|e| Erreur::Systeme(e.to_string()))?;
    texte.push('\n');
    config::ecrire_atomique(fichier, texte.as_bytes()).map_err(Erreur::Systeme)
}

/// Enregistre `env` : relit le fichier, puis remplace `ancien` au même rang, ou ajoute à la fin.
pub fn enregistrer(
    fichier: &Path,
    ancien: Option<&str>,
    env: Environnement,
) -> Result<Vec<Environnement>, Erreur> {
    let _verrou = ECRITURE.lock().unwrap_or_else(|e| e.into_inner());
    let mut f = charger(fichier)?;
    let place = match ancien {
        Some(a) => Some(
            f.environnements
                .iter()
                .position(|e| e.nom == a)
                .ok_or(Erreur::Inconnu)?,
        ),
        None => None,
    };
    let autres: Vec<&Environnement> = f
        .environnements
        .iter()
        .enumerate()
        .filter(|(i, _)| Some(*i) != place)
        .map(|(_, e)| e)
        .collect();
    valider(&autres, &env)?;
    match place {
        Some(i) => f.environnements[i] = env,
        None => f.environnements.push(env),
    }
    ecrire(fichier, &f)?;
    trier(&mut f.environnements);
    Ok(f.environnements)
}

pub fn supprimer(fichier: &Path, nom: &str) -> Result<Vec<Environnement>, Erreur> {
    let _verrou = ECRITURE.lock().unwrap_or_else(|e| e.into_inner());
    let mut f = charger(fichier)?;
    let i = f
        .environnements
        .iter()
        .position(|e| e.nom == nom)
        .ok_or(Erreur::Inconnu)?;
    f.environnements.remove(i);
    ecrire(fichier, &f)?;
    trier(&mut f.environnements);
    Ok(f.environnements)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(nom: &str, v: &[(&str, &str)]) -> Environnement {
        Environnement {
            nom: nom.into(),
            variables: Variables(
                v.iter()
                    .map(|(a, b)| (a.to_string(), b.to_string()))
                    .collect(),
            ),
        }
    }

    fn fichier(test: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("env-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d.join("environnements.json")
    }

    #[test]
    fn req182_ac5_nom_vide_nom_pris_sans_casse_et_noms_de_variables() {
        let f = fichier("ac5");
        enregistrer(&f, None, env("prod", &[])).unwrap();
        let avant = std::fs::read_to_string(&f).unwrap();
        let vide = "Donnez un nom à l'environnement.";
        let pris = "Ce nom est déjà pris. Choisissez-en un autre.";
        let vars = "Variables : une par ligne, sous la forme NOM=valeur (lettres, chiffres et _ dans le nom).";
        for (e, champ, message) in [
            (env("", &[]), "nom", vide),
            (env("  ", &[]), "nom", vide),
            (env("Prod", &[]), "nom", pris),
            (env("x", &[("1A", "x")]), "variables", vars),
            (env("x", &[("A B", "x")]), "variables", vars),
            (env("x", &[("", "x")]), "variables", vars),
        ] {
            match enregistrer(&f, None, e.clone()) {
                Err(Erreur::Refus(c, m)) => assert_eq!((c, m), (champ, message), "{e:?}"),
                r => panic!("{e:?} : {r:?}"),
            }
        }
        assert!(enregistrer(&f, None, env("x", &[("_a1", ""), ("B", "a=b")])).is_ok());
        // Renommer `prod` en `Prod` reste permis.
        assert!(enregistrer(&f, Some("prod"), env("Prod", &[])).is_ok());
        assert_ne!(std::fs::read_to_string(&f).unwrap(), avant);
    }

    #[test]
    fn req182_ac6_ordre_alphabetique_sans_casse() {
        let f = fichier("ac6");
        for n in ["beta", "Alpha", "gamma"] {
            enregistrer(&f, None, env(n, &[])).unwrap();
        }
        let noms: Vec<_> = lister(&f).unwrap().into_iter().map(|e| e.nom).collect();
        assert_eq!(noms, ["Alpha", "beta", "gamma"]);
    }

    #[test]
    fn variable_repetee_garde_la_derniere_valeur_et_l_ordre() {
        let e: Environnement =
            serde_json::from_str(r#"{"nom":"a","variables":{"B":"1","A":"2","B":"3"}}"#).unwrap();
        assert_eq!(e, env("a", &[("B", "3"), ("A", "2")]));
    }
}
