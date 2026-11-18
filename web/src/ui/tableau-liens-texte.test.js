import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ecrireJdiag } from "../jdiag.js";
import { tableau } from "./tableau.js";

const DOC = (lien = {}) => ({
  version: 1,
  boxes: [
    { id: "b1", x: 100, y: 100, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 400, y: 100, width: 160, height: 80, text: "Fin" },
    { id: "b3", x: 100, y: 300, width: 160, height: 80, text: "Autre" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2", ...lien }],
  arrows: [{ id: "a1", x1: 0, y1: 500, x2: 100, y2: 500 }],
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
const bt = (nom) => [...t.element.querySelectorAll("[role=toolbar] button")].find((b) => b.getAttribute("aria-label") === nom);
const editeur = () => t.element.querySelector("[role=textbox]");
const dernier = () => changements.at(-1);
const lien = (doc = dernier()) => doc.links.find((l) => l.id === "l1");
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
// Le premier clic redessine : le double-clic part de l'élément qui est alors sous le pointeur.
const dbl = (cherche) => {
  clic(cherche());
  cherche().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0 }));
};
const touche = (key, opts = {}, cible = surface()) => cible.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
const taper = (zone, texte) => {
  zone.textContent = texte;
  zone.dispatchEvent(new Event("input", { bubbles: true }));
};
const prise = (id) => obj(id).querySelector(".prise");
const selectionner = (debut, fin) => {
  const n = editeur().querySelector("div").firstChild;
  const r = document.createRange();
  r.setStart(n, debut);
  r.setEnd(n, fin);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
};
const centre = (id) => {
  const fo = obj(id).querySelector("foreignObject");
  return [Number(fo.getAttribute("x")) + Number(fo.getAttribute("width")) / 2, Number(fo.getAttribute("y")) + Number(fo.getAttribute("height")) / 2];
};

test("REQ147_AC1_double_clic_sur_le_trait_saisie_au_milieu_sans_boite_puis_fichier", () => {
  monter();
  dbl(() => prise("l1"));
  const z = editeur();
  expect(z).not.toBeNull();
  expect(z.closest("g.lien")).toBe(obj("l1"));
  expect(centre("l1")).toEqual([330, 140]);
  expect(document.activeElement).toBe(z);
  expect(t.element.querySelectorAll("g.boite")).toHaveLength(3);
  expect(changements).toHaveLength(0);
  taper(z, "par mail");
  touche("Escape", {}, z);
  expect(editeur()).toBeNull();
  expect(obj("l1").querySelector(".ya-tableau-lien-texte").textContent).toBe("par mail");
  expect(dernier().boxes).toHaveLength(3);
  expect(ecrireJdiag(dernier())).toContain('{"id": "l1", "from": "b1", "to": "b2", "text": "par mail"}');
});

test("REQ147_AC2_entree_deux_lignes_clic_ailleurs_double_clic_sur_l_etiquette", () => {
  monter(DOC({ text: "par mail" }));
  clic(obj("l1").querySelector(".ya-tableau-lien-texte"));
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  touche("Enter");
  const z = editeur();
  expect(z.textContent).toBe("par mail");
  const sel = getSelection();
  expect(sel.anchorNode && z.contains(sel.anchorNode)).toBe(true);
  expect(sel.isCollapsed).toBe(true);
  expect(sel.anchorNode.textContent.slice(0, sel.anchorOffset)).toBe("par mail");
  const entree = new InputEvent("beforeinput", { inputType: "insertParagraph", bubbles: true, cancelable: true });
  z.dispatchEvent(entree);
  expect(entree.defaultPrevented).toBe(true);
  expect(lien().text).toBe("par mail\n");
  expect(editeur()).toBe(z);
  const { anchorNode, anchorOffset } = getSelection();
  anchorNode.insertData(anchorOffset, "ou tél");
  z.dispatchEvent(new Event("input", { bubbles: true }));
  clic(obj("b3"));
  expect(editeur()).toBeNull();
  expect(lien().text).toBe("par mail\nou tél");
  // Double-clic sur l'étiquette.
  dbl(() => obj("l1").querySelector(".ya-tableau-lien-texte"));
  expect(editeur()).not.toBeNull();
  expect(lien().text).toBe("par mail\nou tél");
});

test("REQ147_AC3_poignee_d_arrivee_lachee_sur_autre_garde_le_texte", () => {
  monter(DOC({ text: "par mail", fromSide: "right", toSide: "left" }));
  clic(prise("l1"));
  const ptr = (cible, type, x, y) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, "pointerId", { value: 1 });
    cible.dispatchEvent(e);
  };
  const p = t.element.querySelector('[data-poignee="arrivee"]');
  ptr(p, "pointerdown", 400, 140);
  ptr(surface(), "pointermove", 300, 220);
  ptr(surface(), "pointermove", 180, 305);
  ptr(surface(), "pointerup", 180, 305);
  expect(lien().to).toBe("b3");
  expect(lien().text).toBe("par mail");
});

