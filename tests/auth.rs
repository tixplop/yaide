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

struct Reponse {
    code: u16,
    texte: String,
}

impl Reponse {
    fn entetes(&self) -> String {
        self.texte
            .split("\r\n\r\n")
            .next()
            .unwrap_or("")
            .to_lowercase()
    }
    fn corps(&self) -> &str {
        self.texte.split_once("\r\n\r\n").map_or("", |(_, c)| c)
    }
    fn cookie(&self) -> String {
        let ligne = self
            .texte
            .lines()
            .find(|l| l.to_lowercase().starts_with("set-cookie:"))
            .expect("pas de Set-Cookie");
        ligne[11..].trim().split(';').next().unwrap().to_string()
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
    let d = std::env::temp_dir().join(format!("auth-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn passwd(cfg: &Path, entree: &str) {
    let mut c = Command::new(EXE)
        .arg("passwd")
        .env("XDG_CONFIG_HOME", cfg)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    std::io::Write::write_all(&mut c.stdin.take().unwrap(), entree.as_bytes()).unwrap();
    assert!(c.wait().unwrap().success());
}

/// Requête HTTPS avec curl. `extra` : en-têtes supplémentaires.
fn requete(port: u16, methode: &str, chemin: &str, corps: &str, extra: &[&str]) -> Reponse {
    let mut cmd = Command::new("curl");
    cmd.args(["-sk", "-i", "--max-time", "10", "-X", methode])
        .arg(format!("https://127.0.0.1:{port}{chemin}"));
    if !corps.is_empty() {
        cmd.args(["--data-binary", corps]);
    }
    for e in extra {
        if e.starts_with("Upgrade") {
            cmd.arg("--http1.1"); // l'en-tête Upgrade n'existe qu'en HTTP/1.1
        }
        cmd.args(["-H", e]);
    }
    let out = cmd.output().unwrap();
    let texte = String::from_utf8_lossy(&out.stdout).into_owned();
    let code = texte
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    Reponse { code, texte }
}

fn origine(port: u16) -> String {
    format!("Origin: https://127.0.0.1:{port}")
}

fn connexion(port: u16, mdp: &str) -> Reponse {
    requete(port, "POST", "/api/connexion", mdp, &[&origine(port)])
}

fn session(port: u16, cookie: &str) -> u16 {
    requete(
        port,
        "GET",
        "/api/session",
        "",
        &[&format!("Cookie: {cookie}")],
    )
    .code
}

fn lancer(cfg: &Path, projet: &Path) -> Serveur {
    let port = port_libre();
    let child = Command::new(EXE)
        .arg(projet)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", cfg)
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let s = Serveur { child, port };
    for _ in 0..100 {
        if requete(port, "GET", "/api/info", "", &[]).code == 200 {
            return s;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("le serveur ne répond pas");
}

fn prete(nom: &str) -> (PathBuf, PathBuf, Serveur) {
    let d = dossier(nom);
    let cfg = d.join("cfg");
    passwd(&cfg, "mdp\n");
    let s = lancer(&cfg, &d);
    (d, cfg, s)
}

#[test]
fn req004_ac1_bon_mot_de_passe_ouvre_une_session() {
    let (_, _, s) = prete("a1");
    let r = connexion(s.port, "mdp");
    assert_eq!(r.code, 204);
    assert_eq!(session(s.port, &r.cookie()), 204);
}

#[test]
fn req004_ac2_mauvais_mot_de_passe() {
    let (_, _, s) = prete("a2");
    let r = connexion(s.port, "faux");
    assert_eq!(r.code, 401);
    assert_eq!(r.corps(), "Mot de passe incorrect.");
    assert!(!r.entetes().contains("set-cookie"));
}

#[test]
fn req004_ac3_ac8_cinq_echecs_bloquent_meme_le_bon_mot_de_passe() {
    let (_, _, s) = prete("a3");
    for _ in 0..5 {
        assert_eq!(connexion(s.port, "faux").code, 401);
    }
    for mdp in ["mdp", "faux"] {
        let r = connexion(s.port, mdp);
        assert_eq!(r.code, 429);
        assert_eq!(r.corps(), "Trop d'essais. Attendez une minute.");
    }
}

#[test]
fn req004_ac4_une_reussite_remet_le_compteur_a_zero() {
    let (_, _, s) = prete("a4");
    for _ in 0..4 {
        assert_eq!(connexion(s.port, "faux").code, 401);
    }
    assert_eq!(connexion(s.port, "mdp").code, 204);
    for _ in 0..4 {
        assert_eq!(connexion(s.port, "faux").code, 401);
    }
    assert_eq!(connexion(s.port, "mdp").code, 204);
}

#[test]
fn req004_ac5_info_publique_nom_et_chemin() {
    let (d, _, s) = prete("a5");
    let r = requete(s.port, "GET", "/api/info", "", &[]);
    assert_eq!(r.code, 200);
    let chemin = d.canonicalize().unwrap().display().to_string();
    assert!(r.corps().contains("\"nom\":\"Yaide\""), "{}", r.corps());
    assert!(r.corps().contains(&format!("\"chemin\":\"{chemin}\"")));
}

#[test]
fn req004_ac9_champ_vide_refuse_sans_compter_un_echec() {
    let (_, _, s) = prete("a9");
    for _ in 0..4 {
        assert_eq!(connexion(s.port, "faux").code, 401);
    }
    for _ in 0..3 {
        let r = connexion(s.port, "");
        assert_eq!(r.code, 400);
        assert_eq!(r.corps(), "Saisissez le mot de passe.");
    }
    assert_eq!(connexion(s.port, "mdp").code, 204);
}

#[test]
fn req005_ac3_deconnexion_efface_le_cookie() {
    let (_, _, s) = prete("s3");
    let c = connexion(s.port, "mdp").cookie();
    let r = requete(
        s.port,
        "POST",
        "/api/deconnexion",
        "",
        &[&origine(s.port), &format!("Cookie: {c}")],
    );
    assert_eq!(r.code, 204);
    assert!(r.cookie().starts_with("yaide_session="));
    assert!(r.entetes().contains("max-age=0"));
}

#[test]
fn req005_ac4_la_session_survit_au_redemarrage() {
    let d = dossier("s4");
    let cfg = d.join("cfg");
    passwd(&cfg, "mdp\n");
    let c = {
        let s = lancer(&cfg, &d);
        connexion(s.port, "mdp").cookie()
    };
    let s2 = lancer(&cfg, &d);
    assert_eq!(session(s2.port, &c), 204);
}

#[test]
fn req005_ac5_attributs_du_cookie() {
    let (_, _, s) = prete("s5");
    let e = connexion(s.port, "mdp").entetes();
    for attendu in ["secure", "httponly", "samesite=strict", "max-age=2592000"] {
        assert!(e.contains(attendu), "{attendu} absent de {e}");
    }
}

#[test]
fn req005_ac6_nouveau_passwd_annule_les_sessions() {
    let (_, cfg, s) = prete("s6");
    let c = connexion(s.port, "mdp").cookie();
    assert_eq!(session(s.port, &c), 204);
    passwd(&cfg, "autre\n");
    assert_eq!(session(s.port, &c), 401);
}

#[test]
fn req006_ac1_sans_session_tout_est_refuse() {
    let (_, _, s) = prete("p1");
    for chemin in [
        "/api/session",
        "/api/fichiers",
        "/api/git/etat",
        "/api/shells",
    ] {
        assert_eq!(
            requete(s.port, "GET", chemin, "", &[]).code,
            401,
            "{chemin}"
        );
    }
    let ws = [
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    ];
    assert_eq!(
        requete(s.port, "GET", "/api/shells/1/ws", "", &ws).code,
        401
    );
    assert_eq!(session(s.port, "yaide_session=1.00"), 401);
    let c = connexion(s.port, "mdp").cookie();
    assert_eq!(session(s.port, &c), 204);
}

#[test]
fn req006_ac2_origine_etrangere_refusee() {
    let (_, _, s) = prete("p2");
    let c = format!("Cookie: {}", connexion(s.port, "mdp").cookie());
    let etranger = "Origin: https://evil.example";
    let ws = [
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    ];
    let mut ws_etranger = vec![c.as_str(), etranger];
    ws_etranger.extend(ws);
    assert_eq!(
        requete(s.port, "GET", "/api/shells/1/ws", "", &ws_etranger).code,
        403
    );
    assert_eq!(
        requete(s.port, "POST", "/api/deconnexion", "", &[&c, etranger]).code,
        403
    );
    assert_eq!(
        requete(s.port, "POST", "/api/deconnexion", "", &[&c]).code,
        403
    );
    let bonne = origine(s.port);
    assert_eq!(
        requete(s.port, "POST", "/api/deconnexion", "", &[&c, &bonne]).code,
        204
    );
    // Une lecture simple n'est pas concernée.
    assert_eq!(
        requete(s.port, "GET", "/api/session", "", &[&c, etranger]).code,
        204
    );
}

#[test]
fn req029_ac3_csp_sur_les_pages() {
    let (_, _, s) = prete("csp");
    let attendu = "content-security-policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";
    for chemin in ["/", "/main.js"] {
        let r = requete(s.port, "GET", chemin, "", &[]);
        assert_eq!(r.code, 200);
        assert!(r.entetes().contains(attendu), "{chemin}: {}", r.entetes());
    }
}

#[test]
fn req001_ac2_deux_instances_acceptent_le_meme_mot_de_passe() {
    let d = dossier("i2");
    let cfg = d.join("cfg");
    passwd(&cfg, "mdp\n");
    let a = lancer(&cfg, &d);
    let b = lancer(&cfg, &d);
    assert_ne!(a.port, b.port);
    assert_eq!(connexion(a.port, "mdp").code, 204);
    assert_eq!(connexion(b.port, "mdp").code, 204);
    assert_eq!(connexion(b.port, "faux").code, 401);
}

#[test]
fn req001_ac3_instance_lancee_suit_le_nouveau_mot_de_passe() {
    let (_, cfg, s) = prete("i3");
    passwd(&cfg, "nouveau\n");
    assert_eq!(connexion(s.port, "mdp").code, 401);
    assert_eq!(connexion(s.port, "nouveau").code, 204);
}

#[test]
fn req002_ac2_deux_instances_deux_dossiers() {
    let d = dossier("i4");
    let cfg = d.join("cfg");
    passwd(&cfg, "mdp\n");
    let (p1, p2) = (d.join("un"), d.join("deux"));
    std::fs::create_dir_all(&p1).unwrap();
    std::fs::create_dir_all(&p2).unwrap();
    let a = lancer(&cfg, &p1);
    let b = lancer(&cfg, &p2);
    let ia = requete(a.port, "GET", "/api/info", "", &[]);
    let ib = requete(b.port, "GET", "/api/info", "", &[]);
    assert!(ia.corps().contains("/un\""), "{}", ia.corps());
    assert!(ib.corps().contains("/deux\""), "{}", ib.corps());
}
