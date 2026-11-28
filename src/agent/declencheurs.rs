//! Déclencheurs des agents (REQ-164, REQ-165) : le serveur surveille ce que les agents
//! écoutent et leur soumet chaque évènement dans une nouvelle conversation.

use super::agents::{Agent, Agents, Declencheur};
use super::conversation::{ErreurEnvoi, Gestionnaire, Refus};
use super::outils_config::{lire_config, lire_interface};
use crate::journal::Severite;
use crate::shells::Commande;
use chrono::{NaiveDateTime, Timelike};
use croner::parser::{CronParser, Seconds};
use croner::Cron;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

/// Nombre d'entrées gardées dans le journal des tours déclenchés (DEC-113).
const JOURNAL_MAX: usize = 100;

/// Journal en mémoire des débuts, fins et refus des tours déclenchés (REQ-173).
#[derive(Default)]
pub struct Journal {
    dernier: u64,
    entrees: std::collections::VecDeque<Value>,
}

impl Journal {
    /// Ajoute une entrée : `sorte` est `debut`, `fin`, `erreur` ou `refus` (avec sa phrase).
    pub fn ajouter(&mut self, agent: &str, sorte: &str, evenement: &str, phrase: Option<&str>) {
        self.dernier += 1;
        let mut e = serde_json::json!({
            "numero": self.dernier, "agent": agent, "sorte": sorte, "evenement": evenement,
        });
        if let Some(p) = phrase {
            e["phrase"] = Value::String(p.to_string());
        }
        self.entrees.push_back(e);
        if self.entrees.len() > JOURNAL_MAX {
            self.entrees.pop_front();
        }
    }

    /// Le numéro du moment et les entrées numérotées après `depuis` (aucune sans `depuis`).
    pub fn lire(&self, depuis: Option<u64>) -> Value {
        let entrees: Vec<&Value> = match depuis {
            Some(n) => self
                .entrees
                .iter()
                .filter(|e| e["numero"].as_u64() > Some(n))
                .collect(),
            None => Vec::new(),
        };
        serde_json::json!({ "numero": self.dernier, "entrees": entrees })
    }
}

/// L'évènement d'un message déclenché, pour le journal : première ligne sans « Évènement : »,
/// sans « . » ou « : » final, coupée à 80 caractères suivis de « … ».
pub fn evenement_court(message: &str) -> String {
    let ligne = message.lines().next().unwrap_or("").trim();
    let ligne = ligne.strip_prefix("Évènement :").unwrap_or(ligne).trim();
    let ligne = ligne.trim_end_matches(['.', ':']).trim_end();
    if ligne.chars().count() > 80 {
        let coupe: String = ligne.chars().take(80).collect();
        format!("{coupe}…")
    } else {
        ligne.to_string()
    }
}

/// Ce qu'on sait d'un fichier : taille, date, puis empreinte du contenu (comme REQ-110).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Empreinte {
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
    /// (dossier de l'agent, chemin) → fichiers du dossier à la dernière vérification.
    dossiers: HashMap<(String, String), HashMap<String, Empreinte>>,
    /// Parties de la configuration à la dernière vérification (REQ-168) ; `None` avant la première.
    config: Option<Vec<(&'static str, Value)>>,
    /// (dossier de l'agent, expression) → dernière minute vérifiée (REQ-174).
    minutes: HashMap<(String, String), NaiveDateTime>,
}

/// Lit une expression cron à cinq champs (REQ-174, DEC-112) ; `None` si elle est illisible.
pub fn lire_cron(expression: &str) -> Option<Cron> {
    if expression.split_whitespace().count() != 5 {
        return None;
    }
    CronParser::builder()
        .seconds(Seconds::Disallowed)
        .build()
        .parse(expression)
        .ok()
}

/// Les `n` prochaines minutes de l'expression après `maintenant`, à l'heure locale (REQ-204,
/// DEC-130) : `None` si elle est illisible, liste vide si aucune date n'existe.
pub fn prochaines_fois(
    expression: &str,
    maintenant: NaiveDateTime,
    n: usize,
) -> Option<Vec<NaiveDateTime>> {
    let cron = lire_cron(expression)?;
    Some(cron.iter_after(maintenant).take(n).collect())
}

