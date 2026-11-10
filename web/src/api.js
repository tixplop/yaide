import { choisi } from "./worktree.js";

async function appeler(chemin, options) {
  try {
    return await fetch(chemin, { credentials: "same-origin", ...options });
  } catch {
    return null;
  }
}

/** Nom et chemin du projet, ou null si le serveur ne répond pas. */
export async function info() {
  const r = await appeler("/api/info");
  if (!r || !r.ok) return null;
  return r.json();
}

export async function sessionValide() {
  const r = await appeler("/api/session");
  return r?.status === 204;
}

/** Renvoie "ok", "incorrect", "trop", "injoignable" ou "erreur". */
export async function connexion(motDePasse) {
  const r = await appeler("/api/connexion", { method: "POST", body: motDePasse });
  if (!r) return "injoignable";
  if (r.status === 204) return "ok";
  if (r.status === 401) return "incorrect";
  if (r.status === 429) return "trop";
  return "erreur";
}

/** Vrai si la session est fermée : 204, ou 401 (déjà expirée). */
export async function deconnexion() {
  const r = await appeler("/api/deconnexion", { method: "POST" });
  return r?.status === 204 || r?.status === 401;
}

/** `{ instance, shells: [id…] }`, ou null si le serveur ne répond pas. */
export async function listeShells() {
  const r = await appeler("/api/shells");
  if (!r || !r.ok) return null;
  return r.json();
}

/** Renvoie `{ id }`, ou `{ erreur }` (texte du serveur) ; `{ coupure: true }` sans réponse. */
export async function ouvrirShell() {
  const r = await appeler("/api/shells", { method: "POST" });
  if (!r) return { coupure: true };
  if (r.status === 201) return r.json();
  return { erreur: (await r.text()).trim() || `erreur ${r.status}` };
}

/** Vrai si la commande `claude` est dans le PATH du serveur ; faux sans réponse. */
export async function claudeDisponible() {
  const r = await appeler("/api/claude");
  if (!r || !r.ok) return false;
  return (await r.json()).disponible === true;
}

/** Renvoie `{ id }`, `{ erreur: raison }` (503) ; `{ coupure: true }` sans réponse. */
export async function ouvrirClaude() {
  const r = await appeler("/api/claude", { method: "POST" });
  if (!r) return { coupure: true };
  if (r.status === 201) return r.json();
  return { erreur: (await r.text()).trim() || `erreur ${r.status}` };
}

/** Rend `{}`, `{ introuvable: true }` (404), `{ coupure: true }` ou `{ erreur }` (texte du serveur). */
export async function fermerShell(id) {
  const r = await appeler(`/api/shells/${id}`, { method: "DELETE" });
  if (!r) return { coupure: true };
  if (r.status === 204) return {};
  if (r.status === 404) return { introuvable: true };
  return { erreur: (await r.text()).trim() || `erreur ${r.status}` };
}

const q = encodeURIComponent;

/** Ajoute `worktree=<choisi>` à une route git, sauf pour le projet. */
function git(chemin) {
  const w = choisi();
  if (w === "") return chemin;
  return `${chemin}${chemin.includes("?") ? "&" : "?"}worktree=${q(w)}`;
}

/** Lit la réponse d'erreur du serveur : `{ cause, message }`. */
async function erreurServeur(r) {
  try {
    const { cause, message } = await r.json();
    return { cause, message };
  } catch {
    return { cause: "erreur", message: `erreur ${r.status}` };
  }
}

/** `{ entrees: [{ nom, dossier, ignore }] }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function listerDossier(chemin) {
  const r = await appeler(`/api/fichiers?chemin=${q(chemin)}`);
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/** `{ contenu, version }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function lireFichier(chemin) {
  const r = await appeler(`/api/fichier?chemin=${q(chemin)}`);
  if (!r) return { coupure: true };
  if (r.ok) {
    try {
      return { contenu: await r.text(), version: r.headers.get("x-version") };
    } catch {
      return { coupure: true };
    }
  }
  return erreurServeur(r);
}

async function action(chemin, options) {
  const r = await appeler(chemin, options);
  if (!r) return { coupure: true };
  if (r.ok) return {};
  return erreurServeur(r);
}

/** `type` : "fichier" ou "dossier". Rend `{}` ou `{ cause, message }` ou `{ coupure: true }`. */
export const creerChemin = (chemin, type) => action(`/api/fichiers/creer?chemin=${q(chemin)}&type=${type}`, { method: "POST" });
export const renommerChemin = (de, vers) => action(`/api/fichiers/renommer?de=${q(de)}&vers=${q(vers)}`, { method: "POST" });
export const supprimerChemin = (chemin) => action(`/api/fichier?chemin=${q(chemin)}`, { method: "DELETE" });

