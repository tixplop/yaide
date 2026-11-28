import { champ } from "./champ.js";
import { bouton } from "./bouton.js";
import { compteur } from "./compteur.js";

// REQ-159, REQ-160, REQ-161 (C-008) : panneau de recherche hors de CodeMirror, et recherche et surlignage d'un texte dans le DOM.

// Parties de `texte` égales à `cherche`, sans chevauchement : paires [de, a]. Relâchés, `casse` et `regex` donnent la recherche
// d'avant (texte tel quel, sans tenir compte des majuscules). Une partie trouvée vide n'est pas une occurrence.
// `null` : expression régulière invalide.
export function chercherTexte(texte, cherche, { casse = false, regex = false } = {}) {
  if (!cherche) return [];
  const paires = [];
  if (regex) {
    let re;
    try {
      re = new RegExp(cherche, casse ? "g" : "gi");
    } catch {
      return null;
    }
    for (const m of texte.matchAll(re)) if (m[0].length) paires.push([m.index, m.index + m[0].length]);
    return paires;
  }
  const foin = casse ? texte : texte.toLocaleLowerCase();
  const aiguille = casse ? cherche : cherche.toLocaleLowerCase();
  for (let i = foin.indexOf(aiguille); i >= 0; i = foin.indexOf(aiguille, i + aiguille.length)) paires.push([i, i + aiguille.length]);
  return paires;
}

// `texte` dont les `paires` (celles de `chercherTexte`) sont remplacées. Le texte mis à la place est tel quel ; avec `regex`,
// `$&`, `$1`, `$$` valent comme dans `String.prototype.replace`. Rien de ce qui est mis à la place n'est remplacé de nouveau.
export function remplacerTexte(texte, paires, cherche, remplacement, { regex = false, casse = false } = {}) {
  let sortie = "";
  let pos = 0;
  for (const [de, a] of paires) {
    let mis = remplacement;
    if (regex) {
      const re = new RegExp(cherche, casse ? "y" : "yi");
      re.lastIndex = de;
      mis = texte.replace(re, remplacement);
      mis = mis.slice(de, mis.length - (texte.length - a));
    }
    sortie += texte.slice(pos, de) + mis;
    pos = a;
  }
  return sortie + texte.slice(pos);
}

// Enveloppe chaque partie trouvée d'un `mark.ya-occurrence`, un par nœud de texte traversé.
export function marquerOccurrences(element, cherche, { courante = false, casse = false, regex = false } = {}) {
  const noeuds = [];
  const marcheur = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) noeuds.push(n);
  const paires = chercherTexte(noeuds.map((n) => n.data).join(""), cherche, { casse, regex });
  if (!paires?.length) return;
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

