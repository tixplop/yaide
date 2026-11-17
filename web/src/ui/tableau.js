import { idLibre } from "../jdiag.js";
import { estMac } from "../references.js";
import { indication } from "./indication.js";
import { auPlan } from "./tableau-edition.js";
import { boiteOutils } from "./tableau-outils.js";
import { connecteurProche, connecteurs, dansRectangle, pointSurBord, cranVoisin, extremitesFleche, rectangleFleche, toutAfficher as calculerToutAfficher, voirObjet, zoomerAutour } from "./tableau-calculs.js";
import { dessinBoite, dessinConnecteurs, dessinFleche, dessinFormeProvisoire, dessinLien, dessinProvisoire, dessinRectangleSelection, poigneesBoite, poigneesFleche, svg } from "./tableau-dessin.js";

// C-018 : whiteboard. Un SVG dont le `viewBox` suit la vue ; le document est celui de `jdiag.js`.
const aide = () => {
  const ctrl = estMac() ? "Cmd" : "Ctrl";
  return `Tab : objet suivant. Entrée : écrire dans la boîte. Flèches : déplacer. Suppr : effacer. ${ctrl}+A : tout choisir. ${ctrl}+C, ${ctrl}+V : copier, coller. Échap : ne plus rien choisir. O : boîte à outils.`;
};
const PAS = 10;
const SEUIL = 3;
const PROCHE = 24; // px écran : distance du pointeur au bord d'une boîte pour montrer ses connecteurs
const OUTILS_DEPART = { outil: "choisir", forme: "rectangle", couleur: "default", trace: "direct", bouts: "end", trait: "solid", opacite: 100, taille: "normal", epaisseur: "thin" };
const TAILLES = { rectangle: [160, 80], rounded: [160, 80], ellipse: [100, 100], diamond: [160, 100], note: [160, 80], text: [160, 40] };
// Clé du document de chaque choix de la boîte à outils, et sortes d'objets qu'il concerne :
// « boite », « texte » (la forme « Texte ») et « trait » (liens et flèches libres).
const CLES_STYLE = { couleur: "color", opacite: "opacity", taille: "textSize", trace: "route", bouts: "ends", trait: "line", epaisseur: "weight" };
const CONCERNES = {
  couleur: ["boite", "texte", "trait"],
  opacite: ["boite"],
  taille: ["boite", "texte"],
  trace: ["trait"],
  bouts: ["trait"],
  trait: ["boite", "trait"],
  epaisseur: ["boite", "trait"],
};
let compteur = 0;

// Le rectangle des deux points, dans tous les sens, jamais sous 40 x 24 px, aux positions entières.
function rectangleTrace(a, b) {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.max(40, Math.round(Math.abs(b.x - a.x))),
    height: Math.max(24, Math.round(Math.abs(b.y - a.y))),
  };
}

function nomBoite(boite) {
  const texte = boite.text.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
  return texte || "Boîte vide";
}

