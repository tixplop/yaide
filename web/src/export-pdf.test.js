// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "vitest";
import { definitionTexte, morceaux, nomPdf } from "./export-pdf.js";

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
