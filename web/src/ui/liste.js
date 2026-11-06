import { bouton } from "./bouton.js";
import { compteur as compteurDe } from "./compteur.js";
import { icone } from "./icones.js";
import { fermerInfoBulleDans } from "./info-bulle.js";

const VARIANTES = ["plate", "arbre"];
let compteur = 0;

// Mot dit par le nom accessible pour chaque statut git d'une ligne.
export const STATUTS = { A: "ajouté", M: "modifié", R: "renommé", D: "supprimé", U: "nouveau", C: "conflit" };
const STATUTS_DOSSIER = ["C", "D", "M", "A", "U"];

const CODE = ["rs", "py", "go", "c", "h", "cpp", "sh"];

/** Icône et couleur (jeton) d'un fichier selon son nom, d'après la table « Type de fichier » du design system. */
export function iconeDe(nom) {
  const point = nom.lastIndexOf(".");
  const ext = point > 0 ? nom.slice(point + 1).toLowerCase() : "";
  if (["js", "jsx", "ts", "tsx"].includes(ext)) return { icone: "file-code", couleur: "accent-fg" };
  if (ext === "css") return { icone: "file-code", couleur: "git-modified" };
  if (ext === "html") return { icone: "file-code", couleur: "syn-keyword" };
  if (CODE.includes(ext)) return { icone: "file-code", couleur: "ink-muted" };
  if (ext === "md" || ext === "markdown") return { icone: "md", couleur: "ink-muted" };
  if (ext === "json") return { icone: "file", couleur: "syn-number" };
  return { icone: "file", couleur: "ink-muted" };
}

function jeton(nom, champ) {
  if (!/^[a-z-]+$/.test(nom)) throw new Error(`liste : ${champ} invalide « ${nom} »`);
  return `var(--${nom})`;
}

/** Coupe `texte` en trois selon `[debut, fin[` (en caractères Unicode). */
function decouper(texte, [debut, fin]) {
  const c = Array.from(texte);
  return [c.slice(0, debut).join(""), c.slice(debut, fin).join(""), c.slice(fin).join("")];
}

