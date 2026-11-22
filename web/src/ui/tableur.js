import { undo, redo, isolateHistory } from "@codemirror/commands";
import { lireCsv, changerCellule } from "../csv.js";
import { champSaisie, decalageDuClic } from "./hybride.js";

// Tableur d'un fichier CSV (C-008 `hybride` sur un `.csv`, REQ-157, DEC-109). `vue` est l'EditorView de l'onglet,
// masquée par l'appelant : le document y reste la source, chaque saisie validée y est une transaction.
export function tableur({ vue, nom }) {
  const zone = document.createElement("div");
  zone.className = "ya-tableur";
  const table = document.createElement("table");
  table.setAttribute("role", "grid");
  table.setAttribute("aria-label", `Tableur ${nom}`);
  zone.append(table);

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
    if (focus) cellule(active.r, active.c)?.focus();
  }

  function activer(r, c) {
    const td = cellule(r, c);
    if (!td) return;
    active = { r, c };
    marquer();
    if (zone.isConnected) td.focus();
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
    const texte0 = l.rangees[r].champs[c].texte;
    const span = champSaisie(td, nomDeSaisie(l, r, c), texte0, decalage);
    let fini = false;
    const annuler = () => {
      if (fini) return;
      fini = true;
      saisie = null;
      td.replaceChildren(texteDeCellule(texte0));
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
    if (pas && !mod && !e.shiftKey) {
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

  rafraichir();
  return {
    element: zone,
    rafraichir,
    validerSaisie,
    activer,
    celluleActive: () => ({ ...active }),
    focuser: () => activer(active.r, active.c),
  };
}

function texteDeCellule(texte) {
  const div = document.createElement("div");
  div.className = "ya-cellule-texte";
  div.textContent = texte;
  return div;
}
