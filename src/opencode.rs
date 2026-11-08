//! Serveur `opencode serve` de la machine, lancé par Yaide dans le projet (DEC-050).

use ring::rand::{SecureRandom, SystemRandom};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as MutexStd};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::shells::{descendants, signaler_pid, vivant};

pub const RAISON_PAR_DEFAUT: &str = "le serveur opencode ne répond pas";
const STDERR_MAX: usize = 4096;

fn trouver() -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join("opencode"))
        .find(|c| {
            std::fs::metadata(c).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        })
}

/// Vrai si la sortie de `opencode --version` annonce une version 2.x.
fn version_2(sortie: &str) -> bool {
    let mot = sortie.split_whitespace().last().unwrap_or("");
    let mot = mot.strip_prefix('v').unwrap_or(mot);
    let mut parties = mot.split('.');
    parties.next() == Some("2")
        && parties
            .next()
            .is_some_and(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_digit()))
}

/// `opencode` du `PATH` répond une version 2.x à `--version` (5 s au plus).
pub async fn disponible() -> bool {
    let Some(chemin) = trouver() else {
        return false;
    };
    let sortie = Command::new(chemin)
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(Duration::from_secs(5), sortie).await {
        Ok(Ok(s)) if s.status.success() => version_2(&String::from_utf8_lossy(&s.stdout)),
        _ => false,
    }
}

fn base64url(octets: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut r = String::new();
    for bloc in octets.chunks(3) {
        let n = bloc
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, &o)| n | (o as u32) << (16 - 8 * i));
        for i in 0..=bloc.len() {
            r.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    r
}

struct Lance {
    port: u16,
    mdp: String,
    enfant: Child,
}

/// Le serveur opencode de l'instance : un seul à la fois, relancé s'il s'est arrêté.
#[derive(Default)]
pub struct Opencode {
    lance: Mutex<Option<Lance>>,
    /// Posé dès le début de l'arrêt de Yaide : plus aucun lancement.
    arret: AtomicBool,
}

impl Opencode {
    /// Port et mot de passe d'un serveur prêt, lancé au besoin. Les demandes simultanées
    /// attendent le même lancement. Erreur : la raison, en texte.
    pub async fn assurer(&self, projet: &Path) -> Result<(u16, String), String> {
        if self.arret.load(Ordering::SeqCst) {
            return Err("Yaide s'arrête".to_string());
        }
        let mut lance = self.lance.lock().await;
        if let Some(l) = lance.as_mut() {
            if matches!(l.enfant.try_wait(), Ok(None)) {
                return Ok((l.port, l.mdp.clone()));
            }
            *lance = None;
        }
        let nouveau = demarrer(projet, &self.arret).await?;
        let r = (nouveau.port, nouveau.mdp.clone());
        *lance = Some(nouveau);
        Ok(r)
    }

    /// Arrêt de Yaide : SIGTERM au groupe du serveur et à ses descendants (même dans une autre
    /// session Unix), SIGKILL à ce qui reste après 3 s, même si le chef du groupe a déjà quitté.
    pub async fn arreter(&self) {
        self.arret.store(true, Ordering::SeqCst);
        let mut lance = self.lance.lock().await;
        let Some(mut l) = lance.take() else {
            return;
        };
        let Some(pgid) = l.enfant.id() else {
            return;
        };
        let pgid = pgid as i32;
        let suivis = descendants(pgid);
        signaler(pgid, libc::SIGTERM);
        for &p in &suivis {
            signaler_pid(p, libc::SIGTERM);
        }
        let debut = Instant::now();
        while debut.elapsed() < Duration::from_secs(3) {
            let chef_fini = matches!(l.enfant.try_wait(), Ok(Some(_)));
            if chef_fini && !suivis.iter().any(|&p| vivant(p)) && !groupe_vivant(pgid) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        signaler(pgid, libc::SIGKILL);
        for &p in &suivis {
            signaler_pid(p, libc::SIGKILL);
        }
        let _ = l.enfant.wait().await;
    }
}

/// Reste-t-il un processus dans le groupe `pgid` ?
fn groupe_vivant(pgid: i32) -> bool {
    // SAFETY : le signal 0 ne fait que tester l'existence du groupe.
    unsafe { libc::kill(-pgid, 0) == 0 }
}

fn signaler(pgid: i32, signal: i32) {
    // SAFETY : kill n'a pas d'effet mémoire ; pgid est le groupe d'un processus lancé par nous.
    unsafe { libc::kill(-pgid, signal) };
}

fn port_libre() -> Result<u16, String> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}

