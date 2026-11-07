import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { rendreMarkdown } from "./apercu.js";

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

function construire(vue) {
  return Decoration.set(decorationsHybride(vue.state, vue.visibleRanges).map(enDecoration), true);
}

// Début du texte d'une cellule dans la source du tableau (rangée 0 = en-tête, la ligne `---` est sautée).
// Un `\|` n'est pas un séparateur. Hors du tableau : début de la source.
export function debutCellule(source, rangee, colonne) {
  const lignes = source.split("\n");
  const index = rangee <= 0 ? 0 : rangee + 1;
  if (index >= lignes.length) return 0;
  let debut = 0;
  for (let i = 0; i < index; i++) debut += lignes[i].length + 1;
  const texte = lignes[index];
  let pos = 0;
  while (texte[pos] === " " || texte[pos] === "\t") pos++;
  if (texte[pos] === "|") pos++;
  for (let k = 0; k < colonne; k++) {
    while (pos < texte.length && texte[pos] !== "|") pos += texte[pos] === "\\" ? 2 : 1;
    if (pos >= texte.length) return debut + texte.length;
    pos++;
  }
  while (texte[pos] === " " || texte[pos] === "\t") pos++;
  return debut + Math.min(pos, texte.length);
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
        a.removeAttribute("href");
        a.removeAttribute("title");
      }
      el.append(table);
    } else el.textContent = this.source;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const debut = vue.posAtDOM(el);
      const cellule = e.target.closest?.("td, th");
      let pos = debut;
      if (cellule && table) {
        const rangee = [...table.querySelectorAll("tr")].indexOf(cellule.parentElement);
        pos = debut + debutCellule(this.source, rangee, cellule.cellIndex);
      }
      const haut = el.getBoundingClientRect().top;
      vue.dispatch({ selection: { anchor: pos } });
      vue.focus();
      // Le haut de la ligne 1 du tableau prend la place du haut du tableau rendu (hors marge) ; ce qui suit remonte.
      const ecart = vue.lineBlockAt(debut).top + vue.documentTop - haut;
      if (ecart) vue.scrollDOM.scrollTop += ecart;
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
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

// Extension CodeMirror du mode hybride. Le document n'est jamais modifié : seules des décorations sont posées.
export function hybride() {
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
  return [plugin, champTableaux, EditorView.editorAttributes.of({ class: "cm-hybride" })];
}
