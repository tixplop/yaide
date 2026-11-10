import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

let dossier;

test.beforeAll(async () => {
  mkdirSync(resolve(process.env.TMPDIR ?? ".test-data"), { recursive: true });
  dossier = mkdtempSync(resolve(process.env.TMPDIR ?? ".test-data", "reponses-"));
  writeFileSync(
    resolve(dossier, "entree.js"),
    `import { conversation } from ${JSON.stringify(resolve("web/src/ui/conversation.js"))};
window.conversation = conversation;`,
  );
  await build({ entryPoints: [resolve(dossier, "entree.js")], bundle: true, outfile: resolve(dossier, "page.js") });
  copyFileSync("web/src/ui/tokens.css", resolve(dossier, "tokens.css"));
  copyFileSync("web/src/ui/composants.css", resolve(dossier, "composants.css"));
  writeFileSync(
    resolve(dossier, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="composants.css"><style>body{margin:0}#h{width:700px;height:700px}</style></head>
<body><input id="avant"><div id="h"></div><input id="apres"><script src="page.js"></script></body></html>`,
  );
});

const COMBOS = [
  ["dark", "--bg-200"],
  ["light", "--bg-200"],
];

/** Réponse suivie d'un message, dans la conversation , sur `--bg-200` (le fond de la session et de l'onglet Agent). */
async function monter(page, { theme = "dark", fond = "--bg-200", md, largeur = 700 }) {
  await page.goto(pathToFileURL(resolve(dossier, "index.html")).href);
  await page.evaluate(
    ({ theme, fond, md, largeur }) => {
      document.documentElement.dataset.theme = theme;
      const h = document.getElementById("h");
      h.style.width = `${largeur}px`;
      const c = window.conversation({ entrees: [{ type: "agent", markdown: md }, { type: "utilisateur", texte: "suite" }] });
      if (fond === "--bg-200") {
        const session = document.createElement("div");
        session.className = "session";
        const zone = document.createElement("div");
        zone.className = "session-conversation";
        zone.append(c);
        session.append(zone);
        h.append(session);
      } else {
        h.append(c);
      }
    },
    { theme, fond, md, largeur },
  );
  // Le fond de la conversation est bien celui demandé.
  expect(await page.locator(".ya-chat").evaluate((e) => {
    for (let n = e; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c !== "rgba(0, 0, 0, 0)") return c;
    }
    return "aucun";
  })).toBe(await jeton(page, fond, "backgroundColor"));
}

/** Valeur calculée d'un token, pour la comparer à un style calculé. */
const jeton = (page, nom, propriete = "color") =>
  page.evaluate(
    ([n, p]) => {
      const d = document.createElement("i");
      d.style[p] = `var(${n})`;
      document.body.append(d);
      const v = getComputedStyle(d)[p];
      d.remove();
      return v;
    },
    [nom, propriete],
  );

const style = (loc, ...props) => loc.evaluate((e, ps) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(e)[p]])), props);
const TRANSPARENT = "rgba(0, 0, 0, 0)";

const TABLEAU = "| Nom | Centre | Droite |\n|---|:---:|---:|\n| a | b | c |\n| d | e | f |\n| g | h | i |";

test("REQ077_AC1_AC2_AC3_AC10_AC11_AC21_AC22_tableau_citation_et_note", async ({ page }) => {
  await test.step("REQ077_AC1_AC2_AC10_tableau", async () => {
    for (const [theme, fond] of COMBOS) {
      await monter(page, { theme, fond, md: TABLEAU });
      const nom = `${theme} ${fond}`;
      const ligne = page.locator(".ya-chat-agent tr");
      const [entete, fondPair, bordure] = [await jeton(page, "--apercu-entete", "backgroundColor"), await jeton(page, "--apercu-fond", "backgroundColor"), await jeton(page, "--line-strong")];
      const cellules = page.locator(".ya-chat-agent th, .ya-chat-agent td");
      expect(await cellules.count(), nom).toBe(12);
      for (let i = 0; i < 12; i++) {
        const s = await style(cellules.nth(i), "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderTopColor", "borderLeftColor", "borderTopStyle", "fontFamily", "fontSize", "lineHeight", "paddingTop", "paddingLeft", "paddingBottom", "paddingRight");
        expect([s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], nom).toEqual(["1px", "1px", "1px", "1px"]);
        expect(s.borderTopColor, nom).toBe(bordure);
        expect(s.borderTopStyle).toBe("solid");
        expect(s.fontFamily).toContain("Segoe");
        expect([s.fontSize, s.lineHeight]).toEqual(["13px", "20px"]);
        expect([s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight]).toEqual(["4px", "4px", "8px", "8px"]);
      }
      const th = await style(page.locator(".ya-chat-agent th").first(), "backgroundColor", "fontWeight");
      expect(th.backgroundColor, nom).toBe(entete);
      expect(th.fontWeight).toBe("600");
      const bg = async (n) => (await style(ligne.nth(n).locator("td").first(), "backgroundColor")).backgroundColor;
      const [l1, l2, l3] = [await bg(1), await bg(2), await bg(3)];
      expect(l1, nom).toBe(TRANSPARENT);
      expect(l3).toBe(l1);
      expect(l2).toBe(fondPair);
      expect(th.backgroundColor).not.toBe(l1);
      expect(th.backgroundColor).not.toBe(l2);
      // Alignements, en-tête compris.
      for (const [rang, align] of [["1", "left"], ["2", "center"], ["3", "right"]]) {
        for (const n of [0, 1, 2, 3]) {
          const c = ligne.nth(n).locator(`> :nth-child(${rang})`);
          expect((await style(c, "textAlign")).textAlign, `${nom} colonne ${rang} ligne ${n}`).toBe(align);
        }
      }
    }
  });
  await test.step("REQ077_AC3_AC11_citation", async () => {
    for (const [theme, fond] of COMBOS) {
      await monter(page, { theme, fond, md: "avant\n\n> texte\n\n> externe\n>\n> > interne" });
      const nom = `${theme} ${fond}`;
      const info = await jeton(page, "--info");
      const msg = await jeton(page, "--msg-info", "backgroundColor");
      const bqs = page.locator(".ya-chat-agent > blockquote");
      const s = await style(bqs.first(), "borderLeftWidth", "borderLeftColor", "borderLeftStyle", "borderTopWidth", "backgroundColor", "color", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight");
      expect(s.borderLeftWidth, nom).toBe("3px");
      expect(s.borderLeftColor).toBe(info);
      expect(s.borderTopWidth).toBe("0px");
      expect(s.backgroundColor).toBe(msg);
      expect(s.color).toBe(await jeton(page, "--ink"));
      expect([s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight]).toEqual(["6px", "6px", "8px", "8px"]);
      const gauche = await page.locator(".ya-chat-agent > p").first().evaluate((e) => e.getBoundingClientRect().left);
      expect(await bqs.first().evaluate((e) => e.getBoundingClientRect().left), nom).toBeCloseTo(gauche, 0);
      const interne = await style(page.locator(".ya-chat-agent blockquote blockquote"), "borderLeftWidth", "borderLeftColor", "backgroundColor");
      expect(interne.borderLeftWidth).toBe("3px");
      expect(interne.borderLeftColor).toBe(info);
      expect(interne.backgroundColor).toBe(TRANSPARENT);
    }
  });
  await test.step("REQ077_AC21_AC22_note", async () => {
    for (const [theme, fond] of COMBOS) {
      await monter(page, { theme, fond, md: "> [!NOTE] Il faut Rust 1.80\n\n> citation\n\n> externe\n>\n> > [!NOTE] dedans" });
      const nom = `${theme} ${fond}`;
      const info = await jeton(page, "--info");
      const note = page.locator(".ya-chat-agent > blockquote.ya-note");
      await expect(note, nom).toHaveCount(1);
      await expect(note.locator(".ya-note-titre")).toHaveText("Note");
      const s = await style(note, "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderTopColor", "borderLeftColor", "borderTopLeftRadius", "backgroundColor", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight");
      expect([s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], nom).toEqual(["1px", "1px", "1px", "1px"]);
      expect([s.borderTopColor, s.borderLeftColor]).toEqual([info, info]);
      expect(s.borderTopLeftRadius).toBe("4px");
      expect(s.backgroundColor).toBe(await jeton(page, "--msg-info", "backgroundColor"));
      expect([s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight]).toEqual(["6px", "6px", "8px", "8px"]);
      const t = await style(note.locator(".ya-note-titre"), "fontWeight", "color");
      expect(t.fontWeight).toBe("600");
      expect(t.color).toBe(info);
      const ecart = await note.evaluate((n) => n.querySelector(".ya-note-titre").nextElementSibling.getBoundingClientRect().top - n.querySelector(".ya-note-titre").getBoundingClientRect().bottom);
      expect(ecart, nom).toBeCloseTo(4, 0);
      // Une citation n'a que son filet gauche ; une note dans une citation n'a pas de fond propre.
      const cit = await style(page.locator(".ya-chat-agent > blockquote:not(.ya-note)").first(), "borderTopWidth", "borderLeftWidth");
      expect([cit.borderTopWidth, cit.borderLeftWidth]).toEqual(["0px", "3px"]);
      expect((await style(page.locator(".ya-chat-agent blockquote blockquote.ya-note"), "backgroundColor")).backgroundColor).toBe(TRANSPARENT);
    }
  });
});



test("REQ077_AC4_AC5_AC6_AC7_AC13_AC14_AC15_AC16_AC17_AC20_listes_code_et_liens", async ({ page }) => {
  await test.step("REQ077_AC5_AC6_AC14_AC15_AC16_listes_trait_marges", async () => {
    const md = "avant\n\n- a\n  - b\n    - c\n- d\n\n1. un\n2. deux\n\n---\n\napres **gras** *ital* ~~barre~~\n\n```\ncode\n```\n\nfin";
    for (const [theme, fond] of COMBOS) {
      await monter(page, { theme, fond, md });
      const nom = `${theme} ${fond}`;
      const types = await page.evaluate(() => {
        const t = (s) => getComputedStyle(document.querySelector(s)).listStyleType;
        return [t(".ya-chat-agent > ul"), t(".ya-chat-agent > ul ul"), t(".ya-chat-agent > ul ul ul"), t(".ya-chat-agent > ol")];
      });
      expect(types, nom).toEqual(["disc", "circle", "square", "decimal"]);
      for (const sel of ["> ul", "> ol", "> ul ul"]) {
        const s = await style(page.locator(`.ya-chat-agent ${sel}`).first(), "paddingLeft");
        expect(s.paddingLeft, `${nom} ${sel}`).toBe("24px");
      }
      expect((await style(page.locator(".ya-chat-agent > ul"), "marginBottom")).marginBottom).toBe("8px");
      expect((await style(page.locator(".ya-chat-agent > ul ul").first(), "marginBottom")).marginBottom).toBe("0px");
      const g = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const agent = document.querySelector(".ya-chat-agent");
        const conv = document.querySelector(".ya-chat");
        const ul = r(".ya-chat-agent > ul");
        return {
          agentGauche: r(".ya-chat-agent").left,
          ulGauche: ul.left,
          sousGauche: r(".ya-chat-agent > ul ul").left,
          olGauche: r(".ya-chat-agent > ol").left,
          convDroite: conv.getBoundingClientRect().right,
          avantUl: ul.top - r(".ya-chat-agent > p").bottom,
          ulOl: r(".ya-chat-agent > ol").top - ul.bottom,
          hrHaut: r(".ya-chat-agent > hr").top - r(".ya-chat-agent > ol").bottom,
          hrBas: [...agent.querySelectorAll(":scope > p")].find((p) => p.textContent.includes("apres")).getBoundingClientRect().top - r(".ya-chat-agent > hr").bottom,
          hrLargeur: r(".ya-chat-agent > hr").width,
          agentLargeur: agent.getBoundingClientRect().width,
          preHaut: r(".ya-chat-agent > pre").top - [...agent.querySelectorAll(":scope > p")].find((p) => p.textContent.includes("apres")).getBoundingClientRect().bottom,
          preBas: [...agent.querySelectorAll(":scope > p")].at(-1).getBoundingClientRect().top - r(".ya-chat-agent > pre").bottom,
          dernierMarge: getComputedStyle([...agent.children].at(-1)).marginBottom,
          sortieAgent: r(".ya-chat-user").top - agent.getBoundingClientRect().bottom,
        };
      });
      expect(g.ulGauche - g.agentGauche, nom).toBeGreaterThanOrEqual(0);
      expect(g.sousGauche, nom).toBeGreaterThan(g.ulGauche);
      expect(g.olGauche).toBe(g.ulGauche);
      expect(g.convDroite).toBeGreaterThan(g.ulGauche);
      expect(g.avantUl).toBeCloseTo(8, 0);
      expect(g.ulOl).toBeCloseTo(8, 0);
      expect(g.hrHaut).toBeCloseTo(12, 0);
      expect(g.hrBas).toBeCloseTo(12, 0);
      expect(g.hrLargeur).toBeCloseTo(g.agentLargeur, 0);
      expect(g.preHaut).toBeCloseTo(8, 0);
      expect(g.preBas).toBeCloseTo(8, 0);
      expect(g.dernierMarge).toBe("0px");
      expect(g.sortieAgent).toBeCloseTo(12, 0);
      const hr = await style(page.locator(".ya-chat-agent > hr"), "borderTopWidth", "borderTopColor", "borderTopStyle");
      expect([hr.borderTopWidth, hr.borderTopStyle]).toEqual(["1px", "solid"]);
      expect(hr.borderTopColor).toBe(await jeton(page, "--line-strong"));
      expect((await style(page.locator(".ya-chat-agent strong"), "fontWeight")).fontWeight).toBe("600");
      expect((await style(page.locator(".ya-chat-agent em"), "fontStyle")).fontStyle).toBe("italic");
      expect((await style(page.locator(".ya-chat-agent s, .ya-chat-agent del"), "textDecorationLine")).textDecorationLine).toBe("line-through");
    }
    // Tableau, puis citation : 8 px entre eux, et chacun, dernier bloc, est à 12 px de l'entrée suivante.
    for (const dernier of ["tableau", "citation"]) {
      const md2 = dernier === "tableau" ? "> c\n\n| a |\n|---|\n| b |" : "| a |\n|---|\n| b |\n\n> c";
      await monter(page, { md: md2 });
      const m = await page.evaluate(() => {
        const enfants = [...document.querySelectorAll(".ya-chat-agent > table, .ya-chat-agent > blockquote")];
        const r = enfants.map((e) => e.getBoundingClientRect());
        const dernier = enfants.at(-1);
        return { entre: r[1].top - r[0].bottom, marge: getComputedStyle(dernier).marginBottom, apres: document.querySelector(".ya-chat-user").getBoundingClientRect().top - r[1].bottom };
      });
      expect(m.entre, dernier).toBeCloseTo(8, 0);
      expect(m.marge, dernier).toBe("0px");
      expect(m.apres, dernier).toBeCloseTo(12, 0);
    }
    // Dernier bloc d'un élément de liste et d'une citation : sans marge basse.
    await monter(page, { md: "- a\n\n  b\n\n> c\n>\n> d" });
    expect((await style(page.locator(".ya-chat-agent li > p").last(), "marginBottom")).marginBottom).toBe("0px");
    expect((await style(page.locator(".ya-chat-agent li > p").first(), "marginBottom")).marginBottom).toBe("8px");
    expect((await style(page.locator(".ya-chat-agent blockquote > p").last(), "marginBottom")).marginBottom).toBe("0px");
  });
  await test.step("REQ077_AC7_AC13_code_colore_sans_editeur", async () => {
    for (const [theme, fond] of COMBOS) {
      await monter(page, { theme, fond, md: "Du `code` en ligne.\n\n```rust\nfn main() {} // note\n```\n\n```\nfn brut\n```" });
      const nom = `${theme} ${fond}`;
      expect(await page.locator(".cm-editor").count(), nom).toBe(0);
      const pre = page.locator(".ya-chat-agent pre");
      const fn = pre.first().locator("span", { hasText: /^fn$/ });
      expect((await style(fn, "color")).color, nom).toBe(await jeton(page, "--syn-keyword"));
      const com = pre.first().locator("span", { hasText: "// note" });
      const c = await style(com, "color", "fontStyle");
      expect(c.color).toBe(await jeton(page, "--syn-comment"));
      expect(c.fontStyle).toBe("italic");
      for (const n of [0, 1]) {
        const s = await style(pre.nth(n), "backgroundColor", "fontFamily", "fontSize", "lineHeight", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight");
        expect(s.backgroundColor).toBe(await jeton(page, "--apercu-fond", "backgroundColor"));
        expect(s.fontFamily).toContain("JetBrains Mono");
        expect([s.fontSize, s.lineHeight]).toEqual(["12px", "18px"]);
        expect([s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight]).toEqual(["6px", "6px", "8px", "8px"]);
      }
      expect(await pre.nth(1).locator("span").count()).toBe(0);
      expect(await pre.nth(1).textContent()).toBe("fn brut\n");
      const enLigne = await style(page.locator(".ya-chat-agent p code"), "backgroundColor", "color", "fontFamily", "fontSize");
      expect(enLigne.backgroundColor).toBe(await jeton(page, "--apercu-fond", "backgroundColor"));
      expect(enLigne.color).toBe((await style(page.locator(".ya-chat-agent p").first(), "color")).color);
      expect(enLigne.fontFamily).toContain("JetBrains Mono");
      expect(enLigne.fontSize).toBe("12px");
    }
  });
  await test.step("REQ077_AC4_AC17_AC20_tab_et_focus_des_liens", async () => {
    const u = "https://exemple.org/a";
    const md = `[p](${u}1) texte\n\n| a |\n|---|\n| [c](${u}2) |\n\n> [q](${u}3)\n\n- [l](${u}4)\n- [ ] case\n\n\`\`\`\ncode\n\`\`\``;
    for (const [theme, fond] of COMBOS) {
      await monter(page, { theme, fond, md });
      const nom = `${theme} ${fond}`;
      for (const sel of ["p", "td", "blockquote", "li"]) {
        const a = page.locator(`.ya-chat-agent ${sel} a`).first();
        expect((await style(a, "textDecorationLine")).textDecorationLine, nom).toBe("underline");
        expect((await style(a, "color")).color).toBe(await jeton(page, "--info"));
      }
      expect(await page.locator(".ya-chat-agent [role], .ya-chat-agent [tabindex]").count(), nom).toBe(0);
      await page.locator("#avant").focus();
      const arrets = [];
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Tab");
        const a = await page.evaluate(() => {
          const e = document.activeElement;
          return e.id || (e.classList.contains("ya-chat") ? "journal" : `${e.tagName}:${e.getAttribute("href")}`);
        });
        if (a === "apres") break;
        arrets.push(a);
      }
      expect(arrets, nom).toEqual(["journal", `A:${u}1`, `A:${u}2`, `A:${u}3`, `A:${u}4`]);
      await page.locator(`.ya-chat-agent a[href="${u}2"]`).focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const o = await style(page.locator(`.ya-chat-agent a[href="${u}2"]`), "outlineWidth", "outlineStyle", "outlineColor", "outlineOffset");
      expect([o.outlineWidth, o.outlineStyle, o.outlineOffset], nom).toEqual(["2px", "solid", "2px"]);
      expect(o.outlineColor).toBe(await jeton(page, "--accent-fg"));
    }
  });
});



