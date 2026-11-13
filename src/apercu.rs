//! Aperçu HTML (DEC-069) : fichiers du projet servis en lecture seule sous un jeton.
use crate::fichiers::{self, Erreur};
use ring::rand::{SecureRandom, SystemRandom};
use std::path::Path;

/// Script ajouté aux pages HTML : signale le défilement au parent et le reprend sur demande.
const SCRIPT: &str = r#"<script>(function(){if(window.parent===window)return;addEventListener("copy",function(e){var t=getSelection().toString();if(e.defaultPrevented||!t||!e.clipboardData)return;e.clipboardData.setData("text/plain",t);e.preventDefault()});var a=false;addEventListener("scroll",function(){if(a)return;a=true;requestAnimationFrame(function(){a=false;parent.postMessage({yaide:"defilement",x:scrollX,y:scrollY},"*")})});addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.yaide!=="defiler")return;var f=function(){scrollTo({left:d.x,top:d.y,behavior:"instant"})};f();if(!window.ResizeObserver)return;var o=new ResizeObserver(f);o.observe(document.documentElement);var s=function(){o.disconnect()};setTimeout(s,3000);["wheel","keydown","touchstart","mousedown"].forEach(function(n){addEventListener(n,s,{once:true})})})})()</script>"#;

/// 32 octets au hasard, en hexadécimal.
pub fn nouveau_jeton() -> String {
    let mut o = [0u8; 32];
    SystemRandom::new()
        .fill(&mut o)
        .expect("source d'aléa indisponible");
    o.iter().map(|b| format!("{b:02x}")).collect()
}

/// Comparaison en temps constant.
pub fn jeton_ok(attendu: &str, recu: &str) -> bool {
    let (a, r) = (attendu.as_bytes(), recu.as_bytes());
    a.len() == r.len() && a.iter().zip(r).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

fn type_de(chemin: &Path) -> &'static str {
    let ext = chemin
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

/// Insère le script après un éventuel `<!DOCTYPE …>` en tête.
fn inserer_script(page: &[u8]) -> Vec<u8> {
    let debut = page
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(page.len());
    let reste = &page[debut..];
    let fin = if reste.len() >= 9 && reste[..9].eq_ignore_ascii_case(b"<!doctype") {
        reste
            .iter()
            .position(|&b| b == b'>')
            .map_or(0, |i| debut + i + 1)
    } else {
        0
    };
    let mut r = Vec::with_capacity(page.len() + SCRIPT.len());
    r.extend_from_slice(&page[..fin]);
    r.extend_from_slice(SCRIPT.as_bytes());
    r.extend_from_slice(&page[fin..]);
    r
}

/// Octets et type du fichier `rel` du projet (worktrees compris) ; un dossier sert son `index.html`.
pub fn charger(racine: &Path, rel: &str) -> Result<(Vec<u8>, &'static str), Erreur> {
    let rel = rel.trim_end_matches('/');
    let (racine, rel) = fichiers::aiguiller(racine, rel, &mut None)?;
    let mut chemin = fichiers::resoudre(&racine, &rel)?;
    if std::fs::metadata(&chemin)?.is_dir() {
        let index = if rel.is_empty() {
            "index.html".to_string()
        } else {
            format!("{rel}/index.html")
        };
        chemin = fichiers::resoudre(&racine, &index)?;
    }
    let octets = std::fs::read(&chemin)?;
    let genre = type_de(&chemin);
    if genre.starts_with("text/html") {
        Ok((inserer_script(&octets), genre))
    } else {
        Ok((octets, genre))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texte(page: &str) -> String {
        String::from_utf8(inserer_script(page.as_bytes())).unwrap()
    }

    #[test]
    fn req058_ac9_script_sans_doctype() {
        assert_eq!(texte("<h1>T</h1>"), format!("{SCRIPT}<h1>T</h1>"));
    }

    #[test]
    fn req058_ac9_script_apres_doctype() {
        assert_eq!(
            texte("<!DOCTYPE html><p>a"),
            format!("<!DOCTYPE html>{SCRIPT}<p>a")
        );
    }

    #[test]
    fn req058_ac9_script_apres_doctype_minuscules_et_espaces() {
        assert_eq!(
            texte("  \n<!doctype html>\n<p>a"),
            format!("  \n<!doctype html>{SCRIPT}\n<p>a")
        );
    }

    #[test]
    fn req058_ac9_fichier_vide() {
        assert_eq!(texte(""), SCRIPT);
    }

    #[test]
    fn req058_ac17_types_et_jetons() {
        assert_eq!(
            type_de(Path::new("a.MJS")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(type_de(Path::new("a.woff2")), "font/woff2");
        assert_eq!(type_de(Path::new("a.xyz")), "application/octet-stream");
        let (a, b) = (nouveau_jeton(), nouveau_jeton());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(jeton_ok(&a, &a) && !jeton_ok(&a, &b) && !jeton_ok(&a, ""));
    }
}
