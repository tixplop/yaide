import { expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

function portLibre() {
  return new Promise((res) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/** Crée un petit dépôt git d'exemple dans le dossier de test. */
export function depotExemple(nom = "projet") {
  const racine = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "depot-"));
  const dossier = path.join(racine, nom);
  fs.mkdirSync(path.join(dossier, "src"), { recursive: true });
  fs.writeFileSync(path.join(dossier, "src", "main.rs"), 'fn main() {\n    println!("salut");\n}\n');
  fs.writeFileSync(path.join(dossier, "README.md"), "# Titre\n\nDu texte.\n");
  const git = (...args) => spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", ...args], { cwd: dossier });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "départ");
  return dossier;
}

let dossiersSansAides;
/** `PATH` donné à Yaide : celui de la machine sans dossier qui contient un `claude` ou un `opencode`, et les dossiers de faux `claude` et `opencode` en tête s'ils sont donnés. */
function pathSansAides(claude, opencode) {
  dossiersSansAides ??= (process.env.PATH ?? "").split(path.delimiter).filter((d) => d && !fs.existsSync(path.join(d, "claude")) && !fs.existsSync(path.join(d, "opencode")));
  return [...(opencode ? [opencode] : []), ...(claude ? [claude] : []), ...dossiersSansAides].join(path.delimiter);
}

const modeles = new Map();
/** Le mot de passe est haché une fois par processus de test et par mot de passe, dans un dossier modèle ; chaque lancement en copie le fichier. */
function copierMotDePasse(motDePasse, exe, env, cible) {
  if (!modeles.has(motDePasse)) {
    const modele = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "mdp-"));
    const r = spawnSync(exe, ["passwd"], { input: `${motDePasse}\n`, env: { ...env, XDG_CONFIG_HOME: modele } });
    if (r.status !== 0) throw new Error(`yaide passwd a échoué (${r.status})`);
    modeles.set(motDePasse, path.join(modele, "yaide", "mot-de-passe"));
  }
  const source = modeles.get(motDePasse);
  fs.mkdirSync(cible, { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, path.join(cible, "mot-de-passe"));
  fs.chmodSync(path.join(cible, "mot-de-passe"), fs.statSync(source).mode);
}

/** Lance Yaide sur un port libre (ou `port`). `releases` : adresse des dernières releases (par défaut une adresse locale fermée) ; `outils` : dossier mis en tête du `PATH` (faux `curl`). `claude`, `opencode` : dossier d'un faux `claude` ou `opencode`, sinon aucun dans le `PATH`. Rend `{ origine, port, dossier, arreter, relancer }`. */
export async function lancerYaide({ motDePasse = "mdp", dossier = depotExemple(), port, shell = "/bin/sh", reprise = false, binaire, claude, opencode, releases = "http://127.0.0.1:9/", outils } = {}) {
  const imposé = port !== undefined;
  const racine = path.dirname(dossier);
  const home = path.join(racine, "home");
  fs.mkdirSync(home, { recursive: true });
  const cwd = binaire ? path.dirname(binaire) : undefined;
  const exe = binaire ?? "target/debug/yaide";
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(racine, "cfg"), HOME: home, PATH: pathSansAides(claude, opencode), YAIDE_URL_RELEASES: releases };
  if (outils) env.PATH = `${outils}${path.delimiter}${env.PATH}`;
  if (shell) env.SHELL = shell;
  if (!reprise) {
    if (binaire) spawnSync(exe, ["passwd"], { input: `${motDePasse}\n`, env, cwd });
    else copierMotDePasse(motDePasse, exe, env, path.join(racine, "cfg", "yaide"));
  }
  let proc, sorti, origine;
  for (let essai = 0; ; essai++) {
    if (!imposé) port = await portLibre();
    proc = spawn(exe, [dossier, "--port", String(port)], { stdio: ["ignore", "pipe", "ignore"], env, cwd });
    origine = `https://127.0.0.1:${port}`;
    // Prêt = la ligne « Yaide écoute sur le port » de notre propre processus (affichée après le bind) ;
    // sorti avant : le port était pris, on en reprend un autre.
    const issue = await new Promise((ok) => {
      let texte = "";
      const delai = setTimeout(() => ok("delai"), 10000);
      const fin = (r) => (clearTimeout(delai), ok(r));
      proc.stdout.on("data", (d) => {
        texte += d;
        if (texte.includes("Yaide écoute sur le port")) fin("pret");
      });
      proc.once("exit", () => fin("sorti"));
    });
    if (issue === "pret") {
      proc.stdout.resume();
      sorti = new Promise((ok) => (proc.exitCode !== null ? ok() : proc.once("exit", ok)));
      break;
    }
    proc.kill();
    if (issue === "delai") throw new Error(`Yaide n'écoute pas sur le port ${port}`);
    if (imposé || essai >= 5) throw new Error(`Yaide s'est arrêté au démarrage (port ${port})`);
  }
  return {
    origine,
    port,
    dossier,
    pid: proc.pid,
    /** SIGTERM, puis attend la fin du processus. */
    arreter: async () => {
      proc.kill();
      await sorti;
    },
    /** Arrête Yaide et le relance sur le même port, avec la même configuration. */
    relancer: async function () {
      await this.arreter();
      return lancerYaide({ motDePasse, dossier, port, shell, reprise: true, binaire, claude, opencode, releases, outils });
    },
  };
}

