use crate::{auth, config, fichiers, git, recherche, shells};
use axum::body::Bytes;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path as CheminUrl, Query, Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::Router;
use std::collections::HashMap;
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

const CSP: &str = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";

struct Etat {
    config: PathBuf,
    projet: String,
    limiteur: tokio::sync::Mutex<auth::Limiteur>,
    projet_dir: PathBuf,
    instance: String,
    shells: Arc<shells::Registre>,
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
    let fichier_statique = matches!(
        chemin,
        "/" | "/main.js"
            | "/main.css"
            | "/tokens.css"
            | "/composants.css"
            | "/theme.js"
            | "/api/info"
    ) || chemin.starts_with("/polices/");
    (m == Method::GET && fichier_statique) || (m == Method::POST && chemin == "/api/connexion")
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

/// Identifiant tiré au démarrage : change à chaque lancement de Yaide.
fn identifiant_instance() -> String {
    use ring::rand::SecureRandom;
    let mut o = [0u8; 8];
    ring::rand::SystemRandom::new()
        .fill(&mut o)
        .expect("aléa indisponible");
    o.iter().map(|b| format!("{b:02x}")).collect()
}

async fn liste_shells(State(etat): State<Partage>) -> Response {
    let ids: Vec<String> = etat.shells.ids().iter().map(u32::to_string).collect();
    let corps = format!(
        "{{\"instance\":\"{}\",\"shells\":[{}]}}",
        etat.instance,
        ids.join(",")
    );
    ([(header::CONTENT_TYPE, "application/json")], corps).into_response()
}

async fn ouvrir_shell(State(etat): State<Partage>) -> Response {
    let registre = etat.shells.clone();
    let projet = etat.projet_dir.clone();
    let r = tokio::task::spawn_blocking(move || registre.ouvrir(&projet))
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
    match r {
        Ok(id) => (
            StatusCode::CREATED,
            [(header::CONTENT_TYPE, "application/json")],
            format!("{{\"id\":{id}}}"),
        )
            .into_response(),
        Err(raison) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            raison,
        )
            .into_response(),
    }
}

