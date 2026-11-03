import { limites, poignee } from "./poignee.js";

function zone(balise, classe, contenu) {
  const e = document.createElement(balise);
  e.className = classe;
  if (contenu) e.append(...[].concat(contenu).filter(Boolean));
  return e;
}

const px = (n) => `${Math.round(n)}px`;

/** `tailles` : { panneau, shells } en pixels ; `surChangement(zone, taille)` et `surFin(zone, taille)` viennent des poignées. */
export function cadre({ barreHaut, rail, panneau = {}, principal = {}, tailles = {}, surChangement, surFin } = {}) {
  const racine = zone("div", "cadre");

  const haut = zone("header", "cadre-barre", barreHaut);
  const nav = zone("nav", "cadre-rail", rail);
  nav.setAttribute("aria-label", "Panneaux");

  const aside = zone("aside", "cadre-panneau");
  if (panneau.titre) {
    const h = zone("h2", "cadre-panneau-titre");
    h.textContent = panneau.titre;
    aside.append(h);
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
    zone("div", "cadre-code", principal.code),
    poignees.shells,
    zone("div", "cadre-shells", principal.shells),
  );

  racine.append(haut, nav, aside, poignees.panneau, main);

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
