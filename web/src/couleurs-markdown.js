import { lireFichier } from "./api.js";
import { fondsRegles } from "./ui/hybride.js";

const CHEMIN = ".yaide/markdown.json";
const ILLISIBLE = { illisible: true };
const COULEUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const THEMES = { sombre: "dark", clair: "light" };
const PERMIS = {
  texte: ["couleur"],
  gras: ["couleur"],
  italique: ["couleur"],
  barre: ["couleur"],
  lien: ["couleur"],
  code: ["couleur", "fond"],
  bloc_code: ["couleur", "fond"],
  citation: ["couleur", "fond", "bordure"],
  entete_tableau: ["couleur", "fond"],
  tableau: ["couleur", "fond", "bordure"],
  puce: ["couleur"],
  separateur: ["couleur"],
};
for (let i = 1; i <= 6; i++) PERMIS[`titre${i}`] = ["couleur"];
const ORDRE = [1, 2, 3, 4, 5, 6].map((i) => `titre${i}`).concat(
  ["texte", "gras", "italique", "barre", "lien", "code", "bloc_code", "citation", "entete_tableau", "tableau", "puce", "separateur"],
);
const AVEC_SELECTION = ["code", "bloc_code", "citation"];

function objet(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normaliser(valeur) {
  const c = valeur.toLowerCase();
  return c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
}

/** Rend `{ sombre, clair }` (éléments → propriétés → `#rrggbb`) ou `{ illisible: true }`. Un seul défaut rend tout illisible. */
export function analyser(texte) {
  let brut;
  try {
    brut = JSON.parse(texte);
  } catch {
    return ILLISIBLE;
  }
  if (!objet(brut)) return ILLISIBLE;
  const sortie = { sombre: {}, clair: {} };
  for (const [theme, elements] of Object.entries(brut)) {
    if (!(theme in THEMES) || !objet(elements)) return ILLISIBLE;
    for (const [element, proprietes] of Object.entries(elements)) {
      if (!Object.hasOwn(PERMIS, element) || !objet(proprietes)) return ILLISIBLE;
      const gardees = {};
      for (const [propriete, valeur] of Object.entries(proprietes)) {
        if (!PERMIS[element].includes(propriete) || typeof valeur !== "string" || !COULEUR.test(valeur)) return ILLISIBLE;
        gardees[propriete] = normaliser(valeur);
      }
      sortie[theme][element] = gardees;
    }
  }
  return sortie;
}

/** Texte de la feuille : une règle par thème réglé, uniquement des variables `--md-*` et la sélection sur fond réglé. */
export function feuille(reglages) {
  const regles = [];
  for (const [theme, attribut] of Object.entries(THEMES)) {
    const declarations = [];
    for (const [element, proprietes] of Object.entries(reglages[theme] ?? {})) {
      const nom = element.replaceAll("_", "-");
      for (const [propriete, valeur] of Object.entries(proprietes)) declarations.push(`--md-${nom}-${propriete}: ${valeur};`);
      if (proprietes.fond && AVEC_SELECTION.includes(element)) {
        regles.push(`[data-theme="${attribut}"] .ya-sel-fond-${nom} { background: var(--selection); }`);
      }
    }
    if (declarations.length) regles.unshift(`[data-theme="${attribut}"] { ${declarations.join(" ")} }`);
  }
  return regles.join("\n");
}

let feuilleCourante = null;

/** Pose les réglages (`{ sombre, clair }`) : remplace la feuille posée avant, sans en ajouter une seconde. */
export function appliquer(reglages) {
  fondsRegles(
    AVEC_SELECTION.filter((e) => Object.values(reglages).some((t) => t[e]?.fond)).map((e) => e.replaceAll("_", "-")),
  );
  const restantes = document.adoptedStyleSheets.filter((f) => f !== feuilleCourante);
  feuilleCourante = null;
  const texte = feuille(reglages);
  if (texte) {
    feuilleCourante = new CSSStyleSheet();
    feuilleCourante.replaceSync(texte);
    restantes.push(feuilleCourante);
  }
  document.adoptedStyleSheets = restantes;
}

/** Lit `.yaide/markdown.json` une fois et pose la feuille. Rend `{ illisible }`. N'écrit jamais. */
export async function charger() {
  const lecture = await lireFichier(CHEMIN);
  if (typeof lecture.contenu !== "string") return { illisible: false };
  const reglages = analyser(lecture.contenu);
  if (reglages.illisible) return { illisible: true };
  appliquer(reglages);
  return { illisible: false };
}

/**
 * Relit le fichier pour le dialogue : `{ sombre, clair }` (absent : vides), `{ illisible: true }`,
 * `{ coupure: true }` ou `{ raison }` (autre erreur, message du serveur). N'écrit jamais.
 */
export async function lire() {
  const lecture = await lireFichier(CHEMIN);
  if (lecture.coupure) return { coupure: true };
  if (typeof lecture.contenu === "string") return analyser(lecture.contenu);
  if (lecture.cause === "introuvable") return { sombre: {}, clair: {} };
  return { raison: String(lecture.message ?? "erreur").replace(/\.$/, "") };
}

/** Texte du fichier : `sombre` puis `clair`, éléments et propriétés dans l'ordre de REQ-115 ; valeurs vides omises. */
export function serialiser(reglages) {
  const sortie = {};
  for (const theme of Object.keys(THEMES)) {
    const partie = {};
    for (const element of ORDRE) {
      const proprietes = {};
      for (const propriete of PERMIS[element]) {
        const valeur = reglages[theme]?.[element]?.[propriete];
        if (typeof valeur === "string" && valeur !== "") proprietes[propriete] = normaliser(valeur);
      }
      if (Object.keys(proprietes).length) partie[element] = proprietes;
    }
    if (Object.keys(partie).length) sortie[theme] = partie;
  }
  return JSON.stringify(sortie, null, 2) + "\n";
}
