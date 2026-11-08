// Modèle d'une session opencode : l'historique et le flux d'événements de l'API d'opencode 2 (relayée par
// Yaide) donnent les entrées de la conversation (C-015), l'état du tour et les demandes en attente.
// La forme des événements est celle relevée sur opencode 2.2.5 : `e2e/capturer-opencode.js`, `opencode-captures/`.
import * as api from "./api.js";

const SOURCE = "/api/opencode/api/event";
const OUTILS_SOUS_AGENT = new Set(["subagent"]);
const ATTENTE_RELANCE_MS = 2000;
const ECHEC_TOUR = "Le tour a échoué. Vous pouvez envoyer un autre message.";

/** id de session → { id, items, cles, enCours, dernierMsg, execSeq, disparue, coupure, pret }. */
const sessions = new Map();
/** id de session → { parentID, agent, titre, dossier, issue }. Connu aussi pour les sessions non ouvertes. */
const infos = new Map();
/** id de session → rappels. */
const abonnes = new Map();
/** id de demande → { type: "autorisation" | "question", sessionId, … }, dans l'ordre d'arrivée. */
const demandes = new Map();

/** Catalogue des modèles, un seul pour la page : `etat` vaut chargement, pret ou illisible. */
const catalogue = { etat: "chargement", modeles: [], defaut: null, lancees: 0 };

let source = null;
let ouvert = false;
let relance = null;

// --- Aides --------------------------------------------------------------------------------------

function info(id) {
  if (!infos.has(id)) infos.set(id, {});
  return infos.get(id);
}

function noterSession(s) {
  if (!s?.id) return;
  const i = info(s.id);
  if (s.parentID) i.parentID = s.parentID;
  if (s.agent) i.agent = s.agent;
  if (s.title) i.titre = s.title;
  if (s.location?.directory) i.dossier = s.location.directory;
  if (s.outcome) i.issue = s.outcome;
}

function texteDes(contenu) {
  return (contenu ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function relatif(chemin, dossier) {
  if (typeof chemin !== "string") return "";
  return dossier && chemin.startsWith(`${dossier}/`) ? chemin.slice(dossier.length + 1) : chemin;
}

/** L'argument principal d'un appel d'outil (V-002). */
function argumentPrincipal(nom, entree, dossier) {
  const e = entree ?? {};
  switch (nom) {
    case "shell":
      return typeof e.command === "string" ? e.command : "";
    case "read":
    case "edit":
    case "write":
      return relatif(e.path ?? e.filePath, dossier);
    case "grep":
    case "glob":
      return typeof e.pattern === "string" ? e.pattern : "";
    case "webfetch":
      return typeof e.url === "string" ? e.url : "";
    default:
      return "";
  }
}

const ETATS_OUTIL = { completed: "reussi", error: "echec" };

function parent(id) {
  return infos.get(id)?.parentID;
}

function estDansLaFamille(sid, racine) {
  for (let c = sid, n = 0; c && n < 100; c = parent(c), n++) if (c === racine) return true;
  return false;
}

function notifier(sid) {
  const faits = new Set();
  for (let c = sid, n = 0; c && n < 100; c = parent(c), n++) {
    for (const rappel of abonnes.get(c) ?? []) {
      if (faits.has(rappel)) continue;
      faits.add(rappel);
      try {
        rappel();
      } catch {
        // Un rappel qui échoue ne gêne pas les autres.
      }
    }
  }
}

// --- Magasin d'une session ------------------------------------------------------------------------

function magasin(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { id, items: [], cles: new Map(), enCours: false, dernierMsg: null, execSeq: 0, disparue: false, coupure: false, pret: Promise.resolve(), flux: new Set(), synchro: false, tampon: [] });
  }
  return sessions.get(id);
}

function ajouter(s, item) {
  if (s.cles.has(item.cle)) return s.cles.get(item.cle);
  s.cles.set(item.cle, item);
  s.items.push(item);
  return item;
}

