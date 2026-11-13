import { afterEach, expect, test, vi } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import * as oc from "../opencode.js";
import * as worktree from "../worktree.js";
import { ecrire, lire } from "../stockage.js";
import { monter, attendre, avecHorloge, poignees, simulerShells, onglets, barreTitre, aside, paletteCommandes, nomsCommandes, agentCol, boutonAgentDe, boutonAgentsDe, champAgent, clavier, largeur, jsonOk, fauxServeur, corpsAgents, titreColonne, simulerOpencode, boutonClaudeDe, ongletsOc, nomDuChamp, nomsRailDroit, boutonOcDe, ongletsClaude, ligne } from "./principale.aides.js";

vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

test("REQ028_AC6_titre_du_navigateur", () => {
  monter();
  expect(document.title).toBe("projet — yaide");
});

test("REQ037_AC2_barre_de_titre_symbole_ouverture_rapide_theme_et_deconnexion", () => {
  const { vue } = monter();
  const barre = vue.querySelector("header");
  expect(barre.querySelector("svg[aria-hidden=true]")).not.toBeNull();
  const noms = [...barre.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  expect(noms).toEqual(["Ouverture rapide", "Replier le panneau", "Replier les shells", "Thème clair", "Déconnexion"]);
  expect(barre.querySelector("button").textContent).toBe("projet");
  expect(barre.textContent).toBe("projet");
  expect(barre.querySelector("[aria-label=Déconnexion]").textContent).toBe("");
  expect(barre.querySelector("nav, [role=menubar]")).toBeNull();
});

test("REQ037_AC3_le_bouton_central_ouvre_l_ouverture_rapide", () => {
  const ouvert = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    ouvert(this);
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const { vue } = monter();
  vue.querySelector("header [aria-label='Ouverture rapide']").click();
  expect(ouvert).toHaveBeenCalledTimes(1);
});

test("REQ038_AC2_AC4_le_bouton_Theme_clair_bascule_le_theme_et_aria_pressed", () => {
  document.documentElement.setAttribute("data-theme", "dark");
  const { vue } = monter();
  const b = vue.querySelector("header [aria-label='Thème clair']");
  expect(b.getAttribute("aria-pressed")).toBe("false");
  b.click();
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(b.getAttribute("aria-pressed")).toBe("true");
  b.click();
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(b.getAttribute("aria-pressed")).toBe("false");
});

test("REQ028_AC4_rail_accessible", () => {
  const { vue } = monter();
  const rail = vue.querySelector("[role=tablist]");
  expect(rail.getAttribute("aria-orientation")).toBe("vertical");
  const tabs = [...rail.querySelectorAll("[role=tab]")];
  expect(tabs.map((t) => t.textContent)).toEqual(["", "", ""]);
  expect(tabs.every((t) => t.querySelector("svg"))).toBe(true);
  expect(tabs.map((t) => t.getAttribute("aria-keyshortcuts"))).toEqual(["F", "R", "G"]);
  expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Fichiers", "Recherche", "Git"]);
  expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
});

test("REQ028_AC5_touche_sur_le_rail_change_de_panneau_et_prend_le_focus", () => {
  const { vue } = monter();
  const tab = vue.querySelector("[role=tab]");
  tab.focus();
  tab.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
  expect(vue.querySelector("aside h2").textContent).toBe("Git");
  expect(vue.querySelector("aside").contains(document.activeElement)).toBe(true);
  expect(vue.querySelector("[role=tab][aria-selected=true]").getAttribute("aria-label")).toBe("Git");
});

test("REQ028_AC5_une_lettre_hors_du_rail_ne_fait_rien", () => {
  const { vue } = monter();
  vue.querySelector("header [aria-label=Déconnexion]").dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
  expect(vue.querySelector("aside h2").textContent).toBe("Fichiers");
});

test("REQ005_AC3_deconnexion_appelle_le_serveur_puis_surDeconnexion", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 204 })));
  const { vue, surDeconnexion } = monter();
  vue.querySelector("header [aria-label=Déconnexion]").click();
  await new Promise((r) => setTimeout(r, 0));
  expect(fetch).toHaveBeenCalledWith("/api/deconnexion", expect.objectContaining({ method: "POST" }));
  expect(surDeconnexion).toHaveBeenCalled();
});

test("REQ028_AC8_Deconnexion_precede_le_rail_dans_l_ordre_du_document", () => {
  const { vue } = monter();
  const sortir = vue.querySelector("header [aria-label=Déconnexion]");
  const rail = vue.querySelector("[role=tab]");
  expect(sortir.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("REQ005_AC3_deconnexion_avec_session_deja_expiree_ramene_a_la_connexion", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401 })));
  const { vue, surDeconnexion } = monter();
  vue.querySelector("header [aria-label=Déconnexion]").click();
  await new Promise((r) => setTimeout(r, 0));
  expect(surDeconnexion).toHaveBeenCalled();
});

test("REQ028_AC1_clic_sur_le_rail_change_de_panneau_et_le_focus_y_entre", () => {
  const { vue } = monter();
  vue.querySelectorAll("[role=tab]")[2].click();
  expect(vue.querySelector("aside h2").textContent).toBe("Git");
  expect(document.activeElement).toBe(vue.querySelector(".cadre-panneau-corps"));
});

test("REQ022_AC3_et_REQ037_AC4_la_barre_d_etat_affiche_la_branche_et_pas_la_barre_de_titre", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/session") return { status: 204 };
    if (url === "/api/git/etat") return { ok: true, status: 200, json: async () => ({ branche: "main", detachee: false, branches: ["main"], changements: [] }) };
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  const { vue } = monter();
  await new Promise((r) => setTimeout(r, 0));
  const etat = vue.querySelector("footer");
  expect(etat.textContent).toBe("mainServeur : Connecté");
  expect(etat.querySelector("svg[data-icone=branch]")).not.toBeNull();
  expect(vue.querySelector("header").textContent).not.toContain("main");
});

test("REQ037_AC4_HEAD_detachee_affiche_detachee_seul", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/session") return { status: 204 };
    if (url === "/api/git/etat") return { ok: true, status: 200, json: async () => ({ branche: "a1b2c3d", detachee: true, branches: [], changements: [] }) };
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  const { vue } = monter();
  await new Promise((r) => setTimeout(r, 0));
  expect(vue.querySelector("footer").textContent).toBe("détachéeServeur : Connecté");
});