fn derniere_ligne(tampon: &MutexStd<Vec<u8>>) -> String {
    let t = tampon.lock().unwrap();
    String::from_utf8_lossy(&t)
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map_or_else(|| RAISON_PAR_DEFAUT.to_string(), str::to_string)
}

async fn demarrer(projet: &Path, arret: &AtomicBool) -> Result<Lance, String> {
    let chemin = trouver().ok_or(RAISON_PAR_DEFAUT)?;
    let port = port_libre()?;
    let mut octets = [0u8; 32];
    SystemRandom::new()
        .fill(&mut octets)
        .map_err(|_| "tirage aléatoire impossible".to_string())?;
    let mdp = base64url(&octets);
    let mut enfant = Command::new(chemin)
        .args([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .current_dir(projet)
        .env("OPENCODE_SERVER_PASSWORD", &mdp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("opencode : {e}"))?;
    // Les 4 derniers Ko de la sortie d'erreur donnent la raison d'un échec.
    let tampon = Arc::new(MutexStd::new(Vec::new()));
    let lecture = enfant.stderr.take().map(|mut e| {
        let t = tampon.clone();
        tokio::spawn(async move {
            let mut bloc = [0u8; 1024];
            while let Ok(n) = e.read(&mut bloc).await {
                if n == 0 {
                    break;
                }
                let mut t = t.lock().unwrap();
                t.extend_from_slice(&bloc[..n]);
                if t.len() > STDERR_MAX {
                    let trop = t.len() - STDERR_MAX;
                    t.drain(..trop);
                }
            }
        })
    });
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{port}/api/info");
    let debut = Instant::now();
    while debut.elapsed() < Duration::from_secs(30) {
        if arret.load(Ordering::SeqCst) {
            break;
        }
        if let Ok(Some(_)) = enfant.try_wait() {
            if let Some(l) = lecture {
                let _ = tokio::time::timeout(Duration::from_secs(1), l).await;
            }
            return Err(derniere_ligne(&tampon));
        }
        let rep = client
            .get(&url)
            .basic_auth("opencode", Some(&mdp))
            .send()
            .await;
        if rep.is_ok_and(|r| r.status() == 200) {
            return Ok(Lance { port, mdp, enfant });
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if let Some(pgid) = enfant.id() {
        signaler(pgid as i32, libc::SIGKILL);
    }
    let _ = enfant.wait().await;
    Err(derniere_ligne(&tampon))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert!(version_2("opencode v2.2.5\n"));
        assert!(version_2("2.0.1"));
        assert!(!version_2("opencode v1.14.0"));
        assert!(!version_2("1.14.0"));
        assert!(!version_2("2"));
        assert!(!version_2("bonjour"));
        assert!(!version_2(""));
    }

    #[test]
    fn base64url_de_32_octets() {
        let s = base64url(&[0xfb; 32]);
        assert_eq!(s.len(), 43);
        assert!(s
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        assert_eq!(base64url(b"Ma"), "TWE");
    }

    #[tokio::test]
    async fn assurer_apres_arreter_refuse() {
        let o = Opencode::default();
        o.arreter().await;
        let r = o.assurer(Path::new("/")).await;
        assert_eq!(r, Err("Yaide s'arrête".to_string()));
    }

    #[tokio::test(start_paused = true)]
    async fn disponible_faux_si_opencode_ne_repond_pas() {
        use std::os::unix::fs::PermissionsExt;
        let dossier =
            std::env::temp_dir().join(format!("yaide-opencode-muet-{}", std::process::id()));
        std::fs::create_dir_all(&dossier).unwrap();
        let script = dossier.join("opencode");
        std::fs::write(&script, "#!/bin/sh\nexec sleep 30\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        // nextest lance chaque test dans son propre processus.
        std::env::set_var("PATH", format!("{}:/usr/bin:/bin", dossier.display()));
        assert!(!disponible().await);
        let _ = std::fs::remove_dir_all(&dossier);
    }
}
