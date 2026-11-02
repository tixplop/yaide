import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { lancerYaide, ouvrirYaide } from "./aides.js";
import { lancerRelais } from "./relais.js";

let yaide;
let relais;
test.beforeEach(async () => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
  relais = await lancerRelais(yaide.port);
});
test.afterEach(async () => {
  relais.fermer();
  await yaide.arreter();
});

const ecran = (page) => page.locator(".terminal:visible .xterm-rows");
const taper = async (page, commande) => {
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type(commande);
  await page.keyboard.press("Enter");
};
const onglets = (page) => page.getByRole("tablist", { name: "Shells" }).getByRole("tab");

test("REQ019_AC1_un_shell_a_l_ouverture_puis_un_deuxieme_avec_sa_propre_session", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await taper(page, "V=un; echo une_valeur_$V");
  await expect(ecran(page)).toContainText("une_valeur_un");
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await taper(page, "echo autre_[$V]");
  await expect(ecran(page)).toContainText("autre_[]");
  await page.getByRole("tab", { name: "shell 1" }).click();
  await expect(ecran(page)).toContainText("une_valeur_un");
  await expect(ecran(page)).not.toContainText("autre_[]");
});

test("REQ019_AC5_noms_des_onglets_et_focus_dans_le_terminal", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const focusDansTerminal = () => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea"));
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect.poll(focusDansTerminal).toBe(true);
  await expect(page.getByRole("tab", { name: "shell 2" })).toBeVisible();
  await page.getByRole("button", { name: "Déconnexion" }).focus();
  await page.getByRole("tab", { name: "shell 1" }).click();
  await expect.poll(focusDansTerminal).toBe(true);
  await expect(page.locator(".terminal-zone:visible")).toHaveAttribute("aria-label", "Shell 1");
});

test("REQ019_AC2_demarre_dans_le_projet_et_suit_la_taille", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await ouvrirYaide(page, yaide.origine);
  await taper(page, 'basename "$PWD"');
  await expect(ecran(page)).toContainText("projet");
  const lignes = () => ecran(page).locator("> div").count();
  const taille = async () => {
    await taper(page, "stty size");
    await expect.poll(async () => (await ecran(page).locator("> div").allInnerTexts()).some((l) => /^\d+ \d+\s*$/.test(l))).toBe(true);
    const lignes = await ecran(page).locator("> div").allInnerTexts();
    return lignes.filter((l) => /^\d+ \d+\s*$/.test(l)).pop().trim().split(" ").map(Number);
  };
  const [l1, c1] = await taille();
  expect(l1).toBe(await lignes());
  // Le terminal remplit sa zone, à une cellule près.
  const vide = () =>
    page.evaluate(() => {
      const zone = document.querySelector(".terminal-zone:not([hidden])");
      const ecran = zone.querySelector(".xterm-screen");
      return zone.clientHeight - ecran.offsetHeight < ecran.offsetHeight / document.querySelectorAll(".xterm-rows > div").length;
    });
  expect(await vide()).toBe(true);
  await page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(async () => (await taille())[1], { timeout: 15000 }).toBeLessThan(c1);
  const [l2] = await taille();
  expect(l2).toBeLessThan(l1);
  expect(l2).toBe(await lignes());
});

test("REQ019_AC3_exit_ferme_l_onglet", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await taper(page, "exit");
  await expect(onglets(page)).toHaveText(["shell 1"]);
});

test("REQ019_AC6_dernier_shell_ferme_par_exit_donne_l_etat_vide_sans_reouverture", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await taper(page, "exit");
  await expect(page.getByText("Aucun shell ouvert.")).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(onglets(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Ouvrir un shell" }).click();
  await expect(onglets(page)).toHaveCount(1);
  await expect(page.getByText("Aucun shell ouvert.")).toHaveCount(0);
});

test("REQ018_AC2_les_shells_ouverts_reviennent_avec_leurs_onglets", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await page.reload();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await page.waitForTimeout(500);
  await expect(onglets(page)).toHaveCount(2);
});

test("REQ020_AC1_le_shell_continue_apres_le_depart_du_navigateur", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await taper(page, "sleep 3 && echo fini_$((6*7))");
  await page.goto("about:blank");
  await page.waitForTimeout(3500);
  await page.goto(yaide.origine + "/");
  await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();
  await expect(ecran(page)).toContainText("fini_42");
  await expect(onglets(page)).toHaveCount(1);
});

