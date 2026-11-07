import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { borner, limites, poignee } from "./poignee.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());
const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");

function monter(options = {}) {
  const surChangement = vi.fn();
  const surFin = vi.fn();
  const p = poignee({ orientation: "vertical", nomAccessible: "Largeur du panneau", valeur: 240, min: 160, max: 436, surChangement, surFin, ...options });
  p.setPointerCapture = vi.fn();
  document.body.append(p);
  return { p, surChangement, surFin };
}
const pointeur = (type, x, y, init = {}) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init }), { pointerId: 1 });
const touche = (p, key, init = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  p.dispatchEvent(e);
  return e;
};

test("REQ032_AC9_limites_a_800_par_480_sans_bandeau", () => {
  const l = limites({ L: 800, H: 480, bandeaux: 0 });
  expect({ panneau: l.panneau, shells: l.shells }).toEqual({ panneau: { min: 240, max: 360 }, shells: { min: 120, max: 299 } });
});

test("REQ032_AC9_limites_grande_fenetre_et_bandeaux", () => {
  const l = limites({ L: 1600, H: 1000, bandeaux: 40 });
  expect(l.panneau).toEqual({ min: 240, max: 360 });
  expect(l.shells).toEqual({ min: 120, max: 1000 - 35 - 22 - 4 - 40 - 120 });
});

test("REQ032_AC6_limites_figees_sous_800_par_480", () => {
  expect(limites({ L: 500, H: 300, bandeaux: 0 })).toEqual(limites({ L: 800, H: 480, bandeaux: 0 }));
});

test("REQ032_AC4_bandeaux_trop_hauts_la_borne_basse_l_emporte", () => {
  expect(limites({ L: 800, H: 480, bandeaux: 400 }).shells).toEqual({ min: 120, max: 120 });
});

test("REQ032_AC4_borner_ramene_dans_les_limites", () => {
  const l = { min: 160, max: 436 };
  expect([borner(100, l), borner(300, l), borner(900, l)]).toEqual([160, 300, 436]);
});

test("REQ032_AC7_roles_et_valeurs_aria", () => {
  const { p } = monter();
  expect(p.getAttribute("role")).toBe("separator");
  expect(p.getAttribute("aria-orientation")).toBe("vertical");
  expect(p.getAttribute("aria-label")).toBe("Largeur du panneau");
  expect(p.tabIndex).toBe(0);
  expect(["aria-valuenow", "aria-valuemin", "aria-valuemax"].map((a) => p.getAttribute(a))).toEqual(["240", "160", "436"]);
  p.definir({ valeur: 300, max: 400 });
  expect(["aria-valuenow", "aria-valuemax"].map((a) => p.getAttribute(a))).toEqual(["300", "400"]);
});

test("REQ032_AC7_parametres_requis", () => {
  expect(() => poignee({ orientation: "vertical" })).toThrow("nomAccessible requis");
  expect(() => poignee({ nomAccessible: "x" })).toThrow("orientation");
});

test("REQ032_AC10_fleches_horizontales_du_panneau_par_pas_de_16", () => {
  const { p, surChangement, surFin } = monter();
  expect(touche(p, "ArrowRight").defaultPrevented).toBe(true);
  expect(surChangement).toHaveBeenLastCalledWith(256);
  expect(surFin).toHaveBeenLastCalledWith(256);
  p.definir({ valeur: 256 });
  touche(p, "ArrowLeft");
  expect(surChangement).toHaveBeenLastCalledWith(240);
  surChangement.mockClear();
  for (const k of ["ArrowUp", "ArrowDown", "Home", "a"]) expect(touche(p, k).defaultPrevented).toBe(false);
  expect(surChangement).not.toHaveBeenCalled();
});

test("REQ032_AC10_fleches_verticales_des_shells_haut_agrandit", () => {
  const { p, surChangement } = monter({ orientation: "horizontal", nomAccessible: "Hauteur des shells", valeur: 200, min: 120, max: 320 });
  touche(p, "ArrowUp");
  expect(surChangement).toHaveBeenLastCalledWith(216);
  p.definir({ valeur: 216 });
  touche(p, "ArrowDown");
  expect(surChangement).toHaveBeenLastCalledWith(200);
  surChangement.mockClear();
  touche(p, "ArrowLeft");
  touche(p, "ArrowRight");
  expect(surChangement).not.toHaveBeenCalled();
});

