import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne } from "./aides.js";
import { lancerRelais } from "./relais.js";

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

const g = (dossier, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd: dossier, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} : ${r.stderr}`);
  return r.stdout;
};

const taper = async (page, commande) => {
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type(commande);
  await page.keyboard.press("Enter");
};
const focusDansTerminal = (page) => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea"));

test("REQ086_parcours_57_58_worktree_AC1_AC2_AC4_AC5_AC7", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dossier = depotExemple();
  g(dossier, "branch", "-M", "main");
  g(dossier, "config", "user.name", "Test");
  g(dossier, "config", "user.email", "t@example.org");
  const essai = path.join(path.dirname(dossier), "essai");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
  const liste = () => page.getByRole("combobox", { name: "Worktree" });
  const barre = page.locator("footer");
  const enTete = page.locator(".fichiers-entete > span").first();
  const avant = g(dossier, "rev-parse", "main").trim();
  const principal = fs.readFileSync(path.join(dossier, "src", "main.rs"), "utf8");

  // P-057 : le projet est ouvert, puis un worktree apparaît.
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("main.rs") }).click();
  await expect(page.getByRole("tab", { name: "main.rs", exact: true })).toBeVisible();
  await expect(liste()).toHaveCount(0);
  await taper(page, "git worktree add ../essai -b essai");
  await expect(liste()).toBeVisible({ timeout: 5000 });
  await expect(liste().locator("option")).toHaveText(["projet (main)", "essai (essai)"]);
  await expect(liste()).toHaveValue("");
  await page.getByRole("tab", { name: "Git" }).click();
  await expect(liste()).toHaveValue("");
  await expect(liste().locator("option")).toHaveCount(2);
  await page.getByRole("tab", { name: "Fichiers" }).click();

  // Étape 2 : choisir essai.
  await liste().focus();
  await liste().selectOption({ label: "essai (essai)" });
  await expect(enTete).toHaveText("essai");
  await expect(barre).toContainText("essai");
  await expect(liste()).toBeFocused();
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(0);

  // Étape 3 : ouvrir, modifier, sauvegarder.
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("main.rs") }).click();
  await expect(page.getByRole("tab", { name: /^main\.rs · \.\.\/essai\/src/ })).toHaveAttribute("aria-selected", "true");
  const editeur = page.locator(".cm-content:visible");
  await editeur.click();
  await page.keyboard.type("// essai\n");
  await page.keyboard.press("Control+s");
  const onglet = page.getByRole("tab", { name: /^main\.rs · \.\.\/essai\/src/ });
  await expect(onglet).toHaveAttribute("title", /^\.\.\/essai\/src\/main\.rs/);
  await expect(onglet).toHaveAccessibleName(/modifié/);
  await expect(page.getByRole("treeitem", { name: "main.rs, modifié" })).toBeVisible();
  await expect(page.locator(".ya-crumbs-segment, .ya-crumbs-nom")).toHaveText(["essai", "src", "main.rs"]);
  await expect(page.getByRole("tab", { name: "Git", exact: true }).locator(".ya-badge")).toHaveText("1");
  expect(fs.readFileSync(path.join(essai, "src", "main.rs"), "utf8")).toContain("// essai");
  expect(fs.readFileSync(path.join(dossier, "src", "main.rs"), "utf8")).toBe(principal);
  await page.screenshot({ path: path.join(path.dirname(dossier), "V-003-etape3.png") });

  // Étapes 4 et 5 : Git, indexer, valider.
  await page.getByRole("tab", { name: "Git" }).click();
  await expect(liste()).toHaveValue("../essai");
  await expect(barre).toContainText("essai");
  const ligne = page.getByRole("listbox", { name: "Changements" }).getByRole("option", { name: nomLigne("main.rs") });
  await expect(ligne).toHaveAccessibleName("main.rs, modifié");
  await ligne.focus();
  await page.keyboard.press("i");
  await expect(ligne).toHaveAccessibleName("main.rs, modifié, indexé");
  await page.getByRole("textbox", { name: "Message" }).fill("Refuse --sortie sans valeur");
  await page.getByRole("textbox", { name: "Message" }).press("Control+Enter");
  await expect(page.getByText("Commit créé.")).toBeVisible();
  expect(g(essai, "log", "-1", "--format=%s").trim()).toBe("Refuse --sortie sans valeur");
  expect(g(dossier, "rev-parse", "main").trim()).toBe(avant);
  expect(fs.readFileSync(path.join(dossier, "src", "main.rs"), "utf8")).toBe(principal);

  // P-058 : un chemin qui sort du worktree.
  await page.getByRole("tab", { name: "Fichiers" }).click();
  await page.getByRole("button", { name: "Nouveau fichier" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Nouveau fichier" });
  await dlg.getByRole("textbox").fill("../projet/notes.md");
  await page.keyboard.press("Enter");
  await expect(dlg.getByText("Ce chemin sort du worktree essai.")).toBeVisible();
  expect(fs.existsSync(path.join(dossier, "notes.md"))).toBe(false);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);

  // Le worktree disparaît.
  await page.getByRole("button", { name: "Fermer main.rs" }).last().click();
  await taper(page, "git worktree remove ../essai");
  await expect(page.getByText("Le worktree essai a disparu : retour au projet.")).toBeVisible({ timeout: 5000 });
  await expect(liste()).toHaveCount(0);
  await expect(enTete).toHaveText("projet");
  await expect(barre).toContainText("main");
  await expect.poll(() => focusDansTerminal(page)).toBe(true);
  await page.screenshot({ path: path.join(path.dirname(dossier), "V-003-disparu.png") });
});

test("REQ099_AC1_AC3_AC5_AC6_AC9_AC12_AC13_AC14_AC15_parcours_69_70_menage", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dossier = depotExemple();
  const parent = path.dirname(dossier);
  g(dossier, "branch", "-M", "main");
  const distant = path.join(parent, "distant.git");
  g(parent, "init", "-q", "--bare", distant);
  g(dossier, "remote", "add", "origin", distant);
  g(dossier, "push", "-q", "-u", "origin", "main");
  g(dossier, "branch", "ancienne");
  g(dossier, "worktree", "add", "../essai", "-b", "essai");
  const essai = path.join(parent, "essai");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  const relais = await lancerRelais(yaide.port);
  try {
    await ouvrirYaide(page, relais.origine);
    await page.getByRole("tab", { name: "Git" }).click();
    const liste = page.getByRole("combobox", { name: "Worktree" });
    await expect(liste.locator("option")).toHaveText(["projet (main)", "essai (essai)"], { timeout: 5000 });
    const corbeilleBranche = page.getByRole("button", { name: "Supprimer une branche" });
    const corbeilleWorktree = page.getByRole("button", { name: "Supprimer le worktree" });
    await expect(corbeilleWorktree).toBeDisabled();
    const dlgBranche = page.getByRole("dialog", { name: "Supprimer une branche" });
    const choixBranche = dlgBranche.getByRole("combobox", { name: "Branche" });

    // P-069, étapes 2 et 3 : essai est prise par un worktree, git refuse.
    await corbeilleBranche.click();
    await expect(choixBranche).toBeFocused();
    await expect(choixBranche).toHaveValue("ancienne");
    await expect(choixBranche.locator("option")).toHaveText(["ancienne", "essai"]);
    await expect(dlgBranche.getByText("Git ne supprime qu'une branche déjà fusionnée.")).toBeVisible();
    await choixBranche.selectOption("essai");
    await dlgBranche.getByRole("button", { name: "Supprimer" }).click();
    await expect(dlgBranche).toHaveCount(0);
    await expect(page.getByText("Git a refusé.")).toBeVisible();
    await expect(page.getByText(/error: cannot delete branch 'essai' used by worktree at/)).toBeVisible();
    await expect(corbeilleBranche).toBeFocused();
    expect(g(dossier, "branch", "--list", "essai")).toContain("essai");

    // Étape 4 : au clavier, ancienne est supprimée.
    await page.keyboard.press("Enter");
    await expect(choixBranche).toBeFocused();
    await expect(choixBranche).toHaveValue("ancienne");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(dlgBranche.getByRole("button", { name: "Supprimer" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Branche ancienne supprimée.")).toBeVisible();
    await expect(page.getByText("Git a refusé.")).toHaveCount(0);
    await expect(corbeilleBranche).toBeFocused();
    expect(g(dossier, "branch", "--list", "ancienne")).toBe("");
    await corbeilleBranche.click();
    await expect(choixBranche.locator("option")).toHaveText(["essai"]);
    await page.keyboard.press("Escape");
    await expect(dlgBranche).toHaveCount(0);

    // Étape 5 : le worktree essai, dialogue avec le focus sur « Annuler ».
    await liste.selectOption({ label: "essai (essai)" });
    await expect(corbeilleWorktree).toBeEnabled();
    await corbeilleWorktree.click();
    const dlgWorktree = page.getByRole("dialog", { name: "Supprimer le worktree essai ?" });
    await expect(dlgWorktree.getByText("Le dossier ../essai sera effacé. La branche essai reste.")).toBeVisible();
    await expect(dlgWorktree.getByRole("button", { name: "Annuler" })).toBeFocused();

    // P-070, étape 2 : fichier non suivi, petite fenêtre, git refuse.
    await page.keyboard.press("Escape");
    await expect(dlgWorktree).toHaveCount(0);
    fs.writeFileSync(path.join(essai, "notes.md"), "notes\n");
    await page.setViewportSize({ width: 800, height: 480 });
    const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
    await poignee.focus();
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
    await expect(poignee).toHaveAttribute("aria-valuenow", "240");
    await corbeilleWorktree.click();
    await dlgWorktree.getByRole("button", { name: "Supprimer" }).click();
    await expect(dlgWorktree).toHaveCount(0);
    await expect(page.getByText("Git a refusé.")).toBeVisible();
    await expect(page.getByText(/contains modified or untracked files, use --force to delete it/)).toBeVisible();
    expect(fs.readFileSync(path.join(essai, "notes.md"), "utf8")).toBe("notes\n");
    await expect(liste.locator("option:checked")).toHaveText("essai (essai)");
    await expect(corbeilleWorktree).toBeFocused();

    // Étape 3 : la connexion coupe, le dialogue reste ouvert.
    fs.rmSync(path.join(essai, "notes.md"));
    relais.couper();
    await corbeilleWorktree.click();
    await dlgWorktree.getByRole("button", { name: "Supprimer" }).click();
    await expect(dlgWorktree.getByText("Connexion perdue. Réessayez au retour.")).toBeVisible();
    await expect(dlgWorktree.getByRole("button", { name: "Supprimer" })).toBeFocused();
    expect(fs.existsSync(essai)).toBe(true);

    // Étape 4 : la connexion revient, le worktree est supprimé.
    relais.retablir();
    await dlgWorktree.getByRole("button", { name: "Supprimer" }).click();
    await expect(page.getByText("Worktree essai supprimé.")).toBeVisible({ timeout: 10000 });
    expect(fs.existsSync(essai)).toBe(false);
    expect(g(dossier, "branch", "--list", "essai")).toContain("essai");
    await expect(liste).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
    await page.getByRole("tab", { name: "Fichiers" }).click();
    await expect(liste).toHaveCount(0);
    await expect(page.locator("footer")).toContainText("main");
    await expect(page.getByText("Le worktree essai a disparu")).toHaveCount(0);
  } finally {
    relais.fermer();
  }
});
