import { describe, expect, test } from "vitest";
import { avecExtensionJdiag, ecrireJdiag, idLibre, lireJdiag, normaliserSpans } from "./jdiag.js";

const VIDE = '{\n  "version": 1,\n  "boxes": [],\n  "links": []\n}\n';
const DEUX =
  '{\n  "version": 1,\n  "boxes": [\n    {"id": "b1", "x": 40, "y": 80, "width": 160, "height": 80, "text": "Début"},\n    {"id": "b2", "x": 300, "y": 80, "width": 160, "height": 80, "text": "Fin"}\n  ],\n  "links": [\n    {"id": "l1", "from": "b1", "to": "b2"}\n  ]\n}\n';

describe("jdiag", () => {
  test("REQ132_AC1 : whiteboard vide", () => {
    expect(ecrireJdiag({ version: 1, boxes: [], links: [] })).toBe(VIDE);
    expect(lireJdiag("")).toEqual({ version: 1, boxes: [], links: [], arrows: [] });
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

  const GRAND =
    '{\n  "version": 1,\n  "boxes": [\n    {"id": "b1", "x": 40, "y": 80, "width": 100, "height": 100, "text": "Début", "shape": "ellipse", "color": "green"},\n    {"id": "b2", "x": 300, "y": 80, "width": 160, "height": 80, "text": "Fin"}\n  ],\n  "links": [\n    {"id": "l1", "from": "b1", "to": "b2", "fromSide": "right", "toSide": "left", "route": "orthogonal", "ends": "both", "line": "dashed"}\n  ],\n  "arrows": [\n    {"id": "a1", "x1": 100, "y1": 300, "x2": 300, "y2": 300, "ends": "none"}\n  ]\n}\n';

  test("REQ132_AC6 : styles, côtés et flèche libre, relus à l'identique", () => {
    const doc = lireJdiag(GRAND);
    expect(doc.boxes[0]).toMatchObject({ shape: "ellipse", color: "green" });
    expect(doc.boxes[1]).toMatchObject({ shape: "rectangle", color: "default" });
    expect(doc.links[0]).toMatchObject({ fromSide: "right", toSide: "left", route: "orthogonal", ends: "both", line: "dashed" });
    expect(doc.arrows[0]).toEqual({ id: "a1", x1: 100, y1: 300, x2: 300, y2: 300, route: "direct", ends: "none", line: "solid", color: "default", weight: "thin" });
    expect(lireJdiag(DEUX).links[0]).toMatchObject({ fromSide: null, toSide: null, route: "direct", ends: "end", line: "solid" });
    expect(ecrireJdiag(doc)).toBe(GRAND);
  });

  test("REQ132_AC11 : center admis pour fromSide et toSide, middle refusé", () => {
    const centre = GRAND.replace('"fromSide": "right", "toSide": "left"', '"fromSide": "center", "toSide": "center"');
    expect(centre).not.toBe(GRAND);
    const doc = lireJdiag(centre);
    expect(doc.links[0]).toMatchObject({ fromSide: "center", toSide: "center" });
    expect(ecrireJdiag(doc)).toBe(centre);
    expect(lireJdiag(centre.replace('"toSide": "center"', '"toSide": "middle"'))).toBeNull();
  });

  const BOITE = '{"id": "b1", "x": 0, "y": 0, "width": 1, "height": 1, "text": ""}';
  const doc7 = (liens, arrows) => `{"version": 1, "boxes": [${BOITE}, ${BOITE.replace("b1", "b2")}], "links": [${liens}], "arrows": ${arrows}}`;
  test.each([
    `{"version": 1, "boxes": [{"id": "b1", "x": 0, "y": 0, "width": 1, "height": 1, "text": "", "shape": "triangle"}], "links": []}`,
    doc7('{"id": "l1", "from": "b1", "to": "b2", "route": "zigzag"}', "[]"),
    doc7('{"id": "l1", "from": "b1", "to": "b2", "fromSide": "right"}', "[]"),
    doc7('{"id": "l1", "from": "b1", "to": "b2", "fromSide": "right", "toSide": "dessus"}', "[]"),
    doc7("", "{}"),
    doc7("", '[{"id": "a1", "x1": "1", "y1": 0, "x2": 0, "y2": 0}]'),
    doc7("", '[{"id": "a1", "x1": 1, "y1": 0, "x2": 0}]'),
    doc7('{"id": "l1", "from": "b1", "to": "b2"}', '[{"id": "l1", "x1": 1, "y1": 0, "x2": 0, "y2": 0}]'),
  ])("REQ132_AC7 : illisible %s", (texte) => {
    expect(lireJdiag(texte)).toBeNull();
  });

  test("REQ132_AC8 : valeurs par défaut non réécrites, id de flèche libre", () => {
    const explicite = DEUX.replace('"text": "Début"', '"text": "Début", "shape": "rectangle", "color": "default"')
      .replace('"to": "b2"', '"to": "b2", "route": "direct", "ends": "end", "line": "solid"')
      .replace('"links": [\n    {"id": "l1", "from": "b1", "to": "b2", "route": "direct", "ends": "end", "line": "solid"}\n  ]', '"links": [\n    {"id": "l1", "from": "b1", "to": "b2", "route": "direct", "ends": "end", "line": "solid"}\n  ], "arrows": []');
    const doc = lireJdiag(explicite);
    expect(doc).not.toBeNull();
    expect(ecrireJdiag(doc)).toBe(DEUX);
    const libre = (id) => ({ id, x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(idLibre("a", { version: 1, boxes: [], links: [], arrows: [libre("a1"), libre("a3")] })).toBe("a2");
    expect(idLibre("a", { version: 1, boxes: [], links: [] })).toBe("a1");
  });

  const STYLES =
    '{\n  "version": 1,\n  "boxes": [\n    {"id": "b1", "x": 40, "y": 80, "width": 160, "height": 80, "text": "Début", "color": "blue", "line": "dashed", "weight": "thick", "opacity": 50, "textSize": "large"},\n    {"id": "b2", "x": 300, "y": 80, "width": 160, "height": 80, "text": "Fin"}\n  ],\n  "links": [\n    {"id": "l1", "from": "b1", "to": "b2", "color": "red", "weight": "medium"}\n  ],\n  "arrows": [\n    {"id": "a1", "x1": 100, "y1": 300, "x2": 300, "y2": 300, "line": "dotted", "color": "green", "weight": "thick"}\n  ]\n}\n';

  test("REQ132_AC9 : contours, opacité, taille du texte, couleur et épaisseur des traits", () => {
    const doc = lireJdiag(STYLES);
    expect(doc.boxes[0]).toMatchObject({ color: "blue", line: "dashed", weight: "thick", opacity: 50, textSize: "large" });
    expect(doc.boxes[1]).toMatchObject({ line: "solid", weight: "thin", opacity: 100, textSize: "normal" });
    expect(doc.links[0]).toMatchObject({ color: "red", weight: "medium" });
    expect(doc.arrows[0]).toMatchObject({ line: "dotted", color: "green", weight: "thick" });
    expect(lireJdiag(DEUX).links[0]).toMatchObject({ color: "default", weight: "thin" });
    expect(ecrireJdiag(doc)).toBe(STYLES);
    const explicite = STYLES.replace('"text": "Fin"', '"text": "Fin", "weight": "thin", "opacity": 100, "textSize": "normal"');
    expect(ecrireJdiag(lireJdiag(explicite))).toBe(STYLES);
  });

  test.each([
    ['"weight": "huge"'],
    ['"opacity": 30'],
    ['"opacity": "50"'],
    ['"textSize": "tiny"'],
  ])("REQ132_AC10 : boîte illisible %s", (extra) => {
    expect(lireJdiag(`{"version": 1, "boxes": [{"id": "b1", "x": 0, "y": 0, "width": 1, "height": 1, "text": "", ${extra}}], "links": []}`)).toBeNull();
  });

  test.each([
    doc7('{"id": "l1", "from": "b1", "to": "b2", "color": "pink"}', "[]"),
    doc7("", '[{"id": "a1", "x1": 0, "y1": 0, "x2": 0, "y2": 0, "weight": 2}]'),
  ])("REQ132_AC10 : lien ou flèche illisible %s", (texte) => {
    expect(lireJdiag(texte)).toBeNull();
  });

  const SPANS =
    '{\n  "version": 1,\n  "boxes": [\n    {"id": "b1", "x": 40, "y": 80, "width": 160, "height": 80, "text": "Début du flux", "spans": [{"start": 0, "end": 5, "bold": true, "color": "red"}, {"start": 9, "end": 13, "italic": true, "underline": true, "strike": true}]},\n    {"id": "b2", "x": 300, "y": 80, "width": 160, "height": 80, "text": "Fin"}\n  ],\n  "links": [\n    {"id": "l1", "from": "b1", "to": "b2", "color": "red", "text": "par mail", "spans": [{"start": 4, "end": 8, "bold": true}], "textSize": "large"}\n  ]\n}\n';

  test("REQ132_AC12 : parties du texte et texte d'un lien, texte exact, relu et réécrit à l'identique", () => {
    const doc = lireJdiag(SPANS);
    expect(doc.boxes[0].spans).toEqual([
      { start: 0, end: 5, bold: true, color: "red" },
      { start: 9, end: 13, italic: true, underline: true, strike: true },
    ]);
    expect(doc.boxes[1].spans).toEqual([]);
    expect(doc.links[0]).toMatchObject({ text: "par mail", textSize: "large", spans: [{ start: 4, end: 8, bold: true }] });
    expect(lireJdiag(DEUX).links[0]).toMatchObject({ text: "", spans: [], textSize: "normal" });
    expect(ecrireJdiag(doc)).toBe(SPANS);
  });

  test("REQ132_AC13 : normalisation, lien sans texte, caractères hors plan de base", () => {
    const autre = SPANS.replace(
      '"spans": [{"start": 0, "end": 5, "bold": true, "color": "red"}, {"start": 9, "end": 13, "italic": true, "underline": true, "strike": true}]',
      '"spans": [{"start": 9, "end": 13, "strike": true, "italic": true, "underline": true, "bold": false, "color": "default"}, {"start": 6, "end": 8, "italic": false}, {"start": 2, "end": 5, "bold": true, "color": "red"}, {"start": 0, "end": 2, "color": "red", "bold": true, "color2": 1}]',
    )
      .replace('"text": "Fin"}', '"text": "Fin", "spans": []}')
      .replace('"color": "red", "text": "par mail"', '"color": "red", "text": "par mail", "color": "red"');
    expect(autre).not.toBe(SPANS);
    const doc = lireJdiag(autre);
    expect(doc).not.toBeNull();
    expect(ecrireJdiag(doc)).toBe(SPANS);
    const vide = lireJdiag(SPANS.replace('"text": "par mail", "spans": [{"start": 4, "end": 8, "bold": true}]', '"text": ""'));
    expect(vide.links[0].text).toBe("");
    expect(ecrireJdiag(vide)).not.toContain('"text": ""');
    expect(ecrireJdiag(vide)).not.toContain('"spans": [{"start": 4');
    const emoji = '{"version": 1, "boxes": [{"id": "b1", "x": 0, "y": 0, "width": 1, "height": 1, "text": "A😀B", "spans": [{"start": 2, "end": 3, "bold": true}]}], "links": []}';
    const d = lireJdiag(emoji);
    expect(d.boxes[0].spans).toEqual([{ start: 2, end: 3, bold: true }]);
    expect(ecrireJdiag(d)).toBe('{\n  "version": 1,\n  "boxes": [\n    {"id": "b1", "x": 0, "y": 0, "width": 1, "height": 1, "text": "A😀B", "spans": [{"start": 2, "end": 3, "bold": true}]}\n  ],\n  "links": []\n}\n');
    expect(normaliserSpans("A😀B", [{ start: 0, end: 4 }])).toBeNull();
    expect(normaliserSpans("abcd", [{ start: 2, end: 4, bold: true }, { start: 0, end: 2, bold: true }])).toEqual([{ start: 0, end: 4, bold: true }]);
    expect(normaliserSpans("abcd", undefined)).toEqual([]);
  });

  test.each([
    ["boîte", '"text": "Début du flux", "spans": [{"start": 0, "end": 14, "bold": true}]'],
    ["boîte", '"text": "Début du flux", "spans": [{"start": 5, "end": 5, "bold": true}]'],
    ["boîte", '"text": "Début du flux", "spans": [{"start": -1, "end": 3, "bold": true}]'],
    ["boîte", '"text": "Début du flux", "spans": [{"start": 0, "end": 5, "bold": true}, {"start": 3, "end": 8, "italic": true}]'],
    ["boîte", '"text": "Début du flux", "spans": [{"start": 0, "end": 5, "bold": "yes"}]'],
    ["boîte", '"text": "Début du flux", "spans": [{"start": 0, "end": 5, "color": "pink"}]'],
    ["boîte", '"text": "Début du flux", "spans": [{"start": 1.5, "end": 5, "bold": true}]'],
    ["boîte", '"text": "Début du flux", "spans": {}'],
    ["boîte", '"text": "Début du flux", "spans": [3]'],
    ["lien", '"text": 3'],
    ["lien", '"text": "mail", "textSize": "tiny"'],
    ["lien", '"spans": [{"start": 0, "end": 1, "bold": true}]'],
  ])("REQ132_AC14 : %s illisible %s", (genre, extra) => {
    const boite = (id, e) => `{"id": "${id}", "x": 0, "y": 0, "width": 1, "height": 1, ${e}}`;
    const b1 = genre === "boîte" ? boite("b1", extra) : boite("b1", '"text": ""');
    const lien = genre === "lien" ? `{"id": "l1", "from": "b1", "to": "b2", ${extra}}` : "";
    const texte = `{"version": 1, "boxes": [${b1}, ${boite("b2", '"text": ""')}], "links": [${lien}]}`;
    expect(lireJdiag(texte)).toBeNull();
  });
});
