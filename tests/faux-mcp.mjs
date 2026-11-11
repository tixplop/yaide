// Faux serveur MCP (stdio, une ligne JSON-RPC par message) pour les tests, sans dépendance.
// Options `--nom` ou `--nom=valeur` :
//   --outils=a,b       outils offerts (défaut : dire) ; `dire` rend « dit: <texte> »
//   --note=<fichier>   ajoute au démarrage une ligne JSON { pid, cwd, argv, env }
//   --delai=<ms>       attend avant de répondre à un appel
//   --erreur           l'appel rend isError: true et le texte « boum »
//   --image            l'appel rend une image image/png
//   --ressource        l'appel rend la ressource file:///x.txt
//   --long=<n>         l'appel rend n caractères
//   --quitter=<code>   écrit 25 lignes sur stderr et quitte au démarrage avec ce code
//   --muet             ne répond jamais à initialize
//   --mourir           quitte (code 3) à l'arrivée d'un appel
//   --ignorer-term     ignore SIGTERM
//   --enfant=<fichier> lance un `sh` qui ignore SIGTERM, son PID est écrit dans le fichier
import fs from "node:fs";
import readline from "node:readline";
import { spawn } from "node:child_process";

const opts = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) opts[m[1]] = m[2] ?? true;
}

if (opts.note) {
  fs.appendFileSync(
    opts.note,
    JSON.stringify({ pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(2), env: process.env }) + "\n",
  );
}
if (opts.quitter !== undefined) {
  for (let i = 1; i <= 25; i++) process.stderr.write(`erreur ${i}\n`);
  process.exit(Number(opts.quitter));
}
if (opts["ignorer-term"]) process.on("SIGTERM", () => {});
if (opts.enfant) {
  spawn("sh", ["-c", `trap '' TERM; echo $$ > '${opts.enfant}'; while :; do sleep 1; done`], { stdio: "ignore" });
}

const envoyer = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const noms = String(opts.outils ?? "dire").split(",");

async function appel(id, params) {
  if (opts.mourir) process.exit(3);
  if (opts.delai) await pause(Number(opts.delai));
  let content;
  let isError = false;
  if (opts.erreur) {
    content = [{ type: "text", text: "boum" }];
    isError = true;
  } else if (opts.image) {
    content = [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }];
  } else if (opts.ressource) {
    content = [{ type: "resource", resource: { uri: "file:///x.txt", mimeType: "text/plain", text: "contenu" } }];
  } else if (opts.long) {
    content = [{ type: "text", text: "x".repeat(Number(opts.long)) }];
  } else {
    content = [{ type: "text", text: `dit: ${params.arguments?.texte ?? ""}` }];
  }
  envoyer({ id, result: { content, isError } });
}

readline.createInterface({ input: process.stdin }).on("line", (ligne) => {
  let m;
  try {
    m = JSON.parse(ligne);
  } catch {
    return;
  }
  if (m.method === "initialize") {
    if (opts.muet) return;
    envoyer({
      id: m.id,
      result: {
        protocolVersion: m.params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "faux-mcp", version: "1" },
      },
    });
  } else if (m.method === "tools/list") {
    envoyer({
      id: m.id,
      result: {
        tools: noms.map((nom) => ({
          name: nom,
          description: `Outil ${nom} du faux serveur`,
          inputSchema: { type: "object", properties: { texte: { type: "string" } } },
        })),
      },
    });
  } else if (m.method === "tools/call") {
    appel(m.id, m.params);
  } else if (m.method === "ping") {
    envoyer({ id: m.id, result: {} });
  }
});
