use crate::{auth, config};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

const CSP: &str = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";

struct Etat {
    config: PathBuf,
    projet: String,
    limiteur: tokio::sync::Mutex<auth::Limiteur>,
}

type Partage = Arc<Etat>;

fn maintenant() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cle_session(etat: &Etat) -> Vec<u8> {
    std::fs::read(config::fichier_mot_de_passe(&etat.config)).unwrap_or_default()
}

fn cookie_de(entetes: &HeaderMap) -> Option<String> {
    let prefixe = format!("{}=", auth::NOM_COOKIE);
    entetes
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|c| c.trim().strip_prefix(&prefixe).map(str::to_string))
}

fn session_ok(etat: &Etat, entetes: &HeaderMap) -> bool {
    let cle = cle_session(etat);
    !cle.is_empty()
        && cookie_de(entetes).is_some_and(|c| auth::session_valide(&cle, &c, maintenant()))
}

/// Écriture ou WebSocket : l'`Origin` doit être l'adresse de l'instance.
fn origine_ok(req: &Request) -> bool {
    let entetes = req.headers();
    // En HTTP/2, l'hôte est dans l'URI (`:authority`) et non dans `Host`.
    let hote = req
        .uri()
        .authority()
        .map(|a| a.as_str())
        .or_else(|| entetes.get(header::HOST).and_then(|v| v.to_str().ok()));
    let origine = entetes.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    matches!((hote, origine), (Some(h), Some(o)) if o == format!("https://{h}"))
}

fn est_publique(m: &Method, chemin: &str) -> bool {
    (m == Method::GET
        && matches!(
            chemin,
            "/" | "/main.js" | "/tokens.css" | "/composants.css" | "/api/info"
        ))
        || (m == Method::POST && chemin == "/api/connexion")
}

async fn garde(State(etat): State<Partage>, req: Request, next: Next) -> Response {
    let publique = est_publique(req.method(), req.uri().path());
    if !publique && !session_ok(&etat, req.headers()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let lecture = matches!(*req.method(), Method::GET | Method::HEAD);
    let ouverture_ws = req.headers().contains_key(header::UPGRADE);
    if (!lecture || ouverture_ws) && !origine_ok(&req) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut rep = next.run(req).await;
    rep.headers_mut()
        .insert(header::CONTENT_SECURITY_POLICY, CSP.parse().unwrap());
    rep
}

fn texte(code: StatusCode, msg: &'static str) -> Response {
    (
        code,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        msg,
    )
        .into_response()
}

fn json_texte(s: &str) -> String {
    let mut r = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => r.push_str("\\\""),
            '\\' => r.push_str("\\\\"),
            c if (c as u32) < 0x20 => r.push_str(&format!("\\u{:04x}", c as u32)),
            c => r.push(c),
        }
    }
    r.push('"');
    r
}

async fn info(State(etat): State<Partage>) -> Response {
    let corps = format!(
        "{{\"nom\":\"Yaide\",\"chemin\":{}}}",
        json_texte(&etat.projet)
    );
    ([(header::CONTENT_TYPE, "application/json")], corps).into_response()
}

/// Le corps de la requête est le mot de passe, tel quel.
async fn connexion(State(etat): State<Partage>, mot_de_passe: String) -> Response {
    if mot_de_passe.is_empty() {
        return texte(StatusCode::BAD_REQUEST, "Saisissez le mot de passe.");
    }
    // Verrou gardé pendant la vérification : pas d'essais en parallèle.
    let mut limiteur = etat.limiteur.lock().await;
    if limiteur.bloque(maintenant()) {
        return texte(
            StatusCode::TOO_MANY_REQUESTS,
            "Trop d'essais. Attendez une minute.",
        );
    }
    let dossier = etat.config.clone();
    let bon =
        tokio::task::spawn_blocking(move || config::verifier_mot_de_passe(&dossier, &mot_de_passe))
            .await
            .unwrap_or(false);
    if !bon {
        limiteur.echec(maintenant());
        return texte(StatusCode::UNAUTHORIZED, "Mot de passe incorrect.");
    }
    limiteur.reussite();
    let valeur = auth::creer_session(&cle_session(&etat), maintenant());
    (
        StatusCode::NO_CONTENT,
        [(
            header::SET_COOKIE,
            format!(
                "{}={valeur}; Max-Age={}; Path=/; Secure; HttpOnly; SameSite=Strict",
                auth::NOM_COOKIE,
                auth::DUREE_SESSION
            ),
        )],
    )
        .into_response()
}

async fn deconnexion() -> Response {
    (
        StatusCode::NO_CONTENT,
        [(
            header::SET_COOKIE,
            format!(
                "{}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict",
                auth::NOM_COOKIE
            ),
        )],
    )
        .into_response()
}

/// Sert de sonde : 204 si la session est valide (la garde a déjà répondu 401 sinon).
async fn session() -> StatusCode {
    StatusCode::NO_CONTENT
}

const INDEX: &[u8] = include_bytes!("../web/dist/index.html");
const MAIN_JS: &[u8] = include_bytes!("../web/dist/main.js");

async fn index() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], INDEX)
}

async fn main_js() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        MAIN_JS,
    )
}

const TOKENS_CSS: &[u8] = include_bytes!("../web/dist/tokens.css");
const COMPOSANTS_CSS: &[u8] = include_bytes!("../web/dist/composants.css");

fn css(corps: &'static [u8]) -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8")], corps)
}

/// Réserve le port sur toutes les adresses de la machine.
pub fn ecouter(port: u16) -> Result<TcpListener, String> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let l = TcpListener::bind(addr).map_err(|e| {
        format!("le port {port} n'est pas disponible ({e}) ; choisissez-en un autre avec --port")
    })?;
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    Ok(l)
}

pub async fn servir(
    listener: TcpListener,
    cert: &Path,
    cle: &Path,
    config: &Path,
    projet: &Path,
) -> Result<(), String> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| "fournisseur TLS déjà installé".to_string())?;
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem_file(cert, cle)
        .await
        .map_err(|e| format!("certificat illisible : {e}"))?;
    let etat: Partage = Arc::new(Etat {
        config: config.to_path_buf(),
        projet: projet.display().to_string(),
        limiteur: Default::default(),
    });
    let app = Router::new()
        .route("/", get(index))
        .route("/main.js", get(main_js))
        .route("/tokens.css", get(|| async { css(TOKENS_CSS) }))
        .route("/composants.css", get(|| async { css(COMPOSANTS_CSS) }))
        .route("/api/info", get(info))
        .route("/api/connexion", post(connexion))
        .route("/api/deconnexion", post(deconnexion))
        .route("/api/session", get(session))
        .layer(middleware::from_fn_with_state(etat.clone(), garde))
        .with_state(etat);
    axum_server::from_tcp_rustls(listener, tls)
        .serve(app.into_make_service())
        .await
        .map_err(|e| format!("le serveur s'est arrêté : {e}"))
}
