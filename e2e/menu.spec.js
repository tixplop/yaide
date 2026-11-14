import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { deuxImages } from "./aides.js";
import { pathToFileURL } from "node:url";

let dossier;

test.beforeAll(async () => {
  mkdirSync(resolve(process.env.TMPDIR ?? ".test-data"), { recursive: true });
  dossier = mkdtempSync(resolve(process.env.TMPDIR ?? ".test-data", "menu-"));
  writeFileSync(
    resolve(dossier, "entree.js"),
    `import { onglets } from ${JSON.stringify(resolve("web/src/ui/onglets.js"))};
import { liste } from ${JSON.stringify(resolve("web/src/ui/liste.js"))};
import { menu } from ${JSON.stringify(resolve("web/src/ui/menu.js"))};
window.ouvertures = [];
window.choix = [];
const l = liste({
  variante: "arbre",
  lignes: [{ id: "a", libelle: "a.rs" }, { id: "b", libelle: "b.rs" }],
  surMenu: (id, position) => {
    window.ouvertures.push(id ?? "vide");
    menu({
      nom: id ? "Actions sur " + id : "Actions sur le projet",
      position,
      surFermeture: () => {},
      groupes: [[{ libelle: "Renommer", touche: "F2", surChoix: () => window.choix.push("r") }, { libelle: "Supprimer", surChoix: () => window.choix.push("s") }]],
    });
  },
});
document.getElementById("h").append(l);
window.ouvertOnglets = [];
document.getElementById("t").append(onglets({
  actif: "x",
  onglets: [{ id: "x", libelle: "x.rs", fermable: true }, { id: "y", libelle: "y.rs", fermable: true }],
  surMenu: (id) => window.ouvertOnglets.push(id),
}));`,
  );
  await build({ entryPoints: [resolve(dossier, "entree.js")], bundle: true, outfile: resolve(dossier, "page.js") });
  copyFileSync("web/src/ui/tokens.css", resolve(dossier, "tokens.css"));
  copyFileSync("web/src/ui/composants.css", resolve(dossier, "composants.css"));
  writeFileSync(
    resolve(dossier, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="composants.css"><style>body{margin:0}#h{width:300px;height:200px}</style></head>
<body><div id="h"></div><div id="t"></div><button id="ailleurs">ailleurs</button><script src="page.js"></script></body></html>`,
  );
});

test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
});

test("REQ034_AC1_clic_droit_ouvre_le_menu_de_la_ligne_une_seule_fois", async ({ page }) => {
  await page.getByRole("treeitem", { name: "a.rs" }).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions sur a" })).toBeVisible();
  expect(await page.evaluate(() => window.ouvertures)).toEqual(["a"]);
  await expect(page.getByRole("menuitem", { name: "Renommer" })).toBeFocused();
});

for (const touche of ["ContextMenu", "Shift+F10"]) {
  test(`REQ034_AC11_${touche.replace("+", "_")}_ouvre_une_seule_fois_sous_le_nom_de_la_ligne`, async ({ page }) => {
    const ligne = page.getByRole("treeitem", { name: "b.rs" });
    await ligne.focus();
    await page.keyboard.press(touche);
    await expect(page.getByRole("menu", { name: "Actions sur b" })).toBeVisible();
    // Un éventuel `contextmenu` envoyé en plus par le navigateur serait arrivé après deux images.
    await deuxImages(page);
    expect(await page.evaluate(() => window.ouvertures)).toEqual(["b"]);
    const m = await page.getByRole("menu").boundingBox();
    const nom = await ligne.locator(".liste-libelle").boundingBox();
    const l = await ligne.boundingBox();
    expect(Math.abs(m.x - nom.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.y - (l.y + l.height))).toBeLessThanOrEqual(1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.choix)).toEqual(["s"]);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(ligne).toBeFocused();
  });
}

test("C013_menu_entier_dans_la_fenetre_a_800_sur_480", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  await page.evaluate(() => (document.getElementById("h").style.cssText = "position:fixed;right:0;bottom:0;width:100px;height:60px"));
  await page.getByRole("treeitem", { name: "b.rs" }).click({ button: "right", position: { x: 90, y: 8 } });
  const m = await page.getByRole("menu").boundingBox();
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.y).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(800);
  expect(m.y + m.height).toBeLessThanOrEqual(480);
});

test("REQ061_AC10_Menu_et_Maj_F10_sur_un_onglet_ouvrent_une_seule_fois", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Chromium seul");
  const onglet = page.getByRole("tab", { name: "y.rs" });
  for (const touche of ["Shift+F10", "ContextMenu"]) {
    await onglet.focus();
    await page.keyboard.press(touche);
    // Un éventuel `contextmenu` envoyé en plus par le navigateur serait arrivé après deux images.
    await deuxImages(page);
  }
  expect(await page.evaluate(() => window.ouvertOnglets)).toEqual(["y", "y"]);
});
