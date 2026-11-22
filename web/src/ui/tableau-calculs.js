// Calculs du whiteboard (C-018), sans DOM. Une vue est `{ x, y, zoom }` : (x, y) est le point du dessin
// en haut à gauche de la surface, `zoom` un rapport (1 = 100 %). Une taille est `{ largeur, hauteur }` en px écran.
import { FORMES_PLEINES, SYMBOLES } from "../jdiag.js";

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const CRANS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const MARGE_TOUT = 32;
const MARGE_OBJET = 24;

// Point où le rayon issu de (ox, oy), dans la direction (dx, dy), quitte `boite` (déplacée pour être centrée
// sur (ox, oy)). La forme (`ellipse`, `diamond`) donne son vrai bord ; toute autre : le rectangle.
function sortie(boite, ox, oy, dx, dy) {
  if (dx === 0 && dy === 0) return { x: ox, y: oy };
  let t;
  if (boite.shape === "ellipse" || boite.shape === "dot") {
    t = 1 / Math.hypot(dx / (boite.width / 2), dy / (boite.height / 2));
  } else if (boite.shape === "diamond") {
    t = 1 / (Math.abs(dx) / (boite.width / 2) + Math.abs(dy) / (boite.height / 2));
  } else {
    t = Math.min(
      dx === 0 ? Infinity : boite.width / 2 / Math.abs(dx),
      dy === 0 ? Infinity : boite.height / 2 / Math.abs(dy),
    );
  }
  return { x: ox + dx * t, y: oy + dy * t };
}

// Point où la droite qui part du centre de `boite` vers (cx, cy) coupe le bord de `boite`.
export function pointSortie(boite, cx, cy) {
  const mx = boite.x + boite.width / 2;
  const my = boite.y + boite.height / 2;
  return sortie(boite, mx, my, cx - mx, cy - my);
}

// Départ et arrivée d'une flèche de `de` vers `vers`, sur le bord des boîtes. `decalage` (même unité que
// le dessin) écarte le trait sur sa droite, pour deux flèches de sens contraires.
export function extremitesFleche(de, vers, decalage = 0) {
  const ax = de.x + de.width / 2;
  const ay = de.y + de.height / 2;
  const dx = vers.x + vers.width / 2 - ax;
  const dy = vers.y + vers.height / 2 - ay;
  const longueur = Math.hypot(dx, dy) || 1;
  const ox = (-dy / longueur) * decalage;
  const oy = (dx / longueur) * decalage;
  return {
    depart: sortie(de, ax + ox, ay + oy, dx, dy),
    arrivee: sortie(vers, ax + dx + ox, ay + dy + oy, -dx, -dy),
  };
}

function borner(zoom) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

// Cran suivant (`sens` = 1) ou précédent (`sens` = -1) ; inchangé aux bornes.
export function cranVoisin(zoom, sens) {
  const e = 1e-9;
  if (sens > 0) return CRANS.find((c) => c > zoom + e) ?? zoom;
  return [...CRANS].reverse().find((c) => c < zoom - e) ?? zoom;
}

// Nouveau zoom (borné) en gardant sous (px, py), point de la surface en px écran, le même point du dessin.
export function zoomerAutour(vue, zoom, px, py) {
  const z = borner(zoom);
  const dx = vue.x + px / vue.zoom;
  const dy = vue.y + py / vue.zoom;
  return { x: dx - px / z, y: dy - py / z, zoom: z };
}

// Vue qui montre toutes les boîtes, à 32 px du bord, centrées, de 25 à 100 %.
export function toutAfficher(boites, taille) {
  if (boites.length === 0) return { x: 0, y: 0, zoom: 1 };
  const x0 = Math.min(...boites.map((b) => b.x));
  const y0 = Math.min(...boites.map((b) => b.y));
  const x1 = Math.max(...boites.map((b) => b.x + b.width));
  const y1 = Math.max(...boites.map((b) => b.y + b.height));
  const zoom = Math.max(
    ZOOM_MIN,
    Math.min(1, (taille.largeur - 2 * MARGE_TOUT) / (x1 - x0), (taille.hauteur - 2 * MARGE_TOUT) / (y1 - y0)),
  );
  return {
    x: (x0 + x1) / 2 - taille.largeur / 2 / zoom,
    y: (y0 + y1) / 2 - taille.hauteur / 2 / zoom,
    zoom,
  };
}

