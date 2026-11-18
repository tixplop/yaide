import { expect, test } from "vitest";
import { rendreTexte } from "./tableau-texte.js";

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
