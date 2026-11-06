import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { cadre } from "./cadre.js";
import { bouton } from "./bouton.js";
import { onglets } from "./onglets.js";
import { infoBulle } from "./info-bulle.js";

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
    panneau: { titre: "Fichiers", corps: p("corps") },
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

test("REQ028_AC2_titre_de_panneau_h2_corps_defilant_et_aucun_pied", () => {
  const c = monter();
  const h = c.querySelector("aside h2");
  expect(h.textContent).toBe("Fichiers");
  expect(h.closest(".ya-panel-head")).not.toBeNull();
  expect(regle(".ya-panel-head")).toContain("height: var(--size-tab)");
  expect(regle(".ya-panel-title")).toContain("text-transform: uppercase");
  expect(regle(".ya-panel-title")).toContain("color: var(--ink-muted)");
  expect(regle(".cadre-panneau-corps")).toContain("overflow: auto");
  expect(c.querySelector(".cadre-panneau-pied")).toBeNull();
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

test("REQ028_AC2_panneau_sans_titre_n_ajoute_rien", () => {
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

test("REQ040_AC9_zone_des_shells_masquee_puis_rendue_avec_sa_taille_choisie", () => {
  const c = monter();
  c.definirTailles({ shells: 200 });
  const zoneShells = c.querySelector(".cadre-shells");
  const poignee = c.poignees.shells;
  c.definirShellsVisibles(false);
  expect(zoneShells.hidden).toBe(true);
  expect(poignee.hidden).toBe(true);
  expect(regle(".cadre-shells[hidden]")).toContain("display: none");
  expect(c.style.getPropertyValue("--taille-shells")).toBe("200px");
  expect(zoneShells.textContent).toBe("shells");
  c.definirShellsVisibles(true);
  expect(zoneShells.hidden).toBe(false);
  expect(poignee.hidden).toBe(false);
  expect(c.style.getPropertyValue("--taille-shells")).toBe("200px");
  expect(poignee.getAttribute("aria-valuenow")).toBe("200");
});

test("REQ040_AC9_mesurer_n_interroge_pas_une_zone_masquee", () => {
  const c = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") } });
  document.body.append(c);
  Object.defineProperty(c.querySelector("aside"), "offsetWidth", { value: 240 });
  Object.defineProperty(c.querySelector(".cadre-shells"), "offsetHeight", { value: 0 });
  c.definirShellsVisibles(false);
  c.mesurer();
  expect(c.poignees.panneau.getAttribute("aria-valuenow")).toBe("240");
  expect(c.poignees.shells.getAttribute("aria-valuenow")).not.toBe("0");
});

test("REQ046_AC17_replis_a_la_creation_et_par_definirReplis", () => {
  const c = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") }, principal: { shells: p("s") }, replis: { panneau: true } });
  const aside = c.querySelector("aside");
  expect(aside.hidden).toBe(true);
  expect(c.poignees.panneau.hidden).toBe(true);
  expect(c.classList.contains("cadre-panneau-replie")).toBe(true);
  expect(c.querySelector(".cadre-shells").hidden).toBe(false);
  c.definirReplis({ shells: true });
  expect(c.querySelector(".cadre-shells").hidden).toBe(true);
  expect(c.poignees.shells.hidden).toBe(true);
  expect(aside.hidden).toBe(true);
  c.definirReplis({ panneau: false });
  expect(aside.hidden).toBe(false);
  expect(c.poignees.panneau.hidden).toBe(false);
  expect(c.classList.contains("cadre-panneau-replie")).toBe(false);
  expect(c.querySelector(".cadre-shells").hidden).toBe(true);
  // Le repli des shells ne rouvre pas une zone cachée par définirShellsVisibles, et inversement.
  c.definirReplis({ shells: false });
  expect(c.querySelector(".cadre-shells").hidden).toBe(false);
  c.definirShellsVisibles(false);
  c.definirReplis({ shells: false });
  expect(c.querySelector(".cadre-shells").hidden).toBe(true);
});

test("REQ046_AC17_css_du_cadre_replie_et_elements_caches", () => {
  expect(regle(".cadre.cadre-panneau-replie")).toContain("grid-template-columns: var(--size-activity) minmax(0, 1fr)");
  expect(regle(".cadre-panneau[hidden]")).toContain("display: none");
  expect(regle(".poignee-vertical[hidden]")).toContain("display: none");
});

test("REQ046_AC17_un_repli_ne_change_pas_la_taille_choisie_et_mesurer_n_ecrit_pas_0", () => {
  const c = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") }, tailles: { panneau: 300, shells: 200 } });
  document.body.append(c);
  c.definirReplis({ panneau: true, shells: true });
  expect(c.style.getPropertyValue("--taille-panneau")).toBe("300px");
  expect(c.style.getPropertyValue("--taille-shells")).toBe("200px");
  const c2 = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") }, replis: { panneau: true } });
  document.body.append(c2);
  Object.defineProperty(c2.querySelector("aside"), "offsetWidth", { value: 0 });
  Object.defineProperty(c2.querySelector(".cadre-shells"), "offsetHeight", { value: 245 });
  c2.mesurer();
  expect(c2.poignees.panneau.getAttribute("aria-valuenow")).not.toBe("0");
  expect(c2.poignees.shells.getAttribute("aria-valuenow")).toBe("245");
});

test("REQ046_AC17_les_boutons_de_actions_restent_dans_l_ordre_recu", () => {
  const c = cadre({ barreTitre: { projet: "p", actions: [p("a"), p("b"), p("c"), p("d")] }, rail: { onglets: p("r") } });
  expect([...c.querySelector(".ya-titlebar-actions").children].map((e) => e.textContent)).toEqual(["a", "b", "c", "d"]);
});

test("REQ046_AC17_replis_shells_puis_shellsVisibles_vrai_gardent_la_zone_cachee", () => {
  const c = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") }, principal: { shells: p("s") } });
  c.definirReplis({ shells: true });
  c.definirShellsVisibles(true);
  expect(c.querySelector(".cadre-shells").hidden).toBe(true);
  expect(c.poignees.shells.hidden).toBe(true);
});

test("REQ047_AC6_compteur_du_rail_affiche_12_et_reste_a_6_px_du_bord_droit_et_du_bas", () => {
  const b = bouton({ icone: "terminal", nomAccessible: "Nouveau shell" });
  b.definirCompteur(12);
  expect(b.querySelector(".ya-badge").textContent).toBe("12");
  const r = regle(".cadre-rail-commandes .ya-badge");
  expect(r).toContain("right: 6px");
  expect(r).toContain("bottom: 6px");
  expect(r).not.toMatch(/\bleft\b/);
  expect(r).not.toContain("max-width");
});

test("REQ048_AC1_en_tete_titre_puis_repli", () => {
  const repli = document.createElement("button");
  const avec = cadre({ panneau: { titre: "Fichiers", repli, corps: p("corps") } });
  const tete = avec.querySelector(".ya-panel-head");
  expect([...tete.children]).toEqual([tete.querySelector("h2"), repli]);
  const sans = cadre({ panneau: { titre: "Fichiers", corps: p("corps") } });
  expect(sans.querySelector(".ya-panel-head").children).toHaveLength(1);
});

test("REQ048_AC5_AC8_marges_de_l_en_tete", () => {
  expect(regle(".ya-panel-head")).toContain("height: var(--size-tab)");
  expect(regle(".ya-panel-head")).toContain("padding: 0 var(--space-1) 0 var(--space-3)");
  expect(regle(".fichiers-entete")).toContain("padding: 0 var(--space-1) 0 var(--space-3)");
});

test("REQ048_AC9_definirReplis_ferme_la_bulle_d_une_ancre_du_panneau", async () => {
  vi.useFakeTimers();
  const repli = document.createElement("button");
  const c = cadre({ panneau: { titre: "Fichiers", repli, corps: p("corps") } });
  document.body.append(c);
  const dehors = document.createElement("button");
  document.body.append(dehors);
  infoBulle({ texte: "Replier", ancre: repli });
  infoBulle({ texte: "Dehors", ancre: dehors });
  const ouvertes = () => [...document.querySelectorAll('[role="tooltip"]')].filter((e) => e.dataset.ouverte === "true");
  dehors.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  c.definirReplis({ panneau: true });
  expect(ouvertes().map((e) => e.textContent)).toEqual(["Dehors"]);
  c.definirReplis({ panneau: false });
  repli.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(ouvertes().map((e) => e.textContent)).toEqual(["Replier"]);
  c.definirReplis({ panneau: true });
  expect(ouvertes()).toHaveLength(0);
  vi.useRealTimers();
});

test("REQ028_AC14_quatre_onglets_tiennent_a_480", () => {
  const onglet = (id, nomAccessible, icone) => ({ id, nomAccessible, icone });
  const rail = onglets({
    presentation: "rail",
    actif: "fichiers",
    onglets: [onglet("fichiers", "Fichiers", "files"), onglet("recherche", "Recherche", "search"), onglet("git", "Git", "branch"), onglet("agent", "Agent", "bot")],
  });
  const commandes = ["Nouveau shell", "Réduire le shell", "Shells réduits", "Fermer le shell"].map((libelle, i) => bouton({ nomAccessible: libelle, icone: ["terminal", "minimize-2", "layers", "square-x"][i] }));
  const c = cadre({ rail: { onglets: rail, commandes } });
  document.body.append(c);
  const nav = c.querySelector('nav[aria-label="Panneaux"]');
  expect([...nav.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute("aria-label"))).toEqual(["Fichiers", "Recherche", "Git", "Agent"]);
  expect(nav.querySelector('[data-icone="bot"]')).not.toBeNull();
  expect(c.querySelectorAll('[aria-label="Shells"] button').length).toBe(4);
  // 8 boutons de --size-activity : 384 px, pour 480 - 35 - 22 = 423 px disponibles, sans défilement.
  const px = (nom) => parseFloat(tokens.match(new RegExp(`${nom}:\\s*(\\d+)px`))[1]);
  const boutons = nav.querySelectorAll('[role="tab"]').length + c.querySelectorAll('[aria-label="Shells"] button').length;
  expect(boutons * px("--size-activity")).toBe(384);
  expect(boutons * px("--size-activity")).toBeLessThanOrEqual(px("--hauteur-min") - px("--size-titlebar") - px("--size-status"));
  expect(regle(".ya-activity .onglet")).toContain("height: var(--size-activity)");
  expect(regle(".onglet-cellule")).toContain("flex: none");
  for (const s of [".cadre-rail", ".cadre-rail-onglets", ".cadre-rail-commandes"]) expect(regle(s)).not.toMatch(/overflow/);
});
