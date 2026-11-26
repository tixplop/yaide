use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

const EXE: &str = env!("CARGO_BIN_EXE_yaide");

struct Serveur {
    child: Child,
    port: u16,
    cookie: String,
    cfg: PathBuf,
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

fn requete(
    port: u16,
    methode: &str,
    chemin: &str,
    cookie: &str,
    origine: &str,
    corps: &str,
) -> (u16, String) {
    let mut cmd = Command::new("curl");
    cmd.args(["-sk", "-i", "--max-time", "10", "-X", methode])
        .arg(format!("https://127.0.0.1:{port}{chemin}"));
    if !origine.is_empty() {
        cmd.args(["-H", &format!("Origin: {origine}")]);
    }
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
    let d = std::env::temp_dir().join(format!("journal-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

/// Une instance dont le dossier de configuration est `cfg` ; `projet` est son projet.
fn lancer_dans(cfg: &Path, projet: PathBuf) -> Serveur {
    lancer_avec(cfg, projet, &[], Stdio::inherit())
}

/// Comme `lancer_dans`, avec des variables d'environnement et la sortie d'erreur donnée.
fn lancer_avec(cfg: &Path, projet: PathBuf, env: &[(&str, &str)], stderr: Stdio) -> Serveur {
    std::fs::create_dir_all(&projet).unwrap();
    if !cfg.join("yaide").exists() {
        definir_mot_de_passe(cfg, &projet);
    }
    let port = port_libre();
    let child = Command::new(EXE)
        .arg(&projet)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", cfg)
        .env("HOME", projet.parent().unwrap())
        .envs(env.iter().copied())
        .stdout(Stdio::null())
        .stderr(stderr)
        .spawn()
        .unwrap();
    let mut s = Serveur {
        child,
        port,
        cookie: String::new(),
        cfg: cfg.to_path_buf(),
    };
    for _ in 0..1000 {
        if requete(port, "GET", "/api/info", "", "", "").0 == 200 {
            s.cookie = cookie_de(port);
            return s;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("le serveur ne répond pas");
}

fn definir_mot_de_passe(cfg: &Path, projet: &Path) {
    let mut c = Command::new(EXE)
        .arg("passwd")
        .env("XDG_CONFIG_HOME", cfg)
        .env("HOME", projet.parent().unwrap())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    std::io::Write::write_all(&mut c.stdin.take().unwrap(), b"mdp\n").unwrap();
    assert!(c.wait().unwrap().success());
}

fn lancer(nom: &str) -> Serveur {
    let d = dossier(nom);
    lancer_dans(&d.join("cfg"), d.join("projet"))
}

impl Serveur {
    fn api(&self, methode: &str, chemin: &str, corps: &str) -> (u16, serde_json::Value) {
        let o = format!("https://127.0.0.1:{}", self.port);
        let (c, t) = requete(self.port, methode, chemin, &self.cookie, &o, corps);
        (
            c,
            serde_json::from_str(&t).unwrap_or(serde_json::Value::String(t)),
        )
    }
    fn lignes(&self) -> Vec<serde_json::Value> {
        self.api("GET", "/api/journal", "").1["lignes"]
            .as_array()
            .unwrap()
            .clone()
    }
    fn messages(&self) -> Vec<String> {
        self.lignes()
            .iter()
            .map(|l| l["message"].as_str().unwrap().to_string())
            .collect()
    }
}

#[test]
fn req186_ac7_ac9_demarrage_ecrit_la_ligne_version_et_adresse_puis_un_redemarrage_vide_le_journal()
{
    let d = dossier("ac7");
    let s = lancer_dans(&d.join("cfg"), d.join("projet"));
    let l = s.lignes();
    assert_eq!(l.len(), 1, "{l:?}");
    assert_eq!(l[0]["severite"], "Information");
    assert_eq!(
        l[0]["message"],
        format!(
            "Yaide v{} démarré sur https://localhost:{}.",
            env!("CARGO_PKG_VERSION"),
            s.port
        )
    );
    let (c, _) = s.api(
        "POST",
        "/api/journal",
        r#"{"lignes":[{"severite":"Erreur","message":"avant le redémarrage"}]}"#,
    );
    assert_eq!(c, 200);
    assert!(s.messages().contains(&"avant le redémarrage".to_string()));
    drop(s);
    let s2 = lancer_dans(&d.join("cfg"), d.join("projet"));
    let m = s2.messages();
    assert_eq!(m.len(), 1, "{m:?}");
    assert!(m[0].starts_with("Yaide v"));
}

#[test]
fn req186_ac5_ac9_une_reponse_500_ecrit_methode_route_et_message_404_et_409_rien() {
    let s = lancer("ac5");
    let fichier = s.cfg.join("yaide/environnements.json");
    std::fs::create_dir_all(&fichier).unwrap(); // lecture impossible : 500
    let (c, _) = s.api("GET", "/api/environnements", "");
    assert_eq!(c, 500);
    let l = s.lignes();
    assert_eq!(l.len(), 2, "{l:?}");
    assert_eq!(l[1]["severite"], "Erreur");
    let m = l[1]["message"].as_str().unwrap();
    assert!(
        m.starts_with("GET /api/environnements a répondu 500 : Impossible de lire "),
        "{m}"
    );
    assert!(m.ends_with('.') && !m.ends_with(".."), "{m}");
    // 404 puis 409 : aucune ligne de plus.
    assert_eq!(s.api("GET", "/api/inconnue", "").0, 404);
    std::fs::remove_dir_all(&fichier).unwrap();
    std::fs::write(&fichier, "pas du json").unwrap();
    assert_eq!(s.api("GET", "/api/environnements", "").0, 409);
    assert_eq!(s.lignes().len(), 2);
}

#[test]
fn req186_routes_ecrire_avec_heure_lire_apres_et_purger() {
    let s = lancer("routes");
    let (c, _) = s.api(
        "POST",
        "/api/journal",
        r#"{"lignes":[{"heure":1234,"severite":"Avertissement","message":"m","detail":"d"}]}"#,
    );
    assert_eq!(c, 200);
    let l = s.lignes();
    assert_eq!(l[1]["heure"], 1234);
    assert_eq!(l[1]["detail"], "d");
    let n = l[1]["numero"].as_u64().unwrap();
    let (_, v) = s.api("GET", &format!("/api/journal?apres={n}"), "");
    assert_eq!(v["lignes"].as_array().unwrap().len(), 0);
    assert_eq!(
        s.api(
            "POST",
            "/api/journal",
            r#"{"lignes":[{"severite":"Grave","message":"x"}]}"#
        )
        .0,
        400
    );
    let avant = s.api("GET", "/api/journal", "").1["purge"].clone();
    assert_eq!(s.api("DELETE", "/api/journal", "").0, 200);
    let (_, v) = s.api("GET", "/api/journal", "");
    assert_eq!(v["lignes"].as_array().unwrap().len(), 0);
    assert_ne!(v["purge"], avant);
}

#[test]
fn req186_ac7_integration_au_shell_impossible_avertissement_et_meme_texte_sur_la_sortie_d_erreur() {
    if !Path::new("/bin/bash").exists() {
        eprintln!("bash absent de la machine : test sauté");
        return;
    }
    let d = dossier("ac7-shell");
    let cfg = d.join("cfg");
    let sortie = d.join("stderr.log");
    let s = lancer_avec(
        &cfg,
        d.join("projet"),
        &[("SHELL", "/bin/bash")],
        Stdio::from(std::fs::File::create(&sortie).unwrap()),
    );
    // Un fichier à la place du dossier d'intégration : sa création échoue.
    std::fs::write(s.cfg.join("yaide/integration-shell"), "").unwrap();
    let (c, _) = s.api("POST", "/api/shells", "{}");
    assert_eq!(c, 201);
    let l = s.lignes();
    let ligne = l
        .iter()
        .find(|l| l["severite"] == "Avertissement")
        .unwrap_or_else(|| panic!("{l:?}"));
    let m = ligne["message"].as_str().unwrap();
    assert!(m.starts_with("Intégration au shell impossible : "), "{m}");
    let erreur = std::fs::read_to_string(&sortie).unwrap();
    assert!(erreur.lines().any(|x| x == m), "{erreur} / {m}");
}
