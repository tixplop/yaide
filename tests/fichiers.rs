use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

const EXE: &str = env!("CARGO_BIN_EXE_yaide");

struct Serveur {
    child: Child,
    port: u16,
    cookie: String,
    projet: PathBuf,
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
    corps: String,
}

impl Rep {
    fn version(&self) -> String {
        self.entetes
            .lines()
            .find_map(|l| {
                l.to_lowercase()
                    .strip_prefix("x-version:")
                    .map(|v| v.trim().to_string())
            })
            .unwrap_or_else(|| panic!("pas de X-Version : {}", self.entetes))
    }
}

fn port_libre() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn requete(
    port: u16,
    methode: &str,
    chemin: &str,
    cookie: &str,
    origine: &str,
    corps: &[u8],
) -> Rep {
    let mut cmd = Command::new("curl");
    cmd.args(["-sk", "-i", "--max-time", "20", "-X", methode])
        .arg(format!("https://127.0.0.1:{port}{chemin}"))
        .args(["-H", &format!("Origin: {origine}")])
        .args(["--data-binary", "@-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    if !cookie.is_empty() {
        cmd.args(["-H", &format!("Cookie: {cookie}")]);
    }
    let mut enfant = cmd.spawn().unwrap();
    let mut stdin = enfant.stdin.take().unwrap();
    let donnees = corps.to_vec();
    let fil = std::thread::spawn(move || {
        let _ = stdin.write_all(&donnees);
    });
    let sortie = enfant.wait_with_output().unwrap();
    fil.join().unwrap();
    let texte = String::from_utf8_lossy(&sortie.stdout).into_owned();
    let code = texte
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    let (entetes, corps) = texte
        .split_once("\r\n\r\n")
        .map_or((String::new(), String::new()), |(e, c)| {
            (e.to_string(), c.to_string())
        });
    Rep {
        code,
        entetes,
        corps,
    }
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'/' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

impl Serveur {
    fn appel(&self, methode: &str, chemin: &str, corps: &[u8]) -> Rep {
        let origine = format!("https://127.0.0.1:{}", self.port);
        requete(self.port, methode, chemin, &self.cookie, &origine, corps)
    }
    fn lire(&self, c: &str) -> Rep {
        self.appel("GET", &format!("/api/fichier?chemin={}", enc(c)), b"")
    }
    fn ecrire(&self, c: &str, version: Option<&str>, corps: &[u8]) -> Rep {
        let v = version.map_or(String::new(), |v| format!("&version={}", enc(v)));
        self.appel("PUT", &format!("/api/fichier?chemin={}{v}", enc(c)), corps)
    }
    fn lister(&self, c: &str) -> Rep {
        self.appel("GET", &format!("/api/fichiers?chemin={}", enc(c)), b"")
    }
    fn creer(&self, c: &str, type_: &str) -> Rep {
        self.appel(
            "POST",
            &format!("/api/fichiers/creer?chemin={}&type={type_}", enc(c)),
            b"",
        )
    }
    fn renommer(&self, de: &str, vers: &str) -> Rep {
        self.appel(
            "POST",
            &format!("/api/fichiers/renommer?de={}&vers={}", enc(de), enc(vers)),
            b"",
        )
    }
    fn supprimer(&self, c: &str) -> Rep {
        self.appel("DELETE", &format!("/api/fichier?chemin={}", enc(c)), b"")
    }
    fn versions(&self, chemins: &[&str]) -> Rep {
        self.appel(
            "POST",
            "/api/fichiers/versions",
            chemins.join("\n").as_bytes(),
        )
    }
    fn ecrire_disque(&self, c: &str, contenu: &[u8]) {
        let p = self.projet.join(c);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, contenu).unwrap();
    }
}

fn lancer(nom: &str) -> Serveur {
    let d = std::env::temp_dir().join(format!("fichiers-{nom}-{}", std::process::id()));
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
    let projet = d.join("projet");
    std::fs::create_dir_all(&projet).unwrap();
    let port = port_libre();
    let child = Command::new(EXE)
        .arg(&projet)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", &cfg)
        .env("HOME", &d)
        .env("GIT_CEILING_DIRECTORIES", &d)
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let mut s = Serveur {
        child,
        port,
        cookie: String::new(),
        projet,
    };
    let origine = format!("https://127.0.0.1:{port}");
    for _ in 0..100 {
        if requete(port, "GET", "/api/info", "", &origine, b"").code == 200 {
            let r = requete(port, "POST", "/api/connexion", "", &origine, b"mdp");
            let ligne = r
                .entetes
                .lines()
                .find(|l| l.to_lowercase().starts_with("set-cookie:"))
                .expect("pas de Set-Cookie");
            s.cookie = ligne[11..].trim().split(';').next().unwrap().to_string();
            return s;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("le serveur ne répond pas");
}

fn git(dossier: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .arg("-C")
        .arg(dossier)
        .args(args)
        .output()
        .unwrap()
        .status
        .success();
    assert!(ok, "git {args:?}");
}

fn noms(r: &Rep) -> Vec<String> {
    r.corps
        .split("\"nom\":\"")
        .skip(1)
        .map(|s| s.split('"').next().unwrap().to_string())
        .collect()
}

#[test]
fn req006_ac1_sans_session_401() {
    let s = lancer("ac6-1");
    s.ecrire_disque("a.txt", b"a");
    let origine = format!("https://127.0.0.1:{}", s.port);
    for (m, c) in [
        ("GET", "/api/fichiers?chemin="),
        ("GET", "/api/fichier?chemin=a.txt"),
        ("PUT", "/api/fichier?chemin=a.txt"),
        ("DELETE", "/api/fichier?chemin=a.txt"),
        ("POST", "/api/fichiers/creer?chemin=b&type=fichier"),
        ("POST", "/api/fichiers/renommer?de=a.txt&vers=b.txt"),
        ("POST", "/api/fichiers/versions"),
    ] {
        let r = requete(s.port, m, c, "", &origine, b"x");
        assert_eq!(r.code, 401, "{m} {c}");
    }
    assert_eq!(std::fs::read(s.projet.join("a.txt")).unwrap(), b"a");
    assert!(!s.projet.join("b").exists() && !s.projet.join("b.txt").exists());
}

#[test]
fn req006_ac2_origine_etrangere_403() {
    let s = lancer("ac6-2");
    s.ecrire_disque("a.txt", b"a");
    for (m, c) in [
        ("PUT", "/api/fichier?chemin=a.txt"),
        ("DELETE", "/api/fichier?chemin=a.txt"),
        ("POST", "/api/fichiers/creer?chemin=b&type=fichier"),
        ("POST", "/api/fichiers/renommer?de=a.txt&vers=b.txt"),
    ] {
        let r = requete(s.port, m, c, &s.cookie, "https://autre.example", b"x");
        assert_eq!(r.code, 403, "{m} {c}");
    }
    assert_eq!(std::fs::read(s.projet.join("a.txt")).unwrap(), b"a");
}

#[test]
fn req006_ac3_chemins_hors_projet_refuses() {
    let s = lancer("ac6-3");
    let hors = s.projet.parent().unwrap().join("hors.txt");
    std::fs::write(&hors, "secret").unwrap();
    s.ecrire_disque("a.txt", b"a");
    std::os::unix::fs::symlink(&hors, s.projet.join("lien.txt")).unwrap();
    let absolu = hors.to_str().unwrap().to_string();
    for c in ["../hors.txt", "a/../../hors.txt", "/etc/passwd", &absolu] {
        assert_eq!(s.lire(c).code, 403, "lire {c}");
        assert_eq!(s.ecrire(c, None, b"pwn").code, 403, "écrire {c}");
        assert_eq!(s.supprimer(c).code, 403, "supprimer {c}");
        assert_eq!(s.creer(c, "fichier").code, 403, "créer {c}");
        assert_eq!(s.renommer(c, "x.txt").code, 403, "renommer de {c}");
        assert_eq!(s.renommer("a.txt", c).code, 403, "renommer vers {c}");
        assert_eq!(s.versions(&[c]).code, 403, "versions {c}");
    }
    // Un lien vers l'extérieur ne se lit ni ne s'écrit ; supprimer ou renommer n'agit que sur le lien.
    assert_eq!(s.lire("lien.txt").code, 403);
    assert_eq!(s.ecrire("lien.txt", None, b"pwn").code, 403);
    assert_eq!(s.versions(&["lien.txt"]).code, 403);
    assert_eq!(s.creer("lien.txt", "fichier").code, 403);
    assert_eq!(s.renommer("a.txt", "lien.txt").code, 403);
    assert_eq!(s.lister("..").code, 403);
    assert_eq!(s.lister("/").code, 403);
    assert_eq!(std::fs::read_to_string(&hors).unwrap(), "secret");
    assert!(s.projet.join("a.txt").exists());
    assert!(!s.projet.join("x.txt").exists());
    assert!(s.projet.join("a.txt").exists());

    // Renommer le lien : seul le lien bouge.
    assert_eq!(s.renommer("lien.txt", "lien2.txt").code, 204);
    assert!(std::fs::symlink_metadata(s.projet.join("lien2.txt")).is_ok());
    assert!(std::fs::symlink_metadata(s.projet.join("lien.txt")).is_err());
    assert_eq!(std::fs::read_to_string(&hors).unwrap(), "secret");
    // Supprimer le lien : le lien disparaît, la cible reste.
    assert_eq!(s.supprimer("lien2.txt").code, 204);
    assert!(std::fs::symlink_metadata(s.projet.join("lien2.txt")).is_err());
    assert_eq!(std::fs::read_to_string(&hors).unwrap(), "secret");

    // Un dossier parent lié vers l'extérieur : rien ne passe par lui.
    let ext = s.projet.parent().unwrap().join("ext");
    std::fs::create_dir_all(&ext).unwrap();
    std::fs::write(ext.join("f"), "ext").unwrap();
    std::os::unix::fs::symlink(&ext, s.projet.join("lienext")).unwrap();
    assert_eq!(s.supprimer("lienext/f").code, 403);
    assert_eq!(s.renommer("lienext/f", "g").code, 403);
    assert_eq!(std::fs::read_to_string(ext.join("f")).unwrap(), "ext");
}

#[test]
fn req007_ac1_ac3_liste_tri_et_git_cache() {
    let s = lancer("ac7-1");
    for f in ["b.txt", "A.txt", "zeta/x", "Alpha/x", ".cache", ".git/HEAD"] {
        s.ecrire_disque(f, b"x");
    }
    let r = s.lister("");
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(noms(&r), ["Alpha", "zeta", ".cache", "A.txt", "b.txt"]);
    assert!(r.corps.contains("\"nom\":\"zeta\",\"dossier\":true"));
    assert_eq!(noms(&s.lister("zeta")), ["x"]);
}

#[test]
fn req007_ac2_dossier_ignore_et_contenu_marques() {
    let s = lancer("ac7-2");
    git(&s.projet, &["init", "-q"]);
    s.ecrire_disque(".gitignore", b"target/\n");
    s.ecrire_disque("target/debug/x", b"x");
    s.ecrire_disque("src/main.rs", b"fn main() {}");
    let r = s.lister("");
    assert!(
        r.corps
            .contains("\"nom\":\"target\",\"dossier\":true,\"ignore\":true"),
        "{}",
        r.corps
    );
    assert!(
        r.corps
            .contains("\"nom\":\"src\",\"dossier\":true,\"ignore\":false"),
        "{}",
        r.corps
    );
    let r = s.lister("target");
    assert!(
        r.corps
            .contains("\"nom\":\"debug\",\"dossier\":true,\"ignore\":true"),
        "{}",
        r.corps
    );
    let r = s.lister("target/debug");
    assert!(
        r.corps
            .contains("\"nom\":\"x\",\"dossier\":false,\"ignore\":true"),
        "{}",
        r.corps
    );
}

#[test]
fn req007_ac4_hors_git_rien_de_grise() {
    let s = lancer("ac7-4");
    s.ecrire_disque(".gitignore", b"target/\n");
    s.ecrire_disque("target/x", b"x");
    let r = s.lister("");
    assert_eq!(r.code, 200);
    assert!(!r.corps.contains("\"ignore\":true"), "{}", r.corps);
    assert!(!s.lister("target").corps.contains("\"ignore\":true"));
}

#[test]
fn req008_ac1_lire_un_fichier() {
    let s = lancer("ac8-1");
    s.ecrire_disque("src/main.rs", "fn main() {} // é".as_bytes());
    let r = s.lire("src/main.rs");
    assert_eq!(r.code, 200);
    assert_eq!(r.corps, "fn main() {} // é");
    assert!(!r.version().is_empty());
    assert_eq!(s.lire("absent.txt").code, 404);
    assert_eq!(s.lire("src").code, 400);
}

#[test]
fn req008_ac3_binaire_et_non_utf8_causes_distinctes() {
    let s = lancer("ac8-3");
    s.ecrire_disque("notes.bin", &[b'a', 0, b'b']);
    s.ecrire_disque("latin.txt", &[b'c', b'a', b'f', 0xe9]);
    let a = s.lire("notes.bin");
    let b = s.lire("latin.txt");
    assert_eq!(a.code, 415);
    assert_eq!(b.code, 415);
    assert!(a.corps.contains("\"cause\":\"binaire\""), "{}", a.corps);
    assert!(b.corps.contains("\"cause\":\"non-utf8\""), "{}", b.corps);
}

#[test]
fn req008_ac4_limite_5_mo() {
    let s = lancer("ac8-4");
    let mo5 = 5 * 1024 * 1024;
    s.ecrire_disque("pile.log", &vec![b'a'; mo5]);
    s.ecrire_disque("gros.log", &vec![b'a'; mo5 + 1]);
    let r = s.lire("pile.log");
    assert_eq!(r.code, 200);
    assert_eq!(r.corps.len(), mo5);
    let g = s.lire("gros.log");
    assert_eq!(g.code, 413);
    assert!(g.corps.contains("\"cause\":\"trop-gros\""), "{}", g.corps);
}

#[test]
fn req009_ac1_creer_fichier_et_dossier() {
    let s = lancer("ac9-1");
    assert_eq!(s.creer("neuf.txt", "fichier").code, 201);
    assert_eq!(s.creer("rep/sous", "dossier").code, 201);
    assert_eq!(s.creer("rep/f.txt", "fichier").code, 201);
    assert_eq!(std::fs::read(s.projet.join("neuf.txt")).unwrap(), b"");
    assert!(s.projet.join("rep/sous").is_dir());
    assert!(s.projet.join("rep/f.txt").is_file());
    assert!(noms(&s.lister("")).contains(&"neuf.txt".to_string()));
    assert_eq!(s.creer("x", "autre").code, 400);
}

#[test]
fn req009_ac2_ac3_renommer_et_deplacer() {
    let s = lancer("ac9-2");
    s.ecrire_disque("a.txt", b"contenu");
    s.ecrire_disque("src/y.rs", b"y");
    assert_eq!(s.renommer("a.txt", "b.txt").code, 204);
    assert!(!s.projet.join("a.txt").exists());
    assert_eq!(std::fs::read(s.projet.join("b.txt")).unwrap(), b"contenu");
    assert_eq!(s.renommer("b.txt", "src/a.txt").code, 204);
    assert_eq!(
        std::fs::read(s.projet.join("src/a.txt")).unwrap(),
        b"contenu"
    );
    assert_eq!(s.renommer("src", "lib").code, 204);
    assert!(s.projet.join("lib/y.rs").exists() && !s.projet.join("src").exists());
    assert_eq!(s.renommer("absent", "z").code, 404);
    assert_eq!(s.renommer("lib", "lib/dedans").code, 400);
    assert!(s.projet.join("lib/y.rs").exists());
}

#[test]
fn req009_ac4_nom_deja_pris() {
    let s = lancer("ac9-4");
    s.ecrire_disque("a.txt", b"A");
    s.ecrire_disque("b.txt", b"B");
    let r = s.creer("a.txt", "fichier");
    assert_eq!(r.code, 409);
    assert!(r.corps.contains("\"cause\":\"existe\""), "{}", r.corps);
    assert_eq!(s.creer("a.txt", "dossier").code, 409);
    assert_eq!(s.renommer("a.txt", "b.txt").code, 409);
    assert_eq!(std::fs::read(s.projet.join("a.txt")).unwrap(), b"A");
    assert_eq!(std::fs::read(s.projet.join("b.txt")).unwrap(), b"B");
}

#[test]
fn req010_ac1_supprimer_fichier_et_dossier() {
    let s = lancer("ac10-1");
    s.ecrire_disque("notes.txt", b"n");
    s.ecrire_disque("src/a/b.rs", b"b");
    assert_eq!(s.supprimer("notes.txt").code, 204);
    assert!(!s.projet.join("notes.txt").exists());
    assert_eq!(s.supprimer("src").code, 204);
    assert!(!s.projet.join("src").exists());
    assert_eq!(s.supprimer("notes.txt").code, 404);
    assert_eq!(s.supprimer("").code, 400);
    assert_eq!(s.supprimer(".").code, 400);
    assert!(s.projet.is_dir());
}

#[test]
fn req013_ac1_ecrire_avec_version_de_base() {
    let s = lancer("ac13-1");
    s.ecrire_disque("main.rs", b"v1");
    let v1 = s.lire("main.rs").version();
    let r = s.ecrire("main.rs", Some(&v1), b"v2 \xc3\xa9");
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(
        std::fs::read(s.projet.join("main.rs")).unwrap(),
        "v2 é".as_bytes()
    );
    let v2 = r.version();
    assert_eq!(v2, s.lire("main.rs").version());
    // Écrire avec la version à jour réussit encore.
    assert_eq!(s.ecrire("main.rs", Some(&v2), b"v3").code, 200);
    // Aucun fichier temporaire ne reste.
    let restes: Vec<_> = std::fs::read_dir(&s.projet).unwrap().collect();
    assert_eq!(restes.len(), 1);
}

#[test]
fn req013_ac1_conflit_412_sans_ecriture() {
    let s = lancer("ac13-412");
    s.ecrire_disque("main.rs", b"v1");
    let v1 = s.lire("main.rs").version();
    s.ecrire_disque("main.rs", "changé ailleurs".as_bytes());
    let r = s.ecrire("main.rs", Some(&v1), b"mien");
    assert_eq!(r.code, 412);
    assert!(r.corps.contains("\"cause\":\"conflit\""), "{}", r.corps);
    assert_eq!(
        std::fs::read(s.projet.join("main.rs")).unwrap(),
        "changé ailleurs".as_bytes()
    );
    // Sans version de base : écrase (choix « garder ma version »).
    assert_eq!(s.ecrire("main.rs", None, b"mien").code, 200);
    assert_eq!(std::fs::read(s.projet.join("main.rs")).unwrap(), b"mien");
}

#[test]
fn req013_ac1_droits_gardes_et_fichier_recree() {
    let s = lancer("ac13-droits");
    s.ecrire_disque("run.sh", b"#!/bin/sh");
    std::fs::set_permissions(
        s.projet.join("run.sh"),
        std::fs::Permissions::from_mode(0o750),
    )
    .unwrap();
    assert_eq!(s.ecrire("run.sh", None, b"#!/bin/sh\necho").code, 200);
    let mode = std::fs::metadata(s.projet.join("run.sh"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o750);
    // Fichier supprimé hors de Yaide : l'écriture le recrée, dossiers compris.
    assert_eq!(s.ecrire("neuf/f.txt", Some("1-1"), b"texte").code, 200);
    assert_eq!(
        std::fs::read(s.projet.join("neuf/f.txt")).unwrap(),
        b"texte"
    );
}

#[test]
fn req013_ac3_ecriture_impossible_message() {
    let s = lancer("ac13-3");
    s.ecrire_disque("ro.txt", b"intact");
    std::fs::set_permissions(
        s.projet.join("ro.txt"),
        std::fs::Permissions::from_mode(0o444),
    )
    .unwrap();
    s.ecrire_disque("rep/f.txt", b"intact");
    let r = s.ecrire("ro.txt", None, b"autre");
    // Root passe outre les droits : le test ne vaut que pour un utilisateur ordinaire.
    if unsafe { libc::geteuid() } != 0 {
        assert_eq!(r.code, 403, "{}", r.corps);
        assert!(r.corps.contains("\"cause\":\"droits\""), "{}", r.corps);
        assert!(r.corps.contains("\"message\":\""), "{}", r.corps);
        assert_eq!(std::fs::read(s.projet.join("ro.txt")).unwrap(), b"intact");
    }
    assert_eq!(s.ecrire("rep", None, b"x").code, 400);
}

#[test]
fn req017_ac1_etat_des_versions() {
    let s = lancer("ac17-1");
    s.ecrire_disque("a.txt", b"a");
    s.ecrire_disque("b.txt", b"b");
    let va = s.lire("a.txt").version();
    let r = s.versions(&["a.txt", "b.txt", "absent.txt"]);
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(
        r.corps.contains(&format!("\"a.txt\":\"{va}\"")),
        "{}",
        r.corps
    );
    assert!(r.corps.contains("\"b.txt\":\""), "{}", r.corps);
    assert!(r.corps.contains("\"absent.txt\":null"), "{}", r.corps);
    s.ecrire_disque("a.txt", b"plus long");
    let r = s.versions(&["a.txt"]);
    assert!(!r.corps.contains(&va), "{}", r.corps);
    assert_eq!(s.versions(&[]).corps, "{}");
}

#[test]
fn req006_ac3_supprimer_un_lien_garde_la_cible() {
    let s = lancer("lien-suppr");
    s.ecrire_disque("vrai/f.txt", b"f");
    std::os::unix::fs::symlink("vrai", s.projet.join("lienrep")).unwrap();
    assert_eq!(s.supprimer("lienrep").code, 204);
    assert!(std::fs::symlink_metadata(s.projet.join("lienrep")).is_err());
    assert_eq!(std::fs::read(s.projet.join("vrai/f.txt")).unwrap(), b"f");
}

#[test]
fn req009_ac2_renommer_un_lien_garde_la_cible() {
    let s = lancer("lien-renom");
    s.ecrire_disque("vrai/f.txt", b"f");
    std::os::unix::fs::symlink("vrai", s.projet.join("lienrep")).unwrap();
    assert_eq!(s.renommer("lienrep", "autre").code, 204);
    assert!(std::fs::symlink_metadata(s.projet.join("autre"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(std::fs::symlink_metadata(s.projet.join("lienrep")).is_err());
    assert_eq!(std::fs::read(s.projet.join("vrai/f.txt")).unwrap(), b"f");
}

#[test]
fn req013_ac1_ecriture_par_temporaire_puis_renommage() {
    use std::os::unix::fs::MetadataExt;
    let s = lancer("ac13-inode");
    s.ecrire_disque("a.txt", b"v1");
    let avant = std::fs::metadata(s.projet.join("a.txt")).unwrap().ino();
    assert_eq!(s.ecrire("a.txt", None, b"v2").code, 200);
    let apres = std::fs::metadata(s.projet.join("a.txt")).unwrap().ino();
    assert_ne!(avant, apres);
}

#[test]
fn req013_ac1_ecriture_de_plus_de_5_mo() {
    let s = lancer("ac13-gros");
    let gros = vec![b'x'; 6 * 1024 * 1024];
    assert_eq!(s.ecrire("gros.txt", None, &gros).code, 200);
    assert_eq!(std::fs::read(s.projet.join("gros.txt")).unwrap(), gros);
}

#[test]
fn req013_ac1_ecritures_simultanees() {
    let s = lancer("ac13-simul");
    s.ecrire_disque("a.txt", b"v0");
    let codes: Vec<u16> = std::thread::scope(|sc| {
        let fils: Vec<_> = (0..12)
            .map(|i| {
                let s = &s;
                sc.spawn(move || s.ecrire("a.txt", None, format!("v{i}").as_bytes()).code)
            })
            .collect();
        fils.into_iter().map(|f| f.join().unwrap()).collect()
    });
    assert_eq!(codes, vec![200; 12]);
    let restes = std::fs::read_dir(&s.projet).unwrap().count();
    assert_eq!(restes, 1);
}
