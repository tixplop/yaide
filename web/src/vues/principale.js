import { claudeDisponible, creerChemin, creerSession, deconnexion, lireFichier, opencodeDisponible, ouvrirClaude, reglagesAgent } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { cadre } from "../ui/cadre.js";
import { borner, limites } from "../ui/poignee.js";
import { ecrire, lire } from "../stockage.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { reprendreDernierChoix } from "../opencode.js";
import { vueServeursMcp } from "./serveurs-mcp.js";
import { vueSessionsOpencode } from "./sessions-opencode.js";
import { surveiller } from "../connexion.js";
import { changerTheme, themeCourant } from "../ui/theme.js";
import { vueAgents } from "./agents.js";
import { vueEditeur } from "./editeur.js";
import { vueFichiers } from "./fichiers.js";
import { vueGit } from "./git.js";
import { vueOuverture } from "./ouverture.js";
import { ouvrirPreferences } from "./preferences.js";
import { ouvrirProfils } from "./profils.js";
import { ouvrirProviders } from "./providers.js";
import { vueRecherche } from "./recherche.js";
import { statutsDe } from "../statuts.js";
import { suivreVersion } from "../version.js";
import { abonner as abonnerWorktree } from "../worktree.js";
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
export function vuePrincipale({ chemin, surDeconnexion, surExpiree = surDeconnexion, reglages = {} }) {
  const imposes = reglages.replis ?? {};
  // Une fonction désactivée n'est pas créée : ni vue, ni minuteur, ni requête.
  const avec = { recherche: true, git: true, shells: true, agents: true, claude: true, ...reglages.fonctions };
  const panneaux = PANNEAUX.filter((p) => avec[p.id] !== false);
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
  let agentConserve; // repli de l'agent gardé, que l'on n'écrase pas quand les agents sont désactivés
  const gardeReplis = () => ({ panneau: panneauReplie, agent: avec.agents ? agentReplie : agentConserve });
  const boutonAgent = bouton({ icone: "bot", nomAccessible: "Agent", infoBulle: "Nouvelle session Agent", raccourci: "A", positionInfoBulle: "gauche" });
  const boutonAgents = bouton({ icone: "users", nomAccessible: "Agents", positionInfoBulle: "gauche", actif: false });
  const repliAgent = bouton({ icone: "panel-right-close", nomAccessible: "Replier l'agent", positionInfoBulle: "gauche" });
  const boutonClaude = bouton({ icone: "asterisk", nomAccessible: "Claude", infoBulle: "Nouvelle session Claude", positionInfoBulle: "gauche" });
  boutonClaude.addEventListener("click", async () => {
    const r = await ouvrirClaude();
    if (detruite) return;
    if (r.coupure) return dire({ texte: TEXTE_COUPURE, variante: "alerte" });
    if (r.erreur !== undefined) return dire({ texte: `Impossible d'ouvrir une session Claude : ${String(r.erreur).replace(/\.$/, "")}.`, variante: "alerte", fermable: true });
    editeur.ouvrirClaude({ id: r.id });
  });
  const boutonOpencode = bouton({ icone: "code-xml", nomAccessible: "opencode", infoBulle: "Nouvelle session opencode", positionInfoBulle: "gauche" });
  boutonOpencode.addEventListener("click", async () => {
    if (boutonOpencode.getAttribute("aria-busy") === "true") return;
    boutonOpencode.definirOccupe(true);
    boutonOpencode.setAttribute("aria-disabled", "true");
    const r = await creerSession(chemin);
    const id = r.donnees?.data?.id;
    // Le dernier choix est repris avant l'onglet, le bouton restant occupé (REQ-075).
    if (!detruite && !r.coupure && r.erreur === undefined && id !== undefined) await reprendreDernierChoix(id);
    boutonOpencode.definirOccupe(false);
    boutonOpencode.removeAttribute("aria-disabled");
    if (detruite) return;
    if (r.coupure) return dire({ texte: TEXTE_COUPURE, variante: "alerte" });
    if (r.erreur !== undefined || id === undefined) return dire({ texte: `Impossible d'ouvrir une session opencode : ${String(r.erreur ?? "réponse illisible").replace(/\.$/, "")}.`, variante: "alerte", fermable: true });
    editeur.ouvrirOpencode({ sessionId: id });
  });
  const boutonSessions = bouton({ icone: "messages-square", nomAccessible: "Sessions opencode", positionInfoBulle: "gauche" });
  boutonSessions.setAttribute("aria-haspopup", "dialog");
  const sessions = vueSessionsOpencode({
    chemin,
    surEtat: (ouvert) => boutonSessions.definirOuvert(ouvert),
    surChoix: ({ id, titre }) => editeur.ouvrirOpencode({ sessionId: id, titre }),
  });
  boutonSessions.addEventListener("click", () => sessions.ouvrir());
  const boutonMcp = avec.agents ? bouton({ icone: "server", nomAccessible: "Serveurs MCP", positionInfoBulle: "gauche", ouvreDialogue: true }) : null;
  const serveursMcp = avec.agents ? vueServeursMcp({ surEtat: (ouvert) => boutonMcp.definirOuvert(ouvert) }) : null;
  boutonMcp?.addEventListener("click", () => serveursMcp.ouvrir());
  boutonAgent.addEventListener("click", () => ouvrirConversation());
  boutonAgents.addEventListener("click", entrerDansAgents);
  repliAgent.addEventListener("click", () => {
    replierAgent(true);
    boutonAgents.poserFocus();
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
    ecrire("replis", gardeReplis());
  }
  function replierAgent(oui) {
    if (!avec.agents) return;
    agentReplie = oui;
    // Place pour une seule colonne : déplier l'agent replie le panneau.
    if (!oui && !panneauReplie && etroit()) replierPanneau(true);
    racine.definirReplis({ agent: oui });
    majCommandes();
    recalculer();
    ecrire("replis", gardeReplis());
  }
  // « Agent » et A : une nouvelle conversation dans un onglet de l'éditeur ; la colonne ne bouge pas.
  async function ouvrirConversation(equipe) {
    if (!avec.agents) return;
    const r = await reglagesAgent();
    if (detruite) return;
    if (r.coupure) return dire({ texte: TEXTE_COUPURE, variante: "alerte" });
    editeur.ouvrirAgent({ equipe });
  }
  // « Agents » : déplie la colonne si besoin et relit la liste.
  function entrerDansAgents() {
    if (!avec.agents) return;
    if (agentReplie) replierAgent(false);
    agents.afficher();
  }
  const majCommandes = () => {
    if (!avec.agents) return;
    boutonAgents.definirActif(!agentReplie);
  };
  // Un fichier d'agent s'ouvre dans l'éditeur, recréé vide s'il manque.
  async function surFichier(chemin) {
    const nom = chemin.split("/").pop();
    const geste = editeur.lecture(true);
    let r = await lireFichier(chemin);
    if (detruite) return;
    if (r.cause === "introuvable") {
      const cree = await creerChemin(chemin, "fichier");
      if (detruite) return;
      r = cree.cause || cree.coupure ? cree : await lireFichier(chemin);
      if (detruite) return;
    }
    if (r.contenu !== undefined) {
      editeur.ouvrir({ chemin, contenu: r.contenu, version: r.version, geste });
    } else {
      const texte = r.coupure ? TEXTE_COUPURE : `Impossible d'ouvrir ${nom} : ${String(r.message ?? "erreur").replace(/\.$/, "")}.`;
      dire({ texte, variante: "alerte", fermable: true });
    }
    editeur.lecture(false);
  }
  // « Démarrer une conversation » : un onglet avec ces agents ; la colonne garde sa liste et ses cases.
  function surDemarrer(equipe) {
    ouvrirConversation(equipe);
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
  // Version lancée et mise à jour (REQ-092, REQ-093) : si le focus était sur « Mettre à jour » et qu'il disparaît, il passe sur le message.
  barre.surMaj = () => suiviVersion?.installer();
  const suiviVersion = suivreVersion({
    surChangement: ({ version, maj }) => {
      const surBouton = Boolean(racine && document.activeElement?.closest(".ya-status-maj button"));
      barre.version = version;
      barre.maj = maj;
      majEtat();
      if (surBouton && maj.etat === "installee") racine.querySelector(".ya-status-maj .message-succes")?.focus();
    },
  });

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
  const shells = avec.shells
    ? vueShells({
        dire,
        replieImpose: imposes.shells,
        surZone: (oui, replie) => {
          racine?.definirShellsVisibles(oui);
          racine?.definirReplis({ shells: replie });
          recalculer();
        },
      })
    : { commandes: [], repli: { enveloppe: null }, definirEtat() {}, detruire() {} };
  const editeur = vueEditeur({
    chemin,
    dire,
    ouvrirRapide: () => ouverture.ouvrir(),
    surAttente: (t) => { attenteTexte = t; montrerCoupure(); },
    surGroupes: (arbre, courant) => {
      if (!racine) return;
      racine.definirGroupes(arbre, courant);
      observerQuestions();
    },
    surCourant: (chemin) => fichiers?.definirCourant(chemin),
    surSauvegarde: () => git?.rafraichir(),
    claude: avec.claude,
    agents: avec.agents,
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
    commandes: avec.agents ? undefined : [{ id: "preferences", nom: "Préférences d'interface" }],
    surOuvrir: editeur.ouvrir,
    surLecture: editeur.lecture,
    surCommande: (id, avant) => {
      if (id === "preferences") {
        panneauConfig = ouvrirPreferences({ surFermeture: () => { panneauConfig = null; avant?.focus?.(); } });
        return;
      }
      const ouvrirPanneau = { providers: ouvrirProviders, profils: ouvrirProfils }[id];
      if (!ouvrirPanneau) return;
      panneauConfig = ouvrirPanneau({ surFermeture: () => { panneauConfig = null; editeur.relireReglagesAgents(); avant?.focus?.(); } });
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
  const recherche = avec.recherche ? vueRecherche({ dire, surOuvrir: editeur.ouvrir, surLecture: editeur.lecture }) : null;
  git = avec.git ? vueGit({
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
  }) : { corps: null, estDepot: () => false, rafraichir() {}, relire() {}, montrer() {}, focuserMessage() {}, detruire() {} };
  // Worktree choisi disparu (REQ-086) : le choix est déjà revenu au projet.
  const desabonnerWorktree = abonnerWorktree(({ disparu }) => {
    if (disparu) dire({ texte: `Le worktree ${disparu} a disparu : retour au projet.`, variante: "info", fermable: true });
  });
  const agents = avec.agents ? vueAgents({ surFichier, surDemarrer }) : null;
  const restauration = editeur.restaurer();

  let nombre = 0; // changements git, affichés sur l'icône Git du rail
  const majRail = () => rail.definirCompteur("git", nombre);
  const rail = onglets({
    orientation: "verticale",
    onglets: panneaux.map(({ id, icone, nomAccessible, raccourci }) => ({ id, icone, nomAccessible, raccourci })),
    actif: "fichiers",
    surChoix: afficherPanneau,
  });

  const choisies = {};
  let detruite = false;
  racine = cadre({
    barreTitre: { projet: nomDuDossier(chemin), chemin, surOuvrir: () => ouverture.ouvrir(), actions: [boutonPanneau.enveloppe, shells.repli.enveloppe, theme.enveloppe, sortir.enveloppe].filter(Boolean) },
    rail: { onglets: rail, commandes: shells.commandes },
    panneau: { titre: "Fichiers", repli: repliEntete.enveloppe, entete: fichiers.entete, corps: [fichiers.corps, recherche?.corps, git.corps].filter(Boolean) },
    agent: { titre: "Agents", repli: repliAgent.enveloppe, corps: avec.agents ? [agents.corps] : [] },
    railDroit: { commandes: avec.agents ? [boutonAgent.enveloppe, boutonAgents.enveloppe] : [], pied: boutonMcp ? [boutonMcp.enveloppe] : [] },
    fonctions: avec,
    principal: { bandeaux, groupes: editeur.groupes(), shells },
    barreEtat: barre,
    surChangement: (zone, taille) => {
      choisies[zone] = taille;
      racine.definirTailles({ [zone]: taille });
    },
    surFin: () => ecrire("tailles", { ...choisies }),
  });

  // « Claude » et « opencode » n'existent que si leur commande est dans le PATH du serveur, vérifié à chaque chargement.
  // « opencode » vient toujours après « Claude », quel que soit l'ordre des réponses.
  Promise.all([avec.claude ? claudeDisponible() : false, opencodeDisponible()]).then(([claude, opencode]) => {
    if (detruite) return;
    if (claude) racine.ajouterCommandeDroite(boutonClaude.enveloppe);
    if (opencode) {
      racine.ajouterCommandeDroite(boutonOpencode.enveloppe);
      racine.ajouterCommandeDroite(boutonSessions.enveloppe);
    }
  });

  // Sans shell à l'arrivée : la zone reste hors page le temps de lire la liste.
  racine.definirShellsVisibles(false);

  // Poignées : limites recalculées à chaque changement de la fenêtre, des bandeaux ou de la question d'onglet.
  // La taille choisie ne change que par un glissé ou une flèche ; la taille affichée est la choisie, bornée.
  function recalculer() {
    if (detruite) return;
    const hauteurs = bandeaux.offsetHeight + Math.max(0, ...editeur.questions().map((q) => q.offsetHeight));
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
      if (!racine.poignees[zone]) continue;
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
  // La limite de hauteur des shells prend la plus grande question d'onglet des groupes : on les observe tous.
  function observerQuestions() {
    if (!observateur) return;
    observateur.disconnect();
    observateur.observe(bandeaux);
    for (const q of editeur.questions()) observateur.observe(q);
  }
  observerQuestions();
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
  if (reglages.illisible) {
    dire({ texte: ".yaide/interface.json est illisible. Corrigez-le, puis rechargez la page.", variante: "alerte", fermable: true });
  }
  Promise.all([lire("replis"), restauration]).then(([precedents]) => {
    if (detruite) return;
    agentConserve = precedents?.agent;
    const gardes = { ...precedents, ...imposes };
    if (avec.agents && gardes?.agent === false) {
      replierAgent(false);
      agents.afficher({ focus: false });
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
    const p = panneaux.find((x) => x.id === id);
    titre.textContent = p.titre;
    corps.setAttribute("aria-label", p.titre);
    const visible = id === "fichiers";
    if (visible && fichiers.corps.hidden && !panneauReplie) fichiers.rafraichir();
    fichiers.corps.hidden = fichiers.entete.hidden = !visible;
    recherche?.montrer(id === "recherche");
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
    if (onglet.getAttribute("aria-label") === "Recherche") recherche?.focuser();
  });
  // Focus sur le rail : F, R et G affichent le panneau et y mettent le focus.
  // Les deux boutons de commande du rail comptent aussi : la garde est posée sur toute la colonne.
  racine.querySelector(".cadre-rail").addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !e.target.closest("[role=tab], .cadre-rail-commandes button")) return;
    if (e.key.toLowerCase() === "a") return ouvrirConversation();
    const p = panneaux.find((x) => x.touche === e.key.toLowerCase());
    if (!p) return;
    rail.choisir(p.id);
    afficherPanneau(p.id);
    if (panneauReplie) {
      replierPanneau(false);
      entrerDansPanneau();
    }
    corps.focus();
    if (p.id === "recherche") recherche?.focuser();
  });
  racine.addEventListener("keydown", (e) => {
    if (!avec.agents || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !e.target.closest(".cadre-rail-droit button") || e.key.toLowerCase() !== "a") return;
    // Sans cela, la lettre serait tapée dans le champ qui reçoit le focus.
    e.preventDefault();
    ouvrirConversation();
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
      barre.connexion = nouvel === "coupe" ? "deconnecte" : "connecte";
      majEtat();
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
    suiviVersion.detruire();
    desabonnerWorktree();
    arreter();
    detruite = true;
    sessions.detruire();
    window.removeEventListener("resize", recalculer);
    observateur?.disconnect();
    document.removeEventListener("keydown", surTouche);
    shells.detruire();
    editeur.detruire();
    fichiers.detruire();
    git.detruire();
    recherche?.detruire();
    agents?.detruire();
    ouverture.detruire();
    panneauConfig?.fermer();
  };
  return racine;
}
