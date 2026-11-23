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
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

/// Taille de l'affichage récent gardé par shell.
pub const TAMPON_MAX: usize = 1024 * 1024;

/// Une commande terminée dans un shell de Yaide, relevée par l'intégration à bash ou zsh.
#[derive(Clone, Debug)]
pub struct Commande {
    pub commande: String,
    pub dossier: String,
    pub code: i64,
}

const AMORCE: &[u8] = b"\x1b]7733;";
/// Au-delà, un début de séquence sans fin n'en est pas une.
const MESSAGE_MAX: usize = 16 * 1024;

/// Retire de la sortie d'un shell la séquence de l'intégration, d'un bloc à l'autre :
/// `d;<commande>` au départ d'une commande, `f;<code>;<dossier>` à son retour à l'invite.
#[derive(Default)]
struct Filtre {
    reste: Vec<u8>,
    en_cours: Option<String>,
}

impl Filtre {
    fn message(&mut self, m: &[u8], commandes: &mut Vec<Commande>) {
        let m = String::from_utf8_lossy(m);
        if let Some(c) = m.strip_prefix("d;") {
            self.en_cours = Some(c.to_string());
        } else if let Some((code, dossier)) = m.strip_prefix("f;").and_then(|f| f.split_once(';')) {
            if let (Some(commande), Ok(code)) = (self.en_cours.take(), code.parse()) {
                commandes.push(Commande {
                    commande,
                    dossier: dossier.to_string(),
                    code,
                });
            }
        }
    }

    fn filtrer(&mut self, bloc: &[u8], commandes: &mut Vec<Commande>) -> Vec<u8> {
        let mut r = std::mem::take(&mut self.reste);
        r.extend_from_slice(bloc);
        let mut sortie = Vec::with_capacity(r.len());
        let mut i = 0;
        while i < r.len() {
            let Some(p) = r[i..].iter().position(|&b| b == 0x1b) else {
                sortie.extend_from_slice(&r[i..]);
                break;
            };
            sortie.extend_from_slice(&r[i..i + p]);
            i += p;
            let suite = &r[i..];
            if suite.starts_with(AMORCE) {
                match suite.iter().position(|&b| b == 7) {
                    Some(f) => {
                        self.message(&suite[AMORCE.len()..f], commandes);
                        i += f + 1;
                    }
                    None if suite.len() < MESSAGE_MAX => {
                        self.reste = suite.to_vec();
                        break;
                    }
                    None => {
                        sortie.push(0x1b);
                        i += 1;
                    }
                }
            } else if AMORCE.starts_with(suite) {
                self.reste = suite.to_vec();
                break;
            } else {
                sortie.push(0x1b);
                i += 1;
            }
        }
        sortie
    }
}

/// Intégration embarquée : les fichiers écrits dans le dossier de configuration au lancement.
const BASH_RC: &str = include_str!("integration-shell/bash-rc");
const ZSH_FICHIERS: [(&str, &str); 3] = [
    (".zshenv", include_str!("integration-shell/zsh/zshenv")),
    (".zprofile", include_str!("integration-shell/zsh/zprofile")),
    (".zshrc", include_str!("integration-shell/zsh/zshrc")),
];

fn ecrire_si_different(chemin: &Path, contenu: &str) -> std::io::Result<()> {
    if std::fs::read_to_string(chemin).is_ok_and(|c| c == contenu) {
        return Ok(());
    }
    let tmp = chemin.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, contenu)?;
    std::fs::rename(&tmp, chemin)
}

/// Ce qui branche l'intégration à un shell : arguments et variables d'environnement.
struct Integration {
    args: Vec<String>,
    env: Vec<(String, String)>,
}

