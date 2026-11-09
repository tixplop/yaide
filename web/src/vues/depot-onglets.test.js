import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cadre } from "../ui/cadre.js";
import { vueEditeur } from "./editeur.js";
import { TYPE_ONGLET } from "./depot-onglets.js";

vi.mock("./claude.js", () => ({ vueClaude: () => ({ corps: document.createElement("div"), focus() {}, ajuster() {}, detruire() {} }) }));
vi.mock("./opencode.js", () => ({ vueOpencode: () => ({ corps: document.createElement("div"), focus() {}, detruire() {} }) }));
vi.mock("./agent.js", () => ({ vueAgent: () => ({ corps: document.createElement("div"), focuser() {}, majListe() {}, relireReglages() {}, detruire() {} }) }));
vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

Range.prototype.getClientRects ??= () => [];
Range.prototype.getBoundingClientRect ??= () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
HTMLCanvasElement.prototype.getContext = () => null;

// Dimensions simulées : un groupe fait `taille`, le corps d'une couche commence 30 px plus bas.
const taille = { largeur: 1000, hauteur: 600 };
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
const rectOriginal = Element.prototype.getBoundingClientRect;
let editeurs = [];
beforeEach(() => {
  taille.largeur = 1000;
  taille.hauteur = 600;
  document.documentElement.style.setProperty("--largeur-editeur-min", "320px");
  document.documentElement.style.setProperty("--hauteur-editeur-min", "120px");
  Element.prototype.getBoundingClientRect = function () {
    if (this.classList?.contains("ya-depot-corps")) return rect(0, 30, 800, 570);
    if (this.classList?.contains("cadre-groupe")) return rect(0, 0, taille.largeur, taille.hauteur);
    return rectOriginal.call(this);
  };
});
afterEach(() => {
  for (const e of editeurs) e.detruire();
  editeurs = [];
  document.body.replaceChildren();
  Element.prototype.getBoundingClientRect = rectOriginal;
});

function monter(chemins) {
  const surCourant = vi.fn();
  let c = null;
  const e = vueEditeur({ dire: vi.fn(), surActif: vi.fn(), surCourant, surGroupes: (arbre, courant) => c?.definirGroupes(arbre, courant) });
  editeurs.push(e);
  c = cadre({ principal: { groupes: e.groupes() } });
  document.body.append(c);
  e.lecture(false);
  for (const chemin of chemins) e.ouvrir({ chemin, contenu: `contenu ${chemin}`, version: "1" });
  return { e, c, surCourant };
}
/** Deux groupes : g1 (a, b) et g2 (c). */
function deux() {
  const m = monter(["a.txt", "b.txt", "c.txt"]);
  m.e.deplacer("c.txt", "g1", "droite");
  return m;
}
const barres = () => [...document.querySelectorAll("[role=tablist]")];
const noms = (barre) => [...barre.querySelectorAll("[role=tab]")].map((t) => t.querySelector(".onglet-nom").textContent);
const onglet = (nom) => [...document.querySelectorAll("[role=tab]")].find((t) => t.querySelector(".onglet-nom").textContent === nom);
const couches = () => [...document.querySelectorAll(".ya-depot")];
const guides = (couche) => [...couche.querySelectorAll("[data-zone-depot]")].map((g) => g.dataset.zoneDepot);
const apercus = () => [...document.querySelectorAll("[data-depot]")].map((a) => a.dataset.depot);
const trame = () => new Promise((r) => requestAnimationFrame(() => r()));

function fauxTransfert() {
  return { donnees: {}, effectAllowed: "", dropEffect: "", setData(t, v) { this.donnees[t] = v; }, setDragImage: vi.fn() };
}
function evt(type, cible, { x = 0, y = 0, dt = fauxTransfert() } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  e.dataTransfer = dt;
  cible.dispatchEvent(e);
  return e;
}
async function glisser(nom) {
  const dt = fauxTransfert();
  evt("dragstart", onglet(nom), { dt });
  await trame();
  return dt;
}
// Positions dans le corps simulé (0, 30, 800 x 570).
const AU_MILIEU = { x: 400, y: 300 };
const A_DROITE = { x: 790, y: 300 };
const A_GAUCHE = { x: 10, y: 300 };
const SUR_LA_BARRE = { x: 400, y: 10 };

