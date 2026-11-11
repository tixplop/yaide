use crate::agent::agents::Agents;
use crate::agent::conversation::{ErreurEnvoi, Gestionnaire};
use crate::agent::mcp;
use crate::agent::outils::Limites;
use crate::agent::reglages::{Erreur, Reglages};
use crate::{
    auth, commande_mise_a_jour, config, depot, fichiers, git, opencode, recherche, shells, version,
};
use axum::body::Bytes;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path as CheminUrl, Query, Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, post, put};
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
    reglages: Arc<Reglages>,
    agent: Arc<Gestionnaire>,
    agents: Arc<Agents>,
    opencode: opencode::Opencode,
    client_opencode: reqwest::Client,
    version: version::Version,
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
    // Un GET vers opencode qui vient d'une autre origine est refusé aussi (sans `Origin` : accepté).
    if lecture
        && req.uri().path().starts_with("/api/opencode")
        && req.headers().contains_key(header::ORIGIN)
        && !origine_ok(&req)
    {
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

async fn claude_disponible() -> Response {
    let corps = format!("{{\"disponible\":{}}}", shells::trouver_claude().is_some());
    ([(header::CONTENT_TYPE, "application/json")], corps).into_response()
}

async fn ouvrir_claude(State(etat): State<Partage>) -> Response {
    let registre = etat.shells.clone();
    let projet = etat.projet_dir.clone();
    let r = tokio::task::spawn_blocking(move || registre.ouvrir_claude(&projet))
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
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            raison,
        )
            .into_response(),
    }
}

async fn opencode_disponible() -> Response {
    let corps = format!("{{\"disponible\":{}}}", opencode::disponible().await);
    ([(header::CONTENT_TYPE, "application/json")], corps).into_response()
}

