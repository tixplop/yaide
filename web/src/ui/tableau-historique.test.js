import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";

const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 40, y: 80, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 300, y: 80, width: 160, height: 80, text: "Fin" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
});

let t;
let changements;
function monter(doc = DOC()) {
  changements = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue: { x: 0, y: 0, zoom: 1 }, surChangement: (d) => changements.push(d) });
  document.body.append(t.element);
  return t;
}
beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  t?.detruire();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const surface = () => t.element.querySelector("[role=application]");
const barre = () => t.element.querySelector("[role=toolbar]");
const bt = (nom) => [...barre().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom);
const obj = (id) => t.element.querySelector(`[data-id="${id}"]`);
const dernier = () => changements.at(-1);
const statut = () => t.element.querySelector("[role=status]");
const tour = () => new Promise((r) => setTimeout(r, 5));
const ptr = (cible, type, x, y) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, "pointerId", { value: 1 });
  cible.dispatchEvent(e);
};
function glisser(cible, de, vers) {
  ptr(cible, "pointerdown", de[0], de[1]);
  ptr(surface(), "pointermove", (de[0] + vers[0]) / 2, (de[1] + vers[1]) / 2);
  ptr(surface(), "pointermove", vers[0], vers[1]);
  ptr(surface(), "pointerup", vers[0], vers[1]);
}
const touche = (key, opts = {}, cible = surface()) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  cible.dispatchEvent(e);
  return e;
};
const z = (cible) => touche("z", { ctrlKey: true }, cible);
const y = (cible) => touche("y", { ctrlKey: true }, cible);
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const boite = (id, doc = dernier()) => doc.boxes.find((b) => b.id === id);
const doubleClic = (x, py) => surface().querySelector("svg").dispatchEvent(new MouseEvent("dblclick", { clientX: x, clientY: py, bubbles: true, cancelable: true }));
function taper(editeur, texte) {
  editeur.textContent = texte;
  editeur.dispatchEvent(new Event("input", { bubbles: true }));
}
const choisis = () => [...t.element.querySelectorAll("g.choisie")].map((g) => g.getAttribute("data-id"));

test("REQ145_AC1_glisser_un_seul_pas_defait_et_refait_par_surChangement", () => {
  monter();
  glisser(obj("b1").querySelector("rect"), [100, 120], [160, 180]);
  expect(boite("b1")).toMatchObject({ x: 100, y: 140 });
  const n = changements.length;
  expect(n).toBeGreaterThan(1);
  z();
  expect(changements.length).toBe(n + 1);
  expect(boite("b1")).toMatchObject({ x: 40, y: 80 });
  expect(obj("b1").querySelector("rect").getAttribute("x")).toBe("40");
  y();
  expect(boite("b1")).toMatchObject({ x: 100, y: 140 });
  z();
  z();
  expect(boite("b1")).toMatchObject({ x: 40, y: 80 });
});

test("REQ145_AC2_trois_pas_defaits_puis_refaits_dans_l_ordre", () => {
  monter();
  clic(obj("b2"));
  touche("Delete");
  expect(dernier().boxes.map((b) => b.id)).toEqual(["b1"]);
  clic(obj("b1"));
  touche("ArrowRight");
  bt("Bleu").click();
  expect(boite("b1")).toMatchObject({ x: 50, color: "blue" });
  z();
  expect(boite("b1").color).toBeUndefined();
  expect(boite("b1").x).toBe(50);
  z();
  expect(boite("b1").x).toBe(40);
  z();
  expect(dernier().boxes.map((b) => b.id)).toEqual(["b1", "b2"]);
  expect(dernier().links).toHaveLength(1);
  const n = changements.length;
  z();
  expect(changements.length).toBe(n);
  y();
  expect(dernier().boxes.map((b) => b.id)).toEqual(["b1"]);
  y();
  expect(boite("b1").x).toBe(50);
  y();
  expect(boite("b1").color).toBe("blue");
  expect(statut().textContent).toBe("");
  const m = changements.length;
  y();
  expect(changements.length).toBe(m);
});

test("REQ145_AC3_boite_puis_texte_deux_pas_et_saisie_intacte", () => {
  monter();
  doubleClic(600, 400);
  const editeur = t.element.querySelector("[role=textbox]");
  taper(editeur, "Étape");
  expect(dernier().boxes).toHaveLength(3);
  expect(dernier().boxes[2].text).toBe("Étape");
  // pendant la saisie : ni écoutée ni empêchée
  const e = z(editeur);
  expect(e.defaultPrevented).toBe(false);
  expect(dernier().boxes[2].text).toBe("Étape");
  expect(t.element.querySelector("[role=textbox]")).toBe(editeur);
  editeur.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(t.element.querySelector("[role=textbox]")).toBeNull();
  z();
  expect(dernier().boxes).toHaveLength(3);
  expect(dernier().boxes[2].text).toBe("");
  z();
  expect(dernier().boxes).toHaveLength(2);
});

