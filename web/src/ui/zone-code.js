import { EditorState, Compartment, StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, keymap, lineNumbers, drawSelection, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { supportLangage } from "./langages.js";
import { apercu as creerApercu } from "./apercu.js";
import { apercuHtml } from "./apercu-html.js";
import { couleurs } from "./couleurs-code.js";
import { themeCourant } from "./theme.js";

const MODES = ["edition", "diff"];

// Reprise de cmTheme (design-system) : toutes les valeurs sont des var(--…), changer de thème n'exige aucune reconstruction.
// Seul l'indice `dark` change : il passe par un Compartment.
function creerTheme(dark) {
  return EditorView.theme(
    {
      "&": { color: "var(--ink)", backgroundColor: "var(--bg-200)", fontSize: "13.5px", height: "100%" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "21px" },
      ".cm-content": { caretColor: "var(--accent-fg)", padding: "6px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--accent-fg)" },
      "&.cm-focused > .cm-scroller > .cm-cursorLayer": { animation: "none !important" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
      ".cm-activeLine": { backgroundColor: "var(--ligne-active)" },
      ".cm-gutters": { backgroundColor: "var(--bg-200)", color: "var(--ink-faint)", border: "none" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink)" },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 18px" },
      ".cm-selectionMatch": { backgroundColor: "var(--accent-soft)" },
      "&.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--ink-faint)", borderRadius: "2px" },
      ".cm-tooltip": { backgroundColor: "var(--bg-300)", border: "none", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-popover)", fontFamily: "var(--font-sans)" },
      ".cm-foldPlaceholder": { backgroundColor: "var(--bg-400)", border: "none", color: "var(--ink-muted)" },
      ".cm-ligne-ajout": { backgroundColor: "var(--diff-ajout)" },
      ".cm-ligne-retrait": { backgroundColor: "var(--diff-retrait)" },
      ".cm-ligne-entete": { color: "var(--ink-muted)" },
    },
    { dark },
  );
}

// Créés une fois : EditorView.theme ajoute un module de style à chaque appel.
const themeSombre = creerTheme(true);
const themeClair = creerTheme(false);

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
const entete = Decoration.line({ class: "cm-ligne-entete" });
function decorerDiff(doc) {
  const b = new RangeSetBuilder();
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i);
    const c = doc.sliceString(l.from, l.from + 1);
    if (doc.sliceString(l.from, l.from + 2) === "@@") b.add(l.from, l.from, entete);
    else if (c === "+") b.add(l.from, l.from, ajout);
    else if (c === "-") b.add(l.from, l.from, retrait);
  }
  return b.finish();
}

export function zoneCode({ contenu = "", langage, mode = "edition", apercu = false, ligne, nom = "", surChangement, surPosition } = {}) {
  if (!MODES.includes(mode)) throw new Error(`zoneCode : mode inconnu « ${mode} »`);
  const diff = mode === "diff";
  const racine = document.createElement("div");
  racine.className = `zone-code zone-code-${mode}`;
  const hote = document.createElement("div");
  hote.className = "zone-code-editeur";
  racine.append(hote);

  const compartiment = new Compartment();
  const extensions = [
    compartiment.of(themeCourant() === "dark" ? themeSombre : themeClair),
    lineNumbers(),
    ...(diff ? [] : [drawSelection(), ligneActive, highlightActiveLineGutter()]),
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
      if (u.docChanged) {
        if (ap) ap.maj(u.state.doc.toString());
        surChangement?.(u.state.doc.toString());
      }
      if ((u.docChanged || u.selectionSet) && surPosition) signalerPosition(u.state);
    }),
  );

  let ap = null;
  function signalerPosition(etat) {
    const tete = etat.selection.main.head;
    const l = etat.doc.lineAt(tete);
    surPosition(l.number, tete - l.from + 1);
  }
  const vue = new EditorView({ state: EditorState.create({ doc: contenu, extensions }), parent: hote });

  racine.vue = vue;
  racine.contenu = () => vue.state.doc.toString();
  racine.definirApercu = (actif) => {
    if (actif && !ap) {
      ap = langage === "html" ? apercuHtml() : creerApercu();
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
  const suivreTheme = (e) => vue.dispatch({ effects: compartiment.reconfigure(e.detail === "dark" ? themeSombre : themeClair) });
  document.addEventListener("yaide-theme", suivreTheme);
  racine.detruire = () => {
    document.removeEventListener("yaide-theme", suivreTheme);
    vue.destroy();
  };
  if (apercu) racine.definirApercu(true);

  racine.aller = (numero) => {
    const doc = vue.state.doc;
    const l = doc.line(Math.min(Math.max(numero, 1), doc.lines));
    vue.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
  };
  if (Number.isInteger(ligne)) racine.aller(ligne);
  if (surPosition) signalerPosition(vue.state);
  return racine;
}
