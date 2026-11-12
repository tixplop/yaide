use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

const EXE: &str = env!("CARGO_BIN_EXE_yaide");

struct Serveur {
    child: Child,
    port: u16,
    cookie: String,
    projet: PathBuf,
    racine: PathBuf,
}

impl Drop for Serveur {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Rep {
    code: u16,
    entetes: String,
    corps: Vec<u8>,
}

impl Rep {
    fn entete(&self, nom: &str) -> Option<String> {
        let p = format!("{}:", nom.to_lowercase());
        self.entetes
            .lines()
            .find(|l| l.to_lowercase().starts_with(&p))
            .map(|l| l[p.len()..].trim().to_string())
    }
}

fn port_libre() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Requête HTTPS directe ; `cookie` vide = aucun cookie, aucune `Origin`.
fn requete(port: u16, methode: &str, chemin: &str, cookie: &str, corps: &[u8]) -> Rep {
    let mut cmd = Command::new("curl");
    cmd.args([
        "-sk",
        "-i",
        "--path-as-is",
        "--max-time",
        "20",
        "-X",
        methode,
    ])
    .arg(format!("https://127.0.0.1:{port}{chemin}"))
    .stdin(Stdio::piped())
    .stdout(Stdio::piped());
    if !cookie.is_empty() {
        cmd.args(["-H", &format!("Cookie: {cookie}")]);
        cmd.args(["-H", &format!("Origin: https://127.0.0.1:{port}")]);
    }
    if methode != "GET" {
        cmd.args(["--data-binary", "@-"]);
    }
    let mut enfant = cmd.spawn().unwrap();
    let mut stdin = enfant.stdin.take().unwrap();
    let donnees = corps.to_vec();
    let fil = std::thread::spawn(move || {
        let _ = stdin.write_all(&donnees);
    });
    let sortie = enfant.wait_with_output().unwrap().stdout;
    fil.join().unwrap();
    // Serveur pas encore prêt : réponse vide, code 0.
    let Some(coupe) = sortie.windows(4).position(|w| w == b"\r\n\r\n") else {
        return Rep {
            code: 0,
            entetes: String::new(),
            corps: Vec::new(),
        };
    };
    let entetes = String::from_utf8_lossy(&sortie[..coupe]).into_owned();
    let code = entetes
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    Rep {
        code,
        entetes,
        corps: sortie[coupe + 4..].to_vec(),
    }
}

fn git(dossier: &Path, racine: &Path, args: &[&str]) {
    let s = Command::new("git")
        .arg("-C")
        .arg(dossier)
        .args(args)
        .env("HOME", racine)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CEILING_DIRECTORIES", racine)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(s.status.success(), "git {args:?}");
}

/// Serveur sur `<d>/depot`, avec un worktree `<d>/essai` ; `<d>/hors` est hors du projet.
fn lancer(nom: &str) -> Serveur {
    let d = std::env::temp_dir().join(format!("apercu-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    let d = d.canonicalize().unwrap();
    let cfg = d.join("cfg");
    let mut c = Command::new(EXE)
        .arg("passwd")
        .env("XDG_CONFIG_HOME", &cfg)
        .env("HOME", &d)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    c.stdin.take().unwrap().write_all(b"mdp\n").unwrap();
    assert!(c.wait().unwrap().success());
    std::fs::write(
        d.join(".gitconfig"),
        "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n",
    )
    .unwrap();
    let projet = d.join("depot");
    std::fs::create_dir_all(projet.join("docs")).unwrap();
    std::fs::write(d.join("hors.txt"), "secret").unwrap();
    std::fs::write(projet.join("index.html"), "<!DOCTYPE html><h1>Accueil</h1>").unwrap();
    std::fs::write(projet.join("docs/index.html"), "<p>docs</p>").unwrap();
    std::fs::write(projet.join("style.css"), "h1{color:red}").unwrap();
    std::fs::write(projet.join("app.js"), "console.log(1)").unwrap();
    std::fs::write(projet.join("lib.mjs"), "export default 1").unwrap();
    std::fs::write(projet.join("donnees.json"), "{\"a\":1}").unwrap();
    std::fs::write(projet.join("logo.png"), PNG).unwrap();
    std::fs::write(
        projet.join("logo.svg"),
        "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
    )
    .unwrap();
    std::fs::write(
        projet.join("police.woff2"),
        [0x77, 0x4f, 0x46, 0x32, 0xff, 0x00],
    )
    .unwrap();
    std::os::unix::fs::symlink(d.join("hors.txt"), projet.join("lien.txt")).unwrap();
    git(&projet, &d, &["init", "-q"]);
    git(&projet, &d, &["add", "."]);
    git(&projet, &d, &["commit", "-q", "-m", "premier"]);
    git(
        &projet,
        &d,
        &["worktree", "add", "-q", "../essai", "-b", "essai"],
    );
    std::fs::write(d.join("essai/style.css"), "h1{color:blue}").unwrap();
    let port = port_libre();
    let child = Command::new(EXE)
        .arg(&projet)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", &cfg)
        .env("HOME", &d)
        .env("GIT_CEILING_DIRECTORIES", &d)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let mut s = Serveur {
        child,
        port,
        cookie: String::new(),
        projet,
        racine: d,
    };
    for _ in 0..1000 {
        if requete(port, "GET", "/api/info", "", b"").code == 200 {
            let r = requete(port, "POST", "/api/connexion", "x=y", b"mdp");
            s.cookie = r
                .entete("set-cookie")
                .expect("pas de Set-Cookie")
                .split(';')
                .next()
                .unwrap()
                .to_string();
            return s;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("le serveur ne répond pas");
}

const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80,
];

fn jeton(s: &Serveur) -> String {
    let r = requete(s.port, "GET", "/api/apercu", &s.cookie, b"");
    assert_eq!(r.code, 200);
    let t = String::from_utf8(r.corps).unwrap();
    t.split('"').nth(3).expect("jeton").to_string()
}

#[test]
fn req058_ac17_jeton_protege_et_different_a_chaque_lancement() {
    let a = lancer("jeton-a");
    let b = lancer("jeton-b");
    assert_eq!(requete(a.port, "GET", "/api/apercu", "", b"").code, 401);
    let (ja, jb) = (jeton(&a), jeton(&b));
    assert_eq!(ja.len(), 64);
    assert!(ja.bytes().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(ja, jb);
}

#[test]
fn req058_ac17_fichiers_servis_sans_cookie_avec_type_et_en_tetes() {
    let s = lancer("fichiers");
    let j = jeton(&s);
    let cas: [(&str, &str); 9] = [
        ("index.html", "text/html; charset=utf-8"),
        ("style.css", "text/css; charset=utf-8"),
        ("app.js", "text/javascript; charset=utf-8"),
        ("lib.mjs", "text/javascript; charset=utf-8"),
        ("donnees.json", "application/json"),
        ("logo.png", "image/png"),
        ("logo.svg", "image/svg+xml"),
        ("police.woff2", "font/woff2"),
        ("docs/", "text/html; charset=utf-8"),
    ];
    for (chemin, genre) in cas {
        let r = requete(s.port, "GET", &format!("/apercu/{j}/{chemin}"), "", b"");
        assert_eq!(r.code, 200, "{chemin}");
        assert_eq!(r.entete("content-type").as_deref(), Some(genre), "{chemin}");
        assert_eq!(
            r.entete("content-security-policy").as_deref(),
            Some("sandbox allow-scripts allow-forms")
        );
        assert_eq!(r.entete("cache-control").as_deref(), Some("no-store"));
        assert_eq!(
            r.entete("access-control-allow-origin").as_deref(),
            Some("*")
        );
        if !genre.starts_with("text/html") {
            let sur_disque = std::fs::read(s.projet.join(chemin)).unwrap();
            assert_eq!(r.corps, sur_disque, "{chemin}");
        }
    }
    // Page HTML : contenu d'origine plus le script de défilement, après le doctype.
    let r = requete(s.port, "GET", &format!("/apercu/{j}/"), "", b"");
    let t = String::from_utf8(r.corps).unwrap();
    assert!(t.starts_with("<!DOCTYPE html><script>"));
    assert!(t.ends_with("</script><h1>Accueil</h1>"));
    let r = requete(s.port, "GET", &format!("/apercu/{j}/docs"), "", b"");
    assert!(String::from_utf8(r.corps).unwrap().ends_with("<p>docs</p>"));
}

#[test]
fn req058_ac17_fichier_d_un_worktree() {
    let s = lancer("worktree");
    let j = jeton(&s);
    let r = requete(
        s.port,
        "GET",
        &format!("/apercu/{j}/%2E%2E/essai/style.css"),
        "",
        b"",
    );
    assert_eq!(r.code, 200);
    assert_eq!(r.corps, b"h1{color:blue}");
    let r = requete(s.port, "GET", &format!("/apercu/{j}/style.css"), "", b"");
    assert_eq!(r.corps, b"h1{color:red}");
}

#[test]
fn req058_ac17_refus_404_et_405() {
    let s = lancer("refus");
    let j = jeton(&s);
    let faux = "0".repeat(64);
    let _ = std::fs::remove_file(s.projet.join("docs/index.html"));
    let sans_index = std::fs::create_dir(s.projet.join("vide")).is_ok();
    assert!(sans_index);
    let chemins = [
        format!("/apercu/{faux}/index.html"),
        format!("/apercu/{j}x/index.html"),
        "/apercu/".to_string(),
        "/apercu//index.html".to_string(),
        format!("/apercu/{j}/absent.html"),
        format!("/apercu/{j}/%2E%2E/hors.txt"),
        format!("/apercu/{j}/%2e%2e/%2e%2e/hors.txt"),
        format!("/apercu/{j}/..%2Fhors.txt"),
        format!("/apercu/{j}/lien.txt"),
        format!("/apercu/{j}/docs/"),
        format!("/apercu/{j}/vide/"),
    ];
    for c in &chemins {
        let r = requete(s.port, "GET", c, "", b"");
        assert_eq!(r.code, 404, "{c}");
        assert_ne!(r.corps, b"secret", "{c}");
    }
    let r = requete(
        s.port,
        "POST",
        &format!("/apercu/{j}/index.html"),
        &s.cookie,
        b"x",
    );
    assert_eq!(r.code, 405);
    let _ = &s.racine;
}
