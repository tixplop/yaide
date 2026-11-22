import { StateEffect, StateField, EditorSelection, Prec } from "@codemirror/state";
import { EditorView, Decoration, ViewPlugin, keymap } from "@codemirror/view";
import { SearchQuery } from "@codemirror/search";
import { panneauRecherche } from "./panneau-recherche.js";

// REQ-159 (C-008) : recherche dans le texte d'un éditeur CodeMirror. Le panneau est de classe `ya-recherche-fichier`
// (`ya-recherche` est déjà la vue Recherche).
const definir = StateEffect.define();
const marqueOccurrence = Decoration.mark({ class: "ya-occurrence" });
const marqueCourante = Decoration.mark({ class: "ya-occurrence ya-occurrence-courante" });

// Toutes les occurrences du document : paires [from, to], de gauche à droite, sans chevauchement.
function occurrencesDe(doc, texte) {
  if (!texte) return [];
  const requete = new SearchQuery({ search: texte, literal: true, caseSensitive: false });
  const sortie = [];
  const it = requete.getCursor(doc);
  for (let r = it.next(); !r.done; r = it.next()) sortie.push([r.value.from, r.value.to]);
  return sortie;
}

const champRecherche = StateField.define({
  create: () => ({ texte: "", ouvert: false, occ: [] }),
  update(v, tr) {
    let { texte, ouvert } = v;
    let change = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(definir)) {
        texte = e.value.texte;
        ouvert = e.value.ouvert;
        change = true;
      }
    }
    if (!change) return v;
    return { texte, ouvert, occ: ouvert ? occurrencesDe(tr.state.doc, texte) : [] };
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
  const [from, to] = occ[i];
  vue.dispatch({ selection: EditorSelection.single(from, to), effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: "nearest" }), userEvent: "select" });
}

function fermer(vue) {
  if (!vue.state.field(champRecherche).ouvert) return;
  vue.dispatch({ effects: definir.of({ texte: "", ouvert: false }) });
  vue.focus();
}

function ouvrir(vue) {
  if (!vue.state.field(champRecherche).ouvert) vue.dispatch({ effects: definir.of({ texte: "", ouvert: true }) });
  panneaux.get(vue).ouvrir();
}

const panneaux = new WeakMap();

function creerPanneau(vue, nom) {
  const p = panneauRecherche({
    nom,
    surTexte: (texte) => vue.dispatch({ effects: definir.of({ texte, ouvert: true }) }),
    surSuivante: () => aller(vue, 1),
    surPrecedente: () => aller(vue, -1),
    surFermer: () => fermer(vue),
  });
  panneaux.set(vue, p);
  return {
    element: p.element,
    maj(etat) {
      const { texte, occ } = etat.field(champRecherche);
      p.definirTexte(texte);
      const i = indexCourant(etat);
      p.afficher(occ.length, i >= 0 ? i + 1 : undefined);
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
    EditorView.scrollMargins.of((v) => (v.state.field(champRecherche).ouvert ? { top: 42 } : null)),
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
    ouvrir: () => ouvrir(vue),
    fermer: () => fermer(vue),
    etat: () => {
      const { texte, ouvert } = vue.state.field(champRecherche);
      return { texte, ouvert };
    },
    reprendre: (e) => vue.dispatch({ effects: definir.of({ texte: e?.texte ?? "", ouvert: Boolean(e?.ouvert) }) }),
  };
}
