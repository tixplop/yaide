import { bouton } from "./bouton.js";
import { compteur } from "./compteur.js";
import { icone } from "./icones.js";
import { infoBulle } from "./info-bulle.js";

const ORIENTATIONS = ["horizontale", "verticale"];
const PRESENTATIONS = { fichiers: "ya-tabs", shells: "ya-term-tabs", rail: "ya-activity" };
// Mot dit par le nom accessible pour chaque statut git d'un onglet.
const STATUTS = { M: "modifié", A: "ajouté", U: "nouveau" };

export function onglets({ presentation, orientation = "horizontale", onglets: liste, actif, actionsDroite = [], surChoix, surFermer }) {
  if (!ORIENTATIONS.includes(orientation)) throw new Error(`onglets : orientation inconnue « ${orientation} »`);
  // `orientation` est l'ancienne option : verticale = rail.
  presentation ??= orientation === "verticale" ? "rail" : "fichiers";
  if (!(presentation in PRESENTATIONS)) throw new Error(`onglets : presentation inconnue « ${presentation} »`);
  orientation = presentation === "rail" ? "verticale" : "horizontale";
  const rail = presentation === "rail";
  for (const o of liste) {
    if (!o.libelle && !o.icone) throw new Error("onglets : libelle requis");
    if (!o.libelle && !o.nomAccessible) throw new Error("onglets : nomAccessible requis avec une icône");
    if (o.statut !== undefined && !(o.statut in STATUTS)) throw new Error(`onglets : statut inconnu « ${o.statut} »`);
    if (o.compteur !== undefined && (!Number.isInteger(o.compteur) || o.compteur < 0)) throw new Error("onglets : compteur entier positif ou nul requis");
  }
  const vertical = orientation === "verticale";
  const racine = document.createElement("div");
  racine.className = `onglets onglets-${orientation} ${PRESENTATIONS[presentation]}`;
  // Le rôle tablist est porté par la racine : les actions de droite en font partie.
  racine.setAttribute("role", "tablist");
  racine.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");

  const elements = new Map();
  // Le nombre n'entre pas dans le nom accessible : il est masqué aux lecteurs d'écran.
  function definirCompteur(id, valeur) {
    const t = elements.get(id);
    t.querySelector(".ya-badge")?.remove();
    const c = compteur({ valeur, variante: rail ? "accent" : "neutre" });
    c.setAttribute("aria-hidden", "true");
    t.append(c);
  }
  for (const o of liste) {
    const cellule = document.createElement("span");
    cellule.className = "onglet-cellule";
    cellule.setAttribute("role", "presentation");
    const t = document.createElement("button");
    t.type = "button";
    t.className = "onglet";
    t.setAttribute("role", "tab");
    const iconeSeule = o.icone && (rail || !o.libelle);
    if (iconeSeule) t.append(icone(o.icone));
    else {
      if (o.icone) t.append(icone(o.icone));
      const n = document.createElement("span");
      n.className = o.statut ? `onglet-nom onglet-statut-${o.statut}` : "onglet-nom";
      n.textContent = o.libelle;
      t.append(n);
    }
    if (o.detail) {
      const d = document.createElement("span");
      d.className = "onglet-detail";
      d.textContent = ` · ${o.detail}`;
      t.append(d);
    }
    const nom = o.nomAccessible ?? (o.detail ? `${o.libelle} · ${o.detail}` : o.libelle);
    if (o.raccourci) t.setAttribute("aria-keyshortcuts", o.raccourci);
    if (iconeSeule) infoBulle({ texte: o.raccourci ? `${nom} (${o.raccourci})` : nom, ancre: t, position: vertical ? "droite" : "dessous" });
    if (o.titre) t.title = o.titre;
    // Le point est un pseudo-élément (CSS) qui prend la place de la croix : seule cette marque le désigne.
    if (o.modifie) t.dataset.modifie = "true";
    if (o.question) {
      const q = document.createElement("span");
      q.className = "onglet-question";
      q.textContent = " !";
      t.append(q);
    }
    t.setAttribute("aria-label", nom + (o.statut ? `, ${STATUTS[o.statut]}` : "") + (o.modifie ? ", non sauvegardé" : "") + (o.question ? ", question en attente" : ""));
    t.addEventListener("click", () => choisir(o.id, true));
    t.addEventListener("keydown", (e) => touche(e, o));
    cellule.append(t);
    if (o.fermable) {
      const x = bouton({ icone: "x", variante: "discret", taille: "onglet", nomAccessible: `Fermer ${nom}` });
      x.classList.add("onglet-fermer");
      x.tabIndex = -1;
      x.addEventListener("click", () => surFermer?.(o.id, "croix"));
      cellule.append(x.enveloppe);
    }
    elements.set(o.id, t);
    racine.append(cellule);
    if (o.compteur !== undefined) definirCompteur(o.id, o.compteur);
  }
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
      if (o.fermable) surFermer?.(o.id, "touche");
      return;
    } else return;
    e.preventDefault();
    choisir(cible, true);
    elements.get(cible).focus();
  }

  // L'onglet actif n'est rendu visible qu'une fois la racine insérée : appeler choisir(actif) après l'insertion.
  racine.choisir = (id) => choisir(id);
  // Mise à jour : à zéro, le nombre est absent (et non seulement masqué).
  racine.definirCompteur = (id, valeur) => {
    elements.get(id)?.querySelector(".ya-badge")?.remove();
    if (valeur > 0) definirCompteur(id, valeur);
  };
  const premier = liste[0]?.id;
  choisir(elements.has(actif) ? actif : premier);
  return racine;
}
