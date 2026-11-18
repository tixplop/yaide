//! Avertissements de mise en page d'un whiteboard écrit par l'agent (REQ-148, DEC-097) : boîtes qui se
//! chevauchent, liens sur des boîtes, liens qui se croisent ou se superposent, textes qui dépassent.
//! Les tailles de texte sont estimées : le serveur ne connaît pas la police du navigateur.

use super::jdiag_trace::{milieu, trace};
use serde_json::Value;

type Point = (f64, f64);
type Rect = (f64, f64, f64, f64); // x, y, largeur, hauteur

const MAX_LIGNES: usize = 50;

fn nombre(v: &Value, cle: &str) -> f64 {
    v.get(cle).and_then(Value::as_f64).unwrap_or(0.0)
}

fn texte<'a>(v: &'a Value, cle: &str) -> &'a str {
    v.get(cle).and_then(Value::as_str).unwrap_or("")
}

fn rect(b: &Value) -> Rect {
    (
        nombre(b, "x"),
        nombre(b, "y"),
        nombre(b, "width"),
        nombre(b, "height"),
    )
}

/// Taille de police et interligne de `textSize`.
fn taille(v: &Value) -> (f64, f64) {
    match texte(v, "textSize") {
        "small" => (11.0, 15.0),
        "large" => (18.0, 24.0),
        "xlarge" => (24.0, 30.0),
        _ => (13.0, 18.0),
    }
}

fn contient(a: Rect, b: Rect) -> bool {
    a.0 <= b.0 && a.1 <= b.1 && a.0 + a.2 >= b.0 + b.2 && a.1 + a.3 >= b.1 + b.3
}

fn chevauche(a: Rect, b: Rect) -> bool {
    a.0 < b.0 + b.2 && b.0 < a.0 + a.2 && a.1 < b.1 + b.3 && b.1 < a.1 + a.3
}

/// Le segment pénètre-t-il à l'intérieur du rectangle (bords exclus) ?
fn segment_dans(p: Point, q: Point, r: Rect) -> bool {
    let (mut t0, mut t1) = (0.0_f64, 1.0_f64);
    let d = (q.0 - p.0, q.1 - p.1);
    for (dir, debut, min, max) in [(d.0, p.0, r.0, r.0 + r.2), (d.1, p.1, r.1, r.1 + r.3)] {
        if dir.abs() < 1e-12 {
            if debut <= min || debut >= max {
                return false;
            }
        } else {
            let (a, b) = ((min - debut) / dir, (max - debut) / dir);
            t0 = t0.max(a.min(b));
            t1 = t1.min(a.max(b));
        }
    }
    if t0 > t1 {
        return false;
    }
    let t = (t0 + t1) / 2.0;
    let m = (p.0 + d.0 * t, p.1 + d.1 * t);
    let e = 1e-9;
    m.0 > r.0 + e && m.0 < r.0 + r.2 - e && m.1 > r.1 + e && m.1 < r.1 + r.3 - e
}

fn croise(a: (Point, Point), b: (Point, Point)) -> Option<Point> {
    let (r, s) = (
        (a.1 .0 - a.0 .0, a.1 .1 - a.0 .1),
        (b.1 .0 - b.0 .0, b.1 .1 - b.0 .1),
    );
    let den = r.0 * s.1 - r.1 * s.0;
    if den.abs() < 1e-9 {
        return None;
    }
    let (qp0, qp1) = (b.0 .0 - a.0 .0, b.0 .1 - a.0 .1);
    let t = (qp0 * s.1 - qp1 * s.0) / den;
    let u = (qp0 * r.1 - qp1 * r.0) / den;
    let ok = (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u);
    ok.then_some((a.0 .0 + r.0 * t, a.0 .1 + r.1 * t))
}

