import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ecrireJdiag } from "../jdiag.js";
import { tableau } from "./tableau.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 100, y: 100, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 400, y: 100, width: 160, height: 80, text: "Fin" },
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
});

const surface = () => t.element.querySelector("[role=application]");
const barre = () => t.element.querySelector("[role=toolbar]");
const bt = (nom) => [...barre().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom);
const presse = (nom) => bt(nom).getAttribute("aria-pressed");
const obj = (id) => t.element.querySelector(`[data-id="${id}"]`);
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const touche = (cible, key) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  cible.dispatchEvent(e);
  return e;
};
const dernier = () => changements.at(-1);
const choisieId = () => surface().getAttribute("aria-activedescendant");
const ptr = (cible, type, x, y) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, "pointerId", { value: 1 });
  cible.dispatchEvent(e);
};
function glisser(cible, de, vers) {
  ptr(cible, "pointerdown", de[0], de[1]);
  ptr(surface(), "pointermove", (de[0] + vers[0]) / 2, de[1]);
  ptr(surface(), "pointermove", vers[0], vers[1]);
  ptr(surface(), "pointerup", vers[0], vers[1]);
}
const doubleClic = (x, y) => surface().querySelector("svg").dispatchEvent(new MouseEvent("dblclick", { clientX: x, clientY: y, bubbles: true, cancelable: true }));

test("REQ133_AC1_AC11_boite_a_outils_apres_la_surface_choix_de_depart_et_illisible_sans_barre", () => {
  monter();
  expect(barre().getAttribute("aria-label")).toBe("Outils du whiteboard");
  expect(barre().parentElement).toBe(t.element);
  expect(t.element.querySelector(".ya-tableau").nextElementSibling).toBe(barre());
  expect(t.element.querySelector(".ya-tableau").contains(barre())).toBe(false);
  expect(["Choisir", "Par défaut", "100 %", "Normal", "Droit", "À l'arrivée", "Plein", "Fin"].map(presse)).toEqual(Array(8).fill("true"));
  expect(presse("Cercle")).toBe("false");
  expect(bt("Rectangle").getAttribute("aria-current")).toBe("true");
  t.definirDocument(null);
  expect(t.element.querySelector("[role=toolbar]")).toBeNull();
  t.definirDocument(DOC());
  expect(barre()).not.toBeNull();
  // Contour de focus : seulement sur la surface, la boîte à outils n'est pas dans l'élément qui le porte.
  expect(css).toMatch(/\.ya-tableau:focus-within \{[^}]*outline: var\(--trait\) solid var\(--accent-fg\)/);
  expect(css).toMatch(/\.ya-tableau-zone \{[^}]*position: relative/);
});

test("REQ129_AC12_AC13_la_forme_et_la_couleur_choisies_servent_au_double_clic_et_a_ajouter_une_boite", () => {
  monter({ version: 1, boxes: [], links: [] });
  bt("Cercle").click();
  bt("Vert").click();
  bt("Choisir").click();
  expect(bt("Cercle").getAttribute("aria-current")).toBe("true");
  doubleClic(300, 200);
  expect(dernier().boxes).toEqual([{ id: "b1", x: 250, y: 150, width: 100, height: 100, text: "", shape: "ellipse", color: "green" }]);
  expect(t.element.querySelector("[role=textbox]")).not.toBeNull();
  expect(presse("Choisir")).toBe("true");
  t.ajouterBoite();
  expect(dernier().boxes[1]).toEqual({ id: "b2", x: 350, y: 250, width: 100, height: 100, text: "", shape: "ellipse", color: "green" });
  expect(obj("b2").getAttribute("aria-roledescription")).toBe("boîte");
  // Losange : « Ajouter une boîte » le pose à sa taille, en saisie, et « Choisir » est pressé.
  bt("Losange").click();
  expect(presse("Losange")).toBe("true");
  t.ajouterBoite();
  expect(dernier().boxes[2]).toMatchObject({ width: 160, height: 100, shape: "diamond" });
  expect(presse("Choisir")).toBe("true");
  expect(presse("Losange")).toBe("false");
  expect(bt("Losange").getAttribute("aria-current")).toBe("true");
  expect(document.getElementById(surface().getAttribute("aria-describedby")).textContent).toBe(
    "Tab : objet suivant. Entrée : écrire dans la boîte. Flèches : déplacer. Suppr : effacer. Ctrl+A : tout choisir. Ctrl+C, Ctrl+V : copier, coller. Échap : ne plus rien choisir. O : boîte à outils.",
  );
});

