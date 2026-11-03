import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { infoBulle, placer } from "./info-bulle.js";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

function ancre(nom = "a") {
  const b = document.createElement("button");
  b.textContent = nom;
  document.body.append(b);
  return b;
}
const visible = () => [...document.querySelectorAll('[role="tooltip"]')].filter((e) => e.dataset.ouverte === "true");

test("REQ031_AC8_role_tooltip_popover_manual_et_texte", () => {
  const a = ancre();
  const b = infoBulle({ texte: "Fichiers (F)", ancre: a });
  expect(b.getAttribute("role")).toBe("tooltip");
  expect(b.getAttribute("popover")).toBe("manual");
  expect(b.textContent).toBe("Fichiers (F)");
  expect(a.hasAttribute("title")).toBe(false);
  expect(a.hasAttribute("aria-describedby")).toBe(false);
});

test("REQ031_AC8_survol_affiche_apres_400_ms_pas_avant", () => {
  const a = ancre();
  infoBulle({ texte: "Renommer", ancre: a });
  a.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(399);
  expect(visible()).toHaveLength(0);
  vi.advanceTimersByTime(1);
  expect(visible()).toHaveLength(1);
});

test("REQ031_AC8_sortie_avant_400_ms_n_affiche_rien_et_apres_ferme", () => {
  const a = ancre();
  infoBulle({ texte: "Renommer", ancre: a });
  a.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(200);
  a.dispatchEvent(new Event("pointerleave"));
  vi.advanceTimersByTime(1000);
  expect(visible()).toHaveLength(0);
  a.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(visible()).toHaveLength(1);
  a.dispatchEvent(new Event("pointerleave"));
  expect(visible()).toHaveLength(0);
});

test("REQ031_AC8_focus_affiche_tout_de_suite_et_la_perte_ferme", () => {
  const a = ancre();
  infoBulle({ texte: "Git (G)", ancre: a });
  a.focus();
  expect(visible()).toHaveLength(1);
  a.blur();
  expect(visible()).toHaveLength(0);
});

test("REQ031_AC8_clic_sur_l_ancre_ferme", () => {
  const a = ancre();
  infoBulle({ texte: "Git (G)", ancre: a });
  a.focus();
  a.dispatchEvent(new Event("click"));
  expect(visible()).toHaveLength(0);
});

test("REQ031_AC8_une_seule_info_bulle_a_la_fois", () => {
  const a = ancre("a");
  const c = ancre("c");
  infoBulle({ texte: "A", ancre: a });
  infoBulle({ texte: "C", ancre: c });
  a.focus();
  c.focus();
  const v = visible();
  expect(v).toHaveLength(1);
  expect(v[0].textContent).toBe("C");
});

test("REQ031_AC8_echap_ferme_sans_preventDefault_ni_stopPropagation", () => {
  const a = ancre();
  infoBulle({ texte: "Git (G)", ancre: a });
  a.focus();
  const recu = [];
  document.body.addEventListener("keydown", (e) => recu.push(e));
  const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  a.dispatchEvent(e);
  expect(visible()).toHaveLength(0);
  expect(e.defaultPrevented).toBe(false);
  expect(recu).toHaveLength(1);
});

test("REQ031_AC8_echap_sans_info_bulle_ouverte_ne_fait_rien", () => {
  const a = ancre();
  infoBulle({ texte: "Git (G)", ancre: a });
  const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  a.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
});

test("REQ031_AC9_bouton_desactive_ecoute_sur_l_enveloppe", () => {
  const env = document.createElement("span");
  const a = document.createElement("button");
  a.disabled = true;
  env.append(a);
  document.body.append(env);
  infoBulle({ texte: "Renommer ou déplacer (F2)", ancre: a, enveloppe: env });
  env.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(visible()).toHaveLength(1);
  expect(visible()[0].textContent).toBe("Renommer ou déplacer (F2)");
  env.dispatchEvent(new Event("pointerleave"));
  expect(visible()).toHaveLength(0);
});

test("REQ031_AC8_la_bulle_reste_quand_le_pointeur_passe_de_l_ancre_a_elle", () => {
  const a = ancre();
  const b = infoBulle({ texte: "Git (G)", ancre: a });
  a.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  const sortie = new Event("pointerleave");
  Object.defineProperty(sortie, "relatedTarget", { value: b });
  a.dispatchEvent(sortie);
  expect(visible()).toHaveLength(1);
  b.dispatchEvent(new Event("pointerleave"));
  expect(visible()).toHaveLength(0);
});