test("REQ079_AC6_aucune_cible", async () => {
  monter(["a.txt"]);
  await glisser("a.txt");
  expect(couches().length).toBe(1);
  expect(document.querySelectorAll("[data-zone-depot]").length).toBe(0);
  const v = evt("dragover", couches()[0], AU_MILIEU);
  expect(v.defaultPrevented).toBe(false);
  expect(apercus()).toEqual([]);
});

test("REQ079_AC14_echap_et_hors_cible", async () => {
  deux();
  const avant = barres().map(noms);
  await glisser("a.txt");
  // Au-dessus d'un éditeur : rien n'arrive à l'éditeur, pas de preventDefault.
  const contenu = document.querySelector(".cm-content");
  const recu = vi.fn();
  for (const t of ["dragover", "drop", "dragenter"]) contenu.addEventListener(t, recu);
  for (const t of ["dragover", "drop", "dragenter"]) expect(evt(t, contenu).defaultPrevented).toBe(false);
  expect(recu).not.toHaveBeenCalled();
  // Cible refusée : la barre du propre groupe (pas de centre).
  const propre = couches()[0];
  expect(evt("dragover", propre, SUR_LA_BARRE).defaultPrevented).toBe(false);
  expect(evt("drop", propre, SUR_LA_BARRE).defaultPrevented).toBe(false);
  expect(barres().map(noms)).toEqual(avant);
  // Échap : le navigateur envoie dragend.
  evt("dragend", onglet("a.txt"));
  expect(couches()).toEqual([]);
  expect(apercus()).toEqual([]);
  expect(barres().map(noms)).toEqual(avant);
});

test("REQ079_AC17_glisse_de_l_arbre_sans_guide", async () => {
  deux();
  const ligne = document.createElement("div");
  document.body.append(ligne);
  const dt = fauxTransfert();
  evt("dragstart", ligne, { dt });
  await trame();
  expect(couches()).toEqual([]);
  expect(document.querySelectorAll("[data-zone-depot]").length).toBe(0);
});

test("REQ079_AC22_guides_des_seules_cibles", async () => {
  deux();
  await glisser("a.txt");
  const [propre, autre] = couches();
  expect(guides(propre).sort()).toEqual(["bas", "droite", "gauche", "haut"]);
  expect(guides(autre).sort()).toEqual(["bas", "centre", "droite", "gauche", "haut"]);
  // Une pastille avec son icône dans chaque guide.
  expect(autre.querySelectorAll("[data-zone-depot] > .ya-depot-pastille svg").length).toBe(5);
  evt("dragend", onglet("a.txt"));
  // Un groupe de 600 x 200 : pas de côté haut ni bas (100 < 120), ni gauche ni droite à 600 (300 < 320).
  taille.largeur = 600;
  taille.hauteur = 200;
  await glisser("a.txt");
  expect(guides(couches()[0])).toEqual([]);
  expect(guides(couches()[1])).toEqual(["centre"]);
});

test("REQ079_AC23_un_seul_apercu_qui_suit", async () => {
  deux();
  await glisser("a.txt");
  const [, autre] = couches();
  const v = evt("dragover", autre, A_DROITE);
  expect(v.defaultPrevented).toBe(true);
  expect(v.dataTransfer.dropEffect).toBe("move");
  expect(apercus()).toEqual(["droite"]);
  expect(autre.querySelector("[data-depot]")).not.toBeNull();
  evt("dragover", autre, A_GAUCHE);
  expect(apercus()).toEqual(["gauche"]);
  evt("dragover", autre, AU_MILIEU);
  expect(apercus()).toEqual(["centre"]);
  evt("dragover", autre, SUR_LA_BARRE);
  expect(apercus()).toEqual(["centre"]);
  // Le propre groupe, côté droit : l'aperçu passe dans sa couche, il n'y en a toujours qu'un.
  evt("dragover", couches()[0], A_DROITE);
  expect(apercus()).toEqual(["droite"]);
  expect(couches()[0].querySelector("[data-depot]")).not.toBeNull();
  // Cible refusée : plus d'aperçu.
  evt("dragover", couches()[0], SUR_LA_BARRE);
  expect(apercus()).toEqual([]);
});

