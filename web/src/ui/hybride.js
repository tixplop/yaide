import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { rendreMarkdown } from "./apercu.js";
import { estMac, lienDeDocument } from "../references.js";
import { bouton } from "./bouton.js";
import { chargerMermaid, adresseDiagramme, dessinConnu, dessinerTexte } from "./diagramme.js";

// Mode hybride (REQ-062, DEC-041) : le markdown est mis en forme dans l'éditeur, d'après l'arbre de
// @codemirror/lang-markdown. Les marques sont retirées du DOM, sauf sur les lignes que touche la sélection.

// Widget sans contenu pour un lecteur d'écran : la puce « • » et le trait.
class Ornement extends WidgetType {
  constructor(genre) {
    super();
    this.genre = genre;
  }
  eq(autre) {
    return autre.genre === this.genre;
  }
  toDOM() {
    const s = document.createElement("span");
    s.setAttribute("aria-hidden", "true");
    if (this.genre === "puce") {
      s.className = "cm-hy-puce";
      s.textContent = "•";
    } else s.className = "cm-hy-trait";
    return s;
  }
}

const TITRES = { ATXHeading1: 1, ATXHeading2: 2, ATXHeading3: 3, ATXHeading4: 4, ATXHeading5: 5, ATXHeading6: 6, SetextHeading1: 1, SetextHeading2: 2 };
const STYLES = { StrongEmphasis: ["EmphasisMark", "cm-hy-gras"], Emphasis: ["EmphasisMark", "cm-hy-italique"], Strikethrough: ["StrikethroughMark", "cm-hy-barre"] };

// Liste des décorations d'un état, sur les seules plages données (tout le document par défaut) :
//   { debut, fin, ligne: true, classe }     décoration de ligne (debut = début de la ligne)
//   { debut, fin, classe }                  style posé sur le texte
//   { debut, fin, masque: true }            marque retirée du DOM
//   { debut, fin, widget: "puce" | "trait" } marque remplacée par un ornement
export function decorationsHybride(etat, plages = [{ from: 0, to: etat.doc.length }]) {
  const doc = etat.doc;
  const sortie = [];
  const lignesVues = new Set();
  const actives = new Set();
  for (const r of etat.selection.ranges) for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) actives.add(n);
  const touche = (de, a) => {
    for (let n = doc.lineAt(de).number; n <= doc.lineAt(a).number; n++) if (actives.has(n)) return true;
    return false;
  };
  const style = (debut, fin, classe) => {
    if (fin > debut) sortie.push({ debut, fin, classe });
  };
  // Marque : retirée, sauf sur une ligne active (ou si elle contient un saut de ligne) où elle reste en --ink-muted.
  const marque = (debut, fin, widget) => {
    if (fin <= debut) return;
    if (touche(debut, fin) || doc.lineAt(debut).number !== doc.lineAt(fin).number) sortie.push({ debut, fin, classe: "cm-hy-marque" });
    else if (widget) sortie.push({ debut, fin, widget });
    else sortie.push({ debut, fin, masque: true });
  };
  const avecEspace = (n) => (doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to);
  const lignes = (de, a, classe, debutPlage, finPlage) => {
    const premiere = doc.lineAt(Math.max(de, debutPlage)).number;
    const derniere = doc.lineAt(Math.min(a, finPlage)).number;
    for (let n = premiere; n <= derniere; n++) {
      const l = doc.line(n);
      const cle = `${l.from}:${classe}`;
      if (lignesVues.has(cle)) continue;
      lignesVues.add(cle);
      sortie.push({ debut: l.from, fin: l.from, ligne: true, classe });
    }
  };

  for (const plage of plages) {
    const { from, to } = plage;
    syntaxTree(etat).iterate({
      from,
      to,
      enter: (n) => {
        const nom = n.name;
        const l = (de, a, classe) => lignes(de, a, classe, from, to);
        if (TITRES[nom]) {
          const setext = nom.startsWith("Setext");
          const fin = setext ? doc.line(doc.lineAt(n.to).number - 1).to : n.to;
          l(n.from, fin, `cm-hy-titre${TITRES[nom]}`);
          if (setext) {
            const m = n.node.getChild("HeaderMark");
            if (m) style(m.from, m.to, "cm-hy-marque");
          }
        } else if (nom === "HeaderMark" && n.node.parent.name.startsWith("ATX")) {
          if (n.from === doc.lineAt(n.from).from) marque(n.from, avecEspace(n));
          else style(n.from, n.to, "cm-hy-marque");
        } else if (nom === "Blockquote") l(n.from, n.to, "cm-hy-citation");
        else if (nom === "QuoteMark") marque(n.from, avecEspace(n));
        else if (nom === "CodeBlock") l(n.from, n.to, "cm-hy-bloc-code");
        else if (nom === "FencedCode") {
          l(n.from, n.to, "cm-hy-bloc-code");
          // Clôtures : le texte de la ligne (marque et nom du langage) est masqué si aucune ligne du bloc n'est touchée.
          const masquer = !touche(n.from, n.to);
          for (const m of n.node.getChildren("CodeMark")) {
            const fin = doc.lineAt(m.from).to;
            if (!masquer) style(m.from, fin, "cm-hy-marque");
            else if (!lignesVues.has(`${m.from}:masque`)) {
              lignesVues.add(`${m.from}:masque`);
              if (fin > m.from) sortie.push({ debut: m.from, fin, masque: true });
            }
          }
        }
        else if (nom === "Table" || nom === "HTMLBlock") l(n.from, n.to, "cm-hy-mono");
        else if (STYLES[nom]) {
          const marques = n.node.getChildren(STYLES[nom][0]);
          if (marques.length >= 2) {
            const [ouvre, ferme] = [marques[0], marques[marques.length - 1]];
            style(ouvre.to, ferme.from, STYLES[nom][1]);
            marque(ouvre.from, ouvre.to);
            marque(ferme.from, ferme.to);
          }
        } else if (nom === "InlineCode") {
          const marques = n.node.getChildren("CodeMark");
          if (marques.length >= 2) {
            const [ouvre, ferme] = [marques[0], marques[marques.length - 1]];
            style(ouvre.to, ferme.from, "cm-hy-code");
            marque(ouvre.from, ouvre.to);
            marque(ferme.from, ferme.to);
          }
        } else if (nom === "Link") {
          const marques = n.node.getChildren("LinkMark");
          // Seul le lien en ligne `[texte](adresse)` est mis en forme ; `[^1]` et `[a][b]` restent tels quels.
          if (marques.length >= 4 && doc.sliceString(marques[2].from, marques[2].to) === "(") {
            style(marques[0].to, marques[1].from, "cm-hy-lien");
            marque(marques[0].from, marques[0].to);
            marque(marques[1].from, n.to);
          }
          return false;
        } else if (nom === "Autolink") {
          style(n.from, n.to, "cm-hy-lien");
          return false;
        } else if (nom === "URL") {
          if (!["Link", "Image", "Autolink", "LinkReference"].includes(n.node.parent?.name)) style(n.from, n.to, "cm-hy-lien");
        } else if (nom === "Image") return false;
        else if (nom === "ListMark" && n.node.parent.parent?.name === "BulletList") marque(n.from, n.to, "puce");
        else if (nom === "HorizontalRule") marque(n.from, n.to, "trait");
      },
    });
  }
  sortie.push(...marquesSelectionFond(etat, sortie));
  return sortie.sort((a, b) => a.debut - b.debut || (b.ligne ? 1 : 0) - (a.ligne ? 1 : 0) || b.fin - a.fin);
}

