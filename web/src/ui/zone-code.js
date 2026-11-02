import { EditorState, StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { supportLangage } from "./langages.js";
import { apercu as creerApercu } from "./apercu.js";

const MODES = ["edition", "diff"];

const theme = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--texte)", backgroundColor: "var(--fond)", font: "var(--texte-lecture) var(--police-code)" },
    ".cm-scroller": { font: "var(--texte-lecture) var(--police-code)" },
    ".cm-content": { caretColor: "var(--texte)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--texte)" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--selection)" },
    "& ::selection, & .cm-line::selection, & .cm-line > span::selection": { backgroundColor: "var(--selection)" },
    ".cm-gutters": { backgroundColor: "var(--fond)", color: "var(--texte-attenue)", border: "none" },
    ".cm-activeLine": { backgroundColor: "var(--surface)" },
    "&.cm-focused > .cm-scroller > .cm-cursorLayer": { animation: "none !important" },
    ".cm-ligne-ajout": { backgroundColor: "var(--diff-ajout)" },
    ".cm-ligne-retrait": { backgroundColor: "var(--diff-retrait)" },
  },
  { dark: true },
);

const couleurs = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--code-mot-cle)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--code-chaine)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name)], color: "var(--code-nombre)" },
  { tag: [t.function(t.variableName), t.propertyName, t.heading], color: "var(--code-fonction)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--code-type)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--texte-attenue)", fontStyle: "italic" },
]);

const lignesDiff = StateField.define({
  create: (etat) => decorerDiff(etat.doc),
  update: (d, tr) => (tr.docChanged ? decorerDiff(tr.state.doc) : d),
  provide: (f) => EditorView.decorations.from(f),
});
// Ligne active : seulement sans sélection, car son fond opaque cacherait la sélection dessinée derrière.
const ligneActiveDeco = Decoration.line({ class: "cm-activeLine" });
const ligneActive = StateField.define({
  create: (etat) => decorerActive(etat),
  update: (_, tr) => decorerActive(tr.state),
  provide: (f) => EditorView.decorations.from(f),
});
function decorerActive(etat) {
  const sel = etat.selection.main;
  if (!sel.empty) return Decoration.none;
  const l = etat.doc.lineAt(sel.head);
  return Decoration.set([ligneActiveDeco.range(l.from)]);
}
const ajout = Decoration.line({ class: "cm-ligne-ajout" });
const retrait = Decoration.line({ class: "cm-ligne-retrait" });
function decorerDiff(doc) {
  const b = new RangeSetBuilder();
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i);
    const c = doc.sliceString(l.from, l.from + 1);
    if (c === "+") b.add(l.from, l.from, ajout);
    else if (c === "-") b.add(l.from, l.from, retrait);
  }
  return b.finish();
}

export function zoneCode({ contenu = "", langage, mode = "edition", apercu = false, ligne, nom = "", surChangement } = {}) {
  if (!MODES.includes(mode)) throw new Error(`zoneCode : mode inconnu « ${mode} »`);
  const diff = mode === "diff";
  const racine = document.createElement("div");
  racine.className = `zone-code zone-code-${mode}`;
  const hote = document.createElement("div");
  hote.className = "zone-code-editeur";
  racine.append(hote);

  const extensions = [
    theme,
    lineNumbers(),
    ...(diff ? [] : [drawSelection(), ligneActive]),
    EditorView.contentAttributes.of({ "aria-label": `${diff ? "Diff" : "Éditeur"} ${nom}`.trim() }),
  ];
  if (diff) {
    extensions.push(EditorState.readOnly.of(true), lignesDiff);
  } else {
    extensions.push(
      history(),
      syntaxHighlighting(couleurs),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    );
    if (langage) extensions.push(supportLangage(langage));
  }
  extensions.push(
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      if (ap) ap.maj(u.state.doc.toString());
      surChangement?.(u.state.doc.toString());
    }),
  );

  let ap = null;
  const vue = new EditorView({ state: EditorState.create({ doc: contenu, extensions }), parent: hote });

  racine.vue = vue;
  racine.contenu = () => vue.state.doc.toString();
  racine.definirApercu = (actif) => {
    if (actif && !ap) {
      ap = creerApercu();
      ap.maj(racine.contenu());
      racine.append(ap);
    } else if (!actif && ap) {
      ap.remove();
      ap = null;
    }
    racine.classList.toggle("zone-code-avec-apercu", actif);
  };
  // Le curseur reste sur la même ligne (bornée au nouveau texte), à la même colonne si elle existe encore.
  racine.remplacer = (texte) => {
    const doc = vue.state.doc;
    const tete = doc.lineAt(vue.state.selection.main.head);
    const colonne = vue.state.selection.main.head - tete.from;
    const nouveau = vue.state.update({ changes: { from: 0, to: doc.length, insert: texte } }).state.doc;
    const ligne = nouveau.line(Math.min(tete.number, nouveau.lines));
    vue.dispatch({
      changes: { from: 0, to: doc.length, insert: texte },
      selection: { anchor: ligne.from + Math.min(colonne, ligne.length) },
    });
  };
  racine.detruire = () => vue.destroy();
  if (apercu) racine.definirApercu(true);

  racine.aller = (numero) => {
    const doc = vue.state.doc;
    const l = doc.line(Math.min(Math.max(numero, 1), doc.lines));
    vue.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
  };
  if (Number.isInteger(ligne)) racine.aller(ligne);
  return racine;
}