async fn fermer_shell(State(etat): State<Partage>, CheminUrl(id): CheminUrl<u32>) -> StatusCode {
    if etat.shells.fermer(id) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn ws_shell(
    State(etat): State<Partage>,
    CheminUrl(id): CheminUrl<u32>,
    ws: WebSocketUpgrade,
) -> Response {
    match etat.shells.obtenir(id) {
        Some(s) => {
            let garde = etat.shells.client();
            ws.on_upgrade(move |socket| async move {
                client_shell(socket, s).await;
                drop(garde);
            })
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn taille_demandee(texte: &str) -> Option<(u16, u16)> {
    let mut m = texte.split(' ');
    if m.next()? != "taille" {
        return None;
    }
    let c: u16 = m.next()?.parse().ok()?;
    let l: u16 = m.next()?.parse().ok()?;
    (m.next().is_none() && c > 0 && l > 0).then_some((c, l))
}

/// Un client lent ne gêne que lui : s'il ne suit pas, on le déconnecte et il
/// reviendra chercher l'affichage récent.
async fn client_shell(mut socket: WebSocket, shell: Arc<shells::Shell>) {
    use std::time::Duration;
    let (recent, mut direct) = shell.abonner();
    let delai = Duration::from_secs(30);
    let deja_fini = shell.est_fini();
    if !recent.is_empty()
        && !matches!(
            tokio::time::timeout(delai, socket.send(Message::Binary(recent.into()))).await,
            Ok(Ok(()))
        )
    {
        return;
    }
    if !deja_fini {
        loop {
            tokio::select! {
                ev = direct.recv() => match ev {
                    Ok(shells::Evenement::Sortie(o)) => {
                        let envoi = socket.send(Message::Binary(o.as_ref().clone().into()));
                        if !matches!(tokio::time::timeout(delai, envoi).await, Ok(Ok(()))) {
                            return;
                        }
                    }
                    Ok(shells::Evenement::Fin) => break,
                    // En retard : coupure sans Close, le client reprend avec l'affichage récent.
                    Err(_) => return,
                },
                msg = socket.recv() => match msg {
                    Some(Ok(Message::Binary(o))) => shell.ecrire(o.to_vec()),
                    Some(Ok(Message::Text(t))) => {
                        if let Some((c, l)) = taille_demandee(t.as_str()) {
                            shell.redimensionner(c, l);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                    Some(Ok(_)) => {}
                },
            }
        }
    }
    let close = Message::Close(Some(CloseFrame {
        code: if shell.serveur_arrete() { 1001 } else { 1000 },
        reason: "".into(),
    }));
    let _ = tokio::time::timeout(delai, socket.send(close)).await;
}

type Requete = Query<HashMap<String, String>>;

fn param<'a>(q: &'a HashMap<String, String>, nom: &str) -> &'a str {
    q.get(nom).map_or("", String::as_str)
}

fn erreur_fichier(e: fichiers::Erreur) -> Response {
    use fichiers::Erreur::*;
    let (code, cause, message, version) = match e {
        Interdit => (
            StatusCode::FORBIDDEN,
            "interdit",
            "Ce chemin sort du projet.".to_string(),
            None,
        ),
        Introuvable => (
            StatusCode::NOT_FOUND,
            "introuvable",
            "Fichier introuvable.".to_string(),
            None,
        ),
        Existe => (
            StatusCode::CONFLICT,
            "existe",
            "Ce nom est déjà pris. Choisissez-en un autre.".to_string(),
            None,
        ),
        Binaire => (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "binaire",
            "C'est un fichier binaire.".to_string(),
            None,
        ),
        NonUtf8 => (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "non-utf8",
            "Le texte n'est pas en UTF-8.".to_string(),
            None,
        ),
        TropGros => (
            StatusCode::PAYLOAD_TOO_LARGE,
            "trop-gros",
            "Le fichier dépasse 5 Mo.".to_string(),
            None,
        ),
        Conflit(v) => (
            StatusCode::PRECONDITION_FAILED,
            "conflit",
            "Le fichier a changé sur le disque.".to_string(),
            Some(v),
        ),
        Droits => (
            StatusCode::FORBIDDEN,
            "droits",
            "droits insuffisants".to_string(),
            None,
        ),
        Invalide(m) => (StatusCode::BAD_REQUEST, "invalide", m.to_string(), None),
        Autre(m) => (StatusCode::INTERNAL_SERVER_ERROR, "erreur", m, None),
    };
    let version = version.map_or(String::new(), |v| {
        format!(",\"version\":{}", json_texte(&v))
    });
    (
        code,
        [(header::CONTENT_TYPE, "application/json")],
        format!(
            "{{\"cause\":\"{cause}\",\"message\":{}{version}}}",
            json_texte(&message)
        ),
    )
        .into_response()
}

/// Exécute une opération sur le disque hors du fil asynchrone.
async fn sur_disque<T: Send + 'static>(
    etat: &Etat,
    f: impl FnOnce(&Path) -> Result<T, fichiers::Erreur> + Send + 'static,
) -> Result<T, fichiers::Erreur> {
    let projet = etat.projet_dir.clone();
    tokio::task::spawn_blocking(move || f(&projet))
        .await
        .unwrap_or_else(|e| Err(fichiers::Erreur::Autre(e.to_string())))
}

async fn liste_fichiers(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let rel = param(&q, "chemin").to_string();
    match sur_disque(&etat, move |p| fichiers::lister(p, &rel)).await {
        Ok(entrees) => {
            let l: Vec<String> = entrees
                .iter()
                .map(|e| {
                    format!(
                        "{{\"nom\":{},\"dossier\":{},\"ignore\":{}}}",
                        json_texte(&e.nom),
                        e.dossier,
                        e.ignore
                    )
                })
                .collect();
            (
                [(header::CONTENT_TYPE, "application/json")],
                format!("{{\"entrees\":[{}]}}", l.join(",")),
            )
                .into_response()
        }
        Err(e) => erreur_fichier(e),
    }
}

async fn lire_fichier(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let rel = param(&q, "chemin").to_string();
    match sur_disque(&etat, move |p| fichiers::lire(p, &rel)).await {
        Ok((contenu, version)) => (
            [
                (
                    header::CONTENT_TYPE,
                    "text/plain; charset=utf-8".to_string(),
                ),
                (header::HeaderName::from_static("x-version"), version),
            ],
            contenu,
        )
            .into_response(),
        Err(e) => erreur_fichier(e),
    }
}

async fn ecrire_fichier(State(etat): State<Partage>, Query(q): Requete, corps: Bytes) -> Response {
    let rel = param(&q, "chemin").to_string();
    let base = q.get("version").cloned();
    match sur_disque(&etat, move |p| {
        fichiers::ecrire(p, &rel, base.as_deref(), &corps)
    })
    .await
    {
        Ok(version) => (
            [
                (header::CONTENT_TYPE, "application/json".to_string()),
                (
                    header::HeaderName::from_static("x-version"),
                    version.clone(),
                ),
            ],
            format!("{{\"version\":{}}}", json_texte(&version)),
        )
            .into_response(),
        Err(e) => erreur_fichier(e),
    }
}

async fn creer_fichier(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let rel = param(&q, "chemin").to_string();
    let dossier = match param(&q, "type") {
        "dossier" => true,
        "fichier" => false,
        _ => {
            return erreur_fichier(fichiers::Erreur::Invalide(
                "Le type doit être « fichier » ou « dossier ».",
            ))
        }
    };
    match sur_disque(&etat, move |p| fichiers::creer(p, &rel, dossier)).await {
        Ok(()) => StatusCode::CREATED.into_response(),
        Err(e) => erreur_fichier(e),
    }
}

async fn renommer_fichier(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let (de, vers) = (param(&q, "de").to_string(), param(&q, "vers").to_string());
    match sur_disque(&etat, move |p| fichiers::renommer(p, &de, &vers)).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => erreur_fichier(e),
    }
}

async fn supprimer_fichier(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let rel = param(&q, "chemin").to_string();
    match sur_disque(&etat, move |p| fichiers::supprimer(p, &rel)).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => erreur_fichier(e),
    }
}

/// Corps : un chemin par ligne.
async fn versions_fichiers(State(etat): State<Partage>, corps: String) -> Response {
    let r = sur_disque(&etat, move |p| {
        let chemins: Vec<&str> = corps.lines().filter(|l| !l.is_empty()).collect();
        fichiers::versions(p, &chemins)
    })
    .await;
    match r {
        Ok(l) => {
            let l: Vec<String> = l
                .iter()
                .map(|(c, v)| {
                    format!(
                        "{}:{}",
                        json_texte(c),
                        v.as_deref().map_or("null".to_string(), json_texte)
                    )
                })
                .collect();
            (
                [(header::CONTENT_TYPE, "application/json")],
                format!("{{{}}}", l.join(",")),
            )
                .into_response()
        }
        Err(e) => erreur_fichier(e),
    }
}

fn json(code: StatusCode, corps: String) -> Response {
    (code, [(header::CONTENT_TYPE, "application/json")], corps).into_response()
}

fn erreur_git(e: git::Erreur) -> Response {
    use git::Erreur::*;
    let (code, cause, message) = match e {
        PasDepot => (
            StatusCode::CONFLICT,
            "pas-depot",
            "Ce dossier n'est pas un dépôt git.".to_string(),
        ),
        AucunIndexe => (
            StatusCode::CONFLICT,
            "aucun-indexe",
            "Aucun fichier indexé. Indexez au moins un fichier.".to_string(),
        ),
        MessageVide => (
            StatusCode::BAD_REQUEST,
            "message-vide",
            "Écrivez un message de commit.".to_string(),
        ),
        Invalide(m) => (StatusCode::BAD_REQUEST, "invalide", m),
        Git(m) => (StatusCode::CONFLICT, "git", m),
    };
    json(
        code,
        format!(
            "{{\"cause\":\"{cause}\",\"message\":{}}}",
            json_texte(&message)
        ),
    )
}

/// Exécute une opération git hors du fil asynchrone.
async fn avec_git<T: Send + 'static>(
    etat: &Etat,
    f: impl FnOnce(&Path) -> Result<T, git::Erreur> + Send + 'static,
) -> Result<T, git::Erreur> {
    let projet = etat.projet_dir.clone();
    tokio::task::spawn_blocking(move || f(&projet))
        .await
        .unwrap_or_else(|e| Err(git::Erreur::Git(e.to_string())))
}

