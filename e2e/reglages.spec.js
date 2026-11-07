import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { depotExemple, lancerYaide, gardeContient, nomLigne, ouvrirYaide, avancer } from "./aides.js";

let yaide;
test.afterEach(() => yaide?.arreter());

test("REQ069_AC2_AC4_AC7_replis_imposes_au_rechargement", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, ".yaide"));
  const fichier = path.join(dossier, ".yaide", "interface.json");
  fs.writeFileSync(fichier, '{ "replis": { "panneau": true } }\n');
  yaide = await lancerYaide({ dossier });
  const panneau = page.locator("aside.cadre-panneau");
  const entete = page.locator("header");
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await expect(panneau).toBeHidden();
  await expect(entete.getByRole("button", { name: "Déplier le panneau", exact: true })).toBeVisible();

  // AC-069-5 : déplié à la main, de nouveau replié au rechargement.
  await entete.getByRole("button", { name: "Déplier le panneau", exact: true }).click();
  await expect(panneau).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Nouveau shell" })).toBeVisible();
  await expect(panneau).toBeHidden();

  // AC-069-4 : deux shells, zone repliée au rechargement.
  fs.writeFileSync(fichier, '{ "replis": { "shells": true } }\n');
  await page.reload();
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await page.getByRole("tab", { name: "shell 1", exact: true }).waitFor();
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await page.getByRole("tab", { name: "shell 2", exact: true }).waitFor();
  await page.reload();
  await expect(entete.getByRole("button", { name: "Déplier les shells", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^shell \d+$/ })).toHaveCount(0);
  await entete.getByRole("button", { name: "Déplier les shells", exact: true }).click();
  await expect(page.getByRole("tab", { name: /^shell \d+$/ })).toHaveCount(2);

  // AC-069-7 : modifié dans l'éditeur, rien ne change avant le rechargement.
  await entete.getByRole("button", { name: "Ouverture rapide" }).click();
  const champ = page.getByRole("textbox", { name: "Chemin du fichier" });
  await champ.fill(".yaide/interface.json");
  await champ.press("Enter");
  await page.locator(".cm-content:visible").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type('{ "replis": { "shells": false, "panneau": false } }');
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(fichier, "utf8")).toContain('"panneau": false');
  await expect(panneau).toBeHidden();
  await expect(page.getByRole("tab", { name: /^shell \d+$/ })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("button", { name: "Nouveau shell" })).toBeVisible();
  await expect(panneau).toBeVisible();
});

/** Dossier d'un faux `claude` qui laisse un shell. */
function fauxClaude() {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-claude-"));
  fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexec /bin/sh\n", { mode: 0o755 });
  return bin;
}

const bouton = (page, nom) => page.getByRole("button", { name: nom, exact: true });
const enteteBouton = (page, nom) => page.locator("header").getByRole("button", { name: nom, exact: true });

/** Attend que le brouillon gardé n'ait plus de texte non enregistré (écrit 200 ms après un changement). */
const brouillonVide = (page) =>
  expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((ok) => {
            const d = indexedDB.open("yaide", 1);
            d.onsuccess = () => {
              const r = d.result.transaction("cles").objectStore("cles").get("onglets");
              r.onsuccess = () => ok((r.result?.liste ?? []).some((g) => typeof g.texte === "string"));
            };
          }),
      ),
    )
    .toBe(false);

