import { StateEffect, StateField, EditorSelection, Prec } from "@codemirror/state";
import { EditorView, Decoration, ViewPlugin, keymap } from "@codemirror/view";
import { SearchQuery } from "@codemirror/search";
import { panneauRecherche } from "./panneau-recherche.js";

// REQ-159 (C-008) : recherche dans le texte d'un éditeur CodeMirror. Le panneau est de classe `ya-recherche-fichier`
// (`ya-recherche` est déjà la vue Recherche).
const definir = StateEffect.define();
const marqueOccurrence = Decoration.mark({ class: "ya-occurrence" });
const marqueCourante = Decoration.mark({ class: "ya-occurrence ya-occurrence-courante" });

// Requête de CodeMirror : le texte tel quel (`literal`), ou une expression régulière de JavaScript.
const requete = (texte, { casse, regex }, remplacement = "") => new SearchQuery({ search: texte, literal: true, caseSensitive: casse, regexp: regex, replace: remplacement });

// Toutes les occurrences du document : triplets [from, to, match], de gauche à droite, sans chevauchement, sans partie vide.
// `invalide` : expression régulière refusée.
function occurrencesDe(doc, texte, options) {
  if (!texte) return { occ: [], invalide: false };
  const q = requete(texte, options);
  if (!q.valid) return { occ: [], invalide: true };
  const sortie = [];
  const it = q.getCursor(doc);
  for (let r = it.next(); !r.done; r = it.next()) if (r.value.to > r.value.from) sortie.push([r.value.from, r.value.to, r.value.match]);
  return { occ: sortie, invalide: false };
}

const ETAT_FERME = { texte: "", ouvert: false, casse: false, regex: false };

const champRecherche = StateField.define({
  create: () => ({ ...ETAT_FERME, invalide: false, occ: [] }),
  update(v, tr) {
    let suivant = v;
    let change = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(definir)) {
        suivant = { ...suivant, ...e.value };
        change = true;
      }
    }
    if (!change) return v;
    const { texte, ouvert, casse, regex } = suivant;
    return { texte, ouvert, casse, regex, ...(ouvert ? occurrencesDe(tr.state.doc, texte, { casse, regex }) : { occ: [], invalide: false }) };
  },
});

function indexCourant(etat) {
  const { occ } = etat.field(champRecherche);
  const s = etat.selection.main;
  return occ.findIndex(([from, to]) => from === s.from && to === s.to);
}

function aller(vue, sens) {
  const { occ, ouvert } = vue.state.field(champRecherche);
  if (!ouvert || !occ.length) return;
  const n = occ.length;
  const courant = indexCourant(vue.state);
  const tete = vue.state.selection.main.head;
  let i;
  if (sens > 0) {
    i = courant >= 0 ? (courant + 1) % n : occ.findIndex(([from]) => from >= tete);
    if (i < 0) i = 0;
  } else if (courant >= 0) i = (courant - 1 + n) % n;
  else {
    i = occ.findLastIndex(([, to]) => to <= tete);
    if (i < 0) i = n - 1;
  }
  selectionner(vue, occ[i], "select");
}

function selectionner(vue, [from, to], userEvent, changes) {
  vue.dispatch({ ...(changes ? { changes } : {}), selection: EditorSelection.single(from, to), effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: "nearest" }), userEvent });
}

// L'occurrence que F3 choisirait : la courante, sinon la première qui commence au curseur ou après.
function cibleRemplacement(etat) {
  const { occ } = etat.field(champRecherche);
  const courant = indexCourant(etat);
  if (courant >= 0) return occ[courant];
  return occ.find(([from]) => from >= etat.selection.main.head) ?? occ[0];
}

// Remplace l'occurrence courante en une transaction ; la première qui commence après le texte mis à la place devient courante.
function remplacer(vue, remplacement) {
  const { texte, casse, regex, occ } = vue.state.field(champRecherche);
  if (!occ.length) return;
  const [from, to, match] = cibleRemplacement(vue.state);
  const insert = requete(texte, { casse, regex }, remplacement).create().getReplacement({ match });
  const tr = vue.state.update({ changes: { from, to, insert }, userEvent: "input.replace" });
  const { occ: apres } = occurrencesDe(tr.state.doc, texte, { casse, regex });
  const fin = from + insert.length;
  const suivante = apres.find(([f]) => f >= fin) ?? apres[0];
  if (suivante) selectionner(vue, suivante, "input.replace", { from, to, insert });
  else vue.dispatch(tr);
}

// Remplace toutes les occurrences en une transaction, sur le texte d'avant.
function toutRemplacer(vue, remplacement) {
  const { texte, casse, regex, occ } = vue.state.field(champRecherche);
  if (!occ.length) return;
  const q = requete(texte, { casse, regex }, remplacement).create();
  vue.dispatch({ changes: occ.map(([from, to, match]) => ({ from, to, insert: q.getReplacement({ match }) })), userEvent: "input.replace" });
  panneaux.get(vue).annoncerRemplacees(occ.length);
}

