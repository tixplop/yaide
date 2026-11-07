import { icone } from "./icones.js";
import { fermerInfoBulleDans, infoBulle } from "./info-bulle.js";
import { limites, poignee } from "./poignee.js";

let compteurAgent = 0;

function zone(balise, classe, contenu) {
  const e = document.createElement(balise);
  e.className = classe;
  if (contenu) e.append(...[].concat(contenu).filter(Boolean));
  return e;
}

const px = (n) => `${Math.round(n)}px`;

/** Symbole yaide en SVG intégré, masqué aux lecteurs d'écran. Couleurs lues dans les tokens. */
export function symbole(taille) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 64 64");
  s.setAttribute("width", String(taille));
  s.setAttribute("height", String(taille));
  s.setAttribute("aria-hidden", "true");
  s.innerHTML =
    '<rect width="64" height="64" rx="14" style="fill: var(--accent)"/>' +
    '<path d="M19 17 32 37M45 17 27 50" style="fill: none; stroke: var(--on-accent)" stroke-width="6.5" stroke-linecap="round"/>' +
    '<circle cx="45" cy="47" r="3.5" style="fill: var(--on-accent)"/>';
  return s;
}

/**
 * C-010. `barreTitre` : { projet, chemin, surOuvrir, actions } ; `rail` : { onglets, commandes } ;
 * `panneau` : { titre, repli (bouton de repli, après le titre), entete (élément fixe sous le titre), corps } ;
 * `barreEtat` : { branche, position, langage } (textes, ou rien) ; `agent` : { titre, repli, corps } (colonne à droite) ; `railDroit` : { commandes } (liste de boutons, dans l'ordre) ;
 * `tailles` : { panneau, agent, shells } en pixels ; `replis` : { panneau, agent, shells } (faux par défaut, vrai pour l'agent) ;
 * `fonctions` : { recherche, git, shells, agents, claude } (vrais par défaut) : `shells` et `agents` faux ne créent ni zone, ni poignée, ni commandes ; `racine.ajouterCommandeDroite(el)` crée le rail droit au besoin.
 * `surChangement(zone, taille)` et `surFin(zone, taille)` viennent des poignées.
 */
