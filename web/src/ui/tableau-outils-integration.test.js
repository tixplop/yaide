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
  expect(["Choisir", "Par défaut", "Droit", "À l'arrivée", "Plein"].map(presse)).toEqual(["true", "true", "true", "true", "true"]);
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
  expect(["Droit", "À l'arrivée", "Plein"].map(presse)).toEqual(["true", "true", "true"]);
  bt("Courbe").click();
  expect(changements).toHaveLength(1);
  expect(dernier().links[0]).toMatchObject({ route: "curved" });
  bt("Courbe").click();
  expect(changements).toHaveLength(1);
  // La couleur ne concerne pas un lien.
  bt("Vert").click();
  expect(changements).toHaveLength(1);
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
