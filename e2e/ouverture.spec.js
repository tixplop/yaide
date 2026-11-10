import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
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

test("REQ027_AC1_AC5_AC6_ctrl_p_main_entree_ouvre_src_main_rs", async ({ page }) => {
  await ouvrir(page);
  await page.getByRole("tab", { name: "Fichiers" }).focus();
  await page.keyboard.press("Control+p");
  await expect(dialogue(page)).toBeVisible();
  await expect(champ(page)).toBeFocused();
  await expect(dialogue(page).getByText("Tapez une partie du chemin.")).toBeVisible();
  await champ(page).fill("main");
  const option = dialogue(page).getByRole("option");
  await expect(option).toHaveCount(1);
  await expect(option).toHaveText(/src\/main\.rs/);
  await expect(champ(page)).toHaveAttribute("aria-activedescendant", (await option.getAttribute("id")) ?? "");
  await champ(page).press("Enter");
  await expect(dialogue(page)).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /main\.rs/ })).toBeVisible();
});

test("REQ027_AC3_AC7_echap_ferme_sans_ouvrir_et_rend_le_focus", async ({ page }) => {
  await ouvrir(page);
  const rail = page.getByRole("tab", { name: "Recherche" });
  await rail.focus();
  await page.keyboard.press("Control+p");
  await champ(page).fill("main");
  await page.keyboard.press("Escape");
  await expect(dialogue(page)).toHaveCount(0);
  await expect(rail).toBeFocused();
  await expect(page.getByText("Aucun fichier ouvert.")).toBeVisible();
});

test("REQ027_AC4_fichier_ignore_par_git_non_propose", async ({ page }) => {
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, ".gitignore"), "secret.txt\n");
  fs.writeFileSync(path.join(dossier, "secret.txt"), "x");
  await ouvrir(page, dossier);
  await page.keyboard.press("Control+p");
  await champ(page).fill("secret");
  await expect(dialogue(page).getByText("Aucun fichier trouvé.")).toBeVisible();
});

test("REQ027_bouton_ouvrir_un_fichier_de_l_editeur_vide", async ({ page }) => {
  await ouvrir(page);
  await page.getByRole("button", { name: "Ouvrir un fichier" }).click();
  await expect(dialogue(page)).toBeVisible();
  await expect(champ(page)).toBeFocused();
});
