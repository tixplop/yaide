import { expect, test, vi } from "vitest";
import * as oc from "../opencode.js";
import { ecrire, lire } from "../stockage.js";
import { vues, monter, attendre, poignees, simulerShells, simulerServeur, ETAT_GIT, ligne, simulerRelecture, avecHorloge, barreTitre, icone, aside, repliDuPanneau, resultatsVides, agentCol, boutonAgentDe, boutonAgentsDe, champAgent, clavier, largeur, jsonOk, fauxServeur, corpsAgents, titreColonne, boutonClaudeDe, simulerTout, nomsRail, sans, simulerOpencode, boutonOcDe, ongletsOc, nomDuChamp, nomsRailDroit } from "./principale.aides.js";

vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

test("REQ039_AC1_AC2_AC3_AC6_lettre_point_et_mot_dans_l_arbre", async () => {
  simulerServeur(ETAT_GIT([{ chemin: "main.rs", statut: "modifié", indexe: false, lettre: "M" }, { chemin: "src/a.rs", statut: "nouveau", indexe: false, lettre: "U" }]));
  const { vue } = monter();
  await attendre();
  const main = ligne(vue, "main.rs");
  expect(main.querySelector(".liste-statut").textContent).toBe("M");
  expect(main.getAttribute("aria-label")).toBe("main.rs, modifié");
  const src = ligne(vue, "src");
  expect(src.querySelector(".liste-point")).not.toBeNull();
  expect(src.querySelector(".liste-statut")).toBeNull();
  expect(src.getAttribute("aria-label")).toBe("src, nouveau");
  expect(src.querySelector(".liste-point").getAttribute("aria-hidden")).toBe("true");
  const gris = ligne(vue, "gris.log");
  expect(gris.querySelector(".liste-statut")).toBeNull();
  expect(gris.querySelector(".liste-point")).toBeNull();
});

test("REQ039_AC4_hors_depot_aucune_lettre", async () => {
  simulerServeur(null);
  const { vue } = monter();
  await attendre();
  expect(ligne(vue, "main.rs")).toBeDefined();
  expect(vue.querySelector(".fichiers .liste-statut, .fichiers .liste-point")).toBeNull();
});

test("REQ037_AC7_le_rail_porte_le_nombre_de_changements_hors_du_nom_accessible", async () => {
  simulerServeur(ETAT_GIT([{ chemin: "main.rs", statut: "modifié", indexe: false, lettre: "M" }, { chemin: "src/a.rs", statut: "nouveau", indexe: false, lettre: "U" }]));
  const { vue } = monter();
  await attendre();
  const git = [...vue.querySelectorAll("[role=tab]")].find((t) => t.getAttribute("aria-label") === "Git");
  expect(git.querySelector(".ya-badge").textContent).toBe("2");
  expect(git.querySelector(".ya-badge").getAttribute("aria-hidden")).toBe("true");
});

test("REQ037_AC7_pas_de_nombre_a_zero_ni_hors_depot", async () => {
  simulerServeur(ETAT_GIT([]));
  const { vue } = monter();
  await attendre();
  expect(vue.querySelector("[role=tab][aria-label=Git] .ya-badge")).toBeNull();
  vues.forEach((v) => v.detruire());
  document.body.replaceChildren();
  simulerServeur(null);
  const autre = monter();
  await attendre();
  expect(autre.vue.querySelector("[role=tab][aria-label=Git] .ya-badge")).toBeNull();
});

test("REQ037_AC7_le_nombre_est_lu_panneau_Git_masque_et_chaque_relecture_de_l_arbre_demande_une_lecture", async () => {
  const appels = simulerServeur(ETAT_GIT([{ chemin: "main.rs", statut: "modifié", indexe: false, lettre: "M" }]));
  const { vue } = monter();
  await attendre();
  const lectures = () => appels.filter((u) => u.startsWith("/api/git/etat")).length;
  expect(vue.querySelector(".git-corps").hidden).toBe(true);
  expect(lectures()).toBe(1);
  const onglet = (nom) => [...vue.querySelectorAll("[role=tab]")].find((t) => t.getAttribute("aria-label") === nom);
  onglet("Git").click();
  await attendre();
  expect(lectures()).toBe(2); // afficher le panneau Git relit
  onglet("Fichiers").click();
  await attendre();
  expect(lectures()).toBe(3); // relire l'arbre relit l'état, une seule fois
  expect(appels.filter((u) => u.startsWith("/api/fichiers?chemin=")).length).toBe(2);
});

