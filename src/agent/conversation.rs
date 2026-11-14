//! Conversations de l'agent : journal, boucle, arrêt (DEC-035, DEC-036).
//! Le fichier `.yaide/conversations/<id>.json` est la seule source de l'historique.

use super::agents::{Agent, Agents};
use super::mcp::Mcp;
use super::outils::{self, Contexte, Limites};
use super::provider::{self, Appel, Effort, ErreurProvider, Message, Reglage};
use super::reglages::{self, Profil, Reglages};
use crate::config;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::task::AbortHandle;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Entree {
    Utilisateur {
        texte: String,
    },
    Agent {
        texte: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        auteur: Option<String>,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        raisonnement: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        blocs: Vec<Value>,
    },
    Outil {
        id: String,
        nom: String,
        arguments: Value,
        argument: String,
        etat: String,
        resultat: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        auteur: Option<String>,
        /// Serveur MCP et outil d'origine d'un appel `mcp__…` (REQ-095).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        serveur: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        outil: Option<String>,
        /// Étapes du sous-agent d'un appel `subagent` (REQ-100) ; jamais envoyées au modèle.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        etapes: Option<Vec<Entree>>,
    },
    Fin {
        texte: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        auteur: Option<String>,
    },
    Message {
        variante: String,
        texte: String,
        #[serde(default)]
        detail: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub titre: String,
    pub profil: String,
    pub cree: u64,
    pub maj: u64,
    pub en_cours: bool,
    pub instructions: String,
    pub tokens: u64,
    pub entrees: Vec<Entree>,
    /// Copie des agents au premier message (DEC-045) ; vide sans agent personnalisé.
    #[serde(default)]
    pub agents: Vec<AgentConv>,
    /// Le dossier de l'agent dont c'est le tour.
    #[serde(default)]
    pub actif: Option<String>,
    /// Appels demandés par le provider et pas encore commencés ; jamais écrits.
    #[serde(skip)]
    restants: Vec<(Appel, Option<String>, Option<String>)>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentConv {
    pub dossier: String,
    pub nom: String,
    pub avatar: String,
    pub couleur: String,
    #[serde(default)]
    pub profil: Option<String>,
    pub instructions: String,
    #[serde(default)]
    pub tokens: u64,
}

/// Envoi refusé avant toute écriture et toute requête.
#[derive(Debug, PartialEq)]
pub struct Refus {
    pub motif: &'static str,
    pub provider: Option<&'static str>,
}

#[derive(Debug, PartialEq)]
pub enum ErreurEnvoi {
    Refus(Refus),
    /// Conversation inconnue.
    Inconnue,
    Systeme(String),
}

struct Tour {
    conv: Arc<Mutex<Conversation>>,
    abort: AbortHandle,
}

pub struct Gestionnaire {
    dossier: PathBuf,
    projet: PathBuf,
    reglages: Arc<Reglages>,
    agents: Arc<Agents>,
    client: reqwest::Client,
    limites: Limites,
    registre: Mutex<HashMap<String, Tour>>,
    /// Les serveurs MCP de l'instance, partagés par toutes les conversations (REQ-095).
    mcp: Mcp,
}

fn maintenant() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn verrou<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn id_valide(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn nouvel_id() -> Result<String, String> {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut o = [0u8; 8];
    SystemRandom::new()
        .fill(&mut o)
        .map_err(|_| "tirage aléatoire impossible".to_string())?;
    Ok(o.iter().map(|b| format!("{b:02x}")).collect())
}

/// La première ligne du message, 50 caractères au plus.
pub fn titre(texte: &str) -> String {
    let ligne = texte
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    if ligne.chars().count() > 50 {
        let mut t: String = ligne.chars().take(50).collect();
        t.push('…');
        t
    } else {
        ligne.to_string()
    }
}

/// Les messages du provider d'une conversation sans agent personnalisé.
fn messages(entrees: &[Entree]) -> Vec<Message> {
    messages_pour(entrees, None, &[])
}

/// Réunit les messages consécutifs de l'utilisateur seulement avec des agents (`reunir`).
fn ajouter_utilisateur(sortie: &mut Vec<Message>, texte: String, reunir: bool) {
    match sortie.last_mut() {
        Some(Message::Utilisateur(precedent)) if reunir => {
            precedent.push_str("\n\n");
            precedent.push_str(&texte);
        }
        _ => sortie.push(Message::Utilisateur(texte)),
    }
}

/// Les messages du provider pour l'agent `moi` (`None` : sans agent), déduits du journal :
/// `fin` et `message` ne partent pas. Les réponses des autres agents partent en message de
/// l'utilisateur précédé de leur nom (`noms` : dossier, nom) ; leurs appels ne partent pas.
fn messages_pour(entrees: &[Entree], moi: Option<&str>, noms: &[(String, String)]) -> Vec<Message> {
    let mien = |auteur: &Option<String>| auteur.as_deref() == moi;
    let mut sortie = Vec::new();
    let mut i = 0;
    while i < entrees.len() {
        match &entrees[i] {
            Entree::Utilisateur { texte } => {
                ajouter_utilisateur(&mut sortie, texte.clone(), moi.is_some());
                i += 1;
            }
            Entree::Agent { texte, auteur, .. } if !mien(auteur) => {
                if !texte.is_empty() {
                    let d = auteur.as_deref().unwrap_or("");
                    let nom = noms.iter().find(|(x, _)| x == d).map_or(d, |(_, n)| n);
                    ajouter_utilisateur(&mut sortie, format!("[{nom}] {texte}"), moi.is_some());
                }
                i += 1;
            }
            Entree::Outil { auteur, .. } if !mien(auteur) => i += 1,
            Entree::Agent { .. } | Entree::Outil { .. } => {
                let (texte, blocs) = match &entrees[i] {
                    Entree::Agent { texte, blocs, .. } => {
                        i += 1;
                        (texte.clone(), blocs.clone())
                    }
                    _ => (String::new(), Vec::new()),
                };
                let mut appels = Vec::new();
                let mut resultats = Vec::new();
                while let Some(Entree::Outil {
                    id,
                    nom,
                    arguments,
                    etat,
                    resultat,
                    auteur,
                    ..
                }) = entrees.get(i)
                {
                    if !mien(auteur) {
                        break;
                    }
                    appels.push(Appel {
                        id: id.clone(),
                        nom: nom.clone(),
                        arguments: arguments.clone(),
                    });
                    resultats.push(Message::Resultat {
                        id: id.clone(),
                        contenu: resultat.clone(),
                        echec: etat != "reussi",
                    });
                    i += 1;
                }
                if !texte.is_empty() || !appels.is_empty() || !blocs.is_empty() {
                    sortie.push(Message::Agent {
                        texte,
                        appels,
                        blocs,
                    });
                }
                sortie.extend(resultats);
            }
            Entree::Fin { .. } | Entree::Message { .. } => i += 1,
        }
    }
    sortie
}

/// Remet le journal en ordre après un arrêt : chaque appel a un résultat, puis `fin` ou l'alerte.
fn ranger(c: &mut Conversation, yaide_arrete: bool) {
    let auteur = c.actif.take();
    for e in &mut c.entrees {
        if let Entree::Outil {
            etat,
            resultat,
            etapes,
            ..
        } = e
        {
            for etape in etapes.iter_mut().flatten() {
                if let Entree::Outil { etat, resultat, .. } = etape {
                    if etat == "enCours" {
                        *etat = "echec".into();
                        *resultat = "Stopped by the user.".into();
                    }
                }
            }
            if etat == "enCours" {
                *etat = "echec".into();
                *resultat = "Stopped by the user.".into();
            }
        }
    }
    for (a, serveur, outil) in std::mem::take(&mut c.restants) {
        c.entrees.push(Entree::Outil {
            argument: outils::argument_principal(&a.nom, &a.arguments),
            id: a.id,
            nom: a.nom,
            arguments: a.arguments,
            etat: "echec".into(),
            resultat: "Not run: stopped by the user.".into(),
            auteur: auteur.clone(),
            serveur,
            outil,
            etapes: None,
        });
    }
    c.entrees.push(if yaide_arrete {
        Entree::Message {
            variante: "alerte".into(),
            texte: "Interrompu : Yaide a été arrêté.".into(),
            detail: String::new(),
        }
    } else {
        Entree::Fin {
            texte: "Arrêté.".into(),
            auteur,
        }
    });
    c.en_cours = false;
}

fn message_erreur(texte: String, detail: String) -> Entree {
    Entree::Message {
        variante: "erreur".into(),
        texte,
        detail,
    }
}

impl Gestionnaire {
    /// Un fournisseur TLS rustls doit déjà être installé.
    pub fn new(
        projet: PathBuf,
        reglages: Arc<Reglages>,
        agents: Arc<Agents>,
        limites: Limites,
    ) -> Self {
        Gestionnaire {
            dossier: projet.join(".yaide").join("conversations"),
            mcp: Mcp::new(projet.clone(), reglages.dossier().join("mcp.json")),
            projet,
            reglages,
            agents,
            client: provider::client(),
            limites,
            registre: Mutex::new(HashMap::new()),
        }
    }

    fn fichier(&self, id: &str) -> PathBuf {
        self.dossier.join(format!("{id}.json"))
    }

    fn sauver(&self, c: &Conversation) -> Result<(), String> {
        let octets = serde_json::to_vec_pretty(c).map_err(|e| e.to_string())?;
        config::ecrire_atomique(&self.fichier(&c.id), &octets)
    }

    fn sauver_ou_dire(&self, c: &Conversation) {
        if let Err(e) = self.sauver(c) {
            eprintln!("conversation {} : {e}", c.id);
        }
    }

    fn charger(&self, id: &str) -> Option<Conversation> {
        if !id_valide(id) {
            return None;
        }
        serde_json::from_slice(&std::fs::read(self.fichier(id)).ok()?).ok()
    }

    /// Change le journal pendant un tour et l'écrit. Faux si le tour a été arrêté entre-temps.
    fn modifier(&self, conv: &Mutex<Conversation>, f: impl FnOnce(&mut Conversation)) -> bool {
        let mut c = verrou(conv);
        if !c.en_cours {
            return false;
        }
        f(&mut c);
        c.maj = maintenant();
        self.sauver_ou_dire(&c);
        true
    }

    fn profil(&self, id: &str) -> Option<Profil> {
        let vue = self.reglages.vue();
        let profils = vue.get("profils")?.as_array()?.clone();
        profils
            .into_iter()
            .filter_map(|p| serde_json::from_value::<Profil>(p).ok())
            .find(|p| p.id == id)
    }

    fn lignes_fixes(&self) -> String {
        format!(
            "You are a coding agent working in the project located at {}. \
Use your tools (read, write, edit, bash, glob, websearch, webfetch) to inspect and change the project. \
Always give file paths relative to the project root.",
            self.projet.display()
        )
    }

    /// Texte d'un fichier s'il existe, se lit en texte et n'est pas vide.
    fn lire_texte(chemin: PathBuf) -> Option<String> {
        let t = String::from_utf8(std::fs::read(chemin).ok()?).ok()?;
        (!t.trim().is_empty()).then_some(t)
    }

    fn instructions(&self) -> String {
        let mut t = self.lignes_fixes();
        if let Ok(octets) = std::fs::read(self.projet.join("AGENTS.md")) {
            if let Ok(agents) = String::from_utf8(octets) {
                t.push_str("\n\nProject instructions (AGENTS.md):\n");
                t.push_str(&agents);
            }
        }
        t
    }

    /// Instructions d'un agent, écrites une fois (REQ-066) : lignes fixes, son nom et les
    /// autres agents, `AGENTS.md` de la racine, son `PERSONA.md`, son `AGENTS.md`.
    fn instructions_agent(&self, agent: &Agent, autres: &[&str]) -> String {
        let mut t = self.lignes_fixes();
        t.push_str(&format!(
            " Your name is {}. You talk with the user",
            agent.nom
        ));
        if autres.is_empty() {
            t.push('.');
        } else {
            t.push_str(&format!(
                " and with the agents {}, who answer in turn. Their messages start with their name in brackets.",
                autres.join(", ")
            ));
        }
        let dossier = self
            .projet
            .join(".yaide")
            .join("agents")
            .join(&agent.dossier);
        let parties = [
            (
                "Project instructions (AGENTS.md)",
                self.projet.join("AGENTS.md"),
            ),
            ("Your persona (PERSONA.md)", dossier.join("PERSONA.md")),
            ("Your own notes (AGENTS.md)", dossier.join("AGENTS.md")),
        ];
        for (titre, chemin) in parties {
            if let Some(texte) = Self::lire_texte(chemin) {
                t.push_str(&format!("\n\n{titre}:\n{texte}"));
            }
        }
        t
    }

    /// Profil d'un agent : le sien, sinon le profil par défaut.
    fn profil_agent(&self, id: Option<&str>) -> Option<Profil> {
        if let Some(p) = id.and_then(|i| self.profil(i)) {
            return Some(p);
        }
        let vue = self.reglages.vue();
        let profils: Vec<Profil> = vue
            .get("profils")?
            .as_array()?
            .iter()
            .filter_map(|p| serde_json::from_value(p.clone()).ok())
            .collect();
        let defaut = profils.iter().position(|p| p.defaut).unwrap_or(0);
        profils.into_iter().nth(defaut)
    }

    /// Accepte un message : écrit le journal puis lance le tour. Un refus n'écrit rien.
    pub fn envoyer(
        self: &Arc<Self>,
        conversation: Option<&str>,
        profil: &str,
        texte: &str,
    ) -> Result<String, ErreurEnvoi> {
        self.envoyer_avec(conversation, profil, &[], texte)
    }

    /// Comme `envoyer`, avec des agents personnalisés à la création d'une conversation.
    /// Une conversation qui a des agents garde les siens et ignore `profil` et `agents`.
    pub fn envoyer_avec(
        self: &Arc<Self>,
        conversation: Option<&str>,
        profil: &str,
        agents: &[Agent],
        texte: &str,
    ) -> Result<String, ErreurEnvoi> {
        let refus = |motif, provider| Err(ErreurEnvoi::Refus(Refus { motif, provider }));
        let mut registre = verrou(&self.registre);
        let existant = match conversation {
            Some(id) => Some(match registre.get(id) {
                Some(t) => (t.conv.clone(), true),
                None => {
                    let mut c = self.charger(id).ok_or(ErreurEnvoi::Inconnue)?;
                    if c.en_cours {
                        ranger(&mut c, true);
                        self.sauver(&c).map_err(ErreurEnvoi::Systeme)?;
                    }
                    (Arc::new(Mutex::new(c)), false)
                }
            }),
            None => None,
        };
        let equipe: Vec<AgentConv> = match &existant {
            Some((c, _)) => verrou(c).agents.clone(),
            None => {
                let noms: Vec<&str> = agents.iter().map(|a| a.nom.as_str()).collect();
                agents
                    .iter()
                    .map(|a| AgentConv {
                        dossier: a.dossier.clone(),
                        nom: a.nom.clone(),
                        avatar: a.avatar.clone(),
                        couleur: a.couleur.clone(),
                        profil: a.profil.clone(),
                        instructions: self.instructions_agent(
                            a,
                            &noms
                                .iter()
                                .copied()
                                .filter(|n| *n != a.nom)
                                .collect::<Vec<_>>(),
                        ),
                        tokens: 0,
                    })
                    .collect()
            }
        };
        // Profil de la conversation : celui du message, ou celui du premier agent.
        let (profil_conv, nom_en_cours) = if equipe.is_empty() {
            let Some(p) = self.profil(profil) else {
                return refus("sans-profil", None);
            };
            let prov = reglages::provider(&p.provider)
                .ok_or_else(|| ErreurEnvoi::Systeme("provider du profil inconnu".into()))?;
            let nom = Some(prov.nom());
            if prov.cle_obligatoire() && self.reglages.cle(prov.id()).is_none() {
                return refus("sans-cle", nom);
            }
            if let (Some((c, _)), Some(f)) = (&existant, p.fenetre) {
                if verrou(c).tokens >= f {
                    return refus("contexte-plein", nom);
                }
            }
            (p.id, nom)
        } else {
            let mut premier = String::new();
            let mut premier_nom = None;
            for (i, a) in equipe.iter().enumerate() {
                let Some(p) = self.profil_agent(a.profil.as_deref()) else {
                    return refus("sans-profil", None);
                };
                let prov = reglages::provider(&p.provider)
                    .ok_or_else(|| ErreurEnvoi::Systeme("provider du profil inconnu".into()))?;
                let nom = Some(prov.nom());
                if prov.cle_obligatoire() && self.reglages.cle(prov.id()).is_none() {
                    return refus("sans-cle", nom);
                }
                if p.fenetre.is_some_and(|f| a.tokens >= f) {
                    return refus("contexte-plein", nom);
                }
                if i == 0 {
                    premier = p.id;
                    premier_nom = nom;
                }
            }
            (premier, premier_nom)
        };
        if matches!(existant, Some((_, true))) {
            return refus("en-cours", nom_en_cours);
        }
        let conv = match existant {
            Some((c, _)) => {
                {
                    let mut g = verrou(&c);
                    if g.agents.is_empty() {
                        g.profil = profil_conv;
                    }
                    g.en_cours = true;
                    g.maj = maintenant();
                    g.entrees.push(Entree::Utilisateur {
                        texte: texte.to_string(),
                    });
                    self.sauver(&g).map_err(ErreurEnvoi::Systeme)?;
                }
                c
            }
            None => {
                let maj = maintenant();
                let c = Conversation {
                    id: nouvel_id().map_err(ErreurEnvoi::Systeme)?,
                    titre: titre(texte),
                    profil: profil_conv,
                    cree: maj,
                    maj,
                    en_cours: true,
                    instructions: if equipe.is_empty() {
                        self.instructions()
                    } else {
                        String::new()
                    },
                    tokens: 0,
                    entrees: vec![Entree::Utilisateur {
                        texte: texte.to_string(),
                    }],
                    agents: equipe,
                    actif: None,
                    restants: Vec::new(),
                };
                self.sauver(&c).map_err(ErreurEnvoi::Systeme)?;
                Arc::new(Mutex::new(c))
            }
        };
        let id = verrou(&conv).id.clone();
        let tache = tokio::spawn(self.clone().tour(conv.clone()));
        registre.insert(
            id.clone(),
            Tour {
                conv,
                abort: tache.abort_handle(),
            },
        );
        Ok(id)
    }

    /// Arrêt de Yaide : arrête les serveurs MCP et ce qu'ils ont lancé.
    pub async fn arreter_mcp(&self) {
        self.mcp.arreter().await;
    }

    async fn tour(self: Arc<Self>, conv: Arc<Mutex<Conversation>>) {
        // Une fois par message de l'utilisateur : les problèmes des serveurs MCP, puis les outils.
        let (defs, problemes) = self.mcp.preparer(&self.limites).await;
        let mut outils_tour = outils::definitions();
        outils_tour.extend(defs);
        let connaissance = outils::definition_connaissance(&self.projet);
        let offerts = !connaissance.is_empty();
        outils_tour.extend(connaissance);
        // REQ-108 : les collections nommées par « # » dans les messages de l'utilisateur.
        let nommees = if offerts {
            let g = verrou(&conv);
            let textes = g.entrees.iter().filter_map(|e| match e {
                Entree::Utilisateur { texte } => Some(texte.as_str()),
                _ => None,
            });
            outils::collections_nommees(&self.projet, textes)
        } else {
            Vec::new()
        };
        let note = if nommees.is_empty() {
            String::new()
        } else {
            format!(
                "The user named these knowledge base collections in this conversation: {}. Search them with knowledge_search (collections argument) when they may help.",
                nommees.join(", ")
            )
        };
        if !self.modifier(&conv, |c| {
            for p in problemes {
                c.entrees.push(Entree::Message {
                    variante: "alerte".into(),
                    texte: p.message,
                    detail: p.detail.unwrap_or_default(),
                });
            }
        }) {
            return;
        }
        let dossiers: Vec<String> = verrou(&conv)
            .agents
            .iter()
            .map(|a| a.dossier.clone())
            .collect();
        if dossiers.is_empty() {
            self.boucle(&conv, None, &outils_tour, &note).await;
        } else {
            for d in dossiers {
                if !self.modifier(&conv, |c| c.actif = Some(d.clone())) {
                    break;
                }
                if !self.boucle(&conv, Some(d), &outils_tour, &note).await {
                    break;
                }
            }
        }
        let id = {
            let mut c = verrou(&conv);
            if c.en_cours {
                c.en_cours = false;
                c.actif = None;
                c.maj = maintenant();
                self.sauver_ou_dire(&c);
            }
            c.id.clone()
        };
        verrou(&self.registre).remove(&id);
    }

    /// Requête au provider d'un profil. `None` si le provider du profil est inconnu.
    async fn requete(
        &self,
        p: &Profil,
        instructions: &str,
        historique: &[Message],
        definitions: &[provider::DefOutil],
    ) -> Option<(&'static str, Result<provider::Reponse, ErreurProvider>)> {
        let prov = reglages::provider(&p.provider)?;
        let reglage = Reglage {
            modele: p.modele.clone(),
            effort: p.effort.as_deref().and_then(|e| match e {
                "faible" => Some(Effort::Faible),
                "moyen" => Some(Effort::Moyen),
                "eleve" => Some(Effort::Eleve),
                _ => None,
            }),
            sortie_max: p.sortie_max.map(|n| n.min(u32::MAX as u64) as u32),
            temperature: p.temperature.map(|t| t as f32),
        };
        let adresse = self
            .reglages
            .adresse(prov.id())
            .unwrap_or_else(|| prov.adresse_par_defaut().to_string());
        let cle = self.reglages.cle(prov.id());
        let res = provider::envoyer(
            &self.client,
            prov,
            &adresse,
            cle.as_deref(),
            &reglage,
            instructions,
            historique,
            definitions,
        )
        .await;
        Some((prov.nom(), res))
    }

    /// Exécute un appel d'outil : serveur MCP pour `mcp__…`, sinon outil intégré.
    async fn executer_appel(&self, ctx: &Contexte, appel: &Appel) -> outils::Resultat {
        if appel.nom.starts_with("mcp__") {
            self.mcp
                .appeler(&appel.nom, &appel.arguments, &self.limites)
                .await
        } else {
            outils::executer(&appel.nom, &appel.arguments, ctx).await
        }
    }

    /// Outil `subagent` (REQ-100) : une boucle en mémoire, sans journal ni compteur.
    async fn sous_agent(
        &self,
        p: &Profil,
        arguments: &Value,
        definitions: &[provider::DefOutil],
        conv: &Mutex<Conversation>,
        id_appel: &str,
    ) -> outils::Resultat {
        let Some(consigne) = arguments["prompt"].as_str() else {
            return outils::Resultat {
                contenu: "Missing or invalid argument: prompt.".into(),
                echec: true,
            };
        };
        let arret = |m: String| outils::Resultat {
            contenu: format!("The subagent stopped: {m}"),
            echec: true,
        };
        let ctx = Contexte {
            projet: self.projet.clone(),
            client: self.client.clone(),
            limites: self.limites.clone(),
            agents: self.agents.clone(),
            reglages: self.reglages.clone(),
        };
        let instructions = self.instructions();
        let definitions: Vec<provider::DefOutil> = definitions
            .iter()
            .filter(|d| d.nom != "subagent")
            .cloned()
            .collect();
        let mut journal = vec![Entree::Utilisateur {
            texte: consigne.to_string(),
        }];
        let arret_tour = || arret("the turn was stopped.".into());
        if !self.copier_etapes(conv, id_appel, &journal) {
            return arret_tour();
        }
        loop {
            let Some((nom, res)) = self
                .requete(p, &instructions, &messages(&journal), &definitions)
                .await
            else {
                return arret("its profile has no provider.".into());
            };
            let rep = match res {
                Ok(r) => r,
                Err(ErreurProvider::Refus { code, corps }) => {
                    return arret(format!("{nom} refused the request ({code}). {corps}"));
                }
                Err(ErreurProvider::Injoignable(cause)) => {
                    return arret(format!("{nom} is unreachable: {cause}."));
                }
            };
            if rep.appels.is_empty() {
                journal.push(Entree::Agent {
                    texte: rep.texte.clone(),
                    raisonnement: rep.raisonnement,
                    blocs: rep.blocs,
                    auteur: None,
                });
                if !self.copier_etapes(conv, id_appel, &journal) {
                    return arret_tour();
                }
                return outils::Resultat {
                    contenu: rep.texte,
                    echec: false,
                };
            }
            if p.fenetre.is_some_and(|f| rep.tokens >= f) {
                return arret("its context window is full.".into());
            }
            let appels = rep.appels.clone();
            journal.push(Entree::Agent {
                texte: rep.texte,
                raisonnement: rep.raisonnement,
                blocs: rep.blocs,
                auteur: None,
            });
            if !self.copier_etapes(conv, id_appel, &journal) {
                return arret_tour();
            }
            for appel in appels {
                let (serveur, outil) = match self.mcp.identite(&appel.nom).await {
                    Some((s, o)) if appel.nom.starts_with("mcp__") => (Some(s), Some(o)),
                    _ => (None, None),
                };
                journal.push(Entree::Outil {
                    argument: outils::argument_principal(&appel.nom, &appel.arguments),
                    id: appel.id.clone(),
                    nom: appel.nom.clone(),
                    arguments: appel.arguments.clone(),
                    etat: "enCours".into(),
                    resultat: String::new(),
                    auteur: None,
                    serveur,
                    outil,
                    etapes: None,
                });
                if !self.copier_etapes(conv, id_appel, &journal) {
                    return arret_tour();
                }
                let r = self.executer_appel(&ctx, &appel).await;
                if let Some(Entree::Outil { etat, resultat, .. }) = journal.last_mut() {
                    *etat = if r.echec { "echec" } else { "reussi" }.into();
                    *resultat = r.contenu;
                }
                if !self.copier_etapes(conv, id_appel, &journal) {
                    return arret_tour();
                }
            }
        }
    }

    /// Recopie le journal du sous-agent dans les étapes de son appel. Faux si le tour est arrêté.
    fn copier_etapes(
        &self,
        conv: &Mutex<Conversation>,
        id_appel: &str,
        journal: &[Entree],
    ) -> bool {
        self.modifier(conv, |c| {
            let entree = c.entrees.iter_mut().rev().find(
                |e| matches!(e, Entree::Outil { id, etat, .. } if id == id_appel && etat == "enCours"),
            );
            if let Some(Entree::Outil { etapes, .. }) = entree {
                *etapes = Some(journal.to_vec());
            }
        })
    }

    /// Faux si le tour entier doit finir (erreur, arrêt).
    async fn boucle(
        &self,
        conv: &Mutex<Conversation>,
        agent: Option<String>,
        definitions: &[provider::DefOutil],
        note: &str,
    ) -> bool {
        let ctx = Contexte {
            projet: self.projet.clone(),
            client: self.client.clone(),
            limites: self.limites.clone(),
            agents: self.agents.clone(),
            reglages: self.reglages.clone(),
        };
        loop {
            let (profil_trouve, instructions, historique) = {
                let c = verrou(conv);
                match &agent {
                    None => (
                        self.profil(&c.profil),
                        c.instructions.clone(),
                        messages(&c.entrees),
                    ),
                    Some(d) => {
                        let noms: Vec<(String, String)> = c
                            .agents
                            .iter()
                            .map(|a| (a.dossier.clone(), a.nom.clone()))
                            .collect();
                        let a = c.agents.iter().find(|a| a.dossier == *d);
                        (
                            a.and_then(|a| self.profil_agent(a.profil.as_deref())),
                            a.map(|a| a.instructions.clone()).unwrap_or_default(),
                            messages_pour(&c.entrees, Some(d), &noms),
                        )
                    }
                }
            };
            let instructions = if note.is_empty() {
                instructions
            } else if instructions.is_empty() {
                note.to_string()
            } else {
                format!("{instructions}\n\n{note}")
            };
            let Some(p) = profil_trouve else {
                self.modifier(conv, |c| {
                    c.entrees
                        .push(message_erreur("Profil introuvable.".into(), String::new()))
                });
                return false;
            };
            let Some((nom, res)) = self
                .requete(&p, &instructions, &historique, definitions)
                .await
            else {
                self.modifier(conv, |c| {
                    c.entrees
                        .push(message_erreur("Profil introuvable.".into(), String::new()))
                });
                return false;
            };
            let rep = match res {
                Ok(r) => r,
                Err(e) => {
                    let entree = match e {
                        ErreurProvider::Refus { code, corps } => {
                            message_erreur(format!("{nom} a refusé la requête ({code})."), corps)
                        }
                        ErreurProvider::Injoignable(cause) => message_erreur(
                            format!("{nom} est injoignable : {cause}."),
                            String::new(),
                        ),
                    };
                    self.modifier(conv, |c| c.entrees.push(entree));
                    return false;
                }
            };
            // Serveur et outil d'origine des appels MCP, pris une fois pour la boucle et `ranger`.
            let mut appels: Vec<(Appel, Option<String>, Option<String>)> = Vec::new();
            for a in &rep.appels {
                let (serveur, outil) = match self.mcp.identite(&a.nom).await {
                    Some((s, o)) if a.nom.starts_with("mcp__") => (Some(s), Some(o)),
                    _ => (None, None),
                };
                appels.push((a.clone(), serveur, outil));
            }
            let restants = appels.clone();
            let continuer = self.modifier(conv, |c| {
                c.tokens = rep.tokens;
                if let Some(a) = c
                    .agents
                    .iter_mut()
                    .find(|a| Some(&a.dossier) == agent.as_ref())
                {
                    a.tokens = rep.tokens;
                }
                if !rep.texte.is_empty()
                    || !rep.appels.is_empty()
                    || !rep.raisonnement.is_empty()
                    || !rep.blocs.is_empty()
                {
                    c.entrees.push(Entree::Agent {
                        texte: rep.texte,
                        raisonnement: rep.raisonnement,
                        blocs: rep.blocs,
                        auteur: agent.clone(),
                    });
                }
                c.restants = restants;
            });
            if !continuer {
                return false;
            }
            if appels.is_empty() {
                return true;
            }
            for (appel, serveur, outil) in appels {
                let argument = outils::argument_principal(&appel.nom, &appel.arguments);
                let commence = self.modifier(conv, |c| {
                    if !c.restants.is_empty() {
                        c.restants.remove(0);
                    }
                    c.entrees.push(Entree::Outil {
                        id: appel.id.clone(),
                        nom: appel.nom.clone(),
                        arguments: appel.arguments.clone(),
                        argument,
                        etat: "enCours".into(),
                        resultat: String::new(),
                        auteur: agent.clone(),
                        etapes: (appel.nom == "subagent").then(Vec::new),
                        serveur,
                        outil,
                    });
                });
                if !commence {
                    return false;
                }
                let r = if appel.nom == "subagent" {
                    self.sous_agent(&p, &appel.arguments, definitions, conv, &appel.id)
                        .await
                } else {
                    self.executer_appel(&ctx, &appel).await
                };
                let fini = self.modifier(conv, |c| {
                    let entree = c.entrees.iter_mut().rev().find(
                        |e| matches!(e, Entree::Outil { id, etat, .. } if *id == appel.id && etat == "enCours"),
                    );
                    if let Some(Entree::Outil {
                        etat, resultat, ..
                    }) = entree
                    {
                        *etat = if r.echec { "echec" } else { "reussi" }.into();
                        *resultat = r.contenu;
                    }
                });
                if !fini {
                    return false;
                }
            }
        }
    }

    /// Arrête le tour en cours. Faux si la conversation n'existe pas.
    pub fn arreter(&self, id: &str) -> bool {
        let tour = verrou(&self.registre).remove(id);
        match tour {
            Some(t) => {
                t.abort.abort();
                let mut c = verrou(&t.conv);
                if c.en_cours {
                    ranger(&mut c, false);
                    c.maj = maintenant();
                    self.sauver_ou_dire(&c);
                }
                true
            }
            None => self.lire(id, 0).is_some(),
        }
    }

    /// La conversation à partir de l'entrée `depuis`. Une conversation marquée en cours
    /// et absente du registre vient d'un Yaide arrêté : elle est remise en ordre.
    pub fn lire(&self, id: &str, depuis: usize) -> Option<Value> {
        if !id_valide(id) {
            return None;
        }
        let registre = verrou(&self.registre);
        let c = match registre.get(id) {
            Some(t) => verrou(&t.conv).clone(),
            None => {
                let mut c = self.charger(id)?;
                if c.en_cours {
                    ranger(&mut c, true);
                    self.sauver_ou_dire(&c);
                }
                c
            }
        };
        drop(registre);
        let total = c.entrees.len();
        Some(json!({
            "titre": c.titre, "profil": c.profil, "enCours": c.en_cours,
            "tokens": c.tokens, "total": total, "actif": c.actif,
            "agents": c.agents.iter().map(|a| json!({
                "dossier": a.dossier, "nom": a.nom, "avatar": a.avatar,
                "couleur": a.couleur, "profil": a.profil, "tokens": a.tokens,
            })).collect::<Vec<_>>(),
            "entrees": c.entrees[depuis.min(total)..],
        }))
    }

    /// `[{ id, titre, maj }]`, le plus récent en premier.
    pub fn liste(&self) -> Value {
        let mut toutes: Vec<Conversation> = std::fs::read_dir(&self.dossier)
            .into_iter()
            .flatten()
            .flatten()
            // Les fichiers temporaires de l'écriture atomique ne sont pas des conversations.
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok())
            .collect();
        toutes.sort_by_key(|a| std::cmp::Reverse(a.maj));
        toutes
            .iter()
            .map(|c| json!({ "id": c.id, "titre": c.titre, "maj": c.maj }))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use axum::{body::Bytes, extract::State, http::StatusCode, Router};
    use std::collections::VecDeque;
    use std::path::Path;
    use std::time::Duration;

    type Script = Arc<Mutex<VecDeque<(u16, Value, u64)>>>;
    type Recues = Arc<Mutex<Vec<Value>>>;

    #[derive(Clone)]
    struct Faux {
        script: Script,
        recues: Recues,
    }

    async fn repondre(State(f): State<Faux>, corps: Bytes) -> (StatusCode, String) {
        f.recues
            .lock()
            .unwrap()
            .push(serde_json::from_slice(&corps).unwrap_or(Value::Null));
        let suivante = f.script.lock().unwrap().pop_front();
        match suivante {
            Some((code, v, delai)) => {
                tokio::time::sleep(Duration::from_millis(delai)).await;
                (StatusCode::from_u16(code).unwrap(), v.to_string())
            }
            None => (StatusCode::INTERNAL_SERVER_ERROR, "plus de réponse".into()),
        }
    }

    struct Banc {
        dir: PathBuf,
        g: Arc<Gestionnaire>,
        reglages: Arc<Reglages>,
        script: Script,
        recues: Recues,
        profil: String,
    }

    fn texte(t: &str, tokens: u64) -> (u16, Value, u64) {
        (
            200,
            json!({"choices": [{"message": {"content": t}}],
                   "usage": {"prompt_tokens": tokens, "completion_tokens": 0}}),
            0,
        )
    }

    fn appels(liste: &[(&str, &str, Value)]) -> (u16, Value, u64) {
        let tc: Vec<Value> = liste
            .iter()
            .map(|(id, nom, a)| {
                json!({"id": id, "type": "function",
                       "function": {"name": nom, "arguments": a.to_string()}})
            })
            .collect();
        (
            200,
            json!({"choices": [{"message": {"content": null, "tool_calls": tc}}],
                   "usage": {"prompt_tokens": 5, "completion_tokens": 1}}),
            0,
        )
    }

    fn gestionnaire(dir: &Path, reglages: &Arc<Reglages>) -> Arc<Gestionnaire> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let agents = Arc::new(Agents::new(dir.join(".yaide"), reglages.clone()));
        Arc::new(Gestionnaire::new(
            dir.to_path_buf(),
            reglages.clone(),
            agents,
            Limites::default(),
        ))
    }

    async fn banc(nom: &str, cle: bool, fenetre: Option<u64>) -> Banc {
        let dir = std::env::temp_dir().join(format!("conv-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dir = dir.canonicalize().unwrap();
        let script: Script = Default::default();
        let recues: Recues = Default::default();
        let app = Router::new().fallback(repondre).with_state(Faux {
            script: script.clone(),
            recues: recues.clone(),
        });
        let ecoute = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let adresse = format!("http://{}", ecoute.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(ecoute, app).await.unwrap() });
        let reglages = Arc::new(Reglages::new(dir.join("config"), dir.join("cfg")));
        let mut corps = json!({"adresse": adresse});
        if cle {
            corps["cle"] = json!("sk-test");
        }
        reglages.enregistrer_provider("openai", &corps).unwrap();
        let mut p = json!({"nom": "p", "provider": "openai", "modele": "m"});
        if let Some(f) = fenetre {
            p["fenetre"] = json!(f);
        }
        reglages.enregistrer_profil(&p).unwrap();
        let profil = reglages.vue()["profils"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let g = gestionnaire(&dir, &reglages);
        Banc {
            dir,
            g,
            reglages,
            script,
            recues,
            profil,
        }
    }

    impl Banc {
        fn scenario(&self, reps: Vec<(u16, Value, u64)>) {
            self.script.lock().unwrap().extend(reps);
        }
        fn envoyer(&self, conv: Option<&str>, t: &str) -> Result<String, ErreurEnvoi> {
            self.g.envoyer(conv, &self.profil, t)
        }
        async fn attendre(&self, id: &str, ok: impl Fn(&Value) -> bool) -> Value {
            for _ in 0..250 {
                let v = self.g.lire(id, 0).unwrap();
                if ok(&v) {
                    return v;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            panic!("condition jamais atteinte : {:?}", self.g.lire(id, 0));
        }
        async fn fini(&self, id: &str) -> Value {
            self.attendre(id, |v| v["enCours"] == false).await
        }
        fn nb_requetes(&self) -> usize {
            self.recues.lock().unwrap().len()
        }
        fn requete(&self, i: usize) -> String {
            self.recues.lock().unwrap()[i].to_string()
        }
        fn fichier(&self, id: &str) -> PathBuf {
            self.dir
                .join(".yaide")
                .join("conversations")
                .join(format!("{id}.json"))
        }
    }

    #[tokio::test]
    async fn REQ055_AC1_read_puis_fini() {
        let b = banc("ac1", true, None).await;
        std::fs::write(b.dir.join("README.md"), "contenu-du-readme").unwrap();
        b.scenario(vec![
            appels(&[("c1", "read", json!({"path": "README.md"}))]),
            texte("fini", 10),
        ]);
        let id = b.envoyer(None, "lis le README").unwrap();
        let v = b.fini(&id).await;
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e.len(), 4, "{e:?}");
        assert_eq!(
            e[0],
            json!({"type": "utilisateur", "texte": "lis le README"})
        );
        assert_eq!(e[1]["type"], "agent");
        assert_eq!(e[2]["type"], "outil");
        assert_eq!(e[2]["nom"], "read");
        assert_eq!(e[2]["argument"], "README.md");
        assert_eq!(e[2]["etat"], "reussi");
        assert!(e[2]["resultat"]
            .as_str()
            .unwrap()
            .contains("contenu-du-readme"));
        assert_eq!(e[3], json!({"type": "agent", "texte": "fini"}));
        assert_eq!(v["tokens"], 10);
        assert_eq!(v["titre"], "lis le README");
        assert!(b.requete(1).contains("contenu-du-readme"));
        assert_eq!(b.nb_requetes(), 2);
        let disque: Value =
            serde_json::from_slice(&std::fs::read(b.fichier(&id)).unwrap()).unwrap();
        assert_eq!(disque["enCours"], false);
        assert_eq!(disque["entrees"].as_array().unwrap().len(), 4);
    }

    #[tokio::test]
    async fn REQ055_AC2_agents_md_dans_les_instructions_ou_absent() {
        let b = banc("ac2", true, None).await;
        std::fs::write(b.dir.join("AGENTS.md"), "regle-maison-42").unwrap();
        b.scenario(vec![texte("ok", 1)]);
        let id = b.envoyer(None, "salut").unwrap();
        b.fini(&id).await;
        assert!(b.requete(0).contains("regle-maison-42"));
        let disque: Value =
            serde_json::from_slice(&std::fs::read(b.fichier(&id)).unwrap()).unwrap();
        assert!(disque["instructions"]
            .as_str()
            .unwrap()
            .contains("regle-maison-42"));

        let c = banc("ac2b", true, None).await;
        c.scenario(vec![texte("ok", 1)]);
        let id = c.envoyer(None, "salut").unwrap();
        let v = c.fini(&id).await;
        assert_eq!(v["entrees"][1]["texte"], "ok");
        assert!(!c.requete(0).contains("AGENTS.md"));
    }

    #[tokio::test]
    async fn REQ055_AC3_second_message_porte_tout_l_historique() {
        let b = banc("ac3", true, None).await;
        std::fs::write(b.dir.join("README.md"), "contenu-du-readme").unwrap();
        b.scenario(vec![
            appels(&[("c1", "read", json!({"path": "README.md"}))]),
            texte("fini", 1),
            texte("deuxieme", 1),
        ]);
        let id = b.envoyer(None, "premier").unwrap();
        b.fini(&id).await;
        b.envoyer(Some(&id), "second").unwrap();
        let v = b.fini(&id).await;
        assert_eq!(v["entrees"].as_array().unwrap().len(), 6);
        let r = b.requete(2);
        for t in ["premier", "contenu-du-readme", "fini", "second"] {
            assert!(r.contains(t), "{t} manque dans {r}");
        }
    }

    #[tokio::test]
    async fn REQ055_AC3_reprise_apres_relecture_du_fichier() {
        let b = banc("ac3r", true, None).await;
        b.scenario(vec![texte("reponse-un", 1), texte("reponse-deux", 1)]);
        let id = b.envoyer(None, "question-un").unwrap();
        b.fini(&id).await;
        let neuf = gestionnaire(&b.dir, &b.reglages);
        neuf.envoyer(Some(&id), &b.profil, "question-deux").unwrap();
        for _ in 0..250 {
            if neuf.lire(&id, 0).unwrap()["enCours"] == false {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let r = b.requete(1);
        assert!(
            r.contains("question-un") && r.contains("reponse-un") && r.contains("question-deux")
        );
        assert_eq!(neuf.lire(&id, 0).unwrap()["total"], 4);
    }

    #[tokio::test]
    async fn REQ055_AC5_erreur_du_provider_finit_le_tour_et_on_renvoie() {
        let b = banc("ac5", true, None).await;
        b.scenario(vec![
            (429, json!({"error": "trop vite"}), 0),
            texte("ca marche", 1),
        ]);
        let id = b.envoyer(None, "un").unwrap();
        let v = b.fini(&id).await;
        let m = &v["entrees"][1];
        assert_eq!(m["type"], "message");
        assert_eq!(m["variante"], "erreur");
        assert_eq!(m["texte"], "OpenAI a refusé la requête (429).");
        assert!(m["detail"].as_str().unwrap().contains("trop vite"));
        b.envoyer(Some(&id), "deux").unwrap();
        let v = b.fini(&id).await;
        assert_eq!(v["entrees"][3]["texte"], "ca marche");
        assert!(!b.requete(1).contains("trop vite"));

        // adresse injoignable
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        b.reglages
            .enregistrer_provider(
                "openai",
                &json!({"adresse": format!("http://127.0.0.1:{port}")}),
            )
            .unwrap();
        b.envoyer(Some(&id), "trois").unwrap();
        let v = b.fini(&id).await;
        let t = v["entrees"][5]["texte"].as_str().unwrap().to_string();
        assert!(
            t.starts_with("OpenAI est injoignable : ") && t.ends_with('.'),
            "{t}"
        );
    }

    #[tokio::test]
    async fn REQ055_AC6_sans_cle_refus_sans_requete_ni_fichier() {
        let b = banc("ac6", false, None).await;
        let r = b.envoyer(None, "salut").unwrap_err();
        assert_eq!(
            r,
            ErreurEnvoi::Refus(Refus {
                motif: "sans-cle",
                provider: Some("OpenAI")
            })
        );
        assert_eq!(b.nb_requetes(), 0);
        assert!(!b.dir.join(".yaide").join("conversations").exists());
        assert_eq!(b.g.liste(), json!([]));
        let r = b.g.envoyer(None, "inconnu", "salut").unwrap_err();
        assert_eq!(
            r,
            ErreurEnvoi::Refus(Refus {
                motif: "sans-profil",
                provider: None
            })
        );
    }

    #[tokio::test]
    async fn liste_ignore_les_fichiers_temporaires() {
        let b = banc("liste-tmp", false, None).await;
        let dossier = b.dir.join(".yaide").join("conversations");
        std::fs::create_dir_all(&dossier).unwrap();
        let c = json!({ "id": "a1", "titre": "t", "profil": "p", "cree": 1, "maj": 1,
            "enCours": false, "instructions": "", "tokens": 0, "entrees": [] });
        std::fs::write(dossier.join("a1.json"), c.to_string()).unwrap();
        std::fs::write(dossier.join("a1.tmp123"), c.to_string()).unwrap();
        assert_eq!(b.g.liste().as_array().unwrap().len(), 1);
    }

    fn resultats_dans(requete: &str) -> usize {
        let v: Value = serde_json::from_str(requete).unwrap();
        v["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["role"] == "tool")
            .count()
    }

    #[tokio::test]
    async fn REQ055_AC7_arreter_pendant_la_requete_et_pendant_bash() {
        let b = banc("ac7", true, None).await;
        // pendant la requête
        let mut lente = texte("trop tard", 1);
        lente.2 = 30_000;
        b.scenario(vec![lente]);
        let id = b.envoyer(None, "un").unwrap();
        b.attendre(&id, |_| b.nb_requetes() == 1).await;
        assert!(b.g.arreter(&id));
        let v = b.g.lire(&id, 0).unwrap();
        assert_eq!(v["enCours"], false);
        assert_eq!(v["entrees"][1], json!({"type": "fin", "texte": "Arrêté."}));

        // pendant bash, avec un second appel jamais commencé
        b.scenario(vec![
            appels(&[
                ("b1", "bash", json!({"command": "sleep 30"})),
                ("b2", "read", json!({"path": "absent.txt"})),
            ]),
            texte("repris", 1),
        ]);
        b.envoyer(Some(&id), "deux").unwrap();
        b.attendre(&id, |v| {
            v["entrees"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["type"] == "outil" && e["etat"] == "enCours")
        })
        .await;
        assert!(b.g.arreter(&id));
        let v = b.g.lire(&id, 0).unwrap();
        assert_eq!(v["enCours"], false);
        let e = v["entrees"].as_array().unwrap();
        let n = e.len();
        assert_eq!(e[n - 3]["id"], "b1");
        assert_eq!(e[n - 3]["etat"], "echec");
        assert_eq!(e[n - 3]["resultat"], "Stopped by the user.");
        assert_eq!(e[n - 2]["id"], "b2");
        assert_eq!(e[n - 2]["etat"], "echec");
        assert_eq!(e[n - 2]["resultat"], "Not run: stopped by the user.");
        assert_eq!(e[n - 1], json!({"type": "fin", "texte": "Arrêté."}));
        let disque: Value =
            serde_json::from_slice(&std::fs::read(b.fichier(&id)).unwrap()).unwrap();
        assert_eq!(disque["enCours"], false);
        assert_eq!(disque["entrees"].as_array().unwrap().len(), n);

        // le message suivant passe, avec un résultat par appel
        b.envoyer(Some(&id), "trois").unwrap();
        let v = b.fini(&id).await;
        assert_eq!(v["entrees"][n + 1]["texte"], "repris");
        assert_eq!(resultats_dans(&b.requete(b.nb_requetes() - 1)), 2);
    }

    #[tokio::test]
    async fn REQ055_AC9_en_cours_sans_tour_devient_interrompu() {
        let b = banc("ac9", true, None).await;
        let c = Conversation {
            id: "abc".into(),
            titre: "t".into(),
            profil: b.profil.clone(),
            cree: 1,
            maj: 1,
            en_cours: true,
            instructions: String::new(),
            tokens: 0,
            entrees: vec![
                Entree::Utilisateur { texte: "u".into() },
                Entree::Agent {
                    texte: String::new(),
                    auteur: None,
                    raisonnement: String::new(),
                    blocs: Vec::new(),
                },
                Entree::Outil {
                    id: "x".into(),
                    nom: "bash".into(),
                    arguments: json!({"command": "sleep 9"}),
                    argument: "sleep 9".into(),
                    etat: "enCours".into(),
                    resultat: String::new(),
                    auteur: None,
                    serveur: None,
                    outil: None,
                    etapes: None,
                },
            ],
            agents: vec![],
            actif: None,
            restants: vec![],
        };
        b.g.sauver(&c).unwrap();
        let v = b.g.lire("abc", 0).unwrap();
        assert_eq!(v["enCours"], false);
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e.len(), 4);
        assert_eq!(e[2]["etat"], "echec");
        assert_eq!(
            e[3],
            json!({"type": "message", "variante": "alerte",
                   "texte": "Interrompu : Yaide a été arrêté.", "detail": ""})
        );
        let disque: Value =
            serde_json::from_slice(&std::fs::read(b.fichier("abc")).unwrap()).unwrap();
        assert_eq!(disque["enCours"], false);
        assert_eq!(disque["entrees"].as_array().unwrap().len(), 4);
        assert_eq!(b.g.lire("abc", 4).unwrap()["entrees"], json!([]));
        assert!(b.g.lire("../x", 0).is_none());
    }

    #[tokio::test]
    async fn REQ055_AC10_contexte_plein() {
        let b = banc("ac10", true, Some(100)).await;
        b.scenario(vec![texte("a", 100), texte("b", 1)]);
        let id = b.envoyer(None, "un").unwrap();
        b.fini(&id).await;
        let avant = std::fs::read(b.fichier(&id)).unwrap();
        let r = b.envoyer(Some(&id), "deux").unwrap_err();
        assert_eq!(
            r,
            ErreurEnvoi::Refus(Refus {
                motif: "contexte-plein",
                provider: Some("OpenAI")
            })
        );
        assert_eq!(b.nb_requetes(), 1);
        assert_eq!(std::fs::read(b.fichier(&id)).unwrap(), avant);
        assert_eq!(b.g.lire(&id, 0).unwrap()["total"], 2);
    }

    #[tokio::test]
    async fn refus_en_cours_pendant_un_tour() {
        let b = banc("encours", true, None).await;
        let mut lente = texte("a", 1);
        lente.2 = 30_000;
        b.scenario(vec![lente]);
        let id = b.envoyer(None, "un").unwrap();
        let r = b.envoyer(Some(&id), "deux").unwrap_err();
        assert_eq!(
            r,
            ErreurEnvoi::Refus(Refus {
                motif: "en-cours",
                provider: Some("OpenAI")
            })
        );
        assert_eq!(b.g.lire(&id, 0).unwrap()["total"], 1);
        assert_eq!(
            b.g.envoyer(Some("inconnue"), &b.profil, "x").unwrap_err(),
            ErreurEnvoi::Inconnue
        );
        b.g.arreter(&id);
    }

    // --- plusieurs agents (REQ-066, REQ-067) ---

    impl Banc {
        /// Un second profil, sur un autre modèle.
        fn profil2(&self) -> String {
            self.reglages
                .enregistrer_profil(&json!({"nom": "p2", "provider": "openai", "modele": "m2"}))
                .unwrap();
            self.reglages.vue()["profils"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["nom"] == "p2")
                .unwrap()["id"]
                .as_str()
                .unwrap()
                .to_string()
        }
        /// Un agent, avec son dossier sur le disque.
        fn agent(&self, nom: &str, profil: Option<&str>) -> Agent {
            let dossier = nom.to_lowercase();
            std::fs::create_dir_all(self.dir.join(".yaide/agents").join(&dossier)).unwrap();
            Agent {
                dossier,
                nom: nom.into(),
                avatar: String::new(),
                couleur: "violet".into(),
                profil: profil.map(String::from),
            }
        }
        fn fichier_agent(&self, a: &Agent, nom: &str, texte: &str) {
            std::fs::write(
                self.dir.join(".yaide/agents").join(&a.dossier).join(nom),
                texte,
            )
            .unwrap();
        }
        fn envoyer_a(
            &self,
            conv: Option<&str>,
            agents: &[Agent],
            t: &str,
        ) -> Result<String, ErreurEnvoi> {
            self.g.envoyer_avec(conv, "", agents, t)
        }
        fn corps(&self, i: usize) -> Value {
            self.recues.lock().unwrap()[i].clone()
        }
    }

    fn roles(corps: &Value) -> Vec<(String, String)> {
        corps["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| {
                (
                    m["role"].as_str().unwrap().to_string(),
                    m["content"].as_str().unwrap_or("").to_string(),
                )
            })
            .collect()
    }

    #[tokio::test]
    async fn REQ066_AC3_instructions_nom_racine_persona_agents_dans_l_ordre() {
        let b = banc("m-ac3", true, None).await;
        std::fs::write(b.dir.join("AGENTS.md"), "regle-maison-42").unwrap();
        let rel = b.agent("Relecteur", None);
        let tes = b.agent("Testeur", None);
        b.fichier_agent(&rel, "PERSONA.md", "persona-43");
        b.fichier_agent(&rel, "AGENTS.md", "memoire-44");
        b.scenario(vec![texte("a", 1), texte("b", 1)]);
        let id = b.envoyer_a(None, &[rel, tes], "salut").unwrap();
        b.fini(&id).await;
        let r = b.requete(0);
        let pos = |t: &str| r.find(t).unwrap_or_else(|| panic!("{t} absent de {r}"));
        assert!(pos("Your name is Relecteur") < pos("regle-maison-42"));
        assert!(pos("regle-maison-42") < pos("persona-43"));
        assert!(pos("persona-43") < pos("memoire-44"));
        assert!(r.contains("and with the agents Testeur, who answer in turn."));
        assert!(!b.requete(1).contains("persona-43"));
        assert!(b.requete(1).contains("Your name is Testeur"));
    }

    #[tokio::test]
    async fn REQ066_AC4_fichiers_absents_sans_erreur() {
        let b = banc("m-ac4", true, None).await;
        let rel = Agent {
            dossier: "sans-dossier".into(),
            ..b.agent("Relecteur", None)
        };
        b.scenario(vec![texte("ok", 1)]);
        let id = b.envoyer_a(None, &[rel], "salut").unwrap();
        let v = b.fini(&id).await;
        assert_eq!(v["entrees"][1]["texte"], "ok");
        assert!(v["entrees"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["type"] != "message"));
        assert!(!b.requete(0).contains("PERSONA"));
        assert!(b.requete(0).contains("You talk with the user."));
    }

    #[tokio::test]
    async fn REQ066_AC5_instructions_gardees_apres_modification() {
        let b = banc("m-ac5", true, None).await;
        let rel = b.agent("Relecteur", None);
        b.fichier_agent(&rel, "PERSONA.md", "ancien-persona");
        b.scenario(vec![texte("a", 1), texte("b", 1), texte("c", 1)]);
        let id = b.envoyer_a(None, std::slice::from_ref(&rel), "un").unwrap();
        b.fini(&id).await;
        b.fichier_agent(&rel, "PERSONA.md", "nouveau-persona");
        b.envoyer_a(Some(&id), &[], "deux").unwrap();
        b.attendre(&id, |v| v["total"] == 4 && v["enCours"] == false)
            .await;
        assert!(b.requete(1).contains("ancien-persona"));
        assert!(!b.requete(1).contains("nouveau-persona"));
        let neuve = b.envoyer_a(None, &[rel], "trois").unwrap();
        b.fini(&neuve).await;
        assert!(b.requete(2).contains("nouveau-persona"));
    }

    #[tokio::test]
    async fn REQ067_AC3_le_second_voit_la_reponse_du_premier_sans_ses_outils() {
        let b = banc("m-ac3b", true, None).await;
        let p2 = b.profil2();
        std::fs::write(b.dir.join("README.md"), "contenu-du-readme").unwrap();
        let rel = b.agent("Relecteur", Some(&b.profil.clone()));
        let tes = b.agent("Testeur", Some(&p2));
        b.scenario(vec![
            appels(&[("c1", "read", json!({"path": "README.md"}))]),
            texte("reponse-rel", 10),
            texte("reponse-tes", 20),
        ]);
        let id = b.envoyer_a(None, &[rel, tes], "go").unwrap();
        let v = b.fini(&id).await;
        assert_eq!(b.nb_requetes(), 3);
        assert_eq!(b.corps(0)["model"], "m");
        assert_eq!(b.corps(1)["model"], "m");
        assert_eq!(b.corps(2)["model"], "m2");
        let m = roles(&b.corps(2));
        assert_eq!(
            &m[1..],
            [(
                "user".to_string(),
                "go\n\n[Relecteur] reponse-rel".to_string()
            )]
        );
        assert!(!b.requete(2).contains("contenu-du-readme"));
        // le premier voit ses propres outils
        assert!(b.requete(1).contains("contenu-du-readme"));
        // auteurs, jetons, tour fini
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e.len(), 5);
        assert_eq!(e[2]["auteur"], "relecteur");
        assert_eq!(e[4]["auteur"], "testeur");
        assert_eq!(v["actif"], Value::Null);
        assert_eq!(v["tokens"], 20);
        assert_eq!(v["agents"][0]["tokens"], 10);
        assert_eq!(v["agents"][1]["tokens"], 20);
        assert!(v["agents"][0].get("instructions").is_none());
    }

    #[tokio::test]
    async fn REQ067_AC4_second_message_historique_et_reprise_apres_relecture() {
        let b = banc("m-ac4b", true, None).await;
        std::fs::write(b.dir.join("README.md"), "contenu-du-readme").unwrap();
        let rel = b.agent("Relecteur", None);
        let tes = b.agent("Testeur", None);
        b.scenario(vec![
            appels(&[("c1", "read", json!({"path": "README.md"}))]),
            texte("rep-rel", 1),
            texte("rep-tes", 1),
            texte("rel2", 1),
            texte("tes2", 1),
        ]);
        let id = b.envoyer_a(None, &[rel, tes], "go").unwrap();
        b.fini(&id).await;
        // Yaide redémarre : un nouveau gestionnaire relit le fichier
        let neuf = gestionnaire(&b.dir, &b.reglages);
        neuf.envoyer_avec(Some(&id), "", &[], "deux").unwrap();
        for _ in 0..250 {
            if neuf.lire(&id, 0).unwrap()["enCours"] == false {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let v = neuf.lire(&id, 0).unwrap();
        assert_eq!(v["total"], 8, "{v}");
        assert_eq!(b.nb_requetes(), 5);
        let r = b.requete(3);
        assert!(r.contains("contenu-du-readme") && r.contains("tool_calls"));
        assert!(r.contains("rep-rel") && r.contains("deux"));
        assert!(r.contains("[Testeur] rep-tes"));
        let m = roles(&b.corps(4));
        let dernier = &m.last().unwrap().1;
        assert!(m[1].1.contains("[Relecteur] rep-rel"), "{m:?}");
        assert!(
            m.contains(&("assistant".to_string(), "rep-tes".to_string())),
            "{m:?}"
        );
        assert!(dernier.contains("[Relecteur] rel2"), "{m:?}");
        assert!(!b.requete(4).contains("contenu-du-readme"));
    }

    #[tokio::test]
    async fn REQ067_AC5_un_seul_agent() {
        let b = banc("m-ac5b", true, None).await;
        let rel = b.agent("Relecteur", None);
        b.scenario(vec![texte("seul", 3)]);
        let id = b.envoyer_a(None, &[rel], "go").unwrap();
        let v = b.fini(&id).await;
        assert_eq!(b.nb_requetes(), 1);
        assert_eq!(v["entrees"][1]["texte"], "seul");
        assert_eq!(v["entrees"][1]["auteur"], "relecteur");
        assert!(b.requete(0).contains("Your name is Relecteur"));
        assert!(!b.requete(0).contains("and with the agents"));
    }

    #[tokio::test]
    async fn REQ067_AC7_arreter_pendant_le_premier_le_second_ne_repond_pas() {
        let b = banc("m-ac7", true, None).await;
        let rel = b.agent("Relecteur", None);
        let tes = b.agent("Testeur", None);
        let mut lente = texte("trop tard", 1);
        lente.2 = 30_000;
        b.scenario(vec![lente]);
        let id = b.envoyer_a(None, &[rel, tes], "go").unwrap();
        b.attendre(&id, |v| b.nb_requetes() == 1 && v["actif"] == "relecteur")
            .await;
        assert!(b.g.arreter(&id));
        let v = b.g.lire(&id, 0).unwrap();
        assert_eq!(v["enCours"], false);
        assert_eq!(v["actif"], Value::Null);
        assert_eq!(
            v["entrees"][1],
            json!({"type": "fin", "texte": "Arrêté.", "auteur": "relecteur"})
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(b.nb_requetes(), 1);
        // le message suivant fait répondre les deux
        b.scenario(vec![texte("a", 1), texte("b", 1)]);
        b.envoyer_a(Some(&id), &[], "deux").unwrap();
        let v = b
            .attendre(&id, |v| v["total"] == 5 && v["enCours"] == false)
            .await;
        assert_eq!(v["entrees"][3]["auteur"], "relecteur");
        assert_eq!(v["entrees"][4]["auteur"], "testeur");
    }

    #[tokio::test]
    async fn REQ067_AC8_erreur_du_premier_finit_le_tour() {
        let b = banc("m-ac8", true, None).await;
        let rel = b.agent("Relecteur", None);
        let tes = b.agent("Testeur", None);
        b.scenario(vec![(429, json!({"error": "trop"}), 0), texte("jamais", 1)]);
        let id = b.envoyer_a(None, &[rel, tes], "go").unwrap();
        let v = b.fini(&id).await;
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e.len(), 2, "{e:?}");
        assert_eq!(e[1]["type"], "message");
        assert_eq!(e[1]["variante"], "erreur");
        assert_eq!(e[1]["texte"], "OpenAI a refusé la requête (429).");
        assert_eq!(v["actif"], Value::Null);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(b.nb_requetes(), 1);
        // on peut renvoyer un message
        b.envoyer_a(Some(&id), &[], "encore").unwrap();
        b.fini(&id).await;
    }

    #[tokio::test]
    async fn REQ067_AC9_sans_cle_pour_le_second_aucune_requete() {
        let b = banc("m-ac9", true, None).await;
        b.reglages
            .enregistrer_profil(&json!({"nom": "an", "provider": "anthropic", "modele": "c"}))
            .unwrap();
        let an = b.reglages.vue()["profils"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["nom"] == "an")
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        let rel = b.agent("Relecteur", None);
        let tes = b.agent("Testeur", Some(&an));
        let r = b.envoyer_a(None, &[rel, tes], "go").unwrap_err();
        assert_eq!(
            r,
            ErreurEnvoi::Refus(Refus {
                motif: "sans-cle",
                provider: Some("Anthropic")
            })
        );
        assert_eq!(b.nb_requetes(), 0);
        assert!(!b.dir.join(".yaide").join("conversations").exists());
    }

    #[tokio::test]
    async fn REQ067_AC11_copie_prise_au_premier_message() {
        let b = banc("m-ac11", true, None).await;
        let rel = b.agent("Relecteur", None);
        b.scenario(vec![texte("a", 1), texte("b", 1), texte("c", 1)]);
        let id = b.envoyer_a(None, std::slice::from_ref(&rel), "un").unwrap();
        b.fini(&id).await;
        let modifie = Agent {
            couleur: "rose".into(),
            nom: "Autre".into(),
            ..rel
        };
        b.envoyer_a(Some(&id), std::slice::from_ref(&modifie), "deux")
            .unwrap();
        let v = b
            .attendre(&id, |v| v["total"] == 4 && v["enCours"] == false)
            .await;
        assert_eq!(v["agents"][0]["couleur"], "violet");
        assert_eq!(v["agents"][0]["nom"], "Relecteur");
        assert_eq!(v["agents"].as_array().unwrap().len(), 1);
        let neuve = b.envoyer_a(None, &[modifie], "trois").unwrap();
        let v = b.fini(&neuve).await;
        assert_eq!(v["agents"][0]["couleur"], "rose");
    }

    #[tokio::test]
    async fn REQ067_profil_supprime_prend_le_defaut() {
        let b = banc("m-supp", true, None).await;
        let p2 = b.profil2();
        let rel = b.agent("Relecteur", Some(&p2));
        b.reglages.supprimer_profil(&p2).unwrap();
        b.scenario(vec![texte("ok", 1)]);
        let id = b.envoyer_a(None, &[rel], "go").unwrap();
        b.fini(&id).await;
        assert_eq!(b.corps(0)["model"], "m");
        // aucun profil : refus
        b.reglages.supprimer_profil(&b.profil).unwrap();
        let rel = b.agent("Testeur", None);
        let r = b.envoyer_a(None, &[rel], "go").unwrap_err();
        assert_eq!(
            r,
            ErreurEnvoi::Refus(Refus {
                motif: "sans-profil",
                provider: None
            })
        );
    }

    #[test]
    fn messages_pour_reunit_les_messages_utilisateur() {
        let u = |t: &str| Entree::Utilisateur { texte: t.into() };
        let a = |t: &str, d: &str| Entree::Agent {
            texte: t.into(),
            auteur: Some(d.into()),
            raisonnement: String::new(),
            blocs: Vec::new(),
        };
        let entrees = vec![u("un"), u("deux"), a("rep", "a"), a("", "a"), u("trois")];
        let noms = vec![("a".to_string(), "Alice".to_string())];
        let m = messages_pour(&entrees, Some("b"), &noms);
        assert_eq!(m.len(), 1);
        assert!(
            matches!(&m[0], Message::Utilisateur(t) if t == "un\n\ndeux\n\n[Alice] rep\n\ntrois")
        );
        // sans agent : rien n'est réuni
        let sans = messages(&[u("a"), u("b")]);
        assert_eq!(sans.len(), 2);
        // pour Alice : ses réponses restent les siennes
        // (une réponse vide ne donne plus de message vide)
        let m = messages_pour(&entrees, Some("a"), &noms);
        assert_eq!(m.len(), 3);
    }

    #[test]
    fn titre_premiere_ligne_coupee_a_50() {
        assert_eq!(titre("bonjour\nsuite"), "bonjour");
        assert_eq!(titre("\n  salut  \nx"), "salut");
        let cinquante = "é".repeat(50);
        assert_eq!(titre(&cinquante), cinquante);
        assert_eq!(titre(&format!("{cinquante}x")), format!("{cinquante}…"));
    }

    #[test]
    fn REQ085_AC7_les_blocs_et_le_raisonnement_d_un_autre_agent_ne_partent_pas() {
        let bloc = json!({"type": "thinking", "thinking": "secret", "signature": "s"});
        let entrees = vec![
            Entree::Utilisateur { texte: "q".into() },
            Entree::Agent {
                texte: "avis".into(),
                auteur: Some("r".into()),
                raisonnement: "secret".into(),
                blocs: vec![bloc.clone()],
            },
        ];
        let noms = vec![("r".to_string(), "Relecteur".to_string())];
        let pour_testeur = messages_pour(&entrees, Some("t"), &noms);
        assert_eq!(pour_testeur.len(), 1);
        assert!(
            matches!(&pour_testeur[0], Message::Utilisateur(t) if t == "q\n\n[Relecteur] avis")
        );
        let pour_relecteur = messages_pour(&entrees, Some("r"), &noms);
        assert!(matches!(&pour_relecteur[1],
            Message::Agent { blocs, .. } if *blocs == vec![bloc]));
    }

    #[test]
    fn REQ085_AC6_entree_agent_ancienne_se_lit_et_s_ecrit_comme_avant() {
        let e: Entree = serde_json::from_str(r#"{"type":"agent","texte":"salut"}"#).unwrap();
        assert_eq!(
            e,
            Entree::Agent {
                texte: "salut".into(),
                auteur: None,
                raisonnement: String::new(),
                blocs: Vec::new()
            }
        );
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({"type": "agent", "texte": "salut"})
        );
    }

    #[test]
    fn REQ085_AC6_une_entree_avec_seulement_du_raisonnement_ne_donne_aucun_message() {
        let entrees = vec![
            Entree::Utilisateur { texte: "q".into() },
            Entree::Agent {
                texte: String::new(),
                auteur: None,
                raisonnement: "je pense".into(),
                blocs: Vec::new(),
            },
        ];
        let m = messages_pour(&entrees, None, &[]);
        assert_eq!(m.len(), 1);
        assert!(matches!(&m[0], Message::Utilisateur(_)));
    }

    // --- serveurs MCP (REQ-095) ---

    fn faux_mcp() -> String {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/faux-mcp.mjs")
            .display()
            .to_string()
    }

    impl Banc {
        /// `mcp.json` de l'utilisateur avec ces serveurs : (nom, options du faux serveur).
        fn mcp(&self, serveurs: &[(&str, Vec<String>)]) {
            let corps: Vec<String> = serveurs
                .iter()
                .map(|(n, o)| {
                    let mut args = vec![faux_mcp()];
                    args.extend(o.iter().cloned());
                    format!("{}:{}", json!(n), json!({"command": "node", "args": args}))
                })
                .collect();
            // Un `.yaide/mcp.json` du projet, sans effet : seul le fichier de l'utilisateur compte.
            std::fs::create_dir_all(self.dir.join(".yaide")).unwrap();
            std::fs::write(
                self.dir.join(".yaide/mcp.json"),
                r#"{"mcpServers":{"projet":{"command":"node","args":[]}}}"#,
            )
            .unwrap();
            let fichier = self.reglages.dossier().join("mcp.json");
            std::fs::create_dir_all(self.reglages.dossier()).unwrap();
            std::fs::write(
                fichier,
                format!("{{\"mcpServers\":{{{}}}}}", corps.join(",")),
            )
            .unwrap();
        }
    }

    fn noms_outils(corps: &Value) -> Vec<String> {
        corps["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["function"]["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn REQ097_AC1_REQ098_AC1_list_agents_et_save_agent_offerts_avec_ou_sans_agent() {
        let b = banc("a097-ac1", true, None).await;
        let rel = b.agent("Relecteur", None);
        b.scenario(vec![texte("a", 1), texte("b", 1)]);
        let id = b.envoyer(None, "un").unwrap();
        b.fini(&id).await;
        let id2 = b
            .envoyer_a(None, std::slice::from_ref(&rel), "deux")
            .unwrap();
        b.fini(&id2).await;
        for i in 0..2 {
            let corps: Value = serde_json::from_str(&b.requete(i)).unwrap();
            let noms = noms_outils(&corps);
            let attendus: Vec<String> = outils::definitions().into_iter().map(|d| d.nom).collect();
            assert_eq!(noms, attendus, "requête {i}");
            for n in [
                "list_agents",
                "save_agent",
                "get_config",
                "save_provider",
                "save_profile",
                "save_mcp_server",
                "save_interface",
            ] {
                let t = corps["tools"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|t| t["function"]["name"] == n)
                    .unwrap_or_else(|| panic!("{n} absent de la requête {i}"));
                assert!(!t["function"]["description"].as_str().unwrap().is_empty());
                assert_eq!(t["function"]["parameters"]["type"], "object");
                let props = t["function"]["parameters"]["properties"]
                    .as_object()
                    .unwrap();
                assert!(!props.contains_key("key") && !props.contains_key("api_key"));
            }
        }
    }

    #[tokio::test]
    async fn REQ095_AC1_AC2_outil_mcp_offert_appele_et_journalise() {
        let b = banc("mcp-ac1", true, None).await;
        b.mcp(&[("echo", vec![])]);
        b.scenario(vec![
            appels(&[("m1", "mcp__echo__dire", json!({"texte": "bonjour"}))]),
            texte("fini", 3),
        ]);
        let id = b.envoyer(None, "dis").unwrap();
        let v = b.fini(&id).await;
        // AC-095-1
        let outils = noms_outils(&serde_json::from_str(&b.requete(0)).unwrap());
        let mut attendus: Vec<String> = outils::definitions().into_iter().map(|d| d.nom).collect();
        attendus.push("mcp__echo__dire".into());
        assert_eq!(outils, attendus);
        let corps: Value = serde_json::from_str(&b.requete(0)).unwrap();
        let def = corps["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["function"]["name"] == "mcp__echo__dire")
            .unwrap();
        assert_eq!(def["function"]["description"], "Outil dire du faux serveur");
        assert_eq!(
            def["function"]["parameters"]["properties"]["texte"]["type"],
            "string"
        );
        // AC-095-2
        assert!(b.requete(1).contains("dit: bonjour"));
        assert_eq!(b.nb_requetes(), 2);
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e.len(), 4, "{e:?}");
        assert_eq!(e[2]["nom"], "mcp__echo__dire");
        assert_eq!(e[2]["serveur"], "echo");
        assert_eq!(e[2]["outil"], "dire");
        assert_eq!(e[2]["argument"], "{\"texte\":\"bonjour\"}");
        assert_eq!(e[2]["etat"], "reussi");
        assert_eq!(e[2]["resultat"], "dit: bonjour");
        assert_eq!(e[3]["texte"], "fini");
    }

    #[tokio::test]
    async fn REQ095_AC6_AC14_problemes_en_alertes_apres_le_message_a_chaque_tour() {
        let b = banc("mcp-ac6", true, None).await;
        std::fs::create_dir_all(b.reglages.dossier()).unwrap();
        std::fs::write(
            b.reglages.dossier().join("mcp.json"),
            r#"{"mcpServers":{"un":{"url":"https://a.example/mcp"},"deux":{"args":[]},"ok":{"command":"node","args":["FAUX"]}}}"#
                .replace("FAUX", &faux_mcp()),
        )
        .unwrap();
        b.scenario(vec![texte("a", 1), texte("b", 1)]);
        let id = b.envoyer(None, "un").unwrap();
        let v = b.fini(&id).await;
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e[0]["type"], "utilisateur");
        assert_eq!(e[1]["type"], "message");
        assert_eq!(e[1]["variante"], "alerte");
        assert!(e[1]["texte"]
            .as_str()
            .unwrap()
            .contains("Le serveur MCP un n'a pas démarré"));
        assert_eq!(e[2]["variante"], "alerte");
        assert!(e[2]["texte"]
            .as_str()
            .unwrap()
            .contains("Le serveur MCP deux n'a pas démarré"));
        assert_eq!(e[3]["type"], "agent");
        // le tour continue avec les outils de REQ-057 et celui du serveur sain
        let outils = noms_outils(&serde_json::from_str(&b.requete(0)).unwrap());
        assert!(outils.contains(&"read".to_string()) && outils.contains(&"mcp__ok__dire".into()));
        // les problèmes reviennent au tour suivant
        b.envoyer(Some(&id), "deux").unwrap();
        let v = b.fini(&id).await;
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e.len(), 8, "{e:?}");
        assert_eq!(e[5]["variante"], "alerte");
        assert_eq!(e[6]["variante"], "alerte");
        assert_eq!(e[7]["type"], "agent");
        // JSON cassé
        std::fs::write(b.reglages.dossier().join("mcp.json"), "{").unwrap();
        b.scenario(vec![texte("c", 1)]);
        b.envoyer(Some(&id), "trois").unwrap();
        let v = b.fini(&id).await;
        let e = v["entrees"].as_array().unwrap();
        assert!(e[9]["texte"].as_str().unwrap().starts_with(&format!(
            "{} est illisible. Corrigez-le pour utiliser ses serveurs.",
            b.reglages.dossier().join("mcp.json").display()
        )));
        assert_ne!(e[9]["detail"], "");
        assert_eq!(e[10]["texte"], "c");
        let outils = noms_outils(&serde_json::from_str(&b.requete(b.nb_requetes() - 1)).unwrap());
        assert_eq!(outils.len(), outils::definitions().len());
    }

    #[tokio::test]
    async fn REQ095_AC9_arreter_pendant_un_appel_puis_le_serveur_repond() {
        let b = banc("mcp-ac9", true, None).await;
        let note = b.dir.join("note.jsonl");
        b.mcp(&[(
            "echo",
            vec!["--delai=1500".into(), format!("--note={}", note.display())],
        )]);
        b.scenario(vec![appels(&[
            ("m1", "mcp__echo__dire", json!({"texte": "x"})),
            ("m0", "mcp__echo__dire", json!({"texte": "y"})),
        ])]);
        let id = b.envoyer(None, "un").unwrap();
        b.attendre(&id, |v| {
            v["entrees"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["type"] == "outil" && e["etat"] == "enCours")
        })
        .await;
        assert!(b.g.arreter(&id));
        let v = b.g.lire(&id, 0).unwrap();
        let e = v["entrees"].as_array().unwrap();
        let n = e.len();
        assert_eq!(e[n - 3]["id"], "m1");
        assert_eq!(e[n - 3]["etat"], "echec");
        assert_eq!(e[n - 3]["serveur"], "echo");
        assert_eq!(e[n - 2]["id"], "m0");
        assert_eq!(e[n - 2]["resultat"], "Not run: stopped by the user.");
        assert_eq!(e[n - 2]["serveur"], "echo");
        assert_eq!(e[n - 2]["outil"], "dire");
        assert_eq!(e[n - 1], json!({"type": "fin", "texte": "Arrêté."}));
        b.scenario(vec![
            appels(&[("m2", "mcp__echo__dire", json!({"texte": "encore"}))]),
            texte("fini", 1),
        ]);
        b.envoyer(Some(&id), "deux").unwrap();
        let v = b.fini(&id).await;
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e[e.len() - 2]["resultat"], "dit: encore");
        assert_eq!(e[e.len() - 2]["etat"], "reussi");
        // un seul processus pour les deux tours
        assert_eq!(std::fs::read_to_string(&note).unwrap().lines().count(), 1);
    }

    #[tokio::test]
    async fn REQ095_AC10_deux_agents_recoivent_et_appellent_les_outils_mcp() {
        let b = banc("mcp-ac10", true, None).await;
        let rel = b.agent("Relecteur", None);
        let tes = b.agent("Testeur", None);
        b.mcp(&[("echo", vec![]), ("cassé", vec!["--quitter=1".into()])]);
        b.scenario(vec![
            appels(&[("m1", "mcp__echo__dire", json!({"texte": "un"}))]),
            texte("rel", 1),
            appels(&[("m2", "mcp__echo__dire", json!({"texte": "deux"}))]),
            texte("tes", 1),
        ]);
        let id = b.envoyer_a(None, &[rel, tes], "go").unwrap();
        let v = b.fini(&id).await;
        assert_eq!(b.nb_requetes(), 4);
        for i in [0, 2] {
            let outils = noms_outils(&b.corps(i));
            assert!(outils.contains(&"mcp__echo__dire".to_string()), "{i}");
        }
        let e = v["entrees"].as_array().unwrap();
        let alertes = e.iter().filter(|x| x["type"] == "message").count();
        assert_eq!(alertes, 1, "une seule fois par message : {e:?}");
        assert_eq!(e[1]["variante"], "alerte");
        let appels_mcp: Vec<(&Value, &Value)> = e
            .iter()
            .filter(|x| x["type"] == "outil")
            .map(|x| (&x["auteur"], &x["resultat"]))
            .collect();
        assert_eq!(
            appels_mcp,
            vec![
                (&json!("relecteur"), &json!("dit: un")),
                (&json!("testeur"), &json!("dit: deux"))
            ]
        );
    }

    // --- outil subagent (REQ-100) ---

    fn sous(prompt: &str) -> (u16, Value, u64) {
        appels(&[("s1", "subagent", json!({"prompt": prompt}))])
    }

    fn outil_de<'a>(v: &'a Value, nom: &str) -> &'a Value {
        v["entrees"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "outil" && e["nom"] == nom)
            .unwrap_or_else(|| panic!("outil {nom} absent : {v}"))
    }

    #[tokio::test]
    async fn REQ100_AC1_subagent_offert_avec_ou_sans_agent() {
        let b = banc("a100-ac1", true, None).await;
        let rel = b.agent("Relecteur", None);
        b.scenario(vec![texte("a", 1), texte("b", 1)]);
        let id = b.envoyer(None, "un").unwrap();
        b.fini(&id).await;
        let id2 = b.envoyer_a(None, &[rel], "deux").unwrap();
        b.fini(&id2).await;
        for i in 0..2 {
            let corps = b.corps(i);
            let t = corps["tools"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["function"]["name"] == "subagent")
                .unwrap_or_else(|| panic!("subagent absent de la requête {i}"));
            assert!(t["function"]["description"]
                .as_str()
                .unwrap()
                .contains("temporary subagent"));
            assert_eq!(
                t["function"]["parameters"]["properties"]["prompt"]["type"],
                "string"
            );
            assert_eq!(t["function"]["parameters"]["required"], json!(["prompt"]));
            let attendus: Vec<String> = outils::definitions().into_iter().map(|d| d.nom).collect();
            assert_eq!(noms_outils(&corps), attendus);
        }
    }

    #[tokio::test]
    async fn REQ100_AC2_AC4_sous_agent_isole_sans_trace_et_historique_relu() {
        let b = banc("a100-ac2", true, None).await;
        std::fs::write(b.dir.join("README.md"), "contenu-readme-z").unwrap();
        std::fs::write(b.dir.join("AGENTS.md"), "regle-maison").unwrap();
        std::fs::create_dir_all(b.dir.join(".yaide/agents")).unwrap();
        b.scenario(vec![
            sous("cherche-x"),
            appels(&[("r1", "read", json!({"path": "README.md"}))]),
            texte("trouvé-y", 999),
            texte("fin-agent", 20),
            texte("suite", 30),
        ]);
        let id = b.envoyer(None, "lance").unwrap();
        let v = b.fini(&id).await;
        assert_eq!(b.nb_requetes(), 4);
        // AC-100-2
        let r1 = b.corps(1);
        let m = r1["messages"].as_array().unwrap();
        let non_systeme: Vec<&Value> = m.iter().filter(|x| x["role"] != "system").collect();
        assert_eq!(non_systeme.len(), 1, "{r1}");
        assert_eq!(non_systeme[0]["content"], "cherche-x");
        assert!(b.requete(1).contains("regle-maison"));
        assert!(!b.requete(1).contains("lance"));
        assert!(b.requete(2).contains("contenu-readme-z"));
        let derniere = b.requete(3);
        assert!(derniere.contains("trouvé-y"));
        assert!(!derniere.contains("contenu-readme-z"));
        assert!(!derniere.contains("README.md"));
        // AC-100-4
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e.len(), 4, "{e:?}");
        assert_eq!(e[2]["nom"], "subagent");
        assert_eq!(e[2]["argument"], "cherche-x");
        assert_eq!(e[2]["etat"], "reussi");
        assert_eq!(e[2]["resultat"], "trouvé-y");
        assert_eq!(e[3]["texte"], "fin-agent");
        assert_eq!(v["tokens"], 20);
        let noms: Vec<_> = std::fs::read_dir(b.dir.join(".yaide/conversations"))
            .unwrap()
            .map(|f| f.unwrap().file_name())
            .collect();
        assert_eq!(noms, [std::ffi::OsString::from(format!("{id}.json"))]);
        assert_eq!(
            std::fs::read_dir(b.dir.join(".yaide/agents"))
                .unwrap()
                .count(),
            0
        );
        let neuf = gestionnaire(&b.dir, &b.reglages);
        neuf.envoyer(Some(&id), &b.profil, "encore").unwrap();
        for _ in 0..250 {
            if neuf.lire(&id, 0).unwrap()["enCours"] == false {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let r = b.requete(4);
        assert!(r.contains("trouvé-y") && r.contains("fin-agent") && r.contains("encore"));
        assert!(!r.contains("contenu-readme-z"));
    }

    #[tokio::test]
    async fn REQ100_AC3_outils_mcp_sans_subagent_et_modele_du_profil_de_l_agent() {
        let b = banc("a100-ac3", true, None).await;
        b.mcp(&[("echo", vec![])]);
        let p2 = b.profil2();
        let rel = b.agent("Relecteur", Some(&p2));
        b.scenario(vec![
            sous("a"),
            texte("r1", 1),
            texte("fin", 1),
            sous("b"),
            texte("r2", 1),
            texte("fin", 1),
        ]);
        let id = b.envoyer(None, "un").unwrap();
        b.fini(&id).await;
        let id2 = b.envoyer_a(None, &[rel], "deux").unwrap();
        b.fini(&id2).await;
        assert_eq!(b.nb_requetes(), 6);
        for (agent, sub, modele) in [(0, 1, "m"), (3, 4, "m2")] {
            let tous = noms_outils(&b.corps(agent));
            assert!(tous.contains(&"subagent".to_string()));
            let attendus: Vec<String> = tous.into_iter().filter(|n| n != "subagent").collect();
            let corps = b.corps(sub);
            assert_eq!(noms_outils(&corps), attendus);
            assert!(attendus.contains(&"mcp__echo__dire".to_string()));
            assert_eq!(corps["model"], modele);
            assert_eq!(b.corps(agent)["model"], modele);
        }
    }

    #[tokio::test]
    async fn REQ100_AC5_refus_du_provider_et_contexte_plein_arretent_le_sous_agent() {
        let b = banc("a100-ac5", true, Some(100)).await;
        std::fs::write(b.dir.join("README.md"), "x").unwrap();
        b.scenario(vec![
            sous("un"),
            (429, json!({"error": "trop-de-requetes"}), 0),
            texte("agent-continue", 10),
        ]);
        let id = b.envoyer(None, "lance").unwrap();
        let v = b.fini(&id).await;
        let o = outil_de(&v, "subagent");
        assert_eq!(o["etat"], "echec");
        let r = o["resultat"].as_str().unwrap();
        assert!(
            r.starts_with("The subagent stopped: OpenAI refused the request (429).")
                && r.contains("trop-de-requetes"),
            "{r}"
        );
        assert!(v["entrees"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["type"] != "message"));
        assert_eq!(
            v["entrees"].as_array().unwrap().last().unwrap()["texte"],
            "agent-continue"
        );
        assert!(b.requete(2).contains("The subagent stopped"));

        let c = banc("a100-ac5b", true, Some(100)).await;
        c.scenario(vec![
            sous("deux"),
            appels(&[("r1", "read", json!({"path": "README.md"}))]),
            texte("agent-continue", 10),
        ]);
        // 100 tokens atteignent la fenêtre : la requête de l'agent (10) ne la touche pas.
        c.script.lock().unwrap().get_mut(1).unwrap().1["usage"]["prompt_tokens"] = json!(100);
        let id = c.envoyer(None, "lance").unwrap();
        let v = c.fini(&id).await;
        let o = outil_de(&v, "subagent");
        assert_eq!(o["etat"], "echec");
        assert_eq!(
            o["resultat"],
            "The subagent stopped: its context window is full."
        );
        assert_eq!(c.nb_requetes(), 3);
        assert_eq!(
            v["entrees"].as_array().unwrap().last().unwrap()["texte"],
            "agent-continue"
        );
        assert_eq!(v["tokens"], 10);
    }

    #[tokio::test]
    async fn REQ100_AC6_arreter_pendant_la_requete_ou_bash_du_sous_agent() {
        let b = banc("a100-ac6", true, None).await;
        let mut lente = texte("trop tard", 1);
        lente.2 = 30_000;
        b.scenario(vec![sous("un"), lente]);
        let id = b.envoyer(None, "lance").unwrap();
        b.attendre(&id, |_| b.nb_requetes() == 2).await;
        assert!(b.g.arreter(&id));
        let v = b.g.lire(&id, 0).unwrap();
        assert_eq!(v["enCours"], false);
        assert_eq!(outil_de(&v, "subagent")["etat"], "echec");
        assert_eq!(
            v["entrees"].as_array().unwrap().last().unwrap(),
            &json!({"type": "fin", "texte": "Arrêté."})
        );

        // pendant un bash du sous-agent
        let pid = b.dir.join("pid");
        let cmd = format!("echo $$ > {}; sleep 30", pid.display());
        b.scenario(vec![
            sous("deux"),
            appels(&[("b1", "bash", json!({"command": cmd}))]),
        ]);
        b.envoyer(Some(&id), "encore").unwrap();
        for _ in 0..250 {
            if pid.exists() && std::fs::read_to_string(&pid).is_ok_and(|t| !t.trim().is_empty()) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let p: i32 = std::fs::read_to_string(&pid)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(std::path::Path::new(&format!("/proc/{p}")).exists());
        assert!(b.g.arreter(&id));
        let v = b.g.lire(&id, 0).unwrap();
        assert_eq!(v["enCours"], false);
        let e = v["entrees"].as_array().unwrap();
        assert_eq!(e[e.len() - 2]["etat"], "echec");
        assert_eq!(e[e.len() - 1]["texte"], "Arrêté.");
        for _ in 0..100 {
            if !std::path::Path::new(&format!("/proc/{p}")).exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!std::path::Path::new(&format!("/proc/{p}")).exists());

        // on peut continuer
        b.scenario(vec![texte("repris", 1)]);
        b.envoyer(Some(&id), "troisieme").unwrap();
        let v = b.fini(&id).await;
        assert_eq!(
            v["entrees"].as_array().unwrap().last().unwrap()["texte"],
            "repris"
        );
    }

    #[tokio::test]
    async fn REQ100_AC7_consigne_absente_echec_sans_requete_du_sous_agent() {
        let b = banc("a100-ac7", true, None).await;
        b.scenario(vec![
            appels(&[("s1", "subagent", json!({}))]),
            texte("fini", 1),
        ]);
        let id = b.envoyer(None, "lance").unwrap();
        let v = b.fini(&id).await;
        let o = outil_de(&v, "subagent");
        assert_eq!(o["etat"], "echec");
        assert_eq!(o["resultat"], "Missing or invalid argument: prompt.");
        assert_eq!(b.nb_requetes(), 2);
    }

    fn appel_avec_texte(texte: &str, id: &str, nom: &str, a: Value) -> (u16, Value, u64) {
        (
            200,
            json!({"choices": [{"message": {"content": texte, "tool_calls": [
                {"id": id, "type": "function",
                 "function": {"name": nom, "arguments": a.to_string()}}]}}],
                   "usage": {"prompt_tokens": 5, "completion_tokens": 1}}),
            0,
        )
    }

    fn types(etapes: &Value) -> Vec<String> {
        etapes
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["type"].as_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn REQ100_AC4_etapes_gardees_relues_et_jamais_envoyees() {
        let b = banc("a100-ac4e", true, None).await;
        std::fs::write(b.dir.join("README.md"), "contenu-readme-z").unwrap();
        b.scenario(vec![
            sous("cherche-x"),
            appel_avec_texte("je-lis", "r1", "read", json!({"path": "README.md"})),
            texte("trouvé-y", 999),
            texte("fin-agent", 20),
            texte("suite", 30),
        ]);
        let id = b.envoyer(None, "lance").unwrap();
        let v = b.fini(&id).await;
        let verifier = |v: &Value| {
            let o = outil_de(v, "subagent");
            assert_eq!(o["resultat"], "trouvé-y");
            let et = &o["etapes"];
            assert_eq!(types(et), ["utilisateur", "agent", "outil", "agent"]);
            assert_eq!(et[0]["texte"], "cherche-x");
            assert_eq!(et[1]["texte"], "je-lis");
            assert_eq!(et[2]["nom"], "read");
            assert_eq!(et[2]["argument"], "README.md");
            assert_eq!(et[2]["etat"], "reussi");
            assert!(et[2]["resultat"]
                .as_str()
                .unwrap()
                .contains("contenu-readme-z"));
            assert_eq!(et[3]["texte"], "trouvé-y");
        };
        verifier(&v);
        // les autres outils n'ont pas d'étapes
        assert!(outil_de(&b.g.lire(&id, 0).unwrap(), "subagent")["etapes"].is_array());
        let neuf = gestionnaire(&b.dir, &b.reglages);
        verifier(&neuf.lire(&id, 0).unwrap());
        b.scenario(vec![]);
        neuf.envoyer(Some(&id), &b.profil, "encore").unwrap();
        for _ in 0..250 {
            if neuf.lire(&id, 0).unwrap()["enCours"] == false {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let r = b.requete(4);
        assert!(r.contains("trouvé-y") && r.contains("encore"));
        assert!(!r.contains("je-lis"));
        assert!(!r.contains("contenu-readme-z"));
    }

    #[tokio::test]
    async fn REQ100_AC8_etapes_lisibles_pendant_un_bash_lent_du_sous_agent() {
        let b = banc("a100-ac8", true, None).await;
        b.scenario(vec![
            sous("lent"),
            appel_avec_texte("debut", "b1", "bash", json!({"command": "sleep 1"})),
            texte("terminé", 1),
            texte("fin-agent", 1),
        ]);
        let id = b.envoyer(None, "lance").unwrap();
        let v = b
            .attendre(&id, |v| {
                v["entrees"].as_array().is_some_and(|e| {
                    e.len() > 2 && e[2]["etapes"].as_array().is_some_and(|x| x.len() == 3)
                })
            })
            .await;
        let total = v["total"].as_u64().unwrap() as usize;
        let lu = b.g.lire(&id, total - 1).unwrap();
        let o = &lu["entrees"][0];
        assert_eq!(o["nom"], "subagent");
        assert_eq!(o["etat"], "enCours");
        assert_eq!(types(&o["etapes"]), ["utilisateur", "agent", "outil"]);
        assert_eq!(o["etapes"][0]["texte"], "lent");
        assert_eq!(o["etapes"][1]["texte"], "debut");
        assert_eq!(o["etapes"][2]["etat"], "enCours");
        let v = b.fini(&id).await;
        let o = outil_de(&v, "subagent");
        assert_eq!(o["etat"], "reussi");
        assert_eq!(
            types(&o["etapes"]),
            ["utilisateur", "agent", "outil", "agent"]
        );
        assert_eq!(o["etapes"][2]["etat"], "reussi");
        assert_eq!(o["etapes"][3]["texte"], "terminé");
    }

    #[tokio::test]
    async fn REQ100_AC9_bash_du_sous_agent_arrete_ou_yaide_arrete() {
        let b = banc("a100-ac9", true, None).await;
        b.scenario(vec![
            sous("lent"),
            appel_avec_texte("debut", "b1", "bash", json!({"command": "sleep 30"})),
        ]);
        let id = b.envoyer(None, "lance").unwrap();
        b.attendre(&id, |v| {
            v["entrees"].as_array().is_some_and(|e| {
                e.len() > 2 && e[2]["etapes"].as_array().is_some_and(|x| x.len() == 3)
            })
        })
        .await;
        assert!(b.g.arreter(&id));
        let v = b.g.lire(&id, 0).unwrap();
        let et = &outil_de(&v, "subagent")["etapes"];
        assert_eq!(types(et), ["utilisateur", "agent", "outil"]);
        assert_eq!(et[1]["texte"], "debut");
        assert_eq!(et[2]["etat"], "echec");
        assert_eq!(et[2]["resultat"], "Stopped by the user.");

        // Yaide arrêté : fichier resté en cours, relu par un gestionnaire neuf
        let etape = |t: &str, etat: &str| {
            serde_json::from_value::<Entree>(json!({
                "type": "outil", "id": t, "nom": "bash", "arguments": {}, "argument": "x",
                "etat": etat, "resultat": if etat == "reussi" { "ok" } else { "" }
            }))
            .unwrap()
        };
        let c = Conversation {
            id: "abc".into(),
            titre: "t".into(),
            profil: b.profil.clone(),
            cree: 1,
            maj: 1,
            en_cours: true,
            instructions: String::new(),
            tokens: 0,
            entrees: vec![
                Entree::Utilisateur { texte: "u".into() },
                Entree::Outil {
                    id: "s".into(),
                    nom: "subagent".into(),
                    arguments: json!({"prompt": "p"}),
                    argument: "p".into(),
                    etat: "enCours".into(),
                    resultat: String::new(),
                    auteur: None,
                    serveur: None,
                    outil: None,
                    etapes: Some(vec![
                        Entree::Utilisateur { texte: "p".into() },
                        etape("fait", "reussi"),
                        etape("lent", "enCours"),
                    ]),
                },
            ],
            agents: vec![],
            actif: None,
            restants: vec![],
        };
        b.g.sauver(&c).unwrap();
        let neuf = gestionnaire(&b.dir, &b.reglages);
        let v = neuf.lire("abc", 0).unwrap();
        let et = &v["entrees"][1]["etapes"];
        assert_eq!(v["entrees"][1]["etat"], "echec");
        assert_eq!(et[0]["texte"], "p");
        assert_eq!(et[1]["etat"], "reussi");
        assert_eq!(et[1]["resultat"], "ok");
        assert_eq!(et[2]["etat"], "echec");
        assert_eq!(et[2]["resultat"], "Stopped by the user.");
    }

    #[tokio::test]
    async fn REQ100_AC10_appel_mcp_du_sous_agent_avec_serveur_et_outil() {
        let b = banc("a100-ac10", true, None).await;
        b.mcp(&[("echo", vec![])]);
        b.scenario(vec![
            sous("parle"),
            appels(&[("m1", "mcp__echo__dire", json!({"texte": "bonjour"}))]),
            texte("ok", 1),
            texte("fin", 1),
        ]);
        let id = b.envoyer(None, "lance").unwrap();
        let v = b.fini(&id).await;
        let et = &outil_de(&v, "subagent")["etapes"];
        assert_eq!(et[2]["nom"], "mcp__echo__dire");
        assert_eq!(et[2]["serveur"], "echo");
        assert_eq!(et[2]["outil"], "dire");
        assert_eq!(et[2]["etat"], "reussi");
        assert_eq!(et[2]["resultat"], "dit: bonjour");
    }
}
