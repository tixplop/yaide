import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

// Le guide : les lignes 3, 9, 13, 25 et 27 du design, un tableau avec un lien (lignes 15 à 17) et un long lien (ligne 23).
const LONG = "https://exemple.org/" + "a".repeat(100);
function guide() {
  const l = Array.from({ length: 140 }, (_, i) => `Ligne de texte ${i + 1}.`);
  l[0] = "# Guide";
  l[2] = "Commencez par [le README](../README.md), puis lisez [Lancer les tests](#lancer-les-tests).";
  l[8] = "[ancien guide](ancien.md)";
  l[12] = "[clap](http://127.0.0.1:9/clap)";
  l[14] = "| Nom | Doc |";
  l[15] = "| --- | --- |";
  l[16] = "| a | [le README](../README.md) |";
  l[17] = "";
  l[22] = `[long](${LONG})`;
  l[24] = "## Lancer les tests !";
  l[26] = "[tests/args.rs, ligne 12](../tests/args.rs#L12)";
  return l.join("\n") + "\n";
}

test("REQ101_parcours_73_74_liens_d_un_document_markdown", async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "docs"));
  fs.mkdirSync(path.join(dossier, "tests"));
  fs.writeFileSync(path.join(dossier, "docs", "guide.md"), guide());
  fs.writeFileSync(path.join(dossier, "tests", "args.rs"), Array.from({ length: 20 }, (_, i) => `// args ligne ${i + 1}`).join("\n") + "\n");
  expect(spawnSync("git", ["checkout", "-q", "-b", "branche-" + "x".repeat(72)], { cwd: dossier }).status).toBe(0);
  const yaide = await lancerYaide({ dossier });
  try {
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    const pied = page.locator("footer");
    const arbre = page.getByRole("tree", { name: "Fichiers" });
    await arbre.getByRole("treeitem", { name: nomLigne("README.md") }).click();
    await arbre.getByRole("treeitem", { name: nomLigne("docs") }).click();
    await arbre.getByRole("treeitem", { name: nomLigne("guide.md") }).click();
    const ongletGuide = page.getByRole("tab", { name: nomLigne("guide.md") });
    await expect(ongletGuide).toHaveAttribute("aria-selected", "true");
    const hybride = page.getByRole("button", { name: "Mode hybride", exact: true });
    await expect(hybride).toHaveAttribute("aria-pressed", "true");
    const editeur = page.getByLabel("Éditeur guide.md");
    const lignes = page.locator(".cm-content:visible .cm-line");
    const readme = lignes.nth(2).locator(".cm-hy-lien", { hasText: "le README" });
    await expect(readme).toBeVisible();
    const suivable = lignes.nth(2).locator(".cm-hy-suivable", { hasText: "le README" }).first();
    const curseur = (el) => el.evaluate((e) => getComputedStyle(e).cursor);

    // P-073 étape 1 : survol, pointeur du texte, indication dans la barre.
    await readme.hover();
    expect(await curseur(suivable)).toBe("text");
    await expect(pied).toContainText("Ctrl+clic pour ouvrir ../README.md");
    // Étape 3 : Ctrl enfoncé sans bouger la souris : main ; relâché : texte.
    await page.keyboard.down("Control");
    await expect.poll(() => curseur(suivable)).toBe("pointer");
    await page.keyboard.up("Control");
    await expect.poll(() => curseur(suivable)).toBe("text");
    // Tableau rendu : même indication.
    const cellule = page.locator(".cm-hy-tableau:visible a", { hasText: "le README" });
    await cellule.hover();
    await expect(pied).toContainText("Ctrl+clic pour ouvrir ../README.md");
    await page.mouse.move(700, 5);
    await expect(pied).not.toContainText("Ctrl+clic");

    // Étape 2 : clic simple, le curseur entre dans le lien, rien ne s'ouvre.
    await readme.click();
    await expect(pied).toContainText(/Ln 3, Col \d+/);
    const col = (await pied.textContent()).match(/Ln 3, Col (\d+)/)[1];
    await expect(page.getByRole("tab", { name: /^README\.md/ })).toHaveAttribute("aria-selected", "false");
    expect(context.pages()).toHaveLength(1);

    // Étape 4 : Ctrl+clic ouvre README.md, hybride, focus dans son éditeur.
    await page.locator(".cm-hy-lien", { hasText: "le README" }).first().click({ modifiers: ["Control"] });
    await expect(page.getByRole("tab", { name: /^README\.md/ })).toHaveAttribute("aria-selected", "true");
    await expect(hybride).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[aria-label]")?.getAttribute("aria-label"))).toBe("Éditeur README.md");
    await expect(pied).toContainText("Ln 1, Col 1");
    // Retour sur guide.md : « Ln 3 » inchangé, un seul curseur.
    await ongletGuide.click();
    await expect(pied).toContainText(`Ln 3, Col ${col}`);
    await expect(page.locator(".cm-editor:visible .cm-cursor")).toHaveCount(1);
    await expect(editeur).toBeVisible();

    // Étape 5 : fichier absent.
    const ancien = lignes.nth(8).locator(".cm-hy-lien");
    await ancien.click({ modifiers: ["Control"] });
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(/ancien\.md n'existe pas\./);
    await expect(page.getByRole("tab", { name: /^ancien\.md/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[aria-label]")?.getAttribute("aria-label"))).toBe("Éditeur guide.md");
    await expect(lignes.nth(8)).toHaveText("ancien guide");
    // Étape 6 : ancre du même document.
    await lignes.nth(2).locator(".cm-hy-lien", { hasText: "Lancer les tests" }).click({ modifiers: ["Control"] });
    await expect(pied).toContainText("Ln 25, Col 1");
    await expect(lignes.filter({ hasText: "## Lancer les tests !" })).toHaveCount(1);
    await expect(page.getByRole("alert").filter({ hasText: /n'existe pas/ })).toBeVisible();

    // P-074 étape 1 : l'aperçu, Tab jusqu'à « Lancer les tests ».
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    const apercu = page.getByRole("region", { name: "Aperçu" });
    await expect(apercu).toBeVisible();
    const ancre = apercu.getByRole("link", { name: "Lancer les tests" });
    await apercu.getByRole("link", { name: "le README" }).first().focus();
    await page.keyboard.press("Tab");
    await expect(ancre).toBeFocused();
    // Étape 2 : Entrée, le titre est en haut et focalisé.
    await page.keyboard.press("Enter");
    const titre = apercu.getByRole("heading", { name: "Lancer les tests !" });
    await expect(titre).toBeFocused();
    expect(await titre.evaluate((e) => e.matches(":focus-visible"))).toBe(true);
    const dessus = () => titre.evaluate((e) => Math.round(e.getBoundingClientRect().top - e.closest("[aria-label='Aperçu']").getBoundingClientRect().top));
    await expect.poll(async () => { const d = await dessus(); return d >= 7 && d <= 9; }).toBe(true);
    // Étape 3 : Tab, le lien suivant ; Entrée l'ouvre à la ligne 12.
    await page.keyboard.press("Tab");
    const lienArgs = apercu.getByRole("link", { name: "tests/args.rs, ligne 12" });
    await expect(lienArgs).toBeFocused();
    await expect(lienArgs).toHaveAttribute("title", "Ouvrir ../tests/args.rs à la ligne 12 dans l'éditeur.");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: nomLigne("args.rs") })).toHaveAttribute("aria-selected", "true");
    await expect(pied).toContainText("Ln 12, Col 1");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[aria-label]")?.getAttribute("aria-label"))).toBe("Éditeur args.rs");
    // Étape 4 : adresse web, un nouvel onglet du navigateur.
    await ongletGuide.click();
    const nouvelle = context.waitForEvent("page");
    await apercu.getByRole("link", { name: "clap" }).click();
    const autre = await nouvelle;
    await autre.close().catch(() => {});
    expect(page.url()).toBe(yaide.origine + "/");
    await expect(ongletGuide).toHaveAttribute("aria-selected", "true");
    // AC-101-14, seconde moitié : un clic sur l'ancre focalise le titre sans contour.
    await ancre.click();
    await expect(titre).toBeFocused();
    expect(await titre.evaluate((e) => e.matches(":focus-visible"))).toBe(false);

    // Barre d'état à 800 px, branche longue, long lien survolé.
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    await page.setViewportSize({ width: 800, height: 800 });
    await expect(pied).toContainText("branche-xxx");
    await lignes.filter({ hasText: /^long$/ }).locator(".cm-hy-lien").hover();
    await expect(pied).toContainText("Ctrl+clic pour ouvrir");
    await expect(pied.locator(".ya-status-version")).toContainText(/v\d+\.\d+\.\d+/);
    const mesure = await pied.evaluate((f) => {
      const haut = (e) => Math.round(e.getBoundingClientRect().top);
      const tous = [...f.children].filter((e) => !e.hidden && e.getBoundingClientRect().width > 0);
      const lien = f.querySelector(".ya-status-lien");
      return {
        ecart: Math.max(...tous.map(haut)) - Math.min(...tous.map(haut)),
        hauteur: f.getBoundingClientRect().height,
        lienCoupe: lien.scrollWidth > lien.clientWidth,
        debord: f.scrollWidth - f.clientWidth,
        texte: f.textContent,
        coupes: [...f.querySelectorAll(".ya-status-position, .ya-status-langage, .ya-status-version, .ya-connexion")].map((e) => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().right <= f.getBoundingClientRect().right + 0.5),
      };
    });
    expect(mesure.lienCoupe).toBe(true);
    expect(mesure.debord).toBeLessThanOrEqual(0);
    expect(mesure.ecart).toBeLessThanOrEqual(1);
    expect(mesure.texte).toMatch(/Ln \d+, Col \d+/);
    expect(mesure.texte).toContain("Markdown");
    expect(mesure.texte).toContain("Connecté");
    expect(mesure.coupes.every(Boolean)).toBe(true);
  } finally {
    await yaide.arreter();
  }
});
