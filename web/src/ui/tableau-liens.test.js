import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";

const css = readFileSync("web/src/ui/composants.css", "utf8");
const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 100, y: 100, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 400, y: 100, width: 160, height: 80, text: "Fin" },
    { id: "b3", x: 100, y: 300, width: 160, height: 80, text: "Autre" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left", color: "red" }],
});

let t;
let changements;
function monter(doc = DOC()) {
  changements = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue: { x: 0, y: 0, zoom: 1 }, surChangement: (d) => changements.push(d) });
  document.body.append(t.element);
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
const poignee = (nom) => t.element.querySelector(`[data-poignee="${nom}"]`);
const dernier = () => changements.at(-1);
const ptr = (cible, type, x, y) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, "pointerId", { value: 1 });
  cible.dispatchEvent(e);
};
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const choisirLien = () => clic(obj("l1").querySelector(".prise"));
// Glisse jusqu'à `vers` ; `pendant` est appelé avant le lâcher.
function glisser(cible, de, vers, pendant) {
  ptr(cible, "pointerdown", de[0], de[1]);
  ptr(surface(), "pointermove", (de[0] + vers[0]) / 2, (de[1] + vers[1]) / 2);
  ptr(surface(), "pointermove", vers[0], vers[1]);
  pendant?.();
  ptr(surface(), "pointerup", vers[0], vers[1]);
}

test("REQ142_AC1_AC7_glisser_la_poignee_d_arrivee_sur_une_autre_boite", () => {
  monter();
  choisirLien();
  expect(poignee("depart")).not.toBeNull();
  expect(poignee("arrivee")).not.toBeNull();
  glisser(poignee("arrivee"), [400, 140], [180, 305]);
  expect(changements).toHaveLength(1);
  expect(dernier().links).toEqual([{ id: "l1", from: "b1", to: "b3", fromSide: "right", toSide: "top", color: "red" }]);
  expect(dernier().boxes).toHaveLength(3);
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  expect(document.activeElement).toBe(surface());
  expect(surface().getAttribute("aria-activedescendant")).toBe(obj("l1").id);
  expect(obj("l1").getAttribute("aria-label")).toBe("De Début vers Autre");
});

test("REQ142_AC2_glisser_la_poignee_de_depart", () => {
  monter();
  choisirLien();
  glisser(poignee("depart"), [260, 140], [180, 175]);
  expect(dernier().links[0]).toMatchObject({ from: "b1", to: "b2", fromSide: "bottom", toSide: "left" });
  glisser(poignee("arrivee"), [400, 140], [180, 305]);
  expect(changements).toHaveLength(2);
  glisser(poignee("depart"), [180, 180], [480, 140]);
  expect(changements).toHaveLength(3);
  expect(dernier().links[0]).toMatchObject({ id: "l1", from: "b2", to: "b3", toSide: "top" });
  expect(dernier().boxes).toHaveLength(3);
});

test("REQ142_AC3_lien_sans_cote_l_autre_bout_prend_le_cote_le_plus_proche", () => {
  const doc = DOC();
  doc.links = [{ id: "l1", from: "b1", to: "b2" }];
  monter(doc);
  choisirLien();
  const p = poignee("arrivee");
  const [cx, cy] = [Number(p.getAttribute("x")) + 8, Number(p.getAttribute("y")) + 8];
  glisser(p, [cx, cy], [480, 105]);
  expect(dernier().links[0]).toEqual({ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "top" });
});

test("REQ142_AC4_lachers_rates_ne_changent_rien_et_le_lien_reste_choisi", () => {
  const doc = DOC();
  doc.links.push({ id: "l2", from: "b1", to: "b3" });
  monter(doc);
  choisirLien();
  glisser(poignee("arrivee"), [400, 140], [700, 500]);
  glisser(poignee("arrivee"), [400, 140], [180, 140]);
  glisser(poignee("arrivee"), [400, 140], [180, 330]);
  ptr(poignee("arrivee"), "pointerdown", 400, 140);
  ptr(surface(), "pointermove", 402, 140);
  ptr(surface(), "pointerup", 402, 140);
  expect(changements).toEqual([]);
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  expect(poignee("arrivee")).not.toBeNull();
  expect(obj("l1")).not.toBeNull();
});