function ajouterErreur(s, msgId, erreur) {
  ajouter(s, { cle: `err:${msgId}`, type: "message", detail: erreur?.message ?? "" });
}

function ajouterFin(s) {
  ajouter(s, { cle: `fin:${s.dernierMsg}`, type: "fin" });
}

function outil(s, id, nom) {
  const item = ajouter(s, { cle: `outil:${id}`, type: "outil", id, nom: nom ?? "", entree: null, etat: "enCours", resultat: "", enfant: null });
  if (nom && !item.nom) item.nom = nom;
  return item;
}

function terminer(item, etat, resultat) {
  if (item.etat !== "enCours") return;
  item.etat = etat;
  item.resultat = resultat;
}

/** Applique un événement du flux à la session `sid` (si elle est ouverte) ; rend vrai si quelque chose a changé. */
function appliquerEvenement(s, ev) {
  const d = ev.data;
  switch (ev.type) {
    case "session.inbox.enqueued":
      if (d.item?.type === "user") {
        ajouter(s, { cle: `msg:${d.inboxID}`, type: "utilisateur", texte: d.item.payload?.text ?? "" });
        s.dernierMsg = d.inboxID;
      }
      break;
    case "session.execution.started":
      s.execSeq++;
      s.enCours = true;
      break;
    case "session.execution.succeeded":
      s.execSeq++;
      s.enCours = false;
      break;
    case "session.execution.failed":
      s.execSeq++;
      s.enCours = false;
      ajouterErreur(s, s.dernierMsg, d.error);
      break;
    case "session.execution.interrupted":
      s.execSeq++;
      s.enCours = false;
      ajouterFin(s);
      break;
    case "session.step.started":
      s.dernierMsg = d.assistantMessageID;
      break;
    case "session.step.failed":
      if (d.error?.type !== "aborted") ajouterErreur(s, d.assistantMessageID, d.error);
      break;
    case "session.text.started": {
      const item = ajouter(s, { cle: `txt:${d.assistantMessageID}:${d.ordinal}`, type: "agent", markdown: "", complet: false });
      if (!item.complet) s.flux.add(item.cle);
      break;
    }
    case "session.text.delta": {
      const item = ajouter(s, { cle: `txt:${d.assistantMessageID}:${d.ordinal}`, type: "agent", markdown: "", complet: false });
      if (!item.complet) item.markdown += d.delta;
      break;
    }
    case "session.text.ended": {
      const item = ajouter(s, { cle: `txt:${d.assistantMessageID}:${d.ordinal}`, type: "agent", markdown: "", complet: false });
      item.markdown = d.text;
      item.complet = true;
      s.flux.delete(item.cle);
      break;
    }
    case "session.tool.input.started":
      outil(s, d.id, d.name);
      break;
    case "session.tool.called":
      outil(s, d.id).entree = d.input;
      break;
    case "session.tool.progress": {
      const item = outil(s, d.id);
      item.enfant = d.metadata?.sessionID ?? item.enfant;
      break;
    }
    case "session.tool.success": {
      const item = outil(s, d.id);
      item.enfant = d.metadata?.sessionID ?? item.enfant;
      terminer(item, "reussi", texteDes(d.content));
      break;
    }
    case "session.tool.failed":
      terminer(outil(s, d.id), "echec", d.error?.message ?? "");
      break;
    default:
      // Raisonnement, usage, instructions, etc. : ignorés.
      return false;
  }
  return true;
}

