// Relevé du contrat d'opencode 2 : `node e2e/capturer-opencode.js` (à la main, hors de la suite).
// Lance le vrai `opencode serve`, isolé dans `.test-data/capture/` (HOME et XDG_*), avec un faux provider
// local : aucun appel réel, rien de la configuration ni des sessions de l'utilisateur n'est lu.
// Écrit un fichier par scénario dans `web/src/opencode-captures/`, rejoué par les tests de `opencode.js`.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(racine, ".test-data", "capture");
const sortie = path.join(racine, "web", "src", "opencode-captures");
const MOT_DE_PASSE = "capture";

// --- Version ---------------------------------------------------------------------------------

function verifierVersion() {
  let texte = "";
  try {
    texte = execFileSync("opencode", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    texte = "";
  }
  if (!/^opencode v2\./.test(texte)) {
    console.error(`opencode 2.x est exigé (trouvé : ${texte || "rien"}).`);
    process.exit(1);
  }
  return texte;
}

// --- Faux provider (format OpenAI, en streaming) -----------------------------------------------

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function texteDe(contenu) {
  if (typeof contenu === "string") return contenu;
  return (contenu ?? []).map((p) => p.text ?? "").join("");
}

/** Scénario du tour (marqueur `[scenario:xxx]` du premier message) et rang de l'étape (nombre de résultats d'outils déjà reçus). */
function lireTour(corps) {
  const premier = corps.messages.find((m) => m.role === "user");
  const marque = /\[scenario:(\w+)\]/.exec(texteDe(premier?.content));
  return { scenario: marque?.[1] ?? "", etape: corps.messages.filter((m) => m.role === "tool").length };
}

function fauxProvider(depot) {
  const demarreInterruption = { vu: false };
  const serveur = http.createServer((req, res) => {
    let brut = "";
    req.on("data", (d) => (brut += d));
    req.on("end", async () => {
      const corps = JSON.parse(brut || "{}");
      const systeme = texteDe(corps.messages?.[0]?.content);
      const { scenario, etape } = lireTour(corps);
      if (scenario === "refus") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Clé d'API invalide (faux provider)", type: "invalid_request_error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const envoyer = (delta, fin = null) =>
        res.write("data: " + JSON.stringify({ id: "faux", object: "chat.completion.chunk", created: 1, model: "faux-1", choices: [{ index: 0, delta, finish_reason: fin }] }) + "\n\n");
      const texte = async (morceaux, attente = 60, raisonnement = "") => {
        envoyer({ role: "assistant", content: "" });
        if (raisonnement) envoyer({ reasoning_content: raisonnement });
        for (const m of morceaux) {
          envoyer({ content: m });
          await pause(attente);
        }
        envoyer({}, "stop");
      };
      const outil = (nom, args) => {
        envoyer({ role: "assistant", content: null, tool_calls: [{ index: 0, id: `call_${scenario}_${etape}`, type: "function", function: { name: nom, arguments: JSON.stringify(args) } }] });
        envoyer({}, "tool_calls");
      };
      if (systeme.includes("You name conversations")) {
        await texte(["Session de capture"], 0);
      } else if (scenario === "texte") {
        await texte(["Voici ", "une **réponse** ", "en plusieurs ", "morceaux :\n\n", "- un\n", "- deux\n"], 60, "Je réfléchis à la réponse.");
      } else if (scenario === "outils") {
        if (etape === 0) {
          envoyer({ role: "assistant", content: "Je lis le fichier. " });
          outil("read", { path: path.join(depot, "LISEZMOI.md") });
        }
        else if (etape === 1) outil("read", { path: path.join(depot, "absent.md") });
        else if (etape === 2) outil("write", { path: path.join(depot, "NOTES.md"), content: "notes\n" });
        else if (etape === 3) outil("shell", { command: "echo bonjour" });
        else await texte(["Terminé."]);
      } else if (scenario === "sousagent") {
        if (etape === 0) outil("subagent", { agent: "explore", description: "Explorer le dépôt", prompt: "[scenario:enfant] Lance les tests." });
        else await texte(["Le sous-agent a fini."]);
      } else if (scenario === "enfant") {
        if (etape === 0) outil("shell", { command: "cargo test parse_args" });
        else await texte(["Exploration terminée."]);
      } else if (scenario === "question") {
        if (etape === 0) outil("question", {
            questions: [
              { question: "Quelle version publier ?", header: "Version", options: [{ label: "1.0", description: "Première" }, { label: "2.0", description: "Seconde" }] },
              { question: "Quelles plateformes cibler ?", header: "Plateformes", multiple: true, options: [{ label: "linux", description: "Linux" }, { label: "macos", description: "macOS" }] },
            ],
          });
        else await texte(["Merci."]);
      } else if (scenario === "interruption") {
        envoyer({ role: "assistant", content: "" });
        for (let i = 0; i < 100 && !res.destroyed; i++) {
          envoyer({ content: `morceau ${i} ` });
          demarreInterruption.vu = true;
          await pause(150);
        }
        envoyer({}, "stop");
      } else {
        await texte(["?"]);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((ok) => serveur.listen(0, "127.0.0.1", () => ok({ serveur, port: serveur.address().port, etat: demarreInterruption })));
}

// --- opencode ------------------------------------------------------------------------------------

function portLibre() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });
}

async function lancerOpencode(depot, portProvider) {
  const env = { ...process.env, OPENCODE_SERVER_PASSWORD: MOT_DE_PASSE };
  for (const [cle, dossier] of [["HOME", "home"], ["XDG_CONFIG_HOME", "config"], ["XDG_DATA_HOME", "data"], ["XDG_STATE_HOME", "state"], ["XDG_CACHE_HOME", "cache"]]) {
    fs.mkdirSync(path.join(base, dossier), { recursive: true });
    env[cle] = path.join(base, dossier);
  }
  fs.writeFileSync(
    path.join(depot, "opencode.jsonc"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: { faux: { npm: "@ai-sdk/openai-compatible", name: "Faux", options: { baseURL: `http://127.0.0.1:${portProvider}/v1`, apiKey: "faux" }, models: { "faux-1": { name: "Faux 1" } } } },
      model: "faux/faux-1",
      permission: { bash: "ask", shell: "ask" },
    }),
  );
  const port = await portLibre();
  const enfant = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: depot, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let journal = "";
  enfant.stdout.on("data", (d) => (journal += d));
  enfant.stderr.on("data", (d) => (journal += d));
  const adresse = `http://127.0.0.1:${port}`;
  const auth = "Basic " + Buffer.from(`opencode:${MOT_DE_PASSE}`).toString("base64");
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(adresse + "/api/info", { headers: { authorization: auth } })).ok) return { enfant, adresse, auth };
    } catch {
      // Pas encore prêt.
    }
    await pause(200);
  }
  console.error("opencode ne démarre pas :\n" + journal);
  process.kill(-enfant.pid);
  process.exit(1);
}

