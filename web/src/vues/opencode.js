import * as apiReelle from "../api.js";
import * as ocReel from "../opencode.js";
import { champ as champUi } from "../ui/champ.js";
import { conversation, attentes } from "../ui/conversation.js";
import { indication } from "../ui/indication.js";
import { message } from "../ui/message.js";
import { formaterTokens, saisieMessage } from "./agent.js";

const TEXTE_VIDE = "Écrivez un message pour commencer.";
const TEXTE_DISPARUE = "Cette session n'existe plus dans opencode. Fermez cet onglet.";
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const TEXTE_NOTE = "Ce sous-agent est conduit par l'agent qui l'a lancé.";

function texteRefus(r) {
  if (r.coupure) return TEXTE_COUPURE;
  return `opencode ne répond pas : ${r.erreur}. Réessayez.`;
}

const TEXTE_SANS_EFFORT = "Ce modèle n'a pas d'effort à choisir.";
const TEXTE_INDISPONIBLE = "Liste indisponible pour l'instant.";
const SANS_MODELE = { chargement: "Chargement…", illisible: "Indisponible", aucun: "Aucun modèle" };

const reussie = (r) => !r?.coupure && !r?.erreur;

/**
 * V-002, session opencode (C-015, C-003). `oc` : le modèle de `opencode.js` ; `api` : `envoyer`, `interrompre`.
 * `surOuvrir({ id, agent, titre })` ouvre l'onglet d'un sous-agent ; `surQuestion(vrai|faux)` dit si une demande attend.
 * Rend `{ corps, focus(), detruire() }`.
 */