test("REQ009_AC9_AC10_les_quatre_boutons_sont_dans_l_en_tete_du_projet_et_non_sous_l_arbre", async () => {
  simulerServeur(ETAT_GIT([]));
  const { vue } = monter();
  await attendre();
  const entete = vue.querySelector(".fichiers-entete");
  expect(entete.firstElementChild.textContent).toBe("projet");
  expect([...entete.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Nouveau fichier", "Nouveau dossier", "Renommer", "Supprimer"]);
  expect(vue.querySelector(".fichiers-pied")).toBeNull();
  expect(vue.querySelector(".cadre-panneau-pied [aria-label='Nouveau fichier']")).toBeNull();
});

test("REQ039_AC7_la_ligne_du_fichier_actif_porte_aria_current", async () => {
  simulerServeur(ETAT_GIT([]));
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "onglets" ? { liste: [{ chemin: "main.rs" }], actif: "main.rs" } : undefined));
  const { vue } = monter();
  await vi.waitFor(() => expect(ligne(vue, "main.rs")?.getAttribute("aria-current")).toBe("true"));
  expect(ligne(vue, "gris.log").hasAttribute("aria-current")).toBe(false);
});

test("REQ039_deplier_un_dossier_relit_aussi_l_etat_git", async () => {
  const appels = simulerServeur(ETAT_GIT([]));
  const { vue } = monter();
  await attendre();
  const lectures = () => appels.filter((u) => u.startsWith("/api/git/etat")).length;
  const avant = lectures();
  ligne(vue, "src").click();
  await vi.waitFor(() => expect(lectures()).toBe(avant + 1));
});

test("REQ009_AC9_l_en_tete_du_projet_est_hors_du_corps_defilant_et_masque_avec_le_panneau", async () => {
  simulerServeur(ETAT_GIT([]));
  const { vue } = monter();
  await attendre();
  const entete = vue.querySelector(".fichiers-entete");
  expect(vue.querySelector(".cadre-panneau-corps").contains(entete)).toBe(false);
  expect(entete.hidden).toBe(false);
  [...vue.querySelectorAll("[role=tab]")].find((t) => t.getAttribute("aria-label") === "Git").click();
  expect(entete.hidden).toBe(true);
});

test("REQ015_AC10_une_lecture_git_perdue_pendant_la_coupure_est_refaite_au_retour", async () => {
  vi.useFakeTimers();
  let coupe = false;
  let lectures = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (url === "/api/session") {
        if (coupe) throw new TypeError("coupure");
        return { status: 204 };
      }
      if (url === "/api/git/etat") {
        lectures += 1;
        if (lectures === 1) throw new TypeError("coupure");
        return { ok: true, status: 200, json: async () => ({ branche: "master", detachee: false, branches: ["master"], changements: [] }) };
      }
      return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
    }),
  );
  try {
    const { vue } = monter();
    coupe = true;
    await vi.advanceTimersByTimeAsync(1600);
    expect(vue.querySelector(".git-liste .message")?.textContent).toBe("Connexion perdue. Réessayez au retour.");
    coupe = false;
    await vi.advanceTimersByTimeAsync(1600);
    expect(lectures).toBe(2);
    expect(vue.querySelector(".git-liste .message")).toBeNull();
    expect(vue.querySelector(".ya-status-branche").textContent).toBe("master");
  } finally {
    vi.useRealTimers();
  }
});

test("REQ045_AC1_AC2_toutes_les_3_s_l_arbre_et_git_sont_relus_sur_le_panneau_Fichiers", () =>
  avecHorloge(async () => {
    const s = simulerRelecture();
    monter();
    await vi.advanceTimersByTimeAsync(100);
    const [g, a] = [s.git, s.arbre];
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.git).toBe(g + 1);
    expect(s.arbre).toBe(a + 1);
  }));

test("REQ045_AC2_sur_le_panneau_Git_git_est_relu_et_l_arbre_ne_l_est_pas", () =>
  avecHorloge(async () => {
    const s = simulerRelecture();
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(100);
    [...vue.querySelectorAll("[role=tab]")].find((t) => t.getAttribute("aria-label") === "Git").click();
    await vi.advanceTimersByTimeAsync(100);
    const [g, a] = [s.git, s.arbre];
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.git).toBe(g + 1);
    expect(s.arbre).toBe(a);
  }));

test("REQ045_AC9_aucune_relecture_pendant_la_coupure_et_reprise_au_retour", () =>
  avecHorloge(async () => {
    const s = simulerRelecture();
    monter();
    await vi.advanceTimersByTimeAsync(100);
    s.coupe = true;
    await vi.advanceTimersByTimeAsync(1600);
    const [g, a] = [s.git, s.arbre];
    await vi.advanceTimersByTimeAsync(9000);
    expect([s.git, s.arbre]).toEqual([g, a]);
    s.coupe = false;
    await vi.advanceTimersByTimeAsync(1600);
    const apres = s.arbre;
    await vi.advanceTimersByTimeAsync(3100);
    expect(s.arbre).toBeGreaterThan(apres);
  }));

test("REQ045_AC11_une_relecture_de_plus_de_3_s_n_en_lance_pas_une_seconde", () =>
  avecHorloge(async () => {
    const s = simulerRelecture();
    monter();
    await vi.advanceTimersByTimeAsync(100);
    const g = s.git;
    let liberer;
    s.retenir = new Promise((r) => (liberer = r));
    await vi.advanceTimersByTimeAsync(20000);
    expect(s.git).toBe(g + 1);
    s.retenir = null;
    liberer();
    await vi.advanceTimersByTimeAsync(3100);
    expect(s.git).toBe(g + 2);
  }));