test("REQ133_AC4_echap_avec_un_outil_revient_a_choisir_sans_toucher_a_la_selection", () => {
  monter();
  clic(obj("b1"));
  bt("Cercle").click();
  surface().focus();
  const e = touche(surface(), "Escape");
  expect(e.defaultPrevented).toBe(true);
  expect(presse("Choisir")).toBe("true");
  expect(presse("Cercle")).toBe("false");
  expect(changements).toEqual([]);
  expect(choisieId()).toMatch(/b1$/);
  touche(surface(), "Escape");
  expect(choisieId()).toBeNull();
});

test("REQ133_AC5_REQ133_AC6_sans_objet_aucun_changement_un_lien_choisi_change_et_montre_ses_valeurs", () => {
  monter();
  bt("Coudé").click();
  bt("Aucune").click();
  expect(changements).toEqual([]);
  clic(obj("l1"));
  expect(["Droit", "À l'arrivée", "Plein", "Fin"].map(presse)).toEqual(["true", "true", "true", "true"]);
  bt("Courbe").click();
  expect(changements).toHaveLength(1);
  expect(dernier().links[0]).toMatchObject({ route: "curved" });
  bt("Courbe").click();
  expect(changements).toHaveLength(1);
  // L'opacité et la taille du texte ne concernent pas un lien ; la couleur, si.
  bt("50 %").click();
  bt("Grand").click();
  expect(changements).toHaveLength(1);
  bt("Vert").click();
  expect(changements).toHaveLength(2);
  expect(dernier().links[0]).toMatchObject({ route: "curved", color: "green" });
  // Un lien déjà coudé : la boîte à outils le montre.
  t.definirDocument({ ...DOC(), links: [{ id: "l1", from: "b1", to: "b2", route: "orthogonal", ends: "both", line: "dashed" }], boxes: [{ ...DOC().boxes[0], color: "green" }, DOC().boxes[1]] });
  clic(obj("l1"));
  expect(["Coudé", "Aux deux bouts", "Tirets"].map(presse)).toEqual(["true", "true", "true"]);
  clic(obj("b1"));
  expect(presse("Vert")).toBe("true");
  expect(presse("Par défaut")).toBe("false");
  clic(surface().querySelector("svg"));
  expect(presse("Vert")).toBe("true"); // le choix d'avant
});

