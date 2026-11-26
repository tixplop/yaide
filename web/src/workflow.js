// Modèle du document d'un workflow (DEC-127), sans DOM : fonctions pures qui rendent un nouveau document.
// Un nœud : { id, type, titre, x, y, reglages } ; un lien : { de, vers }.

export const LARGEUR_NOEUD = 240;
export const HAUTEUR_NOEUD = 56;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

export const TYPES = {
  dossier: { nom: "Fichiers d'un dossier", genre: "declencheur", icone: "folder-search", phrase: "Un fichier y est créé, modifié ou supprimé." },
  planification: { nom: "Planification", genre: "declencheur", icone: "clock", phrase: "À heures fixes, selon une expression cron." },
  appel: { nom: "Appel par un agent", genre: "declencheur", icone: "webhook", phrase: "Un agent le lance avec l'outil run_workflow." },
  agent: { nom: "Agent", genre: "action", icone: "bot-message-square", phrase: "Envoie un message à un agent du projet." },
  shell: { nom: "Commande shell", genre: "action", icone: "square-terminal", phrase: "Lance une commande dans le projet." },
  claude: { nom: "Session Claude", genre: "action", icone: "square-asterisk", phrase: "Confie une demande à Claude Code." },
  fichier: { nom: "Fichier", genre: "action", icone: "file-cog", phrase: "Lit, écrit, copie, déplace ou supprime un fichier." },
};

/** Réglages d'un nœud neuf : le dossier surveillé vide et ses trois évènements cochés, « Lire » pour un fichier. */
const REGLAGES_NEUFS = {
  dossier: () => ({ dossier: "", evenements: ["cree", "modifie", "supprime"] }),
  fichier: () => ({ operation: "lire" }),
};

export const estDeclencheur = (n) => TYPES[n.type]?.genre === "declencheur";

function trouver(doc, id) {
  return doc.noeuds.find((n) => n.id === id);
}

/** Id du nœud qui précède `id` (le lien d'entrée), ou null. */
export function apresDe(doc, id) {
  return doc.liens.find((l) => l.vers === id)?.de ?? null;
}

/** Vrai si `de` est atteignable depuis `depuis` en suivant les liens. */
function atteint(doc, depuis, de) {
  const vus = new Set();
  const pile = [depuis];
  while (pile.length) {
    const c = pile.pop();
    if (c === de) return true;
    if (vus.has(c)) continue;
    vus.add(c);
    for (const l of doc.liens) if (l.de === c) pile.push(l.vers);
  }
  return false;
}

/** Un lien de `de` vers `vers` est-il permis (entrée d'action, pas de boucle) ? */
export function lienPermis(doc, de, vers) {
  const a = trouver(doc, de);
  const b = trouver(doc, vers);
  if (!a || !b || de === vers || estDeclencheur(b)) return false;
  return !atteint(doc, vers, de);
}

/** Nœuds proposés par « Après » pour `id` : ceux qui ne feraient pas de boucle. */
export function noeudsPermisApres(doc, id) {
  return doc.noeuds.filter((n) => lienPermis(doc, n.id, id));
}

/** Lien de `de` vers `vers`, qui remplace l'entrée de `vers` ; le même document si refusé. */
export function lier(doc, de, vers) {
  if (!lienPermis(doc, de, vers)) return doc;
  return { ...doc, liens: [...doc.liens.filter((l) => l.vers !== vers), { de, vers }] };
}

/** Retire le lien d'entrée de `vers` (« Après » à « Aucun »). */
export function delier(doc, vers) {
  return { ...doc, liens: doc.liens.filter((l) => l.vers !== vers) };
}

export function retirer(doc, id) {
  return { ...doc, noeuds: doc.noeuds.filter((n) => n.id !== id), liens: doc.liens.filter((l) => l.de !== id && l.vers !== id) };
}

export function deplacer(doc, id, x, y) {
  return { ...doc, noeuds: doc.noeuds.map((n) => (n.id === id ? { ...n, x, y } : n)) };
}

function titreLibre(doc, type) {
  const nom = TYPES[type].nom;
  const pris = new Set(doc.noeuds.map((n) => n.titre));
  let k = 1;
  while (pris.has(`${nom} ${k}`)) k++;
  return `${nom} ${k}`;
}

