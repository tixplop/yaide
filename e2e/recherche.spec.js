import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne } from "./aides.js";

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

async function ouvrir(page, dossier) {
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
}
const rail = (page) => page.getByRole("tab", { name: "Recherche" });
const champ = (page) => page.getByRole("textbox", { name: "Rechercher" });
const resultats = (page) => page.getByRole("listbox", { name: "Résultats de la recherche" });
const chercher = async (page, texte) => {
  await champ(page).fill(texte);
  await champ(page).press("Enter");
};

/** Dépôt d'exemple avec un fichier `lib.rs` de 40 lignes dont la 30e contient `fn main`. */
function depot() {
  const dossier = depotExemple();
  const lignes = Array.from({ length: 40 }, (_, i) => (i === 29 ? "fn main_lib() {}" : `// ligne ${i + 1}`));
  fs.writeFileSync(path.join(dossier, "src", "lib.rs"), lignes.join("\n") + "\n");
  return dossier;
}

test("REQ026_AC1_AC4_AC6_AC9_REQ037_AC8_AC13_recherche_aide_resultats_groupes_resume_attente_et_retour", async ({ page }) => {
  await ouvrir(page, depot());
  await test.step("REQ026_AC1_AC6_clic_sur_R_focus_dans_le_champ_aide_puis_resultats_groupes", async () => {
    await rail(page).click();
    await expect(page.getByRole("heading", { name: "Recherche" })).toBeVisible();
    await expect(champ(page)).toBeFocused();
    await expect(page.getByText("Entrée pour chercher.")).toBeVisible();
    await chercher(page, "FN MAIN");
    const l = resultats(page);
    await expect(l.getByRole("option")).toHaveCount(2);
    const g = l.locator(".liste-groupe");
    await expect(g).toHaveCount(2);
    await expect(g.nth(0)).toContainText("lib.rs");
    await expect(g.nth(0).locator(".liste-parent")).toHaveText("src");
    await expect(g.nth(1)).toContainText("main.rs");
    await expect(g.nth(1).locator(".liste-parent")).toHaveText("src");
    await expect(l.getByRole("option").nth(0).locator(".liste-numero")).toHaveText("30");
    await expect(l.getByRole("option").nth(0).locator(".liste-libelle")).toHaveText("fn main_lib() {}");
    await expect(l.getByRole("option").nth(1).locator(".liste-numero")).toHaveText("1");
    await expect(l.getByRole("option").nth(1).locator(".liste-libelle")).toHaveText("fn main() {");
    await expect(l.locator("mark").first()).toHaveText("fn main");
    await expect(page.getByText("Entrée pour chercher.")).toHaveCount(0);
  });
  await page.reload();
  await expect(rail(page)).toBeVisible();
  await test.step("REQ037_AC8_AC13_resume_groupes_avec_dossier_et_compteur_non_selectionnables", async () => {
    await rail(page).click();
    await expect(page.getByText(/résultats? dans/)).toHaveCount(0);
    await chercher(page, "fn main");
    await expect(page.getByText("2 résultats dans 2 fichiers")).toBeVisible();
    const groupes = resultats(page).locator(".liste-groupe");
    await expect(groupes).toHaveCount(2);
    await expect(groupes.first()).toContainText("lib.rs");
    await expect(groupes.first().locator(".liste-parent")).toHaveText("src");
    await expect(groupes.first().locator(".ya-badge")).toHaveText("1");
    await groupes.first().click();
    await expect(resultats(page).locator("[aria-selected=true]")).toHaveCount(0);
    await expect(resultats(page).getByRole("option")).toHaveCount(2);
  });
  await page.reload();
  await expect(rail(page)).toBeVisible();
  await test.step("REQ026_AC6_recherche_en_cours_pendant_l_attente", async () => {
    let liberer;
    const barriere = new Promise((r) => (liberer = r));
    await page.route("**/api/recherche*", async (route) => {
      await barriere;
      await route.continue();
    });
    await rail(page).click();
    await chercher(page, "fn main");
    await expect(page.getByText("Recherche en cours…")).toBeVisible();
    liberer();
    await expect(resultats(page).getByRole("option")).toHaveCount(2);
    await expect(page.getByText("Recherche en cours…")).toHaveCount(0);
    await page.unroute("**/api/recherche*");
  });
  await page.reload();
  await expect(rail(page)).toBeVisible();
  await test.step("REQ026_AC4_AC9_aucun_resultat_focus_dans_le_champ_et_recherche_gardee_au_retour", async () => {
    await rail(page).click();
    await chercher(page, "fn mian");
    await expect(page.getByText("Aucun résultat")).toBeVisible();
    await expect(champ(page)).toBeFocused();
    await champ(page).fill("fn main");
    await champ(page).press("Enter");
    await expect(resultats(page).getByRole("option")).toHaveCount(2);
    await page.getByRole("tab", { name: "Fichiers" }).click();
    await expect(champ(page)).toBeHidden();
    await rail(page).click();
    await expect(champ(page)).toHaveValue("fn main");
    await expect(resultats(page).getByRole("option")).toHaveCount(2);
  });
});

