// Faux `opencode` pour les tests : sans dépendance, petit et lisible.
// Variables : FAUX_OPENCODE_VERSION, FAUX_OPENCODE_TEMOIN, FAUX_OPENCODE_ECHEC.
import http from "node:http";
import fs from "node:fs";

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
      if (req.method === "GET" && chemin === "/api/info") {
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
