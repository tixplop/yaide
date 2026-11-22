import { ecrireJdiag, FORMES_PLEINES, idLibre, positionTexte, SYMBOLES, TAILLES } from "../jdiag.js";
import { estMac } from "../references.js";
import { indication } from "./indication.js";
import { menu } from "./menu.js";
import { versKlaxoon } from "../klaxoon.js";
import { message } from "./message.js";
import { depuisMermaid } from "../mermaid-jdiag.js";
import { chargerMermaid } from "./diagramme.js";
import { auPlan, coller, copier, rattacher } from "./tableau-edition.js";
import { boiteOutils } from "./tableau-outils.js";
import { connecteurProcheAffiche, connecteursAffiches, connecteurs, dansRectangle, decalageAnneau, estFormePleine, estSymbole, geometrieLien, pointSurBord, cranVoisin, extremitesFleche, rectangleFleche, toutAfficher as calculerToutAfficher, voirObjet, zoomerAutour } from "./tableau-calculs.js";
import { basculer, colorer, decalages, etatTexte, inserer, lireTexte, pointA, rendreZone } from "./tableau-texte.js";
import { anneauxPleines, dessinBoite, dessinConnecteurs, dessinFleche, dessinFormeProvisoire, dessinLien, dessinProvisoire, dessinRectangleSelection, poigneesBoite, poigneesFleche, poigneesLien, svg } from "./tableau-dessin.js";

// C-018 : whiteboard. Un SVG dont le `viewBox` suit la vue ; le document est celui de `jdiag.js`.
const aide = () => {
  const ctrl = estMac() ? "Cmd" : "Ctrl";
  return `Tab : objet suivant. Entrée : écrire dans la boîte. Flèches : déplacer. Suppr : effacer. ${ctrl}+A : tout choisir. ${ctrl}+C, ${ctrl}+V : copier, coller. ${ctrl}+Z, ${ctrl}+Y : annuler, rétablir. Échap : ne plus rien choisir. O : boîte à outils.`;
};
const PAS = 10;
const SEUIL = 3;
const PROCHE = 24; // px écran : distance du pointeur au bord d'une boîte pour montrer ses connecteurs
const OUTILS_DEPART = { outil: "choisir", forme: "rectangle", couleur: "default", trace: "direct", bouts: "end", trait: "solid", opacite: 100, taille: "normal", epaisseur: "thin" };
// Clé du document de chaque choix de la boîte à outils, et sortes d'objets qu'il concerne :
// « boite », « texte » (la forme « Texte »), « lien » et « trait » (flèches libres, et choix d'un nouveau lien).
const CLES_STYLE = { couleur: "color", opacite: "opacity", taille: "textSize", trace: "route", bouts: "ends", trait: "line", epaisseur: "weight" };
const CONCERNES = {
  couleur: ["boite", "texte", "forme", "trait", "lien"],
  opacite: ["boite", "forme"],
  taille: ["boite", "texte", "lien"],
  trace: ["trait", "lien"],
  bouts: ["trait", "lien"],
  trait: ["boite", "forme", "trait", "lien"],
  epaisseur: ["boite", "forme", "trait", "lien"],
};
let compteur = 0;
let collages = 0; // collages faits depuis la dernière copie
let presse = null; // la copie de Ctrl+C, partagée par tous les onglets de whiteboard
let dernierTexte = null; // le texte écrit dans le presse-papiers du système par la dernière copie

// Taille minimale d'une forme : 8 x 8 px pour « Point » et « Barre », 40 x 24 px pour les autres.
const tailleMin = (shape) => (estFormePleine({ shape }) ? [8, 8] : [40, 24]);

// Le rectangle des deux points, dans tous les sens, jamais sous la taille minimale de la forme, aux positions entières.
function rectangleTrace(a, b, shape) {
  const [minL, minH] = tailleMin(shape);
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.max(minL, Math.round(Math.abs(b.x - a.x))),
    height: Math.max(minH, Math.round(Math.abs(b.y - a.y))),
  };
}

const compter = (texte) => Array.from(texte).length;
const memeSpans = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// L'objet avec son texte et ses parties ; `spans` n'est écrit que s'il y en a ou s'il y en avait.
const avecTexte = (o, text, spans) => (spans.length > 0 || o.spans ? { ...o, text, spans } : { ...o, text });

function nomBoite(boite) {
  const texte = boite.text.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
  const symbole = [...SYMBOLES, ...FORMES_PLEINES].find((s) => s.shape === boite.shape);
  if (symbole && estFormePleine(boite)) return symbole.nom;
  if (symbole) return texte ? `${symbole.nom} : ${texte}` : symbole.nom;
  return texte || "Boîte vide";
}

