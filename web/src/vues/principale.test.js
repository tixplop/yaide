import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { ecrire, lire } from "../stockage.js";
import { vuePrincipale } from "./principale.js";

vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

let vues = [];
afterEach(() => {
  for (const v of vues) v.detruire();
  vues = [];
  vi.unstubAllGlobals();
  vi.mocked(lire).mockImplementation(async () => undefined);
  vi.mocked(ecrire).mockClear();
  document.body.replaceChildren();
});

function monter(options = {}) {
  const surDeconnexion = vi.fn();
  const vue = vuePrincipale({ chemin: "/home/x/projet", surDeconnexion, ...options });
  document.body.append(vue);
  vues.push(vue);
  return { vue, surDeconnexion };
}

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

const attendre = () => new Promise((r) => setTimeout(r, 0));
const poignees = (vue) => ({ panneau: vue.querySelector("[aria-label='Largeur du panneau']"), shells: vue.querySelector("[aria-label='Hauteur des shells']") });

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

// ---- T-045 : réduire un shell ----

// jsdom n'a pas matchMedia, dont xterm a besoin.
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
HTMLCanvasElement.prototype.getContext = () => null;

class FauxWebSocket {
  static tous = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.envoyes = [];
    FauxWebSocket.tous.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send(m) {
    this.envoyes.push(m);
  }
  close() {}
}
const tailles = (id) => FauxWebSocket.tous.filter((w) => w.url.endsWith(`/shells/${id}/ws`)).flatMap((w) => w.envoyes.filter((m) => typeof m === "string" && m.startsWith("taille")));

function simulerShells({ ids, instance = "i1", precedent }) {
  FauxWebSocket.tous = [];
  vi.stubGlobal("WebSocket", FauxWebSocket);
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = url.split("?")[0];
    appels.push(`${opts.method ?? "GET"} ${chemin}`);
    const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps, text: async () => "" });
    if (chemin === "/api/shells" && opts.method === "POST") return rep({ id: 9 }, 201);
    if (chemin === "/api/shells") return rep({ instance, shells: ids });
    if (chemin === "/api/fichiers") return rep({ entrees: [] });
    if (chemin === "/api/session") return rep({}, 204);
    if (chemin === "/api/git/etat") return rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    return rep({}, 409);
  }));
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "serveur" ? precedent : undefined));
  return appels;
}
const bout = (vue, nom) => vue.querySelector(`.cadre-rail-commandes [aria-label='${nom}']`);
const onglets = (vue) => [...vue.querySelectorAll(".shells [role=tab]")].map((t) => t.textContent);
const actifDe = (vue) => vue.querySelector(".shells [role=tab][aria-selected=true]")?.textContent;
const zone = (vue) => vue.querySelector(".cadre-shells");

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

const terminer = (id) => FauxWebSocket.tous.find((w) => w.url.endsWith(`/shells/${id}/ws`)).onclose({ code: 1000 });

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

// ---- T-037 : statuts git dans l'arbre, le rail et l'en-tête ----

const ENTREES = [
  { nom: "src", dossier: true, ignore: false },
  { nom: "main.rs", dossier: false, ignore: false },
  { nom: "gris.log", dossier: false, ignore: true },
];
function simulerServeur(etat) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const chemin = url.split("?")[0];
    appels.push(url);
    const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps });
    if (chemin === "/api/fichiers") return rep({ entrees: url.includes("chemin=src") ? [{ nom: "a.rs", dossier: false, ignore: false }] : ENTREES });
    if (chemin === "/api/shells") return { ok: false, status: 503, json: async () => ({}) };
    if (chemin === "/api/fichier") return { ok: true, status: 200, text: async () => "fn main() {}", headers: { get: () => "1" } };
    if (chemin === "/api/git/etat") return etat ? rep(etat) : rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    return { ok: true, status: 204, json: async () => ({}) };
  }));
  return appels;
}
const ETAT_GIT = (changements) => ({ branche: "main", detachee: false, branches: ["main"], changements });
const ligne = (vue, nom) => [...vue.querySelectorAll(".fichiers [role=treeitem]")].find((l) => l.querySelector(".liste-libelle").textContent === nom);

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

// ---- T-056 : aucun shell au départ, compteur sur « Nouveau shell » ----

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

// ---- T-057 : relecture toutes les 3 s ----

/** Serveur simulé pour la relecture : compte les appels git et arbre ; `etat.coupe` coupe la session. */
function simulerRelecture() {
  const s = { coupe: false, git: 0, arbre: 0, retenir: null, casse: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (url === "/api/session") {
        if (s.coupe) throw new TypeError("coupure");
        return { status: 204 };
      }
      if (url === "/api/git/etat") {
        s.git += 1;
        if (s.retenir) await s.retenir;
        if (s.casse) return { ok: true, status: 200, json: async () => { throw new SyntaxError("JSON illisible"); } };
        return { ok: true, status: 200, json: async () => ({ branche: "main", detachee: false, branches: ["main"], changements: [] }) };
      }
      if (url.startsWith("/api/fichiers?")) {
        s.arbre += 1;
        return { ok: true, status: 200, json: async () => ({ entrees: [{ nom: "a.txt", dossier: false }] }) };
      }
      return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
    }),
  );
  return s;
}

async function avecHorloge(corps) {
  vi.useFakeTimers();
  try {
    await corps();
  } finally {
    vi.useRealTimers();
  }
}

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

// ---- T-058 : replier le panneau et la zone des shells ----

const barreTitre = (vue, nom) => vue.querySelector(`header [aria-label='${nom}']`);
const icone = (b) => b.querySelector("svg").getAttribute("data-icone");
const aside = (vue) => vue.querySelector("aside");

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
  expect(ecrire).toHaveBeenLastCalledWith("replis", { panneau: true });
  const avant = appels.filter((u) => u.startsWith("/api/fichiers")).length;
  b.click();
  expect(aside(vue).hidden).toBe(false);
  expect(ecrire).toHaveBeenLastCalledWith("replis", { panneau: false });
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

test("REQ028_AC16_panneau_replie_sans_onglet_le_focus_va_sur_Ouvrir_un_fichier", async () => {
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "replis" ? { panneau: true } : undefined));
  const { vue } = monter();
  await vi.waitFor(() => expect(document.activeElement.textContent).toBe("Ouvrir un fichier"));
  expect(vue.contains(document.activeElement)).toBe(true);
});

// ---- T-060 : replier le panneau depuis son en-tête ----

const repliDuPanneau = (vue) => [...aside(vue).querySelectorAll("button")].find((b) => !b.closest("[hidden]"));
const resultatsVides = () => {
  const base = vi.mocked(fetch);
  vi.stubGlobal("fetch", vi.fn(async (url, ...r) => (url.startsWith("/api/recherche") ? { ok: true, status: 200, json: async () => ({ resultats: [], limite: false }) } : base(url, ...r))));
};

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
  expect(ecrire).toHaveBeenLastCalledWith("replis", { panneau: true });
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
