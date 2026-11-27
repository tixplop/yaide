import { icone } from "./icones.js";
import { indication } from "./indication.js";
import { message } from "./message.js";
import { TYPE_GLISSE, panneauNoeuds } from "./workflow-panneau.js";
import { HAUTEUR_NOEUD, LARGEUR_NOEUD, TYPES, ajouter, deplacer, estDeclencheur, lienPermis, lier, montrer, phraseDuChoix, retirer, zoomer } from "../workflow.js";

const NS = "http://www.w3.org/2000/svg";
const PAS_FLECHE = 20;

/** C-019 : surface de l'éditeur de workflow. `maj(props)` remplace document, vue, choix ou lectureSeule. */
export function workflow({ nom, document: doc, vue = { x: 0, y: 0, zoom: 1 }, choix = null, lectureSeule = false, enCours = null, resultat = null, agents = [], surChangement, surVue, surChoix, surEntree }) {
  if (!nom) throw new Error("workflow : nom requis");
  if (typeof surChangement !== "function") throw new Error("workflow : surChangement requis");
  const etat = { doc, vue, choix, lectureSeule, enCours, agents };
  let messageResultat = null;
  let glisse = null; // { id, dx, dy, x, y, bouge }
  let trace = null; // { de, x, y, cible }
  let fond = null; // { x, y, vue }

  const racine = document.createElement("div");
  racine.className = "ya-wf";
  const surface = document.createElement("div");
  surface.className = "ya-wf-surface";
  surface.tabIndex = 0;
  surface.setAttribute("aria-label", `Surface du workflow ${nom}`);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "ya-wf-liens");
  svg.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML = '<marker id="ya-wf-pointe" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="ya-wf-pointe" d="M0 0L8 4L0 8z"/></marker>';
  svg.append(defs);
  const monde = document.createElement("div");
  monde.className = "ya-wf-monde";
  const vide = document.createElement("div");
  vide.className = "ya-wf-vide";
  vide.append(indication({ texte: "Ajoutez un déclencheur depuis le panneau Nœuds." }));
  surface.append(svg, monde, vide);
  const statut = document.createElement("div");
  statut.className = "ya-wf-statut";
  statut.setAttribute("role", "status");
  const rangee = document.createElement("div");
  rangee.className = "ya-wf-rangee";
  const panneau = panneauNoeuds({
    document: doc,
    choix,
    lectureSeule,
    agents,
    surChangement: (d) => changerDoc(d),
    surAjout: (type) => ajouterType(type),
    surRetirer: () => retirerChoix(),
    surEchap: () => {
      choisir(null);
      surface.focus();
    },
  });
  rangee.append(surface, panneau);
  // Bandeau de suivi : le message et la ligne d'état sont deux zones `role="status"` séparées.
  const lecture = message({ texte: "Workflow publié : dépubliez-le pour le modifier." });
  lecture.classList.add("ya-wf-lecture-message");
  lecture.removeAttribute("role");
  lecture.querySelector(".message-texte").setAttribute("role", "status");
  const ligneEtat = document.createElement("span");
  ligneEtat.className = "ya-wf-etat";
  ligneEtat.setAttribute("role", "status");
  lecture.append(ligneEtat);
  racine.append(lecture, rangee, statut);

  const pos = (n) => (glisse && glisse.id === n.id ? { x: glisse.x, y: glisse.y } : { x: n.x, y: n.y });
  const noeud = (id) => etat.doc.noeuds.find((n) => n.id === id);
  const local = (ev) => {
    const r = surface.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const monde2 = (ev) => {
    const p = local(ev);
    return { x: (p.x - etat.vue.x) / etat.vue.zoom, y: (p.y - etat.vue.y) / etat.vue.zoom };
  };

  function changerVue(v) {
    etat.vue = v;
    placer();
    surVue?.(v);
  }
  function changerDoc(d) {
    if (etat.lectureSeule || d === etat.doc) return;
    etat.doc = d;
    surChangement(d);
    rendre();
  }
  function choisir(id, { montrerLe = false } = {}) {
    etat.choix = id;
    if (montrerLe && id) revele();
    rendre();
    surChoix?.(id);
  }
  // Ajout depuis le panneau ou par dépôt (`position` : coin haut gauche) : le nœud est choisi et son premier champ prend le focus.
  function ajouterType(type, position = null) {
    if (etat.lectureSeule) return;
    const r = ajouter(etat.doc, type, { apres: etat.choix, vue: etat.vue, position });
    changerDoc(r.doc);
    choisir(r.id, { montrerLe: true });
    panneau.focusPremierChamp();
  }
  function retirerChoix() {
    if (etat.lectureSeule || !etat.choix) return;
    const id = etat.choix;
    etat.choix = null;
    changerDoc(retirer(etat.doc, id));
    surChoix?.(null);
    rendre();
    surface.focus();
  }
  function revele() {
    const n = noeud(etat.choix);
    const l = surface.clientWidth;
    const h = surface.clientHeight;
    if (!n || !l || !h) return;
    const v = montrer(etat.vue, n, l, h);
    if (v.x !== etat.vue.x || v.y !== etat.vue.y) changerVue(v);
  }

  const courbe = (a, b) => {
    const poignee = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M${a.x} ${a.y}C${a.x + poignee} ${a.y} ${b.x - poignee} ${b.y} ${b.x} ${b.y}`;
  };
  const sortie = (n) => {
    const p = pos(n);
    const { x, y, zoom } = etat.vue;
    return { x: (p.x + LARGEUR_NOEUD) * zoom + x, y: (p.y + HAUTEUR_NOEUD / 2) * zoom + y };
  };
  const entree = (n) => {
    const p = pos(n);
    const { x, y, zoom } = etat.vue;
    return { x: p.x * zoom + x, y: (p.y + HAUTEUR_NOEUD / 2) * zoom + y };
  };

  function placer() {
    const { x, y, zoom } = etat.vue;
    surface.style.setProperty("--zoom", String(zoom));
    monde.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    for (const el of monde.children) {
      const n = noeud(el.dataset.id);
      if (!n) continue;
      const p = pos(n);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    }
    svg.querySelectorAll("path.ya-wf-lien, path.ya-wf-trace").forEach((p) => p.remove());
    for (const l of etat.doc.liens) {
      const a = noeud(l.de);
      const b = noeud(l.vers);
      if (!a || !b) continue;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("class", "ya-wf-lien");
      p.setAttribute("d", courbe(sortie(a), entree(b)));
      p.setAttribute("marker-end", "url(#ya-wf-pointe)");
      p.dataset.de = l.de;
      p.dataset.vers = l.vers;
      svg.append(p);
    }
    if (trace) {
      const a = noeud(trace.de);
      const p = document.createElementNS(NS, "path");
      p.setAttribute("class", "ya-wf-trace");
      p.setAttribute("d", courbe(sortie(a), { x: trace.x * zoom + x, y: trace.y * zoom + y }));
      svg.append(p);
    }
  }

  function rendre() {
    monde.replaceChildren();
    vide.hidden = etat.doc.noeuds.length > 0;
    racine.classList.toggle("ya-wf-lecture", etat.lectureSeule);
    lecture.hidden = !etat.lectureSeule;
    const courant = etat.enCours ? noeud(etat.enCours) : null;
    const etatTexte = courant ? `En cours : ${courant.titre}.` : "En attente d'un évènement.";
    if (ligneEtat.textContent !== etatTexte) ligneEtat.textContent = etatTexte;
    ligneEtat.title = etatTexte;
    ligneEtat.classList.toggle("ya-wf-etat-attente", !courant);
    panneau.maj({ document: etat.doc, choix: etat.choix && noeud(etat.choix) ? etat.choix : null, lectureSeule: etat.lectureSeule, agents: etat.agents });
    for (const n of etat.doc.noeuds) {
      const t = TYPES[n.type];
      const el = document.createElement("div");
      el.className = "ya-noeud";
      el.dataset.id = n.id;
      el.dataset.type = n.type;
      if (estDeclencheur(n)) el.classList.add("ya-noeud-declencheur");
      if (n.id === etat.choix) {
        el.classList.add("ya-noeud-choisi");
        el.setAttribute("aria-current", "true");
      }
      if (courant && courant.id === n.id) {
        el.classList.add("ya-noeud-en-cours");
        const marque = document.createElement("span");
        marque.className = "ya-noeud-etiquette";
        marque.setAttribute("aria-hidden", "true");
        marque.textContent = "En cours";
        el.append(marque);
      }
      if (trace && trace.cible === n.id) el.classList.add("ya-noeud-cible");
      else if (trace && trace.survol === n.id) el.classList.add("ya-noeud-refuse");
      const texte = document.createElement("div");
      texte.className = "ya-noeud-texte";
      const type = document.createElement("span");
      type.className = "ya-noeud-type";
      type.textContent = t.nom;
      const titre = document.createElement("span");
      titre.className = "ya-noeud-titre";
      titre.textContent = n.titre;
      titre.title = n.titre;
      texte.append(type, titre);
      el.append(icone(t.icone, 20), texte);
      if (!estDeclencheur(n)) {
        const e = document.createElement("span");
        e.className = "ya-noeud-point ya-noeud-entree";
        el.append(e);
      }
      const s = document.createElement("span");
      s.className = "ya-noeud-point ya-noeud-sortie";
      el.append(s);
      monde.append(el);
    }
    // La zone ne relit rien quand l'exécution avance : elle n'est réécrite que si sa phrase change.
    const phrase = etat.choix && noeud(etat.choix) ? phraseDuChoix(etat.doc, etat.choix) + (etat.choix === courant?.id ? " En cours." : "") : "";
    if (statut.textContent !== phrase) statut.textContent = phrase;
    placer();
  }

  // Nœud sous le pointeur ; l'entrée d'une action déborde de 8 px à gauche.
  function noeudSous(ev) {
    const p = monde2(ev);
    const marge = 8 / etat.vue.zoom;
    return etat.doc.noeuds.find((m) => p.x >= m.x - (estDeclencheur(m) ? 0 : marge) && p.x <= m.x + LARGEUR_NOEUD && p.y >= m.y && p.y <= m.y + HAUTEUR_NOEUD);
  }
  function cibleSous(ev) {
    const n = noeudSous(ev);
    return n && lienPermis(etat.doc, trace.de, n.id) ? n.id : null;
  }

  surface.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const el = ev.target.closest?.(".ya-noeud");
    surface.setPointerCapture?.(ev.pointerId);
    if (!el) {
      const p = local(ev);
      fond = { x: p.x, y: p.y, vue: etat.vue };
      return;
    }
    ev.preventDefault();
    surface.focus({ preventScroll: true });
    const n = noeud(el.dataset.id);
    if (etat.choix !== n.id) choisir(n.id);
    if (etat.lectureSeule) return;
    const w = monde2(ev);
    if (ev.target.classList.contains("ya-noeud-sortie")) {
      trace = { de: n.id, x: w.x, y: w.y, cible: null };
    } else {
      glisse = { id: n.id, dx: w.x - n.x, dy: w.y - n.y, x: n.x, y: n.y, bouge: false };
    }
  });
  surface.addEventListener("pointermove", (ev) => {
    if (fond) {
      const p = local(ev);
      changerVue({ ...fond.vue, x: fond.vue.x + p.x - fond.x, y: fond.vue.y + p.y - fond.y });
    } else if (glisse) {
      const w = monde2(ev);
      glisse.x = w.x - glisse.dx;
      glisse.y = w.y - glisse.dy;
      glisse.bouge = true;
      placer();
    } else if (trace) {
      const w = monde2(ev);
      trace.x = w.x;
      trace.y = w.y;
      const c = cibleSous(ev);
      const survol = noeudSous(ev)?.id ?? null;
      if (c !== trace.cible || survol !== trace.survol) {
        trace.cible = c;
        trace.survol = survol;
        rendre();
      } else placer();
    }
  });
  const fin = (ev) => {
    if (fond) {
      fond = null;
    } else if (glisse) {
      const g = glisse;
      glisse = null;
      if (g.bouge) changerDoc(deplacer(etat.doc, g.id, g.x, g.y));
      else placer();
    } else if (trace) {
      const c = cibleSous(ev);
      const de = trace.de;
      trace = null;
      if (c) changerDoc(lier(etat.doc, de, c));
      rendre();
    }
  };

  surface.addEventListener("pointerup", fin);
  surface.addEventListener("pointercancel", () => {
    glisse = null;
    trace = null;
    fond = null;
    rendre();
  });
  surface.addEventListener("dragover", (ev) => {
    if (etat.lectureSeule || !ev.dataTransfer?.types?.includes(TYPE_GLISSE)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
  });
  surface.addEventListener("drop", (ev) => {
    const type = ev.dataTransfer?.getData(TYPE_GLISSE);
    if (!type || etat.lectureSeule) return;
    ev.preventDefault();
    const w = monde2(ev);
    ajouterType(type, { x: w.x - LARGEUR_NOEUD / 2, y: w.y - HAUTEUR_NOEUD / 2 });
  });
  surface.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    const p = local(ev);
    changerVue(zoomer(etat.vue, ev.deltaY < 0 ? 1 : -1, p.x, p.y));
  });

  function suivant(sens) {
    const ids = etat.doc.noeuds.map((n) => n.id);
    const i = ids.indexOf(etat.choix);
    const j = i === -1 ? (sens > 0 ? 0 : ids.length - 1) : i + sens;
    if (j < 0 || j >= ids.length) return false;
    choisir(ids[j], { montrerLe: true });
    return true;
  }
  surface.addEventListener("keydown", (ev) => {
    if (ev.target !== surface || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const ro = etat.lectureSeule;
    if (ev.key === "Tab") {
      if (suivant(ev.shiftKey ? -1 : 1)) ev.preventDefault();
    } else if (ev.key === "Enter") {
      if (etat.choix) {
        ev.preventDefault();
        surEntree?.(etat.choix);
        panneau.focusTitre();
      }
    } else if (ev.key === "Escape") {
      if (etat.choix) {
        ev.preventDefault();
        choisir(null);
      }
      surface.focus();
    } else if (ev.key === "Delete") {
      if (!ro && etat.choix) {
        ev.preventDefault();
        retirerChoix();
      }
    } else if (ev.key.startsWith("Arrow")) {
      if (!ro && etat.choix) {
        ev.preventDefault();
        const n = noeud(etat.choix);
        const dx = ev.key === "ArrowLeft" ? -PAS_FLECHE : ev.key === "ArrowRight" ? PAS_FLECHE : 0;
        const dy = ev.key === "ArrowUp" ? -PAS_FLECHE : ev.key === "ArrowDown" ? PAS_FLECHE : 0;
        changerDoc(deplacer(etat.doc, n.id, n.x + dx, n.y + dy));
      }
    }
  });

  // Le message de résultat (C-003 `fermable`), sous le bandeau ; un seul à la fois ; sa croix rend le focus à la surface.
  function poserResultat(m) {
    messageResultat?.remove();
    messageResultat = m;
    if (!m) return;
    m.classList.add("ya-wf-resultat");
    lecture.after(m);
    m.querySelector("button")?.addEventListener("click", () => {
      if (messageResultat === m) messageResultat = null;
      surface.focus();
    });
  }

  racine.maj = (p) => {
    const ancien = etat.choix;
    if ("document" in p) etat.doc = p.document;
    if ("vue" in p) etat.vue = p.vue;
    if ("choix" in p) etat.choix = p.choix;
    if ("lectureSeule" in p) etat.lectureSeule = p.lectureSeule;
    if ("enCours" in p) etat.enCours = p.enCours;
    if ("agents" in p) etat.agents = p.agents;
    if ("resultat" in p) poserResultat(p.resultat);
    if (etat.choix && !noeud(etat.choix)) etat.choix = null;
    rendre();
    if (etat.choix && etat.choix !== ancien) revele();
  };
  racine.surface = surface;
  if (resultat) poserResultat(resultat);
  rendre();
  return racine;
}
