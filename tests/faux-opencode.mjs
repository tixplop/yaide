// Faux `opencode` pour les tests : sans dépendance, petit et lisible.
// Variables : FAUX_OPENCODE_VERSION, FAUX_OPENCODE_TEMOIN, FAUX_OPENCODE_ECHEC.
// Arrêt (REQ-073) : FAUX_OPENCODE_SIGNAUX=ignorer ignore SIGHUP et SIGTERM ; FAUX_OPENCODE_DETACHE=1 lance au `serve`
// un `sh` dans sa propre session qui ignore HUP et TERM (PID dans <témoin>.detache) ; FAUX_OPENCODE_MEMBRE=1 lance
// de même un `sh` dans le groupe (PID dans <témoin>.membre) et quitte sur SIGTERM ; FAUX_OPENCODE_LENT=1 n'écoute
// jamais (lancement qui n'aboutit pas).
// Avec FAUX_OPENCODE_ETAT (fichier JSON des sessions, gardé entre deux lancements), il rejoue un scénario relevé
// sur le vrai opencode (`web/src/opencode-captures/`) à chaque message : FAUX_OPENCODE_SCENARIO le choisit
// (`[scenario:xxx]` dans le message l'emporte), FAUX_OPENCODE_PAS (ms) espace les événements.
// Une autorisation ou une question en attente bloque la suite jusqu'à sa réponse, « interrupt » arrête un tour
// interrompu dans le relevé, et l'outil `write` écrit son fichier dans le dossier du projet.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const CAPTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "src", "opencode-captures");
const ETAT = process.env.FAUX_OPENCODE_ETAT;
const PAS = Number(process.env.FAUX_OPENCODE_PAS ?? 25);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (res, statut, corps) => res.writeHead(statut, { "content-type": "application/json" }).end(JSON.stringify(corps));

// --- Mode scénario ---------------------------------------------------------------------------------

/** id de session → { id, parentID, agent, title, directory, messages, permissions, forms }. */
let sessions = {};
let tours = 0;
const abonnes = new Set();
const attentes = new Map(); // id d'une autorisation ou d'une question → { fin, ok }
const interruptions = new Map(); // id de session → { fait, ok }
const chaines = new Map(); // id de session → promesse du dernier tour

function charger() {
  try {
    ({ sessions, tours } = JSON.parse(fs.readFileSync(ETAT, "utf8")));
  } catch {
    sessions = {};
    tours = 0;
  }
}
const garder = () => fs.writeFileSync(ETAT, JSON.stringify({ sessions, tours }));

function diffuser(ev) {
  for (const res of abonnes) res.write(`data: ${JSON.stringify(ev)}\n\n`);
}

const donneesSession = (s) => ({
  id: s.id,
  projectID: "global",
  ...(s.parentID ? { parentID: s.parentID, agent: s.agent } : {}),
  title: s.title ?? "",
  time: { created: 1, updated: 1 },
  location: { directory: s.directory },
  ...(s.model ? { model: s.model } : {}),
});

// Modèles de P-038 (REQ-074), plus un modèle inactif.
const MODELES = [
  { id: "claude-sonnet-4-5", providerID: "anthropic", name: "Claude Sonnet 4.5", enabled: true, variants: [{ id: "low" }, { id: "high" }, { id: "max" }], limit: { context: 200000, output: 64000 } },
  { id: "gpt-5", providerID: "openai", name: "GPT-5", enabled: true, variants: [{ id: "low" }, { id: "medium" }, { id: "high" }], limit: { context: 400000, output: 128000 } },
  { id: "claude-sonnet-4-5", providerID: "openrouter", name: "Claude Sonnet 4.5", enabled: true, variants: [], limit: { context: 0, output: 0 } },
  { id: "cache", providerID: "anthropic", name: "Caché", enabled: false, variants: [], limit: { context: 0, output: 0 } },
];