test("REQ133_AC9_o_et_tab_vers_la_boite_a_outils_echap_rend_le_focus_a_la_surface", () => {
  monter();
  clic(obj("l1"));
  surface().focus();
  // Tab depuis le dernier objet : l'événement n'est pas pris, le focus suit l'ordre du DOM.
  expect(touche(surface(), "Tab").defaultPrevented).toBe(false);
  expect(choisieId()).toMatch(/l1$/);
  const e = touche(surface(), "o");
  expect(e.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(bt("Choisir"));
  expect(choisieId()).toMatch(/l1$/);
  bt("Courbe").focus();
  surface().focus();
  touche(surface(), "O");
  expect(document.activeElement).toBe(bt("Courbe"));
  bt("Courbe").click();
  expect(dernier().links[0].route).toBe("curved");
  expect(document.activeElement).toBe(bt("Courbe"));
  touche(bt("Courbe"), "Escape");
  expect(document.activeElement).toBe(surface());
  expect(choisieId()).toMatch(/l1$/);
  expect(presse("Courbe")).toBe("true");
  // Dans la saisie, O écrit « o ».
  touche(surface(), "Escape");
  clic(obj("b1"));
  touche(surface(), "Enter");
  const zone = t.element.querySelector("[role=textbox]");
  expect(touche(zone, "o").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(zone);
});

test("REQ134_AC3_une_couleur_s_applique_a_la_boite_choisie_puis_aux_suivantes", () => {
  monter();
  clic(obj("b1"));
  bt("Vert").click();
  expect(changements).toHaveLength(1);
  expect(dernier().boxes[0].color).toBe("green");
  expect(ecrireJdiag(dernier())).toContain('"color": "green"');
  t.ajouterBoite();
  expect(dernier().boxes[2].color).toBe("green");
  clic(obj("b1"));
  bt("Par défaut").click();
  expect(ecrireJdiag(dernier()).split("\n").find((l) => l.includes('"id": "b1"'))).not.toContain("color");
});

test("REQ135_AC4_le_trait_s_applique_au_lien_choisi_et_plein_efface_la_cle", () => {
  monter();
  clic(obj("l1"));
  bt("Tirets").click();
  expect(dernier().links[0].line).toBe("dashed");
  expect(ecrireJdiag(dernier())).toContain('"line": "dashed"');
  bt("Pointillés").click();
  expect(dernier().links[0].line).toBe("dotted");
  bt("Plein").click();
  expect(ecrireJdiag(dernier())).not.toContain('"line"');
  expect(changements).toHaveLength(3);
});

test("REQ133_AC5_le_lien_cree_prend_les_choix_de_la_boite_a_outils", () => {
  monter({ ...DOC(), links: [] });
  bt("Coudé").click();
  bt("Aucune").click();
  expect(changements).toEqual([]);
  ptr(surface(), "pointermove", 270, 140);
  glisser(t.element.querySelector('[data-boite="b1"][data-connecteur="right"]'), [260, 140], [410, 140]);
  expect(dernier().links).toEqual([{ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left", route: "orthogonal", ends: "none" }]);
  // Un lien choisi passé en « Courbe » : le lien suivant l'est aussi.
  clic(obj("l1"));
  bt("Courbe").click();
  clic(obj("b2").querySelector("rect"));
  ptr(surface(), "pointermove", 390, 140);
  glisser(t.element.querySelector('[data-boite="b2"][data-connecteur="left"]'), [400, 140], [250, 140]);
  expect(dernier().links[1]).toEqual({ id: "l2", from: "b2", to: "b1", fromSide: "left", toSide: "right", route: "curved", ends: "none" });
});

const lignes = (doc, cle) => doc[cle].map((o) => o.id);
const DOC3 = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 100, y: 100, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 150, y: 120, width: 160, height: 80, text: "Fin" },
    { id: "b3", x: 400, y: 300, width: 160, height: 40, text: "T", shape: "text" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
  arrows: [{ id: "a1", x1: 0, y1: 0, x2: 50, y2: 50 }, { id: "a2", x1: 0, y1: 60, x2: 50, y2: 90 }],
});

test("REQ137_AC5_REQ133_AC6_un_choix_s_applique_a_chaque_objet_concerne_en_une_modification", () => {
  monter(DOC3());
  clic(obj("b1"));
  // Ctrl+A : tout est choisi.
  surface().focus();
  surface().dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }));
  bt("Rouge").click();
  expect(changements).toHaveLength(1);
  const d = dernier();
  expect([...d.boxes, ...d.links, ...d.arrows].map((o) => o.color)).toEqual(Array(6).fill("red"));
  bt("Courbe").click();
  expect(changements).toHaveLength(2);
  expect(dernier().links[0].route).toBe("curved");
  expect(dernier().arrows.map((a) => a.route)).toEqual(["curved", "curved"]);
  expect(dernier().boxes.some((b) => b.route)).toBe(false);
  bt("Courbe").click();
  expect(changements).toHaveLength(2);
});

test("REQ138_AC1_AC2_AC3_trait_epaisseur_opacite_ecrits_puis_retires", () => {
  monter(DOC3());
  clic(obj("b1"));
  bt("Tirets").click();
  expect(dernier().boxes[0].line).toBe("dashed");
  expect(ecrireJdiag(dernier())).toContain('"line": "dashed"');
  bt("Pointillés").click();
  expect(dernier().boxes[0].line).toBe("dotted");
  bt("Plein").click();
  expect(ecrireJdiag(dernier())).not.toContain('"line"');
  bt("Épais").click();
  expect(dernier().boxes[0].weight).toBe("thick");
  expect(ecrireJdiag(dernier())).toContain('"weight": "thick"');
  expect(obj("b1").classList.contains("epaisseur-thick")).toBe(true);
  bt("Moyen").click();
  expect(ecrireJdiag(dernier())).toContain('"weight": "medium"');
  bt("Fin").click();
  expect(ecrireJdiag(dernier())).not.toContain('"weight"');
  bt("50 %").click();
  expect(dernier().boxes[0].opacity).toBe(50);
  expect(ecrireJdiag(dernier())).toContain('"opacity": 50');
  expect(obj("b1").querySelector("[fill-opacity]").getAttribute("fill-opacity")).toBe("0.5");
  bt("0 %").click();
  expect(ecrireJdiag(dernier())).toContain('"opacity": 0');
  bt("100 %").click();
  expect(ecrireJdiag(dernier())).not.toContain('"opacity"');
});

