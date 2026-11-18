import { connecteursAffiches, epaisseur, geometrieLien, pointe, retraitPointes, tirets, trace, zoneTexte } from "./tableau-calculs.js";

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
  const weight = b.weight ?? "thin";
  const line = b.line ?? "solid";
  // La forme « Texte » n'a ni contour ni fond : ni épaisseur ni trait.
  const classes = [`boite forme-${forme} couleur-${b.color ?? "default"}${forme === "text" ? "" : ` epaisseur-${weight} ligne-${line}`}`];
  if (b.textSize) classes.push(`taille-${b.textSize}`);
  if (b.opacity === 0) classes.push("opacite-0");
  g.setAttribute("class", classes.join(" ") + classe);
  const principale = contour(b);
  principale.setAttribute("class", "forme");
  if (b.opacity !== undefined && forme !== "text") principale.setAttribute("fill-opacity", String(b.opacity / 100));
  g.append(principale);
  let pli = null;
  if (forme === "note") {
    const c = Math.min(16, Math.min(b.width, b.height) / 3);
    pli = svg("path", { class: "pli", d: `M ${b.x + b.width - c} ${b.y} V ${b.y + c} H ${b.x + b.width}` }, g);
  }
  const pas = tirets(line, epaisseur("boite", weight));
  for (const e of [principale, pli]) {
    if (!e || !pas || forme === "text") continue;
    e.setAttribute("stroke-dasharray", pas);
    if (line === "dotted") e.setAttribute("stroke-linecap", "round");
  }
  const sur = contour(b);
  sur.setAttribute("class", "surcouche");
  g.append(sur);
  const zone = zoneTexte(b);
  svg("foreignObject", { x: zone.x, y: zone.y, width: zone.width, height: zone.height }, g).append(texte);
  return g;
}

// Le tracé `geo` (de `trace` ou `geometrieLien`) : zone de prise, trait, pointes selon `ends`, trait selon `line`,
// épaisseur et couleur par les classes `epaisseur-*` et `couleur-*`.
function traitEtPointes(g, geo, style, avecPrise) {
  const ends = style.ends ?? "end";
  const line = style.line ?? "solid";
  const weight = style.weight ?? "thin";
  if (avecPrise) svg("path", { class: "prise", d: geo.entier }, g);
  const trait = svg("path", { class: "trait", d: geo.d }, g);
  const pas = tirets(line, epaisseur("trait", weight));
  if (pas) trait.setAttribute("stroke-dasharray", pas);
  if (line === "dotted") trait.setAttribute("stroke-linecap", "round");
  g.classList.add(`ligne-${line}`, `epaisseur-${weight}`);
  if (style.color && style.color !== "default") g.classList.add(`couleur-${style.color}`);
  const pointes = [];
  if (ends === "start" || ends === "both") pointes.push(geo.pointeDebut);
  if (ends === "end" || ends === "both") pointes.push(geo.pointeFin);
  for (const p of pointes) svg("polygon", { class: "pointe", points: p.map((q) => `${q.x},${q.y}`).join(" ") }, g);
}

function geometrie(depart, arrivee, style, zoom) {
  const t = trace({
    route: style.route ?? "direct",
    depart: { point: depart, cote: null },
    arrivee: { point: arrivee, cote: null },
    retrait: retraitPointes(style.ends, style.weight, zoom),
  });
  return { ...t, pointeDebut: pointe(t.debut, zoom, style.weight), pointeFin: pointe(t.fin, zoom, style.weight) };
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
  traitEtPointes(g, geometrie({ x: f.x1, y: f.y1 }, { x: f.x2, y: f.y2 }, f, zoom), f, true);
  return g;
}

// Trait provisoire d'un lien ou d'une flèche en cours de tracé : du point `depart` au point `arrivee`.
export function dessinProvisoire(depart, arrivee, zoom, style = {}) {
  const g = svg("g", { class: "fleche provisoire", "aria-hidden": "true" });
  traitEtPointes(g, geometrie(depart, arrivee, style, zoom), style, false);
  return g;
}

// Forme en cours de tracé : son contour seul, du point d'appui au pointeur.
export function dessinFormeProvisoire(b) {
  const g = svg("g", { class: "provisoire forme-provisoire", "aria-hidden": "true" });
  const c = contour(b);
  c.setAttribute("class", "forme");
  g.append(c);
  return g;
}

// Rectangle de sélection en cours de tracé : son contour seul, sans fond.
export function dessinRectangleSelection(r) {
  const g = svg("g", { class: "provisoire", "aria-hidden": "true" });
  svg("rect", { class: "forme", x: r.x, y: r.y, width: r.width, height: r.height }, g);
  return g;
}

// Poignée de taille de la boîte choisie, au coin bas droit.
export function poigneesBoite(b, z) {
  const g = svg("g", { class: "poignees", "aria-hidden": "true" });
  const cx = b.x + b.width;
  const cy = b.y + b.height;
  svg("rect", { class: "prise", "data-poignee": "taille", x: cx - 8 / z, y: cy - 8 / z, width: 16 / z, height: 16 / z }, g);
  svg("rect", { class: "carre", x: cx - 4 / z, y: cy - 4 / z, width: 8 / z, height: 8 / z }, g);
  return g;
}

// Connecteurs : un rond de 8 px (10 px, plein, pour les `pleins`) au milieu de chaque côté et au centre (si la boîte est assez grande), et sa zone de prise de 16 px.
// `pleins` : liste de `{ id, cote }`.
export function dessinConnecteurs(boites, pleins, z) {
  const g = svg("g", { class: "connecteurs", "aria-hidden": "true" });
  for (const b of boites) {
    for (const [cote, p] of Object.entries(connecteursAffiches(b, z))) {
      const plein = pleins.some((q) => q.id === b.id && q.cote === cote);
      svg("rect", { class: "prise", "data-connecteur": cote, "data-boite": b.id, x: p.x - 8 / z, y: p.y - 8 / z, width: 16 / z, height: 16 / z }, g);
      svg("circle", { class: plein ? "connecteur plein" : "connecteur", cx: p.x, cy: p.y, r: (plein ? 5 : 4) / z }, g);
    }
  }
  return g;
}

// Un rond de 9 px (et sa zone de prise de 16 px) à chaque bout : `depart` et `arrivee` sont des points du dessin.
function poigneesBouts(depart, arrivee, z) {
  const g = svg("g", { class: "poignees", "aria-hidden": "true" });
  for (const [nom, { x, y }] of [["depart", depart], ["arrivee", arrivee]]) {
    svg("rect", { class: "prise", "data-poignee": nom, x: x - 8 / z, y: y - 8 / z, width: 16 / z, height: 16 / z }, g);
    svg("circle", { class: "bout", cx: x, cy: y, r: 4.5 / z }, g);
  }
  return g;
}

// Poignées de la flèche libre choisie.
export function poigneesFleche(f, z) {
  return poigneesBouts({ x: f.x1, y: f.y1 }, { x: f.x2, y: f.y2 }, z);
}

// Poignées du lien choisi seul : au départ sur le bord de la forme, à l'arrivée au bout de la pointe ou du trait.
export function poigneesLien(doc, lien, z) {
  const geo = geometrieLien(doc, lien, z);
  return poigneesBouts(geo.debut.point, geo.fin.point, z);
}