function traiter(ev) {
  const d = ev?.data;
  if (!d || typeof ev.type !== "string") return;
  let sid = d.sessionID ?? d.form?.sessionID;
  const issue = { "session.execution.started": undefined, "session.execution.succeeded": "succeeded", "session.execution.failed": "failed", "session.execution.interrupted": "interrupted" };
  if (ev.type in issue) info(sid).issue = issue[ev.type];
  switch (ev.type) {
    case "session.created":
      noterSession({ id: d.sessionID, parentID: d.parentID, agent: d.agent, title: d.title, location: d.location });
      break;
    case "session.model.selected": {
      const i = info(d.sessionID);
      i.model = d.model ?? null;
      i.modelSeq = (i.modelSeq ?? 0) + 1;
      break;
    }
    case "model.updated":
      lireCatalogue();
      return;
    case "session.renamed":
      info(d.sessionID).titre = d.title;
      break;
    case "permission.asked":
      demandes.set(d.id, { type: "autorisation", id: d.id, sessionId: d.sessionID, action: d.action, ressources: d.resources ?? [] });
      break;
    case "permission.replied":
      sid = demandes.get(d.requestID)?.sessionId ?? sid;
      demandes.delete(d.requestID);
      break;
    case "form.created":
      demandes.set(d.form.id, { type: "question", id: d.form.id, sessionId: d.form.sessionID, titre: d.form.title, champs: d.form.fields ?? [] });
      break;
    case "form.replied":
    case "form.cancelled":
      sid = demandes.get(d.id)?.sessionId ?? sid;
      demandes.delete(d.id);
      break;
    default: {
      const s = sid && sessions.get(sid);
      if (s?.synchro) {
        s.tampon.push(ev);
        return;
      }
      if (s) appliquerEvenement(s, ev);
      else if (!ev.type.startsWith("session.")) return;
      if (!sid) return;
    }
  }
  if (sid) notifier(sid);
}

// --- Historique ----------------------------------------------------------------------------------

function itemsDeLHistorique(donnees) {
  const liste = [];
  let dernier = null;
  let relevant = null;
  for (const m of donnees) {
    if (m.type === "user") {
      liste.push({ cle: `msg:${m.id}`, type: "utilisateur", texte: m.text ?? "" });
      dernier = m.id;
      relevant = m;
    } else if (m.type === "assistant") {
      dernier = m.id;
      relevant = m;
      let n = 0;
      for (const p of m.content ?? []) {
        if (p.type === "text") {
          liste.push({ cle: `txt:${m.id}:${n++}`, type: "agent", markdown: p.text ?? "", complet: Boolean(m.time?.completed), depuisHistorique: true });
        } else if (p.type === "tool") {
          const st = p.state ?? {};
          liste.push({
            cle: `outil:${p.id}`,
            type: "outil",
            id: p.id,
            nom: p.name,
            entree: st.input ?? null,
            etat: ETATS_OUTIL[st.status] ?? "enCours",
            resultat: st.status === "error" ? (st.error?.message ?? "") : texteDes(st.content),
            enfant: st.metadata?.sessionID ?? null,
          });
        }
      }
      if (m.error && m.error.type !== "aborted") liste.push({ cle: `err:${m.id}`, type: "message", detail: m.error.message ?? "" });
    } else if (m.type === "idle") {
      relevant = m;
      if (m.outcome === "interrupted") liste.push({ cle: `fin:${dernier}`, type: "fin" });
      else if (m.outcome === "failed" && m.error) liste.push({ cle: `err:${dernier}`, type: "message", detail: m.error.message ?? "" });
    }
  }
  return { liste, dernier, enCours: relevant !== null && relevant.type !== "idle" };
}

/** Garde, de l'élément connu par les événements et de celui de l'historique, le plus avancé. */
function fusionner(connu, historique) {
  if (connu.type === "outil") {
    if (connu.etat !== "enCours") return { ...historique, ...connu, enfant: connu.enfant ?? historique.enfant };
    return { ...connu, ...historique, entree: historique.entree ?? connu.entree, enfant: historique.enfant ?? connu.enfant };
  }
  if (connu.type === "agent") {
    if (historique.complet) return historique;
    if (connu.complet) return connu;
    return historique.markdown.length >= connu.markdown.length ? historique : connu;
  }
  return historique;
}