/** Écrit le fichier. `version` : celle lue ou écrite en dernier. Rend `{ version }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function ecrireFichier(chemin, contenu, version) {
  const v = version ? `&version=${q(version)}` : "";
  const r = await appeler(`/api/fichier?chemin=${q(chemin)}${v}`, { method: "PUT", body: contenu });
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/** Version de chaque chemin (`null` si le fichier n'existe plus), ou null si le serveur ne répond pas. */
export async function versionsFichiers(chemins) {
  const r = await appeler("/api/fichiers/versions", { method: "POST", body: chemins.join("\n"), signal: AbortSignal.timeout(2000) });
  if (!r || !r.ok) return null;
  try {
    return await r.json();
  } catch {
    return null;
  }
}

/** `{ branche, detachee, branches, changements: [{ chemin, statut, indexe }], worktrees: [{ chemin, nom, branche, detachee }] }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function gitEtat() {
  const r = await appeler(git("/api/git/etat"));
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/** `{ binaire, trop_gros, diff }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function gitDiff(chemin) {
  const r = await appeler(git(`/api/git/diff?chemin=${q(chemin)}`));
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/** Les actions git rendent `{}`, `{ cause, message }` ou `{ coupure: true }`. */
export const gitIndexer = (chemin) => action(git(`/api/git/indexer?chemin=${q(chemin)}`), { method: "POST" });
export const gitCommit = (texte) => action(git("/api/git/commit"), { method: "POST", body: texte });
export const gitBranche = (nom) => action(git(`/api/git/branche?nom=${q(nom)}`), { method: "POST" });
export const gitPull = () => action(git("/api/git/pull"), { method: "POST" });
export const gitPush = () => action(git("/api/git/push"), { method: "POST" });

/** `{ resultats: [{ chemin, ligne, texte, debut, fin }], limite }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function chercherTexte(texte) {
  const r = await appeler(`/api/recherche?q=${q(texte)}`);
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/** `{ chemins: [texte…] }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function listerChemins() {
  const r = await appeler("/api/chemins");
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/** `{ providers: [{ id, nom, adresse, cle, cleObligatoire }], profils, erreur }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function reglagesAgent() {
  const r = await appeler("/api/agent/reglages");
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/** Rend `{}`, `{ champ: "adresse" }` (400), `{ cause, message }` ou `{ coupure: true }`. La clé vide n'est pas envoyée. */
export async function enregistrerProvider(id, { adresse, cle }) {
  const corps = cle ? { adresse, cle } : { adresse };
  const r = await appeler(`/api/agent/providers/${q(id)}`, { method: "PUT", body: JSON.stringify(corps) });
  if (!r) return { coupure: true };
  if (r.ok) return {};
  if (r.status === 400) {
    try {
      const { champ } = await r.json();
      if (champ === "adresse") return { champ };
    } catch {
      // Corps illisible : traité comme une erreur du serveur.
    }
  }
  return erreurServeur(r);
}

export const supprimerCle = (id) => action(`/api/agent/providers/${q(id)}/cle`, { method: "DELETE" });

/** Rend les réglages (`{ providers, profils, erreur }`), `{ cause, message }` ou `{ coupure: true }`. Un refus 400 par champ donne `cause: "invalide"`. */
async function reglagesApres(chemin, options) {
  const r = await appeler(chemin, options);
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  if (r.status === 400) {
    try {
      const { erreurs } = await r.json();
      if (Array.isArray(erreurs)) return { cause: "invalide", message: `valeur refusée (${erreurs.map((e) => e.champ).join(", ")})` };
    } catch {
      // Corps illisible : traité comme une erreur du serveur.
    }
  }
  return erreurServeur(r);
}

/** `profil` : `{ id?, nom, provider, modele, effort?, temperature?, sortieMax?, fenetre?, defaut }`. */
export const enregistrerProfil = (profil) => reglagesApres("/api/agent/profils", { method: "PUT", body: JSON.stringify(profil) });
export const supprimerProfil = (id) => reglagesApres(`/api/agent/profils/${q(id)}`, { method: "DELETE" });

/** `agents` : dossiers des agents, au premier message d'une conversation avec agents. Rend `{ conversation }`, `{ refus, provider }` (409), `{ cause, message }` ou `{ coupure: true }`. */
export async function envoyerMessage({ conversation, profil, agents, texte }) {
  const corps = conversation ? { conversation, profil, texte } : agents ? { agents, texte } : { profil, texte };
  const r = await appeler("/api/agent/messages", { method: "POST", body: JSON.stringify(corps) });
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  if (r.status === 409) {
    try {
      const { refus, provider } = await r.json();
      return { refus, provider };
    } catch {
      // Corps illisible : traité comme une erreur du serveur.
    }
  }
  return erreurServeur(r);
}

/** Rend `{ titre, profil, enCours, tokens, total, entrees }`, `{ introuvable: true }` (404), `{ cause, message }` ou `{ coupure: true }`. */
export async function lireConversation(id, depuis = 0) {
  const r = await appeler(`/api/agent/conversations/${q(id)}?depuis=${depuis}`);
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  if (r.status === 404) return { introuvable: true };
  return erreurServeur(r);
}