async fn git_etat(State(etat): State<Partage>) -> Response {
    match avec_git(&etat, git::etat).await {
        Ok(e) => {
            let branches: Vec<String> = e.branches.iter().map(|b| json_texte(b)).collect();
            let changements: Vec<String> = e
                .changements
                .iter()
                .map(|c| {
                    format!(
                        "{{\"chemin\":{},\"statut\":{},\"indexe\":{}}}",
                        json_texte(&c.chemin),
                        json_texte(c.statut),
                        c.indexe
                    )
                })
                .collect();
            json(
                StatusCode::OK,
                format!(
                    "{{\"branche\":{},\"detachee\":{},\"branches\":[{}],\"changements\":[{}]}}",
                    json_texte(&e.branche),
                    e.detachee,
                    branches.join(","),
                    changements.join(",")
                ),
            )
        }
        Err(e) => erreur_git(e),
    }
}

async fn git_diff(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let rel = param(&q, "chemin").to_string();
    match avec_git(&etat, move |p| git::diff(p, &rel)).await {
        Ok(d) => json(
            StatusCode::OK,
            format!(
                "{{\"binaire\":{},\"trop_gros\":{},\"diff\":{}}}",
                d.binaire,
                d.trop_gros,
                json_texte(&d.texte)
            ),
        ),
        Err(e) => erreur_git(e),
    }
}

