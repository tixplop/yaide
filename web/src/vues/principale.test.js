import { afterEach, expect, test, vi } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import * as oc from "../opencode.js";
import * as worktree from "../worktree.js";
import { ecrire, lire } from "../stockage.js";
import { charger as chargerCouleurs } from "../couleurs-markdown.js";
import { afficher } from "../ui/toasts.js";
import { simulerServeur, ETAT_GIT, monter, attendre, avecHorloge, poignees, simulerShells, onglets, barreTitre, aside, paletteCommandes, nomsCommandes, agentCol, boutonAgentDe, boutonAgentsDe, champAgent, clavier, largeur, jsonOk, fauxServeur, corpsAgents, titreColonne, simulerOpencode, boutonClaudeDe, ongletsOc, nomDuChamp, nomsRailDroit, boutonOcDe, ongletsClaude, ligne } from "./principale.aides.js";

vi.mock("../couleurs-markdown.js", async (orig) => ({ ...(await orig()), charger: vi.fn(async () => ({ illisible: false })), lire: vi.fn(async () => ({ sombre: {}, clair: {} })) }));
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
  expect(noms).toEqual(["Ouverture rapide", "Replier le panneau", "Replier les shells", "Thème clair", "Déconnexion", "Arrêter Yaide"]);
  expect(barre.querySelector("button").textContent).toBe("projet");
  expect(barre.textContent).toBe("projet");
  expect(barre.querySelector("[aria-label=Déconnexion]").textContent).toBe("");
  expect(barre.querySelector("nav, [role=menubar]")).toBeNull();
});

test("REQ162_AC1_AC11_Arreter_Yaide_juste_apres_Deconnexion_icone_power_sans_texte_ni_title_ni_desactive", () => {
  const { vue } = monter();
  const noms = [...vue.querySelectorAll("header button")].map((b) => b.getAttribute("aria-label"));
  expect(noms.slice(-2)).toEqual(["Déconnexion", "Arrêter Yaide"]);
  const b = vue.querySelector("header [aria-label='Arrêter Yaide']");
  const sortir = vue.querySelector("header [aria-label=Déconnexion]");
  expect(b.textContent).toBe("");
  expect(b.querySelector("svg").getAttribute("data-icone")).toBe("power");
  expect(b.hasAttribute("title")).toBe(false);
  expect(b.hasAttribute("aria-keyshortcuts")).toBe(false);
  expect(b.disabled).toBe(false);
  expect(b.hasAttribute("disabled")).toBe(false);
  expect(b.className).toBe(sortir.className);
});

test("REQ162_AC4_clic_sur_Arreter_Yaide_appelle_arret_puis_surDeconnexion_arret", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 204 })));
  const { vue, surDeconnexion } = monter();
  vue.querySelector("header [aria-label='Arrêter Yaide']").click();
  await new Promise((r) => setTimeout(r, 0));
  expect(fetch).toHaveBeenCalledWith("/api/arret", expect.objectContaining({ method: "POST" }));
  expect(surDeconnexion).toHaveBeenCalledWith("arret");
});

test("REQ162_AC5_clic_sur_Deconnexion_passe_deconnexion_a_surDeconnexion", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 204 })));
  const { vue, surDeconnexion } = monter();
  vue.querySelector("header [aria-label=Déconnexion]").click();
  await new Promise((r) => setTimeout(r, 0));
  expect(surDeconnexion).toHaveBeenCalledWith("deconnexion");
});

test("REQ162_AC6_pendant_une_coupure_Arreter_Yaide_dit_connexion_perdue_sans_rien_arreter", () =>
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
    const { vue, surDeconnexion } = monter();
    await vi.advanceTimersByTimeAsync(10);
    coupe = true;
    await vi.advanceTimersByTimeAsync(2000);
    vue.querySelector("header [aria-label='Arrêter Yaide']").click();
    await vi.advanceTimersByTimeAsync(10);
    expect([...vue.querySelectorAll("[role=alert]")].some((m) => m.textContent.includes("Connexion perdue. Réessayez au retour."))).toBe(true);
    expect(fetch).not.toHaveBeenCalledWith("/api/arret", expect.anything());
    expect(surDeconnexion).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
  }));

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

test("REQ070_AC5_AC19_REQ071_AC1_AC8_REQ116_AC4_ouvert_avec_agents_et_shells_desactives", async () => {
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
  expect(nomsCommandes()).toEqual(["Configuration", "Environnements"]);
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const dlg = document.querySelector("dialog");
  expect(dlg.querySelector("h2").textContent).toBe("Configuration");
  expect([...dlg.querySelectorAll("[role=tab]")].map((t) => t.textContent)).toEqual(["Interface", "Couleurs markdown"]);
  expect([...dlg.querySelectorAll("input[type=checkbox]")].filter((c) => !c.checked).map((c) => c.labels[0].textContent)).toEqual(["Shells", "Agents"]);
  expect(appels.filter((a) => a.includes("/api/agent"))).toEqual([]);
  dlg.dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(avant);
  expect(appels.filter((a) => a.startsWith("PUT"))).toEqual([]);
});

test("REQ054_AC2_AC4_AC6_REQ182_AC10_env_ouvre_le_panneau_et_echap_rend_le_focus_d_avant_ctrl_p", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u === "/api/chemins") return jsonOk({ chemins: [] });
    if (u === "/api/git/etat") return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [] });
    if (u.startsWith("/api/fichiers?")) return jsonOk({ entrees: [] });
    if (u === "/api/session") return { status: 204 };
    if (u === "/api/environnements") return jsonOk({ fichier: "/home/x/.config/yaide/environnements.json", environnements: [{ nom: "prod", variables: { A: "1" } }] });
    return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "absent" }) };
  }));
  const { vue } = monter();
  const avant = vue.querySelector("header [aria-label=Déconnexion]");
  avant.focus();
  const entree = paletteCommandes(">env");
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const dlg = document.querySelector("dialog");
  expect(dlg.querySelector("h2").textContent).toBe("Environnements");
  expect(document.activeElement.getAttribute("aria-label")).toBe("Modifier prod");
  dlg.dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(avant);
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
  expect(nomsCommandes()).toEqual(["Providers LLM", "Profils de modèle", "Configuration", "Environnements"]);
  entree.value = ">conf";
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
  expect([...rd.querySelectorAll("button")]).toEqual([b, boutonAgentsDe(vue), boutonBaseDe(vue), boutonMcpDe(vue)]);
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
  const bandeau = () => [...vue.querySelectorAll(".ya-toasts [role=alert]")].find((a) => a.textContent.includes("Réessayez au retour."));
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
  expect(tabbables().slice(-4)).toEqual([bouton, boutonAgentsDe(vue), boutonBaseDe(vue), boutonMcpDe(vue)]);
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
  await vi.advanceTimersByTimeAsync(50);
  const bandeau = [...vue.querySelectorAll(".ya-toasts [role=status]")].find((m) => m.textContent.includes("a disparu"));
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
const boutonBaseDe = (vue) => vue.querySelector(".cadre-rail-droit [aria-label='Base de connaissance']");
const boutonSessionsDe = (vue) => vue.querySelector(".cadre-rail-droit [aria-label='Sessions opencode']");

