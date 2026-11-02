use axum::{http::header, response::IntoResponse, routing::get, Router};
use std::net::SocketAddr;

const PORT_PAR_DEFAUT: u16 = 8443;
const INDEX: &[u8] = include_bytes!("../web/dist/index.html");
const MAIN_JS: &[u8] = include_bytes!("../web/dist/main.js");

fn lire_port(args: &[String]) -> Result<u16, String> {
    match args.iter().position(|a| a == "--port") {
        None => Ok(PORT_PAR_DEFAUT),
        Some(i) => args
            .get(i + 1)
            .and_then(|v| v.parse::<u16>().ok())
            .ok_or_else(|| "--port attend un numéro de port entre 0 et 65535".to_string()),
    }
}

async fn index() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], INDEX)
}

async fn main_js() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        MAIN_JS,
    )
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let port = lire_port(&args).unwrap_or_else(|e| {
        eprintln!("Erreur : {e}");
        std::process::exit(2);
    });

    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("fournisseur TLS déjà installé");
    let cert = rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()])
        .expect("génération du certificat impossible");
    let config = axum_server::tls_rustls::RustlsConfig::from_der(
        vec![cert.cert.der().to_vec()],
        cert.key_pair.serialize_der(),
    )
    .await
    .expect("certificat invalide");

    let app = Router::new()
        .route("/", get(index))
        .route("/main.js", get(main_js));
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    println!("Yaide écoute sur https://{addr}");
    if let Err(e) = axum_server::bind_rustls(addr, config)
        .serve(app.into_make_service())
        .await
    {
        eprintln!("Erreur : le serveur s'est arrêté : {e}");
        std::process::exit(1);
    }
}
