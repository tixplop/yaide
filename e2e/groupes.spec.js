import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { depotExemple, lancerYaide, nomLigne, ouvrirYaide, saisir } from "./aides.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

const FAUX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "faux-opencode.mjs");

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

/** Dossier d'un faux `claude` : un shell. */
function fauxClaude() {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-claude-"));
  fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexec /bin/sh\n", { mode: 0o755 });
  return bin;
}

/** Dossier d'un faux `opencode` (un scénario de texte). */
function fauxOpencode() {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-opencode-"));
  const script = `#!/bin/sh
export FAUX_OPENCODE_ETAT='${bin}/etat.json' FAUX_OPENCODE_SCENARIO='texte' FAUX_OPENCODE_TEMOIN='${bin}/temoin'
exec '${process.execPath}' '${FAUX}' "$@"
`;
  fs.writeFileSync(path.join(bin, "opencode"), script, { mode: 0o755 });
  return bin;
}

const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const onglet = (page, nom) => page.getByRole("tab", { name: nom });
const groupes = (page) => page.locator(".cadre-groupe");
const groupeDe = (page, nom) => groupes(page).filter({ has: onglet(page, nom) });
const boutonClaude = (page) => page.getByRole("button", { name: "Claude", exact: true });
const boutonOpencode = (page) => page.getByRole("button", { name: "opencode", exact: true });

async function ouvrirFichiers(page, ...noms) {
  for (const nom of noms) await ligne(page, nom).click();
}

/** Le corps d'un groupe : sa boîte moins sa barre d'onglets. */
async function corps(groupe) {
  const [g, barre] = await Promise.all([groupe.boundingBox(), groupe.getByRole("tablist").boundingBox()]);
  const haut = barre.y + barre.height;
  return { x: g.x, y: haut, largeur: g.width, hauteur: g.y + g.height - haut };
}

/** Presse l'onglet et survole la zone `zone` du groupe, sans relâcher ; attend l'aperçu de la cible. */
async function viser(page, onglet, groupe, zone) {
  await saisir(page, onglet);
  const c = await corps(groupe);
  const point = {
    gauche: [c.x + 12, c.y + c.hauteur / 2],
    droite: [c.x + c.largeur - 12, c.y + c.hauteur / 2],
    haut: [c.x + c.largeur / 2, c.y + 12],
    bas: [c.x + c.largeur / 2, c.y + c.hauteur - 12],
    centre: [c.x + c.largeur / 2, c.y + c.hauteur / 2],
  }[zone];
  await page.mouse.move(...point, { steps: 8 });
  await expect(groupe.locator(`[data-depot="${zone}"]`)).toHaveCount(1);
}

async function deposer(page, onglet, groupe, zone) {
  await viser(page, onglet, groupe, zone);
  await page.mouse.up();
  await expect(page.locator("[data-zone-depot]")).toHaveCount(0);
}

let marque = 0;
/** « lignes colonnes » de la session de ce groupe, vue par `stty size`. */
async function stty(page, groupe) {
  const n = ++marque;
  const terminal = groupe.locator(".claude:visible");
  await expect(terminal.locator(".terminal-attente")).toBeHidden();
  // L'ajustement du terminal suit la connexion : on attend que sa taille ne bouge plus.
  const lire = () => terminal.evaluate((e) => {
    const t = (e.term ? e : e.querySelector(".terminal"))?.term;
    return `${t.rows} ${t.cols}`;
  });
  for (let stable = 0, derniere; stable < 3; ) {
    await page.waitForTimeout(150);
    const t = await lire();
    stable = t === derniere ? stable + 1 : 0;
    derniere = t;
  }
  await terminal.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(`echo Q${n} $(stty size)`);
  await page.keyboard.press("Enter");
  const re = new RegExp(`Q${n} (\\d+ \\d+)`);
  await expect(terminal.locator(".xterm-rows")).toHaveText(re);
  return (await terminal.locator(".xterm-rows").textContent()).match(re)[1];
}

async function taper(page, groupe, texte) {
  const terminal = groupe.locator(".claude:visible");
  await expect(terminal.locator(".terminal-attente")).toBeHidden();
  await terminal.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(texte);
  await page.keyboard.press("Enter");
}

const boites = (page) => groupes(page).evaluateAll((l) => l.map((e) => e.getBoundingClientRect().toJSON()));

