import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";
import { lancerFauxProvider } from "./faux-provider.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

const api = (page, methode, chemin, corps) =>
  page.evaluate(
    async ([m, c, b]) => {
      const r = await fetch(c, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
      return r.json().catch(() => ({}));
    },
    [methode, chemin, corps],
  );
const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const menu = (page, nom) => page.getByRole("menu", { name: nom });

// Les 11 premières lignes de guide.md remplissent un passage (1 990 caractères) : le suivant commence à la ligne 12.
const rempli = Array.from({ length: 11 }, () => "introduction ".repeat(14).slice(0, 180)).join("\n");

test("REQ103_parcours_75_76_base_de_connaissance", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "docs"));
  fs.writeFileSync(path.join(dossier, "docs", "guide.md"), `${rempli}\nComment lancer les tests ?\nLancer cargo test pour lancer les tests.\nTout passe.\n`);
  fs.writeFileSync(path.join(dossier, "docs", "contribuer.md"), "Ouvrir une demande de fusion.\nRelire le code.\n");
  fs.writeFileSync(path.join(dossier, "docs", "faq.md"), "Où trouver la licence ?\n");
  fs.writeFileSync(path.join(dossier, "docs", "api.md"), "Les routes de l'interface.\n");
  fs.writeFileSync(path.join(dossier, "docs", "schema.png"), Buffer.from([137, 80, 78, 71, 0, 1, 2]));
  fs.writeFileSync(path.join(dossier, "CHANGELOG.md"), "# Notes de version\n");
  spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", "add", "-A"], { cwd: dossier });
  spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", "commit", "-q", "-m", "docs"], { cwd: dossier });

  const faux = await lancerFauxProvider([]);
  const yaide = await lancerYaide({ dossier });
  try {
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await api(page, "PUT", "/api/agent/providers/ollama", { adresse: faux.adresse });
    await page.reload();
    await expect(arbre(page)).toBeVisible();

    // P-075 étape 1 : base non configurée.
    await ligne(page, "docs").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Ajouter à la base de connaissance…" }).click();
    const invite = page.getByRole("dialog", { name: "Ajouter à la base de connaissance" });
    await expect(invite).toContainText("La base de connaissance n'est pas configurée. Choisissez d'abord un provider et un modèle.");
    await expect(invite.getByRole("button", { name: "Configurer la base" })).toBeFocused();

    // Étape 2 : « Configuration », modèle vide refusé, puis enregistré.
    await page.keyboard.press("Enter");
    const base = page.getByRole("dialog", { name: "Base de connaissance" });
    await expect(base.getByLabel("Provider")).toBeFocused();
    await base.getByLabel("Provider").selectOption({ label: "Ollama" });
    await base.getByRole("button", { name: "Enregistrer" }).click();
    await expect(base.getByText("Donnez le nom du modèle.")).toBeVisible();
    await expect(base.getByLabel("Modèle")).toBeFocused();
    await base.getByLabel("Modèle").fill("nomic-embed-text");
    await page.keyboard.press("Enter");
    await expect(base.getByText("Configuration enregistrée.")).toBeVisible();

    // Étape 4 : Échap rend le focus à `docs` ; ajout à une nouvelle collection.
    await page.keyboard.press("Escape");
    await expect(ligne(page, "docs")).toBeFocused();
    await ligne(page, "docs").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Ajouter à la base de connaissance…" }).click();
    const ajout = page.getByRole("dialog", { name: "Ajouter à la base de connaissance" });
    await expect(ajout).toContainText("Ajouter docs/ à une collection.");
    await expect(ajout.getByLabel("Nom de la nouvelle collection")).toBeFocused();
    await page.keyboard.type("notes");
    await page.keyboard.press("Enter");

    // Étape 5 : le dialogue se ferme, le focus est sur `docs`, les bandeaux disent l'avancement.
    await expect(ajout).toHaveCount(0);
    await expect(ligne(page, "docs")).toBeFocused();
    await expect(page.getByText("Ajout de docs/ à notes…")).toBeVisible();
    await expect(page.getByText("Ajout à notes terminé : 4 fichiers ajoutés, 1 ignoré.")).toBeVisible({ timeout: 20000 });
    await expect(ligne(page, "docs")).toBeFocused();
    expect(faux.embeddings.length).toBeGreaterThan(0);

    // Étape 6 : « Recherche », focus dans « Question ».
    await page.getByRole("button", { name: "Base de connaissance" }).click();
    await expect(base.getByLabel("Question")).toBeFocused();
    await page.keyboard.type("Comment lancer les tests ?");
    await page.keyboard.press("Enter");
    const liens = base.getByRole("list", { name: "Passages" }).getByRole("link");
    await expect(liens.first()).toHaveText("docs/guide.md:12-14");
    await expect(liens.first()).toHaveAttribute("title", "Ouvrir docs/guide.md à la ligne 12 dans l'éditeur.");
    await expect(base.getByRole("status").filter({ hasText: "du plus proche au moins proche." })).toHaveText("5 passages, du plus proche au moins proche.");
    await expect(base.getByRole("list", { name: "Passages" }).getByRole("listitem").first()).toContainText("notes · score ");
    expect(faux.embeddings.at(-1).input).toEqual(["Comment lancer les tests ?"]);

    // Étape 7 : le lien ouvre guide.md à la ligne 12 et ferme le dialogue.
    await liens.first().click();
    await expect(base).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "guide.md" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("footer")).toContainText("Ln 12, Col 1");
    await expect(page.locator(".cm-content")).toBeFocused();
    await page.getByRole("button", { name: "Base de connaissance" }).click();
    await expect(base.getByLabel("Question")).toHaveValue("Comment lancer les tests ?");
    await expect(liens.first()).toHaveText("docs/guide.md:12-14");
    await page.keyboard.press("Escape");

    // P-076 étape 1 : deux lignes sélectionnées, clic droit sur l'une.
    await ligne(page, "CHANGELOG.md").click();
    await ligne(page, "README.md").click({ modifiers: ["Control"] });
    await ligne(page, "CHANGELOG.md").click({ button: "right" });
    await expect(ligne(page, "CHANGELOG.md")).toHaveAttribute("aria-selected", "true");
    await expect(ligne(page, "README.md")).toHaveAttribute("aria-selected", "true");
    const actions = menu(page, "Actions sur CHANGELOG.md");
    await expect(actions.getByRole("menuitem", { name: /^Renommer/ })).toBeDisabled();
    await expect(actions.getByRole("menuitem", { name: /^Supprimer/ })).toBeDisabled();

    // Étape 2 : nouvelle collection, nom refusé puis corrigé, ajout des deux éléments.
    await actions.getByRole("menuitem", { name: "Ajouter à la base de connaissance…" }).click();
    const deux = page.getByRole("dialog", { name: "Ajouter à la base de connaissance" });
    await expect(deux).toContainText("Ajouter CHANGELOG.md et README.md à une collection.");
    await expect(deux.getByLabel("Collection", { exact: true })).toHaveValue("notes");
    await deux.getByLabel("Collection", { exact: true }).selectOption({ label: "Nouvelle collection…" });
    await deux.getByLabel("Nom de la nouvelle collection").fill("api docs");
    await page.keyboard.press("Enter");
    await expect(deux.getByText("Lettres sans accent, chiffres, - et _ seulement.")).toBeVisible();
    await deux.getByLabel("Nom de la nouvelle collection").fill("api-docs");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Ajout de 2 éléments à api-docs…")).toBeVisible();
    await expect(page.getByText("Ajout à api-docs terminé : 2 fichiers ajoutés, 0 ignoré.")).toBeVisible({ timeout: 20000 });

    // REQ-108 (AC-108-1, AC-108-3, AC-108-10) : « # » dans « Message à l'agent » liste les collections.
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    const message = page.getByRole("textbox", { name: "Message à l'agent" });
    await message.click();
    await page.keyboard.type("#");
    const collections = page.getByRole("listbox", { name: "Collections" });
    await expect(collections.getByRole("option", { name: /#api-docs/ })).toBeVisible();
    await expect(collections.getByRole("option", { name: /#notes/ })).toContainText("4 fichiers · 5 passages");
    const [cl, lb] = [await message.boundingBox(), await collections.locator("xpath=..").boundingBox()];
    expect(Math.abs(lb.x - cl.x)).toBeLessThan(2);
    expect(Math.abs(lb.width - Math.min(cl.width, 600))).toBeLessThan(1);
    await page.keyboard.type("no");
    await expect(collections.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(message).toHaveValue("#notes ");
    await expect(collections).toHaveCount(0);
  } finally {
    await yaide.arreter();
    await faux.arreter();
  }
});
