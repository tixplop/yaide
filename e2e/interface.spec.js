import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { depotExemple, lancerYaide, ouvrirYaide, nomLigne } from "./aides.js";

let yaide;
test.beforeEach(async () => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
});
test.afterEach(() => yaide.arreter());

const main = () => path.join(yaide.dossier, "src", "main.rs");

async function ouvrirMain(page) {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("main.rs") }).click();
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
      const z = e.closest(".zone-code, .terminal-zone, .ya-term-tabs .onglet-cellule");
      const t = z ? getComputedStyle(z) : s;
      return [s.outlineStyle !== "none" && s.outlineWidth !== "0px", t.outlineStyle !== "none" && t.outlineWidth !== "0px"];
    });
    expect(contour.some(Boolean), `contour absent à l'arrêt ${i} (${z})`).toBe(true);
    if (z !== zones.at(-1)) zones.push(z);
  }
  expect(zones).toEqual(["Ouverture rapide", "Replier le panneau", "Replier les shells", "Thème clair", "Déconnexion", "rail", "Nouveau shell", "Réduire le shell", "Fermer le shell", "panneau", "Largeur du panneau", "onglets de fichiers", "éditeur", "Hauteur des shells", "onglets de shells", "terminal"]);
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

/** Relit dans le thème courant (sombre), puis en clair, et rend le thème comme il était. `lecture(theme)` fait les assertions. */
async function dansLesDeuxThemes(page, lecture) {
  const bascule = page.getByRole("button", { name: "Thème clair" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await lecture("dark");
  await bascule.click();
  await page.mouse.move(0, 400);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await lecture("light");
  await bascule.click();
  await page.mouse.move(0, 400);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
}

/** Les commandes à icône visibles : nom accessible, icône, texte visible et taille. Le nombre de changements du rail est hors d'AC-031-1 (AC-037-7). */
const commandes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button:has(> svg[data-icone]):not(.ya-btn-primary, .ya-term-tabs .onglet), .ya-activity [role=tab]:has(> svg[data-icone])")]
      .filter((e) => e.getClientRects().length > 0)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { nom: e.getAttribute("aria-label"), icone: e.querySelector("svg").dataset.icone, texte: [...e.childNodes].filter((n) => !n.classList?.contains("ya-badge")).map((n) => n.textContent).join("").trim(), l: r.width, h: r.height, titre: e.hasAttribute("title") };
      }),
  );