test("REQ088_AC1_AC12_bouton_sous_opencode_seulement_si_detecte", async () => {
  simulerOpencode();
  const a = monter().vue;
  await vi.waitFor(() => expect(boutonSessionsDe(a)).not.toBeNull());
  const noms = nomsRailDroit(a);
  expect(noms.slice(-4)).toEqual(["opencode", "Sessions opencode", "Base de connaissance", "Serveurs MCP"]);
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
  expect(nomsRailDroit(a).slice(-4)).toEqual(["opencode", "Sessions opencode", "Base de connaissance", "Serveurs MCP"]);
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

// ---- REQ-103 : « Base de connaissance » ----

test("REQ103_AC1_AC8_bouton_juste_au_dessus_de_Serveurs_MCP_seulement_avec_agents_et_dialogue_au_clic", async () => {
  simulerOpencode();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonSessionsDe(vue)).not.toBeNull());
  const b = boutonBaseDe(vue);
  expect(boutonMcpDe(vue).closest(".cadre-rail-pied")).toBe(b.closest(".cadre-rail-pied"));
  expect(b.closest(".bouton-enveloppe").nextElementSibling).toBe(boutonMcpDe(vue).closest(".bouton-enveloppe"));
  expect(b.getAttribute("aria-haspopup")).toBe("dialog");
  expect(b.hasAttribute("aria-pressed")).toBe(false);
  expect(b.hasAttribute("aria-expanded")).toBe(false);
  b.closest(".bouton-enveloppe").dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(document.querySelector("[role=tooltip]").textContent).toBe("Base de connaissance"));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ config: null, erreur: null, collections: [], ajout: null }) })));
  b.focus();
  b.click();
  await vi.waitFor(() => expect(document.querySelector("dialog [role=tablist]")).not.toBeNull());
  expect(document.querySelector("dialog [role=tablist]").getAttribute("aria-label")).toBe("Base de connaissance");
  expect(b.getAttribute("aria-expanded")).toBe("true");
  document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("dialog")).toBeNull());
  expect(document.activeElement).toBe(b);
  simulerOpencode({ opencode: false, claude: false });
  const sans = monter({ reglages: { fonctions: { agents: false } } }).vue;
  await attendre();
  expect(boutonBaseDe(sans)).toBeNull();
});

test("REQ104_AC7_Configurer_la_base_ouvre_V_013_sur_Configuration_et_Echap_rend_le_focus_a_la_ligne", async () => {
  const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps, text: async () => "" });
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const chemin = String(url).split("?")[0];
    if (chemin === "/api/fichiers") return rep({ entrees: [{ nom: "notes.md", dossier: false, ignore: false }] });
    if (chemin === "/api/connaissance") return rep({ config: null, erreur: null, collections: [], ajout: null });
    if (chemin === "/api/git/etat") return rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    if (chemin === "/api/shells") return rep({ instance: "i1", shells: [] });
    return rep({}, 409);
  }));
  const { vue } = monter();
  await vi.waitFor(() => expect(ligne(vue, "notes.md")).toBeTruthy());
  const l = ligne(vue, "notes.md");
  l.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  [...document.querySelectorAll("[role=menuitem]")].find((i) => i.textContent.startsWith("Ajouter")).click();
  await vi.waitFor(() => expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Configurer la base")).toBe(true));
  [...document.querySelectorAll("button")].find((b) => b.textContent === "Configurer la base").click();
  await vi.waitFor(() => expect(document.querySelector("dialog [role=tablist]")).not.toBeNull());
  expect(document.querySelector("dialog [role=tab][aria-selected=true]").textContent).toBe("Configuration");
  expect(document.activeElement.labels[0].textContent).toBe("Provider");
  document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("dialog")).toBeNull());
  expect(document.activeElement).toBe(ligne(vue, "notes.md"));
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

// ---- REQ-115 : bandeaux de fichiers illisibles ----

const TEXTE_MD = ".yaide/markdown.json est illisible. Corrigez-le, puis rechargez la page.";
const TEXTE_IF = ".yaide/interface.json est illisible. Corrigez-le, puis rechargez la page.";
const alertes = (vue) => [...vue.querySelectorAll("[role=alert]")].filter((a) => a.textContent.includes("est illisible."));

test("REQ115_AC10_markdown_illisible_donne_un_bandeau_alerte_ferme_sans_focus_dedans", async () => {
  simulerServeur(ETAT_GIT([]));
  const { vue } = monter({ couleursIllisibles: true });
  await attendre();
  await vi.waitFor(() => expect(alertes(vue)).toHaveLength(1));
  const [bandeau, ...autres] = alertes(vue);
  expect(autres).toEqual([]);
  expect(bandeau.closest(".ya-toasts")).not.toBeNull();
  expect(bandeau.querySelector(".message-texte").textContent).toBe(TEXTE_MD);
  ligne(vue, "main.rs").click();
  await vi.waitFor(() => expect(vue.querySelector(".cm-content")).not.toBeNull());
  expect(bandeau.contains(document.activeElement)).toBe(false);
  expect(document.activeElement.closest(".cm-content")).not.toBeNull();
  const fermer = bandeau.querySelector("button");
  expect(fermer.getAttribute("aria-label")).toBe("Fermer");
  fermer.click();
  expect(alertes(vue)).toEqual([]);
  vue.detruire();
  const sans = monter({ couleursIllisibles: false });
  await attendre();
  expect(sans.vue.textContent).not.toContain("illisible");
});

test("REQ115_AC10_AC11_deux_fichiers_illisibles_deux_bandeaux_interface_d_abord_chaque_fermer_retire_le_sien", async () => {
  const { vue } = monter({ reglages: { illisible: true }, couleursIllisibles: true });
  await vi.waitFor(() => expect(alertes(vue)).toHaveLength(2));
  const [premier, second] = alertes(vue);
  expect(alertes(vue)).toHaveLength(2);
  expect(premier.querySelector(".message-texte").textContent).toBe(TEXTE_IF);
  expect(second.querySelector(".message-texte").textContent).toBe(TEXTE_MD);
  expect(premier.nextElementSibling).toBe(second);
  for (const b of [premier, second]) {
    const fermer = b.querySelector("button");
    expect(fermer.getAttribute("aria-describedby")).toBe(b.querySelector(".message-texte").id);
  }
  premier.querySelector("button").click();
  expect(alertes(vue)).toEqual([second]);
});

