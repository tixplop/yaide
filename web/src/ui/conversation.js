import { icone } from "./icones.js";
import { indication } from "./indication.js";
import { message } from "./message.js";
import { avatar } from "./avatar.js";
import { rendreReponse } from "./apercu.js";
import { bouton } from "./bouton.js";

export { attentes } from "./attentes.js";

const ETATS = {
  enCours: { icone: "circle-dashed", nom: "en cours", classe: "encours" },
  reussi: { icone: "circle-check", nom: "réussi", classe: "ok" },
  echec: { icone: "circle-x", nom: "échec", classe: "ko" },
};
const ETATS_SOUS_AGENT = {
  enCours: { icone: "circle-dashed", nom: "en cours", classe: "encours" },
  termine: { icone: "circle-check", nom: "terminé", classe: "ok" },
  echec: { icone: "circle-x", nom: "échec", classe: "ko" },
  interrompu: { icone: "circle-minus", nom: "interrompu", classe: "encours" },
};
const MARGE_BAS = 24;
let compteur = 0;

function texteZone(zone, e) {
  zone.textContent = "";
  if (e.serveur) {
    let args = String(e.argument ?? "");
    try {
      args = JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      // arguments qui ne sont pas du JSON : montrés tels quels
    }
    const a = document.createElement("span");
    a.className = "ya-step-cmd ya-step-mcp-args";
    a.textContent = args;
    const r = document.createElement("span");
    r.className = "ya-step-mcp-res";
    r.textContent = e.etat === "enCours" ? "En cours…" : (e.resultat ?? "");
    zone.append(a, r);
    return;
  }
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
  if (Array.isArray(e.etapes)) {
    // Déroulement d'un sous-agent (REQ-100) : ses étapes remplacent la zone de résultat.
    zone.className = "ya-sous-zone";
    zone.setAttribute("role", "group");
    zone.setAttribute("aria-label", "Étapes du sous-agent");
    zone.rendus = [];
  } else zone.className = "ya-step-res";
  zone.hidden = true;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ya-step";
  b.setAttribute("aria-expanded", "false");
  b.setAttribute("aria-controls", zone.id);
  const nom = document.createElement("span");
  nom.className = "ya-step-nom";
  nom.textContent = e.nom;
  if (e.serveur) {
    const srv = document.createElement("span");
    srv.className = "ya-step-serveur";
    srv.textContent = e.serveur;
    const sep = document.createElement("span");
    sep.className = "ya-step-sep";
    sep.textContent = "›";
    nom.className = "ya-step-outil";
    const bloc = document.createElement("span");
    bloc.className = "ya-step-mcp";
    bloc.append(srv, sep, nom);
    b.append(icone(ETATS[e.etat]?.icone ?? "circle-dashed", 14), bloc);
  }
  const arg = document.createElement("span");
  arg.className = "ya-step-arg";
  if (e.serveur) b.append(arg, icone("chevron", 14));
  else b.append(icone(etat.icone, 14), nom, arg, icone("chevron", 14));
  b.lastElementChild.classList.add("ya-step-chev");
  b.addEventListener("click", () => {
    const ouvert = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", String(ouvert));
    zone.hidden = !ouvert;
    surDeplier?.(e.id);
  });
  racine.append(b, zone);
  majOutil(racine, e, surDeplier);
  return racine;
}

// Étapes du sous-agent : mêmes mises à jour que le fil, sans auteur ni groupe ; l'attente et le résultat d'un échec restent en fin de zone.
function majEtapes(zone, e, surDeplier) {
  majRendus(zone.rendus, e.etapes, surDeplier, "Sous-agent");
  zone.attente?.remove();
  zone.resultat?.remove();
  ajouterRendus(zone.rendus, e.etapes, surDeplier, undefined, "Sous-agent", (n) => zone.append(n));
  if (e.etat === "echec") {
    zone.resultat ??= Object.assign(document.createElement("div"), { className: "ya-step-res" });
    zone.resultat.textContent = e.resultat ?? "";
    zone.append(zone.resultat);
  }
  const travaille = e.etat === "enCours" && !e.etapes.some((x) => x.type === "outil" && x.etat === "enCours");
  if (!travaille) zone.attente = null;
  else {
    zone.attente ??= indication({ texte: "Le sous-agent travaille…", variante: "chargement" });
    zone.append(zone.attente);
  }
}

