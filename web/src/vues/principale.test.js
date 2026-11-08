import { expect, test, vi } from "vitest";
import { ecrire, lire } from "../stockage.js";
import { monter, attendre, poignees, simulerShells, onglets, barreTitre, aside, paletteCommandes, nomsCommandes, agentCol, boutonAgentDe, boutonAgentsDe, champAgent, clavier, largeur, jsonOk } from "./principale.aides.js";

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
    if (url === "/api/git/etat") return { ok: true, status: 200, json: async () => ({ branche: "main", detachee: false, branches: ["main"], changements: [] }) };
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  const { vue } = monter();
  await new Promise((r) => setTimeout(r, 0));
  const etat = vue.querySelector("footer");
  expect(etat.textContent).toBe("main");
  expect(etat.querySelector("svg[data-icone=branch]")).not.toBeNull();
  expect(vue.querySelector("header").textContent).not.toContain("main");
});

test("REQ037_AC4_HEAD_detachee_affiche_detachee_seul", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/git/etat") return { ok: true, status: 200, json: async () => ({ branche: "a1b2c3d", detachee: true, branches: [], changements: [] }) };
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  const { vue } = monter();
  await new Promise((r) => setTimeout(r, 0));
  expect(vue.querySelector("footer").textContent).toBe("détachée");
});

test("REQ022_AC4_et_REQ037_AC4_hors_depot_rien_dans_la_barre_d_etat", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/git/etat") return { ok: false, status: 409, json: async () => ({ cause: "pas-depot", message: "Ce dossier n'est pas un dépôt git." }) };
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  const { vue } = monter();
  await new Promise((r) => setTimeout(r, 0));
  expect(vue.querySelector("footer").textContent).toBe("");
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
  expect([...rd.querySelectorAll("button")]).toEqual([b, boutonAgentsDe(vue)]);
  expect(b.getAttribute("aria-keyshortcuts")).toBe("A");
  expect(b.querySelector("svg[data-icone=bot]")).not.toBeNull();
  expect(b.textContent).toBe("");
  expect(b.hasAttribute("aria-pressed") || b.hasAttribute("aria-expanded")).toBe(false);
  expect(b.hasAttribute("data-actif")).toBe(false);
  expect(vue.querySelector("[role=tablist] [aria-label=Agent]")).toBeNull();
  b.parentElement.dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(document.querySelector("[role=tooltip]").textContent).toBe("Agent (A)"));
  expect(vue.querySelector("main").nextElementSibling.nextElementSibling).toBe(agentCol(vue));
});

test("REQ059_AC8_agent_replie_au_premier_lancement", () => {
  const { vue } = monter();
  expect(agentCol(vue).hidden).toBe(true);
  expect(vue.querySelector(".poignee-agent").hidden).toBe(true);
});

test("REQ028_AC5_REQ059_AC2_A_depuis_les_onglets_deplie_l_agent", () => {
  const { vue } = monter();
  const tab = vue.querySelector("[role=tab]");
  tab.focus();
  clavier(tab, "a");
  expect(agentCol(vue).hidden).toBe(false);
  expect(boutonAgentDe(vue).hasAttribute("data-actif")).toBe(true);
  expect(document.activeElement).toBe(champAgent(vue));
  // Déplié : seulement le focus, sans replier.
  tab.focus();
  clavier(tab, "a");
  expect(agentCol(vue).hidden).toBe(false);
  expect(document.activeElement).toBe(champAgent(vue));
  expect(vue.querySelector("aside h2").textContent).toBe("Fichiers");
});

