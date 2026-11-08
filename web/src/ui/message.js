import { bouton } from "./bouton.js";

const VARIANTES = ["info", "succes", "alerte", "erreur"];

export function message({ texte, variante = "info", detail, champs, actions = [], fermable = false, fort = false }) {
  if (!texte) throw new Error("message : texte requis");
  if (!VARIANTES.includes(variante)) throw new Error(`message : variante inconnue « ${variante} »`);
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
  } else {
    m.setAttribute("role", variante === "alerte" || variante === "erreur" ? "alert" : "status");
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
