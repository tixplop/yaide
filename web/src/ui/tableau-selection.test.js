import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 40, y: 80, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 300, y: 80, width: 160, height: 80, text: "Fin" },
    { id: "b3", x: 40, y: 400, width: 160, height: 80, text: "Bas" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
  arrows: [{ id: "a1", x1: 100, y1: 300, x2: 300, y2: 300 }],
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
});

const surface = () => t.element.querySelector("[role=application]");
const barre = () => t.element.querySelector("[role=toolbar]");
const bt = (nom) => [...barre().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom);
const obj = (id) => t.element.querySelector(`[data-id="${id}"]`);
const dernier = () => changements.at(-1);
const choisis = () => [...t.element.querySelectorAll("g.choisie")].map((g) => g.getAttribute("data-id"));
const statut = () => t.element.querySelector("[role=status]");
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
function choisirTrois() {
  bt("Sélection").click();
  glisser(surface(), [20, 60], [480, 180]);
}

test("REQ137_AC1_AC7_selection_glisser_depuis_un_objet_choisit_et_revient_a_choisir", () => {
  monter();
  bt("Sélection").click();
  expect(surface().classList.contains("crosshair")).toBe(true);
  glisser(obj("b3").querySelector("rect"), [20, 60], [480, 180]);
  expect(choisis()).toEqual(["b1", "b2", "l1"]);
  expect(bt("Choisir").getAttribute("aria-pressed")).toBe("true");
  expect(surface().classList.contains("crosshair")).toBe(false);
  expect(changements).toHaveLength(0);
});