test("REQ022_AC4_et_REQ037_AC4_hors_depot_rien_dans_la_barre_d_etat", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/session") return { status: 204 };
    if (url === "/api/git/etat") return { ok: false, status: 409, json: async () => ({ cause: "pas-depot", message: "Ce dossier n'est pas un dépôt git." }) };
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  const { vue } = monter();
  await new Promise((r) => setTimeout(r, 0));
  expect(vue.querySelector("footer").textContent).toBe("Serveur : Connecté");
});

test("REQ037_AC10_la_barre_d_etat_et_le_fil_n_ont_ni_bouton_ni_lien_ni_arret_de_tabulation", () => {
  const { vue } = monter();
  for (const z of [vue.querySelector("footer"), vue.querySelector(".cadre-fil")]) {
    expect(z.querySelector("button, a, [tabindex], input")).toBeNull();
  }
});

test("REQ032_AC7_les_poignees_ont_valuenow_valuemin_valuemax_des_le_montage", async () => {
  simulerShells({ ids: [1] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(1));
  const { panneau, shells } = poignees(vue);
  for (const p of [panneau, shells]) for (const a of ["aria-valuenow", "aria-valuemin", "aria-valuemax"]) expect(p.hasAttribute(a)).toBe(true);
  expect(panneau.getAttribute("aria-valuemin")).toBe("240");
  expect(shells.getAttribute("aria-valuemin")).toBe("120");
});

test("REQ032_AC5_la_taille_gardee_est_relue_a_l_ouverture_et_bornee", async () => {
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "tailles" ? { panneau: 300, shells: 9999 } : undefined));
  const { vue } = monter();
  await attendre();
  const { panneau, shells } = poignees(vue);
  expect(panneau.getAttribute("aria-valuenow")).toBe("300");
  expect(shells.getAttribute("aria-valuenow")).toBe(shells.getAttribute("aria-valuemax"));
  expect(ecrire).not.toHaveBeenCalled();
});

test("REQ032_AC12_une_fleche_ecrit_la_taille_choisie_mais_pas_la_fenetre", async () => {
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "tailles" ? { panneau: 300 } : undefined));
  const { vue } = monter();
  await attendre();
  window.dispatchEvent(new Event("resize"));
  expect(ecrire).not.toHaveBeenCalled();
  const { panneau } = poignees(vue);
  panneau.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  expect(ecrire).toHaveBeenCalledWith("tailles", { panneau: 316 });
  expect(panneau.getAttribute("aria-valuenow")).toBe("316");
});

test("REQ032_AC12_AC6_la_fenetre_qui_retrecit_borne_l_affichage_sans_effacer_la_taille_choisie", async () => {
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "tailles" ? { shells: 400 } : undefined));
  const { vue } = monter();
  await attendre();
  const hauteur = window.innerHeight;
  window.innerHeight = 480;
  window.dispatchEvent(new Event("resize"));
  const { shells } = poignees(vue);
  expect(shells.getAttribute("aria-valuenow")).toBe("299");
  window.innerHeight = hauteur;
  window.dispatchEvent(new Event("resize"));
  expect(shells.getAttribute("aria-valuenow")).toBe("400");
  expect(ecrire).not.toHaveBeenCalled();
});

test("REQ032_AC14_une_taille_de_480_px_d_une_version_precedente_est_ramenee_a_360_sans_etre_reecrite", async () => {
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "tailles" ? { panneau: 480 } : undefined));
  const { vue } = monter();
  await attendre();
  expect(poignees(vue).panneau.getAttribute("aria-valuenow")).toBe("360");
  expect(ecrire).not.toHaveBeenCalled();
});

test("REQ032_AC9_limites_a_800_par_480_dans_la_vue", async () => {
  const [L, H] = [window.innerWidth, window.innerHeight];
  window.innerWidth = 800;
  window.innerHeight = 480;
  const { vue } = monter();
  await attendre();
  const { panneau, shells } = poignees(vue);
  expect([panneau, shells].map((p) => [p.getAttribute("aria-valuemin"), p.getAttribute("aria-valuemax")])).toEqual([["240", "360"], ["120", "299"]]);
  window.innerWidth = L;
  window.innerHeight = H;
});

test("REQ028_AC12_F_R_G_marchent_aussi_depuis_les_boutons_du_rail", () => {
  const { vue } = monter();
  const titres = { f: "Fichiers", r: "Recherche", g: "Git" };
  for (const b of vue.querySelectorAll(".cadre-rail-commandes button")) {
    for (const touche of ["g", "r", "f"]) {
      vue.querySelector("[role=tab]").focus();
      b.dispatchEvent(new KeyboardEvent("keydown", { key: touche, bubbles: true }));
      expect(vue.querySelector("aside h2").textContent, `${touche} depuis ${b.getAttribute("aria-label")}`).toBe(titres[touche]);
      expect(vue.querySelector(".cadre-panneau").contains(document.activeElement), `focus après ${touche}`).toBe(true);
    }
  }
});

test("REQ054_AC4_echap_rend_le_focus_d_avant_ctrl_p", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/chemins") return { ok: true, status: 200, json: async () => ({ chemins: [] }) };
    if (url === "/api/git/etat") return { ok: true, status: 200, json: async () => ({ branche: "main", detachee: false, branches: ["main"], changements: [] }) };
    if (url.startsWith("/api/fichiers?")) return { ok: true, status: 200, json: async () => ({ entrees: [] }) };
    if (url === "/api/session") return { status: 204 };
    if (url === "/api/agent/reglages") return { ok: true, status: 200, json: async () => ({ providers: [{ id: "openai", nom: "OpenAI", adresse: "https://a.test", cle: false, cleObligatoire: true }], profils: [] }) };
    return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
  }));
  const { vue } = monter();
  const avant = vue.querySelector("header [aria-label=Déconnexion]");
  avant.focus();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true }));
  const entree = document.querySelector("dialog input");
  entree.value = ">prov";
  entree.dispatchEvent(new Event("input", { bubbles: true }));
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  const dlg = document.querySelector("dialog");
  expect(dlg.getAttribute("aria-labelledby")).toBeTruthy();
  expect(dlg.textContent).toContain("Providers LLM");
  dlg.dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(avant);
});

