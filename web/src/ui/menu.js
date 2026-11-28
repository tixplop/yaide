let ouvert = null;
let avalerClic = null;
let avalerMouseDown = false;
let ecoutes = false;

/**
 * Coin haut gauche du menu : à `position`, retourné de l'autre côté du point s'il déborde du `cadre`, puis borné à `marge` de ses bords.
 * `cadre` : { gauche, haut, largeur, hauteur } (gauche et haut valent 0 s'ils manquent). Cadre plus petit que le menu : coin à `marge` du sien.
 */
export function placer(position, taille, cadre, marge = 0) {
  const gauche = cadre.gauche ?? 0;
  const haut = cadre.haut ?? 0;
  let left = position.x;
  let top = position.y;
  if (left + taille.largeur > gauche + cadre.largeur) left -= taille.largeur;
  if (top + taille.hauteur > haut + cadre.hauteur) top -= taille.hauteur;
  const borne = (v, min, max) => Math.max(min, Math.min(v, max));
  return {
    left: borne(left, gauche + marge, gauche + cadre.largeur - taille.largeur - marge),
    top: borne(top, haut + marge, haut + cadre.hauteur - taille.hauteur - marge),
  };
}

function arreter(e) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

// Clic ailleurs : il ferme le menu et n'agit pas sur ce qui est dessous. Le bouton principal seul est arrêté.
function surPointerDown(e) {
  // Un nouveau clic retire l'intercepteur du précédent : il n'avale jamais un clic plus tardif.
  if (avalerClic) {
    document.removeEventListener("click", avalerClic, true);
    avalerClic = null;
  }
  avalerMouseDown = false;
  if (!ouvert || ouvert.racine.contains(e.target)) return;
  const droit = e.button === 2;
  ouvert.fermer();
  if (droit) return;
  arreter(e);
  avalerMouseDown = true;
  avalerClic = (c) => {
    arreter(c);
    document.removeEventListener("click", avalerClic, true);
    avalerClic = null;
  };
  document.addEventListener("click", avalerClic, true);
}

// xterm.js et CodeMirror prennent le focus au `mousedown` : on l'arrête aussi.
function surMouseDown(e) {
  const dehors = ouvert && !ouvert.racine.contains(e.target) && e.button !== 2;
  if (dehors || avalerMouseDown) arreter(e);
  avalerMouseDown = false;
  if (dehors) ouvert.fermer();
}

function surEchap(e) {
  if (ouvert && e.key === "Escape") {
    arreter(e);
    ouvert.fermer();
  }
}

const surPerteDeFocus = () => ouvert?.fermer();

