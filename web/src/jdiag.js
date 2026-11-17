// Format `.jdiag` (REQ-132) : lecture, écriture et petits calculs sur le document d'un whiteboard.

const CLES_BOITE = ["id", "x", "y", "width", "height", "text"];
const CLES_FLECHE = ["id", "from", "to"];

function estObjet(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function typeOk(cle, v) {
  if (cle === "x" || cle === "y" || cle === "width" || cle === "height") return Number.isInteger(v);
  return typeof v === "string";
}

function copier(objet, cles) {
  if (!estObjet(objet)) return null;
  const copie = {};
  for (const cle of cles) {
    if (!typeOk(cle, objet[cle])) return null;
    copie[cle] = objet[cle];
  }
  return copie;
}

// Texte du fichier → `{ version, boxes, links }`, ou `null` si ce n'est pas un whiteboard lisible.
// Un texte vide donne un whiteboard vide ; les clés inconnues sont ignorées.
export function lireJdiag(texte) {
  if (typeof texte !== "string") return null;
  if (texte.trim() === "") return { version: 1, boxes: [], links: [] };
  let brut;
  try {
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!estObjet(brut) || brut.version !== 1) return null;
  if (!Array.isArray(brut.boxes) || !Array.isArray(brut.links)) return null;
  const ids = new Set();
  const boxes = [];
  for (const b of brut.boxes) {
    const boite = copier(b, CLES_BOITE);
    if (!boite || ids.has(boite.id)) return null;
    ids.add(boite.id);
    boxes.push(boite);
  }
  const idsBoites = new Set(ids);
  const links = [];
  for (const l of brut.links) {
    const fleche = copier(l, CLES_FLECHE);
    if (!fleche || ids.has(fleche.id)) return null;
    ids.add(fleche.id);
    if (!idsBoites.has(fleche.from) || !idsBoites.has(fleche.to)) return null;
    links.push(fleche);
  }
  return { version: 1, boxes, links };
}

function ligne(objet, cles) {
  return "    {" + cles.map((c) => `${JSON.stringify(c)}: ${JSON.stringify(objet[c])}`).join(", ") + "}";
}

function liste(nom, objets, cles) {
  if (objets.length === 0) return `  "${nom}": []`;
  return `  "${nom}": [\n${objets.map((o) => ligne(o, cles)).join(",\n")}\n  ]`;
}

// Document → texte du fichier, toujours écrit de la même façon.
export function ecrireJdiag(doc) {
  return `{\n  "version": 1,\n${liste("boxes", doc.boxes, CLES_BOITE)},\n${liste("links", doc.links, CLES_FLECHE)}\n}\n`;
}

// Plus petit `b<n>` ou `l<n>` (n ≥ 1) qui n'est pas pris.
export function idLibre(prefixe, doc) {
  if (prefixe !== "b" && prefixe !== "l") throw new Error("idLibre : préfixe « b » ou « l » attendu");
  const pris = new Set([...doc.boxes, ...doc.links].map((o) => o.id));
  let n = 1;
  while (pris.has(prefixe + n)) n++;
  return prefixe + n;
}

// Ajoute `.jdiag` au chemin s'il manque (casse ignorée).
export function avecExtensionJdiag(chemin) {
  return /\.jdiag$/i.test(chemin) ? chemin : chemin + ".jdiag";
}