test("REQ070_AC5_AC19_REQ071_AC8_ouvert_avec_agents_et_shells_desactives", async () => {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    appels.push(`${opts.method ?? "GET"} ${u}`);
    if (u === "/api/chemins") return jsonOk({ chemins: [] });
    if (u === "/api/git/etat") return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [] });
    if (u.startsWith("/api/fichiers?")) return jsonOk({ entrees: [] });
    if (u === "/api/session") return { status: 204 };
    if (u.startsWith("/api/fichier?chemin=")) return { ok: true, status: 200, text: async () => '{"fonctions":{"agents":false,"shells":false}}', headers: { get: () => "v1" } };
    return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
  }));
  const { vue } = monter({ reglages: { fonctions: { agents: false, shells: false } } });
  const avant = vue.querySelector("header [aria-label=Déconnexion]");
  avant.focus();
  const entree = paletteCommandes(">");
  expect(nomsCommandes()).toEqual(["Préférences d'interface"]);
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const dlg = document.querySelector("dialog");
  expect(dlg.querySelector("h2").textContent).toBe("Préférences d'interface");
  expect([...dlg.querySelectorAll("input[type=checkbox]")].filter((c) => !c.checked).map((c) => c.labels[0].textContent)).toEqual(["Shells", "Agents"]);
  expect(appels.filter((a) => a.includes("/api/agent"))).toEqual([]);
  dlg.dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(avant);
  expect(appels.filter((a) => a.startsWith("PUT"))).toEqual([]);
});

test("REQ054_AC1_AC7_trois_commandes_avec_les_agents_et_focus_rendu", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u === "/api/chemins") return jsonOk({ chemins: [] });
    if (u === "/api/git/etat") return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [] });
    if (u.startsWith("/api/fichiers?")) return jsonOk({ entrees: [] });
    if (u === "/api/session") return { status: 204 };
    if (u === "/api/agent/reglages") return jsonOk({ providers: [], profils: [] });
    return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "absent" }) };
  }));
  const { vue } = monter();
  const avant = vue.querySelector("header [aria-label=Déconnexion]");
  avant.focus();
  const entree = paletteCommandes(">");
  expect(nomsCommandes()).toEqual(["Providers LLM", "Profils de modèle", "Préférences d'interface"]);
  entree.value = ">préf";
  entree.dispatchEvent(new Event("input", { bubbles: true }));
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(avant);
});

test("REQ028_AC17_REQ059_AC1_AC10_rail_droit_avec_le_bouton_Agent", async () => {
  const { vue } = monter();
  const rd = vue.querySelector(".cadre-rail-droit");
  const b = boutonAgentDe(vue);
  expect([...rd.querySelectorAll("button")]).toEqual([b, boutonAgentsDe(vue), boutonMcpDe(vue)]);
  expect(b.getAttribute("aria-keyshortcuts")).toBe("A");
  expect(b.querySelector("svg[data-icone=bot]")).not.toBeNull();
  expect(b.textContent).toBe("");
  expect(b.hasAttribute("aria-pressed") || b.hasAttribute("aria-expanded")).toBe(false);
  expect(b.hasAttribute("data-actif")).toBe(false);
  expect(vue.querySelector("[role=tablist] [aria-label=Agent]")).toBeNull();
  b.parentElement.dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(document.querySelector("[role=tooltip]").textContent).toBe("Nouvelle session Agent (A)"));
  expect(vue.querySelector("main").nextElementSibling.nextElementSibling).toBe(agentCol(vue));
});

test("REQ059_AC8_agent_replie_au_premier_lancement", () => {
  const { vue } = monter();
  expect(agentCol(vue).hidden).toBe(true);
  expect(vue.querySelector(".poignee-agent").hidden).toBe(true);
});

test("REQ028_AC5_REQ059_AC2_A_depuis_les_onglets_ouvre_un_onglet_sans_deplier", async () => {
  fauxServeur();
  const { vue } = monter();
  const tab = vue.querySelector("[role=tab]");
  tab.focus();
  clavier(tab, "a");
  await vi.waitFor(() => expect(document.activeElement).toBe(champAgent(vue)));
  expect(agentCol(vue).hidden).toBe(true);
  expect(boutonAgentDe(vue).hasAttribute("data-actif")).toBe(false);
  expect(vue.querySelector("aside h2").textContent).toBe("Fichiers");
});

test("REQ028_AC12_REQ059_AC2_A_depuis_les_boutons_des_shells_et_depuis_Agent", async () => {
  fauxServeur();
  const { vue } = monter();
  let n = 0;
  const sources = [...vue.querySelectorAll(".cadre-rail-commandes button"), boutonAgentDe(vue)];
  for (const b of sources) {
    b.focus();
    clavier(b, "a");
    n++;
    await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps"), b.getAttribute("aria-label")).toHaveLength(n));
    expect(document.activeElement.matches(".agent-corps textarea")).toBe(true);
    expect(agentCol(vue).hidden).toBe(true);
  }
});

test("REQ078_AC1_clic_et_A_ouvrent_chacun_un_onglet", async () => {
  fauxServeur();
  const { vue } = monter();
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(1));
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(2));
  boutonAgentDe(vue).focus();
  clavier(boutonAgentDe(vue), "a");
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(3));
  const noms = [...vue.querySelectorAll("[role=tab]")].map((t) => t.textContent).filter((t) => t.startsWith("Agent"));
  expect(noms).toEqual(["Agent 1", "Agent 2", "Agent 3"]);
  expect(boutonAgentDe(vue).hasAttribute("data-actif")).toBe(false);
});

test("REQ078_AC1_colonne_inchangee", async () => {
  fauxServeur();
  const { vue } = monter();
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(1));
  expect(agentCol(vue).hidden).toBe(true);
  expect(vue.querySelector(".poignee-agent").hidden).toBe(true);
  expect(ecrire).not.toHaveBeenCalledWith("replis", expect.anything());
  boutonAgentsDe(vue).click();
  const taille = vue.style.getPropertyValue("--taille-agent");
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(2));
  expect(agentCol(vue).hidden).toBe(false);
  expect(vue.style.getPropertyValue("--taille-agent")).toBe(taille);
  expect(titreColonne(vue)).toBe("Agents");
});

test("REQ078_AC3_premier_onglet_garde_son_champ", async () => {
  fauxServeur();
  const { vue } = monter();
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(1));
  champAgent(vue).value = "brouillon";
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(2));
  const un = [...vue.querySelectorAll("[role=tab]")].find((t) => t.textContent === "Agent 1");
  un.click();
  const visible = [...vue.querySelectorAll(".agent-corps")].find((c) => !c.closest("[hidden]") && !c.hidden);
  expect(visible.querySelector("textarea").value).toBe("brouillon");
});

test("REQ078_AC10_ancienne_derniere_conversation_ignoree", async () => {
  const appels = fauxServeur();
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "agent" ? { conversation: "c1" } : undefined));
  const { vue } = monter();
  await attendre();
  expect(vue.querySelectorAll(".agent-corps")).toHaveLength(0);
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(1));
  await attendre();
  expect(lire).not.toHaveBeenCalledWith("agent");
  expect(appels.some((a) => a.includes("/api/agent/conversations/c1"))).toBe(false);
  expect(vue.querySelector(".agent-titre").textContent).toBe("Nouvelle conversation");
});

