import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, nomLigne, gardeContient, avancer } from "./aides.js";
import { lancerRelais } from "./relais.js";

let yaide;
let relais;
let dossier;
test.beforeEach(async ({ page }) => {
  await page.clock.install();
  yaide = await lancerYaide({ shell: "/bin/sh" });
  dossier = yaide.dossier;
  relais = await lancerRelais(yaide.port);
});
test.afterEach(async () => {
  relais.fermer();
  await yaide.arreter();
});

const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const onglet = (page, nom) => page.getByRole("tab", { name: nom });
/** Onglet de `f` dans l'état `etat` (« , non sauvegardé ») ; un fichier neuf porte en plus « , nouveau ». */
const ongletEtat = (page, f, etat) => page.getByRole("tab", { name: new RegExp(`^${f.replace(".", "\\.")}(, nouveau)?${etat}`) });
const editeur = (page, f = "main.rs") => page.getByRole("textbox", { name: `Éditeur ${f}` });
const question = (page, f = "main.rs") => page.getByRole("alert").filter({ hasText: `${f} a changé sur le disque. Quelle version garder ?` });
const garderMa = (page) => page.getByRole("button", { name: "Garder ma version" });
const fichier = (f) => path.join(dossier, f);
const prendre = (page) => page.getByRole("button", { name: "Prendre celle du disque" });
const main = () => path.join(dossier, "src", "main.rs");
const DISQUE = "// du disque\nfn main() {}\n";
const bandeau = (page) => page.getByRole("alert").filter({ hasText: "Connexion perdue. Modifications gardées." });

async function ouvrirMain(page, dejaConnecte = false, avecShell = false) {
  if (dejaConnecte) await page.goto(relais.origine + "/");
  else await ouvrirYaide(page, relais.origine, "mdp", { shell: avecShell });
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  await expect(editeur(page)).toBeFocused();
}
const CONTENU = "fn main() {\n    println!(\"salut\");\n}\n";
/** Crée le fichier `f` à la racine du projet et l'ouvre par l'interface. */
async function ouvrirFichier(page, f, contenu = CONTENU) {
  fs.writeFileSync(fichier(f), contenu);
  await avancer(page, () => ligne(page, f).click({ timeout: 300 }));
  await expect(editeur(page, f)).toBeFocused();
}
/** Ferme l'onglet de `f` (enregistré, sans question) : l'étape suivante part d'un état propre. */
async function fermer(page, f) {
  await expect(page.getByRole("tab", { name: new RegExp(`^${f.replace(".", "\\.")}(, nouveau)?$`) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`Fermer ${f.replace(".", "\\.")}`) }).click();
  await expect(onglet(page, f)).toHaveCount(0);
}
async function taper(page, texte, f = "main.rs") {
  await editeur(page, f).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(texte);
}
async function couper(page) {
  relais.couper();
  await avancer(page, () => expect(bandeau(page)).toBeVisible({ timeout: 300 }));
}
async function retablir(page) {
  relais.retablir();
  await avancer(page, () => expect(bandeau(page)).toHaveCount(0, { timeout: 300 }));
}

// Les tests regroupés partagent l'horloge et le relais du beforeEach ; chaque étape travaille sur son propre fichier, ouvert par l'interface puis fermé.
test("REQ017_AC1_AC7_sans_modification_nouveau_contenu_curseur_et_deux_onglets_du_navigateur", async ({ page, context }) => {
  await ouvrirYaide(page, relais.origine, "mdp", { shell: false });
  await test.step("REQ017_AC1_fichier_sans_modification_change_sur_le_disque_affiche_le_nouveau_contenu", async () => {
    const f = "un.rs";
    await ouvrirFichier(page, f);
    fs.writeFileSync(fichier(f), DISQUE);
    await avancer(page, () => expect(editeur(page, f)).toContainText("// du disque", { timeout: 300 }));
    await expect(question(page, f)).toHaveCount(0);
    await expect(onglet(page, f)).toBeVisible();
    await fermer(page, f);
  });
  await test.step("REQ017_AC1_le_curseur_reste_sur_la_meme_ligne_au_rechargement", async () => {
    const f = "deux.rs";
    await ouvrirFichier(page, f);
    await page.keyboard.press("Control+End"); // dernière ligne vide, ligne 4
    fs.writeFileSync(fichier(f), "1\n2\n3\n4\n5\n");
    await avancer(page, () => expect(editeur(page, f)).toContainText("5", { timeout: 300 }));
    await page.keyboard.type("Z");
    await expect(page.locator(".cm-line").nth(3)).toHaveText("Z4");
    await page.keyboard.press("Control+s");
    await fermer(page, f);
  });
  await test.step("REQ017_AC7_deux_onglets_du_navigateur_sans_modification_l_autre_affiche_le_nouveau_contenu", async () => {
    const f = "trois.rs";
    await ouvrirFichier(page, f);
    const page2 = await context.newPage();
    await page2.goto(relais.origine + "/");
    await ligne(page2, f).click();
    await expect(editeur(page2, f)).toBeFocused();
    await taper(page, "// ecrit\n", f);
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(fichier(f), "utf8")).toContain("// ecrit");
    await avancer(page2, () => expect(editeur(page2, f)).toContainText("// ecrit", { timeout: 300 }));
    await expect(question(page2, f)).toHaveCount(0);
    await expect(question(page, f)).toHaveCount(0);
    await page2.close();
    await fermer(page, f);
  });
});