/// Longueur que deux segments portés par la même droite ont en commun.
fn commun(a: (Point, Point), b: (Point, Point)) -> f64 {
    let (dx, dy) = (a.1 .0 - a.0 .0, a.1 .1 - a.0 .1);
    let l = dx.hypot(dy);
    if l < 1e-9 {
        return 0.0;
    }
    let (ux, uy) = (dx / l, dy / l);
    let dist = |p: Point| ((p.0 - a.0 .0) * uy - (p.1 - a.0 .1) * ux).abs();
    if dist(b.0) > 0.02 || dist(b.1) > 0.02 {
        return 0.0;
    }
    let proj = |p: Point| (p.0 - a.0 .0) * ux + (p.1 - a.0 .1) * uy;
    let (p, q) = (proj(b.0), proj(b.1));
    (l.min(p.max(q)) - 0.0_f64.max(p.min(q))).max(0.0)
}

/// Relation de deux tracés : superposition (longueur commune) ou croisement.
enum Relation {
    Superpose(f64),
    Croise,
}

fn relation(a: &[Point], b: &[Point]) -> Option<Relation> {
    let segs =
        |p: &[Point]| -> Vec<(Point, Point)> { p.windows(2).map(|w| (w[0], w[1])).collect() };
    let (sa, sb) = (segs(a), segs(b));
    let mut total = 0.0;
    for x in &sa {
        for y in &sb {
            total += commun(*x, *y);
        }
    }
    if total > 2.0 {
        return Some(Relation::Superpose(total));
    }
    let bouts = [a.first(), a.last(), b.first(), b.last()];
    for x in &sa {
        for y in &sb {
            if let Some(p) = croise(*x, *y) {
                let loin = bouts
                    .iter()
                    .flatten()
                    .all(|e| (e.0 - p.0).hypot(e.1 - p.1) >= 2.0);
                if loin {
                    return Some(Relation::Croise);
                }
            }
        }
    }
    None
}

/// Nombre de lignes du texte une fois reparti dans `n` caractères par ligne (retour glouton aux espaces).
fn lignes(texte: &str, n: usize) -> usize {
    if texte.is_empty() {
        return 0;
    }
    let n = n.max(1);
    let mut total = 0;
    for ligne in texte.split('\n') {
        total += 1;
        let mut cur = 0;
        for mot in ligne.split(' ').filter(|m| !m.is_empty()) {
            let l = mot.chars().count();
            if cur > 0 && cur + 1 + l <= n {
                cur += 1 + l;
                continue;
            }
            if cur > 0 {
                total += 1;
            }
            let morceaux = l.div_ceil(n);
            total += morceaux - 1;
            cur = l - (morceaux - 1) * n;
        }
    }
    total
}

