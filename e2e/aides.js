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

/** Lance Yaide sur un port libre. Rend `{ origine, port, dossier, arreter }`. */
export async function lancerYaide({ motDePasse = "mdp", dossier = depotExemple() } = {}) {
  const port = await portLibre();
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(path.dirname(dossier), "cfg") };
  spawnSync("target/debug/yaide", ["passwd"], { input: `${motDePasse}\n`, env });
  const proc = spawn("target/debug/yaide", [dossier, "--port", String(port)], { stdio: "ignore", env });
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
  return { origine, port, dossier, arreter: () => proc.kill() };
}
