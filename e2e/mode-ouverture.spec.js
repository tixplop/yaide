import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne } from "./aides.js";

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

const readme = [
  "# projet", "", "Un outil en ligne de commande pour saluer.", "Voir la [documentation](https://exemple.org/doc) avant de commencer.", "",
  "```rust", "fn main() {}", "```", "", "## Lancer", "", "`projet` salue.", "", "## Options", "", "> Les options sont facultatives.", "", "",
  "- `--fort` : salue en ~~majuscules~~ capitales.", "- `--bas` : salue bas.", "", "---", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "Fin.", "", "",
];
const index = [
  "<!doctype html>", '<html lang="fr">', "<head>", '<meta charset="utf-8">', "<title>Compteur</title>", "<style>", "body { font-family: serif; }", "h1 { color: #036; }",
  "</style>", "</head>", "<body>", "<header>", "<nav>", "<ul>", "<li>Accueil</li>", "</ul>", "<h1>Compteur de lignes</h1>", "</nav>", "</header>", "<main>",
  "<p>Compte les lignes.</p>", "<p>Rapide.</p>", "<p>Simple.</p>", "<p>Sûr.</p>", "<p>Léger.</p>", "<p>Fiable.</p>", "<p>Libre.</p>", "</main>", "<footer>2026</footer>", "</body>", "</html>",
];
const guide = Array.from({ length: 62 }, (_, i) => `Ligne ${i + 1} du guide.`);
guide[0] = "# Guide";
guide[29] = "L'option --fort existe.";
guide[39] = "L'option `--fort` salue en **capitales**.";
guide[19] = "> Une citation.";
guide[9] = "## Utiliser";

async function ouvrir(page) {
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "README.md"), readme.join("\n"));
  fs.mkdirSync(path.join(dossier, "site"));
  fs.writeFileSync(path.join(dossier, "site", "index.html"), index.join("\n") + "\n");
  fs.mkdirSync(path.join(dossier, "docs"));
  fs.writeFileSync(path.join(dossier, "docs", "guide.md"), guide.join("\n") + "\n");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await expect(arbre(page)).toBeVisible();
  return dossier;
}
const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const onglet = (page, nom) => page.getByRole("tab", { name: new RegExp(`^${nom.replace(".", "\\.")}(,|$)`) });
const editeur = (page, nom) => page.getByRole("textbox", { name: `Éditeur ${nom}` });
const hybride = (page) => page.getByRole("button", { name: "Mode hybride", exact: true });
const apercu = (page) => page.getByRole("button", { name: "Aperçu", exact: true });
const lignes = (page) => page.locator(".cm-content:visible .cm-line");
const cadre = (page) => page.locator('iframe[title="Aperçu"]:visible');
const largeur = async (loc) => (await loc.boundingBox()).width;

