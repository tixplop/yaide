// Texte d'une boîte ou d'un lien avec les styles d'une partie du texte (REQ-146).
const COULEURS = { blue: "bleu", green: "vert", yellow: "jaune", orange: "orange", red: "rouge", purple: "violet" };

function partie(p, texte) {
  const s = document.createElement("span");
  if (p.bold) s.style.fontWeight = "700";
  if (p.italic) s.style.fontStyle = "italic";
  const deco = [p.underline && "underline", p.strike && "line-through"].filter(Boolean).join(" ");
  if (deco) s.style.textDecoration = deco;
  if (p.color && COULEURS[p.color]) s.style.color = `var(--boite-${COULEURS[p.color]}-trait)`;
  s.textContent = texte;
  return s;
}

// Remplit `conteneur` du texte `text`, découpé aux positions en caractères Unicode de `spans`.
export function rendreTexte(conteneur, text, spans = []) {
  conteneur.replaceChildren();
  const signes = Array.from(text ?? "");
  let pos = 0;
  const jusqua = (fin) => {
    if (fin > pos) conteneur.append(document.createTextNode(signes.slice(pos, fin).join("")));
    pos = Math.max(pos, fin);
  };
  for (const p of spans ?? []) {
    jusqua(p.start);
    conteneur.append(partie(p, signes.slice(p.start, p.end).join("")));
    pos = p.end;
  }
  jusqua(signes.length);
}