test("REQ115_AC8_enregistrer_markdown_json_dans_l_editeur_ne_relit_pas_les_couleurs", async () => {
  const brut = simulerServeur(ETAT_GIT([]));
  const base = fetch;
  const puts = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "PUT") {
      puts.push(decodeURIComponent(url));
      return { ok: true, status: 200, json: async () => ({ version: "2" }) };
    }
    const chemin = url.split("?")[0];
    if (chemin === "/api/fichiers") {
      const dossier = url.includes("chemin=.yaide");
      return { ok: true, status: 200, json: async () => ({ entrees: dossier ? [{ nom: "markdown.json", dossier: false, ignore: false }] : [{ nom: ".yaide", dossier: true, ignore: false }] }) };
    }
    return base(url, init);
  }));
  void brut;
  chargerCouleurs.mockClear();
  const feuilles = [{ sentinelle: true }];
  document.adoptedStyleSheets = feuilles;
  const { vue } = monter();
  await attendre();
  await attendre();
  ligne(vue, ".yaide").click();
  await vi.waitFor(() => expect(ligne(vue, "markdown.json")).toBeDefined());
  ligne(vue, "markdown.json").click();
  await vi.waitFor(() => expect(vue.querySelector(".zone-code")?.vue).toBeDefined());
  vue.querySelector(".zone-code").vue.dispatch({ changes: { from: 0, insert: "{}" } });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(puts.some((u) => u.includes(".yaide/markdown.json"))).toBe(true));
  await attendre();
  expect(chargerCouleurs).not.toHaveBeenCalled();
  expect(document.adoptedStyleSheets).toBe(feuilles);
  document.adoptedStyleSheets = [];
});

test("REQ117_AC19_enregistrer_les_couleurs_retire_le_seul_bandeau_de_markdown_json", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u === "/api/chemins") return jsonOk({ chemins: [] });
    if (u === "/api/git/etat") return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [] });
    if (u.startsWith("/api/fichiers?")) return jsonOk({ entrees: [] });
    if (u === "/api/session") return { status: 204 };
    if (u.startsWith("/api/fichier?chemin=") && opts.method === "PUT") return jsonOk({ version: "v2" });
    if (u.startsWith("/api/fichier?chemin=")) return { ok: true, status: 200, text: async () => '{"fonctions":{"agents":false,"shells":false}}', headers: { get: () => "v1" } };
    return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
  }));
  const { vue } = monter({ reglages: { illisible: true, fonctions: { agents: false, shells: false } }, couleursIllisibles: true });
  await vi.waitFor(() => expect(alertes(vue)).toHaveLength(2));
  const entree = paletteCommandes(">");
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const dlg = document.querySelector("dialog");
  [...dlg.querySelectorAll("[role=tab]")].find((t) => t.textContent === "Couleurs markdown").click();
  [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Enregistrer" && !b.closest("[hidden]")).click();
  await vi.waitFor(() => expect(alertes(vue).map((a) => a.querySelector(".message-texte").textContent)).toEqual([TEXTE_IF]));
});

test("REQ118_AC11_commande_en_dernier_et_entree_formate_avec_le_focus_dans_l_editeur", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u === "/api/chemins") return jsonOk({ chemins: ["a.json"] });
    if (u === "/api/git/etat") return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [] });
    if (u.startsWith("/api/fichiers?")) return jsonOk({ entrees: [] });
    if (u === "/api/session") return { status: 204 };
    if (u === "/api/agent/reglages") return jsonOk({ providers: [], profils: [] });
    if (u.startsWith("/api/fichier?chemin=a.json")) return { ok: true, status: 200, text: async () => '{"b":1}', headers: { get: () => "v1" } };
    return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "absent" }) };
  }));
  const { vue } = monter();
  const entree = paletteCommandes("a.json");
  await vi.waitFor(() => expect(document.querySelector("dialog [role=option]")).not.toBeNull());
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(vue.querySelector(".zone-code:not([hidden])")).not.toBeNull());
  expect(document.querySelector("dialog")).toBeNull();
  const e2 = paletteCommandes(">");
  expect(nomsCommandes()).toEqual(["Providers LLM", "Profils de modèle", "Configuration", "Environnements", "Formater le document", "Exporter en PDF"]);
  e2.value = ">form";
  e2.dispatchEvent(new Event("input", { bubbles: true }));
  expect(nomsCommandes()).toEqual(["Formater le document"]);
  e2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const zone = vue.querySelector(".zone-code:not([hidden])");
  expect(document.querySelector("dialog")).toBeNull();
  expect(zone.vue.state.doc.toString()).toBe('{\n  "b": 1\n}\n');
  expect(document.activeElement).toBe(zone.vue.contentDOM);
});

async function ouvrirJson(contenu) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u === "/api/chemins") return jsonOk({ chemins: ["a.json"] });
    if (u === "/api/git/etat") return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [] });
    if (u.startsWith("/api/fichiers?")) return jsonOk({ entrees: [] });
    if (u === "/api/session") return { status: 204 };
    if (u === "/api/agent/reglages") return jsonOk({ providers: [], profils: [] });
    if (u.startsWith("/api/fichier?chemin=a.json")) return { ok: true, status: 200, text: async () => contenu, headers: { get: () => "v1" } };
    return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "absent" }) };
  }));
  const { vue } = monter();
  const entree = paletteCommandes("a.json");
  await vi.waitFor(() => expect(document.querySelector("dialog [role=option]")).not.toBeNull());
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(vue.querySelector(".zone-code:not([hidden])")).not.toBeNull());
  return { vue, zone: vue.querySelector(".zone-code:not([hidden])") };
}
const formaterParPalette = () => {
  const e = paletteCommandes(">form");
  e.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
};

test("REQ118_AC13_focus_dans_l_arborescence_une_ligne_courante_form_en_gras_puis_focus_dans_l_editeur", async () => {
  const { vue, zone } = await ouvrirJson('{"b":1}');
  vue.querySelector("[role=tree]")?.focus();
  const e = paletteCommandes(">form");
  const lignes = [...document.querySelectorAll("dialog [role=option]")];
  expect(lignes.map((l) => l.querySelector(".liste-libelle").textContent)).toEqual(["Formater le document"]);
  expect(lignes[0].getAttribute("aria-selected")).toBe("true");
  expect(lignes[0].querySelector("b.liste-trouve").textContent).toBe("Form");
  e.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(zone.vue.contentDOM);
});

