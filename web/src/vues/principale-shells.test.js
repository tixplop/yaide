import { expect, test, vi } from "vitest";
import { ecrire, lire } from "../stockage.js";
import { vues, monter, attendre, poignees, FauxWebSocket, tailles, simulerShells, bout, onglets, actifDe, zone, terminer, simulerServeur, ligne, barreTitre, icone, aside, agentCol, boutonAgentsDe, champAgent, clavier, largeur, simulerClaude, boutonClaudeDe, ongletsClaude } from "./principale.aides.js";

vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

test("REQ035_AC1_AC8_REQ040_AC8_AC13_AC15_AC16_quatre_boutons_a_icone_dans_le_rail_hors_du_tablist", () => {
  const { vue } = monter();
  const groupe = vue.querySelector(".cadre-rail-commandes");
  const boutons = [...groupe.querySelectorAll("button")];
  expect(boutons.map((b) => b.getAttribute("aria-label"))).toEqual(["Nouveau shell", "Réduire le shell", "Shells réduits", "Fermer le shell"]);
  expect(boutons.map((b) => b.textContent)).toEqual(["", "", "", ""]);
  const icones = boutons.map((b) => b.querySelector("svg").getAttribute("data-icone"));
  expect(icones).toEqual(["terminal", "minimize-2", "layers", "square-x"]);
  expect(new Set(icones).size).toBe(4);
  expect(icones).not.toContain("x");
  expect(vue.querySelector("[role=tablist]").contains(groupe)).toBe(false);
  // Aucun shell : seul « Nouveau shell » est actif.
  expect(boutons.map((b) => b.disabled)).toEqual([false, true, true, true]);
  expect(boutons[2].getAttribute("aria-haspopup")).toBe("menu");
  expect(boutons[2].getAttribute("aria-expanded")).toBe("false");
});

