import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

// P-090 et P-091 : parcours dans le navigateur.
const ecrire = (dossier, f, contenu) => {
  fs.mkdirSync(path.dirname(path.join(dossier, f)), { recursive: true });
  fs.writeFileSync(path.join(dossier, f), contenu);
};
const ligne = (page, nom) => page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne(nom) });
const boite = (el) => el.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const proche = (a, b, pres = 1) => expect(Math.abs(a - b)).toBeLessThanOrEqual(pres);
const fond = (el) => el.evaluate((e) => getComputedStyle(e).backgroundColor);
const BLANC = "rgb(255, 255, 255)";
/** Texte du dessin : l'adresse `data:` de l'`img`, décodée. */
const texteDessin = (img) => img.evaluate((i) => decodeURIComponent(i.src.replace(/^data:[^,]*,/, "")).replace(/<style>.*?<\/style>/gs, "").replace(/<[^>]+>/g, ""));
const largeurNaturelle = (img) => img.evaluate((i) => i.naturalWidth);
const NOEUDS_30 = "graph LR\n" + Array.from({ length: 29 }, (_, i) => `  N${i}[Noeud ${i}] --> N${i + 1}[Noeud ${i + 1}]`).join("\n") + "\n";
const ACTIF =
  'graph TD\n  A[<img src=https://exemple.org/x.png onerror=window.__x=1>] --> B[<script>window.__s=1</script>]\n  click A "https://exemple.org"\n  click B appel\n';
const ARCHITECTURE = [
  "# Architecture",
  "",
  "Le schéma ci-dessous montre les pièces.",
  "",
  "## Vue d'ensemble",
  "",
  "```mermaid",
  "graph TD",
  "  N[Navigateur] --> S[Serveur yaide]",
  "  S --> F[Fichiers du projet]",
  "  S --> T[Shells]",
  "```",
  "",
  "Fin.",
  "",
].join("\n");

