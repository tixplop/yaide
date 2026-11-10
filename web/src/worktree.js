// État partagé du worktree choisi (REQ-086) : en mémoire, jamais dans le stockage.
let liste = [];
let choix = "";
let raison;
const abonnes = new Set();

const notifier = (evenement) => abonnes.forEach((f) => f(evenement));

export const abonner = (f) => {
  abonnes.add(f);
  return () => abonnes.delete(f);
};
export const choisi = () => choix;
export const occupe = () => raison;
export const lister = () => liste;

export function choisir(chemin) {
  if (chemin === choix) return;
  choix = chemin;
  notifier({ disparu: undefined });
}

export function occuper(r) {
  raison = r || undefined;
  notifier({ disparu: undefined });
}

/** `liste` : `[{ chemin, nom, branche, detachee }]` de `/api/git/etat`. */
export function mettreAJour(nouvelle) {
  const avant = liste.find((w) => w.chemin === choix);
  liste = nouvelle;
  let disparu;
  if (choix !== "" && !liste.some((w) => w.chemin === choix)) {
    disparu = avant?.nom ?? choix;
    choix = "";
  }
  notifier({ disparu });
}

export const texte = (w) => `${w.nom} (${w.detachee ? "détachée" : w.branche})`;

export function nomChoisi() {
  return liste.find((w) => w.chemin === choix)?.nom;
}

/** Chemin depuis le projet → chemin depuis le dossier du worktree choisi. */
export function dansWorktree(chemin) {
  if (choix === "") return chemin;
  if (chemin === choix) return "";
  return chemin.startsWith(`${choix}/`) ? chemin.slice(choix.length + 1) : chemin;
}

/** Chemin depuis le dossier du worktree choisi → chemin depuis le projet. */
export function depuisWorktree(rel) {
  if (choix === "") return rel;
  return rel === "" ? choix : `${choix}/${rel}`;
}
