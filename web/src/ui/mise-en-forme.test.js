import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { afterEach, expect, test } from "vitest";
import { zoneCode } from "./zone-code.js";
import { gras, italique, souligne, codeEnLigne, extensionMiseEnForme } from "./mise-en-forme.js";

Range.prototype.getClientRects ??= () => [];

// Vue sans DOM visible : le texte, la sélection et l'historique suffisent.
function vue(doc, anchor, head = anchor) {
  const hote = document.createElement("div");
  document.body.append(hote);
  const v = new EditorView({
    parent: hote,
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: [history(), markdown({ base: markdownLanguage }), extensionMiseEnForme] }),
  });
  return v;
}
const texte = (v) => v.state.doc.toString();
const choisi = (v) => v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
const appliquer = (v, action) => v.dispatch(action(v.state));
const frappe = (v, c) => {
  const s = v.state.selection.main;
  return inputHandlers(v, s.from, s.to, c);
};
// Les `inputHandler` sont lus dans la configuration de l'état.
function inputHandlers(v, from, to, c) {
  for (const h of v.state.facet(EditorView.inputHandler)) if (h(v, from, to, c, () => v.state.update({ changes: { from, to, insert: c } }))) return true;
  v.dispatch({ changes: { from, to, insert: c }, selection: { anchor: from + c.length }, userEvent: "input.type" });
  return false;
}
afterEach(() => (document.body.innerHTML = ""));

test("REQ169_AC1_gras_entoure_garde_la_selection_et_retire_au_second_appel", () => {
  const v = vue("un mot ici", 3, 6);
  appliquer(v, gras);
  expect(texte(v)).toBe("un **mot** ici");
  expect(choisi(v)).toBe("mot");
  appliquer(v, gras);
  expect(texte(v)).toBe("un mot ici");
  expect(choisi(v)).toBe("mot");
});

test("REQ169_AC2_italique_et_souligne_entourent_et_retirent", () => {
  const v = vue("mot", 0, 3);
  appliquer(v, italique);
  expect(texte(v)).toBe("*mot*");
  appliquer(v, italique);
  expect(texte(v)).toBe("mot");
  appliquer(v, souligne);
  expect(texte(v)).toBe("<u>mot</u>");
  expect(choisi(v)).toBe("mot");
  appliquer(v, souligne);
  expect(texte(v)).toBe("mot");
  expect(choisi(v)).toBe("mot");
});

test("REQ169_AC3_sans_selection_deux_marques_curseur_entre_elles", () => {
  const v = vue("", 0);
  appliquer(v, gras);
  expect(texte(v)).toBe("****");
  expect(v.state.selection.main.head).toBe(2);
  v.dispatch({ changes: { from: 2, insert: "a" }, selection: { anchor: 3 } });
  expect(texte(v)).toBe("**a**");
});

test("REQ169_AC4_accent_grave_ajoute_un_de_chaque_cote_et_garde_la_selection", () => {
  const v = vue("mot", 0, 3);
  expect(frappe(v, "`")).toBe(true);
  expect(texte(v)).toBe("`mot`");
  expect(choisi(v)).toBe("mot");
  frappe(v, "`");
  expect(texte(v)).toBe("``mot``");
  expect(choisi(v)).toBe("mot");
});

test("REQ169_AC4_sans_selection_l_accent_grave_s_ecrit_comme_avant", () => {
  const v = vue("a", 1);
  expect(frappe(v, "`")).toBe(false);
  expect(texte(v)).toBe("a`");
});

test("REQ169_AC4_bouton_code_en_ligne_sans_selection_deux_accents_curseur_entre", () => {
  const v = vue("", 0);
  appliquer(v, codeEnLigne);
  expect(texte(v)).toBe("``");
  expect(v.state.selection.main.head).toBe(1);
});

test("REQ169_AC5_trois_frappes_lignes_entieres_en_bloc_de_code", () => {
  const v = vue("ligne 1\nligne 2", 0, 15);
  frappe(v, "`");
  frappe(v, "`");
  frappe(v, "`");
  expect(texte(v)).toBe("```\nligne 1\nligne 2\n```");
  expect(choisi(v)).toBe("ligne 1\nligne 2");
});

test("REQ169_AC5_trois_frappes_au_milieu_d_une_ligne_separent_avant_et_apres", () => {
  const v = vue("avant mot après", 6, 9);
  frappe(v, "`");
  frappe(v, "`");
  frappe(v, "`");
  expect(texte(v)).toBe("avant\n```\nmot\n```\naprès");
  expect(choisi(v)).toBe("mot");
});

test("REQ169_AC5_les_trois_temps_repartent_de_un_quand_la_selection_a_bouge", () => {
  const v = vue("un mot et un autre", 3, 6);
  frappe(v, "`");
  frappe(v, "`");
  v.dispatch({ selection: { anchor: 17, head: 22 } });
  frappe(v, "`");
  expect(texte(v)).toBe("un ``mot`` et un `autre`");
});

