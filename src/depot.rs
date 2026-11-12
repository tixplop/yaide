use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Parmi `chemins` (relatifs à `dossier`), ceux que git ignore.
/// Hors d'un dépôt git, rien n'est ignoré.
pub fn ignores(dossier: &Path, chemins: &[String]) -> HashSet<String> {
    if chemins.is_empty() || !est_un_depot(dossier) {
        return HashSet::new();
    }
    let Ok(mut enfant) = Command::new("git")
        .arg("-C")
        .arg(dossier)
        .args(["check-ignore", "-z", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return HashSet::new();
    };
    let mut entree = enfant.stdin.take().unwrap();
    let donnees: Vec<u8> = chemins
        .iter()
        .flat_map(|c| c.bytes().chain(std::iter::once(0)))
        .collect();
    // Écriture à part : git peut répondre avant d'avoir tout lu.
    let fil = std::thread::spawn(move || {
        let _ = entree.write_all(&donnees);
    });
    let sortie = enfant.wait_with_output();
    let _ = fil.join();
    let Ok(sortie) = sortie else {
        return HashSet::new();
    };
    sortie
        .stdout
        .split(|&o| o == 0)
        .filter(|c| !c.is_empty())
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect()
}

pub fn est_un_depot(dossier: &Path) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(dossier)
        .args(["rev-parse", "--is-inside-work-tree"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

pub struct Worktree {
    /// Chemin relatif depuis le projet (`""` pour le projet lui-même).
    pub chemin: String,
    /// Nom du dossier racine du worktree.
    pub nom: String,
    pub branche: String,
    pub detachee: bool,
    /// Dossier du projet à l'intérieur de ce worktree (canonique).
    pub dossier: PathBuf,
    /// Dossier racine du worktree (canonique).
    pub racine: PathBuf,
    /// Chemin de la racine depuis le projet (`""` pour le projet lui-même).
    pub racine_rel: String,
}

/// Chemin relatif de `vers` depuis `depuis` (deux chemins absolus canoniques).
fn chemin_relatif(depuis: &Path, vers: &Path) -> String {
    let a: Vec<_> = depuis.components().collect();
    let b: Vec<_> = vers.components().collect();
    let commun = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let mut parts: Vec<String> = vec!["..".to_string(); a.len() - commun];
    parts.extend(
        b[commun..]
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().into_owned()),
    );
    parts.join("/")
}

/// Les worktrees du dépôt du projet : le projet d'abord, puis les autres par nom.
/// Hors dépôt, la liste est vide.
pub fn worktrees(projet: &Path) -> Vec<Worktree> {
    let Ok(projet) = projet.canonicalize() else {
        return Vec::new();
    };
    let git = |args: &[&str]| {
        Command::new("git")
            .arg("-C")
            .arg(&projet)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|s| s.status.success())
            .map(|s| String::from_utf8_lossy(&s.stdout).into_owned())
    };
    let Some(prefixe) = git(&["rev-parse", "--show-prefix"]) else {
        return Vec::new();
    };
    let prefixe = prefixe.trim();
    let Some(liste) = git(&["worktree", "list", "--porcelain"]) else {
        return Vec::new();
    };
    let mut resultat = Vec::new();
    for bloc in liste.split("\n\n") {
        let (mut racine, mut branche, mut detachee, mut ecarte) =
            (None, String::new(), false, false);
        for ligne in bloc.lines() {
            if let Some(r) = ligne.strip_prefix("worktree ") {
                racine = Some(PathBuf::from(r));
            } else if let Some(b) = ligne.strip_prefix("branch ") {
                branche = b.strip_prefix("refs/heads/").unwrap_or(b).to_string();
            } else if ligne == "detached" {
                detachee = true;
            } else if ligne == "bare" || ligne.starts_with("prunable") {
                ecarte = true;
            }
        }
        let Some(racine) = racine.filter(|_| !ecarte) else {
            continue;
        };
        let Ok(dossier) = racine.join(prefixe).canonicalize() else {
            continue;
        };
        let Ok(racine) = racine.canonicalize() else {
            continue;
        };
        let nom = racine
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        resultat.push(Worktree {
            chemin: chemin_relatif(&projet, &dossier),
            nom,
            branche,
            detachee,
            dossier,
            racine_rel: chemin_relatif(&projet, &racine),
            racine,
        });
    }
    resultat.sort_by(|a, b| (!a.chemin.is_empty(), &a.nom).cmp(&(!b.chemin.is_empty(), &b.nom)));
    resultat
}
