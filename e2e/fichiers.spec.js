import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne, saisir, survoler, lacher } from "./aides.js";
import { lancerRelais } from "./relais.js";

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
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const ouvrir = async (page) => {
  const dossier = await demarrer();
  await ouvrirYaide(page, yaide.origine);
  await expect(arbre(page)).toBeVisible();
  // état git lu : le menu de l'arbre a « Indexer »
  await expect(page.locator(".ya-status-branche")).toBeVisible();
  return dossier;
};

test("REQ007_AC1_et_AC3_et_AC8_arbre_deplie_et_replie_dossiers_d_abord_sans_git", async ({ page }) => {
  await ouvrir(page);
  const noms = await arbre(page).getByRole("treeitem").evaluateAll((l) => l.map((e) => e.querySelector(".liste-libelle").textContent));
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
  await page.locator(".fichiers-arbre").getByRole("button", { name: "Nouveau fichier" }).click();
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
  for (const nom of ["Nouveau fichier", "Nouveau dossier", "Renommer", "Supprimer"]) await expect(page.getByRole("button", { name: nom })).toBeVisible();
  await expect(page.getByRole("button", { name: "Renommer" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Supprimer" })).toBeDisabled();
  await ligne(page, "a.txt").click();
  await expect(page.getByRole("button", { name: "Renommer" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Supprimer" })).toBeEnabled();
});

test("REQ009_AC1_creer_un_fichier_et_un_dossier_chemin_prérempli_avec_le_dossier_selectionne", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "src").click();
  await page.getByRole("button", { name: "Nouveau fichier" }).click();
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
  await page.getByRole("button", { name: "Nouveau dossier" }).click();
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

  await ligne(page, "c.txt").focus();
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
  await ligne(page, "a.txt").focus();
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
  await page.getByRole("button", { name: "Nouveau fichier" }).click();
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
  await page.getByRole("button", { name: "Nouveau fichier" }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Indiquez un chemin." })).toBeVisible();
  await page.getByLabel("Chemin").fill("../dehors.txt");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Ce chemin sort du projet." })).toBeVisible();
});

test("REQ010_AC1_et_AC4_supprimer_un_fichier_apres_confirmation", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "notes.txt").focus();
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
  await expect(page.locator(".fichiers-entete").getByRole("button", { name: "Nouveau fichier" })).toBeFocused();
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
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "gros.log" })).toHaveCount(0);
});

// ---- REQ-034 : menu de l'arborescence ----

const menu = (page, nom) => page.getByRole("menu", { name: nom });
const indexe = (dossier) => spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: dossier, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const vide = (page) => page.locator(".fichiers").evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { x: r.left + 20, y: r.bottom - 5 };
});
const clicVide = async (page) => {
  const p = await vide(page);
  await page.mouse.click(p.x, p.y, { button: "right" });
};

test("REQ034_AC1_AC14_clic_droit_sur_une_ligne_ouvre_le_menu_sans_ouvrir_ni_deplier", async ({ page }) => {
  await ouvrir(page);
  await expect(ligne(page, "README.md")).toHaveAttribute("aria-haspopup", "menu");
  await ligne(page, "README.md").click({ button: "right" });
  const m = menu(page, "Actions sur README.md");
  await expect(m).toBeVisible();
  await expect(m.getByRole("menuitem")).toHaveText(["Nouveau fichier", "Nouveau dossier", "RenommerF2", "SupprimerSuppr", "Indexer", "Commit"]);
  await expect(m.getByRole("menuitem", { name: "Renommer", exact: true })).toBeVisible();
  await expect(m.getByRole("separator")).toHaveCount(2);
  await expect(ligne(page, "README.md")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "README.md" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await ligne(page, "src").click({ button: "right" });
  await expect(menu(page, "Actions sur src/")).toBeVisible();
  await expect(ligne(page, "src")).toHaveAttribute("aria-expanded", "false");
});

test("REQ034_AC2_AC19_partie_vide_menu_du_projet_sans_changer_la_selection_ni_remplir_le_chemin", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  await expect(page.locator(".cm-content")).toBeFocused(); // la lecture du fichier est finie : elle ne prendra plus le focus au menu
  await clicVide(page);
  const m = menu(page, "Actions sur le projet");
  await expect(m.getByRole("menuitem")).toHaveText(["Nouveau fichier", "Nouveau dossier", "Commit"]);
  await expect(m.getByRole("separator")).toHaveCount(1);
  await expect(ligne(page, "main.rs")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Chemin")).toHaveValue("");
});

test("REQ034_AC2_projet_vide_le_menu_s_ouvre_sur_Dossier_vide", async ({ page }) => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "vide-"));
  fs.mkdirSync(path.join(dossier, "p"));
  yaide = await lancerYaide({ shell: "/bin/sh", dossier: path.join(dossier, "p") });
  await ouvrirYaide(page, yaide.origine);
  await expect(page.getByText("Dossier vide.")).toBeVisible();
  await page.getByText("Dossier vide.").click({ button: "right" });
  await expect(menu(page, "Actions sur le projet").getByRole("menuitem")).toHaveText(["Nouveau fichier", "Nouveau dossier"]);
});

