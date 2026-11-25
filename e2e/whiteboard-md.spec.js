import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

// P-140 (whiteboard dans l'aperçu d'un markdown) puis P-141 (réduction à la largeur, export en PDF) : REQ-179.
const ligne = (page, nom) => page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne(nom) });
const proche = (a, b, marge = 1) => expect(Math.abs(a - b)).toBeLessThanOrEqual(marge);

const boite = (id, x, y, text, extra = {}) => ({ id, x, y, width: 160, height: 80, shape: "rectangle", text, ...extra });
const jdiag = (boxes, links = [], arrows = []) => JSON.stringify({ version: 1, boxes, links, arrows }, null, 2) + "\n";
const PIEGE = '<script>alert(1)</script><img src="https://exemple.org/x.png">';
const PLAN = jdiag(
  [
    boite("b1", 0, 0, "Début", { color: "blue", spans: [{ start: 0, end: 2, bold: true }] }),
    boite("b2", 300, 100, "Fin", { shape: "rounded", color: "green", spans: [{ start: 1, end: 3, color: "red" }] }),
    boite("b3", 0, 250, "Base", { width: 100, height: 100, shape: "database" }),
    boite("b4", 200, 260, "", { width: 16, height: 16, shape: "dot" }),
    boite("b5", 200, 320, "", { width: 120, height: 8, shape: "bar" }),
    boite("b6", 500, 0, PIEGE, { width: 200, height: 120, shape: "text" }),
  ],
  [{ id: "l1", from: "b1", to: "b2", text: "suite" }],
  [{ id: "f1", x1: 350, y1: 300, x2: 450, y2: 380 }],
);
const DEUX = (x2, y2) => jdiag([boite("b1", 0, 0, "A", { width: 100, height: 60 }), boite("b2", x2, y2, "B", { width: 100, height: 60 })]);

const morceau = (type, donnees) => {
  const t = Buffer.concat([Buffer.from(type), donnees]);
  const tete = Buffer.alloc(4);
  tete.writeUInt32BE(donnees.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(t));
  return Buffer.concat([tete, t, crc]);
};
function logo(n) {
  const brut = Buffer.alloc((n + 1) * n, 0x60);
  for (let y = 0; y < n; y++) brut[y * (n + 1)] = 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau("IHDR", ihdr), morceau("IDAT", zlib.deflateSync(brut)), morceau("IEND", Buffer.alloc(0))]);
}
const texteDuPdf = (pdf) => [...pdf.matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("");

// Le SVG `data:` d'une image de l'aperçu, en texte.
const svgDe = (img) => img.evaluate((i) => decodeURIComponent(i.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, "")));