test("REQ079_P049_parcours_deux_fichiers_et_claude", async ({ page }) => {
  yaide = await lancerYaide({ claude: fauxClaude() });
  await page.setViewportSize({ width: 1700, height: 1000 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await ouvrirFichiers(page, "src");
  await ouvrirFichiers(page, "main.rs", "README.md");
  const main = onglet(page, /^main\.rs/);
  const readme = onglet(page, /^README\.md/);
  const editeur = (nom) => page.getByRole("textbox", { name: `Éditeur ${nom}` });

  // AC-079-1 : README.md sur le côté droit → deux groupes de même largeur, chacun avec son onglet actif.
  await deposer(page, readme, groupes(page).first(), "droite");
  await expect(groupes(page)).toHaveCount(2);
  const [gauche, droite] = await boites(page);
  expect(droite.x).toBeGreaterThan(gauche.x);
  expect(Math.abs(gauche.width - droite.width)).toBeLessThanOrEqual(1);
  await expect(groupeDe(page, /^README\.md/).getByRole("tab")).toHaveCount(1);
  await expect(groupeDe(page, /^main\.rs/).getByRole("tab")).toHaveCount(1);
  await expect(readme).toHaveAttribute("aria-selected", "true");
  await expect(main).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cm-editor:visible")).toHaveCount(2);
  await expect(editeur("README.md")).toContainText("Du texte.");
  await expect(editeur("main.rs")).toContainText("println");

  // AC-079-9 : taper dans un éditeur ne change pas l'autre.
  await editeur("main.rs").click();
  await page.keyboard.type("// zzz");
  await expect(editeur("main.rs")).toContainText("// zzz");
  await expect(editeur("README.md")).not.toContainText("zzz");

  // Claude 1 s'ouvre dans le groupe courant (celui de README.md) ; une commande lui laisse une trace.
  await onglet(page, /^README\.md/).click();
  await boutonClaude(page).click();
  await expect(onglet(page, "Claude 1")).toHaveAttribute("aria-selected", "true");
  await expect(groupeDe(page, "Claude 1").getByRole("tab")).toHaveCount(2);
  const avantTaille = await stty(page, groupeDe(page, "Claude 1"));
  await taper(page, groupeDe(page, "Claude 1"), "echo trace-avant");

  // AC-079-3 : Claude 1 sur le côté haut de son groupe → il se divise ; le groupe de gauche garde sa taille.
  const gaucheAvant = (await boites(page))[0];
  await deposer(page, onglet(page, "Claude 1"), groupeDe(page, "Claude 1"), "haut");
  await expect(groupes(page)).toHaveCount(3);
  const apres = await boites(page);
  expect(apres[0].width).toBeCloseTo(gaucheAvant.width, 0);
  expect(apres[0].height).toBeCloseTo(gaucheAvant.height, 0);
  const [haut, bas] = [await groupeDe(page, "Claude 1").boundingBox(), await groupeDe(page, /^README\.md/).boundingBox()];
  expect(haut.y).toBeLessThan(bas.y);
  expect(haut.width).toBeCloseTo(bas.width, 0);

  // AC-079-8 : la même session (la trace est là), qui connaît sa nouvelle taille.
  await expect(groupeDe(page, "Claude 1").locator(".xterm-rows")).toContainText("trace-avant");
  const apresTaille = await stty(page, groupeDe(page, "Claude 1"));
  expect(apresTaille).not.toBe(avantTaille);

  // AC-079-9 : deux Claude actifs dans deux groupes, chacun suit sa session.
  await onglet(page, /^README\.md/).click();
  await boutonClaude(page).click();
  await expect(onglet(page, "Claude 2")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".claude:visible")).toHaveCount(2);
  await taper(page, groupeDe(page, "Claude 2"), "echo beta");
  await taper(page, groupeDe(page, "Claude 1"), "echo alpha");
  await expect(groupeDe(page, "Claude 2").locator(".claude:visible .xterm-rows")).toContainText("beta");
  await expect(groupeDe(page, "Claude 1").locator(".claude:visible .xterm-rows")).toContainText("alpha");
  await expect(groupeDe(page, "Claude 2").locator(".claude:visible .xterm-rows")).not.toContainText("alpha");
  await expect(groupeDe(page, "Claude 1").locator(".claude:visible .xterm-rows")).not.toContainText("beta");

  // AC-079-26 : seul l'onglet actif du groupe courant porte le filet de 2 px ; un filet de 1 px sépare les groupes.
  const filet = (nom) => onglet(page, nom).evaluate((t) => getComputedStyle(t.closest(".onglet-cellule")).boxShadow);
  expect(await filet("Claude 1")).toMatch(/ 2px /); // le dernier groupe où l'on a tapé est courant
  expect(await filet("Claude 2")).toBe("none");
  expect(await filet(/^main\.rs/)).toBe("none");
  const separations = await page.locator(".cadre-decoupe > .poignee-groupe").evaluateAll((l) => {
    const sonde = document.createElement("i");
    sonde.style.background = "var(--line)";
    document.body.append(sonde);
    const ligne = getComputedStyle(sonde).backgroundColor;
    sonde.remove();
    return l.map((e) => {
      const s = getComputedStyle(e, "::after");
      return [e.classList.contains("poignee-vertical") ? s.width : s.height, s.backgroundColor === ligne];
    });
  });
  expect(separations).toEqual([["1px", true], ["1px", true]]);

  // AC-079-5 : le dernier onglet d'un groupe se ferme → son voisin prend toute la place.
  await page.getByRole("button", { name: "Fermer Claude 1" }).click();
  await expect(groupes(page)).toHaveCount(2);
  const [g2, d2] = await boites(page);
  expect(Math.abs(d2.height - g2.height)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Fermer Claude 2" }).click();
  await page.getByRole("button", { name: /^Fermer README\.md/ }).click();
  await expect(groupes(page)).toHaveCount(1);
  // Le filet de 1 px entre les deux groupes rejoint la place du survivant (S - 1 pour deux groupes, AC-080-11).
  expect((await groupes(page).boundingBox()).width).toBeCloseTo(gauche.width + droite.width + 1, 0);
});

test("REQ079_P050_refus_echap_et_petite_fenetre", async ({ page }) => {
  yaide = await lancerYaide();
  await page.setViewportSize({ width: 1700, height: 1000 });
  await ouvrirYaide(page, yaide.origine);
  await ouvrirFichiers(page, "src");
  await ouvrirFichiers(page, "main.rs", "README.md");
  const main = onglet(page, /^main\.rs/);
  const readme = onglet(page, /^README\.md/);
  await expect(readme).toHaveAttribute("aria-selected", "true");
  const ordre = () => page.getByRole("tab").evaluateAll((l) => l.map((t) => `${t.getAttribute("aria-label")}:${t.getAttribute("aria-selected")}`));
  const focus = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
  const shell = page.locator(".terminal:visible .xterm-rows");
  const avant = await ordre();
  const focusAvant = await focus();
  const texteShell = await shell.textContent();

  // AC-079-30 : presser un onglet inactif ne l'active pas ; AC-079-14 : au-dessus du shell (refus), puis Échap.
  await viser(page, main, groupes(page).first(), "droite");
  await expect(main).toHaveAttribute("aria-selected", "false");
  expect(await focus()).toBe(focusAvant);
  await page.mouse.move(800, 900, { steps: 6 });
  await expect(page.locator("[data-depot]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-zone-depot]")).toHaveCount(0);
  await page.mouse.up();
  expect(await ordre()).toEqual(avant);
  expect(await focus()).toBe(focusAvant);
  expect(await shell.textContent()).toBe(texteShell);
  await expect(page.getByRole("textbox", { name: "Éditeur README.md" })).not.toContainText("main");

  // Dépôt hors d'une cible (barre d'état) : rien ne change.
  await saisir(page, main);
  await expect(groupes(page).locator("[data-zone-depot]").first()).toBeAttached();
  const etat = await page.locator(".cadre-etat").boundingBox();
  await page.mouse.move(etat.x + 40, etat.y + etat.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(groupes(page)).toHaveCount(1);
  expect(await ordre()).toEqual(avant);
  expect(await shell.textContent()).toBe(texteShell);

  // Deux groupes, puis la fenêtre à 800 × 480.
  await deposer(page, main, groupes(page).first(), "droite");
  await expect(groupes(page)).toHaveCount(2);
  await page.setViewportSize({ width: 800, height: 480 });
  const cible = groupeDe(page, /^README\.md/);
  await saisir(page, main);
  const c = await corps(cible);
  await page.mouse.move(c.x + c.largeur / 2, c.y + c.hauteur / 2, { steps: 6 });
  await expect(cible.locator("[data-zone-depot]").first()).toBeAttached();
  const guides = await cible.locator("[data-zone-depot]").evaluateAll((l) => l.map((e) => e.dataset.zoneDepot));
  // AC-079-19 : moins de 640 px de large → ni gauche ni droite ; moins de 240 px de haut → ni haut ni bas.
  expect(c.largeur).toBeLessThan(640);
  expect(guides).not.toContain("gauche");
  expect(guides).not.toContain("droite");
  // AC-079-29 : haut, centre et bas vont d'un bord à l'autre, à 4 px près ; le haut du guide « haut » est 4 px sous la barre.
  const hauteurGroupe = (await cible.boundingBox()).height;
  expect(hauteurGroupe).toBeGreaterThanOrEqual(240);
  expect([...guides].sort()).toEqual(["bas", "centre", "haut"]);
  for (const zone of guides) {
    const r = await cible.locator(`[data-zone-depot="${zone}"]`).boundingBox();
    expect(Math.abs(r.x - c.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(r.width - c.largeur)).toBeLessThanOrEqual(8);
  }
  const haut = await cible.locator('[data-zone-depot="haut"]').boundingBox();
  expect(Math.abs(haut.y - (c.y + 4))).toBeLessThanOrEqual(1);
  const bas = await cible.locator('[data-zone-depot="bas"]').boundingBox();
  expect(Math.abs(c.y + c.hauteur - 4 - (bas.y + bas.height))).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(groupes(page)).toHaveCount(2);

  // P-050, étape 4 : README.md sous main.rs, shells repliés, 800 × 480 → le groupe visé fait moins de 240 px de haut et de 640 px de large : « centre » seul, sur tout le corps.
  await page.setViewportSize({ width: 1700, height: 1000 });
  await deposer(page, onglet(page, /^README\.md/), groupeDe(page, /^main\.rs/), "bas");
  await expect(groupes(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Replier les shells" }).click();
  await page.setViewportSize({ width: 800, height: 480 });
  const haute = groupeDe(page, /^main\.rs/);
  await saisir(page, onglet(page, /^README\.md/));
  const k = await corps(haute);
  await page.mouse.move(k.x + k.largeur / 2, k.y + k.hauteur / 2, { steps: 6 });
  await expect(haute.locator("[data-zone-depot]").first()).toBeAttached();
  expect(k.largeur).toBeLessThan(640);
  expect((await haute.boundingBox()).height).toBeLessThan(240);
  expect(await haute.locator("[data-zone-depot]").evaluateAll((l) => l.map((e) => e.dataset.zoneDepot))).toEqual(["centre"]);
  const tout = await haute.locator('[data-zone-depot="centre"]').boundingBox();
  for (const [a, b] of [[tout.x, k.x], [tout.y, k.y], [tout.width, k.largeur], [tout.height, k.hauteur]]) expect(Math.abs(a - b)).toBeLessThanOrEqual(4 + (a === tout.width || a === tout.height ? 4 : 0));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(groupes(page)).toHaveCount(2);
});

test("REQ079_AC16_AC32_glisse_au_dessus_d_un_apercu_html_et_d_un_terminal", async ({ page }) => {
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "page.html"), "<h1>Bonjour</h1>\n");
  yaide = await lancerYaide({ dossier, claude: fauxClaude() });
  await page.setViewportSize({ width: 1700, height: 1000 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await ouvrirFichiers(page, "page.html", "README.md");
  await onglet(page, /^page\.html/).click();
  await expect(page.locator("iframe:visible")).toHaveCount(1);
  await deposer(page, onglet(page, /^README\.md/), groupeDe(page, /^page\.html/), "droite");
  await ouvrirFichiers(page, "src");
  await ouvrirFichiers(page, "main.rs");
  await boutonClaude(page).click();
  const droite = groupeDe(page, "Claude 1");
  const gauche = groupeDe(page, /^page\.html/);
  await expect(groupes(page)).toHaveCount(2);
  const tailleAvant = await stty(page, droite);
  const boitesAvant = await boites(page);

  // Au-dessus de l'aperçu HTML (centre de l'autre groupe) puis du terminal (quart droit de son groupe).
  const main = onglet(page, /^main\.rs/);
  await saisir(page, main);
  const iframe = await gauche.locator("iframe").boundingBox();
  await page.mouse.move(iframe.x + iframe.width / 2, iframe.y + iframe.height / 2, { steps: 8 });
  await expect(gauche.locator('[data-depot="centre"]')).toHaveCount(1);
  const t = await droite.locator(".claude:visible").boundingBox();
  await page.mouse.move(t.x + t.width - 12, t.y + t.height / 2, { steps: 8 });
  await expect(droite.locator('[data-depot="droite"]')).toHaveCount(1);
  expect(await boites(page)).toEqual(boitesAvant);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-zone-depot]")).toHaveCount(0);
  expect(await boites(page)).toEqual(boitesAvant);
  expect(await stty(page, droite)).toBe(tailleAvant);
});

test("REQ079_AC18_AC20_AC33_rechargement_et_quatre_groupes", async ({ page }) => {
  yaide = await lancerYaide({ opencode: fauxOpencode(), claude: fauxClaude() });
  await page.setViewportSize({ width: 1700, height: 1000 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await ouvrirFichiers(page, "src");
  await ouvrirFichiers(page, "main.rs", "README.md");
  await deposer(page, onglet(page, /^README\.md/), groupes(page).first(), "droite");
  await boutonOpencode(page).click();
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await onglet(page, /^main\.rs/).click();
  await boutonOpencode(page).click();
  await expect(onglet(page, "opencode 2")).toHaveAttribute("aria-selected", "true");

  // AC-079-33 : deux groupes de 450 px, un onglet opencode dans chacun → compteur sous la saisie, rien ne déborde.
  const principal = page.locator("main.cadre-principal");
  for (let i = 0; i < 4; i++) {
    const w = (await principal.boundingBox()).width;
    if (Math.abs(w - 901) < 1) break;
    const v = page.viewportSize();
    await page.setViewportSize({ width: Math.max(800, Math.round(v.width + 901 - w)), height: v.height });
  }
  for (const nom of ["opencode 1", "opencode 2"]) {
    const groupe = groupeDe(page, nom);
    expect((await groupe.boundingBox()).width).toBeCloseTo(450, -1);
    const saisie = groupe.locator(".session-saisie:visible");
    const mesure = await saisie.evaluate((s) => {
      const barre = s.lastElementChild;
      const compteur = s.querySelector(".agent-compteur");
      const bas = (e) => e.getBoundingClientRect().bottom;
      const haut = (e) => e.getBoundingClientRect().top;
      const boutons = [...barre.querySelectorAll("button")];
      return { visible: !compteur.hidden, sous: haut(compteur) >= Math.max(...boutons.map(bas)) - 1, deborde: s.scrollWidth > s.clientWidth || barre.scrollWidth > barre.clientWidth };
    });
    expect(mesure).toEqual({ visible: true, sous: true, deborde: false });
  }

  // AC-079-33, dernière phrase : un onglet Agent dans un groupe de 450 px prend toute la largeur, moins 12 px de chaque côté.
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(onglet(page, /^Agent \d/)).toHaveAttribute("aria-selected", "true");
  const agent = groupeDe(page, /^Agent \d/);
  const marges = await agent.evaluate((g) => {
    const r = g.getBoundingClientRect();
    const corps = g.querySelector(".agent-corps");
    return {
      deborde: corps.scrollWidth > corps.clientWidth,
      parties: [".agent-entete", ".agent-fil", ".agent-saisie"].map((c) => {
        const e = g.querySelector(c);
        const b = e.getBoundingClientRect();
        const st = getComputedStyle(e);
        return [Math.round(b.left - r.left + parseFloat(st.paddingLeft)), Math.round(r.right - b.right + parseFloat(st.paddingRight))];
      }),
    };
  });
  expect(marges).toEqual({ deborde: false, parties: [[12, 12], [12, 12], [12, 12]] });
  await page.getByRole("button", { name: /^Fermer Agent \d/ }).click();

  // Quatre groupes : opencode 2 sous main.rs, opencode 1 sous README.md (fenêtre agrandie pour que les côtés soient des cibles).
  await page.setViewportSize({ width: 1700, height: 1000 });
  await deposer(page, onglet(page, "opencode 2"), groupeDe(page, /^main\.rs/), "bas");
  await deposer(page, onglet(page, "opencode 1"), groupeDe(page, /^README\.md/), "bas");
  await expect(groupes(page)).toHaveCount(4);
  await onglet(page, "opencode 2").click();
  const emplacements = async () => {
    const out = {};
    for (const nom of [/^main\.rs/, "opencode 2", /^README\.md/, "opencode 1"]) out[nom] = await groupeDe(page, nom).boundingBox();
    return out;
  };

  // AC-079-20 : à 800 × 480, rien ne se ferme, les proportions restent ; AC-028-9 et AC-028-20.
  await page.setViewportSize({ width: 800, height: 480 });
  await expect(groupes(page)).toHaveCount(4);
  const petit = await boites(page);
  const largeurs = petit.map((b) => b.width);
  expect(Math.max(...largeurs) - Math.min(...largeurs)).toBeLessThanOrEqual(2);
  const hauteurs = petit.map((b) => b.height);
  expect(Math.max(...hauteurs) - Math.min(...hauteurs)).toBeLessThanOrEqual(2);
  const contenu = async () => page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, x: scrollX, y: scrollY }));
  expect(await contenu()).toEqual({ h: 480, w: 800, x: 0, y: 0 });

  // AC-079-18 : après un rechargement, les mêmes groupes, au même endroit, les mêmes onglets actifs, le même groupe courant.
  const avant = await emplacements();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((ok) => {
            const d = indexedDB.open("yaide", 1);
            d.onsuccess = () => {
              const r = d.result.transaction("cles").objectStore("cles").get("onglets");
              r.onsuccess = () => ok(new Set((r.result?.liste ?? []).map((o) => o.groupe)).size);
            };
          }),
      ),
    )
    .toBe(4);
  // L'onglet actif et le groupe courant sont écrits dans IndexedDB sans attente : un rechargement coupant l'écriture les perdrait.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((ok) => {
            const d = indexedDB.open("yaide", 1);
            d.onsuccess = () => {
              const r = d.result.transaction("cles").objectStore("cles").get("onglets");
              r.onsuccess = () => {
                d.result.close();
                const v = r.result;
                ok(v?.liste?.some((o) => o.opencode && o.numero === 2 && String(v.actif).endsWith(o.id)));
              };
            };
          }),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(groupes(page)).toHaveCount(4);
  await expect(onglet(page, "opencode 2")).toHaveAttribute("aria-selected", "true");
  for (const nom of [/^main\.rs/, /^README\.md/, "opencode 1"]) await expect(onglet(page, nom)).toBeVisible();
  const apres = await emplacements();
  for (const [nom, b] of Object.entries(avant)) {
    expect(apres[nom].x).toBeCloseTo(b.x, 0);
    expect(apres[nom].y).toBeCloseTo(b.y, 0);
    expect(apres[nom].width).toBeCloseTo(b.width, 0);
    expect(apres[nom].height).toBeCloseTo(b.height, 0);
  }
  expect(await filetActif(page, "opencode 2")).toMatch(/ 2px /);
  expect(await contenu()).toEqual({ h: 480, w: 800, x: 0, y: 0 });
});

