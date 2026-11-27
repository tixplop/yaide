// Glissé d'un onglet de l'éditeur (REQ-079) : couches de dépôt, guides, aperçu, dépôt. Voir C-010, « Glissé d'un onglet ».
import { cibles as ciblesDe, placeVisee, zoneVisee } from "../disposition.js";
import { icone } from "../ui/icones.js";
import { iconeDe } from "../ui/liste.js";
import { fermerInfoBulleDans } from "../ui/info-bulle.js";

export const TYPE_ONGLET = "application/x-yaide-onglet";

/** Image du glissé (C-006) : l'icône et le nom de l'onglet, ajoutée au corps de la page ; à retirer à la fin du glissé. */
export function imageDeGlisse(onglet) {
  const image = document.createElement("div");
  image.className = "ya-glisse";
  image.setAttribute("aria-hidden", "true");
  const texte = onglet?.querySelector(".onglet-nom")?.textContent ?? onglet?.title ?? "";
  // Un onglet de fichier n'a pas d'icône dans la barre : l'image montre celle de son type, comme l'arborescence.
  const svg = onglet?.querySelector("svg")?.cloneNode(true) ?? icone(iconeDe(texte).icone);
  const i = document.createElement("span");
  i.className = "liste-icone";
  i.append(svg);
  image.append(i);
  const nom = document.createElement("span");
  nom.className = "liste-libelle";
  nom.textContent = texte;
  image.append(nom);
  document.body.append(image);
  return image;
}

/**
 * Presser un onglet lui donne le focus : `suivreFocusPression(dans)` note celui d'avant (`dans(cible)` : la pression vient d'une barre à suivre),
 * `rendre()` le lui redonne au début du glissé, `arreter()` retire l'écouteur.
 */
export function suivreFocusPression(dans = () => true) {
  let avant = null;
  const noter = (ev) => {
    avant = dans(ev.target) && ev.target.closest?.(".onglet-cellule") ? document.activeElement : null;
  };
  document.addEventListener("pointerdown", noter, true);
  return {
    rendre() {
      const a = avant;
      avant = null;
      if (a === null) return;
      if (a === document.body || !a.isConnected) document.activeElement?.blur?.();
      else if (a !== document.activeElement) a.focus();
    },
    arreter: () => document.removeEventListener("pointerdown", noter, true),
  };
}

/**
 * `groupes()` : `[{ id, barre, ids }]`, les groupes dans l'ordre de la page (`ids` : ses onglets, dans l'ordre de la barre).
 * `deplacer(id, groupe, zone, place)` : le dépôt (`zone` vaut `barre` sur une barre d'onglets, `place` est alors la place visée). `apresFin()` : le glissé est fini (une relecture reportée peut se faire).
 * Rend `{ debuter(id, ev, groupeSource), enCours(), detruire() }`.
 */
