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
    let d = std::env::temp_dir().join(format!("environnements-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

/// Une instance dont le dossier de configuration est `cfg` ; `projet` est son projet.
fn lancer_dans(cfg: &Path, projet: PathBuf) -> Serveur {
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
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let mut s = Serveur {
        child,
        port,
        cookie: String::new(),
        projet,
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
    fn fichier(&self) -> PathBuf {
        self.cfg.join("yaide/environnements.json")
    }
}

fn noms(v: &serde_json::Value) -> Vec<String> {
    v["environnements"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["nom"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn req182_ac1_get_sans_fichier_liste_vide_et_ne_cree_rien() {
    let s = lancer("ac1");
    let (c, v) = s.api("GET", "/api/environnements", "");
    assert_eq!(c, 200, "{v}");
    assert_eq!(v["environnements"], serde_json::json!([]));
    assert_eq!(v["fichier"], s.fichier().display().to_string());
    assert!(!s.fichier().exists());
    assert!(!s.projet.join(".yaide").exists());
}

#[test]
fn req182_ac2_put_ecrit_deux_variables_droits_600_sans_yaide_du_projet() {
    let s = lancer("ac2");
    let corps =
        r#"{"nom":"prod","variables":{"JETON":"a=b","ANTHROPIC_BASE_URL":"https://x.test/v1"}}"#;
    let (c, v) = s.api("PUT", "/api/environnements", corps);
    assert_eq!(c, 200, "{v}");
    assert_eq!(noms(&v), ["prod"]);
    let texte = std::fs::read_to_string(s.fichier()).unwrap();
    let f: serde_json::Value = serde_json::from_str(&texte).unwrap();
    let e = &f["environnements"][0];
    assert_eq!(e["nom"], "prod");
    assert_eq!(e["variables"]["ANTHROPIC_BASE_URL"], "https://x.test/v1");
    assert_eq!(e["variables"]["JETON"], "a=b");
    assert_eq!(e["variables"].as_object().unwrap().len(), 2);
    // JSON indenté de 2 espaces, variables dans l'ordre reçu.
    assert!(
        texte.contains("\n  \"environnements\": [\n    {\n      \"nom\": \"prod\""),
        "{texte}"
    );
    assert!(texte.find("JETON").unwrap() < texte.find("ANTHROPIC_BASE_URL").unwrap());
    let mode = std::fs::metadata(s.fichier()).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    assert!(!s.projet.join(".yaide").exists());
    // La liste relue garde l'ordre des variables.
    let o = format!("https://127.0.0.1:{}", s.port);
    let (_, brut) = requete(s.port, "GET", "/api/environnements", &s.cookie, &o, "");
    assert!(
        brut.find("JETON").unwrap() < brut.find("ANTHROPIC_BASE_URL").unwrap(),
        "{brut}"
    );
}

#[test]
fn req182_ac3_renommage_variable_retiree_autres_intacts() {
    let s = lancer("ac3");
    for corps in [
        r#"{"nom":"autre","variables":{"Z":"9","A":"1"}}"#,
        r#"{"nom":"prod","variables":{"ANTHROPIC_BASE_URL":"https://x.test/v1","JETON":"a=b"}}"#,
    ] {
        assert_eq!(s.api("PUT", "/api/environnements", corps).0, 200);
    }
    let o = format!("https://127.0.0.1:{}", s.port);
    let (_, brut) = requete(s.port, "GET", "/api/environnements", &s.cookie, &o, "");
    assert!(
        brut.find("\"Z\"").unwrap() < brut.find("\"A\"").unwrap(),
        "{brut}"
    );
    let avant: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(s.fichier()).unwrap()).unwrap();
    let corps = r#"{"ancien":"prod","nom":"production","variables":{"ANTHROPIC_BASE_URL":"https://x.test/v1"}}"#;
    let (c, v) = s.api("PUT", "/api/environnements", corps);
    assert_eq!(c, 200, "{v}");
    assert_eq!(noms(&v), ["autre", "production"]);
    let apres: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(s.fichier()).unwrap()).unwrap();
    assert_eq!(apres["environnements"][0], avant["environnements"][0]);
    assert_eq!(apres["environnements"][1]["nom"], "production");
    assert_eq!(
        apres["environnements"][1]["variables"],
        serde_json::json!({"ANTHROPIC_BASE_URL": "https://x.test/v1"})
    );
    assert_eq!(apres["environnements"].as_array().unwrap().len(), 2);
    // Un ancien nom absent : 404, rien d'écrit.
    let (c, _) = s.api(
        "PUT",
        "/api/environnements",
        r#"{"ancien":"prod","nom":"x","variables":{}}"#,
    );
    assert_eq!(c, 404);
}

#[test]
fn req182_ac4_delete_retire_l_environnement() {
    let s = lancer("ac4");
    for n in ["prod", "dev"] {
        s.api(
            "PUT",
            "/api/environnements",
            &format!(r#"{{"nom":"{n}","variables":{{"A":"1"}}}}"#),
        );
    }
    let (c, v) = s.api("DELETE", "/api/environnements/prod", "");
    assert_eq!(c, 200, "{v}");
    assert_eq!(noms(&v), ["dev"]);
    let f = std::fs::read_to_string(s.fichier()).unwrap();
    assert!(!f.contains("prod") && f.contains("dev"), "{f}");
    assert_eq!(s.api("DELETE", "/api/environnements/prod", "").0, 404);
}

#[test]
fn req182_ac5_le_serveur_refuse_nom_et_variables_avec_le_champ() {
    let s = lancer("ac5");
    s.api(
        "PUT",
        "/api/environnements",
        r#"{"nom":"prod","variables":{}}"#,
    );
    let avant = std::fs::read_to_string(s.fichier()).unwrap();
    let nom_vide = "Donnez un nom à l'environnement.";
    let pris = "Ce nom est déjà pris. Choisissez-en un autre.";
    let vars =
        "Variables : une par ligne, sous la forme NOM=valeur (lettres, chiffres et _ dans le nom).";
    for (corps, champ, message) in [
        (r#"{"nom":"","variables":{}}"#, "nom", nom_vide),
        (r#"{"nom":"Prod","variables":{}}"#, "nom", pris),
        (r#"{"nom":"x","variables":{"1A":"x"}}"#, "variables", vars),
        (r#"{"nom":"x","variables":{"A B":"x"}}"#, "variables", vars),
    ] {
        let (c, v) = s.api("PUT", "/api/environnements", corps);
        assert_eq!(c, 400, "{corps} {v}");
        assert_eq!(v["champ"], champ, "{corps}");
        assert_eq!(v["message"], message, "{corps}");
    }
    assert_eq!(std::fs::read_to_string(s.fichier()).unwrap(), avant);
}

#[test]
fn req182_ac7_ecriture_de_b_relue_avant_celle_de_a() {
    let d = dossier("ac7");
    let cfg = d.join("cfg");
    let a = lancer_dans(&cfg, d.join("a/projet"));
    let b = lancer_dans(&cfg, d.join("b/projet"));
    assert_eq!(
        a.api(
            "PUT",
            "/api/environnements",
            r#"{"nom":"prod","variables":{}}"#
        )
        .0,
        200
    );
    let (_, v) = b.api("GET", "/api/environnements", "");
    assert_eq!(noms(&v), ["prod"]);
    // B ajoute `dev` ; A, qui n'a rien relu, enregistre `staging`.
    assert_eq!(
        b.api(
            "PUT",
            "/api/environnements",
            r#"{"nom":"dev","variables":{}}"#
        )
        .0,
        200
    );
    assert_eq!(
        a.api(
            "PUT",
            "/api/environnements",
            r#"{"nom":"staging","variables":{}}"#
        )
        .0,
        200
    );
    let (_, v) = a.api("GET", "/api/environnements", "");
    assert_eq!(noms(&v), ["dev", "prod", "staging"]);
}

#[test]
fn req182_ac8_json_casse_erreur_de_l_analyseur_fichier_inchange() {
    let s = lancer("ac8");
    std::fs::create_dir_all(s.fichier().parent().unwrap()).unwrap();
    std::fs::write(s.fichier(), "{ \"environnements\": [ oups").unwrap();
    let (c, v) = s.api("GET", "/api/environnements", "");
    assert_eq!(c, 409, "{v}");
    let f = s.fichier().display().to_string();
    assert_eq!(
        v["message"],
        format!("{f} est illisible. Corrigez-le, puis rouvrez Environnements.")
    );
    assert_eq!(v["fichier"], f);
    let detail = v["detail"].as_str().unwrap();
    assert!(
        detail.contains("expected") || detail.contains("line"),
        "{detail}"
    );
    let (c, _) = s.api(
        "PUT",
        "/api/environnements",
        r#"{"nom":"prod","variables":{}}"#,
    );
    assert_eq!(c, 409);
    assert_eq!(s.api("DELETE", "/api/environnements/prod", "").0, 409);
    assert_eq!(
        std::fs::read_to_string(s.fichier()).unwrap(),
        "{ \"environnements\": [ oups"
    );
}

#[test]
fn req182_ac9_401_sans_session_403_mauvaise_origine() {
    let s = lancer("ac9");
    let origine = format!("https://127.0.0.1:{}", s.port);
    for (m, ch, corps) in [
        ("GET", "/api/environnements", ""),
        (
            "PUT",
            "/api/environnements",
            r#"{"nom":"x","variables":{}}"#,
        ),
        ("DELETE", "/api/environnements/x", ""),
    ] {
        let (c, _) = requete(s.port, m, ch, "", &origine, corps);
        assert_eq!(c, 401, "{m} {ch}");
        let (c, _) = requete(s.port, m, ch, &s.cookie, "https://autre.test", corps);
        assert_eq!(c, 403, "{m} {ch}");
    }
    assert!(!s.fichier().exists());
}

fn fichier_json(s: &Serveur) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(s.fichier()).unwrap()).unwrap()
}

#[test]
fn req202_ac1_une_seule_marque_defaut_variables_des_autres_intactes() {
    let s = lancer("req202-ac1");
    let put = |corps: &str| {
        let (c, v) = s.api("PUT", "/api/environnements", corps);
        assert_eq!(c, 200, "{v}");
        v
    };
    put(r#"{"nom":"prod","variables":{"Z":"9","A":"1"}}"#);
    put(r#"{"nom":"dev","variables":{"B":"2"}}"#);
    // Sans marque : le champ est absent du fichier.
    assert!(!std::fs::read_to_string(s.fichier())
        .unwrap()
        .contains("defaut"));
    let v = put(r#"{"ancien":"prod","nom":"prod","variables":{"Z":"9","A":"1"},"defaut":true}"#);
    let f = fichier_json(&s);
    assert_eq!(f["environnements"][0]["defaut"], true);
    assert!(f["environnements"][1].get("defaut").is_none());
    assert_eq!(v["environnements"][1]["defaut"], true, "{v}");
    let prod_avant = f["environnements"][0].clone();
    // `dev` devient par défaut : `prod` perd la marque, ses variables restent.
    put(r#"{"ancien":"dev","nom":"dev","variables":{"B":"2"},"defaut":true}"#);
    let f = fichier_json(&s);
    assert_eq!(f["environnements"][1]["defaut"], true);
    assert!(f["environnements"][0].get("defaut").is_none());
    assert_eq!(f["environnements"][0]["variables"], prod_avant["variables"]);
    let texte = std::fs::read_to_string(s.fichier()).unwrap();
    assert!(texte.find("\"Z\"").unwrap() < texte.find("\"A\"").unwrap());
    // Décoché : plus aucun par défaut.
    put(r#"{"ancien":"dev","nom":"dev","variables":{"B":"2"}}"#);
    assert!(!std::fs::read_to_string(s.fichier())
        .unwrap()
        .contains("defaut"));
}

#[test]
fn req202_ac2_suppression_du_defaut_et_fichier_ancien_sans_marque() {
    let s = lancer("req202-ac2");
    std::fs::create_dir_all(s.fichier().parent().unwrap()).unwrap();
    std::fs::write(
        s.fichier(),
        r#"{"environnements":[{"nom":"prod","variables":{"A":"1"}},{"nom":"dev"}]}"#,
    )
    .unwrap();
    let (c, v) = s.api("GET", "/api/environnements", "");
    assert_eq!(c, 200, "{v}");
    assert_eq!(noms(&v), ["dev", "prod"]);
    assert!(v["environnements"]
        .as_array()
        .unwrap()
        .iter()
        .all(|e| e.get("defaut").is_none()));
    s.api(
        "PUT",
        "/api/environnements",
        r#"{"ancien":"prod","nom":"prod","variables":{"A":"1"},"defaut":true}"#,
    );
    let avant = fichier_json(&s);
    assert_eq!(avant["environnements"][0]["defaut"], true);
    let (c, v) = s.api("DELETE", "/api/environnements/prod", "");
    assert_eq!(c, 200, "{v}");
    let apres = fichier_json(&s);
    assert_eq!(apres["environnements"].as_array().unwrap().len(), 1);
    assert_eq!(apres["environnements"][0], avant["environnements"][1]);
    assert!(!std::fs::read_to_string(s.fichier())
        .unwrap()
        .contains("defaut"));
}