fn fait(r: Result<(), git::Erreur>) -> Response {
    match r {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => erreur_git(e),
    }
}

async fn git_indexer(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let rel = param(&q, "chemin").to_string();
    fait(avec_git(&etat, move |p| git::indexer(p, &rel)).await)
}

/// Corps : le message de commit, tel quel.
async fn git_commit(State(etat): State<Partage>, message: String) -> Response {
    fait(avec_git(&etat, move |p| git::commit(p, &message)).await)
}

async fn git_branche(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let nom = param(&q, "nom").to_string();
    fait(avec_git(&etat, move |p| git::changer_branche(p, &nom)).await)
}

async fn git_pull(State(etat): State<Partage>) -> Response {
    fait(avec_git(&etat, |p| git::synchroniser(p, "pull").map(|_| ())).await)
}

async fn git_push(State(etat): State<Partage>) -> Response {
    fait(avec_git(&etat, |p| git::synchroniser(p, "push").map(|_| ())).await)
}

const INDEX: &[u8] = include_bytes!("../web/dist/index.html");
const MAIN_JS: &[u8] = include_bytes!("../web/dist/main.js");

async fn chercher(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let requete = param(&q, "q").to_string();
    if requete.is_empty() {
        return json(
            StatusCode::BAD_REQUEST,
            "{\"cause\":\"invalide\",\"message\":\"Saisissez un texte à chercher.\"}".into(),
        );
    }
    let projet = etat.projet_dir.clone();
    let Ok(rep) = tokio::task::spawn_blocking(move || recherche::chercher(&projet, &requete)).await
    else {
        return json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "{\"cause\":\"erreur\",\"message\":\"la recherche s'est interrompue\"}".into(),
        );
    };
    let l: Vec<String> = rep
        .resultats
        .iter()
        .map(|r| {
            format!(
                "{{\"chemin\":{},\"ligne\":{},\"texte\":{},\"debut\":{},\"fin\":{}}}",
                json_texte(&r.chemin),
                r.ligne,
                json_texte(&r.texte),
                r.debut,
                r.fin
            )
        })
        .collect();
    json(
        StatusCode::OK,
        format!(
            "{{\"resultats\":[{}],\"limite\":{}}}",
            l.join(","),
            rep.limite
        ),
    )
}

async fn chemins(State(etat): State<Partage>) -> Response {
    let projet = etat.projet_dir.clone();
    let Ok(liste) = tokio::task::spawn_blocking(move || recherche::lister(&projet)).await else {
        return json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "{\"cause\":\"erreur\",\"message\":\"la lecture s'est interrompue\"}".into(),
        );
    };
    let l: Vec<String> = liste.iter().map(|c| json_texte(c)).collect();
    json(StatusCode::OK, format!("{{\"chemins\":[{}]}}", l.join(",")))
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