/// Relais vers `/api/<chemin>` du serveur opencode : statut, `content-type` et corps au fil de l'eau.
async fn relais_opencode(State(etat): State<Partage>, req: Request) -> Response {
    // Chemin brut, encodage intact : ni `.`/`..` (même encodés), ni décodage de `%2F` ou `%3F`.
    let brut = req
        .uri()
        .path()
        .strip_prefix("/api/opencode")
        .unwrap_or("")
        .to_string();
    if brut.split('/').any(|s| {
        matches!(
            s.to_ascii_lowercase().as_str(),
            "." | ".." | "%2e" | ".%2e" | "%2e." | "%2e%2e"
        )
    }) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let (port, mdp) = match etat.opencode.assurer(&etat.projet_dir).await {
        Ok(p) => p,
        Err(raison) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                raison,
            )
                .into_response()
        }
    };
    let (entete, corps) = req.into_parts();
    let Ok(corps) = axum::body::to_bytes(corps, 64 * 1024 * 1024).await else {
        return texte(StatusCode::BAD_REQUEST, "corps illisible");
    };
    let mut url = format!("http://127.0.0.1:{port}{brut}");
    if let Some(q) = entete.uri.query() {
        url.push('?');
        url.push_str(q);
    }
    let mut demande = etat
        .client_opencode
        .request(entete.method, url)
        .basic_auth("opencode", Some(mdp))
        .body(corps);
    if let Some(t) = entete.headers.get(header::CONTENT_TYPE) {
        demande = demande.header(header::CONTENT_TYPE, t);
    }
    let Ok(rep) = demande.send().await else {
        return texte(StatusCode::SERVICE_UNAVAILABLE, opencode::RAISON_PAR_DEFAUT);
    };
    let mut sortie = Response::builder().status(rep.status());
    if let Some(t) = rep.headers().get(header::CONTENT_TYPE) {
        sortie = sortie.header(header::CONTENT_TYPE, t);
    }
    sortie
        .body(axum::body::Body::from_stream(rep.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
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
    let arret = shell.serveur_arrete();
    let mut raison = String::new();
    if shell.est_claude() && !arret {
        // Le code de l'enfant peut arriver un instant après la fin de l'affichage.
        for _ in 0..100 {
            if let Some(c) = shell.code_sortie() {
                raison = format!("code={c}");
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
    let close = Message::Close(Some(CloseFrame {
        code: if arret { 1001 } else { 1000 },
        reason: raison.into(),
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
    dossier: PathBuf,
    f: impl FnOnce(&Path) -> Result<T, git::Erreur> + Send + 'static,
) -> Result<T, git::Erreur> {
    tokio::task::spawn_blocking(move || f(&dossier))
        .await
        .unwrap_or_else(|e| Err(git::Erreur::Git(e.to_string())))
}

/// Worktree demandé par `worktree=` : son dossier et son chemin depuis le projet
/// (`""` pour le projet). Inconnu : 400, rien n'est lancé.
async fn cible_git(etat: &Etat, q: &HashMap<String, String>) -> Option<(PathBuf, String)> {
    let demande = param(q, "worktree").to_string();
    if demande.is_empty() {
        return Some((etat.projet_dir.clone(), String::new()));
    }
    let projet = etat.projet_dir.clone();
    let liste = tokio::task::spawn_blocking(move || depot::worktrees(&projet))
        .await
        .unwrap_or_default();
    liste
        .into_iter()
        .find(|w| w.chemin == demande)
        .map(|w| (w.dossier, w.chemin))
}

fn worktree_inconnu() -> Response {
    json(
        StatusCode::BAD_REQUEST,
        "{\"cause\":\"worktree\",\"message\":\"Ce worktree n'existe plus.\"}".to_string(),
    )
}

/// Chemin donné par la page (`<chemin>/x`) vers chemin du dossier du worktree (`x`).
fn sans_prefixe(chemin: &str, rel: String) -> Result<String, git::Erreur> {
    if chemin.is_empty() {
        return Ok(rel);
    }
    rel.strip_prefix(&format!("{chemin}/"))
        .map(str::to_string)
        .ok_or_else(|| git::Erreur::Invalide("Ce chemin n'est pas valide.".into()))
}

async fn git_etat(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let Some((dossier, chemin)) = cible_git(&etat, &q).await else {
        return worktree_inconnu();
    };
    let projet = etat.projet_dir.clone();
    let liste = tokio::task::spawn_blocking(move || depot::worktrees(&projet))
        .await
        .unwrap_or_default();
    match avec_git(dossier, git::etat).await {
        Ok(e) => {
            let worktrees: Vec<String> = liste
                .iter()
                .map(|w| {
                    format!(
                        "{{\"chemin\":{},\"nom\":{},\"branche\":{},\"detachee\":{}}}",
                        json_texte(&w.chemin),
                        json_texte(&w.nom),
                        json_texte(&w.branche),
                        w.detachee
                    )
                })
                .collect();
            let prefixe = if chemin.is_empty() {
                String::new()
            } else {
                format!("{chemin}/")
            };
            let branches: Vec<String> = e.branches.iter().map(|b| json_texte(b)).collect();
            let changements: Vec<String> = e
                .changements
                .iter()
                .map(|c| {
                    format!(
                        "{{\"chemin\":{},\"statut\":{},\"indexe\":{},\"lettre\":{}}}",
                        json_texte(&format!("{prefixe}{}", c.chemin)),
                        json_texte(c.statut),
                        c.indexe,
                        json_texte(c.lettre)
                    )
                })
                .collect();
            json(
                StatusCode::OK,
                format!(
                    "{{\"branche\":{},\"detachee\":{},\"branches\":[{}],\"changements\":[{}],\"worktrees\":[{}]}}",
                    json_texte(&e.branche),
                    e.detachee,
                    branches.join(","),
                    changements.join(","),
                    worktrees.join(",")
                ),
            )
        }
        Err(e) => erreur_git(e),
    }
}

async fn git_diff(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let Some((dossier, chemin)) = cible_git(&etat, &q).await else {
        return worktree_inconnu();
    };
    let rel = match sans_prefixe(&chemin, param(&q, "chemin").to_string()) {
        Ok(r) => r,
        Err(e) => return erreur_git(e),
    };
    match avec_git(dossier, move |p| git::diff(p, &rel)).await {
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
    let Some((dossier, chemin)) = cible_git(&etat, &q).await else {
        return worktree_inconnu();
    };
    let rel = match sans_prefixe(&chemin, param(&q, "chemin").to_string()) {
        Ok(r) => r,
        Err(e) => return erreur_git(e),
    };
    fait(avec_git(dossier, move |p| git::indexer(p, &rel)).await)
}

/// Corps : le message de commit, tel quel.
async fn git_commit(State(etat): State<Partage>, Query(q): Requete, message: String) -> Response {
    let Some((dossier, _)) = cible_git(&etat, &q).await else {
        return worktree_inconnu();
    };
    fait(avec_git(dossier, move |p| git::commit(p, &message)).await)
}

async fn git_branche(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let Some((dossier, _)) = cible_git(&etat, &q).await else {
        return worktree_inconnu();
    };
    let nom = param(&q, "nom").to_string();
    fait(avec_git(dossier, move |p| git::changer_branche(p, &nom)).await)
}

async fn git_pull(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let Some((dossier, _)) = cible_git(&etat, &q).await else {
        return worktree_inconnu();
    };
    fait(avec_git(dossier, |p| git::synchroniser(p, "pull").map(|_| ())).await)
}

async fn git_push(State(etat): State<Partage>, Query(q): Requete) -> Response {
    let Some((dossier, _)) = cible_git(&etat, &q).await else {
        return worktree_inconnu();
    };
    fait(avec_git(dossier, |p| git::synchroniser(p, "push").map(|_| ())).await)
}

async fn version_etat(State(etat): State<Partage>) -> Response {
    let (maj, installee) = match etat.version.etat_maj() {
        version::Maj::EnCours => ("encours", None),
        version::Maj::Installee(v) => ("installee", Some(v)),
        _ => ("aucune", None),
    };
    json_rep(
        StatusCode::OK,
        serde_json::json!({
            "version": version::VERSION,
            "derniere": etat.version.derniere(),
            "maj": maj,
            "installee": installee,
        }),
    )
}

/// Lance `install.sh` comme `yaide update`, une seule fois à la fois ; un second appel attend la même issue.
async fn version_maj(State(etat): State<Partage>) -> Response {
    let issue = if etat.version.demarrer_maj() {
        let sortie = tokio::task::spawn_blocking(|| {
            commande_mise_a_jour()?
                .output()
                .map_err(|e| format!("lancement de sh impossible : {e}"))
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
        let issue = match sortie {
            Ok(o) if o.status.success() => {
                let v = version::version_installee()
                    .or_else(|| etat.version.derniere())
                    .unwrap_or_default();
                version::Maj::Installee(v)
            }
            Ok(o) => version::Maj::Echec(version::raison(&String::from_utf8_lossy(&o.stderr))),
            Err(e) => version::Maj::Echec(e),
        };
        etat.version.finir_maj(issue.clone());
        issue
    } else {
        etat.version.attendre_maj().await
    };
    match issue {
        version::Maj::Echec(raison) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            raison,
        )
            .into_response(),
        _ => json_rep(StatusCode::OK, serde_json::json!({})),
    }
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

/// Réserve le port sur toutes les adresses de la machine ; s'il est occupé, essaie les 10 suivants.
pub fn ecouter(port: u16) -> Result<TcpListener, String> {
    let dernier = if port == 0 {
        0
    } else {
        port.saturating_add(10)
    };
    for p in port..=dernier {
        match TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], p))) {
            Ok(l) => {
                l.set_nonblocking(true).map_err(|e| e.to_string())?;
                return Ok(l);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {}
            Err(e) => {
                return Err(format!(
                    "le port {p} n'est pas disponible ({e}) ; choisissez-en un autre avec --port"
                ))
            }
        }
    }
    Err(format!(
        "les ports {port} à {dernier} sont occupés ; choisissez-en un autre avec --port"
    ))
}

fn json_rep(code: StatusCode, v: serde_json::Value) -> Response {
    (
        code,
        [(header::CONTENT_TYPE, "application/json")],
        v.to_string(),
    )
        .into_response()
}

/// Réponse d'une écriture de réglages : les réglages à jour, ou le refus.
fn reponse_reglages(etat: &Etat, res: Result<(), Erreur>) -> Response {
    match res {
        Ok(()) => json_rep(StatusCode::OK, etat.reglages.vue()),
        Err(Erreur::Inconnu) => StatusCode::NOT_FOUND.into_response(),
        Err(Erreur::Champs(c)) if c == ["adresse"] => json_rep(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "champ": "adresse" }),
        ),
        Err(Erreur::Champs(c)) => {
            let erreurs: Vec<_> = c
                .iter()
                .map(|c| serde_json::json!({ "champ": c }))
                .collect();
            json_rep(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "erreurs": erreurs }),
            )
        }
        Err(Erreur::Systeme(m)) => json_rep(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "erreur": m }),
        ),
    }
}

fn corps_json(corps: &Bytes) -> Option<serde_json::Value> {
    serde_json::from_slice(corps).ok()
}

fn corps_invalide() -> Response {
    texte(StatusCode::BAD_REQUEST, "Corps JSON invalide.")
}

/// Ne contacte aucun provider (AC-029-4).
async fn agent_reglages(State(etat): State<Partage>) -> Response {
    json_rep(StatusCode::OK, etat.reglages.vue())
}

async fn agent_provider(
    State(etat): State<Partage>,
    CheminUrl(id): CheminUrl<String>,
    corps: Bytes,
) -> Response {
    match corps_json(&corps) {
        Some(v) => reponse_reglages(&etat, etat.reglages.enregistrer_provider(&id, &v)),
        None => corps_invalide(),
    }
}

async fn agent_supprimer_cle(
    State(etat): State<Partage>,
    CheminUrl(id): CheminUrl<String>,
) -> Response {
    reponse_reglages(&etat, etat.reglages.supprimer_cle(&id))
}

async fn agent_profil(State(etat): State<Partage>, corps: Bytes) -> Response {
    match corps_json(&corps) {
        Some(v) => reponse_reglages(&etat, etat.reglages.enregistrer_profil(&v)),
        None => corps_invalide(),
    }
}

async fn agent_supprimer_profil(
    State(etat): State<Partage>,
    CheminUrl(id): CheminUrl<String>,
) -> Response {
    reponse_reglages(&etat, etat.reglages.supprimer_profil(&id))
}

fn reponse_mcp(fichier: &Path, r: Result<Vec<mcp::Serveur>, mcp::ErreurMcp>) -> Response {
    use mcp::ErreurMcp;
    let fichier = fichier.display().to_string();
    match r {
        Ok(l) => json_rep(
            StatusCode::OK,
            serde_json::json!({ "fichier": fichier, "serveurs": l.iter().map(mcp::Serveur::json).collect::<Vec<_>>() }),
        ),
        Err(ErreurMcp::Refus(r)) => {
            let erreurs: serde_json::Map<String, serde_json::Value> = r
                .iter()
                .map(|r| (r.champ.to_string(), r.message.into()))
                .collect();
            json_rep(
                StatusCode::UNPROCESSABLE_ENTITY,
                serde_json::json!({ "fichier": fichier, "erreurs": erreurs }),
            )
        }
        Err(ErreurMcp::Illisible(p)) => json_rep(
            StatusCode::CONFLICT,
            serde_json::json!({ "fichier": fichier, "cause": "illisible", "message": p.message, "detail": p.detail }),
        ),
        Err(ErreurMcp::Inconnu) => json_rep(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "fichier": fichier, "cause": "inconnu", "message": format!("Ce serveur n'est plus dans {fichier}.") }),
        ),
        Err(ErreurMcp::Systeme(m)) => json_rep(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "fichier": fichier, "cause": "ecriture", "message": m }),
        ),
    }
}