/// L'évènement d'une planification atteinte à cette minute, une seule fois par minute.
/// La minute est notée même quand l'agent est muet : une minute passée n'est jamais rattrapée.
pub(crate) fn relever_planification(
    minutes: &mut HashMap<(String, String), NaiveDateTime>,
    dossier: &str,
    expression: &str,
    maintenant: NaiveDateTime,
    muet: bool,
) -> Option<String> {
    let minute = maintenant.with_second(0)?.with_nanosecond(0)?;
    let cle = (dossier.to_string(), expression.to_string());
    if minutes.insert(cle, minute) == Some(minute) {
        return None;
    }
    if muet || !lire_cron(expression)?.is_time_matching(&minute).ok()? {
        return None;
    }
    Some(format!(
        "Évènement : planification `{expression}` atteinte.\nHeure : {}",
        minute.format("%Y-%m-%d %H:%M")
    ))
}

/// Les fichiers d'un dossier du projet, sans les fichiers ignorés par git, `.git/` ni `.yaide/`.
/// Un fichier dont la taille et la date n'ont pas bougé garde son empreinte.
pub(crate) fn parcourir(
    projet: &Path,
    chemin: &str,
    avant: Option<&HashMap<String, Empreinte>>,
) -> HashMap<String, Empreinte> {
    let git = crate::depot::est_un_depot(projet);
    let marche = ignore::WalkBuilder::new(projet.join(chemin))
        .hidden(false)
        .ignore(false)
        .git_ignore(git)
        .git_exclude(git)
        .git_global(git)
        .parents(git)
        .filter_entry(|e| e.file_name() != ".git" && e.file_name() != ".yaide")
        .build();
    let mut sortie = HashMap::new();
    for e in marche.flatten() {
        if !e.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let rel = e
            .path()
            .strip_prefix(projet)
            .unwrap_or(e.path())
            .to_string_lossy()
            .into_owned();
        let connu = avant.and_then(|a| a.get(&rel));
        let nouveau = match (connu, e.metadata()) {
            (Some(a), Ok(m)) if m.len() == a.taille && m.modified().ok() == a.date => {
                Some(a.clone())
            }
            _ => empreinte(e.path()),
        };
        if let Some(n) = nouveau {
            sortie.insert(rel, n);
        }
    }
    sortie
}

/// Ce qui est arrivé aux fichiers entre deux relevés, par ordre de chemin.
pub(crate) fn differences(
    avant: &HashMap<String, Empreinte>,
    apres: &HashMap<String, Empreinte>,
) -> Vec<String> {
    let mut noms: Vec<&String> = avant.keys().chain(apres.keys()).collect();
    noms.sort();
    noms.dedup();
    noms.into_iter()
        .filter_map(|n| {
            let c = match (avant.get(n), apres.get(n)) {
                (None, Some(_)) => "créé",
                (Some(_), None) => "supprimé",
                (Some(a), Some(b)) if a.hash != b.hash => "modifié",
                _ => return None,
            };
            Some(format!("- `{n}` {c}"))
        })
        .collect()
}

/// Les quatre parties de la configuration, comparées une à une. Les clés n'en font pas
/// partie (`has_key` est écarté) ; un fichier illisible compte pour sa partie.
fn parties(config: &Value) -> Vec<(&'static str, Value)> {
    let illisibles = |f: &dyn Fn(&str) -> bool| -> Vec<Value> {
        config["unreadable"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|u| u["file"].as_str().is_some_and(f))
            .cloned()
            .collect()
    };
    let providers: Vec<Value> = config["providers"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| {
            let mut p = p.clone();
            if let Some(o) = p.as_object_mut() {
                o.remove("has_key");
            }
            p
        })
        .collect();
    let de_config = illisibles(&|f| f.ends_with("config.json"));
    vec![
        (
            "providers",
            serde_json::json!([providers, de_config.clone()]),
        ),
        (
            "profils",
            serde_json::json!([config["profiles"], de_config]),
        ),
        (
            "serveurs MCP",
            serde_json::json!([
                config["mcp_servers"],
                illisibles(&|f| f.ends_with("mcp.json"))
            ]),
        ),
        (
            "interface",
            serde_json::json!([
                config["interface"],
                illisibles(&|f| f.ends_with("interface.json"))
            ]),
        ),
    ]
}

