import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ecrireJdiag } from "../jdiag.js";
import { tableau } from "./tableau.js";

const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 40, y: 80, width: 160, height: 80, text: "Début du flux" },
    { id: "b2", x: 300, y: 80, width: 160, height: 80, text: "Fin" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
  arrows: [{ id: "a1", x1: 0, y1: 300, x2: 100, y2: 300 }],
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
const bt = (nom) => [...t.element.querySelectorAll("[role=toolbar] button")].find((b) => b.getAttribute("aria-label") === nom);
const obj = (id) => t.element.querySelector(`[data-id="${id}"]`);
const dernier = () => changements.at(-1);
const boite = (id, doc = dernier()) => doc.boxes.find((b) => b.id === id);
const editeur = () => t.element.querySelector("[role=textbox]");
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const touche = (key, opts = {}, cible = surface()) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  cible.dispatchEvent(e);
  return e;
};
const saisir = (id) => {
  clic(obj(id));
  touche("Enter");
  return editeur();
};
// Sélectionne les caractères [debut, fin) du texte de la saisie (un seul nœud de texte au départ).
function selectionner(debut, fin = debut) {
  const [n1, o1] = pointDe(debut);
  const [n2, o2] = pointDe(fin);
  const r = document.createRange();
  r.setStart(n1, o1);
  r.setEnd(n2, o2);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
}
function pointDe(pos) {
  let n = 0;
  const w = document.createTreeWalker(editeur(), NodeFilter.SHOW_TEXT);
  let dernierNoeud = null;
  for (let c = w.nextNode(); c; c = w.nextNode()) {
    dernierNoeud = c;
    if (pos <= n + c.data.length) return [c, pos - n];
    n += c.data.length;
  }
  return [dernierNoeud ?? editeur(), 0];
}
const presse = (nom) => bt(nom).getAttribute("aria-pressed");
const sel = () => [getSelection().toString(), getSelection().anchorNode && editeur()?.contains(getSelection().anchorNode)];
const spansDe = (id) => boite(id).spans;
const taper = (zone, texte) => {
  zone.textContent = texte;
  zone.dispatchEvent(new Event("input", { bubbles: true }));
};

test("REQ146_AC1_gras_sur_la_selection_saisie_selection_focus_gardes_fichier_puis_bascule", () => {
  monter();
  const zone = saisir("b1");
  selectionner(0, 5);
  bt("Gras").click();
  expect(spansDe("b1")).toEqual([{ start: 0, end: 5, bold: true }]);
  const texte = obj("b1").querySelector(".ya-tableau-texte");
  expect(texte).toBe(zone);
  expect(editeur()).toBe(zone);
  expect(zone.querySelector("span").style.fontWeight).toBe("700");
  expect(zone.querySelector("span").textContent).toBe("Début");
  expect(document.activeElement).toBe(zone);
  expect(sel()).toEqual(["Début", true]);
  expect(ecrireJdiag(dernier())).toContain('"spans": [{"start": 0, "end": 5, "bold": true}]');
  expect(presse("Gras")).toBe("true");
  bt("Gras").click();
  expect(spansDe("b1")).toEqual([]);
  expect(ecrireJdiag(dernier())).not.toContain("spans");
  expect(sel()).toEqual(["Début", true]);
  expect(presse("Gras")).toBe("false");
  touche("Escape", {}, zone);
  expect(editeur()).toBeNull();
});

test("REQ146_AC2_italique_souligne_barre_et_couleur_sur_flux_puis_par_defaut", () => {
  monter();
  const zone = saisir("b1");
  selectionner(9, 13);
  bt("Texte rouge").click();
  bt("Italique").click();
  bt("Souligné").click();
  bt("Barré").click();
  const attendu = { start: 9, end: 13, italic: true, underline: true, strike: true, color: "red" };
  expect(spansDe("b1")).toEqual([attendu]);
  expect(ecrireJdiag(dernier())).toContain('{"start": 9, "end": 13, "italic": true, "underline": true, "strike": true, "color": "red"}');
  const s = zone.querySelector("span");
  expect([s.textContent, s.style.fontStyle, s.style.textDecoration, s.style.color]).toEqual(["flux", "italic", "underline line-through", "var(--boite-rouge-trait)"]);
  expect(zone.textContent).toBe("Début du flux");
  bt("Texte par défaut").click();
  expect(spansDe("b1")).toEqual([{ start: 9, end: 13, italic: true, underline: true, strike: true }]);
  expect(ecrireJdiag(dernier())).not.toContain('"color"');
});

