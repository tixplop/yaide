// Lecture des fichiers et dossiers d'un collage venu de l'explorateur du bureau (REQ-180, DEC-118).

export const REFUS_LECTURE = "il n'a pas pu être lu";
export const REFUS_CONTENU = "le navigateur n'a pas donné son contenu";

const lireLot = (lecteur) => new Promise((ok, ko) => lecteur.readEntries(ok, ko));
const fichierDe = (entree) => new Promise((ok, ko) => entree.file(ok, ko));

/** Les entrées d'un dossier, lot après lot jusqu'à une liste vide. */
async function entreesDe(entree) {
  const lecteur = entree.createReader();
  const toutes = [];
  for (;;) {
    const lot = await lireLot(lecteur);
    if (lot.length === 0) return toutes;
    toutes.push(...lot);
  }
}

/** Un nœud : `{ nom, dossier: false, fichier }`, `{ nom, dossier: true, enfants }` ou, s'il est illisible, `{ nom, dossier, refus }`. */
async function noeud(entree) {
  const nom = entree.name;
  if (entree.isDirectory) {
    try {
      const enfants = await Promise.all((await entreesDe(entree)).map(noeud));
      return { nom, dossier: true, enfants };
    } catch {
      return { nom, dossier: true, refus: REFUS_CONTENU };
    }
  }
  try {
    return { nom, dossier: false, fichier: await fichierDe(entree) };
  } catch {
    return { nom, dossier: false, refus: REFUS_LECTURE };
  }
}

/**
 * Lit les éléments (`DataTransferItem`) d'un collage : l'arbre des éléments du premier niveau.
 * Chaque `webkitGetAsEntry()` est appelé avant le premier `await` : après l'événement, les éléments ne sont plus lisibles.
 */
export function lireElements(items) {
  const lus = [...items]
    .filter((it) => it.kind === "file")
    .map((it) => {
      const entree = it.webkitGetAsEntry?.() ?? null;
      return { entree, direct: entree ? null : (it.getAsFile?.() ?? null) };
    });
  return Promise.all(
    lus
      .filter(({ entree, direct }) => entree || direct) // ni entrée ni fichier : rien à nommer, l'élément est ignoré
      .map(async ({ entree, direct }) => (entree ? noeud(entree) : { nom: direct.name, dossier: false, fichier: direct })),
  );
}
