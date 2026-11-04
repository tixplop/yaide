import { icone } from "./icones.js";
import { infoBulle } from "./info-bulle.js";
import { limites, poignee } from "./poignee.js";

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
 * `barreEtat` : { branche, position, langage } (textes, ou rien) ; `tailles` : { panneau, shells } en pixels ;
 * `surChangement(zone, taille)` et `surFin(zone, taille)` viennent des poignées.
 */
export function cadre({ barreTitre = {}, rail = {}, panneau = {}, principal = {}, barreEtat = {}, tailles = {}, surChangement, surFin } = {}) {
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
  if (rail.commandes?.length) {
    const groupe = zone("div", "cadre-rail-commandes", rail.commandes);
    groupe.setAttribute("role", "group");
    groupe.setAttribute("aria-label", "Shells");
    colonne.append(groupe);
  }

  const aside = zone("aside", "cadre-panneau");
  if (panneau.titre) {
    const h = zone("h2", "cadre-panneau-titre ya-panel-title");
    h.textContent = panneau.titre;
    aside.append(zone("div", "ya-panel-head", h));
  }
  aside.append(zone("div", "cadre-panneau-corps", panneau.corps));
  if (panneau.pied) aside.append(zone("div", "cadre-panneau-pied", panneau.pied));

  const main = zone("main", "cadre-principal");
  const lim = limites({ L: window.innerWidth, H: window.innerHeight });
  const choisies = {};
  const mesures = { panneau: () => aside.offsetWidth, shells: () => racine.querySelector(".cadre-shells").offsetHeight };
  const creer = (cle, orientation, nomAccessible) =>
    poignee({
      orientation,
      nomAccessible,
      min: lim[cle].min,
      max: lim[cle].max,
      surChangement: (t) => surChangement?.(cle, t),
      surFin: (t) => surFin?.(cle, t),
    });
  const poignees = { panneau: creer("panneau", "vertical", "Largeur du panneau"), shells: creer("shells", "horizontal", "Hauteur des shells") };

  main.append(
    zone("div", "cadre-bandeaux", principal.bandeaux),
    zone("div", "cadre-onglets", principal.ongletsFichiers),
    zone("div", "cadre-question", principal.questionOnglet),
    zone("div", "cadre-fil", principal.fil),
    zone("div", "cadre-code", principal.code),
    poignees.shells,
    zone("div", "cadre-shells", principal.shells),
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

  racine.append(haut, colonne, aside, poignees.panneau, main, etat);

  // Pose la taille affichée ; sans taille choisie, les tokens `--largeur-panneau` et `--part-shells` s'appliquent.
  racine.definirTailles = ({ panneau: p, shells: s } = {}) => {
    for (const [cle, valeur, variable] of [["panneau", p, "--taille-panneau"], ["shells", s, "--taille-shells"]]) {
      if (valeur === undefined) continue;
      choisies[cle] = true;
      racine.style.setProperty(variable, px(valeur));
      poignees[cle].definir({ valeur });
    }
  };
  racine.poignees = poignees;
  // À appeler une fois le cadre dans la page : sans taille choisie, pose la taille mesurée sur les poignées.
  racine.mesurer = () => {
    for (const cle of ["panneau", "shells"]) if (!choisies[cle]) poignees[cle].definir({ valeur: mesures[cle]() });
  };
  racine.definirTailles(tailles);
  return racine;
}
