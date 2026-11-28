import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { afterEach, expect, test } from "vitest";
import { tableur } from "./tableur.js";

const CLIENTS = "nom,ville,note\nAlice,Paris,12\nBob,Lyon,x\nChloé,Nantes,\n";
let nettoyage = [];
afterEach(() => {
  for (const f of nettoyage) f();
  nettoyage = [];
  document.body.replaceChildren();
});

function monter(doc = CLIENTS, nom = "clients.csv") {
  const transactions = [];
  const vue = new EditorView({
    state: EditorState.create({ doc, extensions: [history(), EditorView.updateListener.of((u) => u.docChanged && transactions.push(u.transactions.length))] }),
    parent: document.body,
  });
  const t = tableur({ vue, nom });
  document.body.append(t.element);
  t.focuser();
  nettoyage.push(() => vue.destroy());
  return { vue, t, transactions, table: t.element.querySelector("table") };
}
const cellule = (t, r, c) => t.element.querySelector("table").rows[r].cells[c];
const touche = (el, key, opts = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  el.dispatchEvent(e);
  return e;
};
const saisieOuverte = (t) => t.element.querySelector("[role=textbox]");
const taper = (span, texte) => {
  span.textContent = texte;
};
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

test("REQ157_AC14_grille_nommee_en_tetes_cellules_et_une_seule_cellule_a_tabindex_0", () => {
  const { t, table } = monter();
  expect(table.getAttribute("role")).toBe("grid");
  expect(table.getAttribute("aria-label")).toBe("Tableur clients.csv");
  expect(table.querySelectorAll("[role=columnheader]").length).toBe(3);
  expect(table.querySelectorAll("[role=gridcell]").length).toBe(9);
  const zeros = [...table.querySelectorAll("th, td")].filter((c) => c.getAttribute("tabindex") === "0");
  expect(zeros).toEqual([cellule(t, 0, 0)]);
  expect(cellule(t, 0, 0).textContent).toBe("nom");
});

test("REQ157_AC14_clic_ouvre_la_saisie_nommee_et_echap_rend_la_cellule_active_avec_le_focus", () => {
  const { t, vue } = monter();
  clic(cellule(t, 1, 1));
  const span = saisieOuverte(t);
  expect(span.getAttribute("aria-label")).toBe("ville, rangée 1");
  expect(span.textContent).toBe("Paris");
  taper(span, "Rome");
  touche(span, "Escape");
  expect(saisieOuverte(t)).toBeNull();
  expect(cellule(t, 1, 1).textContent).toBe("Paris");
  expect(cellule(t, 1, 1).getAttribute("tabindex")).toBe("0");
  expect(document.activeElement).toBe(cellule(t, 1, 1));
  expect(vue.state.doc.toString()).toBe(CLIENTS);
});

test("REQ157_AC14_nom_de_saisie_en_tete_et_premiere_rangee_vide", () => {
  const a = monter();
  clic(cellule(a.t, 0, 1));
  expect(saisieOuverte(a.t).getAttribute("aria-label")).toBe("En-tête de la colonne 2");
  document.body.replaceChildren();
  const b = monter(",,\nA,B,C\n");
  clic(cellule(b.t, 1, 1));
  expect(saisieOuverte(b.t).getAttribute("aria-label")).toBe("Colonne 2, rangée 1");
});

