import { test, expect } from "@playwright/test";
import { lancerYaide } from "./aides.js";

let yaide;
test.beforeEach(async () => {
  yaide = await lancerYaide();
});
test.afterEach(() => yaide.arreter());

async function ouvrir(page) {
  await page.goto(yaide.origine + "/");
  await page.getByLabel("Mot de passe").waitFor();
}

async function seConnecter(page, mdp = "mdp") {
  await ouvrir(page);
  await page.getByLabel("Mot de passe").fill(mdp);
  await page.keyboard.press("Enter");
}

test("REQ004_AC1_REQ005_AC4_bon_mot_de_passe_puis_la_session_reste_valide_au_rechargement", async ({ page }) => {
  await seConnecter(page);
  await test.step("REQ004_AC1_bon_mot_de_passe_affiche_la_vue_principale", async () => {
    await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible();
    await expect(page.getByRole("tablist").first()).toBeVisible();
  });
  await test.step("REQ005_AC4_la_session_reste_valide_au_rechargement", async () => {
    await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible();
  });
});

test("REQ004_AC2_mauvais_mot_de_passe_affiche_le_message", async ({ page }) => {
  await seConnecter(page, "faux");
  await expect(page.getByRole("alert")).toHaveText("Mot de passe incorrect.");
});

test("REQ004_AC3_cinq_echecs_demandent_d_attendre_une_minute", async ({ page }) => {
  await ouvrir(page);
  for (let i = 0; i < 5; i++) {
    await page.getByLabel("Mot de passe").fill("faux");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Mot de passe incorrect.");
  }
  await page.getByLabel("Mot de passe").fill("mdp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Trop d'essais. Attendez une minute.");
});

