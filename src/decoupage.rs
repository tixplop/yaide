//! Découpage d'un fichier en passages : trois stratégies et leurs réglages (REQ-113).

use crate::connaissance::Passage;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Strategie {
    TailleFixe,
    Paragraphes,
    SectionsMarkdown,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(default)]
pub struct Decoupage {
    pub strategie: Strategie,
    /// Taille maximale d'un passage, en caractères.
    pub taille: usize,
    /// Recouvrement en lignes, pour « Taille fixe » seule.
    pub recouvrement: usize,
}

impl Default for Decoupage {
    fn default() -> Self {
        Decoupage {
            strategie: Strategie::TailleFixe,
            taille: 2000,
            recouvrement: 0,
        }
    }
}

/// Réglage refusé : le champ (`taille` ou `recouvrement`) et le message à montrer.
#[derive(Debug, PartialEq, Eq)]
pub struct Refus {
    pub champ: &'static str,
    pub message: &'static str,
}

impl Decoupage {
    pub fn valider(&self) -> Result<(), Refus> {
        if !(200..=8000).contains(&self.taille) {
            return Err(Refus {
                champ: "taille",
                message: "Entre 200 et 8\u{a0}000 caractères.",
            });
        }
        if self.recouvrement > 10 {
            return Err(Refus {
                champ: "recouvrement",
                message: "Entre 0 et 10 lignes.",
            });
        }
        Ok(())
    }
}

struct Ligne {
    debut: usize,
    fin: usize,
    /// Caractères de la ligne, sans son saut de ligne.
    n: usize,
    /// Caractères du saut de ligne.
    saut: usize,
}

struct Decoupeur<'a> {
    chemin: &'a str,
    contenu: &'a str,
    lignes: Vec<Ligne>,
    /// Sommes cumulées des `n` et des `saut` : `somme[i]` couvre les lignes avant `i`.
    somme_n: Vec<usize>,
    somme_saut: Vec<usize>,
    taille: usize,
    passages: Vec<Passage>,
}

