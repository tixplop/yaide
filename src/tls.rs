use crate::config::ecrire_atomique;
use std::path::{Path, PathBuf};

pub fn fichiers(dossier: &Path) -> (PathBuf, PathBuf) {
    (dossier.join("certificat.pem"), dossier.join("cle.pem"))
}

/// Crée le certificat auto-signé (10 ans) s'il n'existe pas encore.
pub fn assurer_certificat(dossier: &Path) -> Result<(PathBuf, PathBuf), String> {
    let (cert, cle) = fichiers(dossier);
    if cert.is_file() && cle.is_file() {
        return Ok((cert, cle));
    }
    let annee = 1970
        + std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs() as i32
            / 31_556_952;
    let mut params = rcgen::CertificateParams::new(vec!["localhost".into(), "127.0.0.1".into()])
        .map_err(|e| format!("certificat impossible : {e}"))?;
    params.not_before = rcgen::date_time_ymd(annee - 1, 1, 1);
    params.not_after = rcgen::date_time_ymd(annee + 10, 12, 31);
    let paire = rcgen::KeyPair::generate().map_err(|e| format!("clé impossible : {e}"))?;
    let c = params
        .self_signed(&paire)
        .map_err(|e| format!("certificat impossible : {e}"))?;
    ecrire_atomique(&cle, paire.serialize_pem().as_bytes())?;
    ecrire_atomique(&cert, c.pem().as_bytes())?;
    Ok((cert, cle))
}
