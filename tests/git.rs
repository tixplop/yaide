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
    fn etat(&self) -> Rep {
        self.appel("GET", "/api/git/etat", b"")
    }
    fn diff(&self, c: &str) -> Rep {
        self.appel("GET", &format!("/api/git/diff?chemin={}", enc(c)), b"")
    }
    fn indexer(&self, c: &str) -> Rep {
        self.appel("POST", &format!("/api/git/indexer?chemin={}", enc(c)), b"")
    }
    fn commit(&self, m: &str) -> Rep {
        self.appel("POST", "/api/git/commit", m.as_bytes())
    }
    fn branche(&self, n: &str) -> Rep {
        self.appel("POST", &format!("/api/git/branche?nom={}", enc(n)), b"")
    }
    fn ecrire(&self, c: &str, contenu: &[u8]) {
        std::fs::write(self.projet.join(c), contenu).unwrap();
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
    /// Dépôt initialisé avec `main.rs` et `lisez.txt` validés.
    fn depot(&self) {
        let p = self.projet.clone();
        self.g(&p, &["init", "-q"]);
        self.ecrire("main.rs", b"fn main() {}\n");
        self.ecrire("lisez.txt", b"bonjour\n");
        self.g(&p, &["add", "."]);
        self.g(&p, &["commit", "-q", "-m", "premier"]);
    }
    /// Dépôt distant nu, avec le projet cloné de lui (suivi de `origin/main`).
    fn avec_distant(&self) -> PathBuf {
        self.depot();
        let p = self.projet.clone();
        let distant = self.racine.join("distant.git");
        self.g(&self.racine, &["init", "-q", "--bare", "distant.git"]);
        self.g(&p, &["remote", "add", "origin", distant.to_str().unwrap()]);
        self.g(&p, &["push", "-q", "-u", "origin", "main"]);
        distant
    }
}

fn contient_ligne(r: &Rep, chemin: &str, statut: &str) -> bool {
    r.corps
        .contains(&format!("\"chemin\":\"{chemin}\",\"statut\":\"{statut}\""))
}

#[test]
fn req022_ac1_fichier_modifie_dans_la_liste_et_son_diff() {
    let s = lancer("ac1");
    s.depot();
    s.ecrire("main.rs", b"fn main() { println!(\"x\"); }\n");
    let r = s.etat();
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(contient_ligne(&r, "main.rs", "modifié"), "{}", r.corps);
    assert!(!r.corps.contains("lisez.txt"), "{}", r.corps);
    let d = s.diff("main.rs");
    assert_eq!(d.code, 200, "{}", d.corps);
    assert!(d.corps.contains("-fn main() {}"), "{}", d.corps);
    assert!(d.corps.contains("+fn main() { println!"), "{}", d.corps);
    assert!(d.corps.contains("\"binaire\":false"), "{}", d.corps);
}

#[test]
fn req022_ac2_fichier_non_suivi_liste_et_diff_en_ajout() {
    let s = lancer("ac2");
    s.depot();
    std::fs::create_dir_all(s.projet.join("src")).unwrap();
    s.ecrire("src/neuf.rs", b"ligne un\nligne deux\n");
    let r = s.etat();
    assert!(contient_ligne(&r, "src/neuf.rs", "nouveau"), "{}", r.corps);
    let d = s.diff("src/neuf.rs");
    assert_eq!(d.code, 200, "{}", d.corps);
    assert!(d.corps.contains("+ligne un"), "{}", d.corps);
    assert!(d.corps.contains("+ligne deux"), "{}", d.corps);
}

#[test]
fn req022_ac3_branche_courante() {
    let s = lancer("ac3");
    s.depot();
    let r = s.etat();
    assert!(r.corps.contains("\"branche\":\"main\""), "{}", r.corps);
    assert!(r.corps.contains("\"changements\":[]"), "{}", r.corps);
}