test("REQ078_AC16_coupure_bandeau_sans_onglet", async () => {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    appels.push(String(url));
    throw new Error("coupé");
  }));
  const { vue } = monter();
  await attendre();
  const bandeau = () => [...vue.querySelectorAll(".cadre-bandeaux [role=alert]")].find((a) => a.textContent.includes("Réessayez au retour."));
  expect(bandeau()).toBeUndefined();
  const avant = document.activeElement;
  const nb = () => appels.filter((u) => u === "/api/agent/reglages").length;
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(nb()).toBe(1));
  await vi.waitFor(() => expect(bandeau()).toBeDefined());
  expect(vue.querySelectorAll(".agent-corps")).toHaveLength(0);
  expect(document.activeElement).toBe(avant);
});

test("REQ059_AC3_Replier_l_agent_donne_le_focus_a_Agents", () => {
  fauxServeur();
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  const repli = vue.querySelector("[aria-label=\"Replier l'agent\"]");
  expect(agentCol(vue).querySelector("button")).toBe(repli);
  repli.click();
  expect(agentCol(vue).hidden).toBe(true);
  expect(vue.querySelector(".poignee-agent").hidden).toBe(true);
  expect(boutonAgentsDe(vue).hasAttribute("data-actif")).toBe(false);
  expect(document.activeElement).toBe(boutonAgentsDe(vue));
  expect(boutonAgentsDe(vue).classList.contains("ya-focus-garde")).toBe(true);
});

test("REQ059_AC4_un_tour_continue_colonne_repliee", async () => {
  vi.useFakeTimers();
  let lectures = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u === "/api/agent/reglages") return { ok: true, status: 200, json: async () => ({ providers: [], profils: [{ id: "p", nom: "m", provider: "openai", modele: "x", defaut: true }] }) };
    if (u === "/api/agent/messages" && opts.method === "POST") return { ok: true, status: 202, json: async () => ({ conversation: "c1" }) };
    if (u.startsWith("/api/agent/conversations/c1")) {
      lectures++;
      const fini = lectures > 2;
      return { ok: true, status: 200, json: async () => ({ entrees: fini ? [{ type: "utilisateur", texte: "Bonjour" }, { type: "agent", markdown: "Étape arrivée colonne repliée." }] : [{ type: "utilisateur", texte: "Bonjour" }], enCours: !fini, total: fini ? 2 : 1, tokens: 0 }) };
    }
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  try {
    const { vue } = monter();
    boutonAgentDe(vue).click();
    await vi.advanceTimersByTimeAsync(100);
    champAgent(vue).value = "Bonjour";
    champAgent(vue).dispatchEvent(new Event("input", { bubbles: true }));
    champAgent(vue).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(agentCol(vue).hidden).toBe(true);
    const avant = lectures;
    await vi.advanceTimersByTimeAsync(10000);
    expect(lectures).toBeGreaterThan(avant);
    expect(vue.querySelector(".agent-corps [role=log]").textContent).toContain("Étape arrivée colonne repliée.");
  } finally {
    vi.useRealTimers();
  }
});

test("REQ059_AC5_AC7_sans_taille_gardee_l_agent_est_borne_pour_laisser_320_px_a_l_editeur", () => {
  fauxServeur();
  largeur(1000);
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  const p = Number.parseInt(vue.style.getPropertyValue("--taille-panneau"), 10);
  const a = Number.parseInt(vue.style.getPropertyValue("--taille-agent"), 10);
  expect(a).toBeLessThan(360);
  expect(a).toBeGreaterThanOrEqual(240);
  // 1000 - 2 rails de 48 (token) - poignées : l'éditeur garde au moins 320 px.
  expect(1000 - 2 * Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--size-activity"), 10) - p - a).toBeGreaterThanOrEqual(320);
});

test("REQ028_AC8_ordre_de_Tab_de_la_page_avec_l_agent_a_droite", async () => {
  fauxServeur();
  const { vue } = monter();
  const tabbables = () => [...vue.querySelectorAll("button, textarea, input, [tabindex='0'], [role=separator]")].filter((e) => !e.closest("[hidden]") && e.tabIndex >= 0);
  const pos = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const poignee = vue.querySelector(".poignee-agent");
  const bouton = boutonAgentDe(vue);
  const terminaux = vue.querySelector(".cadre-shells");
  // Replié : aucun arrêt dans la colonne, le bouton « Agents » est le dernier.
  expect(tabbables().some((e) => agentCol(vue).contains(e) || e === poignee)).toBe(false);
  expect(tabbables().slice(-3)).toEqual([bouton, boutonAgentsDe(vue), boutonMcpDe(vue)]);
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(corpsAgents(vue).querySelector("input, button")).not.toBeNull());
  const liste = tabbables();
  const iPoignee = liste.indexOf(poignee);
  expect(iPoignee).toBeGreaterThan(-1);
  expect(pos(terminaux, poignee)).toBe(true);
  expect(liste.indexOf(bouton)).toBeGreaterThan(iPoignee);
  expect(liste.indexOf(vue.querySelector("[aria-label=\"Replier l'agent\"]"))).toBe(iPoignee + 1);
});

test("REQ059_AC6_sous_904_deplier_l_agent_replie_le_panneau_et_inversement", () => {
  fauxServeur();
  largeur(800);
  const { vue } = monter();
  expect(aside(vue).hidden).toBe(false);
  boutonAgentsDe(vue).click();
  expect(agentCol(vue).hidden).toBe(false);
  expect(aside(vue).hidden).toBe(true);
  barreTitre(vue, "Déplier le panneau").click();
  expect(aside(vue).hidden).toBe(false);
  expect(agentCol(vue).hidden).toBe(true);
});

test("REQ059_AC6_AC18_A_sous_904_ouvre_un_onglet_sans_toucher_aux_colonnes", async () => {
  fauxServeur();
  largeur(800);
  const { vue } = monter();
  const tab = vue.querySelector("[role=tab]");
  tab.focus();
  clavier(tab, "a");
  await vi.waitFor(() => expect(document.activeElement).toBe(champAgent(vue)));
  expect(aside(vue).hidden).toBe(false);
  expect(agentCol(vue).hidden).toBe(true);
  expect(tab.getAttribute("aria-selected")).toBe("true");
});