const masque = Decoration.replace({});
const ornements = { puce: Decoration.replace({ widget: new Ornement("puce") }), trait: Decoration.replace({ widget: new Ornement("trait") }) };
const marquesCache = new Map();
const ligneCache = new Map();
function enDecoration(d) {
  if (d.ligne) {
    if (!ligneCache.has(d.classe)) ligneCache.set(d.classe, Decoration.line({ class: d.classe }));
    return ligneCache.get(d.classe).range(d.debut);
  }
  if (d.masque) return masque.range(d.debut, d.fin);
  if (d.widget) return ornements[d.widget].range(d.debut, d.fin);
  if (!marquesCache.has(d.classe)) marquesCache.set(d.classe, Decoration.mark({ class: d.classe }));
  return marquesCache.get(d.classe).range(d.debut, d.fin);
}

// Sélection sur un fond réglé (REQ-115) : `drawSelection` dessine la sélection sous le texte, qu'un fond opaque cacherait.
// Chaque plage sélectionnée d'une ligne de bloc de code, d'une ligne de citation ou d'un code en ligne reçoit une marque
// `ya-sel-fond ya-sel-fond-<élément>`, sans style : la feuille construite lui donne `--selection` quand le fond de l'élément est réglé.
let fondsReglesListe = new Set();
/** Éléments (`code`, `bloc-code`, `citation`) dont un fond est réglé dans au moins un thème ; sans eux, aucune marque. */
export function fondsRegles(elements) {
  fondsReglesListe = new Set(elements);
}
const FONDS = { "cm-hy-bloc-code": "bloc-code", "cm-hy-citation": "citation", "cm-hy-code": "code" };
function marquesSelectionFond(etat, decos) {
  const doc = etat.doc;
  const sortie = [];
  for (const d of decos) {
    const element = FONDS[d.classe];
    if (!element || !fondsReglesListe.has(element) || d.masque || d.widget) continue;
    const [de, a] = d.ligne ? [d.debut, doc.lineAt(d.debut).to] : [d.debut, d.fin];
    for (const r of etat.selection.ranges) {
      const [debut, fin] = [Math.max(de, r.from), Math.min(a, r.to)];
      if (fin > debut) sortie.push({ debut, fin, classe: `ya-sel-fond ya-sel-fond-${element}` });
    }
  }
  return sortie;
}

function construire(vue) {
  return Decoration.set(decorationsHybride(vue.state, vue.visibleRanges).map(enDecoration), true);
}

// Bornes [debut, fin] du texte d'une cellule dans la source (espaces autour exclus), ou null si la cellule n'existe pas.
// Une cellule vide prend place entre deux espaces quand il y en a.
export function bornesCellule(source, rangee, colonne) {
  const lignes = source.split("\n");
  const index = rangee <= 0 ? 0 : rangee + 1;
  if (index >= lignes.length) return null;
  let decalage = 0;
  for (let i = 0; i < index; i++) decalage += lignes[i].length + 1;
  const texte = lignes[index];
  const blanc = (c) => c === " " || c === "\t";
  let pos = 0;
  while (blanc(texte[pos])) pos++;
  if (texte[pos] === "|") pos++;
  for (let k = 0; k < colonne; k++) {
    while (pos < texte.length && texte[pos] !== "|") pos += texte[pos] === "\\" ? 2 : 1;
    if (pos >= texte.length) return null;
    pos++;
  }
  let fin = pos;
  while (fin < texte.length && texte[fin] !== "|") fin += texte[fin] === "\\" ? 2 : 1;
  fin = Math.min(fin, texte.length);
  let a = pos;
  let b = fin;
  while (a < b && blanc(texte[a])) a++;
  while (b > a && blanc(texte[b - 1])) b--;
  if (a === b) a = b = pos + (fin > pos ? 1 : 0);
  return { debut: decalage + a, fin: decalage + b };
}