test("REQ017_AC1_AC2_AC3_AC4_AC10_AC11_question_garder_ma_version_prendre_celle_du_disque", async ({ page }) => {
  await ouvrirYaide(page, relais.origine, "mdp", { shell: false });
  await test.step("REQ017_AC2_AC10_AC11_fichier_modifie_change_sur_le_disque_pose_la_question_sans_prendre_le_focus", async () => {
    const f = "un.rs";
    await ouvrirFichier(page, f);
    await taper(page, "// moi\n", f);
    fs.writeFileSync(fichier(f), DISQUE);
    await avancer(page, () => expect(question(page, f)).toBeVisible({ timeout: 300 }));
    await expect(garderMa(page)).toBeVisible();
    await expect(prendre(page)).toBeVisible();
    await expect(editeur(page, f)).toBeFocused();
    await expect(ongletEtat(page, f, ", non sauvegardé, question en attente")).toBeVisible();
    await expect(ongletEtat(page, f, ", non sauvegardé, question en attente")).toContainText("!");
    await prendre(page).click();
    await expect(question(page, f)).toHaveCount(0);
    await fermer(page, f);
  });
  await test.step("REQ017_AC1_un_changement_de_date_seule_ne_change_rien", async () => {
    const f = "deux.rs";
    await ouvrirFichier(page, f);
    await taper(page, "// moi\n", f);
    const futur = new Date(Date.now() + 60000);
    fs.utimesSync(fichier(f), futur, futur);
    for (let i = 0; i < 2; i++) {
      const reponse = page.waitForResponse((r) => r.url().includes("/api/fichiers/versions"));
      await page.clock.fastForward(1500);
      await reponse;
    }
    await expect(question(page, f)).toHaveCount(0);
    await expect(editeur(page, f)).toContainText("// moi");
    await page.keyboard.press("Control+s");
    await expect(ongletEtat(page, f, ", non sauvegardé")).toHaveCount(0);
    await fermer(page, f);
  });
  await test.step("REQ017_AC3_garder_sa_version_garde_le_texte_et_ctrl_s_ecrase_sans_redemander", async () => {
    const f = "trois.rs";
    await ouvrirFichier(page, f);
    await taper(page, "// moi\n", f);
    fs.writeFileSync(fichier(f), DISQUE);
    await avancer(page, () => garderMa(page).click({ timeout: 300 }));
    await expect(question(page, f)).toHaveCount(0);
    await expect(editeur(page, f)).toContainText("// moi");
    await expect(ongletEtat(page, f, ", non sauvegardé")).toBeVisible();
    await editeur(page, f).click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(fichier(f), "utf8")).toContain("// moi");
    await expect(ongletEtat(page, f, ", non sauvegardé")).toHaveCount(0);
    await expect(question(page, f)).toHaveCount(0);
    await fermer(page, f);
  });
  await test.step("REQ017_AC4_prendre_celle_du_disque_affiche_le_disque_sans_point", async () => {
    const f = "quatre.rs";
    await ouvrirFichier(page, f);
    await taper(page, "// moi\n", f);
    fs.writeFileSync(fichier(f), DISQUE);
    await avancer(page, () => prendre(page).click({ timeout: 300 }));
    await expect(question(page, f)).toHaveCount(0);
    await expect(editeur(page, f)).toContainText("// du disque");
    await expect(editeur(page, f)).not.toContainText("// moi");
    await expect(onglet(page, f)).toBeVisible();
    await expect(ongletEtat(page, f, ", non sauvegardé")).toHaveCount(0);
    await fermer(page, f);
  });
});

