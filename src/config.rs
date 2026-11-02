use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

/// Dossier de configuration : `$XDG_CONFIG_HOME/yaide`, sinon `~/.config/yaide`.
pub fn dossier_config() -> Result<PathBuf, String> {
    let base = match std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        Some(v) => PathBuf::from(v),
        None => match std::env::var_os("HOME").filter(|v| !v.is_empty()) {
            Some(h) => PathBuf::from(h).join(".config"),
            None => {
                return Err("impossible de trouver le dossier de configuration \
                            (ni XDG_CONFIG_HOME ni HOME ne sont définis)"
                    .into())
            }
        },
    };
    Ok(base.join("yaide"))
}

pub fn fichier_mot_de_passe(dossier: &Path) -> PathBuf {
    dossier.join("mot-de-passe")
}

/// Écrit dans un fichier temporaire (droits 600) puis le renomme.
pub fn ecrire_atomique(chemin: &Path, contenu: &[u8]) -> Result<(), String> {
    let erreur = |e: std::io::Error| format!("écriture de {} impossible : {e}", chemin.display());
    let parent = chemin.parent().ok_or("chemin de configuration invalide")?;
    std::fs::create_dir_all(parent).map_err(erreur)?;
    let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
    let tmp = chemin.with_extension(format!("tmp{}", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let res = (|| {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(contenu)?;
        f.sync_all()?;
        std::fs::rename(&tmp, chemin)
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res.map_err(erreur)
}

fn sel_aleatoire() -> Result<SaltString, String> {
    use std::io::Read;
    let mut octets = [0u8; 16];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut octets))
        .map_err(|e| format!("tirage aléatoire impossible : {e}"))?;
    SaltString::encode_b64(&octets).map_err(|e| e.to_string())
}

/// Range le mot de passe haché (Argon2) ; refuse un mot de passe vide.
pub fn definir_mot_de_passe(dossier: &Path, mot_de_passe: &str) -> Result<(), String> {
    if mot_de_passe.is_empty() {
        return Err("le mot de passe ne peut pas être vide".into());
    }
    let sel = sel_aleatoire()?;
    let hache = Argon2::default()
        .hash_password(mot_de_passe.as_bytes(), &sel)
        .map_err(|e| format!("hachage impossible : {e}"))?
        .to_string();
    ecrire_atomique(&fichier_mot_de_passe(dossier), hache.as_bytes())
}

pub fn mot_de_passe_defini(dossier: &Path) -> bool {
    fichier_mot_de_passe(dossier).is_file()
}

/// Relit le fichier à chaque appel : un nouveau mot de passe vaut tout de suite.
#[allow(dead_code)] // utilisé par la connexion (T-007)
pub fn verifier_mot_de_passe(dossier: &Path, mot_de_passe: &str) -> bool {
    let Ok(texte) = std::fs::read_to_string(fichier_mot_de_passe(dossier)) else {
        return false;
    };
    let Ok(hache) = PasswordHash::new(texte.trim()) else {
        return false;
    };
    Argon2::default()
        .verify_password(mot_de_passe.as_bytes(), &hache)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dossier(nom: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("config-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn req001_ac1_fichier_haché_en_droits_600() {
        let d = dossier("ac1");
        definir_mot_de_passe(&d, "secret-unique").unwrap();
        let f = fichier_mot_de_passe(&d);
        let texte = std::fs::read_to_string(&f).unwrap();
        assert!(!texte.contains("secret-unique"));
        assert!(texte.starts_with("$argon2"));
        assert_eq!(
            std::fs::metadata(&f).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn req001_ac2_deux_lecteurs_acceptent_le_meme_mot_de_passe() {
        let d = dossier("ac2");
        definir_mot_de_passe(&d, "partagé").unwrap();
        assert!(verifier_mot_de_passe(&d, "partagé"));
        assert!(verifier_mot_de_passe(&d, "partagé"));
        assert!(!verifier_mot_de_passe(&d, "autre"));
    }

    #[test]
    fn req001_ac3_le_nouveau_mot_de_passe_vaut_tout_de_suite() {
        let d = dossier("ac3");
        definir_mot_de_passe(&d, "ancien").unwrap();
        assert!(verifier_mot_de_passe(&d, "ancien"));
        definir_mot_de_passe(&d, "nouveau").unwrap();
        assert!(verifier_mot_de_passe(&d, "nouveau"));
        assert!(!verifier_mot_de_passe(&d, "ancien"));
    }

    #[test]
    fn req001_ac4_mot_de_passe_vide_refuse_et_fichier_inchange() {
        let d = dossier("ac4");
        definir_mot_de_passe(&d, "reste").unwrap();
        assert!(definir_mot_de_passe(&d, "").is_err());
        assert!(verifier_mot_de_passe(&d, "reste"));
    }
}
