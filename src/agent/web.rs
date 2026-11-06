//! Outils `webfetch` et `websearch` (DEC-034) : pages web vues par le modèle, en texte.

use std::time::Duration;
use url::Url;

const OCTETS_MAX: usize = 5 * 1024 * 1024;
const CARACTERES_MAX: usize = 50_000;
const RESULTATS_MAX: usize = 10;
const NAVIGATEUR: &str = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

/// Balises dont le contenu n'est pas du texte de page.
const INVISIBLES: [&str; 3] = ["script", "style", "noscript"];
/// Balises qui coupent une ligne.
const BLOCS: [&str; 24] = [
    "br",
    "p",
    "div",
    "li",
    "ul",
    "ol",
    "tr",
    "table",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "section",
    "article",
    "header",
    "footer",
    "pre",
    "blockquote",
    "hr",
    "title",
    "dt",
    "dd",
];

fn erreur_reseau(e: &reqwest::Error, delai: Duration) -> String {
    if e.is_timeout() {
        format!("Timed out after {} s.", delai.as_secs())
    } else {
        format!("Request failed: {e}")
    }
}

/// Texte de la page à `adresse`, sans balises HTML.
pub async fn recuperer(
    client: &reqwest::Client,
    adresse: &str,
    delai: Duration,
) -> Result<String, String> {
    let url = Url::parse(adresse).map_err(|_| "Invalid URL.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only http:// and https:// URLs are supported.".into());
    }
    let mut rep = client
        .get(url)
        .header("User-Agent", NAVIGATEUR)
        .timeout(delai)
        .send()
        .await
        .map_err(|e| erreur_reseau(&e, delai))?;
    if !rep.status().is_success() {
        return Err(format!("The server answered {}.", rep.status().as_u16()));
    }
    let type_ = rep
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let html = type_.contains("html");
    let texte = type_.is_empty()
        || type_.starts_with("text/")
        || ["json", "xml", "javascript"]
            .iter()
            .any(|t| type_.contains(t));
    if !html && !texte {
        return Err(format!("Unsupported content type: {type_}."));
    }
    let mut octets = Vec::new();
    while let Some(morceau) = rep.chunk().await.map_err(|e| erreur_reseau(&e, delai))? {
        octets.extend_from_slice(&morceau);
        if octets.len() >= OCTETS_MAX {
            octets.truncate(OCTETS_MAX);
            break;
        }
    }
    let corps = String::from_utf8_lossy(&octets);
    let corps = if html {
        html_en_texte(&corps)
    } else {
        corps.into_owned()
    };
    Ok(couper(corps, CARACTERES_MAX, "\n[page truncated]"))
}

fn couper(texte: String, max: usize, mention: &str) -> String {
    match texte.char_indices().nth(max) {
        Some((i, _)) => format!("{}{mention}", &texte[..i]),
        None => texte,
    }
}

/// Résultats de recherche (titre, adresse, extrait) tirés de la page HTML de `base`.
pub async fn chercher(
    client: &reqwest::Client,
    base: &str,
    requete: &str,
    delai: Duration,
) -> Result<String, String> {
    let mut url = Url::parse(base).map_err(|_| "Invalid search engine address.".to_string())?;
    url.query_pairs_mut().append_pair("q", requete);
    let rep = client
        .get(url)
        .header("User-Agent", NAVIGATEUR)
        .timeout(delai)
        .send()
        .await
        .map_err(|e| erreur_reseau(&e, delai))?;
    let code = rep.status().as_u16();
    let refus = || format!("The search engine refused the request ({code}).");
    if !rep.status().is_success() {
        return Err(refus());
    }
    let page = rep.text().await.map_err(|e| erreur_reseau(&e, delai))?;
    let resultats = analyser_resultats(&page);
    if resultats.is_empty() {
        return Err(if page.contains("anomaly") {
            refus()
        } else {
            "No results.".into()
        });
    }
    let lignes: Vec<String> = resultats
        .iter()
        .enumerate()
        .map(|(i, (titre, adresse, extrait))| {
            let mut s = format!("{}. {titre}\n   {adresse}", i + 1);
            if !extrait.is_empty() {
                s.push_str(&format!("\n   {extrait}"));
            }
            s
        })
        .collect();
    Ok(lignes.join("\n\n"))
}