#[test]
fn req022_ac3_tete_detachee_signalee_et_hors_de_la_liste() {
    let s = lancer("ac3d");
    s.depot();
    let p = s.projet.clone();
    assert!(s.etat().corps.contains("\"detachee\":false"));
    s.g(&p, &["checkout", "-q", "--detach"]);
    let r = s.etat();
    assert!(r.corps.contains("\"detachee\":true"), "{}", r.corps);
    assert!(r.corps.contains("\"branches\":[\"main\"]"), "{}", r.corps);
}

#[test]
fn req022_ac4_hors_depot() {
    let s = lancer("ac4");
    s.ecrire("a.txt", b"x");
    for r in [s.etat(), s.diff("a.txt"), s.commit("m")] {
        assert_eq!(r.code, 409, "{}", r.corps);
        assert!(
            r.corps.contains("Ce dossier n'est pas un dépôt git."),
            "{}",
            r.corps
        );
    }
}

#[test]
fn req022_ac6_statuts_en_mots() {
    let s = lancer("ac6");
    s.depot();
    let p = s.projet.clone();
    s.ecrire("autre.txt", b"a\n");
    s.ecrire("gros.txt", b"g\n");
    s.ecrire(
        "ancien.txt",
        b"contenu assez long pour etre reconnu\nsur deux lignes\n",
    );
    s.g(&p, &["add", "."]);
    s.g(&p, &["commit", "-q", "-m", "deux"]);
    // modifié, nouveau, supprimé, indexé, renommé
    s.ecrire("main.rs", b"autre\n");
    s.ecrire("nouveau.txt", b"n\n");
    std::fs::remove_file(p.join("lisez.txt")).unwrap();
    s.ecrire("autre.txt", b"b\n");
    s.g(&p, &["add", "autre.txt"]);
    s.g(&p, &["mv", "ancien.txt", "recent.txt"]);
    let r = s.etat();
    assert!(contient_ligne(&r, "main.rs", "modifié"), "{}", r.corps);
    assert!(contient_ligne(&r, "nouveau.txt", "nouveau"), "{}", r.corps);
    assert!(contient_ligne(&r, "lisez.txt", "supprimé"), "{}", r.corps);
    assert!(contient_ligne(&r, "autre.txt", "indexé"), "{}", r.corps);
    assert!(
        r.corps.contains("\"statut\":\"indexé\",\"indexe\":true"),
        "{}",
        r.corps
    );
    assert!(contient_ligne(&r, "recent.txt", "renommé"), "{}", r.corps);
    assert!(r.corps.contains("\"indexe\":false"), "{}", r.corps);
    // conflit
    s.g(&p, &["checkout", "-q", "--", "."]);
    s.g(&p, &["reset", "-q", "--hard"]);
    s.g(&p, &["checkout", "-q", "-b", "autre"]);
    s.ecrire("main.rs", b"version A\n");
    s.g(&p, &["commit", "-q", "-am", "A"]);
    s.g(&p, &["checkout", "-q", "main"]);
    s.ecrire("main.rs", b"version B\n");
    s.g(&p, &["commit", "-q", "-am", "B"]);
    let _ = Command::new("git")
        .arg("-C")
        .arg(&p)
        .args(["merge", "autre"])
        .env("HOME", &s.racine)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    let r = s.etat();
    assert!(contient_ligne(&r, "main.rs", "conflit"), "{}", r.corps);
}

fn lettre_de(r: &Rep, chemin: &str) -> String {
    let cle = format!("\"chemin\":\"{chemin}\",");
    let debut = r
        .corps
        .find(&cle)
        .unwrap_or_else(|| panic!("{chemin} absent : {}", r.corps));
    let reste = &r.corps[debut..];
    let l = reste.find("\"lettre\":\"").unwrap() + "\"lettre\":\"".len();
    reste[l..].split('"').next().unwrap().to_string()
}

