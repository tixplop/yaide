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
        json!([{ "nom": "Revue des notes", "fichier": "revue-des-notes", "publie": false }])
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
            { "nom": "Brouillon", "fichier": "brouillon", "publie": false },
            { "nom": "Publié", "fichier": "publie", "publie": true },
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
            { "de": "d", "vers": "a7" }
        ]),
    );
    assert_eq!(
        messages(&s, &f),
        [
            "« Agent 1 » : choisissez un agent.",
            "« Agent 2 » : donnez le message.",
            "« Session Claude 1 » : donnez la demande.",
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