test("REQ031_AC1_AC2_AC6_AC8_commandes_sans_texte_24_px_icones_distinctes_et_sans_title", async ({ page }) => {
  fs.writeFileSync(path.join(yaide.dossier, "nouveau.txt"), "x");
  fs.writeFileSync(path.join(yaide.dossier, "notes.bin"), Buffer.from([0, 1, 2, 0]));
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("treeitem", { name: nomLigne("README.md") }).click();
  await expect(page.getByRole("button", { name: "Aperçu", exact: true })).toBeVisible();
  // Un message fermable : le bandeau d'un fichier binaire.
  await page.getByRole("treeitem", { name: nomLigne("notes.bin") }).click();
  await expect(page.getByRole("alert").getByRole("button", { name: "Fermer", exact: true })).toBeVisible();
  const toutes = [];
  for (const panneau of ["Fichiers", "Git"]) {
    await page.getByRole("tab", { name: panneau, exact: true }).click();
    if (panneau === "Git") await expect(page.getByRole("button", { name: "Indexer nouveau.txt" })).toBeVisible();
    toutes.push(...(await commandes(page)));
  }
  const noms = new Set(toutes.map((c) => c.nom));
  for (const attendu of ["Fichiers", "Recherche", "Git", "Déconnexion", "Ouverture rapide", "Thème clair", "Replier le panneau", "Replier les shells", "Nouveau fichier", "Nouveau dossier", "Renommer", "Supprimer", "Aperçu", "Nouveau shell", "Réduire le shell", "Fermer le shell", "Fermer shell 1", "Fermer README.md", "Fermer", "Indexer nouveau.txt", "Pull", "Push"]) {
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
  expect(icone("Réduire le shell")).not.toBe(icone("Fermer le shell"));
});

test("REQ035_AC11_info_bulles_a_droite_et_bouton_desactive_sans_arret_de_Tab", async ({ page }) => {
  await page.clock.install();
  await ouvrirYaide(page, yaide.origine);
  await page.mouse.move(0, 0); // le clic d'ouverture laisse la souris sur « Nouveau shell »
  const fermer = page.getByRole("button", { name: "Fermer le shell" });
  for (const nom of ["Nouveau shell", "Réduire le shell", "Fermer le shell"]) {
    const bouton = page.getByRole("button", { name: nom });
    await bouton.hover();
    await page.clock.fastForward(400);
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
  await expect(page.getByRole("separator", { name: "Hauteur des shells" })).toHaveCount(0);
  await expect(fermer).toBeDisabled();
  await page.mouse.move(0, 0);
  await expect(bulle).toBeHidden();
  await page.locator(".bouton-enveloppe:has([aria-label='Fermer le shell'])").hover();
  await page.clock.fastForward(400);
  await expect(bulle).toBeVisible();
  await page.getByRole("button", { name: "Nouveau shell" }).focus();
  await page.keyboard.press("Tab");
  expect(await zoneDuFocus(page)).toBe("panneau");
});

test("REQ033_AC1_AC8_AC11_AC12_fonds_des_zones_icones_des_commandes_et_arbre_relus_au_style_calcule_dans_les_deux_themes", async ({ page }) => {
  await relancerSur(page, depotStatuts());
  await page.getByRole("treeitem", { name: nomLigne("README.md") }).click();
  await expect(page.getByRole("button", { name: "Aperçu", exact: true })).toBeVisible();
  const pied = (nom) => page.locator(`.fichiers-entete [aria-label="${nom}"]`);
  const ailleurs = (nom) => page.locator(`[aria-label="${nom}"]`).first();
  const item = (nom) => page.getByRole("treeitem", { name: nomLigne(nom) });
  const fond = (selecteur) => lire(page.locator(selecteur).first(), "backgroundColor");
  const verifier = async (theme) => {
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const t = await resoudre(page, ["--bg-000", "--bg-100", "--bg-200", "--ink", "--ink-muted", "--ink-faint", "--git-ignored"]);
    const p = (x) => `${theme} : ${x}`;
    expect(await fond(".cadre-rail"), p("rail")).toBe(t["--bg-000"]);
    expect(await fond(".cadre-barre"), p("barre de titre")).toBe(t["--bg-000"]);
    expect(await fond(".cadre-etat"), p("barre d'état")).toBe(t["--bg-000"]);
    expect(await fond(".cadre-shells"), p("shells")).toBe(t["--bg-000"]);
    expect(await fond(".cadre-panneau"), p("panneau")).toBe(t["--bg-100"]);
    expect(await fond(".cadre-onglets .ya-tabs"), p("barre d'onglets")).toBe(t["--bg-100"]);
    expect(await fond(".cadre-code .cm-editor"), p("éditeur")).toBe(t["--bg-200"]);
    expect(await fond('.cadre-onglets .onglet-cellule:has(> .onglet[aria-selected="true"])'), p("onglet actif")).toBe(t["--bg-200"]);
    // AC-033-1 : rail, panneau et éditeur ont chacun un fond différent.
    expect(new Set([t["--bg-000"], t["--bg-100"], t["--bg-200"]]).size, p("trois fonds")).toBe(3);
    const icones = [
      [pied("Nouveau fichier"), "--ink-muted"],
      [pied("Nouveau dossier"), "--ink-muted"],
      [pied("Supprimer"), "--ink-muted"], // README.md est sélectionné
      [pied("Renommer"), "--ink-muted"],
      [ailleurs("Nouveau shell"), "--ink-faint"], // les commandes du rail sont au repos comme ses onglets
      [ailleurs("Réduire le shell"), "--ink-faint"],
      [ailleurs("Fermer le shell"), "--ink-faint"],
      [ailleurs("Déconnexion"), "--ink-muted"],
      [ailleurs("Aperçu"), "--ink-muted"],
      [ailleurs("Fermer README.md"), "--ink-muted"],
      [page.getByRole("tab", { name: "Recherche", exact: true }), "--ink-faint"], // rail au repos
    ];
    for (const [loc, token] of icones) expect(await lire(loc), p(token)).toBe(t[token]);
    // Arborescence : dossier, fichier, élément ignoré par git.
    expect(await lire(item("src").locator('svg[data-icone="folder"]')), p("icône du dossier")).toBe(t["--ink-muted"]);
    expect(await lire(item("src").locator(".liste-libelle")), p("nom du dossier")).toBe(t["--ink"]);
    expect(await lire(item(".gitignore").locator('svg[data-icone="file"]')), p("icône du fichier sans statut")).toBe(t["--ink-muted"]);
    expect(await lire(item(".gitignore").locator(".liste-libelle")), p("nom du fichier")).toBe(t["--ink"]);
    expect(await lire(item("ignore.txt").locator('svg[data-icone="file"]')), p("icône ignorée")).toBe(t["--git-ignored"]);
    expect(await lire(item("ignore.txt").locator(".liste-libelle")), p("nom ignoré")).toBe(t["--git-ignored"]);
    expect(await lire(item("ignore.txt").locator(".liste-libelle"), "fontStyle")).toBe("italic");
    expect(await lire(item(".gitignore").locator(".liste-libelle"), "fontStyle")).toBe("normal");
  };
  const pullPush = async (theme) => {
    await page.getByRole("tab", { name: "Git", exact: true }).click();
    const d = await resoudre(page, ["--ink-muted"]);
    for (const nom of ["Pull", "Push"]) await expect.poll(() => lire(ailleurs(nom)), { message: `${theme} : ${nom}` }).toBe(d["--ink-muted"]);
    await page.getByRole("tab", { name: "Fichiers", exact: true }).click();
  };
  // Bouton à icône pressé : --accent-fg sur --accent-soft ; au repos, --ink-muted sur fond transparent.
  const presse = async (theme, bouton, attendu) => {
    const t = await resoudre(page, ["--accent-fg", "--accent-soft", "--ink-muted"]);
    await page.mouse.move(0, 400);
    await expect.poll(() => lire(bouton), { message: `${theme} : couleur` }).toBe(attendu ? t["--accent-fg"] : t["--ink-muted"]);
    expect(await lire(bouton, "backgroundColor"), `${theme} : fond`).toBe(attendu ? t["--accent-soft"] : "rgba(0, 0, 0, 0)");
  };
  const theme = page.getByRole("button", { name: "Thème clair" });
  await verifier("dark");
  await presse("dark", theme, false);
  await pullPush("dark");
  await theme.click();
  await verifier("light");
  await presse("light", theme, true);
  await pullPush("light");
  // Aperçu pressé, dans les deux thèmes.
  const apercu = ailleurs("Aperçu");
  await apercu.click();
  await expect(apercu).toHaveAttribute("aria-pressed", "true");
  await presse("light", apercu, true);
  await theme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await presse("dark", apercu, true);
});

test("REQ033_AC2_AC9_AC4_lettres_de_statut_et_commit_relus_au_style_calcule_et_commit_sur_toute_la_largeur", async ({ page }) => {
  await relancerSur(page, depotStatuts());
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  await expect(page.getByRole("button", { name: "Indexer nouveau.txt" })).toBeVisible();
  const jetons = { M: "--git-modified", R: "--git-modified", A: "--git-added", D: "--git-deleted", U: "--git-untracked", C: "--git-conflict" };
  await dansLesDeuxThemes(page, async (theme) => {
    const t = await resoudre(page, [...new Set(Object.values(jetons)), "--accent", "--on-accent", "--ink-muted"]);
    await expect(async () => {
      const lignes = await page.getByRole("listbox", { name: "Changements" }).getByRole("option").evaluateAll((l) =>
        l.map((e) => {
          const lettre = e.querySelector(".liste-statut");
          return { lettre: lettre.textContent, couleur: getComputedStyle(lettre).color, nom: getComputedStyle(e.querySelector(".liste-libelle")).color, barre: getComputedStyle(e.querySelector(".liste-libelle")).textDecorationLine };
        }),
      );
      expect(new Set(lignes.map((l) => l.lettre))).toEqual(new Set(["M", "R", "D", "U", "C"]));
      for (const l of lignes) {
        expect(l.couleur, `${theme} ${l.lettre}`).toBe(t[jetons[l.lettre]]);
        expect(l.nom, `${theme} ${l.lettre}`).toBe(t[jetons[l.lettre]]);
        expect(l.barre, `${theme} ${l.lettre}`).toBe(l.lettre === "D" ? "line-through" : "none");
      }
    }).toPass({ timeout: 10000 });
    // Indexer en --ink-muted ; Commit en fond d'accent, texte sur couleur.
    await expect.poll(() => lire(page.getByRole("button", { name: "Indexer README.md" })), { timeout: 10000 }).toBe(t["--ink-muted"]);
    const commit = page.getByRole("button", { name: "Commit" });
    await expect(commit).toHaveText("Commit");
    // Le panneau se relit de temps en temps et refait ses boutons : on attend la valeur plutôt que de la lire une fois.
    await expect.poll(() => lire(commit, "backgroundColor")).toBe(t["--accent"]);
    await expect.poll(() => lire(commit)).toBe(t["--on-accent"]);
  });
  // Commit occupe toute la largeur du formulaire.
  await expect(async () => {
    const [c, f] = await Promise.all([page.locator(".git-commit .bouton").evaluate((e) => e.getBoundingClientRect().toJSON()), page.getByRole("textbox", { name: "Message" }).evaluate((e) => e.getBoundingClientRect().toJSON())]);
    expect(Math.abs(c.width - f.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.left - f.left)).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 10000 });
});

test("REQ023_AC9_REQ031_AC7_panneau_de_240_px_branche_pull_et_push_sur_une_ligne_meme_pendant_pull", async ({ page }) => {
  const dossier = depotExemple();
  const git = (cwd, ...args) => spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd, encoding: "utf8" });
  git(dossier, "branch", "-M", "main");
  const distant = path.join(path.dirname(dossier), "distant.git");
  git(path.dirname(dossier), "init", "-q", "--bare", distant);
  git(dossier, "remote", "add", "origin", distant);
  git(dossier, "push", "-q", "-u", "origin", "main");
  const libere = path.join(path.dirname(dossier), "libere");
  const attente = path.join(path.dirname(dossier), "attente.sh");
  fs.writeFileSync(attente, `#!/bin/sh\nwhile [ ! -f "${libere}" ]; do sleep 0.1; done\nexec git-upload-pack "$@"\n`, { mode: 0o755 });
  git(dossier, "config", "remote.origin.uploadpack", attente);
  await relancerSur(page, dossier);
  const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
  await poignee.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  await expect(poignee).toHaveAttribute("aria-valuenow", "240");
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  const ligne = async () => {
    const boites = await Promise.all([page.getByLabel("Branche"), page.getByRole("button", { name: "Pull" }), page.getByRole("button", { name: "Push" })].map((l) => l.evaluate((e) => e.getBoundingClientRect().toJSON())));
    const panneau = await page.locator(".cadre-panneau").evaluate((e) => e.getBoundingClientRect().toJSON());
    expect(new Set(boites.map((b) => Math.round(b.top + b.height / 2))).size, "une seule ligne").toBe(1);
    expect(boites[0].right).toBeLessThanOrEqual(boites[1].left);
    expect(boites[1].right).toBeLessThanOrEqual(boites[2].left);
    expect(boites[2].right).toBeLessThanOrEqual(panneau.right);
    expect(boites[0].left).toBeGreaterThanOrEqual(panneau.left);
  };
  await expect(page.getByLabel("Branche")).toBeVisible();
  await expect(ligne).toPass();
  try {
    await page.getByRole("button", { name: "Pull" }).click();
    await expect(page.getByRole("button", { name: "Pull" })).toHaveText("Pull…");
    await expect(ligne).toPass();
  } finally {
    fs.writeFileSync(libere, "");
  }
  await expect(page.getByText("Pull terminé.")).toBeVisible();
});