test("REQ142_AC4_un_lien_de_sens_contraire_n_empeche_pas_le_rattachement", () => {
  const doc = DOC();
  doc.links.push({ id: "l2", from: "b3", to: "b1" });
  monter(doc);
  choisirLien();
  glisser(poignee("arrivee"), [400, 140], [180, 305]);
  expect(dernier().links[0]).toMatchObject({ id: "l1", to: "b3", toSide: "top" });
});

test("REQ142_AC5_pas_de_poignee_a_plusieurs_objets_outil_cercle_et_poignee_sur_connecteur", () => {
  monter();
  surface().dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }));
  expect(t.element.querySelector("[data-poignee]")).toBeNull();
  surface().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  choisirLien();
  t.element.querySelector('.ya-tableau-outils [aria-label="Cercle"]').click();
  glisser(poignee("arrivee"), [400, 140], [180, 305]);
  expect(dernier().links[0]).toMatchObject({ to: "b3" });
  expect(dernier().boxes).toHaveLength(3);
  expect(changements).toHaveLength(1);
});

test("REQ142_AC5_poignee_posee_sur_un_connecteur_passe_devant_lui", () => {
  monter();
  choisirLien();
  ptr(surface(), "pointermove", 400, 140);
  expect(t.element.querySelector(".connecteur.plein")).toBeNull();
  const dessin = t.element.querySelector("svg");
  const ordre = [...dessin.children];
  expect(ordre.indexOf(t.element.querySelector(".poignees"))).toBeGreaterThan(ordre.indexOf(t.element.querySelector(".connecteurs")));
  glisser(poignee("arrivee"), [400, 140], [180, 305]);
  expect(changements).toHaveLength(1);
  expect(dernier().links).toHaveLength(1);
});

test("REQ142_AC6_ronds_masques_provisoire_surlignage_et_rien_sur_la_boite_de_l_autre_bout", () => {
  monter();
  choisirLien();
  const g = t.element.querySelector(".poignees");
  expect(g.getAttribute("aria-hidden")).toBe("true");
  expect(g.querySelectorAll(".bout")).toHaveLength(2);
  expect(css).toMatch(/\.poignees \.bout \{ fill: var\(--accent-fg\)/);
  expect(css).toMatch(/\.prise\[data-poignee="arrivee"\] \{ cursor: crosshair/);
  const arrivee = poignee("arrivee");
  ptr(arrivee, "pointerdown", 400, 140);
  ptr(surface(), "pointermove", 300, 200);
  ptr(surface(), "pointermove", 180, 330);
  expect(surface().classList.contains("crosshair")).toBe(true);
  expect(obj("l1")).toBeNull();
  const prov = t.element.querySelector(".fleche.provisoire");
  expect(prov).not.toBeNull();
  expect(prov.querySelectorAll(".pointe")).toHaveLength(1);
  expect(obj("b3").classList.contains("cible")).toBe(true);
  expect(t.element.querySelectorAll(".connecteur.plein")).toHaveLength(1);
  expect(t.element.querySelectorAll("[data-boite]:not([data-boite=b3])")).toHaveLength(0);
  ptr(surface(), "pointermove", 100, 130);
  expect(obj("b1").classList.contains("cible")).toBe(false);
  expect(t.element.querySelector(".connecteur.plein")).toBeNull();
  ptr(surface(), "pointermove", 450, 130);
  expect(obj("b2").classList.contains("cible")).toBe(true);
  ptr(surface(), "pointermove", 130, 130);
  ptr(surface(), "pointerup", 130, 130);
  expect(changements).toEqual([]);
});

test("REQ142_AC6_depart_glisse_sur_la_boite_de_l_autre_bout_n_est_pas_surligne", () => {
  monter();
  choisirLien();
  ptr(poignee("depart"), "pointerdown", 260, 140);
  ptr(surface(), "pointermove", 300, 140);
  ptr(surface(), "pointermove", 480, 140);
  expect(obj("b2").classList.contains("cible")).toBe(false);
  expect(t.element.querySelector(".connecteur.plein")).toBeNull();
  ptr(surface(), "pointermove", 180, 330);
  expect(obj("b3").classList.contains("cible")).toBe(true);
  ptr(surface(), "pointerup", 180, 330);
  expect(dernier().links[0]).toMatchObject({ from: "b3", fromSide: "top", to: "b2" });
});
