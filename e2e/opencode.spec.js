import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { depotExemple, gardeContient, lancerYaide, nomLigne, ouvrirYaide, avancer } from "./aides.js";
import { lancerRelais } from "./relais.js";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seul (DEC-037)");

const FAUX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "faux-opencode.mjs");

let yaide;
let relais;
test.afterEach(async () => {
  relais?.fermer();
  relais = undefined;
  await yaide?.arreter();
});

/**
 * Dossier d'un faux `opencode` qui rejoue `scenario`. Ses sessions vivent dans `etat.json` (elles survivent à un
 * redémarrage de Yaide) ; le fichier `casse` fait échouer son prochain `opencode serve`.
 */
function fauxOpencode(scenario, pas) {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-opencode-"));
  const script = `#!/bin/sh
export FAUX_OPENCODE_ETAT='${bin}/etat.json' FAUX_OPENCODE_SCENARIO='${scenario}' FAUX_OPENCODE_TEMOIN='${bin}/temoin'${pas ? ` FAUX_OPENCODE_PAS='${pas}'` : ""}
[ -e '${bin}/casse' ] && export FAUX_OPENCODE_ECHEC=1
exec '${process.execPath}' '${FAUX}' "$@"
`;
  fs.writeFileSync(path.join(bin, "opencode"), script, { mode: 0o755 });
  return bin;
}

/** Dossier d'un faux `claude` (présent seulement pour que le rail droit ait ses quatre boutons). */
function fauxClaude() {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-claude-"));
  fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexec /bin/sh\n", { mode: 0o755 });
  return bin;
}

const arbre = (page) => page.getByRole("tree", { name: "Fichiers" });
const ligne = (page, nom) => arbre(page).getByRole("treeitem", { name: nomLigne(nom) });
const onglet = (page, nom) => page.getByRole("tab", { name: nom });
const boutonOpencode = (page) => page.getByRole("button", { name: "opencode", exact: true });
const champ = (page) => page.getByRole("textbox", { name: "Message à opencode" });
const demandes = (page) => page.getByRole("region", { name: "Demandes d'opencode" });
const alerte = (page, texte) => page.getByRole("alert").filter({ hasText: texte });

async function survoler(page, bouton) {
  await page.mouse.move(0, 0);
  await bouton.hover();
  await page.clock.fastForward(400);
}

async function envoyer(page, texte) {
  await champ(page).fill(texte);
  await page.keyboard.press("Enter");
}

/**
 * Règle l'éditeur à `cible` px de large (la fenêtre jusqu'à 800 px, le reste à la poignée de l'agent), puis mesure la
 * barre de la zone de saisie. À appeler panneau replié et agent déplié.
 */
async function mesurerBarre(page, cible) {
  const principal = page.locator("main.cadre-principal");
  for (let i = 0; i < 4; i++) {
    const w = (await principal.boundingBox()).width;
    if (Math.abs(w - cible) < 1) break;
    const v = page.viewportSize();
    const largeur = Math.max(800, Math.round(v.width + cible - w));
    if (largeur !== v.width) {
      await page.setViewportSize({ width: largeur, height: v.height });
      continue;
    }
    const p = await page.getByRole("separator", { name: "Largeur de l'agent" }).boundingBox();
    const x = p.x + p.width / 2;
    const y = p.y + p.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - (w - cible), y, { steps: 4 });
    await page.mouse.up();
  }
  expect(Math.abs((await principal.boundingBox()).width - cible), `éditeur à ${cible}, fenêtre ${page.viewportSize().width}`).toBeLessThan(1);
  return page.evaluate(() => {
    const barre = [...document.querySelectorAll(".session-saisie")].find((e) => e.offsetParent).lastElementChild;
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, droite: r.right, bas: r.bottom, largeur: r.width, hauteur: r.height };
    };
    const bouton = (nom) => [...barre.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === nom);
    const entier = (e) => e.getBoundingClientRect().width > 0 && e.scrollWidth <= e.clientWidth;
    const compteur = barre.querySelector(".agent-compteur");
    const [m, e] = [...barre.querySelectorAll("select")].map((x) => x.getBoundingClientRect());
    const envoyer = bouton("Envoyer");
    const arreter = bouton("Arrêter");
    const visible = compteur && !compteur.hidden;
    return {
      deborde: barre.scrollWidth > barre.clientWidth,
      envoyer: entier(envoyer),
      arreter: entier(arreter),
      compteurEntier: visible ? entier(compteur) : null,
      modele: m.width,
      effort: e.width,
      barre: rect(barre),
      rEnvoyer: rect(envoyer),
      rArreter: rect(arreter),
      rEffort: rect(barre.querySelectorAll("select")[1]),
      rCompteur: visible ? rect(compteur) : null,
    };
  });
}

