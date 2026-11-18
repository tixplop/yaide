//! Tracé d'un lien de whiteboard à 100 %, tel que `geometrieLien(doc, lien, 1).entier` le donne dans
//! `web/src/ui/tableau-calculs.js` (REQ-148, DEC-097) : mêmes cas, mêmes arrondis. Les cas communs sont dans
//! `jdiag_traces.json`, lu aussi par `tableau-calculs.test.js`.

use serde_json::Value;

type Point = (f64, f64);

const SORTIE_MIN: f64 = 16.0;
const COURBE_MIN: f64 = 40.0;
const COTES: [&str; 4] = ["top", "right", "bottom", "left"];

#[derive(Clone, Copy)]
struct Boite<'a> {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    forme: &'a str,
}

fn boite(v: &Value) -> Option<Boite<'_>> {
    let n = |c: &str| v.get(c).and_then(Value::as_f64);
    Some(Boite {
        x: n("x")?,
        y: n("y")?,
        w: n("width")?,
        h: n("height")?,
        forme: v
            .get("shape")
            .and_then(Value::as_str)
            .unwrap_or("rectangle"),
    })
}

fn normale(cote: &str) -> Point {
    match cote {
        "top" => (0.0, -1.0),
        "right" => (1.0, 0.0),
        "bottom" => (0.0, 1.0),
        _ => (-1.0, 0.0),
    }
}

/// Arrondi à 2 décimales comme `toFixed(2)` : la moitié s'éloigne de zéro.
fn arrondi(n: f64) -> f64 {
    let r = ((n.abs() * 100.0) + 0.5).floor() / 100.0;
    if n < 0.0 && r != 0.0 {
        -r
    } else {
        r
    }
}

fn centre(b: &Boite) -> Point {
    (b.x + b.w / 2.0, b.y + b.h / 2.0)
}

/// Point où le rayon issu de (ox, oy) dans la direction (dx, dy) quitte la forme de `b` centrée en (ox, oy).
fn sortie(b: &Boite, ox: f64, oy: f64, dx: f64, dy: f64) -> Point {
    if dx == 0.0 && dy == 0.0 {
        return (ox, oy);
    }
    let t = match b.forme {
        "ellipse" => 1.0 / (dx / (b.w / 2.0)).hypot(dy / (b.h / 2.0)),
        "diamond" => 1.0 / (dx.abs() / (b.w / 2.0) + dy.abs() / (b.h / 2.0)),
        _ => {
            let tx = if dx == 0.0 {
                f64::INFINITY
            } else {
                b.w / 2.0 / dx.abs()
            };
            let ty = if dy == 0.0 {
                f64::INFINITY
            } else {
                b.h / 2.0 / dy.abs()
            };
            tx.min(ty)
        }
    };
    (ox + dx * t, oy + dy * t)
}

fn extremites_fleche(de: &Boite, vers: &Boite, decalage: f64) -> (Point, Point) {
    let (ax, ay) = centre(de);
    let (vx, vy) = centre(vers);
    let (dx, dy) = (vx - ax, vy - ay);
    let l = dx.hypot(dy);
    let l = if l == 0.0 { 1.0 } else { l };
    let (ox, oy) = (-dy / l * decalage, dx / l * decalage);
    (
        sortie(de, ax + ox, ay + oy, dx, dy),
        sortie(vers, ax + dx + ox, ay + dy + oy, -dx, -dy),
    )
}

fn connecteur(b: &Boite, cote: &str) -> Point {
    let (mx, my) = centre(b);
    match cote {
        "top" => (mx, b.y),
        "right" => (b.x + b.w, my),
        "bottom" => (mx, b.y + b.h),
        _ => (b.x, my),
    }
}

fn connecteur_proche(b: &Boite, p: Point) -> &'static str {
    let dist = |c: &str| {
        let q = connecteur(b, c);
        (q.0 - p.0).hypot(q.1 - p.1)
    };
    COTES
        .iter()
        .copied()
        .reduce(|m, c| if dist(c) < dist(m) { c } else { m })
        .unwrap_or("top")
}

fn cotes_proches(a: &Boite, b: &Boite) -> (&'static str, &'static str) {
    let mut meilleur: Option<(&str, &str, f64)> = None;
    for de in COTES {
        for vers in COTES {
            let (p, q) = (connecteur(a, de), connecteur(b, vers));
            let d = (p.0 - q.0).hypot(p.1 - q.1);
            if meilleur.is_none_or(|m| d < m.2) {
                meilleur = Some((de, vers, d));
            }
        }
    }
    let m = meilleur.unwrap_or(("top", "top", 0.0));
    (m.0, m.1)
}

fn simplifier(points: Vec<Point>) -> Vec<Point> {
    let mut sans: Vec<Point> = Vec::new();
    for p in points {
        if sans.last() != Some(&p) {
            sans.push(p);
        }
    }
    let n = sans.len();
    (0..n)
        .filter(|&i| {
            if i == 0 || i == n - 1 {
                return true;
            }
            let (a, p, b) = (sans[i - 1], sans[i], sans[i + 1]);
            let aligne = (p.0 - a.0) * (b.1 - p.1) - (p.1 - a.1) * (b.0 - p.0) == 0.0;
            !(aligne && (p.0 - a.0) * (b.0 - p.0) + (p.1 - a.1) * (b.1 - p.1) > 0.0)
        })
        .map(|i| sans[i])
        .collect()
}

