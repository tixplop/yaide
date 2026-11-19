//! Lecture des réponses en flux (Server-Sent Events) des providers (DEC-098).

use super::provider::{cause, lire_arguments, Appel, ErreurProvider, Format, Progres, Reponse};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const COUPE: &str = "la réponse s'est arrêtée avant sa fin";

/// Une ligne `data` d'un événement fini : `Ok(true)` quand le flux est fini.
trait Lecteur {
    fn evenement(
        &mut self,
        donnees: &str,
        suivi: &mut (dyn FnMut(Progres) + Send),
    ) -> Result<bool, ErreurProvider>;
    fn finir(self) -> Option<Reponse>;
}

pub async fn lire(
    reponse: reqwest::Response,
    format: Format,
    suivi: &mut (dyn FnMut(Progres) + Send),
) -> Result<Reponse, ErreurProvider> {
    match format {
        Format::OpenAI => lire_flux(reponse, OpenAI::default(), suivi).await,
        Format::Anthropic => lire_flux(reponse, Anthropic::default(), suivi).await,
    }
}

async fn lire_flux<L: Lecteur>(
    mut reponse: reqwest::Response,
    mut lecteur: L,
    suivi: &mut (dyn FnMut(Progres) + Send),
) -> Result<Reponse, ErreurProvider> {
    let mut tampon: Vec<u8> = Vec::new();
    let mut donnees: Vec<String> = Vec::new();
    loop {
        let morceau = match reponse.chunk().await.map_err(|e| {
            ErreurProvider::Injoignable(format!(
                "la lecture de la réponse a échoué : {}",
                cause(&e)
            ))
        }) {
            Ok(Some(m)) => m,
            Ok(None) => break,
            Err(e) => return Err(e),
        };
        tampon.extend_from_slice(&morceau);
        while let Some(fin) = tampon.iter().position(|&o| o == b'\n') {
            let ligne: Vec<u8> = tampon.drain(..=fin).collect();
            let ligne = String::from_utf8_lossy(&ligne);
            if ligne_traitee(ligne.trim_end_matches(['\n', '\r']), &mut donnees) {
                let evenement = donnees.join("\n");
                donnees.clear();
                if lecteur.evenement(&evenement, suivi)? {
                    return lecteur.finir().ok_or_else(coupe);
                }
            }
        }
    }
    // Dernière ligne ou dernier événement sans fin de ligne.
    if !tampon.is_empty() {
        let ligne = String::from_utf8_lossy(&tampon).into_owned();
        ligne_traitee(ligne.trim_end_matches('\r'), &mut donnees);
    }
    if !donnees.is_empty() && lecteur.evenement(&donnees.join("\n"), suivi)? {
        return lecteur.finir().ok_or_else(coupe);
    }
    lecteur.finir().ok_or_else(coupe)
}

fn coupe() -> ErreurProvider {
    ErreurProvider::Injoignable(COUPE.into())
}

/// Range une ligne ; vrai si c'est la ligne vide qui finit un événement non vide.
fn ligne_traitee(ligne: &str, donnees: &mut Vec<String>) -> bool {
    if ligne.is_empty() {
        return !donnees.is_empty();
    }
    if let Some(d) = ligne.strip_prefix("data:") {
        donnees.push(d.strip_prefix(' ').unwrap_or(d).to_string());
    }
    false
}

fn a_du_texte(s: &str) -> bool {
    s.chars().any(|c| !c.is_whitespace())
}

#[derive(Default)]
struct OpenAI {
    texte: String,
    raisonnement: String,
    appels: BTreeMap<u64, (String, String, String)>,
    tokens: u64,
    fini: bool,
    repond: bool,
}

