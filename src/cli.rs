use std::io::{BufRead, IsTerminal, Write};
use std::path::PathBuf;

pub const PORT_PAR_DEFAUT: u16 = 8443;

#[derive(Debug, PartialEq)]
pub enum Commande {
    Aide(&'static str),
    Passwd,
    Update,
    Servir { dossier: PathBuf, port: u16 },
}

pub const AIDE_GLOBALE: &str = "Usages :
  yaide <dossier> [--port <n>]  sert le dossier en HTTPS (port 8443 par défaut)
  yaide passwd                  définit le mot de passe
  yaide update                  installe la dernière release
Aide d'une action : yaide <action> --help
";

pub const AIDE_PASSWD: &str = "Usage : yaide passwd
Définit le mot de passe de Yaide. Il est demandé deux fois, sans s'afficher ;
sans terminal, il est lu une fois sur l'entrée standard.
Seul un haché est écrit, dans $XDG_CONFIG_HOME/yaide/ (sinon ~/.config/yaide/).
";

pub const AIDE_UPDATE: &str = "Usage : yaide update
Installe la dernière release à la place du binaire lancé, après vérification
de son empreinte SHA-256.
Il faut curl ou wget, tar et sha256sum.
";

pub fn analyser(args: &[String]) -> Result<Commande, String> {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        return Ok(Commande::Aide(match args.first().map(String::as_str) {
            Some("passwd") => AIDE_PASSWD,
            Some("update") => AIDE_UPDATE,
            _ => AIDE_GLOBALE,
        }));
    }
    if args.first().map(String::as_str) == Some("passwd") {
        return Ok(Commande::Passwd);
    }
    if args.first().map(String::as_str) == Some("update") {
        if let Some(extra) = args.get(1) {
            return Err(format!(
                "argument inattendu : {extra} ; usage : yaide update"
            ));
        }
        return Ok(Commande::Update);
    }
    let mut port = PORT_PAR_DEFAUT;
    let mut dossier = None;
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--port" {
            port = args
                .get(i + 1)
                .and_then(|v| v.parse::<u16>().ok())
                .ok_or("--port attend un numéro de port entre 0 et 65535")?;
            i += 2;
        } else if dossier.is_none() {
            dossier = Some(PathBuf::from(&args[i]));
            i += 1;
        } else {
            return Err(format!("argument inattendu : {}", args[i]));
        }
    }
    let dossier = dossier
        .ok_or("usage : yaide <dossier> [--port <n>]  ou  yaide passwd  ou  yaide update")?;
    Ok(Commande::Servir { dossier, port })
}

/// Deux saisies identiques et non vides, sinon un message.
pub fn valider_saisies(a: &str, b: &str) -> Result<String, String> {
    if a.is_empty() {
        return Err("le mot de passe ne peut pas être vide".into());
    }
    if a != b {
        return Err("les deux saisies sont différentes".into());
    }
    Ok(a.to_string())
}

fn ligne(invite: Option<&str>) -> Result<String, String> {
    if let Some(i) = invite {
        eprint!("{i}");
        let _ = std::io::stderr().flush();
    }
    let mut s = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut s)
        .map_err(|e| format!("lecture impossible : {e}"))?;
    Ok(s.trim_end_matches(['\n', '\r']).to_string())
}

fn echo(actif: bool) {
    let _ = std::process::Command::new("stty")
        .arg(if actif { "echo" } else { "-echo" })
        .status();
}

/// Lit le mot de passe : deux fois sans affichage au terminal, une fois sur l'entrée sinon.
pub fn lire_mot_de_passe() -> Result<String, String> {
    if !std::io::stdin().is_terminal() {
        let mdp = ligne(None)?;
        return valider_saisies(&mdp, &mdp);
    }
    echo(false);
    let a = ligne(Some("Mot de passe : "));
    eprintln!();
    let b = ligne(Some("Encore une fois : "));
    eprintln!();
    echo(true);
    valider_saisies(&a?, &b?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn req001_ac4_saisies_differentes_ou_vides_refusees() {
        assert!(valider_saisies("a", "b")
            .unwrap_err()
            .contains("différentes"));
        assert!(valider_saisies("", "").unwrap_err().contains("vide"));
        assert_eq!(valider_saisies("a", "a").unwrap(), "a");
    }

    #[test]
    fn req002_ac1_port_par_defaut_et_option() {
        assert_eq!(
            analyser(&v(&["d"])).unwrap(),
            Commande::Servir {
                dossier: "d".into(),
                port: 8443
            }
        );
        assert_eq!(
            analyser(&v(&["--port", "9000", "d"])).unwrap(),
            Commande::Servir {
                dossier: "d".into(),
                port: 9000
            }
        );
    }

    #[test]
    fn req060_ac4_update_sans_argument() {
        assert_eq!(analyser(&v(&["update"])).unwrap(), Commande::Update);
        let e = analyser(&v(&["update", "x"])).unwrap_err();
        assert!(e.contains("usage : yaide update"));
        assert!(analyser(&v(&["update", "--port", "1"])).is_err());
        assert!(matches!(
            analyser(&v(&["./update"])).unwrap(),
            Commande::Servir { .. }
        ));
    }

    #[test]
    fn req082_ac1_aide_globale() {
        for a in ["--help", "-h"] {
            assert_eq!(analyser(&v(&[a])).unwrap(), Commande::Aide(AIDE_GLOBALE));
        }
        for t in [
            "yaide <dossier> [--port <n>]",
            "yaide passwd",
            "yaide update",
            "8443",
            "Aide d'une action : yaide <action> --help",
        ] {
            assert!(AIDE_GLOBALE.contains(t), "{t}");
        }
    }

    #[test]
    fn req082_ac2_help_avec_dossier_ou_port() {
        for a in [
            v(&["d", "--help"]),
            v(&["--port", "9000", "--help"]),
            v(&["--help", "d"]),
            v(&["d", "-h"]),
        ] {
            assert_eq!(analyser(&a).unwrap(), Commande::Aide(AIDE_GLOBALE));
        }
        assert!(matches!(
            analyser(&v(&["./--help"])).unwrap(),
            Commande::Servir { .. }
        ));
    }

    #[test]
    fn req082_ac3_aide_passwd() {
        for a in [v(&["passwd", "--help"]), v(&["passwd", "x", "-h"])] {
            assert_eq!(analyser(&a).unwrap(), Commande::Aide(AIDE_PASSWD));
        }
        assert!(AIDE_PASSWD.starts_with("Usage : yaide passwd"));
        assert!(AIDE_PASSWD.contains("deux fois"));
        assert!(AIDE_PASSWD.contains("entrée standard"));
        assert!(AIDE_PASSWD.contains("$XDG_CONFIG_HOME/yaide/"));
        assert!(AIDE_PASSWD.contains("~/.config/yaide/"));
    }

    #[test]
    fn req082_ac4_aide_update() {
        for a in [v(&["update", "--help"]), v(&["update", "-h"])] {
            assert_eq!(analyser(&a).unwrap(), Commande::Aide(AIDE_UPDATE));
        }
        assert!(AIDE_UPDATE.starts_with("Usage : yaide update"));
        assert!(AIDE_UPDATE.contains("SHA-256"));
        assert!(AIDE_UPDATE.contains("curl ou wget, tar et sha256sum"));
    }

    #[test]
    fn req002_dossier_obligatoire() {
        assert!(analyser(&v(&[])).unwrap_err().contains("usage"));
    }
}