function ramener(debut, fin, v0, longueur, marge) {
  let v = v0;
  if (fin > v + longueur - marge) v = fin - longueur + marge;
  if (debut < v + marge) v = debut - marge;
  return v;
}

// Vue déplacée juste assez pour montrer `objet` (`{ x, y, width, height }`) à 24 px du bord ; zoom inchangé.
export function voirObjet(vue, taille, objet) {
  const m = MARGE_OBJET / vue.zoom;
  return {
    ...vue,
    x: ramener(objet.x, objet.x + objet.width, vue.x, taille.largeur / vue.zoom, m),
    y: ramener(objet.y, objet.y + objet.height, vue.y, taille.hauteur / vue.zoom, m),
  };
}

// REQ-161 : vue qui centre `objet` dans la zone, sauf s'il y est déjà entier : à l'écran, hors des `haut` px du haut
// (panneau de recherche) et hors de `outils` ({ x, y, width, height } en px écran, ou null). Zoom inchangé.
export function centrerObjet(vue, taille, objet, { haut = 0, outils = null } = {}) {
  const z = vue.zoom;
  const g = (objet.x - vue.x) * z;
  const h = (objet.y - vue.y) * z;
  const d = g + objet.width * z;
  const b = h + objet.height * z;
  const entier = g >= 0 && h >= haut && d <= taille.largeur && b <= taille.hauteur;
  const croise = outils && g < outils.x + outils.width && d > outils.x && h < outils.y + outils.height && b > outils.y;
  if (entier && !croise) return vue;
  return {
    ...vue,
    x: objet.x + objet.width / 2 - taille.largeur / 2 / z,
    y: objet.y + objet.height / 2 - taille.hauteur / 2 / z,
  };
}

// ---- Formes, connecteurs et tracés (REQ-130, REQ-134, REQ-135, REQ-136) ----

const COTES = ["top", "right", "bottom", "left"];
const NORMALES = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const SORTIE_MIN = 16; // px du dessin : segment perpendiculaire minimal à la sortie et à l'entrée
const COURBE_MIN = 40; // px du dessin : longueur minimale des points de contrôle d'une courbe
// Pointes à l'écran selon l'épaisseur (`weight`) : [longueur, largeur] en px.
const POINTES = { thin: [10, 8], medium: [14, 11], thick: [18, 14] };
// Épaisseur dessinée e, en px à l'écran, d'une boîte et d'un lien ou d'une flèche libre.
const EPAISSEURS = { boite: { thin: 1, medium: 2, thick: 4 }, trait: { thin: 1.5, medium: 3, thick: 5 } };

export function epaisseur(sorte, weight) {
  return EPAISSEURS[sorte][weight ?? "thin"];
}

// `stroke-dasharray` d'un contour ou d'un trait d'épaisseur e (px écran) : tirets de max(6, 3e) pour max(4, 2e),
// ou points ronds de max(2, e) tous les 2 × max(2, e) (`0 <pas>`) ; `null` en trait plein.
export function tirets(line, e) {
  if (line === "dashed") return `${Math.max(6, 3 * e)} ${Math.max(4, 2 * e)}`;
  if (line === "dotted") return `0 ${2 * Math.max(2, e)}`;
  return null;
}

// Longueur à ôter du trait, à chaque bout qui porte une pointe, en px du dessin.
export function retraitPointes(ends, weight, zoom) {
  const l = POINTES[weight ?? "thin"][0] / zoom;
  const e = ends ?? "end";
  return { debut: e === "start" || e === "both" ? l : 0, fin: e === "end" || e === "both" ? l : 0 };
}

export const estSymbole = (boite) => SYMBOLES.some((s) => s.shape === boite.shape);
// « Point » et « Barre » : formes pleines, sans texte (REQ-156).
export const estFormePleine = (boite) => FORMES_PLEINES.some((s) => s.shape === boite.shape);