test("REQ072_parcours_36_tache_et_sous_agent", async ({ page }) => {
  await page.clock.install();
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "src", "args.rs"), "fn parse_args() {}\n");
  fs.writeFileSync(path.join(dossier, "NOTES.md"), "ancien\n");
  yaide = await lancerYaide({ dossier, opencode: fauxOpencode("sousagent") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, yaide.origine);
  await ligne(page, "src").click();
  await ligne(page, "args.rs").click();
  await ligne(page, "NOTES.md").click();
  await expect(page.getByRole("textbox", { name: "Éditeur NOTES.md" })).toBeFocused();
  await onglet(page, "args.rs").click();

  // 1. Le bouton et son info-bulle, à gauche.
  const bouton = boutonOpencode(page);
  await survoler(page, bouton);
  const info = page.getByRole("tooltip", { name: "Nouvelle session opencode" });
  await expect(info).toBeVisible();
  const [i, b] = await Promise.all([info.boundingBox(), bouton.boundingBox()]);
  expect(i.x + i.width).toBeLessThanOrEqual(b.x + 1);
  await page.mouse.move(0, 0);

  // 2. L'onglet s'ouvre, actif, vide, le focus dans le champ.
  await bouton.click();
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Écrivez un message pour commencer.")).toBeVisible();
  await expect(champ(page)).toBeFocused();

  // 3. Le message, la réponse du tour, la ligne du sous-agent.
  await envoyer(page, "Trouve les appels de parse_args et ajoute un test pour --sortie sans valeur.");
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Trouve les appels de parse_args")).toBeVisible();
  await expect(champ(page)).toHaveValue("");
  await expect(champ(page)).toBeFocused();
  await expect(page.getByRole("button", { name: "Arrêter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Envoyer" })).toBeDisabled();
  const sousAgent = page.getByRole("group", { name: /^Sous-agent explore/ });
  await expect(sousAgent).toContainText("Explorer le dépôt");
  await expect(sousAgent).toContainText("en cours");

  // 4. L'autorisation du sous-agent : dans l'onglet de la session, avec la marque « ! », sans prendre le focus.
  await expect(demandes(page)).toContainText("Le sous-agent explore demande une autorisation : shell.");
  await expect(demandes(page)).toContainText("cargo test parse_args");
  await expect(onglet(page, "opencode 1, question en attente")).toBeVisible();
  await expect(champ(page)).toBeFocused();

  // 5. « Ouvrir » : l'onglet du sous-agent, actif, avec la même demande, la note et sans champ.
  await page.getByRole("button", { name: "Ouvrir explore" }).click();
  await expect(onglet(page, /^explore, sous-agent : .*question en attente/)).toHaveAttribute("aria-selected", "true");
  await expect(demandes(page)).toContainText("Le sous-agent explore demande une autorisation : shell.");
  await expect(demandes(page)).toContainText("cargo test parse_args");
  await expect(page.getByText("Ce sous-agent est conduit par l'agent qui l'a lancé.")).toBeVisible();
  await expect(champ(page)).toHaveCount(0);
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText("Lance les tests.");

  // 6. « Autoriser une fois » : la demande et les deux marques disparaissent, le focus va sur la conversation.
  await page.getByRole("button", { name: "Autoriser une fois" }).click();
  await expect(demandes(page)).toHaveCount(0);
  await expect(onglet(page, /explore, sous-agent/)).toBeVisible();
  await expect(onglet(page, /question en attente/)).toHaveCount(0);
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText("Exploration terminée.");
  await expect(page.getByRole("log", { name: "Conversation" })).toBeFocused();

  // 7. Retour dans « opencode 1 » : sous-agent terminé, tour fini, le focus dans le champ.
  await onglet(page, "opencode 1").click();
  await expect(page.getByRole("group", { name: /^Sous-agent explore/ })).toContainText("terminé");
  await expect(page.getByText("Le sous-agent a fini.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrêter" })).toHaveCount(0);
  await expect(champ(page)).toBeFocused();

  // AC-072-15 : opencode écrit NOTES.md (autorisation de la racine à donner), l'onglet ouvert montre le nouveau contenu.
  await envoyer(page, "[scenario:outils] Écris les notes.");
  await expect(demandes(page)).toContainText("opencode demande une autorisation : shell.");
  await expect(demandes(page)).toContainText("echo bonjour");
  await page.getByRole("button", { name: "Autoriser une fois" }).click();
  await expect(page.getByText("Terminé.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrêter" })).toHaveCount(0);
  expect(fs.readFileSync(path.join(dossier, "NOTES.md"), "utf8")).toBe("notes\n");
  await onglet(page, "NOTES.md").click();
  const notes = page.getByRole("textbox", { name: "Éditeur NOTES.md" });
  await avancer(page, () => expect(notes).toContainText("notes", { timeout: 300 }));
  await expect(notes).not.toContainText("ancien");
  await onglet(page, "opencode 1").click();
  await page.clock.fastForward(300); // le minuteur qui garde la liste des onglets

  // 8. Rechargement : les onglets reviennent, avec l'historique, et le focus est dans le champ (AC-072-10, AC-072-28).
  await page.reload();
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await expect(onglet(page, /explore, sous-agent/)).toBeVisible();
  await expect(page.getByText("Le sous-agent a fini.")).toBeVisible();
  await expect(page.getByText("Terminé.")).toBeVisible();
  await expect(champ(page)).toBeFocused();

  // Yaide relancé : l'onglet rouvre la même session, historique compris (AC-072-10).
  yaide = await yaide.relancer();
  await page.clock.fastForward(300);
  await page.reload();
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Le sous-agent a fini.")).toBeVisible();
  await expect(page.getByRole("group", { name: /^Sous-agent explore/ })).toContainText("terminé");
  await expect(champ(page)).toBeFocused();
});

