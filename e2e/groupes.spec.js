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
  const separations = await page.locator(".cadre-decoupe > :nth-child(2)").evaluateAll((l) => l.map((e) => getComputedStyle(e)).map((s) => [s.borderLeftWidth, s.borderTopWidth]));
  expect(separations.map((s) => s.sort().join())).toEqual(["0px,1px", "0px,1px"]);

  // AC-079-5 : le dernier onglet d'un groupe se ferme → son voisin prend toute la place.
  await page.getByRole("button", { name: "Fermer Claude 1" }).click();
  await expect(groupes(page)).toHaveCount(2);
  const [g2, d2] = await boites(page);
  expect(Math.abs(d2.height - g2.height)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Fermer Claude 2" }).click();
  await page.getByRole("button", { name: /^Fermer README\.md/ }).click();
  await expect(groupes(page)).toHaveCount(1);
  expect((await groupes(page).boundingBox()).width).toBeCloseTo(gauche.width + droite.width, 0);
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
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
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