test("REQ145_AC3_saisie_tapee_puis_effacee_ne_compte_pas", () => {
  monter();
  clic(obj("b1"));
  touche("Enter");
  const editeur = t.element.querySelector("[role=textbox]");
  taper(editeur, "Début x");
  taper(editeur, "Début");
  editeur.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  touche("ArrowRight");
  expect(boite("b1").x).toBe(50);
  z();
  expect(boite("b1").x).toBe(40);
  z();
  expect(boite("b1").x).toBe(40);
  expect(statut().textContent).toBe("");
});

test("REQ145_AC3_plusieurs_frappes_d_une_saisie_forment_un_seul_pas", () => {
  monter();
  clic(obj("b1"));
  touche("Enter");
  const editeur = t.element.querySelector("[role=textbox]");
  taper(editeur, "Début 1");
  taper(editeur, "Début 12");
  editeur.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  z();
  expect(boite("b1").text).toBe("Début");
});

test("REQ145_AC4_nouveau_pas_efface_le_refaire_et_la_vue_n_est_pas_un_pas", () => {
  monter();
  clic(obj("b1"));
  touche("ArrowRight");
  z();
  touche("ArrowDown");
  const n = changements.length;
  y();
  expect(changements.length).toBe(n);
  expect(boite("b1")).toMatchObject({ x: 40, y: 90 });
  // vue, choix : pas des pas
  t.zoomAvant();
  clic(obj("b2"));
  t.definirTheme("dark");
  const vue = surface().querySelector("svg").getAttribute("viewBox");
  expect(vue).not.toBeNull();
  const avant = changements.length;
  z();
  expect(changements.length).toBe(avant + 1);
  expect(boite("b1")).toMatchObject({ x: 40, y: 80 });
  expect(dernier().boxes).toHaveLength(2);
  expect(surface().querySelector("svg").getAttribute("viewBox")).toBe(vue);
});

test("REQ145_AC5_collage_defait_et_refait_et_instances_separees", () => {
  monter();
  const autre = tableau({ nom: "autre.jdiag", document: DOC(), surChangement: () => {} });
  document.body.append(autre.element);
  touche("a", { ctrlKey: true });
  touche("c", { ctrlKey: true });
  touche("v", { ctrlKey: true });
  expect(dernier().boxes).toHaveLength(4);
  expect(choisis().length).toBeGreaterThan(1);
  z();
  expect(dernier().boxes).toHaveLength(2);
  expect(choisis()).toEqual([]);
  y();
  expect(dernier().boxes).toHaveLength(4);
  // l'autre instance n'a rien à défaire
  const sa = autre.element.querySelector("[role=application]");
  sa.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
  expect(autre.element.querySelector("[role=status]").textContent).toBe("");
  return tour().then(() => {
    expect(autre.element.querySelector("[role=status]").textContent).toBe("Rien à annuler.");
    autre.detruire();
  });
});

test("REQ145_AC6_definirDocument_vide_l_historique_et_cent_pas_au_plus", async () => {
  monter();
  clic(obj("b1"));
  touche("ArrowRight");
  t.definirDocument(DOC());
  const n = changements.length;
  z();
  expect(changements.length).toBe(n);
  await tour();
  expect(statut().textContent).toBe("Rien à annuler.");
  // 101 flèches puis 101 Ctrl+Z : 100 défaites
  t.definirDocument(DOC());
  clic(obj("b1"));
  for (let i = 0; i < 101; i++) touche(i % 2 ? "ArrowLeft" : "ArrowRight");
  expect(boite("b1").x).toBe(50);
  for (let i = 0; i < 101; i++) z();
  expect(boite("b1").x).toBe(50);
  for (let i = 0; i < 100; i++) y();
  expect(boite("b1").x).toBe(50);
});

test("REQ145_AC6_cent_un_pas_le_premier_reste", () => {
  monter();
  clic(obj("b1"));
  for (let i = 0; i < 101; i++) touche("ArrowDown");
  expect(boite("b1").y).toBe(80 + 1010);
  for (let i = 0; i < 101; i++) z();
  expect(boite("b1").y).toBe(90);
});

