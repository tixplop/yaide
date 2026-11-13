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

// Liens d'un document markdown (REQ-101).

const SCHEMA = /^([a-z][a-z0-9+.-]*):(?!\d+(?::\d+)?$)/i;

function decoder(texte) {
  try {
    return decodeURIComponent(texte);
  } catch {
    return texte;
  }
}

/**
 * `adresse` : celle du lien ; `cheminDocument` : chemin du document depuis le projet ; `projet` : chemin absolu du projet.
 * Rend `{ sorte: "fichier", ecrit, chemin, ligne, ancre }`, `{ sorte: "ancre", ancre }`, `{ sorte: "web", adresse }`, ou `null`.
 */
export function lienDeDocument(adresse, cheminDocument, projet) {
  if (typeof adresse !== "string") return null;
  adresse = adresse.trim();
  if (adresse === "") return null;
  const schema = SCHEMA.exec(adresse);
  if (schema) {
    const nom = schema[1].toLowerCase();
    if (nom === "http" || nom === "https" || nom === "mailto") return { sorte: "web", adresse };
    if (nom !== "file") return null;
    adresse = adresse.slice(adresse.startsWith("file://") ? 7 : 5);
  }
  const diese = adresse.indexOf("#");
  const fragment = diese < 0 ? "" : decoder(adresse.slice(diese + 1));
  let chemin = diese < 0 ? adresse : adresse.slice(0, diese);
  if (chemin === "") return fragment === "" ? null : { sorte: "ancre", ancre: fragment };
  let ligne = null;
  let ancre = null;
  const suffixe = /:(\d+)(?::\d+)?$/.exec(chemin);
  if (suffixe) {
    ligne = Number(suffixe[1]);
    chemin = chemin.slice(0, suffixe.index);
  }
  const ligneFragment = /^L(\d+)(?:-L\d+)?$/.exec(fragment);
  if (ligneFragment) ligne = Number(ligneFragment[1]);
  else if (fragment !== "") ancre = fragment;
  const ecrit = decoder(chemin);
  let depuis;
  if (ecrit.startsWith("/")) depuis = depuisProjet(ecrit, projet);
  else {
    const dossier = (cheminDocument ?? "").split("/").slice(0, -1).join("/");
    depuis = depuisProjet(dossier === "" ? ecrit : `${dossier}/${ecrit}`, projet);
  }
  return { sorte: "fichier", ecrit, chemin: depuis, ligne, ancre };
}

/** Identifiant d'un titre, comme GitHub : minuscules, ponctuation retirée sauf `-` et `_`, espaces en `-`. */
export function identifiantTitre(texte) {
  return texte
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|~~|`/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Numéro (1…) de la ligne du premier titre dont l'identifiant est `ancre`, hors blocs de code clôturés ; `null` sinon. */
export function ligneDuTitre(markdown, ancre) {
  const lignes = markdown.split("\n");
  let cloture = null;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    const ouverture = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (cloture) {
      if (ouverture && ouverture[1][0] === cloture[0] && ouverture[1].length >= cloture.length && /^ {0,3}[`~]+\s*$/.test(l)) cloture = null;
      continue;
    }
    if (ouverture) {
      cloture = ouverture[1];
      continue;
    }
    const atx = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(l);
    if (atx && identifiantTitre(atx[1]) === ancre) return i + 1;
    if (!atx && /^ {0,3}[^\s#>\-*+=`~|]/.test(l) && i + 1 < lignes.length && /^ {0,3}(=+|-+)[ \t]*$/.test(lignes[i + 1]) && identifiantTitre(l) === ancre) return i + 1;
  }
  return null;
}

export function estMac() {
  const plateforme = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || "";
  return /^mac/i.test(plateforme);
}