export function cadre({ barreTitre = {}, rail = {}, panneau = {}, agent = {}, railDroit = {}, principal = {}, barreEtat = {}, tailles = {}, replis = {}, fonctions, surChangement, surFin } = {}) {
  const avec = { shells: fonctions?.shells !== false, agents: fonctions?.agents !== false };
  // Sans `fonctions`, le rail droit existe toujours ; avec, il n'est créé que s'il porte une commande.
  const avecRailDroit = fonctions === undefined || Boolean(railDroit.commandes?.length);
  const racine = zone("div", "cadre");

  const haut = zone("header", "cadre-barre ya-titlebar");
  const ouvrir = zone("button", "ya-command");
  ouvrir.type = "button";
  ouvrir.setAttribute("aria-label", "Ouverture rapide");
  const nomProjet = zone("span", "ya-command-nom");
  nomProjet.textContent = barreTitre.projet ?? "";
  ouvrir.append(icone("search", 14), nomProjet);
  ouvrir.addEventListener("click", () => barreTitre.surOuvrir?.());
  infoBulle({ texte: `${barreTitre.chemin ? `${barreTitre.chemin} · ` : ""}Ouverture rapide (Ctrl+P)`, ancre: ouvrir });
  const gauche = zone("div", "ya-titlebar-symbole", symbole(18));
  haut.append(gauche, ouvrir, zone("div", "ya-titlebar-actions", barreTitre.actions));

  const nav = zone("nav", "cadre-rail-onglets", rail.onglets);
  nav.setAttribute("aria-label", "Panneaux");
  const colonne = zone("div", "cadre-rail", nav);
  if (avec.shells && rail.commandes?.length) {
    const groupe = zone("div", "cadre-rail-commandes", rail.commandes);
    groupe.setAttribute("role", "group");
    groupe.setAttribute("aria-label", "Shells");
    colonne.append(groupe);
  }

  const aside = zone("aside", "cadre-panneau");
  if (panneau.titre) {
    const h = zone("h2", "cadre-panneau-titre ya-panel-title");
    h.textContent = panneau.titre;
    aside.append(zone("div", "ya-panel-head", [h, panneau.repli]));
  }
  if (panneau.entete) aside.append(panneau.entete);
  aside.append(zone("div", "cadre-panneau-corps", panneau.corps));

  const colonneAgent = avec.agents ? zone("aside", "cadre-agent") : null;
  const titreAgent = zone("h2", "cadre-panneau-titre ya-panel-title");
  if (!avec.agents) {
    // Pas de colonne de l'agent.
  } else if (agent.titre) {
    titreAgent.id = `cadre-agent-titre-${++compteurAgent}`;
    titreAgent.textContent = agent.titre;
    colonneAgent.setAttribute("aria-labelledby", titreAgent.id);
    colonneAgent.append(zone("div", "ya-panel-head", [titreAgent, agent.repli]));
  } else colonneAgent.setAttribute("aria-label", "Agent");
  colonneAgent?.append(zone("div", "cadre-panneau-corps", agent.corps));
  const rd = avecRailDroit ? zone("div", "cadre-rail-droit", railDroit.commandes) : null;

  const main = zone("main", "cadre-principal");
  const lim = limites({ L: window.innerWidth, H: window.innerHeight });
  const choisies = {};
  const mesures = { panneau: () => aside.offsetWidth, agent: () => colonneAgent.offsetWidth, shells: () => zoneShells.offsetHeight };
  let shellsVisibles = true;
  let panneauReplie = false;
  let agentReplie = true;
  let shellsReplies = false;
  const creer = (cle, orientation, nomAccessible, cote) =>
    poignee({
      orientation,
      cote,
      nomAccessible,
      min: lim[cle].min,
      max: lim[cle].max,
      surChangement: (t) => surChangement?.(cle, t),
      surFin: (t) => surFin?.(cle, t),
    });
  const poignees = {
    panneau: creer("panneau", "vertical", "Largeur du panneau", "gauche"),
    agent: avec.agents ? creer("agent", "vertical", "Largeur de l'agent", "droite") : null,
    shells: avec.shells ? creer("shells", "horizontal", "Hauteur des shells") : null,
  };
  if (!avec.agents) delete poignees.agent;
  if (!avec.shells) delete poignees.shells;
  const zoneShells = avec.shells ? zone("div", "cadre-shells", principal.shells) : null;

  poignees.panneau.classList.add("poignee-panneau");
  poignees.agent?.classList.add("poignee-agent");
  main.append(
    zone("div", "cadre-bandeaux", principal.bandeaux),
    zone("div", "cadre-onglets", principal.ongletsFichiers),
    zone("div", "cadre-question", principal.questionOnglet),
    zone("div", "cadre-fil", principal.fil),
    zone("div", "cadre-code", principal.code),
    ...(avec.shells ? [poignees.shells, zoneShells] : []),
  );

  const branche = zone("span", "ya-status-branche");
  const espace = zone("span", "ya-status-espace");
  const position = zone("span", "ya-status-position");
  const langage = zone("span", "ya-status-langage");
  const etat = zone("footer", "cadre-etat ya-status", [branche, espace, position, langage]);
  // Texte sans action : ni bouton, ni arrêt de tabulation. Une partie sans texte est masquée.
  racine.definirEtat = ({ branche: b, position: p, langage: l } = {}) => {
    branche.replaceChildren(...(b ? [icone("branch", 13), document.createTextNode(b)] : []));
    position.textContent = p ?? "";
    langage.textContent = l ?? "";
    branche.hidden = !b;
    position.hidden = !p;
    langage.hidden = !l;
  };
  racine.definirEtat(barreEtat);

  racine.append(haut, colonne, aside, poignees.panneau, main, ...(avec.agents ? [poignees.agent, colonneAgent] : []), ...(rd ? [rd] : []), etat);
  racine.classList.toggle("cadre-sans-rail-droit", !rd);
  // Le rail droit est créé au besoin (« Claude » arrive après la lecture de `claudeDisponible()`).
  racine.ajouterCommandeDroite = (el) => {
    let rail = racine.querySelector(":scope > .cadre-rail-droit");
    if (!rail) {
      rail = zone("div", "cadre-rail-droit");
      etat.before(rail);
      racine.classList.remove("cadre-sans-rail-droit");
    }
    rail.append(el);
  };

  // Pose la taille affichée ; sans taille choisie, les tokens `--largeur-panneau` et `--part-shells` s'appliquent.
  racine.definirTailles = ({ panneau: p, agent: a, shells: s } = {}) => {
    for (const [cle, valeur, variable] of [["panneau", p, "--taille-panneau"], ["agent", a, "--taille-agent"], ["shells", s, "--taille-shells"]]) {
      if (valeur === undefined || !poignees[cle]) continue;
      choisies[cle] = true;
      racine.style.setProperty(variable, px(valeur));
      poignees[cle].definir({ valeur });
    }
  };
  racine.poignees = poignees;
  // « Agent » ou « Agents » selon la vue : l'<aside> suit son <h2> par aria-labelledby.
  racine.definirTitreAgent = (titre) => {
    if (!avec.agents) return;
    if (!agent.titre) throw new Error("cadre : definirTitreAgent demande un agent avec titre");
    titreAgent.textContent = titre;
  };
  // La zone des shells et sa poignée sortent de la page sans shell visible ou une fois repliées ; les terminaux
  // restent montés et la taille choisie ne change pas. Le panneau replié laisse la place à `main` (classe sur la racine).
  const appliquer = () => {
    if (avec.shells) {
      const cache = !shellsVisibles || shellsReplies;
      zoneShells.hidden = cache;
      poignees.shells.hidden = cache;
    }
    aside.hidden = panneauReplie;
    if (panneauReplie) fermerInfoBulleDans(aside);
    poignees.panneau.hidden = panneauReplie;
    racine.classList.toggle("cadre-panneau-replie", panneauReplie);
    if (avec.agents) {
      colonneAgent.hidden = agentReplie;
      if (agentReplie) fermerInfoBulleDans(colonneAgent);
      poignees.agent.hidden = agentReplie;
    }
    racine.classList.toggle("cadre-agent-replie", agentReplie || !avec.agents);
  };
  racine.definirShellsVisibles = (oui) => {
    if (!avec.shells) return;
    shellsVisibles = Boolean(oui);
    appliquer();
  };
  // Seules les clés présentes changent.
  racine.definirReplis = ({ panneau: p, agent: a, shells: s } = {}) => {
    if (p !== undefined) panneauReplie = Boolean(p);
    if (a !== undefined && avec.agents) agentReplie = Boolean(a);
    if (s !== undefined && avec.shells) shellsReplies = Boolean(s);
    appliquer();
  };
  // À appeler une fois le cadre dans la page : sans taille choisie, pose la taille mesurée sur les poignées.
  racine.mesurer = () => {
    for (const cle of ["panneau", "agent", "shells"]) if (poignees[cle] && !choisies[cle] && !poignees[cle].hidden) poignees[cle].definir({ valeur: mesures[cle]() });
  };
  racine.definirTailles(tailles);
  racine.definirReplis(replis);
  return racine;
}
