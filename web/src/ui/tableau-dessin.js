import { geometrieLien, pointe, trace, zoneTexte } from "./tableau-calculs.js";

// C-018 : le SVG d'une boîte, d'un lien, d'une flèche libre et des poignées. Fonctions sans état : le choix,
// la saisie et les gestes restent dans `tableau.js`, qui passe ici ce qu'il faut pour dessiner.
const SVG = "http://www.w3.org/2000/svg";

export function svg(nom, attrs, parent) {
  const e = document.createElementNS(SVG, nom);
  for (const [k, v] of Object.entries(attrs ?? {})) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}

// Contour d'une forme, sans le pli de la note.
function contour(b) {
  const { x, y, width: w, height: h } = b;
  const forme = b.shape ?? "rectangle";
  if (forme === "ellipse") return svg("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 });
  if (forme === "diamond") return svg("path", { d: `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z` });
  if (forme === "note") {
    const c = Math.min(16, Math.min(w, h) / 3);
    return svg("path", { d: `M ${x} ${y} H ${x + w - c} L ${x + w} ${y + c} V ${y + h} H ${x} Z` });
  }
  const rx = forme === "rounded" ? Math.min(16, Math.min(w, h) / 2) : 4;
  return svg("rect", { x, y, width: w, height: h, rx });
}

// `texte` : le nœud du texte (affiché ou en saisie), posé sur la zone inscrite de la forme.
export function dessinBoite(b, { id, nom, classe, texte }) {
  const forme = b.shape ?? "rectangle";
  const g = svg("g", { id, "data-id": b.id, role: "group", "aria-roledescription": "boîte", "aria-label": nom });
  g.setAttribute("class", `boite forme-${forme} couleur-${b.color ?? "default"}${classe}`);
  const principale = contour(b);
  principale.setAttribute("class", "forme");
  g.append(principale);
  if (forme === "note") {
    const c = Math.min(16, Math.min(b.width, b.height) / 3);
    svg("path", { class: "pli", d: `M ${b.x + b.width - c} ${b.y} V ${b.y + c} H ${b.x + b.width}` }, g);
  }
  const sur = contour(b);
  sur.setAttribute("class", "surcouche");
  g.append(sur);
  const zone = zoneTexte(b);
  svg("foreignObject", { x: zone.x, y: zone.y, width: zone.width, height: zone.height }, g).append(texte);
  return g;
}

const TIRETS = { dashed: "6 4", dotted: "0 4" };

// Le tracé `geo` (de `trace` ou `geometrieLien`) : zone de prise, trait, pointes selon `ends`, trait selon `line`.
function traitEtPointes(g, geo, style, avecPrise) {
  const ends = style.ends ?? "end";
  const line = style.line ?? "solid";
  if (avecPrise) svg("path", { class: "prise", d: geo.d }, g);
  const trait = svg("path", { class: "trait", d: geo.d }, g);
  if (TIRETS[line]) trait.setAttribute("stroke-dasharray", TIRETS[line]);
  if (line === "dotted") trait.setAttribute("stroke-linecap", "round");
  g.classList.add(`ligne-${line}`);
  const pointes = [];
  if (ends === "start" || ends === "both") pointes.push(geo.pointeDebut);
  if (ends === "end" || ends === "both") pointes.push(geo.pointeFin);
  for (const p of pointes) svg("polygon", { class: "pointe", points: p.map((q) => `${q.x},${q.y}`).join(" ") }, g);
}

function geometrie(depart, arrivee, route, zoom) {
  const t = trace({ route: route ?? "direct", depart: { point: depart, cote: null }, arrivee: { point: arrivee, cote: null } });
  return { ...t, pointeDebut: pointe(t.debut, zoom), pointeFin: pointe(t.fin, zoom) };
}

export function dessinLien(doc, lien, zoom, { id, nom, classe }) {
  const g = svg("g", { id, "data-id": lien.id, role: "group", "aria-roledescription": "lien", "aria-label": nom });
  g.setAttribute("class", `lien${classe}`);
  traitEtPointes(g, geometrieLien(doc, lien, zoom), lien, true);
  return g;
}

export function dessinFleche(f, zoom, { id, classe }) {
  const g = svg("g", { id, "data-id": f.id, role: "group", "aria-roledescription": "flèche", "aria-label": "Flèche libre" });
  g.setAttribute("class", `fleche${classe}`);
  traitEtPointes(g, geometrie({ x: f.x1, y: f.y1 }, { x: f.x2, y: f.y2 }, f.route, zoom), f, true);
  return g;
}

// Trait provisoire d'un lien ou d'une flèche en cours de tracé : du point `depart` au point `arrivee`.
export function dessinProvisoire(depart, arrivee, zoom, style = {}) {
  const g = svg("g", { class: "fleche provisoire", "aria-hidden": "true" });
  traitEtPointes(g, geometrie(depart, arrivee, style.route, zoom), style, false);
  return g;
}

// Poignées de la boîte choisie : la taille, et la liaison jusqu'aux connecteurs (T-300).
export function poigneesBoite(b, z) {
  const g = svg("g", { class: "poignees", "aria-hidden": "true" });
  const cx = b.x + b.width;
  const cy = b.y + b.height;
  svg("rect", { class: "prise", "data-poignee": "taille", x: cx - 8 / z, y: cy - 8 / z, width: 16 / z, height: 16 / z }, g);
  svg("rect", { class: "carre", x: cx - 4 / z, y: cy - 4 / z, width: 8 / z, height: 8 / z }, g);
  const my = b.y + b.height / 2;
  svg("line", { class: "queue", x1: cx, y1: my, x2: cx + 18 / z, y2: my }, g);
  svg("rect", { class: "prise", "data-poignee": "liaison", x: cx + 8 / z, y: my - 10 / z, width: 20 / z, height: 20 / z }, g);
  svg("circle", { class: "rond", cx: cx + 18 / z, cy: my, r: 4 / z }, g);
  return g;
}

// Poignées de la flèche libre choisie : un rond de 9 px à chaque bout.
export function poigneesFleche(f, z) {
  const g = svg("g", { class: "poignees", "aria-hidden": "true" });
  for (const [nom, x, y] of [["depart", f.x1, f.y1], ["arrivee", f.x2, f.y2]]) {
    svg("rect", { class: "prise", "data-poignee": nom, x: x - 8 / z, y: y - 8 / z, width: 16 / z, height: 16 / z }, g);
    svg("circle", { class: "bout", cx: x, cy: y, r: 4.5 / z }, g);
  }
  return g;
}
