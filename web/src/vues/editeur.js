import { ecrireFichier, fermerShell, lireFichier, listeShells, versionsFichiers } from "../api.js";
import { decider, texteAttente } from "../brouillons.js";
import { decisionDisque } from "../disque.js";
import { couper, feuilles, poserPart, retirerGroupe } from "../disposition.js";
import { apresFermeture, estSous, garder, libelles, nomDe, plusPetitNumeroLibre, retrouver, suivreRenommage } from "../onglets-fichiers.js";
import { bouton } from "../ui/bouton.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { icone } from "../ui/icones.js";
import { langagePourFichier, nomLangage } from "../ui/langages.js";
import { menu } from "../ui/menu.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { zoneCode } from "../ui/zone-code.js";
import { vueAgent } from "./agent.js";
import { depotOnglets } from "./depot-onglets.js";
import { vueClaude } from "./claude.js";
import { vueOpencode } from "./opencode.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const DELAI_DETECTION = 4000;
const INTERVALLE_DISQUE = 1500;
const SANS_SUITE = "sans suite";
const CLAUDE = "\0claude:"; // préfixe de la clé d'un onglet Claude
const OPENCODE = "\0oc:"; // préfixe de la clé d'un onglet opencode (session ou sous-agent)
const AGENT = "\0agent:"; // préfixe de la clé d'un onglet Agent (son numéro : l'id de conversation n'existe qu'au premier message)
const DIFF = "\0diff"; // identifiant de l'onglet de diff, qui n'est pas un fichier ouvert
const TEXTE_SUPPRIME = "Fichier supprimé du disque. Ctrl+S le recrée.";
const estFichier = (o) => !o.claude && !o.opencode && !o.conversationAgent;
const avecHybride = (chemin) => /\.(md|markdown)$/i.test(chemin);
const avecApercu = (chemin) => /\.(md|markdown|html|htm)$/i.test(chemin);

/**
 * Éditeur de V-002. `dire({ texte, variante, fermable })` affiche un bandeau ; `ouvrirRapide()` ouvre V-006.
 * `surAttente(texte)` : phrase des sauvegardes attendant le retour de la connexion (vide s'il n'y en a plus).
 * `surActif({ position, langage })` : l'onglet actif et sa position pour la barre d'état (`null` sans onglet ; sur un diff, la position seule).
 * `surSauvegarde()` : une sauvegarde a réussi (l'état git a pu changer).
 * `surCourant(chemin | null)` : le fichier de l'onglet actif (`null` sans onglet ou sur un diff).
 * `claude` : faux, les onglets Claude gardés ne sont ni affichés ni branchés, mais restent dans la liste enregistrée, à leur place.
 * `agents` : faux, les onglets Agent gardés ne sont ni affichés ni branchés, mais restent dans la liste enregistrée, à leur place.
 * `surGroupes(arbre, courant)` : l'arbre des groupes (feuilles `{ id, ongletsFichiers, questionOnglet, fil, code }`) ou le groupe courant a changé (REQ-079).
 * `chemin` : le chemin du projet, dit par l'info-bulle des onglets Claude.
 * Un onglet Claude (REQ-068) est dans la même liste que les fichiers : `{ claude: true, id, numero, instance }`, sa clé `chemin` ne désigne aucun fichier.
 * Un onglet opencode (REQ-072) l'est aussi : `{ opencode: true, id, numero }` (session) ou `{ opencode: true, id, agent, titre }` (sous-agent).
 * Un onglet Agent (REQ-078) l'est aussi : `{ conversationAgent: true, numero, conversation }` (`conversation` : `null` tant que rien n'est écrit).
 * Le champ `agent` d'un onglet désigne un sous-agent opencode : l'onglet Agent a son propre drapeau.
 * Chaque onglet a un `groupe` ; `barre`, `fil`, `code` et `question` sont ceux du premier groupe, `groupes()` rend l'arbre de tous.
 * Rend `{ definirStatuts(statuts), barre, fil, code, groupes(), questions(), deplacer(id, groupe, zone), lecture(oui), definirEtat(etat), ouvrir(…), ouvrirClaude({ id }), ouvrirAgent({ equipe }), relireReglagesAgents(), ouvrirOpencode({ sessionId }), renomme(…), supprime(…), restaurer(), detruire() }`.
 */
