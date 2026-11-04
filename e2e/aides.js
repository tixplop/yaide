import { expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

/** Lance Yaide sur un port libre (ou `port`). Rend `{ origine, port, dossier, arreter, relancer }`. */
export async function lancerYaide({ motDePasse = "mdp", dossier = depotExemple(), port, shell, reprise = false, binaire } = {}) {
  port ??= await portLibre();
  const racine = path.dirname(dossier);
  const home = path.join(racine, "home");
  fs.mkdirSync(home, { recursive: true });
  const cwd = binaire ? path.dirname(binaire) : undefined;
  const exe = binaire ?? "target/debug/yaide";
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(racine, "cfg"), HOME: home };
  if (shell) env.SHELL = shell;
  if (!reprise) spawnSync(exe, ["passwd"], { input: `${motDePasse}\n`, env, cwd });
  const proc = spawn(exe, [dossier, "--port", String(port)], { stdio: "ignore", env, cwd });
  const sorti = new Promise((ok) => proc.once("exit", ok));
  const origine = `https://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      await new Promise((ok, ko) => {
        const s = net.connect(port, "127.0.0.1", () => (s.destroy(), ok()));
        s.on("error", ko);
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
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
      return lancerYaide({ motDePasse, dossier, port, shell, reprise: true, binaire });
    },
  };
}

/** Ouvre Yaide, se connecte et attend le premier shell. */
export async function ouvrirYaide(page, origine, motDePasse = "mdp") {
  await page.goto(origine + "/");
  await page.getByLabel("Mot de passe").fill(motDePasse);
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "shell 1" }).waitFor();
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
