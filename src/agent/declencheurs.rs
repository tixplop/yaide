//! Déclencheurs des agents (REQ-164, REQ-165) : le serveur surveille ce que les agents
//! écoutent et leur soumet chaque évènement dans une nouvelle conversation.

use super::agents::{Agent, Agents, Declencheur};
use super::conversation::{ErreurEnvoi, Gestionnaire, Refus};
use super::outils_config::lire_interface;
use crate::shells::Commande;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
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
    /// Journaux des branches (`logs/refs/heads/`) : nom de la branche → octets déjà lus.
    /// `None` jusqu'à la première vérification, qui ne fait que noter les tailles (REQ-166).
    journaux: Option<HashMap<String, u64>>,
}

/// Dossier git commun du dépôt du projet (celui des branches, worktrees compris).
fn dossier_git(projet: &Path) -> Option<PathBuf> {
    let sortie = std::process::Command::new("git")
        .arg("-C")
        .arg(projet)
        .args(["rev-parse", "--git-common-dir"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let chemin = String::from_utf8_lossy(&sortie.stdout).trim().to_string();
    (!chemin.is_empty()).then(|| projet.join(chemin))
}

fn lister_journaux(racine: &Path, rel: &str, sortie: &mut Vec<(String, u64)>) {
    let Ok(entrees) = std::fs::read_dir(racine.join(rel)) else {
        return;
    };
    for e in entrees.flatten() {
        let nom = format!("{rel}{}", e.file_name().to_string_lossy());
        match e.metadata() {
            Ok(m) if m.is_dir() => lister_journaux(racine, &format!("{nom}/"), sortie),
            Ok(m) if m.is_file() => sortie.push((nom, m.len())),
            _ => {}
        }
    }
}

/// Les commits créés depuis la vérification précédente : (hash, branche), du plus ancien
/// au plus récent. Seules comptent les lignes `commit…` des journaux de branches : un pull,
/// un rebase ou un cherry-pick n'en écrivent pas.
fn relever_commits(etat: &mut Etat, projet: &Path) -> Vec<(String, String)> {
    let Some(git) = dossier_git(projet) else {
        return Vec::new();
    };
    let racine = git.join("logs/refs/heads");
    let mut presents = Vec::new();
    lister_journaux(&racine, "", &mut presents);
    presents.sort();
    let Some(vus) = etat.journaux.as_mut() else {
        etat.journaux = Some(presents.into_iter().collect());
        return Vec::new();
    };
    let mut trouves: Vec<(u64, String, String)> = Vec::new();
    for (branche, taille) in presents {
        let debut = vus.get(&branche).copied().unwrap_or(0);
        if taille <= debut {
            vus.insert(branche, taille);
            continue;
        }
        let Ok(octets) = std::fs::read(racine.join(&branche)) else {
            continue;
        };
        let fin = (taille as usize).min(octets.len());
        let Some(dernier) = octets[..fin].iter().rposition(|&b| b == b'\n') else {
            continue;
        };
        vus.insert(branche.clone(), dernier as u64 + 1);
        let texte = String::from_utf8_lossy(&octets[debut as usize..=dernier]).into_owned();
        for ligne in texte.lines() {
            let Some((meta, message)) = ligne.split_once('\t') else {
                continue;
            };
            if !message.starts_with("commit") {
                continue;
            }
            let champs: Vec<&str> = meta.split(' ').collect();
            let date = champs
                .len()
                .checked_sub(2)
                .and_then(|i| champs[i].parse().ok())
                .unwrap_or(0);
            if let Some(hash) = champs.get(1) {
                trouves.push((date, hash.to_string(), branche.clone()));
            }
        }
    }
    trouves.sort_by_key(|t| t.0);
    trouves.into_iter().map(|(_, h, b)| (h, b)).collect()
}

/// Le texte de l'évènement d'un commit, d'après `git show --name-status`.
fn texte_commit(projet: &Path, hash: &str, branche: &str) -> Option<String> {
    let sortie = std::process::Command::new("git")
        .args(["-c", "core.quotepath=false", "-C"])
        .arg(projet)
        .args([
            "show",
            "--name-status",
            "--no-renames",
            "--format=%h%x1f%an%x1f%ae%x1f%B%x1e",
            hash,
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let brut = String::from_utf8_lossy(&sortie.stdout).into_owned();
    let (entete, fichiers) = brut.split_once('\x1e')?;
    let mut champs = entete.splitn(4, '\x1f');
    let (court, nom, mail, message) = (
        champs.next()?,
        champs.next()?,
        champs.next()?,
        champs.next()?,
    );
    let mut texte = format!(
        "Évènement : commit `{court}` sur la branche `{branche}`.\nAuteur : {nom} <{mail}>\nMessage : {}",
        message.trim_end()
    );
    let lignes: Vec<String> = fichiers
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .map(|(statut, chemin)| format!("- {statut} `{chemin}`"))
        .collect();
    if !lignes.is_empty() {
        texte.push_str("\nFichiers :\n");
        texte.push_str(&lignes.join("\n"));
    }
    Some(texte)
}

/// L'évènement d'une commande terminée dans un shell de Yaide (REQ-167).
fn texte_commande(c: &Commande) -> String {
    format!(
        "Évènement : commande terminée, code de sortie {}.\nCommande : `{}`\nDossier : `{}`",
        c.code, c.commande, c.dossier
    )
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
    commandes: &[Commande],
) -> Vec<(Agent, String)> {
    let mut sortie = Vec::new();
    let mut vivantes = HashSet::new();
    // Les journaux avancent à chaque vérification, même sans agent à l'écoute.
    let commits = relever_commits(etat, projet);
    let ecoute = |genre: &str| {
        agents
            .iter()
            .any(|a| a.declencheurs.iter().any(|d| d.genre == genre))
    };
    let textes_commits: Vec<String> = if ecoute("commit") {
        commits
            .iter()
            .filter_map(|(h, b)| texte_commit(projet, h, b))
            .collect()
    } else {
        Vec::new()
    };
    for a in agents {
        let muet = !actif || occupe(&a.dossier);
        let mut evenements = Vec::new();
        for d in &a.declencheurs {
            if let Some(e) = verifier_un(etat, projet, a, d, &mut vivantes) {
                evenements.push(e);
            }
            if muet {
                continue;
            }
            match d.genre.as_str() {
                "commit" => evenements.extend(textes_commits.iter().cloned()),
                "commande" => {
                    let t = d.texte.as_deref().unwrap_or("");
                    evenements.extend(
                        commandes
                            .iter()
                            .filter(|c| !t.is_empty() && c.commande.contains(t))
                            .map(texte_commande),
                    );
                }
                _ => {}
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
pub fn passer(
    projet: &Path,
    agents: &Agents,
    gestionnaire: &Arc<Gestionnaire>,
    shells: &crate::shells::Registre,
) {
    let actif = lire_interface(projet)
        .map(|i| i.fonctions.iter().all(|(c, v)| *c != "agents" || *v))
        .unwrap_or(true);
    // Le verrou reste pris le temps de la vérification : la fin d'un tour n'y passe pas.
    let mut etat = gestionnaire
        .etat_declencheurs()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let liste = agents.lister().agents;
    let commandes = shells.prendre_commandes();
    let messages = verifier(
        &mut etat,
        projet,
        &liste,
        actif,
        |d| gestionnaire.agent_occupe(d),
        &commandes,
    );
    drop(etat);
    for (agent, texte) in messages {
        soumettre(gestionnaire, &agent, &texte);
    }
}
