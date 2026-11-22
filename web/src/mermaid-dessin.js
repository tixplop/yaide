// Dessin de mermaid déjà mesuré → objets du whiteboard (REQ-154, DEC-107). Fonction pure, sans DOM ni dépendance.
//
// Une primitive est en coordonnées du dessin (transformations déjà appliquées), dans l'ordre du dessin :
//   rect { x, y, largeur, hauteur, arrondi }      ellipse { cx, cy, rx, ry }      polygone { points }
//   chemin { d, matrice: [a, b, c, d, e, f] }     ligne { points }                texte { x, y, largeur, hauteur, lignes }
// Chacune porte : fond (couleur CSS ou null), opaciteFond (0 à 1), contour (couleur CSS ou null), tirets (booléen),
// epaisseur (px), debut et fin (pointe au début, à la fin).

const COULEURS_VIVES = { red: 0, orange: 30, yellow: 52, green: 125, blue: 215, purple: 285 };
// Une couleur est « vive » si sa saturation et sa luminosité (modèle HSV, 0 à 1) atteignent ces seuils :
// en dessous, elle est pâle, grise, blanche ou noire (`#ececff`, fond par défaut de mermaid, a 0,07 de saturation).
const SATURATION_MIN = 0.35;
const LUMINOSITE_MIN = 0.4;
const OPACITES = [100, 75, 50, 25, 0];
const MARGE_TEXTE = { largeur: 16, ligne: 18, hauteur: 12 };
const TOLERANCE_CENTRE = 4;
const TOLERANCE_LOSANGE = 2;
const MARGE_GAUCHE = 10;
const DOT_MAX = 16;
const EPAISSEUR_FORTE = 3;
const RIEN = { refus: "il n'a rien à dessiner." };

// Couleur CSS (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`) → `{ r, g, b, a }`, ou `null` si elle n'est pas reconnue.
function lireCouleur(c) {
  if (typeof c !== "string") return null;
  const s = c.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return { r: parseInt(m[1][0], 16) * 17, g: parseInt(m[1][1], 16) * 17, b: parseInt(m[1][2], 16) * 17, a: 1 };
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4), 16), a: 1 };
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  return null;
}

// Nom de la couleur du whiteboard de teinte la plus proche, ou `null` (« Par défaut ») si elle n'est pas vive.
function nomCouleur({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0 || (max - min) / max < SATURATION_MIN || max / 255 < LUMINOSITE_MIN) return null;
  const d = max - min;
  let teinte;
  if (max === r) teinte = 60 * (((g - b) / d + 6) % 6);
  else if (max === g) teinte = 60 * ((b - r) / d + 2);
  else teinte = 60 * ((r - g) / d + 4);
  let meilleur = null;
  let ecart = Infinity;
  for (const [nom, t] of Object.entries(COULEURS_VIVES)) {
    const e = Math.min(Math.abs(teinte - t), 360 - Math.abs(teinte - t));
    if (e < ecart) [meilleur, ecart] = [nom, e];
  }
  return meilleur;
}

// Fond d'une primitive → `{ opacite (parmi 100, 75, 50, 25, 0), couleur }`.
function lireFond(p) {
  const c = p.fond === null || p.fond === undefined ? null : lireCouleur(p.fond);
  if (!c) return { opacite: 0, couleur: null };
  const brut = Math.max(0, Math.min(1, (p.opaciteFond ?? 1) * c.a)) * 100;
  const opacite = OPACITES.reduce((m, o) => (Math.abs(o - brut) < Math.abs(m - brut) ? o : m));
  return { opacite, couleur: nomCouleur(c) };
}

const aContour = (p) => p.contour !== null && p.contour !== undefined && (p.epaisseur ?? 1) > 0 && (lireCouleur(p.contour)?.a ?? 1) > 0;
const aFond = (p) => lireFond(p).opacite > 0;

// ---- Lecture de `d` : sous-chemins en points, courbes et arcs en quatre segments.

