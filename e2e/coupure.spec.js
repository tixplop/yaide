import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, nomLigne, avancer, depotExemple, fauxGithub } from "./aides.js";
import { lancerRelais } from "./relais.js";

let yaide;
let relais;
let dossier;
test.beforeEach(async () => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
  dossier = yaide.dossier;
  relais = await lancerRelais(yaide.port);
});
test.beforeEach(async ({ page }) => {
  await page.clock.install();
});
test.afterEach(async () => {
  relais.fermer();
  await yaide.arreter();
});

const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const onglet = (page, nom) => page.getByRole("tab", { name: nom });
const editeur = (page) => page.getByRole("textbox", { name: "Éditeur main.rs" });
const bandeau = (page) => page.getByRole("alert").filter({ hasText: "Connexion perdue. Modifications gardées." });
const main = () => path.join(dossier, "src", "main.rs");
const ORIGINE = 'fn main() {\n    println!("salut");\n}\n';

async function ouvrirMain(page) {
  await ouvrirYaide(page, relais.origine, "mdp", { shell: false });
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  await expect(editeur(page)).toBeFocused();
}
async function taper(page, texte) {
  await editeur(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(texte);
}
/** Attend que le texte gardé dans IndexedDB contienne `texte`. */
const lireGarde = (page) =>
  page.evaluate(
        () =>
          new Promise((ok) => {
            const d = indexedDB.open("yaide", 1);
            d.onsuccess = () => {
              const r = d.result.transaction("cles").objectStore("cles").get("onglets");
              r.onsuccess = () => ok(JSON.stringify(r.result?.liste ?? []));
            };
          }),
  );
const gardeContient = (page, texte) => expect.poll(() => lireGarde(page)).toContain(texte);

async function couper(page) {
  relais.couper();
  await avancer(page, () => expect(bandeau(page)).toBeVisible({ timeout: 300 }));
}
async function retablir(page) {
  relais.retablir();
  await avancer(page, () => expect(bandeau(page)).toHaveCount(0, { timeout: 300 }));
}

test("REQ015_AC2_AC6_pendant_la_coupure_on_tape_et_le_bandeau_ne_prend_pas_le_focus", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await expect(editeur(page)).toBeFocused();
  await taper(page, "// coupure\n");
  await expect(editeur(page)).toContainText("// coupure");
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
});

test("REQ015_AC4_sans_ctrl_s_le_retour_n_ecrit_rien_et_le_point_reste", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await taper(page, "// coupure\n");
  await gardeContient(page, "// coupure");
  await retablir(page);
  expect(fs.readFileSync(main(), "utf8")).toBe(ORIGINE);
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
});

test("REQ015_AC3_AC5_AC7_ctrl_s_pendant_la_coupure_est_execute_au_retour", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await taper(page, "// attente\n");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("alert").filter({ hasText: "main.rs sera sauvegardé au retour." })).toBeVisible();
  expect(fs.readFileSync(main(), "utf8")).toBe(ORIGINE);
  await retablir(page);
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// attente");
  await expect(onglet(page, "main.rs")).toBeVisible();
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
});

test("REQ015_AC7_deux_fichiers_en_attente", async ({ page }) => {
  fs.writeFileSync(path.join(dossier, "a.txt"), "a");
  await ouvrirMain(page);
  await ligne(page, "a.txt").click();
  await expect(page.getByRole("textbox", { name: "Éditeur a.txt" })).toBeFocused();
  await couper(page);
  await page.keyboard.type("1");
  await page.keyboard.press("Control+s");
  await onglet(page, "main.rs").click();
  await page.keyboard.type("2");
  await page.keyboard.press("Control+s");
  await expect(page.getByText("2 fichiers seront sauvegardés au retour.")).toBeVisible();
  await retablir(page);
  await expect.poll(() => fs.readFileSync(path.join(dossier, "a.txt"), "utf8")).toBe("1a");
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("2fn main");
  await expect(page.getByRole("tab", { name: /non sauvegardé/ })).toHaveCount(0);
});