test("REQ077_AC9_AC23_AC24_cases_et_largeur_320", async ({ page }) => {
  await test.step("REQ077_AC23_AC24_cases", async () => {
    for (const [theme, fond] of COMBOS) {
      await monter(page, { theme, fond, md: "- [ ] à faire\n- [x] fait\n- puce" });
      const nom = `${theme} ${fond}`;
      const cases = page.locator(".ya-chat-agent li input[type=checkbox]");
      await expect(cases, nom).toHaveCount(2);
      for (const n of [0, 1]) {
        const c = cases.nth(n);
        const b = await c.boundingBox();
        expect([Math.round(b.width), Math.round(b.height)], nom).toEqual([14, 14]);
        const s = await style(c, "borderTopWidth", "borderTopColor", "borderTopStyle", "opacity", "appearance");
        expect([s.borderTopWidth, s.borderTopStyle, s.opacity, s.appearance]).toEqual(["1px", "solid", "1", "none"]);
        expect(s.borderTopColor).toBe(await jeton(page, "--ink-muted"));
        expect(await c.isDisabled()).toBe(true);
        expect((await style(page.locator(".ya-chat-agent li").nth(n), "listStyleType")).listStyleType).toBe("none");
      }
      expect(await cases.nth(0).getAttribute("aria-label")).toBe("À faire");
      expect(await cases.nth(1).getAttribute("aria-label")).toBe("Fait");
      expect(await cases.nth(0).isChecked()).toBe(false);
      expect(await cases.nth(1).isChecked()).toBe(true);
      // Coche : traits de 2 px --ink, seulement sur la case cochée.
      const coche = (n) => cases.nth(n).evaluate((e) => { const s = getComputedStyle(e, "::before"); return [s.content, s.borderLeftWidth, s.borderBottomWidth, s.borderLeftColor]; });
      expect((await coche(0))[0]).toBe("none");
      const [contenu, gauche, bas, couleur] = await coche(1);
      expect(contenu).not.toBe("none");
      expect([gauche, bas]).toEqual(["2px", "2px"]);
      expect(couleur).toBe(await jeton(page, "--ink"));
      // Le texte garde le bord de celui d'un élément à puce.
      const bordTexte = (n) => page.locator(".ya-chat-agent li").nth(n).evaluate((li) => {
        const t = [...li.childNodes].find((x) => x.nodeType === 3 && x.textContent.trim());
        const r = document.createRange();
        r.selectNodeContents(t);
        return r.getBoundingClientRect().left;
      });
      const [t0, t1, t2] = [await bordTexte(0), await bordTexte(1), await bordTexte(2)];
      expect(Math.abs(t0 - t2), nom).toBeLessThanOrEqual(1);
      expect(Math.abs(t1 - t2), nom).toBeLessThanOrEqual(1);
      // Un clic ne change rien, et Tab ne s'y arrête pas.
      await cases.nth(0).click({ force: true });
      expect(await cases.nth(0).isChecked()).toBe(false);
      await page.locator("#avant").focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(page.locator("#apres")).toBeFocused();
    }
  });
  await test.step("REQ077_AC9_largeur_320", async () => {
    const chemin = "src/".concat("dossier/".repeat(10)).slice(0, 80);
    const md = `| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | ${chemin} | 3 | 4 | 5 | 6 |\n\n\`\`\`\n${"x".repeat(300)}\n\`\`\``;
    for (const [largeur, fond] of [[320, "--bg-200"]]) {
      await monter(page, { fond, md, largeur });
      const m = await page.locator(".ya-chat").evaluate((e) => [e.scrollWidth, e.clientWidth]);
      expect(m[0], `${largeur} px`).toBe(m[1]);
      expect(m[1]).toBeLessThanOrEqual(largeur);
      expect(await page.locator(".ya-chat-agent table").evaluate((t) => t.getBoundingClientRect().right <= t.closest(".ya-chat").getBoundingClientRect().right)).toBe(true);
    }
  });
});

