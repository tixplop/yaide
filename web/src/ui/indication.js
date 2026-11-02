const VARIANTES = ["vide", "chargement"];

export function indication({ texte, variante = "vide", action }) {
  if (!texte) throw new Error("indication : texte requis");
  if (!VARIANTES.includes(variante)) throw new Error(`indication : variante inconnue « ${variante} »`);
  const i = document.createElement("div");
  i.className = "indication";
  i.setAttribute("role", "status");
  const t = document.createElement("span");
  t.textContent = texte;
  i.append(t);
  if (action) i.append(action);
  if (variante === "chargement") {
    i.hidden = true;
    i.setAttribute("aria-busy", "true");
    setTimeout(() => {
      i.hidden = false;
    }, 200);
  }
  return i;
}
