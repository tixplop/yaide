//! Base de connaissance : configuration, passages, vecteurs, stockage et recherche
//! (DEC-072 à DEC-075). Stockée sous `.yaide/connaissance/` du projet.

use crate::agent::provider::{self, ErreurProvider, Provider};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
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
    /// Place du passage dans le fichier, en octets (début inclus, fin exclue).
    pub octet_debut: usize,
    pub octet_fin: usize,
    /// Le texte n'est jamais écrit : il sert à demander les vecteurs, puis il est relu dans le fichier.
    #[serde(skip)]
    pub texte: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Fichier {
    chemin: String,
    empreinte: String,
    /// Taille en octets et date de modification (ns depuis l'époque Unix) du contenu ajouté.
    taille: u64,
    date: u128,
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
        verifier_cle(self.provider, self.cle)?;
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

/// Refuse d'avance un provider qui demande une clé quand il n'y en a pas.
pub fn verifier_cle(provider: Provider, cle: Option<&str>) -> Result<(), String> {
    if provider.cle_obligatoire() && cle.is_none_or(|c| c.is_empty()) {
        return Err(format!(
            "Aucune clé pour {}. Ajoutez-la avec Ctrl+P, puis > Providers LLM.",
            provider.nom()
        ));
    }
    Ok(())
}

pub fn fournit_des_vecteurs(provider: &str) -> bool {
    PROVIDERS_ADMIS.contains(&provider)
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

#[derive(Clone)]
pub struct Base {
    projet: PathBuf,
    racine: PathBuf,
}

/// Découpe un fichier en passages de lignes entières de 2 000 caractères au plus ;
/// une ligne plus longue est coupée en morceaux de 2 000, sans recouvrement.
/// Le texte d'un passage est la tranche exacte du fichier, de `octet_debut` à `octet_fin`.
pub fn decouper(chemin: &str, contenu: &str) -> Vec<Passage> {
    let mut passages = Vec::new();
    let mut ajouter = |debut: usize, fin: usize, o1: usize, o2: usize| {
        let texte = &contenu[o1..o2];
        if !texte.trim().is_empty() {
            passages.push(Passage {
                chemin: chemin.to_string(),
                debut,
                fin,
                octet_debut: o1,
                octet_fin: o2,
                texte: texte.to_string(),
            });
        }
    };
    // Passage courant : octet de début, taille en caractères, octet de fin, dernière ligne.
    let mut debut = 1;
    let mut o_debut = 0;
    let mut taille = 0;
    let mut o_fin = 0;
    let mut vide = true;
    let mut pos = 0;
    let mut numero = 0;
    let mut separateur = 0; // caractères du saut de ligne qui précède la ligne
    for brute in contenu.split_inclusive('\n') {
        numero += 1;
        let debut_ligne = pos;
        pos += brute.len();
        let sans = brute.strip_suffix('\n').unwrap_or(brute);
        let sans = if brute.ends_with('\n') {
            sans.strip_suffix('\r').unwrap_or(sans)
        } else {
            sans
        };
        let fin_ligne = debut_ligne + sans.len();
        let n = sans.chars().count();
        let saut = brute.chars().count() - n;
        if n > PASSAGE_MAX {
            if !vide {
                ajouter(debut, numero - 1, o_debut, o_fin);
            }
            let mut o = debut_ligne;
            let mut compte = 0;
            for (i, _) in sans.char_indices() {
                if compte == PASSAGE_MAX {
                    ajouter(numero, numero, o, debut_ligne + i);
                    o = debut_ligne + i;
                    compte = 0;
                }
                compte += 1;
            }
            ajouter(numero, numero, o, fin_ligne);
            vide = true;
            debut = numero + 1;
            separateur = saut;
            continue;
        }
        if vide {
            o_debut = debut_ligne;
            debut = numero;
            taille = n;
        } else if taille + n + separateur > PASSAGE_MAX {
            ajouter(debut, numero - 1, o_debut, o_fin);
            debut = numero;
            o_debut = debut_ligne;
            taille = n;
        } else {
            taille += n + separateur;
        }
        vide = false;
        o_fin = fin_ligne;
        separateur = saut;
    }
    if !vide {
        ajouter(debut, numero, o_debut, o_fin);
    }
    passages
}

/// Taille et date tirées de la version rendue par `fichiers::lire` (« <ns>-<taille> »).
fn taille_date(version: &str) -> (u64, u128) {
    let (ns, taille) = version.split_once('-').unwrap_or(("0", "0"));
    (taille.parse().unwrap_or(0), ns.parse().unwrap_or(0))
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

/// Range dans la collection les fichiers de la file dont tous les vecteurs sont arrivés ;
/// rend leur nombre. Un vecteur incohérent met `echec` et arrête.
fn finaliser(
    coll: &mut Collection,
    nouveaux: &mut VecDeque<Fichier>,
    curseur: &mut usize,
    vecteurs: &[Vec<f32>],
    echec: &mut Option<Erreur>,
) -> usize {
    let mut n = 0;
    while let Some(f) = nouveaux.front() {
        let k = f.passages.len();
        if *curseur + k > vecteurs.len() {
            break;
        }
        let mut f = nouveaux.pop_front().expect("front vu");
        f.vecteurs = vecteurs[*curseur..*curseur + k].to_vec();
        *curseur += k;
        if let Some(v) = f.vecteurs.first() {
            if v.is_empty() {
                *echec = Some("Le provider a rendu un vecteur vide.".into());
                break;
            }
            if coll.dimension != 0 && v.len() != coll.dimension {
                *echec = Some("La dimension des vecteurs du provider a changé.".into());
                break;
            }
            coll.dimension = v.len();
        }
        if f.vecteurs.iter().any(|v| v.len() != coll.dimension) {
            *echec = Some("Le provider a rendu des vecteurs de tailles différentes.".into());
            break;
        }
        coll.fichiers.retain(|e| e.chemin != f.chemin);
        coll.fichiers.push(f);
        n += 1;
    }
    n
}

impl Base {
    pub fn new(projet: &Path) -> Self {
        Base {
            projet: projet.to_path_buf(),
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

    pub fn a_des_collections(&self) -> Result<bool, String> {
        Ok(!self.noms_collections()?.is_empty())
    }

    fn lire_sans_vecteurs(&self, nom: &str) -> Result<Collection, String> {
        let chemin = self.dossier_collections().join(nom).join("passages.json");
        let brut = std::fs::read(&chemin)
            .map_err(|e| format!("lecture de {} impossible : {e}", chemin.display()))?;
        serde_json::from_slice(&brut)
            .map_err(|e| format!("{} est illisible : {e}", chemin.display()))
    }

    /// Pour chaque fichier des collections, ses entrées (une par collection qui le contient,
    /// par ordre alphabétique) ; ne lit que `passages.json`.
    fn entrees(&self) -> Result<BTreeMap<String, Vec<Entree>>, String> {
        let mut m: BTreeMap<String, Vec<Entree>> = BTreeMap::new();
        for nom in self.noms_collections()? {
            for f in self.lire_sans_vecteurs(&nom)?.fichiers {
                m.entry(f.chemin).or_default().push(Entree {
                    collection: nom.clone(),
                    empreinte: f.empreinte,
                    taille: f.taille,
                    date: f.date,
                });
            }
        }
        Ok(m)
    }

    /// Collections de chaque fichier de la base (ordre alphabétique) ; vide si la base est illisible.
    pub fn collections_par_fichier(&self) -> BTreeMap<String, Vec<String>> {
        let mut m: BTreeMap<String, Vec<String>> = self
            .entrees()
            .unwrap_or_default()
            .into_iter()
            .map(|(c, es)| (c, es.into_iter().map(|e| e.collection).collect()))
            .collect();
        for noms in m.values_mut() {
            noms.sort_by_key(|n| n.to_lowercase());
        }
        m
    }

    /// Nombres de fichiers et de passages ; ne lit que `passages.json`, pas les vecteurs.
    pub fn liste(&self) -> Result<Vec<Resume>, String> {
        self.noms_collections()?
            .iter()
            .map(|n| {
                let c = self.lire_sans_vecteurs(n)?;
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
        fichiers: &[(String, String, String)],
    ) -> Result<Ajout, Erreur> {
        self.ajouter_avec(acces, nom, portee, fichiers, &|_| {})
            .await
    }

    /// Comme `ajouter`, avec la collection écrite après chaque lot de vecteurs (fichiers complets
    /// seulement) ; `progres` reçoit le nombre de fichiers traités à chaque étape.
    pub async fn ajouter_avec(
        &self,
        acces: &Acces<'_>,
        nom: &str,
        portee: &str,
        fichiers: &[(String, String, String)],
        progres: &(dyn Fn(usize) + Sync),
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
            .retain(|f| !dans_portee(&f.chemin) || fichiers.iter().any(|(c, _, _)| *c == f.chemin));
        let retires = avant - coll.fichiers.len();

        let mut inchanges = 0;
        let mut nouveaux: VecDeque<Fichier> = VecDeque::new();
        for (chemin, contenu, version) in fichiers {
            let (taille, date) = taille_date(version);
            let emp = empreinte(contenu);
            if coll
                .fichiers
                .iter()
                .any(|f| f.chemin == *chemin && f.empreinte == emp)
            {
                inchanges += 1;
                continue;
            }
            nouveaux.push_back(Fichier {
                chemin: chemin.clone(),
                empreinte: emp,
                taille,
                date,
                passages: decouper(chemin, contenu),
                vecteurs: Vec::new(),
            });
        }
        if inchanges > 0 {
            progres(inchanges);
        }
        let textes: Vec<String> = nouveaux
            .iter()
            .flat_map(|f| f.passages.iter().map(|p| p.texte.clone()))
            .collect();
        let mut vecteurs: Vec<Vec<f32>> = Vec::new();
        let mut echec: Option<Erreur> = None;
        let mut curseur = 0;
        let mut ajoutes = 0;
        let mut a_ecrire = retires > 0;
        let mut cree = exact.is_some();
        for lot in textes.chunks(LOT) {
            match acces.vecteurs(lot).await {
                Ok(v) => vecteurs.extend(v),
                Err(e) => {
                    echec = Some(e);
                    break;
                }
            }
            let n = finaliser(
                &mut coll,
                &mut nouveaux,
                &mut curseur,
                &vecteurs,
                &mut echec,
            );
            ajoutes += n;
            a_ecrire |= n > 0;
            if echec.is_some() {
                break;
            }
            if a_ecrire {
                coll.fichiers.sort_by(|a, b| a.chemin.cmp(&b.chemin));
                self.enregistrer(&coll)?;
                a_ecrire = false;
                cree = true;
            }
            progres(n);
        }
        if echec.is_none() {
            // Les fichiers sans passage, derniers de la file.
            let n = finaliser(
                &mut coll,
                &mut nouveaux,
                &mut curseur,
                &vecteurs,
                &mut echec,
            );
            ajoutes += n;
            a_ecrire |= n > 0;
            if n > 0 {
                progres(n);
            }
        }
        if a_ecrire || (!cree && echec.is_none()) {
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

    /// Les 10 passages les plus proches de la question, dans les collections nommées (casse
    /// ignorée) ou, liste vide, dans toutes, classés ensemble. Rien n'est gardé en mémoire
    /// ensuite (AC-029-2).
    pub async fn chercher(
        &self,
        acces: &Acces<'_>,
        question: &str,
        collections: &[String],
    ) -> Result<Vec<Trouve>, Erreur> {
        self.lire_config()?;
        let noms = if collections.is_empty() {
            self.noms_collections()?
        } else {
            let mut noms: Vec<String> = Vec::new();
            for n in collections {
                let exact = self.trouver(n)?.ok_or("Cette collection n'existe pas.")?;
                if !noms.contains(&exact) {
                    noms.push(exact);
                }
            }
            noms
        };
        let mut v = acces.vecteurs(&[question.to_string()]).await?;
        let q = v.pop().ok_or("Le provider n'a rendu aucun vecteur.")?;
        let mut candidats = Vec::new();
        for nom in noms {
            let c = self.charger(&nom)?;
            if c.dimension != q.len() {
                continue;
            }
            for f in c.fichiers {
                for (p, vec) in f.passages.into_iter().zip(&f.vecteurs) {
                    candidats.push((cosinus(&q, vec), c.nom.clone(), f.empreinte.clone(), p));
                }
            }
        }
        candidats.sort_by(|a, b| b.0.total_cmp(&a.0));
        // Le texte est relu dans le fichier ; un fichier absent ou changé ne donne aucun passage.
        let mut lus: std::collections::HashMap<String, Option<(String, String)>> =
            std::collections::HashMap::new();
        let mut trouves = Vec::new();
        for (score, collection, emp, p) in candidats {
            if trouves.len() == RESULTATS_MAX {
                break;
            }
            let lu = lus.entry(p.chemin.clone()).or_insert_with(|| {
                crate::fichiers::lire(&self.projet, &p.chemin)
                    .ok()
                    .map(|(t, _)| (empreinte(&t), t))
            });
            let Some((emp_lue, contenu)) = lu else {
                continue;
            };
            if *emp_lue != emp {
                continue;
            }
            let Some(texte) = contenu.get(p.octet_debut..p.octet_fin) else {
                continue;
            };
            trouves.push(Trouve {
                chemin: p.chemin,
                debut: p.debut,
                fin: p.fin,
                collection,
                score,
                texte: texte.to_string(),
            });
        }
        Ok(trouves)
    }
}

struct Entree {
    collection: String,
    empreinte: String,
    taille: u64,
    date: u128,
}

enum Action {
    Retirer,
    Toucher(u64, u128),
    Remplacer(Box<Fichier>),
}

/// Fichiers dont la dernière mise à jour automatique a échoué : chemin → (taille, date, cause).
/// En mémoire seulement : après un redémarrage, chaque fichier est réessayé une fois.
#[derive(Default)]
pub struct Echecs(std::sync::Mutex<HashMap<String, (u64, u128, String)>>);

impl Echecs {
    fn verrou(&self) -> std::sync::MutexGuard<'_, HashMap<String, (u64, u128, String)>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn cause(&self, chemin: &str) -> Option<String> {
        self.verrou().get(chemin).map(|e| e.2.clone())
    }

    /// Efface la ligne d'un fichier (mise à jour réussie, fichier sorti des collections).
    pub fn effacer(&self, chemin: &str) {
        self.verrou().remove(chemin);
    }

    fn noter(&self, chemin: &str, taille: u64, date: u128, cause: String) {
        self.verrou()
            .insert(chemin.to_string(), (taille, date, cause));
    }
}

/// Provider, adresse, clé et modèle de la base, ou la raison pour laquelle on ne peut pas le joindre.
pub type AccesBase = Result<(Provider, String, Option<String>, String), Erreur>;

impl Base {
    /// Une passe de vérification (REQ-110) : taille et date de chaque fichier des collections ;
    /// un fichier changé est relu, puis retiré, touché ou remis à jour. Ne fait rien si la base
    /// n'est pas configurée, a une collection illisible ou aucune, ou si un ajout est en cours.
    pub async fn verifier(
        &self,
        suivi: &Suivi,
        verrou: &tokio::sync::Mutex<()>,
        echecs: &Echecs,
        client: &reqwest::Client,
        acces: &AccesBase,
    ) {
        if suivi.lire().is_some_and(|s| s.etat == EtatAjout::EnCours) {
            return;
        }
        let base = self.clone();
        let suspects = tokio::task::spawn_blocking(move || {
            base.lire_config().ok().flatten()?;
            let connues = base.entrees().ok()?;
            Some(connues)
        })
        .await;
        let Ok(Some(connues)) = suspects else {
            return;
        };
        echecs.verrou().retain(|c, _| connues.contains_key(c));
        let notes = echecs.verrou().clone();
        let base = self.clone();
        let suspects = tokio::task::spawn_blocking(move || {
            let mut v = Vec::new();
            for (chemin, entrees) in connues {
                let stat = std::fs::metadata(base.projet.join(&chemin))
                    .ok()
                    .map(|m| taille_date(&crate::fichiers::version_de(&m)));
                if let Some((t, d)) = stat {
                    if entrees.iter().all(|e| e.taille == t && e.date == d) {
                        continue;
                    }
                    if notes.get(&chemin).is_some_and(|n| n.0 == t && n.1 == d) {
                        continue;
                    }
                }
                v.push((chemin, entrees));
            }
            v
        })
        .await;
        let Ok(suspects) = suspects else {
            return;
        };
        for (chemin, entrees) in suspects {
            self.mettre_a_jour(verrou, echecs, client, acces, &chemin, &entrees)
                .await;
        }
    }

    async fn mettre_a_jour(
        &self,
        verrou: &tokio::sync::Mutex<()>,
        echecs: &Echecs,
        client: &reqwest::Client,
        acces: &AccesBase,
        chemin: &str,
        entrees: &[Entree],
    ) {
        let (projet, rel) = (self.projet.clone(), chemin.to_string());
        let Ok(lu) =
            tokio::task::spawn_blocking(move || crate::fichiers::lire(&projet, &rel)).await
        else {
            return;
        };
        let (texte, version) = match lu {
            Ok(l) => l,
            Err(_) => {
                for e in entrees {
                    let _ = self
                        .appliquer(verrou, &e.collection, chemin, Action::Retirer)
                        .await;
                }
                echecs.effacer(chemin);
                return;
            }
        };
        let (taille, date) = taille_date(&version);
        let emp = empreinte(&texte);
        let mut a_remplacer = Vec::new();
        for e in entrees {
            if e.empreinte != emp {
                a_remplacer.push(e);
            } else if (e.taille, e.date) != (taille, date) {
                let _ = self
                    .appliquer(verrou, &e.collection, chemin, Action::Toucher(taille, date))
                    .await;
            }
        }
        if a_remplacer.is_empty() {
            echecs.effacer(chemin);
            return;
        }
        let echec = |cause: String| echecs.noter(chemin, taille, date, cause);
        let passages = decouper(chemin, &texte);
        let vecteurs = match self.vecteurs_du_fichier(client, acces, &passages).await {
            Ok(v) => v,
            Err(e) => return echec(e.cause),
        };
        for e in a_remplacer {
            let f = Fichier {
                chemin: chemin.to_string(),
                empreinte: emp.clone(),
                taille,
                date,
                passages: passages.clone(),
                vecteurs: vecteurs.clone(),
            };
            let r = self
                .appliquer(
                    verrou,
                    &e.collection,
                    chemin,
                    Action::Remplacer(Box::new(f)),
                )
                .await;
            if let Err(m) = r {
                return echec(m);
            }
        }
        echecs.effacer(chemin);
    }

    async fn vecteurs_du_fichier(
        &self,
        client: &reqwest::Client,
        acces: &AccesBase,
        passages: &[Passage],
    ) -> Result<Vec<Vec<f32>>, Erreur> {
        if passages.is_empty() {
            return Ok(Vec::new());
        }
        let (provider, adresse, cle, modele) = match acces {
            Ok(a) => a,
            Err(e) => {
                return Err(Erreur {
                    cause: e.cause.clone(),
                    detail: e.detail.clone(),
                })
            }
        };
        let acces = Acces {
            client,
            provider: *provider,
            adresse,
            cle: cle.as_deref(),
            modele,
        };
        let textes: Vec<String> = passages.iter().map(|p| p.texte.clone()).collect();
        let mut vecteurs: Vec<Vec<f32>> = Vec::new();
        for lot in textes.chunks(LOT) {
            vecteurs.extend(acces.vecteurs(lot).await?);
        }
        let dim = vecteurs.first().map_or(0, |v| v.len());
        if vecteurs.len() != passages.len() || dim == 0 || vecteurs.iter().any(|v| v.len() != dim) {
            return Err("Le provider a rendu des vecteurs inattendus.".into());
        }
        Ok(vecteurs)
    }

    /// Applique `action` au fichier `chemin` de la collection, sous le verrou de la base, sur la
    /// collection relue : un ajout terminé entre-temps n'est pas écrasé.
    async fn appliquer(
        &self,
        verrou: &tokio::sync::Mutex<()>,
        collection: &str,
        chemin: &str,
        action: Action,
    ) -> Result<(), String> {
        let _g = verrou.lock().await;
        let base = self.clone();
        let (collection, chemin) = (collection.to_string(), chemin.to_string());
        tokio::task::spawn_blocking(move || {
            let mut c = base.charger(&collection)?;
            let Some(i) = c.fichiers.iter().position(|f| f.chemin == chemin) else {
                return Ok(());
            };
            match action {
                Action::Retirer => {
                    c.fichiers.remove(i);
                }
                Action::Toucher(t, d) => {
                    c.fichiers[i].taille = t;
                    c.fichiers[i].date = d;
                }
                Action::Remplacer(f) => {
                    if let Some(v) = f.vecteurs.first() {
                        if c.dimension != 0 && v.len() != c.dimension {
                            return Err("La dimension des vecteurs du provider a changé.".into());
                        }
                        c.dimension = v.len();
                    }
                    c.fichiers[i] = *f;
                }
            }
            base.enregistrer(&c)
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

/// Où en est le dernier ajout du projet. Gardé en mémoire seulement : après un redémarrage,
/// rien n'est « en cours ».
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EtatAjout {
    EnCours,
    Fini,
    Arrete,
}

#[derive(Serialize, Clone, Debug)]
pub struct SuiviAjout {
    pub numero: u64,
    pub collection: String,
    pub etat: EtatAjout,
    pub faits: usize,
    pub total: usize,
    pub ajoutes: usize,
    pub inchanges: usize,
    pub retires: usize,
    pub ignores: usize,
    pub cause: Option<String>,
    pub detail: Option<String>,
}

#[derive(Default)]
pub struct Suivi {
    actuel: std::sync::Mutex<Option<SuiviAjout>>,
}

impl Suivi {
    fn verrou(&self) -> std::sync::MutexGuard<'_, Option<SuiviAjout>> {
        self.actuel.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn lire(&self) -> Option<SuiviAjout> {
        self.verrou().clone()
    }

    pub fn en_cours_pour(&self, collection: &str) -> bool {
        self.verrou().as_ref().is_some_and(|s| {
            s.etat == EtatAjout::EnCours && s.collection.eq_ignore_ascii_case(collection)
        })
    }

    /// `None` si un ajout est déjà en cours ; sinon le numéro du nouvel ajout.
    pub fn demarrer(&self, collection: &str, total: usize) -> Option<u64> {
        let mut g = self.verrou();
        let precedent = match g.as_ref() {
            Some(s) if s.etat == EtatAjout::EnCours => return None,
            Some(s) => s.numero,
            None => 0,
        };
        let numero = precedent + 1;
        *g = Some(SuiviAjout {
            numero,
            collection: collection.to_string(),
            etat: EtatAjout::EnCours,
            faits: 0,
            total,
            ajoutes: 0,
            inchanges: 0,
            retires: 0,
            ignores: 0,
            cause: None,
            detail: None,
        });
        Some(numero)
    }

    fn modifier(&self, numero: u64, f: impl FnOnce(&mut SuiviAjout)) {
        if let Some(s) = self.verrou().as_mut().filter(|s| s.numero == numero) {
            f(s);
        }
    }

    /// La tâche s'est arrêtée sans conclure (panique) : l'ajout n'est plus « en cours ».
    pub fn interrompre(&self, numero: u64) {
        self.modifier(numero, |s| {
            if s.etat == EtatAjout::EnCours {
                s.etat = EtatAjout::Arrete;
                s.cause = Some("L'ajout s'est interrompu.".into());
            }
        });
    }

    fn avancer(&self, numero: u64, n: usize) {
        self.modifier(numero, |s| s.faits = (s.faits + n).min(s.total));
    }
}

/// Fichiers d'un chemin demandé : sa portée (pour retirer ce qui a disparu) et ses fichiers.
pub struct Cible {
    pub portee: String,
    pub fichiers: Vec<String>,
    /// Fichiers que git ignore sous ce chemin : comptés comme ignorés, jamais lus.
    pub ignores_git: usize,
}

/// Parcourt les chemins (relatifs au projet) sans lire les fichiers : règles git, sans `.git/`
/// ni `.yaide/`. Un chemin hors du projet ou absent est refusé.
pub fn parcourir(projet: &Path, chemins: &[String]) -> Result<Vec<Cible>, crate::fichiers::Erreur> {
    use crate::fichiers::{resoudre, Erreur as E};
    let racine = projet.canonicalize()?;
    let mut cibles = Vec::new();
    for rel in chemins {
        let abs = resoudre(&racine, rel)?;
        let relatif = abs.strip_prefix(&racine).unwrap_or(&abs);
        let premier = relatif
            .components()
            .next()
            .map(|c| c.as_os_str().to_owned());
        if premier.is_some_and(|p| p == ".git" || p == ".yaide") {
            return Err(E::Invalide("Ce dossier n'est pas ajoutable."));
        }
        let meta = std::fs::metadata(&abs)?;
        let en_rel = |p: &Path| {
            p.strip_prefix(&racine)
                .unwrap_or(p)
                .to_string_lossy()
                .into_owned()
        };
        let portee = en_rel(&abs);
        if meta.is_file() {
            cibles.push(Cible {
                fichiers: vec![portee.clone()],
                portee,
                ignores_git: 0,
            });
            continue;
        }
        let git = crate::depot::est_un_depot(&racine);
        let interdits = [racine.join(".git"), racine.join(".yaide")];
        let marcher = |regles_git: bool| -> Vec<String> {
            let interdits = interdits.clone();
            ignore::WalkBuilder::new(&abs)
                .hidden(false)
                .ignore(false)
                .git_ignore(regles_git)
                .git_exclude(regles_git)
                .git_global(regles_git)
                .parents(regles_git)
                .sort_by_file_path(|a, b| a.cmp(b))
                .filter_entry(move |e| !interdits.iter().any(|i| e.path() == i))
                .build()
                .flatten()
                .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
                .map(|e| en_rel(e.path()))
                .collect()
        };
        let fichiers = marcher(git);
        let ignores_git = if git {
            marcher(false).len() - fichiers.len()
        } else {
            0
        };
        cibles.push(Cible {
            portee,
            fichiers,
            ignores_git,
        });
    }
    Ok(cibles)
}

pub fn total(cibles: &[Cible]) -> usize {
    cibles
        .iter()
        .map(|c| c.fichiers.len() + c.ignores_git)
        .sum()
}

/// Tout ce qu'il faut à la tâche d'ajout, possédé : elle ne dépend d'aucune requête.
pub struct Demande {
    pub projet: PathBuf,
    pub collection: String,
    pub cibles: Vec<Cible>,
    pub provider: Provider,
    pub adresse: String,
    pub cle: Option<String>,
    pub modele: String,
}

/// Exécute l'ajout, un chemin après l'autre, et note l'avancement dans `suivi`.
pub async fn executer(suivi: &Suivi, verrou: &tokio::sync::Mutex<()>, numero: u64, d: Demande) {
    // Pendant l'ajout, aucune mise à jour automatique n'écrit dans les collections (REQ-110).
    let _verrou = verrou.lock().await;
    let client = provider::client();
    let acces = Acces {
        client: &client,
        provider: d.provider,
        adresse: &d.adresse,
        cle: d.cle.as_deref(),
        modele: &d.modele,
    };
    let base = Base::new(&d.projet);
    for cible in d.cibles {
        let projet = d.projet.clone();
        let chemins = cible.fichiers;
        let lus = tokio::task::spawn_blocking(move || {
            let mut lus = Vec::new();
            let mut ignores = 0;
            for c in chemins {
                match crate::fichiers::lire(&projet, &c) {
                    Ok((texte, version)) => lus.push((c, texte, version)),
                    Err(_) => ignores += 1,
                }
            }
            (lus, ignores)
        })
        .await;
        let Ok((lus, ignores)) = lus else {
            return arreter(
                suivi,
                numero,
                "La lecture des fichiers s'est interrompue.".into(),
            );
        };
        let ignores = ignores + cible.ignores_git;
        suivi.modifier(numero, |s| s.ignores += ignores);
        suivi.avancer(numero, ignores);
        let r = base
            .ajouter_avec(&acces, &d.collection, &cible.portee, &lus, &|n| {
                suivi.avancer(numero, n)
            })
            .await;
        match r {
            Ok(a) => suivi.modifier(numero, |s| {
                s.ajoutes += a.ajoutes;
                s.inchanges += a.inchanges;
                s.retires += a.retires;
            }),
            Err(e) => {
                suivi.modifier(numero, |s| {
                    s.etat = EtatAjout::Arrete;
                    s.cause = Some(e.cause);
                    s.detail = Some(e.detail).filter(|d| !d.is_empty());
                });
                return;
            }
        }
    }
    suivi.modifier(numero, |s| s.etat = EtatAjout::Fini);
}

fn arreter(suivi: &Suivi, numero: u64, cause: String) {
    suivi.modifier(numero, |s| {
        s.etat = EtatAjout::Arrete;
        s.cause = Some(cause);
    });
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
        PROJET.with(|p| *p.borrow_mut() = d.clone());
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

    thread_local! {
        static PROJET: std::cell::RefCell<PathBuf> = const { std::cell::RefCell::new(PathBuf::new()) };
    }

    /// Un fichier du projet courant du test : écrit sur le disque, car la recherche le relit.
    fn f(chemin: &str, contenu: &str) -> (String, String, String) {
        let cible = PROJET.with(|p| p.borrow().join(chemin));
        std::fs::create_dir_all(cible.parent().unwrap()).unwrap();
        std::fs::write(&cible, contenu).unwrap();
        let version = crate::fichiers::version_de(&std::fs::metadata(cible).unwrap());
        (chemin.to_string(), contenu.to_string(), version)
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
            b.chercher(&acces(&c, &a, None), "q", &[])
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
        let e = b.chercher(&ac, "q", &[]).await.unwrap_err();
        assert_eq!(
            e,
            Erreur::from("Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM.")
        );
        assert!(r2.lock().unwrap().is_empty());
        // Sans clé (LiteLLM, Ollama) : aucun en-tête d'authentification (AC-052-7).
        b.chercher(&acces(&c, &a2, None), "q", &[]).await.unwrap();
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
        let t = b.chercher(&ac, "x", &[]).await.unwrap();
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
        let t = b.chercher(&acces(&c, &bon, None), "q", &[]).await.unwrap();
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
        let fichiers: Vec<(String, String, String)> = (1..=12)
            .map(|n| f(&format!("f{n:02}.txt"), &format!("x{n}")))
            .collect();
        b.ajouter(&ac, "notes", "", &fichiers).await.unwrap();
        recues.lock().unwrap().clear();
        let t = b.chercher(&ac, "x", &[]).await.unwrap();
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
        let trois: Vec<(String, String, String)> =
            fichiers[..3].iter().map(|(c, t, _)| f(c, t)).collect();
        b2.ajouter(&ac, "n", "", &trois).await.unwrap();
        assert_eq!(b2.chercher(&ac, "x", &[]).await.unwrap().len(), 3);
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
        let api = b.chercher(&ac, "x", &["API".to_string()]).await.unwrap();
        assert_eq!(api.len(), 1);
        assert_eq!(api[0].collection, "api");
        let tous = b.chercher(&ac, "x", &[]).await.unwrap();
        let ordre: Vec<&str> = tous.iter().map(|p| p.collection.as_str()).collect();
        assert_eq!(ordre, ["api", "notes"]);
        assert!(b.chercher(&ac, "x", &["zzz".to_string()]).await.is_err());
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

    #[test]
    fn REQ109_AC2_decoupage_octets_relus_identiques_crlf_et_multioctets() {
        let longue = "é".repeat(5000);
        let contenu = format!("a\r\nbé\r\n{longue}\r\n\r\nz");
        let ps = decouper("f", &contenu);
        let lignes: Vec<(usize, usize, usize)> = ps
            .iter()
            .map(|p| (p.debut, p.fin, p.texte.chars().count()))
            .collect();
        assert_eq!(
            lignes,
            vec![
                (1, 2, 5),
                (3, 3, 2000),
                (3, 3, 2000),
                (3, 3, 1000),
                (4, 5, 3)
            ]
        );
        for p in &ps {
            assert_eq!(&contenu[p.octet_debut..p.octet_fin], p.texte);
        }
        assert_eq!(ps[0].texte, "a\r\nbé");
        assert_eq!(ps[4].texte, "\r\nz");
    }

    #[test]
    fn REQ109_AC2_decoupage_300_lignes_octets_a_des_limites_de_caracteres() {
        let contenu: String = (0..300).map(|_| "é".repeat(19) + "\n").collect();
        for p in decouper("f", &contenu) {
            assert!(
                contenu.is_char_boundary(p.octet_debut) && contenu.is_char_boundary(p.octet_fin)
            );
            assert_eq!(&contenu[p.octet_debut..p.octet_fin], p.texte);
            assert!(p.texte.chars().count() <= 2000);
        }
    }

    #[tokio::test]
    async fn REQ109_AC1_AC2_rien_de_textuel_ecrit_texte_relu_dans_le_fichier() {
        let (d, b) = projet();
        let (a, _) = faux(200).await;
        let c = client();
        let ac = acces(&c, &a, None);
        let contenu = format!("secret un\n{}\nsecret deux", "é".repeat(5000));
        b.ajouter(&ac, "notes", "", &[f("a.md", &contenu)])
            .await
            .unwrap();
        let brut =
            std::fs::read_to_string(d.join(".yaide/connaissance/collections/notes/passages.json"))
                .unwrap();
        assert!(!brut.contains("secret") && !brut.contains("éé"), "{brut}");
        assert!(brut.contains("octet_debut") && brut.contains("a.md"));
        let t = b.chercher(&ac, "q", &[]).await.unwrap();
        let textes: Vec<String> = t.iter().map(|p| p.texte.clone()).collect();
        let attendus: Vec<String> = decouper("a.md", &contenu)
            .into_iter()
            .map(|p| p.texte)
            .collect();
        assert_eq!(textes.len(), 5);
        for x in &attendus {
            assert!(textes.contains(x));
        }
    }

    #[tokio::test]
    async fn REQ109_AC3_fichier_modifie_ou_supprime_ne_donne_aucun_passage() {
        let (d, b) = projet();
        let (a, _) = faux(200).await;
        let c = client();
        let ac = acces(&c, &a, None);
        let mut fichiers: Vec<(String, String, String)> = (1..=12)
            .map(|n| f(&format!("f{n:02}.txt"), &format!("x{n}")))
            .collect();
        fichiers.push(f("f13.txt", "x13"));
        b.ajouter(&ac, "notes", "", &fichiers).await.unwrap();
        let tous = b.chercher(&ac, "x", &[]).await.unwrap();
        assert_eq!(tous[0].chemin, "f13.txt");
        std::fs::write(d.join("f13.txt"), "x13 modifié").unwrap();
        std::fs::remove_file(d.join("f12.txt")).unwrap();
        let t = b.chercher(&ac, "x", &[]).await.unwrap();
        assert_eq!(t.len(), 10);
        assert!(!t
            .iter()
            .any(|p| p.chemin == "f13.txt" || p.chemin == "f12.txt"));
        assert_eq!(t[0].chemin, "f11.txt");
        assert_eq!(t[9].chemin, "f02.txt");
    }

    #[tokio::test]
    async fn REQ109_collection_au_format_d_avant_est_illisible_avec_son_chemin() {
        let (d, b) = projet();
        let dossier = d.join(".yaide/connaissance/collections/vieille");
        std::fs::create_dir_all(&dossier).unwrap();
        std::fs::write(
            dossier.join("passages.json"),
            r#"{"nom":"vieille","dimension":2,"fichiers":[{"chemin":"a","empreinte":"e","passages":[{"chemin":"a","debut":1,"fin":1,"texte":"x"}]}]}"#,
        )
        .unwrap();
        std::fs::write(dossier.join("vecteurs.bin"), [0u8; 8]).unwrap();
        let (a, _) = faux(200).await;
        let c = client();
        let e = b
            .chercher(&acces(&c, &a, None), "q", &[])
            .await
            .unwrap_err();
        assert!(
            e.cause
                .contains(&dossier.join("passages.json").display().to_string()),
            "{}",
            e.cause
        );
        assert!(e.cause.contains("illisible"));
    }
}
