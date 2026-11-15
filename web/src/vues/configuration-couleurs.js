import { lire } from "../couleurs-markdown.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { groupe } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { message } from "../ui/message.js";
import { PALETTES, pastillesDe } from "../ui/palettes.js";

const CHEMIN = ".yaide/markdown.json";
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const PROPRIETES = ["couleur", "fond", "bordure"];
const ELEMENTS = [
  ...[1, 2, 3, 4, 5, 6].map((i) => [`titre${i}`, `Titre ${i}`, ["couleur"]]),
  ["texte", "Texte", ["couleur"]],
  ["gras", "Gras", ["couleur"]],
  ["italique", "Italique", ["couleur"]],
  ["barre", "Barré", ["couleur"]],
  ["lien", "Lien", ["couleur"]],
  ["code", "Code en ligne", ["couleur", "fond"]],
  ["bloc_code", "Bloc de code", ["couleur", "fond"]],
  ["citation", "Citation", ["couleur", "fond", "bordure"]],
  ["entete_tableau", "En-tête de tableau", ["couleur", "fond"]],
  ["tableau", "Cellules de tableau", ["couleur", "fond", "bordure"]],
  ["puce", "Puce", ["couleur"]],
  ["separateur", "Séparateur", ["couleur"]],
];
const THEMES = [
  ["sombre", "Sombre"],
  ["clair", "Clair"],
];

const themeAffiche = () => (document.documentElement.getAttribute("data-theme") === "light" ? "clair" : "sombre");

/**
 * Section « Couleurs markdown » de V-011. Les champs sont des chaînes tapées, gardées par thème ; rien n'est écrit ici.
 * `afficherResultat(message | null)` pose le message de résultat hors de la partie qui défile.
 * Rend `{ panneau, charger }` ; `charger()` rend une promesse de `true` quand les champs sont prêts.
 */
export function sectionCouleurs({ afficherResultat }) {
  const panneau = document.createElement("div");
  const aide = document.createElement("p");
  aide.id = "configuration-aide-couleurs";
  aide.className = "ya-groupe-aide";
  aide.textContent = "Dans .yaide/markdown.json. Appliquées dès l'enregistrement à l'aperçu et au mode hybride. Un champ vide garde le style par défaut.";
  const zoneAlerte = document.createElement("div");
  const chargement = indication({ texte: "Chargement…", variante: "chargement" });
  panneau.append(aide, zoneAlerte, chargement);
  panneau.setAttribute("aria-describedby", aide.id);

  const valeurs = { sombre: {}, clair: {} };
  const saisies = new Map();
  let theme = themeAffiche();
  let liste = null;

  function montrer() {
    for (const [cle, saisie] of saisies) {
      saisie.value = valeurs[theme][cle] ?? "";
      saisie.dispatchEvent(new Event("input"));
    }
  }
  function garder() {
    for (const [cle, saisie] of saisies) valeurs[theme][cle] = saisie.value;
  }
  function poser(source) {
    for (const t of ["sombre", "clair"]) {
      valeurs[t] = {};
      for (const [element, , proprietes] of ELEMENTS) {
        for (const p of proprietes) valeurs[t][`${element}.${p}`] = source[t]?.[element]?.[p] ?? "";
      }
    }
    montrer();
  }

  function grille() {
    const g = document.createElement("div");
    g.className = "ya-grille-couleurs";
    const entete = document.createElement("div");
    entete.className = "ya-grille-entete";
    const choix = champ({ libelle: "Couleurs du thème", type: "liste", presentation: "barre", options: THEMES.map((t) => t[1]), valeur: THEMES.find((t) => t[0] === theme)[1] });
    liste = choix.querySelector("select");
    liste.addEventListener("change", () => {
      garder();
      theme = THEMES.find((t) => t[1] === liste.value)[0];
      montrer();
    });
    entete.append(choix);
    for (const nom of ["Élément", "Couleur", "Fond", "Bordure"]) {
      const c = document.createElement("span");
      c.className = "ya-grille-colonne";
      c.setAttribute("aria-hidden", "true");
      c.textContent = nom;
      entete.append(c);
    }
    g.append(entete);
    for (const [element, libelle, proprietes] of ELEMENTS) {
      const nom = document.createElement("span");
      nom.className = "ya-grille-nom";
      nom.textContent = libelle;
      g.append(nom);
      for (const p of PROPRIETES) {
        if (!proprietes.includes(p)) {
          g.append(document.createElement("span"));
          continue;
        }
        const c = champ({ libelle: `${libelle}, ${p}`, type: "codeCouleur" });
        saisies.set(`${element}.${p}`, c.querySelector("input[type=text]"));
        g.append(c);
      }
    }
    g.addEventListener("input", () => afficherResultat(null));
    return g;
  }

  function palettes() {
    const ligne = document.createElement("div");
    ligne.className = "ya-palettes-ligne";
    const defaut = bouton({ libelle: "Par défaut" });
    defaut.addEventListener("click", () => {
      poser({});
      afficherResultat(message({ texte: "Champs vidés. Enregistrez pour revenir au style par défaut.", variante: "info" }));
    });
    ligne.append(defaut);
    for (const p of PALETTES) {
      const b = bouton({ libelle: p.nom, pastilles: pastillesDe(p) });
      b.addEventListener("click", () => {
        poser(p);
        afficherResultat(message({ texte: `Palette ${p.nom} posée dans les champs. Enregistrez pour l'appliquer.`, variante: "info" }));
      });
      ligne.append(b);
    }
    return groupe({ legende: "Palettes suggérées", champs: [ligne], aide: "Une palette remplit les champs des deux thèmes. Rien n'est écrit avant « Enregistrer »." });
  }

  /** Lit le fichier ; rend `true` si les champs sont prêts (« Enregistrer » possible). */
  async function charger() {
    const lu = await lire();
    if (lu.coupure || lu.raison !== undefined) {
      chargement.replaceWith(message({ texte: lu.coupure ? TEXTE_COUPURE : `Impossible de lire ${CHEMIN} : ${lu.raison}.`, variante: "erreur" }));
      return false;
    }
    if (lu.illisible) zoneAlerte.replaceChildren(message({ texte: `${CHEMIN} est illisible. « Enregistrer » le remplacera par ces réglages.`, variante: "alerte" }));
    chargement.replaceWith(palettes(), grille());
    poser(lu.illisible ? {} : lu);
    return true;
  }

  return { panneau, charger };
}