test("REQ040_AC1_AC8_AC20_reduire_le_shell_actif_donne_la_place_au_voisin_de_droite_sinon_de_gauche", async () => {
  simulerShells({ ids: [1, 2, 3] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toEqual(["shell 1", "shell 2", "shell 3"]));
  vue.querySelectorAll(".shells [role=tab]")[1].click();
  expect(bout(vue, "Réduire le shell").disabled).toBe(false);
  bout(vue, "Réduire le shell").click();
  expect(onglets(vue)).toEqual(["shell 1", "shell 3"]);
  expect(actifDe(vue)).toBe("shell 3");
  bout(vue, "Réduire le shell").click(); // shell 3 : le dernier onglet, celui de gauche prend la place
  expect(actifDe(vue)).toBe("shell 1");
  expect(bout(vue, "Shells réduits").disabled).toBe(false);
  expect(bout(vue, "Shells réduits").querySelector(".ya-badge").textContent).toBe("2");
  expect(bout(vue, "Shells réduits").getAttribute("aria-label")).toBe("Shells réduits");
});

test("REQ040_AC4_AC8_AC7_le_dernier_shell_visible_reduit_fait_disparaitre_la_zone_et_le_focus_va_sur_Shells_reduits", async () => {
  simulerShells({ ids: [1] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toEqual(["shell 1"]));
  expect(zone(vue).hidden).toBe(false);
  bout(vue, "Réduire le shell").focus();
  bout(vue, "Réduire le shell").click();
  expect(zone(vue).hidden).toBe(true);
  expect(poignees(vue).shells.hidden).toBe(true);
  expect(vue.querySelector(".shells [role=tablist]")).toBeNull();
  expect(vue.textContent).not.toContain("Aucun shell ouvert.");
  expect(vue.textContent).not.toContain("Ouvrir un shell");
  expect(["Réduire le shell", "Shells réduits", "Fermer le shell"].map((n) => bout(vue, n).disabled)).toEqual([true, false, true]);
  expect(document.activeElement).toBe(bout(vue, "Shells réduits"));
  expect(document.activeElement.classList.contains("ya-focus-garde")).toBe(true);
});

test("REQ040_AC3_AC16_le_menu_liste_les_shells_reduits_et_en_choisir_un_le_remet_a_sa_place", async () => {
  simulerShells({ ids: [1, 2, 3] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(3));
  vue.querySelectorAll(".shells [role=tab]")[1].click();
  bout(vue, "Réduire le shell").click();
  vue.querySelectorAll(".shells [role=tab]")[0].click();
  bout(vue, "Réduire le shell").click();
  const b = bout(vue, "Shells réduits");
  b.click();
  const menu = document.querySelector("[role=menu]");
  expect(menu.getAttribute("aria-label")).toBe("Shells réduits");
  expect(b.getAttribute("aria-expanded")).toBe("true");
  const items = [...menu.querySelectorAll("[role=menuitem]")];
  expect(items.map((i) => i.textContent)).toEqual(["shell 1", "shell 2"]);
  expect(document.activeElement).toBe(items[0]);
  items[1].click();
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(onglets(vue)).toEqual(["shell 2", "shell 3"]);
  expect(actifDe(vue)).toBe("shell 2");
  expect(document.querySelector("[role=menu]")).toBeNull();
});

test("REQ040_AC5_AC22_au_reaffichage_la_taille_est_toujours_envoyee", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(tailles(2)).toHaveLength(1));
  vue.querySelectorAll(".shells [role=tab]")[1].click();
  bout(vue, "Réduire le shell").click();
  const avant = tailles(2).length;
  bout(vue, "Shells réduits").click();
  document.querySelector("[role=menuitem]").click();
  expect(tailles(2)).toHaveLength(avant + 1);
  expect(tailles(2).at(-1)).toBe("taille 80 24");
});

test("REQ040_AC9_AC5_un_shell_garde_reduit_apres_rechargement_n_envoie_pas_de_taille_et_n_ouvre_pas_de_shell", async () => {
  const appels = simulerShells({ ids: [1, 2], precedent: { instance: "i1", nombre: 2, reduits: [1, 2] } });
  const { vue } = monter();
  await vi.waitFor(() => expect(FauxWebSocket.tous).toHaveLength(2));
  await attendre();
  expect(zone(vue).hidden).toBe(true);
  expect(onglets(vue)).toEqual([]);
  expect(appels).not.toContain("POST /api/shells");
  expect(tailles(1)).toEqual([]);
  expect(tailles(2)).toEqual([]);
  expect(bout(vue, "Shells réduits").querySelector(".ya-badge").textContent).toBe("2");
});

test("REQ040_AC9_la_poignee_reprend_la_hauteur_gardee_au_retour_de_la_zone", async () => {
  simulerShells({ ids: [1], precedent: { instance: "i1", nombre: 1, reduits: [1] } });
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "serveur" ? { instance: "i1", nombre: 1, reduits: [1] } : cle === "tailles" ? { shells: 250 } : undefined));
  const { vue } = monter();
  await attendre();
  await attendre();
  bout(vue, "Shells réduits").click();
  document.querySelector("[role=menuitem]").click();
  expect(zone(vue).hidden).toBe(false);
  expect(poignees(vue).shells.getAttribute("aria-valuenow")).toBe("250");
});

test("REQ040_AC11_un_redemarrage_vide_les_reduits_et_les_compte_dans_le_message", async () => {
  simulerShells({ ids: [1, 2, 3], instance: "i2", precedent: { instance: "i1", nombre: 3, reduits: [2] } });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toEqual(["shell 1", "shell 2", "shell 3"]));
  expect(bout(vue, "Shells réduits").disabled).toBe(true);
  expect(vue.textContent).toContain("Yaide a été arrêté. 3 shells ont été fermés.");
});

test("REQ040_AC6_ouvrir_un_shell_ne_rend_pas_un_shell_reduit", async () => {
  simulerShells({ ids: [1], precedent: { instance: "i1", nombre: 1, reduits: [1] } });
  const { vue } = monter();
  await vi.waitFor(() => expect(bout(vue, "Shells réduits").disabled).toBe(false));
  bout(vue, "Nouveau shell").click();
  await vi.waitFor(() => expect(onglets(vue)).toEqual(["shell 9"]));
  expect(bout(vue, "Shells réduits").querySelector(".ya-badge").textContent).toBe("1");
  expect(zone(vue).hidden).toBe(false);
});

