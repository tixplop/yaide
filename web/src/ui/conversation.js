import { icone } from "./icones.js";
import { indication } from "./indication.js";
import { message } from "./message.js";
import { rendreMarkdown } from "./apercu.js";

const ETATS = {
  enCours: { icone: "circle-dashed", nom: "en cours", classe: "encours" },
  reussi: { icone: "circle-check", nom: "réussi", classe: "ok" },
  echec: { icone: "circle-x", nom: "échec", classe: "ko" },
};
const MARGE_BAS = 24;
let compteur = 0;

function texteZone(zone, e) {
  zone.textContent = "";
  const arg = document.createElement("span");
  arg.className = "ya-step-cmd";
  arg.textContent = e.nom === "bash" ? `$ ${e.argument}` : String(e.argument ?? "");
  zone.append(arg, `\n${e.etat === "enCours" ? "En cours…" : (e.resultat ?? "")}`);
}

function rendreOutil(e, surDeplier) {
  const etat = ETATS[e.etat];
  if (!etat) throw new Error(`conversation : état inconnu « ${e.etat} »`);
  const racine = document.createElement("div");
  racine.className = "ya-steps";
  const zone = document.createElement("div");
  zone.id = `ya-conv-${++compteur}`;
  zone.className = "ya-step-res";
  zone.hidden = true;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ya-step";
  b.setAttribute("aria-expanded", "false");
  b.setAttribute("aria-controls", zone.id);
  const nom = document.createElement("span");
  nom.className = "ya-step-nom";
  nom.textContent = e.nom;
  const arg = document.createElement("span");
  arg.className = "ya-step-arg";
  b.append(icone(etat.icone, 14), nom, arg, icone("chevron", 14));
  b.lastElementChild.classList.add("ya-step-chev");
  b.addEventListener("click", () => {
    const ouvert = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", String(ouvert));
    zone.hidden = !ouvert;
    surDeplier?.(e.id);
  });
  racine.append(b, zone);
  majOutil(racine, e);
  return racine;
}

function majOutil(racine, e) {
  const etat = ETATS[e.etat];
  if (!etat) throw new Error(`conversation : état inconnu « ${e.etat} »`);
  const b = racine.querySelector("button");
  const arg = String(e.argument ?? "");
  const ancienne = b.firstElementChild;
  if (ancienne.getAttribute("data-icone") !== etat.icone) ancienne.replaceWith(icone(etat.icone, 14));
  b.firstElementChild.setAttribute("class", `ya-step-etat ${etat.classe}`);
  const a = b.querySelector(".ya-step-arg");
  a.textContent = arg;
  a.title = arg;
  b.setAttribute("aria-label", `${e.nom} ${arg}, ${etat.nom}`);
  texteZone(racine.querySelector(".ya-step-res"), e);
}

function rendreEntree(e, surDeplier) {
  let n;
  switch (e.type) {
    case "utilisateur":
      n = document.createElement("div");
      n.className = "ya-chat-user";
      n.append(sr("Vous : "), String(e.texte ?? ""));
      return n;
    case "agent":
      n = document.createElement("div");
      n.className = "ya-chat-agent";
      majAgent(n, e);
      return n;
    case "outil":
      return rendreOutil(e, surDeplier);
    case "fin":
      n = document.createElement("div");
      n.className = "ya-fin";
      n.textContent = e.texte;
      return n;
    case "message": {
      const reste = { ...e };
      delete reste.type;
      return message(reste);
    }
    default:
      throw new Error(`conversation : type d'entrée inconnu « ${e.type} »`);
  }
}

function sr(texte) {
  const s = document.createElement("span");
  s.className = "ya-sr";
  s.textContent = texte;
  return s;
}

function majAgent(n, e) {
  n.innerHTML = rendreMarkdown(e.markdown);
  n.prepend(sr("Agent : "));
}

export function conversation({ entrees = [], enAttente = false, vide, surDeplier } = {}) {
  const el = document.createElement("div");
  el.className = "ya-chat";
  el.setAttribute("role", "log");
  el.setAttribute("aria-label", "Conversation");
  el.tabIndex = 0;

  let rendus = []; // { entree, noeud }
  let attente = null;
  let blocVide = null;

  const auBas = () => el.scrollHeight - el.scrollTop - el.clientHeight <= MARGE_BAS;
  const descendre = () => {
    el.scrollTop = el.scrollHeight;
  };

  function appliquer(liste, enAttenteNouveau) {
    for (let i = 0; i < rendus.length && i < liste.length; i++) {
      const { entree, noeud } = rendus[i];
      const e = liste[i];
      if (e.type === "outil" && entree.type === "outil") {
        if (e.etat !== entree.etat || e.resultat !== entree.resultat || e.argument !== entree.argument) majOutil(noeud, e);
      } else if (e.type === "agent" && entree.type === "agent" && e.markdown !== entree.markdown) {
        majAgent(noeud, e);
      }
      rendus[i].entree = e;
    }
    for (let i = rendus.length; i < liste.length; i++) {
      const noeud = rendreEntree(liste[i], surDeplier);
      if (attente) attente.before(noeud);
      else el.append(noeud);
      rendus.push({ entree: liste[i], noeud });
    }
    if (enAttenteNouveau && !attente) {
      attente = indication({ texte: "L'agent travaille…", variante: "chargement" });
      el.append(attente);
    } else if (!enAttenteNouveau && attente) {
      attente.remove();
      attente = null;
    }
    if (liste.length && blocVide) {
      blocVide.remove();
      blocVide = null;
    } else if (!liste.length && vide && !blocVide) {
      blocVide = document.createElement("div");
      blocVide.className = "ya-chat-vide";
      blocVide.append(vide);
      el.prepend(blocVide);
    }
  }

  el.mettreAJour = (liste, enAttenteNouveau = false) => {
    const bas = auBas();
    appliquer(liste, enAttenteNouveau);
    if (bas) descendre();
  };

  appliquer(entrees, enAttente);
  descendre();
  // Tant que le fil n'est pas dans la page, la hauteur est nulle : on redescend à l'affichage.
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(descendre);
  return el;
}
