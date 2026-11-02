use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

struct Serveur {
    child: Child,
    port: u16,
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

fn dossier_vide(nom: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("socle-{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn get(port: u16, chemin: &str) -> Option<String> {
    let out = Command::new("curl")
        .args([
            "-sk",
            "--max-time",
            "3",
            &format!("https://127.0.0.1:{port}{chemin}"),
        ])
        .output()
        .unwrap();
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        None
    }
}

fn lancer(exe: &PathBuf, cwd: &PathBuf) -> Serveur {
    let port = port_libre();
    let cfg = cwd.join("cfg");
    let mut passwd = Command::new(exe)
        .arg("passwd")
        .env("XDG_CONFIG_HOME", &cfg)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    std::io::Write::write_all(&mut passwd.stdin.take().unwrap(), b"mdp\n").unwrap();
    assert!(passwd.wait().unwrap().success());
    let child = Command::new(exe)
        .arg(cwd)
        .args(["--port", &port.to_string()])
        .env("XDG_CONFIG_HOME", &cfg)
        .current_dir(cwd)
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let s = Serveur { child, port };
    for _ in 0..100 {
        if get(port, "/").is_some() {
            return s;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("le serveur ne répond pas");
}

fn binaire_seul(nom: &str) -> (PathBuf, PathBuf) {
    let d = dossier_vide(nom);
    let exe = d.join("yaide");
    std::fs::copy(env!("CARGO_BIN_EXE_yaide"), &exe).unwrap();
    (exe, d)
}

#[test]
fn req029_ac1_le_binaire_seul_sert_toute_l_interface() {
    let (exe, d) = binaire_seul("ac1");
    let s = lancer(&exe, &d);
    let index = get(s.port, "/").unwrap();
    assert!(index.contains("<title>Yaide</title>"));
    let js = get(s.port, "/main.js").unwrap();
    assert!(js.contains("Yaide"));
}

#[test]
fn req029_ac1_la_feuille_main_css_de_xterm_est_servie_dans_le_binaire() {
    let (exe, d) = binaire_seul("css");
    let s = lancer(&exe, &d);
    let index = get(s.port, "/").unwrap();
    assert!(index.contains("href=\"/main.css\""));
    let css = get(s.port, "/main.css").unwrap();
    assert!(css.contains(".xterm"));
}

#[test]
fn req029_ac2_memoire_au_repos_sous_50_mo() {
    let (exe, d) = binaire_seul("ac2");
    let s = lancer(&exe, &d);
    let status = std::fs::read_to_string(format!("/proc/{}/status", s.child.id())).unwrap();
    let ko: u64 = status
        .lines()
        .find(|l| l.starts_with("VmRSS:"))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|v| v.parse().ok())
        .unwrap();
    assert!(ko < 50 * 1024, "VmRSS = {ko} Ko");
}

#[test]
fn req029_ac3_la_page_ne_reference_aucune_autre_origine() {
    let (exe, d) = binaire_seul("ac3");
    let s = lancer(&exe, &d);
    let index = get(s.port, "/").unwrap();
    assert!(!index.contains("http://") && !index.contains("https://") && !index.contains("//cdn"));
}

#[test]
fn req029_port_invalide_est_refuse_avec_un_message() {
    let out = Command::new(env!("CARGO_BIN_EXE_yaide"))
        .args(["--port", "abc"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("--port"));
}
