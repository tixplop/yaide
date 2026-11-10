import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { lancerYaide, ouvrirYaide, tailleStable, temoin, attendre } from "./aides.js";

let yaide;
test.beforeEach(async () => {
  yaide = await lancerYaide({ shell: "/bin/sh" });
});
test.afterEach(() => yaide.arreter());

// Panneau déplié, deux boutons portent « Replier le panneau » : ceux de la barre de titre se cherchent dans `header`.
const bouton = (page, nom) => (/ le panneau$/.test(nom) ? page.locator("header") : page).getByRole("button", { name: nom, exact: true });
const ecran = (page) => page.locator(".terminal:visible .xterm-rows");
const taper = async (page, commande) => {
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type(commande);
  await page.keyboard.press("Enter");
};
const boite = (page, sel) =>
  page.locator(sel).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
const onglets = (page) => page.getByRole("tablist", { name: "Shells" }).getByRole("tab");

test("REQ046_AC1_AC2_AC3_REQ028_AC15_REQ048_AC11_panneau_replie_Ctrl_P_Entree_apres_Bas_et_menu_ouvert", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await test.step("REQ046_AC1_AC2_AC3_panneau_replie_largeurs_meme_vue_et_Ctrl_P_ne_deplie_pas", async () => {
    await page.getByRole("tab", { name: "Git", exact: true }).click();
    await page.getByLabel("Message", { exact: true }).fill("brouillon");
    const avant = await boite(page, "main");
    await bouton(page, "Replier le panneau").click();
    await expect(page.locator("aside.cadre-panneau")).toBeHidden();
    await expect(page.getByRole("separator", { name: "Largeur du panneau" })).toBeHidden();
    const replie = await boite(page, "main");
    expect(replie.w).toBeGreaterThan(avant.w + 200);
    await expect(bouton(page, "Déplier le panneau")).toBeFocused();
    await page.keyboard.press("Control+p");
    await page.keyboard.press("Escape");
    await expect(page.locator("aside.cadre-panneau")).toBeHidden();
    await bouton(page, "Déplier le panneau").click();
    await expect(page.locator("aside.cadre-panneau")).toBeVisible();
    expect((await boite(page, "main")).w).toBeCloseTo(avant.w, 0);
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("brouillon");
    await expect(page.locator("aside.cadre-panneau .cadre-panneau-corps")).toBeFocused();
    // Clic sur un onglet du rail, panneau replié : il se déplie sur cette vue.
    await bouton(page, "Replier le panneau").click();
    await page.getByRole("tab", { name: "Recherche", exact: true }).click();
    await expect(page.locator("aside.cadre-panneau h2")).toHaveText("Recherche");
    await expect(page.locator("aside.cadre-panneau")).toBeVisible();
  });
  await test.step("REQ046_AC3_REQ028_AC15_Entree_apres_Bas_deplie_et_Ctrl_Maj_F_ne_deplie_pas", async () => {
    await page.getByRole("tab", { name: "Fichiers", exact: true }).click();
    await bouton(page, "Replier le panneau").click();
    await page.keyboard.press("Control+Shift+F");
    const fichiers = page.getByRole("tab", { name: "Fichiers", exact: true });
    await expect(fichiers).toBeFocused();
    await expect(fichiers).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("aside.cadre-panneau")).toBeHidden();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("tab", { name: "Recherche", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("aside.cadre-panneau")).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(page.locator("aside.cadre-panneau h2")).toHaveText("Recherche");
    await expect(page.locator("aside.cadre-panneau")).toBeVisible();
    for (const [touche, titre] of [["g", "Git"], ["f", "Fichiers"], ["r", "Recherche"]]) {
      await bouton(page, "Replier le panneau").click();
      await page.getByRole("tab", { selected: true }).focus();
      await page.keyboard.press(touche);
      await expect(page.locator("aside.cadre-panneau h2")).toHaveText(titre);
      await expect(page.locator("aside.cadre-panneau")).toBeVisible();
    }
  });
  await test.step("REQ048_AC11_menu_ouvert_le_premier_clic_ferme_le_menu", async () => {
    await page.getByRole("tab", { name: "Fichiers", exact: true }).click();
    await page.locator("aside.cadre-panneau").getByRole("treeitem").first().click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.locator("aside.cadre-panneau").getByRole("button", { name: "Replier le panneau", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator("aside.cadre-panneau")).toBeVisible();
    await page.locator("aside.cadre-panneau").getByRole("button", { name: "Replier le panneau", exact: true }).click();
    await expect(page.locator("aside.cadre-panneau")).toBeHidden();
  });
});

