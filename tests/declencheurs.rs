#![allow(non_snake_case)]
//! Déclencheurs des agents (REQ-163 à REQ-165) : routes et boucle du serveur.
use serde_json::{json, Value};
use std::io::Write;
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
    fn yaide(&self) -> PathBuf {
        self.projet.join(".yaide")
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
    demarrer_avec_env(racine, projet, &[])
}

/// Comme `demarrer`, avec des variables d'environnement en plus pour Yaide.
fn demarrer_avec_env(racine: &Path, projet: &str, env: &[(&str, &str)]) -> Serveur {
    let projet = racine.join(projet);
    std::fs::create_dir_all(&projet).unwrap();
    // Un autre test peut prendre le port entre `port_libre` et le lancement : on réessaie.
    for _ in 0..5 {
        let port = port_libre();
        let mut child = Command::new(EXE)
            .arg(&projet)
            .args(["--port", &port.to_string()])
            .env("XDG_CONFIG_HOME", racine.join("cfg"))
            .env("HOME", racine)
            .env("GIT_CEILING_DIRECTORIES", racine)
            .env("YAIDE_INTERVALLE_BASE_MS", "100")
            .envs(env.iter().copied())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        // Prêt = la ligne « Yaide écoute sur le port » de notre propre processus ; la sortie
        // continue d'être lue ensuite pour que le tube ne se remplisse pas.
        let (tx, rx) = std::sync::mpsc::channel();
        let sortie = std::io::BufReader::new(child.stdout.take().unwrap());
        std::thread::spawn(move || {
            use std::io::BufRead;
            let mut envoye = false;
            for ligne in sortie.lines().map_while(Result::ok) {
                if !envoye {
                    if let Some(reste) = ligne.strip_prefix("Yaide écoute sur le port ") {
                        let pris: u16 = reste.split(',').next().unwrap().parse().unwrap_or(0);
                        let _ = tx.send(pris);
                        envoye = true;
                    }
                }
            }
        });
        let mut s = Serveur {
            child,
            port,
            cookie: String::new(),
            projet: projet.clone(),
            racine: racine.to_path_buf(),
        };
        // Un processus sorti avant la ligne, ou un autre port pris : on en reprend un autre.
        if rx.recv_timeout(Duration::from_secs(20)) != Ok(port) {
            continue;
        }
        let origine = format!("https://127.0.0.1:{port}");
        let r = requete(port, "POST", "/api/connexion", "", &origine, b"mdp");
        let ligne = r
            .entetes
            .lines()
            .find(|l| l.to_lowercase().starts_with("set-cookie:"))
            .expect("pas de Set-Cookie");
        s.cookie = ligne[11..].trim().split(';').next().unwrap().to_string();
        return s;
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

type Recues = std::sync::Arc<std::sync::Mutex<Vec<Value>>>;

fn rep_texte(t: &str, delai: u64) -> (u16, Value, u64) {
    (
        200,
        json!({"choices": [{"message": {"content": t}}],
               "usage": {"prompt_tokens": 7, "completion_tokens": 1}}),
        delai,
    )
}

/// Délai d'une réponse tenue par la porte : elle attend que le test ouvre la porte (10 s au plus).
const RETENUE: u64 = u64::MAX;

type Porte = std::sync::Arc<std::sync::atomic::AtomicBool>;

/// Faux provider : rend les réponses du scénario dans l'ordre (chacune après son délai en ms),
/// puis « ok » sans délai. Chaque requête reçue est notée.
fn faux_provider(scenario: Vec<(u16, Value, u64)>) -> (String, Recues) {
    faux_provider_porte(scenario, Porte::default())
}

/// Comme `faux_provider` ; une réponse de délai `RETENUE` attend que `porte` soit vraie (pas de 20 ms, 10 s au plus).
fn faux_provider_porte(scenario: Vec<(u16, Value, u64)>, porte: Porte) -> (String, Recues) {
    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::StatusCode;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    #[derive(Clone)]
    struct Etat(Arc<Mutex<VecDeque<(u16, Value, u64)>>>, Recues, Porte);
    async fn rep(State(e): State<Etat>, corps: Bytes) -> (StatusCode, String) {
        e.1.lock()
            .unwrap()
            .push(serde_json::from_slice::<Value>(&corps).unwrap_or(Value::Null));
        let suivante = e.0.lock().unwrap().pop_front();
        let (code, v, delai) = suivante.unwrap_or_else(|| rep_texte("ok", 0));
        if delai == RETENUE {
            for _ in 0..500 {
                if e.2.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        } else {
            tokio::time::sleep(Duration::from_millis(delai)).await;
        }
        (StatusCode::from_u16(code).unwrap(), v.to_string())
    }
    let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    ecoute.set_nonblocking(true).unwrap();
    let adresse = format!("http://{}", ecoute.local_addr().unwrap());
    let recues: Recues = Default::default();
    let etat = Etat(Arc::new(Mutex::new(scenario.into())), recues.clone(), porte);
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

/// Faux provider et profil `m` ; avec `cle`, la clé est enregistrée.
fn configurer(s: &Serveur, adresse: &str, cle: bool) {
    let mut corps = json!({ "adresse": adresse });
    if cle {
        corps["cle"] = json!("sk-x");
    }
    let r = s.appel("PUT", "/api/agent/providers/openai", &corps);
    assert_eq!(r.code, 200, "{}", r.corps);
    let p = json!({ "nom": "p", "provider": "openai", "modele": "m" });
    let r = s.appel("PUT", "/api/agent/profils", &p);
    assert_eq!(r.code, 200, "{}", r.corps);
}

fn agent(s: &Serveur, nom: &str, declencheurs: Value) -> Rep {
    s.appel(
        "PUT",
        "/api/agent/agents",
        &json!({ "nom": nom, "couleur": "vert", "declencheurs": declencheurs }),
    )
}

fn fichier(chemin: &str) -> Value {
    json!({ "type": "fichier", "chemin": chemin })
}

fn ecrire(s: &Serveur, chemin: &str, texte: &str) {
    let f = s.projet.join(chemin);
    std::fs::create_dir_all(f.parent().unwrap()).unwrap();
    std::fs::write(f, texte).unwrap();
}

fn conversations(s: &Serveur) -> Vec<Value> {
    let r = s.appel("GET", "/api/agent/conversations", &Value::Null);
    assert_eq!(r.code, 200, "{}", r.corps);
    r.json().as_array().unwrap().clone()
}

fn lire_conv(s: &Serveur, id: &str) -> Value {
    s.appel(
        "GET",
        &format!("/api/agent/conversations/{id}"),
        &Value::Null,
    )
    .json()
}

/// Attend jusqu'à `n` conversations (10 s au plus) puis les rend.
fn attendre_conversations(s: &Serveur, n: usize) -> Vec<Value> {
    for _ in 0..200 {
        let l = conversations(s);
        if l.len() >= n {
            return l;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("moins de {n} conversations : {:?}", conversations(s));
}

fn attendre_fin(s: &Serveur, id: &str) {
    for _ in 0..200 {
        if lire_conv(s, id)["enCours"] == false {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("le tour ne finit pas");
}

/// Le temps de six vérifications (100 ms chacune) avant une modification.
fn laisser_voir() {
    std::thread::sleep(Duration::from_millis(600));
}

/// Une conversation de la sonde (agent sur `sonde.txt`).
fn est_sonde(c: &Value) -> bool {
    c["titre"].as_str().unwrap_or("").contains("sonde.txt")
}

/// Les conversations qui ne viennent pas de la sonde.
fn hors_sonde(s: &Serveur) -> Vec<Value> {
    conversations(s)
        .into_iter()
        .filter(|c| !est_sonde(c))
        .collect()
}

/// Attend `n` conversations hors sonde (10 s au plus) puis les rend.
fn attendre_hors_sonde(s: &Serveur, n: usize) -> Vec<Value> {
    for _ in 0..200 {
        let l = hors_sonde(s);
        if l.len() >= n {
            return l;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("moins de {n} conversations : {:?}", hors_sonde(s));
}

/// Témoin à la place d'une pause : écrit `sonde.txt` (l'agent « Sonde » l'écoute) et attend sa
/// `n`-ième conversation. La sonde est vue après les changements faits avant elle, dans la même
/// vérification ou la suivante : ce qui devait se déclencher l'est déjà. Rend le reste.
fn passer_sonde(s: &Serveur, n: usize) -> Vec<Value> {
    // Un évènement arrivé pendant un tour de la sonde est ignoré (AC-164-4) : l'écriture attend
    // la fin des tours précédents de la sonde, sinon elle serait perdue sous charge.
    for c in conversations(s).iter().filter(|c| est_sonde(c)) {
        attendre_fin(s, c["id"].as_str().unwrap());
    }
    ecrire(s, "sonde.txt", &format!("passage {n}"));
    for _ in 0..400 {
        let l = conversations(s);
        if l.iter().filter(|c| est_sonde(c)).count() >= n {
            return l.into_iter().filter(|c| !est_sonde(c)).collect();
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("la sonde n'est pas passée {n} fois");
}

fn json_fiche(s: &Serveur, dossier: &str) -> Value {
    let o = std::fs::read(s.yaide().join(format!("agents/{dossier}/agent.json"))).unwrap();
    serde_json::from_slice(&o).unwrap()
}

fn cinq() -> Value {
    json!([
        fichier("docs/a.md"),
        { "type": "dossier", "chemin": "src" },
        { "type": "commit" },
        { "type": "commande", "texte": "cargo test" },
        { "type": "configuration" },
    ])
}

#[test]
fn REQ163_AC1_cinq_declencheurs_dans_l_ordre_apres_redemarrage_reste_inchange() {
    let s = lancer("d1");
    let r = s.appel(
        "PUT",
        "/api/agent/agents",
        &json!({ "nom": "Relecteur", "avatar": "R", "couleur": "vert" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let avant = json_fiche(&s, "relecteur");
    let r = s.appel(
        "PUT",
        "/api/agent/agents",
        &json!({ "dossier": "relecteur", "nom": "Relecteur", "avatar": "R",
                 "couleur": "vert", "declencheurs": cinq() }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let apres = json_fiche(&s, "relecteur");
    assert_eq!(apres["declencheurs"], cinq());
    let mut sans = apres.clone();
    sans.as_object_mut().unwrap().remove("declencheurs");
    assert_eq!(sans, avant);
    let s = redemarrer(s);
    let l = s.appel("GET", "/api/agent/agents", &Value::Null).json();
    assert_eq!(l["agents"][0]["declencheurs"], cinq());
}

#[test]
fn REQ163_AC2_un_retire_les_autres_restent_dans_l_ordre() {
    let s = lancer("d2");
    let r = agent(&s, "Relecteur", cinq());
    assert_eq!(r.code, 200, "{}", r.corps);
    let mut restants = cinq().as_array().unwrap().clone();
    restants.remove(1);
    let r = s.appel(
        "PUT",
        "/api/agent/agents",
        &json!({ "dossier": "relecteur", "nom": "Relecteur", "couleur": "vert",
                 "declencheurs": restants }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(json_fiche(&s, "relecteur")["declencheurs"], json!(restants));
}

#[test]
fn REQ163_AC3_refus_par_champ_et_par_rang_rien_ecrit() {
    let s = lancer("d3");
    for chemin in ["", "/etc/passwd", "../x", "a/../../x"] {
        let r = agent(
            &s,
            "Relecteur",
            json!([{ "type": "commit" }, fichier(chemin)]),
        );
        assert_eq!(r.code, 400, "{chemin} : {}", r.corps);
        assert_eq!(
            r.json()["erreurs"],
            json!([{ "champ": "chemin", "declencheur": 1 }])
        );
    }
    let r = agent(
        &s,
        "Relecteur",
        json!([{ "type": "dossier", "chemin": "../x" }, { "type": "commande", "texte": " " }]),
    );
    assert_eq!(r.code, 400, "{}", r.corps);
    assert_eq!(
        r.json()["erreurs"],
        json!([{ "champ": "chemin", "declencheur": 0 }, { "champ": "texte", "declencheur": 1 }])
    );
    assert!(!s.yaide().join("agents").exists());
    // Un champ de la fiche en erreur n'empêche pas les erreurs des déclencheurs.
    let r = s.appel(
        "PUT",
        "/api/agent/agents",
        &json!({ "nom": "", "couleur": "vert", "declencheurs": [fichier("/x")] }),
    );
    assert_eq!(r.code, 400, "{}", r.corps);
    assert_eq!(
        r.json()["erreurs"],
        json!([{ "champ": "nom" }, { "champ": "chemin", "declencheur": 0 }])
    );
    assert!(!s.yaide().join("agents").exists());
    // Une fiche existante reste telle quelle.
    agent(&s, "Relecteur", json!([fichier("a.md")]));
    let avant = std::fs::read(s.yaide().join("agents/relecteur/agent.json")).unwrap();
    let r = s.appel(
        "PUT",
        "/api/agent/agents",
        &json!({ "dossier": "relecteur", "nom": "Relecteur", "couleur": "vert",
                 "declencheurs": [fichier("")] }),
    );
    assert_eq!(r.code, 400);
    let apres = std::fs::read(s.yaide().join("agents/relecteur/agent.json")).unwrap();
    assert_eq!(avant, apres);
    // `.` désigne tout le projet ; un chemin qui n'existe pas encore est permis.
    assert_eq!(
        agent(&s, "Autre", json!([fichier("."), fichier("x/../y/z")])).code,
        200
    );
}

#[test]
fn REQ174_AC1_planification_ecrite_dans_agent_json_et_relue_apres_redemarrage() {
    let s = lancer("p1");
    let decl = json!([{ "type": "planification", "cron": "0 9 * * 1-5" }]);
    let r = agent(&s, "Relecteur", decl.clone());
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(json_fiche(&s, "relecteur")["declencheurs"], decl);
    let s = redemarrer(s);
    let l = s.appel("GET", "/api/agent/agents", &Value::Null).json();
    assert_eq!(l["agents"][0]["declencheurs"], decl);
}

#[test]
fn REQ174_AC2_quatre_saisies_refusees_rien_ecrit() {
    let s = lancer("p2");
    for cron in [
        "toutes les heures",
        "61 * * * *",
        "* * *",
        "",
        "0 9 * * 1-5 2026",
    ] {
        let r = agent(
            &s,
            "Relecteur",
            json!([{ "type": "commit" }, { "type": "planification", "cron": cron }]),
        );
        assert_eq!(r.code, 400, "{cron} : {}", r.corps);
        assert_eq!(
            r.json()["erreurs"],
            json!([{ "champ": "cron", "declencheur": 1 }])
        );
    }
    let r = agent(&s, "Relecteur", json!([{ "type": "planification" }]));
    assert_eq!(r.code, 400, "{}", r.corps);
    assert!(!s.yaide().join("agents").exists());
    let ok = json!([{ "type": "planification", "cron": "*/10 9 1,15 jan mon-fri" }]);
    assert_eq!(agent(&s, "Relecteur", ok).code, 200);
}

#[test]
fn REQ164_AC1_AC2_AC5_REQ165_AC1_une_conversation_par_agent_a_l_ecoute() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("d4");
    configurer(&s, &adresse, true);
    for (nom, chemin) in [
        ("Relecteur", "docs/a.md"),
        ("Testeur", "docs/a.md"),
        ("Autre", "docs/z.md"),
    ] {
        assert_eq!(agent(&s, nom, json!([fichier(chemin)])).code, 200);
    }
    assert_eq!(agent(&s, "Sans", json!([])).code, 200);
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    std::fs::write(s.yaide().join("agents/relecteur/AGENTS.md"), "Tu relis.").unwrap();
    laisser_voir();
    assert!(conversations(&s).is_empty());
    // Calage : la sonde se déclenche, donc la surveillance a déjà pris l'état de départ.
    declencher_sonde(&s);
    // créé
    ecrire(&s, "docs/a.md", "un");
    let l = attendre_hors_sonde(&s, 2);
    let l2 = passer_sonde(&s, 2);
    assert_eq!(l2.len(), 2, "{l:?}");
    for c in &l2 {
        assert_eq!(c["titre"], "Évènement : fichier `docs/a.md` créé.");
    }
    let mut agents_vus = Vec::new();
    for c in &l2 {
        let id = c["id"].as_str().unwrap();
        attendre_fin(&s, id);
        let v = lire_conv(&s, id);
        assert_eq!(v["agents"].as_array().unwrap().len(), 1);
        agents_vus.push(v["agents"][0]["dossier"].as_str().unwrap().to_string());
        assert_eq!(v["entrees"][0]["type"], "utilisateur");
        assert_eq!(
            v["entrees"][0]["texte"],
            "Évènement : fichier `docs/a.md` créé."
        );
        assert_eq!(v["entrees"][1]["texte"], "ok");
        if v["agents"][0]["dossier"] == "relecteur" {
            let reqs = recues.lock().unwrap().clone();
            let r = reqs
                .iter()
                .find(|r| r["messages"].to_string().contains("Tu relis."))
                .expect("instructions de Relecteur");
            assert_eq!(r["model"], "m");
            assert!(r["messages"]
                .to_string()
                .contains("Évènement : fichier `docs/a.md` créé."));
        }
    }
    agents_vus.sort();
    assert_eq!(agents_vus, ["relecteur", "testeur"]);
    // On peut répondre dans la conversation déclenchée (AC-164-5).
    let id = l2[0]["id"].as_str().unwrap();
    let avant = lire_conv(&s, id)["total"].as_u64().unwrap();
    let r = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({ "conversation": id, "texte": "merci" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    attendre_fin(&s, id);
    let v = lire_conv(&s, id);
    let e = v["entrees"].as_array().unwrap();
    assert_eq!(v["total"].as_u64().unwrap(), avant + 2);
    assert_eq!(e[e.len() - 2]["type"], "utilisateur");
    assert_eq!(e[e.len() - 2]["texte"], "merci");
    assert_eq!(e[e.len() - 1]["texte"], "ok");
    // modifié, réécrit à l'identique, supprimé
    let passages = std::cell::Cell::new(2);
    let fin = |n: usize| {
        attendre_hors_sonde(&s, n);
        passages.set(passages.get() + 1);
        passer_sonde(&s, passages.get())
    };
    ecrire(&s, "docs/a.md", "deux");
    let l = fin(4);
    assert_eq!(l.len(), 4);
    assert_eq!(l[0]["titre"], "Évènement : fichier `docs/a.md` modifié.");
    ecrire(&s, "docs/a.md", "deux");
    passages.set(passages.get() + 1);
    assert_eq!(
        passer_sonde(&s, passages.get()).len(),
        4,
        "même contenu : rien"
    );
    std::fs::remove_file(s.projet.join("docs/a.md")).unwrap();
    let l = fin(6);
    assert_eq!(l.len(), 6);
    assert_eq!(l[0]["titre"], "Évènement : fichier `docs/a.md` supprimé.");
    for c in &l {
        attendre_fin(&s, c["id"].as_str().unwrap());
    }
}

#[test]
fn REQ164_AC4_aucune_conversation_pendant_un_tour_de_l_agent() {
    // Les réponses sont prises dans l'ordre des appels : tour de Relecteur (retardé), sonde,
    // tour de l'utilisateur (retardé), sonde, Relecteur, sonde, tour de l'utilisateur (retardé).
    // Les tours retardés attendent la porte : le test l'ouvre quand il a fini d'écrire.
    let porte = Porte::default();
    let ouvrir = |v: bool| porte.store(v, std::sync::atomic::Ordering::SeqCst);
    let (adresse, _) = faux_provider_porte(
        vec![
            rep_texte("ok", RETENUE),
            rep_texte("ok", 0),
            rep_texte("ok", RETENUE),
            rep_texte("ok", 0),
            rep_texte("ok", 0),
            rep_texte("ok", 0),
            rep_texte("ok", RETENUE),
        ],
        porte.clone(),
    );
    let s = lancer("d5");
    configurer(&s, &adresse, true);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    // Le témoin passe, et son tour finit avant l'action suivante : il ne se mêle pas à la suite.
    let temoin = |n: usize| {
        let l = passer_sonde(&s, n);
        for c in conversations(&s).iter().filter(|c| est_sonde(c)) {
            attendre_fin(&s, c["id"].as_str().unwrap());
        }
        l
    };
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    let id = attendre_conversations(&s, 1)[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    // Le tour est en cours (réponse retardée) : le fichier change sous lui.
    assert_eq!(lire_conv(&s, &id)["enCours"], true);
    ecrire(&s, "docs/a.md", "2");
    ecrire(&s, "docs/b.md", "x");
    ouvrir(true);
    attendre_fin(&s, &id);
    assert_eq!(temoin(1).len(), 1);
    // Un tour ouvert par l'utilisateur avec Relecteur compte aussi.
    ouvrir(false);
    let r = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({ "agents": ["relecteur"], "texte": "bonjour" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let id2 = r.json()["conversation"].as_str().unwrap().to_string();
    ecrire(&s, "docs/a.md", "3");
    ouvrir(true);
    attendre_fin(&s, &id2);
    assert_eq!(temoin(2).len(), 2);
    // Après la fin du tour : une nouvelle conversation.
    ecrire(&s, "docs/a.md", "4");
    let l = attendre_hors_sonde(&s, 3);
    attendre_fin(&s, l[0]["id"].as_str().unwrap());
    assert_eq!(temoin(3).len(), 3);
    // Une écriture juste après la fin d'un tour compte aussi.
    ouvrir(false);
    let r = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({ "agents": ["relecteur"], "texte": "encore" }),
    );
    let id3 = r.json()["conversation"].as_str().unwrap().to_string();
    ecrire(&s, "docs/a.md", "5");
    ouvrir(true);
    attendre_fin(&s, &id3);
    ecrire(&s, "docs/a.md", "6");
    attendre_hors_sonde(&s, 5);
}

#[test]
fn REQ164_AC6_sans_cle_puis_sans_profil_la_conversation_garde_le_refus() {
    let (adresse, recues) = faux_provider(vec![]);
    let s = lancer("d6");
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    let l = attendre_conversations(&s, 1);
    let v = lire_conv(&s, l[0]["id"].as_str().unwrap());
    assert_eq!(v["enCours"], false);
    assert_eq!(
        v["entrees"][0]["texte"],
        "Évènement : fichier `docs/a.md` créé."
    );
    assert_eq!(v["entrees"][1]["type"], "message");
    assert_eq!(v["entrees"][1]["variante"], "erreur");
    assert_eq!(
        v["entrees"][1]["texte"],
        "Aucun profil. Créez-en un avec Ctrl+P, puis > Profils de modèle."
    );
    configurer(&s, &adresse, false);
    ecrire(&s, "docs/a.md", "2");
    let l = attendre_conversations(&s, 2);
    let v = lire_conv(&s, l[0]["id"].as_str().unwrap());
    assert_eq!(
        v["entrees"][0]["texte"],
        "Évènement : fichier `docs/a.md` modifié."
    );
    assert_eq!(
        v["entrees"][1]["texte"],
        "Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM."
    );
    assert!(
        recues.lock().unwrap().is_empty(),
        "aucune requête au provider"
    );
}

#[test]
fn REQ164_AC7_fonction_agents_inactive_puis_reactivee() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("d7");
    configurer(&s, &adresse, true);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    std::fs::write(
        s.yaide().join("interface.json"),
        r#"{"fonctions":{"agents":false}}"#,
    )
    .unwrap();
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    std::thread::sleep(Duration::from_millis(1500));
    assert!(conversations(&s).is_empty());
    std::fs::write(
        s.yaide().join("interface.json"),
        r#"{"fonctions":{"agents":true}}"#,
    )
    .unwrap();
    laisser_voir();
    assert!(conversations(&s).is_empty());
    ecrire(&s, "docs/a.md", "2");
    attendre_conversations(&s, 1);
}

#[test]
fn REQ164_AC8_ce_qui_change_pendant_l_arret_ne_se_soumet_pas() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("d8");
    configurer(&s, &adresse, true);
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    laisser_voir();
    let racine = s.racine.clone();
    drop(s);
    ecrire_hors(&racine, "docs/a.md", "arrêt");
    let s = demarrer(&racine, "projet");
    assert!(passer_sonde(&s, 1).is_empty());
    ecrire(&s, "docs/a.md", "après");
    attendre_hors_sonde(&s, 1);
}

fn ecrire_hors(racine: &Path, chemin: &str, texte: &str) {
    let f = racine.join("projet").join(chemin);
    std::fs::create_dir_all(f.parent().unwrap()).unwrap();
    std::fs::write(f, texte).unwrap();
}

#[test]
fn REQ164_AC9_declencheur_ajoute_puis_retire() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("d9");
    configurer(&s, &adresse, true);
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    assert_eq!(agent(&s, "Relecteur", json!([])).code, 200);
    laisser_voir();
    ecrire(&s, "docs/a.md", "0");
    assert!(passer_sonde(&s, 1).is_empty());
    let fiche = |d: Value| {
        s.appel(
            "PUT",
            "/api/agent/agents",
            &json!({ "dossier": "relecteur", "nom": "Relecteur", "couleur": "vert",
                     "declencheurs": d }),
        )
    };
    assert_eq!(fiche(json!([fichier("docs/a.md")])).code, 200);
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    let id = attendre_hors_sonde(&s, 1)[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    attendre_fin(&s, &id);
    assert_eq!(fiche(json!([])).code, 200);
    laisser_voir();
    ecrire(&s, "docs/a.md", "2");
    assert_eq!(passer_sonde(&s, 2).len(), 1);
}

// ---- REQ-166 « Commit », REQ-167 (agent), REQ-164 AC3 ----

fn git(dossier: &Path, racine: &Path, args: &[&str]) -> String {
    let s = Command::new("git")
        .arg("-C")
        .arg(dossier)
        .args(args)
        .env("HOME", racine)
        .env("GIT_CEILING_DIRECTORIES", racine)
        .env("GIT_EDITOR", "true")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        s.status.success(),
        "git {args:?} : {}",
        String::from_utf8_lossy(&s.stderr)
    );
    String::from_utf8_lossy(&s.stdout).trim().to_string()
}

/// Dépôt d'essai `racine/projet` sur `main`, auteur `Test <test@example.com>`, avec un
/// premier commit qui ajoute `b.md` ; la branche `x` porte un commit de plus que lui.
fn depot(nom: &str) -> PathBuf {
    let racine = preparer(nom);
    let p = racine.join("projet");
    std::fs::create_dir_all(&p).unwrap();
    git(&p, &racine, &["init", "-q", "-b", "main"]);
    git(&p, &racine, &["config", "user.name", "Test"]);
    git(&p, &racine, &["config", "user.email", "test@example.com"]);
    std::fs::write(p.join("b.md"), "b").unwrap();
    git(&p, &racine, &["add", "."]);
    git(&p, &racine, &["commit", "-q", "-m", "initial"]);
    git(&p, &racine, &["checkout", "-q", "-b", "x"]);
    std::fs::write(p.join("x.md"), "x").unwrap();
    git(&p, &racine, &["add", "."]);
    git(&p, &racine, &["commit", "-q", "-m", "sur x"]);
    git(&p, &racine, &["checkout", "-q", "main"]);
    std::fs::write(p.join("m.md"), "m").unwrap();
    git(&p, &racine, &["add", "."]);
    git(&p, &racine, &["commit", "-q", "-m", "sur main"]);
    racine
}

fn texte_conv(s: &Serveur, c: &Value) -> String {
    lire_conv(s, c["id"].as_str().unwrap())["entrees"][0]["texte"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn REQ166_AC1_le_commit_a_son_evenement_complet() {
    let racine = depot("c1");
    let s = demarrer(&racine, "projet");
    assert_eq!(
        agent(&s, "Relecteur", json!([{ "type": "commit" }])).code,
        200
    );
    laisser_voir();
    ecrire(&s, "a.md", "a");
    ecrire(&s, "b.md", "b2");
    git(&s.projet, &racine, &["add", "a.md", "b.md"]);
    git(&s.projet, &racine, &["commit", "-q", "-m", "ajoute a"]);
    let court = git(&s.projet, &racine, &["rev-parse", "--short", "HEAD"]);
    let l = attendre_conversations(&s, 1);
    assert_eq!(
        texte_conv(&s, &l[0]),
        format!(
            "Évènement : commit `{court}` sur la branche `main`.\nAuteur : Test <test@example.com>\n\
             Message : ajoute a\nFichiers :\n- A `a.md`\n- M `b.md`"
        )
    );
}

#[test]
fn REQ166_AC2_vue_git_puis_worktree_puis_amend() {
    let racine = depot("c2");
    let s = demarrer(&racine, "projet");
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    assert_eq!(
        agent(&s, "Relecteur", json!([{ "type": "commit" }])).code,
        200
    );
    laisser_voir();
    ecrire(&s, "v.md", "v");
    let r = requete(
        s.port,
        "POST",
        "/api/git/indexer?chemin=v.md",
        &s.cookie,
        &format!("https://127.0.0.1:{}", s.port),
        b"",
    );
    assert_eq!(r.code, 204, "{}", r.corps);
    let r = requete(
        s.port,
        "POST",
        "/api/git/commit",
        &s.cookie,
        &format!("https://127.0.0.1:{}", s.port),
        b"depuis la vue Git",
    );
    assert_eq!(r.code, 204, "{}", r.corps);
    let l = attendre_conversations(&s, 1);
    let t = texte_conv(&s, &l[0]);
    assert!(
        t.contains("sur la branche `main`.") && t.contains("Message : depuis la vue Git"),
        "{t}"
    );

    git(
        &s.projet,
        &racine,
        &["worktree", "add", "-q", "../essai", "-b", "essai"],
    );
    let essai = racine.join("essai");
    std::fs::write(essai.join("w.md"), "w").unwrap();
    git(&essai, &racine, &["add", "."]);
    git(&essai, &racine, &["commit", "-q", "-m", "dans essai"]);
    let l = attendre_conversations(&s, 2);
    let t = texte_conv(&s, &l[0]);
    assert!(
        t.contains("sur la branche `essai`.") && t.contains("- A `w.md`"),
        "{t}"
    );

    git(
        &s.projet,
        &racine,
        &["commit", "-q", "--amend", "-m", "corrige"],
    );
    let l = attendre_conversations(&s, 3);
    assert!(texte_conv(&s, &l[0]).contains("Message : corrige"));
    assert_eq!(passer_sonde(&s, 1).len(), 3);
}

#[test]
fn REQ166_AC3_pull_en_avance_rapide_et_rebase_ne_sont_pas_des_commits() {
    let racine = depot("c3");
    let p = racine.join("projet");
    // `autre` porte trois commits de plus que `projet`.
    git(&racine, &racine, &["clone", "-q", "projet", "autre"]);
    let autre = racine.join("autre");
    git(&autre, &racine, &["config", "user.name", "Test"]);
    git(
        &autre,
        &racine,
        &["config", "user.email", "test@example.com"],
    );
    for n in 1..=3 {
        std::fs::write(autre.join(format!("n{n}.md")), "n").unwrap();
        git(&autre, &racine, &["add", "."]);
        git(&autre, &racine, &["commit", "-q", "-m", &format!("n{n}")]);
    }
    let s = demarrer(&racine, "projet");
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    assert_eq!(
        agent(&s, "Relecteur", json!([{ "type": "commit" }])).code,
        200
    );
    laisser_voir();
    git(
        &p,
        &racine,
        &["pull", "-q", "--ff-only", "../autre", "main"],
    );
    git(&p, &racine, &["rebase", "-q", "main", "x"]);
    let l = passer_sonde(&s, 1);
    assert!(l.is_empty(), "{l:?}");
}

#[test]
fn REQ166_AC4_sans_depot_aucune_erreur_et_les_autres_declencheurs_marchent() {
    let s = lancer("c4");
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    assert_eq!(
        agent(
            &s,
            "Relecteur",
            json!([{ "type": "commit" }, fichier("docs/a.md")])
        )
        .code,
        200
    );
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    let l = attendre_hors_sonde(&s, 1);
    assert_eq!(
        texte_conv(&s, &l[0]),
        "Évènement : fichier `docs/a.md` créé."
    );
    assert_eq!(passer_sonde(&s, 1).len(), 1);
}

#[test]
fn REQ164_AC3_un_fichier_modifie_puis_commite_entre_deux_verifications_un_seul_message() {
    let racine = depot("c5");
    let s = demarrer_avec_env(&racine, "projet", &[("YAIDE_INTERVALLE_BASE_MS", "1000")]);
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    assert_eq!(
        agent(
            &s,
            "Relecteur",
            json!([fichier("docs/a.md"), { "type": "commit" }])
        )
        .code,
        200
    );
    // La sonde se déclenche juste après une vérification : on a alors presque 1 s devant nous.
    declencher_sonde(&s);
    ecrire(&s, "docs/a.md", "1");
    git(&s.projet, &racine, &["add", "docs/a.md"]);
    git(&s.projet, &racine, &["commit", "-q", "-m", "ajoute docs/a"]);
    let l = attendre_conversations(&s, 2);
    let t = texte_conv(&s, &l[0]);
    let (fichier, commit) = t.split_once("\n\n").expect("une ligne vide");
    assert_eq!(fichier, "Évènement : fichier `docs/a.md` créé.");
    assert!(
        commit.starts_with("Évènement : commit `") && commit.contains("Message : ajoute docs/a"),
        "{t}"
    );
    assert_eq!(passer_sonde(&s, 2).len(), 1);
}

#[test]
fn REQ167_AC4_la_commande_bash_d_un_agent_ne_declenche_rien() {
    let racine = preparer("c6");
    let bin = racine.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let temoin = racine.join("temoin");
    std::fs::write(
        bin.join("cargo"),
        format!("#!/bin/sh\necho $@ > {}\nexit 101\n", temoin.display()),
    )
    .unwrap();
    std::fs::set_permissions(
        bin.join("cargo"),
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    let chemin = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
    let (adresse, recues) = faux_provider(vec![
        (
            200,
            json!({"choices": [{"message": {"content": null, "tool_calls": [{
                "id": "c1", "type": "function",
                "function": {"name": "bash", "arguments": "{\"command\":\"cargo test\"}"}}]}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 1}}),
            0,
        ),
        rep_texte("fini", 0),
    ]);
    let s = demarrer_avec_env(&racine, "projet", &[("PATH", &chemin)]);
    configurer(&s, &adresse, true);
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    assert_eq!(agent(&s, "Relecteur", json!([])).code, 200);
    assert_eq!(
        agent(
            &s,
            "Testeur",
            json!([{ "type": "commande", "texte": "cargo test" }])
        )
        .code,
        200
    );
    let r = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({ "agents": ["relecteur"], "texte": "lance les tests" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let id = r.json()["conversation"].as_str().unwrap().to_string();
    attendre_fin(&s, &id);
    assert!(
        recues.lock().unwrap().len() >= 2 && temoin.exists(),
        "la commande n'a pas tourné : {:?}",
        recues.lock().unwrap().len()
    );
    assert_eq!(passer_sonde(&s, 1).len(), 1);
}

/// Le texte du premier message de la conversation dont ce message contient `morceau`.
fn texte_avec(s: &Serveur, morceau: &str) -> String {
    let l = conversations(s);
    l.iter()
        .map(|c| texte_conv(s, c))
        .find(|t| t.contains(morceau))
        .unwrap_or_else(|| panic!("aucun message avec {morceau:?} dans {l:?}"))
}

/// Une sonde sur `sonde.txt` : sa conversation arrive juste après une vérification, ce qui
/// laisse presque 1 s (intervalle de 1 s) pour faire deux changements « entre deux vérifications ».
///
/// La sonde est réécrite (autre contenu) jusqu'à ce que sa conversation paraisse : cela prouve que
/// la première vérification, celle qui note l'état de départ, est passée.
fn declencher_sonde(s: &Serveur) {
    for i in 0..20 {
        ecrire(s, "sonde.txt", &format!("calage {i}"));
        // Une réécriture seulement après 1,1 s sans conversation (plus d'un intervalle).
        for _ in 0..22 {
            std::thread::sleep(Duration::from_millis(50));
            if conversations(s).iter().any(est_sonde) {
                return;
            }
        }
    }
    panic!("la sonde ne se déclenche pas");
}

#[test]
fn REQ165_AC2_un_dossier_un_seul_evenement_une_ligne_par_fichier_par_ordre_de_chemin() {
    let s = demarrer_avec_env(
        &preparer("dos1"),
        "projet",
        &[("YAIDE_INTERVALLE_BASE_MS", "1000")],
    );
    ecrire(&s, "docs/a.md", "1");
    ecrire(&s, "docs/z.md", "stable");
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    let d = json!([{ "type": "dossier", "chemin": "docs" }]);
    assert_eq!(agent(&s, "Relecteur", d).code, 200);
    declencher_sonde(&s);
    ecrire(&s, "docs/a.md", "2");
    ecrire(&s, "docs/sous/c.md", "c");
    attendre_conversations(&s, 2);
    assert_eq!(
        texte_avec(&s, "dossier"),
        "Évènement : changements dans le dossier `docs/` :\n- `docs/a.md` modifié\n- `docs/sous/c.md` créé"
    );
    assert_eq!(passer_sonde(&s, 2).len(), 1);
}

#[test]
fn REQ165_AC3_dossier_racine_sans_ignores_ni_yaide_ni_git() {
    let racine = depot("dos2");
    std::fs::write(racine.join("projet/.gitignore"), "ignore.txt\n").unwrap();
    let s = demarrer(&racine, "projet");
    let d = json!([{ "type": "dossier", "chemin": "." }]);
    assert_eq!(agent(&s, "Relecteur", d).code, 200);
    laisser_voir();
    ecrire(&s, "ignore.txt", "caché");
    std::fs::write(s.yaide().join("note.txt"), "x").unwrap();
    git(
        &s.projet,
        &racine,
        &["commit", "-q", "--allow-empty", "-m", "vide"],
    );
    // Témoin : un fichier visible, lui, est vu, et lui seul.
    ecrire(&s, "z.md", "z");
    let l = attendre_conversations(&s, 1);
    assert_eq!(
        texte_conv(&s, &l[0]),
        "Évènement : changements dans le dossier `./` :\n- `z.md` créé"
    );
    assert_eq!(conversations(&s).len(), 1);
}

#[test]
fn REQ165_AC4_un_renommage_est_une_suppression_et_une_creation() {
    let s = lancer("dos3");
    ecrire(&s, "docs/b.md", "contenu");
    let d = json!([{ "type": "dossier", "chemin": "docs" }]);
    assert_eq!(agent(&s, "Relecteur", d).code, 200);
    laisser_voir();
    std::fs::rename(s.projet.join("docs/b.md"), s.projet.join("docs/c.md")).unwrap();
    let l = attendre_conversations(&s, 1);
    assert_eq!(
        texte_conv(&s, &l[0]),
        "Évènement : changements dans le dossier `docs/` :\n- `docs/b.md` supprimé\n- `docs/c.md` créé"
    );
}

fn configuration() -> Value {
    json!([{ "type": "configuration" }])
}

/// Le bloc ```json``` du message, lu.
fn bloc_config(texte: &str) -> Value {
    let debut = texte.find("```json\n").expect("bloc json") + 8;
    let fin = texte.rfind("\n```").expect("fin du bloc");
    serde_json::from_str(&texte[debut..fin]).expect("json valide")
}

#[test]
fn REQ168_AC1_un_profil_cree_donne_la_configuration_sans_cle() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("cfg1");
    let r = s.appel(
        "PUT",
        "/api/agent/providers/openai",
        &json!({ "adresse": adresse, "cle": "sk-tres-secrete-42" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    laisser_voir();
    assert_eq!(agent(&s, "Relecteur", configuration()).code, 200);
    laisser_voir();
    assert!(conversations(&s).is_empty());
    let p = json!({ "nom": "p", "provider": "openai", "modele": "m" });
    assert_eq!(s.appel("PUT", "/api/agent/profils", &p).code, 200);
    let l = attendre_conversations(&s, 1);
    let t = texte_conv(&s, &l[0]);
    assert!(
        t.starts_with(
            "Évènement : configuration de Yaide changée : profils.\nConfiguration :\n```json\n"
        ),
        "{t}"
    );
    let c = bloc_config(&t);
    assert_eq!(c["profiles"][0]["name"], "p");
    assert_eq!(c["providers"][0]["has_key"], true);
    assert!(!t.contains("sk-tres-secrete-42"), "{t}");
}

#[test]
fn REQ168_AC2_les_parties_changees_sont_nommees() {
    let s = demarrer_avec_env(
        &preparer("cfg2"),
        "projet",
        &[("YAIDE_INTERVALLE_BASE_MS", "1000")],
    );
    assert_eq!(agent(&s, "Sonde", json!([fichier("sonde.txt")])).code, 200);
    assert_eq!(agent(&s, "Relecteur", configuration()).code, 200);
    declencher_sonde(&s);
    let r = s.appel(
        "PUT",
        "/api/agent/providers/ollama",
        &json!({ "adresse": "http://localhost:11999/v1" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let mcp = s.racine.join("cfg/yaide/mcp.json");
    std::fs::create_dir_all(mcp.parent().unwrap()).unwrap();
    std::fs::write(mcp, r#"{"mcpServers":{"echo":{"command":"node"}}}"#).unwrap();
    attendre_conversations(&s, 2);
    let t = texte_avec(&s, "configuration de Yaide");
    assert!(
        t.starts_with("Évènement : configuration de Yaide changée : providers, serveurs MCP.\n"),
        "{t}"
    );
    assert_eq!(passer_sonde(&s, 2).len(), 1);
    std::fs::write(
        s.yaide().join("interface.json"),
        r#"{"fonctions":{"git":false}}"#,
    )
    .unwrap();
    attendre_hors_sonde(&s, 2);
    let t = texte_avec(&s, "changée : interface.");
    assert!(t.starts_with("Évènement : configuration de Yaide changée : interface.\n"));
}

#[test]
fn REQ168_AC3_cle_agent_ou_fichier_reecrit_a_l_identique_ne_declenchent_rien() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("cfg3");
    let r = s.appel(
        "PUT",
        "/api/agent/providers/openai",
        &json!({ "adresse": adresse }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    laisser_voir();
    assert_eq!(agent(&s, "Relecteur", configuration()).code, 200);
    laisser_voir();
    let r = s.appel(
        "PUT",
        "/api/agent/providers/openai",
        &json!({ "adresse": adresse, "cle": "sk-nouvelle" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let r = s.appel(
        "PUT",
        "/api/agent/agents",
        &json!({ "dossier": "relecteur", "nom": "Relecteur", "couleur": "rose", "declencheurs": configuration() }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let config = s.racine.join("cfg/yaide/config.json");
    let octets = std::fs::read(&config).expect("config.json écrit par le provider");
    std::fs::write(&config, octets).unwrap();
    // Témoin : un vrai changement, lui, est vu, et seul : rien d'avant ne s'est déclenché.
    let p = json!({ "nom": "p", "provider": "openai", "modele": "m" });
    assert_eq!(s.appel("PUT", "/api/agent/profils", &p).code, 200);
    let l = attendre_conversations(&s, 1);
    assert_eq!(l.len(), 1, "{l:?}");
    let t = texte_conv(&s, &l[0]);
    assert!(
        t.starts_with("Évènement : configuration de Yaide changée : profils.\n"),
        "{t}"
    );
}

#[test]
fn REQ168_AC4_mcp_json_illisible_est_nomme_avec_sa_cause() {
    let s = lancer("cfg4");
    let mcp = s.racine.join("cfg/yaide/mcp.json");
    std::fs::create_dir_all(mcp.parent().unwrap()).unwrap();
    std::fs::write(&mcp, r#"{"mcpServers":{"echo":{"command":"node"}}}"#).unwrap();
    laisser_voir();
    assert_eq!(agent(&s, "Relecteur", configuration()).code, 200);
    laisser_voir();
    std::fs::write(&mcp, "{pas du json").unwrap();
    let l = attendre_conversations(&s, 1);
    let t = texte_conv(&s, &l[0]);
    assert!(
        t.starts_with("Évènement : configuration de Yaide changée : serveurs MCP.\n"),
        "{t}"
    );
    let c = bloc_config(&t);
    let u = &c["unreadable"][0];
    assert!(u["file"].as_str().unwrap().ends_with("mcp.json"), "{u}");
    assert!(!u["cause"].as_str().unwrap().is_empty(), "{u}");
}

// ---- REQ-173 : journal des tours déclenchés ----

fn journal(s: &Serveur, depuis: Option<u64>) -> Value {
    let chemin = match depuis {
        Some(n) => format!("/api/agent/declenchements?depuis={n}"),
        None => "/api/agent/declenchements".to_string(),
    };
    let r = s.appel("GET", &chemin, &Value::Null);
    assert_eq!(r.code, 200, "{}", r.corps);
    r.json()
}

/// Attend `n` entrées au moins (10 s) et rend le journal depuis le début.
fn attendre_journal(s: &Serveur, n: usize) -> Vec<Value> {
    for _ in 0..200 {
        let l = journal(s, Some(0))["entrees"].as_array().unwrap().clone();
        if l.len() >= n {
            return l;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("moins de {n} entrées : {}", journal(s, Some(0)));
}

fn sortes(l: &[Value], agent: &str) -> Vec<String> {
    l.iter()
        .filter(|e| e["agent"] == agent)
        .map(|e| e["sorte"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn REQ173_AC1_debut_puis_fin_avec_le_texte_de_l_evenement() {
    let porte = Porte::default();
    let (adresse, _) = faux_provider_porte(vec![rep_texte("ok", RETENUE)], porte.clone());
    let s = lancer("j1");
    configurer(&s, &adresse, true);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    laisser_voir();
    let avant = journal(&s, None)["numero"].as_u64().unwrap();
    ecrire(&s, "docs/a.md", "1");
    // Le début est écrit pendant le tour ; la porte s'ouvre ensuite.
    attendre_journal(&s, 1);
    porte.store(true, std::sync::atomic::Ordering::SeqCst);
    let l = attendre_journal(&s, 2);
    assert_eq!(l[0]["agent"], "Relecteur");
    assert_eq!(l[0]["sorte"], "debut");
    assert_eq!(l[0]["evenement"], "fichier `docs/a.md` créé");
    assert_eq!(l[1]["agent"], "Relecteur");
    assert_eq!(l[1]["sorte"], "fin");
    assert_eq!(l[1]["evenement"], "fichier `docs/a.md` créé");
    assert!(l[1]["numero"].as_u64().unwrap() > l[0]["numero"].as_u64().unwrap());
    // `depuis` ne rend que ce qui suit.
    let j = journal(&s, Some(l[0]["numero"].as_u64().unwrap()));
    assert_eq!(j["entrees"].as_array().unwrap().len(), 1);
    assert_eq!(j["entrees"][0]["sorte"], "fin");
    assert_eq!(avant, 0);
}

#[test]
fn REQ173_AC2_erreur_du_provider_puis_arreter_finissent_en_erreur() {
    let (adresse, _) = faux_provider(vec![
        (500, json!({"error": {"message": "boum"}}), 0),
        rep_texte("ok", 5000),
    ]);
    let s = lancer("j2");
    configurer(&s, &adresse, true);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    let l = attendre_journal(&s, 2);
    assert_eq!(sortes(&l, "Relecteur"), ["debut", "erreur"]);
    assert_eq!(l[1]["evenement"], "fichier `docs/a.md` créé");
    // Tour arrêté par « Arrêter ».
    std::thread::sleep(Duration::from_millis(400));
    ecrire(&s, "docs/a.md", "2");
    let l = attendre_journal(&s, 3);
    assert_eq!(l[2]["sorte"], "debut");
    let id = conversations(&s)[0]["id"].as_str().unwrap().to_string();
    assert_eq!(lire_conv(&s, &id)["enCours"], true);
    let r = s.appel(
        "POST",
        &format!("/api/agent/conversations/{id}/arreter"),
        &Value::Null,
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    let l = attendre_journal(&s, 4);
    assert_eq!(l[3]["sorte"], "erreur");
    assert_eq!(l[3]["evenement"], "fichier `docs/a.md` modifié");
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(attendre_journal(&s, 4).len(), 4);
}

#[test]
fn REQ173_AC3_un_refus_est_une_seule_entree_avec_sa_phrase() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("j3");
    configurer(&s, &adresse, false);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    let l = attendre_journal(&s, 1);
    std::thread::sleep(Duration::from_millis(800));
    let l2 = attendre_journal(&s, 1);
    assert_eq!(l.len(), 1);
    assert_eq!(l2.len(), 1, "{l2:?}");
    assert_eq!(l[0]["agent"], "Relecteur");
    assert_eq!(l[0]["sorte"], "refus");
    assert_eq!(l[0]["evenement"], "fichier `docs/a.md` créé");
    assert_eq!(
        l[0]["phrase"],
        "Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM."
    );
}

#[test]
fn REQ173_AC4_deux_agents_et_evenement_dossier() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("j4");
    configurer(&s, &adresse, true);
    let d = json!([{ "type": "dossier", "chemin": "docs" }]);
    assert_eq!(agent(&s, "Relecteur", d.clone()).code, 200);
    assert_eq!(agent(&s, "Testeur", d).code, 200);
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    let l = attendre_journal(&s, 4);
    for nom in ["Relecteur", "Testeur"] {
        assert_eq!(sortes(&l, nom), ["debut", "fin"], "{l:?}");
    }
    for e in &l {
        assert_eq!(e["evenement"], "changements dans le dossier `docs/`");
    }
}

#[test]
fn REQ173_AC4_evenement_long_coupe_a_80_caracteres() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("j4b");
    configurer(&s, &adresse, true);
    let nom = format!("docs/{}.md", "é".repeat(100));
    assert_eq!(agent(&s, "Relecteur", json!([fichier(&nom)])).code, 200);
    laisser_voir();
    ecrire(&s, &nom, "1");
    let l = attendre_journal(&s, 1);
    let e = l[0]["evenement"].as_str().unwrap();
    assert_eq!(e.chars().count(), 81);
    assert!(e.ends_with('…'));
    assert!(e.starts_with("fichier `docs/éé"));
}

#[test]
fn REQ173_AC5_reponse_de_l_utilisateur_et_conversation_ouverte_sans_entree() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("j5");
    configurer(&s, &adresse, true);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    // Sans `depuis` : le numéro du moment, aucune entrée.
    let j = journal(&s, None);
    assert_eq!(j["numero"], 0);
    assert_eq!(j["entrees"].as_array().unwrap().len(), 0);
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    attendre_journal(&s, 2);
    let id = conversations(&s)[0]["id"].as_str().unwrap().to_string();
    attendre_fin(&s, &id);
    let j = journal(&s, None);
    assert!(j["numero"].as_u64().unwrap() >= 2);
    assert_eq!(j["entrees"].as_array().unwrap().len(), 0);
    // L'utilisateur répond dans la conversation déclenchée, puis en ouvre une autre.
    let r = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({ "conversation": id, "texte": "merci" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    attendre_fin(&s, &id);
    let r = s.appel(
        "POST",
        "/api/agent/messages",
        &json!({ "agents": ["relecteur"], "texte": "bonjour" }),
    );
    let id2 = r.json()["conversation"].as_str().unwrap().to_string();
    attendre_fin(&s, &id2);
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(attendre_journal(&s, 2).len(), 2);
}

/// Les lignes (sévérité, message, détail) du journal des logs de Yaide (REQ-186).
fn lignes_des_logs(s: &Serveur) -> Vec<(String, String, String)> {
    let r = s.appel("GET", "/api/journal", &Value::Null);
    assert_eq!(r.code, 200, "{}", r.corps);
    r.json()["lignes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| {
            (
                l["severite"].as_str().unwrap().to_string(),
                l["message"].as_str().unwrap().to_string(),
                l["detail"].as_str().unwrap_or("").to_string(),
            )
        })
        .collect()
}

/// Attend (10 s) une ligne de message `message` et rend toutes les lignes.
fn attendre_ligne(s: &Serveur, message: &str) -> Vec<(String, String, String)> {
    for _ in 0..200 {
        let l = lignes_des_logs(s);
        if l.iter().any(|x| x.1 == message) {
            return l;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("pas de ligne « {message} » : {:?}", lignes_des_logs(s));
}

#[test]
fn REQ186_AC3_un_tour_declenche_ecrit_une_ligne_de_debut_et_une_de_fin_une_seule_fois() {
    let porte = Porte::default();
    let (adresse, _) = faux_provider_porte(vec![rep_texte("ok", RETENUE)], porte.clone());
    let s = lancer("l1");
    configurer(&s, &adresse, true);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    attendre_ligne(&s, "Relecteur démarre : fichier `docs/a.md` créé.");
    porte.store(true, std::sync::atomic::Ordering::SeqCst);
    let l = attendre_ligne(&s, "Relecteur a terminé : fichier `docs/a.md` créé.");
    std::thread::sleep(Duration::from_millis(600));
    let l2 = lignes_des_logs(&s);
    assert_eq!(l, l2, "aucune ligne en double");
    let info = |t: &str| {
        l2.iter()
            .filter(|x| x.0 == "Information" && x.1 == t)
            .count()
    };
    assert_eq!(info("Relecteur démarre : fichier `docs/a.md` créé."), 1);
    assert_eq!(info("Relecteur a terminé : fichier `docs/a.md` créé."), 1);
}

#[test]
fn REQ186_AC3_AC5_fin_sur_une_erreur_du_provider_ecrit_deux_lignes_erreur_sans_la_cle() {
    let (adresse, _) = faux_provider(vec![(500, json!({"error": {"message": "boum"}}), 0)]);
    let s = lancer("l2");
    configurer(&s, &adresse, true);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    let l = attendre_ligne(
        &s,
        "Relecteur s'est arrêté avant la fin : fichier `docs/a.md` créé.",
    );
    let erreurs: Vec<&str> = l
        .iter()
        .filter(|x| x.0 == "Erreur")
        .map(|x| x.1.as_str())
        .collect();
    assert!(
        erreurs.iter().any(|m| m.contains("500")),
        "ligne du provider : {erreurs:?}"
    );
    assert!(
        l.iter()
            .all(|x| !x.1.contains("sk-x") && !x.2.contains("sk-x")),
        "{l:?}"
    );
}

#[test]
fn REQ186_AC3_un_refus_ecrit_une_ligne_erreur_au_texte_du_toast() {
    let (adresse, _) = faux_provider(vec![]);
    let s = lancer("l3");
    configurer(&s, &adresse, false);
    assert_eq!(
        agent(&s, "Relecteur", json!([fichier("docs/a.md")])).code,
        200
    );
    laisser_voir();
    ecrire(&s, "docs/a.md", "1");
    let t = "Relecteur n'a pas pu démarrer : Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM.";
    let l = attendre_ligne(&s, t);
    assert!(l.contains(&("Erreur".to_string(), t.to_string(), String::new())));
}
