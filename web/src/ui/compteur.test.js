import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { compteur } from "./compteur.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((x) => x.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};

test("REQ036_AC1_compteur_neutre_par_defaut_et_accent", () => {
  const c = compteur({ valeur: 3 });
  expect(c.textContent).toBe("3");
  expect(c.classList.contains("ya-badge")).toBe(true);
  expect(c.classList.contains("ya-badge-accent")).toBe(false);
  expect(c.hidden).toBe(false);
  expect(compteur({ valeur: 12, variante: "accent" }).classList.contains("ya-badge-accent")).toBe(true);
});

test("REQ036_AC1_compteur_a_zero_n_est_pas_affiche", () => {
  const c = compteur({ valeur: 0 });
  expect(c.hidden).toBe(true);
  expect(regle(".ya-badge[hidden]")).toContain("display: none");
});

test("REQ036_AC1_compteur_refuse_une_valeur_ou_une_variante_invalide", () => {
  for (const v of [undefined, "3", -1, 1.5, NaN]) expect(() => compteur({ valeur: v }), String(v)).toThrow(/valeur/);
  expect(() => compteur({ valeur: 1, variante: "rouge" })).toThrow(/variante/);
});

test("REQ036_AC1_compteur_prend_les_couleurs_et_la_forme_du_composant", () => {
  const r = regle(".ya-badge");
  for (const d of ["height: 16px", "border-radius: 8px", "font-size: 10.5px", "font-weight: 600", "background: var(--bg-400)", "color: var(--ink)"]) expect(r, d).toContain(d);
  expect(regle(".ya-badge-accent")).toContain("background: var(--accent)");
  expect(regle(".ya-badge-accent")).toContain("color: var(--on-accent)");
});

test("REQ159_AC3_compteur_texte_valeur_et_position", () => {
  const c = compteur({ valeur: 5, variante: "texte" });
  expect(c.textContent).toBe("5");
  expect(c.classList.contains("ya-occ")).toBe(true);
  expect(c.classList.contains("ya-badge")).toBe(false);
  expect(c.getAttribute("aria-hidden")).toBe("true");
  expect(c.hidden).toBe(false);
  expect(compteur({ valeur: 5, variante: "texte", position: 4 }).textContent).toBe("4 sur 5");
});

test("REQ159_AC3_compteur_texte_a_zero_est_affiche_en_danger", () => {
  const c = compteur({ valeur: 0, variante: "texte" });
  expect(c.textContent).toBe("0");
  expect(c.hidden).toBe(false);
  expect(c.classList.contains("ya-occ-zero")).toBe(true);
  expect(regle(".ya-occ-zero")).toContain("color: var(--danger)");
  expect(compteur({ valeur: 3, variante: "texte" }).classList.contains("ya-occ-zero")).toBe(false);
});

test("REQ159_AC3_position_refusee_hors_de_la_variante_texte", () => {
  expect(() => compteur({ valeur: 5, position: 1 })).toThrow(/position/);
  expect(() => compteur({ valeur: 5, variante: "accent", position: 1 })).toThrow(/position/);
  for (const p of [0, -1, 1.5, "2"]) expect(() => compteur({ valeur: 5, variante: "texte", position: p }), String(p)).toThrow(/position/);
  expect(compteur({ valeur: 2 }).textContent).toBe("2");
  expect(compteur({ valeur: 2, variante: "accent" }).classList.contains("ya-badge-accent")).toBe(true);
});

test("REQ159_AC3_style_du_compteur_texte", () => {
  const r = regle(".ya-occ");
  for (const d of ["font-size: 12px", "line-height: 16px", "font-weight: 400", "color: var(--ink-muted)", "text-align: center", "min-width: 48px", "white-space: nowrap"]) expect(r, d).toContain(d);
  expect(r).not.toContain("background");
  expect(r).not.toContain("border-radius");
});