test("REQ032_AC10_a_une_limite_rien_ne_bouge", () => {
  const { p, surChangement, surFin } = monter({ valeur: 436 });
  expect(touche(p, "ArrowRight").defaultPrevented).toBe(true);
  expect(surChangement).not.toHaveBeenCalled();
  expect(surFin).not.toHaveBeenCalled();
});

test("REQ032_AC10_le_focus_reste_sur_la_poignee", () => {
  const { p } = monter();
  p.focus();
  touche(p, "ArrowRight");
  expect(document.activeElement).toBe(p);
});

test("REQ032_AC1_glisse_vertical_suit_le_pointeur_et_borne", () => {
  const { p, surChangement, surFin } = monter();
  p.dispatchEvent(pointeur("pointerdown", 100, 50));
  expect(p.setPointerCapture).toHaveBeenCalledWith(1);
  p.dispatchEvent(pointeur("pointermove", 160, 50));
  expect(surChangement).toHaveBeenLastCalledWith(300);
  p.definir({ valeur: 300 });
  p.dispatchEvent(pointeur("pointermove", 1000, 50));
  expect(surChangement).toHaveBeenLastCalledWith(436);
  p.definir({ valeur: 436 });
  p.dispatchEvent(pointeur("pointermove", -500, 50));
  expect(surChangement).toHaveBeenLastCalledWith(160);
  p.definir({ valeur: 160 });
  p.dispatchEvent(pointeur("pointerup", -500, 50));
  expect(surFin).toHaveBeenCalledTimes(1);
  expect(surFin).toHaveBeenCalledWith(160);
});

test("REQ032_AC2_glisse_horizontal_vers_le_haut_agrandit_les_shells", () => {
  const { p, surChangement } = monter({ orientation: "horizontal", nomAccessible: "Hauteur des shells", valeur: 200, min: 120, max: 320 });
  p.dispatchEvent(pointeur("pointerdown", 50, 400));
  p.dispatchEvent(pointeur("pointermove", 50, 370));
  expect(surChangement).toHaveBeenLastCalledWith(230);
  p.dispatchEvent(pointeur("pointermove", 50, 430));
  expect(surChangement).toHaveBeenLastCalledWith(170);
});

test("REQ032_AC1_sans_pointerdown_un_mouvement_ne_fait_rien", () => {
  const { p, surChangement, surFin } = monter();
  p.dispatchEvent(pointeur("pointermove", 500, 50));
  p.dispatchEvent(pointeur("pointerup", 500, 50));
  expect(surChangement).not.toHaveBeenCalled();
  expect(surFin).not.toHaveBeenCalled();
});

test("REQ032_AC11_pointerdown_ne_deplace_pas_le_focus", () => {
  const { p } = monter();
  const autre = document.createElement("input");
  document.body.append(autre);
  autre.focus();
  const e = pointeur("pointerdown", 10, 10);
  p.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(autre);
});

test("REQ032_AC13_pendant_le_glisse_la_page_porte_le_curseur_et_pas_de_selection", () => {
  const { p } = monter();
  const html = document.documentElement;
  p.dispatchEvent(pointeur("pointerdown", 10, 10));
  expect(html.classList.contains("poignee-glisse-vertical")).toBe(true);
  p.dispatchEvent(pointeur("pointerup", 10, 10));
  expect(html.classList.contains("poignee-glisse-vertical")).toBe(false);
  expect(css).toMatch(/html\.poignee-glisse-vertical[^{]*\*\s*\{[^}]*cursor: col-resize !important;[^}]*user-select: none !important/);
  expect(css).toMatch(/html\.poignee-glisse-horizontal[^{]*\*\s*\{[^}]*cursor: row-resize !important;[^}]*user-select: none !important/);
});

test("REQ032_AC13_curseurs_et_place_de_4_px_sans_recouvrement", () => {
  expect(css).toMatch(/\.poignee-vertical\s*\{[^}]*width: var\(--epaisseur-poignee\)[^}]*cursor: col-resize/);
  expect(css).toMatch(/\.poignee-horizontal\s*\{[^}]*height: var\(--epaisseur-poignee\)[^}]*cursor: row-resize/);
});