const filetActif = (page, nom) => onglet(page, nom).evaluate((t) => getComputedStyle(t.closest(".onglet-cellule")).boxShadow);

// ---- REQ-080 : changer la taille des groupes ----

const poignee = (page, a, b) => page.getByRole("separator", { name: `Entre les groupes ${a} et ${b}` });
const partGardee = (page) =>
  page.evaluate(
    () =>
      new Promise((ok) => {
        const d = indexedDB.open("yaide", 1);
        d.onsuccess = () => {
          const r = d.result.transaction("cles").objectStore("cles").get("onglets");
          r.onsuccess = () => ok(JSON.stringify(r.result?.disposition?.arbre ?? null).match(/"part":[\d.]+/g));
        };
      }),
  );
/** Glisse une poignée vers (x, y), en passant par `par` (points intermédiaires), sans relâcher. */
async function tirer(page, sep, x, y, par = []) {
  const b = await sep.boundingBox();
  // Une poignée verticale se prend en haut : à mi-hauteur, une poignée horizontale peut la croiser.
  await page.mouse.move(b.x + b.width / 2, b.width < b.height ? b.y + 100 : b.y + b.height / 2);
  await page.mouse.down();
  for (const [px, py] of par) await page.mouse.move(px, py, { steps: 6 });
  await page.mouse.move(x, y, { steps: 6 });
}

