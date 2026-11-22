import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Traduction d'un dessin de mermaid en objets du whiteboard, dans le navigateur, sans Yaide (REQ-154, DEC-107).
const exemples = JSON.parse(fs.readFileSync(new URL("./mermaid-exemples.json", import.meta.url), "utf8"));
const norm = (t) => t.replace(/\s+/g, " ").trim();

async function charger(page) {
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: "web/dist/mermaid.js" });
}

test("REQ154_AC17_traduction_d_un_dessin_donne_mesure", async ({ page }) => {
  await charger(page);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 400 300">
    <defs><marker id="m"><path d="M0,0 L5,5"/></marker></defs>
    <g transform="translate(100,50)"><g transform="scale(1)">
      <rect x="-50" y="-20" width="100" height="40" rx="5" fill="#ececff" stroke="#333"/>
      <text x="0" y="0" text-anchor="middle" dominant-baseline="middle">A</text>
    </g></g>
    <rect x="0" y="0" width="30" height="30" fill="red" display="none"/>
  </svg>`;
  const r = await page.evaluate((s) => window.yaideMermaid.traduireSvg(s), svg);
  expect(r.refus).toBeUndefined();
  expect(r.doc.boxes).toHaveLength(1);
  // origine (10, 20) : (100 - 10 - 50 + 40, 50 - 20 - 20 + 40) = (80, 50)
  expect(r.doc.boxes[0]).toMatchObject({ id: "b1", shape: "rounded", x: 80, y: 50, width: 100, height: 40, text: "A" });
  expect(r.doc.arrows).toHaveLength(0);
});

test("REQ154_AC17_groupe_translate_puis_scale", async ({ page }) => {
  await charger(page);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
    <g transform="translate(100,50) scale(2)"><rect x="0" y="0" width="20" height="10" fill="none" stroke="#333" stroke-dasharray="3"/></g>
    <marker id="z"><rect x="0" y="0" width="9" height="9" fill="red"/></marker>
  </svg>`;
  const r = await page.evaluate((s) => window.yaideMermaid.traduireSvg(s), svg);
  expect(r.doc.boxes).toEqual([{ id: "b1", x: 140, y: 90, width: 40, height: 20, text: "", opacity: 0, line: "dashed" }]);
});

test("REQ154_AC16_AC14_AC15_AC6_un_exemple_par_type_traduit", async ({ page }) => {
  await charger(page);
  const resultats = await page.evaluate(async (ex) => {
    const sortie = {};
    for (const [mot, texte] of Object.entries(ex)) {
      const d = await window.yaideMermaid.dessiner(texte);
      const t = d ? window.yaideMermaid.traduireSvg(d.svg) : { refus: "mermaid ne sait pas le lire." };
      let textes = [];
      if (d) {
        const c = document.createElement("div");
        c.style.cssText = "position:fixed;left:-100000px;top:0";
        c.innerHTML = d.svg;
        document.body.appendChild(c);
        textes = [...c.querySelectorAll("text")]
          .filter((e) => !e.closest("defs, marker, style") && e.checkVisibility({ visibilityProperty: true }))
          .flatMap((e) => {
            const rangs = [...e.children].filter((t) => t.localName === "tspan");
            return rangs.length > 1 ? rangs.map((t) => t.textContent) : [e.textContent];
          });
        c.remove();
      }
      sortie[mot] = { t, textes };
    }
    return sortie;
  }, exemples);
  const mots = Object.keys(exemples);
  expect(mots).toHaveLength(46);
  const defauts = [];
  for (const mot of mots) {
    const { t, textes } = resultats[mot];
    if (t.refus || !t.doc) { defauts.push(`${mot} : refus ${t.refus}`); continue; }
    const objets = t.doc.boxes.length + t.doc.arrows.length;
    if (objets < 1) defauts.push(`${mot} : aucun objet`);
    const permis = new Set();
    for (const b of t.doc.boxes) { permis.add(norm(b.text)); for (const l of b.text.split("\n")) permis.add(norm(l)); }
    for (const x of textes) if (norm(x) && !permis.has(norm(x))) defauts.push(`${mot} : texte perdu « ${norm(x)} »`);
  }
  expect(defauts).toEqual([]);

  const doc = (await page.evaluate(() => window.yaideMermaid.traduire("sequenceDiagram\n  Alice->>Bob: Bonjour\n  Bob-->>Alice: Salut"))).doc;
  const par = (t, f) => doc.boxes.filter((b) => b.text === t && f(b));
  const alice = par("Alice", (b) => b.shape !== "text")[0];
  const bob = par("Bob", (b) => b.shape !== "text")[0];
  const bonjour = par("Bonjour", (b) => b.shape === "text")[0];
  const salut = par("Salut", (b) => b.shape === "text")[0];
  expect([alice, bob, bonjour, salut].every(Boolean)).toBe(true);
  const cx = (b) => b.x + b.width / 2;
  for (const b of [bonjour, salut]) {
    expect(cx(b)).toBeGreaterThan(cx(alice));
    expect(cx(b)).toBeLessThan(cx(bob));
  }
  expect(salut.y).toBeGreaterThan(bonjour.y);
  const pointes = doc.arrows.filter((a) => (a.ends ?? "end") !== "none");
  expect(pointes.length).toBeGreaterThanOrEqual(2);
  expect(pointes.some((a) => a.line === "dashed")).toBe(true);
  for (const o of [...doc.boxes, ...doc.arrows])
    for (const k of ["x", "y", "x1", "y1"]) if (k in o) expect(o[k]).toBeGreaterThanOrEqual(40);

  const etat = (await page.evaluate(() => window.yaideMermaid.traduire("stateDiagram-v2\n  [*] --> Actif\n  Actif --> [*]"))).doc;
  expect(etat.boxes.some((b) => b.shape === "dot")).toBe(true);
  expect(etat.boxes.some((b) => b.shape === "rounded" && b.text === "Actif")).toBe(true);
  expect(etat.arrows.filter((a) => (a.ends ?? "end") !== "none").length).toBeGreaterThanOrEqual(2);
  const tarte = (await page.evaluate(() => window.yaideMermaid.traduire('pie title Animaux\n  "Chiens" : 3\n  "Chats" : 1'))).doc;
  expect(tarte.boxes.some((b) => b.shape === "ellipse")).toBe(true);
  for (const t of ["Animaux", "Chiens", "Chats"]) expect(tarte.boxes.some((b) => b.text === t)).toBe(true);

  expect(await page.evaluate(() => window.yaideMermaid.traduire("sequenceDiagram\n  A->>B: Bonjour\n  end"))).toEqual({ refus: "mermaid ne sait pas le lire." });
});
