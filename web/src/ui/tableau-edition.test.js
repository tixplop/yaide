import { expect, test } from "vitest";
import { auPlan } from "./tableau-edition.js";

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