function appliquerHistorique(s, donnees) {
  const { liste, dernier } = itemsDeLHistorique(donnees);
  const vus = new Set();
  const fusion = liste.filter((h) => !vus.has(h.cle) && vus.add(h.cle)).map((h) => {
    const c = s.cles.get(h.cle);
    return c ? fusionner(c, h) : h;
  });
  for (const c of s.items) if (!vus.has(c.cle)) fusion.push(c);
  s.items = fusion;
  s.cles = new Map(fusion.map((i) => [i.cle, i]));
  if (dernier && !s.cles.has(`fin:${s.dernierMsg}`)) s.dernierMsg = dernier;
  for (const [cle, item] of s.cles) if (item.type === "agent" && item.complet) s.flux.delete(cle);
}

async function lireHistorique(id) {
  const donnees = [];
  let curseur = null;
  for (let page = 0; page < 500; page++) {
    const r = await api.messages(id, curseur);
    if (!r.donnees) return r;
    donnees.push(...(r.donnees.data ?? []));
    const suivant = r.donnees.cursor?.next;
    if ((r.donnees.data ?? []).length < 200 || !suivant) break;
    curseur = suivant;
  }
  return { donnees };
}

/** Les sessions descendantes de `id` (filles, petites-filles…), avec leurs informations. */
async function descendantes(id, vues = new Set([id])) {
  const r = await api.sessionsFilles(id);
  if (!r.donnees) return { erreur: r };
  const tout = [];
  for (const f of r.donnees.data ?? []) {
    if (vues.has(f.id)) continue;
    vues.add(f.id);
    noterSession(f);
    tout.push(f.id);
    const sous = await descendantes(f.id, vues);
    if (sous.erreur) return sous;
    tout.push(...sous.ids);
  }
  return { ids: tout };
}

/** Un sous-agent dont l'appel n'a pas encore donné sa session fille prend la première fille libre, dans l'ordre. */
function attribuerEnfants(s, filles) {
  const prises = new Set(s.items.filter((i) => i.enfant).map((i) => i.enfant));
  const libres = filles.filter((f) => !prises.has(f));
  for (const i of s.items) {
    if (i.type === "outil" && OUTILS_SOUS_AGENT.has(i.nom) && !i.enfant && libres.length) i.enfant = libres.shift();
  }
}

/** Longueur du plus long suffixe de `texte` qui est aussi préfixe de `suite`. */
function chevauchement(texte, suite) {
  for (let k = Math.min(texte.length, suite.length); k > 0; k--) if (texte.endsWith(suite.slice(0, k))) return k;
  return 0;
}

/**
 * Les morceaux de texte arrivés pendant la relecture, bout à bout, ne s'ajoutent qu'après ce que le texte relu
 * en contient déjà. Rend les autres événements, à rejouer ensuite.
 */
function rejeter(s, tampon) {
  const suites = new Map();
  const reste = [];
  for (const ev of tampon) {
    const item = ev.type === "session.text.delta" ? s.cles.get(`txt:${ev.data.assistantMessageID}:${ev.data.ordinal}`) : null;
    if (item?.depuisHistorique && !item.complet) suites.set(item, (suites.get(item) ?? "") + ev.data.delta);
    else reste.push(ev);
  }
  for (const [item, suite] of suites) item.markdown += suite.slice(chevauchement(item.markdown, suite));
  return reste;
}

async function synchroniser(id) {
  const s = magasin(id);
  s.synchro = true;
  try {
    await synchroniserSession(s);
  } finally {
    // Les événements arrivés pendant la relecture passent après l'historique, sans doublon.
    s.synchro = false;
    const tampon = s.tampon;
    s.tampon = [];
    for (const ev of rejeter(s, tampon)) appliquerEvenement(s, ev);
    if (tampon.length) notifier(id);
  }
}