test("REQ032_AC15_REQ046_AC4_AC12_AC15_shell_et_largeur_hauteur_bornee_contour_et_rechargement", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await test.step("REQ046_AC4_le_shell_connait_sa_nouvelle_largeur", async () => {
    const avant = await tailleStable(page);
    await bouton(page, "Replier le panneau").click();
    const replie = await tailleStable(page);
    expect(replie).not.toBe(avant);
    await taper(page, "stty size");
    await expect(ecran(page)).toContainText(replie);
    await bouton(page, "Déplier le panneau").click();
    const deplie = await tailleStable(page);
    expect(deplie).toBe(avant);
    await taper(page, "clear; stty size");
    await expect(ecran(page)).toContainText(deplie);
  });
  await test.step("REQ032_AC15_zone_repliee_fenetre_reduite_puis_depliee_la_hauteur_est_bornee_puis_rendue", async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    const poignee = page.getByRole("separator", { name: "Hauteur des shells" });
    await poignee.focus();
    for (let i = 0; i < 30 && (await poignee.getAttribute("aria-valuenow")) !== "350"; i++) await page.keyboard.press("ArrowUp");
    await expect(poignee).toHaveAttribute("aria-valuenow", "350");
    await bouton(page, "Replier les shells").click();
    await page.setViewportSize({ width: 800, height: 480 });
    await bouton(page, "Déplier les shells").click();
    await expect(poignee).toHaveAttribute("aria-valuenow", "299");
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(poignee).toHaveAttribute("aria-valuenow", "350");
  });
  await test.step("REQ046_AC15_contour_apres_un_clic_et_Tab_ne_s_arrete_pas_dans_une_zone_repliee", async () => {
    await bouton(page, "Replier le panneau").click();
    await bouton(page, "Replier les shells").click();
    const contour = await bouton(page, "Déplier les shells").evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(contour).not.toBe("none");
    await page.getByRole("button", { name: "Ouverture rapide" }).focus();
    const vus = new Set();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      vus.add(await page.evaluate(() => (document.activeElement.closest("aside, .cadre-shells") ? "zone" : "ok")));
      // Dans l'éditeur, Tab indente : on le quitte par Échap.
      await page.keyboard.press("Escape");
    }
    expect(vus.has("zone")).toBe(false);
  });
  await test.step("REQ046_AC12_rechargement_les_deux_replis_restent", async () => {
    await bouton(page, "Déplier le panneau").click();
    await bouton(page, "Déplier les shells").click();
    const largeur = page.getByRole("separator", { name: "Largeur du panneau" });
    const hauteur = page.getByRole("separator", { name: "Hauteur des shells" });
    await largeur.focus();
    await page.keyboard.press("ArrowRight");
    await hauteur.focus();
    await page.keyboard.press("ArrowUp");
    const tailles = [await largeur.getAttribute("aria-valuenow"), await hauteur.getAttribute("aria-valuenow")];
    await bouton(page, "Replier le panneau").click();
    await bouton(page, "Replier les shells").click();
    // Les écritures dans IndexedDB sont asynchrones : on attend la valeur gardée.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise((ok) => {
              const d = indexedDB.open("yaide", 1);
              d.onsuccess = () => {
                const r = d.result.transaction("cles").objectStore("cles").get("serveur");
                r.onsuccess = () => ok(r.result?.replie === true);
              };
            }),
        ),
      )
      .toBe(true);
    await page.reload();
    await bouton(page, "Déplier le panneau").waitFor();
    await expect(bouton(page, "Déplier les shells")).toBeVisible();
    await expect(page.locator("aside.cadre-panneau")).toBeHidden();
    await expect(page.locator(".cadre-shells")).toBeHidden();
    await bouton(page, "Déplier les shells").click();
    await expect(onglets(page)).toHaveText(["shell 1"]);
    await bouton(page, "Déplier le panneau").click();
    await expect(largeur).toHaveAttribute("aria-valuenow", tailles[0]);
    await expect(hauteur).toHaveAttribute("aria-valuenow", tailles[1]);
    // Le terminal est monté et mesuré : sa taille réelle est juste.
    const stable = await tailleStable(page);
    await taper(page, "stty size");
    await expect(ecran(page)).toContainText(stable);
  });
});

