//! Version lancée, dernière release GitHub (lue toutes les 10 minutes) et mise à jour (DEC-061, DEC-062).
use std::future::Future;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::watch;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const URL_PAR_DEFAUT: &str = "https://github.com/tixplop/yaide/releases/latest";
pub const PERIODE: Duration = Duration::from_secs(600);

/// État d'une mise à jour demandée depuis l'interface.
#[derive(Clone, Debug, PartialEq)]
pub enum Maj {
    Aucune,
    EnCours,
    Installee(String),
    Echec(String),
}

pub struct Version {
    derniere: Mutex<Option<String>>,
    maj: watch::Sender<Maj>,
}

impl Version {
    pub fn new() -> Version {
        Version {
            derniere: Mutex::new(None),
            maj: watch::channel(Maj::Aucune).0,
        }
    }

    pub fn garder(&self, v: String) {
        *self.derniere.lock().unwrap() = Some(v);
    }

    /// La dernière version lue, si elle est plus grande que la version lancée.
    pub fn derniere(&self) -> Option<String> {
        self.derniere
            .lock()
            .unwrap()
            .clone()
            .filter(|d| plus_recente(d, VERSION))
    }

    pub fn etat_maj(&self) -> Maj {
        self.maj.borrow().clone()
    }

    /// Passe à `EnCours` ; faux si une installation est déjà en cours.
    pub fn demarrer_maj(&self) -> bool {
        self.maj.send_if_modified(|m| {
            if *m == Maj::EnCours {
                false
            } else {
                *m = Maj::EnCours;
                true
            }
        })
    }

    pub fn finir_maj(&self, m: Maj) {
        self.maj.send_replace(m);
    }

    /// Attend la fin de l'installation en cours et rend son issue.
    pub async fn attendre_maj(&self) -> Maj {
        let mut rx = self.maj.subscribe();
        let issue = match rx.wait_for(|m| *m != Maj::EnCours).await {
            Ok(m) => m.clone(),
            Err(_) => Maj::Aucune,
        };
        issue
    }
}

pub fn url_releases() -> String {
    std::env::var("YAIDE_URL_RELEASES").unwrap_or_else(|_| URL_PAR_DEFAUT.to_string())
}

/// `https://…/releases/tag/v0.9.2` → `0.9.2` ; seul `X.Y.Z` est accepté.
pub fn extraire(location: &str) -> Option<String> {
    let v = location.rsplit_once("/tag/v")?.1;
    let nombres: Vec<&str> = v.split('.').collect();
    let valide = nombres.len() == 3
        && nombres
            .iter()
            .all(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()));
    valide.then(|| v.to_string())
}

fn trois_nombres(v: &str) -> Option<[u64; 3]> {
    let mut it = v.split('.').map(|n| n.parse::<u64>().ok());
    let r = [it.next()??, it.next()??, it.next()??];
    it.next().is_none().then_some(r)
}

/// Vrai si `a` est strictement plus grande que `b` (comparaison des trois nombres).
pub fn plus_recente(a: &str, b: &str) -> bool {
    matches!((trois_nombres(a), trois_nombres(b)), (Some(a), Some(b)) if a > b)
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

/// Demande la dernière release, sans suivre la redirection. `None` si illisible ou injoignable.
pub async fn lire_derniere(client: &reqwest::Client, url: &str) -> Option<String> {
    let rep = client.get(url).send().await.ok()?;
    let location = rep
        .headers()
        .get(reqwest::header::LOCATION)?
        .to_str()
        .ok()?;
    extraire(location)
}

/// Appelle `demander` tout de suite, puis toutes les `periode`, sans autre appel entre deux.
pub async fn repeter<F, Fut>(periode: Duration, mut demander: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    let mut horloge = tokio::time::interval(periode);
    horloge.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        horloge.tick().await;
        demander().await;
    }
}

/// Raison d'un échec de `install.sh` : sa dernière ligne d'erreur, sans « Erreur : » ni point final.
pub fn raison(stderr: &str) -> String {
    let ligne = stderr
        .lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .unwrap_or("mise à jour impossible");
    let ligne = ligne.strip_prefix("Erreur : ").unwrap_or(ligne);
    ligne.trim_end_matches('.').to_string()
}

/// Version écrite par `install.sh` (`v0.9.2` → `0.9.2`).
pub fn version_installee() -> Option<String> {
    let base = match std::env::var("XDG_DATA_HOME") {
        Ok(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => std::path::PathBuf::from(std::env::var("HOME").ok()?).join(".local/share"),
    };
    let v = std::fs::read_to_string(base.join("yaide/version")).ok()?;
    Some(v.trim().trim_start_matches('v').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn req092_ac4_extraire_location() {
        assert_eq!(
            extraire("https://github.com/tixplop/yaide/releases/tag/v0.9.2"),
            Some("0.9.2".into())
        );
        for illisible in [
            "",
            "https://x/tag/v0.9",
            "https://x/tag/v0.9.2.1",
            "https://x/tag/v1.a.2",
            "https://x/tag/0.9.2",
            "https://x/tag/v0.9.2-rc1",
        ] {
            assert_eq!(extraire(illisible), None, "{illisible}");
        }
    }

    #[test]
    fn req092_ac4_comparaison_des_trois_nombres() {
        assert!(plus_recente("0.9.2", "0.9.1"));
        assert!(plus_recente("0.10.0", "0.9.9"));
        assert!(plus_recente("1.0.0", "0.99.99"));
        assert!(!plus_recente("0.9.1", "0.9.1"));
        assert!(!plus_recente("0.8.0", "0.9.1"));
        assert!(!plus_recente("x", "0.9.1"));
    }

    #[test]
    fn req092_ac4_derniere_ignore_une_version_non_plus_recente() {
        let v = Version::new();
        assert_eq!(v.derniere(), None);
        v.garder(VERSION.to_string());
        assert_eq!(v.derniere(), None);
        v.garder("999.0.0".to_string());
        assert_eq!(v.derniere(), Some("999.0.0".into()));
    }

    #[test]
    fn req093_ac3_raison_sans_prefixe_ni_point() {
        assert_eq!(
            raison("Téléchargement…\nErreur : empreinte SHA-256 incorrecte.\n"),
            "empreinte SHA-256 incorrecte"
        );
        assert_eq!(raison(""), "mise à jour impossible");
    }

    #[tokio::test(start_paused = true)]
    async fn req092_ac2_une_demande_au_lancement_une_a_dix_minutes() {
        let n = Arc::new(AtomicUsize::new(0));
        let n2 = n.clone();
        let t = tokio::spawn(repeter(PERIODE, move || {
            let n = n2.clone();
            async move {
                n.fetch_add(1, Ordering::SeqCst);
            }
        }));
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert_eq!(n.load(Ordering::SeqCst), 1);
        tokio::time::sleep(Duration::from_secs(598)).await;
        assert_eq!(n.load(Ordering::SeqCst), 1);
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(n.load(Ordering::SeqCst), 2);
        tokio::time::sleep(Duration::from_secs(590)).await;
        assert_eq!(n.load(Ordering::SeqCst), 2);
        t.abort();
    }
}
