import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ecrireJdiag } from "../jdiag.js";
import { poigneesLien } from "./tableau-dessin.js";
import { tableau } from "./tableau.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (selecteur) => css.split("}").map((r) => r.trim()).filter((r) => r.startsWith(selecteur + " {") || r.startsWith(selecteur + ","));

const boite = (id, x, y, extra = {}) => ({ id, x, y, width: 160, height: 80, text: id, ...extra });
const DOC = (extra = {}) => ({ version: 1, boxes: [boite("b1", 100, 100), boite("b2", 400, 100)], links: [], arrows: [], ...extra });

let t;
let changements;
let vues;
function monter(doc = DOC(), vue = { x: 0, y: 0, zoom: 1 }, outils = undefined) {
  changements = [];
  vues = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue, outils, surChangement: (d) => changements.push(d), surVue: (v) => vues.push(v) });
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
  expect(choisie).toContain("stroke: var(--accent-fg); stroke-width: max(2px, var(--e))");
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
  expect(d).toBe("M 260 140 L 330 140 L 330 340 L 390 340");
  const segments = d.split(" L ").map((p) => p.replace("M ", "").split(" ").map(Number));
  for (let i = 1; i < segments.length; i++) expect(segments[i][0] === segments[i - 1][0] || segments[i][1] === segments[i - 1][1]).toBe(true);
  t.definirDocument(DOC({ boxes: [boite("b1", 100, 100), b2], links: [lien({ route: "curved" })] }));
  const c = trait("l1").getAttribute("d");
  expect(c).toMatch(/^M 260 140 C [\d. ]+, [\d. ]+, 390 340$/); // le trait s'arrête à la base de la pointe (10 px)
  expect(c.match(/C/g)).toHaveLength(1);
  // Sans côté, coudé, « Fin » en dessous : côté bas de « Début » vers côté haut de « Fin ».
  t.definirDocument(DOC({ boxes: [boite("b1", 100, 100), boite("b2", 100, 300)], links: [{ id: "l1", from: "b1", to: "b2", route: "orthogonal" }] }));
  expect(trait("l1").getAttribute("d")).toBe("M 180 180 L 180 290");
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
  expect(regle(".ya-tableau :is(.lien, .fleche).ligne-dotted .trait")[0]).toContain("stroke-width: max(2px, var(--e))");
});

test("REQ135_AC5_la_zone_de_prise_suit_le_meme_trace_sur_12_px", () => {
  monter(DOC({ boxes: [boite("b1", 100, 100), boite("b2", 400, 300)], links: [lien({ route: "curved" })] }));
  const prise = obj("l1").querySelector(".prise");
  expect(prise.tagName).toBe("path");
  expect(prise.getAttribute("d")).toBe("M 260 140 C 382.07 140, 277.93 340, 400 340"); // le tracé entier, pas celui du trait
  expect(regle(".ya-tableau :is(.lien, .fleche) .prise")[0]).toContain("stroke-width: max(12px, calc(var(--e) + 10px))");
  clic(prise);
  expect(obj("l1").classList.contains("choisie")).toBe(true);
});

test("REQ135_AC6_lien_choisi_garde_ses_tirets_et_ses_deux_pointes_en_accent", () => {
  monter(DOC({ links: [lien({ line: "dashed", ends: "both" })] }));
  clic(obj("l1").querySelector(".prise"));
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  expect(trait("l1").getAttribute("stroke-dasharray")).toBe("6 4");
  expect(pointes("l1")).toHaveLength(2);
  expect(regle(".ya-tableau :is(.lien, .fleche).choisie .trait")[0]).toContain("stroke: var(--accent-fg); stroke-width: max(2px, var(--e))");
  expect(regle(".ya-tableau :is(.lien, .fleche).choisie .pointe")[0]).toContain("fill: var(--accent-fg)");
});

test("REQ130_AC2_un_lien_avec_cotes_et_un_lien_sans_cote_suivent_la_boite_deplacee", () => {
  const doc = (y) => DOC({ boxes: [boite("b1", 100, 100), boite("b2", 400, y)], links: [lien(), { id: "l2", from: "b1", to: "b2" }] });
  monter(doc(100));
  expect(trait("l1").getAttribute("d")).toBe("M 260 140 L 390 140");
  t.definirDocument(doc(300));
  expect(trait("l1").getAttribute("d")).toMatch(/^M 260 140 L 39\d\.\d+ 3\d\d\.\d+$/);
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
  expect(t.element.querySelectorAll(".poignees .bout")).toHaveLength(2); // lien choisi seul : poignées de REQ-142
});

