import { bouton } from "./bouton.js";
import { icone } from "./icones.js";

const VARIANTES = ["info", "succes", "alerte", "erreur"];

const ICONES_BARRE = { info: "circle-arrow-up", erreur: "circle-x", succes: "circle-check" };

export function message({ texte, variante = "info", detail, champs, actions = [], fermable = false, fort = false, presentation = "normale" }) {
  if (!texte) throw new Error("message : texte requis");
  if (!VARIANTES.includes(variante)) throw new Error(`message : variante inconnue « ${variante} »`);
  if (presentation !== "normale" && presentation !== "barre") throw new Error(`message : presentation inconnue « ${presentation} »`);
  if (presentation === "barre" && (!ICONES_BARRE[variante] || detail || champs?.length || fermable || fort)) {
    throw new Error("message : la présentation barre n'accepte que info, succes et erreur, sans detail, champs, fermable ni fort");
  }
  if (champs?.length && (variante !== "info" || fort)) throw new Error("message : champs réservés à la variante info");
  const m = document.createElement(champs?.length ? "form" : "div");
  m.className = `message message-${variante}${fort ? " message-fort" : ""}`;
  if (champs?.length) {
    // Formulaire sans role="status" (relu à chaque frappe) ; Entrée dans un champ n'envoie rien, seul un bouton agit.
    m.classList.add("message-avec-champs");
    m.noValidate = true;
    m.setAttribute("role", "group");
    m.setAttribute("aria-label", texte);
    m.addEventListener("submit", (ev) => ev.preventDefault());
    m.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target instanceof HTMLInputElement) ev.preventDefault();
    });
  } else if (presentation !== "barre") {
    // En barre, le rôle vient de la zone vivante qui porte le message.
    m.setAttribute("role", variante === "alerte" || variante === "erreur" ? "alert" : "status");
  }

  if (presentation === "barre") {
    m.classList.add("ya-message-barre");
    m.prepend(icone(ICONES_BARRE[variante], 13));
    // Le texte entier d'un échec reste lisible quand la barre le coupe ; un succès reçoit le focus par code.
    if (variante === "erreur") m.title = texte;
    if (variante === "succes") m.tabIndex = -1;
  }
  const t = document.createElement("span");
  t.className = "message-texte";
  t.textContent = texte;
  m.append(t);

  if (detail) {
    const d = document.createElement("pre");
    d.className = "message-detail";
    d.textContent = detail;
    m.append(d);
  }
  if (champs?.length) {
    const c = document.createElement("div");
    c.className = "message-champs ya-champs";
    c.append(...champs);
    m.append(c);
  }
  if (!fort) {
    if (actions.length) {
      const a = document.createElement("div");
      a.className = "message-actions";
      a.append(...actions);
      m.append(a);
    }
    if (fermable) {
      const f = bouton({ icone: "x", variante: "discret", nomAccessible: "Fermer" });
      f.addEventListener("click", () => m.remove());
      m.append(f.enveloppe);
    }
  }
  return m;
}