/** Le relevé du scénario, ses identifiants réécrits : ceux de la session racine sont donnés, les autres sont neufs. */
function lireScenario(nom, racine, directory) {
  // `contexte` et `depasse` : le relevé `texte`, avec les tokens d'AC-076-1 (15 000 en tout) ou 210 000 (AC-076-8) sur la réponse et sur la fin du pas.
  // `markdown` : le relevé `texte`, avec une réponse en deux morceaux, le premier coupé après la ligne d'en-tête d'un tableau (AC-077-8).
  const relevé = fs.readFileSync(path.join(CAPTURES, `${/^(contexte|depasse|markdown)$/.test(nom) ? "texte" : nom}.json`), "utf8");
  const doc = JSON.parse(relevé);
  if (nom === "markdown") {
    const morceaux = ["Voici un tableau :\n\n| Nom | Valeur |\n", "|---|---|\n| a | 1 |\n| b | 2 |\n\n```rust\nfn main() {}\n```\n\nVoir https://exemple.org/a.\n"];
    const complet = morceaux.join("");
    let rang = 0;
    doc.evenements = doc.evenements.filter((ev) => {
      if (ev.type === "session.text.delta") return rang++ < morceaux.length && !!(ev.data.delta = morceaux[rang - 1]);
      if (ev.type === "session.text.ended") ev.data.text = complet;
      return true;
    });
    for (const liste of Object.values(doc.messages)) for (const m of liste.data) if (m.type === "assistant") for (const c of m.content) if (c.type === "text") c.text = complet;
  }
  if (nom === "contexte" || nom === "depasse") {
    const tokens = nom === "contexte" ? { input: 10000, output: 1500, reasoning: 500, cache: { read: 3000, write: 0 } } : { input: 200000, output: 5000, reasoning: 0, cache: { read: 5000, write: 0 } };
    for (const liste of Object.values(doc.messages)) for (const m of liste.data) if (m.type === "assistant") m.tokens = tokens;
    for (const ev of doc.evenements) if (ev.type === "session.step.ended") ev.data.tokens = tokens;
  }
  const brut = JSON.stringify(doc);
  const ids = new Map([[doc.racine, racine]]);
  const capture = doc.session.data.location.directory;
  const texte = brut.split(JSON.stringify(capture).slice(1, -1)).join(JSON.stringify(directory).slice(1, -1));
  const neuf = texte.replace(/\b(ses|msg|evt|per|frm|sh|call)_[A-Za-z0-9_]+/g, (m, pre) => {
    if (!ids.has(m)) ids.set(m, `${pre}_t${tours}x${ids.size}`);
    return ids.get(m);
  });
  return JSON.parse(neuf);
}

const copie = (x) => JSON.parse(JSON.stringify(x));

async function attendre(id) {
  const a = attentes.get(id);
  if (a) await a.fin;
}

/** Rejoue le relevé : l'historique et les demandes de l'API suivent les événements. */
async function rejouer(racine, nom, texte) {
  const s = sessions[racine];
  tours++;
  const doc = lireScenario(nom, racine, s.directory);
  const modeles = {}; // id de message → message du relevé
  const idles = {};
  for (const [sid, liste] of Object.entries(doc.messages)) {
    for (const m of liste.data) {
      if (m.type === "idle") (idles[sid] ??= []).push(m);
      else modeles[m.id] = m;
    }
  }
  const rangIdle = {};
  const enCours = {}; // id de message → message écrit dans l'historique
  const noms = {};
  const interruption = {};
  interruption.fait = new Promise((ok) => (interruption.ok = ok));
  interruptions.set(racine, interruption);
  for (const ev of doc.evenements) {
    if (!/^(session|permission|form|shell)\./.test(ev.type) || !ev.data) continue;
    const d = ev.data;
    const sid = d.sessionID ?? d.form?.sessionID;
    if (ev.type === "session.created") {
      if (sid === racine) continue;
      const f = doc.sessionsFilles.find((x) => x.id === sid);
      sessions[sid] = { id: sid, parentID: d.parentID, agent: d.agent ?? f?.agent, title: d.title, directory: s.directory, messages: [], permissions: [], forms: [] };
    }
    await pause(PAS);
    const cible = sessions[sid];
    // Les réponses n'arrivent qu'après celle qui les attend ; l'interruption, après la demande d'arrêt.
    if (ev.type === "permission.replied") await attendre(d.requestID);
    if (ev.type === "form.replied" || ev.type === "form.cancelled") await attendre(d.id);
    if (ev.type === "session.step.failed" && d.error?.type === "aborted") await interruption.fait;
    switch (ev.type) {
      case "session.renamed":
        cible.title = d.title;
        break;
      case "session.inbox.enqueued":
        if (sid === racine) {
          modeles[d.inboxID].text = texte;
          d.item.payload.text = texte;
        }
        cible.messages.push(copie(modeles[d.inboxID]));
        break;
      case "session.step.started":
        enCours[d.assistantMessageID] = { ...copie(modeles[d.assistantMessageID]), content: [] };
        delete enCours[d.assistantMessageID].time.completed;
        for (const c of ["finish", "rawFinish", "error"]) delete enCours[d.assistantMessageID][c];
        cible.messages.push(enCours[d.assistantMessageID]);
        break;
      case "session.text.started":
        enCours[d.assistantMessageID].content.push({ type: "text", text: "" });
        break;
      case "session.text.delta": {
        const textes = enCours[d.assistantMessageID].content.filter((p) => p.type === "text");
        textes[d.ordinal].text += d.delta;
        break;
      }
      case "session.tool.input.started":
        noms[d.id] = d.name;
        enCours[d.assistantMessageID].content.push({ type: "tool", id: d.id, name: d.name, state: { status: "running", input: {} } });
        break;
      case "session.tool.called": {
        const part = enCours[d.assistantMessageID].content.find((p) => p.id === d.id);
        part.state.input = d.input;
        if (noms[d.id] === "write" && d.input?.path) {
          fs.mkdirSync(path.dirname(d.input.path), { recursive: true });
          fs.writeFileSync(d.input.path, d.input.content ?? "");
        }
        break;
      }
      case "session.step.ended":
      case "session.step.failed": {
        const final = modeles[d.assistantMessageID];
        const i = cible.messages.indexOf(enCours[d.assistantMessageID]);
        enCours[d.assistantMessageID] = copie(final);
        cible.messages[i] = enCours[d.assistantMessageID];
        break;
      }
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const idle = idles[sid]?.[rangIdle[sid] ?? 0];
        rangIdle[sid] = (rangIdle[sid] ?? 0) + 1;
        if (idle) cible.messages.push(copie(idle));
        break;
      }
      case "permission.asked":
        cible.permissions.push(d);
        attentes.set(d.id, {});
        attentes.get(d.id).fin = new Promise((ok) => (attentes.get(d.id).ok = ok));
        break;
      case "form.created":
        cible.forms.push(d.form);
        attentes.set(d.form.id, {});
        attentes.get(d.form.id).fin = new Promise((ok) => (attentes.get(d.form.id).ok = ok));
        break;
      default:
    }
    garder();
    diffuser(ev);
  }
}

