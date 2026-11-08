#![allow(non_snake_case)]
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const EXE: &str = env!("CARGO_BIN_EXE_yaide");

struct Serveur {
    child: Child,
    port: u16,
    cookie: String,
    dir: PathBuf,
}

impl Serveur {
    fn temoin(&self) -> PathBuf {
        self.dir.join("temoin")
    }
    /// Une ligne JSON par lancement de `opencode serve`.
    fn lancements(&self) -> Vec<serde_json::Value> {
        std::fs::read_to_string(self.temoin())
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }
    fn mdp(&self) -> String {
        std::fs::read_to_string(self.dir.join("temoin.mdp")).unwrap()
    }
    fn projet(&self) -> PathBuf {
        self.dir.join("projet")
    }
}

impl Drop for Serveur {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        // Un faux opencode laissé en vie ne doit pas survivre au test.
        for l in self.lancements() {
            let pid = l["pid"].as_i64().unwrap_or(0);
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }
    }
}

fn port_libre() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Réponse HTTP : code, en-têtes et corps. `entetes` s'ajoute à la requête.
fn curl(
    port: u16,
    methode: &str,
    chemin: &str,
    entetes: &[String],
    corps: &str,
) -> (u16, String, String) {
    let mut cmd = Command::new("curl");
    cmd.args(["-sk", "-i", "--max-time", "20", "-X", methode])
        .arg(format!("https://127.0.0.1:{port}{chemin}"));
    for e in entetes {
        cmd.args(["-H", e]);
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
    let (tete, corps) = texte.split_once("\r\n\r\n").unwrap_or((&texte, ""));
    (code, tete.to_string(), corps.to_string())
}

fn entetes_session(s: &Serveur) -> Vec<String> {
    vec![
        format!("Cookie: {}", s.cookie),
        format!("Origin: https://127.0.0.1:{}", s.port),
    ]
}

fn http(s: &Serveur, methode: &str, chemin: &str, corps: &str) -> (u16, String, String) {
    curl(s.port, methode, chemin, &entetes_session(s), corps)
}

fn cookie_de(port: u16) -> String {
    let (_, tete, _) = curl(
        port,
        "POST",
        "/api/connexion",
        &[format!("Origin: https://127.0.0.1:{port}")],
        "mdp",
    );
    let ligne = tete
        .lines()
        .find(|l| l.to_lowercase().starts_with("set-cookie:"))
        .expect("pas de Set-Cookie");
    ligne[11..].trim().split(';').next().unwrap().to_string()
}

fn node() -> PathBuf {
    std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|d| d.join("node"))
        .find(|c| c.is_file())
        .expect("node introuvable")
}