/**
 * Attend que le terminal visible ait la taille de sa zone, police chargée, et rend « lignes colonnes ».
 * L'ajustement suit la connexion ou un glissé de 100 ms au plus : avant, le terminal et le shell sont sur une mesure de passage.
 */
export async function tailleStable(page) {
  const lire = () =>
    page.evaluate(() => {
      const racine = document.querySelector(".terminal:not(.xterm):not([hidden])");
      const zone = racine?.querySelector(".terminal-zone");
      const ecran = zone?.querySelector(".xterm-screen");
      const defilement = zone?.querySelector(".xterm-viewport");
      if (!defilement || !ecran || !racine.querySelector(".terminal-attente").hidden) return null;
      if (!document.fonts.check('12.5px "JetBrains Mono"')) return null;
      const t = racine.term;
      const barre = defilement.offsetWidth - defilement.clientWidth;
      const lignes = Math.floor(zone.clientHeight / (ecran.offsetHeight / t.rows));
      const colonnes = Math.floor((zone.clientWidth - barre) / (ecran.offsetWidth / t.cols));
      return lignes === t.rows && colonnes === t.cols ? `${lignes} ${colonnes}` : null;
    });
  await expect.poll(lire).not.toBeNull();
  return lire();
}

/** Ouvre Yaide, se connecte et attend le premier shell. */
export async function ouvrirYaide(page, origine, motDePasse = "mdp", { shell = true } = {}) {
  await page.goto(origine + "/");
  await page.getByLabel("Mot de passe").fill(motDePasse);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Nouveau shell" }).waitFor();
  if (!shell) return;
  // Plus de shell d'office : on en ouvre un seulement si l'instance n'en a aucun.
  const { shells } = await page.evaluate(() => fetch("/api/shells").then((r) => r.json()));
  if (shells.length === 0) await page.getByRole("button", { name: "Nouveau shell" }).click();
  await page.getByRole("tab", { name: /^shell \d+$/ }).first().waitFor();
}

/** Nom accessible d'une ligne de l'arborescence : le nom, suivi éventuellement de son statut git (« main.rs, modifié »). */
export function nomLigne(nom) {
  return new RegExp(`^${nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(, [^,]+)*$`);
}

// Brouillon des onglets gardé dans IndexedDB (écrit après un délai) : `gardeContient` attend qu'il contienne `texte`.
const lireGarde = (page) =>
  page.evaluate(
    () =>
      new Promise((ok) => {
        const d = indexedDB.open("yaide", 1);
        d.onsuccess = () => {
          const r = d.result.transaction("cles").objectStore("cles").get("onglets");
          r.onsuccess = () => ok(JSON.stringify(r.result?.liste ?? []));
        };
      }),
  );
export const gardeContient = (page, texte) => expect.poll(() => lireGarde(page)).toContain(texte);

/** Glisser-déposer à la souris : presser sur `source`, puis `survoler` une cible ; `lacher` relâche. Le point `bas` d'un élément est son bord inférieur moins quelques pixels. */
export async function saisir(page, source) {
  const b = await source.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 6, b.y + b.height / 2 + 6, { steps: 3 });
}
export async function survoler(page, cible, { bas = false } = {}) {
  const b = await cible.boundingBox();
  await page.mouse.move(b.x + b.width / 2, bas ? b.y + b.height - 4 : b.y + b.height / 2, { steps: 8 });
}
export const lacher = (page) => page.mouse.up();

/** Fait avancer l'horloge de la page (installée avant l'ouverture) jusqu'à ce que `attente` réussisse. `limite` (ms de temps de la page) : l'attente doit avoir réussi quand ce temps est écoulé. */
export async function avancer(page, attente, { pas = 1500, timeout = 10000, limite } = {}) {
  const debut = limite === undefined ? 0 : await page.evaluate(() => Date.now());
  let echec;
  await expect(async () => {
    await page.clock.fastForward(pas);
    try {
      await attente();
    } catch (e) {
      if (limite === undefined || (await page.evaluate(() => Date.now())) - debut < limite) throw e;
      echec = e;
    }
  }).toPass({ timeout });
  if (echec) throw echec;
}

/** Témoin : un chemin sous TMPDIR, hors du projet. `attendre(t, suite)` donne une commande qui attend qu'il existe ; le test le crée au moment voulu. */
export const temoin = () => path.join(process.env.TMPDIR || os.tmpdir(), `temoin-${randomUUID()}`);
export const attendre = (t, suite) => `while [ ! -e "${t}" ]; do sleep 0.05; done; ${suite}`;

/** Faux GitHub : répond tout de suite que la dernière release est v0.9.2. Rend `{ url, fermer }` ; `url` va dans `releases` de `lancerYaide`. */
export async function fauxGithub() {
  const serveur = http.createServer((req, res) => {
    res.writeHead(302, { Location: "https://github.com/tixplop/yaide/releases/tag/v0.9.2", "Content-Length": 0 });
    res.end();
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${serveur.address().port}/`, fermer: () => serveur.close() };
}
