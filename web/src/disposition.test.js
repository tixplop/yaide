import { describe, expect, it } from "vitest";
import { cibles, couper, feuilles, retirerGroupe, valider, zoneVisee } from "./disposition.js";

const f = (id, actif = null) => ({ id, actif });
const MIN = { largeur: 320, hauteur: 120 };
const ids = (a) => feuilles(a).map((x) => x.id);

describe("disposition", () => {
  it("feuilles : a puis b", () => {
    const arbre = { sens: "ligne", a: f("g1"), b: { sens: "colonne", a: f("g2"), b: f("g3") } };
    expect(ids(arbre)).toEqual(["g1", "g2", "g3"]);
    expect(ids(f("g1"))).toEqual(["g1"]);
  });

  it("REQ079_AC3_redecoupe_un_seul_groupe", () => {
    const arbre = { sens: "ligne", a: f("g1", "x"), b: f("g2", "y") };
    const copie = JSON.stringify(arbre);
    const r = couper(arbre, "g2", "haut", "g3");
    expect(r).toEqual({ sens: "ligne", a: f("g1", "x"), b: { sens: "colonne", a: f("g3"), b: f("g2", "y") } });
    expect(r.a).toBe(arbre.a);
    expect(JSON.stringify(arbre)).toBe(copie);
    expect(couper(f("g1"), "g1", "gauche", "g2")).toEqual({ sens: "ligne", a: f("g2"), b: f("g1") });
    expect(couper(f("g1"), "g1", "droite", "g2")).toEqual({ sens: "ligne", a: f("g1"), b: f("g2") });
    expect(couper(f("g1"), "g1", "bas", "g2")).toEqual({ sens: "colonne", a: f("g1"), b: f("g2") });
    expect(() => couper(f("g1"), "g1", "centre", "g2")).toThrow();
    expect(() => couper(f("g1"), "absent", "bas", "g2")).toThrow();
  });

  it("REQ079_AC5_le_voisin_prend_la_place", () => {
    const simple = { sens: "ligne", a: f("g1"), b: f("g2") };
    expect(retirerGroupe(simple, "g1")).toEqual(f("g2"));
    expect(retirerGroupe(simple, "g2")).toEqual(f("g1"));
    const imbrique = { sens: "ligne", a: f("g1"), b: { sens: "colonne", a: f("g2"), b: { sens: "ligne", a: f("g3"), b: f("g4") } } };
    expect(retirerGroupe(imbrique, "g2")).toEqual({ sens: "ligne", a: f("g1"), b: { sens: "ligne", a: f("g3"), b: f("g4") } });
    expect(retirerGroupe(imbrique, "g4")).toEqual({ sens: "ligne", a: f("g1"), b: { sens: "colonne", a: f("g2"), b: f("g3") } });
    expect(retirerGroupe(imbrique, "g1")).toEqual(imbrique.b);
    expect(retirerGroupe(f("g1"), "g1")).toEqual(f("g1"));
    expect(retirerGroupe(simple, "absent")).toEqual(simple);
  });

  it("REQ079_AC6_cibles_du_propre_groupe", () => {
    const g = { largeur: 900, hauteur: 444, min: MIN };
    expect(cibles({ ...g, source: false, seulOnglet: false }).sort()).toEqual(["bas", "centre", "droite", "gauche", "haut"]);
    expect(cibles({ ...g, source: true, seulOnglet: false }).sort()).toEqual(["bas", "droite", "gauche", "haut"]);
    expect(cibles({ ...g, source: true, seulOnglet: true })).toEqual([]);
    expect(cibles({ ...g, source: false, seulOnglet: true }).sort()).toEqual(["bas", "centre", "droite", "gauche", "haut"]);
  });

  it("REQ079_AC19_seuils_639_640_et_239_240", () => {
    const base = { source: false, seulOnglet: false, min: MIN };
    const l639 = cibles({ ...base, largeur: 639, hauteur: 500 });
    expect(l639).not.toContain("gauche");
    expect(l639).not.toContain("droite");
    expect(l639).toContain("haut");
    const l640 = cibles({ ...base, largeur: 640, hauteur: 500 });
    expect(l640).toContain("gauche");
    expect(l640).toContain("droite");
    const h239 = cibles({ ...base, largeur: 900, hauteur: 239 });
    expect(h239).not.toContain("haut");
    expect(h239).not.toContain("bas");
    expect(h239).toContain("gauche");
    const h240 = cibles({ ...base, largeur: 900, hauteur: 240 });
    expect(h240).toContain("haut");
    expect(h240).toContain("bas");
    expect(cibles({ ...base, largeur: 100, hauteur: 100 })).toEqual(["centre"]);
  });

  it("REQ079_AC21_zone_visee", () => {
    const tout = ["gauche", "droite", "haut", "bas", "centre"];
    const z = (px, py, cs = tout, surBarre = false) => zoneVisee({ px, py, surBarre, cibles: cs });
    expect(z(0.1, 0.5)).toBe("gauche");
    expect(z(0.9, 0.5)).toBe("droite");
    expect(z(0.5, 0.1)).toBe("haut");
    expect(z(0.5, 0.9)).toBe("bas");
    expect(z(0.5, 0.5)).toBe("centre");
    // coins : le plus proche, en proportion
    expect(z(0.2, 0.1)).toBe("haut");
    expect(z(0.1, 0.2)).toBe("gauche");
    expect(z(0.9, 0.8)).toBe("droite");
    expect(z(0.8, 0.9)).toBe("bas");
    // égalité : gauche ou droite
    expect(z(0.1, 0.1)).toBe("gauche");
    expect(z(0.9, 0.1)).toBe("droite");
    expect(z(0.1, 0.9)).toBe("gauche");
    expect(z(0.9, 0.9)).toBe("droite");
    // côté refusé : seuls les côtés cibles comptent
    const sansGD = ["haut", "bas", "centre"];
    expect(z(0.1, 0.5, sansGD)).toBe("centre");
    expect(z(0.1, 0.2, sansGD)).toBe("haut");
    expect(z(0.1, 0.5, ["gauche", "droite", "haut", "bas"])).toBe("gauche");
    // propre groupe sans centre : refus
    expect(z(0.5, 0.5, ["gauche", "droite"])).toBe(null);
    expect(z(0.1, 0.5, [])).toBe(null);
    // barre
    expect(z(0.1, 0.5, tout, true)).toBe("centre");
    expect(z(0.1, 0.5, ["gauche", "droite"], true)).toBe(null);
  });

  it("REQ079_AC28_quart_224_225_et_egalite", () => {
    const tout = ["gauche", "droite", "haut", "bas", "centre"];
    expect(zoneVisee({ px: 224 / 900, py: 0.5, surBarre: false, cibles: tout })).toBe("gauche");
    expect(zoneVisee({ px: 225 / 900, py: 0.5, surBarre: false, cibles: tout })).toBe("centre");
    expect(zoneVisee({ px: 676 / 900, py: 0.5, surBarre: false, cibles: tout })).toBe("droite");
    expect(zoneVisee({ px: 675 / 900, py: 0.5, surBarre: false, cibles: tout })).toBe("centre");
    expect(zoneVisee({ px: 0.2, py: 0.2, surBarre: false, cibles: tout })).toBe("gauche");
  });

  it("REQ079_valider_rejette_un_arbre_abime", () => {
    expect(valider(f("g1"))).toBe(true);
    expect(valider(f("g1", "fichier:a"))).toBe(true);
    expect(valider({ sens: "colonne", a: f("g1"), b: { sens: "ligne", a: f("g2"), b: f("g3") } })).toBe(true);
    const mauvais = [
      null, undefined, 3, "g1", [], {},
      { id: "g1" },
      { id: 1, actif: null },
      { id: "", actif: null },
      { id: "g1", actif: 4 },
      { id: "g1", actif: null, extra: 1 },
      { sens: "diagonale", a: f("g1"), b: f("g2") },
      { sens: "ligne", a: f("g1") },
      { sens: "ligne", a: f("g1"), b: null },
      { sens: "ligne", a: f("g1"), b: f("g1") },
      { sens: "ligne", a: f("g1"), b: { sens: "colonne", a: f("g2"), b: f("g1") } },
      { sens: "ligne", a: f("g1"), b: f("g2"), c: f("g3") },
    ];
    for (const m of mauvais) expect(valider(m), JSON.stringify(m)).toBe(false);
    let profond = f("x0");
    for (let i = 1; i < 100; i++) profond = { sens: "ligne", a: profond, b: f("x" + i) };
    expect(valider(profond)).toBe(false);
  });
});
