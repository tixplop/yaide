use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

struct Env {
    racine: PathBuf,
    bin: PathBuf,
    releases: PathBuf,
}

fn tmp() -> PathBuf {
    PathBuf::from(std::env::var("TMPDIR").unwrap_or("/tmp".into()))
}

fn run(cmd: &mut Command) {
    assert!(cmd.status().unwrap().success());
}

impl Env {
    fn new(nom: &str) -> Env {
        let racine = tmp().join(format!("maj-{nom}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&racine);
        let bin = racine.join("bin");
        let faux = racine.join("faux");
        let releases = racine.join("releases");
        for d in [&bin, &faux, &releases, &racine.join("home")] {
            fs::create_dir_all(d).unwrap();
        }
        fs::copy(env!("CARGO_BIN_EXE_yaide"), bin.join("yaide")).unwrap();
        let curl = faux.join("curl");
        fs::write(
            &curl,
            format!(
                r#"#!/bin/sh
echo "$*" >> "{r}/appels"
[ -f "{r}/lent" ] && sleep 1
out=""; fmt=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) fmt="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [ -n "$fmt" ]; then printf 'https://github.com/tixplop/yaide/releases/tag/v9.9.9'; exit 0; fi
f="{rel}/${{url##*/}}"
[ -f "$f" ] || exit 22
cp "$f" "$out"
"#,
                r = racine.display(),
                rel = releases.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&curl, fs::Permissions::from_mode(0o755)).unwrap();
        Env {
            racine,
            bin,
            releases,
        }
    }

    fn preparer_release(&self, sha_ok: bool) {
        let nom = "yaide-v9.9.9-x86_64-linux";
        let src = self.racine.join("src").join(nom);
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("yaide"), "#!/bin/sh\necho nouveau\n").unwrap();
        let archive = self.releases.join(format!("{nom}.tar.gz"));
        run(Command::new("tar")
            .arg("-czf")
            .arg(&archive)
            .arg("-C")
            .arg(self.racine.join("src"))
            .arg(nom));
        let somme = if sha_ok {
            let o = Command::new("sha256sum").arg(&archive).output().unwrap();
            String::from_utf8(o.stdout)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap()
                .to_string()
        } else {
            "0".repeat(64)
        };
        fs::write(
            self.releases.join(format!("{nom}.tar.gz.sha256")),
            format!("{somme}  {nom}.tar.gz\n"),
        )
        .unwrap();
    }

    fn noter_version(&self, v: &str) {
        let d = self.racine.join("data/yaide");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("version"), format!("{v}\n")).unwrap();
    }

    fn lancer(&self, args: &[&str]) -> Output {
        let path = format!(
            "{}:{}",
            self.racine.join("faux").display(),
            std::env::var("PATH").unwrap()
        );
        Command::new(self.bin.join("yaide"))
            .args(args)
            .env("PATH", path)
            .env("HOME", self.racine.join("home"))
            .env("XDG_DATA_HOME", self.racine.join("data"))
            .env_remove("YAIDE_BIN_DIR")
            .env_remove("YAIDE_VERSION")
            .output()
            .unwrap()
    }

    fn binaire(&self) -> Vec<u8> {
        fs::read(self.bin.join("yaide")).unwrap()
    }

    fn appels(&self) -> bool {
        Path::new(&self.racine.join("appels")).exists()
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.racine);
    }
}

fn texte(o: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&o.stdout),
        String::from_utf8_lossy(&o.stderr)
    )
}

#[test]
fn req060_ac1_installe_sans_version_notee() {
    let e = Env::new("ac1a");
    e.preparer_release(true);
    let o = e.lancer(&["update"]);
    assert!(o.status.success(), "{}", texte(&o));
    assert!(texte(&o).contains("installé"), "{}", texte(&o));
    assert_eq!(e.binaire(), b"#!/bin/sh\necho nouveau\n");
}

