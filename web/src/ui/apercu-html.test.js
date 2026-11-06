import { test, expect } from "vitest";
import { apercuHtml, texteSrcdoc } from "./apercu-html.js";

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;

test("REQ058_AC4_regle_au_debut_sans_doctype", () => {
  expect(texteSrcdoc("<h1>T</h1>")).toBe(CSP + "<h1>T</h1>");
});

test("REQ058_AC4_regle_apres_doctype", () => {
  expect(texteSrcdoc("<!DOCTYPE html><p>a")).toBe("<!DOCTYPE html>" + CSP + "<p>a");
});

test("REQ058_AC4_doctype_en_minuscules_et_espaces", () => {
  expect(texteSrcdoc("  \n<!doctype  html >\n<p>a")).toBe("  \n<!doctype  html >" + CSP + "\n<p>a");
});

test("REQ058_AC4_texte_vide", () => {
  expect(texteSrcdoc("")).toBe(CSP);
});

test("REQ058_AC3_attributs_du_cadre", () => {
  const f = apercuHtml();
  expect(f.tagName).toBe("IFRAME");
  expect(f.className).toBe("zone-code-cadre");
  expect(f.title).toBe("Aperçu");
  expect(f.getAttribute("sandbox")).toBe("allow-same-origin");
  f.maj("<p>x");
  expect(f.srcdoc).toBe(CSP + "<p>x");
});