test("REQ034_AC2_projet_vide_dans_un_depot_propose_aussi_commit", async ({ page }) => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "vide-"));
  fs.mkdirSync(path.join(dossier, "p"));
  spawnSync("git", ["init", "-q"], { cwd: path.join(dossier, "p") });
  yaide = await lancerYaide({ shell: "/bin/sh", dossier: path.join(dossier, "p") });
  await ouvrirYaide(page, yaide.origine);
  await expect(page.getByText("Dossier vide.")).toBeVisible();
  // état git lu : le menu du projet a « Commit »
  await expect(page.locator(".ya-status-branche")).toBeVisible();
  await page.getByText("Dossier vide.").click({ button: "right" });
  const m = menu(page, "Actions sur le projet");
  await expect(m.getByRole("menuitem")).toHaveText(["Nouveau fichier", "Nouveau dossier", "Commit"]);
  await expect(m.getByRole("separator")).toHaveCount(1);
});

test("REQ034_AC16_clic_droit_sur_une_ligne_d_erreur_est_la_partie_vide_et_ne_prend_pas_le_focus", async ({ page }) => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "noir-"));
  const projet = path.join(dossier, "p");
  fs.mkdirSync(path.join(projet, "noir"), { recursive: true });
  fs.writeFileSync(path.join(projet, "noir", "x"), "x");
  fs.writeFileSync(path.join(projet, "a.txt"), "a");
  fs.chmodSync(path.join(projet, "noir"), 0);
  try {
    yaide = await lancerYaide({ shell: "/bin/sh", dossier: projet });
    await ouvrirYaide(page, yaide.origine);
    await ligne(page, "a.txt").focus();
    await ligne(page, "noir").click();
    const erreur = page.getByRole("treeitem", { name: /Impossible de lire ce dossier/ });
    await expect(erreur).toBeVisible();
    await ligne(page, "a.txt").focus();
    await erreur.click({ button: "right" });
    await expect(menu(page, "Actions sur le projet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[role=treeitem]:not([data-chemin]):focus")).toHaveCount(0);
    await expect(ligne(page, "a.txt")).toBeFocused();
  } finally {
    fs.chmodSync(path.join(projet, "noir"), 0o755);
  }
});

test("REQ034_AC3_nouveau_fichier_depuis_une_ligne_remplit_le_dossier_visé", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Nouveau fichier" }).click();
  await expect(page.getByLabel("Chemin")).toHaveValue("src/");
  await page.keyboard.press("Escape");
  await ligne(page, "a.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Nouveau dossier" }).click();
  await expect(page.getByLabel("Chemin")).toHaveValue("");
});

test("REQ034_AC4_renommer_et_supprimer_ouvrent_les_dialogues_de_la_ligne", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "a.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Renommer" }).click();
  await expect(page.getByLabel("Nouveau chemin")).toHaveValue("a.txt");
  await page.keyboard.press("Escape");
  await ligne(page, "b.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Supprimer" }).click();
  await expect(page.getByRole("dialog", { name: "Supprimer b.txt ?" })).toBeVisible();
});

