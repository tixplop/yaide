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
    barreTitre: { projet: "projet", chemin: "/home/x/projet", actions: [p("actions")] },
    rail: { onglets: p("rail"), commandes: [p("cmd")] },
    panneau: { titre: "Fichiers", corps: p("corps"), pied: p("pied") },
    principal: { bandeaux: p("bandeau"), ongletsFichiers: p("of"), questionOnglet: p("q"), fil: p("fil"), code: p("code"), shells: p("shells") },
    barreEtat: { branche: "main", position: "Ln 6, Col 31", langage: "Rust" },
  });
  document.body.append(c);
  return c;
}

test("REQ028_AC4_zones_semantiques_header_nav_aside_main", () => {
  const c = monter();
  expect(c.querySelector("header").textContent).toBe("projetactions");
  expect(c.querySelector("footer").textContent).toBe("mainLn 6, Col 31Rust");
  expect(c.querySelector('nav[aria-label="Panneaux"]').textContent).toBe("rail");
  expect(c.querySelector(".cadre-rail").tagName).toBe("DIV");
  expect(c.querySelector("aside").textContent).toContain("corps");
  expect(c.querySelector("main").textContent).toContain("shells");
});

test("REQ028_AC8_ordre_dom_barre_rail_panneau_principal_puis_onglets_code_shells", () => {
  const c = monter();
  const noms = [...c.children].map((e) => e.tagName.toLowerCase());
  expect(noms).toEqual(["header", "div", "aside", "div", "main", "footer"]);
  expect(c.children[3].getAttribute("aria-label")).toBe("Largeur du panneau");
  const textes = [...c.querySelector("main").children].map((e) => e.textContent);
  expect(textes).toEqual(["bandeau", "of", "q", "fil", "code", "", "shells"]);
  expect(c.querySelector("main").children[5].getAttribute("aria-label")).toBe("Hauteur des shells");
});

test("REQ028_AC2_titre_de_panneau_h2_et_pied_hors_du_corps_defilant", () => {
  const c = monter();
  const h = c.querySelector("aside h2");
  expect(h.textContent).toBe("Fichiers");
  expect(h.closest(".ya-panel-head")).not.toBeNull();
  expect(regle(".ya-panel-head")).toContain("height: var(--size-tab)");
  expect(regle(".ya-panel-title")).toContain("text-transform: uppercase");
  expect(regle(".ya-panel-title")).toContain("color: var(--ink-muted)");
  expect(regle(".cadre-panneau-corps")).toContain("overflow: auto");
  expect(c.querySelector(".cadre-panneau-pied").textContent).toBe("pied");
  expect(c.querySelector(".cadre-panneau-corps").contains(c.querySelector(".cadre-panneau-pied"))).toBe(false);
});

test("REQ028_AC9_grille_par_tokens_et_page_qui_defile_sous_le_minimum", () => {
  const r = regle(".cadre");
  expect(r).toContain("grid-template-rows: var(--size-titlebar) minmax(0, 1fr) var(--size-status)");
  expect(r).toContain("grid-template-columns: var(--size-activity) var(--taille-panneau, var(--largeur-panneau)) var(--epaisseur-poignee) minmax(0, 1fr)");
  expect(r).toContain("min-width: var(--largeur-min)");
  expect(r).toContain("min-height: var(--hauteur-min)");
  expect(regle(".cadre-shells")).toContain("var(--taille-shells, var(--part-shells))");
});

test("REQ033_AC8_fonds_distincts_par_zone_et_pas_de_bordure_entre_zones_redimensionnables", () => {
  expect(regle(".ya-titlebar")).toContain("background: var(--bg-000)");
  expect(regle(".cadre-rail")).toContain("background: var(--bg-000)");
  expect(regle(".ya-status")).toContain("background: var(--bg-000)");
  expect(regle(".cadre-shells")).toContain("background: var(--bg-000)");
  expect(regle(".cadre-panneau")).toContain("background: var(--bg-100)");
  expect(regle(".cadre-principal")).toContain("background: var(--bg-200)");
  expect(regle(".ya-crumbs")).toContain("background: var(--bg-200)");
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
  const c = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") }, tailles: { panneau: 240, shells: 200 }, surChangement: (z, t) => evts.push(["c", z, t]), surFin: (z, t) => evts.push(["f", z, t]) });
  c.poignees.panneau.definir({ min: 160, max: 436 });
  c.poignees.panneau.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  expect(evts).toEqual([["c", "panneau", 256], ["f", "panneau", 256]]);
});

