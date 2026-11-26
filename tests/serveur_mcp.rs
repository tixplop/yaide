#![allow(non_snake_case)]
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::Duration;

const EXE: &str = env!("CARGO_BIN_EXE_yaide");

struct Inst {
    child: Child,
    port: u16,
    cookie: String,
    projet: PathBuf,
    racine: PathBuf,
    lignes: Vec<String>,
}

impl Drop for Inst {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Un port `p` de Yaide dont les ports `p+1000` à `p+1010` sont libres sur 127.0.0.1.
fn port_yaide() -> u16 {
    loop {
        let p = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        if !(20000..=60000).contains(&p) {
            continue;
        }
        if (p + 1000..=p + 1010).all(|m| std::net::TcpListener::bind(("127.0.0.1", m)).is_ok()) {
            return p;
        }
    }
}

fn curl(args: &[String], corps: &[u8]) -> (u16, String, String) {
    let mut enfant = Command::new("curl")
        .args(["-sk", "-i", "--max-time", "20"])
        .args(args)
        .args(["--data-binary", "@-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
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
    (code, entetes, corps)
}

impl Inst {
    fn api(
        &self,
        methode: &str,
        chemin: &str,
        cookie: bool,
        origine: &str,
        corps: &Value,
    ) -> (u16, String) {
        let mut a = vec![
            "-X".to_string(),
            methode.to_string(),
            format!("https://127.0.0.1:{}{chemin}", self.port),
        ];
        if !origine.is_empty() {
            a.extend(["-H".into(), format!("Origin: {origine}")]);
        }
        if cookie {
            a.extend(["-H".into(), format!("Cookie: {}", self.cookie)]);
        }
        let c = if corps.is_null() {
            String::new()
        } else {
            corps.to_string()
        };
        let (code, _, rep) = curl(&a, c.as_bytes());
        (code, rep)
    }
    fn appel(&self, methode: &str, chemin: &str, corps: &Value) -> (u16, Value) {
        let (code, rep) = self.api(
            methode,
            chemin,
            true,
            &format!("https://127.0.0.1:{}", self.port),
            corps,
        );
        (code, serde_json::from_str(&rep).unwrap_or(Value::Null))
    }
    fn mcp(&self) -> u16 {
        let l = self
            .lignes
            .iter()
            .find(|l| l.starts_with("Serveur MCP : "))
            .expect("pas de ligne MCP");
        l.trim_end_matches("/mcp")
            .rsplit(':')
            .next()
            .unwrap()
            .parse()
            .unwrap()
    }
}

fn racine(nom: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("serveur-mcp-{nom}-{}", std::process::id()));
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

/// Lance Yaide sur le port `port` et lit sa sortie jusqu'à la ligne du serveur MCP.
fn lancer(racine: &Path, port: u16) -> Inst {
    let projet = racine.join("projet");
    std::fs::create_dir_all(&projet).unwrap();
    let mut child = Command::new(EXE)
        .arg(&projet)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", racine.join("cfg"))
        .env("HOME", racine)
        .env("GIT_CEILING_DIRECTORIES", racine)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let sortie: ChildStdout = child.stdout.take().unwrap();
    let mut lecteur = BufReader::new(sortie);
    let mut lignes = vec![];
    loop {
        let mut l = String::new();
        assert!(
            lecteur.read_line(&mut l).unwrap() > 0,
            "sortie close : {lignes:?}"
        );
        let l = l.trim_end().to_string();
        let fin = l.starts_with("Serveur MCP");
        lignes.push(l);
        if fin {
            break;
        }
    }
    // La sortie reste ouverte : Yaide ne doit pas dépendre d'elle.
    std::mem::forget(lecteur);
    let mut s = Inst {
        child,
        port,
        cookie: String::new(),
        projet,
        racine: racine.to_path_buf(),
        lignes,
    };
    let origine = format!("https://127.0.0.1:{port}");
    for _ in 0..1000 {
        if s.api("GET", "/api/info", false, "", &Value::Null).0 == 200 {
            let a = vec![
                "-i".to_string(),
                "-X".into(),
                "POST".into(),
                format!("https://127.0.0.1:{port}/api/connexion"),
                "-H".into(),
                format!("Origin: {origine}"),
            ];
            let (_, entetes, _) = curl(&a, b"mdp");
            let ligne = entetes
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

fn nouvelle(nom: &str) -> Inst {
    lancer(&racine(nom), port_yaide())
}

/// Un client du serveur MCP, en HTTP simple.
struct Client {
    port: u16,
    session: Option<String>,
}

fn analyser(corps: &str) -> Value {
    let donnees: Vec<&str> = corps
        .lines()
        .filter_map(|l| l.strip_prefix("data:"))
        .map(str::trim)
        .collect();
    donnees
        .iter()
        .rev()
        .find_map(|d| {
            serde_json::from_str::<Value>(d)
                .ok()
                .filter(|v| v.get("id").is_some())
        })
        .or_else(|| serde_json::from_str(corps.trim()).ok())
        .unwrap_or(Value::Null)
}

impl Client {
    fn envoyer(&mut self, entetes: &[(&str, &str)], corps: &Value) -> (u16, Value) {
        let mut a = vec![
            "-X".to_string(),
            "POST".into(),
            format!("http://127.0.0.1:{}/mcp", self.port),
            "-H".into(),
            "Content-Type: application/json".into(),
            "-H".into(),
            "Accept: application/json, text/event-stream".into(),
        ];
        if let Some(s) = &self.session {
            a.extend(["-H".into(), format!("Mcp-Session-Id: {s}")]);
        }
        for (n, v) in entetes {
            a.extend(["-H".into(), format!("{n}: {v}")]);
        }
        let (code, h, rep) = curl(&a, corps.to_string().as_bytes());
        if let Some(l) = h
            .lines()
            .find(|l| l.to_lowercase().starts_with("mcp-session-id:"))
        {
            self.session = Some(l[15..].trim().to_string());
        }
        (code, analyser(&rep))
    }
    /// `initialize` puis la notification `initialized`.
    fn ouvrir(port: u16, entetes: &[(&str, &str)]) -> (Client, u16, Value) {
        let mut c = Client {
            port,
            session: None,
        };
        let (code, v) = c.envoyer(
            entetes,
            &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-06-18", "capabilities": {},
                "clientInfo": {"name": "test", "version": "1"}}}),
        );
        if code == 200 {
            c.envoyer(
                entetes,
                &json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            );
        }
        (c, code, v)
    }
    fn requete(&mut self, entetes: &[(&str, &str)], methode: &str, params: Value) -> (u16, Value) {
        self.envoyer(
            entetes,
            &json!({"jsonrpc": "2.0", "id": 2, "method": methode, "params": params}),
        )
    }
    fn outils(&mut self) -> Vec<Value> {
        let (code, v) = self.requete(&[], "tools/list", json!({}));
        assert_eq!(code, 200, "{v}");
        v["result"]["tools"]
            .as_array()
            .unwrap_or_else(|| panic!("{v}"))
            .clone()
    }
    /// (isError, texte)
    fn appeler(&mut self, nom: &str, arguments: Value) -> (bool, String) {
        let (code, v) = self.requete(
            &[],
            "tools/call",
            json!({"name": nom, "arguments": arguments}),
        );
        assert_eq!(code, 200, "{v}");
        let r = &v["result"];
        (
            r["isError"] == true,
            r["content"][0]["text"]
                .as_str()
                .unwrap_or_else(|| panic!("{v}"))
                .to_string(),
        )
    }
}

fn ecoute_loopback_seulement(port: u16) -> bool {
    let hex = format!("{port:04X}");
    let tcp = std::fs::read_to_string("/proc/net/tcp").unwrap_or_default()
        + &std::fs::read_to_string("/proc/net/tcp6").unwrap_or_default();
    let ecoutes: Vec<&str> = tcp
        .lines()
        .filter_map(|l| {
            let c: Vec<&str> = l.split_whitespace().collect();
            (c.len() > 3 && c[3] == "0A" && c[1].ends_with(&format!(":{hex}"))).then_some(c[1])
        })
        .collect();
    !ecoutes.is_empty() && ecoutes.iter().all(|a| a.starts_with("0100007F:"))
}

fn fichiers(d: &Path) -> Vec<String> {
    let mut v = vec![];
    fn parcourir(d: &Path, base: &Path, v: &mut Vec<String>) {
        if let Ok(it) = std::fs::read_dir(d) {
            for e in it.flatten() {
                let p = e.path();
                v.push(p.strip_prefix(base).unwrap().display().to_string());
                if p.is_dir() {
                    parcourir(&p, base, v);
                }
            }
        }
    }
    parcourir(d, d, &mut v);
    v.sort();
    v
}

#[test]
fn REQ189_AC1_AC3_adresse_affichee_initialize_loopback_sans_jeton_ni_fichier() {
    let s = nouvelle("ac1");
    let m = s.port + 1000;
    assert_eq!(
        s.lignes.last().unwrap(),
        &format!("Serveur MCP : http://127.0.0.1:{m}/mcp")
    );
    assert!(ecoute_loopback_seulement(m));
    let avant = (
        fichiers(&s.racine.join("cfg")),
        fichiers(&s.projet.join(".yaide")),
    );
    let (mut c, code, v) = Client::ouvrir(m, &[]);
    assert_eq!(code, 200, "{v}");
    assert!(v["result"]["capabilities"]["tools"].is_object(), "{v}");
    assert!(!c.outils().is_empty());
    let apres = (
        fichiers(&s.racine.join("cfg")),
        fichiers(&s.projet.join(".yaide")),
    );
    assert_eq!(avant, apres);
}

#[test]
fn REQ189_AC2_port_occupe_puis_tous_occupes() {
    let p = port_yaide();
    let _a = std::net::TcpListener::bind(("127.0.0.1", p + 1000)).unwrap();
    let s = lancer(&racine("ac2a"), p);
    assert_eq!(
        s.lignes.last().unwrap(),
        &format!("Serveur MCP : http://127.0.0.1:{}/mcp", p + 1001)
    );
    assert_eq!(s.mcp(), p + 1001);
    assert_eq!(Client::ouvrir(p + 1001, &[]).1, 200);
    drop(s);

    let p = port_yaide();
    let _tous: Vec<_> = (p + 1000..=p + 1010)
        .map(|m| std::net::TcpListener::bind(("127.0.0.1", m)).unwrap())
        .collect();
    let s = lancer(&racine("ac2b"), p);
    let message = format!(
        "Serveur MCP indisponible : les ports {} à {} sont occupés.",
        p + 1000,
        p + 1010
    );
    assert_eq!(s.lignes.last().unwrap(), &message);
    assert_eq!(s.api("GET", "/", false, "", &Value::Null).0, 200);
    let (_, j) = s.appel("GET", "/api/journal", &Value::Null);
    let ligne = j["lignes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["message"] == message)
        .unwrap_or_else(|| panic!("{j}"));
    assert_eq!(ligne["severite"], "Erreur");
}

#[test]
fn REQ189_AC4_origin_etranger_et_host_refuses_sans_outil_lance() {
    let s = nouvelle("ac4");
    let m = s.mcp();
    let (mut c, code, _) = Client::ouvrir(m, &[]);
    assert_eq!(code, 200);
    for origine in [
        "http://exemple.test".to_string(),
        format!("https://localhost:{}", s.port),
        format!("http://127.0.0.1:{}", m + 1),
    ] {
        let o = [("Origin", origine.as_str())];
        assert_eq!(Client::ouvrir(m, &o).1, 403, "{origine}");
        assert_eq!(c.requete(&o, "tools/list", json!({})).0, 403, "{origine}");
        let appel = json!({"name": "write", "arguments": {"path": "intrus.txt", "content": "x"}});
        assert_eq!(c.requete(&o, "tools/call", appel).0, 403, "{origine}");
    }
    assert!(!s.projet.join("intrus.txt").exists());
    for origine in [
        format!("http://127.0.0.1:{m}"),
        format!("http://localhost:{m}"),
    ] {
        let o = [("Origin", origine.as_str())];
        assert_eq!(Client::ouvrir(m, &o).1, 200, "{origine}");
        assert_eq!(c.requete(&o, "tools/list", json!({})).0, 200, "{origine}");
    }
    let h = format!("exemple.test:{m}");
    let ho = [("Host", h.as_str())];
    assert_eq!(Client::ouvrir(m, &ho).1, 403);
    let appel = json!({"name": "write", "arguments": {"path": "intrus.txt", "content": "x"}});
    assert_eq!(c.requete(&ho, "tools/call", appel).0, 403);
    assert!(!s.projet.join("intrus.txt").exists());
    for h in [format!("localhost:{m}"), "[::1]".to_string()] {
        let ho = [("Host", h.as_str())];
        assert_eq!(c.requete(&ho, "tools/list", json!({})).0, 200, "{h}");
    }
}

type Recues = std::sync::Arc<std::sync::Mutex<Vec<Value>>>;

/// Faux provider : répond « ok » à une conversation et un vecteur à `/embeddings`.
fn faux_provider() -> (String, Recues) {
    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::Uri;
    async fn rep(State(r): State<Recues>, uri: Uri, corps: Bytes) -> String {
        let v: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
        if uri.path().ends_with("/embeddings") {
            let n = v["input"].as_array().map_or(0, Vec::len);
            let data: Vec<Value> = (0..n)
                .map(|i| json!({"index": i, "embedding": [1.0, 0.0]}))
                .collect();
            return json!({ "data": data }).to_string();
        }
        r.lock().unwrap().push(v);
        json!({"choices": [{"message": {"content": "ok"}}],
               "usage": {"prompt_tokens": 7, "completion_tokens": 1}})
        .to_string()
    }
    let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    ecoute.set_nonblocking(true).unwrap();
    let adresse = format!("http://{}", ecoute.local_addr().unwrap());
    let recues: Recues = Default::default();
    let r = recues.clone();
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(async move {
                let app = axum::Router::new().fallback(rep).with_state(r);
                let ecoute = tokio::net::TcpListener::from_std(ecoute).unwrap();
                axum::serve(ecoute, app).await.unwrap();
            });
    });
    (adresse, recues)
}

/// Enregistre le provider `openai` et un profil ; rend l'id du profil.
fn configurer(s: &Inst, adresse: &str, cle: &str) -> String {
    let (code, _) = s.appel(
        "PUT",
        "/api/agent/providers/openai",
        &json!({"adresse": adresse, "cle": cle}),
    );
    assert_eq!(code, 200);
    let (code, v) = s.appel(
        "PUT",
        "/api/agent/profils",
        &json!({"nom": "openai", "provider": "openai", "modele": "m"}),
    );
    assert_eq!(code, 200);
    v["profils"].as_array().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn conversation(s: &Inst, profil: &str, recues: &Recues) -> Value {
    let avant = recues.lock().unwrap().len();
    let (code, v) = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({"profil": profil, "texte": "salut"}),
    );
    assert_eq!(code, 200);
    let id = v["conversation"].as_str().unwrap().to_string();
    for _ in 0..200 {
        let (_, c) = s.appel(
            "GET",
            &format!("/api/agent/conversations/{id}"),
            &Value::Null,
        );
        if c["enCours"] == false {
            return recues.lock().unwrap()[avant].clone();
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("le tour ne finit pas");
}

fn comparer(requete: &Value, outils: &[Value]) {
    let attendus: Vec<Value> = requete["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            let f = &t["function"];
            json!({"name": f["name"], "description": f["description"], "inputSchema": f["parameters"]})
        })
        .collect();
    let obtenus: Vec<Value> = outils
        .iter()
        .map(|t| json!({"name": t["name"], "description": t["description"], "inputSchema": t["inputSchema"]}))
        .collect();
    assert!(!obtenus.is_empty());
    assert_eq!(obtenus, attendus);
}

#[test]
fn REQ189_AC5_liste_des_outils_identique_a_celle_d_une_conversation() {
    let s = nouvelle("ac5");
    let (adresse, recues) = faux_provider();
    let profil = configurer(&s, &adresse, "sk-x");
    let (mut c, _, _) = Client::ouvrir(s.mcp(), &[]);
    let outils = c.outils();
    let noms: Vec<&str> = outils.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(noms.contains(&"read") && noms.contains(&"subagent"));
    assert!(!noms
        .iter()
        .any(|n| n.starts_with("mcp__") || n.starts_with("knowledge")));
    comparer(&conversation(&s, &profil, &recues), &outils);

    std::fs::write(s.projet.join("doc.md"), "du texte").unwrap();
    let (code, _) = s.appel(
        "PUT",
        "/api/connaissance/config",
        &json!({"provider": "openai", "modele": "m-embed"}),
    );
    assert_eq!(code, 200);
    let (code, _) = s.appel(
        "POST",
        "/api/connaissance/ajouts",
        &json!({"collection": "docs", "chemins": ["doc.md"]}),
    );
    assert_eq!(code, 202);
    for _ in 0..300 {
        let (_, a) = s.appel("GET", "/api/connaissance", &Value::Null);
        if !a["ajout"].is_null() && a["ajout"]["etat"] != "en_cours" {
            assert_eq!(a["ajout"]["etat"], "fini", "{a}");
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let outils = c.outils();
    let noms: Vec<&str> = outils.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(
        noms.contains(&"knowledge_list") && noms.contains(&"knowledge_search"),
        "{noms:?}"
    );
    comparer(&conversation(&s, &profil, &recues), &outils);
}

#[test]
fn REQ189_AC6_appels_d_outils_comme_pour_un_agent() {
    let s = nouvelle("ac6");
    let profil = configurer(&s, "http://127.0.0.1:9", "sk-secret-123");
    let (mut c, _, _) = Client::ouvrir(s.mcp(), &[]);
    let (erreur, texte) = c.appeler("write", json!({"path": "notes/a.md", "content": "bonjour"}));
    assert!(!erreur, "{texte}");
    assert_eq!(
        std::fs::read_to_string(s.projet.join("notes/a.md")).unwrap(),
        "bonjour"
    );
    let (erreur, texte) = c.appeler("read", json!({"path": "notes/a.md"}));
    assert!(!erreur);
    assert_eq!(texte, "bonjour");
    let (erreur, texte) = c.appeler("read", json!({"path": "../x"}));
    assert!(erreur);
    assert_eq!(texte, "The path is outside the project.");
    let (erreur, texte) = c.appeler("bash", json!({"command": "exit 1"}));
    assert!(erreur, "{texte}");
    assert_eq!(texte, "Exit code: 1");
    let (erreur, texte) = c.appeler("save_agent", json!({"name": "Relecteur"}));
    assert!(!erreur, "{texte}");
    assert!(s.projet.join(".yaide/agents").is_dir());
    let (erreur, texte) = c.appeler("list_agents", json!({}));
    assert!(!erreur && texte.contains("Relecteur"), "{texte}");
    let (erreur, texte) = c.appeler("get_config", json!({}));
    assert!(!erreur, "{texte}");
    assert!(!texte.contains("sk-secret-123"));
    let vue: Value = serde_json::from_str(&texte).unwrap();
    let cfg = s.racine.join("cfg/yaide");
    assert_eq!(
        vue["files"],
        json!({"config": cfg.join("config.json"), "interface": s.projet.join(".yaide/interface.json"),
               "mcp": cfg.join("mcp.json")})
    );
    assert_eq!(
        vue["profiles"],
        json!([{"context_window": null, "default": true, "effort": null, "id": profil,
                "max_output_tokens": null, "model": "m", "name": "openai", "provider": "openai",
                "temperature": null}])
    );
    assert_eq!(
        vue["providers"][0],
        json!({"has_key": true, "id": "openai", "name": "OpenAI", "url": "http://127.0.0.1:9"})
    );
    assert_eq!(vue["mcp_servers"], json!([]));
    let (erreur, texte) = c.appeler("mcp__x__y", json!({}));
    assert!(erreur, "{texte}");
    let (erreur, _) = c.appeler("subagent", json!({"prompt": "x"}));
    assert!(erreur);
}

#[test]
fn REQ189_AC9_route_de_l_adresse_derriere_la_session_et_l_origine() {
    let s = nouvelle("ac9");
    let origine = format!("https://127.0.0.1:{}", s.port);
    assert_eq!(
        s.api("GET", "/api/serveur-mcp", false, &origine, &Value::Null)
            .0,
        401
    );
    let (code, _) = s.api(
        "GET",
        "/api/serveur-mcp",
        true,
        "http://exemple.test",
        &Value::Null,
    );
    assert_eq!(code, 403);
    let (code, v) = s.appel("GET", "/api/serveur-mcp", &Value::Null);
    assert_eq!(code, 200);
    assert_eq!(
        v,
        json!({"adresse": format!("http://127.0.0.1:{}/mcp", s.port + 1000)})
    );
    let (code, _) = s.api("GET", "/api/serveur-mcp", true, "", &Value::Null);
    assert_eq!(code, 200);

    let p = port_yaide();
    let _tous: Vec<_> = (p + 1000..=p + 1010)
        .map(|m| std::net::TcpListener::bind(("127.0.0.1", m)).unwrap())
        .collect();
    let s = lancer(&racine("ac9b"), p);
    let (_, v) = s.appel("GET", "/api/serveur-mcp", &Value::Null);
    assert_eq!(v, json!({"indisponible": {"de": p + 1000, "a": p + 1010}}));
}

type Scenario = std::sync::Arc<std::sync::Mutex<(Vec<Value>, Vec<Value>)>>;

/// Faux provider scénarisé : rend les réponses dans l'ordre (la dernière se répète), après
/// `delai` ms, et garde les requêtes reçues. Rend (adresse, (réponses, requêtes)).
fn provider_scenarise(reponses: Vec<Value>, delai: u64) -> (String, Scenario) {
    use axum::body::Bytes;
    use axum::extract::State;
    async fn rep(State((e, delai)): State<(Scenario, u64)>, corps: Bytes) -> String {
        let v: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
        let r = {
            let mut g = e.lock().unwrap();
            g.1.push(v);
            let n = g.1.len();
            g.0[(n - 1).min(g.0.len() - 1)].clone()
        };
        tokio::time::sleep(Duration::from_millis(delai)).await;
        r.to_string()
    }
    let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    ecoute.set_nonblocking(true).unwrap();
    let adresse = format!("http://{}", ecoute.local_addr().unwrap());
    let etat: Scenario = std::sync::Arc::new(std::sync::Mutex::new((reponses, vec![])));
    let e = etat.clone();
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(async move {
                let app = axum::Router::new().fallback(rep).with_state((e, delai));
                let ecoute = tokio::net::TcpListener::from_std(ecoute).unwrap();
                axum::serve(ecoute, app).await.unwrap();
            });
    });
    (adresse, etat)
}

fn lire_readme() -> Value {
    json!({"choices": [{"message": {"content": null, "tool_calls": [{"id": "c1", "type": "function",
        "function": {"name": "read", "arguments": "{\"path\":\"README.md\"}"}}]}}],
        "usage": {"prompt_tokens": 7, "completion_tokens": 1}})
}

fn dit(t: &str) -> Value {
    json!({"choices": [{"message": {"content": t}}],
           "usage": {"prompt_tokens": 7, "completion_tokens": 1}})
}

#[test]
fn REQ189_AC7_subagent_sans_conversation_sans_profil_et_annulation() {
    // Sans profil : le refus de REQ-055, en isError.
    let s = nouvelle("ac7a");
    let (mut c, _, _) = Client::ouvrir(s.mcp(), &[]);
    let (erreur, texte) = c.appeler("subagent", json!({"prompt": "x"}));
    assert!(erreur);
    assert_eq!(
        texte,
        "Aucun profil. Créez-en un avec Ctrl+P, puis > Profils de modèle."
    );
    drop(s);

    // Avec profil : read puis « trouvé », sans conversation.
    let s = nouvelle("ac7b");
    std::fs::write(s.projet.join("README.md"), "contenu du readme").unwrap();
    let (adresse, etat) = provider_scenarise(vec![lire_readme(), dit("trouvé")], 0);
    configurer(&s, &adresse, "sk-x");
    let (mut c, _, _) = Client::ouvrir(s.mcp(), &[]);
    let avant = fichiers(&s.projet.join(".yaide"));
    let attendus: Vec<String> = c
        .outils()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .filter(|n| n != "subagent")
        .collect();
    let (erreur, texte) = c.appeler("subagent", json!({"prompt": "cherche"}));
    assert!(!erreur, "{texte}");
    assert_eq!(texte, "trouvé");
    {
        let g = etat.lock().unwrap();
        assert_eq!(g.1.len(), 2);
        for r in &g.1 {
            assert_eq!(r["model"], "m");
            let noms: Vec<String> = r["tools"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t["function"]["name"].as_str().unwrap().to_string())
                .collect();
            assert_eq!(noms, attendus);
        }
        assert!(g.1[1].to_string().contains("contenu du readme"));
    }
    assert_eq!(fichiers(&s.projet.join(".yaide")), avant);
    assert!(!s.projet.join(".yaide/conversations").exists());
    drop(s);

    // Annulation pendant que le faux provider attend : plus aucune requête ensuite.
    let s = nouvelle("ac7c");
    std::fs::write(s.projet.join("README.md"), "x").unwrap();
    let (adresse, etat) = provider_scenarise(vec![lire_readme()], 300);
    configurer(&s, &adresse, "sk-x");
    let (mut c, _, _) = Client::ouvrir(s.mcp(), &[]);
    let mut c2 = Client {
        port: c.port,
        session: c.session.clone(),
    };
    let fil = std::thread::spawn(move || {
        c.requete(
            &[],
            "tools/call",
            json!({"name": "subagent", "arguments": {"prompt": "cherche"}}),
        )
    });
    for _ in 0..200 {
        if !etat.lock().unwrap().1.is_empty() {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    assert_eq!(etat.lock().unwrap().1.len(), 1);
    c2.envoyer(
        &[],
        &json!({"jsonrpc": "2.0", "method": "notifications/cancelled",
                "params": {"requestId": 2, "reason": "test"}}),
    );
    std::thread::sleep(Duration::from_millis(1000));
    assert_eq!(
        etat.lock().unwrap().1.len(),
        1,
        "requête après l'annulation"
    );
    let _ = fil.join();
}
