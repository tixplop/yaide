import { bouton } from "./bouton.js";
import { champ } from "./champ.js";
import { icone } from "./icones.js";
import { TYPES, apresDe, delier, estDeclencheur, lier, noeudsPermisApres } from "../workflow.js";

export const TYPE_GLISSE = "application/x-yaide-noeud";

const OPERATIONS = [
  { valeur: "lire", texte: "Lire" },
  { valeur: "ecrire", texte: "Écrire" },
  { valeur: "copier", texte: "Copier" },
  { valeur: "deplacer", texte: "Déplacer" },
  { valeur: "supprimer", texte: "Supprimer" },
];
const EVENEMENTS = [
  { valeur: "cree", texte: "Créé" },
  { valeur: "modifie", texte: "Modifié" },
  { valeur: "supprime", texte: "Supprimé" },
];
const ENTREE = "{{entree}} y est remplacé par l'entrée.";
const CHEMIN = "Depuis la racine du projet.";
const DECLENCHEURS = ["dossier", "planification", "appel"];
const ACTIONS = ["agent", "shell", "claude", "fichier", "trace"];
let compteur = 0;

/** Champs de texte de chaque type : [clé, libellé, aide, multiligne]. Les champs « Fichier » dépendent de l'opération. */
function champsDe(n) {
  switch (n.type) {
    case "dossier":
      return [["dossier", "Dossier", "Depuis la racine du projet, sous-dossiers compris. « . » : tout le projet."]];
    case "planification":
      return [["cron", "Expression cron", "Expression cron : minute, heure, jour du mois, mois, jour de la semaine, à l'heure de la machine de Yaide."]];
    case "agent":
      return [["message", "Message", `${ENTREE} La sortie est la dernière réponse de l'agent.`, true]];
    case "shell":
      return [["commande", "Commande", "Lancée dans la racine du projet. L'entrée est dans $YAIDE_ENTREE. La sortie est ce qu'elle affiche.", true]];
    case "claude":
      return [["demande", "Demande", `${ENTREE} Claude Code suit vos réglages et refuse ce qui demande une autorisation.`, true]];
    case "trace":
      return [["message", "Message", `${ENTREE} Le message s'écrit dans le journal des logs de Yaide. La sortie est l'entrée reçue.`, true]];
    case "fichier": {
      const op = n.reglages.operation;
      const champs = [["chemin", "Chemin", `${CHEMIN} ${ENTREE}`]];
      if (op === "ecrire") champs.push(["contenu", "Contenu", `${ENTREE} Le fichier est créé ou remplacé.`, true]);
      if (op === "copier" || op === "deplacer") champs.push(["destination", "Destination", `${CHEMIN} Remplacée si elle existe. ${ENTREE}`]);
      return champs;
    }
    default:
      return [];
  }
}

/**
 * C-019 : panneau « Nœuds ». Sans nœud choisi, les types ; sinon les réglages du nœud.
 * `maj({ document, choix, lectureSeule, agents })` ; le panneau ne se refait que si ce qu'il montre change,
 * pour que la frappe garde son focus.
 */