impl Decoupeur<'_> {
    fn ajouter(&mut self, debut: usize, fin: usize, o1: usize, o2: usize) {
        let texte = &self.contenu[o1..o2];
        if !texte.trim().is_empty() {
            self.passages.push(Passage {
                chemin: self.chemin.to_string(),
                debut,
                fin,
                octet_debut: o1,
                octet_fin: o2,
                texte: texte.to_string(),
            });
        }
    }

    /// Taille des lignes `a..=b` : caractères et sauts de ligne entre elles.
    fn mesure(&self, a: usize, b: usize) -> usize {
        self.somme_n[b + 1] - self.somme_n[a] + self.somme_saut[b] - self.somme_saut[a]
    }

    fn emettre(&mut self, a: usize, b: usize) {
        let (o1, o2) = (self.lignes[a].debut, self.lignes[b].fin);
        self.ajouter(a + 1, b + 1, o1, o2);
    }

    /// Une ligne plus longue que la taille : morceaux de la taille, sans recouvrement.
    fn couper_ligne(&mut self, i: usize) {
        let (debut_ligne, fin_ligne) = (self.lignes[i].debut, self.lignes[i].fin);
        let sans = &self.contenu[debut_ligne..fin_ligne];
        let mut o = debut_ligne;
        let mut compte = 0;
        let mut coupes = Vec::new();
        for (k, _) in sans.char_indices() {
            if compte == self.taille {
                coupes.push((o, debut_ligne + k));
                o = debut_ligne + k;
                compte = 0;
            }
            compte += 1;
        }
        coupes.push((o, fin_ligne));
        for (o1, o2) in coupes {
            self.ajouter(i + 1, i + 1, o1, o2);
        }
    }

    /// Lignes `a..=b` en passages de lignes entières, avec `recouvrement` lignes repétées.
    fn taille_fixe(&mut self, a: usize, b: usize, recouvrement: usize) {
        let mut i = a;
        while i <= b {
            if self.lignes[i].n > self.taille {
                self.couper_ligne(i);
                i += 1;
                continue;
            }
            let debut_passage = i;
            let mut j = i;
            while j < b
                && self.lignes[j + 1].n <= self.taille
                && self.mesure(i, j + 1) <= self.taille
            {
                j += 1;
            }
            self.emettre(i, j);
            if j == b {
                break;
            }
            let suivante = j + 1;
            i = suivante;
            if self.lignes[suivante].n > self.taille {
                continue;
            }
            let mut k = recouvrement.min(j - debut_passage);
            // Au moins une ligne nouvelle, moitié de la taille au plus, et la ligne suivante doit tenir.
            while k > 0
                && (self.mesure(suivante - k, j) > self.taille / 2
                    || self.mesure(suivante - k, suivante) > self.taille)
            {
                k -= 1;
            }
            i = suivante - k;
        }
    }

    /// Lignes `a..=b` en un seul passage s'il tient, sinon en « Taille fixe » sans recouvrement.
    fn bloc(&mut self, a: usize, b: usize) {
        if self.lignes[a..=b].iter().all(|l| l.n <= self.taille) && self.mesure(a, b) <= self.taille
        {
            self.emettre(a, b);
        } else {
            self.taille_fixe(a, b, 0);
        }
    }

    fn paragraphes(&mut self) {
        let vide: Vec<bool> = self
            .lignes
            .iter()
            .map(|l| self.contenu[l.debut..l.fin].trim().is_empty())
            .collect();
        // Passage en cours : de la première ligne du premier paragraphe à la dernière du dernier.
        let mut courant: Option<(usize, usize)> = None;
        let mut i = 0;
        while i < vide.len() {
            if vide[i] {
                i += 1;
                continue;
            }
            let mut j = i;
            while j + 1 < vide.len() && !vide[j + 1] {
                j += 1;
            }
            let tient = self.lignes[i..=j].iter().all(|l| l.n <= self.taille)
                && self.mesure(i, j) <= self.taille;
            if !tient {
                if let Some((a, b)) = courant.take() {
                    self.emettre(a, b);
                }
                self.taille_fixe(i, j, 0);
            } else if let Some((a, b)) = courant {
                if self.mesure(a, j) <= self.taille {
                    courant = Some((a, j));
                } else {
                    self.emettre(a, b);
                    courant = Some((i, j));
                }
            } else {
                courant = Some((i, j));
            }
            i = j + 1;
        }
        if let Some((a, b)) = courant {
            self.emettre(a, b);
        }
    }

    fn sections(&mut self) {
        let mut debuts = vec![0];
        let mut code = false;
        for (i, l) in self.lignes.iter().enumerate() {
            let t = &self.contenu[l.debut..l.fin];
            if t.starts_with("```") {
                code = !code;
            } else if !code && est_titre(t) && i > 0 {
                debuts.push(i);
            }
        }
        for (k, &a) in debuts.iter().enumerate() {
            let b = debuts.get(k + 1).map_or(self.lignes.len(), |&d| d) - 1;
            self.bloc(a, b);
        }
    }
}

fn est_titre(ligne: &str) -> bool {
    let dieses = ligne.chars().take_while(|&c| c == '#').count();
    (1..=6).contains(&dieses) && ligne[dieses..].starts_with(' ')
}

