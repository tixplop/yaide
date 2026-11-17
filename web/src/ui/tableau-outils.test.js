import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { boiteOutils } from "./tableau-outils.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const DEPART = () => ({ outil: "choisir", forme: "rectangle", couleur: "default", trace: "direct", bouts: "end", trait: "solid" });
const NOMS = ["Choisir", "Rectangle", "Rectangle arrondi", "Cercle", "Losange", "Note", "Texte", "Lien", "Flèche", "Par défaut", "Bleu", "Vert", "Jaune", "Orange", "Rouge", "Violet", "Droit", "Coudé", "Courbe", "À l'arrivée", "Aucune", "Au départ", "Aux deux bouts", "Plein", "Tirets", "Pointillés"];
const GROUPES = ["Outil", "Forme", "Relier", "Couleur", "Tracé", "Extrémités", "Trait"];
const RANGS = [9, 7, 10];

let b;
let choix;
let echaps;
function monter(valeurs = DEPART()) {
  choix = [];
  echaps = 0;
  // Trois rangs de hauteur 28 ; chaque bouton est à sa place dans son rang.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    const i = this.dataset?.indice;
    if (i === undefined) return { x: 0, y: 0, left: 0, top: 0, width: 24, height: 24, right: 24, bottom: 24 };
    const n = Number(i);
    const rang = n < 9 ? 0 : n < 16 ? 1 : 2;
    const col = n - [0, 9, 16][rang];
    const left = col * 26 + (rang === 2 ? 0 : 0);
    return { x: left, y: rang * 28, left, top: rang * 28, width: 24, height: 24, right: left + 24, bottom: rang * 28 + 24 };
  });
  b = boiteOutils({ valeurs, surChoix: (c, v) => choix.push([c, v]), surEchap: () => echaps++ });
  document.body.append(b.element);
  return b;
}
const boutons = () => [...b.element.querySelectorAll("button")];
const par = (nom) => boutons().find((x) => x.getAttribute("aria-label") === nom);
const touche = (cible, key) => cible.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("REQ133_AC7_barre_nommee_boutons_presses_et_info_bulles", () => {
  monter();
  const el = b.element;
  expect(el.getAttribute("role")).toBe("toolbar");
  expect(el.getAttribute("aria-label")).toBe("Outils du whiteboard");
  expect(el.classList.contains("ya-tableau-outils")).toBe(true);
  expect(boutons().every((x) => x.classList.contains("ya-icon-btn") && x.hasAttribute("aria-pressed"))).toBe(true);
  expect(boutons().filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Choisir", "Par défaut", "Droit", "À l'arrivée", "Plein"]);
  // Un clic sur un outil le presse sans quitter le bouton ; un style appelle surChoix.
  par("Tirets").click();
  expect(choix).toEqual([["trait", "dashed"]]);
  expect(par("Tirets").getAttribute("aria-pressed")).toBe("true");
  expect(par("Plein").getAttribute("aria-pressed")).toBe("false");
  expect(document.activeElement).toBe(par("Tirets"));
});

test("REQ133_AC8_noms_groupes_et_info_bulles_dans_l_ordre", () => {
  monter();
  expect(boutons().map((x) => x.getAttribute("aria-label"))).toEqual(NOMS);
  const groupes = [...b.element.querySelectorAll('[role="group"]')];
  expect(groupes.map((g) => g.getAttribute("aria-label"))).toEqual(GROUPES);
  expect(groupes.map((g) => g.querySelectorAll("button").length)).toEqual([1, 6, 2, 7, 3, 4, 3]);
  vi.useFakeTimers();
  const texte = (nom) => {
    par(nom).enveloppe.dispatchEvent(new MouseEvent("pointerenter"));
    vi.advanceTimersByTime(400);
    const t = document.querySelector("[role=tooltip]")?.textContent;
    par(nom).enveloppe.dispatchEvent(new MouseEvent("pointerleave"));
    return t;
  };
  expect(texte("Cercle")).toBe("Cercle");
  expect(texte("Vert")).toBe("Couleur : Vert");
  expect(texte("Coudé")).toBe("Tracé : Coudé");
  expect(texte("Aucune")).toBe("Extrémités : Aucune");
  expect(texte("Tirets")).toBe("Trait : Tirets");
  vi.useRealTimers();
  // Les trois rangs : 9, 7 et 10 boutons ; une pastille au lieu d'une icône pour les couleurs.
  const rangs = [...b.element.children];
  expect(rangs.map((r) => r.querySelectorAll("button").length)).toEqual(RANGS);
  expect(par("Vert").querySelector(".ya-pastille-couleur")).not.toBeNull();
  expect(par("Vert").querySelector("svg")).toBeNull();
  expect(par("Cercle").querySelector("svg")).not.toBeNull();
  // Un seul pressé parmi Outil, Forme et Relier.
  expect(boutons().slice(0, 9).filter((x) => x.getAttribute("aria-pressed") === "true").length).toBe(1);
  par("Cercle").click();
  expect(boutons().slice(0, 9).filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Cercle"]);
  // CSS : à 12 px du bas et de la gauche, sans valeur brute hors tokens.
  const regle = css.match(/\.ya-tableau-outils\s*\{([^}]*)\}/)[1];
  expect(regle).toMatch(/position:\s*absolute/);
  expect(regle).toMatch(/left:\s*var\(--space-3\)/);
  expect(regle).toMatch(/bottom:\s*var\(--space-3\)/);
  expect(regle).toMatch(/background:\s*var\(--bg-300\)/);
  expect(regle).toMatch(/border-radius:\s*var\(--radius-md\)/);
  expect(regle).toMatch(/box-shadow:\s*var\(--shadow-popover\)/);
  expect(regle).toMatch(/max-height:\s*calc\(100% - 24px\)/);
  expect(regle).toMatch(/overflow-y:\s*auto/);
});

test("REQ133_AC9_un_arret_de_tab_et_fleches", () => {
  monter();
  expect(boutons().filter((x) => x.tabIndex === 0).map((x) => x.getAttribute("aria-label"))).toEqual(["Choisir"]);
  par("Choisir").focus();
  touche(par("Choisir"), "ArrowRight");
  expect(document.activeElement).toBe(par("Rectangle"));
  touche(par("Rectangle"), "ArrowLeft");
  expect(document.activeElement).toBe(par("Choisir"));
  // Gauche au début : pas de boucle.
  touche(par("Choisir"), "ArrowLeft");
  expect(document.activeElement).toBe(par("Choisir"));
  // Droite en fin de rang : le rang suivant.
  par("Flèche").focus();
  touche(par("Flèche"), "ArrowRight");
  expect(document.activeElement).toBe(par("Par défaut"));
  touche(par("Par défaut"), "ArrowLeft");
  expect(document.activeElement).toBe(par("Flèche"));
  // Bas : le bouton le plus proche en largeur du rang suivant.
  par("Choisir").focus();
  touche(par("Choisir"), "ArrowDown");
  expect(document.activeElement).toBe(par("Par défaut"));
  touche(par("Par défaut"), "ArrowDown");
  expect(document.activeElement).toBe(par("Droit"));
  touche(par("Droit"), "ArrowUp");
  expect(document.activeElement).toBe(par("Par défaut"));
  // Un seul arrêt de Tab : le dernier bouton qui a eu le focus.
  expect(boutons().filter((x) => x.tabIndex === 0).map((x) => x.getAttribute("aria-label"))).toEqual(["Par défaut"]);
  touche(par("Par défaut"), "End");
  expect(document.activeElement).toBe(par("Pointillés"));
  touche(par("Pointillés"), "ArrowDown");
  expect(document.activeElement).toBe(par("Pointillés"));
  touche(par("Pointillés"), "Home");
  expect(document.activeElement).toBe(par("Choisir"));
  // Entrée presse sans déplacer le focus ; Échap appelle surEchap.
  par("Courbe").focus();
  par("Courbe").click();
  expect(document.activeElement).toBe(par("Courbe"));
  expect(choix).toEqual([["trace", "curved"]]);
  touche(par("Courbe"), "Escape");
  expect(echaps).toBe(1);
  // Un clic pose le focus.
  const bouton = par("Orange");
  bouton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(document.activeElement).toBe(bouton);
  expect(bouton.tabIndex).toBe(0);
});

test("REQ133_AC10_courant_et_presse_apres_un_choix_de_forme", () => {
  monter();
  const courants = () => boutons().filter((x) => x.getAttribute("aria-current") === "true").map((x) => x.getAttribute("aria-label"));
  expect(courants()).toEqual(["Rectangle"]);
  par("Cercle").click();
  expect(choix).toEqual([["outil", "ellipse"]]);
  expect(par("Cercle").getAttribute("aria-pressed")).toBe("true");
  expect(courants()).toEqual(["Cercle"]);
  // Cercle posé : l'appelant remet l'outil à « Choisir », la forme courante reste.
  b.definir({ ...DEPART(), forme: "ellipse", outil: "choisir" });
  expect(par("Choisir").getAttribute("aria-pressed")).toBe("true");
  expect(par("Cercle").getAttribute("aria-pressed")).toBe("false");
  expect(courants()).toEqual(["Cercle"]);
  // Valeurs d'un objet choisi.
  b.definir({ ...DEPART(), couleur: "green", trace: "orthogonal", bouts: "none", trait: "dotted" });
  const presses = boutons().filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"));
  expect(presses).toEqual(["Choisir", "Vert", "Coudé", "Aucune", "Pointillés"]);
  expect(css).toMatch(/\.ya-tableau-outils \.ya-icon-btn\[aria-current="true"\]::after/);
});

test("REQ133_AC11_pas_de_defilement_horizontal_a_278px", () => {
  const regle = css.match(/\.ya-tableau-outils\s*\{([^}]*)\}/)[1];
  expect(regle).toMatch(/overflow-x:\s*hidden/);
  expect(regle).toMatch(/width:\s*278px/);
});