/// Relit le `mcp.json` de l'utilisateur ; ne crée rien.
async fn mcp_liste(State(etat): State<Partage>) -> Response {
    let fichier = etat.config.join("mcp.json");
    reponse_mcp(
        &fichier,
        mcp::lister_serveurs(&fichier).map_err(mcp::ErreurMcp::Illisible),
    )
}

/// `{ ancien?, nom, command, args: [ligne], env: [ligne NOM=valeur] }`.
async fn mcp_enregistrer(State(etat): State<Partage>, corps: Bytes) -> Response {
    let Some(v) = corps_json(&corps) else {
        return corps_invalide();
    };
    let lignes = |k: &str| -> Option<Vec<String>> {
        match &v[k] {
            serde_json::Value::Null => Some(Vec::new()),
            serde_json::Value::Array(a) => {
                a.iter().map(|x| x.as_str().map(str::to_string)).collect()
            }
            _ => None,
        }
    };
    let (Some(nom), Some(command), Some(args), Some(env)) = (
        v["nom"].as_str(),
        v["command"].as_str(),
        lignes("args"),
        lignes("env"),
    ) else {
        return corps_invalide();
    };
    let saisie = mcp::Saisie {
        nom: nom.to_string(),
        command: command.to_string(),
        args,
        env,
    };
    let fichier = etat.config.join("mcp.json");
    let f = fichier.clone();
    let ancien = v["ancien"].as_str().map(str::to_string);
    let r = tokio::task::spawn_blocking(move || {
        mcp::enregistrer_serveur(&f, ancien.as_deref(), &saisie)
    })
    .await
    .unwrap_or_else(|e| Err(mcp::ErreurMcp::Systeme(e.to_string())));
    reponse_mcp(&fichier, r)
}