/// Arguments et variables qui branchent l'intégration au shell `programme` (bash ou zsh) ;
/// `None` pour tout autre shell.
fn integration(programme: &str, dossier: &Path) -> std::io::Result<Option<Integration>> {
    let nom = Path::new(programme).file_name().and_then(|n| n.to_str());
    match nom {
        Some("bash") => {
            std::fs::create_dir_all(dossier)?;
            let rc = dossier.join("bash-rc");
            ecrire_si_different(&rc, BASH_RC)?;
            Ok(Some(Integration {
                args: vec!["--rcfile".into(), rc.to_string_lossy().into_owned()],
                env: Vec::new(),
            }))
        }
        Some("zsh") => {
            let zsh = dossier.join("zsh");
            std::fs::create_dir_all(&zsh)?;
            for (nom, contenu) in ZSH_FICHIERS {
                ecrire_si_different(&zsh.join(nom), contenu)?;
            }
            let ancien = std::env::var("ZDOTDIR").ok().filter(|z| !z.is_empty());
            let origine = ancien
                .clone()
                .or_else(|| std::env::var("HOME").ok())
                .unwrap_or_default();
            let mut env = vec![
                ("ZDOTDIR".to_string(), zsh.to_string_lossy().into_owned()),
                (
                    "YAIDE_ZDOTDIR".to_string(),
                    zsh.to_string_lossy().into_owned(),
                ),
                ("YAIDE_ZDOTDIR_ORIG".to_string(), origine),
            ];
            if ancien.is_some() {
                env.push(("YAIDE_ZDOTDIR_DEFINI".to_string(), "1".to_string()));
            }
            Ok(Some(Integration {
                args: Vec::new(),
                env,
            }))
        }
        _ => Ok(None),
    }
}

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
    claude: bool,
    /// Code de sortie de l'enfant, -1 tant qu'il n'est pas connu.
    code: AtomicI64,
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
    clients: AtomicUsize,
    /// Commandes terminées, en attente des déclencheurs (REQ-167).
    commandes: Mutex<Vec<Commande>>,
}

/// Connexion WebSocket en cours : `Registre::arreter` attend qu'elle soit libérée.
pub struct GardeClient(Arc<Registre>);

impl Drop for GardeClient {
    fn drop(&mut self) {
        self.0.clients.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Délai avant SIGKILL : 3 s, sauf si `YAIDE_DELAI_SIGKILL_MS` (variable de test) donne un
/// nombre de millisecondes.
pub fn delai_sigkill() -> Duration {
    delai_depuis(std::env::var("YAIDE_DELAI_SIGKILL_MS").ok().as_deref())
}

fn delai_depuis(valeur: Option<&str>) -> Duration {
    match valeur.and_then(|v| v.trim().parse::<u64>().ok()) {
        Some(ms) if ms > 0 => Duration::from_millis(ms),
        _ => Duration::from_secs(3),
    }
}

/// Nombre de tours de 100 ms (au moins 1) avant SIGKILL.
fn tours_sigkill() -> u64 {
    (delai_sigkill().as_millis() as u64).div_ceil(100).max(1)
}

fn signaler(pgid: i32, signal: i32) -> bool {
    // SAFETY : kill n'a pas d'effet mémoire ; pgid vient d'un shell lancé par nous.
    unsafe { libc::kill(-pgid, signal) == 0 }
}

/// Processus vivants (pid, ppid, session), sans les zombies, d'après `/proc/<pid>/stat`.
fn processus() -> Vec<(i32, i32, i32)> {
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
            let ppid: i32 = champs.next()?.parse().ok()?;
            let sid: i32 = champs.nth(1)?.parse().ok()?;
            (etat != "Z").then_some((pid, ppid, sid))
        })
        .collect()
}

/// Processus vivants de la session du shell : le contrôle des tâches du shell
/// place ses tâches de fond dans d'autres groupes, que le signal au groupe manque.
fn membres(session: i32) -> Vec<i32> {
    processus()
        .into_iter()
        .filter(|&(_, _, sid)| sid == session)
        .map(|(pid, _, _)| pid)
        .collect()
}

