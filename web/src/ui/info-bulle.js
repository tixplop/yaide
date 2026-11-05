const POSITIONS = ["dessous", "dessus", "droite"];
const DELAI = 400;

let ouverte = null;
let ancreOuverte = null;
let ecoutes = false;

// Écouteurs du document, posés une seule fois pour toutes les info-bulles.
function ecouterDocument() {
  if (ecoutes) return;
  ecoutes = true;
  // En capture : un shell qui arrête la propagation reçoit sa touche, la bulle se ferme quand même.
  document.addEventListener("keydown", surEchap, true);
  // Une ancre retirée du DOM ne reçoit plus d'événements : la bulle se ferme au prochain mouvement.
  document.addEventListener("pointermove", () => {
    if (ouverte && !ancreOuverte.isConnected) fermer();
  });
}

// Position (coin haut gauche) d'une bulle autour d'une ancre, retournée puis bornée pour rester dans la fenêtre.
export function placer(a, b, position, fenetre) {
  let left;
  let top;
  const centreX = a.left + a.width / 2 - b.largeur / 2;
  if (position === "droite") {
    left = a.right;
    if (left + b.largeur > fenetre.largeur) left = a.left - b.largeur;
    top = a.top + a.height / 2 - b.hauteur / 2;
  } else {
    left = centreX;
    top = position === "dessus" ? a.top - b.hauteur : a.bottom;
    if (position === "dessous" && top + b.hauteur > fenetre.hauteur) top = a.top - b.hauteur;
    if (position === "dessus" && top < 0) top = a.bottom;
  }
  left = Math.max(0, Math.min(left, fenetre.largeur - b.largeur));
  top = Math.max(0, Math.min(top, fenetre.hauteur - b.hauteur));
  return { left, top };
}

function fermer() {
  if (!ouverte) return;
  const b = ouverte;
  ouverte = null;
  ancreOuverte = null;
  b.dataset.ouverte = "false";
  if (b.hidePopover) b.hidePopover();
  b.remove();
}

function surEchap(e) {
  if (e.key === "Escape") fermer();
}

function focusVisible(el) {
  return el.matches(":focus-visible");
}

export function infoBulle({ texte, ancre, position = "dessous", enveloppe }) {
  if (!texte) throw new Error("infoBulle : texte requis");
  if (!ancre) throw new Error("infoBulle : ancre requise");
  if (!POSITIONS.includes(position)) throw new Error(`infoBulle : position inconnue « ${position} »`);
  const ecoute = enveloppe ?? ancre;
  const bulle = document.createElement("div");
  bulle.className = "info-bulle ya-tooltip";
  bulle.setAttribute("role", "tooltip");
  bulle.setAttribute("popover", "manual");
  bulle.textContent = texte;
  let minuterie = null;
  // Le texte vit dans l'élément : une bulle ouverte le montre aussitôt, une bulle fermée à sa prochaine ouverture.
  bulle.definirTexte = (t) => {
    if (!t) throw new Error("infoBulle : texte requis");
    bulle.textContent = t;
  };

  function afficher() {
    clearTimeout(minuterie);
    minuterie = null;
    if (ouverte === bulle || !ancre.isConnected) return;
    fermer();
    document.body.append(bulle);
    bulle.dataset.ouverte = "true";
    ouverte = bulle;
    ancreOuverte = ancre;
    if (bulle.showPopover) bulle.showPopover();
    const r = bulle.getBoundingClientRect();
    const p = placer(ecoute.getBoundingClientRect(), { largeur: r.width, hauteur: r.height }, position, { largeur: window.innerWidth, hauteur: window.innerHeight });
    bulle.style.left = `${p.left}px`;
    bulle.style.top = `${p.top}px`;
  }
  function masquer() {
    clearTimeout(minuterie);
    minuterie = null;
    if (ouverte === bulle) fermer();
  }

  ecoute.addEventListener("pointerenter", () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(afficher, DELAI);
  });
  ecoute.addEventListener("pointerleave", (e) => {
    if (e.relatedTarget && bulle.contains(e.relatedTarget)) return;
    if (document.activeElement === ancre && focusVisible(ancre)) return;
    masquer();
  });
  bulle.addEventListener("pointerleave", (e) => {
    if (e.relatedTarget && ecoute.contains(e.relatedTarget)) return;
    if (document.activeElement === ancre && focusVisible(ancre)) return;
    masquer();
  });
  ancre.addEventListener("focus", () => {
    if (focusVisible(ancre)) afficher();
  });
  ancre.addEventListener("blur", masquer);
  ancre.addEventListener("click", masquer);
  ecouterDocument();
  return bulle;
}