test("REQ080_P051_parcours_largeur_hauteur_clavier_rechargement", async ({ page }) => {
  yaide = await lancerYaide({ claude: fauxClaude() });
  await page.setViewportSize({ width: 1700, height: 1000 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await ouvrirFichiers(page, "src");
  await ouvrirFichiers(page, "main.rs", "README.md");
  await deposer(page, onglet(page, /^README\.md/), groupes(page).first(), "droite");
  await onglet(page, /^main\.rs/).click();
  await boutonClaude(page).click();
  const terminal = groupeDe(page, "Claude 1");
  await expect(terminal.locator(".claude:visible .xterm-rows")).toContainText("$");
  await taper(page, terminal, "echo avant");
  await expect(terminal.locator(".claude:visible .xterm-rows")).toContainText("avant");

  // AC-080-16 : boîte de 4 px, 1 px de place entre les deux groupes.
  const sep = poignee(page, 1, 2);
  await expect(sep).toHaveAttribute("aria-orientation", "vertical");
  const [g1, g2] = await boites(page);
  expect((await sep.boundingBox()).width).toBe(4);
  expect(g2.left - g1.right).toBeCloseTo(1, 0);
  const sttyAvant = await stty(page, terminal);

  // AC-080-1, AC-080-14, AC-080-15 : glissé à la souris au-dessus du terminal ; le focus et le pointeur ne changent pas.
  await terminal.locator(".xterm-helper-textarea").focus();
  const t = await terminal.locator(".claude:visible").boundingBox();
  await tirer(page, sep, g1.right - 250, 500, [[t.x + t.width - 40, 500]]);
  expect(await page.evaluate(() => document.documentElement.classList.contains("poignee-glisse-vertical"))).toBe(true);
  expect(await terminal.locator(".claude:visible").evaluate((e) => getComputedStyle(e).cursor)).toBe("col-resize");
  await page.mouse.up();
  const [a1, a2] = await boites(page);
  expect(a1.width).toBeCloseTo(g1.width - 250, -1);
  expect(Math.abs(a1.width + a2.width - (g1.width + g2.width))).toBeLessThanOrEqual(1);
  await expect(terminal.locator(".xterm-helper-textarea")).toBeFocused();
  await page.keyboard.type("echo apres");
  await page.keyboard.press("Enter");
  // AC-080-10 : le terminal connaît sa taille, sa session n'est pas relancée.
  const sttyApres = await stty(page, terminal);
  expect(Number(sttyApres.split(" ")[1])).toBeLessThan(Number(sttyAvant.split(" ")[1]));
  await expect(terminal.locator(".claude:visible .xterm-rows")).toContainText("avant");
  await expect(terminal.locator(".claude:visible .xterm-rows")).toContainText("apres");

  // AC-080-5 : la poignée s'arrête à 320 px de large de chaque côté.
  await tirer(page, sep, 1690, 500);
  await page.mouse.up();
  expect((await boites(page))[1].width).toBeGreaterThanOrEqual(319);
  await tirer(page, sep, 5, 500);
  await page.mouse.up();
  expect((await boites(page))[0].width).toBeGreaterThanOrEqual(319);

  // Deux groupes l'un sur l'autre à droite (README.md en haut, main.rs en bas).
  await deposer(page, onglet(page, /^main\.rs/), groupeDe(page, /^README\.md/), "bas");
  await expect(groupes(page)).toHaveCount(3);
  const [b1, b2, b3] = await boites(page);
  expect(Math.abs(b2.height - b3.height)).toBeLessThanOrEqual(1);
  // AC-080-4 : la poignée verticale garde le rapport de hauteur des deux groupes de droite.
  await tirer(page, sep, b1.right + 150, 500);
  await page.mouse.up();
  const [c1, c2, c3] = await boites(page);
  expect(c1.width).toBeGreaterThan(b1.width + 100);
  expect(Math.abs(c2.height / c3.height - b2.height / b3.height)).toBeLessThan(0.02);
  // AC-080-2 et AC-080-4 : la poignée horizontale ne touche pas au groupe de gauche et garde la somme des hauteurs.
  const hor = poignee(page, 2, 3);
  await expect(hor).toHaveAttribute("aria-orientation", "horizontal");
  const h = await hor.boundingBox();
  await tirer(page, hor, h.x + h.width / 2, h.y - 120);
  expect(await hor.evaluate((e) => getComputedStyle(e).cursor)).toBe("row-resize");
  await page.mouse.up();
  const [d1, d2, d3] = await boites(page);
  expect(d1).toEqual(c1);
  expect(d2.height).toBeCloseTo(c2.height - 120, -1);
  expect(Math.abs(d2.height + d3.height - (c2.height + c3.height))).toBeLessThanOrEqual(1);

  // AC-080-7 : fermer un onglet qui vide un groupe garde le partage des autres découpes.
  await page.getByRole("button", { name: /^Fermer main\.rs/ }).click();
  await expect(groupes(page)).toHaveCount(2);
  const [e1] = await boites(page);
  expect(Math.abs(e1.width - d1.width)).toBeLessThanOrEqual(1);

  // AC-080-6 : au clavier (16 px), puis après un rechargement, le partage est le même à 1 px près.
  await sep.focus();
  await page.keyboard.press("ArrowRight");
  const [f1, f2] = await boites(page);
  expect(Math.abs(f1.width - e1.width - 16)).toBeLessThanOrEqual(1);
  await expect.poll(async () => Math.abs(Number(((await partGardee(page)) ?? [])[0]?.slice(7)) - f1.width / (f1.width + f2.width))).toBeLessThan(0.002);
  await page.reload();
  await expect(groupes(page)).toHaveCount(2);
  await expect.poll(async () => Math.abs((await boites(page))[0].width - f1.width)).toBeLessThanOrEqual(1);
  expect(Math.abs((await boites(page))[1].width - f2.width)).toBeLessThanOrEqual(1);
});

test("REQ080_P052_petite_fenetre_sans_place", async ({ page }) => {
  yaide = await lancerYaide();
  await page.setViewportSize({ width: 1700, height: 1000 });
  await ouvrirYaide(page, yaide.origine);
  await ouvrirFichiers(page, "src");
  await ouvrirFichiers(page, "main.rs", "README.md");
  await deposer(page, onglet(page, /^README\.md/), groupes(page).first(), "droite");
  const sep = poignee(page, 1, 2);
  await sep.focus();
  await page.keyboard.press("ArrowRight");
  const grand = await boites(page);
  await expect.poll(() => partGardee(page)).not.toBeNull();
  const avant = await partGardee(page);

  // AC-080-8 : fenêtre rétrécie, les proportions restent ; AC-080-9, AC-080-18 : la place manque.
  await page.setViewportSize({ width: 800, height: 480 });
  const petit = await boites(page);
  expect(Math.abs(petit[0].width / petit[1].width - grand[0].width / grand[1].width)).toBeLessThan(0.1);
  expect(petit[0].width + petit[1].width).toBeLessThan(640);
  const gauche = String(Math.round(petit[0].width));
  for (const attr of ["aria-valuemin", "aria-valuemax", "aria-valuenow"]) await expect.poll(async () => Math.abs(Number(await sep.getAttribute(attr)) - Number(gauche))).toBeLessThanOrEqual(1);
  expect(await sep.evaluate((e) => getComputedStyle(e).cursor)).toBe("col-resize");
  await sep.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  const b = await sep.boundingBox();
  await tirer(page, sep, b.x + 60, b.y + 100);
  await page.mouse.up();
  expect(await boites(page)).toEqual(petit);
  expect(await partGardee(page)).toEqual(avant);

  // AC-028-9 et AC-028-20 : rien ne déborde ; AC-080-8 : fenêtre rendue, groupes rendus.
  expect(await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth }))).toEqual({ h: 480, w: 800 });
  await page.setViewportSize({ width: 1700, height: 1000 });
  await expect.poll(async () => Math.abs((await boites(page))[0].width - grand[0].width)).toBeLessThanOrEqual(1);
  expect(Math.abs((await boites(page))[1].width - grand[1].width)).toBeLessThanOrEqual(1);
  expect(await partGardee(page)).toEqual(avant);
});

