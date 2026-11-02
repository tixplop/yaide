import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide } from "./aides.js";

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

/** Dépôt d'exemple avec un dossier ignoré, un binaire, un gros fichier et quelques fichiers à gérer. */
async function demarrer() {
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, ".gitignore"), "target/\n");
  fs.mkdirSync(path.join(dossier, "target"));
  fs.writeFileSync(path.join(dossier, "target", "out.txt"), "x");
  fs.mkdirSync(path.join(dossier, "Zeta"));
  fs.writeFileSync(path.join(dossier, "Zeta", "z.txt"), "z");
  fs.writeFileSync(path.join(dossier, "notes.txt"), "notes");
  fs.writeFileSync(path.join(dossier, "a.txt"), "a");
  fs.writeFileSync(path.join(dossier, "b.txt"), "b");
  fs.writeFileSync(path.join(dossier, "notes.bin"), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(dossier, "gros.log"), Buffer.alloc(5 * 1024 * 1024 + 1, 97));
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  return dossier;
}
const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nom, exact: true });
const ouvrir = async (page) => {
  const dossier = await demarrer();
  await ouvrirYaide(page, yaide.origine);
  await expect(arbre(page)).toBeVisible();
  return dossier;
};

test("REQ007_AC1_et_AC3_et_AC8_arbre_deplie_et_replie_dossiers_d_abord_sans_git", async ({ page }) => {
  await ouvrir(page);
  const noms = await arbre(page).getByRole("treeitem").evaluateAll((l) => l.map((e) => e.textContent.replace(/^[▾▸]/, "")));
  expect(noms).toEqual(["src", "target", "Zeta", ".gitignore", "a.txt", "b.txt", "gros.log", "notes.bin", "notes.txt", "README.md"]);
  await expect(ligne(page, "main.rs")).toHaveCount(0);
  await ligne(page, "src").click();
  await expect(ligne(page, "src")).toHaveAttribute("aria-expanded", "true");
  await expect(ligne(page, "main.rs")).toBeVisible();
  await ligne(page, "src").click();
  await expect(ligne(page, "main.rs")).toHaveCount(0);
});

test("REQ007_AC2_et_AC6_dossier_ignore_grise_en_italique_avec_nom_accessible", async ({ page }) => {
  await ouvrir(page);
  const cible = page.getByRole("treeitem", { name: "target, ignoré par git" });
  await expect(cible).toBeVisible();
  await expect(cible).toHaveCSS("font-style", "italic");
  await expect(cible).toHaveClass(/liste-attenuee/);
  await cible.click();
  const contenu = page.getByRole("treeitem", { name: "out.txt, ignoré par git" });
  await expect(contenu).toBeVisible();
  await expect(contenu).toHaveCSS("font-style", "italic");
  await expect(contenu).toHaveClass(/liste-attenuee/);
  await expect(ligne(page, "src")).not.toHaveClass(/liste-attenuee/);
  await expect(ligne(page, "src")).toHaveCSS("font-style", "normal");
});

test("REQ007_AC4_hors_depot_git_rien_n_est_grise", async ({ page }) => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "plat-"));
  fs.mkdirSync(path.join(dossier, "projet"));
  fs.writeFileSync(path.join(dossier, "projet", "target"), "x");
  fs.writeFileSync(path.join(dossier, "projet", ".gitignore"), "target\n");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier: path.join(dossier, "projet") });
  await ouvrirYaide(page, yaide.origine);
  await expect(ligne(page, "target")).toBeVisible();
  await expect(arbre(page).locator(".liste-attenuee")).toHaveCount(0);
});