test("REQ137_AC7_AC9_rectangle_provisoire_tirets_choix_d_avant_garde_ni_poignee_ni_connecteur", async () => {
  monter();
  t.element.querySelector("[data-id=b3]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  bt("Sélection").click();
  ptr(surface(), "pointerdown", 20, 60);
  ptr(surface(), "pointermove", 100, 100);
  ptr(surface(), "pointermove", 300, 200);
  const r = t.element.querySelector("g.provisoire rect");
  expect(r.getAttribute("x")).toBe("20");
  expect(r.getAttribute("width")).toBe("280");
  expect(choisis()).toEqual(["b3"]);
  expect(css).toMatch(/\.ya-tableau \.provisoire \.forme \{ fill: none; stroke: var\(--accent-fg\); stroke-width: 1\.5px; stroke-dasharray: 4 4; \}/);
  ptr(surface(), "pointerup", 300, 200);
  expect(t.element.querySelector("g.provisoire")).toBeNull();
  choisirTrois();
  expect(t.element.querySelector(".poignees")).toBeNull();
  ptr(surface(), "pointermove", 120, 100);
  expect(t.element.querySelector(".connecteurs").childElementCount).toBe(0);
  await new Promise((fin) => setTimeout(fin, 5));
  obj("a1").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  obj("b1").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  ptr(surface(), "pointermove", 121, 100);
  expect(t.element.querySelector(".connecteurs").childElementCount).toBeGreaterThan(0);
  touche("a", { ctrlKey: true });
  bt("Sélection").click();
  glisser(surface(), [20, 60], [320, 500]);
  expect(choisis()).toEqual(["b1", "b3", "a1"]);
  expect(t.element.querySelector("[data-poignee]")).toBeNull();
  const e = touche("Enter");
  expect(t.element.querySelector("[role=textbox]")).toBeNull();
  expect(e.defaultPrevented).toBe(false);
});

test("REQ137_AC6_moins_de_3_px_ne_fait_rien_rectangle_vide_efface_le_choix", () => {
  monter();
  obj("b3").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  bt("Sélection").click();
  glisser(surface(), [600, 500], [602, 500]);
  surface().querySelector("svg").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(choisis()).toEqual(["b3"]);
  expect(bt("Sélection").getAttribute("aria-pressed")).toBe("true");
  glisser(surface(), [600, 500], [700, 560]);
  expect(choisis()).toEqual([]);
  expect(bt("Choisir").getAttribute("aria-pressed")).toBe("true");
});

test("REQ137_AC9_echap_pendant_le_glisser_efface_le_rectangle_sans_changer_le_choix", () => {
  monter();
  obj("b3").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  bt("Sélection").click();
  ptr(surface(), "pointerdown", 20, 60);
  ptr(surface(), "pointermove", 300, 200);
  expect(t.element.querySelector("g.provisoire")).not.toBeNull();
  touche("Escape");
  expect(t.element.querySelector("g.provisoire")).toBeNull();
  expect(choisis()).toEqual(["b3"]);
  expect(bt("Choisir").getAttribute("aria-pressed")).toBe("true");
  ptr(surface(), "pointerup", 300, 200);
  expect(choisis()).toEqual(["b3"]);
});

test("REQ137_AC2_glisser_un_objet_choisi_deplace_les_boites_et_fleches_choisies_fleches_clavier", () => {
  monter();
  choisirTrois();
  glisser(obj("b1").querySelector("rect"), [100, 120], [200, 120]);
  const d = dernier();
  expect(d.boxes.map((b) => [b.id, b.x])).toEqual([["b1", 140], ["b2", 400], ["b3", 40]]);
  expect(d.arrows[0]).toMatchObject({ x1: 100, x2: 300 });
  expect(choisis()).toEqual(["b1", "b2", "l1"]);
  touche("ArrowDown");
  expect(dernier().boxes.map((b) => b.y)).toEqual([90, 90, 400]);
  expect(choisis()).toEqual(["b1", "b2", "l1"]);
});

test("REQ137_AC2_glisser_une_boite_non_choisie_la_choisit_seule", () => {
  monter();
  choisirTrois();
  glisser(obj("b3").querySelector("rect"), [100, 440], [100, 500]);
  expect(choisis()).toEqual(["b3"]);
  expect(dernier().boxes.map((b) => b.x)).toEqual([40, 300, 40]);
  expect(dernier().boxes[2].y).toBe(460);
});

test("REQ137_AC3_ctrl_a_choisit_tout_suppr_efface_les_choisis_avec_leurs_liens", () => {
  monter();
  const e = touche("a", { ctrlKey: true });
  expect(e.defaultPrevented).toBe(true);
  expect(choisis()).toEqual(["b1", "b2", "b3", "l1", "a1"]);
  touche("Escape");
  bt("Sélection").click();
  glisser(surface(), [20, 60], [320, 500]);
  expect(choisis()).toEqual(["b1", "b3", "a1"]);
  touche("Delete");
  expect(dernier().boxes.map((b) => b.id)).toEqual(["b2"]);
  expect(dernier().links).toEqual([]);
  expect(dernier().arrows).toEqual([]);
  expect(choisis()).toEqual([]);
});

test("REQ137_AC6_ctrl_a_en_saisie_n_est_pas_intercepte", () => {
  monter();
  t.element.querySelector("g.boite rect").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
  const zone = t.element.querySelector("[role=textbox]");
  const e = touche("a", { ctrlKey: true }, zone);
  expect(e.defaultPrevented).toBe(false);
  expect(t.element.querySelector("[role=textbox]")).not.toBeNull();
  expect(choisis()).toEqual(["b1"]);
});

test("REQ137_AC8_aria_activedescendant_statut_tab_et_echap", () => {
  monter();
  expect(statut().textContent).toBe("");
  choisirTrois();
  expect(surface().getAttribute("aria-activedescendant")).toBe(obj("b1").id);
  expect(statut().textContent).toBe("3 objets choisis");
  expect(statut().classList.contains("masque")).toBe(true);
  touche("Tab");
  expect(choisis()).toEqual(["b2"]);
  expect(statut().textContent).toBe("");
  choisirTrois();
  touche("Escape");
  expect(choisis()).toEqual([]);
  expect(surface().hasAttribute("aria-activedescendant")).toBe(false);
  expect(statut().textContent).toBe("");
});

test("REQ137_AC8_AC129_13_aide_cite_ctrl_a_c_v", () => {
  monter();
  const aide = document.getElementById(surface().getAttribute("aria-describedby")).textContent;
  expect(aide).toContain("Ctrl+A : tout choisir. Ctrl+C, Ctrl+V : copier, coller.");
  expect(bt("Sélection").getAttribute("aria-label")).toBe("Sélection");
});

test("REQ133_AC10_outil_selection_pointeur_crosshair", () => {
  monter();
  expect(surface().classList.contains("crosshair")).toBe(false);
  bt("Sélection").click();
  expect(surface().classList.contains("crosshair")).toBe(true);
});

test("REQ137_AC4_copier_coller_deux_fois_puis_autre_onglet_et_lien_seul", async () => {
  monter();
  const a = t;
  const pa = changements;
  choisirTrois();
  touche("c", { ctrlKey: true });
  const e = touche("v", { ctrlKey: true });
  expect(e.defaultPrevented).toBe(true);
  expect(dernier().boxes.slice(3).map((b) => [b.id, b.x, b.y])).toEqual([["b4", 60, 100], ["b5", 320, 100]]);
  expect(choisis()).toEqual(["b4", "b5", "l2"]);
  expect(statut().textContent).toBe("3 objets choisis");
  touche("v", { ctrlKey: true });
  expect(dernier().boxes.slice(5).map((b) => [b.x, b.y])).toEqual([[80, 120], [340, 120]]);
  // autre instance : le presse-papiers est partagé
  const b = tableau({ nom: "b.jdiag", document: { version: 1, boxes: [], links: [], arrows: [] }, vue: { x: 0, y: 0, zoom: 1 }, surChangement: (d) => changements.push(d) });
  document.body.append(b.element);
  t = b;
  changements = [];
  touche("v", { ctrlKey: true }, b.element.querySelector("[role=application]"));
  expect(dernier().boxes.map((x) => [x.id, x.text, x.x])).toEqual([["b1", "Début", 100], ["b2", "Fin", 360]]);
  expect(dernier().links).toHaveLength(1);
  b.detruire();
  t = a;
  expect(pa.length).toBeGreaterThan(0);
  // lien seul : rien copié, rien collé
  await new Promise((r) => setTimeout(r, 0));
  t.element.querySelector("[data-id=l1]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  touche("c", { ctrlKey: true });
  expect(choisis()).toEqual(["l1"]);
  const n = changements.length;
  touche("v", { ctrlKey: true });
  expect(changements).toHaveLength(n);
});

test("REQ137_AC6_ctrl_c_et_v_en_saisie_ne_sont_pas_interceptes", () => {
  monter();
  t.element.querySelector("g.boite rect").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
  const zone = t.element.querySelector("[role=textbox]");
  expect(touche("v", { ctrlKey: true }, zone).defaultPrevented).toBe(false);
  expect(touche("c", { ctrlKey: true }, zone).defaultPrevented).toBe(false);
});
