import * as apiReelle from "../api.js";
import { avatar } from "../ui/avatar.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { conversation } from "../ui/conversation.js";
import { indication } from "../ui/indication.js";
import { menu } from "../ui/menu.js";
import { message } from "../ui/message.js";
import { ouvrirProfils as ouvrirProfilsReel } from "./profils.js";

const INTERVALLE = 500;
const TEXTE_VIDE = "Écrivez un message pour commencer.";
const TEXTE_AUCUN_PROFIL = "Aucun profil. Créez-en un avec Ctrl+P, puis > Profils de modèle.";

/** Tokens pour le compteur : exact sous 1 000, en milliers (« 12 k ») puis en millions (« 1,5 M »), arrondis vers le bas. */
export function formaterTokens(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.floor(n / 1000)} k`;
  return `${String(Math.floor(n / 100_000) / 10).replace(".", ",")} M`;
}

/** Heure d'une conversation (aujourd'hui), « hier » ou la date courte (« 4 nov. ») ; `avecAnnee` : « 12 déc. 2025 » hors de l'année en cours. */
export function quand(ms, maintenant = new Date(), avecAnnee = false) {
  const d = new Date(ms);
  const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86_400_000);
  if (ecart === 0) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (ecart === 1) return "hier";
  const autreAnnee = avecAnnee && d.getFullYear() !== maintenant.getFullYear();
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(autreAnnee ? { year: "numeric" } : {}) });
}

/**
 * Le serveur donne le texte de l'agent en `texte` ; le fil le rend en markdown. Le raisonnement d'une étape
 * (`raisonnement`, non vide) devient une entrée avant la réponse, du même auteur ; la réponse vide n'est pas montrée.
 */
function pourLeFil(e, rang) {
  if (e.type !== "agent") return [e];
  const liste = [];
  if (typeof e.raisonnement === "string" && e.raisonnement.trim()) {
    liste.push({ type: "raisonnement", id: `rsn:${rang}`, markdown: e.raisonnement, ...(e.auteur ? { auteur: e.auteur } : {}) });
  }
  const reste = { ...e };
  delete reste.raisonnement;
  const reponse = e.markdown === undefined ? { ...reste, markdown: e.texte ?? "" } : reste;
  if (!liste.length || String(reponse.markdown).trim()) liste.push(reponse);
  return liste;
}

function texteRefus(r) {
  if (r.coupure) return "Connexion perdue. Réessayez au retour.";
  if (r.refus === "sans-cle") return `Aucune clé pour ${r.provider}. Ajoutez-la avec Ctrl+P, puis > Providers LLM.`;
  if (r.refus === "contexte-plein") return "Contexte plein. Ouvrez une nouvelle conversation.";
  if (r.refus === "sans-profil") return TEXTE_AUCUN_PROFIL;
  if (r.refus === "en-cours") return "L'agent travaille encore. Attendez la fin du tour ou arrêtez-le.";
  return r.message || "Message refusé.";
}

/** « <chemin> est illisible : … » du serveur, en phrase qui nomme le fichier (depuis `.yaide/` s'il y est). */
function texteReglagesIllisibles(erreur) {
  const m = /^(.*?) est illisible/.exec(erreur);
  if (!m) return erreur;
  const i = m[1].indexOf(".yaide/");
  return `${i >= 0 ? m[1].slice(i) : m[1]} est illisible. Corrigez-le ou enregistrez de nouveaux réglages.`;
}

/**
 * Zone de saisie commune aux vues Agent et opencode : champ multiligne (Entrée envoie, Maj+Entrée ajoute une ligne),
 * « Arrêter » (masqué) et « Envoyer » (désactivé). `retenirEntree()` vrai : Entrée n'envoie pas (une liste de suggestions la prend). Rend `{ champMessage, texteSaisi, barre, arreter, envoyer }`.
 */
export function saisieMessage({ libelle, surEnvoi, retenirEntree }) {
  const champMessage = champ({ libelle, type: "multiligne", indication: "Message (Entrée pour envoyer)", libelleMasque: true });
  const texteSaisi = champMessage.querySelector("textarea");
  const barre = document.createElement("div");
  barre.className = "agent-barre";
  const arreter = bouton({ icone: "circle-stop", nomAccessible: "Arrêter", infoBulle: "Arrêter" });
  arreter.enveloppe.hidden = true;
  const envoyer = bouton({ icone: "send-horizontal", nomAccessible: "Envoyer", infoBulle: "Envoyer (Entrée)", desactive: true });
  barre.append(arreter.enveloppe, envoyer.enveloppe);
  texteSaisi.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    if (retenirEntree?.()) return;
    e.preventDefault();
    surEnvoi();
  });
  envoyer.addEventListener("click", () => surEnvoi());
  return { champMessage, texteSaisi, barre, arreter, envoyer };
}

/**
 * V-007. `api` : `reglagesAgent`, `envoyerMessage`, `lireConversation`, `arreterConversation`, `listeConversations`.
 * Vue d'un onglet de l'éditeur (REQ-078) : `conversation` (id à charger à la création) ou `equipe`
 * (agents d'une conversation vide) disent d'où part la vue, `surConversation(id | null)` est appelée à chaque changement de conversation
 * (rien n'est gardé ici), `ouvrirReference({ chemin, ligne }, lien)` ouvre un fichier cité par une réponse, et `surDejaOuverte(id)` rend vrai si un autre onglet affiche `id` et vient d'être activé : le menu ne charge alors rien.
 * Rend `{ corps, focuser(), relireReglages(), majListe(), detruire() }`.
 */
export function vueAgent({ api = apiReelle, ouvrirProfils = ouvrirProfilsReel, conversation: conversationGardee, equipe: agentsInitiaux, surConversation = () => {}, surDejaOuverte, ouvrirReference } = {}) {
  const corps = document.createElement("div");
  corps.className = "agent-corps";

  let reglages = null; // { providers, profils, erreur }
  let profilId = null;
  let convId = null;
  let titre = null;
  let tokens = 0;
  let entrees = [];
  let entreesBrutes = [];
  let enCours = false;
  let envoi = false; // un envoi attend la réponse du serveur
  let chargements = 0; // change à chaque ouverture de conversation demandée
  let refus = null; // C-003 de refus d'envoi
  let alerteReglages = null; // C-003 des réglages illisibles
  let generation = 0; // change avec la conversation : une relecture en retard est ignorée
  let minuteur = null;
  let detruite = false;
  let equipe = null; // agents de la conversation (copie du serveur), ou null sans agent personnalisé
  let actif = null; // dossier de l'agent dont c'est le tour
  let dernierDossier = null; // dernier agent qui a répondu

  let retour = null; // nouvelle tentative d'ouverture de la conversation gardée, après une coupure

  const profils = () => reglages?.profils ?? [];
  const defaut = () => profils().find((p) => p.defaut) ?? profils()[0];
  const profilCourant = () => profils().find((p) => p.id === profilId);

  // En-tête.
  const entete = document.createElement("div");
  entete.className = "agent-entete";
  const zoneTitre = document.createElement("div");
  zoneTitre.className = "agent-titre";
  const nouvelle = bouton({ icone: "message-square-plus", nomAccessible: "Nouvelle conversation" });
  const liste = bouton({ icone: "history", nomAccessible: "Conversations", ouvreMenu: true, desactive: true });
  entete.append(zoneTitre, nouvelle.enveloppe, liste.enveloppe);
  const ligneAgents = document.createElement("div");
  ligneAgents.className = "ya-agents";
  ligneAgents.setAttribute("role", "list");
  ligneAgents.setAttribute("aria-label", "Agents de la conversation");
  ligneAgents.hidden = true;

  const auteurDe = (dossier) => {
    const a = equipe?.find((x) => x.dossier === dossier);
    return a ? { nom: a.nom, avatar: a.avatar, couleur: a.couleur } : { nom: String(dossier), couleur: "violet" };
  };
  /** Chaque entrée d'un agent reçoit son auteur ; le dernier agent à répondre est retenu. */
  function pourLeFilAgents(e) {
    if (typeof e.auteur !== "string") return e;
    if (e.type === "agent") dernierDossier = e.auteur;
    return { ...e, auteur: auteurDe(e.auteur) };
  }
  // `brutes` : les entrées du serveur (la relecture compte en elles) ; `entrees` : ce que le fil montre.
  function fixerEntrees(brutes) {
    entreesBrutes = brutes;
    entrees = brutes.flatMap((e, i) => pourLeFil(e, i));
  }
  function fixerEquipe(agents) {
    equipe = Array.isArray(agents) && agents.length ? agents.map((a) => ({ ...a })) : null;
    ligneAgents.hidden = !equipe;
    ligneAgents.replaceChildren(
      ...(equipe ?? []).map((a) => {
        const item = document.createElement("span");
        item.className = "a";
        item.setAttribute("role", "listitem");
        item.append(avatar(a), a.nom);
        return item;
      }),
    );
    dessinerProfils();
  }

  // Fil.
  const vide = document.createElement("div");
  let fil = nouveauFil();
  function nouveauFil() {
    const f = conversation({ vide, surOuvrirFichier: (ref) => ouvrirReference?.(ref, document.activeElement) });
    f.classList.add("agent-fil");
    return f;
  }
  // Le fil se rend entrée par entrée : une autre conversation demande un fil neuf, en bas.
  function remplacerFil() {
    const neuf = nouveauFil();
    fil.replaceWith(neuf);
    fil = neuf;
  }

  // Saisie.
  const saisie = document.createElement("div");
  saisie.className = "agent-saisie";
  const { champMessage, texteSaisi, barre, arreter, envoyer } = saisieMessage({ libelle: "Message à l'agent", surEnvoi: () => envoyerMessage() });
  let champProfil = null;
  const compteur = document.createElement("span");
  compteur.className = "agent-compteur";
  barre.prepend(compteur);
  saisie.append(champMessage, barre);
  corps.append(entete, ligneAgents, fil, saisie);

  const focuser = () => texteSaisi.focus();

  function dessinerProfils() {
    if (equipe) {
      champProfil?.remove();
      champProfil = null;
      return;
    }
    if (!profils().some((p) => p.id === profilId)) profilId = defaut()?.id ?? null;
    const noms = profils().map((p) => p.nom);
    const nouveau = champ({
      libelle: "Profil",
      type: "liste",
      libelleMasque: true,
      options: noms.length ? noms : ["Aucun profil"],
      valeur: profilCourant()?.nom,
      desactive: !noms.length,
    });
    nouveau.querySelector("select").addEventListener("change", (e) => {
      profilId = profils().find((p) => p.nom === e.target.value)?.id ?? profilId;
      majCompteur();
    });
    if (champProfil) champProfil.replaceWith(nouveau);
    else barre.prepend(nouveau);
    champProfil = nouveau;
  }

  /** Fenêtre du profil : celui de la conversation, ou avec des agents celui du dernier qui a répondu (sinon du premier). */
  function fenetreCourante() {
    if (!equipe) return profilCourant()?.fenetre;
    const a = equipe.find((x) => x.dossier === dernierDossier) ?? equipe[0];
    return (profils().find((p) => p.id === a.profil) ?? defaut())?.fenetre;
  }

  function majCompteur() {
    const fenetre = fenetreCourante();
    compteur.hidden = !fenetre;
    if (!fenetre) return;
    const dit = `${formaterTokens(tokens)} / ${formaterTokens(fenetre)}`;
    compteur.textContent = dit;
    compteur.setAttribute("aria-label", `Contexte : ${formaterTokens(tokens)} tokens sur ${formaterTokens(fenetre)}`);
    // Le nom accessible d'un texte sans rôle n'est pas lu : le rôle le porte.
    compteur.setAttribute("role", "img");
  }

  function majVide() {
    vide.replaceChildren();
    if (profils().length || !reglages) {
      vide.append(indication({ texte: TEXTE_VIDE }));
      return;
    }
    const creer = bouton({ libelle: "Créer un profil" });
    creer.addEventListener("click", () => {
      ouvrirProfils({
        retour: (avecProfil) => {
          relireReglages().then(() => (avecProfil ? focuser() : vide.querySelector("button")?.focus()));
        },
      });
    });
    vide.append(indication({ texte: TEXTE_AUCUN_PROFIL, action: creer }));
  }

  function effacerRefus() {
    refus?.remove();
    refus = null;
  }
  function montrerRefus(texte) {
    effacerRefus();
    refus = message({ texte, variante: "erreur", fermable: true });
    refus.addEventListener("click", (e) => {
      if (e.target.closest("button")) focuser();
    });
    champMessage.before(refus);
  }
  function majAlerteReglages(erreur) {
    alerteReglages?.remove();
    alerteReglages = null;
    if (!erreur) return;
    alerteReglages = message({ texte: texteReglagesIllisibles(String(erreur)), variante: "erreur" });
    saisie.prepend(alerteReglages);
  }

  function majBoutons() {
    envoyer.disabled = enCours || envoi || !(equipe ? profils().length : profilCourant()) || !texteSaisi.value.trim();
    arreter.enveloppe.hidden = !enCours;
  }

  function afficher() {
    zoneTitre.textContent = titre || "Nouvelle conversation";
    zoneTitre.classList.toggle("vide", !titre);
    const dernier = entrees[entrees.length - 1];
    const attend = enCours && !(dernier?.type === "outil" && dernier.etat === "enCours");
    fil.mettreAJour(entrees, equipe ? attend && actif != null && auteurDe(actif) : attend);
    majCompteur();
    majBoutons();
  }

  async function relireReglages() {
    const r = await api.reglagesAgent();
    if (detruite || !Array.isArray(r?.profils)) return;
    reglages = r;
    majAlerteReglages(r.erreur);
    dessinerProfils();
    majVide();
    majCompteur();
    majBoutons();
  }

  // Relecture d'un tour : depuis la dernière entrée connue, qui peut avoir changé d'état (outil).
  function planifier(gen) {
    minuteur = setTimeout(() => relire(gen), INTERVALLE);
  }
  async function relire(gen) {
    const depuis = Math.max(entreesBrutes.length - 1, 0);
    const r = await api.lireConversation(convId, depuis);
    if (detruite || gen !== generation) return;
    if (!Array.isArray(r?.entrees)) {
      // Coupure ou erreur passagère : la relecture reprend au retour. Une conversation disparue s'arrête.
      if (r?.introuvable) terminer();
      else planifier(gen);
      return;
    }
    if (Array.isArray(r.agents) && r.agents.length && !equipe) fixerEquipe(r.agents);
    actif = r.actif ?? null;
    fixerEntrees([...entreesBrutes.slice(0, depuis), ...r.entrees.map(pourLeFilAgents)]);
    titre = r.titre ?? titre;
    tokens = r.tokens ?? tokens;
    enCours = Boolean(r.enCours);
    if (enCours) planifier(gen);
    else terminer();
    afficher();
  }
  function terminer() {
    // « Arrêter » disparaît : le focus qu'il avait va dans le champ.
    if (document.activeElement === arreter) focuser();
    enCours = false;
    afficher();
  }

  async function envoyerMessage() {
    const texte = texteSaisi.value;
    if (envoyer.disabled || !texte.trim()) return;
    envoi = true;
    majBoutons();
    const r = await api.envoyerMessage(
      equipe && !convId
        ? { agents: equipe.map((a) => a.dossier), texte }
        : { conversation: convId, ...(equipe ? {} : { profil: profilId }), texte },
    );
    envoi = false;
    if (detruite) return;
    if (!r?.conversation) {
      majBoutons();
      montrerRefus(texteRefus(r ?? {}));
      return;
    }
    effacerRefus();
    if (convId !== r.conversation) {
      convId = r.conversation;
      generation++;
      surConversation(convId);
    }
    liste.disabled = false;
    fixerEntrees([...entreesBrutes, { type: "utilisateur", texte }]);
    texteSaisi.value = "";
    enCours = true;
    if (equipe) actif = equipe[0].dossier;
    afficher();
    focuser();
    clearTimeout(minuteur);
    planifier(generation);
  }

  texteSaisi.addEventListener("input", majBoutons);
  arreter.addEventListener("click", async () => {
    if (!convId) return;
    const gen = generation;
    await api.arreterConversation(convId);
    if (detruite || gen !== generation) return;
    // Relecture tout de suite : « Arrêté. » vient du serveur, la vue continue jusqu'à la fin du tour.
    clearTimeout(minuteur);
    relire(gen);
  });

  /**
   * Ouvre une conversation enregistrée, en bas du fil, avec son profil. Rend `true` si elle est affichée, sinon
   * `"introuvable"`, `"coupure"` ou `"obsolete"` (la vue a changé de conversation entre-temps ou a été détruite).
   * `garder` : faux pour la conversation que l'éditeur connaît déjà.
   */
  async function charger(id, garder = true) {
    const jeton = ++chargements;
    const r = await api.lireConversation(id, 0);
    if (detruite || jeton !== chargements) return "obsolete";
    if (!Array.isArray(r?.entrees)) {
      if (!r?.introuvable) return "coupure";
      return "introuvable";
    }
    generation++;
    clearTimeout(minuteur);
    convId = id;
    titre = r.titre ?? null;
    tokens = r.tokens ?? 0;
    dernierDossier = null;
    fixerEquipe(r.agents);
    actif = r.actif ?? null;
    fixerEntrees(r.entrees.map(pourLeFilAgents));
    enCours = Boolean(r.enCours);
    profilId = r.profil ?? null;
    effacerRefus();
    dessinerProfils();
    remplacerFil();
    afficher();
    if (garder) surConversation(id);
    if (enCours) planifier(generation);
    return true;
  }

  /** Conversation gardée par l'éditeur : réessayée tant que le serveur ne répond pas, l'onglet vidé si elle a disparu. */
  async function ouvrirGardee(id) {
    if (convId) return;
    const r = await charger(id, false);
    if (detruite || r === true || r === "obsolete" || convId) return;
    if (r === "introuvable") return surConversation(null);
    retour = setTimeout(() => ouvrirGardee(id), 1500);
  }

  async function majListe() {
    const l = await api.listeConversations();
    if (!detruite && Array.isArray(l)) liste.disabled = !l.length;
  }

  liste.addEventListener("click", async () => {
    const l = await api.listeConversations();
    if (detruite || !Array.isArray(l)) return;
    liste.disabled = !l.length;
    if (!l.length) return;
    menu({
      nom: "Conversations",
      ancre: liste,
      groupes: [
        l.map((c) => ({
          libelle: c.titre || "Nouvelle conversation",
          touche: quand(c.maj),
          surChoix: () => {
            if (c.id === convId) return focuser();
            if (surDejaOuverte?.(c.id)) return;
            charger(c.id).then((ok) => ok === true && focuser());
          },
        })),
      ],
      surFermeture: () => {},
    });
  });
  function viderConversation() {
    generation++;
    chargements++;
    clearTimeout(minuteur);
    clearTimeout(retour);
    convId = null;
    effacerRefus();
    remplacerFil();
    surConversation(null);
    titre = null;
    tokens = 0;
    fixerEntrees([]);
    enCours = false;
    actif = null;
    dernierDossier = null;
    profilId = defaut()?.id ?? null;
    fixerEquipe(null);
    afficher();
    focuser();
  }
  nouvelle.addEventListener("click", viderConversation);

  majVide();
  afficher();
  if (!conversationGardee) fixerEquipe(agentsInitiaux);
  majListe();
  relireReglages().then(() => conversationGardee && ouvrirGardee(conversationGardee));

  return {
    corps,
    focuser,
    relireReglages,
    majListe,
    detruire() {
      detruite = true;
      clearTimeout(minuteur);
      clearTimeout(retour);
    },
  };
}
