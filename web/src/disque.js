// Règles des changements sur le disque (REQ-017, DEC-019).

/**
 * Que faire d'un fichier ouvert, d'après sa lecture sur le disque.
 * `ouvert` : `{ disque, version, modifie }` (texte de base, version de base, texte modifié ou non).
 * `lecture` : réponse de `lireFichier`.
 * Rend "rien", "adopter" (seule la date a changé : on prend la nouvelle version), "recharger",
 * "demander" (garder sa version ou prendre celle du disque) ou "supprime".
 */
export function decisionDisque(ouvert, lecture) {
  if (lecture.cause === "introuvable") return "supprime";
  if (lecture.contenu === undefined) return "rien";
  if (lecture.version === ouvert.version) return "rien";
  if (lecture.contenu === ouvert.disque) return "adopter";
  return ouvert.modifie ? "demander" : "recharger";
}