export function vueEditeur({ chemin: cheminProjet = "", dire, ouvrirRapide = () => {}, surAttente = () => {}, surActif = () => {}, surCourant = () => {}, surSauvegarde = () => {}, surGroupes = () => {}, claude = true, agents = true }) {
  const liste = []; // { chemin, groupe, zone, disque (texte de base), version (de base), apercu, hybride, modifie, question, supprime, avis }
  let actif = null; // l'onglet actif du groupe courant
  let diff = null; // { chemin, el, groupe } : l'onglet de diff, au plus un, jamais gardé
  let avantDiff = null; // onglet actif quand le diff s'est ouvert
  let pret = false;
  let dernierGeste = 0; // numéro du dernier geste de l'utilisateur : le dernier l'emporte sur une lecture plus ancienne
  let lectures = 1; // la restauration compte comme une lecture en cours
  let detruit = false;
  let minuteur = null;
  let minuteurDisque = null;
  let sondageEnCours = false;
  let coupe = false;
  let statuts = new Map(); // chemin -> { lettre, mot } : statuts git (REQ-039)
  const cachees = []; // onglets Claude gardés mais non créés (Claude désactivé) : { garde, apres }, `apres` étant le chemin du fichier qui les précédait
  const attente = new Set(); // onglets dont Ctrl+S attend le retour de la connexion

  const trouver = (chemin) => liste.find((o) => o.chemin === chemin);
  const item = (id) => (id === DIFF ? diff : id === null ? undefined : trouver(id));

  // ---- Groupes (REQ-079) ----

  let arbre = { id: "g1", actif: null };
  let numeroGroupe = 1;
  let courant = "g1";
  let derniereSignature = null;
  let enPression = false; // une pression sur un onglet est en cours
  const groupes = new Map(); // id -> { id, actif, barre, questionOnglet, fil, code, ongl } ; `actif` du groupe courant : voir `actif`

  function creerGroupe(id) {
    const fil = document.createElement("div");
    fil.className = "ya-crumbs";
    fil.hidden = true;
    const code = document.createElement("div");
    code.className = "editeur-code";
    const g = { id, actif: null, barre: document.createElement("div"), questionOnglet: document.createElement("div"), fil, code, ongl: null };
    const dansOnglet = (e) => Boolean(e.target.closest?.(".onglet-cellule"));
    // Presser un onglet ne change pas le groupe courant (le clic le fait) : presser puis Échap ne doit rien changer.
    for (const el of [g.barre, g.questionOnglet, g.fil, g.code]) {
      el.addEventListener(
        "pointerdown",
        (e) => {
          enPression = dansOnglet(e);
          if (!enPression) rendreCourant(g);
        },
        true,
      );
      el.addEventListener("focusin", (e) => !(enPression && dansOnglet(e)) && rendreCourant(g), true);
    }
    groupes.set(id, g);
    return g;
  }
  creerGroupe("g1");
  const premier = groupes.get("g1");
  const barre = premier.barre;
  const fil = premier.fil;
  const code = premier.code;
  const questionOnglet = premier.questionOnglet;
  // Pendant un glissé, aucun rendu de barre : retirer l'onglet source du DOM annulerait le glissé. `afficher()` est refait à la fin.
  let aRefaire = false;
  const depot = depotOnglets({
    groupes: () => [...groupes.values()].map((g) => ({ id: g.id, barre: g.barre, nombre: ongletsDe(g).length })),
    deplacer: (id, cible, zone) => deplacer(id, cible, zone),
    apresFin: () => {
      if (!aRefaire) return;
      aRefaire = false;
      afficher();
    },
  });
  const finPression = () => setTimeout(() => (enPression = false), 0);
  const finsPression = ["pointerup", "pointercancel", "dragend"];
  for (const ev of finsPression) document.addEventListener(ev, finPression);

  // Le diff est à gauche des onglets de son groupe ; une fois déplacé, il garde le rang qu'il avait à son arrivée (AC-079-4, AC-079-11).
  const ongletsDe = (g) => {
    const propres = liste.filter((x) => x.groupe === g.id);
    if (diff?.groupe !== g.id) return propres;
    if (diff.rang === null) return [diff, ...propres];
    const i = Math.min(diff.rang, propres.length);
    return [...propres.slice(0, i), diff, ...propres.slice(i)];
  };
  const idDe = (x) => (x === diff ? DIFF : x.chemin);
  const actifDe = (g) => (g.id === courant ? actif : g.actif);
  const poserActif = (g, id) => {
    g.actif = id;
    if (g.id === courant) actif = id;
  };
  /** Le groupe `id` devient courant : chacun garde son onglet actif. */
  function passerA(id) {
    if (id === courant) return;
    groupes.get(courant).actif = actif;
    courant = id;
    actif = groupes.get(id).actif;
  }
  /** Rend `id` actif, et son groupe courant. */
  function activer(id) {
    const o = item(id);
    if (o) passerA(o.groupe);
    actif = id;
  }
  /** Clic ou focus dans un groupe : il devient courant. Jamais `afficher()` : refaire la barre annulerait le clic. */
  function rendreCourant(g) {
    if (g.id === courant) return;
    passerA(g.id);
    for (const x of groupes.values()) x.ongl?.definirCourant(x.id === courant);
    publier(item(actif) ?? null);
    publierGroupes();
  }

  /** Arbre des groupes avec les éléments de chacun, pour le cadre. */
  function arbreComplet(n = arbre) {
    if (n.sens !== undefined) {
      const id = feuilles(n.a).at(-1).id;
      // Le partage change sans refaire la page : l'arbre garde la dernière valeur, l'écriture attend la fin du mouvement.
      const surPartage = (part, final) => {
        arbre = poserPart(arbre, id, part);
        if (final && pret) ecrireGarde();
      };
      return { sens: n.sens, ...(n.part === undefined ? {} : { part: n.part }), surPartage, a: arbreComplet(n.a), b: arbreComplet(n.b) };
    }
    const g = groupes.get(n.id);
    return { id: g.id, ongletsFichiers: g.barre, questionOnglet: g.questionOnglet, fil: g.fil, code: g.code };
  }
  const structure = (n) => (n.sens === undefined ? n.id : `${n.sens}(${structure(n.a)},${structure(n.b)})`);

  /** Déplacer un groupe dans la page remet à zéro le défilement de ce qu'il contient : on le relève puis on le repose. */
  function relever() {
    const r = [];
    for (const g of groupes.values()) {
      for (const racine of [g.barre, g.questionOnglet, g.fil, g.code]) {
        for (const e of [racine, ...racine.querySelectorAll("*")]) if (e.scrollTop > 0 || e.scrollLeft > 0) r.push([e, e.scrollTop, e.scrollLeft]);
      }
    }
    return r;
  }
  const poser = (r) => {
    for (const [e, haut, gauche] of r) {
      e.scrollTop = haut;
      e.scrollLeft = gauche;
    }
  };

  function publierGroupes() {
    const signature = `${structure(arbre)}|${courant}`;
    if (signature === derniereSignature) return;
    const memoire = derniereSignature === null || derniereSignature.split("|")[0] === structure(arbre) ? null : relever();
    derniereSignature = signature;
    // Refaire la structure déplace des groupes dans la page : le focus d'un groupe qui reste est rendu.
    const focus = document.activeElement;
    surGroupes(arbreComplet(), courant);
    if (focus && focus !== document.body && focus.isConnected && document.activeElement !== focus) focus.focus();
    if (memoire) poser(memoire);
  }

  /** Le groupe frère d'une feuille dans l'arbre : sa feuille la plus proche. */
  const frere = (n, id) => {
    if (n.sens === undefined) return null;
    if (n.a.sens === undefined && n.a.id === id) return feuilles(n.b)[0].id;
    if (n.b.sens === undefined && n.b.id === id) return feuilles(n.a).at(-1).id;
    return frere(n.a, id) ?? frere(n.b, id);
  };

  /** Le groupe vide disparaît, sauf le dernier ; son voisin de découpe devient courant s'il l'était. Rend vrai si le groupe est parti. */
  function retirerSiVide(g) {
    if (groupes.size < 2 || ongletsDe(g).length > 0) return false;
    const voisin = frere(arbre, g.id);
    arbre = retirerGroupe(arbre, g.id);
    const etaitCourant = courant === g.id;
    groupes.delete(g.id);
    if (etaitCourant) {
      courant = voisin;
      actif = groupes.get(voisin).actif;
    }
    return true;
  }

  /** Le focus va dans le contenu de l'onglet actif du groupe courant, ou sur « Ouvrir un fichier ». */
  function focusActif() {
    if (actif === null) return groupes.get(courant).code.querySelector("button")?.focus();
    (actif === DIFF ? diff.el : trouver(actif).zone).vue?.focus();
  }

  /** `Map` onglet -> `{ libelle, detail }` : « Claude <n> », ou le nom du fichier (avec son dossier si un autre porte le même nom). */
  function nomsOnglets() {
    const fichiers = liste.filter(estFichier);
    const noms = libelles(fichiers.map((x) => x.chemin));
    const autre = (x) => (x.claude ? { libelle: `Claude ${x.numero}` } : x.conversationAgent ? { libelle: `Agent ${x.numero}` } : { libelle: x.agent ?? `opencode ${x.numero}` });
    return new Map(liste.map((x) => [x, estFichier(x) ? noms[fichiers.indexOf(x)] : autre(x)]));
  }

  function garderListe() {
    if (!pret) return;
    if (minuteur) return; // un minuteur en cours n'est pas réarmé : une frappe continue est écrite en moins d'une seconde
    minuteur = setTimeout(() => {
      minuteur = null;
      ecrireGarde();
    }, 200);
  }

  /** Clé d'un onglet gardé dans la liste : son chemin, ou celle de l'onglet opencode. */
  const cleGarde = (g) => (g.claude ? CLAUDE + g.id : g.opencode ? OPENCODE + g.id : g.conversationAgent ? AGENT + g.numero : g.chemin);

  function garde(o) {
    if (o.claude) return { groupe: o.groupe, claude: true, id: o.id, numero: o.numero, instance: o.instance };
    if (o.conversationAgent) return { groupe: o.groupe, conversationAgent: true, numero: o.numero, conversation: o.conversation };
    if (o.opencode) return o.agent === undefined ? { groupe: o.groupe, opencode: true, id: o.id, numero: o.numero } : { groupe: o.groupe, opencode: true, id: o.id, agent: o.agent, titre: o.titre };
    return { groupe: o.groupe, chemin: o.chemin, apercu: o.apercu, hybride: o.hybride, texte: o.modifie ? o.zone.contenu() : undefined, base: o.modifie ? o.disque : undefined, version: o.modifie ? o.version : undefined, attente: attente.has(o) };
  }

  function ecrireGarde() {
    const gardes = liste.map(garde);
    const deja = new Map(); // apres -> nombre d'onglets cachés déjà réinsérés à cet endroit
    for (const { garde, apres } of cachees) {
      const i = apres === null ? -1 : gardes.findIndex((g) => cleGarde(g) === apres);
      const n = deja.get(apres) ?? 0;
      deja.set(apres, n + 1);
      gardes.splice((apres !== null && i < 0 ? gardes.length : i + 1) + n, 0, garde);
    }
    // Le diff n'est jamais gardé : son groupe garde son premier onglet à la place.
    const gardable = (g) => (actifDe(g) === DIFF ? (liste.find((x) => x.groupe === g.id)?.chemin ?? null) : actifDe(g));
    const avecActifs = (n) => (n.sens === undefined ? { id: n.id, actif: gardable(groupes.get(n.id)) } : { sens: n.sens, ...(n.part === undefined ? {} : { part: n.part }), a: avecActifs(n.a), b: avecActifs(n.b) });
    garder(gardes, gardable(groupes.get(courant)), { arbre: avecActifs(arbre), courant });
  }

  function direAttente() {
    surAttente(texteAttente([...attente].map((o) => nomDe(o.chemin))));
  }

  // ---- Affichage ----

  // Fil d'Ariane (texte sans action) du groupe de `o`, ou rien.
  function remplirFil(g, o) {
    if (!o || !estFichier(o)) {
      g.fil.hidden = true;
      g.fil.replaceChildren();
      return;
    }
    const segments = o.chemin.split("/");
    g.fil.replaceChildren(
      ...segments.flatMap((nom, i) => {
        const e = document.createElement("span");
        e.className = i === segments.length - 1 ? "ya-crumbs-nom" : "ya-crumbs-segment";
        e.textContent = nom;
        return i === 0 ? [e] : [icone("chevron", 12), e];
      }),
    );
    g.fil.hidden = false;
  }

  // Fil d'Ariane et barre d'état : le fichier actif du groupe courant, ou rien.
  function publier(o) {
    remplirFil(groupes.get(o?.groupe ?? courant), o);
    if (!o) {
      surCourant(null);
      return surActif(null);
    }
    if (!estFichier(o)) {
      surCourant(null);
      return surActif({});
    }
    const etat = (o === diff ? diff.el : o.zone).vue?.state;
    let position;
    if (etat) {
      const tete = etat.selection.main.head;
      const l = etat.doc.lineAt(tete);
      position = `Ln ${l.number}, Col ${tete - l.from + 1}`;
    }
    surCourant(o === diff ? null : o.chemin);
    surActif({ position, langage: o === diff ? undefined : nomLangage(nomDe(o.chemin)) });
  }

  // Seuls M, A et U colorent un onglet.
  const statutOnglet = (chemin) => {
    const l = statuts.get(chemin)?.lettre;
    return l === "M" || l === "A" || l === "U" ? l : undefined;
  };

  /** Rend la barre, la question et les boutons d'un groupe. Rend son onglet actif (`null` : état vide). */
  function rendreGroupe(g) {
    const estCourant = g.id === courant;
    const avaitLeFocus = g.barre.contains(document.activeElement);
    const o = item(estCourant ? actif : g.actif) ?? null;
    g.ongl = null;
    if (!o && lectures > 0) {
      g.barre.replaceChildren();
      g.questionOnglet.replaceChildren();
      g.code.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
      return null;
    }
    if (!o) {
      const b = bouton({ libelle: "Ouvrir un fichier" });
      b.addEventListener("click", ouvrirRapide);
      g.barre.replaceChildren();
      g.questionOnglet.replaceChildren();
      g.code.replaceChildren(indication({ texte: "Aucun fichier ouvert.", action: b }));
      return null;
    }
    const noms = nomsOnglets();
    const idActif = estCourant ? actif : g.actif;
    let actionsDroite = [];
    if (o !== diff && estFichier(o) && avecHybride(o.chemin)) {
      const hy = bouton({ icone: "type", variante: "discret", nomAccessible: "Mode hybride", presse: o.hybride });
      hy.addEventListener("click", () => {
        o.hybride = !o.hybride;
        o.zone.definirHybride(o.hybride);
        hy.setAttribute("aria-pressed", String(o.hybride));
        garderListe();
      });
      actionsDroite.push(hy.enveloppe);
    }
    if (o !== diff && estFichier(o) && avecApercu(o.chemin)) {
      const ap = bouton({ icone: "eye", variante: "discret", nomAccessible: "Aperçu", presse: o.apercu });
      ap.addEventListener("click", () => {
        o.apercu = !o.apercu;
        o.zone.definirApercu(o.apercu);
        ap.setAttribute("aria-pressed", String(o.apercu));
        garderListe();
      });
      actionsDroite.push(ap.enveloppe);
    }
    const ongl = onglets({
      onglets: ongletsDe(g).map((x) => x === diff ? { id: DIFF, libelle: `${nomDe(diff.chemin)} (diff)`, titre: diff.chemin, fermable: true } : x.claude ? { id: x.chemin, libelle: noms.get(x).libelle, icone: "asterisk", titre: `Claude Code dans ${cheminProjet}`, fermable: true } : x.conversationAgent ? { id: x.chemin, libelle: noms.get(x).libelle, icone: "bot", titre: `Agent dans ${cheminProjet}`, fermable: true } : x.opencode ? ongletOpencode(x, noms.get(x).libelle) : ({
        id: x.chemin,
        libelle: noms.get(x).libelle,
        detail: noms.get(x).detail,
        titre: x.chemin,
        modifie: x.modifie,
        statut: statutOnglet(x.chemin),
        question: Boolean(x.question),
        fermable: true,
      })),
      actif: idActif,
      actionsDroite,
      surChoix: choisir,
      surFermer: fermer,
      surMenu: ouvrirMenu,
      surGlisser: (id, ev) => depot.debuter(id, ev, item(id)?.groupe),
      nomBarre: groupes.size > 1 ? `Fichiers ouverts, groupe ${feuilles(arbre).findIndex((f) => f.id === g.id) + 1}` : "Fichiers ouverts",
      courant: estCourant,
    });
    g.ongl = ongl;
    g.barre.replaceChildren(ongl);
    ongl.choisir(idActif);
    if (avaitLeFocus) ongl.querySelector("[role=tab][aria-selected=true]")?.focus();
    const avis = o.avis ?? null;
    if (g.questionOnglet.firstChild !== avis) g.questionOnglet.replaceChildren(...(avis ? [avis] : []));
    return o;
  }

  function afficher() {
    if (detruit) return;
    if (depot.enCours()) {
      aRefaire = true;
      return;
    }
    const rendus = new Map([...groupes.values()].map((g) => [g, rendreGroupe(g)]));
    // D'abord chaque vue dans le contenu de son groupe, puis ce qui ne lui appartient plus en sort.
    for (const g of groupes.values()) {
      for (const x of ongletsDe(g)) {
        const z = x === diff ? diff.el : x.zone;
        if (z.parentNode !== g.code) g.code.append(z);
        z.hidden = x !== rendus.get(g);
      }
    }
    for (const g of groupes.values()) {
      const o = rendus.get(g);
      if (o?.claude) o.vue.ajuster();
      const zones = ongletsDe(g).map((x) => (x === diff ? diff.el : x.zone));
      if (o) for (const enfant of [...g.code.children]) if (!zones.includes(enfant)) enfant.remove();
      if (o && lectures > 0) g.code.prepend(indication({ texte: "Chargement…", variante: "chargement" }));
      if (g.id !== courant) remplirFil(g, o);
    }
    publier(rendus.get(groupes.get(courant)));
    publierGroupes();
  }

  /** Entrée de la barre d'un onglet opencode : icône, `title` et nom accessible (le sous-agent dit son titre). */
  function ongletOpencode(x, libelle) {
    const sous = x.agent === undefined ? {} : { nomAccessible: `${libelle}, sous-agent : ${x.titre}` };
    const titre = x.agent === undefined ? `opencode dans ${cheminProjet}` : x.titre;
    return { id: x.chemin, libelle, icone: "code-xml", titre, question: x.marque, fermable: true, ...sous };
  }

  // Choix d'un onglet : la barre est refaite après le rappel, qui peut encore donner le focus à l'ancien onglet.
  function choisir(chemin) {
    dernierGeste++;
    enPression = false;
    const cible = item(chemin);
    if (cible) passerA(cible.groupe);
    actif = chemin;
    for (const o of liste) if (o.groupe === groupes.get(courant).id) o.zone.hidden = o.chemin !== chemin;
    (chemin === DIFF ? diff?.el : trouver(chemin)?.zone)?.vue?.focus();
    queueMicrotask(afficher);
    garderListe();
  }

  // ---- Ouvrir, renommer, supprimer ----

  function creer({ chemin, contenu, version, texte, apercu = false, hybride = false }) {
    const o = { chemin, groupe: courant, disque: contenu, version, apercu, hybride, modifie: false };
    o.zone = zoneCode({
      contenu: texte ?? contenu,
      langage: langagePourFichier(nomDe(chemin)) ?? undefined,
      nom: nomDe(chemin),
      apercu,
      hybride,
      surPosition() {
        if (trouver(actif) === o) publier(o);
      },
      surChangement(t) {
        const m = t !== o.disque;
        if (m === o.modifie) return garderListe();
        o.modifie = m;
        afficher();
        garderListe();
      },
    });
    o.modifie = o.zone.contenu() !== contenu;
    liste.push(o);
    return o;
  }

  /** `geste` : valeur rendue par `lecture(true)`. Sans valeur, l'ouverture est elle-même un geste. */
  function ouvrir({ chemin, contenu, version, ligne, geste = ++dernierGeste }) {
    if (!trouver(chemin)) creer({ chemin, contenu, version });
    if (geste !== dernierGeste && (actif === DIFF || trouver(actif))) {
      // Un geste plus récent a choisi un autre onglet : le fichier s'ouvre en arrière-plan.
      afficher();
      garderListe();
      return;
    }
    activer(chemin);
    afficher();
    if (Number.isInteger(ligne)) trouver(chemin).zone.aller(ligne);
    trouver(chemin).zone.vue.focus();
    garderListe();
  }

  function renomme({ de, vers }) {
    for (const o of liste) {
      const nouveau = suivreRenommage(o.chemin, de, vers);
      if (nouveau === o.chemin) continue;
      if (actif === o.chemin) actif = nouveau;
      for (const g of groupes.values()) if (g.actif === o.chemin) g.actif = nouveau;
      o.chemin = nouveau;
      o.zone.vue.contentDOM.setAttribute("aria-label", `Éditeur ${nomDe(nouveau)}`);
    }
    afficher();
    garderListe();
  }

  function supprime({ chemin }) {
    for (const o of liste.filter((x) => estSous(x.chemin, chemin))) retirer(o.chemin);
  }

  /** `arreter` : la session Claude de l'onglet s'arrête sur le serveur (sauf si elle a fini ou n'existe plus). */
  function retirer(chemin, arreter = true) {
    const i = liste.findIndex((o) => o.chemin === chemin);
    if (i < 0) return;
    const g = groupes.get(liste[i].groupe);
    const suivant = apresFermeture(liste.filter((o) => o.groupe === g.id).map((o) => o.chemin), chemin);
    if (attente.delete(liste[i])) direAttente();
    const [ferme] = liste.splice(i, 1);
    // La vue se détruit avant l'arrêt de la session : sa fermeture ne rappelle pas `surFin`.
    ferme.zone.detruire();
    ferme.zone.remove();
    if (ferme.claude && arreter) fermerShell(ferme.id);
    if (actifDe(g) === chemin) poserActif(g, suivant ?? (diff?.groupe === g.id ? DIFF : null));
    retirerSiVide(g);
    afficher();
    garderListe();
  }

  // ---- Onglets Claude (REQ-068) ----

  function creerClaude({ id, numero, instance }) {
    const o = { claude: true, id, numero, instance, groupe: courant, chemin: CLAUDE + id, modifie: false };
    o.vue = vueClaude({ id, nom: `Claude ${numero}`, surFin: (fin) => finClaude(o, fin) });
    // Le corps de la vue joue le rôle de la zone de code : masqué, détruit, retiré comme elle.
    o.zone = o.vue.corps;
    o.zone.detruire = o.vue.detruire;
    o.zone.vue = { focus: o.vue.focus };
    liste.push(o);
    return o;
  }

  function finClaude(o, fin) {
    if (detruit || !liste.includes(o)) return;
    if (fin.disparue) return retirer(o.chemin, false);
    if (fin.code !== 0) return; // la vue garde son affichage et son message
    const avaitLeFocus = o.zone.contains(document.activeElement);
    retirer(o.chemin, false);
    if (!avaitLeFocus) return;
    focusActif();
  }

  /** Ouvre « Claude <n> » (plus petit numéro libre) à droite des onglets, actif, le focus dans son terminal. */
  function ouvrirClaude({ id }) {
    dernierGeste++;
    const o = creerClaude({ id, numero: plusPetitNumeroLibre(liste.filter((x) => x.claude).map((x) => x.numero)) });
    actif = o.chemin;
    afficher();
    o.vue.focus();
    garderListe();
    // L'instance du serveur dit, au rechargement, si la session peut encore exister.
    listeShells().then((l) => {
      if (detruit || !l?.instance || !liste.includes(o)) return;
      o.instance = l.instance;
      garderListe();
    });
  }

  // ---- Onglets Agent (REQ-078) ----

  function creerAgent({ numero, conversation, equipe }) {
    const o = { conversationAgent: true, numero, conversation: conversation ?? null, groupe: courant, chemin: AGENT + numero, modifie: false };
    o.vue = vueAgent({
      ...(o.conversation ? { conversation: o.conversation } : { equipe }),
      surConversation: (id) => {
        o.conversation = id;
        garderListe();
      },
      surDejaOuverte: (id) => {
        const autre = liste.find((x) => x !== o && x.conversationAgent && x.conversation === id);
        if (!autre) return false;
        dernierGeste++;
        activer(autre.chemin);
        afficher();
        autre.zone.vue.focus();
        garderListe();
        return true;
      },
    });
    o.zone = o.vue.corps;
    o.zone.setAttribute("role", "region");
    o.zone.setAttribute("aria-label", `Agent ${numero}`);
    o.zone.detruire = o.vue.detruire;
    // La liste des conversations est relue au retour sur l'onglet : une autre en a peut-être enregistré une.
    o.zone.vue = {
      focus: () => {
        o.vue.majListe();
        o.vue.focuser();
      },
    };
    liste.push(o);
    return o;
  }

  /** Ouvre « Agent <n> » (plus petit numéro libre) à droite des onglets, actif, le focus dans « Message à l'agent ». `equipe` : agents de la conversation. */
  function ouvrirAgent({ equipe } = {}) {
    dernierGeste++;
    const o = creerAgent({ numero: plusPetitNumeroLibre(liste.filter((x) => x.conversationAgent).map((x) => x.numero)), equipe });
    actif = o.chemin;
    afficher();
    o.zone.vue.focus();
    garderListe();
  }

  /** Les profils ont pu changer (Ctrl+P) : chaque onglet Agent relit ses réglages. */
  function relireReglagesAgents() {
    for (const o of liste) if (o.conversationAgent) o.vue.relireReglages();
  }

  // ---- Onglets opencode (REQ-072) ----

  function creerOpencode({ id, numero, agent, titre }, apres) {
    const o = { opencode: true, id, groupe: courant, chemin: OPENCODE + id, modifie: false, marque: false };
    if (agent === undefined) o.numero = numero;
    else Object.assign(o, { agent, titre });
    o.vue = vueOpencode({
      sessionId: id,
      sousAgent: agent !== undefined,
      surOuvrir: ouvrirSousAgent,
      surQuestion: (oui) => {
        if (o.marque === oui) return;
        o.marque = oui; // la vue peut le dire avant que l'onglet ne soit dans la liste
        if (liste.includes(o)) afficher();
      },
    });
    o.zone = o.vue.corps;
    o.zone.detruire = o.vue.detruire;
    o.zone.vue = { focus: o.vue.focus };
    if (apres === undefined) liste.push(o);
    else liste.splice(apres, 0, o);
    return o;
  }

  /** Ouvre « opencode <n> » (plus petit numéro libre) à droite des onglets, actif, le focus dans « Message à opencode ». */
  function ouvrirOpencode({ sessionId }) {
    dernierGeste++;
    const o = trouver(OPENCODE + sessionId) ?? creerOpencode({ id: sessionId, numero: plusPetitNumeroLibre(liste.filter((x) => x.numero !== undefined && x.opencode).map((x) => x.numero)) });
    activerOpencode(o);
  }

  /** Ouvre l'onglet d'un sous-agent à droite de l'onglet actif, ou active celui qui existe. */
  function ouvrirSousAgent({ id, agent, titre }) {
    dernierGeste++;
    const i = liste.findIndex((x) => x.chemin === actif);
    const o = trouver(OPENCODE + id) ?? creerOpencode({ id, agent, titre }, i + 1);
    activerOpencode(o);
  }

  function activerOpencode(o) {
    activer(o.chemin);
    afficher();
    o.vue.focus();
    garderListe();
  }

  // ---- Onglet de diff (V-005) ----

  /** Ouvre le diff de `chemin` dans l'onglet de diff, qui remplace le précédent. `avis` : texte à montrer au lieu du diff. */
  function ouvrirDiff({ chemin, texte, avis }) {
    dernierGeste++;
    // Le diff déjà ouvert se met à jour dans son groupe ; sinon il s'ouvre dans le groupe courant.
    const groupeDiff = diff?.groupe ?? courant;
    const avant = actifDe(groupes.get(groupeDiff));
    if (avant !== DIFF) avantDiff = avant;
    diff?.el.detruire?.();
    diff?.el.remove();
    // La zone peut signaler sa position pendant sa création : `el` n'existe pas encore, on se repère au chemin.
    const el = avis ? indication({ texte: avis }) : zoneCode({ contenu: texte, mode: "diff", nom: nomDe(chemin), surPosition: () => actif === DIFF && diff?.chemin === chemin && publier(diff) });
    diff = { chemin, el, groupe: groupeDiff, rang: diff?.rang ?? null };
    activer(DIFF);
    afficher();
    el.vue?.focus();
  }

  function fermerDiff() {
    if (!diff) return;
    diff.el.detruire?.();
    diff.el.remove();
    const g = groupes.get(diff.groupe);
    diff = null;
    if (actifDe(g) === DIFF) poserActif(g, trouver(avantDiff)?.groupe === g.id ? avantDiff : (liste.find((x) => x.groupe === g.id)?.chemin ?? null));
    retirerSiVide(g);
    afficher();
    garderListe();
  }

  // ---- Déplacer un onglet (REQ-079) ----

  const ZONES = ["gauche", "droite", "haut", "bas", "centre"];

  /**
   * Déplace l'onglet `id` vers le groupe `cible` : `centre`, à droite de ses onglets ; un côté coupe le groupe en deux et
   * l'onglet occupe la nouvelle moitié. La vue est déplacée, jamais recréée ; le groupe d'arrivée devient courant et reçoit le focus.
   */
  function deplacer(id, cible, zone) {
    if (!ZONES.includes(zone)) throw new Error(`zone invalide : ${zone}`);
    const o = item(id);
    if (!o || !groupes.has(cible)) return;
    const depart = groupes.get(o.groupe);
    // Dans son propre groupe, ni le centre, ni un côté s'il n'a que cet onglet (AC-079-6).
    if (depart.id === cible && (zone === "centre" || ongletsDe(depart).length === 1)) return;
    const defilements = relever();
    let arrivee = cible;
    if (zone !== "centre") {
      arrivee = `g${++numeroGroupe}`;
      arbre = couper(arbre, cible, zone, arrivee);
      creerGroupe(arrivee);
    }
    if (depart.id !== arrivee && actifDe(depart) === id) {
      const ids = liste.filter((x) => x.groupe === depart.id).map((x) => x.chemin);
      // Le diff part : comme à sa fermeture, l'onglet d'avant s'il est dans ce groupe, sinon le premier.
      if (o === diff) poserActif(depart, ids.includes(avantDiff) ? avantDiff : (ids[0] ?? null));
      else poserActif(depart, apresFermeture(ids, id) ?? (diff && diff.groupe === depart.id ? DIFF : null));
    }
    if (o !== diff) {
      liste.splice(liste.indexOf(o), 1);
      liste.push(o);
    }
    o.groupe = arrivee;
    if (o === diff) diff.rang = liste.filter((x) => x.groupe === arrivee).length;
    passerA(arrivee);
    actif = id;
    groupes.get(arrivee).actif = id;
    retirerSiVide(depart);
    afficher();
    poser(defilements);
    for (const g of groupes.values()) {
      const a = item(actifDe(g));
      if (a?.claude) a.vue.ajuster();
    }
    window.dispatchEvent(new Event("resize"));
    (o === diff ? diff.el : o.zone).vue?.focus();
    garderListe();
  }

  // ---- Sauvegarde et fermeture ----

  async function ecrire(o, texte) {
    o.ecriture = ecrireFichier(o.chemin, texte, o.version);
    const r = await o.ecriture;
    // La version de base change avant la fin de l'écriture : une sauvegarde qui attendait part avec la bonne.
    if (!r.cause && !r.coupure) changerBase(o, texte, r.version);
    o.ecriture = null;
    return r;
  }

  /**
   * Écrit l'onglet. Rend `null` si c'est fait, `SANS_SUITE` si une question attend ou si le fichier a été rechargé
   * (rien n'est écrit), sinon le texte de l'échec.
   */
  async function sauvegarder(o) {
    // Une écriture en cours finit d'abord : la suivante part avec la version qu'elle rend.
    while (o.ecriture) await o.ecriture;
    if (o.question) return SANS_SUITE;
    const texte = o.zone.contenu();
    let r = await ecrire(o, texte);
    if (r.cause === "conflit" && !detruit) {
      // Le disque a changé depuis la version de base : jamais d'écrasement sans question.
      const lecture = await lireFichier(o.chemin);
      if (detruit) return "";
      if (lecture.coupure) return TEXTE_COUPURE;
      const d = decisionDisque(o, lecture);
      if (d === "adopter") {
        changerBase(o, lecture.contenu, lecture.version);
        r = await ecrire(o, texte);
      } else if (d === "recharger" || d === "demander") {
        appliquer(o, lecture, d);
        return SANS_SUITE;
      }
    }
    if (detruit) return "";
    if (r.coupure) return TEXTE_COUPURE;
    if (r.cause) return `Sauvegarde impossible pour ${nomDe(o.chemin)} : ${r.message.replace(/\.$/, "")}. Vos modifications sont gardées.`;
    effacerAvis(o);
    surSauvegarde();
    o.modifie = o.zone.contenu() !== texte;
    o.alerte?.remove();
    o.alerte = null;
    afficher();
    // Écrite tout de suite : un rechargement dans les 200 ms ne doit pas retrouver la garde d'avant la sauvegarde.
    clearTimeout(minuteur);
    minuteur = null;
    if (pret) ecrireGarde();
    return null;
  }

  // ---- Changements sur le disque (REQ-017) ----

  function changerBase(o, contenu, version) {
    o.disque = contenu;
    o.version = version;
    o.rev = (o.rev ?? 0) + 1;
  }

  function effacerAvis(o) {
    o.avis = null;
    o.question = null;
    o.supprime = false;
  }

  function poserQuestion(o, lecture) {
    if (o.question) {
      o.question.version = lecture.version;
      o.question.contenu = lecture.contenu;
      return;
    }
    o.supprime = false;
    const garderMa = bouton({ libelle: "Garder ma version", variante: "secondaire" });
    const prendre = bouton({ libelle: "Prendre celle du disque", variante: "secondaire" });
    const q = { version: lecture.version, contenu: lecture.contenu, garder: garderMa };
    o.question = q;
    o.avis = message({ texte: `${nomDe(o.chemin)} a changé sur le disque. Quelle version garder ?`, variante: "alerte", actions: [garderMa, prendre] });
    garderMa.addEventListener("click", () => {
      changerBase(o, q.contenu, q.version);
      o.modifie = o.zone.contenu() !== o.disque;
      effacerAvis(o);
      afficher();
      garderListe();
      o.zone.vue.focus();
    });
    prendre.addEventListener("click", () => {
      changerBase(o, q.contenu, q.version);
      effacerAvis(o);
      o.zone.remplacer(q.contenu);
      o.modifie = false;
      afficher();
      garderListe();
      o.zone.vue.focus();
    });
    afficher();
  }

  function appliquer(o, lecture, decision) {
    if (decision === "adopter") {
      changerBase(o, lecture.contenu, lecture.version);
      effacerAvis(o);
    } else if (decision === "recharger") {
      changerBase(o, lecture.contenu, lecture.version);
      effacerAvis(o);
      o.zone.remplacer(lecture.contenu);
      o.modifie = false;
    } else if (decision === "demander") {
      return poserQuestion(o, lecture);
    } else if (decision === "supprime") {
      if (o.supprime) return;
      effacerAvis(o);
      o.supprime = true;
      o.avis = message({ texte: TEXTE_SUPPRIME, variante: "alerte" });
    } else return;
    afficher();
    garderListe();
  }

  /** L'onglet de la question devient actif et le focus va sur « Garder ma version ». */
  function montrerQuestion(o) {
    activer(o.chemin);
    afficher();
    o.question.garder.focus();
    garderListe();
  }

  async function verifierDisque() {
    const fichiers = () => liste.filter(estFichier);
    if (coupe || !pret || detruit || sondageEnCours || fichiers().length === 0) return;
    sondageEnCours = true;
    try {
      const instantane = new Map(fichiers().map((o) => [o, o.rev]));
      const versions = await versionsFichiers(fichiers().map((o) => o.chemin));
      if (!versions || detruit) return;
      const inchange = (o) => liste.includes(o) && o.rev === instantane.get(o) && !o.ecriture;
      for (const o of instantane.keys()) {
        if (detruit) return;
        if (!inchange(o)) continue;
        const v = versions[o.chemin];
        if (v === undefined) continue;
        if (v === null) {
          appliquer(o, null, "supprime");
          continue;
        }
        if (o.supprime) {
          effacerAvis(o);
          afficher();
        }
        if (v === o.version || v === o.question?.version) continue;
        const lecture = await lireFichier(o.chemin);
        if (detruit || !inchange(o)) continue;
        appliquer(o, lecture, decisionDisque(o, lecture));
      }
    } finally {
      sondageEnCours = false;
    }
  }

  function planifierDisque() {
    minuteurDisque = setTimeout(async () => {
      await verifierDisque();
      if (!detruit) planifierDisque();
    }, INTERVALLE_DISQUE);
  }

  function mettreEnAttente(o) {
    attente.add(o);
    direAttente();
    garderListe();
  }

  /** Lance les Ctrl+S en attente. */
  function executerAttente() {
    const a = [...attente];
    attente.clear();
    direAttente();
    garderListe(); // « Ctrl+S en attente » ne reste pas gardé
    for (const o of a) sauvegarderEtDire(o);
  }

  async function sauvegarderEtDire(o) {
    const echec = await sauvegarder(o);
    if (!echec) return;
    if (echec === SANS_SUITE) return garderListe(); // refus du serveur : la question remplace le Ctrl+S
    if (echec === TEXTE_COUPURE) {
      mettreEnAttente(o);
      // La coupure n'est pas encore détectée (ou le retour a été trop bref) : sans changement d'état, personne ne relancerait.
      setTimeout(() => {
        if (!detruit && !coupe && attente.has(o)) executerAttente();
      }, DELAI_DETECTION);
      return;
    }
    o.alerte?.remove();
    o.alerte = dire({ texte: echec, variante: "alerte", fermable: true });
  }

  const fermer = (chemin) => {
    const agentActif = actif === chemin && trouver(chemin)?.conversationAgent;
    const avant = groupes.size;
    const issue = fermerOnglet(chemin, false);
    // L'onglet Agent actif fermé, ou son groupe disparu : le focus était sur la barre, il va dans l'onglet actif du groupe courant
    // (le voisin du groupe disparu), ou sur « Ouvrir un fichier ».
    if (trouver(chemin)) {
      // Fichier modifié : le dialogue décide, et le focus suit sa fermeture.
      issue.then((r) => r === "fermé" && !detruit && groupes.size < avant && focusActif());
      return;
    }
    if (!agentActif && groupes.size === avant) return;
    focusActif();
  };

  /**
   * Ferme un onglet, avec le dialogue de REQ-014 s'il est modifié. Rend une promesse de l'issue :
   * `fermé`, `annulé` ou `échec` (dans une série, une sauvegarde impossible ferme le dialogue et affiche un bandeau).
   */
  function fermerOnglet(chemin, serie) {
    if (chemin === DIFF) {
      fermerDiff();
      return Promise.resolve("fermé");
    }
    const o = trouver(chemin);
    if (!o) return Promise.resolve("fermé");
    if (o.claude && coupe) {
      refuserArret();
      return Promise.resolve("annulé");
    }
    if (o.question) {
      montrerQuestion(o);
      return Promise.resolve("annulé");
    }
    if (!o.modifie) {
      retirer(chemin);
      return Promise.resolve("fermé");
    }
    return new Promise((resolve) => {
      const annuler = bouton({ libelle: "Annuler" });
      const abandonner = bouton({ libelle: "Abandonner" });
      const ok = bouton({ libelle: "Sauvegarder", variante: "principal" });
      const zone = document.createElement("div");
      const texte = document.createElement("p");
      texte.textContent = "Ce fichier a des modifications non sauvegardées.";
      zone.append(texte);
      const annulerTout = () => {
        dlg.fermer();
        resolve("annulé");
      };
      const dlg = dialogue({
        titre: `Sauvegarder ${nomDe(chemin)} ?`,
        contenu: [zone],
        actions: [annuler, abandonner, ok],
        focusInitial: ok,
        surAnnuler: annulerTout,
      });
      annuler.addEventListener("click", annulerTout);
      abandonner.addEventListener("click", () => {
        dlg.fermer({ rendreFocus: false });
        retirer(chemin);
        resolve("fermé");
      });
      ok.addEventListener("click", async () => {
        dlg.enCours(true);
        const echec = await sauvegarder(o);
        if (detruit) return;
        if (echec === SANS_SUITE) {
          dlg.fermer({ rendreFocus: false });
          if (o.question) montrerQuestion(o);
          return resolve("annulé");
        }
        if (echec && serie) {
          dlg.fermer({ rendreFocus: false });
          o.alerte?.remove();
          o.alerte = dire({ texte: echec, variante: "alerte", fermable: true });
          return resolve("échec");
        }
        if (echec) {
          dlg.enCours(false);
          zone.replaceChildren(texte, message({ texte: echec, variante: "alerte" }));
          return;
        }
        dlg.fermer({ rendreFocus: false });
        retirer(chemin);
        resolve("fermé");
      });
      dlg.ouvrir();
    });
  }

  // ---- Menu des onglets et série de fermetures (REQ-061) ----

  /** Onglets de la barre du groupe `groupe`, dans l'ordre de la barre. */
  const ordreDe = (groupe) => (groupes.has(groupe) ? ongletsDe(groupes.get(groupe)).map(idDe) : []);
  const existe = (id) => (id === DIFF ? Boolean(diff) : Boolean(trouver(id)));

  // Sans connexion, la session ne peut pas s'arrêter : l'onglet Claude reste (design.md, coupure).
  const refuserArret = () => dire({ texte: TEXTE_COUPURE, variante: "alerte", fermable: true });

  /** Ferme `ids` : d'abord les onglets sans modification, sans question ; puis chaque onglet modifié, un dialogue à la fois. */
  async function fermerSerie(ids, vise) {
    const groupeVise = item(vise)?.groupe;
    let refus = false;
    for (const id of ids) {
      if (id === DIFF) fermerDiff();
      else if (trouver(id)?.claude && coupe) refus = true;
      else if (trouver(id) && !trouver(id).modifie && !trouver(id).question) retirer(id);
    }
    if (refus) refuserArret();
    let arret = null;
    for (const id of ids) {
      const o = id === DIFF ? null : trouver(id);
      if (!o || o.question || o.claude) continue;
      activer(id);
      afficher();
      if ((await fermerOnglet(id, true)) !== "fermé") {
        arret = id;
        break;
      }
      if (detruit) return;
    }
    if (detruit) return;
    // Barre vidée : le groupe a disparu et son voisin est courant, avec son onglet actif.
    if (groupes.has(groupeVise)) {
      const reste = ordreDe(groupeVise);
      const apres = arret && existe(arret) ? arret : existe(vise) ? vise : (reste[0] ?? null);
      if (apres === null) poserActif(groupes.get(groupeVise), null);
      else activer(apres);
    }
    afficher();
    garderListe();
    focusActif();
  }

  function ouvrirMenu(id, position) {
    if (!existe(id)) return;
    dernierGeste++;
    activer(id);
    afficher();
    const onglet = groupes.get(courant).barre.querySelector("[role=tab][aria-selected=true]");
    onglet?.focus();
    const libelle = id === DIFF ? `${nomDe(diff.chemin)} (diff)` : nomsOnglets().get(trouver(id)).libelle;
    const tous = ordreDe(item(id).groupe);
    const commandes = [];
    if (tous.length >= 2) commandes.push({ libelle: "Fermer les autres onglets", surChoix: () => fermerSerie(tous.filter((x) => x !== id), id) });
    commandes.push({ libelle: "Fermer tous les onglets", surChoix: () => fermerSerie(tous, id) });
    menu({ nom: `Actions sur ${libelle}`, groupes: [commandes], ...(position ? { position } : { ancre: onglet }), surFermeture: () => {} });
  }

  // Ctrl+S, partout sauf dans un shell : le dialogue du navigateur ne s'ouvre jamais.
  const surTouche = (e) => {
    const s = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "s";
    if (!s || e.target.closest?.(".terminal")) return;
    e.preventDefault();
    if (document.querySelector("[role=dialog], dialog[open]")) return;
    const o = trouver(actif);
    if (!o || !estFichier(o)) return;
    if (o.question) return montrerQuestion(o);
    if (coupe) mettreEnAttente(o);
    else sauvegarderEtDire(o);
  };
  document.addEventListener("keydown", surTouche);

  // ---- Retour : onglets gardés ----

  const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

  /** Lit le fichier d'un onglet gardé ; tant que le serveur ne répond pas, on réessaie : rien n'est effacé. */
  async function lireGarde(g) {
    for (;;) {
      const lecture = await lireFichier(g.chemin);
      if (detruit || decider(g, lecture) !== "reessayer") return lecture;
      await attendre(1500);
    }
  }

  /** Pose la disposition gardée : un groupe par feuille, chacun avec son onglet actif, et le groupe courant. */
  function installerDisposition({ arbre: gardee, courant: gardeCourant }) {
    const ids = feuilles(gardee).map((f) => f.id);
    groupes.get(courant).actif = actif;
    for (const id of ids) if (!groupes.has(id)) creerGroupe(id);
    for (const id of [...groupes.keys()]) if (!ids.includes(id)) groupes.delete(id);
    for (const f of feuilles(gardee)) groupes.get(f.id).actif = f.actif;
    arbre = gardee;
    numeroGroupe = Math.max(numeroGroupe, ...ids.map((id) => (/^g\d+$/.test(id) ? Number(id.slice(1)) : 0)));
    courant = gardeCourant;
    actif = groupes.get(courant).actif;
    // Ce que l'utilisateur a ouvert pendant la lecture, dans un groupe qui n'existe plus, va dans le groupe courant.
    for (const x of [...liste, ...(diff ? [diff] : [])]) if (!groupes.has(x.groupe)) x.groupe = courant;
  }

  async function restaurer() {
    const gardes = await retrouver();
    const instance = claude && gardes.liste.some((g) => g.claude) ? (await listeShells())?.instance : undefined;
    const lus = await Promise.all(gardes.liste.map((g) => (g.claude || g.opencode || g.conversationAgent ? null : lireGarde(g))));
    if (detruit) return;
    lectures--;
    const aVerifier = [];
    let precedent = null;
    const prefere = actif === DIFF || trouver(actif) ? actif : null; // choisi par l'utilisateur pendant la lecture
    const dejaLa = new Set(liste);
    installerDisposition(gardes.disposition);
    gardes.liste.forEach((g, i) => {
      if (g.claude && !claude) {
        cachees.push({ garde: g, apres: precedent });
        return;
      }
      if (g.conversationAgent && !agents) {
        cachees.push({ garde: g, apres: precedent });
        return;
      }
      if (!g.claude) precedent = cleGarde(g);
      if (g.conversationAgent) {
        if (!trouver(AGENT + g.numero)) creerAgent(g);
        return;
      }
      if (g.opencode) {
        if (!trouver(OPENCODE + g.id)) creerOpencode(g);
        return;
      }
      if (g.claude) {
        // Yaide relancé : ses sessions n'existent plus. Sans réponse du serveur, la vue se rebranche ou découvre la disparition.
        if (g.instance && instance && g.instance !== instance) return;
        precedent = cleGarde(g);
        if (!trouver(CLAUDE + g.id)) creerClaude(g);
        return;
      }
      if (trouver(g.chemin)) return;
      const r = lus[i];
      const decision = decider(g, r);
      const apercu = Boolean(g.apercu);
      const hybride = Boolean(g.hybride);
      let o;
      if (decision === "creer") {
        // Un brouillon garde sa version de base : si le disque a changé pendant l'absence, la question est posée.
        const brouillon = typeof g.texte === "string" && typeof g.base === "string" && typeof g.version === "string" && g.texte !== r.contenu;
        o = creer({ chemin: g.chemin, contenu: brouillon ? g.base : r.contenu, version: brouillon ? g.version : r.version, texte: g.texte, apercu, hybride });
      } else if (decision === "recreer") o = creer({ chemin: g.chemin, contenu: "", texte: g.texte, apercu, hybride });
      if (o) aVerifier.push([o, r]);
      if (o && g.attente) attente.add(o);
    });
    direAttente();
    // Chaque onglet revient dans son groupe s'il existe, sinon dans le groupe courant ; un groupe sans onglet disparaît.
    for (const g of gardes.liste) {
      const o = trouver(cleGarde(g));
      if (o && !dejaLa.has(o)) o.groupe = groupes.has(g.groupe) ? g.groupe : courant;
    }
    for (const f of feuilles(arbre)) retirerSiVide(groupes.get(f.id));
    for (const g of groupes.values()) if (!ongletsDe(g).some((x) => idDe(x) === g.actif)) g.actif = ongletsDe(g).map(idDe)[0] ?? null;
    actif = groupes.get(courant).actif;
    if (prefere !== null) activer(prefere);
    pret = true;
    for (const [o, r] of aVerifier) appliquer(o, r, decisionDisque(o, r));
    afficher();
    garderListe();
    if (!coupe) executerAttente();
    planifierDisque();
    if (actif && document.activeElement === document.body) {
      // Un onglet Claude reçoit le focus, pas son terminal : Entrée l'y met (AC-068-17).
      if (trouver(actif)?.claude) groupes.get(courant).barre.querySelector("[role=tab][aria-selected=true]")?.focus();
      else trouver(actif)?.zone.vue.focus();
    }
  }

  afficher();
  return {
    barre,
    fil,
    code,
    /** Zone de la question de l'onglet actif du premier groupe (C-003 dans `questionOnglet`). */
    question: questionOnglet,
    /** Arbre des groupes, feuilles `{ id, ongletsFichiers, questionOnglet, fil, code }`. */
    groupes: () => arbreComplet(),
    /** Les zones de question de tous les groupes. */
    questions: () => [...groupes.values()].map((g) => g.questionOnglet),
    deplacer,
    /** Une lecture de fichier commence (`oui`, rend son numéro de geste) ou se termine. */
    lecture(oui) {
      lectures = Math.max(0, lectures + (oui ? 1 : -1));
      afficher();
      if (oui) return ++dernierGeste;
    },
    /** "connecte" ou "coupe" : au retour, les Ctrl+S mis en attente s'exécutent. */
    definirEtat(etat) {
      coupe = etat === "coupe";
      if (coupe) return;
      executerAttente();
      verifierDisque();
    },
    /** Pose les statuts git (`Map` chemin -> `{ lettre, mot }`) ; la barre n'est refaite que si un onglet change. */
    definirStatuts(nouveaux) {
      const avant = liste.map((o) => statutOnglet(o.chemin)).join();
      statuts = nouveaux;
      if (liste.map((o) => statutOnglet(o.chemin)).join() !== avant) afficher();
    },
    ouvrir,
    ouvrirClaude,
    ouvrirAgent,
    relireReglagesAgents,
    ouvrirOpencode,
    ouvrirDiff,
    fermerDiff,
    /** Chemin du fichier dont le diff est ouvert, ou null. */
    diffOuvert: () => diff?.chemin ?? null,
    /** Relit le disque tout de suite (après un changement de branche ou un pull). */
    relireDisque: verifierDisque,
    renomme,
    supprime,
    restaurer,
    detruire() {
      detruit = true;
      depot.detruire();
      clearTimeout(minuteur);
      clearTimeout(minuteurDisque);
      if (pret) ecrireGarde(); // le texte tapé dans les dernières 200 ms n'est pas perdu
      document.removeEventListener("keydown", surTouche);
      for (const ev of finsPression) document.removeEventListener(ev, finPression);
      for (const o of liste) o.zone.detruire();
      diff?.el.detruire?.();
    },
  };
}