test("REQ146_AC3_sans_selection_tout_le_texte_hors_saisie_et_plusieurs_boites", () => {
  monter();
  const zone = saisir("b1");
  selectionner(3);
  bt("Gras").click();
  expect(spansDe("b1")).toEqual([{ start: 0, end: 13, bold: true }]);
  expect(zone).toBe(editeur());
  touche("Escape", {}, zone);
  // Hors saisie : « Italique » sur la boîte choisie.
  clic(obj("b1"));
  bt("Italique").click();
  expect(spansDe("b1")).toEqual([{ start: 0, end: 13, bold: true, italic: true }]);
  expect(obj("b1").querySelector(".ya-tableau-texte span").style.fontStyle).toBe("italic");
  // Deux boîtes choisies, l'une déjà toute en gras.
  surface().focus();
  touche("a", { ctrlKey: true });
  bt("Gras").click();
  expect(spansDe("b1").some((p) => p.bold)).toBe(true);
  expect(boite("b2").spans).toEqual([{ start: 0, end: 3, bold: true }]);
  expect(boite("b1").spans).toEqual([{ start: 0, end: 13, bold: true, italic: true }]);
  bt("Gras").click();
  expect(boite("b1").spans).toEqual([{ start: 0, end: 13, italic: true }]);
  expect(boite("b2").spans).toEqual([]);
});

test("REQ146_AC4_saisie_sans_balise_etendue_au_style_d_avant_et_efface_deplace_les_styles", () => {
  monter({ ...DOC(), boxes: [{ ...DOC().boxes[0], spans: [{ start: 0, end: 5, bold: true }, { start: 9, end: 13, italic: true }] }, DOC().boxes[1]] });
  const zone = saisir("b1");
  expect(zone.getAttribute("contenteditable")).toBe("true");
  // Le navigateur étend le span où l'on tape : le style suit.
  zone.querySelector("span").firstChild.insertData(5, "s");
  zone.dispatchEvent(new Event("input", { bubbles: true }));
  expect(dernier().boxes[0]).toMatchObject({ text: "Débuts du flux", spans: [{ start: 0, end: 6, bold: true }, { start: 10, end: 14, italic: true }] });
  // Effacer « du » : l'italique reste sur « flux ».
  zone.firstChild.childNodes[1].deleteData(0, 3);
  zone.dispatchEvent(new Event("input", { bubbles: true }));
  expect(dernier().boxes[0].text).toBe("Débuts flux");
  expect(dernier().boxes[0].spans).toEqual([{ start: 0, end: 6, bold: true }, { start: 7, end: 11, italic: true }]);
  // Le DOM de la saisie n'a pas été réécrit.
  expect(editeur()).toBe(zone);
});

test("REQ146_AC4_retour_a_la_ligne_et_collage_sans_balise_texte_brut_aux_styles_d_avant", () => {
  monter({ ...DOC(), boxes: [{ ...DOC().boxes[0], spans: [{ start: 0, end: 5, bold: true }] }, DOC().boxes[1]] });
  const zone = saisir("b1");
  selectionner(5);
  const entree = new InputEvent("beforeinput", { inputType: "insertParagraph", bubbles: true, cancelable: true });
  zone.dispatchEvent(entree);
  expect(entree.defaultPrevented).toBe(true);
  expect(dernier().boxes[0].text).toBe("Début\n du flux");
  expect(dernier().boxes[0].spans).toEqual([{ start: 0, end: 6, bold: true }]);
  expect(sel()[1]).toBe(true);
  const saut = new InputEvent("beforeinput", { inputType: "insertLineBreak", bubbles: true, cancelable: true });
  zone.dispatchEvent(saut);
  expect(dernier().boxes[0].text).toBe("Début\n\n du flux");
  // Collage d'un texte HTML en gras : le texte brut seul, aux styles du caractère d'avant.
  const coller = new InputEvent("beforeinput", { inputType: "insertFromPaste", bubbles: true, cancelable: true });
  Object.defineProperty(coller, "dataTransfer", { value: { getData: (type) => (type === "text/plain" ? "XY" : "<b>XY</b>") } });
  selectionner(0);
  zone.dispatchEvent(coller);
  expect(coller.defaultPrevented).toBe(true);
  expect(dernier().boxes[0].text).toBe("XYDébut\n\n du flux");
  expect(dernier().boxes[0].spans).toEqual([{ start: 0, end: 9, bold: true }]);
  expect(zone.querySelector("b, strong, br")).toBeNull();
  const glisse = new InputEvent("beforeinput", { inputType: "insertFromDrop", data: "Z", bubbles: true, cancelable: true });
  selectionner(0);
  zone.dispatchEvent(glisse);
  expect(glisse.defaultPrevented).toBe(true);
  expect(dernier().boxes[0].text).toBe("ZXYDébut\n\n du flux");
  // Les formats du navigateur ne font rien.
  const gras = new InputEvent("beforeinput", { inputType: "formatBold", bubbles: true, cancelable: true });
  zone.dispatchEvent(gras);
  expect(gras.defaultPrevented).toBe(true);
});

