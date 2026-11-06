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

/** Rend `{}`, `{ introuvable: true }` (404), `{ coupure: true }` ou `{ erreur }` (texte du serveur). */
export async function fermerShell(id) {
  const r = await appeler(`/api/shells/${id}`, { method: "DELETE" });
  if (!r) return { coupure: true };
  if (r.status === 204) return {};
  if (r.status === 404) return { introuvable: true };
  return { erreur: (await r.text()).trim() || `erreur ${r.status}` };
}

const q = encodeURIComponent;

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

/** `{ branche, detachee, branches, changements: [{ chemin, statut, indexe }] }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function gitEtat() {
  const r = await appeler("/api/git/etat");
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/** `{ binaire, trop_gros, diff }`, `{ cause, message }` ou `{ coupure: true }`. */
export async function gitDiff(chemin) {
  const r = await appeler(`/api/git/diff?chemin=${q(chemin)}`);
  if (!r) return { coupure: true };
  if (r.ok) return r.json();
  return erreurServeur(r);
}

/** Les actions git rendent `{}`, `{ cause, message }` ou `{ coupure: true }`. */
export const gitIndexer = (chemin) => action(`/api/git/indexer?chemin=${q(chemin)}`, { method: "POST" });
export const gitCommit = (texte) => action("/api/git/commit", { method: "POST", body: texte });
export const gitBranche = (nom) => action(`/api/git/branche?nom=${q(nom)}`, { method: "POST" });
export const gitPull = () => action("/api/git/pull", { method: "POST" });
export const gitPush = () => action("/api/git/push", { method: "POST" });

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
