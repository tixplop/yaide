import { champ } from "./champ.js";
import { bouton } from "./bouton.js";
import { compteur } from "./compteur.js";

// REQ-159, REQ-160, REQ-161 (C-008) : panneau de recherche hors de CodeMirror, et recherche et surlignage d'un texte dans le DOM.

// Parties de `texte` égales à `cherche`, sans tenir compte des majuscules, sans chevauchement : paires [de, a].
export function chercherTexte(texte, cherche) {
  if (!cherche) return [];
  const foin = texte.toLocaleLowerCase();
  const aiguille = cherche.toLocaleLowerCase();
  const paires = [];
  for (let i = foin.indexOf(aiguille); i >= 0; i = foin.indexOf(aiguille, i + aiguille.length)) paires.push([i, i + aiguille.length]);
  return paires;
}

// Enveloppe chaque partie trouvée d'un `mark.ya-occurrence`, un par nœud de texte traversé.
export function marquerOccurrences(element, cherche, { courante = false } = {}) {
  const noeuds = [];
  const marcheur = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) noeuds.push(n);
  const paires = chercherTexte(noeuds.map((n) => n.data).join(""), cherche);
  if (!paires.length) return;
  const debuts = [];
  let pos = 0;
  for (const n of noeuds) {
    debuts.push(pos);
    pos += n.data.length;
  }
  for (let k = noeuds.length - 1; k >= 0; k--) {
    const debut = debuts[k];
    const fin = debut + noeuds[k].data.length;
    for (let p = paires.length - 1; p >= 0; p--) {
      const de = Math.max(paires[p][0], debut) - debut;
      const a = Math.min(paires[p][1], fin) - debut;
      if (a <= de) continue;
      const milieu = noeuds[k].splitText(de);
      milieu.splitText(a - de);
      const m = document.createElement("mark");
      m.className = courante ? "ya-occurrence ya-occurrence-courante" : "ya-occurrence";
      milieu.replaceWith(m);
      m.append(milieu);
    }
  }
}

// Retire les `mark.ya-occurrence` : le DOM d'avant.
export function retirerMarques(element) {
  for (const m of element.querySelectorAll("mark.ya-occurrence")) m.replaceWith(...m.childNodes);
  element.normalize();
}

// Panneau `role="search"` : champ, compteur, flèche haut, flèche bas, croix, zone `status`.
export function panneauRecherche({ nom, surTexte, surSuivante, surPrecedente, surFermer }) {
  const panneau = document.createElement("div");
  panneau.className = "ya-recherche-fichier";
  panneau.setAttribute("role", "search");
  panneau.setAttribute("aria-label", `Rechercher dans ${nom}`);
  const c = champ({ libelle: "Rechercher dans le fichier", libelleMasque: true, indication: "Rechercher" });
  const saisie = c.querySelector("input");
  saisie.setAttribute("autocomplete", "off");
  const zoneCompteur = document.createElement("span");
  zoneCompteur.className = "ya-recherche-compteur";
  const precedente = bouton({ icone: "chevron-up", nomAccessible: "Occurrence précédente", raccourci: "Maj+F3", touche: "Shift+F3" });
  const suivante = bouton({ icone: "chevron-down", nomAccessible: "Occurrence suivante", raccourci: "F3", touche: "F3" });
  const croix = bouton({ icone: "x", nomAccessible: "Fermer la recherche", raccourci: "Échap", touche: "Escape" });
  const statut = document.createElement("div");
  statut.className = "masque";
  statut.setAttribute("role", "status");
  const ouvrir = () => {
    saisie.focus();
    saisie.select();
  };
  precedente.addEventListener("click", () => surPrecedente());
  suivante.addEventListener("click", () => surSuivante());
  croix.addEventListener("click", () => surFermer());
  saisie.addEventListener("input", () => surTexte(saisie.value));
  panneau.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "Escape") surFermer();
    else if ((ev.key === "Enter" && !mod && ev.target === saisie) || ev.key === "F3") (ev.shiftKey ? surPrecedente : surSuivante)();
    else if (mod && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "f") ouvrir();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  });
  panneau.append(c, zoneCompteur, precedente.enveloppe, suivante.enveloppe, croix.enveloppe, statut);
  return {
    element: panneau,
    ouvrir,
    texte: () => saisie.value,
    definirTexte(t) {
      if (saisie.value !== t) saisie.value = t;
    },
    // `position` : rang (à partir de 1) de l'occurrence courante, ou undefined.
    afficher(total, position) {
      const texte = saisie.value;
      zoneCompteur.replaceChildren();
      if (texte) zoneCompteur.append(compteur({ valeur: total, variante: "texte", position }));
      statut.textContent = !texte ? "" : total === 0 ? "Aucune occurrence" : position ? `Occurrence ${position} sur ${total}` : total === 1 ? "1 occurrence" : `${total} occurrences`;
      for (const b of [precedente, suivante]) b.definirInactif(total === 0 || !texte);
    },
  };
}
