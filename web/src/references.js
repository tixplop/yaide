// Fichiers cités dans une réponse (REQ-087) : chemin écrit par l'agent → chemin depuis le projet.

const segments = (chemin) => chemin.split("/").filter((s) => s !== "" && s !== ".");

function resoudre(liste) {
  const pile = [];
  for (const s of liste) {
    if (s !== "..") pile.push(s);
    else if (pile.length > 0 && pile.at(-1) !== "..") pile.pop();
    else pile.push("..");
  }
  return pile;
}

/**
 * `ecrit` : chemin tel que l'a écrit l'agent ; `projet` : chemin absolu du projet.
 * Rend le chemin depuis le projet (avec des `..` s'il en sort), ou `undefined` s'il n'y a rien à ouvrir.
 */
export function depuisProjet(ecrit, projet) {
  if (typeof ecrit !== "string" || ecrit === "") return undefined;
  let rel;
  if (ecrit.startsWith("/")) {
    const cible = resoudre(segments(ecrit));
    const base = resoudre(segments(projet ?? ""));
    let commun = 0;
    while (commun < cible.length && commun < base.length && cible[commun] === base[commun]) commun++;
    rel = [...Array(base.length - commun).fill(".."), ...cible.slice(commun)];
  } else {
    rel = resoudre(segments(ecrit));
  }
  return rel.length === 0 ? undefined : rel.join("/");
}
