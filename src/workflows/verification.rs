//! Vérification d'un workflow avant sa publication (REQ-192, REQ-193, REQ-195).
use super::{Noeud, Workflow, DECLENCHEURS};
use crate::agent::agents::chemin_du_projet;
use crate::agent::declencheurs::lire_cron;

fn texte<'a>(n: &'a Noeud, champ: &str) -> &'a str {
    n.reglages
        .get(champ)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
}

/// Les problèmes, dans l'ordre de V-016 ; vide si le workflow peut être publié.
pub fn verifier(w: &Workflow) -> Vec<String> {
    let mut m = Vec::new();
    let declencheurs: Vec<&Noeud> = w
        .noeuds
        .iter()
        .filter(|n| DECLENCHEURS.contains(&n.genre.as_str()))
        .collect();
    let actions: Vec<&Noeud> = w
        .noeuds
        .iter()
        .filter(|n| !DECLENCHEURS.contains(&n.genre.as_str()))
        .collect();
    match declencheurs.len() {
        0 => m.push("Ajoutez un déclencheur.".to_string()),
        1 => {}
        _ => m.push("Un seul déclencheur par workflow.".to_string()),
    }
    if actions.is_empty() {
        m.push("Ajoutez une action.".to_string());
    }
    for a in &actions {
        if !relie(w, &a.id) {
            m.push(format!("« {} » n'est pas relié au déclencheur.", a.titre));
        }
    }
    for n in &w.noeuds {
        if let Some(p) = probleme(n) {
            m.push(format!("« {} » : {p}", n.titre));
        }
    }
    m
}

/// Un chemin de liens mène-t-il de ce nœud à un déclencheur ?
fn relie(w: &Workflow, id: &str) -> bool {
    let mut vus = vec![id.to_string()];
    let mut a_voir = vec![id.to_string()];
    while let Some(courant) = a_voir.pop() {
        for l in w.liens.iter().filter(|l| l.vers == courant) {
            if vus.contains(&l.de) {
                continue;
            }
            let est_declencheur = w
                .noeuds
                .iter()
                .any(|n| n.id == l.de && DECLENCHEURS.contains(&n.genre.as_str()));
            if est_declencheur {
                return true;
            }
            vus.push(l.de.clone());
            a_voir.push(l.de.clone());
        }
    }
    false
}

const CHEMIN: &str = "donnez un chemin dans le projet.";

/// Le message du premier champ refusé d'un nœud.
fn probleme(n: &Noeud) -> Option<String> {
    let manque = |champ: &str, msg: &str| texte(n, champ).is_empty().then(|| msg.to_string());
    match n.genre.as_str() {
        "dossier" => {
            if !chemin_du_projet(texte(n, "dossier")) {
                return Some(CHEMIN.into());
            }
            let coche = n
                .reglages
                .get("evenements")
                .and_then(|v| v.as_array())
                .is_some_and(|e| {
                    e.iter()
                        .any(|v| matches!(v.as_str(), Some("cree" | "modifie" | "supprime")))
                });
            (!coche).then(|| "cochez au moins un évènement.".to_string())
        }
        "planification" => lire_cron(texte(n, "cron")).is_none().then(|| {
            "donnez une expression cron à cinq champs, par exemple 0 9 * * 1-5.".to_string()
        }),
        "appel" => None,
        "agent" => manque("agent", "choisissez un agent.")
            .or_else(|| manque("message", "donnez le message.")),
        "shell" => manque("commande", "donnez la commande."),
        "claude" => manque("demande", "donnez la demande."),
        "trace" => manque("message", "donnez le message."),
        "fichier" => {
            let operation = texte(n, "operation");
            if !["lire", "ecrire", "copier", "deplacer", "supprimer"].contains(&operation) {
                return Some("choisissez une opération.".into());
            }
            if !chemin_du_projet(texte(n, "chemin")) {
                return Some(CHEMIN.into());
            }
            match operation {
                "ecrire" => manque("contenu", "donnez le contenu."),
                "copier" | "deplacer" => (!chemin_du_projet(texte(n, "destination")))
                    .then(|| "donnez une destination dans le projet.".to_string()),
                _ => None,
            }
        }
        _ => Some("type de nœud inconnu.".into()),
    }
}