test("REQ040_AC6_AC20_AC35_10_un_shell_visible_qui_se_termine_cede_la_place_au_voisin_visible_jamais_au_reduit", async () => {
  simulerShells({ ids: [1, 2, 3] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(3));
  vue.querySelectorAll(".shells [role=tab]")[1].click();
  bout(vue, "Réduire le shell").click();
  vue.querySelectorAll(".shells [role=tab]")[0].click();
  terminer(1);
  expect(onglets(vue)).toEqual(["shell 3"]);
  expect(actifDe(vue)).toBe("shell 3");
  expect(bout(vue, "Shells réduits").querySelector(".ya-badge").textContent).toBe("1");
});

test("REQ040_AC7_AC35_4_dernier_visible_termine_avec_un_reduit_la_zone_disparait_et_le_focus_va_sur_Shells_reduits", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  vue.querySelectorAll(".shells [role=tab]")[1].click();
  bout(vue, "Réduire le shell").click();
  vue.querySelector(".terminal textarea").focus();
  terminer(1);
  expect(zone(vue).hidden).toBe(true);
  expect(onglets(vue)).toEqual([]);
  expect(bout(vue, "Shells réduits").querySelector(".ya-badge").textContent).toBe("1");
  expect(document.activeElement).toBe(bout(vue, "Shells réduits"));
});

test("REQ040_AC7_la_zone_qui_disparait_ne_deplace_pas_un_focus_hors_de_la_zone", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  vue.querySelectorAll(".shells [role=tab]")[1].click();
  bout(vue, "Réduire le shell").click();
  const ailleurs = vue.querySelector("header [aria-label='Thème clair']");
  ailleurs.focus();
  terminer(1);
  expect(zone(vue).hidden).toBe(true);
  expect(document.activeElement).toBe(ailleurs);
});

test("REQ040_AC10_un_shell_reduit_qui_se_termine_laisse_le_focus_sur_l_onglet", async () => {
  simulerShells({ ids: [1, 2, 3] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(3));
  vue.querySelectorAll(".shells [role=tab]")[2].click();
  bout(vue, "Réduire le shell").click();
  vue.querySelector(".shells [role=tab]").focus();
  terminer(3);
  expect(bout(vue, "Shells réduits").disabled).toBe(true);
  expect(document.activeElement).toBe(vue.querySelector(".shells [role=tab][aria-selected=true]"));
  expect(document.activeElement.textContent).toBe("shell 2");
});

test("REQ019_AC1_sans_shell_a_l_arrivee_aucun_POST_et_la_zone_reste_cachee", async () => {
  const appels = simulerShells({ ids: [] });
  const { vue } = monter();
  expect(zone(vue).hidden).toBe(true);
  await vi.waitFor(() => expect(appels).toContain("GET /api/shells"));
  await attendre();
  expect(appels).not.toContain("POST /api/shells");
  expect(zone(vue).hidden).toBe(true);
  expect(poignees(vue).shells.hidden).toBe(true);
});

test("REQ019_AC10_sans_shell_seul_Nouveau_shell_est_actif_sans_pastille_et_le_focus_est_hors_des_terminaux", async () => {
  const appels = simulerShells({ ids: [] });
  const { vue } = monter();
  await vi.waitFor(() => expect(appels).toContain("GET /api/shells"));
  await attendre();
  expect(["Nouveau shell", "Réduire le shell", "Shells réduits", "Fermer le shell"].map((n) => bout(vue, n).disabled)).toEqual([false, true, true, true]);
  expect(bout(vue, "Nouveau shell").querySelector(".ya-badge")).toBeNull();
  expect(document.activeElement.closest(".terminal")).toBeNull();
});

test("REQ047_AC1_AC3_AC4_AC5_le_bouton_compte_tous_les_shells_reduits_compris", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  const b = bout(vue, "Nouveau shell");
  expect(b.querySelector(".ya-badge").textContent).toBe("2");
  bout(vue, "Réduire le shell").click();
  expect(b.querySelector(".ya-badge").textContent).toBe("2");
  const p = b.querySelector(".ya-badge");
  expect(p.getAttribute("aria-hidden")).toBe("true");
  expect(p.classList.contains("ya-badge-accent")).toBe(false);
  expect(b.getAttribute("aria-label")).toBe("Nouveau shell");
  b.enveloppe.dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(document.querySelector("[role=tooltip]").textContent).toBe("Nouveau shell"));
});

