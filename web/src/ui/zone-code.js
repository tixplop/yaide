import { EditorState, Compartment, Prec, StateField, RangeSetBuilder, RangeSet } from "@codemirror/state";
import { EditorView, Decoration, GutterMarker, keymap, lineNumbers, lineNumberWidgetMarker, gutterLineClass, drawSelection, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { supportLangage } from "./langages.js";
import { apercu as creerApercu } from "./apercu.js";
import { apercuHtml } from "./apercu-html.js";
import { image } from "./image.js";
import { chargerMermaid, adresseDiagramme } from "./diagramme.js";
import { couleurs } from "./couleurs-code.js";
import { extensionMiseEnForme } from "./mise-en-forme.js";
import { barreMd } from "./barre-md.js";
import { hybride as extensionHybride, TableauRendu, DiagrammeRendu, tableauxHybride, diagrammesRendus, validerSaisie, majImagesHybride } from "./hybride.js";
import { themeCourant, themeTableur } from "./theme.js";
import { tableur } from "./tableur.js";
import { lireCsv, debutChamp, celluleA } from "../csv.js";
import { rechercheFichier } from "./recherche-fichier.js";
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

// Diagramme rendu : un seul numéro, celui de la ligne ```mermaid, décalé de --space-1 comme le diagramme (composants.css).
class NumeroDiagramme extends NumeroTableau {
  constructor(numero) {
    super(numero);
    this.elementClass = "cm-hy-numero-diagramme";
  }
}
const numerosDesDiagrammes = lineNumberWidgetMarker.of((vue, widget, bloc) => (widget instanceof DiagrammeRendu ? new NumeroDiagramme(vue.state.doc.lineAt(bloc.from).number) : null));

// Haut et Bas : CodeMirror ne sait pas entrer dans un tableau ou un diagramme rendu (le curseur saute ailleurs).
// Depuis la dernière rangée affichée de la ligne au-dessus (ou la première de celle en dessous), le curseur va
// sur la première (ou la dernière) ligne du bloc, à la même colonne si elle existe.
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
    const tableau = [...tableauxHybride(vue.state), ...diagrammesRendus(vue.state)].find((t) => (bas ? t.debut === cible.from : t.fin === cible.to));
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

// Aperçu d'un SVG : une image C-017 dont la source est le texte lui-même (aucun script, aucune requête).
function apercuSvg(nom, texte) {
  const adresse = (t) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(t)}`;
  const z = image({ src: adresse(texte), nom, zone: "apercu" });
  z.element.maj = (t) => z.changerSource(adresse(t));
  return z.element;
}

// Aperçu d'un `.mmd` : image C-017 vide tant qu'aucun dessin n'a réussi ; un texte illisible garde le dernier dessin (REQ-123).
function apercuMmd(nom, texte) {
  const z = image({ nom, zone: "apercu", chargement: false });
  let minuteur = null;
  let jeton = 0;
  let courant = texte;
  let aReprendre = false;
  async function dessiner() {
    const mon = ++jeton;
    if (!courant.trim()) {
      z.definirEtat("absente");
      return;
    }
    let mermaid;
    try {
      mermaid = await chargerMermaid();
    } catch {
      if (mon === jeton) aReprendre = true; // coupure : dessin au retour
      return;
    }
    const d = await mermaid.dessiner(courant).catch(() => null);
    if (mon !== jeton || !d) return;
    z.changerSource(adresseDiagramme(d.svg));
  }
  const el = z.element;
  el.maj = (t) => {
    courant = t;
    aReprendre = false;
    clearTimeout(minuteur);
    minuteur = setTimeout(dessiner, 100);
  };
  el.definirCoupe = (oui) => {
    z.definirCoupe(oui);
    if (!oui && aReprendre) {
      aReprendre = false;
      dessiner();
    }
  };
  el.retirer = () => {
    clearTimeout(minuteur);
    jeton++;
    el.remove();
  };
  dessiner();
  return el;
}

export function zoneCode({ contenu = "", langage, mode = "edition", apercu = false, hybride = false, adresseApercu, images, document: cheminDocument, ligne, nom = "", surChangement, surPosition, surLien, surSurvolLien, surTableur, recherche } = {}) {
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
  const compartimentLangage = new Compartment();
  const compartimentHybride = new Compartment();
  const hybridePossible = langage === "markdown" && !diff;
  const imagesChargees = new Map(); // images `![[nom]]` chargées de l'onglet, gardées d'un aperçu à l'autre
  const extensionsHybride = () => [extensionHybride({ surLien: suivreLien, surSurvol: surSurvolLien, images, chargees: imagesChargees }), numerosDesTitres, numerosDesTableaux, numerosDesDiagrammes, clavierTableau, extensionMiseEnForme, EditorView.lineWrapping];
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
    extensions.push(compartimentLangage.of(langage ? supportLangage(langage) : []));
  }
  const rech = recherche && !diff ? rechercheFichier({ nom: recherche.nom ?? nom }) : null;
  if (rech) extensions.push(rech.extension);
  extensions.push(compartimentHybride.of(hybridePossible && hybride ? extensionsHybride() : []));
  extensions.push(
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        if (ap) ap.maj(u.state.doc.toString());
        surChangement?.(u.state.doc.toString());
        if (csvActif) suivreCsv(u);
      }
      if ((u.docChanged || u.selectionSet) && surPosition) signalerPosition(u.state);
    }),
  );

  let ap = null;

  // Fichier CSV (REQ-157) : l'éditeur reste dans la page avec son document ; il prend `hidden` quand la grille est affichée.
  const csv = /\.csv$/i.test(nom) && !diff;
  let csvActif = csv && hybride;
  let tab = null;
  let grille = false;
  let alerte = null;
  let depuisDisque = false;
  function etatTableur(g, a) {
    if (g === grille && a === alerte) return;
    grille = g;
    alerte = a;
    surTableur?.({ grille, alerte });
  }
  // Montre la grille : la cellule active est celle du champ où est le curseur.
  // Le thème propre au tableur (REQ-158) : l'attribut seulement avec un choix, sinon la zone suit `<html>`.
  function appliquerThemeTableur() {
    const t = themeTableur();
    for (const el of [tab.element, tab.zone]) {
      if (t) el.dataset.theme = t;
      else delete el.dataset.theme;
    }
  }
  function afficherGrille(l, focus) {
    if (!tab) {
      tab = tableur({ vue, nom: recherche?.nom ?? nom });
      appliquerThemeTableur();
      racine.append(tab.element);
    }
    tab.rafraichir();
    const { r, c } = celluleA(l, vue.state.selection.main.head);
    tab.activer(r, c, false);
    hote.hidden = true;
    tab.element.hidden = tab.zone.hidden = false;
    if (focus) tab.focuser();
    etatTableur(true, null);
  }
  // Montre le texte, le curseur en `pos` (ligne centrée) ; le focus va à l'éditeur si `focus`.
  // `differe` : appelé pendant une mise à jour de l'éditeur, qui n'accepte pas de transaction.
  function afficherTexte(pos, focus, refus, differe = false) {
    if (tab) tab.element.hidden = tab.zone.hidden = true;
    hote.hidden = false;
    const placer = () => {
      if (pos !== undefined) vue.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      if (focus) vue.focus();
    };
    etatTableur(false, refus ? `Tableur indisponible : ${refus}` : null);
    if (differe) queueMicrotask(placer);
    else placer();
  }
  function suivreCsv(u) {
    const l = lireCsv(vue.state.doc.toString());
    if (!l.refus) {
      if (grille) {
        tab.rafraichir();
        etatTableur(true, null);
      } else {
        afficherGrille(l, vue.hasFocus);
      }
    } else if (grille) {
      const focus = tab.element.contains(document.activeElement);
      let pos = 0;
      if (!depuisDisque) {
        pos = null;
        u.changes.iterChangedRanges((_, __, fromB) => (pos ??= fromB));
        pos = Math.min(pos ?? 0, u.state.doc.length);
      }
      afficherTexte(pos, focus, l.refus, true);
    } else etatTableur(false, `Tableur indisponible : ${l.refus}`);
  }
  function signalerPosition(etat) {
    const tete = etat.selection.main.head;
    const l = etat.doc.lineAt(tete);
    surPosition(l.number, tete - l.from + 1);
  }
  const vue = new EditorView({ state: EditorState.create({ doc: contenu, extensions }), parent: hote });

  racine.vue = vue;
  if (rech) {
    rech.attacher(vue);
    // Sur un `.csv`, la recherche du tableur quand la grille est affichée, sinon celle du texte.
    const affichee = () => (grille && tab ? tab.recherche : rech);
    racine.recherche = { ouvrir: () => affichee().ouvrir(), fermer: () => affichee().fermer(), etat: () => affichee().etat(), reprendre: (e) => affichee().reprendre(e) };
  }
  if (csv) {
    // Tous les appels de focus de l'éditeur vont à la grille quand elle est affichée.
    const focusCm = vue.focus.bind(vue);
    vue.focus = () => (grille ? tab.focuser() : focusCm());
  }
  if (csvActif) {
    const l = lireCsv(contenu);
    if (l.refus) etatTableur(false, `Tableur indisponible : ${l.refus}`);
    else afficherGrille(l, false);
  }
  racine.grilleAffichee = () => grille;
  racine.tableurContient = (noeud) => Boolean(tab?.element.contains(noeud));
  racine.definirThemeTableur = () => {
    if (tab) appliquerThemeTableur();
  };
  // Change la coloration sans recréer la vue : texte, historique, curseur et défilement restent.
  racine.changerLangage = (id) => {
    if (!diff) vue.dispatch({ effects: compartimentLangage.reconfigure(id ? supportLangage(id) : []) });
  };
  racine.contenu = () => vue.state.doc.toString();
  // Fichier HTML : « page seule » (apercu) et « côte à côte » (hybride) s'excluent ; les deux faux, l'éditeur seul sans cadre.
  // Passer de l'un à l'autre ne recrée ni l'éditeur ni le cadre.
  const html = langage === "html" && !diff;
  let htmlApercu = false;
  let htmlHybride = false;
  function majHtml() {
    const cadre = htmlApercu || htmlHybride;
    if (cadre && !ap) {
      ap = apercuHtml({ adresse: adresseApercu });
      racine.append(ap);
    } else if (!cadre && ap) {
      ap.retirer();
      ap = null;
    }
    hote.hidden = htmlApercu;
    racine.classList.toggle("zone-code-page-seule", htmlApercu);
    racine.classList.toggle("zone-code-avec-apercu", htmlHybride);
  }
  // Case de l'aperçu (REQ-171) : `[ ]` et `[x]` s'échangent sur la ligne source, rien d'autre ne change.
  const CASE = /^((?:[ \t]*(?:>|[-*+]|\d+[.)]))*[ \t]+)\[( |x|X)\](?=[ \t])/;
  function basculerCase(index) {
    if (index < 0 || index >= vue.state.doc.lines) return;
    const l = vue.state.doc.line(index + 1);
    const m = CASE.exec(l.text);
    if (!m) return;
    const de = l.from + m[1].length + 1;
    vue.dispatch({ changes: { from: de, to: de + 1, insert: m[2] === " " ? "x" : " " }, userEvent: "input.case" });
  }
  racine.definirApercu = (actif) => {
    if (html) {
      htmlApercu = !!actif;
      if (htmlApercu) htmlHybride = false;
      return majHtml();
    }
    if (actif && !ap) {
      if (/\.svg$/i.test(nom)) ap = apercuSvg(nom, racine.contenu());
      else if (/\.mmd$/i.test(nom)) ap = apercuMmd(nom, racine.contenu());
      else {
        ap = creerApercu({ document: cheminDocument, surLien, surCase: basculerCase, images, chargees: imagesChargees });
        ap.maj(racine.contenu());
      }
      racine.append(ap);
    } else if (!actif && ap) {
      if (ap.retirer) ap.retirer();
      else ap.remove();
      ap = null;
    }
    racine.classList.toggle("zone-code-avec-apercu", actif);
  };
  racine.rechargerApercu = () => ap?.recharger?.();
  racine.majImages = () => {
    ap?.majImages?.();
    if (hybrideActif) vue.dispatch({ effects: majImagesHybride.of(true) });
  };
  racine.definirCoupe = (oui) => ap?.definirCoupe?.(oui);
  // Bascule du mode hybride : la première ligne visible reste en haut, rien d'autre ne bouge (pas de surChangement).
  let hybrideActif = hybridePossible && hybride;
  // Barre « Mise en forme » (REQ-170) : créée une fois, posée et retirée avec le mode hybride, sans toucher à l'éditeur.
  let barre = null;
  function majBarre() {
    if (hybrideActif) {
      barre ??= barreMd({ vue });
      if (!barre.isConnected) hote.prepend(barre);
    } else barre?.remove();
  }
  majBarre();
  racine.definirHybride = (actif) => {
    if (csv) return definirHybrideCsv(!!actif);
    if (html) {
      htmlHybride = !!actif;
      if (htmlHybride) htmlApercu = false;
      return majHtml();
    }
    actif = hybridePossible && !!actif;
    if (actif === hybrideActif) return;
    hybrideActif = actif;
    majBarre();
    const haut = vue.lineBlockAtHeight(vue.scrollDOM.scrollTop);
    // Première ligne visible dans un tableau ou un diagramme dessiné : c'est le haut du bloc rendu qui va au bord haut, sans la marge de 5 px.
    const tableau = actif && [...tableauxHybride(vue.state), ...diagrammesRendus(vue.state)].find((t) => t.debut <= haut.from && haut.from <= t.fin);
    vue.dispatch({
      effects: [
        compartimentHybride.reconfigure(actif ? extensionsHybride() : []),
        EditorView.scrollIntoView(tableau ? tableau.debut : haut.from, { y: "start", yMargin: tableau ? 0 : 5 }),
      ],
    });
  };
  // Le curseur reste sur la même ligne (bornée au nouveau texte), à la même colonne si elle existe encore.
  function definirHybrideCsv(actif) {
    if (actif === csvActif) return;
    // La recherche ouverte se ferme, le focus reste sur le bouton (REQ-160).
    tab?.recherche.fermer(false);
    rech?.reprendre(null);
    if (!actif) {
      tab?.validerSaisie();
      csvActif = false;
      if (!grille) return etatTableur(false, null);
      const l = lireCsv(vue.state.doc.toString());
      const { r, c } = tab.celluleActive();
      afficherTexte(l.refus ? undefined : debutChamp(l, Math.min(r, l.rangees.length - 1), Math.min(c, l.colonnes - 1)), false, null);
      return;
    }
    csvActif = true;
    const l = lireCsv(vue.state.doc.toString());
    if (l.refus) etatTableur(false, `Tableur indisponible : ${l.refus}`);
    else afficherGrille(l, false);
  }
  racine.validerSaisie = () => {
    validerSaisie(vue);
    tab?.validerSaisie();
  };
  racine.remplacer = (texte) => {
    racine.validerSaisie();
    const doc = vue.state.doc;
    const tete = doc.lineAt(vue.state.selection.main.head);
    const colonne = vue.state.selection.main.head - tete.from;
    const nouveau = vue.state.update({ changes: { from: 0, to: doc.length, insert: texte } }).state.doc;
    const ligne = nouveau.line(Math.min(tete.number, nouveau.lines));
    depuisDisque = true;
    try {
      vue.dispatch({
        changes: { from: 0, to: doc.length, insert: texte },
        selection: { anchor: ligne.from + Math.min(colonne, ligne.length) },
      });
    } finally {
      depuisDisque = false;
    }
  };
  const suivreTheme = (e) => vue.dispatch({ effects: compartiment.reconfigure(e.detail === "dark" ? themeSombre : themeClair) });
  document.addEventListener("yaide-theme", suivreTheme);
  racine.detruire = () => {
    document.removeEventListener("yaide-theme", suivreTheme);
    ap?.retirer?.();
    barre?.detruire();
    tab?.detruire();
    vue.destroy();
  };
  if (apercu) racine.definirApercu(true);
  else if (html && hybride) racine.definirHybride(true);

  racine.aller = (numero) => {
    const doc = vue.state.doc;
    const l = doc.line(Math.min(Math.max(numero, 1), doc.lines));
    vue.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
  };
  if (Number.isInteger(ligne)) racine.aller(ligne);
  if (surPosition) signalerPosition(vue.state);
  return racine;
}
