import { EditorState, Compartment, Prec, StateField, RangeSetBuilder, RangeSet } from "@codemirror/state";
import { EditorView, Decoration, GutterMarker, keymap, lineNumbers, lineNumberWidgetMarker, gutterLineClass, drawSelection, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { supportLangage } from "./langages.js";
import { apercu as creerApercu } from "./apercu.js";
import { apercuHtml } from "./apercu-html.js";
import { couleurs } from "./couleurs-code.js";
import { hybride as extensionHybride, TableauRendu, tableauxHybride } from "./hybride.js";
import { themeCourant } from "./theme.js";
import { lienDeDocument, ligneDuTitre } from "../references.js";

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

// Numéro d'une ligne de titre : même hauteur de ligne que le titre (classes dans composants.css).
class NumeroTitre extends GutterMarker {
  constructor(niveau) {
    super();
    this.elementClass = `cm-hy-numero-titre${niveau}`;
  }
}
const numerosTitre = [1, 2].map((n) => new NumeroTitre(n));
const TITRES_NIVEAU = { ATXHeading1: 1, ATXHeading2: 2, SetextHeading1: 1, SetextHeading2: 2 };
function marqueursTitres(etat) {
  const doc = etat.doc;
  const vus = new Map();
  syntaxTree(etat).iterate({
    enter: (n) => {
      const niveau = TITRES_NIVEAU[n.name];
      if (!niveau) return;
      const derniere = n.name.startsWith("Setext") ? doc.lineAt(n.to).number - 1 : doc.lineAt(n.from).number;
      for (let i = doc.lineAt(n.from).number; i <= derniere; i++) vus.set(doc.line(i).from, numerosTitre[niveau - 1]);
    },
  });
  return RangeSet.of([...vus].sort((a, b) => a[0] - b[0]).map(([pos, m]) => m.range(pos)));
}
const numerosDesTitres = StateField.define({
  create: marqueursTitres,
  update: (m, tr) => (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? marqueursTitres(tr.state) : m),
  provide: (f) => gutterLineClass.from(f),
});

// Tableau rendu : un seul numéro, celui de sa première ligne, décalé vers le bas (composants.css).
class NumeroTableau extends GutterMarker {
  constructor(numero) {
    super();
    this.numero = numero;
    this.elementClass = "cm-hy-numero-tableau";
  }
  eq(autre) {
    return autre.numero === this.numero;
  }
  toDOM() {
    return document.createTextNode(String(this.numero));
  }
}
const numerosDesTableaux = lineNumberWidgetMarker.of((vue, widget, bloc) => (widget instanceof TableauRendu ? new NumeroTableau(vue.state.doc.lineAt(bloc.from).number) : null));

// Haut et Bas : CodeMirror ne sait pas entrer dans un tableau rendu (le curseur saute ailleurs).
// Depuis la dernière rangée affichée de la ligne au-dessus (ou la première de celle en dessous), le curseur va
// sur la première (ou la dernière) ligne du tableau, à la même colonne si elle existe.
function entrerDansTableau(bas) {
  return (vue) => {
    const sel = vue.state.selection.main;
    if (!sel.empty) return false;
    const doc = vue.state.doc;
    const ligne = doc.lineAt(sel.head);
    if (vue.moveToLineBoundary(sel, bas).head !== (bas ? ligne.to : ligne.from)) return false;
    const voisine = bas ? ligne.number + 1 : ligne.number - 1;
    if (voisine < 1 || voisine > doc.lines) return false;
    const cible = doc.line(voisine);
    const tableau = tableauxHybride(vue.state).find((t) => (bas ? t.debut === cible.from : t.fin === cible.to));
    if (!tableau) return false;
    const colonne = sel.head - ligne.from;
    const arrivee = bas ? doc.lineAt(tableau.debut) : doc.lineAt(tableau.fin);
    vue.dispatch({ selection: { anchor: arrivee.from + Math.min(colonne, arrivee.length) }, scrollIntoView: true, userEvent: "select" });
    return true;
  };
}
const clavierTableau = Prec.high(
  keymap.of([
    { key: "ArrowDown", run: entrerDansTableau(true) },
    { key: "ArrowUp", run: entrerDansTableau(false) },
  ]),
);

export function zoneCode({ contenu = "", langage, mode = "edition", apercu = false, hybride = false, adresseApercu, ligne, nom = "", surChangement, surPosition, surLien, surSurvolLien } = {}) {
  if (!MODES.includes(mode)) throw new Error(`zoneCode : mode inconnu « ${mode} »`);
  const diff = mode === "diff";
  const racine = document.createElement("div");
  racine.className = `zone-code zone-code-${mode}`;
  const hote = document.createElement("div");
  hote.className = "zone-code-editeur";
  racine.append(hote);

  // Ctrl+clic du mode hybride : ancre du même document, adresse web, ou fichier (à l'appelant).
  const suivreLien = (adresse) => {
    const lien = lienDeDocument(adresse);
    if (lien?.sorte === "ancre") {
      const numero = ligneDuTitre(racine.contenu(), lien.ancre);
      if (numero) {
        racine.aller(numero);
        vue.focus();
      }
    } else if (lien?.sorte === "web") window.open(lien.adresse, "_blank", "noopener,noreferrer");
    else if (lien) surLien?.({ adresse, element: vue.contentDOM });
  };
  const compartiment = new Compartment();
  const compartimentHybride = new Compartment();
  const hybridePossible = langage === "markdown" && !diff;
  const extensionsHybride = () => [extensionHybride({ surLien: suivreLien, surSurvol: surSurvolLien }), numerosDesTitres, numerosDesTableaux, clavierTableau, EditorView.lineWrapping];
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
  extensions.push(compartimentHybride.of(hybridePossible && hybride ? extensionsHybride() : []));
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
      ap = langage === "html" ? apercuHtml({ adresse: adresseApercu }) : creerApercu();
      ap.maj(racine.contenu());
      racine.append(ap);
    } else if (!actif && ap) {
      if (ap.retirer) ap.retirer();
      else ap.remove();
      ap = null;
    }
    racine.classList.toggle("zone-code-avec-apercu", actif);
  };
  racine.rechargerApercu = () => ap?.recharger?.();
  racine.definirCoupe = (oui) => ap?.definirCoupe?.(oui);
  // Bascule du mode hybride : la première ligne visible reste en haut, rien d'autre ne bouge (pas de surChangement).
  let hybrideActif = hybridePossible && hybride;
  racine.definirHybride = (actif) => {
    actif = hybridePossible && !!actif;
    if (actif === hybrideActif) return;
    hybrideActif = actif;
    const haut = vue.lineBlockAtHeight(vue.scrollDOM.scrollTop);
    // Première ligne visible dans un tableau : c'est le haut du tableau rendu qui va au bord haut, sans la marge de 5 px.
    const tableau = actif && tableauxHybride(vue.state).find((t) => t.debut <= haut.from && haut.from <= t.fin);
    vue.dispatch({
      effects: [
        compartimentHybride.reconfigure(actif ? extensionsHybride() : []),
        EditorView.scrollIntoView(tableau ? tableau.debut : haut.from, { y: "start", yMargin: tableau ? 0 : 5 }),
      ],
    });
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
    ap?.retirer?.();
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
