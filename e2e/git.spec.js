import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide } from "./aides.js";

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

const g = (dossier, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd: dossier, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} : ${r.stderr}`);
  return r.stdout;
};

/** Dépôt d'exemple sur `main`, avec une identité locale pour que Yaide puisse valider. */
function depot() {
  const dossier = depotExemple();
  g(dossier, "branch", "-M", "main");
  g(dossier, "config", "user.name", "Test");
  g(dossier, "config", "user.email", "t@example.org");
  return dossier;
}

async function ouvrir(page, dossier) {
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
}
const panneauGit = async (page) => {
  await page.getByRole("tab", { name: "Git" }).click();
  await expect(page.getByRole("heading", { name: "Git" })).toBeVisible();
};
const changements = (page) => page.getByRole("listbox", { name: "Changements" });
const ligne = (page, chemin) => changements(page).getByRole("option").filter({ hasText: chemin });
const ongletDiff = (page, nom) => page.getByRole("tab", { name: `${nom} (diff)` });
const message = (page) => page.getByRole("textbox", { name: "Message" });
const barre = (page) => page.locator("header");

test("REQ022_AC1_AC2_AC6_AC7_changements_statuts_et_un_seul_onglet_de_diff", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "src", "main.rs"), 'fn main() {\n    println!("bonjour");\n}\n');
  fs.writeFileSync(path.join(dossier, "neuf.txt"), "tout neuf\n");
  await ouvrir(page, dossier);
  await panneauGit(page);
  await expect(ligne(page, "src/main.rs")).toContainText("modifié");
  await expect(ligne(page, "neuf.txt")).toContainText("nouveau");
  await ligne(page, "src/main.rs").click();
  await expect(ongletDiff(page, "main.rs")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Diff main.rs")).toContainText('-    println!("salut");');
  await expect(page.getByLabel("Diff main.rs")).toContainText('+    println!("bonjour");');
  await expect(ligne(page, "src/main.rs")).toHaveAttribute("aria-selected", "true");
  await ligne(page, "neuf.txt").click();
  await expect(ongletDiff(page, "neuf.txt")).toBeVisible();
  await expect(ongletDiff(page, "main.rs")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /\(diff\)/ })).toHaveCount(1);
  await expect(page.getByLabel("Diff neuf.txt")).toContainText("+tout neuf");
});

test("REQ022_AC1_modifier_et_sauvegarder_main_rs_le_fait_apparaitre_dans_les_changements", async ({ page }) => {
  await ouvrir(page, depot());
  await panneauGit(page);
  await expect(page.getByText("Aucun changement.")).toBeVisible();
  await page.getByRole("tab", { name: "Fichiers" }).click();
  await page.getByRole("treeitem", { name: "src", exact: true }).click();
  await page.getByRole("treeitem", { name: "main.rs", exact: true }).click();
  const editeur = page.getByLabel("Éditeur main.rs");
  await editeur.click();
  await page.keyboard.type("// ajout\n");
  await expect(page.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("tab", { name: "main.rs", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Git" }).click();
  await expect(ligne(page, "src/main.rs")).toContainText("modifié");
  await ligne(page, "src/main.rs").click();
  await expect(page.getByLabel("Diff main.rs")).toContainText("+// ajout");
});

test("REQ022_AC7_fermer_le_dernier_fichier_laisse_l_onglet_de_diff", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "src", "main.rs"), "fn main() {}\n");
  await ouvrir(page, dossier);
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await panneauGit(page);
  await ligne(page, "src/main.rs").click();
  await expect(ongletDiff(page, "main.rs")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "README.md" }).click();
  await page.getByRole("tab", { name: "README.md" }).press("Delete");
  await expect(page.getByRole("tab", { name: "README.md" })).toHaveCount(0);
  await expect(ongletDiff(page, "main.rs")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Diff main.rs")).toBeVisible();
});

test("REQ022_AC3_et_REQ028_AC2_la_barre_du_haut_affiche_la_branche", async ({ page }) => {
  await ouvrir(page, depot());
  await expect(barre(page)).toContainText("branche: main");
  await expect(barre(page).getByRole("button", { name: "Déconnexion" })).toBeVisible();
});

test("REQ022_AC4_dossier_sans_depot_git", async ({ page }) => {
  const racine = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "nu-"));
  const dossier = path.join(racine, "projet");
  fs.mkdirSync(dossier);
  fs.writeFileSync(path.join(dossier, "a.txt"), "a");
  await ouvrir(page, dossier);
  await panneauGit(page);
  await expect(page.getByText("Ce dossier n'est pas un dépôt git.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit" })).toHaveCount(0);
  await expect(barre(page)).not.toContainText("branche:");
});

test("REQ022_AC5_aucun_changement", async ({ page }) => {
  await ouvrir(page, depot());
  await panneauGit(page);
  await expect(page.getByText("Aucun changement.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit" })).toBeVisible();
});

test("REQ022_AC8_diff_d_un_binaire", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "image.bin"), Buffer.from([0, 1, 2, 0, 255]));
  await ouvrir(page, dossier);
  await panneauGit(page);
  await ligne(page, "image.bin").click();
  await expect(page.getByText("Fichier binaire : pas de diff.")).toBeVisible();
});

test("REQ023_AC1_AC6_AC7_AC8_indexer_valider_les_autres_restent_et_l_onglet_se_ferme", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "src", "main.rs"), "fn main() {}\n");
  fs.writeFileSync(path.join(dossier, "README.md"), "# Autre\n");
  await ouvrir(page, dossier);
  await panneauGit(page);
  await ligne(page, "src/main.rs").click();
  await expect(ongletDiff(page, "main.rs")).toBeVisible();
  await expect(ligne(page, "src/main.rs")).toHaveAttribute("aria-keyshortcuts", "I");
  await page.getByRole("button", { name: "Indexer main.rs" }).click();
  await expect(ligne(page, "src/main.rs")).toContainText("indexé");
  await expect(page.getByRole("button", { name: "Indexer main.rs" })).toHaveCount(0);
  await message(page).fill("Simplifie main");
  await message(page).press("Control+Enter");
  await expect(page.getByText("Commit créé.")).toBeVisible();
  await expect(message(page)).toHaveValue("");
  await expect(ligne(page, "src/main.rs")).toHaveCount(0);
  await expect(ligne(page, "README.md")).toContainText("modifié");
  await expect(ongletDiff(page, "main.rs")).toHaveCount(0);
  expect(g(dossier, "log", "-1", "--format=%s").trim()).toBe("Simplifie main");
});

test("REQ023_AC6_touche_I_sur_la_ligne_indexe", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "README.md"), "# Autre\n");
  await ouvrir(page, dossier);
  await panneauGit(page);
  await ligne(page, "README.md").focus();
  await page.keyboard.press("i");
  await expect(ligne(page, "README.md")).toContainText("indexé");
});

test("REQ023_AC2_AC3_AC5_refus_du_commit_avec_messages_et_focus", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "README.md"), "# Autre\n");
  await ouvrir(page, dossier);
  await panneauGit(page);
  await message(page).fill("Un message");
  await page.getByRole("button", { name: "Commit" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Aucun fichier indexé. Indexez au moins un fichier." })).toBeVisible();
  await page.getByRole("button", { name: "Indexer README.md" }).click();
  await message(page).fill("");
  await page.getByRole("button", { name: "Commit" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Écrivez un message de commit." })).toBeVisible();
  await expect(message(page)).toBeFocused();
  expect(g(dossier, "log", "--format=%s").trim()).toBe("départ");
});

test("REQ023_AC4_echec_de_git_au_commit_montre_le_message_de_git", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "README.md"), "# Autre\n");
  const hook = path.join(dossier, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\necho refus du hook de test >&2\nexit 1\n", { mode: 0o755 });
  await ouvrir(page, dossier);
  await panneauGit(page);
  await page.getByRole("button", { name: "Indexer README.md" }).click();
  await message(page).fill("Essai");
  await page.getByRole("button", { name: "Commit" }).click();
  const alerte = page.getByRole("alert").filter({ hasText: "Git a refusé." });
  await expect(alerte).toContainText("refus du hook de test");
});

test("REQ024_AC1_AC3_changer_de_branche_et_les_fichiers_ouverts_suivent_le_disque", async ({ page }) => {
  const dossier = depot();
  g(dossier, "switch", "-q", "-c", "travail");
  fs.writeFileSync(path.join(dossier, "README.md"), "# Branche travail\n");
  g(dossier, "commit", "-q", "-am", "travail");
  g(dossier, "switch", "-q", "main");
  await ouvrir(page, dossier);
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await expect(page.getByLabel("Éditeur README.md")).toContainText("# Titre");
  await panneauGit(page);
  const choix = page.getByLabel("Branche");
  await expect(choix.locator("option")).toHaveText(["main", "travail"]);
  await choix.selectOption("travail");
  await expect(barre(page)).toContainText("branche: travail");
  await expect(page.getByLabel("Éditeur README.md")).toContainText("# Branche travail");
  expect(g(dossier, "branch", "--show-current").trim()).toBe("travail");
});

test("REQ024_AC2_changement_refuse_message_de_git_et_branche_inchangee", async ({ page }) => {
  const dossier = depot();
  g(dossier, "switch", "-q", "-c", "travail");
  fs.writeFileSync(path.join(dossier, "README.md"), "# Branche travail\n");
  g(dossier, "commit", "-q", "-am", "travail");
  g(dossier, "switch", "-q", "main");
  fs.writeFileSync(path.join(dossier, "README.md"), "# Modifié en local\n");
  await ouvrir(page, dossier);
  await panneauGit(page);
  await page.getByLabel("Branche").selectOption("travail");
  await expect(page.getByRole("alert").filter({ hasText: "Git a refusé." })).toContainText("README.md");
  await expect(page.getByLabel("Branche")).toHaveValue("main");
  await expect(barre(page)).toContainText("branche: main");
});

/** Dépôt avec un distant nu, cloné une fois. */
function depotAvecDistant() {
  const dossier = depot();
  const distant = path.join(path.dirname(dossier), "distant.git");
  g(path.dirname(dossier), "init", "-q", "--bare", distant);
  g(dossier, "remote", "add", "origin", distant);
  g(dossier, "push", "-q", "-u", "origin", "main");
  return { dossier, distant };
}

test("REQ025_AC1_AC4_pull_et_push_reussis", async ({ page }) => {
  const { dossier, distant } = depotAvecDistant();
  const autre = path.join(path.dirname(dossier), "autre");
  g(path.dirname(dossier), "clone", "-q", "-b", "main", distant, autre);
  fs.writeFileSync(path.join(autre, "distant.txt"), "d\n");
  g(autre, "add", "-A");
  g(autre, "commit", "-q", "-m", "du distant");
  g(autre, "push", "-q");
  await ouvrir(page, dossier);
  await panneauGit(page);
  await page.getByRole("button", { name: "Pull" }).click();
  await expect(page.getByText("Pull terminé.")).toBeVisible();
  expect(fs.existsSync(path.join(dossier, "distant.txt"))).toBe(true);
  fs.writeFileSync(path.join(dossier, "README.md"), "# Local\n");
  g(dossier, "commit", "-q", "-am", "local");
  await page.getByRole("button", { name: "Push" }).click();
  await expect(page.getByText("Push terminé.")).toBeVisible();
  expect(g(distant, "log", "-1", "--format=%s", "main").trim()).toBe("local");
});

test("REQ025_AC4_pendant_la_commande_le_bouton_est_occupe_et_les_autres_desactives", async ({ page }) => {
  const { dossier } = depotAvecDistant();
  const hook = path.join(dossier, ".git", "hooks", "pre-push");
  const libere = path.join(path.dirname(dossier), "libere");
  // Le hook attend un fichier que le test crée : aucune durée fixe.
  fs.writeFileSync(hook, `#!/bin/sh\nwhile [ ! -f "${libere}" ]; do sleep 0.1; done\n`, { mode: 0o755 });
  await ouvrir(page, dossier);
  await panneauGit(page);
  await page.getByRole("button", { name: "Push" }).click();
  const occupe = page.getByRole("button", { name: "Push" });
  await expect(occupe).toHaveText("Push…");
  await expect(occupe).toBeDisabled();
  await expect(occupe).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Pull" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Commit" })).toBeDisabled();
  await expect(page.getByLabel("Branche")).toBeDisabled();
  fs.writeFileSync(libere, "");
  await expect(page.getByText("Push terminé.")).toBeVisible();
});

