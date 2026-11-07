export const COULEURS = ["violet", "vert", "orange", "rose", "sarcelle", "gris"];

const segmenteur = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Nombre de graphèmes : un emoji, même à ZWJ, compte pour un. */
export function compterCaracteres(texte) {
  return [...segmenteur.segment(texte)].length;
}

/** Premier graphème du nom, en majuscule ; vide si le nom est vide. */
export function premiereLettre(nom) {
  const premier = segmenteur.segment(nom.trim())[Symbol.iterator]().next().value;
  return premier ? premier.segment.toLocaleUpperCase() : "";
}

/** C-016. Rond de 20 px, masqué aux lecteurs d'écran : le nom écrit à côté porte le sens. */
export function avatar({ avatar: texte = "", nom, couleur = "violet" }) {
  if (!nom) throw new Error("avatar : nom requis");
  if (!COULEURS.includes(couleur)) throw new Error(`avatar : couleur inconnue « ${couleur} »`);
  const e = document.createElement("span");
  e.className = "ya-avatar";
  if (/\p{Extended_Pictographic}/u.test(texte)) e.classList.add("emoji");
  e.style.setProperty("--c", `var(--agent-${couleur})`);
  e.setAttribute("aria-hidden", "true");
  e.textContent = texte || premiereLettre(nom);
  return e;
}
