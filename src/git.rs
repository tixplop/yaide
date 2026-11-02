//! Git côté serveur : on lance la commande `git`, comme dans le shell de l'utilisateur.
use crate::depot;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Component, Path};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_DIFF: usize = 5 * 1024 * 1024;
const DELAI_COURT: Duration = Duration::from_secs(60);
const DELAI_RESEAU: Duration = Duration::from_secs(120);

#[derive(Debug)]
pub enum Erreur {
    PasDepot,
    AucunIndexe,
    MessageVide,
    Invalide(String),
    /// Message de git, tel quel.
    Git(String),
}

pub struct Changement {
    pub chemin: String,
    pub statut: &'static str,
    pub indexe: bool,
}

pub struct Etat {
    pub branche: String,
    /// HEAD ne suit aucune branche : `branche` est alors un identifiant de commit.
    pub detachee: bool,
    pub branches: Vec<String>,
    pub changements: Vec<Changement>,
}

pub struct Diff {
    pub binaire: bool,
    pub trop_gros: bool,
    pub texte: String,
}

struct Sortie {
    ok: bool,
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: String,
}

impl Sortie {
    /// Ce que git a dit, stdout puis stderr, sans retouche.
    fn message(&self) -> String {
        let out = String::from_utf8_lossy(&self.stdout);
        [out.trim(), self.stderr.trim()]
            .iter()
            .filter(|s| !s.is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    }
}

type Tampon = Arc<Mutex<Vec<u8>>>;

/// Lit le flux dans `tampon` jusqu'à `max` octets (un de plus si la sortie est plus grosse).
fn lire_borne(mut flux: impl Read, max: usize, tampon: Tampon) {
    let mut bloc = [0u8; 8192];
    loop {
        match flux.read(&mut bloc) {
            Ok(0) | Err(_) => return,
            Ok(n) => {
                let mut t = tampon.lock().unwrap();
                let reste = max + 1 - t.len().min(max + 1);
                t.extend_from_slice(&bloc[..n.min(reste)]);
                if t.len() > max {
                    return;
                }
            }
        }
    }
}

/// Attend un fil un court instant : un processus qui garde le tube ouvert
/// (hook qui lance un programme en arrière-plan) ne doit pas bloquer la réponse.
fn attendre_fil(fil: &std::thread::JoinHandle<()>) {
    let fin = Instant::now() + Duration::from_secs(1);
    while !fil.is_finished() && Instant::now() < fin {
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn lancer(
    dossier: &Path,
    args: &[&str],
    lecture: bool,
    max: usize,
    delai: Option<Duration>,
) -> Result<Sortie, Erreur> {
    let mut cmd = Command::new("git");
    cmd.current_dir(dossier);
    if lecture {
        cmd.arg("--no-optional-locks");
    }
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_EDITOR", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    if std::env::var_os("GIT_SSH_COMMAND").is_none() && !ssh_configure(dossier) {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
    let mut enfant = cmd
        .spawn()
        .map_err(|e| Erreur::Git(format!("Impossible de lancer git : {e}")))?;
    let pid = enfant.id() as i32;
    let tampon_out = Tampon::default();
    let tampon_err = Tampon::default();
    let out = enfant.stdout.take().unwrap();
    let err = enfant.stderr.take().unwrap();
    let t = tampon_out.clone();
    let fil_out = std::thread::spawn(move || lire_borne(out, max, t));
    let t = tampon_err.clone();
    let fil_err = std::thread::spawn(move || lire_borne(err, 1 << 20, t));
    let fin = delai.map(|d| Instant::now() + d);
    let mut delai_depasse = false;
    let statut = loop {
        match enfant.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if fin.is_some_and(|f| Instant::now() >= f) => {
                delai_depasse = true;
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => break None,
        }
        // Sortie plus grosse que la borne : on n'a plus besoin de git.
        if fil_out.is_finished() && tampon_out.lock().unwrap().len() > max {
            break None;
        }
    };
    // Tue git et ses sous-processus (ssh) s'il tourne encore.
    let statut = statut.or_else(|| {
        unsafe { libc::kill(-pid, libc::SIGKILL) };
        enfant.wait().ok()
    });
    attendre_fil(&fil_out);
    attendre_fil(&fil_err);
    let mut stdout = std::mem::take(&mut *tampon_out.lock().unwrap());
    let stderr = String::from_utf8_lossy(&tampon_err.lock().unwrap()).into_owned();
    let trop = stdout.len() > max;
    stdout.truncate(max);
    if delai_depasse {
        return Err(Erreur::Git(format!(
            "git n'a pas fini en {} s ; la commande a été arrêtée.",
            delai.map_or(0, |d| d.as_secs())
        )));
    }
    Ok(Sortie {
        ok: statut.is_some_and(|s| s.success()) || trop,
        code: statut.and_then(|s| s.code()),
        stdout,
        stderr,
    })
}

/// L'utilisateur a-t-il réglé `core.sshCommand` ? Alors on n'y touche pas.
fn ssh_configure(dossier: &Path) -> bool {
    Command::new("git")
        .current_dir(dossier)
        .args(["config", "--get", "core.sshCommand"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn court(d: &Path, args: &[&str], lecture: bool) -> Result<Sortie, Erreur> {
    lancer(d, args, lecture, 64 << 20, Some(DELAI_COURT))
}

/// Action qui modifie le dépôt : pas de limite de temps (un hook peut être long).
fn reussi(d: &Path, args: &[&str]) -> Result<Sortie, Erreur> {
    let s = lancer(d, args, false, 64 << 20, None)?;
    if s.ok {
        Ok(s)
    } else {
        Err(Erreur::Git(s.message()))
    }
}

fn verifier_depot(d: &Path) -> Result<(), Erreur> {
    if depot::est_un_depot(d) {
        Ok(())
    } else {
        Err(Erreur::PasDepot)
    }
}

fn verifier_chemin(chemin: &str) -> Result<(), Erreur> {
    let p = Path::new(chemin);
    let ok = !chemin.is_empty()
        && !chemin.contains('\0')
        && p.components().all(|c| matches!(c, Component::Normal(_)));
    if ok {
        Ok(())
    } else {
        Err(Erreur::Invalide("Ce chemin n'est pas valide.".into()))
    }
}

/// Nom de la branche courante et vrai si HEAD est détachée.
fn branche_courante(d: &Path) -> (String, bool) {
    if let Ok(s) = court(d, &["symbolic-ref", "--short", "-q", "HEAD"], true) {
        if s.ok {
            return (String::from_utf8_lossy(&s.stdout).trim().to_string(), false);
        }
    }
    match court(d, &["rev-parse", "--short", "HEAD"], true) {
        Ok(s) if s.ok => (String::from_utf8_lossy(&s.stdout).trim().to_string(), true),
        _ => (String::new(), false),
    }
}

fn liste_branches(d: &Path) -> Vec<String> {
    match court(
        d,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        true,
    ) {
        Ok(s) if s.ok => String::from_utf8_lossy(&s.stdout)
            .lines()
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn statut_de(x: u8, y: u8) -> (&'static str, bool) {
    if x == b'U' || y == b'U' || (x == b'A' && y == b'A') || (x == b'D' && y == b'D') {
        ("conflit", false)
    } else if x == b'?' {
        ("nouveau", false)
    } else if x == b'R' || x == b'C' {
        ("renommé", true)
    } else if x != b' ' {
        ("indexé", true)
    } else {
        match y {
            b'D' => ("supprimé", false),
            b'R' | b'C' => ("renommé", false),
            _ => ("modifié", false),
        }
    }
}

pub fn etat(d: &Path) -> Result<Etat, Erreur> {
    verifier_depot(d)?;
    let s = court(
        d,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ],
        true,
    )?;
    // Les chemins de `status` partent de la racine du dépôt ; ceux de Yaide, du projet.
    let prefixe = court(d, &["rev-parse", "--show-prefix"], true)?;
    let prefixe = String::from_utf8_lossy(&prefixe.stdout).trim().to_string();
    if !s.ok {
        return Err(Erreur::Git(s.message()));
    }
    let mut champs = s.stdout.split(|&o| o == 0).filter(|c| !c.is_empty());
    let mut changements = Vec::new();
    while let Some(c) = champs.next() {
        if c.len() < 4 {
            continue;
        }
        let (x, y) = (c[0], c[1]);
        if x == b'R' || x == b'C' || y == b'R' || y == b'C' {
            champs.next(); // ancien nom
        }
        let (statut, indexe) = statut_de(x, y);
        let chemin = String::from_utf8_lossy(&c[3..]).into_owned();
        let Some(chemin) = chemin.strip_prefix(&prefixe) else {
            continue;
        };
        changements.push(Changement {
            chemin: chemin.to_string(),
            statut,
            indexe,
        });
    }
    let (branche, detachee) = branche_courante(d);
    let mut branches = liste_branches(d);
    if !detachee && !branche.is_empty() && !branches.contains(&branche) {
        branches.push(branche.clone());
    }
    Ok(Etat {
        branche,
        detachee,
        branches,
        changements,
    })
}

pub fn diff(d: &Path, chemin: &str) -> Result<Diff, Erreur> {
    verifier_depot(d)?;
    verifier_chemin(chemin)?;
    let suivi = court(d, &["ls-files", "--error-unmatch", "--", chemin], true)?.ok;
    let indexe = !court(d, &["diff", "--cached", "--quiet", "--", chemin], true)?.ok;
    let a_head = court(d, &["rev-parse", "--verify", "-q", "HEAD"], true)?.ok;
    let sur_disque = d.join(chemin).symlink_metadata().is_ok();
    let no_index = !suivi && sur_disque;
    let args: Vec<&str> = if no_index {
        vec!["diff", "--no-index", "--", "/dev/null", chemin]
    } else if a_head {
        vec!["diff", "HEAD", "--", chemin]
    } else if indexe {
        vec!["diff", "--cached", "--", chemin]
    } else {
        vec!["diff", "--", chemin]
    };
    let s = lancer(d, &args, true, MAX_DIFF, Some(DELAI_COURT))?;
    // `--no-index` sort avec 1 quand il y a une différence.
    if !s.ok && !(no_index && s.code == Some(1)) {
        return Err(Erreur::Git(s.message()));
    }
    let texte = String::from_utf8_lossy(&s.stdout).into_owned();
    let trop_gros = s.stdout.len() >= MAX_DIFF;
    let binaire = !trop_gros
        && texte
            .lines()
            .any(|l| l.starts_with("Binary files ") && l.ends_with(" differ"));
    Ok(Diff {
        binaire,
        trop_gros,
        texte: if binaire || trop_gros {
            String::new()
        } else {
            texte
        },
    })
}

pub fn indexer(d: &Path, chemin: &str) -> Result<(), Erreur> {
    verifier_depot(d)?;
    verifier_chemin(chemin)?;
    reussi(d, &["add", "--", chemin]).map(|_| ())
}

pub fn commit(d: &Path, message: &str) -> Result<(), Erreur> {
    verifier_depot(d)?;
    if court(d, &["diff", "--cached", "--quiet"], true)?.ok {
        return Err(Erreur::AucunIndexe);
    }
    if message.trim().is_empty() {
        return Err(Erreur::MessageVide);
    }
    reussi(d, &["commit", "-m", message]).map(|_| ())
}

pub fn changer_branche(d: &Path, nom: &str) -> Result<(), Erreur> {
    verifier_depot(d)?;
    if !liste_branches(d).iter().any(|b| b == nom) {
        return Err(Erreur::Invalide("Cette branche n'existe pas.".into()));
    }
    reussi(d, &["switch", nom]).map(|_| ())
}

/// `pull` ou `push` : 120 s au plus, rien n'est demandé à l'écran.
pub fn synchroniser(d: &Path, commande: &str) -> Result<String, Erreur> {
    verifier_depot(d)?;
    let s = lancer(d, &[commande], false, 64 << 20, Some(DELAI_RESEAU))?;
    if s.ok {
        Ok(s.message())
    } else {
        Err(Erreur::Git(s.message()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lancer_arrete_la_commande_au_bout_du_delai() {
        let d = std::env::temp_dir();
        let debut = Instant::now();
        let r = lancer(
            &d,
            &["-c", "alias.lent=!sleep 30", "lent"],
            true,
            1024,
            Some(Duration::from_millis(200)),
        );
        assert!(matches!(r, Err(Erreur::Git(_))));
        assert!(debut.elapsed() < Duration::from_secs(5));
    }
}
