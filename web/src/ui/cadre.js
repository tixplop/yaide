import { icone } from "./icones.js";
import { bouton } from "./bouton.js";
import { message } from "./message.js";
import { fermerInfoBulleDans, infoBulle } from "./info-bulle.js";
import { appliquer as borneMouvement, bornesAria, limitesPoignee, partDe, partDepuis } from "../disposition.js";
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
 * `barreEtat` : { branche, position, langage, version, maj: { etat, derniere, raison }, surMaj } (textes, ou rien ; `etat` : aucune, disponible, encours, echec, installee ; `surMaj` : clic sur « Mettre à jour ») ; `agent` : { titre, repli, corps } (colonne à droite) ; `railDroit` : { commandes } (liste de boutons, dans l'ordre) ;
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
  // Groupes de l'éditeur (REQ-079) : un arbre dont chaque feuille porte { id, ongletsFichiers, questionOnglet, fil, code }.
  // Sans `groupes`, les quatre clés actuelles forment un groupe unique.
  const unites = new Map(); // id -> élément `.cadre-groupe`
  const groupes = zone("div", "cadre-groupes");
  let structure = null;
  const feuilleUnique = { id: "", ongletsFichiers: principal.ongletsFichiers, questionOnglet: principal.questionOnglet, fil: principal.fil, code: principal.code };
  const signature = (n) => (n.sens === undefined ? n.id : `${n.sens}(${signature(n.a)},${signature(n.b)})`);
  const feuillesDe = (n) => (n.sens === undefined ? [n] : [...feuillesDe(n.a), ...feuillesDe(n.b)]);
  const jetonCss = (nom) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(nom));
  const estDecoupe = (n) => n.sens !== undefined;
  const postOrdre = (n) => (estDecoupe(n) ? [...postOrdre(n.a), ...postOrdre(n.b), n] : []);
  // Copie de l'arbre reçu : `part` s'y met à jour pendant un glissé sans toucher à l'arbre de l'appelant.
  const copie = (n) => (estDecoupe(n) ? { ...n, a: copie(n.a), b: copie(n.b) } : n);
  let decoupes = []; // { n, el, a, b, poignee } dans l'ordre de `postOrdre`
  let ordre = []; // ids des groupes, dans l'ordre du DOM

  // Taille de la découpe (S) et de sa partie mesurée (`a` en ligne, `b` en colonne), lues dans la page.
  function mesure(d) {
    const ligne = d.n.sens === "ligne";
    const taille = (e) => {
      const r = e.getBoundingClientRect();
      return ligne ? r.width : r.height;
    };
    return { S: taille(d.el), valeur: taille(ligne ? d.a : d.b) };
  }
  const limitesDe = (d, S) =>
    limitesPoignee({ noeud: d.n, S, min: { largeur: jetonCss("--largeur-editeur-min"), hauteur: jetonCss("--hauteur-editeur-min") } });
  function majPoignee(d) {
    const { S, valeur } = mesure(d);
    if (!(S - 1 > 0)) return d.poignee.definir({ valeur: undefined, min: undefined, max: undefined });
    d.poignee.definir(bornesAria({ ...limitesDe(d, S), valeur }));
  }
  const majPoignees = () => decoupes.forEach(majPoignee);
  const poserFlex = (d) => {
    const part = partDe(d.n);
    d.a.style.flex = `${1000 * part} 1 0`;
    d.b.style.flex = `${1000 * (1 - part)} 1 0`;
  };
  function deplacer(d, demande) {
    const { S, valeur } = mesure(d);
    if (!(S - 1 > 0)) return;
    const taille = borneMouvement({ demande, valeur, ...limitesDe(d, S) });
    if (taille === valeur) return;
    const part = partDepuis({ taille, S, sens: d.n.sens });
    d.n.part = part;
    poserFlex(d);
    d.n.surPartage?.(part, false);
    window.dispatchEvent(new Event("resize"));
    majPoignees();
  }
  function construire(n) {
    if (estDecoupe(n)) {
      const a = construire(n.a);
      const b = construire(n.b);
      const d = { n, a, b };
      const ligne = n.sens === "ligne";
      const rang = ordre.indexOf(feuillesDe(n.a).at(-1).id) + 1;
      d.poignee = poignee({
        orientation: ligne ? "vertical" : "horizontal",
        nomAccessible: `Entre les groupes ${rang} et ${rang + 1}`,
        surChangement: (t) => deplacer(d, t),
        surFin: () => d.n.surPartage?.(partDe(d.n), true),
        groupe: true,
      });
      d.el = zone("div", "cadre-decoupe", [a, d.poignee, b]);
      d.el.dataset.sens = n.sens;
      poserFlex(d);
      decoupes.push(d);
      return d.el;
    }
    let u = unites.get(n.id);
    if (!u) {
      u = zone("div", "cadre-groupe", [
        zone("div", "cadre-onglets", n.ongletsFichiers),
        zone("div", "cadre-question", n.questionOnglet),
        zone("div", "cadre-fil", n.fil),
        zone("div", "cadre-code", n.code),
      ]);
      unites.set(n.id, u);
    }
    return u;
  }
  // La structure n'est refaite que si elle change : déplacer un groupe dans la page lui ferait perdre le focus.
  racine.definirGroupes = (arbre, courant) => {
    const cle = signature(arbre);
    const interne = copie(arbre);
    if (cle !== structure) {
      structure = cle;
      const ids = new Set(feuillesDe(arbre).map((f) => f.id));
      for (const id of unites.keys()) if (!ids.has(id)) unites.delete(id);
      for (const d of decoupes) d.poignee.annuler();
      decoupes = [];
      ordre = feuillesDe(arbre).map((f) => f.id);
      const racineDom = construire(interne);
      groupes.replaceChildren(racineDom);
      // Un groupe qui redevient seul perd le partage de sa découpe.
      if (!estDecoupe(interne)) racineDom.style.flex = "";
      majPoignees();
    } else {
      postOrdre(interne).forEach((n, i) => {
        decoupes[i].n = n;
        poserFlex(decoupes[i]);
      });
      majPoignees();
    }
    for (const [id, u] of unites) u.dataset.courant = String(id === courant);
  };
  const depart = principal.groupes ?? feuilleUnique;
  racine.definirGroupes(depart, principal.groupeCourant ?? feuillesDe(depart)[0].id);
  main.append(zone("div", "cadre-bandeaux", principal.bandeaux), groupes, ...(avec.shells ? [poignees.shells, zoneShells] : []));

  const branche = zone("span", "ya-status-branche");
  const espace = zone("span", "ya-status-espace");
  const position = zone("span", "ya-status-position");
  const langage = zone("span", "ya-status-langage");
  // Notification de mise à jour : deux zones vivantes présentes dès le chargement, le texte y est posé ; le bouton reste hors d'elles.
  const zoneStatus = zone("span", "ya-status-zone");
  zoneStatus.setAttribute("role", "status");
  const zoneAlert = zone("span", "ya-status-zone");
  zoneAlert.setAttribute("role", "alert");
  const maj = zone("div", "ya-status-maj", [zoneStatus, zoneAlert]);
  const version = zone("span", "ya-status-version");
  const sr = zone("span", "ya-sr");
  sr.textContent = "Yaide ";
  const numero = document.createTextNode("");
  const etat = zone("footer", "cadre-etat ya-status", [branche, espace, position, langage, maj, version]);
  let boutonMaj = null;
  let surMaj = () => {};
  // Texte sans action, sauf « Mettre à jour » : ni bouton, ni arrêt de tabulation ailleurs. Une partie sans texte est masquée.
  racine.definirEtat = ({ branche: b, position: p, langage: l, version: v, maj: m, surMaj: clic } = {}) => {
    branche.replaceChildren(...(b ? [icone("branch", 13), zone("span", "ya-status-nom", [document.createTextNode(b)])] : []));
    branche.title = b ?? "";
    position.textContent = p ?? "";
    langage.textContent = l ?? "";
    branche.hidden = !b;
    position.hidden = !p;
    langage.hidden = !l;
    numero.data = v ?? "";
    version.replaceChildren(...(v ? [sr, numero] : []));
    version.hidden = !v;
    if (clic) surMaj = clic;
    const e = m?.etat ?? "aucune";
    const texte = { disponible: `${m?.derniere} disponible`, encours: `${m?.derniere} disponible`, echec: `La mise à jour a échoué : ${m?.raison}.`, installee: `${m?.derniere} installée. Redémarrez Yaide pour l'utiliser.` }[e];
    const variante = { echec: "erreur", installee: "succes" }[e] ?? "info";
    const cible = variante === "erreur" ? zoneAlert : zoneStatus;
    const autre = cible === zoneAlert ? zoneStatus : zoneAlert;
    autre.replaceChildren();
    // Le texte ne change pas d'un état à l'autre : on ne le repose que s'il diffère, pour ne pas le relire.
    const present = cible.firstElementChild;
    if (!texte) cible.replaceChildren();
    else if (!present || present.textContent !== texte || !present.classList.contains(`message-${variante}`)) cible.replaceChildren(message({ texte, variante, presentation: "barre" }));
    if (e === "disponible" || e === "encours" || e === "echec") {
      if (!boutonMaj) {
        boutonMaj = bouton({ libelle: "Mettre à jour", taille: "barre", libelleEnCours: "Mise à jour…" });
        boutonMaj.addEventListener("click", () => surMaj());
      }
      boutonMaj.definirEnCours(e === "encours");
      if (!boutonMaj.isConnected) maj.append(boutonMaj);
    } else if (boutonMaj?.isConnected) boutonMaj.remove();
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
    majPoignees();
  };
  // La place des groupes change avec la fenêtre, le panneau, les shells ou un bandeau.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(majPoignees).observe(groupes);
  racine.definirTailles(tailles);
  racine.definirReplis(replis);
  return racine;
}