test("REQ147_AC4_texte_efface_saisie_vide_sans_pas_double_clic_sur_une_fleche", () => {
  monter(DOC({ text: "par mail" }));
  dbl(() => prise("l1"));
  taper(editeur(), "");
  touche("Escape", {}, editeur());
  expect(ecrireJdiag(dernier())).toContain('{"id": "l1", "from": "b1", "to": "b2"}');
  expect(obj("l1").querySelector(".ya-tableau-lien-texte")).toBeNull();
  const n = changements.length;
  // Saisie vide sans rien taper : ni point ni pas.
  dbl(() => prise("l1"));
  expect(editeur()).not.toBeNull();
  touche("Escape", {}, editeur());
  expect(changements).toHaveLength(n);
  touche("z", { ctrlKey: true });
  expect(lien().text).toBe("par mail");
  // Flèche libre : ni saisie ni boîte.
  dbl(() => prise("a1"));
  expect(editeur()).toBeNull();
  expect(t.element.querySelectorAll("g.boite")).toHaveLength(3);
  expect(obj("a1").classList.contains("choisie")).toBe(true);
});

test("REQ147_AC5_gras_sur_mail_grand_fichier_et_texte_bleu_hors_saisie", () => {
  monter(DOC({ text: "par mail", color: "red" }));
  dbl(() => prise("l1"));
  selectionner(4, 8);
  bt("Gras").click();
  bt("Grand").click();
  expect(editeur()).not.toBeNull();
  expect(obj("l1").classList.contains("taille-large")).toBe(true);
  touche("Escape", {}, editeur());
  expect(ecrireJdiag(dernier())).toContain('"text": "par mail", "spans": [{"start": 4, "end": 8, "bold": true}], "textSize": "large"');
  clic(prise("l1"));
  bt("Texte bleu").click();
  expect(lien().spans).toEqual([{ start: 0, end: 4, color: "blue" }, { start: 4, end: 8, bold: true, color: "blue" }]);
  expect(lien().color).toBe("red");
});

test("REQ147_AC6_copier_coller_garde_texte_et_styles_et_annuler_rétablir", () => {
  monter(DOC({ text: "par mail", spans: [{ start: 4, end: 8, bold: true }], textSize: "large" }));
  surface().focus();
  touche("a", { ctrlKey: true });
  touche("c", { ctrlKey: true });
  touche("v", { ctrlKey: true });
  const copie = dernier().links.find((l) => l.id !== "l1");
  expect(copie.text).toBe("par mail");
  expect(copie.spans).toEqual([{ start: 4, end: 8, bold: true }]);
  expect(copie.textSize).toBe("large");
  // Saisie, Échap, Ctrl+Z, Ctrl+Y.
  t.detruire();
  document.body.innerHTML = "";
  monter();
  dbl(() => prise("l1"));
  taper(editeur(), "par mail");
  touche("Escape", {}, editeur());
  expect(lien().text).toBe("par mail");
  touche("z", { ctrlKey: true });
  expect(lien().text).toBeUndefined();
  touche("y", { ctrlKey: true });
  expect(lien().text).toBe("par mail");
});

