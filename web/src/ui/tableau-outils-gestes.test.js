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
const AVEC_FLECHE = () => ({ ...DOC(), arrows: [{ id: "a1", x1: 100, y1: 300, x2: 300, y2: 380 }] });

let t;
let changements;
let vues;
function monter(doc = DOC()) {
  changements = [];
  vues = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue: { x: 0, y: 0, zoom: 1 }, surChangement: (d) => changements.push(d), surVue: (v) => vues.push(v) });
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
const bouton = (nom) => t.element.querySelector(`.ya-tableau-outils [aria-label="${nom}"]`);
const outil = (nom) => bouton(nom).click();
const presse = (nom) => bouton(nom).getAttribute("aria-pressed");
const ptr = (cible, type, x, y) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, "pointerId", { value: 1 });
  cible.dispatchEvent(e);
};
const appui = (cible, x, y) => ptr(cible, "pointerdown", x, y);
const bouge = (x, y) => ptr(surface(), "pointermove", x, y);
const lache = (x, y) => ptr(surface(), "pointerup", x, y);
function glisser(cible, de, vers) {
  appui(cible, de[0], de[1]);
  bouge((de[0] + vers[0]) / 2, (de[1] + vers[1]) / 2);
  bouge(vers[0], vers[1]);
  lache(vers[0], vers[1]);
}
// Le `click` du navigateur suit `pointerup` ; il atteint le dessin quand le pointeur n'a pas été capturé.
const lacheClic = (x, y) => {
  lache(x, y);
  clic(surface().querySelector("svg"));
};
function glisserClic(cible, de, vers) {
  appui(cible, de[0], de[1]);
  bouge((de[0] + vers[0]) / 2, (de[1] + vers[1]) / 2);
  bouge(vers[0], vers[1]);
  lacheClic(vers[0], vers[1]);
}
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const touche = (key) => surface().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const poignee = (nom) => t.element.querySelector(`[data-poignee="${nom}"]`);

test("REQ133_AC2_forme_au_clic_a_sa_taille_centree_en_saisie_et_au_glisser_dans_tous_les_sens", () => {
  monter(DOC());
  outil("Losange");
  appui(surface(), 300, 300);
  lacheClic(300, 300);
  expect(dernier().boxes.at(-1)).toEqual({ id: "b3", x: 220, y: 250, width: 160, height: 100, text: "", shape: "diamond" });
  expect(document.activeElement).toBe(t.element.querySelector("[role=textbox]"));
  expect(presse("Choisir")).toBe("true");
  expect(presse("Losange")).toBe("false");
  // Un déplacement de 3 px au plus reste un clic.
  outil("Rectangle");
  appui(surface(), 600, 400);
  bouge(602, 401);
  lacheClic(602, 401);
  expect(dernier().boxes.at(-1)).toMatchObject({ id: "b4", x: 520, y: 360, width: 160, height: 80 });
  // Glisser : le rectangle des deux points.
  outil("Rectangle");
  glisserClic(surface(), [100, 300], [340, 420]);
  expect(dernier().boxes.at(-1)).toEqual({ id: "b5", x: 100, y: 300, width: 240, height: 120, text: "" });
  outil("Rectangle");
  glisserClic(surface(), [340, 520], [100, 460]);
  expect(dernier().boxes.at(-1)).toMatchObject({ x: 100, y: 460, width: 240, height: 60 });
  // Jamais sous 40 x 24 px.
  outil("Rectangle");
  glisserClic(surface(), [700, 500], [710, 510]);
  expect(dernier().boxes.at(-1)).toMatchObject({ x: 700, y: 500, width: 40, height: 24 });
});

