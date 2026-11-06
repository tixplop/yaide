import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne } from "./aides.js";
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
const rail = (page, nom) => page.getByRole("navigation", { name: "Panneaux" }).getByRole("tab", { name: nom });

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

test("REQ055_parcours_20_reprendre_refus_arreter_erreur", async ({ page, browserName }) => {
  test.skip(browserName === "firefox", "Le parcours ne dépend pas du moteur : Chromium suffit.");
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

test("REQ053_parcours_21_gerer_ses_profils", async ({ page, browserName }) => {
  test.skip(browserName === "firefox", "Les dialogues sont les mêmes sur les deux moteurs : Chromium suffit.");
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
