// Règles du texte gardé dans le navigateur et des sauvegardes en attente pendant une coupure.

/**
 * Que faire d'un onglet gardé, d'après la lecture du fichier sur le disque :
 * "creer" (le fichier se lit), "reessayer" (le serveur n'a pas répondu : on ne perd rien),
 * sinon (disparu, trop gros, binaire, droits…) "recreer" si du texte est gardé, "ecarter" si non.
 */
export function decider(garde, lecture) {
  if (lecture.contenu !== undefined) return "creer";
  if (lecture.coupure) return "reessayer";
  return typeof garde.texte === "string" ? "recreer" : "ecarter";
}

/** Phrase ajoutée au bandeau de coupure pour les fichiers dont Ctrl+S attend le retour. */
export function texteAttente(noms) {
  if (noms.length === 0) return "";
  if (noms.length === 1) return `${noms[0]} sera sauvegardé au retour.`;
  return `${noms.length} fichiers seront sauvegardés au retour.`;
}