// Texte d'une cellule tel qu'il se montre en saisie : `\|` du fichier devient `|`.
export function texteSaisie(source, rangee, colonne) {
  const b = bornesCellule(source, rangee, colonne);
  return b ? source.slice(b.debut, b.fin).replaceAll("\\|", "|") : "";
}

const texteEcrit = (texte) => texte.replace(/\s*\n\s*/g, " ").trim().replaceAll("|", "\\|");

// Source après remplacement du texte d'une cellule : seul le texte entre ses `|` change, un `|` tapé devient `\|`.
export function sourceApres(source, rangee, colonne, texte) {
  const b = bornesCellule(source, rangee, colonne);
  if (!b) return source;
  return source.slice(0, b.debut) + texteEcrit(texte) + source.slice(b.fin);
}

// Structure d'une ligne de tableau : positions des `|` non échappés, présence des `|` de tête et de queue, nombre de cellules.
function structureLigne(texte) {
  const blanc = (c) => c === " " || c === "\t";
  let debut = 0;
  while (blanc(texte[debut])) debut++;
  let fin = texte.length;
  while (fin > debut && blanc(texte[fin - 1])) fin--;
  const barres = [];
  for (let i = debut; i < fin; i++) {
    if (texte[i] === "\\") i++;
    else if (texte[i] === "|") barres.push(i);
  }
  const tete = texte[debut] === "|";
  const queue = barres.length > 0 && barres.at(-1) === fin - 1 && !(tete && barres.length === 1);
  const n = barres.length - (tete && queue ? 1 : 0) + (!tete && !queue ? 1 : 0);
  return { debut, fin, barres, tete, n, avant: (k) => (tete ? barres[k] : k === 0 ? undefined : barres[k - 1]) };
}

const parLignes = (source, f) => source.split("\n").map(f).join("\n");

// Source après l'ajout d'une cellule vide à la colonne `k` (0 = avant la première) dans chaque ligne ; `---` dans la séparation.
export function insererColonne(source, k) {
  return parLignes(source, (texte, i) => {
    const s = structureLigne(texte);
    if (k > s.n) return texte;
    const cellule = i === 1 ? " --- |" : " |";
    const pos = s.avant(k);
    if (pos !== undefined) return texte.slice(0, pos + 1) + cellule + texte.slice(pos + 1);
    if (k === 0) return texte.slice(0, s.debut) + "|" + cellule + " " + texte.slice(s.debut);
    return texte.slice(0, s.fin) + " |" + cellule;
  });
}

// Source après le retrait de la colonne `k` de chaque ligne.
export function supprimerColonne(source, k) {
  return parLignes(source, (texte) => {
    const s = structureLigne(texte);
    if (k >= s.n) return texte;
    const avant = s.avant(k);
    const apres = s.tete ? s.barres[k + 1] : s.barres[k];
    const r = apres !== undefined ? texte.slice(0, avant === undefined ? s.debut : avant + 1) + texte.slice(apres + 1) : texte.slice(0, avant) + texte.slice(s.fin);
    if (s.n > 2) return r;
    // Une seule colonne reste : les `|` de bord gardent le tableau (sans eux, la séparation devient un titre).
    const [corps, fin] = [r.trimEnd(), r.slice(r.trimEnd().length)];
    const indent = corps.length - corps.trimStart().length;
    const tete = corps[indent] === "|" ? "" : "| ";
    const queue = corps.endsWith("|") && !corps.endsWith("\\|") ? "" : " |";
    return corps.slice(0, indent) + tete + corps.slice(indent) + queue + (queue ? "" : fin);
  });
}

// Source après l'ajout d'une ligne vide au rang `p` du corps (0 = juste sous l'en-tête, nombre de rangées = à la fin).
export function insererLigne(source, p) {
  const lignes = source.split("\n");
  const vide = "|" + " |".repeat(structureLigne(lignes[0]).n);
  lignes.splice(Math.min(2 + p, lignes.length), 0, vide);
  return lignes.join("\n");
}

// Source après le retrait de la rangée `rangee` du tableau rendu (1 = première rangée du corps).
export function supprimerLigne(source, rangee) {
  const lignes = source.split("\n");
  if (rangee < 1 || rangee + 1 >= lignes.length) return source;
  lignes.splice(rangee + 1, 1);
  return lignes.join("\n");
}

const TOLERANCE_AIDE = 4;
const DEMI_DISQUE = 10;