async fn mcp_supprimer(State(etat): State<Partage>, CheminUrl(nom): CheminUrl<String>) -> Response {
    let fichier = etat.config.join("mcp.json");
    let f = fichier.clone();
    let r = tokio::task::spawn_blocking(move || mcp::supprimer_serveur(&f, &nom))
        .await
        .unwrap_or_else(|e| Err(mcp::ErreurMcp::Systeme(e.to_string())));
    reponse_mcp(&fichier, r)
}

async fn agents_liste(State(etat): State<Partage>) -> Response {
    json_rep(
        StatusCode::OK,
        serde_json::to_value(etat.agents.lister()).unwrap_or_default(),
    )
}

async fn agents_enregistrer(State(etat): State<Partage>, corps: Bytes) -> Response {
    let Some(v) = corps_json(&corps) else {
        return corps_invalide();
    };
    match etat.agents.enregistrer(&v) {
        Ok(a) => json_rep(StatusCode::OK, serde_json::to_value(a).unwrap_or_default()),
        Err(Erreur::Inconnu) => StatusCode::NOT_FOUND.into_response(),
        Err(Erreur::Champs(c)) => {
            let erreurs: Vec<_> = c
                .iter()
                .map(|c| serde_json::json!({ "champ": c }))
                .collect();
            json_rep(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "erreurs": erreurs }),
            )
        }
        Err(Erreur::Systeme(m)) => json_rep(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "erreur": m }),
        ),
    }
}

