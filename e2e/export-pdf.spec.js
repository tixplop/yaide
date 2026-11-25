import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

// DEC-115 : `pdfmake` tourne sous la CSP de Yaide (`script-src 'self'`, sans `unsafe-eval`),
// et fontkit embarque JetBrains Mono (ttf) et Noto Sans SC.
test("REQ177_socle_pdfmake_sous_la_csp_polices_embarquees", async ({ page }) => {
  const yaide = await lancerYaide({ dossier: depotExemple() });
  try {
    const violations = [];
    page.on("console", (m) => /Content Security Policy/i.test(m.text()) && violations.push(m.text()));
    await ouvrirYaide(page, yaide.origine);
    const r = await page.evaluate(async () => {
      await new Promise((ok, ko) => {
        const s = document.createElement("script");
        s.src = "/pdf.js";
        s.onload = ok;
        s.onerror = () => ko(new Error("pdf.js"));
        document.head.append(s);
      });
      const blob = await window.yaidePdf.produire(
        {
          pageSize: "A4",
          content: [
            { text: "fn main() { i }", font: "JetBrainsMono", fontSize: 10 },
            { text: "漢字 かな", font: "NotoSansSC", fontSize: 10 },
          ],
          ideogrammes: true,
        },
        "main.rs",
      );
      const octets = new Uint8Array(await blob.arrayBuffer());
      return { debut: String.fromCharCode(...octets.slice(0, 4)), taille: octets.length };
    });
    expect(r.debut).toBe("%PDF");
    expect(r.taille).toBeGreaterThan(1000);
    expect(violations).toEqual([]);
  } finally {
    await yaide.arreter();
  }
});

const morceau = (type, donnees) => {
  const t = Buffer.concat([Buffer.from(type), donnees]);
  const tete = Buffer.alloc(4);
  tete.writeUInt32BE(donnees.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(t));
  return Buffer.concat([tete, t, crc]);
};
/** PNG gris `n` × `n`, opaque. */
function logo(n) {
  const brut = Buffer.alloc((n + 1) * n, 0x60);
  for (let y = 0; y < n; y++) brut[y * (n + 1)] = 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau("IHDR", ihdr), morceau("IDAT", zlib.deflateSync(brut)), morceau("IEND", Buffer.alloc(0))]);
}

// Texte des chaînes `<hex>` d'un PDF sans compression : suffisant pour retrouver une ligne écrite en Helvetica.
const texteDuPdf = (pdf) => [...pdf.matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("");

// P-137 : « Exporter en PDF » depuis Ctrl+P.
test("REQ177_AC1_AC3_AC4_AC5_parcours_P137_export_du_markdown_avec_diagramme_image_absente_et_couleurs", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "docs"), { recursive: true });
  const disque = path.join(dossier, "docs", "notes.md");
  const source = "# Notes\n\n![[logo.png]]\n\n```mermaid\ngraph TD; A[Début] --> B[Fin]\n```\n\n![[absent.png]]\n\n```mermaid\ngraph TD; A -->\n```\n\n[site](https://exemple.org)\n";
  fs.writeFileSync(disque, source);
  fs.mkdirSync(path.join(dossier, ".yaide"), { recursive: true });
  fs.writeFileSync(path.join(dossier, ".yaide", "markdown.json"), JSON.stringify({ clair: { titre1: { couleur: "#aa0000" } } }));
  fs.writeFileSync(path.join(dossier, "docs", "logo.png"), logo(160));
  const yaide = await lancerYaide({ dossier });
  try {
    // Garde la définition passée à `produire`.
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
    await page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne("docs") }).click();
    await page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne("notes.md") }).click();
    const editeur = page.getByRole("textbox", { name: "Éditeur notes.md" });
    await expect(editeur).toBeFocused();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("Ligne non enregistrée");
    const onglet = page.getByRole("tab", { name: /^notes\.md/ });
    await expect(onglet).toHaveAttribute("data-modifie", "true");

    await page.keyboard.press("Control+p");
    await page.keyboard.type(">pdf");
    await expect(page.getByRole("option")).toHaveText(["Exporter en PDF"]);
    const [telechargement] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    await page.keyboard.type(" APRESENTREE");
    expect(telechargement.suggestedFilename()).toBe("notes.pdf");
    const fichier = path.join(process.env.TMPDIR ?? dossier, `notes-${Date.now()}.pdf`);
    await telechargement.saveAs(fichier);
    const pdf = fs.readFileSync(fichier).toString("latin1");

    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf.match(/\/SMask \d+ 0 R/g)).toHaveLength(2); // deux images, chacune avec son masque de transparence
    expect(pdf).toContain("120 0 0 -120 56.692913 "); // le logo de 160 px : 120 pt, à 20 mm du bord
    expect(texteDuPdf(pdf)).toContain("Ligne non enregistrée");
    expect(texteDuPdf(pdf)).not.toContain("APRESENTREE");
    // AC-177-5 : texte du thème clair, quel que soit le thème de Yaide.
    expect(pdf).toContain("0.12156862745098039 0.12156862745098039 0.12156862745098039 scn");

    // AC-177-4 : image absente en texte, mermaid illisible en bloc de code, aucun toast d'échec.
    expect(texteDuPdf(pdf)).toContain("![[absent.png]]");
    const noeuds = await page.evaluate(() => {
      const images = [];
      const code = [];
      const parcourir = (n) => {
        if (Array.isArray(n)) return n.forEach(parcourir);
        if (!n || typeof n !== "object") return;
        if (n.image) images.push(n.image);
        if (n.font === "JetBrainsMono" && JSON.stringify(n).includes("graph TD; A -->")) code.push(n);
        Object.values(n).forEach(parcourir);
      };
      parcourir(window.definitionPdf.content);
      return { images: new Set(images).size, code: code.length };
    });
    expect(noeuds.images).toBe(2); // le logo et le diagramme lisible, pas le bloc illisible
    expect(noeuds.code).toBeGreaterThan(0); // le bloc illisible reste en texte JetBrains Mono
    await expect(page.locator(".ya-toasts [role=alert]")).toHaveCount(0);
    // AC-177-5 : couleur du titre venue de `.yaide/markdown.json`, couleur du lien, pas de fond de page.
    const scn = (r, v, b) => `${r} ${v} ${b} scn`;
    expect(pdf).toContain(scn(0xaa / 255, 0, 0));
    expect(pdf).toContain(scn(0, 0x5f / 255, 0xb8 / 255));
    expect(pdf).not.toMatch(/0 0 595\.\d+ 841\.\d+ re/);

    await expect(onglet).toHaveAttribute("data-modifie", "true");
    expect(fs.readFileSync(disque, "utf8")).toBe(source);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(editeur).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await yaide.arreter();
  }
});
