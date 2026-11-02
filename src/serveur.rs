use axum::{http::header, response::IntoResponse, routing::get, Router};
use std::net::{SocketAddr, TcpListener};
use std::path::Path;

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

/// Réserve le port sur toutes les adresses de la machine.
pub fn ecouter(port: u16) -> Result<TcpListener, String> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let l = TcpListener::bind(addr).map_err(|e| {
        format!("le port {port} n'est pas disponible ({e}) ; choisissez-en un autre avec --port")
    })?;
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    Ok(l)
}

pub async fn servir(listener: TcpListener, cert: &Path, cle: &Path) -> Result<(), String> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| "fournisseur TLS déjà installé".to_string())?;
    let config = axum_server::tls_rustls::RustlsConfig::from_pem_file(cert, cle)
        .await
        .map_err(|e| format!("certificat illisible : {e}"))?;
    let app = Router::new()
        .route("/", get(index))
        .route("/main.js", get(main_js));
    axum_server::from_tcp_rustls(listener, config)
        .serve(app.into_make_service())
        .await
        .map_err(|e| format!("le serveur s'est arrêté : {e}"))
}