test("REQ033_AC3_AC10_messages_info_succes_alerte_erreur_relus_au_style_calcule", async ({ page }) => {
  const dossier = depotExemple();
  const git = (...args) => spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd: dossier });
  git("config", "user.name", "Test");
  git("config", "user.email", "t@example.org");
  fs.writeFileSync(path.join(dossier, "README.md"), "# Autre\n");
  fs.writeFileSync(path.join(dossier, "notes.bin"), Buffer.from([0, 1, 2, 0]));
  await relancerSur(page, dossier);
  const jetons = ["--msg-info", "--msg-succes", "--msg-alerte", "--msg-erreur", "--git-added", "--warning", "--danger"];
  const relire = (message, fond, bord) => dansLesDeuxThemes(page, async (theme) => {
    const t = await resoudre(page, jetons);
    expect(await lire(message, "backgroundColor"), `${theme} : fond`).toBe(t[fond]);
    if (bord) expect(await lire(message, "borderLeftColor"), `${theme} : barre`).toBe(t[bord]);
  });
  // info : l'arrêt de Yaide ferme un shell. Le bandeau est unique : on relit chaque message dès qu'il paraît.
  yaide = await yaide.relancer();
  const info = page.locator(".message-info").filter({ hasText: "Yaide a été arrêté." });
  await expect(info).toBeVisible({ timeout: 15000 });
  await relire(info, "--msg-info");
  // alerte : fichier binaire.
  await page.getByRole("treeitem", { name: nomLigne("notes.bin") }).click();
  const alerte = page.locator(".message-alerte").filter({ hasText: "notes.bin est un fichier binaire." });
  await expect(alerte).toBeVisible();
  await relire(alerte, "--msg-alerte", "--warning");
  // succès puis erreur, dans le panneau Git.
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  await page.getByRole("button", { name: "Indexer README.md" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Essai");
  await page.getByRole("button", { name: "Commit" }).click();
  const succes = page.locator(".message-succes").filter({ hasText: "Commit créé." });
  await expect(succes).toBeVisible();
  await relire(succes, "--msg-succes", "--git-added");
  await page.getByRole("button", { name: "Pull" }).click();
  const erreur = page.locator(".message-erreur").filter({ hasText: "Git a refusé." });
  await expect(erreur).toBeVisible();
  await relire(erreur, "--msg-erreur", "--danger");
});

