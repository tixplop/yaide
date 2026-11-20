import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { rendreMarkdown } from "./apercu.js";
import { estMac, lienDeDocument } from "../references.js";
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
        a.dataset.lien ??= a.getAttribute("href") ?? "";
        if (lienDeDocument(a.dataset.lien)) a.classList.add("cm-hy-suivable");
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
  return [plugin, suiviDesLiens({ surLien, surSurvol }), champTableaux, champDiagrammes, pluginDiagrammes, EditorView.editorAttributes.of({ class: "cm-hybride" })];
}