/// (titre, adresse, extrait) de chaque `a.result__a`, avec le `.result__snippet` qui suit.
fn analyser_resultats(page: &str) -> Vec<(String, String, String)> {
    let bas = page.to_ascii_lowercase();
    let mut resultats: Vec<(String, String, String)> = Vec::new();
    let mut i = 0;
    while let Some(p) = page[i..].find('<') {
        let debut = i + p;
        let fin = fin_de_balise(page, debut);
        i = fin;
        let balise = &page[debut + 1..fin.saturating_sub(1).max(debut + 1)];
        if balise.starts_with(['/', '!']) {
            continue;
        }
        let Some(classes) = attribut(balise, "class") else {
            continue;
        };
        let titre = classes.split_whitespace().any(|c| c == "result__a");
        let extrait = classes.split_whitespace().any(|c| c == "result__snippet");
        if !titre && !extrait {
            continue;
        }
        let nom: String = balise
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        let ferme = bas[fin..]
            .find(&format!("</{nom}"))
            .map_or(page.len(), |q| fin + q);
        let texte = html_en_texte(&page[fin..ferme]).replace('\n', " ");
        if titre {
            let href = attribut(balise, "href").unwrap_or_default();
            if resultats.len() == RESULTATS_MAX {
                break;
            }
            resultats.push((texte, adresse_reelle(&href), String::new()));
        } else if let Some(dernier) = resultats.last_mut() {
            if dernier.2.is_empty() {
                dernier.2 = texte;
            }
        }
    }
    resultats
}

/// Un lien de redirection `//duckduckgo.com/l/?uddg=<adresse>` rend l'adresse d'origine.
fn adresse_reelle(href: &str) -> String {
    let complet = if href.starts_with("//") {
        format!("https:{href}")
    } else {
        href.to_string()
    };
    if let Ok(u) = Url::parse(&complet) {
        if u.host_str() == Some("duckduckgo.com") && u.path() == "/l/" {
            if let Some((_, v)) = u.query_pairs().find(|(k, _)| k == "uddg") {
                return v.into_owned();
            }
        }
    }
    complet
}

/// Valeur (entités décodées) de l'attribut `nom` dans le texte d'une balise.
fn attribut(balise: &str, nom: &str) -> Option<String> {
    let bas = balise.to_ascii_lowercase();
    let mut depart = 0;
    while let Some(p) = bas[depart..].find(&format!("{nom}=")) {
        let debut = depart + p;
        depart = debut + nom.len() + 1;
        if !bas[..debut].ends_with(|c: char| c.is_whitespace()) {
            continue;
        }
        let reste = &balise[depart..];
        let valeur = match reste.chars().next() {
            Some(q @ ('"' | '\'')) => reste[1..].split(q).next().unwrap_or(""),
            _ => reste.split_whitespace().next().unwrap_or(""),
        };
        return Some(decoder(valeur));
    }
    None
}

/// Index qui suit le `>` fermant la balise ouverte en `debut` (les guillemets des valeurs sont respectés).
fn fin_de_balise(html: &str, debut: usize) -> usize {
    let oct = html.as_bytes();
    let mut guillemet = None;
    let mut i = debut + 1;
    while i < oct.len() {
        let c = oct[i];
        match guillemet {
            Some(q) if c == q => guillemet = None,
            Some(_) => {}
            None if (c == b'"' || c == b'\'') && oct[i - 1] == b'=' => guillemet = Some(c),
            None if c == b'>' => return i + 1,
            None => {}
        }
        i += 1;
    }
    oct.len()
}

/// Le texte d'une page HTML : sans balises, ni `script`, `style`, `noscript`, ni commentaires.
pub fn html_en_texte(html: &str) -> String {
    let bas = html.to_ascii_lowercase();
    let mut sortie = String::new();
    let mut i = 0;
    while i < html.len() {
        let Some(p) = html[i..].find('<') else {
            sortie.push_str(&html[i..]);
            break;
        };
        sortie.push_str(&html[i..i + p]);
        i += p;
        if html[i..].starts_with("<!--") {
            i = html[i..].find("-->").map_or(html.len(), |q| i + q + 3);
            continue;
        }
        let suite = html.as_bytes().get(i + 1).copied().unwrap_or(b' ');
        if !(suite.is_ascii_alphabetic() || suite == b'/' || suite == b'!') {
            sortie.push('<');
            i += 1;
            continue;
        }
        let fin = fin_de_balise(html, i);
        let interieur = &bas[i + 1..fin.saturating_sub(1).max(i + 1)];
        let ferme = interieur.starts_with('/');
        let nom: String = interieur
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect();
        i = fin;
        if !ferme && INVISIBLES.contains(&nom.as_str()) {
            i = bas[fin..]
                .find(&format!("</{nom}"))
                .map_or(html.len(), |q| fin_de_balise(html, fin + q));
        } else if BLOCS.contains(&nom.as_str()) {
            sortie.push('\n');
        } else if nom == "td" || nom == "th" {
            sortie.push(' ');
        }
    }
    tasser(&decoder(&sortie))
}

