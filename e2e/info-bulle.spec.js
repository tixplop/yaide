import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

let dossier;

test.beforeAll(async () => {
  mkdirSync(resolve(process.env.TMPDIR ?? ".test-data"), { recursive: true });
  dossier = mkdtempSync(resolve(process.env.TMPDIR ?? ".test-data", "info-bulle-"));
  writeFileSync(
    resolve(dossier, "entree.js"),
    `import { infoBulle } from ${JSON.stringify(resolve("web/src/ui/info-bulle.js"))};
window.infoBulle = infoBulle;`,
  );
  await build({ entryPoints: [resolve(dossier, "entree.js")], bundle: true, outfile: resolve(dossier, "page.js") });
  copyFileSync("web/src/ui/tokens.css", resolve(dossier, "tokens.css"));
  copyFileSync("web/src/ui/composants.css", resolve(dossier, "composants.css"));
  writeFileSync(
    resolve(dossier, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="composants.css"><style>body{margin:0}</style></head>
<body><button id="haut" style="position:absolute;left:0;top:0;width:24px;height:24px">H</button>
<button id="bas" style="position:absolute;right:0;bottom:0;width:24px;height:24px">B</button>
<button id="milieu" style="position:absolute;left:300px;top:200px;width:24px;height:24px">M</button>
<span id="env" class="bouton-enveloppe" style="position:absolute;left:400px;top:200px"><button id="off" disabled style="width:24px;height:24px">D</button></span>
<input id="arret" style="position:absolute;left:300px;top:340px">
<input id="champ" style="position:absolute;left:300px;top:300px">
<script src="page.js"></script>
<script>
arret.addEventListener("keydown", (e) => {
  window.toucheRecue = e.key;
  e.stopPropagation();
});
infoBulle({ texte: "Arrêt", ancre: arret });
infoBulle({ texte: "Premier", ancre: haut });
infoBulle({ texte: "Dernier", ancre: bas });
infoBulle({ texte: "Milieu (M)", ancre: milieu });
infoBulle({ texte: "Désactivé (F2)", ancre: off, enveloppe: env });
</script></body></html>`,
  );
});

async function ouvrir(page) {
  await page.setViewportSize({ width: 800, height: 480 });
  await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
  // Le pointeur de Playwright démarre en (0, 0), sur le bouton du coin : on l'en écarte pour que les entrées soient réelles.
  await page.mouse.move(600, 100);
}
const tip = (page) => page.locator('[role="tooltip"]:popover-open');

test("REQ031_AC8_focus_clavier_affiche_et_echap_ferme_sans_deplacer_le_focus", async ({ page }) => {
  await ouvrir(page);
  await page.focus("#champ");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#off")).not.toBeFocused();
  await page.focus("#milieu");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#milieu")).toBeFocused();
  await expect(tip(page)).toHaveText("Milieu (M)");
  await page.keyboard.press("Escape");
  await expect(tip(page)).toHaveCount(0);
  await expect(page.locator("#milieu")).toBeFocused();
});

test("REQ031_AC8_AC9_groupe_coins_bouton_desactive_et_une_seule_info_bulle", async ({ page }) => {
  await ouvrir(page);
  await test.step("REQ031_AC8_reste_entiere_dans_la_fenetre_aux_deux_coins", async () => {
    for (const id of ["#haut", "#bas"]) {
      await page.hover(id);
      await expect(tip(page)).toHaveCount(1);
      const r = await tip(page).evaluate((e) => {
        const b = e.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: innerWidth, h: innerHeight };
      });
      expect(r.l).toBeGreaterThanOrEqual(0);
      expect(r.t).toBeGreaterThanOrEqual(0);
      expect(r.r).toBeLessThanOrEqual(r.w);
      expect(r.b).toBeLessThanOrEqual(r.h);
      await page.mouse.move(600, 100);
    }
  });
  await test.step("REQ031_AC9_bouton_desactive_affiche_son_info_bulle_au_survol", async () => {
    await page.hover("#env");
    await expect(tip(page)).toHaveText("Désactivé (F2)");
    await page.mouse.move(600, 100);
    await expect(tip(page)).toHaveCount(0);
  });
  await test.step("REQ031_AC8_une_seule_info_bulle_a_la_fois_et_au_premier_plan", async () => {
    await page.focus("#champ");
    await page.keyboard.press("Shift+Tab");
    await page.focus("#milieu");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(tip(page)).toHaveCount(1);
    await page.hover("#env");
    await expect(tip(page)).toHaveCount(1);
    await expect(tip(page)).toHaveText("Désactivé (F2)");
    const couche = await tip(page).evaluate((e) => {
      const b = e.getBoundingClientRect();
      return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === e;
    });
    expect(couche).toBe(true);
  });
});
