import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne, avancer } from "./aides.js";

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

const g = (dossier, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd: dossier, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} : ${r.stderr}`);
  return r.stdout;
};

async function ouvrir(page, dossier = depotExemple()) {
  g(dossier, "branch", "-M", "main");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
  return dossier;
}
const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const rail = (page, nom) => page.getByRole("tab", { name: nom });
const barre = (page) => page.locator("footer");
const ecran = (page) => page.locator(".terminal:visible .xterm-rows");
const taper = async (page, commande) => {
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type(commande);
  await page.keyboard.press("Enter");
};
const A_PEINE = { timeout: 5000 };

test("REQ045_AC1_un_fichier_cree_ou_supprime_dans_un_shell_apparait_ou_disparait_dossier_deplie_compris", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "src").click();
  await expect(ligne(page, "main.rs")).toBeVisible();
  await taper(page, "touch nouveau.txt src/lib.rs");
  await expect(async () => {
    await expect(ligne(page, "nouveau.txt")).toBeVisible({ timeout: 500 });
    await expect(ligne(page, "lib.rs")).toBeVisible({ timeout: 500 });
  }).toPass(A_PEINE);
  await taper(page, "rm nouveau.txt src/lib.rs");
  await expect(async () => {
    await expect(ligne(page, "nouveau.txt")).toHaveCount(0, { timeout: 500 });
    await expect(ligne(page, "lib.rs")).toHaveCount(0, { timeout: 500 });
  }).toPass(A_PEINE);
});

test("REQ045_AC2_un_fichier_ouvert_modifie_hors_de_Yaide_porte_M_son_onglet_prend_la_couleur_de_M_et_le_compteur_change", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  const onglet = page.getByRole("tab", { name: /^main\.rs/ });
  await expect(onglet).toBeVisible();
  fs.appendFileSync(path.join(dossier, "src", "main.rs"), "// plus\n");
  await expect(async () => {
    await expect(ligne(page, "main.rs").locator(".liste-statut")).toHaveText("M", { timeout: 500 });
    await expect(page.locator(".onglet-statut-M")).toBeVisible({ timeout: 500 });
    await expect(rail(page, "Git").locator(".ya-badge")).toHaveText("1", { timeout: 500 });
  }).toPass(A_PEINE);
  // Panneau Git affiché : le compteur suit aussi.
  await rail(page, "Git").click();
  fs.writeFileSync(path.join(dossier, "README.md"), "# Autre\n");
  await expect(async () => {
    await expect(rail(page, "Git").locator(".ya-badge")).toHaveText("2", { timeout: 500 });
  }).toPass(A_PEINE);
});

test("REQ045_AC3_git_switch_puis_git_add_suivent_sans_changer_de_panneau", async ({ page }) => {
  const dossier = await ouvrir(page);
  fs.writeFileSync(path.join(dossier, "neuf.txt"), "x\n");
  await rail(page, "Git").click();
  const changements = page.getByRole("listbox", { name: "Changements" });
  await expect(changements.getByRole("option", { name: nomLigne("neuf.txt") })).toBeVisible();
  g(dossier, "switch", "-c", "essai");
  await expect(async () => {
    await expect(barre(page)).toContainText("essai", { timeout: 500 });
    await expect(page.getByRole("combobox", { name: "Branche" })).toHaveValue("essai", { timeout: 500 });
  }).toPass(A_PEINE);
  g(dossier, "add", "neuf.txt");
  await expect(async () => {
    await expect(page.locator(".liste-groupe", { hasText: "Modifications indexées" })).toBeVisible({ timeout: 500 });
  }).toPass(A_PEINE);
  await expect(page.getByRole("heading", { name: "Git" })).toBeVisible();
});

test("REQ045_AC4_git_init_dans_un_dossier_sans_depot_remplace_le_message_par_la_branche", async ({ page }) => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR ?? ".test-data", "sansgit-"));
  fs.writeFileSync(path.join(dossier, "a.txt"), "a\n");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
  await rail(page, "Git").click();
  await expect(page.getByText("Ce dossier n'est pas un dépôt git.")).toBeVisible();
  g(dossier, "init", "-q", "-b", "principale");
  await expect(async () => {
    await expect(page.getByText("Ce dossier n'est pas un dépôt git.")).toHaveCount(0, { timeout: 500 });
    await expect(page.getByRole("combobox", { name: "Branche" })).toBeVisible({ timeout: 500 });
  }).toPass(A_PEINE);
});

test("REQ045_AC5_le_defilement_de_l_arbre_et_la_frappe_dans_le_terminal_ne_sont_pas_derangees", async ({ page }) => {
  await page.clock.install();
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "gros"));
  for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(dossier, "gros", `f${String(i).padStart(3, "0")}.txt`), "");
  await ouvrir(page, dossier);
  await ligne(page, "gros").click();
  await expect(ligne(page, "f199.txt")).toBeAttached();
  const defile = await page.locator("aside.cadre-panneau .cadre-panneau-corps").evaluate((e) => {
    e.scrollTop = 1500;
    return e.scrollTop;
  });
  expect(defile).toBeGreaterThan(0);
  await taper(page, "touch gros/zz.txt");
  await avancer(page, () => expect(ligne(page, "zz.txt")).toBeAttached({ timeout: 300 }), { pas: 3000 });
  expect(await page.locator("aside.cadre-panneau .cadre-panneau-corps").evaluate((e) => e.scrollTop)).toBe(defile);
  // Frappe qui continue d'arriver dans le terminal pendant les relectures.
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type("echo abc");
  fs.writeFileSync(path.join(dossier, "pendant.txt"), "");
  await avancer(page, () => expect(ligne(page, "pendant.txt")).toBeAttached({ timeout: 300 }), { pas: 3000 }); // une relecture a eu lieu pendant la frappe
  await page.keyboard.type("def");
  await page.keyboard.press("Enter");
  await expect(ecran(page)).toContainText("abcdef");
  expect(await page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea"))).toBe(true);
  // Focus dans l'éditeur : il le garde pendant une relecture qui apporte un changement.
  await page.getByRole("treeitem", { name: nomLigne("README.md") }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("Z");
  fs.writeFileSync(path.join(dossier, "autre.txt"), "");
  await avancer(page, () => expect(ligne(page, "autre.txt")).toBeAttached({ timeout: 300 }), { pas: 3000 });
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.keyboard.type("Y");
  await expect(page.locator(".cm-content")).toContainText("ZY");
});
