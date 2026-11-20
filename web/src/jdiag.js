// Format `.jdiag` (REQ-132) : lecture, écriture et petits calculs sur le document d'un whiteboard.

const CLES_BOITE = ["id", "x", "y", "width", "height", "text"];
const CLES_LIEN = ["id", "from", "to"];
const CLES_LIBRE = ["id", "x1", "y1", "x2", "y2"];
const ENTIERS = new Set(["x", "y", "width", "height", "x1", "y1", "x2", "y2"]);

// Clés de style : la première valeur est celle par défaut.
const COULEURS = ["default", "blue", "green", "yellow", "orange", "red", "purple"];
const TRAITS = ["solid", "dashed", "dotted"];
const EPAISSEURS = ["thin", "medium", "thick"];
// Les vingt symboles (REQ-149), dans l'ordre du dialogue « Symboles ».
export const SYMBOLES = [
  { shape: "database", nom: "Base de données" },
  { shape: "pipe", nom: "Tuyau" },
  { shape: "person", nom: "Personne" },
  { shape: "people", nom: "Groupe de personnes" },
  { shape: "secure", nom: "Sécurisé" },
  { shape: "insecure", nom: "Non sécurisé" },
  { shape: "check", nom: "Validé" },
  { shape: "failure", nom: "Échec" },
  { shape: "network", nom: "Réseau" },
  { shape: "wifi", nom: "Wi-Fi" },
  { shape: "ethernet", nom: "Ethernet" },
  { shape: "server", nom: "Serveur" },
  { shape: "cloud", nom: "Nuage" },
  { shape: "computer", nom: "Ordinateur" },
  { shape: "phone", nom: "Téléphone" },
  { shape: "file", nom: "Fichier" },
  { shape: "mail", nom: "Courriel" },
  { shape: "settings", nom: "Réglages" },
  { shape: "warning", nom: "Alerte" },
  { shape: "firewall", nom: "Pare-feu" },
];
const STYLE_BOITE = {
  shape: ["rectangle", "rounded", "ellipse", "diamond", "note", "text", ...SYMBOLES.map((s) => s.shape)],
  color: COULEURS,
  line: TRAITS,
  weight: EPAISSEURS,
  opacity: [100, 75, 50, 25, 0],
  textSize: ["normal", "small", "large", "xlarge"],
  align: ["center", "left", "right"],
  valign: ["middle", "top", "bottom"],
};
const STYLE_TRAIT = { route: ["direct", "orthogonal", "curved"], ends: ["end", "none", "start", "both"], line: TRAITS, color: COULEURS, weight: EPAISSEURS };
const STYLES_PARTIE = ["bold", "italic", "underline", "strike"];
const TAILLES_TEXTE = STYLE_BOITE.textSize;
const NOMS_SYMBOLES = new Set(SYMBOLES.map((s) => s.shape));

// Valeur par défaut d'une clé de style d'une boîte : la première, sauf `valign` d'un symbole (REQ-150).
function defautBoite(objet, cle, valeurs) {
  return cle === "valign" && NOMS_SYMBOLES.has(objet.shape) ? "top" : valeurs[0];
}

// Position effective du texte d'une boîte : `{ align, valign }`, défaut de sa forme compris (REQ-150).
export function positionTexte(boite) {
  return {
    align: boite.align ?? STYLE_BOITE.align[0],
    valign: boite.valign ?? defautBoite(boite, "valign", STYLE_BOITE.valign),
  };
}
const COTES = ["top", "right", "bottom", "left", "center"];

