import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne, gardeContient } from "./aides.js";
import { lancerRelais } from "./relais.js";

let yaide;
let relais;
test.afterEach(async () => {
  relais?.fermer();
  relais = undefined;
  await yaide?.arreter();
});

const git = (dossier, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd: dossier, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} : ${r.stderr}`);
  return r.stdout;
};
const ecran = (page) => page.locator(".terminal:visible .xterm-rows");
const terminalPret = async (page) => {
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
};

test("REQ030_AC1_parcours_1_corriger_un_fichier_et_faire_un_commit", async ({ page }) => {
  const dossier = depotExemple();
  git(dossier, "config", "user.name", "Test");
  git(dossier, "config", "user.email", "t@example.org");
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await page.goto(yaide.origine + "/");
  const champ = page.getByLabel("Mot de passe");
  await expect(champ).toBeFocused();
  await champ.fill("faux");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Mot de passe incorrect.")).toBeVisible();
  await expect(champ).toBeFocused();
  expect(await champ.evaluate((e) => e.selectionStart === 0 && e.selectionEnd === e.value.length && e.value.length > 0)).toBe(true);
  await champ.fill("mdp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tree", { name: "Fichiers" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Shells" }).getByRole("tab")).toHaveCount(0);
  await expect(page.locator("footer")).toContainText(git(dossier, "branch", "--show-current").trim());
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  const arbreMain = page.getByRole("treeitem", { name: nomLigne("main.rs") });
  await expect(arbreMain.locator(".liste-statut")).toHaveCount(0);
  await arbreMain.click();
  await expect(page.getByRole("tab", { name: "main.rs", exact: true })).toBeVisible();
  await expect(page.locator(".ya-crumbs")).toHaveText("srcmain.rs");
  await expect(page.locator("footer")).toContainText("Ln 1, Col 1");
  await expect(page.locator("footer")).toContainText("Rust");
  await expect(page.getByLabel("Éditeur main.rs")).toBeFocused();
  await page.keyboard.type("// corrigé\n");
  await expect(page.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("tab", { name: "main.rs, modifié", exact: true })).toBeVisible();
  await expect(arbreMain.locator(".liste-statut")).toHaveText("M");
  await expect(page.getByRole("tab", { name: "Git", exact: true }).locator(".ya-badge")).toHaveText("1");
  expect(fs.readFileSync(path.join(dossier, "src", "main.rs"), "utf8")).toContain("// corrigé");
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Changements" })).toContainText("Modifications");
  const ligne = page.getByRole("listbox", { name: "Changements" }).getByRole("option").filter({ has: page.locator(".liste-parent", { hasText: "src" }), hasText: "main.rs" });
  await expect(ligne.locator(".liste-statut")).toHaveText("M");
  await ligne.click();
  await expect(page.getByRole("tab", { name: "main.rs (diff)" })).toBeVisible();
  await expect(page.getByLabel("Diff main.rs")).toContainText("+// corrigé");
  await page.getByRole("button", { name: "Indexer main.rs" }).click();
  await expect(ligne).toHaveAccessibleName("main.rs, modifié, indexé");
  await expect(page.getByRole("listbox", { name: "Changements" })).toContainText("Modifications indexées");
  await page.getByRole("textbox", { name: "Message" }).fill("Corrige main");
  await page.getByRole("button", { name: "Commit" }).click();
  await expect(page.getByText("Commit créé.")).toBeVisible();
  await expect(ligne).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "main.rs (diff)" })).toHaveCount(0);
  expect(git(dossier, "log", "-1", "--format=%s").trim()).toBe("Corrige main");
});

test("REQ030_AC1_parcours_2_shell_retrouve_et_coupure", async ({ page, context }) => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
  relais = await lancerRelais(yaide.port);
  await ouvrirYaide(page, relais.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  const onglets = (p) => p.getByRole("tablist", { name: "Shells" }).getByRole("tab");
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await expect(page.locator(".terminal:visible .xterm-helper-textarea")).toBeFocused();
  await page.getByRole("tab", { name: "shell 1" }).click();
  await terminalPret(page);
  // Le témoin n'existe qu'une fois la commande finie : le navigateur est parti avant.
  const temoin = path.join(yaide.dossier, "temoin.txt");
  await page.keyboard.type("sleep 1 && echo fini_$((20+2)) && touch temoin.txt");
  await page.keyboard.press("Enter");
  await page.close();
  await expect.poll(() => fs.existsSync(temoin), { timeout: 15000 }).toBe(true);
  // Retour dans le même contexte : la session est gardée, aucun mot de passe.
  const retour = await context.newPage();
  await retour.goto(relais.origine + "/");
  await expect(onglets(retour)).toHaveText(["shell 1", "shell 2"]);
  await expect(retour.getByLabel("Mot de passe")).toHaveCount(0);
  await retour.getByRole("tab", { name: "shell 1" }).click();
  await expect(ecran(retour)).toContainText("fini_22");
  const main = path.join(yaide.dossier, "src", "main.rs");
  await retour.getByRole("treeitem", { name: nomLigne("src") }).click();
  await retour.getByRole("treeitem", { name: nomLigne("main.rs") }).click();
  const editeur = retour.getByRole("textbox", { name: "Éditeur main.rs" });
  await expect(editeur).toBeFocused();
  await retour.keyboard.press("Control+End");
  await retour.keyboard.type("// coupure\n");
  const bandeau = retour.getByRole("alert").filter({ hasText: "Connexion perdue. Modifications gardées." });
  relais.couper();
  await expect(bandeau).toBeVisible({ timeout: 5000 });
  await expect(retour.locator(".terminal:visible .terminal-attente")).toHaveText("(en attente de la connexion)");
  await expect(editeur).toBeFocused();
  await retour.keyboard.type("// pendant\n");
  await expect(editeur).toContainText("// pendant");
  await expect(retour.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  relais.retablir();
  await expect(bandeau).toHaveCount(0, { timeout: 10000 });
  await expect(retour.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await expect(retour.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await retour.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(main, "utf8")).toContain("// pendant");
  expect(fs.readFileSync(main, "utf8")).toContain("// coupure");
  await expect(retour.getByRole("tab", { name: "main.rs, modifié", exact: true })).toBeVisible();
});

test("REQ030_AC1_parcours_3_chercher_ouvrir_apercu", async ({ page }) => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("tab", { name: "Recherche" }).click();
  const champ = page.getByRole("textbox", { name: "Rechercher" });
  await expect(champ).toBeFocused();
  await champ.fill("fn mian");
  await champ.press("Enter");
  await expect(page.getByText("Aucun résultat")).toBeVisible();
  await champ.fill("fn main");
  await champ.press("Enter");
  const resultats = page.getByRole("listbox", { name: "Résultats de la recherche" });
  await expect(resultats.getByRole("option")).toHaveCount(1);
  await expect(page.getByText("1 résultat dans 1 fichier")).toBeVisible();
  await resultats.getByRole("option").click();
  await expect(page.getByRole("tab", { name: "main.rs", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Éditeur main.rs")).toBeFocused();
  await expect(page.getByLabel("Éditeur main.rs").locator(".cm-activeLine")).toHaveText("fn main() {");
  await page.getByRole("button", { name: "Ouverture rapide" }).click();
  const dialogue = page.getByRole("dialog", { name: "Ouvrir un fichier" });
  const barre = await page.locator("header").evaluate((e) => e.getBoundingClientRect().bottom);
  expect((await dialogue.boundingBox()).y).toBeGreaterThanOrEqual(barre);
  await page.getByRole("textbox", { name: "Chemin du fichier" }).fill("read");
  await expect(dialogue.getByRole("option")).toHaveText(/README\.md/);
  await page.keyboard.press("Enter");
  await expect(dialogue).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "README.md", exact: true })).toHaveAttribute("aria-selected", "true");
  const apercuBtn = page.getByRole("button", { name: "Aperçu", exact: true });
  await apercuBtn.click();
  await expect(apercuBtn).toHaveAttribute("aria-pressed", "true");
  expect(await apercuBtn.evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe("none");
  await page.getByLabel("Éditeur README.md").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n# Nouveau titre");
  await expect(page.getByRole("region", { name: "Aperçu" }).getByRole("heading", { name: "Nouveau titre" })).toBeVisible();
});

test("REQ038_AC1_AC2_AC3_parcours_10_passer_en_theme_clair", async ({ page }) => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
  await ouvrirYaide(page, yaide.origine);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("main.rs") }).click();
  await expect(page.getByLabel("Éditeur main.rs")).toBeFocused();
  await page.keyboard.type("// point\n");
  await expect(page.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await terminalPret(page);
  await page.keyboard.type("echo resultat_$((6*7))");
  await page.keyboard.press("Enter");
  await expect(ecran(page)).toContainText("resultat_42");
  const bouton = page.getByRole("button", { name: "Thème clair" });
  await expect(bouton).toHaveAttribute("aria-pressed", "false");
  const fonds = () => page.evaluate(() => ({ code: getComputedStyle(document.querySelector(".cm-editor")).backgroundColor, rail: getComputedStyle(document.querySelector(".cadre-rail")).backgroundColor }));
  const sombre = await fonds();
  await bouton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(bouton).toHaveAttribute("aria-pressed", "true");
  const clair = await fonds();
  expect(clair.code).not.toBe(sombre.code);
  expect(clair.rail).not.toBe(sombre.rail);
  const contour = () => bouton.evaluate((e) => getComputedStyle(e).boxShadow);
  await page.mouse.move(0, 400);
  expect(await contour()).toMatch(/inset/);
  // Rien n'a bougé : le point, le texte de l'éditeur et l'affichage du shell.
  await expect(page.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await expect(page.getByLabel("Éditeur main.rs")).toContainText("// point");
  await expect(ecran(page)).toContainText("resultat_42");
  await gardeContient(page, "// point");
  // Rechargement : le thème clair est posé avant la première image, sur la page, puis sur l'écran de connexion.
  await page.addInitScript(() => {
    const vus = new Set();
    window.__themes = vus;
    const pose = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (nom, valeur) {
      if (nom === "data-theme") vus.add(valeur);
      return pose.call(this, nom, valeur);
    };
  });
  await page.reload();
  await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();
  expect(await page.evaluate(() => [...window.__themes])).toEqual(["light"]);
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page.getByLabel("Mot de passe")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Mot de passe")).toBeVisible();
  expect(await page.evaluate(() => [...window.__themes])).toEqual(["light"]);
  await page.getByLabel("Mot de passe").fill("mdp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();
  // Retour au sombre.
  await page.getByRole("button", { name: "Thème clair" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Thème clair" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".cm-editor")).toBeVisible();
  expect(await fonds()).toEqual(sombre);
  await page.mouse.move(0, 400);
  expect(await contour()).toBe("none");
});

test("REQ042_REQ043_REQ044_parcours_13_relire_un_readme_dans_l_apercu", async ({ page }) => {
  const dossier = depotExemple();
  fs.writeFileSync(
    path.join(dossier, "README.md"),
    "| Commande | Rôle |\n|---|---|\n| build | Construire le projet avec une longue phrase qui doit passer à la ligne |\n| test | Lancer les tests |\n| lint | Vérifier |\n\n> Une citation.\n\n```rust\nfn main() {}\n```\n\n```inconnu\nfn main() {}\n```\n",
  );
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("treeitem", { name: nomLigne("README.md") }).click();
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  const apercu = page.getByRole("region", { name: "Aperçu" });
  const th = apercu.locator("th").first();
  await expect(th).toBeVisible();
  const fond = (sel, i = 0) => apercu.locator(sel).nth(i).evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await fond("th")).not.toBe("rgba(0, 0, 0, 0)");
  expect(await th.evaluate((e) => getComputedStyle(e).fontWeight)).toBe("600");
  expect(await apercu.locator("td").first().evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("1px");
  expect(await fond("tbody tr td", 2)).not.toBe(await fond("tbody tr td", 0));
  expect(await apercu.locator("blockquote").evaluate((e) => getComputedStyle(e).borderLeftWidth)).not.toBe("0px");
  const fnRust = apercu.locator("pre span", { hasText: /^fn$/ });
  await expect(fnRust).toHaveCount(1);
  const sombre = await fnRust.evaluate((e) => getComputedStyle(e).color);
  // 2. Bloc de notes de plus.
  const editeur = page.getByLabel("Éditeur README.md");
  await editeur.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n> [!NOTE] Il faut Rust 1.80 ou plus.");
  await expect(apercu.locator("blockquote")).toHaveCount(2);
  await expect(apercu.locator("blockquote").last()).toContainText("[!NOTE]");
  // 3. Le bloc inconnu reste en texte simple, sur le même fond.
  const inconnu = apercu.locator("pre", { hasText: "fn main" }).last();
  await expect(inconnu.locator("span")).toHaveCount(0);
  expect(await inconnu.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await apercu.locator("pre").first().evaluate((e) => getComputedStyle(e).backgroundColor));
  // 4. Fenêtre étroite, panneau à 240 px.
  await page.setViewportSize({ width: 800, height: 480 });
  const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
  await poignee.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  await expect(poignee).toHaveAttribute("aria-valuenow", "240");
  expect(await apercu.evaluate((e) => e.scrollWidth === e.clientWidth)).toBe(true);
  // 5. Thème clair, sans retaper.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Thème clair" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await fnRust.evaluate((e) => getComputedStyle(e).color)).not.toBe(sombre);
  // 6. Remplacer inconnu par rs colore le bloc, sans sauvegarder.
  await editeur.click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("rs");
  await expect(apercu.locator("pre span", { hasText: /^fn$/ })).toHaveCount(2);
  await expect(page.getByRole("tab", { name: "README.md, modifié, non sauvegardé" })).toBeVisible();
});