test("REQ047_AC2_ouvrir_ajoute_un_et_la_fermeture_1000_retire_un", async () => {
  simulerShells({ ids: [1] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(1));
  const b = bout(vue, "Nouveau shell");
  expect(b.querySelector(".ya-badge").textContent).toBe("1");
  b.click();
  await vi.waitFor(() => expect(b.querySelector(".ya-badge").textContent).toBe("2"));
  terminer(9);
  expect(b.querySelector(".ya-badge").textContent).toBe("1");
  terminer(1);
  expect(b.querySelector(".ya-badge").hidden).toBe(true);
});

test("REQ046_AC9_AC10_etats_des_boutons_de_repli", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  // Sans shell visible : désactivé, icône et nom de repli.
  const repli = barreTitre(vue, "Replier les shells");
  expect(repli.disabled).toBe(true);
  expect(icone(repli)).toBe("panel-bottom-close");
  expect(repli.hasAttribute("aria-pressed")).toBe(false);
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  expect(repli.disabled).toBe(false);
  repli.click();
  const deplier = barreTitre(vue, "Déplier les shells");
  expect(deplier).toBe(repli);
  expect(icone(deplier)).toBe("panel-bottom-open");
  expect(zone(vue).hidden).toBe(true);
  expect(poignees(vue).shells.hidden).toBe(true);
  expect(document.activeElement).toBe(deplier);
  expect(bout(vue, "Réduire le shell").disabled).toBe(true);
  expect(bout(vue, "Fermer le shell").disabled).toBe(true);
  expect(bout(vue, "Nouveau shell").disabled).toBe(false);
  expect(bout(vue, "Nouveau shell").querySelector(".ya-badge").textContent).toBe("2");
  expect(vi.mocked(ecrire)).toHaveBeenLastCalledWith("serveur", expect.objectContaining({ replie: true, nombre: 2 }));
  deplier.click();
  expect(icone(barreTitre(vue, "Replier les shells"))).toBe("panel-bottom-close");
  expect(zone(vue).hidden).toBe(false);
  expect(onglets(vue)).toEqual(["shell 1", "shell 2"]);
  expect(bout(vue, "Réduire le shell").disabled).toBe(false);
  expect(document.activeElement.closest(".terminal")).not.toBeNull();
  expect(tailles(1).length).toBeGreaterThan(0);
});

test("REQ046_AC9_Shells_reduits_suit_son_etat_zone_repliee", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  bout(vue, "Réduire le shell").click();
  barreTitre(vue, "Replier les shells").click();
  expect(bout(vue, "Shells réduits").disabled).toBe(false);
  expect(bout(vue, "Shells réduits").querySelector(".ya-badge").textContent).toBe("1");
});

test("REQ046_AC8_Nouveau_shell_deplie_la_zone_et_un_shell_reduit_choisi_aussi", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  barreTitre(vue, "Replier les shells").click();
  bout(vue, "Nouveau shell").click();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(3));
  expect(zone(vue).hidden).toBe(false);
  expect(actifDe(vue)).toBe("shell 9");
  expect(barreTitre(vue, "Replier les shells")).not.toBeNull();
});

test("REQ046_AC11_zone_repliee_un_shell_termine_ne_deplace_pas_le_focus_et_le_repli_est_oublie_sans_shell", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  const repli = barreTitre(vue, "Replier les shells");
  repli.click();
  terminer(1);
  expect(onglets(vue)).toEqual(["shell 2"]);
  expect(document.activeElement).toBe(repli);
  expect(zone(vue).hidden).toBe(true);
  expect(document.querySelector("dialog[open], [role=dialog]")).toBeNull();
  // Le dernier shell : le repli est oublié, le bouton est grisé, le focus va sur « Nouveau shell ».
  terminer(2);
  expect(repli.disabled).toBe(true);
  expect(icone(repli)).toBe("panel-bottom-close");
  expect(document.activeElement).toBe(bout(vue, "Nouveau shell"));
  bout(vue, "Nouveau shell").click();
  await vi.waitFor(() => expect(zone(vue).hidden).toBe(false));
});

test("REQ046_AC18_le_dernier_shell_visible_se_termine_focus_sur_Replier_les_shells_va_sur_Shells_reduits", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  vue.querySelectorAll(".shells [role=tab]")[1].click();
  bout(vue, "Réduire le shell").click();
  const repli = barreTitre(vue, "Replier les shells");
  repli.focus();
  terminer(1);
  expect(repli.disabled).toBe(true);
  expect(document.activeElement).toBe(bout(vue, "Shells réduits"));
});

