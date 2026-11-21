import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ecrireJdiag } from "../jdiag.js";
import { tableau } from "./tableau.js";

const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 40, y: 80, width: 160, height: 80, text: "Début du flux" },
    { id: "b2", x: 300, y: 80, width: 160, height: 80, text: "Fin", align: "left" },
    { id: "b3", x: 40, y: 300, width: 100, height: 100, shape: "database", text: "Base" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
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
const bt = (nom) => [...t.element.querySelectorAll("[role=toolbar] button")].find((b) => b.getAttribute("aria-label") === nom);
const obj = (id) => t.element.querySelector(`[data-id="${id}"]`);
const dernier = () => changements.at(-1);
const boite = (id) => dernier().boxes.find((b) => b.id === id);
const editeur = () => t.element.querySelector("[role=textbox]");
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
// Ctrl+V : le navigateur envoie ensuite l'événement `paste`, que la surface reçoit.
const touche = (key, opts = {}, cible = surface()) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  cible.dispatchEvent(e);
  if (opts.ctrlKey && key === "v" && !e.defaultPrevented) cible.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));
  return e;
};
function selectionner(debut, fin = debut) {
  const w = document.createTreeWalker(editeur(), NodeFilter.SHOW_TEXT);
  const n = w.nextNode();
  const r = document.createRange();
  r.setStart(n, debut);
  r.setEnd(n, fin);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
}
const presse = (nom) => bt(nom).getAttribute("aria-pressed");
const POSITIONS = ["À gauche", "Au centre", "À droite", "En haut", "Au milieu", "En bas"];
const pressees = () => POSITIONS.filter((n) => presse(n) === "true");
const choisirTout = () => {
  surface().focus();
  touche("a", { ctrlKey: true });
};

test("REQ150_AC1_AC2_clic_sur_la_boite_choisie_ecrit_la_cle_un_pas_et_la_valeur_par_defaut_la_retire", () => {
  monter();
  clic(obj("b1"));
  expect(pressees()).toEqual(["Au centre", "Au milieu"]);
  bt("À droite").click();
  expect(boite("b1").align).toBe("right");
  expect(ecrireJdiag(dernier())).toContain('"align": "right"');
  expect(changements).toHaveLength(1);
  expect(pressees()).toEqual(["À droite", "Au milieu"]);
  expect(obj("b1").querySelector(".ya-tableau-texte").classList.contains("align-right")).toBe(true);
  bt("En bas").click();
  expect(boite("b1").valign).toBe("bottom");
  expect(obj("b1").querySelector(".ya-tableau-texte").classList.contains("valign-bottom")).toBe(true);
  // Déjà la valeur : rien, pas de point d'historique.
  const n = changements.length;
  bt("En bas").click();
  expect(changements).toHaveLength(n);
  // La valeur par défaut de la forme retire la clé.
  bt("Au centre").click();
  bt("Au milieu").click();
  expect("align" in boite("b1") || "valign" in boite("b1")).toBe(false);
  expect(ecrireJdiag(dernier())).not.toContain('"align": "center"');
  // Ctrl+Z : un seul pas par clic.
  surface().focus();
  touche("z", { ctrlKey: true });
  expect(boite("b1").valign).toBe("bottom");
});

test("REQ150_AC4_symbole_en_haut_par_defaut_au_milieu_ecrit_valign_en_haut_retire_la_cle", () => {
  monter();
  clic(obj("b3"));
  expect(pressees()).toEqual(["Au centre", "En haut"]);
  bt("Au milieu").click();
  expect(boite("b3").valign).toBe("middle");
  expect(ecrireJdiag(dernier())).toContain('"valign": "middle"');
  expect(pressees()).toEqual(["Au centre", "Au milieu"]);
  bt("En haut").click();
  expect("valign" in boite("b3")).toBe(false);
  expect(ecrireJdiag(dernier())).not.toContain("valign");
  expect(pressees()).toEqual(["Au centre", "En haut"]);
});

