import { ecrireFichier } from "../api.js";
import { analyser, appliquer, lire, serialiser } from "../couleurs-markdown.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { groupe } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { message } from "../ui/message.js";
import { PALETTES, pastillesDe } from "../ui/palettes.js";

const CHEMIN = ".yaide/markdown.json";
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const PROPRIETES = ["couleur", "fond", "bordure"];
const NOMS_PROPRIETES = { couleur: "Couleur", fond: "Fond", bordure: "Bordure" };
const COULEUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");
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
 * Section « Couleurs markdown » de V-011. Les champs sont des chaînes tapées, gardées par thème ; seul `enregistrer()` écrit.
 * `afficherResultat(message | null)` pose le message de résultat hors de la partie qui défile ;
 * `surEnCours(oui)` signale le début et la fin de l'écriture ; `surEnregistre()` suit une écriture réussie.
 * Rend `{ panneau, charger, enregistrer }` ; `charger()` rend une promesse de `true` quand les champs sont prêts.
 */
export function sectionCouleurs({ afficherResultat, surEnCours = () => {}, surEnregistre = () => {} }) {
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
  let grilleEl = null;
  const cellules = new Map();
  const suivants = new Map();
  const erreurs = { sombre: new Set(), clair: new Set() };
  let enErreur = new Set();
  let messages = [];

  function fabriquer(element, libelle, p, erreur) {
    const cle = `${element}.${p}`;
    const c = champ({ libelle: `${libelle}, ${p}`, type: "codeCouleur", erreur });
    saisies.set(cle, c.querySelector("input[type=text]"));
    return c;
  }
  // Remet les champs en état normal ou en erreur selon le thème affiché.
  function etatErreurs() {
    for (const m of messages) m.remove();
    messages = [];
    const voulus = erreurs[theme];
    for (const cle of new Set([...enErreur, ...voulus])) {
      const [element, p] = cle.split(".");
      const [, libelle, proprietes] = ELEMENTS.find((e) => e[0] === element);
      const texte = voulus.has(cle)
        ? `${proprietes.length > 1 ? `${NOMS_PROPRIETES[p]} : tapez` : "Tapez"} une couleur #rgb ou #rrggbb, ou laissez vide.`
        : undefined;
      const nouveau = fabriquer(element, libelle, p, texte);
      cellules.get(cle).replaceWith(nouveau);
      cellules.set(cle, nouveau);
      if (texte) {
        grilleEl.insertBefore(nouveau.messageErreur, suivants.get(element));
        messages.push(nouveau.messageErreur);
      }
    }
    enErreur = new Set(voulus);
  }

  function montrer() {
    if (grilleEl) etatErreurs();
    for (const [cle, saisie] of saisies) {
      saisie.value = valeurs[theme][cle] ?? "";
      saisie.dispatchEvent(new Event("input"));
    }
  }
  function garder() {
    for (const [cle, saisie] of saisies) valeurs[theme][cle] = saisie.value;
  }
  function poser(source) {
    erreurs.sombre.clear();
    erreurs.clair.clear();
    for (const t of ["sombre", "clair"]) {
      valeurs[t] = {};
      for (const [element, , proprietes] of ELEMENTS) {
        for (const p of proprietes) valeurs[t][`${element}.${p}`] = source[t]?.[element]?.[p] ?? "";
      }
    }
    montrer();
  }

  function changerTheme(cible) {
    garder();
    theme = cible;
    liste.value = THEMES.find((t) => t[0] === cible)[1];
    montrer();
  }

  function grille() {
    const g = document.createElement("div");
    g.className = "ya-grille-couleurs";
    const entete = document.createElement("div");
    entete.className = "ya-grille-entete";
    const choix = champ({ libelle: "Couleurs du thème", type: "liste", presentation: "barre", options: THEMES.map((t) => t[1]), valeur: THEMES.find((t) => t[0] === theme)[1] });
    liste = choix.querySelector("select");
    liste.addEventListener("change", () => changerTheme(THEMES.find((t) => t[1] === liste.value)[0]));
    entete.append(choix);
    for (const nom of ["Élément", "Couleur", "Fond", "Bordure"]) {
      const c = document.createElement("span");
      c.className = "ya-grille-colonne";
      c.setAttribute("aria-hidden", "true");
      c.textContent = nom;
      entete.append(c);
    }
    g.append(entete);
    grilleEl = g;
    const noms = ELEMENTS.map(([, libelle]) => {
      const nom = document.createElement("span");
      nom.className = "ya-grille-nom";
      nom.textContent = libelle;
      return nom;
    });
    ELEMENTS.forEach(([element], i) => suivants.set(element, noms[i + 1] ?? null));
    for (const [i, [element, libelle, proprietes]] of ELEMENTS.entries()) {
      g.append(noms[i]);
      for (const p of PROPRIETES) {
        if (!proprietes.includes(p)) {
          g.append(document.createElement("span"));
          continue;
        }
        const c = fabriquer(element, libelle, p);
        cellules.set(`${element}.${p}`, c);
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

  function desactiver(oui) {
    for (const e of panneau.querySelectorAll("input, select, button")) e.disabled = oui;
  }

  /** Vérifie, écrit, applique. Rend `true` si le fichier est écrit. */
  async function enregistrer() {
    garder();
    afficherResultat(null);
    for (const t of ["sombre", "clair"]) {
      erreurs[t] = new Set();
      for (const [cle, v] of Object.entries(valeurs[t])) if (v.trim() !== "" && !COULEUR.test(v.trim())) erreurs[t].add(cle);
    }
    const refuse = ["sombre", "clair"].find((t) => erreurs[t].size);
    if (refuse) {
      const premier = ELEMENTS.flatMap(([e, , ps]) => ps.map((p) => `${e}.${p}`)).find((cle) => erreurs[refuse].has(cle));
      if (refuse !== theme) changerTheme(refuse);
      else montrer();
      saisies.get(premier).focus();
      return false;
    }
    montrer(); // retire les erreurs d'un refus précédent
    const reglages = { sombre: {}, clair: {} };
    for (const t of ["sombre", "clair"]) {
      for (const [cle, v] of Object.entries(valeurs[t])) {
        const [element, p] = cle.split(".");
        if (v.trim() !== "") (reglages[t][element] ??= {})[p] = v.trim();
      }
    }
    const texte = serialiser(reglages);
    surEnCours(true);
    desactiver(true);
    const r = await ecrireFichier(CHEMIN, texte);
    desactiver(false);
    surEnCours(false);
    if (r.coupure || r.cause) {
      afficherResultat(message({ texte: r.coupure ? TEXTE_COUPURE : `Enregistrement impossible : ${sansPoint(r.message)}.`, variante: "erreur" }));
      return false;
    }
    appliquer(analyser(texte));
    zoneAlerte.replaceChildren();
    afficherResultat(message({ texte: "Couleurs enregistrées.", variante: "succes" }));
    surEnregistre();
    return true;
  }

  return { panneau, charger, enregistrer };
}