test("REQ045_plus_aucun_appel_apres_detruire", () =>
  avecHorloge(async () => {
    const s = simulerRelecture();
    const { vue } = monter();
    await vi.advanceTimersByTimeAsync(100);
    vue.detruire();
    const [g, a] = [s.git, s.arbre];
    await vi.advanceTimersByTimeAsync(10000);
    expect([s.git, s.arbre]).toEqual([g, a]);
  }));

test("REQ045_AC9_une_reponse_illisible_n_arrete_pas_la_boucle_de_relecture", () =>
  avecHorloge(async () => {
    const s = simulerRelecture();
    monter();
    await vi.advanceTimersByTimeAsync(100);
    s.casse = true;
    await vi.advanceTimersByTimeAsync(3100);
    const g = s.git;
    s.casse = false;
    await vi.advanceTimersByTimeAsync(3100);
    expect(s.git).toBe(g + 1);
  }));

test("REQ028_AC16_panneau_replie_sans_onglet_le_focus_va_sur_Ouvrir_un_fichier", async () => {
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "replis" ? { panneau: true } : undefined));
  const { vue } = monter();
  await vi.waitFor(() => expect(document.activeElement.textContent).toBe("Ouvrir un fichier"));
  expect(vue.contains(document.activeElement)).toBe(true);
});

test("REQ048_AC1_AC4_AC7_dans_les_trois_vues", async () => {
  simulerServeur(null);
  resultatsVides();
  const { vue } = monter();
  await attendre();
  const tabs = vue.querySelectorAll("[role=tab]");
  for (const [i, titre] of ["Fichiers", "Recherche", "Git"].entries()) {
    tabs[i].click();
    await attendre();
    expect(aside(vue).querySelector("h2").textContent).toBe(titre);
    const b = repliDuPanneau(vue);
    expect(b.getAttribute("aria-label"), titre).toBe("Replier le panneau");
    expect(b.textContent).toBe("");
    expect(icone(b)).toBe("panel-left-close");
    expect(b.hasAttribute("aria-pressed")).toBe(false);
    expect(b.hasAttribute("title")).toBe(false);
  }
});

test("REQ048_AC2_AC6_replier_depuis_l_en_tete", async () => {
  simulerServeur(null);
  const { vue } = monter();
  await attendre();
  repliDuPanneau(vue).click();
  expect(aside(vue).hidden).toBe(true);
  expect(poignees(vue).panneau.hidden).toBe(true);
  const b = barreTitre(vue, "Déplier le panneau");
  expect(document.activeElement).toBe(b);
  expect(b.classList.contains("ya-focus-garde")).toBe(true);
  expect(ecrire).toHaveBeenLastCalledWith("replis", { panneau: true, agent: true });
});

test("REQ048_AC3_le_rail_deplie_depuis_chaque_onglet", async () => {
  simulerServeur(null);
  const { vue } = monter();
  await attendre();
  const tabs = vue.querySelectorAll("[role=tab]");
  for (const [i, titre] of ["Fichiers", "Recherche", "Git"].entries()) {
    for (const actif of [true, false]) {
      tabs[actif ? i : (i + 1) % 3].click();
      await attendre();
      if (!actif) expect(aside(vue).querySelector("h2").textContent).not.toBe(titre);
      repliDuPanneau(vue).click();
      expect(aside(vue).hidden).toBe(true);
      tabs[i].click();
      await attendre();
      expect(aside(vue).hidden, `${titre} ${actif}`).toBe(false);
      expect(aside(vue).querySelector("h2").textContent).toBe(titre);
      expect(aside(vue).contains(document.activeElement)).toBe(true);
    }
  }
});

test("REQ048_AC10_etats_vides_et_hors_depot_gardent_le_bouton", async () => {
  simulerShells({ ids: [] });
  resultatsVides();
  const { vue } = monter();
  await attendre();
  expect(aside(vue).textContent).toContain("Dossier vide.");
  expect(repliDuPanneau(vue).getAttribute("aria-label")).toBe("Replier le panneau");
  const tabs = vue.querySelectorAll("[role=tab]");
  tabs[1].click();
  vue.querySelector("aside input").value = "zzz";
  vue.querySelector("aside input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(aside(vue).textContent).toContain("Aucun résultat"));
  expect(repliDuPanneau(vue).getAttribute("aria-label")).toBe("Replier le panneau");
  tabs[2].click();
  await vi.waitFor(() => expect(aside(vue).textContent).toContain("Ce dossier n'est pas un dépôt git."));
  expect(repliDuPanneau(vue).getAttribute("aria-label")).toBe("Replier le panneau");
});

test("REQ064_AC1_agents_deplie_et_affiche_la_liste", async () => {
  fauxServeur();
  const { vue } = monter();
  const b = boutonAgentsDe(vue);
  expect(b.querySelector("svg[data-icone=users]")).not.toBeNull();
  expect(b.hasAttribute("aria-keyshortcuts")).toBe(false);
  expect(corpsAgents(vue).hidden).toBe(false);
  expect(titreColonne(vue)).toBe("Agents");
  b.parentElement.dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(document.querySelector("[role=tooltip]").textContent).toBe("Agents"));
  b.click();
  expect(agentCol(vue).hidden).toBe(false);
  expect(agentCol(vue).getAttribute("aria-labelledby")).toBe(agentCol(vue).querySelector("h2").id);
  expect(vue.querySelector(".agent-corps")).toBeNull();
  await vi.waitFor(() => expect(corpsAgents(vue).textContent).toContain("Relecteur"));
});

