import { deconnexion } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { cadre } from "../ui/cadre.js";
import { borner, limites } from "../ui/poignee.js";
import { ecrire, lire } from "../stockage.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { surveiller } from "../connexion.js";
import { changerTheme, themeCourant } from "../ui/theme.js";
import { vueAgent } from "./agent.js";
import { vueEditeur } from "./editeur.js";
import { vueFichiers } from "./fichiers.js";
import { vueGit } from "./git.js";
import { vueOuverture } from "./ouverture.js";
import { ouvrirProfils } from "./profils.js";
import { ouvrirProviders } from "./providers.js";
import { vueRecherche } from "./recherche.js";
import { statutsDe } from "../statuts.js";
import { vueShells } from "./shells.js";

const PANNEAUX = [
  { id: "fichiers", icone: "files", raccourci: "F", nomAccessible: "Fichiers", touche: "f", titre: "Fichiers" },
  { id: "recherche", icone: "search", raccourci: "R", nomAccessible: "Recherche", touche: "r", titre: "Recherche" },
  { id: "git", icone: "branch", raccourci: "G", nomAccessible: "Git", touche: "g", titre: "Git" },
];

function nomDuDossier(chemin) {
  return chemin.split("/").filter(Boolean).pop() ?? chemin;
}

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";

