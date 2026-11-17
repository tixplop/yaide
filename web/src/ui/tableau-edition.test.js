import { expect, test } from "vitest";
import { auPlan, coller, copier, rattacher } from "./tableau-edition.js";

const DOC = () => ({
  version: 1,
  boxes: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
  links: [{ id: "l1" }, { id: "l2" }],
  arrows: [{ id: "a1" }, { id: "a2" }],
});
const ids = (l) => l.map((o) => o.id);

test("REQ141_AC1_premier_plan_et_arriere_plan_d_une_boite", () => {
  const d = auPlan(DOC(), ["b1"], "premier");
  expect(ids(d.boxes)).toEqual(["b2", "b3", "b1"]);
  expect(ids(auPlan(d, ["b1"], "arriere").boxes)).toEqual(["b1", "b2", "b3"]);
});

test("REQ141_AC2_ordre_relatif_gardé_et_chaque_liste_a_part", () => {
  const d = auPlan(DOC(), ["b1", "b2"], "premier");
  expect(ids(d.boxes)).toEqual(["b3", "b1", "b2"]);
  expect(ids(auPlan(DOC(), ["b3", "b1"], "arriere").boxes)).toEqual(["b1", "b3", "b2"]);
  const f = auPlan(DOC(), ["a1"], "premier");
  expect(ids(f.arrows)).toEqual(["a2", "a1"]);
  expect(ids(f.boxes)).toEqual(["b1", "b2", "b3"]);
  expect(ids(auPlan(DOC(), ["l2"], "arriere").links)).toEqual(["l2", "l1"]);
});

test("REQ141_AC3_rien_ne_bouge_le_meme_document", () => {
  const d = DOC();
  expect(auPlan(d, ["b3"], "premier")).toBe(d);
  expect(auPlan(d, ["b1", "a1"], "arriere")).toBe(d);
  expect(auPlan(d, [], "premier")).toBe(d);
  const sans = { version: 1, boxes: [{ id: "b1" }, { id: "b2" }], links: [] };
  expect(auPlan(sans, ["b1"], "premier").arrows).toBeUndefined();
});

const CDOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 40, y: 80, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 300, y: 80, width: 160, height: 80, text: "Fin" },
    { id: "b3", x: 40, y: 400, width: 160, height: 80, text: "Bas" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
  arrows: [{ id: "a1", x1: 100, y1: 300, x2: 300, y2: 300 }],
});

test("REQ137_AC4_copier_et_coller_nouveaux_id_positions_et_lien", () => {
  const copie = copier(CDOC(), ["b1", "b2", "l1"]);
  expect(ids(copie.boxes)).toEqual(["b1", "b2"]);
  expect(ids(copie.links)).toEqual(["l1"]);
  const r = coller(CDOC(), copie, 1);
  expect(r.ids).toEqual(["b4", "b5", "l2"]);
  expect(r.doc.boxes.slice(3).map((b) => [b.id, b.x, b.y, b.text])).toEqual([["b4", 60, 100, "Début"], ["b5", 320, 100, "Fin"]]);
  expect(r.doc.links[1]).toMatchObject({ id: "l2", from: "b4", to: "b5" });
  const r2 = coller(r.doc, copie, 2);
  expect(r2.doc.boxes.slice(5).map((b) => [b.x, b.y])).toEqual([[80, 120], [340, 120]]);
});

test("REQ137_AC4_flèche_libre_collée_et_lien_seul_ne_copie_rien", () => {
  expect(copier(CDOC(), ["l1"])).toBeNull();
  expect(copier(CDOC(), ["b1", "l1"]).links).toEqual([]);
  const r = coller(CDOC(), copier(CDOC(), ["a1"]), 1);
  expect(r.ids).toEqual(["a2"]);
  expect(r.doc.arrows[1]).toMatchObject({ x1: 120, y1: 320, x2: 320, y2: 320 });
});

const DOC_LIENS = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 0, y: 0, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 400, y: 0, width: 160, height: 80, text: "Fin" },
    { id: "b3", x: 0, y: 300, width: 160, height: 80, text: "Autre" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left", color: "red" }],
});

test("REQ142_AC1_rattacher_l_arrivee_garde_id_style_et_cote_de_depart", () => {
  const d = rattacher(DOC_LIENS(), "l1", "arrivee", "b3", "top");
  expect(d.links).toEqual([{ id: "l1", from: "b1", to: "b3", fromSide: "right", toSide: "top", color: "red" }]);
});

test("REQ142_AC2_rattacher_le_depart_sur_sa_boite_change_le_cote_ou_passe_a_une_autre", () => {
  expect(rattacher(DOC_LIENS(), "l1", "depart", "b1", "bottom").links[0]).toEqual({ id: "l1", from: "b1", to: "b2", fromSide: "bottom", toSide: "left", color: "red" });
  expect(rattacher(DOC_LIENS(), "l1", "depart", "b3", "right").links[0]).toMatchObject({ from: "b3", to: "b2", fromSide: "right", toSide: "left" });
});

test("REQ142_AC3_lien_sans_cote_l_autre_bout_prend_le_cote_le_plus_proche", () => {
  const doc = { ...DOC_LIENS(), links: [{ id: "l1", from: "b1", to: "b2" }] };
  expect(rattacher(doc, "l1", "arrivee", "b2", "top").links[0]).toEqual({ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "top" });
});

test("REQ142_AC4_rattacher_refuse_boite_de_l_autre_bout_lien_existant_et_rien_a_changer", () => {
  const d = DOC_LIENS();
  expect(rattacher(d, "l1", "arrivee", "b1", "top")).toBe(d);
  expect(rattacher(d, "l1", "arrivee", "b2", "left")).toBe(d);
  expect(rattacher(d, "l1", "arrivee", "inconnue", "left")).toBe(d);
  expect(rattacher(d, "inconnu", "arrivee", "b3", "top")).toBe(d);
  const deux = { ...d, links: [...d.links, { id: "l2", from: "b1", to: "b3" }] };
  expect(rattacher(deux, "l1", "arrivee", "b3", "top")).toBe(deux);
  const inverse = { ...d, links: [...d.links, { id: "l2", from: "b3", to: "b1" }] };
  expect(rattacher(inverse, "l1", "arrivee", "b3", "top").links[0].to).toBe("b3");
  expect(() => rattacher(d, "l1", "milieu", "b3", "top")).toThrow();
});
