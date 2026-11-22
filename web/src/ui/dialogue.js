import { bouton } from "./bouton.js";
import { liste } from "./liste.js";

const POSITIONS = ["centre", "milieu", "palette", "reglages"];
let compteur = 0;

export function dialogue({ titre, contenu = [], actions = [], focusInitial, position = "centre", sansChamp = false, aide, sections, focusFermeture, surAnnuler }) {
  if (!titre) throw new Error("dialogue : titre requis");
  if (sansChamp && position !== "palette") throw new Error("dialogue : sansChamp demande la position « palette »");
  if (!focusInitial && !sansChamp) throw new Error("dialogue : focusInitial requis");
  if (!surAnnuler) throw new Error("dialogue : surAnnuler requis");
  if (sections && position !== "reglages") throw new Error("dialogue : sections demande la position « reglages »");
  if (focusFermeture && position !== "milieu") throw new Error("dialogue : focusFermeture demande la position « milieu »");
  if (!POSITIONS.includes(position)) throw new Error(`dialogue : position inconnue « ${position} »`);
  const el = document.createElement("dialog");
  el.className = { centre: "dialogue", milieu: "dialogue ya-milieu", palette: "dialogue ya-palette", reglages: "dialogue ya-reglages" }[position];
  if (sansChamp) {
    el.classList.add("ya-palette-sans-champ");
    el.tabIndex = -1;
    focusInitial ??= el;
  }
  if (position === "palette") el.setAttribute("aria-label", titre);
  else {
    const h = document.createElement("h2");
    h.className = "dialogue-titre ya-dialog-title";
    h.id = `dialogue-${++compteur}-titre`;
    h.textContent = titre;
    el.setAttribute("aria-labelledby", h.id);
    el.append(h);
  }
  if (sections) {
    el.classList.add("ya-reglages-sections");
    el.append(sections);
  }
  const idAide = `dialogue-${compteur}-aide`;
  const poserAide = (a) => {
    if (position === "milieu") a.classList.add("ya-aide-dialogue");
    el.setAttribute("aria-describedby", a.id || (a.id = idAide));
    const c = el.querySelector(":scope > .dialogue-contenu");
    if (c) c.before(a);
    else el.append(a);
  };
  if (aide) poserAide(aide);
  const corps = document.createElement("div");
  corps.className = "dialogue-contenu";
  corps.append(...contenu);
  el.append(corps);
  // « Liste et fiche » : le C-003 de résultat est hors de la partie qui défile, entre elle et les actions.
  let resultat = null;
  if (actions.length) {
    const pied = document.createElement("div");
    pied.className = "dialogue-actions";
    pied.append(...actions);
    el.append(pied);
  }
  el.addEventListener("cancel", (e) => {
    e.preventDefault();
    surAnnuler();
  });
  // Palette sans champ : un clic sur le fond (hors du dialogue) vaut Échap.
  if (sansChamp) {
    el.addEventListener("click", (e) => {
      if (e.target !== el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) surAnnuler();
    });
  }

  // Fin de session : un message, une seule action. Tab reste sur elle, Entrée ferme, le voile ne fait rien.
  if (position === "milieu") {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        focusInitial.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        surAnnuler();
      }
    });
  }

  let origine = null;
  return {
    element: el,
    ouvrir() {
      origine = document.activeElement;
      document.body.append(el);
      el.showModal();
      // Le contour de focus s'affiche dès l'ouverture, même après un clic à la souris.
      if (position === "milieu" && focusInitial.poserFocus) focusInitial.poserFocus();
      else focusInitial.focus();
    },
    fermer({ rendreFocus = true } = {}) {
      el.close();
      el.remove();
      if (focusFermeture) focusFermeture.focus();
      else if (rendreFocus) origine?.focus?.();
    },
    // Pose l'aide sous le titre, après coup (texte connu après le chargement), reliée par aria-describedby.
    definirAide(a) {
      el.querySelector(":scope > .ya-aide-dialogue")?.remove();
      a.classList.add("ya-aide-dialogue");
      poserAide(a);
    },
    // Remplace le contenu (la liste arrive) et y porte le focus.
    remplacer(noeuds, focus) {
      corps.replaceChildren(...noeuds);
      if (el.open) (focus ?? el).focus();
    },
    // Pose (ou retire, sans argument) le C-003 de résultat, hors de la partie qui défile.
    definirResultat(message) {
      if (!resultat) {
        if (!message) return;
        resultat = document.createElement("div");
        resultat.className = "dialogue-resultat";
        el.insertBefore(resultat, el.querySelector(":scope > .dialogue-actions"));
      }
      resultat.replaceChildren(...(message ? [message] : []));
      resultat.hidden = !message;
      if (message) amenerDansLaVue(message);
    },
    enCours(oui) {
      for (const b of actions) b.disabled = oui;
    },
  };
}

// Groupe de champs d'un C-007 sans liste : <fieldset> et <legend>, aide reliée par aria-describedby.
export function groupe({ legende, champs, aide, enLigne = false }) {
  const f = document.createElement("fieldset");
  f.className = enLigne ? "ya-groupe ya-groupe-ligne" : "ya-groupe";
  const l = document.createElement("legend");
  l.textContent = legende;
  f.append(l, ...champs);
  if (aide) {
    const a = document.createElement("p");
    a.className = "ya-groupe-aide";
    a.id = `groupe-${++compteur}-aide`;
    a.textContent = aide;
    f.setAttribute("aria-describedby", a.id);
    f.append(a);
  }
  return f;
}

// Règle C-007 : un message apparu dans le contenu qui défile est amené dans la vue, sans déplacer le focus.
export function amenerDansLaVue(element) {
  element.scrollIntoView?.({ block: "nearest" });
}

// Fiche d'un objet (C-007 « Liste et fiche ») : son titre `<h2>`, un C-003 éventuel, puis les champs sur une grille
// de deux colonnes (1fr 2fr) ; les `multiligne` prennent toute la largeur.
export function fiche({ titre, message, champs }) {
  const f = document.createElement("div");
  f.className = "ya-fiche";
  const h = document.createElement("h2");
  h.className = "ya-fiche-titre";
  h.textContent = titre;
  const grille = document.createElement("div");
  grille.className = "ya-fiche-champs";
  for (const c of champs) {
    if (c.querySelector("textarea")) c.classList.add("ya-fiche-large");
    grille.append(c);
  }
  f.append(h, ...(message ? [message] : []), grille);
  return f;
}

// C-007 `centre`, « Choix sans bouton principal » (REQ-149) : l'aide, une C-006 `grille`, « Fermer » seul.
// Choisir une case ferme le dialogue et rend le choix ; « Fermer », Échap ou le voile le ferment sans rien rendre.
export function dialogueChoix({ titre, aide, nom, lignes, groupes, selection, surChoix }) {
  const texte = document.createElement("p");
  texte.className = "ya-aide-choix";
  texte.textContent = aide;
  const grille = liste({ variante: "grille", lignes, groupes, selection, nom, surActiver: (id) => {
    d.fermer();
    surChoix(id);
  } });
  const fermer = bouton({ libelle: "Fermer", variante: "secondaire" });
  const annuler = () => d.fermer();
  fermer.addEventListener("click", annuler);
  const d = dialogue({ titre, aide: texte, contenu: [grille], actions: [fermer], focusInitial: grille.focusInitial, surAnnuler: annuler });
  d.element.classList.add("ya-choix");
  // Un clic sur le voile arrive sur le dialogue lui-même, hors de son cadre.
  d.element.addEventListener("click", (e) => {
    if (e.target !== d.element) return;
    const r = d.element.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) annuler();
  });
  return d;
}
