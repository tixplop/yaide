import { test, expect } from "@playwright/test";
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
const bouton = (page, nom) => page.getByRole("button", { name: nom, exact: true });
const poignee = (page) => page.getByRole("separator", { name: "Hauteur des shells" });
const menu = (page) => page.getByRole("menu", { name: "Shells réduits" });
const focusDansTerminal = (page) => page.evaluate(() => Boolean(document.activeElement?.closest(".terminal")));
const compteur = (page) => bouton(page, "Shells réduits").locator(".ya-badge");
// L'état gardé dans IndexedDB s'écrit après coup : on l'attend avant de recharger.
const attendreReduits = (page, n) =>
  expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((ok) => {
            const d = indexedDB.open("yaide", 1);
            d.onsuccess = () => {
              const r = d.result.transaction("cles").objectStore("cles").get("serveur");
              r.onsuccess = () => ok(r.result?.reduits?.length);
            };
          }),
      ),
    )
    .toBe(n);
const ouvrirMenu = async (page) => {
  await bouton(page, "Shells réduits").click();
  await expect(menu(page)).toBeVisible();
};

test("REQ040_AC1_AC2_AC3_AC4_AC7_AC8_AC13_AC15_AC16_AC17_AC21_deux_reductions_la_zone_disparait_et_revient", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await taper(page, "sleep 2 && echo fini");
  await bouton(page, "Nouveau shell").click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  const zone = page.locator(".cadre-shells");
  const hauteur = (await zone.boundingBox()).height;
  await expect(bouton(page, "Shells réduits")).toBeDisabled();
  await bouton(page, "Réduire le shell").click();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await expect(page.getByRole("tab", { name: "shell 1" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => focusDansTerminal(page)).toBe(true);
  await expect(compteur(page)).toHaveText("1");
  // Dernier shell visible : la zone et la poignée sortent de la page, l'éditeur va jusqu'à la barre d'état.
  await bouton(page, "Réduire le shell").click();
  await expect(poignee(page)).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Shells" })).toHaveCount(0);
  await expect(page.getByText("Aucun shell ouvert.")).toHaveCount(0);
  await expect(compteur(page)).toHaveText("2");
  const [code, barre] = await Promise.all([page.locator(".cadre-code").boundingBox(), page.locator("footer").boundingBox()]);
  expect(Math.abs(code.y + code.height - barre.y)).toBeLessThan(2);
  await expect(bouton(page, "Réduire le shell")).toBeDisabled();
  await expect(bouton(page, "Fermer le shell")).toBeDisabled();
  // Focus après un clic à la souris : contour, sans info-bulle.
  const reduits = bouton(page, "Shells réduits");
  await expect(reduits).toBeFocused();
  expect(await reduits.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
  await expect(page.getByRole("tooltip", { name: "Shells réduits" })).toHaveCount(0);
  // Menu : à droite du bouton, un nouveau clic le ferme sans le rouvrir.
  await expect(reduits).toHaveAttribute("aria-haspopup", "menu");
  await expect(reduits).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();
  await expect(reduits).toHaveAttribute("aria-expanded", "true");
  const [b, m] = await Promise.all([reduits.boundingBox(), menu(page).boundingBox()]);
  expect(Math.abs(m.x - (b.x + b.width + 4))).toBeLessThan(1.5);
  expect(Math.abs(m.y - b.y)).toBeLessThan(1.5);
  await expect(menu(page).getByRole("menuitem")).toHaveText(["shell 1", "shell 2"]);
  await expect(menu(page).getByRole("menuitem", { name: "shell 1" })).toBeFocused();
  await reduits.click();
  await expect(menu(page)).toHaveCount(0);
  await expect(reduits).toHaveAttribute("aria-expanded", "false");
  // Échap rend le focus au bouton ; Entrée, Bas, Entrée affiche shell 2 à la même hauteur.
  await reduits.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(reduits).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(onglets(page)).toHaveText(["shell 2"]);
  await expect.poll(() => focusDansTerminal(page)).toBe(true);
  expect((await zone.boundingBox()).height).toBeCloseTo(hauteur, 0);
  // Shell 1 revient avant shell 2, actif, et le programme a continué.
  await bouton(page, "Shells réduits").click();
  await menu(page).getByRole("menuitem", { name: "shell 1" }).click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await expect(page.getByRole("tab", { name: "shell 1" })).toHaveAttribute("aria-selected", "true");
  await expect(ecran(page)).toContainText("fini", { timeout: 10000 });
  // Les shells réduits le restent après un rechargement.
  await bouton(page, "Réduire le shell").click();
  await attendreReduits(page, 1);
  await page.reload();
  await expect(onglets(page)).toHaveText(["shell 2"]);
  await expect(compteur(page)).toHaveText("1");
});

test("REQ040_AC5_stty_size_est_juste_apres_un_changement_de_fenetre_pendant_la_reduction", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await bouton(page, "Réduire le shell").click();
  await expect(poignee(page)).toHaveCount(0);
  // Réafficher un shell réduit depuis la zone absente.
  await page.setViewportSize({ width: 1000, height: 640 });
  await ouvrirMenu(page);
  await menu(page).getByRole("menuitem", { name: "shell 1" }).click();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  const stable = await tailleStable(page);
  expect(stable).not.toBe("24 80");
  await taper(page, "stty size");
  await expect(ecran(page)).toContainText(stable);
  // Même vérification dans le shell que « Nouveau shell » ouvre zone absente.
  await bouton(page, "Réduire le shell").click();
  await expect(poignee(page)).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 600 });
  await bouton(page, "Nouveau shell").click();
  await expect(onglets(page)).toHaveText(["shell 2"]);
  const seconde = await tailleStable(page);
  expect(seconde).not.toBe("24 80");
  await taper(page, "stty size");
  await expect(ecran(page)).toContainText(seconde);
});