// `ancre` : bouton d'en-tête qui ouvre le menu ; sans `position`, le menu s'ouvre 4 px sous lui, sur son bord gauche.
// `zone` : élément (surface d'un whiteboard) qui porte le menu ; `position` est alors au pointeur, et le menu reste dans la zone.
// `alignement: "droite"` (avec `ancre`) : le bord droit du menu est sur le bord droit du bouton, REQ-204.
// `ancrage` (avec `ancre`) : menu d'une commande du rail, `rail-gauche` (à droite du bouton) ou `rail-droit` (à gauche), 4 px du bouton, à la hauteur de son haut.
export function menu({ nom, groupes, position, ancre, ancrage, alignement, zone, surFermeture }) {
  if (!nom) throw new Error("menu : nom requis");
  if (typeof surFermeture !== "function") throw new Error("menu : surFermeture requis");
  if (ancre !== undefined && typeof ancre.getBoundingClientRect !== "function") throw new Error("menu : ancre doit être un élément");
  if (ancrage !== undefined && (!ancre || !["rail-gauche", "rail-droit"].includes(ancrage))) throw new Error("menu : ancrage demande une ancre et vaut rail-gauche ou rail-droit");
  if (alignement !== undefined && (!ancre || ancrage || alignement !== "droite")) throw new Error("menu : alignement vaut droite et demande une ancre sans ancrage");
  if (!ancre && (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y))) throw new Error("menu : position requise");
  const pleins = groupes.filter((g) => g.length > 0);
  for (const c of pleins.flat()) {
    if (!c.libelle) throw new Error("menu : libelle requis");
  }
  if (zone !== undefined && typeof zone.getBoundingClientRect !== "function") throw new Error("menu : zone doit être un élément");
  ouvert?.fermer();
  // Menu d'une commande du rail : le focus revient toujours au bouton.
  const origine = ancrage ? ancre : document.activeElement;

  const racine = document.createElement("div");
  racine.className = "menu ya-menu";
  racine.setAttribute("role", "menu");
  racine.setAttribute("aria-label", nom);
  racine.setAttribute("popover", "manual");
  if (ancrage) racine.classList.add("ya-menu-rail");
  // Le menu du navigateur ne s'ouvre jamais par-dessus celui de Yaide.
  racine.addEventListener("contextmenu", (e) => e.preventDefault());
  const commandes = [];
  const donnees = [];
  pleins.forEach((g, i) => {
    if (i > 0) {
      const s = document.createElement("div");
      s.className = "menu-separateur";
      s.setAttribute("role", "separator");
      racine.append(s);
    }
    for (const c of g) {
      const e = document.createElement("div");
      e.className = "menu-commande";
      e.setAttribute("role", "menuitem");
      e.tabIndex = -1;
      if (c.desactive) e.setAttribute("aria-disabled", "true");
      const t = document.createElement("span");
      t.className = "menu-libelle";
      t.textContent = c.libelle;
      e.append(t);
      if (c.detail) {
        // Contrairement à `touche`, `detail` est lu avec le libellé.
        const d = document.createElement("span");
        d.className = "menu-detail";
        d.textContent = c.detail;
        e.setAttribute("aria-label", `${c.libelle}, ${c.detail}`);
        e.append(d);
        racine.classList.add("ya-menu-detail");
      }
      if (c.touche) {
        const k = document.createElement("span");
        k.className = "menu-touche";
        k.setAttribute("aria-hidden", "true");
        k.textContent = c.touche;
        e.append(k);
      }
      // Le survol donne le focus à la commande : une seule a l'aplat à la fois.
      e.addEventListener("mouseenter", () => e.focus());
      // Une commande n'agit qu'au `click` du bouton principal.
      e.addEventListener("click", (ev) => {
        if (ev.button === 0 && !c.desactive) choisir(c);
      });
      commandes.push(e);
      donnees.push(c);
      racine.append(e);
    }
  });

  function choisir(c) {
    fermer();
    c.surChoix?.();
  }

  let ferme = false;
  function fermer() {
    if (ferme) return;
    ferme = true;
    if (ouvert?.racine === racine) {
      ouvert = null;
      document.removeEventListener("keydown", surEchap, true);
      window.removeEventListener("blur", surPerteDeFocus);
      window.removeEventListener("resize", surPerteDeFocus);
    }
    ancre?.setAttribute("aria-expanded", "false");
    zone?.removeEventListener("wheel", fermer);
    racine.hidePopover?.();
    racine.remove();
    if (origine?.isConnected) origine.focus?.();
    surFermeture();
  }

  racine.addEventListener("keydown", (e) => {
    const i = commandes.indexOf(document.activeElement);
    let cible;
    if (e.key === "ArrowDown") cible = commandes[(i + 1) % commandes.length];
    else if (e.key === "ArrowUp") cible = commandes[(i - 1 + commandes.length) % commandes.length];
    else if (e.key === "Home") cible = commandes[0];
    else if (e.key === "End") cible = commandes.at(-1);
    else if (e.key === "Tab") {
      arreter(e);
      fermer();
      return;
    } else if ((e.key === "Enter" || e.key === " ") && i >= 0) {
      arreter(e);
      if (!donnees[i].desactive) choisir(donnees[i]);
      return;
    } else return;
    e.preventDefault();
    cible.focus();
  });

  (zone ?? document.body).append(racine);
  racine.showPopover?.();
  const taille = { largeur: racine.offsetWidth, hauteur: racine.offsetHeight };
  const fenetre = { largeur: window.innerWidth, hauteur: window.innerHeight };
  let depart = position;
  if (ancre) {
    ancre.setAttribute("aria-expanded", "true");
    const r = ancre.getBoundingClientRect();
    if (ancrage) {
      const x = ancrage === "rail-gauche" ? r.right + 4 : r.left - 4 - taille.largeur;
      depart = { x: Math.max(4, Math.min(x, fenetre.largeur - taille.largeur - 4)), y: r.top };
    } else {
    // Décalé vers la gauche s'il ne tient pas ; retourné au-dessus du bouton s'il manque de place dessous et qu'il en reste dessus.
    let y = r.bottom + 4;
    if (y + taille.hauteur > fenetre.hauteur && r.top - 4 - taille.hauteur >= 0) y = r.top - 4 - taille.hauteur;
    depart = { x: alignement === "droite" ? Math.max(0, r.right - taille.largeur) : Math.min(r.left, fenetre.largeur - taille.largeur), y };
    }
  }
  let p;
  if (zone) {
    const r = zone.getBoundingClientRect();
    p = placer(depart, taille, { gauche: r.left, haut: r.top, largeur: r.width, hauteur: r.height }, 4);
    // Un cran de molette ou un pincer ferme le menu ; l'événement continue vers la zone.
    zone.addEventListener("wheel", fermer, { passive: true });
  } else if (ancrage) {
    // Remonté pour rester entier dans la fenêtre.
    p = { left: depart.x, top: Math.max(4, Math.min(depart.y, fenetre.hauteur - taille.hauteur - 4)) };
  } else p = placer(depart, taille, fenetre);
  racine.style.left = `${p.left}px`;
  racine.style.top = `${p.top}px`;
  // Une commande coupée par « … » garde son texte entier en `title`.
  if (ancrage) for (const l of racine.querySelectorAll(".menu-libelle")) if (l.scrollWidth > l.clientWidth) l.title = l.textContent;

  // La commande disparaît ; la suivante prend le focus si elle l'avait, sinon la précédente.
  function retirer(libelle) {
    const i = donnees.findIndex((c) => c.libelle === libelle);
    if (i < 0) return;
    const avaitLeFocus = document.activeElement === commandes[i];
    const e = commandes[i];
    commandes.splice(i, 1);
    donnees.splice(i, 1);
    e.remove();
    // Un séparateur ne reste jamais en tête, en queue ou en double.
    for (const s of [...racine.querySelectorAll(".menu-separateur")]) {
      const a = s.previousElementSibling;
      const b = s.nextElementSibling;
      if (!a || !b || b.classList.contains("menu-separateur")) s.remove();
    }
    if (commandes.length === 0) {
      fermer();
      return;
    }
    if (avaitLeFocus) commandes[Math.min(i, commandes.length - 1)].focus();
  }

  ouvert = { racine, fermer };
  if (!ecoutes) {
    ecoutes = true;
    document.addEventListener("pointerdown", surPointerDown, true);
    document.addEventListener("mousedown", surMouseDown, true);
  }
  document.addEventListener("keydown", surEchap, true);
  window.addEventListener("blur", surPerteDeFocus);
  window.addEventListener("resize", surPerteDeFocus);
  commandes[0]?.focus();
  return { racine, fermer, retirer };
}

const enAttente = new WeakSet();

/**
 * Menu d'une commande du rail (C-001 `menuContextuel`) : `commandes` est une fonction qui rend (ou promet) les groupes,
 * appelée à chaque ouverture ; le menu s'ouvre à leur arrivée. Un second appel pendant l'attente ne fait rien (rend null).
 */
export async function menuDuRail({ nom, commandes, ancre, ancrage, surFermeture = () => {} }) {
  if (typeof commandes !== "function") throw new Error("menu : commandes doit être une fonction");
  if (enAttente.has(ancre)) return null;
  enAttente.add(ancre);
  let groupes;
  try {
    groupes = await commandes();
  } finally {
    enAttente.delete(ancre);
  }
  return menu({ nom, groupes, ancre, ancrage, surFermeture });
}
