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

test("REQ202_AC3_AC8_parcours_environnement_par_defaut_cochee_dans_la_fiche_clic_simple_shell_et_claude_le_menu_l_emporte", async ({ page }) => {
  yaide = await lancerYaide({ shell: "/bin/sh", claude: fauxClaude() });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  for (const v of ["prod", "dev"]) {
    const r = await page.evaluate(
      (n) => fetch("/api/environnements", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nom: n, variables: { YA_ENV: n } }) }).then((x) => x.status),
      v,
    );
    expect(r).toBe(200);
  }
  // 1 à 3. Fiche de « prod » : la case « Environnement par défaut », cochée, puis « par défaut » sur sa ligne seule.
  await page.keyboard.press("Control+p");
  await page.keyboard.type(">env");
  await page.keyboard.press("Enter");
  const panneau = page.getByRole("dialog", { name: "Environnements" });
  await panneau.getByRole("button", { name: "Modifier prod" }).click();
  const defaut = panneau.getByRole("checkbox", { name: "Environnement par défaut" });
  await expect(defaut).not.toBeChecked();
  await defaut.check();
  await panneau.getByRole("button", { name: "Enregistrer" }).click();
  await expect(panneau.getByText("Environnement prod enregistré. Il servira au prochain lancement.")).toBeVisible();
  await expect(panneau.getByText("par défaut", { exact: true })).toHaveCount(1);
  await expect(panneau.getByRole("listitem").filter({ hasText: "prod" }).getByText("par défaut")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panneau).toBeHidden();

  // 4. Clic simple : shell et Claude avec `YA_ENV=prod`, noms d'onglet et focus d'un clic simple.
  const nouveau = page.getByRole("button", { name: "Nouveau shell", exact: true });
  await nouveau.click();
  await expect(page.getByRole("tab", { name: "shell 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".shells .terminal:visible .xterm-helper-textarea")).toBeFocused();
  await expect(page.locator(".shells .terminal:visible .terminal-attente")).toBeHidden();
  await page.keyboard.type("echo ENV=$YA_ENV=");
  await page.keyboard.press("Enter");
  await expect(page.locator(".shells .terminal:visible .xterm-rows")).toContainText("ENV=prod=");
  await page.getByRole("button", { name: "Claude", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Claude 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".claude .xterm-helper-textarea")).toBeFocused();
  await expect(page.locator(".claude .terminal-attente")).toBeHidden();
  await page.keyboard.type("echo CL=$YA_ENV=");
  await page.keyboard.press("Enter");
  await expect(page.locator(".claude .xterm-rows")).toContainText("CL=prod=");

  // 6. « dev » choisi dans le menu l'emporte.
  await nouveau.click({ button: "right" });
  await page.getByRole("menuitem", { name: "dev", exact: true }).click();
  await expect(page.getByRole("tab", { name: "shell 3", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".shells .terminal:visible .xterm-helper-textarea")).toBeFocused();
  await expect(page.locator(".shells .terminal:visible .terminal-attente")).toBeHidden();
  await page.keyboard.type("echo ENV=$YA_ENV=");
  await page.keyboard.press("Enter");
  await expect(page.locator(".shells .terminal:visible .xterm-rows")).toContainText("ENV=dev=");
});
