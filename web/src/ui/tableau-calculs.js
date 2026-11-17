// Calculs du whiteboard (C-018), sans DOM. Une vue est `{ x, y, zoom }` : (x, y) est le point du dessin
// en haut à gauche de la surface, `zoom` un rapport (1 = 100 %). Une taille est `{ largeur, hauteur }` en px écran.

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const CRANS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const MARGE_TOUT = 32;
const MARGE_OBJET = 24;

// Point où le rayon issu de (ox, oy), dans la direction (dx, dy), quitte `boite`.
function sortie(boite, ox, oy, dx, dy) {
  if (dx === 0 && dy === 0) return { x: ox, y: oy };
  const t = Math.min(
    dx === 0 ? Infinity : boite.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : boite.height / 2 / Math.abs(dy),
  );
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
