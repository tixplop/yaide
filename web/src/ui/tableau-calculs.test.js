import { describe, expect, test } from "vitest";
import {
  connecteurProche,
  connecteurs,
  cotesProches,
  cranVoisin,
  dansRectangle,
  extremitesFleche,
  geometrieLien,
  epaisseur,
  pointe,
  tirets,
  pointSortie,
  pointSurBord,
  rectangleFleche,
  toutAfficher,
  trace,
  voirObjet,
  zoneTexte,
  zoomerAutour,
} from "./tableau-calculs.js";

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

  const debut = boite(40, 80);
  const fin = boite(300, 280);
  const doc = (links) => ({ boxes: [{ id: "b1", ...debut }, { id: "b2", ...fin }], links, arrows: [] });
  const bouts = (de, vers, cd, ca) => ({
    depart: { point: connecteurs(de)[cd], cote: cd },
    arrivee: { point: connecteurs(vers)[ca], cote: ca },
  });
  const segmentsOrthogonaux = (d) => {
    const pts = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    return pts.slice(1).map((p, i) => ({ de: pts[i], vers: p }));
  };

  test("REQ130_AC1 : connecteurs au milieu des côtés, lien right vers left", () => {
    const c = connecteurs(boite(40, 80));
    expect(c).toEqual({ top: { x: 120, y: 80 }, right: { x: 200, y: 120 }, bottom: { x: 120, y: 160 }, left: { x: 40, y: 120 } });
    expect(connecteurProche(boite(40, 80), { x: 210, y: 130 })).toBe("right");
    expect(connecteurProche(boite(40, 80), { x: 100, y: 90 })).toBe("top");
    const g = geometrieLien(doc([]), { id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left" }, 1);
    expect(g.debut.point).toEqual({ x: 200, y: 120 });
    expect(g.fin.point).toEqual({ x: 300, y: 320 });
    expect(g.d.startsWith("M 200 120")).toBe(true);
  });

  test("REQ130_AC7 : le décalage de 4 px des deux sens contraires est gardé", () => {
    const b = [{ id: "b1", ...boite(40, 80) }, { id: "b2", ...boite(300, 80) }];
    const links = [{ id: "l1", from: "b1", to: "b2" }, { id: "l2", from: "b2", to: "b1" }];
    const d = { boxes: b, links, arrows: [] };
    expect(geometrieLien(d, links[0], 1).debut.point).toEqual({ x: 200, y: 124 });
    expect(geometrieLien(d, links[1], 1).debut.point).toEqual({ x: 300, y: 116 });
    const seul = { boxes: b, links: [links[0]], arrows: [] };
    expect(geometrieLien(seul, links[0], 1).debut.point).toEqual({ x: 200, y: 120 });
  });

  test("REQ134_AC4 : le bout d'un lien est sur le bord de l'ellipse et du losange", () => {
    const rect = boite(0, 0, 100, 100);
    const cercle = { ...boite(300, 0, 100, 100), shape: "ellipse" };
    const losange = { ...boite(300, 300, 160, 100), shape: "diamond" };
    const p = pointSurBord(cercle, { x: 50, y: 50 });
    expect(p.x).toBeCloseTo(300, 0);
    const c = { x: 350, y: 50 };
    const diag = pointSurBord(cercle, { x: 350 + 100, y: 150 });
    expect(Math.hypot((diag.x - c.x) / 50, (diag.y - c.y) / 50)).toBeCloseTo(1, 6);
    const l = pointSurBord(losange, { x: 0, y: 350 });
    expect(l).toEqual({ x: 300, y: 350 });
    const l2 = pointSurBord(losange, { x: 380 + 80, y: 350 + 50 });
    expect(Math.abs(l2.x - 380) / 80 + Math.abs(l2.y - 350) / 50).toBeCloseTo(1, 6);
    const d = { boxes: [{ id: "r", ...rect }, { id: "c", ...cercle }, { id: "x", ...losange }], links: [], arrows: [] };
    const g = geometrieLien(d, { id: "l", from: "r", to: "c" }, 1);
    expect(g.fin.point.x).toBeCloseTo(300 - 0, 0);
    const g2 = geometrieLien(d, { id: "l", from: "r", to: "x" }, 1);
    const q = g2.fin.point;
    expect(Math.abs(q.x - 380) / 80 + Math.abs(q.y - 350) / 50).toBeCloseTo(1, 6);
    expect(pointSurBord(rect, { x: 200, y: 200 })).toEqual({ x: 100, y: 100 });
    expect(pointSurBord({ ...rect, shape: "note" }, { x: 200, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  test("REQ134_AC7 : zone du texte d'un cercle et d'un losange", () => {
    const z = zoneTexte({ ...boite(0, 0, 100, 100), shape: "ellipse" });
    expect(z.width).toBeCloseTo(70.7, 1);
    expect(z.height).toBeCloseTo(70.7, 1);
    expect(z.x).toBeCloseTo(14.6, 1);
    expect(zoneTexte({ ...boite(0, 0, 160, 100), shape: "diamond" })).toEqual({ x: 40, y: 25, width: 80, height: 50 });
    expect(zoneTexte({ ...boite(10, 20, 160, 80), shape: "rounded" })).toEqual({ x: 10, y: 20, width: 160, height: 80 });
  });

  test("REQ135_AC1 : tracé coudé, segments horizontaux et verticaux, sortie et entrée horizontales", () => {
    const t = trace({ route: "orthogonal", ...bouts(debut, fin, "right", "left") });
    const segs = segmentsOrthogonaux(t.d);
    expect(segs.length).toBe(3);
    for (const s of segs) expect(s.de.x === s.vers.x || s.de.y === s.vers.y).toBe(true);
    expect(segs[0].de).toEqual({ x: 200, y: 120 });
    expect(segs[0].de.y).toBe(segs[0].vers.y);
    expect(segs[2].vers).toEqual({ x: 300, y: 320 });
    expect(segs[2].de.y).toBe(segs[2].vers.y);
    expect(segs[0].vers.x).toBe(250);
    // côtés perpendiculaires : un seul coude
    const p = trace({ route: "orthogonal", ...bouts(debut, fin, "right", "top") });
    expect(segmentsOrthogonaux(p.d).length).toBe(2);
    // côtés trop proches : au moins 16 px à la sortie et à l'entrée
    const proche = trace({ route: "orthogonal", ...bouts(boite(0, 0), boite(180, 100), "right", "left") });
    const s = segmentsOrthogonaux(proche.d);
    expect(s[0].vers.x - s[0].de.x).toBeGreaterThanOrEqual(16);
    const dernier = s[s.length - 1];
    expect(dernier.vers.x - dernier.de.x).toBeGreaterThanOrEqual(16);
  });

  test("REQ135_AC1_AC7 : sortie et entrée de 16 px dans le sens de la normale, y compris en repli", () => {
    const sens = (s, nx, ny) => (s.vers.x - s.de.x) * nx + (s.vers.y - s.de.y) * ny;
    const cas = [
      [{ x: 200, y: 120 }, "right", { x: 150, y: 300 }, "top", [1, 0], [0, 1]],
      [{ x: 200, y: 120 }, "right", { x: 300, y: 60 }, "top", [1, 0], [0, 1]],
      [{ x: 200, y: 120 }, "right", { x: 150, y: 120 }, "left", [1, 0], [1, 0]],
    ];
    for (const [pa, ca, pb, cb, n1, n2] of cas) {
      const t = trace({ route: "orthogonal", depart: { point: pa, cote: ca }, arrivee: { point: pb, cote: cb } });
      const segs = segmentsOrthogonaux(t.d);
      for (const s of segs) expect(s.de.x === s.vers.x || s.de.y === s.vers.y).toBe(true);
      expect(sens(segs[0], n1[0], n1[1])).toBeGreaterThanOrEqual(16);
      // l'arrivée va dans le sens opposé à la normale sortante du côté d'arrivée
      expect(sens(segs[segs.length - 1], n2[0], n2[1])).toBeGreaterThanOrEqual(16);
    }
  });

  test("REQ135_AC2 : tracé courbe, et côtés les plus proches sans côté", () => {
    const t = trace({ route: "curved", ...bouts(debut, fin, "right", "left") });
    expect(t.d).toMatch(/^M 200 120 C .* 300 320$/);
    expect(t.d.split("C").length).toBe(2);
    expect(t.debut.point).toEqual({ x: 200, y: 120 });
    expect(t.fin.point).toEqual({ x: 300, y: 320 });
    const loin = geometrieLien(doc([]), { id: "l", from: "b1", to: "b2", route: "curved" }, 1);
    expect(loin.d).toContain("C");
    const dessous = [{ id: "b1", ...boite(0, 0) }, { id: "b2", ...boite(0, 300) }];
    const d = { boxes: dessous, links: [], arrows: [] };
    expect(cotesProches(dessous[0], dessous[1])).toEqual({ de: "bottom", vers: "top" });
    const g = geometrieLien(d, { id: "l", from: "b1", to: "b2", route: "orthogonal" }, 1);
    expect(g.debut.point).toEqual({ x: 80, y: 80 });
    expect(g.fin.point).toEqual({ x: 80, y: 300 });
    expect(geometrieLien(d, { id: "l", from: "b1", to: "b2", route: "curved" }, 1).d.startsWith("M 80 80 C 80 190")).toBe(true);
  });

  test("REQ130_AC11 : bout au centre, droit : pointe sur le bord, sur la droite du départ au centre", () => {
    const d = doc([]);
    const g = geometrieLien(d, { id: "l", from: "b1", to: "b2", fromSide: "right", toSide: "center" }, 1);
    // départ : milieu du côté droit de « Début » (200, 120) ; arrivée : sur le bord de « Fin », vers son centre (380, 320)
    expect(g.debut.point).toEqual({ x: 200, y: 120 });
    const p = g.fin.point;
    const cx = 380;
    const cy = 320;
    expect((p.x - 200) * (cy - 120) - (p.y - 120) * (cx - 200)).toBeCloseTo(0, 6);
    expect(Math.abs(p.x - 300) < 1e-6 || Math.abs(p.y - 280) < 1e-6 || Math.abs(p.y - 360) < 1e-6).toBe(true);
    const dedans = (q) => q.x > 300 + 1e-6 && q.x < 460 - 1e-6 && q.y > 280 + 1e-6 && q.y < 360 - 1e-6;
    const pts = [...g.entier.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    expect(pts.some(dedans)).toBe(false);
    const depuis = geometrieLien(d, { id: "l", from: "b1", to: "b2", fromSide: "center", toSide: "top" }, 1);
    const h = depuis.debut.point;
    expect(h.y).toBeCloseTo(160, 6);
    expect((h.x - 120) * (280 - 120) - (h.y - 120) * (380 - 120)).toBeCloseTo(0, 6);
    expect(depuis.fin.point).toEqual({ x: 380, y: 280 });
    // « Fin » déplacée en (300, 480), puis en ellipse : la pointe est sur la droite de (200, 120) au centre, sur le bord
    for (const shape of [undefined, "ellipse"]) {
      const f = { id: "b2", x: 300, y: 480, width: 160, height: 80, shape };
      const dd = { boxes: [{ id: "b1", ...debut }, f], links: [], arrows: [] };
      const q = geometrieLien(dd, { id: "l", from: "b1", to: "b2", fromSide: "right", toSide: "center" }, 1).fin.point;
      expect((q.x - 200) * (520 - 120) - (q.y - 120) * (380 - 200)).toBeCloseTo(0, 6);
      const sur = shape ? ((q.x - 380) / 80) ** 2 + ((q.y - 520) / 40) ** 2 : null;
      if (shape) expect(Math.sqrt(sur)).toBeCloseTo(1, 2);
      else expect(Math.abs(q.x - 300) < 1 || Math.abs(q.y - 480) < 1).toBe(true);
    }
    // cercle
    const cercle = { boxes: [{ id: "b1", x: 0, y: 0, width: 100, height: 100, shape: "ellipse" }, { id: "b2", ...fin }], links: [], arrows: [] };
    const gc = geometrieLien(cercle, { id: "l", from: "b1", to: "b2", fromSide: "center", toSide: "left" }, 1);
    expect(Math.hypot(gc.debut.point.x - 50, gc.debut.point.y - 50)).toBeCloseTo(50, 6);
  });

  test("REQ130_AC12 : center/center = lien sans côté ; coudé : côté le plus proche de l'autre bout", () => {
    const d = doc([{ id: "l", from: "b1", to: "b2" }, { id: "m", from: "b2", to: "b1" }]);
    const centre = { id: "l", from: "b1", to: "b2", fromSide: "center", toSide: "center" };
    expect(geometrieLien(d, centre, 1)).toEqual(geometrieLien(d, { id: "l", from: "b1", to: "b2" }, 1));
    expect(geometrieLien(d, { ...centre, route: "orthogonal" }, 1)).toEqual(geometrieLien(d, { id: "l", from: "b1", to: "b2", route: "orthogonal" }, 1));
    expect(geometrieLien(d, { ...centre, route: "curved" }, 1)).toEqual(geometrieLien(d, { id: "l", from: "b1", to: "b2", route: "curved" }, 1));
    const dessousCentre = { boxes: [{ id: "b1", ...boite(0, 0) }, { id: "b2", ...boite(0, 300) }], links: [], arrows: [] };
    const ortho = { id: "l", from: "b1", to: "b2", route: "orthogonal", fromSide: "center", toSide: "center" };
    const coudeD = geometrieLien(doc([]), ortho, 1);
    expect([coudeD.debut.point, coudeD.fin.point]).toEqual([{ x: 200, y: 120 }, { x: 300, y: 320 }]);
    const coudeB = geometrieLien(dessousCentre, ortho, 1);
    expect([coudeB.debut.point, coudeB.fin.point]).toEqual([{ x: 80, y: 80 }, { x: 80, y: 300 }]);
    const sans = doc([]);
    const a = geometrieLien(sans, { id: "l", from: "b1", to: "b2", route: "orthogonal", fromSide: "center", toSide: "left" }, 1);
    const b = geometrieLien(sans, { id: "l", from: "b1", to: "b2", route: "orthogonal", fromSide: "right", toSide: "left" }, 1);
    expect(a).toEqual(b);
    const c = geometrieLien(sans, { id: "l", from: "b1", to: "b2", route: "curved", fromSide: "bottom", toSide: "center" }, 1);
    const e = geometrieLien(sans, { id: "l", from: "b1", to: "b2", route: "curved", fromSide: "bottom", toSide: "left" }, 1);
    expect(c.fin.point).toEqual({ x: 300, y: 320 });
    expect(c.d).toBe(e.d);
    const dessous = { boxes: [{ id: "b1", ...boite(0, 0) }, { id: "b2", ...boite(0, 300) }], links: [], arrows: [] };
    const g = geometrieLien(dessous, { id: "l", from: "b1", to: "b2", route: "orthogonal", fromSide: "center", toSide: "top" }, 1);
    expect(g.debut.point).toEqual({ x: 80, y: 80 });
  });

  test("REQ130_AC16 : lien au centre d'une boîte de 160 × 80, même point à tout zoom", () => {
    const d = { boxes: [{ id: "b1", ...boite(0, 0) }, { id: "b2", ...boite(400, 0) }], links: [], arrows: [] };
    for (const zoom of [0.25, 1, 4]) {
      const g = geometrieLien(d, { id: "l", from: "b1", to: "b2", fromSide: "center", toSide: "left" }, zoom);
      expect(g.debut.point).toEqual({ x: 160, y: 40 });
      expect(g.fin.point).toEqual({ x: 400, y: 40 });
    }
  });

  test("REQ135_AC3 : angle de chaque pointe, bout sur le bord", () => {
    const droit = trace({ route: "direct", depart: { point: { x: 0, y: 0 }, cote: null }, arrivee: { point: { x: 100, y: 0 }, cote: null } });
    expect(droit.fin.angle).toBeCloseTo(0, 9);
    expect(droit.debut.angle).toBeCloseTo(Math.PI, 9);
    const coude = trace({ route: "orthogonal", ...bouts(debut, fin, "right", "top") });
    expect(coude.fin.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(coude.debut.angle).toBeCloseTo(Math.PI, 9);
    const g = geometrieLien(doc([]), { id: "l", from: "b1", to: "b2", fromSide: "bottom", toSide: "left", route: "curved" }, 1);
    expect(g.fin.angle).toBeCloseTo(0, 9);
    expect(g.debut.angle).toBeCloseTo(-Math.PI / 2, 9);
    expect(g.pointeFin[0]).toEqual({ x: 300, y: 320 });
    expect(g.pointeDebut[0]).toEqual({ x: 120, y: 160 });
  });

  test("REQ135_AC7 : 16 px de sortie du dessin à 50 % et 200 %, pointe de 10 × 8 px à l'écran", () => {
    const proche = bouts(boite(0, 0), boite(180, 100), "right", "left");
    const a = segmentsOrthogonaux(trace({ route: "orthogonal", ...proche }).d)[0];
    expect(a.vers.x - a.de.x).toBe(16);
    for (const zoom of [0.5, 2]) {
      const [tip, b1, b2] = pointe({ point: { x: 100, y: 50 }, angle: 0 }, zoom);
      expect(tip).toEqual({ x: 100, y: 50 });
      expect(tip.x - b1.x).toBeCloseTo(10 / zoom, 9);
      expect(Math.hypot(b1.x - b2.x, b1.y - b2.y)).toBeCloseTo(8 / zoom, 9);
      expect(b1.x).toBeCloseTo(b2.x, 9);
    }
    const courbe = trace({ route: "curved", ...bouts(boite(0, 0), boite(100, 0), "right", "left") });
    expect(courbe.d).toContain("C 200 40, 60 40");
  });

  test("REQ136_AC4 : tout afficher montre une flèche libre jusqu'en (3000, 2000)", () => {
    const taille = { largeur: 1200, hauteur: 900 };
    const fleche = { id: "a1", x1: 100, y1: 100, x2: 3000, y2: 2000 };
    expect(rectangleFleche(fleche)).toEqual({ x: 100, y: 100, width: 2900, height: 1900 });
    expect(rectangleFleche({ x1: 300, y1: 180, x2: 100, y2: 100 })).toEqual({ x: 100, y: 100, width: 200, height: 80 });
    const v = toutAfficher([boite(0, 0), rectangleFleche(fleche)], taille);
    const droite = 1200 - (3000 - v.x) * v.zoom;
    const bas = 900 - (2000 - v.y) * v.zoom;
    expect(droite).toBeGreaterThanOrEqual(31.999);
    expect(bas).toBeGreaterThanOrEqual(31.999);
    expect((0 - v.x) * v.zoom).toBeGreaterThanOrEqual(31.999);
  });

  test("REQ136_AC6 : la vue se décale pour montrer une flèche libre à 24 px", () => {
    const taille = { largeur: 800, hauteur: 600 };
    const vue = { x: 0, y: 0, zoom: 1 };
    const f = rectangleFleche({ x1: 700, y1: 100, x2: 810, y2: 100 });
    const v = voirObjet(vue, taille, f);
    expect(v).toEqual({ x: 810 - 800 + 24, y: 0, zoom: 1 });
    expect(800 - (810 - v.x)).toBeGreaterThanOrEqual(24);
  });

  test("REQ140_AC4 : pointe de 18 × 14 px au bord à 1 px près, trait arrêté à sa base", () => {
    for (const zoom of [0.5, 2]) {
      const de = boite(0, 0);
      const vers = boite(400, 0);
      const lien = { from: "a", to: "b", fromSide: "right", toSide: "left", ends: "both", weight: "thick" };
      const g = geometrieLien({ boxes: [{ id: "a", ...de }, { id: "b", ...vers }], links: [lien] }, lien, zoom);
      const fin = g.pointeFin;
      expect(Math.abs(fin[0].x - 400)).toBeLessThanOrEqual(1 / zoom);
      expect(Math.hypot(fin[1].x - fin[2].x, fin[1].y - fin[2].y) * zoom).toBeCloseTo(14, 6);
      expect((fin[0].x - (fin[1].x + fin[2].x) / 2) * zoom).toBeCloseTo(18, 6);
      expect(g.d).toBe(`M ${160 + 18 / zoom} 40 L ${400 - 18 / zoom} 40`);
      expect(g.entier).toBe("M 160 40 L 400 40");
    }
    const p = (weight) => pointe({ point: { x: 0, y: 0 }, angle: 0 }, 1, weight);
    expect([p("thin"), p("medium")].map((t) => [t[0].x - t[1].x, Math.abs(t[1].y - t[2].y)])).toEqual([[10, 8], [14, 11]]);
  });

  test("REQ138_AC1_REQ140_AC2 : tirets et points selon l'épaisseur dessinée", () => {
    expect(tirets("solid", 1)).toBeNull();
    expect([1, 2, 4].map((e) => tirets("dashed", e))).toEqual(["6 4", "6 4", "12 8"]);
    expect([1, 2, 4].map((e) => tirets("dotted", e))).toEqual(["0 4", "0 4", "0 8"]);
    expect([1.5, 3, 5].map((e) => tirets("dashed", e))).toEqual(["6 4", "9 6", "15 10"]);
    expect([1.5, 3, 5].map((e) => tirets("dotted", e))).toEqual(["0 4", "0 6", "0 10"]);
    expect(epaisseur("boite", "thick")).toBe(4);
    expect(epaisseur("trait", undefined)).toBe(1.5);
  });
});

describe("dansRectangle", () => {
  const doc = {
    version: 1,
    boxes: [
      { id: "b1", x: 40, y: 80, width: 160, height: 80, text: "" },
      { id: "b2", x: 300, y: 80, width: 160, height: 80, text: "" },
      { id: "b3", x: 40, y: 400, width: 160, height: 80, text: "" },
    ],
    links: [{ id: "l1", from: "b1", to: "b2" }, { id: "l2", from: "b1", to: "b3" }],
    arrows: [{ id: "a1", x1: 100, y1: 300, x2: 300, y2: 300 }],
  };
  test("REQ137_AC1_boites_entieres_liens_aux_deux_boites_dedans_fleches_aux_deux_bouts", () => {
    expect(dansRectangle(doc, { x: 20, y: 60, width: 460, height: 120 })).toEqual(["b1", "b2", "l1"]);
    expect(dansRectangle(doc, { x: 20, y: 60, width: 300, height: 440 })).toEqual(["b1", "b3", "l2", "a1"]);
  });
  test("REQ137_AC1_boite_a_demi_dedans_flèche_a_un_bout_dehors_et_rectangle_vide", () => {
    expect(dansRectangle(doc, { x: 20, y: 60, width: 100, height: 120 })).toEqual([]);
    expect(dansRectangle(doc, { x: 90, y: 290, width: 100, height: 20 })).toEqual([]);
    expect(dansRectangle({ version: 1, boxes: [], links: [] }, { x: 0, y: 0, width: 9, height: 9 })).toEqual([]);
  });
});