test("REQ079_AC24_fin_du_glisse_et_refus", async () => {
  const { e } = deux();
  const dt = await glisser("a.txt");
  expect(dt.effectAllowed).toBe("move");
  expect(Object.keys(dt.donnees)).toEqual([TYPE_ONGLET]);
  expect(dt.setDragImage).toHaveBeenCalledTimes(1);
  const image = dt.setDragImage.mock.calls[0][0];
  expect(image.querySelector(".liste-libelle").textContent).toBe("a.txt");
  expect(image.querySelector("svg")).not.toBeNull();
  // Refus puis fin sans dépôt.
  expect(evt("drop", couches()[0], SUR_LA_BARRE).defaultPrevented).toBe(false);
  evt("dragend", onglet("a.txt"));
  expect(couches()).toEqual([]);
  expect(barres().map(noms)).toEqual([["a.txt", "b.txt"], ["c.txt"]]);
  // Dépôt au centre du groupe d'à côté.
  await glisser("a.txt");
  evt("dragover", couches()[1], AU_MILIEU);
  const d = evt("drop", couches()[1], AU_MILIEU);
  expect(d.defaultPrevented).toBe(true);
  expect(couches()).toEqual([]);
  expect(apercus()).toEqual([]);
  expect(barres().map(noms)).toEqual([["b.txt"], ["c.txt", "a.txt"]]);
  // Dépôt sur un côté : un troisième groupe.
  await glisser("c.txt");
  evt("drop", couches()[0], A_DROITE);
  expect(barres().map(noms)).toEqual([["b.txt"], ["c.txt"], ["a.txt"]]);
  expect(e.groupes().sens).toBe("ligne");
});

test("REQ079_AC29_guides_sans_cote", async () => {
  deux();
  taille.largeur = 1000;
  taille.hauteur = 200;
  await glisser("a.txt");
  const corps = couches()[1].querySelector(".ya-depot-corps");
  expect(corps.style.getPropertyValue("--g")).toBe("25%");
  expect(corps.style.getPropertyValue("--d")).toBe("25%");
  expect(corps.style.getPropertyValue("--h")).toBe("0%");
  expect(corps.style.getPropertyValue("--b")).toBe("0%");
  expect(guides(couches()[1]).sort()).toEqual(["centre", "droite", "gauche"]);
  // Au bord haut, le côté haut n'est pas une cible : le centre.
  evt("dragover", couches()[1], { x: 400, y: 40 });
  expect(apercus()).toEqual(["centre"]);
});

test("REQ079_AC30_inactif_non_active_focus_conserve", async () => {
  const { surCourant } = deux();
  const zone = (n) => [...document.querySelectorAll(".zone-code")].find((z) => z.vue.contentDOM.getAttribute("aria-label") === `Éditeur ${n}`);
  const editeur = zone("b.txt").vue.contentDOM; // l'éditeur visible
  editeur.focus();
  expect(document.activeElement).toBe(editeur);
  const selectionAvant = ["a.txt", "b.txt", "c.txt"].map((n) => onglet(n).getAttribute("aria-selected"));
  const courantAvant = surCourant.mock.calls.length;
  const cible = onglet("a.txt"); // un onglet inactif
  cible.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  cible.focus(); // le navigateur donne le focus à l'onglet pressé
  await glisser("a.txt");
  expect(document.activeElement).toBe(editeur);
  // Le contenu des groupes ne change pas pendant le glissé.
  expect(zone("b.txt").hidden).toBe(false);
  expect(zone("a.txt").hidden).toBe(true);
  expect(["a.txt", "b.txt", "c.txt"].map((n) => onglet(n).getAttribute("aria-selected"))).toEqual(selectionAvant);
  expect(surCourant.mock.calls.length).toBe(courantAvant);
  // Échap : le focus est toujours où il était.
  evt("dragend", cible);
  expect(document.activeElement).toBe(editeur);
});