test("REQ133_AC3_lien_de_boite_a_boite_sans_cote_sinon_rien_et_la_vue_suit_hors_boite", () => {
  monter(DOC());
  outil("Lien");
  glisserClic(obj("b1").querySelector("rect"), [150, 140], [450, 140]);
  expect(dernier().links).toEqual([{ id: "l1", from: "b1", to: "b2" }]);
  expect(dernier().boxes).toEqual(DOC().boxes);
  expect(presse("Choisir")).toBe("true");
  expect(surface().getAttribute("aria-activedescendant")).toBe(obj("l1").id);
  expect(document.activeElement).toBe(surface());
  // Lâcher hors d'une boîte : rien, l'outil reste.
  const n = changements.length;
  outil("Lien");
  glisser(obj("b1").querySelector("rect"), [150, 140], [700, 500]);
  expect(changements.length).toBe(n);
  expect(presse("Lien")).toBe("true");
  // Lâcher sur la boîte de départ : rien.
  glisser(obj("b1").querySelector("rect"), [150, 140], [160, 150]);
  expect(changements.length).toBe(n);
  // Appui hors d'une boîte : la vue suit.
  glisser(surface(), [300, 300], [250, 270]);
  expect(vues.at(-1)).toEqual({ x: 50, y: 30, zoom: 1 });
  expect(changements.length).toBe(n);
  expect(presse("Lien")).toBe("true");
});

test("REQ133_AC10_pointeur_crosshair_et_forme_provisoire_en_tirets", () => {
  monter(DOC());
  expect(surface().classList.contains("crosshair")).toBe(false);
  outil("Rectangle");
  expect(surface().classList.contains("crosshair")).toBe(true);
  expect(css).toMatch(/\.ya-tableau-surface\.crosshair \{[^}]*cursor: crosshair/);
  appui(surface(), 100, 300);
  bouge(200, 360);
  bouge(340, 420);
  const p = t.element.querySelector("g.provisoire.forme-provisoire rect");
  expect(p).not.toBeNull();
  expect([p.getAttribute("x"), p.getAttribute("y"), p.getAttribute("width"), p.getAttribute("height")]).toEqual(["100", "300", "240", "120"]);
  expect(css).toMatch(/\.provisoire \.forme \{[^}]*stroke: var\(--accent-fg\)[^}]*stroke-dasharray: 4 4/);
  lacheClic(340, 420);
  expect(document.activeElement).toBe(t.element.querySelector("[role=textbox]"));
  expect(t.element.querySelector("g.provisoire")).toBeNull();
  expect(surface().classList.contains("crosshair")).toBe(false);
  outil("Flèche");
  expect(surface().classList.contains("crosshair")).toBe(true);
  outil("Lien");
  expect(surface().classList.contains("crosshair")).toBe(true);
  outil("Choisir");
  expect(surface().classList.contains("crosshair")).toBe(false);
});

test("REQ134_AC1_cercle_au_clic_100_x_100_centre_et_texte_enregistre", () => {
  monter(DOC());
  outil("Cercle");
  appui(surface(), 300, 300);
  lacheClic(300, 300);
  const zone = t.element.querySelector("[role=textbox]");
  expect(dernier().boxes.at(-1)).toEqual({ id: "b3", x: 250, y: 250, width: 100, height: 100, text: "", shape: "ellipse" });
  zone.textContent = "A";
  zone.dispatchEvent(new Event("input", { bubbles: true }));
  zone.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(dernier().boxes.at(-1)).toEqual({ id: "b3", x: 250, y: 250, width: 100, height: 100, text: "A", shape: "ellipse" });
});

