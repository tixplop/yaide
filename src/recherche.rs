use crate::{depot, fichiers};
use ignore::WalkBuilder;
use std::fs;
use std::path::Path;

/// Nombre de résultats au-delà duquel la recherche s'arrête.
pub const MAX_RESULTATS: usize = 500;
/// Nombre de caractères d'une ligne gardés dans un résultat.
const LARGEUR_LIGNE: usize = 300;

pub struct Resultat {
    pub chemin: String,
    /// À partir de 1.
    pub ligne: usize,
    pub texte: String,
    /// Partie trouvée dans `texte`, en caractères (`debut` inclus, `fin` exclu).
    pub debut: usize,
    pub fin: usize,
}

pub struct Reponse {
    pub resultats: Vec<Resultat>,
    /// Vrai si d'autres résultats existent au-delà de `MAX_RESULTATS`.
    pub limite: bool,
}

fn minuscules(texte: &str) -> Vec<char> {
    texte
        .chars()
        .map(|c| c.to_lowercase().next().unwrap_or(c))
        .collect()
}

/// Cherche `requete` (texte tel quel, sans tenir compte de la casse) dans les fichiers de `racine`.
/// Seules les règles de git comptent pour ignorer des fichiers (DEC-020).
pub fn chercher(racine: &Path, requete: &str) -> Reponse {
    let requete = minuscules(requete);
    let mut rep = Reponse {
        resultats: Vec::new(),
        limite: false,
    };
    if requete.is_empty() {
        return rep;
    }
    let git = depot::est_un_depot(racine);
    let marcheur = WalkBuilder::new(racine)
        .hidden(false)
        .ignore(false)
        .git_ignore(git)
        .git_exclude(git)
        .git_global(git)
        .parents(git)
        .sort_by_file_path(|a, b| a.cmp(b))
        .filter_entry(|e| e.file_name() != ".git")
        .build();
    for entree in marcheur.flatten() {
        if !entree.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Ok(meta) = entree.metadata() else {
            continue;
        };
        if meta.len() > fichiers::TAILLE_MAX {
            continue;
        }
        let Ok(octets) = fs::read(entree.path()) else {
            continue;
        };
        if octets.contains(&0) {
            continue;
        }
        let Ok(contenu) = String::from_utf8(octets) else {
            continue;
        };
        let chemin = entree
            .path()
            .strip_prefix(racine)
            .unwrap_or(entree.path())
            .to_string_lossy()
            .into_owned();
        for (i, ligne) in contenu.lines().enumerate() {
            let bas = minuscules(ligne);
            let Some(debut) = bas.windows(requete.len()).position(|w| w == requete) else {
                continue;
            };
            if rep.resultats.len() == MAX_RESULTATS {
                rep.limite = true;
                return rep;
            }
            let (texte, debut) = couper(ligne, debut);
            let fin = (debut + requete.len()).min(texte.chars().count());
            rep.resultats.push(Resultat {
                chemin: chemin.clone(),
                ligne: i + 1,
                texte,
                debut,
                fin,
            });
        }
    }
    rep
}

/// Garde `LARGEUR_LIGNE` caractères autour du début de la partie trouvée ; rend le texte et le nouveau début.
fn couper(ligne: &str, debut: usize) -> (String, usize) {
    if ligne.chars().count() <= LARGEUR_LIGNE {
        return (ligne.to_string(), debut);
    }
    let depart = debut.saturating_sub(40);
    (
        ligne.chars().skip(depart).take(LARGEUR_LIGNE).collect(),
        debut - depart,
    )
}