test("REQ157_AC11_clavier_fleches_sans_boucle_entree_f2_et_tab_non_retenu", () => {
  const { t } = monter();
  expect(document.activeElement).toBe(cellule(t, 0, 0));
  touche(document.activeElement, "ArrowUp");
  touche(document.activeElement, "ArrowLeft");
  expect(t.celluleActive()).toEqual({ r: 0, c: 0 });
  touche(document.activeElement, "ArrowDown");
  expect(document.activeElement.textContent).toBe("Alice");
  touche(document.activeElement, "ArrowRight");
  expect(document.activeElement.textContent).toBe("Paris");
  touche(t.element.querySelector("[tabindex='0']"), "ArrowRight");
  touche(document.activeElement, "ArrowRight");
  expect(t.celluleActive()).toEqual({ r: 1, c: 2 });
  // Entrée : saisie, curseur à la fin.
  touche(document.activeElement, "Enter");
  let span = saisieOuverte(t);
  expect(document.activeElement).toBe(span);
  expect(document.getSelection().anchorOffset).toBe(2);
  touche(span, "Enter");
  expect(saisieOuverte(t)).toBeNull();
  expect(document.activeElement).toBe(cellule(t, 1, 2));
  touche(document.activeElement, "F2");
  span = saisieOuverte(t);
  expect(document.activeElement).toBe(span);
  touche(span, "Enter");
  expect(document.activeElement).toBe(cellule(t, 1, 2));
  // Tab hors saisie : la grille ne le retient pas.
  expect(touche(document.activeElement, "Tab").defaultPrevented).toBe(false);
  // Bas jusqu'au bord.
  for (let i = 0; i < 5; i++) touche(document.activeElement, "ArrowDown");
  expect(t.celluleActive()).toEqual({ r: 3, c: 2 });
});

test("REQ157_AC12_une_seule_saisie_un_seul_textbox_avec_le_focus", () => {
  const { t } = monter();
  clic(cellule(t, 1, 0));
  clic(cellule(t, 2, 1));
  expect(t.element.querySelectorAll("[role=textbox]").length).toBe(1);
  expect(document.activeElement).toBe(saisieOuverte(t));
  expect(t.celluleActive()).toEqual({ r: 2, c: 1 });
});

test("REQ157_AC3_une_transaction_par_saisie_seul_le_champ_change_et_undo_refait_la_grille", () => {
  const { t, vue, transactions } = monter();
  touche(document.activeElement, "ArrowDown");
  touche(document.activeElement, "ArrowRight");
  touche(document.activeElement, "ArrowRight");
  touche(document.activeElement, "Enter");
  taper(saisieOuverte(t), "15");
  touche(saisieOuverte(t), "Enter");
  expect(vue.state.doc.toString()).toBe(CLIENTS.replace("12", "15"));
  expect(transactions).toEqual([1]);
  expect(cellule(t, 1, 2).textContent).toBe("15");
  undo(vue);
  t.rafraichir();
  expect(vue.state.doc.toString()).toBe(CLIENTS);
  expect(cellule(t, 1, 2).textContent).toBe("12");
  expect(t.celluleActive()).toEqual({ r: 1, c: 2 });
  expect(cellule(t, 1, 2).getAttribute("tabindex")).toBe("0");
});

test("REQ157_AC3_ctrl_z_et_ctrl_y_hors_saisie_agissent_sur_le_document", () => {
  const { t, vue } = monter();
  touche(document.activeElement, "ArrowDown");
  touche(document.activeElement, "Enter");
  taper(saisieOuverte(t), "Zoé");
  touche(saisieOuverte(t), "Enter");
  expect(cellule(t, 1, 0).textContent).toBe("Zoé");
  const z = touche(document.activeElement, "z", { ctrlKey: true });
  expect(z.defaultPrevented).toBe(true);
  expect(vue.state.doc.toString()).toBe(CLIENTS);
  expect(cellule(t, 1, 0).textContent).toBe("Alice");
  touche(document.activeElement, "y", { ctrlKey: true });
  expect(cellule(t, 1, 0).textContent).toBe("Zoé");
  expect(vue.state.doc.toString()).toContain("Zoé,Paris,12");
});

