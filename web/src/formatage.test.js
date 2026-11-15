import { describe, it, expect } from "vitest";
import { formatable, formater } from "./formatage.js";

describe("formatable", () => {
  it("REQ118_AC4 reconnaît json, xml et svg seulement", () => {
    expect(formatable("json")).toBe(true);
    expect(formatable("xml")).toBe(true);
    expect(formatable("markdown")).toBe(false);
    expect(formatable("rust")).toBe(false);
    expect(formatable(null)).toBe(false);
  });
});

describe("formater JSON", () => {
  it("REQ118_AC1 formate avec indentation de 2 espaces", () => {
    const r = formater('{"b":1,"a":[1,2,{}],"c":{"d":null},"e":[]}', "json");
    expect(r).toEqual({
      texte: '{\n  "b": 1,\n  "a": [\n    1,\n    2,\n    {}\n  ],\n  "c": {\n    "d": null\n  },\n  "e": []\n}\n',
    });
  });

  it("REQ118_AC2 garde ordre, doublons, nombres et échappements", () => {
    const r = formater('{"10":1,"2":2,"n":12345678901234567890,"x":1.0e2,"s":"\\u00e9\\"","k":1,"k":2}', "json");
    expect(r.texte).toBe('{\n  "10": 1,\n  "2": 2,\n  "n": 12345678901234567890,\n  "x": 1.0e2,\n  "s": "\\u00e9\\"",\n  "k": 1,\n  "k": 2\n}\n');
  });

  it("REQ118_AC7 texte déjà formaté rendu identique", () => {
    const t = '{\n  "a": [\n    1,\n    {}\n  ]\n}\n';
    expect(formater(t, "json")).toEqual({ texte: t });
  });

  it("REQ118_AC2 blancs autour et chaîne contenant { , \"", () => {
    const r = formater('  \n{"a":"x{,\\"y"}\n\n', "json");
    expect(r.texte).toBe('{\n  "a": "x{,\\"y"\n}\n');
    expect(formater("  5 ", "json")).toEqual({ texte: "5\n" });
  });

  it("REQ118_AC8 refuse un JSON invalide", () => {
    expect(formater('{"a":1,}', "json")).toEqual({ erreur: "json" });
    expect(formater('{"a":1 /* c */}', "json")).toEqual({ erreur: "json" });
    expect(formater("", "json")).toEqual({ erreur: "json" });
  });
});

describe("formater XML", () => {
  it("REQ118_AC3 formate en gardant le contenu textuel", () => {
    const src = '<?xml version="1.0"?><r a=\'1\' b="&amp;"><!-- c --><p>Texte &amp; <i>x</i></p><c/><d></d><e><![CDATA[ <z> ]]></e><f>\n  <g/></f></r>';
    expect(formater(src, "xml")).toEqual({
      texte: '<?xml version="1.0"?>\n<r a=\'1\' b="&amp;">\n  <!-- c -->\n  <p>Texte &amp; <i>x</i></p>\n  <c/>\n  <d></d>\n  <e><![CDATA[ <z> ]]></e>\n  <f>\n    <g/>\n  </f>\n</r>\n',
    });
  });

  it("REQ118_AC4 formate un svg", () => {
    const r = formater('<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="1"/></g></svg>', "xml");
    expect(r.texte).toBe('<svg xmlns="http://www.w3.org/2000/svg">\n  <g>\n    <rect width="1"/>\n  </g>\n</svg>\n');
  });

  it("REQ118_AC3 DOCTYPE, instruction et attribut contenant >", () => {
    const r = formater('\n<!DOCTYPE r [<!ENTITY a "b">]><r><?pi x?><a t="1>2"><b/></a></r>\n', "xml");
    expect(r.texte).toBe('<!DOCTYPE r [<!ENTITY a "b">]>\n<r>\n  <?pi x?>\n  <a t="1>2">\n    <b/>\n  </a>\n</r>\n');
  });

  it("REQ118_AC7 texte déjà formaté rendu identique", () => {
    const t = '<?xml version="1.0"?>\n<r>\n  <p>Texte <i>x</i></p>\n  <a>\n    <b/>\n  </a>\n</r>\n';
    expect(formater(t, "xml")).toEqual({ texte: t });
  });

  it("REQ118_AC8 refuse un XML mal formé", () => {
    expect(formater("<a><b></a>", "xml")).toEqual({ erreur: "xml" });
    expect(formater("", "xml")).toEqual({ erreur: "xml" });
  });
});
