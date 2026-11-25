import { bouton } from "./bouton.js";
import { estMac } from "../references.js";
import { gras, italique, souligne, barre, codeEnLigne, lien, image, whiteboard, titre, citation, listePuces, listeNumerotee, blocCode, tableau, separateur } from "./mise-en-forme.js";

// Barre « Mise en forme » (REQ-170, C-008) : quinze boutons à icône en quatre groupes, posés au-dessus d'un éditeur
// markdown en mode hybride. Chaque bouton applique une action de `mise-en-forme.js` à l'éditeur, qui garde le focus.

const GROUPES = [
  [["Titre", "heading", titre]],
  [
    ["Gras", "bold", gras, "B"],
    ["Italique", "italic", italique, "I"],
    ["Souligné", "underline", souligne, "U"],
    ["Barré", "strikethrough", barre],
    ["Code en ligne", "code", codeEnLigne],
    ["Lien", "link", lien],
    ["Image", "image", image],
    ["Whiteboard", "workflow", whiteboard],
  ],
  [
    ["Citation", "text-quote", citation],
    ["Liste à puces", "liste-puces", listePuces],
    ["Liste numérotée", "list-ordered", listeNumerotee],
    ["Bloc de code", "square-code", blocCode],
  ],
  [
    ["Tableau", "table", tableau],
    ["Séparateur", "separator-horizontal", separateur],
  ],
];

let compteur = 0;

/** Rend l'élément `div.ya-barre-md` ; `detruire()` retire l'écouteur d'Alt+F10 posé sur l'éditeur. */
export function barreMd({ vue }) {
  const mac = estMac();
  const racine = document.createElement("div");
  racine.className = "ya-barre-md";
  racine.setAttribute("role", "toolbar");
  racine.setAttribute("aria-label", "Mise en forme");
  vue.contentDOM.id ||= `ya-editeur-md-${++compteur}`;
  racine.setAttribute("aria-controls", vue.contentDOM.id);

  const boutons = [];
  for (const defs of GROUPES) {
    const groupe = document.createElement("div");
    groupe.className = "ya-barre-md-groupe";
    for (const [nom, icone, action, lettre] of defs) {
      const b = bouton({
        icone,
        variante: "discret",
        nomAccessible: nom,
        positionInfoBulle: "dessus",
        ...(lettre ? { raccourci: `${mac ? "Cmd" : "Ctrl"}+${lettre}`, touche: `${mac ? "Meta" : "Control"}+${lettre}` } : {}),
      });
      b.tabIndex = -1;
      b.addEventListener("click", () => {
        vue.dispatch(action(vue.state));
        vue.focus();
      });
      boutons.push(b);
      groupe.append(b.enveloppe);
    }
    racine.append(groupe);
  }

  // Un seul arrêt de Tab : le dernier bouton qui a eu le focus (« Titre » au départ).
  let courant = 0;
  const arret = (i) => {
    boutons[courant].tabIndex = -1;
    courant = i;
    boutons[courant].tabIndex = 0;
  };
  arret(0);
  racine.addEventListener("focusin", (ev) => {
    const i = boutons.indexOf(ev.target);
    if (i >= 0) arret(i);
  });

  // L'éditeur garde le focus, sa sélection et son défilement.
  racine.addEventListener("mousedown", (ev) => ev.preventDefault());

  racine.addEventListener("keydown", (ev) => {
    const i = boutons.indexOf(ev.target);
    if (i < 0 || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    let cible = null;
    if (ev.key === "ArrowLeft") cible = Math.max(0, i - 1);
    else if (ev.key === "ArrowRight") cible = Math.min(boutons.length - 1, i + 1);
    else if (ev.key === "Home") cible = 0;
    else if (ev.key === "End") cible = boutons.length - 1;
    if (cible !== null) {
      ev.preventDefault();
      boutons[cible].focus();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      vue.focus();
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      boutons[i].click();
    }
  });

  // Alt+F10 (Option+F10 sur macOS) : le focus va sur l'arrêt de la barre, la sélection reste.
  const alt = (ev) => {
    if (ev.key !== "F10" || !ev.altKey || !racine.isConnected) return;
    ev.preventDefault();
    boutons[courant].focus();
  };
  vue.contentDOM.addEventListener("keydown", alt);
  racine.detruire = () => vue.contentDOM.removeEventListener("keydown", alt);
  return racine;
}
