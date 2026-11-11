//! Les sept outils de l'agent (REQ-057). Une erreur d'outil n'est pas une erreur Rust :
//! elle part au modèle comme résultat (`echec`), en une phrase courte en anglais.

use super::provider::DefOutil;
use super::web;
use crate::{fichiers, recherche};
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const SORTIE_MAX: usize = 30_000;
const CHEMINS_MAX: usize = 500;

#[derive(Debug, PartialEq)]
pub struct Resultat {
    pub contenu: String,
    pub echec: bool,
}

/// Délais et adresse de la recherche web, réduits par les tests.
#[derive(Clone)]
pub struct Limites {
    pub bash: Duration,
    pub web: Duration,
    /// `initialize` d'un serveur MCP, et appel d'un outil MCP.
    pub mcp_init: Duration,
    pub mcp_appel: Duration,
    pub recherche: String,
}

impl Default for Limites {
    fn default() -> Self {
        Limites {
            bash: Duration::from_secs(120),
            web: Duration::from_secs(30),
            mcp_init: Duration::from_secs(30),
            mcp_appel: Duration::from_secs(120),
            recherche: "https://html.duckduckgo.com/html/".into(),
        }
    }
}

pub struct Contexte {
    pub projet: PathBuf,
    pub client: reqwest::Client,
    pub limites: Limites,
}

fn ok(contenu: String) -> Resultat {
    Resultat {
        contenu,
        echec: false,
    }
}

fn echec(contenu: impl Into<String>) -> Resultat {
    Resultat {
        contenu: contenu.into(),
        echec: true,
    }
}

fn def(nom: &str, description: &str, proprietes: Value, requis: &[&str]) -> DefOutil {
    DefOutil {
        nom: nom.into(),
        description: description.into(),
        schema: json!({"type": "object", "properties": proprietes, "required": requis}),
    }
}

pub fn definitions() -> Vec<DefOutil> {
    let texte = |d: &str| json!({"type": "string", "description": d});
    let entier = |d: &str| json!({"type": "integer", "description": d});
    vec![
        def(
            "read",
            "Read a text file of the project. Optionally from a line (1-based) and for a number of lines.",
            json!({"path": texte("File path, relative to the project"), "offset": entier("First line to read, starting at 1"), "limit": entier("Maximum number of lines")}),
            &["path"],
        ),
        def(
            "write",
            "Create or replace a file of the project, with its parent folders.",
            json!({"path": texte("File path, relative to the project"), "content": texte("Whole new content")}),
            &["path", "content"],
        ),
        def(
            "edit",
            "Replace a passage that appears exactly once in a file.",
            json!({"path": texte("File path, relative to the project"), "old": texte("Passage to replace, unique in the file"), "new": texte("Replacement")}),
            &["path", "old", "new"],
        ),
        def(
            "bash",
            "Run a shell command with /bin/sh -c in the project. Returns the output and the exit code.",
            json!({"command": texte("The command")}),
            &["command"],
        ),
        def(
            "glob",
            "List project files matching a glob pattern such as src/**/*.rs. Git-ignored files are left out.",
            json!({"pattern": texte("Glob pattern")}),
            &["pattern"],
        ),
        def(
            "websearch",
            "Search the web. Returns up to 10 results with title, URL and excerpt.",
            json!({"query": texte("Search query")}),
            &["query"],
        ),
        def(
            "webfetch",
            "Fetch an http(s) page and return its text without HTML tags.",
            json!({"url": texte("Page address")}),
            &["url"],
        ),
    ]
}

/// L'argument qui résume un appel, pour l'affichage : chemin, commande, motif, requête ou adresse.
pub fn argument_principal(nom: &str, arguments: &Value) -> String {
    if nom.starts_with("mcp__") {
        // Les arguments en JSON compact, rien pour `{}`.
        return match arguments {
            Value::Null => String::new(),
            Value::Object(o) if o.is_empty() => String::new(),
            v => v.to_string(),
        };
    }
    let cle = match nom {
        "read" | "write" | "edit" => "path",
        "bash" => "command",
        "glob" => "pattern",
        "websearch" => "query",
        "webfetch" => "url",
        _ => return String::new(),
    };
    arguments[cle].as_str().unwrap_or("").to_string()
}