function fermer(vue) {
  if (!vue.state.field(champRecherche).ouvert) return;
  vue.dispatch({ effects: definir.of(ETAT_FERME) });
  vue.focus();
}

// `remplacement` : avec la ligne de remplacement (Ctrl+H).
function ouvrir(vue, { remplacement = false } = {}) {
  const dejaOuvert = vue.state.field(champRecherche).ouvert;
  if (!dejaOuvert) vue.dispatch({ effects: definir.of({ ...ETAT_FERME, ouvert: true }) });
  const p = panneaux.get(vue);
  if (remplacement && dejaOuvert) p.montrerRemplacement();
  else {
    if (remplacement) p.definirRemplacement("");
    p.ouvrir();
  }
  vue.requestMeasure();
}

const panneaux = new WeakMap();

function creerPanneau(vue, nom) {
  const p = panneauRecherche({
    nom,
    surTexte: (texte) => vue.dispatch({ effects: definir.of({ texte }) }),
    surOptions: ({ casse, regex }) => vue.dispatch({ effects: definir.of({ casse, regex }) }),
    surRemplacer: (t) => remplacer(vue, t),
    surToutRemplacer: (t) => toutRemplacer(vue, t),
    surSuivante: () => aller(vue, 1),
    surPrecedente: () => aller(vue, -1),
    surFermer: () => fermer(vue),
  });
  panneaux.set(vue, p);
  return {
    element: p.element,
    maj(etat) {
      const { texte, occ, casse, regex, invalide } = etat.field(champRecherche);
      p.definirTexte(texte);
      p.definirOptions({ casse, regex });
      const i = indexCourant(etat);
      p.afficher(occ.length, i >= 0 ? i + 1 : undefined, { invalide });
    },
  };
}

// Extension de recherche : `{ extension, ouvrir, fermer, etat, reprendre }`. `attacher(vue)` relie les fonctions à la vue.
export function rechercheFichier({ nom }) {
  let vue = null;
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(v) {
        this.vue = v;
        this.panneau = null;
        this.deco = Decoration.none;
        this.maj(v.state);
      }
      update(u) {
        this.maj(u.state, u.docChanged || u.viewportChanged || u.selectionSet || u.startState.field(champRecherche) !== u.state.field(champRecherche));
      }
      maj(etat, decorer = true) {
        const { ouvert, occ } = etat.field(champRecherche);
        if (ouvert && !this.panneau) {
          this.panneau = creerPanneau(this.vue, nom);
          this.vue.dom.insertBefore(this.panneau.element, this.vue.scrollDOM);
        } else if (!ouvert && this.panneau) {
          this.panneau.element.remove();
          this.panneau = null;
          panneaux.delete(this.vue);
        }
        this.panneau?.maj(etat);
        if (!decorer) return;
        const posees = [];
        if (ouvert) {
          const courant = indexCourant(etat);
          // Seule la partie affichée est décorée.
          for (const r of this.vue.visibleRanges) {
            occ.forEach(([from, to], i) => {
              if (to > r.from && from < r.to) posees.push((i === courant ? marqueCourante : marqueOccurrence).range(from, to));
            });
          }
        }
        this.deco = Decoration.set(posees, true);
      }
      destroy() {
        this.panneau?.element.remove();
      }
    },
    { decorations: (p) => p.deco },
  );
  const extension = [
    champRecherche,
    plugin,
    // Le haut de l'éditeur laisse la hauteur réelle du panneau (une ou deux rangées) et 8 px.
    EditorView.scrollMargins.of((v) => (v.state.field(champRecherche).ouvert && panneaux.has(v) ? { top: panneaux.get(v).element.offsetHeight + 8 } : null)),
    Prec.high(
      keymap.of([
        { key: "F3", run: (v) => (v.state.field(champRecherche).ouvert ? (aller(v, 1), true) : false) },
        { key: "Shift-F3", run: (v) => (v.state.field(champRecherche).ouvert ? (aller(v, -1), true) : false) },
      ]),
    ),
  ];
  return {
    extension,
    attacher: (v) => (vue = v),
    ouvrir: (o) => ouvrir(vue, o),
    fermer: () => fermer(vue),
    etat: () => {
      const { texte, ouvert, casse, regex } = vue.state.field(champRecherche);
      return { texte, ouvert, casse, regex, remplacement: panneaux.get(vue)?.remplacement() ?? null };
    },
    reprendre(e) {
      vue.dispatch({ effects: definir.of({ texte: e?.texte ?? "", ouvert: Boolean(e?.ouvert), casse: Boolean(e?.casse), regex: Boolean(e?.regex) }) });
      if (e?.ouvert && e.remplacement != null) panneaux.get(vue).definirRemplacement(e.remplacement);
    },
  };
}
