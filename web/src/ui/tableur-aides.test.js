import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableur } from "./tableur.js";

const CLIENTS = "nom,ville,note\nAlice,Paris,12\nBob,Lyon,x\nChloé,Nantes,\n";
let nettoyage = [];
beforeEach(() => {
  // 3 colonnes de 100 px à partir de x = 100 ; rangées de 30 px à partir de y = 50.
  const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
  const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.classList?.contains("ya-tableur-grille")) return rect(90, 40, 410, 180);
    if (this.matches?.("td, th")) {
      const r = this.parentElement.rowIndex;
      const c = this.cellIndex;
      return rect(100 + c * 100, 50 + r * 30, 200 + c * 100, 80 + r * 30);
    }
    return rect(0, 0, 0, 0);
  });
  nettoyage.push(() => spy.mockRestore());
});
afterEach(() => {
  for (const f of nettoyage) f();
  nettoyage = [];
  document.body.replaceChildren();
});

function monter(doc = CLIENTS) {
  const transactions = [];
  const vue = new EditorView({
    state: EditorState.create({ doc, extensions: [history(), EditorView.updateListener.of((u) => u.docChanged && transactions.push(u))] }),
    parent: document.body,
  });
  const t = tableur({ vue, nom: "clients.csv" });
  document.body.append(t.element);
  t.focuser();
  nettoyage.push(() => (t.detruire(), vue.destroy()));
  const grille = t.element.querySelector(".ya-tableur-grille");
  const survol = (x, y) => t.element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
  const disque = () => grille.querySelector(".ya-tableau-aides .ya-icon-btn-disque");
  return { vue, t, transactions, survol, disque, cell: (r, c) => grille.querySelector("table").rows[r].cells[c], saisie: () => t.element.querySelector("[role=textbox]") };
}
// Le document défait, la grille suit (T-382 le fera par l'écouteur de l'éditeur).
const defaire = (m) => {
  undo(m.vue);
  m.t.rafraichir();
};
const texte = (m) => m.vue.state.doc.toString();

test("REQ157_AC7_AC11_disques_a_tabindex_moins_un_et_noms", () => {
  const m = monter();
  const attendu = [
    [203, 60, "Insérer une colonne"],
    [250, 49, "Insérer une ligne"],
    [250, 65, "Supprimer la colonne"],
    [250, 95, "Supprimer la ligne"],
  ];
  for (const [x, y, nom] of attendu) {
    m.survol(x, y);
    expect(m.disque().getAttribute("aria-label")).toBe(nom);
    expect(m.disque().getAttribute("tabindex")).toBe("-1");
  }
});

test("REQ157_AC7_insérer_une_colonne_une_transaction_saisie_dans_la_premiere_rangee_et_un_undo", () => {
  const m = monter();
  m.survol(203, 60);
  m.disque().click();
  expect(m.transactions.length).toBe(1);
  expect(texte(m)).toBe("nom,,ville,note\nAlice,,Paris,12\nBob,,Lyon,x\nChloé,,Nantes,\n");
  expect(m.saisie().getAttribute("aria-label")).toBe("En-tête de la colonne 2");
  expect(m.saisie().closest("th").cellIndex).toBe(1);
  defaire(m);
  expect(texte(m)).toBe(CLIENTS);
});

test("REQ157_AC7_insérer_une_ligne_au_bord_haut_et_entre_deux_rangees", () => {
  const m = monter();
  m.survol(250, 49);
  m.disque().click();
  expect(m.transactions.length).toBe(1);
  expect(texte(m)).toBe(",,\n" + CLIENTS);
  expect(m.saisie().closest("tr").rowIndex).toBe(0);
  expect(m.saisie().closest("td, th").cellIndex).toBe(0);
  defaire(m);
  expect(texte(m)).toBe(CLIENTS);
  m.survol(250, 81);
  m.disque().click();
  expect(texte(m)).toBe("nom,ville,note\n,,\nAlice,Paris,12\nBob,Lyon,x\nChloé,Nantes,\n");
  expect(m.saisie().closest("tr").rowIndex).toBe(1);
  defaire(m);
  expect(texte(m)).toBe(CLIENTS);
});

