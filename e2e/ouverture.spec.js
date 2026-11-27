import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { depotExemple, lancerYaide, ouvrirYaide } from "./aides.js";

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

async function ouvrir(page, dossier = depotExemple()) {
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
}
const dialogue = (page) => page.getByRole("dialog", { name: "Ouvrir un fichier" });
const champ = (page) => page.getByRole("textbox", { name: "Chemin du fichier" });

test("REQ027_bouton_ouvrir_un_fichier_de_l_editeur_vide", async ({ page }) => {
  await ouvrir(page);
  await page.getByRole("button", { name: "Ouvrir un fichier" }).click();
  await expect(dialogue(page)).toBeVisible();
  await expect(champ(page)).toBeFocused();
});

test("REQ027_AC9_la_liste_defile_au_lieu_d_entasser_ses_lignes", async ({ page }) => {
  const dossier = depotExemple();
  for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(dossier, `fichier-${String(i).padStart(2, "0")}.txt`), "x\n");
  await ouvrir(page, dossier);
  await page.keyboard.press("Control+p");
  await expect(dialogue(page)).toBeVisible();
  await champ(page).fill("fichier");
  const lignes = dialogue(page).getByRole("option");
  await expect(lignes).toHaveCount(20);
  const boites = await lignes.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  for (let i = 0; i < boites.length; i++) {
    expect(boites[i].height).toBe(24);
    if (i > 0) expect(boites[i].top - boites[i - 1].top).toBe(24);
  }
  const liste = dialogue(page).locator(".ouverture-liste");
  const dims = await liste.evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight }));
  expect(dims.s).toBeGreaterThan(dims.c);
  expect(dims.c).toBe(12 * 24);
  await liste.hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(() => liste.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await liste.evaluate((e) => { e.scrollTop = 0; });
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
  const dedans = await lignes.nth(12).evaluate((e) => {
    const r = e.getBoundingClientRect(), l = e.closest(".ouverture-liste").getBoundingClientRect();
    return r.top >= l.top && r.bottom <= l.bottom;
  });
  expect(dedans).toBe(true);
});
