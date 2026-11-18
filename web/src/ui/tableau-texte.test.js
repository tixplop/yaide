import { expect, test } from "vitest";
import { basculer, colorer, decalages, etatTexte, inserer, lireTexte, pointA, rendreTexte } from "./tableau-texte.js";

const rendre = (text, spans) => {
  const c = document.createElement("div");
  rendreTexte(c, text, spans);
  return c;
};
const parties = (c) => [...c.querySelectorAll("span")].map((s) => [s.textContent, s.style.fontWeight, s.style.fontStyle, s.style.textDecoration, s.style.color]);

test("REQ146_AC2_les_styles_vont_sur_les_bons_caracteres", () => {
  const c = rendre("Début du flux", [{ start: 9, end: 13, italic: true, underline: true, strike: true, color: "red" }, { start: 0, end: 5, bold: true }].sort((a, b) => a.start - b.start));
  expect(c.textContent).toBe("Début du flux");
  const p = parties(c);
  expect(p).toEqual([
    ["Début", "700", "", "", ""],
    ["flux", "", "italic", "underline line-through", "var(--boite-rouge-trait)"],
  ]);
  expect(c.childNodes[1].nodeType).toBe(3);
  expect(c.childNodes[1].textContent).toBe(" du ");
});

test("REQ146_AC2_texte_sans_partie_et_vide", () => {
  expect(rendre("a\nb", []).querySelectorAll("span").length).toBe(0);
  expect(rendre("a\nb", undefined).textContent).toBe("a\nb");
  expect(rendre("", []).childNodes.length).toBe(0);
});

test("REQ146_AC2_un_emoji_compte_pour_un_caractere", () => {
  const c = rendre("A😀B", [{ start: 1, end: 2, bold: true }]);
  expect(parties(c)).toEqual([["😀", "700", "", "", ""]]);
  expect(c.textContent).toBe("A😀B");
});


test("REQ146_AC10_vert_et_poids", () => {
  const c = rendre("Début fin", [{ start: 0, end: 5, bold: true, color: "green" }]);
  const s = c.querySelector("span");
  expect(s.style.color).toBe("var(--boite-vert-trait)");
  expect(s.style.fontWeight).toBe("700");
  expect(c.childNodes[1].textContent).toBe(" fin");
});

test("REQ146_AC2_rendre_remplace_le_contenu", () => {
  const c = rendre("abc", [{ start: 0, end: 1, bold: true }]);
  rendreTexte(c, "xyz", []);
  expect(c.textContent).toBe("xyz");
  expect(c.querySelectorAll("span").length).toBe(0);
});

test("REQ146_AC4_lireTexte_relit_texte_et_styles_du_dom", () => {
  const c = rendre("Début du flux", [{ start: 0, end: 5, bold: true }, { start: 9, end: 13, italic: true, underline: true, strike: true, color: "red" }]);
  expect(lireTexte(c)).toEqual({ text: "Début du flux", spans: [{ start: 0, end: 5, bold: true }, { start: 9, end: 13, italic: true, underline: true, strike: true, color: "red" }] });
});

test("REQ146_AC4_texte_ajoute_dans_un_span_prolonge_le_style_et_texte_efface_deplace_les_styles", () => {
  const c = rendre("Début du flux", [{ start: 0, end: 5, bold: true }, { start: 9, end: 13, italic: true }]);
  c.querySelector("span").firstChild.insertData(5, "s");
  expect(lireTexte(c)).toEqual({ text: "Débuts du flux", spans: [{ start: 0, end: 6, bold: true }, { start: 10, end: 14, italic: true }] });
  const d = rendre("Début du flux", [{ start: 9, end: 13, italic: true }]);
  d.childNodes[0].deleteData(5, 4);
  expect(lireTexte(d)).toEqual({ text: "Débutflux", spans: [{ start: 5, end: 9, italic: true }] });
});

test("REQ146_AC4_lireTexte_compte_les_emojis_et_les_br_et_ignore_les_spans_vides", () => {
  const c = rendre("A😀B", [{ start: 1, end: 2, bold: true }]);
  c.append(document.createElement("br"), document.createElement("span"));
  expect(lireTexte(c)).toEqual({ text: "A😀B\n", spans: [{ start: 1, end: 2, bold: true }] });
});