test("REQ169_AC5_le_bouton_code_en_ligne_compte_dans_les_trois_temps", () => {
  const v = vue("mot", 0, 3);
  appliquer(v, codeEnLigne);
  appliquer(v, codeEnLigne);
  appliquer(v, codeEnLigne);
  expect(texte(v)).toBe("```\nmot\n```");
});

test("REQ169_AC7_une_action_une_transaction_un_undo_rend_le_texte_d_avant", () => {
  const v = vue("mot", 0, 3);
  v.dispatch({ changes: { from: 3, insert: "s" }, userEvent: "input.type" });
  const apres = "mots";
  for (const [action, resultat] of [[gras, "**mots**"], [italique, "*mots*"], [souligne, "<u>mots</u>"]]) {
    v.dispatch({ selection: { anchor: 0, head: 4 } });
    appliquer(v, action);
    expect(texte(v)).toBe(resultat);
    undo(v);
    expect(texte(v)).toBe(apres);
  }
  v.dispatch({ selection: { anchor: 0, head: 4 } });
  frappe(v, "`");
  undo(v);
  expect(texte(v)).toBe(apres);
  v.dispatch({ selection: { anchor: 0, head: 4 } });
  frappe(v, "`");
  frappe(v, "`");
  frappe(v, "`");
  expect(texte(v)).toBe("```\nmots\n```");
  undo(v);
  expect(texte(v)).toBe("``mots``");
  undo(v);
  expect(texte(v)).toBe("`mots`");
});

const MD = "un mot ici";
function zone(options) {
  const z = zoneCode({ contenu: MD, langage: "markdown", nom: "a.md", ...options });
  document.body.append(z);
  return z;
}
const touche = (v, key) => {
  const e = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
  v.contentDOM.dispatchEvent(e);
  return { pris: e.defaultPrevented, e };
};

const TOUCHES = ["b", "i", "u"];
function essayer(z) {
  const v = z.vue;
  const avant = v.state.doc.toString();
  const sorties = [];
  for (const k of TOUCHES) {
    v.dispatch({ selection: { anchor: 4, head: 7 } });
    touche(v, k);
    sorties.push(texte(v) === avant);
  }
  v.dispatch({ selection: { anchor: 4, head: 7 } });
  sorties.push(inputHandlers(v, 4, 7, "`"), texte(v));
  return sorties;
}

test("REQ169_AC8_raccourcis_et_accent_grave_poses_et_retires_avec_le_mode_hybride", () => {
  const z = zone({ hybride: false, contenu: "un mot ici" });
  const base = z.vue.state.facet(EditorView.inputHandler).length;
  // Mode éteint : aucune touche prise, texte inchangé, la frappe remplace la sélection comme avant.
  expect(essayer(z)).toEqual([true, true, true, false, "un m`ici"]);
  z.definirHybride(true);
  expect(z.vue.state.facet(EditorView.inputHandler).length).toBe(base + 1);
  z.vue.dispatch({ changes: { from: 0, to: z.vue.state.doc.length, insert: "un mot ici" } });
  z.vue.dispatch({ selection: { anchor: 3, head: 6 } });
  expect(touche(z.vue, "b").pris).toBe(true);
  expect(texte(z.vue)).toBe("un **mot** ici");
  z.definirHybride(false);
  expect(z.vue.state.facet(EditorView.inputHandler).length).toBe(base);
  z.vue.dispatch({ selection: { anchor: 0, head: 2 } });
  expect(touche(z.vue, "b").pris).toBe(false);
  expect(texte(z.vue)).toBe("un **mot** ici");
  z.detruire();
});

test("REQ169_AC8_fichier_de_code_hors_markdown_garde_ses_touches", () => {
  const z = zoneCode({ contenu: "let x = 1;", langage: "rust", nom: "main.rs", hybride: true });
  document.body.append(z);
  expect(z.vue.state.facet(EditorView.inputHandler).length).toBe(0);
  expect(essayer(z)).toEqual([true, true, true, false, "let ` 1;"]);
  z.detruire();
});

test("REQ169_AC9_ctrl_b_i_u_pris_avant_codemirror_navigateur_neutralise_focus_gardé", () => {
  const z = zone({ hybride: true });
  const v = z.vue;
  v.focus();
  for (const [k, attendu] of [["b", "un **mot** ici"], ["i", "un *mot* ici"], ["u", "un <u>mot</u> ici"]]) {
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: MD }, selection: { anchor: 3, head: 6 } });
    const { pris, e } = touche(v, k);
    expect(pris).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(texte(v)).toBe(attendu);
    expect(document.activeElement).toBe(v.contentDOM);
  }
  z.detruire();
});
