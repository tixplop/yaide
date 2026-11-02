use ring::hmac;

pub const NOM_COOKIE: &str = "yaide_session";
pub const DUREE_SESSION: u64 = 30 * 24 * 3600;
pub const DUREE_BLOCAGE: u64 = 60;
const ECHECS_MAX: u32 = 5;

fn cle_hmac(cle: &[u8]) -> hmac::Key {
    hmac::Key::new(hmac::HMAC_SHA256, cle)
}

fn hex(octets: &[u8]) -> String {
    octets.iter().map(|o| format!("{o:02x}")).collect()
}

fn depuis_hex(texte: &str) -> Option<Vec<u8>> {
    if !texte.len().is_multiple_of(2) || !texte.is_ascii() {
        return None;
    }
    (0..texte.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&texte[i..i + 2], 16).ok())
        .collect()
}

/// Valeur du cookie : date d'expiration (secondes) et signature HMAC-SHA256.
/// La clé est le contenu du fichier du mot de passe haché.
pub fn creer_session(cle: &[u8], maintenant: u64) -> String {
    let expiration = maintenant + DUREE_SESSION;
    let signature = hmac::sign(&cle_hmac(cle), expiration.to_string().as_bytes());
    format!("{expiration}.{}", hex(signature.as_ref()))
}

pub fn session_valide(cle: &[u8], valeur: &str, maintenant: u64) -> bool {
    let Some((exp, sig)) = valeur.split_once('.') else {
        return false;
    };
    let (Ok(expiration), Some(sig)) = (exp.parse::<u64>(), depuis_hex(sig)) else {
        return false;
    };
    expiration > maintenant
        && hmac::verify(&cle_hmac(cle), expiration.to_string().as_bytes(), &sig).is_ok()
}

/// Compteur d'échecs global à l'instance, en mémoire.
#[derive(Default)]
pub struct Limiteur {
    echecs: u32,
    bloque_jusqua: u64,
}

impl Limiteur {
    pub fn bloque(&self, maintenant: u64) -> bool {
        maintenant < self.bloque_jusqua
    }

    pub fn echec(&mut self, maintenant: u64) {
        self.echecs += 1;
        if self.echecs >= ECHECS_MAX {
            self.echecs = 0;
            self.bloque_jusqua = maintenant + DUREE_BLOCAGE;
        }
    }

    pub fn reussite(&mut self) {
        self.echecs = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const JOUR: u64 = 24 * 3600;

    #[test]
    fn req005_ac1_valide_dix_jours_plus_tard() {
        let c = creer_session(b"cle", 1000);
        assert!(session_valide(b"cle", &c, 1000 + 10 * JOUR));
    }

    #[test]
    fn req005_ac2_expiree_apres_trente_jours() {
        let c = creer_session(b"cle", 1000);
        assert!(session_valide(b"cle", &c, 1000 + 30 * JOUR - 1));
        assert!(!session_valide(b"cle", &c, 1000 + 30 * JOUR));
    }

    #[test]
    fn req005_ac6_autre_cle_refusee() {
        let c = creer_session(b"ancienne", 1000);
        assert!(!session_valide(b"nouvelle", &c, 1001));
    }

    #[test]
    fn req006_cookie_falsifie_ou_mal_forme_refuse() {
        let c = creer_session(b"cle", 1000);
        let (_, sig) = c.split_once('.').unwrap();
        let prolonge = format!("{}.{sig}", 1000 + 99 * JOUR);
        for mauvais in ["", "x", ".", "12.zz", "12.abc", &prolonge, "é.é"] {
            assert!(!session_valide(b"cle", mauvais, 1001), "{mauvais}");
        }
    }

    #[test]
    fn req004_ac3_blocage_une_minute_apres_cinq_echecs() {
        let mut l = Limiteur::default();
        for _ in 0..4 {
            l.echec(100);
            assert!(!l.bloque(100));
        }
        l.echec(100);
        assert!(l.bloque(100));
        assert!(l.bloque(159));
        assert!(!l.bloque(160));
    }

    #[test]
    fn req004_ac4_une_reussite_remet_le_compteur_a_zero() {
        let mut l = Limiteur::default();
        for _ in 0..4 {
            l.echec(100);
        }
        l.reussite();
        for _ in 0..4 {
            l.echec(100);
        }
        assert!(!l.bloque(100));
    }
}
