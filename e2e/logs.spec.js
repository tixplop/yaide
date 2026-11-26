import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, fauxGithub, lancerYaide, nomLigne, ouvrirYaide } from "./aides.js";
import { lancerRelais } from "./relais.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

let yaide;
let relais;
let github;
test.afterEach(async () => {
  relais?.fermer();
  github?.fermer();
  await yaide?.arreter();
});

const bouton = (page) => page.locator("footer button.ya-logs");
const console_ = (page) => page.getByRole("region", { name: "Logs" });
const rangeeRefus = (page) => console_(page).getByRole("row").filter({ hasText: "Git a refusé." });

// P-147 : un lien refusé fait un toast et une ligne, vue d'une page déjà ouverte, d'un rechargement et de la purge ;
// P-148 : 800 × 480, branche longue, « v99.0.0 disponible », coupure (cas d'AC-094-4), icône rouge et 1 000 lignes.
test("REQ186_AC1_REQ188_AC6_REQ187_AC5_REQ188_AC10_parcours_P147_P148_console_deux_pages_purge_et_petite_fenetre", async ({ page }) => {
  const BRANCHE = "feature/analyse-des-options-de-la-ligne-de-commande-et-des-variables-d-environnement";
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, ".gitignore"), "*.log\n");
  fs.writeFileSync(path.join(dossier, "ignore.log"), "x");
  fs.writeFileSync(path.join(dossier, "src", "args.rs"), `${"// ligne\n".repeat(7)}${"x".repeat(50)}\n`);
  const git = (...a) => spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...a], { cwd: dossier });
  git("checkout", "-q", "-b", BRANCHE);
  git("add", "-A");
  git("commit", "-q", "-m", "args");
  github = await fauxGithub();
  yaide = await lancerYaide({ dossier, releases: github.url, shell: false });
  relais = await lancerRelais(yaide.port);
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, relais.origine, "mdp", { shell: false });
  // La seconde page est ouverte avant le refus : elle le reçoit sans rechargement.
  const autre = await page.context().newPage();
  await autre.goto(relais.origine + "/");
  await autre.getByRole("button", { name: "Nouveau shell" }).waitFor();
  await autre.evaluate(() => (window.__sans_rechargement = true));

  // P-147, étape 1 : le refus de git fait un toast et, en moins de 1 s, une ligne « Erreur ».
  await expect(page.locator(".ya-status-branche")).toBeVisible();
  await page.getByRole("treeitem", { name: "ignore.log, ignoré par git" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Indexer" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Git a refusé." })).toBeVisible();
  await expect(bouton(page)).toHaveAttribute("aria-label", "Logs : erreurs", { timeout: 1000 });
  await bouton(page).click();
  await expect(page.getByRole("tab", { name: "Logs" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Filtrer" })).toBeFocused();
  await expect(rangeeRefus(page)).toContainText("Erreur");

  // La page déjà ouverte voit l'icône et la ligne en moins de 5 s, sans rechargement ; le rechargement de la première les retrouve.
  await expect(bouton(autre)).toHaveAttribute("aria-label", "Logs : erreurs", { timeout: 5000 });
  await bouton(autre).click();
  await expect(rangeeRefus(autre)).toBeVisible({ timeout: 5000 });
  expect(await autre.evaluate(() => window.__sans_rechargement)).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Nouveau shell" }).waitFor();
  await expect(page.getByRole("tab", { name: "Logs" })).toHaveCount(0);
  await bouton(page).click();
  await expect(rangeeRefus(page)).toBeVisible();

  // Étape 5 : la purge vide la console ici, l'icône revient au « i », l'autre page suit en moins de 5 s, et le rechargement n'y change rien.
  await page.getByRole("button", { name: "Purger les logs" }).click();
  await expect(console_(page).getByText("Aucun log.")).toBeVisible();
  await expect(bouton(page)).toHaveAttribute("aria-label", "Logs : rien à signaler");
  await expect(console_(autre).getByText("Aucun log.")).toBeVisible({ timeout: 5000 });
  await expect(bouton(autre)).toHaveAttribute("aria-label", "Logs : rien à signaler");
  await autre.close();
  await page.reload();
  await page.getByRole("button", { name: "Nouveau shell" }).waitFor();
  await bouton(page).click();
  await expect(console_(page).getByText("Aucun log.")).toBeVisible();

  // P-148 : 800 × 480, fichier ouvert, 1 000 lignes dont un message de 300 caractères et une erreur.
  // Les lignes sont écrites avant un rechargement : la page les lit au chargement, sans attendre la relecture de 3 s.
  const long = "x".repeat(300);
  await page.evaluate(async (long) => {
    const lignes = Array.from({ length: 999 }, (_, i) => ({ severite: "Information", message: `Ligne ${i + 1}` }));
    lignes.push({ severite: "Erreur", message: long });
    await fetch("/api/journal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lignes }) });
  }, long);
  await page.reload();
  await page.getByRole("button", { name: "Nouveau shell" }).waitFor();
  await page.setViewportSize({ width: 800, height: 480 });
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("args.rs") }).click();
  await expect(page.getByRole("textbox", { name: "Éditeur args.rs" })).toBeFocused();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  const etat = page.locator(".cadre-etat");
  await expect(etat.getByRole("status")).toHaveText("v99.0.0 disponible");
  await expect(etat).toContainText("Ln 8, Col 51");
  await expect(bouton(page)).toHaveAttribute("aria-label", "Logs : erreurs");
  await bouton(page).click();
  await expect(console_(page).getByRole("row").filter({ hasText: long })).toBeVisible();
  // Coupure : « Déconnecté », et « Mettre à jour » reste là.
  relais.couper();
  await expect(etat.locator(".ya-connexion")).toHaveText("Serveur : Déconnecté", { timeout: 20000 });
  await expect(etat.getByRole("button", { name: "Mettre à jour" })).toBeVisible();

  // AC-187-5 : la barre d'état tient sur une ligne, rien ne se superpose, rien n'est tronqué.
  const barre = await page.evaluate(() => {
    const e = document.querySelector(".cadre-etat");
    const r = e.getBoundingClientRect();
    const rects = [...e.children].filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect());
    const triees = [...rects].sort((a, b) => a.left - b.left);
    const centres = rects.map((b) => b.top + b.height / 2);
    const tronque = (sel) => {
      const x = e.querySelector(sel);
      return !x || x.scrollWidth > x.clientWidth;
    };
    return {
      superpose: triees.some((b, i) => i > 0 && b.left < triees[i - 1].right - 0.5),
      hors: rects.some((b) => b.right > innerWidth + 0.5 || b.left < 0),
      ligne: Math.max(...centres) - Math.min(...centres) < 4 && rects.every((b) => b.top >= r.top - 1 && b.bottom <= r.bottom + 1),
      tronques: ["button.ya-logs", ".ya-status-maj .message", ".ya-status-maj button", ".ya-connexion", ".ya-status-version"].filter(tronque),
      logs: e.querySelector("button.ya-logs").getBoundingClientRect().toJSON(),
      premier: e.firstElementChild.contains(e.querySelector("button.ya-logs")),
    };
  });
  expect(barre.superpose).toBe(false);
  expect(barre.hors).toBe(false);
  expect(barre.ligne).toBe(true);
  expect(barre.tronques).toEqual([]);
  expect(barre.premier).toBe(true);
  expect([barre.logs.width, barre.logs.height]).toEqual([20, 20]);

  // AC-188-10 : la page ne défile jamais, seul le tableau défile, en-têtes visibles ; le message long passe à la ligne.
  const mesures = await page.evaluate(async () => {
    const zone = document.querySelector("[role=region][aria-label=Logs]");
    zone.scrollTop = zone.scrollHeight / 2;
    await new Promise((r) => requestAnimationFrame(r));
    const tete = document.querySelector(".ya-journal th").getBoundingClientRect();
    const long = [...document.querySelectorAll(".ya-journal-message span")].find((s) => s.textContent.length === 300);
    const racine = document.scrollingElement;
    return {
      pageDefile: racine.scrollHeight > racine.clientHeight || racine.scrollWidth > racine.clientWidth,
      zoneDefile: zone.scrollHeight > zone.clientHeight,
      sansDefilementLateral: zone.scrollWidth <= zone.clientWidth,
      teteHaut: Math.abs(tete.top - zone.getBoundingClientRect().top) <= 1,
      lignesDuLong: long.getBoundingClientRect().height / parseFloat(getComputedStyle(long).lineHeight),
    };
  });
  expect(mesures.pageDefile).toBe(false);
  expect(mesures.zoneDefile).toBe(true);
  expect(mesures.sansDefilementLateral).toBe(true);
  expect(mesures.teteHaut).toBe(true);
  expect(mesures.lignesDuLong).toBeGreaterThan(1.5);
});
