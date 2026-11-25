import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

const LONG = "Annoncer la version sur le forum, avec le lien vers le changelog, la liste des nouveautés et un merci à chaque contributeur du mois, sans oublier les relecteurs, les testeurs et toutes les personnes qui ont signalé des défauts pendant la préparation de cette version, ainsi que celles et ceux qui ont relu la documentation";

// Plan de P-139 écrit avec `pas` espaces par niveau.
function plan(pas) {
  const e = (n) => " ".repeat(pas * n);
  return [
    "# Plan",
    "",
    "## Étapes",
    "",
    "- Préparer la version",
    `${e(1)}- Mettre à jour le changelog`,
    `${e(2)}- Relire les entrées de novembre`,
    `${e(3)}- Vérifier les liens`,
    `${e(1)}- Lancer les tests`,
    `${e(2)}1. Tests unitaires`,
    `${" ".repeat(pas * 3 + (pas === 2 ? 1 : 0))}- Cas de la coupure`,
    `${e(2)}2. Tests de bout en bout`,
    "- Publier",
    `${e(1)}- ${LONG}`,
    `${e(1)}- [ ] Mettre à jour le site`,
    "",
    "Fin",
    "",
  ].join("\n");
}

// Étiquette → [niveau, signe attendu en mode hybride, `list-style-type` dans l'aperçu]
const ATTENDU = {
  "Préparer la version": [1, "•", "disc"],
  "Mettre à jour le changelog": [2, "◦", "circle"],
  "Relire les entrées de novembre": [3, "▪", "square"],
  "Vérifier les liens": [4, "•", "disc"],
  "Lancer les tests": [2, "◦", "circle"],
  "Tests unitaires": [3, null, "decimal"],
  "Cas de la coupure": [4, "•", "disc"],
  "Tests de bout en bout": [3, null, "decimal"],
  Publier: [1, "•", "disc"],
  "Annoncer la version sur le forum": [2, "◦", "circle"],
  "Mettre à jour le site": [2, "case", "circle"],
};

const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Mesures d'un texte dans l'éditeur (`.cm-content`) ou dans l'aperçu : abscisse de son début, rangées, couleur de sa puce.
function mesurer(page, etiquette, hybride) {
  return page.evaluate(
    ([t, hy]) => {
      const racine = [...document.querySelectorAll(hy ? ".cm-content" : ".zone-code-apercu")].find((e) => e.getClientRects().length);
      const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
      let noeud = null;
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.includes(t) && !n.parentElement.closest("[aria-hidden]")) { noeud = n; break; }
      if (!noeud) return null;
      const r = document.createRange();
      r.setStart(noeud, noeud.data.indexOf(t));
      r.setEnd(noeud, noeud.data.length);
      const rects = [...r.getClientRects()];
      const rangees = [...new Set(rects.map((x) => Math.round(x.top)))].map((top) => Math.min(...rects.filter((x) => Math.round(x.top) === top).map((x) => x.left)));
      const sortie = { debut: rangees[0], rangees };
      if (hy) {
        const ligne = noeud.parentElement.closest(".cm-line");
        sortie.hauteur = ligne.getBoundingClientRect().height;
        sortie.couleurLigne = getComputedStyle(ligne).color;
        const p = ligne.querySelector(".cm-hy-puce");
        if (p) {
          const pr = document.createRange();
          pr.selectNodeContents(p);
          const b = pr.getBoundingClientRect();
          const cs = getComputedStyle(p);
          sortie.puce = { signe: p.textContent, aria: p.getAttribute("aria-hidden"), police: cs.fontFamily, taille: cs.fontSize, couleur: cs.color, centre: b.left + b.width / 2 };
        }
        sortie.case = !!ligne.querySelector("input.ya-case-hy");
        const num = ligne.querySelector(".cm-hy-numero");
        if (num) sortie.numero = getComputedStyle(num).color;
        sortie.texteLigne = ligne.textContent;
      } else {
        const li = noeud.parentElement.closest("li");
        sortie.type = getComputedStyle(li.parentElement).listStyleType;
        sortie.marqueur = getComputedStyle(li, "::marker").color;
        sortie.couleurLi = getComputedStyle(li).color;
      }
      return sortie;
    },
    [etiquette, hybride],
  );
}

const curseurSur = (page, motif, fin = true) =>
  page.evaluate(
    ([m, f]) => {
      const v = [...document.querySelectorAll(".zone-code")].find((e) => e.getClientRects().length).vue;
      const i = v.state.doc.toString().indexOf(m);
      const l = v.state.doc.lineAt(i);
      v.dispatch({ selection: { anchor: f ? l.to : l.from } });
    },
    [motif, fin],
  );