test("REQ028_AC2_panneau_sans_titre_ni_pied_n_ajoute_rien", () => {
  const c = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") } });
  expect(c.querySelector("h2")).toBeNull();
  expect(c.querySelector(".cadre-panneau-pied")).toBeNull();
});

test("REQ032_AC7_sans_taille_choisie_mesurer_pose_la_taille_mesuree_sans_ecrire_les_tokens", () => {
  const c = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") } });
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
  expect(regle(".cadre-rail-commandes .ya-icon-btn")).toContain("width: var(--size-activity)");
  expect(regle(".cadre-rail-commandes .ya-icon-btn")).toContain("height: var(--size-activity)");
});

test("REQ028_AC12_sans_commandes_pas_de_groupe", () => {
  const c = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") } });
  expect(c.querySelector('[role="group"]')).toBeNull();
});

test("REQ037_AC2_AC3_barre_de_titre_symbole_bouton_central_et_actions", () => {
  const ouvert = [];
  const c = cadre({ barreTitre: { projet: "projet", chemin: "~/code/projet", surOuvrir: () => ouvert.push(1), actions: [p("a")] }, rail: { onglets: p("r") } });
  const h = c.querySelector("header");
  expect(h.firstElementChild.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
  expect(h.firstElementChild.querySelector("svg").getAttribute("width")).toBe("18");
  const b = h.querySelector("button.ya-command");
  expect(b.getAttribute("aria-label")).toBe("Ouverture rapide");
  expect(b.textContent).toBe("projet");
  expect(b.querySelector("svg").getAttribute("data-icone")).toBe("search");
  b.click();
  expect(ouvert).toEqual([1]);
  expect(b.hasAttribute("title")).toBe(false);
  expect(regle(".ya-titlebar")).toContain("grid-template-columns: 1fr minmax(240px, 560px) 1fr");
  expect(regle(".ya-titlebar")).toContain("border-bottom: var(--trait) solid var(--line)");
  expect(regle(".ya-command")).toContain("height: 24px");
  expect(regle(".ya-command:hover")).toContain("background: var(--bg-300)");
  expect(regle(".ya-command:hover")).toContain("border-color: var(--line-strong)");
});

test("REQ037_AC4_AC10_barre_d_etat_texte_sans_action_et_parties_absentes_masquees", () => {
  const c = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") }, barreEtat: { branche: "main" } });
  const f = c.querySelector("footer");
  expect(f.textContent).toBe("main");
  expect(f.querySelector("svg").getAttribute("data-icone")).toBe("branch");
  expect([...f.querySelectorAll("span[hidden]")].map((e) => e.className)).toEqual(["ya-status-position", "ya-status-langage"]);
  c.definirEtat({ position: "Ln 1, Col 1", langage: "Texte" });
  expect(f.textContent).toBe("Ln 1, Col 1Texte");
  expect(f.querySelector(".ya-status-branche").hidden).toBe(true);
  expect(f.querySelector("button, a, [tabindex]")).toBeNull();
  expect(regle(".ya-status")).toContain("border-top: var(--trait) solid var(--line)");
  expect(regle(".ya-status")).toContain("cursor: default");
});

test("REQ036_AC3_rail_un_seul_filet_et_boutons_de_48_px", () => {
  const rail = regle(".cadre-rail");
  expect(rail).not.toContain("border");
  expect(css).not.toMatch(/\.cadre-rail \.ya-activity/);
  expect(css).not.toContain("--largeur-rail");
  expect(css).not.toContain("--hauteur-barre");
  expect(regle(".cadre-rail::after")).toContain("background: var(--line)");
  expect(regle(".ya-activity")).not.toContain("border");
  expect(regle(".ya-activity")).toContain("width: var(--size-activity)");
  expect(regle(".ya-activity .onglet")).toContain("height: var(--size-activity)");
});