test("REQ136_AC2_fleche_bas_deplace_les_deux_bouts_de_la_fleche_libre_de_10_px", () => {
  monter(DOC({ arrows: [fleche()] }));
  clic(obj("a1").querySelector(".prise"));
  touche("ArrowDown");
  expect(changements.at(-1).arrows).toEqual([fleche({ y1: 110, y2: 190 })]);
  expect(changements.at(-1).boxes).toEqual(DOC().boxes);
  expect(trait("a1").getAttribute("d")).toBe("M 100 110 L 290.72 186.29");
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

const forme = (id) => obj(id).querySelector(".forme");
const largeur = (selecteur) => regle(selecteur)[0];

test("REQ138_AC1_contour_en_tirets_ou_en_points_sur_la_forme_et_le_pli", () => {
  monter(DOC({ boxes: [boite("b1", 0, 0, { shape: "note", line: "dashed" })] }));
  expect([forme("b1"), obj("b1").querySelector(".pli")].map((e) => e.getAttribute("stroke-dasharray"))).toEqual(["6 4", "6 4"]);
  t.definirDocument(DOC({ boxes: [boite("b1", 0, 0, { shape: "note", line: "dotted" })] }));
  expect([forme("b1"), obj("b1").querySelector(".pli")].map((e) => e.getAttribute("stroke-dasharray"))).toEqual(["0 4", "0 4"]);
  expect(forme("b1").getAttribute("stroke-linecap")).toBe("round");
  expect(largeur(".ya-tableau .boite.ligne-dotted:not(.forme-text) :is(.forme, .pli)")).toContain("stroke-width: max(2px, var(--e))");
  t.definirDocument(DOC({ boxes: [boite("b1", 0, 0, { shape: "note" })] }));
  expect(forme("b1").hasAttribute("stroke-dasharray")).toBe(false);
});

test("REQ138_AC2_epaisseur_du_contour_a_l_ecran_a_tout_zoom", () => {
  for (const [weight, e] of [["thick", "4px"], ["medium", "2px"], [undefined, "1px"]]) {
    for (const zoom of [0.5, 2]) {
      monter(DOC({ boxes: [boite("b1", 0, 0, weight ? { weight } : {})] }), { x: 0, y: 0, zoom });
      expect(obj("b1").classList.contains(`epaisseur-${weight ?? "thin"}`)).toBe(true);
      t.detruire();
    }
    expect(largeur(`.ya-tableau .boite.epaisseur-${weight ?? "thin"}`) ?? "--e: 1px").toContain(`--e: ${e}`);
  }
  expect(largeur(".ya-tableau .boite .forme")).toContain("stroke-width: var(--e)");
  expect(css).toMatch(/\.ya-tableau-surface svg \* \{ vector-effect: non-scaling-stroke; \}/);
  expect(largeur(".ya-tableau :where(.boite)")).toContain("--e: 1px");
});

test("REQ138_AC3_opacite_sur_la_forme_seule_et_clic_dans_une_boite_a_0_pour_cent", () => {
  monter(DOC({ boxes: [boite("b1", 100, 100, { opacity: 50 }), boite("b2", 150, 120, { opacity: 0 })] }));
  expect(forme("b1").getAttribute("fill-opacity")).toBe("0.5");
  expect(forme("b2").getAttribute("fill-opacity")).toBe("0");
  expect(obj("b1").querySelector(".ya-tableau-texte").hasAttribute("fill-opacity")).toBe(false);
  expect(obj("b1").hasAttribute("opacity")).toBe(false);
  expect(obj("b2").classList.contains("opacite-0")).toBe(true);
  expect(largeur(".ya-tableau .boite.opacite-0 .forme")).toContain("pointer-events: all");
  clic(forme("b2"));
  expect(obj("b2").classList.contains("choisie")).toBe(true);
  t.definirDocument(DOC({ boxes: [boite("b1", 0, 0)] }));
  expect(forme("b1").hasAttribute("fill-opacity")).toBe(false);
  t.definirDocument(DOC({ boxes: [boite("b1", 0, 0, { shape: "text", opacity: 25 })] }));
  expect(forme("b1").hasAttribute("fill-opacity")).toBe(false);
});

test("REQ138_AC5_boite_choisie_ou_survolee_garde_ses_tirets_a_max_2_e_px", () => {
  monter(DOC({ boxes: [boite("b1", 100, 100, { line: "dashed", weight: "thick" })] }));
  clic(forme("b1"));
  expect(obj("b1").classList.contains("choisie")).toBe(true);
  expect(forme("b1").getAttribute("stroke-dasharray")).toBe("12 8");
  const choisie = largeur(".ya-tableau .boite.choisie .forme");
  expect(choisie).toContain("stroke: var(--accent-fg); stroke-width: max(2px, var(--e))");
  expect(choisie).not.toContain("stroke-dasharray");
  expect(largeur(".ya-tableau .boite:hover .forme")).toContain("stroke-width: max(2px, var(--e))");
  expect(css).not.toMatch(/\.boite[^{]*\{[^}]*stroke-dasharray: none/);
});

test("REQ139_AC2_quatre_tailles_de_texte_sur_la_note_le_cercle_et_la_forme_texte", () => {
  const tailles = { small: "11px/15px", large: "18px/24px", xlarge: "24px/30px" };
  for (const shape of ["note", "ellipse", "text"]) {
    for (const [textSize, font] of Object.entries(tailles)) {
      monter(DOC({ boxes: [boite("b1", 0, 0, { shape, width: 100, height: 100, textSize })] }));
      expect(obj("b1").classList.contains(`taille-${textSize}`)).toBe(true);
      expect(largeur(`.ya-tableau .boite.taille-${textSize} .ya-tableau-texte`)).toContain(`font: ${font} var(--font-sans)`);
      t.detruire();
    }
  }
  monter(DOC({ boxes: [boite("b1", 0, 0, { shape: "ellipse", width: 100, height: 100, textSize: "xlarge" })] }));
  const fo = obj("b1").querySelector("foreignObject");
  expect([fo.getAttribute("x"), fo.getAttribute("width")]).toEqual(["14.64466094067262", "70.71067811865476"]);
  expect(obj("b1").querySelector("ellipse").getAttribute("rx")).toBe("50");
  // Dans la saisie, l'éditeur est dans la boîte : il prend la même taille.
  clic(forme("b1"));
  touche("Enter");
  expect(obj("b1").classList.contains("saisie")).toBe(true);
  expect(obj("b1").querySelector("[role=textbox]").className).toBe("ya-tableau-texte");
  expect(obj("b1").classList.contains("taille-xlarge")).toBe(true);
  t.definirDocument(DOC({ boxes: [boite("b1", 0, 0)] }));
  expect([...obj("b1").classList].some((c) => c.startsWith("taille-"))).toBe(false);
});

test("REQ140_AC1_trait_et_pointe_d_un_lien_colore", () => {
  monter(DOC({ links: [lien({ color: "red" })] }));
  expect(obj("l1").classList.contains("couleur-red")).toBe(true);
  expect(largeur(".ya-tableau .couleur-red")).toContain("--boite-trait: var(--boite-rouge-trait)");
  expect(largeur(".ya-tableau :is(.lien, .fleche) .trait")).toContain("stroke: var(--boite-trait)");
  expect(largeur(".ya-tableau :is(.lien, .fleche) .pointe")).toContain("fill: var(--boite-trait)");
  expect(largeur(".ya-tableau :where(.lien, .fleche)")).toContain("--boite-trait: var(--ink-muted)");
  t.definirDocument(DOC({ links: [lien()] }));
  expect([...obj("l1").classList].some((c) => c.startsWith("couleur-"))).toBe(false);
});

test("REQ140_AC2_epaisseur_et_tirets_d_un_lien_et_d_une_fleche_libre", () => {
  for (const [weight, e, tirets] of [["thick", "5px", "15 10"], ["medium", "3px", "9 6"], [undefined, "1.5px", "6 4"]]) {
    const w = weight ? { weight } : {};
    monter(DOC({ links: [lien({ ...w, line: "dashed" })], arrows: [fleche({ ...w, line: "dashed" })] }));
    for (const id of ["l1", "a1"]) {
      expect(obj(id).classList.contains(`epaisseur-${weight ?? "thin"}`)).toBe(true);
      expect(trait(id).getAttribute("stroke-dasharray")).toBe(tirets);
    }
    expect(largeur(`.ya-tableau :is(.lien, .fleche).epaisseur-${weight ?? "thin"}`) ?? "--e: 1.5px").toContain(`--e: ${e}`);
    t.detruire();
  }
  expect(largeur(".ya-tableau :is(.lien, .fleche) .trait")).toContain("stroke-width: var(--e)");
});

test("REQ140_AC4_lien_choisi_en_accent_a_5_px_pointes_grandes_et_prise_large", () => {
  monter(DOC({ links: [lien({ color: "red", weight: "thick", ends: "both" })] }));
  clic(obj("l1").querySelector(".prise"));
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  expect(largeur(".ya-tableau :is(.lien, .fleche).choisie .trait")).toContain("stroke: var(--accent-fg); stroke-width: max(2px, var(--e))");
  expect(largeur(".ya-tableau :is(.lien, .fleche).choisie .pointe")).toContain("fill: var(--accent-fg)");
  expect(pointes("l1")).toHaveLength(2);
  const [tip] = obj("l1").querySelector(".pointe").getAttribute("points").split(" ");
  expect(tip).toBe("260,140");
  expect(largeur(".ya-tableau :is(.lien, .fleche) .prise")).toContain("stroke-width: max(12px, calc(var(--e) + 10px))");
});

test("REQ138_AC4_forme_texte_choisie_garde_son_contour_de_2_px_malgre_weight_thick", () => {
  monter(DOC({ boxes: [boite("b1", 0, 0, { shape: "text", weight: "thick", line: "dashed" })] }));
  clic(forme("b1"));
  expect(obj("b1").classList.contains("choisie")).toBe(true);
  expect([...obj("b1").classList].some((c) => c.startsWith("epaisseur-") || c.startsWith("ligne-"))).toBe(false);
  expect(forme("b1").hasAttribute("stroke-dasharray")).toBe(false);
  expect(largeur(".ya-tableau :where(.boite)")).toContain("--e: 1px");
});


test("REQ142_AC6_poigneesLien_au_bord_de_depart_et_au_bout_de_la_pointe", () => {
  const doc = {
    boxes: [
      { id: "b1", x: 100, y: 100, width: 160, height: 80 },
      { id: "b2", x: 400, y: 100, width: 160, height: 80 },
    ],
    links: [{ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left" }],
  };
  const g = poigneesLien(doc, doc.links[0], 1);
  expect(g.getAttribute("aria-hidden")).toBe("true");
  const ronds = [...g.querySelectorAll(".bout")].map((c) => [c.getAttribute("cx"), c.getAttribute("cy"), c.getAttribute("r")]);
  expect(ronds).toEqual([["260", "140", "4.5"], ["400", "140", "4.5"]]);
  expect([...g.querySelectorAll(".prise")].map((r) => r.getAttribute("data-poignee"))).toEqual(["depart", "arrivee"]);
});

const etiquette = (id) => obj(id).querySelector(".ya-tableau-lien-texte");

test("REQ147_AC1_AC2_AC9_etiquette_au_milieu_dans_le_groupe_du_lien_et_prise", () => {
  monter(DOC({ links: [lien({ text: "par mail\nou tél" })] }));
  const e = etiquette("l1");
  expect(e).not.toBeNull();
  expect(e.closest("g.lien")).toBe(obj("l1"));
  expect(e.textContent).toBe("par mail\nou tél");
  // Après le trait et les pointes ; cadre centré sur le milieu (330, 140).
  const fo = obj("l1").querySelector("foreignObject");
  expect(obj("l1").lastElementChild).toBe(fo);
  expect(Number(fo.getAttribute("x")) + Number(fo.getAttribute("width")) / 2).toBeCloseTo(330, 0);
  expect(Number(fo.getAttribute("y")) + Number(fo.getAttribute("height")) / 2).toBeCloseTo(140, 0);
  // Clic sur l'étiquette : le lien est choisi.
  clic(e);
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  // Classes et marges (le centrage réel est prouvé en navigateur).
  expect(regle(".ya-tableau-lien-texte")[0]).toMatch(/padding: 2px 4px/);
  expect(regle(".ya-tableau-lien-texte")[0]).toMatch(/border-radius: var\(--radius-xs\)/);
  expect(regle(".ya-tableau-lien-texte")[0]).toMatch(/white-space: pre/);
  expect(regle(".ya-tableau-lien-texte")[0]).toMatch(/pointer-events: auto/);
  expect(regle(".ya-tableau .lien .ya-tableau-lien-cadre")[0]).toMatch(/pointer-events: none/);
  expect(regle(".ya-tableau .lien foreignObject")[0]).toMatch(/pointer-events: none/);
});

test("REQ147_AC1_sans_texte_rien_n_est_dessine", () => {
  monter(DOC({ links: [lien()] }));
  expect(obj("l1").querySelector("foreignObject")).toBeNull();
});

test("REQ147_AC1_etiquette_suit_le_deplacement_d_une_boite", () => {
  monter(DOC({ boxes: [boite("b1", 100, 100), boite("b2", 400, 300)], links: [lien({ text: "x" })] }));
  const fo = obj("l1").querySelector("foreignObject");
  expect(Number(fo.getAttribute("y")) + Number(fo.getAttribute("height")) / 2).toBeCloseTo(240, 0);
});

test("REQ147_AC7_nom_du_lien_avec_et_sans_texte", () => {
  monter(DOC({ links: [lien({ text: "par mail\nou tél" })] }));
  expect(obj("l1").getAttribute("aria-label")).toBe("De b1 vers b2 : par mail ou tél");
  t.detruire();
  document.body.innerHTML = "";
  monter(DOC({ links: [lien()] }));
  expect(obj("l1").getAttribute("aria-label")).toBe("De b1 vers b2");
});

test("REQ147_AC8_fond_texte_et_lien_choisi", () => {
  monter(DOC({ links: [lien({ text: "x" })] }));
  expect(regle(".ya-tableau-lien-texte")[0]).toMatch(/background: var\(--bg-200\)/);
  expect(regle(".ya-tableau-lien-texte")[0]).toMatch(/color: var\(--ink\)/);
  clic(etiquette("l1"));
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  expect(regle(".ya-tableau :is(.lien, .fleche).choisie .trait")[0]).toMatch(/stroke: var\(--accent-fg\)/);
  expect(regle(".ya-tableau .lien.choisie .ya-tableau-lien-texte").length).toBe(0);
});

test("REQ139_REQ147_taille_du_texte_du_lien_par_classe", () => {
  monter(DOC({ links: [lien({ text: "x", textSize: "xlarge" })] }));
  expect(obj("l1").classList.contains("taille-xlarge")).toBe(true);
  expect(regle(".ya-tableau .lien.taille-xlarge .ya-tableau-lien-texte")[0]).toMatch(/24px\/30px/);
});

test("REQ146_AC2_le_texte_d_une_boite_et_d_un_lien_porte_ses_styles", () => {
  monter(DOC({ boxes: [boite("b1", 100, 100, { text: "Début fin", spans: [{ start: 0, end: 5, bold: true, color: "red" }] }), boite("b2", 400, 100)], links: [lien({ text: "ab", spans: [{ start: 1, end: 2, italic: true }] })] }));
  const s = obj("b1").querySelector(".ya-tableau-texte span");
  expect(s.textContent).toBe("Début");
  expect(s.style.color).toBe("var(--boite-rouge-trait)");
  expect(obj("b1").querySelector(".ya-tableau-texte").textContent).toBe("Début fin");
  expect(etiquette("l1").querySelector("span").style.fontStyle).toBe("italic");
});

test("REQ146_AC6_une_partie_rouge_garde_sa_couleur_dans_une_boite_verte", () => {
  monter(DOC({ boxes: [boite("b1", 100, 100, { color: "green", text: "Début du flux", spans: [{ start: 0, end: 5, color: "red" }] }), boite("b2", 400, 100)] }));
  const texte = obj("b1").querySelector(".ya-tableau-texte > div");
  expect(obj("b1").classList.contains("couleur-green")).toBe(true);
  expect(texte.querySelector("span").style.color).toBe("var(--boite-rouge-trait)");
  expect(texte.lastChild.nodeType).toBe(3);
  expect(texte.lastChild.textContent).toBe(" du flux");
  expect(texte.style.color).toBe("");
});

// Symboles (REQ-149)
const SYM = (id, x, y, extra = {}) => ({ id, x, y, width: 100, height: 100, text: "", shape: "database", ...extra });
const ptr = (cible, type, x, y) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, "pointerId", { value: 1 });
  cible.dispatchEvent(e);
};
function glisser(cible, de, vers) {
  ptr(cible, "pointerdown", de[0], de[1]);
  ptr(surface(), "pointermove", (de[0] + vers[0]) / 2, (de[1] + vers[1]) / 2);
  ptr(surface(), "pointermove", vers[0], vers[1]);
  ptr(surface(), "pointerup", vers[0], vers[1]);
}
const dessinDe = (id) => obj(id).querySelector("svg.symbole-dessin");
const bt = (nom) => [...t.element.querySelectorAll("[role=toolbar] button")].find((b) => b.getAttribute("aria-label") === nom);

test("REQ149_AC3_symbole_trace_au_glisser_puis_poignee_agrandit_et_ne_descend_pas_sous_40_x_24", () => {
  monter(DOC({ boxes: [] }), { x: 0, y: 0, zoom: 1 }, { outil: "person", forme: "person" });
  glisser(surface(), [100, 100], [220, 260]);
  expect(changements.at(-1).boxes.at(-1)).toMatchObject({ x: 100, y: 100, width: 120, height: 160, shape: "person" });
  t.detruire();
  document.body.innerHTML = "";
  monter(DOC({ boxes: [SYM("b1", 100, 100, { shape: "person", width: 120, height: 160 })] }));
  clic(obj("b1").querySelector(".forme"));
  expect(Number(dessinDe("b1").getAttribute("width"))).toBeCloseTo(76.8, 5);
  glisser(t.element.querySelector('[data-poignee="taille"]'), [220, 260], [260, 260]);
  expect(changements.at(-1).boxes[0]).toMatchObject({ width: 160, height: 160 });
  expect(Number(dessinDe("b1").getAttribute("width"))).toBeCloseTo(76.8, 5);
  glisser(t.element.querySelector('[data-poignee="taille"]'), [260, 260], [-500, -500]);
  expect(changements.at(-1).boxes[0]).toMatchObject({ width: 40, height: 24 });
  expect(Number(dessinDe("b1").getAttribute("width"))).toBeCloseTo(11.52, 5);
});

test("REQ149_AC4_couleur_teint_le_dessin_sans_fond_et_par_defaut_retire_la_cle", () => {
  monter(DOC({ boxes: [SYM("b1", 100, 100, { shape: "server" })] }));
  const g = obj("b1");
  expect(g.classList.contains("forme-symbole")).toBe(true);
  expect(g.querySelector(".forme").getAttribute("fill-opacity")).toBeNull();
  expect(dessinDe("b1").getAttribute("data-icone")).toBe("symbole-server");
  expect(regle(".ya-tableau .boite .symbole-dessin")[0]).toMatch(/color: var\(--boite-trait\)/);
  expect(regle(".ya-tableau .boite.forme-symbole .forme")[0]).toMatch(/fill: transparent; stroke: none/);
  expect(css).toMatch(/\.boite\.forme-symbole\.couleur-default \.symbole-dessin \{ color: var\(--ink\)/);
  clic(obj("b1").querySelector(".forme"));
  bt("Vert").click();
  expect(changements.at(-1).boxes[0].color).toBe("green");
  expect(obj("b1").classList.contains("couleur-green")).toBe(true);
  expect(css).toMatch(/\.couleur-green \{ --boite-fond: var\(--boite-vert-fond\); --boite-trait: var\(--boite-vert-trait\)/);
  bt("Par défaut").click();
  expect(ecrireJdiag(changements.at(-1))).not.toContain("color");
});

test("REQ149_AC5_cinq_connecteurs_lien_du_cote_droit_qui_suit_et_pointe_sur_le_bord", () => {
  monter(DOC({ boxes: [SYM("b1", 100, 100, { shape: "cloud" }), boite("b2", 400, 100, { text: "Fin" })] }));
  ptr(surface(), "pointermove", 205, 150);
  const c = [...t.element.querySelectorAll(".connecteurs .connecteur")].map((x) => [x.getAttribute("cx"), x.getAttribute("cy")]);
  expect(c).toEqual([["150", "100"], ["200", "150"], ["150", "200"], ["100", "150"], ["150", "150"]]);
  glisser(t.element.querySelector('[data-boite="b1"][data-connecteur="right"]'), [200, 150], [410, 140]);
  expect(changements.at(-1).links[0]).toMatchObject({ from: "b1", fromSide: "right", to: "b2" });
  glisser(obj("b1").querySelector(".forme"), [150, 130], [150, 230]);
  expect(changements.at(-1).boxes[0].y).toBe(200);
  expect(obj("l1").querySelector(".trait").getAttribute("d")).toMatch(/^M 200 250/);
});

test("REQ149_AC5_lien_sans_cote_vers_un_symbole_touche_le_bord_du_rectangle_a_1_px", () => {
  monter(DOC({ boxes: [SYM("b1", 100, 100, { shape: "cloud" }), boite("b2", 400, 300, { text: "Fin" })], links: [{ id: "l1", from: "b2", to: "b1" }] }));
  const [px, py] = pointes("l1")[0].split(",").map(Number);
  // Le rectangle de la boîte est coupé par la droite des centres en (200, 178,9) ; une ellipse l'aurait été ailleurs.
  expect(Math.abs(px - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(py - 178.9)).toBeLessThanOrEqual(1);
});

test("REQ149_AC6_texte_dans_la_bande_du_bas_gras_annule_copie_et_effacement", () => {
  monter(DOC({ boxes: [SYM("b1", 100, 100, { text: "Clients", color: "red" }), boite("b2", 400, 100, { text: "Fin" })], links: [{ id: "l1", from: "b1", to: "b2" }] }));
  const fo = obj("b1").querySelector("foreignObject");
  expect(["x", "y", "width", "height"].map((a) => fo.getAttribute(a))).toEqual(["108", "160", "84", "40"]);
  expect(regle(".ya-tableau-texte")[0]).toMatch(/overflow: hidden/);
  expect(css).toMatch(/\.boite\.forme-symbole \.ya-tableau-texte \{[^}]*justify-content: flex-start; padding: 0/);
  clic(obj("b1").querySelector(".forme"));
  bt("Gras").click();
  expect(changements.at(-1).boxes[0].spans).toEqual([{ start: 0, end: 7, bold: true }]);
  touche("z", { ctrlKey: true });
  expect(changements.at(-1).boxes[0].spans).toBeUndefined();
  touche("c", { ctrlKey: true });
  touche("v", { ctrlKey: true });
  expect(changements.at(-1).boxes.at(-1)).toMatchObject({ shape: "database", color: "red", text: "Clients" });
  touche("Delete");
  expect(changements.at(-1).boxes.map((b) => b.id)).toEqual(["b1", "b2"]);
  clic(obj("b1").querySelector(".forme"));
  touche("Delete");
  expect(changements.at(-1).boxes.map((b) => b.id)).toEqual(["b2"]);
  expect(changements.at(-1).links).toEqual([]);
});

test("REQ149_AC9_nom_du_symbole_avec_son_texte_et_saisie_dans_la_bande_du_bas", () => {
  monter(DOC({ boxes: [SYM("b1", 100, 100, { text: "Clients" }), SYM("b2", 400, 100)] }));
  expect(obj("b1").getAttribute("aria-roledescription")).toBe("boîte");
  expect(obj("b1").getAttribute("aria-label")).toBe("Base de données : Clients");
  expect(obj("b2").getAttribute("aria-label")).toBe("Base de données");
  expect(dessinDe("b1").getAttribute("aria-hidden")).toBe("true");
  clic(obj("b1").querySelector(".forme"));
  touche("Enter");
  const zone = t.element.querySelector("[role=textbox]");
  expect(zone.getAttribute("aria-label")).toBe("Texte de la boîte");
  const fo = zone.closest("foreignObject");
  expect([fo.getAttribute("y"), fo.getAttribute("height")]).toEqual(["160", "40"]);
  expect(dessinDe("b1")).not.toBeNull();
});