test("REQ034_AC5_AC6_AC18_indexer_un_fichier_puis_un_dossier_avec_message_et_focus", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "a.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Indexer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "a.txt est indexé." })).toBeVisible();
  await expect(page.getByRole("status").getByRole("button", { name: "Fermer" })).toBeVisible();
  await expect(ligne(page, "a.txt")).toBeFocused();
  expect(indexe(dossier)).toEqual(["a.txt"]);
  await ligne(page, "Zeta").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Indexer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Zeta/ est indexé." })).toBeVisible();
  await expect(ligne(page, "Zeta")).toBeFocused();
  expect(indexe(dossier)).toEqual(["Zeta/z.txt", "a.txt"]);
});

test("REQ034_AC6_indexer_un_dossier_laisse_de_cote_ce_que_git_ignore", async ({ page }) => {
  const dossier = await ouvrir(page);
  fs.writeFileSync(path.join(dossier, "Zeta", "x.log"), "x");
  fs.writeFileSync(path.join(dossier, ".gitignore"), "target/\n*.log\n");
  await page.reload();
  // L'état git arrive après le rechargement : tant qu'il manque, le menu n'a pas « Indexer ». On rouvre le menu jusqu'à l'avoir.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await ligne(page, "Zeta").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Indexer" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await page.getByRole("menuitem", { name: "Indexer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Zeta/ est indexé." })).toBeVisible();
  expect(indexe(dossier)).toEqual(["Zeta/z.txt"]);
});

test("REQ034_AC7_AC18_indexer_un_fichier_ignore_montre_le_refus_de_git_et_l_index_reste", async ({ page }) => {
  const dossier = await ouvrir(page);
  await page.getByRole("treeitem", { name: "target, ignoré par git" }).click();
  await page.getByRole("treeitem", { name: "out.txt, ignoré par git" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Indexer" }).click();
  const alerte = page.getByRole("alert").filter({ hasText: "Git a refusé." });
  await expect(alerte).toBeVisible();
  await expect(alerte).toContainText("ignor");
  await expect(page.getByRole("treeitem", { name: "out.txt, ignoré par git" })).toBeFocused();
  expect(indexe(dossier)).toEqual([]);
});

test("REQ034_P008_indexer_main_rs_modifie_refus_sur_target_puis_commit_depuis_le_vide", async ({ page }) => {
  const dossier = await ouvrir(page);
  fs.writeFileSync(path.join(dossier, "src", "main.rs"), "fn main() {}\n");
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Indexer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "src/main.rs est indexé." })).toBeVisible();
  expect(indexe(dossier)).toEqual(["src/main.rs"]);
  await page.getByRole("treeitem", { name: "target, ignoré par git" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Indexer" }).click();
  const alerte = page.getByRole("alert").filter({ hasText: "Git a refusé." });
  await expect(alerte).toBeVisible();
  await expect(alerte).toContainText("ignor");
  expect(indexe(dossier)).toEqual(["src/main.rs"]);
  await clicVide(page);
  await page.getByRole("menuitem", { name: "Commit" }).click();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
  await expect(page.getByRole("listbox", { name: "Changements" }).getByRole("option", { name: "main.rs, modifié, indexé" })).toBeVisible();
  const log = spawnSync("git", ["log", "--oneline"], { cwd: dossier, encoding: "utf8" }).stdout.trim().split("\n");
  expect(log).toHaveLength(1);
  expect(indexe(dossier)).toEqual(["src/main.rs"]);
});

test("REQ034_AC9_hors_depot_ni_indexer_ni_commit", async ({ page }) => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "plat-"));
  fs.mkdirSync(path.join(dossier, "p"));
  fs.writeFileSync(path.join(dossier, "p", "a.txt"), "a");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier: path.join(dossier, "p") });
  await ouvrirYaide(page, yaide.origine);
  await ligne(page, "a.txt").click({ button: "right" });
  const m = menu(page, "Actions sur a.txt");
  await expect(m.getByRole("menuitem")).toHaveText(["Nouveau fichier", "Nouveau dossier", "RenommerF2", "SupprimerSuppr"]);
  await expect(m.getByRole("separator")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await clicVide(page);
  await expect(menu(page, "Actions sur le projet").getByRole("menuitem")).toHaveText(["Nouveau fichier", "Nouveau dossier"]);
});

