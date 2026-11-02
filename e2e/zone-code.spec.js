import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dossier = resolve(process.env.TMPDIR ?? ".test-data", "zone-code");

test.beforeAll(async () => {
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    resolve(dossier, "entree.js"),
    `import { zoneCode } from ${JSON.stringify(resolve("web/src/ui/zone-code.js"))};
window.zoneCode = zoneCode;`,
  );
  await build({ entryPoints: [resolve(dossier, "entree.js")], bundle: true, outfile: resolve(dossier, "page.js") });
  copyFileSync("web/src/ui/tokens.css", resolve(dossier, "tokens.css"));
  copyFileSync("web/src/ui/composants.css", resolve(dossier, "composants.css"));
  writeFileSync(
    resolve(dossier, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="composants.css"><style>body{margin:0}#h{width:1000px;height:400px}</style></head>
<body><input id="avant"><div id="h"></div><input id="apres"><script src="page.js"></script></body></html>`,
  );
});

async function ouvrir(page, options) {
  await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
  await page.evaluate((o) => document.getElementById("h").append(window.zoneCode(o)), options);
}

test("REQ011_AC1_rust_colore_par_les_tokens_du_design_system", async ({ page }) => {
  await ouvrir(page, { contenu: 'fn main() { let s = "a"; }', langage: "rust", nom: "main.rs" });
  const couleur = (txt) => page.locator(".cm-line span", { hasText: txt }).first().evaluate((e) => getComputedStyle(e).color);
  const attendu = (token) =>
    page.evaluate((t) => {
      const d = document.createElement("i");
      d.style.color = `var(${t})`;
      document.body.append(d);
      return getComputedStyle(d).color;
    }, token);
  expect(await couleur("fn")).toBe(await attendu("--code-mot-cle"));
  expect(await couleur('"a"')).toBe(await attendu("--code-chaine"));
  expect(await page.locator(".cm-editor").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await attendu("--fond"));
});

test("REQ011_AC7_tab_indente_puis_echap_tab_sort_sans_rien_inserer", async ({ page }) => {
  await ouvrir(page, { contenu: "x", langage: "rust", nom: "main.rs" });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  const apresTab = await page.evaluate(() => document.querySelector(".cm-content").innerText.replace(/\n$/, ""));
  expect(apresTab.length).toBeGreaterThan(1);
  expect(apresTab.endsWith("x")).toBe(true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(page.locator(".cm-content")).not.toBeFocused();
  await expect(page.locator("#apres")).toBeFocused();
  expect(await page.evaluate(() => document.querySelector(".cm-content").innerText.replace(/\n$/, ""))).toBe(apresTab);
});

test("REQ012_AC1_apercu_a_droite_de_l_editeur_moitie_chacun", async ({ page }) => {
  await ouvrir(page, { contenu: "# Titre\n\n[lien](https://x.org)", langage: "markdown", nom: "README.md", apercu: true });
  const ed = await page.locator(".zone-code-editeur").boundingBox();
  const ap = await page.locator(".zone-code-apercu").boundingBox();
  expect(ap.x).toBeGreaterThanOrEqual(ed.x + ed.width - 1);
  expect(Math.abs(ed.width - ap.width)).toBeLessThanOrEqual(2);
  await expect(page.getByLabel("Aperçu")).toBeVisible();
  await expect(page.locator(".zone-code-apercu h1")).toHaveText("Titre");
  expect(await page.locator(".zone-code-apercu a").evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe("underline");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n## Suite");
  await expect(page.locator(".zone-code-apercu h2")).toHaveText("Suite");
});

test("REQ012_AC2_script_dans_le_markdown_ne_s_execute_pas", async ({ page }) => {
  await ouvrir(page, { contenu: "<script>window.pwn=1</script>\n\n<img src=x onerror=\"window.pwn=1\">", langage: "markdown", apercu: true });
  await expect(page.locator(".zone-code-apercu img")).toHaveCount(0);
  await expect(page.locator(".zone-code-apercu script")).toHaveCount(0);
  expect(await page.evaluate(() => window.pwn)).toBeUndefined();
});

test("REQ011_AC1_contour_de_focus_accent_et_curseur_fixe", async ({ page }) => {
  await ouvrir(page, { contenu: "x", nom: "a.txt" });
  await page.locator(".cm-content").click();
  const o = await page.locator(".zone-code").evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.outlineStyle, s.outlineWidth, s.outlineColor];
  });
  expect(o[0]).toBe("solid");
  expect(o[1]).toBe("1px");
  const accent = await page.evaluate(() => {
    const d = document.createElement("i");
    d.style.color = "var(--accent)";
    document.body.append(d);
    return getComputedStyle(d).color;
  });
  expect(o[2]).toBe(accent);
  expect(await page.locator(".cm-cursorLayer").evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});

test("REQ011_AC1_diff_lignes_colorees_et_lecture_seule", async ({ page }) => {
  await ouvrir(page, { contenu: "+ajout\n-retrait\n contexte", mode: "diff", nom: "a.rs" });
  const fond = (i) => page.locator(".cm-line").nth(i).evaluate((e) => getComputedStyle(e).backgroundColor);
  const token = (t) =>
    page.evaluate((t) => {
      const d = document.createElement("i");
      d.style.backgroundColor = `var(${t})`;
      document.body.append(d);
      return getComputedStyle(d).backgroundColor;
    }, t);
  expect(await fond(0)).toBe(await token("--diff-ajout"));
  expect(await fond(1)).toBe(await token("--diff-retrait"));
  await expect(page.locator(".cm-line").nth(0)).toHaveText("+ajout");
  await page.locator(".cm-content").click();
  await page.keyboard.type("zzz");
  await expect(page.locator(".cm-content")).not.toContainText("zzz");
  await expect(page.getByLabel("Diff a.rs")).toBeVisible();
});

const valeur = (page, prop, token) =>
  page.evaluate(
    ([p, t]) => {
      const d = document.createElement("i");
      d.style[p] = `var(${t})`;
      document.body.append(d);
      const v = getComputedStyle(d)[p];
      d.remove();
      return v;
    },
    [prop, token],
  );

test("REQ011_AC1_texte_de_code_14px_interligne_20px", async ({ page }) => {
  await ouvrir(page, { contenu: "x", nom: "a.txt" });
  const m = await page.locator(".cm-line").first().evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.fontSize, s.lineHeight];
  });
  expect(m).toEqual(["14px", "20px"]);
});

test("REQ011_AC1_selection_visible_sur_ligne_active_et_lignes_de_diff", async ({ page }) => {
  const pixelSelection = async (zone) => {
    const png = (await zone.screenshot()).toString("base64");
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x2b) <= 3 && Math.abs(d[i + 1] - 0x4a) <= 3 && Math.abs(d[i + 2] - 0x78) <= 3) n++;
      return n;
    }, png);
  };
  await ouvrir(page, { contenu: "du texte à sélectionner", nom: "a.txt" });
  await page.locator(".cm-content").click();
  expect(await pixelSelection(page.locator(".zone-code"))).toBe(0);
  await page.keyboard.press("Control+a");
  expect(await pixelSelection(page.locator(".zone-code"))).toBeGreaterThan(100);
  await page.evaluate(() => document.getElementById("h").replaceChildren());
  await page.evaluate((o) => document.getElementById("h").append(window.zoneCode(o)), { contenu: "+ajout sélectionné\n-retrait sélectionné", mode: "diff", nom: "a.rs" });
  await page.locator(".cm-content").click();
  expect(await pixelSelection(page.locator(".zone-code"))).toBe(0);
  await page.keyboard.press("Control+a");
  expect(await pixelSelection(page.locator(".zone-code"))).toBeGreaterThan(100);
});

test("REQ012_AC1_apercu_sans_lien_n_est_pas_un_arret_de_tabulation", async ({ page }) => {
  await ouvrir(page, { contenu: Array.from({ length: 200 }, (_, i) => `# Titre ${i}\n\ntexte sans lien ${i}`).join("\n\n"), langage: "markdown", nom: "README.md", apercu: true });
  expect(await page.locator(".zone-code-apercu").evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(page.locator("#apres")).toBeFocused();
});

test("REQ012_AC1_styles_de_l_apercu", async ({ page }) => {
  await ouvrir(page, { contenu: "# T1\n\n## T2\n\n### T3\n\ntexte [lien](https://x.org) et `code`\n\n```\nbloc\n```", langage: "markdown", nom: "README.md", apercu: true });
  const calc = (sel) =>
    page.locator(sel).first().evaluate((e) => {
      const s = getComputedStyle(e);
      return { taille: s.fontSize, inter: s.lineHeight, poids: s.fontWeight, famille: s.fontFamily, couleur: s.color, fond: s.backgroundColor, deco: s.textDecorationLine };
    });
  const police = async (token) => page.evaluate((t) => { const d = document.createElement("i"); d.style.fontFamily = `var(${t})`; document.body.append(d); const f = getComputedStyle(d).fontFamily; d.remove(); return f; }, token);
  const taille = async (token) => page.evaluate((t) => { const d = document.createElement("i"); d.style.font = `var(${t}) serif`; document.body.append(d); const s = getComputedStyle(d); const r = [s.fontSize, s.lineHeight]; d.remove(); return r; }, token);
  const texte = await valeur(page, "color", "--texte");
  const poidsFort = await page.evaluate(() => { const d = document.createElement("i"); d.style.fontWeight = "var(--graisse-forte)"; document.body.append(d); return getComputedStyle(d).fontWeight; });

  const p = await calc(".zone-code-apercu p");
  expect([p.taille, p.inter]).toEqual(await taille("--texte-lecture"));
  expect(p.famille).toBe(await police("--police-ui"));
  expect(p.couleur).toBe(texte);
  for (const [sel, tok] of [["h1", "--texte-titre"], ["h2", "--texte-sous-titre"], ["h3", "--texte-lecture"]]) {
    const h = await calc(`.zone-code-apercu ${sel}`);
    expect([h.taille, h.inter]).toEqual(await taille(tok));
    expect(h.poids).toBe(poidsFort);
    expect(h.famille).toBe(await police("--police-ui"));
  }
  const a = await calc(".zone-code-apercu a");
  expect(a.couleur).toBe(texte);
  expect(a.deco).toBe("underline");
  const surface = await valeur(page, "backgroundColor", "--surface");
  for (const sel of [".zone-code-apercu p code", ".zone-code-apercu pre"]) {
    const c = await calc(sel);
    expect(c.famille).toBe(await police("--police-code"));
    expect(c.fond).toBe(surface);
  }
});

test("REQ011_AC1_ligne_demandee_est_centree", async ({ page }) => {
  const contenu = Array.from({ length: 500 }, (_, i) => `ligne ${i + 1}`).join("\n");
  await ouvrir(page, { contenu, nom: "a.txt", ligne: 250 });
  await page.waitForFunction(() => document.querySelector(".cm-scroller").scrollTop > 0);
  const centre = await page.evaluate(() => {
    const l = [...document.querySelectorAll(".cm-line")].find((e) => e.textContent === "ligne 250").getBoundingClientRect();
    const z = document.querySelector(".cm-scroller").getBoundingClientRect();
    return [l.top + l.height / 2, z.top + z.height / 2];
  });
  expect(Math.abs(centre[0] - centre[1])).toBeLessThanOrEqual(30);
});