/// Avertissements de mise en page du whiteboard (valide, tel qu'écrit), une ligne `- …` chacun, au plus 50 puis
/// `- and <n> more.`.
pub fn avertissements(whiteboard: &Value) -> Vec<String> {
    let vide = Vec::new();
    let boites = whiteboard["boxes"].as_array().unwrap_or(&vide);
    let liens = whiteboard["links"].as_array().unwrap_or(&vide);
    let id = |v: &Value| texte(v, "id").to_string();
    let rects: Vec<Rect> = boites.iter().map(rect).collect();
    let mut m: Vec<String> = Vec::new();

    for i in 0..boites.len() {
        for j in i + 1..boites.len() {
            let (a, b) = (rects[i], rects[j]);
            if chevauche(a, b) && !contient(a, b) && !contient(b, a) {
                m.push(format!(
                    "- Boxes {} and {} overlap.",
                    id(&boites[i]),
                    id(&boites[j])
                ));
            }
        }
    }

    let traces: Vec<Vec<Point>> = liens.iter().map(|l| trace(boites, liens, l)).collect();
    let index = |cle: &str, l: &Value| boites.iter().position(|b| texte(b, "id") == texte(l, cle));
    for (k, l) in liens.iter().enumerate() {
        let (Some(de), Some(vers)) = (index("from", l), index("to", l)) else {
            continue;
        };
        for (i, b) in boites.iter().enumerate() {
            if i == de
                || i == vers
                || contient(rects[i], rects[de])
                || contient(rects[i], rects[vers])
            {
                continue;
            }
            let r = (
                rects[i].0 + 1.0,
                rects[i].1 + 1.0,
                rects[i].2 - 2.0,
                rects[i].3 - 2.0,
            );
            if r.2 > 0.0 && r.3 > 0.0 && traces[k].windows(2).any(|w| segment_dans(w[0], w[1], r)) {
                m.push(format!(
                    "- Link {} ({} → {}) passes over box {}.",
                    id(l),
                    id(&boites[de]),
                    id(&boites[vers]),
                    id(b)
                ));
            }
        }
    }

    for i in 0..liens.len() {
        for j in i + 1..liens.len() {
            let (a, b) = (id(&liens[i]), id(&liens[j]));
            match relation(&traces[i], &traces[j]) {
                Some(Relation::Superpose(n)) => {
                    m.push(format!("- Links {a} and {b} overlap on {} px.", n.round()))
                }
                Some(Relation::Croise) => m.push(format!("- Links {a} and {b} cross.")),
                None => {}
            }
        }
    }

    let textes: Vec<Option<Rect>> = liens
        .iter()
        .zip(&traces)
        .map(|(l, t)| {
            let s = texte(l, "text");
            if s.is_empty() || t.len() < 2 {
                return None;
            }
            let (police, interligne) = taille(l);
            let large =
                s.split('\n').map(|x| x.chars().count()).max().unwrap_or(0) as f64 * 0.6 * police
                    + 8.0;
            let haut = s.split('\n').count() as f64 * interligne + 4.0;
            let c = milieu(t);
            Some((c.0 - large / 2.0, c.1 - haut / 2.0, large, haut))
        })
        .collect();
    for (i, l) in liens.iter().enumerate() {
        let Some(r) = textes[i] else { continue };
        for (j, b) in boites.iter().enumerate() {
            if chevauche(r, rects[j]) && !contient(rects[j], r) {
                m.push(format!("- Text of link {} overlaps box {}.", id(l), id(b)));
            }
        }
        for j in i + 1..liens.len() {
            if textes[j].is_some_and(|s| chevauche(r, s)) {
                m.push(format!(
                    "- Texts of links {} and {} overlap.",
                    id(l),
                    id(&liens[j])
                ));
            }
        }
    }

    for (b, &(_, _, w, h)) in boites.iter().zip(&rects) {
        let r = match texte(b, "shape") {
            "ellipse" => (1.0 - 0.5_f64.sqrt()) / 2.0,
            "diamond" => 0.25,
            _ => 0.0,
        };
        let (police, interligne) = taille(b);
        let large = w * (1.0 - 2.0 * r) - 16.0;
        let haut = h * (1.0 - 2.0 * r) - 12.0;
        let n = ((large / (0.6 * police) + 1e-9).floor().max(1.0)) as usize;
        let total = lignes(texte(b, "text"), n);
        let tient = (((haut / interligne) + 1e-9).floor().max(0.0)) as usize;
        if total > tient {
            let conseil = ((total as f64 * interligne + 12.0) / (1.0 - 2.0 * r) - 1e-9).ceil();
            m.push(format!(
                "- Box {}: text overflows ({total} lines, {tient} fit); a height of {conseil} would fit it.",
                id(b)
            ));
        }
    }

    if m.len() > MAX_LIGNES {
        let reste = m.len() - MAX_LIGNES;
        m.truncate(MAX_LIGNES);
        m.push(format!("- and {reste} more."));
    }
    m
}