test("REQ059_AC7_fenetre_qui_retrecit_avec_les_deux_deplies_replie_le_panneau", () => {
  fauxServeur();
  largeur(1280);
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  expect(aside(vue).hidden).toBe(false);
  expect(agentCol(vue).hidden).toBe(false);
  largeur(800);
  window.dispatchEvent(new Event("resize"));
  expect(aside(vue).hidden).toBe(true);
  expect(agentCol(vue).hidden).toBe(false);
  expect(ecrire).toHaveBeenLastCalledWith("replis", { panneau: true, agent: false });
  // Agrandir la fenêtre ne déplie rien.
  largeur(1280);
  window.dispatchEvent(new Event("resize"));
  expect(aside(vue).hidden).toBe(true);
});

test("REQ059_AC8_replis_et_tailles_relus_apres_rechargement", async () => {
  largeur(1280);
  vi.mocked(lire).mockImplementation(async (cle) => ({ replis: { panneau: false, agent: false }, tailles: { agent: 500 } })[cle]);
  const { vue } = monter();
  await new Promise((r) => setTimeout(r, 10));
  expect(agentCol(vue).hidden).toBe(false);
  expect(vue.querySelector(".poignee-agent").getAttribute("aria-valuenow")).toBe("500");
  // Un redimensionnement garde la taille et le repli de l'agent avec les autres.
  vue.querySelector("[aria-label=\"Replier l'agent\"]").click();
  expect(ecrire).toHaveBeenLastCalledWith("replis", { panneau: false, agent: true });
});

test("REQ059_AC9_replier_et_deplier_l_agent_mesure_a_nouveau", () => {
  fauxServeur();
  const { vue } = monter();
  const mesurer = vi.spyOn(vue, "mesurer");
  boutonAgentsDe(vue).click();
  expect(mesurer).toHaveBeenCalledTimes(1);
  vue.querySelector("[aria-label=\"Replier l'agent\"]").click();
  expect(mesurer).toHaveBeenCalledTimes(2);
});

test("REQ078_AC9_agents_desactives_onglet_garde_non_affiche", async () => {
  fauxServeur();
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "onglets" ? { liste: [{ conversationAgent: true, numero: 1, conversation: "c1" }], actif: "\0agent:1" } : undefined));
  const { vue } = monter({ reglages: { fonctions: { agents: false } } });
  await attendre();
  await attendre();
  expect(vue.querySelectorAll(".agent-corps")).toHaveLength(0);
  expect([...vue.querySelectorAll("[role=tab]")].some((t) => t.textContent.startsWith("Agent"))).toBe(false);
  for (const [cle, valeur] of vi.mocked(ecrire).mock.calls) {
    if (cle === "onglets") expect(valeur.liste).toContainEqual({ conversationAgent: true, numero: 1, conversation: "c1" });
  }
});

// ---- REQ-086 : worktree choisi, barre d'état, rail et bandeau ----

afterEach(() => {
  worktree.choisir("");
  worktree.occuper();
  worktree.mettreAJour([]);
});

test("REQ086_AC2_AC3_AC7_barre_d_etat_et_rail_suivent_le_worktree_choisi_puis_bandeau_a_la_disparition", () =>
  avecHorloge(async () => {
  const W = [
    { chemin: "", nom: "projet", branche: "main", detachee: false },
    { chemin: "../essai", nom: "essai", branche: "essai", detachee: false },
  ];
  let disparu = false;
  const urls = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    urls.push(u);
    if (u === "/api/session") return { status: 204 };
    if (u.startsWith("/api/git/etat")) {
      if (u.includes("worktree=")) {
        if (disparu) return { ok: false, status: 400, json: async () => ({ cause: "worktree", message: "Ce worktree n'existe plus." }) };
        return jsonOk({ branche: "essai", detachee: false, branches: ["main", "essai"], changements: [{ chemin: "../essai/a.rs", statut: "modifié", indexe: false, lettre: "M" }, { chemin: "../essai/b.rs", statut: "modifié", indexe: false, lettre: "M" }], worktrees: W });
      }
      return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [], worktrees: disparu ? [W[0]] : W });
    }
    return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
  }));
  const { vue } = monter();
  const attendre = () => vi.advanceTimersByTimeAsync(10);
  await attendre();
  const select = () => [...vue.querySelectorAll("aside select")].find((s) => s.labels[0]?.textContent === "Worktree");
  expect(vue.querySelector("footer").textContent).toBe("mainServeur : Connecté");
  select().value = "../essai";
  select().dispatchEvent(new Event("change", { bubbles: true }));
  await attendre();
  await attendre();
  expect(vue.querySelector("footer").textContent).toBe("essaiServeur : Connecté");
  expect(vue.querySelector("[role=tab][aria-label=Git] .ya-badge").textContent).toBe("2");
  disparu = true;
  // relecture des 3 s : l'état demandé est refusé, le choix revient au projet.
  await vi.advanceTimersByTimeAsync(3000);
  await attendre();
  const bandeau = [...vue.querySelectorAll("[role=status]")].find((m) => m.textContent.includes("a disparu"));
  expect(bandeau.textContent).toContain("Le worktree essai a disparu : retour au projet.");
  expect(bandeau.querySelector("button")).not.toBeNull();
  expect(vue.querySelector("footer").textContent).toBe("mainServeur : Connecté");
  expect(select()).toBeFalsy();
  }));

test("REQ086_AC8_git_desactive_aucune_requete_git_ni_ligne_worktree", async () => {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    appels.push(String(url));
    return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
  }));
  const { vue } = monter({ reglages: { fonctions: { git: false } } });
  await attendre();
  expect(appels.some((u) => u.startsWith("/api/git/"))).toBe(false);
  expect(vue.querySelector("aside select")).toBeNull();
});

// ---- REQ-088 : « Sessions opencode » ----

const boutonMcpDe = (vue) => vue.querySelector(".cadre-rail-droit [aria-label='Serveurs MCP']");
const boutonSessionsDe = (vue) => vue.querySelector(".cadre-rail-droit [aria-label='Sessions opencode']");

test("REQ088_AC1_AC12_bouton_sous_opencode_seulement_si_detecte", async () => {
  simulerOpencode();
  const a = monter().vue;
  await vi.waitFor(() => expect(boutonSessionsDe(a)).not.toBeNull());
  const noms = nomsRailDroit(a);
  expect(noms.slice(-3)).toEqual(["opencode", "Sessions opencode", "Serveurs MCP"]);
  const b = boutonSessionsDe(a);
  expect(b.getAttribute("aria-haspopup")).toBe("dialog");
  expect(b.querySelector("svg")).not.toBeNull();
  b.parentElement.dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(document.querySelector("[role=tooltip]").textContent).toBe("Sessions opencode"));
  expect(b.hasAttribute("aria-keyshortcuts")).toBe(false);
  expect(b.hasAttribute("data-actif")).toBe(false);
  const ordre = [...a.querySelectorAll("button")].filter((x) => x.tabIndex >= 0).map((x) => x.getAttribute("aria-label"));
  expect(ordre[ordre.indexOf("opencode") + 1]).toBe("Sessions opencode");
  simulerOpencode({ opencode: false });
  const c = monter().vue;
  await vi.waitFor(() => expect(boutonClaudeDe(c)).not.toBeNull());
  expect(boutonSessionsDe(c)).toBeNull();
});

