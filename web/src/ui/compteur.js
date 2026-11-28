const VARIANTES = ["neutre", "accent", "texte"];

// C-014 : un nombre à côté d'un titre ou d'une icône. À zéro, le compteur existe mais n'est pas affiché.
export function compteur({ valeur, variante = "neutre", position, invalide = false }) {
  if (!Number.isInteger(valeur) || valeur < 0) throw new Error("compteur : valeur entière positive ou nulle requise");
  if (!VARIANTES.includes(variante)) throw new Error(`compteur : variante inconnue « ${variante} »`);
  if (position !== undefined && (variante !== "texte" || !Number.isInteger(position) || position < 1)) throw new Error("compteur : position réservée à la variante texte, entière et positive");
  if (invalide && variante !== "texte") throw new Error("compteur : invalide est réservé à la variante texte");
  const c = document.createElement("span");
  if (variante === "texte") {
    c.className = invalide ? "ya-occ ya-occ-invalide" : valeur === 0 ? "ya-occ ya-occ-zero" : "ya-occ";
    c.textContent = invalide ? "Invalide" : position === undefined ? String(valeur) : `${position} sur ${valeur}`;
    c.setAttribute("aria-hidden", "true");
    return c;
  }
  c.className = variante === "accent" ? "ya-badge ya-badge-accent" : "ya-badge";
  c.textContent = String(valeur);
  c.hidden = valeur === 0;
  return c;
}