test("REQ064_AC1_agents_sous_904_replie_le_panneau", () => {
  fauxServeur();
  largeur(800);
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  expect(agentCol(vue).hidden).toBe(false);
  expect(aside(vue).hidden).toBe(true);
});

test("REQ064_AC9_agent_laisse_la_colonne_sur_agents", async () => {
  fauxServeur();
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(corpsAgents(vue).querySelector("input[type=checkbox]")).not.toBeNull());
  corpsAgents(vue).querySelector("input[type=checkbox]").click();
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(1));
  expect(titreColonne(vue)).toBe("Agents");
  expect(corpsAgents(vue).hidden).toBe(false);
  expect(corpsAgents(vue).querySelector("input[type=checkbox]").checked).toBe(true);
  expect(agentCol(vue).hidden).toBe(false);
});

test("REQ059_AC2_a_depuis_les_rails_avec_la_vue_agents_affichee", async () => {
  fauxServeur();
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(corpsAgents(vue).querySelector("input[type=checkbox]")).not.toBeNull());
  let n = 0;
  for (const source of [vue.querySelector("[role=tab]"), boutonAgentsDe(vue), boutonAgentDe(vue)]) {
    source.focus();
    clavier(source, "a");
    n++;
    await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(n));
    expect(titreColonne(vue)).toBe("Agents");
    expect(document.activeElement.matches(".agent-corps textarea")).toBe(true);
  }
});

test("REQ059_AC13_filet_seulement_sur_agents", async () => {
  fauxServeur();
  const { vue } = monter();
  const actifs = () => [boutonAgentDe(vue).hasAttribute("data-actif"), boutonAgentsDe(vue).hasAttribute("data-actif")];
  expect(actifs()).toEqual([false, false]);
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(1));
  expect(actifs()).toEqual([false, false]);
  boutonAgentsDe(vue).click();
  expect(actifs()).toEqual([false, true]);
  boutonAgentDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(2));
  expect(actifs()).toEqual([false, true]);
  vue.querySelector("[aria-label=\"Replier l'agent\"]").click();
  expect(actifs()).toEqual([false, false]);
  expect(document.activeElement).toBe(boutonAgentsDe(vue));
});

test("REQ059_AC2_second_clic_sur_agents_relit_la_liste_sans_replier", async () => {
  const appels = fauxServeur();
  const { vue } = monter();
  const lectures = () => appels.filter((a) => a === "GET /api/agent/agents").length;
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(lectures()).toBe(1));
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(lectures()).toBe(2));
  expect(agentCol(vue).hidden).toBe(false);
});

test("REQ059_AC15_AC028_19_aside_nomme_agents", () => {
  fauxServeur();
  const { vue } = monter();
  const nom = () => document.getElementById(agentCol(vue).getAttribute("aria-labelledby")).textContent;
  expect(nom()).toBe("Agents");
  boutonAgentsDe(vue).click();
  expect(nom()).toBe("Agents");
  expect(vue.querySelectorAll("aside.cadre-agent")).toHaveLength(1);
});

test("REQ066_AC1_AC4_fichier_ouvert_ou_recree_puis_ouvert", async () => {
  const chemin = ".yaide/agents/relecteur/PERSONA.md";
  const appels = fauxServeur({ fichiers: { ".yaide/agents/relecteur/AGENTS.md": "Règles" } });
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelector("[aria-label=\"Modifier Relecteur\"]")).not.toBeNull());
  vue.querySelector("[aria-label=\"Modifier Relecteur\"]").click();
  const bouton = (nom) => [...corpsAgents(vue).querySelectorAll("button")].find((b) => b.textContent.includes(nom));
  bouton("AGENTS.md").click();
  await vi.waitFor(() => expect(vue.querySelector(".cm-content").textContent).toContain("Règles"));
  expect(document.activeElement.closest(".editeur-code")).not.toBeNull();
  expect(appels.some((a) => a.startsWith("POST /api/fichiers/creer"))).toBe(false);
  // Absent : créé, puis lu et ouvert.
  bouton("PERSONA.md").click();
  await vi.waitFor(() => expect(appels).toContain(`POST /api/fichiers/creer?chemin=${chemin}&type=fichier`));
  await vi.waitFor(() => expect(vue.querySelector(`[aria-label="Éditeur PERSONA.md"]`)).not.toBeNull());
  expect(appels.filter((a) => a === `GET /api/fichier?chemin=${chemin}`)).toHaveLength(2);
  expect(document.activeElement.closest(".editeur-code")).not.toBeNull();
  expect(titreColonne(vue)).toBe("Agents");
});