test("REQ157_AC5_echap_tab_entree_sans_changement_et_clic_ailleurs", () => {
  const { t, vue, transactions } = monter();
  // Entrée sans changement : aucune transaction.
  clic(cellule(t, 1, 0));
  touche(saisieOuverte(t), "Enter");
  expect(transactions).toEqual([]);
  // Tab : cellule suivante en saisie, de gauche à droite puis rangée suivante.
  clic(cellule(t, 1, 2));
  taper(saisieOuverte(t), "13");
  touche(saisieOuverte(t), "Tab");
  expect(vue.state.doc.toString()).toContain("Alice,Paris,13");
  expect(saisieOuverte(t).getAttribute("aria-label")).toBe("nom, rangée 2");
  expect(t.celluleActive()).toEqual({ r: 2, c: 0 });
  // Maj+Tab : revient.
  touche(saisieOuverte(t), "Tab", { shiftKey: true });
  expect(saisieOuverte(t).getAttribute("aria-label")).toBe("note, rangée 1");
  expect(saisieOuverte(t).textContent).toBe("13");
  // Tab depuis la dernière cellule : validée, cellule active.
  clic(cellule(t, 3, 2));
  taper(saisieOuverte(t), "ok");
  touche(saisieOuverte(t), "Tab");
  expect(saisieOuverte(t)).toBeNull();
  expect(vue.state.doc.toString()).toContain("Chloé,Nantes,ok");
  expect(t.celluleActive()).toEqual({ r: 3, c: 2 });
  expect(document.activeElement).toBe(cellule(t, 3, 2));
  // Maj+Tab depuis la première : validée, rien d'autre.
  clic(cellule(t, 0, 0));
  touche(saisieOuverte(t), "Tab", { shiftKey: true });
  expect(saisieOuverte(t)).toBeNull();
  expect(t.celluleActive()).toEqual({ r: 0, c: 0 });
  // Clic ailleurs : validée.
  clic(cellule(t, 1, 0));
  taper(saisieOuverte(t), "Alix");
  saisieOuverte(t).dispatchEvent(new FocusEvent("blur"));
  expect(vue.state.doc.toString()).toContain("Alix,Paris");
  expect(saisieOuverte(t)).toBeNull();
});

test("REQ157_AC5_echap_laisse_le_document_inchange", () => {
  const { t, vue, transactions } = monter();
  clic(cellule(t, 2, 0));
  taper(saisieOuverte(t), "Zut");
  touche(saisieOuverte(t), "Escape");
  expect(vue.state.doc.toString()).toBe(CLIENTS);
  expect(transactions).toEqual([]);
});

test("REQ157_AC8_cellule_a_deux_lignes_saisie_sans_saut_de_ligne_ajoute", () => {
  const { t, vue } = monter('a,b\n"ligne 1\nligne 2",x\n');
  expect(cellule(t, 1, 0).textContent).toBe("ligne 1\nligne 2");
  clic(cellule(t, 1, 0));
  const span = saisieOuverte(t);
  expect(span.textContent).toBe("ligne 1\nligne 2");
  const e = touche(span, "Enter");
  expect(e.defaultPrevented).toBe(true);
  expect(saisieOuverte(t)).toBeNull();
  expect(vue.state.doc.toString()).toBe('a,b\n"ligne 1\nligne 2",x\n');
});

test("REQ157_AC5_validerSaisie_ecrit_la_saisie_ouverte", () => {
  const { t, vue } = monter();
  clic(cellule(t, 1, 0));
  taper(saisieOuverte(t), "Alix");
  t.validerSaisie();
  expect(vue.state.doc.toString()).toContain("Alix,Paris,12");
  expect(saisieOuverte(t)).toBeNull();
});

test("REQ157_AC3_ne_fait_rien_quand_le_texte_est_illisible", () => {
  const { t, vue } = monter();
  vue.dispatch({ changes: { from: 0, to: vue.state.doc.length, insert: 'a,"b\n' } });
  t.rafraichir();
  expect(cellule(t, 1, 0).textContent).toBe("Alice");
});

test("REQ157_AC3_rafraichir_ramene_la_cellule_active_dans_la_grille", () => {
  const { t, vue } = monter();
  t.activer(3, 2);
  vue.dispatch({ changes: { from: 0, to: vue.state.doc.length, insert: "a\nb\n" } });
  t.rafraichir();
  expect(t.celluleActive()).toEqual({ r: 1, c: 0 });
  expect(cellule(t, 1, 0).getAttribute("tabindex")).toBe("0");
  expect(document.activeElement).toBe(cellule(t, 1, 0));
});

