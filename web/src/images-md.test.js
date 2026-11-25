import { test, expect } from "vitest";
import { resoudreImage } from "./images-md.js";

test("REQ175_AC2_dossier_du_document_d_abord", () => {
  const chemins = ["docs/logo.png", "img/logo.png"];
  expect(resoudreImage("logo.png", "docs/guide.md", chemins)).toBe("docs/logo.png");
});

test("REQ175_AC2_sinon_le_plus_court_puis_l_ordre_alphabetique", () => {
  expect(resoudreImage("logo.png", "docs/guide.md", ["b/c/logo.png", "a/logo.png", "z/logo.png"])).toBe("a/logo.png");
  expect(resoudreImage("logo.png", "guide.md", ["z/logo.png", "a/logo.png"])).toBe("a/logo.png");
  expect(resoudreImage("logo.png", "docs/guide.md", ["mon-logo.png"])).toBe(null);
});

test("REQ175_AC2_chemins_relatifs_et_formats", () => {
  const chemins = ["img/logo.png", "img/PHOTO.JPG", "img/d.svg"];
  expect(resoudreImage("img/logo.png", "guide.md", chemins)).toBe("img/logo.png");
  expect(resoudreImage("../img/logo.png", "docs/guide.md", chemins)).toBe("img/logo.png");
  expect(resoudreImage("PHOTO.JPG", "docs/guide.md", chemins)).toBe("img/PHOTO.JPG");
  expect(resoudreImage("d.svg", "docs/guide.md", chemins)).toBe("img/d.svg");
});

test("REQ175_AC2_worktree_dossier_du_document_seulement", () => {
  expect(resoudreImage("logo.png", "../wt/docs/guide.md", ["img/logo.png"])).toBe("../wt/docs/logo.png");
});

test("REQ175_AC3_balises_laissees_en_texte", () => {
  const chemins = ["notes.md", "logo.png", "casse.txt"];
  expect(resoudreImage("absent.png", "a.md", chemins)).toBe(null);
  expect(resoudreImage("notes.md", "a.md", chemins)).toBe(null);
  expect(resoudreImage("https://exemple.org/x.png", "a.md", chemins)).toBe(null);
  expect(resoudreImage("//exemple.org/x.png", "a.md", chemins)).toBe(null);
  expect(resoudreImage("logo.png|300", "a.md", chemins)).toBe(null);
  expect(resoudreImage("logo.png", "a.md", null)).toBe(null);
  expect(resoudreImage("", "a.md", chemins)).toBe(null);
});

test("REQ179_AC1_jdiag_cherche_comme_une_image_casse_ignoree", () => {
  const chemins = ["schemas/plan.jdiag", "schemas/PLAN.JDIAG", "docs/plan.jdiag"];
  expect(resoudreImage("plan.jdiag", "docs/guide.md", chemins)).toBe("docs/plan.jdiag");
  expect(resoudreImage("plan.jdiag", "guide.md", ["schemas/plan.jdiag"])).toBe("schemas/plan.jdiag");
  expect(resoudreImage("schemas/plan.jdiag", "docs/guide.md", chemins)).toBe("schemas/plan.jdiag");
  expect(resoudreImage("../schemas/plan.jdiag", "docs/guide.md", chemins)).toBe("schemas/plan.jdiag");
  expect(resoudreImage("PLAN.JDIAG", "docs/guide.md", ["schemas/PLAN.JDIAG"])).toBe("schemas/PLAN.JDIAG");
  expect(resoudreImage("plan.jdiag", "../wt/docs/guide.md", ["schemas/plan.jdiag"])).toBe("../wt/docs/plan.jdiag");
});

test("REQ179_AC3_jdiag_balises_laissees_en_texte", () => {
  const chemins = ["plan.jdiag"];
  expect(resoudreImage("plan.jdiag|300", "a.md", chemins)).toBe(null);
  expect(resoudreImage("absent.jdiag", "a.md", chemins)).toBe(null);
  expect(resoudreImage("plan.jdiag", "a.md", null)).toBe(null);
  expect(resoudreImage("plan.jdiagx", "a.md", chemins)).toBe(null);
});
