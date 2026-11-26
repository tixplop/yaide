import { bouton } from "./bouton.js";
import { icone } from "./icones.js";

const VARIANTES = ["info", "succes", "alerte", "erreur"];

let compteur = 0;

const ICONES_BARRE = { info: "circle-arrow-up", erreur: "circle-x", succes: "circle-check" };

export function message({ texte, variante = "info", detail, points, champs, actions = [], fermable = false, fort = false, presentation = "normale", cause }) {
  if (!texte) throw new Error("message : texte requis");
  if (!VARIANTES.includes(variante)) throw new Error(`message : variante inconnue « ${variante} »`);
  if (!["normale", "barre", "toast"].includes(presentation)) throw new Error(`message : presentation inconnue « ${presentation} »`);
  if (presentation === "barre" && (!ICONES_BARRE[variante] || detail || champs?.length || fermable || fort)) {
    throw new Error("message : la présentation barre n'accepte que info, succes et erreur, sans detail, champs, fermable ni fort");
  }
  if (presentation === "toast" && (champs?.length || actions.length)) throw new Error("message : la présentation toast n'accepte ni champs ni actions");
  if (points?.length && (presentation !== "normale" || detail || fort)) throw new Error("message : points demande la présentation normale, sans detail ni fort");
  if (cause !== undefined && presentation !== "toast") throw new Error("message : cause réservée à la présentation toast");
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
  if (presentation === "toast") {
    m.classList.add("ya-toast");
    if (fort) m.setAttribute("role", "alert");
    if (cause !== undefined) m.dataset.cause = cause;
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
  if (points?.length) {
    const u = document.createElement("ul");
    u.className = "ya-message-points";
    for (const p of points) {
      const li = document.createElement("li");
      li.textContent = p;
      u.append(li);
    }
    m.append(u);
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
    if (fermable || presentation === "toast") {
      const f = bouton({ icone: "x", variante: "discret", nomAccessible: "Fermer" });
      // La croix est décrite par le texte du message : deux croix affichées ensemble se distinguent (REQ-115).
      t.id = `message-texte-${++compteur}`;
      f.setAttribute("aria-describedby", t.id);
      f.addEventListener("click", () => m.remove());
      m.append(f.enveloppe);
    }
  }
  return m;
}