test("REQ070_parcours_32_alleger_avec_faute_de_frappe", async ({ page }) => {
  const dossier = depotExemple();
  yaide = await lancerYaide({ dossier, claude: fauxClaude() });
  const fichier = path.join(dossier, ".yaide", "interface.json");
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, yaide.origine);
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type("sleep 300 & echo PID=$! FIN$((1+1))");
  await page.keyboard.press("Enter");
  const ecranShell = page.locator(".terminal:visible .xterm-rows");
  await expect(ecranShell).toContainText("FIN2");
  const pid = Number((await ecranShell.innerText()).match(/PID=(\d+) FIN2/)[1]);
  const vivant = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  // 1. Le fichier avec la faute de frappe, enregistré : rien ne change.
  await bouton(page, "Nouveau dossier").click();
  await page.getByLabel("Chemin").fill(".yaide");
  await page.keyboard.press("Enter");
  await bouton(page, "Nouveau fichier").click();
  await page.getByLabel("Chemin").fill(".yaide/interface.json");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Éditeur interface.json" })).toBeFocused();
  const faute = '{ "fonctions": { "gti": false, "recherche": false, "shells": false, "agents": false, "claude": false } }';
  await page.keyboard.type(faute);
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(fichier, "utf8")).toContain('"gti"');
  await expect(page.getByRole("tab", { name: "Recherche", exact: true })).toBeVisible();
  await expect(bouton(page, "Nouveau shell")).toBeVisible();
  await brouillonVide(page);

  // 2. Rechargement : bandeau, interface entière, le focus ne va pas sur le bandeau.
  await page.reload();
  await expect(bouton(page, "Nouveau shell")).toBeVisible();
  const bandeau = page.getByRole("alert").filter({ hasText: ".yaide/interface.json est illisible. Corrigez-le, puis rechargez la page." });
  await expect(bandeau).toBeVisible();
  await expect(bandeau.getByRole("button", { name: "Fermer", exact: true })).toBeVisible();
  for (const nom of ["Fichiers", "Recherche", "Git"]) await expect(page.getByRole("tab", { name: nom, exact: true })).toBeVisible();
  await expect(page.locator(".cadre-rail-droit").getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "Éditeur interface.json" })).toBeFocused();

  // 3. Corrigé et enregistré : rien ne change avant le rechargement.
  await expect(page.locator(".cm-content:visible")).toContainText('"gti"');
  await expect(page.getByRole("button", { name: "Prendre celle du disque" })).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(faute.replace("gti", "git"));
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(fichier, "utf8")).toContain('"git"');
  await expect(bandeau).toBeVisible();
  await expect(page.getByRole("tab", { name: "Recherche", exact: true })).toBeVisible();

  // 4. Rechargement : plus de bandeau, Fichiers seul, pas de rail droit, aucune requête des fonctions éteintes.
  const requetes = [];
  page.on("request", (r) => {
    if (/\/api\/(git\/|shells)/.test(new URL(r.url()).pathname)) requetes.push(r.url());
  });
  await page.reload();
  await expect(page.getByRole("tab", { name: "Fichiers", exact: true })).toBeVisible();
  await expect(bandeau).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Panneaux" }).getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Shells" })).toHaveCount(0);
  await expect(page.locator(".cadre-rail-droit")).toHaveCount(0);
  expect((await page.locator("main").boundingBox()).x + (await page.locator("main").boundingBox()).width).toBe(1280);
  await expect(enteteBouton(page, "Replier le panneau")).toBeVisible();
  await expect(enteteBouton(page, "Thème clair")).toBeVisible();
  await expect(enteteBouton(page, "Déconnexion")).toBeVisible();
  await expect(page.locator("header").getByRole("button", { name: /shells/ })).toHaveCount(0);
  expect(vivant()).toBe(true); // AC-070-4
  expect(requetes).toEqual([]); // AC-070-1, AC-070-3

  // 5. Ordre de Tab, touches R, G, A sans effet, palette sans commande.
  await enteteBouton(page, "Ouverture rapide").focus();
  for (const nom of ["Replier le panneau", "Thème clair", "Déconnexion"]) {
    await page.keyboard.press("Tab");
    await expect(enteteBouton(page, nom)).toBeFocused();
  }
  await page.keyboard.press("Tab");
  const fichiers = page.getByRole("tab", { name: "Fichiers", exact: true });
  await expect(fichiers).toBeFocused();
  let n = 0;
  const separateur = page.getByRole("separator", { name: "Largeur du panneau" });
  for (; n < 20; n++) {
    await page.keyboard.press("Tab");
    if (await separateur.evaluate((e) => e === document.activeElement)) break;
    expect(await page.evaluate(() => !!document.activeElement.closest("aside.cadre-panneau"))).toBe(true);
  }
  await expect(separateur).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement.closest(".cadre-onglets"))).toBe(true);
  for (let i = 0; i < 6 && !(await page.evaluate(() => !!document.activeElement.closest(".cadre-code"))); i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement.closest(".cadre-code"))).toBe(true);
  await fichiers.focus();
  for (const touche of ["r", "g", "a"]) await page.keyboard.press(touche);
  await expect(fichiers).toBeFocused();
  await expect(fichiers).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /^(Recherche|Git)$/ })).toHaveCount(0);
  await page.keyboard.press("Control+p");
  await page.keyboard.type(">");
  await expect(page.getByText("Aucune commande trouvée.")).toBeVisible();
  await page.keyboard.press("Escape");

  // 6. Ouvrir, modifier et enregistrer un fichier marche toujours (AC-070-8).
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("main.rs") }).click();
  await expect(page.getByRole("textbox", { name: "Éditeur main.rs" })).toBeFocused();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("// note\n");
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(path.join(dossier, "src", "main.rs"), "utf8")).toContain("// note");

  // 7. Sans `"shells": false`, le shell 1 revient avec son affichage récent (AC-070-9).
  fs.writeFileSync(fichier, '{ "fonctions": { "git": false, "recherche": false, "agents": false, "claude": false } }\n');
  await page.reload();
  await expect(page.getByRole("group", { name: "Shells" }).getByRole("button")).toHaveCount(4);
  await expect(enteteBouton(page, "Replier les shells")).toBeVisible();
  await expect(page.getByRole("tab", { name: "shell 1", exact: true })).toBeVisible();
  await expect(page.locator(".terminal:visible .xterm-rows")).toContainText("FIN2");
  expect(vivant()).toBe(true);
  process.kill(pid);
});

