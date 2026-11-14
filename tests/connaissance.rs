//! Routes de la base de connaissance et ajout en tâche de fond (REQ-103 à REQ-106).
#![allow(non_snake_case)]
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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
    cmd.args(["-sk", "-i", "--max-time", "30", "-X", methode])
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

    fn etat(&self) -> Value {
        let r = self.appel("GET", "/api/connaissance", &Value::Null);
        assert_eq!(r.code, 200, "{}", r.corps);
        r.json()
    }

    fn ajouter(&self, collection: &str, chemins: &[&str]) -> Rep {
        self.appel(
            "POST",
            "/api/connaissance/ajouts",
            &json!({ "collection": collection, "chemins": chemins }),
        )
    }

    fn chercher(&self, question: &str, collection: Option<&str>) -> Rep {
        let mut corps = json!({ "question": question });
        if let Some(c) = collection {
            corps["collection"] = json!(c);
        }
        self.appel("POST", "/api/connaissance/recherche", &corps)
    }

    /// Attend la fin du dernier ajout ; rend son état.
    fn attendre_fin(&self) -> Value {
        let debut = Instant::now();
        loop {
            let ajout = self.etat()["ajout"].clone();
            if !ajout.is_null() && ajout["etat"] != "en_cours" {
                return ajout;
            }
            assert!(debut.elapsed() < Duration::from_secs(30), "ajout sans fin");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn collection(&self, nom: &str) -> Option<Value> {
        self.etat()["collections"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["nom"] == nom)
            .cloned()
    }

    fn fichiers(&self, nom: &str) -> Vec<String> {
        let r = self.appel(
            "GET",
            &format!("/api/connaissance/collections/{nom}"),
            &Value::Null,
        );
        assert_eq!(r.code, 200, "{}", r.corps);
        r.json()["fichiers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f.as_str().unwrap().to_string())
            .collect()
    }

    fn config_json(&self) -> PathBuf {
        self.projet.join(".yaide/connaissance/config.json")
    }
}

fn dossier(nom: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("connaissance-{nom}-{}", std::process::id()));
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

fn demarrer(racine: &Path, projet: &str) -> Serveur {
    demarrer_avec(racine, projet, None)
}

/// `intervalle_ms` : intervalle de vérification de la base (tests REQ-110 seulement).
fn demarrer_avec(racine: &Path, projet: &str, intervalle_ms: Option<&str>) -> Serveur {
    let projet = racine.join(projet);
    std::fs::create_dir_all(&projet).unwrap();
    let port = port_libre();
    let mut cmd = Command::new(EXE);
    cmd.arg(&projet)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", racine.join("cfg"))
        .env("HOME", racine)
        .env("GIT_CEILING_DIRECTORIES", racine)
        .stdout(Stdio::null());
    if let Some(ms) = intervalle_ms {
        cmd.env("YAIDE_INTERVALLE_BASE_MS", ms);
    }
    let child = cmd.spawn().unwrap();
    let mut s = Serveur {
        child,
        port,
        cookie: String::new(),
        projet,
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

fn lancer(nom: &str) -> Serveur {
    demarrer(&dossier(nom), "projet")
}

fn lancer_rapide(nom: &str) -> Serveur {
    demarrer_avec(&dossier(nom), "projet", Some("200"))
}

type Recues = Arc<Mutex<Vec<Value>>>;

/// Faux provider : répond sur `/embeddings`, une réponse du scénario par requête
/// `(code, délai en ms)`, puis 200 tout de suite. Un texte `v<n>…` a le vecteur `[n, 1]`,
/// les autres `[1, 0]`.
fn faux_provider(scenario: Vec<(u16, u64)>) -> (String, Recues) {
    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::{HeaderMap, StatusCode, Uri};
    #[derive(Clone)]
    struct Etat(Arc<Mutex<VecDeque<(u16, u64)>>>, Recues);
    fn vecteur(t: &str) -> Vec<f32> {
        let chiffres: String = t
            .strip_prefix('v')
            .unwrap_or("")
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        match chiffres.parse::<f32>() {
            Ok(n) => vec![n, 1.0],
            Err(_) => vec![1.0, 0.0],
        }
    }
    async fn rep(
        State(e): State<Etat>,
        uri: Uri,
        entetes: HeaderMap,
        corps: Bytes,
    ) -> (StatusCode, String) {
        let v: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
        e.1.lock().unwrap().push(json!({
            "chemin": uri.path(),
            "auth": entetes.get("authorization").and_then(|v| v.to_str().ok()),
            "model": v["model"],
            "input": v["input"],
        }));
        let (code, delai) = e.0.lock().unwrap().pop_front().unwrap_or((200, 0));
        tokio::time::sleep(Duration::from_millis(delai)).await;
        if code != 200 {
            return (
                StatusCode::from_u16(code).unwrap(),
                "{\"error\":\"clé refusée\"}".into(),
            );
        }
        let data: Vec<Value> = v["input"]
            .as_array()
            .map(|a| a.as_slice())
            .unwrap_or(&[])
            .iter()
            .enumerate()
            .map(|(i, t)| json!({ "index": i, "embedding": vecteur(t.as_str().unwrap_or("")) }))
            .collect();
        (StatusCode::OK, json!({ "data": data }).to_string())
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

/// Ollama (sans clé) à l'adresse donnée, puis la base configurée sur ce provider.
fn configurer(s: &Serveur, adresse: &str) {
    let r = s.appel(
        "PUT",
        "/api/agent/providers/ollama",
        &json!({ "adresse": adresse }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let r = s.appel(
        "PUT",
        "/api/connaissance/config",
        &json!({ "provider": "ollama", "modele": "m-embed" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
}

fn ecrire(s: &Serveur, chemin: &str, contenu: &str) {
    let p = s.projet.join(chemin);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, contenu).unwrap();
}

fn nombre_requetes(r: &Recues) -> usize {
    r.lock().unwrap().len()
}

#[test]
fn REQ103_AC3_REQ029_AC4_configuration_sans_requete_et_relue_au_redemarrage() {
    let (adresse, recues) = faux_provider(vec![]);
    let racine = dossier("ac3");
    let s = demarrer(&racine, "projet");
    assert_eq!(s.etat()["config"], Value::Null);
    assert!(!s.projet.join(".yaide").exists());
    configurer(&s, &adresse);
    let ecrit: Value =
        serde_json::from_str(&std::fs::read_to_string(s.config_json()).unwrap()).unwrap();
    assert_eq!(ecrit, json!({ "provider": "ollama", "modele": "m-embed" }));
    // Lire la base et la configuration ne contacte pas le provider.
    let _ = s.etat();
    assert_eq!(
        s.appel("GET", "/api/agent/reglages", &Value::Null).code,
        200
    );
    assert_eq!(nombre_requetes(&recues), 0);
    // Un provider sans vecteurs, ou un modèle vide, ne s'enregistre pas.
    let r = s.appel(
        "PUT",
        "/api/connaissance/config",
        &json!({ "provider": "anthropic", "modele": "m" }),
    );
    assert_eq!(r.code, 400);
    let r = s.appel(
        "PUT",
        "/api/connaissance/config",
        &json!({ "provider": "ollama", "modele": "  " }),
    );
    assert_eq!(r.code, 400);
    assert_eq!(r.json()["champ"], "modele");
    let nom = s.projet.file_name().unwrap().to_owned();
    drop(s);
    let s = demarrer(&racine, nom.to_str().unwrap());
    assert_eq!(
        s.etat()["config"],
        json!({ "provider": "ollama", "modele": "m-embed" })
    );
    assert_eq!(nombre_requetes(&recues), 0);
}

#[test]
fn REQ103_AC6_deux_projets_ont_chacun_leur_base() {
    let (adresse, _) = faux_provider(vec![]);
    let racine = dossier("ac6");
    let a = demarrer(&racine, "a");
    let b = demarrer(&racine, "b");
    configurer(&a, &adresse);
    ecrire(&a, "docs/a.md", "v1 un\n");
    assert_eq!(a.ajouter("notes", &["docs"]).code, 202);
    assert_eq!(a.attendre_fin()["etat"], "fini");
    assert!(a.collection("notes").is_some());
    let eb = b.etat();
    assert_eq!(eb["config"], Value::Null);
    assert_eq!(eb["collections"], json!([]));
    assert_eq!(eb["ajout"], Value::Null);
    assert!(!b.projet.join(".yaide").exists());
}

#[test]
fn REQ103_AC7_REQ104_AC7_refus_sans_requete_config_illisible_non_configuree_sans_cle() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac7");
    ecrire(&s, "docs/a.md", "v1 un\n");
    // Base non configurée.
    let r = s.ajouter("notes", &["docs"]);
    assert_eq!(r.code, 409);
    assert_eq!(r.json()["cause"], "non_configuree");
    assert_eq!(s.chercher("x", None).json()["cause"], "non_configuree");
    // Provider avec clé obligatoire, sans clé.
    s.appel(
        "PUT",
        "/api/agent/providers/openai",
        &json!({ "adresse": adresse }),
    );
    let r = s.appel(
        "PUT",
        "/api/connaissance/config",
        &json!({ "provider": "openai", "modele": "m" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let r = s.ajouter("notes", &["docs"]);
    assert_eq!(r.code, 409);
    assert_eq!(
        r.json()["message"],
        "Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM."
    );
    assert_eq!(s.chercher("x", None).code, 409);
    // Configuration illisible : dite, jamais réécrite, ajout et recherche refusés.
    std::fs::write(s.config_json(), "{ cassé").unwrap();
    let e = s.etat();
    assert_eq!(e["config"], Value::Null);
    let message = e["erreur"].as_str().unwrap();
    assert!(message.contains("config.json"), "{message}");
    let r = s.ajouter("notes", &["docs"]);
    assert_eq!(r.code, 409);
    assert_eq!(r.json()["cause"], "illisible");
    assert_eq!(s.chercher("x", None).json()["cause"], "illisible");
    let r = s.appel(
        "PUT",
        "/api/connaissance/config",
        &json!({ "provider": "ollama", "modele": "m" }),
    );
    assert_eq!(r.code, 409);
    assert_eq!(std::fs::read_to_string(s.config_json()).unwrap(), "{ cassé");
    assert_eq!(nombre_requetes(&recues), 0);
}

#[test]
fn REQ104_AC2_AC3_AC8_ajout_de_dossier_compteurs_et_liste_de_chemins() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac2");
    std::process::Command::new("git")
        .args(["init", "-q"])
        .arg(&s.projet)
        .status()
        .unwrap();
    ecrire(&s, ".gitignore", "docs/ignore.md\n");
    ecrire(&s, "docs/a.md", "v1 a\n");
    ecrire(&s, "docs/b.md", "v2 b\n");
    ecrire(&s, "docs/sous/c.md", "v3 c\n");
    ecrire(&s, "docs/ignore.md", "v4 ignoré par git\n");
    ecrire(&s, "docs/autre.md", "v5 hors dossier\n");
    std::fs::write(s.projet.join("docs/binaire.bin"), [0u8, 1, 2, 255]).unwrap();
    std::fs::write(
        s.projet.join("docs/gros.txt"),
        vec![b'a'; 5 * 1024 * 1024 + 1],
    )
    .unwrap();
    configurer(&s, &adresse);

    let r = s.ajouter("notes", &["docs"]);
    assert_eq!(r.code, 202, "{}", r.corps);
    let fin = s.attendre_fin();
    assert_eq!(fin["etat"], "fini");
    assert_eq!(fin["collection"], "notes");
    assert_eq!(fin["ajoutes"], 4);
    assert_eq!(fin["ignores"], 3);
    assert_eq!(fin["faits"], fin["total"]);
    assert_eq!(
        s.fichiers("notes"),
        ["docs/a.md", "docs/autre.md", "docs/b.md", "docs/sous/c.md"]
    );
    assert_eq!(s.collection("notes").unwrap()["passages"], 4);
    let envoyes: Vec<Value> = recues.lock().unwrap().clone();
    assert_eq!(envoyes.len(), 1);
    assert_eq!(envoyes[0]["chemin"], "/embeddings");
    assert_eq!(envoyes[0]["model"], "m-embed");
    let textes: Vec<&str> = envoyes[0]["input"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t.as_str().unwrap())
        .collect();
    assert!(!textes.iter().any(|t| t.contains("ignoré par git")));

    // Une liste de chemins : ces fichiers, et eux seuls.
    recues.lock().unwrap().clear();
    assert_eq!(s.ajouter("deux", &["docs/a.md", "docs/b.md"]).code, 202);
    assert_eq!(s.attendre_fin()["ajoutes"], 2);
    assert_eq!(s.fichiers("deux"), ["docs/a.md", "docs/b.md"]);
    // Un chemin hors du projet ou absent est refusé, sans ajout.
    assert_eq!(s.ajouter("deux", &["../ailleurs"]).code, 403);
    assert_eq!(s.ajouter("deux", &["docs/absent.md"]).code, 404);
    assert_eq!(s.ajouter("deux", &[".yaide"]).code, 400);
}

#[test]
fn REQ104_AC5_ajouter_de_nouveau_ne_renvoie_que_ce_qui_a_change() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac5");
    ecrire(&s, "docs/a.md", "v1 a\n");
    ecrire(&s, "docs/b.md", "v2 b\n");
    ecrire(&s, "docs/c.md", "v3 c\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    assert_eq!(s.attendre_fin()["ajoutes"], 3);
    recues.lock().unwrap().clear();
    ecrire(&s, "docs/a.md", "v9 modifié\n");
    std::fs::remove_file(s.projet.join("docs/b.md")).unwrap();
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    let fin = s.attendre_fin();
    assert_eq!(fin["ajoutes"], 1);
    assert_eq!(fin["inchanges"], 1);
    assert_eq!(fin["retires"], 1);
    let envoyes = recues.lock().unwrap().clone();
    assert_eq!(envoyes.len(), 1);
    assert_eq!(envoyes[0]["input"], json!(["v9 modifié"]));
    assert_eq!(s.fichiers("notes"), ["docs/a.md", "docs/c.md"]);
    // La recherche voit le nouveau contenu.
    let trouves = s.chercher("v9", Some("notes")).json();
    assert_eq!(trouves["passages"][0]["texte"], "v9 modifié");
}

#[test]
fn REQ104_AC6_nom_refuse_rien_envoye_et_casse_ignoree() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac6nom");
    ecrire(&s, "docs/a.md", "v1 a\n");
    configurer(&s, &adresse);
    for nom in ["", &"a".repeat(41), "api docs", "é", "a/b"] {
        let r = s.ajouter(nom, &["docs"]);
        assert_eq!(r.code, 400, "{nom:?} : {}", r.corps);
    }
    assert_eq!(nombre_requetes(&recues), 0);
    assert_eq!(s.etat()["ajout"], Value::Null);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    ecrire(&s, "docs/b.md", "v2 b\n");
    assert_eq!(s.ajouter("Notes", &["docs"]).code, 202);
    let fin = s.attendre_fin();
    assert_eq!(fin["collection"], "notes");
    assert_eq!(s.fichiers("notes"), ["docs/a.md", "docs/b.md"]);
    let noms: Vec<Value> = s.etat()["collections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["nom"].clone())
        .collect();
    assert_eq!(noms, [json!("notes")]);
}

#[test]
fn REQ104_AC9_refus_du_provider_arrete_l_ajout_et_garde_les_fichiers_finis() {
    // Premier lot accepté, deuxième refusé : a.md (fini dans le premier lot) reste.
    let (adresse, _) = faux_provider(vec![(200, 0), (401, 0)]);
    let s = lancer("ac9");
    ecrire(&s, "docs/a.md", "v1 a\n");
    let ligne = format!("v2 {}", "x".repeat(1500));
    ecrire(&s, "docs/b.md", &vec![ligne; 70].join("\n"));
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    let fin = s.attendre_fin();
    assert_eq!(fin["etat"], "arrete");
    assert_eq!(fin["cause"], "Ollama a refusé la requête (401).");
    assert!(fin["detail"].as_str().unwrap().contains("clé refusée"));
    assert_eq!(s.fichiers("notes"), ["docs/a.md"]);
    let t = s.chercher("v1", Some("notes")).json();
    assert_eq!(t["passages"][0]["chemin"], "docs/a.md");
    // Provider injoignable.
    let mort = format!("http://127.0.0.1:{}", port_libre());
    s.appel(
        "PUT",
        "/api/agent/providers/ollama",
        &json!({ "adresse": mort }),
    );
    ecrire(&s, "docs/c.md", "v3 c\n");
    assert_eq!(s.ajouter("notes", &["docs/c.md"]).code, 202);
    let fin = s.attendre_fin();
    assert_eq!(fin["etat"], "arrete");
    assert!(fin["cause"].as_str().unwrap().contains("injoignable"));
    assert_eq!(s.fichiers("notes"), ["docs/a.md"]);
}

#[test]
fn REQ104_AC10_REQ105_AC4_AC5_second_ajout_refuse_progression_et_suppression_refusee() {
    // Deux lots : le second tarde, ce qui laisse lire l'avancement.
    let (adresse, _) = faux_provider(vec![(200, 0), (200, 1500)]);
    let s = lancer("ac10");
    let ligne = format!("v2 {}", "x".repeat(1500));
    ecrire(&s, "docs/a.md", "v1 a\n");
    ecrire(&s, "docs/b.md", &vec![ligne; 70].join("\n"));
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    // a.md est fini dès le premier lot, b.md attend le second : « 1 / 2 ».
    let debut = Instant::now();
    let mut vu = None;
    while debut.elapsed() < Duration::from_secs(10) {
        if let Some(c) = s.collection("notes") {
            if c["ajout"]["faits"] == 1 {
                vu = Some(c["ajout"].clone());
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let vu = vu.expect("l'avancement se lit");
    assert!(vu["faits"].as_u64() < vu["total"].as_u64(), "{vu}");
    assert_eq!(vu["total"], 2);
    let r = s.ajouter("notes", &["docs/b.md"]);
    assert_eq!(r.code, 409);
    assert_eq!(r.json()["cause"], "encours");
    assert_eq!(
        r.json()["message"],
        "Un ajout est déjà en cours. Attendez sa fin, puis réessayez."
    );
    let r = s.appel(
        "DELETE",
        "/api/connaissance/collections/notes",
        &Value::Null,
    );
    assert_eq!(r.code, 409);
    assert_eq!(
        r.json()["message"],
        "L'ajout à notes est en cours. Attendez sa fin pour supprimer la collection."
    );
    let fin = s.attendre_fin();
    assert_eq!(fin["etat"], "fini");
    assert_eq!(fin["ajoutes"], 2);
    assert_eq!(fin["faits"], fin["total"]);
    let c = s.collection("notes").unwrap();
    assert_eq!(c["fichiers"], 2);
    assert_eq!(c["passages"], 71);
    assert!(c.get("ajout").is_none());
}

#[test]
fn REQ104_AC11_arret_de_yaide_pendant_l_ajout_ne_garde_que_les_fichiers_finis() {
    let (adresse, recues) = faux_provider(vec![(200, 0), (200, 60_000)]);
    let racine = dossier("ac11");
    let mut s = demarrer(&racine, "projet");
    let ligne = format!("v2 {}", "x".repeat(1500));
    ecrire(&s, "docs/a.md", "v1 a\n");
    ecrire(&s, "docs/b.md", &vec![ligne; 70].join("\n"));
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    let debut = Instant::now();
    while nombre_requetes(&recues) < 2 {
        assert!(debut.elapsed() < Duration::from_secs(20));
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(s.etat()["ajout"]["etat"], "en_cours");
    // SIGTERM, comme `kill` : l'arrêt est propre et ne attend pas la fin de l'ajout.
    let pid = s.child.id().to_string();
    assert!(Command::new("kill")
        .args(["-TERM", &pid])
        .status()
        .unwrap()
        .success());
    s.child.wait().unwrap();
    let s2 = demarrer(&racine, "projet");
    let e = s2.etat();
    assert_eq!(e["ajout"], Value::Null);
    assert_eq!(s2.fichiers("notes"), ["docs/a.md"]);
    assert_eq!(e["collections"][0]["fichiers"], 1);
    assert!(e["collections"][0].get("ajout").is_none());
}

#[test]
fn REQ105_AC1_AC2_AC4_collections_listees_fichiers_triés_suppression() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("ac105");
    let ligne = format!("v1 {}", "x".repeat(1500));
    ecrire(&s, "docs/b.md", &vec![ligne; 5].join("\n"));
    ecrire(&s, "docs/a.md", "v1 a\nv2 b");
    ecrire(&s, "api/z.md", "v3 z\n");
    configurer(&s, &adresse);
    // Pas de collection : liste vide.
    assert_eq!(s.etat()["collections"], json!([]));
    assert_eq!(s.ajouter("notes", &["docs/b.md", "docs/a.md"]).code, 202);
    s.attendre_fin();
    assert_eq!(s.ajouter("api", &["api"]).code, 202);
    s.attendre_fin();
    let e = s.etat();
    assert_eq!(
        e["collections"],
        json!([
            { "nom": "api", "fichiers": 1, "passages": 1 },
            { "nom": "notes", "fichiers": 2, "passages": 6 },
        ])
    );
    assert_eq!(s.fichiers("notes"), ["docs/a.md", "docs/b.md"]);
    let r = s.appel("GET", "/api/connaissance/collections/absente", &Value::Null);
    assert_eq!(r.code, 404);
    // Changer de modèle est refusé tant qu'une collection existe.
    let r = s.appel(
        "PUT",
        "/api/connaissance/config",
        &json!({ "provider": "ollama", "modele": "autre" }),
    );
    assert_eq!(r.code, 409);
    assert_eq!(r.json()["cause"], "collections");
    // Supprimer : la collection quitte la liste et le disque.
    let r = s.appel(
        "DELETE",
        "/api/connaissance/collections/notes",
        &Value::Null,
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(s.collection("notes").is_none());
    assert!(!s
        .projet
        .join(".yaide/connaissance/collections/notes")
        .exists());
    assert!(s.collection("api").is_some());
    let r = s.appel(
        "DELETE",
        "/api/connaissance/collections/notes",
        &Value::Null,
    );
    assert_eq!(r.code, 404);
    // Plus aucune collection : la configuration redevient modifiable.
    s.appel("DELETE", "/api/connaissance/collections/api", &Value::Null);
    let r = s.appel(
        "PUT",
        "/api/connaissance/config",
        &json!({ "provider": "ollama", "modele": "autre" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
}

#[test]
fn REQ106_AC1_AC2_AC5_recherche_classee_filtrée_et_erreur_du_provider() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac106");
    for n in 1..=12 {
        ecrire(&s, &format!("docs/f{n:02}.md"), &format!("v{n} texte {n}"));
    }
    ecrire(&s, "api/g.md", "v3 api");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    assert_eq!(s.ajouter("api", &["api"]).code, 202);
    s.attendre_fin();
    recues.lock().unwrap().clear();

    let r = s.chercher("v3", None);
    assert_eq!(r.code, 200, "{}", r.corps);
    let envoyes = recues.lock().unwrap().clone();
    assert_eq!(envoyes.len(), 1);
    assert_eq!(envoyes[0]["chemin"], "/embeddings");
    assert_eq!(envoyes[0]["input"], json!(["v3"]));
    let p = r.json()["passages"].as_array().unwrap().clone();
    assert_eq!(p.len(), 10);
    // Cosinus de [3, 1] avec [n, 1], calculé ici : classement attendu.
    let cos = |n: f32| (3.0 * n + 1.0) / (10f32.sqrt() * (n * n + 1.0).sqrt());
    let scores: Vec<f32> = p
        .iter()
        .map(|x| x["score"].as_f64().unwrap() as f32)
        .collect();
    assert!(scores.windows(2).all(|w| w[0] >= w[1]), "{scores:?}");
    let mut attendus: Vec<f32> = (1..=12).map(|n| cos(n as f32)).collect();
    attendus.push(cos(3.0));
    attendus.sort_by(|a, b| b.total_cmp(a));
    for (s, a) in scores.iter().zip(&attendus) {
        assert!((s - a).abs() < 1e-5, "{scores:?} / {attendus:?}");
    }
    // Les deux collections sont classées ensemble : f03 et g.md sont à 1,0.
    let tetes: Vec<(&str, &str)> = p[..2]
        .iter()
        .map(|x| {
            (
                x["chemin"].as_str().unwrap(),
                x["collection"].as_str().unwrap(),
            )
        })
        .collect();
    assert!(tetes.contains(&("docs/f03.md", "notes")), "{tetes:?}");
    assert!(tetes.contains(&("api/g.md", "api")), "{tetes:?}");
    assert_eq!(p[0]["debut"], 1);
    assert_eq!(p[0]["fin"], 1);
    assert!(p[0]["texte"].as_str().unwrap().starts_with("v3"));

    // Une collection : seuls ses passages ; moins de 10 passages, tous.
    let r = s.chercher("v3", Some("api"));
    let p = r.json()["passages"].as_array().unwrap().clone();
    assert_eq!(p.len(), 1);
    assert_eq!(p[0]["collection"], "api");
    // La casse du nom ne compte pas.
    assert_eq!(
        s.chercher("v3", Some("API")).json()["passages"][0]["collection"],
        "api"
    );
    assert_eq!(s.chercher("v3", Some("absente")).code, 404);
    assert_eq!(s.chercher("   ", None).code, 400);

    // Refus du provider : la cause, la réponse du provider, aucun résultat.
    let (refus, _) = faux_provider(vec![(401, 0)]);
    s.appel(
        "PUT",
        "/api/agent/providers/ollama",
        &json!({ "adresse": refus }),
    );
    let r = s.chercher("v3", None);
    assert_eq!(r.code, 502);
    let v = r.json();
    assert_eq!(v["message"], "Ollama a refusé la requête (401).");
    assert!(v["detail"].as_str().unwrap().contains("clé refusée"));
    assert!(v.get("passages").is_none());
    // Provider injoignable.
    s.appel(
        "PUT",
        "/api/agent/providers/ollama",
        &json!({ "adresse": format!("http://127.0.0.1:{}", port_libre()) }),
    );
    let r = s.chercher("v3", None);
    assert_eq!(r.code, 502);
    assert!(r.json()["message"]
        .as_str()
        .unwrap()
        .contains("injoignable"));
}

#[test]
fn REQ109_AC1_AC2_pointeurs_seuls_sur_disque_texte_relu_par_la_recherche() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("ac109");
    let longue = "é".repeat(5000);
    ecrire(&s, "docs/a.md", "v1 phrase secrète\r\nsuite\r\n");
    ecrire(&s, "docs/b.md", &format!("{longue}\n"));
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    assert_eq!(s.attendre_fin()["ajoutes"], 2);
    let dossier = s.projet.join(".yaide/connaissance/collections/notes");
    let mut contenu = String::new();
    for entree in std::fs::read_dir(&dossier).unwrap() {
        let chemin = entree.unwrap().path();
        let octets = std::fs::read(&chemin).unwrap();
        contenu.push_str(&String::from_utf8_lossy(&octets));
    }
    assert!(!contenu.contains("secrète") && !contenu.contains("éé"));
    let json: Value =
        serde_json::from_str(&std::fs::read_to_string(dossier.join("passages.json")).unwrap())
            .unwrap();
    let p = &json["fichiers"][0]["passages"][0];
    assert_eq!(p["chemin"], "docs/a.md");
    assert_eq!((p["debut"].as_u64(), p["fin"].as_u64()), (Some(1), Some(2)));
    let meta = std::fs::metadata(s.projet.join("docs/a.md")).unwrap();
    let f0 = &json["fichiers"][0];
    assert_eq!(f0["taille"].as_u64(), Some(meta.len()));
    let ns = meta
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    assert_eq!(f0["date"].as_u64().map(u128::from), Some(ns));
    assert_eq!(p["octet_debut"], 0);
    assert!(p["octet_fin"].as_u64().unwrap() > 0);
    let r = s.chercher("v1", Some("notes")).json();
    let textes: Vec<&str> = r["passages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["texte"].as_str().unwrap())
        .collect();
    assert_eq!(textes.len(), 4);
    assert!(textes.contains(&"v1 phrase secrète\r\nsuite"));
    assert_eq!(
        textes
            .iter()
            .filter(|t| t.chars().all(|c| c == 'é'))
            .count(),
        3
    );
}

/// Sonde jusqu'à 10 s que `cond` soit vraie.
fn attendre(quoi: &str, cond: impl Fn() -> bool) {
    let debut = Instant::now();
    while !cond() {
        assert!(debut.elapsed() < Duration::from_secs(10), "{quoi}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Les textes envoyés au provider depuis la requête `depuis`, dans l'ordre.
fn textes_depuis(r: &Recues, depuis: usize) -> Vec<String> {
    r.lock().unwrap()[depuis..]
        .iter()
        .flat_map(|q| q["input"].as_array().unwrap().clone())
        .map(|t| t.as_str().unwrap().to_string())
        .collect()
}

/// Les vecteurs d'une collection, dans l'ordre de ses fichiers (par chemin).
fn vecteurs_de(s: &Serveur, collection: &str) -> Vec<f32> {
    let p = s.projet.join(format!(
        ".yaide/connaissance/collections/{collection}/vecteurs.bin"
    ));
    std::fs::read(p)
        .unwrap()
        .chunks(4)
        .map(|o| f32::from_le_bytes(o.try_into().unwrap()))
        .collect()
}

fn date_gardee(s: &Serveur, collection: &str, chemin: &str) -> u128 {
    let p = s.projet.join(format!(
        ".yaide/connaissance/collections/{collection}/passages.json"
    ));
    let j: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    let f = j["fichiers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["chemin"] == chemin)
        .unwrap();
    f["date"].as_u64().unwrap().into()
}

fn attendre_numero(s: &Serveur, numero: u64) -> Value {
    let debut = Instant::now();
    loop {
        let ajout = s.etat()["ajout"].clone();
        if ajout["numero"] == numero && ajout["etat"] != "en_cours" {
            return ajout;
        }
        assert!(debut.elapsed() < Duration::from_secs(30), "ajout sans fin");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn REQ110_AC1_REQ112_donnees_fichier_modifie_remis_a_jour_dans_chaque_collection() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer_rapide("ac110-1");
    assert_eq!(s.etat()["fichiers"], json!({}));
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/b.md", "v2 deux\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    assert_eq!(s.ajouter("api", &["docs/a.md"]).code, 202);
    attendre_numero(&s, 2);
    let f = s.etat()["fichiers"].clone();
    assert_eq!(
        f["docs/a.md"],
        json!({ "collections": ["api", "notes"], "echec": null })
    );
    assert_eq!(
        f["docs/b.md"],
        json!({ "collections": ["notes"], "echec": null })
    );
    let avant = nombre_requetes(&recues);
    // Changement par écriture directe sur le disque.
    ecrire(&s, "docs/a.md", "v5 cinq\n");
    attendre("requête de a.md", || nombre_requetes(&recues) > avant);
    attendre("vecteurs de notes", || {
        vecteurs_de(&s, "notes") == [5.0, 1.0, 2.0, 1.0]
    });
    assert_eq!(vecteurs_de(&s, "api"), [5.0, 1.0]);
    assert_eq!(textes_depuis(&recues, avant), ["v5 cinq"]);
    let r = s.chercher("v5", Some("api")).json();
    assert_eq!(r["passages"][0]["texte"], "v5 cinq");
    // Changement par Ctrl+S (PUT /api/fichier).
    let avant = nombre_requetes(&recues);
    let r = s.appel("PUT", "/api/fichier?chemin=docs/a.md", &Value::Null);
    assert_eq!(r.code, 200, "{}", r.corps);
    let origine = format!("https://127.0.0.1:{}", s.port);
    let r = requete(
        s.port,
        "PUT",
        "/api/fichier?chemin=docs/a.md",
        &s.cookie,
        &origine,
        b"v7 sept\n",
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    attendre("requête après Ctrl+S", || {
        nombre_requetes(&recues) > avant
    });
    attendre("vecteurs après Ctrl+S", || {
        vecteurs_de(&s, "api") == [7.0, 1.0]
    });
    assert_eq!(textes_depuis(&recues, avant), ["v7 sept"]);
    assert_eq!(vecteurs_de(&s, "notes"), [7.0, 1.0, 2.0, 1.0]);
}

#[test]
fn REQ110_AC2_fichier_touche_sans_changement_de_contenu_aucune_requete() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer_rapide("ac110-2");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/b.md", "v2 deux\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    let avant = nombre_requetes(&recues);
    let ancienne = date_gardee(&s, "notes", "docs/a.md");
    let f = std::fs::File::options()
        .write(true)
        .open(s.projet.join("docs/a.md"))
        .unwrap();
    f.set_modified(std::time::SystemTime::now() + Duration::from_secs(60))
        .unwrap();
    // Un autre fichier change ensuite : sa requête prouve que la passe a eu lieu.
    ecrire(&s, "docs/b.md", "v3 trois\n");
    attendre("requête de b.md", || nombre_requetes(&recues) > avant);
    attendre("date de a.md réécrite", || {
        date_gardee(&s, "notes", "docs/a.md") != ancienne
    });
    assert_eq!(textes_depuis(&recues, avant), ["v3 trois"]);
    assert_eq!(vecteurs_de(&s, "notes"), [1.0, 1.0, 3.0, 1.0]);
}

#[test]
fn REQ110_AC3_fichier_supprime_binaire_ou_renomme_quitte_les_collections_sans_requete() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer_rapide("ac110-3");
    for (c, t) in [
        ("a", "v1 un"),
        ("b", "v2 deux"),
        ("d", "v4 q"),
        ("e", "v5 c"),
    ] {
        ecrire(&s, &format!("docs/{c}.md"), &format!("{t}\n"));
    }
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    assert_eq!(s.ajouter("api", &["docs/b.md"]).code, 202);
    attendre_numero(&s, 2);
    let avant = nombre_requetes(&recues);
    std::fs::remove_file(s.projet.join("docs/b.md")).unwrap();
    std::fs::write(s.projet.join("docs/d.md"), b"v4\0binaire").unwrap();
    std::fs::rename(s.projet.join("docs/e.md"), s.projet.join("docs/f.md")).unwrap();
    attendre("sortie des fichiers", || {
        s.fichiers("notes") == ["docs/a.md"]
    });
    assert_eq!(s.fichiers("api"), Vec::<String>::new());
    assert_eq!(vecteurs_de(&s, "notes"), [1.0, 1.0]);
    assert!(s.etat()["fichiers"]["docs/f.md"].is_null());
    assert_eq!(nombre_requetes(&recues), avant);
}

#[test]
fn REQ110_AC4_derniere_collection_videe_reste_a_zero() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer_rapide("ac110-4");
    ecrire(&s, "docs/a.md", "v1 un\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    std::fs::remove_file(s.projet.join("docs/a.md")).unwrap();
    attendre("collection vidée", || {
        s.collection("notes").is_some_and(|c| c["fichiers"] == 0)
    });
    let c = s.collection("notes").unwrap();
    assert_eq!(
        (c["fichiers"].clone(), c["passages"].clone()),
        (json!(0), json!(0))
    );
    assert_eq!(s.fichiers("notes"), Vec::<String>::new());
}

#[test]
fn REQ110_AC5_changements_pendant_l_arret_rattrapes_au_redemarrage() {
    let (adresse, recues) = faux_provider(vec![]);
    let racine = dossier("ac110-5");
    let s = demarrer_avec(&racine, "projet", Some("200"));
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/b.md", "v2 deux\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    let projet = s.projet.clone();
    drop(s);
    std::fs::write(projet.join("docs/a.md"), "v6 six\n").unwrap();
    std::fs::remove_file(projet.join("docs/b.md")).unwrap();
    let avant = nombre_requetes(&recues);
    let s = demarrer_avec(&racine, "projet", Some("200"));
    attendre("rattrapage", || s.fichiers("notes") == ["docs/a.md"]);
    attendre("vecteurs de a.md", || {
        vecteurs_de(&s, "notes") == [6.0, 1.0]
    });
    assert_eq!(textes_depuis(&recues, avant), ["v6 six"]);
}

#[test]
fn REQ110_AC6_REQ112_refus_du_provider_ancien_vecteurs_ecartes_sans_nouvelle_requete() {
    // 1re requête : l'ajout ; 2e : le refus.
    let (adresse, recues) = faux_provider(vec![(200, 0), (401, 0)]);
    let s = lancer_rapide("ac110-6");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/b.md", "v2 deux\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    ecrire(&s, "docs/a.md", "v5 cinq\n");
    attendre("cause de l'échec", || {
        s.etat()["fichiers"]["docs/a.md"]["echec"].is_string()
    });
    let cause = s.etat()["fichiers"]["docs/a.md"]["echec"].clone();
    assert!(cause.as_str().unwrap().contains("401"), "{cause}");
    assert_eq!(nombre_requetes(&recues), 2);
    // Anciens vecteurs gardés, mais la recherche n'en rend aucun passage.
    assert_eq!(vecteurs_de(&s, "notes"), [1.0, 1.0, 2.0, 1.0]);
    let r = s.chercher("v1", Some("notes")).json();
    let chemins: Vec<&str> = r["passages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["chemin"].as_str().unwrap())
        .collect();
    assert_eq!(chemins, ["docs/b.md"]);
    // Pas de nouvel essai tant que a.md ne change pas : la requête de b.md arrive seule.
    let avant = nombre_requetes(&recues);
    ecrire(&s, "docs/b.md", "v3 trois\n");
    attendre("requête de b.md", || nombre_requetes(&recues) > avant);
    assert_eq!(textes_depuis(&recues, avant - 1)[1..], ["v3 trois"]);
    assert!(s.etat()["fichiers"]["docs/a.md"]["echec"].is_string());
    // Modifié de nouveau : une nouvelle requête, et l'échec s'efface.
    let avant = nombre_requetes(&recues);
    ecrire(&s, "docs/a.md", "v8 huit\n");
    attendre("nouvelle requête de a.md", || {
        nombre_requetes(&recues) > avant
    });
    assert_eq!(textes_depuis(&recues, avant), ["v8 huit"]);
    attendre("échec effacé", || {
        s.etat()["fichiers"]["docs/a.md"]["echec"].is_null()
    });
    assert_eq!(vecteurs_de(&s, "notes"), [8.0, 1.0, 3.0, 1.0]);
}

#[test]
fn REQ110_AC7_aucune_mise_a_jour_pendant_un_ajout_et_ajout_non_refuse_pendant_une_mise_a_jour() {
    // 1 : ajout de a ; 2 : ajout de c (lent) ; 3 : mise à jour de a ; 4 : mise à jour lente de a ; 5 : ajout de d.
    let (adresse, recues) = faux_provider(vec![(200, 0), (200, 1000), (200, 0), (200, 1000)]);
    let s = lancer_rapide("ac110-7");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/c.md", "v3 trois\n");
    ecrire(&s, "docs/d.md", "v4 quatre\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs/a.md"]).code, 202);
    attendre_numero(&s, 1);
    assert_eq!(s.ajouter("notes", &["docs/c.md"]).code, 202);
    attendre("requête de l'ajout", || nombre_requetes(&recues) == 2);
    ecrire(&s, "docs/a.md", "v5 cinq\n");
    // Pendant l'ajout (1 s, plusieurs passes), a.md n'est pas envoyé.
    let debut = Instant::now();
    while s.etat()["ajout"]["etat"] == "en_cours" {
        assert_eq!(nombre_requetes(&recues), 2);
        assert!(debut.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(100));
    }
    attendre("mise à jour de a.md", || nombre_requetes(&recues) == 3);
    attendre("vecteurs de a.md", || {
        vecteurs_de(&s, "notes") == [5.0, 1.0, 3.0, 1.0]
    });
    assert_eq!(s.fichiers("notes"), ["docs/a.md", "docs/c.md"]);
    // Un ajout lancé pendant une mise à jour automatique n'est pas refusé.
    ecrire(&s, "docs/a.md", "v6 six\n");
    attendre("mise à jour lente", || nombre_requetes(&recues) == 4);
    let r = s.ajouter("notes", &["docs/d.md"]);
    assert_eq!(r.code, 202, "{}", r.corps);
    let fin = attendre_numero(&s, 3);
    assert_eq!(fin["etat"], "fini");
    assert_eq!(s.fichiers("notes"), ["docs/a.md", "docs/c.md", "docs/d.md"]);
    attendre("a.md remis à jour après l'ajout", || {
        vecteurs_de(&s, "notes") == [6.0, 1.0, 3.0, 1.0, 4.0, 1.0]
    });
}

#[test]
fn REQ112_donnees_fichiers_vides_si_la_base_est_illisible() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("ac112-illisible");
    ecrire(&s, "docs/a.md", "v1 un\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    assert!(s.etat()["fichiers"]["docs/a.md"].is_object());
    std::fs::write(s.config_json(), "{ pas du json").unwrap();
    let e = s.etat();
    assert!(e["erreur"].is_string());
    assert_eq!(e["fichiers"], json!({}));
}

impl Serveur {
    fn mettre_a_jour(&self, chemins: &[&str]) -> Rep {
        self.appel(
            "POST",
            "/api/connaissance/mises-a-jour",
            &json!({ "chemins": chemins }),
        )
    }
}

fn abimer_vecteurs(s: &Serveur, collection: &str, flottants: usize) {
    let p = s.projet.join(format!(
        ".yaide/connaissance/collections/{collection}/vecteurs.bin"
    ));
    let octets: Vec<u8> = (0..flottants).flat_map(|_| 9.0f32.to_le_bytes()).collect();
    std::fs::write(p, octets).unwrap();
}

#[test]
fn REQ111_AC1_fichier_inchange_renvoye_au_provider_et_remplace_dans_chaque_collection() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac111-1");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/b.md", "v2 deux\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    assert_eq!(s.ajouter("api", &["docs/a.md"]).code, 202);
    attendre_numero(&s, 2);
    abimer_vecteurs(&s, "notes", 4);
    abimer_vecteurs(&s, "api", 2);
    let avant = nombre_requetes(&recues);
    let r = s.mettre_a_jour(&["docs/a.md"]);
    assert_eq!(r.code, 202, "{}", r.corps);
    assert_eq!(r.json(), json!({ "numero": 3, "total": 1 }));
    let fin = attendre_numero(&s, 3);
    assert_eq!(fin["etat"], "fini");
    assert_eq!(fin["genre"], "mise_a_jour");
    assert_eq!(fin["collection"], "");
    assert_eq!(fin["ajoutes"], 1);
    assert_eq!(fin["faits"], 1);
    assert_eq!(textes_depuis(&recues, avant), ["v1 un"]);
    assert_eq!(vecteurs_de(&s, "api"), [1.0, 1.0]);
    // b.md, non visé, garde ce qu'il avait.
    assert_eq!(vecteurs_de(&s, "notes"), [1.0, 1.0, 9.0, 9.0]);
    assert_eq!(s.etat()["ajout"]["genre"], "mise_a_jour");
}

#[test]
fn REQ111_AC2_dossier_seuls_ses_fichiers_de_la_base_et_liste_de_deux_chemins() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac111-2");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/sous/b.md", "v2 deux\n");
    ecrire(&s, "docs/c.md", "v3 trois\n");
    configurer(&s, &adresse);
    assert_eq!(
        s.ajouter("notes", &["docs/a.md", "docs/sous/b.md"]).code,
        202
    );
    s.attendre_fin();
    let avant = nombre_requetes(&recues);
    let r = s.mettre_a_jour(&["docs"]);
    assert_eq!(r.code, 202, "{}", r.corps);
    assert_eq!(r.json()["total"], 2);
    let fin = attendre_numero(&s, 2);
    assert_eq!(fin["etat"], "fini");
    assert_eq!(fin["ajoutes"], 2);
    let mut textes = textes_depuis(&recues, avant);
    textes.sort();
    assert_eq!(textes, ["v1 un", "v2 deux"]);
    // Liste de deux chemins : un fichier et un dossier.
    let avant = nombre_requetes(&recues);
    let r = s.mettre_a_jour(&["docs/a.md", "docs/sous"]);
    assert_eq!(r.code, 202, "{}", r.corps);
    assert_eq!(r.json()["total"], 2);
    assert_eq!(attendre_numero(&s, 3)["ajoutes"], 2);
    assert_eq!(textes_depuis(&recues, avant).len(), 2);
    assert_eq!(s.fichiers("notes"), ["docs/a.md", "docs/sous/b.md"]);
}

#[test]
fn REQ111_chemin_sans_fichier_de_la_base_refuse_sans_requete() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac111-400");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/c.md", "v3 trois\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs/a.md"]).code, 202);
    s.attendre_fin();
    let avant = nombre_requetes(&recues);
    for chemins in [&["docs/c.md"][..], &["doc"], &["autre"]] {
        let r = s.mettre_a_jour(chemins);
        assert_eq!(r.code, 400, "{}", r.corps);
        assert_eq!(
            r.json()["message"],
            "Aucun fichier de la base dans ces chemins."
        );
    }
    assert_eq!(
        s.appel("POST", "/api/connaissance/mises-a-jour", &json!({}))
            .code,
        400
    );
    assert_eq!(nombre_requetes(&recues), avant);
    assert_eq!(s.etat()["ajout"]["numero"], 1);
}

#[test]
fn REQ111_refus_comme_l_ajout_base_non_configuree() {
    let s = lancer("ac111-nonconf");
    let r = s.mettre_a_jour(&["docs/a.md"]);
    assert_eq!(r.code, 409, "{}", r.corps);
    assert_eq!(r.json()["cause"], "non_configuree");
}

#[test]
fn REQ111_AC4_travail_en_cours_refuse_en_409_et_continue() {
    let (adresse, _) = faux_provider(vec![(200, 0), (200, 1500)]);
    let s = lancer("ac111-409");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/d.md", "v4 quatre\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs/a.md"]).code, 202);
    attendre_numero(&s, 1);
    // Mise à jour lente : ajout et seconde mise à jour refusés, elle continue.
    assert_eq!(s.mettre_a_jour(&["docs/a.md"]).code, 202);
    let r = s.ajouter("notes", &["docs/d.md"]);
    assert_eq!(r.code, 409);
    let r = s.mettre_a_jour(&["docs/a.md"]);
    assert_eq!(r.code, 409);
    assert_eq!(r.json()["cause"], "encours");
    assert_eq!(
        r.json()["message"],
        "Un ajout est déjà en cours. Attendez sa fin, puis réessayez."
    );
    let c = s.collection("notes").unwrap();
    assert!(c.get("ajout").is_none(), "{c}");
    assert_eq!(s.etat()["ajout"]["etat"], "en_cours");
    let fin = attendre_numero(&s, 2);
    assert_eq!(fin["etat"], "fini");
    assert_eq!(fin["ajoutes"], 1);
}

#[test]
fn REQ111_AC4_ajout_en_cours_refuse_la_mise_a_jour_et_continue() {
    let (adresse, _) = faux_provider(vec![(200, 0), (200, 1500)]);
    let s = lancer("ac111-409b");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/d.md", "v4 quatre\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs/a.md"]).code, 202);
    attendre_numero(&s, 1);
    assert_eq!(s.ajouter("notes", &["docs/d.md"]).code, 202);
    let r = s.mettre_a_jour(&["docs/a.md"]);
    assert_eq!(r.code, 409, "{}", r.corps);
    assert_eq!(r.json()["cause"], "encours");
    let fin = attendre_numero(&s, 2);
    assert_eq!(fin["etat"], "fini");
    assert_eq!(fin["genre"], "ajout");
    assert_eq!(s.fichiers("notes"), ["docs/a.md", "docs/d.md"]);
}

#[test]
fn REQ111_AC4_refus_401_arrete_la_mise_a_jour_les_fichiers_finis_restent_a_jour() {
    // Ajout (200), mise à jour de a.md (200), de b.md (401).
    let (adresse, recues) = faux_provider(vec![(200, 0), (200, 0), (401, 0)]);
    let s = lancer("ac111-401");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/b.md", "v2 deux\n");
    ecrire(&s, "docs/c.md", "v3 trois\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    abimer_vecteurs(&s, "notes", 6);
    assert_eq!(s.mettre_a_jour(&["docs"]).code, 202);
    let fin = attendre_numero(&s, 2);
    assert_eq!(fin["etat"], "arrete");
    assert_eq!(fin["genre"], "mise_a_jour");
    assert_eq!(fin["cause"], "Ollama a refusé la requête (401).");
    assert!(fin["detail"].as_str().unwrap().contains("clé refusée"));
    assert_eq!(fin["ajoutes"], 1);
    assert_eq!(nombre_requetes(&recues), 3);
    assert_eq!(vecteurs_de(&s, "notes"), [1.0, 1.0, 9.0, 9.0, 9.0, 9.0]);
}

#[test]
fn REQ111_fichier_supprime_quitte_ses_collections_sans_etre_compte() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac111-suppr");
    ecrire(&s, "docs/a.md", "v1 un\n");
    ecrire(&s, "docs/b.md", "v2 deux\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    s.attendre_fin();
    let avant = nombre_requetes(&recues);
    std::fs::remove_file(s.projet.join("docs/a.md")).unwrap();
    let r = s.mettre_a_jour(&["docs"]);
    // La passe automatique a pu retirer a.md avant la demande : le total varie, pas le résultat.
    assert_eq!(r.code, 202, "{}", r.corps);
    let fin = attendre_numero(&s, 2);
    assert_eq!(fin["etat"], "fini");
    assert_eq!(fin["ajoutes"], 1);
    assert_eq!(s.fichiers("notes"), ["docs/b.md"]);
    assert_eq!(textes_depuis(&recues, avant), ["v2 deux"]);
}

impl Serveur {
    fn ajouter_decoupe(&self, collection: &str, chemins: &[&str], decoupage: Value) -> Rep {
        self.appel(
            "POST",
            "/api/connaissance/ajouts",
            &json!({ "collection": collection, "chemins": chemins, "decoupage": decoupage }),
        )
    }

    fn decoupage_de(&self, nom: &str) -> Value {
        let r = self.appel(
            "GET",
            &format!("/api/connaissance/collections/{nom}"),
            &Value::Null,
        );
        assert_eq!(r.code, 200, "{}", r.corps);
        r.json()["decoupage"].clone()
    }
}

/// Lignes (début, fin) des passages d'un fichier, lues dans `passages.json`.
fn lignes_de(s: &Serveur, collection: &str, chemin: &str) -> Vec<(u64, u64)> {
    let p = s.projet.join(format!(
        ".yaide/connaissance/collections/{collection}/passages.json"
    ));
    let v: Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
    v["fichiers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["chemin"] == chemin)
        .map(|f| {
            f["passages"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (p["debut"].as_u64().unwrap(), p["fin"].as_u64().unwrap()))
                .collect()
        })
        .unwrap_or_default()
}

/// Paragraphes de 150 caractères séparés par une ligne vide, le premier mot `v<n>`.
fn paragraphes(debut: u32, n: u32) -> String {
    (0..n)
        .map(|i| format!("v{} {}\n", debut + i, "x".repeat(147)))
        .collect::<Vec<_>>()
        .join("\n")
}

const PAR_200: fn() -> Value =
    || json!({ "strategie": "paragraphes", "taille": 200, "recouvrement": 0 });

#[test]
fn REQ113_AC1_sans_decoupage_le_defaut_est_garde_et_rendu() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("ac113-1");
    ecrire(&s, "docs/a.md", "v1 un\n");
    configurer(&s, &adresse);
    assert_eq!(s.ajouter("notes", &["docs"]).code, 202);
    assert_eq!(s.attendre_fin()["etat"], "fini");
    let attendu = json!({ "strategie": "taille_fixe", "taille": 2000, "recouvrement": 0 });
    let p = s
        .projet
        .join(".yaide/connaissance/collections/notes/passages.json");
    let v: Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
    assert_eq!(v["decoupage"], attendu);
    assert_eq!(s.decoupage_de("notes"), attendu);
}

#[test]
fn REQ113_AC5_decoupage_refuse_rien_n_est_cree_ni_envoye() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("ac113-5");
    ecrire(&s, "docs/a.md", "v1 un\n");
    configurer(&s, &adresse);
    let taille = "Entre 200 et 8\u{a0}000 caractères.";
    let recouvrement = "Entre 0 et 10 lignes.";
    let cas = [
        (json!({ "taille": 150 }), "taille", taille),
        (json!({ "taille": 8001 }), "taille", taille),
        (json!({ "taille": "2000" }), "taille", taille),
        (json!({ "taille": 1.5 }), "taille", taille),
        (json!({ "taille": -1 }), "taille", taille),
        (json!({ "recouvrement": 11 }), "recouvrement", recouvrement),
        (json!({ "recouvrement": "1" }), "recouvrement", recouvrement),
        (
            json!({ "strategie": "inconnue" }),
            "strategie",
            "Découpage illisible.",
        ),
        (json!("taille_fixe"), "strategie", "Découpage illisible."),
    ];
    for (d, cause, message) in cas {
        let r = s.ajouter_decoupe("notes", &["docs"], d.clone());
        assert_eq!(r.code, 400, "{d} : {}", r.corps);
        assert_eq!(r.json()["cause"], cause, "{d}");
        assert_eq!(r.json()["message"], message, "{d}");
    }
    assert_eq!(nombre_requetes(&recues), 0);
    assert!(s.collection("notes").is_none());
    assert!(!s.projet.join(".yaide/connaissance/collections").exists());
    // Les bornes sont acceptées.
    let r = s.ajouter_decoupe(
        "notes",
        &["docs"],
        json!({ "strategie": "taille_fixe", "taille": 200, "recouvrement": 10 }),
    );
    assert_eq!(r.code, 202, "{}", r.corps);
}

#[test]
fn REQ113_AC6_chaque_collection_garde_son_decoupage_pour_ajouts_et_mises_a_jour() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer_rapide("ac113-6");
    ecrire(&s, "docs/a.md", &paragraphes(1, 2));
    ecrire(&s, "docs/c.md", &paragraphes(7, 2));
    configurer(&s, &adresse);
    let fixe = json!({ "strategie": "taille_fixe", "taille": 200, "recouvrement": 0 });
    assert_eq!(
        s.ajouter_decoupe("notes", &["docs/a.md"], PAR_200()).code,
        202
    );
    s.attendre_fin();
    assert_eq!(
        s.ajouter_decoupe("api", &["docs/a.md"], fixe.clone()).code,
        202
    );
    s.attendre_fin();
    assert_eq!(lignes_de(&s, "notes", "docs/a.md"), [(1, 1), (3, 3)]);
    assert_eq!(lignes_de(&s, "api", "docs/a.md"), [(1, 2), (3, 3)]);
    // Ajout à une collection existante (casse ignorée) : le découpage reçu est ignoré, même invalide.
    let r = s.ajouter_decoupe(
        "Notes",
        &["docs/c.md"],
        json!({ "strategie": "x", "taille": 3 }),
    );
    assert_eq!(r.code, 202, "{}", r.corps);
    assert_eq!(r.json()["collection"], "notes");
    assert_eq!(s.attendre_fin()["etat"], "fini");
    assert_eq!(lignes_de(&s, "notes", "docs/c.md"), [(1, 1), (3, 3)]);
    let r = s.ajouter_decoupe("api", &["docs/c.md"], PAR_200());
    assert_eq!(r.code, 202);
    s.attendre_fin();
    assert_eq!(lignes_de(&s, "api", "docs/c.md"), [(1, 2), (3, 3)]);
    assert_eq!(s.decoupage_de("Notes"), PAR_200());
    assert_eq!(s.decoupage_de("api"), fixe);
    // Mise à jour automatique : trois paragraphes, un appel par découpage distinct.
    let avant = nombre_requetes(&recues);
    ecrire(&s, "docs/a.md", &paragraphes(3, 3));
    attendre("mise à jour automatique", || {
        lignes_de(&s, "notes", "docs/a.md") == [(1, 1), (3, 3), (5, 5)]
            && lignes_de(&s, "api", "docs/a.md") == [(1, 2), (3, 4), (5, 5)]
    });
    assert_eq!(nombre_requetes(&recues) - avant, 2);
    // Mise à jour à la main.
    let avant = nombre_requetes(&recues);
    let r = s.mettre_a_jour(&["docs/a.md"]);
    assert_eq!(r.code, 202, "{}", r.corps);
    attendre_numero(&s, r.json()["numero"].as_u64().unwrap());
    assert_eq!(nombre_requetes(&recues) - avant, 2);
    assert_eq!(
        lignes_de(&s, "notes", "docs/a.md"),
        [(1, 1), (3, 3), (5, 5)]
    );
    assert_eq!(lignes_de(&s, "api", "docs/a.md"), [(1, 2), (3, 4), (5, 5)]);
}

#[test]
fn REQ113_AC7_decoupage_relu_au_redemarrage_et_ancien_format_en_defaut() {
    let (adresse, _) = faux_provider(vec![]);
    let racine = dossier("ac113-7");
    let s = demarrer(&racine, "projet");
    ecrire(&s, "docs/a.md", &paragraphes(1, 2));
    configurer(&s, &adresse);
    assert_eq!(s.ajouter_decoupe("notes", &["docs"], PAR_200()).code, 202);
    s.attendre_fin();
    assert_eq!(s.ajouter("api", &["docs"]).code, 202);
    s.attendre_fin();
    // `api` est écrit comme avant cette évolution : sans `decoupage`.
    let p = s
        .projet
        .join(".yaide/connaissance/collections/api/passages.json");
    let mut v: Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
    assert!(v.as_object_mut().unwrap().remove("decoupage").is_some());
    std::fs::write(&p, v.to_string()).unwrap();
    drop(s);
    let s = demarrer(&racine, "projet");
    assert_eq!(s.decoupage_de("notes"), PAR_200());
    assert_eq!(
        s.decoupage_de("api"),
        json!({ "strategie": "taille_fixe", "taille": 2000, "recouvrement": 0 })
    );
    assert!(s.collection("api").is_some());
    assert_eq!(s.fichiers("api"), ["docs/a.md"]);
    let r = s.chercher("v1", Some("api"));
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(!r.json()["passages"].as_array().unwrap().is_empty());
}