// Panneau `role="search"` : champ, bascules « Respecter la casse » et « Expression régulière », compteur, flèches, croix, zone `status` ;
// après `montrerRemplacement()`, une seconde rangée : champ « Remplacer », « Remplacer » et « Tout remplacer ».
export function panneauRecherche({ nom, surTexte, surSuivante, surPrecedente, surFermer, surOptions = () => {}, surRemplacer = () => {}, surToutRemplacer = () => {} }) {
  const panneau = document.createElement("div");
  panneau.className = "ya-recherche-fichier";
  panneau.setAttribute("role", "search");
  panneau.setAttribute("aria-label", `Rechercher dans ${nom}`);
  const c = champ({ libelle: "Rechercher dans le fichier", libelleMasque: true, indication: "Rechercher" });
  const saisie = c.querySelector("input");
  saisie.setAttribute("autocomplete", "off");
  const zoneCompteur = document.createElement("span");
  zoneCompteur.className = "ya-recherche-compteur";
  const casse = bouton({ icone: "case-sensitive", nomAccessible: "Respecter la casse", presse: false });
  const regex = bouton({ icone: "regex", nomAccessible: "Expression régulière", presse: false });
  const precedente = bouton({ icone: "chevron-up", nomAccessible: "Occurrence précédente", raccourci: "Maj+F3", touche: "Shift+F3" });
  const suivante = bouton({ icone: "chevron-down", nomAccessible: "Occurrence suivante", raccourci: "F3", touche: "F3" });
  const croix = bouton({ icone: "x", nomAccessible: "Fermer la recherche", raccourci: "Échap", touche: "Escape" });
  const commandes = document.createElement("div");
  commandes.className = "ya-recherche-commandes";
  commandes.append(casse.enveloppe, regex.enveloppe, zoneCompteur, precedente.enveloppe, suivante.enveloppe, croix.enveloppe);
  const statut = document.createElement("div");
  statut.className = "masque";
  statut.setAttribute("role", "status");
  let saisieRemplacer = null;
  let un = null;
  let tout = null;
  const options = () => ({ casse: casse.getAttribute("aria-pressed") === "true", regex: regex.getAttribute("aria-pressed") === "true" });
  const ouvrir = () => {
    saisie.focus();
    saisie.select();
  };
  const bascule = (b) => () => {
    b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
    surOptions(options());
  };
  const agir = (b, rappel) => () => {
    if (b.getAttribute("aria-disabled") !== "true") rappel(saisieRemplacer.value);
  };
  casse.addEventListener("click", bascule(casse));
  regex.addEventListener("click", bascule(regex));
  precedente.addEventListener("click", () => surPrecedente());
  suivante.addEventListener("click", () => surSuivante());
  croix.addEventListener("click", () => surFermer());
  saisie.addEventListener("input", () => surTexte(saisie.value));
  panneau.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "Escape") surFermer();
    else if (ev.key === "Enter" && !mod && ev.target === saisieRemplacer) {
      if (!ev.shiftKey) agir(un, surRemplacer)();
    } else if ((ev.key === "Enter" && !mod && ev.target === saisie) || ev.key === "F3") (ev.shiftKey ? surPrecedente : surSuivante)();
    else if (mod && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "f") ouvrir();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  });
  function ajouterRemplacement() {
    if (saisieRemplacer) return;
    const r = champ({ libelle: "Remplacer par", libelleMasque: true, indication: "Remplacer" });
    saisieRemplacer = r.querySelector("input");
    saisieRemplacer.setAttribute("autocomplete", "off");
    un = bouton({ icone: "replace", nomAccessible: "Remplacer", raccourci: "Entrée", touche: "Enter", inactif: !utilisable });
    tout = bouton({ icone: "replace-all", nomAccessible: "Tout remplacer", inactif: !utilisable });
    un.addEventListener("click", agir(un, surRemplacer));
    tout.addEventListener("click", agir(tout, surToutRemplacer));
    const rangee = document.createElement("div");
    rangee.className = "ya-recherche-commandes";
    rangee.append(un.enveloppe, tout.enveloppe);
    panneau.insertBefore(r, statut);
    panneau.insertBefore(rangee, statut);
  }
  panneau.append(c, commandes, statut);
  let utilisable = false;
  return {
    element: panneau,
    ouvrir,
    texte: () => saisie.value,
    options,
    definirTexte(t) {
      if (saisie.value !== t) saisie.value = t;
    },
    // Ajoute la seconde rangée (une seule fois) ; le focus va dans « Remplacer », son texte sélectionné.
    montrerRemplacement() {
      ajouterRemplacement();
      saisieRemplacer.focus();
      saisieRemplacer.select();
    },
    // Ajoute la seconde rangée sans le focus, avec ce texte dans « Remplacer » (reprise d'un état).
    definirRemplacement(t) {
      ajouterRemplacement();
      if (saisieRemplacer.value !== t) saisieRemplacer.value = t;
    },
    // Enfonce ou relâche les deux bascules.
    definirOptions(o) {
      casse.setAttribute("aria-pressed", String(Boolean(o.casse)));
      regex.setAttribute("aria-pressed", String(Boolean(o.regex)));
    },
    // Texte du champ « Remplacer », ou `null` sans la ligne.
    remplacement: () => (saisieRemplacer ? saisieRemplacer.value : null),
    // `position` : rang (à partir de 1) de l'occurrence courante, ou undefined. `invalide` : expression régulière refusée.
    afficher(total, position, { invalide = false } = {}) {
      const texte = saisie.value;
      zoneCompteur.replaceChildren();
      if (texte) zoneCompteur.append(compteur({ valeur: total, variante: "texte", position, invalide }));
      if (invalide && texte) saisie.setAttribute("aria-invalid", "true");
      else saisie.removeAttribute("aria-invalid");
      statut.textContent = !texte ? "" : invalide ? "Expression régulière invalide" : total === 0 ? "Aucune occurrence" : position ? `Occurrence ${position} sur ${total}` : total === 1 ? "1 occurrence" : `${total} occurrences`;
      for (const b of [precedente, suivante]) b.definirInactif(total === 0 || !texte || invalide);
      utilisable = Boolean(texte) && total > 0 && !invalide;
      for (const b of [un, tout]) b?.definirInactif(!utilisable);
    },
    annoncerRemplacees(n) {
      statut.textContent = n === 1 ? "1 occurrence remplacée" : `${n} occurrences remplacées`;
    },
  };
}