test("REQ015_AC3_apres_le_retour_sans_recharger_ctrl_s_ecrit_et_retire_le_point", async ({ page }) => {
  await ouvrirMain(page);
  await page.evaluate(() => (window.__sans_rechargement = true));
  await couper(page);
  await taper(page, "// tard\n");
  await retablir(page);
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
  await editeur(page).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// tard");
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
  expect(await page.evaluate(() => window.__sans_rechargement)).toBe(true);
});

test("REQ016_AC2_AC3_page_fermee_puis_sauvegarde_et_rechargement", async ({ page, browser }) => {
  await test.step("REQ016_AC2_texte_tape_puis_page_fermee_sans_sauvegarder_revient_avec_son_point", async () => {
    const contexte = await browser.newContext({ ignoreHTTPSErrors: true });
    const page1 = await contexte.newPage();
    await ouvrirMain(page1);
    await taper(page1, "// fermé\n");
    await gardeContient(page1, "// fermé");
    const etat = await contexte.storageState({ indexedDB: true });
    await contexte.close();
    const retour = await browser.newContext({ ignoreHTTPSErrors: true, storageState: etat });
    const page2 = await retour.newPage();
    await page2.goto(relais.origine + "/");
    await expect(onglet(page2, "main.rs, non sauvegardé")).toBeVisible();
    await expect(editeur(page2)).toContainText("// fermé");
    expect(fs.readFileSync(main(), "utf8")).toBe(ORIGINE);
    await retour.close();
  });
  await test.step("REQ016_AC3_apres_une_sauvegarde_recharger_affiche_le_disque_sans_point", async () => {
    await ouvrirMain(page);
    await taper(page, "// sauvé\n");
    await page.keyboard.press("Control+s");
    await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
    await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// sauvé");
    await page.reload();
    await expect(onglet(page, "main.rs")).toBeVisible();
    await expect(page.getByText("a changé sur le disque")).toHaveCount(0);
    await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
    await expect(editeur(page)).toContainText("// sauvé");
  });
});

test("REQ015_AC8_pendant_la_coupure_changer_de_panneau_garde_l_arbre", async ({ page }) => {
  await ouvrirYaide(page, relais.origine, "mdp", { shell: false });
  await expect(ligne(page, "README.md")).toBeVisible();
  await couper(page);
  await page.getByRole("tab", { name: "Recherche" }).click();
  await page.getByRole("tab", { name: "Fichiers" }).click();
  await expect(ligne(page, "README.md")).toBeVisible();
  await expect(page.getByText("Impossible de lire ce dossier")).toHaveCount(0);
});

test("REQ016_AC1_coupure_puis_retour_puis_rechargement_le_texte_est_la_et_ctrl_s_l_ecrit", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await taper(page, "// gardé\n");
  await gardeContient(page, "// gardé");
  await retablir(page);
  await page.reload();
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
  await expect(editeur(page)).toContainText("// gardé");
  await editeur(page).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(main(), "utf8")).toContain("// gardé");
  await expect(onglet(page, "main.rs, non sauvegardé")).toHaveCount(0);
});

test("REQ005_AC8_deconnexion_avec_du_texte_non_sauvegarde_sans_question_puis_le_texte_revient", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// avant sortie\n");
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Mot de passe").fill("mdp");
  await page.keyboard.press("Enter");
  await expect(onglet(page, "main.rs, non sauvegardé")).toBeVisible();
  await expect(editeur(page)).toContainText("// avant sortie");
  expect(fs.readFileSync(main(), "utf8")).toBe(ORIGINE);
});

test("REQ044_AC5_pendant_la_coupure_le_bloc_se_colore_a_la_frappe", async ({ page }) => {
  fs.writeFileSync(path.join(dossier, "README.md"), "```inconnu\nfn main() {}\n```\n");
  await ouvrirYaide(page, relais.origine, "mdp", { shell: false });
  await ligne(page, "README.md").click();
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  const apercu = page.getByRole("region", { name: "Aperçu" });
  await expect(apercu.locator("pre")).toContainText("fn main() {}");
  await expect(apercu.locator("pre span")).toHaveCount(0);
  await couper(page);
  await page.getByLabel("Éditeur README.md").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("rs");
  await expect(apercu.locator("pre span", { hasText: /^fn$/ })).toHaveCount(1);
  await expect(bandeau(page)).toBeVisible();
});

