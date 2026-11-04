import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide } from "./aides.js";

let yaide;
test.beforeEach(async () => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
});
test.afterEach(() => yaide.arreter());

const main = () => path.join(yaide.dossier, "src", "main.rs");

async function ouvrirMain(page) {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("treeitem", { name: "src", exact: true }).click();
  await page.getByRole("treeitem", { name: "main.rs", exact: true }).click();
  await expect(page.getByLabel("Éditeur main.rs")).toBeFocused();
}

/** Zone du cadre où se trouve l'élément qui a le focus. */
const zoneDuFocus = (page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    if (e.closest("header")) return e.getAttribute("aria-label");
    if (e.getAttribute("role") === "separator") return e.getAttribute("aria-label");
    if (e.closest(".cadre-rail-commandes")) return e.getAttribute("aria-label");
    if (e.closest(".cadre-rail")) return "rail";
    if (e.closest(".cadre-panneau")) return "panneau";
    if (e.closest(".cadre-onglets")) return "onglets de fichiers";
    if (e.closest(".cadre-code")) return "éditeur";
    if (e.closest(".cadre-shells")) {
      if (e.classList.contains("xterm-helper-textarea")) return "terminal";
      if (e.getAttribute("role") === "tab") return "onglets de shells";
      return e.getAttribute("aria-label") ?? e.textContent;
    }
    return "autre";
  });

test("REQ028_AC8_AC7_ordre_de_Tab_complet_et_contour_de_focus_a_chaque_arret", async ({ page }) => {
  await ouvrirMain(page);
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await page.getByRole("button", { name: "Ouverture rapide" }).focus();
  const zones = ["Ouverture rapide"];
  for (let i = 0; i < 40 && zones.at(-1) !== "terminal"; i++) {
    // Dans l'éditeur, Tab indente : on le quitte par Échap puis Tab.
    if (zones.at(-1) === "éditeur") await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    const z = await zoneDuFocus(page);
    const contour = await page.evaluate(() => {
      const e = document.activeElement;
      const s = getComputedStyle(e);
      // Le contour peut être porté par l'élément ou par la zone qui le contient (éditeur, terminal).
      const z = e.closest(".zone-code, .terminal-zone");
      const t = z ? getComputedStyle(z) : s;
      return [s.outlineStyle !== "none" && s.outlineWidth !== "0px", t.outlineStyle !== "none" && t.outlineWidth !== "0px"];
    });
    expect(contour.some(Boolean), `contour absent à l'arrêt ${i} (${z})`).toBe(true);
    if (z !== zones.at(-1)) zones.push(z);
  }
  expect(zones).toEqual(["Ouverture rapide", "Thème clair", "Déconnexion", "rail", "Nouveau shell", "Fermer le shell", "panneau", "Largeur du panneau", "onglets de fichiers", "éditeur", "Hauteur des shells", "onglets de shells", "terminal"]);
  const contourTerminal = await page.locator(".terminal-zone:visible").evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(contourTerminal).not.toBe("none");
});

