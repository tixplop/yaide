import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

let dossier;

test.beforeAll(async () => {
  mkdirSync(resolve(process.env.TMPDIR ?? ".test-data"), { recursive: true });
  dossier = mkdtempSync(resolve(process.env.TMPDIR ?? ".test-data", "zone-code-"));
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
  expect(await couleur("fn")).toBe(await attendu("--syn-keyword"));
  expect(await couleur('"a"')).toBe(await attendu("--syn-string"));
  expect(await page.locator(".cm-editor").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await attendu("--bg-200"));
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
    d.style.color = "var(--accent-fg)";
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

test("REQ036_AC4_texte_de_code_13_5px_interligne_21px", async ({ page }) => {
  await ouvrir(page, { contenu: "x", nom: "a.txt" });
  const m = await page.locator(".cm-line").first().evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.fontSize, s.lineHeight];
  });
  expect(m).toEqual(["13.5px", "21px"]);
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
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 37) <= 3 && Math.abs(d[i + 1] - 72) <= 3 && Math.abs(d[i + 2] - 107) <= 3) n++;
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
  const texte = await valeur(page, "color", "--ink");
  const poidsFort = await page.evaluate(() => { const d = document.createElement("i"); d.style.fontWeight = "var(--graisse-forte)"; document.body.append(d); return getComputedStyle(d).fontWeight; });

  const p = await calc(".zone-code-apercu p");
  expect([p.taille, p.inter]).toEqual(await taille("--texte-lecture"));
  expect(p.famille).toBe(await police("--font-sans"));
  expect(p.couleur).toBe(texte);
  for (const [sel, tok] of [["h1", "--texte-titre"], ["h2", "--texte-sous-titre"], ["h3", "--texte-lecture"]]) {
    const h = await calc(`.zone-code-apercu ${sel}`);
    expect([h.taille, h.inter]).toEqual(await taille(tok));
    expect(h.poids).toBe(poidsFort);
    expect(h.famille).toBe(await police("--font-sans"));
  }
  const a = await calc(".zone-code-apercu a");
  expect(a.couleur).toBe(await valeur(page, "color", "--info"));
  expect(a.deco).toBe("underline");
  const surface = await valeur(page, "backgroundColor", "--apercu-fond");
  for (const sel of [".zone-code-apercu p code", ".zone-code-apercu pre"]) {
    const c = await calc(sel);
    expect(c.famille).toBe(await police("--font-mono"));
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

// T-053 : tableaux, notes et code de l'aperçu, dans les deux thèmes.
const TRANSPARENT = "rgba(0, 0, 0, 0)";
async function apercuEn(page, theme, contenu, largeur) {
  await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
  await page.evaluate(([t, l]) => {
    document.documentElement.dataset.theme = t;
    if (l) document.getElementById("h").style.width = `${l}px`;
  }, [theme, largeur]);
  await page.evaluate((c) => document.getElementById("h").append(window.zoneCode({ contenu: c, langage: "markdown", nom: "a.md", apercu: true })), contenu);
}
const style = (page, sel, props) =>
  page.locator(sel).first().evaluate((e, ps) => {
    const s = getComputedStyle(e);
    return Object.fromEntries(ps.map((p) => [p, s[p]]));
  }, props);

for (const theme of ["dark", "light"]) {
  test(`REQ042_AC1_AC2_AC3_AC5_tableau_bordures_entete_et_lignes_${theme}`, async ({ page }) => {
    await apercuEn(page, theme, "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |");
    const trait = await valeur(page, "borderTopColor", "--line-strong");
    for (const sel of [".zone-code-apercu th", ".zone-code-apercu td"]) {
      const b = await style(page, sel, ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderTopStyle"]);
      expect([b.borderTopWidth, b.borderRightWidth, b.borderBottomWidth, b.borderLeftWidth]).toEqual(["1px", "1px", "1px", "1px"]);
      expect([b.borderTopColor, b.borderRightColor, b.borderBottomColor, b.borderLeftColor]).toEqual([trait, trait, trait, trait]);
      expect(b.borderTopStyle).toBe("solid");
    }
    const th = await style(page, ".zone-code-apercu th", ["backgroundColor", "fontWeight"]);
    expect(th.backgroundColor).toBe(await valeur(page, "backgroundColor", "--apercu-entete"));
    expect(th.fontWeight).toBe("600");
    const fond = (i) => page.locator(".zone-code-apercu tbody tr").nth(i).locator("td").first().evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await fond(0)).toBe(TRANSPARENT);
    expect(await fond(2)).toBe(await fond(0));
    expect(await fond(1)).toBe(await valeur(page, "backgroundColor", "--apercu-fond"));
    expect(await fond(1)).not.toBe(await fond(0));
  });

  test(`REQ042_AC6_alignement_des_colonnes_${theme}`, async ({ page }) => {
    await apercuEn(page, theme, "| G | D | C |\n|---|---:|:---:|\n| 1 | 2 | 3 |");
    for (const sel of ["th", "td"]) {
      const al = await page.locator(`.zone-code-apercu ${sel}`).evaluateAll((es) => es.map((e) => getComputedStyle(e).textAlign));
      expect(al).toEqual(["left", "right", "center"]);
    }
  });

  test(`REQ042_AC7_tableau_large_ne_depasse_pas_l_apercu_${theme}`, async ({ page }) => {
    const chemin = "src/".concat("dossier/".repeat(10)).slice(0, 80);
    expect(chemin).toHaveLength(80);
    await apercuEn(page, theme, `| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| ${chemin} | 2 | 3 | 4 | 5 | 6 |`, 508);
    const m = await page.locator(".zone-code-apercu").evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, droite: e.getBoundingClientRect().right }));
    expect(await page.locator(".zone-code-apercu").evaluate((e) => e.offsetWidth)).toBe(254);
    expect(m.sw).toBe(m.cw);
    const cellule = await page.locator(".zone-code-apercu td").first().boundingBox();
    expect(cellule.x + cellule.width).toBeLessThanOrEqual(m.droite);
  });

  test(`REQ043_AC1_AC3_note_filet_fond_et_texte_${theme}`, async ({ page }) => {
    await apercuEn(page, theme, "> Une note");
    const b = await style(page, ".zone-code-apercu blockquote", ["borderLeftWidth", "borderLeftStyle", "borderLeftColor", "backgroundColor"]);
    expect([b.borderLeftWidth, b.borderLeftStyle]).toEqual(["3px", "solid"]);
    expect(b.borderLeftColor).toBe(await valeur(page, "borderTopColor", "--info"));
    expect(b.backgroundColor).toBe(await valeur(page, "backgroundColor", "--msg-info"));
    expect(b.backgroundColor).not.toBe((await style(page, ".zone-code-apercu", ["backgroundColor"])).backgroundColor);
    expect((await style(page, ".zone-code-apercu blockquote p", ["color"])).color).toBe(await valeur(page, "color", "--ink"));
  });

  test(`REQ043_AC4_note_dans_une_note_sans_fond_propre_${theme}`, async ({ page }) => {
    await apercuEn(page, theme, "> > texte");
    const i = await style(page, ".zone-code-apercu blockquote blockquote", ["borderLeftWidth", "borderLeftColor", "backgroundColor"]);
    expect(i.borderLeftWidth).toBe("3px");
    expect(i.borderLeftColor).toBe(await valeur(page, "borderTopColor", "--info"));
    expect(i.backgroundColor).toBe(TRANSPARENT);
  });

  test(`REQ043_AC5_marqueur_de_note_reste_du_texte_${theme}`, async ({ page }) => {
    await apercuEn(page, theme, "> [!NOTE] Il faut Rust 1.80");
    const bq = page.locator(".zone-code-apercu blockquote");
    await expect(bq).toHaveText("[!NOTE] Il faut Rust 1.80");
    expect(await bq.evaluate((e) => [e.children.length, e.children[0].tagName])).toEqual([1, "P"]);
    await expect(bq.locator("svg, img, h1, h2, h3, h4, h5, h6, strong")).toHaveCount(0);
  });

  test(`REQ044_AC8_AC9_bloc_et_code_en_ligne_${theme}`, async ({ page }) => {
    await apercuEn(page, theme, "texte `ligne` fin\n\n```\nbloc\n```\n\n| `cel` |\n|---|\n| x |");
    const fond = await valeur(page, "backgroundColor", "--apercu-fond");
    const mono = await valeur(page, "fontFamily", "--font-mono");
    const pre = await style(page, ".zone-code-apercu pre", ["backgroundColor", "fontFamily", "fontSize", "lineHeight"]);
    expect(pre.backgroundColor).toBe(fond);
    expect(pre.backgroundColor).not.toBe((await style(page, ".zone-code-apercu", ["backgroundColor"])).backgroundColor);
    expect([pre.fontFamily, pre.fontSize, pre.lineHeight]).toEqual([mono, "13.5px", "21px"]);
    const pc = await style(page, ".zone-code-apercu pre code", ["backgroundColor", "fontFamily", "fontSize", "lineHeight"]);
    expect(pc.backgroundColor).toBe(TRANSPARENT);
    expect([pc.fontFamily, pc.fontSize, pc.lineHeight]).toEqual([mono, "13.5px", "21px"]);
    const c = await style(page, ".zone-code-apercu p code", ["backgroundColor", "fontFamily", "fontSize", "color"]);
    expect([c.backgroundColor, c.fontFamily, c.fontSize]).toEqual([fond, mono, "13px"]);
    expect(c.color).toBe((await style(page, ".zone-code-apercu p", ["color"])).color);
    expect((await style(page, ".zone-code-apercu th code", ["color"])).color).toBe((await style(page, ".zone-code-apercu th", ["color"])).color);
  });

  test(`REQ044_AC10_ligne_longue_sans_espace_${theme}`, async ({ page }) => {
    const ligne = "x".repeat(300);
    await apercuEn(page, theme, "```\n" + ligne + "\n```", 508);
    const m = await page.locator(".zone-code-apercu").evaluate((e) => [e.scrollWidth, e.clientWidth]);
    expect(m[0]).toBe(m[1]);
    expect(await page.locator(".zone-code-apercu pre").evaluate((e) => e.textContent)).toBe(ligne + "\n");
  });

  test(`REQ044_AC11_focus_des_liens_dans_l_apercu_${theme}`, async ({ page }) => {
    await apercuEn(page, theme, "[un](https://a.org)\n\n| t |\n|---|\n| x |\n\n> note\n\n```\nbloc\n```\n\n[deux](https://b.org)");
    const liens = page.locator(".zone-code-apercu a");
    await liens.nth(0).focus();
    await expect(liens.nth(0)).toBeFocused();
    const o = await style(page, ".zone-code-apercu a:focus", ["outlineWidth", "outlineStyle", "outlineColor", "outlineOffset"]);
    expect([o.outlineWidth, o.outlineStyle, o.outlineOffset]).toEqual(["2px", "solid", "2px"]);
    expect(o.outlineColor).toBe(await valeur(page, "color", "--accent-fg"));
    await page.keyboard.press("Tab");
    await expect(liens.nth(1)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#apres")).toBeFocused();
  });
}