/// Entités courantes (`&amp;`, `&#39;`, `&#x41;`…) ; une entité inconnue reste telle quelle.
fn decoder(texte: &str) -> String {
    let mut s = String::with_capacity(texte.len());
    let mut reste = texte;
    while let Some(p) = reste.find('&') {
        s.push_str(&reste[..p]);
        reste = &reste[p..];
        let fin = reste.char_indices().take(11).find(|(_, c)| *c == ';');
        let rendu = fin.and_then(|(q, _)| {
            let nom = &reste[1..q];
            let c = match nom {
                "amp" => '&',
                "lt" => '<',
                "gt" => '>',
                "quot" => '"',
                "apos" => '\'',
                "nbsp" => ' ',
                _ => {
                    let n = nom.strip_prefix('#')?;
                    let code = match n.strip_prefix(['x', 'X']) {
                        Some(h) => u32::from_str_radix(h, 16).ok()?,
                        None => n.parse().ok()?,
                    };
                    char::from_u32(code)?
                }
            };
            Some((c, q + 1))
        });
        match rendu {
            Some((c, long)) => {
                s.push(c);
                reste = &reste[long..];
            }
            None => {
                s.push('&');
                reste = &reste[1..];
            }
        }
    }
    s.push_str(reste);
    s
}

/// Espaces tassés dans chaque ligne ; au plus une ligne vide de suite.
fn tasser(texte: &str) -> String {
    let mut lignes: Vec<String> = Vec::new();
    for l in texte.lines() {
        let l = l.split_whitespace().collect::<Vec<_>>().join(" ");
        if l.is_empty() && lignes.last().is_none_or(|d| d.is_empty()) {
            continue;
        }
        lignes.push(l);
    }
    lignes.join("\n").trim_end().to_string()
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use axum::{
        extract::Query,
        http::{header, StatusCode},
        response::IntoResponse,
        routing::get,
        Router,
    };
    use std::collections::HashMap;

    fn client() -> reqwest::Client {
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::new()
    }

    async fn serveur(app: Router) -> String {
        let ecoute = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let adresse = format!("http://{}", ecoute.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(ecoute, app).await.unwrap() });
        adresse
    }

    const PAGE_RECHERCHE: &str = r#"<html><body><div id="links" class="results">
<div class="result results_links results_links_deep web-result">
 <div class="links_main links_deep result__body">
  <h2 class="result__title">
   <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rust-lang.org%2Ffr%2F&amp;rut=abc">Rust <b>Programming</b> Language &amp; co</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rust-lang.org%2Ffr%2F&amp;rut=abc">Un langage <b>fiable</b> et rapide.</a>
 </div>
</div>
<div class="result results_links web-result">
 <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://exemple.org/direct">Direct</a></h2>
 <a class="result__snippet" href="https://exemple.org/direct">Sans redirection.</a>
