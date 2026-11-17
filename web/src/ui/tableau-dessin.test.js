import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (selecteur) => css.split("}").map((r) => r.trim()).filter((r) => r.startsWith(selecteur + " {") || r.startsWith(selecteur + ","));

const boite = (id, x, y, extra = {}) => ({ id, x, y, width: 160, height: 80, text: id, ...extra });
const DOC = (extra = {}) => ({ version: 1, boxes: [boite("b1", 100, 100), boite("b2", 400, 100)], links: [], arrows: [], ...extra });

let t;
let changements;
let vues;
function monter(doc = DOC(), vue = { x: 0, y: 0, zoom: 1 }) {
  changements = [];
  vues = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue, surChangement: (d) => changements.push(d), surVue: (v) => vues.push(v) });
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
const touche = (key, opts = {}) => surface().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const trait = (id) => obj(id).querySelector(".trait");
const pointes = (id) => [...obj(id).querySelectorAll(".pointe")].map((p) => p.getAttribute("points").split(" ")[0]);
const lien = (extra = {}) => ({ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left", ...extra });
const fleche = (extra = {}) => ({ id: "a1", x1: 100, y1: 100, x2: 300, y2: 180, ...extra });

test("REQ134_AC2_une_boite_de_chaque_forme_est_dessinee_avec_sa_forme_et_son_texte", () => {
  const formes = ["rectangle", "rounded", "ellipse", "diamond", "note", "text"];
  monter(DOC({ boxes: formes.map((shape, i) => boite(`f${i}`, 0, i * 100, { shape })) }));
  const forme = (i) => obj(`f${i}`).querySelector(".forme");
  expect(forme(0).tagName).toBe("rect");
  expect(forme(0).getAttribute("rx")).toBe("4");
  expect(forme(1).tagName).toBe("rect");
  expect(forme(1).getAttribute("rx")).toBe("16");
  expect(forme(2).tagName).toBe("ellipse");
  expect([forme(2).getAttribute("rx"), forme(2).getAttribute("ry")]).toEqual(["80", "40"]);
  expect(forme(3).getAttribute("d")).toBe("M 80 300 L 160 340 L 80 380 L 0 340 Z");
  expect(forme(4).getAttribute("d")).toBe("M 0 400 H 144 L 160 416 V 480 H 0 Z");
  expect(obj("f4").querySelector(".pli").getAttribute("d")).toBe("M 144 400 V 416 H 160");
  expect(obj("f0").querySelector(".pli")).toBeNull();
  // « Texte » : pas de fond ni de contour au repos (le CSS), mais le même rectangle pour la prise.
  expect(obj("f5").classList.contains("forme-text")).toBe(true);
  expect(regle(".ya-tableau .boite.forme-text .forme")[0]).toMatch(/fill: transparent; stroke: none/);
  for (let i = 0; i < 6; i++) expect(obj(`f${i}`).querySelector(".ya-tableau-texte").textContent).toBe(`f${i}`);
  // Elles se choisissent et se déplacent comme un rectangle.
  clic(forme(2));
  touche("ArrowDown");
  expect(changements.at(-1).boxes[2]).toMatchObject({ y: 210 });
  touche("Delete");
  expect(changements.at(-1).boxes.map((b) => b.id)).not.toContain("f2");
});

test("REQ134_AC3_une_boite_verte_prend_la_couleur_verte_du_design_system", () => {
  monter(DOC({ boxes: [boite("b1", 0, 0, { color: "green" }), boite("b2", 300, 0)] }));
  expect(obj("b1").classList.contains("couleur-green")).toBe(true);
  expect(obj("b2").classList.contains("couleur-default")).toBe(true);
  expect(regle(".ya-tableau .couleur-green")[0]).toContain("--boite-fond: var(--boite-vert-fond); --boite-trait: var(--boite-vert-trait)");
  expect(regle(".ya-tableau .boite")[0]).toContain("--boite-fond: var(--boite-defaut-fond); --boite-trait: var(--boite-defaut-trait)");
  expect(regle(".ya-tableau .boite .forme")[0]).toContain("fill: var(--boite-fond); stroke: var(--boite-trait)");
  for (const [cle, nom] of [["blue", "bleu"], ["yellow", "jaune"], ["orange", "orange"], ["red", "rouge"], ["purple", "violet"]]) {
    expect(regle(`.ya-tableau .couleur-${cle}`)[0]).toContain(`var(--boite-${nom}-fond)`);
  }
});

test("REQ134_AC6_forme_texte_sans_fond_cadre_en_tirets_au_survol_et_texte_teinte", () => {
  monter(DOC({ boxes: [boite("b1", 0, 0, { shape: "text", color: "green" })] }));
  expect(obj("b1").getAttribute("class")).toBe("boite forme-text couleur-green");
  expect(regle(".ya-tableau .boite.forme-text .forme")[0]).toContain("fill: transparent; stroke: none");
  const survol = regle(".ya-tableau .boite.forme-text:not(.choisie, .saisie, .glissee):hover .forme")[0];
  expect(survol).toContain("stroke: var(--line-strong)");
  expect(survol).toContain("stroke-dasharray: 4 4");
  expect(regle(".ya-tableau .boite.forme-text .ya-tableau-texte")[0]).toContain("color: var(--boite-trait)");
  expect(regle(".ya-tableau .boite.forme-text.couleur-default .ya-tableau-texte")[0]).toContain("color: var(--ink)");
  // Choisie : trait plein de 2 px accent, tirets ôtés.
  const choisie = regle(".ya-tableau .boite.choisie .forme")[0];
  expect(choisie).toContain("stroke: var(--accent-fg); stroke-width: var(--trait-fort); stroke-dasharray: none");
  clic(obj("b1").querySelector(".forme"));
  expect(obj("b1").classList.contains("choisie")).toBe(true);
});

test("REQ134_AC7_texte_dans_le_rectangle_inscrit_et_coins_de_16_px", () => {
  monter(DOC({
    boxes: [
      boite("c", 0, 0, { shape: "ellipse", width: 100, height: 100 }),
      boite("d", 200, 0, { shape: "diamond", height: 100 }),
      boite("n", 0, 200, { shape: "note" }),
    ],
  }));
  const zone = (id) => {
    const f = obj(id).querySelector("foreignObject");
    return ["x", "y", "width", "height"].map((a) => Number(Number(f.getAttribute(a)).toFixed(1)));
  };
  expect(zone("c")).toEqual([14.6, 14.6, 70.7, 70.7]);
  expect(zone("d")).toEqual([240, 25, 80, 50]);
  expect(zone("n")).toEqual([0, 200, 160, 80]);
  expect(obj("n").querySelector(".pli").getAttribute("d")).toBe("M 144 200 V 216 H 160");
  expect(regle(".ya-tableau-texte")[0]).toMatch(/justify-content: safe center.*overflow: hidden.*overflow-wrap: anywhere/);
});

test("REQ135_AC1_AC2_lien_coude_ou_courbe_part_et_arrive_a_l_horizontale", () => {
  const b2 = boite("b2", 400, 300);
  monter(DOC({ boxes: [boite("b1", 100, 100), b2], links: [lien({ route: "orthogonal" })] }));
  const d = trait("l1").getAttribute("d");
  expect(d).toBe("M 260 140 L 330 140 L 330 340 L 400 340");
  const segments = d.split(" L ").map((p) => p.replace("M ", "").split(" ").map(Number));
  for (let i = 1; i < segments.length; i++) expect(segments[i][0] === segments[i - 1][0] || segments[i][1] === segments[i - 1][1]).toBe(true);
  t.definirDocument(DOC({ boxes: [boite("b1", 100, 100), b2], links: [lien({ route: "curved" })] }));
  const c = trait("l1").getAttribute("d");
  expect(c).toMatch(/^M 260 140 C [\d. ]+, [\d. ]+, 400 340$/);
  expect(c.match(/C/g)).toHaveLength(1);
  // Sans côté, coudé, « Fin » en dessous : côté bas de « Début » vers côté haut de « Fin ».
  t.definirDocument(DOC({ boxes: [boite("b1", 100, 100), boite("b2", 100, 300)], links: [{ id: "l1", from: "b1", to: "b2", route: "orthogonal" }] }));
  expect(trait("l1").getAttribute("d")).toBe("M 180 180 L 180 300");
});

test("REQ135_AC3_les_extremites_donnent_zero_une_ou_deux_pointes_sur_les_bords", () => {
  const avec = (ends) => {
    t.definirDocument(DOC({ links: [lien({ ends })] }));
    return pointes("l1");
  };
  monter(DOC({ links: [lien()] }));
  expect(pointes("l1")).toEqual(["400,140"]);
  expect(avec("none")).toEqual([]);
  expect(avec("start")).toEqual(["260,140"]);
  expect(avec("both")).toEqual(["260,140", "400,140"]);
  expect(avec("end")).toEqual(["400,140"]);
});

test("REQ135_AC4_le_trait_est_plein_en_tirets_ou_en_points", () => {
  monter(DOC({ links: [lien()] }));
  expect(trait("l1").hasAttribute("stroke-dasharray")).toBe(false);
  t.definirDocument(DOC({ links: [lien({ line: "dashed" })] }));
  expect(trait("l1").getAttribute("stroke-dasharray")).toBe("6 4");
  t.definirDocument(DOC({ links: [lien({ line: "dotted" })] }));
  expect(trait("l1").getAttribute("stroke-dasharray")).toBe("0 4");
  expect(trait("l1").getAttribute("stroke-linecap")).toBe("round");
  expect(regle(".ya-tableau :is(.lien, .fleche).ligne-dotted .trait")[0]).toContain("stroke-width: 2px");
});

test("REQ135_AC5_la_zone_de_prise_suit_le_meme_trace_sur_12_px", () => {
  monter(DOC({ boxes: [boite("b1", 100, 100), boite("b2", 400, 300)], links: [lien({ route: "curved" })] }));
  const prise = obj("l1").querySelector(".prise");
  expect(prise.tagName).toBe("path");
  expect(prise.getAttribute("d")).toBe(trait("l1").getAttribute("d"));
  expect(regle(".ya-tableau :is(.lien, .fleche) .prise")[0]).toContain("stroke-width: 12px");
  clic(prise);
  expect(obj("l1").classList.contains("choisie")).toBe(true);
});

test("REQ135_AC6_lien_choisi_garde_ses_tirets_et_ses_deux_pointes_en_accent", () => {
  monter(DOC({ links: [lien({ line: "dashed", ends: "both" })] }));
  clic(obj("l1").querySelector(".prise"));
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  expect(trait("l1").getAttribute("stroke-dasharray")).toBe("6 4");
  expect(pointes("l1")).toHaveLength(2);
  expect(regle(".ya-tableau :is(.lien, .fleche).choisie .trait")[0]).toContain("stroke: var(--accent-fg); stroke-width: var(--trait-fort)");
  expect(regle(".ya-tableau :is(.lien, .fleche).choisie .pointe")[0]).toContain("fill: var(--accent-fg)");
});

test("REQ130_AC2_un_lien_avec_cotes_et_un_lien_sans_cote_suivent_la_boite_deplacee", () => {
  const doc = (y) => DOC({ boxes: [boite("b1", 100, 100), boite("b2", 400, y)], links: [lien(), { id: "l2", from: "b1", to: "b2" }] });
  monter(doc(100));
  expect(trait("l1").getAttribute("d")).toBe("M 260 140 L 400 140");
  t.definirDocument(doc(300));
  expect(trait("l1").getAttribute("d")).toBe("M 260 140 L 400 340");
  // Sans côté : sur la droite des centres (180, 140) – (480, 340), d'un bord à l'autre.
  const [x, y] = pointes("l2")[0].split(",").map(Number);
  expect(x).toBeCloseTo(420, 0);
  expect(y).toBeCloseTo(300, 0);
});

test("REQ130_AC6_un_lien_est_un_lien_nomme_de_a_vers_b", () => {
  monter(DOC({ links: [lien()] }));
  expect(obj("l1").getAttribute("aria-roledescription")).toBe("lien");
  expect(obj("l1").getAttribute("aria-label")).toBe("De b1 vers b2");
  expect(obj("l1").getAttribute("role")).toBe("group");
});

test("REQ129_AC6_supprimer_une_boite_garde_les_fleches_libres", () => {
  monter(DOC({ links: [lien()], arrows: [fleche()] }));
  clic(obj("b1").querySelector(".forme"));
  touche("Delete");
  expect(changements.at(-1).links).toEqual([]);
  expect(changements.at(-1).arrows).toEqual([fleche()]);
  expect(obj("a1")).not.toBeNull();
  // Suppr sur la flèche libre : seule elle disparaît.
  clic(obj("a1").querySelector(".prise"));
  touche("Delete");
  expect(changements.at(-1).arrows).toEqual([]);
  expect(changements.at(-1).boxes.map((b) => b.id)).toEqual(["b2"]);
  expect(obj("a1")).toBeNull();
});

test("REQ136_AC5_tab_boites_puis_liens_puis_fleches_libres_nom_et_poignees_masquees", () => {
  monter(DOC({ boxes: [boite("b1", 100, 100)], links: [], arrows: [fleche()] }));
  t.definirDocument(DOC({ links: [lien()], arrows: [fleche()] }));
  const suite = [];
  for (let i = 0; i < 4; i++) {
    touche("Tab");
    suite.push(surface().getAttribute("aria-activedescendant"));
  }
  expect(suite).toEqual(["b1", "b2", "l1", "a1"].map((id) => obj(id).id));
  expect(obj("a1").getAttribute("aria-roledescription")).toBe("flèche");
  expect(obj("a1").getAttribute("aria-label")).toBe("Flèche libre");
  const poignees = t.element.querySelector(".poignees");
  expect(poignees.getAttribute("aria-hidden")).toBe("true");
  expect(poignees.querySelectorAll(".bout")).toHaveLength(2);
  touche("Tab", { shiftKey: true });
  expect(surface().getAttribute("aria-activedescendant")).toBe(obj("l1").id);
  expect(t.element.querySelector(".poignees")).toBeNull();
});

test("REQ136_AC2_fleche_bas_deplace_les_deux_bouts_de_la_fleche_libre_de_10_px", () => {
  monter(DOC({ arrows: [fleche()] }));
  clic(obj("a1").querySelector(".prise"));
  touche("ArrowDown");
  expect(changements.at(-1).arrows).toEqual([fleche({ y1: 110, y2: 190 })]);
  expect(changements.at(-1).boxes).toEqual(DOC().boxes);
  expect(trait("a1").getAttribute("d")).toBe("M 100 110 L 300 190");
});

test("REQ136_AC6_fleche_choisie_a_deux_ronds_de_bout_et_reste_entiere_dans_la_vue", () => {
  monter(DOC({ arrows: [fleche({ x1: 700, y1: 100, x2: 780, y2: 100 })] }));
  clic(obj("a1").querySelector(".prise"));
  expect(obj("a1").classList.contains("choisie")).toBe(true);
  const bouts = [...t.element.querySelectorAll(".poignees .bout")].map((c) => [c.getAttribute("cx"), c.getAttribute("cy"), c.getAttribute("r")]);
  expect(bouts).toEqual([["700", "100", "4.5"], ["780", "100", "4.5"]]);
  expect(regle(".ya-tableau .poignees .bout")[0]).toContain("fill: var(--accent-fg)");
  expect(regle('.ya-tableau .poignees .prise[data-poignee="depart"], .ya-tableau .poignees .prise[data-poignee="arrivee"]')[0]).toContain("cursor: crosshair");
  expect(regle(".ya-tableau .fleche .prise")[0]).toContain("cursor: move");
  for (let i = 0; i < 3; i++) touche("ArrowRight");
  expect(changements.at(-1).arrows[0]).toMatchObject({ x1: 730, x2: 810 });
  expect(vues.at(-1)).toEqual({ x: 34, y: 0, zoom: 1 });
});

test("REQ136_AC4_tout_afficher_montre_aussi_la_fleche_libre", () => {
  monter(DOC({ boxes: [boite("b1", 0, 0)], arrows: [fleche({ x1: 0, y1: 0, x2: 3000, y2: 2000 })] }));
  t.toutAfficher();
  const v = vues.at(-1);
  expect(v.zoom).toBeLessThan(0.25 + 0.2);
  expect(v.x).toBeLessThan(0);
});

test("REQ134_AC2_une_ellipse_et_un_losange_se_redimensionnent_par_la_poignee_de_taille", () => {
  monter(DOC({ boxes: [boite("e", 0, 0, { shape: "ellipse" }), boite("d", 300, 0, { shape: "diamond" })] }));
  const ptr = (cible, type, x, y) => {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(ev, "pointerId", { value: 1 });
    cible.dispatchEvent(ev);
  };
  const glisser = (cible, de, vers) => {
    ptr(cible, "pointerdown", ...de);
    ptr(surface(), "pointermove", (de[0] + vers[0]) / 2, (de[1] + vers[1]) / 2);
    ptr(surface(), "pointermove", ...vers);
    ptr(surface(), "pointerup", ...vers);
  };
  const poignee = () => t.element.querySelector('[data-poignee="taille"]');
  clic(obj("e").querySelector(".forme"));
  glisser(poignee(), [160, 80], [220, 100]);
  expect(changements.at(-1).boxes[0]).toMatchObject({ id: "e", width: 220, height: 100 });
  const el = obj("e").querySelector(".forme");
  expect([el.getAttribute("rx"), el.getAttribute("ry")]).toEqual(["110", "50"]);
  clic(obj("d").querySelector(".forme"));
  glisser(poignee(), [460, 80], [400, 60]);
  expect(changements.at(-1).boxes[1]).toMatchObject({ id: "d", width: 100, height: 60 });
  expect(obj("d").querySelector(".forme").getAttribute("d")).toBe("M 350 0 L 400 30 L 350 60 L 300 30 Z");
});
