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
    fn appel(&self, methode: &str, chemin: &str, corps: &[u8]) -> Rep {
        let origine = format!("https://127.0.0.1:{}", self.port);
        requete(self.port, methode, chemin, &self.cookie, &origine, corps)
    }
    /// git dans `dossier`, avec le HOME du test ; renvoie stdout.
    fn g(&self, dossier: &Path, args: &[&str]) -> String {
        let s = Command::new("git")
            .arg("-C")
            .arg(dossier)
            .args(args)
            .env("HOME", &self.racine)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CEILING_DIRECTORIES", &self.racine)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(
            s.status.success(),
            "git {args:?} : {}",
            String::from_utf8_lossy(&s.stderr)
        );
        String::from_utf8_lossy(&s.stdout).into_owned()
    }
    fn lire(&self, c: &str) -> Rep {
        self.appel("GET", &format!("/api/fichier?chemin={}", enc(c)), b"")
    }
    fn put(&self, c: &str, contenu: &str) -> Rep {
        self.appel(
            "PUT",
            &format!("/api/fichier?chemin={}", enc(c)),
            contenu.as_bytes(),
        )
    }
    fn etat(&self, w: &str) -> Rep {
        self.appel("GET", &format!("/api/git/etat?worktree={}", enc(w)), b"")
    }
}

/// Serveur sur `<d>/<sous>` ; dépôt initialisé à `<d>/depot` (ou `<d>/projet` sans `sous`),
/// un fichier `main.rs` validé, puis `git worktree add ../essai -b essai` ;
/// un dossier `autre/` à côté, qui n'est pas un worktree.
fn lancer(nom: &str, sous: Option<&str>) -> Serveur {
    let d = std::env::temp_dir().join(format!("wt-{nom}-{}", std::process::id()));
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
    let depot = d.join(if sous.is_some() { "depot" } else { "projet" });
    let projet = sous.map_or(depot.clone(), |s| depot.join(s));
    std::fs::create_dir_all(&projet).unwrap();
    std::fs::create_dir_all(d.join("autre")).unwrap();
    std::fs::write(d.join("autre/x"), "secret\n").unwrap();
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
        projet: projet.clone(),
        racine: d.clone(),
    };
    s.g(&depot, &["init", "-q"]);
    std::fs::write(projet.join("main.rs"), "fn main() {}\n").unwrap();
    s.g(&depot, &["add", "."]);
    s.g(&depot, &["commit", "-q", "-m", "premier"]);
    s.g(
        &depot,
        &["worktree", "add", "-q", "../essai", "-b", "essai"],
    );
    let origine = format!("https://127.0.0.1:{port}");
    for _ in 0..1000 {
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
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("le serveur ne répond pas");
}

#[test]
fn req006_ac3_chemins_hors_worktree_refuses() {
    let s = lancer("ac3", None);
    // `../autre` n'est pas un worktree : refus en lecture et en écriture.
    assert_eq!(s.lire("../autre/x").code, 403);
    assert_eq!(s.put("../autre/x", "pirate").code, 403);
    assert_eq!(
        std::fs::read_to_string(s.racine.join("autre/x")).unwrap(),
        "secret\n"
    );
    // Sortir de `essai` par `..` est refusé.
    assert_eq!(s.lire("../essai/../autre/x").code, 403);
    assert_eq!(s.put("../essai/../autre/x", "pirate").code, 403);
    // Un lien de `essai` vers l'extérieur est refusé.
    std::os::unix::fs::symlink(s.racine.join("autre"), s.racine.join("essai/lien")).unwrap();
    assert_eq!(s.lire("../essai/lien/x").code, 403);
    assert_eq!(s.put("../essai/lien/x", "pirate").code, 403);
    // Le worktree lui-même est lisible.
    assert_eq!(s.lire("../essai/main.rs").code, 200);
    // Renommer d'un worktree à l'autre est refusé.
    let r = s.appel(
        "POST",
        "/api/fichiers/renommer?de=main.rs&vers=../essai/copie.rs",
        b"",
    );
    assert_eq!(r.code, 403, "{}", r.corps);
}

#[test]
fn req086_ac1_liste_des_worktrees() {
    let s = lancer("ac1", None);
    let r = s.etat("");
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(
        r.corps.contains(
            "\"worktrees\":[{\"chemin\":\"\",\"nom\":\"projet\",\"branche\":\"main\",\"detachee\":false,\"racine\":\"\"},{\"chemin\":\"../essai\",\"nom\":\"essai\",\"branche\":\"essai\",\"detachee\":false,\"racine\":\"../essai\"}]"
        ),
        "{}",
        r.corps
    );
    // Même liste quel que soit le worktree demandé.
    let r2 = s.etat("../essai");
    assert_eq!(r2.code, 200, "{}", r2.corps);
    assert!(r2
        .corps
        .contains("\"branche\":\"essai\",\"detachee\":false,\"branches\""));
    assert!(r2.corps.contains("\"worktrees\":[{\"chemin\":\"\""));
}

