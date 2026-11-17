import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { boiteOutils } from "./tableau-outils.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const DEPART = () => ({ outil: "choisir", forme: "rectangle", couleur: "default", opacite: 100, taille: "normal", trace: "direct", bouts: "end", trait: "solid", epaisseur: "thin" });
const NOMS = ["Choisir", "Sélection", "Rectangle", "Rectangle arrondi", "Cercle", "Losange", "Note", "Texte", "Lien", "Flèche", "Par défaut", "Bleu", "Vert", "Jaune", "Orange", "Rouge", "Violet", "100 %", "75 %", "50 %", "25 %", "0 %", "Petit", "Normal", "Grand", "Très grand", "Droit", "Coudé", "Courbe", "À l'arrivée", "Aucune", "Au départ", "Aux deux bouts", "Plein", "Tirets", "Pointillés", "Fin", "Moyen", "Épais", "Premier plan", "Arrière-plan"];
const GROUPES = ["Outil", "Forme", "Relier", "Couleur", "Opacité", "Taille du texte", "Tracé", "Extrémités", "Trait", "Épaisseur", "Plan"];
const RANGS = [10, 7, 9, 7, 8];
const DEBUTS = [0, 10, 17, 26, 33];

let b;
let choix;
let echaps;
let actions;
function monter(valeurs = DEPART()) {
  choix = [];
  echaps = 0;
  actions = [];
  // Cinq rangs de hauteur 28 ; chaque bouton est à sa place dans son rang et son groupe (8 px entre groupes, 2 entre boutons).
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    const i = this.dataset?.indice;
    if (i === undefined) return { x: 0, y: 0, left: 0, top: 0, width: 24, height: 24, right: 24, bottom: 24 };
    const n = Number(i);
    const rang = DEBUTS.filter((d) => d <= n).length - 1;
    const groupe = [...this.closest(".ya-tableau-outils-groupe").parentElement.children].indexOf(this.closest(".ya-tableau-outils-groupe"));
    const left = (n - DEBUTS[rang]) * 26 + groupe * 6;
    return { x: left, y: rang * 28, left, top: rang * 28, width: 24, height: 24, right: left + 24, bottom: rang * 28 + 24 };
  });
  b = boiteOutils({ valeurs, surChoix: (c, v) => choix.push([c, v]), surAction: (a) => actions.push(a), surEchap: () => echaps++ });
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
  expect(boutons().every((x) => x.classList.contains("ya-icon-btn"))).toBe(true);
  expect(boutons().filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Choisir", "Par défaut", "100 %", "Normal", "Droit", "À l'arrivée", "Plein", "Fin"]);
  // « Plan » : deux actions, sans aria-pressed.
  expect(boutons().slice(-2).map((x) => x.hasAttribute("aria-pressed"))).toEqual([false, false]);
  // Un style appelle surChoix.
  par("Tirets").click();
  expect(choix).toEqual([["trait", "dashed"]]);
  expect(par("Tirets").getAttribute("aria-pressed")).toBe("true");
  expect(par("Plein").getAttribute("aria-pressed")).toBe("false");
});