function resoudre(id) {
  attentes.get(id)?.ok();
}

function gerer(req, res, chemin, url) {
  const morceaux = [];
  req.on("data", (m) => morceaux.push(m));
  req.on("end", () => {
    let corps = {};
    try {
      corps = JSON.parse(Buffer.concat(morceaux).toString() || "{}");
    } catch {
      // Corps vide ou illisible.
    }
    let m;
    if (req.method === "GET" && chemin === "/api/info") {
      json(res, 200, {});
    } else if (req.method === "GET" && chemin === "/api/event") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"server.connected","data":{}}\n\n');
      abonnes.add(res);
      res.on("close", () => abonnes.delete(res));
    } else if (req.method === "GET" && chemin === "/api/model") {
      json(res, 200, { data: MODELES });
    } else if (req.method === "GET" && chemin === "/api/model/default") {
      json(res, 200, { data: { id: "claude-sonnet-4-5", providerID: "anthropic", limit: { context: 200000, output: 64000 } } });
    } else if (req.method === "POST" && chemin === "/api/session") {
      const id = `ses_n${Date.now().toString(36)}${Object.keys(sessions).length}`;
      sessions[id] = { id, title: "", directory: corps.location?.directory ?? process.cwd(), messages: [], permissions: [], forms: [] };
      garder();
      json(res, 200, { data: donneesSession(sessions[id]) });
    } else if (req.method === "GET" && chemin === "/api/session") {
      const parent = url.searchParams.get("parentID");
      json(res, 200, { data: Object.values(sessions).filter((s) => !parent || s.parentID === parent).map(donneesSession) });
    } else if ((m = /^\/api\/session\/([^/]+)(\/.*)?$/.exec(chemin))) {
      const s = sessions[decodeURIComponent(m[1])];
      const suite = m[2] ?? "";
      let r;
      if (!s) res.writeHead(404).end();
      else if (req.method === "GET" && suite === "") json(res, 200, { data: donneesSession(s) });
      else if (req.method === "GET" && suite === "/message") json(res, 200, { data: copie(s.messages), cursor: { previous: null, next: null } });
      else if (req.method === "GET" && suite === "/permission") json(res, 200, { data: s.permissions });
      else if (req.method === "GET" && suite === "/form") json(res, 200, { data: s.forms });
      else if (req.method === "POST" && suite === "/model") {
        s.model = { ...corps.model, variant: corps.model?.variant ?? "default" };
        garder();
        diffuser({ type: "session.model.selected", data: { sessionID: s.id, model: s.model } });
        res.writeHead(204).end();
      } else if (req.method === "POST" && suite === "/prompt") {
        const marque = /\[scenario:(\w+)\]/.exec(corps.text ?? "");
        const nom = marque?.[1] ?? process.env.FAUX_OPENCODE_SCENARIO ?? "texte";
        chaines.set(s.id, (chaines.get(s.id) ?? Promise.resolve()).then(() => rejouer(s.id, nom, (corps.text ?? "").replace(/\[scenario:\w+\]\s*/, ""))).catch((e) => console.error(e)));
        res.writeHead(204).end();
      } else if (req.method === "POST" && suite === "/interrupt") {
        interruptions.get(s.id)?.ok();
        res.writeHead(204).end();
      } else if (req.method === "POST" && (r = /^\/permission\/([^/]+)\/reply$/.exec(suite))) {
        s.permissions = s.permissions.filter((p) => p.id !== r[1]);
        garder();
        resoudre(r[1]);
        res.writeHead(204).end();
      } else if ((r = /^\/form\/([^/]+)(\/reply)?$/.exec(suite)) && (req.method === "DELETE" || (req.method === "POST" && r[2]))) {
        s.forms = s.forms.filter((f) => f.id !== r[1]);
        garder();
        resoudre(r[1]);
        res.writeHead(204).end();
      } else res.writeHead(404).end();
    } else res.writeHead(404).end();
  });
}

