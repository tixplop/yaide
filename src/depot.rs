use std::collections::HashSet;
use std::io::Write;
use std::path::Path;
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