// Rectangle où le texte d'une boîte reste dans sa forme.
export function zoneTexte(boite) {
  // Symbole : la bande des deux cinquièmes du bas, marges de 8 px sur les côtés, aucune en hauteur.
  if (estSymbole(boite)) return { x: boite.x + 8, y: boite.y + boite.height * 0.6, width: boite.width - 16, height: boite.height * 0.4 };
  let r = 0;
  if (boite.shape === "ellipse") r = (1 - Math.SQRT1_2) / 2;
  else if (boite.shape === "diamond") r = 0.25;
  const rx = boite.width * r;
  const ry = boite.height * r;
  return { x: boite.x + rx, y: boite.y + ry, width: boite.width - 2 * rx, height: boite.height - 2 * ry };
}

// Milieux des quatre côtés d'une boîte.
export function connecteurs(boite) {
  const mx = boite.x + boite.width / 2;
  const my = boite.y + boite.height / 2;
  return {
    top: { x: mx, y: boite.y },
    right: { x: boite.x + boite.width, y: my },
    bottom: { x: mx, y: boite.y + boite.height },
    left: { x: boite.x, y: my },
  };
}

// Écart, en px écran, du rond d'un connecteur de « Point » ou « Barre » au milieu de son côté (REQ-156).
const ECART_ROND = 6;
// Écart de l'anneau du choix au contour d'une forme pleine : demi-trait, 3 px de surface et la moitié des 2 px de l'anneau.
export const decalageAnneau = (boite, zoom) => (epaisseur("boite", boite.weight) / 2 + 4) / zoom;

// Les ronds des connecteurs d'une boîte au zoom courant : les quatre côtés, plus `center` si la boîte fait au moins 64 px de large
// ou de haut à l'écran. « Point » et « Barre » : quatre ronds posés à 6 px hors du milieu de leur côté, jamais le centre ;
// le lien, lui, s'attache toujours au milieu du côté (`connecteurs`). Seule fonction qui décide de cette liste
// (affichage, cible, lâcher, poignées de bout).
export function connecteursAffiches(boite, zoom) {
  const c = connecteurs(boite);
  if (estFormePleine(boite)) {
    const e = ECART_ROND / zoom;
    for (const cote of COTES) c[cote] = { x: c[cote].x + NORMALES[cote].x * e, y: c[cote].y + NORMALES[cote].y * e };
    return c;
  }
  if (boite.width * zoom >= 64 || boite.height * zoom >= 64) c.center = { x: boite.x + boite.width / 2, y: boite.y + boite.height / 2 };
  return c;
}

// Connecteur affiché (`connecteursAffiches`) le plus proche de `point`.
export function connecteurProcheAffiche(boite, point, zoom) {
  const c = connecteursAffiches(boite, zoom);
  const dist = (k) => Math.hypot(c[k].x - point.x, c[k].y - point.y);
  return Object.keys(c).reduce((meilleur, k) => (dist(k) < dist(meilleur) ? k : meilleur));
}

// Côté dont le connecteur est le plus proche de `point`.
export function connecteurProche(boite, point) {
  const c = connecteurs(boite);
  return COTES.reduce((meilleur, cote) =>
    Math.hypot(c[cote].x - point.x, c[cote].y - point.y) < Math.hypot(c[meilleur].x - point.x, c[meilleur].y - point.y)
      ? cote
      : meilleur,
  );
}

// Point où la droite du centre de `boite` vers `vers` coupe le bord de sa forme.
export function pointSurBord(boite, vers) {
  return pointSortie(boite, vers.x, vers.y);
}

// Les deux côtés (`de` pour `a`, `vers` pour `b`) dont les milieux sont les plus proches.
export function cotesProches(a, b) {
  const ca = connecteurs(a);
  const cb = connecteurs(b);
  let meilleur = null;
  for (const de of COTES) {
    for (const vers of COTES) {
      const dist = Math.hypot(ca[de].x - cb[vers].x, ca[de].y - cb[vers].y);
      if (meilleur === null || dist < meilleur.dist) meilleur = { de, vers, dist };
    }
  }
  return { de: meilleur.de, vers: meilleur.vers };
}

