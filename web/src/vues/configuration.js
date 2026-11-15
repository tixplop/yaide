import { ecrireFichier } from "../api.js";
import { lire, serialiser } from "../reglages-interface.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { amenerDansLaVue, dialogue, groupe } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { sectionCouleurs } from "./configuration-couleurs.js";

const CHEMIN = ".yaide/interface.json";
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");
const REPLIS = [
  ["panneau", "Panneau de gauche"],
  ["shells", "Zone des shells"],
  ["agent", "Colonne de l'agent"],
];
const CHOIX = [
  ["Comme la dernière fois", undefined],
  ["Déplié", false],
  ["Replié", true],
];
const FONCTIONS = [
  ["recherche", "Recherche"],
  ["git", "Git"],
  ["shells", "Shells"],
  ["agents", "Agents"],
  ["claude", "Claude"],
];

const SECTIONS = [
  { id: "interface", libelle: "Interface" },
  { id: "couleurs", libelle: "Couleurs markdown" },
];

/**
 * V-011 : dialogue « Configuration », sections « Interface » (`.yaide/interface.json`, sans écrire de JSON ;
 * n'applique rien à l'interface) et « Couleurs markdown » (`.yaide/markdown.json`, appliqué dès l'enregistrement ; `surCouleursEnregistrees` le suit).
 * `surFermeture` est appelé à la fermeture (Fermer, Échap) ; le focus est alors à l'appelant.
 * Rend `{ fermer, element }`.
 */