test("REQ066_AC1_fichier_illisible_dit_la_raison", async () => {
  fauxServeur();
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelector("[aria-label=\"Modifier Relecteur\"]")).not.toBeNull());
  vue.querySelector("[aria-label=\"Modifier Relecteur\"]").click();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ cause: "erreur", message: "Disque plein." }) })));
  [...corpsAgents(vue).querySelectorAll("button")].find((b) => b.textContent.includes("AGENTS.md")).click();
  await vi.waitFor(() => expect(vue.textContent).toContain("Impossible d'ouvrir AGENTS.md : Disque plein."));
});

test("REQ067_AC1_demarrer_ouvre_un_onglet_cases_gardees", async () => {
  fauxServeur();
  const base = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
    if (String(url) === "/api/agent/reglages") return jsonOk({ providers: [], profils: [{ id: "p", nom: "m", provider: "openai", modele: "x", defaut: true }] });
    if (String(url) === "/api/agent/conversations") return jsonOk([{ id: "c1", titre: "Une", maj: 1 }]);
    return base(url, opts);
  }));
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(corpsAgents(vue).querySelector("input[type=checkbox]")).not.toBeNull());
  corpsAgents(vue).querySelector("input[type=checkbox]").click();
  const demarrer = () => [...corpsAgents(vue).querySelectorAll("button")].find((b) => b.textContent === "Démarrer une conversation");
  demarrer().click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(1));
  // La colonne garde sa liste et sa case ; « Agents » garde son filet, « Agent » n'en prend pas.
  expect(titreColonne(vue)).toBe("Agents");
  expect(corpsAgents(vue).hidden).toBe(false);
  expect(corpsAgents(vue).querySelector("input[type=checkbox]").checked).toBe(true);
  expect(boutonAgentDe(vue).hasAttribute("data-actif")).toBe(false);
  expect(boutonAgentsDe(vue).hasAttribute("data-actif")).toBe(true);
  expect(document.activeElement).toBe(champAgent(vue));
  expect(vue.querySelector("[role=list][aria-label=\"Agents de la conversation\"]").textContent).toContain("Relecteur");
  champAgent(vue).value = "Bonjour";
  champAgent(vue).dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(vue.querySelector("[aria-label=Envoyer]").disabled).toBe(false));
  await vi.waitFor(() => expect(vue.querySelector("[aria-label=Conversations]").disabled).toBe(false));
  // Un second « Démarrer » ouvre un second onglet.
  demarrer().click();
  await vi.waitFor(() => expect(vue.querySelectorAll(".agent-corps")).toHaveLength(2));
});

test("REQ028_AC8_ordre_de_tab_avec_agents", async () => {
  fauxServeur();
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(vue.querySelector("[aria-label=\"Modifier Relecteur\"]")).not.toBeNull());
  const liste = [...vue.querySelectorAll("button, textarea, input, [tabindex='0'], [role=separator]")].filter((e) => !e.closest("[hidden]") && e.tabIndex >= 0);
  const i = liste.indexOf(vue.querySelector(".poignee-agent"));
  expect(i).toBeGreaterThan(-1);
  expect(liste[i + 1]).toBe(vue.querySelector("[aria-label=\"Replier l'agent\"]"));
  const apres = liste.slice(i + 1);
  expect(apres.slice(-2)).toEqual([boutonAgentDe(vue), boutonAgentsDe(vue)]);
  // Entre la poignée et les deux boutons : la vue affichée seule.
  expect(apres.some((e) => e.closest(".agent-corps"))).toBe(false);
  expect(apres.some((e) => e.closest(".agents-corps"))).toBe(true);
});

test("REQ069_AC3_colonne_depliee_sans_prendre_le_focus", async () => {
  fauxServeur();
  vi.mocked(lire).mockImplementation(async (cle) => ({ replis: { panneau: false, agent: false } })[cle]);
  const { vue } = monter();
  await vi.waitFor(() => expect(corpsAgents(vue).textContent).toContain("Relecteur"));
  expect(agentCol(vue).hidden).toBe(false);
  expect(titreColonne(vue)).toBe("Agents");
  expect(boutonAgentsDe(vue).hasAttribute("data-actif")).toBe(true);
  expect(agentCol(vue).contains(document.activeElement)).toBe(false);
  await attendre();
});

test("REQ070_AC1_git_desactive_sans_onglet_ni_statut_ni_requete_git", () =>
  avecHorloge(async () => {
    const appels = simulerTout();
    const { vue } = monter({ reglages: { fonctions: { git: false } } });
    await vi.advanceTimersByTimeAsync(7000);
    expect(nomsRail(vue)).toEqual(["Fichiers", "Recherche"]);
    expect(sans(appels, "/api/git")).toEqual([]);
    expect(sans(appels, "/api/fichiers").length).toBeGreaterThan(1); // l'arbre est toujours relu
    expect(vue.querySelector("header").textContent).toBe("projet");
    expect(vue.querySelector(".ya-status-branche").hidden).toBe(true);
    expect(vue.querySelector(".cadre-rail-onglets .ya-badge")).toBeNull();
    const tab = vue.querySelector("[role=tab]");
    tab.focus();
    clavier(tab, "g");
    expect(vue.querySelector("aside h2").textContent).toBe("Fichiers");
  }));