test("REQ118_AC14_json_invalide_message_avec_fermer_curseur_et_texte_inchanges", async () => {
  const { vue, zone } = await ouvrirJson('{"a":1,}');
  zone.vue.dispatch({ selection: { anchor: 4 } });
  formaterParPalette();
  const alerte = () => [...vue.querySelectorAll("[role=alert]")].find((a) => a.textContent.includes("Formatage impossible : ce JSON n'est pas valide."));
  await vi.waitFor(() => expect(alerte()).toBeDefined());
  expect(zone.vue.state.selection.main.head).toBe(4);
  expect(vue.querySelector("footer").textContent).toContain("Ln 1, Col 5");
  alerte().querySelector("button[aria-label=Fermer]").click();
  expect(alerte()).toBeUndefined();
  expect(zone.vue.state.doc.toString()).toBe('{"a":1,}');
});

test("REQ118_AC15_longue_ligne_apres_formatage_curseur_au_debut_ln_1_col_1", async () => {
  const { vue, zone } = await ouvrirJson(`{"a":"${"x".repeat(3000)}"}`);
  zone.vue.dispatch({ selection: { anchor: 2900 } });
  formaterParPalette();
  expect(zone.vue.state.selection.main.head).toBe(0);
  expect(vue.querySelector("footer").textContent).toContain("Ln 1, Col 1");
});

// ---- REQ-124 : Ctrl+S met à jour le fichier dans la base, seulement avec les agents ----
async function ctrlSSurNotes(options) {
  const appels = [];
  const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps, text: async () => "" });
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const chemin = String(url).split("?")[0];
    appels.push(`${init.method ?? "GET"} ${chemin}`);
    if (chemin === "/api/fichiers") return rep({ entrees: [{ nom: "notes.md", dossier: false, ignore: false }] });
    if (chemin === "/api/fichier" && init.method === "PUT") return rep({ version: "2" });
    if (chemin === "/api/fichier") return { ok: true, status: 200, text: async () => "abc", headers: { get: () => "1" } };
    if (chemin === "/api/connaissance") return rep({ config: { provider: "openai", modele: "m" }, erreur: null, collections: [], ajout: null, fichiers: { "notes.md": { collections: ["notes"], echec: null } } });
    if (chemin === "/api/connaissance/mises-a-jour") return rep({ numero: 1, total: 1 }, 202);
    if (chemin === "/api/git/etat") return rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    if (chemin === "/api/session") return { status: 204 };
    if (chemin === "/api/shells") return rep({ instance: "i1", shells: [] });
    return rep({}, 409);
  }));
  const { vue } = monter(options);
  await vi.waitFor(() => expect(ligne(vue, "notes.md")).toBeTruthy());
  ligne(vue, "notes.md").click();
  await vi.waitFor(() => expect(vue.querySelector(".zone-code")?.vue?.state.doc.toString()).toBe("abc"));
  vue.querySelector(".zone-code").vue.dispatch({ changes: { from: 0, insert: "X" } });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(appels, appels.join()).toContain("PUT /api/fichier"));
  await attendre();
  return appels;
}

test("REQ124_AC1_ctrl_s_met_a_jour_le_fichier_dans_la_base_avec_les_agents", async () => {
  const appels = await ctrlSSurNotes();
  await vi.waitFor(() => expect(appels).toContain("POST /api/connaissance/mises-a-jour"));
  expect(appels.indexOf("PUT /api/fichier")).toBeLessThan(appels.indexOf("POST /api/connaissance/mises-a-jour"));
});

test("REQ124_AC6_le_message_de_mise_a_jour_s_affiche_sans_deplacer_le_focus_ni_le_curseur_et_la_frappe_continue", async () => {
  const appels = await ctrlSSurNotes();
  await vi.waitFor(() => expect(appels).toContain("POST /api/connaissance/mises-a-jour"));
  const zone = document.querySelector(".zone-code:not([hidden])");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Mise à jour de notes.md dans la base de connaissance…"));
  expect(document.activeElement).toBe(zone.vue.contentDOM);
  expect(zone.vue.state.selection.main.head).toBe(0); // curseur resté où il était
  zone.vue.dispatch({ changes: { from: 0, insert: "Y" } });
  expect(zone.vue.state.doc.toString()).toBe("YXabc");
  expect(document.activeElement).toBe(zone.vue.contentDOM);
});

test("REQ124_AC2_agents_desactives_ctrl_s_ne_touche_pas_a_la_base", async () => {
  const appels = await ctrlSSurNotes({ reglages: { fonctions: { agents: false } } });
  await new Promise((r) => setTimeout(r, 50));
  expect(appels.filter((a) => a.includes("/api/connaissance"))).toEqual([]);
});

// ---- REQ-126 : « Soumettre à un agent… » ----

function serveurSoumission({ coupure = false } = {}) {
  const corps = [];
  const rep = (c, status = 200) => ({ ok: status < 400, status, json: async () => c, text: async () => "" });
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const chemin = u.split("?")[0];
    if (chemin === "/api/fichiers") return rep({ entrees: [{ nom: "a.md", dossier: false, ignore: false }, { nom: "b.md", dossier: false, ignore: false }] });
    if (chemin === "/api/git/etat") return rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    if (chemin === "/api/shells") return rep({ instance: "i1", shells: [] });
    if (chemin === "/api/agent/agents") return rep({ agents: [], erreurs: [] });
    if (chemin === "/api/agent/reglages") {
      if (coupure) throw new TypeError("réseau");
      return rep({ providers: [], profils: [{ id: "p", nom: "m", provider: "openai", modele: "x", defaut: true }] });
    }
    if (chemin === "/api/agent/messages" && opts.method === "POST") {
      corps.push(JSON.parse(opts.body));
      return rep({ conversation: "c1" }, 202);
    }
    if (chemin.startsWith("/api/agent/conversations/c1")) return rep({ entrees: [{ type: "utilisateur", texte: "Consulte `a.md`." }], etat: "termine" });
    return rep({}, 409);
  }));
  return corps;
}

