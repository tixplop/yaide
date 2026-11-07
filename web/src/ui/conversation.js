import { icone } from "./icones.js";
import { indication } from "./indication.js";
import { message } from "./message.js";
import { avatar } from "./avatar.js";
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
  n.prepend(sr(`${e.auteur?.nom ?? "Agent"} : `));
}

const memeAuteur = (a, b) => !!a && !!b && a.nom === b.nom && a.avatar === b.avatar && a.couleur === b.couleur;

function creerGroupe(auteur) {
  const el = document.createElement("div");
  el.className = "ya-tour";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", auteur.nom);
  const tete = document.createElement("div");
  tete.className = "ya-tour-tete";
  const nom = document.createElement("span");
  nom.textContent = auteur.nom;
  tete.append(avatar(auteur), nom);
  const corps = document.createElement("div");
  corps.className = "ya-tour-corps";
  corps.style.setProperty("--c", `var(--agent-${auteur.couleur})`);
  el.append(tete, corps);
  return { auteur, el, corps };
}

export function conversation({ entrees = [], enAttente = false, vide, surDeplier } = {}) {
  const el = document.createElement("div");
  el.className = "ya-chat";
  el.setAttribute("role", "log");
  el.setAttribute("aria-label", "Conversation");
  el.tabIndex = 0;

  let rendus = []; // { entree, noeud }
  let attente = null;
  let cleAttente = "";
  let groupeAttente = null; // groupe ouvert pour la seule attente
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
    attente?.remove();
    if (groupeAttente) {
      groupeAttente.el.remove();
      groupeAttente = null;
    }
    for (let i = rendus.length; i < liste.length; i++) {
      const e = liste[i];
      const noeud = rendreEntree(e, surDeplier);
      let groupe = null;
      if (e.auteur && e.type !== "utilisateur" && e.type !== "message") {
        groupe = rendus.at(-1)?.groupe;
        if (!memeAuteur(groupe?.auteur, e.auteur)) {
          groupe = creerGroupe(e.auteur);
          el.append(groupe.el);
        }
        groupe.corps.append(noeud);
      } else {
        el.append(noeud);
      }
      rendus.push({ entree: e, noeud, groupe });
    }
    const auteurAttente = enAttenteNouveau && typeof enAttenteNouveau === "object" ? enAttenteNouveau : null;
    const cle = enAttenteNouveau ? JSON.stringify(auteurAttente) : "";
    if (attente && cle !== cleAttente) attente = null;
    if (enAttenteNouveau && !attente) {
      attente = indication({ texte: auteurAttente ? `${auteurAttente.nom} travaille…` : "L'agent travaille…", variante: "chargement" });
    } else if (!enAttenteNouveau) {
      attente = null;
    }
    cleAttente = cle;
    if (attente && auteurAttente) {
      let groupe = rendus.at(-1)?.groupe;
      if (!memeAuteur(groupe?.auteur, auteurAttente)) {
        groupe = groupeAttente = creerGroupe(auteurAttente);
        el.append(groupe.el);
      }
      groupe.corps.append(attente);
    } else if (attente) {
      el.append(attente);
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
