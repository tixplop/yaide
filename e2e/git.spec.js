import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne } from "./aides.js";

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

async function ouvrir(page, dossier, avecShell = false) {
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: avecShell });
}
const panneauGit = async (page) => {
  await page.getByRole("tab", { name: "Git" }).click();
  await expect(page.getByRole("heading", { name: "Git" })).toBeVisible();
};
const changements = (page) => page.getByRole("listbox", { name: "Changements" });
/** Une ligne se retrouve par son nom de fichier : le dossier est affiché à part. */
const ligne = (page, chemin) => changements(page).getByRole("option", { name: nomLigne(chemin.split("/").pop()) });
const ongletDiff = (page, nom) => page.getByRole("tab", { name: `${nom} (diff)` });
const message = (page) => page.getByRole("textbox", { name: "Message" });
const barre = (page) => page.locator("footer");

test("REQ022_AC1_modifier_et_sauvegarder_main_rs_le_fait_apparaitre_dans_les_changements", async ({ page }) => {
  await ouvrir(page, depot());
  await panneauGit(page);
  await expect(page.getByText("Aucun changement.")).toBeVisible();
  await page.getByRole("tab", { name: "Fichiers" }).click();
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("main.rs") }).click();
  const editeur = page.getByLabel("Éditeur main.rs");
  await editeur.click();
  await page.keyboard.type("// ajout\n");
  await expect(page.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("tab", { name: "main.rs, modifié", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Git" }).click();
  await expect(ligne(page, "src/main.rs")).toHaveAccessibleName("main.rs, modifié");
  await ligne(page, "src/main.rs").click();
  await expect(page.getByLabel("Diff main.rs")).toContainText("+// ajout");
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
  await expect(ligne(page, "src/main.rs")).toHaveAccessibleName("main.rs, modifié, indexé");
  await expect(page.getByRole("button", { name: "Indexer main.rs" })).toHaveCount(0);
  await expect(changements(page).getByText("Modifications indexées")).toBeVisible();
  await message(page).fill("Simplifie main");
  await message(page).press("Control+Enter");
  await expect(page.getByText("Commit créé.")).toBeVisible();
  await expect(message(page)).toHaveValue("");
  await expect(ligne(page, "src/main.rs")).toHaveCount(0);
  await expect(ligne(page, "README.md")).toHaveAccessibleName("README.md, modifié");
  await expect(ongletDiff(page, "main.rs")).toHaveCount(0);
  expect(g(dossier, "log", "-1", "--format=%s").trim()).toBe("Simplifie main");
});

test("REQ024_AC1_AC3_changer_de_branche_et_les_fichiers_ouverts_suivent_le_disque", async ({ page }) => {
  const dossier = depot();
  g(dossier, "switch", "-q", "-c", "travail");
  fs.writeFileSync(path.join(dossier, "README.md"), "# Branche travail\n");
  g(dossier, "commit", "-q", "-am", "travail");
  g(dossier, "switch", "-q", "main");
  await ouvrir(page, dossier);
  await page.getByRole("treeitem", { name: nomLigne("README.md") }).click();
  await expect(page.getByLabel("Éditeur README.md")).toContainText("# Titre");
  await panneauGit(page);
  const choix = page.getByLabel("Branche");
  await expect(choix.locator("option")).toHaveText(["main", "travail"]);
  await choix.selectOption("travail");
  await expect(barre(page)).toContainText("travail");
  await expect(page.getByLabel("Éditeur README.md")).toContainText("# Branche travail");
  expect(g(dossier, "branch", "--show-current").trim()).toBe("travail");
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

test("REQ031_AC10_pendant_un_pull_le_bouton_n_est_pas_attenue", async ({ page }) => {
  const { dossier } = depotAvecDistant();
  // Le serveur du dépôt distant attend un fichier que le test crée : aucune durée fixe.
  const libere = path.join(path.dirname(dossier), "libere-pull");
  const attente = path.join(path.dirname(dossier), "attente-pull.sh");
  fs.writeFileSync(attente, `#!/bin/sh\nwhile [ ! -f "${libere}" ]; do sleep 0.1; done\nexec git-upload-pack "$@"\n`, { mode: 0o755 });
  g(dossier, "config", "remote.origin.uploadpack", attente);
  await ouvrir(page, dossier);
  await panneauGit(page);
  await page.getByRole("button", { name: "Pull" }).click();
  const occupe = page.getByRole("button", { name: "Pull" });
  await expect(occupe).toHaveAttribute("aria-busy", "true");
  await expect(occupe).toHaveText("Pull…");
  // Le panneau peut refaire ses boutons : on relit la valeur jusqu'à ce qu'elle vienne d'un bouton présent.
  try {
    await expect.poll(() => occupe.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    await expect.poll(() => page.getByRole("button", { name: "Push" }).evaluate((e) => getComputedStyle(e).opacity)).not.toBe("1");
  } finally {
    fs.writeFileSync(libere, "");
  }
  await expect(page.getByText("Pull terminé.")).toBeVisible();
});

test("REQ028_AC1_F_R_G_changent_de_panneau_sans_toucher_aux_onglets", async ({ page }) => {
  await ouvrir(page, depot(), true);
  await page.getByRole("treeitem", { name: nomLigne("README.md") }).click();
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
  await page.getByRole("treeitem", { name: nomLigne("neuf.txt") }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Commit" }).click();
  await expect(page.getByRole("heading", { name: "Git" })).toBeVisible();
  await expect(message(page)).toBeFocused();
  await expect(message(page)).toHaveValue("déjà écrit");
  await expect(page.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
  expect(g(dossier, "log", "--oneline").trim().split("\n")).toHaveLength(1);
  expect(g(dossier, "diff", "--cached", "--name-only")).toBe("");
});

test("REQ022_AC6_AC10_dossier_parent_long_le_nom_et_la_lettre_restent_visibles_a_240_px", async ({ page }) => {
  const dossier = depot();
  const long = path.join("dossier-parent-tres-long-pour-la-coupure", "autre-niveau-encore-plus-long-que-le-precedent");
  fs.mkdirSync(path.join(dossier, long), { recursive: true });
  fs.writeFileSync(path.join(dossier, long, "fichier.txt"), "x\n");
  await ouvrir(page, dossier, true);
  const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
  await poignee.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  await expect(poignee).toHaveAttribute("aria-valuenow", "240");
  await panneauGit(page);
  const l = ligne(page, "fichier.txt");
  await expect(l).toBeVisible();
  await expect(async () => {
    const m = await l.evaluate((e) => {
      const r = (s) => e.querySelector(s).getBoundingClientRect().toJSON();
      return { ligne: e.getBoundingClientRect().toJSON(), nom: r(".liste-libelle"), parent: r(".liste-parent"), lettre: r(".liste-statut") };
    });
    expect(m.nom.width).toBeGreaterThan(40);
    expect(m.lettre.right).toBeLessThanOrEqual(m.ligne.right);
    expect(m.parent.right).toBeLessThanOrEqual(m.lettre.left + 1);
  }).toPass();
});

test("REQ022_AC1_AC2_AC6_AC7_REQ031_AC1_V005_statuts_un_seul_onglet_de_diff_fermeture_et_bouton_Indexer", async ({ page }) => {
  const dossier = depot();
  fs.writeFileSync(path.join(dossier, "src", "main.rs"), 'fn main() {\n    println!("bonjour");\n}\n');
  fs.writeFileSync(path.join(dossier, "neuf.txt"), "tout neuf\n");
  fs.writeFileSync(path.join(dossier, "README.md"), "# Autre\n");
  await ouvrir(page, dossier);
  await test.step("REQ022_AC1_AC2_AC6_AC7_changements_statuts_et_un_seul_onglet_de_diff", async () => {
    await panneauGit(page);
    await expect(ligne(page, "src/main.rs")).toHaveAccessibleName("main.rs, modifié");
    await expect(ligne(page, "src/main.rs").locator(".liste-statut")).toHaveText("M");
    await expect(ligne(page, "src/main.rs").locator(".liste-parent")).toHaveText("src");
    await expect(ligne(page, "src/main.rs")).toHaveAttribute("title", "src/main.rs, modifié");
    await expect(ligne(page, "neuf.txt")).toHaveAccessibleName("neuf.txt, nouveau");
    await expect(ligne(page, "neuf.txt").locator(".liste-statut")).toHaveText("U");
    await expect(ligne(page, "neuf.txt").locator(".liste-parent")).toHaveCount(0);
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
  await test.step("REQ022_AC7_fermer_le_dernier_fichier_laisse_l_onglet_de_diff", async () => {
    await page.getByRole("tab", { name: "Fichiers", exact: true }).click();
    await page.getByRole("treeitem", { name: nomLigne("README.md") }).click();
    await panneauGit(page);
    await ligne(page, "src/main.rs").click();
    await expect(ongletDiff(page, "main.rs")).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "README.md" }).click();
    await page.getByRole("tab", { name: "README.md" }).press("Delete");
    await expect(page.getByRole("tab", { name: "README.md" })).toHaveCount(0);
    await expect(ongletDiff(page, "main.rs")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Diff main.rs")).toBeVisible();
  });
  await test.step("REQ031_AC1_V005_indexer_est_invisible_au_repos_et_visible_au_survol_et_sur_la_ligne_selectionnee", async () => {
    await panneauGit(page);
    const opacite = (nom) => page.getByRole("button", { name: nom }).evaluate((e) => getComputedStyle(e.parentElement).opacity);
    await page.mouse.move(0, 0);
    await expect.poll(() => opacite("Indexer README.md")).toBe("0");
    await ligne(page, "README.md").hover();
    await expect.poll(() => opacite("Indexer README.md")).toBe("1");
    await expect.poll(() => opacite("Indexer neuf.txt")).toBe("0");
    await ligne(page, "neuf.txt").click();
    await page.mouse.move(0, 0);
    await expect.poll(() => opacite("Indexer neuf.txt")).toBe("1");
  });
});
