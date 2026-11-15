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