test("REQ046_AC12_le_repli_est_garde_pour_la_meme_instance_et_oublie_pour_une_autre", async () => {
  simulerShells({ ids: [1], precedent: { instance: "i1", nombre: 1, reduits: [], replie: true } });
  let { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(1));
  expect(zone(vue).hidden).toBe(true);
  expect(barreTitre(vue, "Déplier les shells")).not.toBeNull();
  vues.forEach((v) => v.detruire());
  document.body.replaceChildren();
  simulerShells({ ids: [1], instance: "i2", precedent: { instance: "i1", nombre: 1, reduits: [], replie: true } });
  ({ vue } = monter());
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(1));
  expect(zone(vue).hidden).toBe(false);
  expect(barreTitre(vue, "Replier les shells")).not.toBeNull();
});

test("REQ046_AC12_le_panneau_replie_est_garde_et_relu_au_montage", async () => {
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "replis" ? { panneau: true } : undefined));
  const { vue } = monter();
  await vi.waitFor(() => expect(aside(vue).hidden).toBe(true));
  expect(poignees(vue).panneau.hidden).toBe(true);
  expect(barreTitre(vue, "Déplier le panneau")).not.toBeNull();
  vues.forEach((v) => v.detruire());
  document.body.replaceChildren();
  vi.mocked(lire).mockImplementation(async () => undefined);
  const autre = monter();
  await attendre();
  expect(aside(autre.vue).hidden).toBe(false);
});

test("REQ046_AC1_AC2_AC12_replier_et_deplier_le_panneau_ecrit_replis_garde_la_vue_et_relit_l_arbre", async () => {
  const appels = simulerServeur(null);
  const { vue } = monter();
  await attendre();
  const b = barreTitre(vue, "Replier le panneau");
  expect(icone(b)).toBe("panel-left-close");
  expect(b.hasAttribute("aria-pressed")).toBe(false);
  b.click();
  expect(aside(vue).hidden).toBe(true);
  expect(icone(b)).toBe("panel-left-open");
  expect(b.getAttribute("aria-label")).toBe("Déplier le panneau");
  expect(document.activeElement).toBe(b);
  expect(ecrire).toHaveBeenLastCalledWith("replis", { panneau: true, agent: true });
  const avant = appels.filter((u) => u.startsWith("/api/fichiers")).length;
  b.click();
  expect(aside(vue).hidden).toBe(false);
  expect(ecrire).toHaveBeenLastCalledWith("replis", { panneau: false, agent: true });
  expect(document.activeElement).toBe(vue.querySelector(".cadre-panneau-corps"));
  await attendre();
  expect(appels.filter((u) => u.startsWith("/api/fichiers")).length).toBeGreaterThan(avant);
});

test("REQ046_AC3_REQ028_AC15_clic_F_R_G_deplient_mais_les_fleches_non", async () => {
  const { vue } = monter();
  await attendre();
  const replier = () => barreTitre(vue, "Replier le panneau")?.click();
  replier();
  expect(aside(vue).hidden).toBe(true);
  const tabs = vue.querySelectorAll("[role=tab]");
  // Les flèches : l'onglet suivant devient actif, le panneau reste replié.
  tabs[0].focus();
  tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(vue.querySelector("[role=tab][aria-selected=true]").getAttribute("aria-label")).toBe("Recherche");
  expect(aside(vue).hidden).toBe(true);
  // Clic sur un onglet : déplie sur sa vue.
  tabs[2].click();
  expect(aside(vue).hidden).toBe(false);
  expect(aside(vue).querySelector("h2").textContent).toBe("Git");
  expect(barreTitre(vue, "Replier le panneau")).not.toBeNull();
  // Touche R depuis le rail.
  barreTitre(vue, "Replier le panneau").click();
  tabs[2].focus();
  tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
  expect(aside(vue).hidden).toBe(false);
  expect(aside(vue).querySelector("h2").textContent).toBe("Recherche");
  expect(aside(vue).contains(document.activeElement)).toBe(true);
});

test("REQ028_AC15_panneau_replie_l_onglet_actif_garde_aria_selected", async () => {
  const { vue } = monter();
  await attendre();
  barreTitre(vue, "Replier le panneau").click();
  expect(vue.querySelector("[role=tab][aria-selected=true]").getAttribute("aria-label")).toBe("Fichiers");
});