// Disque d'aide sous le pointeur d'un tableau rendu (REQ-153, C-008 « Aides »). Fonction pure, coordonnées de la fenêtre.
// `lignes` : rectangles { left, top, right, bottom } des cellules, rangée par rangée (l'en-tête d'abord) ; `courant` : le disque déjà visible ;
// `gauche` : plus petite abscisse du centre d'un disque (pour ne pas passer sous la gouttière).
// Rend { sorte, indice, x, y, filet | cadre } (sorte = nom de l'icône) ou null.
export function zonesAides({ lignes, pointeur: { x, y }, courant, gauche = -Infinity }) {
  if (courant && Math.abs(x - courant.x) <= DEMI_DISQUE && Math.abs(y - courant.y) <= DEMI_DISQUE) return courant;
  const en = lignes[0];
  if (!en?.length) return null;
  const bornes = lignes.map((r) => ({ top: Math.min(...r.map((c) => c.top)), bottom: Math.max(...r.map((c) => c.bottom)) }));
  const t = { left: en[0].left, right: en.at(-1).right, top: bornes[0].top, bottom: bornes.at(-1).bottom };
  const dansTableau = x >= t.left - TOLERANCE_AIDE && x <= t.right + TOLERANCE_AIDE && y >= t.top && y <= t.bottom + TOLERANCE_AIDE;
  let meilleur = null;
  if (dansTableau) {
    for (let k = 0; k <= en.length; k++) {
      const bord = k === 0 || k === en.length;
      if (bord && (y < bornes[0].top || y > bornes[0].bottom)) continue;
      const bx = k === 0 ? en[0].left : k === en.length ? en[k - 1].right : (en[k - 1].right + en[k].left) / 2;
      const d = Math.abs(x - bx);
      if (d <= TOLERANCE_AIDE && (!meilleur || d < meilleur.d)) {
        const [haut, bas] = bord ? [bornes[0].top, bornes[0].bottom] : [t.top, t.bottom];
        meilleur = { d, disque: { sorte: "inserer-colonne", indice: k, x: Math.max(bx, gauche), y: Math.min(Math.max(y, haut), bas), filet: { x: bx, top: t.top, bottom: t.bottom } } };
      }
    }
    if (x >= t.left && x <= t.right) {
      for (let r = 0; r < lignes.length; r++) {
        const by = r === lignes.length - 1 ? bornes[r].bottom : (bornes[r].bottom + bornes[r + 1].top) / 2;
        const d = Math.abs(y - by);
        if (d <= TOLERANCE_AIDE && (!meilleur || d < meilleur.d)) {
          const [a, b] = [t.left + 8, t.right - 8];
          meilleur = { d, disque: { sorte: "inserer-ligne", indice: r, x: a > b ? (t.left + t.right) / 2 : Math.min(Math.max(x, a), b), y: by, filet: { y: by, left: t.left, right: t.right } } };
        }
      }
    }
  }
  if (meilleur) return meilleur.disque;
  if (en.length >= 2 && y >= bornes[0].top && y <= bornes[0].bottom) {
    const j = en.findIndex((c) => x >= c.left && x <= c.right);
    if (j >= 0) return { sorte: "supprimer-colonne", indice: j, x: (en[j].left + en[j].right) / 2, y: t.top, cadre: { left: en[j].left, right: en[j].right, top: t.top, bottom: t.bottom } };
  }
  for (let r = 1; r < lignes.length; r++) {
    if (y >= bornes[r].top && y <= bornes[r].bottom && x >= t.left && x <= t.right + TOLERANCE_AIDE) {
      return { sorte: "supprimer-ligne", indice: r, x: t.right, y: (bornes[r].top + bornes[r].bottom) / 2, cadre: { left: t.left, right: t.right, top: bornes[r].top, bottom: bornes[r].bottom } };
    }
  }
  return null;
}

// Tableaux rendus : ceux dont aucune ligne n'est touchée par la sélection, de la première à la dernière ligne entière.
export function tableauxHybride(etat) {
  const doc = etat.doc;
  const actives = new Set();
  for (const r of etat.selection.ranges) for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) actives.add(n);
  const sortie = [];
  syntaxTree(etat).iterate({
    enter: (n) => {
      if (n.name !== "Table") return;
      const [a, b] = [doc.lineAt(n.from), doc.lineAt(n.to)];
      let touche = false;
      for (let i = a.number; i <= b.number; i++) if (actives.has(i)) touche = true;
      if (!touche) sortie.push({ debut: a.from, fin: b.to, source: doc.sliceString(a.from, b.to) });
      return false;
    },
  });
  return sortie;
}

export class TableauRendu extends WidgetType {
  constructor(source) {
    super();
    this.source = source;
  }
  eq(autre) {
    return autre.source === this.source;
  }
  toDOM(vue) {
    const el = document.createElement("div");
    el.className = "cm-hy-tableau";
    el.setAttribute("contenteditable", "false");
    const modele = document.createElement("template");
    modele.innerHTML = rendreMarkdown(this.source);
    const table = modele.content.querySelector("table");
    if (table) {
      for (const a of table.querySelectorAll("a")) {
        a.dataset.lien ??= a.getAttribute("href") ?? "";
        if (lienDeDocument(a.dataset.lien)) a.classList.add("cm-hy-suivable");
        a.removeAttribute("href");
        a.removeAttribute("title");
      }
      el.append(table);
    } else el.textContent = this.source;
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest?.(".ya-cellule-saisie")) return; // la saisie garde le comportement natif du navigateur
      e.preventDefault();
      if (e.button !== 0 || e.ctrlKey || e.metaKey || !table) return;
      const cellule = e.target.closest?.("td, th");
      if (!cellule || !table.contains(cellule)) return;
      const rangee = [...table.rows].indexOf(cellule.parentElement);
      const point = { x: e.clientX, y: e.clientY };
      const ouverte = saisies.get(vue);
      if (ouverte) ouverte.valider({ indice: indiceTableau(vue, el), rangee, colonne: cellule.cellIndex });
      else ouvrirSaisie(vue, el, this.source, rangee, cellule.cellIndex, point);
    });
    if (table) {
      ouvreurs.set(el, (rangee, colonne) => ouvrirSaisie(vue, el, this.source, rangee, colonne));
      nettoyages.set(el, aidesDuTableau(vue, el, table));
    }
    return el;
  }
  destroy(dom) {
    nettoyages.get(dom)?.();
  }
  ignoreEvent() {
    return true;
  }
  // La saisie d'une cellule est dans le widget : CodeMirror n'en lit ni les mutations ni la sélection.
  ignoreMutation() {
    return true;
  }
}