fn requis<'a>(arguments: &'a Value, cle: &str) -> Result<&'a str, String> {
    arguments[cle]
        .as_str()
        .ok_or_else(|| format!("Missing or invalid argument: {cle}."))
}

fn entier(arguments: &Value, cle: &str) -> Result<Option<usize>, String> {
    match &arguments[cle] {
        Value::Null => Ok(None),
        v => v
            .as_u64()
            .map(|n| Some(n as usize))
            .ok_or_else(|| format!("Invalid argument: {cle}.")),
    }
}

pub async fn executer(nom: &str, arguments: &Value, ctx: &Contexte) -> Resultat {
    match lancer(nom, arguments, ctx).await {
        Ok(r) => r,
        Err(m) => echec(m),
    }
}

async fn lancer(nom: &str, a: &Value, ctx: &Contexte) -> Result<Resultat, String> {
    let projet = ctx.projet.as_path();
    match nom {
        "read" => lire(
            projet,
            requis(a, "path")?,
            entier(a, "offset")?,
            entier(a, "limit")?,
        )
        .map(ok),
        "write" => {
            let (chemin, contenu) = (requis(a, "path")?, requis(a, "content")?);
            if fichiers::resoudre(projet, chemin).map_err(phrase)?.is_dir() {
                return Err("The path is a directory.".into());
            }
            fichiers::ecrire(projet, chemin, None, contenu.as_bytes()).map_err(phrase)?;
            Ok(ok(format!("Wrote {} bytes to {chemin}.", contenu.len())))
        }
        "edit" => remplacer(
            projet,
            requis(a, "path")?,
            requis(a, "old")?,
            requis(a, "new")?,
        )
        .map(ok),
        "bash" => Ok(bash(projet, requis(a, "command")?, ctx.limites.bash).await),
        "glob" => glob(projet, requis(a, "pattern")?).await.map(ok),
        "websearch" => web::chercher(
            &ctx.client,
            &ctx.limites.recherche,
            requis(a, "query")?,
            ctx.limites.web,
        )
        .await
        .map(ok),
        "webfetch" => web::recuperer(&ctx.client, requis(a, "url")?, ctx.limites.web)
            .await
            .map(ok),
        _ => Err(format!("Unknown tool: {nom}.")),
    }
}

fn phrase(e: fichiers::Erreur) -> String {
    use fichiers::Erreur::*;
    match e {
        Interdit => "The path is outside the project.".into(),
        Introuvable => "File not found.".into(),
        Binaire => "The file is binary.".into(),
        NonUtf8 => "The file is not valid UTF-8 text.".into(),
        TropGros => "The file is larger than 5 MB.".into(),
        Droits => "Permission denied.".into(),
        Existe | Conflit(_) => "The file changed meanwhile.".into(),
        Invalide(_) => "Invalid path, or a directory.".into(),
        Autre(m) => m,
    }
}