function idLibre(doc) {
  let max = 0;
  for (const n of doc.noeuds) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

const recouvre = (doc, x, y) =>
  doc.noeuds.some((n) => Math.abs(n.x - x) < LARGEUR_NOEUD && Math.abs(n.y - y) < HAUTEUR_NOEUD);

/** Place d'un nœud ajouté par clic ou Entrée (C-019) ; `vue` situe le coin haut gauche de l'écran. */
export function placeAjout(doc, apres, vue = { x: 0, y: 0, zoom: 1 }) {
  const z = vue.zoom || 1;
  let x;
  let y;
  const prec = apres ? trouver(doc, apres) : null;
  if (prec) {
    x = prec.x + LARGEUR_NOEUD + 64;
    y = prec.y;
  } else if (doc.noeuds.length) {
    x = doc.noeuds[0].x;
    y = Math.max(...doc.noeuds.map((n) => n.y)) + HAUTEUR_NOEUD + 32;
  } else {
    x = (40 - vue.x) / z;
    y = (40 - vue.y) / z;
  }
  while (recouvre(doc, x, y)) y += 88;
  return { x, y };
}

/** Ajoute un nœud de `type` ; relié après `apres` pour une action. Rend { doc, id }. */
export function ajouter(doc, type, { apres = null, position = null, vue } = {}) {
  if (!Object.hasOwn(TYPES, type)) throw new Error(`workflow : type inconnu « ${type} »`);
  const action = TYPES[type].genre === "action";
  const de = action && apres && trouver(doc, apres) ? apres : null;
  const { x, y } = position ?? placeAjout(doc, de, vue);
  const id = idLibre(doc);
  const noeud = { id, type, titre: titreLibre(doc, type), x, y, reglages: REGLAGES_NEUFS[type]?.() ?? {} };
  let suite = { ...doc, noeuds: [...doc.noeuds, noeud] };
  if (de) suite = lier(suite, de, id);
  return { doc: suite, id };
}

/** Phrase lue pour un nœud choisi. */
export function phraseDuChoix(doc, id) {
  const n = trouver(doc, id);
  if (!n) return "";
  if (estDeclencheur(n)) return `${n.titre}, déclencheur.`;
  const p = apresDe(doc, id);
  return `${n.titre}, action, après ${p ? trouver(doc, p).titre : "aucun nœud"}.`;
}

/** Zoom d'un cran (+1 ou -1) autour du point (cx, cy) de la surface. */
export function zoomer(vue, sens, cx = 0, cy = 0) {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((vue.zoom + sens * 0.1) * 100) / 100));
  const k = z / vue.zoom;
  return { x: cx - (cx - vue.x) * k, y: cy - (cy - vue.y) * k, zoom: z };
}

/** Déplace la vue juste assez pour montrer le nœud entier, à 24 px du bord au moins. */
export function montrer(vue, noeud, largeur, hauteur) {
  const z = vue.zoom;
  return { ...vue, x: vue.x + shift(noeud.x, LARGEUR_NOEUD, vue.x, z, largeur), y: vue.y + shift(noeud.y, HAUTEUR_NOEUD, vue.y, z, hauteur) };
}

function shift(pos, taille, dec, z, dim) {
  const a = pos * z + dec;
  const b = a + taille * z;
  if (a < 24) return 24 - a;
  if (b > dim - 24) return Math.max(24 - a, dim - 24 - b);
  return 0;
}

/** Vue qui cadre tous les nœuds dans une surface de `largeur` × `hauteur`, sans dépasser 100 % ; sans nœud, la vue de départ. */
export function cadrer(doc, largeur, hauteur) {
  if (!doc.noeuds.length || !largeur || !hauteur) return { x: 0, y: 0, zoom: 1 };
  const x0 = Math.min(...doc.noeuds.map((n) => n.x));
  const y0 = Math.min(...doc.noeuds.map((n) => n.y));
  const w = Math.max(...doc.noeuds.map((n) => n.x + LARGEUR_NOEUD)) - x0;
  const h = Math.max(...doc.noeuds.map((n) => n.y + HAUTEUR_NOEUD)) - y0;
  const zoom = Math.min(1, Math.max(ZOOM_MIN, Math.min((largeur - 48) / w, (hauteur - 48) / h)));
  return { x: (largeur - w * zoom) / 2 - x0 * zoom, y: (hauteur - h * zoom) / 2 - y0 * zoom, zoom };
}
