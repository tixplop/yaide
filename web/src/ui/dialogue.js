const POSITIONS = ["centre", "palette", "reglages"];
let compteur = 0;

export function dialogue({ titre, contenu = [], actions = [], focusInitial, position = "centre", sansChamp = false, aide, surAnnuler }) {
  if (!titre) throw new Error("dialogue : titre requis");
  if (sansChamp && position !== "palette") throw new Error("dialogue : sansChamp demande la position « palette »");
  if (!focusInitial && !sansChamp) throw new Error("dialogue : focusInitial requis");
  if (!surAnnuler) throw new Error("dialogue : surAnnuler requis");
  if (!POSITIONS.includes(position)) throw new Error(`dialogue : position inconnue « ${position} »`);
  const el = document.createElement("dialog");
  el.className = { centre: "dialogue", palette: "dialogue ya-palette", reglages: "dialogue ya-reglages" }[position];
  if (sansChamp) {
    el.classList.add("ya-palette-sans-champ");
    el.tabIndex = -1;
    focusInitial ??= el;
  }
  if (position === "palette") el.setAttribute("aria-label", titre);
  else {
    const h = document.createElement("h2");
    h.className = "dialogue-titre ya-dialog-title";
    h.id = `dialogue-${++compteur}-titre`;
    h.textContent = titre;
    el.setAttribute("aria-labelledby", h.id);
    el.append(h);
  }
  if (aide) {
    el.setAttribute("aria-describedby", aide.id || (aide.id = `dialogue-${compteur}-aide`));
    el.append(aide);
  }
  const corps = document.createElement("div");
  corps.className = "dialogue-contenu";
  corps.append(...contenu);
  el.append(corps);
  if (actions.length) {
    const pied = document.createElement("div");
    pied.className = "dialogue-actions";
    pied.append(...actions);
    el.append(pied);
  }
  el.addEventListener("cancel", (e) => {
    e.preventDefault();
    surAnnuler();
  });
  // Palette sans champ : un clic sur le fond (hors du dialogue) vaut Échap.
  if (sansChamp) {
    el.addEventListener("click", (e) => {
      if (e.target !== el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) surAnnuler();
    });
  }

  let origine = null;
  return {
    element: el,
    ouvrir() {
      origine = document.activeElement;
      document.body.append(el);
      el.showModal();
      focusInitial.focus();
    },
    fermer({ rendreFocus = true } = {}) {
      el.close();
      el.remove();
      if (rendreFocus) origine?.focus?.();
    },
    // Remplace le contenu (la liste arrive) et y porte le focus.
    remplacer(noeuds, focus) {
      corps.replaceChildren(...noeuds);
      if (el.open) (focus ?? el).focus();
    },
    enCours(oui) {
      for (const b of actions) b.disabled = oui;
    },
  };
}

// Groupe de champs d'un C-007 sans liste : <fieldset> et <legend>, aide reliée par aria-describedby.
export function groupe({ legende, champs, aide, enLigne = false }) {
  const f = document.createElement("fieldset");
  f.className = enLigne ? "ya-groupe ya-groupe-ligne" : "ya-groupe";
  const l = document.createElement("legend");
  l.textContent = legende;
  f.append(l, ...champs);
  if (aide) {
    const a = document.createElement("p");
    a.className = "ya-groupe-aide";
    a.id = `groupe-${++compteur}-aide`;
    a.textContent = aide;
    f.setAttribute("aria-describedby", a.id);
    f.append(a);
  }
  return f;
}

// Règle C-007 : un message apparu dans le contenu qui défile est amené dans la vue, sans déplacer le focus.
export function amenerDansLaVue(element) {
  element.scrollIntoView?.({ block: "nearest" });
}
