//! Presse-papiers de Windows rempli par le serveur quand Yaide tourne dans WSL (REQ-181).
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Échec de la copie : `raison` est montrée telle quelle, `detail` est la sortie d'erreur.
#[derive(Debug)]
pub struct Erreur {
    pub raison: &'static str,
    pub detail: String,
}

fn dans_le_path(nom: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|p| {
        std::env::split_paths(&p).any(|d| {
            std::fs::metadata(d.join(nom)).is_ok_and(|m| {
                use std::os::unix::fs::PermissionsExt;
                m.is_file() && m.permissions().mode() & 0o111 != 0
            })
        })
    })
}

/// Vrai si `powershell.exe` et `wslpath` sont dans le `PATH` (lu à chaque appel).
pub fn disponible() -> bool {
    dans_le_path("powershell.exe") && dans_le_path("wslpath")
}

fn chemin_windows(wslpath: &str, chemin: &Path) -> Result<String, Erreur> {
    let sortie = Command::new(wslpath)
        .arg("-w")
        .arg(chemin)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| Erreur {
            raison: "Le chemin n'a pas pu être converti",
            detail: e.to_string(),
        })?;
    let texte = String::from_utf8_lossy(&sortie.stdout);
    let texte = texte.strip_suffix('\n').unwrap_or(&texte);
    if !sortie.status.success() || texte.is_empty() {
        return Err(Erreur {
            raison: "Le chemin n'a pas pu être converti",
            detail: String::from_utf8_lossy(&sortie.stderr).into_owned(),
        });
    }
    Ok(texte.to_string())
}

/// Met les chemins (absolus, dans l'ordre donné) dans le presse-papiers de Windows.
/// Les chemins passent par des variables d'environnement, jamais par le texte de la commande.
pub fn copier(chemins: &[PathBuf], delai: Duration) -> Result<(), Erreur> {
    copier_avec("wslpath", "powershell.exe", chemins, delai)
}

fn copier_avec(
    wslpath: &str,
    powershell: &str,
    chemins: &[PathBuf],
    delai: Duration,
) -> Result<(), Erreur> {
    let windows = chemins
        .iter()
        .map(|c| chemin_windows(wslpath, c))
        .collect::<Result<Vec<_>, _>>()?;
    let noms: Vec<String> = (0..windows.len()).map(|i| format!("YAIDE_P{i}")).collect();
    let liste = noms
        .iter()
        .map(|n| format!("$env:{n}"))
        .collect::<Vec<_>>()
        .join(", ");
    let mut wslenv = std::env::var("WSLENV").unwrap_or_default();
    wslenv.truncate(wslenv.trim_end_matches(':').len());
    for n in &noms {
        if !wslenv.is_empty() {
            wslenv.push(':');
        }
        wslenv.push_str(n);
    }
    let mut cmd = Command::new(powershell);
    cmd.args(["-NoProfile", "-NonInteractive", "-Command"])
        .arg(format!("Set-Clipboard -LiteralPath {liste}"))
        .env("WSLENV", wslenv)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    for (n, w) in noms.iter().zip(&windows) {
        cmd.env(n, w);
    }
    let mut enfant = cmd.spawn().map_err(|e| Erreur {
        raison: "PowerShell a échoué",
        detail: e.to_string(),
    })?;
    let mut stderr = enfant.stderr.take().expect("stderr redirigé");
    let lecture = std::thread::spawn(move || {
        let mut o = Vec::new();
        let _ = stderr.read_to_end(&mut o);
        String::from_utf8_lossy(&o).into_owned()
    });
    let debut = Instant::now();
    let statut = loop {
        match enfant.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if debut.elapsed() >= delai => {
                let _ = enfant.kill();
                let _ = enfant.wait();
                return Err(Erreur {
                    raison: "Windows n'a pas répondu",
                    detail: String::new(),
                });
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                return Err(Erreur {
                    raison: "PowerShell a échoué",
                    detail: e.to_string(),
                })
            }
        }
    };
    let detail = lecture.join().unwrap_or_default();
    if statut.success() {
        Ok(())
    } else {
        Err(Erreur {
            raison: "PowerShell a échoué",
            detail: detail.trim_end().to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn faux(nom: &str, script: &str) -> (PathBuf, String) {
        let d = PathBuf::from(std::env::var("TMPDIR").unwrap_or("/tmp".into()))
            .join(format!("windows-{nom}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let wsl = d.join("wslpath");
        std::fs::write(
            &wsl,
            "#!/bin/sh\n[ \"$1\" = -w ] || exit 1\nprintf 'W:%s\\n' \"$2\"\n",
        )
        .unwrap();
        let ps = d.join("powershell.exe");
        std::fs::write(&ps, format!("#!/bin/sh\n{script}\n")).unwrap();
        for f in [&wsl, &ps] {
            std::fs::set_permissions(f, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        (wsl, ps.to_str().unwrap().to_string())
    }

    #[test]
    fn req181_ac6_delai_depasse_processus_tue() {
        let (wsl, ps) = faux("lent", "echo $$ > \"$(dirname \"$0\")/pid\"; exec sleep 5");
        let pid_fichier = PathBuf::from(&ps).with_file_name("pid");
        let t = Instant::now();
        let e = copier_avec(
            wsl.to_str().unwrap(),
            &ps,
            &[PathBuf::from("/a")],
            Duration::from_millis(200),
        )
        .unwrap_err();
        assert_eq!(e.raison, "Windows n'a pas répondu");
        assert!(t.elapsed() < Duration::from_secs(3));
        let pid = std::fs::read_to_string(pid_fichier).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            !Path::new("/proc").join(pid.trim()).exists(),
            "le processus doit être tué"
        );
    }

    #[test]
    fn req181_ac6_code_non_nul_detail_stderr() {
        let (wsl, ps) = faux("echec", "echo 'Accès refusé' >&2; exit 1");
        let e = copier_avec(
            wsl.to_str().unwrap(),
            &ps,
            &[PathBuf::from("/a")],
            Duration::from_secs(5),
        )
        .unwrap_err();
        assert_eq!(e.raison, "PowerShell a échoué");
        assert_eq!(e.detail, "Accès refusé");
    }

    #[test]
    fn req181_ac6_reussite() {
        let (wsl, ps) = faux("ok", "exit 0");
        copier_avec(
            wsl.to_str().unwrap(),
            &ps,
            &[PathBuf::from("/a")],
            Duration::from_secs(5),
        )
        .unwrap();
    }
}