test("REQ028_AC9_800_par_480_avec_fichier_et_deux_shells_rien_ne_se_superpose", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirMain(page);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(page.getByRole("tab", { name: "shell 2" })).toBeVisible();
  const zones = await page.evaluate(() =>
    [".cadre-barre", ".cadre-rail", ".cadre-panneau", ".cadre-onglets", ".cadre-fil", ".cadre-code", ".cadre-shells", ".cadre-etat"].map((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { s, x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  for (const z of zones) expect(z.w * z.h, z.s).toBeGreaterThan(0);
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      const recouvre = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      expect(recouvre, `${a.s} / ${b.s}`).toBe(false);
    }
  const debord = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(debord).toBeLessThanOrEqual(0);
});

test("REQ028_AC10_dialogue_ouvert_les_raccourcis_sont_sans_effet_et_le_focus_revient", async ({ page }) => {
  const avant = fs.readFileSync(main(), "utf8");
  await ouvrirMain(page);
  await page.keyboard.type("// brouillon\n");
  await expect(page.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await page.keyboard.press("Control+p");
  const dialogue = page.getByRole("dialog", { name: "Ouvrir un fichier" });
  await expect(dialogue).toBeVisible();
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Control+p");
  await page.keyboard.press("Control+Shift+F");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialogue).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Chemin du fichier" })).toBeFocused();
  expect(fs.readFileSync(main(), "utf8")).toBe(avant);
  await expect(page.getByRole("tab", { name: "main.rs, non sauvegardé" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Éditeur main.rs")).toBeFocused();
  await page.waitForTimeout(300);
  expect(fs.readFileSync(main(), "utf8")).toBe(avant);
});

test("REQ032_AC6_800_par_480_avec_les_tailles_extremes_rien_ne_se_superpose", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await ouvrirMain(page);
  await page.getByRole("separator", { name: "Largeur du panneau" }).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  await page.getByRole("separator", { name: "Hauteur des shells" }).focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowUp");
  await page.setViewportSize({ width: 800, height: 480 });
  await expect.poll(() => page.getByRole("separator", { name: "Largeur du panneau" }).getAttribute("aria-valuenow")).toBe("360");
  await expect.poll(() => page.getByRole("separator", { name: "Hauteur des shells" }).getAttribute("aria-valuenow")).toBe("299");
  const zones = await page.evaluate(() =>
    [".cadre-barre", ".cadre-rail", ".cadre-panneau", ".cadre-code", ".cadre-shells", ".cadre-etat"].map((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { s, x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  const code = zones.find((z) => z.s === ".cadre-code");
  const shells = zones.find((z) => z.s === ".cadre-shells");
  expect(code.w).toBeGreaterThanOrEqual(320 - 1);
  const haut = await page.evaluate(() => document.querySelector(".cadre-onglets").getBoundingClientRect().y);
  expect(code.y + code.h - haut).toBeGreaterThanOrEqual(120 - 1);
  expect(shells.h).toBeGreaterThanOrEqual(120 - 1);
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      expect(a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5, `${a.s} / ${b.s}`).toBe(false);
    }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

/** Valeur calculée de chaque token de couleur (ou d'une autre propriété), telle que le navigateur la rend. */
const resoudre = (page, noms, propriete = "color") =>
  page.evaluate(
    ([liste, prop]) =>
      Object.fromEntries(
        liste.map((n) => {
          const e = document.createElement("span");
          e.style[prop] = `var(${n})`;
          document.body.append(e);
          const v = getComputedStyle(e)[prop];
          e.remove();
          return [n, v];
        }),
      ),
    [noms, propriete],
  );
const lire = (loc, propriete = "color") => loc.evaluate((e, p) => getComputedStyle(e)[p], propriete);

/** Dépôt avec un fichier dans chacun des six statuts, un fichier ignoré, et une fusion en conflit. */
function depotStatuts() {
  const dossier = depotExemple();
  const git = (...args) => spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd: dossier, encoding: "utf8" });
  const ecrire = (nom, texte) => fs.writeFileSync(path.join(dossier, nom), texte);
  git("branch", "-M", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "t@example.org");
  for (const nom of ["a.txt", "b.txt", "c.txt", "conf.txt"]) ecrire(nom, "base\n");
  ecrire(".gitignore", "ignore.txt\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("switch", "-q", "-c", "autre");
  ecrire("conf.txt", "autre\n");
  git("commit", "-q", "-am", "autre");
  git("switch", "-q", "main");
  ecrire("conf.txt", "main\n");
  git("commit", "-q", "-am", "main");
  git("merge", "autre"); // échoue : conflit voulu
  ecrire("README.md", "# Modifié\n");
  fs.rmSync(path.join(dossier, "b.txt"));
  ecrire("nouveau.txt", "x\n");
  git("mv", "a.txt", "a2.txt");
  ecrire("c.txt", "changé\n");
  git("add", "c.txt");
  ecrire("ignore.txt", "ignoré\n");
  return dossier;
}

async function relancerSur(page, dossier) {
  await yaide.arreter();
  yaide = await lancerYaide({ shell: "/bin/sh", dossier });
  await ouvrirYaide(page, yaide.origine);
}

/** Les commandes à icône visibles : nom accessible, icône, texte visible et taille. */
const commandes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button:has(> svg[data-icone]), [role=tab]:has(> svg[data-icone])")]
      .filter((e) => e.getClientRects().length > 0)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { nom: e.getAttribute("aria-label"), icone: e.querySelector("svg").dataset.icone, texte: e.textContent.trim(), l: r.width, h: r.height, titre: e.hasAttribute("title") };
      }),
  );

test("REQ031_AC1_AC2_AC6_AC8_commandes_sans_texte_24_px_icones_distinctes_et_sans_title", async ({ page }) => {
  fs.writeFileSync(path.join(yaide.dossier, "nouveau.txt"), "x");
  fs.writeFileSync(path.join(yaide.dossier, "notes.bin"), Buffer.from([0, 1, 2, 0]));
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await expect(page.getByRole("button", { name: "Aperçu", exact: true })).toBeVisible();
  // Un message fermable : le bandeau d'un fichier binaire.
  await page.getByRole("treeitem", { name: "notes.bin", exact: true }).click();
  await expect(page.getByRole("alert").getByRole("button", { name: "Fermer", exact: true })).toBeVisible();
  const toutes = [];
  for (const panneau of ["Fichiers", "Git"]) {
    await page.getByRole("tab", { name: panneau, exact: true }).click();
    if (panneau === "Git") await expect(page.getByRole("button", { name: "Indexer nouveau.txt" })).toBeVisible();
    toutes.push(...(await commandes(page)));
  }
  const noms = new Set(toutes.map((c) => c.nom));
  for (const attendu of ["Fichiers", "Recherche", "Git", "Déconnexion", "Ouverture rapide", "Thème clair", "Nouveau fichier", "Nouveau dossier", "Renommer", "Supprimer", "Aperçu", "Nouveau shell", "Fermer le shell", "Fermer README.md", "Fermer", "Indexer nouveau.txt", "Commit", "Pull", "Push"]) {
    expect(noms.has(attendu), attendu).toBe(true);
  }
  // AC-031-6 : 24 × 24 px, sauf une action de ligne (20 × 20) et la fermeture d'un onglet (18 × 18).
  const minimum = (nom) => (nom.startsWith("Indexer ") ? 20 : nom.startsWith("Fermer ") && nom !== "Fermer le shell" ? 18 : 24);
  for (const c of toutes) {
    // « Ouverture rapide » garde le nom du projet : texte voulu par le design (C-010), hors d'AC-031-1.
    if (c.nom !== "Ouverture rapide") expect(c.texte, c.nom).toBe("");
    expect(c.l, c.nom).toBeGreaterThanOrEqual(minimum(c.nom));
    expect(c.h, c.nom).toBeGreaterThanOrEqual(minimum(c.nom));
    expect(c.titre, c.nom).toBe(false);
  }
  // Deux commandes différentes n'ont pas la même icône, sauf les deux « Fermer ».
  const parIcone = new Map();
  // Exception explicite (DEC-026, AC-031-2) : la loupe sert à « Recherche » et à « Ouverture rapide ».
  const groupe = (nom) => (nom.startsWith("Fermer") ? "Fermer" : nom.startsWith("Indexer") ? "Indexer" : nom === "Ouverture rapide" ? "Recherche" : nom);
  for (const c of toutes) parIcone.set(c.icone, new Set([...(parIcone.get(c.icone) ?? []), groupe(c.nom)]));
  for (const [icone, ensemble] of parIcone) expect(ensemble.size, `icône ${icone} : ${[...ensemble]}`).toBe(1);
  // « Fermer le shell » n'a pas l'icône de la fermeture d'un onglet.
  const icone = (nom) => toutes.find((c) => c.nom === nom).icone;
  expect(icone("Fermer le shell")).not.toBe(icone("Fermer README.md"));
  expect(icone("Nouveau shell")).not.toBe(icone("Fermer le shell"));
});

test("REQ035_AC11_info_bulles_a_droite_et_bouton_desactive_sans_arret_de_Tab", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const fermer = page.getByRole("button", { name: "Fermer le shell" });
  for (const nom of ["Nouveau shell", "Fermer le shell"]) {
    const bouton = page.getByRole("button", { name: nom });
    await bouton.hover();
    const info = page.getByRole("tooltip", { name: nom });
    await expect(info).toBeVisible();
    await expect(info).toHaveText(nom);
    const [i, a] = await Promise.all([info.boundingBox(), bouton.boundingBox()]);
    expect(i.x, nom).toBeGreaterThanOrEqual(a.x + a.width - 1);
    await page.mouse.move(0, 0);
    await expect(info).toBeHidden();
  }
  const bulle = page.getByRole("tooltip", { name: "Fermer le shell" });
  // Plus aucun shell : le bouton est désactivé, garde son info-bulle et n'est pas un arrêt de Tab.
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Aucun shell ouvert.")).toBeVisible();
  await expect(fermer).toBeDisabled();
  await page.mouse.move(0, 0);
  await expect(bulle).toBeHidden();
  await page.locator(".bouton-enveloppe:has([aria-label='Fermer le shell'])").hover();
  await expect(bulle).toBeVisible();
  await page.getByRole("button", { name: "Nouveau shell" }).focus();
  await page.keyboard.press("Tab");
  expect(await zoneDuFocus(page)).toBe("panneau");
});

test("REQ033_AC1_AC4_AC5_AC8_AC11_AC12_fonds_des_zones_icones_des_commandes_et_arbre_relus_au_style_calcule", async ({ page }) => {
  await relancerSur(page, depotStatuts());
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await expect(page.getByRole("button", { name: "Aperçu", exact: true })).toBeVisible();
  const t = await resoudre(page, ["--fond-rail", "--surface", "--fond", "--fond-shells", "--ink-muted", "--ink-faint", "--git-ignored", "--icone-naviguer", "--texte"]);
  const fond = (selecteur) => lire(page.locator(selecteur).first(), "backgroundColor");
  expect(await fond(".cadre-rail")).toBe(t["--fond-rail"]);
  expect(await fond(".cadre-panneau")).toBe(t["--surface"]);
  expect(await fond(".cadre-code .cm-editor")).toBe(t["--fond"]);
  expect(await fond(".cadre-shells")).toBe(t["--fond-shells"]);
  // Le rail et les shells partagent le fond du cadre (AC-033-1) : trois fonds distincts.
  expect(new Set([t["--fond-rail"], t["--surface"], t["--fond"], t["--fond-shells"]]).size).toBe(3);
  const pied = (nom) => page.locator(`.fichiers-pied [aria-label="${nom}"]`);
  const ailleurs = (nom) => page.locator(`[aria-label="${nom}"]`).first();
  const icones = [
    [pied("Nouveau fichier"), "--ink-muted"],
    [pied("Nouveau dossier"), "--ink-muted"],
    [pied("Supprimer"), "--ink-muted"], // README.md est sélectionné
    [pied("Renommer"), "--ink-muted"],
    [ailleurs("Nouveau shell"), "--ink-faint"], // les commandes du rail sont au repos comme ses onglets
    [ailleurs("Fermer le shell"), "--ink-faint"],
    [ailleurs("Déconnexion"), "--ink-muted"],
    [ailleurs("Aperçu"), "--icone-naviguer"],
    [ailleurs("Fermer README.md"), "--icone-naviguer"],
    [page.getByRole("tab", { name: "Recherche", exact: true }), "--ink-faint"], // rail au repos
  ];
  for (const [loc, token] of icones) expect(await lire(loc), token).toBe(t[token]);
  // Arborescence : dossier, fichier, élément ignoré par git.
  const item = (nom) => page.getByRole("treeitem", { name: nom === "ignore.txt" ? "ignore.txt, ignoré par git" : nom, exact: true });
  expect(await lire(item("src").locator('svg[data-icone="folder"]')), "icône du dossier").toBe(t["--ink-muted"]);
  expect(await lire(item("src").locator(".liste-libelle")), "nom du dossier").toBe(t["--texte"]);
  expect(await lire(item("README.md").locator('svg[data-icone="file"]')), "icône du fichier").toBe(t["--ink-muted"]);
  expect(await lire(item("README.md").locator(".liste-libelle")), "nom du fichier").toBe(t["--texte"]);
  expect(await lire(item("ignore.txt").locator('svg[data-icone="file"]')), "icône ignorée").toBe(t["--git-ignored"]);
  expect(await lire(item("ignore.txt").locator(".liste-libelle")), "nom ignoré").toBe(t["--git-ignored"]);
  expect(await lire(item("ignore.txt").locator(".liste-libelle"), "fontStyle")).toBe("italic");
  expect(await lire(item("README.md").locator(".liste-libelle"), "fontStyle")).toBe("normal");
  // Pull et Push : icônes de commande, en --ink-muted.
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  const d = await resoudre(page, ["--ink-muted"]);
  for (const nom of ["Pull", "Push"]) await expect.poll(() => lire(ailleurs(nom)), { message: nom }).toBe(d["--ink-muted"]);
});

test("REQ033_AC2_AC9_AC4_statuts_git_commit_et_indexer_relus_au_style_calcule_et_commit_prend_la_place_restante", async ({ page }) => {
  await relancerSur(page, depotStatuts());
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  await expect(page.getByRole("button", { name: "Indexer nouveau.txt" })).toBeVisible();
  const jetons = { modifié: "--statut-modifie", nouveau: "--statut-nouveau", supprimé: "--erreur", renommé: "--statut-renomme", conflit: "--statut-conflit", indexé: "--succes" };
  const t = await resoudre(page, [...Object.values(jetons), "--accent", "--texte-sur-couleur", "--ink-muted"]);
  const poids = (await resoudre(page, ["--graisse-forte"], "fontWeight"))["--graisse-forte"];
  await expect(async () => {
    const lignes = await page.getByRole("listbox", { name: "Changements" }).getByRole("option").evaluateAll((l) =>
      l.map((e) => {
        const s = e.querySelector(".liste-secondaire");
        const c = getComputedStyle(s);
        return { mot: s.textContent, couleur: c.color, poids: c.fontWeight };
      }),
    );
    expect(new Set(lignes.map((l) => l.mot))).toEqual(new Set(Object.keys(jetons)));
    for (const l of lignes) {
      expect(l.couleur, l.mot).toBe(t[jetons[l.mot]]);
      if (l.mot === "conflit") expect(l.poids).toBe(poids);
      else expect(l.poids, l.mot).not.toBe(poids);
    }
  }).toPass({ timeout: 10000 });
  // Indexer en --ink-muted ; Commit en fond d'accent, texte sur couleur.
  await expect.poll(() => lire(page.getByRole("button", { name: "Indexer README.md" })), { timeout: 10000 }).toBe(t["--ink-muted"]);
  const commit = page.getByRole("button", { name: "Commit" });
  // Le panneau se relit de temps en temps et refait ses boutons : on attend la valeur plutôt que de la lire une fois.
  await expect.poll(() => lire(commit, "backgroundColor")).toBe(t["--accent"]);
  await expect.poll(() => lire(commit)).toBe(t["--texte-sur-couleur"]);
  // Commit prend la place restante de la ligne ; Pull et Push gardent leur taille.
  await expect(async () => {
    const boites = await page.locator(".git-actions > .bouton-enveloppe").evaluateAll((l) => l.map((e) => e.getBoundingClientRect().toJSON()));
    const ligne = await page.locator(".git-actions").evaluate((e) => e.getBoundingClientRect().toJSON());
    expect(boites).toHaveLength(3);
    expect(boites[0].width).toBeGreaterThan(boites[1].width * 3);
    expect(Math.abs(boites[2].right - ligne.right)).toBeLessThanOrEqual(1);
    expect(boites[1].width).toBeCloseTo(boites[2].width, 0);
  }).toPass({ timeout: 10000 });
});

test("REQ033_AC3_AC10_messages_info_succes_alerte_erreur_relus_au_style_calcule", async ({ page }) => {
  const dossier = depotExemple();
  const git = (...args) => spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd: dossier });
  git("config", "user.name", "Test");
  git("config", "user.email", "t@example.org");
  fs.writeFileSync(path.join(dossier, "README.md"), "# Autre\n");
  fs.writeFileSync(path.join(dossier, "notes.bin"), Buffer.from([0, 1, 2, 0]));
  await relancerSur(page, dossier);
  const t = await resoudre(page, ["--message-info", "--message-succes", "--message-alerte", "--message-erreur", "--succes", "--alerte", "--erreur"]);
  // info : l'arrêt de Yaide ferme un shell. Le bandeau est unique : on relit chaque message dès qu'il paraît.
  yaide = await yaide.relancer();
  const info = page.locator(".message-info").filter({ hasText: "Yaide a été arrêté." });
  await expect(info).toBeVisible({ timeout: 15000 });
  expect(await lire(info, "backgroundColor")).toBe(t["--message-info"]);
  // alerte : fichier binaire.
  await page.getByRole("treeitem", { name: "notes.bin", exact: true }).click();
  const alerte = page.locator(".message-alerte").filter({ hasText: "notes.bin est un fichier binaire." });
  await expect(alerte).toBeVisible();
  expect(await lire(alerte, "backgroundColor")).toBe(t["--message-alerte"]);
  expect(await lire(alerte, "borderLeftColor")).toBe(t["--alerte"]);
  // succès puis erreur, dans le panneau Git.
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  await page.getByRole("button", { name: "Indexer README.md" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Essai");
  await page.getByRole("button", { name: "Commit" }).click();
  const succes = page.locator(".message-succes").filter({ hasText: "Commit créé." });
  await expect(succes).toBeVisible();
  expect(await lire(succes, "backgroundColor")).toBe(t["--message-succes"]);
  expect(await lire(succes, "borderLeftColor")).toBe(t["--succes"]);
  await page.getByRole("button", { name: "Pull" }).click();
  const erreur = page.locator(".message-erreur").filter({ hasText: "Git a refusé." });
  await expect(erreur).toBeVisible();
  expect(await lire(erreur, "backgroundColor")).toBe(t["--message-erreur"]);
  expect(await lire(erreur, "borderLeftColor")).toBe(t["--erreur"]);
});

test("REQ031_AC9_Renommer_desactive_montre_son_info_bulle", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await expect(page.locator('.fichiers-pied [aria-label="Renommer"]')).toBeDisabled();
  const t = await resoudre(page, ["--ink-muted"]);
  // AC-033-11 : un bouton à icône désactivé est atténué (opacité .45), pas recoloré.
  for (const nom of ["Renommer", "Supprimer"]) {
    const bouton = page.locator(`.fichiers-pied [aria-label="${nom}"]`);
    expect(await lire(bouton), nom).toBe(t["--ink-muted"]);
    expect(await lire(bouton, "opacity"), nom).toBe("0.45");
  }
  await page.locator(".fichiers-pied .bouton-enveloppe").nth(2).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Renommer ou déplacer (F2)");
});

test("REQ031_AC6_panneau_de_240_px_les_quatre_boutons_du_pied_restent_dans_le_pied_sur_une_ligne", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
  await poignee.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  await expect(poignee).toHaveAttribute("aria-valuenow", "240");
  const boites = await page.locator(".fichiers-pied .bouton").evaluateAll((l) => l.map((e) => e.getBoundingClientRect().toJSON()));
  const pied = await page.locator(".fichiers-pied").evaluate((e) => e.getBoundingClientRect().toJSON());
  expect(boites).toHaveLength(4);
  expect(new Set(boites.map((b) => Math.round(b.top))).size).toBe(1);
  expect(boites.at(-1).right).toBeLessThanOrEqual(pied.right);
  expect(boites[0].left).toBeGreaterThanOrEqual(pied.left);
});

test("REQ038_AC5_les_champs_et_la_liste_Branche_suivent_le_theme_de_la_page", async ({ page }) => {
  await relancerSur(page, depotStatuts());
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  const liste = page.getByLabel("Branche");
  const message = page.getByLabel("Message", { exact: true });
  await expect(liste).toBeVisible();
  const schema = (loc) => loc.evaluate((e) => getComputedStyle(e).colorScheme);
  expect(await schema(liste)).toBe("dark");
  expect(await schema(message)).toBe("dark");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await expect.poll(() => schema(liste)).toBe("light");
  await expect.poll(() => schema(message)).toBe("light");
});

test("REQ036_AC3_tailles_du_cadre_barre_onglets_ligne_etat_et_rail", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await ouvrirMain(page);
  const boite = (loc) => loc.first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height)];
  });
  expect((await boite(page.locator("header")))[1]).toBe(35);
  expect((await boite(page.locator("footer")))[1]).toBe(22);
  expect((await boite(page.getByRole("tablist", { name: "Fichiers ouverts" })))[1]).toBe(35);
  expect((await boite(page.getByRole("treeitem", { name: "src", exact: true })))[1]).toBe(22);
  expect((await boite(page.locator(".cadre-rail")))[0]).toBe(48);
  for (const nom of ["Fichiers", "Recherche", "Git"]) expect(await boite(page.getByRole("tab", { name: nom, exact: true }))).toEqual([48, 48]);
  for (const nom of ["Nouveau shell", "Fermer le shell"]) expect(await boite(page.getByRole("button", { name: nom }))).toEqual([48, 48]);
});