test("REQ025_AC2_AC3_AC5_echec_du_push_message_de_git_et_renvoi_vers_le_shell", async ({ page }) => {
  const { dossier } = depotAvecDistant();
  fs.writeFileSync(path.join(dossier, ".git", "hooks", "pre-push"), "#!/bin/sh\necho push interdit ici >&2\nexit 1\n", { mode: 0o755 });
  await ouvrir(page, dossier);
  await panneauGit(page);
  await page.getByRole("button", { name: "Push" }).click();
  const alerte = page.getByRole("alert").filter({ hasText: "Git a refusé. Réglez cela dans le shell." });
  await expect(alerte).toContainText("push interdit ici");
  await expect(page.getByRole("button", { name: "Push" })).toBeEnabled();
});

test("REQ028_AC1_F_R_G_changent_de_panneau_sans_toucher_aux_onglets", async ({ page }) => {
  await ouvrir(page, depot());
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await expect(page.getByRole("tab", { name: "README.md" })).toBeVisible();
  await page.getByRole("tab", { name: "Fichiers" }).focus();
  await page.keyboard.press("g");
  await expect(page.getByRole("heading", { name: "Git" })).toBeVisible();
  await expect(page.getByLabel("Branche")).toBeVisible();
  await page.getByRole("tab", { name: "Fichiers" }).click();
  await expect(page.getByRole("heading", { name: "Fichiers" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "README.md" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();
});

test("REQ034_AC8_commit_du_menu_montre_le_panneau_git_avec_le_focus_dans_message_sans_rien_valider", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "neuf.txt"), "neuf\n");
  await ouvrir(page, dossier);
  await panneauGit(page);
  await message(page).fill("déjà écrit");
  await page.getByRole("tab", { name: "Fichiers", exact: true }).click();
  await page.getByRole("treeitem", { name: "neuf.txt", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Commit" }).click();
  await expect(page.getByRole("heading", { name: "Git" })).toBeVisible();
  await expect(message(page)).toBeFocused();
  await expect(message(page)).toHaveValue("déjà écrit");
  await expect(page.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
  expect(g(dossier, "log", "--oneline").trim().split("\n")).toHaveLength(1);
  expect(g(dossier, "diff", "--cached", "--name-only")).toBe("");
});
