import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { champ } from "./champ.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((x) => x.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};

test("REQ028_AC3_champ_texte_libelle_lie_et_sans_correcteur", () => {
  const c = champ({ libelle: "Nom", valeur: "abc" });
  const input = c.querySelector("input");
  expect(input.value).toBe("abc");
  expect(input.spellcheck).toBe(false);
  expect(c.querySelector("label").htmlFor).toBe(input.id);
  expect(c.querySelector("label").textContent).toBe("Nom");
});

test("REQ028_AC3_champ_types", () => {
  const mdp = champ({ libelle: "Mot de passe", type: "motDePasse" }).querySelector("input");
  expect(mdp.type).toBe("password");
  expect(mdp.getAttribute("autocomplete")).toBe("current-password");
  const ml = champ({ libelle: "Message", type: "multiligne" }).querySelector("textarea");
  expect(ml.rows).toBe(2);
  expect(ml.spellcheck).toBe(false);
  const l = champ({ libelle: "Branche", type: "liste", options: ["main", "dev"], valeur: "dev" }).querySelector("select");
  expect([...l.options].map((o) => o.value)).toEqual(["main", "dev"]);
  expect(l.value).toBe("dev");
  expect(() => champ({ libelle: "x", type: "autre" })).toThrow(/type/);
});

test("REQ028_AC3_champ_aide_et_erreur_reliees", () => {
  const c = champ({ libelle: "Nom", aide: "Un mot", erreur: "Obligatoire" });
  const input = c.querySelector("input");
  const aide = c.querySelector(".champ-aide");
  const err = c.querySelector(".champ-erreur");
  expect(aide.textContent).toBe("Un mot");
  expect(err.textContent).toBe("Obligatoire");
  expect(err.getAttribute("role")).toBe("alert");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const ids = input.getAttribute("aria-describedby").split(" ");
  expect(ids).toEqual([aide.id, err.id]);
});

test("REQ028_AC3_champ_sans_aide_ni_erreur", () => {
  const input = champ({ libelle: "Nom" }).querySelector("input");
  expect(input.hasAttribute("aria-describedby")).toBe(false);
  expect(input.hasAttribute("aria-invalid")).toBe(false);
});

test("REQ028_AC3_champ_libelle_masque_et_desactive", () => {
  const c = champ({ libelle: "Rechercher", libelleMasque: true, desactive: true });
  expect(c.querySelector("label").classList.contains("masque")).toBe(true);
  expect(c.querySelector("input").disabled).toBe(true);
});

test("REQ028_AC3_champ_ids_uniques", () => {
  const a = champ({ libelle: "A" }).querySelector("input").id;
  const b = champ({ libelle: "B" }).querySelector("input").id;
  expect(a).not.toBe(b);
});

test("REQ028_AC3_champ_liste_sans_valeur_selectionne_la_premiere_option", () => {
  const l = champ({ libelle: "Branche", type: "liste", options: ["main", "dev"] }).querySelector("select");
  expect(l.selectedIndex).toBe(0);
  expect(l.value).toBe("main");
});

test("REQ036_AC1_champ_a_les_classes_du_design_system", () => {
  expect(champ({ libelle: "Nom" }).querySelector("input").classList.contains("ya-input")).toBe(true);
  const ml = champ({ libelle: "Message", type: "multiligne" }).querySelector("textarea");
  expect(ml.classList.contains("ya-input") && ml.classList.contains("ya-textarea")).toBe(true);
  expect(champ({ libelle: "Branche", type: "liste", options: ["a"] }).querySelector("select").classList.contains("ya-input")).toBe(true);
});

test("REQ033_AC14_indication_devient_le_placeholder_en_ink_muted", () => {
  expect(champ({ libelle: "Nom", indication: "ex. notes.txt" }).querySelector("input").placeholder).toBe("ex. notes.txt");
  expect(champ({ libelle: "Nom" }).querySelector("input").placeholder).toBe("");
  expect(regle(".ya-input::placeholder")).toContain("color: var(--ink-muted)");
});