test("REQ070_AC2_recherche_desactivee_sans_onglet_ni_touche", async () => {
  simulerTout();
  const { vue } = monter({ reglages: { fonctions: { recherche: false } } });
  expect(nomsRail(vue)).toEqual(["Fichiers", "Git"]);
  const tab = vue.querySelector("[role=tab]");
  tab.focus();
  clavier(tab, "r");
  expect(vue.querySelector("aside h2").textContent).toBe("Fichiers");
  expect(vue.querySelector("[role=tab][aria-selected=true]").getAttribute("aria-label")).toBe("Fichiers");
  expect(vue.querySelector(".recherche")).toBeNull();
});

test("REQ070_AC3_shells_desactives_sans_commandes_ni_requete", async () => {
  const appels = simulerTout();
  const { vue } = monter({ reglages: { fonctions: { shells: false } } });
  await attendre();
  await attendre();
  expect(sans(appels, "/api/shells")).toEqual([]);
  expect(vue.querySelector(".cadre-rail-commandes")).toBeNull();
  expect(vue.querySelector(".cadre-shells")).toBeNull();
  expect(vue.querySelector("header [aria-label='Replier les shells']")).toBeNull();
  expect(vue.textContent).not.toContain("Aucun shell");
});

test("REQ070_AC5_agents_desactives_sans_colonne_ni_touche_a", async () => {
  const appels = simulerTout();
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "replis" ? { agent: false } : undefined));
  const { vue } = monter({ reglages: { fonctions: { agents: false }, replis: { agent: false } } });
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  expect([...vue.querySelectorAll(".cadre-rail-droit button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Claude"]);
  expect(agentCol(vue)).toBeNull();
  expect(sans(appels, "/api/agent")).toEqual([]);
  for (const b of [vue.querySelector("[role=tab]"), boutonClaudeDe(vue)]) {
    b.focus();
    clavier(b, "a");
    expect(document.activeElement).toBe(b);
  }
  expect(agentCol(vue)).toBeNull();
  expect(vue.querySelector("[aria-label='Replier l\\'agent']")).toBeNull();
  // Le repli gardé de l'agent n'est pas écrasé par un autre repli.
  vue.querySelector("header [aria-label='Replier le panneau']").click();
  expect(ecrire).toHaveBeenLastCalledWith("replis", expect.objectContaining({ panneau: true, agent: false }));
});