test("REQ094_AC1_AC2_AC3_AC4_parcours_65_badge_de_connexion_a_800_x_480", async ({ page }) => {
  await relais.fermer();
  await yaide.arreter();
  const BRANCHE = "feature/analyse-des-options-de-la-ligne-de-commande-et-des-variables-d-environnement";
  const depot = depotExemple();
  fs.writeFileSync(path.join(depot, "src", "args.rs"), `${"// ligne\n".repeat(7)}${"x".repeat(50)}\n`);
  const git = (...a) => spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...a], { cwd: depot });
  git("checkout", "-q", "-b", BRANCHE);
  git("add", "-A");
  git("commit", "-q", "-m", "args");
  const github = await fauxGithub();
  yaide = await lancerYaide({ dossier: depot, releases: github.url, shell: false });
  relais = await lancerRelais(yaide.port);
  try {
    await page.setViewportSize({ width: 800, height: 480 });
    await ouvrirYaide(page, relais.origine, "mdp", { shell: false });
    await page.evaluate(() => (window.__sans_rechargement = true));
    await ligne(page, "src").click();
    await ligne(page, "args.rs").click();
    const ed = page.getByRole("textbox", { name: "Éditeur args.rs" });
    await expect(ed).toBeFocused();
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    const etat = page.locator(".cadre-etat");
    const badge = etat.locator(".ya-connexion");
    await expect(etat.getByRole("status")).toHaveText("v0.9.2 disponible");
    await expect(etat).toContainText("Ln 8, Col 51");
    // Étape 1 : connecté (AC-094-1).
    await expect(badge).toHaveText("Serveur : Connecté");
    await expect(badge).toHaveAttribute("data-connexion", "connecte");

    // Étape 2 : coupure, en moins de 5 s (AC-094-2) ; le focus reste dans l'éditeur (AC-094-3).
    relais.couper();
    await avancer(page, () => expect(badge).toHaveText("Serveur : Déconnecté", { timeout: 300 }), { limite: 5000 });
    await expect(bandeau(page)).toBeVisible();
    await expect(badge).toHaveAttribute("data-connexion", "deconnecte");
    await expect(ed).toBeFocused();
    // AC-094-4 : une ligne, tout entier, sans recouvrement, branche coupée par « … », pas de défilement.
    const m = await page.evaluate(() => {
      const e = document.querySelector(".cadre-etat");
      const r = e.getBoundingClientRect();
      const rects = [...e.children].filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect());
      const triees = [...rects].sort((a, b) => a.left - b.left);
      const centres = rects.map((b) => b.top + b.height / 2);
      const tronque = (sel) => {
        const x = e.querySelector(sel);
        return !x || x.scrollWidth > x.clientWidth;
      };
      const nom = e.querySelector(".ya-status-nom");
      return {
        superpose: triees.some((b, i) => i > 0 && b.left < triees[i - 1].right - 0.5),
        hors: rects.some((b) => b.right > innerWidth + 0.5 || b.left < 0),
        ligne: Math.max(...centres) - Math.min(...centres) < 4 && rects.every((b) => b.top >= r.top - 1 && b.bottom <= r.bottom + 1),
        entiers: [".ya-status-position", ".ya-status-langage", ".ya-status-maj .message", ".ya-status-maj button", ".ya-connexion", ".ya-status-version"].filter(tronque),
        brancheCoupee: nom.scrollWidth > nom.clientWidth,
        defile: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      };
    });
    expect(m).toMatchObject({ superpose: false, hors: false, ligne: true, entiers: [], brancheCoupee: true, defile: false });
    await expect(etat).toContainText("Rust");
    await expect(etat.getByRole("button", { name: "Mettre à jour" })).toBeVisible();
    await expect(etat.locator(".ya-status-version")).toContainText(/v\d+\.\d+\.\d+/);
    await page.screenshot({ path: path.join(path.dirname(depot), "etape2.png") });

    // Étape 3 : retour, sans recharger (AC-094-2).
    relais.retablir();
    await avancer(page, () => expect(badge).toHaveText("Serveur : Connecté", { timeout: 300 }));
    await expect(bandeau(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__sans_rechargement)).toBe(true);
  } finally {
    github.fermer();
  }
});