/// L'évènement de la configuration, s'il y a eu un changement depuis la vérification précédente.
fn relever_config(etat: &mut Etat, config: &Value) -> Option<String> {
    let maintenant = parties(config);
    let avant = etat.config.replace(maintenant.clone())?;
    let noms: Vec<&str> = maintenant
        .iter()
        .zip(&avant)
        .filter(|(m, a)| m.1 != a.1)
        .map(|(m, _)| m.0)
        .collect();
    (!noms.is_empty()).then(|| {
        format!(
            "Évènement : configuration de Yaide changée : {}.\nConfiguration :\n```json\n{config}\n```",
            noms.join(", ")
        )
    })
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
#[allow(clippy::too_many_arguments)]
pub fn verifier(
    etat: &mut Etat,
    projet: &Path,
    agents: &[Agent],
    actif: bool,
    occupe: impl Fn(&str) -> bool,
    commandes: &[Commande],
    config: &Value,
    maintenant: NaiveDateTime,
) -> Vec<(Agent, String)> {
    let mut sortie = Vec::new();
    let mut vivantes = HashSet::new();
    // Comme les journaux, la configuration avance à chaque vérification.
    let evenement_config = relever_config(etat, config);
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
            if muet && d.genre != "planification" {
                continue;
            }
            match d.genre.as_str() {
                "commit" => evenements.extend(textes_commits.iter().cloned()),
                "configuration" => evenements.extend(evenement_config.clone()),
                "commande" => {
                    let t = d.texte.as_deref().unwrap_or("");
                    evenements.extend(
                        commandes
                            .iter()
                            .filter(|c| !t.is_empty() && c.commande.contains(t))
                            .map(texte_commande),
                    );
                }
                "planification" => {
                    let expression = d.cron.as_deref().unwrap_or("");
                    evenements.extend(relever_planification(
                        &mut etat.minutes,
                        &a.dossier,
                        expression,
                        maintenant,
                        muet,
                    ));
                }
                _ => {}
            }
        }
        if !muet && !evenements.is_empty() {
            sortie.push((a.clone(), evenements.join("\n\n")));
        }
    }
    etat.fichiers.retain(|k, _| vivantes.contains(k));
    etat.dossiers.retain(|k, _| vivantes.contains(k));
    etat.minutes.retain(|(dossier, expression), _| {
        agents.iter().any(|a| {
            a.dossier == *dossier
                && a.declencheurs
                    .iter()
                    .any(|d| d.cron.as_deref() == Some(expression))
        })
    });
    sortie
}