test("REQ072_parcours_37_question_erreur_coupure_a_800_par_480", async ({ page }) => {
  await page.clock.install();
  const opencode = fauxOpencode("formulaire");
  yaide = await lancerYaide({ opencode, claude: fauxClaude() });
  relais = await lancerRelais(yaide.port);
  await page.setViewportSize({ width: 800, height: 480 });
  await ouvrirYaide(page, relais.origine);

  // 1. Le rail droit à quatre boutons sans défilement ; l'info-bulle de « opencode » entière, à gauche du bouton.
  const rail = page.locator(".cadre-rail-droit");
  for (const nom of ["Agent", "Agents", "Claude", "opencode"]) await expect(rail.getByRole("button", { name: nom, exact: true })).toBeVisible();
  expect(await rail.evaluate((e) => e.scrollHeight <= e.clientHeight)).toBe(true);
  await boutonOpencode(page).click();
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await expect(champ(page)).toBeFocused();
  await survoler(page, boutonOpencode(page));
  const info = page.getByRole("tooltip", { name: "Nouvelle session opencode" });
  await expect(info).toBeVisible();
  const [i, b] = await Promise.all([info.boundingBox(), boutonOpencode(page).boundingBox()]);
  expect(i.x).toBeGreaterThanOrEqual(0);
  expect(i.x + i.width).toBeLessThanOrEqual(b.x + 1);
  expect(i.y).toBeGreaterThanOrEqual(0);
  expect(i.y + i.height).toBeLessThanOrEqual(480);
  await page.mouse.move(0, 0);

  // 2. Une question : la marque, le focus qui reste dans le champ.
  await envoyer(page, "Prépare la release 0.4.");
  await expect(demandes(page)).toContainText("opencode pose une question : Préparer la release.");
  await expect(onglet(page, "opencode 1, question en attente")).toBeVisible();
  await expect(champ(page)).toBeFocused();
  const version = page.getByLabel("Version (obligatoire)");
  await expect(version).toBeVisible();

  // 3. Champ obligatoire vide : le message sous le champ, qui prend le focus ; rien n'est envoyé.
  const question = demandes(page).getByRole("group", { name: "opencode pose une question : Préparer la release." });
  await version.fill("");
  await question.getByRole("button", { name: "Répondre" }).click();
  await expect(question.getByText("Ce champ est obligatoire.")).toBeVisible();
  await expect(version).toBeFocused();
  await expect(demandes(page)).toContainText("Préparer la release");
  await version.fill("0.4.0");
  await question.getByRole("button", { name: "Répondre" }).click();
  await expect(demandes(page)).not.toContainText("Préparer la release");
  // La seconde question du relevé est ignorée ; la marque disparaît avec elle.
  await demandes(page).getByRole("button", { name: "Ignorer" }).click();
  await expect(demandes(page)).toHaveCount(0);
  await expect(onglet(page, "opencode 1")).toBeVisible();
  await expect(champ(page)).toBeFocused();

  // 4. Un tour en échec : le message d'opencode tel quel, « Arrêter » absent, un nouveau tour possible.
  await envoyer(page, "[scenario:refus] Mets à jour Cargo.toml.");
  const echec = alerte(page, "Le tour a échoué. Vous pouvez envoyer un autre message.");
  await expect(echec).toContainText("Clé d'API invalide (faux provider)");
  await expect(page.getByRole("button", { name: "Arrêter" })).toHaveCount(0);

  // 5. Coupure sans tour en cours : l'envoi est refusé au-dessus du champ (le texte reste), l'ouverture donne un bandeau.
  const couper = async () => {
    relais.couper();
    await avancer(page, () => expect(alerte(page, "Connexion perdue. Modifications gardées.")).toBeVisible({ timeout: 300 }));
  };
  const retablir = async () => {
    relais.retablir();
    await avancer(page, () => expect(alerte(page, "Connexion perdue. Modifications gardées.")).toHaveCount(0, { timeout: 300 }));
  };
  await couper();
  await champ(page).fill("Encore un message");
  await page.keyboard.press("Enter");
  await expect(alerte(page, "Connexion perdue. Réessayez au retour.")).toBeVisible();
  await expect(champ(page)).toHaveValue("Encore un message");
  await expect(page.getByText("Encore un message", { exact: true })).toHaveCount(0);
  await boutonOpencode(page).click();
  await expect(alerte(page, "Connexion perdue. Réessayez au retour.")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: /^opencode/ })).toHaveCount(1);
  await retablir();
  await champ(page).fill("");

  // Un tour long coupé en route : au retour, la conversation reprend en direct (AC-072-10).
  await envoyer(page, "[scenario:interruption] Réessaie.");
  await expect(page.getByRole("button", { name: "Arrêter" })).toBeVisible();
  await expect(page.getByText("morceau 4")).toBeVisible();
  await couper();
  await retablir();
  const arreter = page.getByRole("button", { name: "Arrêter" });
  await expect(arreter).toBeVisible();
  await arreter.click();
  await expect(page.getByText("Arrêté.", { exact: true })).toBeVisible();
  await expect(arreter).toHaveCount(0);

  // 6. Largeur de la session et page sans défilement (AC-072-21).
  const mesures = await page.evaluate(() => {
    const session = document.querySelector(".session-contenu");
    const d = document.documentElement;
    return { largeur: session.getBoundingClientRect().width, page: d.scrollWidth > innerWidth || d.scrollHeight > innerHeight };
  });
  expect(mesures.page).toBe(false);
  expect(mesures.largeur).toBeLessThanOrEqual(1200 + 2 * 12 + 1);

  // 7. Un `opencode` cassé et un serveur arrêté : le bandeau à l'ouverture, l'erreur au-dessus du champ à l'envoi.
  fs.writeFileSync(path.join(opencode, "casse"), "");
  const pids = fs
    .readFileSync(path.join(opencode, "temoin"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).pid);
  process.kill(pids[pids.length - 1], "SIGKILL");
  await boutonOpencode(page).click();
  const impossible = alerte(page, /^Impossible d'ouvrir une session opencode : .+\.$/);
  await expect(impossible).toBeVisible();
  await expect(page.getByRole("tab", { name: /^opencode/ })).toHaveCount(1);
  await champ(page).fill("Un dernier message");
  await page.keyboard.press("Enter");
  await expect(alerte(page, /^opencode ne répond pas : .+\. Réessayez\.$/)).toBeVisible();
  await expect(champ(page)).toHaveValue("Un dernier message");
});

