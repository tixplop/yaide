// Modèle de la disposition de l'éditeur (REQ-079) : fonctions pures, sans DOM.
// Feuille : { id, actif }. Nœud : { sens: "ligne" | "colonne", a, b }.

const COTES = ["gauche", "droite", "haut", "bas"];
const PROFONDEUR_MAX = 32;

const estFeuille = (n) => n.sens === undefined;

export function feuilles(arbre) {
  return estFeuille(arbre) ? [arbre] : [...feuilles(arbre.a), ...feuilles(arbre.b)];
}

export function couper(arbre, id, zone, nouvelId) {
  if (!COTES.includes(zone)) throw new Error(`zone invalide : ${zone}`);
  if (!feuilles(arbre).some((g) => g.id === id)) throw new Error(`groupe inconnu : ${id}`);
  const sens = zone === "gauche" || zone === "droite" ? "ligne" : "colonne";
  const avant = zone === "gauche" || zone === "haut";
  const remplacer = (n) => {
    if (estFeuille(n)) {
      if (n.id !== id) return n;
      const nouveau = { id: nouvelId, actif: null };
      return avant ? { sens, a: nouveau, b: n } : { sens, a: n, b: nouveau };
    }
    const a = remplacer(n.a);
    const b = remplacer(n.b);
    return a === n.a && b === n.b ? n : { ...n, a, b };
  };
  return remplacer(arbre);
}

export function retirerGroupe(arbre, id) {
  if (estFeuille(arbre)) return arbre;
  if (!estFeuille(arbre.a) || arbre.a.id !== id) {
    if (estFeuille(arbre.b) && arbre.b.id === id) return arbre.a;
  } else {
    return arbre.b;
  }
  const a = retirerGroupe(arbre.a, id);
  const b = retirerGroupe(arbre.b, id);
  return a === arbre.a && b === arbre.b ? arbre : { ...arbre, a, b };
}

// min : { largeur, hauteur }. source : le groupe est celui de l'onglet glissé.
export function cibles({ largeur, hauteur, min, source, seulOnglet }) {
  const r = [];
  if (!(source && seulOnglet)) {
    if (largeur / 2 >= min.largeur) r.push("gauche", "droite");
    if (hauteur / 2 >= min.hauteur) r.push("haut", "bas");
  }
  if (!source) r.push("centre");
  return r;
}

// px, py : position dans le corps du groupe, en proportion. Renvoie une zone ou null (refus).
export function zoneVisee({ px, py, surBarre, cibles: liste }) {
  const centre = liste.includes("centre") ? "centre" : null;
  if (surBarre) return centre;
  const distances = { gauche: px, droite: 1 - px, haut: py, bas: 1 - py };
  // 1e-9 : une égalité reste une égalité malgré l'arrondi des flottants.
  let meilleure = null;
  for (const c of COTES) {
    if (!liste.includes(c) || !(distances[c] < 0.25)) continue;
    if (meilleure === null || distances[c] < distances[meilleure] - 1e-9) meilleure = c;
  }
  return meilleure ?? centre;
}

export function valider(valeur) {
  const vus = new Set();
  const ok = (n, profondeur) => {
    if (profondeur > PROFONDEUR_MAX || n === null || typeof n !== "object" || Array.isArray(n)) return false;
    const cles = Object.keys(n).sort().join(",");
    if (cles === "actif,id") {
      if (typeof n.id !== "string" || n.id === "" || vus.has(n.id)) return false;
      if (n.actif !== null && typeof n.actif !== "string") return false;
      vus.add(n.id);
      return true;
    }
    if (cles === "a,b,sens" || cles === "a,b,part,sens") {
      return (n.sens === "ligne" || n.sens === "colonne") && ok(n.a, profondeur + 1) && ok(n.b, profondeur + 1);
    }
    return false;
  };
  return ok(valeur, 0);
}

// Partage d'une découpe (REQ-080) : proportion de `a`, 0,5 si absente ou hors de ]0, 1[.
export const partDe = (n) => (typeof n.part === "number" && n.part > 0 && n.part < 1 ? n.part : 0.5);

// id : le dernier groupe de `a`, qui désigne une seule découpe.
export function poserPart(arbre, id, part) {
  if (estFeuille(arbre)) return arbre;
  if (feuilles(arbre.a).at(-1).id === id) return { ...arbre, part };
  const a = poserPart(arbre.a, id, part);
  const b = poserPart(arbre.b, id, part);
  return a === arbre.a && b === arbre.b ? arbre : { ...arbre, a, b };
}

// min : { largeur, hauteur }. Taille minimale d'un nœud mesurée dans `sens`.
export function minimum(n, sens, min) {
  if (estFeuille(n)) return sens === "ligne" ? min.largeur : min.hauteur;
  if (n.sens !== sens) return Math.max(minimum(n.a, sens, min), minimum(n.b, sens, min));
  const part = partDe(n);
  return 1 + Math.max(minimum(n.a, sens, min) / part, minimum(n.b, sens, min) / (1 - part));
}

// S : taille du nœud dans son sens. La partie mesurée est `a` en ligne, `b` en colonne.
export function limitesPoignee({ noeud, S, min }) {
  const mesuree = noeud.sens === "ligne" ? noeud.a : noeud.b;
  const autre = noeud.sens === "ligne" ? noeud.b : noeud.a;
  return {
    min: Math.ceil(minimum(mesuree, noeud.sens, min)),
    max: Math.floor(S - 1 - minimum(autre, noeud.sens, min)),
  };
}

export function bornesAria({ min, max, valeur }) {
  const v = Math.round(valeur);
  if (min > max) return { min: v, max: v, valeur: v };
  return { min: Math.min(min, v), max: Math.max(max, v), valeur: v };
}

export function appliquer({ demande, valeur, min, max }) {
  if (min > max) return valeur;
  const r = Math.min(Math.max(demande, min), max);
  return (r - valeur) * (demande - valeur) < 0 ? valeur : r;
}

export const partDepuis = ({ taille, S, sens }) => (sens === "ligne" ? taille / (S - 1) : 1 - taille / (S - 1));