test("REQ133_AC8_noms_groupes_et_info_bulles_dans_l_ordre", () => {
  monter();
  expect(boutons().map((x) => x.getAttribute("aria-label"))).toEqual(NOMS);
  const groupes = [...b.element.querySelectorAll('[role="group"]')];
  expect(groupes.map((g) => g.getAttribute("aria-label"))).toEqual(GROUPES);
  expect(groupes.map((g) => g.querySelectorAll("button").length)).toEqual([2, 6, 2, 7, 5, 4, 3, 4, 3, 3, 2]);
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
  expect(texte("50 %")).toBe("Opacité : 50 %");
  expect(texte("Épais")).toBe("Épaisseur : Épais");
  expect(texte("Premier plan")).toBe("Premier plan");
  vi.useRealTimers();
  // Les cinq rangs ; une pastille au lieu d'une icône pour les couleurs.
  const rangs = [...b.element.children];
  expect(rangs.map((r) => r.querySelectorAll("button").length)).toEqual(RANGS);
  expect(par("Vert").querySelector(".ya-pastille-couleur")).not.toBeNull();
  expect(par("Vert").querySelector("svg")).toBeNull();
  expect(par("Cercle").querySelector("svg")).not.toBeNull();
  // Un seul pressé parmi Outil, Forme et Relier.
  expect(boutons().slice(0, 10).filter((x) => x.getAttribute("aria-pressed") === "true").length).toBe(1);
  par("Cercle").click();
  expect(boutons().slice(0, 10).filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Cercle"]);
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
  expect(document.activeElement).toBe(par("Sélection"));
  touche(par("Sélection"), "ArrowLeft");
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
  expect(document.activeElement).toBe(par("100 %"));
  touche(par("100 %"), "ArrowUp");
  expect(document.activeElement).toBe(par("Par défaut"));
  // Grand, Bas : « Aux deux bouts » ; Bas : « Premier plan ».
  par("Grand").focus();
  touche(par("Grand"), "ArrowDown");
  expect(document.activeElement).toBe(par("Aux deux bouts"));
  touche(par("Aux deux bouts"), "ArrowDown");
  expect(document.activeElement).toBe(par("Premier plan"));
  par("Par défaut").focus();
  // Un seul arrêt de Tab : le dernier bouton qui a eu le focus.
  expect(boutons().filter((x) => x.tabIndex === 0).map((x) => x.getAttribute("aria-label"))).toEqual(["Par défaut"]);
  touche(par("Par défaut"), "End");
  expect(document.activeElement).toBe(par("Arrière-plan"));
  touche(par("Arrière-plan"), "ArrowDown");
  expect(document.activeElement).toBe(par("Arrière-plan"));
  touche(par("Arrière-plan"), "Home");
  expect(document.activeElement).toBe(par("Choisir"));
  // Entrée presse sans déplacer le focus ; Échap appelle surEchap.
  par("Courbe").focus();
  par("Courbe").click();
  expect(document.activeElement).toBe(par("Courbe"));
  expect(choix).toEqual([["trace", "curved"]]);
  touche(par("Courbe"), "Escape");
  expect(echaps).toBe(1);
  // Un clic sur un outil pose le focus.
  const bouton = par("Losange");
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
  expect(presses).toEqual(["Choisir", "Vert", "100 %", "Normal", "Coudé", "Aucune", "Pointillés", "Fin"]);
  expect(css).toMatch(/\.ya-tableau-outils \.ya-icon-btn\[aria-current="true"\]::after/);
});

test("REQ133_AC11_pas_de_defilement_horizontal_a_278px", () => {
  const regle = css.match(/\.ya-tableau-outils\s*\{([^}]*)\}/)[1];
  expect(regle).toMatch(/overflow-x:\s*hidden/);
  expect(regle).toMatch(/width:\s*278px/);
});

test("REQ133_AC1_valeurs_de_depart_et_plan_inactif", () => {
  monter();
  expect(boutons().filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Choisir", "Par défaut", "100 %", "Normal", "Droit", "À l'arrivée", "Plein", "Fin"]);
  expect(par("Rectangle").getAttribute("aria-current")).toBe("true");
  expect(par("Premier plan").getAttribute("aria-disabled")).toBe("true");
  expect(par("Arrière-plan").getAttribute("aria-disabled")).toBe("true");
  b.definir({ ...DEPART(), opacite: 50, taille: "large", epaisseur: "thick" }, { planActif: true });
  expect(boutons().filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Choisir", "Par défaut", "50 %", "Grand", "Droit", "À l'arrivée", "Plein", "Épais"]);
  expect(par("Premier plan").hasAttribute("aria-disabled")).toBe(false);
});

test("REQ139_AC4_style_sans_focus_a_la_souris_et_info_bulle", () => {
  monter();
  const bas = (nom) => par(nom).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  expect(bas("Grand")).toBe(false);
  expect(bas("Premier plan")).toBe(false);
  expect(bas("Rouge")).toBe(false);
  // Un outil prend le focus.
  expect(bas("Cercle")).toBe(true);
  par("Grand").click();
  expect(document.activeElement).not.toBe(par("Grand"));
  expect(choix).toEqual([["taille", "large"]]);
  expect(par("Grand").getAttribute("aria-pressed")).toBe("true");
  vi.useFakeTimers();
  par("Grand").enveloppe.dispatchEvent(new MouseEvent("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Taille du texte : Grand");
});

test("REQ141_AC4_plan_inactif_garde_focus_et_info_bulle_actif_appelle_surAction", () => {
  monter();
  par("Premier plan").focus();
  expect(document.activeElement).toBe(par("Premier plan"));
  par("Premier plan").click();
  par("Arrière-plan").click();
  expect(actions).toEqual([]);
  vi.useFakeTimers();
  par("Arrière-plan").enveloppe.dispatchEvent(new MouseEvent("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Arrière-plan");
  vi.useRealTimers();
  b.definir(DEPART(), { planActif: true });
  par("Premier plan").click();
  par("Arrière-plan").click();
  expect(actions).toEqual(["premier", "arriere"]);
  expect(choix).toEqual([]);
  b.definir(DEPART(), { planActif: false });
  expect(par("Premier plan").getAttribute("aria-disabled")).toBe("true");
});
