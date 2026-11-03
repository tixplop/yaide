import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide } from "./aides.js";

let yaide;
test.beforeEach(async () => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
});
test.afterEach(() => yaide.arreter());

const main = () => path.join(yaide.dossier, "src", "main.rs");

async function ouvrirMain(page) {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("treeitem", { name: "src", exact: true }).click();
  await page.getByRole("treeitem", { name: "main.rs", exact: true }).click();
  await expect(page.getByLabel("Éditeur main.rs")).toBeFocused();
}

/** Zone du cadre où se trouve l'élément qui a le focus. */
const zoneDuFocus = (page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    if (e.closest("header")) return "barre";
    if (e.getAttribute("role") === "separator") return e.getAttribute("aria-label");
    if (e.closest(".cadre-rail")) return "rail";
    if (e.closest(".cadre-panneau")) return "panneau";
    if (e.closest(".cadre-onglets")) return "onglets de fichiers";
    if (e.closest(".cadre-code")) return "éditeur";
    if (e.closest(".cadre-shells")) {
      if (e.classList.contains("xterm-helper-textarea")) return "terminal";
      if (e.getAttribute("role") === "tab") return "onglets de shells";
      return e.getAttribute("aria-label") ?? e.textContent;
    }
    return "autre";
  });

test("REQ028_AC8_AC7_ordre_de_Tab_complet_et_contour_de_focus_a_chaque_arret", async ({ page }) => {
  await ouvrirMain(page);
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await page.getByRole("button", { name: "Déconnexion" }).focus();
  const zones = ["barre"];
  for (let i = 0; i < 40 && zones.at(-1) !== "terminal"; i++) {
    // Dans l'éditeur, Tab indente : on le quitte par Échap puis Tab.
    if (zones.at(-1) === "éditeur") await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    const z = await zoneDuFocus(page);
    const contour = await page.evaluate(() => {
      const e = document.activeElement;
      const s = getComputedStyle(e);
      // Le contour peut être porté par l'élément ou par la zone qui le contient (éditeur, terminal).
      const z = e.closest(".zone-code, .terminal-zone");
      const t = z ? getComputedStyle(z) : s;
      return [s.outlineStyle !== "none" && s.outlineWidth !== "0px", t.outlineStyle !== "none" && t.outlineWidth !== "0px"];
    });
    expect(contour.some(Boolean), `contour absent à l'arrêt ${i} (${z})`).toBe(true);
    if (z !== zones.at(-1)) zones.push(z);
  }
  expect(zones).toEqual(["barre", "rail", "panneau", "Largeur du panneau", "onglets de fichiers", "éditeur", "Hauteur des shells", "onglets de shells", "Nouveau shell", "terminal"]);
  const contourTerminal = await page.locator(".terminal-zone:visible").evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(contourTerminal).not.toBe("none");
});

test("REQ028_AC9_800_par_480_avec_fichier_et_deux_shells_rien_ne_se_superpose", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirMain(page);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(page.getByRole("tab", { name: "shell 2" })).toBeVisible();
  const zones = await page.evaluate(() =>
    [".cadre-barre", ".cadre-rail", ".cadre-panneau", ".cadre-onglets", ".cadre-code", ".cadre-shells"].map((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { s, x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  for (const z of zones) expect(z.w * z.h, z.s).toBeGreaterThan(0);
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      const recouvre = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      expect(recouvre, `${a.s} / ${b.s}`).toBe(false);
    }
  const debord = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(debord).toBeLessThanOrEqual(0);
});

test("REQ028_AC10_dialogue_ouvert_les_raccourcis_sont_sans_effet_et_le_focus_revient", async ({ page }) => {
  const avant = fs.readFileSync(main(), "utf8");
  await ouvrirMain(page);
  await page.keyboard.type("// brouillon\n");
  await expect(page.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await page.keyboard.press("Control+p");
  const dialogue = page.getByRole("dialog", { name: "Ouvrir un fichier" });
  await expect(dialogue).toBeVisible();
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Control+p");
  await page.keyboard.press("Control+Shift+F");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialogue).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Chemin du fichier" })).toBeFocused();
  expect(fs.readFileSync(main(), "utf8")).toBe(avant);
  await expect(page.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Éditeur main.rs")).toBeFocused();
  await page.waitForTimeout(300);
  expect(fs.readFileSync(main(), "utf8")).toBe(avant);
});

test("REQ032_AC6_800_par_480_avec_les_tailles_extremes_rien_ne_se_superpose", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await ouvrirMain(page);
  await page.getByRole("separator", { name: "Largeur du panneau" }).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  await page.getByRole("separator", { name: "Hauteur des shells" }).focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowUp");
  await page.setViewportSize({ width: 800, height: 480 });
  await expect.poll(() => page.getByRole("separator", { name: "Largeur du panneau" }).getAttribute("aria-valuenow")).toBe("436");
  await expect.poll(() => page.getByRole("separator", { name: "Hauteur des shells" }).getAttribute("aria-valuenow")).toBe("320");
  const zones = await page.evaluate(() =>
    [".cadre-barre", ".cadre-rail", ".cadre-panneau", ".cadre-code", ".cadre-shells"].map((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { s, x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  const code = zones.find((z) => z.s === ".cadre-code");
  const shells = zones.find((z) => z.s === ".cadre-shells");
  expect(code.w).toBeGreaterThanOrEqual(320 - 1);
  const haut = await page.evaluate(() => document.querySelector(".cadre-onglets").getBoundingClientRect().y);
  expect(code.y + code.h - haut).toBeGreaterThanOrEqual(120 - 1);
  expect(shells.h).toBeGreaterThanOrEqual(120 - 1);
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      expect(a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5, `${a.s} / ${b.s}`).toBe(false);
    }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