/** V-002. `surDeconnexion` est appelé une fois la session fermée, `surExpiree` si elle expire. */
export function vuePrincipale({ chemin, surDeconnexion, surExpiree = surDeconnexion }) {
  document.title = `${nomDuDossier(chemin)} — yaide`;

  const sortir = bouton({ icone: "log-out", nomAccessible: "Déconnexion" });
  sortir.addEventListener("click", async () => {
    if (etat !== "coupe" && (await deconnexion())) surDeconnexion();
    else dire({ texte: TEXTE_COUPURE, variante: "alerte" });
  });
  const theme = bouton({ icone: "sun", nomAccessible: "Thème clair", presse: themeCourant() === "light" });
  theme.addEventListener("click", () => {
    changerTheme(themeCourant() === "light" ? "dark" : "light");
    theme.setAttribute("aria-pressed", String(themeCourant() === "light"));
  });

  // Le panneau replié laisse la place à l'éditeur ; la vue et les tailles restent en mémoire.
  const boutonAgent = bouton({ icone: "bot", nomAccessible: "Agent", raccourci: "A", positionInfoBulle: "gauche", actif: false });
  const repliAgent = bouton({ icone: "panel-right-close", nomAccessible: "Replier l'agent", positionInfoBulle: "gauche" });
  boutonAgent.addEventListener("click", entrerDansAgent);
  repliAgent.addEventListener("click", () => {
    replierAgent(true);
    boutonAgent.poserFocus();
  });
  const boutonPanneau = bouton({ icone: "panel-left-close", nomAccessible: "Replier le panneau" });
  let panneauReplie = false;
  let agentReplie = true;
  boutonPanneau.addEventListener("click", () => {
    replierPanneau(!panneauReplie);
    if (panneauReplie) boutonPanneau.poserFocus();
    else entrerDansPanneau();
  });
  const repliEntete = bouton({ icone: "panel-left-close", nomAccessible: "Replier le panneau", positionInfoBulle: "droite" });
  repliEntete.addEventListener("click", () => {
    replierPanneau(true);
    boutonPanneau.poserFocus();
  });
  function replierPanneau(oui) {
    panneauReplie = oui;
    // Place pour une seule colonne : déplier le panneau replie l'agent.
    if (!oui && agentReplie === false && etroit()) replierAgent(true);
    racine.definirReplis({ panneau: oui });
    boutonPanneau.definirCommande(oui ? { nomAccessible: "Déplier le panneau", icone: "panel-left-open" } : { nomAccessible: "Replier le panneau", icone: "panel-left-close" });
    recalculer();
    ecrire("replis", { panneau: panneauReplie, agent: agentReplie });
  }
  function replierAgent(oui) {
    agentReplie = oui;
    // Place pour une seule colonne : déplier l'agent replie le panneau.
    if (!oui && !panneauReplie && etroit()) replierPanneau(true);
    racine.definirReplis({ agent: oui });
    boutonAgent.definirActif(!oui);
    recalculer();
    ecrire("replis", { panneau: panneauReplie, agent: agentReplie });
  }
  // « Agent » et A : déplie l'agent s'il est replié, et met le focus dans « Message à l'agent ».
  function entrerDansAgent() {
    if (agentReplie) {
      replierAgent(false);
      agent.deplier();
    }
    agent.focuser();
  }
  const etroit = () => window.innerWidth < limites({ L: window.innerWidth, H: window.innerHeight }).seuil;
  // Dépliage : l'arborescence est relue (silencieusement), puis le focus entre dans le panneau.
  function entrerDansPanneau() {
    if (!fichiers.corps.hidden) fichiers.relire().catch(() => {});
    corps.focus();
  }

  // Barre d'état : la branche, puis la position et le langage de l'onglet actif.
  let racine = null;
  const barre = {};
  const majEtat = () => racine?.definirEtat(barre);

  // Bandeaux : la coupure d'abord, puis un seul message à la fois.
  const bandeaux = document.createElement("div");
  const places = { coupure: null, message: null };
  const montrerBandeau = (nom, element) => {
    places[nom]?.remove();
    places[nom] = element;
    if (element) bandeaux.append(element);
  };
  let etat = "connecte";
  let attenteTexte = "";
  function montrerCoupure() {
    if (etat !== "coupe") return montrerBandeau("coupure", null);
    const texte = ["Connexion perdue. Modifications gardées.", attenteTexte].filter(Boolean).join(" ");
    montrerBandeau("coupure", message({ texte, variante: "alerte", fort: true }));
  }
  function dire({ texte, variante, detail, fermable = false }) {
    const m = message({ texte, variante, detail, fermable });
    montrerBandeau("message", m);
    return m;
  }

  let fichiers = null; // créé après l'éditeur, dont les premiers rappels arrivent avant
  let git = null; // créé après l'arbre, dont la première lecture le demande
  // La zone des shells sort de la page sans shell visible ; la poignée reprend sa taille à son retour.
  const shells = vueShells({
    dire,
    surZone: (oui, replie) => {
      racine?.definirShellsVisibles(oui);
      racine?.definirReplis({ shells: replie });
      recalculer();
    },
  });
  const editeur = vueEditeur({
    dire,
    ouvrirRapide: () => ouverture.ouvrir(),
    surAttente: (t) => { attenteTexte = t; montrerCoupure(); },
    surCourant: (chemin) => fichiers?.definirCourant(chemin),
    surSauvegarde: () => git?.rafraichir(),
    surActif: (a) => {
      barre.position = a?.position;
      barre.langage = a?.langage;
      majEtat();
    },
  });
  // V-008 et V-009 ; à sa fermeture, le focus revient à l'élément d'avant Ctrl+P.
  let panneauConfig = null;
  const ouverture = vueOuverture({
    dire,
    surOuvrir: editeur.ouvrir,
    surLecture: editeur.lecture,
    surCommande: (id, avant) => {
      const ouvrirPanneau = { providers: ouvrirProviders, profils: ouvrirProfils }[id];
      if (!ouvrirPanneau) return;
      panneauConfig = ouvrirPanneau({ surFermeture: () => { panneauConfig = null; agent.relireReglages(); avant?.focus?.(); } });
    },
  });
  fichiers = vueFichiers({
    dire,
    projet: nomDuDossier(chemin),
    lireEtat: () => git?.rafraichir(),
    estDepot: () => git.estDepot(),
    surCommit: () => {
      rail.choisir("git");
      afficherPanneau("git");
      git.focuserMessage();
    }, surOuvrir: editeur.ouvrir, surRenomme: editeur.renomme, surSupprime: editeur.supprime, surLecture: editeur.lecture,
  });
  const recherche = vueRecherche({ dire, surOuvrir: editeur.ouvrir, surLecture: editeur.lecture });
  git = vueGit({
    dire,
    surBranche: (b) => {
      barre.branche = b ? (b.detachee ? "détachée" : b.branche) : undefined;
      majEtat();
    },
    surEtat: (etat) => {
      const statuts = etat ? statutsDe(etat.changements) : null;
      fichiers.definirStatuts(statuts);
      editeur.definirStatuts(statuts ?? new Map());
      nombre = etat ? etat.changements.length : 0;
      majRail();
    },
    surDiff: editeur.ouvrirDiff,
    diffOuvert: editeur.diffOuvert,
    fermerDiff: editeur.fermerDiff,
    surDisque: editeur.relireDisque,
  });
  const agent = vueAgent({});
  const restauration = editeur.restaurer();

  let nombre = 0; // changements git, affichés sur l'icône Git du rail
  const majRail = () => rail.definirCompteur("git", nombre);
  const rail = onglets({
    orientation: "verticale",
    onglets: PANNEAUX.map(({ id, icone, nomAccessible, raccourci }) => ({ id, icone, nomAccessible, raccourci })),
    actif: "fichiers",
    surChoix: afficherPanneau,
  });

  const choisies = {};
  let detruite = false;
  racine = cadre({
    barreTitre: { projet: nomDuDossier(chemin), chemin, surOuvrir: () => ouverture.ouvrir(), actions: [boutonPanneau.enveloppe, shells.repli.enveloppe, theme.enveloppe, sortir.enveloppe] },
    rail: { onglets: rail, commandes: shells.commandes },
    panneau: { titre: "Fichiers", repli: repliEntete.enveloppe, entete: fichiers.entete, corps: [fichiers.corps, recherche.corps, git.corps] },
    agent: { titre: "Agent", repli: repliAgent.enveloppe, corps: agent.corps },
    railDroit: { commandes: [boutonAgent.enveloppe] },
    principal: { bandeaux, ongletsFichiers: editeur.barre, questionOnglet: editeur.question, fil: editeur.fil, code: editeur.code, shells },
    barreEtat: barre,
    surChangement: (zone, taille) => {
      choisies[zone] = taille;
      racine.definirTailles({ [zone]: taille });
    },
    surFin: () => ecrire("tailles", { ...choisies }),
  });

  // Sans shell à l'arrivée : la zone reste hors page le temps de lire la liste.
  racine.definirShellsVisibles(false);

  // Poignées : limites recalculées à chaque changement de la fenêtre, des bandeaux ou de la question d'onglet.
  // La taille choisie ne change que par un glissé ou une flèche ; la taille affichée est la choisie, bornée.
  function recalculer() {
    if (detruite) return;
    const hauteurs = [bandeaux, editeur.question].reduce((s, e) => s + e.offsetHeight, 0);
    const lim = limites({
      L: window.innerWidth,
      H: window.innerHeight,
      bandeaux: hauteurs,
      panneau: { replie: panneauReplie, choisie: choisies.panneau },
      agent: { replie: agentReplie, choisie: choisies.agent },
    });
    // Une fenêtre qui passe sous le seuil, les deux colonnes dépliées : le panneau se replie.
    if (!panneauReplie && !agentReplie && window.innerWidth < lim.seuil) return replierPanneau(true);
    const bornees = {};
    for (const zone of ["panneau", "agent", "shells"]) {
      racine.poignees[zone].definir(lim[zone]);
      if (choisies[zone] !== undefined) bornees[zone] = borner(choisies[zone], lim[zone]);
    }
    // Chaque colonne dépliée prend sa largeur affichée, même sans taille choisie.
    if (!panneauReplie) bornees.panneau = lim.Pa;
    if (!agentReplie) bornees.agent = lim.Aa;
    racine.definirTailles(bornees);
    racine.mesurer();
  }
  window.addEventListener("resize", recalculer);
  const observateur = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(recalculer);
  observateur?.observe(bandeaux);
  observateur?.observe(editeur.question);
  // La vue n'est dans la page qu'après sa création : on mesure juste après le montage.
  queueMicrotask(recalculer);
  lire("tailles").then((gardees) => {
    for (const zone of ["panneau", "agent", "shells"]) {
      const t = gardees?.[zone];
      if (choisies[zone] === undefined && Number.isFinite(t)) choisies[zone] = t;
    }
    recalculer();
  });
  // Repli gardé : le panneau reste replié, et le focus va sur « Ouvrir un fichier » s'il n'y a aucun onglet.
  Promise.all([lire("replis"), restauration]).then(([gardes]) => {
    if (detruite) return;
    if (gardes?.agent === false) {
      replierAgent(false);
      agent.deplier();
    }
    if (gardes?.panneau && !panneauReplie) replierPanneau(true);
    if (!panneauReplie) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    racine.querySelector(".editeur-code button")?.focus();
  });
  const titre = racine.querySelector(".cadre-panneau-titre");
  const corps = racine.querySelector(".cadre-panneau-corps");
  corps.tabIndex = -1;

  function afficherPanneau(id) {
    const p = PANNEAUX.find((x) => x.id === id);
    titre.textContent = p.titre;
    corps.setAttribute("aria-label", p.titre);
    const visible = id === "fichiers";
    if (visible && fichiers.corps.hidden && !panneauReplie) fichiers.rafraichir();
    fichiers.corps.hidden = fichiers.entete.hidden = !visible;
    recherche.montrer(id === "recherche");
    git.montrer(id === "git");
  }
  afficherPanneau("fichiers");

  // Clic sur un onglet du rail : le focus entre dans le panneau.
  rail.addEventListener("click", (e) => {
    const onglet = e.target.closest("[role=tab]");
    if (!onglet) return;
    if (panneauReplie) {
      replierPanneau(false);
      entrerDansPanneau();
    }
    corps.focus();
    if (onglet.getAttribute("aria-label") === "Recherche") recherche.focuser();
  });
  // Focus sur le rail : F, R et G affichent le panneau et y mettent le focus.
  // Les deux boutons de commande du rail comptent aussi : la garde est posée sur toute la colonne.
  racine.querySelector(".cadre-rail").addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !e.target.closest("[role=tab], .cadre-rail-commandes button")) return;
    if (e.key.toLowerCase() === "a") return entrerDansAgent();
    const p = PANNEAUX.find((x) => x.touche === e.key.toLowerCase());
    if (!p) return;
    rail.choisir(p.id);
    afficherPanneau(p.id);
    if (panneauReplie) {
      replierPanneau(false);
      entrerDansPanneau();
    }
    corps.focus();
    if (p.id === "recherche") recherche.focuser();
  });
  racine.querySelector(".cadre-rail-droit").addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !e.target.closest("button") || e.key.toLowerCase() !== "a") return;
    // Sans cela, la lettre serait tapée dans le champ qui reçoit le focus.
    e.preventDefault();
    entrerDansAgent();
  });

  // Ctrl+Maj+F, partout (même dans un shell) : le focus passe sur le bouton actif du rail.
  const surTouche = (e) => {
    const f = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "f";
    if (!f || document.querySelector("[role=dialog], dialog[open]")) return;
    e.preventDefault();
    rail.querySelector("[role=tab][aria-selected=true]")?.focus();
  };
  document.addEventListener("keydown", surTouche);

  const arreter = surveiller({
    surEtat(nouvel) {
      if (nouvel === "expiree") return surExpiree();
      const retour = etat === "coupe";
      etat = nouvel;
      shells.definirEtat(nouvel);
      montrerCoupure();
      editeur.definirEtat(nouvel);
      if (nouvel !== "coupe") {
        if (places.message?.textContent.includes(TEXTE_COUPURE)) montrerBandeau("message", null);
        // Une lecture de l'état git perdue pendant la coupure : personne d'autre ne la relance.
        if (retour) git.rafraichir();
      }
    },
  });

  // Relecture de l'état git, et de l'arbre s'il est affiché, toutes les 3 s ; la suivante part à la fin de la précédente.
  const INTERVALLE_RELECTURE = 3000;
  let minuteurRelecture = setTimeout(relire, INTERVALLE_RELECTURE);
  async function relire() {
    if (etat !== "coupe") {
      try {
        await Promise.all([git.relire(), fichiers.corps.hidden || panneauReplie ? null : fichiers.relire()]);
      } catch {
        // Une réponse illisible ne doit pas arrêter la boucle : la suivante réessaie.
      }
    }
    if (!detruite) minuteurRelecture = setTimeout(relire, INTERVALLE_RELECTURE);
  }

  racine.detruire = () => {
    clearTimeout(minuteurRelecture);
    arreter();
    detruite = true;
    window.removeEventListener("resize", recalculer);
    observateur?.disconnect();
    document.removeEventListener("keydown", surTouche);
    shells.detruire();
    editeur.detruire();
    fichiers.detruire();
    git.detruire();
    recherche.detruire();
    agent.detruire();
    ouverture.detruire();
    panneauConfig?.fermer();
  };
  return racine;
}
