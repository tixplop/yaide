const VARIANTES = ["principal", "secondaire", "discret", "danger"];

export function bouton({ libelle, variante = "secondaire", titre, nomAccessible, desactive = false, libelleEnCours, submit = false }) {
  if (!libelle) throw new Error("bouton : libelle requis");
  if (!VARIANTES.includes(variante)) throw new Error(`bouton : variante inconnue « ${variante} »`);
  if (!/[\p{L}\p{N}]/u.test(libelle) && !nomAccessible) throw new Error("bouton : nomAccessible requis pour un libellé qui n'est qu'un signe");
  const b = document.createElement("button");
  b.type = submit ? "submit" : "button";
  b.className = `bouton bouton-${variante}`;
  b.textContent = libelle;
  if (titre) b.title = titre;
  if (nomAccessible) b.setAttribute("aria-label", nomAccessible);
  b.disabled = desactive;
  if (libelleEnCours) {
    b.textContent = libelleEnCours;
    b.disabled = true;
    b.setAttribute("aria-busy", "true");
  }
  return b;
}
