import pdfMake from "pdfmake/build/pdfmake.js";
import helvetica from "pdfmake/build/standard-fonts/Helvetica.js";

// Chargé à part, au premier export (DEC-115) : `window.yaidePdf.produire(definition, nom)` → `Blob`.
pdfMake.addFontContainer(helvetica);
pdfMake.setUrlAccessPolicy(() => false);

const FICHIER_CODE = "JetBrainsMono-Regular.ttf";
const CODE = { normal: FICHIER_CODE, bold: FICHIER_CODE, italics: FICHIER_CODE, bolditalics: FICHIER_CODE };
const IDEOGRAMMES = "NotoSansSC-Regular.ttf";
const chargees = new Set();

async function charger(fichier) {
  if (chargees.has(fichier)) return;
  const r = await fetch(`/polices/${fichier}`).catch(() => {
    throw new Error("connexion perdue");
  });
  if (!r.ok) throw new Error(`la police ${fichier} n'a pas pu être chargée`);
  pdfMake.sharedVirtualfs.writeFileSync(fichier, new Uint8Array(await r.arrayBuffer()));
  chargees.add(fichier);
}

/** PDF de `definition` (voir `export-pdf.js`) en `Blob`. `nom` sert aux messages d'erreur. */
async function produire(definition, nom) {
  const { ideogrammes, ...doc } = definition;
  const fonts = { JetBrainsMono: CODE };
  await charger(FICHIER_CODE);
  if (ideogrammes) {
    await charger(IDEOGRAMMES);
    fonts.NotoSansSC = { normal: IDEOGRAMMES, bold: IDEOGRAMMES, italics: IDEOGRAMMES, bolditalics: IDEOGRAMMES };
  }
  pdfMake.addFonts(fonts);
  try {
    return await pdfMake.createPdf(doc).getBlob();
  } catch (e) {
    throw new Error(`${nom} : ${e.message}`);
  }
}

window.yaidePdf = { produire };
