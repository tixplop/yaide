import { bouton } from "./bouton.js";

const VARIANTES = ["info", "succes", "alerte", "erreur"];

export function message({ texte, variante = "info", detail, actions = [], fermable = false, fort = false }) {
  if (!texte) throw new Error("message : texte requis");
  if (!VARIANTES.includes(variante)) throw new Error(`message : variante inconnue « ${variante} »`);
  const m = document.createElement("div");
  m.className = `message message-${variante}${fort ? " message-fort" : ""}`;
  m.setAttribute("role", variante === "alerte" || variante === "erreur" ? "alert" : "status");

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
