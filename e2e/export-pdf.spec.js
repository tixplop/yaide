import { test, expect } from "@playwright/test";
import { lancerYaide, ouvrirYaide, depotExemple } from "./aides.js";

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
