#![allow(non_snake_case)]
//! Workflows (REQ-190 à REQ-195) : routes, fichiers et vérification de la publication.
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
    let d = std::env::temp_dir().join(format!("workflows-{nom}-{}", std::process::id()));
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

fn noeud(id: &str, genre: &str, titre: &str, reglages: Value) -> Value {
    json!({ "id": id, "type": genre, "titre": titre, "x": 10.5, "y": 20.0, "reglages": reglages })
}

fn dossier_ok() -> Value {
    json!({ "dossier": "notes", "evenements": ["cree", "modifie", "supprime"] })
}

/// Crée un workflow vide et l'enregistre avec ces nœuds et ces liens.
fn creer(s: &Serveur, nom: &str, noeuds: Value, liens: Value) -> String {
    let r = s.appel("POST", "/api/workflows", &json!({ "nom": nom }));
    assert_eq!(r.code, 200, "{}", r.corps);
    let fichier = r.json()["fichier"].as_str().unwrap().to_string();
    let r = s.appel(
        "PUT",
        &format!("/api/workflows/{fichier}"),
        &json!({ "noeuds": noeuds, "liens": liens }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    fichier
}

fn messages(s: &Serveur, fichier: &str) -> Vec<String> {
    let r = s.appel(
        "POST",
        &format!("/api/workflows/{fichier}/publier"),
        &Value::Null,
    );
    assert_eq!(r.code, 422, "{}", r.corps);
    r.json()["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m.as_str().unwrap().to_string())
        .collect()
}

fn lire_fichier(s: &Serveur, fichier: &str) -> Vec<u8> {
    std::fs::read(s.yaide().join(format!("workflows/{fichier}.json"))).unwrap()
}

#[test]
fn REQ190_AC2_liste_vide_ne_cree_pas_yaide() {
    let racine = preparer("ac2");
    let s = demarrer(&racine, "p");
    let r = s.appel("GET", "/api/workflows", &Value::Null);
    assert_eq!(r.code, 200);
    assert_eq!(r.json()["workflows"], json!([]));
    assert_eq!(r.json()["erreurs"], json!([]));
    assert!(!s.yaide().exists());
}

#[test]
fn REQ190_AC3_creation_brouillon_sans_noeud() {
    let racine = preparer("ac3");
    let s = demarrer(&racine, "p");
    let r = s.appel(
        "POST",
        "/api/workflows",
        &json!({ "nom": "Revue des notes" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    assert_eq!(r.json()["fichier"], "revue-des-notes");
    let f: Value = serde_json::from_slice(&lire_fichier(&s, "revue-des-notes")).unwrap();
    assert_eq!(
        f,
        json!({ "nom": "Revue des notes", "publie": false, "noeuds": [], "liens": [] })
    );
    let l = s.appel("GET", "/api/workflows", &Value::Null).json();
    assert_eq!(
        l["workflows"],
        json!([{ "nom": "Revue des notes", "fichier": "revue-des-notes", "publie": false, "enCours": null }])
    );
    // Un nom qui donne le même fichier reçoit un suffixe.
    let r = s.appel(
        "POST",
        "/api/workflows",
        &json!({ "nom": "Revue des notes!" }),
    );
    assert_eq!(r.json()["fichier"], "revue-des-notes-2");
}

#[test]
fn REQ190_AC4_nom_vide_ou_pris_refuse_sans_ecrire() {
    let racine = preparer("ac4");
    let s = demarrer(&racine, "p");
    let r = s.appel("POST", "/api/workflows", &json!({ "nom": "  " }));
    assert_eq!(r.code, 400);
    assert_eq!(r.json()["message"], "Donnez un nom au workflow.");
    assert!(!s.yaide().exists());
    s.appel("POST", "/api/workflows", &json!({ "nom": "Revue" }));
    let r = s.appel("POST", "/api/workflows", &json!({ "nom": "rEVUE" }));
    assert_eq!(r.code, 400);
    assert_eq!(
        r.json()["message"],
        "Ce nom est déjà pris. Choisissez-en un autre."
    );
    let n = std::fs::read_dir(s.yaide().join("workflows"))
        .unwrap()
        .count();
    assert_eq!(n, 1);
}

#[test]
fn REQ190_AC6_fichier_illisible_signale_et_liste_les_autres() {
    let racine = preparer("ac6");
    let s = demarrer(&racine, "p");
    s.appel("POST", "/api/workflows", &json!({ "nom": "b" }));
    s.appel("POST", "/api/workflows", &json!({ "nom": "A" }));
    std::fs::write(s.yaide().join("workflows/x.json"), "pas du json").unwrap();
    let l = s.appel("GET", "/api/workflows", &Value::Null).json();
    assert_eq!(
        l["erreurs"],
        json!([".yaide/workflows/x.json est illisible. Corrigez-le, puis rouvrez Workflows."])
    );
    let noms: Vec<_> = l["workflows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["nom"].as_str().unwrap())
        .collect();
    assert_eq!(noms, ["A", "b"]);
}

#[test]
fn REQ191_AC2_enregistrement_garde_noeuds_reglages_positions_et_liens_apres_redemarrage() {
    let racine = preparer("191ac2");
    let noeuds = json!([
        noeud("n1", "dossier", "Fichiers d'un dossier 1", dossier_ok()),
        noeud(
            "n2",
            "shell",
            "Commande shell 1",
            json!({ "commande": "ls" })
        ),
    ]);
    let liens = json!([{ "de": "n1", "vers": "n2" }]);
    {
        let s = demarrer(&racine, "p");
        let f = creer(&s, "Revue", noeuds.clone(), liens.clone());
        let fichier: Value = serde_json::from_slice(&lire_fichier(&s, &f)).unwrap();
        assert_eq!(fichier["noeuds"], noeuds);
        assert_eq!(fichier["liens"], liens);
        assert_eq!(fichier["publie"], false);
    }
    let s = demarrer(&racine, "p");
    let r = s.appel("GET", "/api/workflows/revue", &Value::Null).json();
    assert_eq!(r["noeuds"], noeuds);
    assert_eq!(r["liens"], liens);
    // Une saisie incohérente est refusée sans toucher au fichier.
    let avant = lire_fichier(&s, "revue");
    let r = s.appel(
        "PUT",
        "/api/workflows/revue",
        &json!({ "noeuds": noeuds, "liens": [{ "de": "n1", "vers": "absent" }] }),
    );
    assert_eq!(r.code, 400);
    assert_eq!(lire_fichier(&s, "revue"), avant);
    assert_eq!(
        s.appel("GET", "/api/workflows/inconnu", &Value::Null).code,
        404
    );
    assert_eq!(s.appel("GET", "/api/workflows/..", &Value::Null).code, 404);
}

#[test]
fn REQ192_AC2_publication_refusee_messages_dans_l_ordre() {
    let racine = preparer("192ac2");
    let s = demarrer(&racine, "p");
    // Sans nœud.
    let f = creer(&s, "Vide", json!([]), json!([]));
    assert_eq!(
        messages(&s, &f),
        ["Ajoutez un déclencheur.", "Ajoutez une action."]
    );
    // Deux déclencheurs, une action non reliée, une action au champ vide.
    let f = creer(
        &s,
        "Complet",
        json!([
            noeud("d1", "dossier", "Fichiers d'un dossier 1", dossier_ok()),
            noeud("d2", "appel", "Appel par un agent 1", json!({})),
            noeud(
                "a1",
                "shell",
                "Commande shell 1",
                json!({ "commande": " " })
            ),
            noeud(
                "a2",
                "shell",
                "Commande shell 2",
                json!({ "commande": "ls" })
            ),
            noeud(
                "a3",
                "shell",
                "Commande shell 3",
                json!({ "commande": "ls" })
            ),
        ]),
        json!([{ "de": "d1", "vers": "a1" }, { "de": "a2", "vers": "a3" }]),
    );
    let avant = lire_fichier(&s, &f);
    assert_eq!(
        messages(&s, &f),
        [
            "Un seul déclencheur par workflow.",
            "« Commande shell 2 » n'est pas relié au déclencheur.",
            "« Commande shell 3 » n'est pas relié au déclencheur.",
            "« Commande shell 1 » : donnez la commande.",
        ]
    );
    assert_eq!(lire_fichier(&s, &f), avant);
    // Relié par une chaîne : valide.
    let f = creer(
        &s,
        "Chaine",
        json!([
            noeud("d", "appel", "Appel par un agent 1", json!({})),
            noeud(
                "a",
                "shell",
                "Commande shell 1",
                json!({ "commande": "ls" })
            ),
            noeud(
                "b",
                "shell",
                "Commande shell 2",
                json!({ "commande": "ls" })
            ),
        ]),
        json!([{ "de": "d", "vers": "a" }, { "de": "a", "vers": "b" }]),
    );
    let r = s.appel("POST", &format!("/api/workflows/{f}/publier"), &Value::Null);
    assert_eq!(r.code, 200, "{}", r.corps);
}

#[test]
fn REQ192_AC3_workflow_publie_refuse_l_enregistrement() {
    let racine = preparer("192ac3");
    let s = demarrer(&racine, "p");
    let noeuds = json!([
        noeud("d", "appel", "Appel par un agent 1", json!({})),
        noeud(
            "a",
            "shell",
            "Commande shell 1",
            json!({ "commande": "ls" })
        ),
    ]);
    let f = creer(&s, "Pub", noeuds, json!([{ "de": "d", "vers": "a" }]));
    s.appel("POST", &format!("/api/workflows/{f}/publier"), &Value::Null);
    let avant = lire_fichier(&s, &f);
    let r = s.appel(
        "PUT",
        &format!("/api/workflows/{f}"),
        &json!({ "noeuds": [], "liens": [] }),
    );
    assert_eq!(r.code, 409);
    assert_eq!(lire_fichier(&s, &f), avant);
    // Dépublié, il s'enregistre de nouveau.
    let r = s.appel(
        "POST",
        &format!("/api/workflows/{f}/depublier"),
        &Value::Null,
    );
    assert_eq!(r.json()["publie"], false);
    let r = s.appel(
        "PUT",
        &format!("/api/workflows/{f}"),
        &json!({ "noeuds": [], "liens": [] }),
    );
    assert_eq!(r.code, 200);
}

#[test]
fn REQ192_AC6_etat_publie_garde_apres_redemarrage() {
    let racine = preparer("192ac6");
    {
        let s = demarrer(&racine, "p");
        let noeuds = json!([
            noeud("d", "appel", "Appel par un agent 1", json!({})),
            noeud(
                "a",
                "shell",
                "Commande shell 1",
                json!({ "commande": "ls" })
            ),
        ]);
        let liens = json!([{ "de": "d", "vers": "a" }]);
        let f = creer(&s, "Publié", noeuds, liens);
        creer(&s, "Brouillon", json!([]), json!([]));
        let r = s.appel("POST", &format!("/api/workflows/{f}/publier"), &Value::Null);
        assert_eq!(r.json()["publie"], true);
    }
    let s = demarrer(&racine, "p");
    let l = s.appel("GET", "/api/workflows", &Value::Null).json();
    assert_eq!(
        l["workflows"],
        json!([
            { "nom": "Brouillon", "fichier": "brouillon", "publie": false, "enCours": null },
            { "nom": "Publié", "fichier": "publie", "publie": true, "enCours": null },
        ])
    );
}

#[test]
fn REQ193_AC2_declencheurs_champs_refuses() {
    let racine = preparer("193ac2");
    let s = demarrer(&racine, "p");
    let action = noeud(
        "a",
        "shell",
        "Commande shell 1",
        json!({ "commande": "ls" }),
    );
    let essai = |nom: &str, declencheur: Value| {
        let f = creer(
            &s,
            nom,
            json!([declencheur, action.clone()]),
            json!([{ "de": "d", "vers": "a" }]),
        );
        messages(&s, &f)
    };
    let chemin = "« Fichiers d'un dossier 1 » : donnez un chemin dans le projet.";
    for dossier in ["", "/etc", "../dehors", "a/../../b"] {
        let m = essai(
            &format!("Chemin {dossier}"),
            noeud(
                "d",
                "dossier",
                "Fichiers d'un dossier 1",
                json!({ "dossier": dossier, "evenements": ["cree"] }),
            ),
        );
        assert_eq!(m, [chemin], "{dossier}");
    }
    let m = essai(
        "Cases",
        noeud(
            "d",
            "dossier",
            "Fichiers d'un dossier 1",
            json!({ "dossier": ".", "evenements": [] }),
        ),
    );
    assert_eq!(
        m,
        ["« Fichiers d'un dossier 1 » : cochez au moins un évènement."]
    );
    for cron in ["61 * * * *", "", "* * * *"] {
        let m = essai(
            &format!("Cron {cron}"),
            noeud(
                "d",
                "planification",
                "Planification 1",
                json!({ "cron": cron }),
            ),
        );
        assert_eq!(
            m,
            ["« Planification 1 » : donnez une expression cron à cinq champs, par exemple 0 9 * * 1-5."],
            "{cron}"
        );
    }
    // Une expression valide est acceptée.
    let f = creer(
        &s,
        "Cron bon",
        json!([
            noeud(
                "d",
                "planification",
                "Planification 1",
                json!({ "cron": "30 9 * * 1-5" })
            ),
            action.clone()
        ]),
        json!([{ "de": "d", "vers": "a" }]),
    );
    let r = s.appel("POST", &format!("/api/workflows/{f}/publier"), &Value::Null);
    assert_eq!(r.code, 200, "{}", r.corps);
}

#[test]
fn REQ195_AC6_champs_obligatoires_des_actions() {
    let racine = preparer("195ac6");
    let s = demarrer(&racine, "p");
    let f = creer(
        &s,
        "Actions",
        json!([
            noeud("d", "appel", "Appel par un agent 1", json!({})),
            noeud(
                "a1",
                "agent",
                "Agent 1",
                json!({ "agent": "", "message": "" })
            ),
            noeud(
                "a2",
                "agent",
                "Agent 2",
                json!({ "agent": "relecteur", "message": "" })
            ),
            noeud("a3", "claude", "Session Claude 1", json!({ "demande": "" })),
            noeud("a8", "trace", "Trace 1", json!({ "message": "" })),
            noeud(
                "a4",
                "fichier",
                "Fichier 1",
                json!({ "operation": "lire", "chemin": "" })
            ),
            // Champs d'une autre opération : non vérifiés.
            noeud(
                "a5",
                "fichier",
                "Fichier 2",
                json!({ "operation": "lire", "chemin": "a.txt", "contenu": "", "destination": "/x" }),
            ),
            noeud(
                "a6",
                "fichier",
                "Fichier 3",
                json!({ "operation": "ecrire", "chemin": "a.txt" })
            ),
            noeud(
                "a7",
                "fichier",
                "Fichier 4",
                json!({ "operation": "copier", "chemin": "a.txt", "destination": "../b" }),
            ),
        ]),
        json!([
            { "de": "d", "vers": "a1" }, { "de": "d", "vers": "a2" }, { "de": "d", "vers": "a3" },
            { "de": "d", "vers": "a4" }, { "de": "d", "vers": "a5" }, { "de": "d", "vers": "a6" },
            { "de": "d", "vers": "a7" }, { "de": "d", "vers": "a8" }
        ]),
    );
    assert_eq!(
        messages(&s, &f),
        [
            "« Agent 1 » : choisissez un agent.",
            "« Agent 2 » : donnez le message.",
            "« Session Claude 1 » : donnez la demande.",
            "« Trace 1 » : donnez le message.",
            "« Fichier 1 » : donnez un chemin dans le projet.",
            "« Fichier 3 » : donnez le contenu.",
            "« Fichier 4 » : donnez une destination dans le projet.",
        ]
    );
}

#[test]
fn REQ190_routes_exigent_session_et_origine() {
    let racine = preparer("securite");
    let s = demarrer(&racine, "p");
    let r = requete(s.port, "GET", "/api/workflows", "", "", b"");
    assert_eq!(r.code, 401);
    let r = requete(
        s.port,
        "POST",
        "/api/workflows",
        &s.cookie,
        "https://autre.example",
        br#"{"nom":"x"}"#,
    );
    assert_eq!(r.code, 403);
    assert!(!s.yaide().exists());
}

// ---- Exécution (REQ-193, REQ-194, REQ-195) ----

fn attendre(mut ok: impl FnMut() -> bool) -> bool {
    for _ in 0..150 {
        if ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// Le temps de laisser passer quelques vérifications (100 ms chacune) sans rien voir arriver.
fn laisser_passer() {
    std::thread::sleep(Duration::from_millis(1500));
}

/// Le temps du premier regard sur l'état du moment, après le lancement ou la publication.
fn premier_regard() {
    std::thread::sleep(Duration::from_millis(600));
}

fn journal(s: &Serveur) -> Vec<Value> {
    s.appel("GET", "/api/journal", &Value::Null).json()["lignes"]
        .as_array()
        .unwrap()
        .clone()
}

fn lignes_du_journal(s: &Serveur, message: &str) -> usize {
    journal(s)
        .iter()
        .filter(|l| l["message"] == message)
        .count()
}

fn ecrire_projet(s: &Serveur, rel: &str, contenu: &str) {
    let chemin = s.projet.join(rel);
    std::fs::create_dir_all(chemin.parent().unwrap()).unwrap();
    std::fs::write(chemin, contenu).unwrap();
}

fn lire_projet(s: &Serveur, rel: &str) -> String {
    std::fs::read_to_string(s.projet.join(rel)).unwrap_or_default()
}

fn nb_lignes(s: &Serveur, rel: &str) -> usize {
    lire_projet(s, rel).lines().count()
}

fn shell(id: &str, titre: &str, y: f64, commande: &str) -> Value {
    json!({ "id": id, "type": "shell", "titre": titre, "x": 0.0, "y": y,
            "reglages": { "commande": commande } })
}

fn dossier(dossier: &str, evenements: Value) -> Value {
    noeud(
        "t",
        "dossier",
        "Fichiers d'un dossier 1",
        json!({ "dossier": dossier, "evenements": evenements }),
    )
}

fn publier(s: &Serveur, fichier: &str) {
    let r = s.appel(
        "POST",
        &format!("/api/workflows/{fichier}/publier"),
        &Value::Null,
    );
    assert_eq!(r.code, 200, "{}", r.corps);
}

fn depublier(s: &Serveur, fichier: &str) {
    let r = s.appel(
        "POST",
        &format!("/api/workflows/{fichier}/depublier"),
        &Value::Null,
    );
    assert_eq!(r.code, 200, "{}", r.corps);
}

const MARQUE: &str = "echo x >> marque.txt";
const ENTREE: &str = "printf '%s' \"$YAIDE_ENTREE\" > entree.txt; echo x >> marque.txt";

#[test]
fn REQ192_AC1_REQ193_AC1_publie_lance_a_l_evenement_ecoute_depublie_ne_lance_rien() {
    let racine = preparer("exec1");
    let s = demarrer(&racine, "p");
    std::fs::create_dir_all(s.projet.join("notes")).unwrap();
    let f = creer(
        &s,
        "Revue des notes",
        json!([
            dossier("notes", json!(["cree"])),
            shell("a", "Commande shell 1", 0.0, ENTREE)
        ]),
        json!([{ "de": "t", "vers": "a" }]),
    );
    publier(&s, &f);
    let fichier: Value = serde_json::from_slice(&lire_fichier(&s, &f)).unwrap();
    assert_eq!(fichier["publie"], true);
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "1");
    assert!(attendre(|| nb_lignes(&s, "marque.txt") == 1));
    assert_eq!(
        lire_projet(&s, "entree.txt"),
        "Évènement : changements dans le dossier `notes/` :\nCréés :\n- `notes/a.md`"
    );
    // « Modifié » n'est pas coché : rien.
    ecrire_projet(&s, "notes/a.md", "2");
    laisser_passer();
    assert_eq!(nb_lignes(&s, "marque.txt"), 1);
    // Dépublié : un fichier créé ne lance rien.
    depublier(&s, &f);
    ecrire_projet(&s, "notes/b.md", "1");
    laisser_passer();
    assert_eq!(nb_lignes(&s, "marque.txt"), 1);
    // Les trois cases : modifié, puis supprimé.
    let r = s.appel(
        "PUT",
        &format!("/api/workflows/{f}"),
        &json!({
            "noeuds": [dossier("notes", json!(["cree", "modifie", "supprime"])),
                       shell("a", "Commande shell 1", 0.0, ENTREE)],
            "liens": [{ "de": "t", "vers": "a" }]
        }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    publier(&s, &f);
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "3");
    assert!(attendre(|| nb_lignes(&s, "marque.txt") == 2));
    assert_eq!(
        lire_projet(&s, "entree.txt"),
        "Évènement : changements dans le dossier `notes/` :\nCréés : aucun\nModifiés :\n- `notes/a.md`\nSupprimés : aucun"
    );
    premier_regard();
    std::fs::remove_file(s.projet.join("notes/a.md")).unwrap();
    assert!(attendre(|| nb_lignes(&s, "marque.txt") == 3));
    assert_eq!(
        lire_projet(&s, "entree.txt"),
        "Évènement : changements dans le dossier `notes/` :\nCréés : aucun\nModifiés : aucun\nSupprimés :\n- `notes/a.md`"
    );
}

#[test]
fn REQ192_AC5_REQ194_AC4_depublier_pendant_l_execution_elle_va_a_son_terme_et_le_journal_la_suit() {
    let racine = preparer("exec2");
    let s = demarrer(&racine, "p");
    let commande = "sleep 1; echo fin >> marque.txt";
    let f = creer(
        &s,
        "Revue des notes",
        json!([
            dossier("notes", json!(["cree"])),
            shell("a", "Commande shell 1", 0.0, commande)
        ]),
        json!([{ "de": "t", "vers": "a" }]),
    );
    publier(&s, &f);
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "1");
    assert!(attendre(|| lignes_du_journal(
        &s,
        "Workflow « Revue des notes » lancé."
    ) == 1));
    depublier(&s, &f);
    // L'onglet redevient modifiable : l'enregistrement est accepté pendant l'exécution.
    let r = s.appel(
        "PUT",
        &format!("/api/workflows/{f}"),
        &json!({ "noeuds": [], "liens": [] }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    assert!(attendre(|| lignes_du_journal(
        &s,
        "Workflow « Revue des notes » terminé."
    ) == 1));
    assert_eq!(lire_projet(&s, "marque.txt"), "fin\n");
    let l = journal(&s);
    let pos = |m: &str| l.iter().position(|x| x["message"] == m).unwrap();
    let debut = pos("Workflow « Revue des notes » lancé.");
    let fin = pos("Workflow « Revue des notes » terminé.");
    assert!(debut < fin);
    assert_eq!(l[debut]["severite"], "Information");
    assert_eq!(l[fin]["severite"], "Information");
}

#[test]
fn REQ192_AC6_publie_ecoute_apres_redemarrage_brouillon_reste_brouillon() {
    let racine = preparer("exec3");
    let s = demarrer(&racine, "p");
    let noeuds = |dossier_surveille: &str, commande: &str| {
        json!([
            dossier(dossier_surveille, json!(["cree"])),
            shell("a", "Commande shell 1", 0.0, commande)
        ])
    };
    let liens = json!([{ "de": "t", "vers": "a" }]);
    let publie = creer(
        &s,
        "Publié",
        noeuds("notes", "echo x >> publie.txt"),
        liens.clone(),
    );
    let brouillon = creer(
        &s,
        "Brouillon",
        noeuds("notes", "echo x >> brouillon.txt"),
        liens,
    );
    publier(&s, &publie);
    drop(s);
    let s = demarrer(&racine, "p");
    let l = s.appel("GET", "/api/workflows", &Value::Null).json();
    let etat = |f: &str| {
        l["workflows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["fichier"] == f)
            .unwrap()["publie"]
            .clone()
    };
    assert_eq!(etat(&publie), true);
    assert_eq!(etat(&brouillon), false);
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "1");
    assert!(attendre(|| nb_lignes(&s, "publie.txt") == 1));
    laisser_passer();
    assert_eq!(nb_lignes(&s, "brouillon.txt"), 0);
}

#[test]
fn REQ193_AC4_evenement_pendant_l_execution_ignore_et_rien_apres_un_arret() {
    let racine = preparer("exec4");
    let s = demarrer(&racine, "p");
    let commande = "sleep 2; echo x >> marque.txt";
    let f = creer(
        &s,
        "Revue des notes",
        json!([
            dossier("notes", json!(["cree"])),
            shell("a", "Commande shell 1", 0.0, commande)
        ]),
        json!([{ "de": "t", "vers": "a" }]),
    );
    publier(&s, &f);
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "1");
    assert!(attendre(|| lignes_du_journal(
        &s,
        "Workflow « Revue des notes » lancé."
    ) == 1));
    ecrire_projet(&s, "notes/b.md", "1");
    assert!(attendre(|| lignes_du_journal(
        &s,
        "Workflow « Revue des notes » terminé."
    ) == 1));
    laisser_passer();
    assert_eq!(
        lignes_du_journal(&s, "Workflow « Revue des notes » lancé."),
        1
    );
    ecrire_projet(&s, "notes/c.md", "1");
    assert!(attendre(|| lignes_du_journal(
        &s,
        "Workflow « Revue des notes » lancé."
    ) == 2));
    // Arrêt : un fichier créé pendant l'arrêt ne lance rien au redémarrage.
    assert!(attendre(|| lignes_du_journal(
        &s,
        "Workflow « Revue des notes » terminé."
    ) == 2));
    drop(s);
    ecrire_projet_hors(&racine, "p/notes/d.md");
    let s = demarrer(&racine, "p");
    laisser_passer();
    assert_eq!(nb_nouveau_lancement(&s), 0);
}

fn ecrire_projet_hors(racine: &Path, rel: &str) {
    std::fs::write(racine.join(rel), "1").unwrap();
}

fn nb_nouveau_lancement(s: &Serveur) -> usize {
    journal(s)
        .iter()
        .filter(|l| l["message"] == "Workflow « Revue des notes » lancé.")
        .count()
}

#[test]
fn REQ194_AC2_suivants_par_position_en_profondeur() {
    let racine = preparer("exec5");
    let s = demarrer(&racine, "p");
    let noeuds = |dossier_surveille: &str, fichier: &str, y_b: f64| {
        let cmd = |t: &str| format!("echo {t} >> {fichier}");
        json!([
            dossier(dossier_surveille, json!(["cree"])),
            shell("a", "A", 10.0, &cmd("A")),
            shell("b", "B", y_b, &cmd("B")),
            shell("c", "C", 30.0, &cmd("C")),
            shell("d", "D", 40.0, &cmd("D")),
        ])
    };
    let liens = json!([
        { "de": "t", "vers": "a" }, { "de": "a", "vers": "c" },
        { "de": "a", "vers": "b" }, { "de": "b", "vers": "d" }
    ]);
    let f1 = creer(
        &s,
        "Premier",
        noeuds("n1", "ordre1.txt", 20.0),
        liens.clone(),
    );
    let f2 = creer(&s, "Second", noeuds("n2", "ordre2.txt", 50.0), liens);
    publier(&s, &f1);
    publier(&s, &f2);
    premier_regard();
    ecrire_projet(&s, "n1/x.md", "1");
    ecrire_projet(&s, "n2/x.md", "1");
    assert!(attendre(
        || nb_lignes(&s, "ordre1.txt") == 4 && nb_lignes(&s, "ordre2.txt") == 4
    ));
    assert_eq!(lire_projet(&s, "ordre1.txt"), "A\nB\nD\nC\n");
    assert_eq!(lire_projet(&s, "ordre2.txt"), "A\nC\nB\nD\n");
}

#[test]
fn REQ194_AC3_echec_arrete_l_execution_et_le_journal_dit_pourquoi() {
    let racine = preparer("exec6");
    let s = demarrer(&racine, "p");
    let f = creer(
        &s,
        "Revue des notes",
        json!([
            dossier("notes", json!(["cree"])),
            shell("a", "Commande shell 1", 10.0, "echo oups >&2; exit 3"),
            shell("b", "Commande shell 2", 20.0, MARQUE)
        ]),
        json!([{ "de": "t", "vers": "a" }, { "de": "a", "vers": "b" }]),
    );
    publier(&s, &f);
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "1");
    let message =
        "Workflow « Revue des notes » : échec de « Commande shell 1 » : code de sortie 3.";
    assert!(attendre(|| lignes_du_journal(&s, message) == 1));
    let l = journal(&s);
    let ligne = l.iter().find(|x| x["message"] == message).unwrap();
    assert_eq!(ligne["severite"], "Erreur");
    assert_eq!(ligne["detail"], "oups");
    laisser_passer();
    assert_eq!(nb_lignes(&s, "marque.txt"), 0);
    assert_eq!(
        lignes_du_journal(&s, "Workflow « Revue des notes » terminé."),
        0
    );
}

#[test]
fn REQ194_AC5_commande_trop_longue_arretee_a_la_limite() {
    let racine = preparer("exec7");
    let s = demarrer_avec_env(&racine, "p", &[("YAIDE_LIMITE_COMMANDE_MS", "1000")]);
    let f = creer(
        &s,
        "Revue des notes",
        json!([
            dossier("notes", json!(["cree"])),
            shell(
                "a",
                "Commande shell 1",
                0.0,
                "sleep 5 & echo $! > pid.txt; wait"
            )
        ]),
        json!([{ "de": "t", "vers": "a" }]),
    );
    publier(&s, &f);
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "1");
    let debut = std::time::Instant::now();
    let message =
        "Workflow « Revue des notes » : échec de « Commande shell 1 » : limite de temps atteinte.";
    assert!(attendre(|| lignes_du_journal(&s, message) == 1));
    assert!(debut.elapsed() < Duration::from_secs(4));
    // La commande est arrêtée : son processus n'existe plus.
    let pid = lire_projet(&s, "pid.txt").trim().to_string();
    assert!(!pid.is_empty());
    assert!(attendre_court(
        || !Path::new(&format!("/proc/{pid}")).exists()
    ));
}

fn attendre_court(mut ok: impl FnMut() -> bool) -> bool {
    for _ in 0..10 {
        if ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

#[test]
fn REQ194_AC6_deux_workflows_sur_le_meme_dossier_tournent_en_meme_temps() {
    let racine = preparer("exec8");
    let s = demarrer(&racine, "p");
    for nom in ["Premier", "Second"] {
        let f = creer(
            &s,
            nom,
            json!([
                dossier("notes", json!(["cree"])),
                shell("a", "Commande shell 1", 0.0, "sleep 2")
            ]),
            json!([{ "de": "t", "vers": "a" }]),
        );
        publier(&s, &f);
    }
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "1");
    assert!(attendre(|| {
        lignes_du_journal(&s, "Workflow « Premier » lancé.") == 1
            && lignes_du_journal(&s, "Workflow « Second » lancé.") == 1
    }));
    // Les deux sont lancés avant que l'un ait fini.
    assert_eq!(lignes_du_journal(&s, "Workflow « Premier » terminé."), 0);
    assert_eq!(lignes_du_journal(&s, "Workflow « Second » terminé."), 0);
}

#[test]
fn REQ195_AC3_commande_shell_dans_la_racine_sans_ouvrir_de_shell() {
    let racine = preparer("exec9");
    let s = demarrer(&racine, "p");
    let avant = s.appel("GET", "/api/shells", &Value::Null).corps;
    let f = creer(
        &s,
        "Revue des notes",
        json!([
            dossier("notes", json!(["cree"])),
            shell(
                "a",
                "Commande shell 1",
                0.0,
                "{ pwd; echo \"$YAIDE_ENTREE\"; } > sortie.txt"
            )
        ]),
        json!([{ "de": "t", "vers": "a" }]),
    );
    publier(&s, &f);
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "1");
    assert!(attendre(|| lignes_du_journal(
        &s,
        "Workflow « Revue des notes » terminé."
    ) == 1));
    assert_eq!(
        lire_projet(&s, "sortie.txt"),
        format!(
            "{}\nÉvènement : changements dans le dossier `notes/` :\nCréés :\n- `notes/a.md`\n",
            s.projet.display()
        )
    );
    assert_eq!(s.appel("GET", "/api/shells", &Value::Null).corps, avant);
}

fn fichier_op(id: &str, titre: &str, y: f64, reglages: Value) -> Value {
    json!({ "id": id, "type": "fichier", "titre": titre, "x": 0.0, "y": y, "reglages": reglages })
}

fn attendre_termine(s: &Serveur, nom: &str, n: usize) {
    assert!(
        attendre(|| lignes_du_journal(s, &format!("Workflow « {nom} » terminé.")) == n),
        "journal : {:?}",
        journal(s)
    );
}

fn publier_sur_notes(s: &Serveur, nom: &str, noeuds: Vec<Value>, liens: Value) {
    let mut tous = vec![dossier("notes", json!(["cree"]))];
    tous.extend(noeuds);
    let f = creer(s, nom, json!(tous), liens);
    publier(s, &f);
    premier_regard();
}

#[test]
fn REQ194_AC1_l_entree_est_dans_l_environnement_et_remplace_dans_les_champs() {
    let racine = preparer("act1");
    let s = demarrer(&racine, "p");
    let mut noeuds = vec![dossier("notes", json!(["cree", "modifie", "supprime"]))];
    noeuds.extend([
        shell(
            "a",
            "Commande shell 1",
            10.0,
            "printf '%s\\n' \"$YAIDE_ENTREE\" | wc -l",
        ),
        fichier_op(
            "b",
            "Fichier 1",
            20.0,
            json!({ "operation": "ecrire", "chemin": "res.txt", "contenu": "lignes : {{entree}}" }),
        ),
    ]);
    let f = creer(
        &s,
        "Revue des notes",
        json!(noeuds),
        json!([{ "de": "t", "vers": "a" }, { "de": "a", "vers": "b" }]),
    );
    publier(&s, &f);
    premier_regard();
    ecrire_projet(&s, "notes/a.md", "1");
    attendre_termine(&s, "Revue des notes", 1);
    assert_eq!(lire_projet(&s, "res.txt"), "lignes : 5\n");
}

#[test]
fn REQ195_AC9_trace_une_ligne_sans_detail_puis_plusieurs_lignes_avec_detail() {
    let racine = preparer("trace");
    let s = demarrer(&racine, "p");
    let trace = |id: &str, y: f64, m: &str| {
        json!({ "id": id, "type": "trace", "titre": "Trace 1", "x": 0.0, "y": y,
                "reglages": { "message": m } })
    };
    publier_sur_notes(
        &s,
        "Revue des notes",
        vec![
            shell("a", "Commande shell 1", 10.0, "printf -- '- `notes/a.md`'"),
            trace("b", 20.0, "Reçu : {{entree}}"),
            fichier_op(
                "c",
                "Fichier 1",
                30.0,
                json!({ "operation": "ecrire", "chemin": "t.txt", "contenu": "{{entree}}" }),
            ),
            shell("d", "Commande shell 2", 40.0, "printf '1\\n2'"),
            trace("e", 50.0, "a{{entree}}"),
        ],
        json!([{ "de": "t", "vers": "a" }, { "de": "a", "vers": "b" }, { "de": "b", "vers": "c" },
               { "de": "c", "vers": "d" }, { "de": "d", "vers": "e" }]),
    );
    ecrire_projet(&s, "notes/a.md", "1");
    attendre_termine(&s, "Revue des notes", 1);
    assert_eq!(lire_projet(&s, "t.txt"), "- `notes/a.md`");
    let l = journal(&s);
    let pos = |m: &str| l.iter().position(|x| x["message"] == m).unwrap();
    let une = pos("Workflow « Revue des notes » : Reçu : - `notes/a.md`");
    let deux = pos("Workflow « Revue des notes » : a1");
    assert!(pos("Workflow « Revue des notes » lancé.") < une);
    assert!(une < deux);
    assert!(deux < pos("Workflow « Revue des notes » terminé."));
    assert_eq!(l[une]["severite"], "Information");
    assert!(l[une]["detail"].is_null(), "{}", l[une]);
    assert_eq!(l[deux]["severite"], "Information");
    assert_eq!(l[deux]["detail"], "a1\n2");
}

#[test]
fn REQ193_AC5_une_action_fichier_dans_le_dossier_surveille_ne_relance_rien() {
    let racine = preparer("act2");
    let s = demarrer(&racine, "p");
    publier_sur_notes(
        &s,
        "Revue des notes",
        vec![fichier_op(
            "a",
            "Fichier 1",
            10.0,
            json!({ "operation": "ecrire", "chemin": "notes/sortie.md", "contenu": "x" }),
        )],
        json!([{ "de": "t", "vers": "a" }]),
    );
    ecrire_projet(&s, "notes/a.md", "1");
    attendre_termine(&s, "Revue des notes", 1);
    laisser_passer();
    laisser_passer();
    assert_eq!(lire_projet(&s, "notes/sortie.md"), "x");
    assert_eq!(nb_nouveau_lancement(&s), 1);
}

#[test]
fn REQ195_AC5_operations_sur_les_fichiers_et_chemins_refuses() {
    let racine = preparer("act3");
    let s = demarrer(&racine, "p");
    let chaine: Vec<Value> = vec![
        fichier_op(
            "a",
            "Fichier 1",
            1.0,
            json!({ "operation": "ecrire", "chemin": "out/a.txt", "contenu": "{{entree}}" }),
        ),
        fichier_op(
            "b",
            "Fichier 2",
            2.0,
            json!({ "operation": "lire", "chemin": "out/a.txt" }),
        ),
        shell(
            "c",
            "Commande shell 1",
            3.0,
            "printf '%s' \"$YAIDE_ENTREE\" > lu.txt",
        ),
        fichier_op(
            "d",
            "Fichier 3",
            4.0,
            json!({ "operation": "copier", "chemin": "out/a.txt", "destination": "b.txt" }),
        ),
        shell("g", "Commande shell 2", 4.5, "cat b.txt > copie.txt"),
        fichier_op(
            "e",
            "Fichier 4",
            5.0,
            json!({ "operation": "deplacer", "chemin": "out/a.txt", "destination": "c/c.txt" }),
        ),
        fichier_op(
            "f",
            "Fichier 5",
            6.0,
            json!({ "operation": "supprimer", "chemin": "b.txt" }),
        ),
    ];
    let liens = json!([
        { "de": "t", "vers": "a" }, { "de": "a", "vers": "b" }, { "de": "b", "vers": "c" },
        { "de": "c", "vers": "d" }, { "de": "d", "vers": "g" }, { "de": "g", "vers": "e" }, { "de": "e", "vers": "f" }
    ]);
    publier_sur_notes(&s, "Chaine", chaine, liens);
    ecrire_projet(&s, "notes/a.md", "1");
    attendre_termine(&s, "Chaine", 1);
    let entree = "Évènement : changements dans le dossier `notes/` :\nCréés :\n- `notes/a.md`";
    // « Lire » donne le contenu écrit, que la commande suivante reçoit.
    assert_eq!(lire_projet(&s, "lu.txt"), entree);
    assert_eq!(lire_projet(&s, "c/c.txt"), entree);
    assert_eq!(lire_projet(&s, "copie.txt"), entree);
    assert!(!s.projet.join("out/a.txt").exists());
    assert!(!s.projet.join("b.txt").exists());
    assert!(s.projet.join("out").is_dir());

    // Fichier absent.
    let f = creer(
        &s,
        "Absent",
        json!([
            dossier("autre", json!(["cree"])),
            fichier_op(
                "a",
                "Fichier 1",
                1.0,
                json!({ "operation": "lire", "chemin": "out/z.txt" })
            )
        ]),
        json!([{ "de": "t", "vers": "a" }]),
    );
    publier(&s, &f);
    // Chemin devenu `../x` après le remplacement de {{entree}}.
    let f = creer(
        &s,
        "Dehors",
        json!([
            dossier("hors", json!(["cree"])),
            shell("s", "Commande shell 1", 1.0, "printf '../x'"),
            fichier_op(
                "a",
                "Fichier 1",
                2.0,
                json!({ "operation": "ecrire", "chemin": "{{entree}}", "contenu": "secret" })
            )
        ]),
        json!([{ "de": "t", "vers": "s" }, { "de": "s", "vers": "a" }]),
    );
    publier(&s, &f);
    premier_regard();
    ecrire_projet(&s, "autre/a.md", "1");
    ecrire_projet(&s, "hors/a.md", "1");
    let m1 = "Workflow « Absent » : échec de « Fichier 1 » : le fichier out/z.txt n'existe pas.";
    let m2 = "Workflow « Dehors » : échec de « Fichier 1 » : chemin hors du projet.";
    assert!(
        attendre(|| lignes_du_journal(&s, m1) == 1 && lignes_du_journal(&s, m2) == 1),
        "journal : {:?}",
        journal(&s)
    );
    assert!(!racine.join("p/../x").exists());
    assert!(!racine.join("x").exists());
}

/// Dossier de `PATH` avec un faux `claude` qui écrit ses arguments et son dossier de travail.
fn faux_claude(racine: &Path) -> (String, PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let bin = racine.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let temoin = racine.join("temoin.txt");
    let script = format!(
        "#!/bin/sh\n{{ for a; do echo \"arg=$a\"; done; echo \"pwd=$(pwd)\"; }} > '{}'\necho fait\n",
        temoin.display()
    );
    let f = bin.join("claude");
    std::fs::write(&f, script).unwrap();
    std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
    (format!("{}:/usr/bin:/bin", bin.display()), temoin)
}

#[test]
fn REQ195_AC4_session_claude_avec_le_path_puis_sans_claude() {
    let racine = preparer("act4");
    let (path, temoin) = faux_claude(&racine);
    let s = demarrer_avec_env(&racine, "p", &[("PATH", &path)]);
    publier_sur_notes(
        &s,
        "Revue des notes",
        vec![
            shell("s", "Commande shell 0", 0.5, "printf x.md"),
            json!({ "id": "a", "type": "claude", "titre": "Session Claude 1", "x": 0.0, "y": 1.0,
                    "reglages": { "demande": "Résume {{entree}}" } }),
            shell(
                "b",
                "Commande shell 1",
                2.0,
                "printf '%s' \"$YAIDE_ENTREE\" > sortie.txt",
            ),
        ],
        json!([{ "de": "t", "vers": "s" }, { "de": "s", "vers": "a" }, { "de": "a", "vers": "b" }]),
    );
    ecrire_projet(&s, "notes/a.md", "1");
    attendre_termine(&s, "Revue des notes", 1);
    let t = std::fs::read_to_string(&temoin).unwrap();
    assert_eq!(
        t,
        format!("arg=-p\narg=Résume x.md\npwd={}\n", s.projet.display())
    );
    assert_eq!(lire_projet(&s, "sortie.txt"), "fait\n");
    drop(s);

    let racine = preparer("act4b");
    let s = demarrer_avec_env(&racine, "p", &[("PATH", "/usr/bin:/bin")]);
    publier_sur_notes(
        &s,
        "Revue des notes",
        vec![
            json!({ "id": "a", "type": "claude", "titre": "Session Claude 1", "x": 0.0, "y": 1.0,
                     "reglages": { "demande": "Bonjour" } }),
        ],
        json!([{ "de": "t", "vers": "a" }]),
    );
    ecrire_projet(&s, "notes/a.md", "1");
    let m = "Workflow « Revue des notes » : échec de « Session Claude 1 » : la commande claude est introuvable.";
    assert!(
        attendre(|| lignes_du_journal(&s, m) == 1),
        "{:?}",
        journal(&s)
    );
}

type Recues = std::sync::Arc<std::sync::Mutex<Vec<Value>>>;

/// Faux provider compatible OpenAI : répond toujours `texte` ; chaque requête est notée.
fn faux_provider(texte: &'static str) -> (String, Recues) {
    use axum::body::Bytes;
    use axum::extract::State;
    async fn rep(State(r): State<(Recues, &'static str)>, corps: Bytes) -> String {
        r.0.lock()
            .unwrap()
            .push(serde_json::from_slice::<Value>(&corps).unwrap_or(Value::Null));
        json!({"choices": [{"message": {"content": r.1}}],
               "usage": {"prompt_tokens": 7, "completion_tokens": 1}})
        .to_string()
    }
    let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    ecoute.set_nonblocking(true).unwrap();
    let adresse = format!("http://{}", ecoute.local_addr().unwrap());
    let recues: Recues = Default::default();
    let etat = (recues.clone(), texte);
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

fn creer_relecteur(s: &Serveur) {
    let r = s.appel(
        "PUT",
        "/api/agent/agents",
        &json!({ "nom": "Relecteur", "couleur": "vert" }),
    );
    assert_eq!(r.code, 200, "{}", r.corps);
    std::fs::write(s.yaide().join("agents/relecteur/AGENTS.md"), "Tu relis.").unwrap();
}

fn conversations(s: &Serveur) -> Vec<Value> {
    s.appel("GET", "/api/agent/conversations", &Value::Null)
        .json()
        .as_array()
        .unwrap()
        .clone()
}

fn agent_noeud() -> Value {
    json!({ "id": "a", "type": "agent", "titre": "Agent 1", "x": 0.0, "y": 1.0,
            "reglages": { "agent": "relecteur", "nom": "Relecteur", "message": "Relis : {{entree}}" } })
}

#[test]
fn REQ195_AC1_agent_seul_puis_sortie_passee_a_l_action_suivante() {
    let (adresse, recues) = faux_provider("Rien à redire.");
    let racine = preparer("act5");
    let s = demarrer(&racine, "p");
    configurer(&s, &adresse, true);
    creer_relecteur(&s);
    publier_sur_notes(
        &s,
        "Revue des notes",
        vec![
            agent_noeud(),
            fichier_op(
                "b",
                "Fichier 1",
                2.0,
                json!({ "operation": "ecrire", "chemin": "avis.txt", "contenu": "{{entree}}" }),
            ),
        ],
        json!([{ "de": "t", "vers": "a" }, { "de": "a", "vers": "b" }]),
    );
    ecrire_projet(&s, "notes/a.md", "1");
    attendre_termine(&s, "Revue des notes", 1);
    assert_eq!(lire_projet(&s, "avis.txt"), "Rien à redire.");
    let l = conversations(&s);
    assert_eq!(l.len(), 1);
    let v = s
        .appel(
            "GET",
            &format!("/api/agent/conversations/{}", l[0]["id"].as_str().unwrap()),
            &Value::Null,
        )
        .json();
    assert_eq!(v["agents"].as_array().unwrap().len(), 1);
    assert_eq!(v["agents"][0]["dossier"], "relecteur");
    assert!(v["entrees"][0]["texte"].as_str().unwrap().starts_with(
        "Relis : Évènement : changements dans le dossier `notes/` :\nCréés :\n- `notes/a.md`"
    ));
    let reqs = recues.lock().unwrap().clone();
    let r = &reqs[0];
    assert_eq!(r["model"], "m");
    let corps = r["messages"].to_string();
    assert!(corps.contains("Tu relis."));
    assert!(corps.contains("Relis : Évènement : changements dans le dossier"));
}

#[test]
fn REQ195_AC2_refus_enregistre_et_agent_disparu() {
    let (adresse, recues) = faux_provider("ok");
    let racine = preparer("act6");
    let s = demarrer(&racine, "p");
    configurer(&s, &adresse, false);
    creer_relecteur(&s);
    publier_sur_notes(
        &s,
        "Revue des notes",
        vec![agent_noeud()],
        json!([{ "de": "t", "vers": "a" }]),
    );
    ecrire_projet(&s, "notes/a.md", "1");
    let refus = "Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM";
    let m = format!("Workflow « Revue des notes » : échec de « Agent 1 » : {refus}.");
    assert!(
        attendre(|| lignes_du_journal(&s, &m) == 1),
        "{:?}",
        journal(&s)
    );
    let l = conversations(&s);
    assert_eq!(l.len(), 1);
    let v = s
        .appel(
            "GET",
            &format!("/api/agent/conversations/{}", l[0]["id"].as_str().unwrap()),
            &Value::Null,
        )
        .json();
    assert!(v["entrees"][0]["texte"]
        .as_str()
        .unwrap()
        .starts_with("Relis : "));
    assert_eq!(v["entrees"][1]["variante"], "erreur");
    assert_eq!(v["entrees"][1]["texte"], format!("{refus}."));
    assert!(recues.lock().unwrap().is_empty());

    std::fs::remove_dir_all(s.yaide().join("agents/relecteur")).unwrap();
    ecrire_projet(&s, "notes/b.md", "1");
    let m = "Workflow « Revue des notes » : échec de « Agent 1 » : l'agent « Relecteur » n'existe plus.";
    assert!(
        attendre(|| lignes_du_journal(&s, m) == 1),
        "{:?}",
        journal(&s)
    );
}

// ---- Nœud en cours et arrêt (REQ-197, REQ-198) ----

fn en_cours_liste(s: &Serveur, f: &str) -> Value {
    let l = s.appel("GET", "/api/workflows", &Value::Null).json();
    l["workflows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["fichier"] == f)
        .unwrap()["enCours"]
        .clone()
}

fn en_cours_route(s: &Serveur, f: &str) -> Value {
    s.appel(
        "GET",
        &format!("/api/workflows/{f}/execution"),
        &Value::Null,
    )
    .json()
}

fn arreter(s: &Serveur, f: &str) -> Rep {
    s.appel("POST", &format!("/api/workflows/{f}/arreter"), &Value::Null)
}

#[test]
fn REQ197_AC1_noeud_en_cours_dans_la_liste_et_la_route_puis_aucun() {
    let racine = preparer("suivi1");
    let s = demarrer(&racine, "p");
    let brouillon = creer(&s, "Brouillon", json!([]), json!([]));
    assert_eq!(en_cours_liste(&s, &brouillon), Value::Null);
    assert_eq!(en_cours_route(&s, &brouillon)["enCours"], Value::Null);
    assert_eq!(en_cours_route(&s, &brouillon)["publie"], false);
    let f = creer(
        &s,
        "Revue des notes",
        json!([
            dossier("notes", json!(["cree"])),
            shell("a", "Commande shell 1", 0.0, "sleep 3")
        ]),
        json!([{ "de": "t", "vers": "a" }]),
    );
    publier(&s, &f);
    premier_regard();
    assert_eq!(en_cours_liste(&s, &f), Value::Null);
    ecrire_projet(&s, "notes/a.md", "1");
    assert!(attendre(|| en_cours_liste(&s, &f) == json!("a")));
    let r = en_cours_route(&s, &f);
    assert_eq!(r["enCours"], "a");
    assert_eq!(r["publie"], true);
    attendre_termine(&s, "Revue des notes", 1);
    assert_eq!(en_cours_liste(&s, &f), Value::Null);
    assert_eq!(en_cours_route(&s, &f)["enCours"], Value::Null);
    assert_eq!(
        s.appel("GET", "/api/workflows/inconnu/execution", &Value::Null)
            .code,
        404
    );
}

#[test]
fn REQ198_AC1_AC2_AC4_arret_tue_la_commande_les_suivantes_ne_tournent_pas_et_le_workflow_reste_publie(
) {
    let racine = preparer("arret1");
    let s = demarrer(&racine, "p");
    let f = creer(
        &s,
        "Revue des notes",
        json!([
            dossier("notes", json!(["cree"])),
            shell(
                "a",
                "Commande shell 1",
                0.0,
                "sleep 30 & echo $! > pid.txt; wait; echo fin > fin.txt"
            ),
            fichier_op(
                "b",
                "Fichier 1",
                1.0,
                json!({ "operation": "ecrire", "chemin": "apres.txt", "contenu": "x" })
            )
        ]),
        json!([{ "de": "t", "vers": "a" }, { "de": "a", "vers": "b" }]),
    );
    // Sans exécution : refus, rien au journal.
    publier(&s, &f);
    premier_regard();
    let avant = journal(&s).len();
    let r = arreter(&s, &f);
    assert_eq!(r.code, 409);
    assert_eq!(r.corps, "Revue des notes n'a pas d'exécution en cours.");
    assert_eq!(journal(&s).len(), avant);

    ecrire_projet(&s, "notes/a.md", "1");
    assert!(attendre(|| en_cours_liste(&s, &f) == json!("a")));
    assert!(attendre(|| !lire_projet(&s, "pid.txt").is_empty()));
    let pid = lire_projet(&s, "pid.txt").trim().to_string();
    // Un fichier créé pendant l'exécution, avant l'arrêt, ne lance rien ensuite.
    ecrire_projet(&s, "notes/b.md", "1");
    laisser_passer();
    let debut = std::time::Instant::now();
    assert_eq!(arreter(&s, &f).code, 200);
    assert!(attendre_court(|| en_cours_liste(&s, &f) == Value::Null));
    assert!(attendre_court(
        || !Path::new(&format!("/proc/{pid}")).exists()
    ));
    assert!(debut.elapsed() < Duration::from_secs(2));
    let m = "Workflow « Revue des notes » arrêté pendant « Commande shell 1 ».";
    assert_eq!(lignes_du_journal(&s, m), 1);
    let l = journal(&s);
    assert_eq!(
        l.iter().find(|x| x["message"] == m).unwrap()["severite"],
        "Avertissement"
    );
    std::thread::sleep(Duration::from_secs(2));
    assert!(lire_projet(&s, "fin.txt").is_empty());
    assert!(lire_projet(&s, "apres.txt").is_empty());
    assert_eq!(
        lignes_du_journal(&s, "Workflow « Revue des notes » terminé."),
        0
    );
    assert!(!journal(&s)
        .iter()
        .any(|x| x["message"].as_str().unwrap().contains("échec")));
    // Toujours publié : rien n'a été lancé par b.md, un nouveau fichier lance une exécution.
    assert_eq!(en_cours_route(&s, &f)["publie"], true);
    assert_eq!(
        lignes_du_journal(&s, "Workflow « Revue des notes » lancé."),
        1
    );
    ecrire_projet(&s, "notes/c.md", "1");
    assert!(attendre(|| lignes_du_journal(
        &s,
        "Workflow « Revue des notes » lancé."
    ) == 2));
    arreter(&s, &f);
}

#[test]
fn REQ198_AC3_arret_d_une_action_agent_arrete_le_tour_et_garde_le_message() {
    use axum::extract::State;
    async fn lent(State(()): State<()>) -> String {
        tokio::time::sleep(Duration::from_secs(20)).await;
        String::new()
    }
    let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    ecoute.set_nonblocking(true).unwrap();
    let adresse = format!("http://{}", ecoute.local_addr().unwrap());
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(async move {
                let app = axum::Router::new().fallback(lent).with_state(());
                let ecoute = tokio::net::TcpListener::from_std(ecoute).unwrap();
                axum::serve(ecoute, app).await.unwrap();
            });
    });
    let racine = preparer("arret3");
    let s = demarrer(&racine, "p");
    configurer(&s, &adresse, true);
    creer_relecteur(&s);
    let suivant = fichier_op(
        "b",
        "Fichier 1",
        2.0,
        json!({ "operation": "ecrire", "chemin": "avis.txt", "contenu": "x" }),
    );
    publier_sur_notes(
        &s,
        "Revue des notes",
        vec![agent_noeud(), suivant],
        json!([{ "de": "t", "vers": "a" }, { "de": "a", "vers": "b" }]),
    );
    let l = s.appel("GET", "/api/workflows", &Value::Null).json();
    let f = l["workflows"][0]["fichier"].as_str().unwrap().to_string();
    ecrire_projet(&s, "notes/a.md", "1");
    assert!(attendre(|| en_cours_liste(&s, &f) == json!("a")));
    assert!(attendre(|| conversations(&s).len() == 1));
    let id = conversations(&s)[0]["id"].as_str().unwrap().to_string();
    let lire = |s: &Serveur| {
        s.appel(
            "GET",
            &format!("/api/agent/conversations/{id}"),
            &Value::Null,
        )
        .json()
    };
    assert_eq!(lire(&s)["enCours"], true);
    assert_eq!(arreter(&s, &f).code, 200);
    assert!(attendre(|| en_cours_liste(&s, &f) == Value::Null));
    let m = "Workflow « Revue des notes » arrêté pendant « Agent 1 ».";
    assert!(attendre(|| lignes_du_journal(&s, m) == 1));
    let l = conversations(&s);
    assert_eq!(l.len(), 1);
    let v = lire(&s);
    assert_eq!(v["enCours"], false);
    assert!(v["entrees"][0]["texte"]
        .as_str()
        .unwrap()
        .starts_with("Relis : "));
    std::thread::sleep(Duration::from_secs(1));
    assert!(lire_projet(&s, "avis.txt").is_empty());
    assert_eq!(
        lignes_du_journal(&s, "Workflow « Revue des notes » terminé."),
        0
    );
}
