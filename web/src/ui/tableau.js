import { idLibre } from "../jdiag.js";
import { indication } from "./indication.js";
import { cranVoisin, extremitesFleche, pointSortie, toutAfficher as calculerToutAfficher, voirObjet, zoomerAutour } from "./tableau-calculs.js";

// C-018 : whiteboard. Un SVG dont le `viewBox` suit la vue ; le document est celui de `jdiag.js`.
const SVG = "http://www.w3.org/2000/svg";
const AIDE = "Tab : objet suivant. Entrée : écrire dans la boîte. Flèches : déplacer la boîte. Suppr : effacer. Échap : ne plus rien choisir.";
const PAS = 10;
const SEUIL = 3;
let compteur = 0;

function svg(nom, attrs, parent) {
  const e = document.createElementNS(SVG, nom);
  for (const [k, v] of Object.entries(attrs ?? {})) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}

function nomBoite(boite) {
  const texte = boite.text.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
  return texte || "Boîte vide";
}

export function tableau({ nom, document: documentInitial, vue, surChangement, surVue }) {
  if (!nom) throw new Error("tableau : nom requis");
  if (typeof surChangement !== "function") throw new Error("tableau : surChangement requis");
  const prefixe = `tableau${++compteur}`;
  let doc = documentInitial ?? null;
  let nomCourant = nom;
  let vueCourante = { x: 0, y: 0, zoom: 1, ...vue };
  let choisi = null;
  let saisie = null;
  let editeur = null;
  let surface = null;
  let dessin = null;
  let geste = null; // glisser en cours : { type, id, pointerId, x0, y0, origine, actif, ... }
  let provisoire = null; // flèche en cours de tracé : { de, x, y }
  let cible = null;

  const element = document.createElement("div");
  element.className = "ya-tableau";

  const taille = () => {
    const r = element.getBoundingClientRect();
    return { largeur: r.width, hauteur: r.height };
  };
  const idElement = (id) => `${prefixe}-${id}`;
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
    element.replaceChildren();
    surface = null;
    dessin = null;
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
      element.append(zone);
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
    const aide = document.createElement("span");
    aide.className = "masque";
    aide.id = idElement("aide");
    aide.textContent = AIDE;
    dessin = svg("svg", { focusable: "false" });
    surface.append(dessin, aide);
    element.append(surface);
    surface.addEventListener("keydown", surTouche);
    surface.addEventListener("pointerdown", surAppui);
    surface.addEventListener("pointermove", surMouvement);
    surface.addEventListener("pointerup", surRelache);
    surface.addEventListener("pointercancel", annulerGeste);
    surface.addEventListener("dblclick", surDoubleClic);
    surface.addEventListener("wheel", surMolette, { passive: false });
    dessin.addEventListener("click", surClic);
    dessiner();
  }

  function groupeBoite(b) {
    const g = svg("g", { id: idElement(b.id), "data-id": b.id, role: "group", "aria-roledescription": "boîte", "aria-label": nomBoite(b) });
    const glissee = geste?.actif && geste.type === "boite" && geste.id === b.id;
    g.setAttribute("class", `boite${choisi === b.id ? " choisie" : ""}${saisie === b.id ? " saisie" : ""}${glissee ? " glissee" : ""}${cible === b.id ? " cible" : ""}`);
    const geo = { x: b.x, y: b.y, width: b.width, height: b.height, rx: 4 };
    svg("rect", geo, g);
    svg("rect", { ...geo, class: "surcouche" }, g);
    const fo = svg("foreignObject", { x: b.x, y: b.y, width: b.width, height: b.height }, g);
    let texte;
    if (saisie === b.id) texte = editeur;
    else {
      texte = document.createElement("div");
      texte.className = "ya-tableau-texte";
      texte.textContent = b.text;
    }
    fo.append(texte);
    return g;
  }

  function groupeFleche(l, z) {
    const de = boite(l.from);
    const vers = boite(l.to);
    const g = svg("g", { id: idElement(l.id), "data-id": l.id, role: "group", "aria-roledescription": "flèche", "aria-label": `De ${nomBoite(de)} vers ${nomBoite(vers)}` });
    g.setAttribute("class", `fleche${choisi === l.id ? " choisie" : ""}`);
    const oppose = doc.links.some((m) => m.from === l.to && m.to === l.from);
    const { depart, arrivee } = extremitesFleche(de, vers, oppose ? 4 / z : 0);
    traceFleche(g, depart, arrivee, z, true);
    return g;
  }

  function traceFleche(g, depart, arrivee, z, avecPrise) {
    const dx = arrivee.x - depart.x;
    const dy = arrivee.y - depart.y;
    const longueur = Math.hypot(dx, dy) || 1;
    const ux = dx / longueur;
    const uy = dy / longueur;
    const base = { x: arrivee.x - (ux * 10) / z, y: arrivee.y - (uy * 10) / z };
    const ligne = (classe, fin) => svg("line", { class: classe, x1: depart.x, y1: depart.y, x2: fin.x, y2: fin.y }, g);
    if (avecPrise) ligne("prise", arrivee);
    ligne("trait", base);
    const l4 = 4 / z;
    const points = [arrivee, { x: base.x - uy * l4, y: base.y + ux * l4 }, { x: base.x + uy * l4, y: base.y - ux * l4 }];
    svg("polygon", { class: "pointe", points: points.map((p) => `${p.x},${p.y}`).join(" ") }, g);
  }

  function flecheProvisoire(z) {
    const g = svg("g", { class: "fleche provisoire", "aria-hidden": "true" });
    const source = boite(provisoire.de);
    traceFleche(g, pointSortie(source, provisoire.x, provisoire.y), { x: provisoire.x, y: provisoire.y }, z, false);
    return g;
  }

  function poignees(b, z) {
    const g = svg("g", { class: "poignees", "aria-hidden": "true" });
    const cx = b.x + b.width;
    const cy = b.y + b.height;
    svg("rect", { class: "prise", "data-poignee": "taille", x: cx - 8 / z, y: cy - 8 / z, width: 16 / z, height: 16 / z }, g);
    svg("rect", { class: "carre", x: cx - 4 / z, y: cy - 4 / z, width: 8 / z, height: 8 / z }, g);
    const my = b.y + b.height / 2;
    svg("line", { class: "queue", x1: cx, y1: my, x2: cx + 18 / z, y2: my }, g);
    svg("rect", { class: "prise", "data-poignee": "liaison", x: cx + 8 / z, y: my - 10 / z, width: 20 / z, height: 20 / z }, g);
    svg("circle", { class: "rond", cx: cx + 18 / z, cy: my, r: 4 / z }, g);
    return g;
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
    for (const l of doc.links) dessin.append(groupeFleche(l, z));
    if (provisoire) dessin.append(flecheProvisoire(z));
    const b = choisi && !saisie ? boite(choisi) : null;
    if (b) dessin.append(poignees(b, z));
    if (choisi) surface.setAttribute("aria-activedescendant", idElement(choisi));
    else surface.removeAttribute("aria-activedescendant");
    if (avaitFocus) placerCurseur(decalage);
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
    choisi = id;
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
    choisi = id;
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

  function supprimer(id) {
    const estBoite = boite(id) !== undefined;
    appliquer({
      ...doc,
      boxes: doc.boxes.filter((b) => b.id !== id),
      links: doc.links.filter((l) => l.id !== id && (!estBoite || (l.from !== id && l.to !== id))),
    });
    choisi = null;
    dessiner();
  }

  function deplacer(id, dx, dy) {
    appliquer({ ...doc, boxes: doc.boxes.map((b) => (b.id === id ? { ...b, x: b.x + dx, y: b.y + dy } : b)) });
    ramener(id);
    dessiner();
  }

  function naviguer(e) {
    const objets = [...doc.boxes, ...doc.links].map((o) => o.id);
    const i = choisi === null ? -1 : objets.indexOf(choisi);
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
    if (doc === null || e.ctrlKey || e.metaKey || e.altKey) return;
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
    const estBoite = choisi !== null && boite(choisi) !== undefined;
    const fleches = { ArrowLeft: [-PAS, 0], ArrowRight: [PAS, 0], ArrowUp: [0, -PAS], ArrowDown: [0, PAS] };
    if (e.key === "Tab") naviguer(e);
    else if (e.key === "Enter" && estBoite) {
      e.preventDefault();
      commencerSaisie(choisi);
    } else if (fleches[e.key] && estBoite) {
      e.preventDefault();
      deplacer(choisi, ...fleches[e.key]);
    } else if (e.key === "Delete" && choisi !== null) {
      e.preventDefault();
      supprimer(choisi);
    } else if (e.key === "Escape" && choisi !== null) {
      e.preventDefault();
      e.stopPropagation();
      choisir(null);
    }
  }

  function surClic(e) {
    if (editeur?.contains(e.target) || e.target.closest?.(".poignees")) return;
    const g = e.target.closest?.("g.boite, g.fleche");
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

  function surAppui(e) {
    if (doc === null || geste || e.button !== 0 || editeur?.contains(e.target)) return;
    const base = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, actif: false };
    const poignee = e.target.closest?.("[data-poignee]")?.getAttribute("data-poignee");
    const b = choisi && boite(choisi);
    if (poignee && b) {
      capturer(e);
      surface.focus({ preventScroll: true });
      if (poignee === "taille") geste = { ...base, type: "taille", id: b.id, origine: { width: b.width, height: b.height }, actif: true };
      else {
        geste = { ...base, type: "liaison", id: b.id, actif: true };
        provisoire = { de: b.id, ...pointDessin(e) };
        dessiner();
      }
      return;
    }
    const g = e.target.closest?.("g.boite, g.fleche");
    if (!g) geste = { ...base, type: "vue", origine: { x: vueCourante.x, y: vueCourante.y } };
    else if (g.classList.contains("boite")) {
      const id = g.getAttribute("data-id");
      if (saisie === id) return;
      const o = boite(id);
      geste = { ...base, type: "boite", id, origine: { x: o.x, y: o.y } };
    }
  }

  function surMouvement(e) {
    if (!geste || e.pointerId !== geste.pointerId) return;
    const dx = e.clientX - geste.x0;
    const dy = e.clientY - geste.y0;
    const z = vueCourante.zoom;
    if (!geste.actif) {
      if (Math.hypot(dx, dy) <= SEUIL) return;
      geste.actif = true;
      capturer(e);
      finirSaisie();
      if (geste.type === "boite") {
        choisi = geste.id;
        surface.focus({ preventScroll: true });
      } else surface.classList.add("tiree");
    }
    if (geste.type === "vue") {
      changerVue({ ...vueCourante, x: geste.origine.x - dx / z, y: geste.origine.y - dy / z });
    } else if (geste.type === "boite") {
      const x = Math.round(geste.origine.x + dx / z);
      const y = Math.round(geste.origine.y + dy / z);
      appliquer({ ...doc, boxes: doc.boxes.map((b) => (b.id === geste.id ? { ...b, x, y } : b)) });
    } else if (geste.type === "taille") {
      const width = Math.max(40, Math.round(geste.origine.width + dx / z));
      const height = Math.max(24, Math.round(geste.origine.height + dy / z));
      appliquer({ ...doc, boxes: doc.boxes.map((b) => (b.id === geste.id ? { ...b, width, height } : b)) });
    } else {
      const p = pointDessin(e);
      provisoire = { de: geste.id, ...p };
      cible = boiteSous(p, geste.id)?.id ?? null;
    }
    dessiner();
  }

  function surRelache(e) {
    if (!geste || e.pointerId !== geste.pointerId) return;
    const fin = geste;
    if (fin.type === "liaison" && cible && !doc.links.some((l) => l.from === fin.id && l.to === cible)) {
      appliquer({ ...doc, links: [...doc.links, { id: idLibre("l", doc), from: fin.id, to: cible }] });
    }
    annulerGeste();
  }

  function annulerGeste() {
    if (!geste) return;
    geste = null;
    provisoire = null;
    cible = null;
    surface?.classList.remove("tiree");
    dessiner();
  }

  function surDoubleClic(e) {
    if (doc === null || e.button !== 0 || editeur?.contains(e.target)) return;
    const g = e.target.closest?.("g.fleche");
    if (g) return;
    const b = e.target.closest?.("g.boite");
    if (b) {
      commencerSaisie(b.getAttribute("data-id"));
      return;
    }
    const p = pointDessin(e);
    const id = idLibre("b", doc);
    appliquer({ ...doc, boxes: [...doc.boxes, { id, x: Math.round(p.x - 80), y: Math.round(p.y - 40), width: 160, height: 80, text: "" }] });
    commencerSaisie(id);
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
      if (doc === null || !choisi || ![...doc.boxes, ...doc.links].some((o) => o.id === choisi)) choisi = null;
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
      const id = idLibre("b", doc);
      const x = Math.round(vueCourante.x + t.largeur / 2 / vueCourante.zoom - 80);
      const y = Math.round(vueCourante.y + t.hauteur / 2 / vueCourante.zoom - 40);
      appliquer({ ...doc, boxes: [...doc.boxes, { id, x, y, width: 160, height: 80, text: "" }] });
      commencerSaisie(id);
    },
    zoomAvant: () => changerZoom(1),
    zoomArriere: () => changerZoom(-1),
    toutAfficher() {
      if (doc === null) return;
      changerVue(calculerToutAfficher(doc.boxes, taille()));
      dessiner();
    },
    detruire() {
      observateur?.disconnect();
      element.remove();
    },
  };
}