test("REQ007_AC5_roles_clavier_et_un_seul_arret_de_tabulation", async ({ page }) => {
  await ouvrir(page);
  await expect(arbre(page)).toHaveAttribute("role", "tree");
  await expect(ligne(page, "src")).toHaveAttribute("aria-expanded", "false");
  await expect(ligne(page, "a.txt")).not.toHaveAttribute("aria-expanded");
  expect(await arbre(page).locator("[role=treeitem][tabindex='0']").count()).toBe(1);
  await ligne(page, "src").focus();
  await page.keyboard.press("ArrowRight");
  await expect(ligne(page, "src")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(ligne(page, "main.rs")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(ligne(page, "src")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(ligne(page, "src")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("treeitem", { name: "target, ignoré par git" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(ligne(page, "src")).toHaveAttribute("aria-expanded", "true");
  await ligne(page, "notes.bin").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "notes.bin est un fichier binaire." })).toBeVisible();
});

test("REQ008_un_fichier_dont_le_nom_commence_par_tilde_s_ouvre_et_se_selectionne", async ({ page }) => {
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "~x"), "texte");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
  const requete = page.waitForRequest((r) => r.method() === "GET" && r.url().includes("/api/fichier?chemin=~x"));
  await ligne(page, "~x").click();
  await requete;
  await expect(ligne(page, "~x")).toHaveAttribute("aria-selected", "true");
});

test("REQ007_AC7_projet_vide", async ({ page }) => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "vide-"));
  fs.mkdirSync(path.join(dossier, "projet"));
  yaide = await lancerYaide({ shell: "/bin/sh", dossier: path.join(dossier, "projet") });
  await ouvrirYaide(page, yaide.origine);
  await expect(page.getByText("Dossier vide.")).toBeVisible();
  await page.getByRole("button", { name: "Nouveau fichier" }).click();
  await expect(page.getByRole("dialog", { name: "Nouveau fichier" })).toBeVisible();
});

test("REQ007_la_relecture_au_clic_montre_ce_qui_est_cree_hors_de_yaide", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "src").click();
  fs.writeFileSync(path.join(dossier, "src", "venu_du_shell.rs"), "");
  await ligne(page, "src").click();
  await ligne(page, "src").click();
  await expect(ligne(page, "venu_du_shell.rs")).toBeVisible();
});

test("REQ009_AC5_boutons_du_panneau_et_etat_sans_selection", async ({ page }) => {
  await ouvrir(page);
  for (const nom of ["+ Fichier", "+ Dossier", "Renommer", "Supprimer"]) await expect(page.getByRole("button", { name: nom })).toBeVisible();
  await expect(page.getByRole("button", { name: "Renommer" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Supprimer" })).toBeDisabled();
  await ligne(page, "a.txt").click();
  await expect(page.getByRole("button", { name: "Renommer" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Supprimer" })).toBeEnabled();
});

test("REQ009_AC1_creer_un_fichier_et_un_dossier_chemin_prérempli_avec_le_dossier_selectionne", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "src").click();
  await page.getByRole("button", { name: "+ Fichier" }).click();
  const dlg = page.getByRole("dialog", { name: "Nouveau fichier" });
  await expect(dlg.getByLabel("Chemin")).toHaveValue("src/");
  await expect(dlg.getByLabel("Chemin")).toBeFocused();
  await page.keyboard.type("neuf.rs");
  const lecture = page.waitForRequest((r) => r.method() === "GET" && decodeURIComponent(r.url()).endsWith("/api/fichier?chemin=src/neuf.rs"));
  await page.keyboard.press("Enter");
  await lecture;
  await expect(dlg).toHaveCount(0);
  await expect(ligne(page, "neuf.rs")).toBeVisible();
  expect(fs.existsSync(path.join(dossier, "src", "neuf.rs"))).toBe(true);

  await ligne(page, "a.txt").click();
  await page.getByRole("button", { name: "+ Dossier" }).click();
  const dlg2 = page.getByRole("dialog", { name: "Nouveau dossier" });
  await expect(dlg2.getByLabel("Chemin")).toHaveValue("");
  await page.keyboard.type("outils");
  await dlg2.getByRole("button", { name: "Créer" }).click();
  await expect(ligne(page, "outils")).toBeVisible();
  expect(fs.statSync(path.join(dossier, "outils")).isDirectory()).toBe(true);
});

test("REQ009_AC2_renommer_et_AC3_deplacer", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "a.txt").click();
  await page.getByRole("button", { name: "Renommer" }).click();
  const dlg = page.getByRole("dialog", { name: "Renommer ou déplacer" });
  await dlg.getByLabel("Nouveau chemin").fill("c.txt");
  await dlg.getByRole("button", { name: "Valider" }).click();
  await expect(ligne(page, "c.txt")).toBeVisible();
  await expect(ligne(page, "a.txt")).toHaveCount(0);
  expect(fs.existsSync(path.join(dossier, "a.txt"))).toBe(false);
  expect(fs.existsSync(path.join(dossier, "c.txt"))).toBe(true);

  await ligne(page, "c.txt").click();
  await page.keyboard.press("F2");
  await page.getByLabel("Nouveau chemin").fill("src/c.txt");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(ligne(page, "c.txt")).toBeVisible();
  expect(fs.existsSync(path.join(dossier, "src", "c.txt"))).toBe(true);
  expect(fs.existsSync(path.join(dossier, "c.txt"))).toBe(false);
});

test("REQ009_AC4_et_AC7_nom_deja_pris_le_dialogue_reste_ouvert", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "a.txt").click();
  await page.keyboard.press("F2");
  const champ = page.getByLabel("Nouveau chemin");
  await champ.fill("b.txt");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Renommer ou déplacer" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Ce nom est déjà pris. Choisissez-en un autre." })).toBeVisible();
  await expect(champ).toBeFocused();
  expect(fs.readFileSync(path.join(dossier, "b.txt"), "utf8")).toBe("b");
  expect(fs.existsSync(path.join(dossier, "a.txt"))).toBe(true);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "+ Fichier" }).click();
  await page.getByLabel("Chemin").fill("notes.txt");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Ce nom est déjà pris." })).toBeVisible();
  expect(fs.readFileSync(path.join(dossier, "notes.txt"), "utf8")).toBe("notes");
});