test("REQ046_AC5_AC6_AC7_zone_repliee_les_shells_vivent_et_la_taille_est_juste_au_depliage", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await bouton(page, "Nouveau shell").click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  const depart = temoin();
  const fini = temoin();
  await taper(page, attendre(depart, `echo fini; touch ${fini}`));
  const hauteur = (await boite(page, ".cadre-code")).h;
  await bouton(page, "Replier les shells").click();
  await expect(page.locator(".cadre-shells")).toBeHidden();
  await expect(page.getByRole("separator", { name: "Hauteur des shells" })).toBeHidden();
  expect((await boite(page, ".cadre-code")).h).toBeGreaterThan(hauteur + 100);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(bouton(page, "Déplier les shells")).toBeFocused();
  const liste = await page.evaluate(() => fetch("/api/shells").then((r) => r.json()));
  expect(liste.shells).toEqual([1, 2]);
  await expect(bouton(page, "Shells réduits")).toBeDisabled();
  await expect(bouton(page, "Réduire le shell")).toBeDisabled();
  await expect(bouton(page, "Fermer le shell")).toBeDisabled();
  await expect(bouton(page, "Nouveau shell")).toBeEnabled();
  await page.setViewportSize({ width: 1100, height: 640 });
  fs.writeFileSync(depart, "");
  await expect.poll(() => fs.existsSync(fini)).toBe(true);
  await bouton(page, "Déplier les shells").click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await expect(page.locator(".terminal:visible .xterm-helper-textarea")).toBeFocused();
  const stable = await tailleStable(page);
  expect(stable).not.toBe("0 0");
  await taper(page, "stty size");
  await expect(ecran(page)).toContainText(stable);
  // Une ligne valant exactement « fini » : la sortie du programme, pas l'écho de la commande.
  await expect(ecran(page).locator("div").filter({ hasText: /^fini\s*$/ })).toHaveCount(1);
});

test("REQ046_AC8_Nouveau_shell_deplie_la_zone_et_ouvre_un_shell_actif_avec_le_focus", async ({ page }) => {
  await ouvrirYaide(page, yaide.origine);
  await bouton(page, "Replier les shells").click();
  await bouton(page, "Nouveau shell").click();
  await expect(onglets(page)).toHaveText(["shell 1", "shell 2"]);
  await expect(page.getByRole("tab", { name: "shell 2" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".terminal:visible .xterm-helper-textarea")).toBeFocused();
});



test("REQ046_AC14_AC17_a_800_par_480_quatre_boutons_sans_chevauchement_et_info_bulle", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirYaide(page, yaide.origine);
  const noms = ["Ouverture rapide", "Replier le panneau", "Replier les shells", "Thème clair", "Déconnexion"];
  const boites = [];
  for (const nom of noms) boites.push(await bouton(page, nom).boundingBox());
  for (let i = 1; i < boites.length; i++) {
    expect(boites[i].x, noms[i]).toBeGreaterThanOrEqual(boites[i - 1].x + boites[i - 1].width - 0.5);
    expect(boites[i].width).toBeGreaterThanOrEqual(24);
  }
  expect(boites.at(-1).x + boites.at(-1).width).toBeLessThanOrEqual(800);
  const b = bouton(page, "Replier le panneau");
  await b.hover();
  await page.clock.fastForward(400);
  const bulle = page.getByRole("tooltip");
  await expect(bulle).toHaveText("Replier le panneau");
  const t = await bulle.boundingBox();
  expect(t.x).toBeGreaterThanOrEqual(0);
  expect(t.x + t.width).toBeLessThanOrEqual(800);
  await b.click();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.mouse.move(400, 300);
  await bouton(page, "Déplier le panneau").hover();
  await page.clock.fastForward(400);
  await expect(page.getByRole("tooltip")).toHaveText("Déplier le panneau");
});



