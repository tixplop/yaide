import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { depotExemple, lancerYaide, nomLigne, ouvrirYaide, tailleStable, avancer, temoin } from "./aides.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

/** Dossier d'un faux `claude`, le script donné. */
function fauxClaude(script) {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-claude-"));
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return bin;
}

const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const onglet = (page, nom) => page.getByRole("tab", { name: nom, exact: typeof nom === "string" });
const boutonClaude = (page) => page.getByRole("button", { name: "Claude", exact: true });
const saisie = (page) => page.locator(".claude .xterm-helper-textarea");
const ecran = (page) => page.locator(".claude .xterm-rows");

test("REQ068_parcours_30_session_a_cote_du_code", async ({ page }) => {
  await page.clock.install();
  const dossier = depotExemple();
  const args = path.join(dossier, "src", "args.rs");
  fs.writeFileSync(args, "fn args() {}\n");
  // Le faux Claude attend une ligne, la note dans src/args.rs, puis laisse un shell.
  yaide = await lancerYaide({ dossier, claude: fauxClaude('read demande\necho "// $demande" >> src/args.rs\nexec /bin/sh') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await ligne(page, "src").click();
  await ligne(page, "args.rs").click();
  await expect(page.getByRole("textbox", { name: "Éditeur args.rs" })).toBeFocused();

  // 1. Le bouton et son info-bulle.
  await expect(page.locator(".cadre-rail-droit").getByRole("button")).toHaveCount(4);
  const bulle = page.getByRole("tooltip");
  await boutonClaude(page).hover();
  await avancer(page, () => expect(bulle).toHaveText("Nouvelle session Claude", { timeout: 300 }));

  // 2. Un clic ouvre « Claude 1 », actif, le focus dans son terminal.
  await boutonClaude(page).click();
  await expect(onglet(page, "Claude 1")).toHaveAttribute("aria-selected", "true");
  await expect(saisie(page)).toBeFocused();
  await expect(page.locator(".cadre-etat")).not.toContainText("Rust");
  await expect(page.locator(".cadre-etat")).toHaveText(/^masterServeur : ConnectéYaide v\d+\.\d+\.\d+$/);

  // 3. Claude écrit dans args.rs ; l'onglet du fichier montre le nouveau contenu (AC-068-12).
  await expect(page.locator(".claude .terminal-attente")).toBeHidden(); // connecté : la frappe n'est plus perdue
  await page.keyboard.type("ajoute un test");
  await page.keyboard.press("Enter");
  await onglet(page, /^args\.rs/).click();
  await avancer(page, () => expect(page.getByRole("textbox", { name: "Éditeur args.rs" })).toContainText("// ajoute un test", { timeout: 300 }));

  // 4. Ctrl+P part au terminal ; Ctrl+Maj+F sort le focus vers le rail.
  await onglet(page, "Claude 1").click();
  await expect(saisie(page)).toBeFocused();
  await page.keyboard.press("Control+p");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+F");
  await expect(page.getByRole("tab", { name: "Fichiers" })).toBeFocused();

  // 5. Le temps reprend son cours : la taille du terminal se règle sur des minuteries. La poignée du panneau change la largeur : le terminal transmet sa nouvelle taille (AC-068-6).
  await page.clock.resume();
  await onglet(page, "Claude 1").click();
  const avant = await tailleStable(page);
  const sep = await page.getByRole("separator", { name: "Largeur du panneau" }).boundingBox();
  const x = sep.x + sep.width / 2;
  await page.mouse.move(x, sep.y + 100);
  await page.mouse.down();
  await page.mouse.move(x + 40, sep.y + 100, { steps: 6 });
  await page.mouse.up();
  const apres = await tailleStable(page);
  expect(apres).not.toBe(avant);
  await saisie(page).focus();
  await page.keyboard.press("Control+u"); // efface le ^P resté sur la ligne
  await page.keyboard.type("stty size");
  await page.keyboard.press("Enter");
  await expect(ecran(page)).toContainText(apres);

  // 6. Rechargement : les deux onglets reviennent, le focus sur « Claude 1 ; Entrée y met le focus dans le terminal.
  await page.reload();
  await expect(onglet(page, "Claude 1")).toHaveAttribute("aria-selected", "true");
  await expect(onglet(page, /^args\.rs/)).toBeVisible();
  await expect(onglet(page, "Claude 1")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(saisie(page)).toBeFocused();

  // 7. `exit 0` : l'onglet se ferme, args.rs devient actif.
  await expect(page.locator(".claude .terminal-attente")).toBeHidden();
  await page.keyboard.type("exit 0");
  await page.keyboard.press("Enter");
  await expect(onglet(page, "Claude 1")).toHaveCount(0);
  await expect(onglet(page, /^args\.rs/)).toHaveAttribute("aria-selected", "true");
});

test("REQ068_parcours_31_erreur_puis_deux_sessions", async ({ page }) => {
  const dejaEchoue = temoin();
  yaide = await lancerYaide({
    claude: fauxClaude(`if [ ! -e "${dejaEchoue}" ]; then touch "${dejaEchoue}"; echo "Error: Claude Code requires Node.js version 18 or higher."; exit 1; fi\nexec /bin/sh`),
  });
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();

  // 1. Le premier lancement échoue : le message, le dernier affichage, l'onglet reste.
  await boutonClaude(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Claude Code s'est arrêté (code 1). Corrigez l'erreur ci-dessous, puis relancez Claude." })).toBeVisible();
  await expect(page.locator(".claude .xterm-rows")).toContainText("Claude Code requires Node.js version 18 or higher.");
  await expect(onglet(page, "Claude 1")).toBeVisible();

  // 2. La croix ferme l'onglet et le message.
  await page.getByRole("button", { name: "Fermer Claude 1" }).click();
  await expect(onglet(page, "Claude 1")).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Claude Code s'est arrêté" })).toHaveCount(0);

  // 3. Deux sessions à 800 × 480 : « Claude 2 » actif, le rail droit entier dans la fenêtre.
  await boutonClaude(page).click();
  await expect(onglet(page, "Claude 1")).toBeVisible();
  await boutonClaude(page).click();
  await expect(onglet(page, "Claude 2")).toHaveAttribute("aria-selected", "true");
  const visible = page.locator(".claude:visible");
  await expect(visible.locator(".xterm-rows")).toContainText("$");
  await visible.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo deux");
  await page.keyboard.press("Enter");
  await expect(visible.locator(".xterm-rows")).toContainText("deux");
  await onglet(page, "Claude 1").click();
  await expect(visible).toHaveCount(1);
  await expect(visible.locator(".xterm-rows")).not.toContainText("deux");
  await visible.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo un");
  await page.keyboard.press("Enter");
  await expect(visible.locator(".xterm-rows")).toContainText("un");
  await onglet(page, "Claude 2").click();
  await expect(visible).toHaveCount(1);
  await expect(visible.locator(".xterm-rows")).toContainText("deux");
  await expect(visible.locator(".xterm-rows")).not.toContainText("echo un");
  await onglet(page, "main.rs").click();
  await expect(visible).toHaveCount(0);
  await expect(page.locator(".cm-editor:visible")).toHaveCount(1);
  await onglet(page, "Claude 2").click();
  const b = await boutonClaude(page).boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(480);
  expect(b.x + b.width).toBeLessThanOrEqual(800);

  // 4. Menu des onglets : « Fermer tous les onglets » ferme les deux sessions et le fichier.
  await onglet(page, "Claude 1").click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions sur Claude 1" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Fermer tous les onglets" }).click();
  await expect(page.getByRole("tab", { name: /^Claude \d$/ })).toHaveCount(0);
  await expect(page.getByText("Aucun fichier ouvert.")).toBeVisible();
});
