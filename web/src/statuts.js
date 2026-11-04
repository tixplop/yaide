// Mot de chaque lettre de statut git.
export const MOTS = { A: "ajouté", M: "modifié", R: "renommé", D: "supprimé", U: "nouveau", C: "conflit" };

// Force d'un statut pour un dossier : C, puis D, M, A, U. R compte comme M.
const FORCE = ["C", "D", "M", "A", "U"];
const pourDossier = (lettre) => (lettre === "R" ? "M" : lettre);

/**
 * Statuts git par chemin, d'après les `changements` de l'état git (`{ chemin, lettre }`).
 * Rend une `Map` chemin -> `{ lettre, mot }` : celle du fichier, et pour chaque dossier parent
 * la lettre la plus forte de son contenu. Un fichier supprimé compte pour ses dossiers.
 */
export function statutsDe(changements) {
  const statuts = new Map();
  for (const { chemin, lettre } of changements) {
    statuts.set(chemin, { lettre, mot: MOTS[lettre] });
    const parts = chemin.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dossier = parts.slice(0, i).join("/");
      const nouvelle = pourDossier(lettre);
      const avant = statuts.get(dossier)?.lettre;
      if (avant === undefined || FORCE.indexOf(nouvelle) < FORCE.indexOf(avant)) {
        statuts.set(dossier, { lettre: nouvelle, mot: MOTS[nouvelle] });
      }
    }
  }
  return statuts;
}
