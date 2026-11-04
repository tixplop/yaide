import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dossier = resolve(process.env.TMPDIR ?? ".test-data", "terminal");

test.beforeAll(async () => {
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    resolve(dossier, "entree.js"),
    `import { terminal } from ${JSON.stringify(resolve("web/src/ui/terminal.js"))};
import { cadre } from ${JSON.stringify(resolve("web/src/ui/cadre.js"))};
import { zoneCode } from ${JSON.stringify(resolve("web/src/ui/zone-code.js"))};
import { changerTheme } from ${JSON.stringify(resolve("web/src/ui/theme.js"))};
window.zoneCode = zoneCode;
window.changerTheme = changerTheme;
window.terminal = terminal;
window.cadre = cadre;
window.toucheDocument = [];
document.addEventListener("keydown", (e) => window.toucheDocument.push([e.key, e.ctrlKey, e.shiftKey]));`,
  );
  await build({ entryPoints: [resolve(dossier, "entree.js")], bundle: true, outfile: resolve(dossier, "page.js") });
  copyFileSync("web/src/ui/tokens.css", resolve(dossier, "tokens.css"));
  copyFileSync("web/src/ui/composants.css", resolve(dossier, "composants.css"));
  writeFileSync(
    resolve(dossier, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="composants.css"><link rel="stylesheet" href="page.css"><style>#h{width:800px;height:300px}</style></head>
<body><div id="h"></div><script src="page.js"></script></body></html>`,
  );
});

async function ouvrir(page) {
  await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
  await page.evaluate(() => {
    window.envoyes = [];
    const flux = Object.assign(new EventTarget(), { send: (d) => window.envoyes.push(d) });
    window.flux = flux;
    document.getElementById("h").append(window.terminal({ flux, numero: 1 }));
  });
}

test("REQ019_AC7_ctrl_maj_f_n_envoie_rien_au_shell_mais_ctrl_s_et_ctrl_p_oui", async ({ page }) => {
  await ouvrir(page);
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Control+p");
  await page.keyboard.press("Control+Shift+F");
  expect(await page.evaluate(() => window.envoyes)).toEqual(["\x13", "\x10"]);
  expect(await page.evaluate(() => window.toucheDocument.some(([k, c, s]) => k.toLowerCase() === "f" && c && s))).toBe(true);
});

test("REQ019_AC1_la_sortie_du_flux_s_affiche_et_la_frappe_part_au_flux", async ({ page }) => {
  await ouvrir(page);
  await page.evaluate(() => window.flux.dispatchEvent(new MessageEvent("message", { data: "bonjour\r\n" })));
  await expect(page.locator(".terminal-zone")).toContainText("bonjour");
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("ls");
  expect(await page.evaluate(() => window.envoyes)).toEqual(["l", "s"]);
});

test("REQ028_AC7_terminal_a_un_contour_de_focus_visible", async ({ page }) => {
  await ouvrir(page);
  const contour = () => page.locator(".terminal-zone").evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(await contour()).toBe("none");
  await page.locator(".xterm-helper-textarea").focus();
  expect(await contour()).toBe("solid");
});

test("REQ028_AC3_fond_et_couleur_ansi_viennent_des_tokens", async ({ page }) => {
  await ouvrir(page);
  const attendu = (token) =>
    page.evaluate((t) => {
      const d = document.createElement("i");
      d.style.color = `var(${t})`;
      document.body.append(d);
      return getComputedStyle(d).color;
    }, token);
  await page.evaluate(() => window.flux.dispatchEvent(new MessageEvent("message", { data: "\x1b[31mrouge\x1b[0m" })));
  const span = page.locator(".terminal-zone .xterm-rows span", { hasText: "rouge" }).first();
  // Le terminal s'ajuste à sa zone après l'écriture : l'élément peut être remplacé, on relit.
  const rouge = await attendu("--git-deleted");
  await expect.poll(() => span.evaluate((e) => getComputedStyle(e).color)).toBe(rouge);
  expect(await page.locator(".terminal-zone .xterm-screen").evaluate((e) => getComputedStyle(e.closest(".xterm")).backgroundColor)).toBe(await attendu("--bg-000"));
});

test("REQ028_AC9_a_800_par_480_les_zones_du_cadre_ne_se_superposent_pas", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
  await page.evaluate(() => {
    const t = (balise, texte) => Object.assign(document.createElement(balise), { textContent: texte });
    document.body.replaceChildren(
      window.cadre({ barreHaut: t("span", "haut"), rail: { onglets: t("span", "rail") }, panneau: { titre: "Fichiers", corps: t("p", "corps") }, principal: { ongletsFichiers: t("div", "onglets"), code: t("div", "code"), shells: t("div", "shells") } }),
    );
  });
  const boite = async (sel) => page.locator(sel).first().boundingBox();
  const [haut, rail, panneau, principal] = await Promise.all([".cadre-barre", ".cadre-rail", ".cadre-panneau", ".cadre-principal"].map(boite));
  expect(rail.x + rail.width).toBeLessThanOrEqual(panneau.x + 1);
  expect(panneau.x + panneau.width).toBeLessThanOrEqual(principal.x + 1);
  expect(haut.y + haut.height).toBeLessThanOrEqual(rail.y + 1);
  expect(Math.round(haut.height)).toBe(32);
  expect(Math.round(rail.width)).toBe(36);
  expect(Math.round(panneau.width)).toBe(240);
  const code = await boite(".cadre-code");
  const shells = await boite(".cadre-shells");
  expect(code.y + code.height).toBeLessThanOrEqual(shells.y + 1);
  expect(Math.abs(shells.height / principal.height - 0.35)).toBeLessThan(0.02);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.setViewportSize({ width: 700, height: 400 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(true);
});

test("REQ038_AC2_changer_de_theme_garde_le_texte_de_l_editeur_et_la_sortie_du_shell", async ({ page }) => {
  await ouvrir(page);
  await page.evaluate(() => document.getElementById("h").append(window.zoneCode({ contenu: "", nom: "a.txt" })));
  await page.locator(".cm-content").click();
  await page.keyboard.type("mon texte");
  await page.evaluate(() => window.flux.dispatchEvent(new MessageEvent("message", { data: "sortie du shell\r\n" })));
  await expect(page.locator(".terminal-zone")).toContainText("sortie du shell");
  const fonds = () => page.evaluate(() => [getComputedStyle(document.querySelector(".cm-editor")).backgroundColor, getComputedStyle(document.querySelector(".xterm")).backgroundColor]);
  const [edSombre, tmSombre] = await fonds();
  await page.evaluate(() => window.changerTheme("light"));
  await expect.poll(async () => (await fonds())[1]).not.toBe(tmSombre);
  expect((await fonds())[0]).not.toBe(edSombre);
  await expect(page.locator(".cm-content")).toHaveText("mon texte");
  await expect(page.locator(".terminal-zone")).toContainText("sortie du shell");
  await page.evaluate(() => window.changerTheme("dark"));
  await expect.poll(async () => (await fonds())[1]).toBe(tmSombre);
  await expect(page.locator(".cm-content")).toHaveText("mon texte");
  await expect(page.locator(".terminal-zone")).toContainText("sortie du shell");
});
