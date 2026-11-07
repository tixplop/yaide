import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne, tailleStable, temoin, attendre } from "./aides.js";
import { lancerFauxProvider, reponse, erreur } from "./faux-provider.js";

let yaide;
let faux;
test.afterEach(async () => {
  await faux?.arreter();
  await yaide?.arreter();
  faux = yaide = undefined;
});

const ARGS_AVANT = 'pub fn parse_args(args: &[&str]) -> usize {\n    let mut i = 0;\n    while i < args.len() {\n        match args[i] {\n            "--sortie" => i += 2,\n            _ => i += 1,\n        }\n    }\n    i\n}\n';
const ARGS_APRES = ARGS_AVANT.replace('"--sortie" => i += 2,', '"--sortie" => i += 1,');
const MESSAGE = "Le test parse_args échoue. Trouve pourquoi et corrige-le.";

function depotAgent() {
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "src", "args.rs"), ARGS_AVANT);
  fs.writeFileSync(path.join(dossier, "AGENTS.md"), "regle-maison-42\n");
  const git = (...a) => spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...a], { cwd: dossier });
  git("add", "-A");
  git("commit", "-q", "-m", "args");
  return dossier;
}

const champMessage = (page) => page.getByRole("textbox", { name: "Message à l'agent" });
const profil = (page) => page.getByRole("combobox", { name: "Profil" });
const fil = (page) => page.getByRole("log", { name: "Conversation" });
const arreter = (page) => page.getByRole("button", { name: "Arrêter", exact: true });
const envoyer = (page) => page.getByRole("button", { name: "Envoyer", exact: true });
const rail = (page, nom) =>
  nom === "Agent" ? page.getByRole("button", { name: "Agent", exact: true }) : page.getByRole("navigation", { name: "Panneaux" }).getByRole("tab", { name: nom });