export function panneauNoeuds({ document: doc, choix = null, lectureSeule = false, agents = [], surChangement, surAjout, surRetirer, surEchap }) {
  if (typeof surChangement !== "function") throw new Error("panneauNoeuds : surChangement requis");
  if (typeof surAjout !== "function") throw new Error("panneauNoeuds : surAjout requis");
  if (typeof surRetirer !== "function") throw new Error("panneauNoeuds : surRetirer requis");
  const etat = { doc, choix, lectureSeule, agents };
  const memoire = new Map(); // champs masqués d'un nœud « Fichier », gardés tant que l'onglet est ouvert
  const n0 = ++compteur;
  let signature = null;

  const racine = document.createElement("aside");
  racine.className = "ya-wf-panneau";
  racine.setAttribute("aria-labelledby", `ya-wf-panneau-${n0}`);
  const tete = document.createElement("div");
  tete.className = "ya-panel-head";
  const titre = document.createElement("h2");
  titre.className = "ya-panel-title";
  titre.id = `ya-wf-panneau-${n0}`;
  titre.textContent = "Nœuds";
  tete.append(titre);
  const corps = document.createElement("div");
  corps.className = "ya-wf-panneau-corps";
  racine.append(tete, corps);

  const noeud = () => etat.doc.noeuds.find((n) => n.id === etat.choix);
  const inactif = (el) => el.setAttribute("aria-disabled", "true");

  function ligneType(type, court) {
    const t = TYPES[type];
    const b = document.createElement("button");
    b.type = "button";
    b.className = court ? "ya-wf-type ya-wf-type-court" : "ya-wf-type";
    b.draggable = true;
    b.dataset.type = type;
    b.setAttribute("aria-label", t.nom);
    const nom = document.createElement("span");
    nom.className = "ya-wf-type-nom";
    nom.textContent = t.nom;
    b.append(icone(t.icone, 16), nom);
    if (!court) {
      const phrase = document.createElement("span");
      phrase.className = "ya-wf-type-phrase";
      phrase.id = `ya-wf-phrase-${n0}-${type}`;
      phrase.textContent = t.phrase;
      b.append(phrase);
      b.setAttribute("aria-describedby", phrase.id);
    }
    if (etat.lectureSeule) inactif(b);
    b.addEventListener("click", (ev) => {
      if (etat.lectureSeule) return ev.preventDefault();
      surAjout(type);
    });
    b.addEventListener("dragstart", (ev) => {
      if (etat.lectureSeule) return ev.preventDefault();
      ev.dataTransfer?.setData(TYPE_GLISSE, type);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
    });
    return b;
  }

  function groupe(nom, types, court) {
    const g = document.createElement("div");
    g.className = "ya-wf-groupe";
    g.setAttribute("role", "group");
    const t = document.createElement("div");
    t.className = "ya-panel-title ya-wf-groupe-titre";
    t.id = `ya-wf-groupe-${n0}-${nom}`;
    t.textContent = nom;
    g.setAttribute("aria-labelledby", t.id);
    g.append(t, ...types.map((x) => ligneType(x, court)));
    return g;
  }

  function rendreTypes() {
    const aide = document.createElement("p");
    aide.className = "ya-wf-aide";
    aide.textContent = "Cliquez sur un type pour l'ajouter, ou glissez-le sur la surface. Chaque action reçoit la sortie du nœud d'avant.";
    corps.append(aide, groupe("Déclencheurs", DECLENCHEURS, false), groupe("Actions", ACTIONS, false));
  }

  function changerNoeud(f) {
    const id = etat.choix;
    const d = { ...etat.doc, noeuds: etat.doc.noeuds.map((n) => (n.id === id ? f(n) : n)) };
    etat.doc = d;
    surChangement(d);
  }
  const reglage = (cle, valeur) => changerNoeud((n) => ({ ...n, reglages: { ...n.reglages, [cle]: valeur } }));

  function pose(c, cle, ro = etat.lectureSeule) {
    const saisie = c.querySelector("input, select, textarea");
    saisie.dataset.champ = cle;
    if (ro && (saisie instanceof HTMLInputElement || saisie instanceof HTMLTextAreaElement) && saisie.type !== "checkbox") saisie.readOnly = true;
    return saisie;
  }

  function champTexte(cle, libelle, aide, multi, valeur, surSaisie) {
    const c = champ({ libelle, type: multi ? "multiligne" : "texte", valeur: valeur ?? "", aide });
    pose(c, cle).addEventListener("input", (ev) => surSaisie(ev.target.value));
    return c;
  }

  function champListe(cle, libelle, options, valeur, aide, surChoix) {
    const c = champ({ libelle, type: "liste", options, valeur, aide, desactive: etat.lectureSeule });
    pose(c, cle).addEventListener("change", (ev) => surChoix(ev.target.value));
    return c;
  }

  function changerOperation(valeur) {
    const id = etat.choix;
    changerNoeud((n) => {
      const r = { ...n.reglages, operation: valeur };
      const visibles = { contenu: valeur === "ecrire", destination: valeur === "copier" || valeur === "deplacer" };
      for (const [cle, vu] of Object.entries(visibles)) {
        if (!vu && cle in r) {
          memoire.set(`${id}/${cle}`, r[cle]);
          delete r[cle];
        } else if (vu && !(cle in r) && memoire.has(`${id}/${cle}`)) r[cle] = memoire.get(`${id}/${cle}`);
      }
      return { ...n, reglages: r };
    });
  }

  function champAgent(n) {
    const dossier = n.reglages.agent ?? "";
    const options = [{ valeur: "", texte: "Choisir un agent" }, ...etat.agents.map((a) => ({ valeur: a.dossier, texte: a.nom }))];
    if (dossier && !etat.agents.some((a) => a.dossier === dossier)) options.push({ valeur: dossier, texte: `${n.reglages.nom || dossier} (supprimé)` });
    return champListe("agent", "Agent", options, dossier, "Une nouvelle conversation, avec cet agent seul.", (v) => {
      const a = etat.agents.find((x) => x.dossier === v);
      changerNoeud((m) => ({ ...m, reglages: { ...m.reglages, agent: v, nom: a?.nom ?? (v ? m.reglages.nom : "") } }));
    });
  }

  function champEvenements(n) {
    const g = document.createElement("fieldset");
    g.className = "ya-wf-evenements";
    const lg = document.createElement("legend");
    lg.className = "champ-libelle";
    lg.textContent = "Évènements";
    g.append(lg);
    const coches = n.reglages.evenements ?? [];
    for (const e of EVENEMENTS) {
      const c = champ({ libelle: e.texte, type: "case", valeur: coches.includes(e.valeur), desactive: etat.lectureSeule });
      pose(c, `evenement-${e.valeur}`).addEventListener("change", (ev) => {
        const actuels = noeud().reglages.evenements ?? [];
        const suite = EVENEMENTS.map((x) => x.valeur).filter((v) => (v === e.valeur ? ev.target.checked : actuels.includes(v)));
        reglage("evenements", suite);
      });
      g.append(c);
    }
    return g;
  }

  function champApres(n) {
    const options = [{ valeur: "", texte: "Aucun" }, ...noeudsPermisApres(etat.doc, n.id).map((m) => ({ valeur: m.id, texte: m.titre }))];
    return champListe("apres", "Après", options, apresDe(etat.doc, n.id) ?? "", undefined, (v) => {
      const d = v ? lier(etat.doc, v, n.id) : delier(etat.doc, n.id);
      etat.doc = d;
      surChangement(d);
    });
  }

  function rendreReglages(n) {
    const t = TYPES[n.type];
    const ligne = document.createElement("div");
    ligne.className = "ya-wf-noeud-tete";
    const nom = document.createElement("span");
    nom.className = "ya-wf-noeud-type";
    nom.append(icone(t.icone, 16), t.nom);
    const retirer = bouton({ icone: "trash", nomAccessible: "Retirer le nœud", raccourci: "Suppr", positionInfoBulle: "gauche" });
    retirer.setAttribute("aria-keyshortcuts", "Delete");
    retirer.classList.add("ya-wf-retirer");
    if (etat.lectureSeule) inactif(retirer);
    retirer.addEventListener("click", () => !etat.lectureSeule && surRetirer());
    ligne.append(nom, retirer.enveloppe ?? retirer);
    corps.append(ligne);

    corps.append(champTexte("titre", "Titre", undefined, false, n.titre, (v) => changerNoeud((m) => ({ ...m, titre: v }))));
    if (n.type === "appel") {
      const p = document.createElement("p");
      p.className = "ya-wf-aide";
      p.textContent = "Un agent le lance avec l'outil run_workflow. Son texte devient l'entrée.";
      corps.append(p);
    }
    if (n.type === "dossier") {
      corps.append(champTexte("dossier", "Dossier", champsDe(n)[0][2], false, n.reglages.dossier, (v) => reglage("dossier", v)), champEvenements(n));
    } else if (n.type === "agent") {
      corps.append(champAgent(n), champTexte("message", "Message", champsDe(n)[0][2], true, n.reglages.message, (v) => reglage("message", v)));
    } else if (n.type === "fichier") {
      corps.append(champListe("operation", "Opération", OPERATIONS, n.reglages.operation ?? "lire", undefined, changerOperation));
      for (const [cle, libelle, aide, multi] of champsDe(n)) corps.append(champTexte(cle, libelle, aide, multi, n.reglages[cle], (v) => reglage(cle, v)));
    } else {
      for (const [cle, libelle, aide, multi] of champsDe(n)) corps.append(champTexte(cle, libelle, aide, multi, n.reglages[cle], (v) => reglage(cle, v)));
    }
    if (!estDeclencheur(n)) corps.append(champApres(n));
    corps.append(groupe("Ajouter une action après", ACTIONS, true));
  }

  // Ce que le panneau montre : le choix, son type et son opération, la liste des autres nœuds (« Après »), les liens et les agents.
  function signer() {
    const n = noeud();
    return JSON.stringify([
      etat.choix && n ? n.id : null,
      n?.type,
      n?.type === "fichier" ? n.reglages.operation : null,
      n?.type === "agent" ? n.reglages.agent : null,
      etat.lectureSeule,
      etat.agents,
      n ? etat.doc.noeuds.filter((m) => m.id !== n.id).map((m) => [m.id, m.titre]) : null,
      n ? etat.doc.liens : null,
    ]);
  }

  function rendre() {
    const actif = racine.contains(document.activeElement) ? document.activeElement.dataset.champ : null;
    corps.replaceChildren();
    const n = noeud();
    if (n) rendreReglages(n);
    else rendreTypes();
    if (actif) corps.querySelector(`[data-champ="${actif}"]`)?.focus();
  }

  racine.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || ev.ctrlKey || ev.metaKey || ev.altKey || !etat.choix) return;
    ev.preventDefault();
    surEchap?.();
  });

  racine.maj = (p) => {
    if ("document" in p) etat.doc = p.document;
    if ("choix" in p) etat.choix = p.choix;
    if ("lectureSeule" in p) etat.lectureSeule = p.lectureSeule;
    if ("agents" in p) etat.agents = p.agents;
    const s = signer();
    if (s === signature) return;
    signature = s;
    rendre();
  };
  /** Focus dans le premier champ propre du nœud choisi (« Titre » pour « Appel par un agent »). */
  racine.focusPremierChamp = () => {
    const n = noeud();
    if (!n) return;
    const cible = n.type === "appel" ? corps.querySelector('[data-champ="titre"]') : corps.querySelector('[data-champ]:not([data-champ="titre"])');
    cible?.focus();
  };
  racine.focusTitre = () => corps.querySelector('[data-champ="titre"]')?.focus();
  racine.maj({});
  return racine;
}
