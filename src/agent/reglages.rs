//! Réglages de l'agent : `.yaide/config.json` (adresses, profils) et clés d'API (DEC-033).

use super::provider::Provider;
use super::secrets;
use crate::config;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

const TOUS: [Provider; 6] = [
    Provider::OpenAI,
    Provider::Anthropic,
    Provider::Google,
    Provider::OpenRouter,
    Provider::LiteLLM,
    Provider::Ollama,
];

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
struct ReglageProvider {
    adresse: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profil {
    pub id: String,
    pub nom: String,
    pub provider: String,
    pub modele: String,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub sortie_max: Option<u64>,
    #[serde(default)]
    pub fenetre: Option<u64>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub defaut: bool,
}

#[derive(Serialize, Deserialize, Default, Debug)]
struct Fichier {
    #[serde(default)]
    providers: BTreeMap<String, ReglageProvider>,
    #[serde(default)]
    profils: Vec<Profil>,
}

#[derive(Debug, PartialEq)]
pub enum Erreur {
    /// Champs refusés, par nom.
    Champs(Vec<&'static str>),
    /// Provider ou profil inconnu.
    Inconnu,
    Systeme(String),
}

pub struct Reglages {
    yaide: PathBuf,
    cfg: PathBuf,
    verrou: Mutex<()>,
}

fn provider(id: &str) -> Option<Provider> {
    TOUS.into_iter().find(|p| p.id() == id)
}

fn adresse_valide(a: &str) -> bool {
    a.starts_with("http://") || a.starts_with("https://")
}

/// `None` si absent, nul ou vide ; `Err` si présent mais pas un entier positif.
fn entier_positif(v: Option<&Value>) -> Result<Option<u64>, ()> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(v) => v.as_u64().filter(|n| *n > 0).map(Some).ok_or(()),
    }
}

fn texte<'a>(corps: &'a Value, champ: &str) -> &'a str {
    corps
        .get(champ)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
}

