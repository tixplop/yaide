import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, nomLigne, tailleStable } from "./aides.js";
import { lancerRelais } from "./relais.js";

let yaide;
let relais;
test.beforeEach(async () => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
  relais = await lancerRelais(yaide.port);
});
test.afterEach(async () => {
  relais.fermer();
  await yaide.arreter();
});

const separateur = (page, nom) => page.getByRole("separator", { name: nom });
const valeurs = (page, nom) => separateur(page, nom).evaluate((e) => ["aria-valuenow", "aria-valuemin", "aria-valuemax"].map((a) => e.getAttribute(a)));
const boite = (page, sel) => page.locator(sel).evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

async function ouvrir(page, viewport = { width: 1000, height: 700 }) {
  await page.setViewportSize(viewport);
  await ouvrirYaide(page, relais.origine);
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
}
async function glisser(page, nom, dx, dy) {
  const p = await boite(page, `[aria-label="${nom}"]`);
  const x = p.x + p.w / 2;
  const y = p.y + p.h / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}
/** Attend que la taille choisie soit écrite dans IndexedDB. */
const gardee = (page) =>
  expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((ok) => {
            const d = indexedDB.open("yaide", 1);
            d.onsuccess = () => {
              const r = d.result.transaction("cles").objectStore("cles").get("tailles");
              r.onsuccess = () => ok(Boolean(r.result));
            };
          }),
      ),
    )
    .toBe(true);
async function taperTaille(page) {
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type("stty size");
  await page.keyboard.press("Enter");
}

test("REQ032_AC7_AC9_limites_et_valeur_des_le_premier_lancement", async ({ page }) => {
  await ouvrir(page, { width: 800, height: 480 });
  const [maintenant, min, max] = await valeurs(page, "Largeur du panneau");
  expect([min, max]).toEqual(["240", "360"]);
  expect(Number(maintenant)).toBeGreaterThanOrEqual(240);
  const s = await valeurs(page, "Hauteur des shells");
  expect([s[1], s[2]]).toEqual(["120", "299"]);
  expect(Number(s[0])).toBeGreaterThanOrEqual(120);
});

test("REQ032_AC1_AC3_AC11_glisser_le_panneau_au_dessus_du_terminal_garde_le_focus_et_le_shell_connait_sa_taille", async ({ page }) => {
  await ouvrir(page);
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  const avant = (await boite(page, ".cadre-panneau")).w;
  const tailleAvant = await tailleStable(page);
  const p = await boite(page, '[aria-label="Largeur du panneau"]');
  const x = p.x + p.w / 2;
  await page.mouse.move(x, p.y + 100);
  await page.mouse.down();
  await page.mouse.move(x + 30, 650, { steps: 6 });
  await page.mouse.move(x + 60, 650, { steps: 3 });
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe("col-resize");
  await page.mouse.up();
  expect((await boite(page, ".cadre-panneau")).w).toBeCloseTo(avant + 60, 0);
  const principal = await boite(page, ".cadre-principal");
  expect(principal.x + principal.w).toBeCloseTo((await boite(page, ".cadre-rail-droit")).x, 0);
  await expect(page.locator(".terminal:visible .xterm-helper-textarea")).toBeFocused();
  const tailleApres = await tailleStable(page);
  expect(tailleApres).not.toBe(tailleAvant);
  await taperTaille(page);
  await expect(page.locator(".terminal:visible .xterm-rows")).toContainText(tailleApres);
});

test("REQ032_AC2_AC3_glisser_les_shells_change_les_lignes_vues_par_stty", async ({ page }) => {
  await ouvrir(page);
  const h = (await boite(page, ".cadre-shells")).h;
  const tailleAvant = await tailleStable(page);
  await glisser(page, "Hauteur des shells", 0, -100);
  expect((await boite(page, ".cadre-shells")).h).toBeCloseTo(h + 100, 0);
  const tailleApres = await tailleStable(page);
  expect(tailleApres).not.toBe(tailleAvant);
  await taperTaille(page);
  await expect(page.locator(".terminal:visible .xterm-rows")).toContainText(tailleApres);
});

test("REQ032_AC5_AC12_la_taille_gardee_revient_apres_rechargement_mais_pas_celle_de_la_fenetre", async ({ page }) => {
  await ouvrir(page);
  await glisser(page, "Hauteur des shells", 0, -400);
  const choisie = (await valeurs(page, "Hauteur des shells"))[0];
  expect(choisie).toBe("519");
  await gardee(page);
  await page.setViewportSize({ width: 800, height: 480 });
  await expect.poll(async () => (await valeurs(page, "Hauteur des shells"))[0]).toBe("299");
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(async () => (await valeurs(page, "Hauteur des shells"))[0]).toBe(choisie);
  // Rétrécie puis rechargée : la taille gardée est la choisie, pas celle de la fenêtre.
  await page.setViewportSize({ width: 800, height: 480 });
  await expect.poll(async () => (await valeurs(page, "Hauteur des shells"))[0]).toBe("299");
  await page.reload();
  await page.getByRole("tab", { name: "shell 1" }).waitFor();
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(async () => (await valeurs(page, "Hauteur des shells"))[0]).toBe(choisie);
});