#[test]
fn req039_ac1_lettre_de_chaque_statut() {
    let s = lancer("lettres");
    s.depot();
    let p = s.projet.clone();
    s.ecrire("partiel.txt", b"un\n");
    s.ecrire("sup-indexe.txt", b"x\n");
    s.ecrire("sup.txt", b"y\n");
    s.ecrire(
        "ancien.txt",
        b"contenu assez long pour etre reconnu\nsur deux lignes\n",
    );
    s.g(&p, &["add", "."]);
    s.g(&p, &["commit", "-q", "-m", "deux"]);
    s.ecrire("main.rs", b"autre\n"); // modifié, non indexé : M
    s.ecrire("nouveau.txt", b"n\n"); // non suivi : U
    s.ecrire("indexe.txt", b"i\n"); // nouveau indexé : A
    s.g(&p, &["add", "indexe.txt"]);
    s.ecrire("partiel.txt", b"deux\n"); // MM
    s.g(&p, &["add", "partiel.txt"]);
    s.ecrire("partiel.txt", b"trois\n");
    s.g(&p, &["rm", "-q", "sup-indexe.txt"]); // D indexé
    std::fs::remove_file(p.join("sup.txt")).unwrap(); // D non indexé
    s.g(&p, &["mv", "ancien.txt", "recent.txt"]); // R indexé
    let r = s.etat();
    assert_eq!(lettre_de(&r, "main.rs"), "M", "{}", r.corps);
    assert_eq!(lettre_de(&r, "nouveau.txt"), "U", "{}", r.corps);
    assert_eq!(lettre_de(&r, "indexe.txt"), "A", "{}", r.corps);
    assert_eq!(lettre_de(&r, "partiel.txt"), "M", "{}", r.corps);
    assert_eq!(lettre_de(&r, "sup-indexe.txt"), "D", "{}", r.corps);
    assert_eq!(lettre_de(&r, "sup.txt"), "D", "{}", r.corps);
    assert_eq!(lettre_de(&r, "recent.txt"), "R", "{}", r.corps);
    // `statut` et `indexe` ne changent pas.
    assert!(contient_ligne(&r, "partiel.txt", "indexé"), "{}", r.corps);
    assert!(contient_ligne(&r, "sup.txt", "supprimé"), "{}", r.corps);
    // conflit
    s.g(&p, &["reset", "-q", "--hard"]);
    s.g(&p, &["checkout", "-q", "-b", "autre"]);
    s.ecrire("main.rs", b"version A\n");
    s.g(&p, &["commit", "-q", "-am", "A"]);
    s.g(&p, &["checkout", "-q", "main"]);
    s.ecrire("main.rs", b"version B\n");
    s.g(&p, &["commit", "-q", "-am", "B"]);
    let _ = Command::new("git")
        .arg("-C")
        .arg(&p)
        .args(["merge", "autre"])
        .env("HOME", &s.racine)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    let r = s.etat();
    assert_eq!(lettre_de(&r, "main.rs"), "C", "{}", r.corps);
}

#[test]
fn req022_ac8_diff_binaire_et_trop_gros() {
    let s = lancer("ac8");
    s.depot();
    let p = s.projet.clone();
    s.ecrire("image.bin", &[0u8, 1, 2, 0, 255, 0, 7]);
    let d = s.diff("image.bin");
    assert!(d.corps.contains("\"binaire\":true"), "{}", d.corps);
    assert!(d.corps.contains("\"diff\":\"\""), "{}", d.corps);
    s.g(&p, &["add", "image.bin"]);
    s.g(&p, &["commit", "-q", "-m", "bin"]);
    s.ecrire("image.bin", &[9u8, 0, 0, 3, 0]);
    let d = s.diff("image.bin");
    assert!(d.corps.contains("\"binaire\":true"), "{}", d.corps);
    // plus de 5 Mo de diff
    s.ecrire(
        "enorme.txt",
        "0123456789abcdef\n".repeat(400_000).as_bytes(),
    );
    let d = s.diff("enorme.txt");
    assert_eq!(d.code, 200);
    assert!(
        d.corps.contains("\"trop_gros\":true"),
        "{}",
        &d.corps[..200]
    );
    assert!(d.corps.contains("\"diff\":\"\""), "{}", &d.corps[..200]);
}

