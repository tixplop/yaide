import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide } from "./aides.js";
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
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nom, exact: true });
const onglet = (page, nom) => page.getByRole("tab", { name: nom });
const editeur = (page) => page.getByRole("textbox", { name: "Éditeur main.rs" });
const question = (page) => page.getByRole("alert").filter({ hasText: "main.rs a changé sur le disque. Quelle version garder ?" });
const garderMa = (page) => page.getByRole("button", { name: "Garder ma version" });
const prendre = (page) => page.getByRole("button", { name: "Prendre celle du disque" });
const main = () => path.join(dossier, "src", "main.rs");
const DISQUE = "// du disque\nfn main() {}\n";
const bandeau = (page) => page.getByRole("alert").filter({ hasText: "Connexion perdue. Modifications gardées." });

async function ouvrirMain(page, dejaConnecte = false) {
  if (dejaConnecte) await page.goto(relais.origine + "/");
  else await ouvrirYaide(page, relais.origine);
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  await expect(editeur(page)).toBeFocused();
}
async function taper(page, texte) {
  await editeur(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(texte);
}
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

test("REQ017_AC1_fichier_sans_modification_change_sur_le_disque_affiche_le_nouveau_contenu", async ({ page }) => {
  await ouvrirMain(page);
  fs.writeFileSync(main(), DISQUE);
  await expect(editeur(page)).toContainText("// du disque", { timeout: 8000 });
  await expect(question(page)).toHaveCount(0);
  await expect(onglet(page, "main.rs")).toBeVisible();
});

test("REQ017_AC1_le_curseur_reste_sur_la_meme_ligne_au_rechargement", async ({ page }) => {
  await ouvrirMain(page);
  await page.keyboard.press("Control+End"); // dernière ligne vide, ligne 4
  fs.writeFileSync(main(), "1\n2\n3\n4\n5\n");
  await expect(editeur(page)).toContainText("5", { timeout: 8000 });
  await page.keyboard.type("Z");
  await expect(page.locator(".cm-line").nth(3)).toHaveText("Z4");
});

test("REQ017_AC10_le_focus_reste_dans_le_terminal_quand_la_question_apparait", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// moi\n");
  const focusDansTerminal = () => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea"));
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  expect(await focusDansTerminal()).toBe(true);
  fs.writeFileSync(main(), DISQUE);
  await expect(question(page)).toBeVisible({ timeout: 8000 });
  expect(await focusDansTerminal()).toBe(true);
  await expect(onglet(page, "main.rs, non sauvegardé, question en attente")).toContainText("!");
});

test("REQ017_AC1_un_changement_de_date_seule_ne_change_rien", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// moi\n");
  const futur = new Date(Date.now() + 60000);
  fs.utimesSync(main(), futur, futur);
  await page.waitForResponse((r) => r.url().includes("/api/fichiers/versions"));
  await page.waitForResponse((r) => r.url().includes("/api/fichiers/versions"));
  await expect(question(page)).toHaveCount(0);
  await expect(editeur(page)).toContainText("// moi");
});

test("REQ017_AC2_AC10_AC11_fichier_modifie_change_sur_le_disque_pose_la_question_sans_prendre_le_focus", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// moi\n");
  fs.writeFileSync(main(), DISQUE);
  await expect(question(page)).toBeVisible({ timeout: 8000 });
  await expect(garderMa(page)).toBeVisible();
  await expect(prendre(page)).toBeVisible();
  await expect(editeur(page)).toBeFocused();
  await expect(onglet(page, "main.rs, non sauvegardé, question en attente")).toBeVisible();
  await expect(onglet(page, "main.rs, non sauvegardé, question en attente")).toContainText("!");
});

test("REQ017_AC3_garder_sa_version_garde_le_texte_et_ctrl_s_ecrase_sans_redemander", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// moi\n");
  fs.writeFileSync(main(), DISQUE);
  await garderMa(page).click({ timeout: 8000 });
  await expect(question(page)).toHaveCount(0);
  await expect(editeur(page)).toContainText("// moi");
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
  await editeur(page).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// moi");
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);
});

