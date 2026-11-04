let ouvert = null;
let avalerClic = null;
let avalerMouseDown = false;
let ecoutes = false;

/** Coin haut gauche du menu : à `position`, retourné de l'autre côté du point s'il déborde, puis borné à la fenêtre. */
export function placer(position, taille, fenetre) {
  let left = position.x;
  let top = position.y;
  if (left + taille.largeur > fenetre.largeur) left -= taille.largeur;
  if (top + taille.hauteur > fenetre.hauteur) top -= taille.hauteur;
  return {
    left: Math.max(0, Math.min(left, fenetre.largeur - taille.largeur)),
    top: Math.max(0, Math.min(top, fenetre.hauteur - taille.hauteur)),
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

export function menu({ nom, groupes, position, surFermeture }) {
  if (!nom) throw new Error("menu : nom requis");
  if (typeof surFermeture !== "function") throw new Error("menu : surFermeture requis");
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("menu : position requise");
  const pleins = groupes.filter((g) => g.length > 0);
  for (const c of pleins.flat()) {
    if (!c.libelle) throw new Error("menu : libelle requis");
  }
  ouvert?.fermer();
  const origine = document.activeElement;

  const racine = document.createElement("div");
  racine.className = "menu ya-menu";
  racine.setAttribute("role", "menu");
  racine.setAttribute("aria-label", nom);
  racine.setAttribute("popover", "manual");
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
      const t = document.createElement("span");
      t.className = "menu-libelle";
      t.textContent = c.libelle;
      e.append(t);
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
        if (ev.button === 0) choisir(c);
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
      choisir(donnees[i]);
      return;
    } else return;
    e.preventDefault();
    cible.focus();
  });

  document.body.append(racine);
  racine.showPopover?.();
  const p = placer(position, { largeur: racine.offsetWidth, hauteur: racine.offsetHeight }, { largeur: window.innerWidth, hauteur: window.innerHeight });
  racine.style.left = `${p.left}px`;
  racine.style.top = `${p.top}px`;

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