/// Le bloc ajouté au résultat de `whiteboard_write`, vide sans avertissement.
pub fn bloc(whiteboard: &Value) -> String {
    let m = avertissements(whiteboard);
    if m.is_empty() {
        return String::new();
    }
    format!(
        "\nLayout warnings (estimated sizes; the file was written):\n{}",
        m.join("\n")
    )
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use serde_json::json;

    fn b(id: &str, x: i64, y: i64, w: i64, h: i64) -> Value {
        json!({"id": id, "x": x, "y": y, "width": w, "height": h, "text": ""})
    }

    fn l(id: &str, de: &str, vers: &str) -> Value {
        json!({"id": id, "from": de, "to": vers})
    }

    fn wb(boites: Vec<Value>, liens: Vec<Value>) -> Value {
        json!({"version": 1, "boxes": boites, "links": liens})
    }

    fn deux(b2: (i64, i64)) -> Vec<Value> {
        vec![b("b1", 40, 80, 160, 80), b("b2", b2.0, b2.1, 160, 80)]
    }

    #[test]
    fn REQ148_AC1_boites_qui_se_chevauchent() {
        let a = |b2| avertissements(&wb(deux(b2), vec![l("l1", "b1", "b2")]));
        assert_eq!(a((150, 100)), ["- Boxes b1 and b2 overlap."]);
        assert!(a((200, 80)).is_empty());
        let mut v = deux((300, 80));
        v.push(b("b3", 60, 100, 40, 30));
        assert!(avertissements(&wb(v, vec![])).is_empty());
    }

    #[test]
    fn REQ148_AC2_lien_sur_une_boite() {
        let mut v = vec![b("b1", 40, 80, 160, 80), b("b2", 500, 80, 160, 80)];
        let lien = vec![l("l1", "b1", "b2")];
        v.push(b("b3", 260, 90, 80, 40));
        let attendu = ["- Link l1 (b1 → b2) passes over box b3."];
        assert_eq!(avertissements(&wb(v.clone(), lien.clone())), attendu);
        let mut avec_cadre = v.clone();
        avec_cadre.push(b("b0", 0, 0, 800, 300));
        assert_eq!(avertissements(&wb(avec_cadre, lien.clone())), attendu);
        v[2] = b("b3", 260, 200, 80, 40);
        assert!(avertissements(&wb(v.clone(), lien)).is_empty());
        v[2] = b("b3", 300, 300, 80, 40);
        let mut cotes = l("l1", "b1", "b2");
        cotes["fromSide"] = json!("bottom");
        cotes["toSide"] = json!("bottom");
        cotes["route"] = json!("orthogonal");
        assert!(avertissements(&wb(v.clone(), vec![cotes.clone()])).is_empty());
        cotes["route"] = json!("curved");
        assert_eq!(avertissements(&wb(v, vec![cotes])), attendu);
    }

    #[test]
    fn REQ148_AC3_liens_qui_se_croisent_ou_se_superposent() {
        let v = vec![
            b("b1", 0, 0, 160, 80),
            b("b2", 300, 200, 160, 80),
            b("b3", 300, 0, 160, 80),
            b("b4", 0, 200, 160, 80),
        ];
        let r = avertissements(&wb(v, vec![l("l1", "b1", "b2"), l("l2", "b3", "b4")]));
        assert_eq!(r, ["- Links l1 and l2 cross."]);
        let v = vec![
            b("b1", 200, 0, 160, 80),
            b("b2", 0, 200, 160, 80),
            b("b3", 400, 200, 160, 80),
        ];
        let coude = |id, vers| json!({"id": id, "from": "b1", "to": vers, "fromSide": "bottom", "toSide": "top", "route": "orthogonal"});
        let r = avertissements(&wb(v.clone(), vec![coude("l1", "b2"), coude("l2", "b3")]));
        assert_eq!(r, ["- Links l1 and l2 overlap on 60 px."]);
        let droit = |id, vers| json!({"id": id, "from": "b1", "to": vers, "fromSide": "bottom", "toSide": "top"});
        let r = avertissements(&wb(v, vec![droit("l1", "b2"), droit("l2", "b3")]));
        assert!(r.is_empty(), "{r:?}");
    }

    #[test]
    fn REQ148_AC4_texte_des_liens() {
        let avec = |t: &str| {
            let mut lien = l("l1", "b1", "b2");
            lien["text"] = json!(t);
            avertissements(&wb(deux((300, 80)), vec![lien]))
        };
        assert!(avec("mail").is_empty());
        assert_eq!(
            avec("un texte assez long"),
            [
                "- Text of link l1 overlaps box b1.",
                "- Text of link l1 overlaps box b2."
            ]
        );
        let v = vec![
            b("b1", 0, 0, 20, 20),
            b("b2", 400, 0, 20, 20),
            b("b3", 0, 6, 20, 20),
            b("b4", 400, 6, 20, 20),
        ];
        let (mut l1, mut l2) = (l("l1", "b1", "b2"), l("l2", "b3", "b4"));
        l1["text"] = json!("bonjour");
        l2["text"] = json!("bonsoir");
        let r = avertissements(&wb(v, vec![l1, l2]));
        assert!(
            r.contains(&"- Texts of links l1 and l2 overlap.".to_string()),
            "{r:?}"
        );
    }

    fn texte(w: i64, h: i64, t: &str, extra: Value) -> Vec<String> {
        let mut bo = json!({"id": "b1", "x": 0, "y": 0, "width": w, "height": h, "text": t});
        bo.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        avertissements(&wb(vec![bo], vec![]))
    }

    #[test]
    fn REQ148_AC5_texte_des_boites() {
        let nul = json!({});
        assert_eq!(
            texte(160, 80, "a\nb\nc\nd", nul.clone()),
            ["- Box b1: text overflows (4 lines, 3 fit); a height of 84 would fit it."]
        );
        let long = "un deux trois quatre cinq six sept huit neuf dix onze douze";
        assert_eq!(texte(160, 80, long, nul.clone()).len(), 1);
        assert!(texte(160, 100, long, nul.clone()).is_empty());
        let rond = json!({"shape": "ellipse"});
        assert!(texte(100, 100, "a\nb\nc", rond.clone()).is_empty());
        assert_eq!(
            texte(100, 100, "a\nb\nc\nd", rond),
            ["- Box b1: text overflows (4 lines, 3 fit); a height of 119 would fit it."]
        );
        let grand = json!({"textSize": "xlarge"});
        assert!(texte(160, 80, "a\nb", grand.clone()).is_empty());
        assert_eq!(texte(160, 80, "a\nb\nc", grand).len(), 1);
        assert!(texte(160, 80, "", nul.clone()).is_empty());
        // Un mot plus long qu'une ligne est coupé : 40 caractères à 18 par ligne = 3 lignes.
        assert!(texte(160, 80, &"x".repeat(54), nul.clone()).is_empty());
        assert_eq!(texte(160, 80, &"x".repeat(55), nul).len(), 1);
    }

    #[test]
    fn REQ148_AC6_limite_et_ordre() {
        let mut boites = Vec::new();
        for i in 0..60 {
            boites.push(json!({"id": format!("b{i}"), "x": 0, "y": i * 200, "width": 160, "height": 80, "text": "a\nb\nc\nd"}));
        }
        let r = avertissements(&wb(boites, vec![]));
        assert_eq!(r.len(), 51);
        assert!(r[0].starts_with("- Box b0: text overflows"));
        assert_eq!(r[50], "- and 10 more.");
        // Ordre : boîtes, liens sur des boîtes, liens entre eux, textes des liens, textes des boîtes.
        let mut v = vec![
            b("b1", 0, 0, 160, 80),
            b("b2", 100, 40, 160, 80),
            b("b3", 600, 0, 160, 80),
            b("b4", 300, 30, 80, 40),
            b("b5", 500, 300, 50, 50),
            b("b6", 500, -200, 50, 50),
        ];
        v[0]["text"] = json!("a\nb\nc\nd");
        let mut l1 = l("l1", "b1", "b3");
        l1["text"] = json!("un texte assez long");
        let r = avertissements(&wb(v, vec![l1, l("l2", "b5", "b6")]));
        let pos = |s: &str| {
            r.iter()
                .position(|x| x.contains(s))
                .unwrap_or_else(|| panic!("{s}: {r:?}"))
        };
        assert!(pos("Boxes b1 and b2") < pos("passes over box b4"));
        assert!(pos("passes over box b4") < pos("Links l1 and l2 cross"));
        assert!(pos("Links l1 and l2 cross") < pos("Text of link l1"));
        assert!(pos("Text of link l1") < pos("Box b1: text"));
    }
}