test("REQ046_AC13_coupure_replier_et_deplier_panneau_et_shells_sans_message", async () => {
  simulerShells({ ids: [1] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(1));
  const tabs = vue.querySelectorAll("[role=tab]");
  tabs[2].click();
  await attendre();
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new TypeError("coupure");
  }));
  const texte = () => vue.querySelector(".cadre-principal").textContent + vue.querySelector("aside").textContent;
  const avant = texte();
  // Panneau replié sur Git, coupure, clic sur Fichiers : le panneau se déplie sans lecture bruyante.
  barreTitre(vue, "Replier le panneau").click();
  tabs[0].click();
  await attendre();
  expect(aside(vue).hidden).toBe(false);
  expect(aside(vue).querySelector("h2").textContent).toBe("Fichiers");
  barreTitre(vue, "Replier le panneau").click();
  barreTitre(vue, "Déplier le panneau").click();
  barreTitre(vue, "Replier les shells").click();
  barreTitre(vue, "Déplier les shells").click();
  await attendre();
  expect(zone(vue).hidden).toBe(false);
  const apres = texte();
  for (const mot of ["Connexion perdue", "Impossible"]) expect(apres.includes(mot), mot).toBe(avant.includes(mot));
  expect(vue.querySelector(".fichiers").textContent).not.toContain("Impossible");
});

test("REQ046_AC8_un_shell_reduit_choisi_deplie_la_zone_le_rend_actif_et_le_focus_va_dans_son_terminal", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  vue.querySelectorAll(".shells [role=tab]")[1].click();
  bout(vue, "Réduire le shell").click();
  barreTitre(vue, "Replier les shells").click();
  expect(zone(vue).hidden).toBe(true);
  bout(vue, "Shells réduits").click();
  document.querySelectorAll("[role=menuitem]")[0].click();
  expect(zone(vue).hidden).toBe(false);
  expect(onglets(vue)).toEqual(["shell 1", "shell 2"]);
  expect(actifDe(vue)).toBe("shell 2");
  expect(document.activeElement.closest(".terminal")).not.toBeNull();
  expect(barreTitre(vue, "Replier les shells")).not.toBeNull();
});

test("REQ046_AC3_REQ028_AC15_Ctrl_Maj_F_ne_deplie_pas_Entree_apres_Bas_et_F_G_deplient", async () => {
  const { vue } = monter();
  await attendre();
  const tabs = vue.querySelectorAll("[role=tab]");
  barreTitre(vue, "Replier le panneau").click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "F", ctrlKey: true, shiftKey: true, bubbles: true }));
  expect(aside(vue).hidden).toBe(true);
  expect(document.activeElement).toBe(vue.querySelector("[role=tab][aria-selected=true]"));
  // Bas puis Entrée (qui arrive en click sur un button) : déplie sur la vue de l'onglet devenu actif.
  tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(aside(vue).hidden).toBe(true);
  vue.querySelector("[role=tab][aria-selected=true]").click();
  expect(aside(vue).hidden).toBe(false);
  expect(aside(vue).querySelector("h2").textContent).toBe("Recherche");
  for (const [touche, titre] of [["g", "Git"], ["f", "Fichiers"]]) {
    barreTitre(vue, "Replier le panneau").click();
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: touche, bubbles: true }));
    expect(aside(vue).hidden, touche).toBe(false);
    expect(aside(vue).querySelector("h2").textContent).toBe(titre);
    expect(aside(vue).contains(document.activeElement)).toBe(true);
  }
});

test("REQ047_AC1_zone_repliee_le_compteur_reste_a_2", async () => {
  simulerShells({ ids: [1, 2] });
  const { vue } = monter();
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  barreTitre(vue, "Replier les shells").click();
  expect(bout(vue, "Nouveau shell").querySelector(".ya-badge").textContent).toBe("2");
});