export function tableau({ nom, document: documentInitial, vue, outils, surChangement, surVue }) {
  if (!nom) throw new Error("tableau : nom requis");
  if (typeof surChangement !== "function") throw new Error("tableau : surChangement requis");
  const prefixe = `tableau${++compteur}`;
  let doc = documentInitial ?? null;
  let nomCourant = nom;
  let vueCourante = { x: 0, y: 0, zoom: 1, ...vue };
  let choisis = []; // les `id` choisis, dans l'ordre de Tab
  let etat = null; // zone `status`
  let saisie = null;
  let editeur = null;
  let surface = null;
  let dessin = null;
  let geste = null; // glisser en cours : { type, id, pointerId, x0, y0, origine, actif, ... }
  let provisoire = null; // flèche en cours de tracé : { de, x, y }
  let cible = null;
  let formeProvisoire = null; // forme en cours de tracé : { x, y, width, height, shape }
  let sansClic = false; // le `click` qui suit la création d'un objet ne doit rien défaire
  let pointeur = null; // dernier point survolé, en coordonnées du dessin
  let couche = null;
  const choix = { ...OUTILS_DEPART, ...outils };
  let barre = null;

  const element = document.createElement("div");
  element.className = "ya-tableau-zone";
  const fond = document.createElement("div");
  fond.className = "ya-tableau";
  element.append(fond);

  const taille = () => {
    const r = element.getBoundingClientRect();
    return { largeur: r.width, hauteur: r.height };
  };
  const idElement = (id) => `${prefixe}-${id}`;
  const premier = () => choisis[0] ?? null;
  const unique = () => (choisis.length === 1 ? choisis[0] : null);
  const tousLesId = () => [...doc.boxes, ...doc.links, ...(doc.arrows ?? [])].map((o) => o.id);
  const objet = (id) => [...doc.boxes, ...doc.links, ...(doc.arrows ?? [])].find((x) => x.id === id);
  const boite = (id) => doc.boxes.find((b) => b.id === id);
  const appliquer = (nouveau) => {
    doc = nouveau;
    surChangement(nouveau);
  };
  const changerVue = (nouvelle) => {
    vueCourante = nouvelle;
    surVue?.({ ...vueCourante });
  };

  function monter() {
    fond.replaceChildren();
    barre?.element.remove();
    surface = null;
    dessin = null;
    etat = null;
    editeur = null;
    saisie = null;
    if (doc === null) {
      element.setAttribute("role", "region");
      element.setAttribute("aria-label", nomCourant);
      element.tabIndex = -1;
      const p = document.createElement("p");
      p.className = "ya-tableau-corriger";
      p.textContent = "Pour le corriger, renommez-le en .json : il s'ouvrira en texte.";
      const zone = document.createElement("div");
      zone.className = "ya-tableau-illisible";
      zone.append(indication({ texte: `${nomCourant} n'est pas un whiteboard lisible.`, variante: "vide" }), p);
      fond.append(zone);
      return;
    }
    element.removeAttribute("role");
    element.removeAttribute("aria-label");
    element.removeAttribute("tabindex");
    surface = document.createElement("div");
    surface.className = "ya-tableau-surface";
    surface.tabIndex = 0;
    surface.setAttribute("role", "application");
    surface.setAttribute("aria-roledescription", "whiteboard");
    surface.setAttribute("aria-label", nomCourant);
    surface.setAttribute("aria-describedby", idElement("aide"));
    const texteAide = document.createElement("span");
    texteAide.className = "masque";
    texteAide.id = idElement("aide");
    texteAide.textContent = aide();
    dessin = svg("svg", { focusable: "false" });
    surface.append(dessin, texteAide);
    etat = document.createElement("div");
    etat.className = "masque";
    etat.setAttribute("role", "status");
    fond.append(surface, etat);
    element.append(barre.element);
    surface.addEventListener("keydown", surTouche);
    surface.addEventListener("pointerdown", surAppui);
    surface.addEventListener("pointermove", surMouvement);
    surface.addEventListener("pointerup", surRelache);
    surface.addEventListener("pointercancel", annulerGeste);
    surface.addEventListener("pointerleave", () => {
      pointeur = null;
      dessinerConnecteurs();
    });
    surface.addEventListener("dblclick", surDoubleClic);
    surface.addEventListener("wheel", surMolette, { passive: false });
    dessin.addEventListener("click", surClic);
    dessiner();
  }

  function groupeBoite(b) {
    const glissee = geste?.actif && geste.type === "boite" && geste.id === b.id;
    const classe = `${choisis.includes(b.id) ? " choisie" : ""}${saisie === b.id ? " saisie" : ""}${glissee ? " glissee" : ""}${cible === b.id ? " cible" : ""}`;
    let texte;
    if (saisie === b.id) texte = editeur;
    else {
      texte = document.createElement("div");
      texte.className = "ya-tableau-texte";
      texte.textContent = b.text;
    }
    return dessinBoite(b, { id: idElement(b.id), nom: nomBoite(b), classe, texte });
  }

  function groupeLien(l, z) {
    const nom = `De ${nomBoite(boite(l.from))} vers ${nomBoite(boite(l.to))}`;
    return dessinLien(doc, l, z, { id: idElement(l.id), nom, classe: choisis.includes(l.id) ? " choisie" : "" });
  }

  function flecheProvisoire(z) {
    const arrivee = { x: provisoire.x, y: provisoire.y };
    if (provisoire.libre) return dessinProvisoire(provisoire.depart, arrivee, z, { route: choix.trace, ends: choix.bouts, line: choix.trait });
    const source = boite(provisoire.de);
    const depart = provisoire.cote ? connecteurs(source)[provisoire.cote] : pointSurBord(source, arrivee);
    return dessinProvisoire(depart, arrivee, z);
  }

  // Les boîtes dont on montre les connecteurs, et ceux qui sont pleins (sous le pointeur, de départ ou le plus proche d'une cible).
  function etatConnecteurs() {
    const rien = { boites: [], pleins: [] };
    if (saisie !== null || (geste && geste.type !== "liaison")) return rien;
    if (geste) {
      const pleins = [{ id: geste.id, cote: geste.cote }];
      const boites = [boite(geste.id)];
      if (cible && pointeur) {
        boites.push(boite(cible));
        pleins.push({ id: cible, cote: connecteurProche(boite(cible), pointeur) });
      }
      return { boites, pleins };
    }
    if (!pointeur) return rien;
    const z = vueCourante.zoom;
    const boites = doc.boxes.filter((b) => {
      if (choisis.length > 1 && choisis.includes(b.id)) return false;
      const dx = Math.max(b.x - pointeur.x, 0, pointeur.x - (b.x + b.width));
      const dy = Math.max(b.y - pointeur.y, 0, pointeur.y - (b.y + b.height));
      return Math.hypot(dx, dy) <= PROCHE / z;
    });
    const choisie = unique() ? boite(unique()) : null;
    const surTaille = choisie && Math.max(Math.abs(pointeur.x - (choisie.x + choisie.width)), Math.abs(pointeur.y - (choisie.y + choisie.height))) <= 8 / z;
    const pleins = [];
    if (!surTaille) {
      for (const b of boites) {
        for (const [cote, p] of Object.entries(connecteurs(b))) {
          if (Math.max(Math.abs(pointeur.x - p.x), Math.abs(pointeur.y - p.y)) <= 8 / z) pleins.push({ id: b.id, cote });
        }
      }
    }
    return { boites, pleins: pleins.slice(0, 1) };
  }

  // Redessine la seule couche des connecteurs quand elle change (le pointeur bouge souvent).
  function dessinerConnecteurs() {
    if (!dessin) return;
    const { boites, pleins } = etatConnecteurs();
    const signature = JSON.stringify([boites.map((b) => b.id), pleins, vueCourante.zoom]);
    if (couche && couche.signature === signature) return;
    const nouvelle = dessinConnecteurs(boites, pleins, vueCourante.zoom);
    nouvelle.signature = signature;
    if (couche?.parentNode) couche.replaceWith(nouvelle);
    couche = nouvelle;
  }

  function dessiner() {
    if (!dessin) return;
    const z = vueCourante.zoom;
    const t = taille();
    dessin.setAttribute("viewBox", `${vueCourante.x} ${vueCourante.y} ${t.largeur / z} ${t.hauteur / z}`);
    const avaitFocus = editeur !== null && document.activeElement === editeur;
    const sel = globalThis.getSelection?.();
    const decalage = avaitFocus && sel?.rangeCount && editeur.contains(sel.anchorNode) ? sel.anchorOffset : null;
    dessin.replaceChildren();
    for (const b of doc.boxes) dessin.append(groupeBoite(b));
    for (const l of doc.links) dessin.append(groupeLien(l, z));
    for (const f of doc.arrows ?? []) dessin.append(dessinFleche(f, z, { id: idElement(f.id), classe: choisis.includes(f.id) ? " choisie" : "" }));
    const b = unique() && !saisie ? boite(unique()) : null;
    const libre = unique() && !saisie ? (doc.arrows ?? []).find((f) => f.id === unique()) : null;
    couche = svg("g");
    dessin.append(couche);
    dessinerConnecteurs();
    if (b) dessin.append(poigneesBoite(b, z));
    if (libre) dessin.append(poigneesFleche(libre, z));
    if (provisoire) dessin.append(flecheProvisoire(z));
    if (formeProvisoire) dessin.append(dessinFormeProvisoire(formeProvisoire));
    if (geste?.type === "selection" && geste.actif) dessin.append(dessinRectangleSelection(geste.rect));
    if (premier()) surface.setAttribute("aria-activedescendant", idElement(premier()));
    else surface.removeAttribute("aria-activedescendant");
    etat.textContent = choisis.length > 1 ? `${choisis.length} objets choisis` : "";
    afficherOutils();
    if (avaitFocus) placerCurseur(decalage);
  }

  const sorte = (o) => (boite(o.id) ? (o.shape === "text" ? "texte" : "boite") : "trait");
  const cibles = () => (saisie !== null ? [saisie] : choisis).map(objet).filter(Boolean);
  // Les choix de style d'une sorte d'objet qui diffèrent de leur valeur par défaut.
  function styleChoisi(s) {
    const r = {};
    for (const [cle, clef] of Object.entries(CLES_STYLE)) if (CONCERNES[cle].includes(s) && choix[cle] !== OUTILS_DEPART[cle]) r[clef] = choix[cle];
    return r;
  }

  // Les valeurs du premier objet choisi (ou de la boîte en saisie) que chaque groupe concerne, sinon les choix courants.
  function afficherOutils() {
    const valeurs = { ...choix };
    for (const [cle, clef] of Object.entries(CLES_STYLE)) {
      const o = cibles()[0];
      if (o && CONCERNES[cle].includes(sorte(o))) valeurs[cle] = o[clef] ?? OUTILS_DEPART[cle];
    }
    barre.definir(valeurs, { planActif: saisie !== null || choisis.length > 0 });
    surface?.classList.toggle("crosshair", choix.outil !== "choisir");
  }

  function surChoixOutil(cle, valeur) {
    choix[cle] = valeur;
    if (cle === "outil") {
      if (TAILLES[valeur]) choix.forme = valeur;
      finirSaisie();
    } else {
      const clef = CLES_STYLE[cle];
      const ids = cibles().filter((o) => CONCERNES[cle].includes(sorte(o)) && (o[clef] ?? OUTILS_DEPART[cle]) !== valeur).map((o) => o.id);
      if (ids.length > 0) {
        const change = (x) => (ids.includes(x.id) ? { ...x, [clef]: valeur } : x);
        appliquer({ ...doc, boxes: doc.boxes.map(change), links: doc.links.map(change), ...(doc.arrows ? { arrows: doc.arrows.map(change) } : {}) });
      }
    }
    dessiner();
  }

  function surPlan(sens) {
    const ids = saisie !== null ? [saisie] : choisis;
    if (ids.length === 0) return;
    const nouveau = auPlan(doc, ids, sens);
    if (nouveau !== doc) appliquer(nouveau);
    dessiner();
  }

  // `rect` : le rectangle tracé à la souris ; sinon la taille par défaut de la forme, centrée sur (centreX, centreY).
  function nouvelleBoite(centreX, centreY, rect = null) {
    const [width, height] = rect ? [rect.width, rect.height] : TAILLES[choix.forme];
    const id = idLibre("b", doc);
    const b = rect
      ? { id, x: rect.x, y: rect.y, width, height, text: "" }
      : { id, x: Math.round(centreX - width / 2), y: Math.round(centreY - height / 2), width, height, text: "" };
    if (choix.forme !== "rectangle") b.shape = choix.forme;
    Object.assign(b, styleChoisi(choix.forme === "text" ? "texte" : "boite"));
    appliquer({ ...doc, boxes: [...doc.boxes, b] });
    choix.outil = "choisir";
    commencerSaisie(id);
  }

  function placerCurseur(decalage) {
    editeur.focus();
    const sel = globalThis.getSelection?.();
    if (!sel) return;
    const r = document.createRange();
    const noeud = editeur.firstChild;
    if (noeud) r.setStart(noeud, Math.min(decalage ?? noeud.length, noeud.length));
    else r.setStart(editeur, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function limites(id) {
    const b = boite(id);
    if (b) return b;
    const f = (doc.arrows ?? []).find((a) => a.id === id);
    if (f) return rectangleFleche(f);
    const l = doc.links.find((m) => m.id === id);
    const { depart, arrivee } = extremitesFleche(boite(l.from), boite(l.to));
    const x = Math.min(depart.x, arrivee.x);
    const y = Math.min(depart.y, arrivee.y);
    return { x, y, width: Math.abs(arrivee.x - depart.x), height: Math.abs(arrivee.y - depart.y) };
  }

  function ramener(id) {
    const t = taille();
    if (!t.largeur || !t.hauteur) return;
    const nv = voirObjet(vueCourante, t, limites(id));
    if (nv.x !== vueCourante.x || nv.y !== vueCourante.y) changerVue(nv);
  }

  function choisir(id, avecRecadrage = false) {
    // Même objet déjà choisi : ne pas redessiner, le second clic d'un double-clic doit garder son élément.
    if (!avecRecadrage && choisis.length === (id === null ? 0 : 1) && premier() === id) return;
    choisis = id === null ? [] : [id];
    if (id && avecRecadrage) ramener(id);
    dessiner();
  }

  function finirSaisie() {
    if (saisie === null) return;
    saisie = null;
    editeur = null;
    dessiner();
  }

  function commencerSaisie(id) {
    finirSaisie();
    saisie = id;
    choisis = [id];
    editeur = document.createElement("div");
    editeur.className = "ya-tableau-texte";
    editeur.setAttribute("contenteditable", "plaintext-only");
    editeur.setAttribute("role", "textbox");
    editeur.setAttribute("aria-multiline", "true");
    editeur.setAttribute("aria-label", "Texte de la boîte");
    editeur.tabIndex = -1;
    editeur.textContent = boite(id).text;
    const mon = editeur;
    editeur.addEventListener("input", () => {
      const b = boite(id);
      if (!b || mon !== editeur || mon.textContent === b.text) return;
      const texte = mon.textContent;
      appliquer({ ...doc, boxes: doc.boxes.map((x) => (x.id === id ? { ...x, text: texte } : x)) });
      dessin.querySelector(`[data-id="${id}"]`)?.setAttribute("aria-label", nomBoite({ text: texte }));
    });
    dessiner();
    placerCurseur(null);
  }

  function supprimer(ids) {
    const boites = ids.filter((id) => boite(id) !== undefined);
    appliquer({
      ...doc,
      boxes: doc.boxes.filter((b) => !ids.includes(b.id)),
      links: doc.links.filter((l) => !ids.includes(l.id) && !boites.includes(l.from) && !boites.includes(l.to)),
      ...(doc.arrows ? { arrows: doc.arrows.filter((f) => !ids.includes(f.id)) } : {}),
    });
    choisis = [];
    dessiner();
  }

  // Déplace les boîtes et les flèches libres de `ids` ; les liens suivent leurs boîtes.
  function deplacer(ids, dx, dy) {
    appliquer({
      ...doc,
      boxes: doc.boxes.map((b) => (ids.includes(b.id) ? { ...b, x: b.x + dx, y: b.y + dy } : b)),
      ...(doc.arrows ? { arrows: doc.arrows.map((f) => (ids.includes(f.id) ? { ...f, x1: f.x1 + dx, y1: f.y1 + dy, x2: f.x2 + dx, y2: f.y2 + dy } : f)) } : {}),
    });
    ramener(premier());
    dessiner();
  }

  function naviguer(e) {
    const objets = tousLesId();
    const i = premier() === null ? -1 : objets.indexOf(premier());
    if (!e.shiftKey) {
      if (i === objets.length - 1) return;
      choisir(objets[i + 1], true);
    } else {
      if (i === -1) return;
      choisir(i === 0 ? null : objets[i - 1], true);
    }
    e.preventDefault();
  }

  function surTouche(e) {
    if (doc === null) return;
    if (geste?.type === "selection" && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      annulerGeste();
      choix.outil = "choisir";
      dessiner();
      return;
    }
    if (saisie === null && !e.altKey && !e.shiftKey && (estMac() ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      choisis = tousLesId();
      dessiner();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (saisie !== null) {
      if (e.target !== editeur) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finirSaisie();
        surface.focus();
      } else if (e.key === "Tab") {
        finirSaisie();
        surface.focus();
        naviguer(e);
      }
      return;
    }
    const estBoite = unique() !== null && boite(unique()) !== undefined;
    const deplacable = choisis.some((id) => boite(id) !== undefined || (doc.arrows ?? []).some((f) => f.id === id));
    const fleches = { ArrowLeft: [-PAS, 0], ArrowRight: [PAS, 0], ArrowUp: [0, -PAS], ArrowDown: [0, PAS] };
    if (e.key === "Tab") naviguer(e);
    else if ((e.key === "o" || e.key === "O") && !e.shiftKey) {
      e.preventDefault();
      barre.element.querySelector('button[tabindex="0"]')?.focus();
    } else if (e.key === "Escape" && choix.outil !== "choisir") {
      e.preventDefault();
      e.stopPropagation();
      choix.outil = "choisir";
      afficherOutils();
    } else if (e.key === "Enter" && estBoite) {
      e.preventDefault();
      commencerSaisie(unique());
    } else if (fleches[e.key] && deplacable) {
      e.preventDefault();
      deplacer(choisis, ...fleches[e.key]);
    } else if (e.key === "Delete" && choisis.length > 0) {
      e.preventDefault();
      supprimer(choisis);
    } else if (e.key === "Escape" && choisis.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      choisir(null);
    }
  }

  function surClic(e) {
    if (sansClic) return;
    if (editeur?.contains(e.target) || e.target.closest?.(".poignees, .connecteurs")) return;
    const g = e.target.closest?.("g.boite, g.lien, g.fleche");
    const id = g?.getAttribute("data-id") ?? null;
    if (saisie !== null && id !== saisie) finirSaisie();
    if (saisie === null) {
      surface.focus({ preventScroll: true });
      choisir(id);
    }
  }

  // Conversions écran -> dessin, par la surface et la vue.
  function pointDessin(e) {
    const r = surface.getBoundingClientRect();
    return { x: vueCourante.x + (e.clientX - r.left) / vueCourante.zoom, y: vueCourante.y + (e.clientY - r.top) / vueCourante.zoom };
  }

  function boiteSous(p, sauf) {
    return [...doc.boxes].reverse().find((b) => b.id !== sauf && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height);
  }

  function capturer(e) {
    try {
      surface.setPointerCapture?.(e.pointerId);
    } catch {
      // pointeur déjà relâché : le geste se termine seul
    }
  }

  // Les positions de départ des boîtes et flèches libres que glisser `id` déplace : tous les objets choisis s'il en fait partie.
  function origines(id) {
    const ids = choisis.includes(id) ? choisis : [id];
    return new Map(ids.map((x) => [x, { ...objet(x) }]).filter(([x]) => boite(x) || (doc.arrows ?? []).some((f) => f.id === x)));
  }

  function surAppui(e) {
    if (doc === null || geste || e.button !== 0 || editeur?.contains(e.target)) return;
    const base = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, actif: false };
    const poignee = e.target.closest?.("[data-poignee]")?.getAttribute("data-poignee");
    const b = unique() && boite(unique());
    if (poignee === "taille" && b) {
      capturer(e);
      surface.focus({ preventScroll: true });
      geste = { ...base, type: "taille", id: b.id, origine: { width: b.width, height: b.height }, actif: true };
      return;
    }
    const connecteur = e.target.closest?.("[data-connecteur]");
    if (connecteur) {
      capturer(e);
      surface.focus({ preventScroll: true });
      const id = connecteur.getAttribute("data-boite");
      const cote = connecteur.getAttribute("data-connecteur");
      pointeur = pointDessin(e);
      geste = { ...base, type: "liaison", id, cote, actif: true };
      provisoire = { de: id, cote, ...pointeur };
      dessiner();
      return;
    }
    const libre = (doc.arrows ?? []).find((f) => f.id === unique());
    if ((poignee === "depart" || poignee === "arrivee") && libre) {
      capturer(e);
      surface.focus({ preventScroll: true });
      geste = { ...base, type: "bout", id: libre.id, bout: poignee, origine: { ...libre }, actif: true };
      return;
    }
    const g = e.target.closest?.("g.boite, g.lien, g.fleche");
    if (choix.outil === "selection") {
      geste = { ...base, type: "selection", p0: pointDessin(e) };
    } else if (TAILLES[choix.outil] || choix.outil === "fleche") {
      geste = { ...base, type: TAILLES[choix.outil] ? "forme" : "fleche", p0: pointDessin(e) };
    } else if (choix.outil === "lien" && g?.classList.contains("boite")) {
      geste = { ...base, type: "lien", id: g.getAttribute("data-id") };
    } else if (!g || (choix.outil === "lien" && !g.classList.contains("boite"))) {
      geste = { ...base, type: "vue", origine: { x: vueCourante.x, y: vueCourante.y } };
    } else if (g.classList.contains("fleche")) {
      const id = g.getAttribute("data-id");
      geste = { ...base, type: "corps", id, origines: origines(id) };
    } else if (g.classList.contains("boite")) {
      const id = g.getAttribute("data-id");
      if (saisie === id) return;
      geste = { ...base, type: "boite", id, origines: origines(id) };
    }
  }

  function surMouvement(e) {
    if (doc === null) return;
    if (!geste) {
      pointeur = pointDessin(e);
      dessinerConnecteurs();
      return;
    }
    if (e.pointerId !== geste.pointerId) return;
    const dx = e.clientX - geste.x0;
    const dy = e.clientY - geste.y0;
    const z = vueCourante.zoom;
    if (!geste.actif) {
      if (Math.hypot(dx, dy) <= SEUIL) return;
      geste.actif = true;
      capturer(e);
      finirSaisie();
      if (geste.type === "boite" || geste.type === "corps") {
        if (!choisis.includes(geste.id)) choisis = [geste.id];
        surface.focus({ preventScroll: true });
      } else if (geste.type === "selection") surface.focus({ preventScroll: true });
      else if (geste.type === "vue") surface.classList.add("tiree");
    }
    if (geste.type === "vue") {
      changerVue({ ...vueCourante, x: geste.origine.x - dx / z, y: geste.origine.y - dy / z });
    } else if (geste.type === "boite" || geste.type === "corps") {
      const ddx = Math.round(dx / z);
      const ddy = Math.round(dy / z);
      const o = geste.origines;
      appliquer({
        ...doc,
        boxes: doc.boxes.map((b) => (o.has(b.id) ? { ...b, x: o.get(b.id).x + ddx, y: o.get(b.id).y + ddy } : b)),
        ...(doc.arrows ? { arrows: doc.arrows.map((a) => (o.has(a.id) ? { ...a, x1: o.get(a.id).x1 + ddx, y1: o.get(a.id).y1 + ddy, x2: o.get(a.id).x2 + ddx, y2: o.get(a.id).y2 + ddy } : a)) } : {}),
      });
    } else if (geste.type === "selection") {
      const p = pointDessin(e);
      geste.rect = { x: Math.min(geste.p0.x, p.x), y: Math.min(geste.p0.y, p.y), width: Math.abs(p.x - geste.p0.x), height: Math.abs(p.y - geste.p0.y) };
    } else if (geste.type === "taille") {
      const width = Math.max(40, Math.round(geste.origine.width + dx / z));
      const height = Math.max(24, Math.round(geste.origine.height + dy / z));
      appliquer({ ...doc, boxes: doc.boxes.map((b) => (b.id === geste.id ? { ...b, width, height } : b)) });
    } else if (geste.type === "bout") {
      const o = geste.origine;
      const [kx, ky] = geste.bout === "depart" ? ["x1", "y1"] : ["x2", "y2"];
      const f = { [kx]: Math.round(o[kx] + dx / z), [ky]: Math.round(o[ky] + dy / z) };
      appliquer({ ...doc, arrows: doc.arrows.map((a) => (a.id === geste.id ? { ...a, ...f } : a)) });
    } else if (geste.type === "forme") {
      formeProvisoire = rectangleTrace(geste.p0, pointDessin(e));
    } else if (geste.type === "fleche") {
      const p = pointDessin(e);
      provisoire = { libre: true, depart: geste.p0, x: p.x, y: p.y };
    } else if (geste.type === "lien") {
      pointeur = pointDessin(e);
      provisoire = { de: geste.id, cote: null, ...pointeur };
      cible = boiteSous(pointeur, geste.id)?.id ?? null;
    } else {
      pointeur = pointDessin(e);
      provisoire = { de: geste.id, cote: geste.cote, ...pointeur };
      cible = boiteSous(pointeur, geste.id)?.id ?? null;
    }
    dessiner();
  }

  function surRelache(e) {
    if (!geste || e.pointerId !== geste.pointerId) return;
    const fin = geste;
    if (fin.type === "liaison" && cible && !doc.links.some((l) => l.from === fin.id && l.to === cible)) {
      const lien = { id: idLibre("l", doc), from: fin.id, to: cible, fromSide: fin.cote, toSide: connecteurProche(boite(cible), pointDessin(e)) };
      Object.assign(lien, styleChoisi("trait"));
      appliquer({ ...doc, links: [...doc.links, lien] });
      choisis = [lien.id];
      surface.focus({ preventScroll: true });
    }
    if (fin.type === "selection") {
      annulerGeste();
      sansClic = true;
      setTimeout(() => (sansClic = false), 0);
      if (!fin.actif) return;
      choisis = dansRectangle(doc, fin.rect);
      choix.outil = "choisir";
      dessiner();
      return;
    }
    if (fin.type === "forme" || fin.type === "fleche" || fin.type === "lien") {
      const lieu = cible;
      annulerGeste();
      creerAvecOutil(fin, lieu, pointDessin(e));
      return;
    }
    annulerGeste();
  }

  // Fin d'un geste d'un outil de forme, « Lien » ou « Flèche » : crée l'objet, qui devient choisi, et l'outil revient à « Choisir ».
  function creerAvecOutil(fin, lieu, p) {
    if (fin.type === "forme") {
      if (fin.actif) nouvelleBoite(0, 0, rectangleTrace(fin.p0, p));
      else nouvelleBoite(fin.p0.x, fin.p0.y);
    } else if (fin.type === "fleche") {
      if (!fin.actif) return;
      const f = { id: idLibre("a", doc), x1: Math.round(fin.p0.x), y1: Math.round(fin.p0.y), x2: Math.round(p.x), y2: Math.round(p.y) };
      Object.assign(f, styleChoisi("trait"));
      appliquer({ ...doc, arrows: [...(doc.arrows ?? []), f] });
      choisis = [f.id];
    } else {
      if (!lieu || doc.links.some((l) => l.from === fin.id && l.to === lieu)) return;
      const lien = { id: idLibre("l", doc), from: fin.id, to: lieu };
      Object.assign(lien, styleChoisi("trait"));
      appliquer({ ...doc, links: [...doc.links, lien] });
      choisis = [lien.id];
    }
    sansClic = true;
    setTimeout(() => (sansClic = false), 0);
    choix.outil = "choisir";
    if (fin.type !== "forme") surface.focus({ preventScroll: true });
    dessiner();
  }

  function annulerGeste() {
    if (!geste) return;
    const actif = geste.actif;
    geste = null;
    provisoire = null;
    formeProvisoire = null;
    cible = null;
    surface?.classList.remove("tiree");
    // Un simple clic ne redessine pas : le dessin remplacé sous le pointeur ferait perdre le `click` à la boîte visée.
    if (actif) dessiner();
  }

  function surDoubleClic(e) {
    if (doc === null || e.button !== 0 || editeur?.contains(e.target)) return;
    if (e.target.closest?.("g.lien, g.fleche")) return;
    const b = e.target.closest?.("g.boite");
    if (b) {
      commencerSaisie(b.getAttribute("data-id"));
      return;
    }
    const p = pointDessin(e);
    nouvelleBoite(p.x, p.y);
  }

  function surMolette(e) {
    if (doc === null || (!e.ctrlKey && editeur?.contains(e.target))) return;
    e.preventDefault();
    const z = vueCourante.zoom;
    if (e.ctrlKey) {
      const r = surface.getBoundingClientRect();
      const zoom = Math.min(4, Math.max(0.25, z * 1.1 ** (-e.deltaY / 100)));
      if (zoom === z) return;
      changerVue(zoomerAutour(vueCourante, zoom, e.clientX - r.left, e.clientY - r.top));
    } else if (e.shiftKey) changerVue({ ...vueCourante, x: vueCourante.x + (e.deltaX || e.deltaY) / z });
    else changerVue({ ...vueCourante, x: vueCourante.x + e.deltaX / z, y: vueCourante.y + e.deltaY / z });
    dessiner();
  }

  barre = boiteOutils({
    valeurs: choix,
    surChoix: surChoixOutil,
    surAction: surPlan,
    surEchap: () => surface?.focus({ preventScroll: true }),
  });
  const observateur = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => dessiner());
  observateur?.observe(element);
  monter();

  function changerZoom(sens) {
    if (doc === null) return;
    const zoom = cranVoisin(vueCourante.zoom, sens);
    if (zoom === vueCourante.zoom) return;
    const t = taille();
    changerVue(zoomerAutour(vueCourante, zoom, t.largeur / 2, t.hauteur / 2));
    dessiner();
  }

  return {
    element,
    definirDocument(nouveau) {
      const avant = doc === null;
      finirSaisie();
      doc = nouveau ?? null;
      choisis = doc === null ? [] : choisis.filter((id) => objet(id) !== undefined);
      if (avant || doc === null) monter();
      else dessiner();
    },
    definirNom(nouveau) {
      nomCourant = nouveau;
      if (doc === null) monter();
      else surface.setAttribute("aria-label", nouveau);
    },
    ajouterBoite() {
      if (doc === null) return;
      finirSaisie();
      const t = taille();
      nouvelleBoite(vueCourante.x + t.largeur / 2 / vueCourante.zoom, vueCourante.y + t.hauteur / 2 / vueCourante.zoom);
    },
    zoomAvant: () => changerZoom(1),
    zoomArriere: () => changerZoom(-1),
    toutAfficher() {
      if (doc === null) return;
      changerVue(calculerToutAfficher([...doc.boxes, ...(doc.arrows ?? []).map(rectangleFleche)], taille()));
      dessiner();
    },
    detruire() {
      observateur?.disconnect();
      element.remove();
    },
  };
}