#[test]
fn req060_ac1_mis_a_jour_depuis_ancienne_version() {
    let e = Env::new("ac1b");
    e.preparer_release(true);
    e.noter_version("v0.4.0");
    let o = e.lancer(&["update"]);
    assert!(o.status.success(), "{}", texte(&o));
    assert!(
        texte(&o).contains("mis à jour de v0.4.0 vers v9.9.9"),
        "{}",
        texte(&o)
    );
    assert_eq!(e.binaire(), b"#!/bin/sh\necho nouveau\n");
}

#[test]
fn req060_ac2_deja_installe() {
    let e = Env::new("ac2");
    e.preparer_release(true);
    e.noter_version("v9.9.9");
    let avant = e.binaire();
    let o = e.lancer(&["update"]);
    assert!(o.status.success(), "{}", texte(&o));
    assert!(texte(&o).contains("déjà installé"), "{}", texte(&o));
    assert_eq!(e.binaire(), avant);
}

#[test]
fn req060_ac3_empreinte_fausse_puis_archive_absente() {
    let e = Env::new("ac3");
    let avant = e.binaire();
    e.preparer_release(false);
    let o = e.lancer(&["update"]);
    assert!(!o.status.success());
    assert!(texte(&o).contains("empreinte"), "{}", texte(&o));
    assert_eq!(e.binaire(), avant);

    fs::remove_dir_all(&e.releases).unwrap();
    fs::create_dir_all(&e.releases).unwrap();
    let o = e.lancer(&["update"]);
    assert!(!o.status.success());
    assert!(
        texte(&o).contains("téléchargement impossible"),
        "{}",
        texte(&o)
    );
    assert_eq!(e.binaire(), avant);
}

#[test]
fn req060_ac4_argument_en_trop() {
    let e = Env::new("ac4");
    e.preparer_release(true);
    let avant = e.binaire();
    let o = e.lancer(&["update", "x"]);
    assert_eq!(o.status.code(), Some(2), "{}", texte(&o));
    assert!(texte(&o).contains("usage"));
    assert!(!e.appels());
    assert_eq!(e.binaire(), avant);
}

#[test]
fn req082_ac4_update_help_ne_telecharge_rien() {
    let e = Env::new("aide");
    e.preparer_release(true);
    let avant = e.binaire();
    for a in ["--help", "-h"] {
        let o = e.lancer(&["update", a]);
        assert_eq!(o.status.code(), Some(0), "{}", texte(&o));
        assert!(String::from_utf8_lossy(&o.stdout).starts_with("Usage : yaide update"));
        assert!(!e.appels());
        assert_eq!(e.binaire(), avant);
        assert!(!e.racine.join("home/.config/yaide").exists());
    }
}

// --- Mise à jour par le serveur (REQ-092, REQ-093) ---

struct Serveur {
    child: Child,
    port: u16,
    cookie: String,
}

