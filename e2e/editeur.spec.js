import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerRelais } from "./relais.js";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne, avancer } from "./aides.js";

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

async function ouvrir(page, preparer = () => {}) {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "tests"));
  fs.writeFileSync(path.join(dossier, "tests", "main.rs"), "// tests\n");
  fs.writeFileSync(path.join(dossier, "a.txt"), "a");
  fs.writeFileSync(path.join(dossier, "x.zzz"), "inconnu");
  preparer(dossier);
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
  await expect(arbre(page)).toBeVisible();
  return dossier;
}
const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const onglet = (page, nom) => page.getByRole("tab", { name: nom });
const editeur = (page, nom) => page.getByRole("textbox", { name: `Éditeur ${nom}` });
const ouvrirMain = async (page) => {
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  await expect(editeur(page, "main.rs")).toBeFocused();
};
/** Liste des onglets gardée dans IndexedDB par le navigateur. */
const gardes = (page) =>
  page.evaluate(
    () =>
      new Promise((ok) => {
        const d = indexedDB.open("yaide", 1);
        d.onsuccess = () => {
          const r = d.result.transaction("cles").objectStore("cles").get("onglets");
          r.onsuccess = () => ok(r.result?.liste ?? []);
        };
      }),
  );
const couleurDe = (page, selecteur) => page.locator(selecteur).first().evaluate((e) => getComputedStyle(e).color);
const taper = async (page, nom, texte) => {
  await editeur(page, nom).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(texte);
};

