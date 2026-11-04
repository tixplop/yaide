import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, nomLigne } from "./aides.js";
import { lancerRelais } from "./relais.js";

let yaide;
let relais;
let dossier;
test.beforeEach(async () => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
  dossier = yaide.dossier;
  relais = await lancerRelais(yaide.port);
});
test.afterEach(async () => {
  relais.fermer();
  await yaide.arreter();
});

const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const onglet = (page, nom) => page.getByRole("tab", { name: nom });
const editeur = (page) => page.getByRole("textbox", { name: "Éditeur main.rs" });
const bandeau = (page) => page.getByRole("alert").filter({ hasText: "Connexion perdue. Modifications gardées." });
const main = () => path.join(dossier, "src", "main.rs");
const ORIGINE = 'fn main() {\n    println!("salut");\n}\n';

async function ouvrirMain(page) {
  await ouvrirYaide(page, relais.origine);
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  await expect(editeur(page)).toBeFocused();
}
async function taper(page, texte) {
  await editeur(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(texte);
}
/** Attend que le texte gardé dans IndexedDB contienne `texte`. */
const lireGarde = (page) =>
  page.evaluate(
        () =>
          new Promise((ok) => {
            const d = indexedDB.open("yaide", 1);
            d.onsuccess = () => {
              const r = d.result.transaction("cles").objectStore("cles").get("onglets");
              r.onsuccess = () => ok(JSON.stringify(r.result?.liste ?? []));
            };
          }),
  );
const gardeContient = (page, texte) => expect.poll(() => lireGarde(page)).toContain(texte);

async function couper(page) {
  relais.couper();
  await expect(bandeau(page)).toBeVisible({ timeout: 5000 });
}
async function retablir(page) {
  relais.retablir();
  await expect(bandeau(page)).toHaveCount(0, { timeout: 10000 });
}

test("REQ015_AC2_AC6_pendant_la_coupure_on_tape_et_le_bandeau_ne_prend_pas_le_focus", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await expect(editeur(page)).toBeFocused();
  await taper(page, "// coupure\n");
  await expect(editeur(page)).toContainText("// coupure");
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
});

test("REQ015_AC4_sans_ctrl_s_le_retour_n_ecrit_rien_et_le_point_reste", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await taper(page, "// coupure\n");
  await gardeContient(page, "// coupure");
  const sonde = page.waitForResponse((r) => r.url().includes("/api/session"), { timeout: 10000 });
  await retablir(page);
  await sonde;
  expect(fs.readFileSync(main(), "utf8")).toBe(ORIGINE);
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
});

test("REQ015_AC3_AC5_AC7_ctrl_s_pendant_la_coupure_est_execute_au_retour", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await taper(page, "// attente\n");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("alert").filter({ hasText: "main.rs sera sauvegardé au retour." })).toBeVisible();
  expect(fs.readFileSync(main(), "utf8")).toBe(ORIGINE);
  await retablir(page);
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// attente");
  await expect(onglet(page, "main.rs")).toBeVisible();
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
});

test("REQ015_AC7_deux_fichiers_en_attente", async ({ page }) => {
  fs.writeFileSync(path.join(dossier, "a.txt"), "a");
  await ouvrirMain(page);
  await ligne(page, "a.txt").click();
  await expect(page.getByRole("textbox", { name: "Éditeur a.txt" })).toBeFocused();
  await couper(page);
  await page.keyboard.type("1");
  await page.keyboard.press("Control+s");
  await onglet(page, "main.rs").click();
  await page.keyboard.type("2");
  await page.keyboard.press("Control+s");
  await expect(page.getByText("2 fichiers seront sauvegardés au retour.")).toBeVisible();
  await retablir(page);
  await expect.poll(() => fs.readFileSync(path.join(dossier, "a.txt"), "utf8")).toBe("1a");
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("2fn main");
  await expect(page.getByRole("tab", { name: /non sauvegardé/ })).toHaveCount(0);
});

test("REQ015_AC3_apres_le_retour_sans_recharger_ctrl_s_ecrit_et_retire_le_point", async ({ page }) => {
  await ouvrirMain(page);
  await page.evaluate(() => (window.__sans_rechargement = true));
  await couper(page);
  await taper(page, "// tard\n");
  await retablir(page);
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
  await editeur(page).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// tard");
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
  expect(await page.evaluate(() => window.__sans_rechargement)).toBe(true);
});