function majOutil(racine, e, surDeplier) {
  const etat = ETATS[e.etat];
  if (!etat) throw new Error(`conversation : état inconnu « ${e.etat} »`);
  const b = racine.querySelector("button");
  let arg = String(e.argument ?? "");
  if (e.serveur && arg === "{}") arg = "";
  const ancienne = b.firstElementChild;
  if (ancienne.getAttribute("data-icone") !== etat.icone) ancienne.replaceWith(icone(etat.icone, 14));
  b.firstElementChild.setAttribute("class", `ya-step-etat ${etat.classe}`);
  const a = b.querySelector(".ya-step-arg");
  a.textContent = arg;
  if (!e.serveur) a.title = arg;
  if (e.serveur) {
    b.title = `${e.serveur} › ${e.nom}${arg ? ` ${arg}` : ""}`;
    b.setAttribute("aria-label", `${e.serveur} ${e.nom}${arg ? ` ${arg}` : ""}, ${etat.nom}`);
  } else b.setAttribute("aria-label", `${e.nom} ${arg}, ${etat.nom}`);
  const zone = racine.querySelector(":scope > .ya-step-res, :scope > .ya-sous-zone");
  if (zone.rendus) {
    if (Array.isArray(e.etapes)) majEtapes(zone, e, surDeplier);
  } else texteZone(zone, e);
}

function rendreRaison(e, surDeplier, nom) {
  const racine = document.createElement("div");
  majRaison(racine, e, surDeplier, nom);
  return racine;
}

// La ligne n'existe qu'à partir du premier caractère qui n'est pas un espace.
function majRaison(racine, e, surDeplier, nom) {
  if (!String(e.markdown ?? "").trim()) {
    const avaitFocus = racine.contains(document.activeElement);
    racine.textContent = "";
    racine.hidden = true;
    racine.classList.remove("ya-steps"); // sort des règles d'adjacence
    if (avaitFocus) racine.closest(".ya-chat")?.focus({ preventScroll: true });
    return;
  }
  racine.hidden = false;
  racine.classList.add("ya-steps");
  let zone = racine.querySelector(".ya-raison-zone");
  if (!zone) {
    zone = document.createElement("div");
    zone.id = `ya-conv-${++compteur}`;
    zone.className = "ya-raison-zone ya-chat-agent";
    zone.hidden = true;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ya-raison";
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-controls", zone.id);
    const t = document.createElement("span");
    t.className = "ya-raison-nom";
    t.textContent = "Raisonnement";
    b.append(icone("brain", 14), t, icone("chevron", 14));
    b.lastElementChild.classList.add("ya-step-chev");
    b.addEventListener("click", () => {
      const ouvert = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", String(ouvert));
      zone.hidden = !ouvert;
      surDeplier?.(e.id);
    });
    racine.append(b, zone);
  }
  majAgent(zone, e, nom, true);
}

function rendreSousAgent(e, surOuvrir) {
  const ligne = document.createElement("div");
  ligne.className = "ya-sous";
  ligne.setAttribute("role", "group");
  ligne.append(icone("circle-dashed", 14));
  for (const c of ["ya-sous-agent", "ya-sous-titre", "ya-sous-etat"]) {
    const sp = document.createElement("span");
    sp.className = c;
    ligne.append(sp);
  }
  const ouvrir = bouton({ libelle: "Ouvrir", nomAccessible: `Ouvrir ${e.agent}`, variante: "secondaire" });
  ouvrir.addEventListener("click", () => surOuvrir?.(ligne.dataset.idSession));
  ligne.append(ouvrir);
  majSousAgent(ligne, e);
  return ligne;
}

// Met la ligne à jour sur place : le focus de « Ouvrir » reste où il est.
function majSousAgent(ligne, e) {
  const etat = ETATS_SOUS_AGENT[e.etat];
  ligne.dataset.idSession = e.id ?? ""; // la session fille n'est connue qu'après la création de la ligne
  if (!etat) throw new Error(`conversation : état de sous-agent inconnu « ${e.etat} »`);
  ligne.setAttribute("aria-label", `Sous-agent ${e.agent}, ${etat.nom}`);
  if (ligne.firstElementChild.getAttribute("data-icone") !== etat.icone) ligne.firstElementChild.replaceWith(icone(etat.icone, 14));
  ligne.firstElementChild.setAttribute("class", `ya-step-etat ${etat.classe}`);
  ligne.querySelector(".ya-sous-agent").textContent = e.agent;
  const titre = ligne.querySelector(".ya-sous-titre");
  titre.textContent = e.titre ?? "";
  titre.title = e.titre ?? "";
  ligne.querySelector(".ya-sous-etat").textContent = etat.nom;
  ligne.querySelector("button").setAttribute("aria-label", `Ouvrir ${e.agent}`);
}

