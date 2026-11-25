import { lireJdiag } from "../jdiag.js";
import { dessinBoite, dessinFleche, dessinLien, svg } from "./tableau-dessin.js";
import { geometrieLien, trace } from "./tableau-calculs.js";
import { rendreZone } from "./tableau-texte.js";

// Dessin d'un whiteboard en image, pour l'aperçu, le mode hybride et le PDF (REQ-179, DEC-117) : le SVG de l'onglet
// à 100 %, en thème clair, dont les styles calculés sont recopiés en attributs `style` pour qu'il se dessine seul.
const MARGE = 16;
const SVG_NS = "http://www.w3.org/2000/svg";
const PROPRIETES = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "color", "font-family", "font-size", "font-weight", "font-style", "line-height", "text-decoration-line", "text-align"];
const PROPRIETES_HTML = ["display", "flex-direction", "justify-content", "align-items", "box-sizing", "padding", "white-space", "overflow-wrap", "overflow", "border-radius", "background-color", "width", "height"];
const SANS_VALEUR = new Set(["", "auto", "normal"]);

// Points d'un tracé `entier` (chemin SVG) : ceux d'une polyligne, ou la courbe de Bézier échantillonnée.
function pointsDuTrace(entier) {
  const n = entier.match(/-?\d+(?:\.\d+)?/g).map(Number);
  if (!entier.includes("C")) return Array.from({ length: n.length / 2 }, (_, i) => ({ x: n[2 * i], y: n[2 * i + 1] }));
  const points = [];
  for (let i = 0; i <= 100; i++) {
    const u = i / 100;
    const k = 1 - u;
    const c = [k * k * k, 3 * k * k * u, 3 * k * u * u, u * u * u];
    points.push({ x: c[0] * n[0] + c[1] * n[2] + c[2] * n[4] + c[3] * n[6], y: c[0] * n[1] + c[1] * n[3] + c[2] * n[5] + c[3] * n[7] });
  }
  return points;
}

// Rectangle de tous les objets : boîtes, et tous les points du tracé des liens et des flèches libres, pointes comprises.
function cadre(doc) {
  const points = [];
  for (const b of doc.boxes) points.push({ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height });
  const tracer = (t) => points.push(...pointsDuTrace(t.entier), t.debut.point, t.fin.point);
  for (const l of doc.links) tracer(geometrieLien(doc, l, 1));
  for (const f of doc.arrows ?? []) {
    tracer(trace({ route: f.route ?? "direct", depart: { point: { x: f.x1, y: f.y1 }, cote: null }, arrivee: { point: { x: f.x2, y: f.y2 }, cote: null } }));
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - MARGE;
  const y = Math.min(...ys) - MARGE;
  return { x, y, largeur: Math.max(...xs) + MARGE - x, hauteur: Math.max(...ys) + MARGE - y };
}

function recopier(racine) {
  for (const e of [racine, ...racine.querySelectorAll("*")]) {
    const html = e.namespaceURI !== SVG_NS;
    const calcule = getComputedStyle(e);
    const style = [];
    for (const p of html ? [...PROPRIETES.filter((q) => !q.startsWith("fill") && !q.startsWith("stroke")), ...PROPRIETES_HTML] : PROPRIETES) {
      const v = calcule.getPropertyValue(p).trim();
      if (!SANS_VALEUR.has(v) && !(html && (p === "width" || p === "height") && !v.endsWith("px"))) style.push(`${p}:${v}`);
    }
    if (style.length) e.setAttribute("style", style.join(";"));
  }
}

/** Texte d'un fichier `.jdiag` → `{ svg, largeur, hauteur }`, ou `null` s'il ne se lit pas ou n'a aucun objet. */
export function dessinerWhiteboard(texte) {
  const doc = lireJdiag(texte);
  if (!doc || doc.boxes.length + doc.links.length + (doc.arrows ?? []).length === 0) return null;
  const c = cadre(doc);
  const zone = document.createElement("div");
  zone.className = "ya-tableau-zone";
  zone.dataset.theme = "light";
  zone.setAttribute("aria-hidden", "true");
  zone.style.cssText = `position:fixed;left:-100000px;top:0;width:${c.largeur}px;height:${c.hauteur}px;pointer-events:none`;
  const fond = document.createElement("div");
  fond.className = "ya-tableau";
  const surface = document.createElement("div");
  surface.className = "ya-tableau-surface";
  const dessin = svg("svg", { viewBox: `${c.x} ${c.y} ${c.largeur} ${c.hauteur}` });
  surface.append(dessin);
  fond.append(surface);
  zone.append(fond);
  document.body.append(zone);
  try {
    for (const b of doc.boxes) {
      const texteBoite = document.createElement("div");
      texteBoite.className = "ya-tableau-texte";
      rendreZone(texteBoite, b.text, b.spans);
      dessin.append(dessinBoite(b, { id: b.id, nom: "", classe: "", texte: texteBoite, zoom: 1 }));
    }
    for (const l of doc.links) dessin.append(dessinLien(doc, l, 1, { id: l.id, nom: "", classe: "" }));
    for (const f of doc.arrows ?? []) dessin.append(dessinFleche(f, 1, { id: f.id, classe: "" }));
    dessin.querySelectorAll(".surcouche, .prise").forEach((e) => e.remove());
    const page = getComputedStyle(zone).getPropertyValue("--apercu-page").trim() || "white";
    recopier(dessin);
    for (const e of [dessin, ...dessin.querySelectorAll("*")]) {
      e.removeAttribute("id");
      e.removeAttribute("class");
      e.removeAttribute("aria-label");
    }
    dessin.setAttribute("width", String(c.largeur));
    dessin.setAttribute("height", String(c.hauteur));
    const fondPage = svg("rect", { x: c.x, y: c.y, width: c.largeur, height: c.hauteur, fill: page });
    dessin.prepend(fondPage);
    return { svg: new XMLSerializer().serializeToString(dessin), largeur: c.largeur, hauteur: c.hauteur };
  } finally {
    zone.remove();
  }
}