export function liste({ variante = "plate", lignes, selection, multiple = false, courante: courantePrevue, ancre: ancrePrevue, surSelection, pilotage = "focus", champ, surActiver, surBasculer, surMenu, surDepot }) {
  if (!VARIANTES.includes(variante)) throw new Error(`liste : variante inconnue « ${variante} »`);
  if (pilotage === "champ" && !champ) throw new Error("liste : champ requis avec pilotage « champ »");
  for (const l of lignes) {
    if (!l.libelle) throw new Error("liste : libelle requis");
    if (l.statut !== undefined && !(l.statut in STATUTS)) throw new Error(`liste : statut inconnu « ${l.statut} »`);
    if (l.statutDossier !== undefined && !STATUTS_DOSSIER.includes(l.statutDossier)) throw new Error(`liste : statutDossier inconnu « ${l.statutDossier} »`);
  }
  if (surMenu && variante !== "arbre") throw new Error("liste : surMenu demande la variante « arbre »");
  if (surDepot && variante !== "arbre") throw new Error("liste : surDepot demande la variante « arbre »");
  if (multiple && variante !== "arbre") throw new Error("liste : multiple demande la variante « arbre »");
  const n = ++compteur;
  const arbre = variante === "arbre";
  const racine = document.createElement("div");
  racine.className = arbre ? "liste ya-tree" : "liste ya-row";
  racine.setAttribute("role", arbre ? "tree" : "listbox");
  if (multiple) racine.setAttribute("aria-multiselectable", "true");

  const donnees = lignes.filter((l) => !l.groupe);
  const elements = new Map();
  const ids = donnees.map((l) => l.id);
  // id -> id du dossier parent (undefined à la racine), déduit de `niveau`.
  const parents = new Map();
  const dernierParNiveau = [];
  for (const l of donnees) {
    const niveau = l.niveau ?? 0;
    parents.set(l.id, niveau > 0 ? dernierParNiveau[niveau - 1] : undefined);
    dernierParNiveau[niveau] = l.id;
  }
  const selectionnables = new Set(donnees.filter((l) => !l.sansMenu).map((l) => l.id));
  // Avec `multiple` : les lignes choisies, et le point de départ de Maj+clic.
  const choisies = new Set(multiple ? [].concat(selection ?? []).filter((id) => selectionnables.has(id)) : []);
  let ancre = ids.includes(ancrePrevue) ? ancrePrevue : ids.find((id) => choisies.has(id));
  let courante = multiple
    ? [courantePrevue, ids.find((id) => choisies.has(id))].find((id) => ids.includes(id)) ?? ids[0]
    : donnees.some((l) => l.id === selection) ? selection : donnees[0]?.id;
  // En mode focus, rien n'est sélectionné tant qu'on n'a pas choisi une ligne.
  let choisie = pilotage === "champ" || courante === selection;

  for (const l of lignes) {
    if (l.groupe) {
      const g = document.createElement("div");
      g.className = "liste-groupe";
      g.setAttribute("role", "presentation");
      if (l.icone) {
        const i = document.createElement("span");
        i.className = "liste-icone";
        if (l.couleurIcone) i.style.setProperty("--couleur-icone", jeton(l.couleurIcone, "couleurIcone"));
        i.append(icone(l.icone));
        g.append(i);
      }
      const nom = document.createElement("span");
      nom.className = "liste-groupe-nom";
      nom.textContent = l.libelle;
      g.append(nom);
      if (l.dossier) {
        const d = document.createElement("span");
        d.className = "liste-parent";
        d.textContent = l.dossier;
        g.append(d);
      }
      if (l.compteur !== undefined) {
        const c = compteurDe({ valeur: l.compteur });
        c.classList.add("liste-compteur");
        g.append(c);
      }
      racine.append(g);
      continue;
    }
    const e = document.createElement("div");
    e.id = `liste-${n}-${elements.size}`;
    e.className = "liste-ligne";
    e.setAttribute("role", arbre ? "treeitem" : "option");
    e.title = l.infoBulle ?? l.libelle;
    e.style.setProperty("--niveau", String(l.niveau ?? 0));
    if (l.policeCode) e.classList.add("liste-code");
    const etats = [];
    if (l.ignore) {
      e.classList.add("liste-attenuee");
      etats.push("ignoré par git");
    }
    if (l.statut) {
      e.classList.add(`liste-statut-${l.statut}`);
      etats.push(STATUTS[l.statut]);
    }
    if (l.statutDossier) {
      e.classList.add(`liste-sdossier-${l.statutDossier}`);
      etats.push(STATUTS[l.statutDossier]);
    }
    if (l.indexe) etats.push("indexé");
    if (etats.length) e.setAttribute("aria-label", [l.libelle, ...etats].join(", "));
    if (l.courant) e.setAttribute("aria-current", "true");
    if (l.numero !== undefined) e.classList.add("ya-hit");
    if (arbre) {
      e.setAttribute("aria-level", String((l.niveau ?? 0) + 1));
      if (l.enfants) e.setAttribute("aria-expanded", String(Boolean(l.ouvert)));
    }
    if (surDepot && !l.sansMenu) {
      e.setAttribute("draggable", "true");
      e.addEventListener("dragstart", (ev) => debuterGlisse(ev, l.id));
    }
    if (surMenu && !l.sansMenu) {
      e.setAttribute("aria-haspopup", "menu");
      e.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        if (ignorerContextmenu(ev)) return;
        seul(l.id);
        e.focus();
        surMenu(l.id, { x: ev.clientX, y: ev.clientY });
      });
    }
    if (l.actionLigne) {
      const a = l.actionLigne;
      const b = bouton({ libelle: a.libelle, icone: a.icone, nomAccessible: a.nomAccessible, infoBulle: a.infoBulle, raccourci: a.icone ? a.touche : undefined, variante: "discret", taille: "ligne" });
      b.tabIndex = -1;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        a.surClic?.(l.id);
      });
      if (a.touche) e.setAttribute("aria-keyshortcuts", a.touche);
      e.append(b.enveloppe ?? b);
    }
    function iconeLigne(defaut) {
      const i = document.createElement("span");
      i.className = `liste-icone ${defaut}`;
      i.append(icone(l.icone ?? (l.enfants ? "folder" : "file")));
      if (l.couleurIcone) i.style.setProperty("--couleur-icone", jeton(l.couleurIcone, "couleurIcone"));
      return i;
    }
    if (l.numero !== undefined) {
      const n = document.createElement("span");
      n.className = "liste-numero";
      n.textContent = String(l.numero);
      e.append(n);
    }
    if (arbre && pilotage !== "champ") {
      // Chevron (place vide pour un fichier), puis icône du dossier ou du fichier.
      const c = document.createElement("span");
      c.className = "liste-chevron";
      if (l.enfants) c.append(icone("chevron"));
      e.append(c, iconeLigne(l.enfants ? "liste-dossier" : "liste-fichier"));
    } else if (l.icone) e.append(iconeLigne("liste-fichier"));
    const t = document.createElement("span");
    t.className = "liste-libelle";
    if (l.trouve) {
      const [avant, trouve, apres] = decouper(l.libelle, l.trouve);
      const b = document.createElement(l.numero !== undefined ? "mark" : "b");
      b.className = "liste-trouve";
      b.textContent = trouve;
      t.append(avant, b, apres);
    } else t.textContent = l.libelle;
    e.append(t);
    if (l.dossier) {
      const d = document.createElement("span");
      d.className = "liste-parent";
      d.textContent = l.dossier;
      e.append(d);
    }
    if (l.fin) {
      const f = document.createElement("span");
      f.className = "liste-fin ya-fin";
      f.textContent = l.fin;
      e.append(f);
    }
    if (l.statut) {
      const m = document.createElement("span");
      m.className = "liste-statut";
      m.setAttribute("aria-hidden", "true");
      m.textContent = l.statut;
      e.append(m);
    } else if (l.statutDossier) {
      const m = document.createElement("span");
      m.className = "liste-point";
      m.setAttribute("aria-hidden", "true");
      e.append(m);
    }
    e.addEventListener("click", (ev) => {
      // Un clic sur une action désactivée (pointer-events: none) retombe sur la ligne : il ne l'active pas.
      if (ev.target.closest?.(".bouton-enveloppe")) return;
      if (multiple) {
        if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
          if (!selectionnables.has(l.id)) return;
          if (ev.shiftKey) {
            const a = ids.indexOf(ancre ?? courante);
            const b = ids.indexOf(l.id);
            changer(ids.slice(Math.min(a, b), Math.max(a, b) + 1).filter((id) => selectionnables.has(id)), ancre ?? courante, l.id);
          } else {
            const voulues = new Set(choisies);
            if (!voulues.delete(l.id)) voulues.add(l.id);
            changer(ids.filter((id) => voulues.has(id)), l.id, l.id);
          }
          courante = l.id;
          peindre();
          e.focus();
          return;
        }
        if (selectionnables.has(l.id)) seul(l.id);
        else marquer(l.id);
        e.focus();
      } else marquer(l.id);
      surActiver?.(l.id);
    });
    elements.set(l.id, e);
    racine.append(e);
  }

  // Remplace la sélection (multiple) et prévient la vue.
  function changer(liste, depart, derniere) {
    choisies.clear();
    for (const id of liste) choisies.add(id);
    ancre = depart;
    surSelection?.(ids.filter((id) => choisies.has(id)), { ancre, derniere });
  }

  function seul(id) {
    if (!selectionnables.has(id)) return marquer(id);
    changer([id], id, id);
    marquer(id);
  }

  function peindre() {
    const plusieurs = choisies.size >= 2;
    for (const [i, e] of elements) {
      e.setAttribute("aria-selected", String(choisies.has(i)));
      e.tabIndex = i === courante ? 0 : -1;
      const coche = e.querySelector(":scope > .liste-coche");
      if (plusieurs && choisies.has(i)) {
        if (coche) continue;
        const c = document.createElement("span");
        c.className = "liste-coche";
        c.setAttribute("aria-hidden", "true");
        c.append(icone("check", 12));
        e.insertBefore(c, e.querySelector(":scope > .liste-statut, :scope > .liste-point"));
      } else coche?.remove();
    }
  }

  function marquer(id) {
    courante = id;
    if (multiple) return peindre();
    choisie = true;
    for (const [i, e] of elements) {
      const c = i === id;
      e.setAttribute("aria-selected", String(c && choisie));
      e.classList.toggle("liste-courante", pilotage === "champ" && c);
      e.tabIndex = pilotage === "focus" && c ? 0 : -1;
    }
    if (pilotage === "champ" && elements.has(id)) {
      champ.setAttribute("aria-activedescendant", elements.get(id).id);
      elements.get(id).scrollIntoView?.({ block: "nearest" });
    }
  }

  // Glisser-déposer du navigateur : les lignes viennent de la fermeture, jamais de `dataTransfer`.
  const AUCUNE = Symbol("aucune");
  let glisse = null; // { lignes, saisie, image, marque }

  function ancetreDans(id, ensemble) {
    for (let p = parents.get(id); p !== undefined; p = parents.get(p)) if (ensemble.has(p)) return true;
    return false;
  }

  function debuterGlisse(ev, saisie) {
    if (!ev.dataTransfer) return;
    finirGlisse();
    const voulues = multiple && choisies.has(saisie) ? new Set(choisies) : new Set([saisie]);
    const lignesADeplacer = ids.filter((id) => voulues.has(id) && !ancetreDans(id, voulues));
    const dt = ev.dataTransfer;
    dt.effectAllowed = "move";
    dt.setData("application/x-yaide-lignes", JSON.stringify(lignesADeplacer));
    const image = document.createElement("div");
    image.className = "ya-glisse";
    image.setAttribute("aria-hidden", "true");
    const nom = document.createElement("span");
    nom.className = "liste-libelle";
    if (lignesADeplacer.length === 1) {
      const source = elements.get(lignesADeplacer[0]);
      const i = source.querySelector(".liste-icone");
      if (i) image.append(i.cloneNode(true));
      nom.textContent = source.querySelector(".liste-libelle").textContent;
    } else {
      const i = document.createElement("span");
      i.className = "liste-icone";
      i.append(icone("files"));
      image.append(i);
      nom.textContent = `${lignesADeplacer.length} éléments`;
    }
    image.append(nom);
    document.body.append(image);
    dt.setDragImage?.(image, 12, 12);
    fermerInfoBulleDans(document.body);
    elements.get(saisie).focus();
    glisse = { lignes: lignesADeplacer, saisie, image, marque: AUCUNE };
    document.addEventListener("dragenter", survol, true);
    document.addEventListener("dragover", survol, true);
    document.addEventListener("drop", deposer, true);
  }

  // Dossier visé par l'événement : { cible } ou null si le dépôt est refusé.
  function viser(ev) {
    const cibleDom = ev.target;
    if (!racine.contains(cibleDom)) return null;
    const ligne = cibleDom.closest?.(".liste-ligne");
    let cible;
    if (ligne) {
      const id = [...elements].find(([, e]) => e === ligne)[0];
      if (donnees.find((l) => l.id === id).sansMenu) return null;
      cible = donnees.find((l) => l.id === id).enfants ? id : parents.get(id);
    }
    const partants = new Set(glisse.lignes);
    if (cible !== undefined && (partants.has(cible) || ancetreDans(cible, partants))) return null;
    if (glisse.lignes.every((id) => parents.get(id) === cible)) return null;
    return { cible };
  }

  function retirerMarques() {
    if (!glisse) return;
    glisse.marque = AUCUNE;
    racine.removeAttribute("data-depot");
    for (const e of elements.values()) {
      e.removeAttribute("data-depot");
      e.removeAttribute("data-depot-contenu");
    }
  }

  function survol(ev) {
    ev.stopPropagation();
    const v = viser(ev);
    if (!v) return retirerMarques();
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    if (glisse.marque === v.cible) return;
    retirerMarques();
    glisse.marque = v.cible;
    if (v.cible === undefined) return racine.setAttribute("data-depot", "");
    elements.get(v.cible).setAttribute("data-depot", "");
    const niveau = donnees.find((l) => l.id === v.cible).niveau ?? 0;
    for (let j = ids.indexOf(v.cible) + 1; j < donnees.length && (donnees[j].niveau ?? 0) > niveau; j++) elements.get(donnees[j].id).setAttribute("data-depot-contenu", "");
  }

  function deposer(ev) {
    ev.stopPropagation();
    const v = viser(ev);
    if (!v) return;
    ev.preventDefault();
    const { lignes: partantes, saisie } = glisse;
    finirGlisse();
    surDepot(partantes, v.cible, saisie);
  }

  function finirGlisse() {
    if (!glisse) return;
    retirerMarques();
    document.removeEventListener("dragenter", survol, true);
    document.removeEventListener("dragover", survol, true);
    document.removeEventListener("drop", deposer, true);
    glisse.image.remove();
    glisse = null;
  }

  if (surDepot) {
    racine.addEventListener("dragend", finirGlisse);
    racine.addEventListener("dragleave", (ev) => {
      if (!ev.relatedTarget) retirerMarques();
    });
  }

  // Le navigateur envoie aussi `contextmenu` après la touche Menu ou Maj+F10 : une seule ouverture.
  let cleRecente = false;
  let minuteur;
  function ignorerContextmenu(ev) {
    return cleRecente && ev.button !== 2;
  }
  if (surMenu) {
    racine.addEventListener("pointerdown", () => {
      cleRecente = false;
    });
    // Partie vide de la liste : la ligne est absente. Une ligne qui a déjà traité l'événement l'a annulé.
    racine.addEventListener("contextmenu", (ev) => {
      if (ev.defaultPrevented) return;
      ev.preventDefault();
      if (ignorerContextmenu(ev)) return;
      surMenu(undefined, { x: ev.clientX, y: ev.clientY });
    });
  }

  // Retourne true si la touche a été traitée.
  function touche(e, id) {
    const i = ids.indexOf(id);
    let cible;
    if (e.key === "ArrowDown") cible = ids[Math.min(i + 1, ids.length - 1)];
    else if (e.key === "ArrowUp") cible = ids[Math.max(i - 1, 0)];
    else if (e.key === "Home") cible = ids[0];
    else if (e.key === "End") cible = ids[ids.length - 1];
    else if (surMenu && !donnees[i].sansMenu && (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) {
      e.preventDefault();
      cleRecente = true;
      clearTimeout(minuteur);
      minuteur = setTimeout(() => (cleRecente = false), 500);
      seul(id);
      const el = elements.get(id);
      el.focus();
      const r = el.getBoundingClientRect();
      const nom = el.querySelector(".liste-libelle").getBoundingClientRect();
      surMenu(id, { x: nom.left, y: r.bottom });
      return;
    } else if (pilotage === "focus" && donnees[i].actionLigne?.touche?.toLowerCase() === e.key.toLowerCase()) {
      e.preventDefault();
      donnees[i].actionLigne.surClic?.(id);
      return;
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (multiple) seul(id);
      surActiver?.(id);
      return;
    } else if (arbre && pilotage === "focus" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const l = donnees[i];
      e.preventDefault();
      if (e.key === "ArrowRight") {
        if (l.enfants && !l.ouvert) surBasculer?.(id, true);
      } else if (l.enfants && l.ouvert) {
        // Les lignes que Gauche masque quittent la sélection.
        if (multiple) {
          const niveau = l.niveau ?? 0;
          const masquees = new Set();
          for (let j = i + 1; j < donnees.length && (donnees[j].niveau ?? 0) > niveau; j++) masquees.add(donnees[j].id);
          if (ids.some((x) => choisies.has(x) && masquees.has(x))) changer(ids.filter((x) => choisies.has(x) && !masquees.has(x)), ancre, id);
          peindre();
        }
        surBasculer?.(id, false);
      } else {
        const niveau = l.niveau ?? 0;
        for (let j = i - 1; j >= 0 && niveau > 0; j--) {
          if ((donnees[j].niveau ?? 0) < niveau) {
            seul(donnees[j].id);
            elements.get(donnees[j].id).focus();
            break;
          }
        }
      }
      return;
    } else return;
    e.preventDefault();
    if (cible === undefined) return;
    seul(cible);
    if (pilotage === "focus") elements.get(cible).focus();
  }

  if (pilotage === "champ") champ.addEventListener("keydown", (e) => racine.isConnected && courante !== undefined && touche(e, courante));
  else for (const [id, e] of elements) e.addEventListener("keydown", (ev) => touche(ev, id));

  if (multiple) {
    racine.addEventListener("focusin", (ev) => {
      const id = [...elements].find(([, e]) => e === ev.target.closest(".liste-ligne"))?.[0];
      if (id === undefined) return;
      courante = id;
      for (const [i, e] of elements) e.tabIndex = i === id ? 0 : -1;
    });
    peindre();
  } else if (courante !== undefined) {
    const initiale = choisie;
    marquer(courante);
    choisie = initiale;
    if (!initiale) for (const e of elements.values()) e.setAttribute("aria-selected", "false");
  }
  return racine;
}