test("REQ126_AC10_AC12_coupure_gardee_dans_le_dialogue_puis_onglet_actif_focus_dans_le_champ_selection_inchangee", async () => {
  const coupure = serveurSoumission({ coupure: true });
  const { vue } = monter();
  await vi.waitFor(() => expect(ligne(vue, "a.md")).toBeTruthy());
  const menu = () => {
    ligne(vue, "a.md").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    [...document.querySelectorAll("[role=menuitem]")].find((i) => i.textContent.startsWith("Soumettre")).click();
  };
  const soumettre = () => [...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Soumettre");
  menu();
  await vi.waitFor(() => expect(soumettre()).toBeTruthy());
  soumettre().click();
  await vi.waitFor(() => expect(document.querySelector("dialog [role=alert]").textContent).toContain("Connexion perdue. Réessayez au retour."));
  const agentsOuverts = () => [...vue.querySelectorAll("[role=tab]")].filter((t) => t.textContent === "Agent 1");
  expect(agentsOuverts()).toHaveLength(0);
  expect(document.activeElement).toBe(soumettre());
  // Retour de la connexion.
  const corps = serveurSoumission();
  soumettre().click();
  await vi.waitFor(() => expect(document.querySelector("dialog")).toBeNull());
  await vi.waitFor(() => expect(corps.length).toBe(1));
  expect(corps[0].texte).toBe("Consulte `a.md`.");
  expect(coupure).toEqual([]);
  expect(agentsOuverts()).toHaveLength(1);
  expect(agentsOuverts()[0].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement.labels?.[0]?.textContent).toBe("Message à l'agent");
  expect(document.activeElement.value).toBe("");
  expect(ligne(vue, "a.md").getAttribute("aria-selected")).toBe("true");
});

// ---- REQ-172 : les messages de la vue principale sont des toasts ----

const textesToasts = (vue) => [...vue.querySelectorAll(".ya-toasts .ya-toast")].map((t) => t.querySelector(".message-texte").textContent);

test("REQ172_AC1_deux_messages_dans_la_zone_des_toasts_le_plus_recent_en_bas_rien_au_dessus_des_onglets", async () => {
  simulerServeur(ETAT_GIT([]));
  const { vue } = monter({ reglages: { illisible: true }, couleursIllisibles: true });
  await vi.waitFor(() => expect(textesToasts(vue)).toEqual([TEXTE_IF, TEXTE_MD]));
  expect(vue.querySelector(".cadre-bandeaux")).toBeNull();
  expect(vue.querySelector("main .ya-toast")).toBeNull();
});

test("REQ172_AC2_AC10_coupure_toast_fort_sans_Fermer_texte_allonge_a_Ctrl_S_garde_parmi_quatre_erreurs_retire_au_retour", () =>
  avecHorloge(async () => {
    let coupe = false;
    simulerServeur(ETAT_GIT([]));
    const base = fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url) === "/api/session") {
        if (coupe) throw new Error("coupé");
        return { status: 204 };
      }
      if (init?.method === "PUT") return jsonOk({ version: "2" });
      return base(url, init);
    }));
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(10);
    ligne(vue, "main.rs").click();
    await vi.advanceTimersByTimeAsync(50);
    const code = vue.querySelector(".zone-code").vue;
    code.dispatch({ changes: { from: 0, insert: "x" } });
    const coupure = () => vue.querySelector(".ya-toast[data-cause=connexion]");
    expect(coupure()).toBeNull();
    coupe = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(coupure().querySelector(".message-texte").textContent).toBe("Connexion perdue. Modifications gardées.");
    expect(coupure().getAttribute("role")).toBe("alert");
    expect(coupure().querySelector("button")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(coupure().querySelector(".message-texte").textContent).toBe("Connexion perdue. Modifications gardées. main.rs sera sauvegardé au retour.");
    for (const n of [1, 2, 3, 4]) afficher({ texte: `Erreur ${n}`, variante: "erreur" });
    await vi.advanceTimersByTimeAsync(50);
    expect(textesToasts(vue)).toEqual(["Connexion perdue. Modifications gardées. main.rs sera sauvegardé au retour.", "Erreur 2", "Erreur 3", "Erreur 4"]);
    coupe = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(coupure()).toBeNull();
    expect(textesToasts(vue)).toEqual(["Erreur 2", "Erreur 3", "Erreur 4"]);
  }));

test("REQ172_AC5_Fermer_du_dernier_toast_rend_le_focus_a_l_editeur_actif_sinon_a_Ouvrir_un_fichier", async () => {
  simulerServeur(ETAT_GIT([]));
  const { vue } = monter();
  await attendre();
  afficher({ texte: "Erreur seule", variante: "erreur" });
  await attendre();
  vue.querySelector(".ya-toast button[aria-label=Fermer]").focus();
  vue.querySelector(".ya-toast button[aria-label=Fermer]").click();
  expect(document.activeElement.textContent).toBe("Ouvrir un fichier");
  ligne(vue, "main.rs").click();
  await vi.waitFor(() => expect(vue.querySelector(".cm-content")).not.toBeNull());
  afficher({ texte: "Autre erreur", variante: "erreur" });
  await attendre();
  vue.querySelector(".ya-toast button[aria-label=Fermer]").focus();
  vue.querySelector(".ya-toast button[aria-label=Fermer]").click();
  expect(document.activeElement.closest(".cm-content")).not.toBeNull();
});

// ---- REQ-069 : fichier de réglages illisible, panneau replié dès le chargement ----

test("REQ069_AC10_illisible_le_focus_va_dans_l_editeur_Fermer_retire_le_toast_il_revient_au_rechargement", async () => {
  simulerServeur(ETAT_GIT([]));
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "onglets" ? { liste: [{ chemin: "main.rs" }], actif: "main.rs" } : undefined));
  let { vue } = monter({ reglages: { illisible: true } });
  await vi.waitFor(() => expect(textesToasts(vue)).toEqual([TEXTE_IF]));
  await vi.waitFor(() => expect(document.activeElement.closest(".cm-content")).not.toBeNull());
  expect(document.activeElement.closest(".ya-toasts")).toBeNull();
  vue.querySelector(".ya-toast button[aria-label=Fermer]").click();
  expect(textesToasts(vue)).toEqual([]);
  vues_detruire(vue);
  ({ vue } = monter({ reglages: { illisible: true } }));
  await vi.waitFor(() => expect(textesToasts(vue)).toEqual([TEXTE_IF]));
  vues_detruire(vue);
  ({ vue } = monter({ reglages: {} }));
  await attendre();
  await attendre();
  expect(textesToasts(vue)).toEqual([]);
});

function vues_detruire(vue) {
  vue.detruire();
  document.body.replaceChildren();
}

test("REQ069_AC11_replis_panneau_vrai_garde_deplie_le_panneau_n_est_jamais_affiche_pendant_le_chargement", async () => {
  largeur(1280);
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "replis" ? { panneau: false } : undefined));
  const { vue } = monter({ reglages: { replis: { panneau: true } } });
  const panneau = aside(vue);
  const affichages = [];
  new MutationObserver(() => affichages.push(panneau.hidden)).observe(panneau, { attributes: true, attributeFilter: ["hidden"] });
  expect(panneau.hidden).toBe(true);
  await attendre();
  await attendre();
  await new Promise((r) => setTimeout(r, 50));
  expect(panneau.hidden).toBe(true);
  expect(affichages).not.toContain(false);
});

// ---- T-411 : toasts des agents déclenchés (REQ-173) ----