// T-054 : coloration des blocs de code de l'aperçu.
const BLOC_RUST = "```rust\n// note\nfn main() {}\n```";

test("REQ044_AC1_AC8_fn_en_syn_keyword_et_commentaire_en_syn_comment_italique", async ({ page }) => {
  await apercuEn(page, "dark", BLOC_RUST);
  const fn = page.locator(".zone-code-apercu pre span", { hasText: /^fn$/ });
  await expect(fn).toHaveCount(1);
  expect(await fn.evaluate((e) => getComputedStyle(e).color)).toBe(await valeur(page, "color", "--syn-keyword"));
  const com = page.locator(".zone-code-apercu pre span", { hasText: "// note" });
  const s = await com.evaluate((e) => ({ c: getComputedStyle(e).color, i: getComputedStyle(e).fontStyle }));
  expect(s.c).toBe(await valeur(page, "color", "--syn-comment"));
  expect(s.i).toBe("italic");
});

test("REQ044_AC5_remplacer_inconnu_par_rs_colore_le_bloc", async ({ page }) => {
  await apercuEn(page, "dark", "```inconnu\nfn main() {}\n```");
  await expect(page.locator(".zone-code-apercu pre")).toContainText("fn main() {}");
  await expect(page.locator(".zone-code-apercu pre span")).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("rs");
  await expect(page.locator(".zone-code-apercu pre span", { hasText: /^fn$/ })).toHaveCount(1);
});