// Cellule en saisie (REQ-153, DEC-102) : une seule par vue ; le document ne change qu'à la validation.
const saisies = new WeakMap(); // vue -> { valider(suite) }
const ouvreurs = new WeakMap(); // élément du tableau rendu -> (rangée, colonne) => ouvre la saisie

// Ouvre la saisie de la cellule (rangée, colonne) du tableau d'indice `indice` (dans l'ordre des tableaux rendus), après la transaction.
export const ouvrirCellule = StateEffect.define();

// Une fois le DOM refait par la transaction, ouvre la cellule demandée par l'effet `ouvrirCellule`.
const ouvertureDeCellule = ViewPlugin.fromClass(
  class {
    constructor(vue) {
      this.vue = vue;
    }
    update(u) {
      for (const tr of u.transactions) {
        for (const e of tr.effects) {
          if (!e.is(ouvrirCellule)) continue;
          const { indice, rangee, colonne } = e.value;
          queueMicrotask(() => {
            const el = this.vue.dom.querySelectorAll(".cm-hy-tableau")[indice];
            if (el) ouvreurs.get(el)?.(rangee, colonne);
          });
        }
      }
    }
  },
);

const nettoyages = new WeakMap(); // élément du tableau rendu -> retire les écouteurs de la fenêtre

// Disques « Insérer » et « Supprimer » au survol, filet et cadre (REQ-153, C-008 « Aides »). Rend la fonction qui retire les écouteurs de la fenêtre.
function aidesDuTableau(vue, el, table) {
  const mac = estMac();
  const modif = (e) => (mac ? e.metaKey : e.ctrlKey);
  const calque = document.createElement("div");
  calque.className = "ya-tableau-aides";
  el.append(calque);
  let courant = null; // disque affiché
  let bouton_ = null;
  let trait = null;
  const effacer = () => {
    courant = null;
    bouton_?.enveloppe.remove();
    bouton_ = null;
    trait?.remove();
    trait = null;
  };
  const poser = (div, style) => {
    for (const [k, v] of Object.entries(style)) div.style[k] = `${v}px`;
  };
  const tracer = (classe, style) => {
    trait?.remove();
    trait = document.createElement("div");
    trait.className = classe;
    poser(trait, style);
    calque.append(trait);
  };
  const agir = () => {
    const d = courant;
    if (!d) return;
    const indice = indiceTableau(vue, el);
    const debut = vue.posAtDOM(el);
    validerSaisie(vue);
    const t = tableauxHybride(vue.state).find((x) => x.debut === debut);
    if (!t) return;
    let apres;
    let suite = null;
    if (d.sorte === "inserer-colonne") {
      apres = insererColonne(t.source, d.indice);
      suite = { indice, rangee: 0, colonne: d.indice };
    } else if (d.sorte === "inserer-ligne") {
      apres = insererLigne(t.source, d.indice);
      suite = { indice, rangee: d.indice + 1, colonne: 0 };
    } else if (d.sorte === "supprimer-colonne") apres = supprimerColonne(t.source, d.indice);
    else apres = supprimerLigne(t.source, d.indice);
    effacer();
    let a = 0;
    while (a < t.source.length && a < apres.length && t.source[a] === apres[a]) a++;
    let b = 0;
    while (b < t.source.length - a && b < apres.length - a && t.source[t.source.length - 1 - b] === apres[apres.length - 1 - b]) b++;
    vue.dispatch({
      changes: { from: t.debut + a, to: t.debut + t.source.length - b, insert: apres.slice(a, apres.length - b) },
      annotations: isolateHistory.of("full"),
      effects: suite ? [ouvrirCellule.of(suite)] : [],
    });
    if (!suite) vue.focus();
  };
  const afficher = (d, base) => {
    const [x, y] = [d.x - base.left, d.y - base.top];
    if (bouton_?.dataset.sorte !== d.sorte) {
      bouton_?.enveloppe.remove();
      const colonne = d.sorte.endsWith("colonne");
      const nom = { "inserer-colonne": "Insérer une colonne", "inserer-ligne": "Insérer une ligne", "supprimer-colonne": "Supprimer la colonne", "supprimer-ligne": "Supprimer la ligne" }[d.sorte];
      bouton_ = bouton({ icone: d.sorte, nomAccessible: nom, taille: "disque", positionInfoBulle: colonne ? "dessus" : "droite" });
      bouton_.dataset.sorte = d.sorte;
      bouton_.addEventListener("click", agir);
      if (d.sorte.startsWith("supprimer")) {
        bouton_.addEventListener("mouseenter", () => {
          const c = courant?.cadre;
          if (c) {
            const r = el.getBoundingClientRect();
            tracer("ya-tableau-cadre", { left: c.left - r.left, top: c.top - r.top, width: c.right - c.left, height: c.bottom - c.top });
          }
        });
        bouton_.addEventListener("mouseleave", () => {
          trait?.remove();
          trait = null;
        });
      }
      calque.append(bouton_.enveloppe);
    }
    poser(bouton_, { left: x, top: y });
    courant = d;
    if (d.filet) {
      const f = d.filet;
      if (d.sorte === "inserer-colonne") tracer("ya-tableau-filet ya-tableau-filet-v", { left: f.x - base.left - 1, top: f.top - base.top, height: f.bottom - f.top });
      else tracer("ya-tableau-filet ya-tableau-filet-h", { left: f.left - base.left, top: f.y - base.top - 1, width: f.right - f.left });
    } else if (!bouton_.matches(":hover")) {
      trait?.remove();
      trait = null;
    }
  };
  el.addEventListener("mousemove", (e) => {
    if (modif(e) || e.buttons & 1) return effacer();
    const lignes = [...table.rows].map((r) => [...r.cells].map((c) => c.getBoundingClientRect()));
    const base = el.getBoundingClientRect();
    const d = zonesAides({ lignes, pointeur: { x: e.clientX, y: e.clientY }, courant, gauche: base.left + DEMI_DISQUE });
    if (!d) return effacer();
    if (d === courant) return;
    afficher(d, base);
  });
  el.addEventListener("mouseleave", effacer);
  const touche = (e) => {
    if (e.key === (mac ? "Meta" : "Control") && e.type === "keydown") effacer();
  };
  window.addEventListener("keydown", touche, true);
  return () => window.removeEventListener("keydown", touche, true);
}