const arrondi = (n) => Number(n.toFixed(2));

// Retire les points confondus et ceux qui sont au milieu d'un segment droit sans demi-tour.
function simplifier(points) {
  const sans = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  return sans.filter((p, i) => {
    if (i === 0 || i === sans.length - 1) return true;
    const a = sans[i - 1];
    const b = sans[i + 1];
    const aligne = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) === 0;
    // Un point aligné reste s'il y a demi-tour : c'est la sortie ou l'entrée de 16 px.
    return !(aligne && (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y) > 0);
  });
}

// Points d'un tracé coudé. `n1` et `n2` : normales sortantes des deux côtés.
function pointsCoudes(a, b, n1, n2) {
  const m = SORTIE_MIN;
  const horiz1 = n1.x !== 0;
  const produit = n1.x * n2.x + n1.y * n2.y;
  const ecart = (b.x - a.x) * n1.x + (b.y - a.y) * n1.y;
  if (produit === -1) {
    // Côtés qui se font face.
    if (ecart >= 2 * m) {
      return horiz1
        ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b]
        : [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b];
    }
    const p1 = { x: a.x + n1.x * m, y: a.y + n1.y * m };
    const p2 = { x: b.x + n2.x * m, y: b.y + n2.y * m };
    return horiz1
      ? [a, p1, { x: p1.x, y: (a.y + b.y) / 2 }, { x: p2.x, y: (a.y + b.y) / 2 }, p2, b]
      : [a, p1, { x: (a.x + b.x) / 2, y: p1.y }, { x: (a.x + b.x) / 2, y: p2.y }, p2, b];
  }
  if (produit === 1) {
    // Même direction : on dépasse le plus loin des deux, puis on revient.
    if (horiz1) {
      const x = n1.x > 0 ? Math.max(a.x, b.x) + m : Math.min(a.x, b.x) - m;
      return [a, { x, y: a.y }, { x, y: b.y }, b];
    }
    const y = n1.y > 0 ? Math.max(a.y, b.y) + m : Math.min(a.y, b.y) - m;
    return [a, { x: a.x, y }, { x: b.x, y }, b];
  }
  // Côtés perpendiculaires : un seul coude si les deux segments ont la longueur voulue.
  const coin = horiz1 ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  const sortieOk = (coin.x - a.x) * n1.x + (coin.y - a.y) * n1.y >= m;
  const entreeOk = (b.x - coin.x) * -n2.x + (b.y - coin.y) * -n2.y >= m;
  if (sortieOk && entreeOk) return [a, coin, b];
  const p1 = { x: a.x + n1.x * m, y: a.y + n1.y * m };
  const p2 = { x: b.x + n2.x * m, y: b.y + n2.y * m };
  return [a, p1, horiz1 ? { x: p1.x, y: p2.y } : { x: p2.x, y: p1.y }, p2, b];
}

