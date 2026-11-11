import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { lancerYaide, ouvrirYaide, depotExemple, nomLigne, tailleStable, temoin, attendre, avancer } from "./aides.js";
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

const ongletAgent = (page, n) => page.getByRole("tab", { name: `Agent ${n}`, exact: true });

/** La conversation se relit toutes les 500 ms (horloge de la page installée avant l'ouverture) : on fait avancer l'horloge par pas de 500 ms jusqu'à ce que `attente` réussisse. */
const patienter = (page, attente) => avancer(page, attente, { pas: 500 });

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
  await expect(ongletAgent(page, 1)).toHaveAttribute("aria-selected", "true");

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
  await page.getByRole("tab", { name: nomLigne("args.rs") }).click();
  await expect(editeur).toContainText("i += 1", { timeout: 8000 });
  await expect(editeur).not.toContainText("--sortie\" => i += 2");

  // Ce que le provider a reçu : la clé, AGENTS.md, les sept outils, le résultat de l'outil.
  const premiere = faux.recues[0];
  expect(premiere.chemin).toBe("/v1/messages");
  expect(premiere.entetes["x-api-key"]).toBe("sk-test");
  expect(JSON.stringify(premiere.corps)).toContain("regle-maison-42");
  expect(premiere.corps.tools.map((t) => t.name).sort()).toEqual(["bash", "edit", "glob", "list_agents", "read", "save_agent", "webfetch", "websearch", "write"]);
  expect(JSON.stringify(faux.recues[1].corps.messages)).toContain("Exit code: 101");
  expect(faux.recues).toHaveLength(4);
});