function estObjet(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function typeOk(cle, v) {
  if (ENTIERS.has(cle)) return Number.isInteger(v);
  return typeof v === "string";
}

function copier(objet, cles, styles, defaut = (o, c, v) => v[0]) {
  if (!estObjet(objet)) return null;
  const copie = {};
  for (const cle of cles) {
    if (!typeOk(cle, objet[cle])) return null;
    copie[cle] = objet[cle];
  }
  for (const [cle, valeurs] of Object.entries(styles)) {
    const v = objet[cle] === undefined ? defaut(copie, cle, valeurs) : objet[cle];
    if (!valeurs.includes(v)) return null;
    copie[cle] = v;
  }
  return copie;
}

function longueur(texte) {
  return Array.from(texte).length;
}

// Parties du texte d'un objet → liste normalisée (triée, parties qui se touchent avec les mêmes styles
// fondues, styles par défaut et parties sans style retirés), ou `null` si la liste est refusée.
// Une partie : `start`, `end` (en caractères Unicode, fin exclue), puis les styles non par défaut.
export function normaliserSpans(text, spans) {
  if (spans === undefined) return [];
  if (!Array.isArray(spans)) return null;
  const fin = longueur(text);
  const parties = [];
  for (const p of spans) {
    if (!estObjet(p) || !Number.isInteger(p.start) || !Number.isInteger(p.end)) return null;
    if (p.start < 0 || p.start >= p.end || p.end > fin) return null;
    const partie = { start: p.start, end: p.end };
    for (const cle of STYLES_PARTIE) {
      if (p[cle] === undefined) continue;
      if (typeof p[cle] !== "boolean") return null;
      if (p[cle]) partie[cle] = true;
    }
    if (p.color !== undefined) {
      if (!COULEURS.includes(p.color)) return null;
      if (p.color !== COULEURS[0]) partie.color = p.color;
    }
    parties.push(partie);
  }
  parties.sort((a, b) => a.start - b.start);
  const sortie = [];
  let precedent = null;
  for (const p of parties) {
    if (precedent && p.start < precedent.end) return null;
    if (Object.keys(p).length === 2) {
      precedent = p;
      continue;
    }
    const dernier = sortie[sortie.length - 1];
    const memes = (a, b) => [...STYLES_PARTIE, "color"].every((c) => a[c] === b[c]);
    if (dernier && dernier.end === p.start && memes(dernier, p)) dernier.end = p.end;
    else sortie.push({ ...p });
    precedent = p;
  }
  return sortie;
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
    const boite = copier(b, CLES_BOITE, STYLE_BOITE, defautBoite);
    if (!boite || ids.has(boite.id)) return null;
    boite.spans = normaliserSpans(boite.text, b.spans);
    if (!boite.spans) return null;
    ids.add(boite.id);
    boxes.push(boite);
  }
  const idsBoites = new Set(ids);
  const links = [];
  for (const l of brut.links) {
    const lien = copier(l, CLES_LIEN, STYLE_TRAIT);
    if (!lien || ids.has(lien.id) || !lireCotes(l, lien)) return null;
    lien.text = l.text === undefined ? "" : l.text;
    lien.textSize = l.textSize === undefined ? TAILLES_TEXTE[0] : l.textSize;
    if (typeof lien.text !== "string" || !TAILLES_TEXTE.includes(lien.textSize)) return null;
    lien.spans = normaliserSpans(lien.text, l.spans);
    if (!lien.spans) return null;
    if (/^\s*$/.test(lien.text)) {
      lien.text = "";
      lien.spans = [];
    }
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
function clesEcrites(objet, requises, styles, cotes, defaut = (o, c, v) => v[0]) {
  const cles = [...requises];
  for (const cle of Object.keys(styles)) {
    if (objet[cle] !== undefined && objet[cle] !== defaut(objet, cle, styles[cle])) cles.push(cle);
  }
  if (cotes && objet.fromSide && objet.toSide) {
    cles.splice(requises.length, 0, "fromSide", "toSide");
  }
  return cles;
}

// Les parties s'écrivent sur la ligne de leur objet : `{"start": 0, "end": 5, "bold": true}`.
function valeur(cle, v) {
  if (cle !== "spans") return JSON.stringify(v);
  return "[" + v.map((p) => "{" + Object.entries(p).map(([c, x]) => `${JSON.stringify(c)}: ${JSON.stringify(x)}`).join(", ") + "}").join(", ") + "]";
}

function ligne(objet, cles) {
  return "    {" + cles.map((c) => `${JSON.stringify(c)}: ${valeur(c, objet[c])}`).join(", ") + "}";
}

function liste(nom, objets) {
  if (objets.length === 0) return `  "${nom}": []`;
  return `  "${nom}": [\n${objets.join(",\n")}\n  ]`;
}

function spansEcrits(o) {
  const spans = normaliserSpans(o.text ?? "", o.spans ?? []);
  if (!spans) throw new Error("ecrireJdiag : parties du texte invalides");
  return { ...o, spans };
}

function ligneBoite(o) {
  const b = spansEcrits(o);
  const cles = clesEcrites(b, CLES_BOITE, STYLE_BOITE, false, defautBoite);
  if (b.spans.length > 0) cles.splice(CLES_BOITE.length, 0, "spans");
  return ligne(b, cles);
}

function ligneLien(o) {
  const l = spansEcrits(o);
  const cles = clesEcrites(l, CLES_LIEN, STYLE_TRAIT, true);
  const texte = !/^\s*$/.test(l.text ?? "");
  if (texte) cles.push("text");
  if (texte && l.spans.length > 0) cles.push("spans");
  if (l.textSize !== undefined && l.textSize !== TAILLES_TEXTE[0]) cles.push("textSize");
  return ligne(l, cles);
}

// Document → texte du fichier, toujours écrit de la même façon.
export function ecrireJdiag(doc) {
  const boites = doc.boxes.map(ligneBoite);
  const liens = doc.links.map(ligneLien);
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
