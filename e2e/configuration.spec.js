import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

test("REQ116_AC1_AC6_AC7_REQ117_AC5_AC18_parcours_85_86_dialogue_configuration", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "README.md"), "# Titre\n\nUn paragraphe.\n\nFin\n");
  const fichier = path.join(dossier, ".yaide", "markdown.json");
  const yaide = await lancerYaide({ dossier });
  try {
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne("README.md") }).click();
    await expect(page.getByRole("button", { name: "Mode hybride", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    const apercu = page.getByRole("region", { name: "Aperçu" });
    await expect(apercu).toBeVisible();
    const editeur = page.locator(".cm-content:visible");
    await editeur.click();
    await page.keyboard.press("Control+End");
    const titreEditeur = editeur.locator(".cm-line.cm-hy-titre1");
    await expect(titreEditeur).toHaveText("Titre");
    const titreApercu = apercu.getByRole("heading", { name: "Titre", exact: true });
    const couleur = (loc) => loc.evaluate((e) => getComputedStyle(e).color);
    // Couleur du texte visible : parent du nœud texte « Titre ».
    const couleurTexte = (loc) =>
      loc.evaluate((e) => {
        const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.includes("Titre")) return getComputedStyle(n.parentElement).color;
        return null;
      });
    const ink = () =>
      page.evaluate(() => {
        const s = document.createElement("span");
        s.style.color = "var(--ink)";
        document.body.append(s);
        const v = getComputedStyle(s).color;
        s.remove();
        return v;
      });

    const dlg = page.getByRole("dialog", { name: "Configuration" });
    const ouvrir = async () => {
      await page.keyboard.press("Control+p");
      await page.keyboard.type(">conf");
      await page.keyboard.press("Enter");
      await expect(dlg).toBeVisible();
    };
    const boite = async (loc) => (await loc.boundingBox()) ?? Promise.reject(new Error("élément invisible"));
    const reperes = async () => ({
      titre: await boite(dlg.getByRole("heading", { name: "Configuration" })),
      interface: await boite(dlg.getByRole("tab", { name: "Interface", exact: true })),
      couleurs: await boite(dlg.getByRole("tab", { name: "Couleurs markdown", exact: true })),
      fermer: await boite(dlg.getByRole("button", { name: "Fermer", exact: true })),
      enregistrer: await boite(dlg.getByRole("button", { name: "Enregistrer", exact: true })),
    });
    const dansFenetre = async (loc) => {
      const b = await boite(loc);
      const v = page.viewportSize();
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(v.width);
      expect(b.y + b.height).toBeLessThanOrEqual(v.height);
    };

    // P-085 : Ctrl+P, `>conf`, Entrée ; Maj+Tab puis Droite (AC-116-1, AC-116-7).
    await ouvrir();
    await expect(dlg.getByRole("tab", { name: "Interface", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(dlg.getByLabel("Panneau de gauche")).toBeVisible();
    const reperesInterface = await reperes();
    await page.keyboard.press("Shift+Tab");
    await expect(dlg.getByRole("tab", { name: "Interface", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    const tabCouleurs = dlg.getByRole("tab", { name: "Couleurs markdown", exact: true });
    await expect(tabCouleurs).toBeFocused();
    await expect(tabCouleurs).toHaveAttribute("aria-selected", "true");
    const ardoise = dlg.getByRole("button", { name: "Ardoise", exact: true });
    await expect(ardoise).toBeVisible();
    expect(await reperes()).toEqual(reperesInterface);

    // AC-117-5 : « Ardoise », « Enregistrer » → couleurs appliquées sans recharger.
    await ardoise.click();
    await dlg.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(dlg.getByRole("status")).toHaveText("Couleurs enregistrées.");
    await dansFenetre(dlg.getByRole("status"));
    await expect.poll(() => couleur(titreApercu)).toBe("rgb(138, 180, 248)");
    expect(await couleurTexte(titreEditeur)).toBe("rgb(138, 180, 248)");
    await dlg.getByRole("button", { name: "Fermer", exact: true }).click();
    await expect(dlg).toBeHidden();
    await page.getByRole("button", { name: "Thème clair" }).click();
    await expect.poll(() => couleur(titreApercu)).toBe("rgb(29, 79, 145)");
    expect(await couleurTexte(titreEditeur)).toBe("rgb(29, 79, 145)");

    // P-086 : fenêtre de 800 × 480 (AC-116-6, AC-117-18).
    await page.setViewportSize({ width: 800, height: 480 });
    await ouvrir();
    await dlg.getByRole("tab", { name: "Couleurs markdown", exact: true }).click();
    await dansFenetre(dlg);
    await dlg.getByRole("tab", { name: "Interface", exact: true }).click();
    await dansFenetre(dlg);
    await dansFenetre(dlg.getByRole("button", { name: "Enregistrer", exact: true }));
    await dlg.getByRole("tab", { name: "Couleurs markdown", exact: true }).click();
    await expect(dlg.getByLabel("Séparateur, couleur", { exact: true })).toBeAttached();
    await dlg.getByLabel("Séparateur, couleur", { exact: true }).scrollIntoViewIfNeeded();
    const entete = dlg.getByRole("combobox", { name: "Couleurs du thème" });
    await dansFenetre(entete);
    const haut = (await boite(dlg.getByRole("tabpanel"))).y;
    for (const nom of ["Élément", "Couleur", "Fond", "Bordure"]) {
      await dansFenetre(dlg.getByText(nom, { exact: true }));
      expect((await boite(dlg.getByText(nom, { exact: true }))).y).toBeGreaterThanOrEqual(haut);
    }
    expect((await boite(entete)).y).toBeGreaterThanOrEqual(haut);
    const sortie = dlg.getByRole("button", { name: "Fermer", exact: true });
    await dansFenetre(sortie);
    await dansFenetre(dlg.getByRole("button", { name: "Enregistrer", exact: true }));
    await dansFenetre(dlg.getByLabel("Séparateur, couleur", { exact: true }));

    // Un message de résultat reste visible, section défilée jusqu'à « Séparateur ».
    await dlg.getByRole("button", { name: "Sépia", exact: true }).click();
    await expect(dlg.getByRole("status")).toContainText("Palette Sépia posée");
    await dlg.getByLabel("Séparateur, couleur", { exact: true }).scrollIntoViewIfNeeded();
    await dansFenetre(dlg.getByRole("status"));
    await dansFenetre(dlg.getByRole("button", { name: "Fermer", exact: true }));
    await dansFenetre(dlg.getByLabel("Séparateur, couleur", { exact: true }));
    await dansFenetre(dlg.getByRole("button", { name: "Enregistrer", exact: true }));

    // `vert` refusé : le champ est amené sous l'en-tête, visible, avec le focus.
    const bordure = dlg.getByLabel("Citation, bordure", { exact: true });
    await bordure.fill("vert");
    await dlg.getByLabel("Séparateur, couleur", { exact: true }).scrollIntoViewIfNeeded();
    await dlg.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(dlg.getByRole("alert").filter({ hasText: "Bordure : tapez une couleur" })).toBeVisible();
    await expect(bordure).toBeFocused();
    await dansFenetre(bordure);
    const bas = (await boite(entete)).y + (await boite(entete)).height;
    expect((await boite(bordure)).y).toBeGreaterThanOrEqual(bas);

    // « Par défaut », « Enregistrer » → « Titre » revient en `--ink` ; le fichier vaut `{}`.
    await dlg.getByRole("button", { name: "Par défaut", exact: true }).click();
    await dlg.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(dlg.getByRole("status")).toHaveText("Couleurs enregistrées.");
    await expect.poll(() => couleur(titreApercu)).toBe(await ink());
    expect(await couleurTexte(titreEditeur)).toBe(await ink());
    expect(fs.readFileSync(fichier, "utf8")).toBe("{}\n");
  } finally {
    await yaide.arreter();
  }
});