test("REQ079_AC31_type_unique_et_aria_hidden", async () => {
  deux();
  const dt = await glisser("a.txt");
  expect(Object.keys(dt.donnees)).toEqual(["application/x-yaide-onglet"]);
  expect(dt.donnees["text/plain"]).toBeUndefined();
  expect(couches().length).toBe(2);
  for (const c of couches()) expect(c.getAttribute("aria-hidden")).toBe("true");
  // Les couches viennent après le contenu du groupe, et sont créées au tour suivant le dragstart.
  expect(onglet("a.txt").closest(".cadre-groupe").lastElementChild.classList.contains("ya-depot")).toBe(true);
  evt("dragend", onglet("a.txt"));
  evt("dragstart", onglet("a.txt"));
  expect(couches()).toEqual([]);
  evt("dragend", onglet("a.txt"));
  await trame();
  expect(couches()).toEqual([]);
});

test("REQ079_rendu_reporte_pendant_le_glisse", async () => {
  const { e } = deux();
  const source = onglet("a.txt");
  await glisser("a.txt");
  e.ouvrir({ chemin: "d.txt", contenu: "d", version: "1" });
  // La barre n'est pas refaite : l'onglet source reste dans le DOM.
  expect(source.isConnected).toBe(true);
  expect(onglet("d.txt")).toBeUndefined();
  evt("dragend", source);
  expect(onglet("d.txt")).toBeDefined();
});

test("REQ079_source_disparue", async () => {
  const { e } = deux();
  await glisser("b.txt");
  e.supprime({ chemin: "b.txt" });
  const dedans = evt("dragover", couches()[1], AU_MILIEU);
  expect(dedans.defaultPrevented).toBe(true);
  expect(() => evt("drop", couches()[1], AU_MILIEU)).not.toThrow();
  expect(couches()).toEqual([]);
  expect(barres().map(noms)).toEqual([["a.txt"], ["c.txt"]]);
});

// REQ-080 AC-21 : les poignées sont inertes pendant un glissé d'onglet.
const classePosee = () => document.documentElement.classList.contains("onglet-glisse");
test("REQ080_AC21_poignees_inertes_pendant_le_glisse", async () => {
  const { e } = deux();
  expect(classePosee()).toBe(false);
  // Posée au tour suivant le dragstart, jamais pendant.
  evt("dragstart", onglet("a.txt"));
  expect(classePosee()).toBe(false);
  await trame();
  expect(classePosee()).toBe(true);
  // Dépôt.
  evt("dragover", couches()[1], AU_MILIEU);
  evt("drop", couches()[1], AU_MILIEU);
  evt("dragend", document.body);
  expect(classePosee()).toBe(false);
  // Échap : dragend.
  await glisser("c.txt");
  expect(classePosee()).toBe(true);
  evt("dragend", onglet("c.txt"));
  expect(classePosee()).toBe(false);
  // Source disparue.
  await glisser("b.txt");
  e.supprime({ chemin: "b.txt" });
  evt("drop", couches()[0], AU_MILIEU);
  evt("dragend", document.body);
  expect(classePosee()).toBe(false);
  // Fin avant la trame : la classe n'est jamais posée.
  evt("dragstart", onglet("a.txt") ?? onglet("c.txt"));
  evt("dragend", document.body);
  await trame();
  expect(classePosee()).toBe(false);
  // La règle CSS.
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  expect(css).toMatch(/\.onglet-glisse \.poignee-groupe\s*\{\s*pointer-events:\s*none;?\s*\}/);
});
