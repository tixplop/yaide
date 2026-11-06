#![allow(non_snake_case)]
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

type Recues = std::sync::Arc<std::sync::Mutex<Vec<Value>>>;

/// Faux provider sur un fil à lui : rend les réponses du scénario dans l'ordre,
/// chacune après son délai (ms). Chaque requête reçue est notée `{ chemin, corps }`.
fn faux_provider(scenario: Vec<(u16, Value, u64)>) -> (String, Recues) {
    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::{StatusCode, Uri};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    #[derive(Clone)]
    struct Etat(Arc<Mutex<VecDeque<(u16, Value, u64)>>>, Recues);
    async fn rep(State(e): State<Etat>, uri: Uri, corps: Bytes) -> (StatusCode, String) {
        e.1.lock().unwrap().push(json!({
            "chemin": uri.path(),
            "corps": serde_json::from_slice::<Value>(&corps).unwrap_or(Value::Null),
        }));
        let suivante = e.0.lock().unwrap().pop_front();
        match suivante {
            Some((code, v, delai)) => {
                tokio::time::sleep(Duration::from_millis(delai)).await;
                (StatusCode::from_u16(code).unwrap(), v.to_string())
            }
            None => (StatusCode::INTERNAL_SERVER_ERROR, "plus de réponse".into()),
        }
    }
    let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    ecoute.set_nonblocking(true).unwrap();
    let adresse = format!("http://{}", ecoute.local_addr().unwrap());
    let recues: Recues = Default::default();
    let etat = Etat(Arc::new(Mutex::new(scenario.into())), recues.clone());
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(async move {
                let app = axum::Router::new().fallback(rep).with_state(etat);
                let ecoute = tokio::net::TcpListener::from_std(ecoute).unwrap();
                axum::serve(ecoute, app).await.unwrap();
            });
    });
    (adresse, recues)
}

fn rep_texte(t: &str) -> (u16, Value, u64) {
    (
        200,
        json!({"choices": [{"message": {"content": t}}],
               "usage": {"prompt_tokens": 7, "completion_tokens": 1}}),
        0,
    )
}

