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
 * (la dernière est répétée) ; une étape peut porter `retenir` (une promesse) : la réponse attend qu'elle soit tenue. Sa route `/embeddings` (format OpenAI) rend un vecteur par texte (`vecteurDeTexte`) ; `embeddings` garde ses corps. Rend `{ adresse, recues, embeddings, arreter }` ; `recues` garde `{ chemin, entetes, corps }`.
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