test("REQ070_AC6_claude_desactive_sans_detection", async () => {
  const appels = simulerTout();
  const { vue } = monter({ reglages: { fonctions: { claude: false } } });
  await attendre();
  await attendre();
  expect(sans(appels, "/api/claude")).toEqual([]);
  expect(boutonClaudeDe(vue)).toBeNull();
  expect([...vue.querySelectorAll(".cadre-rail-droit button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Agent", "Agents"]);
});

test("REQ070_AC7_rail_droit_absent_sans_commande_meme_sans_claude", async () => {
  simulerTout({ claude: false });
  const { vue } = monter({ reglages: { fonctions: { agents: false } } });
  await attendre();
  await attendre();
  expect(vue.querySelector(".cadre-rail-droit")).toBeNull();
});

test("REQ070_AC8_tout_desactive_fichiers_seul", () =>
  avecHorloge(async () => {
    const appels = simulerTout();
    const { vue } = monter({ reglages: { fonctions: { recherche: false, git: false, shells: false, agents: false, claude: false } } });
    await vi.advanceTimersByTimeAsync(7000);
    expect(nomsRail(vue)).toEqual(["Fichiers"]);
    expect(vue.querySelector(".cadre-rail-droit")).toBeNull();
    expect(vue.querySelector(".cadre-shells")).toBeNull();
    expect(agentCol(vue)).toBeNull();
    expect(appels.filter((a) => !a.includes("/api/fichiers") && !a.includes("/api/session"))).toEqual(["GET /api/opencode"]); // aucune fonction ne retire « opencode »
    // Le panneau affiche Fichiers.
    expect(vue.querySelector("aside h2").textContent).toBe("Fichiers");
  }));

test("REQ070_AC11_ordre_de_tab_sans_les_fonctions_absentes", async () => {
  simulerTout();
  const { vue } = monter({ reglages: { fonctions: { recherche: false, git: false, shells: false, agents: false } } });
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  const arrets = [...vue.querySelectorAll("button, [role=tab], [tabindex]")].filter((e) => e.tabIndex >= 0 && !e.closest("[hidden]"));
  const noms = arrets.map((e) => e.getAttribute("aria-label")).filter(Boolean);
  expect(noms.slice(0, 4)).toEqual(["Ouverture rapide", "Replier le panneau", "Thème clair", "Déconnexion"]);
  expect(noms).not.toContain("Recherche");
  expect(noms).not.toContain("Git");
  expect(noms).not.toContain("Agent");
  expect(noms.some((n) => n.includes("shell"))).toBe(false);
  expect(noms.at(-1)).toBe("Claude");
});

test("REQ070_vue_gardee_absente_retombe_sur_fichiers", async () => {
  simulerTout();
  // La vue affichée n'est pas enregistrée : le panneau démarre toujours sur Fichiers, seule vue restante.
  const { vue } = monter({ reglages: { fonctions: { git: false, recherche: false } } });
  await attendre();
  expect(vue.querySelector("[role=tab][aria-selected=true]").getAttribute("aria-label")).toBe("Fichiers");
  expect(vue.querySelector("aside h2").textContent).toBe("Fichiers");
  expect(vue.querySelector(".fichiers").hidden).toBe(false);
});

test("REQ072_AC1_bouton_selon_la_detection", async () => {
  simulerOpencode();
  const a = monter().vue;
  await vi.waitFor(() => expect(boutonOcDe(a)).not.toBeNull());
  expect(nomsRailDroit(a)).toEqual(["Agent", "Agents", "Claude", "opencode"]);
  expect(icone(boutonOcDe(a))).toBe("code-xml");
  simulerOpencode({ opencode: false });
  const b = monter().vue;
  await vi.waitFor(() => expect(boutonClaudeDe(b)).not.toBeNull());
  expect(boutonOcDe(b)).toBeNull();
  expect(nomsRailDroit(b)).toEqual(["Agent", "Agents", "Claude"]);
});

test("REQ072_AC3_clic_ouvre_un_onglet", async () => {
  const appels = simulerOpencode();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  boutonOcDe(vue).click();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(1));
  expect(appels).toContain('POST /api/opencode/api/session {"location":{"directory":"/home/x/projet"}}');
  expect(ongletsOc(vue)[0].getAttribute("aria-selected")).toBe("true");
  expect(ongletsOc(vue)[0].title).toBe("opencode dans /home/x/projet");
  expect(nomDuChamp(document.activeElement)).toBe("Message à opencode");
  expect(boutonOcDe(vue).hasAttribute("aria-busy")).toBe(false);
  boutonOcDe(vue).click();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(2));
  expect(appels.filter((a) => a.startsWith("POST /api/opencode/api/session")).length).toBe(2);
  expect(ongletsOc(vue).map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  expect(ongletsOc(vue)[1].getAttribute("aria-label")).toBe("opencode 2");
});

test("REQ072_AC30_second_clic_pendant_le_lancement_ignore", async () => {
  let liberer;
  const appels = simulerOpencode({ creation: () => new Promise((r) => { liberer = () => r({ status: 200, corps: { data: { id: "ses_1" } } }); }) });
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  boutonOcDe(vue).focus();
  boutonOcDe(vue).click();
  expect(boutonOcDe(vue).getAttribute("aria-busy")).toBe("true");
  expect(boutonOcDe(vue).getAttribute("aria-disabled")).toBe("true");
  boutonOcDe(vue).click();
  expect(document.activeElement).toBe(boutonOcDe(vue));
  liberer();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(1));
  expect(appels.filter((a) => a.startsWith("POST /api/opencode/api/session")).length).toBe(1);
  expect(boutonOcDe(vue).hasAttribute("aria-busy")).toBe(false);
});

test("REQ075_AC3_AC11_reprise_avant_l_onglet_et_occupe_pendant", async () => {
  simulerOpencode();
  let liberer;
  const reprise = vi.spyOn(oc, "reprendreDernierChoix").mockImplementation(() => new Promise((r) => { liberer = r; }));
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  boutonOcDe(vue).click();
  await vi.waitFor(() => expect(reprise).toHaveBeenCalledWith("ses_1"));
  expect(ongletsOc(vue).length).toBe(0);
  expect(boutonOcDe(vue).getAttribute("aria-busy")).toBe("true");
  boutonOcDe(vue).click();
  expect(reprise).toHaveBeenCalledTimes(1);
  liberer();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(1));
  expect(boutonOcDe(vue).hasAttribute("aria-busy")).toBe(false);
  reprise.mockRestore();
});

test("REQ075_AC12_aucun_bandeau", async () => {
  simulerOpencode();
  const reprise = vi.spyOn(oc, "reprendreDernierChoix").mockResolvedValue(undefined);
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  await attendre();
  const avant = vue.querySelectorAll("[role=alert]").length;
  boutonOcDe(vue).click();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(1));
  expect(vue.querySelectorAll("[role=alert]").length).toBe(avant);
  reprise.mockRestore();
});