fn lire(
    projet: &Path,
    chemin: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String, String> {
    let (texte, _) = fichiers::lire(projet, chemin).map_err(phrase)?;
    if offset.is_none() && limit.is_none() {
        return Ok(texte);
    }
    let debut = offset.unwrap_or(1).max(1) - 1;
    let lignes = texte.split_inclusive('\n').skip(debut);
    Ok(match limit {
        Some(n) => lignes.take(n).collect(),
        None => lignes.collect(),
    })
}

fn remplacer(projet: &Path, chemin: &str, ancien: &str, nouveau: &str) -> Result<String, String> {
    let (texte, _) = fichiers::lire(projet, chemin).map_err(phrase)?;
    if ancien.is_empty() {
        return Err("The passage to replace is empty.".into());
    }
    match texte.matches(ancien).count() {
        0 => Err("The passage was not found in the file.".into()),
        1 => {
            let neuf = texte.replacen(ancien, nouveau, 1);
            fichiers::ecrire(projet, chemin, None, neuf.as_bytes()).map_err(phrase)?;
            Ok(format!("Edited {chemin}."))
        }
        n => Err(format!(
            "The passage appears {n} times in the file; give a longer, unique passage."
        )),
    }
}

async fn glob(projet: &Path, motif: &str) -> Result<String, String> {
    let m = globset::GlobBuilder::new(motif)
        .literal_separator(true)
        .build()
        .map_err(|_| "Invalid glob pattern.".to_string())?
        .compile_matcher();
    let racine = projet.to_path_buf();
    let tous = tokio::task::spawn_blocking(move || recherche::lister(&racine))
        .await
        .map_err(|e| e.to_string())?;
    let mut trouves: Vec<String> = tous.into_iter().filter(|c| m.is_match(c)).collect();
    if trouves.is_empty() {
        return Ok("No matching files.".into());
    }
    let trop = trouves.len() > CHEMINS_MAX;
    trouves.truncate(CHEMINS_MAX);
    let mut sortie = trouves.join("\n");
    if trop {
        sortie.push_str(&format!("\n[{CHEMINS_MAX} first matches]"));
    }
    Ok(sortie)
}

/// Tue tout le groupe de processus de la commande, à l'abandon comme à la fin.
struct Garde(i32);

impl Drop for Garde {
    fn drop(&mut self) {
        // SAFETY: un appel système sans pointeur ; `-pgid` vise le groupe créé pour la commande.
        unsafe {
            libc::kill(-self.0, libc::SIGKILL);
        }
    }
}

async fn bash(projet: &Path, commande: &str, limite: Duration) -> Resultat {
    let (mut lecteur, ecrivain) = match std::io::pipe() {
        Ok(p) => p,
        Err(e) => return echec(format!("Could not start the command: {e}")),
    };
    let ecrivain2 = match ecrivain.try_clone() {
        Ok(w) => w,
        Err(e) => return echec(format!("Could not start the command: {e}")),
    };
    let mut cmd = tokio::process::Command::new("/bin/sh");
    cmd.arg("-c")
        .arg(commande)
        .current_dir(projet)
        .stdin(Stdio::null())
        .stdout(Stdio::from(ecrivain))
        .stderr(Stdio::from(ecrivain2))
        .process_group(0)
        .kill_on_drop(true);
    let mut enfant = match cmd.spawn() {
        Ok(e) => e,
        Err(e) => return echec(format!("Could not start the command: {e}")),
    };
    // Les extrémités d'écriture ne doivent survivre que dans la commande.
    drop(cmd);
    let _garde = Garde(enfant.id().unwrap_or(0) as i32);

    // Lecture en continu : une sortie plus grande que le tube bloquerait la commande.
    let recu = Arc::new(Mutex::new((Vec::<u8>::new(), false)));
    let r = recu.clone();
    let lecture = std::thread::spawn(move || {
        let mut tampon = [0u8; 8192];
        while let Ok(n) = lecteur.read(&mut tampon) {
            if n == 0 {
                break;
            }
            let mut g = r.lock().unwrap();
            g.0.extend_from_slice(&tampon[..n]);
            if g.0.len() > 4 * SORTIE_MAX {
                let trop = g.0.len() - 2 * SORTIE_MAX;
                g.0.drain(..trop);
                g.1 = true;
            }
        }
    });

    let fin = tokio::time::timeout(limite, enfant.wait()).await;
    drop(_garde);
    // Le groupe est tué : la fin du tube suit. Un enfant sorti du groupe ne doit pas nous bloquer.
    for _ in 0..40 {
        if lecture.is_finished() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let (octets, coupe) = recu.lock().unwrap().clone();
    let texte = String::from_utf8_lossy(&octets);
    let total = texte.chars().count();
    let mut sortie = if coupe || total > SORTIE_MAX {
        let debut = texte
            .char_indices()
            .nth(total.saturating_sub(SORTIE_MAX))
            .map_or(0, |(i, _)| i);
        format!(
            "[output truncated: last {SORTIE_MAX} characters]\n{}",
            &texte[debut..]
        )
    } else {
        texte.into_owned()
    };
    if !sortie.is_empty() && !sortie.ends_with('\n') {
        sortie.push('\n');
    }
    match fin {
        Err(_) => {
            sortie.push_str(&format!("Command killed after {} s.", limite.as_secs()));
            echec(sortie)
        }
        Ok(Err(e)) => echec(format!("{sortie}Could not wait for the command: {e}")),
        Ok(Ok(statut)) => {
            let code = statut.code().unwrap_or(-1);
            sortie.push_str(&format!("Exit code: {code}"));
            Resultat {
                contenu: sortie,
                echec: code != 0,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use std::fs;

    fn dossier(nom: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("outils-{nom}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    fn ctx(projet: &Path) -> Contexte {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Contexte {
            projet: projet.to_path_buf(),
            client: reqwest::Client::new(),
            limites: Limites::default(),
        }
    }

    async fn lancer_outil(c: &Contexte, nom: &str, a: Value) -> Resultat {
        executer(nom, &a, c).await
    }

    fn vivant(pid: i32) -> bool {
        fs::read_to_string(format!("/proc/{pid}/stat"))
            .is_ok_and(|s| s.rsplit(") ").next().is_some_and(|r| !r.starts_with('Z')))
    }

    #[test]
    fn definitions_et_argument_principal() {
        let noms: Vec<String> = definitions().into_iter().map(|d| d.nom).collect();
        assert_eq!(
            noms,
            [
                "read",
                "write",
                "edit",
                "bash",
                "glob",
                "websearch",
                "webfetch"
            ]
        );
        assert_eq!(argument_principal("bash", &json!({"command": "ls"})), "ls");
        assert_eq!(argument_principal("read", &json!({"path": "a.rs"})), "a.rs");
        assert_eq!(
            argument_principal("glob", &json!({"pattern": "*.rs"})),
            "*.rs"
        );
        assert_eq!(argument_principal("websearch", &json!({"query": "q"})), "q");
        assert_eq!(
            argument_principal("webfetch", &json!({"url": "http://x"})),
            "http://x"
        );
        assert_eq!(argument_principal("inconnu", &json!({})), "");
    }

    #[tokio::test]
    async fn outil_inconnu_ou_argument_manquant() {
        let d = dossier("inconnu");
        let c = ctx(&d);
        let r = lancer_outil(&c, "rm", json!({})).await;
        assert_eq!((r.echec, r.contenu.as_str()), (true, "Unknown tool: rm."));
        let r = lancer_outil(&c, "read", json!({})).await;
        assert!(r.echec && r.contenu.contains("path"), "{r:?}");
    }

    #[tokio::test]
    async fn REQ057_AC1_read_entier_et_tranche() {
        let d = dossier("read");
        fs::write(d.join("a.txt"), "un\ndeux\ntrois\nquatre\n").unwrap();
        let c = ctx(&d);
        let r = lancer_outil(&c, "read", json!({"path": "a.txt"})).await;
        assert_eq!(r, ok("un\ndeux\ntrois\nquatre\n".into()));
        let r = lancer_outil(
            &c,
            "read",
            json!({"path": "a.txt", "offset": 2, "limit": 2}),
        )
        .await;
        assert_eq!(r, ok("deux\ntrois\n".into()));
        let r = lancer_outil(&c, "read", json!({"path": "a.txt", "offset": 3})).await;
        assert_eq!(r, ok("trois\nquatre\n".into()));
        let r = lancer_outil(&c, "read", json!({"path": "a.txt", "limit": 1})).await;
        assert_eq!(r, ok("un\n".into()));
    }

    #[tokio::test]
    async fn REQ057_AC1_read_refus_binaire_gros_absent_hors_projet_lien() {
        let d = dossier("refus");
        fs::write(d.join("bin"), [1u8, 0, 2]).unwrap();
        fs::write(d.join("gros"), vec![b'a'; 5 * 1024 * 1024 + 1]).unwrap();
        fs::write(d.parent().unwrap().join("dehors-refus.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(d.parent().unwrap().join("dehors-refus.txt"), d.join("lien"))
            .unwrap();
        let c = ctx(&d);
        for (chemin, phrase) in [
            ("bin", "The file is binary."),
            ("gros", "The file is larger than 5 MB."),
            ("absent", "File not found."),
            ("../dehors-refus.txt", "The path is outside the project."),
            ("lien", "The path is outside the project."),
            ("/etc/passwd", "The path is outside the project."),
        ] {
            let r = lancer_outil(&c, "read", json!({"path": chemin})).await;
            assert_eq!(r, echec(phrase), "{chemin}");
        }
    }

    #[tokio::test]
    async fn REQ057_AC2_write_cree_les_parents_et_refuse_hors_projet() {
        let d = dossier("write");
        let c = ctx(&d);
        let r = lancer_outil(
            &c,
            "write",
            json!({"path": "a/b/c.txt", "content": "salut"}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        assert_eq!(fs::read_to_string(d.join("a/b/c.txt")).unwrap(), "salut");
        let r = lancer_outil(&c, "write", json!({"path": "a/b/c.txt", "content": "neuf"})).await;
        assert!(!r.echec);
        assert_eq!(fs::read_to_string(d.join("a/b/c.txt")).unwrap(), "neuf");
        let r = lancer_outil(
            &c,
            "write",
            json!({"path": "../hors-write.txt", "content": "x"}),
        )
        .await;
        assert_eq!(r, echec("The path is outside the project."));
        assert!(!d.parent().unwrap().join("hors-write.txt").exists());
        let r = lancer_outil(&c, "write", json!({"path": "a", "content": "x"})).await;
        assert_eq!(r, echec("The path is a directory."));
    }

    #[tokio::test]
    async fn REQ057_AC3_edit_unique_absent_multiple() {
        let d = dossier("edit");
        fs::write(d.join("f.txt"), "alpha beta alpha gamma").unwrap();
        let c = ctx(&d);
        let r = lancer_outil(
            &c,
            "edit",
            json!({"path": "f.txt", "old": "beta", "new": "BETA"}),
        )
        .await;
        assert!(!r.echec, "{r:?}");
        assert_eq!(
            fs::read_to_string(d.join("f.txt")).unwrap(),
            "alpha BETA alpha gamma"
        );
        let r = lancer_outil(
            &c,
            "edit",
            json!({"path": "f.txt", "old": "zzz", "new": "x"}),
        )
        .await;
        assert_eq!(r, echec("The passage was not found in the file."));
        let r = lancer_outil(
            &c,
            "edit",
            json!({"path": "f.txt", "old": "alpha", "new": "x"}),
        )
        .await;
        assert!(r.echec && r.contenu.contains("2 times"), "{r:?}");
        assert_eq!(
            fs::read_to_string(d.join("f.txt")).unwrap(),
            "alpha BETA alpha gamma"
        );
    }

    #[tokio::test]
    async fn REQ057_AC4_bash_sortie_ordonnee_et_code() {
        let d = dossier("bash");
        fs::write(d.join("marque"), "").unwrap();
        let c = ctx(&d);
        let r = lancer_outil(
            &c,
            "bash",
            json!({"command": "echo un; echo deux >&2; echo trois; ls"}),
        )
        .await;
        assert!(
            r.contenu.eq("un\ndeux\ntrois\nmarque\nExit code: 0"),
            "{r:?}"
        );
        let r = lancer_outil(&c, "bash", json!({"command": "echo ok"})).await;
        assert_eq!(r, ok("ok\nExit code: 0".into()));
        let r = lancer_outil(&c, "bash", json!({"command": "echo mal >&2; exit 3"})).await;
        assert_eq!(r, echec("mal\nExit code: 3"));
        let r = lancer_outil(&c, "bash", json!({"command": "pwd"})).await;
        assert_eq!(r, ok(format!("{}\nExit code: 0", d.display())));
    }

    #[tokio::test]
    async fn REQ057_AC4_bash_tue_apres_la_limite_avec_ses_enfants() {
        let d = dossier("limite");
        let mut c = ctx(&d);
        c.limites.bash = Duration::from_secs(1);
        let r = lancer_outil(
            &c,
            "bash",
            json!({"command": "echo debut; sleep 30 & echo $! > enfant; echo $$ > shell; sleep 30"}),
        )
        .await;
        assert_eq!(r, echec("debut\nCommand killed after 1 s."));
        for f in ["enfant", "shell"] {
            let pid: i32 = fs::read_to_string(d.join(f))
                .unwrap()
                .trim()
                .parse()
                .unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(!vivant(pid), "{f} ({pid}) vit encore");
        }
    }

    #[tokio::test]
    async fn REQ057_AC4_bash_abandon_tue_le_groupe() {
        let d = dossier("abandon");
        let c = ctx(&d);
        let projet = d.clone();
        let tache = tokio::spawn(async move {
            executer(
                "bash",
                &json!({"command": "sleep 30 & echo $! > enfant; sleep 30"}),
                &c,
            )
            .await
        });
        let mut pid = None;
        for _ in 0..100 {
            if let Ok(s) = fs::read_to_string(projet.join("enfant")) {
                if let Ok(p) = s.trim().parse::<i32>() {
                    pid = Some(p);
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let pid = pid.expect("la commande n'a pas démarré");
        assert!(vivant(pid));
        tache.abort();
        let _ = tache.await;
        for _ in 0..40 {
            if !vivant(pid) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("l'enfant {pid} vit encore après l'abandon");
    }

    #[tokio::test]
    async fn REQ057_AC4_sortie_coupee_garde_la_fin() {
        let d = dossier("coupe");
        let c = ctx(&d);
        let r = lancer_outil(&c, "bash", json!({"command": "seq 1 20000"})).await;
        assert!(!r.echec);
        let corps = r.contenu.strip_suffix("\nExit code: 0").unwrap();
        let (tete, reste) = corps.split_once('\n').unwrap();
        assert_eq!(tete, "[output truncated: last 30000 characters]");
        // 30 000 caractères de sortie, dont le saut de ligne final retiré avec « Exit code ».
        assert_eq!(reste.chars().count(), 29_999);
        assert!(
            reste.ends_with("\n19999\n20000"),
            "{:?}",
            &reste[reste.len() - 20..]
        );
        let r = lancer_outil(&c, "bash", json!({"command": "seq 1 100"})).await;
        assert!(!r.contenu.contains("truncated"));
    }

    #[tokio::test]
    async fn REQ057_AC5_glob_motif_sans_ignores_et_limite() {
        let d = dossier("glob");
        let git = |args: &[&str]| {
            assert!(std::process::Command::new("git")
                .args(args)
                .current_dir(&d)
                .output()
                .unwrap()
                .status
                .success())
        };
        git(&["init", "-q"]);
        fs::create_dir_all(d.join("src/sous")).unwrap();
        fs::create_dir_all(d.join("cible")).unwrap();
        for f in [
            "src/a.rs",
            "src/sous/b.rs",
            "src/c.txt",
            "cible/x.rs",
            "racine.rs",
        ] {
            fs::write(d.join(f), "").unwrap();
        }
        fs::write(d.join(".gitignore"), "cible/\n").unwrap();
        let c = ctx(&d);
        let r = lancer_outil(&c, "glob", json!({"pattern": "src/**/*.rs"})).await;
        assert_eq!(r, ok("src/a.rs\nsrc/sous/b.rs".into()));
        let r = lancer_outil(&c, "glob", json!({"pattern": "**/*.rs"})).await;
        assert_eq!(r, ok("racine.rs\nsrc/a.rs\nsrc/sous/b.rs".into()));
        let r = lancer_outil(&c, "glob", json!({"pattern": "*.zzz"})).await;
        assert_eq!(r, ok("No matching files.".into()));
        let r = lancer_outil(&c, "glob", json!({"pattern": "[a"})).await;
        assert_eq!(r, echec("Invalid glob pattern."));
        fs::create_dir_all(d.join("beaucoup")).unwrap();
        for i in 0..501 {
            fs::write(d.join(format!("beaucoup/f{i:03}.dat")), "").unwrap();
        }
        let r = lancer_outil(&c, "glob", json!({"pattern": "beaucoup/*.dat"})).await;
        let lignes: Vec<&str> = r.contenu.lines().collect();
        assert_eq!(lignes.len(), 501);
        assert_eq!(lignes[500], "[500 first matches]");
        assert_eq!(lignes[499], "beaucoup/f499.dat");
    }

    #[tokio::test]
    async fn outils_web_par_executer() {
        let d = dossier("web");
        let mut c = ctx(&d);
        c.limites.recherche = "http://127.0.0.1:1/html/".into();
        let r = lancer_outil(&c, "webfetch", json!({"url": "ftp://x"})).await;
        assert!(r.echec);
        let r = lancer_outil(&c, "websearch", json!({"query": "x"})).await;
        assert!(r.echec && r.contenu.starts_with("Request failed"), "{r:?}");
    }
}