export function vueOpencode({ sessionId, sousAgent = false, surOuvrir, surQuestion, oc = ocReel, api = apiReelle }) {
  const corps = document.createElement("div");
  corps.className = "session";

  let detruite = false;
  let charge = false;
  let envoi = false;
  let dernier = null; // dernier modèle de la session
  let demandes = []; // dernières demandes affichées
  let marque = false;
  let fil = null;
  let refus = null;
  let disparueALEnvoi = false; // un envoi a appris que la session n'existe plus
  let surDemande = false; // le dernier focus était dans les demandes (leurs boutons sont refaits pendant l'envoi)

  // Zone du fil : « Chargement… », puis la conversation, ou l'erreur d'une session disparue.
  const zoneFil = document.createElement("div");
  zoneFil.className = "session-conversation";
  const attente = indication({ texte: "Chargement…", variante: "chargement" });
  zoneFil.append(attente);

  const bas = document.createElement("div");
  bas.className = "session-bas";
  const region = attentes({
    surAutorisation: (id, decision) => repondre(id, (d) => oc.repondreAutorisation(d.sessionId, id, decision)),
    surReponse: (id, reponse) => repondre(id, (d) => oc.repondreQuestion(d.sessionId, id, reponse)),
    surIgnorer: (id) => repondre(id, (d) => oc.ignorerQuestion(d.sessionId, id)),
  });
  region.classList.add("session-attentes", "session-contenu");
  region.addEventListener("focusin", () => {
    surDemande = true;
  });
  region.addEventListener("focusout", (e) => {
    if (e.relatedTarget && !region.contains(e.relatedTarget)) surDemande = false;
  });

  let saisie = null;
  let champ = null;
  let listeModele = null; // { enveloppe, select, signature }
  let listeEffort = null;
  let compteur = null;
  if (sousAgent) {
    const note = document.createElement("div");
    note.className = "session-contenu";
    note.append(message({ texte: TEXTE_NOTE, variante: "info" }));
    bas.append(note);
  } else {
    saisie = saisieMessage({ libelle: "Message à opencode", surEnvoi: () => envoyerMessage() });
    champ = saisie.texteSaisi;
    const zone = document.createElement("div");
    zone.className = "session-contenu session-saisie";
    zone.append(saisie.champMessage, saisie.barre);
    bas.append(zone);
    listeModele = creerListe("Modèle", (e) => choisir(e.target.value, null));
    listeEffort = creerListe("Effort", (e) => choisir(oc.choixModele(sessionId).courant?.cle, e.target.value || null));
    compteur = document.createElement("span");
    compteur.className = "agent-compteur";
    compteur.hidden = true;
    saisie.barre.prepend(listeModele.enveloppe, listeEffort.enveloppe, compteur);
    champ.addEventListener("input", majBoutons);
    saisie.arreter.addEventListener("click", () => {
      api.interrompre(sessionId);
    });
  }
  corps.append(zoneFil, bas);
  corps.addEventListener("focusin", (e) => {
    if (!region.contains(e.target)) surDemande = false;
  });

  const focus = () => (sousAgent ? fil : champ)?.focus();

  function majBoutons() {
    if (!saisie) return;
    const enCours = Boolean(dernier?.enCours);
    saisie.envoyer.disabled = enCours || envoi || !champ.value.trim();
    saisie.arreter.enveloppe.hidden = !enCours;
  }

  function creerListe(libelle, surChoix) {
    const enveloppe = champUi({ libelle, type: "liste", presentation: "barre", desactive: true });
    const select = enveloppe.querySelector("select");
    select.addEventListener("change", surChoix);
    return { enveloppe, select, signature: null };
  }

  /** Options et valeur d'une liste ; les options ne sont refaites que si elles changent (une liste ouverte reste ouverte). */
  function remplir(liste, options, valeur, desactive, titre) {
    const signature = JSON.stringify(options);
    if (signature !== liste.signature) {
      liste.signature = signature;
      liste.select.replaceChildren(
        ...options.map(([v, t]) => {
          const o = document.createElement("option");
          o.value = v;
          o.textContent = t;
          return o;
        }),
      );
    }
    liste.select.value = valeur;
    liste.select.disabled = desactive;
    liste.select.title = titre ?? "";
  }

  function majListes() {
    if (!listeModele) return;
    const c = oc.choixModele(sessionId);
    const surEffort = document.activeElement === listeEffort.select;
    const pret = c.etat === "pret";
    const illisible = c.etat === "illisible";
    const optionsModele = c.modeles.length ? c.modeles.map((m) => [m.cle, m.texte]) : [["", SANS_MODELE[c.etat] ?? SANS_MODELE.aucun]];
    const texteModele = optionsModele.find(([v]) => v === (c.courant?.cle ?? ""))?.[1];
    remplir(listeModele, optionsModele, c.courant?.cle ?? "", !pret, illisible ? TEXTE_INDISPONIBLE : pret ? texteModele : "");
    const optionsEffort = [["", "Par défaut"], ...c.efforts.map((e) => [e, e])];
    const effort = c.courant?.variante ?? "";
    const sansEffort = pret && c.efforts.length === 0;
    remplir(listeEffort, optionsEffort, effort, !pret || sansEffort, illisible ? TEXTE_INDISPONIBLE : sansEffort ? TEXTE_SANS_EFFORT : pret ? effort || "Par défaut" : "");
    if (surEffort && listeEffort.select.disabled) listeModele.select.focus();
  }

  /** Tokens occupés, fenêtre et pourcentage ; caché tant que la fenêtre du modèle affiché est inconnue. */
  function majCompteur() {
    if (!compteur) return;
    const c = oc.contexteSession(sessionId);
    compteur.hidden = !c;
    if (!c) return;
    const tokens = formaterTokens(c.tokens);
    const fenetre = formaterTokens(c.fenetre);
    compteur.textContent = `${tokens} / ${fenetre} · ${c.pourcent} %`;
    compteur.setAttribute("aria-label", `Contexte : ${tokens} tokens sur ${fenetre}, ${c.pourcent} %`);
    compteur.setAttribute("role", "img");
  }

  async function choisir(cle, variante) {
    const r = await oc.choisirModele(sessionId, cle, variante);
    if (detruite) return;
    if (r?.disparue) {
      disparueALEnvoi = true;
    } else if (reussie(r)) effacerRefus();
    else afficherRefus(r);
    dessiner();
  }

  function afficherRefus(r) {
    effacerRefus();
    refus = message({ texte: texteRefus(r), variante: "erreur", fermable: true });
    refus.addEventListener("click", (e) => {
      if (e.target.closest("button")) champ.focus();
    });
    champ.closest(".session-saisie").before(refus);
  }

  function effacerRefus() {
    refus?.remove();
    refus = null;
  }

  async function envoyerMessage() {
    const texte = champ.value;
    if (saisie.envoyer.disabled || !texte.trim()) return;
    envoi = true;
    majBoutons();
    const r = await api.envoyer(sessionId, texte);
    envoi = false;
    if (detruite) return;
    if (r.disparue) {
      // La session n'existe plus : l'état « session disparue » remplace la conversation.
      disparueALEnvoi = true;
      dessiner();
      return;
    }
    if (!reussie(r)) {
      majBoutons();
      afficherRefus(r);
      return;
    }
    effacerRefus();
    if (champ.value === texte) champ.value = "";
    majBoutons();
  }

  /** Répond à une demande ; réussie, le focus qui était dans les demandes va dans le champ (ou sur le fil). */
  async function repondre(id, agir) {
    const d = demandes.find((x) => x.id === id);
    if (!d) return { erreur: "demande inconnue" };
    const r = await agir(d);
    if (!detruite && reussie(r) && surDemande) focus();
    return r;
  }

  function dessiner() {
    if (detruite) return;
    const m = oc.modeleSession(sessionId);
    if (m) dernier = m;
    demandes = oc.attentes(sessionId);
    if ((demandes.length > 0) !== marque) {
      marque = demandes.length > 0;
      surQuestion?.(marque);
    }
    if (m?.disparue || disparueALEnvoi) {
      const e = document.createElement("div");
      e.className = "session-contenu";
      e.append(message({ texte: TEXTE_DISPARUE, variante: "erreur" }));
      zoneFil.replaceChildren(e);
      fil = null;
      bas.remove();
      return;
    }
    majListes();
    majCompteur();
    if (!charge || !m) return;
    if (!bas.isConnected) corps.append(bas);
    if (!fil) {
      const vide = indication({ texte: TEXTE_VIDE });
      fil = conversation({
        vide,
        nom: sousAgent ? m.agent || "opencode" : "opencode",
        surOuvrir: (id) => {
          const e = dernier.entrees.find((x) => x.type === "sousAgent" && x.id === id);
          surOuvrir?.({ id, agent: e?.agent ?? "", titre: e?.titre ?? "" });
        },
      });
      fil.classList.add("session-contenu");
      zoneFil.replaceChildren(fil);
    }
    // Le modèle ne dit pas la variante : l'échec d'un tour est une erreur (`role="alert"`).
    fil.mettreAJour(
      m.entrees.map((e) => (e.type === "message" ? { ...e, variante: "erreur" } : e)),
      m.enAttente,
    );
    region.mettreAJour(demandes);
    if (demandes.length === 0) region.remove();
    else if (!region.isConnected) bas.prepend(region);
    if (saisie) {
      // « Arrêter » disparaît : le focus qu'il avait va dans le champ.
      const surArreter = saisie.arreter.enveloppe.contains(document.activeElement);
      majBoutons();
      if (surArreter && saisie.arreter.enveloppe.hidden) champ.focus();
    }
  }

  const desabonner = oc.abonner(sessionId, dessiner);
  Promise.resolve(oc.pret(sessionId)).then(() => {
    charge = true;
    dessiner();
  });
  dessiner();

  return {
    corps,
    focus,
    detruire() {
      detruite = true;
      desabonner();
    },
  };
}
