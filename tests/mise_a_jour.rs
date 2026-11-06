use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

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
