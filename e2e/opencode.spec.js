import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { depotExemple, lancerYaide, nomLigne, ouvrirYaide, avancer } from "./aides.js";
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
function fauxOpencode(scenario) {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "faux-opencode-"));
  const script = `#!/bin/sh
export FAUX_OPENCODE_ETAT='${bin}/etat.json' FAUX_OPENCODE_SCENARIO='${scenario}' FAUX_OPENCODE_TEMOIN='${bin}/temoin'
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
  expect(mesures.largeur).toBeLessThanOrEqual(720 + 2 * 12 + 1);

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
