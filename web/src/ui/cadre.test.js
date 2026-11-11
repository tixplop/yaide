import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { cadre } from "./cadre.js";
import { bouton } from "./bouton.js";
import { onglets } from "./onglets.js";
import { infoBulle } from "./info-bulle.js";
import { terminal } from "./terminal.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());
const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
HTMLCanvasElement.prototype.getContext = () => null;
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
  expect(c.querySelector("footer").textContent).toBe("mainLn 6, Col 31RustServeur : Connecté");
  expect(c.querySelector('nav[aria-label="Panneaux"]').textContent).toBe("rail");
  expect(c.querySelector(".cadre-rail").tagName).toBe("DIV");
  expect(c.querySelector("aside").textContent).toContain("corps");
  expect(c.querySelector("main").textContent).toContain("shells");
});

test("REQ028_AC8_ordre_dom_barre_rail_panneau_principal_puis_onglets_code_shells", () => {
  const c = monter();
  const noms = [...c.children].map((e) => e.tagName.toLowerCase());
  expect(noms).toEqual(["header", "div", "aside", "div", "main", "div", "aside", "div", "footer"]);
  expect(c.children[3].getAttribute("aria-label")).toBe("Largeur du panneau");
  const textes = [...c.querySelector("main").children].map((e) => e.textContent);
  // Les quatre zones de l'éditeur sont dans l'enveloppe d'un groupe (REQ-079), dans le même ordre.
  expect(textes).toEqual(["bandeau", "ofqfilcode", "", "shells"]);
  expect([...c.querySelector(".cadre-groupe").children].map((e) => e.textContent)).toEqual(["of", "q", "fil", "code"]);
  expect(c.querySelector("main").children[2].getAttribute("aria-label")).toBe("Hauteur des shells");
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
  expect(f.textContent).toBe("mainServeur : Connecté");
  expect(f.querySelector("svg").getAttribute("data-icone")).toBe("branch");
  expect([...f.querySelectorAll("span[hidden]")].map((e) => e.className)).toEqual(["ya-status-position", "ya-status-langage", "ya-status-version"]);
  c.definirEtat({ position: "Ln 1, Col 1", langage: "Texte" });
  expect(f.textContent).toBe("Ln 1, Col 1TexteServeur : Connecté");
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
  expect(regle(".cadre.cadre-panneau-replie")).toContain("grid-template-columns: var(--size-activity) 0 0 minmax(0, 1fr)");
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

function monterAgent(options = {}) {
  const c = cadre({
    barreTitre: { projet: "p" },
    rail: { onglets: p("rail") },
    panneau: { titre: "Fichiers", corps: p("corps") },
    agent: { titre: "Agent", repli: bouton({ icone: "panel-right-close", nomAccessible: "Replier l'agent" }), corps: p("conv") },
    railDroit: { commandes: [bouton({ icone: "bot", nomAccessible: "Agent", raccourci: "A", positionInfoBulle: "gauche", actif: false })] },
    principal: { code: p("code") },
    ...options,
  });
  document.body.append(c);
  return c;
}

test("REQ059_AC1_agent_aside_etiquete_apres_main_et_rail_droit_sans_role", () => {
  const c = monterAgent({ replis: { agent: false } });
  const a = c.querySelector("aside.cadre-agent");
  expect(a.getAttribute("aria-labelledby")).toBe(a.querySelector("h2").id);
  expect(a.querySelector(".ya-panel-head h2").textContent).toBe("Agent");
  expect(a.querySelector(".ya-panel-head button").getAttribute("aria-label")).toBe("Replier l'agent");
  const rd = c.querySelector(".cadre-rail-droit");
  expect(rd.tagName).toBe("DIV");
  expect(rd.hasAttribute("role")).toBe(false);
  expect(rd.querySelector("button").getAttribute("aria-label")).toBe("Agent");
  expect(regle(".cadre-rail-droit::after")).toContain("background: var(--line)");
});

test("REQ059_AC1_ordre_du_dom_main_poignee_colonne_rail_droit", () => {
  const c = monterAgent({ replis: { agent: false } });
  const i = [...c.children];
  const main = i.indexOf(c.querySelector("main"));
  expect(i[main + 1].getAttribute("aria-label")).toBe("Largeur de l'agent");
  expect(i[main + 2]).toBe(c.querySelector("aside.cadre-agent"));
  expect(i[main + 3]).toBe(c.querySelector(".cadre-rail-droit"));
});

test("REQ059_AC3_agent_replie_par_defaut_hidden_et_aucun_arret_de_tab", () => {
  const c = monterAgent();
  const a = c.querySelector("aside.cadre-agent");
  expect(a.hidden).toBe(true);
  expect(c.poignees.agent.hidden).toBe(true);
  expect(c.classList.contains("cadre-agent-replie")).toBe(true);
  expect(regle(".cadre-agent[hidden]")).toContain("display: none");
  expect(regle(".cadre.cadre-agent-replie")).toContain("minmax(0, 1fr) 0 0 var(--size-activity)");
  // Le contenu reste dans la page (sa vue est gardée), mais hors de la tabulation par `hidden`.
  expect(a.querySelector("button")).not.toBeNull();
  expect(a.closest("[hidden]")).toBe(a);
  c.definirReplis({ agent: false });
  expect(a.hidden).toBe(false);
  expect(c.poignees.agent.hidden).toBe(false);
  c.definirReplis({ agent: true });
  expect(a.hidden).toBe(true);
});

test("REQ059_AC3_replier_l_agent_ne_change_pas_le_panneau_et_garde_la_taille_choisie", () => {
  const c = monterAgent({ tailles: { agent: 400 }, replis: { agent: false } });
  expect(c.poignees.agent.getAttribute("aria-valuenow")).toBe("400");
  expect(c.style.getPropertyValue("--taille-agent")).toBe("400px");
  c.definirReplis({ agent: true });
  expect(c.querySelector("aside").hidden).toBe(false);
  expect(c.style.getPropertyValue("--taille-agent")).toBe("400px");
  expect(c.poignees.agent.getAttribute("aria-valuenow")).toBe("400");
});

test("REQ059_AC11_poignee_de_l_agent_cote_droite_et_transmission", () => {
  const surChangement = vi.fn();
  const c = monterAgent({ tailles: { agent: 300 }, replis: { agent: false }, surChangement });
  const h = c.poignees.agent;
  expect(h.getAttribute("aria-label")).toBe("Largeur de l'agent");
  h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  expect(surChangement).toHaveBeenCalledWith("agent", 316);
});

test("REQ059_AC1_info_bulle_gauche_de_la_commande_du_rail_droit", () => {
  const c = monterAgent();
  const b = c.querySelector(".cadre-rail-droit button");
  expect(b.getAttribute("aria-keyshortcuts")).toBe("A");
  expect(b.hasAttribute("aria-pressed")).toBe(false);
  expect(b.hasAttribute("aria-expanded")).toBe(false);
});

test("REQ059_AC5_fonds_filets_et_grille_a_sept_colonnes", () => {
  expect(regle(".cadre-agent")).toContain("background: var(--bg-100)");
  expect(regle(".cadre-rail-droit")).toContain("background: var(--bg-000)");
  expect(regle(".cadre")).toContain("var(--epaisseur-poignee) var(--taille-agent, var(--largeur-agent)) var(--size-activity);");
});

function deuxCommandes() {
  return [
    bouton({ icone: "bot", nomAccessible: "Agent", raccourci: "A", positionInfoBulle: "gauche", actif: true }),
    bouton({ icone: "users", nomAccessible: "Agents", positionInfoBulle: "gauche", actif: false }),
  ];
}

test("REQ059_AC1_rail_droit_deux_commandes_dans_l_ordre", () => {
  const [a, b] = deuxCommandes();
  const c = monterAgent({ railDroit: { commandes: [a.enveloppe, b.enveloppe] }, replis: { agent: false } });
  const rd = c.querySelector(".cadre-rail-droit");
  expect([...rd.querySelectorAll("button")].map((x) => x.getAttribute("aria-label"))).toEqual(["Agent", "Agents"]);
  expect(rd.querySelector("[data-icone=users]")).not.toBeNull();
  expect(a.hasAttribute("data-actif")).toBe(true);
  expect(b.hasAttribute("data-actif")).toBe(false);
  expect(b.hasAttribute("aria-keyshortcuts")).toBe(false);
  // Colonne repliée : les deux restent affichées.
  c.definirReplis({ agent: true });
  expect(rd.hidden).toBe(false);
  expect(rd.querySelectorAll("button")).toHaveLength(2);
});

test("REQ059_AC15_titre_de_la_colonne_et_aria_labelledby", () => {
  const c = monterAgent({ replis: { agent: false } });
  const a = c.querySelector("aside.cadre-agent");
  const h = a.querySelector("h2");
  expect(a.getAttribute("aria-labelledby")).toBe(h.id);
  expect(a.hasAttribute("aria-label")).toBe(false);
  c.definirTitreAgent("Agents");
  expect(h.textContent).toBe("Agents");
  expect(a.getAttribute("aria-labelledby")).toBe(h.id);
  // Deux cadres dans la page : chaque colonne suit son propre titre.
  const d = monterAgent();
  expect(d.querySelector("aside.cadre-agent h2").id).not.toBe(h.id);
  // Plusieurs vues dans le corps de la colonne.
  const e = monterAgent({ agent: { titre: "Agent", corps: [p("vue 1"), p("vue 2")] } });
  expect([...e.querySelectorAll(".cadre-agent .cadre-panneau-corps > p")].map((x) => x.textContent)).toEqual(["vue 1", "vue 2"]);
  expect(() => cadre({ agent: { corps: p("x") } }).definirTitreAgent("Agents")).toThrow(/titre/);
});

test("REQ064_barre_pied_et_ligne_des_agents_dans_composants_css", () => {
  expect(regle(".ya-agents-barre")).toContain("height: 27px");
  expect(regle(".ya-agents-barre")).toContain("border-bottom: var(--trait) solid var(--line)");
  expect(regle(".ya-agents-pied")).toContain("border-top: var(--trait) solid var(--line)");
  expect(regle(".ya-agents-pied")).toContain("flex-wrap: wrap");
  expect(regle(".ya-agents")).toContain("flex-wrap: wrap");
  expect(regle(".ya-agents")).toContain("gap: var(--space-1) var(--space-3)");
});

test("REQ028_AC14_rail_droit_a_480", () => {
  const [a, b] = deuxCommandes();
  const c = monterAgent({ railDroit: { commandes: [a.enveloppe, b.enveloppe] } });
  const px = (nom) => parseFloat(tokens.match(new RegExp(`${nom}:\\s*(\\d+)px`))[1]);
  expect(c.querySelectorAll(".cadre-rail-droit button")).toHaveLength(2);
  expect(2 * px("--size-activity")).toBe(96);
  expect(2 * px("--size-activity")).toBeLessThanOrEqual(px("--hauteur-min") - px("--size-titlebar") - px("--size-status"));
  expect(regle(".cadre-rail-droit .ya-icon-btn")).toContain("height: var(--size-activity)");
  expect(regle(".cadre-rail-droit")).not.toMatch(/overflow/);
  expect(regle(".cadre-rail-droit .ya-icon-btn")).not.toMatch(/overflow/);
});

test("REQ028_AC14_rail_droit_trois_commandes_a_480", () => {
  const cmd = (icone, nomAccessible) => bouton({ icone, nomAccessible, positionInfoBulle: "gauche" });
  const c = cadre({ railDroit: { commandes: [cmd("bot", "Agent").enveloppe, cmd("users", "Agents").enveloppe, cmd("asterisk", "Claude").enveloppe] } });
  document.body.append(c);
  const rd = c.querySelector(".cadre-rail-droit");
  expect([...rd.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Agent", "Agents", "Claude"]);
  const px = (nom) => parseFloat(tokens.match(new RegExp(`${nom}:\\s*(\\d+)px`))[1]);
  // 3 × 48 + 8 de vide = 152 px, pour 480 - 35 - 22 = 423 px disponibles, sans défilement.
  expect(3 * px("--size-activity") + px("--space-2")).toBe(152);
  expect(px("--size-activity") * 3 + px("--space-2")).toBeLessThanOrEqual(px("--hauteur-min") - px("--size-titlebar") - px("--size-status"));
  expect(regle(".cadre-rail-droit")).not.toMatch(/overflow/);
  expect(regle(".cadre-rail-droit .bouton-enveloppe:nth-child(n+3)")).toContain("margin-top: var(--space-2)");
  expect(regle(".cadre-rail-droit .ya-icon-btn")).toContain("height: var(--size-activity)");
});

test("cadre_principal_code_porte_un_terminal", () => {
  const flux = Object.assign(new EventTarget(), { send() {} });
  const t = terminal({ flux, nom: "Claude 1" });
  const c = cadre({ principal: { ongletsFichiers: p("of"), questionOnglet: p("q"), code: t } });
  document.body.append(c);
  const code = c.querySelector(".cadre-code");
  expect(code.firstElementChild).toBe(t);
  expect(c.querySelector(".cadre-fil").children).toHaveLength(0);
  expect(code.querySelector(".terminal-zone").getAttribute("aria-label")).toBe("Claude 1");
  expect(c.querySelector(".cadre-question").textContent).toBe("q");
  expect(regle(".cadre-code")).toContain("flex: 1 1 0");
  expect(regle(".terminal")).toContain("background: var(--bg-000)");
  t.detruire();
});

function monterFonctions(fonctions, extra = {}) {
  const c = cadre({
    rail: { onglets: p("rail"), commandes: [p("cmd")] },
    panneau: { titre: "Fichiers", corps: p("corps") },
    agent: { titre: "Agent", corps: p("agent") },
    railDroit: { commandes: [p("rd")] },
    principal: { code: p("code"), shells: p("shells") },
    fonctions,
    ...extra,
  });
  document.body.append(c);
  return c;
}

test("REQ070_cadre_sans_shells_ni_zone_ni_poignee_ni_commandes", () => {
  const c = monterFonctions({ shells: false });
  expect(c.querySelector(".cadre-rail-commandes")).toBeNull();
  expect(c.querySelector(".cadre-shells")).toBeNull();
  expect(c.querySelector('[aria-label="Hauteur des shells"]')).toBeNull();
  expect(c.poignees.shells).toBeUndefined();
  expect(() => { c.definirShellsVisibles(true); c.definirReplis({ shells: true }); c.mesurer(); }).not.toThrow();
  expect(c.querySelector(".cadre-shells")).toBeNull();
  const avec = monterFonctions({});
  expect(avec.querySelector(".cadre-rail-commandes")).not.toBeNull();
  expect(avec.querySelector('[aria-label="Hauteur des shells"]')).not.toBeNull();
});

test("REQ070_cadre_sans_agents_ni_colonne_ni_poignee", () => {
  const c = monterFonctions({ agents: false });
  expect(c.querySelector(".cadre-agent")).toBeNull();
  expect(c.querySelector('[aria-label="Largeur de l\'agent"]')).toBeNull();
  expect(c.poignees.agent).toBeUndefined();
  expect(() => { c.definirTitreAgent("Agents"); c.definirReplis({ agent: false }); }).not.toThrow();
  expect(c.querySelector(".cadre-agent")).toBeNull();
  expect(c.classList.contains("cadre-agent-replie")).toBe(true);
  expect(monterFonctions({}).querySelector(".cadre-agent")).not.toBeNull();
});

test("REQ070_cadre_sans_rail_droit_si_aucune_commande", () => {
  const c = monterFonctions({ agents: false }, { railDroit: { commandes: [] } });
  expect(c.querySelector(".cadre-rail-droit")).toBeNull();
  expect(c.classList.contains("cadre-sans-rail-droit")).toBe(true);
  expect(regle(".cadre.cadre-sans-rail-droit.cadre-agent-replie")).toContain("minmax(0, 1fr) 0 0 0;");
  expect(regle(".cadre.cadre-sans-rail-droit.cadre-panneau-replie.cadre-agent-replie")).toContain("0 0 minmax(0, 1fr) 0 0 0;");
  expect(monterFonctions({}).querySelector(".cadre-rail-droit")).not.toBeNull();
});

test("REQ070_ajouter_commande_droite_cree_le_rail", () => {
  const c = monterFonctions({ agents: false }, { railDroit: { commandes: [] } });
  const el = p("Claude");
  c.ajouterCommandeDroite(el);
  const rd = c.querySelector(".cadre-rail-droit");
  expect(rd.firstChild).toBe(el);
  expect(rd.nextElementSibling.tagName).toBe("FOOTER");
  expect(c.classList.contains("cadre-sans-rail-droit")).toBe(false);
  c.ajouterCommandeDroite(p("autre"));
  expect(c.querySelectorAll(".cadre-rail-droit")).toHaveLength(1);
});

const cmdDroite = (icone, nomAccessible) => bouton({ icone, nomAccessible, positionInfoBulle: "gauche" }).enveloppe;
const avecVide = (rd) => [...rd.children].map((e) => e.matches(".bouton-enveloppe:nth-child(n+3):not(:nth-child(n+4))"));

test("REQ059_AC20_opencode_colle_a_claude_ou_8_px_sous_agents", () => {
  expect(regle(".cadre-rail-droit .bouton-enveloppe:nth-child(n+3)")).toContain("margin-top: var(--space-2)");
  expect(regle(".cadre-rail-droit .bouton-enveloppe:nth-child(n+4)")).toContain("margin-top: 0");
  const noms = (c) => [...c.querySelectorAll(".cadre-rail-droit button")].map((b) => b.getAttribute("aria-label"));
  // Avec « Claude » : le vide est avant « Claude », « opencode » le suit, collé.
  const a = cadre({ railDroit: { commandes: [cmdDroite("bot", "Agent"), cmdDroite("users", "Agents"), cmdDroite("asterisk", "Claude"), cmdDroite("code-xml", "opencode")] } });
  expect(noms(a)).toEqual(["Agent", "Agents", "Claude", "opencode"]);
  expect(avecVide(a.querySelector(".cadre-rail-droit"))).toEqual([false, false, true, false]);
  // Sans « Claude » : « opencode » prend les 8 px.
  const b = cadre({ railDroit: { commandes: [cmdDroite("bot", "Agent"), cmdDroite("users", "Agents"), cmdDroite("code-xml", "opencode")] } });
  expect(avecVide(b.querySelector(".cadre-rail-droit"))).toEqual([false, false, true]);
  // Ajouté après coup, comme « Claude » : même résultat.
  const c = cadre({ railDroit: { commandes: [cmdDroite("bot", "Agent"), cmdDroite("users", "Agents")] } });
  c.ajouterCommandeDroite(cmdDroite("asterisk", "Claude"));
  c.ajouterCommandeDroite(cmdDroite("code-xml", "opencode"));
  expect(avecVide(c.querySelector(".cadre-rail-droit"))).toEqual([false, false, true, false]);
});

test("REQ070_AC20_rail_droit_avec_opencode_seul", () => {
  const sans = cadre({ fonctions: { agents: false, claude: false }, railDroit: { commandes: [] } });
  expect(sans.querySelector(".cadre-rail-droit")).toBeNull();
  expect(sans.classList.contains("cadre-sans-rail-droit")).toBe(true);
  const c = cadre({ fonctions: { agents: false, claude: false }, railDroit: { commandes: [cmdDroite("code-xml", "opencode")] } });
  const rd = c.querySelector(".cadre-rail-droit");
  expect(rd).not.toBeNull();
  expect(c.classList.contains("cadre-sans-rail-droit")).toBe(false);
  expect([...rd.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["opencode"]);
  // Seul, il est au bord haut : aucun vide avant lui.
  expect(avecVide(rd)).toEqual([false]);
  // Sans « Agent » ni « Agents » : « Claude » au bord haut, « opencode » collé dessous.
  const e = cadre({ fonctions: { agents: false }, railDroit: { commandes: [cmdDroite("asterisk", "Claude"), cmdDroite("code-xml", "opencode")] } });
  const rde = e.querySelector(".cadre-rail-droit");
  expect([...rde.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Claude", "opencode"]);
  expect(avecVide(rde)).toEqual([false, false]);
  const f = cadre({ fonctions: { agents: false }, railDroit: { commandes: [] } });
  f.ajouterCommandeDroite(cmdDroite("asterisk", "Claude"));
  f.ajouterCommandeDroite(cmdDroite("code-xml", "opencode"));
  expect(avecVide(f.querySelector(".cadre-rail-droit"))).toEqual([false, false]);
  // Rail créé après coup avec « opencode » seul.
  const d = cadre({ fonctions: { agents: false }, railDroit: { commandes: [] } });
  d.ajouterCommandeDroite(cmdDroite("code-xml", "opencode"));
  expect(avecVide(d.querySelector(".cadre-rail-droit"))).toEqual([false]);
});

test("REQ028_AC14_rail_droit_quatre_commandes_a_480", () => {
  const c = cadre({ railDroit: { commandes: [cmdDroite("bot", "Agent"), cmdDroite("users", "Agents"), cmdDroite("asterisk", "Claude"), cmdDroite("code-xml", "opencode")] } });
  document.body.append(c);
  const px = (nom) => parseFloat(tokens.match(new RegExp(`${nom}:\\s*(\\d+)px`))[1]);
  expect(c.querySelectorAll(".cadre-rail-droit button")).toHaveLength(4);
  // 4 × 48 + 8 de vide = 200 px, pour 480 - 35 - 22 = 423 px disponibles, sans défilement.
  expect(4 * px("--size-activity") + px("--space-2")).toBe(200);
  expect(4 * px("--size-activity") + px("--space-2")).toBeLessThanOrEqual(px("--hauteur-min") - px("--size-titlebar") - px("--size-status"));
  expect(regle(".cadre-rail-droit")).not.toMatch(/overflow/);
  expect(regle(".cadre-rail-droit .ya-icon-btn")).toContain("height: var(--size-activity)");
});

test("REQ072_AC21_session_largeur_max_centree", () => {
  expect(tokens).toMatch(/--largeur-session:\s*1200px;/);
  const session = regle(".session");
  expect(session).toContain("display: flex");
  expect(session).toContain("flex-direction: column");
  expect(session).toContain("height: 100%");
  expect(session).toContain("background: var(--bg-200)");
  // La conversation défile seule et descend jusqu'à 0 ; le reste ne grandit pas et rétrécit avant la saisie (les demandes défilent).
  expect(regle(".session-conversation")).toMatch(/flex: 1 1 0;.*min-height: 0;.*overflow-y: auto/);
  const bas = regle(".session-bas");
  expect(bas).toMatch(/flex: 0 1 auto;\s*min-height: 0/);
  expect(bas).toContain("border-top: var(--trait) solid var(--line)");
  // Demandes : la moitié de la hauteur de l'éditeur au plus, puis défilement.
  expect(regle(".session-attentes")).toMatch(/flex: 0 1 auto;\s*min-height: 0;\s*max-height: 50cqh;.*overflow-y: auto/);
  expect(regle(".cadre-code")).toContain("container-type: size");
  // Contenu : 1200 px au plus, centré, marges de --space-3.
  const contenu = regle(".session-contenu");
  expect(contenu).toContain("max-width: calc(var(--largeur-session) + 2 * var(--space-3))");
  expect(contenu).toContain("margin-inline: auto");
  expect(contenu).toContain("padding-inline: var(--space-3)");
  // Hauteur trop petite : la session garde la hauteur de l'éditeur, la page ne défile pas.
  // Une session posée dans le cadre remplace l'éditeur, sans toucher à la page.
  const s = document.createElement("div");
  s.className = "session";
  const c = cadre({ principal: { code: s } });
  expect(c.querySelector(".cadre-code").firstElementChild).toBe(s);
});

test("REQ079_css_groupes_de_l_editeur_et_guides_de_depot", () => {
  expect(regle(".cadre-groupes")).toMatch(/flex: 1 1 0.*min-height: 0|min-height: 0.*flex: 1 1 0/);
  expect(regle('.cadre-decoupe[data-sens="ligne"]')).toContain("flex-direction: row");
  expect(regle('.cadre-decoupe[data-sens="colonne"]')).toContain("flex-direction: column");
  expect(regle(".cadre-decoupe > .poignee-groupe")).toContain("flex: 0 0 var(--epaisseur-poignee)");
  expect(regle(".cadre-groupe")).toContain("position: relative");
  expect(regle(".cadre-groupe > :not(.ya-depot)")).toContain("isolation: isolate");
  expect(regle(".ya-depot")).toContain("inset: 0");
  expect(regle(".ya-depot-corps")).toContain("--g: 25%");
  expect(regle("[data-zone-depot]")).toContain("pointer-events: none");
  expect(regle('[data-zone-depot="centre"]')).toContain("inset: calc(var(--h) + var(--space-1))");
  expect(regle('.ya-depot [data-depot="haut"]')).toContain("inset: 0 0 50% 0");
  expect(regle('.ya-depot [data-depot="centre"]')).toContain("inset: 0");
  const bloc = css.slice(css.indexOf(".cadre-groupes {"), css.indexOf('.ya-depot [data-depot="centre"]'));
  expect(bloc).not.toMatch(/transition/);
  expect(bloc).not.toMatch(/#[0-9a-f]{3,6}\b/i);
});

test("REQ079_cadre_groupes_arbre_et_definirGroupes_reutilise_les_elements", () => {
  const feuille = (id) => ({ id, ongletsFichiers: p(`o${id}`), questionOnglet: p(`q${id}`), fil: p(`f${id}`), code: p(`c${id}`) });
  const [a, b, c] = [feuille("a"), feuille("b"), feuille("c")];
  const cd = cadre({ principal: { groupes: { sens: "ligne", a, b }, shells: p("shells") } });
  document.body.append(cd);
  expect(cd.querySelector(".cadre-principal > .cadre-groupes")).not.toBeNull();
  expect(cd.querySelector(".cadre-groupes > .cadre-decoupe[data-sens=ligne]").children.length).toBe(3);
  const [ga, gb] = cd.querySelectorAll(".cadre-groupe");
  expect([...ga.children].map((x) => x.className)).toEqual(["cadre-onglets", "cadre-question", "cadre-fil", "cadre-code"]);
  expect(ga.textContent).toBe("oaqafaca");
  cd.definirGroupes({ sens: "colonne", a: { sens: "ligne", a, b }, b: c }, "b");
  expect(cd.querySelector(".cadre-decoupe[data-sens=colonne]")).not.toBeNull();
  const apres = cd.querySelectorAll(".cadre-groupe");
  expect(apres.length).toBe(3);
  expect(apres[0]).toBe(ga);
  expect(apres[1]).toBe(gb);
  expect(apres[0].querySelector(".cadre-code").firstChild).toBe(a.code);
  cd.definirGroupes(b, "b");
  expect(cd.querySelectorAll(".cadre-groupe").length).toBe(1);
  expect(cd.querySelector(".cadre-decoupe")).toBeNull();
  expect(cd.querySelector(".cadre-groupe")).toBe(gb);
});

test("REQ079_cadre_sans_groupes_les_quatre_cles_valent_un_groupe", () => {
  const cd = monter();
  const g = cd.querySelectorAll(".cadre-groupe");
  expect(g.length).toBe(1);
  expect(g[0].parentElement.className).toBe("cadre-groupes");
  expect(cd.querySelector(".cadre-decoupe")).toBeNull();
  expect(g[0].querySelector(".cadre-code").textContent).toBe("code");
});

// REQ-080 : poignée entre les groupes. Mise en page simulée : `getBoundingClientRect` suit `style.flex` des parties.
HTMLElement.prototype.setPointerCapture ??= () => {};
const base = { width: 901, height: 601 };
function rectSimule(e) {
  if (e.classList.contains("cadre-groupes")) return { ...base };
  const parent = e.parentElement;
  if (!parent) return { width: 0, height: 0 };
  if (parent.classList.contains("cadre-groupes")) return rectSimule(parent);
  if (!parent.classList.contains("cadre-decoupe")) return { width: 0, height: 0 };
  const pr = rectSimule(parent);
  const ligne = parent.dataset.sens === "ligne";
  const [a, , b] = parent.children;
  const libre = (ligne ? pr.width : pr.height) - 1;
  const taille = e.classList.contains("poignee-groupe") ? 1 : (libre * parseFloat(e.style.flex)) / (parseFloat(a.style.flex) + parseFloat(b.style.flex));
  return ligne ? { width: taille, height: pr.height } : { width: pr.width, height: taille };
}
const simuler = () =>
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    const r = rectSimule(this);
    return { ...r, left: 0, top: 0, right: r.width, bottom: r.height, x: 0, y: 0 };
  });
const feuilleG = (id) => ({ id, ongletsFichiers: p(`o${id}`), questionOnglet: p(`q${id}`), fil: p(`f${id}`), code: p(`c${id}`) });
const taillesDe = (cd, id) => {
  const r = cd.querySelector(".cadre-groupes").querySelectorAll(".cadre-groupe");
  const e = [...r].find((x) => x.textContent.includes(`o${id}q${id}`));
  return e.getBoundingClientRect();
};
function monterGroupes(arbre, L = 901, H = 601) {
  base.width = L;
  base.height = H;
  simuler();
  const cd = cadre({ principal: { groupes: arbre, groupeCourant: "a", shells: p("shells") } });
  document.body.append(cd);
  cd.mesurer();
  return cd;
}
const ptr = (type, x, y) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 });
const fleche = (e, key) => e.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const flexes = (cd) => [...cd.querySelectorAll(".cadre-groupe")].map((x) => x.style.flex.replace(/ 0px$/, " 0"));
const aria = (e) => ["aria-valuenow", "aria-valuemin", "aria-valuemax"].map((a) => e.getAttribute(a));

test("REQ080_AC3_une_poignee_par_decoupe", () => {
  const seul = monterGroupes(feuilleG("a"));
  expect(seul.querySelectorAll(".poignee-groupe").length).toBe(0);
  const [a, b, c, d] = ["a", "b", "c", "d"].map(feuilleG);
  const quatre = monterGroupes({ sens: "ligne", a: { sens: "colonne", a, b }, b: { sens: "colonne", a: c, b: d } });
  expect(quatre.querySelectorAll(".poignee-groupe").length).toBe(3);
  expect(quatre.querySelectorAll(".poignee-groupe")[0].classList.contains("poignee")).toBe(true);
});

test("REQ080_AC12_ordre_du_dom", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map(feuilleG);
  const cd = monterGroupes({ sens: "ligne", a, b: { sens: "colonne", a: b, b: { sens: "ligne", a: c, b: d } } });
  for (const decoupe of cd.querySelectorAll(".cadre-decoupe")) {
    expect(decoupe.children[1].classList.contains("poignee-groupe")).toBe(true);
    expect(decoupe.children.length).toBe(3);
  }
  const racineDecoupe = cd.querySelector(".cadre-groupes > .cadre-decoupe");
  expect([...racineDecoupe.children].map((x) => x.className.split(" ")[0])).toEqual(["cadre-groupe", "poignee", "cadre-decoupe"]);
  expect([...cd.querySelectorAll(".poignee-groupe")].map((x) => x.getAttribute("aria-label"))).toEqual([
    "Entre les groupes 1 et 2",
    "Entre les groupes 2 et 3",
    "Entre les groupes 3 et 4",
  ]);
});

test("REQ080_AC17_noms_apres_une_fermeture", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map(feuilleG);
  const cd = monterGroupes({ sens: "ligne", a: { sens: "colonne", a, b }, b: { sens: "colonne", a: c, b: d } });
  const noms = () => [...cd.querySelectorAll(".poignee-groupe")].map((x) => x.getAttribute("aria-label"));
  expect(noms()).toEqual(["Entre les groupes 1 et 2", "Entre les groupes 2 et 3", "Entre les groupes 3 et 4"]);
  cd.definirGroupes({ sens: "ligne", a, b: { sens: "colonne", a: c, b: d } }, "a");
  expect(noms()).toEqual(["Entre les groupes 1 et 2", "Entre les groupes 2 et 3"]);
});

test("REQ080_AC11_attributs", () => {
  const [a, b, c] = ["a", "b", "c"].map(feuilleG);
  const cd = monterGroupes({ sens: "ligne", a, b: { sens: "colonne", a: b, b: c } }, 900, 600);
  const [ligne, colonne] = [...cd.querySelectorAll(".poignee-groupe")];
  expect(ligne.getAttribute("role")).toBe("separator");
  expect(ligne.getAttribute("aria-orientation")).toBe("vertical");
  expect(ligne.getAttribute("aria-label")).toBe("Entre les groupes 1 et 2");
  expect(ligne.tabIndex).toBe(0);
  expect(colonne.getAttribute("aria-orientation")).toBe("horizontal");
  expect(colonne.getAttribute("aria-label")).toBe("Entre les groupes 2 et 3");
  // Deux groupes côte à côte dans 900 px : 320 et 579 (valeur = 899 / 2, arrondie).
  const deux = monterGroupes({ sens: "ligne", a, b }, 900, 600);
  expect(aria(deux.querySelector(".poignee-groupe"))).toEqual(["450", "320", "579"]);
  // Éditeur de 1500 px, un groupe à gauche, deux côte à côte partagés 0,4 / 0,6 à droite : 320 et 698.
  const trois = monterGroupes({ sens: "ligne", part: 0.3, a, b: { sens: "ligne", part: 0.4, a: b, b: c } }, 1500, 600);
  expect(aria(trois.querySelector(".poignee-groupe"))).toEqual(["450", "320", "698"]);
});

test("REQ080_AC1_AC2_glisse_change_les_deux_parties", () => {
  const [a, b] = ["a", "b"].map(feuilleG);
  const surPartage = vi.fn();
  const resize = vi.fn();
  window.addEventListener("resize", resize);
  const cd = monterGroupes({ sens: "ligne", a, b, surPartage });
  const h = cd.querySelector(".poignee-groupe");
  expect(taillesDe(cd, "a").width).toBeCloseTo(450, 6);
  h.dispatchEvent(ptr("pointerdown", 100, 50));
  h.dispatchEvent(ptr("pointermove", 150, 50));
  expect(taillesDe(cd, "a").width).toBeCloseTo(500, 6);
  expect(taillesDe(cd, "b").width).toBeCloseTo(400, 6);
  expect(surPartage).toHaveBeenLastCalledWith(500 / 900, false);
  expect(resize).toHaveBeenCalledTimes(1);
  expect(h.getAttribute("aria-valuenow")).toBe("500");
  expect(h.classList.contains("poignee-active")).toBe(true);
  h.dispatchEvent(ptr("pointerup", 150, 50));
  expect(surPartage).toHaveBeenLastCalledWith(500 / 900, true);
  expect(surPartage).toHaveBeenCalledTimes(2);
  window.removeEventListener("resize", resize);
  // Deux groupes l'un sur l'autre : la partie mesurée est la partie basse, Haut l'agrandit.
  const v = monterGroupes({ sens: "colonne", a, b }, 901, 601);
  const hv = v.querySelector(".poignee-groupe");
  expect(aria(hv)[0]).toBe("300");
  hv.dispatchEvent(ptr("pointerdown", 50, 300));
  hv.dispatchEvent(ptr("pointermove", 50, 250));
  expect(taillesDe(v, "b").height).toBeCloseTo(350, 6);
  expect(taillesDe(v, "a").height).toBeCloseTo(250, 6);
  // Rien ne change hors de la découpe : le groupe de gauche ne bouge pas quand on glisse la poignée horizontale (AC-080-4).
  const [c, d, e] = ["c", "d", "e"].map(feuilleG);
  const t = monterGroupes({ sens: "ligne", a: c, b: { sens: "colonne", a: d, b: e } });
  const [verticale, horizontale] = t.querySelectorAll(".poignee-groupe");
  const colonne = t.querySelector('.cadre-decoupe[data-sens="colonne"]');
  const gauche = colonne.parentElement.children[0];
  const [flexGauche, flexColonne] = [gauche.style.flex, colonne.style.flex];
  horizontale.dispatchEvent(ptr("pointerdown", 50, 300));
  horizontale.dispatchEvent(ptr("pointermove", 50, 250));
  horizontale.dispatchEvent(ptr("pointerup", 50, 250));
  expect([gauche.style.flex, colonne.style.flex]).toEqual([flexGauche, flexColonne]);
  expect(colonne.children[0].style.flex).not.toBe(colonne.children[2].style.flex);
  // La poignée verticale garde le rapport de hauteur des deux groupes de droite.
  const avant = [colonne.children[0].style.flex, colonne.children[2].style.flex];
  verticale.dispatchEvent(ptr("pointerdown", 450, 50));
  verticale.dispatchEvent(ptr("pointermove", 500, 50));
  verticale.dispatchEvent(ptr("pointerup", 500, 50));
  expect([colonne.children[0].style.flex, colonne.children[2].style.flex]).toEqual(avant);
  expect(gauche.style.flex).not.toBe(flexGauche);
});

test("REQ080_AC8_la_fenetre_ne_change_pas_part", () => {
  const [a, b] = ["a", "b"].map(feuilleG);
  const surPartage = vi.fn();
  const cd = monterGroupes({ sens: "ligne", a, b, part: 0.3, surPartage }, 1001, 600);
  const h = cd.querySelector(".poignee-groupe");
  const flex = flexes(cd);
  expect(flex).toEqual(["300 1 0", "700 1 0"]);
  expect(h.getAttribute("aria-valuenow")).toBe("300");
  base.width = 701;
  cd.mesurer();
  expect(h.getAttribute("aria-valuenow")).toBe("210");
  expect(flexes(cd)).toEqual(flex);
  base.width = 1001;
  cd.mesurer();
  expect(h.getAttribute("aria-valuenow")).toBe("300");
  expect(surPartage).not.toHaveBeenCalled();
});

test("REQ080_AC8_le_ResizeObserver_met_a_jour_les_poignees", () => {
  let rappel;
  vi.stubGlobal("ResizeObserver", class { constructor(f) { rappel = f; } observe(e) { this.e = e; } });
  const [a, b] = ["a", "b"].map(feuilleG);
  const cd = monterGroupes({ sens: "ligne", a, b }, 901, 600);
  const h = cd.querySelector(".poignee-groupe");
  base.width = 1801;
  rappel();
  expect(h.getAttribute("aria-valuenow")).toBe("900");
  vi.unstubAllGlobals();
});

test("REQ080_AC9_AC18_sans_place_rien_ne_bouge", () => {
  const [a, b] = ["a", "b"].map(feuilleG);
  const surPartage = vi.fn();
  const cd = monterGroupes({ sens: "ligne", a, b, surPartage }, 460, 600);
  const h = cd.querySelector(".poignee-groupe");
  expect(aria(h)).toEqual(["230", "230", "230"]);
  fleche(h, "ArrowRight");
  fleche(h, "ArrowLeft");
  h.dispatchEvent(ptr("pointerdown", 100, 50));
  h.dispatchEvent(ptr("pointermove", 200, 50));
  h.dispatchEvent(ptr("pointermove", 0, 50));
  h.dispatchEvent(ptr("pointerup", 0, 50));
  expect(surPartage).not.toHaveBeenCalled();
  expect(flexes(cd)).toEqual(["500 1 0", "500 1 0"]);
  expect(aria(h)).toEqual(["230", "230", "230"]);
  // Sans taille mesurable (S - 1 <= 0), la poignée n'a pas de valeur et ne bouge pas.
  const nul = monterGroupes({ sens: "ligne", a, b, surPartage }, 1, 1);
  const hn = nul.querySelector(".poignee-groupe");
  expect(aria(hn)).toEqual([null, null, null]);
  fleche(hn, "ArrowRight");
  expect(surPartage).not.toHaveBeenCalled();
});

test("REQ080_AC13_fleches_et_autres_touches", () => {
  const [a, b] = ["a", "b"].map(feuilleG);
  const surPartage = vi.fn();
  const cd = monterGroupes({ sens: "ligne", a, b, surPartage }, 1001, 600);
  const h = cd.querySelector(".poignee-groupe");
  h.focus();
  expect(aria(h)[0]).toBe("500");
  fleche(h, "ArrowRight");
  expect(taillesDe(cd, "a").width).toBeCloseTo(516, 6);
  expect(surPartage).toHaveBeenLastCalledWith(516 / 1000, true);
  fleche(h, "ArrowLeft");
  fleche(h, "ArrowLeft");
  expect(taillesDe(cd, "a").width).toBeCloseTo(484, 6);
  const n = surPartage.mock.calls.length;
  for (const k of ["ArrowUp", "ArrowDown", "Home", "End", "a"]) fleche(h, k);
  expect(surPartage.mock.calls.length).toBe(n);
  expect(document.activeElement).toBe(h);
  const v = monterGroupes({ sens: "colonne", a, b }, 600, 1001);
  const hv = v.querySelector(".poignee-groupe");
  fleche(hv, "ArrowUp");
  expect(taillesDe(v, "b").height).toBeCloseTo(516, 6);
  fleche(hv, "ArrowDown");
  fleche(hv, "ArrowDown");
  expect(taillesDe(v, "b").height).toBeCloseTo(484, 6);
  fleche(hv, "ArrowLeft");
  fleche(hv, "ArrowRight");
  expect(taillesDe(v, "b").height).toBeCloseTo(484, 6);
});

test("REQ080_AC14_pointerdown_sans_focus", () => {
  const [a, b] = ["a", "b"].map(feuilleG);
  const cd = monterGroupes({ sens: "ligne", a, b }, 901, 600);
  const champ = document.createElement("input");
  document.body.append(champ);
  champ.focus();
  const h = cd.querySelector(".poignee-groupe");
  const courant = [...cd.querySelectorAll(".cadre-groupe")].map((x) => x.dataset.courant);
  const e = ptr("pointerdown", 100, 50);
  h.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  h.dispatchEvent(ptr("pointermove", 160, 50));
  h.dispatchEvent(ptr("pointerup", 160, 50));
  expect(document.activeElement).toBe(champ);
  expect([...cd.querySelectorAll(".cadre-groupe")].map((x) => x.dataset.courant)).toEqual(courant);
});

test("REQ080_AC19_fleche_depuis_sous_le_minimum", () => {
  const [a, b] = ["a", "b"].map(feuilleG);
  const surPartage = vi.fn();
  const cd = monterGroupes({ sens: "ligne", a, b, part: 240 / 799, surPartage }, 800, 600);
  const h = cd.querySelector(".poignee-groupe");
  expect(aria(h)).toEqual(["240", "240", "479"]);
  fleche(h, "ArrowLeft");
  expect(surPartage).not.toHaveBeenCalled();
  expect(taillesDe(cd, "a").width).toBeCloseTo(240, 6);
  fleche(h, "ArrowRight");
  expect(taillesDe(cd, "a").width).toBeCloseTo(320, 6);
  expect(aria(h)).toEqual(["320", "320", "479"]);
});

test("REQ080_structure_refaite_pendant_un_glisse", () => {
  const [a, b, c] = ["a", "b", "c"].map(feuilleG);
  const surPartage = vi.fn();
  const cd = monterGroupes({ sens: "ligne", a, b, surPartage });
  const h = cd.querySelector(".poignee-groupe");
  h.dispatchEvent(ptr("pointerdown", 100, 50));
  h.dispatchEvent(ptr("pointermove", 150, 50));
  expect(document.documentElement.classList.contains("poignee-glisse-vertical")).toBe(true);
  surPartage.mockClear();
  cd.definirGroupes({ sens: "ligne", a, b: { sens: "colonne", a: b, b: c } }, "a");
  expect(document.documentElement.classList.contains("poignee-glisse-vertical")).toBe(false);
  expect(h.classList.contains("poignee-active")).toBe(false);
  expect(h.isConnected).toBe(false);
  expect(surPartage).not.toHaveBeenCalled();
});

test("REQ080_meme_structure_ne_recree_rien", () => {
  const [a, b] = ["a", "b"].map(feuilleG);
  const cd = monterGroupes({ sens: "ligne", a, b });
  const [decoupe, h, ga] = [cd.querySelector(".cadre-decoupe"), cd.querySelector(".poignee-groupe"), cd.querySelector(".cadre-groupe")];
  h.focus();
  cd.definirGroupes({ sens: "ligne", part: 0.25, a, b }, "b");
  expect(cd.querySelector(".cadre-decoupe")).toBe(decoupe);
  expect(cd.querySelector(".poignee-groupe")).toBe(h);
  expect(cd.querySelector(".cadre-groupe")).toBe(ga);
  expect(document.activeElement).toBe(h);
  expect(flexes(cd)).toEqual(["250 1 0", "750 1 0"]);
  expect(h.getAttribute("aria-valuenow")).toBe("225");
  // Un groupe qui redevient seul perd son flex.
  cd.definirGroupes(b, "b");
  expect(cd.querySelector(".cadre-groupe").style.flex).toBe("");
});

test("REQ080_AC15_AC16_css_de_la_poignee_groupe", () => {
  const base = regle(".cadre-decoupe > .poignee-groupe");
  expect(base).toContain("flex: 0 0 var(--epaisseur-poignee)");
  expect(base).toContain("position: relative");
  expect(base).toContain("z-index: 1");
  expect(base).toContain("overflow: visible");
  expect(base).toContain("background: transparent");
  expect(regle('.cadre-decoupe[data-sens="ligne"] > .poignee-groupe')).toContain("margin-inline: calc((var(--trait) - var(--epaisseur-poignee)) / 2)");
  expect(regle('.cadre-decoupe[data-sens="colonne"] > .poignee-groupe')).toContain("margin-block: calc((var(--trait) - var(--epaisseur-poignee)) / 2)");
  expect(regle(".poignee-groupe.poignee-vertical::after")).toContain("width: var(--trait)");
  expect(regle(".cadre-decoupe > .poignee-groupe:hover")).toMatch(/background: var\(--accent-fg\).*box-shadow: 0 0 0 var\(--trait\) var\(--bg-000\)/);
  expect(regle(".cadre-decoupe > .poignee-groupe:focus-visible")).toMatch(/outline: var\(--trait-fort\) solid var\(--accent-fg\).*outline-offset: calc\(-1 \* var\(--trait\)\).*box-shadow: 0 0 0 var\(--trait-fort\) var\(--bg-000\)/);
  expect(css).not.toContain(':nth-child(2) { border');
  expect(regle(".poignee-vertical")).toContain("col-resize");
  expect(regle(".poignee-horizontal")).toContain("row-resize");
});

const etat = (c) => c.querySelector("footer");
const montrerMaj = (maj, extra = {}) => cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") }, barreEtat: { branche: "main", position: "Ln 1, Col 1", langage: "Rust", version: "v0.9.1", maj, ...extra } });

test("REQ092_AC1_version_tout_a_droite_precedee_de_Yaide_pour_les_lecteurs_d_ecran", () => {
  const c = montrerMaj({ etat: "aucune" });
  const f = etat(c);
  const v = f.lastElementChild;
  expect(v.className).toContain("ya-status-version");
  expect(v.textContent).toBe("Yaide v0.9.1");
  expect(v.querySelector(".ya-sr").textContent).toBe("Yaide ");
  expect(v.hidden).toBe(false);
  const sans = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") }, barreEtat: { branche: "main" } });
  expect(etat(sans).querySelector(".ya-status-version").hidden).toBe(true);
  expect(f.querySelector("button, a, [tabindex]")).toBeNull();
  const r = regle(".ya-status-version");
  expect(r).toContain("flex: none");
});

test("REQ092_AC6_zones_status_et_alert_des_le_chargement_notification_sans_focus", () => {
  const c = montrerMaj({ etat: "aucune" });
  const f = etat(c);
  const st = f.querySelector('[role="status"]');
  const al = f.querySelector('[role="alert"]');
  expect(st.textContent).toBe("");
  expect(al.textContent).toBe("");
  expect(st.closest("[hidden]")).toBeNull();
  expect(al.closest("[hidden]")).toBeNull();
  expect(f.querySelector("button")).toBeNull();
  document.body.append(c);
  const avant = document.activeElement;
  c.definirEtat({ branche: "main", version: "v0.9.1", maj: { etat: "disponible", derniere: "v0.9.2" } });
  expect(st.textContent).toBe("v0.9.2 disponible");
  expect(f.querySelector("svg[data-icone='circle-arrow-up']")).not.toBeNull();
  const bouton1 = f.querySelector("button");
  expect(bouton1.textContent).toBe("Mettre à jour");
  expect(bouton1.className).toContain("ya-btn-barre");
  expect(bouton1.closest('[role="status"], [role="alert"]')).toBeNull();
  expect(document.activeElement).toBe(avant);
  c.definirEtat({ branche: "main", version: "v0.9.1", maj: { etat: "encours", derniere: "v0.9.2" } });
  expect(f.querySelector("button")).toBe(bouton1);
  expect(bouton1.textContent).toBe("Mise à jour…");
  expect(bouton1.getAttribute("aria-busy")).toBe("true");
  expect(st.textContent).toBe("v0.9.2 disponible");
  c.definirEtat({ branche: "main", version: "v0.9.1", maj: { etat: "echec", derniere: "v0.9.2", raison: "« sha256sum » est introuvable" } });
  expect(f.querySelector("button")).toBe(bouton1);
  expect(bouton1.textContent).toBe("Mettre à jour");
  expect(bouton1.hasAttribute("aria-busy")).toBe(false);
  expect(st.textContent).toBe("");
  expect(al.textContent).toBe("La mise à jour a échoué : « sha256sum » est introuvable.");
  expect(f.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(f.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(al.querySelector(".message-erreur").getAttribute("title")).toBe(al.textContent);
  c.definirEtat({ branche: "main", version: "v0.9.1", maj: { etat: "installee", derniere: "v0.9.2" } });
  expect(f.querySelector("button")).toBeNull();
  expect(al.textContent).toBe("");
  expect(st.textContent).toBe("v0.9.2 installée. Redémarrez Yaide pour l'utiliser.");
  c.definirEtat({ branche: "main", version: "v0.9.1", maj: { etat: "aucune" } });
  expect(st.textContent).toBe("");
  expect(f.querySelector("button")).toBeNull();
  c.remove();
});

test("REQ092_AC6_surMaj_appele_au_clic_et_branche_coupee_a_40_pour_cent_seul_le_message_d_echec_retrecit", () => {
  const surMaj = vi.fn();
  const c = montrerMaj({ etat: "disponible", derniere: "v0.9.2" }, { surMaj });
  etat(c).querySelector("button").click();
  expect(surMaj).toHaveBeenCalledTimes(1);
  expect(regle(".ya-status-branche")).toContain("max-width: 40%");
  expect(regle(".ya-status-branche")).toContain("text-overflow: ellipsis");
  for (const s of [".ya-status-position", ".ya-status-langage", ".ya-status-version", ".ya-status-maj > button"]) {
    expect(`${s}: ${css.includes(s) ? regle(s) : ""}`, s).toContain("flex: none");
  }
  expect(regle(".ya-status-maj")).toContain("min-width: 0");
  expect(regle(".ya-status-zone")).toContain("min-width: 0");
});

test("REQ094_AC1_zone_connexion_toujours_presente_entre_la_notification_et_la_version_connecte_par_defaut", () => {
  const f = etat(montrerMaj({ etat: "disponible", derniere: "v0.9.2" }));
  const zones = [...f.children];
  const i = zones.findIndex((e) => e.classList.contains("ya-connexion"));
  expect(i).toBeGreaterThan(-1);
  expect(zones[i - 1].className).toContain("ya-status-maj");
  expect(zones[i + 1].className).toContain("ya-status-version");
  expect(zones[i].hidden).toBe(false);
  expect(zones[i].dataset.connexion).toBe("connecte");
  expect(zones[i].textContent).toBe("Serveur : Connecté");
  expect(zones[i].querySelector(".ya-connexion-pastille")).not.toBeNull();
  const nue = cadre({ barreTitre: { projet: "p" }, rail: { onglets: p("r") } });
  expect(etat(nue).querySelector(".ya-connexion").textContent).toBe("Serveur : Connecté");
  expect(regle(".ya-connexion-pastille")).toContain("background: var(--git-added)");
  expect(regle(".ya-connexion-pastille")).toContain("border-radius: 50%");
  expect(regle(".ya-connexion-pastille")).toContain("width: 8px");
  expect(regle(".ya-status > .ya-connexion")).toContain("gap: 6px");
});

test("REQ094_AC2_deconnecte_puis_retour_a_connecte_sans_recreer_la_barre", () => {
  const c = montrerMaj({ etat: "aucune" });
  const f = etat(c);
  const z = f.querySelector(".ya-connexion");
  const pastille = z.querySelector(".ya-connexion-pastille");
  c.definirEtat({ branche: "main", version: "v0.9.1", connexion: "deconnecte" });
  expect(f).toBe(etat(c));
  expect(f.querySelector(".ya-connexion")).toBe(z);
  expect(z.dataset.connexion).toBe("deconnecte");
  expect(z.textContent).toBe("Serveur : Déconnecté");
  expect(regle('.ya-connexion[data-connexion="deconnecte"] .ya-connexion-pastille')).toContain("background: var(--danger)");
  c.definirEtat({ branche: "main", version: "v0.9.1", connexion: "connecte" });
  expect(z.dataset.connexion).toBe("connecte");
  expect(z.textContent).toBe("Serveur : Connecté");
  expect(z.querySelector(".ya-connexion-pastille")).toBe(pastille);
});

test("REQ094_AC3_serveur_pour_lecteurs_d_ecran_pastille_masquee_sans_role_ni_focus", () => {
  const c = montrerMaj({ etat: "aucune" });
  document.body.append(c);
  const z = etat(c).querySelector(".ya-connexion");
  expect(z.querySelector(".ya-sr").textContent).toBe("Serveur : ");
  expect(z.querySelector(".ya-connexion-pastille").getAttribute("aria-hidden")).toBe("true");
  for (const e of [z, ...z.querySelectorAll("*")]) {
    expect(e.hasAttribute("role")).toBe(false);
    expect(e.hasAttribute("aria-live")).toBe(false);
    expect(e.hasAttribute("tabindex")).toBe(false);
  }
  const avant = document.activeElement;
  c.definirEtat({ branche: "main", connexion: "deconnecte" });
  expect(document.activeElement).toBe(avant);
  expect(regle(".ya-status > .ya-connexion")).toContain("flex: none");
  expect(css).not.toMatch(/\.ya-connexion[^{]*\{[^}]*transition/);
  c.remove();
});

test("REQ096_AC12_pied_du_rail_droit_en_bas_et_commandes_ajoutees_au_dessus", () => {
  const pied = bouton({ icone: "server", nomAccessible: "Serveurs MCP", positionInfoBulle: "gauche" }).enveloppe;
  const c = monterFonctions({}, { railDroit: { commandes: [p("rd")], pied: [pied] } });
  const rd = c.querySelector(".cadre-rail-droit");
  expect(rd.lastElementChild.className).toBe("cadre-rail-pied");
  expect(rd.lastElementChild.firstChild).toBe(pied);
  expect(regle(".cadre-rail-droit .cadre-rail-pied")).toContain("margin-top: auto");
  const claude = p("Claude");
  c.ajouterCommandeDroite(claude);
  expect([...rd.children].map((e) => e.textContent || e.className)).toEqual(["rd", "Claude", "cadre-rail-pied"]);
  expect(claude.nextElementSibling).toBe(rd.lastElementChild);
});

test("REQ096_AC12_pied_vide_par_defaut_et_rail_absent_sans_commande_ni_pied", () => {
  const sans = monterFonctions({ agents: false }, { railDroit: { commandes: [] } });
  expect(sans.querySelector(".cadre-rail-droit")).toBeNull();
  const vide = monterFonctions({}, { railDroit: { commandes: [p("rd")] } });
  expect(vide.querySelector(".cadre-rail-pied")).toBeNull();
  const seul = monterFonctions({ agents: false }, { railDroit: { commandes: [], pied: [p("pied")] } });
  expect(seul.querySelector(".cadre-rail-droit .cadre-rail-pied").textContent).toBe("pied");
  expect(seul.classList.contains("cadre-sans-rail-droit")).toBe(false);
});