</div>
</div></body></html>"#;

    #[tokio::test]
    async fn REQ057_AC6_websearch_lit_titre_adresse_extrait() {
        let recue = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let r = recue.clone();
        let app = Router::new().route(
            "/html/",
            get(move |Query(q): Query<HashMap<String, String>>, h: axum::http::HeaderMap| async move {
                *r.lock().unwrap() = format!(
                    "{}|{}",
                    q["q"],
                    h.get("user-agent").unwrap().to_str().unwrap()
                );
                ([(header::CONTENT_TYPE, "text/html")], PAGE_RECHERCHE)
            }),
        );
        let base = serveur(app).await;
        let texte = chercher(
            &client(),
            &format!("{base}/html/"),
            "rust & co",
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        assert_eq!(
            texte,
            "1. Rust Programming Language & co\n   https://www.rust-lang.org/fr/\n   Un langage fiable et rapide.\n\n2. Direct\n   https://exemple.org/direct\n   Sans redirection."
        );
        let vue = recue.lock().unwrap().clone();
        assert!(vue.starts_with("rust & co|Mozilla/5.0"), "{vue}");
    }

    #[tokio::test]
    async fn REQ057_AC6_websearch_limite_a_dix() {
        let page: String = (0..15)
            .map(|i| format!(r#"<a class="result__a" href="https://x.org/{i}">T{i}</a>"#))
            .collect();
        let app = Router::new().route("/html/", get(move || async move { page.clone() }));
        let base = serveur(app).await;
        let texte = chercher(
            &client(),
            &format!("{base}/html/"),
            "x",
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        assert!(
            texte.contains("10. T9") && !texte.contains("T10"),
            "{texte}"
        );
    }

    #[tokio::test]
    async fn REQ057_AC6_websearch_refus_du_moteur() {
        let app = Router::new()
            .route(
                "/refus/",
                get(|| async { (StatusCode::TOO_MANY_REQUESTS, "non") }),
            )
            .route(
                "/defi/",
                get(|| async { "<html><div class=\"anomaly-modal\">anomaly</div></html>" }),
            )
            .route("/vide/", get(|| async { "<html><p>Rien</p></html>" }));
        let base = serveur(app).await;
        let d = Duration::from_secs(5);
        let c = client();
        assert_eq!(
            chercher(&c, &format!("{base}/refus/"), "x", d).await,
            Err("The search engine refused the request (429).".into())
        );
        assert_eq!(
            chercher(&c, &format!("{base}/defi/"), "x", d).await,
            Err("The search engine refused the request (200).".into())
        );
        assert_eq!(
            chercher(&c, &format!("{base}/vide/"), "x", d).await,
            Err("No results.".into())
        );
    }

    #[tokio::test]
    async fn REQ057_AC7_webfetch_sans_balises_ni_script() {
        let html = "<html><head><title>Titre</title><style>p{color:red}</style>\
<script>var a = '<b>x</b>';</script></head><body><!-- caché -->\
<h1>Bonjour</h1><p>A &amp; B &lt;ok&gt; &quot;q&quot; it&#39;s&nbsp;la &#233; &#x41;</p>\n\n\n\n\
<noscript>Activez JS</noscript><p>Fin   <a href=\"x>y\">lien</a></p>5 < 6</body></html>";
        let app = Router::new().route(
            "/p",
            get(
                move || async move { ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html) },
            ),
        );
        let base = serveur(app).await;
        let texte = recuperer(&client(), &format!("{base}/p"), Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(
            texte,
            "Titre\n\nBonjour\n\nA & B <ok> \"q\" it's la é A\n\nFin lien\n5 < 6"
        );
    }

    #[tokio::test]
    async fn REQ057_AC7_webfetch_texte_brut_et_binaire() {
        let app = Router::new()
            .route(
                "/t",
                get(|| async { ([(header::CONTENT_TYPE, "text/plain")], "<b> &amp; brut") }),
            )
            .route(
                "/b",
                get(|| async { ([(header::CONTENT_TYPE, "image/png")], vec![0u8, 1]) }),
            )
            .route("/e", get(|| async { (StatusCode::NOT_FOUND, "x") }));
        let base = serveur(app).await;
        let d = Duration::from_secs(5);
        let c = client();
        assert_eq!(
            recuperer(&c, &format!("{base}/t"), d).await.unwrap(),
            "<b> &amp; brut"
        );
        assert_eq!(
            recuperer(&c, &format!("{base}/b"), d).await,
            Err("Unsupported content type: image/png.".into())
        );
        assert_eq!(
            recuperer(&c, &format!("{base}/e"), d).await,
            Err("The server answered 404.".into())
        );
    }

    #[tokio::test]
    async fn REQ057_AC7_webfetch_refuse_ftp_et_coupe_a_50000() {
        let c = client();
        let d = Duration::from_secs(5);
        for url in [
            "ftp://exemple.org/f",
            "file:///etc/passwd",
            "pas une adresse",
        ] {
            assert!(recuperer(&c, url, d).await.is_err(), "{url}");
        }
        assert_eq!(
            recuperer(&c, "ftp://exemple.org/f", d).await,
            Err("Only http:// and https:// URLs are supported.".into())
        );
        let app = Router::new().route(
            "/long",
            get(|| async { ([(header::CONTENT_TYPE, "text/plain")], "é".repeat(60_000)) }),
        );
        let base = serveur(app).await;
        let texte = recuperer(&c, &format!("{base}/long"), d).await.unwrap();
        assert_eq!(texte, format!("{}\n[page truncated]", "é".repeat(50_000)));
    }

    #[tokio::test]
    async fn REQ057_AC7_webfetch_delai() {
        let app = Router::new().route(
            "/lent",
            get(|| async {
                tokio::time::sleep(Duration::from_secs(10)).await;
                "tard".into_response()
            }),
        );
        let base = serveur(app).await;
        let debut = std::time::Instant::now();
        let r = recuperer(&client(), &format!("{base}/lent"), Duration::from_secs(1)).await;
        assert_eq!(r, Err("Timed out after 1 s.".into()));
        assert!(debut.elapsed() < Duration::from_secs(5));
    }
}