test("REQ088_AC4_AC12_choix_ouvre_un_onglet_sans_creer_de_session_ni_choisir_de_modele", async () => {
  const appels = simulerOpencode();
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
    if (String(url).startsWith("/api/opencode/api/session?")) {
      appels.push(`GET ${url}`);
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: "ses_a", title: "Corriger parse_args", time: { updated: 5, busy: 5 } }] }) };
    }
    return base(url, opts);
  }));
  const reprise = vi.spyOn(oc, "reprendreDernierChoix");
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonSessionsDe(vue)).not.toBeNull());
  const b = boutonSessionsDe(vue);
  b.focus();
  b.click();
  await vi.waitFor(() => expect(document.querySelector("dialog [role=option]")).not.toBeNull());
  expect(b.getAttribute("aria-expanded")).toBe("true");
  document.querySelector("dialog [role=listbox]").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(ongletsOc(vue)).toHaveLength(1));
  expect(ongletsOc(vue)[0].getAttribute("aria-selected")).toBe("true");
  expect(ongletsOc(vue)[0].title).toBe("Corriger parse_args");
  expect(nomDuChamp(document.activeElement)).toBe("Message à opencode");
  expect(document.querySelector("dialog")).toBeNull();
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(appels.filter((a) => a.startsWith("POST /api/opencode/api/session"))).toEqual([]);
  expect(appels.some((a) => a.includes("/model"))).toBe(false);
  expect(reprise).not.toHaveBeenCalled();
});

// ---- T-186 : version et mise à jour dans la barre d'état ----

function fauxVersion(initial) {
  const s = { lecture: { version: "0.9.1", derniere: null, maj: "aucune", installee: null, ...initial }, lectures: 0, posts: 0, post: { ok: true, status: 200, text: async () => "{}" }, retenir: null };
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    if (url === "/api/version") {
      s.lectures++;
      return s.lecture === null ? null : jsonOk(s.lecture);
    }
    if (url === "/api/version/maj" && opts.method === "POST") {
      s.posts++;
      if (s.retenir) await s.retenir;
      return s.post;
    }
    if (url === "/api/git/etat") return { ok: false, status: 409, json: async () => ({ cause: "pas-depot", message: "pas un dépôt" }) };
    return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
  }));
  return s;
}
const barreEtat = (vue) => vue.querySelector("footer");
const boutonMaj = (vue) => [...barreEtat(vue).querySelectorAll("button")].find((b) => b.textContent === "Mettre à jour" || b.textContent === "Mise à jour…");
const zoneStatus = (vue) => barreEtat(vue).querySelector("[role=status]");
const zoneAlert = (vue) => barreEtat(vue).querySelector("[role=alert]");

test("REQ092_AC1_la_version_s_affiche_tout_a_droite_avec_ou_sans_onglet", async () => {
  fauxVersion({});
  const { vue } = monter();
  await attendre();
  const v = barreEtat(vue).lastElementChild;
  expect(v.textContent).toBe("Yaide v0.9.1");
  expect(v.hidden).toBe(false);
  expect(boutonMaj(vue)).toBeUndefined();
  expect(zoneStatus(vue).textContent).toBe("");
});

test("REQ092_AC1_la_version_reste_tout_a_droite_avec_un_onglet_fichier_Agent_Claude_opencode", async () => {
  simulerOpencode();
  const fetchOc = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => (url === "/api/version" ? jsonOk({ version: "0.9.1", derniere: null, maj: "aucune", installee: null }) : url === "/api/claude" && opts?.method === "POST" ? { ok: true, status: 201, json: async () => ({ id: 7 }) } : fetchOc(url, opts))));
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  const version = () => barreEtat(vue).lastElementChild.textContent;
  expect(version()).toBe("Yaide v0.9.1");
  ligne(vue, "main.rs").click();
  await vi.waitFor(() => expect(vue.querySelector("[role=tab][aria-selected=true]")).not.toBeNull());
  expect(version()).toBe("Yaide v0.9.1");
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(champAgent(vue)).not.toBeNull());
  expect(version()).toBe("Yaide v0.9.1");
  boutonClaudeDe(vue).click();
  await vi.waitFor(() => expect(ongletsClaude(vue).length).toBe(1));
  expect(version()).toBe("Yaide v0.9.1");
  boutonOcDe(vue).click();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(1));
  expect(version()).toBe("Yaide v0.9.1");
});

test("REQ092_AC2_lecture_au_chargement_puis_chaque_minute", () =>
  avecHorloge(async () => {
    const s = fauxVersion({});
    monter();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.lectures).toBe(1);
    await vi.advanceTimersByTimeAsync(59000);
    expect(s.lectures).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.lectures).toBe(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.lectures).toBe(3);
  }));

test("REQ092_AC2_la_relecture_s_arrete_a_la_deconnexion", () =>
  avecHorloge(async () => {
    const s = fauxVersion({});
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(0);
    vue.detruire();
    await vi.advanceTimersByTimeAsync(180000);
    expect(s.lectures).toBe(1);
  }));

test("REQ092_AC3_notification_et_bouton_quand_la_release_est_plus_recente", async () => {
  fauxVersion({ derniere: "0.9.2" });
  const { vue } = monter();
  await attendre();
  expect(zoneStatus(vue).textContent).toBe("v0.9.2 disponible");
  expect(boutonMaj(vue).textContent).toBe("Mettre à jour");
  expect(barreEtat(vue).lastElementChild.textContent).toBe("Yaide v0.9.1");
});

test("REQ092_AC3_la_notification_parait_a_une_relecture_sans_rechargement_ni_focus", () =>
  avecHorloge(async () => {
    const s = fauxVersion({});
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(0);
    expect(boutonMaj(vue)).toBeUndefined();
    const avant = document.activeElement;
    s.lecture = { ...s.lecture, derniere: "0.9.2" };
    await vi.advanceTimersByTimeAsync(60000);
    expect(zoneStatus(vue).textContent).toBe("v0.9.2 disponible");
    expect(boutonMaj(vue)).toBeDefined();
    expect(document.activeElement).toBe(avant);
  }));

