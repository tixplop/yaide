import { ChangeSet, EditorSelection, Prec, StateEffect, StateField } from "@codemirror/state";
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

// Lignes visées par la sélection principale : celles qu'elle touche (la dernière est écartée si la sélection s'arrête
// à son début), ou celle du curseur.
function lignesVisees(etat) {
  const { from, to } = etat.selection.main;
  const doc = etat.doc;
  const premiere = doc.lineAt(from).number;
  let derniere = doc.lineAt(to).number;
  if (to > from && doc.line(derniere).from === to) derniere -= 1;
  const lignes = [];
  for (let n = premiere; n <= derniere; n++) lignes.push(doc.line(n));
  return lignes;
}

const vide = (ligne) => ligne.text.trim() === "";

// Applique `remplacer(ligne, rang)` (`null` : ligne inchangée) aux lignes non vides visées, ou à la ligne vide du curseur
// quand elle est seule. La sélection suit son texte.
function parLigne(etat, remplacer) {
  let lignes = lignesVisees(etat);
  const pleines = lignes.filter((l) => !vide(l));
  if (pleines.length > 0) lignes = pleines;
  else if (lignes.length > 1) return transaction(etat, { selection: etat.selection });
  const changes = [];
  lignes.forEach((ligne, rang) => {
    const c = remplacer(ligne, rang);
    if (c) changes.push(c);
  });
  const jeu = ChangeSet.of(changes, etat.doc.length);
  return transaction(etat, { changes: jeu, selection: EditorSelection.create([etat.selection.main.map(jeu, 1)]) });
}

// Titre : texte, `# `, `## `, `### `, puis texte ; de `####` à `######`, texte.
export function titre(etat) {
  return parLigne(etat, (ligne) => {
    const m = /^(#{1,6}) /.exec(ligne.text);
    const niveau = m ? m[1].length : 0;
    const marque = niveau < 3 ? `${"#".repeat(niveau + 1)} ` : "";
    return { from: ligne.from, to: ligne.from + (m ? m[0].length : 0), insert: marque };
  });
}

// Marque de tête d'une ligne : ajoutée à toutes, ou retirée si toutes l'ont déjà ; `autres` : marques remplacées.
function marquer(etat, aDeja, autres, marque) {
  const pleines = lignesVisees(etat).filter((l) => !vide(l));
  const cibles = pleines.length > 0 ? pleines : lignesVisees(etat);
  const retirer = pleines.length > 0 && cibles.every((l) => aDeja.test(l.text));
  return parLigne(etat, (ligne, rang) => {
    const existante = ligne.text.match(aDeja) ?? ligne.text.match(autres);
    const longueur = existante ? existante[0].length : 0;
    return { from: ligne.from, to: ligne.from + longueur, insert: retirer ? "" : marque(rang) };
  });
}

export const citation = (etat) => marquer(etat, /^> /, /^(?!)/, () => "> ");
export const listePuces = (etat) => marquer(etat, /^- /, /^([*+] |\d+\. )/, () => "- ");
export const listeNumerotee = (etat) => marquer(etat, /^\d+\. /, /^([-*+] )/, (rang) => `${rang + 1}. `);

// Lien : `[sélection](url)` avec `url` choisi ; sans sélection `[texte](url)` avec `texte` choisi.
export function lien(etat) {
  const { from, to } = etat.selection.main;
  if (from === to) {
    return transaction(etat, { changes: { from, insert: "[texte](url)" }, selection: EditorSelection.single(from + 1, from + 6) });
  }
  return transaction(etat, {
    changes: [{ from, insert: "[" }, { from: to, insert: "](url)" }],
    selection: EditorSelection.single(to + 3, to + 6),
  });
}

// Image : `![[sélection]]`, sélection gardée ; sans sélection `![[image.png]]` avec `image.png` choisi.
export function image(etat) {
  const { from, to } = etat.selection.main;
  if (from === to) {
    return transaction(etat, { changes: { from, insert: "![[image.png]]" }, selection: EditorSelection.single(from + 3, from + 12) });
  }
  return transaction(etat, {
    changes: [{ from, insert: "![[" }, { from: to, insert: "]]" }],
    selection: EditorSelection.single(from + 3, to + 3),
  });
}

// Whiteboard : `![[sélection.jdiag]]` (`.jdiag` ajouté s'il manque, casse ignorée), sélection gardée sur le même texte ;
// sans sélection `![[whiteboard.jdiag]]` avec `whiteboard` seul choisi.
export function whiteboard(etat) {
  const { from, to } = etat.selection.main;
  if (from === to) {
    return transaction(etat, { changes: { from, insert: "![[whiteboard.jdiag]]" }, selection: EditorSelection.single(from + 3, from + 13) });
  }
  const fin = /\.jdiag$/i.test(etat.sliceDoc(from, to)) ? "]]" : ".jdiag]]";
  return transaction(etat, {
    changes: [{ from, insert: "![[" }, { from: to, insert: fin }],
    selection: EditorSelection.single(from + 3, to + 3),
  });
}

// Insère `bloc` sous la ligne du curseur, séparé du texte voisin par une ligne vide (jamais doublée) ; le curseur va
// sur la ligne vide qui suit.
function insererSous(etat, bloc) {
  const doc = etat.doc;
  const ligne = doc.lineAt(etat.selection.main.head);
  const suivante = ligne.number < doc.lines ? doc.line(ligne.number + 1) : null;
  let pos = ligne.to;
  let tete = "\n\n";
  if (vide(ligne)) tete = "\n";
  else if (suivante && vide(suivante)) {
    pos = suivante.to;
    tete = "\n";
  }
  const insere = `${tete}${bloc}\n`;
  return transaction(etat, { changes: { from: pos, insert: insere }, selection: EditorSelection.single(pos + insere.length) });
}

export const tableau = (etat) => insererSous(etat, "| Colonne 1 | Colonne 2 |\n| --- | --- |\n|  |  |\n|  |  |");
export const separateur = (etat) => insererSous(etat, "---");

// Bloc de code : autour du texte choisi ; sans sélection, un bloc vide (sur la ligne si elle est vide, sinon sous elle).
export function blocCode(etat) {
  const { from, to, head } = etat.selection.main;
  if (from !== to) return blocDeCode(etat);
  const ligne = etat.doc.lineAt(head);
  const videLigne = ligne.text === "";
  const pos = videLigne ? ligne.from : ligne.to;
  const insere = videLigne ? "```\n\n```" : "\n```\n\n```";
  return transaction(etat, {
    changes: { from: pos, to: videLigne ? ligne.to : pos, insert: insere },
    selection: EditorSelection.single(pos + insere.indexOf("\n\n") + 1),
    effects: [frappes.of(null)],
  });
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
