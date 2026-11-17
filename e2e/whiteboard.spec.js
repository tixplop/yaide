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

test("REQ127_AC1_REQ129_AC1_REQ130_AC1_REQ133_AC8_REQ134_AC1_AC7_REQ136_AC1_REQ128_AC2_REQ131_AC2_parcours_P096_whiteboard", async ({ page }) => {
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
  } finally {
    await yaide.arreter();
  }
});