test("REQ009_AC6_F2_champ_rempli_Echap_rend_le_focus_a_la_ligne", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "notes.txt").focus();
  await page.keyboard.press("F2");
  const champ = page.getByLabel("Nouveau chemin");
  await expect(champ).toHaveValue("notes.txt");
  await expect(champ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(ligne(page, "notes.txt")).toBeFocused();
});

test("REQ009_erreurs_du_champ_vide_et_chemin_hors_projet", async ({ page }) => {
  await ouvrir(page);
  await page.getByRole("button", { name: "+ Fichier" }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Indiquez un chemin." })).toBeVisible();
  await page.getByLabel("Chemin").fill("../dehors.txt");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Ce chemin sort du projet." })).toBeVisible();
});

test("REQ010_AC1_et_AC4_supprimer_un_fichier_apres_confirmation", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "notes.txt").click();
  await page.keyboard.press("Delete");
  const dlg = page.getByRole("dialog", { name: "Supprimer notes.txt ?" });
  await expect(dlg.getByText("Cette action est définitive.")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Annuler" })).toBeFocused();
  await dlg.getByRole("button", { name: "Supprimer" }).click();
  await expect(ligne(page, "notes.txt")).toHaveCount(0);
  expect(fs.existsSync(path.join(dossier, "notes.txt"))).toBe(false);
  await expect(arbre(page).locator("[role=treeitem][tabindex='0']")).toBeFocused();
});

test("REQ010_apres_la_derniere_suppression_le_focus_va_sur_Fichier", async ({ page }) => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "seul-"));
  fs.mkdirSync(path.join(dossier, "projet"));
  fs.writeFileSync(path.join(dossier, "projet", "seul.txt"), "x");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier: path.join(dossier, "projet") });
  await ouvrirYaide(page, yaide.origine);
  await ligne(page, "seul.txt").click();
  await page.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByText("Dossier vide.")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Fichier" })).toBeFocused();
});

test("REQ010_AC2_et_AC4_annuler_et_Echap_ne_changent_rien", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "notes.txt").click();
  await page.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Supprimer" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(ligne(page, "notes.txt")).toBeVisible();
  expect(fs.existsSync(path.join(dossier, "notes.txt"))).toBe(true);
});

test("REQ010_AC5_supprimer_un_dossier_et_son_contenu", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "src").click();
  await page.getByRole("button", { name: "Supprimer" }).click();
  const dlg = page.getByRole("dialog", { name: "Supprimer le dossier src/ ?" });
  await expect(dlg.getByText("Le dossier et tout son contenu seront effacés. Cette action est définitive.")).toBeVisible();
  await dlg.getByRole("button", { name: "Supprimer" }).click();
  await expect(ligne(page, "src")).toHaveCount(0);
  expect(fs.existsSync(path.join(dossier, "src"))).toBe(false);
});

test("REQ008_AC5_messages_pour_un_binaire_et_un_gros_fichier", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "notes.bin").click();
  const alerte = page.getByRole("alert").filter({ hasText: "notes.bin est un fichier binaire. Yaide ne l'ouvre pas." });
  await expect(alerte).toBeVisible();
  await ligne(page, "gros.log").click();
  await expect(page.getByRole("alert").filter({ hasText: "gros.log dépasse 5 Mo. Yaide ne l'ouvre pas." })).toBeVisible();
  await page.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "gros.log" })).toHaveCount(0);
});