test("REQ028_AC12_REQ059_AC2_A_depuis_les_boutons_des_shells_et_depuis_Agent", () => {
  const { vue } = monter();
  for (const b of vue.querySelectorAll(".cadre-rail-commandes button")) {
    vue.querySelector("[role=tab]").focus();
    clavier(b, "a");
    expect(agentCol(vue).hidden, b.getAttribute("aria-label")).toBe(false);
    expect(document.activeElement).toBe(champAgent(vue));
    vue.querySelector("[aria-label=\"Replier l'agent\"]").click();
    expect(agentCol(vue).hidden).toBe(true);
  }
  boutonAgentDe(vue).focus();
  clavier(boutonAgentDe(vue), "a");
  expect(agentCol(vue).hidden).toBe(false);
  expect(document.activeElement).toBe(champAgent(vue));
});

test("REQ059_AC2_clic_sur_Agent_deplie_puis_ne_replie_pas", () => {
  const { vue } = monter();
  boutonAgentDe(vue).click();
  expect(agentCol(vue).hidden).toBe(false);
  expect(document.activeElement).toBe(champAgent(vue));
  vue.querySelector("main").focus();
  boutonAgentDe(vue).click();
  expect(agentCol(vue).hidden).toBe(false);
  expect(document.activeElement).toBe(champAgent(vue));
});

test("REQ059_AC3_REQ056_AC14_Replier_l_agent_donne_le_focus_a_Agent_et_garde_le_texte", () => {
  const { vue } = monter();
  boutonAgentDe(vue).click();
  champAgent(vue).value = "bonjour";
  const repli = vue.querySelector("[aria-label=\"Replier l'agent\"]");
  expect(agentCol(vue).querySelector("button")).toBe(repli);
  const noms = [...agentCol(vue).querySelectorAll("button, textarea, select")].map((e) => e.getAttribute("aria-label") ?? e.tagName.toLowerCase());
  expect(noms.slice(0, 3)).toEqual(["Replier l'agent", "Nouvelle conversation", "Conversations"]);
  expect(noms.indexOf("textarea")).toBeGreaterThan(2);
  repli.click();
  expect(agentCol(vue).hidden).toBe(true);
  expect(vue.querySelector(".poignee-agent").hidden).toBe(true);
  expect(boutonAgentDe(vue).hasAttribute("data-actif")).toBe(false);
  expect(document.activeElement).toBe(boutonAgentDe(vue));
  expect(boutonAgentDe(vue).classList.contains("ya-focus-garde")).toBe(true);
  expect(champAgent(vue).value).toBe("bonjour");
  boutonAgentDe(vue).click();
  expect(champAgent(vue).value).toBe("bonjour");
});

test("REQ059_AC4_un_tour_continue_agent_replie", async () => {
  vi.useFakeTimers();
  let lectures = 0;
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/agent/reglages") return { ok: true, status: 200, json: async () => ({ providers: [], profils: [{ id: "p", nom: "m", provider: "openai", modele: "x", defaut: true }] }) };
    if (String(url).startsWith("/api/agent/conversations/c1")) {
      lectures++;
      const fini = lectures > 2;
      return { ok: true, status: 200, json: async () => ({ entrees: fini ? [{ type: "agent", markdown: "Étape arrivée replié." }] : [], enCours: !fini, total: fini ? 1 : 0, tokens: 0 }) };
    }
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "agent" ? { conversation: "c1" } : undefined));
  try {
    const { vue } = monter();
    boutonAgentDe(vue).click();
    await vi.advanceTimersByTimeAsync(100);
    expect(lectures).toBeGreaterThan(0);
    vue.querySelector("[aria-label=\"Replier l'agent\"]").click();
    const avant = lectures;
    await vi.advanceTimersByTimeAsync(10000);
    expect(lectures).toBeGreaterThan(avant);
    boutonAgentDe(vue).click();
    await vi.advanceTimersByTimeAsync(100);
    expect(agentCol(vue).querySelector("[role=log]").textContent).toContain("Étape arrivée replié.");
  } finally {
    vi.useRealTimers();
  }
});