/// Vérifie un profil (comme le front) ; `id` est celui du profil modifié.
fn valider(corps: &Value, existants: &[Profil], id: &str) -> Result<Profil, Vec<&'static str>> {
    let mut erreurs = Vec::new();
    let nom = texte(corps, "nom");
    let pris = existants
        .iter()
        .any(|p| p.id != id && p.nom.to_lowercase() == nom.to_lowercase());
    if nom.is_empty() || pris {
        erreurs.push("nom");
    }
    let prov = texte(corps, "provider");
    if provider(prov).is_none() {
        erreurs.push("provider");
    }
    let modele = texte(corps, "modele");
    if modele.is_empty() {
        erreurs.push("modele");
    }
    let effort = match texte(corps, "effort") {
        "" => None,
        e @ ("faible" | "moyen" | "eleve") => Some(e.to_string()),
        _ => {
            erreurs.push("effort");
            None
        }
    };
    let sortie_max = entier_positif(corps.get("sortieMax")).unwrap_or_else(|_| {
        erreurs.push("sortieMax");
        None
    });
    let fenetre = entier_positif(corps.get("fenetre")).unwrap_or_else(|_| {
        erreurs.push("fenetre");
        None
    });
    let temperature = match corps.get("temperature") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s.is_empty() => None,
        Some(v) => match v.as_f64().filter(|t| (0.0..=2.0).contains(t)) {
            Some(t) => Some(t),
            None => {
                erreurs.push("temperature");
                None
            }
        },
    };
    if !erreurs.is_empty() {
        return Err(erreurs);
    }
    Ok(Profil {
        id: id.to_string(),
        nom: nom.to_string(),
        provider: prov.to_string(),
        modele: modele.to_string(),
        effort,
        sortie_max,
        fenetre,
        temperature,
        defaut: corps
            .get("defaut")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn nouvel_id() -> Result<String, Erreur> {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut o = [0u8; 8];
    SystemRandom::new()
        .fill(&mut o)
        .map_err(|_| Erreur::Systeme("tirage aléatoire impossible".into()))?;
    Ok(o.iter().map(|b| format!("{b:02x}")).collect())
}

/// Un seul profil par défaut, et le premier l'est d'office s'il n'y en a aucun.
fn normaliser(profils: &mut [Profil], defaut: Option<&str>) {
    if let Some(id) = defaut {
        for p in profils.iter_mut() {
            p.defaut = p.id == id;
        }
    }
    if !profils.iter().any(|p| p.defaut) {
        if let Some(p) = profils.first_mut() {
            p.defaut = true;
        }
    }
}

impl Reglages {
    pub fn new(yaide: PathBuf, cfg: PathBuf) -> Self {
        Reglages {
            yaide,
            cfg,
            verrou: Mutex::new(()),
        }
    }

    fn fichier(&self) -> PathBuf {
        self.yaide.join("config.json")
    }

    /// Absent : réglages vides. Illisible : erreur qui nomme le fichier.
    fn charger(&self) -> Result<Fichier, String> {
        let f = self.fichier();
        match std::fs::read(&f) {
            Ok(octets) => serde_json::from_slice(&octets)
                .map_err(|e| format!("{} est illisible : {e}", f.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Fichier::default()),
            Err(e) => Err(format!("{} est illisible : {e}", f.display())),
        }
    }

    fn sauver(&self, f: &Fichier) -> Result<(), Erreur> {
        let octets = serde_json::to_vec_pretty(f).map_err(|e| Erreur::Systeme(e.to_string()))?;
        config::ecrire_atomique(&self.fichier(), &octets).map_err(Erreur::Systeme)
    }

    fn verrouiller(&self) -> std::sync::MutexGuard<'_, ()> {
        self.verrou.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Réglages pour le navigateur : jamais une clé.
    pub fn vue(&self) -> Value {
        let _g = self.verrouiller();
        let (fichier, e1) = match self.charger() {
            Ok(f) => (f, None),
            Err(e) => (Fichier::default(), Some(e)),
        };
        let (cles, e2) = match secrets::lire(&self.yaide, &self.cfg) {
            Ok(c) => (c, None),
            Err(e) => (Default::default(), Some(e)),
        };
        let providers: Vec<Value> = TOUS
            .iter()
            .map(|p| {
                let adresse = fichier
                    .providers
                    .get(p.id())
                    .map_or(p.adresse_par_defaut(), |r| r.adresse.as_str());
                json!({
                    "id": p.id(), "nom": p.nom(), "adresse": adresse,
                    "cle": cles.contains_key(p.id()), "cleObligatoire": p.cle_obligatoire(),
                })
            })
            .collect();
        json!({ "providers": providers, "profils": fichier.profils, "erreur": e1.or(e2) })
    }

    pub fn adresse(&self, id: &str) -> Option<String> {
        let _g = self.verrouiller();
        let p = provider(id)?;
        let f = self.charger().unwrap_or_default();
        Some(
            f.providers
                .get(id)
                .map_or(p.adresse_par_defaut().to_string(), |r| r.adresse.clone()),
        )
    }

    pub fn cle(&self, id: &str) -> Option<String> {
        let _g = self.verrouiller();
        secrets::lire(&self.yaide, &self.cfg).ok()?.remove(id)
    }

    /// Adresse vérifiée d'abord : si elle est refusée, rien n'est enregistré, pas même la clé.
    pub fn enregistrer_provider(&self, id: &str, corps: &Value) -> Result<(), Erreur> {
        let p = provider(id).ok_or(Erreur::Inconnu)?;
        let adresse = corps
            .get("adresse")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if !adresse_valide(adresse) {
            return Err(Erreur::Champs(vec!["adresse"]));
        }
        let _g = self.verrouiller();
        if let Some(cle) = corps
            .get("cle")
            .and_then(Value::as_str)
            .filter(|c| !c.is_empty())
        {
            let mut cles = secrets::lire(&self.yaide, &self.cfg).unwrap_or_default();
            cles.insert(id.to_string(), cle.to_string());
            secrets::ecrire(&self.yaide, &self.cfg, &cles).map_err(Erreur::Systeme)?;
        }
        let mut f = self.charger().unwrap_or_default();
        f.providers.insert(
            p.id().to_string(),
            ReglageProvider {
                adresse: adresse.to_string(),
            },
        );
        self.sauver(&f)
    }

    pub fn supprimer_cle(&self, id: &str) -> Result<(), Erreur> {
        provider(id).ok_or(Erreur::Inconnu)?;
        let _g = self.verrouiller();
        let mut cles = secrets::lire(&self.yaide, &self.cfg).map_err(Erreur::Systeme)?;
        if cles.remove(id).is_some() {
            secrets::ecrire(&self.yaide, &self.cfg, &cles).map_err(Erreur::Systeme)?;
        }
        Ok(())
    }

    /// Sans `id` dans le corps : création. Rien n'est enregistré si un champ est refusé.
    pub fn enregistrer_profil(&self, corps: &Value) -> Result<(), Erreur> {
        let _g = self.verrouiller();
        let mut f = self.charger().unwrap_or_default();
        let id = match corps.get("id").and_then(Value::as_str) {
            Some(id) if f.profils.iter().any(|p| p.id == id) => id.to_string(),
            Some(_) => return Err(Erreur::Inconnu),
            None => nouvel_id()?,
        };
        let profil = valider(corps, &f.profils, &id).map_err(Erreur::Champs)?;
        let defaut = profil.defaut.then(|| profil.id.clone());
        match f.profils.iter_mut().find(|p| p.id == id) {
            Some(p) => *p = profil,
            None => f.profils.push(profil),
        }
        normaliser(&mut f.profils, defaut.as_deref());
        self.sauver(&f)
    }

    pub fn supprimer_profil(&self, id: &str) -> Result<(), Erreur> {
        let _g = self.verrouiller();
        let mut f = self.charger().unwrap_or_default();
        let avant = f.profils.len();
        f.profils.retain(|p| p.id != id);
        if f.profils.len() == avant {
            return Err(Erreur::Inconnu);
        }
        normaliser(&mut f.profils, None);
        self.sauver(&f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reglages(nom: &str) -> (Reglages, PathBuf) {
        let d = std::env::temp_dir().join(format!("reglages-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let y = d.join("projet/.yaide");
        (Reglages::new(y.clone(), d.join("cfg")), y)
    }

    fn profil(nom: &str, defaut: bool) -> Value {
        json!({ "nom": nom, "provider": "openai", "modele": "gpt", "defaut": defaut })
    }

    fn noms(r: &Reglages) -> Vec<(String, bool)> {
        let v = r.vue();
        v["profils"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p["nom"].as_str().unwrap().into(),
                    p["defaut"].as_bool().unwrap(),
                )
            })
            .collect()
    }

    #[test]
    fn req052_ac2_secrets_chiffre_droits_600_et_config_sans_cle() {
        let (r, y) = reglages("ac2");
        let corps = json!({ "adresse": "http://localhost:1/v1", "cle": "sk-tres-secrete" });
        r.enregistrer_provider("openai", &corps).unwrap();
        let config = std::fs::read_to_string(y.join("config.json")).unwrap();
        assert!(!config.contains("sk-tres-secrete"));
        let secrets = std::fs::read(y.join("secrets")).unwrap();
        assert!(!String::from_utf8_lossy(&secrets).contains("sk-tres-secrete"));
        let vue = r.vue();
        assert_eq!(vue["providers"][0]["cle"], true);
        assert_eq!(vue["providers"][0]["adresse"], "http://localhost:1/v1");
        assert!(!vue.to_string().contains("sk-tres-secrete"));
    }

    #[test]
    fn req052_ac6_dechiffre_apres_relecture() {
        let (r, y) = reglages("ac6");
        let corps = json!({ "adresse": "https://x.test", "cle": "sk-abc" });
        r.enregistrer_provider("anthropic", &corps).unwrap();
        let r2 = Reglages::new(y, r.cfg.clone());
        assert_eq!(r2.cle("anthropic").as_deref(), Some("sk-abc"));
        assert_eq!(r2.adresse("anthropic").as_deref(), Some("https://x.test"));
        assert_eq!(r2.cle("openai"), None);
    }

    #[test]
    fn req052_ac5_adresse_refusee_rien_enregistre_pas_meme_la_cle() {
        let (r, y) = reglages("ac5");
        let corps = json!({ "adresse": "ftp://x", "cle": "sk-abc" });
        assert_eq!(
            r.enregistrer_provider("openai", &corps),
            Err(Erreur::Champs(vec!["adresse"]))
        );
        assert!(!y.exists());
        assert_eq!(
            r.enregistrer_provider("inconnu", &json!({ "adresse": "http://x" })),
            Err(Erreur::Inconnu)
        );
    }

    #[test]
    fn req051_ac4_json_casse_nomme_le_fichier_et_n_ecrase_rien() {
        let (r, y) = reglages("casse");
        std::fs::create_dir_all(&y).unwrap();
        std::fs::write(y.join("config.json"), "{ pas du json").unwrap();
        let vue = r.vue();
        assert!(vue["erreur"].as_str().unwrap().contains("config.json"));
        assert_eq!(vue["providers"].as_array().unwrap().len(), 6);
        assert_eq!(
            std::fs::read_to_string(y.join("config.json")).unwrap(),
            "{ pas du json"
        );
    }

    #[test]
    fn req051_ac4_cle_de_chiffrement_perdue() {
        let (r, y) = reglages("perdue");
        let corps = json!({ "adresse": "http://x.test", "cle": "sk-abc" });
        r.enregistrer_provider("openai", &corps).unwrap();
        std::fs::remove_file(secrets::fichier_cle(&r.cfg)).unwrap();
        let avant = std::fs::read(y.join("secrets")).unwrap();
        let vue = r.vue();
        assert!(vue["erreur"].as_str().unwrap().contains("secrets"));
        assert_eq!(vue["providers"][0]["cle"], false);
        assert_eq!(std::fs::read(y.join("secrets")).unwrap(), avant);
    }

    #[test]
    fn req053_ac2_refus_par_champ_rien_enregistre() {
        let (r, y) = reglages("ac2b");
        r.enregistrer_profil(&profil("Rapide", false)).unwrap();
        let avant = std::fs::read(y.join("config.json")).unwrap();
        let mauvais = json!({
            "nom": "rapide", "provider": "nulle-part", "modele": " ",
            "sortieMax": 0, "fenetre": -3, "temperature": 2.5,
        });
        assert_eq!(
            r.enregistrer_profil(&mauvais),
            Err(Erreur::Champs(vec![
                "nom",
                "provider",
                "modele",
                "sortieMax",
                "fenetre",
                "temperature"
            ]))
        );
        let vide = json!({ "nom": "", "provider": "openai", "modele": "m", "sortieMax": 1.5 });
        assert_eq!(
            r.enregistrer_profil(&vide),
            Err(Erreur::Champs(vec!["nom", "sortieMax"]))
        );
        assert_eq!(std::fs::read(y.join("config.json")).unwrap(), avant);
        let ok = json!({ "nom": "Autre", "provider": "ollama", "modele": "m",
            "sortieMax": 100, "fenetre": 8000, "temperature": 0, "effort": "moyen" });
        r.enregistrer_profil(&ok).unwrap();
    }

    #[test]
    fn req053_ac3_un_seul_defaut_et_le_premier_d_office() {
        let (r, _) = reglages("ac3");
        r.enregistrer_profil(&profil("a", false)).unwrap();
        assert_eq!(noms(&r), [("a".into(), true)]);
        r.enregistrer_profil(&profil("b", false)).unwrap();
        assert_eq!(noms(&r), [("a".into(), true), ("b".into(), false)]);
        r.enregistrer_profil(&profil("c", true)).unwrap();
        assert_eq!(
            noms(&r),
            [("a".into(), false), ("b".into(), false), ("c".into(), true)]
        );
    }

    #[test]
    fn req053_ac4_suppression_du_defaut_et_renommage_garde_l_id() {
        let (r, _) = reglages("ac4");
        r.enregistrer_profil(&profil("a", false)).unwrap();
        r.enregistrer_profil(&profil("b", false)).unwrap();
        let vue = r.vue();
        let id_b = vue["profils"][1]["id"].as_str().unwrap().to_string();
        let id_a = vue["profils"][0]["id"].as_str().unwrap().to_string();
        let mut renomme = profil("B2", false);
        renomme["id"] = json!(id_b);
        r.enregistrer_profil(&renomme).unwrap();
        assert_eq!(r.vue()["profils"][1]["id"], id_b.as_str());
        r.supprimer_profil(&id_a).unwrap();
        assert_eq!(noms(&r), [("B2".into(), true)]);
        assert_eq!(r.supprimer_profil("nul"), Err(Erreur::Inconnu));
    }
}
