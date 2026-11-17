import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";

const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 100, y: 100, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 400, y: 100, width: 160, height: 80, text: "Fin" },
  ],
  links: [],
});
const VIDE = () => ({ version: 1, boxes: [], links: [] });

let t;
let changements;
let vues;
function monter(doc = DOC(), vue = { x: 0, y: 0, zoom: 1 }) {
  changements = [];
  vues = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue, surChangement: (d) => changements.push(d), surVue: (v) => vues.push(v) });
  document.body.append(t.element);
  return t;
}
beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  t?.detruire();
  vi.restoreAllMocks();
});

const surface = () => t.element.querySelector("[role=application]");
const obj = (id) => t.element.querySelector(`[data-id="${id}"]`);
const dernier = () => changements.at(-1);
const ptr = (cible, type, x, y, opts = {}) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...opts });
  Object.defineProperty(e, "pointerId", { value: 1 });
  cible.dispatchEvent(e);
  return e;
};
function glisser(cible, de, vers, ou = surface()) {
  ptr(cible, "pointerdown", de[0], de[1]);
  ptr(ou, "pointermove", (de[0] + vers[0]) / 2, (de[1] + vers[1]) / 2);
  ptr(ou, "pointermove", vers[0], vers[1]);
  ptr(ou, "pointerup", vers[0], vers[1]);
}
const boite = (doc, id) => doc.boxes.find((b) => b.id === id);
const poignee = (nom) => t.element.querySelector(`[data-poignee="${nom}"]`);
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

test("REQ129_AC1_double_clic_sur_une_partie_vide_pose_une_boite_centree_en_saisie", () => {
  monter(VIDE());
  surface().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 300, clientY: 200, button: 0 }));
  expect(dernier().boxes).toEqual([{ id: "b1", x: 220, y: 160, width: 160, height: 80, text: "" }]);
  const zone = t.element.querySelector("[role=textbox]");
  expect(document.activeElement).toBe(zone);
  zone.textContent = "Début";
  zone.dispatchEvent(new Event("input", { bubbles: true }));
  zone.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(dernier().boxes[0].text).toBe("Début");
  expect(obj("b1").textContent).toBe("Début");
});

test("REQ129_AC3_double_clic_sur_une_boite_saisie_curseur_a_la_fin", () => {
  monter();
  obj("b1").querySelector("rect").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
  const zone = t.element.querySelector("[role=textbox]");
  expect(document.activeElement).toBe(zone);
  expect(zone.textContent).toBe("Début");
  expect(getSelection().anchorOffset).toBe(5);
  expect(changements).toEqual([]);
});

test("REQ129_AC4_glisser_la_boite_de_100_px_la_deplace_de_100_px", () => {
  monter();
  const rect = obj("b1").querySelector("rect");
  glisser(rect, [150, 140], [250, 140]);
  expect(boite(dernier(), "b1")).toMatchObject({ x: 200, y: 100 });
  expect(boite(dernier(), "b2")).toMatchObject({ x: 400, y: 100 });
  expect(obj("b1").classList.contains("choisie")).toBe(true);
  expect(obj("b1").classList.contains("glissee")).toBe(false);
});

test("REQ129_AC4_un_deplacement_de_3_px_ou_moins_ne_deplace_rien", () => {
  monter();
  glisser(obj("b1").querySelector("rect"), [150, 140], [152, 141]);
  expect(changements).toEqual([]);
});

test("REQ129_AC4_la_boite_suit_le_pointeur_au_zoom_200_arrondie_au_pixel", () => {
  monter(DOC(), { x: 0, y: 0, zoom: 2 });
  const rect = obj("b1").querySelector("rect");
  ptr(rect, "pointerdown", 300, 300);
  ptr(surface(), "pointermove", 311, 300);
  expect(obj("b1").classList.contains("glissee")).toBe(true);
  expect(boite(dernier(), "b1").x).toBe(106);
  ptr(surface(), "pointerup", 311, 300);
});

test("REQ129_AC5_poignee_de_taille_agrandit_puis_ne_descend_pas_sous_40_x_24", () => {
  monter();
  clic(obj("b1").querySelector("rect"));
  glisser(poignee("taille"), [260, 180], [320, 200]);
  expect(boite(dernier(), "b1")).toMatchObject({ width: 220, height: 100 });
  glisser(poignee("taille"), [320, 200], [-500, -500]);
  expect(boite(dernier(), "b1")).toMatchObject({ x: 100, y: 100, width: 40, height: 24 });
});