test("REQ016_AC3_apres_une_sauvegarde_recharger_affiche_le_disque_sans_point", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// sauvé\n");
  await page.keyboard.press("Control+s");
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// sauvé");
  await expect.poll(async () => {
    const g = await lireGarde(page);
    return g.includes("main.rs") && !g.includes("// sauvé");
  }).toBe(true);
  await page.reload();
  await expect(onglet(page, "main.rs")).toBeVisible();
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
  await expect(editeur(page)).toContainText("// sauvé");
});

test("REQ015_AC8_pendant_la_coupure_deplier_un_dossier_est_refuse", async ({ page }) => {
  await ouvrirYaide(page, relais.origine);
  await expect(arbre(page)).toBeVisible();
  await couper(page);
  await ligne(page, "src").click();
  await expect(page.getByRole("alert").filter({ hasText: "Connexion perdue. Réessayez au retour." })).toBeVisible();
  await expect(ligne(page, "main.rs")).toHaveCount(0);
  await retablir(page);
  await expect(page.getByText("Connexion perdue. Réessayez au retour.")).toHaveCount(0, { timeout: 10000 });
});

const REFUS = "Connexion perdue. Réessayez au retour.";

test("REQ015_AC8_pendant_la_coupure_creer_renommer_supprimer_disent_de_reessayer", async ({ page }) => {
  await ouvrirYaide(page, relais.origine);
  await ligne(page, "README.md").click();
  await couper(page);
  await page.getByRole("button", { name: "Nouveau fichier" }).click();
  const dlg = page.getByRole("dialog", { name: "Nouveau fichier" });
  await dlg.getByLabel("Chemin").fill("neuf.txt");
  await page.keyboard.press("Enter");
  await expect(dlg.getByRole("alert").filter({ hasText: REFUS })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Renommer" }).click();
  const ren = page.getByRole("dialog", { name: "Renommer ou déplacer" });
  await ren.getByLabel("Nouveau chemin").fill("autre.md");
  await page.keyboard.press("Enter");
  await expect(ren.getByRole("alert").filter({ hasText: REFUS })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Supprimer" }).click();
  const sup = page.getByRole("dialog", { name: "Supprimer README.md ?" });
  await sup.getByRole("button", { name: "Supprimer" }).click();
  await expect(sup.getByRole("alert").filter({ hasText: REFUS })).toBeVisible();
  expect(fs.existsSync(path.join(dossier, "README.md"))).toBe(true);
  expect(fs.existsSync(path.join(dossier, "neuf.txt"))).toBe(false);
});

test("REQ015_AC8_pendant_la_coupure_changer_de_panneau_garde_l_arbre", async ({ page }) => {
  await ouvrirYaide(page, relais.origine);
  await expect(ligne(page, "README.md")).toBeVisible();
  await couper(page);
  await page.getByRole("tab", { name: "Recherche" }).click();
  await page.getByRole("tab", { name: "Fichiers" }).click();
  await expect(ligne(page, "README.md")).toBeVisible();
  await expect(page.getByText("Impossible de lire ce dossier")).toHaveCount(0);
});

test("REQ016_AC1_coupure_puis_retour_puis_rechargement_le_texte_est_la_et_ctrl_s_l_ecrit", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await taper(page, "// gardé\n");
  await gardeContient(page, "// gardé");
  await retablir(page);
  await page.reload();
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
  await expect(editeur(page)).toContainText("// gardé");
  await editeur(page).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// gardé");
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
});

test("REQ016_AC2_texte_tape_puis_page_fermee_sans_sauvegarder_revient_avec_son_point", async ({ browser }) => {
  const contexte = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await contexte.newPage();
  await ouvrirMain(page);
  await taper(page, "// fermé\n");
  await gardeContient(page, "// fermé");
  const etat = await contexte.storageState({ indexedDB: true });
  await contexte.close();
  const retour = await browser.newContext({ ignoreHTTPSErrors: true, storageState: etat });
  const page2 = await retour.newPage();
  await page2.goto(relais.origine + "/");
  await expect(onglet(page2, "main.rs, non sauvegardé")).toBeVisible();
  await expect(editeur(page2)).toContainText("// fermé");
  expect(fs.readFileSync(main(), "utf8")).toBe(ORIGINE);
  await retour.close();
});

test("REQ005_AC8_deconnexion_avec_du_texte_non_sauvegarde_sans_question_puis_le_texte_revient", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// avant sortie\n");
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Mot de passe").fill("mdp");
  await page.keyboard.press("Enter");
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
  await expect(editeur(page)).toContainText("// avant sortie");
  expect(fs.readFileSync(main(), "utf8")).toBe(ORIGINE);
});