test("REQ092_AC4_derniere_nulle_egale_ou_plus_ancienne_ou_illisible_version_seule", () =>
  avecHorloge(async () => {
    const s = fauxVersion({ derniere: null });
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(0);
    for (const derniere of [null, "0.9.1", "0.8.0"]) {
      s.lecture = { ...s.lecture, derniere };
      await vi.advanceTimersByTimeAsync(60000);
      expect(zoneStatus(vue).textContent).toBe("");
      expect(zoneAlert(vue).textContent).toBe("");
      expect(boutonMaj(vue)).toBeUndefined();
      expect(barreEtat(vue).lastElementChild.textContent).toBe("Yaide v0.9.1");
    }
    s.lecture = { ...s.lecture, derniere: "0.9.2" };
    await vi.advanceTimersByTimeAsync(60000);
    expect(zoneStatus(vue).textContent).toBe("v0.9.2 disponible");
  }));

test("REQ092_AC4_une_coupure_ne_change_rien_a_la_barre", () =>
  avecHorloge(async () => {
    const s = fauxVersion({ derniere: "0.9.2" });
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(0);
    s.lecture = null;
    await vi.advanceTimersByTimeAsync(60000);
    expect(zoneStatus(vue).textContent).toBe("v0.9.2 disponible");
    expect(barreEtat(vue).lastElementChild.textContent).toBe("Yaide v0.9.1");
  }));

test("REQ093_AC1_AC6_installation_reussie_message_sans_bouton_et_focus_sur_le_message", async () => {
  const s = fauxVersion({ derniere: "0.9.2" });
  let fin;
  s.retenir = new Promise((r) => (fin = r));
  const { vue } = monter();
  await attendre();
  const b = boutonMaj(vue);
  b.focus();
  b.click();
  await attendre();
  expect(b.textContent).toBe("Mise à jour…");
  expect(b.getAttribute("aria-busy")).toBe("true");
  expect(b.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(b);
  fin();
  await attendre();
  expect(zoneStatus(vue).textContent).toBe("v0.9.2 installée. Redémarrez Yaide pour l'utiliser.");
  expect(boutonMaj(vue)).toBeUndefined();
  expect(barreEtat(vue).lastElementChild.textContent).toBe("Yaide v0.9.1");
  const m = zoneStatus(vue).firstElementChild;
  expect(document.activeElement).toBe(m);
  expect(m.getAttribute("tabindex")).toBe("-1");
});

test("REQ093_AC6_le_focus_ne_bouge_pas_s_il_n_etait_pas_sur_le_bouton", async () => {
  fauxVersion({ derniere: "0.9.2" });
  const { vue } = monter();
  await attendre();
  const ailleurs = barreTitre(vue, "Thème clair");
  ailleurs.focus();
  boutonMaj(vue).click();
  await attendre();
  await attendre();
  expect(zoneStatus(vue).textContent).toContain("installée");
  expect(document.activeElement).toBe(ailleurs);
});

test("REQ093_AC2_installee_au_chargement_meme_message_sans_bouton", async () => {
  fauxVersion({ derniere: "0.9.2", maj: "installee", installee: "0.9.2" });
  const { vue } = monter();
  await attendre();
  expect(zoneStatus(vue).textContent).toBe("v0.9.2 installée. Redémarrez Yaide pour l'utiliser.");
  expect(boutonMaj(vue)).toBeUndefined();
  expect(barreEtat(vue).lastElementChild.textContent).toBe("Yaide v0.9.1");
});

test("REQ093_AC3_AC6_echec_raison_bouton_rendu_nouveau_clic_reessaie", async () => {
  const s = fauxVersion({ derniere: "0.9.2" });
  s.post = { ok: false, status: 500, text: async () => "« sha256sum » est introuvable" };
  const { vue } = monter();
  await attendre();
  const b = boutonMaj(vue);
  b.focus();
  b.click();
  await attendre();
  await attendre();
  expect(zoneAlert(vue).textContent).toBe("La mise à jour a échoué : « sha256sum » est introuvable.");
  expect(zoneStatus(vue).textContent).toBe("");
  expect(boutonMaj(vue)).toBe(b);
  expect(b.textContent).toBe("Mettre à jour");
  expect(document.activeElement).toBe(b);
  s.post = { ok: true, status: 200, text: async () => "{}" };
  b.click();
  await attendre();
  await attendre();
  expect(s.posts).toBe(2);
  expect(zoneStatus(vue).textContent).toContain("installée");
  expect(zoneAlert(vue).textContent).toBe("");
});

test("REQ093_AC3_un_autre_onglet_revient_a_disponible_apres_l_echec", () =>
  avecHorloge(async () => {
    const s = fauxVersion({ derniere: "0.9.2", maj: "encours" });
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(0);
    expect(boutonMaj(vue).textContent).toBe("Mise à jour…");
    s.lecture = { ...s.lecture, maj: "aucune" };
    await vi.advanceTimersByTimeAsync(60000);
    expect(boutonMaj(vue).textContent).toBe("Mettre à jour");
    expect(zoneStatus(vue).textContent).toBe("v0.9.2 disponible");
    expect(zoneAlert(vue).textContent).toBe("");
  }));

test("REQ093_AC4_un_second_clic_ne_lance_rien_et_encours_lu_d_un_autre_onglet", async () => {
  const s = fauxVersion({ derniere: "0.9.2" });
  s.retenir = new Promise(() => {});
  const { vue } = monter();
  await attendre();
  const b = boutonMaj(vue);
  b.click();
  await attendre();
  b.click();
  await attendre();
  expect(s.posts).toBe(1);
  expect(zoneStatus(vue).textContent).toBe("v0.9.2 disponible");
});

test("REQ093_AC4_maj_encours_lu_du_serveur_clic_sans_effet", async () => {
  const s = fauxVersion({ derniere: "0.9.2", maj: "encours" });
  const { vue } = monter();
  await attendre();
  const b = boutonMaj(vue);
  expect(b.textContent).toBe("Mise à jour…");
  b.click();
  await attendre();
  expect(s.posts).toBe(0);
});

// ---- T-189 : badge de connexion relié à la coupure (REQ-094) ----

test("REQ094_AC1_AC2_le_badge_dit_Connecte_puis_Deconnecte_avec_le_bandeau_puis_Connecte_au_retour", () =>
  avecHorloge(async () => {
    let coupe = false;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      if (u === "/api/session") {
        if (coupe) throw new Error("coupé");
        return { status: 204 };
      }
      if (u.startsWith("/api/git/etat")) return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [] });
      return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
    }));
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(10);
    const badge = () => vue.querySelector("footer .ya-connexion");
    const bandeau = () => [...vue.querySelectorAll("[role=alert]")].find((m) => m.textContent.includes("Connexion perdue. Modifications gardées."));
    expect(badge().textContent).toBe("Serveur : Connecté");
    expect(badge().dataset.connexion).toBe("connecte");
    expect(badge().nextElementSibling).toBe(vue.querySelector("footer").lastElementChild);
    coupe = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(bandeau()).toBeTruthy();
    expect(badge().textContent).toBe("Serveur : Déconnecté");
    expect(badge().dataset.connexion).toBe("deconnecte");
    coupe = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(bandeau()).toBeFalsy();
    expect(badge().textContent).toBe("Serveur : Connecté");
    expect(badge().dataset.connexion).toBe("connecte");
  }));