/** Serveur simulé du journal : `s.numero` part du dernier numéro des entrées initiales ; il est le numéro du moment, `s.entrees` les entrées, `s.coupe` coupe la route. */
function simulerJournal(entrees = []) {
  const s = { numero: entrees.at(-1)?.numero ?? 0, entrees, coupe: false, appels: [] };
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u === "/api/session") return { status: 204 };
    if (u.startsWith("/api/git/etat")) return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [] });
    if (u.startsWith("/api/agent/declenchements")) {
      s.appels.push(u);
      if (s.coupe) throw new TypeError("coupure");
      const depuis = u.includes("depuis=") ? Number(u.split("depuis=")[1]) : null;
      return jsonOk({ numero: s.numero, entrees: depuis === null ? [] : s.entrees.filter((e) => e.numero > depuis) });
    }
    return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
  }));
  const ajouter = (agent, sorte, evenement, phrase) => {
    s.numero += 1;
    s.entrees.push({ numero: s.numero, agent, sorte, evenement, ...(phrase ? { phrase } : {}) });
  };
  return { s, ajouter };
}

const toastsAgents = (vue) => [...vue.querySelectorAll(".ya-toasts > *")].map((m) => ({ role: m.getAttribute("role"), texte: m.querySelector(".message-texte").textContent, boutons: [...m.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent) }));
const EVT = "fichier `docs/a.md` modifié";

test("REQ173_AC1_AC6_la_relecture_toutes_les_3_s_montre_le_debut_puis_la_fin", () =>
  avecHorloge(async () => {
    const { ajouter } = simulerJournal();
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(50);
    const focus = document.activeElement;
    ajouter("Relecteur", "debut", EVT);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(50);
    expect(toastsAgents(vue)).toEqual([{ role: "status", texte: "Relecteur démarre : fichier `docs/a.md` modifié.", boutons: ["Fermer"] }]);
    ajouter("Relecteur", "fin", EVT);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(50);
    expect(toastsAgents(vue).map((t) => [t.role, t.texte])).toEqual([
      ["status", "Relecteur démarre : fichier `docs/a.md` modifié."],
      ["status", "Relecteur a terminé : fichier `docs/a.md` modifié."],
    ]);
    expect(document.activeElement).toBe(focus);
  }));

test("REQ173_AC2_AC6_une_fin_en_erreur_reste_en_alerte", () =>
  avecHorloge(async () => {
    const { ajouter } = simulerJournal();
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(50);
    ajouter("Relecteur", "erreur", EVT);
    await vi.advanceTimersByTimeAsync(3050);
    expect(toastsAgents(vue)).toEqual([{ role: "alert", texte: "Relecteur s'est arrêté avant la fin : fichier `docs/a.md` modifié.", boutons: ["Fermer"] }]);
    await vi.advanceTimersByTimeAsync(30000);
    expect(toastsAgents(vue)).toHaveLength(1);
  }));

test("REQ173_AC3_AC6_un_refus_donne_un_seul_toast_d_erreur", () =>
  avecHorloge(async () => {
    const { ajouter } = simulerJournal();
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(50);
    ajouter("Relecteur", "refus", EVT, "Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM.");
    await vi.advanceTimersByTimeAsync(3050);
    expect(toastsAgents(vue)).toEqual([{ role: "alert", texte: "Relecteur n'a pas pu démarrer : Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM.", boutons: ["Fermer"] }]);
  }));

test("REQ173_AC4_deux_agents_dans_l_ordre_d_arrivee_et_dossier", () =>
  avecHorloge(async () => {
    const { ajouter } = simulerJournal();
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(50);
    ajouter("Relecteur", "debut", "changements dans le dossier `docs/`");
    ajouter("Testeur", "debut", "changements dans le dossier `docs/`");
    await vi.advanceTimersByTimeAsync(3050);
    expect(toastsAgents(vue).map((t) => t.texte)).toEqual([
      "Relecteur démarre : changements dans le dossier `docs/`.",
      "Testeur démarre : changements dans le dossier `docs/`.",
    ]);
  }));

test("REQ173_AC6_un_evenement_de_120_caracteres_est_coupe_a_80", () =>
  avecHorloge(async () => {
    const { ajouter } = simulerJournal();
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(50);
    ajouter("Relecteur", "debut", `${"x".repeat(80)}…`); // ce que le serveur envoie pour 120 caractères
    await vi.advanceTimersByTimeAsync(3050);
    expect(toastsAgents(vue)[0].texte).toBe(`Relecteur démarre : ${"x".repeat(80)}….`);
  }));

test("REQ173_AC5_le_chargement_prend_le_numero_sans_rien_afficher_et_la_coupure_reprend_au_retour", () =>
  avecHorloge(async () => {
    const { s, ajouter } = simulerJournal([{ numero: 1, agent: "Relecteur", sorte: "debut", evenement: EVT }]);
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(50);
    expect(toastsAgents(vue)).toEqual([]);
    expect(s.appels[0]).toBe("/api/agent/declenchements");
    await vi.advanceTimersByTimeAsync(3050);
    expect(s.appels.at(-1)).toBe("/api/agent/declenchements?depuis=1");
    expect(toastsAgents(vue)).toEqual([]);
    s.coupe = true;
    ajouter("Relecteur", "fin", EVT);
    await vi.advanceTimersByTimeAsync(3050);
    s.coupe = false;
    await vi.advanceTimersByTimeAsync(3050);
    expect(s.appels.at(-1)).toBe("/api/agent/declenchements?depuis=1");
    expect(toastsAgents(vue).map((t) => t.texte)).toEqual(["Relecteur a terminé : fichier `docs/a.md` modifié."]);
  }));

test("REQ173_la_fonction_agents_desactivee_ne_relit_pas_le_journal", () =>
  avecHorloge(async () => {
    const { s } = simulerJournal();
    monter({ reglages: { fonctions: { agents: false } } });
    await vi.advanceTimersByTimeAsync(6100);
    expect(s.appels).toEqual([]);
  }));

// ---- REQ-177 : « Exporter en PDF » de Ctrl+P ----
function serveurNotes(contenu = "# Titre\n\nDu **gras**.") {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u === "/api/chemins") return jsonOk({ chemins: ["docs/notes.md", "plan.jdiag"] });
    if (u === "/api/git/etat") return jsonOk({ branche: "main", detachee: false, branches: ["main"], changements: [] });
    if (u.startsWith("/api/fichiers?")) return jsonOk({ entrees: [] });
    if (u === "/api/session") return { status: 204 };
    if (u === "/api/agent/reglages") return jsonOk({ providers: [], profils: [] });
    if (u.startsWith("/api/fichier?chemin=docs")) return { ok: true, status: 200, text: async () => contenu, headers: { get: () => "v1" } };
    if (u.startsWith("/api/fichier?chemin=plan.jdiag")) return { ok: true, status: 200, text: async () => "{}", headers: { get: () => "v1" } };
    return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "absent" }) };
  }));
}

async function ouvrirNotes() {
  const { vue } = monter();
  const entree = paletteCommandes("notes");
  await vi.waitFor(() => expect(document.querySelector("dialog [role=option]")).not.toBeNull());
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(vue.querySelector(".zone-code:not([hidden])")).not.toBeNull());
  return { vue, zone: vue.querySelector(".zone-code:not([hidden])") };
}

