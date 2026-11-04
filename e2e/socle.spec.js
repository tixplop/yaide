import { test, expect } from "@playwright/test";
import { lancerYaide } from "./aides.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Sous-dossier du mkdtemp : lancerYaide range cfg et home dans son parent.
function dossierSocle() {
  const d = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "socle-")), "projet");
  fs.mkdirSync(d);
  return d;
}

async function ouvrirPage(page, origine) {
  for (let i = 0; i < 50; i++) {
    try {
      await page.goto(origine + "/");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("le serveur ne répond pas");
}

test("REQ038_AC1_AC5_premier_affichage_sombre_color_scheme_dark_et_police_chargee", async ({ page }) => {
  const { origine, arreter } = await lancerYaide({ dossier: dossierSocle() });
  try {
    const externes = [];
    page.on("request", (r) => {
      if (!r.url().startsWith(origine) && !r.url().startsWith("data:")) externes.push(r.url());
    });
    await ouvrirPage(page, origine);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    expect(await page.evaluate(() => document.body.className)).toBe("ya");
    // La police se charge dès qu'un texte l'utilise (AC-036-11).
    await page.evaluate(() => {
      const e = document.createElement("span");
      e.textContent = "x";
      e.style.font = '13.5px "JetBrains Mono"';
      document.body.append(e);
    });
    await page.evaluate(() => document.fonts.load('13.5px "JetBrains Mono"'));
    expect(await page.evaluate(() => document.fonts.check('13.5px "JetBrains Mono"'))).toBe(true);
    expect(externes).toEqual([]);
  } finally {
    await arreter();
  }
});

test("REQ038_AC3_AC5_le_theme_garde_est_pose_des_le_premier_rendu_sans_passer_par_l_autre", async ({ page }) => {
  const { origine, arreter } = await lancerYaide({ dossier: dossierSocle() });
  try {
    await ouvrirPage(page, origine);
    await page.evaluate(() => localStorage.setItem("yaide-theme", "light"));
    // Chaque pose de data-theme est consignée avec l'ancienne valeur : la première pose part de rien.
    await page.addInitScript(() => {
      window.__themes = [];
      new MutationObserver((ms) => ms.forEach((m) => window.__themes.push(m.oldValue))).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-theme"],
        attributeOldValue: true,
      });
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
    expect(await page.evaluate(() => window.__themes)).toEqual([null]);
  } finally {
    await arreter();
  }
});

test("REQ029_AC3_la_page_se_charge_sans_requete_vers_une_autre_origine", async ({ page }) => {
  const { origine, arreter } = await lancerYaide({ dossier: dossierSocle() });
  try {
    const externes = [];
    page.on("request", (r) => {
      if (!r.url().startsWith(origine)) externes.push(r.url());
    });
    for (let i = 0; i < 50; i++) {
      try {
        await page.goto(origine + "/");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await expect(page.locator("#app h1")).toHaveText("yaide");
    expect(externes).toEqual([]);
  } finally {
    await arreter();
  }
});
