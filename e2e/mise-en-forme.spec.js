import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

// P-130 et P-131 : barre « Mise en forme » du mode hybride markdown dans le navigateur (REQ-169, REQ-170).
// Un seul lancement de Yaide ; le reste est prouvé par les tests de composant (barre-md.test.js, mise-en-forme.test.js).
const ligne = (page, nom) => page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne(nom) });
const rect = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bas: r.bottom, droite: r.right }; });

test("REQ169_AC9_REQ170_AC6_AC12_AC14_AC15_AC16_parcours_P130_P131_barre_mise_en_forme", async ({ page }) => {
  const dossier = depotExemple();
  const lignes = Array.from({ length: 80 }, (_, i) => `ligne ${i + 1}`);
  fs.writeFileSync(path.join(dossier, "notes.md"), ["Intro", "Suite", ...lignes].join("\n") + "\n");
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await ligne(page, "notes.md").click();
    const barre = page.getByRole("toolbar", { name: "Mise en forme" });
    const editeur = page.locator(".cm-editor:visible");
    const contenu = page.locator(".cm-content:visible");
    await expect(barre).toBeVisible();
    await expect(barre.getByRole("button")).toHaveCount(15);

    // AC-170-12 : barre sous le fil d'Ariane, éditeur et ligne 1 sous la barre.
    const fil = await rect(page.locator(".ya-crumbs:visible"));
    const b = await rect(barre);
    expect(b.y).toBeGreaterThanOrEqual(fil.bas - 1);
    expect(b.h).toBeLessThanOrEqual(40);
    expect((await rect(editeur)).y).toBeGreaterThanOrEqual(b.bas - 1);
    expect((await rect(page.locator(".cm-line:visible").first())).y).toBeGreaterThanOrEqual(b.bas - 1);

    // AC-170-12 : le défilement ne déplace pas la barre ; un clic ne fait pas défiler et le focus reste dans l'éditeur.
    await page.evaluate(() => { document.querySelector(".cm-scroller").scrollTop = 300; });
    const haut = await page.evaluate(() => document.querySelector(".cm-scroller").scrollTop);
    expect(await rect(barre)).toEqual(b);
    await page.locator(".cm-line:visible", { hasText: /^ligne 25$/ }).dblclick();
    await barre.getByRole("button", { name: "Gras" }).click();
    expect(await page.evaluate(() => document.querySelector(".cm-scroller").scrollTop)).toBe(haut);
    await expect(contenu).toBeFocused();
    await expect(contenu.locator(".cm-line", { hasText: "**" })).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await expect(contenu.locator(".cm-line", { hasText: "**" })).toHaveCount(0);

    // AC-169-9 : Ctrl+B et Ctrl+U n'appellent aucune action du navigateur (l'éditeur prend l'événement).
    await page.evaluate(() => {
      window.__defauts = [];
      window.addEventListener("keydown", (e) => e.ctrlKey && e.key !== "Control" && window.__defauts.push([e.key, e.defaultPrevented]));
    });
    await page.keyboard.press("Control+b");
    await page.keyboard.press("Control+u");
    expect(await page.evaluate(() => window.__defauts)).toEqual([["b", true], ["u", true]]);
    expect(page.context().pages().length).toBe(1);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");

    // AC-170-6 : Tableau sous « Intro », aussitôt rendu, sous un seul numéro ; Ctrl+Z puis Ctrl+Y.
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("End");
    await barre.getByRole("button", { name: "Tableau" }).click();
    await expect(page.locator(".cm-hy-tableau:visible table th")).toHaveText(["Colonne 1", "Colonne 2"]);
    await expect(page.locator(".cm-hy-tableau:visible table tbody tr")).toHaveCount(2);
    const numeros = await page.locator(".cm-lineNumbers .cm-gutterElement").allTextContents();
    expect(numeros).toEqual(expect.arrayContaining(["3", "7"]));
    for (const n of ["4", "5", "6"]) expect(numeros).not.toContain(n);
    await expect(contenu).toBeFocused();
    await page.keyboard.press("Control+z");
    await expect(page.locator(".cm-hy-tableau:visible")).toHaveCount(0);
    await page.keyboard.press("Control+y");
    await expect(page.locator(".cm-hy-tableau:visible")).toHaveCount(1);
    await page.keyboard.press("Control+z");

    // AC-170-14 : Alt+F10 sur « Titre », sélection gardée ; Échap rend le focus à l'éditeur.
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Alt+F10");
    await expect(barre.getByRole("button", { name: "Titre" })).toBeFocused();
    expect(await page.evaluate(() => getSelection().toString())).toBe("Intro");
    await page.keyboard.press("End");
    await page.keyboard.press("Escape");
    await expect(contenu).toBeFocused();
    await page.keyboard.press("Alt+F10");
    await expect(barre.getByRole("button", { name: "Séparateur" })).toBeFocused();
    await page.keyboard.press("Escape");

    // AC-170-16 : info-bulle « Gras (Ctrl+B) » au-dessus de la barre.
    await barre.getByRole("button", { name: "Gras" }).hover();
    const bulle = page.getByRole("tooltip", { name: "Gras (Ctrl+B)" });
    await expect(bulle).toBeVisible();
    expect((await rect(bulle)).bas).toBeLessThanOrEqual((await rect(barre)).y + 1);
    await page.mouse.move(0, 0);

    // AC-170-12 : icônes à 3:1 sur le fond de la barre, dans les deux thèmes.
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      const ratio = await barre.evaluate((el) => {
        const nombres = (t) => t.match(/[\d.]+/g).map(Number);
        const lum = (c) => c.slice(0, 3).map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
        const a = lum(nombres(getComputedStyle(el.querySelector("button")).color));
        const f = lum(nombres(getComputedStyle(el).backgroundColor));
        return (Math.max(a, f) + 0.05) / (Math.min(a, f) + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(3);
    }

    // AC-170-15 : à 1024 px avec l'aperçu, la barre couvre la moitié éditeur, l'aperçu commence à sa hauteur.
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.getByRole("button", { name: "Aperçu" }).click();
    const apercu = page.locator(".zone-code-apercu:visible");
    await expect(apercu).toBeVisible();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Shift+End");
    await barre.getByRole("button", { name: "Souligné" }).click();
    await expect(apercu.locator("u")).toHaveText("Intro");
    expect(await apercu.locator("u").evaluate((u) => getComputedStyle(u).textDecorationLine)).toContain("underline");
    const rangs = async () => {
      const boites = await barre.getByRole("button").evaluateAll((bs) => bs.map((x) => x.getBoundingClientRect()));
      return new Set(boites.map((r) => Math.round(r.top))).size;
    };
    const demi = await rect(page.locator(".zone-code-editeur:visible"));
    const bb = await rect(barre);
    expect(bb.droite).toBeLessThanOrEqual(demi.droite + 1);
    expect(Math.abs((await rect(apercu)).y - bb.y)).toBeLessThanOrEqual(1);
    expect(await rangs()).toBeLessThanOrEqual(2);

    // Éditeur de 320 px : quinze boutons entiers, deux rangs, pas de défilement, ligne 1 sous la barre.
    await page.locator(".zone-code-editeur:visible").evaluate((e) => { e.style.flex = "0 0 320px"; });
    expect(await rangs()).toBe(2);
    const etroit = await rect(barre);
    expect(etroit.w).toBeLessThanOrEqual(321);
    const dim = await barre.evaluate((e) => [e.scrollWidth, e.clientWidth]);
    expect(dim[0]).toBe(dim[1]);
    for (const r of await barre.getByRole("button").evaluateAll((bs) => bs.map((x) => x.getBoundingClientRect()))) {
      expect(r.left).toBeGreaterThanOrEqual(etroit.x - 1);
      expect(r.right).toBeLessThanOrEqual(etroit.droite + 1);
    }
    expect((await rect(page.locator(".cm-line:visible").first())).y).toBeGreaterThanOrEqual(etroit.bas - 1);
  } finally {
    await yaide.arreter();
  }
});

// P-132 : cases à cocher du mode hybride et de l'aperçu (REQ-171).
test("REQ171_AC5_AC6_AC7_AC8_AC9_AC10_parcours_P132_cases_a_cocher", async ({ page }) => {
  const dossier = depotExemple();
  const source = ["# Projet", "", "## À faire", "- [ ] Envoyer le devis", "- [x] Réserver la salle", "- [ ] Préparer les tests", "  - [ ] Tests de l'analyse", "", "", "Notes : 1", ""].join("\n");
  const fichier = path.join(dossier, "notes.md");
  fs.writeFileSync(fichier, source);
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await ligne(page, "notes.md").click();
    const contenu = page.locator(".cm-content:visible");
    const etat = page.getByText(/Ln \d+, Col \d+/);
    await contenu.click();
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowDown");
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
    await expect(etat).toHaveText("Ln 10, Col 9");
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    const apercu = page.locator(".zone-code-apercu:visible");
    await expect(apercu.getByRole("checkbox")).toHaveCount(4);
    const cases = contenu.locator("input.ya-case-hy");
    await expect(cases).toHaveCount(4);
    // Ni puce ni crochets sur les lignes des cases.
    await expect(contenu.locator(".cm-line", { hasText: "Envoyer le devis" })).toHaveText("Envoyer le devis");
    await expect(cases.nth(1)).toBeChecked();
    await expect(apercu.getByRole("checkbox", { name: "Réserver la salle" })).toBeChecked();

    await contenu.focus();
    await expect(etat).toHaveText("Ln 10, Col 9");
    // Clic sur la case de l'éditeur : coche des deux côtés, curseur et focus inchangés.
    await cases.first().click();
    await expect(cases.first()).toBeChecked();
    await expect(apercu.getByRole("checkbox", { name: "Envoyer le devis" })).toBeChecked();
    await expect(etat).toHaveText("Ln 10, Col 9");
    await expect(contenu).toBeFocused();
    expect(await page.evaluate(() => document.activeElement.classList.contains("cm-content"))).toBe(true);
    await expect(contenu.locator(".cm-line", { hasText: "Envoyer le devis" })).toHaveText("Envoyer le devis");
    // Le contour passe à --ink au survol.
    await cases.nth(2).hover();
    const [contour, ink] = await cases.nth(2).evaluate((c) => {
      const t = document.createElement("span");
      t.style.color = "var(--ink)";
      document.body.append(t);
      const ink = getComputedStyle(t).color;
      t.remove();
      return [getComputedStyle(c).borderTopColor, ink];
    });
    expect(contour).toBe(ink);
    await page.mouse.move(0, 0);

    // Échap puis Tab : la case de l'aperçu a le focus ; Tab deux fois, Espace coche la troisième.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    const premiere = apercu.getByRole("checkbox", { name: "Envoyer le devis" });
    await expect(premiere).toBeFocused();
    expect(await premiere.evaluate((c) => getComputedStyle(c).outlineWidth)).toBe("2px");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const troisieme = apercu.getByRole("checkbox", { name: "Préparer les tests" });
    await expect(troisieme).toBeFocused();
    await page.keyboard.press("Space");
    await expect(troisieme).toBeChecked();
    await expect(troisieme).toBeFocused();
    await expect(cases.nth(2)).toBeChecked();

    // Clic en fin de ligne 10, Ctrl+Z : la dernière case se décoche des deux côtés, en un pas.
    await contenu.locator(".cm-line", { hasText: "Notes : 1" }).click({ position: { x: 300, y: 5 } });
    await expect(etat).toHaveText("Ln 10, Col 10");
    await page.keyboard.press("Control+z");
    await expect(troisieme).not.toBeChecked();
    await expect(cases.nth(2)).not.toBeChecked();
    await expect(apercu.getByRole("checkbox", { name: "Envoyer le devis" })).toBeChecked();

    // Haut jusqu'à la ligne 4 : texte avec marques ; les autres lignes gardent leurs cases. Ctrl+S écrit `[x]`.
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowUp");
    await expect(contenu.locator(".cm-line", { hasText: "Envoyer le devis" })).toHaveText("- [x] Envoyer le devis");
    await expect(cases).toHaveCount(3);
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(fichier, "utf8")).toBe(source.replace("- [ ] Envoyer", "- [x] Envoyer"));
  } finally {
    await yaide.arreter();
  }
});