const indiceTableau = (vue, el) => [...vue.dom.querySelectorAll(".cm-hy-tableau")].indexOf(el);

// Valide la saisie ouverte, s'il y en a une.
export function validerSaisie(vue) {
  saisies.get(vue)?.valider();
}

// Position du clic dans le texte de la cellule, ou -1.
function decalageDuClic(cellule, point) {
  let noeud = null;
  let decalage = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(point.x, point.y);
    if (p) [noeud, decalage] = [p.offsetNode, p.offset];
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(point.x, point.y);
    if (r) [noeud, decalage] = [r.startContainer, r.startOffset];
  }
  if (!noeud || noeud.nodeType !== 3 || !cellule.contains(noeud)) return -1;
  const parcours = document.createTreeWalker(cellule, NodeFilter.SHOW_TEXT);
  let avant = 0;
  while (parcours.nextNode() && parcours.currentNode !== noeud) avant += parcours.currentNode.length;
  return avant + decalage;
}

function ouvrirSaisie(vue, el, source, rangee, colonne, point) {
  validerSaisie(vue);
  const table = el.querySelector("table");
  const cellule = table?.rows[rangee]?.cells[colonne];
  if (!cellule) return;
  const texte0 = texteSaisie(source, rangee, colonne);
  const enTete = cellule.tagName === "TH";
  const titre = table.rows[0]?.cells[colonne]?.textContent.trim();
  const nom = enTete ? `En-tête de la colonne ${colonne + 1}` : titre ? `${titre}, rangée ${rangee}` : `Colonne ${colonne + 1}, rangée ${rangee}`;
  // Sans marque dans le texte, le curseur est où l'on a cliqué ; sinon à la fin.
  const decalage = point && texte0 === cellule.textContent ? decalageDuClic(cellule, point) : -1;
  const avant = cellule.innerHTML;
  const span = document.createElement("span");
  span.className = "ya-cellule-saisie";
  span.setAttribute("role", "textbox");
  span.setAttribute("aria-multiline", "false");
  span.setAttribute("contenteditable", "plaintext-only");
  span.setAttribute("aria-label", nom);
  span.textContent = texte0;
  cellule.replaceChildren(span);
  span.focus();
  const sel = document.getSelection();
  if (sel) {
    const t = span.firstChild;
    if (t) sel.collapse(t, decalage >= 0 ? Math.min(decalage, t.length) : t.length);
    else sel.collapse(span, 0);
  }

  let fini = false;
  const clore = () => {
    fini = true;
    saisies.delete(vue);
  };
  // suite : { indice, rangee, colonne } de la cellule à ouvrir ensuite ; sinon le focus revient au texte (sauf `garderFocus`).
  const valider = (suite, garderFocus) => {
    if (fini) return;
    clore();
    const texte = span.textContent;
    const debut = vue.posAtDOM(el);
    const b = texte === texte0 ? null : bornesCellule(source, rangee, colonne);
    const intact = vue.state.doc.sliceString(debut, debut + source.length) === source;
    const effets = suite ? [ouvrirCellule.of(suite)] : [];
    if (b && intact) {
      vue.dispatch({
        changes: { from: debut + b.debut, to: debut + b.fin, insert: texteEcrit(texte) },
        annotations: isolateHistory.of("full"),
        effects: effets,
      });
    } else {
      cellule.innerHTML = avant;
      if (effets.length) vue.dispatch({ effects: effets });
    }
    if (!suite && !garderFocus) vue.focus();
  };
  saisies.set(vue, { valider });

  const voisine = (pas) => {
    const lignes = [...table.rows];
    let r = rangee;
    let c = colonne + pas;
    if (c < 0) {
      r--;
      c = (lignes[r]?.cells.length ?? 1) - 1;
    } else if (c >= lignes[r].cells.length) {
      r++;
      c = 0;
    }
    return r >= 0 && r < lignes.length && c >= 0 ? { indice: indiceTableau(vue, el), rangee: r, colonne: c } : null;
  };
  span.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      valider();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (fini) return;
      clore();
      cellule.innerHTML = avant;
      vue.focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      valider(voisine(e.shiftKey ? -1 : 1));
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
      valider(); // l'événement continue vers Ctrl+S de la page
    } else e.stopPropagation();
  });
  for (const type of ["keyup", "keypress", "beforeinput", "input", "compositionstart", "compositionend", "paste", "cut", "copy", "dragstart", "drop"]) {
    span.addEventListener(type, (e) => e.stopPropagation());
  }
  span.addEventListener("blur", () => valider(null, true));
}