test("REQ044_AC6_changer_de_theme_change_la_couleur_du_bloc_sans_refaire_l_apercu", async ({ page }) => {
  await apercuEn(page, "dark", BLOC_RUST);
  const fn = page.locator(".zone-code-apercu pre span", { hasText: /^fn$/ });
  await fn.evaluate((e) => (e.dataset.marque = "1"));
  const sombre = await fn.evaluate((e) => getComputedStyle(e).color);
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  const clair = await fn.evaluate((e) => getComputedStyle(e).color);
  expect(clair).not.toBe(sombre);
  expect(clair).toBe(await valeur(page, "color", "--syn-keyword"));
  await expect(page.locator(".zone-code-apercu pre span[data-marque]")).toHaveCount(1);
});

test("REQ062_AC15_AC16_AC4_AC17_AC20_aspect_lien_et_fonds_du_mode_hybride", async ({ page }) => {
  const requetes = [];
  page.on("request", (r) => requetes.push(r.url()));
  let fenetre = false;
  page.on("popup", () => (fenetre = true));
  const contenu = [
    "# Titre", "", "## Sous", "", "texte **gras** fin `x`", "", "> note", "", "[lien](https://example.org/x) ici", "",
    "| a | b |", "|---|---|", "| 1 | 2 |", "", "```js", "const a = 1;", "```",
  ].join("\n");
  await ouvrir(page, { contenu, langage: "markdown", nom: "README.md", hybride: true });
  // Le tableau (lignes 11 à 13) est un seul bloc rendu : les lignes suivantes comptent trois lignes de moins (le bloc n'est pas une `.cm-line`) dans le DOM.
  const ligne = (i) => page.locator(".cm-line").nth(i - 1 - (i > 13 ? 3 : 0));
  const police = (loc) => loc.evaluate((e) => { const s = getComputedStyle(e); return [s.fontFamily, s.fontSize, s.fontWeight, s.color]; });
  const alpha = (c) => {
    const n = c.match(/[\d.]+/g);
    if (c.startsWith("rgba")) return Number(n[3]);
    return c.includes("/") ? Number(c.split("/")[1].replace(")", "")) : 1;
  };
  const sans = await valeur(page, "fontFamily", "--font-sans");
  const mono = await valeur(page, "fontFamily", "--font-mono");
  const ink = await valeur(page, "color", "--ink");
  const muet = await valeur(page, "color", "--ink-muted");

  // AC-062-15 : curseur ligne 1, mise en forme hors de sa ligne.
  await expect(ligne(5)).toHaveText("texte gras fin x");
  expect(await police(ligne(5))).toEqual([sans, "14px", "400", ink]);
  expect(await police(ligne(3))).toEqual([sans, "16px", "600", ink]);
  expect(await police(ligne(5).locator(".cm-hy-code"))).toEqual([mono, "13px", "400", ink]);
  expect(await police(page.locator(".cm-hy-tableau td").first())).toEqual([sans, "14px", "400", ink]);
  expect((await police(ligne(16)))[0]).toBe(mono);
  expect((await police(ligne(16)))[1]).toBe("13.5px");

  // AC-062-16 : curseur sur la ligne 5, ses marques reviennent en gris, le texte garde sa forme.
  await ligne(5).click({ position: { x: 5, y: 5 } });
  await expect(ligne(5)).toHaveText("texte **gras** fin `x`");
  expect(await police(ligne(5).locator(".cm-hy-marque").first())).toEqual([sans, "14px", "400", muet]);
  expect((await police(ligne(5).locator(".cm-hy-gras")))[2]).toBe("600");
  expect(await police(ligne(1))).toEqual([sans, "20px", "600", ink]);
  await expect(ligne(1)).toHaveText("Titre");

  // AC-062-4, AC-062-17 : lien au pointeur du texte, sans href ni title ; le clic ne part nulle part.
  const lien = page.locator(".cm-hy-lien");
  await expect(lien).toHaveText("lien");
  expect(await lien.evaluate((e) => [getComputedStyle(e).cursor, getComputedStyle(e).textDecorationLine, getComputedStyle(e).color])).toEqual(["text", "underline", await valeur(page, "color", "--info")]);
  expect(await page.locator(".cm-content a, .cm-content [href], .cm-content [title]").count()).toBe(0);
  const avant = requetes.length;
  await lien.click();
  await expect(ligne(9)).toHaveText("[lien](https://example.org/x) ici");
  expect(requetes.length).toBe(avant);
  expect(fenetre).toBe(false);
  expect(page.url().startsWith("file:")).toBe(true);
  // Clôtures du bloc de code effacées (lignes vides) tant que le curseur est ailleurs.
  await expect(ligne(15)).toHaveText("");

  // AC-062-20 : trois fonds translucides, et la sélection reste visible sous le texte du bloc.
  const fond = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);
  const fondBloc = await fond(ligne(16));
  const fondCitation = await fond(ligne(7));
  const fondCode = await fond(page.locator(".cm-hy-code"));
  expect(fondBloc).toBe(await valeur(page, "backgroundColor", "--code-fond"));
  expect(fondCode).toBe(fondBloc);
  expect(fondCitation).toBe(await valeur(page, "backgroundColor", "--msg-info"));
  for (const f of [fondBloc, fondCitation, fondCode]) expect(alpha(f)).toBeLessThan(1);
  await ligne(16).click();
  // Le curseur dans le bloc : les clôtures reviennent, en gris.
  await expect(ligne(15)).toHaveText("```js");
  expect((await police(ligne(15).locator(".cm-hy-marque").first()))[3]).toBe(muet);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  const sel = await page.locator(".cm-selectionBackground").first().boundingBox();
  const bloc = await ligne(16).boundingBox();
  expect(sel.width).toBeGreaterThan(20);
  expect(sel.y).toBeGreaterThanOrEqual(bloc.y - 1);
  expect(sel.y + sel.height).toBeLessThanOrEqual(bloc.y + bloc.height + 1);
  expect(await page.locator(".cm-selectionBackground").first().evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await valeur(page, "backgroundColor", "--selection"));
});