test("REQ031_AC9_Renommer_desactive_montre_son_info_bulle", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await expect(page.locator('.fichiers-entete [aria-label="Renommer"]')).toBeDisabled();
  const t = await resoudre(page, ["--ink-muted"]);
  // AC-033-11 : un bouton à icône désactivé est atténué (opacité .45), pas recoloré.
  for (const nom of ["Renommer", "Supprimer"]) {
    const bouton = page.locator(`.fichiers-entete [aria-label="${nom}"]`);
    expect(await lire(bouton), nom).toBe(t["--ink-muted"]);
    expect(await lire(bouton, "opacity"), nom).toBe("0.45");
  }
  await page.locator(".fichiers-entete .bouton-enveloppe").nth(2).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Renommer ou déplacer (F2)");
});

test("REQ031_AC6_panneau_de_240_px_les_quatre_boutons_restent_dans_l_entete_du_projet_sur_une_ligne", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
  await poignee.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  await expect(poignee).toHaveAttribute("aria-valuenow", "240");
  const boites = await page.locator(".fichiers-entete .bouton").evaluateAll((l) => l.map((e) => e.getBoundingClientRect().toJSON()));
  const pied = await page.locator(".fichiers-entete").evaluate((e) => e.getBoundingClientRect().toJSON());
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
  expect((await boite(page.getByRole("treeitem", { name: nomLigne("src") })))[1]).toBe(22);
  expect((await boite(page.locator(".cadre-rail")))[0]).toBe(48);
  for (const nom of ["Fichiers", "Recherche", "Git"]) expect(await boite(page.getByRole("tab", { name: nom, exact: true }))).toEqual([48, 48]);
  for (const nom of ["Nouveau shell", "Réduire le shell", "Fermer le shell"]) expect(await boite(page.getByRole("button", { name: nom }))).toEqual([48, 48]);
});