test("REQ008_AC1_et_AC2_et_AC6_ouvrir_un_fichier_sans_doublon_focus_dans_l_editeur", async ({ page }) => {
  await ouvrir(page);
  await expect(page.getByText("Aucun fichier ouvert.")).toBeVisible();
  await ouvrirMain(page);
  await expect(onglet(page, "main.rs")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cm-content")).toContainText('println!("salut")');
  await ligne(page, "a.txt").click();
  await expect(onglet(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await ligne(page, "main.rs").click();
  await expect(onglet(page, "main.rs")).toHaveAttribute("aria-selected", "true");
  await expect(editeur(page, "main.rs")).toBeFocused();
  await expect(page.getByRole("tab")).toHaveCount(2 + 3 + 1); // fichiers + rail gauche (l'agent est dans le rail droit) + shell 1
});

test("REQ011_AC1_et_AC3_coloration_rust_et_texte_simple_sans_erreur", async ({ page }) => {
  await ouvrir(page);
  await ouvrirMain(page);
  const couleur = (txt) => page.locator(".cm-line span", { hasText: txt }).first().evaluate((e) => getComputedStyle(e).color);
  const base = await page.locator(".cm-line").first().evaluate((e) => getComputedStyle(e).color);
  expect(await couleur("fn")).not.toBe(base);
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e));
  await ligne(page, "x.zzz").click();
  await expect(editeur(page, "x.zzz")).toBeFocused();
  await expect(page.locator(".cm-content:visible")).toContainText("inconnu");
  expect(erreurs).toEqual([]);
});

test("REQ011_AC4_et_AC5_et_AC6_onglets_texte_non_sauvegarde_vide_et_clavier", async ({ page }) => {
  await ouvrir(page);
  await expect(page.getByRole("button", { name: "Ouvrir un fichier" })).toBeVisible();
  await ouvrirMain(page);
  await taper(page, "main.rs", "// ajout");
  await ligne(page, "a.txt").click();
  await expect(page.locator(".cm-content:visible")).toContainText("a");
  await expect(page.locator(".cm-content:visible")).not.toContainText("// ajout");
  await onglet(page, /^main\.rs/).click();
  await expect(page.locator(".cm-content:visible")).toContainText("// ajout");
  const barre = page.getByRole("tablist", { name: "Fichiers ouverts" });
  await expect(barre).toBeVisible();
  await expect(onglet(page, /^main\.rs/)).toHaveAttribute("title", "src/main.rs");
  await onglet(page, /^main\.rs/).focus();
  await page.keyboard.press("ArrowRight");
  await expect(onglet(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(onglet(page, /^main\.rs/)).toHaveAttribute("aria-selected", "true");
  await onglet(page, "a.txt").focus();
  await page.keyboard.press("Enter");
  await expect(editeur(page, "a.txt")).toBeFocused();
  await onglet(page, "a.txt").focus();
  await page.keyboard.press("Delete");
  await expect(onglet(page, "a.txt")).toHaveCount(0);
});

test("REQ011_AC8_deux_main_rs_le_dossier_parent_suit_le_nom", async ({ page }) => {
  await ouvrir(page);
  await ouvrirMain(page);
  await ligne(page, "tests").click();
  await expect(ligne(page, "main.rs")).toHaveCount(2);
  await arbre(page).getByRole("treeitem", { name: nomLigne("main.rs") }).last().click();
  await expect(onglet(page, "main.rs · src")).toHaveAttribute("title", "src/main.rs");
  await expect(onglet(page, "main.rs · tests")).toHaveAttribute("title", "tests/main.rs");
  const attendu = await page.evaluate(() => {
    const i = document.createElement("i");
    i.style.color = "var(--ink-muted)";
    document.body.append(i);
    return getComputedStyle(i).color;
  });
  expect(await couleurDe(page, ".onglet-detail")).toBe(attendu);
});

test("REQ012_AC1_et_AC3_et_AC4_apercu_markdown_propre_a_chaque_onglet", async ({ page }) => {
  await ouvrir(page, (d) => fs.writeFileSync(path.join(d, "notes.md"), "# Notes\n"));
  await ligne(page, "README.md").click();
  const bouton = page.getByRole("button", { name: "Aperçu", exact: true });
  await expect(bouton).toHaveAttribute("aria-pressed", "false");
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-pressed", "true");
  await taper(page, "README.md", "\n# Mon titre");
  await expect(page.getByRole("region", { name: "Aperçu" }).getByRole("heading", { name: "Mon titre" })).toBeVisible();
  await ligne(page, "notes.md").click();
  await expect(bouton).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("region", { name: "Aperçu" })).toHaveCount(0);
  await ligne(page, "a.txt").click();
  await expect(bouton).toHaveCount(0);
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  await expect(bouton).toHaveCount(0);
  await onglet(page, /^README\.md/).click();
  await expect(bouton).toHaveAttribute("aria-pressed", "true");
});

test("REQ058_AC1_parcours_P022", async ({ page }) => {
  await page.clock.install();
  await ouvrir(page, (d) => {
    fs.mkdirSync(path.join(d, "site"));
    fs.writeFileSync(path.join(d, "site", "index.html"), "");
    fs.writeFileSync(path.join(d, "site", "page.htm"), "");
    fs.writeFileSync(path.join(d, "site", "style.css"), "h1 {}\n");
  });
  const relais = await lancerRelais(yaide.port);
  try {
    await page.goto(relais.origine + "/");
    await expect(arbre(page)).toBeVisible();
    await ligne(page, "site").click();
    const bouton = page.getByRole("button", { name: "Aperçu", exact: true });
    const titre = page.locator('iframe[title="Aperçu"]:visible').contentFrame().getByRole("heading", { name: "Titre" });
    await ligne(page, "index.html").click();
    await bouton.click();
    await taper(page, "index.html", "<h1>Titre</h1>");
    await expect(titre).toBeVisible();
    await ligne(page, "page.htm").click();
    await bouton.click();
    await taper(page, "page.htm", "<h1>Titre</h1>");
    await expect(titre).toBeVisible();
    await ligne(page, "style.css").click();
    await expect(bouton).toHaveCount(0);
    await onglet(page, /^page\.htm/).click();
    await expect(bouton).toHaveAttribute("aria-pressed", "true");
    await expect(titre).toBeVisible();
    relais.couper();
    await avancer(page, () => expect(page.getByRole("alert").filter({ hasText: "Connexion perdue" })).toBeVisible({ timeout: 300 }));
    await taper(page, "page.htm", "<p>Hors ligne</p>");
    await expect(page.locator('iframe[title="Aperçu"]:visible').contentFrame().getByText("Hors ligne")).toBeVisible();
  } finally {
    relais.fermer();
  }
});

test("REQ012_AC2_le_html_du_markdown_ne_s_execute_pas", async ({ page }) => {
  await ouvrir(page, (d) => fs.writeFileSync(path.join(d, "README.md"), '<script>window.piege=1</script>\n<img src=x onerror="window.piege=2">\n'));
  await ligne(page, "README.md").click();
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  const zone = page.getByRole("region", { name: "Aperçu" });
  await expect(zone).toContainText("<script>");
  await expect(zone.locator("script, img")).toHaveCount(0);
  expect(await page.evaluate(() => window.piege)).toBeUndefined();
});

test("REQ013_AC1_et_AC2_et_AC4_point_apres_frappe_ecriture_seulement_au_ctrl_s", async ({ page }) => {
  const dossier = await ouvrir(page);
  const fichier = path.join(dossier, "src", "main.rs");
  const avant = fs.readFileSync(fichier, "utf8");
  await ouvrirMain(page);
  await taper(page, "main.rs", "// salut");
  await expect(onglet(page, /non sauvegardé/)).toHaveAccessibleName("main.rs, non sauvegardé");
  await expect(page.locator("[role=tab][data-modifie]")).toHaveCount(1);
  // Au repos, le point remplace la croix ; au survol, la croix revient et le point disparaît.
  const cellule = page.locator(".onglet-cellule", { has: page.locator("[role=tab][data-modifie]") });
  const etat = () => cellule.evaluate((c) => ({ croix: getComputedStyle(c.querySelector(".bouton-enveloppe")).opacity, point: getComputedStyle(c, "::after").display }));
  await page.mouse.move(0, 0);
  expect(await etat()).toEqual({ croix: "0", point: "block" });
  await cellule.hover();
  expect(await etat()).toEqual({ croix: "1", point: "none" });
  await expect.poll(async () => (await gardes(page)).some((o) => o.texte !== undefined)).toBe(true);
  expect(fs.readFileSync(fichier, "utf8")).toBe(avant);
  await page.keyboard.press("Control+s");
  await expect(onglet(page, "main.rs")).toHaveAccessibleName("main.rs, modifié");
  expect(fs.readFileSync(fichier, "utf8")).toBe(avant + "// salut");
});

test("REQ013_AC6_ctrl_s_hors_de_l_editeur_sauvegarde_sans_dialogue_du_navigateur_et_dans_un_shell_va_au_shell", async ({ page }) => {
  const dossier = await ouvrir(page);
  const fichier = path.join(dossier, "a.txt");
  await page.evaluate(() => {
    window.__prevenus = [];
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "s") window.__prevenus.push(e.defaultPrevented);
    });
  });
  const prevenus = () => page.evaluate(() => window.__prevenus);
  await ligne(page, "a.txt").click();
  await taper(page, "a.txt", "b");
  await ligne(page, "a.txt").focus();
  await page.keyboard.press("Control+s");
  await expect(onglet(page, "a.txt")).toHaveAccessibleName("a.txt, nouveau");
  expect(fs.readFileSync(fichier, "utf8")).toBe("ab");
  expect(await prevenus()).toEqual([true]);
  await taper(page, "a.txt", "c");
  await page.keyboard.press("Control+s");
  await expect(onglet(page, "a.txt")).toHaveAccessibleName("a.txt, nouveau");
  expect(await prevenus()).toEqual([true, true]);
  await taper(page, "a.txt", "d");
  await page.locator(".terminal textarea").first().focus();
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Control+q"); // Ctrl+S a gelé la sortie du terminal : le shell l'a bien reçu
  await page.keyboard.type("echo fini$((1+1))\n");
  await expect(page.locator(".terminal").first()).toContainText("fini2");
  expect(await prevenus()).toEqual([true, true]);
  expect(fs.readFileSync(fichier, "utf8")).toBe("abc");
  await expect(onglet(page, /non sauvegardé/)).toBeVisible();
});