/// Tous les descendants vivants de `racine`, à toute profondeur, même dans une autre session.
pub(crate) fn descendants(racine: i32) -> Vec<i32> {
    let tous = processus();
    let mut trouves: Vec<i32> = Vec::new();
    let mut a_voir = vec![racine];
    while let Some(parent) = a_voir.pop() {
        for &(pid, ppid, _) in &tous {
            if ppid == parent && !trouves.contains(&pid) {
                trouves.push(pid);
                a_voir.push(pid);
            }
        }
    }
    trouves
}

/// Vrai si le processus existe encore et n'est pas un zombie.
pub(crate) fn vivant(pid: i32) -> bool {
    processus().iter().any(|&(p, _, _)| p == pid)
}

/// Signal à un processus seul.
pub(crate) fn signaler_pid(pid: i32, signal: i32) {
    // SAFETY : kill n'a pas d'effet mémoire ; le pid vient d'un descendant d'un processus lancé par nous.
    unsafe { libc::kill(pid, signal) };
}

/// Signal au groupe du shell et à tous les processus de sa session.
fn signaler_tout(pgid: i32, signal: i32) {
    signaler(pgid, signal);
    for pid in membres(pgid) {
        // SAFETY : voir `signaler`.
        unsafe { libc::kill(pid, signal) };
    }
}

/// Variables d'une session Claude Code parente, retirées de l'environnement de `claude`.
const VARIABLES_CLAUDE_CODE: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_PID",
    "AI_AGENT",
];

/// Premier fichier exécutable `claude` dans les dossiers du `PATH`, cherché à chaque appel.
pub fn trouver_claude() -> Option<std::path::PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join("claude"))
        .find(|c| {
            std::fs::metadata(c).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        })
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

    /// Vrai si le shell est terminé (sa fin a déjà été diffusée).
    pub fn est_fini(&self) -> bool {
        self.fini.load(Ordering::SeqCst)
    }

    pub fn est_claude(&self) -> bool {
        self.claude
    }

    /// Code de sortie de l'enfant, s'il est connu.
    pub fn code_sortie(&self) -> Option<i64> {
        Some(self.code.load(Ordering::SeqCst)).filter(|&c| c >= 0)
    }

    fn terminer(&self) {
        if self.fini.swap(true, Ordering::SeqCst) {
            return;
        }
        // Une session Claude finie reste connue jusqu'à sa fermeture : on peut relire son affichage.
        if !self.claude {
            self.registre.liste.lock().unwrap().shells.remove(&self.id);
        }
        signaler_tout(self.pgid, libc::SIGHUP);
        let _ = self.diffusion.send(Evenement::Fin);
    }
}

impl Registre {
    pub fn obtenir(&self, id: u32) -> Option<Arc<Shell>> {
        self.liste.lock().unwrap().shells.get(&id).cloned()
    }

    pub fn client(self: &Arc<Self>) -> GardeClient {
        self.clients.fetch_add(1, Ordering::SeqCst);
        GardeClient(self.clone())
    }