test("REQ080_AC1_glisse_au_dessus_d_un_apercu_html", async ({ page }) => {
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "page.html"), "<h1>Bonjour</h1>\n");
  yaide = await lancerYaide({ dossier });
  await page.setViewportSize({ width: 1700, height: 1000 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await ouvrirFichiers(page, "page.html", "README.md");
  await onglet(page, /^page\.html/).click();
  await expect(page.locator("iframe:visible")).toHaveCount(1);
  await deposer(page, onglet(page, /^README\.md/), groupeDe(page, /^page\.html/), "droite");
  const [g1, g2] = await boites(page);
  const sep = poignee(page, 1, 2);
  const iframe = await page.locator("iframe:visible").boundingBox();
  // Vers la gauche, au-dessus de l'aperçu : la taille suit ; relâché dessus, le glissé finit.
  await tirer(page, sep, iframe.x + 100, iframe.y + 200, [[iframe.x + iframe.width - 50, iframe.y + 100]]);
  await expect.poll(async () => (await boites(page))[0].width).toBeLessThan(g1.width - 100);
  await page.mouse.up();
  const [a1, a2] = await boites(page);
  expect(a1.width).toBeLessThan(g1.width - 100);
  expect(Math.abs(a1.width + a2.width - (g1.width + g2.width))).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.classList.contains("poignee-glisse-vertical"))).toBe(false);
  await page.mouse.move(a1.right - 100, 400);
  expect(await boites(page)).toEqual([a1, a2]);
});
