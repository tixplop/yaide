//! Déclencheurs des agents (REQ-164, REQ-165) : le serveur surveille ce que les agents
//! écoutent et leur soumet chaque évènement dans une nouvelle conversation.

use super::agents::{Agent, Agents, Declencheur};
use super::conversation::{ErreurEnvoi, Gestionnaire, Refus};
use super::outils_config::lire_interface;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::Arc;
use std::time::SystemTime;

/// Ce qu'on sait d'un fichier : taille, date, puis empreinte du contenu (comme REQ-110).
#[derive(Clone, Debug, PartialEq)]
struct Empreinte {
    taille: u64,
    date: Option<SystemTime>,
    hash: u64,
}

fn empreinte(chemin: &Path) -> Option<Empreinte> {
    let m = std::fs::metadata(chemin).ok().filter(|m| m.is_file())?;
    let octets = std::fs::read(chemin).ok()?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    octets.hash(&mut h);
    Some(Empreinte {
        taille: m.len(),
        date: m.modified().ok(),
        hash: h.finish(),
    })
}

/// Le fichier maintenant, et ce qui lui est arrivé depuis `ancien`.
fn observer(
    chemin: &Path,
    ancien: &Option<Empreinte>,
) -> (Option<Empreinte>, Option<&'static str>) {
    let Some(a) = ancien else {
        let n = empreinte(chemin);
        let c = n.is_some().then_some("créé");
        return (n, c);
    };
    let Some(m) = std::fs::metadata(chemin).ok().filter(|m| m.is_file()) else {
        return (None, Some("supprimé"));
    };
    if m.len() == a.taille && m.modified().ok() == a.date {
        return (ancien.clone(), None);
    }
    match empreinte(chemin) {
        None => (ancien.clone(), None),
        Some(n) if n.hash == a.hash => (Some(n), None),
        Some(n) => (Some(n), Some("modifié")),
    }
}

/// État gardé d'une vérification à l'autre.
#[derive(Default)]
pub struct Etat {
    /// (dossier de l'agent, chemin) → fichier à la dernière vérification.
    fichiers: HashMap<(String, String), Option<Empreinte>>,
}

/// Les déclencheurs de l'agent repartent de l'état du moment, sans évènement.
pub fn rafraichir(etat: &mut Etat, projet: &Path, agent: &Agent) {
    let mut vivantes = HashSet::new();
    for d in &agent.declencheurs {
        verifier_un(etat, projet, agent, d, &mut vivantes);
    }
}

/// Une vérification : les messages à soumettre, un par agent concerné.
/// `occupe` dit si un agent a un tour en cours ; `actif` si la fonction `agents` l'est.
pub fn verifier(
    etat: &mut Etat,
    projet: &Path,
    agents: &[Agent],
    actif: bool,
    occupe: impl Fn(&str) -> bool,
) -> Vec<(Agent, String)> {
    let mut sortie = Vec::new();
    let mut vivantes = HashSet::new();
    for a in agents {
        let muet = !actif || occupe(&a.dossier);
        let mut evenements = Vec::new();
        for d in &a.declencheurs {
            if let Some(e) = verifier_un(etat, projet, a, d, &mut vivantes) {
                evenements.push(e);
            }
        }
        if !muet && !evenements.is_empty() {
            sortie.push((a.clone(), evenements.join("\n\n")));
        }
    }
    etat.fichiers.retain(|k, _| vivantes.contains(k));
    sortie
}

fn verifier_un(
    etat: &mut Etat,
    projet: &Path,
    agent: &Agent,
    d: &Declencheur,
    vivantes: &mut HashSet<(String, String)>,
) -> Option<String> {
    if d.genre != "fichier" {
        return None;
    }
    let chemin = d.chemin.as_deref()?;
    let cle = (agent.dossier.clone(), chemin.to_string());
    vivantes.insert(cle.clone());
    let complet = projet.join(chemin);
    match etat.fichiers.get(&cle) {
        // Premier regard : l'état du moment, sans évènement.
        None => {
            etat.fichiers.insert(cle, empreinte(&complet));
            None
        }
        Some(ancien) => {
            let (n, c) = observer(&complet, ancien);
            etat.fichiers.insert(cle, n);
            c.map(|c| format!("Évènement : fichier `{chemin}` {c}."))
        }
    }
}

fn phrase_de_refus(r: &Refus) -> String {
    match r.motif {
        "sans-profil" => "Aucun profil. Créez-en un avec Ctrl+P, puis > Profils de modèle.".into(),
        "sans-cle" => format!(
            "Aucune clé pour {}. Ajoutez-la avec Ctrl+P, puis > Providers LLM.",
            r.provider.unwrap_or("le provider")
        ),
        "contexte-plein" => "Contexte plein. Ouvrez une nouvelle conversation.".into(),
        _ => "Message refusé.".into(),
    }
}

/// Soumet le message à l'agent seul ; un refus est enregistré dans une conversation.
pub fn soumettre(gestionnaire: &Arc<Gestionnaire>, agent: &Agent, texte: &str) {
    match gestionnaire.envoyer_avec(None, "", std::slice::from_ref(agent), texte) {
        Ok(_) => {}
        Err(ErreurEnvoi::Refus(r)) => {
            if let Err(e) = gestionnaire.enregistrer_refus(agent, texte, &phrase_de_refus(&r)) {
                eprintln!("déclencheur de {} : {e}", agent.nom);
            }
        }
        Err(e) => eprintln!("déclencheur de {} : {e:?}", agent.nom),
    }
}

/// Une vérification complète du projet.
pub fn passer(projet: &Path, agents: &Agents, gestionnaire: &Arc<Gestionnaire>) {
    let actif = lire_interface(projet)
        .map(|i| i.fonctions.iter().all(|(c, v)| *c != "agents" || *v))
        .unwrap_or(true);
    // Le verrou reste pris le temps de la vérification : la fin d'un tour n'y passe pas.
    let mut etat = gestionnaire
        .etat_declencheurs()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let liste = agents.lister().agents;
    let messages = verifier(&mut etat, projet, &liste, actif, |d| {
        gestionnaire.agent_occupe(d)
    });
    drop(etat);
    for (agent, texte) in messages {
        soumettre(gestionnaire, &agent, &texte);
    }
}
