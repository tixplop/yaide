use serde_json::{json, Value};
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
    corps: String,
}

impl Rep {
    fn json(&self) -> Value {
        serde_json::from_str(&self.corps).unwrap_or_else(|_| panic!("pas du JSON : {}", self.corps))
    }
}

fn port_libre() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

struct RepBrute {
    code: u16,
    entetes: String,
    corps: String,
}

fn requete(
    port: u16,
    methode: &str,
    chemin: &str,
    cookie: &str,
    origine: &str,
    corps: &[u8],
) -> RepBrute {
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
    RepBrute {
        code,
        entetes,
        corps,
    }
}

impl Serveur {
    fn appel(&self, methode: &str, chemin: &str, corps: &Value) -> Rep {
        let origine = format!("https://127.0.0.1:{}", self.port);
        let corps = if corps.is_null() {
            String::new()
        } else {
            corps.to_string()
        };
        let r = requete(
            self.port,
            methode,
            chemin,
            &self.cookie,
            &origine,
            corps.as_bytes(),
        );
        Rep {
            code: r.code,
            corps: r.corps,
        }
    }
    fn reglages(&self) -> Value {
        let r = self.appel("GET", "/api/agent/reglages", &Value::Null);
        assert_eq!(r.code, 200, "{}", r.corps);
        r.json()
    }
    fn yaide(&self) -> PathBuf {
        self.projet.join(".yaide")
    }
    fn cfg(&self) -> PathBuf {
        self.racine.join("cfg").join("yaide")
    }
}