// ---- T-060 : replier le panneau depuis son en-tête ----

test("REQ048_AC5_AC8_AC9_en_tete_a_240_et_280_px", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1100, height: 700 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
  const aside = page.locator("aside.cadre-panneau");
  const repli = aside.getByRole("button", { name: "Replier le panneau", exact: true });
  for (const largeur of ["240", "280"]) {
    await poignee.focus();
    if (largeur === "240") for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
    else {
      const p = await poignee.boundingBox();
      await page.mouse.move(p.x + p.width / 2, 300);
      await page.mouse.down();
      await page.mouse.move(p.x + p.width / 2 + 40, 300, { steps: 5 });
      await page.mouse.up();
    }
    await expect(poignee).toHaveAttribute("aria-valuenow", largeur);
    for (const vue of ["Fichiers", "Recherche", "Git"]) {
      await page.getByRole("tab", { name: vue, exact: true }).click();
      const tete = await boite(page, "aside.cadre-panneau .ya-panel-head");
      expect(tete.h, `${vue} ${largeur}`).toBe(35);
      const b = await repli.boundingBox();
      const a = await boite(page, "aside.cadre-panneau");
      expect(Math.round(a.x + a.w - (b.x + b.width)), `${vue} ${largeur}`).toBe(4);
      if (vue === "Fichiers") {
        const s = await aside.getByRole("button", { name: "Supprimer", exact: true }).boundingBox();
        expect(Math.round(s.x + s.width)).toBe(Math.round(b.x + b.width));
      }
      if (largeur === "240" && vue === "Recherche") {
        const h = await aside.locator("h2").evaluate((e) => {
          const r = document.createRange();
          r.selectNodeContents(e);
          const q = r.getBoundingClientRect();
          return { droite: q.right, large: e.scrollWidth <= e.clientWidth };
        });
        expect(h.droite).toBeLessThan(b.x);
        expect(h.large).toBe(true);
      }
      const verifierBulle = async (mode) => {
        if (mode === "survol") await repli.hover();
        else {
          await page.keyboard.press("Shift");
          await repli.focus();
        }
        await page.clock.fastForward(400);
        const bulle = page.getByRole("tooltip");
        await expect(bulle, `${vue} ${largeur} ${mode}`).toHaveText("Replier le panneau");
        const t = await bulle.boundingBox();
        expect(t.x).toBeGreaterThanOrEqual(b.x + b.width - 1);
        for (const autre of await aside.getByRole("button").all()) {
          const o = await autre.boundingBox();
          if (!o || (o.x === b.x && o.y === b.y)) continue;
          const separes = t.x + t.width <= o.x || o.x + o.width <= t.x || t.y + t.height <= o.y || o.y + o.height <= t.y;
          expect(separes, `${vue} ${largeur} ${mode} bulle sur un bouton`).toBe(true);
        }
        await repli.blur();
        await page.mouse.move(600, 600);
        await expect(page.getByRole("tooltip")).toHaveCount(0);
      };
      await verifierBulle("survol");
      await verifierBulle("focus");
    }
  }
});