impl Drop for Serveur {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Faux GitHub : répond 302 vers `…/tag/v9.9.9` et compte les demandes.
fn faux_github() -> (String, Arc<AtomicUsize>) {
    let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", ecoute.local_addr().unwrap());
    let n = Arc::new(AtomicUsize::new(0));
    let n2 = n.clone();
    std::thread::spawn(move || {
        for flux in ecoute.incoming() {
            let Ok(mut f) = flux else { continue };
            let mut tampon = [0u8; 2048];
            let _ = std::io::Read::read(&mut f, &mut tampon);
            n2.fetch_add(1, Ordering::SeqCst);
            let _ = std::io::Write::write_all(
                &mut f,
                b"HTTP/1.1 302 Found\r\nLocation: https://github.com/tixplop/yaide/releases/tag/v9.9.9\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
        }
    });
    (url, n)
}

fn http(port: u16, methode: &str, chemin: &str, cookie: &str, origine: bool) -> (u16, String) {
    let mut cmd = Command::new("curl");
    cmd.args([
        "-sk",
        "--max-time",
        "30",
        "-w",
        "\n%{http_code}",
        "-X",
        methode,
    ])
    .arg(format!("https://127.0.0.1:{port}{chemin}"));
    if !cookie.is_empty() {
        cmd.args(["-H", &format!("Cookie: {cookie}")]);
    }
    if origine {
        cmd.args(["-H", &format!("Origin: https://127.0.0.1:{port}")]);
    }
    let o = cmd.output().unwrap();
    let t = String::from_utf8_lossy(&o.stdout).into_owned();
    let (corps, code) = t.rsplit_once('\n').unwrap_or(("", "0"));
    (code.trim().parse().unwrap_or(0), corps.to_string())
}

impl Env {
    /// Lance le binaire comme serveur, connecté à `releases`.
    fn serveur(&self, releases: &str) -> Serveur {
        let cfg = self.racine.join("cfg");
        let env_commun = |c: &mut Command| {
            let path = format!(
                "{}:{}",
                self.racine.join("faux").display(),
                std::env::var("PATH").unwrap()
            );
            c.env("PATH", path)
                .env("HOME", self.racine.join("home"))
                .env("XDG_DATA_HOME", self.racine.join("data"))
                .env("XDG_CONFIG_HOME", &cfg)
                .env("YAIDE_URL_RELEASES", releases)
                .env_remove("YAIDE_BIN_DIR")
                .env_remove("YAIDE_VERSION");
        };
        let mut p = Command::new(self.bin.join("yaide"));
        p.arg("passwd").stdin(Stdio::piped()).stdout(Stdio::null());
        env_commun(&mut p);
        let mut p = p.spawn().unwrap();
        std::io::Write::write_all(&mut p.stdin.take().unwrap(), b"mdp\n").unwrap();
        assert!(p.wait().unwrap().success());
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let projet = self.racine.join("projet");
        fs::create_dir_all(&projet).unwrap();
        let mut c = Command::new(self.bin.join("yaide"));
        c.arg(&projet)
            .args(["--port", &port.to_string()])
            .stdout(Stdio::null());
        env_commun(&mut c);
        let mut s = Serveur {
            child: c.spawn().unwrap(),
            port,
            cookie: String::new(),
        };
        for _ in 0..1000 {
            if http(port, "GET", "/api/info", "", false).0 == 200 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let o = Command::new("curl")
            .args(["-sk", "-i", "-X", "POST", "--data-binary", "mdp"])
            .args(["-H", &format!("Origin: https://127.0.0.1:{port}")])
            .arg(format!("https://127.0.0.1:{port}/api/connexion"))
            .output()
            .unwrap();
        let t = String::from_utf8_lossy(&o.stdout).into_owned();
        let ligne = t
            .lines()
            .find(|l| l.to_lowercase().starts_with("set-cookie:"))
            .expect("pas de session");
        s.cookie = ligne[11..].trim().split(';').next().unwrap().to_string();
        s
    }
}

fn etat(s: &Serveur) -> serde_json::Value {
    let (code, corps) = http(s.port, "GET", "/api/version", &s.cookie, false);
    assert_eq!(code, 200, "{corps}");
    serde_json::from_str(&corps).unwrap()
}

fn attendre<F: Fn() -> bool>(f: F) {
    for _ in 0..500 {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("condition jamais remplie");
}

#[test]
fn req092_ac2_ac4_ac5_version_lue_au_lancement_sans_autre_demande() {
    let e = Env::new("v1");
    let (url, n) = faux_github();
    let s = e.serveur(&url);
    attendre(|| etat(&s)["derniere"] == "9.9.9");
    let v = etat(&s);
    assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(v["maj"], "aucune");
    assert!(v["installee"].is_null());
    // Lire l'état ne contacte pas GitHub : une seule demande, celle du lancement.
    for _ in 0..3 {
        etat(&s);
    }
    assert_eq!(n.load(Ordering::SeqCst), 1);
    // 401 sans session.
    assert_eq!(http(s.port, "GET", "/api/version", "", false).0, 401);
}

#[test]
fn req092_ac4_adresse_fermee_derniere_nulle_sans_erreur() {
    let e = Env::new("v2");
    let s = e.serveur("http://127.0.0.1:9/");
    std::thread::sleep(Duration::from_millis(300));
    let v = etat(&s);
    assert!(v["derniere"].is_null(), "{v}");
    assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
}

#[test]
fn req093_ac5_maj_refuse_401_et_403() {
    let e = Env::new("m1");
    e.preparer_release(true);
    let avant = e.binaire();
    let s = e.serveur("http://127.0.0.1:9/");
    assert_eq!(http(s.port, "POST", "/api/version/maj", "", true).0, 401);
    assert_eq!(
        http(s.port, "POST", "/api/version/maj", &s.cookie, false).0,
        403
    );
    assert_eq!(e.binaire(), avant);
    assert!(!e.appels());
}

#[test]
fn req093_ac1_ac2_installe_sans_arreter_le_serveur_ni_les_shells() {
    let e = Env::new("m2");
    e.preparer_release(true);
    let (url, _) = faux_github();
    let s = e.serveur(&url);
    let (code, corps) = http(s.port, "POST", "/api/shells", &s.cookie, true);
    assert_eq!(code, 201, "{corps}");
    let (code, corps) = http(s.port, "POST", "/api/version/maj", &s.cookie, true);
    assert_eq!(code, 200, "{corps}");
    assert_eq!(e.binaire(), b"#!/bin/sh\necho nouveau\n");
    // AC-093-2 : un GET suivant (autre onglet, rechargement) rend « installee ».
    let v = etat(&s);
    assert_eq!(v["maj"], "installee", "{v}");
    assert_eq!(v["installee"], "9.9.9");
    assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
    let (code, corps) = http(s.port, "GET", "/api/shells", &s.cookie, false);
    assert_eq!(code, 200);
    assert!(
        corps.contains("\"shells\":[1]") || corps.contains("\"shells\":[0]"),
        "{corps}"
    );
    assert!(s.child.id() > 0);
}

#[test]
fn req093_ac3_echec_raison_nette_binaire_inchange_nouvel_essai() {
    let e = Env::new("m3");
    e.preparer_release(false);
    let avant = e.binaire();
    let s = e.serveur("http://127.0.0.1:9/");
    let (code, corps) = http(s.port, "POST", "/api/version/maj", &s.cookie, true);
    assert_eq!(code, 500, "{corps}");
    assert!(corps.contains("empreinte"), "{corps}");
    assert!(!corps.contains("Erreur"), "{corps}");
    assert!(!corps.ends_with('.'), "{corps}");
    assert_eq!(e.binaire(), avant);
    assert_eq!(etat(&s)["maj"], "aucune");
    e.preparer_release(true);
    let (code, corps) = http(s.port, "POST", "/api/version/maj", &s.cookie, true);
    assert_eq!(code, 200, "{corps}");
    assert_eq!(etat(&s)["maj"], "installee");
}

#[test]
fn req093_ac4_deux_demandes_simultanees_une_seule_installation() {
    let e = Env::new("m4");
    e.preparer_release(true);
    fs::write(e.racine.join("lent"), "").unwrap();
    let s = e.serveur("http://127.0.0.1:9/");
    let (port, cookie) = (s.port, s.cookie.clone());
    let premier = std::thread::spawn({
        let c = cookie.clone();
        move || http(port, "POST", "/api/version/maj", &c, true)
    });
    attendre(|| e.appels());
    assert_eq!(etat(&s)["maj"], "encours");
    let second = http(port, "POST", "/api/version/maj", &cookie, true);
    let premier = premier.join().unwrap();
    assert_eq!(premier.0, 200, "{}", premier.1);
    assert_eq!(second.0, 200, "{}", second.1);
    let appels = fs::read_to_string(e.racine.join("appels")).unwrap();
    let archives = appels.lines().filter(|l| l.ends_with(".tar.gz")).count();
    assert_eq!(archives, 1, "{appels}");
}
