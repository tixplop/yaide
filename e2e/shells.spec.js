import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { lancerYaide, ouvrirYaide, tailleStable } from "./aides.js";
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
    await tailleStable(page);
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

test("REQ036_AC12_stty_size_donne_la_zone_affichee_une_fois_la_police_chargee", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await ouvrirYaide(page, yaide.origine);
  await page.evaluate(() => document.fonts.load('12.5px "JetBrains Mono"'));
  await tailleStable(page);
  await taper(page, "stty size");
  await expect.poll(async () => (await ecran(page).locator("> div").allInnerTexts()).some((l) => /^\d+ \d+\s*$/.test(l))).toBe(true);
  const [l, c] = (await ecran(page).locator("> div").allInnerTexts()).filter((x) => /^\d+ \d+\s*$/.test(x)).pop().trim().split(" ").map(Number);
  const mesure = await page.evaluate(() => {
    const zone = document.querySelector(".terminal-zone:not([hidden])");
    const ecran = zone.querySelector(".xterm-screen");
    const lignes = document.querySelectorAll(".terminal:not([hidden]) .xterm-rows > div").length;
    const defilement = zone.querySelector(".xterm-viewport");
    const barre = defilement.offsetWidth - defilement.clientWidth;
    const cellW = ecran.offsetWidth / document.querySelector(".terminal:not([hidden])").term.cols;
    return { cellH: ecran.offsetHeight / lignes, zoneH: zone.clientHeight, zoneW: zone.clientWidth, barre, cellW };
  });
  expect(l).toBe(Math.floor(mesure.zoneH / mesure.cellH));
  expect(c).toBe(Math.floor((mesure.zoneW - mesure.barre) / mesure.cellW));
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
  await expect(page.getByRole("separator", { name: "Hauteur des shells" })).toHaveCount(0);
  await expect(page.getByText("Aucun shell ouvert.")).toHaveCount(0);
  await page.waitForTimeout(2000);
  await expect(onglets(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveCount(1);
  await expect(page.getByRole("separator", { name: "Hauteur des shells" })).toBeVisible();
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
  await expect(page.getByRole("separator", { name: "Hauteur des shells" })).toHaveCount(0);
});

test("REQ021_AC3_un_shell_termine_par_exit_n_entraine_pas_le_message", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await taper(page, "exit");
  await expect(page.getByRole("separator", { name: "Hauteur des shells" })).toHaveCount(0);
  yaide = await yaide.relancer();
  await page.reload();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await expect(page.getByText("Yaide a été arrêté.")).toHaveCount(0);
});

