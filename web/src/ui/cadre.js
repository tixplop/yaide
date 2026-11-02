function zone(balise, classe, contenu) {
  const e = document.createElement(balise);
  e.className = classe;
  if (contenu) e.append(...[].concat(contenu).filter(Boolean));
  return e;
}

export function cadre({ barreHaut, rail, panneau = {}, principal = {} } = {}) {
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
  main.append(
    zone("div", "cadre-bandeaux", principal.bandeaux),
    zone("div", "cadre-onglets", principal.ongletsFichiers),
    zone("div", "cadre-question", principal.questionOnglet),
    zone("div", "cadre-code", principal.code),
    zone("div", "cadre-shells", principal.shells),
  );

  racine.append(haut, nav, aside, main);
  return racine;
}
