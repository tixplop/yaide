import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { randomFillSync } from "node:crypto";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

// Images d'exemple écrites par le test, dans le dépôt d'exemple sous `.test-data/` (zlib de Node, sans dépendance).
const morceau = (type, donnees) => {
  const t = Buffer.concat([Buffer.from(type), donnees]);
  const tete = Buffer.alloc(4);
  tete.writeUInt32BE(donnees.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(t));
  return Buffer.concat([tete, t, crc]);
};
/** PNG `l` × `h`, `couleur` 0 (gris) ou 6 (RGBA) ; `ligne(y, tampon)` remplit les octets d'une ligne (sans l'octet de filtre). */
function png(l, h, couleur, ligne) {
  const octets = couleur === 6 ? 4 : 1;
  const brut = Buffer.alloc((l * octets + 1) * h);
  for (let y = 0; y < h; y++) ligne(y, brut.subarray(y * (l * octets + 1) + 1, (y + 1) * (l * octets + 1)));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = couleur;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau("IHDR", ihdr), morceau("IDAT", zlib.deflateSync(brut, { level: 1 })), morceau("IEND", Buffer.alloc(0))]);
}
/** Disque plein de `rgb` au centre d'un carré transparent (PNG RGBA). */
const disque = (n, rgb) =>
  png(n, n, 6, (y, t) => {
    for (let x = 0; x < n; x++) {
      if ((x - n / 2) ** 2 + (y - n / 2) ** 2 < (n / 2) ** 2) t.set([...rgb, 255], x * 4);
    }
  });
