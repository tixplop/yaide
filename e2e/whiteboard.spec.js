import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

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

test("REQ127_AC1_REQ129_AC1_REQ130_AC1_REQ133_AC8_REQ134_AC1_AC7_REQ136_AC1_REQ128_AC2_REQ131_AC2_REQ137_AC1_AC2_AC4_REQ139_AC1_AC4_REQ142_AC1_AC4_REQ143_AC1_AC2_AC5_parcours_P096_P100_P101_P102_P103_whiteboard", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dossier, "docs/a.md"), "# A\n");
  fs.writeFileSync(path.join(dossier, "docs/archi.jdiag"), '{\n  "version": 1,\n  "boxes": [],\n  "links": []\n}\n');
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
    await glisser(page, avant, { x: avant.x + 300, y: avant.y });
    const apres = await centre(fin);
    expect(Math.abs(apres.x - avant.x - 300)).toBeLessThanOrEqual(2);

    // AC-130-1 : à 10 px du bord droit de « Début », quatre connecteurs ; le connecteur droit glissé près du côté gauche de « Fin ».
    const rd = await debut.boundingBox();
    await page.mouse.move(rd.x + rd.width + 10, rd.y + rd.height / 2);
    await expect(surface.locator(".connecteurs .connecteur")).toHaveCount(4);
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

    // AC-137-4 : Ctrl+C, puis Ctrl+V dans un autre onglet.
    await page.keyboard.press("Control+c");
    await ligne(page, "archi.jdiag").click();
    const surfaceArchi = page.getByRole("application", { name: "archi.jdiag" });
    await expect(surfaceArchi).toBeVisible();
    const ra = await surfaceArchi.boundingBox();
    await page.mouse.click(ra.x + ra.width / 2, ra.y + ra.height / 2);
    await page.keyboard.press("Control+v");
    await expect(surfaceArchi.locator('[aria-roledescription="boîte"]')).toHaveCount(2);
    await expect(surfaceArchi.locator('[aria-roledescription="lien"]')).toHaveCount(1);
    await page.keyboard.press("Control+s");
    const archi = path.join(dossier, "docs/archi.jdiag");
    await expect.poll(() => JSON.parse(fs.readFileSync(archi, "utf8")).boxes.length).toBe(2);
    expect(JSON.parse(fs.readFileSync(archi, "utf8")).links).toHaveLength(1);

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
    await bDebut.click();
    const hp = await centre(surf2.locator('[data-poignee="taille"]'));
    const l0 = (await bDebut.boundingBox()).width;
    await glisser(page, hp, { x: hp.x + 60, y: hp.y });
    expect((await bDebut.boundingBox()).width).toBeGreaterThan(l0 + 30);
    await sansSelection();
    const x0 = await xDe(bDebut);
    const c0 = await centre(bDebut);
    await glisser(page, c0, { x: c0.x + 100, y: c0.y });
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
      await glisser(page, c, { x: c.x + 100, y: c.y });
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
  } finally {
    await yaide.arreter();
  }
});