test("REQ072_AC13_coupure_et_503_aucun_onglet", async () => {
  simulerOpencode({ creation: null });
  const a = monter().vue;
  await vi.waitFor(() => expect(boutonOcDe(a)).not.toBeNull());
  boutonOcDe(a).click();
  await vi.waitFor(() => expect(a.textContent).toContain("Connexion perdue. Réessayez au retour."));
  expect(ongletsOc(a).length).toBe(0);
  simulerOpencode({ creation: { status: 503, corps: "opencode a quitté\n" } });
  const b = monter().vue;
  await vi.waitFor(() => expect(boutonOcDe(b)).not.toBeNull());
  boutonOcDe(b).click();
  await vi.waitFor(() => expect(b.textContent).toContain("Impossible d'ouvrir une session opencode : opencode a quitté."));
  expect(ongletsOc(b).length).toBe(0);
});

test("REQ072_AC16_shells_et_compteur_inchanges", async () => {
  const appels = simulerOpencode();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  await attendre();
  const avant = vue.querySelector(".cadre-shells").outerHTML;
  const barreAvant = vue.querySelector("footer").outerHTML;
  const nbAvant = appels.filter((a) => a.includes("/api/shells")).length;
  boutonOcDe(vue).click();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(1));
  await attendre();
  expect(appels.filter((a) => a.startsWith("POST /api/shells"))).toEqual([]);
  expect(appels.filter((a) => a.includes("/api/shells")).length).toBe(nbAvant);
  expect(vue.querySelector(".cadre-shells").outerHTML).toBe(avant);
  expect(vue.querySelector("footer").outerHTML).toBe(barreAvant);
});

test("REQ028_AC22_touches_sur_opencode", async () => {
  simulerOpencode();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  const b = boutonOcDe(vue);
  b.focus();
  for (const k of ["f", "r", "g"]) clavier(b, k);
  expect(vue.querySelector("[role=tab][aria-label=Fichiers]").getAttribute("aria-selected")).toBe("true");
  expect(vue.querySelector("[role=tab][aria-label=Recherche]").getAttribute("aria-selected")).toBe("false");
  expect(document.activeElement).toBe(b);
  clavier(b, "a");
  await vi.waitFor(() => expect(document.activeElement).toBe(champAgent(vue)));
});

test("REQ028_AC8_ordre_de_tab_avec_opencode", async () => {
  simulerOpencode();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  expect(nomsRailDroit(vue)).toEqual(["Agent", "Agents", "Claude", "opencode"]);
  const rail = [...vue.querySelectorAll(".cadre-rail-droit button")];
  expect(rail.every((e) => e.tabIndex >= 0)).toBe(true);
  // Dans le document, « opencode » suit « Claude ».
  expect(boutonClaudeDe(vue).compareDocumentPosition(boutonOcDe(vue)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("REQ028_AC23_ctrl_p_et_ctrl_maj_f_sur_un_onglet_opencode", async () => {
  simulerOpencode();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonOcDe(vue)).not.toBeNull());
  boutonOcDe(vue).click();
  await vi.waitFor(() => expect(ongletsOc(vue).length).toBe(1));
  expect(nomDuChamp(document.activeElement)).toBe("Message à opencode");
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "F", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(vue.querySelector("[role=tab][aria-selected=true][aria-label=Fichiers]"));
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect([...document.querySelectorAll("input")].some((i) => nomDuChamp(i) === "Chemin du fichier")).toBe(true));
});

test("REQ070_AC20_agents_ou_claude_desactives_avec_opencode", async () => {
  simulerOpencode();
  const a = monter({ reglages: { fonctions: { claude: false } } }).vue;
  await vi.waitFor(() => expect(boutonOcDe(a)).not.toBeNull());
  expect(nomsRailDroit(a)).toEqual(["Agent", "Agents", "opencode"]);
  const b = monter({ reglages: { fonctions: { agents: false, claude: false } } }).vue;
  await vi.waitFor(() => expect(boutonOcDe(b)).not.toBeNull());
  expect(nomsRailDroit(b)).toEqual(["opencode"]);
  expect(b.querySelector(".cadre-rail-droit")).not.toBeNull();
  const c = monter({ reglages: { fonctions: { agents: false } } }).vue;
  await vi.waitFor(() => expect(boutonOcDe(c)).not.toBeNull());
  expect(nomsRailDroit(c)).toEqual(["Claude", "opencode"]);
});

test("REQ078_AC16_demarrer_en_coupure_bandeau_sans_onglet", async () => {
  fauxServeur();
  const { vue } = monter();
  boutonAgentsDe(vue).click();
  await vi.waitFor(() => expect(corpsAgents(vue).querySelector("input[type=checkbox]")).not.toBeNull());
  corpsAgents(vue).querySelector("input[type=checkbox]").click();
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("coupé");
  }));
  [...corpsAgents(vue).querySelectorAll("button")].find((b) => b.textContent === "Démarrer une conversation").click();
  await vi.waitFor(() => expect([...vue.querySelectorAll(".cadre-bandeaux [role=alert]")].some((a) => a.textContent.includes("Réessayez au retour."))).toBe(true));
  expect(vue.querySelectorAll(".agent-corps")).toHaveLength(0);
});