test("REQ037_AC3_bouton_central_ouvre_l_ouverture_rapide_avec_son_info_bulle", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const b = page.getByRole("button", { name: "Ouverture rapide" });
  await b.focus();
  await expect(page.getByRole("tooltip")).toHaveText(`${yaide.dossier} · Ouverture rapide (Ctrl+P)`);
  await b.click();
  await expect(page.getByRole("dialog", { name: "Ouvrir un fichier" })).toBeVisible();
});

test("REQ037_AC4_AC10_AC11_AC12_barre_d_etat_et_fil_d_Ariane", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirMain(page);
  const etat = page.locator("footer");
  await expect(etat).toContainText("Ln 1, Col 1");
  await expect(etat).toContainText("Rust");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(etat).toContainText(/Ln 2, Col \d+/);
  const fil = page.locator(".ya-crumbs");
  await expect(fil).toHaveText("srcmain.rs");
  for (const z of [etat, fil]) {
    expect(await z.evaluate((e) => getComputedStyle(e).cursor)).toBe("default");
    await expect(z.locator("button, a, [tabindex]")).toHaveCount(0);
  }
  // Chemin trop long : les premiers segments sont coupés, le nom reste entier.
  await fil.evaluate((e) => {
    e.querySelector(".ya-crumbs-segment").textContent = "un-dossier-au-nom-vraiment-tres-long-".repeat(30);
  });
  const nom = await fil.locator(".ya-crumbs-nom").evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(nom[0]).toBe(nom[1]);
  const segment = await fil.locator(".ya-crumbs-segment").evaluate((e) => e.scrollWidth > e.clientWidth);
  expect(segment).toBe(true);
});