#[test]
fn req086_ac4_ecriture_dans_le_worktree() {
    let s = lancer("ac4", None);
    let r = s.put("../essai/main.rs", "fn essai() {}\n");
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(
        std::fs::read_to_string(s.racine.join("essai/main.rs")).unwrap(),
        "fn essai() {}\n"
    );
    assert_eq!(
        std::fs::read_to_string(s.projet.join("main.rs")).unwrap(),
        "fn main() {}\n"
    );
    let l = s.lire("../essai/main.rs");
    assert_eq!(l.corps, "fn essai() {}\n");
    let v = s.appel(
        "POST",
        "/api/fichiers/versions",
        b"../essai/main.rs\nmain.rs\n",
    );
    assert_eq!(v.code, 200, "{}", v.corps);
    assert!(v.corps.contains("\"../essai/main.rs\":\"") && v.corps.contains("\"main.rs\":\""));
    // Liste d'un dossier du worktree, y compris à la racine.
    let l = s.appel("GET", "/api/fichiers?chemin=../essai", b"");
    assert!(l.corps.contains("\"nom\":\"main.rs\""), "{}", l.corps);
}

#[test]
fn req086_ac5_commit_sur_la_branche_du_worktree() {
    let s = lancer("ac5", None);
    let avant = s.g(&s.projet, &["rev-parse", "main"]);
    s.put("../essai/main.rs", "fn essai() {}\n");
    let r = s.etat("../essai");
    assert!(
        r.corps
            .contains("\"chemin\":\"../essai/main.rs\",\"statut\":\"modifié\""),
        "{}",
        r.corps
    );
    // `diff` et `indexer` exigent le préfixe du worktree.
    let d = s.appel("GET", "/api/git/diff?worktree=../essai&chemin=main.rs", b"");
    assert_eq!(d.code, 400, "{}", d.corps);
    let d = s.appel(
        "GET",
        "/api/git/diff?worktree=../essai&chemin=../essai/main.rs",
        b"",
    );
    assert!(d.corps.contains("+fn essai()"), "{}", d.corps);
    let i = s.appel(
        "POST",
        "/api/git/indexer?worktree=../essai&chemin=../essai/main.rs",
        b"",
    );
    assert_eq!(i.code, 204, "{}", i.corps);
    let c = s.appel("POST", "/api/git/commit?worktree=../essai", b"sur essai");
    assert_eq!(c.code, 204, "{}", c.corps);
    assert_eq!(s.g(&s.projet, &["rev-parse", "main"]), avant);
    assert_ne!(s.g(&s.projet, &["rev-parse", "essai"]), avant);
    assert!(!s.etat("../essai").corps.contains("../essai/main.rs"));
}

#[test]
fn req086_ac7_liste_relue_apres_add_et_remove() {
    let s = lancer("ac7", None);
    let depot = s.projet.clone();
    s.g(&depot, &["worktree", "add", "-q", "../deux", "-b", "deux"]);
    let r = s.etat("");
    assert!(
        r.corps.contains("\"chemin\":\"../deux\",\"nom\":\"deux\""),
        "{}",
        r.corps
    );
    // Par nom : `deux` avant `essai`.
    assert!(r.corps.find("../deux").unwrap() < r.corps.find("../essai").unwrap());
    s.g(&depot, &["worktree", "remove", "../deux"]);
    let r = s.etat("");
    assert!(!r.corps.contains("../deux"), "{}", r.corps);
    assert!(r.corps.contains("../essai"));
}

#[test]
fn req086_ac10_projet_dans_un_sous_dossier() {
    let s = lancer("ac10", Some("app"));
    // `essai` a `app/` ; `sans` n'en a pas (branche vide).
    s.g(
        &s.racine.join("depot"),
        &["worktree", "add", "-q", "--orphan", "-b", "sans", "../sans"],
    );
    let r = s.etat("");
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(
        r.corps
            .contains("\"chemin\":\"../../essai/app\",\"nom\":\"essai\""),
        "{}",
        r.corps
    );
    assert!(!r.corps.contains("sans"), "{}", r.corps);
    assert_eq!(s.lire("../../essai/app/main.rs").code, 200);
    s.put("../../essai/app/main.rs", "fn essai() {}\n");
    assert_eq!(
        std::fs::read_to_string(s.racine.join("essai/app/main.rs")).unwrap(),
        "fn essai() {}\n"
    );
    let r = s.etat("../../essai/app");
    assert!(
        r.corps.contains("\"chemin\":\"../../essai/app/main.rs\""),
        "{}",
        r.corps
    );
}

