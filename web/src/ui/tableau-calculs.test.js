import { describe, expect, test } from "vitest";
import { cranVoisin, extremitesFleche, pointSortie, toutAfficher, voirObjet, zoomerAutour } from "./tableau-calculs.js";

const boite = (x, y, width = 160, height = 80) => ({ x, y, width, height });

describe("tableau-calculs", () => {
  test("REQ130_AC1 : la flèche va d'un bord à l'autre sur la droite des centres", () => {
    const { depart, arrivee } = extremitesFleche(boite(40, 80), boite(300, 80));
    expect(depart).toEqual({ x: 200, y: 120 });
    expect(arrivee).toEqual({ x: 300, y: 120 });
    const d = extremitesFleche(boite(0, 0, 100, 100), boite(0, 300, 100, 100));
    expect(d.depart).toEqual({ x: 50, y: 100 });
    expect(d.arrivee).toEqual({ x: 50, y: 300 });
    expect(pointSortie(boite(0, 0, 100, 100), 200, 200)).toEqual({ x: 100, y: 100 });
  });

  test("REQ130_AC7 : deux flèches de sens contraires sont décalées de 4 px sur leur droite", () => {
    const a = boite(40, 80);
    const b = boite(300, 80);
    const aller = extremitesFleche(a, b, 4);
    const retour = extremitesFleche(b, a, 4);
    expect(aller.depart.y).toBe(124);
    expect(aller.arrivee.y).toBe(124);
    expect(retour.depart.y).toBe(116);
    expect(retour.arrivee.y).toBe(116);
    expect(aller.depart.x).toBe(200);
  });

  test("REQ131_AC3 : crans de zoom", () => {
    expect(cranVoisin(1, 1)).toBe(1.25);
    expect(cranVoisin(1.25, -1)).toBe(1);
    expect(cranVoisin(1.13, 1)).toBe(1.25);
    expect(cranVoisin(1.13, -1)).toBe(1);
    expect(cranVoisin(4, 1)).toBe(4);
    expect(cranVoisin(0.25, -1)).toBe(0.25);
    let z = 1;
    const monte = [];
    for (let i = 0; i < 5; i++) monte.push((z = cranVoisin(z, 1)));
    expect(monte).toEqual([1.25, 1.5, 2, 3, 4]);
    z = 1;
    const descend = [];
    for (let i = 0; i < 3; i++) descend.push((z = cranVoisin(z, -1)));
    expect(descend).toEqual([0.75, 0.5, 0.25]);
  });

  test("REQ131_AC2 : le point sous le pointeur ne bouge pas, zoom borné", () => {
    const vue = { x: 100, y: 50, zoom: 1 };
    const v = zoomerAutour(vue, 1.1, 300, 200);
    expect(v.zoom).toBe(1.1);
    expect(400 - (v.x + 300 / v.zoom)).toBeCloseTo(0, 6);
    expect(250 - (v.y + 200 / v.zoom)).toBeCloseTo(0, 6);
    expect(zoomerAutour(vue, 9, 0, 0).zoom).toBe(4);
    expect(zoomerAutour(vue, 0.01, 0, 0).zoom).toBe(0.25);
  });

  test("REQ131_AC4 : tout afficher", () => {
    const taille = { largeur: 1200, hauteur: 900 };
    expect(toutAfficher([], taille)).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(toutAfficher([boite(0, 0), boite(200, 0)], taille).zoom).toBe(1);
    const loin = toutAfficher([boite(0, 0), boite(3000, 2000)], taille);
    expect(loin.zoom).toBeCloseTo(Math.min((1200 - 64) / 3160, (900 - 64) / 2080), 9);
    const gauche = (0 - loin.x) * loin.zoom;
    const droite = 1200 - (3160 - loin.x) * loin.zoom;
    const haut = (0 - loin.y) * loin.zoom;
    const bas = 900 - (2080 - loin.y) * loin.zoom;
    expect(Math.min(gauche, droite, haut, bas)).toBeGreaterThanOrEqual(31.999);
    expect(Math.abs(gauche - droite)).toBeLessThan(1e-6);
    expect(Math.abs(haut - bas)).toBeLessThan(1e-6);
    expect(toutAfficher([boite(0, 0), boite(100000, 0)], taille).zoom).toBe(0.25);
  });

  test("REQ131 : un objet hors de la vue y revient à 24 px du bord", () => {
    const taille = { largeur: 800, hauteur: 600 };
    const vue = { x: 0, y: 0, zoom: 1 };
    expect(voirObjet(vue, taille, boite(100, 100))).toEqual(vue);
    expect(voirObjet(vue, taille, boite(1000, 100))).toEqual({ x: 1000 + 160 - 800 + 24, y: 0, zoom: 1 });
    expect(voirObjet(vue, taille, boite(-500, 700)).x).toBe(-524);
    expect(voirObjet(vue, taille, boite(-500, 700)).y).toBe(700 + 80 - 600 + 24);
    expect(voirObjet({ x: 0, y: 0, zoom: 2 }, taille, boite(500, 0)).x).toBe(660 - 400 + 12);
  });
});
