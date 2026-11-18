// Format `.jdiag` (REQ-132) : lecture, écriture et petits calculs sur le document d'un whiteboard.

const CLES_BOITE = ["id", "x", "y", "width", "height", "text"];
const CLES_LIEN = ["id", "from", "to"];
const CLES_LIBRE = ["id", "x1", "y1", "x2", "y2"];
const ENTIERS = new Set(["x", "y", "width", "height", "x1", "y1", "x2", "y2"]);

// Clés de style : la première valeur est celle par défaut.
const COULEURS = ["default", "blue", "green", "yellow", "orange", "red", "purple"];
const TRAITS = ["solid", "dashed", "dotted"];
const EPAISSEURS = ["thin", "medium", "thick"];
const STYLE_BOITE = {
  shape: ["rectangle", "rounded", "ellipse", "diamond", "note", "text"],
  color: COULEURS,
  line: TRAITS,
  weight: EPAISSEURS,
  opacity: [100, 75, 50, 25, 0],
  textSize: ["normal", "small", "large", "xlarge"],
};
const STYLE_TRAIT = { route: ["direct", "orthogonal", "curved"], ends: ["end", "none", "start", "both"], line: TRAITS, color: COULEURS, weight: EPAISSEURS };
const COTES = ["top", "right", "bottom", "left", "center"];

function estObjet(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function typeOk(cle, v) {
  if (ENTIERS.has(cle)) return Number.isInteger(v);
  return typeof v === "string";
}

function copier(objet, cles, styles) {
  if (!estObjet(objet)) return null;
  const copie = {};
  for (const cle of cles) {
    if (!typeOk(cle, objet[cle])) return null;
    copie[cle] = objet[cle];
  }
  for (const [cle, valeurs] of Object.entries(styles)) {
    const v = objet[cle] === undefined ? valeurs[0] : objet[cle];
    if (!valeurs.includes(v)) return null;
    copie[cle] = v;
  }
  return copie;
}

function lireCotes(objet, copie) {
  const de = objet.fromSide;
  const vers = objet.toSide;
  if (de === undefined && vers === undefined) {
    copie.fromSide = null;
    copie.toSide = null;
    return true;
  }
  if (!COTES.includes(de) || !COTES.includes(vers)) return false;
  copie.fromSide = de;
  copie.toSide = vers;
  return true;
}

// Texte du fichier → `{ version, boxes, links, arrows }`, ou `null` si ce n'est pas un whiteboard lisible.
// Un texte vide donne un whiteboard vide ; les clés inconnues sont ignorées ; une clé de style absente
// prend sa valeur par défaut.
export function lireJdiag(texte) {
  if (typeof texte !== "string") return null;
  if (texte.trim() === "") return { version: 1, boxes: [], links: [], arrows: [] };
  let brut;
  try {
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!estObjet(brut) || brut.version !== 1) return null;
  if (!Array.isArray(brut.boxes) || !Array.isArray(brut.links)) return null;
  if (brut.arrows !== undefined && !Array.isArray(brut.arrows)) return null;
  const ids = new Set();
  const boxes = [];
  for (const b of brut.boxes) {
    const boite = copier(b, CLES_BOITE, STYLE_BOITE);
    if (!boite || ids.has(boite.id)) return null;
    ids.add(boite.id);
    boxes.push(boite);
  }
  const idsBoites = new Set(ids);
  const links = [];
  for (const l of brut.links) {
    const lien = copier(l, CLES_LIEN, STYLE_TRAIT);
    if (!lien || ids.has(lien.id) || !lireCotes(l, lien)) return null;
    ids.add(lien.id);
    if (!idsBoites.has(lien.from) || !idsBoites.has(lien.to)) return null;
    links.push(lien);
  }
  const arrows = [];
  for (const a of brut.arrows ?? []) {
    const fleche = copier(a, CLES_LIBRE, STYLE_TRAIT);
    if (!fleche || ids.has(fleche.id)) return null;
    ids.add(fleche.id);
    arrows.push(fleche);
  }
  return { version: 1, boxes, links, arrows };
}

// Clés à écrire : les requises, puis chaque clé facultative qui diffère de sa valeur par défaut.
function clesEcrites(objet, requises, styles, cotes) {
  const cles = [...requises];
  for (const cle of Object.keys(styles)) {
    if (objet[cle] !== undefined && objet[cle] !== styles[cle][0]) cles.push(cle);
  }
  if (cotes && objet.fromSide && objet.toSide) {
    cles.splice(requises.length, 0, "fromSide", "toSide");
  }
  return cles;
}

function ligne(objet, cles) {
  return "    {" + cles.map((c) => `${JSON.stringify(c)}: ${JSON.stringify(objet[c])}`).join(", ") + "}";
}

function liste(nom, objets) {
  if (objets.length === 0) return `  "${nom}": []`;
  return `  "${nom}": [\n${objets.join(",\n")}\n  ]`;
}

// Document → texte du fichier, toujours écrit de la même façon.
export function ecrireJdiag(doc) {
  const boites = doc.boxes.map((o) => ligne(o, clesEcrites(o, CLES_BOITE, STYLE_BOITE, false)));
  const liens = doc.links.map((o) => ligne(o, clesEcrites(o, CLES_LIEN, STYLE_TRAIT, true)));
  const parties = [liste("boxes", boites), liste("links", liens)];
  const libres = (doc.arrows ?? []).map((o) => ligne(o, clesEcrites(o, CLES_LIBRE, STYLE_TRAIT, false)));
  if (libres.length > 0) parties.push(liste("arrows", libres));
  return `{\n  "version": 1,\n${parties.join(",\n")}\n}\n`;
}

// Plus petit `b<n>`, `l<n>` ou `a<n>` (n ≥ 1) qui n'est pas pris.
export function idLibre(prefixe, doc) {
  if (prefixe !== "b" && prefixe !== "l" && prefixe !== "a") throw new Error("idLibre : préfixe « b », « l » ou « a » attendu");
  const pris = new Set([...doc.boxes, ...doc.links, ...(doc.arrows ?? [])].map((o) => o.id));
  let n = 1;
  while (pris.has(prefixe + n)) n++;
  return prefixe + n;
}

// Ajoute `.jdiag` au chemin s'il manque (casse ignorée).
export function avecExtensionJdiag(chemin) {
  return /\.jdiag$/i.test(chemin) ? chemin : chemin + ".jdiag";
}
