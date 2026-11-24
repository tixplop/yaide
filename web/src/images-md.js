// Image `![[nom]]` d'un document markdown (REQ-175) : quel fichier du projet la balise désigne.

const FORMATS = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
const SCHEMA = /^[a-z][a-z0-9+.-]*:/i;

// Chemin sans `.` ni `..` ; les `..` de tête restent (document d'un autre worktree).
function normaliser(chemin) {
  const sortie = [];
  for (const s of chemin.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === ".." && sortie.length && sortie.at(-1) !== "..") sortie.pop();
    else sortie.push(s);
  }
  return sortie.join("/");
}

/**
 * Chemin du fichier désigné par `nom`, ou null (balise laissée en texte).
 * `chemins` : liste des fichiers du projet, ou null tant qu'elle manque.
 */
export function resoudreImage(nom, document, chemins) {
  const ecrit = String(nom).trim();
  if (!ecrit || ecrit.includes("|") || ecrit.startsWith("//") || SCHEMA.test(ecrit) || !FORMATS.test(ecrit)) return null;
  const dossier = String(document ?? "").split("/").slice(0, -1).join("/");
  const voisin = normaliser(dossier ? `${dossier}/${ecrit}` : ecrit);
  if (!voisin || voisin.startsWith("/")) return null;
  if (String(document ?? "").startsWith("../")) return voisin; // autre worktree : son dossier seulement, le serveur dira s'il existe
  if (!chemins) return null;
  if (chemins.includes(voisin)) return voisin;
  if (ecrit.split("/").includes("..")) return null;
  const sans = ecrit.replace(/^(\.\/)+/, "");
  const trouves = chemins.filter((c) => c === sans || c.endsWith("/" + sans));
  trouves.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return trouves[0] ?? null;
}
