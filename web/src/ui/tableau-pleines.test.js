import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
const DOC = (boxes) => ({
  version: 1,
  boxes: boxes ?? [
    { id: "p1", x: 92, y: 192, width: 16, height: 16, text: "", shape: "dot" },
    { id: "r1", x: 0, y: 0, width: 120, height: 8, text: "", shape: "bar" },
    { id: "b2", x: 400, y: 100, width: 160, height: 80, text: "Fin" },
  ],
  links: [],
});

let t;
let changements;
function monter(doc = DOC(), vue = { x: 0, y: 0, zoom: 1 }) {
  changements = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue, surChangement: (d) => changements.push(d) });
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
const dernier = () => changements.at(-1);
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const ptr = (cible, type, x, y) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, "pointerId", { value: 1 });
  cible.dispatchEvent(e);
};
const touche = (key, opts = {}) => {
  const r = surface().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
  if (opts.ctrlKey && key === "v" && r) surface().dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));
  return r;
};
const num = (el, a) => Number(el.getAttribute(a));

test("REQ156_AC3_point_dessine_en_ellipse_pleine_barre_en_rectangle_a_angles_droits_sans_foreignObject", () => {
  monter(DOC([
    { id: "p1", x: 92, y: 192, width: 16, height: 16, text: "", shape: "dot", color: "red", weight: "thick" },
    { id: "p0", x: 0, y: 0, width: 16, height: 16, text: "", shape: "dot", color: "red", opacity: 0 },
    { id: "r1", x: 0, y: 100, width: 120, height: 8, text: "", shape: "bar", opacity: 25 },
  ]));
  const p = obj("p1");
  expect(p.querySelector(".forme").tagName).toBe("ellipse");
  expect(p.querySelector("foreignObject")).toBeNull();
  expect(p.classList.contains("couleur-red")).toBe(true);
  expect(p.classList.contains("epaisseur-thick")).toBe(true);
  expect(obj("p0").querySelector(".forme").getAttribute("fill-opacity")).toBe("0");
  const r = obj("r1");
  expect(r.querySelector(".forme").tagName).toBe("rect");
  expect(r.querySelector(".forme").getAttribute("rx")).toBeNull();
  expect(r.querySelector(".forme").getAttribute("fill-opacity")).toBe("0.25");
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  expect(css).toContain(".ya-tableau .boite.forme-pleine .forme { fill: var(--boite-trait); stroke: var(--boite-trait); stroke-width: var(--e); }");
  expect(css).toContain(".ya-tableau .boite.forme-pleine.couleur-default { --boite-trait: var(--ink); }");
});

test("REQ156_AC7_AC9_nom_et_anneau_de_2_px_a_3_px_du_contour_poignee_au_coin_de_l_anneau", () => {
  monter();
  expect(obj("p1").getAttribute("aria-roledescription")).toBe("boîte");
  expect(obj("p1").getAttribute("aria-label")).toBe("Point");
  expect(obj("r1").getAttribute("aria-label")).toBe("Barre");
  clic(obj("p1").querySelector(".forme"));
  const a = t.element.querySelector(".anneau");
  expect(a.tagName).toBe("ellipse");
  expect([num(a, "cx"), num(a, "cy"), num(a, "rx"), num(a, "ry")]).toEqual([100, 200, 12.5, 12.5]);
  const carre = t.element.querySelector(".poignees .carre");
  expect([num(carre, "x") + 4, num(carre, "y") + 4]).toEqual([112.5, 212.5]);
  expect(obj("p1").classList.contains("choisie")).toBe(true);
  clic(obj("r1").querySelector(".forme"));
  const b = t.element.querySelector(".anneau");
  expect(b.tagName).toBe("rect");
  expect([num(b, "x"), num(b, "y"), num(b, "x") + num(b, "width"), num(b, "y") + num(b, "height")]).toEqual([-4.5, -4.5, 124.5, 12.5]);
  const c2 = t.element.querySelector(".poignees .carre");
  expect([num(c2, "x") + 4, num(c2, "y") + 4]).toEqual([124.5, 12.5]);
});

test("REQ156_AC9_choisis_parmi_plusieurs_l_anneau_seul_et_au_zoom_200_anneau_et_poignee_gardent_leur_taille_ecran", () => {
  monter();
  touche("a", { ctrlKey: true });
  expect(t.element.querySelectorAll(".anneau")).toHaveLength(2);
  expect(t.element.querySelector(".poignees")).toBeNull();
  t.detruire();
  document.body.innerHTML = "";
  monter(DOC(), { x: 0, y: 0, zoom: 2 });
  clic(obj("p1").querySelector(".forme"));
  const a = t.element.querySelector(".anneau");
  expect(num(a, "rx")).toBe(8 + 4.5 / 2);
  const carre = t.element.querySelector(".poignees .carre");
  expect(num(carre, "width")).toBe(4);
  expect(num(carre, "x") + 2).toBe(108 + 4.5 / 2);
});