test("REQ145_AC7_AC8_aide_ctrl_et_cmd", () => {
  monter();
  const aide = () => document.getElementById(surface().getAttribute("aria-describedby")).textContent;
  expect(aide()).toBe("Tab : objet suivant. Entrée : écrire dans la boîte. Flèches : déplacer. Suppr : effacer. Ctrl+A : tout choisir. Ctrl+C, Ctrl+V : copier, coller. Ctrl+Z, Ctrl+Y : annuler, rétablir. Échap : ne plus rien choisir. O : boîte à outils.");
  t.detruire();
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  monter();
  expect(aide()).toBe("Tab : objet suivant. Entrée : écrire dans la boîte. Flèches : déplacer. Suppr : effacer. Cmd+A : tout choisir. Cmd+C, Cmd+V : copier, coller. Cmd+Z, Cmd+Y : annuler, rétablir. Échap : ne plus rien choisir. O : boîte à outils.");
  clic(obj("b1"));
  touche("ArrowRight");
  expect(z().defaultPrevented).toBe(false);
  expect(boite("b1").x).toBe(50);
  touche("z", { metaKey: true });
  expect(boite("b1").x).toBe(40);
  touche("y", { metaKey: true });
  expect(boite("b1").x).toBe(50);
});

test("REQ145_AC7_focus_et_aria_activedescendant_apres_annulation", () => {
  monter();
  surface().focus();
  clic(obj("b1"));
  touche("ArrowRight");
  touche("a", { ctrlKey: true });
  z();
  expect(document.activeElement).toBe(surface());
  expect(surface().getAttribute("aria-activedescendant")).toMatch(/-b1$/);
  clic(obj("b2"));
  touche("Delete");
  expect(surface().hasAttribute("aria-activedescendant")).toBe(false);
  z();
  expect(choisis()).toEqual([]);
  expect(surface().hasAttribute("aria-activedescendant")).toBe(false);
});

test("REQ145_AC8_messages_du_status_et_reecriture_a_chaque_appui", async () => {
  monter();
  z();
  expect(statut().textContent).toBe("");
  await tour();
  expect(statut().textContent).toBe("Rien à annuler.");
  y();
  await tour();
  expect(statut().textContent).toBe("Rien à rétablir.");
  clic(obj("b1"));
  touche("ArrowRight");
  touche("ArrowRight");
  z();
  expect(statut().textContent).toBe("");
  await tour();
  expect(statut().textContent).toBe("Modification annulée.");
  z();
  expect(statut().textContent).toBe("");
  await tour();
  expect(statut().textContent).toBe("Modification annulée.");
  y();
  await tour();
  expect(statut().textContent).toBe("Modification rétablie.");
  // dessiner() ne l'écrase pas tant que le choix ne change pas
  t.zoomAvant();
  expect(statut().textContent).toBe("Modification rétablie.");
});

test("REQ145_AC8_apres_collage_annule_tab_remet_la_regle_du_choix", async () => {
  monter();
  touche("a", { ctrlKey: true });
  touche("c", { ctrlKey: true });
  touche("v", { ctrlKey: true });
  expect(statut().textContent).toMatch(/objets choisis/);
  z();
  await tour();
  expect(statut().textContent).toBe("Modification annulée.");
  touche("Tab");
  expect(choisis()).toHaveLength(1);
  expect(statut().textContent).toBe("");
});

test("REQ145_AC9_focus_sur_la_boite_a_outils_et_prevent_default", async () => {
  monter();
  clic(obj("b1"));
  bt("Bleu").click();
  bt("Bleu").focus();
  expect(boite("b1").color).toBe("blue");
  const e = z(bt("Bleu"));
  expect(e.defaultPrevented).toBe(true);
  expect(boite("b1").color).toBeUndefined();
  expect(bt("Par défaut").getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(bt("Bleu"));
  await tour();
  expect(statut().textContent).toBe("Modification annulée.");
  expect(y(bt("Bleu")).defaultPrevented).toBe(true);
  expect(boite("b1").color).toBe("blue");
  // sans rien à faire : toujours empêchée ; avec Maj ou Alt : ni écoutée ni empêchée
  expect(y(surface()).defaultPrevented).toBe(true);
  expect(touche("z", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  expect(touche("z", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
  expect(boite("b1").color).toBe("blue");
});

test("REQ145_AC9_pendant_un_glisser_rien_ne_change", () => {
  monter();
  clic(obj("b2"));
  touche("ArrowRight");
  ptr(obj("b1").querySelector("rect"), "pointerdown", 100, 120);
  ptr(surface(), "pointermove", 130, 150);
  ptr(surface(), "pointermove", 160, 180);
  const n = changements.length;
  const e = z();
  expect(e.defaultPrevented).toBe(true);
  expect(changements.length).toBe(n);
  expect(boite("b1")).toMatchObject({ x: 100, y: 140 });
  ptr(surface(), "pointerup", 160, 180);
  expect(boite("b1")).toMatchObject({ x: 100, y: 140 });
  z();
  expect(boite("b1")).toMatchObject({ x: 40, y: 80 });
  expect(boite("b2").x).toBe(310);
});

test("REQ145_AC9_pas_d_ecoute_hors_de_la_surface_et_de_la_barre", () => {
  monter();
  clic(obj("b1"));
  touche("ArrowRight");
  const n = changements.length;
  const e = z(t.element);
  expect(e.defaultPrevented).toBe(false);
  expect(changements.length).toBe(n);
});