test("REQ040_AC22_la_taille_d_avant_la_reduction_est_gardee_et_un_rechargement_n_impose_pas_80_par_24", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  const avant = await tailleStable(page);
  expect(avant).not.toBe("24 80");
  await taper(page, "sleep 3; stty size");
  await bouton(page, "Réduire le shell").click();
  await attendreReduits(page, 1);
  await page.reload();
  await expect(bouton(page, "Shells réduits")).toBeEnabled();
  await expect(poignee(page)).toHaveCount(0);
  await page.waitForTimeout(3500);
  await ouvrirMenu(page);
  await menu(page).getByRole("menuitem", { name: "shell 1" }).click();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await expect(ecran(page)).toContainText(avant);
  await expect(ecran(page)).not.toContainText("0 0");
});

test("REQ040_AC9_tous_reduits_puis_rechargement_la_zone_reste_absente_et_la_hauteur_est_gardee", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await poignee(page).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
  const hauteur = await poignee(page).getAttribute("aria-valuenow");
  await bouton(page, "Réduire le shell").click();
  await attendreReduits(page, 1);
  await page.reload();
  await expect(bouton(page, "Shells réduits")).toBeEnabled();
  await page.waitForTimeout(1500);
  await expect(poignee(page)).toHaveCount(0);
  await expect(onglets(page)).toHaveCount(0);
  expect(await page.evaluate(async () => (await (await fetch("/api/shells")).json()).shells.length)).toBe(1);
  await ouvrirMenu(page);
  await page.keyboard.press("Enter");
  await expect(poignee(page)).toHaveAttribute("aria-valuenow", hauteur);
});

test("REQ040_AC10_AC19_un_shell_reduit_qui_se_termine_quitte_le_menu_sans_deplacer_le_focus", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const nouveau = async (numero, commande) => {
    await bouton(page, "Nouveau shell").click();
    await expect(page.getByRole("tab", { name: `shell ${numero}` })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => focusDansTerminal(page)).toBe(true);
    await taper(page, commande);
    await bouton(page, "Réduire le shell").click();
  };
  await nouveau(2, "sleep 2; exit");
  await nouveau(3, "sleep 60");
  await expect(compteur(page)).toHaveText("2");
  await ouvrirMenu(page);
  await expect(menu(page).getByRole("menuitem", { name: "shell 2" })).toBeFocused();
  // shell 2 se termine : la suivante prend le focus.
  await expect(menu(page).getByRole("menuitem")).toHaveText(["shell 3"], { timeout: 10000 });
  await expect(menu(page).getByRole("menuitem", { name: "shell 3" })).toBeFocused();
  // Fermé depuis une autre fenêtre, dernier réduit : le menu se ferme, le focus va sur « Nouveau shell ».
  await page.evaluate(() => fetch("/api/shells/3", { method: "DELETE" }));
  await expect(menu(page)).toHaveCount(0);
  await expect(bouton(page, "Shells réduits")).toBeDisabled();
  await expect(bouton(page, "Nouveau shell")).toBeFocused();
  // Focus sur « Shells réduits », menu fermé : le dernier réduit se termine, le focus va sur « Nouveau shell ».
  await nouveau(4, "sleep 2; exit");
  await bouton(page, "Shells réduits").focus();
  await expect(bouton(page, "Nouveau shell")).toBeFocused({ timeout: 10000 });
  await expect(bouton(page, "Shells réduits")).toBeDisabled();
  // Menu fermé, focus dans un terminal : un shell réduit qui se termine ne déplace pas le focus.
  await nouveau(5, "sleep 2; exit");
  await page.getByRole("tab", { name: "shell 1" }).click();
  await expect.poll(() => focusDansTerminal(page)).toBe(true);
  await expect(bouton(page, "Shells réduits")).toBeDisabled({ timeout: 10000 });
  await expect(onglets(page)).toHaveText(["shell 1"]);
  expect(await focusDansTerminal(page)).toBe(true);
  // Focus sur l'onglet : il y reste.
  await nouveau(6, "sleep 2; exit");
  await page.getByRole("tab", { name: "shell 1" }).focus();
  await expect(bouton(page, "Shells réduits")).toBeDisabled({ timeout: 10000 });
  await expect(page.getByRole("tab", { name: "shell 1" })).toBeFocused();
});