test("REQ059_AC5_AC7_sans_taille_gardee_l_agent_est_borne_pour_laisser_320_px_a_l_editeur", () => {
  largeur(1000);
  const { vue } = monter();
  boutonAgentDe(vue).click();
  const p = Number.parseInt(vue.style.getPropertyValue("--taille-panneau"), 10);
  const a = Number.parseInt(vue.style.getPropertyValue("--taille-agent"), 10);
  expect(a).toBeLessThan(360);
  expect(a).toBeGreaterThanOrEqual(240);
  // 1000 - 2 rails de 48 (token) - poignées : l'éditeur garde au moins 320 px.
  expect(1000 - 2 * Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--size-activity"), 10) - p - a).toBeGreaterThanOrEqual(320);
});

test("REQ028_AC8_ordre_de_Tab_de_la_page_avec_l_agent_a_droite", () => {
  const { vue } = monter();
  const tabbables = () => [...vue.querySelectorAll("button, textarea, input, [tabindex='0'], [role=separator]")].filter((e) => !e.closest("[hidden]") && e.tabIndex >= 0);
  const pos = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const poignee = vue.querySelector(".poignee-agent");
  const bouton = boutonAgentDe(vue);
  const terminaux = vue.querySelector(".cadre-shells");
  // Replié : aucun arrêt dans la colonne, le bouton « Agent » est le dernier.
  expect(tabbables().some((e) => agentCol(vue).contains(e) || e === poignee)).toBe(false);
  expect(tabbables().slice(-2)).toEqual([bouton, boutonAgentsDe(vue)]);
  boutonAgentDe(vue).click();
  const liste = tabbables();
  const iPoignee = liste.indexOf(poignee);
  const iVue = liste.indexOf(champAgent(vue));
  expect(iPoignee).toBeGreaterThan(-1);
  expect(pos(terminaux, poignee)).toBe(true);
  expect(iVue).toBeGreaterThan(iPoignee);
  expect(liste.indexOf(bouton)).toBeGreaterThan(iVue);
  expect(liste.indexOf(vue.querySelector("[aria-label=\"Replier l'agent\"]"))).toBe(iPoignee + 1);
});

test("REQ059_AC6_sous_904_deplier_l_agent_replie_le_panneau_et_inversement", () => {
  largeur(800);
  const { vue } = monter();
  expect(aside(vue).hidden).toBe(false);
  boutonAgentDe(vue).click();
  expect(agentCol(vue).hidden).toBe(false);
  expect(aside(vue).hidden).toBe(true);
  expect(document.activeElement).toBe(champAgent(vue));
  barreTitre(vue, "Déplier le panneau").click();
  expect(aside(vue).hidden).toBe(false);
  expect(agentCol(vue).hidden).toBe(true);
});

test("REQ059_AC6_AC18_A_sous_904_garde_l_onglet_actif_et_le_titre_de_barre", () => {
  largeur(800);
  const { vue } = monter();
  const tab = vue.querySelector("[role=tab]");
  tab.focus();
  clavier(tab, "a");
  expect(aside(vue).hidden).toBe(true);
  expect(barreTitre(vue, "Déplier le panneau")).not.toBeNull();
  expect(tab.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(champAgent(vue));
});

test("REQ059_AC7_fenetre_qui_retrecit_avec_les_deux_deplies_replie_le_panneau", () => {
  largeur(1280);
  const { vue } = monter();
  boutonAgentDe(vue).click();
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
  boutonAgentDe(vue).click();
  vue.querySelector("[aria-label=\"Replier l'agent\"]").click();
  expect(ecrire).toHaveBeenLastCalledWith("replis", { panneau: false, agent: true });
});

test("REQ059_AC9_replier_et_deplier_l_agent_mesure_a_nouveau", () => {
  const { vue } = monter();
  const mesurer = vi.spyOn(vue, "mesurer");
  boutonAgentDe(vue).click();
  expect(mesurer).toHaveBeenCalledTimes(1);
  vue.querySelector("[aria-label=\"Replier l'agent\"]").click();
  expect(mesurer).toHaveBeenCalledTimes(2);
});