// `produire` est la bibliothèque PDF (déjà « chargée ») ; `telechargements` recueille les noms des liens `a download`.
function simulerPdf(produire) {
  const telechargements = [];
  window.yaidePdf = { produire };
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    telechargements.push(this.download);
  });
  return telechargements;
}
const exporterParPalette = () => {
  const e = paletteCommandes(">pdf");
  e.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
};
const toastsExport = (vue) => [...vue.querySelectorAll(".ya-toasts > *")].map((m) => ({ role: m.getAttribute("role"), texte: m.querySelector(".message-texte").textContent }));

afterEach(() => {
  delete window.yaidePdf;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("REQ177_AC6_aucun_onglet_pas_de_commande_pdf", async () => {
  serveurNotes();
  const { vue } = monter();
  paletteCommandes(">pdf");
  expect(document.querySelector("dialog").textContent).toContain("Aucune commande trouvée.");
  document.querySelector("dialog input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  // Un whiteboard actif : pas d'export non plus.
  const entree = paletteCommandes("plan");
  await vi.waitFor(() => expect(document.querySelector("dialog [role=option]")).not.toBeNull());
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).startsWith("/api/fichier?chemin=plan.jdiag"))).toBe(true));
  await attendre();
  await attendre();
  expect([...vue.querySelectorAll("[role=tab]")].map((t) => t.textContent).join()).toContain("plan.jdiag");
  paletteCommandes(">pdf");
  expect(document.querySelector("dialog").textContent).toContain("Aucune commande trouvée.");
});

test("REQ177_AC7_AC9_REQ118_AC9_notes_md_propose_exporter_en_dernier_et_entree_rend_le_focus_a_l_editeur", async () => {
  serveurNotes();
  const telechargements = simulerPdf(async () => new Blob(["%PDF"]));
  const { vue, zone } = await ouvrirNotes();
  zone.vue.dispatch({ selection: { anchor: 3 } });
  paletteCommandes(">");
  expect(nomsCommandes()).toEqual(["Providers LLM", "Profils de modèle", "Configuration", "Environnements", "Exporter en PDF"]);
  const e = paletteCommandes(">pdf");
  const lignes = [...document.querySelectorAll("dialog [role=option]")];
  expect(lignes).toHaveLength(1);
  expect(lignes[0].getAttribute("aria-selected")).toBe("true");
  expect(lignes[0].querySelector("b.liste-trouve").textContent).toBe("PDF");
  e.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(zone.vue.contentDOM);
  await vi.waitFor(() => expect(telechargements).toEqual(["notes.pdf"]));
  expect(zone.vue.state.selection.main.head).toBe(3);
  expect(toastsExport(vue)).toEqual([]); // réussi : aucun message
});

test("REQ177_AC3_AC8_export_du_texte_affiche_sans_rien_changer_a_l_onglet", async () => {
  serveurNotes("abc");
  let definition;
  const telechargements = simulerPdf(async (d) => {
    definition = d;
    return new Blob(["%PDF"]);
  });
  const { zone } = await ouvrirNotes();
  zone.vue.dispatch({ changes: { from: 3, insert: " NONENREGISTRE" } });
  exporterParPalette();
  zone.vue.dispatch({ changes: { from: 0, insert: "APRES " } }); // tapé juste après Entrée
  await vi.waitFor(() => expect(telechargements).toEqual(["notes.pdf"]));
  const texte = JSON.stringify(definition);
  expect(texte).toContain("abc NONENREGISTRE");
  expect(texte).not.toContain("APRES");
  expect(definition.info.title).toBe("notes.md");
  expect(zone.vue.state.doc.toString()).toBe("APRES abc NONENREGISTRE");
});

test("REQ177_AC15_coupure_pendant_la_production_toast_de_coupure_rien_telecharge", async () => {
  serveurNotes();
  const telechargements = simulerPdf(async () => {
    throw new Error("connexion perdue");
  });
  const { vue } = await ouvrirNotes();
  exporterParPalette();
  await vi.waitFor(() => expect(toastsExport(vue)).toEqual([{ role: "alert", texte: "Export en PDF impossible : connexion perdue. Réessayez au retour." }]));
  expect(telechargements).toEqual([]);
});

test("REQ177_AC13_AC14_toast_d_attente_au_bout_d_une_seconde_un_seul_export_a_la_fois", async () => {
  serveurNotes();
  let finir;
  const produire = vi.fn(() => new Promise((r) => (finir = () => r(new Blob(["%PDF"])))));
  const telechargements = simulerPdf(produire);
  const { vue } = await ouvrirNotes();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  exporterParPalette();
  await vi.advanceTimersByTimeAsync(900);
  expect(toastsExport(vue)).toEqual([]);
  await vi.advanceTimersByTimeAsync(200);
  await vi.waitFor(() => expect(toastsExport(vue)).toEqual([{ role: "status", texte: "Export de notes.md en PDF…" }]));
  await vi.advanceTimersByTimeAsync(10000);
  expect(toastsExport(vue)).toHaveLength(1); // reste au-delà de 6 s
  exporterParPalette(); // AC-177-14 : rien de plus ne part
  expect(document.querySelector("dialog")).toBeNull();
  finir();
  await vi.advanceTimersByTimeAsync(10);
  expect(produire).toHaveBeenCalledTimes(1);
  expect(telechargements).toEqual(["notes.pdf"]);
  expect(toastsExport(vue)).toEqual([]);
});

test("REQ177_AC13_sa_croix_retire_le_toast_sans_arreter_l_export", async () => {
  serveurNotes();
  let finir;
  const telechargements = simulerPdf(() => new Promise((r) => (finir = () => r(new Blob(["%PDF"])))));
  const { vue } = await ouvrirNotes();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  exporterParPalette();
  await vi.advanceTimersByTimeAsync(1100);
  vue.querySelector(".ya-toasts button[aria-label=Fermer]").click();
  expect(toastsExport(vue)).toEqual([]);
  finir();
  await vi.advanceTimersByTimeAsync(10);
  expect(telechargements).toEqual(["notes.pdf"]);
});