test("REQ032_AC8_AC13_AC14_repos_survol_glisse_et_focus_visibles", () => {
  const sans = css.replace(/\/\*[^]*?\*\//g, "");
  // Repos : 4 px (token), un filet --line de 1 px au milieu, sur le fond de la zone voisine.
  expect(sans).toMatch(/\.poignee::after\s*\{[^}]*background: var\(--line\)/);
  expect(sans).toMatch(/\.poignee-vertical::after\s*\{[^}]*width: var\(--trait\)/);
  expect(sans).toMatch(/\.poignee-horizontal::after\s*\{[^}]*height: var\(--trait\)/);
  expect(sans).toMatch(/\.poignee-vertical\s*\{[^}]*width: var\(--epaisseur-poignee\)[^}]*cursor: col-resize[^}]*background: var\(--bg-100\)/);
  expect(sans).toMatch(/\.poignee-horizontal\s*\{[^}]*height: var\(--epaisseur-poignee\)[^}]*cursor: row-resize[^}]*background: var\(--bg-000\)/);
  // Survol, glissé, focus : toute l'épaisseur en --accent-fg.
  expect(sans).toMatch(/\.poignee:hover, \.poignee:focus-visible, \.poignee-active\s*\{[^}]*background: var\(--accent-fg\)/);
  expect(sans).toMatch(/\.poignee:hover::after, \.poignee:focus-visible::after, \.poignee-active::after\s*\{[^}]*background: var\(--accent-fg\)/);
  expect(sans).toMatch(/\.poignee:focus-visible\s*\{[^}]*outline: var\(--trait-fort\) solid var\(--accent-fg\)[^}]*outline-offset: calc\(-1 \* var\(--trait\)\)/);
  expect(document.documentElement.style.getPropertyValue("--epaisseur-poignee")).toBe("4px");
});

test("REQ032_AC12_clic_sans_mouvement_pas_de_surFin", () => {
  const { p, surChangement, surFin } = monter();
  p.dispatchEvent(pointeur("pointerdown", 100, 50));
  p.dispatchEvent(pointeur("pointerup", 100, 50));
  expect(surChangement).not.toHaveBeenCalled();
  expect(surFin).not.toHaveBeenCalled();
  expect(document.documentElement.classList.contains("poignee-glisse-vertical")).toBe(false);
});

test("REQ032_AC1_AC10_sans_valeur_la_taille_posee_par_definir_sert_de_depart", () => {
  const { p, surChangement } = monter({ valeur: undefined });
  expect(p.hasAttribute("aria-valuenow")).toBe(false);
  p.definir({ valeur: 250 });
  touche(p, "ArrowRight");
  expect(surChangement).toHaveBeenLastCalledWith(266);
  p.dispatchEvent(pointeur("pointerdown", 100, 50));
  p.dispatchEvent(pointeur("pointermove", 120, 50));
  expect(surChangement).toHaveBeenLastCalledWith(270);
});

test("REQ032_AC1_valeur_inconnue_sans_mesure_le_glisse_et_les_fleches_sont_ignores", () => {
  const { p, surChangement, surFin } = monter({ valeur: undefined });
  touche(p, "ArrowRight");
  p.dispatchEvent(pointeur("pointerdown", 100, 50));
  p.dispatchEvent(pointeur("pointermove", 150, 50));
  p.dispatchEvent(pointeur("pointerup", 150, 50));
  expect(p.setPointerCapture).not.toHaveBeenCalled();
  expect(surChangement).not.toHaveBeenCalled();
  expect(surFin).not.toHaveBeenCalled();
});

const touches = (p, key) => touche(p, key);

test("REQ059_AC11_limites_a_800_agent_replie_panneau_240_360_et_panneau_replie_agent_240_380", () => {
  const a = limites({ L: 800, H: 480, panneau: { replie: false, choisie: 280 }, agent: { replie: true } });
  expect(a.panneau).toEqual({ min: 240, max: 360 });
  expect([a.Pa, a.Aa]).toEqual([280, 0]);
  const b = limites({ L: 800, H: 480, panneau: { replie: true }, agent: { replie: false, choisie: 360 } });
  expect(b.agent).toEqual({ min: 240, max: 380 });
  expect([b.Pa, b.Aa]).toEqual([0, 360]);
});

test("REQ059_AC5_limites_a_1600_panneau_a_280_agent_240_720", () => {
  const l = limites({ L: 1600, H: 1000, panneau: { replie: false, choisie: 280 }, agent: { replie: false, choisie: 500 } });
  expect(l.agent).toEqual({ min: 240, max: 720 });
  expect(l.panneau).toEqual({ min: 240, max: 360 });
  expect([l.Pa, l.Aa]).toEqual([280, 500]);
});