test("REQ014_sauvegarder_dans_le_dialogue_pendant_une_ecriture_en_cours_n_perd_aucun_texte", async ({ page }) => {
  const dossier = await ouvrir(page);
  let liberer;
  const retenu = new Promise((r) => (liberer = r));
  let retenues = 0;
  await page.route("**/api/fichier?*", async (route) => {
    if (route.request().method() === "PUT" && retenues++ === 0) await retenu;
    await route.continue();
  });
  await ligne(page, "a.txt").click();
  await expect(editeur(page, "a.txt")).toBeFocused();
  await taper(page, "a.txt", "b");
  await page.keyboard.press("Control+s"); // écriture de « ab », retenue
  await expect.poll(() => retenues).toBe(1);
  await page.keyboard.type("c");
  await page.getByRole("button", { name: "Fermer a.txt" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sauvegarder" }).click();
  await page.waitForTimeout(300); // le dialogue doit rester : l'écriture en cours n'est pas finie
  await expect(page.getByRole("dialog")).toBeVisible();
  liberer();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(onglet(page, /a\.txt/)).toHaveCount(0);
  expect(fs.readFileSync(path.join(dossier, "a.txt"), "utf8")).toBe("abc");
});

test("REQ013_deux_ctrl_s_rapproches_n_affichent_pas_d_echec", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "a.txt").click();
  await taper(page, "a.txt", "b");
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Control+s");
  await expect(onglet(page, "a.txt")).toHaveAccessibleName("a.txt, nouveau");
  expect(fs.readFileSync(path.join(dossier, "a.txt"), "utf8")).toBe("ab");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await taper(page, "a.txt", "c");
  await page.keyboard.press("Control+s");
  await expect(onglet(page, "a.txt")).toHaveAccessibleName("a.txt, nouveau");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("REQ013_AC3_et_AC5_ecriture_impossible_message_et_le_point_reste", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ouvrirMain(page);
  await taper(page, "main.rs", "x");
  fs.chmodSync(path.join(dossier, "src", "main.rs"), 0o444);
  await page.keyboard.press("Control+s");
  const alerte = page.getByRole("alert").filter({ hasText: "Sauvegarde impossible pour main.rs :" });
  await expect(alerte).toBeVisible();
  await expect(alerte).toContainText("Vos modifications sont gardées.");
  await expect(onglet(page, /non sauvegardé/)).toBeVisible();
  fs.chmodSync(path.join(dossier, "src", "main.rs"), 0o644);
  await page.keyboard.press("Control+s");
  await expect(onglet(page, "main.rs")).toHaveAccessibleName("main.rs, modifié");
  await expect(alerte).toHaveCount(0);
});

test("REQ014_echec_de_sauvegarde_dans_le_dialogue_le_laisse_ouvert_avec_le_message", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ouvrirMain(page);
  await taper(page, "main.rs", "x");
  fs.chmodSync(path.join(dossier, "src", "main.rs"), 0o444);
  await page.getByRole("button", { name: "Fermer main.rs" }).click();
  const dlg = page.getByRole("dialog", { name: "Sauvegarder main.rs ?" });
  await dlg.getByRole("button", { name: "Sauvegarder" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Sauvegarde impossible pour main.rs :");
  await expect(dlg.getByRole("button", { name: "Sauvegarder" })).toBeEnabled();
  await expect(onglet(page, /non sauvegardé/)).toBeVisible();
  fs.chmodSync(path.join(dossier, "src", "main.rs"), 0o644);
  await dlg.getByRole("button", { name: "Sauvegarder" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(onglet(page, /main\.rs/)).toHaveCount(0);
});

test("REQ014_AC1_et_AC2_et_AC6_fermer_un_onglet_modifie_puis_sauvegarder", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ouvrirMain(page);
  await taper(page, "main.rs", "// fin");
  await page.getByRole("button", { name: "Fermer main.rs" }).click();
  const dlg = page.getByRole("dialog", { name: "Sauvegarder main.rs ?" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Ce fichier a des modifications non sauvegardées.");
  await expect(dlg.getByRole("button")).toHaveText(["Annuler", "Abandonner", "Sauvegarder"]);
  await expect(dlg.getByRole("button", { name: "Sauvegarder" })).toBeFocused();
  await dlg.getByRole("button", { name: "Sauvegarder" }).click();
  await expect(onglet(page, /main\.rs/)).toHaveCount(0);
  expect(fs.readFileSync(path.join(dossier, "src", "main.rs"), "utf8")).toContain("// fin");
});

test("REQ014_AC3_abandonner_ne_touche_pas_au_disque_et_le_texte_n_est_pas_restaure", async ({ page }) => {
  const dossier = await ouvrir(page);
  const avant = fs.readFileSync(path.join(dossier, "src", "main.rs"), "utf8");
  await ouvrirMain(page);
  await taper(page, "main.rs", "// perdu");
  await page.getByRole("button", { name: "Fermer main.rs" }).click();
  await page.getByRole("button", { name: "Abandonner" }).click();
  await expect(onglet(page, /main\.rs/)).toHaveCount(0);
  expect(fs.readFileSync(path.join(dossier, "src", "main.rs"), "utf8")).toBe(avant);
  await expect.poll(async () => (await gardes(page)).length).toBe(0);
  await page.reload();
  await expect(page.getByText("Aucun fichier ouvert.")).toBeVisible();
  await ligne(page, "src").click();
  await ligne(page, "main.rs").click();
  await expect(page.locator(".cm-content:visible")).toContainText("println");
  await expect(page.locator(".cm-content:visible")).not.toContainText("// perdu");
});

test("REQ014_AC4_et_AC6_annuler_ou_echap_garde_l_onglet_et_son_texte", async ({ page }) => {
  await ouvrir(page);
  await ouvrirMain(page);
  await taper(page, "main.rs", "// garde");
  await page.getByRole("button", { name: "Fermer main.rs" }).click();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(onglet(page, /non sauvegardé/)).toBeVisible();
  await onglet(page, /non sauvegardé/).focus();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cm-content:visible")).toContainText("// garde");
});

test("REQ014_AC5_et_AC7_onglet_non_modifie_se_ferme_sans_question_puis_droite_sinon_gauche", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "a.txt").click();
  await ligne(page, "README.md").click();
  await ligne(page, "x.zzz").click();
  await onglet(page, "README.md").click();
  await page.getByRole("button", { name: "Fermer README.md" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(onglet(page, "x.zzz")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Fermer x.zzz" }).click();
  await expect(onglet(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Fermer a.txt" }).click();
  await expect(page.getByText("Aucun fichier ouvert.")).toBeVisible();
});

test("REQ009_AC2_et_REQ010_AC3_onglet_renomme_puis_ferme_a_la_suppression", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "a.txt").click();
  await expect(onglet(page, "a.txt")).toBeVisible();
  await ligne(page, "a.txt").focus();
  await page.keyboard.press("F2");
  await page.getByLabel("Nouveau chemin").fill("b.txt");
  await page.keyboard.press("Enter");
  await expect(onglet(page, "b.txt")).toBeVisible();
  await expect(onglet(page, "a.txt")).toHaveCount(0);
  await expect(editeur(page, "b.txt")).toBeVisible();
  await ligne(page, "b.txt").focus();
  await page.keyboard.press("Delete");
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
  await expect(onglet(page, "b.txt")).toHaveCount(0);
  await expect(page.getByText("Aucun fichier ouvert.")).toBeVisible();
});

test("REQ009_AC8_un_fichier_cree_depuis_le_panneau_s_ouvre_dans_un_onglet", async ({ page }) => {
  await ouvrir(page);
  await page.getByRole("button", { name: "Nouveau fichier" }).click();
  await page.getByLabel("Chemin").fill("neuf.txt");
  await page.keyboard.press("Enter");
  await expect(onglet(page, "neuf.txt")).toHaveAttribute("aria-selected", "true");
  await expect(editeur(page, "neuf.txt")).toBeFocused();
});

test("REQ011_AC7_tab_indente_dans_l_editeur", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "x.zzz").click();
  await expect(editeur(page, "x.zzz")).toBeFocused();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Tab");
  await expect.poll(() => page.locator(".cm-content:visible .cm-line").first().evaluate((e) => e.textContent)).toMatch(/^\s+inconnu$/);
});

test("REQ018_AC1_les_onglets_et_l_onglet_actif_reviennent_apres_rechargement", async ({ page }) => {
  await ouvrir(page);
  await ouvrirMain(page);
  await ligne(page, "README.md").click();
  await ligne(page, "a.txt").click();
  await onglet(page, "README.md").click();
  await taper(page, "README.md", "garde moi");
  await expect.poll(async () => (await gardes(page)).find((o) => o.chemin === "README.md")?.texte).toContain("garde moi");
  await page.reload();
  await expect(onglet(page, /^README\.md.*non sauvegardé/)).toHaveAttribute("aria-selected", "true");
  await expect(onglet(page, "main.rs")).toBeVisible();
  await expect(onglet(page, "a.txt")).toBeVisible();
  await expect(page.locator(".cm-content:visible")).toContainText("garde moi");
});

/** Retarde la lecture du fichier `chemin` jusqu'à l'appel de la fonction rendue. */
async function retarder(page, chemin) {
  let liberer;
  const porte = new Promise((r) => (liberer = r));
  await page.route("**/api/fichier?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("chemin") === chemin) await porte;
    await route.continue();
  });
  return liberer;
}

test("REQ008_AC7_une_lecture_tardive_ne_reprend_ni_l_onglet_actif_ni_le_focus", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "README.md").click();
  await expect(onglet(page, "README.md")).toHaveAttribute("aria-selected", "true");
  const liberer = await retarder(page, "a.txt");
  await ligne(page, "a.txt").click();
  await onglet(page, "README.md").click();
  liberer();
  await expect(onglet(page, "a.txt")).toBeVisible();
  await expect(editeur(page, "README.md")).toBeFocused();
  await expect(page.locator(".cm-content:visible")).toHaveCount(1);
  await taper(page, "README.md", "bien ici");
  await expect(onglet(page, /^README\.md/)).toHaveAttribute("aria-selected", "true");
  await expect(editeur(page, "README.md")).toContainText("bien ici");
  await onglet(page, "a.txt").click();
  await expect(page.locator(".cm-content:visible")).toHaveText("a");
});

test("REQ008_AC7_lecture_tardive_sans_onglet_actif_ouvre_quand_meme_le_fichier", async ({ page }) => {
  await ouvrir(page, (d) => fs.writeFileSync(path.join(d, "notes.bin"), Buffer.from([0, 1, 2, 0])));
  const liberer = await retarder(page, "a.txt");
  await ligne(page, "a.txt").click();
  await ligne(page, "notes.bin").click();
  await expect(page.getByText("notes.bin est un fichier binaire. Yaide ne l'ouvre pas.")).toBeVisible();
  liberer();
  await expect(onglet(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Aucun fichier ouvert.")).toHaveCount(0);
  await expect(editeur(page, "a.txt")).toBeFocused();
});

test("REQ008_AC8_le_dernier_geste_l_emporte_sur_une_lecture_precedente", async ({ page }) => {
  await ouvrir(page);
  await ligne(page, "x.zzz").click();
  await expect(onglet(page, "x.zzz")).toHaveAttribute("aria-selected", "true");
  const liberer = await retarder(page, "README.md");
  await ligne(page, "README.md").click();
  await ligne(page, "a.txt").click();
  await expect(onglet(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await expect(editeur(page, "a.txt")).toBeFocused();
  liberer();
  await expect(onglet(page, "README.md")).toBeVisible();
  await expect(onglet(page, "a.txt")).toHaveAttribute("aria-selected", "true");
  await expect(editeur(page, "a.txt")).toBeFocused();
});

test("REQ018_un_fichier_disparu_n_est_pas_rouvert", async ({ page }) => {
  const dossier = await ouvrir(page);
  await ligne(page, "a.txt").click();
  await ligne(page, "README.md").click();
  await expect.poll(async () => (await gardes(page)).map((o) => o.chemin)).toEqual(["a.txt", "README.md"]);
  fs.rmSync(path.join(dossier, "a.txt"));
  await page.reload();
  await expect(onglet(page, "README.md")).toBeVisible();
  await expect(onglet(page, "a.txt")).toHaveCount(0);
});

test("V002_chargement_pendant_la_lecture_et_pendant_la_restauration_jamais_aucun_fichier_ouvert", async ({ page }) => {
  await ouvrir(page);
  // La route retient la réponse tant que le test n'a pas vu « Chargement… ».
  let liberer = () => {};
  let retenue = Promise.resolve();
  const retenir = () => (retenue = new Promise((r) => (liberer = r)));
  await page.route("**/api/fichier?*", async (route) => {
    await retenue;
    await route.continue();
  });
  retenir();
  await ligne(page, "a.txt").click();
  await expect(page.getByText("Chargement…").last()).toBeVisible();
  await expect(page.getByText("Aucun fichier ouvert.")).toHaveCount(0);
  liberer();
  await expect(onglet(page, "a.txt")).toBeVisible();
  await expect(page.getByText("Chargement…")).toHaveCount(0);
  // Un onglet est déjà actif : le chargement d'un second fichier s'affiche quand même.
  retenir();
  await ligne(page, "README.md").click();
  await expect(page.getByText("Chargement…").last()).toBeVisible();
  liberer();
  await expect(onglet(page, "README.md")).toBeVisible();
  await expect(page.getByText("Chargement…")).toHaveCount(0);
  await expect.poll(async () => (await gardes(page)).length).toBe(2);
  retenir();
  await page.reload();
  await expect(page.getByText("Chargement…").last()).toBeVisible();
  await expect(page.getByText("Aucun fichier ouvert.")).toHaveCount(0);
  liberer();
  await expect(onglet(page, "a.txt")).toBeVisible();
});

test("REQ031_AC3_le_bundle_de_production_garde_les_notices_Lucide_et_Feather", () => {
  const bundle = fs.readFileSync("web/dist/main.js", "utf8");
  expect(bundle).toContain("ISC License");
  expect(bundle).toContain("Copyright (c) 2026 Lucide Icons and Contributors");
  expect(bundle).toContain("The MIT License (MIT)");
  expect(bundle).toContain("Copyright (c) 2013-present Cole Bemis");
});

test("REQ031_AC1_fermer_un_onglet_de_texte_par_une_icone_sans_title", async ({ page }) => {
  await ouvrir(page);
  await ouvrirMain(page);
  const fermer = page.getByRole("button", { name: "Fermer main.rs" });
  await expect(fermer).toBeVisible();
  await expect(fermer).toHaveText("");
  await expect(fermer).not.toHaveAttribute("title", /.*/);
  await expect(onglet(page, /^main\.rs/)).toHaveAttribute("title", "src/main.rs");
});


test("REQ061_parcours_P024_fermer_des_onglets_d_un_coup", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  const dossier = await ouvrir(page, (d) => fs.appendFileSync(path.join(d, "README.md"), "\nmodifié sur le disque\n"));
  const ong = (nom) => page.getByRole("tab", { name: new RegExp(`^${nom.replace(".", "\\.")}(,|$)`) });
  await ouvrirMain(page);
  await taper(page, "main.rs", "X");
  await ligne(page, "README.md").click();
  await ligne(page, "a.txt").click();
  await taper(page, "a.txt", "Y");
  // L'onglet de diff de README.md (modifié sur le disque) est ouvert depuis le panneau Git.
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  await page.getByRole("listbox", { name: "Changements" }).getByRole("option").filter({ hasText: "README.md" }).click();
  await expect(page.getByRole("tab", { name: "README.md (diff)" })).toBeVisible();
  const nbShells = await page.getByRole("tab", { name: /shell/i }).count();
  const menu = page.getByRole("menu", { name: "Actions sur README.md" });
  // 1. Clic droit : le menu du navigateur ne s'ouvre pas, le menu de Yaide est au pointeur.
  const cible = await ong("README.md").boundingBox();
  await page.evaluate(() => {
    window.__prevenu = null;
    document.addEventListener("contextmenu", (e) => (window.__prevenu = e.defaultPrevented), { once: true });
  });
  await ong("README.md").click({ button: "right", position: { x: 20, y: 10 } });
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => window.__prevenu)).toBe(true);
  await expect(ong("README.md")).toHaveAttribute("aria-selected", "true");
  await expect(menu.getByRole("menuitem")).toHaveText(["Fermer les autres onglets", "Fermer tous les onglets"]);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  const m1 = await menu.boundingBox();
  expect(Math.abs(m1.x - (cible.x + 20))).toBeLessThanOrEqual(2);
  expect(Math.abs(m1.y - (cible.y + 10))).toBeLessThanOrEqual(2);
  // 2. Échap : le menu se ferme, le focus revient à l'onglet.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(ong("README.md")).toBeFocused();
  // 3. Maj+F10 : le menu s'ouvre sous l'onglet ; Bas, Entrée sur « Fermer tous les onglets ».
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  const o = await ong("README.md").boundingBox();
  const m2 = await menu.boundingBox();
  expect(Math.abs(m2.y - (o.y + o.height + 4))).toBeLessThanOrEqual(2);
  expect(Math.abs(m2.x - o.x)).toBeLessThanOrEqual(2);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const dlgMain = page.getByRole("dialog", { name: "Sauvegarder main.rs ?" });
  await expect(dlgMain).toBeVisible();
  await expect(ong("main.rs")).toHaveAttribute("aria-selected", "true");
  await expect(dlgMain.getByRole("button", { name: "Sauvegarder" })).toBeFocused();
  // 4. Échap : la série s'arrête.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(ong("README.md")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "README.md (diff)" })).toHaveCount(0);
  await expect(ong("a.txt")).toBeVisible();
  await expect(ong("main.rs")).toHaveAttribute("aria-selected", "true");
  await expect(editeur(page, "main.rs")).toBeFocused();
  // 5. Clic droit sur main.rs, « Fermer les autres onglets » : a.txt, puis Abandonner.
  await ong("main.rs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fermer les autres onglets" }).click();
  const dlgA = page.getByRole("dialog", { name: "Sauvegarder a.txt ?" });
  await expect(dlgA).toBeVisible();
  await expect(ong("a.txt")).toHaveAttribute("aria-selected", "true");
  await dlgA.getByRole("button", { name: "Abandonner" }).click();
  await expect(ong("a.txt")).toHaveCount(0);
  expect(fs.readFileSync(path.join(dossier, "a.txt"), "utf8")).toBe("a");
  await expect(editeur(page, "main.rs")).toBeFocused();
  // 6. Un seul onglet : « Fermer tous les onglets », puis Sauvegarder écrit le fichier.
  await ong("main.rs").click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText(["Fermer tous les onglets"]);
  await page.getByRole("menuitem", { name: "Fermer tous les onglets" }).click();
  await page.getByRole("dialog", { name: "Sauvegarder main.rs ?" }).getByRole("button", { name: "Sauvegarder" }).click();
  await expect(page.getByText("Aucun fichier ouvert.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir un fichier" })).toBeFocused();
  expect(fs.readFileSync(path.join(dossier, "src", "main.rs"), "utf8")).toContain("X");
  expect(await page.getByRole("tab", { name: /shell/i }).count()).toBe(nbShells);
});