test("REQ147_AC7_role_nom_focus_sans_connecteur_ni_poignee_echap_rend_le_focus", () => {
  monter(DOC({ text: "par mail" }));
  dbl(() => prise("l1"));
  const z = editeur();
  expect(z.getAttribute("role")).toBe("textbox");
  expect(z.getAttribute("aria-multiline")).toBe("true");
  expect(z.getAttribute("aria-label")).toBe("Texte du lien");
  expect(document.activeElement).toBe(z);
  expect(t.element.querySelector("[data-poignee]")).toBeNull();
  expect(t.element.querySelector("[data-connecteur]")).toBeNull();
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  taper(z, "par mail\nou tél");
  expect(obj("l1").getAttribute("aria-label")).toBe("De Début vers Fin : par mail ou tél");
  touche("Escape", {}, z);
  expect(document.activeElement).toBe(surface());
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  expect(t.element.querySelector('[data-poignee="arrivee"]')).not.toBeNull();
});

test("REQ139_AC6_taille_du_texte_du_lien_pendant_la_saisie_focus_et_curseur_gardes", () => {
  monter(DOC({ text: "par mail" }));
  dbl(() => prise("l1"));
  const z = editeur();
  const n = z.querySelector("div").firstChild;
  const r = document.createRange();
  r.setStart(n, 3);
  r.setEnd(n, 3);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  expect(bt("Normal").getAttribute("aria-pressed")).toBe("true");
  bt("Très grand").click();
  expect(lien().textSize).toBe("xlarge");
  expect(obj("l1").classList.contains("taille-xlarge")).toBe(true);
  expect(editeur()).toBe(z);
  expect(document.activeElement).toBe(z);
  expect(getSelection().anchorOffset).toBe(3);
  expect(centre("l1")).toEqual([330, 140]);
  expect(bt("Très grand").getAttribute("aria-pressed")).toBe("true");
});

test("REQ147_AC10_texte_blanc_de_lien_vaut_sans_texte", () => {
  monter();
  dbl(() => prise("l1"));
  editeur().replaceChildren(document.createElement("br"));
  editeur().dispatchEvent(new Event("input", { bubbles: true }));
  touche("Escape", {}, editeur());
  expect(obj("l1").querySelector(".ya-tableau-lien-texte")).toBeNull();
  expect(obj("l1").querySelector("foreignObject")).toBeNull();
  expect(obj("l1").getAttribute("aria-label")).toBe("De Début vers Fin");
  expect(ecrireJdiag(dernier())).toContain('{"id": "l1", "from": "b1", "to": "b2"}');
  expect(lien().text).toBe("");
  // Pas de pas d'annulation : le lien n'avait pas de texte.
  const n = changements.length;
  dbl(() => prise("l1"));
  expect(editeur().textContent).toBe("");
  touche("Escape", {}, editeur());
  expect(changements).toHaveLength(n);
  // Deux espaces et un retour à la ligne.
  dbl(() => prise("l1"));
  taper(editeur(), "  \n");
  touche("Escape", {}, editeur());
  expect(obj("l1").querySelector(".ya-tableau-lien-texte")).toBeNull();
  expect(obj("l1").getAttribute("aria-label")).toBe("De Début vers Fin");
  expect(ecrireJdiag(dernier())).toContain('{"id": "l1", "from": "b1", "to": "b2"}');
  expect(ecrireJdiag(dernier())).not.toContain("spans");
  // Texte gardé tel quel.
  dbl(() => prise("l1"));
  taper(editeur(), " par mail ");
  touche("Escape", {}, editeur());
  expect(lien().text).toBe(" par mail ");
});