test("REQ020_AC2_REQ015_AC1_coupure_puis_reprise_sans_recharger_ni_doublon", async ({ page }) => {
  await page.goto(relais.origine + "/");
  await page.getByLabel("Mot de passe").fill("mdp");
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "shell 1" }).waitFor();
  await taper(page, "echo MARQUE_UNIQUE");
  await expect(ecran(page)).toContainText("MARQUE_UNIQUE");
  const compter = async () => ((await ecran(page).innerText()).match(/MARQUE_UNIQUE/g) ?? []).length;
  await expect.poll(compter).toBe(2);
  await page.evaluate(() => (window.__sans_rechargement = true));
  const focusAvant = await page.evaluate(() => document.activeElement?.className);

  relais.couper();
  const bandeau = page.getByRole("alert").filter({ hasText: "Connexion perdue. Modifications gardées." });
  await expect(bandeau).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".terminal-attente:visible")).toHaveText("(en attente de la connexion)");
  await expect(ecran(page)).toContainText("MARQUE_UNIQUE");
  expect(await page.evaluate(() => document.activeElement?.className)).toBe(focusAvant);

  relais.retablir();
  await expect(bandeau).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(".terminal-attente:visible")).toHaveCount(0, { timeout: 10000 });
  expect(await page.evaluate(() => window.__sans_rechargement)).toBe(true);
  await expect.poll(compter).toBe(2);
  await taper(page, "echo APRES_RETOUR");
  await expect(ecran(page)).toContainText("APRES_RETOUR");
  expect(await compter()).toBe(2);
});

test("REQ015_AC8_pendant_la_coupure_un_nouveau_shell_est_refuse_avec_un_message", async ({ page }) => {
  await page.goto(relais.origine + "/");
  await page.getByLabel("Mot de passe").fill("mdp");
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "shell 1" }).waitFor();
  relais.couper();
  await expect(page.getByText("Connexion perdue. Modifications gardées.")).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Connexion perdue. Réessayez au retour." })).toBeVisible();
  await expect(onglets(page)).toHaveCount(1);
  relais.retablir();
  await expect(page.getByText("Connexion perdue. Réessayez au retour.")).toHaveCount(0, { timeout: 10000 });
});

test("REQ021_AC1_arreter_yaide_arrete_les_shells_et_leurs_processus", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await taper(page, "echo PID_$$");
  await expect(ecran(page)).toContainText(/PID_\d+/);
  const pid = Number((await ecran(page).innerText()).match(/PID_(\d+)/)[1]);
  expect(() => process.kill(pid, 0)).not.toThrow();
  await yaide.arreter();
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
});

test("REQ021_AC2_AC4_apres_un_redemarrage_un_message_dit_combien_de_shells_sont_fermes", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  yaide = await yaide.relancer();
  await page.reload();
  const message = page.getByRole("status").filter({ hasText: "Yaide a été arrêté. 2 shells ont été fermés." });
  await expect(message).toBeVisible();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await page.waitForTimeout(1500);
  await expect(message).toBeVisible();
  await message.getByRole("button", { name: "Fermer" }).click();
  await expect(message).toHaveCount(0);
});

test("REQ021_AC4_un_seul_shell_ferme_sans_recharger_la_page", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  yaide = await yaide.relancer();
  await expect(page.getByRole("status").filter({ hasText: "Yaide a été arrêté. 1 shell a été fermé." })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Aucun shell ouvert.")).toBeVisible();
});

test("REQ021_AC3_un_shell_termine_par_exit_n_entraine_pas_le_message", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await taper(page, "exit");
  await expect(page.getByText("Aucun shell ouvert.")).toBeVisible();
  yaide = await yaide.relancer();
  await page.reload();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await expect(page.getByText("Yaide a été arrêté.")).toHaveCount(0);
});

test("REQ021_AC3_redemarrage_sans_shell_puis_nouveau_shell_ne_donne_pas_de_faux_message", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await taper(page, "exit");
  await expect(page.getByText("Aucun shell ouvert.")).toBeVisible();
  yaide = await yaide.relancer();
  await page.getByRole("button", { name: "Ouvrir un shell" }).click();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await expect(page.locator(".terminal-attente:visible")).toHaveCount(0, { timeout: 10000 });
  await page.reload();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await expect(page.getByText("Yaide a été arrêté.")).toHaveCount(0);
  await expect(page.locator(".terminal-attente:visible")).toHaveCount(0);
});

test("REQ019_un_shell_en_arriere_plan_qui_se_termine_ne_prend_pas_le_focus", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await taper(page, "sleep 1; exit");
  await page.getByRole("tab", { name: "shell 1" }).click();
  await expect(onglets(page)).toHaveText(["shell 1"], { timeout: 10000 });
  const focus = () => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea") && !!document.activeElement.closest(".terminal:not([hidden])"));
  expect(await focus()).toBe(true);
});

test("REQ005_AC7_session_expiree_pendant_que_la_page_est_ouverte", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const racine = path.dirname(yaide.dossier);
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(racine, "cfg"), HOME: path.join(racine, "home") };
  spawnSync("target/debug/yaide", ["passwd"], { input: "nouveau\n", env });
  await expect(page.getByRole("status").filter({ hasText: "Session expirée. Reconnectez-vous." })).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel("Mot de passe")).toBeVisible();
});
