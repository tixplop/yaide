import { test, expect } from "@playwright/test";
import { lancerYaide, ouvrirYaide } from "./aides.js";

let yaide;
test.beforeEach(async () => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
});
test.afterEach(() => yaide.arreter());

const ecran = (page) => page.locator(".terminal:visible .xterm-rows");

async function lancerCat(page) {
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type("stty -ixon; cat -v");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
}

test("REQ019_AC4_ctrl_p_et_ctrl_s_vont_au_shell_et_n_ouvrent_rien", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.evaluate(() => {
    window.__touches = [];
    // Capture : xterm arrête la propagation des touches qu'il traite.
    document.addEventListener("keydown", (e) => window.__touches.push(e), true);
  });
  await lancerCat(page);
  await page.keyboard.press("Control+p");
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Enter");
  await expect(ecran(page)).toContainText("^P^S");
  const touches = await page.evaluate(() => window.__touches.map((e) => [e.key.toLowerCase(), e.defaultPrevented]));
  expect(touches).toContainEqual(["p", true]);
  expect(touches).toContainEqual(["s", true]);
  await expect(page.locator("dialog, [role=dialog]")).toHaveCount(0);
});

test("REQ019_AC7_ctrl_maj_f_dans_un_shell_met_le_focus_sur_le_rail_sans_rien_envoyer", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await lancerCat(page);
  await page.keyboard.press("Control+Shift+F");
  await expect(page.getByRole("tab", { name: "Fichiers" })).toBeFocused();
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const texte = await ecran(page).innerText();
  expect(texte).not.toMatch(/[fF]/);
  expect(texte).toContain("cat -v");
});