/// Dossier de test avec mot de passe défini ; renvoie la racine.
fn preparer(nom: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("agent-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    let d = d.canonicalize().unwrap();
    let mut c = Command::new(EXE)
        .arg("passwd")
        .env("XDG_CONFIG_HOME", d.join("cfg"))
        .env("HOME", &d)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    c.stdin.take().unwrap().write_all(b"mdp\n").unwrap();
    assert!(c.wait().unwrap().success());
    d
}

/// Lance Yaide sur `racine/<projet>` (le dossier est créé s'il manque).
fn demarrer(racine: &Path, projet: &str) -> Serveur {
    let projet = racine.join(projet);
    std::fs::create_dir_all(&projet).unwrap();
    let port = port_libre();
    let child = Command::new(EXE)
        .arg(&projet)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", racine.join("cfg"))
        .env("HOME", racine)
        .env("GIT_CEILING_DIRECTORIES", racine)
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let mut s = Serveur {
        child,
        port,
        cookie: String::new(),
        projet,
        racine: racine.to_path_buf(),
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

fn lancer(nom: &str) -> Serveur {
    demarrer(&preparer(nom), "projet")
}

/// Arrête l'instance et en relance une sur le même projet.
fn redemarrer(s: Serveur) -> Serveur {
    let racine = s.racine.clone();
    let nom = s.projet.file_name().unwrap().to_owned();
    drop(s);
    demarrer(&racine, nom.to_str().unwrap())
}

fn profil(nom: &str) -> Value {
    json!({ "nom": nom, "provider": "openai", "modele": "gpt-x", "sortieMax": 2000,
            "temperature": 0.5, "effort": "moyen" })
}

#[test]
fn req051_ac1_lancer_et_lire_les_reglages_ne_cree_pas_yaide() {
    let s = lancer("ac1");
    let v = s.reglages();
    assert_eq!(v["profils"], json!([]));
    assert!(v["erreur"].is_null());
    assert!(!s.yaide().exists());
    assert!(!s.cfg().join("cle-secrets").exists());
}

#[test]
fn req051_ac2_ac3_profil_enregistre_dans_son_projet() {
    let racine = preparer("ac2");
    let a = demarrer(&racine, "a");
    let b = demarrer(&racine, "b");
    let r = a.appel("PUT", "/api/agent/profils", &profil("rapide"));
    assert_eq!(r.code, 200, "{}", r.corps);
    let enregistre = std::fs::read_to_string(a.yaide().join("config.json")).unwrap();
    assert!(enregistre.contains("rapide"));
    assert_eq!(a.reglages()["profils"][0]["nom"], "rapide");
    assert_eq!(b.reglages()["profils"], json!([]));
    assert!(!b.yaide().exists());
    b.appel("PUT", "/api/agent/profils", &profil("autre"));
    assert_eq!(b.reglages()["profils"].as_array().unwrap().len(), 1);
    assert_eq!(a.reglages()["profils"][0]["nom"], "rapide");
}

#[test]
fn req052_ac1_ac3_six_providers_sans_aucune_cle_dans_les_reponses() {
    let s = lancer("ac13");
    let v = s.reglages();
    let ids: Vec<&str> = v["providers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        [
            "openai",
            "anthropic",
            "google",
            "openrouter",
            "litellm",
            "ollama"
        ]
    );
    assert_eq!(v["providers"][0]["nom"], "OpenAI");
    assert_eq!(v["providers"][0]["adresse"], "https://api.openai.com/v1");
    assert_eq!(v["providers"][0]["cleObligatoire"], true);
    assert_eq!(v["providers"][5]["cleObligatoire"], false);
    assert!(v["providers"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["cle"] == false));

    let secrete = "sk-ultra-secrete-123";
    let r = s.appel(
        "PUT",
        "/api/agent/providers/openai",
        &json!({ "adresse": "https://api.openai.com/v1", "cle": secrete }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(!r.corps.contains(secrete));
    assert_eq!(r.json()["providers"][0]["cle"], true);
    let g = s.appel("GET", "/api/agent/reglages", &Value::Null);
    assert!(!g.corps.contains(secrete));
    assert_eq!(g.json()["providers"][0]["cle"], true);

    let secrets = std::fs::read(s.yaide().join("secrets")).unwrap();
    assert!(!String::from_utf8_lossy(&secrets).contains(secrete));
    let config = std::fs::read_to_string(s.yaide().join("config.json")).unwrap();
    assert!(!config.contains(secrete));
    for f in [s.yaide().join("secrets"), s.cfg().join("cle-secrets")] {
        assert_eq!(
            std::fs::metadata(f).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn req052_ac5_adresse_refusee_rien_enregistre() {
    let s = lancer("ac5");
    let r = s.appel(
        "PUT",
        "/api/agent/providers/openai",
        &json!({ "adresse": "localhost:4000", "cle": "sk-x" }),
    );
    assert_eq!(r.code, 400);
    assert_eq!(r.json(), json!({ "champ": "adresse" }));
    assert!(!s.yaide().exists());
    assert!(!s.cfg().join("cle-secrets").exists());
    let v = s.reglages();
    assert_eq!(v["providers"][0]["adresse"], "https://api.openai.com/v1");
    assert_eq!(v["providers"][0]["cle"], false);
    let ok = s.appel(
        "PUT",
        "/api/agent/providers/litellm",
        &json!({ "adresse": "http://machine:4000" }),
    );
    assert_eq!(ok.code, 200);
    assert_eq!(
        s.reglages()["providers"][4]["adresse"],
        "http://machine:4000"
    );
}

#[test]
fn req052_ac4_ac6_supprimer_la_cle_et_redemarrer() {
    let s = lancer("ac46");
    s.appel(
        "PUT",
        "/api/agent/providers/anthropic",
        &json!({ "adresse": "http://proxy.test", "cle": "sk-ant-1" }),
    );
    let s = redemarrer(s);
    let v = s.reglages();
    assert_eq!(v["providers"][1]["adresse"], "http://proxy.test");
    assert_eq!(v["providers"][1]["cle"], true);
    let r = s.appel("DELETE", "/api/agent/providers/anthropic/cle", &Value::Null);
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(r.json()["providers"][1]["cle"], false);
    let s = redemarrer(s);
    let v = s.reglages();
    assert_eq!(v["providers"][1]["cle"], false);
    assert_eq!(v["providers"][1]["adresse"], "http://proxy.test");
}

#[test]
fn req053_ac1_profils_survivent_au_redemarrage() {
    let s = lancer("p1");
    assert_eq!(
        s.appel("PUT", "/api/agent/profils", &profil("rapide")).code,
        200
    );
    assert_eq!(
        s.appel("PUT", "/api/agent/profils", &profil("lent")).code,
        200
    );
    let refus = s.appel("PUT", "/api/agent/profils", &profil("RAPIDE"));
    assert_eq!(refus.code, 400);
    assert_eq!(refus.json(), json!({ "erreurs": [{ "champ": "nom" }] }));
    let s = redemarrer(s);
    let v = s.reglages();
    let p = &v["profils"];
    assert_eq!(p.as_array().unwrap().len(), 2);
    assert_eq!(p[0]["nom"], "rapide");
    assert_eq!(p[0]["defaut"], true);
    assert_eq!(p[0]["sortieMax"], 2000);
    assert_eq!(p[1]["defaut"], false);
    let id = p[0]["id"].as_str().unwrap();
    let r = s.appel("DELETE", &format!("/api/agent/profils/{id}"), &Value::Null);
    assert_eq!(r.code, 200);
    assert_eq!(r.json()["profils"][0]["nom"], "lent");
    assert_eq!(r.json()["profils"][0]["defaut"], true);
}

#[test]
fn req029_ac4_reglages_sans_requete_au_faux_provider() {
    let faux = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    faux.set_nonblocking(true).unwrap();
    let adresse = format!("http://{}", faux.local_addr().unwrap());
    let s = lancer("ac29");
    for id in ["openai", "anthropic"] {
        let r = s.appel(
            "PUT",
            &format!("/api/agent/providers/{id}"),
            &json!({ "adresse": adresse, "cle": "sk-x" }),
        );
        assert_eq!(r.code, 200);
    }
    s.appel("PUT", "/api/agent/profils", &profil("rapide"));
    s.reglages();
    s.reglages();
    std::thread::sleep(Duration::from_millis(300));
    assert!(
        faux.accept().is_err(),
        "le serveur a contacté le faux provider"
    );
}