const dialogue = (page, titre) => page.getByRole("dialog", { name: titre });

test("REQ040_AC6_AC7_AC35_4_AC35_10_fermer_ou_terminer_avec_un_shell_reduit_present", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  for (const n of [2, 3]) {
    await bouton(page, "Nouveau shell").click();
    await expect(page.getByRole("tab", { name: `shell ${n}` })).toHaveAttribute("aria-selected", "true");
  }
  await page.getByRole("tab", { name: "shell 2" }).click();
  await bouton(page, "Réduire le shell").click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 3"]);
  // Fermer shell 1 : shell 3 devient actif, shell 2 reste réduit.
  await page.getByRole("tab", { name: "shell 1" }).click();
  await bouton(page, "Fermer le shell").click();
  await dialogue(page, "Fermer shell 1 ?").getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(onglets(page)).toHaveText(["shell 3"]);
  await expect(page.getByRole("tab", { name: "shell 3" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => focusDansTerminal(page)).toBe(true);
  // Fermer le dernier visible : la zone disparaît, shell 2 ne revient pas, le focus va sur « Shells réduits ».
  await bouton(page, "Fermer le shell").click();
  await dialogue(page, "Fermer shell 3 ?").getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(poignee(page)).toHaveCount(0);
  await expect(compteur(page)).toHaveText("1");
  await expect(bouton(page, "Shells réduits")).toBeFocused();
  // Idem avec « exit » : shell 2 réaffiché, puis un autre shell visible qui se termine.
  await ouvrirMenu(page);
  await page.keyboard.press("Enter");
  await bouton(page, "Nouveau shell").click();
  await expect(onglets(page)).toHaveText(["shell 2", "shell 4"]);
  await bouton(page, "Réduire le shell").click();
  await expect(onglets(page)).toHaveText(["shell 2"]);
  await taper(page, "exit");
  await expect(poignee(page)).toHaveCount(0);
  await expect(onglets(page)).toHaveCount(0);
  await expect(compteur(page)).toHaveText("1");
  await expect(bouton(page, "Shells réduits")).toBeFocused();
});

test("REQ040_AC7_la_fin_du_dernier_shell_visible_ne_deplace_pas_le_focus_de_l_editeur", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await bouton(page, "Nouveau shell").click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await bouton(page, "Réduire le shell").click();
  await taper(page, "sleep 2; exit");
  await page.getByRole("treeitem", { name: /^README\.md/ }).click();
  const editeur = page.getByRole("textbox", { name: "Éditeur README.md" });
  await expect(editeur).toBeFocused();
  await expect(poignee(page)).toHaveCount(0, { timeout: 10000 });
  await expect(editeur).toBeFocused();
});

test("REQ040_AC11_apres_un_redemarrage_les_reduits_comptent_dans_le_message_et_la_liste_se_vide", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await bouton(page, "Nouveau shell").click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await bouton(page, "Réduire le shell").click();
  await expect(compteur(page)).toHaveText("1");
  yaide = await yaide.relancer();
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Yaide a été arrêté. 2 shells ont été fermés." })).toBeVisible();
  await expect(onglets(page)).toHaveCount(0);
  await expect(bouton(page, "Shells réduits")).toBeDisabled();
  await bouton(page, "Nouveau shell").click();
  await expect(onglets(page)).toHaveText(["shell 1"]);
});

