import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";

const css = readFileSync("web/src/ui/composants.css", "utf8");
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

const survol = (x, y) => ptr(surface(), "pointermove", x, y);
const connecteursDe = (id) => [...t.element.querySelectorAll(`.connecteurs [data-boite="${id}"]`)].map((c) => c.getAttribute("data-connecteur"));
const connecteur = (id, cote) => t.element.querySelector(`.connecteurs [data-boite="${id}"][data-connecteur="${cote}"]`);
const rond = (id, cote) => connecteur(id, cote).nextElementSibling;

test("REQ130_AC1_AC2_connecteurs_proches_puis_lien_du_cote_droit_au_cote_gauche", () => {
  monter();
  survol(270, 140);
  expect(connecteursDe("b1")).toEqual(["top", "right", "bottom", "left", "center"]);
  expect(connecteursDe("b2")).toEqual([]);
  expect([...t.element.querySelectorAll(".connecteurs .connecteur")].map((c) => c.getAttribute("r"))).toEqual(["4", "4", "4", "4", "4"]);
  survol(330, 140);
  expect(t.element.querySelectorAll(".connecteurs *")).toHaveLength(0);
  survol(270, 140);
  glisser(connecteur("b1", "right"), [260, 140], [410, 140]);
  expect(dernier().links).toEqual([{ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left" }]);
  expect(obj("l1").getAttribute("aria-label")).toBe("De Début vers Fin");
  const bords = (depart, arrivee) => {
    const [, x1, y1] = obj("l1").querySelector(".trait").getAttribute("d").split(" ");
    expect(Number(x1)).toBeCloseTo(depart[0], 1);
    expect(Number(y1)).toBeCloseTo(depart[1], 1);
    const [px, py] = obj("l1").querySelector(".pointe").getAttribute("points").split(" ")[0].split(",").map(Number);
    expect(px).toBeCloseTo(arrivee[0], 1);
    expect(py).toBeCloseTo(arrivee[1], 1);
  };
  bords([260, 140], [400, 140]);
  // « Fin » 200 px plus bas : le lien garde ses côtés.
  glisser(obj("b2").querySelector("rect"), [480, 140], [480, 340]);
  expect(boite(dernier(), "b2").y).toBe(300);
  bords([260, 140], [400, 340]);
});

test("REQ129_AC10_REQ130_AC8_aucun_connecteur_en_saisie_ni_pendant_un_glisser_de_boite", () => {
  monter();
  survol(270, 140);
  expect(connecteursDe("b1")).toHaveLength(5);
  obj("b1").querySelector("rect").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
  expect(t.element.querySelectorAll(".connecteurs *")).toHaveLength(0);
  survol(270, 141);
  expect(t.element.querySelectorAll(".connecteurs *")).toHaveLength(0);
  t.element.querySelector("[role=textbox]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  survol(270, 140);
  ptr(obj("b1").querySelector("rect"), "pointerdown", 150, 140);
  ptr(surface(), "pointermove", 200, 140);
  expect(t.element.querySelectorAll(".connecteurs *")).toHaveLength(0);
  ptr(surface(), "pointerup", 200, 140);
  // Masqués aux lecteurs d'écran, jamais un arrêt de Tab.
  survol(360, 140);
  const couche = t.element.querySelector(".connecteurs");
  expect(couche.getAttribute("aria-hidden")).toBe("true");
  expect(couche.querySelector("[tabindex]")).toBeNull();
});

test("REQ130_AC3_vide_ou_boite_de_depart_ne_creent_rien_doublon_refuse_sens_inverse_cree", () => {
  monter();
  survol(270, 140);
  glisser(connecteur("b1", "right"), [260, 140], [700, 500]);
  survol(270, 140);
  glisser(connecteur("b1", "right"), [260, 140], [150, 140]);
  expect(changements).toEqual([]);
  survol(270, 140);
  glisser(connecteur("b1", "right"), [260, 140], [410, 140]);
  survol(270, 140);
  glisser(connecteur("b1", "bottom"), [180, 180], [480, 170]);
  expect(dernier().links).toEqual([{ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left" }]);
  survol(570, 140);
  glisser(connecteur("b2", "right"), [560, 140], [250, 140]);
  expect(dernier().links).toEqual([
    { id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left" },
    { id: "l2", from: "b2", to: "b1", fromSide: "right", toSide: "right" },
  ]);
});

test("REQ130_AC5_AC6_lien_provisoire_cible_et_connecteur_le_plus_proche_surlignes", () => {
  monter();
  clic(obj("b1").querySelector("rect"));
  survol(270, 140);
  ptr(connecteur("b1", "right"), "pointerdown", 260, 140);
  ptr(surface(), "pointermove", 420, 150);
  expect(t.element.querySelectorAll("g.fleche.provisoire")).toHaveLength(1);
  const [, x1, y1] = t.element.querySelector("g.fleche.provisoire .trait").getAttribute("d").split(" ");
  expect([Number(x1), Number(y1)]).toEqual([260, 140]);
  expect(obj("b2").classList.contains("cible")).toBe(true);
  expect(obj("b1").classList.contains("cible")).toBe(false);
  expect(connecteursDe("b2")).toHaveLength(5);
  const pleins = [...t.element.querySelectorAll(".connecteur.plein")];
  expect(pleins).toHaveLength(2);
  expect(rond("b1", "right").getAttribute("class")).toContain("plein");
  expect(rond("b2", "left").getAttribute("class")).toContain("plein");
  expect(rond("b2", "left").getAttribute("r")).toBe("5");
  ptr(surface(), "pointermove", 700, 500);
  expect(obj("b2").classList.contains("cible")).toBe(false);
  ptr(surface(), "pointerup", 700, 500);
  expect(t.element.querySelector("g.fleche.provisoire")).toBeNull();
  expect(changements).toEqual([]);
});

test("REQ130_AC9_connecteur_sous_le_pointeur_plein_crosshair_taille_prioritaire_sur_petite_boite", () => {
  monter({ version: 1, boxes: [{ id: "b1", x: 100, y: 100, width: 40, height: 24, text: "" }, { id: "b2", x: 400, y: 100, width: 160, height: 80, text: "Fin" }], links: [] });
  survol(120, 112);
  expect(rond("b1", "right").getAttribute("r")).toBe("4");
  survol(141, 112);
  expect(rond("b1", "right").getAttribute("r")).toBe("5");
  expect(rond("b1", "right").getAttribute("class")).toBe("connecteur plein");
  expect(css).toMatch(/\.connecteurs \.prise \{[^}]*cursor: crosshair/);
  expect(css).toMatch(/\.connecteurs \.connecteur \{[^}]*fill: var\(--bg-200\); stroke: var\(--ink-muted\)/);
  expect(css).toMatch(/\.connecteur\.plein \{ fill: var\(--accent-fg\)/);
  clic(obj("b1").querySelector("rect"));
  // Boîte choisie : la poignée de taille l'emporte au coin bas droit.
  survol(140, 112);
  expect(poignee("taille")).not.toBeNull();
  expect(connecteursDe("b1")).toHaveLength(4);
  expect(rond("b1", "right").getAttribute("class")).toBe("connecteur plein");
  survol(140, 119);
  expect(t.element.querySelector(".connecteur.plein")).toBeNull();
  expect(t.element.querySelector(".connecteurs").compareDocumentPosition(t.element.querySelector(".poignees")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  glisser(poignee("taille"), [140, 124], [200, 150]);
  expect(boite(dernier(), "b1")).toMatchObject({ width: 100, height: 50 });
  expect(dernier().links).toEqual([]);
  // Outil « Cercle » actif : un connecteur donne un lien, aucune boîte.
  const n = changements.length;
  t.element.querySelector(".ya-tableau-outils [aria-label=Cercle]").click();
  survol(141, 112);
  glisser(connecteur("b1", "right"), [140, 112], [450, 140]);
  expect(changements.length).toBe(n + 1);
  expect(dernier().links).toHaveLength(1);
  expect(dernier().boxes.some((b) => b.shape === "ellipse")).toBe(false);
  expect(dernier().boxes).toHaveLength(2);
});

test("REQ130_AC10_lien_cree_choisi_boite_a_outils_sur_le_style_choisi_et_vide_garde_le_choix", () => {
  monter();
  clic(obj("b2").querySelector("rect"));
  survol(270, 140);
  glisser(connecteur("b1", "right"), [260, 140], [700, 500]);
  expect(changements).toEqual([]);
  expect(surface().getAttribute("aria-activedescendant")).toBe(obj("b2").id);
  expect(t.element.querySelector(".ya-tableau-outils [aria-label=Tirets]")).not.toBeNull();
  t.element.querySelector(".ya-tableau-outils [aria-label=Tirets]").click();
  survol(270, 140);
  glisser(connecteur("b1", "right"), [260, 140], [410, 140]);
  expect(dernier().links).toEqual([{ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left", line: "dashed" }]);
  expect(surface().getAttribute("aria-activedescendant")).toBe(obj("l1").id);
  expect(document.activeElement).toBe(surface());
  expect(t.element.querySelector(".ya-tableau-outils [aria-label=Tirets]").getAttribute("aria-pressed")).toBe("true");
  expect(t.element.querySelector(".ya-tableau-outils [aria-label=Droit]").getAttribute("aria-pressed")).toBe("true");
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

test("REQ129_AC3_double_clic_comme_le_navigateur_sur_une_boite_non_choisie_lance_la_saisie", () => {
  monter();
  let cible;
  for (let i = 0; i < 2; i++) {
    cible = obj("b1").querySelector("rect");
    ptr(cible, "pointerdown", 150, 140);
    ptr(cible, "pointerup", 150, 140);
    cible.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: i + 1 }));
  }
  cible.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0, detail: 2 }));
  const zone = t.element.querySelector("[role=textbox]");
  expect(zone).not.toBeNull();
  expect(document.activeElement).toBe(zone);
});

// ---- Connecteur du centre (REQ-130, AC-130-9 à AC-130-16) ----
const TROIS = () => ({ ...DOC(), boxes: [...DOC().boxes, { id: "b3", x: 100, y: 300, width: 160, height: 80, text: "Autre" }] });
const seule = (width, height) => ({ version: 1, boxes: [{ id: "b1", x: 100, y: 100, width, height, text: "" }], links: [] });
const pleinsDe = () => [...t.element.querySelectorAll(".connecteur.plein")];
const departTrait = (id) => obj(id).querySelector(".trait").getAttribute("d").split(" ").slice(1, 3).map(Number);

test("REQ130_AC11_lacher_pres_du_centre_donne_toSide_center_et_le_lien_s_arrete_au_bord", () => {
  monter();
  survol(270, 140);
  glisser(connecteur("b1", "right"), [260, 140], [470, 150]);
  expect(dernier().links).toEqual([{ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "center" }]);
  expect(departTrait("l1")).toEqual([260, 140]);
  const [px, py] = obj("l1").querySelector(".pointe").getAttribute("points").split(" ")[0].split(",").map(Number);
  expect(px).toBeCloseTo(400, 0);
  expect(py).toBeCloseTo(140, 0);
});

test("REQ130_AC12_centre_vers_centre_meme_trace_qu_un_lien_sans_cote_puis_poignee_sur_le_centre_de_b3", () => {
  monter(TROIS());
  survol(190, 140);
  glisser(connecteur("b1", "center"), [180, 140], [480, 140]);
  expect(dernier().links).toEqual([{ id: "l1", from: "b1", to: "b2", fromSide: "center", toSide: "center" }]);
  expect(departTrait("l1")).toEqual([260, 140]);
  const [px, py] = obj("l1").querySelector(".pointe").getAttribute("points").split(" ")[0].split(",").map(Number);
  expect([px, py]).toEqual([400, 140]);
  // Le lien est choisi : sa poignée d'arrivée, lâchée sur le centre de « Autre ».
  glisser(poignee("arrivee"), [400, 140], [180, 340]);
  expect(dernier().links[0]).toMatchObject({ id: "l1", to: "b3", toSide: "center", from: "b1", fromSide: "center" });
});

test("REQ130_AC13_clic_double_clic_et_glisser_dans_le_vide_depuis_le_centre", () => {
  monter();
  survol(180, 140);
  ptr(connecteur("b1", "center"), "pointerdown", 180, 140);
  ptr(surface(), "pointerup", 180, 140);
  clic(connecteur("b1", "center"));
  expect(obj("b1").classList.contains("choisie")).toBe(true);
  expect(changements).toEqual([]);
  expect(t.element.querySelector("g.fleche.provisoire")).toBeNull();
  connecteur("b1", "center").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 180, clientY: 140, button: 0 }));
  const zone = t.element.querySelector("[role=textbox]");
  expect(document.activeElement).toBe(zone);
  expect(getSelection().anchorOffset).toBe(5);
  zone.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  survol(180, 140);
  glisser(connecteur("b1", "center"), [180, 140], [650, 450]);
  expect(changements).toEqual([]);
  expect(obj("b1").querySelector("rect").getAttribute("x")).toBe("100");
  expect(t.element.querySelector("g.fleche.provisoire")).toBeNull();
});

test("REQ130_AC14_aspect_surlignage_de_la_cible_et_depart_du_provisoire_sur_le_bord", () => {
  monter();
  survol(185, 140);
  expect(rond("b1", "center").getAttribute("class")).toBe("connecteur plein");
  expect(rond("b1", "center").getAttribute("r")).toBe("5");
  survol(190, 160);
  expect(rond("b1", "center").getAttribute("r")).toBe("4");
  const couche = t.element.querySelector(".connecteurs");
  expect(couche.getAttribute("aria-hidden")).toBe("true");
  expect(couche.querySelector("[tabindex]")).toBeNull();
  ptr(connecteur("b1", "center"), "pointerdown", 180, 140);
  ptr(surface(), "pointermove", 300, 142);
  ptr(surface(), "pointermove", 470, 150);
  const [, x1, y1] = t.element.querySelector("g.fleche.provisoire .trait").getAttribute("d").split(" ").map(Number);
  expect(x1).toBeCloseTo(260, 1);
  expect(y1).toBeGreaterThan(140);
  expect(y1).toBeLessThan(145);
  expect(pleinsDe().map((c) => c.getAttribute("r"))).toEqual(["5", "5"]);
  expect(rond("b1", "center").getAttribute("class")).toContain("plein");
  expect(rond("b2", "center").getAttribute("class")).toContain("plein");
  ptr(surface(), "pointerup", 470, 150);
});

test("REQ130_AC15_centre_au_dessus_du_texte_crosshair_a_6_px_et_boite_deplacee_a_12_px", () => {
  monter();
  const texte = obj("b1").querySelector("text, .texte, foreignObject");
  const avant = obj("b1").innerHTML;
  survol(186, 140);
  expect(rond("b1", "center").getAttribute("class")).toContain("plein");
  expect(obj("b1").innerHTML).toBe(avant);
  expect(texte === null || obj("b1").contains(texte)).toBe(true);
  expect(obj("b1").compareDocumentPosition(t.element.querySelector(".connecteurs")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(css).toMatch(/\.connecteurs \.prise \{[^}]*cursor: crosshair/);
  expect(css).toMatch(/\.boite \.forme \{[^}]*cursor: move/);
  survol(192, 140);
  expect(pleinsDe()).toHaveLength(0);
  glisser(obj("b1").querySelector("rect"), [192, 140], [232, 140]);
  expect(boite(dernier(), "b1").x).toBe(140);
  expect(dernier().links).toEqual([]);
});

test("REQ130_AC16_le_centre_n_existe_qu_a_partir_de_64_px_a_l_ecran", () => {
  const nb = (doc, vue, pointeur) => {
    monter(doc, vue);
    survol(...pointeur);
    const n = connecteursDe("b1").length;
    t.detruire();
    return n;
  };
  expect(nb(seule(64, 24), { x: 0, y: 0, zoom: 1 }, [132, 112])).toBe(5);
  expect(nb(seule(40, 64), { x: 0, y: 0, zoom: 1 }, [120, 132])).toBe(5);
  expect(nb(seule(40, 24), { x: 0, y: 0, zoom: 1 }, [120, 112])).toBe(4);
  expect(nb(seule(56, 32), { x: 0, y: 0, zoom: 1.25 }, [160, 145])).toBe(5);
  expect(nb(seule(160, 80), { x: 0, y: 0, zoom: 0.25 }, [45, 35])).toBe(4);
  // 56 × 32 à 100 % : quatre connecteurs, un appui au milieu déplace la boîte.
  monter(seule(56, 32));
  survol(128, 116);
  expect(connecteursDe("b1")).toEqual(["top", "right", "bottom", "left"]);
  glisser(obj("b1").querySelector("rect"), [128, 116], [168, 116]);
  expect(boite(dernier(), "b1").x).toBe(140);
  expect(dernier().links).toEqual([]);
  t.detruire();
  // 160 × 80 à 25 % : un lien déjà attaché à son centre vise toujours son centre.
  const doc = { ...DOC(), links: [{ id: "l1", from: "b1", to: "b2", fromSide: "center", toSide: "center" }] };
  monter(doc, { x: 0, y: 0, zoom: 0.25 });
  expect(departTrait("l1")).toEqual([260, 140]);
});

test("REQ130_AC9_taille_prioritaire_sur_les_connecteurs_d_une_boite_choisie_de_40_par_24", () => {
  monter(seule(40, 24));
  clic(obj("b1").querySelector("rect"));
  survol(140, 124);
  expect(poignee("taille")).not.toBeNull();
  glisser(poignee("taille"), [140, 124], [180, 150]);
  expect(boite(dernier(), "b1")).toMatchObject({ width: 80, height: 50 });
  expect(dernier().links).toEqual([]);
});

test("REQ130_AC9_boite_choisie_poignee_de_taille_et_cinq_connecteurs", () => {
  monter();
  clic(obj("b1").querySelector("rect"));
  survol(150, 140);
  expect(poignee("taille")).not.toBeNull();
  expect(connecteursDe("b1")).toHaveLength(5);
});