/** Appelle l'API de Yaide depuis la page, comme le fait l'interface (session déjà ouverte). */
const api = (page, methode, chemin, corps) =>
  page.evaluate(
    async ([m, c, b]) => {
      const r = await fetch(c, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
      return r.json().catch(() => ({}));
    },
    [methode, chemin, corps],
  );

async function reglerAnthropic(page) {
  await api(page, "PUT", "/api/agent/providers/anthropic", { adresse: faux.adresse, cle: "sk-test" });
  await api(page, "PUT", "/api/agent/profils", { nom: "sonnet", provider: "anthropic", modele: "claude-sonnet-4-5", fenetre: 200000, defaut: true });
}

async function ouvrirCommande(page, saisie, option) {
  await page.keyboard.press("Control+p");
  const champ = page.getByRole("textbox", { name: "Chemin du fichier" });
  await expect(champ).toBeFocused();
  await champ.fill(saisie);
  await expect(page.getByRole("dialog").getByRole("option")).toHaveText(option);
  await champ.press("Enter");
}

test("REQ056_parcours_19_regler_l_agent_et_corriger_un_fichier", async ({ page }) => {
  // Parcours P-019 : de « Aucun profil » à une correction relue dans l'éditeur.
  faux = await lancerFauxProvider([
    reponse({ texte: "Je lance le test pour voir l'erreur.", outils: [{ id: "t1", nom: "bash", entree: { command: "echo parse_args FAILED; exit 101" } }], tokens: 3000 }),
    reponse({ outils: [{ id: "t2", nom: "read", entree: { path: "src/args.rs" } }], tokens: 4000 }),
    reponse({ texte: "La branche `--sortie` avance de 2 au lieu de 1.", outils: [{ id: "t3", nom: "edit", entree: { path: "src/args.rs", old: '"--sortie" => i += 2,', new: '"--sortie" => i += 1,' } }], tokens: 6000 }),
    reponse({ texte: "Corrigé : `--sortie` avance maintenant de 1.", tokens: 14000 }),
  ]);
  const dossier = depotAgent();
  yaide = await lancerYaide({ dossier });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });

  // args.rs est ouvert, sans modification.
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("args.rs") }).click();
  const editeur = page.getByRole("textbox", { name: "Éditeur args.rs" });
  await expect(editeur).toContainText("i += 2");

  // 1. Aucun profil.
  await rail(page, "Agent").click();
  await expect(page.getByText("Aucun profil. Créez-en un avec Ctrl+P, puis > Profils de modèle.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Créer un profil" })).toBeVisible();
  await expect(profil(page)).toBeDisabled();
  await expect(profil(page)).toHaveText(/Aucun profil/);
  await expect(envoyer(page)).toBeDisabled();
  await expect(champMessage(page)).toBeFocused();

  // 2. Ctrl+P puis >pro.
  await page.keyboard.press("Control+p");
  const champ = page.getByRole("textbox", { name: "Chemin du fichier" });
  await champ.fill(">pro");
  await expect(page.getByRole("dialog").getByRole("option")).toHaveText([/Providers LLM/, /Profils de modèle/]);
  await champ.press("Enter");

  // 3. Les six providers ; la clé et l'adresse d'Anthropic (celle du faux provider).
  const provs = page.getByRole("dialog", { name: "Providers LLM" });
  const liste = provs.getByRole("listbox", { name: "Providers" });
  await expect(liste.getByRole("option")).toHaveCount(6);
  await expect(liste.getByRole("option", { name: /Aucune clé/ })).toHaveCount(6);
  await expect(liste.getByRole("option", { name: /^OpenAI/ })).toHaveAttribute("aria-selected", "true");
  await liste.getByRole("option", { name: /^OpenAI/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(provs.getByText("Aucune clé. Obligatoire pour Anthropic.")).toBeVisible();
  await provs.getByLabel("Adresse").fill(faux.adresse);
  await provs.getByLabel("Clé d'API").fill("sk-test");
  await provs.getByRole("button", { name: "Enregistrer" }).click();
  await expect(provs.getByText("Anthropic enregistré.")).toBeVisible();
  await expect(liste.getByRole("option", { name: /^Anthropic.*Clé enregistrée/ })).toBeVisible();
  await expect(provs.getByLabel("Clé d'API")).toHaveValue("");
  await expect(provs.getByText("Clé enregistrée. Saisissez-en une autre pour la remplacer.")).toBeVisible();

  // 4. Adresse d'Ollama invalide, puis Échap.
  await liste.getByRole("option", { name: /^Ollama/ }).click();
  const avant = (await api(page, "GET", "/api/agent/reglages")).providers.find((p) => p.id === "ollama").adresse;
  await provs.getByLabel("Adresse").fill("localhost:11434");
  await provs.getByRole("button", { name: "Enregistrer" }).click();
  await expect(provs.getByText("L'adresse doit commencer par http:// ou https://.")).toBeVisible();
  await expect(provs.getByLabel("Adresse")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(provs).toHaveCount(0);
  expect((await api(page, "GET", "/api/agent/reglages")).providers.find((p) => p.id === "ollama").adresse).toBe(avant);
  await expect(champMessage(page)).toBeFocused();

  // 5. Premier profil.
  await page.getByRole("button", { name: "Créer un profil" }).click();
  const profs = page.getByRole("dialog", { name: "Profils de modèle" });
  await expect(profs.getByRole("listbox", { name: "Profils" }).getByRole("option")).toHaveText(["Nouveau profil"]);
  const defaut = profs.getByLabel("Profil par défaut");
  await expect(defaut).toBeChecked();
  await expect(defaut).toBeDisabled();
  await expect(profs.getByLabel("Nom", { exact: true })).toBeFocused();
  await profs.getByLabel("Nom", { exact: true }).fill("sonnet");
  await profs.getByLabel("Provider", { exact: true }).selectOption({ label: "Anthropic" });
  await expect(profs.getByLabel("Sortie max. (tokens)")).toHaveAttribute("placeholder", "8192");
  await profs.getByLabel("Modèle", { exact: true }).fill("claude-sonnet-4-5");
  await profs.getByLabel("Fenêtre de contexte (tokens)").fill("200000");
  await profs.getByRole("button", { name: "Enregistrer" }).click();
  await expect(profs.getByText("Profil « sonnet » enregistré.")).toBeVisible();
  await profs.getByRole("button", { name: "Fermer" }).click();
  await expect(profs).toHaveCount(0);
  await expect(page.getByText("Écrivez un message pour commencer.")).toBeVisible();
  await expect(profil(page)).toHaveValue(/sonnet/);
  await expect(page.getByRole("img", { name: /^Contexte/ })).toHaveText("0 / 200 k");
  await expect(champMessage(page)).toBeFocused();

  // AC-029-4 : rien ne part vers le provider avant le premier message.
  expect(faux.recues).toHaveLength(0);

  // 6. Le tour de l'agent.
  await champMessage(page).fill(MESSAGE);
  await page.keyboard.press("Enter");
  await expect(fil(page)).toContainText(MESSAGE);
  await expect(champMessage(page)).toHaveValue("");
  const bash = page.getByRole("button", { name: /^bash echo parse_args FAILED; exit 101, échec$/ });
  await expect(bash).toBeVisible({ timeout: 15000 });
  await expect(fil(page)).toContainText("Je lance le test pour voir l'erreur.");
  await expect(page.getByRole("button", { name: /^read src\/args\.rs, réussi$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^edit src\/args\.rs, réussi$/ })).toBeVisible();

  // 7. Fin du tour.
  await expect(fil(page)).toContainText("Corrigé : --sortie avance maintenant de 1.", { timeout: 15000 });
  await expect(arreter(page)).toBeHidden();
  await expect(page.getByRole("img", { name: /^Contexte/ })).toHaveText("14 k / 200 k");
  await bash.click();
  await expect(fil(page)).toContainText("Exit code: 101");

  // AC-056-9 : l'éditeur montre ce que l'agent a écrit, sans question.
  expect(fs.readFileSync(path.join(dossier, "src", "args.rs"), "utf8")).toBe(ARGS_APRES);
  await rail(page, "Fichiers").click();
  await expect(editeur).toContainText("i += 1", { timeout: 8000 });
  await expect(editeur).not.toContainText("--sortie\" => i += 2");

  // Ce que le provider a reçu : la clé, AGENTS.md, les sept outils, le résultat de l'outil.
  const premiere = faux.recues[0];
  expect(premiere.chemin).toBe("/v1/messages");
  expect(premiere.entetes["x-api-key"]).toBe("sk-test");
  expect(JSON.stringify(premiere.corps)).toContain("regle-maison-42");
  expect(premiere.corps.tools.map((t) => t.name).sort()).toEqual(["bash", "edit", "glob", "read", "webfetch", "websearch", "write"]);
  expect(JSON.stringify(faux.recues[1].corps.messages)).toContain("Exit code: 101");
  expect(faux.recues).toHaveLength(4);
});

test("REQ055_parcours_20_reprendre_refus_arreter_erreur", async ({ page }) => {
  faux = await lancerFauxProvider([
    reponse({ texte: "Le test attend une avance de 1.", tokens: 1200 }),
    reponse({ outils: [{ id: "t1", nom: "bash", entree: { command: "sleep 30" } }], tokens: 1500 }),
    erreur(429, "rate_limit_error", "Trop de requêtes, patientez."),
  ]);
  yaide = await lancerYaide({ dossier: depotAgent() });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await reglerAnthropic(page);
  await api(page, "PUT", "/api/agent/profils", { nom: "gpt", provider: "openai", modele: "gpt-5", defaut: false });
  await page.reload();
  await rail(page, "Agent").click();
  await expect(profil(page)).toHaveValue(/sonnet/);

  // Une première conversation.
  await champMessage(page).fill(MESSAGE);
  await page.keyboard.press("Enter");
  await expect(fil(page)).toContainText("Le test attend une avance de 1.");
  await expect(arreter(page)).toBeHidden();

  // 1. Au rechargement, la vue rouvre la conversation.
  await page.reload();
  await rail(page, "Agent").click();
  await expect(fil(page)).toContainText("Le test attend une avance de 1.");
  await expect(page.locator(".agent-titre")).toContainText("Le test parse_args échoue.");

  // 2. Nouvelle conversation.
  await page.getByRole("button", { name: "Nouvelle conversation" }).click();
  await expect(page.locator(".agent-titre")).toHaveText("Nouvelle conversation");
  await expect(page.getByText("Écrivez un message pour commencer.")).toBeVisible();
  await expect(profil(page)).toHaveValue(/sonnet/);
  await expect(champMessage(page)).toBeFocused();

  // 3. Profil sans clé : refus, rien n'est envoyé, le texte reste.
  await profil(page).selectOption({ label: "gpt" });
  await champMessage(page).fill("Lance toute la suite de tests.");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM.")).toBeVisible();
  await expect(champMessage(page)).toHaveValue("Lance toute la suite de tests.");
  await expect(page.getByText("Écrivez un message pour commencer.")).toBeVisible();
  expect(faux.recues).toHaveLength(1);

  // 4. Bon profil : le refus disparaît, la commande tourne ; Arrêter.
  await profil(page).selectOption({ label: "sonnet" });
  await champMessage(page).press("Enter");
  await expect(page.getByText("Aucune clé pour OpenAI.")).toHaveCount(0);
  const bash = page.getByRole("button", { name: /^bash sleep 30, en cours$/ });
  await expect(bash).toBeVisible({ timeout: 15000 });
  await arreter(page).click();
  await expect(page.getByRole("button", { name: /^bash sleep 30, échec$/ })).toBeVisible();
  await expect(fil(page).getByText("Arrêté.")).toBeVisible();
  await expect(arreter(page)).toBeHidden();
  await expect(champMessage(page)).toBeFocused();

  // 5. Erreur du provider.
  await champMessage(page).fill("Relance seulement les tests du module args.");
  await page.keyboard.press("Enter");
  await expect(fil(page)).toContainText("Anthropic a refusé la requête (429).");
  await expect(fil(page)).toContainText("rate_limit_error");
  await expect(arreter(page)).toBeHidden();
  await champMessage(page).fill("Encore.");
  await expect(envoyer(page)).toBeEnabled();

  // 6. Le menu des conversations rouvre la première.
  await page.getByRole("button", { name: "Conversations" }).click();
  const items = page.getByRole("menuitem");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Lance toute la suite de tests.");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(fil(page)).toContainText("Le test attend une avance de 1.");
  await expect(fil(page)).not.toContainText("Arrêté.");
  await expect(profil(page)).toHaveValue(/sonnet/);
  await expect(champMessage(page)).toBeFocused();
});

test("REQ053_parcours_21_gerer_ses_profils", async ({ page }) => {
  yaide = await lancerYaide({ dossier: depotAgent() });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await api(page, "PUT", "/api/agent/providers/openrouter", { cle: "sk-or-test", adresse: "https://openrouter.ai/api/v1" });
  await api(page, "PUT", "/api/agent/profils", { nom: "sonnet", provider: "anthropic", modele: "claude-sonnet-4-5", fenetre: 200000, defaut: true });

  // 1. Ctrl+P, >prof, Entrée.
  await rail(page, "Fichiers").focus();
  await ouvrirCommande(page, ">prof", [/Profils de modèle/]);
  const dlg = page.getByRole("dialog", { name: "Profils de modèle" });
  const liste = dlg.getByRole("listbox", { name: "Profils" });
  const option = (nom) => liste.getByRole("option", { name: new RegExp(`^${nom}`) });
  await expect(option("sonnet")).toHaveAttribute("aria-selected", "true");
  await expect(option("sonnet")).toContainText("par défaut");
  await expect(option("sonnet")).toBeFocused();

  // 2. Température hors limites.
  await dlg.getByRole("button", { name: "Nouveau profil" }).click();
  await expect(option("Nouveau profil")).toHaveAttribute("aria-selected", "true");
  await expect(dlg.getByLabel("Nom", { exact: true })).toBeFocused();
  await dlg.getByLabel("Nom", { exact: true }).fill("rapide");
  await dlg.getByLabel("Provider", { exact: true }).selectOption({ label: "OpenRouter" });
  await dlg.getByLabel("Modèle", { exact: true }).fill("google/gemini-2.5-flash");
  await dlg.getByLabel("Effort").selectOption({ label: "Faible" });
  await dlg.getByLabel("Température").fill("3");
  await dlg.getByLabel("Fenêtre de contexte (tokens)").fill("1048576");
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dlg.getByText("Température : un nombre de 0 à 2, ou vide.")).toBeVisible();
  await expect(dlg.getByLabel("Température")).toBeFocused();
  expect((await api(page, "GET", "/api/agent/reglages")).profils.map((p) => p.nom)).toEqual(["sonnet"]);

  // 3. Corrigé, et par défaut.
  await dlg.getByLabel("Température").fill("0,7");
  await dlg.getByLabel("Profil par défaut").check();
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dlg.getByText("Profil « rapide » enregistré.")).toBeVisible();
  await expect(option("rapide")).toContainText("par défaut");
  await expect(option("sonnet")).not.toContainText("par défaut");
  await expect(dlg.getByLabel("Profil par défaut")).toBeChecked();
  await expect(dlg.getByLabel("Profil par défaut")).toBeDisabled();

  // 4. Confirmation de suppression.
  await dlg.getByRole("button", { name: "Supprimer", exact: true }).click();
  const conf = page.getByRole("dialog", { name: "Supprimer le profil « rapide » ?" });
  await expect(conf.getByText("Les conversations qui l'utilisent prendront le profil par défaut.")).toBeVisible();
  await expect(conf.getByRole("button", { name: "Annuler" })).toBeFocused();

  // 5. Supprimer : sonnet redevient le défaut.
  await conf.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(conf).toHaveCount(0);
  await expect(option("rapide")).toHaveCount(0);
  await expect(option("sonnet")).toContainText("par défaut");
  await expect(option("sonnet")).toHaveAttribute("aria-selected", "true");
  await expect(option("sonnet")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(rail(page, "Fichiers")).toBeFocused();
});