test("REQ037_AC3_bouton_central_ouvre_l_ouverture_rapide_avec_son_info_bulle", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
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
  await page.getByRole("treeitem", { name: nomLigne("notes.xyz") }).click();
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
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  for (const nom of ["Replier le panneau", "Thème clair", "Déconnexion"]) {
    const b = page.locator("header").getByRole("button", { name: nom, exact: true });
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

test("REQ036_AC13_le_chevron_d_un_dossier_charge_a_une_transition_de_transform_a_l_ouverture_et_a_la_fermeture", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  const src = page.getByRole("treeitem", { name: nomLigne("src") });
  await src.click();
  await expect(page.getByRole("treeitem", { name: nomLigne("main.rs") })).toBeVisible();
  // Le dossier est chargé : les clics suivants ne passent plus par le serveur. On lit les animations de la ligne recréée.
  const bascule = () =>
    page.evaluate(async () => {
      const attendu = document.querySelector('[data-chemin="src"]').getAttribute("aria-expanded") === "true" ? "false" : "true";
      document.querySelector('[data-chemin="src"]').click();
      for (let i = 0; i < 200 && document.querySelector('[data-chemin="src"]').getAttribute("aria-expanded") !== attendu; i++) await new Promise((r) => setTimeout(r, 0));
      const svg = document.querySelector('[data-chemin="src"] .liste-chevron svg');
      return { ouvert: document.querySelector('[data-chemin="src"]').getAttribute("aria-expanded"), proprietes: svg.getAnimations().map((a) => a.transitionProperty) };
    });
  const ferme = await bascule();
  expect(ferme.ouvert).toBe("false");
  expect(ferme.proprietes).toContain("transform");
  const ouvert = await bascule();
  expect(ouvert.ouvert).toBe("true");
  expect(ouvert.proprietes).toContain("transform");
});

test("REQ040_AC13_AC15_AC28_8_AC28_9_AC31_1_Shells_reduits_arret_de_Tab_taille_info_bulle_compteur_et_rail_a_800_par_480", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(page.getByRole("tab", { name: "shell 2" })).toBeVisible();
  await page.getByRole("button", { name: "Réduire le shell", exact: true }).click();
  const reduits = page.getByRole("button", { name: "Shells réduits", exact: true });
  await expect(reduits).toBeEnabled();
  // Arrêt de Tab entre « Réduire le shell » et « Fermer le shell ».
  await page.getByRole("button", { name: "Réduire le shell", exact: true }).focus();
  const nomFocus = () => page.evaluate(() => document.activeElement.getAttribute("aria-label"));
  await page.keyboard.press("Tab");
  expect(await nomFocus()).toBe("Shells réduits");
  await page.keyboard.press("Tab");
  expect(await nomFocus()).toBe("Fermer le shell");
  // Icône sans texte, 48 × 48, info-bulle à droite.
  expect(await reduits.evaluate((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""))).toBe("");
  expect(await reduits.locator(".ya-badge").getAttribute("aria-hidden")).toBe("true");
  const a = await reduits.boundingBox();
  expect([Math.round(a.width), Math.round(a.height)]).toEqual([48, 48]);
  await reduits.hover();
  const info = page.getByRole("tooltip", { name: "Shells réduits" });
  await expect(info).toBeVisible();
  expect((await info.boundingBox()).x).toBeGreaterThanOrEqual(a.x + a.width - 1);
  // Compteur : fond --bg-400, texte --ink ; celui de Git reste sur --accent.
  const t = await resoudre(page, ["--bg-400", "--ink"]);
  const badge = reduits.locator(".ya-badge");
  expect(await lire(badge, "backgroundColor")).toBe(t["--bg-400"]);
  expect(await lire(badge)).toBe(t["--ink"]);
  // 800 × 480 : les onglets du rail et les quatre commandes ne se recouvrent pas.
  await page.setViewportSize({ width: 800, height: 480 });
  const [nav, groupe] = await Promise.all([page.locator(".cadre-rail-onglets").boundingBox(), page.locator(".cadre-rail-commandes").boundingBox()]);
  expect(nav.y + nav.height).toBeLessThanOrEqual(groupe.y + 1);
  expect(groupe.height).toBe(192);
  expect(groupe.y + groupe.height).toBeLessThanOrEqual(480);
});