test("REQ062_AC18_ligne_longue_repliee_sous_un_seul_numero", async ({ page }) => {
  const longue = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(" ");
  const contenu = `# T\n\n${longue}\n\nfin`;
  const mesures = () =>
    page.evaluate(() => {
      const s = document.querySelector(".cm-scroller");
      const nums = [...document.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].filter((e) => /^\d+$/.test(e.textContent) && e.style.visibility !== "hidden");
      return { debordement: s.scrollWidth - s.clientWidth, numeros: nums.length, hauteur: document.querySelectorAll(".cm-line")[2].getBoundingClientRect().height };
    });
  await ouvrir(page, { contenu, langage: "markdown", hybride: true });
  const hy = await mesures();
  expect(hy.debordement).toBe(0);
  expect(hy.numeros).toBe(5);
  expect(hy.hauteur).toBeGreaterThan(42);
  await ouvrir(page, { contenu, langage: "markdown" });
  const eteint = await mesures();
  expect(eteint.hauteur).toBe(21);
  expect(eteint.debordement).toBeGreaterThan(0);
});

test("REQ062_AC19_bascule_garde_la_ligne_du_haut", async ({ page }) => {
  const mot = Array.from({ length: 50 }, (_, i) => `mot${i}`).join(" ");
  const contenu = Array.from({ length: 100 }, (_, i) => (i < 39 ? `${mot} ${i + 1}` : `ligne ${i + 1}`)).join("\n\n");
  await ouvrir(page, { contenu, langage: "markdown", nom: "README.md" });
  const placer = () =>
    page.evaluate(() => {
      const v = document.querySelector(".zone-code").vue;
      v.scrollDOM.scrollTop = v.lineBlockAt(v.state.doc.line(79).from).top;
    });
  const decalage = () =>
    page.evaluate(() => {
      const s = document.querySelector(".cm-scroller").getBoundingClientRect().top;
      const l = [...document.querySelectorAll(".cm-line")].find((e) => e.textContent.startsWith("ligne 40"));
      return l ? Math.round(l.getBoundingClientRect().top - s) : null;
    });
  const bascule = (actif) => page.evaluate((a) => document.querySelector(".zone-code").definirHybride(a), actif);
  await placer(); // « ligne 40 » est la ligne 79 du fichier (une ligne vide entre chaque)
  const enHaut = async () => {
    const d = await decalage();
    return d !== null && d >= 0 && d < 25;
  };
  await expect.poll(enHaut).toBe(true);
  const doc = await page.evaluate(() => document.querySelector(".zone-code").contenu());
  await bascule(true);
  await expect.poll(enHaut).toBe(true);
  await bascule(false);
  await expect.poll(enHaut).toBe(true);
  expect(await page.evaluate(() => document.querySelector(".zone-code").contenu())).toBe(doc);
});