fn points_coudes(a: Point, b: Point, n1: Point, n2: Point) -> Vec<Point> {
    let m = SORTIE_MIN;
    let horiz1 = n1.0 != 0.0;
    let produit = n1.0 * n2.0 + n1.1 * n2.1;
    let ecart = (b.0 - a.0) * n1.0 + (b.1 - a.1) * n1.1;
    let p1 = (a.0 + n1.0 * m, a.1 + n1.1 * m);
    let p2 = (b.0 + n2.0 * m, b.1 + n2.1 * m);
    if produit == -1.0 {
        if ecart >= 2.0 * m {
            let (mx, my) = ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
            return if horiz1 {
                vec![a, (mx, a.1), (mx, b.1), b]
            } else {
                vec![a, (a.0, my), (b.0, my), b]
            };
        }
        let (mx, my) = ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
        return if horiz1 {
            vec![a, p1, (p1.0, my), (p2.0, my), p2, b]
        } else {
            vec![a, p1, (mx, p1.1), (mx, p2.1), p2, b]
        };
    }
    if produit == 1.0 {
        return if horiz1 {
            let x = if n1.0 > 0.0 {
                a.0.max(b.0) + m
            } else {
                a.0.min(b.0) - m
            };
            vec![a, (x, a.1), (x, b.1), b]
        } else {
            let y = if n1.1 > 0.0 {
                a.1.max(b.1) + m
            } else {
                a.1.min(b.1) - m
            };
            vec![a, (a.0, y), (b.0, y), b]
        };
    }
    let coin = if horiz1 { (b.0, a.1) } else { (a.0, b.1) };
    let sortie_ok = (coin.0 - a.0) * n1.0 + (coin.1 - a.1) * n1.1 >= m;
    let entree_ok = (b.0 - coin.0) * -n2.0 + (b.1 - coin.1) * -n2.1 >= m;
    if sortie_ok && entree_ok {
        return vec![a, coin, b];
    }
    let milieu = if horiz1 { (p1.0, p2.1) } else { (p2.0, p1.1) };
    vec![a, p1, milieu, p2, b]
}