test("REQ068_AC1_bouton_selon_la_detection", async () => {
  simulerClaude({ disponible: true });
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  const rd = vue.querySelector(".cadre-rail-droit");
  expect([...rd.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Agent", "Agents", "Claude"]);
  expect(icone(boutonClaudeDe(vue))).toBe("asterisk");
  simulerClaude({ disponible: false });
  const sans = monter().vue;
  await attendre();
  await attendre();
  expect([...sans.querySelectorAll(".cadre-rail-droit button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Agent", "Agents"]);
});

test("REQ068_AC2_clic_ouvre_un_onglet", async () => {
  const appels = simulerClaude();
  const { vue } = monter({ chemin: "~/code/projet" });
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  boutonClaudeDe(vue).click();
  await vi.waitFor(() => expect(ongletsClaude(vue).length).toBe(1));
  expect(appels).toContain("POST /api/claude");
  expect(ongletsClaude(vue)[0].getAttribute("aria-selected")).toBe("true");
  expect(ongletsClaude(vue)[0].title).toBe("Claude Code dans ~/code/projet");
  boutonClaudeDe(vue).click();
  await vi.waitFor(() => expect(ongletsClaude(vue).length).toBe(2));
});

test("REQ068_AC18_coupure_et_503_aucun_onglet", async () => {
  simulerClaude({ coupure: true });
  const a = monter().vue;
  await vi.waitFor(() => expect(boutonClaudeDe(a)).not.toBeNull());
  boutonClaudeDe(a).click();
  await vi.waitFor(() => expect(a.textContent).toContain("Connexion perdue. Réessayez au retour."));
  expect(ongletsClaude(a).length).toBe(0);
  simulerClaude({ ouverture: { status: 503, corps: "pas de pty\n" } });
  const b = monter().vue;
  await vi.waitFor(() => expect(boutonClaudeDe(b)).not.toBeNull());
  boutonClaudeDe(b).click();
  await vi.waitFor(() => expect(b.textContent).toContain("Impossible d'ouvrir une session Claude : pas de pty."));
  expect(ongletsClaude(b).length).toBe(0);
});

test("REQ028_AC22_touches_sur_agents_et_claude", async () => {
  simulerClaude();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  for (const b of [boutonAgentsDe(vue), boutonClaudeDe(vue)]) {
    b.focus();
    for (const k of ["f", "r", "g"]) clavier(b, k);
    expect(vue.querySelector("[role=tab][aria-label=Fichiers]").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(b);
    expect(vue.querySelector("[role=tab][aria-label=Recherche]").getAttribute("aria-selected")).toBe("false");
  }
  boutonClaudeDe(vue).focus();
  clavier(boutonClaudeDe(vue), "a");
  await vi.waitFor(() => expect(document.activeElement).toBe(champAgent(vue)));
});

test("REQ028_AC8_ordre_de_tab_avec_claude", async () => {
  simulerClaude();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  // Ordre du rail droit : « Claude » après « Agents ».
  expect([...vue.querySelectorAll(".cadre-rail-droit button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Agent", "Agents", "Claude"]);
  // Un fichier ouvert, puis une session Claude.
  await vi.waitFor(() => expect(ligne(vue, "main.rs")).toBeDefined());
  ligne(vue, "main.rs").click();
  await vi.waitFor(() => expect(vue.querySelector(".cm-content")).not.toBeNull());
  const cm = vue.querySelector(".cm-content");
  boutonClaudeDe(vue).click();
  await vi.waitFor(() => expect(ongletsClaude(vue).length).toBe(1));
  // L'éditeur du fichier est masqué : hors de l'ordre de Tab.
  expect(cm.closest("[hidden]")).not.toBeNull();
  // Après les onglets de fichiers, le prochain arrêt est le terminal « Claude 1 ».
  const terminal = vue.querySelector('.terminal-zone[aria-label="Claude 1"]');
  expect(terminal).not.toBeNull();
  expect(terminal.closest("[hidden]")).toBeNull();
  const liste = vue.querySelector("[role=tablist][aria-label='Fichiers ouverts']") ?? ongletsClaude(vue)[0].closest("[role=tablist]");
  const arrets = [...vue.querySelectorAll("button, [role=tab], [tabindex], textarea, [contenteditable=true]")].filter((e) => e.tabIndex >= 0 && !e.closest("[hidden]"));
  const dernierOnglet = arrets.filter((e) => liste.contains(e)).pop();
  const suivant = arrets[arrets.indexOf(dernierOnglet) + 1];
  expect(terminal.contains(suivant)).toBe(true);
});

test("REQ068_AC5_raccourcis_ignores_dans_le_terminal_claude", async () => {
  simulerClaude();
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  boutonClaudeDe(vue).click();
  await vi.waitFor(() => expect(ongletsClaude(vue).length).toBe(1));
  const zone = vue.querySelector(".terminal-zone");
  const touche = (init) => {
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    zone.dispatchEvent(e);
    return e;
  };
  expect(touche({ key: "p", ctrlKey: true }).defaultPrevented).toBe(false);
  expect(touche({ key: "s", ctrlKey: true }).defaultPrevented).toBe(false);
  expect(document.querySelector("dialog[open], [role=dialog]")).toBeNull();
  // Ctrl+Maj+F sort le focus vers le bouton actif du rail.
  zone.focus();
  touche({ key: "F", ctrlKey: true, shiftKey: true });
  expect(document.activeElement).toBe(vue.querySelector("[role=tab][aria-selected=true]"));
});

test("REQ069_AC9_bandeau_illisible_sans_focus", async () => {
  const { vue } = monter({ reglages: { illisible: true } });
  await attendre();
  const m = [...vue.querySelectorAll("[role=alert]")].find((e) => e.textContent.includes(".yaide/interface.json est illisible. Corrigez-le, puis rechargez la page."));
  expect(m).toBeDefined();
  expect(m.contains(document.activeElement)).toBe(false);
  expect(m.querySelector("button")).not.toBeNull();
  vues.forEach((v) => v.detruire());
  document.body.replaceChildren();
  const sans = monter({ reglages: { replis: {}, fonctions: {} } });
  await attendre();
  expect(sans.vue.textContent).not.toContain("illisible");
});

test("REQ069_AC2_AC3_AC5_cles_de_replis_l_emportent_sur_le_navigateur", async () => {
  largeur(1280);
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "replis" ? { panneau: false, agent: true } : undefined));
  let { vue } = monter({ reglages: { replis: { panneau: true, agent: false } } });
  await vi.waitFor(() => expect(aside(vue).hidden).toBe(true));
  expect(barreTitre(vue, "Déplier le panneau")).not.toBeNull();
  expect(agentCol(vue).hidden).toBe(false);
  vues.forEach((v) => v.detruire());
  document.body.replaceChildren();
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "replis" ? { panneau: true, agent: false } : undefined));
  ({ vue } = monter({ reglages: { replis: { panneau: false, agent: true } } }));
  await attendre();
  await attendre();
  expect(aside(vue).hidden).toBe(false);
  expect(agentCol(vue).hidden).toBe(true);
  vues.forEach((v) => v.detruire());
  document.body.replaceChildren();
  // Sans clé, le navigateur décide (AC-069-5).
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "replis" ? { panneau: true } : undefined));
  ({ vue } = monter({ reglages: { replis: {} } }));
  await vi.waitFor(() => expect(aside(vue).hidden).toBe(true));
});

