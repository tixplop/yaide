//! Client HTTP des providers LLM : formats OpenAI et Anthropic (DEC-031, DEC-032).

use serde_json::{json, Map, Value};
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Provider {
    OpenAI,
    Anthropic,
    Google,
    OpenRouter,
    LiteLLM,
    Ollama,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Format {
    OpenAI,
    Anthropic,
}

impl Provider {
    pub fn id(self) -> &'static str {
        match self {
            Provider::OpenAI => "openai",
            Provider::Anthropic => "anthropic",
            Provider::Google => "google",
            Provider::OpenRouter => "openrouter",
            Provider::LiteLLM => "litellm",
            Provider::Ollama => "ollama",
        }
    }

    pub fn nom(self) -> &'static str {
        match self {
            Provider::OpenAI => "OpenAI",
            Provider::Anthropic => "Anthropic",
            Provider::Google => "Google",
            Provider::OpenRouter => "OpenRouter",
            Provider::LiteLLM => "LiteLLM",
            Provider::Ollama => "Ollama",
        }
    }

    pub fn adresse_par_defaut(self) -> &'static str {
        match self {
            Provider::OpenAI => "https://api.openai.com/v1",
            Provider::Anthropic => "https://api.anthropic.com",
            Provider::Google => "https://generativelanguage.googleapis.com/v1beta/openai",
            Provider::OpenRouter => "https://openrouter.ai/api/v1",
            Provider::LiteLLM => "http://localhost:4000",
            Provider::Ollama => "http://localhost:11434/v1",
        }
    }

    pub fn cle_obligatoire(self) -> bool {
        matches!(
            self,
            Provider::OpenAI | Provider::Anthropic | Provider::Google | Provider::OpenRouter
        )
    }

    pub fn format(self) -> Format {
        match self {
            Provider::Anthropic => Format::Anthropic,
            _ => Format::OpenAI,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Effort {
    Faible,
    Moyen,
    Eleve,
}

impl Effort {
    fn texte(self) -> &'static str {
        match self {
            Effort::Faible => "low",
            Effort::Moyen => "medium",
            Effort::Eleve => "high",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Appel {
    pub id: String,
    pub nom: String,
    pub arguments: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Message {
    Utilisateur(String),
    Agent {
        texte: String,
        appels: Vec<Appel>,
        /// Blocs Anthropic `thinking` et `redacted_thinking`, renvoyés tels quels.
        blocs: Vec<Value>,
    },
    Resultat {
        id: String,
        contenu: String,
        echec: bool,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct DefOutil {
    pub nom: String,
    pub description: String,
    pub schema: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Reglage {
    pub modele: String,
    pub effort: Option<Effort>,
    pub sortie_max: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Reponse {
    pub texte: String,
    pub raisonnement: String,
    pub blocs: Vec<Value>,
    pub appels: Vec<Appel>,
    pub tokens: u64,
}

#[derive(Debug)]
pub enum ErreurProvider {
    /// Statut hors de 2xx, ou réponse 2xx illisible ; le corps est tel quel.
    Refus { code: u16, corps: String },
    /// Connexion impossible ou délai dépassé.
    Injoignable(String),
}

/// Le client partagé : 10 s pour se connecter, 600 s au total.
/// Un fournisseur rustls doit déjà être installé.
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(600))
        .build()
        .expect("client HTTP")
}

#[allow(clippy::too_many_arguments)]
pub async fn envoyer(
    client: &reqwest::Client,
    provider: Provider,
    adresse: &str,
    cle: Option<&str>,
    reglage: &Reglage,
    instructions: &str,
    messages: &[Message],
    outils: &[DefOutil],
) -> Result<Reponse, ErreurProvider> {
    let base = adresse.trim_end_matches('/');
    let (url, corps) = match provider.format() {
        Format::OpenAI => (
            format!("{base}/chat/completions"),
            corps_openai(provider, reglage, instructions, messages, outils),
        ),
        Format::Anthropic => (
            format!("{base}/v1/messages"),
            corps_anthropic(reglage, instructions, messages, outils),
        ),
    };
    let mut requete = client.post(url).json(&corps);
    if let Some(cle) = cle.filter(|c| !c.is_empty()) {
        requete = match provider.format() {
            Format::Anthropic => requete.header("x-api-key", cle),
            Format::OpenAI => requete.bearer_auth(cle),
        };
    }
    if provider.format() == Format::Anthropic {
        requete = requete.header("anthropic-version", "2023-06-01");
    }
    let reponse = requete
        .send()
        .await
        .map_err(|e| ErreurProvider::Injoignable(cause(&e)))?;
    let code = reponse.status().as_u16();
    let texte = reponse
        .text()
        .await
        .map_err(|e| ErreurProvider::Injoignable(cause(&e)))?;
    if !(200..300).contains(&code) {
        return Err(ErreurProvider::Refus { code, corps: texte });
    }
    let lu = serde_json::from_str::<Value>(&texte)
        .ok()
        .and_then(|v| match provider.format() {
            Format::OpenAI => lire_openai(&v),
            Format::Anthropic => lire_anthropic(&v),
        });
    lu.ok_or(ErreurProvider::Refus { code, corps: texte })
}

fn cause(e: &reqwest::Error) -> String {
    let mut s = e.to_string();
    let mut source = std::error::Error::source(e);
    while let Some(c) = source {
        s.push_str(" : ");
        s.push_str(&c.to_string());
        source = c.source();
    }
    s
}

/// Les arguments d'un appel : une chaîne JSON valide devient une valeur, sinon on garde la chaîne.
fn lire_arguments(brut: &str) -> Value {
    serde_json::from_str(brut).unwrap_or_else(|_| Value::String(brut.to_string()))
}

fn arguments_en_chaine(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        autre => autre.to_string(),
    }
}

fn corps_openai(
    provider: Provider,
    reglage: &Reglage,
    instructions: &str,
    messages: &[Message],
    outils: &[DefOutil],
) -> Value {
    let mut liste = Vec::new();
    if !instructions.is_empty() {
        liste.push(json!({"role": "system", "content": instructions}));
    }
    for m in messages {
        liste.push(match m {
            Message::Utilisateur(t) => json!({"role": "user", "content": t}),
            Message::Agent { texte, appels, .. } => {
                let mut o = Map::new();
                o.insert("role".into(), "assistant".into());
                o.insert("content".into(), texte.clone().into());
                if !appels.is_empty() {
                    let tc: Vec<Value> = appels
                        .iter()
                        .map(|a| {
                            json!({"id": a.id, "type": "function",
                                "function": {"name": a.nom, "arguments": arguments_en_chaine(&a.arguments)}})
                        })
                        .collect();
                    o.insert("tool_calls".into(), tc.into());
                }
                Value::Object(o)
            }
            Message::Resultat { id, contenu, .. } => {
                json!({"role": "tool", "tool_call_id": id, "content": contenu})
            }
        });
    }
    let mut c = Map::new();
    c.insert("model".into(), reglage.modele.clone().into());
    c.insert("messages".into(), liste.into());
    if !outils.is_empty() {
        let t: Vec<Value> = outils
            .iter()
            .map(|o| {
                json!({"type": "function",
                    "function": {"name": o.nom, "description": o.description, "parameters": o.schema}})
            })
            .collect();
        c.insert("tools".into(), t.into());
    }
    if let Some(e) = reglage.effort {
        c.insert("reasoning_effort".into(), e.texte().into());
    }
    if let Some(n) = reglage.sortie_max {
        let champ = if provider == Provider::OpenAI {
            "max_completion_tokens"
        } else {
            "max_tokens"
        };
        c.insert(champ.into(), n.into());
    }
    if let Some(t) = reglage.temperature {
        c.insert("temperature".into(), t.into());
    }
    Value::Object(c)
}

fn corps_anthropic(
    reglage: &Reglage,
    instructions: &str,
    messages: &[Message],
    outils: &[DefOutil],
) -> Value {
    let mut liste: Vec<Value> = Vec::new();
    let mut resultats: Vec<Value> = Vec::new();
    for m in messages {
        if let Message::Resultat { id, contenu, echec } = m {
            let mut b = json!({"type": "tool_result", "tool_use_id": id, "content": contenu});
            if *echec {
                b["is_error"] = true.into();
            }
            resultats.push(b);
            continue;
        }
        if !resultats.is_empty() {
            liste.push(json!({"role": "user", "content": std::mem::take(&mut resultats)}));
        }
        liste.push(match m {
            Message::Utilisateur(t) => json!({"role": "user", "content": t}),
            Message::Agent {
                texte,
                appels,
                blocs: precedents,
            } => {
                let mut blocs = precedents.clone();
                if !texte.is_empty() {
                    blocs.push(json!({"type": "text", "text": texte}));
                }
                for a in appels {
                    let entree = match &a.arguments {
                        Value::String(_) => json!({}),
                        v => v.clone(),
                    };
                    blocs.push(
                        json!({"type": "tool_use", "id": a.id, "name": a.nom, "input": entree}),
                    );
                }
                json!({"role": "assistant", "content": blocs})
            }
            Message::Resultat { .. } => unreachable!(),
        });
    }
    if !resultats.is_empty() {
        liste.push(json!({"role": "user", "content": resultats}));
    }
    let mut c = Map::new();
    c.insert("model".into(), reglage.modele.clone().into());
    c.insert(
        "max_tokens".into(),
        reglage.sortie_max.unwrap_or(8192).into(),
    );
    c.insert("messages".into(), liste.into());
    if !instructions.is_empty() {
        c.insert("system".into(), instructions.into());
    }
    if !outils.is_empty() {
        let t: Vec<Value> = outils
            .iter()
            .map(|o| json!({"name": o.nom, "description": o.description, "input_schema": o.schema}))
            .collect();
        c.insert("tools".into(), t.into());
    }
    if let Some(e) = reglage.effort {
        c.insert("output_config".into(), json!({"effort": e.texte()}));
    }
    match reglage.temperature {
        Some(t) => c.insert("temperature".into(), t.into()),
        None => c.insert(
            "thinking".into(),
            json!({"type": "adaptive", "display": "summarized"}),
        ),
    };
    Value::Object(c)
}

fn lire_openai(v: &Value) -> Option<Reponse> {
    let message = v.pointer("/choices/0/message")?;
    let texte = message["content"].as_str().unwrap_or("").to_string();
    let appels = message["tool_calls"]
        .as_array()
        .map(|liste| {
            liste
                .iter()
                .map(|a| Appel {
                    id: a["id"].as_str().unwrap_or("").to_string(),
                    nom: a
                        .pointer("/function/name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    arguments: lire_arguments(
                        a.pointer("/function/arguments")
                            .and_then(Value::as_str)
                            .unwrap_or("{}"),
                    ),
                })
                .collect()
        })
        .unwrap_or_default();
    let raisonnement = match message["reasoning_content"].as_str() {
        Some(r) => r,
        None => message["reasoning"].as_str().unwrap_or(""),
    }
    .to_string();
    let tokens = v
        .pointer("/usage/prompt_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        + v.pointer("/usage/completion_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
    Some(Reponse {
        texte,
        raisonnement,
        blocs: Vec::new(),
        appels,
        tokens,
    })
}

fn lire_anthropic(v: &Value) -> Option<Reponse> {
    let blocs = v["content"].as_array()?;
    let mut texte = String::new();
    let mut appels = Vec::new();
    let mut pensees: Vec<&str> = Vec::new();
    let mut gardes = Vec::new();
    for b in blocs {
        match b["type"].as_str() {
            Some("thinking") => {
                pensees.push(b["thinking"].as_str().unwrap_or(""));
                gardes.push(b.clone());
            }
            Some("redacted_thinking") => gardes.push(b.clone()),
            Some("text") => texte.push_str(b["text"].as_str().unwrap_or("")),
            Some("tool_use") => appels.push(Appel {
                id: b["id"].as_str().unwrap_or("").to_string(),
                nom: b["name"].as_str().unwrap_or("").to_string(),
                arguments: b["input"].clone(),
            }),
            _ => {}
        }
    }
    let tokens = v
        .pointer("/usage/input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        + v.pointer("/usage/output_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
    Some(Reponse {
        texte,
        raisonnement: pensees.join("\n\n"),
        blocs: gardes,
        appels,
        tokens,
    })
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use axum::{
        body::Bytes,
        extract::State,
        http::{HeaderMap, StatusCode, Uri},
        Router,
    };
    use std::sync::{Arc, Mutex};

    struct Recue {
        chemin: String,
        entetes: HeaderMap,
        corps: Value,
    }

    #[derive(Clone)]
    struct Faux {
        recues: Arc<Mutex<Vec<Recue>>>,
        statut: u16,
        reponse: String,
    }

    async fn gerer(
        State(f): State<Faux>,
        uri: Uri,
        h: HeaderMap,
        corps: Bytes,
    ) -> (StatusCode, String) {
        f.recues.lock().unwrap().push(Recue {
            chemin: uri.path().to_string(),
            entetes: h,
            corps: serde_json::from_slice(&corps).unwrap_or(Value::Null),
        });
        (StatusCode::from_u16(f.statut).unwrap(), f.reponse.clone())
    }

    async fn faux(statut: u16, reponse: Value) -> (String, Arc<Mutex<Vec<Recue>>>) {
        let recues = Arc::new(Mutex::new(Vec::new()));
        let etat = Faux {
            recues: recues.clone(),
            statut,
            reponse: reponse.to_string(),
        };
        let app = Router::new().fallback(gerer).with_state(etat);
        let ecoute = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let adresse = format!("http://{}", ecoute.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(ecoute, app).await.unwrap() });
        (adresse, recues)
    }

    fn nouveau_client() -> reqwest::Client {
        let _ = rustls::crypto::ring::default_provider().install_default();
        client()
    }

    fn reglage() -> Reglage {
        Reglage {
            modele: "m".into(),
            effort: None,
            sortie_max: None,
            temperature: None,
        }
    }

    fn ok_openai() -> Value {
        json!({"choices": [{"message": {"content": "salut"}}], "usage": {"prompt_tokens": 3, "completion_tokens": 4}})
    }

    fn ok_anthropic() -> Value {
        json!({"content": [{"type": "text", "text": "salut"}], "usage": {"input_tokens": 5, "output_tokens": 6}})
    }

    async fn appeler(
        p: Provider,
        adresse: &str,
        cle: Option<&str>,
        r: &Reglage,
        messages: &[Message],
        outils: &[DefOutil],
    ) -> Result<Reponse, ErreurProvider> {
        envoyer(
            &nouveau_client(),
            p,
            adresse,
            cle,
            r,
            "sois bref",
            messages,
            outils,
        )
        .await
    }

    fn bonjour() -> Vec<Message> {
        vec![Message::Utilisateur("bonjour".into())]
    }

    #[tokio::test]
    async fn REQ052_AC7_cle_bearer_ou_x_api_key_et_sans_cle_aucun_en_tete() {
        let (a, recues) = faux(200, ok_openai()).await;
        appeler(
            Provider::OpenAI,
            &a,
            Some("sk-1"),
            &reglage(),
            &bonjour(),
            &[],
        )
        .await
        .unwrap();
        appeler(Provider::Ollama, &a, None, &reglage(), &bonjour(), &[])
            .await
            .unwrap();
        {
            let r = recues.lock().unwrap();
            assert_eq!(r[0].entetes["authorization"], "Bearer sk-1");
            assert!(r[0].entetes.get("x-api-key").is_none());
            assert!(r[1].entetes.get("authorization").is_none());
            assert!(r[1].entetes.get("x-api-key").is_none());
        }

        let (a, recues) = faux(200, ok_anthropic()).await;
        appeler(
            Provider::Anthropic,
            &a,
            Some("ak-1"),
            &reglage(),
            &bonjour(),
            &[],
        )
        .await
        .unwrap();
        let r = recues.lock().unwrap();
        assert_eq!(r[0].entetes["x-api-key"], "ak-1");
        assert_eq!(r[0].entetes["anthropic-version"], "2023-06-01");
        assert!(r[0].entetes.get("authorization").is_none());
    }

    #[tokio::test]
    async fn REQ053_AC5_openai_porte_modele_effort_sortie_temperature() {
        let r = Reglage {
            modele: "gpt-x".into(),
            effort: Some(Effort::Eleve),
            sortie_max: Some(1000),
            temperature: Some(0.5),
        };
        let (a, recues) = faux(200, ok_openai()).await;
        appeler(Provider::OpenAI, &a, Some("k"), &r, &bonjour(), &[])
            .await
            .unwrap();
        appeler(Provider::Ollama, &a, None, &r, &bonjour(), &[])
            .await
            .unwrap();
        let recues = recues.lock().unwrap();
        assert_eq!(recues[0].chemin, "/chat/completions");
        let c = &recues[0].corps;
        assert_eq!(c["model"], "gpt-x");
        assert_eq!(c["reasoning_effort"], "high");
        assert_eq!(c["max_completion_tokens"], 1000);
        assert!(c.get("max_tokens").is_none());
        assert_eq!(c["temperature"], 0.5);
        assert_eq!(
            c["messages"][0],
            json!({"role": "system", "content": "sois bref"})
        );
        let c = &recues[1].corps;
        assert_eq!(c["max_tokens"], 1000);
        assert!(c.get("max_completion_tokens").is_none());
    }

    #[tokio::test]
    async fn REQ053_AC5_anthropic_porte_output_config_et_8192_par_defaut() {
        let (a, recues) = faux(200, ok_anthropic()).await;
        let r = Reglage {
            modele: "claude-x".into(),
            effort: Some(Effort::Moyen),
            sortie_max: None,
            temperature: Some(1.0),
        };
        appeler(Provider::Anthropic, &a, Some("k"), &r, &bonjour(), &[])
            .await
            .unwrap();
        let r2 = Reglage {
            sortie_max: Some(300),
            ..r
        };
        appeler(Provider::Anthropic, &a, Some("k"), &r2, &bonjour(), &[])
            .await
            .unwrap();
        let recues = recues.lock().unwrap();
        assert_eq!(recues[0].chemin, "/v1/messages");
        let c = &recues[0].corps;
        assert_eq!(c["model"], "claude-x");
        assert_eq!(c["output_config"], json!({"effort": "medium"}));
        assert_eq!(c["max_tokens"], 8192);
        assert_eq!(c["system"], "sois bref");
        assert_eq!(c["temperature"], 1.0);
        assert_eq!(recues[1].corps["max_tokens"], 300);
    }

    #[tokio::test]
    async fn REQ053_AC5_champs_vides_absents_du_json() {
        let (a, recues) = faux(200, ok_openai()).await;
        appeler(Provider::OpenAI, &a, Some("k"), &reglage(), &bonjour(), &[])
            .await
            .unwrap();
        let (b, recues_b) = faux(200, ok_anthropic()).await;
        appeler(
            Provider::Anthropic,
            &b,
            Some("k"),
            &reglage(),
            &bonjour(),
            &[],
        )
        .await
        .unwrap();
        let c = recues.lock().unwrap()[0].corps.clone();
        for champ in [
            "reasoning_effort",
            "max_tokens",
            "max_completion_tokens",
            "temperature",
            "tools",
        ] {
            assert!(c.get(champ).is_none(), "{champ}");
        }
        let c = recues_b.lock().unwrap()[0].corps.clone();
        for champ in ["output_config", "temperature", "tools"] {
            assert!(c.get(champ).is_none(), "{champ}");
        }
    }

    fn outil() -> DefOutil {
        DefOutil {
            nom: "lire".into(),
            description: "Lit un fichier".into(),
            schema: json!({"type": "object", "properties": {"chemin": {"type": "string"}}}),
        }
    }

    fn historique() -> Vec<Message> {
        let a = |id: &str| Appel {
            id: id.into(),
            nom: "lire".into(),
            arguments: json!({"chemin": id}),
        };
        vec![
            Message::Utilisateur("lis a et b".into()),
            Message::Agent {
                texte: "je lis".into(),
                appels: vec![a("a"), a("b")],
                blocs: Vec::new(),
            },
            Message::Resultat {
                id: "a".into(),
                contenu: "AA".into(),
                echec: false,
            },
            Message::Resultat {
                id: "b".into(),
                contenu: "erreur".into(),
                echec: true,
            },
        ]
    }

    #[tokio::test]
    async fn REQ055_AC4_openai_appel_d_outil_puis_resultat_relu() {
        let rep = json!({"choices": [{"message": {"content": null, "tool_calls": [
            {"id": "c1", "type": "function", "function": {"name": "lire", "arguments": "{\"chemin\":\"x\"}"}},
            {"id": "c2", "type": "function", "function": {"name": "lire", "arguments": "pas du json"}}
        ]}}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}});
        let (a, recues) = faux(200, rep).await;
        let r = appeler(
            Provider::OpenAI,
            &a,
            Some("k"),
            &reglage(),
            &bonjour(),
            &[outil()],
        )
        .await
        .unwrap();
        assert_eq!(
            r.appels[0],
            Appel {
                id: "c1".into(),
                nom: "lire".into(),
                arguments: json!({"chemin": "x"})
            }
        );
        assert_eq!(r.appels[1].arguments, json!("pas du json"));
        assert_eq!(
            recues.lock().unwrap()[0].corps["tools"][0],
            json!({"type": "function", "function": {"name": "lire", "description": "Lit un fichier", "parameters": outil().schema}})
        );

        appeler(
            Provider::OpenAI,
            &a,
            Some("k"),
            &reglage(),
            &historique(),
            &[outil()],
        )
        .await
        .unwrap();
        let recues = recues.lock().unwrap();
        let m = recues[1].corps["messages"].as_array().unwrap().clone();
        assert_eq!(m[2]["role"], "assistant");
        assert_eq!(m[2]["tool_calls"][1]["id"], "b");
        assert_eq!(
            m[2]["tool_calls"][1]["function"]["arguments"],
            "{\"chemin\":\"b\"}"
        );
        assert_eq!(
            m[3],
            json!({"role": "tool", "tool_call_id": "a", "content": "AA"})
        );
        assert_eq!(m[4]["tool_call_id"], "b");
    }

    #[tokio::test]
    async fn REQ055_AC4_anthropic_tool_use_et_tool_result_groupes() {
        let rep = json!({"content": [
            {"type": "text", "text": "je lis"},
            {"type": "tool_use", "id": "t1", "name": "lire", "input": {"chemin": "x"}}
        ], "usage": {"input_tokens": 1, "output_tokens": 1}});
        let (a, recues) = faux(200, rep).await;
        let r = appeler(
            Provider::Anthropic,
            &a,
            Some("k"),
            &reglage(),
            &bonjour(),
            &[outil()],
        )
        .await
        .unwrap();
        assert_eq!(r.texte, "je lis");
        assert_eq!(
            r.appels,
            vec![Appel {
                id: "t1".into(),
                nom: "lire".into(),
                arguments: json!({"chemin": "x"})
            }]
        );
        assert_eq!(
            recues.lock().unwrap()[0].corps["tools"][0]["input_schema"],
            outil().schema
        );

        appeler(
            Provider::Anthropic,
            &a,
            Some("k"),
            &reglage(),
            &historique(),
            &[outil()],
        )
        .await
        .unwrap();
        let recues = recues.lock().unwrap();
        let m = recues[1].corps["messages"].as_array().unwrap().clone();
        assert_eq!(m.len(), 3);
        assert_eq!(m[1]["content"][1]["type"], "tool_use");
        assert_eq!(m[1]["content"][1]["input"], json!({"chemin": "a"}));
        assert_eq!(m[2]["role"], "user");
        let blocs = m[2]["content"].as_array().unwrap();
        assert_eq!(blocs.len(), 2);
        assert_eq!(
            blocs[0],
            json!({"type": "tool_result", "tool_use_id": "a", "content": "AA"})
        );
        assert_eq!(blocs[1]["is_error"], true);
    }

    #[tokio::test]
    async fn REQ055_AC5_refus_429_garde_code_et_corps() {
        let (a, recues) = faux(429, json!({"error": {"message": "trop de requêtes"}})).await;
        for p in [Provider::OpenAI, Provider::Anthropic] {
            match appeler(p, &a, Some("k"), &reglage(), &bonjour(), &[]).await {
                Err(ErreurProvider::Refus { code, corps }) => {
                    assert_eq!(code, 429);
                    assert_eq!(corps, r#"{"error":{"message":"trop de requêtes"}}"#);
                }
                autre => panic!("{autre:?}"),
            }
        }
        assert_eq!(recues.lock().unwrap().len(), 2, "pas de nouvel essai");
        // Réponse 2xx illisible.
        let (a, _) = faux(200, json!({"inattendu": true})).await;
        assert!(matches!(
            appeler(Provider::OpenAI, &a, None, &reglage(), &bonjour(), &[]).await,
            Err(ErreurProvider::Refus { code: 200, .. })
        ));
    }

    #[tokio::test]
    async fn REQ055_AC5_adresse_injoignable() {
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let adresse = format!("http://127.0.0.1:{port}");
        match appeler(
            Provider::Ollama,
            &adresse,
            None,
            &reglage(),
            &bonjour(),
            &[],
        )
        .await
        {
            Err(ErreurProvider::Injoignable(cause)) => assert!(!cause.is_empty()),
            autre => panic!("{autre:?}"),
        }
    }

    #[tokio::test]
    async fn tokens_lus_dans_usage_des_deux_formats() {
        let (a, _) = faux(200, ok_openai()).await;
        let r = appeler(Provider::LiteLLM, &a, None, &reglage(), &bonjour(), &[])
            .await
            .unwrap();
        assert_eq!((r.texte.as_str(), r.tokens), ("salut", 7));
        let (a, _) = faux(200, ok_anthropic()).await;
        let r = appeler(
            Provider::Anthropic,
            &a,
            Some("k"),
            &reglage(),
            &bonjour(),
            &[],
        )
        .await
        .unwrap();
        assert_eq!(r.tokens, 11);
    }

    #[test]
    fn providers_ids_adresses_et_formats() {
        assert_eq!(Provider::OpenRouter.id(), "openrouter");
        assert_eq!(Provider::Ollama.nom(), "Ollama");
        assert_eq!(
            Provider::Ollama.adresse_par_defaut(),
            "http://localhost:11434/v1"
        );
        assert!(Provider::Google.cle_obligatoire() && !Provider::LiteLLM.cle_obligatoire());
        assert_eq!(Provider::Anthropic.format(), Format::Anthropic);
        assert_eq!(Provider::Google.format(), Format::OpenAI);
    }

    #[tokio::test]
    async fn REQ085_AC1_AC2_AC6_openai_lit_reasoning_content_puis_reasoning_et_ne_le_renvoie_pas() {
        let rep = |champ: &str, valeur: Value| {
            let mut m = json!({"content": "fini"});
            m[champ] = valeur;
            json!({"choices": [{"message": m}]})
        };
        let (a, recues) = faux(200, rep("reasoning_content", json!("Je lis README.md."))).await;
        let r = appeler(Provider::OpenAI, &a, Some("k"), &reglage(), &bonjour(), &[])
            .await
            .unwrap();
        assert_eq!(r.raisonnement, "Je lis README.md.");
        assert!(r.blocs.is_empty());
        let (b, _) = faux(200, rep("reasoning", json!("Autre champ."))).await;
        let r2 = appeler(Provider::OpenAI, &b, Some("k"), &reglage(), &bonjour(), &[])
            .await
            .unwrap();
        assert_eq!(r2.raisonnement, "Autre champ.");
        // reasoning non chaîne : ignoré
        let (c, _) = faux(200, rep("reasoning", json!({"x": 1}))).await;
        let r3 = appeler(Provider::OpenAI, &c, Some("k"), &reglage(), &bonjour(), &[])
            .await
            .unwrap();
        assert_eq!(r3.raisonnement, "");
        // la requête suivante ne contient pas le raisonnement
        appeler(
            Provider::OpenAI,
            &a,
            Some("k"),
            &reglage(),
            &historique(),
            &[outil()],
        )
        .await
        .unwrap();
        let texte = recues.lock().unwrap()[1].corps.to_string();
        assert!(!texte.contains("reasoning_content") && !texte.contains("\"reasoning\""));
    }

    #[tokio::test]
    async fn REQ085_AC3_anthropic_demande_le_resume_sauf_avec_temperature() {
        let (a, recues) = faux(200, ok_anthropic()).await;
        appeler(
            Provider::Anthropic,
            &a,
            Some("k"),
            &reglage(),
            &bonjour(),
            &[],
        )
        .await
        .unwrap();
        let avec = Reglage {
            temperature: Some(0.5),
            ..reglage()
        };
        appeler(Provider::Anthropic, &a, Some("k"), &avec, &bonjour(), &[])
            .await
            .unwrap();
        let recues = recues.lock().unwrap();
        assert_eq!(
            recues[0].corps["thinking"],
            json!({"type": "adaptive", "display": "summarized"})
        );
        assert!(recues[1].corps.get("thinking").is_none());
    }

    #[tokio::test]
    async fn REQ085_AC4_AC6_anthropic_garde_les_blocs_et_les_renvoie_avant_tool_use() {
        let pense =
            json!({"type": "thinking", "thinking": "Je lis README.md.", "signature": "sig-1"});
        let rouge = json!({"type": "redacted_thinking", "data": "xyz"});
        let rep = json!({"content": [
            pense, rouge,
            {"type": "tool_use", "id": "t1", "name": "lire", "input": {"chemin": "README.md"}}
        ]});
        let (a, recues) = faux(200, rep).await;
        let r = appeler(
            Provider::Anthropic,
            &a,
            Some("k"),
            &reglage(),
            &bonjour(),
            &[],
        )
        .await
        .unwrap();
        assert_eq!(r.raisonnement, "Je lis README.md.");
        assert_eq!(r.blocs, vec![pense.clone(), rouge.clone()]);
        let mut h = bonjour();
        h.push(Message::Agent {
            texte: "ok".into(),
            appels: r.appels,
            blocs: r.blocs,
        });
        appeler(Provider::Anthropic, &a, Some("k"), &reglage(), &h, &[])
            .await
            .unwrap();
        let c = recues.lock().unwrap()[1].corps["messages"][1]["content"].clone();
        assert_eq!(c[0], pense);
        assert_eq!(c[1], rouge);
        assert_eq!(c[2]["type"], "text");
        assert_eq!(c[3]["type"], "tool_use");
        // plusieurs blocs thinking : réunis par une ligne vide
        let deux = json!({"content": [
            {"type": "thinking", "thinking": "a", "signature": "1"},
            {"type": "thinking", "thinking": "b", "signature": "2"}]});
        assert_eq!(lire_anthropic(&deux).unwrap().raisonnement, "a\n\nb");
        // sans raisonnement
        let r = lire_anthropic(&json!({"content": [{"type": "text", "text": "x"}]})).unwrap();
        assert!(r.raisonnement.is_empty() && r.blocs.is_empty());
    }
}