test("REQ026_AC2_clic_sur_un_resultat_ouvre_le_fichier_a_la_ligne_et_focus_dans_l_editeur", async ({ page }) => {
  await ouvrir(page, depot());
  await rail(page).click();
  await chercher(page, "fn main_lib");
  await resultats(page).getByRole("option").first().click();
  await expect(page.getByRole("tab", { name: "lib.rs" })).toHaveAttribute("aria-selected", "true");
  const editeur = page.getByLabel("Éditeur lib.rs");
  await expect(editeur).toBeFocused();
  await expect(editeur.locator(".cm-activeLine")).toHaveText("fn main_lib() {}");
});

test("REQ026_AC5_AC7_plus_de_500_resultats_gardent_500_et_le_disent", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "gros.txt"), "motrare\n".repeat(501));
  await ouvrir(page, dossier);
  await rail(page).click();
  await chercher(page, "motrare");
  await expect(page.getByText("500 premiers résultats. Précisez votre recherche.")).toBeVisible();
  await expect(resultats(page).getByRole("option")).toHaveCount(500);
});

test("REQ026_AC8_clavier_champ_liste_et_ouverture", async ({ page }) => {
  await ouvrir(page, depot());
  await rail(page).click();
  await chercher(page, "fn main");
  const options = resultats(page).getByRole("option");
  await expect(options).toHaveCount(2);
  await champ(page).press("ArrowDown");
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toBeFocused();
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "lib.rs" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Éditeur lib.rs")).toBeFocused();
  await expect(page.getByLabel("Éditeur lib.rs").locator(".cm-activeLine")).toHaveText("fn main_lib() {}");
});

test("REQ026_AC2_fichier_deja_ouvert_va_a_la_ligne", async ({ page }) => {
  await ouvrir(page, depot());
  await page.getByRole("tree").getByText("src").first().click();
  await page.getByRole("treeitem", { name: /lib\.rs/ }).click();
  await expect(page.getByLabel("Éditeur lib.rs")).toBeFocused();
  await rail(page).click();
  await chercher(page, "fn main_lib");
  await resultats(page).getByRole("option").first().click();
  await expect(page.getByLabel("Éditeur lib.rs").locator(".cm-activeLine")).toHaveText("fn main_lib() {}");
  await expect(page.getByRole("tab", { name: /lib\.rs/ })).toHaveCount(1);
});

test("REQ008_AC7_lecture_tardive_depuis_la_recherche_ne_reprend_pas_l_onglet_actif", async ({ page }) => {
  await ouvrir(page, depot());
  await page.getByRole("tree").getByText("src").first().click();
  await page.getByRole("treeitem", { name: nomLigne("main.rs") }).click();
  await expect(page.getByRole("tab", { name: "main.rs" })).toHaveAttribute("aria-selected", "true");
  let liberer;
  const porte = new Promise((r) => (liberer = r));
  await page.route("**/api/fichier?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("chemin") === "src/lib.rs") await porte;
    await route.continue();
  });
  await rail(page).click();
  await chercher(page, "fn main_lib");
  await resultats(page).getByRole("option").first().click();
  await page.getByRole("tab", { name: "main.rs" }).click();
  await expect(page.getByLabel("Éditeur main.rs")).toBeFocused();
  liberer();
  await expect(page.getByRole("tab", { name: "lib.rs" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "main.rs" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Éditeur main.rs")).toBeFocused();
});