async function ouvrir(page, nom, pas) {
  await page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne(nom) }).click();
  await expect(page.getByRole("button", { name: "Mode hybride", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate((p) => [...document.querySelectorAll(".zone-code")].find((e) => e.getClientRects().length)?.vue.state.doc.toString().includes(`\n${" ".repeat(p)}- Mettre à jour le changelog`), pas))
    .toBe(true);
  await expect(page.locator(".cm-content:visible .cm-line", { hasText: "Tests unitaires" }).first()).toBeVisible();
  const apercu = page.getByRole("region", { name: "Aperçu" });
  const bouton = page.getByRole("button", { name: "Aperçu", exact: true });
  if ((await bouton.getAttribute("aria-pressed")) !== "true") await bouton.click();
  await expect(apercu).toBeVisible();
  await curseurSur(page, "Fin");
  await expect(page.locator(".zone-code-apercu:visible", { hasText: "Tests unitaires" })).toBeVisible();
}

test("REQ178_AC1_AC3_AC4_AC5_AC6_AC7_AC8_AC10_AC11_parcours_139_listes_imbriquees", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "notes.md"), plan(2));
  fs.writeFileSync(path.join(dossier, "plan.md"), plan(4));
  const yaide = await lancerYaide({ dossier });
  try {
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    const etiquettes = Object.keys(ATTENDU);
    const resultats = {};
    for (const [fichier, pas] of [["notes.md", 2], ["plan.md", 4]]) {
      await ouvrir(page, fichier, pas);
      const hy = {};
      const ap = {};
      for (const t of etiquettes) {
        hy[t] = await mesurer(page, t, true);
        ap[t] = await mesurer(page, t, false);
        expect(hy[t], `${fichier} hybride ${t}`).not.toBeNull();
        expect(ap[t], `${fichier} aperçu ${t}`).not.toBeNull();
      }
      resultats[pas] = { hy, ap };
      const [x1h, x1a] = [hy["Préparer la version"].debut, ap["Préparer la version"].debut];
      for (const [t, [niveau, signe, type]] of Object.entries(ATTENDU)) {
        // AC-178-1 : puce de l'aperçu ; AC-178-3 : « 1. » gardé ; AC-178-2 : puce du mode hybride.
        expect(ap[t].type, `${fichier} aperçu ${t}`).toBe(type);
        if (signe === null) expect(hy[t].texteLigne).toMatch(/^\d\. /);
        else if (signe === "case") {
          expect(hy[t].case).toBe(true);
          expect(hy[t].puce).toBeUndefined();
        } else {
          expect(hy[t].puce.signe, `${fichier} hybride ${t}`).toBe(signe);
          expect(hy[t].texteLigne).not.toContain("-");
          expect(hy[t].texteLigne).toBe(`${signe}${t}${t === "Annoncer la version sur le forum" ? LONG.slice(t.length) : ""}`);
        }
        // AC-178-5 : pas de 24 px par niveau, le même dans les deux modes.
        expect(Math.abs(hy[t].debut - x1h - (niveau - 1) * 24), `${fichier} hybride ${t}`).toBeLessThanOrEqual(2);
        expect(Math.abs(ap[t].debut - x1a - (niveau - 1) * 24), `${fichier} aperçu ${t}`).toBeLessThanOrEqual(2);
        // AC-178-11 : puce en JetBrains Mono 18 px, centre de 6 à 14 px avant le texte, ligne de 21 px.
        if (signe && signe !== "case") {
          expect(hy[t].puce.aria).toBe("true");
          expect(hy[t].puce.police).toContain("JetBrains Mono");
          expect(hy[t].puce.taille).toBe("18px");
          const d = hy[t].debut - hy[t].puce.centre;
          expect(d, `${fichier} ${t}`).toBeGreaterThanOrEqual(6);
          expect(d, `${fichier} ${t}`).toBeLessThanOrEqual(14);
        }
        if (t !== "Annoncer la version sur le forum") expect(Math.abs(hy[t].hauteur - 21), `${fichier} ${t}`).toBeLessThanOrEqual(0.5);
      }
      // AC-178-6 : 300 caractères au niveau 2, plusieurs rangées sous un seul numéro, suite sous le début du texte.
      const long = hy["Annoncer la version sur le forum"];
      expect(LONG.length).toBeGreaterThanOrEqual(300);
      expect(long.rangees.length).toBeGreaterThanOrEqual(2);
      for (const x of long.rangees.slice(1)) expect(Math.abs(x - long.debut)).toBeLessThanOrEqual(2);
      expect(await page.locator(".cm-content:visible .cm-line", { hasText: "Annoncer la version" }).count()).toBe(1);

      // AC-178-7 : curseur sur « Mettre à jour le changelog » : marques visibles, bord gauche au retrait du niveau 2.
      const bord = () =>
        page.evaluate(() => {
          const l = [...document.querySelectorAll(".cm-content:not([hidden]) .cm-line")].filter((x) => x.getClientRects().length).find((x) => x.textContent.includes("Mettre à jour le changelog"));
          const r = document.createRange();
          r.selectNodeContents(l);
          return { gauche: r.getClientRects()[0].left, texte: l.textContent, marque: [...l.querySelectorAll(".cm-hy-marque")].map((x) => [x.textContent, getComputedStyle(x).color]) };
        });
      const avant = await bord();
      await curseurSur(page, "Mettre à jour le changelog");
      await expect(page.locator(".cm-content:visible .cm-line", { hasText: "Mettre à jour le changelog" })).toContainText("- Mettre");
      const dessus = await bord();
      expect(dessus.texte).toBe(`${" ".repeat(pas)}- Mettre à jour le changelog`);
      expect(dessus.marque.some(([t]) => t === "-")).toBe(true);
      expect(dessus.marque.every(([, c]) => c === "rgb(160, 160, 160)")).toBe(true);
      expect(Math.abs(dessus.gauche - avant.gauche)).toBeLessThanOrEqual(2);
      await curseurSur(page, "Fin");
      await expect(page.locator(".cm-content:visible .cm-line", { hasText: "Mettre à jour le changelog" })).not.toContainText("-");
      expect((await mesurer(page, "Mettre à jour le changelog", true)).puce.signe).toBe("◦");
    }
    // AC-178-4 : 2 ou 4 espaces par niveau, mêmes retraits et mêmes puces, dans les deux modes.
    for (const t of etiquettes) {
      for (const mode of ["hy", "ap"]) {
        const [a, b] = [resultats[2][mode], resultats[4][mode]];
        expect(Math.abs(a[t].debut - a["Préparer la version"].debut - (b[t].debut - b["Préparer la version"].debut)), t).toBeLessThanOrEqual(0.5);
      }
      expect(resultats[4].hy[t].puce?.signe).toBe(resultats[2].hy[t].puce?.signe);
    }
    // Aperçu et mode hybride à 2 px près, d'un mode à l'autre.
    for (const t of etiquettes) {
      const h = resultats[2].hy[t].debut - resultats[2].hy["Préparer la version"].debut;
      const a = resultats[2].ap[t].debut - resultats[2].ap["Préparer la version"].debut;
      expect(Math.abs(h - a), t).toBeLessThanOrEqual(2);
    }

    // AC-178-10 et AC-178-8 (sans réglage) : puces en --ink-muted, « 1. » en --ink, contraste 3:1, dans les deux thèmes.
    const fond = () => page.evaluate(() => { const s = document.createElement("span"); s.style.backgroundColor = "var(--bg-200)"; document.body.append(s); const v = getComputedStyle(s).backgroundColor; s.remove(); return v; });
    await ouvrir(page, "notes.md", 2);
    for (const [theme, muted, ink] of [["sombre", "rgb(160, 160, 160)", "rgb(204, 204, 204)"], ["clair", "rgb(92, 92, 92)", "rgb(31, 31, 31)"]]) {
      if (theme === "clair") await page.getByRole("button", { name: "Thème clair" }).click();
      await expect.poll(async () => (await mesurer(page, "Préparer la version", true)).puce.couleur, theme).toBe(muted);
      const bg = await fond();
      for (const t of ["Préparer la version", "Mettre à jour le changelog", "Relire les entrées de novembre", "Vérifier les liens"]) {
        const [h, a] = [await mesurer(page, t, true), await mesurer(page, t, false)];
        expect(h.puce.couleur, `${theme} ${t}`).toBe(muted);
        expect(a.marqueur, `${theme} ${t}`).toBe(muted);
        expect(contraste(h.puce.couleur, bg)).toBeGreaterThanOrEqual(3);
        expect(contraste(a.marqueur, bg)).toBeGreaterThanOrEqual(3);
      }
      const num = await mesurer(page, "Tests unitaires", false);
      expect(num.marqueur).toBe(num.couleurLi);
      expect(num.marqueur).toBe(ink);
      expect((await mesurer(page, "Tests unitaires", true)).numero).toBe(ink);
    }

    // AC-178-8 (réglage) : `puce` orange écrit en fin de parcours, quatre niveaux, dans les deux modes et les deux thèmes.
    fs.mkdirSync(path.join(dossier, ".yaide"), { recursive: true });
    fs.writeFileSync(path.join(dossier, ".yaide", "markdown.json"), "{}");
    await page.keyboard.press("Control+p");
    const champ = page.getByRole("textbox", { name: "Chemin du fichier" });
    await champ.fill("markdown.json");
    await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(1);
    await champ.press("Enter");
    await expect(page.getByRole("textbox", { name: "Éditeur markdown.json" })).toBeFocused();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(JSON.stringify({ sombre: { puce: { couleur: "#ff8800" } }, clair: { puce: { couleur: "#ff8800" } } }));
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(path.join(dossier, ".yaide", "markdown.json"), "utf8")).toContain("#ff8800");
    // Le réglage se prend au rechargement de la page (comme REQ-115).
    await page.reload();
    await page.getByRole("tab", { name: nomLigne("notes.md") }).click();
    await curseurSur(page, "Fin");
    for (const t of ["Préparer la version", "Mettre à jour le changelog", "Relire les entrées de novembre", "Vérifier les liens"]) {
      await expect.poll(async () => (await mesurer(page, t, true)).puce.couleur, t).toBe("rgb(255, 136, 0)");
      expect((await mesurer(page, t, false)).marqueur, t).toBe("rgb(255, 136, 0)");
    }
  } finally {
    await yaide.arreter();
  }
});