#[test]
fn req022_chemins_invalides_refuses() {
    let s = lancer("chemins");
    s.depot();
    for c in ["../x", "/etc/passwd", "a/../../b", ""] {
        assert_eq!(s.diff(c).code, 400, "diff {c}");
        assert_eq!(s.indexer(c).code, 400, "indexer {c}");
    }
}

#[test]
fn req023_ac1_indexer_et_valider() {
    let s = lancer("c1");
    s.depot();
    let p = s.projet.clone();
    s.ecrire("main.rs", b"modifie\n");
    s.ecrire("lisez.txt", b"modifie aussi\n");
    let r = s.indexer("main.rs");
    assert_eq!(r.code, 204, "{}", r.corps);
    assert!(contient_ligne(&s.etat(), "main.rs", "indexé"));
    let r = s.commit("Change main");
    assert_eq!(r.code, 204, "{}", r.corps);
    let e = s.etat();
    assert!(!e.corps.contains("main.rs"), "{}", e.corps);
    assert!(contient_ligne(&e, "lisez.txt", "modifié"), "{}", e.corps);
    assert_eq!(s.g(&p, &["log", "-1", "--format=%s"]).trim(), "Change main");
}

#[test]
fn req023_ac2_commit_sans_fichier_indexe() {
    let s = lancer("c2");
    s.depot();
    s.ecrire("main.rs", b"modifie\n");
    let r = s.commit("message");
    assert_eq!(r.code, 409, "{}", r.corps);
    assert!(
        r.corps
            .contains("Aucun fichier indexé. Indexez au moins un fichier."),
        "{}",
        r.corps
    );
    assert!(r.corps.contains("aucun-indexe"));
    assert_eq!(s.g(&s.projet, &["rev-list", "--count", "HEAD"]).trim(), "1");
}

#[test]
fn req023_ac3_commit_sans_message() {
    let s = lancer("c3");
    s.depot();
    s.ecrire("main.rs", b"modifie\n");
    s.indexer("main.rs");
    for m in ["", "  \n "] {
        let r = s.commit(m);
        assert_eq!(r.code, 400, "{}", r.corps);
        assert!(
            r.corps.contains("Écrivez un message de commit."),
            "{}",
            r.corps
        );
        assert!(r.corps.contains("message-vide"));
    }
    assert_eq!(s.g(&s.projet, &["rev-list", "--count", "HEAD"]).trim(), "1");
}

#[test]
fn req023_ac4_echec_de_git_au_commit_message_tel_quel() {
    let s = lancer("c4");
    s.depot();
    let p = s.projet.clone();
    s.ecrire("main.rs", b"modifie\n");
    s.indexer("main.rs");
    // Identité absente.
    std::fs::write(
        s.racine.join(".gitconfig"),
        "[user]\n\tuseConfigOnly = true\n",
    )
    .unwrap();
    let r = s.commit("message");
    assert_eq!(r.code, 409, "{}", r.corps);
    assert!(r.corps.contains("\"cause\":\"git\""), "{}", r.corps);
    assert!(r.corps.contains("Author identity unknown"), "{}", r.corps);
    // Hook qui refuse.
    std::fs::write(
        s.racine.join(".gitconfig"),
        "[user]\n\tname = T\n\temail = t@example.com\n",
    )
    .unwrap();
    let hook = p.join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\necho 'refus du hook de test'\nexit 1\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let r = s.commit("message");
    assert_eq!(r.code, 409, "{}", r.corps);
    assert!(r.corps.contains("refus du hook de test"), "{}", r.corps);
}