const bmp = () => {
  const b = Buffer.alloc(54 + 16);
  b.write("BM");
  b.writeUInt32LE(70, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(2, 18);
  b.writeInt32LE(2, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(16, 34);
  b.fill(0x80, 54);
  return b;
};
const ico = (p) => {
  const e = Buffer.alloc(22);
  e.writeUInt16LE(1, 2);
  e.writeUInt16LE(1, 4);
  e[6] = 16;
  e[7] = 16;
  e.writeUInt16LE(1, 10);
  e.writeUInt16LE(32, 12);
  e.writeUInt32LE(p.length, 14);
  e.writeUInt32LE(22, 18);
  return Buffer.concat([e, p]);
};
const b64 = (s) => Buffer.from(s, "base64");
const JPEG = b64("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=");
const GIF = b64("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==");
const WEBP = b64("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA");
const AVIF = b64("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUEAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACJtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=");

const ecrire = (dossier, f, contenu) => {
  fs.mkdirSync(path.dirname(path.join(dossier, f)), { recursive: true });
  fs.writeFileSync(path.join(dossier, f), contenu);
};
const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const onglet = (page, nom) => page.getByRole("tab", { name: new RegExp(`^${nom.replace(/\./g, "\\.")}(, [^,]+)*$`) });
const dessin = (page, nom) => page.getByRole("region", { name: nom, exact: true }).locator("img");
const largeurNaturelle = (img) => img.evaluate((i) => i.naturalWidth);
const boite = async (el) => el.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const proche = (a, b, pres = 1) => expect(Math.abs(a - b)).toBeLessThanOrEqual(pres);
const fond = (el) => el.evaluate((e) => getComputedStyle(e).backgroundColor);
const BLANC = "rgb(255, 255, 255)";

/** Origines des requêtes de la page, hors `data:` et `blob:`. */
function espionner(page) {
  const urls = [];
  page.on("request", (r) => urls.push(r.url()));
  return () => urls.filter((u) => /^https?:/.test(u));
}

test("REQ120_AC1_AC4_AC6_AC9_AC11_AC12_parcours_P088_images_du_projet", async ({ page }) => {
  const dossier = depotExemple();
  ecrire(dossier, "img/capture.png", png(4000, 3000, 0, (y, t) => randomFillSync(t)));
  ecrire(dossier, "img/logo.png", disque(512, [20, 30, 100]));
  ecrire(dossier, "img/petite.png", disque(16, [20, 30, 100]));
  ecrire(dossier, "img/photo.jpg", JPEG);
  ecrire(dossier, "img/photo.jpeg", JPEG);
  ecrire(dossier, "img/PHOTO.JPG", JPEG);
  ecrire(dossier, "img/anim.gif", GIF);
  ecrire(dossier, "img/image.webp", WEBP);
  ecrire(dossier, "img/image.avif", AVIF);
  ecrire(dossier, "img/image.bmp", bmp());
  ecrire(dossier, "img/favicon.ico", ico(disque(16, [200, 0, 0])));
  ecrire(dossier, "img/casse.png", "Ceci n'est pas une image.\n");
  expect(fs.statSync(path.join(dossier, "img/capture.png")).size).toBeGreaterThan(5 * 1024 * 1024);
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const requetes = espionner(page);
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await ligne(page, "src").click();
    await ligne(page, "main.rs").click();
    await ligne(page, "img").click();

    // AC-120-1 : les neuf formats s'affichent, sans éditeur ni message.
    for (const f of ["logo.png", "photo.jpg", "photo.jpeg", "anim.gif", "image.webp", "image.avif", "image.bmp", "favicon.ico", "PHOTO.JPG"]) {
      await ligne(page, f).click();
      await expect(onglet(page, f)).toHaveAttribute("aria-selected", "true");
      await expect.poll(() => largeurNaturelle(dessin(page, f)), { message: f }).toBeGreaterThan(0);
      await expect(page.getByRole("textbox", { name: `Éditeur ${f}` })).toHaveCount(0);
    }
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);

    // AC-120-12 : logo 512 × 512 centré, fond blanc de l'image, fond de l'éditeur autour, dans les deux thèmes.
    await ligne(page, "logo.png").click();
    const zone = page.getByRole("region", { name: "logo.png", exact: true });
    const logo = dessin(page, "logo.png");
    await expect.poll(() => largeurNaturelle(logo)).toBe(512);
    const b = await boite(logo);
    const z = await boite(zone);
    proche(b.w, 512);
    proche(b.h, 512);
    proche(b.x + b.w / 2, z.x + z.w / 2);
    proche(b.y + b.h / 2, z.y + z.h / 2);
    expect(await fond(logo)).toBe(BLANC);
    expect(await fond(zone)).toBe("rgb(31, 31, 31)");
    await expect(logo).toHaveAttribute("draggable", "false");
    await page.getByRole("button", { name: "Thème clair" }).click();
    expect(await fond(logo)).toBe(BLANC);
    await page.getByRole("button", { name: "Thème clair" }).click();

    // AC-120-4 : 16 × 16 à sa taille ; 4000 × 3000 entière, proportions gardées, sans défilement.
    await ligne(page, "petite.png").click();
    const petite = await boite(dessin(page, "petite.png"));
    proche(petite.w, 16);
    proche(petite.h, 16);
    await ligne(page, "capture.png").click();
    const grande = dessin(page, "capture.png");
    await expect.poll(() => largeurNaturelle(grande)).toBe(4000);
    const g = await boite(grande);
    const zg = await boite(page.getByRole("region", { name: "capture.png", exact: true }));
    expect(g.w).toBeLessThan(4000);
    proche(g.w * 3, g.h * 4, 3);
    expect(g.x).toBeGreaterThanOrEqual(zg.x - 1);
    expect(g.y).toBeGreaterThanOrEqual(zg.y - 1);
    expect(g.x + g.w).toBeLessThanOrEqual(zg.x + zg.w + 1);
    expect(g.y + g.h).toBeLessThanOrEqual(zg.y + zg.h + 1);
    expect(await page.getByRole("region", { name: "capture.png", exact: true }).evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight)).toBe(true);

    // AC-120-11 : contour de 1 px de --accent-fg tant que la zone a le focus.
    const zoneCapture = page.getByRole("region", { name: "capture.png", exact: true });
    await expect(zoneCapture).toBeFocused();
    const accent = await page.evaluate(() => {
      const p = document.createElement("div");
      p.style.color = "var(--accent-fg)";
      document.body.append(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    });
    const contour = () => zoneCapture.evaluate((e) => { const s = getComputedStyle(e); return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`; });
    expect(await contour()).toBe(`solid 1px ${accent}`);
    await zoneCapture.evaluate((e) => e.blur());
    expect(await contour()).not.toContain("solid");

    // AC-120-6 : image remplacée sur le disque → la nouvelle en moins de 5 s.
    await ligne(page, "logo.png").click();
    // Le sondage du disque (toutes les 1,5 s) a vu le logo avant qu'on le remplace.
    await (await page.waitForRequest((r) => r.url().includes("/api/fichiers/versions"))).response();
    ecrire(dossier, "img/logo.png", disque(256, [200, 0, 0]));
    await expect.poll(() => largeurNaturelle(dessin(page, "logo.png")), { timeout: 5000 }).toBe(256);

    // Fichier illisible : message à la place de l'image, sans bandeau.
    await ligne(page, "casse.png").click();
    await expect(page.getByRole("status").filter({ hasText: "casse.png ne peut pas être affiché." })).toBeVisible();

    // AC-120-6 (seconde phrase : image supprimée hors de Yaide, onglet gardé, zone vide, « Fichier supprimé du disque. ») :
    // editeur.test.js, REQ120_AC6_AC13_AC14_version_changee_nouvelle_source_supprime_puis_recree, et image.test.js, REQ120_AC6_absente_zone_vide_et_retour.

    // AC-120-9 : toutes les requêtes vont au serveur de Yaide.
    const externes = requetes().filter((u) => new URL(u).origin !== yaide.origine);
    expect(externes).toEqual([]);
  } finally {
    await yaide.arreter();
  }
});

const LOGO_SVG = (couleur = "red") => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <defs>
  </defs>
  <!-- cercle -->
  <circle cx="60" cy="60" r="60" fill="${couleur}"/>
  <path d="M30 62 L52 84 L92 40" stroke="white" stroke-width="10" fill="none"/>
  <!-- fin -->
  <g/>
</svg>
`;
const ACTIF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" onload="window.parent.__onload = 1">
  <script>window.parent.__script = 1;</script>
  <image href="https://exemple.org/x.png" width="120" height="120"/>
  <a href="autre.svg"><rect width="120" height="120" fill="green"/></a>
</svg>
`;
const GRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000" viewBox="0 0 2000 1000"><rect width="2000" height="1000" fill="teal"/></svg>
`;

test("REQ121_AC2_AC4_AC6_AC8_AC9_parcours_P089_apercu_svg", async ({ page }) => {
  const dossier = depotExemple();
  ecrire(dossier, "img/logo.svg", LOGO_SVG());
  ecrire(dossier, "img/actif.svg", ACTIF_SVG);
  ecrire(dossier, "img/grand.svg", GRAND_SVG);
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const requetes = espionner(page);
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await ligne(page, "img").click();
    const apercu = page.locator('.ya-image[aria-label="Aperçu"]:visible');
    const trace = apercu.locator("img");
    const pixel = () =>
      trace.evaluate(
        (i) =>
          new Promise((ok) => {
            const c = document.createElement("canvas");
            c.width = c.height = 120;
            const im = new Image();
            im.onload = () => {
              const x = c.getContext("2d");
              x.drawImage(im, 0, 0, 120, 120);
              ok(Array.from(x.getImageData(10, 60, 1, 1).data));
            };
            im.src = i.src;
          }),
      );

    // AC-121-8 et AC-121-9 : seul bouton « Aperçu », même largeur que l'éditeur, 120 × 120 centré sur fond blanc.
    await ligne(page, "logo.svg").click();
    await expect(page.getByRole("textbox", { name: "Éditeur logo.svg" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Aperçu", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Mode hybride" })).toHaveCount(0);
    await expect(trace).toBeVisible();
    await expect.poll(() => largeurNaturelle(trace)).toBe(120);
    const ed = await boite(page.locator(".cm-editor:visible"));
    const ap = await boite(apercu);
    proche(ed.w, ap.w);
    const t = await boite(trace);
    proche(t.w, 120);
    proche(t.h, 120);
    proche(t.x + t.w / 2, ap.x + ap.w / 2);
    proche(t.y + t.h / 2, ap.y + ap.h / 2);
    expect(await fond(trace)).toBe(BLANC);
    expect(await apercu.evaluate((e) => e.querySelectorAll("a[href],button,input,select,textarea,[tabindex]").length + (e.hasAttribute("tabindex") ? 1 : 0))).toBe(0);
    await page.getByRole("button", { name: "Thème clair" }).click();
    expect(await fond(trace)).toBe(BLANC);
    const tc = await boite(trace);
    proche(tc.w, 120);
    proche(tc.h, 120);
    await page.getByRole("button", { name: "Thème clair" }).click();
    expect(await pixel()).toEqual([255, 0, 0, 255]);

    // AC-121-2 : red → blue, le dessin change en moins de 1 s, sans Ctrl+S ; le disque ne change pas.
    await page.getByRole("textbox", { name: "Éditeur logo.svg" }).click();
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.type('<circle cx="60" cy="60" r="60" fill="blue"/>');
    await expect.poll(pixel, { timeout: 1000 }).toEqual([0, 0, 255, 255]);
    expect(fs.readFileSync(path.join(dossier, "img/logo.svg"), "utf8")).toBe(LOGO_SVG());
    await expect(page.getByRole("tab", { name: /^logo\.svg(, nouveau)?, non sauvegardé/ })).toBeVisible();

    // AC-121-4 : rien ne s'exécute, aucune requête externe, un clic sur le dessin n'ouvre rien.
    await ligne(page, "actif.svg").click();
    await expect(onglet(page, "actif.svg")).toHaveAttribute("aria-selected", "true");
    await expect(trace).toBeVisible();
    await expect.poll(() => largeurNaturelle(trace)).toBe(120);
    const avant = page.url();
    const onglets = await page.getByRole("tab").count();
    await trace.click();
    expect(page.url()).toBe(avant);
    expect(page.context().pages()).toHaveLength(1);
    expect(await page.getByRole("tab").count()).toBe(onglets);
    expect(await page.evaluate(() => [window.__script, window.__onload])).toEqual([undefined, undefined]);

    // AC-121-6 : 2000 × 1000 entier, proportions gardées.
    await ligne(page, "grand.svg").click();
    await expect(onglet(page, "grand.svg")).toHaveAttribute("aria-selected", "true");
    await expect(trace).toBeVisible();
    await expect.poll(() => largeurNaturelle(trace)).toBe(2000);
    const g = await boite(trace);
    const ag = await boite(apercu);
    expect(g.w).toBeLessThan(2000);
    proche(g.w, g.h * 2, 2);
    expect(g.x).toBeGreaterThanOrEqual(ag.x - 1);
    expect(g.x + g.w).toBeLessThanOrEqual(ag.x + ag.w + 1);
    expect(g.y).toBeGreaterThanOrEqual(ag.y - 1);
    expect(g.y + g.h).toBeLessThanOrEqual(ag.y + ag.h + 1);

    const externes = requetes().filter((u) => new URL(u).origin !== yaide.origine);
    expect(externes).toEqual([]);
  } finally {
    await yaide.arreter();
  }
});

// P-135 et P-136 : bouton « Image » de la barre « Mise en forme », images `![[nom]]` du mode hybride et de l'aperçu
// (REQ-170, REQ-175). Un seul lancement de Yaide ; les cas fins sont prouvés par les tests de composant.
test("REQ175_AC1_AC7_AC8_AC13_AC14_REQ170_AC18_parcours_P135_P136_image_dans_le_guide", async ({ page }) => {
  const dossier = depotExemple();
  const gris = (y, t) => t.fill(128);
  ecrire(dossier, "img/architecture.png", png(1600, 900, 0, gris));
  ecrire(dossier, "img/ok.png", disque(16, [0, 160, 0]));
  ecrire(dossier, "img/capture.png", png(4000, 3000, 0, gris));
  ecrire(dossier, "img/photo.jpg", JPEG);
  ecrire(dossier, "img/PHOTO.JPG", JPEG);
  ecrire(dossier, "img/anim.gif", GIF);
  ecrire(dossier, "img/image.webp", WEBP);
  ecrire(dossier, "img/dessin.svg", ACTIF_SVG);
  ecrire(dossier, "docs/guide.md", "# Guide\n\nTexte du guide.\n\n\n\nFin du guide.\n\nLe voyant ![[ok.png]] dit que le serveur répond.\n");
  ecrire(dossier, "docs/grande.md", "Début\n\n\n\n![[capture.png]]\n\nFin\n");
  ecrire(dossier, "docs/formats.md", ["architecture.png", "img/architecture.png", "../img/architecture.png", "photo.jpg", "anim.gif", "image.webp", "dessin.svg", "PHOTO.JPG"].map((n) => `![[${n}]]`).join("\n\n") + "\n");
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const requetes = espionner(page);
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await ligne(page, "docs").click();
    await ligne(page, "guide.md").click();
    const barre = page.getByRole("toolbar", { name: "Mise en forme" });
    const contenu = page.locator(".cm-content:visible");
    const etat = page.getByText(/Ln \d+, Col \d+/);
    const lignes = contenu.locator(".cm-line");
    const apercu = page.locator(".zone-code-apercu:visible");
    // Largeur du texte d'une zone : celle de la ligne moins son remplissage.
    const largeurTexte = (loc) => loc.evaluate((e) => { const s = getComputedStyle(e); return e.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); });

    // P-135, étape 1 : clic sur « Image » sur la ligne 5 vide.
    await expect(lignes.nth(8).locator("img.ya-image-md")).toHaveCount(1);
    await lignes.nth(4).click();
    await barre.getByRole("button", { name: "Image" }).click();
    await expect(lignes.nth(4)).toHaveText("![[image.png]]");
    await expect(etat).toHaveText("Ln 5, Col 13");
    await expect(contenu).toBeFocused();
    expect(await page.evaluate(() => getSelection().toString())).toBe("image.png");
    // AC-175-13 : le voyant est dans la phrase, à sa taille, fond blanc.
    const voyant = lignes.nth(8).locator("img.ya-image-md");
    await expect.poll(() => largeurNaturelle(voyant)).toBe(16);
    const v = await boite(voyant);
    proche(v.w, 16);
    proche(v.h, 16);
    expect(await voyant.evaluate((i) => getComputedStyle(i).verticalAlign)).toBe("text-bottom");
    expect(await fond(voyant)).toBe(BLANC);
    expect(await voyant.evaluate((i) => { const s = getComputedStyle(i); return [s.borderTopWidth, s.boxShadow, s.borderRadius]; })).toEqual(["0px", "none", "0px"]);
    await expect(lignes.nth(8)).toHaveText(/^Le voyant\s*dit que le serveur répond\.$/);
    expect(await lignes.nth(8).evaluate((l) => l.getClientRects().length)).toBe(1);
    expect((await boite(voyant)).y).toBeLessThan((await boite(lignes.nth(8))).y + (await boite(lignes.nth(8))).h);

    // Étapes 2 et 3 : fichier absent, la balise reste en texte ; on la corrige.
    await page.keyboard.type("archi.png");
    await page.keyboard.press("ArrowDown");
    await expect(lignes.nth(4)).toHaveText("![[archi.png]]");
    await expect(lignes.nth(4).locator("img.ya-image-md")).toHaveCount(0);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.type("![[architecture.png]]");

    // Étape 4 : curseur ailleurs, le schéma remplace la balise, à la largeur du texte.
    await lignes.nth(6).click();
    await page.keyboard.press("End");
    const schema = lignes.nth(4).locator("img.ya-image-md");
    await expect.poll(() => largeurNaturelle(schema)).toBe(1600);
    const s1 = await boite(schema);
    expect(s1.w).toBeLessThan(1600);
    proche(s1.w, await largeurTexte(lignes.nth(4)), 1);
    proche(s1.h * 16, s1.w * 9, 16);
    expect(await page.locator(".cm-scroller:visible").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);

    // Étape 5 : la frappe ailleurs ne recharge pas l'image ; Ctrl+Z ; Ctrl+S écrit la balise en clair.
    const poignee = await schema.elementHandle();
    await page.keyboard.type(" Le port par défaut est 7070.");
    expect(await poignee.evaluate((i) => i.isConnected)).toBe(true);
    expect(await boite(schema)).toEqual(s1);
    await page.keyboard.press("Control+z");
    await expect(lignes.nth(6)).toHaveText("Fin du guide.");
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(path.join(dossier, "docs/guide.md"), "utf8")).toContain("![[architecture.png]]");

    // P-136, étape 1 : aperçu dans une fenêtre de 1024 px, schéma des deux côtés, rien ne défile en largeur.
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    await expect(apercu).toBeVisible();
    const schemaApercu = apercu.locator("img").first();
    await expect.poll(() => largeurNaturelle(schemaApercu)).toBe(1600);
    const largeurs = async () => [(await boite(schema)).w, (await boite(schemaApercu)).w];
    const [e1, a1] = await largeurs();
    proche(e1, await largeurTexte(lignes.nth(4)), 1);
    proche(a1, await largeurTexte(apercu), 40);
    expect(a1).toBeLessThan(1600);
    expect(await apercu.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(await page.locator(".cm-scroller:visible").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    const voyantApercu = apercu.locator('img[alt="ok.png"]');
    await expect.poll(() => largeurNaturelle(voyantApercu)).toBe(16);
    proche((await boite(voyantApercu)).w, 16);

    // AC-170-18 : « Image » juste à droite de « Lien », même rang, avec deux rangs à 1024 px.
    const bouton = (nom) => barre.getByRole("button", { name: nom, exact: true });
    const rangs = async () => new Set((await barre.getByRole("button").evaluateAll((bs) => bs.map((x) => Math.round(x.getBoundingClientRect().top))))).size;
    const lienImage = async () => {
      const [l, i, t] = [await boite(bouton("Lien")), await boite(bouton("Image")), await boite(bouton("Titre"))];
      expect(Math.abs(l.y - i.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(l.y - t.y)).toBeLessThanOrEqual(1);
      proche(i.x, l.x + l.w, 12);
      expect(i.x).toBeGreaterThan(l.x);
    };
    await expect(bouton("Image")).not.toHaveAttribute("aria-keyshortcuts");
    expect(await rangs()).toBe(2);
    await lienImage();

    // Étape 2 : la poignée du panneau vers la droite, les deux schémas suivent leur largeur.
    const separateur = page.getByRole("separator", { name: "Largeur du panneau" });
    await separateur.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await largeurs())[0]).toBeLessThan(e1 - 20);
    const [e2, a2] = await largeurs();
    expect(a2).toBeLessThan(a1 - 20);
    proche(e2, await largeurTexte(lignes.nth(4)), 1);
    expect(await apercu.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowLeft");

    // AC-170-18 : éditeur de 400 px, un seul rang ; de 380 px, deux rangs, « Lien » et « Image » sur le premier.
    const zone = page.locator(".zone-code-editeur:visible");
    await zone.evaluate((e) => { e.style.flex = "0 0 400px"; });
    expect(await rangs()).toBe(1);
    await lienImage();
    await zone.evaluate((e) => { e.style.flex = "0 0 380px"; });
    expect(await rangs()).toBe(2);
    await lienImage();
    await zone.evaluate((e) => { e.style.flex = ""; });

    // Étape 3 : clic sur le schéma de l'éditeur, le curseur au début de la balise ; l'aperçu garde l'image.
    await schema.click();
    await expect(etat).toHaveText("Ln 5, Col 1");
    await expect(lignes.nth(4)).toHaveText("![[architecture.png]]");
    await expect(schemaApercu).toBeVisible();
    expect(page.context().pages().length).toBe(1);
    // Étape 4 : sans mode hybride, tout le texte brut et pas de barre ; l'aperçu garde le schéma.
    await page.getByRole("button", { name: "Mode hybride" }).click();
    await expect(barre).toHaveCount(0);
    await expect(page.locator(".cm-content:visible .cm-line", { hasText: "![[architecture.png]]" })).toHaveCount(1);
    await expect(page.locator(".cm-content:visible img.ya-image-md")).toHaveCount(0);
    await expect(schemaApercu).toBeVisible();
    await page.getByRole("button", { name: "Mode hybride" }).click();

    // AC-175-8 et AC-175-14 : 4000 × 3000 seule sur la ligne 5, dans l'éditeur et dans l'aperçu.
    await ligne(page, "grande.md").click();
    await expect(barre).toBeVisible();
    await expect(apercu).toHaveCount(0);
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    await expect(apercu).toBeVisible();
    const grande = lignes.nth(4).locator("img.ya-image-md");
    await expect.poll(() => largeurNaturelle(grande)).toBe(4000);
    const g = await boite(grande);
    proche(g.w, await largeurTexte(lignes.nth(4)), 1);
    proche(g.h * 4, g.w * 3, 4);
    const ligne1 = await lignes.nth(0).evaluate((l) => l.getBoundingClientRect().left + parseFloat(getComputedStyle(l).paddingLeft));
    proche(g.x, ligne1, 1);
    expect(await page.locator(".cm-scroller:visible").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    const numeros = await page.locator(".cm-editor:visible .cm-lineNumbers .cm-gutterElement").evaluateAll((els) => els.filter((e) => e.offsetHeight > 0).map((e) => e.textContent));
    expect(numeros).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    const numero5 = page.locator(".cm-editor:visible .cm-lineNumbers .cm-gutterElement", { hasText: /^5$/ });
    proche((await boite(numero5)).y, (await boite(lignes.nth(4))).y, 2);
    const grandeApercu = apercu.locator("img").first();
    await expect.poll(() => largeurNaturelle(grandeApercu)).toBe(4000);
    proche((await boite(grandeApercu)).w, await largeurTexte(apercu), 40);
    expect(await apercu.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);

    // AC-175-1 : chaque forme de chemin et chaque format s'affiche dans l'aperçu.
    await ligne(page, "formats.md").click();
    await expect(apercu).toHaveCount(0);
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    await expect(apercu).toBeVisible();
    for (const n of ["architecture.png", "img/architecture.png", "../img/architecture.png", "photo.jpg", "anim.gif", "image.webp", "dessin.svg", "PHOTO.JPG"]) {
      await expect.poll(() => largeurNaturelle(apercu.locator(`img[alt="${n}"]`)), { message: n }).toBeGreaterThan(0);
    }

    // AC-175-7 : rien ne part vers une autre origine et le SVG n'exécute rien.
    expect(await page.evaluate(() => [window.__script, window.__onload])).toEqual([undefined, undefined]);
    expect(requetes().filter((u) => new URL(u).origin !== yaide.origine)).toEqual([]);
  } finally {
    await yaide.arreter();
  }
});
