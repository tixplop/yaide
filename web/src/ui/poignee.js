const jeton = (nom) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(nom));

const entre = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Limites des poignées en pixels (C-011). `L` et `H` : taille de la fenêtre ; `bandeaux` : hauteur des bandeaux et de la question d'onglet ;
 * `panneau` et `agent` : { replie, choisie } (taille choisie en pixels, token par défaut ; panneau déplié et agent replié par défaut).
 * Rend aussi les largeurs affichées `Pa` et `Aa` (0 si repliée : l'agent cède d'abord) et le `seuil` sous lequel les deux colonnes ne tiennent pas.
 */
export function limites({ L, H, bandeaux = 0, panneau = {}, agent = {} }) {
  const largeur = Math.max(L, jeton("--largeur-min"));
  const hauteur = Math.max(H, jeton("--hauteur-min"));
  const epaisseur = jeton("--epaisseur-poignee");
  const minShells = jeton("--hauteur-shells-min");
  const activite = jeton("--size-activity");
  const editeur = jeton("--largeur-editeur-min");
  const [minP, maxP] = [jeton("--largeur-panneau-min"), jeton("--largeur-panneau-max")];
  const [minA, maxA] = [jeton("--largeur-agent-min"), jeton("--largeur-agent-max")];
  const panneauReplie = Boolean(panneau.replie);
  const agentReplie = agent.replie === undefined ? true : Boolean(agent.replie);
  const P = largeur - 2 * activite - editeur - epaisseur * ((panneauReplie ? 0 : 1) + (agentReplie ? 0 : 1));
  const Pa = panneauReplie ? 0 : entre(panneau.choisie ?? jeton("--largeur-panneau"), minP, Math.min(maxP, agentReplie ? P : P - minA));
  const Aa = agentReplie ? 0 : entre(agent.choisie ?? jeton("--largeur-agent"), minA, Math.min(maxA, P - Pa));
  return {
    Pa,
    Aa,
    seuil: 2 * activite + 2 * epaisseur + minP + minA + editeur,
    panneau: { min: minP, max: Math.min(maxP, P - Aa) },
    agent: { min: minA, max: Math.min(maxA, P - Pa) },
    shells: {
      min: minShells,
      max: Math.max(minShells, hauteur - jeton("--size-titlebar") - jeton("--size-status") - epaisseur - bandeaux - jeton("--hauteur-editeur-min")),
    },
  };
}

export function borner(choisie, { min, max }) {
  return Math.min(max, Math.max(min, choisie));
}

const TOUCHES = {
  vertical: { ArrowRight: 1, ArrowLeft: -1 },
  "vertical-droite": { ArrowLeft: 1, ArrowRight: -1 },
  horizontal: { ArrowUp: 1, ArrowDown: -1 },
};

/**
 * Poignée de redimensionnement. `surChangement(taille)` pendant un glissé ou après une flèche ;
 * `surFin(taille)` à la fin d'un glissé qui a changé la taille ou après une flèche (pour garder la taille).
 * Sans `valeur`, la poignée ignore glissé et flèches jusqu'à `definir({ valeur })` (le cadre y pose la taille mesurée).
 */
export function poignee({ orientation, cote = "gauche", nomAccessible, valeur, min, max, surChangement, surFin } = {}) {
  if (orientation !== "vertical" && orientation !== "horizontal") throw new Error("poignée : orientation vertical ou horizontal requise");
  if (cote !== "gauche" && cote !== "droite") throw new Error("poignée : cote gauche ou droite");
  if (!nomAccessible) throw new Error("poignée : nomAccessible requis");
  const vertical = orientation === "vertical";
  const e = document.createElement("div");
  e.className = `poignee poignee-${orientation}`;
  e.setAttribute("role", "separator");
  e.setAttribute("tabindex", "0");
  e.setAttribute("aria-label", nomAccessible);
  // Une poignée verticale (barre verticale) sépare des zones côte à côte : son orientation ARIA est « vertical ».
  e.setAttribute("aria-orientation", orientation);

  const etat = { valeur, min, max };
  function afficher() {
    for (const [attribut, v] of [["aria-valuenow", etat.valeur], ["aria-valuemin", etat.min], ["aria-valuemax", etat.max]]) {
      if (typeof v === "number" && Number.isFinite(v)) e.setAttribute(attribut, String(Math.round(v)));
      else e.removeAttribute(attribut);
    }
  }
  const connaitre = () => Number.isFinite(etat.valeur);
  e.definir = (v = {}) => {
    Object.assign(etat, v);
    afficher();
  };
  afficher();

  const classePage = `poignee-glisse-${orientation}`;
  let depart = null;
  const coord = (ev) => (vertical ? ev.clientX : ev.clientY);
  const signe = !vertical ? -1 : cote === "droite" ? -1 : 1;

  e.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); // la souris ne déplace jamais le focus
    if (!connaitre()) return;
    e.setPointerCapture(ev.pointerId);
    depart = { pointeur: coord(ev), valeur: etat.valeur, change: false };
    e.classList.add("poignee-active");
    document.documentElement.classList.add(classePage);
  });
  e.addEventListener("pointermove", (ev) => {
    if (!depart) return;
    const v = borner(depart.valeur + signe * (coord(ev) - depart.pointeur), etat);
    if (v === etat.valeur) return;
    depart.change = true;
    surChangement?.(v);
  });
  function fin() {
    if (!depart) return;
    const { change } = depart;
    depart = null;
    e.classList.remove("poignee-active");
    document.documentElement.classList.remove(classePage);
    if (change) surFin?.(etat.valeur);
  }
  e.addEventListener("pointerup", fin);
  e.addEventListener("pointercancel", fin);

  e.addEventListener("keydown", (ev) => {
    const sens = TOUCHES[vertical && cote === "droite" ? "vertical-droite" : orientation][ev.key];
    if (!sens || ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
    ev.preventDefault();
    if (!connaitre()) return;
    const v = borner(etat.valeur + sens * jeton("--pas-poignee"), etat);
    if (v === etat.valeur) return;
    surChangement?.(v);
    surFin?.(v);
  });
  return e;
}
