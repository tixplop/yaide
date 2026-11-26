import { ecrireJournal, lireJournal, purgerJournal } from "./api.js";
import { afficher } from "./ui/toasts.js";

// Journal de la page (DEC-123, REQ-186 à REQ-188) : les lignes du serveur, relues après la dernière vue, et celles de la page,
// montrées aussitôt, gardées pendant une coupure, puis envoyées une fois avec leur heure d'origine.
const VERS_SERVEUR = { information: "Information", avertissement: "Avertissement", erreur: "Erreur" };
const DU_SERVEUR = { Information: "information", Avertissement: "avertissement", Erreur: "erreur" };

let serveur; // lignes du serveur déjà vues : { numero, heure, severite, message, detail? }
let locales; // lignes de la page : { heure, severite, message, detail?, envoyee }
let dernier; // numéro de la dernière ligne du serveur vue
let purge; // numéro de purge vu ; rien avant la première lecture
let envoi;
let ecouteurs;

export function reinitialiser() {
  serveur = [];
  locales = [];
  dernier = 0;
  purge = undefined;
  envoi = null;
  ecouteurs = new Set();
}
reinitialiser();

const prevenir = (evenement) => {
  for (const f of ecouteurs) f(evenement);
};

/** `fn({ type: "ajout", ligne })` ou `fn({ type: "remplace", lignes })` ; rend la fonction qui arrête le suivi. */
export function suivre(fn) {
  ecouteurs.add(fn);
  return () => ecouteurs.delete(fn);
}

const montree = (l) => ({ numero: l.numero, heure: l.heure, severite: l.severite, message: l.message, detail: l.detail });

/** Les lignes à montrer, la plus récente en dernier. */
export const lignes = () => [...serveur, ...locales].map(montree);

/** `rien`, `avertissements` ou `erreurs` : la ligne la plus grave. */
export function gravite() {
  const toutes = [...serveur, ...locales];
  if (toutes.some((l) => l.severite === "erreur")) return "erreurs";
  return toutes.some((l) => l.severite === "avertissement") ? "avertissements" : "rien";
}

async function envoyer() {
  if (envoi) return envoi;
  const lot = locales.filter((l) => !l.envoyee && !l.enCours);
  if (!lot.length) return;
  // « En cours » : si la relecture rapporte la ligne avant la fin de l'envoi, elle est déjà reconnue.
  for (const l of lot) l.enCours = true;
  envoi = (async () => {
    const ok = await ecrireJournal(lot.map((l) => ({ heure: l.heure, severite: VERS_SERVEUR[l.severite], message: l.message, detail: l.detail })));
    envoi = null;
    for (const l of lot) {
      l.enCours = false;
      l.envoyee = ok;
    }
    if (ok && locales.some((l) => !l.envoyee)) await envoyer();
  })();
  return envoi;
}

/** Écrit une ligne : montrée aussitôt, envoyée au serveur dès que possible. `severite` : information, avertissement ou erreur. */
export function journaliser({ severite, message, detail, heure = Date.now() }) {
  const ligne = { heure, severite, message, detail: detail || undefined, envoyee: false };
  locales.push(ligne);
  prevenir({ type: "ajout", ligne: montree(ligne) });
  envoyer();
}

/** Envoie les lignes gardées pendant une coupure. */
export const envoyerEnAttente = () => envoyer();

/** Relit les lignes du serveur après la dernière vue ; une purge faite ailleurs vide ce qui est montré. */
export async function relire() {
  let r = await lireJournal(dernier);
  if (!r) return;
  let remplace = false;
  if (purge !== undefined && r.purge !== purge) {
    serveur = [];
    locales = locales.filter((l) => !l.envoyee && !l.enCours);
    dernier = 0;
    remplace = true;
    r = await lireJournal(0);
    if (!r) return prevenir({ type: "remplace", lignes: lignes() });
  }
  purge = r.purge;
  const nouvelles = (r.lignes ?? []).map((l) => ({ ...l, severite: DU_SERVEUR[l.severite] ?? "information", detail: l.detail ?? undefined }));
  for (const l of nouvelles) {
    // Une ligne de la page déjà envoyée revient avec le serveur : elle est déjà montrée.
    const i = locales.findIndex((x) => (x.envoyee || x.enCours) && x.heure === l.heure && x.severite === l.severite && x.message === l.message);
    if (i >= 0) locales.splice(i, 1);
    serveur.push(l);
    dernier = l.numero;
    if (i < 0 && !remplace) prevenir({ type: "ajout", ligne: montree(l) });
  }
  if (remplace) prevenir({ type: "remplace", lignes: lignes() });
}

/** Vide le journal du serveur et ce qui est montré ; rend `true`, ou `false` pendant une coupure (toast, rien n'est purgé). */
export async function purger() {
  const r = await purgerJournal();
  if (r === "coupure") {
    afficher({ texte: "Connexion perdue. Réessayez au retour.", variante: "alerte", cause: "reessayer" });
    return false;
  }
  if (r !== "ok") return false;
  serveur = [];
  locales = [];
  dernier = 0;
  purge = undefined;
  prevenir({ type: "remplace", lignes: [] });
  return true;
}

const lieu = (pile) => /([^\s(]+?):(\d+):\d+\)?\s*$/m.exec(String(pile ?? "").split("\n").slice(1).join("\n"));

/** Toute erreur JavaScript non rattrapée devient une ligne « Erreur ». */
export function suivreErreursPage(cible = window) {
  const ligne = (message, fichier, numero) => journaliser({ severite: "erreur", message: `Erreur JavaScript : ${message} (${fichier}, ligne ${numero}).` });
  cible.addEventListener("error", (e) => ligne(e.error?.message ?? e.message, e.filename || "inconnu", e.lineno || 0));
  cible.addEventListener("unhandledrejection", (e) => {
    const m = lieu(e.reason?.stack);
    ligne(e.reason?.message ?? String(e.reason), m?.[1] ?? "inconnu", m?.[2] ?? 0);
  });
}
