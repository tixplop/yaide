import { feuilles, valider } from "./disposition.js";
import { ecrire, lire } from "./stockage.js";

const CLE = "onglets";

export const nomDe = (chemin) => chemin.split("/").pop();
const dossierDe = (chemin) => chemin.split("/").slice(0, -1).join("/");

/** Vrai si `chemin` est `base` ou se trouve dessous. */
export const estSous = (chemin, base) => chemin === base || chemin.startsWith(`${base}/`);

/** Chemin d'un onglet après le renommage de `de` en `vers`. */
export function suivreRenommage(chemin, de, vers) {
  return estSous(chemin, de) ? vers + chemin.slice(de.length) : chemin;
}

/** `{ libelle, detail }` de chaque chemin : le nom, et le dossier parent si un autre onglet porte le même nom. */
export function libelles(chemins) {
  const vus = new Map();
  for (const c of chemins) vus.set(nomDe(c), (vus.get(nomDe(c)) ?? 0) + 1);
  return chemins.map((c) => {
    const parent = dossierDe(c);
    return { libelle: nomDe(c), detail: vus.get(nomDe(c)) > 1 && parent ? parent : undefined };
  });
}

/** Plus petit numéro (à partir de 1) qui n'est pas dans `numeros`. */
export function plusPetitNumeroLibre(numeros) {
  let n = 1;
  while (numeros.includes(n)) n++;
  return n;
}

/** Onglet actif après la fermeture de `ferme` : celui de droite, sinon celui de gauche. */
export function apresFermeture(ids, ferme) {
  const i = ids.indexOf(ferme);
  const reste = ids.filter((x) => x !== ferme);
  return reste[Math.min(i, reste.length - 1)] ?? null;
}

/**
 * Garde la liste `[{ chemin, groupe, apercu, hybride, texte? }]`, l'onglet actif du groupe courant et la disposition
 * `{ arbre, courant }` (feuilles `{ id, actif }`) dans le navigateur.
 */
export const garder = (liste, actif, disposition) => ecrire(CLE, { liste, actif, disposition });

/** Disposition d'un seul groupe : celle des gardes sans disposition, ou dont la disposition est abîmée. */
const unGroupe = (actif) => ({ arbre: { id: "g1", actif }, courant: "g1" });

/** Liste gardée : `{ liste, actif, disposition }`, vide s'il n'y a rien ; `disposition` est toujours valide. */
export async function retrouver() {
  const v = await lire(CLE);
  if (!Array.isArray(v?.liste)) return { liste: [], actif: null, disposition: unGroupe(null) };
  const actif = v.actif ?? null;
  const d = v.disposition;
  if (!valider(d?.arbre)) return { liste: v.liste, actif, disposition: unGroupe(actif) };
  const courant = feuilles(d.arbre).some((f) => f.id === d.courant) ? d.courant : feuilles(d.arbre)[0].id;
  return { liste: v.liste, actif, disposition: { arbre: d.arbre, courant } };
}