/// Découpe un fichier en passages selon `d`. Le texte d'un passage est la tranche exacte
/// du fichier, de `octet_debut` à `octet_fin`.
pub fn decouper(chemin: &str, contenu: &str, d: &Decoupage) -> Vec<Passage> {
    let mut lignes = Vec::new();
    let mut pos = 0;
    for brute in contenu.split_inclusive('\n') {
        let debut = pos;
        pos += brute.len();
        let sans = brute
            .strip_suffix('\n')
            .map_or(brute, |s| s.strip_suffix('\r').unwrap_or(s));
        let n = sans.chars().count();
        lignes.push(Ligne {
            debut,
            fin: debut + sans.len(),
            n,
            saut: brute.chars().count() - n,
        });
    }
    let mut somme_n = vec![0];
    let mut somme_saut = vec![0];
    for l in &lignes {
        somme_n.push(somme_n[somme_n.len() - 1] + l.n);
        somme_saut.push(somme_saut[somme_saut.len() - 1] + l.saut);
    }
    let mut c = Decoupeur {
        chemin,
        contenu,
        somme_n,
        somme_saut,
        lignes,
        taille: d.taille,
        passages: Vec::new(),
    };
    if c.lignes.is_empty() {
        return c.passages;
    }
    let dernier = c.lignes.len() - 1;
    let minuscule = chemin.to_lowercase();
    let markdown = minuscule.ends_with(".md") || minuscule.ends_with(".markdown");
    match d.strategie {
        Strategie::TailleFixe => c.taille_fixe(0, dernier, d.recouvrement),
        Strategie::Paragraphes => c.paragraphes(),
        Strategie::SectionsMarkdown if markdown => c.sections(),
        Strategie::SectionsMarkdown => c.taille_fixe(0, dernier, 0),
    }
    c.passages
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    fn d(strategie: Strategie, taille: usize, recouvrement: usize) -> Decoupage {
        Decoupage {
            strategie,
            taille,
            recouvrement,
        }
    }

    fn lignes(ps: &[Passage]) -> Vec<(usize, usize)> {
        ps.iter().map(|p| (p.debut, p.fin)).collect()
    }

    #[test]
    fn REQ113_AC2_recouvrement_de_deux_lignes() {
        let contenu: String = (0..30).map(|_| "a".repeat(19) + "\n").collect();
        let ps = decouper("f", &contenu, &d(Strategie::TailleFixe, 200, 2));
        assert_eq!(lignes(&ps), vec![(1, 10), (9, 18), (17, 26), (25, 30)]);
        for p in &ps {
            assert_eq!(p.texte, &contenu[p.octet_debut..p.octet_fin]);
        }
        assert_eq!(ps[1].octet_debut, 8 * 20);
        assert!(ps[1].octet_debut < ps[0].octet_fin);
        assert_eq!(ps[0].octet_fin - ps[1].octet_debut, 2 * 20 - 1);
    }

    #[test]
    fn REQ113_AC2_lignes_longues_sans_recouvrement() {
        let contenu: String = (0..4).map(|_| "b".repeat(150) + "\n").collect();
        let ps = decouper("f", &contenu, &d(Strategie::TailleFixe, 200, 2));
        assert_eq!(lignes(&ps), vec![(1, 1), (2, 2), (3, 3), (4, 4)]);
        let ps = decouper("f", &"c".repeat(500), &d(Strategie::TailleFixe, 200, 2));
        let tailles: Vec<usize> = ps.iter().map(|p| p.texte.len()).collect();
        assert_eq!(tailles, vec![200, 200, 100]);
        assert_eq!(ps[1].octet_debut, ps[0].octet_fin);
    }

    #[test]
    fn REQ113_AC3_paragraphes() {
        let contenu = format!(
            "{}\n\n{}\n\n{}\n",
            "a".repeat(80),
            "b".repeat(80),
            "c".repeat(150)
        );
        let ps = decouper("f", &contenu, &d(Strategie::Paragraphes, 200, 0));
        assert_eq!(lignes(&ps), vec![(1, 3), (5, 5)]);
        assert_eq!(
            ps[0].texte,
            format!("{}\n\n{}", "a".repeat(80), "b".repeat(80))
        );
        // Ligne d'espaces = vide.
        let contenu = format!("{}\n   \n{}\n", "a".repeat(150), "b".repeat(150));
        let ps = decouper("f", &contenu, &d(Strategie::Paragraphes, 200, 0));
        assert_eq!(lignes(&ps), vec![(1, 1), (3, 3)]);
        for p in &ps {
            assert!(!p.texte.starts_with('\n') && !p.texte.ends_with('\n'));
        }
        // Paragraphe de 500 caractères en lignes de 50.
        let contenu: String = (0..10).map(|_| "d".repeat(49) + "\n").collect();
        let ps = decouper("f", &contenu, &d(Strategie::Paragraphes, 200, 0));
        assert!(ps.len() > 1);
        assert!(ps.iter().all(|p| p.texte.chars().count() <= 200));
        assert_eq!(lignes(&ps), vec![(1, 4), (5, 8), (9, 10)]);
    }

    #[test]
    fn REQ113_AC4_sections_markdown() {
        let contenu = "intro\n# A\ntexte\n## A.1\n```\n# commentaire\n```\n# B\nfin\n";
        let ps = decouper("guide.md", contenu, &d(Strategie::SectionsMarkdown, 200, 0));
        assert_eq!(lignes(&ps), vec![(1, 1), (2, 3), (4, 7), (8, 9)]);
        let faux = "#titre\n####### x\nsuite\n";
        let ps = decouper("a.md", faux, &d(Strategie::SectionsMarkdown, 200, 0));
        assert_eq!(lignes(&ps), vec![(1, 3)]);
        for nom in ["GUIDE.MD", "x.markdown"] {
            let ps = decouper(nom, contenu, &d(Strategie::SectionsMarkdown, 200, 0));
            assert_eq!(ps.len(), 4, "{nom}");
        }
        // Section trop longue.
        let longue: String = "# T\n".to_string()
            + &"e".repeat(99)
            + "\n"
            + &"f".repeat(99)
            + "\n"
            + &"g".repeat(99)
            + "\n";
        let ps = decouper("a.md", &longue, &d(Strategie::SectionsMarkdown, 200, 0));
        assert!(ps.len() > 1);
        assert!(ps.iter().all(|p| p.texte.chars().count() <= 200));
        // Autres fichiers : taille fixe sans recouvrement.
        let code = "# c\nx = 1\n# d\ny = 2\n";
        for nom in ["script.py", "notes.txt"] {
            assert_eq!(
                decouper(nom, code, &d(Strategie::SectionsMarkdown, 200, 3)),
                decouper(nom, code, &d(Strategie::TailleFixe, 200, 0)),
                "{nom}"
            );
        }
    }

    #[test]
    fn REQ113_AC5_validation() {
        let t = Refus {
            champ: "taille",
            message: "Entre 200 et 8\u{a0}000 caractères.",
        };
        assert_eq!(d(Strategie::TailleFixe, 199, 0).valider(), Err(t));
        let t = Refus {
            champ: "taille",
            message: "Entre 200 et 8\u{a0}000 caractères.",
        };
        assert_eq!(d(Strategie::TailleFixe, 8001, 0).valider(), Err(t));
        let r = Refus {
            champ: "recouvrement",
            message: "Entre 0 et 10 lignes.",
        };
        assert_eq!(d(Strategie::TailleFixe, 2000, 11).valider(), Err(r));
        assert!(d(Strategie::TailleFixe, 200, 0).valider().is_ok());
        assert!(d(Strategie::Paragraphes, 8000, 10).valider().is_ok());
        for mauvais in [
            r#"{"strategie":"taille_fixe","taille":-1,"recouvrement":0}"#,
            r#"{"strategie":"taille_fixe","taille":1.5,"recouvrement":0}"#,
            r#"{"strategie":"taille_fixe","taille":"2000","recouvrement":0}"#,
            r#"{"strategie":"inconnue","taille":2000,"recouvrement":0}"#,
            r#"{"strategie":"taille_fixe","taille":2000,"recouvrement":-1}"#,
        ] {
            assert!(
                serde_json::from_str::<Decoupage>(mauvais).is_err(),
                "{mauvais}"
            );
        }
        let ok: Decoupage = serde_json::from_str(
            r#"{"strategie":"sections_markdown","taille":300,"recouvrement":1}"#,
        )
        .unwrap();
        assert_eq!(ok, d(Strategie::SectionsMarkdown, 300, 1));
        assert_eq!(
            serde_json::from_str::<Decoupage>("{}").unwrap(),
            Decoupage::default()
        );
    }
}
