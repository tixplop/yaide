import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function portLibre() {
  return new Promise((res) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function lancerYaide(dossier, port) {
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(dossier, "cfg") };
  spawnSync("target/debug/yaide", ["passwd"], { input: "mdp\n", env });
  return spawn("target/debug/yaide", [dossier, "--port", String(port)], { stdio: "ignore", env });
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
  const port = await portLibre();
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "socle-"));
  const proc = await lancerYaide(dossier, port);
  try {
    const origine = `https://127.0.0.1:${port}`;
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
    proc.kill();
  }
});

test("REQ038_AC3_AC5_le_theme_garde_est_pose_des_le_premier_rendu_sans_passer_par_l_autre", async ({ page }) => {
  const port = await portLibre();
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "socle-"));
  const proc = await lancerYaide(dossier, port);
  try {
    const origine = `https://127.0.0.1:${port}`;
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
    proc.kill();
  }
});

test("REQ029_AC3_la_page_se_charge_sans_requete_vers_une_autre_origine", async ({ page }) => {
  const port = await portLibre();
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "socle-"));
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(dossier, "cfg") };
  spawnSync("target/debug/yaide", ["passwd"], { input: "mdp\n", env });
  const proc = spawn("target/debug/yaide", [dossier, "--port", String(port)], { stdio: "ignore", env });
  try {
    const origine = `https://127.0.0.1:${port}`;
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
    proc.kill();
  }
});