// T-090 : clavier, clic et bascule autour du tableau rendu (REQ-063).
const TABLEAU = ["| option     | effet |", "|------------|:-----:|", "| [--rapide](https://x.org) | oui |", "| --fort   | non |", "| --calme    | oui |"];
function docTableau() {
  const l = Array.from({ length: 80 }, (_, i) => `ligne ${i + 1}`);
  l.splice(22, 6, ...TABLEAU, "");
  return l.join("\n");
}
const brut = (page) => page.evaluate(() => window.pos);
async function ouvrirTableau(page, hybride) {
  await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
  await page.evaluate(
    ([c, h]) => {
      window.pos = null;
      document.getElementById("h").append(window.zoneCode({ contenu: c, langage: "markdown", nom: "a.md", hybride: h, surPosition: (l, c2) => (window.pos = `Ln ${l}, Col ${c2}`) }));
    },
    [docTableau(), hybride],
  );
}

test("REQ063_AC5_AC17_AC19_clavier_clic_dans_une_cellule_et_bascule", async ({ page }) => {
  await ouvrirTableau(page, true);
  const vue = (f, arg) => page.evaluate(([src, a]) => new Function("v", "a", `return (${src})(v, a)`)(document.querySelector(".zone-code").vue, a), [f.toString(), arg]);
  await vue((v) => { v.dispatch({ selection: { anchor: v.state.doc.line(22).from } }); v.focus(); });
  await expect(page.locator(".cm-hy-tableau")).toHaveCount(1);
  // AC-063-5 : Bas depuis la ligne 22 entre dans la ligne 23 ; Haut depuis la ligne 28 entre dans la ligne 27.
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => brut(page)).toMatch(/^Ln 23, /);
  await expect(page.locator(".cm-hy-tableau")).toHaveCount(0);
  await vue((v) => { v.dispatch({ selection: { anchor: v.state.doc.line(28).from } }); v.scrollDOM.scrollTop = v.lineBlockAt(v.state.doc.line(23).from).top - 50; });
  await expect(page.locator(".cm-hy-tableau")).toHaveCount(1);
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => brut(page)).toMatch(/^Ln 27, /);
  await expect(page.locator(".cm-hy-tableau")).toHaveCount(0);

  // AC-063-17 : le haut du tableau ne bouge pas au clic dans une cellule.
  await vue((v) => { v.dispatch({ selection: { anchor: 0 } }); v.scrollDOM.scrollTop = v.lineBlockAt(v.state.doc.line(23).from).top - 120; });
  const tableau = page.locator(".cm-hy-tableau");
  await expect(tableau).toHaveCount(1);
  const avant = (await tableau.boundingBox()).y;
  await tableau.getByText("non").click();
  await expect.poll(() => brut(page)).toBe("Ln 26, Col 14");
  expect(await page.evaluate(() => document.activeElement.classList.contains("cm-content"))).toBe(true);
  await expect(page.locator(".cm-activeLine")).toHaveText("| --fort   | non |");
  const apres = (await page.locator(".cm-line", { hasText: "| option" }).boundingBox()).y;
  expect(Math.abs(apres - avant)).toBeLessThanOrEqual(1);

  // AC-063-19 : éteint puis allumé avec la ligne 25 en haut, le haut du tableau est au bord haut de l'éditeur.
  await ouvrirTableau(page, false);
  await vue((v) => { v.scrollDOM.scrollTop = v.lineBlockAt(v.state.doc.line(25).from).top; });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const position = await brut(page);
  await page.evaluate(() => document.querySelector(".zone-code").definirHybride(true));
  await expect(tableau).toHaveCount(1);
  await expect
    .poll(async () => Math.abs((await tableau.boundingBox()).y - (await page.locator(".cm-scroller").boundingBox()).y))
    .toBeLessThanOrEqual(1);
  expect(await brut(page)).toBe(position);
});