test("REQ138_AC4_la_forme_texte_ne_change_pas_et_les_choix_servent_a_la_boite_suivante", () => {
  monter(DOC3());
  clic(obj("b3"));
  bt("Tirets").click();
  bt("Épais").click();
  bt("25 %").click();
  expect(changements).toEqual([]);
  clic(surface().querySelector("svg"));
  bt("Tirets").click();
  bt("Moyen").click();
  bt("50 %").click();
  expect(changements).toEqual([]);
  t.ajouterBoite();
  expect(dernier().boxes[3]).toMatchObject({ line: "dashed", weight: "medium", opacity: 50 });
});

test("REQ139_AC1_AC4_la_taille_s_applique_en_saisie_sans_la_finir_le_curseur_reste", () => {
  monter();
  clic(obj("b1"));
  touche(surface(), "Enter");
  const zone = t.element.querySelector("[role=textbox]");
  zone.textContent = "Début 1";
  zone.dispatchEvent(new Event("input", { bubbles: true }));
  const sel = getSelection();
  const r = document.createRange();
  r.setStart(zone.firstChild, 3);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  bt("Grand").click();
  expect(dernier().boxes[0]).toMatchObject({ text: "Début 1", textSize: "large" });
  expect(ecrireJdiag(dernier())).toContain('"textSize": "large"');
  expect(presse("Grand")).toBe("true");
  expect(document.activeElement).toBe(t.element.querySelector("[role=textbox]"));
  expect(getSelection().anchorOffset).toBe(3);
  bt("Très grand").click();
  expect(presse("Très grand")).toBe("true");
  expect(getSelection().anchorOffset).toBe(3);
  expect(document.activeElement).toBe(t.element.querySelector("[role=textbox]"));
  const z2 = t.element.querySelector("[role=textbox]");
  z2.textContent = "Début 1!";
  z2.dispatchEvent(new Event("input", { bubbles: true }));
  expect(dernier().boxes[0].text).toBe("Début 1!");
  expect(dernier().boxes[0].textSize).toBe("xlarge");
  bt("Normal").click();
  expect(ecrireJdiag(dernier())).not.toContain("textSize");
  // Un outil finit la saisie.
  bt("Cercle").click();
  expect(t.element.querySelector("[role=textbox]")).toBeNull();
});

test("REQ139_AC4_la_saisie_montre_les_valeurs_de_la_boite", () => {
  monter({ ...DOC(), boxes: [{ ...DOC().boxes[0], textSize: "large", color: "red" }, DOC().boxes[1]] });
  expect(presse("Normal")).toBe("true");
  clic(obj("b2"));
  clic(surface().querySelector("svg"));
  clic(obj("b1"));
  clic(surface().querySelector("svg"));
  surface().focus();
  clic(obj("b1"));
  touche(surface(), "Enter");
  expect(t.element.querySelector("[role=textbox]")).not.toBeNull();
  expect(presse("Grand")).toBe("true");
  expect(presse("Normal")).toBe("false");
  expect(presse("Rouge")).toBe("true");
});

test("REQ139_AC3_la_taille_au_clavier_sur_la_boite_choisie_puis_aux_suivantes", () => {
  monter();
  clic(obj("b1"));
  surface().focus();
  touche(surface(), "o");
  bt("Petit").focus();
  bt("Petit").click();
  expect(dernier().boxes[0].textSize).toBe("small");
  expect(document.activeElement).toBe(bt("Petit"));
  clic(surface().querySelector("svg"));
  const n = changements.length;
  bt("Grand").click();
  expect(changements).toHaveLength(n);
  t.ajouterBoite();
  expect(dernier().boxes[2].textSize).toBe("large");
});

test("REQ140_AC1_AC2_AC3_couleur_et_epaisseur_des_liens_et_des_fleches", () => {
  monter(DOC3());
  clic(obj("l1"));
  bt("Rouge").click();
  expect(dernier().links[0].color).toBe("red");
  bt("Par défaut").click();
  expect(ecrireJdiag(dernier())).not.toContain('"color"');
  bt("Épais").click();
  expect(dernier().links[0].weight).toBe("thick");
  bt("Moyen").click();
  bt("Fin").click();
  expect(ecrireJdiag(dernier())).not.toContain('"weight"');
  clic(obj("a1"));
  bt("Épais").click();
  expect(dernier().arrows[0].weight).toBe("thick");
  clic(surface().querySelector("svg"));
  const n = changements.length;
  bt("Vert").click();
  bt("Moyen").click();
  expect(changements).toHaveLength(n);
  bt("Flèche").click();
  glisser(surface(), [10, 300], [100, 350]);
  expect(dernier().arrows[2]).toMatchObject({ color: "green", weight: "medium" });
  t.ajouterBoite();
  expect(dernier().boxes[3]).toMatchObject({ color: "green", weight: "medium" });
});