// Un StateField : CodeMirror refuse les décorations de bloc venant d'un ViewPlugin.
const champTableaux = StateField.define({
  create: (etat) => construireTableaux(etat),
  update(valeur, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return construireTableaux(tr.state);
    return valeur;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function construireTableaux(etat) {
  return Decoration.set(
    tableauxHybride(etat).map((t) => Decoration.replace({ block: true, widget: new TableauRendu(t.source) }).range(t.debut, t.fin)),
    true,
  );
}

// Diagrammes mermaid rendus (REQ-152) : les blocs fermés dont aucune ligne, clôtures comprises, n'est touchée.
// `texte` : les lignes du bloc, chacune terminée par un saut de ligne (comme l'aperçu, qui partage le dessin).
export function diagrammesHybride(etat) {
  const doc = etat.doc;
  const actives = new Set();
  for (const r of etat.selection.ranges) for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) actives.add(n);
  const sortie = [];
  syntaxTree(etat).iterate({
    enter: (n) => {
      if (n.name !== "FencedCode") return;
      const marques = n.node.getChildren("CodeMark");
      const info = n.node.getChild("CodeInfo");
      if (marques.length < 2 || !info || doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] !== "mermaid") return false;
      const [a, b] = [doc.lineAt(n.from), doc.lineAt(marques[marques.length - 1].from)];
      if (b.number <= a.number) return false;
      for (let i = a.number; i <= b.number; i++) if (actives.has(i)) return false;
      const interieur = b.number - a.number > 1 ? doc.sliceString(doc.line(a.number + 1).from, doc.line(b.number - 1).to) + "\n" : "";
      sortie.push({ debut: a.from, fin: b.to, texte: interieur });
      return false;
    },
  });
  return sortie;
}

// Les blocs de `diagrammesHybride` dont le dessin est prêt : ceux que l'éditeur remplace par une image.
export function diagrammesRendus(etat) {
  return diagrammesHybride(etat).filter((d) => dessinConnu(d.texte));
}

export class DiagrammeRendu extends WidgetType {
  constructor(texte, dessin) {
    super();
    this.texte = texte;
    this.dessin = dessin;
  }
  eq(autre) {
    return autre.texte === this.texte;
  }
  toDOM(vue) {
    const el = document.createElement("div");
    el.className = "ya-diagramme";
    el.setAttribute("contenteditable", "false");
    const img = document.createElement("img");
    img.alt = "Diagramme";
    img.draggable = false;
    img.width = this.dessin.largeur;
    img.height = this.dessin.hauteur;
    img.src = adresseDiagramme(this.dessin.svg);
    el.append(img);
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const debut = vue.posAtDOM(el);
      const haut = el.getBoundingClientRect().top;
      vue.dispatch({ selection: { anchor: Math.min(vue.state.doc.lineAt(debut).to + 1, vue.state.doc.length) } });
      vue.focus();
      const ecart = vue.lineBlockAt(debut).top + vue.documentTop - haut;
      if (ecart) vue.scrollDOM.scrollTop += ecart;
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const dessinPret = StateEffect.define();

// Un StateField (décorations de bloc) ; seuls les blocs dont le dessin est prêt sont remplacés.
const champDiagrammes = StateField.define({
  create: (etat) => construireDiagrammes(etat),
  update(valeur, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(dessinPret)) || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return construireDiagrammes(tr.state);
    return valeur;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function construireDiagrammes(etat) {
  const sortie = [];
  for (const d of diagrammesHybride(etat)) {
    const dessin = dessinConnu(d.texte);
    if (dessin) sortie.push(Decoration.replace({ block: true, widget: new DiagrammeRendu(d.texte, dessin) }).range(d.debut, d.fin));
  }
  return Decoration.set(sortie, true);
}

// Dessine, au plus 100 ms après, les blocs hors du curseur qui n'ont pas de dessin ; coupure : nouvel essai à 1,5 s.
const pluginDiagrammes = ViewPlugin.fromClass(
  class {
    constructor(vue) {
      this.vue = vue;
      this.minuteur = null;
      this.fini = false;
      this.planifier(100);
    }
    update(u) {
      if (u.docChanged || u.selectionSet || syntaxTree(u.state) !== syntaxTree(u.startState)) this.planifier(100);
    }
    planifier(delai) {
      clearTimeout(this.minuteur);
      this.minuteur = setTimeout(() => this.dessiner(), delai);
    }
    async dessiner() {
      const blocs = diagrammesHybride(this.vue.state);
      if (!blocs.length) return;
      const textes = [...new Set(blocs.map((d) => d.texte))].filter((t) => dessinConnu(t) === undefined);
      if (textes.length) {
        let mermaid;
        try {
          mermaid = await chargerMermaid();
        } catch {
          if (!this.fini) this.planifier(1500);
          return;
        }
        await Promise.all(textes.map((t) => dessinerTexte(mermaid, t)));
      }
      if (!this.fini) this.vue.dispatch({ effects: dessinPret.of(null) });
    }
    destroy() {
      this.fini = true;
      clearTimeout(this.minuteur);
    }
  },
);

// Lien en ligne `[texte](adresse)`, autolien ou adresse seule qui couvre `pos` : { de, a, adresse }, ou rien.
export function lienA(etat, pos) {
  let trouve;
  syntaxTree(etat).iterate({
    from: pos,
    to: pos,
    enter: (n) => {
      if (trouve) return false;
      let url;
      if (n.name === "Link") {
        const marques = n.node.getChildren("LinkMark");
        if (marques.length < 4 || etat.doc.sliceString(marques[2].from, marques[2].to) !== "(") return false;
        url = n.node.getChild("URL");
      } else if (n.name === "Autolink") url = n.node.getChild("URL");
      else if (n.name === "URL" && !["Link", "Image", "Autolink", "LinkReference"].includes(n.node.parent?.name)) url = n.node;
      else if (n.name === "Image") return false;
      if (url && n.from <= pos && pos < n.to) trouve = { de: n.from, a: n.to, adresse: etat.doc.sliceString(url.from, url.to) };
    },
  });
  return trouve;
}

// Tous les liens du texte visible, pour poser `cm-hy-suivable` sur ceux qui se suivent.
const suivable = Decoration.mark({ class: "cm-hy-suivable" });
function liensSuivables(vue) {
  const sortie = [];
  for (const { from, to } of vue.visibleRanges) {
    syntaxTree(vue.state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.name === "Image") return false;
        if (!["Link", "Autolink", "URL"].includes(n.name)) return;
        const lien = lienA(vue.state, n.from);
        if (lien && lien.de === n.from && lienDeDocument(lien.adresse)) sortie.push(suivable.range(lien.de, lien.a));
        if (n.name !== "URL") return false;
      },
    });
  }
  return Decoration.set(sortie, true);
}

const GESTES = { fichier: (l) => `pour ouvrir ${l.ecrit}`, ancre: (_, adresse) => `pour aller à ${adresse}`, web: (_, adresse) => `pour ouvrir ${adresse} dans un nouvel onglet` };

// Ctrl+clic (Cmd+clic sur macOS) suit un lien (REQ-101). `surLien(adresse)` ; `surSurvol({ geste, suite })` ou `surSurvol(null)`.
function suiviDesLiens({ surLien, surSurvol }) {
  return ViewPlugin.fromClass(
    class {
      constructor(vue) {
        this.vue = vue;
        this.decorations = liensSuivables(vue);
        const mac = estMac();
        const touche = mac ? "Meta" : "Control";
        const modif = (e) => (mac ? e.metaKey : e.ctrlKey);
        const poser = (oui) => vue.dom.classList.toggle("ya-ctrl", oui);
        // Adresse du lien sous le pointeur (même s'il ne se suit pas), ou undefined.
        const adresseSous = (e) => {
          const a = e.target.closest?.("a[data-lien]");
          if (a && vue.dom.contains(a)) return a.dataset.lien;
          let pos = null;
          try {
            pos = vue.posAtCoords({ x: e.clientX, y: e.clientY }, false);
          } catch {
            pos = null;
          }
          if (pos == null && vue.contentDOM.contains(e.target)) pos = vue.posAtDOM(e.target, 0);
          return pos == null ? undefined : lienA(vue.state, pos)?.adresse;
        };
        this.mousedown = (e) => {
          if (e.button !== 0 || !modif(e)) return;
          const adresse = adresseSous(e);
          if (adresse === undefined) return;
          e.preventDefault();
          e.stopPropagation();
          if (lienDeDocument(adresse)) surLien?.(adresse);
        };
        this.mousemove = (e) => {
          poser(modif(e));
          const adresse = adresseSous(e);
          const lien = adresse === undefined ? null : lienDeDocument(adresse);
          surSurvol?.(lien ? { geste: mac ? "Cmd+clic" : "Ctrl+clic", suite: GESTES[lien.sorte](lien, adresse) } : null);
        };
        this.quitter = () => {
          poser(false);
          surSurvol?.(null);
        };
        this.touche = (e) => {
          if (e.key === touche) poser(e.type === "keydown");
        };
        vue.dom.addEventListener("mousedown", this.mousedown, true);
        vue.dom.addEventListener("mousemove", this.mousemove);
        vue.dom.addEventListener("mouseleave", this.quitter);
        window.addEventListener("keydown", this.touche, true);
        window.addEventListener("keyup", this.touche, true);
        window.addEventListener("blur", this.quitter);
      }
      update(u) {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = liensSuivables(u.view);
      }
      destroy() {
        const { vue } = this;
        vue.dom.removeEventListener("mousedown", this.mousedown, true);
        vue.dom.removeEventListener("mousemove", this.mousemove);
        vue.dom.removeEventListener("mouseleave", this.quitter);
        window.removeEventListener("keydown", this.touche, true);
        window.removeEventListener("keyup", this.touche, true);
        window.removeEventListener("blur", this.quitter);
      }
    },
    { decorations: (p) => p.decorations },
  );
}

// Extension CodeMirror du mode hybride. Le document n'est jamais modifié : seules des décorations sont posées.
export function hybride({ surLien, surSurvol } = {}) {
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(vue) {
        this.decorations = construire(vue);
      }
      update(u) {
        if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = construire(u.view);
      }
    },
    { decorations: (p) => p.decorations },
  );
  return [plugin, ouvertureDeCellule, suiviDesLiens({ surLien, surSurvol }), champTableaux, champDiagrammes, pluginDiagrammes, EditorView.editorAttributes.of({ class: "cm-hybride" })];
}