export function depotOnglets({ groupes, deplacer, apresFin }) {
  let glisse = null; // { id, source, image, trame, couches: Map(couche -> { groupe, cibles, corps, barre, rang }), zone, groupeVise, place, apercu, marque, survol }
  const focusPression = suivreFocusPression();

  function debuter(id, ev, source) {
    const dt = ev.dataTransfer;
    if (!dt) return;
    finir();
    dt.effectAllowed = "move";
    dt.setData(TYPE_ONGLET, "1");
    const image = imageDeGlisse(ev.currentTarget ?? ev.target);
    dt.setDragImage?.(image, 12, 12);
    fermerInfoBulleDans(document.body);
    focusPression.rendre();
    glisse = { id, source, image, trame: requestAnimationFrame(creerCouches), couches: new Map(), zone: null, groupeVise: null, place: null, apercu: null, marque: null, survol: null };
    document.addEventListener("dragenter", survol, true);
    document.addEventListener("dragover", survol, true);
    document.addEventListener("drop", deposer, true);
    document.addEventListener("dragend", finir, true);
  }

  // Au tour suivant : Chrome annule le glissé si le DOM change pendant `dragstart`.
  function creerCouches() {
    if (!glisse) return;
    glisse.trame = null;
    document.documentElement.classList.add("onglet-glisse");
    const style = getComputedStyle(document.documentElement);
    const min = { largeur: parseFloat(style.getPropertyValue("--largeur-editeur-min")), hauteur: parseFloat(style.getPropertyValue("--hauteur-editeur-min")) };
    for (const g of groupes()) {
      const hote = g.barre.closest(".cadre-groupe");
      if (!hote) continue;
      const rect = hote.getBoundingClientRect();
      const liste = ciblesDe({ largeur: rect.width, hauteur: rect.height, min, source: g.id === glisse.source, seulOnglet: g.ids.length === 1 });
      const couche = document.createElement("div");
      couche.className = "ya-depot";
      couche.setAttribute("aria-hidden", "true");
      const corps = document.createElement("div");
      corps.className = "ya-depot-corps";
      for (const [variable, cote] of [["--g", "gauche"], ["--d", "droite"], ["--h", "haut"], ["--b", "bas"]]) {
        corps.style.setProperty(variable, liste.includes(cote) ? "25%" : "0%");
      }
      for (const c of liste) {
        const guide = document.createElement("div");
        guide.dataset.zoneDepot = c;
        const pastille = document.createElement("span");
        pastille.className = "ya-depot-pastille";
        pastille.append(icone(`zone-${c}`));
        guide.append(pastille);
        corps.append(guide);
      }
      couche.append(corps);
      hote.append(couche);
      glisse.couches.set(couche, { groupe: g.id, cibles: liste, corps, barre: g.barre, rang: g.id === glisse.source ? g.ids.indexOf(glisse.id) : null });
    }
  }

  // { groupe, zone } visé par l'événement, ou null : refus.
  function viser(ev) {
    const couche = ev.target.closest?.(".ya-depot");
    const info = couche && glisse.couches.get(couche);
    if (!info) return null;
    const r = info.corps.getBoundingClientRect();
    if (ev.clientY < r.top) {
      const cellules = [...info.barre.querySelectorAll(".onglet-cellule")].map((c) => {
        const b = c.getBoundingClientRect();
        return { gauche: b.left, droite: b.right };
      });
      const place = placeVisee({ x: ev.clientX, cellules, rang: info.rang });
      return place === null ? null : { groupe: info.groupe, zone: "barre", place, couche, barre: info.barre };
    }
    const zone = zoneVisee({
      px: (ev.clientX - r.left) / r.width,
      py: (ev.clientY - r.top) / r.height,
      cibles: info.cibles,
    });
    return zone === null ? null : { groupe: info.groupe, zone, couche };
  }

  function retirerApercu() {
    glisse.apercu?.remove();
    glisse.apercu = null;
    glisse.marque?.definirInsertion(null);
    glisse.marque = null;
    delete glisse.survol?.dataset.survol;
    glisse.survol = null;
    glisse.zone = null;
    glisse.groupeVise = null;
    glisse.place = null;
  }

  function survol(ev) {
    ev.stopPropagation();
    const v = viser(ev);
    if (!v) return retirerApercu();
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    if (glisse.zone === v.zone && glisse.groupeVise === v.groupe && glisse.place === (v.place ?? null)) return;
    retirerApercu();
    if (v.zone === "barre") {
      // Barre survolée : ni guide ni aperçu dans ce groupe, la marque d'insertion montre la place.
      v.couche.dataset.survol = "barre";
      glisse.survol = v.couche;
      glisse.marque = v.barre.firstElementChild;
      glisse.marque.definirInsertion(v.place);
      glisse.zone = "barre";
      glisse.groupeVise = v.groupe;
      glisse.place = v.place;
      return;
    }
    const apercu = document.createElement("div");
    apercu.dataset.depot = v.zone;
    v.couche.prepend(apercu);
    glisse.apercu = apercu;
    glisse.zone = v.zone;
    glisse.groupeVise = v.groupe;
  }

  function deposer(ev) {
    ev.stopPropagation();
    const v = viser(ev);
    if (!v) return;
    ev.preventDefault();
    const id = glisse.id;
    finir();
    deplacer(id, v.groupe, v.zone, v.place);
  }

  function finir() {
    if (!glisse) return;
    const g = glisse;
    glisse = null;
    document.removeEventListener("dragenter", survol, true);
    document.removeEventListener("dragover", survol, true);
    document.removeEventListener("drop", deposer, true);
    document.removeEventListener("dragend", finir, true);
    if (g.trame !== null) cancelAnimationFrame(g.trame);
    document.documentElement.classList.remove("onglet-glisse");
    g.marque?.definirInsertion(null);
    for (const couche of g.couches.keys()) couche.remove();
    g.image.remove();
    apresFin?.();
  }

  return {
    debuter,
    enCours: () => glisse !== null,
    detruire() {
      finir();
      focusPression.arreter();
    },
  };
}