const ordreDessin = () => [...t.element.querySelectorAll("svg [data-id]")].map((e) => e.getAttribute("data-id"));
const DOC4 = () => ({ ...DOC3(), links: [{ id: "l1", from: "b1", to: "b2" }, { id: "l2", from: "b2", to: "b3" }] });

test("REQ141_AC1_AC2_AC3_AC4_plan_des_objets_choisis", async () => {
  monter(DOC4());
  // Rien de choisi : inactifs, un clic ne change rien, pas d'aria-pressed.
  for (const nom of ["Premier plan", "Arrière-plan"]) {
    expect(bt(nom).getAttribute("aria-disabled")).toBe("true");
    expect(bt(nom).hasAttribute("aria-pressed")).toBe(false);
  }
  bt("Premier plan").click();
  expect(changements).toEqual([]);
  expect(ordreDessin()).toEqual(["b1", "b2", "b3", "l1", "l2", "a1", "a2"]);
  clic(obj("b1"));
  expect(bt("Premier plan").hasAttribute("aria-disabled")).toBe(false);
  bt("Premier plan").focus();
  bt("Premier plan").click();
  expect(lignes(dernier(), "boxes")).toEqual(["b2", "b3", "b1"]);
  expect(ordreDessin()).toEqual(["b2", "b3", "b1", "l1", "l2", "a1", "a2"]);
  expect(choisieId()).toMatch(/b1$/);
  expect(document.activeElement).toBe(bt("Premier plan"));
  bt("Arrière-plan").click();
  expect(lignes(dernier(), "boxes")).toEqual(["b1", "b2", "b3"]);
  expect(ordreDessin().slice(0, 3)).toEqual(["b1", "b2", "b3"]);
  // Déjà au premier plan : rien.
  clic(obj("b3"));
  const n = changements.length;
  bt("Premier plan").click();
  expect(changements).toHaveLength(n);
  // Plusieurs objets (b1, b2 et l1, sans b3) : ordre relatif gardé.
  bt("Sélection").click();
  glisser(surface(), [90, 90], [320, 210]);
  expect(surface().nextElementSibling.textContent).toBe("3 objets choisis");
  bt("Premier plan").click();
  expect(lignes(dernier(), "boxes")).toEqual(["b3", "b1", "b2"]);
  expect(ordreDessin()).toEqual(["b3", "b1", "b2", "l2", "l1", "a1", "a2"]);
  // Une flèche libre : seule sa liste change (le `click` qui suit un rectangle de sélection est ignoré).
  await new Promise((r) => setTimeout(r, 0));
  clic(obj("a1"));
  bt("Premier plan").click();
  expect(lignes(dernier(), "arrows")).toEqual(["a2", "a1"]);
  expect(lignes(dernier(), "boxes")).toEqual(["b3", "b1", "b2"]);
  // Un lien passé à l'arrière : premier de `links`, toujours dessiné après les boîtes.
  clic(obj("l2"));
  bt("Arrière-plan").click();
  expect(dernier().links[0].id).toBe("l2");
  const o = ordreDessin();
  expect(o.indexOf("l2")).toBeGreaterThan(o.indexOf("b2"));
  expect(o.indexOf("l2")).toBeLessThan(o.indexOf("l1"));
});

test("REQ141_AC4_AC5_tab_suit_le_nouvel_ordre_et_la_saisie_garde_son_focus", () => {
  monter(DOC3());
  clic(obj("b1"));
  bt("Premier plan").click();
  clic(surface().querySelector("svg"));
  surface().focus();
  touche(surface(), "Tab");
  expect(choisieId()).toMatch(/b2$/);
  clic(obj("b1"));
  touche(surface(), "Enter");
  const zone = t.element.querySelector("[role=textbox]");
  bt("Arrière-plan").click();
  expect(lignes(dernier(), "boxes")).toEqual(["b1", "b2", "b3"]);
  expect(t.element.querySelector("[role=textbox]")).toBe(zone);
  expect(document.activeElement).toBe(zone);
});