test("REQ179_AC1_AC2_AC5_AC6_parcours_P140_REQ179_AC7_AC8_parcours_P141_whiteboard_dans_le_markdown_et_le_pdf", async ({ page }) => {
  const dossier = depotExemple();
  const ecrire = (nom, texte) => {
    fs.mkdirSync(path.dirname(path.join(dossier, nom)), { recursive: true });
    fs.writeFileSync(path.join(dossier, nom), texte);
  };
  ecrire("schemas/plan.jdiag", PLAN);
  ecrire("docs/guide.md", "# Guide\n\n![[plan.jdiag]]\n\n![[schemas/plan.jdiag]]\n");
  ecrire("docs/clair.md", "![[plan.jdiag]]\n");
  ecrire("docs/grand.jdiag", DEUX(3900, 2940));
  ecrire("docs/petit.jdiag", DEUX(100, 0));
  ecrire("docs/grand.md", "# Grand\n\n![[grand.jdiag]]\n\n![[petit.jdiag]]\n");
  ecrire("docs/pdf.jdiag", jdiag([boite("b1", 0, 0, "Début", { width: 100, height: 60 }), boite("b2", 268, 108, "Fin", { width: 100, height: 60 })], [{ id: "l1", from: "b1", to: "b2", text: "" }]));
  ecrire("docs/large.jdiag", DEUX(1500, 0));
  ecrire("docs/vide.jdiag", jdiag([]));
  ecrire("docs/logo.png", logo(160));
  ecrire("docs/notes.md", "# Notes\n\n![[pdf.jdiag]]\n\n```mermaid\ngraph TD; A[Début] --> B[Fin]\n```\n\n![[logo.png]]\n\n![[large.jdiag]]\n\n![[vide.jdiag]]\n\n![[absent.jdiag]]\n");
  const yaide = await lancerYaide({ dossier });
  try {
    const autres = [];
    const dialogues = [];
    page.on("request", (r) => new URL(r.url()).origin !== yaide.origine && !r.url().startsWith("data:") && autres.push(r.url()));
    page.on("dialog", (d) => dialogues.push(d.message()));
    await page.addInitScript(() => {
      let reel;
      Object.defineProperty(window, "yaidePdf", {
        configurable: true,
        get: () => reel,
        set: (v) => {
          reel = { ...v, produire: (definition, nom) => ((window.definitionPdf = definition), v.produire(definition, nom)) };
        },
      });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.evaluate(() => localStorage.setItem("yaide-theme-whiteboard", "dark"));
    await page.evaluate(() => (window.marque = "meme-page"));

    // P-140 : l'aperçu de guide.md montre le dessin à la place des deux balises.
    await ligne(page, "docs").click();
    await ligne(page, "guide.md").click();
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    const apercu = page.locator(".zone-code-apercu:visible");
    const plan = apercu.locator('img[alt="plan.jdiag"]');
    const planDossier = apercu.locator('img[alt="schemas/plan.jdiag"]');
    // AC-179-1 : largeur naturelle = largeur des objets (0 à 700) plus 32 px.
    await expect.poll(() => plan.evaluate((i) => i.naturalWidth)).toBe(732);
    await expect.poll(() => planDossier.evaluate((i) => i.naturalWidth)).toBe(732);
    await expect(apercu).not.toContainText("![[");

    // AC-179-2 : dans le thème clair des whiteboards, sur blanc, même thème que Yaide sombre.
    const svg = await svgDe(plan);
    const lire = (source) =>
      page.evaluate((x) => {
        const d = new DOMParser().parseFromString(x, "image/svg+xml").documentElement;
        const couleur = (e) => /(?:^|;)color:([^;]+)/.exec(e.getAttribute("style") ?? "")?.[1];
        const partie = [...d.querySelectorAll('g[data-id="b2"] *')].find((e) => e.children.length === 0 && e.textContent === "in");
        const debut = [...d.querySelectorAll('g[data-id="b2"] *')].find((e) => e.children.length === 0 && e.textContent === "F");
        return {
          fond: (() => {
            const t = document.createElement("div");
            t.style.color = d.querySelector("rect").getAttribute("fill");
            document.body.append(t);
            const v = getComputedStyle(t).color;
            t.remove();
            return v;
          })(),
          ids: [...d.querySelectorAll("g[data-id]")].map((g) => g.getAttribute("data-id")),
          formes: Object.fromEntries([...d.querySelectorAll("g[data-id]")].map((g) => [g.getAttribute("data-id"), g.querySelectorAll("*").length])),
          lien: d.querySelector('g[data-id="l1"]').textContent,
          rouge: partie && couleur(partie),
          normal: debut && couleur(debut),
        };
      }, source);
    const dessinClair = await lire(svg);
    expect(dessinClair.fond).toBe("rgb(255, 255, 255)");
    expect(dessinClair.ids.sort()).toEqual(["b1", "b2", "b3", "b4", "b5", "b6", "f1", "l1"]);
    expect(dessinClair.lien).toContain("suite");
    expect(svg).toContain("font-weight:700");
    const [r, g, b] = dessinClair.rouge.match(/\d+/g).map(Number);
    expect(r).toBeGreaterThan(g + 40);
    expect(r).toBeGreaterThan(b + 40);
    expect(dessinClair.normal).not.toBe(dessinClair.rouge);
    // Whiteboards en thème clair, puis en thème sombre : le même dessin.
    await page.evaluate(() => localStorage.setItem("yaide-theme-whiteboard", "light"));
    await ligne(page, "clair.md").click();
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    const planClair = page.locator(".zone-code-apercu:visible").locator('img[alt="plan.jdiag"]');
    await expect.poll(() => planClair.evaluate((i) => i.naturalWidth)).toBe(732);
    expect(await svgDe(planClair)).toBe(svg);
    // Positions comparées à l'onglet du whiteboard à 100 % (1 px près).
    await ligne(page, "schemas").click();
    await ligne(page, "plan.jdiag").click();
    const surface = page.getByRole("application", { name: "plan.jdiag" });
    await expect(surface).toBeFocused();
    const mesures = (cadre) =>
      cadre.evaluate((c) => {
        const r = Object.fromEntries(["b1", "b2", "b3", "b4", "b5", "f1", "l1"].map((id) => {
          const b = c.querySelector(`g[data-id="${id}"]`).getBoundingClientRect();
          return [id, [b.x, b.y, b.width, b.height]];
        }));
        const o = r.b1;
        return Object.fromEntries(Object.entries(r).map(([id, [x, y, w, h]]) => [id, [x - o[0], y - o[1], w, h]]));
      });
    const onglet = await mesures(surface);
    // Aucune poignée, anneau ni connecteur : autant d'éléments par objet que dans l'onglet, hors surcouche et prises.
    const formesOnglet = await surface.evaluate((c) => Object.fromEntries([...c.querySelectorAll("g[data-id]")].map((g) => [g.getAttribute("data-id"), [...g.querySelectorAll("*")].filter((e) => !e.matches(".surcouche, .prise, .surcouche *, .prise *")).length])));
    expect(Object.keys(formesOnglet).sort()).toEqual(Object.keys(dessinClair.formes).sort());
    expect(dessinClair.formes).toEqual(formesOnglet);
    await page.evaluate((s) => {
      const d = document.createElement("div");
      d.id = "essai-dessin";
      d.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none";
      d.innerHTML = s;
      document.body.append(d);
    }, svg);
    const dessin = await mesures(page.locator("#essai-dessin"));
    await page.evaluate(() => document.getElementById("essai-dessin").remove());
    // Le point et la barre ont une zone de choix plus grande que leur forme dans l'onglet : on compare leurs centres.
    for (const id of Object.keys(onglet)) {
      const [ox, oy, ow, oh] = onglet[id];
      const [dx, dy, dw, dh] = dessin[id];
      proche(dx + dw / 2, ox + ow / 2);
      proche(dy + dh / 2, oy + oh / 2);
      if (!["b4", "b5"].includes(id)) {
        proche(dw, ow);
        proche(dh, oh);
      }
    }

    // AC-179-5 : une boîte « Suite » non enregistrée n'est pas dans le document ; après Ctrl+S, elle y est, sans recharger.
    await page.getByRole("button", { name: "Ajouter une boîte" }).click();
    await page.keyboard.type("Suite");
    await page.keyboard.press("Escape");
    await expect(surface.locator('[aria-roledescription="boîte"]').filter({ hasText: "Suite" })).toBeVisible();
    await page.getByRole("tab", { name: /^guide\.md/ }).click();
    await expect(plan).toBeVisible();
    expect(await svgDe(plan)).not.toContain("Suite");
    await page.getByRole("tab", { name: /^plan\.jdiag/ }).click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(path.join(dossier, "schemas/plan.jdiag"), "utf8")).toContain("Suite");
    await page.getByRole("tab", { name: /^guide\.md/ }).click();
    await expect.poll(async () => (await svgDe(plan)).match(/data-id="/g).length).toBe(9);
    expect(await svgDe(plan)).toContain("Suite");
    expect(await page.evaluate(() => window.marque)).toBe("meme-page");

    // AC-179-6 : le texte `<script>` est lu tel quel, rien ne s'exécute, aucune autre origine.
    const lu = await page.evaluate((s) => new DOMParser().parseFromString(s, "image/svg+xml").documentElement.textContent, await svgDe(plan));
    expect(lu).toContain(PIEGE);
    expect(dialogues).toEqual([]);
    expect(autres).toEqual([]);

    // P-141 : 4000 × 3000 px réduit à la largeur de la zone de texte, deux petites boîtes jamais agrandies.
    await ligne(page, "grand.md").click();
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    const apercuGrand = page.locator(".zone-code-apercu:visible");
    const grand = apercuGrand.locator('img[alt="grand.jdiag"]');
    const petit = apercuGrand.locator('img[alt="petit.jdiag"]');
    await expect.poll(() => grand.evaluate((i) => i.naturalWidth)).toBe(4032);
    await expect.poll(() => petit.evaluate((i) => i.naturalWidth)).toBe(232);
    const largeurTexte = (img) => img.evaluate((i) => { const p = i.closest(".cm-line") ?? i.parentElement; const s = getComputedStyle(p); return p.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); });
    const taille = (img) => img.evaluate((i) => ({ l: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height }));
    const verifier = async (grand, petit, defile) => {
      const g = await taille(grand);
      proche(g.l, await largeurTexte(grand));
      proche(g.h, (g.l * 3032) / 4032);
      expect(await defile.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      const p = await taille(petit);
      proche(p.l, 232);
      proche(p.h, 92);
    };
    // Mode hybride allumé en plus de l'aperçu : curseur ligne 1, les deux dessins sont des images.
    const bascule = page.getByRole("button", { name: "Mode hybride" });
    if ((await bascule.getAttribute("aria-pressed")) !== "true") await bascule.click();
    await expect(bascule).toHaveAttribute("aria-pressed", "true");
    const hybride = page.locator(".cm-content:visible");
    const grandH = hybride.locator('img[alt="grand.jdiag"]');
    const petitH = hybride.locator('img[alt="petit.jdiag"]');
    await expect(grandH).toBeVisible();
    await expect(petitH).toBeVisible();
    const defileH = page.locator(".cm-scroller:visible");
    const verifierTout = async () => {
      await verifier(grand, petit, apercuGrand);
      await verifier(grandH, petitH, defileH);
    };
    await verifierTout();
    const avant = (await taille(grand)).l;
    const avantH = (await taille(grandH)).l;
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect.poll(async () => (await taille(grand)).l).toBeLessThan(avant - 50);
    await expect.poll(async () => (await taille(grandH)).l).toBeLessThan(avantH - 50);
    await verifierTout();

    // AC-179-7 : export en PDF, images dans l'ordre du document, whiteboard de 400 × 200 px à 300 × 150 pt.
    await page.setViewportSize({ width: 1280, height: 800 });
    // Une boîte non enregistrée dans pdf.jdiag n'entre pas dans le PDF.
    await ligne(page, "pdf.jdiag").click();
    await page.getByRole("button", { name: "Ajouter une boîte" }).click();
    await page.keyboard.type("Brouillon");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tab", { name: /^pdf\.jdiag/ })).toHaveAttribute("data-modifie", "true");
    await ligne(page, "notes.md").click();
    await expect(page.getByRole("textbox", { name: "Éditeur notes.md" })).toBeFocused();
    await page.keyboard.press("Control+p");
    await page.keyboard.type(">pdf");
    await expect(page.getByRole("option")).toHaveText(["Exporter en PDF"]);
    const [telechargement] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    const fichier = path.join(process.env.TMPDIR ?? dossier, `notes-${Date.now()}.pdf`);
    await telechargement.saveAs(fichier);
    const pdf = fs.readFileSync(fichier).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf.match(/\/SMask \d+ 0 R/g)).toHaveLength(4);
    expect(pdf).toContain("300 0 0 -150 56.692913 ");
    expect(pdf).toContain("120 0 0 -120 56.692913 ");
    const images = await page.evaluate(() => {
      const r = [];
      const vus = new Set();
      const parcourir = (n) => {
        if (!n || typeof n !== "object" || vus.has(n)) return;
        vus.add(n);
        if (Array.isArray(n)) return n.forEach(parcourir);
        if (n.image) return r.push({ largeur: n.width, hauteur: n.height });
        Object.values(n).forEach(parcourir);
      };
      parcourir(window.definitionPdf.content);
      return r;
    });
    expect(images).toHaveLength(4);
    expect([images[0].largeur, images[0].hauteur]).toEqual([300, 150]);
    expect(images[2].largeur).toBe(120);
    proche(images[3].largeur, (170 * 72) / 25.4, 0.01);
    proche(images[3].hauteur, (images[3].largeur * 92) / 1632, 0.01);
    const ecrit = texteDuPdf(pdf);
    expect(ecrit).toContain("![[vide.jdiag]]");
    expect(ecrit).toContain("![[absent.jdiag]]");
    await expect(page.locator(".ya-toasts [role=alert]")).toHaveCount(0);
  } finally {
    await yaide.arreter();
  }
});
