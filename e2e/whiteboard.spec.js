import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne, avancer } from "./aides.js";
import { lancerRelais } from "./relais.js";

// P-096 : parcours d'un whiteboard dans le navigateur.
const ligne = (page, nom) => page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne(nom) });
const centre = async (el) => {
  const r = await el.boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
const proche = (a, b) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
const dans = async (texte, cadre) => {
  await expect(texte).toBeVisible();
  const t = await texte.boundingBox();
  const c = await cadre.boundingBox();
  expect(t.x).toBeGreaterThanOrEqual(c.x - 1);
  expect(t.y).toBeGreaterThanOrEqual(c.y - 1);
  expect(t.x + t.width).toBeLessThanOrEqual(c.x + c.width + 1);
  expect(t.y + t.height).toBeLessThanOrEqual(c.y + c.height + 1);
};
const glisser = async (page, de, vers) => {
  await page.mouse.move(de.x, de.y);
  await page.mouse.down();
  await page.mouse.move((de.x + vers.x) / 2, (de.y + vers.y) / 2, { steps: 5 });
  await page.mouse.move(vers.x, vers.y, { steps: 5 });
  await page.mouse.up();
};

test("REQ127_AC1_REQ129_AC1_REQ130_AC1_AC13_REQ133_AC8_REQ134_AC1_AC7_REQ136_AC1_REQ128_AC2_REQ131_AC2_REQ137_AC1_AC2_AC4_REQ139_AC1_AC4_REQ142_AC1_AC4_REQ143_AC1_AC2_AC5_REQ145_AC1_AC3_REQ133_AC13_REQ147_AC1_AC9_REQ139_AC6_REQ146_AC4_AC5_AC9_REQ149_AC1_AC2_AC6_AC9_REQ150_AC1_AC4_REQ133_AC14_parcours_P096_P100_P101_P102_P103_P106_P109_P110_P111_P112_whiteboard", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dossier, "docs/a.md"), "# A\n");
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    // AC-127-1 : création depuis le menu de l'arborescence.
    await ligne(page, "docs").click();
    await ligne(page, "a.md").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Nouveau whiteboard" }).click();
    const dialogue = page.getByRole("dialog", { name: "Nouveau whiteboard" });
    await expect(dialogue.getByRole("textbox", { name: "Chemin" })).toHaveValue("docs/");
    await page.keyboard.type("plan");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "plan.jdiag" })).toHaveAttribute("aria-selected", "true");
    const surface = page.getByRole("application", { name: "plan.jdiag" });
    await expect(surface).toBeFocused();
    expect(fs.existsSync(path.join(dossier, "docs/plan.jdiag"))).toBe(true);

    // AC-129-1 : double-clic sur la surface, saisie du texte.
    const r = await surface.boundingBox();
    expect(r.height).toBeGreaterThan(600);
    await page.mouse.dblclick(r.x + 200, r.y + 300);
    await page.keyboard.type("Début");
    await page.keyboard.press("Escape");
    const debut = surface.locator('[aria-roledescription="boîte"]').filter({ hasText: "Début" });
    await expect(debut).toBeVisible();
    await dans(debut.getByText("Début"), debut);

    await page.getByRole("button", { name: "Ajouter une boîte" }).click();
    await page.keyboard.type("Fin");
    await page.keyboard.press("Escape");
    const fin = surface.locator('[aria-roledescription="boîte"]').filter({ hasText: "Fin" });
    await dans(fin.getByText("Fin"), fin);
    // Double-clic réel sur « Début » (non choisie) : la saisie se lance, curseur après le texte.
    const cd = await centre(debut);
    await page.mouse.dblclick(cd.x, cd.y);
    const zoneDebut = page.getByRole("textbox", { name: "Texte de la boîte" });
    await expect(zoneDebut).toBeFocused();
    expect(await page.evaluate(() => getSelection().anchorOffset)).toBe(5);
    await page.keyboard.press("Escape");
    const avant = await centre(fin);
    await glisser(page, { x: avant.x + 20, y: avant.y }, { x: avant.x + 320, y: avant.y });
    const apres = await centre(fin);
    expect(Math.abs(apres.x - avant.x - 300)).toBeLessThanOrEqual(2);

    // AC-130-1 : à 10 px du bord droit de « Début », quatre connecteurs ; le connecteur droit glissé près du côté gauche de « Fin ».
    const rd = await debut.boundingBox();
    await page.mouse.move(rd.x + rd.width + 10, rd.y + rd.height / 2);
    await expect(surface.locator(".connecteurs .connecteur")).toHaveCount(5);
    const rf = await fin.boundingBox();
    await glisser(page, await centre(surface.locator('[data-connecteur="right"]')), { x: rf.x + 10, y: rf.y + rf.height / 2 });
    await expect(surface.locator('[aria-roledescription="lien"]')).toHaveCount(1);
    await expect(surface.getByLabel("De Début vers Fin")).toHaveCount(1);

    // AC-133-8 : la boîte à outils est à 12 px du bord gauche et du bord bas de la surface.
    const barre = await page.locator(".ya-tableau-outils").boundingBox();
    const rs = await surface.boundingBox();
    proche(barre.x - rs.x, 12);
    proche(rs.y + rs.height - (barre.y + barre.height), 12);

    // AC-134-1, AC-134-7 : « Cercle », clic sur une partie vide, texte dans le carré inscrit.
    await page.getByRole("button", { name: "Cercle", exact: true }).click();
    await page.mouse.click(rs.x + 700, rs.y + 150);
    await page.keyboard.type("Départ");
    await page.keyboard.press("Escape");
    const cercle = surface.locator('[aria-roledescription="boîte"]').filter({ hasText: "Départ" });
    const rc = await cercle.boundingBox();
    const cote = rc.width * Math.SQRT1_2;
    const carre = { x: rc.x + (rc.width - cote) / 2, y: rc.y + (rc.height - cote) / 2, width: cote, height: cote };
    const rt = await cercle.getByText("Départ").boundingBox();
    expect(rt.x).toBeGreaterThanOrEqual(carre.x - 1);
    expect(rt.y).toBeGreaterThanOrEqual(carre.y - 1);
    expect(rt.x + rt.width).toBeLessThanOrEqual(carre.x + carre.width + 1);
    expect(rt.y + rt.height).toBeLessThanOrEqual(carre.y + carre.height + 1);

    // AC-136-1 : « Flèche », glisser sur une partie vide.
    await page.getByRole("button", { name: "Flèche", exact: true }).click();
    await glisser(page, { x: rs.x + 500, y: rs.y + 450 }, { x: rs.x + 700, y: rs.y + 530 });
    await expect(surface.locator('[aria-roledescription="flèche"]')).toHaveCount(1);

    // AC-128-2 : Ctrl+S écrit le fichier au format de REQ-132.
    await page.keyboard.press("Control+s");
    const fichier = path.join(dossier, "docs/plan.jdiag");
    await expect.poll(() => fs.readFileSync(fichier, "utf8")).toContain('"arrows"');
    const doc = JSON.parse(fs.readFileSync(fichier, "utf8"));
    expect(doc.version).toBe(1);
    expect(doc.boxes.map((b) => b.text)).toEqual(["Début", "Fin", "Départ"]);
    expect(doc.boxes[2].shape).toBe("ellipse");
    expect(doc.links).toEqual([{ id: "l1", from: "b1", to: "b2", fromSide: "right", toSide: "left" }]);
    expect(doc.arrows).toHaveLength(1);
    expect(fs.readFileSync(fichier, "utf8")).toContain('"fromSide": "right", "toSide": "left"');
    expect(fs.readFileSync(fichier, "utf8")).toMatch(/^ {2}"boxes": \[\n {4}\{"id": "b1", .*\},\n {4}\{"id": "b2", .*\},\n {4}\{"id": "b3", .*\}\n {2}\],\n/m);

    // AC-131-2 : Ctrl+molette sur « Début », le point sous le pointeur reste en place.
    const zoom = page.getByRole("status").filter({ hasText: "%" });
    const avantZoom = parseInt((await zoom.textContent()).replace(/\D/g, ""), 10);
    const r0 = await debut.boundingBox();
    const p = { x: r0.x + r0.width * 0.25, y: r0.y + r0.height * 0.25 };
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(async () => parseInt((await zoom.textContent()).replace(/\D/g, ""), 10)).toBeGreaterThan(avantZoom);
    // Le point sous le pointeur reste le même : sa place relative dans la boîte ne change pas (à 1 px près).
    const r1 = await debut.boundingBox();
    expect(r1.width).toBeGreaterThan(r0.width);
    proche(r1.x + r1.width * 0.25, p.x);
    proche(r1.y + r1.height * 0.25, p.y);

    // P-100 : « Tout afficher », puis saisie de « Fin » avec un clic réel sur « Grand » (AC-139-1, AC-139-4).
    await page.getByRole("button", { name: "Tout afficher" }).click();
    const cf = await centre(fin);
    await page.mouse.dblclick(cf.x, cf.y);
    const zoneFin = page.getByRole("textbox", { name: "Texte de la boîte" });
    await expect(zoneFin).toBeFocused();
    await page.getByRole("button", { name: "Grand", exact: true }).click();
    await expect(zoneFin).toBeFocused();
    await expect(page.getByRole("button", { name: "Grand", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("End");
    await page.keyboard.type(" du flux");
    await page.keyboard.press("Escape");
    await expect(surface.locator('[aria-roledescription="boîte"]').filter({ hasText: "Fin du flux" })).toHaveCount(1);

    // AC-137-1 : outil « Sélection », glisser réel autour de « Début » et « Fin du flux ».
    await page.getByRole("button", { name: "Sélection", exact: true }).click();
    const b1 = await debut.boundingBox();
    const b2 = await fin.boundingBox();
    await glisser(page, { x: b1.x - 15, y: b1.y - 15 }, { x: b2.x + b2.width + 15, y: b2.y + b2.height + 15 });
    await expect(page.getByRole("status").filter({ hasText: "objets choisis" })).toHaveText("3 objets choisis");

    // AC-137-2 : flèche Bas, les deux boîtes descendent de 10 px du dessin, le lien suit.
    const echelle = parseInt((await zoom.textContent()).replace(/\D/g, ""), 10) / 100;
    const h1 = await debut.boundingBox();
    const h2 = await fin.boundingBox();
    const lien = surface.locator('[aria-roledescription="lien"]');
    const hl = await lien.boundingBox();
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await debut.boundingBox()).y - h1.y).toBeGreaterThan(10 * echelle - 1.5);
    expect(Math.abs((await debut.boundingBox()).y - h1.y - 10 * echelle)).toBeLessThanOrEqual(1.5);
    expect(Math.abs((await fin.boundingBox()).y - h2.y - 10 * echelle)).toBeLessThanOrEqual(1.5);
    await expect(surface.getByLabel("De Début vers Fin du flux")).toHaveCount(1);
    expect(Math.abs((await lien.boundingBox()).y - hl.y - 10 * echelle)).toBeLessThanOrEqual(1.5);
    await expect(page.getByRole("status").filter({ hasText: "objets choisis" })).toHaveText("3 objets choisis");

    // AC-137-4 : prouvé par tableau-selection.test.js (REQ137_AC4_copier_coller_deux_fois_puis_autre_onglet_et_lien_seul) : copie dans un autre onglet, mêmes valeurs.

    // AC-139-1 : Ctrl+S dans l'onglet du plan, « Fin du flux » en grand.
    await page.getByRole("tab", { name: "plan.jdiag" }).click();
    await surface.focus();
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(fichier, "utf8")).toContain('"text": "Fin du flux"');
    expect(fs.readFileSync(fichier, "utf8")).toContain('"textSize": "large"');

    // P-102 : « Autre » sous « Fin du flux », puis le bout d'arrivée du lien déplacé à la souris (AC-142-1, AC-142-4).
    await page.getByRole("button", { name: "Tout afficher" }).click();
    const rfin = await fin.boundingBox();
    const vide = { x: rfin.x + rfin.width / 2, y: rfin.y + rfin.height + 80 };
    await page.mouse.dblclick(vide.x, vide.y);
    await page.keyboard.type("Autre");
    await page.keyboard.press("Escape");
    const autre = surface.locator('[aria-roledescription="boîte"]').filter({ hasText: "Autre" });
    await expect(autre).toHaveCount(1);
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(fichier, "utf8")).toContain('"text": "Autre"');
    await expect(page.getByRole("tab", { name: /^plan\.jdiag.*, non sauvegardé/ })).toHaveCount(0);
    const texteAvant = fs.readFileSync(fichier, "utf8");
    // Clic réel sur le lien : une poignée à chaque bout ; lâcher sur une partie vide → rien ne change.
    await surface.locator('[aria-roledescription="lien"]').click();
    await expect(surface.locator("[data-poignee]")).toHaveCount(2);
    const poignee = () => centre(surface.locator('[data-poignee="arrivee"]'));
    const videBas = { x: rfin.x + rfin.width + 100, y: rfin.y + rfin.height + 160 };
    await glisser(page, await poignee(), videBas);
    await expect(surface.locator("[data-poignee]")).toHaveCount(2);
    await expect(page.getByRole("tab", { name: /^plan\.jdiag.*, non sauvegardé/ })).toHaveCount(0);
    await page.keyboard.press("Control+s");
    expect(fs.readFileSync(fichier, "utf8")).toBe(texteAvant);
    // Lâcher près du côté haut de « Autre » → le lien arrive sur son côté haut.
    const ra2 = await autre.boundingBox();
    await glisser(page, await poignee(), { x: ra2.x + ra2.width / 2, y: ra2.y + 6 });
    await expect(page.getByRole("tab", { name: /^plan\.jdiag.*, non sauvegardé/ })).toHaveCount(1);
    await page.keyboard.press("Control+s");
    await expect.poll(() => JSON.parse(fs.readFileSync(fichier, "utf8")).links[0].toSide).toBe("top");
    const docAutre = JSON.parse(fs.readFileSync(fichier, "utf8"));
    expect(docAutre.links[0].to).toBe(docAutre.boxes.find((b) => b.text === "Autre").id);

    // P-103 : thème clair propre aux whiteboards (AC-143-1, AC-143-5), conservé au rechargement (AC-143-2).
    const zone = page.locator(".ya-tableau-zone").first();
    const fond200 = (theme) => page.evaluate((t) => {
      const e = document.createElement("div");
      e.setAttribute("data-theme", t);
      document.body.append(e);
      e.style.background = "var(--bg-200)";
      const v = getComputedStyle(e).backgroundColor;
      e.remove();
      return v;
    }, theme);
    const fondSurface = () => surface.evaluate((e) => getComputedStyle(e.closest(".ya-tableau-zone").querySelector(".ya-tableau")).backgroundColor);
    const fondBarre = () => page.getByRole("tab", { name: /^plan\.jdiag/ }).evaluate((e) => getComputedStyle(e.closest("[role=tablist]")).backgroundColor);
    const sombre200 = await fond200("dark");
    const clair200 = await fond200("light");
    expect(await fondSurface()).toBe(sombre200);
    const bouton = page.getByRole("button", { name: "Thème clair du whiteboard" });
    await expect(bouton).toHaveAttribute("aria-pressed", "false");
    const barreAvant = await fondBarre();
    await bouton.click();
    await expect(bouton).toHaveAttribute("aria-pressed", "true");
    expect(await fondSurface()).toBe(clair200);
    expect(await fondBarre()).toBe(barreAvant);
    expect(await zone.evaluate((e) => getComputedStyle(e).colorScheme)).toBe("light");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    // Rechargement : clair dès que la surface est dans le DOM, sans passer par le sombre.
    await page.addInitScript(() => {
      window.__fonds = [];
      new MutationObserver(() => {
        const f = document.querySelector(".ya-tableau-zone .ya-tableau");
        if (f) window.__fonds.push(getComputedStyle(f).backgroundColor);
      }).observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    await expect(page.getByRole("application", { name: "plan.jdiag" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Thème clair du whiteboard" })).toHaveAttribute("aria-pressed", "true");
    const fonds = await page.evaluate(() => window.__fonds);
    expect(fonds.length).toBeGreaterThan(0);
    expect(new Set(fonds)).toEqual(new Set([clair200]));

    // AC-129-14, AC-137-10 : glisser réels de suite, sans sélection de texte native qui annule le geste.
    const surf2 = page.getByRole("application", { name: "plan.jdiag" });
    const boite = (t) => surf2.locator('[aria-roledescription="boîte"]').filter({ hasText: t });
    await page.getByRole("button", { name: "Tout afficher" }).click();
    const sansSelection = async () => expect(await page.evaluate(() => window.getSelection().isCollapsed)).toBe(true);
    const bDebut = boite("Début");
    const xDe = async (b) => (await b.boundingBox()).x;
    await bDebut.click({ position: { x: 20, y: 20 } });
    const hp = await centre(surf2.locator('[data-poignee="taille"]'));
    const l0 = (await bDebut.boundingBox()).width;
    await glisser(page, hp, { x: hp.x + 60, y: hp.y });
    expect((await bDebut.boundingBox()).width).toBeGreaterThan(l0 + 30);
    await sansSelection();
    const x0 = await xDe(bDebut);
    const c0 = await centre(bDebut);
    // Hors du connecteur du centre (REQ-130) : à 20 px du centre, un glisser déplace la boîte.
    await glisser(page, { x: c0.x + 20, y: c0.y }, { x: c0.x + 120, y: c0.y });
    expect(Math.abs((await xDe(bDebut)) - x0 - 100)).toBeLessThanOrEqual(3);
    await sansSelection();
    // Rectangle de sélection autour de « Début » et « Fin du flux », puis deux glisser de suite.
    await page.getByRole("button", { name: "Sélection", exact: true }).click();
    const bFin = boite("Fin du flux");
    const q1 = await bDebut.boundingBox();
    const q2 = await bFin.boundingBox();
    const gx = Math.min(q1.x, q2.x) - 12;
    const gy = Math.min(q1.y, q2.y) - 12;
    await glisser(page, { x: gx, y: gy }, { x: Math.max(q1.x + q1.width, q2.x + q2.width) + 12, y: Math.max(q1.y + q1.height, q2.y + q2.height) + 12 });
    await sansSelection();
    const xa = await xDe(bDebut);
    const xb = await xDe(bFin);
    for (let i = 0; i < 2; i++) {
      const c = await centre(bDebut);
      await glisser(page, { x: c.x + 20, y: c.y }, { x: c.x + 120, y: c.y });
      await sansSelection();
    }
    expect(Math.abs((await xDe(bDebut)) - xa - 200)).toBeLessThanOrEqual(4);
    expect(Math.abs((await xDe(bFin)) - xb - 200)).toBeLessThanOrEqual(4);
    // Ctrl+A en saisie : le texte de la boîte reste sélectionnable.
    const cdb = await centre(bDebut);
    await page.mouse.dblclick(cdb.x, cdb.y);
    await expect(page.getByRole("textbox", { name: "Texte de la boîte" })).toBeFocused();
    await page.keyboard.press("Control+a");
    expect(await page.evaluate(() => window.getSelection().toString())).toContain("Début");
    await page.keyboard.press("Escape");
    // AC-130-13 : le connecteur du centre, à la souris réelle. Clic → boîte choisie ; double-clic → saisie ;
    // glisser du centre de « Fin du flux » au centre de « Début » → un lien de centre à centre.
    await page.getByRole("button", { name: "Tout afficher" }).click();
    const cc = await centre(bDebut);
    await page.mouse.click(cc.x, cc.y);
    await expect(surf2).toHaveAttribute("aria-activedescendant", (await bDebut.getAttribute("id")) ?? "");
    await page.mouse.dblclick(cc.x, cc.y);
    await expect(page.getByRole("textbox", { name: "Texte de la boîte" })).toBeFocused();
    await page.keyboard.press("Escape");
    await glisser(page, await centre(bFin), await centre(bDebut));
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(fichier, "utf8")).toContain('"fromSide": "center", "toSide": "center"');
    expect(JSON.parse(fs.readFileSync(fichier, "utf8")).links.at(-1)).toMatchObject({ fromSide: "center", toSide: "center" });

    // AC-145-1, AC-145-3 : Ctrl+Z et Ctrl+Y au clavier réel ; Ctrl+Z dans la saisie agit sur le texte.
    const point = page.getByRole("tab", { name: /^plan\.jdiag.*, non sauvegardé/ });
    await expect(point).toHaveCount(0);
    await page.getByRole("button", { name: "Tout afficher" }).click();
    const x1 = await xDe(bDebut);
    const k = await centre(bDebut);
    await glisser(page, { x: k.x + 20, y: k.y + 25 }, { x: k.x + 120, y: k.y + 25 });
    const x2 = await xDe(bDebut);
    expect(x2 - x1).toBeGreaterThan(60);
    await expect(point).toHaveCount(1);
    await page.keyboard.press("Control+z");
    expect(Math.abs((await xDe(bDebut)) - x1)).toBeLessThanOrEqual(1);
    await expect(point).toHaveCount(0);
    await page.keyboard.press("Control+y");
    expect(Math.abs((await xDe(bDebut)) - x2)).toBeLessThanOrEqual(1);
    await expect(point).toHaveCount(1);
    const k2 = await centre(bDebut);
    await page.mouse.dblclick(k2.x + 20, k2.y + 25);
    const saisie = page.getByRole("textbox", { name: "Texte de la boîte" });
    await expect(saisie).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" par mail");
    await expect(saisie).toContainText("par mail");
    for (let i = 0; i < 40 && /par mail/.test((await saisie.textContent()) ?? ""); i++) await page.keyboard.press("Control+z");
    await expect(saisie).not.toContainText("par mail");
    await expect(saisie).toBeFocused();
    expect(Math.abs((await xDe(bDebut)) - x2)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(bDebut.getByText("Début", { exact: true })).toBeVisible();
    await page.keyboard.press("Control+z");
    expect(Math.abs((await xDe(bDebut)) - x1)).toBeLessThanOrEqual(1);

    // P-106, AC-133-13 : boîte à outils de 304 × 200 px ; O puis Bas depuis « Normal » → « Texte vert » ; Bas depuis « Texte vert » et depuis « Texte rouge » → « En bas ».
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Tout afficher" }).click();
    await surf2.focus();
    const outils = await page.locator(".ya-tableau-outils:visible").boundingBox();
    proche(outils.width, 304);
    proche(outils.height, 200);
    await page.keyboard.press("o");
    await expect(page.locator(".ya-tableau-outils:visible button:focus")).toHaveCount(1);
    await page.getByRole("button", { name: "Normal", exact: true }).first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "Texte vert", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "En bas", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Texte rouge", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "En bas", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(surf2).toBeFocused();

    // AC-147-1, AC-147-9, AC-139-6 : double-clic réel sur le trait d'un lien, texte, centre et marges.
    const lien1 = surf2.locator('[aria-roledescription="lien"]').first();
    const milieu = () => lien1.locator("path.prise").evaluate((p) => {
      const m = p.getScreenCTM();
      const q = p.getPointAtLength(p.getTotalLength() / 2);
      return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
    });
    const m0 = await milieu();
    await page.mouse.dblclick(m0.x, m0.y);
    const saisieLien = page.getByRole("textbox", { name: "Texte du lien" });
    await expect(saisieLien).toBeFocused();
    await expect(surf2.locator('[aria-roledescription="boîte"]')).toHaveCount(4);
    await page.keyboard.type("si erreur");
    await page.keyboard.press("Escape");
    const etiquette = lien1.locator(".ya-tableau-lien-texte");
    await expect(etiquette).toHaveText("si erreur");
    const ce = await centre(etiquette);
    proche(ce.x, m0.x);
    proche(ce.y, m0.y);
    const marges = await etiquette.evaluate((e) => {
      const c = getComputedStyle(e);
      return [c.paddingTop, c.paddingBottom, c.paddingLeft, c.paddingRight];
    });
    expect(marges).toEqual(["2px", "2px", "4px", "4px"]);
    await expect(page.getByRole("tab", { name: /^plan\.jdiag.*, non sauvegardé/ })).toHaveCount(1);
    // « Très grand » en saisie : le centre ne bouge pas, le focus reste.
    await page.keyboard.press("Enter");
    await expect(saisieLien).toBeFocused();
    await page.getByRole("button", { name: "Très grand", exact: true }).click();
    await expect(saisieLien).toBeFocused();
    const cs = await centre(saisieLien);
    proche(cs.x, m0.x);
    proche(cs.y, m0.y);
    await page.keyboard.press("Escape");
    // AC-147-10 : tout effacer au clavier réel → plus d'étiquette ; Ctrl+Z la rend.
    const ee = await centre(etiquette);
    await page.mouse.dblclick(ee.x, ee.y);
    await expect(saisieLien).toBeFocused();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");
    await expect(lien1.locator("foreignObject")).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(etiquette).toHaveText("si erreur");

    // AC-146-9, AC-146-4, AC-146-5, AC-145-3 : styles du texte d'une boîte, au clavier et à la souris réels.
    await page.getByRole("button", { name: "Tout afficher" }).click();
    const cb = await centre(bFin);
    await page.mouse.dblclick(cb.x, cb.y);
    const zb = page.getByRole("textbox", { name: "Texte de la boîte" });
    await expect(zb).toBeFocused();
    // Double-clic réel sur le mot « Fin » (hors du connecteur du centre) : le mot est choisi.
    const mot = await page.evaluate(() => {
      const w = document.createTreeWalker(document.activeElement, NodeFilter.SHOW_TEXT);
      const n = w.nextNode();
      const r = document.createRange();
      r.setStart(n, 0);
      r.setEnd(n, 3);
      const q = r.getBoundingClientRect();
      return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
    });
    await page.mouse.dblclick(mot.x, mot.y);
    expect((await page.evaluate(() => getSelection().toString())).trim()).toBe("Fin");
    await page.getByRole("button", { name: "Gras", exact: true }).click();
    await expect(zb).toBeFocused();
    expect((await page.evaluate(() => getSelection().toString())).trim()).toBe("Fin");
    await expect(page.getByRole("button", { name: "Gras", exact: true })).toHaveAttribute("aria-pressed", "true");
    const poids = () => page.evaluate(() => {
      const n = getSelection().getRangeAt(0).startContainer;
      return getComputedStyle(n.nodeType === 3 ? n.parentElement : n).fontWeight;
    });
    // Texte tapé juste après le mot en gras : en gras.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("X");
    await expect(zb).toContainText("FinX");
    expect(await poids()).toBe("700");
    // Ctrl+B réel : bascule le gras, sans balise `b` ni `strong`.
    const choisirDebut = async () => {
      await page.keyboard.press("Control+Home");
      for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
    };
    await choisirDebut();
    await page.keyboard.press("Control+b");
    await expect(page.getByRole("button", { name: "Gras", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(zb.locator("b, strong")).toHaveCount(0);
    // Collé : texte brut, sans les styles de la page copiée.
    await page.keyboard.press("Control+End");
    await page.evaluate(() => navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob(["<b>gras</b>"], { type: "text/html" }),
      "text/plain": new Blob(["gras"], { type: "text/plain" }),
    })]));
    await page.keyboard.press("Control+v");
    await expect(zb).toContainText("fluxgras");
    await expect(zb.locator("b, strong")).toHaveCount(0);
    expect(await poids()).toBe("400");
    await choisirDebut();
    await page.keyboard.press("Control+b");
    await expect(page.getByRole("button", { name: "Gras", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(zb.locator("b, strong")).toHaveCount(0);
    // Ctrl+Z dans la saisie : celui du navigateur, sur le texte tapé.
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" zzz");
    await expect(zb).toContainText("zzz");
    for (let i = 0; i < 40 && /zzz/.test((await zb.textContent()) ?? ""); i++) await page.keyboard.press("Control+z");
    await expect(zb).not.toContainText("zzz");
    await expect(zb).toBeFocused();
    await page.keyboard.press("Escape");

    // P-109 (étapes 1 à 3), P-110 (étape 4), AC-149-1, AC-149-2, AC-149-6, AC-149-9 : le symbole « Base de données ».
    const symboles = page.getByRole("button", { name: "Symboles", exact: true });
    await symboles.click();
    const dialogueSymboles = page.getByRole("dialog", { name: "Symboles" });
    await expect(dialogueSymboles).toBeVisible();
    await expect(dialogueSymboles.getByRole("option", { name: "Base de données" })).toBeFocused();
    await dialogueSymboles.getByRole("option", { name: "Base de données" }).click();
    await expect(dialogueSymboles).toBeHidden();
    await expect(symboles).toBeFocused();
    const zoneSurface = await surf2.boundingBox();
    await surf2.click({ position: { x: zoneSurface.width - 80, y: 80 } });
    const boiteSymbole = () => surf2.locator('[aria-roledescription="boîte"][aria-label^="Base de données"]').last();
    const saisieSymbole = page.getByRole("textbox", { name: "Texte de la boîte" });
    await expect(saisieSymbole).toBeFocused();
    await expect(boiteSymbole()).toHaveAccessibleName("Base de données");
    const bs = await boiteSymbole().boundingBox();
    const ts = await saisieSymbole.boundingBox();
    proche(bs.width, bs.height);
    expect(ts.y).toBeGreaterThanOrEqual(bs.y + 0.6 * bs.height - 1);
    expect(ts.y + ts.height).toBeLessThanOrEqual(bs.y + bs.height + 1);
    await page.keyboard.type("Clients");
    await expect(boiteSymbole()).toHaveAccessibleName("Base de données : Clients");
    await page.keyboard.type("\nUn texte très long pour un symbole\nsur plusieurs lignes\nencore une ligne\net une autre\net la dernière");
    await page.keyboard.press("Escape");
    const bs2 = await boiteSymbole().boundingBox();
    proche(bs2.width, bs.width);
    proche(bs2.height, bs.height);
    // AC-149-2 : le fichier enregistré porte 100 × 100 px, la forme et le texte.
    await page.keyboard.press("Control+s");
    await expect.poll(() => JSON.parse(fs.readFileSync(fichier, "utf8")).boxes.some((x) => x.shape === "database")).toBe(true);
    expect(JSON.parse(fs.readFileSync(fichier, "utf8")).boxes.find((x) => x.shape === "database")).toMatchObject({ width: 100, height: 100, shape: "database" });
    expect(JSON.parse(fs.readFileSync(fichier, "utf8")).boxes.find((x) => x.shape === "database").text).toMatch(/^Clients/);

    // P-111 (étapes 1 et 2), AC-150-1 : « À gauche » puis « En haut » sur une boîte, mesure réelle (8 px du bord gauche, 6 px du haut).
    await page.getByRole("button", { name: "Choisir", exact: true }).click();
    await bDebut.click({ position: { x: 12, y: 12 } });
    const btn = (nom) => page.getByRole("button", { name: nom, exact: true });
    await expect(btn("Au centre")).toHaveAttribute("aria-pressed", "true");
    await expect(btn("Au milieu")).toHaveAttribute("aria-pressed", "true");
    await btn("À gauche").click();
    await btn("En haut").click();
    await expect(btn("À gauche")).toHaveAttribute("aria-pressed", "true");
    await expect(btn("En haut")).toHaveAttribute("aria-pressed", "true");
    const cadreD = await bDebut.boundingBox();
    const premier = await bDebut.locator(".ya-tableau-texte").evaluate((e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      const b = r.getBoundingClientRect();
      return { x: b.left, y: b.top };
    });
    expect(Math.abs(premier.x - cadreD.x - 8)).toBeLessThanOrEqual(2);
    expect(premier.y - cadreD.y).toBeGreaterThanOrEqual(5);
    expect(premier.y - cadreD.y).toBeLessThanOrEqual(8);

    // P-112 (étape 4), AC-150-4 : le symbole « Au milieu », texte centré dans la bande des 40 px du bas, dessin immobile.
    await page.keyboard.press("Escape");
    await boiteSymbole().click({ position: { x: 12, y: 12 } });
    await expect(btn("En haut")).toHaveAttribute("aria-pressed", "true");
    // Un texte court, pour que le contenu tienne dans la bande.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Clients");
    await page.keyboard.press("Escape");
    const dessinAvant = await boiteSymbole().locator("svg, path").first().boundingBox();
    await btn("Au milieu").click();
    await expect(btn("Au milieu")).toHaveAttribute("aria-pressed", "true");
    const cadreS = await boiteSymbole().boundingBox();
    const centreTexte = await boiteSymbole().locator(".ya-tableau-texte").evaluate((e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    expect(Math.abs(centreTexte - (cadreS.y + 0.8 * cadreS.height))).toBeLessThanOrEqual(2);
    const dessinApres = await boiteSymbole().locator("svg, path").first().boundingBox();
    expect(dessinApres).toEqual(dessinAvant);
    await page.keyboard.press("Control+s");
    await expect.poll(() => JSON.parse(fs.readFileSync(fichier, "utf8")).boxes.find((x) => x.shape === "database")?.valign).toBe("middle");
    expect(JSON.parse(fs.readFileSync(fichier, "utf8")).boxes.find((x) => /^Début/.test(x.text))).toMatchObject({ align: "left", valign: "top" });
  } finally {
    await yaide.arreter();
  }
});

// P-114 puis P-119 : coller un diagramme mermaid (séquence : dessin et modèle ; organigramme copié d'un fichier markdown : dessin seul).
// L'ordre garde `mermaid.js` non chargé au début : `guide.md` dessine ses diagrammes. L'étape 5 de P-114 est prouvée par AC-151-6.
test("REQ154_parcours_P114_P119_AC154_14_AC154_19_AC154_20_AC154_21_AC154_22_AC154_18_AC154_23_AC154_1_AC154_10_AC154_11_REQ137_AC137_11", async ({ page }) => {
  await page.clock.install();
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "docs"), { recursive: true });
  const plan = path.join(dossier, "docs/plan.jdiag");
  const avant =
    '{\n  "version": 1,\n  "boxes": [\n    {"id": "b1", "x": 40, "y": 80, "width": 160, "height": 80, "text": "Début"},\n    {"id": "b2", "x": 300, "y": 80, "width": 160, "height": 80, "text": "Fin"}\n  ],\n  "links": [\n    {"id": "l1", "from": "b1", "to": "b2"}\n  ],\n  "arrows": [\n    {"id": "a1", "x1": 100, "y1": 300, "x2": 300, "y2": 300}\n  ]\n}\n';
  fs.writeFileSync(plan, avant);
  const modele = "Flux : Début → Fin.\nUne seule étape.";
  const modeleSource = `{\n  "version": 1,\n  "model": ${JSON.stringify(modele)},\n  "boxes": [\n    {"id": "b1", "x": 40, "y": 80, "width": 160, "height": 80, "text": "Début"},\n    {"id": "b2", "x": 300, "y": 80, "width": 160, "height": 80, "text": "Fin"}\n  ],\n  "links": [\n    {"id": "l1", "from": "b1", "to": "b2"}\n  ]\n}\n`;
  const plan2 = path.join(dossier, "docs/flux.jdiag");
  fs.writeFileSync(plan2, modeleSource);
  const organigramme = "graph TD\n  A[Début] --> B{Choix}\n  B -->|oui| C(Fin)\n  B -.-> D((Autre))";
  fs.writeFileSync(path.join(dossier, "docs/guide.md"), `# Guide\n\n\`\`\`mermaid\n${organigramme}\n\`\`\`\n\nFin.\n`);
  const yaide = await lancerYaide({ dossier });
  const relais = await lancerRelais(yaide.port);
  // mermaid.js est retenu tant que le test ne libère pas la route : le pointeur d'attente se voit.
  let liberer;
  const portillon = new Promise((r) => (liberer = r));
  await page.route("**/mermaid.js", async (route) => {
    await portillon;
    await route.fallback();
  });
  try {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await ouvrirYaide(page, relais.origine, "mdp", { shell: false });
    await ligne(page, "docs").click();
    await ligne(page, "plan.jdiag").click();
    const surface = page.getByRole("application", { name: "plan.jdiag" });
    await expect(surface).toBeFocused();
    const alerte = surface.locator("xpath=..").locator('[role="alert"]');
    const statut = surface.locator("xpath=..").getByRole("status").filter({ hasText: "Diagramme mermaid collé" });
    // Zone de 900 px de large : la fenêtre est réglée d'après la zone mesurée.
    const largeurZone = (await surface.locator("xpath=..").boundingBox()).width;
    await page.setViewportSize({ width: Math.round(1280 + 900 - largeurZone), height: 800 });
    await expect.poll(async () => Math.round((await surface.locator("xpath=..").boundingBox()).width)).toBe(900);
    const boites = surface.locator('[aria-roledescription="boîte"]');
    const boite = (t) => boites.filter({ hasText: t });
    const point = page.getByRole("tab", { name: /^plan\.jdiag.*, non sauvegardé/ });
    const zoomMax = async () => {
      const z = page.getByRole("status").filter({ hasText: "%" });
      expect(parseInt((await z.textContent()).replace(/\D/g, ""), 10)).toBeLessThanOrEqual(100);
    };
    const copierTexte = (t) => page.evaluate((x) => navigator.clipboard.writeText(x), t);
    const sequence = "sequenceDiagram\n  Alice->>Bob: Bonjour\n  Bob-->>Alice: Salut";
    // P-114 étape 1 : séquence avec `end` de trop ; pendant le chargement de mermaid.js, le pointeur d'attente.
    const ancienne = await surface.locator('[aria-roledescription="flèche"]').evaluateAll((l) => l.map((e) => JSON.stringify(e.getBoundingClientRect())));
    expect(ancienne).toHaveLength(1);
    await copierTexte("sequenceDiagram\n  Alice->>Bob: Bonjour\n  end");
    await page.keyboard.press("Control+v");
    await expect(surface).toHaveClass(/ya-attente/);
    const curseur = (el) => el.evaluate((e) => getComputedStyle(e).cursor);
    expect(await curseur(surface)).toBe("progress");
    expect(await curseur(boite("Début"))).toBe("progress");
    expect(await curseur(page.getByRole("button", { name: "Choisir" }))).not.toBe("progress");
    await expect(alerte).toBeEmpty();
    await expect(statut).toHaveCount(0);
    await boite("Début").click({ position: { x: 8, y: 8 } });
    expect(await surface.getAttribute("aria-activedescendant")).not.toBeNull();
    liberer();
    await expect(alerte).toHaveText("Diagramme mermaid non collé : mermaid ne sait pas le lire.");
    await expect(surface).not.toHaveClass(/ya-attente/);
    const zone = await surface.locator("xpath=..").boundingBox();
    const m = await alerte.boundingBox();
    proche(m.y, zone.y + 12);
    proche(m.x + m.width / 2, zone.x + zone.width / 2);
    expect(await alerte.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
    await expect(point).toHaveCount(0);
    await expect(boites).toHaveCount(2);
    await expect(surface).toBeFocused();
    // Étape 2 : un clic sur une partie vide efface le message ; la séquence corrigée remplace le dessin.
    const rs = await surface.boundingBox();
    await page.mouse.click(rs.x + rs.width - 60, rs.y + rs.height - 200);
    await expect(alerte).toBeEmpty();
    await expect(alerte).toBeHidden();
    await expect(surface).toBeFocused();
    await copierTexte(sequence);
    await page.keyboard.press("Control+v");
    await expect(boite("Alice").first()).toBeVisible();
    await expect(boite("Bob").first()).toBeVisible();
    await expect(boite("Début")).toHaveCount(0);
    await expect(boite("Fin")).toHaveCount(0);
    await expect(point).toBeVisible();
    const n = await boites.count();
    const f = await surface.locator('[aria-roledescription="flèche"]').count();
    expect(f).toBeGreaterThanOrEqual(2);
    // L'ancienne flèche libre a disparu.
    const nouvelles = await surface.locator('[aria-roledescription="flèche"]').evaluateAll((l) => l.map((e) => JSON.stringify(e.getBoundingClientRect())));
    expect(nouvelles).not.toContain(ancienne[0]);
    await expect(surface.locator('[aria-roledescription="lien"]')).toHaveCount(0);
    await expect(statut).toHaveText(`Diagramme mermaid collé : ${n} boîtes, ${f} flèches libres.`);
    await expect(alerte).toBeEmpty();
    expect(await surface.getAttribute("aria-activedescendant")).toBeNull();
    await expect(surface).toBeFocused();
    await zoomMax();
    for (const t of ["Bonjour", "Salut"]) {
      const texte = boite(t).locator(".ya-tableau-texte");
      expect(await texte.evaluate((e) => ({ h: e.scrollHeight <= e.clientHeight, l: e.scrollWidth <= e.clientWidth }))).toEqual({ h: true, l: true });
      expect(await texte.evaluate((e) => e.getClientRects()[0].height)).toBeLessThan(60);
    }
    // Étape 3 : « Bob » du haut glissé de 40 px, seul.
    const bob = boite("Bob").first();
    const alice = boite("Alice").first();
    const b0 = await bob.boundingBox();
    const al0 = await alice.boundingBox();
    const fleches0 = await surface.locator('[aria-roledescription="flèche"]').evaluateAll((l) => l.map((e) => JSON.stringify(e.getBoundingClientRect())));
    await glisser(page, { x: b0.x + 8, y: b0.y + 8 }, { x: b0.x + 48, y: b0.y + 8 });
    const b1 = await bob.boundingBox();
    proche(b1.x, b0.x + 40);
    proche(b1.y, b0.y);
    expect(await alice.boundingBox()).toEqual(al0);
    expect(await surface.locator('[aria-roledescription="flèche"]').evaluateAll((l) => l.map((e) => JSON.stringify(e.getBoundingClientRect())))).toEqual(fleches0);
    await page.keyboard.press("Control+z");
    const b2 = await bob.boundingBox();
    proche(b2.x, b0.x);
    proche(b2.y, b0.y);
    // Étape 4 : Ctrl+Z, Ctrl+Y, Ctrl+S.
    await page.keyboard.press("Control+z");
    await expect(boites).toHaveCount(2);
    await expect(boite("Début")).toBeVisible();
    await expect(surface.locator('[aria-roledescription="lien"]')).toHaveCount(1);
    await expect(surface.locator('[aria-roledescription="flèche"]')).toHaveCount(1);
    await expect(point).toHaveCount(0);
    expect(fs.readFileSync(plan, "utf8")).toBe(avant);
    await page.keyboard.press("Control+y");
    await expect(boite("Alice").first()).toBeVisible();
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(plan, "utf8")).toContain('"model"');
    expect(JSON.parse(fs.readFileSync(plan, "utf8")).model).toBe(sequence);
    expect(fs.readFileSync(plan, "utf8")).toMatch(/^\{\n {2}"version": 1,\n {2}"model": /);
    await expect(point).toHaveCount(0);

    // P-119 : l'organigramme copié dans guide.md, collé en dessin seul pendant une coupure.
    await ligne(page, "guide.md").click();
    const editeur = page.getByRole("textbox", { name: "Éditeur guide.md" });
    await expect(editeur).toBeFocused();
    const dessin = page.locator(".cm-content:visible").getByRole("img", { name: "Diagramme" });
    await expect(dessin).toHaveCount(1);
    await dessin.click();
    // Le clic met le curseur sur la première ligne sous l'ouverture du bloc : on remonte à la ligne de l'ouverture.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Home");
    for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Control+c");
    await ligne(page, "flux.jdiag").click();
    const surface2 = page.getByRole("application", { name: "flux.jdiag" });
    await expect(surface2).toBeFocused();
    await relais.couper();
    await avancer(page, () => expect(page.getByRole("alert").filter({ hasText: "Connexion perdue. Modifications gardées." })).toBeVisible({ timeout: 300 }));
    await surface2.focus();
    const requetes = [];
    page.on("request", (r) => requetes.push(r.url()));
    await page.keyboard.press("Control+Shift+v");
    const boites2 = surface2.locator('[aria-roledescription="boîte"]');
    await expect(boites2).toHaveCount(4);
    for (const t of ["Début", "Choix", "Fin", "Autre"]) await expect(boites2.filter({ hasText: t })).toBeVisible();
    await expect(surface2.locator('[aria-roledescription="lien"]')).toHaveCount(3);
    await expect(surface2.getByText("oui", { exact: true })).toBeVisible();
    await expect(surface2.locator('[aria-roledescription="lien"] [stroke-dasharray]')).toHaveCount(1);
    await expect(page.getByRole("tab", { name: /^flux\.jdiag.*, non sauvegardé/ })).toBeVisible();
    const alerte2 = surface2.locator("xpath=..").locator('[role="alert"]');
    await expect(alerte2).toBeEmpty();
    await expect(surface2.locator("xpath=..").getByRole("status").filter({ hasText: "Diagramme mermaid collé" })).toHaveText("Diagramme mermaid collé : 4 boîtes, 3 liens.");
    await expect(surface2).toBeFocused();
    expect(await surface2.getAttribute("aria-activedescendant")).toBeNull();
    await zoomMax();
    expect(requetes).toEqual([]);
    const posDebut = await boites2.filter({ hasText: "Début" }).boundingBox();
    const posChoix = await boites2.filter({ hasText: "Choix" }).boundingBox();
    expect(posChoix.y).toBeGreaterThan(posDebut.y + posDebut.height);
    // Refus d'un organigramme illisible : rien ne change.
    await copierTexte("graph TD\nA --> B\nA@{ shape: rect }");
    await page.keyboard.press("Control+v");
    await expect(alerte2).toHaveText("Diagramme mermaid non collé : la ligne 3 n'est pas comprise.");
    await expect(boites2).toHaveCount(4);
    await relais.retablir();
    await avancer(page, () => expect(page.getByRole("alert").filter({ hasText: "Connexion perdue." })).toHaveCount(0, { timeout: 300 }));
    // Ctrl+S : le modèle écrit à la main reste à sa place.
    await surface2.focus();
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(plan2, "utf8")).toContain('"b4"');
    const doc2 = JSON.parse(fs.readFileSync(plan2, "utf8"));
    expect(doc2.model).toBe(modele);
    expect(doc2.boxes).toHaveLength(4);
    expect(doc2.links).toHaveLength(3);
    expect(fs.readFileSync(plan2, "utf8")).toContain(`  "version": 1,\n  "model": ${JSON.stringify(modele)},\n  "boxes"`);
    // Ctrl+Z : le dessin d'avant revient, le disque a le dessin collé, l'onglet garde son point.
    await page.keyboard.press("Control+z");
    await expect(boites2).toHaveCount(2);
    await expect(page.getByRole("tab", { name: /^flux\.jdiag.*, non sauvegardé/ })).toBeVisible();
    await page.keyboard.press("Control+y");
    await expect(boites2).toHaveCount(4);
    // AC-137-11 : les boîtes choisies (Ctrl+A) copiées par Ctrl+C, puis Ctrl+V sur la surface : elles sont collées (quatre de plus), le dessin n'est pas recréé.
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect(boites2).toHaveCount(8);
    await expect(boites2.filter({ hasText: "Début" })).toHaveCount(2);
    await expect(surface2).toBeFocused();
  } finally {
    relais.fermer();
    await yaide.arreter();
  }
});

// P-117 étapes 1 à 4 : « Point », ses connecteurs, son déplacement et un lien, à la souris réelle.
test("REQ156_AC8_parcours_P117", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "docs"), { recursive: true });
  const plan = path.join(dossier, "docs/plan.jdiag");
  fs.writeFileSync(plan, '{\n  "version": 1,\n  "boxes": [\n    {"id": "b1", "x": 300, "y": 80, "width": 160, "height": 80, "text": "Fin"}\n  ],\n  "links": []\n}\n');
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await ligne(page, "docs").click();
    await ligne(page, "plan.jdiag").click();
    const surface = page.getByRole("application", { name: "plan.jdiag" });
    await expect(surface).toBeFocused();
    // Étapes 1 et 2 : le dialogue au clavier (Fin, Gauche, Entrée) choisit « Point ».
    const symboles = page.getByRole("button", { name: "Symboles", exact: true });
    await symboles.focus();
    await page.keyboard.press("Enter");
    const dialogue = page.getByRole("dialog", { name: "Symboles" });
    await expect(dialogue).toBeVisible();
    await page.keyboard.press("End");
    await expect(dialogue.getByRole("option", { name: "Barre" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(dialogue.getByRole("option", { name: "Point" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialogue).toBeHidden();
    const zone = await surface.boundingBox();
    await page.mouse.click(zone.x + 100, zone.y + 400);
    const point = surface.locator('[aria-roledescription="boîte"][aria-label="Point"]');
    await expect(point).toHaveCount(1);
    const p = await point.locator(".forme").boundingBox();
    proche(p.width, 16);
    proche(p.height, 16);
    // Étape 3 : le survol montre quatre connecteurs, aucun au centre ; `move` sur le point, `crosshair` sur un connecteur.
    const c0 = { x: p.x + 8, y: p.y + 8 };
    await page.mouse.move(c0.x, c0.y);
    const prises = surface.locator("[data-connecteur]");
    await expect(prises).toHaveCount(4);
    await expect(surface.locator('[data-connecteur="center"]')).toHaveCount(0);
    const curseur = (loc) => loc.evaluate((e) => getComputedStyle(e).cursor);
    expect(await curseur(point.locator(".forme"))).toBe("move");
    const droit = surface.locator('[data-connecteur="right"]');
    expect(await curseur(droit)).toBe("crosshair");
    const rond = await surface.locator(".connecteur").nth(1).boundingBox();
    expect(rond.x + rond.width / 2).toBeGreaterThan(p.x + p.width + 4);
    // Glisser depuis le centre : il bouge de 30 px, aucun lien.
    await glisser(page, c0, { x: c0.x + 30, y: c0.y });
    const p2 = await point.locator(".forme").boundingBox();
    proche(p2.x - p.x, 30);
    await expect(surface.locator('[aria-roledescription="lien"]')).toHaveCount(0);
    // Étape 4 : du connecteur droit vers « Fin » : un lien ; pendant le glisser, la cible sous « Fin ».
    const fin = surface.locator('[aria-roledescription="boîte"]').filter({ hasText: "Fin" });
    const bf = await fin.boundingBox();
    const cd = { x: p2.x + 8, y: p2.y + 8 };
    await page.mouse.move(cd.x, cd.y);
    const rd = await droit.boundingBox();
    await page.mouse.move(rd.x + rd.width / 2, rd.y + rd.height / 2);
    await page.mouse.down();
    await page.mouse.move(bf.x + 40, bf.y + 40, { steps: 8 });
    await expect(fin.locator(".surcouche")).toBeVisible();
    await page.mouse.up();
    await expect(surface.locator('[aria-roledescription="lien"]')).toHaveCount(1);
    // Pendant le glisser d'un lien de « Fin » vers le point : la cible sous le point.
    const bf2 = await fin.boundingBox();
    await page.mouse.move(bf2.x + bf2.width / 2, bf2.y + bf2.height / 2);
    const rf = await surface.locator('[data-connecteur="top"]').first().boundingBox();
    await page.mouse.move(rf.x + rf.width / 2, rf.y + rf.height / 2);
    await page.mouse.down();
    const pc = await point.locator(".forme").boundingBox();
    await page.mouse.move(pc.x + pc.width / 2, pc.y + pc.height / 2, { steps: 8 });
    await expect(point.locator(".surcouche")).toBeVisible();
    await page.mouse.up();
    // À 200 %, le point fait 32 px à l'écran.
    const avant = await point.locator(".forme").boundingBox();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom avant" }).click();
    const apres = await point.locator(".forme").boundingBox();
    proche(apres.width, 2 * avant.width);
    proche(apres.width, 32);
    await page.keyboard.press("Control+s");
    await expect.poll(() => JSON.parse(fs.readFileSync(plan, "utf8")).links.length).toBe(2);
    expect(JSON.parse(fs.readFileSync(plan, "utf8")).links.some((l) => l.fromSide === "right")).toBe(true);
    expect(JSON.parse(fs.readFileSync(plan, "utf8")).boxes.find((b) => b.shape === "dot")).toMatchObject({ width: 16, height: 16, text: "" });
  } finally {
    await yaide.arreter();
  }
});

// P-115 et P-116 : copier au format Klaxoon par le menu de la surface. P-115 étape 4 (collage dans Klaxoon) : essai de l'humain après livraison.
// P-116 étape 3 (menu du navigateur pendant une saisie) et étape 4 (refus du presse-papiers) : prouvées en composant (AC-155-4, AC-155-10, tableau-klaxoon.test.js).
test("REQ155_parcours_P115_P116_AC155_1_AC155_2_AC155_3_AC155_5_AC155_7_AC155_8", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "docs"), { recursive: true });
  const plan = path.join(dossier, "docs/plan.jdiag");
  const avant =
    '{\n  "version": 1,\n  "boxes": [\n    {"id": "b1", "x": 40, "y": 80, "width": 160, "height": 80, "text": "Début"},\n    {"id": "b2", "x": 300, "y": 80, "width": 160, "height": 80, "text": "Fin"}\n  ],\n  "links": [\n    {"id": "l1", "from": "b1", "to": "b2"}\n  ],\n  "arrows": [\n    {"id": "a1", "x1": 100, "y1": 300, "x2": 300, "y2": 300}\n  ]\n}\n';
  fs.writeFileSync(plan, avant);
  const yaide = await lancerYaide({ dossier });
  try {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await ligne(page, "docs").click();
    await ligne(page, "plan.jdiag").click();
    const surface = page.getByRole("application", { name: "plan.jdiag" });
    await expect(surface).toBeFocused();
    // AC-155-7 : whiteboards en clair, Yaide en sombre.
    await page.getByRole("button", { name: "Thème clair du whiteboard" }).click();
    await surface.focus();
    const zone = surface.locator("xpath=..");
    const zoneBoard = surface.locator("xpath=../..");
    const statut = zone.locator('[role="status"]');
    const alerte = zone.locator('[role="alert"]');
    const menu = page.getByRole("menu", { name: "Actions sur la sélection" });
    const commande = menu.getByRole("menuitem", { name: "Copier au format Klaxoon" });
    const objet = (role, t) => (t ? surface.locator(`[aria-roledescription="${role}"]`).filter({ hasText: t }) : surface.locator(`[aria-roledescription="${role}"]`));
    const b1 = objet("boîte", "Début");
    const b2 = objet("boîte", "Fin");
    const fleche = objet("flèche");
    const sansPoint = () => expect(page.getByRole("tab", { name: /^plan\.jdiag.*, non sauvegardé/ })).toHaveCount(0);

    // AC-155-1, AC-155-7 : clic droit sur « Début ».
    const rb1 = await b1.boundingBox();
    const pt = { x: rb1.x + 30, y: rb1.y + 20 };
    await page.mouse.click(pt.x, pt.y, { button: "right" });
    await expect(menu).toBeVisible();
    await expect(surface).toHaveAttribute("aria-activedescendant", /-b1$/);
    await expect(menu.getByRole("menuitem")).toHaveCount(1);
    await expect(menu.locator('[role="separator"]')).toHaveCount(0);
    await expect(commande).toHaveText("Copier au format Klaxoon");
    await expect(commande).toBeFocused();
    expect(await commande.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(0, 95, 184)");
    expect(await menu.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(await menu.evaluate((e, z) => z.contains(e), await zoneBoard.elementHandle())).toBe(true);
    let rm = await menu.boundingBox();
    proche(rm.x, pt.x);
    proche(rm.y, pt.y);
    // Un clic droit près du coin bas droit : le menu entier reste dans la zone, son coin bas droit au pointeur.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    const rz = await zoneBoard.boundingBox();
    const coin = { x: rz.x + rz.width - 20, y: rz.y + rz.height - 10 };
    await page.mouse.click(coin.x, coin.y, { button: "right" });
    await expect(menu).toBeVisible();
    rm = await menu.boundingBox();
    proche(rm.x + rm.width, coin.x);
    proche(rm.y + rm.height, coin.y);
    expect(rm.x).toBeGreaterThanOrEqual(rz.x);
    expect(rm.y).toBeGreaterThanOrEqual(rz.y);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(surface).toBeFocused();

    // AC-155-1 : clic droit au centre exact de « Début », là où se pose son connecteur du centre.
    await page.mouse.click(rb1.x + rb1.width + 100, rb1.y + 300);
    await expect(surface).not.toHaveAttribute("aria-activedescendant", /.+/);
    await expect(surface.locator("g.choisie")).toHaveCount(0);
    await page.mouse.move(rb1.x + rb1.width / 2, rb1.y + rb1.height / 2);
    await page.mouse.click(rb1.x + rb1.width / 2, rb1.y + rb1.height / 2, { button: "right" });
    await expect(menu).toBeVisible();
    await expect(surface).toHaveAttribute("aria-activedescendant", /-b1$/);
    await expect(commande).not.toHaveAttribute("aria-disabled", /.*/);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(surface).toBeFocused();

    // AC-155-2, AC-155-8 : Ctrl+A, clic droit sur une partie vide, la commande.
    await page.keyboard.press("Control+a");
    const actif = await surface.getAttribute("aria-activedescendant");
    await page.mouse.click(rb1.x + 100, rb1.y + 140, { button: "right" });
    await expect(menu).toBeVisible();
    await commande.click();
    await expect(menu).toHaveCount(0);
    await expect(statut).toHaveText("Copié au format Klaxoon : 2 boîtes, 1 lien.");
    await expect(alerte).toBeEmpty();
    await expect(surface).toBeFocused();
    expect(await surface.getAttribute("aria-activedescendant")).toBe(actif);
    await sansPoint();
    expect(fs.readFileSync(plan, "utf8")).toBe(avant);
    // Lecture du presse-papiers du système par un vrai collage dans un champ hors de la surface.
    await page.evaluate(() => {
      const t = document.createElement("textarea");
      t.id = "lecture-presse-papiers";
      document.body.append(t);
      window.__collage = null;
      t.addEventListener("paste", (e) => {
        e.preventDefault();
        window.__collage = { texte: e.clipboardData.getData("text/plain"), html: e.clipboardData.getData("text/html") };
      });
      t.focus();
    });
    await page.keyboard.press("Control+v");
    const lu = await page.evaluate(() => {
      const r = window.__collage;
      document.getElementById("lecture-presse-papiers").remove();
      return r;
    });
    expect(lu.texte).toBe("Début\nFin");
    const h = lireHtmlKlaxoon(lu.html);
    expect(h.contenu).toBe("<p>Début</p><br><p>Fin</p>");
    expect(h.donnees).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    const liste = JSON.parse(Buffer.from(h.donnees.slice(36), "base64").toString("utf8")).map((e) => ({ ...e.data, type: e.type }));
    expect(liste.map((e) => e.type)).toEqual(["postit", "postit", "link"]);
    expect(liste[0].coords).toEqual({ left: 40, top: 80 });
    expect([liste[0].zIndex, liste[0].contentHtml]).toEqual([1, "<p>Début</p>"]);
    expect(liste[1].coords).toEqual({ left: 300, top: 80 });
    expect([liste[1].zIndex, liste[1].contentHtml]).toEqual([2, "<p>Fin</p>"]);
    expect(liste[2].objectIds).toEqual([liste[0].parent, liste[1].parent]);
    expect(liste[2].objectAnchors).toEqual(["right", "left"]);
    expect(new Set([h.donnees.slice(0, 36), ...liste.map((e) => e.parent)]).size).toBe(4);

    // AC-155-3 : Ctrl+V sur la surface colle les boîtes et le lien.
    await surface.focus();
    await page.keyboard.press("Control+v");
    await expect(objet("boîte")).toHaveCount(4);
    await expect(objet("lien")).toHaveCount(2);
    await expect(objet("flèche")).toHaveCount(2);
    await page.keyboard.press("Control+z");
    await expect(objet("boîte")).toHaveCount(2);
    await sansPoint();

    // P-116 étape 1, AC-155-5 : Maj+F10 sur la flèche libre seule, commande désactivée.
    await page.keyboard.press("Escape");
    const rf = await fleche.boundingBox();
    await page.mouse.click(rf.x + rf.width / 2, rf.y + rf.height / 2);
    await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible();
    await expect(commande).toHaveAttribute("aria-disabled", "true");
    await expect(commande).toBeFocused();
    rm = await menu.boundingBox();
    // Le rectangle d'un élément SVG : celui du DOM, trait compris (celui de Playwright l'omet).
    const rfc = await fleche.evaluate((e) => e.getBoundingClientRect().toJSON());
    proche(rm.y, rfc.y + rfc.height + 4);
    proche(rm.x, rfc.x);
    const statutAvant = await statut.textContent();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await expect(commande).toBeFocused();
    expect(await statut.textContent()).toBe(statutAvant);
    // Étape 2 : « Fin » seule, touche Menu, Entrée.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(surface).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(surface).toHaveAttribute("aria-activedescendant", /-b2$/);
    await page.keyboard.press("ContextMenu");
    await expect(menu).toBeVisible();
    await expect(commande).not.toHaveAttribute("aria-disabled", "true");
    expect(await commande.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(0, 95, 184)");
    const rb2 = await b2.boundingBox();
    rm = await menu.boundingBox();
    proche(rm.y, rb2.y + rb2.height + 4);
    proche(rm.x, rb2.x);
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(statut).toHaveText("Copié au format Klaxoon : 1 boîte, aucun lien.");
    await expect(surface).toBeFocused();
    // Rien de choisi, touche Menu : 12 px du haut et de la gauche de la zone.
    await page.keyboard.press("Escape");
    await expect(surface).not.toHaveAttribute("aria-activedescendant", /.+/);
    await page.keyboard.press("ContextMenu");
    await expect(menu).toBeVisible();
    rm = await menu.boundingBox();
    proche(rm.x, rz.x + 12);
    proche(rm.y, rz.y + 12);
    await page.keyboard.press("Escape");
    await sansPoint();
    expect(fs.readFileSync(plan, "utf8")).toBe(avant);
  } finally {
    await yaide.arreter();
  }
});

// Lit le `div` du `text/html` copié : son contenu et son attribut `data-board`.
function lireHtmlKlaxoon(html) {
  const m = /^<div data-board="([^"]*)"[^>]*>([\s\S]*)<\/div>$/.exec(html.replace(/<!--[\s\S]*?-->/g, "").trim());
  if (!m) throw new Error(`html inattendu : ${html}`);
  return { donnees: m[1], contenu: m[2] };
}

// P-125 : recherche dans un whiteboard (REQ-161). Un seul lancement de Yaide ; le reste est prouvé par les tests de composant.
test("REQ161_AC9_AC10_parcours_P125_recherche_whiteboard", async ({ page }) => {
  const dossier = depotExemple();
  const plan = path.join(dossier, "plan.jdiag");
  const couleurs = ["default", "blue", "green", "yellow", "orange", "red", "purple"];
  const boxes = couleurs.map((c, i) => ({ id: `b${i + 1}`, x: 40 + (i % 4) * 200, y: 40 + Math.floor(i / 4) * 120, width: 160, height: 80, text: "Serveur", ...(c === "default" ? {} : { color: c }) }));
  boxes[0].spans = [{ start: 0, end: 3, bold: true }];
  boxes.push({ id: "b8", x: 440, y: 160, width: 160, height: 80, text: "Serveur rouge", shape: "text", color: "red" });
  fs.writeFileSync(plan, JSON.stringify({ version: 1, boxes, links: [{ id: "l1", from: "b1", to: "b2", text: "serveur" }] }));
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await ligne(page, "plan.jdiag").click();
    const surface = page.getByRole("application", { name: "plan.jdiag" });
    await expect(surface).toBeFocused();
    const zone = page.locator(".ya-tableau-zone").locator("visible=true").first();
    await page.keyboard.press("Control+f");
    const panneau = page.getByRole("search", { name: "Rechercher dans plan.jdiag" });
    await expect(panneau.locator("input")).toBeFocused();
    await page.keyboard.type("serveur");
    const marques = zone.locator("mark.ya-occurrence");
    await expect(marques).toHaveCount(10); // sept boîtes (la première en deux marques, « Ser » gras et « veur »), le texte rouge, le lien
    // AC-161-9 : fond `--occurrence` posé sur `--bg-200` du thème du whiteboard, texte `--ink`, 4,5:1 au moins, dans les deux thèmes.
    const resoudre = (jeton, propriete) => zone.evaluate((e, [j, p]) => {
      const sonde = document.createElement("div");
      sonde.style.setProperty(p, `var(${j})`);
      e.append(sonde);
      const v = getComputedStyle(sonde)[p === "background" ? "backgroundColor" : "color"];
      sonde.remove();
      return v;
    }, [jeton, propriete]);
    const mesurer = (marque) => marque.evaluate((m) => {
      const cs = getComputedStyle(m);
      const nombres = (t) => t.match(/[\d.]+/g).map(Number);
      const base = nombres(cs.backgroundColor);
      const [vr, vg, vb, va = 1] = nombres(cs.backgroundImage.match(/rgba?\([^)]*\)/)[0]);
      const fond = [vr, vg, vb].map((v, i) => v * va + base[i] * (1 - va));
      const lum = (c) => c.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const [a, b] = [lum(nombres(cs.color)), lum(fond)];
      return { classe: m.className, base: cs.backgroundColor, image: cs.backgroundImage, couleur: cs.color, graisse: cs.fontWeight, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
    const verifierMarques = async () => {
      const fondZone = await resoudre("--bg-200", "background");
      const occurrence = await resoudre("--occurrence", "background");
      const encre = await resoudre("--ink", "color");
      for (let i = 0; i < 10; i++) {
        const m = await mesurer(marques.nth(i));
        expect(m.classe).toBe("ya-occurrence");
        expect(m.base).toBe(fondZone);
        expect(m.image).toContain(occurrence);
        expect(m.couleur).toBe(encre);
        expect(m.ratio).toBeGreaterThanOrEqual(4.5);
      }
      expect((await mesurer(marques.first())).graisse).toBe("700"); // la partie grasse garde sa graisse
    };
    await verifierMarques();
    const bouton = page.getByRole("button", { name: "Thème clair du whiteboard" });
    await bouton.click();
    await expect(bouton).toHaveAttribute("aria-pressed", "true");
    await verifierMarques();
    // AC-161-10 : whiteboard clair dans un Yaide sombre : fond blanc, à 16 px du bord droit et 4 px du haut, immobile.
    expect(await panneau.evaluate((e) => Boolean(e.closest("[data-theme=light]")))).toBe(true);
    expect(await panneau.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 255, 255)");
    const place = async () => {
      const zb = await zone.boundingBox();
      const pb = await panneau.boundingBox();
      return { droite: zb.x + zb.width - (pb.x + pb.width), haut: pb.y - zb.y, pb };
    };
    const avant = await place();
    proche(avant.droite, 16);
    proche(avant.haut, 4);
    await surface.hover();
    await page.mouse.wheel(0, 120);
    await page.getByRole("button", { name: "Zoom avant" }).click();
    expect((await place()).pb).toEqual(avant.pb);
    // AC-161-9 : zone de 320 px de large, la fenêtre ne recouvre pas la boîte à outils.
    const largeur = async () => (await zone.boundingBox()).width;
    await page.setViewportSize({ width: 1280, height: 700 });
    // Le panneau de l'éditeur ne descend pas sous 420 px : la zone elle-même est ramenée à 320 px.
    await zone.evaluate((e) => {
      e.style.flex = "none";
      e.style.width = "320px";
    });
    await expect.poll(async () => Math.abs((await largeur()) - 320)).toBeLessThanOrEqual(1);
    const outils = await zone.getByRole("toolbar").boundingBox();
    const fenetre = await panneau.boundingBox();
    const croise = fenetre.x < outils.x + outils.width && fenetre.x + fenetre.width > outils.x && fenetre.y < outils.y + outils.height && fenetre.y + fenetre.height > outils.y;
    expect(croise).toBe(false);
  } finally {
    await yaide.arreter();
  }
});
