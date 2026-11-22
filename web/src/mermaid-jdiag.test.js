import { describe, expect, it } from "vitest";
import { ecrireJdiag, lireJdiag } from "./jdiag.js";
import { depuisMermaid } from "./mermaid-jdiag.js";

const doc = (t) => depuisMermaid(t).doc;
const pos = (d) => d.boxes.map((b) => [b.x, b.y]);

describe("depuisMermaid", () => {
  it("REQ154_AC1 : boîtes, liens, modèle et écriture relue à l'identique", () => {
    const t = "graph TD\n  A[Début] --> B{Choix}\n  B -->|oui| C(Fin)\n  B -.-> D((Autre))";
    const d = doc(t);
    expect(d.model).toBe(t);
    expect(d.arrows).toEqual([]);
    expect(d.boxes).toEqual([
      { id: "b1", x: 160, y: 50, width: 160, height: 80, text: "Début" },
      { id: "b2", x: 160, y: 220, width: 160, height: 100, text: "Choix", shape: "diamond" },
      { id: "b3", x: 40, y: 410, width: 160, height: 80, text: "Fin", shape: "rounded" },
      { id: "b4", x: 310, y: 400, width: 100, height: 100, text: "Autre", shape: "ellipse" },
    ]);
    expect(d.links).toEqual([
      { id: "l1", from: "b1", to: "b2" },
      { id: "l2", from: "b2", to: "b3", text: "oui" },
      { id: "l3", from: "b2", to: "b4", line: "dashed" },
    ]);
    const ecrit = ecrireJdiag(d);
    expect(ecrit).toContain('    {"id": "b1", "x": 160, "y": 50, "width": 160, "height": 80, "text": "Début"}');
    expect(ecrit).toContain('    {"id": "b2", "x": 160, "y": 220, "width": 160, "height": 100, "text": "Choix", "shape": "diamond"}');
    expect(ecrit).toContain('    {"id": "l2", "from": "b2", "to": "b3", "text": "oui"}');
    expect(ecrit).toContain('    {"id": "l3", "from": "b2", "to": "b4", "line": "dashed"}');
    expect(ecrit).not.toContain("arrows");
    expect(ecrit.startsWith('{\n  "version": 1,\n  "model": ')).toBe(true);
    expect(ecrireJdiag(lireJdiag(ecrit))).toBe(ecrit);
  });

  it("REQ154_AC2 : directions", () => {
    expect(pos(doc("graph LR; A --> B; A --> C"))).toEqual([[40, 140], [280, 50], [280, 230]]);
    expect(pos(doc("flowchart BT\nA --> B"))).toEqual([[40, 230], [40, 50]]);
    expect(pos(doc("graph RL\nA --> B"))).toEqual([[280, 50], [40, 50]]);
    expect(pos(doc("graph\nA --> B"))).toEqual([[40, 50], [40, 230]]);
    expect(pos(doc("graph TB\nA --> B"))).toEqual([[40, 50], [40, 230]]);
    expect(doc("graph LR; A --> B; A --> C").boxes.every((b) => b.width === 160 && b.height === 80)).toBe(true);
  });

  it("REQ154_AC3 : liens", () => {
    const d = doc("graph TD\nA --- B\nA <--> C\nA ==> D\nA -- texte --> E\nA -.- F\nA --o G\nA ~~~ H\nA --> A\nA --> B");
    expect(d.boxes.map((b) => b.text)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(d.links).toEqual([
      { id: "l1", from: "b1", to: "b2", ends: "none" },
      { id: "l2", from: "b1", to: "b3", ends: "both" },
      { id: "l3", from: "b1", to: "b4", weight: "thick" },
      { id: "l4", from: "b1", to: "b5", text: "texte" },
      { id: "l5", from: "b1", to: "b6", ends: "none", line: "dashed" },
      { id: "l6", from: "b1", to: "b7" },
    ]);
    expect(doc("graph TD; A & B --> C --> D").links.map((l) => [l.from, l.to])).toEqual([["b1", "b3"], ["b2", "b3"], ["b3", "b4"]]);
    expect(doc("graph TD\nA -->|oui| B").links[0].text).toBe("oui");
    expect(doc("graph TD\nA == oui ==> B").links[0]).toEqual({ id: "l1", from: "b1", to: "b2", text: "oui", weight: "thick" });
    expect(doc("graph TD\nA -. non .-> B").links[0]).toEqual({ id: "l1", from: "b1", to: "b2", text: "non", line: "dashed" });
    expect(doc("graph TD\nA o--o B\nB x--x C\nC --x D").links.map((l) => l.ends)).toEqual(["both", "both", undefined]);
  });

  it("REQ154_AC4 : formes, textes, nœud redéfini", () => {
    const d = doc(
      'graph TD\nA["Deux<br/>lignes"]\nB([Stade])\nC[(Base)]\nD>Note]\nE{{Hexa}}\nF\nG[Un]\nG[Deux]\nH[Classe]:::important',
    );
    expect(d.boxes.map((b) => [b.text, b.shape, b.width, b.height])).toEqual([
      ["Deux\nlignes", undefined, 160, 80],
      ["Stade", "rounded", 160, 80],
      ["Base", "database", 100, 100],
      ["Note", "note", 160, 80],
      ["Hexa", undefined, 160, 80],
      ["F", undefined, 160, 80],
      ["Deux", undefined, 160, 80],
      ["Classe", undefined, 160, 80],
    ]);
    expect(d.links).toEqual([]);
    expect(doc("graph TD\nA[x]\nA\nB[a<br>b<br />c]").boxes.map((b) => b.text)).toEqual(["x", "a\nb\nc"]);
  });

  it("REQ154_AC5 : clôtures, commentaires et instructions ignorées", () => {
    const lignes = [
      "```mermaid", "%%{init: {'theme': 'dark'}}%%", "flowchart LR", "  %% commentaire", "  subgraph S [Groupe]",
      "    A --> B", "  end", "  classDef rouge fill:#f00", "  style A fill:#f00", '  click A "https://exemple.org"', "```",
    ];
    const d = doc(lignes.join("\n"));
    expect(d.boxes.map((b) => b.text)).toEqual(["A", "B"]);
    expect(d.links).toEqual([{ id: "l1", from: "b1", to: "b2" }]);
    expect(d.model).toBe(lignes.slice(1, -1).join("\n"));
  });

  it("REQ154_AC6 : refus et causes", () => {
    expect(depuisMermaid("graph TD\nA --> B\nA@{ shape: rect }")).toEqual({ refus: "la ligne 3 n'est pas comprise." });
    expect(depuisMermaid("```mermaid\ngraph TD\nA --> B\nA@{ shape: rect }\n```")).toEqual({ refus: "la ligne 4 n'est pas comprise." });
    expect(depuisMermaid("graph TD\nA[Début --> B")).toEqual({ refus: "la ligne 2 n'est pas comprise." });
    expect(depuisMermaid("graph TD")).toEqual({ refus: "il n'a aucun nœud." });
  });

  it("REQ154_AC8 : retours Windows et lignes vides finales", () => {
    const d = doc("graph TD\r\nA --> B\r\n\r\n");
    expect(d.model).toBe("graph TD\nA --> B");
    expect(pos(d)).toEqual([[40, 50], [40, 230]]);
  });

  it("REQ154_AC9 : un cycle ne compte pas son dernier lien", () => {
    const d = doc("graph TD; A --> B; B --> C; C --> A");
    expect(pos(d)).toEqual([[40, 50], [40, 230], [40, 410]]);
    expect(d.links).toHaveLength(3);
    expect(d.links[2]).toEqual({ id: "l3", from: "b3", to: "b1" });
  });

  it("pas du mermaid : aucun résultat, sans refus", () => {
    expect(depuisMermaid("Bonjour")).toBeNull();
    expect(depuisMermaid("")).toBeNull();
    expect(depuisMermaid("graphique TD\nA --> B")).toBeNull();
  });

  it("REQ154_AC16 : chaque autre type est reconnu, avec le texte normalisé comme modèle", () => {
    const mots = [
      "sequenceDiagram", "classDiagram", "classDiagram-v2", "stateDiagram", "stateDiagram-v2", "erDiagram", "journey", "gantt", "pie",
      "quadrantChart", "requirementDiagram", "requirement", "gitGraph", "C4Context", "C4Container", "C4Component", "C4Dynamic",
      "C4Deployment", "mindmap", "timeline", "sankey", "sankey-beta", "xychart", "xychart-beta", "block", "block-beta", "packet",
      "packet-beta", "architecture-beta", "kanban", "radar-beta", "treemap", "treeView-beta", "venn-beta", "wardley-beta",
      "usecase-beta", "swimlane-beta", "eventmodeling", "ishikawa", "ishikawa-beta", "cynefin-beta", "agentflow-beta",
      "railroad-beta", "railroad-ebnf-beta", "railroad-abnf-beta", "railroad-peg-beta", "flowchart-elk",
    ];
    expect(mots).toHaveLength(47);
    for (const mot of mots) {
      const texte = `${mot}\n  a b`;
      expect(depuisMermaid(texte), mot).toEqual({ autre: true, model: texte });
    }
    expect(depuisMermaid("pie title Animaux\n  \"Chiens\" : 3")).toEqual({ autre: true, model: "pie title Animaux\n  \"Chiens\" : 3" });
    expect(depuisMermaid("info")).toBeNull();
    expect(depuisMermaid("Bonjour")).toBeNull();
    const clos = ["```mermaid", "%%{init: {'theme': 'dark'}}%%", "", "  %% commentaire", "sequenceDiagram", "  A->>B: Salut", "```"];
    expect(depuisMermaid(clos.join("\r\n") + "\r\n\r\n")).toEqual({ autre: true, model: clos.slice(1, -1).join("\n") });
    expect(depuisMermaid("%%{init: {}}%%\ngantt")).toEqual({ autre: true, model: "%%{init: {}}%%\ngantt" });
  });
});