const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log(process.env.FAUX_OPENCODE_VERSION ?? "opencode v2.2.5");
  process.exit(0);
}

if (args[0] === "serve") {
  if (process.env.FAUX_OPENCODE_ECHEC === "1") {
    console.error("Erreur : opencode ne peut pas démarrer");
    process.exit(1);
  }
  const mdp = process.env.OPENCODE_SERVER_PASSWORD ?? "";
  const temoin = process.env.FAUX_OPENCODE_TEMOIN;
  if (temoin) {
    const ligne = { args, cwd: process.cwd(), mdp: mdp !== "", pid: process.pid };
    fs.appendFileSync(temoin, JSON.stringify(ligne) + "\n");
    fs.writeFileSync(temoin + ".mdp", mdp);
  }
  if (process.env.FAUX_OPENCODE_SIGNAUX === "ignorer") {
    for (const sig of ["SIGHUP", "SIGTERM"]) process.on(sig, () => {});
  }
  const sourd = (fichier, detache) => {
    const script = `trap '' HUP TERM; echo $$ >> '${fichier}'; while :; do sleep 1; done`;
    spawn("sh", ["-c", script], { detached: detache, stdio: "ignore" }).unref();
  };
  if (temoin && process.env.FAUX_OPENCODE_DETACHE === "1") sourd(temoin + ".detache", true);
  if (temoin && process.env.FAUX_OPENCODE_MEMBRE === "1") {
    sourd(temoin + ".membre", false);
    process.on("SIGTERM", () => process.exit(0));
  }
  if (process.env.FAUX_OPENCODE_LENT === "1") setInterval(() => {}, 1000);
  else serveur(mdp, args);
}

function serveur(mdp, args) {
  if (ETAT) charger();
  const attendu = "Basic " + Buffer.from("opencode:" + mdp).toString("base64");
  const port = Number(args[args.indexOf("--port") + 1]);
  const hote = args[args.indexOf("--hostname") + 1];

  http
    .createServer((req, res) => {
      if (req.headers.authorization !== attendu) {
        res.writeHead(401).end();
        return;
      }
      const chemin = req.url.split("?")[0];
      if (ETAT) gerer(req, res, chemin, new URL(req.url, "http://x"));
      else if (req.method === "GET" && chemin === "/api/info") {
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } else if (req.method === "GET" && chemin === "/api/event") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"n":1}\n\n');
        setTimeout(() => res.write('data: {"n":2}\n\n'), 1000);
      } else if (chemin === "/api/session" || chemin === "/api/echo") {
        const morceaux = [];
        req.on("data", (m) => morceaux.push(m));
        req.on("end", () => {
          const corps = Buffer.concat(morceaux).toString();
          const type = req.headers["content-type"] ?? "text/plain";
          if (chemin === "/api/session") {
            res.writeHead(200, { "content-type": type }).end(corps);
          } else {
            const secret = req.headers["x-secret"] ?? null;
            const rep = { methode: req.method, url: req.url, type, corps, secret };
            res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(rep));
          }
        });
      } else if (chemin.startsWith("/api/echo/")) {
        res.writeHead(200, { "content-type": "text/plain" }).end(req.url);
      } else {
        res.writeHead(404).end();
      }
    })
    .listen(port, hote);
}
