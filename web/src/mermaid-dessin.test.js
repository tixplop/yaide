import { describe, expect, it } from "vitest";
import { ecrireJdiag, lireJdiag } from "./jdiag.js";
import { versWhiteboard } from "./mermaid-dessin.js";

// Primitives de l'exemple d'AC-154-17 : `viewBox="10 20 400 300"`, donc origine (10, 20).
const ORIGINE = [10, 20];
const IDENT = [1, 0, 0, 1, 0, 0];
const base = { fond: null, opaciteFond: 1, contour: null, tirets: false, epaisseur: 1, debut: false, fin: false };
const rect = (o) => ({ type: "rect", x: 50, y: 30, largeur: 100, hauteur: 40, arrondi: 0, ...base, fond: "#ececff", contour: "#9370db", ...o });
const texte = (o) => ({ type: "texte", x: 0, y: 0, largeur: 56, hauteur: 19, lignes: ["Bonjour"], ...base, ...o });
const chemin = (o) => ({ type: "chemin", d: "M0,0 L100,0 L100,50", matrice: IDENT, ...base, contour: "#333", ...o });
const vers = (prims) => versWhiteboard(prims, ORIGINE);
const doc = (r) => ({ version: 1, boxes: r.boxes, links: [], arrows: r.arrows });