test("REQ034_AC12_clic_droit_dans_l_editeur_et_le_shell_n_ouvre_pas_le_menu_de_Yaide", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "a.txt").click();
  await expect(page.locator(".cm-content")).toBeVisible();
  for (const cible of [page.locator(".cm-content"), page.locator(".terminal:visible .xterm-screen")]) {
    const annule = await cible.evaluate((e) => {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
      e.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(annule).toBe(false);
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
});

test("REQ034_AC13_indexer_pendant_une_coupure_dit_connexion_perdue_et_rien_ne_change", async ({ page }) => {
  const dossier = await demarrer();
  const relais = await lancerRelais(yaide.port);
  try {
    await ouvrirYaide(page, relais.origine);
    // état git lu : le menu de l'arbre a « Indexer »
    await expect(page.locator(".ya-status-branche")).toBeVisible();
    await ligne(page, "a.txt").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Indexer" })).toBeVisible();
    relais.couper();
    await page.getByRole("menuitem", { name: "Indexer" }).click();
    await expect(page.getByText("Connexion perdue. Réessayez au retour.").first()).toBeVisible();
    expect(indexe(dossier)).toEqual([]);
  } finally {
    relais.fermer();
  }
});

test("REQ034_AC16_echap_rend_le_focus_a_la_ligne_et_un_clic_ailleurs_n_ouvre_pas_le_fichier", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "a.txt").click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(ligne(page, "a.txt")).toBeFocused();
  await ligne(page, "a.txt").click({ button: "right" });
  await ligne(page, "README.md").click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "README.md" })).toHaveCount(0);
  await ligne(page, "a.txt").click({ button: "right" });
  await ligne(page, "b.txt").click({ button: "right", position: { x: 5, y: 5 } });
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(menu(page, "Actions sur b.txt")).toBeVisible();
});

test("REQ034_AC16_depuis_la_partie_vide_le_panneau_ne_prend_pas_le_focus_et_il_revient", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "a.txt").focus();
  await clicVide(page);
  await page.keyboard.press("Escape");
  await expect(ligne(page, "a.txt")).toBeFocused();
});

test("REQ034_AC17_a_800_x_480_le_menu_reste_entier_sur_la_derniere_ligne_visible_et_s_ouvre_sous_la_ligne_au_clavier", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  const dossier = await demarrer();
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(dossier, `f${String(i).padStart(2, "0")}.txt`), "x");
  await ouvrirYaide(page, yaide.origine);
  await expect(ligne(page, "f39.txt")).toBeAttached();
  const entier = async () => {
    const b = await page.getByRole("menu").boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(800);
    expect(b.y + b.height).toBeLessThanOrEqual(480);
    return b;
  };
  const lignes = arbre(page).getByRole("treeitem");
  const zone = await page.locator("aside.cadre-panneau .cadre-panneau-corps").boundingBox();
  const visibles = [];
  for (let i = 0; i < (await lignes.count()); i++) {
    const b = await lignes.nth(i).boundingBox();
    if (b && b.y >= zone.y && b.y + b.height <= zone.y + zone.height + 1) visibles.push({ i, b });
  }
  const derniere = lignes.nth(visibles.at(-1).i);
  await derniere.click({ button: "right" });
  const bas = await entier();
  // Il ne tient pas sous la ligne : il est retourné au-dessus du point.
  expect(bas.y).toBeLessThan(visibles.at(-1).b.y);
  await page.keyboard.press("Escape");
  const haute = visibles[2];
  await lignes.nth(haute.i).focus();
  await page.keyboard.press("ContextMenu");
  const m = await entier();
  expect(Math.abs(m.y - (haute.b.y + haute.b.height))).toBeLessThanOrEqual(2);
});

test("REQ034_la_partie_vide_remplit_la_hauteur_du_panneau", async ({ page }) => {
  await ouvrir(page);
  const r = await page.evaluate(() => {
    const f = document.querySelector(".fichiers-arbre").getBoundingClientRect();
    const p = document.querySelector("aside.cadre-panneau .cadre-panneau-corps").getBoundingClientRect();
    return { bas: f.bottom, basCorps: p.bottom };
  });
  expect(r.bas).toBeGreaterThanOrEqual(r.basCorps - 1);
});