test("REQ017_AC4_prendre_celle_du_disque_affiche_le_disque_sans_point", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// moi\n");
  fs.writeFileSync(main(), DISQUE);
  await prendre(page).click({ timeout: 8000 });
  await expect(question(page)).toHaveCount(0);
  await expect(editeur(page)).toContainText("// du disque");
  await expect(editeur(page)).not.toContainText("// moi");
  await expect(onglet(page, "main.rs")).toBeVisible();
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
});

test("REQ017_AC5_changement_pendant_la_coupure_la_question_est_posee_au_retour", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await taper(page, "// moi\n");
  await gardeContient(page, "// moi");
  fs.writeFileSync(main(), DISQUE);
  await retablir(page);
  await expect(question(page)).toBeVisible({ timeout: 8000 });
  expect(fs.readFileSync(main(), "utf8")).toBe(DISQUE);
});

test("REQ017_AC6_ctrl_s_en_attente_et_fichier_change_la_question_est_posee_sans_ecraser", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await taper(page, "// moi\n");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("alert").filter({ hasText: "main.rs sera sauvegardé au retour." })).toBeVisible();
  fs.writeFileSync(main(), DISQUE);
  await retablir(page);
  await expect(question(page)).toBeVisible({ timeout: 8000 });
  expect(fs.readFileSync(main(), "utf8")).toBe(DISQUE);
  await expect(page.getByRole("alert").filter({ hasText: "sera sauvegardé au retour." })).toHaveCount(0);
});

test("REQ017_AC5_brouillon_restaure_garde_sa_version_de_base", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// moi\n");
  await gardeContient(page, "// moi");
  await page.goto("about:blank");
  fs.writeFileSync(main(), DISQUE);
  await page.goto(relais.origine + "/");
  await expect(question(page)).toBeVisible({ timeout: 10000 });
  await expect(editeur(page)).toContainText("// moi");
  expect(fs.readFileSync(main(), "utf8")).toBe(DISQUE);
});

test("REQ017_AC7_deux_onglets_du_navigateur_sans_modification_l_autre_affiche_le_nouveau_contenu", async ({ page, context }) => {
  await ouvrirMain(page);
  const page2 = await context.newPage();
  await ouvrirMain(page2, true);
  await taper(page, "// ecrit\n");
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// ecrit");
  await expect(editeur(page2)).toContainText("// ecrit", { timeout: 8000 });
  await expect(question(page2)).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);
});

test("REQ017_AC8_deux_onglets_du_navigateur_modifies_l_autre_demande_quelle_version_garder", async ({ page, context }) => {
  await ouvrirMain(page);
  const page2 = await context.newPage();
  await ouvrirMain(page2, true);
  await taper(page2, "// autre\n");
  await taper(page, "// ecrit\n");
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// ecrit");
  await expect(question(page2)).toBeVisible({ timeout: 8000 });
  await expect(editeur(page2)).toContainText("// autre");
  await expect(question(page)).toHaveCount(0);
});

test("REQ017_AC9_AC13_fichier_supprime_hors_de_yaide_garde_l_onglet_et_ctrl_s_le_recree", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// reste\n");
  fs.rmSync(main());
  const msg = page.getByRole("alert").filter({ hasText: "Fichier supprimé du disque. Ctrl+S le recrée." });
  await expect(msg).toBeVisible({ timeout: 8000 });
  await expect(editeur(page)).toContainText("// reste");
  await editeur(page).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.existsSync(main())).toBe(true);
  expect(fs.readFileSync(main(), "utf8")).toContain("// reste");
  await expect(msg).toHaveCount(0);
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
});

test("REQ017_AC12_question_en_attente_ctrl_s_et_fermeture_n_ecrivent_ni_ne_ferment", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// moi\n");
  fs.writeFileSync(main(), DISQUE);
  await expect(question(page)).toBeVisible({ timeout: 8000 });
  await editeur(page).click();
  await page.keyboard.press("Control+s");
  await expect(garderMa(page)).toBeFocused();
  expect(fs.readFileSync(main(), "utf8")).toBe(DISQUE);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Fermeture depuis un autre onglet actif : l'onglet de la question devient actif.
  await ligne(page, "README.md").click();
  await expect(question(page)).toHaveCount(0);
  await page.getByRole("button", { name: /Fermer main\.rs/ }).click();
  await expect(question(page)).toBeVisible();
  await expect(garderMa(page)).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(onglet(page, "main.rs, non sauvegardé, question en attente")).toBeVisible();
});
