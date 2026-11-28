import { undo, redo, isolateHistory } from "@codemirror/commands";
import { lireCsv, changerCellule, insererColonne, supprimerColonne, insererRangee, supprimerRangee } from "../csv.js";
import { champSaisie, decalageDuClic, aidesSurvol } from "./hybride.js";
import { panneauRecherche, chercherTexte, remplacerTexte, marquerOccurrences, retirerMarques } from "./panneau-recherche.js";
import { estMac } from "../references.js";

// Tableur d'un fichier CSV (C-008 `hybride` sur un `.csv`, REQ-157, DEC-109). `vue` est l'EditorView de l'onglet,
// masquée par l'appelant : le document y reste la source, chaque saisie validée y est une transaction.
export function tableur({ vue, nom }) {
  const zone = document.createElement("div");
  zone.className = "ya-tableur";
  const table = document.createElement("table");
  table.setAttribute("role", "grid");
  table.setAttribute("aria-label", `Tableur ${nom}`);
  const grille = document.createElement("div"); // porte le calque des aides, au-dessus de la grille
  grille.className = "ya-tableur-grille";
  grille.append(table);
  zone.append(grille);
  // Conteneur du tableur : le panneau de recherche (REQ-160) en est le premier enfant, avant la grille.
  const conteneur = document.createElement("div");
  conteneur.className = "ya-tableur-conteneur";
  conteneur.append(zone);

  let active = { r: 0, c: 0 };
  let saisie = null; // { valider, annuler }
  const lecture = () => {
    const l = lireCsv(vue.state.doc.toString());
    return l.refus ? null : l;
  };
  const cellule = (r, c) => table.rows[r]?.cells[c];

  function marquer() {
    for (const ligne of table.rows) {
      for (const td of ligne.cells) {
        const est = td === cellule(active.r, active.c);
        td.tabIndex = est ? 0 : -1;
        td.classList.toggle("ya-cellule-active", est);
      }
    }
  }

  function rafraichir() {
    const l = lecture();
    if (!l) return;
    const focus = zone.contains(document.activeElement);
    saisie?.annuler();
    const defilement = { x: zone.scrollLeft, y: zone.scrollTop };
    // Les cellules qui restent sont gardées : un clic en cours sur l'une d'elles ne se perd pas.
    while (table.rows.length > l.rangees.length) table.rows[table.rows.length - 1].remove();
    l.rangees.forEach((rangee, r) => {
      let tr = table.rows[r];
      if (!tr) {
        tr = document.createElement("tr");
        tr.setAttribute("role", "row");
        table.append(tr);
      }
      while (tr.cells.length > rangee.champs.length) tr.cells[tr.cells.length - 1].remove();
      rangee.champs.forEach((champ, c) => {
        const balise = r === 0 ? "TH" : "TD";
        let td = tr.cells[c];
        if (td && td.tagName !== balise) {
          td.remove();
          td = null;
        }
        if (!td) {
          td = document.createElement(balise);
          td.setAttribute("role", r === 0 ? "columnheader" : "gridcell");
          tr.insertBefore(td, tr.cells[c] ?? null);
        }
        td.replaceChildren(texteDeCellule(champ.texte));
      });
    });
    active = { r: Math.min(active.r, l.rangees.length - 1), c: Math.min(active.c, l.colonnes - 1) };
    marquer();
    zone.scrollLeft = defilement.x;
    zone.scrollTop = defilement.y;
    majRecherche();
    if (focus) cellule(active.r, active.c)?.focus();
  }

  // ---- Recherche dans les cellules (REQ-160) ----
  const rech = { texte: "", ouvert: false, casse: false, regex: false };
  let courante = null; // cellule choisie par F3 : { r, c }
  let panneau = null;

  const options = () => ({ casse: rech.casse, regex: rech.regex });

  // Cellules dont le texte affiché contient le texte cherché, rangée par rangée, de gauche à droite.
  // `invalide` : expression régulière refusée.
  function occurrences() {
    const l = rech.ouvert && rech.texte ? lecture() : null;
    const occ = [];
    let invalide = false;
    l?.rangees.forEach((rangee, r) =>
      rangee.champs.forEach((champ, c) => {
        const paires = chercherTexte(champ.texte, rech.texte, options());
        if (paires === null) invalide = true;
        else if (paires.length) occ.push({ r, c });
      }),
    );
    return { occ: invalide ? [] : occ, invalide };
  }

  // Surligne les cellules trouvées (jamais celle en saisie) et met à jour le panneau.
  function majRecherche() {
    retirerMarques(table);
    if (!rech.ouvert || !panneau) return;
    const { occ, invalide } = occurrences();
    for (const { r, c } of occ) {
      const texte = cellule(r, c)?.querySelector(":scope > .ya-cellule-texte");
      if (texte) marquerOccurrences(texte, rech.texte, { courante: courante?.r === r && courante?.c === c, ...options() });
    }
    const i = courante ? occ.findIndex((o) => o.r === courante.r && o.c === courante.c) : -1;
    if (i < 0) courante = null;
    panneau.definirTexte(rech.texte);
    panneau.definirOptions(options());
    panneau.afficher(occ.length, i >= 0 ? i + 1 : undefined, { invalide });
  }

  function ecarterCourante() {
    if (!courante) return;
    courante = null;
    majRecherche();
  }

  // Va à la cellule trouvée suivante (ou précédente) la cellule active, en bouclant ; le focus reste où il est.
  function aller(sens) {
    const { occ } = occurrences();
    if (!occ.length) return;
    const apres = (o) => o.r > active.r || (o.r === active.r && o.c > active.c);
    const avant = (o) => o.r < active.r || (o.r === active.r && o.c < active.c);
    const cible = sens > 0 ? (occ.find(apres) ?? occ[0]) : (occ.findLast(avant) ?? occ[occ.length - 1]);
    activer(cible.r, cible.c, false);
    courante = cible;
    majRecherche();
  }

  // Réécrit les cellules `cibles` (parties trouvées remplacées) en une seule transaction du document.
  function appliquer(cibles, remplacement) {
    const l = lecture();
    if (!l) return;
    const changes = cibles.map(({ r, c }) => {
      const texte = l.rangees[r].champs[c].texte;
      const paires = chercherTexte(texte, rech.texte, options());
      return changerCellule(l, r, c, remplacerTexte(texte, paires, rech.texte, remplacement, { regex: rech.regex, casse: rech.casse }));
    });
    vue.dispatch({ changes, annotations: isolateHistory.of("full") });
    courante = null;
    rafraichir();
  }

  // Remplace la cellule courante (sinon celle que F3 choisirait), puis la suivante devient active et courante.
  function remplacer(remplacement) {
    validerSaisie();
    const { occ } = occurrences();
    if (!occ.length) return;
    const apres = (o) => o.r > active.r || (o.r === active.r && o.c > active.c);
    const cible = courante ?? occ.find(apres) ?? occ[0];
    appliquer([cible], remplacement);
    const suivantes = occurrences().occ;
    const n = suivantes.find((o) => o.r > cible.r || (o.r === cible.r && o.c > cible.c)) ?? suivantes[0];
    if (n) {
      activer(n.r, n.c, false);
      courante = n;
    }
    majRecherche();
  }

  function toutRemplacer(remplacement) {
    validerSaisie();
    const { occ } = occurrences();
    if (!occ.length) return;
    appliquer(occ, remplacement);
    panneau?.annoncerRemplacees(occ.length);
  }

  function creerPanneau() {
    panneau = panneauRecherche({
      nom,
      surTexte: (texte) => {
        rech.texte = texte;
        courante = null;
        majRecherche();
      },
      surOptions: ({ casse, regex }) => {
        rech.casse = casse;
        rech.regex = regex;
        courante = null;
        majRecherche();
      },
      surRemplacer: remplacer,
      surToutRemplacer: toutRemplacer,
      surSuivante: () => aller(1),
      surPrecedente: () => aller(-1),
      surFermer: () => fermer(),
    });
    conteneur.insertBefore(panneau.element, zone);
  }

  // `remplacement` : avec la ligne de remplacement (Ctrl+H, REQ-207).
  function ouvrir({ remplacement = false } = {}) {
    validerSaisie();
    const dejaOuvert = rech.ouvert && panneau;
    rech.ouvert = true;
    if (!panneau) creerPanneau();
    majRecherche();
    if (remplacement && dejaOuvert) panneau.montrerRemplacement();
    else {
      if (remplacement) panneau.definirRemplacement("");
      panneau.ouvrir();
    }
  }

  // `focus` : le focus revient à la cellule active (pas quand le clic est ailleurs, sur « Mode hybride »).
  function fermer(focus = true) {
    if (!rech.ouvert) return;
    rech.ouvert = false;
    rech.texte = "";
    rech.casse = false;
    rech.regex = false;
    courante = null;
    retirerMarques(table);
    panneau?.element.remove();
    panneau = null;
    if (focus) cellule(active.r, active.c)?.focus();
  }

  function reprendre(e) {
    if (!e?.ouvert) return fermer(false);
    rech.ouvert = true;
    rech.texte = e.texte ?? "";
    rech.casse = Boolean(e.casse);
    rech.regex = Boolean(e.regex);
    if (!panneau) creerPanneau();
    if (e.remplacement != null) panneau.definirRemplacement(e.remplacement);
    majRecherche();
  }

  function activer(r, c, avecFocus = true) {
    const td = cellule(r, c);
    if (!td) return;
    active = { r, c };
    marquer();
    ecarterCourante();
    // La première rangée reste collée en haut : la cellule active doit s'arrêter sous elle, même si ses titres passent à la ligne.
    // Panneau de recherche ouvert : au moins 42 px, pour que la cellule ne passe pas dessous.
    const entete = table.rows[0]?.getBoundingClientRect().bottom - zone.getBoundingClientRect().top;
    if (rech.ouvert) zone.style.scrollPaddingTop = `${Math.max(entete > 0 ? entete : 0, 42)}px`;
    else if (entete > 0) zone.style.scrollPaddingTop = `${entete}px`;
    if (avecFocus && zone.isConnected) td.focus();
    td.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  const nomDeSaisie = (l, r, c) => {
    const titre = l.rangees[0].champs[c].texte.trim();
    return r === 0 ? `En-tête de la colonne ${c + 1}` : titre ? `${titre}, rangée ${r}` : `Colonne ${c + 1}, rangée ${r}`;
  };

  // Ouvre la saisie de la cellule (r, c), qui devient active.
  function saisir(r, c, decalage = -1) {
    validerSaisie();
    const l = lecture();
    const td = cellule(r, c);
    if (!l || !td) return;
    active = { r, c };
    marquer();
    ecarterCourante();
    const texte0 = l.rangees[r].champs[c].texte;
    const span = champSaisie(td, nomDeSaisie(l, r, c), texte0, decalage);
    let fini = false;
    const annuler = () => {
      if (fini) return;
      fini = true;
      saisie = null;
      td.replaceChildren(texteDeCellule(texte0));
      majRecherche();
    };
    const valider = (suite, focus = true) => {
      if (fini) return;
      const texte = span.textContent;
      fini = true;
      saisie = null;
      const courant = lecture();
      const champ = courant?.rangees[r]?.champs[c];
      if (champ && texte !== champ.texte) vue.dispatch({ changes: changerCellule(courant, r, c, texte), annotations: isolateHistory.of("full") });
      rafraichir();
      if (suite) saisir(suite.r, suite.c);
      else if (focus) cellule(active.r, active.c)?.focus();
    };
    saisie = { valider, annuler };
    span.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        valider();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        annuler();
        td.focus();
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        valider(voisine(l, r, c, e.shiftKey ? -1 : 1));
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        valider(); // l'événement continue vers Ctrl+S de la page
      } else if (((estMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") || (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "h")) {
        // Ctrl+F ou Ctrl+H : la saisie est validée d'abord, puis la recherche s'ouvre (la cellule saisie n'est plus dans la page).
        e.preventDefault();
        e.stopPropagation();
        valider(null, false);
        ouvrir({ remplacement: e.key.toLowerCase() === "h" });
      } else e.stopPropagation();
    });
    span.addEventListener("blur", () => valider(null, false));
  }

  // Cellule suivante (ou précédente) dans l'ordre de lecture, ou null aux extrémités.
  function voisine(l, r, c, pas) {
    let [r2, c2] = [r, c + pas];
    if (c2 < 0) [r2, c2] = [r - 1, l.colonnes - 1];
    else if (c2 >= l.colonnes) [r2, c2] = [r + 1, 0];
    return r2 >= 0 && r2 < l.rangees.length ? { r: r2, c: c2 } : null;
  }

  function validerSaisie() {
    saisie?.valider();
  }

  table.addEventListener("click", (e) => {
    const td = e.target.closest?.("td, th");
    if (!td || !table.contains(td) || e.target.closest(".ya-cellule-saisie")) return;
    saisir(td.parentNode.rowIndex, td.cellIndex, decalageDuClic(td, { x: e.clientX, y: e.clientY }));
  });

  table.addEventListener("keydown", (e) => {
    const td = e.target;
    if (td.tagName !== "TD" && td.tagName !== "TH") return;
    const { r, c } = active;
    const pas = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }[e.key];
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (e.key === "F3" && rech.ouvert && !mod && !e.altKey) {
      e.preventDefault();
      aller(e.shiftKey ? -1 : 1);
    } else if (pas && !mod && !e.shiftKey) {
      e.preventDefault();
      activer(r + pas[0], c + pas[1]);
    } else if ((e.key === "Enter" || e.key === "F2") && !mod && !e.shiftKey) {
      e.preventDefault();
      saisir(r, c);
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo(vue);
      rafraichir();
    } else if (mod && ((!e.shiftKey && e.key.toLowerCase() === "y") || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault();
      redo(vue);
      rafraichir();
    }
  });

  // Geste d'un disque d'aide : la saisie ouverte est validée d'abord (son propre pas), puis une transaction.
  function geste(d, effacer) {
    validerSaisie();
    const l = lecture();
    if (!l) return;
    effacer();
    const changes = {
      "inserer-colonne": () => insererColonne(l, d.indice),
      "inserer-ligne": () => insererRangee(l, d.indice + 1),
      "supprimer-colonne": () => supprimerColonne(l, d.indice),
      "supprimer-ligne": () => supprimerRangee(l, d.indice),
    }[d.sorte]();
    vue.dispatch({ changes, annotations: isolateHistory.of("full") });
    if (d.sorte === "inserer-colonne") {
      rafraichir();
      saisir(0, d.indice);
    } else if (d.sorte === "inserer-ligne") {
      rafraichir();
      saisir(d.indice + 1, 0);
    } else {
      // La cellule à la même place (la précédente si c'était la dernière) devient active ; rafraichir la ramène dans la grille.
      active = d.sorte === "supprimer-colonne" ? { r: 0, c: d.indice } : { r: d.indice, c: active.c };
      rafraichir();
      activer(active.r, active.c);
    }
  }
  const retirerAides = aidesSurvol(grille, table, { agir: geste, tableur: true, ecoute: conteneur });

  rafraichir();
  return {
    element: conteneur,
    zone,
    recherche: { ouvrir, fermer, etat: () => ({ texte: rech.texte, ouvert: rech.ouvert, casse: rech.casse, regex: rech.regex, remplacement: panneau?.remplacement() ?? null }), reprendre },
    rafraichir,
    validerSaisie,
    activer,
    celluleActive: () => ({ ...active }),
    focuser: () => activer(active.r, active.c),
    detruire: retirerAides,
  };
}

function texteDeCellule(texte) {
  const div = document.createElement("div");
  div.className = "ya-cellule-texte";
  div.textContent = texte;
  return div;
}