// ---- T-037 : statut git dans l'arborescence et les onglets (REQ-039) ----

const couleurDe = (page, jeton) =>
  page.evaluate((j) => {
    const e = document.createElement("span");
    e.style.color = `var(${j})`;
    document.body.append(e);
    const v = getComputedStyle(e).color;
    e.remove();
    return v;
  }, jeton);
const styleDe = (loc, propriete = "color") => loc.evaluate((e, p) => getComputedStyle(e)[p], propriete);

test("REQ039_AC1_AC2_AC3_AC5_AC6_AC7_AC8_lettres_couleurs_points_et_mots_dans_l_arbre_et_les_onglets", async ({ page }) => {
  const dossier = depotExemple();
  const git = (...args) => spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd: dossier });
  fs.writeFileSync(path.join(dossier, ".gitignore"), "ignore.log\n");
  git("add", ".gitignore");
  git("commit", "-q", "-m", "ignore");
  fs.writeFileSync(path.join(dossier, "src", "main.rs"), "fn main() {}\n");
  fs.writeFileSync(path.join(dossier, "nouveau.txt"), "n\n");
  fs.writeFileSync(path.join(dossier, "indexe.txt"), "i\n");
  git("add", "indexe.txt");
  fs.writeFileSync(path.join(dossier, "ignore.log"), "x\n");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
  // Fichiers : lettre à droite, nom coloré, mot complet à la fin du nom accessible.
  const cas = [
    ["nouveau.txt", "nouveau", "U", "--git-untracked"],
    ["indexe.txt", "ajouté", "A", "--git-added"],
  ];
  for (const [nom, mot, lettre, jeton] of cas) {
    const l = arbre(page).getByRole("treeitem", { name: `${nom}, ${mot}`, exact: true });
    await expect(l.locator(".liste-statut")).toHaveText(lettre);
    expect(await styleDe(l.locator(".liste-libelle"))).toBe(await couleurDe(page, jeton));
  }
  // Dossier : couleur du plus fort, point, aucune lettre, lettre et point masqués aux lecteurs d'écran.
  const src = arbre(page).getByRole("treeitem", { name: nomLigne("src, modifié") });
  await expect(src.locator(".liste-point")).toHaveCount(1);
  await expect(src.locator(".liste-statut")).toHaveCount(0);
  await expect(src.locator(".liste-point")).toHaveAttribute("aria-hidden", "true");
  expect(await styleDe(src.locator(".liste-libelle"))).toBe(await couleurDe(page, "--git-modified"));
  // Ignoré : pas de lettre.
  const ignore = arbre(page).getByRole("treeitem", { name: nomLigne("ignore.log, ignoré par git") });
  await expect(ignore).toBeVisible();
  await expect(ignore.locator(".liste-statut, .liste-point")).toHaveCount(0);
  // Fichier modifié dans un dossier, onglet coloré, ligne du fichier actif.
  await src.click();
  const main = arbre(page).getByRole("treeitem", { name: nomLigne("main.rs, modifié") });
  await expect(main.locator(".liste-statut")).toHaveText("M");
  await main.click();
  const onglet = page.getByRole("tab", { name: "main.rs, modifié", exact: true });
  await expect(onglet).toBeVisible();
  expect(await styleDe(onglet.locator(".onglet-nom"))).toBe(await couleurDe(page, "--git-modified"));
  await expect(main).toHaveAttribute("aria-current", "true");
  expect(await styleDe(main.locator(".liste-libelle"))).toBe(await couleurDe(page, "--git-modified"));
  await expect(arbre(page).getByRole("treeitem", { name: nomLigne("nouveau.txt, nouveau") })).not.toHaveAttribute("aria-current", "true");
  // Le nombre de changements est sur le rail, hors du nom accessible.
  await expect(page.getByRole("tab", { name: "Git", exact: true }).locator(".ya-badge")).toHaveText("3");
});

test("REQ039_AC4_hors_depot_aucune_lettre_ni_nombre_sur_le_rail", async ({ page }) => {
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "horsdepot-"));
  fs.writeFileSync(path.join(dossier, "a.txt"), "a");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
  await expect(ligne(page, "a.txt")).toBeVisible();
  await expect(page.locator(".fichiers .liste-statut, .fichiers .liste-point")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Git", exact: true }).locator(".ya-badge")).toHaveCount(0);
});