/// `{ conversation?, profil?, agents?, texte }` : lance un tour, ou refuse (409) sans rien écrire.
/// `agents` (dossiers) ne compte qu'à la création d'une conversation ; un dossier inconnu : 400.
async fn agent_message(State(etat): State<Partage>, corps: Bytes) -> Response {
    let Some(v) = corps_json(&corps) else {
        return corps_invalide();
    };
    let Some(message) = v["texte"].as_str() else {
        return corps_invalide();
    };
    let profil = v["profil"].as_str().unwrap_or("");
    if message.trim().is_empty() {
        return texte(StatusCode::BAD_REQUEST, "Message vide.");
    }
    let conversation = v["conversation"].as_str();
    let mut agents = Vec::new();
    if conversation.is_none() {
        for d in v["agents"].as_array().into_iter().flatten() {
            match d.as_str().and_then(|d| etat.agents.lire(d)) {
                Some(a) => agents.push(a),
                None => return texte(StatusCode::BAD_REQUEST, "Agent inconnu."),
            }
        }
    }
    match etat
        .agent
        .envoyer_avec(conversation, profil, &agents, message)
    {
        Ok(id) => json_rep(StatusCode::OK, serde_json::json!({ "conversation": id })),
        Err(ErreurEnvoi::Refus(r)) => json_rep(
            StatusCode::CONFLICT,
            serde_json::json!({ "refus": r.motif, "provider": r.provider }),
        ),
        Err(ErreurEnvoi::Inconnue) => StatusCode::NOT_FOUND.into_response(),
        Err(ErreurEnvoi::Systeme(m)) => json_rep(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "erreur": m }),
        ),
    }
}

async fn agent_conversations(State(etat): State<Partage>) -> Response {
    json_rep(StatusCode::OK, etat.agent.liste())
}

