const VARIANTES = ["neutre", "accent"];

// C-014 : un nombre à côté d'un titre ou d'une icône. À zéro, le compteur existe mais n'est pas affiché.
export function compteur({ valeur, variante = "neutre" }) {
  if (!Number.isInteger(valeur) || valeur < 0) throw new Error("compteur : valeur entière positive ou nulle requise");
  if (!VARIANTES.includes(variante)) throw new Error(`compteur : variante inconnue « ${variante} »`);
  const c = document.createElement("span");
  c.className = variante === "accent" ? "ya-badge ya-badge-accent" : "ya-badge";
  c.textContent = String(valeur);
  c.hidden = valeur === 0;
  return c;
}
