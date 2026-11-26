import { test, expect } from "@playwright/test";
import { lancerYaide, ouvrirYaide } from "./aides.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

test("REQ189_AC8_parcours_P149_ctrl_p_mcp_adresse_copie_et_echap", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  yaide = await lancerYaide({ shell: "/bin/sh" });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await expect.poll(() => yaide.sortie()).toMatch(/Serveur MCP : (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
  const adresse = /Serveur MCP : (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(yaide.sortie())[1];

  await page.keyboard.press("Control+p");
  await page.keyboard.type(">mcp");
  await expect(page.getByRole("option")).toHaveText(["Serveur MCP de Yaide"]);
  await page.keyboard.press("Enter");

  const panneau = page.getByRole("dialog", { name: "Serveur MCP de Yaide" });
  await expect(panneau).toBeVisible();
  await expect(panneau.getByText(adresse, { exact: true })).toBeVisible();
  const commande = `claude mcp add --transport http yaide ${adresse}`;
  await expect(panneau.getByRole("group", { name: "Commande pour Claude Code" }).locator("pre")).toHaveText(commande);
  const bloc = panneau.getByRole("group", { name: "Configuration pour opencode" }).locator("pre");
  await expect(bloc).toContainText(`"url": "${adresse}"`);
  await expect(panneau).not.toContainText(/Authorization|Bearer|jeton/i);

  const copierCommande = panneau.getByRole("button", { name: "Copier la commande pour Claude Code" });
  await expect(copierCommande).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panneau.getByRole("status")).toHaveText("Commande pour Claude Code copiée.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(commande);

  await panneau.getByRole("button", { name: "Copier la configuration pour opencode" }).click();
  await expect(panneau.getByRole("status")).toHaveText("Configuration pour opencode copiée.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await bloc.innerText());
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).mcp.servers.yaide.url).toBe(adresse);

  await page.keyboard.press("Escape");
  await expect(panneau).toBeHidden();
});