async function ouvrirDossier(page, nom) {
  await ligne(page, nom).click();
}
async function ouvrirParRacine(page) {
  await ouvrirDossier(page, "src");
  await ligne(page, "main.rs").click();
  await expect(editeur(page, "main.rs")).toBeFocused();
}
async function ouvrirIndexRapide(page) {
  await page.keyboard.press("Control+p");
  await page.getByRole("textbox", { name: "Chemin du fichier" }).fill("index");
  await expect(page.getByRole("listbox", { name: "Fichiers proposés" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editeur(page, "index.html")).toBeFocused();
}
async function nouveauFichier(page, chemin) {
  await page.getByRole("button", { name: "Nouveau fichier" }).click();
  await page.getByLabel("Chemin").fill(chemin);
  await page.keyboard.press("Enter");
  await expect(editeur(page, path.basename(chemin))).toBeFocused();
}

test("REQ083_P053_ouvrir_une_note_et_une_page", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  await page.setViewportSize({ width: 1280, height: 800 });
  const dossier = await ouvrir(page);
  await ouvrirParRacine(page);

  // Étape 1 : README.md s'ouvre en mode hybride (AC-083-1, AC-083-6).
  await ligne(page, "README.md").click();
  await expect(editeur(page, "README.md")).toBeFocused();
  await expect(hybride(page)).toHaveAttribute("aria-pressed", "true");
  await expect(apercu(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("footer")).toContainText("Ln 1, Col 1");
  await expect(onglet(page, "README.md")).not.toHaveAccessibleName(/non sauvegardé/);
  await expect(lignes(page).nth(0)).toHaveText("# projet");
  await expect(lignes(page).nth(9)).toHaveText("Lancer");
  await expect(page.locator(".cm-hy-tableau:visible table th")).toHaveText(["a", "b"]);
  const groupe = page.locator(".editeur-code:visible");
  const zone = page.locator(".zone-code:not([hidden]) .zone-code-editeur");
  expect(Math.abs((await largeur(zone)) - (await largeur(groupe)))).toBeLessThanOrEqual(2);

  // Étape 2 : index.html par Ctrl+P (AC-083-2, AC-083-7).
  await ouvrirIndexRapide(page);
  await expect(apercu(page)).toHaveAttribute("aria-pressed", "true");
  await expect(hybride(page)).toHaveCount(0);
  await expect(cadre(page)).toBeVisible();
  await expect(cadre(page).contentFrame().getByRole("heading", { name: "Compteur de lignes" })).toBeVisible();
  const g = await largeur(groupe);
  expect(Math.abs((await largeur(zone)) - (await largeur(cadre(page))))).toBeLessThanOrEqual(2);
  expect(Math.abs((await largeur(zone)) - g / 2)).toBeLessThanOrEqual(g * 0.1);
  expect(await cadre(page).evaluate((f) => f.ownerDocument.activeElement === f)).toBe(false);

  // Étape 3 : la page suit la frappe.
  await lignes(page).nth(16).click();
  await page.keyboard.press("End");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.type(" !");
  await expect(cadre(page).contentFrame().getByRole("heading", { name: "Compteur de lignes !" })).toBeVisible();

  // Étapes 4 et 5 : mode éteint, onglet fermé, fichier rouvert (AC-083-4).
  await onglet(page, "README.md").click();
  await hybride(page).click();
  await expect(hybride(page)).toHaveAttribute("aria-pressed", "false");
  await expect(hybride(page)).toBeFocused();
  await expect(lignes(page).nth(0)).toHaveText("# projet");
  await expect(lignes(page).nth(9)).toHaveText("## Lancer");
  await page.getByRole("button", { name: "Fermer README.md" }).click();
  await ligne(page, "README.md").click();
  await expect(hybride(page)).toHaveAttribute("aria-pressed", "true");
  const onglets = page.getByRole("tab", { name: /\.(rs|html|md)(,|$)/ });
  await expect(onglets.last()).toHaveAccessibleName(/^README\.md(,|$)/);

  // Étape 6 : main.rs sans mode ni aperçu, diff sans mode hybride (AC-083-3).
  await onglet(page, "main.rs").click();
  await expect(hybride(page)).toHaveCount(0);
  await expect(apercu(page)).toHaveCount(0);
  fs.appendFileSync(path.join(dossier, "README.md"), "modifié\n");
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  await page.getByRole("listbox", { name: "Changements" }).getByRole("option").filter({ hasText: "README.md" }).click();
  await expect(page.getByRole("tab", { name: "README.md (diff)" })).toBeVisible();
  await expect(hybride(page)).toHaveCount(0);
});

test("REQ083_P054_recherche_fichiers_vides_rechargement", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrir(page);
  await ouvrirParRacine(page);
  await ligne(page, "README.md").click();
  await ouvrirIndexRapide(page);

  // Étape 2 : résultat de recherche ligne 40 (AC-083-6).
  await page.getByRole("tab", { name: "Recherche" }).click();
  await page.getByRole("textbox", { name: "Rechercher" }).fill("--fort");
  await page.keyboard.press("Enter");
  await expect(page.getByText("3 résultats dans 2 fichiers")).toBeVisible();
  const resultat = page.getByRole("listbox", { name: "Résultats de la recherche" }).getByRole("option").filter({ has: page.locator(".liste-numero", { hasText: /^40$/ }) });
  await resultat.click();
  await expect(editeur(page, "guide.md")).toBeFocused();
  await expect(hybride(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("footer")).toContainText("Ln 40");
  const l40 = lignes(page).filter({ hasText: "salue en" });
  await expect(l40).toHaveText("L'option `--fort` salue en **capitales**.");
  await expect(l40).toBeInViewport();
  const couleurMarque = await l40.locator(".cm-hy-marque").first().evaluate((e) => getComputedStyle(e).color);
  const couleurMuted = await page.evaluate(() => {
    const s = document.createElement("span");
    s.style.color = "var(--ink-muted)";
    document.body.append(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return c;
  });
  expect(couleurMarque).toBe(couleurMuted);
  await expect(resultat).toHaveAttribute("aria-selected", "true");

  // Étape 3 : notes.md créé depuis le panneau (AC-083-1).
  await page.getByRole("tab", { name: "Fichiers" }).click();
  await nouveauFichier(page, "notes.md");
  await expect(hybride(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  await page.keyboard.type("## À faire\n");
  await expect(lignes(page).nth(0)).toHaveText("À faire");

  // Étape 4 : site/vide.html (AC-058-10).
  await nouveauFichier(page, "site/vide.html");
  await expect(apercu(page)).toHaveAttribute("aria-pressed", "true");
  await expect(cadre(page)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  await expect(cadre(page).contentFrame().locator("body")).toHaveText("");
  await page.keyboard.type("<p>Bonjour");
  await expect(cadre(page).contentFrame().getByText("Bonjour")).toBeVisible();

  // Étape 5 : clic sur « Aperçu ».
  await apercu(page).click();
  await expect(cadre(page)).toHaveCount(0);
  await expect(apercu(page)).toBeFocused();

  // Étape 6 : rechargement (AC-083-5).
  await expect.poll(() => page.evaluate(() => new Promise((ok) => {
    const d = indexedDB.open("yaide", 1);
    d.onsuccess = () => {
      const r = d.result.transaction("cles").objectStore("cles").get("onglets");
      r.onsuccess = () => ok((r.result?.liste ?? []).find((o) => o.chemin === "site/vide.html")?.apercu);
    };
  }))).toBe(false);
  await page.reload();
  await expect(arbre(page)).toBeVisible();
  await onglet(page, "vide.html").click();
  await expect(apercu(page)).toHaveAttribute("aria-pressed", "false");
  await expect(cadre(page)).toHaveCount(0);
  for (const nom of ["README.md", "guide.md", "notes.md"]) {
    await onglet(page, nom).click();
    await expect(hybride(page)).toHaveAttribute("aria-pressed", "true");
  }
  await onglet(page, "index.html").click();
  await expect(apercu(page)).toHaveAttribute("aria-pressed", "true");
  await expect(cadre(page)).toBeVisible();
  await ligne(page, "site").click();
  await ligne(page, "vide.html").click();
  await expect(onglet(page, "vide.html")).toHaveAttribute("aria-selected", "true");
  await expect(apercu(page)).toHaveAttribute("aria-pressed", "false");
  await expect(cadre(page)).toHaveCount(0);
});

test("REQ083_AC6_AC8_premier_affichage_sans_bascule", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  await ouvrir(page);
  await page.evaluate(() => {
    window.__vus = { md: [], html: [] };
    new MutationObserver(() => {
      for (const e of document.querySelectorAll(".cm-editor")) {
        if (e.__vu) continue;
        const texte = e.closest(".zone-code");
        const nom = e.querySelector(".cm-content")?.getAttribute("aria-label") ?? "";
        if (!nom) continue;
        e.__vu = true;
        if (nom.includes("README.md")) window.__vus.md.push(e.classList.contains("cm-hybride"));
        if (nom.includes("index.html")) window.__vus.html.push(!!texte?.querySelector("iframe"));
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "class"] });
  });
  await ligne(page, "README.md").click();
  await expect(editeur(page, "README.md")).toBeFocused();
  await ouvrirDossier(page, "site");
  await ligne(page, "index.html").click();
  await expect(cadre(page)).toBeVisible();
  const vus = await page.evaluate(() => window.__vus);
  expect(vus.md).toEqual([true]);
  expect(vus.html).toEqual([true]);
});