test("REQ009_AC9_AC10_en_tete_du_projet_a_240_px_26_px_une_ligne_et_ordre_de_tabulation", async ({ page }) => {
  await ouvrir(page);
  const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
  await poignee.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  await expect(poignee).toHaveAttribute("aria-valuenow", "240");
  const entete = page.locator(".fichiers-entete");
  expect((await entete.boundingBox()).height).toBe(26);
  const boites = await entete.locator("button").evaluateAll((l) => l.map((e) => e.getBoundingClientRect().toJSON()));
  expect(boites).toHaveLength(4);
  expect(new Set(boites.map((b) => Math.round(b.top))).size).toBe(1);
  // Tab : les boutons actifs de l'en-tête (Renommer et Supprimer sont désactivés), puis l'arbre.
  await page.getByRole("button", { name: "Nouveau fichier" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Nouveau dossier" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(arbre(page).locator("[tabindex='0']")).toBeFocused();
  // AC-009-10 : Maj+Tab depuis « Nouveau fichier » arrive sur le bouton de repli de l'en-tête du panneau.
  await page.getByRole("button", { name: "Nouveau fichier" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("aside.cadre-panneau").getByRole("button", { name: "Replier le panneau", exact: true })).toBeFocused();
});

test("REQ039_AC1_indexer_depuis_le_menu_fait_passer_la_lettre_de_U_a_A", async ({ page }) => {
  await ouvrir(page);
  const avant = arbre(page).getByRole("treeitem", { name: "notes.txt, nouveau", exact: true });
  await expect(avant.locator(".liste-statut")).toHaveText("U");
  await avant.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Indexer" }).click();
  const apres = arbre(page).getByRole("treeitem", { name: "notes.txt, ajouté", exact: true });
  await expect(apres.locator(".liste-statut")).toHaveText("A");
});

test("REQ039_AC1_AC5_AC037_7_ctrl_s_met_a_jour_la_lettre_l_onglet_et_le_compteur_sans_changer_de_panneau", async ({ page }) => {
  yaide = await lancerYaide({ shell: "/bin/sh", dossier: depotExemple() });
  await ouvrirYaide(page, yaide.origine);
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  await page.locator(".cm-content").first().click();
  await page.keyboard.type("// x\n");
  await page.keyboard.press("Control+s");
  const main = arbre(page).getByRole("treeitem", { name: "main.rs, modifié", exact: true });
  await expect(main.locator(".liste-statut")).toHaveText("M");
  const onglet = page.getByRole("tab", { name: "main.rs, modifié", exact: true });
  await expect(onglet).toBeVisible();
  expect(await styleDe(onglet.locator(".onglet-nom"))).toBe(await couleurDe(page, "--git-modified"));
  await expect(page.getByRole("tab", { name: "Git", exact: true }).locator(".ya-badge")).toHaveText("1");
});

test("REQ009_AC9_l_en_tete_du_projet_ne_defile_pas_avec_l_arbre", async ({ page }) => {
  const dossier = depotExemple();
  for (let i = 0; i < 80; i++) fs.writeFileSync(path.join(dossier, `f${String(i).padStart(2, "0")}.txt`), "x");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
  const entete = page.locator(".fichiers-entete");
  const avant = await entete.boundingBox();
  await page.locator("aside.cadre-panneau .cadre-panneau-corps").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  expect(await page.locator("aside.cadre-panneau .cadre-panneau-corps").evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect(await entete.boundingBox()).toEqual(avant);
  await expect(page.getByRole("button", { name: "Supprimer" })).toBeInViewport();
});

test("REQ049_AC2_AC9_AC12_plage_contour_et_aucun_texte_selectionne", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "a.txt").click();
  await ligne(page, "notes.txt").click({ modifiers: ["Shift"] });
  const choisies = arbre(page).locator("[aria-selected=true] .liste-libelle");
  await expect(choisies).toHaveText(["a.txt", "b.txt", "gros.log", "notes.bin", "notes.txt"]);
  expect(await page.evaluate(() => String(getSelection()))).toBe("");
  await expect(page.getByRole("tab", { name: "notes.txt" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Renommer" })).toBeDisabled();
  await expect(arbre(page).locator("[aria-selected=true] .liste-coche")).toHaveCount(5);
  // Ctrl+clic sur une ligne choisie : elle sort, garde le focus et son contour, pas le fond.
  await ligne(page, "b.txt").click({ modifiers: ["Control"] });
  const b = ligne(page, "b.txt");
  await expect(b).toHaveAttribute("aria-selected", "false");
  await expect(b).toBeFocused();
  await expect(b).toHaveCSS("outline-style", "solid");
  const fond = (l) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await fond(b)).not.toBe(await fond(ligne(page, "a.txt")));
  await expect(ligne(page, "a.txt")).not.toHaveCSS("outline-style", "solid");
});

const parChemin = (page, chemin) => arbre(page).locator(`[data-chemin="${chemin}"]`);

test("REQ050_AC4_partie_vide_reste_atteignable_a_800x480", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "lot"));
  for (let i = 10; i < 50; i++) fs.writeFileSync(path.join(dossier, "lot", `f${i}.txt`), "x");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirYaide(page, yaide.origine);
  await parChemin(page, "lot").click();
  await expect(parChemin(page, "lot/f49.txt")).toBeAttached();
  const defile = page.locator("aside.cadre-panneau .cadre-panneau-corps");
  await defile.evaluate((e) => (e.scrollTop = e.scrollHeight));
  const derniere = arbre(page).getByRole("treeitem").last();
  await expect(derniere).toBeInViewport();
  const source = parChemin(page, "lot/f49.txt");
  await saisir(page, source);
  // Sous la dernière ligne, il reste au moins une ligne de partie vide, même défilé au bout.
  const b = await derniere.boundingBox();
  const zone = await defile.boundingBox();
  expect(zone.y + zone.height - (b.y + b.height)).toBeGreaterThanOrEqual(b.height);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height + 10, { steps: 6 });
  await expect(arbre(page)).toHaveAttribute("data-depot", "");
  await lacher(page);
  await expect.poll(() => fs.existsSync(path.join(dossier, "f49.txt"))).toBe(true);
  expect(fs.existsSync(path.join(dossier, "lot", "f49.txt"))).toBe(false);
});