test("REQ031_AC8_texte_et_ancre_requis_position_connue", () => {
  expect(() => infoBulle({ ancre: ancre() })).toThrow(/texte/);
  expect(() => infoBulle({ texte: "x" })).toThrow(/ancre/);
  expect(() => infoBulle({ texte: "x", ancre: ancre(), position: "ailleurs" })).toThrow(/position/);
});

const fen = { largeur: 800, hauteur: 480 };
const bulle = { largeur: 100, hauteur: 20 };

test("REQ031_AC8_placer_dessous_dessus_droite", () => {
  const r = { left: 100, top: 100, right: 124, bottom: 124, width: 24, height: 24 };
  expect(placer(r, bulle, "dessous", fen)).toEqual({ left: 62, top: 124 });
  expect(placer(r, bulle, "dessus", fen)).toEqual({ left: 62, top: 80 });
  expect(placer(r, bulle, "droite", fen)).toEqual({ left: 124, top: 102 });
});

test("REQ031_AC8_placer_se_retourne_et_reste_entiere_dans_la_fenetre", () => {
  const bas = { left: 100, top: 450, right: 124, bottom: 474, width: 24, height: 24 };
  expect(placer(bas, bulle, "dessous", fen).top).toBe(430);
  const gauche = { left: 0, top: 100, right: 24, bottom: 124, width: 24, height: 24 };
  expect(placer(gauche, bulle, "dessous", fen).left).toBe(0);
  const droite = { left: 790, top: 100, right: 800, bottom: 124, width: 10, height: 24 };
  expect(placer(droite, bulle, "dessous", fen).left).toBe(700);
  const rail = { left: 780, top: 100, right: 800, bottom: 124, width: 20, height: 24 };
  expect(placer(rail, bulle, "droite", fen).left).toBe(680);
});

test("REQ031_AC8_sortie_du_pointeur_garde_la_bulle_si_le_focus_clavier_reste_sur_l_ancre", () => {
  const a = ancre();
  infoBulle({ texte: "Git (G)", ancre: a });
  a.focus();
  a.dispatchEvent(new Event("pointerenter"));
  a.dispatchEvent(new Event("pointerleave"));
  expect(visible()).toHaveLength(1);
  a.blur();
  expect(visible()).toHaveLength(0);
});

test("REQ031_AC8_echap_ferme_meme_si_un_ecouteur_arrete_la_propagation", () => {
  const a = ancre();
  infoBulle({ texte: "Git (G)", ancre: a });
  a.focus();
  let recue = false;
  a.addEventListener("keydown", (e) => {
    recue = true;
    e.stopPropagation();
  });
  const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  a.dispatchEvent(e);
  expect(recue).toBe(true);
  expect(visible()).toHaveLength(0);
  expect(e.defaultPrevented).toBe(false);
});

test("REQ031_AC8_ecouteurs_du_document_poses_une_seule_fois_pour_toutes_les_bulles", async () => {
  vi.resetModules();
  const ajout = vi.spyOn(document, "addEventListener");
  const { infoBulle: neuve } = await import("./info-bulle.js");
  for (let i = 0; i < 50; i++) neuve({ texte: "x", ancre: ancre() });
  const types = ajout.mock.calls.map((c) => c[0]);
  ajout.mockRestore();
  expect(types.filter((t) => t === "keydown")).toHaveLength(1);
  expect(types.filter((t) => t === "pointermove")).toHaveLength(1);
});

test("REQ031_AC8_ancre_retiree_du_dom_pas_d_affichage_et_fermeture_au_mouvement", () => {
  const a = ancre("a");
  const c = ancre("c");
  infoBulle({ texte: "A", ancre: a });
  infoBulle({ texte: "C", ancre: c });
  a.dispatchEvent(new Event("pointerenter"));
  a.remove();
  vi.advanceTimersByTime(400);
  expect(visible()).toHaveLength(0);
  c.focus();
  expect(visible()).toHaveLength(1);
  c.remove();
  expect(visible()).toHaveLength(1);
  document.dispatchEvent(new Event("pointermove"));
  expect(visible()).toHaveLength(0);
});

test("REQ036_AC1_aspect_ya_tooltip", () => {
  const b = infoBulle({ texte: "Fichiers (F)", ancre: ancre() });
  expect(b.classList.contains("ya-tooltip")).toBe(true);
  expect(b.classList.contains("info-bulle")).toBe(true);
  const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
  const r = css.match(/\.ya-tooltip\s*\{([^}]*)\}/)[1].replace(/\s+/g, " ");
  for (const d of ["background: var(--bg-300)", "color: var(--ink)", "box-shadow: var(--shadow-popover)", "border-radius: var(--radius-md)", "font-size: 12.5px", "line-height: 18px", "padding: 3px 8px", "white-space: nowrap"]) expect(r, d).toContain(d);
});