test("REQ074_parcours_38_choix_recharge_et_largeurs", async ({ page }) => {
  const opencode = fauxOpencode("texte");
  yaide = await lancerYaide({ opencode, claude: fauxClaude() });
  relais = await lancerRelais(yaide.port);
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, relais.origine);
  const modele = page.getByLabel("Modèle", { exact: true });
  const effort = page.getByLabel("Effort", { exact: true });
  const etat = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(opencode, "etat.json"), "utf8")).sessions;
    } catch {
      return {}; // fichier en cours d'écriture
    }
  };
  const modeleDe = () => Object.values(etat())[0]?.model;

  // 1. Le modèle par défaut et « Par défaut ».
  await boutonOpencode(page).click();
  await expect(champ(page)).toBeFocused();
  await expect(modele.locator("option:checked")).toHaveText("Claude Sonnet 4.5 · anthropic");
  await expect(effort.locator("option:checked")).toHaveText("Par défaut");
  await expect(modele.locator("option")).toHaveCount(3);

  // 2. Un effort, puis un modèle : le faux opencode reçoit les deux, l'effort revient à « Par défaut ».
  await effort.focus();
  await effort.selectOption("high");
  await expect.poll(modeleDe).toEqual({ id: "claude-sonnet-4-5", providerID: "anthropic", variant: "high" });
  await expect(effort).toBeFocused();
  await modele.selectOption({ label: "GPT-5 · openai" });
  await expect.poll(modeleDe).toEqual({ id: "gpt-5", providerID: "openai", variant: "default" });
  await expect(effort.locator("option:checked")).toHaveText("Par défaut");

  // 3. Le vrai rechargement : mêmes valeurs.
  await gardeContient(page, '"opencode":true'); // la liste des onglets est écrite avec un délai
  await page.reload();
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await expect(modele.locator("option:checked")).toHaveText("GPT-5 · openai");
  await expect(effort.locator("option:checked")).toHaveText("Par défaut");
  await expect(effort.locator("option")).toHaveText(["Par défaut", "low", "medium", "high"]);

  // 4. Un choix fait ailleurs (POST direct sur le faux opencode) : la liste change en direct, le focus ne bouge pas.
  const [ligneTemoin] = fs.readFileSync(path.join(opencode, "temoin"), "utf8").trim().split("\n").slice(-1);
  const port = JSON.parse(ligneTemoin).args[JSON.parse(ligneTemoin).args.indexOf("--port") + 1];
  const mdp = fs.readFileSync(path.join(opencode, "temoin.mdp"), "utf8");
  const id = Object.keys(etat())[0];
  await champ(page).focus();
  const r = await fetch(`http://127.0.0.1:${port}/api/session/${id}/model`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from("opencode:" + mdp).toString("base64"), "content-type": "application/json" },
    body: JSON.stringify({ model: { id: "claude-sonnet-4-5", providerID: "openrouter" } }),
  });
  expect(r.status).toBe(204);
  await expect(modele.locator("option:checked")).toHaveText("Claude Sonnet 4.5 · openrouter");
  await expect(effort).toBeDisabled();
  await expect(champ(page)).toBeFocused();

  // 5. Un tour qui reste ouvert, puis des largeurs d'éditeur exactes (panneau replié, agent déplié) : la barre ne
  // déborde pas, « Envoyer » et « Arrêter » sont entiers ; à 460 px « Effort » garde 104 px et « Modèle » rétrécit.
  await envoyer(page, "[scenario:question] Prépare la release.");
  await expect(page.getByRole("button", { name: "Arrêter" })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "Replier le panneau" }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const mesurer = (cible) => mesurerBarre(page, cible);
  const mesures = {};
  for (const cible of [720, 460, 320]) {
    const m = (mesures[cible] = await mesurer(cible));
    expect(m.deborde, `barre à ${cible}`).toBe(false);
    expect(m.envoyer, `Envoyer à ${cible}`).toBe(true);
    expect(m.arreter, `Arrêter à ${cible}`).toBe(true);
  }
  expect(Math.abs(mesures[460].effort - 104)).toBeLessThanOrEqual(0.151); // écart de 0,15 px signalé au design
  expect(Math.abs(mesures[720].effort - 104)).toBeLessThanOrEqual(0.151);
  expect(mesures[460].modele).toBeLessThan(mesures[720].modele - 1);
});

