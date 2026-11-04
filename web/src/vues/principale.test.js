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
  expect(noms).toEqual(["Ouverture rapide", "Thème clair", "Déconnexion"]);
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
  const { vue } = monter();
  await attendre();
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

test("REQ035_AC1_AC8_deux_boutons_a_icone_dans_le_rail_hors_du_tablist", () => {
  const { vue } = monter();
  const groupe = vue.querySelector(".cadre-rail-commandes");
  const boutons = [...groupe.querySelectorAll("button")];
  expect(boutons.map((b) => b.getAttribute("aria-label"))).toEqual(["Nouveau shell", "Fermer le shell"]);
  expect(boutons.map((b) => b.textContent)).toEqual(["", ""]);
  const icones = boutons.map((b) => b.querySelector("svg").getAttribute("data-icone"));
  expect(icones).toEqual(["terminal", "square-x"]);
  expect(icones).not.toContain("x");
  expect(vue.querySelector("[role=tablist]").contains(groupe)).toBe(false);
  // Aucun shell : « Fermer le shell » est désactivé.
  expect(boutons[1].disabled).toBe(true);
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