    /// Attend la libération des gardes de clients, 2 s au plus.
    async fn attendre_clients(&self) {
        let attente = async {
            while self.clients.load(Ordering::SeqCst) != 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        let _ = tokio::time::timeout(Duration::from_secs(2), attente).await;
    }

    /// Identifiants des shells, sans les sessions Claude.
    pub fn ids(&self) -> Vec<u32> {
        let l = self.liste.lock().unwrap();
        l.shells
            .iter()
            .filter(|(_, s)| !s.claude)
            .map(|(&i, _)| i)
            .collect()
    }

    /// Les commandes terminées depuis le dernier appel.
    pub fn prendre_commandes(&self) -> Vec<Commande> {
        std::mem::take(&mut *self.commandes.lock().unwrap())
    }

    /// Un shell ; avec bash ou zsh, l'intégration écrite dans `config` relève les commandes.
    pub fn ouvrir(self: &Arc<Self>, projet: &Path, config: &Path) -> Result<u32, String> {
        let programme = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/bin/sh".to_string());
        let reglage = match integration(&programme, &config.join("integration-shell")) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("intégration au shell impossible : {e}");
                None
            }
        };
        self.lancer(projet, &programme, false, &[], reglage.as_ref())
    }

    /// Session Claude : `claude` sans argument dans le dossier du projet, sans les variables
    /// d'une session Claude Code parente (sinon Claude Code refuse de démarrer).
    pub fn ouvrir_claude(self: &Arc<Self>, projet: &Path) -> Result<u32, String> {
        let chemin = trouver_claude().ok_or("la commande claude est introuvable dans le PATH")?;
        let programme = chemin.to_string_lossy().into_owned();
        self.lancer(projet, &programme, true, VARIABLES_CLAUDE_CODE, None)
    }

    fn lancer(
        self: &Arc<Self>,
        projet: &Path,
        programme: &str,
        claude: bool,
        retirer: &[&str],
        integration: Option<&Integration>,
    ) -> Result<u32, String> {
        let paire = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(programme);
        cmd.cwd(projet);
        cmd.env("TERM", "xterm-256color");
        for v in retirer {
            cmd.env_remove(v);
        }
        if let Some(i) = integration {
            cmd.args(&i.args);
            for (k, v) in &i.env {
                cmd.env(k, v);
            }
        }
        let mut enfant = paire
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("{programme} : {e}"))?;
        drop(paire.slave);
        let pgid = enfant.process_id().ok_or("processus introuvable")? as i32;
        let mut lecteur = paire.master.try_clone_reader().map_err(|e| e.to_string())?;
        let mut ecrivain = paire.master.take_writer().map_err(|e| e.to_string())?;
        let (entree, recue) = mpsc::channel::<Vec<u8>>();
        let (diffusion, _) = broadcast::channel(4096);

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
            claude,
            code: AtomicI64::new(-1),
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
        let mut filtre = integration.map(|_| Filtre::default());
        std::thread::spawn(move || {
            let mut bloc = [0u8; 8192];
            while let Ok(n) = lecteur.read(&mut bloc) {
                if n == 0 {
                    break;
                }
                let donnees = match filtre.as_mut() {
                    Some(f) => {
                        let mut finies = Vec::new();
                        let d = f.filtrer(&bloc[..n], &mut finies);
                        if !finies.is_empty() {
                            let mut file = s.registre.commandes.lock().unwrap();
                            file.extend(finies);
                            let trop = file.len().saturating_sub(1000);
                            file.drain(..trop);
                        }
                        d
                    }
                    None => bloc[..n].to_vec(),
                };
                if donnees.is_empty() {
                    continue;
                }
                let mut t = s.tampon.lock().unwrap();
                t.extend(&donnees);
                if t.len() > TAMPON_MAX {
                    let trop = t.len() - TAMPON_MAX;
                    t.drain(..trop);
                }
                // Sans abonné, l'envoi échoue : ce n'est pas une erreur.
                let _ = s.diffusion.send(Evenement::Sortie(Arc::new(donnees)));
            }
            s.terminer();
        });
        let s = shell;
        std::thread::spawn(move || {
            if let Ok(statut) = enfant.wait() {
                s.code
                    .store(i64::from(statut.exit_code()), Ordering::SeqCst);
            }
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
        self.liste.lock().unwrap().shells.remove(&id);
        let pgid = shell.pgid;
        std::thread::spawn(move || {
            signaler_tout(pgid, libc::SIGTERM);
            for _ in 0..tours_sigkill() {
                if membres(pgid).is_empty() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            signaler_tout(pgid, libc::SIGKILL);
        });
        true
    }

    /// Arrêt du serveur : signal au groupe de chaque shell, puis abandon forcé. Pour une session
    /// Claude, ses descendants (même dans une autre session Unix) sont relevés avant le premier
    /// signal, reçoivent les mêmes signaux et sont attendus.
    pub async fn arreter(&self) {
        self.arret.store(true, Ordering::SeqCst);
        let (groupes, claude): (Vec<i32>, Vec<i32>) = {
            let l = self.liste.lock().unwrap();
            (
                l.shells.values().map(|s| s.pgid).collect(),
                l.shells
                    .values()
                    .filter(|s| s.claude)
                    .map(|s| s.pgid)
                    .collect(),
            )
        };
        let suivis: Vec<i32> = claude.iter().flat_map(|&p| descendants(p)).collect();
        for &g in &groupes {
            signaler_tout(g, libc::SIGHUP);
            signaler_tout(g, libc::SIGTERM);
        }
        for &p in &suivis {
            signaler_pid(p, libc::SIGHUP);
            signaler_pid(p, libc::SIGTERM);
        }
        for _ in 0..tours_sigkill() {
            if groupes.iter().all(|&g| membres(g).is_empty()) && !suivis.iter().any(|&p| vivant(p))
            {
                self.attendre_clients().await;
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        for &g in &groupes {
            signaler_tout(g, libc::SIGKILL);
        }
        for &p in &suivis {
            signaler_pid(p, libc::SIGKILL);
        }
        self.attendre_clients().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::Instant;

    #[test]
    fn delai_sigkill_3_s_par_defaut_ou_si_illisible_ou_nul_sinon_la_valeur() {
        assert_eq!(delai_depuis(None), Duration::from_secs(3));
        assert_eq!(delai_depuis(Some("abc")), Duration::from_secs(3));
        assert_eq!(delai_depuis(Some("0")), Duration::from_secs(3));
        assert_eq!(delai_depuis(Some("300")), Duration::from_millis(300));
    }

    fn filtrer_blocs(blocs: &[&[u8]]) -> (Vec<u8>, Vec<Commande>) {
        let mut f = Filtre::default();
        let (mut sortie, mut commandes) = (Vec::new(), Vec::new());
        for b in blocs {
            sortie.extend(f.filtrer(b, &mut commandes));
        }
        (sortie, commandes)
    }

    #[test]
    fn le_filtre_retire_la_sequence_meme_coupee_et_releve_la_commande() {
        let (sortie, cmds) = filtrer_blocs(&[
            b"$ \x1b]7733;d;cargo te",
            b"st; x\x07sortie\r\n\x1b",
            b"]77",
            b"33;f;101;/p;q\x07$ ",
        ]);
        assert_eq!(String::from_utf8(sortie).unwrap(), "$ sortie\r\n$ ");
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].commande, "cargo test; x");
        assert_eq!(cmds[0].dossier, "/p;q");
        assert_eq!(cmds[0].code, 101);
    }

    #[test]
    fn le_filtre_laisse_passer_les_autres_sequences_et_ignore_une_fin_seule() {
        let (sortie, cmds) = filtrer_blocs(&[b"[31mrouge[0m", b"x]7733;f;0;/p"]);
        assert_eq!(sortie, b"[31mrouge[0mx");
        assert!(cmds.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn arreter_attend_les_gardes_de_clients() {
        let r = Arc::new(Registre::default());
        let garde = r.client();
        let r2 = r.clone();
        let t = tokio::spawn(async move { r2.arreter().await });
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(
            !t.is_finished(),
            "arreter a rendu la main avec un garde vivant"
        );
        let debut = Instant::now();
        drop(garde);
        t.await.unwrap();
        assert!(debut.elapsed() < Duration::from_millis(500));
    }

    #[tokio::test(start_paused = true)]
    async fn arreter_rend_la_main_apres_2_s_si_le_garde_reste() {
        let r = Arc::new(Registre::default());
        let _garde = r.client();
        let debut = Instant::now();
        r.arreter().await;
        let ecoule = debut.elapsed();
        assert!(ecoule >= Duration::from_secs(2), "{ecoule:?}");
        assert!(ecoule <= Duration::from_secs(2), "{ecoule:?}");
    }

    #[tokio::test(start_paused = true)]
    async fn arreter_sans_client_rend_la_main_tout_de_suite() {
        let r = Arc::new(Registre::default());
        let debut = Instant::now();
        r.arreter().await;
        assert!(debut.elapsed() < Duration::from_millis(200));
    }
}