test("REQ157_AC5_rafraichir_pendant_une_saisie_laisse_le_focus_sur_la_cellule_active", () => {
  const { t } = monter();
  clic(cellule(t, 1, 1));
  expect(document.activeElement).toBe(saisieOuverte(t));
  t.rafraichir();
  expect(saisieOuverte(t)).toBeNull();
  expect(document.activeElement).toBe(cellule(t, 1, 1));
});

test("REQ157_AC11_clic_place_le_curseur_a_l_endroit_du_clic", () => {
  const { t } = monter();
  document.caretPositionFromPoint = (x) => ({ offsetNode: cellule(t, 1, 1).querySelector("div").firstChild, offset: x });
  nettoyage.push(() => delete document.caretPositionFromPoint);
  cellule(t, 1, 1).dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 2, clientY: 5 }));
  expect(saisieOuverte(t).textContent).toBe("Paris");
  expect(document.getSelection().anchorOffset).toBe(2);
});

// ---- Recherche dans les cellules (REQ-160) ----
const PAYS = 'nom,ville,note\nAlice,Paris,12\n"Bob, fils",Lyon,"dit ""oui"""\nChloé,Nantes\n';
const panneauDe = (t) => t.element.querySelector(".ya-recherche-fichier");
const champDe = (t) => panneauDe(t).querySelector("input");
const chercher = (t, texte) => {
  champDe(t).value = texte;
  champDe(t).dispatchEvent(new Event("input", { bubbles: true }));
};
const compte = (t) => panneauDe(t).querySelector(".ya-recherche-compteur").textContent.replace(/\s+/g, " ").trim();
const marques = (t) => [...t.element.querySelectorAll("mark.ya-occurrence")];
const textes = (t) => marques(t).map((m) => m.closest("td, th").textContent);
const f3 = (t, opts = {}) => touche(champDe(t), "F3", opts);