test("REQ069_AC6_deux_colonnes_a_800_l_agent_reste", async () => {
  largeur(800);
  const { vue } = monter({ reglages: { replis: { panneau: false, agent: false } } });
  await vi.waitFor(() => expect(aside(vue).hidden).toBe(true));
  expect(agentCol(vue).hidden).toBe(false);
});

test("REQ069_AC4_shells_repli_impose_a_la_restauration", async () => {
  simulerShells({ ids: [1, 2], precedent: { instance: "i1", nombre: 2, reduits: [] } });
  let { vue } = monter({ reglages: { replis: { shells: true } } });
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(2));
  expect(zone(vue).hidden).toBe(true);
  expect(barreTitre(vue, "Déplier les shells")).not.toBeNull();
  vues.forEach((v) => v.detruire());
  document.body.replaceChildren();
  simulerShells({ ids: [1], precedent: { instance: "i1", nombre: 1, reduits: [], replie: true } });
  ({ vue } = monter({ reglages: { replis: { shells: false } } }));
  await vi.waitFor(() => expect(onglets(vue)).toHaveLength(1));
  expect(zone(vue).hidden).toBe(false);
  vues.forEach((v) => v.detruire());
  document.body.replaceChildren();
  // Sans shell visible, rien n'est lancé.
  const appels = simulerShells({ ids: [], precedent: undefined });
  ({ vue } = monter({ reglages: { replis: { shells: true } } }));
  await attendre();
  await attendre();
  expect(appels).not.toContain("POST /api/shells");
  expect(zone(vue).hidden).toBe(true);
});