test("REQ017_AC6_AC8_AC9_AC12_AC13_suppression_deux_onglets_coupure_et_fermeture", async ({ page, context }) => {
  await ouvrirYaide(page, relais.origine, "mdp", { shell: false });
  await test.step("REQ017_AC9_AC13_fichier_supprime_hors_de_yaide_garde_l_onglet_et_ctrl_s_le_recree", async () => {
    const f = "un.rs";
    await ouvrirFichier(page, f);
    await taper(page, "// reste\n", f);
    fs.rmSync(fichier(f));
    const msg = page.getByRole("alert").filter({ hasText: "Fichier supprimé du disque. Ctrl+S le recrée." });
    await avancer(page, () => expect(msg).toBeVisible({ timeout: 300 }));
    await expect(editeur(page, f)).toContainText("// reste");
    await editeur(page, f).click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.existsSync(fichier(f))).toBe(true);
    expect(fs.readFileSync(fichier(f), "utf8")).toContain("// reste");
    await expect(msg).toHaveCount(0);
    await expect(ongletEtat(page, f, ", non sauvegardé")).toHaveCount(0);
    await fermer(page, f);
  });
  await test.step("REQ017_AC8_deux_onglets_du_navigateur_modifies_l_autre_demande_quelle_version_garder", async () => {
    const f = "deux.rs";
    await ouvrirFichier(page, f);
    const page2 = await context.newPage();
    await page2.goto(relais.origine + "/");
    await ligne(page2, f).click();
    await expect(editeur(page2, f)).toBeFocused();
    await taper(page2, "// autre\n", f);
    await taper(page, "// ecrit\n", f);
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFileSync(fichier(f), "utf8")).toContain("// ecrit");
    await avancer(page2, () => expect(question(page2, f)).toBeVisible({ timeout: 300 }));
    await expect(editeur(page2, f)).toContainText("// autre");
    await expect(question(page, f)).toHaveCount(0);
    await page2.close();
    await fermer(page, f);
  });
  await test.step("REQ017_AC6_ctrl_s_en_attente_et_fichier_change_la_question_est_posee_sans_ecraser", async () => {
    const f = "quatre.rs";
    await ouvrirFichier(page, f);
    await couper(page);
    await taper(page, "// moi\n", f);
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("alert").filter({ hasText: `${f} sera sauvegardé au retour.` })).toBeVisible();
    fs.writeFileSync(fichier(f), DISQUE);
    await retablir(page);
    await avancer(page, () => expect(question(page, f)).toBeVisible({ timeout: 300 }));
    expect(fs.readFileSync(fichier(f), "utf8")).toBe(DISQUE);
    await expect(page.getByRole("alert").filter({ hasText: "sera sauvegardé au retour." })).toHaveCount(0);
    await prendre(page).click();
    await expect(question(page, f)).toHaveCount(0);
    await fermer(page, f);
  });
  await test.step("REQ017_AC12_question_en_attente_ctrl_s_et_fermeture_n_ecrivent_ni_ne_ferment", async () => {
    const f = "cinq.rs";
    await ouvrirFichier(page, f);
    await taper(page, "// moi\n", f);
    fs.writeFileSync(fichier(f), DISQUE);
    await avancer(page, () => expect(question(page, f)).toBeVisible({ timeout: 300 }));
    await editeur(page, f).click();
    await page.keyboard.press("Control+s");
    await expect(garderMa(page)).toBeFocused();
    expect(fs.readFileSync(fichier(f), "utf8")).toBe(DISQUE);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Fermeture depuis un autre onglet actif : l'onglet de la question devient actif.
    await ligne(page, "README.md").click();
    await expect(question(page, f)).toHaveCount(0);
    await page.getByRole("button", { name: /Fermer cinq\.rs/ }).click();
    await expect(question(page, f)).toBeVisible();
    await expect(garderMa(page)).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(ongletEtat(page, f, ", non sauvegardé, question en attente")).toBeVisible();
    await prendre(page).click();
    await expect(question(page, f)).toHaveCount(0);
    await fermer(page, f);
  });
});

test("REQ017_AC10_le_focus_reste_dans_le_terminal_quand_la_question_apparait", async ({ page }) => {
  await ouvrirYaide(page, relais.origine, "mdp", { shell: true });
  await test.step("REQ017_AC10_le_focus_reste_dans_le_terminal_quand_la_question_apparait", async () => {
    const f = "un.rs";
    await ouvrirFichier(page, f);
    await taper(page, "// moi\n", f);
    const focusDansTerminal = () => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea"));
    await page.locator(".terminal:visible .xterm-helper-textarea").focus();
    expect(await focusDansTerminal()).toBe(true);
    fs.writeFileSync(fichier(f), DISQUE);
    await avancer(page, () => expect(question(page, f)).toBeVisible({ timeout: 300 }));
    expect(await focusDansTerminal()).toBe(true);
    await expect(ongletEtat(page, f, ", non sauvegardé, question en attente")).toContainText("!");
    await prendre(page).click();
    await expect(question(page, f)).toHaveCount(0);
    await fermer(page, f);
  });
});

test("REQ017_AC5_changement_pendant_la_coupure_la_question_est_posee_au_retour", async ({ page }) => {
  await ouvrirMain(page);
  await couper(page);
  await taper(page, "// moi\n");
  await gardeContient(page, "// moi");
  fs.writeFileSync(main(), DISQUE);
  await retablir(page);
  await avancer(page, () => expect(question(page)).toBeVisible({ timeout: 300 }));
  expect(fs.readFileSync(main(), "utf8")).toBe(DISQUE);
});

test("REQ017_AC5_brouillon_restaure_garde_sa_version_de_base", async ({ page }) => {
  await ouvrirMain(page);
  await taper(page, "// moi\n");
  await gardeContient(page, "// moi");
  await page.goto("about:blank");
  fs.writeFileSync(main(), DISQUE);
  await page.goto(relais.origine + "/");
  await avancer(page, () => expect(question(page)).toBeVisible({ timeout: 300 }));
  await expect(editeur(page)).toContainText("// moi");
  expect(fs.readFileSync(main(), "utf8")).toBe(DISQUE);
});
