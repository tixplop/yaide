import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";
import { lancerFauxProvider, reponse } from "./faux-provider.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

const champMessage = (page) => page.getByRole("textbox", { name: "Message à l'agent" });

const api = (page, methode, chemin, corps) =>
  page.evaluate(
    async ([m, c, b]) => {
      const r = await fetch(c, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
      return r.json().catch(() => ({}));
    },
    [methode, chemin, corps],
  );

const lignes = (marque) => Array.from({ length: 20 }, (_, i) => `// ${marque} ligne ${i + 1}`).join("\n") + "\n";

test("REQ087_parcours_59_60_liens_fichiers", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "src", "args.rs"), lignes("args"));

  const faux = await lancerFauxProvider([
    reponse({ texte: "Voir `src/args.rs:18`, `src/parse.rs` et [la doc](https://exemple.org/a).", tokens: 500 }),
  ]);
  const yaide = await lancerYaide({ dossier });
  try {
    await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
    await api(page, "PUT", "/api/agent/providers/anthropic", { adresse: faux.adresse, cle: "sk-test" });
    await api(page, "PUT", "/api/agent/profils", { nom: "sonnet", provider: "anthropic", modele: "claude-sonnet-4-5", fenetre: 200000, defaut: true });
    await page.reload();

    // args.rs est déjà ouvert ; l'onglet Agent s'ouvre à côté.
    await page.getByRole("treeitem", { name: nomLigne("src") }).click();
    await page.getByRole("treeitem", { name: nomLigne("args.rs") }).click();
    const ongletArgs = page.getByRole("tab", { name: nomLigne("args.rs") });
    await expect(ongletArgs).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    const ongletAgent = page.getByRole("tab", { name: "Agent 1", exact: true });
    await expect(ongletAgent).toHaveAttribute("aria-selected", "true");
    await champMessage(page).fill("Où est le défaut ?");
    await page.keyboard.press("Enter");

    // P-059 étape 1 : la réponse et ses liens.
    const lien = page.getByRole("link", { name: "src/args.rs:18" });
    await expect(lien).toBeVisible({ timeout: 15000 });
    await expect(lien).toHaveAttribute("title", "Ouvrir src/args.rs à la ligne 18 dans l'éditeur.");
    await expect(page.getByRole("link", { name: "la doc" })).toHaveAttribute("target", "_blank");
    await champMessage(page).fill("brouillon gardé");
    await page.screenshot({ path: path.join(path.dirname(dossier), "V-007-etape1.png") });

    // Étape 2 : Tab jusqu'au lien, Entrée ; args.rs devient actif, ligne 18, focus dans l'éditeur.
    await page.getByText("Voir", { exact: false }).first().click({ position: { x: 2, y: 2 } });
    for (let i = 0; i < 5 && !(await lien.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(lien).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(ongletArgs).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: /^args\.rs/ })).toHaveCount(1);
    const editeur = page.getByLabel("Éditeur args.rs");
    await expect(editeur.locator(".cm-activeLine")).toHaveText("// args ligne 18");
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".cm-content") && document.activeElement.closest(".cm-editor") !== null)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.closest("[aria-label]")?.getAttribute("aria-label"))).toBe("Éditeur args.rs");

    // Retour sur « Agent 1 » : le brouillon est gardé.
    await ongletAgent.click();
    await expect(champMessage(page)).toHaveValue("brouillon gardé");

    // Étape 4 (fichier absent), Ctrl+clic et clic du milieu, P-060 (chemins absolus, worktree, hors projet) :
    // prouvés plus bas. AC-087-5 et AC-087-11 : editeur.test.js REQ087_AC5_AC11_chaque_refus_dit_son_texte_un_seul_message_focus_sur_le_lien ;
    // AC-087-4 : editeur.test.js REQ087_AC4_chemin_absolu_dans_un_worktree_ouvre_l_onglet_relatif_au_projet et tests/worktrees.rs
    // req086_ac4_ecriture_dans_le_worktree (lecture de ../essai/main.rs) et req006_ac3_chemins_hors_worktree_refuses ;
    // AC-087-10 (Ctrl, Maj, clic du milieu) : conversation.test.js REQ087_AC8_AC9_clic_et_modificateurs_ouvrent_sans_suivre_le_lien et REQ087_AC10_clic_du_milieu_et_lien_sans_ligne.
  } finally {
    await faux.arreter();
    await yaide.arreter();
  }
});