function rendreEntree(e, surDeplier, surOuvrir, nom) {
  let n;
  switch (e.type) {
    case "utilisateur":
      n = document.createElement("div");
      n.className = "ya-chat-user";
      n.append(sr(e.consigne ? "Consigne : " : "Vous : "), String(e.texte ?? ""));
      return n;
    case "agent":
      n = document.createElement("div");
      n.className = "ya-chat-agent";
      majAgent(n, e, nom);
      return n;
    case "sousAgent":
      return rendreSousAgent(e, surOuvrir);
    case "outil":
      return rendreOutil(e, surDeplier);
    case "raisonnement":
      return rendreRaison(e, surDeplier, nom);
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

function majAgent(n, e, nom, sansNom = false) {
  const actif = document.activeElement;
  const liens = [...n.querySelectorAll("a")];
  const rang = actif ? liens.indexOf(actif) : -1;
  const avant = rang >= 0 ? { href: actif.getAttribute("href"), texte: actif.textContent } : null;
  n.innerHTML = rendreReponse(e.markdown);
  if (!sansNom) n.prepend(sr(`${e.auteur?.nom ?? nom} : `));
  if (!avant) return;
  const lien = n.querySelectorAll("a")[rang];
  if (lien && lien.getAttribute("href") === avant.href && lien.textContent === avant.texte) lien.focus({ preventScroll: true });
  else n.closest(".ya-chat")?.focus({ preventScroll: true });
}

// Met à jour sur place les entrées déjà rendues ; `rendus` : { entree, noeud }.
function majRendus(rendus, liste, surDeplier, nom) {
  for (let i = 0; i < rendus.length && i < liste.length; i++) {
    const { entree, noeud } = rendus[i];
    const e = liste[i];
    if (e.type === "outil" && entree.type === "outil") {
      if (e.etat !== entree.etat || e.resultat !== entree.resultat || e.argument !== entree.argument || JSON.stringify(e.etapes) !== JSON.stringify(entree.etapes)) majOutil(noeud, e, surDeplier);
    } else if (e.type === "agent" && entree.type === "agent" && e.markdown !== entree.markdown) {
      majAgent(noeud, e, nom);
    } else if (e.type === "raisonnement" && entree.type === "raisonnement" && e.markdown !== entree.markdown) {
      majRaison(noeud, e, surDeplier, nom);
    } else if (e.type === "sousAgent" && entree.type === "sousAgent" && JSON.stringify(e) !== JSON.stringify(entree)) {
      majSousAgent(noeud, e);
    }
    rendus[i].entree = e;
  }
}

// Rend les entrées nouvelles à la suite ; `placer(noeud, e)` les met dans le DOM et rend leur groupe éventuel.
function ajouterRendus(rendus, liste, surDeplier, surOuvrir, nom, placer) {
  for (let i = rendus.length; i < liste.length; i++) {
    const e = liste[i];
    const noeud = rendreEntree(e, surDeplier, surOuvrir, nom);
    rendus.push({ entree: e, noeud, groupe: placer(noeud, e) });
  }
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

export function conversation({ entrees = [], enAttente = false, vide, surDeplier, surOuvrir, surOuvrirFichier, nom = "Agent" } = {}) {
  const el = document.createElement("div");
  el.className = "ya-chat";
  el.setAttribute("role", "log");
  el.setAttribute("aria-label", "Conversation");
  el.tabIndex = 0;

  // Un lien vers un fichier n'est jamais suivi par le navigateur : la page l'ouvre (Entrée passe par le click natif).
  const ouvrirFichier = (e) => {
    if (e.type === "auxclick" && e.button !== 1) return;
    const a = e.target.closest?.("a.ya-fichier");
    if (!a || !el.contains(a)) return;
    e.preventDefault();
    const ligne = a.dataset.ligne;
    surOuvrirFichier?.({ chemin: a.dataset.chemin, ligne: ligne === undefined ? undefined : Number(ligne) });
  };
  el.addEventListener("click", ouvrirFichier);
  el.addEventListener("auxclick", ouvrirFichier);

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
    majRendus(rendus, liste, surDeplier, nom);
    attente?.remove();
    if (groupeAttente) {
      groupeAttente.el.remove();
      groupeAttente = null;
    }
    ajouterRendus(rendus, liste, surDeplier, surOuvrir, nom, (noeud, e) => {
      if (!e.auteur || e.type === "utilisateur" || e.type === "message") {
        el.append(noeud);
        return null;
      }
      let groupe = rendus.at(-1)?.groupe;
      if (!memeAuteur(groupe?.auteur, e.auteur)) {
        groupe = creerGroupe(e.auteur);
        el.append(groupe.el);
      }
      groupe.corps.append(noeud);
      return groupe;
    });
    const auteurAttente = enAttenteNouveau && typeof enAttenteNouveau === "object" ? enAttenteNouveau : null;
    const cle = enAttenteNouveau ? JSON.stringify(auteurAttente) : "";
    if (attente && cle !== cleAttente) attente = null;
    if (enAttenteNouveau && !attente) {
      attente = indication({ texte: auteurAttente ? `${auteurAttente.nom} travaille…` : nom === "Agent" ? "L'agent travaille…" : `${nom} travaille…`, variante: "chargement" });
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
