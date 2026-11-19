import http from "node:http";

/** Réponse Anthropic : du texte, des appels d'outil, et les tokens comptés (entrée + sortie). `raisonnement` (avec `signature`) ajoute en tête un bloc `thinking`, `masque` un bloc `redacted_thinking`. */
export function reponse({ texte = "", outils = [], tokens = 100, raisonnement, signature = "sig", masque } = {}) {
  const content = [];
  if (raisonnement) content.push({ type: "thinking", thinking: raisonnement, signature });
  if (masque) content.push({ type: "redacted_thinking", data: masque });
  if (texte) content.push({ type: "text", text: texte });
  for (const o of outils) content.push({ type: "tool_use", id: o.id, name: o.nom, input: o.entree });
  return { statut: 200, corps: { id: "msg", type: "message", role: "assistant", content, stop_reason: outils.length ? "tool_use" : "end_turn", usage: { input_tokens: tokens - 10, output_tokens: 10 } } };
}

/**
 * Réponse Anthropic en flux d'événements (`message_start`, `content_block_*`, `message_delta`, `message_stop`, `error`).
 * `morceaux` : `{ raisonnement }`, `{ texte }`, `{ outil: { id, nom, entree } }` ou `{ erreur: { type, message } }`, dans l'ordre ;
 * un morceau portant `retenir` (une promesse) n'est envoyé qu'une fois la promesse tenue.
 */
export function reponseFlux({ morceaux = [], tokens = 100 } = {}) {
  const sse = (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
  const envois = [];
  let index = -1;
  let genre = null;
  const fermer = () => (genre ? [{ type: "content_block_stop", index }] : []);
  for (const m of morceaux) {
    const evenements = envois.length ? [] : [{ type: "message_start", message: { id: "msg", type: "message", role: "assistant", content: [], usage: { input_tokens: tokens - 10, output_tokens: 1 } } }];
    if (m.erreur) {
      evenements.push({ type: "error", error: m.erreur });
    } else if (m.outil) {
      evenements.push(...fermer(), { type: "content_block_start", index: ++index, content_block: { type: "tool_use", id: m.outil.id, name: m.outil.nom, input: {} } }, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(m.outil.entree) } });
      genre = "outil";
    } else {
      const nouveau = m.raisonnement !== undefined ? "raisonnement" : "texte";
      if (genre !== nouveau) {
        evenements.push(...fermer(), { type: "content_block_start", index: ++index, content_block: nouveau === "texte" ? { type: "text", text: "" } : { type: "thinking", thinking: "", signature: "" } });
        genre = nouveau;
      }
      evenements.push({ type: "content_block_delta", index, delta: nouveau === "texte" ? { type: "text_delta", text: m.texte } : { type: "thinking_delta", thinking: m.raisonnement } });
    }
    envois.push({ retenir: m.retenir, texte: evenements.map(sse).join("") });
  }
  const fin = [...fermer(), { type: "message_delta", delta: { stop_reason: morceaux.some((m) => m.outil) ? "tool_use" : "end_turn" }, usage: { output_tokens: 10 } }, { type: "message_stop" }];
  if (!morceaux.at(-1)?.erreur) envois.push({ texte: fin.map(sse).join("") });
  return { statut: 200, flux: envois };
}

/** Réponse d'erreur du provider (par exemple 429). */
export function erreur(statut, type, message) {
  return { statut, corps: { type: "error", error: { type, message } } };
}

/** Vecteur de 64 dimensions : sac de mots hachés (FNV-1a), normalisé ; deux textes aux mots communs sont proches. */
export function vecteurDeTexte(texte) {
  const v = new Array(64).fill(0);
  for (const mot of String(texte).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261;
    for (const c of mot) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
    v[h % 64] += 1;
  }
  const norme = Math.hypot(...v) || 1;
  return v.map((x) => x / norme);
}

/**
 * Faux provider au format Anthropic, sur un port libre. `etapes` : les réponses, servies dans l'ordre
 * (la dernière est répétée) ; une étape peut porter `retenir` (une promesse) : la réponse attend qu'elle soit tenue ; `reponseFlux` donne une étape en flux d'événements. Sa route `/embeddings` (format OpenAI) rend un vecteur par texte (`vecteurDeTexte`) ; `embeddings` garde ses corps. Rend `{ adresse, recues, embeddings, arreter }` ; `recues` garde `{ chemin, entetes, corps }`.
 */
export async function lancerFauxProvider(etapes = []) {
  const recues = [];
  const embeddings = [];
  const serveur = http.createServer((req, res) => {
    let brut = "";
    req.on("data", (d) => (brut += d));
    req.on("end", async () => {
      let corps = null;
      try {
        corps = JSON.parse(brut);
      } catch {
        // Corps illisible : gardé à null.
      }
      if (req.url === "/embeddings") {
        // Route de la base de connaissance : un vecteur par texte, hors du scénario `etapes`.
        embeddings.push(corps);
        const data = [].concat(corps?.input ?? []).map((t, index) => ({ index, embedding: vecteurDeTexte(t) }));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data }));
        return;
      }
      recues.push({ chemin: req.url, entetes: req.headers, corps });
      const etape = etapes[Math.min(recues.length - 1, etapes.length - 1)];
      if (!etape) {
        res.writeHead(500).end("pas de scénario");
        return;
      }
      if (etape.retenir) await etape.retenir;
      if (res.destroyed) return;
      if (etape.flux) {
        for (const envoi of etape.flux) {
          if (envoi.retenir) await envoi.retenir;
          if (res.destroyed) return;
          if (!res.headersSent) res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(envoi.texte);
        }
        res.end();
        return;
      }
      res.writeHead(etape.statut, { "content-type": "application/json" }).end(JSON.stringify(etape.corps));
    });
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  return {
    adresse: `http://127.0.0.1:${serveur.address().port}`,
    recues,
    embeddings,
    arreter: async () => {
      serveur.closeAllConnections();
      await new Promise((ok) => serveur.close(ok));
    },
  };
}
