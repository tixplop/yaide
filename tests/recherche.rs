use std::io::Write;
use std::path::PathBuf;
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
    corps: String,
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
    fn chercher(&self, q: &str) -> Rep {
        let origine = format!("https://127.0.0.1:{}", self.port);
        let chemin = format!("/api/recherche?q={}", enc(q));
        requete(self.port, "GET", &chemin, &self.cookie, &origine, b"")
    }
    fn chemins(&self, cookie: &str) -> Rep {
        let origine = format!("https://127.0.0.1:{}", self.port);
        requete(self.port, "GET", "/api/chemins", cookie, &origine, b"")
    }
    fn ecrire(&self, c: &str, contenu: &[u8]) {
        let f = self.projet.join(c);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, contenu).unwrap();
    }
    fn git_init(&self) {
        let s = Command::new("git")
            .arg("-C")
            .arg(&self.projet)
            .args(["init", "-q"])
            .env("HOME", &self.racine)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CEILING_DIRECTORIES", &self.racine)
            .status()
            .unwrap();
        assert!(s.success());
    }
}

fn lancer(nom: &str) -> Serveur {
    let d = std::env::temp_dir().join(format!("rech-{nom}-{}", std::process::id()));
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
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let mut s = Serveur {
        child,
        port,
        cookie: String::new(),
        projet,
        racine: d.clone(),
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

fn compte(r: &Rep) -> usize {
    r.corps.matches("\"chemin\":").count()
}

#[test]
fn req026_ac1_fn_main_donne_fichiers_et_lignes() {
    let s = lancer("ac1");
    s.ecrire("src/main.rs", b"// debut\nfn main() {\n}\n");
    s.ecrire("autre.txt", b"rien\n");
    let r = s.chercher("fn main");
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(
        r.corps.contains(
            "{\"chemin\":\"src/main.rs\",\"ligne\":2,\"texte\":\"fn main() {\",\"debut\":0,\"fin\":7}"
        ),
        "{}",
        r.corps
    );
    assert_eq!(compte(&r), 1, "{}", r.corps);
    assert!(r.corps.contains("\"limite\":false"), "{}", r.corps);
}

#[test]
fn req026_texte_tel_quel_sans_tenir_compte_de_la_casse() {
    let s = lancer("casse");
    s.ecrire("a.txt", b"x FN Main(a.*)\nautre\n");
    let r = s.chercher("fn main(a.*)");
    assert!(
        r.corps
            .contains("\"ligne\":1,\"texte\":\"x FN Main(a.*)\",\"debut\":2,\"fin\":14"),
        "{}",
        r.corps
    );
    assert_eq!(compte(&s.chercher("fn.*")), 0);
}

#[test]
fn req026_texte_vide_refuse() {
    let s = lancer("vide");
    assert_eq!(s.chercher("").code, 400);
}

#[test]
fn req026_ac3_fichier_ignore_par_git_absent() {
    let s = lancer("ac3");
    s.git_init();
    s.ecrire(".gitignore", b"secret.txt\ncible/\n");
    s.ecrire("secret.txt", b"fn main\n");
    s.ecrire("cible/x.rs", b"fn main\n");
    s.ecrire("visible.rs", b"fn main\n");
    s.ecrire(".git/info/note", b"fn main\n");
    let r = s.chercher("fn main");
    assert!(r.corps.contains("visible.rs"), "{}", r.corps);
    assert_eq!(compte(&r), 1, "{}", r.corps);
}

#[test]
fn req026_ac3_hors_git_seules_les_regles_git_comptent() {
    let s = lancer("horsgit");
    s.ecrire(".gitignore", b"secret.txt\n");
    s.ecrire(".ignore", b"autre.txt\n");
    s.ecrire("secret.txt", b"fn main\n");
    s.ecrire("autre.txt", b"fn main\n");
    let r = s.chercher("fn main");
    assert_eq!(compte(&r), 2, "{}", r.corps);
}

#[test]
fn req026_ac4_texte_absent_donne_une_liste_vide() {
    let s = lancer("ac4");
    s.ecrire("a.txt", b"bonjour\n");
    let r = s.chercher("fn mian");
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(r.corps, "{\"resultats\":[],\"limite\":false}");
}

#[test]
fn req026_ac5_plus_de_500_resultats_gardent_500_et_le_disent() {
    let s = lancer("ac5");
    s.ecrire("a.txt", "trouve\n".repeat(501).as_bytes());
    let r = s.chercher("trouve");
    assert_eq!(compte(&r), 500);
    assert!(r.corps.contains("\"limite\":true"), "{}", r.corps);
}

#[test]
fn req026_ac5_exactement_500_resultats_sans_message() {
    let s = lancer("ac5b");
    s.ecrire("a.txt", "trouve\n".repeat(500).as_bytes());
    let r = s.chercher("trouve");
    assert_eq!(compte(&r), 500);
    assert!(r.corps.contains("\"limite\":false"), "{}", r.corps);
}

#[test]
fn req026_binaires_et_fichiers_de_plus_de_5_mo_sautes() {
    let s = lancer("saut");
    s.ecrire("bin.dat", b"fn main\0\n");
    let mut gros = b"fn main\n".to_vec();
    gros.resize(5 * 1024 * 1024 + 1, b' ');
    s.ecrire("gros.txt", &gros);
    let mut limite = b"fn main\n".to_vec();
    limite.resize(5 * 1024 * 1024, b' ');
    s.ecrire("limite.txt", &limite);
    let r = s.chercher("fn main");
    assert!(r.corps.contains("limite.txt"), "{}", r.corps);
    assert_eq!(compte(&r), 1, "{}", r.corps);
}

#[test]
fn req026_ligne_longue_coupee_autour_du_texte_trouve() {
    let s = lancer("longue");
    let ligne = format!("{}CIBLE{}\n", "a".repeat(1000), "b".repeat(1000));
    s.ecrire("a.txt", ligne.as_bytes());
    let r = s.chercher("cible");
    assert!(r.corps.contains("\"debut\":40,\"fin\":45"), "{}", r.corps);
    assert!(r.corps.len() < 600, "{}", r.corps.len());
}

#[test]
fn req027_ac1_ac2_liste_des_chemins_du_projet() {
    let s = lancer("chemins");
    s.ecrire("src/main.rs", b"x");
    s.ecrire("README.md", b"x");
    let r = s.chemins(&s.cookie);
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(r.corps, "{\"chemins\":[\"README.md\",\"src/main.rs\"]}");
}

#[test]
fn req027_ac4_fichier_ignore_par_git_absent() {
    let s = lancer("chemins-ignore");
    s.git_init();
    s.ecrire(".gitignore", b"secret.txt\ncible/\n");
    s.ecrire("secret.txt", b"x");
    s.ecrire("cible/x.rs", b"x");
    s.ecrire("visible.rs", b"x");
    s.ecrire(".git/info/note", b"x");
    let r = s.chemins(&s.cookie);
    assert!(r.corps.contains("visible.rs"), "{}", r.corps);
    assert!(!r.corps.contains("secret.txt"), "{}", r.corps);
    assert!(!r.corps.contains("cible"), "{}", r.corps);
    assert!(!r.corps.contains(".git/"), "{}", r.corps);
}

#[test]
fn req027_chemins_exige_une_session() {
    let s = lancer("chemins-session");
    assert_eq!(s.chemins("").code, 401);
}