#[test]
fn req024_ac1_changer_de_branche() {
    let s = lancer("b1");
    s.depot();
    let p = s.projet.clone();
    s.g(&p, &["branch", "travail"]);
    let e = s.etat();
    assert!(
        e.corps.contains("\"branches\":[\"main\",\"travail\"]"),
        "{}",
        e.corps
    );
    let r = s.branche("travail");
    assert_eq!(r.code, 204, "{}", r.corps);
    assert!(s.etat().corps.contains("\"branche\":\"travail\""));
    assert_eq!(s.g(&p, &["branch", "--show-current"]).trim(), "travail");
    // Une branche inconnue ou une option n'est pas acceptée.
    assert_eq!(s.branche("nexiste-pas").code, 400);
    assert_eq!(s.branche("--detach").code, 400);
}

#[test]
fn req024_ac2_changement_refuse_message_de_git() {
    let s = lancer("b2");
    s.depot();
    let p = s.projet.clone();
    s.g(&p, &["checkout", "-q", "-b", "autre"]);
    s.ecrire("main.rs", b"sur autre\n");
    s.g(&p, &["commit", "-q", "-am", "autre"]);
    s.g(&p, &["checkout", "-q", "main"]);
    s.ecrire("main.rs", b"local non valide\n");
    let r = s.branche("autre");
    assert_eq!(r.code, 409, "{}", r.corps);
    assert!(r.corps.contains("would be overwritten"), "{}", r.corps);
    assert!(s.etat().corps.contains("\"branche\":\"main\""));
}

#[test]
fn req025_ac1_pull_et_push_reussis() {
    let s = lancer("p1");
    let distant = s.avec_distant();
    let p = s.projet.clone();
    // Un second clone publie un commit : le pull l'apporte.
    let autre = s.racine.join("autre");
    s.g(
        &s.racine,
        &["clone", "-q", distant.to_str().unwrap(), "autre"],
    );
    std::fs::write(autre.join("venu.txt"), "du distant\n").unwrap();
    s.g(&autre, &["add", "."]);
    s.g(&autre, &["commit", "-q", "-m", "distant"]);
    s.g(&autre, &["push", "-q"]);
    let r = s.appel("POST", "/api/git/pull", b"");
    assert_eq!(r.code, 204, "{}", r.corps);
    assert!(p.join("venu.txt").exists());
    // Un commit local part avec le push.
    s.ecrire("main.rs", b"local\n");
    s.g(&p, &["commit", "-q", "-am", "local"]);
    let r = s.appel("POST", "/api/git/push", b"");
    assert_eq!(r.code, 204, "{}", r.corps);
    assert_eq!(
        s.g(&distant, &["log", "-1", "--format=%s", "main"]).trim(),
        "local"
    );
}

#[test]
fn req025_ac2_push_refuse_message_de_git() {
    let s = lancer("p2");
    let distant = s.avec_distant();
    let p = s.projet.clone();
    let autre = s.racine.join("autre");
    s.g(
        &s.racine,
        &["clone", "-q", distant.to_str().unwrap(), "autre"],
    );
    std::fs::write(autre.join("x.txt"), "x\n").unwrap();
    s.g(&autre, &["add", "."]);
    s.g(&autre, &["commit", "-q", "-m", "distant"]);
    s.g(&autre, &["push", "-q"]);
    s.ecrire("main.rs", b"local\n");
    s.g(&p, &["commit", "-q", "-am", "local"]);
    let r = s.appel("POST", "/api/git/push", b"");
    assert_eq!(r.code, 409, "{}", r.corps);
    assert!(r.corps.contains("\"cause\":\"git\""), "{}", r.corps);
    assert!(r.corps.contains("rejected"), "{}", r.corps);
}

#[test]
fn req025_ac2_pull_en_conflit_message_de_git() {
    let s = lancer("p2b");
    let distant = s.avec_distant();
    let p = s.projet.clone();
    let autre = s.racine.join("autre");
    s.g(
        &s.racine,
        &["clone", "-q", distant.to_str().unwrap(), "autre"],
    );
    std::fs::write(autre.join("main.rs"), "distant\n").unwrap();
    s.g(&autre, &["commit", "-q", "-am", "distant"]);
    s.g(&autre, &["push", "-q"]);
    s.ecrire("main.rs", b"local\n");
    s.g(&p, &["commit", "-q", "-am", "local"]);
    let r = s.appel("POST", "/api/git/pull", b"");
    assert_eq!(r.code, 409, "{}", r.corps);
    assert!(r.corps.contains("CONFLICT"), "{}", r.corps);
}