test("REQ055_parcours_20_reprendre_refus_arreter_erreur", async ({ page }) => {
  faux = await lancerFauxProvider([
    reponse({ texte: "Le test attend une avance de 1.", tokens: 1200 }),
    reponse({ outils: [{ id: "t1", nom: "bash", entree: { command: "sleep 30" } }], tokens: 1500 }),
    erreur(429, "rate_limit_error", "Trop de requêtes, patientez."),
  ]);
  await page.clock.install();
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
  await patienter(page, () => expect(fil(page)).toContainText("Le test attend une avance de 1.", { timeout: 300 }));
  await patienter(page, () => expect(arreter(page)).toBeHidden({ timeout: 300 }));

  // 1. Au rechargement, la vue rouvre la conversation.
  await page.reload();
  await ongletAgent(page, 1).click();
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
  await patienter(page, () => expect(bash).toBeVisible({ timeout: 300 }));
  await arreter(page).click();
  await expect(page.getByRole("button", { name: /^bash sleep 30, échec$/ })).toBeVisible();
  await expect(fil(page).getByText("Arrêté.")).toBeVisible();
  await expect(arreter(page)).toBeHidden();
  await expect(champMessage(page)).toBeFocused();

  // 5. Erreur du provider.
  await champMessage(page).fill("Relance seulement les tests du module args.");
  await page.keyboard.press("Enter");
  await patienter(page, () => expect(fil(page)).toContainText("Anthropic a refusé la requête (429).", { timeout: 300 }));
  await expect(fil(page)).toContainText("rate_limit_error");
  await patienter(page, () => expect(arreter(page)).toBeHidden({ timeout: 300 }));
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
  await page.clock.install();
  yaide = await lancerYaide({ dossier: depotAgent() });
  await page.setViewportSize({ width: 1600, height: 900 });
  await ouvrirYaide(page, yaide.origine);
  await reglerAnthropic(page);
  await page.reload();
  await page.getByRole("tab", { name: /^shell \d+$/ }).first().waitFor();

  // La veille : une conversation dans un onglet, puis la colonne est repliée et la page rechargée.
  await rail(page, "Agent").click();
  await expect(profil(page)).toHaveValue(/sonnet/);
  await expect(champMessage(page)).toBeFocused();
  await champMessage(page).fill(MESSAGE);
  await page.keyboard.press("Enter");
  await patienter(page, () => expect(fil(page)).toContainText("Hier, rien à signaler.", { timeout: 300 }));
  await expect(arreter(page)).toBeHidden();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
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
  const boutonAgent = page.getByRole("button", { name: "Agents", exact: true });
  const largeur = async (sel) => Math.round((await page.locator(sel).boundingBox()).width);
  const taperTaille = async () => {
    await page.locator(".terminal:visible .xterm-helper-textarea").focus();
    await page.keyboard.type("stty size");
    await page.keyboard.press("Enter");
  };

  // 1. Colonne repliée : un rail droit avec « Agents », trois onglets à gauche.
  await expect(colonne).toBeHidden();
  await expect(boutonAgent).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Panneaux" }).getByRole("tab")).toHaveCount(3);
  const t0 = await tailleStable(page);

  // 2. Clic sur « Agents » : 360 px, la colonne ne montre que la vue Agents, le shell rétrécit (AC-059-9).
  await boutonAgent.click();
  await expect(colonne).toBeVisible();
  expect(await largeur("aside.cadre-agent")).toBe(360);
  await expect(boutonAgent).toHaveAttribute("data-actif", "");
  await expect(colonne.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(colonne.getByRole("log", { name: "Conversation" })).toHaveCount(0);
  const t1 = await tailleStable(page);
  expect(t1).not.toBe(t0);
  expect(Number(t1.split(" ")[1])).toBeLessThan(Number(t0.split(" ")[1]));
  await taperTaille();
  await expect(page.locator(".terminal:visible .xterm-rows")).toContainText(t1);

  // 3. Glissé de la poignée jusqu'au bout : 720 px, l'éditeur garde au moins 320 px (AC-059-5).
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

  // 4. Un tour est lancé dans l'onglet, puis « Replier l'agent » : la colonne disparaît, le tour continue.
  await ongletAgent(page, 1).click();
  await expect(fil(page)).toContainText("Hier, rien à signaler.");
  await page.getByRole("button", { name: /^bash echo hier, réussi$/ }).click();
  await champMessage(page).fill("Lance toute la suite de tests.");
  await page.keyboard.press("Enter");
  await patienter(page, () => expect(page.getByRole("button", { name: nomBouton("en cours") })).toBeVisible({ timeout: 300 }));
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

  // 5. A : une seconde conversation s'ouvre, la colonne reste repliée ; au retour sur « Agent 1 », le tour est fini.
  await boutonAgent.focus();
  await page.keyboard.press("a");
  await expect(ongletAgent(page, 2)).toHaveAttribute("aria-selected", "true");
  await expect(colonne).toBeHidden();
  fs.writeFileSync(depart, "");
  await ongletAgent(page, 1).click();
  await patienter(page, () => expect(fil(page)).toContainText("La suite est passée.", { timeout: 300 }));
  await expect(page.getByRole("button", { name: nomBouton("réussi") })).toBeVisible();
  await expect(champMessage(page)).toBeFocused();
  await expect(champMessage(page)).toHaveValue("");
  await boutonAgent.click();
  await expect(colonne).toBeVisible();
  expect(await largeur("aside.cadre-agent")).toBe(720);

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

test("REQ028_AC20_AC21_seul_le_fil_defile_la_page_ne_defile_jamais", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  const longue = (i) => Array.from({ length: 40 }, (_, j) => "Réponse " + (i + 1) + ", paragraphe " + (j + 1) + ".").join("\n\n");
  faux = await lancerFauxProvider(Array.from({ length: 3 }, (_, i) => reponse({ texte: longue(i), tokens: 100 + i })));
  await page.clock.install();
  yaide = await lancerYaide({ dossier: depotAgent() });
  await page.setViewportSize({ width: 1280, height: 720 });
  await ouvrirYaide(page, yaide.origine);
  await reglerAnthropic(page);
  await page.reload();
  await page.getByRole("tab", { name: /^shell \d+$/ }).first().waitFor();
  await rail(page, "Agent").click();
  await page.getByRole("button", { name: "Agents", exact: true }).click(); // AC-028-21 : la colonne de droite est dépliée
  await expect(page.locator("aside.cadre-agent")).toBeVisible();
  await expect(profil(page)).toHaveValue(/sonnet/);
  for (let i = 1; i <= 3; i++) {
    await champMessage(page).fill(`Message ${i}`);
    await expect(envoyer(page)).toBeEnabled(); // Entrée n'envoie rien tant que le bouton est inactif
    await page.keyboard.press("Enter");
    await patienter(page, () => expect(fil(page)).toContainText(`Réponse ${i}, paragraphe 40.`, { timeout: 300 }));
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
  // AC-028-21 : seul le fil défile ; l'en-tête et la zone de saisie restent entiers dans la fenêtre.
  const seulLeFil = async (quand) => {
    const m = await page.evaluate(() => {
      const f = document.querySelector(".cadre-code .agent-fil");
      const c = f.closest(".agent-corps");
      const saisie = c.querySelector(".agent-saisie").getBoundingClientRect();
      return { fil: f.scrollHeight > f.clientHeight, corps: c.scrollHeight > c.clientHeight, bas: saisie.bottom <= innerHeight };
    });
    expect(m, `${quand} : seul le fil défile`).toEqual({ fil: true, corps: false, bas: true });
  };
  const toutes = async (taille) => {
    await verifier(`${taille} : conversation`);
    await seulLeFil(taille);
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
  await page.clock.install();
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
  await expect(ongletAgent(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(boutonAgents).toHaveAttribute("data-actif", "");
  await expect(boutonAgent).not.toHaveAttribute("data-actif", "");
  await expect(colonne.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  const equipe = page.getByRole("list", { name: "Agents de la conversation" }).getByRole("listitem");
  await expect(equipe).toHaveText([/Relecteur$/, /Testeur$/]);
  await expect(profil(page)).toHaveCount(0);
  await expect(page.getByLabel("Contexte : 0 tokens sur 200 k")).toBeVisible();
  await expect(champMessage(page)).toBeFocused();
  // 8 : la relecture. Relecteur (sonnet) lit args.rs, Testeur (rapide) lance les tests.
  await champMessage(page).fill("Relis src/args.rs, puis lance les tests.");
  await page.keyboard.press("Enter");
  await patienter(page, () => expect(fil(page).getByRole("group", { name: "Testeur" })).toContainText("Les tests passent.", { timeout: 300 }));
  await expect(arreter(page)).toBeHidden();
  await expect(fil(page).getByRole("group")).toHaveCount(2);
  await expect(fil(page).getByRole("group", { name: "Relecteur" })).toContainText("Relu : la branche");
  await expect(fil(page).getByRole("group", { name: "Relecteur" }).getByRole("button", { name: /^read src\/args\.rs/ })).toBeVisible();
  await expect(fil(page).getByRole("group", { name: "Testeur" }).getByRole("button", { name: /^bash echo cargo-test-ok/ })).toBeVisible();
  await expect(fil(page).getByRole("group", { name: "Relecteur" }).locator(".ya-tour-corps")).toHaveAttribute("style", /--agent-vert/);
  await expect(fil(page).getByRole("group", { name: "Testeur" }).locator(".ya-tour-corps")).toHaveAttribute("style", /--agent-orange/);
  await expect(page.getByLabel("Contexte : 9 k tokens sur 1 M")).toBeVisible();
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
  // 3 : la conversation de P-028 revient dans son onglet, Relecteur y est toujours vert (AC-067-11).
  await ongletAgent(page, 1).click();
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

async function agentPret(page, etapes = []) {
  faux = await lancerFauxProvider(etapes);
  await page.clock.install();
  yaide = await lancerYaide({ dossier: depotAgent() });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await reglerAnthropic(page);
  await page.reload();
}
/** Tire la poignée de la colonne jusqu'au bout : l'éditeur garde 320 px. */
async function elargirColonne(page) {
  const b = await page.getByRole("separator", { name: "Largeur de l'agent" }).boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 200, y, { steps: 5 });
  await page.mouse.up();
}
const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("REQ078_parcours_45_deux_onglets_tours_simultanes_rechargement", async ({ page }) => {
  // AC-078-1, AC-078-3, AC-078-4, AC-078-6 : deux conversations dans deux onglets, deux tours en même temps, puis le rechargement.
  const t1 = temoin();
  const t2 = temoin();
  const cmd1 = attendre(t1, "echo un");
  const cmd2 = attendre(t2, "echo deux");
  const bouton = (cmd, etat) => page.getByRole("button", { name: new RegExp(`^bash ${echapper(cmd)}, ${etat}$`) });
  await agentPret(page, [
    reponse({ outils: [{ id: "a", nom: "bash", entree: { command: cmd1 } }], tokens: 100 }),
    reponse({ texte: "Réponse deux.", tokens: 200 }),
    reponse({ texte: "Réponse un.", tokens: 300 }),
    reponse({ outils: [{ id: "b", nom: "bash", entree: { command: cmd2 } }], tokens: 400 }),
    reponse({ texte: "Fin deux.", tokens: 500 }),
  ]);

  // AC-078-1 : chaque clic ouvre un onglet, même si le précédent est vide ; le focus est dans le champ.
  await rail(page, "Agent").click();
  await expect(ongletAgent(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(champMessage(page)).toBeFocused();
  await expect(profil(page)).toHaveValue(/sonnet/);
  await rail(page, "Agent").click();
  await expect(ongletAgent(page, 2)).toHaveAttribute("aria-selected", "true");
  await expect(champMessage(page)).toBeFocused();
  await expect(page.getByRole("tab", { name: /^Agent \d$/ })).toHaveCount(2);

  // AC-078-3 : un tour tourne dans « Agent 1 », on passe à « Agent 2 ».
  await ongletAgent(page, 1).click();
  await champMessage(page).fill("Premier");
  await page.keyboard.press("Enter");
  await patienter(page, () => expect(bouton(cmd1, "en cours")).toBeVisible({ timeout: 300 }));
  await champMessage(page).fill("à suivre");
  await ongletAgent(page, 2).click();
  await expect(page.getByText("Écrivez un message pour commencer.")).toBeVisible();

  // AC-078-4 : un message dans « Agent 2 » pendant que le tour d'« Agent 1 » tourne ; chaque onglet n'affiche que les siens.
  await champMessage(page).fill("Second");
  await page.keyboard.press("Enter");
  await patienter(page, () => expect(fil(page)).toContainText("Réponse deux.", { timeout: 300 }));
  await expect(fil(page)).not.toContainText("Premier");
  await ongletAgent(page, 1).click();
  await expect(bouton(cmd1, "en cours")).toBeVisible();
  await expect(champMessage(page)).toHaveValue("à suivre");
  await expect(fil(page)).not.toContainText("Réponse deux.");
  fs.writeFileSync(t1, "");
  await patienter(page, () => expect(fil(page)).toContainText("Réponse un.", { timeout: 300 }));
  await expect(fil(page)).not.toContainText("Second");
  await expect(arreter(page)).toBeHidden();

  // Un second tour dans « Agent 2 », laissé en cours pendant le rechargement.
  await ongletAgent(page, 2).click();
  await champMessage(page).fill("Encore");
  await page.keyboard.press("Enter");
  await patienter(page, () => expect(bouton(cmd2, "en cours")).toBeVisible({ timeout: 300 }));

  // AC-078-6 : les deux onglets reviennent, chacun avec sa conversation ; le tour en cours reprend en direct.
  await page.reload();
  await expect(page.getByRole("tab", { name: /^Agent \d$/ })).toHaveCount(2);
  await ongletAgent(page, 1).click();
  await expect(fil(page)).toContainText("Réponse un.");
  await expect(fil(page)).not.toContainText("Réponse deux.");
  await ongletAgent(page, 2).click();
  await expect(fil(page)).toContainText("Réponse deux.");
  await expect(champMessage(page)).toHaveValue("");
  await patienter(page, () => expect(bouton(cmd2, "en cours")).toBeVisible({ timeout: 300 }));
  fs.writeFileSync(t2, "");
  await patienter(page, () => expect(fil(page)).toContainText("Fin deux.", { timeout: 300 }));
  expect(faux.recues).toHaveLength(5);
});

test("REQ078_parcours_46_deja_ouverte_coupure_suppr", async ({ page }) => {
  // AC-078-5, AC-078-7, AC-078-16.
  let liberer;
  await agentPret(page, [{ ...reponse({ texte: "Alpha.", tokens: 100 }), retenir: new Promise((ok) => (liberer = ok)) }]);
  await rail(page, "Agent").click();
  await expect(profil(page)).toBeEnabled(); // les réglages sont chargés : le message part avec un profil
  await champMessage(page).fill("m1");
  await page.keyboard.press("Enter");
  await expect(arreter(page)).toBeVisible();

  // AC-078-5 : « Agent 2 » choisit la conversation déjà ouverte dans « Agent 1 » : « Agent 1 » devient actif.
  await rail(page, "Agent").click();
  await expect(ongletAgent(page, 2)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Conversations" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(ongletAgent(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(champMessage(page)).toBeFocused();
  await expect(page.getByRole("tab", { name: /^Agent \d$/ })).toHaveCount(2);
  await ongletAgent(page, 2).click();
  await expect(page.getByText("Écrivez un message pour commencer.")).toBeVisible();

  // AC-078-16 : connexion coupée, « Agent » n'ouvre rien.
  await page.route("**/api/agent/reglages", (r) => r.abort());
  await rail(page, "Agent").click();
  await expect(page.getByRole("alert").filter({ hasText: "Connexion perdue. Réessayez au retour." })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Agent \d$/ })).toHaveCount(2);
  await page.unroute("**/api/agent/reglages");

  // AC-078-7 : Suppr sur « Agent 1 » pendant son tour, sans question ; le tour continue sur le serveur.
  let dialogue = false;
  page.on("dialog", () => (dialogue = true));
  await ongletAgent(page, 1).focus();
  await page.keyboard.press("Delete");
  await expect(ongletAgent(page, 1)).toHaveCount(0);
  expect(dialogue).toBe(false);
  liberer();
  await expect(ongletAgent(page, 2)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Conversations" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await expect(page.getByRole("menuitem")).toContainText("m1");
  await page.keyboard.press("Enter");
  await patienter(page, () => expect(fil(page)).toContainText("Alpha.", { timeout: 300 }));
  await expect(page.getByRole("tab", { name: /^Agent \d$/ })).toHaveCount(1);
});

test("REQ067_parcours_28_demarrer_ouvre_un_onglet", async ({ page }) => {
  // AC-067-1, AC-067-15 : « Démarrer une conversation » ouvre un onglet par clic, les cases restent cochées.
  yaide = await lancerYaide({ dossier: depotAgent() });
  for (const nom of ["Relecteur", "Testeur"]) {
    const d = path.join(yaide.dossier, ".yaide", "agents", nom.toLowerCase());
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "agent.json"), JSON.stringify({ nom, avatar: "", couleur: nom === "Testeur" ? "orange" : "vert" }));
  }
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await api(page, "PUT", "/api/agent/providers/anthropic", { adresse: "http://127.0.0.1:9", cle: "sk-test" });
  await api(page, "PUT", "/api/agent/profils", { nom: "sonnet", provider: "anthropic", modele: "claude-sonnet-4-5", fenetre: 200000, defaut: true });
  const colonne = page.locator("aside.cadre-agent");
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await colonne.getByRole("checkbox", { name: "Relecteur" }).check();
  await colonne.getByRole("checkbox", { name: "Testeur" }).check();
  await colonne.getByRole("button", { name: "Démarrer une conversation" }).click();
  await expect(ongletAgent(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("list", { name: "Agents de la conversation" }).getByRole("listitem")).toHaveText([/Relecteur$/, /Testeur$/]);
  await expect(champMessage(page)).toBeFocused();
  // AC-067-15 : « Agents » garde son filet, pas « Agent » ; pas de « Profil » ; Tab va du champ à « Envoyer ».
  await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("data-actif", "");
  await expect(rail(page, "Agent")).not.toHaveAttribute("data-actif", "");
  await expect(profil(page)).toHaveCount(0);
  await champMessage(page).fill("x");
  await page.keyboard.press("Tab");
  await expect(envoyer(page)).toBeFocused();
  // Les cases sont gardées ; un second clic ouvre une seconde conversation.
  await expect(colonne.getByRole("checkbox", { name: "Relecteur" })).toBeChecked();
  await colonne.getByRole("button", { name: "Démarrer une conversation" }).click();
  await expect(ongletAgent(page, 2)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /^Agent \d$/ })).toHaveCount(2);
});

test("REQ078_AC13_AC56_17_REQ078_AC23_REQ077_AC28_REQ078_AC24_REQ077_AC9_mise_en_page_de_l_agent", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  // Une seule session, une conversation par étape ; la réponse du faux provider est posée avant chaque envoi.
  const etapes = [];
  const servir = (r) => {
    etapes.length = faux.recues.length;
    etapes.push(r);
  };
  await agentPret(page, etapes);
  await test.step("REQ078_AC23_bords_alignes_1200", async () => {
    servir(reponse({ texte: "## Titre de réponse\n\nUn texte court.", tokens: 100 }));
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.getByRole("banner").getByRole("button", { name: "Replier le panneau" }).click();
    await rail(page, "Agent").click();
    await expect(champMessage(page)).toBeFocused();
    await champMessage(page).fill("Dis bonjour");
    await expect(envoyer(page)).toBeEnabled();
    await page.keyboard.press("Enter");
    await patienter(page, () => expect(fil(page).getByText("Un texte court.")).toBeVisible({ timeout: 300 }));
    const bords = async () => {
      const boite = async (l) => {
        const b = await l.boundingBox();
        return { gauche: b.x, droite: b.x + b.width, largeur: b.width };
      };
      const editeur = await boite(page.locator("main.cadre-principal"));
      const c = await boite(champMessage(page));
      return {
        champ: c,
        ecart: c.gauche - editeur.gauche,
        titre: await boite(page.locator(".cadre-code .agent-titre")),
        titreReponse: await boite(fil(page).locator("h2")),
        texte: await boite(fil(page).getByText("Un texte court.")),
        conversations: await boite(page.getByRole("button", { name: "Conversations", exact: true })),
        envoyer: await boite(envoyer(page)),
        profil: await boite(profil(page)),
      };
    };
    const proche = (a, b, nom) => expect(Math.abs(a - b), nom).toBeLessThanOrEqual(1);
    const replie = await bords();
    expect([Math.round(replie.champ.largeur), Math.round(replie.ecart)]).toEqual([1200, 152]);
    proche(replie.titre.gauche, replie.champ.gauche, "titre de la conversation, bord gauche");
    proche(replie.titreReponse.gauche, replie.champ.gauche, "titre de la réponse, bord gauche");
    proche(replie.texte.gauche, replie.champ.gauche, "texte de la réponse, bord gauche");
    proche(replie.conversations.droite, replie.champ.droite, "Conversations, bord droit");
    proche(replie.envoyer.droite, replie.champ.droite, "Envoyer, bord droit");
    expect(replie.profil.largeur, "Profil").toBe(200);
    await page.getByRole("banner").getByRole("button", { name: "Déplier le panneau" }).first().click();
    const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
    await poignee.focus();
    for (let i = 0; i < 60 && (await poignee.getAttribute("aria-valuenow")) !== "280"; i++) {
      await page.keyboard.press(Number(await poignee.getAttribute("aria-valuenow")) > 280 ? "ArrowLeft" : "ArrowRight");
    }
    await expect(poignee).toHaveAttribute("aria-valuenow", "280");
    expect(Math.round((await bords()).champ.largeur)).toBe(1196);
  });
  await test.step("REQ077_AC28_REQ078_AC24_reponse_onglet_agent_sans_et_avec_agents", async () => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.getByRole("banner").getByRole("button", { name: "Replier le panneau" }).first().click();
    servir(reponse({ texte: REPONSE_MD, tokens: 100 }));
    // Une conversation sans agent.
    await page.getByRole("button", { name: "Nouvelle conversation" }).click();
    await champMessage(page).fill("Compare");
    await expect(envoyer(page)).toBeEnabled();
    await page.keyboard.press("Enter");
    await patienter(page, () => expect(fil(page).locator("table")).toBeVisible({ timeout: 300 }));
    await expect(fil(page).locator("pre")).toBeVisible();
    verifierReponse(await mesurerReponse(page), "sans agent");
    servir(reponse({ texte: REPONSE_MD, tokens: 100 }));
    // Une conversation avec Relecteur et Testeur, créés sur le disque.
    for (const nom of ["Relecteur", "Testeur"]) {
      const d = path.join(yaide.dossier, ".yaide", "agents", nom.toLowerCase());
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "agent.json"), JSON.stringify({ nom, avatar: "", couleur: nom === "Testeur" ? "orange" : "vert" }));
    }
    const colonne = page.locator("aside.cadre-agent");
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await colonne.getByRole("checkbox", { name: "Relecteur" }).check();
    await colonne.getByRole("checkbox", { name: "Testeur" }).check();
    await colonne.getByRole("button", { name: "Démarrer une conversation" }).click();
    await expect(ongletAgent(page, 2)).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Replier l'agent" }).click();
    await champMessage(page).fill("Relis");
    await expect(envoyer(page)).toBeEnabled();
    await page.keyboard.press("Enter");
    await patienter(page, () => expect(fil(page).getByRole("group", { name: "Testeur" }).locator("table")).toBeVisible({ timeout: 300 }));
    await expect(fil(page).getByRole("group", { name: "Relecteur" }).locator("pre")).toBeVisible();
    verifierReponse(await mesurerReponse(page), "avec agents");
  });
  await test.step("REQ078_AC13_AC56_17_largeur_1200_et_800x480", async () => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await ongletAgent(page, 1).click();
    await page.getByRole("button", { name: "Nouvelle conversation" }).click();
    await expect(champMessage(page)).toBeFocused();
    const mesurer = () =>
      page.evaluate(() => {
        const corps = [...document.querySelectorAll(".cadre-code .agent-corps")].find((e) => e.getClientRects().length);
        const contenu = (e) => {
          const c = getComputedStyle(e);
          return { largeur: e.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight), gauche: parseFloat(c.paddingLeft), droite: parseFloat(c.paddingRight) };
        };
        const saisie = corps.querySelector(".agent-saisie");
        const envoyer = [...saisie.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Envoyer" || b.textContent.trim() === "Envoyer");
        const select = saisie.querySelector("select");
        return {
          entete: contenu(corps.querySelector(".agent-entete")),
          fil: contenu(corps.querySelector(".agent-fil")),
          saisie: contenu(saisie),
          saisieDefile: saisie.scrollWidth - saisie.clientWidth,
          enteteDefile: corps.querySelector(".agent-entete").scrollWidth - corps.querySelector(".agent-entete").clientWidth,
          filDefile: corps.querySelector(".agent-fil").scrollWidth - corps.querySelector(".agent-fil").clientWidth,
          profil: select ? select.getBoundingClientRect().width : 0,
          ecartEnvoyer: envoyer ? saisie.getBoundingClientRect().right - parseFloat(getComputedStyle(saisie).paddingRight) - envoyer.getBoundingClientRect().right : null,
          editeur: document.querySelector("main.cadre-principal").getBoundingClientRect().width,
          page: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight],
        };
      });
    // AC-078-13 : 1200 px au plus, centré, panneau et colonne repliés à 1600 px.
    const grand = await mesurer();
    for (const z of ["entete", "fil", "saisie"]) {
      expect(Math.round(grand[z].largeur), z).toBe(1200);
      expect(Math.abs(grand[z].gauche - grand[z].droite), `${z} centré`).toBeLessThanOrEqual(1);
    }
    expect(grand.page).toEqual([0, 0]);

    // Même fenêtre, panneau à 280 px : 12 px de marge de chaque côté, rien ne défile en largeur (AC-078-23).
    await page.getByRole("banner").getByRole("button", { name: "Déplier le panneau" }).first().click();
    const poignee280 = page.getByRole("separator", { name: "Largeur du panneau" });
    await poignee280.focus();
    for (let i = 0; i < 60 && (await poignee280.getAttribute("aria-valuenow")) !== "280"; i++) {
      await page.keyboard.press(Number(await poignee280.getAttribute("aria-valuenow")) > 280 ? "ArrowLeft" : "ArrowRight");
    }
    await expect(poignee280).toHaveAttribute("aria-valuenow", "280");
    const p280 = await mesurer();
    for (const z of ["entete", "fil", "saisie"]) expect([p280[z].gauche, p280[z].droite], `${z} à 280 px`).toEqual([12, 12]);
    expect([p280.enteteDefile, p280.filDefile, p280.saisieDefile]).toEqual([0, 0, 0]);
    expect(p280.page).toEqual([0, 0]);
    // AC-078-25 : la colonne dépliée garde sa limite de 720 px.
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(page.getByRole("separator", { name: "Largeur de l'agent" })).toHaveAttribute("aria-valuemax", "720");
    await page.getByRole("button", { name: "Replier l'agent" }).click();
    await page.getByRole("banner").getByRole("button", { name: "Replier le panneau" }).first().click();

    // 800 × 480, panneau à 240 px : rien ne déborde, la page ne défile pas.
    await page.setViewportSize({ width: 800, height: 480 });
    await page.getByRole("banner").getByRole("button", { name: "Déplier le panneau" }).first().click();
    const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
    await poignee.focus();
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
    await expect(poignee).toHaveAttribute("aria-valuenow", "240");
    await expect(champMessage(page)).toBeVisible();
    const petit = await mesurer();
    expect(petit.page).toEqual([0, 0]);
    expect([petit.enteteDefile, petit.filDefile, petit.saisieDefile]).toEqual([0, 0, 0]);
    for (const z of ["entete", "fil", "saisie"]) expect(petit[z].largeur, z).toBeGreaterThan(0);

    // AC-056-17 : éditeur à 320 px (colonne dépliée, panneau replié), puis à 1280 px.
    await page.getByRole("banner").getByRole("button", { name: "Replier le panneau" }).first().click();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await elargirColonne(page);
    await expect.poll(async () => Math.round((await mesurer()).editeur)).toBe(320);
    for (const [largeur, hauteur] of [[800, 480], [1376, 720]]) {
      await page.setViewportSize({ width: largeur, height: hauteur });
      if (largeur === 1376) await page.getByRole("button", { name: "Replier l'agent" }).click();
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      const m = await mesurer();
      expect(Math.round(m.editeur), `${largeur} px : éditeur`).toBe(largeur === 800 ? 320 : 1280);
      expect(m.saisieDefile, `${largeur} px : saisie`).toBe(0);
      expect(m.profil, `${largeur} px : Profil`).toBeGreaterThan(0);
      expect(m.profil, `${largeur} px : Profil`).toBeLessThanOrEqual(200);
      // « Envoyer » est le dernier à droite, au bord du contenu ; à 320 px ce bord est à 12 px de la zone de saisie.
      expect(Math.round(m.ecartEnvoyer), `${largeur} px : Envoyer`).toBe(0);
      if (largeur === 800) expect(m.saisie.droite, "marge à 320 px").toBe(12);
    }

    // Sans compteur (profil sans fenêtre de contexte), « Envoyer » reste calé à droite.
    await api(page, "PUT", "/api/agent/profils", { nom: "libre", provider: "anthropic", modele: "modele-inconnu" });
    await page.reload();
    await page.getByRole("button", { name: "Nouvelle conversation" }).click();
    await profil(page).selectOption({ label: "libre" });
    await expect(page.locator(".cadre-code .agent-compteur:visible")).toHaveCount(0);
    expect(Math.round((await mesurer()).ecartEnvoyer), "sans compteur : Envoyer").toBe(0);
  });
  await test.step("REQ077_AC9_onglet_agent_320_px", async () => {
    const chemin = "src/" + "tres-long-".repeat(7) + "fin.rs";
    expect(chemin.length).toBeGreaterThanOrEqual(80);
    const md = ["| a | b | c | d | e | f |", "|---|---|---|---|---|---|", `| ${chemin} | 1 | 2 | 3 | 4 | 5 |`, "", "```", "x".repeat(300), "```"].join("\n");
    servir(reponse({ texte: md, tokens: 100 }));
    await page.setViewportSize({ width: 800, height: 480 });
    await ongletAgent(page, 1).click();
    await page.getByRole("button", { name: "Nouvelle conversation" }).click();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await elargirColonne(page);
    await expect.poll(() => page.locator("main.cadre-principal").evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(320);
    await champMessage(page).fill("Tableau");
    await page.keyboard.press("Enter");
    await patienter(page, () => expect(fil(page).locator("table")).toBeVisible({ timeout: 300 }));
    await expect(fil(page).locator("pre")).toBeVisible();
    const m = await fil(page).evaluate((f) => {
      const droite = f.getBoundingClientRect().right;
      const t = f.querySelector("table");
      const pre = f.querySelector("pre");
      return {
        defile: f.scrollWidth - f.clientWidth,
        tableauDeborde: t.getBoundingClientRect().right > droite + 0.5 || t.scrollWidth > t.clientWidth + 1,
        cellule: [...t.querySelectorAll("td")][0].scrollWidth <= [...t.querySelectorAll("td")][0].clientWidth + 1,
        codeDeborde: pre.getBoundingClientRect().right > droite + 0.5 || pre.scrollWidth > pre.clientWidth + 1,
      };
    });
    expect(m).toEqual({ defile: 0, tableauDeborde: false, cellule: true, codeDeborde: false });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.getByRole("button", { name: "Replier l'agent" }).click();
  });
});

test("REQ078_AC15_ordre_de_tab_et_touches", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  await agentPret(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("banner").getByRole("button", { name: "Replier le panneau" }).click();
  await rail(page, "Agent").click();
  await expect(champMessage(page)).toBeFocused();
  await champMessage(page).fill("x");
  await expect(profil(page)).toBeEnabled(); // les réglages sont chargés : la liste ne sera plus remplacée
  await expect(envoyer(page)).toBeEnabled();
  // Tab après l'onglet actif : AC-056-14, puis la suite de AC-028-8 (boutons « Agent », « Agents »).
  await ongletAgent(page, 1).focus();
  const attendus = [
    page.getByRole("button", { name: "Nouvelle conversation" }),
    fil(page),
    champMessage(page), // « Conversations » est désactivé tant qu'il n'y a aucune conversation
    profil(page),
    envoyer(page),
    rail(page, "Agent"),
    page.getByRole("button", { name: "Agents", exact: true }),
  ];
  for (const cible of attendus) {
    await page.keyboard.press("Tab");
    await expect(cible).toBeFocused();
  }
  // Dans le champ : Ctrl+S ne fait rien, Ctrl+P ouvre l'ouverture rapide, Ctrl+Maj+F va au rail de gauche.
  await champMessage(page).focus();
  const ctrlS = await page.evaluate(() => {
    const e = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(ctrlS).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+p");
  await expect(page.getByRole("textbox", { name: "Chemin du fichier" })).toBeFocused();
  await page.keyboard.press("Escape");
  await champMessage(page).focus();
  await page.keyboard.press("Control+Shift+F");
  await expect(page.getByRole("navigation", { name: "Panneaux" }).getByRole("tab", { name: "Fichiers" })).toBeFocused();
});

const REPONSE_MD = [
  "## Boucle actuelle ou bibliothèque",
  "",
  "Je garderais **la boucle actuelle** : `clap` ajoute des dépendances, *sans gain réel* pour quatre options. La boucle lit chaque argument une fois, et une erreur reste facile à suivre dans `parse_args`. Détails dans la [documentation de clap](https://docs.rs/clap).",
  "",
  "| Méthode | Lignes | Dépendances |",
  "|---|---:|:---:|",
  "| Boucle actuelle | 42 | aucune |",
  "| `clap` avec `derive` | 18 | 13 |",
  "| `lexopt` | 31 | 1 |",
  "",
  "> Attention : `--sortie` sans valeur passe aujourd'hui sans erreur.",
  ">",
  "> > Cas à couvrir par un test.",
  "",
  "> [!NOTE]",
  "> Il faut Rust 1.80.",
  "",
  "Ce que je propose :",
  "",
  "1. Garder `parse_args`.",
  "2. Ajouter le cas manquant.",
  "3. ~~Passer à clap~~ : inutile ici.",
  "",
  "- Refuser l'option sans valeur ;",
  "  - citer l'option dans le message ;",
  "    - ajouter le test.",
  "- [ ] à faire",
  "- [x] fait",
  "",
  "---",
  "",
  "```rust",
  "// le cas manquant",
  "#[test]",
  "fn sortie_sans_valeur() {",
  '    let args = vec!["--sortie".to_string()];',
  "    assert!(parse_args(&args).is_err());",
  "}",
  "```",
].join("\n");

/** Mesures d'une réponse mise en forme dans l'onglet affiché ; les couleurs attendues sont lues sur les tokens. */
const mesurerReponse = async (page) => {
  const champ = await champMessage(page).boundingBox();
  return page.evaluate((champ) => {
    const f = [...document.querySelectorAll('[role="log"]')].find((l) => l.getClientRects().length);
    const jeton = (nom) => {
      const s = document.createElement("span");
      s.style.color = `var(${nom})`;
      s.style.backgroundColor = `var(${nom})`;
      document.body.append(s);
      const v = getComputedStyle(s).color;
      s.remove();
      return v;
    };
    const cs = (e, pseudo) => getComputedStyle(e, pseudo);
    const r = (e) => e.getBoundingClientRect();
    const rep = [...f.querySelectorAll(".ya-chat-agent")].pop();
    const table = rep.querySelector("table");
    const th = table.querySelector("th");
    const lignes = table.querySelectorAll("tbody tr");
    const td = lignes[0].querySelector("td");
    const bq = rep.querySelector("blockquote:not(.ya-note)");
    const note = rep.querySelector("blockquote.ya-note");
    const titre = note.querySelector(".ya-note-titre");
    const pre = rep.querySelector("pre");
    const enLigne = [...rep.querySelectorAll("p code")].pop();
    const ul = rep.querySelector(":scope > ul");
    const ul2 = ul.querySelector("ul");
    const ul3 = ul2.querySelector("ul");
    const ol = rep.querySelector(":scope > ol");
    const cases = [...rep.querySelectorAll(".ya-tache input")];
    const lis = [...ul.children];
    const liPuce = lis.find((li) => li.firstChild.textContent.trim().startsWith("Refuser"));
    const liTache = lis.find((li) => li.classList.contains("ya-tache"));
    const commentaire = [...pre.querySelectorAll("span")].find((x) => x.textContent.includes("manquant"));
    const lien = rep.querySelector("a");
    const corps = rep.closest(".ya-tour-corps");
    const gauche = (li) => {
      const g = document.createRange();
      g.selectNodeContents([...li.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()));
      return g.getBoundingClientRect().left;
    };
    const pad = (e) => [cs(e).paddingTop, cs(e).paddingRight, cs(e).paddingBottom, cs(e).paddingLeft];
    const borduresNote = ["Top", "Right", "Bottom", "Left"].map((c) => cs(note)["border" + c + "Width"] + " " + cs(note)["border" + c + "Color"]);
    return {
      defile: f.scrollWidth - f.clientWidth,
      groupe: !!corps,
      debordeGroupe: corps ? r(rep).right > r(corps).right + 0.5 : null,
      tableau: { largeur: r(table).width, colonne: r(rep).width, gauche: r(table).left, texte: r(rep.querySelector("p")).left },
      citationDroite: r(bq).right - champ.x - champ.width,
      codeDroite: r(pre).right - champ.x - champ.width,
      cellule: { police: cs(th).fontFamily, sans: cs(document.documentElement).getPropertyValue("--font-sans").trim(), taille: cs(th).fontSize, interligne: cs(th).lineHeight, bordure: cs(th).borderTopWidth + " " + cs(th).borderTopColor, bordureAttendue: "1px " + jeton("--line-strong"), marges: pad(th), td: { police: cs(td).fontFamily, taille: cs(td).fontSize, interligne: cs(td).lineHeight, bordure: cs(td).borderTopWidth + " " + cs(td).borderTopColor, marges: pad(td) } },
      entete: { fond: cs(th).backgroundColor, attendu: jeton("--apercu-entete"), graisse: cs(th).fontWeight },
      lignePaire: { fond: cs(lignes[1].querySelector("td")).backgroundColor, attendu: jeton("--apercu-fond") },
      ligneImpaire: cs(lignes[0].querySelector("td")).backgroundColor,
      citation: { filet: cs(bq).borderLeftWidth + " " + cs(bq).borderLeftColor, infoAttendu: "3px " + jeton("--info"), fond: cs(bq).backgroundColor, fondAttendu: jeton("--msg-info"), couleur: cs(bq).color, ink: jeton("--ink"), marges: [cs(bq).paddingTop, cs(bq).paddingLeft], autresBords: [cs(bq).borderTopWidth, cs(bq).borderRightWidth, cs(bq).borderBottomWidth] },
      interieur: { filet: cs(bq.querySelector("blockquote")).borderLeftWidth + " " + cs(bq.querySelector("blockquote")).borderLeftColor, fond: cs(bq.querySelector("blockquote")).backgroundColor },
      note: { bordures: borduresNote, info: jeton("--info"), rayon: cs(note).borderTopLeftRadius, fond: cs(note).backgroundColor, fondAttendu: jeton("--msg-info"), marges: [cs(note).paddingTop, cs(note).paddingLeft], titre: { graisse: cs(titre).fontWeight, couleur: cs(titre).color, marge: cs(titre).marginBottom } },
      code: { fond: cs(pre).backgroundColor, attendu: jeton("--apercu-fond"), police: cs(pre).fontFamily, mono: cs(document.documentElement).getPropertyValue("--font-mono").trim(), taille: cs(pre).fontSize + " " + cs(pre).lineHeight, marges: [cs(pre).paddingTop, cs(pre).paddingLeft] },
      commentaire: commentaire ? { couleur: cs(commentaire).color, attendu: jeton("--syn-comment"), style: cs(commentaire).fontStyle } : null,
      enLigne: { fond: cs(enLigne).backgroundColor, attendu: jeton("--apercu-fond"), couleur: cs(enLigne).color, parent: cs(enLigne.parentElement).color, taille: cs(enLigne).fontSize, police: cs(enLigne).fontFamily },
      listes: { ul: cs(ul).paddingLeft, ol: cs(ol).paddingLeft, puces: [cs(ul).listStyleType, cs(ul2).listStyleType, cs(ul3).listStyleType], numeros: cs(ol).listStyleType, margeSousListe: cs(ul2).marginBottom },
      cases: {
        tailles: cases.map((c) => r(c).width + "x" + r(c).height),
        contour: cases.map((c) => cs(c).borderTopWidth + " " + cs(c).borderTopColor),
        contourAttendu: "1px " + jeton("--ink-muted"),
        puce: cs(liTache).listStyleType,
        noms: cases.map((c) => c.getAttribute("aria-label")),
        opaciteCoche: [cs(cases[0]).opacity, cs(cases[1], "::before").opacity, cs(cases[1]).opacity],
        coche: cs(cases[1], "::before").borderLeftColor,
        ink: jeton("--ink"),
        ecartTexte: Math.abs(gauche(liTache) - gauche(liPuce)),
      },
      lien: { target: lien.getAttribute("target"), rel: lien.getAttribute("rel") },
    };
  }, champ);
};

/** Contrôles communs aux deux conversations (AC-077-10, 11, 13, 14, 22, 24, 26 ; AC-078-24). */
function verifierReponse(m, etiquette) {
  const e = (nom) => `${etiquette} : ${nom}`;
  // AC-078-24
  expect(m.defile, e("scrollWidth")).toBe(0);
  if (etiquette === "avec agents") {
    expect(m.groupe, e("groupe")).toBe(true);
    expect(m.debordeGroupe, e("réponse dans son groupe")).toBe(false);
  }
  expect(m.tableau.largeur, e("tableau plus étroit")).toBeLessThan(m.tableau.colonne - 20);
  expect(Math.abs(m.tableau.gauche - m.tableau.texte), e("tableau au bord du texte")).toBeLessThanOrEqual(1);
  expect(Math.abs(m.citationDroite), e("citation au bord du champ")).toBeLessThanOrEqual(1);
  expect(Math.abs(m.codeDroite), e("code au bord du champ")).toBeLessThanOrEqual(1);
  // AC-077-10
  const sansGuillemets = (t) => t.replaceAll('"', "");
  expect(sansGuillemets(m.cellule.police), e("police du tableau")).toBe(sansGuillemets(m.cellule.sans));
  expect([m.cellule.taille, m.cellule.interligne], e("cellule")).toEqual(["13px", "20px"]);
  expect(m.cellule.bordure, e("bordure")).toBe(m.cellule.bordureAttendue);
  expect(m.cellule.marges, e("marges de cellule")).toEqual(["4px", "8px", "4px", "8px"]);
  expect(sansGuillemets(m.cellule.td.police), e("police d'une cellule")).toBe(sansGuillemets(m.cellule.sans));
  expect([m.cellule.td.taille, m.cellule.td.interligne], e("cellule de corps")).toEqual(["13px", "20px"]);
  expect(m.cellule.td.bordure, e("bordure de cellule de corps")).toBe(m.cellule.bordureAttendue);
  expect(m.cellule.td.marges, e("marges de cellule de corps")).toEqual(["4px", "8px", "4px", "8px"]);
  expect(m.entete.fond, e("fond d'en-tête")).toBe(m.entete.attendu);
  expect(m.entete.graisse, e("graisse d'en-tête")).toBe("600");
  expect(m.lignePaire.fond, e("ligne paire")).toBe(m.lignePaire.attendu);
  expect(m.ligneImpaire, e("ligne impaire")).toBe("rgba(0, 0, 0, 0)");
  // AC-077-11
  expect(m.citation.filet, e("filet de citation")).toBe(m.citation.infoAttendu);
  expect(m.citation.fond, e("fond de citation")).toBe(m.citation.fondAttendu);
  expect(m.citation.couleur, e("texte de citation")).toBe(m.citation.ink);
  expect(m.citation.marges, e("marges de citation")).toEqual(["6px", "8px"]);
  expect(m.citation.autresBords, e("citation : filet gauche seul")).toEqual(["0px", "0px", "0px"]);
  expect(m.interieur.filet, e("filet intérieur")).toBe(m.citation.infoAttendu);
  expect(m.interieur.fond, e("fond intérieur")).toBe("rgba(0, 0, 0, 0)");
  // AC-077-13
  expect(m.code.fond, e("fond du bloc")).toBe(m.code.attendu);
  expect(sansGuillemets(m.code.police), e("police du bloc")).toBe(sansGuillemets(m.code.mono));
  expect(m.code.taille, e("taille du bloc")).toBe("12px 18px");
  expect(m.code.marges, e("marges du bloc")).toEqual(["6px", "8px"]);
  expect(m.commentaire, e("commentaire coloré")).toEqual({ couleur: m.commentaire?.attendu, attendu: m.commentaire?.attendu, style: "italic" });
  expect(m.enLigne.fond, e("code en ligne")).toBe(m.enLigne.attendu);
  expect(m.enLigne.couleur, e("couleur du code en ligne")).toBe(m.enLigne.parent);
  expect(m.enLigne.taille, e("taille du code en ligne")).toBe("12px");
  expect(sansGuillemets(m.enLigne.police), e("police du code en ligne")).toBe(sansGuillemets(m.code.mono));
  // AC-077-14
  expect([m.listes.ul, m.listes.ol], e("retrait des listes")).toEqual(["24px", "24px"]);
  expect(m.listes.puces, e("puces")).toEqual(["disc", "circle", "square"]);
  expect(m.listes.numeros, e("numéros")).toBe("decimal");
  expect(m.listes.margeSousListe, e("sous-liste")).toBe("0px");
  // AC-077-22
  expect(m.note.bordures, e("bordures de la note")).toEqual(Array(4).fill("1px " + m.note.info));
  expect(m.note.rayon, e("rayon de la note")).toBe("4px");
  expect(m.note.fond, e("fond de la note")).toBe(m.note.fondAttendu);
  expect(m.note.marges, e("marges de la note")).toEqual(["6px", "8px"]);
  expect(m.note.titre, e("titre de la note")).toEqual({ graisse: "600", couleur: m.note.info, marge: "4px" });
  // AC-077-24
  expect(m.cases.tailles, e("taille des cases")).toEqual(["14x14", "14x14"]);
  expect(m.cases.contour, e("contour des cases")).toEqual([m.cases.contourAttendu, m.cases.contourAttendu]);
  expect(m.cases.puce, e("pas de puce")).toBe("none");
  expect(m.cases.noms, e("noms des cases")).toEqual(["À faire", "Fait"]);
  expect(m.cases.coche, e("coche")).toBe(m.cases.ink);
  expect(new Set(m.cases.opaciteCoche), e("opacité de la coche")).toEqual(new Set(["1"]));
  expect(m.cases.ecartTexte, e("texte aligné sur celui d'une puce")).toBeLessThanOrEqual(1);
  // AC-077-26
  expect(m.lien, e("lien")).toEqual({ target: "_blank", rel: "noopener noreferrer" });
}

test("REQ085_parcours_56_un_agent_raisonne_l_autre_non", async ({ page }) => {
  // P-056 : AC-085-5, AC-085-8 (et AC-085-7 : la requête de Testeur ne porte pas le raisonnement).
  faux = await lancerFauxProvider([
    reponse({ raisonnement: "Je lis args.rs d'abord.", signature: "sig-r1", outils: [{ id: "r1", nom: "read", entree: { path: "src/args.rs" } }], tokens: 2000 }),
    reponse({ raisonnement: "Le défaut est clair.", signature: "sig-r2", texte: "Relu : la branche `--sortie` avance de 2.", tokens: 3000 }),
    reponse({ texte: "Les tests passent.", tokens: 4000 }),
  ]);
  const dossier = depotAgent();
  for (const [nom, couleur] of [["Relecteur", "vert"], ["Testeur", "orange"]]) {
    const d = path.join(dossier, ".yaide", "agents", nom.toLowerCase());
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "agent.json"), JSON.stringify({ nom, avatar: "", couleur }));
  }
  await page.clock.install();
  yaide = await lancerYaide({ dossier });
  await page.setViewportSize({ width: 1600, height: 900 });
  await ouvrirYaide(page, yaide.origine, "mdp", { shell: false });
  await reglerAnthropic(page);
  const colonne = page.locator("aside.cadre-agent");
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await colonne.getByRole("checkbox", { name: "Relecteur" }).check();
  await colonne.getByRole("checkbox", { name: "Testeur" }).check();
  await colonne.getByRole("button", { name: "Démarrer une conversation" }).click();
  await expect(champMessage(page)).toBeFocused();
  await champMessage(page).fill("Relis src/args.rs, puis lance les tests.");
  await expect(envoyer(page)).toBeEnabled();
  await page.keyboard.press("Enter");
  await patienter(page, () => expect(fil(page).getByRole("group", { name: "Testeur" })).toContainText("Les tests passent.", { timeout: 300 }));
  await expect(arreter(page)).toBeHidden();

  const groupe = (nom) => fil(page).getByRole("group", { name: nom });
  const raisons = (nom) => groupe(nom).getByRole("button", { name: "Raisonnement", exact: true });
  await expect(raisons("Relecteur")).toHaveCount(2);
  await expect(raisons("Testeur")).toHaveCount(0);
  await expect(raisons("Relecteur").first()).toHaveAttribute("aria-expanded", "false");

  // AC-085-8 : Tab jusqu'au premier, Entrée le déplie ; le filet de Relecteur le longe.
  await fil(page).focus();
  await page.keyboard.press("Tab");
  await expect(raisons("Relecteur").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(raisons("Relecteur").first()).toHaveAttribute("aria-expanded", "true");
  const zone = groupe("Relecteur").locator(".ya-raison-zone").first();
  await expect(zone).toBeVisible();
  await expect(zone).toContainText("Je lis args.rs d'abord.");
  const vert = await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--agent-vert)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  const filet = groupe("Relecteur").locator(".ya-tour-corps");
  expect(await filet.evaluate((e) => getComputedStyle(e).borderLeftColor)).toBe(vert);
  expect(await filet.locator(".ya-raison").first().evaluate((b) => !!b.closest(".ya-tour-corps"))).toBe(true);

  // AC-085-5 : la requête suivante de Relecteur renvoie le bloc thinking et sa signature ; celle de Testeur, non.
  const assistant = faux.recues[1].corps.messages.find((m) => m.role === "assistant");
  expect(assistant.content[0]).toMatchObject({ type: "thinking", thinking: "Je lis args.rs d'abord.", signature: "sig-r1" });
  expect(JSON.stringify(faux.recues[2].corps)).not.toContain("sig-r1");

  // Fermer l'onglet, rouvrir par « Conversations » : raisonnements à leur place, repliés.
  await ongletAgent(page, 1).focus();
  await page.keyboard.press("Delete");
  await expect(ongletAgent(page, 1)).toHaveCount(0);
  await rail(page, "Agent").click();
  await page.getByRole("button", { name: "Conversations" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  await patienter(page, () => expect(raisons("Relecteur")).toHaveCount(2, { timeout: 300 }));
  await expect(raisons("Testeur")).toHaveCount(0);
  await expect(raisons("Relecteur").first()).toHaveAttribute("aria-expanded", "false");
  await expect(raisons("Relecteur").nth(1)).toHaveAttribute("aria-expanded", "false");
});