test("REQ177_AC15_coupure_bibliotheque_pas_chargee_puis_reessai_et_autre_echec", async () => {
  serveurNotes();
  const { vue, zone } = await ouvrirNotes();
  // Bibliothèque absente et réseau coupé : le script ne se charge pas.
  const ajout = vi.spyOn(document.head, "append").mockImplementation((s) => queueMicrotask(() => s.onerror()));
  exporterParPalette();
  await vi.waitFor(() => expect(toastsExport(vue).map((t) => t.role)).toEqual(["alert"]));
  await vi.waitFor(() => expect(toastsExport(vue)[0].texte).toBe("Export en PDF impossible : connexion perdue. Réessayez au retour."));
  expect(document.activeElement).toBe(zone.vue.contentDOM);
  ajout.mockRestore();
  // Autre échec : la raison, sans le nom d'onglet que `pdf.js` y met.
  simulerPdf(async () => {
    throw new Error("notes.md : police absente.");
  });
  exporterParPalette();
  await vi.waitFor(() => expect(toastsExport(vue)[0].texte).toBe("Export en PDF impossible : police absente. Réessayez."));
  expect(toastsExport(vue)).toHaveLength(1);
  // Retour de la connexion : l'export réussit et le toast part.
  const telechargements = simulerPdf(async () => new Blob(["%PDF"]));
  exporterParPalette();
  await vi.waitFor(() => expect(telechargements).toEqual(["notes.pdf"]));
  await vi.waitFor(() => expect(toastsExport(vue)).toEqual([]));
});

// ---- REQ-184 : session opencode avec un environnement ----

/** `simulerOpencode` plus la liste des environnements et la création de session sur le serveur de `prod` (`creationProd` : { status, corps } ou une promesse d'elle). */
function simulerOpencodeEnv({ creationProd = { status: 200, corps: { data: { id: "ses_prod" } } } } = {}) {
  const appels = simulerOpencode();
  vi.stubGlobal("EventSource", class { constructor(url) { appels.push(`FLUX ${url}`); } close() {} });
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = String(url).split("?")[0];
    if (chemin === "/api/environnements") {
      appels.push("GET /api/environnements");
      return jsonOk({ fichier: "environnements.json", environnements: [{ nom: "prod", variables: { YA_ENV: "prod" } }, { nom: "Dev", variables: {} }] });
    }
    if (chemin === "/api/opencode/env/prod/api/session" && opts.method === "POST") {
      appels.push(`POST ${chemin} ${opts.body}`);
      const c = await creationProd;
      return { ok: c.status < 400, status: c.status, json: async () => c.corps, text: async () => JSON.stringify(c.corps) };
    }
    if (chemin.startsWith("/api/opencode/env/prod/api/")) {
      appels.push(`${opts.method ?? "GET"} ${chemin}`);
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
    }
    return base(url, opts);
  }));
  return appels;
}

const menuOc = () => document.querySelector("[role=menu]");
const choixMenu = () => [...document.querySelectorAll("[role=menuitem]")];
const clicDroitOc = (b) => b.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

test("REQ184_AC1_AC2_AC8_AC9_menu_d_opencode_session_sur_le_serveur_de_prod_onglet_opencode_2_focus_dans_le_message", async () => {
  const appels = simulerOpencodeEnv();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  const b = boutonOcDe(vue);
  expect(b.getAttribute("aria-haspopup")).toBe("menu");
  expect(b.getAttribute("aria-expanded")).toBe("false");
  b.click();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(1));
  expect(appels.filter((a) => a.startsWith("POST /api/opencode/api/session"))).toHaveLength(1);
  // jsdom ne mesure rien : bouton à 752 px dans une fenêtre de 800, menu de 200 px de large.
  const largeur = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
  b.getBoundingClientRect = () => ({ left: 752, right: 800, top: 100, bottom: 148, width: 48, height: 48 });
  clicDroitOc(b);
  await vi.waitFor(() => expect(menuOc()).not.toBeNull());
  expect(menuOc().getAttribute("aria-label")).toBe("Nouvelle session opencode avec un environnement");
  expect(choixMenu().map((c) => c.textContent)).toEqual(["Dev", "prod"]);
  expect(b.getAttribute("aria-expanded")).toBe("true");
  // Le menu s'ouvre à gauche du bouton : son bord droit à 4 px du bord gauche du bouton (752 - 4 - 200).
  expect(menuOc().style.left).toBe("548px");
  expect(menuOc().style.top).toBe("100px");
  largeur.mockRestore();
  choixMenu()[1].click();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(2));
  expect(appels.filter((a) => a.startsWith("POST /api/opencode/env/prod/api/session "))).toHaveLength(1);
  expect(appels.filter((a) => a.startsWith("POST /api/opencode/api/session"))).toHaveLength(1);
  const o2 = ongletsOc(vue).find((t) => t.getAttribute("aria-label") === "opencode 2");
  expect(o2.getAttribute("aria-selected")).toBe("true");
  await vi.waitFor(() => expect(nomDuChamp(document.activeElement)).toBe("Message à opencode"));
  // Un flux d'événements par serveur : celui de prod s'ouvre avec son onglet.
  await vi.waitFor(() => expect(appels.filter((a) => a.startsWith("FLUX "))).toEqual(["FLUX /api/opencode/api/event", "FLUX /api/opencode/env/prod/api/event"]));
});

test("REQ184_AC8_AC9_serveur_en_demarrage_aria_busy_focus_garde_aucun_menu_et_un_second_choix_n_ouvre_rien", async () => {
  let fin;
  const appels = simulerOpencodeEnv({ creationProd: new Promise((r) => (fin = r)) });
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  const b = boutonOcDe(vue);
  b.focus();
  clicDroitOc(b);
  await vi.waitFor(() => expect(menuOc()).not.toBeNull());
  choixMenu()[1].click();
  await vi.waitFor(() => expect(b.getAttribute("aria-busy")).toBe("true"));
  expect(document.activeElement).toBe(b);
  const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  b.dispatchEvent(evt);
  clavier(b, "ContextMenu");
  clavier(b, "F10", { shiftKey: true });
  await attendre();
  expect(menuOc()).toBeNull();
  expect(evt.defaultPrevented).toBe(true);
  b.click();
  await attendre();
  fin({ status: 200, corps: { data: { id: "ses_prod" } } });
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(1));
  expect(b.hasAttribute("aria-busy") && b.getAttribute("aria-busy") === "true").toBe(false);
  expect(appels.filter((a) => a.startsWith("POST /api/opencode/env/prod/api/session "))).toHaveLength(1);
  expect(appels.filter((a) => a.startsWith("POST /api/opencode/api/session"))).toHaveLength(0);
});

test("REQ184_AC7_environnement_supprime_bandeau_et_aucun_onglet", async () => {
  simulerOpencodeEnv({ creationProd: { status: 404, corps: { message: "l'environnement prod n'existe plus" } } });
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  const b = boutonOcDe(vue);
  b.focus();
  clicDroitOc(b);
  await vi.waitFor(() => expect(menuOc()).not.toBeNull());
  choixMenu()[1].click();
  await vi.waitFor(() => expect(vue.textContent).toContain("Impossible d'ouvrir une session opencode : l'environnement prod n'existe plus."));
  expect(ongletsOc(vue).length).toBe(0);
  expect(b.getAttribute("aria-busy")).not.toBe("true");
  expect(document.activeElement).toBe(b);
});