export function tableau({ nom, document: documentInitial, vue, outils, theme, surChangement, surVue }) {
  if (!nom) throw new Error("tableau : nom requis");
  if (typeof surChangement !== "function") throw new Error("tableau : surChangement requis");
  const prefixe = `tableau${++compteur}`;
  let doc = documentInitial ?? null;
  let nomCourant = nom;
  let vueCourante = { x: 0, y: 0, zoom: 1, ...vue };
  let choisis = []; // les `id` choisis, dans l'ordre de Tab
  let etat = null; // zone `status`
  let detruit = false;
  let alerte = null; // zone `alert` du refus d'un collage mermaid, vide sans refus
  let saisie = null;
  let dessinSeul = 0; // numéro du Ctrl+Maj+V pressé sur la surface, tant que ni `paste` ni une autre touche ne l'ont consommé (0 : aucun)
  let pressees = 0;
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
  let menuOuvert = null; // menu « Actions sur la sélection » : { fermer }
  let enAttente = null; // copie au format Klaxoon que `surCopie` doit écrire : { klaxoon, copie, recu }

  const element = document.createElement("div");
  element.className = "ya-tableau-zone";
  if (theme === "light" || theme === "dark") element.dataset.theme = theme;
  const fond = document.createElement("div");
  fond.className = "ya-tableau";
  element.append(fond);
  // Sur `fond` et non sur la surface : le navigateur envoie `paste` et `copy` pas forcément à l'élément qui a le focus : selon la sélection de la page (celle de l'éditeur d'où l'on vient), ils peuvent partir vers un voisin de la surface.
  fond.addEventListener("paste", surColler);
  fond.addEventListener("copy", surCopie);

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
  const nomLien = (l) => `De ${nomBoite(boite(l.from))} vers ${nomBoite(boite(l.to))}${l.text ? ` : ${l.text.split("\n").join(" ")}` : ""}`;
  const estLien = (id) => doc.links.some((l) => l.id === id);
  // Remplace le texte de la boîte ou du lien `id`.
  const avecTexteDe = (id, text, spans) => ({
    ...doc,
    boxes: doc.boxes.map((x) => (x.id === id ? avecTexte(x, text, spans) : x)),
    links: doc.links.map((x) => (x.id === id ? avecTexte(x, text, spans) : x)),
  });
  const nomSaisie = (o, text) => (boite(o.id) ? nomBoite({ ...boite(o.id), text }) : nomLien({ ...o, text }));
  // Historique (REQ-145) : les documents d'avant (100 au plus) et ceux à refaire.
  let passes = [];
  let aRefaire = [];
  let dernierGroupe = null; // le groupe du dernier pas : ses appels suivants le prolongent
  let annonce = null; // { texte, choix } : message de Ctrl+Z / Ctrl+Y dans la zone status
  const appliquer = (nouveau, groupe = null) => {
    if (groupe === null || groupe !== dernierGroupe) {
      passes.push(doc);
      if (passes.length > 100) passes.shift();
      aRefaire = [];
    }
    dernierGroupe = groupe;
    doc = nouveau;
    surChangement(nouveau);
  };
  // Fin d'un geste ou d'une saisie : un pas qui ne change pas le texte du document ne compte pas.
  const clore = (groupe) => {
    if (groupe === null || dernierGroupe !== groupe) return;
    dernierGroupe = null;
    if (ecrireJdiag(passes.at(-1)) === ecrireJdiag(doc)) passes.pop();
  };
  const annoncer = (texte) => {
    const a = { texte: "", choix: choisis.join(",") };
    annonce = a;
    if (etat) etat.textContent = "";
    setTimeout(() => {
      if (annonce !== a) return;
      a.texte = texte;
      if (etat) etat.textContent = texte;
    }, 0);
  };
  function historique(sens) {
    if (saisie !== null || geste || doc === null) return;
    const pile = sens < 0 ? passes : aRefaire;
    if (pile.length === 0) {
      annoncer(sens < 0 ? "Rien à annuler." : "Rien à rétablir.");
      return;
    }
    (sens < 0 ? aRefaire : passes).push(doc);
    doc = pile.pop();
    dernierGroupe = null;
    choisis = choisis.filter((id) => objet(id) !== undefined);
    surChangement(doc);
    dessiner();
    annoncer(sens < 0 ? "Modification annulée." : "Modification rétablie.");
  }
  // Ctrl+Z, Ctrl+Y (Cmd sur macOS), sans Alt ni Maj ; hors saisie, jamais l'effet du navigateur.
  function surHistorique(e) {
    if (saisie !== null || e.altKey || e.shiftKey || !(estMac() ? e.metaKey : e.ctrlKey)) return false;
    const k = e.key.toLowerCase();
    if (k !== "z" && k !== "y") return false;
    e.preventDefault();
    historique(k === "z" ? -1 : 1);
    return true;
  }
  const changerVue = (nouvelle) => {
    vueCourante = nouvelle;
    surVue?.({ ...vueCourante });
  };

  function monter() {
    fond.replaceChildren();
    barre?.element.remove();
    menuOuvert?.fermer();
    surface = null;
    dessin = null;
    etat = null;
    alerte = null;
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
    // Une zone vivante déjà dans la page, vide (donc cachée) sans refus : le texte y est posé pour être lu.
    alerte = message({ texte: "-", variante: "erreur", presentation: "flottante" });
    alerte.replaceChildren();
    fond.append(surface, etat, alerte);
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
    surface.addEventListener("contextmenu", surMenuContextuel);
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
      rendreZone(texte, b.text, b.spans);
    }
    return dessinBoite(b, { id: idElement(b.id), nom: nomBoite(b), classe, texte, zoom: vueCourante.zoom });
  }

  function groupeLien(l, z) {
    return dessinLien(doc, l, z, { id: idElement(l.id), nom: nomLien(l), classe: choisis.includes(l.id) ? " choisie" : "", texte: saisie === l.id ? editeur : null });
  }

  function flecheProvisoire(z) {
    if (provisoire.lien) return dessinProvisoire(provisoire.depart, provisoire.arrivee, z, { ends: provisoire.ends });
    const arrivee = { x: provisoire.x, y: provisoire.y };
    if (provisoire.libre) return dessinProvisoire(provisoire.depart, arrivee, z, { route: choix.trace, ends: choix.bouts, line: choix.trait });
    const source = boite(provisoire.de);
    const depart = provisoire.cote && provisoire.cote !== "center" ? connecteurs(source)[provisoire.cote] : pointSurBord(source, arrivee);
    return dessinProvisoire(depart, arrivee, z);
  }

  const lienChoisi = () => (unique() && !saisie ? doc.links.find((l) => l.id === unique()) ?? null : null);
  const boutsLien = (l) => {
    const g = geometrieLien(doc, l, vueCourante.zoom);
    return [g.debut.point, g.fin.point];
  };

  // Les boîtes dont on montre les connecteurs, et ceux qui sont pleins (sous le pointeur, de départ ou le plus proche d'une cible).
  function etatConnecteurs() {
    const rien = { boites: [], pleins: [] };
    if (menuOuvert || saisie !== null || (geste && geste.type !== "liaison" && geste.type !== "boutLien")) return rien;
    if (geste?.type === "boutLien") {
      if (!cible || !pointeur) return rien;
      return { boites: [boite(cible)], pleins: [{ id: cible, cote: connecteurProcheAffiche(boite(cible), pointeur, vueCourante.zoom) }] };
    }
    if (geste) {
      const pleins = [{ id: geste.id, cote: geste.cote }];
      const boites = [boite(geste.id)];
      if (cible && pointeur) {
        boites.push(boite(cible));
        pleins.push({ id: cible, cote: connecteurProcheAffiche(boite(cible), pointeur, vueCourante.zoom) });
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
    const decalage = choisie && estFormePleine(choisie) ? decalageAnneau(choisie, z) : 0;
    const surTaille = choisie && Math.max(Math.abs(pointeur.x - (choisie.x + choisie.width + decalage)), Math.abs(pointeur.y - (choisie.y + choisie.height + decalage))) <= 8 / z;
    const lien = lienChoisi();
    const surBout = lien && boutsLien(lien).some((p) => Math.max(Math.abs(pointeur.x - p.x), Math.abs(pointeur.y - p.y)) <= 8 / z);
    const pleins = [];
    if (!surTaille && !surBout) {
      for (const b of boites) {
        for (const [cote, p] of Object.entries(connecteursAffiches(b, z))) {
          if (Math.max(Math.abs(pointeur.x - p.x), Math.abs(pointeur.y - p.y)) <= 8 / z) {
            pleins.push({ id: b.id, cote, dist: Math.hypot(pointeur.x - p.x, pointeur.y - p.y) });
          }
        }
      }
      pleins.sort((a, c) => a.dist - c.dist);
    }
    return { boites, pleins: pleins.slice(0, 1).map(({ id, cote }) => ({ id, cote })) };
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
    const sel = avaitFocus ? selectionSaisie() : null;
    dessin.replaceChildren();
    for (const b of doc.boxes) dessin.append(groupeBoite(b));
    for (const l of doc.links) if (!(geste?.actif && geste.type === "boutLien" && geste.id === l.id)) dessin.append(groupeLien(l, z));
    for (const f of doc.arrows ?? []) dessin.append(dessinFleche(f, z, { id: idElement(f.id), classe: choisis.includes(f.id) ? " choisie" : "" }));
    const b = unique() && !saisie ? boite(unique()) : null;
    const libre = unique() && !saisie ? (doc.arrows ?? []).find((f) => f.id === unique()) : null;
    const lien = lienChoisi();
    couche = svg("g");
    dessin.append(couche);
    dessinerConnecteurs();
    const pleines = choisis.filter((id) => boite(id) && estFormePleine(boite(id))).map(boite);
    if (pleines.length > 0 && !saisie) dessin.append(anneauxPleines(pleines, z));
    if (b) dessin.append(poigneesBoite(b, z));
    if (libre) dessin.append(poigneesFleche(libre, z));
    if (lien && !(geste?.actif && geste.type === "boutLien")) dessin.append(poigneesLien(doc, lien, z));
    if (provisoire) dessin.append(flecheProvisoire(z));
    if (formeProvisoire) dessin.append(dessinFormeProvisoire(formeProvisoire));
    if (geste?.type === "selection" && geste.actif) dessin.append(dessinRectangleSelection(geste.rect));
    if (premier()) surface.setAttribute("aria-activedescendant", idElement(premier()));
    else surface.removeAttribute("aria-activedescendant");
    if (annonce && annonce.choix !== choisis.join(",")) annonce = null;
    etat.textContent = annonce ? annonce.texte : choisis.length > 1 ? `${choisis.length} objets choisis` : "";
    if (avaitFocus) placerSelection(sel?.debut ?? null, sel?.fin);
    afficherOutils();
  }

  const sorte = (o) => (boite(o.id) ? (o.shape === "text" || estSymbole(o) ? "texte" : estFormePleine(o) ? "forme" : "boite") : estLien(o.id) ? "lien" : "trait");
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
    barre.definir(valeurs, { planActif: saisie !== null || choisis.length > 0, texte: texteOutils(), position: positionOutils() });
    surface?.classList.toggle("crosshair", choix.outil !== "choisir" || geste?.type === "boutLien");
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

  // Les boîtes visées par « Alignement du texte » et « Position verticale du texte » : la boîte en saisie, sinon les boîtes choisies.
  const boitesVisees = () => cibles().filter((o) => boite(o.id) && !estFormePleine(o));
  function positionOutils() {
    const bs = boitesVisees();
    if (bs.length === 0) return { actif: false };
    const commun = (cle) => (bs.every((o) => positionTexte(o)[cle] === positionTexte(bs[0])[cle]) ? positionTexte(bs[0])[cle] : null);
    return { actif: true, align: commun("align"), valign: commun("valign") };
  }

  // Une modification pour toutes les boîtes visées, sans choix pour les suivantes ; la valeur par défaut de la forme retire la clé.
  function surPosition(cle, valeur) {
    const ids = boitesVisees().filter((o) => positionTexte(o)[cle] !== valeur).map((o) => o.id);
    if (ids.length === 0) return;
    const change = (x) => {
      if (!ids.includes(x.id)) return x;
      const reste = { ...x };
      delete reste[cle];
      return valeur === positionTexte(reste)[cle] ? reste : { ...reste, [cle]: valeur };
    };
    appliquer({ ...doc, boxes: doc.boxes.map(change) });
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
    Object.assign(b, styleChoisi(choix.forme === "text" || estSymbole({ shape: choix.forme }) ? "texte" : estFormePleine({ shape: choix.forme }) ? "forme" : "boite"));
    appliquer({ ...doc, boxes: [...doc.boxes, b] });
    choix.outil = "choisir";
    commencerSaisie(id);
  }

  const selectionSaisie = () => (editeur ? decalages(editeur, globalThis.getSelection?.()) : null);

  // Focus dans la saisie, sélection de `debut` à `fin` (en caractères) ; `null` : curseur à la fin du texte.
  function placerSelection(debut, fin = debut) {
    editeur.focus();
    const sel = globalThis.getSelection?.();
    if (!sel) return;
    if (debut === null) debut = fin = compter(lireTexte(editeur).text);
    const r = document.createRange();
    r.setStart(...pointA(editeur, debut));
    r.setEnd(...pointA(editeur, fin));
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // Les objets dont le texte se met en forme (boîtes et liens choisis, ou boîte en saisie), avec leur texte et la plage visée :
  // la sélection de la saisie si elle n'est pas vide, sinon tout le texte.
  function plages() {
    return cibles()
      .filter((o) => (boite(o.id) && !estFormePleine(o)) || doc.links.some((l) => l.id === o.id))
      .map((o) => {
        const { text, spans } = o.id === saisie ? lireTexte(editeur) : { text: o.text ?? "", spans: o.spans ?? [] };
        const sel = o.id === saisie ? selectionSaisie() : null;
        const [d, f] = sel && sel.fin > sel.debut ? [sel.debut, sel.fin] : [0, compter(text)];
        return { o, text, spans, d, f };
      });
  }

  // État du texte visé pour la boîte à outils : styles que tout le texte non vide a, couleur commune ou `null`.
  function texteOutils() {
    const ps = plages();
    if (ps.length === 0) return { actif: false };
    const etats = ps.filter((p) => p.f > p.d).map((p) => etatTexte(p.text, p.spans, p.d, p.f));
    if (etats.length === 0) return { actif: true, styles: [], couleur: "default" };
    return {
      actif: true,
      styles: etats[0].styles.filter((s) => etats.every((e) => e.styles.includes(s))),
      couleur: etats.every((e) => e.couleur === etats[0].couleur) ? etats[0].couleur : null,
    };
  }

  // « Gras », « Italique », « Souligné », « Barré » (`cle` : le style) ou la couleur du texte (`cle` = « color »).
  function surTexte(cle, couleur) {
    const visees = plages().filter((p) => p.f > p.d);
    const valeur = cle === "color" ? null : !visees.every((p) => etatTexte(p.text, p.spans, p.d, p.f).styles.includes(cle));
    const nouveaux = new Map();
    for (const p of visees) {
      const spans = cle === "color" ? colorer(p.text, p.spans, p.d, p.f, couleur) : basculer(p.text, p.spans, p.d, p.f, cle, valeur);
      if (!memeSpans(spans, p.spans)) nouveaux.set(p.o.id, { text: p.text, spans });
    }
    if (nouveaux.size === 0) return;
    const sel = selectionSaisie();
    const change = (x) => (nouveaux.has(x.id) ? { ...x, ...nouveaux.get(x.id) } : x);
    appliquer({ ...doc, boxes: doc.boxes.map(change), links: doc.links.map(change) });
    if (saisie !== null) {
      const n = nouveaux.get(saisie);
      rendreZone(editeur, n.text, n.spans);
      placerSelection(sel?.debut ?? null, sel?.fin);
    }
    dessiner();
  }

  // Remplace la sélection de la saisie (ou `plage`, en caractères) par `ajout`, sans balise : le texte prend les styles d'avant.
  function insererDansSaisie(ajout, plage) {
    const id = saisie;
    const { text, spans } = lireTexte(editeur);
    const fin = compter(text);
    const p = plage ?? selectionSaisie() ?? { debut: fin, fin };
    const r = inserer(text, spans, p.debut, p.fin, ajout);
    if (r.text === text && memeSpans(r.spans, spans)) return;
    appliquer(avecTexteDe(id, r.text, r.spans), editeur);
    rendreZone(editeur, r.text, r.spans);
    placerSelection(p.debut + compter(ajout));
    dessin.querySelector(`[data-id="${id}"]`)?.setAttribute("aria-label", nomSaisie(objet(id), r.text));
    afficherOutils();
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
    // Un texte blanc vaut « sans texte » (AC-147-10).
    const o = objet(saisie);
    if (o && estLien(saisie) && /^\s*$/.test(o.text ?? "") && (o.text || (o.spans ?? []).length > 0)) {
      doc = avecTexteDe(saisie, "", []);
      surChangement(doc);
      dessin.querySelector(`[data-id="${saisie}"]`)?.setAttribute("aria-label", nomLien(objet(saisie)));
    }
    clore(editeur);
    saisie = null;
    editeur = null;
    dessiner();
  }

  function commencerSaisie(id) {
    finirSaisie();
    // « Point » et « Barre » n'ont pas de texte : la boîte est seulement choisie.
    if (boite(id) && estFormePleine(boite(id))) {
      choisis = [id];
      dessiner();
      return;
    }
    saisie = id;
    choisis = [id];
    editeur = document.createElement("div");
    editeur.className = "ya-tableau-texte";
    editeur.setAttribute("contenteditable", "true");
    editeur.setAttribute("role", "textbox");
    editeur.setAttribute("aria-multiline", "true");
    const lien = estLien(id);
    if (lien) editeur.className = "ya-tableau-lien-texte";
    editeur.setAttribute("aria-label", lien ? "Texte du lien" : "Texte de la boîte");
    editeur.tabIndex = -1;
    rendreZone(editeur, objet(id).text ?? "", objet(id).spans);
    const mon = editeur;
    // Le navigateur ne met jamais de balise : retours à la ligne et collages passent par `insererDansSaisie`, les `format*` ne font rien.
    editeur.addEventListener("beforeinput", (e) => {
      if (mon !== editeur) return;
      const type = e.inputType ?? "";
      if (type.startsWith("format")) {
        e.preventDefault();
      } else if (type === "insertParagraph" || type === "insertLineBreak") {
        e.preventDefault();
        insererDansSaisie("\n");
      } else if (type === "insertFromPaste" || type === "insertFromDrop") {
        e.preventDefault();
        const cible = e.getTargetRanges?.()[0];
        insererDansSaisie(e.dataTransfer?.getData("text/plain") ?? e.data ?? "", cible ? decalages(editeur, cible) : null);
      }
    });
    // Le DOM de la saisie n'est jamais réécrit ici : l'annulation du navigateur en dépend.
    editeur.addEventListener("input", () => {
      const o = objet(id);
      if (!o || mon !== editeur) return;
      const { text, spans } = lireTexte(mon);
      if (text === (o.text ?? "") && memeSpans(spans, o.spans ?? [])) return;
      appliquer(avecTexteDe(id, text, spans), mon);
      dessin.querySelector(`[data-id="${id}"]`)?.setAttribute("aria-label", nomSaisie(objet(id), text));
      afficherOutils();
    });
    dessiner();
    placerSelection(null);
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
    // Le `paste` n'indique pas Maj : Ctrl+Maj+V lève ce drapeau, sans `preventDefault` (sinon pas de `paste`), et toute autre touche le baisse.
    // Firefox n'envoie pas `paste` à une surface qui n'est pas modifiable : le texte est alors lu dans le presse-papiers, si aucun `paste` n'est venu entre-temps.
    const numero = saisie === null && e.shiftKey && !e.altKey && (estMac() ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "v" ? ++pressees : 0;
    dessinSeul = numero;
    if (numero !== 0 && doc !== null) {
      setTimeout(() => {
        if (dessinSeul !== numero) return;
        navigator.clipboard?.readText?.().then(
          (texte) => {
            if (dessinSeul !== numero) return;
            dessinSeul = 0;
            collerTexte(texte, true);
          },
          () => {},
        );
      }, 0);
    }
    if (doc === null) return;
    if (geste?.type === "selection" && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      annulerGeste();
      choix.outil = "choisir";
      dessiner();
      return;
    }
    if (surHistorique(e)) return;
    if (saisie === null && !geste && (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      effacerRefus();
      ouvrirMenu(departClavier());
      return;
    }
    if (saisie === null && !e.altKey && !e.shiftKey && (estMac() ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      choisis = tousLesId();
      dessiner();
      return;
    }
    if (saisie === null && !e.altKey && !e.shiftKey && (estMac() ? e.metaKey : e.ctrlKey) && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "v")) {
      // Ni Ctrl+C ni Ctrl+V ne sont retenus : les événements `copy` et `paste` du navigateur partent ensuite.
      if (e.key.toLowerCase() === "c") {
        presse = copier(doc, choisis);
        collages = 0;
      }
      return;
    }
    if (saisie !== null && e.target === editeur && !e.altKey && !e.shiftKey && (estMac() ? e.metaKey : e.ctrlKey)) {
      const style = { b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()];
      if (style) {
        e.preventDefault();
        surTexte(style);
        return;
      }
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
    const estBoite = unique() !== null && (boite(unique()) !== undefined || estLien(unique()));
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

  // Écrit les textes des boîtes copiées, un par ligne, dans le presse-papiers du système.
  function surCopie(e) {
    if (doc === null || saisie !== null) return;
    if (enAttente) {
      e.clipboardData?.setData("text/plain", enAttente.klaxoon.texte);
      e.clipboardData?.setData("text/html", enAttente.klaxoon.html);
      enAttente.recu = true;
      e.preventDefault();
      return;
    }
    dernierTexte = (presse?.boxes ?? []).map((b) => b.text).join("\n");
    e.clipboardData?.setData("text/plain", dernierTexte);
    e.preventDefault();
  }

  const effacerRefus = () => {
    if (alerte?.firstChild) alerte.replaceChildren();
  };

  const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

  // « Copier au format Klaxoon » : une copie en attente, puis un `copy` déclenché dans le même geste, que `surCopie` remplit (REQ-155).
  function copierKlaxoon() {
    const klaxoon = versKlaxoon(doc, choisis);
    if (klaxoon === null) return;
    surface.focus({ preventScroll: true });
    effacerRefus();
    const attente = { klaxoon, copie: copier(doc, choisis), recu: false };
    enAttente = attente;
    let accepte = false;
    // L'événement `copy` part de l'élément où se trouve le curseur de sélection, parfois hors de la surface : on l'écoute sur le document le temps de la commande.
    document.addEventListener("copy", surCopie, true);
    try {
      accepte = document.execCommand("copy") === true;
    } catch {
      accepte = false;
    } finally {
      document.removeEventListener("copy", surCopie, true);
    }
    enAttente = null;
    if (!accepte || !attente.recu) {
      alerte.replaceChildren(...message({ texte: "Copie au format Klaxoon impossible : le navigateur a refusé l'accès au presse-papiers. Réessayez.", variante: "erreur", presentation: "flottante" }).childNodes);
      return;
    }
    presse = attente.copie;
    collages = 0;
    dernierTexte = klaxoon.texte;
    annoncer(`Copié au format Klaxoon : ${pluriel(klaxoon.boites, "boîte", "boîtes")}, ${klaxoon.liens === 0 ? "aucun lien" : pluriel(klaxoon.liens, "lien", "liens")}.`);
  }

  function ouvrirMenu(position) {
    surface.focus({ preventScroll: true });
    const m = menu({
      nom: "Actions sur la sélection",
      groupes: [[{ libelle: "Copier au format Klaxoon", desactive: !choisis.some((id) => boite(id) !== undefined), surChoix: copierKlaxoon }]],
      position,
      zone: element,
      surFermeture: () => {
        if (menuOuvert?.fermer !== m.fermer) return;
        menuOuvert = null;
        if (dessin) dessinerConnecteurs();
      },
    });
    menuOuvert = m;
    dessinerConnecteurs();
  }

  // Clavier : 4 px sous la première boîte choisie (sinon le premier objet choisi), sur son bord gauche ; rien de choisi : 12 px du coin de la zone.
  function departClavier() {
    const id = choisis.find((c) => boite(c) !== undefined) ?? premier();
    const e = id === null ? null : dessin.querySelector(`[data-id="${id}"]`);
    if (e) {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.bottom + 4 };
    }
    const z = element.getBoundingClientRect();
    return { x: z.left + 12, y: z.top + 12 };
  }

  // Clic droit sur la surface, hors saisie et hors glisser : le menu de Yaide, jamais celui du navigateur.
  function surMenuContextuel(e) {
    if (doc === null || saisie !== null || geste) return;
    e.preventDefault();
    effacerRefus();
    const connecteur = e.target.closest?.("[data-connecteur]");
    const g = e.target.closest?.("g.boite, g.lien, g.fleche");
    const id = connecteur ? connecteur.getAttribute("data-boite") : g?.getAttribute("data-id") ?? null;
    if (id !== null && !choisis.includes(id)) choisir(id);
    ouvrirMenu({ x: e.clientX, y: e.clientY });
  }

  function collerObjets() {
    if (!presse) return;
    const r = coller(doc, presse, ++collages);
    appliquer(r.doc);
    choisis = r.ids;
    ramener(premier());
    dessiner();
  }

  function surColler(e) {
    const seul = dessinSeul !== 0;
    dessinSeul = 0;
    if (doc === null || saisie !== null) return;
    e.preventDefault();
    collerTexte(e.clipboardData?.getData("text/plain") ?? "", seul);
  }

  function collerTexte(texte, seul) {
    if (doc === null || saisie !== null) return;
    const r = texte === dernierTexte ? null : depuisMermaid(texte);
    if (r === null) return collerObjets();
    effacerRefus();
    if (r.autre) return collerAutre(r.model, seul);
    if (r.refus) return refuser(r.refus);
    // Dessin seul : le document recréé garde le modèle du document courant (absent, il reste absent).
    if (seul) {
      const recree = { ...r.doc };
      delete recree.model;
      if (doc.model !== undefined) recree.model = doc.model;
      appliquer(recree);
    } else appliquer(r.doc);
    choisis = [];
    afficherTout();
    const n = r.doc.boxes.length;
    const l = r.doc.links.length;
    annoncer(`Diagramme mermaid collé : ${n} ${n > 1 ? "boîtes" : "boîte"}, ${l === 0 ? "aucun lien" : l === 1 ? "1 lien" : `${l} liens`}.`);
  }

  function refuser(texte) {
    alerte.replaceChildren(...message({ texte: `Diagramme mermaid non collé : ${texte}`, variante: "erreur", presentation: "flottante" }).childNodes);
  }

  // Autre type de diagramme : mermaid le dessine, puis le dessin est traduit en boîtes, textes et flèches libres (REQ-154, DEC-107).
  async function collerAutre(model, seul) {
    const zone = surface;
    zone.classList.add("ya-attente");
    let r;
    try {
      const mermaid = await chargerMermaid();
      r = await mermaid.traduire(model);
    } catch {
      r = { refus: "la bibliothèque mermaid n'a pas pu être chargée." };
    }
    zone.classList.remove("ya-attente");
    if (detruit || doc === null || zone !== surface) return;
    zone.focus({ preventScroll: true });
    if (r.refus) return refuser(r.refus);
    const recree = { ...r.doc };
    if (seul) {
      if (doc.model !== undefined) recree.model = doc.model;
    } else recree.model = model;
    appliquer(recree);
    choisis = [];
    afficherTout();
    const n = r.doc.boxes.length;
    const f = r.doc.arrows.length;
    annoncer(`Diagramme mermaid collé : ${pluriel(n, "boîte", "boîtes")}, ${f === 0 ? "aucune flèche libre" : pluriel(f, "flèche libre", "flèches libres")}.`);
  }

  function surClic(e) {
    if (sansClic) return;
    // Le connecteur du centre se comporte comme sa boîte : un clic dessus la choisit.
    const centre = e.target.closest?.('[data-connecteur="center"]');
    if (editeur?.contains(e.target) || (!centre && e.target.closest?.(".poignees, .connecteurs"))) return;
    const g = e.target.closest?.("g.boite, g.lien, g.fleche");
    const id = centre ? centre.getAttribute("data-boite") : g?.getAttribute("data-id") ?? null;
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
      pointeur = pointDessin(e);
      // Là où deux zones se touchent, le connecteur le plus proche du pointeur l'emporte.
      const cote = connecteurProcheAffiche(boite(id), pointeur, vueCourante.zoom);
      // Au centre, le geste attend : moins de 3 px, il agit comme un appui sur la boîte.
      if (cote === "center") {
        geste = { ...base, type: "liaison", id, cote };
        return;
      }
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
    const lien = lienChoisi();
    if ((poignee === "depart" || poignee === "arrivee") && lien) {
      capturer(e);
      surface.focus({ preventScroll: true });
      const [d, a] = boutsLien(lien);
      geste = { ...base, type: "boutLien", id: lien.id, bout: poignee, fixe: poignee === "depart" ? a : d, ends: lien.ends };
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
      }, geste);
    } else if (geste.type === "selection") {
      const p = pointDessin(e);
      geste.rect = { x: Math.min(geste.p0.x, p.x), y: Math.min(geste.p0.y, p.y), width: Math.abs(p.x - geste.p0.x), height: Math.abs(p.y - geste.p0.y) };
    } else if (geste.type === "taille") {
      const [minL, minH] = tailleMin(boite(geste.id).shape);
      const width = Math.max(minL, Math.round(geste.origine.width + dx / z));
      const height = Math.max(minH, Math.round(geste.origine.height + dy / z));
      appliquer({ ...doc, boxes: doc.boxes.map((b) => (b.id === geste.id ? { ...b, width, height } : b)) }, geste);
    } else if (geste.type === "bout") {
      const o = geste.origine;
      const [kx, ky] = geste.bout === "depart" ? ["x1", "y1"] : ["x2", "y2"];
      const f = { [kx]: Math.round(o[kx] + dx / z), [ky]: Math.round(o[ky] + dy / z) };
      appliquer({ ...doc, arrows: doc.arrows.map((a) => (a.id === geste.id ? { ...a, ...f } : a)) }, geste);
    } else if (geste.type === "boutLien") {
      pointeur = pointDessin(e);
      const autre = geste.bout === "depart" ? doc.links.find((l) => l.id === geste.id).to : doc.links.find((l) => l.id === geste.id).from;
      const [depart, arrivee] = geste.bout === "depart" ? [pointeur, geste.fixe] : [geste.fixe, pointeur];
      provisoire = { lien: true, ends: geste.ends, depart, arrivee };
      cible = boiteSous(pointeur, autre)?.id ?? null;
    } else if (geste.type === "forme") {
      formeProvisoire = rectangleTrace(geste.p0, pointDessin(e), choix.forme);
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
      const lien = { id: idLibre("l", doc), from: fin.id, to: cible, fromSide: fin.cote, toSide: connecteurProcheAffiche(boite(cible), pointDessin(e), vueCourante.zoom) };
      Object.assign(lien, styleChoisi("trait"));
      appliquer({ ...doc, links: [...doc.links, lien] });
      choisis = [lien.id];
      surface.focus({ preventScroll: true });
    }
    if (fin.type === "boutLien" && fin.actif && cible) {
      const nouveau = rattacher(doc, fin.id, fin.bout, cible, connecteurProcheAffiche(boite(cible), pointDessin(e), vueCourante.zoom));
      if (nouveau !== doc) appliquer(nouveau);
      surface.focus({ preventScroll: true });
    }
    if (fin.type === "liaison" && !fin.actif) {
      // Appui sans mouvement sur le connecteur du centre : le `click` qui suit choisit la boîte (surClic).
      annulerGeste();
      return;
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
      if (fin.actif) nouvelleBoite(0, 0, rectangleTrace(fin.p0, p, choix.forme));
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
    clore(geste);
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
    if (e.target.closest?.("g.fleche")) return;
    const l = e.target.closest?.("g.lien");
    if (l) {
      commencerSaisie(l.getAttribute("data-id"));
      return;
    }
    // Le connecteur du centre laisse passer le double-clic : la saisie de sa boîte.
    const p = pointDessin(e);
    const z = vueCourante.zoom;
    const centre = doc.boxes.find((x) => {
      const c = connecteursAffiches(x, z).center;
      return c && Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y)) <= 8 / z;
    });
    if (centre) {
      commencerSaisie(centre.id);
      return;
    }
    const b = e.target.closest?.("g.boite");
    if (b) {
      commencerSaisie(b.getAttribute("data-id"));
      return;
    }
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
    surTexte,
    surPosition,
    surEchap: () => surface?.focus({ preventScroll: true }),
  });
  barre.element.addEventListener("keydown", surHistorique);
  // Le refus d'un collage part au geste suivant sur la zone.
  for (const type of ["pointerdown", "wheel", "keydown"]) element.addEventListener(type, effacerRefus, { passive: true, capture: true });
  const surSelection = () => {
    if (saisie !== null) afficherOutils();
  };
  document.addEventListener("selectionchange", surSelection);
  const observateur = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => dessiner());
  observateur?.observe(element);
  monter();

  function afficherTout() {
    changerVue(calculerToutAfficher([...doc.boxes, ...(doc.arrows ?? []).map(rectangleFleche)], taille()));
    dessiner();
  }

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
      passes = [];
      aRefaire = [];
      dernierGroupe = null;
      doc = nouveau ?? null;
      choisis = doc === null ? [] : choisis.filter((id) => objet(id) !== undefined);
      if (avant || doc === null) monter();
      else dessiner();
    },
    definirTheme(nouveau) {
      if (nouveau === "light" || nouveau === "dark") element.dataset.theme = nouveau;
      else delete element.dataset.theme;
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
      afficherTout();
    },
    detruire() {
      detruit = true;
      menuOuvert?.fermer();
      observateur?.disconnect();
      document.removeEventListener("selectionchange", surSelection);
      element.remove();
    },
  };
}