test("REQ050_AC12_depot_sur_editeur_et_shell_n_insere_rien", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "a.txt").click();
  const editeur = page.getByRole("textbox", { name: "Éditeur a.txt" });
  await expect(editeur).toBeFocused();
  await saisir(page, ligne(page, "b.txt"));
  await survoler(page, editeur);
  await expect(arbre(page)).not.toHaveAttribute("data-depot", "");
  await lacher(page);
  await expect(editeur).toHaveText("a");
  const shell = page.locator(".terminal.xterm:visible");
  await saisir(page, ligne(page, "b.txt"));
  await survoler(page, shell);
  await lacher(page);
  await expect(page.locator(".terminal:visible .xterm-rows")).not.toContainText("b.txt");
  await expect(editeur).toHaveText("a");
  expect(fs.existsSync(path.join(dossier, "b.txt"))).toBe(true);
  await expect(ligne(page, "b.txt")).toBeVisible();
});

test("REQ050_AC13_relecture_pendant_un_vrai_glisse", async ({ page }) => {
  const dossier = await ouvrir(page);
  await saisir(page, ligne(page, "a.txt"));
  await survoler(page, ligne(page, "Zeta"));
  fs.writeFileSync(path.join(dossier, "cree-pendant.txt"), "x");
  // Plus de deux relectures passent pendant que le bouton reste pressé : rien ne bouge.
  await page.waitForTimeout(3500);
  await expect(parChemin(page, "cree-pendant.txt")).toHaveCount(0);
  await expect(ligne(page, "Zeta")).toHaveAttribute("data-depot", "");
  await lacher(page);
  await expect(parChemin(page, "Zeta/a.txt")).toBeVisible();
  await expect(parChemin(page, "cree-pendant.txt")).toBeVisible();
  expect(fs.existsSync(path.join(dossier, "Zeta", "a.txt"))).toBe(true);
});
