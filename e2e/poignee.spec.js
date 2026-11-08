import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

let dossier;

test.beforeAll(async () => {
  mkdirSync(resolve(process.env.TMPDIR ?? ".test-data"), { recursive: true });
  dossier = mkdtempSync(resolve(process.env.TMPDIR ?? ".test-data", "poignee-"));
  writeFileSync(
    resolve(dossier, "entree.js"),
    `import { terminal } from ${JSON.stringify(resolve("web/src/ui/terminal.js"))};
import { cadre } from ${JSON.stringify(resolve("web/src/ui/cadre.js"))};
import { borner, limites } from ${JSON.stringify(resolve("web/src/ui/poignee.js"))};
window.monter = (avecTailles = true) => {
  window.tailles = [];
  window.fins = [];
  const t = terminal({ flux: Object.assign(new EventTarget(), { send() {} }), nom: "Shell 1", surTaille: (c, l) => window.tailles.push([c, l]) });
  const code = document.createElement("div");
  code.textContent = "code";
  const choisies = avecTailles ? { panneau: 240, shells: 200 } : {};
  const c = cadre({
    barreTitre: { projet: "p" }, rail: { onglets: "rail" },
    panneau: { titre: "Fichiers", corps: document.createElement("p") },
    principal: { code, shells: t },
    tailles: avecTailles ? { ...choisies } : undefined,
    surChangement: (zone, taille) => { choisies[zone] = taille; c.definirTailles({ [zone]: taille }); },
    surFin: (zone, taille) => window.fins.push([zone, taille]),
  });
  const recalculer = () => {
    const l = limites({ L: innerWidth, H: innerHeight });
    for (const zone of ["panneau", "shells"]) c.poignees[zone].definir(l[zone]);
    const bornees = {};
    for (const zone of ["panneau", "shells"]) if (choisies[zone] !== undefined) bornees[zone] = borner(choisies[zone], l[zone]);
    c.definirTailles(bornees);
    c.mesurer();
  };
  addEventListener("resize", recalculer);
  document.body.append(c);
  recalculer();
  t.ajuster();
  return t;
};`,
  );
  await build({ entryPoints: [resolve(dossier, "entree.js")], bundle: true, outfile: resolve(dossier, "page.js") });
  copyFileSync("web/src/ui/tokens.css", resolve(dossier, "tokens.css"));
  copyFileSync("web/src/ui/composants.css", resolve(dossier, "composants.css"));
  writeFileSync(
    resolve(dossier, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="composants.css"><link rel="stylesheet" href="page.css"></head><body><script src="page.js"></script></body></html>`,
  );
});

async function ouvrir(page, taille = { width: 1000, height: 700 }, avecTailles = true) {
  await page.setViewportSize(taille);
  await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
  await page.evaluate((a) => window.monter(a), avecTailles);
}
// Attend que le terminal ait fini de s'ajuster (police chargée) : colonnes et lignes égales à celles que sa zone permet.
const stable = (page) =>
  expect
    .poll(() =>
      page.evaluate(() => {
        const t = document.querySelector(".terminal");
        const zone = t.querySelector(".terminal-zone");
        const c = t.term._core._renderService.dimensions.css.cell;
        const d = zone.querySelector(".xterm-viewport");
        const barre = d ? d.offsetWidth - d.clientWidth : 0;
        const cols = Math.max(2, Math.floor((zone.clientWidth - barre) / c.width));
        const rows = Math.max(1, Math.floor(zone.clientHeight / c.height));
        const dernier = window.tailles.at(-1);
        return !!c.width && t.term.cols === cols && t.term.rows === rows && !!dernier && dernier[0] === cols && dernier[1] === rows;
      }),
    )
    .toBe(true);
const boite = async (page, sel) => page.locator(sel).evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const valeurs = (page, nom) =>
  page.getByRole("separator", { name: nom }).evaluate((e) => ["aria-valuenow", "aria-valuemin", "aria-valuemax"].map((a) => e.getAttribute(a)));

test("REQ032_AC9_limites_affichees_a_800_par_480", async ({ page }) => {
  await ouvrir(page, { width: 800, height: 480 });
  expect(await valeurs(page, "Largeur du panneau")).toEqual(["240", "240", "360"]);
  expect(await valeurs(page, "Hauteur des shells")).toEqual(["200", "120", "299"]);
});

test("REQ032_AC1_glisse_la_poignee_du_panneau_au_dessus_du_terminal_sans_perdre_le_focus", async ({ page }) => {
  await ouvrir(page);
  await stable(page);
  await page.locator(".xterm-helper-textarea").focus();
  const p = await boite(page, '[aria-label="Largeur du panneau"]');
  const avant = await boite(page, ".cadre-panneau");
  const colsAvant = await page.evaluate(() => document.querySelector(".terminal").term.cols);
  const x0 = p.x + p.w / 2;
  const y0 = p.y + 100;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  // le pointeur traverse l'éditeur puis le terminal
  await page.mouse.move(x0 + 100, y0 + 50, { steps: 5 });
  await page.mouse.move(x0 + 100, 650, { steps: 5 });
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe("col-resize");
  expect(await page.locator(".xterm").evaluate((e) => getComputedStyle(e).cursor)).toBe("col-resize");
  await page.mouse.up();
  const apres = await boite(page, ".cadre-panneau");
  expect(apres.w).toBeCloseTo(avant.w + 100, 0);
  const principal = await boite(page, ".cadre-principal");
  const railDroit = await boite(page, ".cadre-rail-droit");
  expect(principal.x + principal.w).toBeCloseTo(railDroit.x, 0);
  expect(railDroit.x + railDroit.w).toBeCloseTo(1000, 0);
  expect(await page.evaluate(() => document.activeElement.className)).toBe("xterm-helper-textarea");
  // Un seul instant : colonnes du terminal, colonnes attendues pour la largeur finale, dernière taille notifiée.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const t = document.querySelector(".terminal");
        const zone = t.querySelector(".terminal-zone");
        const defilement = zone.querySelector(".xterm-viewport");
        const barre = defilement ? defilement.offsetWidth - defilement.clientWidth : 0;
        const attendu = Math.max(2, Math.floor((zone.clientWidth - barre) / t.term._core._renderService.dimensions.css.cell.width));
        return [t.term.cols === attendu, t.term.cols === window.tailles.at(-1)[0]];
      }),
    )
    .toEqual([true, true]);
  expect(await page.evaluate(() => document.querySelector(".terminal").term.cols)).toBeLessThan(colsAvant);
  expect(await valeurs(page, "Largeur du panneau")).toEqual(["340", "240", "360"]);
  expect(await page.evaluate(() => window.fins)).toEqual([["panneau", 340]]);
});

test("REQ032_AC2_AC3_glisse_la_poignee_des_shells_le_terminal_change_de_lignes", async ({ page }) => {
  await ouvrir(page);
  await stable(page);
  const lignes = () => page.evaluate(() => document.querySelector(".terminal").term.rows);
  const avant = await lignes();
  const p = await boite(page, '[aria-label="Hauteur des shells"]');
  const hAvant = (await boite(page, ".cadre-shells")).h;
  await page.mouse.move(p.x + 300, p.y + p.h / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + 300, p.y + p.h / 2 - 120, { steps: 5 });
  await page.mouse.up();
  expect((await boite(page, ".cadre-shells")).h).toBeCloseTo(hAvant + 120, 0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const t = document.querySelector(".terminal");
        const zone = t.querySelector(".terminal-zone");
        const attendu = Math.max(1, Math.floor(zone.clientHeight / t.term._core._renderService.dimensions.css.cell.height));
        return [t.term.rows === attendu, t.term.rows === window.tailles.at(-1)[1]];
      }),
    )
    .toEqual([true, true]);
  expect(await lignes()).toBeGreaterThan(avant);
  expect(await valeurs(page, "Hauteur des shells")).toEqual(["320", "120", "519"]);
});

test("REQ032_AC4_la_poignee_s_arrete_aux_limites", async ({ page }) => {
  await ouvrir(page, { width: 800, height: 480 });
  const p = await boite(page, '[aria-label="Largeur du panneau"]');
  await page.mouse.move(p.x + p.w / 2, p.y + 100);
  await page.mouse.down();
  await page.mouse.move(790, p.y + 100, { steps: 4 });
  await page.mouse.up();
  expect((await boite(page, ".cadre-principal")).w).toBeGreaterThanOrEqual(320);
  expect(await valeurs(page, "Largeur du panneau")).toEqual(["360", "240", "360"]);
});

test("REQ032_AC10_AC13_fleches_pas_de_16_focus_gardé_et_poignee_de_4_px", async ({ page }) => {
  await ouvrir(page);
  const sep = page.getByRole("separator", { name: "Hauteur des shells" });
  await sep.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  expect((await valeurs(page, "Hauteur des shells"))[0]).toBe("216");
  await expect(sep).toBeFocused();
  const b = await boite(page, '[aria-label="Hauteur des shells"]');
  expect(b.h).toBe(4);
  const haut = await boite(page, ".cadre-code");
  expect(haut.y + haut.h).toBeLessThanOrEqual(b.y);
  expect(await sep.evaluate((e) => getComputedStyle(e).cursor)).toBe("row-resize");
  expect(await page.getByRole("separator", { name: "Largeur du panneau" }).evaluate((e) => getComputedStyle(e).cursor)).toBe("col-resize");
});

test("REQ032_AC12_la_fenetre_retrecie_puis_rendue_rend_la_taille_choisie", async ({ page }) => {
  await ouvrir(page, { width: 1000, height: 700 });
  await page.getByRole("separator", { name: "Hauteur des shells" }).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowUp");
  expect((await valeurs(page, "Hauteur des shells"))[0]).toBe("519");
  await page.setViewportSize({ width: 800, height: 480 });
  await expect.poll(async () => (await valeurs(page, "Hauteur des shells"))[0]).toBe("299");
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(async () => (await valeurs(page, "Hauteur des shells"))[0]).toBe("519");
  // seule une flèche ou un glissé fait garder une taille
  expect(await page.evaluate(() => window.fins.at(-1))).toEqual(["shells", 519]);
  expect(await page.evaluate(() => window.fins.length)).toBe(20);
});

test("REQ032_AC1_AC7_AC10_sans_taille_choisie_la_valeur_de_depart_est_la_taille_mesuree", async ({ page }) => {
  await ouvrir(page, { width: 1000, height: 700 }, false);
  expect(await valeurs(page, "Largeur du panneau")).toEqual(["280", "240", "360"]);
  expect((await valeurs(page, "Hauteur des shells"))[0]).toBe("225");
  // flèche
  await page.getByRole("separator", { name: "Largeur du panneau" }).focus();
  await page.keyboard.press("ArrowRight");
  expect((await valeurs(page, "Largeur du panneau"))[0]).toBe("296");
  expect((await boite(page, ".cadre-panneau")).w).toBe(296);
  expect(await page.evaluate(() => window.fins)).toEqual([["panneau", 296]]);
  // glissé de la poignée des shells, jamais choisie
  const p = await boite(page, '[aria-label="Hauteur des shells"]');
  await page.mouse.move(p.x + 300, p.y + p.h / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + 300, p.y + p.h / 2 - 55, { steps: 4 });
  await page.mouse.up();
  expect((await valeurs(page, "Hauteur des shells"))[0]).toBe("280");
  expect((await boite(page, ".cadre-shells")).h).toBe(280);
  expect(await page.evaluate(() => window.fins.at(-1))).toEqual(["shells", 280]);
});

test("REQ032_AC12_un_clic_sans_mouvement_ne_garde_aucune_taille", async ({ page }) => {
  await ouvrir(page);
  const p = await boite(page, '[aria-label="Largeur du panneau"]');
  await page.mouse.click(p.x + p.w / 2, p.y + 100);
  expect(await page.evaluate(() => window.fins)).toEqual([]);
});
