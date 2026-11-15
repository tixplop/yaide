import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

const README = [
  "# Titre",
  "",
  "## Sous-titre",
  "",
  "### Section",
  "",
  "#### Quatre [ancre](https://exemple.org)",
  "",
  "Un paragraphe avec **gras**, *italique*, un [lien](https://exemple.org) et `code`.",
  "",
  "- un élément",
  "",
  "> une citation",
  "",
  "```rust",
  "fn main() {}",
  "```",
  "",
  "Fin",
  "",
].join("\n");

const REGLAGES = {
  sombre: { lien: { couleur: "#e0a0ff" }, titre1: { couleur: "#ff8800" }, titre2: { couleur: "#00aa55" }, citation: { fond: "#202830", bordure: "#4488ff" }, bloc_code: { fond: "#101820" } },
  clair: { titre1: { couleur: "#a04000" } },
};

test("REQ115_AC2_AC3_AC5_AC6_AC8_parcours_83_couleurs_du_rendu_markdown", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "README.md"), README);
  fs.mkdirSync(path.join(dossier, ".yaide"));
  fs.writeFileSync(path.join(dossier, ".yaide", "markdown.json"), JSON.stringify(REGLAGES));
  const yaide = await lancerYaide({ dossier });
  try {
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await page.getByRole("tree", { name: "Fichiers" }).getByRole("treeitem", { name: nomLigne("README.md") }).click();
    await expect(page.getByRole("button", { name: "Mode hybride", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    const apercu = page.getByRole("region", { name: "Aperçu" });
    await expect(apercu).toBeVisible();
    const editeur = page.locator(".cm-content:visible");
    await editeur.click();
    await page.keyboard.press("Control+End");
    await expect(editeur.locator(".cm-line.cm-hy-titre1")).toHaveText("Titre");

    const couleur = (loc, propriete = "color") => loc.evaluate((e, p) => getComputedStyle(e)[p], propriete);
    // Couleur du texte visible : celle de l'élément parent du nœud texte qui porte les caractères.
    const couleurTexte = (loc, texte) =>
      loc.evaluate((e, t) => {
        const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.includes(t)) return getComputedStyle(n.parentElement).color;
        return null;
      }, texte);
    // Valeur calculée d'un token du thème affiché.
    const token = (nom, propriete = "color") =>
      page.evaluate(([n, p]) => {
        const s = document.createElement("span");
        s.style[p] = `var(${n})`;
        document.body.append(s);
        const v = getComputedStyle(s)[p];
        s.remove();
        return v;
      }, [nom, propriete]);
    const l = (classe) => editeur.locator(`.cm-line.${classe}`);
    const bloc = l("cm-hy-bloc-code").filter({ hasText: "fn main" });
    const pre = apercu.locator("pre");
    const citation = apercu.locator("blockquote");

    // Sombre : couleurs réglées, dans l'éditeur (hors ligne du curseur) et dans l'aperçu.
    expect(await couleur(l("cm-hy-titre1"))).toBe("rgb(255, 136, 0)");
    expect(await couleurTexte(l("cm-hy-titre1"), "Titre")).toBe("rgb(255, 136, 0)");
    expect(await couleurTexte(l("cm-hy-titre2"), "Sous-titre")).toBe("rgb(0, 170, 85)");
    expect(await couleurTexte(editeur.locator(".cm-hy-lien").filter({ hasText: /^lien$/ }), "lien")).toBe("rgb(224, 160, 255)");
    expect(await couleur(apercu.getByRole("heading", { name: "Titre", exact: true }))).toBe("rgb(255, 136, 0)");
    expect(await couleur(l("cm-hy-titre2"))).toBe("rgb(0, 170, 85)");
    expect(await couleur(apercu.getByRole("heading", { name: "Sous-titre" }))).toBe("rgb(0, 170, 85)");
    const ink = await token("--ink");
    expect(await couleur(l("cm-hy-titre3"))).toBe(ink);
    expect(await couleurTexte(l("cm-hy-titre3"), "Section")).toBe(ink);
    // Un lien dans un titre garde la couleur réglée des liens (AC-115-4).
    expect(await couleurTexte(l("cm-hy-titre4"), "ancre")).toBe("rgb(224, 160, 255)");
    expect(await couleur(apercu.getByRole("heading", { name: "Section", exact: true }))).toBe(ink);
    expect(await couleur(l("cm-hy-citation"), "backgroundColor")).toBe("rgb(32, 40, 48)");
    expect(await couleur(l("cm-hy-citation"), "boxShadow")).toContain("rgb(68, 136, 255)");
    expect(await couleur(citation, "backgroundColor")).toBe("rgb(32, 40, 48)");
    expect(await couleur(citation, "borderLeftColor")).toBe("rgb(68, 136, 255)");
    expect(await couleur(bloc, "backgroundColor")).toBe("rgb(16, 24, 32)");
    expect(await couleur(pre, "backgroundColor")).toBe("rgb(16, 24, 32)");
    const motCle = await token("--syn-keyword");
    expect(await couleur(bloc.locator("span", { hasText: /^fn$/ }))).toBe(motCle);
    expect(await couleur(pre.locator("span", { hasText: /^fn$/ }))).toBe(motCle);

    // Clair : « Titre » brun, le reste comme avant, sans recharger.
    await page.getByRole("button", { name: "Thème clair" }).click();
    await expect.poll(() => couleur(l("cm-hy-titre1"))).toBe("rgb(160, 64, 0)");
    expect(await couleurTexte(l("cm-hy-titre1"), "Titre")).toBe("rgb(160, 64, 0)");
    expect(await couleur(apercu.getByRole("heading", { name: "Titre", exact: true }))).toBe("rgb(160, 64, 0)");
    const inkClair = await token("--ink");
    expect(inkClair).not.toBe(ink);
    expect(await couleur(l("cm-hy-titre2"))).toBe(inkClair);
    expect(await couleurTexte(l("cm-hy-titre2"), "Sous-titre")).toBe(inkClair);
    expect(await couleurTexte(editeur.locator(".cm-hy-lien").filter({ hasText: /^lien$/ }), "lien")).toBe(await token("--info"));
    expect(await couleur(apercu.getByRole("heading", { name: "Sous-titre" }))).toBe(inkClair);
    expect(await couleur(l("cm-hy-citation"), "backgroundColor")).toBe(await token("--msg-info", "backgroundColor"));
    expect(await couleur(citation, "backgroundColor")).toBe(await token("--msg-info", "backgroundColor"));
    expect(await couleur(citation, "borderLeftColor")).toBe(await token("--info"));
    expect(await couleur(bloc, "backgroundColor")).toBe(await token("--code-fond", "backgroundColor"));
    expect(await couleur(pre, "backgroundColor")).toBe(await token("--apercu-fond", "backgroundColor"));
    expect(await couleur(bloc.locator("span", { hasText: /^fn$/ }))).toBe(await token("--syn-keyword"));

    expect(await couleur(l("cm-hy-titre3"))).toBe(inkClair);
    expect(await couleur(apercu.getByRole("heading", { name: "Section", exact: true }))).toBe(inkClair);

    // Retour au sombre : l'orange revient.
    await page.getByRole("button", { name: "Thème clair" }).click();
    await expect.poll(() => couleur(l("cm-hy-titre1"))).toBe("rgb(255, 136, 0)");
    // AC-115-12 : curseur sur « # Titre » → « Titre » orange, « # » en --ink-muted.
    await editeur.locator(".cm-line.cm-hy-titre1").click();
    await page.keyboard.press("Control+Home");
    await expect(editeur.locator(".cm-line.cm-hy-titre1")).toHaveText("# Titre");
    expect(await couleurTexte(l("cm-hy-titre1"), "Titre")).toBe("rgb(255, 136, 0)");
    expect(await couleurTexte(l("cm-hy-titre1"), "#")).toBe(await token("--ink-muted"));
    await page.keyboard.press("Control+End");
    expect(await couleur(apercu.getByRole("heading", { name: "Titre", exact: true }))).toBe("rgb(255, 136, 0)");

    // Remplacer le fichier dans Yaide : Ctrl+S ne change rien.
    await page.keyboard.press("Control+p");
    const champ = page.getByRole("textbox", { name: "Chemin du fichier" });
    await champ.fill("markdown.json");
    await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(1);
    await champ.press("Enter");
    const json = page.getByRole("textbox", { name: "Éditeur markdown.json" });
    await expect(json).toBeFocused();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText('{ "sombre": { "texte": { "couleur": "#336699" } } }');
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(path.join(dossier, ".yaide", "markdown.json"), "utf8")).toContain("#336699");
    await page.getByRole("tab", { name: nomLigne("README.md") }).click();
    await expect.poll(() => couleur(l("cm-hy-titre1"))).toBe("rgb(255, 136, 0)");
    expect(await couleur(apercu.getByRole("heading", { name: "Titre", exact: true }))).toBe("rgb(255, 136, 0)");
    expect(await couleur(apercu.locator("p", { hasText: "Un paragraphe" }))).not.toBe("rgb(51, 102, 153)");

    // Rechargement : le texte courant prend la couleur réglée, le reste reste comme avant.
    await page.reload();
    await page.getByRole("tab", { name: nomLigne("README.md") }).click();
    const bleu = "rgb(51, 102, 153)";
    const editeur2 = page.locator(".cm-content:visible");
    await editeur2.click();
    await page.keyboard.press("Control+End");
    const ligne = (t) => editeur2.locator(".cm-line", { hasText: t });
    await expect.poll(() => couleur(ligne("Un paragraphe"))).toBe(bleu);
    expect(await couleur(ligne("un élément"))).toBe(bleu);
    expect(await couleur(editeur2.locator(".cm-hy-gras"))).toBe(bleu);
    expect(await couleur(editeur2.locator(".cm-hy-italique"))).toBe(bleu);
    const apercu2 = page.getByRole("region", { name: "Aperçu" });
    expect(await couleur(apercu2.locator("p", { hasText: "Un paragraphe" }))).toBe(bleu);
    expect(await couleur(apercu2.locator("li", { hasText: "un élément" }))).toBe(bleu);
    expect(await couleur(apercu2.locator("strong"))).toBe(bleu);
    expect(await couleur(apercu2.locator("em"))).toBe(bleu);
    const inkFinal = await token("--ink");
    expect(await couleur(apercu2.getByRole("heading", { name: "Titre", exact: true }))).toBe(inkFinal);
    expect(await couleur(l("cm-hy-titre1"))).toBe(inkFinal);
    expect(await couleur(editeur2.locator(".cm-hy-lien").filter({ hasText: /^lien$/ }))).toBe(await token("--info"));
    expect(await couleur(editeur2.locator(".cm-hy-code"))).toBe(inkFinal);
    expect(await couleur(l("cm-hy-citation"))).toBe(inkFinal);
    expect(await couleur(citation)).toBe(inkFinal);
    expect(await couleur(apercu2.getByRole("link", { name: "lien", exact: true }))).toBe(await token("--info"));
    expect(await couleur(apercu2.locator("p code"))).toBe(inkFinal);
  } finally {
    await yaide.arreter();
  }
});