async fn agent_conversation(
    State(etat): State<Partage>,
    CheminUrl(id): CheminUrl<String>,
    Query(q): Requete,
) -> Response {
    let depuis = param(&q, "depuis").parse().unwrap_or(0);
    match etat.agent.lire(&id, depuis) {
        Some(v) => json_rep(StatusCode::OK, v),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn agent_arreter(State(etat): State<Partage>, CheminUrl(id): CheminUrl<String>) -> Response {
    if etat.agent.arreter(&id) {
        json_rep(StatusCode::OK, serde_json::json!({}))
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
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
    let reglages = Arc::new(Reglages::new(config.to_path_buf(), config.to_path_buf()));
    reglages.reprendre_du_projet(&projet.join(".yaide"));
    mcp::reprendre_du_projet(&config.join("mcp.json"), &projet.join(".yaide/mcp.json"));
    let agents = Arc::new(Agents::new(projet.join(".yaide"), reglages.clone()));
    let agent = Arc::new(Gestionnaire::new(
        projet.to_path_buf(),
        reglages.clone(),
        agents.clone(),
        Limites::default(),
    ));
    let agent_arret = agent.clone();
    let etat: Partage = Arc::new(Etat {
        config: config.to_path_buf(),
        projet: projet.display().to_string(),
        limiteur: Default::default(),
        projet_dir: projet.to_path_buf(),
        instance: identifiant_instance(),
        shells: Default::default(),
        agents,
        opencode: Default::default(),
        client_opencode: reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?,
        reglages,
        agent,
        version: version::Version::new(),
    });
    let suivi = etat.clone();
    let veille = tokio::spawn(async move {
        let Ok(client) = version::client() else {
            return;
        };
        let url = version::url_releases();
        version::repeter(version::PERIODE, || async {
            if let Some(v) = version::lire_derniere(&client, &url).await {
                suivi.version.garder(v);
            }
        })
        .await;
    });
    let registre = etat.shells.clone();
    let etat_arret = etat.clone();
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
        .route("/api/version", get(version_etat))
        .route("/api/version/maj", post(version_maj))
        .route("/api/connexion", post(connexion))
        .route("/api/deconnexion", post(deconnexion))
        .route("/api/session", get(session))
        .route("/api/shells", get(liste_shells).post(ouvrir_shell))
        .route("/api/claude", get(claude_disponible).post(ouvrir_claude))
        .route("/api/opencode", get(opencode_disponible))
        .route("/api/opencode/api/{*chemin}", any(relais_opencode))
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
        .route("/api/agent/reglages", get(agent_reglages))
        .route("/api/agent/providers/{id}", put(agent_provider))
        .route("/api/agent/providers/{id}/cle", delete(agent_supprimer_cle))
        .route("/api/agent/profils", put(agent_profil))
        .route("/api/agent/profils/{id}", delete(agent_supprimer_profil))
        .route(
            "/api/agent/agents",
            get(agents_liste).put(agents_enregistrer),
        )
        .route("/api/agent/mcp", get(mcp_liste))
        .route("/api/agent/mcp/serveurs", put(mcp_enregistrer))
        .route("/api/agent/mcp/serveurs/{nom}", delete(mcp_supprimer))
        .route("/api/agent/messages", post(agent_message))
        .route("/api/agent/conversations", get(agent_conversations))
        .route("/api/agent/conversations/{id}", get(agent_conversation))
        .route("/api/agent/conversations/{id}/arreter", post(agent_arreter))
        .route("/api/git/etat", get(git_etat))
        .route("/api/git/diff", get(git_diff))
        .route("/api/git/indexer", post(git_indexer))
        .route("/api/git/commit", post(git_commit))
        .route("/api/git/branche", post(git_branche))
        .route("/api/git/pull", post(git_pull))
        .route("/api/git/push", post(git_push))
        .layer(middleware::from_fn_with_state(etat.clone(), garde))
        .with_state(etat);
    let serveur = axum_server::from_tcp(listener)
        .acceptor(
            axum_server::tls_rustls::RustlsAcceptor::new(tls)
                .acceptor(axum_server::accept::NoDelayAcceptor::new()),
        )
        .serve(app.into_make_service());
    tokio::select! {
        r = serveur => r.map_err(|e| format!("le serveur s'est arrêté : {e}")),
        _ = arret() => {
            veille.abort();
            etat_arret.opencode.arreter().await;
            agent_arret.arreter_mcp().await;
            registre.arreter().await;
            Ok(())
        }
    }
}

/// Vrai si SIGHUP est ignoré dès le lancement (`nohup yaide`).
fn sighup_ignore() -> bool {
    // SAFETY : sigaction ne fait ici que lire la disposition courante (nouvelle action nulle).
    unsafe {
        let mut ancien: libc::sigaction = std::mem::zeroed();
        libc::sigaction(libc::SIGHUP, std::ptr::null(), &mut ancien) == 0
            && ancien.sa_sigaction == libc::SIG_IGN
    }
}

/// Attend SIGTERM, SIGINT ou SIGHUP (sauf si SIGHUP est ignoré au lancement : il n'arrête alors rien).
async fn arret() {
    use tokio::signal::unix::{signal, SignalKind};
    // À lire avant d'enregistrer le signal : tokio remplacerait l'ignorance.
    let hup_ignore = sighup_ignore();
    let (Ok(mut term), Ok(mut int)) = (
        signal(SignalKind::terminate()),
        signal(SignalKind::interrupt()),
    ) else {
        return std::future::pending().await;
    };
    let hup = if hup_ignore {
        None
    } else {
        signal(SignalKind::hangup()).ok()
    };
    let hup = async {
        match hup {
            Some(mut h) => h.recv().await,
            None => std::future::pending().await,
        }
    };
    tokio::select! { _ = term.recv() => {}, _ = int.recv() => {}, _ = hup => {} }
}