impl Lecteur for OpenAI {
    fn evenement(
        &mut self,
        donnees: &str,
        suivi: &mut (dyn FnMut(Progres) + Send),
    ) -> Result<bool, ErreurProvider> {
        if donnees.trim() == "[DONE]" {
            self.fini = true;
            return Ok(true);
        }
        let Ok(v) = serde_json::from_str::<Value>(donnees) else {
            return Ok(false);
        };
        if v.get("error").is_some_and(|e| !e.is_null()) {
            return Err(ErreurProvider::Interrompue {
                corps: donnees.to_string(),
            });
        }
        if v.get("usage").is_some_and(Value::is_object) {
            self.tokens = v
                .pointer("/usage/prompt_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                + v.pointer("/usage/completion_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
        }
        if v.pointer("/choices/0/finish_reason")
            .is_some_and(|f| !f.is_null())
        {
            self.fini = true;
        }
        let delta = &v["choices"][0]["delta"];
        let raisonne = match delta["reasoning_content"].as_str() {
            Some(r) => r,
            None => delta["reasoning"].as_str().unwrap_or(""),
        };
        if !raisonne.is_empty() {
            self.raisonnement.push_str(raisonne);
            if a_du_texte(&self.raisonnement) {
                suivi(Progres::Raisonne(self.raisonnement.clone()));
            }
        }
        let mut repond = false;
        if let Some(t) = delta["content"].as_str().filter(|t| !t.is_empty()) {
            self.texte.push_str(t);
            repond = true;
        }
        if let Some(liste) = delta["tool_calls"].as_array() {
            for a in liste {
                let index = a["index"].as_u64().unwrap_or(0);
                let e = self.appels.entry(index).or_default();
                if let Some(id) = a["id"].as_str().filter(|s| !s.is_empty()) {
                    e.0 = id.to_string();
                }
                if let Some(nom) = a.pointer("/function/name").and_then(Value::as_str) {
                    if e.1.is_empty() {
                        e.1 = nom.to_string();
                    }
                }
                if let Some(args) = a.pointer("/function/arguments").and_then(Value::as_str) {
                    e.2.push_str(args);
                }
                repond = true;
            }
        }
        if repond && !self.repond {
            self.repond = true;
            suivi(Progres::Repond);
        }
        Ok(false)
    }

    fn finir(self) -> Option<Reponse> {
        if !self.fini {
            return None;
        }
        let appels = self
            .appels
            .into_values()
            .map(|(id, nom, args)| Appel {
                id,
                nom,
                arguments: lire_arguments(if args.is_empty() { "{}" } else { &args }),
            })
            .collect();
        Some(Reponse {
            texte: self.texte,
            raisonnement: self.raisonnement,
            blocs: Vec::new(),
            appels,
            tokens: self.tokens,
        })
    }
}

enum Bloc {
    Texte(String),
    Pensee {
        texte: String,
        signature: String,
    },
    Cache(Value),
    Outil {
        id: String,
        nom: String,
        json: String,
    },
}

#[derive(Default)]
struct Anthropic {
    blocs: BTreeMap<u64, Bloc>,
    entree: u64,
    sortie: u64,
    fini: bool,
    repond: bool,
}

impl Lecteur for Anthropic {
    fn evenement(
        &mut self,
        donnees: &str,
        suivi: &mut (dyn FnMut(Progres) + Send),
    ) -> Result<bool, ErreurProvider> {
        let Ok(v) = serde_json::from_str::<Value>(donnees) else {
            return Ok(false);
        };
        let index = v["index"].as_u64().unwrap_or(0);
        match v["type"].as_str() {
            Some("error") => {
                return Err(ErreurProvider::Interrompue {
                    corps: donnees.to_string(),
                })
            }
            Some("message_start") => {
                self.entree = v
                    .pointer("/message/usage/input_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                self.sortie = v
                    .pointer("/message/usage/output_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
            }
            Some("message_delta") => {
                if let Some(n) = v.pointer("/usage/input_tokens").and_then(Value::as_u64) {
                    self.entree = n;
                }
                if let Some(n) = v.pointer("/usage/output_tokens").and_then(Value::as_u64) {
                    self.sortie = n;
                }
            }
            Some("message_stop") => {
                self.fini = true;
                return Ok(true);
            }
            Some("content_block_start") => {
                let b = &v["content_block"];
                let s = |c: &str| b[c].as_str().unwrap_or("").to_string();
                let bloc = match b["type"].as_str() {
                    Some("text") => Bloc::Texte(s("text")),
                    Some("thinking") => Bloc::Pensee {
                        texte: s("thinking"),
                        signature: s("signature"),
                    },
                    Some("redacted_thinking") => Bloc::Cache(b.clone()),
                    Some("tool_use") => Bloc::Outil {
                        id: s("id"),
                        nom: s("name"),
                        json: String::new(),
                    },
                    _ => return Ok(false),
                };
                let outil = matches!(bloc, Bloc::Outil { .. });
                self.blocs.insert(index, bloc);
                if outil {
                    self.repondre(suivi);
                }
            }
            Some("content_block_delta") => {
                let d = &v["delta"];
                let chaine = |c: &str| d[c].as_str().unwrap_or("");
                match (d["type"].as_str(), self.blocs.get_mut(&index)) {
                    (Some("text_delta"), Some(Bloc::Texte(t))) => {
                        t.push_str(chaine("text"));
                        if !chaine("text").is_empty() {
                            self.repondre(suivi);
                        }
                    }
                    (Some("thinking_delta"), Some(Bloc::Pensee { texte, .. })) => {
                        texte.push_str(chaine("thinking"));
                        if !chaine("thinking").is_empty() {
                            let tout = self.raisonnement();
                            if a_du_texte(&tout) {
                                suivi(Progres::Raisonne(tout));
                            }
                        }
                    }
                    (Some("signature_delta"), Some(Bloc::Pensee { signature, .. })) => {
                        signature.push_str(chaine("signature"));
                    }
                    (Some("input_json_delta"), Some(Bloc::Outil { json, .. })) => {
                        json.push_str(chaine("partial_json"));
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        Ok(false)
    }

    fn finir(self) -> Option<Reponse> {
        if !self.fini {
            return None;
        }
        let raisonnement = self.raisonnement();
        let mut texte = String::new();
        let mut appels = Vec::new();
        let mut gardes = Vec::new();
        for bloc in self.blocs.into_values() {
            match bloc {
                Bloc::Texte(t) => texte.push_str(&t),
                Bloc::Pensee { texte, signature } => gardes
                    .push(json!({"type": "thinking", "thinking": texte, "signature": signature})),
                Bloc::Cache(b) => gardes.push(b),
                Bloc::Outil { id, nom, json } => appels.push(Appel {
                    id,
                    nom,
                    arguments: if json.is_empty() {
                        json!({})
                    } else {
                        lire_arguments(&json)
                    },
                }),
            }
        }
        Some(Reponse {
            texte,
            raisonnement,
            blocs: gardes,
            appels,
            tokens: self.entree + self.sortie,
        })
    }
}

impl Anthropic {
    fn repondre(&mut self, suivi: &mut (dyn FnMut(Progres) + Send)) {
        if !self.repond {
            self.repond = true;
            suivi(Progres::Repond);
        }
    }

    fn raisonnement(&self) -> String {
        self.blocs
            .values()
            .filter_map(|b| match b {
                Bloc::Pensee { texte, .. } => Some(texte.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::super::provider::{
        client, envoyer, lire_anthropic, lire_openai, DefOutil, Message, Provider, Reglage,
    };
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Faux provider : répond aux requêtes par les morceaux donnés, puis ferme la connexion.
    async fn faux(type_contenu: &str, morceaux: Vec<String>) -> (String, Arc<Mutex<Vec<Value>>>) {
        let corps_recus = Arc::new(Mutex::new(Vec::new()));
        let ecoute = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let adresse = format!("http://{}", ecoute.local_addr().unwrap());
        let (recus, ct) = (corps_recus.clone(), type_contenu.to_string());
        tokio::spawn(async move {
            loop {
                let (mut s, _) = ecoute.accept().await.unwrap();
                let (recus, ct, morceaux) = (recus.clone(), ct.clone(), morceaux.clone());
                tokio::spawn(async move {
                    let mut tampon = Vec::new();
                    let mut buf = [0u8; 4096];
                    let (fin, longueur) = loop {
                        let n = s.read(&mut buf).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        tampon.extend_from_slice(&buf[..n]);
                        let texte = String::from_utf8_lossy(&tampon).to_lowercase();
                        if let Some(p) = texte.find("\r\n\r\n") {
                            let l = texte
                                .lines()
                                .find_map(|l| l.strip_prefix("content-length: "))
                                .and_then(|l| l.trim().parse::<usize>().ok())
                                .unwrap_or(0);
                            break (p + 4, l);
                        }
                    };
                    while tampon.len() < fin + longueur {
                        let n = s.read(&mut buf).await.unwrap();
                        tampon.extend_from_slice(&buf[..n]);
                    }
                    recus
                        .lock()
                        .unwrap()
                        .push(serde_json::from_slice(&tampon[fin..]).unwrap_or(Value::Null));
                    let tete = format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: {ct}\r\nconnection: close\r\n\r\n"
                    );
                    s.write_all(tete.as_bytes()).await.unwrap();
                    for m in morceaux {
                        s.write_all(m.as_bytes()).await.unwrap();
                        s.flush().await.unwrap();
                        tokio::time::sleep(std::time::Duration::from_millis(15)).await;
                    }
                    let _ = s.shutdown().await;
                });
            }
        });
        (adresse, corps_recus)
    }

    fn sse(evenements: &[Value]) -> Vec<String> {
        evenements
            .iter()
            .map(|e| format!("data: {e}\n\n"))
            .collect()
    }

    async fn appeler(
        p: Provider,
        adresse: &str,
        outils: &[DefOutil],
    ) -> (Result<Reponse, ErreurProvider>, Vec<Progres>) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let r = Reglage {
            modele: "m".into(),
            effort: None,
            sortie_max: None,
            temperature: None,
        };
        let mut vus = Vec::new();
        let res = envoyer(
            &client(),
            p,
            adresse,
            None,
            &r,
            "",
            &[Message::Utilisateur("lis".into())],
            outils,
            &mut |p| vus.push(p),
        )
        .await;
        (res, vus)
    }

    fn lecture_args() -> Value {
        json!({"path": "README.md"})
    }

    #[tokio::test]
    async fn REQ085_AC9_openai_flux_egal_a_la_reponse_entiere() {
        let mut morceaux = sse(&[
            json!({"choices": [{"delta": {"reasoning_content": "  "}}]}),
            json!({"choices": [{"delta": {"reasoning_content": "Je "}}]}),
            json!({"choices": [{"delta": {"reasoning_content": "lis"}}]}),
            json!({"choices": [{"delta": {"content": "Voi"}}]}),
            json!({"choices": [{"delta": {"content": "ci"}}]}),
            json!({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "read", "arguments": ""}}]}}]}),
            json!({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "{\"path\":"}}]}}]}),
            json!({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": " \"READ"}}]}}]}),
            json!({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "ME.md\"}"}}]}}]}),
            json!({"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}),
            json!({"choices": [], "usage": {"prompt_tokens": 3, "completion_tokens": 4}}),
        ]);
        morceaux.push("data: [DONE]\n\n".into());
        // Un événement coupé en deux morceaux de réseau, avec des commentaires et `event:`.
        morceaux.insert(0, ": commentaire\n\nevent: message\ndat".into());
        morceaux.insert(1, "a: {\"choices\": []}\r\n\r\n".into());
        let (a, recus) = faux("text/event-stream; charset=utf-8", morceaux).await;
        let (res, vus) = appeler(Provider::OpenAI, &a, &[]).await;
        let entiere = lire_openai(&json!({
            "choices": [{"message": {"content": "Voici", "reasoning_content": "  Je lis",
                "tool_calls": [{"id": "c1", "function": {"name": "read", "arguments": "{\"path\": \"README.md\"}"}}]}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 4}
        }))
        .unwrap();
        let res = res.unwrap();
        assert_eq!(res, entiere);
        assert_eq!(res.appels[0].arguments, lecture_args());
        assert_eq!(res.tokens, 7);
        assert_eq!(
            vus,
            vec![
                Progres::Raisonne("  Je ".into()),
                Progres::Raisonne("  Je lis".into()),
                Progres::Repond
            ]
        );
        let c = recus.lock().unwrap();
        assert_eq!(c[0]["stream"], true);
        assert_eq!(c[0]["stream_options"], json!({"include_usage": true}));
    }

    #[tokio::test]
    async fn REQ085_AC9_openai_reasoning_seul_et_raisonnement_d_espaces() {
        let mut m = sse(&[
            json!({"choices": [{"delta": {"reasoning": " \n"}}]}),
            json!({"choices": [{"delta": {"reasoning": "idée"}}]}),
            json!({"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}),
        ]);
        m.insert(0, "event: ping\n\n".into());
        let (a, _) = faux("text/event-stream", m).await;
        let (res, vus) = appeler(Provider::Ollama, &a, &[]).await;
        let res = res.unwrap();
        assert_eq!(res.raisonnement, " \nidée");
        assert_eq!(res.texte, "ok");
        assert_eq!(
            vus,
            vec![Progres::Raisonne(" \nidée".into()), Progres::Repond]
        );

        let (a, _) = faux(
            "text/event-stream",
            sse(&[json!({"choices": [{"delta": {"reasoning_content": "  \n "}}]})]),
        )
        .await;
        let (res, vus) = appeler(Provider::OpenAI, &a, &[]).await;
        assert!(res.is_err());
        assert!(vus.is_empty());
    }

    #[tokio::test]
    async fn REQ085_AC9_anthropic_flux_egal_a_la_reponse_entiere() {
        let m = sse(&[
            json!({"type": "message_start", "message": {"usage": {"input_tokens": 5, "output_tokens": 1}}}),
            json!({"type": "ping"}),
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Je "}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "lis"}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "sig-1"}}),
            json!({"type": "content_block_stop", "index": 0}),
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "redacted_thinking", "data": "xyz"}}),
            json!({"type": "content_block_stop", "index": 1}),
            json!({"type": "content_block_start", "index": 2, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 2, "delta": {"type": "text_delta", "text": "Voi"}}),
            json!({"type": "content_block_delta", "index": 2, "delta": {"type": "text_delta", "text": "ci"}}),
            json!({"type": "content_block_stop", "index": 2}),
            json!({"type": "content_block_start", "index": 3, "content_block": {"type": "tool_use", "id": "t1", "name": "read", "input": {}}}),
            json!({"type": "content_block_delta", "index": 3, "delta": {"type": "input_json_delta", "partial_json": ""}}),
            json!({"type": "content_block_delta", "index": 3, "delta": {"type": "input_json_delta", "partial_json": "{\"path\": \"RE"}}),
            json!({"type": "content_block_delta", "index": 3, "delta": {"type": "input_json_delta", "partial_json": "ADME.md\"}"}}),
            json!({"type": "content_block_stop", "index": 3}),
            json!({"type": "content_block_start", "index": 4, "content_block": {"type": "tool_use", "id": "t2", "name": "ls", "input": {}}}),
            json!({"type": "content_block_stop", "index": 4}),
            json!({"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 6}}),
            json!({"type": "message_stop"}),
        ]);
        let (a, recus) = faux("text/event-stream", m).await;
        let (res, vus) = appeler(Provider::Anthropic, &a, &[]).await;
        let entiere = lire_anthropic(&json!({
            "content": [
                {"type": "thinking", "thinking": "Je lis", "signature": "sig-1"},
                {"type": "redacted_thinking", "data": "xyz"},
                {"type": "text", "text": "Voici"},
                {"type": "tool_use", "id": "t1", "name": "read", "input": {"path": "README.md"}},
                {"type": "tool_use", "id": "t2", "name": "ls", "input": {}}],
            "usage": {"input_tokens": 5, "output_tokens": 6}
        }))
        .unwrap();
        let res = res.unwrap();
        assert_eq!(res, entiere);
        assert_eq!(res.tokens, 11);
        assert_eq!(res.blocs[0]["signature"], "sig-1");
        assert_eq!(
            vus,
            vec![
                Progres::Raisonne("Je ".into()),
                Progres::Raisonne("Je lis".into()),
                Progres::Repond
            ]
        );
        let c = recus.lock().unwrap();
        assert_eq!(c[0]["stream"], true);
        assert!(c[0].get("stream_options").is_none());
    }

    #[tokio::test]
    async fn REQ085_AC9_reponse_json_entiere_malgre_stream_lue_comme_avant() {
        let corps = json!({"choices": [{"message": {"content": "salut"}}], "usage": {"prompt_tokens": 1, "completion_tokens": 2}});
        let (a, recus) = faux("application/json", vec![corps.to_string()]).await;
        let (res, vus) = appeler(Provider::OpenAI, &a, &[]).await;
        let res = res.unwrap();
        assert_eq!((res.texte.as_str(), res.tokens), ("salut", 3));
        assert!(vus.is_empty());
        assert_eq!(recus.lock().unwrap()[0]["stream"], true);
    }

    #[tokio::test]
    async fn REQ085_AC12_erreur_anthropic_dans_le_flux_est_interrompue() {
        let ligne = json!({"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}});
        let mut m = sse(&[
            json!({"type": "message_start", "message": {"usage": {}}}),
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "dé"}}),
        ]);
        m.push(format!("event: error\ndata: {ligne}\n\n"));
        let (a, _) = faux("text/event-stream", m).await;
        match appeler(Provider::Anthropic, &a, &[]).await.0 {
            Err(ErreurProvider::Interrompue { corps }) => assert_eq!(corps, ligne.to_string()),
            autre => panic!("{autre:?}"),
        }
    }

    #[tokio::test]
    async fn REQ085_AC12_erreur_openai_dans_le_flux_est_interrompue() {
        let ligne = json!({"error": {"message": "Surcharge", "type": "server_error"}});
        let (a, _) = faux("text/event-stream", sse(std::slice::from_ref(&ligne))).await;
        match appeler(Provider::OpenAI, &a, &[]).await.0 {
            Err(ErreurProvider::Interrompue { corps }) => assert_eq!(corps, ligne.to_string()),
            autre => panic!("{autre:?}"),
        }
    }

    #[tokio::test]
    async fn REQ085_AC12_flux_coupe_avant_sa_fin_est_injoignable() {
        let (a, _) = faux(
            "text/event-stream",
            sse(&[json!({"choices": [{"delta": {"content": "dé"}}]})]),
        )
        .await;
        match appeler(Provider::OpenAI, &a, &[]).await.0 {
            Err(ErreurProvider::Injoignable(c)) => {
                assert_eq!(c, "la réponse s'est arrêtée avant sa fin")
            }
            autre => panic!("{autre:?}"),
        }
        let (a, _) = faux(
            "text/event-stream",
            sse(&[json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})]),
        )
        .await;
        assert!(matches!(
            appeler(Provider::Anthropic, &a, &[]).await.0,
            Err(ErreurProvider::Injoignable(_))
        ));
    }
}
