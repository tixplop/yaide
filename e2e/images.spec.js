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
    for (let i = 0; i < 2; i++) await page.waitForResponse((r) => r.url().includes("/api/fichiers/versions"));
    ecrire(dossier, "img/logo.png", disque(256, [200, 0, 0]));
    await expect.poll(() => largeurNaturelle(dessin(page, "logo.png")), { timeout: 5000 }).toBe(256);

    // Fichier illisible : message à la place de l'image, sans bandeau.
    await ligne(page, "casse.png").click();
    await expect(page.getByRole("status").filter({ hasText: "casse.png ne peut pas être affiché." })).toBeVisible();

    // AC-120-6 : image supprimée hors de Yaide → l'onglet reste, l'image part, le message s'affiche.
    fs.rmSync(path.join(dossier, "img/capture.png"));
    await onglet(page, "capture.png").click();
    await expect(page.getByRole("alert").filter({ hasText: "Fichier supprimé du disque." })).toBeVisible({ timeout: 5000 });
    await expect(onglet(page, "capture.png")).toBeVisible();
    await expect(dessin(page, "capture.png")).toHaveCount(0);
    await page.getByRole("button", { name: /Fermer capture\.png/ }).click();
    await expect(onglet(page, "capture.png")).toHaveCount(0);

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