/// Tracé complet du lien `lien` à 100 % : la polyligne (droit, coudé), ou la courbe de Bézier échantillonnée en
/// 200 segments (201 points), les coordonnées arrondies à 0,01 comme le dessin. Vide si une boîte manque.
/// `boites` et `liens` sont les objets JSON validés par `jdiag.rs` (valeurs par défaut non écrites).
pub fn trace(boites: &[Value], liens: &[Value], lien: &Value) -> Vec<(f64, f64)> {
    let cherche = |cle: &str| {
        let id = lien.get(cle)?;
        boites
            .iter()
            .find(|b| b.get("id") == Some(id))
            .and_then(boite)
    };
    let (Some(de), Some(vers)) = (cherche("from"), cherche("to")) else {
        return Vec::new();
    };
    let route = lien
        .get("route")
        .and_then(Value::as_str)
        .unwrap_or("direct");
    let cote = |c: &str| {
        lien.get(c)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
    };
    let (from_side, to_side) = (cote("fromSide"), cote("toSide"));
    let sans_cote = matches!(
        (from_side, to_side),
        (Some("center"), Some("center")) | (None, _) | (_, None)
    );
    type Bout = (Point, Option<&'static str>);
    let nom = |s: &str| COTES.iter().copied().find(|c| *c == s).unwrap_or("left");
    let (depart, arrivee): (Bout, Bout) = if sans_cote && route == "direct" {
        let inverse = liens
            .iter()
            .any(|l| l.get("from") == lien.get("to") && l.get("to") == lien.get("from"));
        let (d, a) = extremites_fleche(&de, &vers, if inverse { 4.0 } else { 0.0 });
        ((d, None), (a, None))
    } else if sans_cote {
        let (cd, cv) = cotes_proches(&de, &vers);
        (
            (connecteur(&de, cd), Some(cd)),
            (connecteur(&vers, cv), Some(cv)),
        )
    } else {
        let (fs, ts) = (from_side.unwrap_or("left"), to_side.unwrap_or("left"));
        if fs == "center" || ts == "center" {
            let centre_de = fs == "center";
            let (fixe, boite_c, cote_fixe) = if centre_de {
                (&vers, &de, nom(ts))
            } else {
                (&de, &vers, nom(fs))
            };
            let point_fixe = connecteur(fixe, cote_fixe);
            let bout: Bout = if route == "direct" {
                let (cx, cy) = centre(boite_c);
                (
                    sortie(boite_c, cx, cy, point_fixe.0 - cx, point_fixe.1 - cy),
                    None,
                )
            } else {
                let proche = connecteur_proche(boite_c, point_fixe);
                (connecteur(boite_c, proche), Some(proche))
            };
            let autre: Bout = (point_fixe, Some(cote_fixe));
            if centre_de {
                (bout, autre)
            } else {
                (autre, bout)
            }
        } else {
            (
                (connecteur(&de, nom(fs)), Some(nom(fs))),
                (connecteur(&vers, nom(ts)), Some(nom(ts))),
            )
        }
    };
    let (a, b) = (depart.0, arrivee.0);
    let sens = if b.0 < a.0 { -1.0 } else { 1.0 };
    let n1 = depart.1.map_or((sens, 0.0), normale);
    let n2 = arrivee.1.map_or((-sens, 0.0), normale);
    let rond = |p: Point| (arrondi(p.0), arrondi(p.1));
    if route == "curved" {
        let k = COURBE_MIN.max((b.0 - a.0).hypot(b.1 - a.1) / 2.0);
        let c1 = (a.0 + n1.0 * k, a.1 + n1.1 * k);
        let c2 = (b.0 + n2.0 * k, b.1 + n2.1 * k);
        let (p0, p1, p2, p3) = (rond(a), rond(c1), rond(c2), rond(b));
        return (0..=200)
            .map(|i| {
                let u = i as f64 / 200.0;
                let k = 1.0 - u;
                let (w0, w1, w2, w3) = (k * k * k, 3.0 * k * k * u, 3.0 * k * u * u, u * u * u);
                (
                    w0 * p0.0 + w1 * p1.0 + w2 * p2.0 + w3 * p3.0,
                    w0 * p0.1 + w1 * p1.1 + w2 * p2.1 + w3 * p3.1,
                )
            })
            .collect();
    }
    let points = if route == "orthogonal" {
        simplifier(points_coudes(a, b, n1, n2))
    } else {
        vec![a, b]
    };
    points.into_iter().map(rond).collect()
}

/// Point à mi-longueur d'une polyligne, comme `milieuTrace`.
pub fn milieu(points: &[(f64, f64)]) -> (f64, f64) {
    if points.len() < 2 {
        return points.first().copied().unwrap_or((0.0, 0.0));
    }
    let longueurs: Vec<f64> = points
        .windows(2)
        .map(|w| (w[1].0 - w[0].0).hypot(w[1].1 - w[0].1))
        .collect();
    let mut reste = longueurs.iter().sum::<f64>() / 2.0;
    for (i, l) in longueurs.iter().enumerate() {
        if reste <= *l || i == longueurs.len() - 1 {
            let k = if *l == 0.0 { 0.0 } else { reste / l };
            return (
                points[i].0 + (points[i + 1].0 - points[i].0) * k,
                points[i].1 + (points[i + 1].1 - points[i].1) * k,
            );
        }
        reste -= l;
    }
    points[0]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn proche(a: (f64, f64), b: (f64, f64), nom: &str) {
        assert!(
            (a.0 - b.0).abs() <= 0.01 && (a.1 - b.1).abs() <= 0.01,
            "{nom} : {a:?} au lieu de {b:?}"
        );
    }

    fn paire(v: &Value) -> (f64, f64) {
        (v[0].as_f64().unwrap(), v[1].as_f64().unwrap())
    }

    #[test]
    fn req148_ac2_ac3_cas_communs_avec_le_javascript() {
        let cas: Vec<Value> = serde_json::from_str(include_str!("jdiag_traces.json")).unwrap();
        assert!(cas.len() >= 20);
        for c in &cas {
            let nom = c["nom"].as_str().unwrap();
            let boites = c["boxes"].as_array().unwrap();
            let liens = c["links"].as_array().unwrap();
            let lien = liens.iter().find(|l| l["id"] == c["lien"]).unwrap();
            let t = trace(boites, liens, lien);
            if let Some(attendu) = c.get("points") {
                let attendu = attendu.as_array().unwrap();
                assert_eq!(t.len(), attendu.len(), "{nom}");
                for (p, q) in t.iter().zip(attendu) {
                    proche(*p, paire(q), nom);
                }
            } else {
                let [p0, p1, p2, p3] = c["courbe"].as_array().unwrap().as_slice() else {
                    panic!("{nom} : quatre points attendus");
                };
                let (p0, p1, p2, p3) = (paire(p0), paire(p1), paire(p2), paire(p3));
                assert_eq!(t.len(), 201, "{nom}");
                proche(t[0], p0, nom);
                proche(t[200], p3, nom);
                proche(
                    t[100],
                    (
                        (p0.0 + 3.0 * p1.0 + 3.0 * p2.0 + p3.0) / 8.0,
                        (p0.1 + 3.0 * p1.1 + 3.0 * p2.1 + p3.1) / 8.0,
                    ),
                    nom,
                );
            }
            proche(milieu(&t), paire(&c["milieu"]), nom);
        }
    }

    #[test]
    fn req148_ac2_boite_absente_donne_un_trace_vide() {
        let boites = [json!({"id": "a", "x": 0, "y": 0, "width": 10, "height": 10})];
        let lien = json!({"id": "l", "from": "a", "to": "z"});
        assert!(trace(&boites, std::slice::from_ref(&lien), &lien).is_empty());
    }
}