test("REQ156_AC5_AC8_quatre_connecteurs_au_survol_aucun_au_centre_prise_hors_de_la_forme_et_lien_depuis_le_droit", () => {
  monter();
  ptr(surface(), "pointermove", 100, 200);
  const prises = [...t.element.querySelectorAll("[data-connecteur]")];
  expect(prises.map((p) => p.getAttribute("data-connecteur")).sort()).toEqual(["bottom", "left", "right", "top"]);
  const ronds = [...t.element.querySelectorAll(".connecteur")];
  expect(ronds).toHaveLength(4);
  const droit = prises.find((p) => p.getAttribute("data-connecteur") === "right");
  // Zone de prise : à droite du côté de la forme (x >= 108), jamais sur la forme.
  expect(num(droit, "x")).toBe(108);
  // Glisser du connecteur droit vers « Fin » : lien depuis le côté droit.
  ptr(droit, "pointerdown", 112, 200);
  ptr(surface(), "pointermove", 300, 150);
  ptr(surface(), "pointermove", 420, 140);
  ptr(surface(), "pointerup", 420, 140);
  expect(dernier().links).toEqual([expect.objectContaining({ from: "p1", to: "b2", fromSide: "right" })]);
  // Le lien part du milieu du côté droit, sur le bord du point.
  const d = t.element.querySelector("g.lien .trait").getAttribute("d");
  expect(d.startsWith("M 108 200")).toBe(true);
});

test("REQ156_AC8_glisser_depuis_le_centre_deplace_le_point_sans_lien", () => {
  monter();
  ptr(obj("p1").querySelector(".forme"), "pointerdown", 100, 200);
  ptr(surface(), "pointermove", 115, 200);
  ptr(surface(), "pointermove", 130, 200);
  ptr(surface(), "pointerup", 130, 200);
  expect(dernier().links).toEqual([]);
  expect(dernier().boxes.find((b) => b.id === "p1").x).toBe(122);
});

test("REQ156_AC5_deplacer_le_point_le_lien_qui_part_de_son_cote_droit_le_suit", () => {
  const doc = DOC();
  doc.links = [{ id: "l1", from: "p1", to: "b2", fromSide: "right", toSide: "left" }];
  monter(doc);
  expect(t.element.querySelector("g.lien .trait").getAttribute("d").startsWith("M 108 200")).toBe(true);
  ptr(obj("p1").querySelector(".forme"), "pointerdown", 100, 200);
  ptr(surface(), "pointermove", 115, 200);
  ptr(surface(), "pointermove", 130, 200);
  ptr(surface(), "pointerup", 130, 200);
  const x = dernier().boxes.find((b) => b.id === "p1").x;
  expect(x).toBe(122);
  expect(t.element.querySelector("g.lien .trait").getAttribute("d").startsWith(`M ${x + 16} 200`)).toBe(true);
});

test("REQ156_AC8_cible_d_un_lien_disque_a_la_taille_de_l_anneau_sous_la_forme_et_connecteur_le_plus_proche_plein", () => {
  monter(DOC([
    { id: "b2", x: 400, y: 100, width: 160, height: 80, text: "Fin" },
    { id: "p1", x: 92, y: 192, width: 16, height: 16, text: "", shape: "dot" },
  ]));
  ptr(t.element.querySelector("[data-id=b2]").querySelector(".forme"), "pointermove", 450, 140);
  const droit = t.element.querySelector('[data-connecteur="right"][data-boite="b2"]');
  ptr(droit, "pointerdown", 568, 140);
  ptr(surface(), "pointermove", 300, 200);
  ptr(surface(), "pointermove", 100, 200);
  const g = obj("p1");
  expect(g.classList.contains("cible")).toBe(true);
  const sur = g.querySelector(".surcouche");
  expect(sur.tagName).toBe("ellipse");
  expect(num(sur, "rx")).toBe(12.5);
  expect(g.firstElementChild).toBe(sur);
  const pleins = t.element.querySelectorAll('.connecteur.plein');
  expect(pleins.length).toBeGreaterThan(0);
  ptr(surface(), "pointerup", 100, 200);
});

test("REQ156_AC5_copier_coller_supprimer_annuler_un_point", () => {
  const doc = DOC();
  doc.links = [{ id: "l1", from: "p1", to: "b2", fromSide: "right", toSide: "left" }];
  monter(doc);
  clic(obj("p1").querySelector(".forme"));
  touche("c", { ctrlKey: true });
  touche("v", { ctrlKey: true });
  const copie = dernier().boxes.filter((b) => b.shape === "dot");
  expect(copie).toHaveLength(2);
  expect(copie[1].color).toBe(copie[0].color);
  touche("z", { ctrlKey: true });
  clic(obj("p1").querySelector(".forme"));
  touche("Delete");
  expect(dernier().boxes.filter((b) => b.shape === "dot")).toHaveLength(0);
  expect(dernier().links).toEqual([]);
  touche("z", { ctrlKey: true });
  expect(dernier().boxes.filter((b) => b.shape === "dot")).toHaveLength(1);
  expect(dernier().links).toHaveLength(1);
});

function luminance(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const contraste = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

test("REQ156_AC7_contraste_3_pour_1_des_couleurs_de_trait_et_de_l_encre_sur_la_surface_dans_les_deux_themes", () => {
  const blocs = tokens.split(/\n\}/);
  const themes = blocs.filter((b) => b.includes("--bg-200:") && b.includes("--boite-bleu-trait:"));
  expect(themes.length).toBeGreaterThanOrEqual(2);
  for (const b of themes) {
    const v = (n) => b.match(new RegExp(`${n}:\\s*(#[0-9a-fA-F]{6})`))[1];
    for (const n of ["--ink", "--boite-bleu-trait", "--boite-vert-trait", "--boite-jaune-trait", "--boite-orange-trait", "--boite-rouge-trait", "--boite-violet-trait"]) {
      expect(contraste(v(n), v("--bg-200"))).toBeGreaterThanOrEqual(3);
    }
  }
});
