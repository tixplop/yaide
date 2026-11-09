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
    return a === n.a && b === n.b ? n : { sens: n.sens, a, b };
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
  return a === arbre.a && b === arbre.b ? arbre : { sens: arbre.sens, a, b };
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
    if (cles === "a,b,sens") {
      return (n.sens === "ligne" || n.sens === "colonne") && ok(n.a, profondeur + 1) && ok(n.b, profondeur + 1);
    }
    return false;
  };
  return ok(valeur, 0);
}
