import { test, expect } from "@playwright/test";
import { lancerYaide, ouvrirYaide } from "./aides.js";

// REQ-122 AC-122-2 : mermaid dessine sous la CSP de Yaide (`script-src 'self'`, sans `unsafe-eval`).
test("REQ122_AC2_mermaid_dessine_sous_la_csp", async ({ page }) => {
  const yaide = await lancerYaide();
  try {
    const erreurs = [];
    page.on("console", (m) => m.type() === "error" && erreurs.push(m.text()));
    page.on("pageerror", (e) => erreurs.push(String(e)));
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    erreurs.length = 0;
    await page.evaluate(() => {
      window.violations = [];
      document.addEventListener("securitypolicyviolation", (e) => window.violations.push(e.violatedDirective));
    });
    await page.evaluate(
      () =>
        new Promise((ok, ko) => {
          const s = document.createElement("script");
          s.src = "/mermaid.js";
          s.onload = ok;
          s.onerror = () => ko(new Error("mermaid.js refusé"));
          document.head.append(s);
        }),
    );
    const dessins = await page.evaluate(async () => {
      const textes = {
        flux: "graph TD; A[Début] --> B[Fin]",
        sequence: "sequenceDiagram\nA->>B: Salut",
        classes: "classDiagram\nclass Animal",
        etats: "stateDiagram-v2\n[*] --> Actif",
        gantt: "gantt\ndateFormat YYYY-MM-DD\nsection S\nTâche :a1, 2024-01-01, 3d",
        pie: 'pie title Parts\n"A" : 40\n"B" : 60',
        faux: "graph TD; A[Début -->",
      };
      const r = {};
      for (const [k, t] of Object.entries(textes)) r[k] = await window.yaideMermaid.dessiner(t);
      r.restes = document.querySelectorAll('[id*="yaide-mermaid"]').length;
      return r;
    });
    for (const k of ["flux", "sequence", "classes", "etats", "gantt", "pie"]) {
      const d = dessins[k];
      expect(d, k).not.toBeNull();
      expect(d.svg).not.toContain("<foreignObject");
      expect(d.svg).not.toContain("<script");
    }
    const f = dessins.flux;
    expect(f.svg).toContain("Début");
    expect(f.svg).toContain("Fin");
    const vue = /viewBox="([^"]+)"/.exec(f.svg)[1].split(/\s+/).map(Number);
    expect(f.largeur).toBe(Math.ceil(vue[2]));
    expect(f.hauteur).toBe(Math.ceil(vue[3]));
    expect(f.svg).toMatch(new RegExp(`<svg width="${f.largeur}" height="${f.hauteur}"`));
    expect(f.svg.slice(0, f.svg.indexOf(">"))).not.toMatch(/max-width|style=/);
    expect(dessins.faux).toBeNull();
    expect(dessins.restes).toBe(0);
    expect(await page.evaluate(() => window.violations)).toEqual([]);
    expect(erreurs).toEqual([]);
  } finally {
    await yaide.arreter();
  }
});