#[test]
fn req025_ac3_acces_avec_mot_de_passe_echoue_sans_bloquer() {
    use std::io::{Read, Write as _};
    // Faux serveur HTTP qui exige un mot de passe.
    let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port_http = ecoute.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for flux in ecoute.incoming() {
            let Ok(mut f) = flux else { break };
            let mut tampon = [0u8; 4096];
            let _ = f.read(&mut tampon);
            let _ = f.write_all(
                b"HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"x\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
        }
    });
    let s = lancer("p3");
    s.depot();
    let p = s.projet.clone();
    s.g(
        &p,
        &[
            "remote",
            "add",
            "origin",
            &format!("http://127.0.0.1:{port_http}/depot.git"),
        ],
    );
    s.g(&p, &["config", "branch.main.remote", "origin"]);
    s.g(&p, &["config", "branch.main.merge", "refs/heads/main"]);
    for action in ["pull", "push"] {
        let debut = std::time::Instant::now();
        let r = s.appel("POST", &format!("/api/git/{action}"), b"");
        assert!(debut.elapsed() < Duration::from_secs(20), "{action} bloqué");
        assert_eq!(r.code, 409, "{}", r.corps);
        assert!(r.corps.contains("terminal prompts disabled"), "{}", r.corps);
    }
}

#[test]
fn req023_ac1_depot_vide_premier_commit() {
    let s = lancer("vide");
    s.g(&s.projet.clone(), &["init", "-q"]);
    s.ecrire("a.txt", b"a\n");
    let e = s.etat();
    assert!(contient_ligne(&e, "a.txt", "nouveau"), "{}", e.corps);
    assert!(e.corps.contains("\"branche\":\"main\""), "{}", e.corps);
    assert_eq!(s.indexer("a.txt").code, 204);
    let d = s.diff("a.txt");
    assert!(d.corps.contains("+a"), "{}", d.corps);
    assert_eq!(s.commit("initial").code, 204);
}
fn lancer(nom: &str) -> Serveur {
    lancer_ex(nom, None, None)
}

/// `sous` : le projet est ce sous-dossier de `projet/` ; `ssh` : valeur de GIT_SSH_COMMAND.
fn lancer_ex(nom: &str, sous: Option<&str>, ssh: Option<&str>) -> Serveur {
    let d = std::env::temp_dir().join(format!("git-{nom}-{}", std::process::id()));
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
        "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[pull]\n\trebase = false\n",
    )
    .unwrap();
    let mut projet = d.join("projet");
    if let Some(sous) = sous {
        projet = projet.join(sous);
    }
    std::fs::create_dir_all(&projet).unwrap();
    // Faux ssh : note ses arguments puis échoue.
    let bin = d.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(
        bin.join("ssh"),
        "#!/bin/sh\necho \"$@\" > \"$HOME/ssh-args\"\nexit 255\n",
    )
    .unwrap();
    std::fs::set_permissions(bin.join("ssh"), std::fs::Permissions::from_mode(0o755)).unwrap();
    let chemin_sys = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let port = port_libre();
    let mut cmd = Command::new(EXE);
    cmd.env("PATH", chemin_sys).env_remove("GIT_SSH_COMMAND");
    if let Some(ssh) = ssh {
        cmd.env("GIT_SSH_COMMAND", ssh);
    }
    let child = cmd
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
fn req022_ac1_projet_dans_un_sous_dossier_du_depot() {
    let s = lancer_ex("sous", Some("sub"), None);
    let racine_depot = s.projet.parent().unwrap().to_path_buf();
    s.g(&racine_depot, &["init", "-q"]);
    std::fs::write(racine_depot.join("hors.txt"), "h\n").unwrap();
    s.ecrire("dedans.txt", b"d\n");
    s.g(&racine_depot, &["add", "."]);
    s.g(&racine_depot, &["commit", "-q", "-m", "un"]);
    std::fs::write(racine_depot.join("hors.txt"), "h2\n").unwrap();
    s.ecrire("dedans.txt", b"d2\n");
    s.ecrire("neuf.txt", b"n\n");
    let r = s.etat();
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(contient_ligne(&r, "dedans.txt", "modifié"), "{}", r.corps);
    assert!(contient_ligne(&r, "neuf.txt", "nouveau"), "{}", r.corps);
    assert!(!r.corps.contains("hors.txt"), "{}", r.corps);
    assert!(!r.corps.contains("sub/"), "{}", r.corps);
    assert!(s.diff("dedans.txt").corps.contains("+d2"));
    assert!(s.diff("neuf.txt").corps.contains("+n"));
    assert_eq!(s.indexer("dedans.txt").code, 204);
    assert!(contient_ligne(&s.etat(), "dedans.txt", "indexé"));
    assert_eq!(s.commit("dedans").code, 204);
    assert!(!s.etat().corps.contains("dedans.txt"));
}