#[test]
fn req086_ac12_worktree_inconnu_refuse() {
    let s = lancer("ac12", None);
    let r = s.etat("../inconnu");
    assert_eq!(r.code, 400, "{}", r.corps);
    assert!(r.corps.contains("\"cause\":\"worktree\""));
    assert!(r.corps.contains("Ce worktree n'existe plus."));
    let avant = s.g(&s.projet, &["rev-parse", "main"]);
    s.g(&s.projet, &["add", "."]);
    let c = s.appel("POST", "/api/git/commit?worktree=../inconnu", b"non");
    assert_eq!(c.code, 400, "{}", c.corps);
    assert!(c.corps.contains("\"cause\":\"worktree\""));
    assert_eq!(s.g(&s.projet, &["rev-parse", "main"]), avant);
}

fn liste_wt(s: &Serveur) -> String {
    s.g(&s.projet, &["worktree", "list"])
}

#[test]
fn req099_ac3_branche_prise_par_un_worktree_refusee() {
    let s = lancer("sw3", None);
    let r = s.appel("POST", "/api/git/branche/supprimer?nom=essai", b"");
    assert_eq!(r.code, 409, "{}", r.corps);
    assert!(r.corps.contains("\"cause\":\"git\""));
    assert!(s
        .g(&s.projet, &["branch", "--list", "essai"])
        .contains("essai"));
}

#[test]
fn req099_ac5_branche_courante_du_worktree_refusee() {
    let s = lancer("sw5", None);
    let r = s.appel(
        "POST",
        "/api/git/branche/supprimer?worktree=../essai&nom=essai",
        b"",
    );
    assert_eq!(r.code, 400, "{}", r.corps);
    assert!(r.corps.contains("Git ne supprime pas la branche courante."));
    assert!(s
        .g(&s.projet, &["branch", "--list", "essai"])
        .contains("essai"));
}

#[test]
fn req099_ac6_racine_dans_l_etat() {
    let s = lancer("sw6", None);
    let r = s.etat("");
    assert!(r.corps.contains("\"racine\":\"\""), "{}", r.corps);
    assert!(r.corps.contains("\"racine\":\"../essai\""), "{}", r.corps);
    let s = lancer("sw6b", Some("app"));
    let r = s.etat("");
    assert!(
        r.corps.contains("\"racine\":\"../../essai\""),
        "{}",
        r.corps
    );
}

#[test]
fn req099_ac6_suppression_propre_d_un_worktree() {
    let s = lancer("sw6c", None);
    let r = s.appel("POST", "/api/git/worktree/supprimer?worktree=../essai", b"");
    assert_eq!(r.code, 204, "{}", r.corps);
    assert!(!s.racine.join("essai").exists());
    assert!(!liste_wt(&s).contains("essai"));
    assert!(s
        .g(&s.projet, &["branch", "--list", "essai"])
        .contains("essai"));
    let e = s.etat("").corps;
    assert!(e.contains("\"worktrees\":[{"), "{e}");
    assert!(!e.contains("../essai"), "{e}");
}

#[test]
fn req099_ac8_worktree_sale_refuse_sans_rien_perdre() {
    let s = lancer("sw8", None);
    let essai = s.racine.join("essai");
    std::fs::write(essai.join("main.rs"), "modifié\n").unwrap();
    let r = s.appel("POST", "/api/git/worktree/supprimer?worktree=../essai", b"");
    assert_eq!(r.code, 409, "{}", r.corps);
    assert!(r.corps.contains("\"cause\":\"git\""));
    assert_eq!(
        std::fs::read_to_string(essai.join("main.rs")).unwrap(),
        "modifié\n"
    );
    s.g(&essai, &["checkout", "--", "main.rs"]);
    std::fs::write(essai.join("neuf.txt"), "neuf\n").unwrap();
    let r = s.appel("POST", "/api/git/worktree/supprimer?worktree=../essai", b"");
    assert_eq!(r.code, 409, "{}", r.corps);
    assert_eq!(
        std::fs::read_to_string(essai.join("neuf.txt")).unwrap(),
        "neuf\n"
    );
    assert!(liste_wt(&s).contains("essai"));
}

#[test]
fn req099_ac8_worktree_vide_ou_inconnu_refuse() {
    let s = lancer("sw8b", None);
    let r = s.appel("POST", "/api/git/worktree/supprimer?worktree=", b"");
    assert_eq!(r.code, 400, "{}", r.corps);
    assert!(r.corps.contains("\"cause\":\"invalide\""));
    assert!(r
        .corps
        .contains("Yaide ne supprime pas le worktree du projet."));
    let r = s.appel(
        "POST",
        "/api/git/worktree/supprimer?worktree=../inconnu",
        b"",
    );
    assert_eq!(r.code, 400, "{}", r.corps);
    assert!(r.corps.contains("\"cause\":\"worktree\""));
    assert!(s.racine.join("essai").exists());
    assert!(s.projet.exists());
}