export function ouvrirConfiguration({ surFermeture = () => {}, surCouleursEnregistrees = () => {} } = {}) {
  let ferme = false;
  let enCours = false;
  let enCoursC = false;
  let pretC = false;
  let charge = false;
  const replis = {};
  const fonctions = Object.fromEntries(FONCTIONS.map(([c]) => [c, true]));
  let premier = null;

  let section = "interface";
  let messageCouleurs = null;
  const couleurs = sectionCouleurs({
    afficherResultat: (m) => {
      messageCouleurs = m;
      if (section === "couleurs") dlg.definirResultat(m);
    },
    surEnCours: (oui) => {
      enCoursC = oui;
      enregistrerC = nouveauBoutonC(oui);
      majActions();
      fermerB.disabled = oui || enCours;
    },
    surEnregistre: () => surCouleursEnregistrees(),
  });
  const panneaux = { interface: document.createElement("div"), couleurs: couleurs.panneau };
  const hote = document.createElement("div");
  hote.className = "ya-sections-hote";
  const aide = document.createElement("p");
  aide.id = "configuration-aide-interface";
  aide.className = "ya-groupe-aide";
  aide.textContent = "Dans .yaide/interface.json. Appliquées au prochain chargement de la page.";
  const chargement = indication({ texte: "Chargement…", variante: "chargement" });
  const fermerB = bouton({ libelle: "Fermer" });
  let enregistrerB = bouton({ libelle: "Enregistrer", variante: "principal", desactive: true });
  let enregistrerC = nouveauBoutonC(false);
  const zoneAlerte = document.createElement("div");
  const zoneResultat = document.createElement("div");

  function fermer() {
    if (ferme) return;
    ferme = true;
    dlg.fermer({ rendreFocus: false });
    surFermeture();
  }
  fermerB.addEventListener("click", fermer);

  function montrerResultat(texte, variante) {
    const m = message({ texte, variante });
    zoneResultat.replaceChildren(m);
    amenerDansLaVue(m);
  }
  const retirerResultat = () => zoneResultat.replaceChildren();

  function dessiner(lu) {
    if (lu.illisible) zoneAlerte.replaceChildren(message({ texte: `${CHEMIN} est illisible. « Enregistrer » le remplacera par ces réglages.`, variante: "alerte" }));
    else {
      Object.assign(replis, lu.replis);
      Object.assign(fonctions, lu.fonctions);
    }
    const choix = REPLIS.map(([cle, libelle]) => {
      const valeur = CHOIX.find(([, v]) => v === replis[cle])[0];
      const c = champ({ libelle, type: "liste", options: CHOIX.map((o) => o[0]), valeur });
      const select = c.querySelector("select");
      select.addEventListener("change", () => {
        const v = CHOIX.find(([nom]) => nom === select.value)[1];
        if (v === undefined) delete replis[cle];
        else replis[cle] = v;
        retirerResultat();
      });
      return c;
    });
    const cases = FONCTIONS.map(([cle, libelle]) => {
      const c = champ({ libelle, type: "case", valeur: fonctions[cle] });
      const saisie = c.querySelector("input");
      saisie.addEventListener("change", () => {
        fonctions[cle] = saisie.checked;
        retirerResultat();
      });
      return c;
    });
    premier = choix[0].querySelector("select");
    chargement.replaceWith(
      groupe({ legende: "À l'ouverture de la page", champs: choix }),
      groupe({ legende: "Fonctions", champs: cases, enLigne: true, aide: "Une fonction décochée disparaît de l'interface. Rien n'est effacé." }),
      zoneResultat,
    );
    charge = true;
    enregistrerB.disabled = false;
    if (section === "interface") premier.focus();
  }

  function nouveauBouton(enCoursDeVie) {
    const b = enCoursDeVie
      ? bouton({ libelle: "Enregistrer", libelleEnCours: "Enregistrement…", variante: "principal" })
      : bouton({ libelle: "Enregistrer", variante: "principal" });
    b.addEventListener("click", enregistrer);
    return b;
  }

  function nouveauBoutonC(enCoursDeVie) {
    const b = enCoursDeVie
      ? bouton({ libelle: "Enregistrer", libelleEnCours: "Enregistrement…", variante: "principal" })
      : bouton({ libelle: "Enregistrer", variante: "principal", desactive: !pretC });
    b.addEventListener("click", enregistrerCouleurs);
    return b;
  }

  async function enregistrerCouleurs() {
    if (!pretC || enCoursC || ferme) return;
    const avecFocus = document.activeElement === enregistrerC;
    await couleurs.enregistrer();
    if (ferme) return;
    if (avecFocus || document.activeElement === document.body) enregistrerC.focus();
  }

  async function enregistrer() {
    if (!charge || enCours || ferme) return;
    enCours = true;
    const avecFocus = document.activeElement === enregistrerB;
    enregistrerB = nouveauBouton(true);
    majActions();
    fermerB.disabled = true;
    const r = await ecrireFichier(CHEMIN, serialiser({ replis, fonctions }));
    enCours = false;
    if (ferme) return;
    enregistrerB = nouveauBouton(false);
    majActions();
    fermerB.disabled = enCoursC;
    if (r.coupure || r.cause) montrerResultat(r.coupure ? TEXTE_COUPURE : `Enregistrement impossible : ${sansPoint(r.message)}.`, "erreur");
    else {
      zoneAlerte.replaceChildren();
      montrerResultat("Préférences enregistrées. Rechargez la page pour les appliquer.", "succes");
    }
    if (avecFocus || document.activeElement === document.body) enregistrerB.focus();
  }
  enregistrerB.addEventListener("click", enregistrer);

  // Les actions de la section affichée.
  function majActions() {
    dlg.element.querySelector(".dialogue-actions").replaceChildren(fermerB, section === "interface" ? enregistrerB : enregistrerC);
  }

  panneaux.interface.append(aide, zoneAlerte, chargement);
  const barre = onglets({
    presentation: "sections",
    nomBarre: "Configuration",
    onglets: SECTIONS,
    actif: section,
    surChoix: (id) => {
      section = id;
      majActions();
      dlg.definirResultat(section === "couleurs" ? messageCouleurs : null);
    },
    panneaux,
  });
  panneaux.interface.setAttribute("aria-describedby", aide.id);
  hote.append(barre);

  const dlg = dialogue({
    titre: "Configuration",
    sections: hote,
    contenu: [panneaux.interface, panneaux.couleurs],
    actions: [fermerB, enregistrerB],
    focusInitial: fermerB,
    position: "reglages",
    surAnnuler: fermer,
  });
  dlg.element.setAttribute("aria-modal", "true");
  dlg.ouvrir();
  barre.choisir(section);
  // Entrée n'enregistre pas.
  dlg.element.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input, select")) e.preventDefault();
  });

  couleurs.charger().then((pret) => {
    if (ferme) return;
    pretC = pret;
    enregistrerC.disabled = !pret;
  });
  lire().then((lu) => {
    if (ferme) return;
    if (lu.coupure || lu.raison !== undefined) {
      chargement.replaceWith(message({ texte: lu.coupure ? TEXTE_COUPURE : `Impossible de lire ${CHEMIN} : ${lu.raison}.`, variante: "erreur" }));
      return;
    }
    dessiner(lu);
  });

  return { fermer, element: dlg.element };
}
