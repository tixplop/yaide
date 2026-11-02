import { afterEach, expect, test, vi } from "vitest";
import { vuePrincipale } from "./principale.js";

let vues = [];
afterEach(() => {
  for (const v of vues) v.detruire();
  vues = [];
  vi.unstubAllGlobals();
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
  expect(document.title).toBe("projet — Yaide");
});

test("REQ028_AC2_barre_du_haut", () => {
  const { vue } = monter();
  const barre = vue.querySelector("header");
  expect(barre.textContent).toContain("Yaide");
  expect(barre.textContent).toContain("/home/x/projet");
  expect(barre.querySelector("button").textContent).toBe("Déconnexion");
});

test("REQ028_AC4_rail_accessible", () => {
  const { vue } = monter();
  const rail = vue.querySelector("[role=tablist]");
  expect(rail.getAttribute("aria-orientation")).toBe("vertical");
  const tabs = [...rail.querySelectorAll("[role=tab]")];
  expect(tabs.map((t) => t.textContent)).toEqual(["F", "R", "G"]);
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
  vue.querySelector("header button").dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
  expect(vue.querySelector("aside h2").textContent).toBe("Fichiers");
});

test("REQ005_AC3_deconnexion_appelle_le_serveur_puis_surDeconnexion", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 204 })));
  const { vue, surDeconnexion } = monter();
  vue.querySelector("header button").click();
  await new Promise((r) => setTimeout(r, 0));
  expect(fetch).toHaveBeenCalledWith("/api/deconnexion", expect.objectContaining({ method: "POST" }));
  expect(surDeconnexion).toHaveBeenCalled();
});

test("REQ028_AC8_Deconnexion_precede_le_rail_dans_l_ordre_du_document", () => {
  const { vue } = monter();
  const sortir = vue.querySelector("header button");
  const rail = vue.querySelector("[role=tab]");
  expect(sortir.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("REQ005_AC3_deconnexion_avec_session_deja_expiree_ramene_a_la_connexion", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401 })));
  const { vue, surDeconnexion } = monter();
  vue.querySelector("header button").click();
  await new Promise((r) => setTimeout(r, 0));
  expect(surDeconnexion).toHaveBeenCalled();
});

test("REQ028_AC1_clic_sur_le_rail_change_de_panneau_et_le_focus_y_entre", () => {
  const { vue } = monter();
  vue.querySelectorAll("[role=tab]")[2].click();
  expect(vue.querySelector("aside h2").textContent).toBe("Git");
  expect(document.activeElement).toBe(vue.querySelector(".cadre-panneau-corps"));
});

test("REQ028_AC2_et_AC022_AC3_la_barre_du_haut_affiche_la_branche_entre_le_chemin_et_Deconnexion", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/git/etat") return { ok: true, status: 200, json: async () => ({ branche: "main", detachee: false, branches: ["main"], changements: [] }) };
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  const { vue } = monter();
  await new Promise((r) => setTimeout(r, 0));
  const droite = vue.querySelector("header .barre-droite");
  expect(droite.children[0].textContent).toBe("branche: main");
  expect(droite.children[0].hidden).toBe(false);
  expect(droite.children[1].textContent).toBe("Déconnexion");
});

test("REQ022_AC4_hors_depot_pas_de_branche_dans_la_barre_du_haut", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/git/etat") return { ok: false, status: 409, json: async () => ({ cause: "pas-depot", message: "Ce dossier n'est pas un dépôt git." }) };
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  const { vue } = monter();
  await new Promise((r) => setTimeout(r, 0));
  expect(vue.querySelector("header .barre-branche").hidden).toBe(true);
});
