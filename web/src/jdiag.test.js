import { describe, expect, test } from "vitest";
import { avecExtensionJdiag, ecrireJdiag, idLibre, lireJdiag } from "./jdiag.js";

const VIDE = '{\n  "version": 1,\n  "boxes": [],\n  "links": []\n}\n';
const DEUX =
  '{\n  "version": 1,\n  "boxes": [\n    {"id": "b1", "x": 40, "y": 80, "width": 160, "height": 80, "text": "Début"},\n    {"id": "b2", "x": 300, "y": 80, "width": 160, "height": 80, "text": "Fin"}\n  ],\n  "links": [\n    {"id": "l1", "from": "b1", "to": "b2"}\n  ]\n}\n';

describe("jdiag", () => {
  test("REQ132_AC1 : whiteboard vide", () => {
    expect(ecrireJdiag({ version: 1, boxes: [], links: [] })).toBe(VIDE);
    expect(lireJdiag("")).toEqual({ version: 1, boxes: [], links: [] });
    expect(ecrireJdiag(lireJdiag(VIDE))).toBe(VIDE);
  });

  test("REQ132_AC2 : deux boîtes reliées, relecture identique", () => {
    const doc = lireJdiag(DEUX);
    expect(doc.boxes).toHaveLength(2);
    expect(ecrireJdiag(doc)).toBe(DEUX);
  });

  test("REQ132_AC3 : autre mise en forme, clé inconnue ignorée et non réécrite", () => {
    const autre =
      '{"links":[{"to":"b2","from":"b1","id":"l1"}],"boxes":[{"text":"Début","height":80,"width":160,"y":80,"x":40,"id":"b1","couleur":"rouge"},{"id":"b2","x":300,"y":80,"width":160,"height":80,"text":"Fin"}],"version":1}';
    const doc = lireJdiag(autre);
    expect(doc).toEqual(lireJdiag(DEUX));
    expect(ecrireJdiag(doc)).toBe(DEUX);
    expect(ecrireJdiag(doc)).not.toContain("couleur");
  });

  test.each([
    "[]",
    "pas du json",
    '{"version": 2, "boxes": [], "links": []}',
    '{"version": 1, "links": []}',
    '{"version": 1, "boxes": {}, "links": []}',
    '{"version": 1, "boxes": [{"id": "b1", "x": 0, "y": 0, "height": 80, "text": ""}], "links": []}',
    '{"version": 1, "boxes": [{"id": "b1", "x": "40", "y": 0, "width": 1, "height": 80, "text": ""}], "links": []}',
    '{"version": 1, "boxes": [{"id": "b1", "x": 0, "y": 0, "width": 1, "height": 80, "text": ""},{"id": "b1", "x": 0, "y": 0, "width": 1, "height": 80, "text": ""}], "links": []}',
    '{"version": 1, "boxes": [{"id": "b1", "x": 0, "y": 0, "width": 1, "height": 80, "text": ""}], "links": [{"id": "l1", "from": "b1", "to": "b9"}]}',
    '{"version": 1, "boxes": [], "links": [{"id": "l1", "from": 1, "to": "b9"}]}',
  ])("REQ132_AC4 : illisible %s", (texte) => {
    expect(lireJdiag(texte)).toBeNull();
  });

  test("REQ132_AC5 : plus petit id libre, texte à caractères spéciaux", () => {
    const b = (id) => ({ id, x: 0, y: 0, width: 1, height: 1, text: "" });
    const doc = { version: 1, boxes: [b("b1"), b("b3")], links: [{ id: "l2", from: "b1", to: "b3" }] };
    expect(idLibre("b", doc)).toBe("b2");
    expect(idLibre("l", doc)).toBe("l1");
    expect(idLibre("b", { version: 1, boxes: [], links: [] })).toBe("b1");
    const texte = 'dit "oui" \\ non\nligne é';
    const relu = lireJdiag(ecrireJdiag({ version: 1, boxes: [{ ...b("b1"), text: texte }], links: [] }));
    expect(relu.boxes[0].text).toBe(texte);
  });

  test("REQ127_AC2 : extension .jdiag", () => {
    expect(avecExtensionJdiag("docs/plan")).toBe("docs/plan.jdiag");
    expect(avecExtensionJdiag("docs/plan.jdiag")).toBe("docs/plan.jdiag");
    expect(avecExtensionJdiag("docs/Plan.JDIAG")).toBe("docs/Plan.JDIAG");
  });
});
