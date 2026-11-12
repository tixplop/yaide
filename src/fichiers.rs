use crate::depot;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

static COMPTEUR: AtomicU64 = AtomicU64::new(0);

/// 5 × 1024 × 1024 octets.
pub const TAILLE_MAX: u64 = 5 * 1024 * 1024;

pub enum Erreur {
    /// Le chemin sort du projet.
    Interdit,
    Introuvable,
    Existe,
    Binaire,
    NonUtf8,
    TropGros,
    /// Le disque a changé depuis la version de base ; porte la version du disque.
    Conflit(String),
    Droits,
    Invalide(&'static str),
    Autre(String),
}

impl From<std::io::Error> for Erreur {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            ErrorKind::NotFound => Erreur::Introuvable,
            ErrorKind::PermissionDenied => Erreur::Droits,
            ErrorKind::AlreadyExists => Erreur::Existe,
            _ if e.raw_os_error() == Some(28) => Erreur::Autre("le disque est plein".into()),
            _ => Erreur::Autre(e.to_string()),
        }
    }
}

pub struct Entree {
    pub nom: String,
    pub dossier: bool,
    pub ignore: bool,
}

pub(crate) type Cache = Option<Vec<depot::Worktree>>;

/// Un chemin qui commence par `../` mène dans un worktree du dépôt : renvoie sa racine
/// et le reste du chemin. Les autres chemins restent dans `racine`.
pub(crate) fn aiguiller(
    racine: &Path,
    rel: &str,
    cache: &mut Cache,
) -> Result<(PathBuf, String), Erreur> {
    if rel != ".." && !rel.starts_with("../") {
        return Ok((racine.to_path_buf(), rel.to_string()));
    }
    let liste = cache.get_or_insert_with(|| depot::worktrees(racine));
    liste
        .iter()
        .filter(|w| {
            !w.chemin.is_empty()
                && (rel == w.chemin
                    || (rel.starts_with(&w.chemin) && rel[w.chemin.len()..].starts_with('/')))
        })
        .max_by_key(|w| w.chemin.len())
        .map(|w| {
            let reste = rel[w.chemin.len()..].trim_start_matches('/');
            (w.dossier.clone(), reste.to_string())
        })
        .ok_or(Erreur::Interdit)
}

/// Chemin réel de `rel` dans le projet ; refuse tout ce qui en sort
/// (`..`, chemin absolu, lien symbolique vers l'extérieur).
pub(crate) fn resoudre(racine: &Path, rel: &str) -> Result<PathBuf, Erreur> {
    if rel.contains('\0') {
        return Err(Erreur::Invalide("Chemin invalide."));
    }
    let p = Path::new(rel);
    if !p
        .components()
        .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(Erreur::Interdit);
    }
    let racine = racine.canonicalize()?;
    let mut base = racine.join(p);
    let mut reste = Vec::new();
    loop {
        if let Ok(reel) = base.canonicalize() {
            if !reel.starts_with(&racine) {
                return Err(Erreur::Interdit);
            }
            return Ok(reste.iter().rev().fold(reel, |r, n| r.join(n)));
        }
        let Some(nom) = base.file_name().map(|n| n.to_owned()) else {
            return Err(Erreur::Interdit);
        };
        reste.push(nom);
        base.pop();
    }
}

/// Comme `resoudre`, mais le dernier élément n'est pas suivi s'il est un lien :
/// on agit sur le lien lui-même (renommer, supprimer).
fn resoudre_lien(racine: &Path, rel: &str) -> Result<PathBuf, Erreur> {
    let p = Path::new(rel);
    match (p.parent(), p.file_name()) {
        (Some(parent), Some(nom)) if !rel.contains('\0') => {
            let parent = parent.to_str().ok_or(Erreur::Interdit)?;
            Ok(resoudre(racine, parent)?.join(nom))
        }
        _ => resoudre(racine, rel),
    }
}

