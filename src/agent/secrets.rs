//! Clés d'API chiffrées (AES-256-GCM) : `.yaide/secrets` (nonce de 12 octets, puis chiffré)
//! et la clé de chiffrement dans le dossier de configuration de l'utilisateur (DEC-033).

use crate::config;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub type Cles = BTreeMap<String, String>;

pub fn fichier_secrets(yaide: &Path) -> PathBuf {
    yaide.join("secrets")
}

pub fn fichier_cle(cfg: &Path) -> PathBuf {
    cfg.join("cle-secrets")
}

fn aleatoire(octets: &mut [u8]) -> Result<(), String> {
    SystemRandom::new()
        .fill(octets)
        .map_err(|_| "tirage aléatoire impossible".to_string())
}

fn chiffreur(octets: &[u8], fichier: &Path) -> Result<LessSafeKey, String> {
    UnboundKey::new(&AES_256_GCM, octets)
        .map(LessSafeKey::new)
        .map_err(|_| format!("{} est invalide", fichier.display()))
}

/// Lit la clé de chiffrement ; la crée si `creer` et qu'elle est absente.
fn lire_cle(cfg: &Path, creer: bool) -> Result<LessSafeKey, String> {
    let f = fichier_cle(cfg);
    match std::fs::read(&f) {
        Ok(octets) => chiffreur(&octets, &f),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && creer => {
            let mut octets = [0u8; 32];
            aleatoire(&mut octets)?;
            config::ecrire_atomique(&f, &octets)?;
            chiffreur(&octets, &f)
        }
        Err(e) => Err(format!("{} est illisible : {e}", f.display())),
    }
}

/// Fichier absent : aucune clé. Fichier ou clé de chiffrement illisible : erreur qui le nomme.
pub fn lire(yaide: &Path, cfg: &Path) -> Result<Cles, String> {
    let f = fichier_secrets(yaide);
    let contenu = match std::fs::read(&f) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Cles::new()),
        Err(e) => return Err(format!("{} est illisible : {e}", f.display())),
    };
    let cle = lire_cle(cfg, false)
        .map_err(|e| format!("{} ne peut pas être déchiffré : {e}", f.display()))?;
    if contenu.len() < NONCE_LEN {
        return Err(format!("{} est illisible (trop court)", f.display()));
    }
    let (nonce, chiffre) = contenu.split_at(NONCE_LEN);
    let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| "nonce invalide")?;
    let mut tampon = chiffre.to_vec();
    let clair = cle
        .open_in_place(nonce, Aad::empty(), &mut tampon)
        .map_err(|_| format!("{} ne peut pas être déchiffré", f.display()))?;
    serde_json::from_slice(clair).map_err(|_| format!("{} est illisible", f.display()))
}

/// Chiffre avec un nonce neuf et remplace `.yaide/secrets`.
pub fn ecrire(yaide: &Path, cfg: &Path, cles: &Cles) -> Result<(), String> {
    let cle = lire_cle(cfg, true)?;
    let mut nonce = [0u8; NONCE_LEN];
    aleatoire(&mut nonce)?;
    let mut tampon = serde_json::to_vec(cles).map_err(|e| e.to_string())?;
    cle.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce),
        Aad::empty(),
        &mut tampon,
    )
    .map_err(|_| "chiffrement impossible".to_string())?;
    let mut contenu = nonce.to_vec();
    contenu.extend_from_slice(&tampon);
    config::ecrire_atomique(&fichier_secrets(yaide), &contenu)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn dossiers(nom: &str) -> (PathBuf, PathBuf) {
        let d = std::env::temp_dir().join(format!("secrets-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        (d.join("projet/.yaide"), d.join("cfg"))
    }

    fn une_cle() -> Cles {
        Cles::from([("openai".to_string(), "sk-tres-secrete".to_string())])
    }

    #[test]
    fn req052_ac2_secrets_chiffre_droits_600() {
        let (y, c) = dossiers("ac2");
        ecrire(&y, &c, &une_cle()).unwrap();
        let brut = std::fs::read(fichier_secrets(&y)).unwrap();
        assert!(!String::from_utf8_lossy(&brut).contains("sk-tres-secrete"));
        for f in [fichier_secrets(&y), fichier_cle(&c)] {
            let mode = std::fs::metadata(f).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        assert_eq!(std::fs::read(fichier_cle(&c)).unwrap().len(), 32);
    }

    #[test]
    fn req052_ac6_dechiffre_apres_relecture_avec_un_nonce_neuf() {
        let (y, c) = dossiers("ac6");
        ecrire(&y, &c, &une_cle()).unwrap();
        let premier = std::fs::read(fichier_secrets(&y)).unwrap();
        assert_eq!(lire(&y, &c).unwrap(), une_cle());
        ecrire(&y, &c, &une_cle()).unwrap();
        let second = std::fs::read(fichier_secrets(&y)).unwrap();
        assert_ne!(premier[..NONCE_LEN], second[..NONCE_LEN]);
        assert_eq!(lire(&y, &c).unwrap(), une_cle());
    }

    #[test]
    fn req051_ac4_cle_de_chiffrement_perdue() {
        let (y, c) = dossiers("perdue");
        ecrire(&y, &c, &une_cle()).unwrap();
        std::fs::remove_file(fichier_cle(&c)).unwrap();
        let avant = std::fs::read(fichier_secrets(&y)).unwrap();
        let e = lire(&y, &c).unwrap_err();
        assert!(e.contains("secrets"), "{e}");
        assert_eq!(std::fs::read(fichier_secrets(&y)).unwrap(), avant);
        assert!(!fichier_cle(&c).exists());
    }

    #[test]
    fn req051_ac4_secrets_corrompu_nomme_le_fichier() {
        let (y, c) = dossiers("corrompu");
        ecrire(&y, &c, &une_cle()).unwrap();
        std::fs::write(fichier_secrets(&y), b"pas du tout chiffre, vraiment pas").unwrap();
        assert!(lire(&y, &c).unwrap_err().contains("secrets"));
    }

    #[test]
    fn sans_fichier_aucune_cle() {
        let (y, c) = dossiers("vide");
        assert!(lire(&y, &c).unwrap().is_empty());
        assert!(!y.exists() && !c.exists());
    }
}