test("REQ063_AC8_AC13_AC14_AC15_AC16_AC18_tableau_rendu_comme_l_apercu", async ({ page }) => {
    await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
    const md = docTableau();
    const rendu = page.locator(".cm-hy-tableau");
    for (const theme of ["dark", "light"]) {
    await page.evaluate(([t, c]) => {
      document.documentElement.dataset.theme = t;
      document.getElementById("h").replaceChildren(window.zoneCode({ contenu: c, langage: "markdown", nom: "a.md", hybride: true, apercu: true }));
    }, [theme, md]);
    await expect(rendu).toHaveCount(1);
    // AC-063-14 : mêmes styles calculés que l'aperçu, contrastes de 4,5:1 au moins.
    const PROPS = ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderTopStyle", "backgroundColor", "color", "fontFamily", "fontSize", "fontWeight", "textAlign", "textDecorationLine"];
    const mesure = (racine) =>
      page.evaluate(
        ([r, ps]) => {
          const q = (sel) => [...document.querySelectorAll(`${r} ${sel}`)];
          const lire = (e) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(e)[p]]));
          const rangee = (i) => q("tbody tr")[i].querySelector("td");
          return { th: lire(q("th")[0]), thD: lire(q("th")[1]), td0: lire(rangee(0)), td1: lire(rangee(1)), td2: lire(rangee(2)), tdD: lire(q("tbody tr")[1].querySelectorAll("td")[1]), a: lire(q("td a")[0]) };
        },
        [racine, PROPS],
      );
    const ref = await mesure(".zone-code-apercu");
    const mien = await mesure(".cm-hy-tableau");
    expect(mien).toEqual(ref);
    expect(mien.th.fontWeight).toBe("600");
    expect(mien.th.borderTopWidth).toBe("1px");
    expect(mien.td1.backgroundColor).toBe(await valeur(page, "backgroundColor", "--apercu-fond"));
    expect(mien.td0.backgroundColor).toBe(TRANSPARENT);
    expect(mien.a.color).toBe(await valeur(page, "color", "--info"));
    expect(mien.a.textDecorationLine).toBe("underline");
    expect(mien.td0.fontSize).toBe("14px");
    const ratios = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { const x = Number(v) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const fondDe = (e) => {
        for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\(.*, 0\)$/.test(c) && c !== "transparent") return c; }
        return "rgb(255, 255, 255)";
      };
      return [...document.querySelectorAll(".cm-hy-tableau th, .cm-hy-tableau td, .cm-hy-tableau a")].map((e) => {
        const [a, b] = [lum(getComputedStyle(e).color), lum(fondDe(e))].sort((x, y) => y - x);
        return (a + 0.05) / (b + 0.05);
      });
    });
    for (const r of ratios) expect(r).toBeGreaterThanOrEqual(4.5);
    }
    // AC-063-8, AC-063-15 : numéros 22, 23 et 28 ; le 23 est centré sur la rangée d'en-tête.
    const numeros = await page.locator(".cm-lineNumbers .cm-gutterElement").evaluateAll((es) => es.filter((e) => e.style.visibility !== "hidden").map((e) => e.textContent));
    expect(numeros).toEqual(expect.arrayContaining(["22", "23", "28"]));
    for (const n of ["24", "25", "26", "27"]) expect(numeros).not.toContain(n);
    const centre = (b) => b.y + b.height / 2;
    const n23 = await page.locator(".cm-lineNumbers .cm-gutterElement", { hasText: /^23$/ }).evaluate((e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      const b = r.getBoundingClientRect();
      return { y: b.y, height: b.height };
    });
    const entete = await rendu.locator("th").first().boundingBox();
    expect(Math.abs(centre(n23) - centre(entete))).toBeLessThanOrEqual(2);
    // AC-063-16 : pointeur `text`, aucun fond ne change au survol, ni tabindex ni href.
    const fond = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);
    const cellule = rendu.locator("td").nth(3);
    const lien = rendu.locator("a");
    const avant = [await fond(cellule), await fond(lien)];
    for (const [i, loc] of [cellule, lien].entries()) {
      await loc.hover();
      expect(await fond(loc)).toBe(avant[i]);
      expect(await loc.evaluate((e) => getComputedStyle(e).cursor)).toBe("text");
    }
    expect([await fond(cellule), await fond(lien)]).toEqual(avant);
    expect(await rendu.locator("[tabindex], [href]").count()).toBe(0);
    // AC-063-13 : 6 colonnes dans 400 px, un chemin de 80 caractères, pas de défilement horizontal.
    const chemin = "/".repeat(1) + "dossier/".repeat(10);
    const large = `| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| ${chemin.slice(0, 80)} | 2 | 3 | 4 | 5 | 6 |\n`;
    await page.evaluate((c) => {
      document.getElementById("h").style.width = "400px";
      document.getElementById("h").replaceChildren(window.zoneCode({ contenu: `x\n\n${c}`, langage: "markdown", hybride: true }));
    }, large);
    await expect(rendu).toHaveCount(1);
    const defil = await page.evaluate(() => { const s = document.querySelector(".cm-scroller"); return s.scrollWidth - s.clientWidth; });
    expect(defil).toBe(0);
    expect((await rendu.locator("td").first().boundingBox()).height).toBeGreaterThan(30);
    // AC-063-18 : clôtures du bloc de code à la hauteur de la ligne 4, vides, puis en --ink-muted.
    await page.evaluate(() => {
      document.getElementById("h").style.width = "1000px";
      document.getElementById("h").replaceChildren(window.zoneCode({ contenu: "a\n\n```rust\nfn x() {}\n```\n\nfin", langage: "markdown", hybride: true }));
    });
    const ligne = (i) => page.locator(".cm-line").nth(i - 1);
    const hauteur = async (i) => (await ligne(i).boundingBox()).height;
    expect(await hauteur(3)).toBe(await hauteur(4));
    expect(await hauteur(5)).toBe(await hauteur(4));
    expect(await ligne(3).evaluate((e) => e.textContent)).toBe("");
    expect(await ligne(5).evaluate((e) => e.textContent)).toBe("");
    await ligne(4).click();
    const muet = await valeur(page, "color", "--ink-muted");
    for (const i of [3, 5]) expect(await ligne(i).locator(".cm-hy-marque").first().evaluate((e) => getComputedStyle(e).color)).toBe(muet);
});
