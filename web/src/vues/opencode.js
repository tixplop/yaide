import * as apiReelle from "../api.js";
import * as ocReel from "../opencode.js";
import { conversation, attentes } from "../ui/conversation.js";
import { indication } from "../ui/indication.js";
import { message } from "../ui/message.js";
import { saisieMessage } from "./agent.js";

const TEXTE_VIDE = "Écrivez un message pour commencer.";
const TEXTE_DISPARUE = "Cette session n'existe plus dans opencode. Fermez cet onglet.";
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const TEXTE_NOTE = "Ce sous-agent est conduit par l'agent qui l'a lancé.";

function texteRefus(r) {
  if (r.coupure) return TEXTE_COUPURE;
  return `opencode ne répond pas : ${r.erreur}. Réessayez.`;
}

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
      effacerRefus();
      refus = message({ texte: texteRefus(r), variante: "erreur", fermable: true });
      refus.addEventListener("click", (e) => {
        if (e.target.closest("button")) champ.focus();
      });
      champ.closest(".session-saisie").before(refus);
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