fn rep_lire_openai(delai: u64) -> (u16, Value, u64) {
    (
        200,
        json!({"choices": [{"message": {"content": null, "tool_calls": [{
            "id": "c1", "type": "function",
            "function": {"name": "read", "arguments": "{\"path\":\"README.md\"}"}}]}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 1}}),
        delai,
    )
}

/// Enregistre le faux provider pour `provider` et un profil ; rend l'id du profil.
fn configurer(s: &Serveur, provider: &str, adresse: &str) -> String {
    let r = s.appel(
        "PUT",
        &format!("/api/agent/providers/{provider}"),
        &json!({ "adresse": adresse, "cle": "sk-x" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let p = json!({ "nom": provider, "provider": provider, "modele": "m" });
    let r = s.appel("PUT", "/api/agent/profils", &p);
    assert_eq!(r.code, 200, "{}", r.corps);
    r.json()["profils"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["provider"] == provider)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn message(s: &Serveur, profil: &str, texte: &str) -> String {
    let r = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({ "profil": profil, "texte": texte }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    r.json()["conversation"].as_str().unwrap().to_string()
}

fn attendre_fin(s: &Serveur, id: &str) -> Value {
    for _ in 0..200 {
        let r = s.appel(
            "GET",
            &format!("/api/agent/conversations/{id}"),
            &Value::Null,
        );
        assert_eq!(r.code, 200, "{}", r.corps);
        let v = r.json();
        if v["enCours"] == false {
            return v;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("le tour ne finit pas");
}

#[test]
fn REQ055_AC4_REQ051_AC2_un_tour_par_les_routes_avec_relecture_depuis() {
    let (adresse, recues) = faux_provider(vec![
        rep_lire_openai(0),
        rep_texte("fini"),
        (
            200,
            json!({"content": [{"type": "tool_use", "id": "t1", "name": "read",
                                "input": {"path": "README.md"}}],
                   "usage": {"input_tokens": 3, "output_tokens": 1}}),
            0,
        ),
        (
            200,
            json!({"content": [{"type": "text", "text": "fini aussi"}],
                   "usage": {"input_tokens": 4, "output_tokens": 1}}),
            0,
        ),
    ]);
    let s = lancer("tour");
    std::fs::write(s.projet.join("README.md"), "bonjour-readme").unwrap();
    let openai = configurer(&s, "openai", &adresse);
    let anthropic = configurer(&s, "anthropic", &adresse);

    let id = message(&s, &openai, "lis le README\nsuite");
    let v = attendre_fin(&s, &id);
    assert_eq!(v["titre"], "lis le README");
    assert_eq!(v["total"], 4);
    assert_eq!(v["entrees"][2]["etat"], "reussi");
    assert!(v["entrees"][2]["resultat"]
        .as_str()
        .unwrap()
        .contains("bonjour-readme"));
    assert_eq!(v["entrees"][3]["texte"], "fini");
    assert_eq!(v["tokens"], 8);
    // le fichier est dans le projet
    assert!(s
        .yaide()
        .join("conversations")
        .join(format!("{id}.json"))
        .exists());
    // lecture à partir de n
    let r = s.appel(
        "GET",
        &format!("/api/agent/conversations/{id}?depuis=3"),
        &Value::Null,
    );
    let v = r.json();
    assert_eq!(v["total"], 4);
    assert_eq!(v["entrees"].as_array().unwrap().len(), 1);
    assert_eq!(v["entrees"][0]["texte"], "fini");

    // format Anthropic
    let r = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({ "conversation": id, "profil": anthropic, "texte": "lis aussi" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(r.json()["conversation"], id.as_str());
    let v = attendre_fin(&s, &id);
    assert_eq!(v["profil"], anthropic.as_str());
    assert_eq!(v["entrees"][6]["etat"], "reussi");
    assert_eq!(v["entrees"][7]["texte"], "fini aussi");
    let r = recues.lock().unwrap();
    assert_eq!(r.len(), 4);
    assert_eq!(r[0]["chemin"], "/chat/completions");
    assert_eq!(r[2]["chemin"], "/v1/messages");
    assert!(r[3]["corps"].to_string().contains("bonjour-readme"));
    let historique = r[2]["corps"].to_string();
    assert!(historique.contains("lis le README") && historique.contains("fini"));
    assert!(historique.contains("bonjour-readme") && historique.contains("lis aussi"));
    drop(r);

    // conversation inconnue
    let r = s.appel("GET", "/api/agent/conversations/nexiste-pas", &Value::Null);
    assert_eq!(r.code, 404);
    let r = s.appel(
        "POST",
        "/api/agent/conversations/nexiste-pas/arreter",
        &Value::Null,
    );
    assert_eq!(r.code, 404);
}

#[test]
fn REQ055_AC8_le_tour_continue_sans_client() {
    let (adresse, recues) = faux_provider(vec![rep_lire_openai(600), rep_texte("terminé")]);
    let s = lancer("sansclient");
    std::fs::write(s.projet.join("README.md"), "x").unwrap();
    let profil = configurer(&s, "openai", &adresse);
    let id = message(&s, &profil, "go");
    // plus aucune requête du client pendant que le tour avance
    let fichier = s.yaide().join("conversations").join(format!("{id}.json"));
    let mut fini = false;
    for _ in 0..300 {
        if recues.lock().unwrap().len() == 2 {
            let disque: Option<Value> = std::fs::read(&fichier)
                .ok()
                .and_then(|o| serde_json::from_slice(&o).ok());
            if disque.is_some_and(|d| d["enCours"] == false) {
                fini = true;
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(fini, "le tour ne s'est pas terminé sans client");
    let r = s.appel(
        "GET",
        &format!("/api/agent/conversations/{id}"),
        &Value::Null,
    );
    let v = r.json();
    assert_eq!(v["enCours"], false, "{v}");
    assert_eq!(v["total"], 4);
    assert_eq!(v["entrees"][3]["texte"], "terminé");
}

#[test]
fn REQ056_AC6_liste_la_plus_recente_en_premier() {
    let (adresse, _) = faux_provider(vec![rep_texte("a"), rep_texte("b")]);
    let s = lancer("liste");
    let profil = configurer(&s, "openai", &adresse);
    let r = s.appel("GET", "/api/agent/conversations", &Value::Null);
    assert_eq!(r.json(), json!([]));
    let premiere = message(&s, &profil, "première");
    attendre_fin(&s, &premiere);
    std::thread::sleep(Duration::from_millis(20));
    let seconde = message(&s, &profil, "seconde");
    attendre_fin(&s, &seconde);
    let v = s
        .appel("GET", "/api/agent/conversations", &Value::Null)
        .json();
    let l = v.as_array().unwrap();
    assert_eq!(l.len(), 2);
    assert_eq!(l[0]["id"], seconde.as_str());
    assert_eq!(l[0]["titre"], "seconde");
    assert_eq!(l[1]["id"], premiere.as_str());
    assert!(l[0]["maj"].as_u64().unwrap() >= l[1]["maj"].as_u64().unwrap());
}

#[test]
fn REQ029_AC4_aucune_requete_au_faux_provider_avant_un_message() {
    let (adresse, recues) = faux_provider(vec![rep_texte("ok")]);
    let s = lancer("av29");
    let profil = configurer(&s, "openai", &adresse);
    s.reglages();
    s.appel("GET", "/api/agent/conversations", &Value::Null);
    // refus : sans clé, aucune requête non plus
    let r = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({ "profil": "inconnu", "texte": "x" }),
    );
    assert_eq!(r.code, 409);
    assert_eq!(r.json()["refus"], "sans-profil");
    std::thread::sleep(Duration::from_millis(300));
    assert!(recues.lock().unwrap().is_empty());
    assert!(!s.yaide().join("conversations").exists());
    let id = message(&s, &profil, "salut");
    attendre_fin(&s, &id);
    assert_eq!(recues.lock().unwrap().len(), 1);
}
