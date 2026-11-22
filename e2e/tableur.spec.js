import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

// P-120 et P-121 : tableur d'un fichier CSV dans le navigateur (REQ-157, REQ-158). Un seul lancement de Yaide ;
// le reste est prouvé par les tests de composant.
const ligne = (page, nom) => page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne(nom) });
const pres = (a, b, t = 1) => expect(Math.abs(a - b)).toBeLessThanOrEqual(t);

test("REQ157_AC1_AC3_AC11_AC9_AC16_REQ158_AC1_REQ157_AC7_AC13_AC15_REQ158_AC5_AC6_parcours_P120_P121_tableur", async ({ page }) => {
  const dossier = depotExemple();
  const clients = path.join(dossier, "clients.csv");
  const original = 'nom,ville,note\nAlice,Paris,12\n"Bob, fils",Lyon,"dit ""oui"""\nChloé,Nantes\n';
  fs.writeFileSync(clients, original);
  const mot = "mot ".repeat(49) + "mots";
  const rangees = [Array.from({ length: 30 }, (_, c) => `col${c + 1}`).join(",")];
  for (let r = 1; r <= 60; r++) rangees.push(Array.from({ length: 30 }, (_, c) => (r === 3 && c === 2 ? mot : r === 4 && c === 2 ? "" : `r${r}c${c + 1}`)).join(","));
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
    const bh = await hybride.boundingBox();
    const bt = await theme.boundingBox();
    pres(bt.x - (bh.x + bh.width), 8);

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
      await expect.poll(async () => {
        const { zone: zb, entete: tb } = await haut();
        const cb = await grande.getByRole("gridcell", { name: `r${r}c1`, exact: true }).boundingBox();
        const bas = zb.y + (await z.evaluate((e) => e.clientHeight));
        return cb.y >= tb.y + tb.height - 1 && cb.y + cb.height <= bas + 1;
      }).toBe(true);
    }
  } finally {
    await yaide.arreter();
  }
});