test("REQ032_AC14_une_taille_de_480_px_gardee_par_une_version_precedente_est_ramenee_a_360_sans_etre_reecrite", async ({ page }) => {
  await ouvrir(page);
  await page.evaluate(
    () =>
      new Promise((ok) => {
        const d = indexedDB.open("yaide", 1);
        d.onsuccess = () => {
          const t = d.result.transaction("cles", "readwrite");
          t.objectStore("cles").put({ panneau: 480 }, "tailles");
          t.oncomplete = () => ok();
        };
      }),
  );
  await page.reload();
  await page.getByRole("tab", { name: "shell 1" }).waitFor();
  await expect.poll(async () => (await valeurs(page, "Largeur du panneau"))[0]).toBe("360");
  expect(Math.round((await boite(page, ".cadre-panneau")).w)).toBe(360);
});

test("REQ032_AC5_la_largeur_du_panneau_revient_apres_rechargement", async ({ page }) => {
  await ouvrir(page);
  const sep = separateur(page, "Largeur du panneau");
  await sep.focus();
  await page.keyboard.press("ArrowRight");
  expect((await valeurs(page, "Largeur du panneau"))[0]).toBe("296");
  await gardee(page);
  await page.reload();
  await page.getByRole("tab", { name: "shell 1" }).waitFor();
  await expect.poll(async () => (await valeurs(page, "Largeur du panneau"))[0]).toBe("296");
  expect(Math.round((await boite(page, ".cadre-panneau")).w)).toBe(296);
});

test("REQ032_AC10_AC5_les_fleches_ajoutent_16_px_et_la_taille_revient_apres_rechargement", async ({ page }) => {
  await ouvrir(page);
  const sep = separateur(page, "Hauteur des shells");
  const avant = Number((await valeurs(page, "Hauteur des shells"))[0]);
  await sep.focus();
  await page.keyboard.press("ArrowUp");
  await expect(sep).toBeFocused();
  expect(Number((await valeurs(page, "Hauteur des shells"))[0])).toBe(avant + 16);
  await gardee(page);
  await page.reload();
  await page.getByRole("tab", { name: "shell 1" }).waitFor();
  await expect.poll(async () => Number((await valeurs(page, "Hauteur des shells"))[0])).toBe(avant + 16);
});

test("REQ032_AC12_le_bandeau_de_coupure_reduit_la_place_sans_effacer_la_taille_choisie", async ({ page }) => {
  await ouvrir(page, { width: 800, height: 480 });
  const sep = separateur(page, "Hauteur des shells");
  await sep.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowUp");
  expect((await valeurs(page, "Hauteur des shells"))[0]).toBe("299");
  relais.couper();
  const bandeau = page.getByRole("alert").filter({ hasText: "Connexion perdue" });
  await expect(bandeau.first()).toBeVisible({ timeout: 5000 });
  await expect.poll(async () => Number((await valeurs(page, "Hauteur des shells"))[2])).toBeLessThan(299);
  const reduite = await valeurs(page, "Hauteur des shells");
  await expect.poll(async () => (await valeurs(page, "Hauteur des shells"))[0]).toBe(reduite[2]);
  await expect.poll(async () => Math.round((await boite(page, ".cadre-shells")).h)).toBe(Number(reduite[2]));
  relais.retablir();
  await expect(bandeau).toHaveCount(0, { timeout: 10000 });
  await expect.poll(async () => (await valeurs(page, "Hauteur des shells"))[0]).toBe("299");
});

test("REQ032_AC12_la_question_d_onglet_recalcule_les_limites_puis_les_rend", async ({ page }) => {
  await ouvrir(page, { width: 800, height: 480 });
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("main.rs") }).click();
  const editeur = page.getByRole("textbox", { name: "Éditeur main.rs" });
  await expect(editeur).toBeFocused();
  const max = async () => Number((await valeurs(page, "Hauteur des shells"))[2]);
  expect(await max()).toBe(299);
  await page.keyboard.type("// moi\n");
  fs.writeFileSync(path.join(yaide.dossier, "src", "main.rs"), "// du disque\nfn main() {}\n");
  const question = page.getByRole("alert").filter({ hasText: "main.rs a changé sur le disque" });
  await expect(question).toBeVisible({ timeout: 8000 });
  await expect.poll(max).toBeLessThan(299);
  await page.getByRole("button", { name: "Prendre celle du disque" }).click();
  await expect(question).toHaveCount(0);
  await expect.poll(max).toBe(299);
});

test("REQ032_AC8_AC13_fond_au_survol_et_au_focus_epaisseur_de_4_px_curseur_pendant_le_glisse", async ({ page }) => {
  await ouvrir(page);
  const fond = (nom) => separateur(page, nom).evaluate((e) => getComputedStyle(e).backgroundColor);
  for (const [nom, curseur, dx, dy] of [["Largeur du panneau", "col-resize", 30, 0], ["Hauteur des shells", "row-resize", 0, -30]]) {
    const repos = await fond(nom);
    await separateur(page, nom).hover();
    const survol = await fond(nom);
    expect(survol).not.toBe(repos);
    await page.mouse.move(0, 0);
    await separateur(page, nom).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(separateur(page, nom)).toBeFocused();
    expect(await fond(nom)).not.toBe(repos);
    const b = await boite(page, `[aria-label="${nom}"]`);
    expect(nom === "Largeur du panneau" ? b.w : b.h).toBe(4);
    expect(await separateur(page, nom).evaluate((e) => getComputedStyle(e).cursor)).toBe(curseur);
    const x = b.x + b.w / 2;
    const y = b.y + b.h / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 3 });
    expect(await page.locator(".xterm").first().evaluate((e) => getComputedStyle(e).cursor)).toBe(curseur);
    expect(await fond(nom)).not.toBe(repos);
    await page.mouse.up();
  }
});