const MAIN_CSS: &[u8] = include_bytes!("../web/dist/main.css");
const TOKENS_CSS: &[u8] = include_bytes!("../web/dist/tokens.css");
const COMPOSANTS_CSS: &[u8] = include_bytes!("../web/dist/composants.css");

const THEME_JS: &[u8] = include_bytes!("../web/dist/theme.js");

/// Polices et licence embarquées : nom, type MIME, contenu.
const POLICES: [(&str, &str, &[u8]); 4] = [
    (
        "JetBrainsMono-Regular.woff2",
        "font/woff2",
        include_bytes!("../web/dist/polices/JetBrainsMono-Regular.woff2"),
    ),
    (
        "JetBrainsMono-Italic.woff2",
        "font/woff2",
        include_bytes!("../web/dist/polices/JetBrainsMono-Italic.woff2"),
    ),
    (
        "JetBrainsMono-SemiBold.woff2",
        "font/woff2",
        include_bytes!("../web/dist/polices/JetBrainsMono-SemiBold.woff2"),
    ),
    (
        "OFL.txt",
        "text/plain; charset=utf-8",
        include_bytes!("../web/dist/polices/OFL.txt"),
    ),
];

async fn police(CheminUrl(nom): CheminUrl<String>) -> Response {
    match POLICES.iter().find(|(n, _, _)| *n == nom) {
        Some((_, mime, corps)) => ([(header::CONTENT_TYPE, *mime)], *corps).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

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
        projet_dir: projet.to_path_buf(),
        instance: identifiant_instance(),
        shells: Default::default(),
    });
    let registre = etat.shells.clone();
    let app = Router::new()
        .route("/", get(index))
        .route("/main.js", get(main_js))
        .route("/main.css", get(|| async { css(MAIN_CSS) }))
        .route("/tokens.css", get(|| async { css(TOKENS_CSS) }))
        .route("/composants.css", get(|| async { css(COMPOSANTS_CSS) }))
        .route(
            "/theme.js",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
                    THEME_JS,
                )
            }),
        )
        .route("/polices/{nom}", get(police))
        .route("/api/info", get(info))
        .route("/api/connexion", post(connexion))
        .route("/api/deconnexion", post(deconnexion))
        .route("/api/session", get(session))
        .route("/api/shells", get(liste_shells).post(ouvrir_shell))
        .route("/api/shells/{id}", delete(fermer_shell))
        .route("/api/shells/{id}/ws", get(ws_shell))
        .route("/api/fichiers", get(liste_fichiers))
        .route(
            "/api/fichier",
            get(lire_fichier)
                .put(ecrire_fichier)
                .delete(supprimer_fichier)
                .layer(DefaultBodyLimit::disable()),
        )
        .route("/api/fichiers/creer", post(creer_fichier))
        .route("/api/fichiers/renommer", post(renommer_fichier))
        .route("/api/fichiers/versions", post(versions_fichiers))
        .route("/api/recherche", get(chercher))
        .route("/api/chemins", get(chemins))
        .route("/api/git/etat", get(git_etat))
        .route("/api/git/diff", get(git_diff))
        .route("/api/git/indexer", post(git_indexer))
        .route("/api/git/commit", post(git_commit))
        .route("/api/git/branche", post(git_branche))
        .route("/api/git/pull", post(git_pull))
        .route("/api/git/push", post(git_push))
        .layer(middleware::from_fn_with_state(etat.clone(), garde))
        .with_state(etat);
    let serveur = axum_server::from_tcp_rustls(listener, tls).serve(app.into_make_service());
    tokio::select! {
        r = serveur => r.map_err(|e| format!("le serveur s'est arrêté : {e}")),
        _ = arret() => {
            registre.arreter().await;
            Ok(())
        }
    }
}

/// Attend SIGTERM ou SIGINT.
async fn arret() {
    use tokio::signal::unix::{signal, SignalKind};
    let (Ok(mut term), Ok(mut int)) = (
        signal(SignalKind::terminate()),
        signal(SignalKind::interrupt()),
    ) else {
        return std::future::pending().await;
    };
    tokio::select! { _ = term.recv() => {}, _ = int.recv() => {} }
}
