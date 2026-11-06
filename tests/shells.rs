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
    let d = std::env::temp_dir().join(format!("shells-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

/// Lance Yaide dans un dossier neuf. `shell` : valeur de `SHELL` (`None` : variable absente).
fn lancer(nom: &str, shell: Option<&str>) -> Serveur {
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
    match shell {
        Some(s) => cmd.env("SHELL", s),
        None => cmd.env_remove("SHELL"),
    };
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
    let (code, corps) = http(s.port, "POST", "/api/shells", &s.cookie, "");
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

/// Vrai si le serveur ferme la connexion avant `secondes`.
fn fermee_avant(ws: &mut Ws, secondes: u64) -> bool {
    let fin = Instant::now() + Duration::from_secs(secondes);
    while Instant::now() < fin {
        if let Some(None) = recevoir(ws) {
            return true;
        }
    }
    false
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

#[test]
fn req019_ac1_chaque_shell_a_sa_session() {
    let s = lancer("a1", Some("/bin/sh"));
    let (a, b) = (ouvrir(&s), ouvrir(&s));
    assert_ne!(a, b);
    let l = liste(&s);
    assert!(l.contains(&format!("[{a},{b}]")), "{l}");
    let mut wa = ws(&s, a);
    let mut wb = ws(&s, b);
    taper(&mut wa, "V=un; echo val_$V\n");
    lire_jusque(&mut wa, "val_un\r\n", 10);
    taper(&mut wb, "echo val_$V.\n");
    let sortie = lire_jusque(&mut wb, "val_.\r\n", 10);
    assert!(!sortie.contains("val_un"), "{sortie}");
}

#[test]
fn req019_ac1_shell_par_defaut_et_environnement() {
    let s = lancer("a1b", None);
    let mut w = ws(&s, ouvrir(&s));
    taper(&mut w, "echo t=$TERM s=$0\n");
    lire_jusque(&mut w, "t=xterm-256color s=/bin/sh\r\n", 10);
}

#[test]
fn req019_ac1_le_programme_est_shell() {
    let s = lancer("a1c", Some("/bin/bash"));
    let mut w = ws(&s, ouvrir(&s));
    taper(&mut w, "echo b=${BASH_VERSION:+oui}$((1+1))\n");
    lire_jusque(&mut w, "b=oui2\r\n", 10);
}

#[test]
fn req019_ac1_shell_impossible_a_lancer() {
    let s = lancer("a1d", Some("/introuvable/shell"));
    let (code, corps) = http(s.port, "POST", "/api/shells", &s.cookie, "");
    assert_eq!(code, 500);
    assert!(!corps.is_empty());
    assert_eq!(liste(&s).split("\"shells\":").nth(1).unwrap(), "[]}");
}

#[test]
fn req019_ac2_demarre_dans_le_projet_et_suit_la_taille() {
    let s = lancer("a2", Some("/bin/sh"));
    let mut w = ws(&s, ouvrir(&s));
    taper(&mut w, "pwd\n");
    lire_jusque(&mut w, &format!("{}\r\n", s.projet.display()), 10);
    taper(&mut w, "stty size\n");
    lire_jusque(&mut w, "24 80\r\n", 10);
    w.send(Message::Text("taille 100 30".into())).unwrap();
    taper(&mut w, "stty size\n");
    lire_jusque(&mut w, "30 100\r\n", 10);
    // Tailles invalides : ignorées, le shell continue.
    for t in ["taille 0 0", "taille x y", "taille 10", "bonjour"] {
        w.send(Message::Text(t.into())).unwrap();
    }
    taper(&mut w, "stty size; echo o$((1+1))k\n");
    let t = lire_jusque(&mut w, "o2k\r\n", 10);
    assert!(t.contains("30 100"), "{t}");
}

#[test]
fn req019_ac3_exit_retire_le_shell_et_ferme_la_connexion() {
    let s = lancer("a3", Some("/bin/sh"));
    let id = ouvrir(&s);
    let mut w = ws(&s, id);
    taper(&mut w, "exit\n");
    assert!(fermee_avant(&mut w, 10));
    assert!(attendre(5, || !liste(&s).contains(&format!("[{id}"))));
    let bonne = format!("https://127.0.0.1:{}", s.port);
    assert_eq!(essayer_ws(s.port, &s.cookie, &bonne, id).err(), Some(404));
}

#[test]
fn req020_ac1_ac2_le_shell_survit_a_la_deconnexion() {
    let s = lancer("v1", Some("/bin/sh"));
    let id = ouvrir(&s);
    let mut w = ws(&s, id);
    taper(&mut w, "sleep 2 && echo fini_$((20+1))\n");
    drop(w);
    std::thread::sleep(Duration::from_secs(3));
    assert!(liste(&s).contains(&format!("[{id}]")));
    let mut w = ws(&s, id);
    // L'affichage récent revient à la connexion, avec ce qui a été produit pendant l'absence.
    lire_jusque(&mut w, "fini_21\r\n", 10);
    taper(&mut w, "echo encore_$((1+1))\n");
    lire_jusque(&mut w, "encore_2\r\n", 10);
}

#[test]
fn req020_ac3_tampon_limite_a_1_mo_et_le_shell_continue() {
    let s = lancer("v3", Some("/bin/sh"));
    let id = ouvrir(&s);
    let mut w = ws(&s, id);
    taper(
        &mut w,
        "head -c 3000000 /dev/zero | tr '\\0' 'x'; echo FIN_$((1+1))\n",
    );
    lire_jusque(&mut w, "FIN_2\r\n", 30);
    drop(w);
    // Sans client, encore 2 Mo de sortie.
    let mut w = ws(&s, id);
    taper(&mut w, "echo sans_client\n");
    lire_jusque(&mut w, "sans_client\r\n", 10);
    drop(w);
    let mut w = ws(&s, id);
    taper(
        &mut w,
        "head -c 2000000 /dev/zero | tr '\\0' 'y'; echo FIN_$((2+2))\n",
    );
    // Fermer avec de la sortie non lue enverrait un RST et perdrait la commande.
    lire_jusque(&mut w, "echo FIN_$((2+2))\r\n", 10);
    drop(w);
    std::thread::sleep(Duration::from_secs(3));
    let mut w = ws(&s, id);
    let premier = loop {
        if let Some(Some(b)) = recevoir(&mut w) {
            break b;
        }
    };
    assert_eq!(premier.len(), 1024 * 1024);
    let t = String::from_utf8_lossy(&premier).into_owned();
    assert!(
        t.contains("FIN_4\r\n"),
        "la fin manque, {} octets : {:?}",
        t.len(),
        &t[t.len().saturating_sub(100)..]
    );
    taper(&mut w, "echo toujours_la_$((1+1))\n");
    lire_jusque(&mut w, "toujours_la_2\r\n", 10);
}

#[test]
fn un_client_lent_ne_bloque_ni_le_shell_ni_les_autres() {
    let s = lancer("lent", Some("/bin/sh"));
    let id = ouvrir(&s);
    let mut lent = ws(&s, id);
    let mut rapide = ws(&s, id);
    // `lent` ne lit jamais.
    taper(
        &mut rapide,
        "head -c 3000000 /dev/zero | tr '\\0' 'z'; echo FIN_$((3+3))\n",
    );
    lire_jusque(&mut rapide, "FIN_6\r\n", 40);
    taper(&mut rapide, "echo apres\n");
    lire_jusque(&mut rapide, "apres\r\n", 10);
    let mut neuf = ws(&s, id);
    taper(&mut neuf, "echo nouveau\n");
    lire_jusque(&mut neuf, "nouveau\r\n", 10);
    drop(lent.close(None));
}

#[test]
fn un_client_en_retard_est_coupe_sans_close_et_le_shell_reste() {
    let s = lancer("retard", Some("/bin/sh"));
    let id = ouvrir(&s);
    let mut lent = ws(&s, id);
    // `lent` ne lit rien pendant que le shell produit bien plus que les tampons.
    taper(
        &mut lent,
        "head -c 20000000 /dev/zero | tr '\\0' 'z'; echo FIN_$((4+4))\n",
    );
    std::thread::sleep(Duration::from_secs(5));
    let mut autre = ws(&s, id);
    lire_jusque(&mut autre, "FIN_8\r\n", 10);
    drop(autre);
    let mut close = false;
    let fin = Instant::now() + Duration::from_secs(30);
    while Instant::now() < fin {
        match lent.read() {
            Ok(Message::Close(_)) => {
                close = true;
                break;
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(e))
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => break,
        }
    }
    assert!(!close, "un client en retard ne doit pas recevoir de Close");
    assert!(liste(&s).contains(&format!("[{id}]")));
    let mut neuf = ws(&s, id);
    taper(&mut neuf, "echo vivant_$((1+1))\n");
    lire_jusque(&mut neuf, "vivant_2\r\n", 10);
}

#[test]
fn req021_identifiant_d_instance_stable_puis_change_au_redemarrage() {
    let s = lancer("inst", Some("/bin/sh"));
    let extraire = |l: String| l.split("\"instance\":\"").nth(1).unwrap()[..16].to_string();
    let a = extraire(liste(&s));
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(a, extraire(liste(&s)));
    let t = lancer("inst2", Some("/bin/sh"));
    assert_ne!(a, extraire(liste(&t)));
}

fn arret_propre(signal: &str) {
    let s = &mut lancer(&format!("arret-{signal}"), Some("/bin/bash"));
    let mut pids = Vec::new();
    for _ in 0..2 {
        let mut w = ws(s, ouvrir(s));
        taper(
            &mut w,
            "(trap '' HUP TERM; exec sleep 300) & echo P1=$$ P2=$! E$((1+1))\n",
        );
        let t = lire_jusque(&mut w, "E2\r\n", 10);
        let ligne = t
            .lines()
            .find(|l| l.starts_with("P1="))
            .unwrap()
            .to_string();
        for m in ligne.split_whitespace().take(2) {
            pids.push(m[3..].parse::<u32>().unwrap());
        }
        taper(&mut w, "sleep 301\n");
    }
    assert!(pids.iter().all(|&p| vivant(p)));
    let tue = Command::new("kill")
        .args([&format!("-{signal}"), &s.child.id().to_string()])
        .status()
        .unwrap();
    assert!(tue.success());
    let fin = attendre(15, || s.child.try_wait().unwrap().is_some());
    assert!(fin, "Yaide ne s'est pas arrêté");
    assert!(
        attendre(5, || pids.iter().all(|&p| !vivant(p))),
        "processus restants parmi {pids:?} : {:?}",
        pids.iter()
            .map(|p| std::fs::read_to_string(format!("/proc/{p}/stat")).unwrap_or_default())
            .collect::<Vec<_>>()
    );
}

/// Code de la trame de fermeture reçue avant `secondes`.
fn code_de_fermeture(ws: &mut Ws, secondes: u64) -> Option<u16> {
    let fin = Instant::now() + Duration::from_secs(secondes);
    while Instant::now() < fin {
        match ws.read() {
            Ok(Message::Close(Some(c))) => return Some(u16::from(c.code)),
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

#[test]
fn req021_ac2_la_connexion_se_ferme_en_1001_a_l_arret_et_en_1000_apres_exit() {
    let s = &mut lancer("code-arret", Some("/bin/sh"));
    let mut sorti = ws(s, ouvrir(s));
    taper(&mut sorti, "exit\n");
    assert_eq!(code_de_fermeture(&mut sorti, 10), Some(1000));
    let mut reste = ws(s, ouvrir(s));
    let tue = Command::new("kill")
        .args(["-TERM", &s.child.id().to_string()])
        .status()
        .unwrap();
    assert!(tue.success());
    assert_eq!(code_de_fermeture(&mut reste, 15), Some(1001));
}

#[test]
fn req021_ac1_sigterm_arrete_les_shells_et_leurs_processus() {
    arret_propre("TERM");
}

#[test]
fn req021_ac1_sigint_arrete_les_shells_et_leurs_processus() {
    arret_propre("INT");
}

#[test]
fn acces_refuses_sans_session_ou_avec_mauvaise_origine() {
    let s = lancer("acces", Some("/bin/sh"));
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
    assert_eq!(http(s.port, "GET", "/api/shells", "", "").0, 401);
    assert_eq!(http(s.port, "POST", "/api/shells", "", "").0, 401);
}

#[test]
fn req035_ac2_fermer_arrete_le_shell_et_ses_programmes() {
    let s = lancer("fermer", Some("/bin/bash"));
    let a = ouvrir(&s);
    let b = ouvrir(&s);
    let mut w = ws(&s, a);
    taper(&mut w, "sleep 300 & echo P=$! E$((1+1))\n");
    let t = lire_jusque(&mut w, "E2\r\n", 10);
    let sommeil: u32 = t
        .lines()
        .find(|l| l.starts_with("P="))
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()[2..]
        .parse()
        .unwrap();
    assert!(vivant(sommeil));
    let (code, _) = http(s.port, "DELETE", &format!("/api/shells/{a}"), &s.cookie, "");
    assert_eq!(code, 204);
    assert_eq!(code_de_fermeture(&mut w, 10), Some(1000));
    assert!(attendre(10, || !vivant(sommeil)), "sleep 300 tourne encore");
    let l = liste(&s);
    assert!(
        !l.contains(&format!("[{a}")) && l.contains(&b.to_string()),
        "{l}"
    );
}

#[test]
fn req035_ac2_fermer_tue_ce_qui_ignore_hup_et_term() {
    let s = lancer("fermer-dur", Some("/bin/bash"));
    let id = ouvrir(&s);
    let mut w = ws(&s, id);
    taper(
        &mut w,
        "(trap '' HUP TERM; exec sleep 300) & echo P2=$! E$((1+1))\n",
    );
    let t = lire_jusque(&mut w, "E2\r\n", 10);
    let pid: u32 = t
        .lines()
        .find(|l| l.starts_with("P2="))
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()[3..]
        .parse()
        .unwrap();
    assert!(vivant(pid));
    let debut = Instant::now();
    let (code, _) = http(
        s.port,
        "DELETE",
        &format!("/api/shells/{id}"),
        &s.cookie,
        "",
    );
    assert_eq!(code, 204);
    assert!(
        debut.elapsed() < Duration::from_secs(2),
        "la réponse attend"
    );
    assert!(attendre(10, || !vivant(pid)), "le programme résiste");
}

#[test]
fn req035_ac6_fermer_exige_session_origine_et_shell_connu() {
    let s = lancer("fermer-acces", Some("/bin/sh"));
    let id = ouvrir(&s);
    let chemin = format!("/api/shells/{id}");
    assert_eq!(http(s.port, "DELETE", &chemin, "", "").0, 401);
    let (code, _) = http(
        s.port,
        "DELETE",
        &format!("/api/shells/{}", id + 50),
        &s.cookie,
        "",
    );
    assert_eq!(code, 404);
    let sortie = Command::new("curl")
        .args([
            "-sk",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "-X",
            "DELETE",
        ])
        .arg(format!("https://127.0.0.1:{}{chemin}", s.port))
        .args(["-H", "Origin: https://autre.example"])
        .args(["-H", &format!("Cookie: {}", s.cookie)])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&sortie.stdout), "403");
    assert!(liste(&s).contains(&id.to_string()));
    assert_eq!(http(s.port, "DELETE", &chemin, &s.cookie, "").0, 204);
    assert_eq!(http(s.port, "DELETE", &chemin, &s.cookie, "").0, 404);
}
