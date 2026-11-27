import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

// P-120 et P-121 : tableur d'un fichier CSV dans le navigateur (REQ-157, REQ-158). Un seul lancement de Yaide ;
// le reste est prouvé par les tests de composant.
const ligne = (page, nom) => page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne(nom) });
const pres = (a, b, t = 1) => expect(Math.abs(a - b)).toBeLessThanOrEqual(t);

// REQ-160 : fond calculé et contraste d'une partie surlignée (fond `--occurrence` posé sur `--bg-200`, texte `--ink`).
const mesurerMarque = (marque) =>
  marque.evaluate((m) => {
    const cs = getComputedStyle(m);
    const nombres = (t) => t.match(/[\d.]+/g).map(Number);
    const base = nombres(cs.backgroundColor);
    const [vr, vg, vb, va = 1] = nombres(cs.backgroundImage.match(/rgba?\([^)]*\)/)[0]);
    const fond = [vr, vg, vb].map((v, i) => v * va + base[i] * (1 - va));
    const lum = (c) => c.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [a, b] = [lum(nombres(cs.color)), lum(fond)];
    return { classe: m.className, base: cs.backgroundColor, image: cs.backgroundImage, couleur: cs.color, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });

test("REQ157_AC1_AC3_AC11_AC9_AC16_REQ158_AC1_REQ157_AC7_AC13_AC15_REQ158_AC5_AC6_REQ160_AC7_AC10_AC11_AC13_parcours_P120_P121_tableur", async ({ page }) => {
  const dossier = depotExemple();
  const clients = path.join(dossier, "clients.csv");
  const original = 'nom,ville,note\nAlice,Paris,12\n"Bob, fils",Lyon,"dit ""oui"""\nChloé,Nantes\n';
  fs.writeFileSync(clients, original);
  const mot = "mot ".repeat(49) + "mots";
  const rangees = [Array.from({ length: 30 }, (_, c) => `col${c + 1}`).join(",")];
  for (let r = 1; r <= 60; r++) rangees.push(Array.from({ length: 30 }, (_, c) => (r === 3 && c === 2 ? mot : r === 4 && c === 2 ? "" : (r === 3 || r === 55) && c === 1 ? "zzz" : `r${r}c${c + 1}`)).join(","));
  fs.writeFileSync(path.join(dossier, "large.csv"), rangees.join("\n") + "\n");
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });

    // P-120, AC-157-1 : grille à l'ouverture, « nom » active avec le focus.
    await ligne(page, "clients.csv").click();
    const hybride = page.getByRole("button", { name: "Mode hybride" });
    const theme = page.getByRole("button", { name: "Thème clair du tableur" });
    const grille = page.getByRole("grid", { name: "Tableur clients.csv" });
    await expect(hybride).toHaveAttribute("aria-pressed", "true");
    await expect(grille).toBeVisible();
    await expect(grille.getByRole("row")).toHaveCount(4);
    await expect(grille.getByRole("columnheader", { name: "nom" })).toBeFocused();
    await expect(theme).toHaveAttribute("aria-pressed", "false");
    // AC-158-6 : « Thème clair du tableur » à 8 px après « Mode hybride ».
    await expect(hybride).toBeVisible();
    await expect(theme).toBeVisible();
    await expect
      .poll(async () => {
        const bh = await hybride.boundingBox();
        const bt = await theme.boundingBox();
        return bh && bt ? Math.abs(bt.x - (bh.x + bh.width) - 8) : null;
      })
      .toBeLessThanOrEqual(1);

    // AC-157-11 : Bas, Droite, Droite, Entrée, `15`, Entrée.
    await page.keyboard.press("ArrowDown");
    await expect(grille.getByRole("gridcell", { name: "Alice" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    const saisie = grille.getByRole("textbox");
    await expect(saisie).toBeFocused();
    await page.keyboard.press("Backspace"); // curseur à la fin : « 12 » → « 1 » → « »
    await page.keyboard.press("Backspace");
    await page.keyboard.type("15");
    await page.keyboard.press("Enter");
    const cellule15 = grille.getByRole("gridcell", { name: "15" });
    await expect(cellule15).toBeFocused();
    await expect(cellule15).toHaveAttribute("tabindex", "0");

    // AC-158-1, AC-158-5 : thème clair sur la zone, Yaide reste sombre.
    const resoudre = (el, propriete, jeton) => el.evaluate((e, [p, j]) => {
      const sonde = document.createElement("div");
      sonde.style.setProperty(p, `var(${j})`);
      e.append(sonde);
      const v = getComputedStyle(sonde)[p === "background" ? "backgroundColor" : p === "border-color" ? "borderTopColor" : "color"];
      sonde.remove();
      return v;
    }, [propriete, jeton]);
    const zone = page.locator(".ya-tableur");
    const fondSombre = await resoudre(page.locator("html"), "background", "--bg-200");
    await theme.click();
    await expect(theme).toHaveAttribute("aria-pressed", "true");
    await expect(cellule15).toHaveClass(/ya-cellule-active/);
    const fondClair = await resoudre(zone, "background", "--bg-200");
    expect(fondClair).not.toBe(fondSombre);
    expect(await zone.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(fondClair);
    expect(await zone.evaluate((e) => getComputedStyle(e).colorScheme)).toBe("light");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    expect(await page.getByRole("tab", { name: /^clients\.csv/ }).evaluate((e) => getComputedStyle(e.closest("[role=tablist]")).backgroundColor)).not.toBe(fondClair);

    // P-120 étape 4, AC-157-3 : Ctrl+S, seul `12` devient `15` sur le disque.
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(clients, "utf8")).toBe(original.replace("Paris,12", "Paris,15"));

    // AC-158-6 : info-bulles, celle du bouton sur le fond sombre de Yaide, celle d'un disque sur le fond clair.
    const infoBulle = page.getByRole("tooltip");
    await theme.hover();
    await expect(infoBulle).toHaveText("Thème clair du tableur");
    expect(await infoBulle.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(42, 42, 43)");
    await expect(grille.getByRole("gridcell", { name: "Bob, fils" })).toBeVisible();
    await expect(grille.getByRole("columnheader", { name: "ville" })).toBeVisible();
    const c0 = await grille.getByRole("columnheader", { name: "nom" }).boundingBox();
    const c1 = await grille.getByRole("columnheader", { name: "ville" }).boundingBox();
    const r1 = await grille.getByRole("gridcell", { name: "Alice" }).boundingBox();
    const r2 = await grille.getByRole("gridcell", { name: "Bob, fils" }).boundingBox();
    const pointe = async (x, y) => {
      await page.mouse.move(x - 30, y - 30);
      await page.mouse.move(x, y, { steps: 4 });
    };
    await pointe(c0.x + c0.width / 3, (r1.y + r1.height + r2.y) / 2);
    const insLigne = page.getByRole("button", { name: "Insérer une ligne" });
    await expect(insLigne).toBeVisible();
    await insLigne.hover();
    await expect(infoBulle).toHaveText("Insérer une ligne");
    expect(await infoBulle.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 255, 255)");
    // AC-157-7 : « Insérer une colonne » sur la bordure entre « nom » et « ville » → la nouvelle colonne en saisie.
    await pointe((c0.x + c0.width + c1.x) / 2, r1.y + r1.height / 2);
    await page.getByRole("button", { name: "Insérer une colonne" }).click();
    await expect(grille.getByRole("textbox", { name: "En-tête de la colonne 2" })).toBeFocused();
    await expect(grille.getByRole("row").first().getByRole("columnheader")).toHaveCount(4);
    await page.keyboard.press("Escape");

    // REQ-160 AC-160-10 : `o` cherché, « Bob, fils » active ; une partie surlignée dans l'en-tête, une cellule et la cellule active, dans les deux thèmes.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(grille.getByRole("gridcell", { name: "Bob, fils" })).toBeFocused();
    await page.keyboard.press("Control+f");
    const panneauClients = page.getByRole("search", { name: "Rechercher dans clients.csv" });
    const champClients = panneauClients.locator("input");
    await expect(champClients).toBeFocused();
    await page.keyboard.type("o");
    const marquesTheme = async () => {
      const fondZone = await resoudre(zone, "background", "--bg-200");
      const occurrence = await resoudre(zone, "background", "--occurrence");
      const encre = await resoudre(zone, "color", "--ink");
      for (const marque of [
        grille.getByRole("columnheader", { name: "note" }).locator("mark"),
        grille.getByRole("gridcell", { name: "Lyon" }).locator("mark"),
        grille.getByRole("gridcell", { name: "Bob, fils" }).locator("mark"),
      ]) {
        const m = await mesurerMarque(marque);
        expect(m.classe).toBe("ya-occurrence");
        expect(m.base).toBe(fondZone);
        expect(m.image).toContain(occurrence);
        expect(m.couleur).toBe(encre);
        expect(m.ratio).toBeGreaterThanOrEqual(4.5);
      }
    };
    await marquesTheme();
    await theme.click();
    await expect(theme).toHaveAttribute("aria-pressed", "false");
    await marquesTheme();
    await theme.click();
    await expect(theme).toHaveAttribute("aria-pressed", "true");
    // « Nantes, Laval » saisi : trois `mark` pour `a`, et la cellule ne compte qu'une fois.
    await champClients.fill("a");
    await expect(panneauClients.locator(".ya-recherche-compteur")).toContainText("3");
    await grille.getByRole("gridcell", { name: "Nantes" }).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Nantes, Laval");
    await page.keyboard.press("Enter");
    await expect(grille.getByRole("gridcell", { name: "Nantes, Laval" }).locator("mark")).toHaveCount(3);
    await expect(panneauClients.locator(".ya-recherche-compteur")).toContainText("3");
    await panneauClients.getByRole("button", { name: "Fermer la recherche" }).click();
    await expect(panneauClients).toBeHidden();
    await grille.getByRole("gridcell", { name: "Nantes, Laval" }).focus();
    await page.keyboard.press("Control+z"); // le guillemet de la cellule ne doit pas fermer celui de P-121
    await expect(grille.getByRole("gridcell", { name: "Nantes", exact: true })).toBeVisible();

    // P-121, AC-157-9, AC-157-16 : « Mode hybride » éteint, ligne 3 sans guillemet fermant, mode rallumé.
    await hybride.click();
    await expect(grille).toBeHidden();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.type('"Bob, fils,Lyon,14');
    await hybride.click();
    const alerte = page.locator(".ya-alerte-tableur .message-texte");
    await expect(alerte).toHaveText("Tableur indisponible : guillemet non fermé à la ligne 3.");
    await expect(hybride).toHaveAttribute("aria-pressed", "true");
    await expect(theme).toBeHidden();
    await expect(grille).toBeHidden();
    await expect(page.locator(".ya-alerte-tableur")).toHaveAttribute("role", "alert");
    const ba = await page.locator(".ya-alerte-tableur").boundingBox();
    const bf = await page.locator(".ya-crumbs").boundingBox();
    expect(ba.y + ba.height).toBeLessThanOrEqual(bf.y + 1);
    // AC-158-6 : message sur `--msg-alerte` de Yaide (sombre).
    expect(await page.locator(".ya-alerte-tableur").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await resoudre(page.locator("html"), "background", "--msg-alerte"));
    // `--msg-alerte` est translucide : le premier fond opaque derrière le message est le `--bg-200` sombre.
    expect(await page.locator(".ya-alerte-tableur").evaluate((e) => {
      for (let n = e.parentElement; n; n = n.parentElement) {
        const f = getComputedStyle(n).backgroundColor;
        if (f !== "rgba(0, 0, 0, 0)") return f;
      }
    })).toBe(fondSombre);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.type('"');
    const bobFils = grille.getByRole("gridcell", { name: "Bob, fils" });
    await expect(bobFils).toBeFocused();
    await expect(bobFils).toHaveAttribute("tabindex", "0");
    await expect(alerte).toHaveText("");
    await page.keyboard.press("Control+z");
    await expect(alerte).toHaveText("Tableur indisponible : guillemet non fermé à la ligne 3.");
    await expect(page.locator(".cm-content")).toBeFocused();
    await page.keyboard.press("Control+y");
    await expect(grille).toBeVisible();

    // AC-157-13, AC-157-15 : grande grille, défilement et styles calculés.
    await ligne(page, "large.csv").click();
    const grande = page.getByRole("grid", { name: "Tableur large.csv" });
    await expect(grande).toBeVisible();
    // Éditeur de 600 px : la fenêtre est réduite de l'écart mesuré.
    const largeurZone = async () => (await zone.locator("visible=true").first().boundingBox()).width;
    await page.setViewportSize({ width: 1280 - Math.round((await largeurZone()) - 600), height: 700 });
    await expect.poll(async () => Math.abs((await largeurZone()) - 600)).toBeLessThanOrEqual(1);
    await expect(grande.getByRole("columnheader", { name: "col1", exact: true })).toBeFocused();
    await expect(hybride).toBeVisible();
    await expect(theme).toBeVisible();
    const bh2 = await hybride.boundingBox();
    const bt2 = await theme.boundingBox();
    const lg = await zone.locator("visible=true").first().evaluate((e) => ({ l: e.clientWidth, s: e.scrollWidth }));
    expect(lg.s).toBeGreaterThan(lg.l);
    await zone.locator("visible=true").first().evaluate((e) => (e.scrollLeft = 400));
    expect((await hybride.boundingBox()).x).toBe(bh2.x);
    expect((await theme.boundingBox()).x).toBe(bt2.x);
    await zone.locator("visible=true").first().evaluate((e) => (e.scrollLeft = 0));
    const texteMax = await grande.getByRole("gridcell", { name: mot, exact: true }).evaluate((e) => {
      return e.querySelector(".ya-cellule-texte").getBoundingClientRect().width;
    });
    expect(texteMax).toBeLessThanOrEqual(320);
    expect((await grande.getByRole("row").nth(4).getByRole("gridcell").nth(2).boundingBox()).width).toBeGreaterThanOrEqual(32);

    const z = zone.locator("visible=true").first();
    const style = (el, p) => el.evaluate((e, q) => getComputedStyle(e)[q], p);
    const entete = grande.getByRole("columnheader", { name: "col2", exact: true });
    const autre = grande.getByRole("gridcell", { name: "r2c2", exact: true });
    expect(await style(entete, "backgroundColor")).toBe(await resoudre(z, "background", "--apercu-entete"));
    expect(await style(entete, "fontWeight")).toBe("600");
    // Les cellules ordinaires n'ont pas de fond propre : celui de la zone (`--bg-200`) les porte.
    expect(await style(autre, "backgroundColor")).toBe(await resoudre(z, "background", "--bg-200"));
    const faint = await resoudre(z, "border-color", "--ink-faint");
    expect(await style(autre, "borderRightColor")).toBe(faint);
    expect(await style(autre, "borderBottomColor")).toBe(faint);
    const accent = await resoudre(z, "color", "--accent-fg");
    const soft = await resoudre(z, "background", "--accent-soft");
    const active = grande.getByRole("columnheader", { name: "col1", exact: true });
    expect(await style(active, "backgroundImage")).toContain(soft);
    expect(await style(active, "outlineWidth")).toBe("2px");
    expect(await style(active, "outlineColor")).toBe(accent);
    await page.evaluate(() => document.activeElement.blur());
    expect(await style(active, "backgroundImage")).toContain(soft);
    expect(await style(active, "outlineStyle")).toBe("none");
    await active.focus();
    await page.keyboard.press("Enter");
    const td = grande.getByRole("columnheader").first();
    expect(await style(td, "backgroundImage")).toBe("none");
    expect(await style(td, "outlineWidth")).toBe("2px");
    expect(await style(td, "outlineColor")).toBe(accent);
    await page.keyboard.press("Escape");

    // Zone défilée en bas : la première rangée reste en haut ; Haut jusqu'à la deuxième rangée.
    await grande.getByRole("gridcell", { name: "r60c1", exact: true }).scrollIntoViewIfNeeded();
    await grande.getByRole("gridcell", { name: "r60c1", exact: true }).click();
    await page.keyboard.press("Escape");
    const haut = async () => {
      const zb = await z.boundingBox();
      const tb = await grande.getByRole("columnheader", { name: "col1", exact: true }).boundingBox();
      // Collée en haut de la zone (au plus la marge de 12 px de la zone) : sans `sticky`, elle serait sortie par le haut.
      expect(tb.y).toBeGreaterThanOrEqual(zb.y);
      expect(tb.y).toBeLessThanOrEqual(zb.y + 13);
      return { zone: zb, entete: tb };
    };
    await haut();
    for (let r = 59; r >= 1; r--) {
      await page.keyboard.press("ArrowUp");
      // Le défilement vers la cellule active se fait après la touche : on attend qu'elle soit entière sous la première rangée.
      // Une seule mesure dans la page par essai : mêmes valeurs que `haut()` et la cellule, sans une dizaine d'allers-retours.
      await expect.poll(() => z.evaluate((e, nom) => {
        const zb = e.getBoundingClientRect();
        const trouver = (role, texte) => [...e.querySelectorAll(`[role=${role}]`)].find((x) => x.textContent.trim() === texte);
        const tb = trouver("columnheader", "col1").getBoundingClientRect();
        const cb = trouver("gridcell", nom).getBoundingClientRect();
        const bas = zb.y + e.clientHeight;
        return tb.y >= zb.y && tb.y <= zb.y + 13 && cb.y >= tb.y + tb.height - 1 && cb.y + cb.height <= bas + 1;
      }, `r${r}c1`)).toBe(true);
    }

    // REQ-160 AC-160-7, AC-160-13, AC-160-11 : `zzz` aux rangées 3 et 55 de large.csv, tableur clair dans un Yaide sombre.
    await expect(theme).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Control+f");
    const panneau = page.getByRole("search", { name: "Rechercher dans large.csv" });
    await expect(panneau.locator("input")).toBeFocused();
    await page.keyboard.type("zzz");
    const cellule = (r) => grande.getByRole("row").nth(r).getByRole("gridcell").nth(1);
    // Cellule entière dans la zone, sous la rangée d'en-tête et sous le panneau (42 px au moins du haut).
    const visible = async (r) => {
      const zb = await z.boundingBox();
      const cb = await cellule(r).boundingBox();
      const eb = await grande.getByRole("columnheader", { name: "col1", exact: true }).boundingBox();
      const bas = zb.y + (await z.evaluate((e) => e.clientHeight));
      return cb.y >= zb.y + 42 && cb.y >= eb.y + eb.height - 1 && cb.y + cb.height <= bas + 1;
    };
    await page.keyboard.press("F3");
    await expect.poll(() => visible(3)).toBe(true);
    await page.keyboard.press("F3");
    await expect(cellule(55)).toHaveClass(/ya-cellule-active/);
    await expect.poll(() => visible(55)).toBe(true);
    await expect(panneau.locator("input")).toBeFocused();
    await grande.getByRole("gridcell", { name: "r40c1", exact: true }).scrollIntoViewIfNeeded();
    await page.keyboard.press("F3");
    await expect(cellule(3)).toHaveClass(/ya-cellule-active/);
    await expect.poll(() => visible(3)).toBe(true);
    // AC-160-11 : fond blanc, à 16 px du bord droit et 4 px du haut de la zone, immobile, devant la rangée d'en-tête.
    const conteneur = page.locator(".ya-tableur-conteneur").locator("visible=true").first();
    expect(await panneau.evaluate((e) => Boolean(e.closest("[data-theme=light]")))).toBe(true);
    expect(await panneau.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 255, 255)");
    const place = async () => {
      const cb = await conteneur.boundingBox();
      const pb = await panneau.boundingBox();
      return { droite: cb.x + cb.width - (pb.x + pb.width), haut: pb.y - cb.y, pb };
    };
    const avant = await place();
    pres(avant.droite, 16);
    pres(avant.haut, 4);
    await z.evaluate((e) => (e.scrollTop += 10 * e.querySelector("tr:nth-child(5)").getBoundingClientRect().height));
    await expect.poll(() => z.evaluate((e) => e.scrollTop)).toBeGreaterThan(100);
    expect((await place()).pb).toEqual(avant.pb);
    expect(await panneau.locator("input").evaluate((e) => {
      const b = e.getBoundingClientRect();
      return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === e;
    })).toBe(true);
  } finally {
    await yaide.arreter();
  }
});