export const arreterConversation = (id) => action(`/api/agent/conversations/${q(id)}/arreter`, { method: "POST" });

/** `[{ id, titre, maj }]`, la plus récente en premier ; null si le serveur ne répond pas. */
export async function listeConversations() {
  const r = await appeler("/api/agent/conversations");
  if (!r || !r.ok) return null;
  return r.json();
}

/** `{ agents: [{ dossier, nom, avatar, couleur, profil? }], erreurs: [chemin…] }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function listerAgents() {
  const r = await appeler("/api/agent/agents");
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/**
 * `saisie` : `{ dossier?, nom, avatar, couleur, profil? }` (sans `dossier` : création).
 * Rend l'agent enregistré, `{ cause: "invalide", message, champs }` (400), `{ cause, message }` ou `{ coupure: true }`.
 */
export async function enregistrerAgent(saisie) {
  const r = await appeler("/api/agent/agents", { method: "PUT", body: JSON.stringify(saisie) });
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  if (r.status === 400) {
    try {
      const { erreurs } = await r.json();
      if (Array.isArray(erreurs)) {
        const champs = erreurs.map((e) => e.champ);
        return { cause: "invalide", message: `valeur refusée (${champs.join(", ")})`, champs };
      }
    } catch {
      // Corps illisible : traité comme une erreur du serveur.
    }
  }
  return erreurServeur(r);
}

/** Vrai si une installation d'opencode 2 est détectée par le serveur ; faux sans réponse. */
export async function opencodeDisponible() {
  const r = await appeler("/api/opencode");
  if (!r || !r.ok) return false;
  return (await r.json()).disponible === true;
}

const OC = "/api/opencode/api";

/**
 * Appel de l'API d'opencode, relayée par Yaide. Rend `{ donnees }` (corps JSON, null s'il est vide),
 * `{ coupure: true }`, `{ erreur: raison }` (503 ou autre échec) ou `{ disparue: true }` (404).
 */
async function appelOpencode(chemin, options) {
  const r = await appeler(`${OC}${chemin}`, options);
  if (!r) return { coupure: true };
  if (r.status === 404) return { disparue: true };
  const texte = await r.text().catch(() => "");
  if (r.ok) {
    try {
      return { donnees: texte ? JSON.parse(texte) : null };
    } catch {
      return { erreur: "réponse illisible" };
    }
  }
  let raison = texte.trim();
  try {
    raison = JSON.parse(texte).message ?? raison;
  } catch {
    // Texte brut : gardé tel quel.
  }
  return { erreur: raison || `erreur ${r.status}` };
}

const json = (methode, corps) => ({ method: methode, headers: { "content-type": "application/json" }, body: JSON.stringify(corps) });

/** `dossier` : le dossier du projet. Rend `{ donnees: { data: session } }` (voir `appelOpencode`). */
export const creerSession = (dossier) => appelOpencode("/session", json("POST", { location: { directory: dossier } }));
export const session = (id) => appelOpencode(`/session/${q(id)}`);
/** Une page de l'historique, du plus ancien au plus récent ; `curseur` : `cursor.next` de la page précédente. */
export const messages = (id, curseur) => appelOpencode(`/session/${q(id)}/message?limit=200&${curseur ? `cursor=${q(curseur)}` : "order=asc"}`);
export const sessionsFilles = (id) => appelOpencode(`/session?parentID=${q(id)}`);
export const envoyer = (id, texte) => appelOpencode(`/session/${q(id)}/prompt`, json("POST", { text: texte }));
export const interrompre = (id) => appelOpencode(`/session/${q(id)}/interrupt`, { method: "POST" });
export const autorisations = (sessionId) => appelOpencode(`/session/${q(sessionId)}/permission`);
/** `decision` : "once", "always" ou "reject". */
export const repondreAutorisation = (sessionId, id, decision) => appelOpencode(`/session/${q(sessionId)}/permission/${q(id)}/reply`, json("POST", { decision }));
export const questions = (sessionId) => appelOpencode(`/session/${q(sessionId)}/form`);
/** `reponse` : valeurs par clé de champ. */
export const repondreQuestion = (sessionId, id, reponse) => appelOpencode(`/session/${q(sessionId)}/form/${q(id)}/reply`, json("POST", { answer: reponse }));
export const ignorerQuestion = (sessionId, id) => appelOpencode(`/session/${q(sessionId)}/form/${q(id)}`, { method: "DELETE" });

export const modelesOpencode = () => appelOpencode("/model");
export const modeleParDefaut = () => appelOpencode("/model/default");
/** `variant` n'est envoyé que s'il a une valeur. */
export const choisirModele = (sessionId, { id, providerID, variant }) =>
  appelOpencode(`/session/${q(sessionId)}/model`, json("POST", { model: { id, providerID, ...(variant ? { variant } : {}) } }));
