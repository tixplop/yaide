import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lancerYaide, ouvrirYaide } from "./aides.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

/** Dossier d'un faux `claude` qui reste en attente. */
function fauxClaude() {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-claude-"));
  fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexec /bin/sh\n", { mode: 0o755 });
  return bin;
}

const ecran = (page) => page.locator(".terminal:visible .xterm-rows");

test("REQ183_AC1_AC10_parcours_shell_avec_un_environnement_et_menus_entiers_dans_la_fenetre", async ({ page }) => {
  yaide = await lancerYaide({ shell: "/bin/sh", claude: fauxClaude() });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  // Les environnements sont créés par la route du panneau (même écriture que son formulaire).
  for (const [nom, valeur] of [["test", "test"], ["prod", "prod"]]) {
    const r = await page.evaluate(
      ([n, v]) => fetch("/api/environnements", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nom: n, variables: { YA_ENV: v } }) }).then((x) => x.status),
      [nom, valeur],
    );
    expect(r).toBe(200);
  }
  const nouveau = page.getByRole("button", { name: "Nouveau shell", exact: true });
  await nouveau.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Nouveau shell avec un environnement" });
  await expect(menu.getByRole("menuitem")).toHaveText(["prod", "test"]);
  await expect(nouveau).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "shell 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(nouveau.locator(".ya-badge")).toHaveText("1");
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await expect(page.locator(".terminal:visible .xterm-helper-textarea")).toBeFocused();
  await page.keyboard.type("echo ENV=$YA_ENV=");
  await page.keyboard.press("Enter");
  await expect(ecran(page)).toContainText("ENV=test=");

  // Menus entiers dans la fenêtre, à droite de « Nouveau shell » et à gauche de « Claude », à deux tailles.
  const claude = page.getByRole("button", { name: "Claude", exact: true });
  for (const [largeur, hauteur] of [[1280, 800], [800, 480]]) {
    await page.setViewportSize({ width: largeur, height: hauteur });
    await nouveau.click({ button: "right" });
    const m = page.getByRole("menu", { name: "Nouveau shell avec un environnement" });
    await expect(m).toBeVisible();
    const b = await nouveau.boundingBox();
    const r = await m.boundingBox();
    expect(r.x).toBeGreaterThanOrEqual(b.x + b.width);
    expect(r.x + r.width).toBeLessThanOrEqual(largeur);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.height).toBeLessThanOrEqual(hauteur);
    await page.keyboard.press("Escape");
    await expect(nouveau).toBeFocused();
    await expect(nouveau).toHaveAttribute("aria-expanded", "false");
    await claude.click({ button: "right" });
    const mc = page.getByRole("menu", { name: "Nouvelle session Claude avec un environnement" });
    await expect(mc).toBeVisible();
    const bc = await claude.boundingBox();
    const rc = await mc.boundingBox();
    expect(rc.x + rc.width).toBeLessThanOrEqual(bc.x);
    expect(rc.x).toBeGreaterThanOrEqual(0);
    expect(rc.y).toBeGreaterThanOrEqual(0);
    expect(rc.y + rc.height).toBeLessThanOrEqual(hauteur);
    await page.keyboard.press("Escape");
    await expect(claude).toBeFocused();
  }
});
