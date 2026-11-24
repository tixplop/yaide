import { EditorSelection, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

// Mise en forme markdown (REQ-169) : chaque action prend un EditorState et rend une transaction isolée dans
// l'historique (un Ctrl+Z la défait entière). Réutilisée telle quelle par la barre « Mise en forme » (REQ-170).

function transaction(etat, spec) {
  const selection = spec.selection;
  return etat.update({
    ...spec,
    isolateHistory: "full",
    userEvent: "input",
    effects: [...(spec.effects ?? []), EditorView.scrollIntoView(selection.main, { y: "nearest" })],
  });
}

// Entoure la sélection principale de `ouvre` et `ferme`, ou retire ces marques si elles l'entourent déjà.
function entourer(etat, ouvre, ferme) {
  const { from, to } = etat.selection.main;
  const doc = etat.doc;
  const avant = doc.sliceString(Math.max(0, from - ouvre.length), from);
  const apres = doc.sliceString(to, to + ferme.length);
  if (avant === ouvre && apres === ferme) {
    return transaction(etat, {
      changes: [{ from: from - ouvre.length, to: from }, { from: to, to: to + ferme.length }],
      selection: EditorSelection.single(from - ouvre.length, to - ouvre.length),
    });
  }
  return transaction(etat, {
    changes: [{ from, insert: ouvre }, { from: to, insert: ferme }],
    selection: EditorSelection.single(from + ouvre.length, to + ouvre.length),
  });
}

export const gras = (etat) => entourer(etat, "**", "**");
export const italique = (etat) => entourer(etat, "*", "*");
export const souligne = (etat) => entourer(etat, "<u>", "</u>");
export const barre = (etat) => entourer(etat, "~~", "~~");

// Nombre de frappes d'accent grave faites sur la même sélection : { n, from, to } ou null.
const frappes = StateEffect.define();
const champFrappes = StateField.define({
  create: () => null,
  update(valeur, tr) {
    for (const e of tr.effects) if (e.is(frappes)) return e.value;
    if (!valeur || tr.docChanged) return null;
    const { from, to } = tr.newSelection.main;
    return from === valeur.from && to === valeur.to ? valeur : null;
  },
});

// Bloc de code autour du texte choisi `[de, a]`, dont les `k` accents graves de chaque côté sont retirés : une ligne
// ``` avant, une après ; ce qui était avant ou après sur les mêmes lignes reste sur sa propre ligne.
function blocDeCode(etat, k = 0) {
  const { from, to } = etat.selection.main;
  const doc = etat.doc;
  const debut = from - k;
  const fin = to + k;
  const avant = doc.sliceString(doc.lineAt(debut).from, debut).trimEnd();
  const apres = doc.sliceString(fin, doc.lineAt(fin).to).trimStart();
  const tete = (avant ? `${avant}\n` : "") + "```\n";
  const texte = doc.sliceString(from, to);
  const insere = `${tete}${texte}\n\`\`\`${apres ? `\n${apres}` : ""}`;
  const remplaceDe = doc.lineAt(debut).from;
  const remplaceA = doc.lineAt(fin).to;
  const nouveauDebut = remplaceDe + tete.length;
  return transaction(etat, {
    changes: { from: remplaceDe, to: remplaceA, insert: insere },
    selection: EditorSelection.single(nouveauDebut, nouveauDebut + texte.length),
    effects: [frappes.of(null)],
  });
}

// Une frappe d'accent grave sur un texte choisi : un de plus de chaque côté ; à la troisième, un bloc de code.
export function accentGrave(etat) {
  const { from, to } = etat.selection.main;
  const suivi = etat.field(champFrappes, false);
  const n = suivi && suivi.from === from && suivi.to === to ? suivi.n : 0;
  if (n >= 2) return blocDeCode(etat, 2);
  // Les accents graves s'ajoutent toujours : ils ne se retirent pas comme les autres marques.
  return transaction(etat, {
    changes: [{ from, insert: "`" }, { from: to, insert: "`" }],
    selection: EditorSelection.single(from + 1, to + 1),
    effects: [frappes.of({ n: n + 1, from: from + 1, to: to + 1 })],
  });
}

// Bouton « Code en ligne » : comme une frappe de `` ` `` sur un texte choisi ; sans sélection, deux accents graves.
export function codeEnLigne(etat) {
  const { from, to } = etat.selection.main;
  if (from === to) return transaction(etat, { changes: { from, insert: "``" }, selection: EditorSelection.single(from + 1) });
  return accentGrave(etat);
}

function agir(action) {
  return (vue) => {
    vue.dispatch(action(vue.state));
    return true;
  };
}

// Raccourcis et frappe d'accent grave du mode hybride, posés et retirés avec lui.
export const extensionMiseEnForme = [
  champFrappes,
  Prec.high(
    keymap.of([
      { key: "Mod-b", run: agir(gras), preventDefault: true },
      { key: "Mod-i", run: agir(italique), preventDefault: true },
      { key: "Mod-u", run: agir(souligne), preventDefault: true },
    ]),
  ),
  EditorView.inputHandler.of((vue, from, to, texte) => {
    const s = vue.state.selection.main;
    if (texte !== "`" || s.empty || s.from !== from || s.to !== to) return false;
    vue.dispatch(accentGrave(vue.state));
    return true;
  }),
];