test("REQ059_parcours_23_garder_l_agent_a_cote_de_son_code", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  // Parcours P-023 : la colonne de l'agent à droite, sa largeur, le repli du panneau, le rechargement.
  const depart = temoin();
  const commande = attendre(depart, "echo suite-ok");
  const nomBouton = (etat) => new RegExp(`^bash ${commande.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, ${etat}$`);
  faux = await lancerFauxProvider([
    reponse({ outils: [{ id: "h1", nom: "bash", entree: { command: "echo hier" } }], tokens: 1000 }),
    reponse({ texte: "Hier, rien à signaler.", tokens: 1200 }),
    reponse({ outils: [{ id: "a1", nom: "bash", entree: { command: commande } }], tokens: 1500 }),
    reponse({ texte: "La suite est passée.", tokens: 1800 }),
  ]);
  yaide = await lancerYaide({ dossier: depotAgent() });
  await page.setViewportSize({ width: 1600, height: 900 });
  await ouvrirYaide(page, yaide.origine);
  await reglerAnthropic(page);
  await page.reload();
  await page.getByRole("tab", { name: /^shell \d+$/ }).first().waitFor();

  // La veille : une conversation, puis l'agent est replié et la page rechargée.
  await rail(page, "Agent").click();
  await expect(profil(page)).toHaveValue(/sonnet/);
  await expect(champMessage(page)).toBeFocused();
  await champMessage(page).fill(MESSAGE);
  await page.keyboard.press("Enter");
  await expect(fil(page)).toContainText("Hier, rien à signaler.", { timeout: 15000 });
  await expect(arreter(page)).toBeHidden();
  await page.getByRole("button", { name: "Replier l'agent" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((ok) => {
            const d = indexedDB.open("yaide", 1);
            d.onsuccess = () => {
              const r = d.result.transaction("cles").objectStore("cles").get("replis");
              r.onsuccess = () => ok(r.result?.agent);
            };
          }),
      ),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole("tab", { name: /^shell \d+$/ }).first().waitFor();
  await page.getByRole("treeitem", { name: nomLigne("src") }).click();
  await page.getByRole("treeitem", { name: nomLigne("args.rs") }).click();
  await expect(page.getByRole("textbox", { name: "Éditeur args.rs" })).toBeFocused();

  const colonne = page.locator("aside.cadre-agent");
  const boutonAgent = rail(page, "Agent");
  const largeur = async (sel) => Math.round((await page.locator(sel).boundingBox()).width);
  const taperTaille = async () => {
    await page.locator(".terminal:visible .xterm-helper-textarea").focus();
    await page.keyboard.type("stty size");
    await page.keyboard.press("Enter");
  };

  // 1. Agent replié : un rail droit avec « Agent », trois onglets à gauche.
  await expect(colonne).toBeHidden();
  await expect(boutonAgent).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Panneaux" }).getByRole("tab")).toHaveCount(3);
  const t0 = await tailleStable(page);

  // 2. Clic sur « Agent » : 360 px, conversation d'hier, focus dans le champ, le shell rétrécit (AC-059-9).
  await boutonAgent.click();
  await expect(colonne).toBeVisible();
  expect(await largeur("aside.cadre-agent")).toBe(360);
  await expect(boutonAgent).toHaveAttribute("data-actif", "");
  await expect(fil(page)).toContainText("Hier, rien à signaler.");
  await expect(champMessage(page)).toBeFocused();
  const t1 = await tailleStable(page);
  expect(t1).not.toBe(t0);
  expect(Number(t1.split(" ")[1])).toBeLessThan(Number(t0.split(" ")[1]));
  await taperTaille();
  await expect(page.locator(".terminal:visible .xterm-rows")).toContainText(t1);

  // 3. Glissé de la poignée jusqu'au bout : 720 px, l'éditeur garde au moins 320 px (AC-059-5).
  await page.getByRole("button", { name: /^bash echo hier, réussi$/ }).click();
  const poignee = await page.getByRole("separator", { name: "Largeur de l'agent" }).boundingBox();
  const x = poignee.x + poignee.width / 2;
  const y = poignee.y + poignee.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 400, y, { steps: 5 });
  await page.mouse.move(x - 1200, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => largeur("aside.cadre-agent")).toBe(720);
  expect(await largeur("main.cadre-principal")).toBeGreaterThanOrEqual(320);

  // 4. Un tour est lancé, puis « Replier l'agent » : la colonne disparaît, le tour continue.
  await champMessage(page).fill("Lance toute la suite de tests.");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: nomBouton("en cours") })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Replier l'agent" }).click();
  await expect(colonne).toBeHidden();
  await expect(page.getByRole("separator", { name: "Largeur de l'agent" })).toBeHidden();
  await expect(boutonAgent).toBeFocused();
  await expect(boutonAgent).not.toHaveAttribute("data-actif", "");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const t2 = await tailleStable(page);
  expect(t2).not.toBe(t1);
  expect(Number(t2.split(" ")[1])).toBeGreaterThan(Number(t1.split(" ")[1]));
  await taperTaille();
  await expect(page.locator(".terminal:visible .xterm-rows")).toContainText(t2);

  // 5. A : la colonne revient à 720 px, le tour est fini, le champ est vide et a le focus.
  await boutonAgent.focus();
  await page.keyboard.press("a");
  await expect(colonne).toBeVisible();
  expect(await largeur("aside.cadre-agent")).toBe(720);
  fs.writeFileSync(depart, "");
  await expect(fil(page)).toContainText("La suite est passée.", { timeout: 15000 });
  await expect(page.getByRole("button", { name: nomBouton("réussi") })).toBeVisible();
  await expect(champMessage(page)).toBeFocused();
  await expect(champMessage(page)).toHaveValue("");

  // 6. 800 × 480 : le panneau se replie, l'agent à 380 px, l'éditeur à 320 px, rien ne se superpose (AC-059-6, AC-059-7, AC-028-9).
  await page.setViewportSize({ width: 800, height: 480 });
  await expect(page.locator("aside.cadre-panneau")).toBeHidden();
  await expect(page.getByRole("button", { name: "Déplier le panneau" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Fichiers" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => largeur("aside.cadre-agent")).toBe(380);
  const boite = async (sel) => page.locator(sel).first().boundingBox();
  const rail1 = await boite(".cadre-rail");
  const principal = await boite("main.cadre-principal");
  const agent = await boite("aside.cadre-agent");
  const railDroit = await boite(".cadre-rail-droit");
  expect(Math.round(principal.width)).toBe(320);
  expect(rail1.x + rail1.width).toBeLessThanOrEqual(principal.x + 0.5);
  expect(principal.x + principal.width).toBeLessThanOrEqual(agent.x + 0.5);
  expect(agent.x + agent.width).toBeLessThanOrEqual(railDroit.x + 0.5);
  expect(railDroit.x + railDroit.width).toBeLessThanOrEqual(800);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 7. « Déplier le panneau » : le panneau revient à 280 px, l'agent se replie, le focus entre dans le panneau.
  await page.getByRole("button", { name: "Déplier le panneau" }).first().click();
  await expect(page.locator("aside.cadre-panneau")).toBeVisible();
  expect(await largeur("aside.cadre-panneau")).toBe(280);
  await expect(colonne).toBeHidden();
  expect(await page.evaluate(() => !!document.activeElement.closest("aside.cadre-panneau"))).toBe(true);
  await page.reload();
  await page.getByRole("tab", { name: /^shell \d+$/ }).first().waitFor();
  await expect(page.locator("aside.cadre-panneau")).toBeVisible();
  await expect(colonne).toBeHidden();
  await page.setViewportSize({ width: 1600, height: 900 });
  await boutonAgent.click();
  await expect(colonne).toBeVisible();
  await expect.poll(() => largeur("aside.cadre-agent")).toBe(720);
  await expect(page.locator("aside.cadre-panneau")).toBeVisible();
});

test("REQ028_AC20_AC21_la_page_ne_defile_jamais", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  const longue = (i) => Array.from({ length: 40 }, (_, j) => "Réponse " + (i + 1) + ", paragraphe " + (j + 1) + ".").join("\n\n");
  faux = await lancerFauxProvider(Array.from({ length: 3 }, (_, i) => reponse({ texte: longue(i), tokens: 100 + i })));
  yaide = await lancerYaide({ dossier: depotAgent() });
  await page.setViewportSize({ width: 1280, height: 720 });
  await ouvrirYaide(page, yaide.origine);
  await reglerAnthropic(page);
  await page.reload();
  await page.getByRole("tab", { name: /^shell \d+$/ }).first().waitFor();
  await rail(page, "Agent").click();
  await expect(profil(page)).toHaveValue(/sonnet/);
  for (let i = 1; i <= 3; i++) {
    await champMessage(page).fill(`Message ${i}`);
    await page.keyboard.press("Enter");
    await expect(fil(page)).toContainText(`Réponse ${i}, paragraphe 40.`, { timeout: 15000 });
    await expect(arreter(page)).toBeHidden();
  }

  const verifier = async (quand) => {
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))); // la mise en page est terminée
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      return { sh: d.scrollHeight, ih: innerHeight, sw: d.scrollWidth, iw: innerWidth, x: scrollX, y: scrollY };
    });
    expect(m.sh, `${quand} : hauteur`).toBeLessThanOrEqual(m.ih);
    expect(m.sw, `${quand} : largeur`).toBeLessThanOrEqual(m.iw);
    expect(m.x, `${quand} : scrollX`).toBe(0);
    expect(m.y, `${quand} : scrollY`).toBe(0);
  };
  const toutes = async (taille) => {
    await verifier(`${taille} : conversation`);
    await page.getByRole("treeitem", { name: nomLigne("src") }).click({ button: "right" });
    await expect(page.getByRole("menu", { name: "Actions sur src/" })).toBeVisible();
    await verifier(`${taille} : menu contextuel`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Nouveau shell" }).hover();
    await expect(page.getByRole("tooltip", { name: "Nouveau shell" })).toBeVisible();
    await verifier(`${taille} : info-bulle`);
    await page.mouse.move(0, 0);
    await ouvrirCommande(page, ">prof", [/Profils de modèle/]);
    await expect(page.getByRole("dialog", { name: "Profils de modèle" })).toBeVisible();
    await verifier(`${taille} : dialogue`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await toutes("1280x720");
  await page.setViewportSize({ width: 800, height: 480 });
  const deplier = page.getByRole("button", { name: "Déplier le panneau" }); // le cadre replie le panneau quand la fenêtre rétrécit
  await deplier.click();
  await toutes("800x480");
});

test("REQ067_parcours_28_29_deux_agents_relisent_puis_arret", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  // Parcours P-028 et P-029 : deux agents créés, une relecture à deux, un agent illisible, une couleur changée, un arrêt.
  let ouvrir5; // jamais tenue : la 5e requête reste en attente jusqu'à l'arrêt
  faux = await lancerFauxProvider([
    reponse({ outils: [{ id: "r1", nom: "read", entree: { path: "src/args.rs" } }], tokens: 2000 }),
    reponse({ texte: "Relu : la branche `--sortie` avance de 2.", tokens: 3000 }),
    reponse({ outils: [{ id: "b1", nom: "bash", entree: { command: "echo cargo-test-ok" } }], tokens: 6000 }),
    reponse({ texte: "Les tests passent.", tokens: 9000 }),
    { ...reponse({ texte: "inutile" }), retenir: new Promise((ok) => (ouvrir5 = ok)) },
  ]);
  const dossier = depotAgent();
  yaide = await lancerYaide({ dossier });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, yaide.origine);
  await api(page, "PUT", "/api/agent/providers/anthropic", { adresse: faux.adresse, cle: "sk-test" });
  await api(page, "PUT", "/api/agent/profils", { nom: "sonnet", provider: "anthropic", modele: "claude-sonnet-4-5", fenetre: 200000, defaut: true });
  await api(page, "PUT", "/api/agent/profils", { nom: "rapide", provider: "anthropic", modele: "claude-haiku-4-5", fenetre: 1048576 });
  await page.reload();
  await page.getByRole("tab", { name: /^shell \d+$/ }).first().waitFor();

  const agents = path.join(dossier, ".yaide", "agents");
  const colonne = page.locator("aside.cadre-agent");
  const boutonAgents = page.getByRole("button", { name: "Agents", exact: true });
  const boutonAgent = page.getByRole("button", { name: "Agent", exact: true });
  const fiche = colonne.getByRole("button", { name: "Enregistrer", exact: true });
  const couleur = (nom) => colonne.getByRole("radio", { name: nom }).check({ force: true });

  // P-028 1 : « Agents » ouvre la colonne sur « Aucun agent. ».
  await boutonAgents.click();
  await expect(colonne.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(boutonAgents).toHaveAttribute("data-actif", "");
  await expect(boutonAgent).not.toHaveAttribute("data-actif", "");
  await expect(colonne.getByText("Aucun agent.")).toBeVisible();
  await expect(page.locator(":focus")).toHaveText("Nouvel agent");
  // 2 : la fiche d'un nouvel agent.
  await page.keyboard.press("Enter");
  await expect(colonne.getByLabel("Nom", { exact: true })).toBeFocused();
  await expect(colonne.getByText("Enregistrez l'agent pour créer ses fichiers.")).toBeVisible();
  await expect(colonne.getByRole("button", { name: "PERSONA.md" })).toBeDisabled();
  // 3 : Relecteur, hibou, vert, sonnet.
  await colonne.getByLabel("Nom", { exact: true }).fill("Relecteur");
  await colonne.getByLabel("Avatar").fill("🦉");
  await couleur("Vert");
  await colonne.getByLabel("Profil").selectOption("sonnet");
  await fiche.click();
  await expect(colonne.getByText("Agent « Relecteur » créé.")).toBeVisible();
  await expect(fiche).toBeFocused();
  // AC-064-3 : le dossier de l'agent et ses trois fichiers sont sur le disque.
  for (const f of ["agent.json", "AGENTS.md", "PERSONA.md"]) expect(fs.existsSync(path.join(agents, "relecteur", f)), f).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(agents, "relecteur", "agent.json"), "utf8"))).toMatchObject({ nom: "Relecteur", avatar: "🦉", couleur: "vert" });

  // 4 : PERSONA.md s'ouvre dans l'éditeur, le focus dedans ; on tape le rôle et Ctrl+S (AC-066-1).
  await colonne.getByRole("button", { name: "PERSONA.md" }).click();
  const editeur = page.getByRole("textbox", { name: /^Éditeur PERSONA\.md/ });
  await expect(editeur).toBeFocused();
  await expect(colonne.getByLabel("Nom", { exact: true })).toHaveValue("Relecteur");
  await page.keyboard.type("Tu relis le code avec rigueur. persona-relecteur-71");
  await page.keyboard.press("Control+s");
  await expect.poll(() => fs.readFileSync(path.join(agents, "relecteur", "PERSONA.md"), "utf8")).toContain("persona-relecteur-71");

  // 5 : un nom déjà pris et un avatar trop long ; rien n'est écrit.
  await colonne.getByRole("button", { name: "Retour aux agents" }).click();
  await colonne.getByRole("button", { name: "Nouvel agent" }).click();
  await colonne.getByLabel("Nom", { exact: true }).fill("relecteur");
  await colonne.getByLabel("Avatar").fill("QA!");
  await couleur("Orange");
  await colonne.getByLabel("Profil").selectOption("rapide");
  await colonne.getByLabel("Avatar").press("Enter");
  await expect(colonne.getByText("Ce nom est déjà pris. Choisissez-en un autre.")).toBeVisible();
  await expect(colonne.getByText("Avatar : deux caractères au plus.")).toBeVisible();
  await expect(colonne.getByLabel("Nom", { exact: true })).toBeFocused();
  expect(fs.readdirSync(agents)).toEqual(["relecteur"]);
  // 6 : Testeur, sans avatar.
  await colonne.getByLabel("Nom", { exact: true }).fill("Testeur");
  await colonne.getByLabel("Avatar").fill("");
  await fiche.click();
  await expect(colonne.getByText("Agent « Testeur » créé.")).toBeVisible();
  await colonne.getByRole("button", { name: "Retour aux agents" }).click();
  await expect(colonne.getByText("2 agents", { exact: true })).toBeVisible();
  await expect(colonne.getByRole("button", { name: "Modifier Testeur" })).toBeFocused();
  await expect(colonne.getByRole("checkbox")).toHaveCount(2);
  await colonne.getByRole("checkbox", { name: "Relecteur" }).check();
  await colonne.getByRole("checkbox", { name: "Testeur" }).check();
  await expect(colonne.getByText("2 agents cochés.")).toBeVisible();
  // 7 : « Démarrer une conversation » ouvre V-007 sur les deux agents.
  await colonne.getByRole("button", { name: "Démarrer une conversation" }).click();
  await expect(colonne.getByRole("heading", { name: "Agent", exact: true })).toBeVisible();
  await expect(boutonAgent).toHaveAttribute("data-actif", "");
  await expect(boutonAgents).not.toHaveAttribute("data-actif", "");
  const equipe = colonne.getByRole("list", { name: "Agents de la conversation" }).getByRole("listitem");
  await expect(equipe).toHaveText([/Relecteur$/, /Testeur$/]);
  await expect(profil(page)).toHaveCount(0);
  await expect(colonne.getByLabel("Contexte : 0 tokens sur 200 k")).toBeVisible();
  await expect(champMessage(page)).toBeFocused();
  // 8 : la relecture. Relecteur (sonnet) lit args.rs, Testeur (rapide) lance les tests.
  await champMessage(page).fill("Relis src/args.rs, puis lance les tests.");
  await page.keyboard.press("Enter");
  await expect(fil(page).getByRole("group", { name: "Testeur" })).toContainText("Les tests passent.", { timeout: 15000 });
  await expect(arreter(page)).toBeHidden();
  await expect(fil(page).getByRole("group")).toHaveCount(2);
  await expect(fil(page).getByRole("group", { name: "Relecteur" })).toContainText("Relu : la branche");
  await expect(fil(page).getByRole("group", { name: "Relecteur" }).getByRole("button", { name: /^read src\/args\.rs/ })).toBeVisible();
  await expect(fil(page).getByRole("group", { name: "Testeur" }).getByRole("button", { name: /^bash echo cargo-test-ok/ })).toBeVisible();
  await expect(fil(page).getByRole("group", { name: "Relecteur" }).locator(".ya-tour-corps")).toHaveAttribute("style", /--agent-vert/);
  await expect(fil(page).getByRole("group", { name: "Testeur" }).locator(".ya-tour-corps")).toHaveAttribute("style", /--agent-orange/);
  await expect(colonne.getByLabel("Contexte : 9 k tokens sur 1 M")).toBeVisible();
  // Les modèles distinguent les agents ; le persona n'est que dans les requêtes de Relecteur (AC-066-3).
  expect(faux.recues.map((r) => r.corps.model)).toEqual(["claude-sonnet-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-haiku-4-5"]);
  expect(JSON.stringify(faux.recues[0].corps)).toContain("persona-relecteur-71");
  expect(JSON.stringify(faux.recues[0].corps)).toContain("regle-maison-42");
  expect(JSON.stringify(faux.recues[2].corps)).not.toContain("persona-relecteur-71");

  // P-029 : « revue » est cassé à la main.
  fs.mkdirSync(path.join(agents, "revue"));
  fs.writeFileSync(path.join(agents, "revue", "agent.json"), '{ "nom": "Revue" "couleur": "gris" }');
  await boutonAgents.click();
  await expect(colonne.getByText(".yaide/agents/revue/agent.json est illisible. Corrigez-le, puis rouvrez Agents.")).toBeVisible();
  await expect(colonne.getByRole("checkbox")).toHaveCount(2);
  await expect(colonne.getByRole("checkbox", { name: "Relecteur" })).toBeFocused();
  await expect(colonne.getByRole("checkbox", { name: "Relecteur" })).not.toBeChecked();
  await expect(colonne.getByRole("checkbox", { name: "Testeur" })).not.toBeChecked();
  await expect(colonne.getByRole("button", { name: "Démarrer une conversation" })).toBeDisabled();
  await expect(colonne.getByText("Cochez un ou plusieurs agents.")).toBeVisible();
  // 2 : la couleur de Relecteur passe au rose.
  await colonne.getByRole("button", { name: "Modifier Relecteur" }).click();
  await expect(colonne.getByLabel("Nom", { exact: true })).toBeFocused();
  await couleur("Rose");
  await fiche.click();
  await expect(colonne.getByText("Agent « Relecteur » enregistré.")).toBeVisible();
  expect(JSON.parse(fs.readFileSync(path.join(agents, "relecteur", "agent.json"), "utf8")).couleur).toBe("rose");
  // 3 : la conversation de P-028 revient, Relecteur y est toujours vert (AC-067-11).
  await boutonAgent.click();
  await expect(equipe).toHaveText([/Relecteur$/, /Testeur$/]);
  await expect(equipe.first().locator(".ya-avatar")).toHaveAttribute("style", /--agent-vert/);
  await expect(fil(page).getByRole("group", { name: "Relecteur" }).locator(".ya-tour-corps")).toHaveAttribute("style", /--agent-vert/);
  // 4 : « Arrêter » pendant Relecteur ; Testeur ne répond pas (AC-067-7).
  await champMessage(page).fill("Ajoute un test pour --sortie sans valeur.");
  await page.keyboard.press("Enter");
  await expect(fil(page).getByText("Relecteur travaille…")).toBeVisible();
  await arreter(page).click();
  await expect(fil(page).getByRole("group", { name: "Relecteur" }).last()).toContainText("Arrêté.");
  await expect(arreter(page)).toBeHidden();
  await expect(champMessage(page)).toBeFocused();
  expect(faux.recues).toHaveLength(5);
  await expect(fil(page).getByRole("group", { name: "Testeur" })).toHaveCount(1);
  ouvrir5();

  // AC-064-18 : trente agents, dont un nom de 60 caractères.
  const long = "Relecteur-au-nom-vraiment-trop-long-pour-la-colonne-".padEnd(60, "x");
  expect(long).toHaveLength(60);
  for (let i = 1; i <= 29; i++) {
    const d = path.join(agents, `agent-${String(i).padStart(2, "0")}`);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "agent.json"), JSON.stringify({ nom: `Agent ${String(i).padStart(2, "0")}`, avatar: "", couleur: "gris" }));
  }
  fs.mkdirSync(path.join(agents, "agent-long"));
  fs.writeFileSync(path.join(agents, "agent-long", "agent.json"), JSON.stringify({ nom: long, avatar: "", couleur: "gris" }));
  await page.setViewportSize({ width: 1600, height: 900 }); // assez large pour que la colonne atteigne 720 px
  await boutonAgents.click();
  await expect(colonne.getByRole("checkbox")).toHaveCount(32);
  const poignee = page.getByRole("separator", { name: "Largeur de l'agent" });
  const glisser = async (dx) => {
    const b = await poignee.boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 5 });
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
  };
  const largeur = () => colonne.evaluate((e) => e.offsetWidth);
  for (const [dx, attendu] of [[1200, 240], [-1200, 720]]) {
    await glisser(dx);
    await expect.poll(largeur).toBe(attendu);
    const m = await colonne.evaluate((e) => {
      const liste = e.querySelector(".agents-liste");
      const nom = [...e.querySelectorAll(".ya-check-row .nom")].find((n) => n.title.startsWith("Relecteur-au-nom"));
      return {
        defileLargeur: [e, e.querySelector(".agents-corps"), liste].some((n) => n.scrollWidth > n.clientWidth),
        listeDefile: liste.scrollHeight > liste.clientHeight,
        colonneDefile: e.scrollHeight > e.clientHeight,
        page: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        nomCoupe: nom.scrollWidth > nom.clientWidth,
        titre: nom.title,
      };
    });
    expect(m.defileLargeur, `${attendu} px : défilement en largeur`).toBe(false);
    expect(m.listeDefile, `${attendu} px : la liste défile`).toBe(true);
    expect(m.colonneDefile, `${attendu} px : la colonne ne défile pas`).toBe(false);
    expect(m.page, `${attendu} px : la page`).toBe(false);
    expect(m.titre).toBe(long);
    if (attendu === 240) expect(m.nomCoupe, "nom coupé à 240 px").toBe(true);
    const demarrer = await colonne.getByRole("button", { name: "Démarrer une conversation" }).boundingBox();
    const boite = await colonne.boundingBox();
    expect(demarrer.y).toBeGreaterThanOrEqual(boite.y);
    expect(demarrer.y + demarrer.height).toBeLessThanOrEqual(boite.y + boite.height);
    expect(demarrer.x + demarrer.width).toBeLessThanOrEqual(boite.x + boite.width);
  }
});
