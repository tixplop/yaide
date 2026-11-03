const jeton = (nom) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(nom));

/** Limites des deux poignées en pixels. `L` et `H` : taille de la fenêtre ; `bandeaux` : hauteur des bandeaux et de la question d'onglet. */
export function limites({ L, H, bandeaux = 0 }) {
  const largeur = Math.max(L, jeton("--largeur-min"));
  const hauteur = Math.max(H, jeton("--hauteur-min"));
  const epaisseur = jeton("--epaisseur-poignee");
  const minShells = jeton("--hauteur-shells-min");
  return {
    panneau: {
      min: jeton("--largeur-panneau-min"),
      max: Math.min(jeton("--largeur-panneau-max"), largeur - jeton("--largeur-rail") - epaisseur - jeton("--largeur-editeur-min")),
    },
    shells: {
      min: minShells,
      max: Math.max(minShells, hauteur - jeton("--hauteur-barre") - epaisseur - bandeaux - jeton("--hauteur-editeur-min")),
    },
  };
}

export function borner(choisie, { min, max }) {
  return Math.min(max, Math.max(min, choisie));
}

const TOUCHES = {
  vertical: { ArrowRight: 1, ArrowLeft: -1 },
  horizontal: { ArrowUp: 1, ArrowDown: -1 },
};

/**
 * Poignée de redimensionnement. `surChangement(taille)` pendant un glissé ou après une flèche ;
 * `surFin(taille)` à la fin d'un glissé qui a changé la taille ou après une flèche (pour garder la taille).
 * Sans `valeur`, la poignée ignore glissé et flèches jusqu'à `definir({ valeur })` (le cadre y pose la taille mesurée).
 */
export function poignee({ orientation, nomAccessible, valeur, min, max, surChangement, surFin } = {}) {
  if (orientation !== "vertical" && orientation !== "horizontal") throw new Error("poignée : orientation vertical ou horizontal requise");
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
  const signe = vertical ? 1 : -1;

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
    const sens = TOUCHES[orientation][ev.key];
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
