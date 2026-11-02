import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { cadre } from "./cadre.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};
const p = (texte) => Object.assign(document.createElement("p"), { textContent: texte });

function monter() {
  const c = cadre({
    barreHaut: [p("haut")],
    rail: p("rail"),
    panneau: { titre: "Fichiers", corps: p("corps"), pied: p("pied") },
    principal: { bandeaux: p("bandeau"), ongletsFichiers: p("of"), questionOnglet: p("q"), code: p("code"), shells: p("shells") },
  });
  document.body.append(c);
  return c;
}

test("REQ028_AC4_zones_semantiques_header_nav_aside_main", () => {
  const c = monter();
  expect(c.querySelector("header").textContent).toBe("haut");
  expect(c.querySelector('nav[aria-label="Panneaux"]').textContent).toBe("rail");
  expect(c.querySelector("aside").textContent).toContain("corps");
  expect(c.querySelector("main").textContent).toContain("shells");
});

test("REQ028_AC8_ordre_dom_barre_rail_panneau_principal_puis_onglets_code_shells", () => {
  const c = monter();
  const noms = [...c.children].map((e) => e.tagName.toLowerCase());
  expect(noms).toEqual(["header", "nav", "aside", "main"]);
  const textes = [...c.querySelector("main").children].map((e) => e.textContent);
  expect(textes).toEqual(["bandeau", "of", "q", "code", "shells"]);
});

test("REQ028_AC2_titre_de_panneau_h2_et_pied_hors_du_corps_defilant", () => {
  const c = monter();
  const h = c.querySelector("aside h2");
  expect(h.textContent).toBe("Fichiers");
  expect(regle(".cadre-panneau-titre")).toContain("text-transform: uppercase");
  expect(regle(".cadre-panneau-titre")).toContain("color: var(--texte-attenue)");
  expect(regle(".cadre-panneau-corps")).toContain("overflow: auto");
  expect(c.querySelector(".cadre-panneau-pied").textContent).toBe("pied");
  expect(c.querySelector(".cadre-panneau-corps").contains(c.querySelector(".cadre-panneau-pied"))).toBe(false);
});

test("REQ028_AC9_grille_par_tokens_et_page_qui_defile_sous_le_minimum", () => {
  const r = regle(".cadre");
  expect(r).toContain("grid-template-rows: var(--hauteur-barre)");
  expect(r).toContain("grid-template-columns: var(--largeur-rail) var(--largeur-panneau)");
  expect(r).toContain("min-width: var(--largeur-min)");
  expect(r).toContain("min-height: var(--hauteur-min)");
  expect(regle(".cadre-shells")).toContain("var(--part-shells)");
});

test("REQ028_AC2_panneau_sans_titre_ni_pied_n_ajoute_rien", () => {
  const c = cadre({ barreHaut: p("h"), rail: p("r") });
  expect(c.querySelector("h2")).toBeNull();
  expect(c.querySelector(".cadre-panneau-pied")).toBeNull();
});