#[test]
fn req022_ac1_diff_d_une_suppression_indexee() {
    let s = lancer("supp");
    s.depot();
    s.g(&s.projet.clone(), &["rm", "-q", "main.rs"]);
    let d = s.diff("main.rs");
    assert_eq!(d.code, 200, "{}", d.corps);
    assert!(d.corps.contains("deleted file"), "{}", d.corps);
    assert!(d.corps.contains("-fn main() {}"), "{}", d.corps);
    // Supprimé sans être indexé.
    std::fs::remove_file(s.projet.join("lisez.txt")).unwrap();
    let d = s.diff("lisez.txt");
    assert!(d.corps.contains("-bonjour"), "{}", d.corps);
}

#[test]
fn req023_ac1_hook_qui_laisse_un_processus_ne_bloque_pas() {
    let s = lancer("fond");
    s.depot();
    let hook = s.projet.join(".git/hooks/post-commit");
    std::fs::write(&hook, "#!/bin/sh\nsleep 12 &\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    s.ecrire("main.rs", b"modifie\n");
    s.indexer("main.rs");
    let debut = std::time::Instant::now();
    let r = s.commit("avec hook");
    assert_eq!(r.code, 204, "{}", r.corps);
    assert!(debut.elapsed() < Duration::from_secs(6), "réponse bloquée");
}

fn args_ssh(s: &Serveur) -> String {
    let _ = std::fs::remove_file(s.racine.join("ssh-args"));
    let p = s.projet.clone();
    s.g(
        &p,
        &["remote", "add", "origin", "ssh://hote.invalide/depot.git"],
    );
    let r = s.appel("POST", "/api/git/pull", b"");
    assert_eq!(r.code, 409, "{}", r.corps);
    std::fs::read_to_string(s.racine.join("ssh-args")).expect("ssh n'a pas été lancé")
}

#[test]
fn req025_ac3_ssh_en_mode_batch_par_defaut() {
    let s = lancer("ssh1");
    s.depot();
    let a = args_ssh(&s);
    assert!(a.contains("BatchMode=yes"), "{a}");
}

#[test]
fn req025_ac3_ssh_defini_par_l_utilisateur_est_respecte() {
    let s = lancer_ex("ssh2", None, Some("ssh -o Reglage=env"));
    s.depot();
    let a = args_ssh(&s);
    assert!(a.contains("Reglage=env"), "{a}");
    assert!(!a.contains("BatchMode"), "{a}");
    let s = lancer("ssh3");
    s.depot();
    s.g(
        &s.projet.clone(),
        &["config", "core.sshCommand", "ssh -o Reglage=config"],
    );
    let a = args_ssh(&s);
    assert!(a.contains("Reglage=config"), "{a}");
    assert!(!a.contains("BatchMode"), "{a}");
}
