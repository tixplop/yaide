import * as apiReelle from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { conversation } from "../ui/conversation.js";
import { indication } from "../ui/indication.js";
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

/**
 * V-007. `api` : `reglagesAgent`, `envoyerMessage`, `lireConversation`, `arreterConversation`.
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
  const fil = conversation({ vide });
  fil.classList.add("agent-fil");

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
    if (!r?.conversation) return majBoutons();
    if (convId !== r.conversation) {
      convId = r.conversation;
      generation++;
    }
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
  arreter.addEventListener("click", () => {
    if (convId) api.arreterConversation(convId);
  });
  nouvelle.addEventListener("click", () => {
    generation++;
    clearTimeout(minuteur);
    convId = null;
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
      if (oui) relireReglages();
    },
    detruire() {
      detruite = true;
      clearTimeout(minuteur);
    },
  };
}