test("REQ094_AC1_AC2_le_badge_reste_en_place_quel_que_soit_l_onglet_actif", () =>
  avecHorloge(async () => {
    simulerOpencode();
    const base = globalThis.fetch;
    let coupe = false;
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      if (String(url) === "/api/session") {
        if (coupe) throw new Error("coupé");
        return { status: 204 };
      }
      if (String(url) === "/api/claude" && opts?.method === "POST") return { ok: true, status: 201, json: async () => ({ id: 7 }) };
      return base(url, opts);
    }));
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(200);
    const badge = () => vue.querySelector("footer .ya-connexion");
    const etats = (texte) => expect(badge().textContent).toBe(texte);
    const ouvertures = {
      aucun: () => {},
      fichier: () => ligne(vue, "main.rs").click(),
      Agent: () => boutonAgentDe(vue).click(),
      Claude: () => boutonClaudeDe(vue).click(),
      opencode: () => boutonOcDe(vue).click(),
    };
    for (const [nom, ouvrir] of Object.entries(ouvertures)) {
      ouvrir();
      await vi.advanceTimersByTimeAsync(200);
      etats("Serveur : Connecté");
      coupe = true;
      await vi.advanceTimersByTimeAsync(2000);
      expect(badge().textContent, nom).toBe("Serveur : Déconnecté");
      coupe = false;
      await vi.advanceTimersByTimeAsync(2000);
      etats("Serveur : Connecté");
    }
    expect(champAgent(vue)).not.toBeNull();
    expect(ongletsClaude(vue).length).toBe(1);
    expect(ongletsOc(vue).length).toBe(1);
  }));

// ---- REQ-096 : « Serveurs MCP » ----

test("REQ096_AC1_bouton_au_pied_du_rail_droit_seulement_avec_agents", async () => {
  simulerOpencode();
  const a = monter().vue;
  await vi.waitFor(() => expect(boutonSessionsDe(a)).not.toBeNull());
  expect(nomsRailDroit(a).slice(-3)).toEqual(["opencode", "Sessions opencode", "Serveurs MCP"]);
  expect(boutonMcpDe(a).closest(".cadre-rail-pied")).not.toBeNull();
  simulerOpencode({ opencode: false, claude: false });
  const b = monter({ reglages: { fonctions: { agents: false } } }).vue;
  await attendre();
  expect(boutonMcpDe(b)).toBeNull();
  expect(b.querySelector(".cadre-rail-droit")).toBeNull();
});

test("REQ096_AC13_dernier_arret_du_rail_droit_touches_et_dialogue", async () => {
  simulerOpencode();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonSessionsDe(vue)).not.toBeNull());
  const b = boutonMcpDe(vue);
  expect(b.getAttribute("aria-haspopup")).toBe("dialog");
  expect(b.querySelector("svg")).not.toBeNull();
  const rail = [...vue.querySelectorAll(".cadre-rail-droit button")];
  expect(rail.at(-1)).toBe(b);
  b.focus();
  for (const k of ["f", "r", "g"]) clavier(b, k);
  expect(vue.querySelector("[role=tab][aria-label=Fichiers]").getAttribute("aria-selected")).toBe("true");
  expect(vue.querySelector("[role=tab][aria-label=Recherche]").getAttribute("aria-selected")).toBe("false");
  expect(document.activeElement).toBe(b);
  expect(document.querySelector("dialog")).toBeNull();
  clavier(b, "a");
  await vi.waitFor(() => expect(document.activeElement).toBe(champAgent(vue)));
  b.focus();
  b.click();
  await vi.waitFor(() => expect(document.querySelector("dialog")).not.toBeNull());
  expect(document.querySelector("dialog").getAttribute("aria-label") ?? document.querySelector("dialog").textContent).toContain("Serveurs MCP");
  expect(b.getAttribute("aria-expanded")).toBe("true");
  document.querySelector("dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("dialog")).toBeNull());
  expect(document.activeElement).toBe(b);
  expect(b.getAttribute("aria-expanded")).not.toBe("true");
});

// ---- REQ-101 : indication « lien » de la barre d'état ----

test("REQ101_AC11_survol_d_un_lien_pose_l_indication_dans_la_barre_puis_la_retire", async () => {
  const doc = "titre\n\n[Lire](../README.md)\n\nfin\n";
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const chemin = String(url).split("?")[0];
    const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps, text: async () => "" });
    if (chemin === "/api/fichiers") return rep({ entrees: [{ nom: "notes.md", dossier: false, ignore: false }] });
    if (chemin === "/api/fichier") return { ok: true, status: 200, text: async () => doc, headers: { get: () => "1" } };
    if (chemin === "/api/git/etat") return rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    if (chemin === "/api/shells") return rep({ instance: "i1", shells: [] });
    return rep({}, 409);
  }));
  const { vue } = monter();
  await vi.waitFor(() => expect(ligne(vue, "notes.md")).toBeTruthy());
  ligne(vue, "notes.md").click();
  await vi.waitFor(() => expect(vue.querySelector(".zone-code")).not.toBeNull());
  const z = vue.querySelector(".zone-code");
  ensureSyntaxTree(z.vue.state, z.vue.state.doc.length, 5000);
  z.vue.posAtCoords = () => doc.indexOf("Lire") + 1;
  const indication = () => vue.querySelector("footer .ya-status-lien");
  expect(indication().hidden).toBe(true);
  z.vue.contentDOM.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  expect(indication().hidden).toBe(false);
  expect(indication().textContent).toContain("Ctrl+clic pour ouvrir ../README.md");
  z.vue.dom.dispatchEvent(new MouseEvent("mouseleave"));
  expect(indication().hidden).toBe(true);
  expect(indication().textContent).toBe("");
  // Changer d'onglet retire l'indication.
  z.vue.contentDOM.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  expect(indication().hidden).toBe(false);
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(champAgent(vue)).not.toBeNull());
  expect(indication().hidden).toBe(true);
});
