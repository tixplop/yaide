import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dossier = resolve(process.env.TMPDIR ?? ".test-data", "menu");

test.beforeAll(async () => {
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    resolve(dossier, "entree.js"),
    `import { liste } from ${JSON.stringify(resolve("web/src/ui/liste.js"))};
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
      groupes: [[{ libelle: "Renommer", icone: "pencil", touche: "F2", surChoix: () => window.choix.push("r") }, { libelle: "Supprimer", icone: "trash", couleurIcone: "supprimer", surChoix: () => window.choix.push("s") }]],
    });
  },
});
document.getElementById("h").append(l);`,
  );
  await build({ entryPoints: [resolve(dossier, "entree.js")], bundle: true, outfile: resolve(dossier, "page.js") });
  copyFileSync("web/src/ui/tokens.css", resolve(dossier, "tokens.css"));
  copyFileSync("web/src/ui/composants.css", resolve(dossier, "composants.css"));
  writeFileSync(
    resolve(dossier, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="composants.css"><style>body{margin:0}#h{width:300px;height:200px}</style></head>
<body><div id="h"></div><button id="ailleurs">ailleurs</button><script src="page.js"></script></body></html>`,
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
    // Laisse au navigateur le temps d'envoyer un éventuel `contextmenu` en plus.
    await page.waitForTimeout(700);
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

test("REQ034_AC10_Echap_ferme_et_rend_le_focus_sans_rien_faire", async ({ page }) => {
  const ligne = page.getByRole("treeitem", { name: "a.rs" });
  await ligne.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(ligne).toBeFocused();
  expect(await page.evaluate(() => window.choix)).toEqual([]);
});

test("REQ034_AC10_clic_ailleurs_ferme_sans_agir_dessous_puis_un_clic_normal_marche", async ({ page }) => {
  await page.evaluate(() => {
    window.cliques = 0;
    document.getElementById("ailleurs").addEventListener("click", () => window.cliques++);
  });
  await page.getByRole("treeitem", { name: "a.rs" }).click({ button: "right" });
  await page.locator("#ailleurs").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await page.evaluate(() => window.cliques)).toBe(0);
  await page.locator("#ailleurs").click();
  expect(await page.evaluate(() => window.cliques)).toBe(1);
});

test("REQ034_AC1_clic_droit_sur_une_autre_ligne_remplace_le_menu", async ({ page }) => {
  await page.getByRole("treeitem", { name: "a.rs" }).click({ button: "right" });
  // Le menu s'ouvre sous le pointeur : on vise le bord gauche de l'autre ligne, hors du menu.
  await page.getByRole("treeitem", { name: "b.rs" }).click({ button: "right", position: { x: 2, y: 8 } });
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(page.getByRole("menu", { name: "Actions sur b" })).toBeVisible();
  expect(await page.evaluate(() => window.choix)).toEqual([]);
});

test("REQ034_AC12_clic_droit_ailleurs_ferme_le_menu_sans_ouvrir_celui_de_yaide", async ({ page }) => {
  await page.getByRole("treeitem", { name: "a.rs" }).click({ button: "right" });
  await page.locator("#ailleurs").click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await page.evaluate(() => window.ouvertures)).toEqual(["a"]);
});

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