test("REQ122_AC1_AC2_AC3_AC4_AC6_AC8_AC9_REQ152_AC1_AC3_AC5_AC6_AC8_AC9_AC10_AC11_parcours_P090_diagramme_dans_editeur_et_apercu_markdown", async ({ page }) => {
  const dossier = depotExemple();
  ecrire(dossier, "docs/architecture.md", ARCHITECTURE);
  ecrire(dossier, "docs/brouillon.md", "# Brouillon\n\n```mermaid\ngraph TD; A[Début -->\n```\n");
  ecrire(dossier, "docs/actif.md", "# Actif\n\n```mermaid\n" + ACTIF + "```\n");
  ecrire(dossier, "docs/grand.md", "# Grand\n\n```mermaid\n" + NOEUDS_30 + "```\n");
  ecrire(dossier, "docs/petit.md", "# Petit\n\n```mermaid\ngraph TD; A --> B\n```\n");
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const requetes = [];
    page.on("request", (r) => /^https?:/.test(r.url()) && requetes.push(r.url()));
    const erreurs = [];
    page.on("console", (m) => m.type() === "error" && erreurs.push(m.text()));
    page.on("pageerror", (e) => erreurs.push(String(e)));
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    // AC-122-2 : mermaid dessine sous la CSP de Yaide (`script-src 'self'`, sans `unsafe-eval`).
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

    await ligne(page, "docs").click();
    const apercu = page.locator('[role="region"][aria-label="Aperçu"]:visible');
    const dessin = apercu.getByRole("img", { name: "Diagramme" });
    const bouton = page.getByRole("button", { name: "Aperçu", exact: true });
    const editeur = (nom) => page.getByRole("textbox", { name: `Éditeur ${nom}` });
    const ouvrir = async (nom) => {
      await ligne(page, nom).click();
      await expect(editeur(nom)).toBeFocused();
      if ((await bouton.getAttribute("aria-pressed")) !== "true") await bouton.click();
    };

    // P-090 étape 1 (REQ-152, AC-152-1 et AC-152-9, AC-152-11) : mode hybride, aperçu masqué, le diagramme est dans l'éditeur.
    const pied = page.getByText(/Ln \d+, Col \d+/);
    const dansEditeur = page.locator(".cm-content:visible").getByRole("img", { name: "Diagramme" });
    const numeros = async () => (await page.locator(".cm-lineNumbers:visible .cm-gutterElement").allTextContents()).slice(1).map((t) => t.trim()).filter((t) => /^\d+$/.test(t));
    const numero = (n) => page.locator(".cm-lineNumbers:visible .cm-gutterElement").filter({ hasText: new RegExp(`^${n}$`) });
    const onglet = page.locator("[role=tab][data-modifie]");
    await ligne(page, "architecture.md").click();
    await expect(editeur("architecture.md")).toBeFocused();
    await expect(page.getByRole("button", { name: "Mode hybride", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(bouton).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[role="region"][aria-label="Aperçu"]:visible')).toHaveCount(0);
    await expect(dansEditeur).toBeVisible();
    expect(await texteDessin(dansEditeur)).toContain("Navigateur");
    expect(await texteDessin(dansEditeur)).toContain("Shells");
    await expect(page.locator(".cm-content:visible")).not.toContainText("graph TD");
    await expect(page.locator(".cm-content:visible")).not.toContainText("```");
    await expect(pied).toContainText("Ln 1, Col 1");
    expect(await fond(dansEditeur)).toBe(BLANC);
    expect(await numeros()).toEqual(["1", "2", "3", "4", "5", "6", "7", "13", "14", "15"]);
    // Le haut du texte du numéro 7 (pas de sa case, dont le padding ne déplace pas le bord) est celui de l'image, à 1 px près.
    const num7 = await boite(numero(7));
    const hautTexte = await numero(7).evaluate((e) => {
      const r = document.createRange();
      r.selectNodeContents(e.firstChild);
      return r.getBoundingClientRect().top;
    });
    const hautDiagramme = (await boite(dansEditeur)).y;
    const caseDe = await numero(7).evaluate((e) => parseFloat(getComputedStyle(e).paddingTop));
    const decalage = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-1")));
    expect(caseDe).toBe(decalage);
    expect(decalage).toBeGreaterThan(0);
    // Sans le décalage, le texte serait `decalage` plus haut que l'image : ici il est en face de son haut.
    expect(hautTexte - hautDiagramme).toBeLessThanOrEqual(decalage + 1);
    expect(hautTexte - hautDiagramme).toBeGreaterThanOrEqual(decalage - 1 - 2);
    const hautBloc = num7.y;

    // Étape 2 (AC-152-5) : un clic sur le diagramme place le curseur au début de la ligne 8, le haut du bloc ne bouge pas.
    const nOnglets = await page.getByRole("tab").count();
    await dansEditeur.click();
    await expect(pied).toContainText("Ln 8, Col 1");
    await expect(dansEditeur).toHaveCount(0);
    await expect(page.locator(".cm-content:visible")).toContainText("graph TD");
    proche((await boite(numero(7))).y, hautBloc);
    expect(await page.getByRole("tab").count()).toBe(nOnglets);
    expect(page.context().pages()).toHaveLength(1);

    // Étape 3 (AC-152-3) : la frappe garde le bloc en texte ; l'onglet est modifié, le disque non.
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("  S --> A[Agents]");
    await expect(dansEditeur).toHaveCount(0);
    await expect(onglet).toHaveCount(1);
    expect(fs.readFileSync(path.join(dossier, "docs/architecture.md"), "utf8")).toBe(ARCHITECTURE);

    // Étape 4 : clic au bout de la ligne 15, le diagramme revient en moins de 1 s avec « Agents », sans Ctrl+S ; puis Ctrl+S.
    await page.locator(".cm-line").filter({ hasText: /^Fin\.$/ }).click();
    await page.keyboard.press("End");
    await expect(pied).toContainText("Ln 15, Col 5");
    await expect.poll(() => dansEditeur.count().then((n) => (n ? texteDessin(dansEditeur) : "")), { timeout: 1000 }).toContain("Agents");
    expect(fs.readFileSync(path.join(dossier, "docs/architecture.md"), "utf8")).toBe(ARCHITECTURE);
    const srcEditeur = await dansEditeur.getAttribute("src");
    await page.keyboard.press("Control+s");
    await expect(onglet).toHaveCount(0);
    const ecrit = fs.readFileSync(path.join(dossier, "docs/architecture.md"), "utf8");
    expect(ecrit).toContain("  S --> A[Agents]");
    expect(await dansEditeur.getAttribute("src")).toBe(srcEditeur);

    // AC-152-5, clavier : Haut depuis la ligne sous le bloc entre sur la clôture de fin ; Bas depuis la ligne au-dessus, sur la ligne mermaid.
    await page.keyboard.press("ArrowUp");
    await expect(pied).toContainText("Ln 14, Col 1");
    await expect(dansEditeur).toHaveCount(1);
    await page.keyboard.press("ArrowUp");
    await expect(pied).toContainText("Ln 13, Col 1");
    await expect(dansEditeur).toHaveCount(0);
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
    await expect(pied).toContainText("Ln 6, Col 1");
    await expect(dansEditeur).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await expect(pied).toContainText("Ln 7, Col 1");
    await expect(dansEditeur).toHaveCount(0);
    await page.keyboard.press("Control+End");
    await expect(dansEditeur).toHaveCount(1);

    // Étape 5 (AC-152-8) : avec l'aperçu, l'éditeur et l'aperçu montrent chacun leur diagramme.
    await bouton.click();
    await expect(bouton).toBeFocused();
    await expect(dessin).toBeVisible();
    await expect(dansEditeur).toBeVisible();
    expect(await texteDessin(dansEditeur)).toContain("Agents");
    expect(await texteDessin(dessin)).toContain("Agents");

    // AC-122-1 : le diagramme remplace le bloc.
    await expect(dessin).toBeVisible();
    const t0 = await texteDessin(dessin);
    expect(t0).toContain("Navigateur");
    expect(t0).toContain("Shells");
    await expect(apercu).not.toContainText("graph TD");
    await expect(apercu.locator("pre")).toHaveCount(0);

    // AC-122-9 : fond blanc dans les deux thèmes, taille inchangée.
    expect(await fond(dessin)).toBe(BLANC);
    const avant = await boite(dessin);
    const avantEd = await boite(dansEditeur);
    const srcAvant = await dessin.getAttribute("src");
    const srcAvantEd = await dansEditeur.getAttribute("src");
    await page.getByRole("button", { name: "Thème clair" }).click();
    expect(await fond(dessin)).toBe(BLANC);
    // AC-152-11 : même chose pour le diagramme de l'éditeur.
    expect(await fond(dansEditeur)).toBe(BLANC);
    expect(await dansEditeur.getAttribute("src")).toBe(srcAvantEd);
    const apresEd = await boite(dansEditeur);
    proche(apresEd.w, avantEd.w);
    proche(apresEd.h, avantEd.h);
    expect(await dessin.getAttribute("src")).toBe(srcAvant);
    const apres = await boite(dessin);
    proche(apres.w, avant.w);
    proche(apres.h, avant.h);
    await page.getByRole("button", { name: "Thème clair" }).click();

    // AC-122-3 : « Suite » en moins de 1 s, sans Ctrl+S ; le disque ne change pas (la partie « pendant une coupure » : apercu.test.js, REQ122_AC3_nouveau_dessin_contenant_Suite_pendant_une_coupure_sans_aucune_requete).
    await editeur("architecture.md").click();
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("S --> Z[Suite]");
    await expect.poll(() => texteDessin(dessin), { timeout: 1000 }).toContain("Suite");
    expect(fs.readFileSync(path.join(dossier, "docs/architecture.md"), "utf8")).toBe(ecrit);

    // AC-122-4 : un bloc jamais lisible reste en code, texte exact, sans message.
    erreurs.length = 0;
    await ouvrir("brouillon.md");
    await expect(apercu.locator("pre")).toHaveText("graph TD; A[Début -->\n");
    await page.waitForTimeout(600);
    await expect(apercu.locator("pre")).toHaveText("graph TD; A[Début -->\n");
    await expect(dessin).toHaveCount(0);
    await expect(dansEditeur).toHaveCount(0);
    await expect(page.locator(".cm-content:visible")).toContainText("graph TD; A[Début -->");
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    expect(erreurs).toEqual([]);

    // AC-122-6 : rien ne s'exécute, aucune requête externe, un clic n'ouvre rien.
    await ouvrir("actif.md");
    await expect(dessin).toBeVisible();
    await expect.poll(() => largeurNaturelle(dessin)).toBeGreaterThan(0);
    const url = page.url();
    const onglets = await page.getByRole("tab").count();
    await dessin.click();
    expect(page.url()).toBe(url);
    expect(page.context().pages()).toHaveLength(1);
    expect(await page.getByRole("tab").count()).toBe(onglets);
    expect(await page.evaluate(() => [window.__x, window.__s])).toEqual([undefined, undefined]);
    // AC-152-6 : même chose dans l'éditeur ; le clic y place le curseur, rien ne s'ouvre.
    await expect(dansEditeur).toBeVisible();
    await expect.poll(() => largeurNaturelle(dansEditeur)).toBeGreaterThan(0);
    await dansEditeur.click();
    expect(page.url()).toBe(url);
    expect(page.context().pages()).toHaveLength(1);
    expect(await page.getByRole("tab").count()).toBe(onglets);
    expect(await page.evaluate(() => [window.__x, window.__s])).toEqual([undefined, undefined]);

    // AC-122-8 : 30 nœuds réduits sans défilement en largeur ; un petit diagramme garde sa taille.
    await ouvrir("grand.md");
    await expect(dessin).toBeVisible();
    await expect.poll(() => largeurNaturelle(dessin)).toBeGreaterThan(0);
    const nat = await dessin.evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    const g = await boite(dessin);
    expect(g.w).toBeLessThan(nat.w);
    proche(g.w * (nat.h / nat.w), g.h);
    expect(await apercu.evaluate((e) => e.scrollWidth - e.clientWidth)).toBe(0);
    // AC-152-10 : de même dans l'éditeur, sans défilement en largeur.
    await expect(dansEditeur).toBeVisible();
    await expect.poll(() => largeurNaturelle(dansEditeur)).toBeGreaterThan(0);
    const natEd = await dansEditeur.evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    const gEd = await boite(dansEditeur);
    expect(gEd.w).toBeLessThan(natEd.w);
    proche(gEd.w * (natEd.h / natEd.w), gEd.h);
    expect(await page.locator(".cm-scroller:visible").evaluate((e) => e.scrollWidth - e.clientWidth)).toBe(0);
    await ouvrir("petit.md");
    await expect(dessin).toBeVisible();
    await expect.poll(() => largeurNaturelle(dessin)).toBeGreaterThan(0);
    const p = await boite(dessin);
    const np = await dessin.evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    proche(p.w, np.w);
    proche(p.h, np.h);
    await expect(dansEditeur).toBeVisible();
    await expect.poll(() => largeurNaturelle(dansEditeur)).toBeGreaterThan(0);
    const pEd = await boite(dansEditeur);
    const npEd = await dansEditeur.evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
    proche(pEd.w, npEd.w);
    proche(pEd.h, npEd.h);

    expect(requetes.filter((u) => new URL(u).origin !== yaide.origine)).toEqual([]);
  } finally {
    await yaide.arreter();
  }
});

test("REQ123_AC1_AC2_AC4_AC7_AC8_parcours_P091_fichier_mmd", async ({ page }) => {
  const dossier = depotExemple();
  const DEPLOIEMENT = "graph LR\nC[Commit] --> T{Tests}\nT -->|réussis| R[Release]\nT -->|échoués| X[Corriger]\n";
  ecrire(dossier, "docs/deploiement.mmd", DEPLOIEMENT);
  ecrire(dossier, "docs/actif.mmd", ACTIF);
  ecrire(dossier, "docs/grand.mmd", NOEUDS_30);
  const yaide = await lancerYaide({ dossier });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const requetes = [];
    page.on("request", (r) => /^https?:/.test(r.url()) && requetes.push(r.url()));
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await ligne(page, "docs").click();
    const apercu = page.locator('.ya-image[aria-label="Aperçu"]:visible');
    const img = apercu.locator("img");

    // AC-123-1 et AC-123-7 : ouverture, aperçu affiché, même largeur que l'éditeur, focus et barre d'état.
    await ligne(page, "deploiement.mmd").click();
    const editeur = page.getByRole("textbox", { name: "Éditeur deploiement.mmd" });
    await expect(editeur).toBeFocused();
    await expect(page.getByRole("button", { name: "Aperçu", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Mode hybride" })).toHaveCount(0);
    await expect(img).toBeVisible();
    const d0 = await texteDessin(img);
    expect(d0).toContain("Commit");
    expect(d0).toContain("Release");
    expect(await img.getAttribute("alt")).toBe("deploiement.mmd");
    expect(await apercu.evaluate((e) => e.querySelectorAll("a[href],button,input,select,textarea,[tabindex]").length + (e.hasAttribute("tabindex") ? 1 : 0))).toBe(0);
    proche((await boite(page.locator(".cm-editor:visible"))).w, (await boite(apercu)).w);
    await expect(page.getByText("Ln 1, Col 1")).toBeVisible();
    await expect(page.getByText("Texte", { exact: true })).toBeVisible();

    // AC-123-2 : « Mise à jour » en moins de 1 s, sans Ctrl+S ; l'onglet a son point, le disque ne change pas.
    await editeur.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("R --> M[Mise à jour]");
    await expect.poll(() => texteDessin(img), { timeout: 1000 }).toContain("Mise à jour");
    await expect(page.getByRole("tab", { name: /^deploiement\.mmd(, [^,]+)*, non sauvegardé/ })).toBeVisible();
    expect(fs.readFileSync(path.join(dossier, "docs/deploiement.mmd"), "utf8")).toBe(DEPLOIEMENT);

    // AC-123-8 : entier, proportions gardées, fond blanc dans les deux thèmes.
    const verifier = async () => {
      const nat = await img.evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
      const b = await boite(img);
      const a = await boite(apercu);
      proche(b.w * (nat.h / nat.w), b.h);
      expect(b.x).toBeGreaterThanOrEqual(a.x - 1);
      expect(b.x + b.w).toBeLessThanOrEqual(a.x + a.w + 1);
      expect(b.y).toBeGreaterThanOrEqual(a.y - 1);
      expect(b.y + b.h).toBeLessThanOrEqual(a.y + a.h + 1);
      expect(await fond(img)).toBe(BLANC);
    };
    await verifier();

    await ligne(page, "grand.mmd").click();
    await expect(page.getByRole("textbox", { name: "Éditeur grand.mmd" })).toBeFocused();
    await expect(img).toHaveAttribute("alt", "grand.mmd");
    await expect.poll(() => largeurNaturelle(img)).toBeGreaterThan(0);
    const nat = await img.evaluate((i) => i.naturalWidth);
    expect((await boite(img)).w).toBeLessThan(nat);
    await verifier();
    await page.getByRole("button", { name: "Thème clair" }).click();
    await verifier();

    // AC-123-4 : rien ne s'exécute, aucune requête externe, un clic n'ouvre rien.
    await ligne(page, "actif.mmd").click();
    await expect(page.getByRole("textbox", { name: "Éditeur actif.mmd" })).toBeFocused();
    await expect(img).toHaveAttribute("alt", "actif.mmd");
    await expect.poll(() => largeurNaturelle(img)).toBeGreaterThan(0);
    const url = page.url();
    const onglets = await page.getByRole("tab").count();
    await img.click();
    expect(page.url()).toBe(url);
    expect(page.context().pages()).toHaveLength(1);
    expect(await page.getByRole("tab").count()).toBe(onglets);
    expect(await page.evaluate(() => [window.__x, window.__s])).toEqual([undefined, undefined]);
    expect(requetes.filter((u) => new URL(u).origin !== yaide.origine)).toEqual([]);
  } finally {
    await yaide.arreter();
  }
});