test("REQ004_AC5_ecran_de_connexion_nom_chemin_et_chemin_long_coupe_au_debut", async ({ page }) => {
  await ouvrir(page);
  await test.step("REQ004_AC5_ecran_de_connexion_affiche_le_nom_et_le_chemin", async () => {
    await expect(page.getByRole("heading", { name: "yaide", exact: true })).toBeVisible();
    await expect(page.locator(".connexion-chemin")).toHaveText(yaide.dossier);
  });
  await test.step("REQ004_AC5_chemin_long_coupe_au_debut_avec_info_bulle", async () => {
    await page.setViewportSize({ width: 800, height: 480 });
    await page.evaluate(() => {
      const p = document.querySelector(".connexion-chemin");
      p.title = "/" + "tres-long-dossier/".repeat(10) + "projet";
      p.firstChild.textContent = p.title;
    });
    const p = page.locator(".connexion-chemin");
    expect(await p.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    expect(await p.evaluate((e) => getComputedStyle(e).textOverflow)).toBe("ellipsis");
    expect(await p.evaluate((e) => getComputedStyle(e).direction)).toBe("rtl");
    await expect(p).toHaveAttribute("title", /projet$/);
  });
});

test("REQ004_AC6_focus_dans_le_champ_et_Entree_envoie", async ({ page }) => {
  await ouvrir(page);
  const champ = page.getByLabel("Mot de passe");
  await expect(champ).toHaveAttribute("type", "password");
  await expect(champ).toBeFocused();
  await champ.fill("mdp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible();
});

test("REQ004_AC7_apres_un_echec_alerte_aria_et_texte_selectionne", async ({ page }) => {
  await seConnecter(page, "faux");
  const champ = page.getByLabel("Mot de passe");
  const alerte = page.getByRole("alert");
  await expect(alerte).toBeVisible();
  await expect(champ).toHaveAttribute("aria-invalid", "true");
  const id = await alerte.getAttribute("id");
  await expect(champ).toHaveAttribute("aria-describedby", new RegExp(id));
  await expect(champ).toBeFocused();
  expect(await champ.evaluate((e) => e.selectionStart === 0 && e.selectionEnd === e.value.length && e.value.length > 0)).toBe(true);
});

test("REQ004_AC9_champ_vide_ne_fait_aucune_requete_ni_echec", async ({ page }) => {
  await ouvrir(page);
  const requetes = [];
  page.on("request", (r) => r.url().includes("/api/connexion") && requetes.push(r.url()));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Saisissez le mot de passe.");
  expect(requetes).toEqual([]);
  await expect(page.getByLabel("Mot de passe")).toBeFocused();
  // Quatre échecs ensuite : l'envoi à vide n'a pas compté.
  for (let i = 0; i < 4; i++) {
    await page.getByLabel("Mot de passe").fill("faux");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Mot de passe incorrect.");
  }
  await page.getByLabel("Mot de passe").fill("mdp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible();
});

test("REQ005_AC3_deconnexion_ramene_a_la_connexion_et_le_cookie_n_est_plus_valide", async ({ page, context }) => {
  await seConnecter(page);
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page.getByLabel("Mot de passe")).toBeVisible();
  expect(await context.cookies()).toEqual([]);
  await page.reload();
  await expect(page.getByLabel("Mot de passe")).toBeVisible();
});


test("REQ028_AC1_AC2_AC3_AC4_AC5_AC6_AC7_AC8_apres_connexion_titre_theme_rail_touches_focus_et_tab", async ({ page }) => {
  await seConnecter(page);
  await test.step("REQ028_AC2_barre_de_titre_nom_du_projet_et_deconnexion", async () => {
    await expect(page.locator("header").getByRole("button", { name: "Ouverture rapide" })).toHaveText(yaide.dossier.split("/").pop());
    await expect(page.locator("header").getByRole("button", { name: "Déconnexion" })).toBeVisible();
  });
  await test.step("REQ028_AC3_theme_sombre_et_accent_bleu_sur_l_onglet_actif", async () => {
    const fond = await page.locator(".cadre").evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(fond).toBe("rgb(31, 31, 31)");
    const actif = page.getByRole("tab", { name: "Fichiers" });
    expect(await actif.evaluate((e) => getComputedStyle(e).boxShadow)).toContain("rgb(77, 170, 252)");
    const police = await page.locator(".cadre").evaluate((e) => getComputedStyle(e).fontFamily);
    expect(police).toContain("system-ui");
  });
  await test.step("REQ028_AC4_le_rail_est_une_liste_d_onglets_verticale", async () => {
    const rail = page.getByRole("navigation", { name: "Panneaux" }).getByRole("tablist");
    await expect(rail).toHaveAttribute("aria-orientation", "vertical");
    await expect(rail.getByRole("tab")).toHaveText(["", "", ""]);
    expect(await rail.getByRole("tab").evaluateAll((l) => l.map((t) => t.getAttribute("aria-keyshortcuts")))).toEqual(["F", "R", "G"]);
    for (const nom of ["Fichiers", "Recherche", "Git"]) await expect(rail.getByRole("tab", { name: nom })).toHaveAttribute("aria-selected", /true|false/);
    // « Agent » et « Agents » sont en haut du rail droit, hors de cette liste.
    await expect(rail.getByRole("tab", { name: "Agent" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Agent", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toBeVisible();
  });
  await test.step("REQ028_AC6_titre_de_l_onglet_du_navigateur", async () => {
    const nom = yaide.dossier.split("/").pop();
    await expect(page).toHaveTitle(`${nom} — yaide`);
  });
  await test.step("REQ028_AC7_contour_de_focus_visible_sur_les_elements_atteints_par_Tab", async () => {
    await page.getByRole("button", { name: "Déconnexion" }).focus();
    {
      await page.keyboard.press("Tab");
      const style = await page.evaluate(() => {
        const s = getComputedStyle(document.activeElement);
        return [s.outlineStyle, s.outlineWidth];
      });
      expect(style[0]).not.toBe("none");
      expect(style[1]).not.toBe("0px");
    }
    await page.getByRole("button", { name: "Déconnexion" }).focus();
    expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).not.toBe("none");
  });
  await test.step("REQ028_AC8_Tab_va_de_Deconnexion_au_rail_puis_au_panneau", async () => {
    await page.getByRole("button", { name: "Déconnexion" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tab", { name: "Fichiers" })).toBeFocused();
  });
  await test.step("REQ028_AC1_F_R_G_affichent_les_panneaux", async () => {
    for (const [nom, titre] of [["Recherche", "Recherche"], ["Git", "Git"], ["Fichiers", "Fichiers"]]) {
      await page.getByRole("tab", { name: nom }).click();
      await expect(page.locator("aside.cadre-panneau h2")).toHaveText(titre);
      await expect(page.getByRole("tab", { name: nom })).toHaveAttribute("aria-selected", "true");
    }
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible();
  await test.step("REQ028_AC5_touches_F_R_G_sur_le_rail_seulement", async () => {
    await page.getByRole("tab", { name: "Fichiers" }).focus();
    await page.keyboard.press("r");
    await expect(page.locator("aside.cadre-panneau h2")).toHaveText("Recherche");
    expect(await page.evaluate(() => !!document.activeElement.closest("aside"))).toBe(true);
    // Hors du rail, la lettre ne fait rien.
    await page.getByRole("button", { name: "Déconnexion" }).focus();
    await page.keyboard.press("g");
    await expect(page.locator("aside.cadre-panneau h2")).toHaveText("Recherche");
    await page.getByRole("tab", { name: "Recherche" }).focus();
    await page.keyboard.press("G");
    await expect(page.locator("aside.cadre-panneau h2")).toHaveText("Git");
  });
});

test("REQ028_AC9_a_800_sur_480_rien_ne_se_superpose_et_un_nom_de_projet_long_ne_deborde_pas", async ({ page }) => {
  await seConnecter(page);
  await test.step("REQ028_AC9_a_800_sur_480_rien_ne_se_superpose_en_dessous_la_page_defile", async () => {
    await page.setViewportSize({ width: 800, height: 480 });
    const boites = async () => {
      const r = (s) => page.locator(s).first().boundingBox();
      return { barre: await r("header"), rail: await r(".cadre-rail"), panneau: await r("aside.cadre-panneau"), principal: await r("main") };
    };
    await expect(async () => {
      const b = await boites();
      expect(b.rail.x + b.rail.width).toBeLessThanOrEqual(b.panneau.x);
      expect(b.panneau.x + b.panneau.width).toBeLessThanOrEqual(b.principal.x);
      expect(b.barre.y + b.barre.height).toBeLessThanOrEqual(b.rail.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }).toPass({ timeout: 10000 });
    // AC-028-14 : trois onglets et quatre boutons de 48 px, entiers, sans défilement du rail ; « Agent » et « Agents » entiers en haut du rail droit.
    const rail = await page.locator(".cadre-rail").boundingBox();
    const elements = page.locator(".cadre-rail [role=tab], .cadre-rail-commandes button");
    await expect(elements).toHaveCount(7);
    for (const e of await elements.all()) {
      const m = await e.boundingBox();
      expect([m.width, m.height]).toEqual([48, 48]);
      expect(m.x).toBeGreaterThanOrEqual(rail.x);
      expect(m.x + m.width).toBeLessThanOrEqual(rail.x + rail.width);
      expect(m.y).toBeGreaterThanOrEqual(rail.y);
      expect(m.y + m.height).toBeLessThanOrEqual(rail.y + rail.height);
      expect(m.y + m.height).toBeLessThanOrEqual(480);
    }
    for (const nom of ["Agent", "Agents"]) {
      const agent = await page.getByRole("button", { name: nom, exact: true }).boundingBox();
      expect([agent.width, agent.height]).toEqual([48, 48]);
      expect(agent.x).toBeGreaterThanOrEqual(0);
      expect(agent.x + agent.width).toBeLessThanOrEqual(800);
      expect(agent.y).toBeGreaterThanOrEqual(0);
      expect(agent.y + agent.height).toBeLessThanOrEqual(480);
    }
    await page.setViewportSize({ width: 600, height: 400 });
    await expect(async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(true);
    }).toPass({ timeout: 10000 });
  });
  await test.step("REQ028_AC9_un_nom_de_projet_long_ne_deborde_pas_de_la_barre_de_titre", async () => {
    await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible();
    await page.setViewportSize({ width: 800, height: 480 });
    await page.evaluate(() => {
      document.querySelector(".ya-command-nom").textContent = "tres-long-dossier-".repeat(20) + "projet";
    });
    await expect(async () => {
      const commande = await page.locator(".ya-command").boundingBox();
      const theme = await page.getByRole("button", { name: "Thème clair" }).boundingBox();
      const sortir = await page.getByRole("button", { name: "Déconnexion" }).boundingBox();
      expect(commande.x + commande.width).toBeLessThanOrEqual(theme.x);
      const rail = await page.locator(".cadre-rail").boundingBox();
      expect(commande.y).toBeGreaterThanOrEqual(0);
      expect(commande.y + commande.height).toBeLessThanOrEqual(rail.y);
      expect(sortir.x + sortir.width).toBeLessThanOrEqual(800);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }).toPass({ timeout: 10000 });
  });
});