test("REQ146_AC5_ctrl_b_i_u_en_saisie_et_rien_hors_saisie", () => {
  monter();
  const zone = saisir("b1");
  selectionner(9, 13);
  for (const [k, cle] of [["b", "bold"], ["i", "italic"], ["u", "underline"]]) {
    const e = touche(k, { ctrlKey: true }, zone);
    expect(e.defaultPrevented).toBe(true);
    expect(spansDe("b1")[0][cle]).toBe(true);
  }
  expect(spansDe("b1")).toEqual([{ start: 9, end: 13, bold: true, italic: true, underline: true }]);
  expect(zone.querySelector("b, strong, i, em, u")).toBeNull();
  expect(touche("b", { ctrlKey: true, shiftKey: true }, zone).defaultPrevented).toBe(false);
  touche("Escape", {}, zone);
  // Hors saisie : le dessin ne change pas.
  const avant = ecrireJdiag(dernier());
  const n = changements.length;
  const e = touche("b", { ctrlKey: true });
  expect(e.defaultPrevented).toBe(false);
  expect(changements.length).toBe(n);
  expect(ecrireJdiag(dernier())).toBe(avant);
});

test("REQ146_AC5_cmd_b_cmd_i_cmd_u_sur_mac", () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  monter();
  const zone = saisir("b1");
  selectionner(0, 5);
  expect(touche("b", { ctrlKey: true }, zone).defaultPrevented).toBe(false);
  expect(changements).toEqual([]);
  for (const k of ["b", "i", "u"]) expect(touche(k, { metaKey: true }, zone).defaultPrevented).toBe(true);
  expect(spansDe("b1")).toEqual([{ start: 0, end: 5, bold: true, italic: true, underline: true }]);
});

test("REQ146_AC6_annuler_et_refaire_un_style_hors_saisie_et_deux_pas_en_saisie", () => {
  monter();
  clic(obj("b1"));
  bt("Texte bleu").click();
  expect(spansDe("b1")).toEqual([{ start: 0, end: 13, color: "blue" }]);
  touche("z", { ctrlKey: true });
  expect(boite("b1").spans ?? []).toEqual([]);
  expect(ecrireJdiag(dernier())).not.toContain("spans");
  touche("y", { ctrlKey: true });
  expect(spansDe("b1")).toEqual([{ start: 0, end: 13, color: "blue" }]);
  touche("z", { ctrlKey: true });
  // Saisie, `!`, style, Échap : deux pas.
  const zone = saisir("b1");
  taper(zone, "Début du flux!");
  selectionner(0, 5);
  bt("Gras").click();
  touche("Escape", {}, zone);
  expect(dernier().boxes[0]).toMatchObject({ text: "Début du flux!", spans: [{ start: 0, end: 5, bold: true }] });
  touche("z", { ctrlKey: true });
  expect(dernier().boxes[0].text).toBe("Début du flux!");
  expect(dernier().boxes[0].spans ?? []).toEqual([]);
  touche("z", { ctrlKey: true });
  expect(dernier().boxes[0].text).toBe("Début du flux");
});

test("REQ146_AC6_la_couleur_de_la_boite_ne_change_pas_une_partie_qui_a_la_sienne", () => {
  monter({ ...DOC(), boxes: [{ ...DOC().boxes[0], spans: [{ start: 0, end: 5, color: "red" }] }, DOC().boxes[1]] });
  clic(obj("b1"));
  bt("Vert").click();
  expect(dernier().boxes[0]).toMatchObject({ color: "green", spans: [{ start: 0, end: 5, color: "red" }] });
  expect(obj("b1").getAttribute("class")).toMatch(/couleur-green/);
  const s = obj("b1").querySelector(".ya-tableau-texte span");
  expect(s.style.color).toBe("var(--boite-rouge-trait)");
  expect(s.parentNode.lastChild.textContent).toBe(" du flux");
});