fn verifier_un(
    etat: &mut Etat,
    projet: &Path,
    agent: &Agent,
    d: &Declencheur,
    vivantes: &mut HashSet<(String, String)>,
) -> Option<String> {
    if d.genre != "fichier" && d.genre != "dossier" {
        return None;
    }
    let chemin = d.chemin.as_deref()?;
    let cle = (agent.dossier.clone(), chemin.to_string());
    vivantes.insert(cle.clone());
    if d.genre == "dossier" {
        let apres = parcourir(projet, chemin, etat.dossiers.get(&cle));
        let lignes = match etat.dossiers.get(&cle) {
            // Premier regard : l'état du moment, sans évènement.
            None => Vec::new(),
            Some(avant) => differences(avant, &apres),
        };
        etat.dossiers.insert(cle, apres);
        let nom = chemin.trim_end_matches('/');
        return (!lignes.is_empty()).then(|| {
            format!(
                "Évènement : changements dans le dossier `{nom}/` :\n{}",
                lignes.join("\n")
            )
        });
    }
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

pub(crate) fn phrase_de_refus(r: &Refus) -> String {
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

/// Ligne du journal d'un déclencheur en échec (REQ-186), en français.
fn texte_echec(agent: &str, e: &ErreurEnvoi) -> String {
    let cause = match e {
        ErreurEnvoi::Systeme(m) => m.trim_end_matches('.'),
        ErreurEnvoi::Inconnue => "conversation inconnue",
        ErreurEnvoi::Refus(_) => "refus",
    };
    format!("Le déclencheur de {agent} a échoué : {cause}.")
}

/// Soumet le message à l'agent seul ; un refus est enregistré dans une conversation.
pub fn soumettre(gestionnaire: &Arc<Gestionnaire>, agent: &Agent, texte: &str) {
    match gestionnaire.envoyer_declenche(agent, texte) {
        Ok(_) => {}
        Err(ErreurEnvoi::Refus(r)) => {
            let phrase = phrase_de_refus(&r);
            if let Err(e) = gestionnaire.enregistrer_refus(agent, texte, &phrase) {
                eprintln!("déclencheur de {} : {e}", agent.nom);
                gestionnaire.logs().ecrire(
                    Severite::Erreur,
                    &format!("Le déclencheur de {} a échoué : {e}.", agent.nom),
                );
            }
            gestionnaire.journaliser(&agent.nom, "refus", &evenement_court(texte), Some(&phrase));
        }
        Err(e) => {
            eprintln!("déclencheur de {} : {e:?}", agent.nom);
            gestionnaire
                .logs()
                .ecrire(Severite::Erreur, &texte_echec(&agent.nom, &e));
        }
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
    let config = lire_config(gestionnaire.reglages(), projet);
    let messages = verifier(
        &mut etat,
        projet,
        &liste,
        actif,
        |d| gestionnaire.agent_occupe(d),
        &commandes,
        &config,
        chrono::Local::now().naive_local(),
    );
    drop(etat);
    for (agent, texte) in messages {
        soumettre(gestionnaire, &agent, &texte);
    }
}

#[cfg(test)]
mod tests_echec {
    use super::*;

    #[test]
    fn req186_ac4_texte_d_un_declencheur_en_echec_en_francais() {
        assert_eq!(
            texte_echec("Relecteur", &ErreurEnvoi::Systeme("disque plein.".into())),
            "Le déclencheur de Relecteur a échoué : disque plein."
        );
        assert_eq!(
            texte_echec("Relecteur", &ErreurEnvoi::Inconnue),
            "Le déclencheur de Relecteur a échoué : conversation inconnue."
        );
    }
}

#[cfg(test)]
mod tests_journal {
    use super::evenement_court;

    #[test]
    fn req173_ac6_evenement_court_coupe_la_premiere_ligne_a_80_caracteres() {
        let long = "é".repeat(120);
        let attendu = format!("{}…", "é".repeat(80));
        assert_eq!(
            evenement_court(&format!("Évènement : {long}.\nSuite")),
            attendu
        );
        assert_eq!(
            evenement_court("Évènement : fichier `docs/a.md` modifié.\nx"),
            "fichier `docs/a.md` modifié"
        );
    }
}

#[cfg(test)]
mod tests_planification {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn req204_ac1_prochaines_fois() {
        let d = |m, j, h, mi| {
            NaiveDate::from_ymd_opt(2026, m, j)
                .unwrap()
                .and_hms_opt(h, mi, 0)
                .unwrap()
        };
        let depuis = d(11, 28, 10, 0);
        assert_eq!(
            prochaines_fois("0 9 * * 1-5", depuis, 3),
            Some(vec![d(11, 30, 9, 0), d(12, 1, 9, 0), d(12, 2, 9, 0)])
        );
        assert_eq!(
            prochaines_fois("*/15 * * * *", d(11, 28, 10, 7), 3),
            Some(vec![
                d(11, 28, 10, 15),
                d(11, 28, 10, 30),
                d(11, 28, 10, 45)
            ])
        );
        for ko in ["61 * * * *", "* * *", "toutes les heures", ""] {
            assert_eq!(prochaines_fois(ko, depuis, 3), None, "{ko}");
        }
        assert_eq!(prochaines_fois("0 0 30 2 *", depuis, 3), Some(vec![]));
    }

    fn agent(dossier: &str, cron: &str) -> Agent {
        Agent {
            dossier: dossier.into(),
            nom: dossier.into(),
            avatar: String::new(),
            couleur: "vert".into(),
            profil: None,
            declencheurs: vec![Declencheur {
                genre: "planification".into(),
                chemin: None,
                texte: None,
                cron: Some(cron.into()),
            }],
        }
    }

    fn le(jour: u32, h: u32, m: u32, s: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 11, jour)
            .unwrap()
            .and_hms_opt(h, m, s)
            .unwrap()
    }

    /// Une vérification à `t` ; `occupe` dit si l'agent est en plein tour.
    fn passe(etat: &mut Etat, agents: &[Agent], t: NaiveDateTime, occupe: bool) -> Vec<String> {
        let projet = std::env::temp_dir().join("yaide-planification-inexistant");
        verifier(
            etat,
            &projet,
            agents,
            true,
            |_| occupe,
            &[],
            &serde_json::json!({}),
            t,
        )
        .into_iter()
        .map(|(_, texte)| texte)
        .collect()
    }

    #[test]
    fn req174_ac3_lundi_0930_une_fois_samedi_et_0931_rien() {
        let a = [agent("relecteur", "30 9 * * 1-5")];
        let mut etat = Etat::default();
        // Lundi 2026-11-23.
        let r = passe(&mut etat, &a, le(23, 9, 30, 1), false);
        assert_eq!(
            r,
            ["Évènement : planification `30 9 * * 1-5` atteinte.\nHeure : 2026-11-23 09:30"]
        );
        assert!(passe(&mut etat, &a, le(23, 9, 30, 4), false).is_empty());
        assert!(passe(&mut etat, &a, le(23, 9, 30, 58), false).is_empty());
        assert!(passe(&mut etat, &a, le(23, 9, 31, 1), false).is_empty());
        // Samedi 2026-11-28.
        assert!(passe(&mut etat, &a, le(28, 9, 30, 1), false).is_empty());
    }

    #[test]
    fn req174_ac4_pas_de_15_minutes_agent_occupe_et_demarrage_tardif() {
        let a = [agent("relecteur", "*/15 * * * *")];
        let mut etat = Etat::default();
        // Lancé à 10:07 : rien pour 10:00.
        assert!(passe(&mut etat, &a, le(23, 10, 7, 0), false).is_empty());
        assert_eq!(passe(&mut etat, &a, le(23, 10, 15, 0), false).len(), 1);
        assert!(passe(&mut etat, &a, le(23, 10, 16, 1), false).is_empty());
        assert_eq!(passe(&mut etat, &a, le(23, 10, 30, 2), false).len(), 1);
        let mut etat = Etat::default();
        assert_eq!(passe(&mut etat, &a, le(23, 10, 0, 1), false).len(), 1);
        // Plein tour de 10:14 à 10:16 : rien pour 10:15, ni pendant ni après.
        assert!(passe(&mut etat, &a, le(23, 10, 14, 30), true).is_empty());
        assert!(passe(&mut etat, &a, le(23, 10, 15, 1), true).is_empty());
        assert!(passe(&mut etat, &a, le(23, 10, 15, 4), true).is_empty());
        assert!(passe(&mut etat, &a, le(23, 10, 16, 1), false).is_empty());
        assert!(passe(&mut etat, &a, le(23, 10, 16, 4), false).is_empty());
        assert_eq!(passe(&mut etat, &a, le(23, 10, 30, 1), false).len(), 1);
    }

    #[test]
    fn req174_ac5_expression_illisible_ignoree_les_autres_marchent() {
        let mut ko = agent("ko", "toutes les heures");
        ko.declencheurs.push(Declencheur {
            genre: "planification".into(),
            chemin: None,
            texte: None,
            cron: None,
        });
        let a = [ko, agent("ok", "30 9 * * *")];
        let mut etat = Etat::default();
        let projet = std::env::temp_dir().join("yaide-planification-inexistant");
        let r = verifier(
            &mut etat,
            &projet,
            &a,
            true,
            |_| false,
            &[],
            &serde_json::json!({}),
            le(23, 9, 30, 1),
        );
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].0.dossier, "ok");
    }

    #[test]
    fn req174_lire_cron_cinq_champs_noms_anglais() {
        for ok in [
            "0 9 * * 1-5",
            "*/10 * * * *",
            "0 0 1,15 jan mon",
            "5 4 * * sun",
        ] {
            assert!(lire_cron(ok).is_some(), "{ok}");
        }
        for ko in [
            "",
            "* * *",
            "61 * * * *",
            "toutes les heures",
            "0 0 9 * * 1",
            "@daily",
        ] {
            assert!(lire_cron(ko).is_none(), "{ko}");
        }
    }
}
