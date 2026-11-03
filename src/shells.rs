//! Shells du projet : un terminal par shell, gardé par le serveur.
//!
//! Protocole WebSocket de `/api/shells/{id}/ws` :
//! - serveur vers client : trames binaires de sortie (d'abord le dernier 1 Mo, puis le direct) ;
//!   à la fin du shell, le serveur ferme la connexion (code 1000), ou avec le code 1001 si c'est
//!   l'arrêt de Yaide qui le termine ;
//! - client vers serveur : trame binaire = touches pour le shell ;
//!   trame texte `taille COLONNES LIGNES` = nouvelle taille du terminal.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::{BTreeMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

/// Taille de l'affichage récent gardé par shell.
pub const TAMPON_MAX: usize = 1024 * 1024;

#[derive(Clone)]
pub enum Evenement {
    Sortie(Arc<Vec<u8>>),
    Fin,
}

pub struct Shell {
    pgid: i32,
    tampon: Mutex<VecDeque<u8>>,
    diffusion: broadcast::Sender<Evenement>,
    entree: mpsc::Sender<Vec<u8>>,
    terminal: Mutex<Box<dyn MasterPty + Send>>,
    fini: AtomicBool,
    registre: Arc<Registre>,
    id: u32,
}

#[derive(Default)]
struct Liste {
    prochain: u32,
    shells: BTreeMap<u32, Arc<Shell>>,
}

#[derive(Default)]
pub struct Registre {
    liste: Mutex<Liste>,
    arret: AtomicBool,
}

fn signaler(pgid: i32, signal: i32) -> bool {
    // SAFETY : kill n'a pas d'effet mémoire ; pgid vient d'un shell lancé par nous.
    unsafe { libc::kill(-pgid, signal) == 0 }
}

/// Processus vivants de la session du shell : le contrôle des tâches du shell
/// place ses tâches de fond dans d'autres groupes, que le signal au groupe manque.
fn membres(session: i32) -> Vec<i32> {
    let Ok(dossier) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    dossier
        .flatten()
        .filter_map(|e| {
            let pid: i32 = e.file_name().to_str()?.parse().ok()?;
            let stat = std::fs::read_to_string(e.path().join("stat")).ok()?;
            // Après le nom (entre parenthèses) : état, ppid, groupe, session.
            let mut champs = stat.rsplit_once(')')?.1.split_whitespace();
            let etat = champs.next()?;
            let sid: i32 = champs.nth(2)?.parse().ok()?;
            (sid == session && etat != "Z").then_some(pid)
        })
        .collect()
}

/// Signal au groupe du shell et à tous les processus de sa session.
fn signaler_tout(pgid: i32, signal: i32) {
    signaler(pgid, signal);
    for pid in membres(pgid) {
        // SAFETY : voir `signaler`.
        unsafe { libc::kill(pid, signal) };
    }
}

impl Shell {
    /// Affichage récent et abonnement au direct, sans trou ni doublon.
    pub fn abonner(&self) -> (Vec<u8>, broadcast::Receiver<Evenement>) {
        let t = self.tampon.lock().unwrap();
        (t.iter().copied().collect(), self.diffusion.subscribe())
    }

    pub fn ecrire(&self, octets: Vec<u8>) {
        let _ = self.entree.send(octets);
    }

    pub fn redimensionner(&self, colonnes: u16, lignes: u16) {
        let _ = self.terminal.lock().unwrap().resize(PtySize {
            rows: lignes,
            cols: colonnes,
            pixel_width: 0,
            pixel_height: 0,
        });
    }

    /// Vrai si Yaide s'arrête : la fin du shell vient alors de l'arrêt, pas d'un `exit`.
    pub fn serveur_arrete(&self) -> bool {
        self.registre.arret.load(Ordering::SeqCst)
    }

    fn terminer(&self) {
        if self.fini.swap(true, Ordering::SeqCst) {
            return;
        }
        self.registre.liste.lock().unwrap().shells.remove(&self.id);
        signaler_tout(self.pgid, libc::SIGHUP);
        let _ = self.diffusion.send(Evenement::Fin);
    }
}