test("REQ021_AC3_redemarrage_sans_shell_puis_nouveau_shell_ne_donne_pas_de_faux_message", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await taper(page, "exit");
  await expect(page.getByRole("separator", { name: "Hauteur des shells" })).toHaveCount(0);
  yaide = await yaide.relancer();
  await page.getByRole("button", { name: "Nouveau shell" }).click();
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

const fermer = (page) => page.getByRole("button", { name: "Fermer le shell" });
const dialogue = (page, titre) => page.getByRole("dialog", { name: titre });
const focusDansTerminal = (page) => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea"));
const vivant = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("REQ035_AC2_AC4_AC9_AC10_fermer_shell_2_arrete_sleep_et_active_shell_3", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  for (const n of [2, 3]) {
    await page.getByRole("button", { name: "Nouveau shell" }).click();
    await expect(onglets(page)).toHaveCount(n);
  }
  await page.getByRole("tab", { name: "shell 2" }).click();
  await taper(page, "sleep 300 & echo PID=$! FIN$((1+1))");
  await expect(ecran(page)).toContainText("FIN2");
  const pid = Number((await ecran(page).innerText()).match(/PID=(\d+) FIN2/)[1]);
  expect(vivant(pid)).toBe(true);
  await fermer(page).click();
  const dlg = dialogue(page, "Fermer shell 2 ?");
  await expect(dlg).toContainText("Les programmes qui y tournent seront arrêtés. Cette action est définitive.");
  await expect(dlg.getByRole("button", { name: "Annuler" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(fermer(page)).toBeFocused();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2", "shell 3"]);
  expect(vivant(pid)).toBe(true);
  await fermer(page).click();
  await dlg.getByRole("button", { name: "Annuler" }).click();
  await expect(fermer(page)).toBeFocused();
  await expect(onglets(page)).toHaveCount(3);
  await fermer(page).click();
  await dlg.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(dlg).toHaveCount(0);
  await expect(onglets(page)).toHaveText(["shell 1", "shell 3"]);
  await expect(page.getByRole("tab", { name: "shell 3" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => focusDansTerminal(page)).toBe(true);
  await expect.poll(() => vivant(pid)).toBe(false);
  // Le dernier onglet fermé : celui de gauche devient actif.
  await fermer(page).click();
  await dlg.or(dialogue(page, "Fermer shell 3 ?")).getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await expect(page.getByRole("tab", { name: "shell 1" })).toHaveAttribute("aria-selected", "true");
  // Le dernier : la zone disparaît, focus sur « Nouveau shell », bouton désactivé.
  await fermer(page).click();
  await dialogue(page, "Fermer shell 1 ?").getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.getByRole("separator", { name: "Hauteur des shells" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nouveau shell" })).toBeFocused();
  await expect(fermer(page)).toBeDisabled();
  await page.waitForTimeout(1500);
  await expect(onglets(page)).toHaveCount(0);
});

test("REQ035_AC5_un_shell_ferme_disparait_dans_l_autre_fenetre", async ({ page, context }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveCount(2);
  const autre = await context.newPage();
  await autre.goto(yaide.origine + "/");
  await expect(onglets(autre)).toHaveText(["shell 1", "shell 2"]);
  // Le focus est dans le terminal de shell 2 dans l'autre fenêtre : il suit vers shell 1.
  await autre.getByRole("tab", { name: "shell 2" }).click();
  await expect.poll(() => focusDansTerminal(autre)).toBe(true);
  await fermer(page).click();
  await dialogue(page, "Fermer shell 2 ?").getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(onglets(autre)).toHaveText(["shell 1"]);
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await expect(autre.getByRole("tab", { name: "shell 1" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => focusDansTerminal(autre)).toBe(true);
});

test("REQ035_AC7_AC12_coupure_avant_et_pendant_le_dialogue", async ({ page }) => {
  await page.goto(relais.origine + "/");
  await page.getByLabel("Mot de passe").fill("mdp");
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "shell 1" }).waitFor();
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveCount(2);
  // Pendant la coupure, pas de dialogue et le focus reste sur le bouton.
  relais.couper();
  await expect(page.getByText("Connexion perdue. Modifications gardées.")).toBeVisible({ timeout: 5000 });
  await fermer(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Connexion perdue. Réessayez au retour." })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(fermer(page)).toBeFocused();
  relais.retablir();
  await expect(page.getByText("Connexion perdue. Modifications gardées.")).toHaveCount(0, { timeout: 10000 });
  // Coupure après l'ouverture du dialogue : il reste ouvert et le dit.
  await fermer(page).click();
  const dlg = dialogue(page, "Fermer shell 2 ?");
  await expect(dlg).toBeVisible();
  relais.couper();
  await dlg.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(dlg).toContainText("Connexion perdue. Réessayez au retour.");
  await expect(dlg).toBeVisible();
  relais.retablir();
  await expect(onglets(page)).toHaveCount(2);
});

test("REQ035_AC13_shell_deja_ferme_404_ferme_le_dialogue_sans_message_refus_serveur_le_garde_ouvert", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveCount(2);
  // Refus : le dialogue reste ouvert avec la raison.
  await page.route("**/api/shells/2", (r) => (r.request().method() === "DELETE" ? r.fulfill({ status: 500, contentType: "text/plain", body: "disque plein" }) : r.fallback()));
  await fermer(page).click();
  const dlg = dialogue(page, "Fermer shell 2 ?");
  await dlg.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(dlg).toContainText("Impossible de fermer ce shell : disque plein.");
  await expect(onglets(page)).toHaveCount(2);
  // 404 : le dialogue se ferme et l'onglet disparaît, sans message.
  await page.unroute("**/api/shells/2");
  await page.route("**/api/shells/2", (r) => (r.request().method() === "DELETE" ? r.fulfill({ status: 404, body: "" }) : r.fallback()));
  await dlg.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(dlg).toHaveCount(0);
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("REQ021_AC3_un_shell_ferme_par_le_bouton_n_entraine_pas_de_message_apres_redemarrage", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveCount(2);
  await fermer(page).click();
  await dialogue(page, "Fermer shell 2 ?").getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  yaide = await yaide.relancer();
  await expect(page.getByRole("status").filter({ hasText: "Yaide a été arrêté. 1 shell a été fermé." })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Yaide a été arrêté. 2 shells")).toHaveCount(0);
});

test("REQ028_AC12_F_depuis_les_boutons_du_rail_affiche_les_fichiers", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const titres = { f: "Fichiers", r: "Recherche", g: "Git" };
  for (const nom of ["Nouveau shell", "Fermer le shell"]) {
    for (const touche of ["g", "r", "f"]) {
      await page.getByRole("button", { name: nom }).focus();
      await page.keyboard.press(touche);
      await expect(page.locator("aside h2")).toHaveText(titres[touche]);
      await expect.poll(() => page.evaluate(() => document.querySelector(".cadre-panneau").contains(document.activeElement))).toBe(true);
    }
  }
});

test("REQ019_AC2_fenetre_changee_sur_un_autre_onglet_le_shell_repris_remplit_sa_zone", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await ouvrirYaide(page, yaide.origine);
  const avant = await tailleStable(page);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await page.setViewportSize({ width: 1000, height: 640 });
  // xterm met son rendu en pause une fois le terminal hors de la vue : c'est ce cas qu'on vérifie.
  await page.waitForTimeout(500);
  await onglets(page).filter({ hasText: "shell 1" }).click();
  const apres = await tailleStable(page);
  expect(apres).not.toBe(avant);
  await taper(page, "stty size");
  await expect(ecran(page)).toContainText(apres);
});
