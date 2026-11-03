import { bouton } from "./bouton.js";
import { icone } from "./icones.js";

const VARIANTES = ["plate", "arbre"];
let compteur = 0;

/** Coupe `texte` en trois selon `[debut, fin[` (en caractères Unicode). */
function decouper(texte, [debut, fin]) {
  const c = Array.from(texte);
  return [c.slice(0, debut).join(""), c.slice(debut, fin).join(""), c.slice(fin).join("")];
}

export function liste({ variante = "plate", lignes, selection, pilotage = "focus", champ, surActiver, surBasculer, surMenu }) {
  if (!VARIANTES.includes(variante)) throw new Error(`liste : variante inconnue « ${variante} »`);
  if (pilotage === "champ" && !champ) throw new Error("liste : champ requis avec pilotage « champ »");
  for (const l of lignes) if (!l.libelle) throw new Error("liste : libelle requis");
  if (surMenu && variante !== "arbre") throw new Error("liste : surMenu demande la variante « arbre »");
  const n = ++compteur;
  const arbre = variante === "arbre";
  const racine = document.createElement("div");
  racine.className = "liste";
  racine.setAttribute("role", arbre ? "tree" : "listbox");

  const donnees = lignes.filter((l) => !l.groupe);
  const elements = new Map();
  let courante = donnees.some((l) => l.id === selection) ? selection : donnees[0]?.id;
  // En mode focus, rien n'est sélectionné tant qu'on n'a pas choisi une ligne.
  let choisie = pilotage === "champ" || courante === selection;

  for (const l of lignes) {
    if (l.groupe) {
      const g = document.createElement("div");
      g.className = "liste-groupe";
      g.setAttribute("role", "presentation");
      g.textContent = l.libelle;
      racine.append(g);
      continue;
    }
    const e = document.createElement("div");
    e.id = `liste-${n}-${elements.size}`;
    e.className = "liste-ligne";
    e.setAttribute("role", arbre ? "treeitem" : "option");
    e.title = l.libelle;
    e.style.setProperty("--niveau", String(l.niveau ?? 0));
    if (l.policeCode) e.classList.add("liste-code");
    if (l.attenuee) {
      e.classList.add("liste-attenuee");
      e.setAttribute("aria-label", `${l.libelle}, ignoré par git`);
    }
    if (arbre) {
      e.setAttribute("aria-level", String((l.niveau ?? 0) + 1));
      if (l.enfants) e.setAttribute("aria-expanded", String(Boolean(l.ouvert)));
    }
    if (surMenu && !l.sansMenu) {
      e.setAttribute("aria-haspopup", "menu");
      e.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        if (ignorerContextmenu(ev)) return;
        marquer(l.id);
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
    if (pilotage === "champ") e.append(Object.assign(document.createElement("span"), { className: "liste-marque" }));
    else if (arbre) {
      // Chevron (place vide pour un fichier), puis icône du dossier ou du fichier.
      const c = document.createElement("span");
      c.className = "liste-chevron";
      if (l.enfants) c.append(icone(l.ouvert ? "chevron-down" : "chevron-right"));
      const i = document.createElement("span");
      i.className = `liste-icone ${l.enfants ? "liste-dossier" : "liste-fichier"}`;
      i.append(icone(l.enfants ? "folder" : "file"));
      e.append(c, i);
    }
    e.querySelector(":scope > .liste-marque")?.setAttribute("aria-hidden", "true");
    const t = document.createElement("span");
    t.className = "liste-libelle";
    if (l.trouve) {
      const [avant, trouve, apres] = decouper(l.libelle, l.trouve);
      const b = document.createElement("b");
      b.className = "liste-trouve";
      b.textContent = trouve;
      t.append(avant, b, apres);
    } else t.textContent = l.libelle;
    e.append(t);
    if (l.secondaire) {
      const s = document.createElement("span");
      s.className = "liste-secondaire";
      s.textContent = l.secondaire;
      if (l.couleurSecondaire) {
        if (!/^[a-z-]+$/.test(l.couleurSecondaire)) throw new Error(`liste : couleurSecondaire invalide « ${l.couleurSecondaire} »`);
        s.style.setProperty("--couleur-secondaire", `var(--${l.couleurSecondaire})`);
      }
      if (l.secondaireFort) s.classList.add("liste-secondaire-fort");
      e.append(s);
    }
    e.addEventListener("click", (ev) => {
      // Un clic sur une action désactivée (pointer-events: none) retombe sur la ligne : il ne l'active pas.
      if (ev.target.closest?.(".bouton-enveloppe")) return;
      marquer(l.id);
      surActiver?.(l.id);
    });
    elements.set(l.id, e);
    racine.append(e);
  }

  function marquer(id) {
    courante = id;
    choisie = true;
    for (const [i, e] of elements) {
      const c = i === id;
      e.setAttribute("aria-selected", String(c && choisie));
      e.classList.toggle("liste-courante", pilotage === "champ" && c);
      e.tabIndex = pilotage === "focus" && c ? 0 : -1;
      const m = e.querySelector(":scope > .liste-marque");
      if (m && pilotage === "champ") m.textContent = c ? ">" : "";
    }
    if (pilotage === "champ" && elements.has(id)) {
      champ.setAttribute("aria-activedescendant", elements.get(id).id);
      elements.get(id).scrollIntoView?.({ block: "nearest" });
    }
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

  const ids = donnees.map((l) => l.id);
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
      marquer(id);
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
      surActiver?.(id);
      return;
    } else if (arbre && pilotage === "focus" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const l = donnees[i];
      e.preventDefault();
      if (e.key === "ArrowRight") {
        if (l.enfants && !l.ouvert) surBasculer?.(id, true);
      } else if (l.enfants && l.ouvert) surBasculer?.(id, false);
      else {
        const niveau = l.niveau ?? 0;
        for (let j = i - 1; j >= 0 && niveau > 0; j--) {
          if ((donnees[j].niveau ?? 0) < niveau) {
            marquer(donnees[j].id);
            elements.get(donnees[j].id).focus();
            break;
          }
        }
      }
      return;
    } else return;
    e.preventDefault();
    if (cible === undefined) return;
    marquer(cible);
    if (pilotage === "focus") elements.get(cible).focus();
  }

  if (pilotage === "champ") champ.addEventListener("keydown", (e) => racine.isConnected && courante !== undefined && touche(e, courante));
  else for (const [id, e] of elements) e.addEventListener("keydown", (ev) => touche(ev, id));

  if (courante !== undefined) {
    const initiale = choisie;
    marquer(courante);
    choisie = initiale;
    if (!initiale) for (const e of elements.values()) e.setAttribute("aria-selected", "false");
  }
  return racine;
}
