import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { cadre } from "./cadre.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());
const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};
const p = (texte) => Object.assign(document.createElement("p"), { textContent: texte });

function monter() {
  const c = cadre({
    barreHaut: [p("haut")],
    rail: { onglets: p("rail"), commandes: [p("cmd")] },
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
  expect(c.querySelector(".cadre-rail").tagName).toBe("DIV");
  expect(c.querySelector("aside").textContent).toContain("corps");
  expect(c.querySelector("main").textContent).toContain("shells");
});

test("REQ028_AC8_ordre_dom_barre_rail_panneau_principal_puis_onglets_code_shells", () => {
  const c = monter();
  const noms = [...c.children].map((e) => e.tagName.toLowerCase());
  expect(noms).toEqual(["header", "div", "aside", "div", "main"]);
  expect(c.children[3].getAttribute("aria-label")).toBe("Largeur du panneau");
  const textes = [...c.querySelector("main").children].map((e) => e.textContent);
  expect(textes).toEqual(["bandeau", "of", "q", "code", "", "shells"]);
  expect(c.querySelector("main").children[4].getAttribute("aria-label")).toBe("Hauteur des shells");
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
  expect(r).toContain("grid-template-columns: var(--largeur-rail) var(--taille-panneau, var(--largeur-panneau)) var(--epaisseur-poignee) minmax(0, 1fr)");
  expect(r).toContain("min-width: var(--largeur-min)");
  expect(r).toContain("min-height: var(--hauteur-min)");
  expect(regle(".cadre-shells")).toContain("var(--taille-shells, var(--part-shells))");
});

test("REQ033_AC8_fonds_distincts_par_zone_et_pas_de_bordure_entre_zones_redimensionnables", () => {
  expect(regle(".cadre-rail")).toContain("background: var(--fond-rail)");
  expect(regle(".cadre-panneau")).toContain("background: var(--surface)");
  expect(regle(".cadre-principal")).toContain("background: var(--fond)");
  expect(regle(".cadre-shells")).toContain("background: var(--fond-shells)");
  expect(regle(".cadre-panneau")).not.toContain("border-right");
  expect(regle(".cadre-shells")).not.toContain("border-top");
});

test("REQ032_AC2_poignees_du_cadre_et_taille_affichee_posee_par_definirTailles", () => {
  const c = monter();
  const [pan, sh] = [c.poignees.panneau, c.poignees.shells];
  expect([pan, sh].map((e) => e.getAttribute("aria-orientation"))).toEqual(["vertical", "horizontal"]);
  expect(c.style.getPropertyValue("--taille-panneau")).toBe("");
  expect(c.style.getPropertyValue("--taille-shells")).toBe("");
  c.definirTailles({ panneau: 300, shells: 200 });
  expect(c.style.getPropertyValue("--taille-panneau")).toBe("300px");
  expect(c.style.getPropertyValue("--taille-shells")).toBe("200px");
  expect([pan, sh].map((e) => e.getAttribute("aria-valuenow"))).toEqual(["300", "200"]);
});

test("REQ032_AC1_les_poignees_du_cadre_transmettent_changement_et_fin", () => {
  const evts = [];
  const c = cadre({ barreHaut: p("h"), rail: { onglets: p("r") }, tailles: { panneau: 240, shells: 200 }, surChangement: (z, t) => evts.push(["c", z, t]), surFin: (z, t) => evts.push(["f", z, t]) });
  c.poignees.panneau.definir({ min: 160, max: 436 });
  c.poignees.panneau.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  expect(evts).toEqual([["c", "panneau", 256], ["f", "panneau", 256]]);
});

test("REQ028_AC2_panneau_sans_titre_ni_pied_n_ajoute_rien", () => {
  const c = cadre({ barreHaut: p("h"), rail: { onglets: p("r") } });
  expect(c.querySelector("h2")).toBeNull();
  expect(c.querySelector(".cadre-panneau-pied")).toBeNull();
});

test("REQ032_AC7_sans_taille_choisie_mesurer_pose_la_taille_mesuree_sans_ecrire_les_tokens", () => {
  const c = cadre({ barreHaut: p("h"), rail: { onglets: p("r") } });
  document.body.append(c);
  Object.defineProperty(c.querySelector("aside"), "offsetWidth", { value: 240 });
  Object.defineProperty(c.querySelector(".cadre-shells"), "offsetHeight", { value: 245 });
  c.mesurer();
  expect(c.poignees.panneau.getAttribute("aria-valuenow")).toBe("240");
  expect(c.poignees.shells.getAttribute("aria-valuenow")).toBe("245");
  expect(c.style.getPropertyValue("--taille-panneau")).toBe("");
  expect(c.style.getPropertyValue("--taille-shells")).toBe("");
});

test("REQ028_AC12_rail_nav_en_haut_et_groupe_Shells_en_bas", () => {
  const c = monter();
  const rail = c.querySelector(".cadre-rail");
  expect([...rail.children].map((e) => e.tagName)).toEqual(["NAV", "DIV"]);
  const g = rail.querySelector('[role="group"]');
  expect(g.getAttribute("aria-label")).toBe("Shells");
  expect(g.textContent).toBe("cmd");
  expect(regle(".cadre-rail")).toContain("flex-direction: column");
  expect(regle(".cadre-rail-commandes")).toContain("gap: var(--esp-2)");
  expect(regle(".cadre-rail-commandes")).toContain("padding-bottom: var(--esp-3)");
});

test("REQ028_AC12_sans_commandes_pas_de_groupe", () => {
  const c = cadre({ barreHaut: p("h"), rail: { onglets: p("r") } });
  expect(c.querySelector('[role="group"]')).toBeNull();
});