test("REQ037_AC11_fichier_inconnu_Texte_et_aucun_fichier_rien_a_droite", async ({ page }) => {
  fs.writeFileSync(path.join(yaide.dossier, "notes.xyz"), "abc\n");
  await ouvrirYaide(page, yaide.origine);
  await expect(page.locator("footer")).not.toContainText("Ln ");
  await page.getByRole("treeitem", { name: "notes.xyz", exact: true }).click();
  await expect(page.locator("footer")).toContainText("Texte");
});

test("REQ038_AC2_AC4_le_bouton_Theme_clair_change_tout_sans_recharger_et_revient", async ({ page }) => {
  await ouvrirMain(page);
  await page.keyboard.type("// garde");
  const b = page.getByRole("button", { name: "Thème clair" });
  await expect(b).toHaveAttribute("aria-pressed", "false");
  await b.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(b).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Éditeur main.rs")).toContainText("// garde");
  await b.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(b).toHaveAttribute("aria-pressed", "false");
});

test("REQ032_AC13_poignee_au_repos_un_filet_de_1_px_et_au_survol_toute_l_epaisseur_en_accent", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const sep = page.getByRole("separator", { name: "Largeur du panneau" });
  const filet = () => sep.evaluate((e) => {
    const s = getComputedStyle(e, "::after");
    return { fond: s.backgroundColor, largeur: s.width };
  });
  const fond = () => sep.evaluate((e) => getComputedStyle(e).backgroundColor);
  const t = await page.evaluate(() => {
    const lire = (n) => {
      const e = document.createElement("span");
      e.style.color = `var(${n})`;
      document.body.append(e);
      const v = getComputedStyle(e).color;
      e.remove();
      return v;
    };
    return { ligne: lire("--line"), accent: lire("--accent-fg") };
  });
  expect(await filet()).toEqual({ fond: t.ligne, largeur: "1px" });
  expect(await fond()).not.toBe(t.accent);
  await sep.hover();
  expect(await fond()).toBe(t.accent);
  expect((await filet()).fond).toBe(t.accent);
});

test("REQ031_AC10_barre_de_titre_info_bulles_sous_le_bouton_et_dans_la_fenetre", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirYaide(page, yaide.origine);
  for (const nom of ["Thème clair", "Déconnexion"]) {
    const b = page.getByRole("button", { name: nom });
    await b.focus();
    const bulle = page.getByRole("tooltip");
    await expect(bulle).toHaveText(nom);
    const a = await b.boundingBox();
    const t = await bulle.boundingBox();
    expect(t.y, nom).toBeGreaterThanOrEqual(a.y + a.height - 1);
    expect(t.x + t.width, nom).toBeLessThanOrEqual(800);
    expect(t.x, nom).toBeGreaterThanOrEqual(0);
  }
});