async function synchroniserSession(s) {
  const id = s.id;
  const seq = s.execSeq;
  const modelSeq = info(id).modelSeq ?? 0;
  const [rs, rm, rd] = await Promise.all([api.session(id), lireHistorique(id), descendantes(id)]);
  if (rs.disparue || rm.disparue) {
    s.disparue = true;
    notifier(id);
    return;
  }
  if (!rs.donnees || !rm.donnees || rd.erreur) {
    s.coupure = Boolean(rs.coupure || rm.coupure || rd.erreur?.coupure);
    notifier(id);
    return;
  }
  s.coupure = false;
  s.disparue = false;
  noterSession(rs.donnees.data);
  if ((info(id).modelSeq ?? 0) === modelSeq) info(id).model = rs.donnees.data?.model ?? null;
  appliquerHistorique(s, rm.donnees);
  const { enCours } = itemsDeLHistorique(rm.donnees);
  if (s.execSeq === seq) s.enCours = enCours;
  const filles = [...infos].filter(([, i]) => i.parentID === id).map(([k]) => k);
  attribuerEnfants(s, filles);

  // Demandes en attente de la session et de ses descendantes : celles que l'API ne cite plus sont retirées.
  const famille = [id, ...rd.ids];
  const avant = new Set([...demandes.values()].filter((dm) => famille.includes(dm.sessionId)).map((dm) => dm.id));
  const lues = new Set();
  await Promise.all(
    famille.map(async (sid) => {
      const [ra, rq] = await Promise.all([api.autorisations(sid), api.questions(sid)]);
      for (const p of ra.donnees?.data ?? []) {
        lues.add(p.id);
        demandes.set(p.id, { type: "autorisation", id: p.id, sessionId: p.sessionID, action: p.action, ressources: p.resources ?? [] });
      }
      for (const f of rq.donnees?.data ?? []) {
        lues.add(f.id);
        demandes.set(f.id, { type: "question", id: f.id, sessionId: f.sessionID, titre: f.title, champs: f.fields ?? [] });
      }
    }),
  );
  for (const idDemande of avant) if (!lues.has(idDemande)) demandes.delete(idDemande);
  notifier(id);
}

// --- Catalogue des modèles -----------------------------------------------------------------------

function notifierTous() {
  for (const id of [...abonnes.keys()]) notifier(id);
}

/** Relit les modèles et le modèle par défaut ; seule la relecture la plus récente compte. */
async function lireCatalogue() {
  const numero = ++catalogue.lancees;
  const [rm, rd] = await Promise.all([api.modelesOpencode(), api.modeleParDefaut()]);
  if (numero !== catalogue.lancees) return;
  if (rm.donnees && rd.donnees) {
    catalogue.modeles = (rm.donnees.data ?? []).filter((m) => m.enabled);
    catalogue.defaut = rd.donnees.data ?? null;
    catalogue.etat = "pret";
  } else {
    catalogue.etat = "illisible";
  }
  notifierTous();
}

// --- Flux d'événements ---------------------------------------------------------------------------

function lancer(id) {
  const s = magasin(id);
  s.pret = synchroniser(id).catch(() => {
    s.coupure = true;
  });
}

function ouvrirSource() {
  if (source || abonnes.size === 0) return;
  const es = new EventSource(SOURCE);
  source = es;
  es.onopen = () => {
    ouvert = true;
    lireCatalogue();
    for (const id of abonnes.keys()) lancer(id);
  };
  es.onmessage = (e) => {
    try {
      traiter(JSON.parse(e.data));
    } catch {
      // Événement illisible : ignoré.
    }
  };
  es.onerror = () => {
    if (es.readyState !== 2) return; // Le navigateur se reconnecte seul.
    es.close();
    source = null;
    ouvert = false;
    catalogue.etat = "illisible";
    notifierTous();
    clearTimeout(relance);
    relance = setTimeout(ouvrirSource, ATTENTE_RELANCE_MS);
  };
}

function fermerSource() {
  clearTimeout(relance);
  source?.close();
  source = null;
  ouvert = false;
}