test("REQ130_AC1_AC2_poignee_de_liaison_cree_la_fleche_au_lacher_sur_une_autre_boite", () => {
  monter();
  clic(obj("b1").querySelector("rect"));
  glisser(poignee("liaison"), [278, 140], [480, 140]);
  expect(dernier().links).toEqual([{ id: "l1", from: "b1", to: "b2" }]);
  expect(obj("l1").getAttribute("aria-label")).toBe("De Début vers Fin");
  const bords = (depart, arrivee) => {
    const trait = obj("l1").querySelector(".trait");
    expect(Number(trait.getAttribute("x1"))).toBeCloseTo(depart[0], 3);
    expect(Number(trait.getAttribute("y1"))).toBeCloseTo(depart[1], 3);
    const [px, py] = obj("l1").querySelector(".pointe").getAttribute("points").split(" ")[0].split(",").map(Number);
    expect(px).toBeCloseTo(arrivee[0], 3);
    expect(py).toBeCloseTo(arrivee[1], 3);
  };
  // Bord droit de « Début », bord gauche de « Fin ».
  bords([260, 140], [400, 140]);
  // La flèche suit « Fin » déplacée de 200 px vers le bas et touche toujours les deux bords.
  glisser(obj("b2").querySelector("rect"), [480, 140], [480, 340]);
  expect(boite(dernier(), "b2").y).toBe(300);
  // Le bord haut de « Fin » et le bord bas de « Début » limitent la droite entre les centres (180, 140) et (480, 340).
  bords([240, 180], [420, 300]);
});

test("REQ130_AC3_vide_boite_de_depart_et_doublon_ne_creent_rien_sens_inverse_cree", () => {
  monter();
  clic(obj("b1").querySelector("rect"));
  glisser(poignee("liaison"), [278, 140], [700, 500]);
  glisser(poignee("liaison"), [278, 140], [150, 140]);
  expect(changements).toEqual([]);
  glisser(poignee("liaison"), [278, 140], [480, 140]);
  glisser(poignee("liaison"), [278, 140], [480, 140]);
  expect(dernier().links).toHaveLength(1);
  clic(obj("b2").querySelector("rect"));
  glisser(poignee("liaison"), [578, 140], [150, 140]);
  expect(dernier().links).toEqual([
    { id: "l1", from: "b1", to: "b2" },
    { id: "l2", from: "b2", to: "b1" },
  ]);
});

test("REQ130_AC5_fleche_provisoire_et_cible_surlignee_retirees_au_lacher_hors_d_une_boite", () => {
  monter();
  clic(obj("b1").querySelector("rect"));
  ptr(poignee("liaison"), "pointerdown", 278, 140);
  ptr(surface(), "pointermove", 480, 140);
  expect(t.element.querySelectorAll("g.fleche.provisoire")).toHaveLength(1);
  expect(obj("b2").classList.contains("cible")).toBe(true);
  expect(obj("b1").classList.contains("cible")).toBe(false);
  ptr(surface(), "pointermove", 700, 500);
  expect(obj("b2").classList.contains("cible")).toBe(false);
  ptr(surface(), "pointerup", 700, 500);
  expect(t.element.querySelector("g.fleche.provisoire")).toBeNull();
  expect(changements).toEqual([]);
});

test("REQ131_AC1_tirer_une_partie_vide_deplace_la_vue_sans_changer_le_document", () => {
  monter();
  const dessin = surface().querySelector("svg");
  glisser(dessin, [600, 500], [500, 500]);
  expect(vues.at(-1)).toEqual({ x: 100, y: 0, zoom: 1 });
  expect(dessin.getAttribute("viewBox")).toBe("100 0 800 600");
  expect(changements).toEqual([]);
});

test("REQ131_AC1_molette_et_maj_molette_font_defiler_la_vue", () => {
  monter();
  const roue = (opts) => {
    const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...opts });
    surface().dispatchEvent(e);
    return e;
  };
  expect(roue({ deltaY: 50 }).defaultPrevented).toBe(true);
  expect(vues.at(-1)).toMatchObject({ x: 0, y: 50 });
  roue({ deltaY: 30, shiftKey: true });
  expect(vues.at(-1)).toMatchObject({ x: 30, y: 50 });
  expect(changements).toEqual([]);
});

test("REQ131_AC2_ctrl_molette_zoome_autour_du_pointeur_dans_les_bornes", () => {
  monter();
  const roue = (deltaY, x = 300, y = 200) => {
    const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY, clientX: x, clientY: y });
    surface().dispatchEvent(e);
    return e;
  };
  expect(roue(-100).defaultPrevented).toBe(true);
  const v = vues.at(-1);
  expect(v.zoom).toBeCloseTo(1.1, 5);
  expect(v.x + 300 / v.zoom).toBeCloseTo(300, 0);
  expect(v.y + 200 / v.zoom).toBeCloseTo(200, 0);
  for (let i = 0; i < 40; i++) roue(-100);
  expect(vues.at(-1).zoom).toBe(4);
  for (let i = 0; i < 80; i++) roue(100);
  expect(vues.at(-1).zoom).toBe(0.25);
  expect(changements).toEqual([]);
});
