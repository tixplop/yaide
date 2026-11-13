//! Base de connaissance : configuration, passages, vecteurs, stockage et recherche
//! (DEC-072 à DEC-075). Stockée sous `.yaide/connaissance/` du projet.

use crate::agent::provider::{self, ErreurProvider, Provider};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const PASSAGE_MAX: usize = 2000;
const LOT: usize = 64;
const RESULTATS_MAX: usize = 10;
const PROVIDERS_ADMIS: [&str; 5] = ["openai", "google", "openrouter", "litellm", "ollama"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Config {
    pub provider: String,
    pub modele: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Passage {
    pub chemin: String,
    pub debut: usize,
    pub fin: usize,
    pub texte: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Fichier {
    chemin: String,
    empreinte: String,
    passages: Vec<Passage>,
    #[serde(skip)]
    vecteurs: Vec<Vec<f32>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct Collection {
    nom: String,
    dimension: usize,
    fichiers: Vec<Fichier>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Resume {
    pub nom: String,
    pub fichiers: usize,
    pub passages: usize,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Trouve {
    pub chemin: String,
    pub debut: usize,
    pub fin: usize,
    pub collection: String,
    pub score: f32,
    pub texte: String,
}

#[derive(Debug, PartialEq)]
pub struct Ajout {
    pub ajoutes: usize,
    pub inchanges: usize,
    pub retires: usize,
}

/// Ce qu'il faut pour joindre le provider des vecteurs.
pub struct Acces<'a> {
    pub client: &'a reqwest::Client,
    pub provider: Provider,
    pub adresse: &'a str,
    pub cle: Option<&'a str>,
    pub modele: &'a str,
}

/// Erreur d'ajout ou de recherche : la cause, et le texte du provider tel quel (vide sinon).
#[derive(Debug, PartialEq)]
pub struct Erreur {
    pub cause: String,
    pub detail: String,
}

impl From<String> for Erreur {
    fn from(cause: String) -> Self {
        Erreur {
            cause,
            detail: String::new(),
        }
    }
}

impl From<&str> for Erreur {
    fn from(cause: &str) -> Self {
        cause.to_string().into()
    }
}

impl Acces<'_> {
    async fn vecteurs(&self, textes: &[String]) -> Result<Vec<Vec<f32>>, Erreur> {
        if self.provider.cle_obligatoire() && self.cle.is_none_or(|c| c.is_empty()) {
            return Err(format!(
                "Aucune clé pour {}. Ajoutez-la avec Ctrl+P, puis > Providers LLM.",
                self.provider.nom()
            )
            .into());
        }
        provider::embeddings(
            self.client,
            self.provider,
            self.adresse,
            self.cle,
            self.modele,
            textes,
        )
        .await
        .map_err(|e| erreur_provider(self.provider, e))
    }
}

/// Même forme que l'entrée d'erreur de la conversation : cause d'un côté, texte du provider de l'autre.
pub fn erreur_provider(provider: Provider, e: ErreurProvider) -> Erreur {
    match e {
        ErreurProvider::Refus { code, corps } => Erreur {
            cause: format!("{} a refusé la requête ({code}).", provider.nom()),
            detail: corps,
        },
        ErreurProvider::Injoignable(cause) => {
            format!("{} est injoignable : {cause}.", provider.nom()).into()
        }
    }
}

pub struct Base {
    racine: PathBuf,
}

/// Découpe un fichier en passages de lignes entières de 2 000 caractères au plus ;
/// une ligne plus longue est coupée en morceaux de 2 000, sans recouvrement.
pub fn decouper(chemin: &str, contenu: &str) -> Vec<Passage> {
    fn vider(
        passages: &mut Vec<Passage>,
        chemin: &str,
        courant: &mut Vec<&str>,
        debut: usize,
        fin: usize,
    ) {
        let texte = courant.join("\n");
        if !texte.trim().is_empty() {
            passages.push(Passage {
                chemin: chemin.to_string(),
                debut,
                fin,
                texte,
            });
        }
        courant.clear();
    }
    let mut passages = Vec::new();
    let mut courant: Vec<&str> = Vec::new();
    let mut taille = 0;
    let mut debut = 1;
    for (i, ligne) in contenu.lines().enumerate() {
        let numero = i + 1;
        let n = ligne.chars().count();
        if n > PASSAGE_MAX {
            vider(&mut passages, chemin, &mut courant, debut, numero - 1);
            let car: Vec<char> = ligne.chars().collect();
            for morceau in car.chunks(PASSAGE_MAX) {
                let texte: String = morceau.iter().collect();
                if !texte.trim().is_empty() {
                    passages.push(Passage {
                        chemin: chemin.to_string(),
                        debut: numero,
                        fin: numero,
                        texte,
                    });
                }
            }
            debut = numero + 1;
            taille = 0;
            continue;
        }
        let ajout = if courant.is_empty() { n } else { n + 1 };
        if taille + ajout > PASSAGE_MAX {
            vider(&mut passages, chemin, &mut courant, debut, numero - 1);
            debut = numero;
            taille = n;
        } else {
            taille += ajout;
        }
        courant.push(ligne);
    }
    vider(
        &mut passages,
        chemin,
        &mut courant,
        debut,
        contenu.lines().count(),
    );
    passages
}

fn empreinte(contenu: &str) -> String {
    let d = ring::digest::digest(&ring::digest::SHA256, contenu.as_bytes());
    d.as_ref().iter().map(|o| format!("{o:02x}")).collect()
}

pub fn valider_nom(nom: &str) -> Result<(), String> {
    let n = nom.chars().count();
    if n == 0
        || n > 40
        || !nom
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(
            "Le nom d'une collection compte de 1 à 40 caractères : lettres, chiffres, - et _."
                .into(),
        );
    }
    Ok(())
}

fn ecrire_atomique(chemin: &Path, contenu: &[u8]) -> Result<(), String> {
    let erreur = |e: std::io::Error| format!("écriture de {} impossible : {e}", chemin.display());
    let parent = chemin.parent().ok_or("chemin invalide")?;
    std::fs::create_dir_all(parent).map_err(erreur)?;
    let tmp = chemin.with_extension(format!("tmp{}", std::process::id()));
    let res = std::fs::write(&tmp, contenu).and_then(|_| std::fs::rename(&tmp, chemin));
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res.map_err(erreur)
}

fn cosinus(a: &[f32], b: &[f32]) -> f32 {
    let (mut ab, mut aa, mut bb) = (0f32, 0f32, 0f32);
    for (x, y) in a.iter().zip(b) {
        ab += x * y;
        aa += x * x;
        bb += y * y;
    }
    if aa == 0.0 || bb == 0.0 {
        0.0
    } else {
        ab / (aa.sqrt() * bb.sqrt())
    }
}

impl Base {
    pub fn new(projet: &Path) -> Self {
        Base {
            racine: projet.join(".yaide").join("connaissance"),
        }
    }

    fn fichier_config(&self) -> PathBuf {
        self.racine.join("config.json")
    }

    fn dossier_collections(&self) -> PathBuf {
        self.racine.join("collections")
    }

    /// `None` si aucune configuration n'est enregistrée.
    pub fn lire_config(&self) -> Result<Option<Config>, String> {
        let chemin = self.fichier_config();
        let brut = match std::fs::read_to_string(&chemin) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("{} est illisible : {e}", chemin.display())),
        };
        serde_json::from_str(&brut)
            .map(Some)
            .map_err(|e| format!("{} est illisible : {e}", chemin.display()))
    }

    pub fn ecrire_config(&self, provider: &str, modele: &str) -> Result<Config, String> {
        if !PROVIDERS_ADMIS.contains(&provider) {
            return Err("Ce provider ne fournit pas de vecteurs.".into());
        }
        let modele = modele.trim();
        if modele.is_empty() {
            return Err("Le modèle est obligatoire.".into());
        }
        let nouvelle = Config {
            provider: provider.into(),
            modele: modele.into(),
        };
        let actuelle = self.lire_config()?;
        if actuelle.as_ref() == Some(&nouvelle) {
            return Ok(nouvelle);
        }
        if !self.noms_collections()?.is_empty() {
            return Err("Supprimez les collections pour changer de provider ou de modèle.".into());
        }
        let brut = serde_json::to_vec_pretty(&nouvelle).map_err(|e| e.to_string())?;
        ecrire_atomique(&self.fichier_config(), &brut)?;
        Ok(nouvelle)
    }

    fn noms_collections(&self) -> Result<Vec<String>, String> {
        let dossier = self.dossier_collections();
        let entrees = match std::fs::read_dir(&dossier) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(format!("lecture de {} impossible : {e}", dossier.display())),
        };
        let mut noms: Vec<String> = entrees
            .filter_map(|e| e.ok())
            .filter(|e| e.path().join("passages.json").is_file())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        noms.sort_by_key(|n| n.to_lowercase());
        Ok(noms)
    }

    /// Nom exact d'une collection existante, cherché sans tenir compte de la casse.
    pub fn trouver(&self, nom: &str) -> Result<Option<String>, String> {
        Ok(self
            .noms_collections()?
            .into_iter()
            .find(|n| n.eq_ignore_ascii_case(nom)))
    }

    fn charger(&self, dossier_nom: &str) -> Result<Collection, String> {
        let dossier = self.dossier_collections().join(dossier_nom);
        let lire = |f: &str| {
            std::fs::read(dossier.join(f))
                .map_err(|e| format!("lecture de {} impossible : {e}", dossier.join(f).display()))
        };
        let brut = lire("passages.json")?;
        let mut c: Collection = serde_json::from_slice(&brut).map_err(|e| {
            format!(
                "{} est illisible : {e}",
                dossier.join("passages.json").display()
            )
        })?;
        let octets = lire("vecteurs.bin")?;
        let total: usize = c.fichiers.iter().map(|f| f.passages.len()).sum();
        if octets.len() != total * c.dimension * 4 {
            return Err(format!(
                "{} ne correspond pas à passages.json.",
                dossier.join("vecteurs.bin").display()
            ));
        }
        let mut flottants = octets
            .as_chunks::<4>()
            .0
            .iter()
            .map(|o| f32::from_le_bytes(*o));
        for f in &mut c.fichiers {
            f.vecteurs = (0..f.passages.len())
                .map(|_| flottants.by_ref().take(c.dimension).collect())
                .collect();
        }
        Ok(c)
    }

    fn enregistrer(&self, c: &Collection) -> Result<(), String> {
        let dossier = self.dossier_collections().join(&c.nom);
        let mut octets = Vec::new();
        for v in c.fichiers.iter().flat_map(|f| &f.vecteurs) {
            for x in v {
                octets.extend_from_slice(&x.to_le_bytes());
            }
        }
        let json = serde_json::to_vec(c).map_err(|e| e.to_string())?;
        // Les deux temporaires d'abord, puis les deux renommages à la suite.
        let fichiers = [("vecteurs.bin", octets), ("passages.json", json)];
        let mut temporaires = Vec::new();
        for (nom, contenu) in &fichiers {
            let cible = dossier.join(nom);
            let tmp = cible.with_extension(format!("tmp{}", std::process::id()));
            let res = std::fs::create_dir_all(&dossier).and_then(|_| std::fs::write(&tmp, contenu));
            temporaires.push((tmp, cible));
            if let Err(e) = res {
                for (t, _) in &temporaires {
                    let _ = std::fs::remove_file(t);
                }
                return Err(format!(
                    "écriture de {} impossible : {e}",
                    dossier.display()
                ));
            }
        }
        for (tmp, cible) in temporaires {
            std::fs::rename(&tmp, &cible)
                .map_err(|e| format!("écriture de {} impossible : {e}", cible.display()))?;
        }
        Ok(())
    }

    pub fn liste(&self) -> Result<Vec<Resume>, String> {
        self.noms_collections()?
            .iter()
            .map(|n| {
                let c = self.charger(n)?;
                Ok(Resume {
                    nom: c.nom.clone(),
                    fichiers: c.fichiers.len(),
                    passages: c.fichiers.iter().map(|f| f.passages.len()).sum(),
                })
            })
            .collect()
    }

    /// Chemins des fichiers d'une collection, par ordre alphabétique.
    pub fn fichiers(&self, nom: &str) -> Result<Vec<String>, String> {
        let exact = self.trouver(nom)?.ok_or("Cette collection n'existe pas.")?;
        let mut chemins: Vec<String> = self
            .charger(&exact)?
            .fichiers
            .into_iter()
            .map(|f| f.chemin)
            .collect();
        chemins.sort();
        Ok(chemins)
    }

    pub fn supprimer(&self, nom: &str) -> Result<(), String> {
        let exact = self.trouver(nom)?.ok_or("Cette collection n'existe pas.")?;
        let dossier = self.dossier_collections().join(exact);
        std::fs::remove_dir_all(&dossier)
            .map_err(|e| format!("suppression de {} impossible : {e}", dossier.display()))
    }

    /// Ajoute `fichiers` (chemin depuis le projet, contenu) à la collection `nom`, créée au besoin.
    /// Un fichier dont l'empreinte n'a pas changé n'est pas renvoyé au provider ; un fichier de la
    /// collection sous `portee` (dossier ou fichier) et absent de `fichiers` est retiré.
    /// En cas d'erreur du provider, les fichiers entièrement traités avant restent enregistrés.
    pub async fn ajouter(
        &self,
        acces: &Acces<'_>,
        nom: &str,
        portee: &str,
        fichiers: &[(String, String)],
    ) -> Result<Ajout, Erreur> {
        valider_nom(nom)?;
        self.lire_config()?;
        let exact = self.trouver(nom)?;
        let mut coll = match &exact {
            Some(e) => self.charger(e)?,
            None => Collection {
                nom: nom.to_string(),
                dimension: 0,
                fichiers: Vec::new(),
            },
        };
        let portee = portee.trim_matches('/');
        let dans_portee = |c: &str| {
            portee.is_empty()
                || c == portee
                || c.strip_prefix(portee).is_some_and(|r| r.starts_with('/'))
        };
        let avant = coll.fichiers.len();
        coll.fichiers
            .retain(|f| !dans_portee(&f.chemin) || fichiers.iter().any(|(c, _)| *c == f.chemin));
        let retires = avant - coll.fichiers.len();

        let mut inchanges = 0;
        let mut nouveaux: Vec<Fichier> = Vec::new();
        for (chemin, contenu) in fichiers {
            let emp = empreinte(contenu);
            if coll
                .fichiers
                .iter()
                .any(|f| f.chemin == *chemin && f.empreinte == emp)
            {
                inchanges += 1;
                continue;
            }
            nouveaux.push(Fichier {
                chemin: chemin.clone(),
                empreinte: emp,
                passages: decouper(chemin, contenu),
                vecteurs: Vec::new(),
            });
        }
        let textes: Vec<String> = nouveaux
            .iter()
            .flat_map(|f| f.passages.iter().map(|p| p.texte.clone()))
            .collect();
        let mut vecteurs: Vec<Vec<f32>> = Vec::new();
        let mut echec: Option<Erreur> = None;
        for lot in textes.chunks(LOT) {
            match acces.vecteurs(lot).await {
                Ok(v) => vecteurs.extend(v),
                Err(e) => {
                    echec = Some(e);
                    break;
                }
            }
        }
        // Les fichiers dont tous les vecteurs sont arrivés.
        let mut ajoutes = 0;
        let mut curseur = 0;
        for mut f in nouveaux {
            let n = f.passages.len();
            if curseur + n > vecteurs.len() {
                break;
            }
            f.vecteurs = vecteurs[curseur..curseur + n].to_vec();
            curseur += n;
            if let Some(v) = f.vecteurs.first() {
                if v.is_empty() {
                    echec = Some("Le provider a rendu un vecteur vide.".into());
                    break;
                }
                if coll.dimension != 0 && v.len() != coll.dimension {
                    echec = Some("La dimension des vecteurs du provider a changé.".into());
                    break;
                }
                coll.dimension = v.len();
            }
            if f.vecteurs.iter().any(|v| v.len() != coll.dimension) {
                echec = Some("Le provider a rendu des vecteurs de tailles différentes.".into());
                break;
            }
            coll.fichiers.retain(|e| e.chemin != f.chemin);
            coll.fichiers.push(f);
            ajoutes += 1;
        }
        if ajoutes > 0 || retires > 0 || (exact.is_none() && echec.is_none()) {
            coll.fichiers.sort_by(|a, b| a.chemin.cmp(&b.chemin));
            self.enregistrer(&coll)?;
        }
        match echec {
            Some(e) => Err(e),
            None => Ok(Ajout {
                ajoutes,
                inchanges,
                retires,
            }),
        }
    }

    /// Les 10 passages les plus proches de la question, dans une collection ou dans toutes.
    /// Rien n'est gardé en mémoire ensuite (AC-029-2).
    pub async fn chercher(
        &self,
        acces: &Acces<'_>,
        question: &str,
        collection: Option<&str>,
    ) -> Result<Vec<Trouve>, Erreur> {
        self.lire_config()?;
        let noms = match collection {
            Some(n) => vec![self.trouver(n)?.ok_or("Cette collection n'existe pas.")?],
            None => self.noms_collections()?,
        };
        let mut v = acces.vecteurs(&[question.to_string()]).await?;
        let q = v.pop().ok_or("Le provider n'a rendu aucun vecteur.")?;
        let mut trouves = Vec::new();
        for nom in noms {
            let c = self.charger(&nom)?;
            if c.dimension != q.len() {
                continue;
            }
            for f in c.fichiers {
                for (p, vec) in f.passages.into_iter().zip(&f.vecteurs) {
                    trouves.push(Trouve {
                        chemin: p.chemin,
                        debut: p.debut,
                        fin: p.fin,
                        collection: c.nom.clone(),
                        score: cosinus(&q, vec),
                        texte: p.texte,
                    });
                }
            }
        }
        trouves.sort_by(|a, b| b.score.total_cmp(&a.score));
        trouves.truncate(RESULTATS_MAX);
        Ok(trouves)
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use axum::{body::Bytes, extract::State, http::HeaderMap, http::StatusCode, Router};
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    type Recues = Arc<Mutex<Vec<(String, Option<String>, Value)>>>;

    #[derive(Clone)]
    struct Faux {
        recues: Recues,
        statut: u16,
        ok_avant: usize,
    }

    /// Vecteur déterministe : un texte « x<n> » donne [n, 1], sinon [1, 0].
    fn vecteur(t: &str) -> Vec<f32> {
        match t.strip_prefix('x').and_then(|n| n.parse::<f32>().ok()) {
            Some(n) => vec![n, 1.0],
            None => vec![1.0, 0.0],
        }
    }

    async fn gerer(
        State(f): State<Faux>,
        uri: axum::http::Uri,
        h: HeaderMap,
        corps: Bytes,
    ) -> (StatusCode, String) {
        let v: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
        let auth = h
            .get("authorization")
            .map(|a| a.to_str().unwrap().to_string());
        f.recues
            .lock()
            .unwrap()
            .push((uri.path().to_string(), auth, v.clone()));
        let deja = f.recues.lock().unwrap().len();
        if deja > f.ok_avant {
            let code = if f.statut == 200 { 500 } else { f.statut };
            return (StatusCode::from_u16(code).unwrap(), "non".into());
        }
        let entrees = v["input"].as_array().cloned().unwrap_or_default();
        // Rangés à l'envers avec leur index : le client doit les remettre dans l'ordre.
        let data: Vec<Value> = entrees
            .iter()
            .enumerate()
            .rev()
            .map(|(i, t)| json!({"index": i, "embedding": vecteur(t.as_str().unwrap())}))
            .collect();
        (StatusCode::OK, json!({ "data": data }).to_string())
    }

    async fn faux(statut: u16) -> (String, Recues) {
        faux_limite(statut, if statut == 200 { usize::MAX - 1 } else { 0 }).await
    }

    /// Répond 200 aux `ok_avant` premières requêtes, puis `statut`.
    async fn faux_limite(statut: u16, ok_avant: usize) -> (String, Recues) {
        let recues = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new().fallback(gerer).with_state(Faux {
            recues: recues.clone(),
            statut,
            ok_avant,
        });
        let ecoute = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let adresse = format!("http://{}", ecoute.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(ecoute, app).await.unwrap() });
        (adresse, recues)
    }

    fn client() -> reqwest::Client {
        let _ = rustls::crypto::ring::default_provider().install_default();
        provider::client()
    }

    fn projet() -> (PathBuf, Base) {
        let d = std::env::temp_dir().join(format!(
            "yaide-connaissance-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        let b = Base::new(&d);
        (d, b)
    }

    fn acces<'a>(c: &'a reqwest::Client, adresse: &'a str, cle: Option<&'a str>) -> Acces<'a> {
        Acces {
            client: c,
            provider: Provider::LiteLLM,
            adresse,
            cle,
            modele: "mod-v1",
        }
    }

    fn f(chemin: &str, contenu: &str) -> (String, String) {
        (chemin.to_string(), contenu.to_string())
    }

    #[test]
    fn REQ103_AC3_config_ecrite_puis_relue_et_yaide_cree_seulement_la() {
        let (d, b) = projet();
        assert_eq!(b.lire_config().unwrap(), None);
        assert!(!d.join(".yaide").exists());
        b.ecrire_config("ollama", "nomic-embed-text").unwrap();
        let relue = Base::new(&d).lire_config().unwrap().unwrap();
        assert_eq!(relue.provider, "ollama");
        assert_eq!(relue.modele, "nomic-embed-text");
        let brut = std::fs::read_to_string(d.join(".yaide/connaissance/config.json")).unwrap();
        assert!(brut.contains("\"modele\""));
    }

    #[test]
    fn REQ103_AC4_modele_vide_ou_provider_refuse_rien_n_est_ecrit() {
        let (d, b) = projet();
        assert_eq!(
            b.ecrire_config("ollama", "  ").unwrap_err(),
            "Le modèle est obligatoire."
        );
        let sans = "Ce provider ne fournit pas de vecteurs.";
        assert_eq!(b.ecrire_config("anthropic", "m").unwrap_err(), sans);
        assert_eq!(b.ecrire_config("inconnu", "m").unwrap_err(), sans);
        assert!(!d.join(".yaide").exists());
    }

    #[tokio::test]
    async fn REQ103_AC5_refus_de_changer_tant_qu_une_collection_existe() {
        let (_d, b) = projet();
        b.ecrire_config("litellm", "mod-v1").unwrap();
        let (a, _) = faux(200).await;
        let c = client();
        b.ajouter(&acces(&c, &a, None), "notes", "", &[f("a.md", "un")])
            .await
            .unwrap();
        let refus = "Supprimez les collections pour changer de provider ou de modèle.";
        assert_eq!(b.ecrire_config("ollama", "autre").unwrap_err(), refus);
        assert_eq!(b.ecrire_config("litellm", "mod-v2").unwrap_err(), refus);
        assert_eq!(b.lire_config().unwrap().unwrap().modele, "mod-v1");
        b.supprimer("NOTES").unwrap();
        b.ecrire_config("ollama", "autre").unwrap();
    }

    #[tokio::test]
    async fn REQ103_AC7_config_illisible_erreur_avec_chemin_jamais_reecrite() {
        let (d, b) = projet();
        let chemin = d.join(".yaide/connaissance/config.json");
        std::fs::create_dir_all(chemin.parent().unwrap()).unwrap();
        std::fs::write(&chemin, "{ cassé").unwrap();
        let e = b.lire_config().unwrap_err();
        assert!(e.contains(&chemin.display().to_string()), "{e}");
        assert!(b.ecrire_config("ollama", "m").is_err());
        let (a, recues) = faux(200).await;
        let c = client();
        let e2 = b
            .ajouter(&acces(&c, &a, None), "notes", "", &[f("a", "x")])
            .await
            .unwrap_err();
        assert_eq!(e2, Erreur::from(e.clone()));
        assert_eq!(
            b.chercher(&acces(&c, &a, None), "q", None)
                .await
                .unwrap_err(),
            Erreur::from(e)
        );
        assert_eq!(std::fs::read_to_string(&chemin).unwrap(), "{ cassé");
        assert!(recues.lock().unwrap().is_empty());
    }

    #[test]
    fn REQ104_AC4_decoupage_lignes_entieres_sans_recouvrement() {
        let contenu: String = (0..300).map(|_| "a".repeat(19) + "\n").collect();
        let ps = decouper("f.md", &contenu);
        assert_eq!(ps.len(), 3);
        let mut suivante = 1;
        for p in &ps {
            assert!(p.texte.chars().count() <= 2000);
            assert_eq!(p.debut, suivante);
            assert_eq!(p.texte.lines().count(), p.fin - p.debut + 1);
            suivante = p.fin + 1;
        }
        assert_eq!(suivante, 301);
        // Ligne de 5 000 caractères : trois morceaux ; numéros à partir de 1.
        let ps = decouper("g", &format!("a\n{}\nb", "é".repeat(5000)));
        let lignes: Vec<(usize, usize, usize)> = ps
            .iter()
            .map(|p| (p.debut, p.fin, p.texte.chars().count()))
            .collect();
        assert_eq!(
            lignes,
            vec![
                (1, 1, 1),
                (2, 2, 2000),
                (2, 2, 2000),
                (2, 2, 1000),
                (3, 3, 1)
            ]
        );
    }

    #[tokio::test]
    async fn REQ104_AC4_130_passages_trois_requetes_de_64_au_plus() {
        let (_d, b) = projet();
        let (a, recues) = faux(200).await;
        let c = client();
        let contenu: String = (0..130)
            .map(|i| {
                format!(
                    "{}\n",
                    "z".repeat(1999 - i.to_string().len()) + &i.to_string()
                )
            })
            .collect();
        assert_eq!(decouper("g", &contenu).len(), 130);
        b.ajouter(&acces(&c, &a, None), "n", "", &[f("g.txt", &contenu)])
            .await
            .unwrap();
        let tailles: Vec<usize> = recues
            .lock()
            .unwrap()
            .iter()
            .map(|r| r.2["input"].as_array().unwrap().len())
            .collect();
        assert_eq!(tailles, vec![64, 64, 2]);
    }

    #[tokio::test]
    async fn REQ104_AC2_requete_embeddings_modele_et_cle_bearer() {
        let (_d, b) = projet();
        let (a, recues) = faux(200).await;
        let c = client();
        let mut ac = acces(&c, &a, Some("sk-test"));
        ac.provider = Provider::OpenAI;
        let r = b
            .ajouter(&ac, "notes", "docs", &[f("docs/a.md", "x1\nx2")])
            .await
            .unwrap();
        assert_eq!(
            r,
            Ajout {
                ajoutes: 1,
                inchanges: 0,
                retires: 0
            }
        );
        {
            let recues = recues.lock().unwrap();
            assert_eq!(recues[0].0, "/embeddings");
            assert_eq!(recues[0].1.as_deref(), Some("Bearer sk-test"));
            assert_eq!(recues[0].2["model"], "mod-v1");
            assert_eq!(recues[0].2["input"][0], "x1\nx2");
        }
        // Sans clé obligatoire : l'erreur d'AC-055-6, sans requête.
        let (a2, r2) = faux(200).await;
        let mut ac = acces(&c, &a2, None);
        ac.provider = Provider::OpenAI;
        let e = b.chercher(&ac, "q", None).await.unwrap_err();
        assert_eq!(
            e,
            Erreur::from("Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM.")
        );
        assert!(r2.lock().unwrap().is_empty());
        // Sans clé (LiteLLM, Ollama) : aucun en-tête d'authentification (AC-052-7).
        b.chercher(&acces(&c, &a2, None), "q", None).await.unwrap();
        let recues = r2.lock().unwrap();
        assert_eq!(recues.len(), 1);
        assert_eq!(recues[0].1, None);
    }

    #[tokio::test]
    async fn REQ104_AC5_empreinte_inchange_non_renvoye_disparu_retire() {
        let (_d, b) = projet();
        let (a, recues) = faux(200).await;
        let c = client();
        let ac = acces(&c, &a, None);
        b.ajouter(
            &ac,
            "notes",
            "docs",
            &[
                f("docs/a.md", "x1"),
                f("docs/b.md", "x2"),
                f("docs/c.md", "x3"),
            ],
        )
        .await
        .unwrap();
        recues.lock().unwrap().clear();
        let r = b
            .ajouter(
                &ac,
                "Notes",
                "docs/",
                &[f("docs/a.md", "x9"), f("docs/c.md", "x3")],
            )
            .await
            .unwrap();
        assert_eq!(
            r,
            Ajout {
                ajoutes: 1,
                inchanges: 1,
                retires: 1
            }
        );
        let envoyes: Vec<Value> = recues
            .lock()
            .unwrap()
            .iter()
            .map(|r| r.2["input"].clone())
            .collect();
        assert_eq!(envoyes, vec![json!(["x9"])]);
        assert_eq!(b.fichiers("notes").unwrap(), vec!["docs/a.md", "docs/c.md"]);
        let t = b.chercher(&ac, "x", None).await.unwrap();
        assert!(
            t.iter().any(|p| p.texte == "x9")
                && !t.iter().any(|p| p.texte == "x1" || p.texte == "x2")
        );
    }

    #[tokio::test]
    async fn REQ104_AC9_refus_ou_injoignable_fichiers_precedents_gardes() {
        let (_d, b) = projet();
        let c = client();
        // a : 64 passages (un lot) ; b : 1 passage, dans le lot qui est refusé.
        let a64: String = (0..64).map(|_| "y".repeat(1999) + "\n").collect();
        let (a, _) = faux_limite(401, 1).await;
        let e = b
            .ajouter(
                &acces(&c, &a, None),
                "n",
                "",
                &[f("a.txt", &a64), f("b.txt", "x1")],
            )
            .await
            .unwrap_err();
        assert_eq!(e.cause, "LiteLLM a refusé la requête (401).");
        assert_eq!(e.detail, "non");
        assert_eq!(b.fichiers("n").unwrap(), vec!["a.txt"]);
        let e = b
            .ajouter(
                &acces(&c, "http://127.0.0.1:1", None),
                "n",
                "c.txt",
                &[f("c.txt", "x2")],
            )
            .await
            .unwrap_err();
        assert!(
            e.cause.starts_with("LiteLLM est injoignable : "),
            "{}",
            e.cause
        );
        assert_eq!(e.detail, "");
        assert_eq!(
            b.liste().unwrap(),
            vec![Resume {
                nom: "n".into(),
                fichiers: 1,
                passages: 64
            }]
        );
        let (bon, _) = faux(200).await;
        let t = b.chercher(&acces(&c, &bon, None), "q", None).await.unwrap();
        assert_eq!(t.len(), 10);
        assert!(t.iter().all(|p| p.chemin == "a.txt"));
    }

    #[tokio::test]
    async fn REQ106_AC1_dix_meilleurs_dans_l_ordre_cosinus() {
        let (d, b) = projet();
        let (a, recues) = faux(200).await;
        let c = client();
        let ac = acces(&c, &a, None);
        // Questions « x » → [1, 0] ; passage « x<n> » → [n, 1] : plus n est grand, plus il est proche.
        let fichiers: Vec<(String, String)> = (1..=12)
            .map(|n| f(&format!("f{n:02}.txt"), &format!("x{n}")))
            .collect();
        b.ajouter(&ac, "notes", "", &fichiers).await.unwrap();
        recues.lock().unwrap().clear();
        let t = b.chercher(&ac, "x", None).await.unwrap();
        assert_eq!(recues.lock().unwrap()[0].2["input"][0], "x");
        let textes: Vec<&str> = t.iter().map(|p| p.texte.as_str()).collect();
        assert_eq!(
            textes,
            ["x12", "x11", "x10", "x9", "x8", "x7", "x6", "x5", "x4", "x3"]
        );
        assert_eq!(
            (
                t[0].chemin.as_str(),
                t[0].debut,
                t[0].fin,
                t[0].collection.as_str()
            ),
            ("f12.txt", 1, 1, "notes")
        );
        assert!(t[0].score > t[1].score && t[0].score < 1.0);
        // Moins de 10 passages : tous.
        let (_d2, b2) = projet();
        b2.ajouter(&ac, "n", "", &fichiers[..3]).await.unwrap();
        assert_eq!(b2.chercher(&ac, "x", None).await.unwrap().len(), 3);
        drop(d);
    }

    #[tokio::test]
    async fn REQ106_AC2_collection_visee_ou_toutes() {
        let (_d, b) = projet();
        let (a, _) = faux(200).await;
        let c = client();
        let ac = acces(&c, &a, None);
        b.ajouter(&ac, "notes", "", &[f("n.md", "x1")])
            .await
            .unwrap();
        b.ajouter(&ac, "api", "", &[f("a.md", "x5")]).await.unwrap();
        let api = b.chercher(&ac, "x", Some("API")).await.unwrap();
        assert_eq!(api.len(), 1);
        assert_eq!(api[0].collection, "api");
        let tous = b.chercher(&ac, "x", None).await.unwrap();
        let ordre: Vec<&str> = tous.iter().map(|p| p.collection.as_str()).collect();
        assert_eq!(ordre, ["api", "notes"]);
        assert!(b.chercher(&ac, "x", Some("zzz")).await.is_err());
        let liste: Vec<String> = b.liste().unwrap().into_iter().map(|r| r.nom).collect();
        assert_eq!(liste, ["api", "notes"]);
    }

    #[test]
    fn REQ104_AC4_nom_de_collection_valide() {
        assert!(valider_nom("notes_API-2").is_ok());
        assert!(valider_nom("").is_err());
        assert!(valider_nom("a b").is_err());
        assert!(valider_nom("é").is_err());
        assert!(valider_nom(&"a".repeat(41)).is_err());
        assert!(valider_nom(&"a".repeat(40)).is_ok());
    }
}