// --- Interface du module ---------------------------------------------------------------------------

/**
 * Suit une session : `rappel` est appelé à chaque changement de la session, de ses descendantes ou de
 * leurs demandes. Rend la fonction de désabonnement. Un seul flux d'événements sert toute la page.
 */
export function abonner(sessionId, rappel) {
  if (!abonnes.has(sessionId)) abonnes.set(sessionId, new Set());
  abonnes.get(sessionId).add(rappel);
  if (!sessions.has(sessionId)) {
    magasin(sessionId);
    if (ouvert) lancer(sessionId);
  }
  ouvrirSource();
  return () => {
    const rappels = abonnes.get(sessionId);
    if (!rappels) return;
    rappels.delete(rappel);
    if (rappels.size > 0) return;
    abonnes.delete(sessionId);
    sessions.delete(sessionId);
    if (abonnes.size === 0) fermerSource();
  };
}

/** Résolue quand la dernière relecture de l'historique de la session est finie. */
export function pret(sessionId) {
  return sessions.get(sessionId)?.pret ?? Promise.resolve();
}

function etatSousAgent(item) {
  const issue = item.enfant ? infos.get(item.enfant)?.issue : undefined;
  if (issue === "interrupted") return "interrompu";
  if (issue === "failed") return "echec";
  if (item.etat === "echec") return "echec";
  if (item.etat === "reussi" || issue === "succeeded") return "termine";
  return "enCours";
}

/** L'état de la session pour la vue, ou null si elle n'est pas suivie. */
export function modeleSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  const i = infos.get(sessionId) ?? {};
  const fille = Boolean(i.parentID);
  let premier = true;
  const entrees = [];
  for (const it of s.items) {
    if (it.type === "utilisateur") {
      entrees.push({ cle: it.cle, type: "utilisateur", texte: it.texte, consigne: fille && premier });
      premier = false;
    } else if (it.type === "agent") {
      entrees.push({ cle: it.cle, type: "agent", markdown: it.markdown });
    } else if (it.type === "outil" && OUTILS_SOUS_AGENT.has(it.nom)) {
      const e = infos.get(it.enfant) ?? {};
      entrees.push({ cle: it.cle, type: "sousAgent", id: it.enfant, agent: e.agent ?? it.entree?.agent ?? "", titre: e.titre ?? it.entree?.description ?? "", etat: etatSousAgent(it) });
    } else if (it.type === "outil") {
      entrees.push({ cle: it.cle, type: "outil", id: it.id, nom: it.nom, argument: argumentPrincipal(it.nom, it.entree, i.dossier), etat: it.etat, resultat: it.resultat });
    } else if (it.type === "fin") {
      entrees.push({ cle: it.cle, type: "fin", texte: "Arrêté." });
    } else if (it.type === "message") {
      entrees.push({ cle: it.cle, type: "message", texte: ECHEC_TOUR, detail: it.detail });
    }
  }
  const actif = s.flux.size > 0 || s.items.some((it) => it.type === "outil" && it.etat === "enCours") || [...demandes.values()].some((d) => d.sessionId === sessionId);
  return {
    id: sessionId,
    entrees,
    enCours: s.enCours,
    enAttente: s.enCours && !actif,
    fille,
    agent: i.agent ?? "",
    titre: i.titre ?? "",
    parentID: i.parentID ?? null,
    disparue: s.disparue,
    coupure: s.coupure,
  };
}

/** Les autorisations et les questions de la session et de toutes ses descendantes, dans l'ordre d'arrivée. */
export function attentes(sessionId) {
  const liste = [];
  for (const d of demandes.values()) {
    if (!estDansLaFamille(d.sessionId, sessionId)) continue;
    const sousAgent = infos.get(d.sessionId)?.parentID ? (infos.get(d.sessionId).agent ?? "") : undefined;
    liste.push({ ...d, sousAgent });
  }
  return liste;
}