test("REQ146_AC4_collage_prend_les_styles_du_caractere_d_avant_ou_d_apres", () => {
  const spans = [{ start: 0, end: 5, bold: true }];
  expect(inserer("Début fin", spans, 5, 5, "s")).toEqual({ text: "Débuts fin", spans: [{ start: 0, end: 6, bold: true }] });
  expect(inserer("Début fin", spans, 0, 0, "X")).toEqual({ text: "XDébut fin", spans: [{ start: 0, end: 6, bold: true }] });
  expect(inserer("Début fin", spans, 6, 9, "ab\ncd")).toEqual({ text: "Début ab\ncd", spans: [{ start: 0, end: 5, bold: true }] });
  expect(inserer("", [], 0, 0, "a\nb")).toEqual({ text: "a\nb", spans: [] });
});

test("REQ146_AC1_basculer_donne_puis_ote_et_fond_les_parties", () => {
  const a = basculer("Début du flux", [], 0, 5, "bold");
  expect(a).toEqual([{ start: 0, end: 5, bold: true }]);
  expect(basculer("Début du flux", a, 0, 5, "bold")).toEqual([]);
  expect(basculer("Début du flux", a, 0, 13, "bold")).toEqual([{ start: 0, end: 13, bold: true }]);
  expect(basculer("Début du flux", a, 0, 13, "bold", false)).toEqual([]);
  expect(basculer("Début du flux", a, 0, 5, "bold", true)).toEqual(a);
  expect(basculer("abc", [], 2, 2, "bold")).toEqual([]);
});

test("REQ146_AC2_colorer_et_defaut_retire_la_couleur", () => {
  const a = colorer("Début du flux", [], 9, 13, "red");
  expect(a).toEqual([{ start: 9, end: 13, color: "red" }]);
  const b = basculer("Début du flux", a, 9, 13, "italic");
  expect(b).toEqual([{ start: 9, end: 13, italic: true, color: "red" }]);
  expect(colorer("Début du flux", b, 9, 13, "default")).toEqual([{ start: 9, end: 13, italic: true }]);
});

test("REQ146_AC8_etatTexte_styles_communs_et_couleur", () => {
  const spans = [{ start: 0, end: 5, bold: true, color: "red" }, { start: 5, end: 8, color: "red" }];
  expect(etatTexte("Début du flux", spans, 0, 5)).toEqual({ styles: ["bold"], couleur: "red" });
  expect(etatTexte("Début du flux", spans, 0, 8)).toEqual({ styles: [], couleur: "red" });
  expect(etatTexte("Début du flux", spans, 0, 13)).toEqual({ styles: [], couleur: null });
  expect(etatTexte("Début du flux", [], 0, 13)).toEqual({ styles: [], couleur: "default" });
});

test("REQ146_AC10_texte_vide_aucun_style_et_par_defaut", () => {
  expect(etatTexte("", [], 0, 0)).toEqual({ styles: [], couleur: "default" });
  expect(basculer("", [], 0, 0, "bold")).toEqual([]);
});

test("REQ146_AC1_decalages_et_pointA_sont_reciproques", () => {
  const c = rendre("Début du flux", [{ start: 0, end: 5, bold: true }]);
  document.body.append(c);
  const [n, o] = pointA(c, 5);
  expect(n).toBe(c.querySelector("span").firstChild);
  expect(o).toBe(5);
  const [n2, o2] = pointA(c, 9);
  const r = document.createRange();
  r.setStart(c.querySelector("span").firstChild, 0);
  r.setEnd(n2, o2);
  expect(decalages(c, r)).toEqual({ debut: 0, fin: 9 });
  const r2 = document.createRange();
  r2.setStart(c, 1);
  r2.setEnd(c, 2);
  expect(decalages(c, r2)).toEqual({ debut: 5, fin: 13 });
  const hors = document.createRange();
  hors.setStart(document.body, 0);
  expect(decalages(c, hors)).toBeNull();
  c.remove();
});