test("REQ150_AC5_en_saisie_la_saisie_continue_selection_et_focus_gardes_puis_historique_hors_saisie", () => {
  monter();
  clic(obj("b1"));
  touche("Enter");
  const zone = editeur();
  selectionner(9, 13);
  const md = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  bt("À droite").dispatchEvent(md);
  expect(md.defaultPrevented).toBe(true);
  bt("À droite").click();
  expect(editeur().classList.contains("align-right")).toBe(true);
  bt("En haut").click();
  expect(editeur().classList.contains("valign-top")).toBe(true);
  expect(editeur()).toBe(zone);
  expect(document.activeElement).toBe(zone);
  expect(getSelection().toString()).toBe("flux");
  expect(boite("b1")).toMatchObject({ align: "right", valign: "top", text: "Début du flux" });
  expect(boite("b1").spans).toBeUndefined();
  expect(pressees()).toEqual(["À droite", "En haut"]);
  touche("Escape", {}, zone);
  expect(editeur()).toBeNull();
  const avant = changements.length;
  surface().focus();
  touche("z", { ctrlKey: true });
  expect(changements.length).toBe(avant + 1);
  expect(boite("b1").valign).toBeUndefined();
  touche("y", { ctrlKey: true });
  expect(boite("b1").valign).toBe("top");
});

test("REQ150_AC6_plusieurs_boites_liens_ignores_copie_gardee_rien_de_choisi_et_boite_suivante_centree", () => {
  monter();
  // b1 et b3 centrés, b2 à gauche, et le lien : rien de pressé dans « Alignement » ; b1 « au milieu » et le symbole b3 « en haut » : rien non plus.
  choisirTout();
  expect(pressees()).toEqual([]);
  const liensAvant = JSON.stringify(dernier()?.links ?? DOC().links);
  bt("À droite").click();
  expect(changements).toHaveLength(1);
  expect(dernier().boxes.map((b) => b.align)).toEqual(["right", "right", "right"]);
  expect(JSON.stringify(dernier().links)).toBe(liensAvant);
  expect(pressees()).toEqual(["À droite"]);
  bt("À gauche").click();
  expect(changements).toHaveLength(2);
  expect(dernier().boxes.map((b) => b.align)).toEqual(["left", "left", "left"]);
  expect(pressees()).toEqual(["À gauche"]);
  // Copie gardée.
  clic(obj("b1"));
  bt("En bas").click();
  touche("c", { ctrlKey: true });
  touche("v", { ctrlKey: true });
  const copie = dernier().boxes.find((b) => b.id === "b4");
  expect(copie).toMatchObject({ align: "left", valign: "bottom" });
  // Lien seul, flèche seule, rien de choisi : inactifs, rien, pas de point.
  const n = changements.length;
  for (const id of ["l1", "a1"]) {
    clic(obj(id));
    for (const nom of POSITIONS) expect(bt(nom).getAttribute("aria-disabled")).toBe("true");
    bt("À droite").click();
    expect(pressees()).toEqual([]);
  }
  expect(changements).toHaveLength(n);
  // Les choix ne servent pas aux suivantes : la boîte posée ensuite est centrée.
  t.ajouterBoite();
  const nouvelle = dernier().boxes.at(-1);
  expect(nouvelle.align).toBeUndefined();
  expect(nouvelle.valign).toBeUndefined();
});

test("REQ150_AC8_roles_aria_pressed_info_bulles_et_focus_gardes", () => {
  monter();
  const groupes = [...t.element.querySelectorAll("[role=toolbar] [role=group]")].map((g) => g.getAttribute("aria-label"));
  expect(groupes).toContain("Alignement du texte");
  expect(groupes).toContain("Position verticale du texte");
  // Rien de choisi : inactifs, rien de pressé, focus gardé.
  for (const n of POSITIONS) {
    expect(bt(n).getAttribute("aria-disabled"), n).toBe("true");
    expect(presse(n), n).toBe("false");
  }
  bt("En haut").focus();
  expect(document.activeElement).toBe(bt("En haut"));
  clic(obj("b1"));
  for (const n of POSITIONS) expect(bt(n).hasAttribute("aria-disabled"), n).toBe(false);
  bt("En haut").focus();
  bt("En haut").click();
  expect(document.activeElement).toBe(bt("En haut"));
  expect(presse("En haut")).toBe("true");
  expect(presse("Au milieu")).toBe("false");
  // Saisie : focus et curseur gardés.
  touche("Enter");
  const zone = editeur();
  selectionner(4);
  expect(bt("À gauche").getAttribute("aria-disabled")).toBeNull();
  bt("À gauche").click();
  expect(document.activeElement).toBe(zone);
  expect(getSelection().anchorOffset).toBe(4);
});