test("REQ146_AC7_rien_de_choisi_fleche_seule_formes_et_copier_coller", () => {
  monter();
  bt("Gras").click();
  bt("Texte rouge").click();
  expect(changements).toEqual([]);
  clic(obj("a1"));
  bt("Gras").click();
  bt("Texte rouge").click();
  expect(changements).toEqual([]);
  // Formes : chacune prend les cinq styles.
  for (const forme of ["text", "ellipse", "note"]) {
    const doc = DOC();
    doc.boxes[0] = { ...doc.boxes[0], shape: forme };
    t.detruire();
    monter(doc);
    clic(obj("b1"));
    for (const s of ["Gras", "Italique", "Souligné", "Barré", "Texte rouge"]) bt(s).click();
    expect(spansDe("b1")).toEqual([{ start: 0, end: 13, bold: true, italic: true, underline: true, strike: true, color: "red" }]);
  }
  // Copier-coller.
  t.detruire();
  monter();
  clic(obj("b1"));
  bt("Gras").click();
  touche("c", { ctrlKey: true });
  touche("v", { ctrlKey: true });
  const copie = dernier().boxes.find((b) => b.id === "b3");
  expect(copie.spans).toEqual([{ start: 0, end: 13, bold: true }]);
  // Rien de choisi : la boîte posée ensuite a un texte sans style.
  t.detruire();
  monter();
  bt("Gras").click();
  bt("Texte rouge").click();
  expect(changements).toEqual([]);
  t.ajouterBoite();
  expect(dernier().boxes.at(-1)).not.toHaveProperty("spans");
});

test("REQ146_AC8_aria_pressed_suit_la_selection", () => {
  monter({ ...DOC(), boxes: [{ ...DOC().boxes[0], spans: [{ start: 0, end: 5, bold: true, color: "red" }, { start: 5, end: 8, color: "red" }] }, DOC().boxes[1]] });
  const zone = saisir("b1");
  selectionner(0, 5);
  document.dispatchEvent(new Event("selectionchange"));
  expect(presse("Gras")).toBe("true");
  expect(presse("Texte rouge")).toBe("true");
  expect(presse("Texte par défaut")).toBe("false");
  selectionner(0, 8);
  document.dispatchEvent(new Event("selectionchange"));
  expect(presse("Gras")).toBe("false");
  expect(presse("Texte rouge")).toBe("true");
  selectionner(0, 13);
  document.dispatchEvent(new Event("selectionchange"));
  for (const n of ["Texte par défaut", "Texte bleu", "Texte vert", "Texte jaune", "Texte orange", "Texte rouge", "Texte violet"]) expect(presse(n)).toBe("false");
  touche("Escape", {}, zone);
  // Rien de choisi : les onze boutons sont inactifs.
  clic(t.element.querySelector("svg"));
  for (const n of ["Gras", "Italique", "Souligné", "Barré", "Texte par défaut", "Texte bleu", "Texte vert", "Texte jaune", "Texte orange", "Texte rouge", "Texte violet"]) expect(bt(n).getAttribute("aria-disabled")).toBe("true");
  clic(obj("b1"));
  expect(bt("Gras").getAttribute("aria-disabled")).not.toBe("true");
});

test("REQ146_AC9_focus_et_selection_gardes_apres_un_clic", () => {
  monter();
  const zone = saisir("b1");
  selectionner(0, 5);
  bt("Italique").click();
  expect(document.activeElement).toBe(zone);
  expect(sel()).toEqual(["Début", true]);
  bt("Texte vert").click();
  expect(document.activeElement).toBe(zone);
  expect(sel()).toEqual(["Début", true]);
  expect(spansDe("b1")).toEqual([{ start: 0, end: 5, italic: true, color: "green" }]);
});

test("REQ146_AC10_texte_vide_rien_ne_change_et_par_defaut_presse", () => {
  monter({ ...DOC(), boxes: [{ ...DOC().boxes[0], text: "" }, DOC().boxes[1]] });
  const zone = saisir("b1");
  expect(presse("Texte par défaut")).toBe("true");
  for (const n of ["Gras", "Italique", "Souligné", "Barré"]) expect(presse(n)).toBe("false");
  bt("Gras").click();
  bt("Texte rouge").click();
  expect(changements).toEqual([]);
  expect(zone).toBe(editeur());
});

test("REQ145_AC3_la_saisie_garde_son_dom_a_la_frappe_et_un_texte_sans_style_n_ajoute_pas_spans", () => {
  monter();
  const zone = saisir("b1");
  const noeud = zone.querySelector("div").firstChild;
  noeud.insertData(5, "!");
  zone.dispatchEvent(new Event("input", { bubbles: true }));
  expect(dernier().boxes[0].text).toBe("Début! du flux");
  expect(dernier().boxes[0]).not.toHaveProperty("spans");
  expect(editeur()).toBe(zone);
  expect(zone.querySelector("div").firstChild).toBe(noeud);
  expect(noeud.data).toBe("Début! du flux");
});
