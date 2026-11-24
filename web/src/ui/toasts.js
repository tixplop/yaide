import { message } from "./message.js";

// Zone des toasts (C-010) et son API. Une seule zone à la fois : celle que le cadre a créée en dernier.
const MAX = 4;
const DELAI = 6000;

let zone = null;
let repli = () => {};
let liste = []; // { el, texte, variante, fort, cause, timer, survol, focus }

const fermerDe = (t) => t.el.querySelector("button[aria-label='Fermer']");

export function zoneToasts({ repli: rappel } = {}) {
  zone = document.createElement("div");
  zone.className = "ya-toasts";
  repli = rappel ?? (() => {});
  liste = [];
  return zone;
}

function armer(t) {
  clearTimeout(t.timer);
  t.timer = undefined;
  if ((t.variante === "info" || t.variante === "succes") && !t.fort && !t.survol && !t.focus) {
    t.timer = setTimeout(() => enlever(t, false), DELAI);
  }
}

// Retire le toast ; le focus passe au « Fermer » suivant, sinon au précédent, sinon au rappel du cadre.
function enlever(t, forcerFocus) {
  const i = liste.indexOf(t);
  if (i < 0) return;
  const avaitFocus = forcerFocus || t.el.contains(document.activeElement);
  clearTimeout(t.timer);
  liste.splice(i, 1);
  t.el.remove();
  if (!avaitFocus) return;
  const voisin = [...liste.slice(i), ...liste.slice(0, i).reverse()].map(fermerDe).find(Boolean);
  if (voisin) voisin.focus();
  else repli();
}

export function afficher({ texte, variante = "info", detail, fort = false, cause } = {}) {
  if (!zone) throw new Error("toasts : zone absente, créez le cadre d'abord");
  const existant = liste.find((t) => t.texte === texte);
  if (existant) {
    armer(existant);
    return;
  }
  const el = message({ texte, variante: fort ? "alerte" : variante, detail, fort, presentation: "toast", cause });
  const t = { el, texte, variante: fort ? "alerte" : variante, fort, cause, timer: undefined, survol: false, focus: false };
  if (liste.length >= MAX) {
    const ancien = liste.find((x) => !x.fort);
    if (ancien) enlever(ancien, false);
  }
  // Ajouté vide, texte posé à l'image suivante : lu même dans une zone qui vient d'apparaître.
  const zt = el.querySelector(".message-texte");
  zt.textContent = "";
  requestAnimationFrame(() => {
    zt.textContent = t.texte;
  });
  el.addEventListener("pointerenter", () => ((t.survol = true), armer(t)));
  el.addEventListener("pointerleave", () => ((t.survol = false), armer(t)));
  el.addEventListener("focusin", () => ((t.focus = true), armer(t)));
  el.addEventListener("focusout", (ev) => {
    if (el.contains(ev.relatedTarget)) return;
    t.focus = false;
    armer(t);
  });
  // « Fermer » : en phase de capture, pour connaître ses voisins avant que le toast ne parte.
  el.addEventListener(
    "click",
    (ev) => {
      if (!ev.target.closest("button[aria-label='Fermer']")) return;
      ev.stopPropagation();
      enlever(t, true);
    },
    true,
  );
  liste.push(t);
  zone.append(el);
  armer(t);
}

export function retirer(cause) {
  for (const t of liste.filter((x) => x.cause !== undefined && x.cause === cause)) enlever(t, false);
}

export function changerTexte(cause, texte) {
  const t = liste.find((x) => x.cause !== undefined && x.cause === cause);
  if (!t) return;
  t.texte = texte;
  t.el.querySelector(".message-texte").textContent = texte;
}