test("REQ157_AC7_supprimer_colonne_et_ligne_cellule_au_meme_endroit_avec_le_focus", () => {
  const m = monter();
  m.survol(350, 65);
  expect(m.disque().getAttribute("aria-label")).toBe("Supprimer la colonne");
  m.disque().click();
  expect(m.transactions.length).toBe(1);
  expect(texte(m)).toBe("nom,ville\nAlice,Paris\nBob,Lyon\nChloé,Nantes\n");
  // Dernière colonne supprimée : la précédente devient active.
  expect(m.t.celluleActive()).toEqual({ r: 0, c: 1 });
  expect(document.activeElement).toBe(m.cell(0, 1));
  defaire(m);
  expect(texte(m)).toBe(CLIENTS);
  m.survol(404, 95); // bande de 4 px hors de la grille : le pointeur est sur la zone
  expect(m.disque().getAttribute("aria-label")).toBe("Supprimer la ligne");
  const avant = m.transactions.length;
  m.disque().click();
  expect(m.transactions.length).toBe(avant + 1);
  expect(texte(m)).toBe("nom,ville,note\nBob,Lyon,x\nChloé,Nantes,\n");
  expect(m.t.celluleActive()).toEqual({ r: 1, c: 1 });
  defaire(m);
  expect(texte(m)).toBe(CLIENTS);
  m.survol(404, 95);
  m.disque().click();
  // Dernière rangée supprimée : la précédente.
  m.survol(250, 125);
  m.disque().click();
  expect(texte(m)).toBe("nom,ville,note\nBob,Lyon,x\n");
  expect(m.t.celluleActive().r).toBe(1);
  expect(document.activeElement).toBe(m.cell(1, 1));
  // Première rangée d'une grille à une colonne : supprimée, la cellule à la même place est active.
  const u = monter("a\nb\nc\n");
  u.survol(150, 65);
  u.disque().click();
  expect(texte(u)).toBe("b\nc\n");
  expect(u.t.celluleActive()).toEqual({ r: 0, c: 0 });
  expect(document.activeElement).toBe(u.cell(0, 0));
});

test("REQ157_AC7_saisie_ouverte_validee_d_abord_en_son_propre_pas", () => {
  const m = monter();
  m.cell(1, 0).click();
  m.saisie().textContent = "Zoé";
  m.survol(203, 60);
  m.disque().click();
  expect(m.transactions.length).toBe(2);
  expect(texte(m)).toBe("nom,,ville,note\nZoé,,Paris,12\nBob,,Lyon,x\nChloé,,Nantes,\n");
  defaire(m);
  expect(texte(m)).toBe("nom,ville,note\nZoé,Paris,12\nBob,Lyon,x\nChloé,Nantes,\n");
});

test("REQ157_AC7_supprimer_la_premiere_rangee_d_une_grille_a_plusieurs_colonnes", () => {
  const m = monter();
  m.survol(404, 65);
  expect(m.disque().getAttribute("aria-label")).toBe("Supprimer la ligne");
  m.disque().click();
  expect(m.transactions.length).toBe(1);
  expect(texte(m)).toBe("Alice,Paris,12\nBob,Lyon,x\nChloé,Nantes,\n");
  expect(m.t.celluleActive()).toEqual({ r: 0, c: 0 });
  defaire(m);
  expect(texte(m)).toBe(CLIENTS);
});

test("REQ157_AC7_la_grille_refaite_garde_son_defilement", () => {
  const m = monter();
  const zone = m.t.element;
  let ecritures = 0;
  let y = 17;
  Object.defineProperty(zone, "scrollTop", { configurable: true, get: () => y, set: (v) => {
      y = v;
      ecritures++;
    } });
  Object.defineProperty(zone, "scrollLeft", { configurable: true, get: () => 5, set: () => {} });
  const ecritures0 = ecritures;
  m.survol(250, 95);
  m.disque().click();
  expect(m.t.element).toBe(zone);
  expect(y).toBe(17);
  // Le défilement est relu avant le changement puis remis : une écriture au moins, jamais à zéro.
  expect(ecritures).toBeGreaterThan(ecritures0);
});
