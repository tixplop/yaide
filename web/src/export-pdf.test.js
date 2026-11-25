// @vitest-environment node
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { expect, test } from "vitest";
import { definitionMarkdown, definitionTexte, morceaux, nomPdf } from "./export-pdf.js";

const require = createRequire(import.meta.url);
// Le même paquet que `pdf.js` (version navigateur), dont les polices passent par le système de fichiers virtuel.
const pdfmake = require("pdfmake/build/pdfmake.js");
const helvetica = require("pdfmake/build/standard-fonts/Helvetica.js");
// Valeur claire de `--ink`, comme l'appelant la lira dans `tokens.css`.
const ENCRE = readFileSync(new URL("./ui/tokens.css", import.meta.url), "utf8").match(/--ink:\s*(#[0-9a-f]{6})/g)[1].split(" ")[1];
const POLICES = new URL("./ui/polices/", import.meta.url).pathname;
pdfmake.addFontContainer(helvetica);

async function produire(definition) {
  const { ideogrammes, ...doc } = definition;
  const un = (f) => ({ normal: f, bold: f, italics: f, bolditalics: f });
  const charger = (f) => pdfmake.sharedVirtualfs.writeFileSync(f, new Uint8Array(readFileSync(POLICES + f)));
  charger("JetBrainsMono-Regular.ttf");
  const fonts = { JetBrainsMono: un("JetBrainsMono-Regular.ttf") };
  if (ideogrammes) {
    charger("NotoSansSC-Regular.ttf");
    fonts.NotoSansSC = un("NotoSansSC-Regular.ttf");
  }
  pdfmake.addFonts(fonts);
  const octets = new Uint8Array(await (await pdfmake.createPdf(doc).getBlob()).arrayBuffer());
  return Buffer.from(octets).toString("latin1");
}

const lignes = (def) => def.content.map((c) => (Array.isArray(c.text) ? c.text.map((p) => p.text).join("") : c.text));

test("REQ177_AC2_texte_tel_quel_en_jetbrains_mono_10_pt_lignes_coupees_a_80", async () => {
  const longue = "x".repeat(300);
  const def = definitionTexte(`fn main() {}\n// a <b> & c\n\tx\n${longue}`, "main.rs", ENCRE);
  expect(lignes(def)).toEqual(["fn main() {}", "// a <b> & c", "    x", "x".repeat(80), "x".repeat(80), "x".repeat(80), "x".repeat(60)]);
  expect(def.defaultStyle.font).toBe("JetBrainsMono");
  expect(def.defaultStyle.fontSize).toBe(10);
  expect(def.pageSize).toBe("A4");
  expect(def.defaultStyle.color).toBe(ENCRE);
  expect(def.header).toBeUndefined();
  expect(def.footer).toBeUndefined();
  const pdf = await produire(def);
  expect(pdf.startsWith("%PDF")).toBe(true);
  expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+JetBrainsMono-Regular/);
  expect(pdf).toMatch(/\/FontFile2/);
  expect(pdf).toMatch(/\/F1 10 Tf/);
});

test("REQ177_AC8_nom_du_pdf_et_titre", async () => {
  expect(nomPdf("docs/notes.md")).toBe("notes.pdf");
  expect(nomPdf("main.rs")).toBe("main.pdf");
  expect(nomPdf("Makefile")).toBe("Makefile.pdf");
  expect(nomPdf(".env")).toBe(".env.pdf");
  expect(nomPdf("a.tar.gz")).toBe("a.tar.pdf");
  const def = definitionTexte("x", "notes.md", ENCRE);
  expect(def.info.title).toBe("notes.md");
  const pdf = await produire(def);
  const n = pdf.match(/\/Title (\d+) 0 R/)[1];
  expect(pdf).toMatch(new RegExp(`${n} 0 obj\\s*(\\(notes\\.md\\)|<feff006e006f007400650073002e006d0064>)`));
});

test("REQ177_AC12_polices_par_caractere_emoji_retires_idéogrammes_a_la_demande", async () => {
  const noms = (t, p) => morceaux(t, p).morceaux.map((m) => [m.texte, m.police]);
  expect(noms("é à ç œ € « » — …", "Helvetica")).toEqual([["é à ç œ € « » — …", "Helvetica"]]);
  expect(noms("→α", "Helvetica")).toEqual([["→α", "JetBrainsMono"]]);
  expect(noms("я", "Helvetica")).toEqual([["я", "JetBrainsMono"]]);
  const cjk = morceaux("漢字 かな", "JetBrainsMono");
  expect(cjk.ideogrammes).toBe(true);
  expect(cjk.morceaux.find((m) => m.texte.includes("漢字")).police).toBe("NotoSansSC");
  expect(cjk.morceaux.find((m) => m.texte.includes("かな")).police).toBe("NotoSansSC");
  expect(morceaux("a🙂b", "JetBrainsMono").morceaux.map((m) => m.texte).join("")).toBe("ab");

  const sans = definitionTexte("α я → é", "a.txt", ENCRE);
  expect(sans.ideogrammes).toBe(false);
  const pdfSans = await produire(sans);
  expect(pdfSans).toMatch(/JetBrainsMono-Regular/);
  expect(pdfSans).not.toMatch(/NotoSansSC/);

  const avec = definitionTexte("漢字\nかな\na🙂b", "a.txt", ENCRE);
  expect(avec.ideogrammes).toBe(true);
  expect(morceaux("𠂇", "JetBrainsMono").morceaux).toEqual([{ texte: "𠂇", police: "NotoSansSC" }]);
  expect(lignes(avec)[2]).toBe("ab");
  expect(await produire(avec)).toMatch(/NotoSans/);
});

// ---- Markdown (T-420) ----

const COULEURS = { ink: "#1f1f1f", info: "#005fb8", apercuFond: "#f0f0f3", apercuEntete: "#e4e6f1", apercuPage: "#ffffff", lineStrong: "#8a8a8a" };

function crc32(octets) {
  let c = ~0;
  for (const o of octets) {
    c ^= o;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// PNG rouge uni de l × h px, fait à la main.
function png(l, h) {
  const bloc = (type, donnees) => {
    const t = Buffer.concat([Buffer.from(type, "latin1"), donnees]);
    const n = Buffer.alloc(4);
    n.writeUInt32BE(donnees.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(t));
    return Buffer.concat([n, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const ligne = Buffer.concat([Buffer.from([0]), Buffer.alloc(l * 3, 0xc8)]);
  const brut = Buffer.concat(Array.from({ length: h }, () => ligne));
  const octets = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc("IHDR", ihdr), bloc("IDAT", deflateSync(brut)), bloc("IEND", Buffer.alloc(0))]);
  return { png: "data:image/png;base64," + octets.toString("base64"), largeur: l, hauteur: h };
}

const md = (texte, options = {}) => definitionMarkdown(texte, "notes.md", { couleurs: { ...COULEURS, ...options.couleurs }, images: options.images });

const hex = (v) => "#" + [0, 1, 2].map((i) => Math.round(Number(v.split(" ")[i]) * 255).toString(16).padStart(2, "0")).join("");

/** Pages du PDF : `{ texte: [{ x, y, police, taille, couleur, texte }], images: n }`. Le texte de JetBrains Mono n'est pas lisible (numéros de glyphes). */
function lirePdf(pdf) {
  const polices = {};
  const base = {};
  for (const m of pdf.matchAll(/\n(\d+) 0 obj\n<<[^>]*?\/BaseFont \/(\S+)/g)) base[m[1]] = m[2].replace(/^[A-Z]{6}\+/, "");
  for (const m of pdf.matchAll(/\/(F\d+) (\d+) 0 R/g)) polices[m[1]] = base[m[2]];
  const pages = [];
  for (const m of pdf.matchAll(/stream\n([\s\S]*?)endstream/g)) {
    const flux = m[1];
    if (!flux.includes("cm")) continue;
    const texte = [];
    let couleur = null;
    for (const l of flux.matchAll(/([\d.]+ [\d.]+ [\d.]+) scn|1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\/(F\d+) ([\d.]+) Tf\n\[([^\]]*)\] TJ/g)) {
      if (l[1]) couleur = hex(l[1]);
      else {
        const police = polices[l[4]];
        const brut = [...l[6].matchAll(/<([0-9a-f]+)>/g)].map((x) => x[1]).join("");
        const lu = police.startsWith("Helvetica") ? Buffer.from(brut, "hex").toString("latin1") : "?";
        texte.push({ x: Number(l[2]), y: Number(l[3]), police, taille: Number(l[5]), couleur, texte: lu });
      }
    }
    pages.push({ texte, images: (flux.match(/ Do\n/g) ?? []).length, flux });
  }
  return pages;
}

const nbPages = (pdf) => Number(pdf.match(/\/Type \/Pages[\s\S]*?\/Count (\d+)/)[1]);

test("REQ177_AC1_page_A4_titre_et_gras_en_helvetica_a_20_mm", async () => {
  const def = md("# Titre\n\nDu **gras**.");
  expect(def.pageSize).toBe("A4");
  expect(def.header).toBeUndefined();
  expect(def.footer).toBeUndefined();
  const pdf = await produire(def);
  expect(pdf).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  expect(nbPages(pdf)).toBe(1);
  const [page] = lirePdf(pdf);
  const mots = page.texte.map((t) => [t.texte.trim(), t.police, t.taille]);
  expect(mots).toEqual([["Titre", "Helvetica-Bold", 15], ["Du", "Helvetica", 10.5], ["gras", "Helvetica-Bold", 10.5], [".", "Helvetica", 10.5]]);
  const mm20 = 20 * 72 / 25.4;
  expect(Math.min(...page.texte.map((t) => t.x))).toBeCloseTo(mm20, 3);
  expect(Math.max(...page.texte.map((t) => t.y))).toBeLessThan(841.89 - mm20);
});

test("REQ177_AC4_images_a_0_75_pt_par_px_reduites_a_la_colonne_sinon_en_texte", async () => {
  const bloc = "```mermaid\ngraph TD; A-->B\n```";
  const images = { "logo.png": png(160, 160), "large.png": png(900, 90), "haute.png": png(100, 1500), "graph TD; A-->B\n": png(80, 40) };
  const def = md(`${bloc}\n\n![[logo.png]]\n\n![[large.png]]\n\n![[haute.png]]`, { images });
  const dessins = def.content.filter((c) => c.image);
  expect(dessins).toHaveLength(4);
  const [mermaid, logo, large, haute] = dessins;
  expect([mermaid.width, mermaid.height]).toEqual([60, 30]);
  expect([logo.width, logo.height]).toEqual([120, 120]);
  expect(large.width).toBeCloseTo(170 * 72 / 25.4, 3);
  expect(large.height).toBeCloseTo(large.width / 10, 3);
  expect(haute.height).toBeCloseTo((297 - 40) * 72 / 25.4, 3);
  expect(haute.width).toBeCloseTo(haute.height / 15, 3);
  expect(dessins.every((d) => d.unbreakable)).toBe(true);
  const pdf = await produire(def);
  expect(lirePdf(pdf).reduce((n, p) => n + p.images, 0)).toBe(4);

  // Dans une liste ou une cellule de tableau, la place de la puce ou des marges est retirée.
  const larges = { "i.png": png(2000, 10) };
  const liste = md("- ![[i.png]]\n- [ ] ![[i.png]]", { images: larges }).content[0].ul;
  expect(liste[0].width).toBeLessThan(170 * 72 / 25.4 - 14.99);
  expect(liste[1].columns[1].stack[0].width).toBeLessThan(170 * 72 / 25.4 - 14.99);
  const cellule = md("| A |\n|---|\n| ![[i.png]] |", { images: larges }).content[0].table.body[1][0];
  expect(cellule.image).toBeDefined();
  expect(cellule.width).toBeLessThan(170 * 72 / 25.4);

  // Sans image dans la table : la balise et le bloc restent du texte, l'export réussit.
  const sans = md(`![[absent.png]]\n\n${bloc}`, { images: {} });
  expect(sans.content.some((c) => c.image)).toBe(false);
  expect(sans.content[0].text.map((r) => r.text).join("")).toBe("![[absent.png]]");
  expect(JSON.stringify(sans.content[1])).toContain("graph");
  const pdfSans = await produire(sans);
  expect(lirePdf(pdfSans)[0].images).toBe(0);
  expect(lirePdf(pdfSans)[0].texte.map((t) => t.texte).join("")).toContain("![[absent.png]]");
});

test("REQ177_AC5_couleurs_claires_sans_fond_de_page_et_couleur_reglee", async () => {
  const texte = "# Titre 1\n\nCorps [site](https://exemple.org)\n\n## Titre 2";
  const pdf = await produire(md(texte));
  const [page] = lirePdf(pdf);
  const couleur = (mot) => page.texte.find((t) => t.texte.trim() === mot).couleur;
  expect(couleur("Corps")).toBe("#1f1f1f");
  expect(couleur("Titre")).toBe("#1f1f1f");
  expect(couleur("site")).toBe("#005fb8");
  expect(page.flux).not.toContain("1 1 1 scn"); // aucun fond blanc de page
  const regle = lirePdf(await produire(md(texte, { couleurs: { reglees: { titre1: { couleur: "#aa0000" } } } })))[0];
  expect(regle.texte.find((t) => t.texte.trim() === "Titre").couleur).toBe("#aa0000");
  expect(regle.texte.find((t) => t.texte.trim() === "Corps").couleur).toBe("#1f1f1f");
});

test("REQ177_AC10_pages_sans_entete_titre_jamais_en_bas_images_entieres_document_vide", async () => {
  const para = (n) => Array.from({ length: n }, (_, i) => `Ligne ${i}.`).join("\n\n");
  // Des paragraphes d'une ligne (25,5 pt avec leur marge) remplissent la page ; le titre tombe tout en bas pour un des essais.
  let titreEnPage2 = false;
  for (let n = 26; n <= 30; n++) {
    const pdf = await produire(md(`${para(n)}\n\n# Titre\n\nSuite du texte.`));
    const pages = lirePdf(pdf);
    for (const [i, p] of pages.entries()) {
      const bas = p.texte.reduce((a, b) => (b.y < a.y ? b : a));
      expect(bas.taille === 15 && bas.police === "Helvetica-Bold", `n=${n} page ${i + 1} finit par un titre`).toBe(false);
      for (const t of p.texte) expect(t.y).toBeGreaterThan(20 * 72 / 25.4 - 1);
    }
    if (pages[1]?.texte.some((t) => t.texte.trim() === "Titre")) {
      titreEnPage2 = true;
      expect(pages[1].texte.some((t) => t.texte.trim() === "Suite")).toBe(true);
    }
  }
  expect(titreEnPage2).toBe(true);

  // Trois pages, un paragraphe long coupé entre deux lignes, rien en dehors des marges, ni pied ni numéro.
  const long = Array.from({ length: 1300 }, (_, i) => `mot${i}`).join(" ");
  const trois = await produire(md(long));
  expect(nbPages(trois)).toBe(3);
  for (const p of lirePdf(trois)) {
    expect(p.texte.length).toBeGreaterThan(0);
    const ys = p.texte.map((t) => t.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20 * 72 / 25.4);
    expect(Math.max(...ys)).toBeLessThanOrEqual(841.89 - 20 * 72 / 25.4);
  }
  expect(lirePdf(trois).flatMap((p) => p.texte).map((t) => t.texte).join("")).not.toMatch(/\b[123]\b/);

  // Une image qui ne tient pas dans la place restante passe entière à la page suivante.
  const avecImage = await produire(md(`${para(24)}\n\n![[g.png]]`, { images: { "g.png": png(300, 400) } }));
  const pages = lirePdf(avecImage);
  expect(nbPages(avecImage)).toBe(2);
  expect([pages[0].images, pages[1].images]).toEqual([0, 1]);

  // Un bloc de code se coupe entre deux lignes.
  const code = await produire(md("```\n" + Array.from({ length: 120 }, (_, i) => `l${i}`).join("\n") + "\n```"));
  expect(nbPages(code)).toBe(3);

  // Document vide : une page blanche.
  const vide = await produire(md(""));
  expect(nbPages(vide)).toBe(1);
  expect(lirePdf(vide)[0].texte.map((t) => t.texte.trim()).join("")).toBe("");
});

test("REQ177_AC11_lien_web_souligne_et_cliquable_lien_de_fichier_sans_lien", async () => {
  const web = md("[site](https://exemple.org)");
  const run = web.content[0].text[0];
  expect(run.link).toBe("https://exemple.org");
  expect(run.decoration).toContain("underline");
  expect(run.color).toBe("#005fb8");
  const pdf = await produire(web);
  expect(pdf).toMatch(/\/URI \(https:\/\/exemple\.org\)/);
  expect(lirePdf(pdf)[0].texte.map((t) => t.texte).join("")).toBe("site");

  const fichier = md("[a](docs/a.md)");
  expect(fichier.content[0].text[0].link).toBeUndefined();
  const pdfFichier = await produire(fichier);
  expect(pdfFichier).not.toMatch(/\/URI/);
  expect(lirePdf(pdfFichier)[0].texte.map((t) => t.texte).join("")).toBe("a");
});

test("REQ177_elements_listes_cases_citation_tableau_code_separateur", async () => {
  const texte = [
    "- un\n- deux\n  - sous\n\n3. trois\n4. quatre\n",
    "- [ ] à faire\n- [x] fait\n",
    "> Citation\n",
    "| A | B |\n|---|---|\n| `x` | y |\n| z | w |\n",
    "```rust\nfn main() {}\n```\n",
    "---\n",
    "Du <u>souligné</u>, ~~barré~~, *italique* et `code`.",
  ].join("\n");
  const def = md(texte);
  const types = def.content.map((c) => Object.keys(c).find((k) => ["ul", "ol", "table", "canvas", "text"].includes(k)));
  expect(types).toEqual(["ul", "ol", "ul", "table", "table", "table", "canvas", "text"]);
  expect(def.content[1].start).toBe(3);
  const taches = def.content[2].ul;
  expect(taches.every((t) => t.listType === "none")).toBe(true);
  expect(taches[0].columns[0].canvas).toHaveLength(1);
  expect(taches[1].columns[0].canvas).toHaveLength(2);
  expect(taches[1].columns[0].canvas[0].color).toBe("#005fb8");
  const citation = def.content[3].table.body[0][0];
  expect(citation.fillColor).toBe("#dbe9f5");
  expect(def.content[3].layout.vLineColor()).toBe("#005fb8");
  const tab = def.content[4].table;
  expect(tab.body[0][0].fillColor).toBe("#e4e6f1");
  expect(tab.body[2][0].fillColor).toBe("#f0f0f3");
  expect(tab.body[1][0].fillColor).toBeUndefined();
  expect(def.content[4].layout.hLineColor()).toBe("#8a8a8a");
  expect(def.content[5].table.body[0][0].fillColor).toBe("#f0f0f3");
  const ligne = def.content[7].text;
  expect(ligne.find((r) => r.text === "souligné").decoration).toEqual(["underline"]);
  expect(ligne.find((r) => r.text === "barré").decoration).toEqual(["lineThrough"]);
  expect(ligne.find((r) => r.text === "italique").italics).toBe(true);
  const code = ligne.find((r) => r.text === "code");
  expect([code.font, code.fontSize, code.background]).toEqual(["JetBrainsMono", 9.75, "#f0f0f3"]);
  const pdf = await produire(def);
  expect(nbPages(pdf)).toBe(1);
});
