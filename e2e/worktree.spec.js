import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne } from "./aides.js";

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