describe("versWhiteboard", () => {
  it("REQ154_AC17 : rectangle arrondi au texte centré, décalé à partir du coin du viewBox", () => {
    const r = vers([rect({ arrondi: 5 }), texte({ x: 72, y: 40.5, largeur: 56, hauteur: 19, lignes: ["A"] })]);
    expect(r.boxes).toEqual([{ id: "b1", x: 80, y: 50, width: 100, height: 40, text: "A", shape: "rounded" }]);
    expect(r.arrows).toEqual([]);
    expect(vers([rect()]).boxes[0].shape).toBeUndefined();
  });

  it("REQ154_AC17 : ellipse, point, losange, polygone", () => {
    const r = vers([
      { type: "ellipse", cx: 100, cy: 100, rx: 6, ry: 6, ...base, fond: "#333" },
      { type: "ellipse", cx: 100, cy: 100, rx: 30, ry: 20, ...base, contour: "#333" },
      { type: "polygone", points: [[50, 0], [100, 25], [50, 50], [0, 25]], ...base, contour: "#333" },
      { type: "polygone", points: [[50, 0], [100, 25], [50, 50], [0, 30]], ...base, contour: "#333" },
      { type: "polygone", points: [[0, 0], [10, 0], [10, 10]], ...base, contour: "#333", epaisseur: 3 },
    ]);
    expect(r.boxes).toEqual([
      { id: "b1", x: 124, y: 114, width: 12, height: 12, text: "", shape: "dot" },
      { id: "b2", x: 100, y: 100, width: 60, height: 40, text: "", shape: "ellipse", opacity: 0 },
      { id: "b3", x: 30, y: 20, width: 100, height: 50, text: "", shape: "diamond", opacity: 0 },
    ]);
    expect(r.arrows).toHaveLength(4 + 3);
    expect(r.arrows[4]).toEqual({ id: "a5", x1: 30, y1: 20, x2: 40, y2: 20, ends: "none", weight: "thick" });
  });

  it("REQ154_AC17 : fond, tirets, couleur vive, opacité", () => {
    const [vide, ec, rouge, defaut, demi, gris] = vers([
      rect({ fond: null, tirets: true }),
      rect({ fond: "rgb(255, 255, 255)", contour: null, x: 0 }),
      rect({ fond: "#e53935" }),
      rect({ fond: "#ececff" }),
      rect({ fond: "#ececff", opaciteFond: 0.5 }),
      rect({ fond: "#888888" }),
    ]).boxes;
    expect(vide).toMatchObject({ opacity: 0, line: "dashed" });
    expect(vide.color).toBeUndefined();
    expect(ec.opacity).toBeUndefined();
    expect(rouge.color).toBe("red");
    expect(defaut.color).toBeUndefined();
    expect(demi.opacity).toBe(50);
    expect(gris.color).toBeUndefined();
    const teintes = {
      "#1e88e5": "blue", "#43a047": "green", "#fdd835": "yellow", "#fb8c00": "orange", "#8e24aa": "purple", "rgba(229, 57, 53, 1)": "red",
    };
    for (const [c, nom] of Object.entries(teintes)) expect(vers([rect({ fond: c })]).boxes[0].color, c).toBe(nom);
    expect(vers([rect({ fond: "#000000" })]).boxes[0].color).toBeUndefined();
    expect(vers([rect({ fond: "#fff" })]).boxes[0].color).toBeUndefined();
    expect(vers([rect({ fond: "rgba(229, 57, 53, 0.3)" })]).boxes[0]).toMatchObject({ color: "red", opacity: 25 });
    expect(vers([rect({ opaciteFond: 0.9 })]).boxes[0].opacity).toBeUndefined();
    expect(vers([rect({ opaciteFond: 0.1 })]).boxes[0].opacity).toBe(0);
  });

  it("REQ154_AC17 : chemin avec pointe, ligne en tirets, courbe, chemin fermé", () => {
    let r = vers([chemin({ fin: true })]);
    expect(r.boxes).toEqual([]);
    expect(r.arrows).toEqual([
      { id: "a1", x1: 30, y1: 20, x2: 130, y2: 20, ends: "none" },
      { id: "a2", x1: 130, y1: 20, x2: 130, y2: 70 },
    ]);
    r = vers([chemin({ debut: true })]);
    expect(r.arrows.map((a) => a.ends)).toEqual(["start", "none"]);
    r = vers([chemin({ d: "M0,0 L10,0", debut: true, fin: true })]);
    expect(r.arrows.map((a) => a.ends)).toEqual(["both"]);
    r = vers([{ type: "ligne", points: [[0, 0], [100, 0]], ...base, contour: "#333", tirets: true, epaisseur: 4 }]);
    expect(r.arrows).toEqual([{ id: "a1", x1: 30, y1: 20, x2: 130, y2: 20, ends: "none", line: "dashed", weight: "thick" }]);
    r = vers([chemin({ d: "M0,0 C0,40 40,40 40,0" })]);
    expect(r.arrows).toHaveLength(4);
    expect(r.arrows[0]).toMatchObject({ x1: 30, y1: 20 });
    expect(r.arrows[3]).toMatchObject({ x2: 70, y2: 20 });
    expect(vers([chemin({ d: "M0,0 L10,0 L10,10 Z" })]).arrows).toHaveLength(3);
    expect(vers([chemin({ d: "m0,0 l10,0 v10 h-10 z" })]).arrows).toHaveLength(4);
    expect(vers([chemin({ d: "M0,0 Q10,10 20,0 T40,0" })]).arrows).toHaveLength(8);
    expect(vers([chemin({ d: "M0,0 C0,10 10,10 10,0 S20,-10 20,0" })]).arrows).toHaveLength(8);
    r = vers([chemin({ d: "M0,0 A10,10 0 0 1 20,0" })]);
    expect(r.arrows).toHaveLength(4);
    expect(r.arrows[3]).toMatchObject({ x2: 50, y2: 20 });
    expect(Math.min(...r.arrows.map((a) => Math.min(a.y1, a.y2)))).toBe(10); // balayage 1 : par le haut
    expect(vers([chemin({ d: "M0 0a5 5 0 1010 0" })]).arrows).toHaveLength(4);
    // matrice appliquée, sans arrondi cumulé
    r = vers([chemin({ d: "M0,0 L10,0", matrice: [2, 0, 0, 2, 5, 5] })]);
    expect(r.arrows[0]).toMatchObject({ x1: 35, y1: 25, x2: 55, y2: 25 });
    // segment nul : rien ; chemin sans contour ni fond : rien
    expect(vers([chemin({ d: "M0,0 L0,0" })])).toEqual({ refus: "il n'a rien à dessiner." });
    expect(vers([chemin({ contour: null })])).toEqual({ refus: "il n'a rien à dessiner." });
  });

  it("REQ154_AC17 : texte hors boîte, ce qui ne se voit pas, refus", () => {
    const r = vers([texte({ x: 100, y: 100 })]);
    expect(r.boxes).toEqual([{ id: "b1", x: 122, y: 115, width: 72, height: 30, text: "Bonjour", shape: "text" }]);
    expect(vers([rect({ fond: null, contour: null })])).toEqual({ refus: "il n'a rien à dessiner." });
    expect(vers([rect({ fond: "#fff", opaciteFond: 0, contour: null })])).toEqual({ refus: "il n'a rien à dessiner." });
    expect(vers([])).toEqual({ refus: "il n'a rien à dessiner." });
    expect(vers([texte({ lignes: ["  ", ""] })])).toEqual({ refus: "il n'a rien à dessiner." });
    expect(vers([rect({ largeur: 0.2, hauteur: 0.3 })]).boxes[0]).toMatchObject({ width: 1, height: 1 });
  });

  it("REQ154_AC17 : id dans l'ordre, document relu à l'identique", () => {
    const r = vers([
      rect({ arrondi: 4, fond: "#e53935", opaciteFond: 0.5 }),
      texte({ x: 72, y: 40.5, lignes: ["A"] }),
      { type: "ellipse", cx: 100, cy: 100, rx: 6, ry: 6, ...base, fond: "#333" },
      chemin({ fin: true, tirets: true, epaisseur: 3 }),
      chemin({ d: "M0,0 L1,1", debut: true }),
      rect({ fond: null, tirets: true, x: 200 }),
      { type: "polygone", points: [[50, 0], [100, 25], [50, 50], [0, 25]], ...base, fond: "#43a047" },
      texte({ x: 300, y: 200, lignes: ["a", "b"] }),
    ]);
    expect(r.boxes.map((b) => b.id)).toEqual(["b1", "b2", "b3", "b4", "b5"]);
    expect(r.arrows.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    const d = doc(r);
    const ecrit = ecrireJdiag(d);
    expect(lireJdiag(ecrit)).toMatchObject(d);
    expect(ecrireJdiag(lireJdiag(ecrit))).toBe(ecrit);
  });

  it("REQ154_AC22 : boîte text de la largeur du texte plus 16 px et 18 px par ligne plus 12 px", () => {
    let b = vers([texte({ x: 100, y: 100, largeur: 56, hauteur: 19 })]).boxes[0];
    expect([b.width, b.height, b.shape]).toEqual([72, 30, "text"]);
    expect(Math.abs(b.x + b.width / 2 - (100 + 28 - 10 + 40))).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y + b.height / 2 - (100 + 9.5 - 20 + 40))).toBeLessThanOrEqual(1);
    b = vers([texte({ x: 100, y: 100, largeur: 80, hauteur: 38, lignes: ["a", "b"] })]).boxes[0];
    expect([b.width, b.height, b.text]).toEqual([96, 48, "a\nb"]);
    expect(Math.abs(b.x + b.width / 2 - (100 + 40 - 10 + 40))).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y + b.height / 2 - (100 + 19 - 20 + 40))).toBeLessThanOrEqual(1);
  });

  it("REQ154_AC15 : un texte aligné à gauche dans un nœud en devient le texte ; pas une bande qui contient d'autres boîtes", () => {
    // rect 100 × 40 en (50, 30) ; texte de 30 px de large, à 8 px du bord gauche, à la hauteur du centre
    let r = vers([rect(), texte({ x: 58, y: 40.5, largeur: 30, lignes: ["Actif"] })]);
    expect(r.boxes.map((b) => [b.shape, b.text])).toEqual([[undefined, "Actif"]]);
    r = vers([rect(), rect({ x: 120, y: 40, largeur: 20, hauteur: 20 }), texte({ x: 58, y: 40.5, largeur: 30, lignes: ["Bande"] })]);
    expect(r.boxes.map((b) => b.text)).toEqual(["", "", "Bande"]);
  });

  it("REQ154_AC22 : un texte au centre d'une boîte sans texte (à 4 px) en devient le texte, sinon boîte text", () => {
    // rect 100 × 40 en (50, 30) : centre (100, 50)
    let r = vers([rect(), texte({ x: 72 + 4, y: 40.5 + 4, lignes: ["Proche"] })]);
    expect(r.boxes.map((b) => [b.shape, b.text])).toEqual([[undefined, "Proche"]]);
    r = vers([texte({ x: 72, y: 40.5, lignes: ["Avant"] }), rect()]);
    expect(r.boxes.map((b) => [b.shape, b.text])).toEqual([[undefined, "Avant"]]);
    r = vers([rect(), texte({ x: 72 + 5, y: 40.5, lignes: ["Loin"] })]);
    expect(r.boxes.map((b) => [b.shape, b.text])).toEqual([[undefined, ""], ["text", "Loin"]]);
    // grand rectangle, texte plus haut : boîte text
    r = vers([rect({ x: 0, y: 0, largeur: 300, hauteur: 200 }), texte({ x: 122, y: 10, lignes: ["Titre"] })]);
    expect(r.boxes.map((b) => b.shape)).toEqual([undefined, "text"]);
    // deux textes au même centre : le second n'a plus de boîte sans texte
    r = vers([rect(), texte({ x: 72, y: 40.5, lignes: ["Un"] }), texte({ x: 72, y: 40.5, lignes: ["Deux"] })]);
    expect(r.boxes.map((b) => [b.shape, b.text])).toEqual([[undefined, "Un"], ["text", "Deux"]]);
    // un point ne prend pas de texte
    r = vers([{ type: "ellipse", cx: 100, cy: 100, rx: 6, ry: 6, ...base, fond: "#333" }, texte({ x: 72, y: 90.5, lignes: ["P"] })]);
    expect(r.boxes.map((b) => b.shape)).toEqual(["dot", "text"]);
    // deux lignes dans la boîte
    r = vers([rect(), texte({ x: 72, y: 31, hauteur: 38, lignes: ["a", "b"] })]);
    expect(r.boxes[0].text).toBe("a\nb");
  });
});
