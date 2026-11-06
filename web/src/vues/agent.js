import * as apiReelle from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { conversation } from "../ui/conversation.js";
import { indication } from "../ui/indication.js";
import { menu } from "../ui/menu.js";
import { message } from "../ui/message.js";
import { ecrire, lire } from "../stockage.js";
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

/** Heure d'une conversation (aujourd'hui), « hier » ou la date courte (« 4 nov. »). */
export function quand(ms, maintenant = new Date()) {
  const d = new Date(ms);
  const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86_400_000);
  if (ecart === 0) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (ecart === 1) return "hier";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
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
 * V-007. `api` : `reglagesAgent`, `envoyerMessage`, `lireConversation`, `arreterConversation`, `listeConversations`.
 * Rend `{ corps, montrer(oui), focuser(), relireReglages(), detruire() }`.
 */
export function vueAgent({ api = apiReelle, ouvrirProfils = ouvrirProfilsReel } = {}) {
  const corps = document.createElement("div");
  corps.className = "agent-corps";
  corps.hidden = true;

  let reglages = null; // { providers, profils, erreur }
  let profilId = null;
  let convId = null;
  let titre = null;
  let tokens = 0;
  let entrees = [];
  let enCours = false;
  let envoi = false; // un envoi attend la réponse du serveur
  let chargements = 0; // change à chaque ouverture de conversation demandée
  let refus = null; // C-003 de refus d'envoi
  let alerteReglages = null; // C-003 des réglages illisibles
  let restauree = false;
  let generation = 0; // change avec la conversation : une relecture en retard est ignorée
  let minuteur = null;
  let detruite = false;

  const profils = () => reglages?.profils ?? [];
  const defaut = () => profils().find((p) => p.defaut) ?? profils()[0];
  const profilCourant = () => profils().find((p) => p.id === profilId);

  // En-tête.
  const entete = document.createElement("div");
  entete.className = "agent-entete";
  const zoneTitre = document.createElement("div");
  zoneTitre.className = "agent-titre";
  const nouvelle = bouton({ icone: "message-square-plus", nomAccessible: "Nouvelle conversation", taille: "ligne" });
  const liste = bouton({ icone: "history", nomAccessible: "Conversations", taille: "ligne", ouvreMenu: true, desactive: true });
  entete.append(zoneTitre, nouvelle.enveloppe, liste.enveloppe);

  // Fil.
  const vide = document.createElement("div");
  let fil = nouveauFil();
  function nouveauFil() {
    const f = conversation({ vide });
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
  const champMessage = champ({ libelle: "Message à l'agent", type: "multiligne", indication: "Message (Entrée pour envoyer)", libelleMasque: true });
  const texteSaisi = champMessage.querySelector("textarea");
  const barre = document.createElement("div");
  barre.className = "agent-barre";
  let champProfil = null;
  const compteur = document.createElement("span");
  compteur.className = "agent-compteur";
  const arreter = bouton({ icone: "circle-stop", nomAccessible: "Arrêter", infoBulle: "Arrêter" });
  arreter.enveloppe.hidden = true;
  const envoyer = bouton({ icone: "send-horizontal", nomAccessible: "Envoyer", infoBulle: "Envoyer (Entrée)", desactive: true });
  barre.append(compteur, arreter.enveloppe, envoyer.enveloppe);
  saisie.append(champMessage, barre);
  corps.append(entete, fil, saisie);

  const focuser = () => texteSaisi.focus();

  function dessinerProfils() {
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

  function majCompteur() {
    const fenetre = profilCourant()?.fenetre;
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
    envoyer.disabled = enCours || envoi || !profilCourant() || !texteSaisi.value.trim();
    arreter.enveloppe.hidden = !enCours;
  }

  function afficher() {
    zoneTitre.textContent = titre || "Nouvelle conversation";
    zoneTitre.classList.toggle("vide", !titre);
    const dernier = entrees[entrees.length - 1];
    fil.mettreAJour(entrees, enCours && !(dernier?.type === "outil" && dernier.etat === "enCours"));
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
    const depuis = Math.max(entrees.length - 1, 0);
    const r = await api.lireConversation(convId, depuis);
    if (detruite || gen !== generation) return;
    if (!Array.isArray(r?.entrees)) {
      // Coupure ou erreur passagère : la relecture reprend au retour. Une conversation disparue s'arrête.
      if (r?.introuvable) terminer();
      else planifier(gen);
      return;
    }
    entrees = [...entrees.slice(0, depuis), ...r.entrees];
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
    const r = await api.envoyerMessage({ conversation: convId, profil: profilId, texte });
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
      ecrire("agent", { conversation: convId });
    }
    liste.disabled = false;
    entrees = [...entrees, { type: "utilisateur", texte }];
    texteSaisi.value = "";
    enCours = true;
    afficher();
    focuser();
    clearTimeout(minuteur);
    planifier(generation);
  }

  texteSaisi.addEventListener("input", majBoutons);
  texteSaisi.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    e.preventDefault();
    envoyerMessage();
  });
  envoyer.addEventListener("click", envoyerMessage);
  arreter.addEventListener("click", async () => {
    if (!convId) return;
    const gen = generation;
    await api.arreterConversation(convId);
    if (detruite || gen !== generation) return;
    // Relecture tout de suite : « Arrêté. » vient du serveur, la vue continue jusqu'à la fin du tour.
    clearTimeout(minuteur);
    relire(gen);
  });

  /** Ouvre une conversation enregistrée, en bas du fil, avec son profil. Vrai si elle est affichée. */
  async function charger(id) {
    const jeton = ++chargements;
    const r = await api.lireConversation(id, 0);
    if (detruite || jeton !== chargements) return false;
    if (!Array.isArray(r?.entrees)) {
      if (r?.introuvable) ecrire("agent", { conversation: null });
      return false;
    }
    generation++;
    clearTimeout(minuteur);
    convId = id;
    titre = r.titre ?? null;
    tokens = r.tokens ?? 0;
    entrees = r.entrees;
    enCours = Boolean(r.enCours);
    profilId = r.profil ?? null;
    effacerRefus();
    dessinerProfils();
    remplacerFil();
    afficher();
    ecrire("agent", { conversation: id });
    if (enCours) planifier(generation);
    return true;
  }

  async function restaurer() {
    if (restauree) return;
    restauree = true;
    const gardee = await lire("agent");
    if (detruite || convId || !gardee?.conversation) return;
    await charger(gardee.conversation);
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
          surChoix: () => charger(c.id).then((ok) => ok && focuser()),
        })),
      ],
      surFermeture: () => {},
    });
  });
  nouvelle.addEventListener("click", () => {
    generation++;
    chargements++;
    clearTimeout(minuteur);
    convId = null;
    effacerRefus();
    remplacerFil();
    ecrire("agent", { conversation: null });
    titre = null;
    tokens = 0;
    entrees = [];
    enCours = false;
    profilId = defaut()?.id ?? null;
    dessinerProfils();
    afficher();
    focuser();
  });

  majVide();
  afficher();

  return {
    corps,
    focuser,
    relireReglages,
    montrer(oui) {
      corps.hidden = !oui;
      if (oui) {
        majListe();
        relireReglages().then(restaurer);
      }
    },
    detruire() {
      detruite = true;
      clearTimeout(minuteur);
    },
  };
}