impl Registre {
    pub fn obtenir(&self, id: u32) -> Option<Arc<Shell>> {
        self.liste.lock().unwrap().shells.get(&id).cloned()
    }

    pub fn ids(&self) -> Vec<u32> {
        self.liste.lock().unwrap().shells.keys().copied().collect()
    }

    pub fn ouvrir(self: &Arc<Self>, projet: &Path) -> Result<u32, String> {
        let programme = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/bin/sh".to_string());
        let paire = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(&programme);
        cmd.cwd(projet);
        cmd.env("TERM", "xterm-256color");
        let mut enfant = paire
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("{programme} : {e}"))?;
        drop(paire.slave);
        let pgid = enfant.process_id().ok_or("processus introuvable")? as i32;
        let mut lecteur = paire.master.try_clone_reader().map_err(|e| e.to_string())?;
        let mut ecrivain = paire.master.take_writer().map_err(|e| e.to_string())?;
        let (entree, recue) = mpsc::channel::<Vec<u8>>();
        let (diffusion, _) = broadcast::channel(512);

        let id = {
            let mut l = self.liste.lock().unwrap();
            l.prochain += 1;
            l.prochain
        };
        let shell = Arc::new(Shell {
            pgid,
            tampon: Mutex::new(VecDeque::new()),
            diffusion,
            entree,
            terminal: Mutex::new(paire.master),
            fini: AtomicBool::new(false),
            registre: self.clone(),
            id,
        });
        self.liste.lock().unwrap().shells.insert(id, shell.clone());

        std::thread::spawn(move || {
            while let Ok(octets) = recue.recv() {
                if ecrivain
                    .write_all(&octets)
                    .and_then(|_| ecrivain.flush())
                    .is_err()
                {
                    break;
                }
            }
        });
        let s = shell.clone();
        std::thread::spawn(move || {
            let mut bloc = [0u8; 8192];
            while let Ok(n) = lecteur.read(&mut bloc) {
                if n == 0 {
                    break;
                }
                let mut t = s.tampon.lock().unwrap();
                t.extend(&bloc[..n]);
                if t.len() > TAMPON_MAX {
                    let trop = t.len() - TAMPON_MAX;
                    t.drain(..trop);
                }
                // Sans abonné, l'envoi échoue : ce n'est pas une erreur.
                let _ = s
                    .diffusion
                    .send(Evenement::Sortie(Arc::new(bloc[..n].to_vec())));
            }
            s.terminer();
        });
        let s = shell;
        std::thread::spawn(move || {
            let _ = enfant.wait();
            // Laisse le lecteur finir de vider la sortie avant de clore.
            std::thread::sleep(Duration::from_millis(300));
            s.terminer();
        });
        Ok(id)
    }

    /// Fermeture d'un shell à la demande : faux si l'identifiant est inconnu. SIGHUP tout de
    /// suite, puis SIGTERM, puis SIGKILL après 3 s pour ce qui reste, sans faire attendre l'appelant.
    pub fn fermer(&self, id: u32) -> bool {
        let Some(shell) = self.obtenir(id) else {
            return false;
        };
        shell.terminer();
        let pgid = shell.pgid;
        std::thread::spawn(move || {
            signaler_tout(pgid, libc::SIGTERM);
            for _ in 0..30 {
                if membres(pgid).is_empty() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            signaler_tout(pgid, libc::SIGKILL);
        });
        true
    }

    /// Arrêt du serveur : signal au groupe de chaque shell, puis abandon forcé.
    pub async fn arreter(&self) {
        self.arret.store(true, Ordering::SeqCst);
        let groupes: Vec<i32> = self
            .liste
            .lock()
            .unwrap()
            .shells
            .values()
            .map(|s| s.pgid)
            .collect();
        for &g in &groupes {
            signaler_tout(g, libc::SIGHUP);
            signaler_tout(g, libc::SIGTERM);
        }
        for _ in 0..30 {
            if groupes.iter().all(|&g| membres(g).is_empty()) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        for &g in &groupes {
            signaler_tout(g, libc::SIGKILL);
        }
    }
}