fn existe(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

pub fn version_de(m: &fs::Metadata) -> String {
    let ns = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    format!("{ns}-{}", m.len())
}

pub fn lister(racine: &Path, rel: &str) -> Result<Vec<Entree>, Erreur> {
    let (racine, rel) = aiguiller(racine, rel, &mut None)?;
    let (racine, rel) = (racine.as_path(), rel.as_str());
    let dossier = resoudre(racine, rel)?;
    if !fs::metadata(&dossier)?.is_dir() {
        return Err(Erreur::Invalide("Ce n'est pas un dossier."));
    }
    let mut entrees = Vec::new();
    for e in fs::read_dir(&dossier)? {
        let e = e?;
        let nom = e.file_name().to_string_lossy().into_owned();
        if nom == ".git" {
            continue;
        }
        let dossier = fs::metadata(e.path()).is_ok_and(|m| m.is_dir());
        entrees.push(Entree {
            nom,
            dossier,
            ignore: false,
        });
    }
    entrees.sort_by_key(|e| (!e.dossier, e.nom.to_lowercase(), e.nom.clone()));
    let noms: Vec<String> = entrees.iter().map(|e| e.nom.clone()).collect();
    let ignores = depot::ignores(&dossier, &noms);
    for e in entrees.iter_mut() {
        e.ignore = ignores.contains(&e.nom);
    }
    Ok(entrees)
}

/// Contenu (UTF-8) et version.
pub fn lire(racine: &Path, rel: &str) -> Result<(String, String), Erreur> {
    let (racine, rel) = aiguiller(racine, rel, &mut None)?;
    let (racine, rel) = (racine.as_path(), rel.as_str());
    let chemin = resoudre(racine, rel)?;
    let f = fs::File::open(&chemin)?;
    let meta = f.metadata()?;
    if meta.is_dir() {
        return Err(Erreur::Invalide("C'est un dossier."));
    }
    if meta.len() > TAILLE_MAX {
        return Err(Erreur::TropGros);
    }
    let mut octets = Vec::new();
    f.take(TAILLE_MAX + 1).read_to_end(&mut octets)?;
    if octets.len() as u64 > TAILLE_MAX {
        return Err(Erreur::TropGros);
    }
    if octets.contains(&0) {
        return Err(Erreur::Binaire);
    }
    let texte = String::from_utf8(octets).map_err(|_| Erreur::NonUtf8)?;
    Ok((texte, version_de(&meta)))
}

/// Écrit par fichier temporaire puis renommage, en gardant les droits.
/// `base` : version que l'appelant a lue ; si le disque a changé, `Conflit`.
/// Un fichier absent est (re)créé. Renvoie la nouvelle version.
pub fn ecrire(
    racine: &Path,
    rel: &str,
    base: Option<&str>,
    contenu: &[u8],
) -> Result<String, Erreur> {
    let (racine, rel) = aiguiller(racine, rel, &mut None)?;
    let (racine, rel) = (racine.as_path(), rel.as_str());
    let chemin = resoudre(racine, rel)?;
    let existant = fs::metadata(&chemin).ok();
    if let Some(m) = &existant {
        if m.is_dir() {
            return Err(Erreur::Invalide("C'est un dossier."));
        }
        if let Some(b) = base {
            let actuelle = version_de(m);
            if actuelle != b {
                return Err(Erreur::Conflit(actuelle));
            }
        }
        // Le renommage ignorerait un fichier en lecture seule : on le vérifie ici.
        fs::OpenOptions::new().write(true).open(&chemin)?;
    }
    let parent = chemin
        .parent()
        .ok_or(Erreur::Invalide("Chemin invalide."))?;
    fs::create_dir_all(parent)?;
    let nom = chemin.file_name().unwrap().to_string_lossy();
    let temp = parent.join(format!(
        ".{nom}.yaide-{}-{}.tmp",
        std::process::id(),
        COMPTEUR.fetch_add(1, Ordering::Relaxed)
    ));
    let r = (|| -> Result<(), Erreur> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        if let Some(m) = &existant {
            f.set_permissions(m.permissions())?;
        }
        f.write_all(contenu)?;
        f.sync_all()?;
        fs::rename(&temp, &chemin)?;
        Ok(())
    })();
    if let Err(e) = r {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    Ok(version_de(&fs::metadata(&chemin)?))
}

pub fn creer(racine: &Path, rel: &str, dossier: bool) -> Result<(), Erreur> {
    let (racine, rel) = aiguiller(racine, rel, &mut None)?;
    let (racine, rel) = (racine.as_path(), rel.as_str());
    let chemin = resoudre(racine, rel)?;
    if chemin == racine.canonicalize()? {
        return Err(Erreur::Invalide("Chemin invalide."));
    }
    if existe(&chemin) {
        return Err(Erreur::Existe);
    }
    if let Some(parent) = chemin.parent() {
        fs::create_dir_all(parent)?;
    }
    if dossier {
        fs::create_dir(&chemin)?;
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&chemin)?;
    }
    Ok(())
}

pub fn renommer(racine: &Path, de: &str, vers: &str) -> Result<(), Erreur> {
    let mut cache = None;
    let (racine_de, de) = aiguiller(racine, de, &mut cache)?;
    let (racine_vers, vers) = aiguiller(racine, vers, &mut cache)?;
    if racine_de != racine_vers {
        return Err(Erreur::Interdit);
    }
    let (racine, de, vers) = (racine_de.as_path(), de.as_str(), vers.as_str());
    let source = resoudre_lien(racine, de)?;
    let cible = resoudre(racine, vers)?;
    let reel = racine.canonicalize()?;
    if source == reel || cible == reel {
        return Err(Erreur::Invalide("Chemin invalide."));
    }
    if !existe(&source) {
        return Err(Erreur::Introuvable);
    }
    if existe(&cible) {
        return Err(Erreur::Existe);
    }
    if cible.starts_with(&source) {
        return Err(Erreur::Invalide(
            "Un dossier ne peut pas être déplacé dans lui-même.",
        ));
    }
    if let Some(parent) = cible.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&source, &cible)?;
    Ok(())
}

pub fn supprimer(racine: &Path, rel: &str) -> Result<(), Erreur> {
    let (racine, rel) = aiguiller(racine, rel, &mut None)?;
    let (racine, rel) = (racine.as_path(), rel.as_str());
    let chemin = resoudre_lien(racine, rel)?;
    if chemin == racine.canonicalize()? {
        return Err(Erreur::Invalide("Le dossier du projet ne se supprime pas."));
    }
    if fs::symlink_metadata(&chemin)?.is_dir() {
        fs::remove_dir_all(&chemin)?;
    } else {
        fs::remove_file(&chemin)?;
    }
    Ok(())
}

/// Version de chaque chemin ; `None` pour un fichier absent.
pub fn versions(racine: &Path, chemins: &[&str]) -> Result<Vec<(String, Option<String>)>, Erreur> {
    let mut cache = None;
    chemins
        .iter()
        .map(|c| {
            let (r, rel) = aiguiller(racine, c, &mut cache)?;
            let p = resoudre(&r, &rel)?;
            Ok((c.to_string(), fs::metadata(p).ok().map(|m| version_de(&m))))
        })
        .collect()
}