test("REQ075_REQ076_parcours_40_et_41_reprise_compteur_largeurs", async ({ page }) => {
  const dossier = depotExemple();
  const opencode = fauxOpencode("texte");
  yaide = await lancerYaide({ dossier, opencode, claude: fauxClaude() });
  relais = await lancerRelais(yaide.port);
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, relais.origine);
  const modele = page.getByLabel("Modèle", { exact: true }).and(page.locator(":visible"));
  const effort = page.getByLabel("Effort", { exact: true }).and(page.locator(":visible"));
  const compteur = page.locator(".session-saisie:visible .agent-compteur");
  const barre = page.locator(".session-saisie:visible > :last-child");
  const sessions = () => {
    try {
      return Object.values(JSON.parse(fs.readFileSync(path.join(opencode, "etat.json"), "utf8")).sessions);
    } catch {
      return []; // fichier en cours d'écriture
    }
  };
  const fichier = path.join(dossier, ".yaide", "opencode.json");

  // Sans fichier : la session part du modèle par défaut, le compteur est à zéro.
  await boutonOpencode(page).click();
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await expect(compteur).toHaveText("0 / 200 k · 0 %");
  expect(sessions()[0].model).toBeUndefined();

  // AC-075-1 : « high » est gardé dans le projet.
  await effort.selectOption("high");
  await expect.poll(() => fs.existsSync(fichier) && JSON.parse(fs.readFileSync(fichier, "utf8"))).toEqual({ id: "claude-sonnet-4-5", providerID: "anthropic", variant: "high" });

  // AC-075-3, -4, -11 : après un vrai rechargement, une nouvelle session reprend le choix, les listes le disent, focus dans le champ.
  await gardeContient(page, '"opencode":true');
  await page.reload();
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await boutonOpencode(page).click();
  await expect(onglet(page, "opencode 2")).toHaveAttribute("aria-selected", "true");
  await expect(modele.locator("option:checked")).toHaveText("Claude Sonnet 4.5 · anthropic");
  await expect(effort.locator("option:checked")).toHaveText("high");
  await expect(champ(page)).toBeFocused();
  expect(sessions().at(-1).model).toEqual({ id: "claude-sonnet-4-5", providerID: "anthropic", variant: "high" });

  // AC-076-1, -3 : « 15 k / 200 k · 8 % » en direct, le focus ne bouge pas.
  await envoyer(page, "[scenario:contexte] Dis bonjour.");
  await expect(compteur).toHaveText("15 k / 200 k · 8 %");
  await expect(champ(page)).toBeFocused();
  const couleur8 = await compteur.evaluate((e) => getComputedStyle(e).color);

  // AC-076-6 : GPT-5, la fenêtre change, pas les tokens.
  await modele.selectOption({ label: "GPT-5 · openai" });
  await expect(compteur).toHaveText("15 k / 400 k · 4 %");

  // AC-076-4 : le vrai rechargement relit la même valeur.
  await gardeContient(page, '"opencode":true');
  await page.reload();
  await expect(onglet(page, "opencode 2")).toHaveAttribute("aria-selected", "true");
  await expect(compteur).toHaveText("15 k / 400 k · 4 %");

  // AC-076-7 : fenêtre inconnue (openrouter) → pas de compteur, barre à 26 px.
  await modele.selectOption({ label: "Claude Sonnet 4.5 · openrouter" });
  await expect(compteur).toBeHidden();
  expect((await barre.boundingBox()).height).toBeCloseTo(26, 0);

  // Retour sur un modèle à fenêtre (200 k), puis un tour qui dépasse la fenêtre : « 210 k / 200 k · 105 % », même couleur qu'à 8 %.
  await modele.selectOption({ label: "Claude Sonnet 4.5 · anthropic" });
  await envoyer(page, "[scenario:depasse] Dis bonjour.");
  await expect(compteur).toHaveText("210 k / 200 k · 105 %");
  expect(await compteur.evaluate((e) => getComputedStyle(e).color)).toBe(couleur8);
  await page.getByRole("banner").getByRole("button", { name: "Replier le panneau" }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const avant = {};
  for (const cible of [559, 560]) avant[cible] = await mesurerBarre(page, cible);

  // Un tour reste ouvert (question en attente) : « Arrêter » est là.
  await envoyer(page, "[scenario:question] Prépare la release.");
  await expect(page.getByRole("button", { name: "Arrêter" })).toBeVisible();
  const pendant = {};
  for (const cible of [720, 560, 559, 320, 460]) pendant[cible] = await mesurerBarre(page, cible);

  const sous = (m) => m.rCompteur.y >= m.rEnvoyer.bas - 0.5;
  for (const [cible, m] of Object.entries(pendant)) {
    // AC-076-11 : rien ne déborde, tout est entier.
    expect(m.deborde, `barre à ${cible}`).toBe(false);
    expect([m.envoyer, m.arreter, m.compteurEntier], `Envoyer, Arrêter, compteur à ${cible}`).toEqual([true, true, true]);
    if (cible === "460") expect(m.modele, "Modèle à 460").toBeLessThan(280);
    if (cible >= 460) expect(Math.abs(m.effort - 104), `Effort à ${cible}`).toBeLessThanOrEqual(0.151);
    if (cible >= 560) {
      // AC-076-12 : sur la ligne d'« Envoyer », entre « Effort » et « Arrêter », barre à 26 px.
      expect(sous(m), `compteur sur la ligne à ${cible}`).toBe(false);
      expect(m.rCompteur.y < m.rEnvoyer.bas && m.rCompteur.bas > m.rEnvoyer.y).toBe(true);
      expect(m.rCompteur.x).toBeGreaterThanOrEqual(m.rEffort.droite - 0.5);
      expect(m.rCompteur.droite).toBeLessThanOrEqual(m.rArreter.x + 0.5);
      expect(m.barre.hauteur).toBeCloseTo(26, 0);
    } else {
      // AC-076-13 : au moins 4 px sous « Envoyer », bord droit de la barre à 1 px près.
      expect(m.rCompteur.y - m.rEnvoyer.bas, `compteur sous Envoyer à ${cible}`).toBeGreaterThanOrEqual(3.99);
      expect(Math.abs(m.rCompteur.droite - m.barre.droite), `bord droit à ${cible}`).toBeLessThanOrEqual(1);
    }
  }
  // AC-076-14 : le tour ne change pas la ligne du compteur.
  for (const cible of [559, 560]) expect(sous(pendant[cible]), `ligne avant et pendant le tour à ${cible}`).toBe(sous(avant[cible]));

  // AC-076-15 : fenêtre inconnue (openrouter) à 460 px, tour ouvert → pas de compteur, barre à 26 px.
  await modele.selectOption({ label: "Claude Sonnet 4.5 · openrouter" });
  await expect(compteur).toBeHidden();
  expect((await mesurerBarre(page, 460)).barre.hauteur).toBeCloseTo(26, 0);
  await modele.selectOption({ label: "Claude Sonnet 4.5 · anthropic" });
  await expect(compteur).toBeVisible();

  // La page ne défile pas à 800 × 480, et le compteur reste entier au-dessus du bas de l'éditeur, une question en attente, panneau à 240 px.
  await page.getByRole("button", { name: "Replier l'agent" }).click();
  await page.getByRole("banner").getByRole("button", { name: "Déplier le panneau" }).click();
  await page.setViewportSize({ width: 800, height: 480 });
  const d = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight }));
  await expect.poll(async () => { const m = await d(); return m.sw <= m.iw && m.sh <= m.ih; }, { message: JSON.stringify(await d()) }).toBe(true);
  await expect(demandes(page)).toContainText("opencode pose une question");
  await expect(compteur).toBeVisible();
  const bas = await compteur.evaluate((e) => ({ compteur: e.getBoundingClientRect().bottom, code: document.querySelector(".cadre-code").getBoundingClientRect().bottom }));
  expect(bas.compteur, `bas du compteur ${bas.compteur}, bas de l'éditeur ${bas.code}`).toBeLessThanOrEqual(bas.code + 0.5);
});