test("REQ070_parcours_33_claude_seul_a_800_par_480", async ({ page }) => {
  await page.clock.install();
  const dossier = depotExemple();
  yaide = await lancerYaide({ dossier, claude: fauxClaude() });
  const fichier = path.join(dossier, ".yaide", "interface.json");
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Git", exact: true })).toHaveAttribute("aria-selected", "true");
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const ecrire = (fonctions) => fs.writeFileSync(fichier, JSON.stringify({ replis: { agent: false }, fonctions }) + "\n");
  ecrire({ git: false, agents: false });
  await page.reload();
  await expect(bouton(page, "Claude")).toBeVisible();

  // 1. Fichiers, Claude seul tout en haut, pas de colonne de l'agent, rails à 48 px sans défilement.
  await expect(page.getByRole("tab", { name: "Fichiers", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Git", exact: true })).toHaveCount(0);
  await expect(page.locator("aside.cadre-panneau")).toBeVisible();
  await expect(page.locator(".cadre-rail-droit").getByRole("button")).toHaveCount(1);
  await expect(page.locator("aside.cadre-agent")).toBeHidden();
  const mesures = () =>
    page.evaluate(() => {
      const r = (s) => document.querySelector(s);
      const b = (e) => e.getBoundingClientRect();
      const de = document.documentElement;
      return {
        gauche: [b(r(".cadre-rail")).width, r(".cadre-rail").scrollHeight - r(".cadre-rail").clientHeight],
        droit: [b(r(".cadre-rail-droit")).width, r(".cadre-rail-droit").scrollHeight - r(".cadre-rail-droit").clientHeight],
        hauteurs: [...new Set([...document.querySelectorAll(".cadre-rail [role=tab], .cadre-rail button, .cadre-rail-droit button")].map((e) => b(e).height))],
        page: [de.scrollHeight - innerHeight, de.scrollWidth - innerWidth],
      };
    });
  await expect.poll(mesures).toEqual({ gauche: [48, 0], droit: [48, 0], hauteurs: [48], page: [0, 0] });
  const haut = (await bouton(page, "Claude").boundingBox()).y;
  const rail = (await page.locator(".cadre-rail-droit").boundingBox()).y;

  // 2. Info-bulle, A sans effet, clic.
  await bouton(page, "Claude").hover();
  await avancer(page, () => expect(page.getByRole("tooltip")).toHaveText("Nouvelle session Claude", { timeout: 300 }));
  await bouton(page, "Claude").focus();
  await page.keyboard.press("a");
  await expect(page.locator("aside.cadre-agent")).toBeHidden();
  await expect(page.getByRole("tab", { name: "Fichiers", exact: true })).toHaveAttribute("aria-selected", "true");
  await bouton(page, "Claude").click();
  await expect(page.getByRole("tab", { name: "Claude 1", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.clock.resume();
  await gardeContient(page, "\"claude\":true");

  // 3. Agents réactivés : boutons en haut, Claude 8 px plus bas, colonne dépliée, panneau replié.
  ecrire({ git: false });
  await page.reload();
  await expect(bouton(page, "Agents")).toBeVisible();
  const ag = await bouton(page, "Agent").boundingBox();
  const ags = await bouton(page, "Agents").boundingBox();
  const cl = await bouton(page, "Claude").boundingBox();
  expect(ag.y - (await page.locator(".cadre-rail-droit").boundingBox()).y).toBe(haut - rail);
  expect(cl.y - (ags.y + ags.height)).toBe(8);
  await expect(page.locator("aside.cadre-agent")).toBeVisible();
  await expect(page.locator("aside.cadre-agent")).toHaveAccessibleName("Agent");
  await expect(page.locator("aside.cadre-panneau")).toBeHidden();
  await expect(page.getByRole("tab", { name: "Claude 1", exact: true })).toBeVisible();
});
