import { describe, expect, it } from "vitest";
import { versKlaxoon } from "./klaxoon.js";
import exemple from "./klaxoon-exemple.json";

const decoder = (html) => {
  const div = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
  const v = div.getAttribute("data-board");
  const octets = Uint8Array.from(atob(v.slice(36)), (c) => c.charCodeAt(0));
  return { div, tete: v.slice(0, 36), liste: JSON.parse(new TextDecoder().decode(octets)) };
};
const boite = (id, text, x, y) => ({ id, x, y, width: 160, height: 80, text });
const doc = {
  boxes: [boite("b1", "Début", 40, 80), boite("b2", "Fin", 300, 80)],
  links: [{ id: "l1", from: "b1", to: "b2" }],
  arrows: [{ id: "a1", x1: 100, y1: 300, x2: 300, y2: 300 }],
};
const ex = decoder(exemple[1][1]);

describe("versKlaxoon", () => {
  it("REQ155_AC2 : texte, html et entrées au format de l'exemple", () => {
    const r = versKlaxoon(doc, ["b1", "b2", "l1", "a1"]);
    expect(r.texte).toBe("Début\nFin");
    expect([r.boites, r.liens]).toEqual([2, 1]);
    const { div, tete, liste } = decoder(r.html);
    expect(r.html.startsWith("<div ")).toBe(true);
    expect(div.children.length).toBe(3);
    expect(div.innerHTML).toBe("<p>Début</p><br><p>Fin</p>");
    expect(tete).toMatch(/^[0-9a-f-]{36}$/);
    expect(liste.map((e) => e.type)).toEqual(["postit", "postit", "link"]);
    liste.forEach((e, i) => {
      expect(Object.keys(e.data)).toEqual(Object.keys(ex.liste[i].data));
      const attendu = structuredClone(ex.liste[i].data);
      delete attendu.parent;
      delete attendu.sourceActivityUuid;
      const obtenu = structuredClone(e.data);
      delete obtenu.parent;
      delete obtenu.sourceActivityUuid;
      if (e.type === "postit") for (const c of ["coords", "zIndex", "contentHtml"]) delete attendu[c], delete obtenu[c];
      else for (const c of ["objectIds", "objectAnchors"]) delete attendu[c], delete obtenu[c];
      expect(obtenu).toEqual(attendu);
    });
    expect(liste[0].data.coords).toEqual({ left: 40, top: 80 });
    expect(liste[1].data.coords).toEqual({ left: 300, top: 80 });
    expect([liste[0].data.zIndex, liste[1].data.zIndex]).toEqual([1, 2]);
    expect([liste[0].data.contentHtml, liste[1].data.contentHtml]).toEqual(["<p>Début</p>", "<p>Fin</p>"]);
    expect(liste[2].data.objectIds).toEqual([liste[0].data.parent, liste[1].data.parent]);
    expect(liste[2].data.objectAnchors).toEqual(["right", "left"]);
    const uuids = [tete, ...liste.map((e) => e.data.parent)];
    const dex = [ex.tete, ...ex.liste.map((e) => e.data.parent), ex.liste[0].data.sourceActivityUuid];
    expect(new Set([...uuids, liste[0].data.sourceActivityUuid]).size).toBe(5);
    expect(new Set([...uuids, liste[0].data.sourceActivityUuid, ...dex]).size).toBe(10);
    expect(new Set(liste.map((e) => e.data.sourceActivityUuid)).size).toBe(1);
    const autre = decoder(versKlaxoon(doc, ["b1", "b2", "l1"]).html);
    expect(autre.tete).not.toBe(tete);
    expect(autre.liste[0].data.parent).not.toBe(liste[0].data.parent);
    expect(autre.liste[0].data.sourceActivityUuid).not.toBe(liste[0].data.sourceActivityUuid);
    expect(JSON.stringify(liste)).not.toContain('"a1"');
  });

  it("REQ155_AC2 : aucune boîte choisie → null", () => {
    expect(versKlaxoon(doc, ["a1"])).toBeNull();
    expect(versKlaxoon(doc, [])).toBeNull();
  });

  it("REQ155_AC3 : texte échappé, une paire de p par ligne", () => {
    const d = { boxes: [boite("b1", "a < b & c\ny", 0, 0)], links: [], arrows: [] };
    const { liste } = decoder(versKlaxoon(d, ["b1"]).html);
    expect(liste[0].data.contentHtml).toBe("<p>a &lt; b &amp; c</p><p>y</p>");
  });

  it("REQ155_AC3 : côtés du lien dans les quatre directions", () => {
    const cotes = (b2x, b2y) => {
      const d = { boxes: [boite("b1", "A", 100, 100), boite("b2", "B", b2x, b2y)], links: [{ id: "l1", from: "b1", to: "b2" }], arrows: [] };
      return decoder(versKlaxoon(d, ["b1", "b2", "l1"]).html).liste[2].data.objectAnchors;
    };
    expect(cotes(400, 100)).toEqual(["right", "left"]);
    expect(cotes(-200, 100)).toEqual(["left", "right"]);
    expect(cotes(100, 300)).toEqual(["bottom", "top"]);
    expect(cotes(100, -100)).toEqual(["top", "bottom"]);
    expect(cotes(300, 300)).toEqual(["right", "left"]);
  });

  it("REQ155_AC3 : lien dont une seule boîte est choisie → absent", () => {
    const r = versKlaxoon(doc, ["b1", "l1"]);
    expect(r.liens).toBe(0);
    expect(decoder(r.html).liste.map((e) => e.type)).toEqual(["postit"]);
  });

  it("REQ155_AC3 : data-board échappé", () => {
    const r = versKlaxoon(doc, ["b1"], () => 'a"&b');
    expect(r.html.startsWith('<div data-board="a&quot;&amp;b')).toBe(true);
  });
});