test("REQ040_AC12_pendant_une_coupure_reduire_et_afficher_marchent_et_la_connexion_revient", async ({ page }) => {
  await ouvrirYaide(page, relais.origine);
  await bouton(page, "Nouveau shell").click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  const bandeau = page.getByRole("alert").filter({ hasText: "Connexion perdue. Modifications gardées." });
  relais.couper();
  await expect(bandeau).toBeVisible({ timeout: 5000 });
  await bouton(page, "Réduire le shell").click();
  await expect(onglets(page)).toHaveText(["shell 1"]);
  await ouvrirMenu(page);
  await menu(page).getByRole("menuitem", { name: "shell 2" }).click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await bouton(page, "Réduire le shell").click();
  await expect(page.getByText("Réessayez au retour")).toHaveCount(0);
  relais.retablir();
  await expect(bandeau).toHaveCount(0, { timeout: 10000 });
  await ouvrirMenu(page);
  await menu(page).getByRole("menuitem", { name: "shell 2" }).click();
  await taper(page, "echo reprise_$((6*7))");
  await expect(ecran(page)).toContainText("reprise_42", { timeout: 10000 });
});

test("REQ040_AC14_AC18_vingt_shells_reduits_le_menu_reste_entier_et_defile", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.evaluate(async () => {
    for (let i = 0; i < 19; i++) await fetch("/api/shells", { method: "POST" });
  });
  await page.reload();
  await expect(onglets(page)).toHaveCount(20);
  await page.setViewportSize({ width: 800, height: 480 });
  for (let i = 0; i < 20; i++) await bouton(page, "Réduire le shell").click();
  await expect(compteur(page)).toHaveText("20");
  await ouvrirMenu(page);
  const boite = await menu(page).boundingBox();
  expect(boite.y).toBeGreaterThanOrEqual(0);
  expect(boite.y + boite.height).toBeLessThanOrEqual(480);
  expect(boite.x + boite.width).toBeLessThanOrEqual(800);
  expect(await menu(page).evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  await expect(menu(page).getByRole("menuitem")).toHaveCount(20);
  await page.keyboard.press("End");
  const dernier = menu(page).getByRole("menuitem", { name: "shell 20" });
  await expect(dernier).toBeFocused();
  const [d, m] = await Promise.all([dernier.boundingBox(), menu(page).boundingBox()]);
  expect(d.y).toBeGreaterThanOrEqual(m.y - 1);
  expect(d.y + d.height).toBeLessThanOrEqual(m.y + m.height + 1);
});

test("REQ040_AC5_fenetre_changee_pendant_la_reduction_le_terminal_remplit_sa_zone", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const avant = await tailleStable(page);
  await bouton(page, "Réduire le shell").click();
  await expect(poignee(page)).toHaveCount(0);
  await page.setViewportSize({ width: 1000, height: 640 });
  // xterm met son rendu en pause une fois le terminal hors de la vue : c'est ce cas qu'on vérifie.
  await page.waitForTimeout(500);
  await ouvrirMenu(page);
  await menu(page).getByRole("menuitem", { name: "shell 1" }).click();
  const apres = await tailleStable(page);
  expect(apres).not.toBe(avant);
  await taper(page, "stty size");
  await expect(ecran(page)).toContainText(apres);
});

test("REQ047_AC5_AC6_pastille_de_Nouveau_shell_fond_et_texte_lus_a_l_ecran_et_douze_shells_dans_le_bouton", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirYaide(page, yaide.origine);
  const nouveau = bouton(page, "Nouveau shell");
  const pastille = nouveau.locator(".ya-badge");
  await expect(pastille).toHaveText("1");
  const attendu = await page.evaluate(() => {
    const lire = (prop, v) => {
      const e = document.createElement("span");
      e.style[prop] = `var(${v})`;
      document.body.append(e);
      const r = getComputedStyle(e)[prop];
      e.remove();
      return r;
    };
    return { fond: lire("backgroundColor", "--bg-400"), texte: lire("color", "--ink") };
  });
  expect(await pastille.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(attendu.fond);
  expect(await pastille.evaluate((e) => getComputedStyle(e).color)).toBe(attendu.texte);
  for (let i = 0; i < 11; i++) await nouveau.click();
  await expect(pastille).toHaveText("12");
  const [b, p] = await Promise.all([nouveau.boundingBox(), pastille.boundingBox()]);
  expect(p.x).toBeGreaterThanOrEqual(b.x);
  expect(p.y).toBeGreaterThanOrEqual(b.y);
  expect(p.x + p.width).toBeLessThanOrEqual(b.x + b.width);
  expect(p.y + p.height).toBeLessThanOrEqual(b.y + b.height);
});