test("REQ160_AC1_AC9_le_panneau_est_premier_enfant_du_conteneur_et_tab_mene_a_la_cellule_active", () => {
  const { t } = monter(PAYS);
  t.activer(1, 1);
  t.recherche.ouvrir();
  const p = panneauDe(t);
  expect(t.element.firstElementChild).toBe(p);
  expect(t.element.children[1]).toBe(t.zone);
  expect(t.zone.className).toBe("ya-tableur");
  expect(document.activeElement).toBe(champDe(t));
  expect(p.getAttribute("role")).toBe("search");
  expect(p.getAttribute("aria-label")).toBe("Rechercher dans clients.csv");
  const ordre = [...p.querySelectorAll("input, .ya-recherche-compteur, button")].map((x) => (x.tagName === "INPUT" ? "champ" : x.className.includes("compteur") ? "compteur" : x.getAttribute("aria-label")));
  expect(ordre).toEqual(["champ", "Respecter la casse", "Expression régulière", "compteur", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  // Tab : cinq boutons puis la cellule active (seule cellule focalisable).
  const focalisables = [...t.element.querySelectorAll("input, button, [tabindex='0']")];
  expect(focalisables.map((x) => x.tagName)).toEqual(["INPUT", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "TD"]);
  expect(focalisables.at(-1)).toBe(cellule(t, 1, 1));
  const statut = p.querySelector("[role=status]");
  chercher(t, "a");
  expect(statut.textContent).toBe("3 occurrences");
  chercher(t, "zzz");
  expect(statut.textContent).toBe("Aucune occurrence");
});

test("REQ160_AC2_les_cellules_trouvees_sont_comptees_et_surlignees", () => {
  const { t } = monter(PAYS);
  t.recherche.ouvrir();
  chercher(t, "a");
  expect(compte(t)).toBe("3");
  expect(textes(t)).toEqual(["Alice", "Paris", "Nantes"]);
  expect(marques(t).map((m) => m.textContent)).toEqual(["A", "a", "a"]);
  chercher(t, "zzz");
  expect(compte(t)).toBe("0");
  expect(marques(t)).toHaveLength(0);
  chercher(t, "");
  expect(compte(t)).toBe("");
  expect(marques(t)).toHaveLength(0);
  // texte affiché, sans les guillemets du fichier
  chercher(t, '"oui"');
  expect(compte(t)).toBe("1");
});

test("REQ160_AC3_AC4_AC12_F3_va_de_cellule_en_cellule_Echap_ferme_sans_toucher_au_document", () => {
  const { t, vue } = monter(PAYS);
  t.recherche.ouvrir();
  chercher(t, "a");
  f3(t);
  expect(cellule(t, 1, 0).tabIndex).toBe(0);
  expect(cellule(t, 1, 0).classList.contains("ya-cellule-active")).toBe(true);
  expect(compte(t)).toBe("1 sur 3");
  expect(document.activeElement).toBe(champDe(t));
  // seule la marque de « Alice » est la courante
  expect(marques(t).filter((m) => m.classList.contains("ya-occurrence-courante")).map((m) => m.closest("td").textContent)).toEqual(["Alice"]);
  f3(t);
  expect(t.celluleActive()).toEqual({ r: 1, c: 1 });
  f3(t);
  expect(t.celluleActive()).toEqual({ r: 3, c: 1 });
  f3(t);
  expect(t.celluleActive()).toEqual({ r: 1, c: 0 });
  f3(t, { shiftKey: true });
  expect(t.celluleActive()).toEqual({ r: 3, c: 1 });
  // flèche haut du panneau : Maj+F3
  panneauDe(t).querySelector('button[aria-label="Occurrence précédente"]').click();
  expect(t.celluleActive()).toEqual({ r: 1, c: 1 });
  // flèche droite sur la grille : plus de marque courante, « 3 »
  f3(t);
  cellule(t, 3, 1).focus();
  touche(cellule(t, 3, 1), "ArrowLeft");
  expect(marques(t).some((m) => m.classList.contains("ya-occurrence-courante"))).toBe(false);
  expect(compte(t)).toBe("3");
  // F3 depuis la grille
  touche(cellule(t, 3, 0), "F3");
  expect(t.celluleActive()).toEqual({ r: 3, c: 1 });
  // Échap
  const avant = vue.state.doc.toString();
  touche(champDe(t), "Escape");
  expect(panneauDe(t)).toBeNull();
  expect(marques(t)).toHaveLength(0);
  expect(document.activeElement).toBe(cellule(t, 3, 1));
  expect(vue.state.doc.toString()).toBe(avant);
  touche(cellule(t, 3, 1), "z", { ctrlKey: true });
  expect(vue.state.doc.toString()).toBe(avant);
});

test("REQ160_AC5_une_saisie_validee_et_Ctrl_Z_mettent_le_compteur_a_jour", () => {
  const { t, vue } = monter(PAYS);
  t.recherche.ouvrir();
  chercher(t, "a");
  clic(cellule(t, 1, 2));
  taper(saisieOuverte(t), "Laval");
  touche(saisieOuverte(t), "Enter");
  expect(compte(t)).toBe("4");
  expect(cellule(t, 1, 2).querySelectorAll("mark")).toHaveLength(2);
  t.activer(1, 1);
  t.recherche.ouvrir();
  f3(t);
  expect(t.celluleActive()).toEqual({ r: 1, c: 2 });
  touche(cellule(t, 1, 2), "z", { ctrlKey: true });
  expect(compte(t)).toBe("3");
  expect(vue.state.doc.toString()).toBe(PAYS);
});

test("REQ160_AC12_une_cellule_en_saisie_n_a_pas_de_marque_et_Echap_la_rend", () => {
  const { t } = monter(PAYS);
  t.recherche.ouvrir();
  chercher(t, "a");
  clic(cellule(t, 1, 1));
  expect(cellule(t, 1, 1).querySelectorAll("mark")).toHaveLength(0);
  touche(saisieOuverte(t), "Escape");
  expect(cellule(t, 1, 1).querySelectorAll("mark")).toHaveLength(1);
});

test("REQ160_AC10_une_cellule_avec_trois_parties_trouvees_compte_une_fois", () => {
  const { t } = monter(PAYS);
  t.recherche.ouvrir();
  chercher(t, "a");
  clic(cellule(t, 3, 0));
  taper(saisieOuverte(t), "Nantes, Laval");
  touche(saisieOuverte(t), "Enter");
  expect(cellule(t, 3, 0).querySelectorAll("mark")).toHaveLength(3);
  expect(compte(t)).toBe("4");
  expect(textes(t).filter((x) => x === "Nantes, Laval")).toHaveLength(3);
});

test("REQ160_AC8_Ctrl_F_pendant_une_saisie_la_valide_puis_ouvre_la_recherche", () => {
  const { t, vue } = monter(PAYS);
  clic(cellule(t, 1, 2));
  taper(saisieOuverte(t), "Laval");
  const ev = touche(saisieOuverte(t), "f", { ctrlKey: true });
  expect(ev.defaultPrevented).toBe(true);
  expect(vue.state.doc.toString()).toContain("Alice,Paris,Laval");
  expect(saisieOuverte(t)).toBeNull();
  expect(document.activeElement).toBe(champDe(t));
});

test("REQ160_AC6_fermer_sans_focus_et_etat_repris", () => {
  const { t } = monter(PAYS);
  const bouton = document.createElement("button");
  document.body.append(bouton);
  t.recherche.ouvrir();
  chercher(t, "a");
  bouton.focus();
  t.recherche.fermer(false);
  expect(panneauDe(t)).toBeNull();
  expect(marques(t)).toHaveLength(0);
  expect(document.activeElement).toBe(bouton);
  t.recherche.reprendre({ texte: "a", ouvert: true });
  expect(compte(t)).toBe("3");
  expect(t.recherche.etat()).toEqual({ texte: "a", ouvert: true, casse: false, regex: false, remplacement: null });
});

// ---- Casse, expression régulière et remplacement dans les cellules (REQ-206, REQ-207) ----
const bouton = (t, nom) => panneauDe(t).querySelector(`button[aria-label="${nom}"]`);
const champRemplacer = (t) => panneauDe(t).querySelectorAll("input")[1];
const remplacerPar = (t, texte) => {
  champRemplacer(t).value = texte;
  champRemplacer(t).dispatchEvent(new Event("input", { bubbles: true }));
};
const cellules = (t) => [...t.element.querySelectorAll("td, th")].map((x) => x.textContent);

test("REQ206_AC4_casse_et_expression_reguliere_s_appliquent_au_texte_de_chaque_cellule", () => {
  const { t } = monter(PAYS);
  t.recherche.ouvrir();
  clic(bouton(t, "Expression régulière"));
  expect(bouton(t, "Expression régulière").getAttribute("aria-pressed")).toBe("true");
  chercher(t, "s$");
  expect(compte(t)).toBe("3");
  expect(textes(t)).toEqual(["Paris", "Bob, fils", "Nantes"]);
  chercher(t, "^[a-c]");
  expect(compte(t)).toBe("3");
  expect(textes(t)).toEqual(["Alice", "Bob, fils", "Chloé"]);
  clic(bouton(t, "Respecter la casse"));
  expect(compte(t)).toBe("0");
  // Expression invalide : rien de surligné, flèches grisées, champ en erreur.
  chercher(t, "(");
  expect(compte(t)).toBe("Invalide");
  expect(marques(t)).toHaveLength(0);
  expect(champDe(t).getAttribute("aria-invalid")).toBe("true");
  expect(bouton(t, "Occurrence suivante").getAttribute("aria-disabled")).toBe("true");
  // Relâchée, l'expression `(` est cherchée telle quelle.
  clic(bouton(t, "Expression régulière"));
  expect(champDe(t).hasAttribute("aria-invalid")).toBe(false);
  expect(compte(t)).toBe("0");
});

test("REQ207_AC7_remplacer_et_tout_remplacer_dans_la_grille_en_une_transaction", () => {
  const { t, vue, transactions } = monter(PAYS);
  t.recherche.ouvrir({ remplacement: true });
  chercher(t, "a");
  remplacerPar(t, "o");
  f3(t); // Alice
  f3(t); // Paris
  expect(compte(t)).toBe("2 sur 3");
  clic(bouton(t, "Remplacer"));
  expect(cellule(t, 1, 1).textContent).toBe("Poris");
  expect(cellule(t, 1, 1).textContent).not.toBe("Paris");
  expect(compte(t)).toBe("2 sur 2");
  expect(t.celluleActive()).toEqual({ r: 3, c: 1 });
  expect(vue.state.doc.toString()).toContain("Alice,Poris,12");
  const avant = transactions.length;
  clic(bouton(t, "Tout remplacer"));
  expect(transactions.length).toBe(avant + 1);
  expect(cellules(t)).toContain("olice");
  expect(cellules(t)).toContain("Nontes");
  expect(compte(t)).toBe("0");
  expect(panneauDe(t).querySelector("[role=status]").textContent).toBe("2 occurrences remplacées");
  undo(vue);
  t.rafraichir();
  expect(cellules(t)).toContain("Alice");
  expect(cellules(t)).toContain("Nantes");
  expect(cellules(t)).toContain("Poris");
});

test("REQ207_AC7_le_fichier_est_reecrit_avec_les_guillemets_necessaires", () => {
  const { t, vue } = monter(PAYS);
  t.recherche.ouvrir({ remplacement: true });
  chercher(t, "Lyon");
  remplacerPar(t, "Lyon, Rhône");
  touche(champRemplacer(t), "Enter");
  expect(vue.state.doc.toString()).toContain('"Bob, fils","Lyon, Rhône","dit ""oui"""');
});

test("REQ207_AC7_regex_groupes_et_rien_a_remplacer_ne_change_rien", () => {
  const { t, vue, transactions } = monter(PAYS);
  t.recherche.ouvrir({ remplacement: true });
  chercher(t, "zzz");
  expect(bouton(t, "Remplacer").getAttribute("aria-disabled")).toBe("true");
  expect(bouton(t, "Tout remplacer").getAttribute("aria-disabled")).toBe("true");
  clic(bouton(t, "Tout remplacer"));
  expect(transactions).toHaveLength(0);
  clic(bouton(t, "Expression régulière"));
  chercher(t, "^A(.)");
  remplacerPar(t, "Z$1");
  clic(bouton(t, "Tout remplacer"));
  expect(vue.state.doc.toString()).toContain("Zlice,Paris,12");
});

test("REQ207_AC1_ctrl_h_pendant_une_saisie_la_valide_puis_ouvre_avec_la_ligne_de_remplacement", () => {
  const { t, vue } = monter(PAYS);
  clic(cellule(t, 1, 2));
  taper(saisieOuverte(t), "Laval");
  const ev = touche(saisieOuverte(t), "h", { ctrlKey: true });
  expect(ev.defaultPrevented).toBe(true);
  expect(vue.state.doc.toString()).toContain("Alice,Paris,Laval");
  expect(saisieOuverte(t)).toBeNull();
  expect(document.activeElement).toBe(champDe(t));
  const ordre = [...panneauDe(t).querySelectorAll("input, button")].map((x) => (x.tagName === "INPUT" ? "champ" : x.getAttribute("aria-label")));
  expect(ordre).toEqual(["champ", "Respecter la casse", "Expression régulière", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche", "champ", "Remplacer", "Tout remplacer"]);
});

test("REQ206_AC6_REQ207_AC10_etat_et_reprendre_portent_bascules_et_remplacement", () => {
  const { t } = monter(PAYS);
  t.recherche.ouvrir({ remplacement: true });
  clic(bouton(t, "Respecter la casse"));
  chercher(t, "a");
  remplacerPar(t, "Zed");
  const e = t.recherche.etat();
  expect(e).toEqual({ texte: "a", ouvert: true, casse: true, regex: false, remplacement: "Zed" });
  t.recherche.fermer(false);
  t.recherche.reprendre(e);
  expect(bouton(t, "Respecter la casse").getAttribute("aria-pressed")).toBe("true");
  expect(champRemplacer(t).value).toBe("Zed");
  expect(compte(t)).toBe("2");
  t.recherche.fermer(false);
  t.recherche.ouvrir();
  expect(bouton(t, "Respecter la casse").getAttribute("aria-pressed")).toBe("false");
  expect(panneauDe(t).querySelectorAll("input")).toHaveLength(1);
});
