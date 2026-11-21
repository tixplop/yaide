import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";
import { versKlaxoon } from "../klaxoon.js";

const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 40, y: 80, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 300, y: 80, width: 160, height: 80, text: "Fin" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
  arrows: [{ id: "a1", x1: 100, y1: 300, x2: 300, y2: 300 }],
});
const REFUS_COPIE = "Copie au format Klaxoon impossible : le navigateur a refusé l'accès au presse-papiers. Réessayez.";

let t;
let changements;
let compte;
let copies; // événements `copy` reçus par la page : { donnees }
let rects; // rectangle à l'écran par `data-id`
function monter(doc = DOC()) {
  changements = [];
  rects = {};
  const base = { x: 0, y: 0, left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    return rects[this.getAttribute?.("data-id")] ?? base;
  });
  t = tableau({ nom: "plan.jdiag", document: doc, vue: { x: 0, y: 0, zoom: 1 }, surChangement: (d) => changements.push(d) });
  document.body.append(t.element);
  surface().focus();
  return t;
}
// Un `document.execCommand("copy")` qui envoie l'événement `copy` à l'élément qui a le focus, ou rien (`envoyer` faux).
function simulerCopie({ accepte = true, envoyer = true } = {}) {
  copies = [];
  document.execCommand = vi.fn(() => {
    if (envoyer) {
      const e = new Event("copy", { bubbles: true, cancelable: true });
      const donnees = {};
      e.clipboardData = { setData: vi.fn((type, v) => (donnees[type] = v)), getData: () => "" };
      document.activeElement.dispatchEvent(e);
      copies.push({ donnees, e });
    }
    return accepte;
  });
}
beforeEach(() => {
  document.body.innerHTML = "";
  compte = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++compte).padStart(12, "0")}`);
});
afterEach(() => {
  t?.detruire();
  vi.restoreAllMocks();
  delete document.execCommand;
});

const surface = () => t.element.querySelector("[role=application]");
const alerte = () => t.element.querySelector("[role=alert]");
const statut = () => t.element.querySelector("[role=status]");
const obj = (id) => t.element.querySelector(`[data-id="${id}"]`);
const menuOuvert = () => document.querySelector("[role=menu]");
const commande = () => document.querySelector("[role=menuitem]");
const choisies = () => [...t.element.querySelectorAll("g.choisie")].map((g) => g.getAttribute("data-id")).sort();
const touche = (key, opts = {}, cible = surface()) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  cible.dispatchEvent(e);
  return e;
};
const droit = (cible, x = 100, y = 100) => {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
  cible.dispatchEvent(e);
  return e;
};
const clic = (cible) => {
  cible.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
  cible.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  cible.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
};
const coller = (texte) => {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  e.clipboardData = { getData: () => texte, setData: vi.fn() };
  surface().dispatchEvent(e);
  return e;
};
const attendre = () => new Promise((r) => setTimeout(r, 0));
const choisirTout = () => touche("a", { ctrlKey: true });

test("REQ155_AC1_clic_droit_ouvre_le_menu_de_yaide_et_choisit_l_objet_seul", () => {
  monter();
  const e = droit(obj("b1"));
  expect(e.defaultPrevented).toBe(true);
  expect(choisies()).toEqual(["b1"]);
  expect(document.querySelectorAll("[role=menu]").length).toBe(1);
  const items = document.querySelectorAll("[role=menuitem]");
  expect(items.length).toBe(1);
  expect(items[0].textContent).toBe("Copier au format Klaxoon");
});

test("REQ155_AC2_AC3_copie_klaxoon_dans_l_evenement_copy_puis_collage_des_objets", async () => {
  monter();
  simulerCopie();
  choisirTout();
  droit(surface());
  expect(choisies()).toEqual(["a1", "b1", "b2", "l1"]);
  compte = 0;
  const attendu = versKlaxoon(DOC(), ["b1", "b2", "l1", "a1"]);
  compte = 0;
  clic(commande());
  expect(document.execCommand).toHaveBeenCalledWith("copy");
  expect(copies.length).toBe(1);
  expect(copies[0].donnees["text/plain"]).toBe("Début\nFin");
  expect(copies[0].donnees["text/plain"]).toBe(attendu.texte);
  expect(copies[0].donnees["text/html"]).toBe(attendu.html);
  expect(copies[0].e.defaultPrevented).toBe(true);
  expect(changements.length).toBe(0);
  // AC-155-3 : Ctrl+V colle les objets, sans recréer le whiteboard
  coller("Début\nFin");
  expect(changements.length).toBe(1);
  expect(changements[0].boxes.length).toBe(4);
  expect(changements[0].links.length).toBe(2);
  expect(changements[0].boxes.slice(0, 2).map((b) => [b.id, b.x])).toEqual([["b1", 40], ["b2", 300]]);
  expect(changements[0].boxes[2].x).toBe(60);
  await attendre();
});

test("REQ155_AC4_flèche_seule_commande_desactivee_saisie_et_fichier_illisible", () => {
  monter();
  simulerCopie();
  droit(obj("a1"));
  expect(choisies()).toEqual(["a1"]);
  expect(commande().getAttribute("aria-disabled")).toBe("true");
  clic(commande());
  touche("Enter", {}, commande());
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(menuOuvert()).not.toBeNull();
  expect(changements.length).toBe(0);
  touche("Escape");
  // pendant une saisie : le menu du navigateur
  droit(obj("b1"));
  touche("Escape");
  touche("Enter");
  const editeur = t.element.querySelector("[contenteditable]");
  expect(editeur).not.toBeNull();
  const e = droit(editeur);
  expect(e.defaultPrevented).toBe(false);
  expect(menuOuvert()).toBeNull();
  // fichier illisible
  t.definirDocument(null);
  const f = droit(t.element);
  expect(f.defaultPrevented).toBe(false);
  expect(menuOuvert()).toBeNull();
});

test("REQ155_AC5_menu_et_maj_f10_ouvrent_le_menu_focus_sur_la_commande_entree_copie", () => {
  monter();
  simulerCopie();
  droit(obj("b1"));
  touche("Escape");
  expect(menuOuvert()).toBeNull();
  const e = touche("F10", { shiftKey: true });
  expect(e.defaultPrevented).toBe(true);
  expect(menuOuvert()).not.toBeNull();
  expect(document.activeElement).toBe(commande());
  touche("Escape");
  touche("ContextMenu");
  expect(document.activeElement).toBe(commande());
  touche("Enter", {}, commande());
  expect(document.execCommand).toHaveBeenCalledTimes(1);
  expect(menuOuvert()).toBeNull();
});

test("REQ155_AC6_nom_echap_et_tab_ferment_le_menu_focus_sur_la_surface_choix_inchange", () => {
  monter();
  droit(obj("b1"));
  expect(menuOuvert().getAttribute("aria-label")).toBe("Actions sur la sélection");
  touche("Escape", {}, commande());
  expect(menuOuvert()).toBeNull();
  expect(document.activeElement).toBe(surface());
  expect(choisies()).toEqual(["b1"]);
  droit(obj("b1"));
  touche("Tab", {}, commande());
  expect(menuOuvert()).toBeNull();
  expect(document.activeElement).toBe(surface());
  expect(choisies()).toEqual(["b1"]);
});

test("REQ155_AC7_position_pointeur_clavier_et_dans_la_zone", () => {
  monter();
  droit(obj("b1"), 120, 90);
  expect(t.element.contains(menuOuvert())).toBe(true);
  expect([menuOuvert().style.left, menuOuvert().style.top]).toEqual(["120px", "90px"]);
  touche("Escape");
  rects.b2 = { x: 300, y: 80, left: 300, top: 80, width: 160, height: 80, right: 460, bottom: 160 };
  droit(obj("b2"));
  touche("Escape");
  touche("F10", { shiftKey: true });
  expect([menuOuvert().style.left, menuOuvert().style.top]).toEqual(["300px", "164px"]);
  touche("Escape");
  touche("Escape");
  expect(choisies()).toEqual([]);
  touche("ContextMenu");
  expect([menuOuvert().style.left, menuOuvert().style.top]).toEqual(["12px", "12px"]);
});

test("REQ155_AC8_status_apres_la_copie_et_commande_desactivee", async () => {
  monter();
  simulerCopie();
  choisirTout();
  droit(surface());
  const actif = surface().getAttribute("aria-activedescendant");
  clic(commande());
  await attendre();
  expect(statut().textContent).toBe("Copié au format Klaxoon : 2 boîtes, 1 lien.");
  expect(alerte().textContent).toBe("");
  expect(menuOuvert()).toBeNull();
  expect(document.activeElement).toBe(surface());
  expect(choisies()).toEqual(["a1", "b1", "b2", "l1"]);
  expect(surface().getAttribute("aria-activedescendant")).toBe(actif);
  touche("Escape");
  droit(obj("b2"));
  clic(commande());
  await attendre();
  expect(statut().textContent).toBe("Copié au format Klaxoon : 1 boîte, aucun lien.");
  droit(obj("a1"));
  const avant = statut().textContent;
  touche("Enter", {}, commande());
  touche(" ", {}, commande());
  clic(commande());
  await attendre();
  expect(menuOuvert()).not.toBeNull();
  expect(document.activeElement).toBe(commande());
  expect(statut().textContent).toBe(avant);
});

test("REQ155_AC9_pas_de_connecteur_clic_ailleurs_molette_refus_et_boite_a_outils", () => {
  monter();
  let dx = 0;
  const survol = () => surface().dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100 + ++dx, clientY: 100 }));
  const nb = () => t.element.querySelector(".connecteurs").children.length;
  survol();
  expect(nb()).toBeGreaterThan(0);
  droit(obj("b1"), 100, 100);
  expect(nb()).toBe(0);
  survol();
  expect(nb()).toBe(0);
  clic(surface());
  expect(menuOuvert()).toBeNull();
  expect(choisies()).toEqual(["b1"]);
  droit(obj("b1"));
  droit(obj("b2"));
  expect(menuOuvert()).not.toBeNull();
  expect(choisies()).toEqual(["b2"]);
  surface().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 }));
  expect(menuOuvert()).toBeNull();
  coller("sequenceDiagram\n  A->>B: Bonjour");
  expect(alerte().textContent).not.toBe("");
  droit(surface());
  expect(alerte().textContent).toBe("");
  expect(menuOuvert()).not.toBeNull();
  touche("Escape");
  const e = droit(t.element.querySelector("[role=toolbar]"));
  expect(e.defaultPrevented).toBe(false);
  expect(menuOuvert()).toBeNull();
});

test("REQ155_AC1_clic_droit_sur_un_connecteur_vaut_clic_droit_sur_sa_boite", () => {
  monter();
  let dx = 0;
  const survol = () => surface().dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100 + ++dx, clientY: 100 }));
  const toutDeselectionner = () => {
    touche("Escape");
    t.element.querySelector("svg").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(choisies()).toEqual([]);
  };
  const connecteur = (cote) => t.element.querySelector(`[data-connecteur="${cote}"][data-boite="b1"]`);
  for (const cote of ["center", "right"]) {
    toutDeselectionner();
    survol();
    const c = connecteur(cote);
    expect(c).not.toBeNull();
    droit(c);
    expect(choisies()).toEqual(["b1"]);
    expect(menuOuvert()).not.toBeNull();
    expect(commande().getAttribute("aria-disabled")).toBeNull();
    touche("Escape");
  }
  droit(obj("b2"));
  touche("Escape");
  expect(choisies()).toEqual(["b2"]);
  survol();
  droit(connecteur("center"));
  expect(choisies()).toEqual(["b1"]);
});

test("REQ155_AC10_refus_du_presse_papiers_rien_n_est_retenu", async () => {
  monter();
  simulerCopie();
  droit(obj("b1"));
  clic(commande());
  touche("c", { ctrlKey: true });
  const e = new Event("copy", { bubbles: true, cancelable: true });
  e.clipboardData = { setData: vi.fn(), getData: () => "" };
  surface().dispatchEvent(e);
  // refus : execCommand rend false, sans événement copy
  simulerCopie({ accepte: false, envoyer: false });
  droit(obj("b2"));
  clic(commande());
  expect(alerte().textContent).toBe(REFUS_COPIE);
  expect(document.activeElement).toBe(surface());
  await attendre();
  expect(statut().textContent).not.toMatch(/Klaxoon/);
  coller("Début");
  expect(changements.length).toBe(1);
  expect(changements[0].boxes.at(-1).text).toBe("Début");
  clic(surface());
  surface().dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
  expect(alerte().textContent).toBe("");
  // execCommand accepte mais le copy n'arrive pas : même refus
  simulerCopie({ accepte: true, envoyer: false });
  droit(obj("b2"));
  clic(commande());
  expect(alerte().textContent).toBe(REFUS_COPIE);
});