// Tracé entre deux bouts `{ point, cote }` (`cote` à `null` : bout libre, horizontal). Renvoie le chemin SVG `d`
// et, à chaque bout, son point et l'angle (radians) de la pointe : la direction qui sort du tracé en ce bout.
// Longueurs en px du dessin, quel que soit le zoom.
// `retrait` : longueur ôtée du trait à chaque bout (le trait s'arrête à la base de la pointe) ; `entier` est
// le tracé complet, pour la zone de prise.
export function trace({ route, depart, arrivee, retrait }) {
  const r = { debut: 0, fin: 0, ...retrait };
  const a = depart.point;
  const b = arrivee.point;
  const sens = b.x < a.x ? -1 : 1;
  const n1 = depart.cote ? NORMALES[depart.cote] : { x: sens, y: 0 };
  const n2 = arrivee.cote ? NORMALES[arrivee.cote] : { x: -sens, y: 0 };
  const pt = (p) => `${arrondi(p.x)} ${arrondi(p.y)}`;
  if (route === "curved") {
    const k = Math.max(COURBE_MIN, Math.hypot(b.x - a.x, b.y - a.y) / 2);
    const c1 = { x: a.x + n1.x * k, y: a.y + n1.y * k };
    const c2 = { x: b.x + n2.x * k, y: b.y + n2.y * k };
    const debut = { point: a, angle: Math.atan2(a.y - c1.y, a.x - c1.x) };
    const fin = { point: b, angle: Math.atan2(b.y - c2.y, b.x - c2.x) };
    const recule = (bout, l) => ({ x: bout.point.x - Math.cos(bout.angle) * l, y: bout.point.y - Math.sin(bout.angle) * l });
    const courbe = (p, q) => `M ${pt(p)} C ${pt(c1)}, ${pt(c2)}, ${pt(q)}`;
    return { d: courbe(recule(debut, r.debut), recule(fin, r.fin)), entier: courbe(a, b), debut, fin };
  }
  const points = route === "orthogonal" ? simplifier(pointsCoudes(a, b, n1, n2)) : [a, b];
  const n = points.length;
  const premier = points[0];
  const dernier = points[n - 1];
  const ligne = (ps) => `M ${pt(ps[0])}${ps.slice(1).map((p) => ` L ${pt(p)}`).join("")}`;
  return {
    d: ligne(rogner(rogner(points, r.fin).reverse(), r.debut).reverse()),
    entier: ligne(points),
    debut: { point: a, angle: Math.atan2(premier.y - points[1].y, premier.x - points[1].x) },
    fin: { point: b, angle: Math.atan2(dernier.y - points[n - 2].y, dernier.x - points[n - 2].x) },
  };
}

// Retire `longueur` (px du dessin) à la fin d'un tracé de points, sans jamais le réduire à moins de deux points.
function rogner(points, longueur) {
  const p = [...points];
  let reste = longueur;
  while (p.length > 2 && Math.hypot(p.at(-1).x - p.at(-2).x, p.at(-1).y - p.at(-2).y) <= reste) {
    reste -= Math.hypot(p.at(-1).x - p.at(-2).x, p.at(-1).y - p.at(-2).y);
    p.pop();
  }
  const a = p.at(-2);
  const b = p.at(-1);
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l === 0) return p;
  const k = Math.min(reste, l) / l;
  p[p.length - 1] = { x: b.x - (b.x - a.x) * k, y: b.y - (b.y - a.y) * k };
  return p;
}

// Triangle de la pointe, bout sur `bout.point`, orienté selon `bout.angle` : 10 × 8, 14 × 11 ou 18 × 14 px
// à l'écran selon `weight` (« thin » par défaut).
export function pointe(bout, zoom, weight = "thin") {
  const [l, w] = POINTES[weight ?? "thin"];
  const longueur = l / zoom;
  const demi = w / 2 / zoom;
  const { point, angle } = bout;
  const bx = point.x - Math.cos(angle) * longueur;
  const by = point.y - Math.sin(angle) * longueur;
  return [
    { x: point.x, y: point.y },
    { x: bx - Math.sin(angle) * demi, y: by + Math.cos(angle) * demi },
    { x: bx + Math.sin(angle) * demi, y: by - Math.cos(angle) * demi },
  ];
}

