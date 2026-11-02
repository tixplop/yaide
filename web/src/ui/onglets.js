const ORIENTATIONS = ["horizontale", "verticale"];

export function onglets({ orientation = "horizontale", onglets: liste, actif, actionsFin = [], actionsDroite = [], surChoix, surFermer }) {
  if (!ORIENTATIONS.includes(orientation)) throw new Error(`onglets : orientation inconnue « ${orientation} »`);
  for (const o of liste) if (!o.libelle) throw new Error("onglets : libelle requis");
  const vertical = orientation === "verticale";
  const racine = document.createElement("div");
  racine.className = `onglets onglets-${orientation}`;
  // Le rôle tablist est porté par la racine : les actions de fin en font partie.
  racine.setAttribute("role", "tablist");
  racine.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");

  const elements = new Map();
  for (const o of liste) {
    const cellule = document.createElement("span");
    cellule.className = "onglet-cellule";
    cellule.setAttribute("role", "presentation");
    const t = document.createElement("button");
    t.type = "button";
    t.className = "onglet";
    t.setAttribute("role", "tab");
    t.textContent = o.libelle;
    if (o.titre) t.title = o.titre;
    if (o.modifie) t.append(" ●");
    if (o.question) {
      const q = document.createElement("span");
      q.className = "onglet-question";
      q.textContent = " !";
      t.append(q);
    }
    t.setAttribute("aria-label", (o.nomAccessible ?? o.libelle) + (o.modifie ? ", non sauvegardé" : "") + (o.question ? ", question en attente" : ""));
    t.addEventListener("click", () => choisir(o.id, true));
    t.addEventListener("keydown", (e) => touche(e, o));
    cellule.append(t);
    if (o.fermable) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "onglet-fermer";
      x.tabIndex = -1;
      x.textContent = "×";
      x.setAttribute("aria-label", `Fermer ${o.nomAccessible ?? o.libelle}`);
      x.addEventListener("click", () => surFermer?.(o.id));
      cellule.append(x);
    }
    elements.set(o.id, t);
    racine.append(cellule);
  }
  racine.append(...actionsFin);
  if (actionsDroite.length) {
    const d = document.createElement("div");
    d.className = "onglets-droite";
    d.append(...actionsDroite);
    racine.append(d);
  }

  function choisir(id, notifier = false) {
    for (const [i, t] of elements) {
      const sel = i === id;
      t.setAttribute("aria-selected", String(sel));
      t.tabIndex = sel ? 0 : -1;
    }
    elements.get(id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (notifier) surChoix?.(id);
  }

  function touche(e, o) {
    const ids = liste.map((x) => x.id);
    const i = ids.indexOf(o.id);
    const [prec, suiv] = vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    let cible;
    if (e.key === prec) cible = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === suiv) cible = ids[(i + 1) % ids.length];
    else if (e.key === "Home") cible = ids[0];
    else if (e.key === "End") cible = ids[ids.length - 1];
    else if (e.key === "Delete") {
      if (o.fermable) surFermer?.(o.id);
      return;
    } else return;
    e.preventDefault();
    choisir(cible, true);
    elements.get(cible).focus();
  }

  // L'onglet actif n'est rendu visible qu'une fois la racine insérée : appeler choisir(actif) après l'insertion.
  racine.choisir = (id) => choisir(id);
  const premier = liste[0]?.id;
  choisir(elements.has(actif) ? actif : premier);
  return racine;
}
