use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

const EXE: &str = env!("CARGO_BIN_EXE_yaide");

struct Serveur {
    child: Child,
    port: u16,
}

impl Drop for Serveur {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn port_libre() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn dossier(nom: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("lancement-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn passwd(cfg: &Path, entree: &str) -> std::process::Output {
    let mut c = Command::new(EXE)
        .arg("passwd")
        .env("XDG_CONFIG_HOME", cfg)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    std::io::Write::write_all(&mut c.stdin.take().unwrap(), entree.as_bytes()).unwrap();
    c.wait_with_output().unwrap()
}

fn curl(args: &[&str]) -> Option<String> {
    let out = Command::new("curl")
        .args(["-sk", "--max-time", "3"])
        .args(args)
        .output()
        .unwrap();
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn lancer_sur(cfg: &Path, dossier: &Path, port: u16) -> Serveur {
    let child = Command::new(EXE)
        .arg(dossier)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", cfg)
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let s = Serveur { child, port };
    for _ in 0..1000 {
        if curl(&[&format!("https://127.0.0.1:{port}/")]).is_some() {
            return s;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("le serveur ne répond pas");
}

fn prete(nom: &str) -> (PathBuf, PathBuf) {
    let d = dossier(nom);
    let cfg = d.join("cfg");
    assert!(passwd(&cfg, "mdp\n").status.success());
    (d, cfg)
}

#[test]
fn req001_ac1_passwd_ecrit_un_fichier_hache_en_600() {
    use std::os::unix::fs::PermissionsExt;
    let d = dossier("p1");
    let cfg = d.join("cfg");
    assert!(passwd(&cfg, "clair-secret\n").status.success());
    let f = cfg.join("yaide/mot-de-passe");
    let t = std::fs::read_to_string(&f).unwrap();
    assert!(!t.contains("clair-secret"));
    assert_eq!(
        std::fs::metadata(&f).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn req001_ac2_deux_instances_meme_configuration() {
    let (d, cfg) = prete("p2");
    let a = lancer_sur(&cfg, &d, port_libre());
    let b = lancer_sur(&cfg, &d, port_libre());
    assert_ne!(a.port, b.port);
}

#[test]
fn req001_ac3_nouveau_passwd_remplace_le_fichier_sans_arreter_l_instance() {
    let (d, cfg) = prete("p3");
    let s = lancer_sur(&cfg, &d, port_libre());
    let f = cfg.join("yaide/mot-de-passe");
    let avant = std::fs::read_to_string(&f).unwrap();
    assert!(passwd(&cfg, "nouveau\n").status.success());
    assert_ne!(avant, std::fs::read_to_string(&f).unwrap());
    assert!(curl(&[&format!("https://127.0.0.1:{}/", s.port)]).is_some());
}

#[test]
fn req001_ac4_mot_de_passe_vide_refuse_et_ancien_conserve() {
    let (_, cfg) = prete("p4");
    let f = cfg.join("yaide/mot-de-passe");
    let avant = std::fs::read_to_string(&f).unwrap();
    let out = passwd(&cfg, "\n");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("vide"));
    assert_eq!(avant, std::fs::read_to_string(&f).unwrap());
}

#[test]
fn req002_ac1_port_par_defaut_8443() {
    if std::net::TcpListener::bind("0.0.0.0:8443").is_err() {
        eprintln!("8443 occupé, test ignoré");
        return;
    }
    let (d, cfg) = prete("d1");
    let child = Command::new(EXE)
        .arg(&d)
        .env("XDG_CONFIG_HOME", &cfg)
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let _s = Serveur { child, port: 8443 };
    let mut ok = false;
    for _ in 0..100 {
        if curl(&["https://127.0.0.1:8443/"]).is_some() {
            ok = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(ok);
}

#[test]
fn req002_ac1_option_port() {
    let (d, cfg) = prete("d2");
    let p = port_libre();
    let _s = lancer_sur(&cfg, &d, p);
    assert!(curl(&[&format!("https://127.0.0.1:{p}/")])
        .unwrap()
        .contains("<title>yaide</title>"));
}

#[test]
fn req002_ac2_deux_instances_deux_dossiers() {
    let (d, cfg) = prete("d3");
    let (d1, d2) = (d.join("un"), d.join("deux"));
    std::fs::create_dir_all(&d1).unwrap();
    std::fs::create_dir_all(&d2).unwrap();
    let a = lancer_sur(&cfg, &d1, port_libre());
    let b = lancer_sur(&cfg, &d2, port_libre());
    assert_ne!(a.port, b.port);
    assert!(curl(&[&format!("https://127.0.0.1:{}/", a.port)]).is_some());
    assert!(curl(&[&format!("https://127.0.0.1:{}/", b.port)]).is_some());
}

#[test]
fn req002_ac3_sans_mot_de_passe_refus() {
    let d = dossier("d4");
    let out = Command::new(EXE)
        .arg(&d)
        .args(["--port", &port_libre().to_string()])
        .env("XDG_CONFIG_HOME", d.join("cfg"))
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("yaide passwd"));
}

#[test]
fn req002_ac4_port_occupe_refus() {
    let (d, cfg) = prete("d5");
    let occupe = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
    let p = occupe.local_addr().unwrap().port();
    let out = Command::new(EXE)
        .arg(&d)
        .args(["--port", &p.to_string()])
        .env("XDG_CONFIG_HOME", &cfg)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    let e = String::from_utf8_lossy(&out.stderr);
    assert!(e.contains(&p.to_string()) && e.contains("--port"), "{e}");
}

#[test]
fn req002_ac5_dossier_absent_ou_inexistant() {
    let (d, cfg) = prete("d6");
    let fichier = d.join("fichier");
    std::fs::write(&fichier, "x").unwrap();
    for arg in [Some(d.join("nexiste-pas")), Some(fichier), None] {
        let mut c = Command::new(EXE);
        if let Some(a) = &arg {
            c.arg(a);
        }
        let out = c
            .args(["--port", &port_libre().to_string()])
            .env("XDG_CONFIG_HOME", &cfg)
            .output()
            .unwrap();
        assert!(!out.status.success());
        let e = String::from_utf8_lossy(&out.stderr);
        if arg.is_some() {
            assert!(e.contains("absent") && e.contains("dossier"), "{e}");
        } else {
            assert!(e.contains("usage"), "{e}");
        }
    }
}

#[test]
fn req003_ac1_ac2_certificat_cree_puis_reutilise() {
    use std::os::unix::fs::PermissionsExt;
    let (d, cfg) = prete("t1");
    let cle = cfg.join("yaide/cle.pem");
    let cert = cfg.join("yaide/certificat.pem");
    assert!(!cert.exists());
    let p = port_libre();
    let s = lancer_sur(&cfg, &d, p);
    assert_eq!(
        std::fs::metadata(&cle).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let premier = std::fs::read(&cert).unwrap();
    let out = Command::new("sh")
        .arg("-c")
        .arg(format!(
            "echo | timeout 5 openssl s_client -connect 127.0.0.1:{p} 2>/dev/null | openssl x509 -noout -subject -issuer -enddate"
        ))
        .output()
        .unwrap();
    let t = String::from_utf8_lossy(&out.stdout).into_owned();
    let champ = |n: &str| {
        t.lines()
            .find(|l| l.starts_with(n))
            .unwrap_or_else(|| panic!("{t}"))
            .split_once('=')
            .unwrap()
            .1
            .trim()
            .to_string()
    };
    assert_eq!(champ("subject"), champ("issuer"), "{t}");
    drop(s);
    let _s2 = lancer_sur(&cfg, &d, port_libre());
    assert_eq!(premier, std::fs::read(&cert).unwrap());
}

#[test]
fn req003_ac3_http_simple_n_obtient_aucune_page() {
    let (d, cfg) = prete("t2");
    let s = lancer_sur(&cfg, &d, port_libre());
    let r = curl(&[&format!("http://127.0.0.1:{}/", s.port)]).unwrap_or_default();
    assert!(!r.contains("Yaide") && !r.contains("<html"), "{r}");
}

#[test]
fn req001_ac4_deux_saisies_differentes_sous_terminal_refusees() {
    let (_, cfg) = prete("p5");
    let f = cfg.join("yaide/mot-de-passe");
    let avant = std::fs::read_to_string(&f).unwrap();
    let mut c = Command::new("script")
        .args(["-qec", &format!("{EXE} passwd"), "/dev/null"])
        .env("XDG_CONFIG_HOME", &cfg)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    std::io::Write::write_all(&mut c.stdin.take().unwrap(), b"premier\nsecond\n").unwrap();
    let out = c.wait_with_output().unwrap();
    let texte = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(1), "{texte}");
    assert!(texte.contains("Encore une fois"), "{texte}");
    assert!(texte.contains("différentes"), "{texte}");
    assert_eq!(avant, std::fs::read_to_string(&f).unwrap());
}

#[test]
fn req002_ac6_affiche_une_adresse_qui_s_ouvre() {
    use std::io::Read;
    let (d, cfg) = prete("d6");
    let p = port_libre();
    let mut child = Command::new(EXE)
        .arg(&d)
        .args(["--port", &p.to_string()])
        .env("XDG_CONFIG_HOME", &cfg)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut sortie = child.stdout.take().unwrap();
    let mut ok = false;
    for _ in 0..100 {
        if curl(&[&format!("https://localhost:{p}/")]).is_some() {
            ok = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
    let mut texte = String::new();
    sortie.read_to_string(&mut texte).unwrap();
    assert!(ok, "localhost ne répond pas");
    assert!(texte.contains(&format!("https://localhost:{p}")), "{texte}");
    assert!(
        texte.contains(&format!(
            "Yaide écoute sur le port {p}, sur toutes les adresses de la machine."
        )),
        "{texte}"
    );
    assert!(
        texte.contains(&format!("https://<adresse de la machine>:{p}")),
        "{texte}"
    );
    assert!(!texte.contains("0.0.0.0"), "{texte}");
}
