import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide } from "./aides.js";

let yaide;
test.afterEach(() => yaide?.arreter());

test("REQ069_AC2_AC4_AC7_replis_imposes_au_rechargement", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, ".yaide"));
  const fichier = path.join(dossier, ".yaide", "interface.json");
  fs.writeFileSync(fichier, '{ "replis": { "panneau": true } }\n');
  yaide = await lancerYaide({ dossier });
  const panneau = page.locator("aside.cadre-panneau");
  const entete = page.locator("header");
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await expect(panneau).toBeHidden();
  await expect(entete.getByRole("button", { name: "Déplier le panneau", exact: true })).toBeVisible();

  // AC-069-5 : déplié à la main, de nouveau replié au rechargement.
  await entete.getByRole("button", { name: "Déplier le panneau", exact: true }).click();
  await expect(panneau).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Nouveau shell" })).toBeVisible();
  await expect(panneau).toBeHidden();

  // AC-069-4 : deux shells, zone repliée au rechargement.
  fs.writeFileSync(fichier, '{ "replis": { "shells": true } }\n');
  await page.reload();
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await page.getByRole("tab", { name: "shell 1", exact: true }).waitFor();
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await page.getByRole("tab", { name: "shell 2", exact: true }).waitFor();
  await page.reload();
  await expect(entete.getByRole("button", { name: "Déplier les shells", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^shell \d+$/ })).toHaveCount(0);
  await entete.getByRole("button", { name: "Déplier les shells", exact: true }).click();
  await expect(page.getByRole("tab", { name: /^shell \d+$/ })).toHaveCount(2);

  // AC-069-7 : modifié dans l'éditeur, rien ne change avant le rechargement.
  await entete.getByRole("button", { name: "Ouverture rapide" }).click();
  const champ = page.getByRole("textbox", { name: "Chemin du fichier" });
  await champ.fill(".yaide/interface.json");
  await champ.press("Enter");
  await page.locator(".cm-content:visible").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type('{ "replis": { "shells": false, "panneau": false } }');
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(fichier, "utf8")).toContain('"panneau": false');
  await expect(panneau).toBeHidden();
  await expect(page.getByRole("tab", { name: /^shell \d+$/ })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("button", { name: "Nouveau shell" })).toBeVisible();
  await expect(panneau).toBeVisible();
});