// --- Relevé --------------------------------------------------------------------------------------

async function main() {
  const version = verifierVersion();
  fs.rmSync(base, { recursive: true, force: true });
  const depot = path.join(base, "depot");
  fs.mkdirSync(depot, { recursive: true });
  fs.writeFileSync(path.join(depot, "LISEZMOI.md"), "# Dépôt d'exemple\n\nUn texte de capture.\n");
  execFileSync("git", ["init", "-q"], { cwd: depot });
  fs.mkdirSync(sortie, { recursive: true });

  const provider = await fauxProvider(depot);
  const oc = await lancerOpencode(depot, provider.port);
  const appeler = async (methode, chemin, corps) => {
    const r = await fetch(oc.adresse + chemin, { method: methode, headers: { authorization: oc.auth, ...(corps !== undefined ? { "content-type": "application/json" } : {}) }, body: corps !== undefined ? JSON.stringify(corps) : undefined });
    const texte = await r.text();
    let json = null;
    try {
      json = JSON.parse(texte);
    } catch {
      // Corps vide ou non JSON.
    }
    return { statut: r.status, json, texte };
  };

  // Un seul flux d'événements pour tout le relevé ; chaque scénario garde sa tranche.
  const evenements = [];
  const ctrl = new AbortController();
  (async () => {
    const r = await fetch(oc.adresse + "/api/event", { headers: { authorization: oc.auth }, signal: ctrl.signal });
    let tampon = "";
    const dec = new TextDecoder();
    for await (const morceau of r.body) {
      tampon += dec.decode(morceau, { stream: true });
      let i;
      while ((i = tampon.indexOf("\n\n")) >= 0) {
        const bloc = tampon.slice(0, i);
        tampon = tampon.slice(i + 2);
        const ligne = bloc.split("\n").find((l) => l.startsWith("data: "));
        if (ligne) evenements.push(JSON.parse(ligne.slice(6)));
      }
    }
  })().catch(() => {});

  async function scenario(nom, { message, pendant, demarrer, delai = 30000 }) {
    const debut = evenements.length;
    const cree = await appeler("POST", "/api/session", { location: { directory: depot } });
    const id = cree.json.data.id;
    if (demarrer) await demarrer({ id, appeler });
    else await appeler("POST", `/api/session/${id}/prompt`, { text: `[scenario:${nom}] ${message}` });
    const attentes = [];
    const reponses = [];
    const fin = Date.now() + delai;
    let ouvert = true;
    while (Date.now() < fin) {
      await pause(250);
      const sessions = [id, ...((await appeler("GET", `/api/session?parentID=${id}`)).json?.data ?? []).map((s) => s.id)];
      for (const sid of sessions) {
        for (const p of (await appeler("GET", `/api/session/${sid}/permission`)).json?.data ?? []) {
          attentes.push({ apresEvenement: evenements.length - debut, autorisation: p });
          const r = await appeler("POST", `/api/session/${sid}/permission/${p.id}/reply`, { decision: "once" });
          reponses.push({ autorisation: p.id, decision: "once", statut: r.statut });
        }
        for (const f of (await appeler("GET", `/api/session/${sid}/form`)).json?.data ?? []) {
          attentes.push({ apresEvenement: evenements.length - debut, formulaire: f });
          const reponse = pendant?.repondre ? pendant.repondre(f) : null;
          if (reponse) {
            const r = await appeler("POST", `/api/session/${sid}/form/${f.id}/reply`, { answer: reponse });
            reponses.push({ formulaire: f.id, answer: reponse, statut: r.statut, ...(r.statut >= 400 ? { corps: r.json } : {}) });
          } else {
            const r = await appeler("DELETE", `/api/session/${sid}/form/${f.id}`);
            reponses.push({ formulaire: f.id, ignore: true, statut: r.statut });
          }
        }
      }
      if (pendant?.action && ouvert) {
        ouvert = await pendant.action({ id, appeler, provider, evenements: evenements.slice(debut) });
      }
      const messages = (await appeler("GET", `/api/session/${id}/message?order=asc`)).json?.data ?? [];
      const dernier = messages[messages.length - 1];
      if (demarrer ? reponses.length >= 2 : dernier?.type === "idle" && (!pendant?.action || !ouvert)) break;
    }
    await pause(500);
    const filles = (await appeler("GET", `/api/session?parentID=${id}`)).json?.data ?? [];
    const messages = {};
    for (const sid of [id, ...filles.map((s) => s.id)]) messages[sid] = (await appeler("GET", `/api/session/${sid}/message?order=asc`)).json;
    const session = (await appeler("GET", `/api/session/${id}`)).json;
    const doc = {
      scenario: nom,
      version,
      racine: id,
      session,
      sessionsFilles: filles,
      evenements: evenements.slice(debut),
      messages,
      attentes,
      reponses,
      fichesApres: {
        autorisations: (await appeler("GET", `/api/session/${id}/permission`)).json,
        formulaires: (await appeler("GET", `/api/session/${id}/form`)).json,
      },
    };
    fs.writeFileSync(path.join(sortie, `${nom}.json`), JSON.stringify(doc, null, 1) + "\n");
    console.log(`${nom} : ${doc.evenements.length} événements, ${Object.keys(messages).length} session(s)`);
  }

  try {
    await scenario("texte", { message: "Dis bonjour." });
    await scenario("outils", { message: "Lis le fichier, puis lance une commande." });
    await scenario("sousagent", { message: "Explore le dépôt." });
    await scenario("question", {
      message: "Pose-moi une question.",
      pendant: {
        repondre: (f) => Object.fromEntries(f.fields.filter((c) => c.type !== "external").map((c) => [c.key, c.type === "boolean" ? true : c.type === "multiselect" ? [c.options?.[0]?.value ?? c.options?.[0]?.label ?? ""] : c.options?.[0]?.value ?? "valeur"])),
      },
    });
    await scenario("formulaire", {
      demarrer: async ({ id, appeler: app }) => {
        const champs = [
          { key: "version", title: "Version", description: "Numéro à publier.", type: "string", required: true, placeholder: "1.2.3" },
          { key: "canal", title: "Canal", type: "string", options: [{ value: "stable", label: "Stable" }, { value: "beta", label: "Bêta" }], default: "stable" },
          { key: "taille", title: "Taille", type: "integer", minimum: 1, maximum: 10 },
          { key: "ratio", title: "Ratio", type: "number" },
          { key: "notes", title: "Notes publiées", type: "boolean", default: true },
          { key: "cibles", title: "Cibles", type: "multiselect", options: [{ value: "linux", label: "Linux" }, { value: "macos", label: "macOS" }], minItems: 1, maxItems: 2 },
          { key: "doc", title: "Documentation", type: "external", url: "https://example.com/doc" },
        ];
        await app("POST", `/api/session/${id}/form`, { title: "Préparer la release", fields: champs });
        await app("POST", `/api/session/${id}/form`, { title: "Ignorée", fields: [{ key: "x", type: "string" }] });
      },
      pendant: { repondre: (f) => (f.title === "Ignorée" ? null : { version: "1.2.3", canal: "beta", notes: true, cibles: ["linux"], doc: true }) },
    });
    await scenario("interruption", {
      message: "Écris longuement.",
      pendant: {
        action: async ({ id, appeler: app, provider: p }) => {
          if (!p.etat.vu) return true;
          await pause(400);
          await app("POST", `/api/session/${id}/interrupt`);
          return false;
        },
      },
    });
    await scenario("refus", { message: "Réponds." });
  } finally {
    ctrl.abort();
    try {
      process.kill(-oc.enfant.pid, "SIGTERM");
    } catch {
      // Déjà arrêté.
    }
    provider.serveur.close();
    provider.serveur.closeAllConnections?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