function retirer(sessionId, id) {
  demandes.delete(id);
  notifier(sessionId);
}

/** Répond à une autorisation ("once", "always" ou "reject") ; réussie, elle disparaît de tous les onglets. */
export async function repondreAutorisation(sessionId, id, decision) {
  const r = await api.repondreAutorisation(sessionId, id, decision);
  if (!("donnees" in r) && !r.disparue) return r;
  retirer(sessionId, id);
  return r;
}

export async function repondreQuestion(sessionId, id, reponse) {
  const r = await api.repondreQuestion(sessionId, id, reponse);
  if (!("donnees" in r) && !r.disparue) return r;
  retirer(sessionId, id);
  return r;
}

export async function ignorerQuestion(sessionId, id) {
  const r = await api.ignorerQuestion(sessionId, id);
  if (!("donnees" in r) && !r.disparue) return r;
  retirer(sessionId, id);
  return r;
}

const cleModele = (providerID, id) => `${providerID}\t${id}`;
const variante = (v) => (v && v !== "default" ? v : null);

/**
 * Modèles et efforts de la session pour les listes : `{ etat, modeles, efforts, courant }`. `courant` est le choix
 * en cours d'envoi, sinon la valeur de la session, sinon le modèle par défaut (`null` si aucun).
 */
export function choixModele(sessionId) {
  const i = infos.get(sessionId) ?? {};
  const valeur = i.choix ?? i.model;
  const base = valeur ?? catalogue.defaut;
  const courant = base ? { cle: cleModele(base.providerID, base.id), id: base.id, providerID: base.providerID, variante: valeur ? variante(valeur.variant) : null } : null;
  const modeles = catalogue.modeles.map((m) => ({ cle: cleModele(m.providerID, m.id), id: m.id, providerID: m.providerID, texte: `${m.name} · ${m.providerID}`, variantes: (m.variants ?? []).map((v) => v.id) }));
  let affiche = courant && modeles.find((m) => m.cle === courant.cle);
  if (courant && !affiche) {
    affiche = { cle: courant.cle, id: courant.id, providerID: courant.providerID, texte: `${courant.id} · ${courant.providerID}`, variantes: [] };
    modeles.unshift(affiche);
  }
  const efforts = [...(affiche?.variantes ?? [])];
  if (courant?.variante && !efforts.includes(courant.variante)) efforts.unshift(courant.variante);
  let etat = catalogue.etat === "chargement" ? "chargement" : catalogue.etat === "illisible" ? "illisible" : "pret";
  if (etat === "pret" && !courant && modeles.length === 0) etat = "aucun";
  return { etat, modeles, efforts, courant };
}

/**
 * Choisit le modèle `cle` (de `choixModele`) et la `variante` (null pour « Par défaut ») pour la session.
 * Rend le résultat d'`appelOpencode`. Le dernier choix l'emporte ; refusé, l'ancienne valeur revient.
 */
export async function choisirModele(sessionId, cle, variante) {
  const m = choixModele(sessionId).modeles.find((x) => x.cle === cle);
  if (!m) return { erreur: "modèle inconnu" };
  const i = info(sessionId);
  const choix = { id: m.id, providerID: m.providerID, variant: variante || undefined };
  const numero = (i.choixSeq = (i.choixSeq ?? 0) + 1);
  i.choix = choix;
  notifier(sessionId);
  const r = await api.choisirModele(sessionId, choix);
  if (numero === i.choixSeq) {
    if ("donnees" in r) {
      i.model = choix;
      i.modelSeq = (i.modelSeq ?? 0) + 1;
    }
    delete i.choix;
    notifier(sessionId);
  }
  return r;
}

/** Remet le module à zéro (tests). */
export function reinitialiser() {
  catalogue.etat = "chargement";
  catalogue.modeles = [];
  catalogue.defaut = null;
  fermerSource();
  sessions.clear();
  infos.clear();
  abonnes.clear();
  demandes.clear();
}