test("REQ062_parcours_P025_P026", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  await page.clock.install();
  const readme = [
    "# projet", "", "Un outil en ligne de commande pour saluer, avec une longue phrase qui passe à la ligne dans l'éditeur quand il est mis en forme, sous un seul numéro.",
    "Voir la [documentation](https://exemple.org/doc) avant de commencer.", "", "```rust", "fn main() {}", "```", "", "## Lancer", "", "`projet` salue.", "",
    "## Options", "", "> Les options sont facultatives.", "", "", "- `--fort` : salue en ~~majuscules~~ capitales.", "- `--bas` : salue bas.", "", "---", "",
    "| a | b |", "|---|---|", "| 1 | 2 |", "", "![Capture](docs/capture.png)", "",
  ].join("\n");
  const dossier = await ouvrir(page, (d) => fs.writeFileSync(path.join(d, "README.md"), readme));
  const relais = await lancerRelais(yaide.port);
  try {
    await page.goto(relais.origine + "/");
    await expect(arbre(page)).toBeVisible();
    const requetes = [];
    page.on("request", (r) => requetes.push(r.url()));
    const lignes = page.locator(".cm-content:visible .cm-line");
    const hybride = page.getByRole("button", { name: "Mode hybride", exact: true });
    const apercu = page.getByRole("button", { name: "Aperçu", exact: true });

    // P-025
    await ligne(page, "README.md").click();
    await expect(hybride).toHaveAttribute("aria-pressed", "false");
    await hybride.click();
    await expect(hybride).toHaveAttribute("aria-pressed", "true");
    await expect(hybride).toBeFocused();
    // Un seul contrôle du contour (AC-012-5) : le bouton pressé a un fond ou un contour que l'autre n'a pas.
    expect(await hybride.evaluate((b) => getComputedStyle(b).borderTopWidth + getComputedStyle(b).boxShadow)).not.toBe(await apercu.evaluate((b) => getComputedStyle(b).borderTopWidth + getComputedStyle(b).boxShadow));
    await expect(lignes.nth(0)).toHaveText("# projet");
    await lignes.nth(18).click({ position: { x: 600, y: 5 } });
    await expect(lignes.nth(18)).toHaveText("- `--fort` : salue en ~~majuscules~~ capitales.");
    await expect(lignes.nth(0)).toHaveText("projet");
    await expect(page.locator("footer")).toContainText("Ln 19, Col 48");
    const avant = requetes.length;
    await lignes.nth(3).locator(".cm-hy-lien").click();
    await expect(lignes.nth(3)).toHaveText("Voir la [documentation](https://exemple.org/doc) avant de commencer.");
    expect(requetes.length).toBe(avant);
    await apercu.click();
    await lignes.nth(18).click({ position: { x: 20, y: 5 } });
    await page.keyboard.press("End");
    await page.keyboard.type(" et vite");
    const zoneApercu = page.getByRole("region", { name: "Aperçu" });
    await expect(zoneApercu).toContainText("capitales. et vite");
    await expect(lignes.nth(18)).toContainText("capitales. et vite");
    await ligne(page, "src").click();
    await ligne(page, "main.rs").click();
    await expect(hybride).toHaveCount(0);
    await expect(apercu).toHaveCount(0);
    await gardeContientHybride(page);
    await page.reload();
    await onglet(page, /^README\.md/).click();
    await expect(hybride).toHaveAttribute("aria-pressed", "true");
    await expect(apercu).toHaveAttribute("aria-pressed", "true");
    await expect(lignes.nth(0)).toHaveClass(/cm-hy-titre1/);
    await expect(lignes.nth(9)).toHaveText("Lancer");

    // P-026
    await page.getByRole("button", { name: "Nouveau fichier" }).click();
    await page.getByLabel("Chemin").fill("notes.md");
    await page.keyboard.press("Enter");
    await expect(editeur(page, "notes.md")).toBeFocused();
    await expect(hybride).toHaveAttribute("aria-pressed", "false");
    await hybride.click();
    await expect(hybride).toHaveAttribute("aria-pressed", "true");
    relais.couper();
    await avancer(page, () => expect(page.getByRole("alert").filter({ hasText: "Connexion perdue. Modifications gardées." })).toBeVisible({ timeout: 300 }));
    await editeur(page, "notes.md").click();
    await page.keyboard.type("## À faire");
    await page.keyboard.press("Enter");
    await expect(lignes.nth(0)).toHaveText("À faire");
    await page.keyboard.type("- **relire le README");
    await page.keyboard.press("Enter");
    await expect(lignes.nth(1)).toHaveText("• **relire le README");
    await expect(lignes.nth(1).locator(".cm-hy-gras")).toHaveCount(0);
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("alert").filter({ hasText: "notes.md sera sauvegardé au retour." })).toBeVisible();
    relais.retablir();
    await avancer(page, () => expect(page.getByRole("alert").filter({ hasText: "Connexion perdue" })).toHaveCount(0, { timeout: 300 }));
    await expect.poll(() => fs.existsSync(path.join(dossier, "notes.md"))).toBe(true);
    await expect.poll(() => fs.readFileSync(path.join(dossier, "notes.md"), "utf8")).toBe("## À faire\n- **relire le README\n- "); // « - » : la puce continuée par l'éditeur, texte source inchangé
  } finally {
    relais.fermer();
  }
});
const gardeContientHybride = (page) => expect.poll(async () => (await gardes(page)).find((g) => g.chemin === "README.md")?.hybride).toBe(true);
