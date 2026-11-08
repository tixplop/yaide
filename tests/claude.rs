use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme, StreamOwned};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tungstenite::client::IntoClientRequest;
use tungstenite::{Message, WebSocket};

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

fn port_libre() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Réponse HTTP : code et corps.
fn http(port: u16, methode: &str, chemin: &str, cookie: &str, corps: &str) -> (u16, String) {
    let mut cmd = Command::new("curl");
    cmd.args(["-sk", "-i", "--max-time", "10", "-X", methode])
        .arg(format!("https://127.0.0.1:{port}{chemin}"))
        .args(["-H", &format!("Origin: https://127.0.0.1:{port}")]);
    if !cookie.is_empty() {
        cmd.args(["-H", &format!("Cookie: {cookie}")]);
    }
    if !corps.is_empty() {
        cmd.args(["--data-binary", corps]);
    }
    let sortie = cmd.output().unwrap();
    let texte = String::from_utf8_lossy(&sortie.stdout).into_owned();
    let code = texte
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    let corps = texte
        .split_once("\r\n\r\n")
        .map_or(String::new(), |(_, c)| c.to_string());
    (code, corps)
}

fn cookie_de(port: u16) -> String {
    let sortie = Command::new("curl")
        .args(["-sk", "-i", "--max-time", "10", "-X", "POST"])
        .arg(format!("https://127.0.0.1:{port}/api/connexion"))
        .args(["-H", &format!("Origin: https://127.0.0.1:{port}")])
        .args(["--data-binary", "mdp"])
        .output()
        .unwrap();
    let texte = String::from_utf8_lossy(&sortie.stdout).into_owned();
    let ligne = texte
        .lines()
        .find(|l| l.to_lowercase().starts_with("set-cookie:"))
        .expect("pas de Set-Cookie");
    ligne[11..].trim().split(';').next().unwrap().to_string()
}

