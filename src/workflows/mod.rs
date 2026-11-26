//! Workflows du projet (REQ-190 à REQ-195, DEC-127) : un fichier `.yaide/workflows/<fichier>.json`
//! par workflow ; liste, lecture, création, enregistrement, publication et dépublication.
pub mod execution;
pub mod verification;

use crate::agent::agents::nom_de_dossier;
use crate::config;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;

/// Types de déclencheur ; les autres types connus sont des actions.
pub const DECLENCHEURS: [&str; 3] = ["dossier", "planification", "appel"];
const ACTIONS: [&str; 4] = ["agent", "shell", "claude", "fichier"];

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Noeud {
    pub id: String,
    #[serde(rename = "type")]
    pub genre: String,
    pub titre: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub reglages: Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Lien {
    pub de: String,
    pub vers: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Workflow {
    pub nom: String,
    #[serde(default)]
    pub publie: bool,
    #[serde(default)]
    pub noeuds: Vec<Noeud>,
    #[serde(default)]
    pub liens: Vec<Lien>,
}

#[derive(Debug)]
pub enum Erreur {
    Inconnu,
    /// Enregistrement d'un workflow publié.
    Publie,
    /// Saisie refusée, avec le texte à montrer.
    Refus(String),
    /// Problèmes de la vérification.
    Messages(Vec<String>),
    Systeme(String),
}

pub struct Workflows {
    dossier: PathBuf,
    verrou: Mutex<()>,
}

/// Un nom de fichier sain : ni séparateur, ni point au début.
fn fichier_sain(f: &str) -> bool {
    !f.is_empty() && !f.contains('/') && !f.contains('\\') && !f.starts_with('.')
}

impl Workflows {
    pub fn new(yaide: PathBuf) -> Self {
        Workflows {
            dossier: yaide.join("workflows"),
            verrou: Mutex::new(()),
        }
    }

    fn verrouiller(&self) -> std::sync::MutexGuard<'_, ()> {
        self.verrou.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lire_fichier(&self, fichier: &str) -> Option<Workflow> {
        let octets = std::fs::read(self.dossier.join(format!("{fichier}.json"))).ok()?;
        serde_json::from_slice(&octets).ok()
    }

    fn ecrire(&self, fichier: &str, w: &Workflow) -> Result<(), Erreur> {
        let octets = serde_json::to_vec_pretty(w).map_err(|e| Erreur::Systeme(e.to_string()))?;
        config::ecrire_atomique(&self.dossier.join(format!("{fichier}.json")), &octets)
            .map_err(Erreur::Systeme)
    }

    /// (fichier, workflow) lisibles, puis les fichiers illisibles. Ne crée rien.
    fn parcourir(&self) -> (Vec<(String, Workflow)>, Vec<String>) {
        let mut lus = Vec::new();
        let mut illisibles = Vec::new();
        let entrees = std::fs::read_dir(&self.dossier)
            .map(|d| d.flatten().collect::<Vec<_>>())
            .unwrap_or_default();
        for e in entrees {
            let nom = e.file_name().to_string_lossy().into_owned();
            let Some(fichier) = nom.strip_suffix(".json") else {
                continue;
            };
            match self.lire_fichier(fichier) {
                Some(w) => lus.push((fichier.to_string(), w)),
                None => illisibles.push(nom),
            }
        }
        lus.sort_by_key(|(f, w)| (w.nom.to_lowercase(), f.clone()));
        illisibles.sort();
        (lus, illisibles)
    }

    pub fn lister(&self) -> Value {
        let _g = self.verrouiller();
        let (lus, illisibles) = self.parcourir();
        let workflows: Vec<Value> = lus
            .iter()
            .map(|(f, w)| json!({ "nom": w.nom, "fichier": f, "publie": w.publie }))
            .collect();
        let erreurs: Vec<String> = illisibles
            .iter()
            .map(|n| {
                format!(".yaide/workflows/{n} est illisible. Corrigez-le, puis rouvrez Workflows.")
            })
            .collect();
        json!({ "workflows": workflows, "erreurs": erreurs })
    }

    /// (fichier, workflow) des workflows publiés, pour la surveillance de leurs déclencheurs.
    pub fn publies(&self) -> Vec<(String, Workflow)> {
        let _g = self.verrouiller();
        let (lus, _) = self.parcourir();
        lus.into_iter().filter(|(_, w)| w.publie).collect()
    }

    fn vue(fichier: &str, w: &Workflow) -> Value {
        let mut v = serde_json::to_value(w).unwrap_or_default();
        v["fichier"] = json!(fichier);
        v
    }

    pub fn lire(&self, fichier: &str) -> Result<Value, Erreur> {
        let _g = self.verrouiller();
        if !fichier_sain(fichier) {
            return Err(Erreur::Inconnu);
        }
        let w = self.lire_fichier(fichier).ok_or(Erreur::Inconnu)?;
        Ok(Self::vue(fichier, &w))
    }

    /// Un brouillon sans nœud (AC-190-3).
    pub fn creer(&self, nom: &str) -> Result<Value, Erreur> {
        let _g = self.verrouiller();
        let nom = nom.trim();
        if nom.is_empty() {
            return Err(Erreur::Refus("Donnez un nom au workflow.".into()));
        }
        let (lus, _) = self.parcourir();
        if lus
            .iter()
            .any(|(_, w)| w.nom.to_lowercase() == nom.to_lowercase())
        {
            return Err(Erreur::Refus(
                "Ce nom est déjà pris. Choisissez-en un autre.".into(),
            ));
        }
        let racine = nom_de_dossier(nom);
        let mut fichier = racine.clone();
        let mut n = 2;
        while self.dossier.join(format!("{fichier}.json")).exists() {
            fichier = format!("{racine}-{n}");
            n += 1;
        }
        let w = Workflow {
            nom: nom.to_string(),
            publie: false,
            noeuds: Vec::new(),
            liens: Vec::new(),
        };
        self.ecrire(&fichier, &w)?;
        Ok(Self::vue(&fichier, &w))
    }

    /// Remplace les nœuds et les liens ; le nom et l'état ne changent pas ici.
    pub fn enregistrer(&self, fichier: &str, saisie: &Value) -> Result<Value, Erreur> {
        let _g = self.verrouiller();
        if !fichier_sain(fichier) {
            return Err(Erreur::Inconnu);
        }
        let mut w = self.lire_fichier(fichier).ok_or(Erreur::Inconnu)?;
        if w.publie {
            return Err(Erreur::Publie);
        }
        let invalide = || Erreur::Refus("Workflow invalide.".into());
        let noeuds: Vec<Noeud> = saisie
            .get("noeuds")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .ok_or_else(invalide)?;
        let liens: Vec<Lien> = saisie
            .get("liens")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .ok_or_else(invalide)?;
        let connu = |n: &Noeud| {
            DECLENCHEURS.contains(&n.genre.as_str()) || ACTIONS.contains(&n.genre.as_str())
        };
        let ids_uniques = noeuds
            .iter()
            .enumerate()
            .all(|(i, n)| noeuds[..i].iter().all(|m| m.id != n.id));
        let liens_ok = liens
            .iter()
            .all(|l| noeuds.iter().any(|n| n.id == l.de) && noeuds.iter().any(|n| n.id == l.vers));
        let reglages_ok = noeuds.iter().all(|n| n.reglages.is_object());
        if !noeuds.iter().all(connu) || !ids_uniques || !liens_ok || !reglages_ok {
            return Err(invalide());
        }
        w.noeuds = noeuds;
        w.liens = liens;
        self.ecrire(fichier, &w)?;
        Ok(Self::vue(fichier, &w))
    }

    /// Vérifie, puis passe à « publié » ; sans rien écrire si la vérification refuse.
    pub fn publier(&self, fichier: &str) -> Result<Value, Erreur> {
        let _g = self.verrouiller();
        if !fichier_sain(fichier) {
            return Err(Erreur::Inconnu);
        }
        let mut w = self.lire_fichier(fichier).ok_or(Erreur::Inconnu)?;
        let messages = verification::verifier(&w);
        if !messages.is_empty() {
            return Err(Erreur::Messages(messages));
        }
        w.publie = true;
        self.ecrire(fichier, &w)?;
        Ok(Self::vue(fichier, &w))
    }

    pub fn depublier(&self, fichier: &str) -> Result<Value, Erreur> {
        let _g = self.verrouiller();
        if !fichier_sain(fichier) {
            return Err(Erreur::Inconnu);
        }
        let mut w = self.lire_fichier(fichier).ok_or(Erreur::Inconnu)?;
        w.publie = false;
        self.ecrire(fichier, &w)?;
        Ok(Self::vue(fichier, &w))
    }
}
