import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { depotExemple, lancerYaide, ouvrirYaide } from "./aides.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

const FAUX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "faux-opencode.mjs");

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

/** Dossier d'un faux `claude` : un shell, présent seulement pour que le rail droit ait ses huit boutons. */
function fauxClaude() {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-claude-"));
  fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexec /bin/sh\n", { mode: 0o755 });
  return bin;
}

/** Dossier d'un faux `opencode`. */
function fauxOpencode() {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-opencode-"));
  const script = `#!/bin/sh
export FAUX_OPENCODE_ETAT='${bin}/etat.json' FAUX_OPENCODE_SCENARIO='texte' FAUX_OPENCODE_TEMOIN='${bin}/temoin'
exec '${process.execPath}' '${FAUX}' "$@"
`;
  fs.writeFileSync(path.join(bin, "opencode"), script, { mode: 0o755 });
  return bin;
}

test("REQ190_AC7_REQ191_AC6_REQ192_AC1_parcours_152_151_rail_a_huit_boutons_puis_workflow_publie_au_clavier", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "notes"));
  yaide = await lancerYaide({ dossier, claude: fauxClaude(), opencode: fauxOpencode(), intervalle: 100 });

  // Parcours 152 : à 800 × 480, les huit boutons du rail droit entiers, « Workflows » juste au-dessus de la base.
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  const rail = page.locator(".cadre-rail-droit");
  const noms = ["Agent", "Agents", "Claude", "opencode", "Sessions opencode", "Workflows", "Base de connaissance", "Serveurs MCP"];
  for (const nom of noms) await expect(rail.getByRole("button", { name: nom, exact: true })).toBeVisible();
  const boites = await rail.getByRole("button").evaluateAll((l) => l.map((b) => ({ nom: b.getAttribute("aria-label"), ...b.getBoundingClientRect().toJSON() })));
  expect(boites.map((b) => b.nom)).toEqual(noms);
  for (const b of boites) expect(b.height).toBe(48);
  for (let k = 1; k < boites.length; k++) expect(boites[k].y).toBeGreaterThanOrEqual(boites[k - 1].y + boites[k - 1].height);
  expect(await rail.evaluate((e) => e.scrollHeight <= e.clientHeight)).toBe(true);
  const bouton = rail.getByRole("button", { name: "Workflows", exact: true });
  await expect(bouton).toHaveAttribute("aria-haspopup", "dialog");
  await expect(bouton).not.toHaveAttribute("aria-expanded", /.*/);

  // Parcours 151 : au clavier seul, création, déclencheur sur `notes`, commande reliée, Ctrl+S, publication.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bouton.focus();
  await page.keyboard.press("Enter");
  const dialogue = page.getByRole("dialog", { name: "Workflows" });
  await expect(dialogue.getByText("Aucun workflow.")).toBeVisible();
  await expect(dialogue.getByRole("button", { name: "Nouveau workflow" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialogue.getByLabel("Nom")).toBeFocused();
  await page.keyboard.type("Revue des notes");
  await page.keyboard.press("Enter");
  await expect(dialogue).toBeHidden();
  const onglet = page.getByRole("tab", { name: "Revue des notes" });
  await expect(onglet).toHaveAttribute("aria-selected", "true");
  const panneau = page.getByRole("complementary", { name: "Nœuds" });
  await expect(panneau.getByRole("button", { name: "Fichiers d'un dossier" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panneau.getByLabel("Dossier", { exact: true })).toBeFocused();
  await page.keyboard.type("notes");
  // Première action, reliée après le déclencheur ; seconde action, reliée après la première, puis reliée au déclencheur par « Après ».
  const ajouterShell = async (commande) => {
    await panneau.getByRole("button", { name: "Commande shell" }).focus();
    await page.keyboard.press("Enter");
    await expect(panneau.getByLabel("Commande", { exact: true })).toBeFocused();
    await page.keyboard.type(commande);
  };
  await ajouterShell("echo premiere");
  await ajouterShell("echo fait > fait.txt");
  await panneau.getByLabel("Après").selectOption({ label: "Fichiers d'un dossier 1" });
  await expect(panneau.getByLabel("Après")).toHaveValue(/.+/);
  // Échap rend le focus à la surface ; Tab choisit le déclencheur, puis la première action, que Suppr retire.
  await page.keyboard.press("Escape");
  const surface = page.getByLabel("Surface du workflow Revue des notes");
  await expect(surface).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("status").filter({ hasText: "Commande shell 1, action, après Fichiers d'un dossier 1." })).toBeVisible();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+s");
  const fichier = path.join(dossier, ".yaide", "workflows", "revue-des-notes.json");
  await expect.poll(() => (fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, "utf8")).noeuds.length : 0)).toBe(2);
  const doc = JSON.parse(fs.readFileSync(fichier, "utf8"));
  expect(doc.publie).toBe(false);
  expect(doc.noeuds.map((n) => n.reglages.dossier ?? n.reglages.commande)).toEqual(["notes", "echo fait > fait.txt"]);
  expect(doc.liens).toEqual([{ de: doc.noeuds[0].id, vers: doc.noeuds[1].id }]);

  await bouton.focus();
  await page.keyboard.press("Enter");
  await expect(dialogue.getByRole("button", { name: "Modifier Revue des notes" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialogue.getByRole("button", { name: "Publier Revue des notes" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialogue.getByRole("status").filter({ hasText: "Revue des notes est publié. Son déclencheur écoute." })).toBeVisible();
  await expect(dialogue.getByRole("button", { name: "Dépublier Revue des notes" })).toBeFocused();
  expect(JSON.parse(fs.readFileSync(fichier, "utf8")).publie).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialogue).toBeHidden();
  await expect(bouton).toBeFocused();

  // Un fichier créé dans `notes/` lance la commande : `fait.txt` apparaît (la boucle des déclencheurs passe toutes les 100 ms ici).
  let n = 0;
  await expect
    .poll(
      () => {
        fs.writeFileSync(path.join(dossier, "notes", `n${n++}.md`), "x\n");
        return fs.existsSync(path.join(dossier, "fait.txt"));
      },
      { timeout: 30000, intervals: [200] },
    )
    .toBe(true);
});

test("REQ197_AC2_REQ197_AC8_REQ197_AC9_REQ204_AC7_REQ199_AC1_REQ199_AC4_REQ199_AC6_parcours_153_publier_depuis_l_onglet_suivre_une_commande_puis_arreter_a_800_x_480", async ({ page }) => {
  const dossier = depotExemple();
  fs.mkdirSync(path.join(dossier, "notes"));
  fs.mkdirSync(path.join(dossier, ".yaide", "workflows"), { recursive: true });
  const fichier = path.join(dossier, ".yaide", "workflows", "revue-des-notes.json");
  const noeuds = [
    { id: "n1", type: "dossier", titre: "Fichiers d'un dossier 1", x: 40, y: 40, reglages: { dossier: "notes", evenements: ["cree", "modifie", "supprime"] } },
    { id: "n2", type: "shell", titre: "Commande shell 1", x: 340, y: 40, reglages: { commande: "while [ ! -e feu-vert ]; do sleep 0.2; done" } },
    { id: "n3", type: "shell", titre: "Commande shell 2", x: 640, y: 40, reglages: { commande: "sleep 25" } },
  ];
  fs.writeFileSync(fichier, JSON.stringify({ nom: "Revue des notes", publie: false, noeuds, liens: [{ de: "n1", vers: "n2" }, { de: "n2", vers: "n3" }] }));
  fs.writeFileSync(path.join(dossier, ".yaide", "workflows", "planifie.json"), JSON.stringify({ nom: "Planifié", publie: false, noeuds: [{ id: "n4", type: "planification", titre: "Planification 1", x: 40, y: 40, reglages: { cron: "0 0 1 1 *" } }], liens: [] }));
  yaide = await lancerYaide({ dossier, claude: fauxClaude(), opencode: fauxOpencode(), intervalle: 100 });
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("button", { name: "Modifier Revue des notes" }).click();
  await expect(page.getByRole("tab", { name: "Revue des notes" })).toHaveAttribute("aria-selected", "true");

  // « Publier » depuis l'onglet : suivi sur place, « Dépublier » prend la place et le focus.
  const publier = page.locator(".onglets-droite").getByRole("button", { name: "Publier", exact: true });
  await publier.click();
  const depublier = page.locator(".onglets-droite").getByRole("button", { name: "Dépublier", exact: true });
  await expect(depublier).toBeFocused();
  await expect(page.getByText("Revue des notes est publié. Son déclencheur écoute.")).toBeVisible();
  await expect(page.getByText("Workflow publié : dépubliez-le pour le modifier.")).toBeVisible();
  await expect(page.locator(".ya-wf-etat")).toHaveText("En attente d'un évènement.");
  expect(JSON.parse(fs.readFileSync(fichier, "utf8")).publie).toBe(true);

  // Le dialogue rouvert lit « Publié ».
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  const liste = page.getByRole("dialog", { name: "Workflows" });
  await expect(liste.getByText("Publié", { exact: true })).toBeVisible();
  await liste.getByRole("button", { name: "Fermer" }).click();
  await expect(liste).toBeHidden();

  // Un fichier créé lance la commande : la ligne d'état la nomme, « Arrêter » paraît à gauche de « Dépublier ».
  let n = 0;
  await expect
    .poll(
      async () => {
        const texte = await page.locator(".ya-wf-etat").textContent();
        if (texte !== "En cours : Commande shell 1.") fs.writeFileSync(path.join(dossier, "notes", `n${n++}.md`), "x\n");
        return texte;
      },
      { timeout: 30000, intervals: [200] },
    )
    .toBe("En cours : Commande shell 1.");
  const arreter = page.locator(".onglets-droite").getByRole("button", { name: "Arrêter", exact: true });
  await expect(page.locator(".ya-noeud-etiquette")).toHaveText("En cours");
  // À 800 × 480, « Arrêter », « Dépublier » et les quatre commandes du zoom sont entiers et visibles.
  for (const b of [arreter, depublier, page.getByRole("button", { name: "Zoom arrière" }), page.getByRole("button", { name: "Zoom avant" }), page.getByRole("button", { name: "Tout afficher" })]) {
    await expect(b).toBeInViewport({ ratio: 1 });
  }
  await expect(page.locator(".onglets-droite").getByRole("status")).toBeInViewport({ ratio: 1 });
  const ordre = await page.locator(".onglets-droite > *").evaluateAll((l) => l.map((e) => e.getBoundingClientRect().x));
  expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);

  // AC-197-8 : le liseré du nœud en cours, ses mesures, ses états réduit et en couleurs forcées.
  const noeud2 = page.locator('.ya-noeud[data-id="n2"]');
  const lisere = noeud2.locator(".ya-noeud-lisere");
  const style = (cible, ...props) => cible.evaluate((e, ps) => Object.fromEntries(ps.map((q) => [q, getComputedStyle(e)[q]])), props);
  await expect(page.locator(".ya-noeud-lisere")).toHaveCount(1);
  await expect(lisere).toHaveAttribute("aria-hidden", "true");
  const anime = await style(lisere, "animationName", "animationDuration", "paddingTop", "pointerEvents", "backgroundImage");
  expect(anime.animationName).toBe("ya-lisere");
  expect(anime.animationDuration).toBe("2s");
  expect(anime.pointerEvents).toBe("none");
  expect(parseFloat(anime.paddingTop)).toBeGreaterThanOrEqual(2);
  const accent = await page.evaluate(() => {
    const t = document.createElement("span");
    t.style.color = "var(--accent-fg)";
    document.body.append(t);
    const c = getComputedStyle(t).color;
    t.remove();
    return c;
  });
  expect(anime.backgroundImage).toContain("conic-gradient");
  expect(anime.backgroundImage).toContain(accent);
  const boite = (e) => e.evaluate((n) => { const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  const avecLisere = await boite(noeud2);
  await lisere.evaluate((e) => (e.style.display = "none"));
  expect(await boite(noeud2)).toEqual(avecLisere);
  await lisere.evaluate((e) => (e.style.display = ""));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(lisere).toBeVisible();
  const reduit = await style(lisere, "animationName", "backgroundColor");
  expect(reduit.animationName).toBe("none");
  expect(reduit.backgroundColor).toBe(accent);
  await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
  await expect(lisere).toBeVisible();
  const force = await style(lisere, "borderTopStyle", "borderTopWidth", "animationName");
  expect(force.borderTopStyle).toBe("solid");
  expect(parseFloat(force.borderTopWidth)).toBeGreaterThanOrEqual(2);
  expect(force.animationName).toBe("none");
  await page.emulateMedia({ forcedColors: "none" });
  expect((await style(lisere, "animationName")).animationName).toBe("ya-lisere");

  // AC-197-9 : un clic au milieu du bord choisit le nœud ; liseré, anneau et étiquette ensemble, l'étiquette au-dessus ; le liseré change de nœud avec la ligne d'état.
  await page.getByRole("button", { name: "Tout afficher" }).click();
  await expect(async () => {
    const r = await noeud2.boundingBox();
    expect(r.x + r.width).toBeLessThan(500);
  }).toPass();
  const b2 = await noeud2.boundingBox();
  await page.mouse.click(b2.x + 1, b2.y + b2.height / 2);
  await expect(noeud2).toHaveClass(/ya-noeud-choisi/);
  await expect(page.locator('[data-champ="commande"]')).toBeVisible();
  await expect(noeud2.locator(".ya-noeud-etiquette")).toHaveText("En cours");
  await expect(lisere).toHaveCount(1);
  const ordreCouches = await noeud2.evaluate((n) => {
    const l = n.querySelector(".ya-noeud-lisere");
    const e = n.querySelector(".ya-noeud-etiquette");
    return { lisereAvant: l.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING, z: getComputedStyle(e).zIndex, zl: getComputedStyle(l).zIndex };
  });
  expect(ordreCouches.lisereAvant).toBeTruthy();
  expect(Number(ordreCouches.z)).toBeGreaterThan(Number(ordreCouches.zl) || 0);
  const lecture = page.locator(".ya-wf-statut");
  const dit = await lecture.textContent();
  fs.writeFileSync(path.join(dossier, "feu-vert"), "");
  // Même sondage : la ligne d'état et le propriétaire du liseré se lisent dans un seul evaluate.
  await expect
    .poll(() => page.evaluate(() => `${document.querySelector(".ya-wf-etat").textContent}|${[...document.querySelectorAll(".ya-noeud")].filter((n) => n.querySelector(".ya-noeud-lisere")).map((n) => n.dataset.id)}`))
    .toBe("En cours : Commande shell 2.|n3");
  await expect(page.locator(".ya-noeud-lisere")).toHaveCount(1);
  await expect(page.locator('.ya-noeud[data-id="n3"] .ya-noeud-lisere')).toHaveCount(1);
  await expect(noeud2.locator(".ya-noeud-lisere")).toHaveCount(0);
  // La zone ne relit rien quand le liseré change de nœud : elle garde son texte.
  expect(dit).toBe("Commande shell 1, action, après Fichiers d'un dossier 1. En cours.");
  await expect(lecture).toHaveText(dit);

  // Le dialogue pendant l'exécution : une ligne à trois boutons, entière à 800 × 480, sans défilement horizontal ; « Suivre » rend l'onglet actif.
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  const dlgCours = page.getByRole("dialog", { name: "Workflows" });
  await expect(dlgCours.getByText("Publié, en cours", { exact: true })).toBeVisible();
  const ligneCours = dlgCours.locator("li.ya-objet", { hasText: "Revue des notes" });
  for (const nom of ["Suivre Revue des notes", "Arrêter Revue des notes", "Dépublier Revue des notes"]) await expect(ligneCours.getByRole("button", { name: nom })).toBeInViewport({ ratio: 1 });
  expect(await ligneCours.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await ligneCours.getByRole("button", { name: "Suivre Revue des notes" }).click();
  await expect(dlgCours).toBeHidden();
  await expect(page.getByLabel("Surface du workflow Revue des notes")).toBeFocused();

  // « Arrêter » : la commande s'arrête, le bouton part, la ligne d'état revient à l'attente.
  await arreter.click();
  await expect(page.getByText("Revue des notes est arrêté. Son déclencheur écoute toujours.")).toBeVisible();
  await expect(arreter).toHaveCount(0);
  await expect(depublier).toBeFocused();
  await expect(page.locator(".ya-wf-etat")).toHaveText("En attente d'un évènement.");
  await expect(page.locator(".ya-noeud-etiquette")).toHaveCount(0);
  await expect(page.locator(".ya-noeud-lisere")).toHaveCount(0);

  // AC-204-7 : onglet d'un brouillon, « Planification 1 » choisi, panneau « Nœuds » à sa largeur la plus petite (800 × 480) : rien ne déborde, dates entières, « Modèles » dans le panneau.
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("button", { name: "Modifier Planifié" }).click();
  await expect(page.getByRole("tab", { name: "Planifié" })).toHaveAttribute("aria-selected", "true");
  await page.locator('.ya-noeud[data-id="n4"]').click({ position: { x: 20, y: 20 } });
  const panneau = page.getByRole("complementary", { name: "Nœuds" }).filter({ has: page.locator('[data-champ="cron"]') });
  await expect(panneau.locator('[data-champ="cron"]')).toHaveValue("0 0 1 1 *");
  await expect(panneau.locator(".ya-cron-dates li")).toHaveCount(3);
  const geoPanneau = await panneau.evaluate((p) => {
    const r = p.getBoundingClientRect();
    const m = p.querySelector(".ya-cron-ligne button").getBoundingClientRect();
    return {
      largeur: r.width,
      defile: p.scrollWidth <= p.clientWidth,
      dates: [...p.querySelectorAll(".ya-cron-dates li")].every((li) => li.scrollWidth <= li.clientWidth && li.getBoundingClientRect().right <= r.right + 0.5),
      modeles: m.left >= r.left - 0.5 && m.right <= r.right + 0.5,
    };
  });
  expect(geoPanneau.largeur).toBeLessThanOrEqual(400);
  expect(geoPanneau.defile).toBe(true);
  expect(geoPanneau.dates).toBe(true);
  expect(geoPanneau.modeles).toBe(true);
  await expect(panneau.getByRole("button", { name: "Modèles d'expression cron" })).toBeVisible();
});