fn dossier(nom: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("claude-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

/// Lance Yaide dans un dossier neuf avec le `PATH` donné.
fn lancer(nom: &str, path: &str) -> Serveur {
    lancer_avec_env(nom, path, &[])
}

/// Comme `lancer`, avec des variables d'environnement en plus pour Yaide.
fn lancer_avec_env(nom: &str, path: &str, env: &[(&str, &str)]) -> Serveur {
    let d = dossier(nom);
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
    std::io::Write::write_all(&mut c.stdin.take().unwrap(), b"mdp\n").unwrap();
    assert!(c.wait().unwrap().success());
    let projet = d.join("projet");
    std::fs::create_dir_all(&projet).unwrap();
    let port = port_libre();
    let mut cmd = Command::new(EXE);
    cmd.arg(&projet)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", &cfg)
        .env("HOME", &d)
        .stdout(Stdio::null());
    cmd.env("SHELL", "/bin/sh").env("PATH", path);
    cmd.envs(env.iter().copied());
    let child = cmd.spawn().unwrap();
    let mut s = Serveur {
        child,
        port,
        cookie: String::new(),
        projet,
    };
    for _ in 0..1000 {
        if http(port, "GET", "/api/info", "", "").0 == 200 {
            s.cookie = cookie_de(port);
            return s;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("le serveur ne répond pas");
}

fn ouvrir(s: &Serveur) -> u32 {
    let (code, corps) = http(s.port, "POST", "/api/claude", &s.cookie, "");
    assert_eq!(code, 201, "{corps}");
    corps
        .trim_start_matches("{\"id\":")
        .trim_end_matches('}')
        .parse()
        .unwrap()
}

fn liste(s: &Serveur) -> String {
    let (code, corps) = http(s.port, "GET", "/api/shells", &s.cookie, "");
    assert_eq!(code, 200);
    corps
}

#[derive(Debug)]
struct Tout;

impl ServerCertVerifier for Tout {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

type Ws = WebSocket<StreamOwned<ClientConnection, TcpStream>>;

/// Ouvre la WebSocket d'un shell ; `Err(code)` si le serveur refuse.
fn essayer_ws(port: u16, cookie: &str, origine: &str, id: u32) -> Result<Ws, u16> {
    let config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(Tout))
            .with_no_client_auth();
    let tcp = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let tls = ClientConnection::new(Arc::new(config), ServerName::try_from("127.0.0.1").unwrap())
        .unwrap();
    let flux = StreamOwned::new(tls, tcp);
    let mut req = format!("wss://127.0.0.1:{port}/api/shells/{id}/ws")
        .into_client_request()
        .unwrap();
    if !cookie.is_empty() {
        req.headers_mut().insert("Cookie", cookie.parse().unwrap());
    }
    req.headers_mut().insert("Origin", origine.parse().unwrap());
    match tungstenite::client(req, flux) {
        Ok((ws, _)) => {
            ws.get_ref()
                .sock
                .set_read_timeout(Some(Duration::from_millis(100)))
                .unwrap();
            Ok(ws)
        }
        Err(tungstenite::HandshakeError::Failure(tungstenite::Error::Http(r))) => {
            Err(r.status().as_u16())
        }
        Err(e) => panic!("poignée de main : {e}"),
    }
}

fn ws(s: &Serveur, id: u32) -> Ws {
    essayer_ws(
        s.port,
        &s.cookie,
        &format!("https://127.0.0.1:{}", s.port),
        id,
    )
    .unwrap()
}

fn taper(ws: &mut Ws, texte: &str) {
    ws.send(Message::Binary(texte.as_bytes().to_vec().into()))
        .unwrap();
}

/// Un message reçu : `Some(Some(octets))`, `Some(None)` si la connexion est close, `None` si rien.
fn recevoir(ws: &mut Ws) -> Option<Option<Vec<u8>>> {
    match ws.read() {
        Ok(Message::Binary(b)) => Some(Some(b.to_vec())),
        Ok(Message::Close(_)) => Some(None),
        Ok(_) => None,
        Err(tungstenite::Error::Io(e))
            if matches!(
                e.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            ) =>
        {
            None
        }
        Err(_) => Some(None),
    }
}

/// Lit la sortie jusqu'à voir `motif`, et renvoie tout ce qui a été reçu.
fn lire_jusque(ws: &mut Ws, motif: &str, secondes: u64) -> String {
    let fin = Instant::now() + Duration::from_secs(secondes);
    let mut tout = Vec::new();
    while Instant::now() < fin {
        match recevoir(ws) {
            Some(Some(b)) => tout.extend(b),
            Some(None) => break,
            None => {}
        }
        if String::from_utf8_lossy(&tout).contains(motif) {
            return String::from_utf8_lossy(&tout).into_owned();
        }
    }
    let t = String::from_utf8_lossy(&tout).into_owned();
    panic!(
        "« {motif} » absent ; reçu (fin) : {}",
        &t[t.len().saturating_sub(300)..]
    );
}

fn attendre(secondes: u64, mut condition: impl FnMut() -> bool) -> bool {
    let fin = Instant::now() + Duration::from_secs(secondes);
    while Instant::now() < fin {
        if condition() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn vivant(pid: u32) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(s) => !s.rsplit(") ").next().unwrap_or("").starts_with('Z'),
        Err(_) => false,
    }
}

/// Code de la trame de fermeture reçue avant `secondes` : code et raison.
fn fermeture(ws: &mut Ws, secondes: u64) -> Option<(u16, String)> {
    let fin = Instant::now() + Duration::from_secs(secondes);
    while Instant::now() < fin {
        match ws.read() {
            Ok(Message::Close(Some(c))) => return Some((u16::from(c.code), c.reason.to_string())),
            Ok(Message::Close(None)) | Err(tungstenite::Error::ConnectionClosed) => return None,
            Err(tungstenite::Error::Io(e))
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => return None,
            _ => {}
        }
    }
    None
}

/// Dossier de `PATH` avec un faux `claude` ; renvoie le `PATH` et le fichier témoin.
/// Le faux écrit son pid, ses arguments et `pwd` dans le témoin, puis `exec /bin/sh`.
fn faux_claude(nom: &str) -> (String, PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let bin = dossier(&format!("bin-{nom}"));
    let temoin = bin.join("temoin");
    let script = format!(
        "#!/bin/sh\nif [ -n \"$CLAUDECODE\" ] || [ -n \"$CLAUDE_CODE_ENTRYPOINT\" ]; then\n  echo 'Error: Claude Code cannot be launched inside another Claude Code session.'\n  exit 1\nfi\n{{ echo \"pid=$$\"; echo \"args=$*\"; env; echo \"pwd=$(pwd)\"; }} > '{}'\nexec /bin/sh\n",
        temoin.display()
    );
    let f = bin.join("claude");
    std::fs::write(&f, script).unwrap();
    std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
    (format!("{}:/usr/bin:/bin", bin.display()), temoin)
}

fn lire_temoin(t: &PathBuf) -> String {
    assert!(attendre(10, || t.exists()
        && std::fs::read_to_string(t).unwrap().contains("pwd=")));
    std::fs::read_to_string(t).unwrap()
}

#[test]
fn req068_ac1_detection_selon_le_path() {
    let (path, _) = faux_claude("detection");
    let avec = lancer("det-avec", &path);
    let (code, corps) = http(avec.port, "GET", "/api/claude", &avec.cookie, "");
    assert_eq!((code, corps.as_str()), (200, "{\"disponible\":true}"));
    let sans = lancer("det-sans", "/usr/bin:/bin");
    let (code, corps) = http(sans.port, "GET", "/api/claude", &sans.cookie, "");
    assert_eq!((code, corps.as_str()), (200, "{\"disponible\":false}"));
}

#[test]
fn req068_ac3_commande_arguments_et_dossier_du_projet() {
    let (path, temoin) = faux_claude("args");
    let s = lancer("args", &path);
    let _id = ouvrir(&s);
    let t = lire_temoin(&temoin);
    assert!(t.contains("args=\n"), "{t}");
    assert!(t.contains(&format!("pwd={}\n", s.projet.display())), "{t}");
}

#[test]
fn req068_ac20_session_lancee_depuis_claude_code() {
    let (path, temoin) = faux_claude("imbrique");
    let s = lancer_avec_env(
        "imbrique",
        &path,
        &[
            ("CLAUDECODE", "1"),
            ("CLAUDE_CODE_ENTRYPOINT", "cli"),
            ("CLAUDE_CODE_SESSION_ID", "x"),
            ("CLAUDE_CODE_USE_BEDROCK", "1"),
        ],
    );
    let mut w = ws(&s, ouvrir(&s));
    taper(&mut w, "echo A$((20+22))B\n");
    let sortie = lire_jusque(&mut w, "A42B\r\n", 10);
    assert!(!sortie.contains("cannot be launched"), "{sortie}");
    let t = lire_temoin(&temoin);
    for v in [
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_SESSION_ATTENDED",
        "CLAUDE_CODE_MESSAGING_SOCKET",
        "CLAUDE_CODE_MESSAGING_TOKEN",
        "CLAUDE_CODE_EXECPATH",
        "CLAUDE_PID",
        "AI_AGENT",
    ] {
        assert!(
            !t.lines().any(|l| l.starts_with(&format!("{v}="))),
            "{v} : {t}"
        );
    }
    assert!(t.contains("\nCLAUDE_CODE_USE_BEDROCK=1\n"), "{t}");
    // Un shell du même Yaide garde les variables.
    let (code, corps) = http(s.port, "POST", "/api/shells", &s.cookie, "");
    assert_eq!(code, 201, "{corps}");
    let id: u32 = corps
        .trim_start_matches("{\"id\":")
        .trim_end_matches('}')
        .parse()
        .unwrap();
    let mut sh = ws(&s, id);
    taper(&mut sh, "echo V${CLAUDECODE}W\n");
    lire_jusque(&mut sh, "V1W\r\n", 10);
}

#[test]
fn req068_ac3_ce_qu_on_tape_arrive_et_la_sortie_revient() {
    let (path, _) = faux_claude("es");
    let s = lancer("es", &path);
    let mut w = ws(&s, ouvrir(&s));
    taper(&mut w, "echo A$((20+22))B\n");
    lire_jusque(&mut w, "A42B\r\n", 10);
}

#[test]
fn req068_ac4_hors_de_la_liste_des_shells() {
    let (path, _) = faux_claude("liste");
    let s = lancer("liste", &path);
    let id = ouvrir(&s);
    let l = liste(&s);
    assert!(l.contains("\"shells\":[]"), "{l}");
    let (code, _) = http(s.port, "POST", "/api/shells", &s.cookie, "");
    assert_eq!(code, 201);
    let l = liste(&s);
    assert!(l.contains(&format!("\"shells\":[{}]", id + 1)), "{l}");
}

#[test]
fn req068_ac7_continue_sans_client_et_affichage_rejoue() {
    let (path, _) = faux_claude("rejeu");
    let s = lancer("rejeu", &path);
    let id = ouvrir(&s);
    let mut w = ws(&s, id);
    taper(&mut w, "echo X$((1+1))Y\n");
    lire_jusque(&mut w, "X2Y\r\n", 10);
    drop(w);
    let mut w2 = ws(&s, id);
    lire_jusque(&mut w2, "X2Y\r\n", 10);
    taper(&mut w2, "echo Z$((2+2))Z\n");
    lire_jusque(&mut w2, "Z4Z\r\n", 10);
}

#[test]
fn req068_ac8_delete_arrete_le_processus() {
    let (path, temoin) = faux_claude("delete");
    let s = lancer("delete", &path);
    let id = ouvrir(&s);
    let mut w = ws(&s, id);
    let pid: u32 = lire_temoin(&temoin)
        .lines()
        .find_map(|l| l.strip_prefix("pid="))
        .unwrap()
        .parse()
        .unwrap();
    assert!(vivant(pid));
    let (code, _) = http(
        s.port,
        "DELETE",
        &format!("/api/shells/{id}"),
        &s.cookie,
        "",
    );
    assert_eq!(code, 204);
    assert_eq!(fermeture(&mut w, 10).map(|c| c.0), Some(1000));
    assert!(attendre(10, || !vivant(pid)), "claude tourne encore");
}

#[test]
fn req068_ac9_sigterm_arrete_claude() {
    let (path, temoin) = faux_claude("sigterm");
    let mut s = lancer("sigterm", &path);
    let mut w = ws(&s, ouvrir(&s));
    let pid: u32 = lire_temoin(&temoin)
        .lines()
        .find_map(|l| l.strip_prefix("pid="))
        .unwrap()
        .parse()
        .unwrap();
    let tue = Command::new("kill")
        .args(["-TERM", &s.child.id().to_string()])
        .status()
        .unwrap();
    assert!(tue.success());
    assert_eq!(fermeture(&mut w, 15).map(|c| c.0), Some(1001));
    assert!(attendre(15, || s.child.try_wait().unwrap().is_some()));
    assert!(attendre(5, || !vivant(pid)), "claude tourne encore");
}

#[test]
fn req068_ac10_ac15_code_de_sortie_dans_la_fermeture() {
    let (path, _) = faux_claude("code");
    let s = lancer("code", &path);
    let mut w = ws(&s, ouvrir(&s));
    taper(&mut w, "exit 1\n");
    assert_eq!(fermeture(&mut w, 10), Some((1000, "code=1".to_string())));
    let mut w = ws(&s, ouvrir(&s));
    taper(&mut w, "exit 0\n");
    assert_eq!(fermeture(&mut w, 10), Some((1000, "code=0".to_string())));
}

#[test]
fn req068_ac18_lancement_impossible_503_sans_session() {
    let s = lancer("impossible", "/usr/bin:/bin");
    let (code, corps) = http(s.port, "POST", "/api/claude", &s.cookie, "");
    assert_eq!(code, 503);
    assert!(!corps.is_empty());
    // Un faux `claude` sans droit d'exécution n'est pas une commande disponible.
    let bin = dossier("bin-nonexec");
    std::fs::write(bin.join("claude"), "#!/bin/sh\n").unwrap();
    let s = lancer("impossible2", &format!("{}:/usr/bin:/bin", bin.display()));
    let (code, _) = http(s.port, "POST", "/api/claude", &s.cookie, "");
    assert_eq!(code, 503);
    assert_eq!(
        essayer_ws(
            s.port,
            &s.cookie,
            &format!("https://127.0.0.1:{}", s.port),
            1
        )
        .err(),
        Some(404)
    );
}

#[test]
fn req068_ac11_refus_401_403_404() {
    let (path, _) = faux_claude("refus");
    let s = lancer("refus", &path);
    let id = ouvrir(&s);
    let bonne = format!("https://127.0.0.1:{}", s.port);
    assert_eq!(essayer_ws(s.port, "", &bonne, id).err(), Some(401));
    assert_eq!(
        essayer_ws(s.port, &s.cookie, "https://autre.example", id).err(),
        Some(403)
    );
    assert_eq!(
        essayer_ws(s.port, &s.cookie, &bonne, id + 50).err(),
        Some(404)
    );
    assert_eq!(http(s.port, "GET", "/api/claude", "", "").0, 401);
    assert_eq!(http(s.port, "POST", "/api/claude", "", "").0, 401);
    assert_eq!(
        http(s.port, "DELETE", &format!("/api/shells/{id}"), "", "").0,
        401
    );
    assert_eq!(
        http(
            s.port,
            "DELETE",
            &format!("/api/shells/{}", id + 50),
            &s.cookie,
            ""
        )
        .0,
        404
    );
    let sortie = Command::new("curl")
        .args(["-sk", "-o", "/dev/null", "-w", "%{http_code}", "-X", "POST"])
        .arg(format!("https://127.0.0.1:{}/api/claude", s.port))
        .args(["-H", "Origin: https://autre.example"])
        .args(["-H", &format!("Cookie: {}", s.cookie)])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&sortie.stdout), "403");
}

#[test]
fn req068_ac10_erreur_immediate_lisible() {
    use std::os::unix::fs::PermissionsExt;
    let bin = dossier("bin-erreur");
    let f = bin.join("claude");
    std::fs::write(&f, "#!/bin/sh\necho \"erreur: cle absente\"\nexit 1\n").unwrap();
    std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
    let s = lancer("erreur", &format!("{}:/usr/bin:/bin", bin.display()));
    let id = ouvrir(&s);
    std::thread::sleep(Duration::from_millis(800));
    let mut w = ws(&s, id);
    lire_jusque(&mut w, "erreur: cle absente", 10);
    assert_eq!(fermeture(&mut w, 10), Some((1000, "code=1".to_string())));
    let chemin = format!("/api/shells/{id}");
    assert_eq!(http(s.port, "DELETE", &chemin, &s.cookie, "").0, 204);
    let bonne = format!("https://127.0.0.1:{}", s.port);
    assert_eq!(essayer_ws(s.port, &s.cookie, &bonne, id).err(), Some(404));
}

/// Faux `claude` qui ignore HUP et TERM, lance un `sh` dans sa propre session (même idée que
/// les commandes de Claude Code) qui les ignore aussi, et note son pid et celui du détaché.
fn faux_claude_sourd(nom: &str) -> (String, PathBuf, PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let bin = dossier(&format!("bin-{nom}"));
    let temoin = bin.join("temoin");
    let detache = bin.join("detache");
    let script = format!(
        "#!/bin/sh\ntrap '' HUP TERM\nsetsid sh -c \"trap '' HUP TERM; echo \\$\\$ > '{d}'; while :; do sleep 1; done\" &\necho \"pid=$$\" > '{t}'\nwhile :; do sleep 1; done\n",
        d = detache.display(),
        t = temoin.display()
    );
    let f = bin.join("claude");
    std::fs::write(&f, script).unwrap();
    std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
    (format!("{}:/usr/bin:/bin", bin.display()), temoin, detache)
}

fn pid_du_fichier(f: &PathBuf, prefixe: &str) -> u32 {
    assert!(attendre(10, || std::fs::read_to_string(f).is_ok_and(|t| t
        .trim_start_matches(prefixe)
        .trim()
        .parse::<u32>()
        .is_ok())));
    std::fs::read_to_string(f)
        .unwrap()
        .trim_start_matches(prefixe)
        .trim()
        .parse()
        .unwrap()
}

/// Tue les PID connus à la fin du test, même si une assertion échoue avant.
struct TueursDePid(Vec<u32>);

impl Drop for TueursDePid {
    fn drop(&mut self) {
        for p in &self.0 {
            let _ = Command::new("kill").args(["-9", &p.to_string()]).status();
        }
    }
}

/// Signal à Yaide ; renvoie le pid de claude et celui du processus détaché, une fois Yaide parti.
fn arret_claude_sourd(nom: &str, signal: &str) -> (u32, u32) {
    let (path, temoin, detache) = faux_claude_sourd(nom);
    let mut s = lancer(nom, &path);
    let _w = ws(&s, ouvrir(&s));
    let claude = pid_du_fichier(&temoin, "pid=");
    let det = pid_du_fichier(&detache, "");
    let _tueurs = TueursDePid(vec![claude, det]);
    assert!(vivant(claude) && vivant(det));
    let r = Command::new("kill")
        .args([&format!("-{signal}"), &s.child.id().to_string()])
        .status()
        .unwrap();
    assert!(r.success());
    assert!(
        attendre(15, || s.child.try_wait().unwrap().is_some()),
        "Yaide ne quitte pas"
    );
    let (c, d) = (
        attendre(5, || !vivant(claude)),
        attendre(5, || !vivant(det)),
    );
    assert!(c, "claude tourne encore");
    assert!(d, "le processus détaché tourne encore");
    (claude, det)
}

#[test]
fn req073_ac1_sighup_arrete_claude() {
    arret_claude_sourd("hup", "HUP");
}

#[test]
fn req073_ac3_processus_detache_de_claude_arrete_sigterm() {
    arret_claude_sourd("det-term", "TERM");
}

#[test]
fn req073_ac3_processus_detache_de_claude_arrete_sigint() {
    arret_claude_sourd("det-int", "INT");
}

#[test]
fn req073_ac3_processus_detache_de_claude_arrete_sighup() {
    arret_claude_sourd("det-hup", "HUP");
}