// Géométrie d'un lien de `doc` : le tracé et les deux pointes. Avec côtés : les connecteurs ; un bout `center` vise le centre de sa boîte et s'arrête sur le bord de sa forme (droit), ou prend le côté le plus proche de l'autre bout (coudé, courbe). Sans côté et droit :
// la droite des centres, d'un bord de forme à l'autre, décalée de 4 px si un lien de sens contraire existe.
// Sans côté, coudé ou courbe : les côtés les plus proches.
export function geometrieLien(doc, lien, zoom) {
  const de = doc.boxes.find((b) => b.id === lien.from);
  const vers = doc.boxes.find((b) => b.id === lien.to);
  const route = lien.route ?? "direct";
  let depart;
  let arrivee;
  const { fromSide, toSide } = lien;
  const sansCote = !fromSide || !toSide || (fromSide === "center" && toSide === "center");
  if (sansCote && route === "direct") {
    const inverse = doc.links.some((l) => l.from === lien.to && l.to === lien.from);
    const { depart: d, arrivee: a } = extremitesFleche(de, vers, inverse ? 4 : 0);
    depart = { point: d, cote: null };
    arrivee = { point: a, cote: null };
  } else if (sansCote) {
    const cotes = cotesProches(de, vers);
    depart = { point: connecteurs(de)[cotes.de], cote: cotes.de };
    arrivee = { point: connecteurs(vers)[cotes.vers], cote: cotes.vers };
  } else if (fromSide === "center" || toSide === "center") {
    // Un seul bout au centre : il vise l'autre bout (son connecteur de côté).
    const centreDe = fromSide === "center";
    const fixe = centreDe ? vers : de;
    const cote = centreDe ? toSide : fromSide;
    const pointFixe = connecteurs(fixe)[cote];
    const boite = centreDe ? de : vers;
    let bout;
    if (route === "direct") {
      bout = { point: pointSurBord(boite, pointFixe), cote: null };
    } else {
      const proche = connecteurProche(boite, pointFixe);
      bout = { point: connecteurs(boite)[proche], cote: proche };
    }
    const autre = { point: pointFixe, cote };
    depart = centreDe ? bout : autre;
    arrivee = centreDe ? autre : bout;
  } else {
    depart = { point: connecteurs(de)[fromSide], cote: fromSide };
    arrivee = { point: connecteurs(vers)[toSide], cote: toSide };
  }
  const t = trace({ route, depart, arrivee, retrait: retraitPointes(lien.ends, lien.weight, zoom) });
  return { ...t, pointeDebut: pointe(t.debut, zoom, lien.weight), pointeFin: pointe(t.fin, zoom, lien.weight) };
}

// Point à mi-longueur du tracé complet d'un lien (décalage de 4 px compris) : le tracé droit ou coudé est
// une polyligne, la courbe de Bézier est échantillonnée finement.
export function milieuTrace(doc, lien) {
  const entier = geometrieLien(doc, lien, 1).entier;
  const nombres = entier.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const points = [];
  if (entier.includes("C")) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = nombres;
    for (let i = 0; i <= 200; i++) {
      const u = i / 200;
      const k = 1 - u;
      const a = k * k * k;
      const b = 3 * k * k * u;
      const c = 3 * k * u * u;
      const d = u * u * u;
      points.push({ x: a * x0 + b * x1 + c * x2 + d * x3, y: a * y0 + b * y1 + c * y2 + d * y3 });
    }
  } else {
    for (let i = 0; i < nombres.length; i += 2) points.push({ x: nombres[i], y: nombres[i + 1] });
  }
  const longueurs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let reste = longueurs.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < longueurs.length; i++) {
    if (reste <= longueurs[i] || i === longueurs.length - 1) {
      const k = longueurs[i] === 0 ? 0 : reste / longueurs[i];
      return { x: points[i].x + (points[i + 1].x - points[i].x) * k, y: points[i].y + (points[i + 1].y - points[i].y) * k };
    }
    reste -= longueurs[i];
  }
  return points[0];
}

// Rectangle englobant les deux bouts d'une flèche libre, pour `toutAfficher` et `voirObjet`.
export function rectangleFleche(fleche) {
  return {
    x: Math.min(fleche.x1, fleche.x2),
    y: Math.min(fleche.y1, fleche.y2),
    width: Math.abs(fleche.x2 - fleche.x1),
    height: Math.abs(fleche.y2 - fleche.y1),
  };
}

// Les `id` des objets entièrement dans `rect` ({ x, y, width, height }), dans l'ordre de Tab : les boîtes, les liens
// dont les deux boîtes y sont, les flèches libres dont les deux bouts y sont.
export function dansRectangle(doc, rect) {
  const dedans = (x, y) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  const boites = doc.boxes.filter((b) => dedans(b.x, b.y) && dedans(b.x + b.width, b.y + b.height)).map((b) => b.id);
  const liens = doc.links.filter((l) => boites.includes(l.from) && boites.includes(l.to)).map((l) => l.id);
  const fleches = (doc.arrows ?? []).filter((f) => dedans(f.x1, f.y1) && dedans(f.x2, f.y2)).map((f) => f.id);
  return [...boites, ...liens, ...fleches];
}