test("REQ136_AC1_fleche_libre_tracee_choisie_au_style_choisi_et_provisoire_en_tirets", () => {
  monter(DOC());
  outil("Tirets");
  outil("Flèche");
  appui(surface(), 100, 300);
  bouge(200, 340);
  const prov = t.element.querySelector("g.fleche.provisoire");
  expect(prov).not.toBeNull();
  expect(prov.querySelector(".trait").getAttribute("d")).toBe("M 100 300 L 200 340");
  expect(prov.querySelectorAll(".pointe")).toHaveLength(1);
  bouge(300, 380);
  lacheClic(300, 380);
  expect(t.element.querySelector("g.provisoire")).toBeNull();
  expect(dernier().arrows).toEqual([{ id: "a1", x1: 100, y1: 300, x2: 300, y2: 380, line: "dashed" }]);
  expect(presse("Choisir")).toBe("true");
  expect(document.activeElement).toBe(surface());
  expect(surface().getAttribute("aria-activedescendant")).toBe(obj("a1").id);
  expect(obj("a1").classList.contains("choisie")).toBe(true);
  // La flèche suivante : bouts, tracé et trait gardés.
  outil("Flèche");
  glisserClic(surface(), [100, 500], [300, 400]);
  expect(dernier().arrows[1]).toMatchObject({ id: "a2", x1: 100, y1: 500, x2: 300, y2: 400 });
});

test("REQ136_AC2_poignee_de_bout_et_trait_deplacent_la_fleche_positions_arrondies", () => {
  monter(AVEC_FLECHE());
  clic(obj("a1").querySelector(".prise"));
  glisser(poignee("arrivee"), [300, 380], [350, 380]);
  expect(dernier().arrows[0]).toEqual({ id: "a1", x1: 100, y1: 300, x2: 350, y2: 380 });
  glisser(poignee("depart"), [100, 300], [80, 290]);
  expect(dernier().arrows[0]).toEqual({ id: "a1", x1: 80, y1: 290, x2: 350, y2: 380 });
  glisser(obj("a1").querySelector(".prise"), [200, 335], [200, 355]);
  expect(dernier().arrows[0]).toEqual({ id: "a1", x1: 80, y1: 310, x2: 350, y2: 400 });
  expect(surface().getAttribute("aria-activedescendant")).toBe(obj("a1").id);
  touche("ArrowDown");
  expect(dernier().arrows[0]).toMatchObject({ y1: 320, y2: 410 });
});

test("REQ136_AC2_glisser_le_trait_d_une_fleche_non_choisie_la_choisit_et_suit_le_zoom", () => {
  monter(AVEC_FLECHE());
  glisser(obj("a1").querySelector(".prise"), [200, 340], [220, 360]);
  expect(dernier().arrows[0]).toMatchObject({ x1: 120, y1: 320, x2: 320, y2: 400 });
  expect(obj("a1").classList.contains("choisie")).toBe(true);
});

test("REQ136_AC3_fleche_de_moins_de_3_px_ne_cree_rien_et_suppr_efface_la_fleche", () => {
  monter(AVEC_FLECHE());
  outil("Flèche");
  glisser(surface(), [500, 500], [502, 500]);
  expect(changements).toEqual([]);
  expect(presse("Flèche")).toBe("true");
  outil("Choisir");
  clic(obj("a1").querySelector(".prise"));
  touche("Delete");
  expect(dernier().arrows).toEqual([]);
  expect(dernier().boxes).toHaveLength(2);
  // Déplacer une boîte posée sur la flèche ne la bouge pas.
  monter(AVEC_FLECHE());
  glisser(obj("b1").querySelector("rect"), [150, 140], [150, 290]);
  expect(dernier().arrows).toEqual(AVEC_FLECHE().arrows);
});

test("REQ136_AC6_pointeurs_et_focus_apres_creation", () => {
  expect(css).toMatch(/\.fleche \.prise \{[^}]*cursor: move/);
  expect(css).toMatch(/data-poignee="depart"\][^{]*\{[^}]*cursor: crosshair/);
  expect(css).toMatch(/\.provisoire \.trait \{[^}]*stroke: var\(--accent-fg\)[^}]*stroke-dasharray: 4 4/);
  monter(DOC());
  outil("Flèche");
  glisserClic(surface(), [100, 500], [300, 400]);
  expect(document.activeElement).toBe(surface());
  expect(surface().getAttribute("aria-activedescendant")).toBe(obj("a1").id);
  expect(poignee("depart")).not.toBeNull();
  expect(poignee("arrivee")).not.toBeNull();
});