test("REQ059_AC5_l_agent_cede_d_abord_puis_le_panneau", () => {
  // L = 1000 : P = 1000 - 96 - 320 - 8 = 576.
  const l = limites({ L: 1000, H: 800, panneau: { replie: false, choisie: 360 }, agent: { replie: false, choisie: 720 } });
  expect([l.Pa, l.Aa]).toEqual([336, 240]);
  expect(l.panneau.max).toBe(336);
  expect(l.agent.max).toBe(576 - 336);
  const m = limites({ L: 1000, H: 800, panneau: { replie: false, choisie: 260 }, agent: { replie: false, choisie: 720 } });
  expect([m.Pa, m.Aa]).toEqual([260, 316]);
});

test("REQ059_AC6_seuil_de_904_px", () => {
  expect(limites({ L: 1200, H: 600 }).seuil).toBe(904);
});

test("REQ059_AC8_taille_gardee_hors_limites_ramenee_dedans", () => {
  const l = limites({ L: 1600, H: 1000, panneau: { replie: false, choisie: 480 }, agent: { replie: false, choisie: 900 } });
  expect([l.Pa, l.Aa]).toEqual([360, 720]);
  const p = limites({ L: 1600, H: 1000, panneau: { replie: false, choisie: 100 }, agent: { replie: false, choisie: 100 } });
  expect([p.Pa, p.Aa]).toEqual([240, 240]);
});

test("REQ059_AC11_poignee_cote_droite_au_clavier_gauche_agrandit_droite_reduit", () => {
  const { p, surChangement, surFin } = monter({ cote: "droite", nomAccessible: "Largeur de l'agent", valeur: 360, min: 240, max: 720 });
  expect(p.getAttribute("aria-label")).toBe("Largeur de l'agent");
  expect(p.getAttribute("aria-orientation")).toBe("vertical");
  expect(p.getAttribute("role")).toBe("separator");
  expect(["aria-valuenow", "aria-valuemin", "aria-valuemax"].map((a) => p.getAttribute(a))).toEqual(["360", "240", "720"]);
  touches(p, "ArrowLeft");
  expect(surChangement).toHaveBeenLastCalledWith(376);
  expect(surFin).toHaveBeenLastCalledWith(376);
  p.definir({ valeur: 376 });
  touches(p, "ArrowRight");
  expect(surChangement).toHaveBeenLastCalledWith(360);
});

test("REQ059_AC11_poignee_cote_droite_rien_aux_limites", () => {
  const { p, surChangement } = monter({ cote: "droite", valeur: 720, min: 240, max: 720 });
  touches(p, "ArrowLeft");
  p.definir({ valeur: 240 });
  touches(p, "ArrowRight");
  expect(surChangement).not.toHaveBeenCalled();
});

test("REQ059_AC11_poignee_cote_droite_glisse_vers_la_gauche_agrandit", () => {
  const { p, surChangement } = monter({ cote: "droite", valeur: 360, min: 240, max: 720 });
  p.dispatchEvent(pointeur("pointerdown", 500, 10));
  p.dispatchEvent(pointeur("pointermove", 450, 10));
  expect(surChangement).toHaveBeenLastCalledWith(410);
  p.dispatchEvent(pointeur("pointerup", 450, 10));
});

test("REQ059_AC11_poignee_cote_invalide", () => {
  expect(() => poignee({ orientation: "vertical", cote: "haut", nomAccessible: "x" })).toThrow("cote");
});

test("REQ070_limites_sans_agent_sans_seuil", () => {
  const l = limites({ L: 800, H: 480, panneau: { replie: false, choisie: 280 }, agent: null, railDroit: false });
  expect(l.seuil).toBe(0);
  expect(l.Aa).toBe(0);
  expect(l.panneau).toEqual({ min: 240, max: 360 });
  // Hors plafond : sans rail droit, la colonne de l'agent gagne la largeur d'un rail.
  const a = limites({ L: 800, H: 480, agent: { replie: false } }).agent.max;
  const b = limites({ L: 800, H: 480, agent: { replie: false }, railDroit: false }).agent.max;
  expect(b - a).toBe(48);
  expect(limites({ L: 1200, H: 600 }).seuil).toBe(904);
});
