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

test("REQ032_AC11_glisser_une_poignee_au_dessus_du_terminal_laisse_la_frappe_au_shell", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await lancerCat(page);
  const sep = page.getByRole("separator", { name: "Largeur du panneau" });
  const valeur = async () => Number(await sep.getAttribute("aria-valuenow"));
  const avant = await valeur();
  const p = await sep.boundingBox();
  const x = p.x + p.width / 2;
  await page.mouse.move(x, p.y + 100);
  await page.mouse.down();
  await page.mouse.move(x + 50, p.y + p.height - 20, { steps: 5 });
  await page.mouse.up();
  expect(await valeur()).toBe(avant + 50);
  await expect(page.locator(".terminal:visible .xterm-helper-textarea")).toBeFocused();
  await page.keyboard.type("bonjour");
  await expect(ecran(page)).toContainText("bonjour");
});

test("REQ031_AC5_l_info_bulle_d_un_onglet_du_rail_donne_son_nom_et_sa_touche", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("tab", { name: "Recherche" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Recherche (R)");
});

test("REQ034_AC1_AC11_AC16_clic_droit_touche_menu_et_maj_f10_ouvrent_une_seule_fois_et_echap_rend_le_focus", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const ligne = page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: "README.md", exact: true });
  await ligne.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions sur README.md" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ligne).toBeFocused();
  for (const touche of ["ContextMenu", "Shift+F10"]) {
    await ligne.focus();
    await page.keyboard.press(touche);
    await expect(page.getByRole("menu")).toHaveCount(1);
    await expect(page.getByRole("menuitem", { name: "Nouveau fichier" })).toBeFocused();
    await page.waitForTimeout(700);
    await expect(page.getByRole("menu")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(ligne).toBeFocused();
  }
  await ligne.focus();
  await page.keyboard.press("ContextMenu");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Git" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
});