fn ecrire_script(dir: &Path, contenu: &str) {
    use std::os::unix::fs::PermissionsExt;
    let f = dir.join("bin/opencode");
    std::fs::create_dir_all(dir.join("bin")).unwrap();
    std::fs::write(&f, contenu).unwrap();
    std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// Le script `opencode` du faux : `node faux-opencode.mjs`.
fn script_faux() -> String {
    let faux = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/faux-opencode.mjs");
    format!(
        "#!/bin/sh\nexec '{}' '{}' \"$@\"\n",
        node().display(),
        faux.display()
    )
}

/// Lance Yaide avec un faux `opencode` en tête d'un `PATH` maîtrisé.
fn lancer(nom: &str, env: &[(&str, &str)]) -> Serveur {
    let d = std::env::temp_dir().join(format!("opencode-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(d.join("projet")).unwrap();
    let d = d.canonicalize().unwrap();
    ecrire_script(&d, &script_faux());
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
    let port = port_libre();
    let journal = std::fs::File::create(d.join("yaide.log")).unwrap();
    let child = Command::new(EXE)
        .arg(d.join("projet"))
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", &cfg)
        .env("HOME", &d)
        .env("PATH", format!("{}:/usr/bin:/bin", d.join("bin").display()))
        .env("FAUX_OPENCODE_TEMOIN", d.join("temoin"))
        .envs(env.iter().copied())
        .stdout(Stdio::null())
        .stderr(journal)
        .spawn()
        .unwrap();
    let mut s = Serveur {
        child,
        port,
        cookie: String::new(),
        dir: d,
    };
    for _ in 0..1000 {
        if curl(port, "GET", "/api/info", &[], "").0 == 200 {
            s.cookie = cookie_de(port);
            return s;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("le serveur ne répond pas");
}

fn vivant(pid: i64) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => stat
            .rsplit_once(')')
            .is_some_and(|(_, r)| !r.trim_start().starts_with('Z')),
        Err(_) => false,
    }
}

fn attendre(mut condition: impl FnMut() -> bool, secondes: u64) -> bool {
    let fin = Instant::now() + Duration::from_secs(secondes);
    while Instant::now() < fin {
        if condition() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

#[test]
fn REQ072_AC1_detection_v2_v1_absent_illisible() {
    let s = lancer("detection", &[]);
    let disponible = |s: &Serveur| {
        let (code, _, corps) = http(s, "GET", "/api/opencode", "");
        assert_eq!(code, 200);
        corps
    };
    assert_eq!(disponible(&s), "{\"disponible\":true}");
    for (sortie, attendu) in [
        ("echo 2.0.1", true),
        ("echo opencode v1.14.0", false),
        ("echo 1.14.0", false),
        ("echo bonjour", false),
        ("echo 'opencode v2.x'", false),
        ("exit 3", false),
        ("exec sleep 30", false),
    ] {
        ecrire_script(&s.dir, &format!("#!/bin/sh\n{sortie}\n"));
        assert_eq!(
            disponible(&s),
            format!("{{\"disponible\":{attendu}}}"),
            "{sortie}"
        );
    }
    std::fs::remove_file(s.dir.join("bin/opencode")).unwrap();
    assert_eq!(disponible(&s), "{\"disponible\":false}");
}

#[test]
fn REQ072_AC2_serve_arguments_dossier_et_mot_de_passe() {
    let s = lancer("serve", &[]);
    assert!(
        s.lancements().is_empty(),
        "rien n'est lancé avant le besoin"
    );
    let (code, _, _) = http(&s, "GET", "/api/opencode/api/info", "");
    assert_eq!(code, 200);
    // Un autre navigateur : nouvelle session, même serveur.
    let autre = cookie_de(s.port);
    let (code, _, _) = curl(
        s.port,
        "GET",
        "/api/opencode/api/info",
        &[format!("Cookie: {autre}")],
        "",
    );
    assert_eq!(code, 200);
    let l = s.lancements();
    assert_eq!(l.len(), 1, "un seul serveur opencode");
    let args: Vec<&str> = l[0]["args"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap())
        .collect();
    assert_eq!(&args[..4], ["serve", "--hostname", "127.0.0.1", "--port"]);
    let port: u16 = args[4].parse().unwrap();
    assert_ne!(port, s.port);
    assert_eq!(args.len(), 5);
    assert_eq!(Path::new(l[0]["cwd"].as_str().unwrap()), s.projet());
    assert_eq!(l[0]["mdp"], true);
    // Le mot de passe protège le serveur : 32 octets en base64url, refus sans lui.
    let mdp = s.mdp();
    assert_eq!(mdp.len(), 43);
    let direct = |auth: &[&str]| {
        let mut cmd = Command::new("curl");
        cmd.args(["-s", "-o", "/dev/null", "-w", "%{http_code}"]);
        cmd.args(auth);
        cmd.arg(format!("http://127.0.0.1:{port}/api/info"));
        String::from_utf8(cmd.output().unwrap().stdout).unwrap()
    };
    assert_eq!(direct(&[]), "401");
    assert_eq!(direct(&["-u", &format!("opencode:{mdp}")]), "200");
}

#[test]
fn REQ072_AC2_un_seul_serveur_pour_deux_demandes_simultanees() {
    let s = lancer("simultane", &[]);
    let (a, b) = std::thread::scope(|sc| {
        let a = sc.spawn(|| http(&s, "GET", "/api/opencode/api/info", "").0);
        let b = sc.spawn(|| http(&s, "GET", "/api/opencode/api/info", "").0);
        (a.join().unwrap(), b.join().unwrap())
    });
    assert_eq!((a, b), (200, 200));
    assert_eq!(s.lancements().len(), 1);
}

#[test]
fn REQ072_AC2_sigterm_arrete_le_serveur_opencode() {
    let mut s = lancer("sigterm", &[]);
    assert_eq!(http(&s, "GET", "/api/opencode/api/info", "").0, 200);
    let pid = s.lancements()[0]["pid"].as_i64().unwrap();
    assert!(vivant(pid));
    let _ = Command::new("kill")
        .args(["-TERM", &s.child.id().to_string()])
        .output();
    assert!(
        attendre(|| s.child.try_wait().unwrap().is_some(), 10),
        "Yaide s'arrête"
    );
    assert!(attendre(|| !vivant(pid), 5), "le serveur opencode s'arrête");
}

#[test]
fn REQ072_relais_methode_chemin_requete_et_corps() {
    let s = lancer("relais", &[]);
    for methode in ["POST", "PUT", "DELETE", "PATCH"] {
        let (code, tete, corps) = curl(
            s.port,
            methode,
            "/api/opencode/api/echo?a=1&b=x%20y",
            &[
                entetes_session(&s)[0].clone(),
                entetes_session(&s)[1].clone(),
                "Content-Type: application/json".into(),
                "X-Secret: non".into(),
            ],
            "{\"k\":\"v\"}",
        );
        assert_eq!(code, 200, "{methode}");
        assert!(tete
            .to_lowercase()
            .contains("content-type: application/json"));
        let v: serde_json::Value = serde_json::from_str(&corps).unwrap();
        assert_eq!(v["methode"], methode);
        assert_eq!(v["url"], "/api/echo?a=1&b=x%20y");
        assert_eq!(v["type"], "application/json");
        assert_eq!(v["corps"], "{\"k\":\"v\"}");
        assert!(v["secret"].is_null(), "les autres en-têtes ne passent pas");
    }
    let (code, _, corps) = curl(
        s.port,
        "POST",
        "/api/opencode/api/session",
        &[
            entetes_session(&s)[0].clone(),
            entetes_session(&s)[1].clone(),
            "Content-Type: application/json".into(),
        ],
        "{\"location\":{\"directory\":\"/p\"}}",
    );
    assert_eq!(code, 200);
    assert_eq!(corps, "{\"location\":{\"directory\":\"/p\"}}");
    // Le statut d'opencode est rendu tel quel, et rien d'autre que /api/... n'est relayé.
    assert_eq!(http(&s, "GET", "/api/opencode/api/inconnue", "").0, 404);
    assert_eq!(http(&s, "GET", "/api/opencode/global/health", "").0, 404);
    // Chemin brut : `..` encodé refusé, `%2F` et `%3F` transmis tels quels.
    let brut = |chemin: &str| {
        let sortie = Command::new("curl")
            .args(["-sk", "--path-as-is", "-w", "\n%{http_code}"])
            .arg(format!("https://127.0.0.1:{}{chemin}", s.port))
            .args(["-H", &entetes_session(&s)[0]])
            .output()
            .unwrap();
        let t = String::from_utf8(sortie.stdout).unwrap();
        let (corps, code) = t.rsplit_once('\n').unwrap();
        (code.to_string(), corps.to_string())
    };
    assert_eq!(brut("/api/opencode/api/%2e%2e/global/health").0, "404");
    assert_eq!(brut("/api/opencode/api/%2E%2E/global/health").0, "404");
    assert_eq!(brut("/api/opencode/api/../global/health").0, "404");
    assert_eq!(
        brut("/api/opencode/api/echo/a%2Fb%3Fc"),
        ("200".into(), "/api/echo/a%2Fb%3Fc".into())
    );
    assert_eq!(s.lancements().len(), 1);
}

#[test]
fn REQ072_relais_flux_d_evenements_sans_tampon() {
    let s = lancer("flux", &[]);
    let debut = Instant::now();
    let mut curl = Command::new("curl")
        .args(["-skN", "--max-time", "15"])
        .arg(format!(
            "https://127.0.0.1:{}/api/opencode/api/event",
            s.port
        ))
        .args(["-H", &format!("Cookie: {}", s.cookie)])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut lecteur = BufReader::new(curl.stdout.take().unwrap());
    let mut ligne = String::new();
    lecteur.read_line(&mut ligne).unwrap();
    let premier = debut.elapsed();
    assert_eq!(ligne.trim(), "data: {\"n\":1}");
    // Le second événement vient une seconde après le premier, que le relais ne doit pas retenir.
    ligne.clear();
    let avant_second = Instant::now();
    lecteur.read_line(&mut ligne).unwrap();
    lecteur.read_line(&mut ligne).unwrap();
    assert!(ligne.contains("{\"n\":2}"), "{ligne}");
    assert!(
        avant_second.elapsed() >= Duration::from_millis(800),
        "le second événement n'est pas arrivé avec le premier ({premier:?})"
    );
    let _ = curl.kill();
    let _ = curl.wait();
}

#[test]
fn REQ072_AC13_lancement_impossible_503_avec_raison() {
    let s = lancer("echec", &[("FAUX_OPENCODE_ECHEC", "1")]);
    let debut = Instant::now();
    let (code, _, corps) = http(&s, "GET", "/api/opencode/api/info", "");
    assert_eq!(code, 503);
    assert_eq!(corps, "Erreur : opencode ne peut pas démarrer");
    assert!(
        debut.elapsed() < Duration::from_secs(10),
        "le processus mort est vu tout de suite"
    );
    // Sans exécutable : la raison par défaut.
    std::fs::remove_file(s.dir.join("bin/opencode")).unwrap();
    let (code, _, corps) = http(&s, "GET", "/api/opencode/api/info", "");
    assert_eq!(code, 503);
    assert_eq!(corps, "le serveur opencode ne répond pas");
}

#[test]
fn REQ072_AC13_serveur_mort_relance_a_la_requete_suivante() {
    let s = lancer("relance", &[]);
    assert_eq!(http(&s, "GET", "/api/opencode/api/info", "").0, 200);
    let pid = s.lancements()[0]["pid"].as_i64().unwrap();
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
    assert!(attendre(|| !vivant(pid), 5));
    assert_eq!(http(&s, "GET", "/api/opencode/api/info", "").0, 200);
    let l = s.lancements();
    assert_eq!(l.len(), 2, "un nouveau serveur");
    assert_ne!(l[1]["pid"], l[0]["pid"]);
}

#[test]
fn REQ072_AC14_refus_401_403_et_mot_de_passe_absent_des_reponses() {
    let s = lancer("acces", &[]);
    let origine = format!("Origin: https://127.0.0.1:{}", s.port);
    let cookie = format!("Cookie: {}", s.cookie);
    let mut vu = String::new();
    let mut noter = |r: (u16, String, String)| {
        vu.push_str(&r.1);
        vu.push_str(&r.2);
        r.0
    };
    // 401 sans session, quelle que soit la méthode ; rien n'est lancé.
    for (m, c) in [
        ("GET", "/api/opencode/api/info"),
        ("POST", "/api/opencode/api/session"),
        ("GET", "/api/opencode"),
        ("GET", "/api/opencode/api/event"),
    ] {
        assert_eq!(
            noter(curl(s.port, m, c, std::slice::from_ref(&origine), "")),
            401,
            "{m} {c}"
        );
    }
    assert!(s.lancements().is_empty());
    // 403 : écriture sans Origin ou avec une autre ; GET d'une autre origine.
    for e in [
        vec![cookie.clone()],
        vec![cookie.clone(), "Origin: https://evil.example".into()],
    ] {
        assert_eq!(
            noter(curl(s.port, "POST", "/api/opencode/api/session", &e, "{}")),
            403
        );
    }
    assert_eq!(
        noter(curl(
            s.port,
            "GET",
            "/api/opencode/api/info",
            &[cookie.clone(), "Origin: https://evil.example".into()],
            ""
        )),
        403
    );
    assert!(s.lancements().is_empty());
    // Un GET sans Origin (EventSource de même origine) et les écritures valides passent.
    assert_eq!(
        noter(curl(
            s.port,
            "GET",
            "/api/opencode/api/info",
            std::slice::from_ref(&cookie),
            ""
        )),
        200
    );
    assert_eq!(
        noter(curl(
            s.port,
            "GET",
            "/api/opencode/api/info",
            &[cookie.clone(), origine.clone()],
            ""
        )),
        200
    );
    assert_eq!(
        noter(curl(
            s.port,
            "POST",
            "/api/opencode/api/session",
            &[cookie, origine],
            "{}"
        )),
        200
    );
    // Le mot de passe d'opencode n'est ni dans une réponse, ni dans le journal.
    let mdp = s.mdp();
    assert!(!mdp.is_empty());
    assert!(!vu.contains(&mdp));
    let journal = std::fs::read_to_string(s.dir.join("yaide.log")).unwrap();
    assert!(!journal.contains(&mdp));
}

#[test]
fn REQ072_AC14_ecoute_sur_127_0_0_1() {
    let s = lancer("ecoute", &[]);
    assert_eq!(http(&s, "GET", "/api/opencode/api/info", "").0, 200);
    let port: u16 = s.lancements()[0]["args"][4]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let tcp = std::fs::read_to_string("/proc/net/tcp").unwrap();
    let ecoute: Vec<&str> = tcp
        .lines()
        .skip(1)
        .filter_map(|l| {
            let c: Vec<&str> = l.split_whitespace().collect();
            let (adr, p) = c[1].split_once(':')?;
            (c[3] == "0A" && u16::from_str_radix(p, 16).ok()? == port).then_some(adr)
        })
        .collect();
    assert_eq!(ecoute, ["0100007F"], "à l'écoute sur 127.0.0.1 seulement");
}
