import { lireFichier } from "./api.js";

const CHEMIN = ".yaide/interface.json";
const REPLIS = ["panneau", "agent", "shells"];
const FONCTIONS = ["recherche", "git", "shells", "agents", "claude"];
const ILLISIBLE = { illisible: true };

function objet(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function booleens(v, cles) {
  if (!objet(v)) return null;
  for (const [cle, valeur] of Object.entries(v)) if (!cles.includes(cle) || typeof valeur !== "boolean") return null;
  return v;
}

/** Rend `{ replis, fonctions }` (replis : les seules clés présentes ; fonctions : complété à `true`) ou `{ illisible: true }`. */
export function analyser(texte) {
  let brut;
  try {
    brut = JSON.parse(texte);
  } catch {
    return ILLISIBLE;
  }
  if (!objet(brut) || Object.keys(brut).some((k) => k !== "replis" && k !== "fonctions")) return ILLISIBLE;
  const replis = brut.replis === undefined ? {} : booleens(brut.replis, REPLIS);
  const donnees = brut.fonctions === undefined ? {} : booleens(brut.fonctions, FONCTIONS);
  if (!replis || !donnees) return ILLISIBLE;
  const fonctions = Object.fromEntries(FONCTIONS.map((f) => [f, donnees[f] ?? true]));
  return { replis: { ...replis }, fonctions };
}

/** Lit `.yaide/interface.json`. Absent ou illisible pour le réseau : réglages vides, sans message. N'écrit jamais. */
export async function charger() {
  const lecture = await lireFichier(CHEMIN);
  if (typeof lecture.contenu !== "string") return vide();
  return analyser(lecture.contenu);
}

function vide() {
  return analyser("{}");
}
