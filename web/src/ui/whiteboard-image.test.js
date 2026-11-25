import { expect, test } from "vitest";
import { dessinerWhiteboard } from "./whiteboard-image.js";
import { ecrireJdiag } from "../jdiag.js";

const boite = (id, x, y, text, extra = {}) => ({ id, x, y, width: 100, height: 60, shape: "rectangle", color: "default", text, ...extra });
const PLAN = ecrireJdiag({
  version: 1,
  boxes: [boite("b1", 40, 20, "Début"), boite("b2", 240, 120, "Fin")],
  links: [{ id: "l1", from: "b1", to: "b2", text: "suite" }],
  arrows: [],
});

test("REQ179_AC1_largeur_des_objets_plus_32_et_texte_des_boites", () => {
  const d = dessinerWhiteboard(PLAN);
  expect(d.largeur).toBe(300 + 32);
  expect(d.hauteur).toBe(160 + 32);
  const racine = new DOMParser().parseFromString(d.svg, "image/svg+xml").documentElement;
  expect(racine.getAttribute("width")).toBe("332");
  expect(racine.getAttribute("height")).toBe("192");
  expect(racine.getAttribute("viewBox")).toBe("24 4 332 192");
  expect(racine.textContent).toContain("Début");
  expect(racine.textContent).toContain("Fin");
  expect(racine.textContent).toContain("suite");
  expect(racine.querySelectorAll("g[data-id]").length).toBe(3);
});

test("REQ179_AC1_le_dessin_ne_laisse_rien_dans_la_page", () => {
  dessinerWhiteboard(PLAN);
  expect(document.body.children.length).toBe(0);
});

test("REQ179_AC3_sans_objet_ou_illisible_donne_null", () => {
  expect(dessinerWhiteboard(ecrireJdiag({ version: 1, boxes: [], links: [], arrows: [] }))).toBe(null);
  expect(dessinerWhiteboard("")).toBe(null);
  expect(dessinerWhiteboard("pas du json {")).toBe(null);
  expect(dessinerWhiteboard('{"version":2,"boxes":[],"links":[]}')).toBe(null);
});

test("REQ179_AC1_fleche_libre_cadree_sans_poignee_ni_connecteur", () => {
  const d = dessinerWhiteboard(ecrireJdiag({ version: 1, boxes: [], links: [], arrows: [{ id: "f1", x1: 10, y1: 10, x2: 210, y2: 110 }] }));
  expect(d.largeur).toBe(232);
  expect(d.hauteur).toBe(132);
  expect(d.svg).not.toContain("connecteur");
  expect(d.svg).not.toContain("poignee");
});

test("REQ179_AC6_texte_html_et_script_restent_du_texte", () => {
  const piege = '<script>alert(1)</script><img src="https://exemple.org/x.png">';
  const d = dessinerWhiteboard(ecrireJdiag({ version: 1, boxes: [boite("b1", 0, 0, piege)], links: [], arrows: [] }));
  const racine = new DOMParser().parseFromString(d.svg, "image/svg+xml").documentElement;
  expect(racine.textContent).toContain(piege);
  expect(racine.querySelector("script")).toBeNull();
  expect(racine.querySelector("img")).toBeNull();
  expect(d.svg).not.toContain("<script");
  expect(d.svg).not.toContain("<img");
});

const deuxBoitesHautes = (route) => ecrireJdiag({
  version: 1,
  boxes: [boite("b1", 0, 200, "A"), boite("b2", 300, 200, "B")],
  links: [{ id: "l1", from: "b1", to: "b2", route, fromSide: "top", toSide: "top" }],
  arrows: [],
});
const viewBoxDe = (d) => new DOMParser().parseFromString(d.svg, "image/svg+xml").documentElement.getAttribute("viewBox").split(" ").map(Number);

test("REQ179_AC1_le_cadre_contient_le_haut_d_un_lien_orthogonal_entre_deux_cotes_hauts", () => {
  const d = dessinerWhiteboard(deuxBoitesHautes("orthogonal"));
  const [, y, , h] = viewBoxDe(d);
  expect(y).toBeLessThan(200 - 16); // le tracé dépasse le haut des boîtes
  expect(y + h).toBe(260 + 16);
  expect(d.hauteur).toBeGreaterThan(60 + 32);
});

test("REQ179_AC1_le_cadre_contient_le_haut_d_un_lien_courbe_entre_deux_cotes_hauts", () => {
  const d = dessinerWhiteboard(deuxBoitesHautes("curved"));
  const [, y] = viewBoxDe(d);
  expect(y).toBeLessThan(200 - 16);
  expect(d.hauteur).toBeGreaterThan(60 + 32);
});

test("REQ179_AC1_le_cadre_contient_une_fleche_libre_routee", () => {
  const fleche = (route) => dessinerWhiteboard(ecrireJdiag({ version: 1, boxes: [], links: [], arrows: [{ id: "f1", x1: 0, y1: 0, x2: 10, y2: 300, route }] }));
  const [x0, , w0] = viewBoxDe(fleche("direct"));
  const [x1, , w1] = viewBoxDe(fleche("curved"));
  expect(w0).toBe(10 + 32);
  expect(x1).toBeLessThan(x0); // la courbe sort à gauche des deux bouts
  expect(x1 + w1).toBeGreaterThan(x0 + w0); // et à droite
});
