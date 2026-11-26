//! Journal des logs de Yaide : lignes numérotées gardées en mémoire, 1 000 au plus (DEC-123, REQ-186).
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_LIGNES: usize = 1000;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum Severite {
    Information,
    Avertissement,
    Erreur,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Ligne {
    pub numero: u64,
    /// Heure de l'évènement, en millisecondes depuis 1970.
    pub heure: u64,
    pub severite: Severite,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

struct Interne {
    lignes: VecDeque<Ligne>,
    suivant: u64,
    purge: u64,
}

pub struct Journal {
    interne: Mutex<Interne>,
}

pub fn maintenant_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Default for Journal {
    fn default() -> Self {
        Journal {
            interne: Mutex::new(Interne {
                lignes: VecDeque::new(),
                suivant: 1,
                // Un numéro propre à ce lancement : une page qui a vu un autre Yaide vide sa console.
                purge: maintenant_ms(),
            }),
        }
    }
}

impl Journal {
    fn interne(&self) -> std::sync::MutexGuard<'_, Interne> {
        self.interne.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Écrit une ligne à l'heure d'origine `heure` ; la plus ancienne part au-delà de 1 000.
    pub fn ecrire_a(&self, heure: u64, severite: Severite, message: &str, detail: Option<String>) {
        let mut j = self.interne();
        let numero = j.suivant;
        j.suivant += 1;
        j.lignes.push_back(Ligne {
            numero,
            heure,
            severite,
            message: message.to_string(),
            detail,
        });
        while j.lignes.len() > MAX_LIGNES {
            j.lignes.pop_front();
        }
    }

    pub fn ecrire(&self, severite: Severite, message: &str) {
        self.ecrire_a(maintenant_ms(), severite, message, None);
    }

    /// Numéro de purge et lignes de numéro supérieur à `apres`.
    pub fn depuis(&self, apres: u64) -> (u64, Vec<Ligne>) {
        let j = self.interne();
        let l = j
            .lignes
            .iter()
            .filter(|l| l.numero > apres)
            .cloned()
            .collect();
        (j.purge, l)
    }

    /// Vide le journal et change son numéro de purge.
    pub fn purger(&self) {
        let mut j = self.interne();
        j.lignes.clear();
        j.purge += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn req186_ac8_1001_lignes_en_gardent_1000_la_plus_ancienne_part() {
        let j = Journal::default();
        for i in 1..=1001 {
            j.ecrire(Severite::Information, &format!("ligne {i}"));
        }
        let (_, l) = j.depuis(0);
        assert_eq!(l.len(), 1000);
        assert_eq!(l[0].message, "ligne 2");
        assert_eq!(l[999].message, "ligne 1001");
        assert_eq!(l[999].numero, 1001);
    }

    #[test]
    fn req186_ac8_depuis_ne_rend_que_les_lignes_apres_le_numero() {
        let j = Journal::default();
        j.ecrire(Severite::Erreur, "a");
        j.ecrire(Severite::Erreur, "b");
        let (_, l) = j.depuis(1);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].message, "b");
        assert!(j.depuis(2).1.is_empty());
    }

    #[test]
    fn req186_ac8_purge_vide_le_journal_et_change_le_numero_de_purge() {
        let j = Journal::default();
        j.ecrire(Severite::Avertissement, "a");
        let (avant, _) = j.depuis(0);
        j.purger();
        let (apres, l) = j.depuis(0);
        assert!(l.is_empty());
        assert_ne!(avant, apres);
        j.ecrire(Severite::Information, "b");
        assert_eq!(j.depuis(0).1[0].numero, 2);
    }
}