function bezier(p0, p1, p2, p3) {
  return [0.25, 0.5, 0.75, 1].map((t) => {
    const u = 1 - t;
    const f = (i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
    return [f(0), f(1)];
  });
}

// Arc SVG (paramètres de fin de segment) → quatre points.
function arc(p0, rx, ry, phi, grand, balayage, p1) {
  if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) return [p1];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const a = (phi * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (grand === balayage ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1) / ry;
  const cyp = (-k * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0[0] + p1[0]) / 2;
  const cy = sin * cxp + cos * cyp + (p0[1] + p1[1]) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t0 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!balayage && dt > 0) dt -= 2 * Math.PI;
  if (balayage && dt < 0) dt += 2 * Math.PI;
  const points = [1, 2, 3].map((i) => {
    const t = t0 + (dt * i) / 4;
    return [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  });
  return [...points, p1];
}

const NOMBRES = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// `d` → liste de sous-chemins `{ points, ferme }`.
function lireChemin(d) {
  const re = /([MLHVCSQTAZmlhvcsqtaz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|[\s,]+/gy;
  const jetons = [];
  let i = 0;
  while (i < d.length) {
    re.lastIndex = i;
    const m = re.exec(d);
    if (!m) break;
    if (m[1]) jetons.push({ cmd: m[1] });
    i = re.lastIndex;
    if (m[2] !== undefined) {
      // Indicateurs d'un arc (0 ou 1) collés au nombre suivant : « a1 1 0 01 5 5 ».
      jetons.push({ n: parseFloat(m[2]), texte: m[2] });
    }
  }
  const sous = [];
  let courant = null;
  let pos = [0, 0];
  let debut = [0, 0];
  let ctrl = null; // dernier point de contrôle (pour S, T) et sa sorte
  let k = 0;
  const lire = () => (k < jetons.length && jetons[k].n !== undefined ? jetons[k++].n : NaN);
  const ouvrir = (p) => {
    courant = { points: [p], ferme: false };
    sous.push(courant);
  };
  let cmd = null;
  while (k < jetons.length) {
    if (jetons[k].cmd) cmd = jetons[k++].cmd;
    else if (cmd === null) break;
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    else if (cmd === "Z" || cmd === "z") break;
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    if (C === "Z") {
      if (courant) courant.ferme = true;
      pos = debut;
      courant = null;
      ctrl = null;
      continue;
    }
    const n = [];
    for (let j = 0; j < NOMBRES[C]; j++) {
      if (C === "A" && (j === 3 || j === 4)) {
        // Un indicateur tient sur un seul caractère.
        const t = jetons[k];
        if (!t || t.n === undefined) return sous;
        if (t.texte.length > 1 && /^[01]/.test(t.texte)) {
          n.push(+t.texte[0]);
          const reste = t.texte.slice(1);
          jetons[k] = { n: parseFloat(reste), texte: reste };
          continue;
        }
      }
      n.push(lire());
    }
    if (n.some(Number.isNaN)) return sous;
    const [ox, oy] = rel ? pos : [0, 0];
    if (C === "M") {
      pos = [n[0] + ox, n[1] + oy];
      debut = pos;
      ouvrir(pos);
      ctrl = null;
      continue;
    }
    if (!courant) ouvrir(pos);
    let fin;
    if (C === "L") fin = [n[0] + ox, n[1] + oy];
    else if (C === "H") fin = [n[0] + ox, pos[1]];
    else if (C === "V") fin = [pos[0], n[0] + oy];
    if (fin) {
      courant.points.push(fin);
      pos = fin;
      ctrl = null;
    } else if (C === "C" || C === "S") {
      const p1 = C === "C" ? [n[0] + ox, n[1] + oy] : ctrl?.sorte === "C" ? [2 * pos[0] - ctrl.p[0], 2 * pos[1] - ctrl.p[1]] : pos;
      const [i2, i3] = C === "C" ? [2, 4] : [0, 2];
      const p2 = [n[i2] + ox, n[i2 + 1] + oy];
      const p3 = [n[i3] + ox, n[i3 + 1] + oy];
      courant.points.push(...bezier(pos, p1, p2, p3));
      ctrl = { sorte: "C", p: p2 };
      pos = p3;
    } else if (C === "Q" || C === "T") {
      const q = C === "Q" ? [n[0] + ox, n[1] + oy] : ctrl?.sorte === "Q" ? [2 * pos[0] - ctrl.p[0], 2 * pos[1] - ctrl.p[1]] : pos;
      const p3 = C === "Q" ? [n[2] + ox, n[3] + oy] : [n[0] + ox, n[1] + oy];
      const p1 = [pos[0] + (2 / 3) * (q[0] - pos[0]), pos[1] + (2 / 3) * (q[1] - pos[1])];
      const p2 = [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])];
      courant.points.push(...bezier(pos, p1, p2, p3));
      ctrl = { sorte: "Q", p: q };
      pos = p3;
    } else if (C === "A") {
      const p3 = [n[5] + ox, n[6] + oy];
      courant.points.push(...arc(pos, n[0], n[1], n[2], n[3] !== 0, n[4] !== 0, p3));
      ctrl = null;
      pos = p3;
    }
  }
  return sous;
}

// ---- Traduction.

const entier = (v) => Math.round(v);

export function versWhiteboard(primitives, origine) {
  const [ox, oy] = origine;
  const X = (x) => x - ox + 40;
  const Y = (y) => y - oy + 40;
  const elements = []; // dans l'ordre du dessin : { boite } ou { texte } ou { fleches }

  const styleTrait = (p, cible) => {
    if (p.tirets) cible.line = "dashed";
    if ((p.epaisseur ?? 1) >= EPAISSEUR_FORTE) cible.weight = "thick";
  };

  // Un trait brisé, en points du dessin déjà transformés → une flèche libre par segment.
  const fleches = (suites, p) => {
    const segments = [];
    for (const { points, ferme } of suites) {
      const pts = ferme && points.length > 1 ? [...points, points[0]] : points;
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1, x2, y2] = [entier(X(pts[i - 1][0])), entier(Y(pts[i - 1][1])), entier(X(pts[i][0])), entier(Y(pts[i][1]))];
        if (x1 !== x2 || y1 !== y2) segments.push({ x1, y1, x2, y2 });
      }
    }
    segments.forEach((s, i) => {
      const debut = p.debut && i === 0;
      const fin = p.fin && i === segments.length - 1;
      const f = { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 };
      const ends = debut && fin ? "both" : debut ? "start" : fin ? "end" : "none";
      if (ends !== "end") f.ends = ends;
      styleTrait(p, f);
      elements.push({ fleche: f });
    });
  };

  const boite = (p, x, y, largeur, hauteur, forme) => {
    const { opacite, couleur } = lireFond(p);
    const b = { x: entier(X(x)), y: entier(Y(y)), width: Math.max(1, entier(largeur)), height: Math.max(1, entier(hauteur)), text: "" };
    if (forme) b.shape = forme;
    if (couleur) b.color = couleur;
    if (opacite !== 100) b.opacity = opacite;
    if (p.tirets) b.line = "dashed";
    elements.push({ boite: b, libre: forme !== "dot" && forme !== "text" });
  };

  for (const p of primitives) {
    if (p.type === "texte") {
      const lignes = (p.lignes ?? []).map((l) => l.replace(/\s+$/, ""));
      if (lignes.every((l) => l.trim() === "")) continue;
      elements.push({ texte: { cx: p.x + p.largeur / 2, cy: p.y + p.hauteur / 2, largeur: p.largeur, lignes } });
      continue;
    }
    if (!aContour(p) && !aFond(p)) continue;
    if (p.type === "rect") {
      boite(p, p.x, p.y, p.largeur, p.hauteur, p.arrondi > 0 ? "rounded" : null);
    } else if (p.type === "ellipse") {
      const [l, h] = [2 * p.rx, 2 * p.ry];
      const dot = Math.round(l) <= DOT_MAX && Math.round(h) <= DOT_MAX;
      boite(p, p.cx - p.rx, p.cy - p.ry, l, h, dot ? "dot" : "ellipse");
    } else if (p.type === "polygone") {
      const pts = p.points;
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const milieux = [[(x0 + x1) / 2, y0], [x1, (y0 + y1) / 2], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2]];
      const losange =
        pts.length === 4 &&
        milieux.every((m) => pts.some((q) => Math.abs(q[0] - m[0]) <= TOLERANCE_LOSANGE && Math.abs(q[1] - m[1]) <= TOLERANCE_LOSANGE));
      if (losange) boite(p, x0, y0, x1 - x0, y1 - y0, "diamond");
      else fleches([{ points: pts, ferme: true }], p);
    } else if (p.type === "ligne") {
      fleches([{ points: p.points, ferme: false }], p);
    } else if (p.type === "chemin") {
      const [a, b, c, d, e, f] = p.matrice;
      const suites = lireChemin(p.d).map((s) => ({ ferme: s.ferme, points: s.points.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]) }));
      fleches(suites, p);
    }
  }

  // Un texte prend la boîte sans texte dont le centre est le sien ; sinon, la boîte sans texte qui n'en contient aucune
  // autre, à sa hauteur, dont le bord gauche est à moins de MARGE_GAUCHE de lui (texte aligné à gauche dans son nœud) ;
  // sinon il a sa boîte `text`.
  const libres_ = elements.filter((e) => e.boite && e.libre);
  const contient = (h, o) =>
    o !== h && o.boite.x >= h.boite.x && o.boite.y >= h.boite.y && o.boite.x + o.boite.width <= h.boite.x + h.boite.width && o.boite.y + o.boite.height <= h.boite.y + h.boite.height;
  for (const e of elements) {
    if (!e.texte) continue;
    const { cx, cy, largeur, lignes } = e.texte;
    const vides = libres_.filter((h) => h.boite.text === "" && Math.abs(h.boite.y + h.boite.height / 2 - Y(cy)) <= TOLERANCE_CENTRE);
    const hote =
      vides.find((h) => Math.abs(h.boite.x + h.boite.width / 2 - X(cx)) <= TOLERANCE_CENTRE) ??
      vides.find((h) => {
        const gauche = X(cx) - largeur / 2 - h.boite.x;
        return gauche >= -1 && gauche <= MARGE_GAUCHE && h.boite.x + h.boite.width >= X(cx) + largeur / 2 && !elements.some((o) => o.boite && contient(h, o));
      });
    if (hote) {
      hote.boite.text = lignes.join("\n");
      continue;
    }
    const w = entier(largeur + MARGE_TEXTE.largeur);
    const h = entier(lignes.length * MARGE_TEXTE.ligne + MARGE_TEXTE.hauteur);
    e.boite = { x: entier(X(cx) - w / 2), y: entier(Y(cy) - h / 2), width: w, height: h, text: lignes.join("\n"), shape: "text" };
  }

  const boxes = [];
  const arrows = [];
  for (const e of elements) {
    if (e.boite) boxes.push({ id: `b${boxes.length + 1}`, ...e.boite });
    else if (e.fleche) arrows.push({ id: `a${arrows.length + 1}`, ...e.fleche });
  }
  if (boxes.length === 0 && arrows.length === 0) return RIEN;
  return { boxes, arrows };
}