test("REQ077_parcours_42_44_arrivee_rechargement_nouvel_onglet", async ({ page, context }) => {
  const opencode = fauxOpencode("markdown", 500);
  yaide = await lancerYaide({ opencode, claude: fauxClaude() });
  relais = await lancerRelais(yaide.port);
  await page.setViewportSize({ width: 1280, height: 800 });
  await ouvrirYaide(page, relais.origine);
  const requetes = [];
  await context.route("https://exemple.org/**", (route) => {
    requetes.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "<title>exemple</title>" });
  });
  const reponse = page.locator(".session:visible .ya-chat-agent");
  const couleurAttendue = (nom) => page.evaluate((n) => { const d = document.createElement("i"); d.style.color = `var(${n})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, nom);

  await boutonOpencode(page).click();
  await expect(champ(page)).toBeFocused();
  await envoyer(page, "[scenario:markdown] Montre un tableau.");

  // AC-077-8 : la ligne d'en-tête reste du texte, puis le tableau apparaît ; le focus ne bouge pas.
  await expect(reponse).toContainText("| Nom | Valeur |", { timeout: 20000 });
  await expect(reponse.locator("table")).toHaveCount(0);
  await expect(champ(page)).toBeFocused();
  await expect(reponse.locator("table")).toHaveCount(1);
  await expect(reponse.locator("tbody tr")).toHaveCount(2);
  await expect(champ(page)).toBeFocused();
  await expect(reponse.locator("pre")).toContainText("fn main() {}");
  await expect(reponse.locator("a")).toHaveText("https://exemple.org/a");

  // AC-077-7, AC-077-8 : le vrai rechargement, sans fichier ouvert, même mise en forme et code coloré.
  await gardeContient(page, '"opencode":true');
  await page.reload();
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await expect(reponse.locator("table")).toHaveCount(1);
  expect(await page.locator(".cm-editor").count()).toBe(0);
  const fn = reponse.locator("pre span", { hasText: /^fn$/ });
  await expect(fn).toHaveCount(1);
  expect(await fn.evaluate((e) => getComputedStyle(e).color)).toBe(await couleurAttendue("--syn-keyword"));
  expect((await reponse.locator("th").first().evaluate((e) => getComputedStyle(e).borderTopWidth))).toBe("1px");

  // AC-077-26 : un brouillon dans le champ, clic sur l'adresse → un nouvel onglet ; Yaide garde adresse, onglet et brouillon.
  const adresse = page.url();
  await champ(page).fill("brouillon à garder");
  const [nouvelle] = await Promise.all([context.waitForEvent("page"), reponse.locator("a").click()]);
  await nouvelle.waitForLoadState();
  expect(nouvelle.url()).toBe("https://exemple.org/a");
  expect(requetes).toContain("https://exemple.org/a");
  expect(page.url()).toBe(adresse);
  await expect(onglet(page, "opencode 1")).toHaveAttribute("aria-selected", "true");
  await expect(champ(page)).toHaveValue("brouillon à garder");
  await nouvelle.close();
});

test("REQ072_AC31_AC32_bords_alignes_1200", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DEC-037 : Chromium seul");
  const opencode = fauxOpencode("markdown");
  yaide = await lancerYaide({ opencode, claude: fauxClaude() });
  relais = await lancerRelais(yaide.port);
  await page.setViewportSize({ width: 1600, height: 900 });
  await ouvrirYaide(page, relais.origine);
  await page.getByRole("banner").getByRole("button", { name: "Replier le panneau" }).click();
  await boutonOpencode(page).click();
  await expect(champ(page)).toBeFocused();
  const boite = async (locator) => {
    const b = await locator.boundingBox();
    return { gauche: b.x, droite: b.x + b.width, largeur: b.width };
  };
  const session = page.locator(".session:visible");
  const proche = (a, b, nom) => expect(Math.abs(a - b), nom).toBeLessThanOrEqual(1);

  // AC-072-32 : un tableau de 3 colonnes courtes, une citation et un bloc de code.
  await envoyer(page, "[scenario:markdown] Montre un tableau.");
  const reponse = session.locator(".ya-chat-agent");
  await expect(reponse.locator("pre")).toContainText("fn main() {}", { timeout: 20000 });
  await expect(reponse.locator("table")).toHaveCount(1);
  const saisie = await boite(champ(page));
  const editeur = await boite(page.locator("main.cadre-principal"));
  expect(Math.round(saisie.largeur)).toBe(1200);
  expect(Math.round(saisie.gauche - editeur.gauche)).toBe(152);
  const texte = await boite(reponse.locator("p").first());
  const tableau = await boite(reponse.locator("table"));
  expect(tableau.largeur).toBeLessThan(texte.largeur - 20);
  proche(tableau.gauche, texte.gauche, "tableau au bord du texte");
  expect(Math.round((await boite(reponse.locator("blockquote"))).largeur)).toBe(1200);
  expect(Math.round((await boite(reponse.locator("pre"))).largeur)).toBe(1200);

  // AC-072-31 : la réponse, « Envoyer » et « Modèle » suivent le champ.
  proche(texte.gauche, saisie.gauche, "réponse, bord gauche");
  proche(texte.droite, saisie.droite, "réponse, bord droit");
  const envoyerBtn = await boite(session.getByRole("button", { name: "Envoyer", exact: true }));
  proche(envoyerBtn.droite, saisie.droite, "Envoyer, bord droit");
  const modele = page.getByLabel("Modèle", { exact: true }).and(page.locator(":visible"));
  expect(Math.round((await boite(modele)).largeur)).toBe(280);

  // Une demande d'autorisation.
  await expect(page.getByRole("button", { name: "Arrêter" })).toHaveCount(0);
  await envoyer(page, "[scenario:outils] Écris les notes.");
  await expect(demandes(page)).toContainText("opencode demande une autorisation : shell.");
  const autorisation = await boite(demandes(page).locator(".ya-attente").first());
  proche(autorisation.gauche, saisie.gauche, "autorisation, bord gauche");
  proche(autorisation.droite, saisie.droite, "autorisation, bord droit");
  await page.getByRole("button", { name: "Autoriser une fois" }).click();
  await expect(page.getByText("Terminé.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrêter" })).toHaveCount(0);

  // Une question : ses deux premiers champs côte à côte, de même largeur.
  await envoyer(page, "[scenario:formulaire] Prépare la release.");
  await expect(demandes(page)).toContainText("opencode pose une question : Préparer la release.");
  const question = await boite(demandes(page).locator(".ya-attente").first());
  proche(question.gauche, saisie.gauche, "question, bord gauche");
  proche(question.droite, saisie.droite, "question, bord droit");
  const version = await boite(page.getByLabel("Version (obligatoire)"));
  const canal = await boite(page.getByLabel("Canal"));
  expect(canal.gauche).toBeGreaterThan(version.droite - 1);
  proche(canal.largeur, version.largeur, "deux champs de même largeur");

  // AC-072-21, panneau à 280 px : 12 px de marge de chaque côté, rien ne déborde.
  await page.getByRole("banner").getByRole("button", { name: "Déplier le panneau" }).first().click();
  const poignee = page.getByRole("separator", { name: "Largeur du panneau" });
  await poignee.focus();
  for (let i = 0; i < 60 && (await poignee.getAttribute("aria-valuenow")) !== "280"; i++) {
    await page.keyboard.press(Number(await poignee.getAttribute("aria-valuenow")) > 280 ? "ArrowLeft" : "ArrowRight");
  }
  await expect(poignee).toHaveAttribute("aria-valuenow", "280");
  // L'éditeur se met en place après le dépliage : on attend que la mise en page se pose.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  const mesure = await page.evaluate(() => {
    const d = document.documentElement;
    const zones = [...document.querySelectorAll(".session-contenu")].filter((z) => z.getClientRects().length);
    return {
      nombre: zones.length,
      marges: zones.map((z) => [getComputedStyle(z).paddingLeft, getComputedStyle(z).paddingRight]),
      defile: zones.map((z) => z.scrollWidth - z.clientWidth),
      page: [d.scrollWidth - innerWidth, d.scrollHeight - innerHeight],
    };
  });
  expect(mesure.nombre).toBeGreaterThanOrEqual(2);
  expect(mesure.marges).toEqual(Array(mesure.nombre).fill(["12px", "12px"]));
  expect(mesure.defile).toEqual(Array(mesure.nombre).fill(0));
  expect(mesure.page).toEqual([0, 0]);
  expect(Math.round((await boite(champ(page))).largeur)).toBe(1196);
});
