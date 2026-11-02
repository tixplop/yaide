const POSITIONS = ["centre", "haut"];
let compteur = 0;

export function dialogue({ titre, contenu = [], actions = [], focusInitial, position = "centre", surAnnuler }) {
  if (!titre) throw new Error("dialogue : titre requis");
  if (!focusInitial) throw new Error("dialogue : focusInitial requis");
  if (!surAnnuler) throw new Error("dialogue : surAnnuler requis");
  if (!POSITIONS.includes(position)) throw new Error(`dialogue : position inconnue « ${position} »`);
  const el = document.createElement("dialog");
  el.className = position === "haut" ? "dialogue dialogue-haut" : "dialogue";
  if (position === "haut") el.setAttribute("aria-label", titre);
  else {
    const h = document.createElement("h2");
    h.className = "dialogue-titre";
    h.id = `dialogue-${++compteur}-titre`;
    h.textContent = titre;
    el.setAttribute("aria-labelledby", h.id);
    el.append(h);
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
    enCours(oui) {
      for (const b of actions) b.disabled = oui;
    },
  };
}
