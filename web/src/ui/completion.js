import { liste } from "./liste.js";

const DECLENCHEURS = ["/", "@", "$", "#"];
let compteur = 0;

/**
 * Relie un `textarea` à une liste de suggestions flottante (motif « Compléter la saisie d'un message »).
 * `sources` : par déclencheur (`/`, `@`, `$`, `#`), `{ nom, suggestions(texte) }` ; `suggestions` rend une promesse de lignes C-006
 * (chacune avec `valeur`, le texte inséré, et éventuellement `donnee`) ou de `{ message }`.
 * Rend `{ joints(), retenirEntree(), fermer(), detruire() }`.
 */
export function completion({ champ, sources }) {
  for (const d of Object.keys(sources)) if (!DECLENCHEURS.includes(d)) throw new Error(`completion : déclencheur inconnu « ${d} »`);
  const id = `completion-${++compteur}`;
  const arret = new AbortController();
  const ecoute = (cible, type, f) => cible.addEventListener(type, f, { signal: arret.signal });
  let hote = null;
  let lignes = []; // lignes affichées (vide pour un message)
  let courant = null; // { declencheur, start, texte } de la liste ouverte ou en attente
  let echap = null; // début du mot fermé par Échap
  let sequence = 0;
  let minuteur = null;
  let choix = []; // { declencheur, valeur, donnee }

  champ.setAttribute("aria-autocomplete", "list");
  champ.setAttribute("aria-expanded", "false");

  function mot() {
    if (champ.selectionStart !== champ.selectionEnd) return null;
    const curseur = champ.selectionStart;
    const texte = champ.value.slice(0, curseur);
    const start = texte.search(/\S*$/);
    const d = texte[start];
    if (!(d in sources) || (d === "/" && start !== 0)) return null;
    return { declencheur: d, start, texte: texte.slice(start + 1), curseur };
  }

  function retirer() {
    clearTimeout(minuteur);
    hote?.masquer();
    hote = null;
    lignes = [];
    champ.setAttribute("aria-expanded", "false");
    champ.removeAttribute("aria-activedescendant");
    champ.removeAttribute("aria-controls");
  }

  function fermer() {
    sequence++;
    courant = null;
    retirer();
  }

  function afficher(source, resultat) {
    const aLignes = Array.isArray(resultat) && resultat.length > 0;
    const message = aLignes ? undefined : (resultat.message ?? "Aucune suggestion.");
    hote?.masquer();
    champ.removeAttribute("aria-activedescendant");
    lignes = aLignes ? resultat : [];
    hote = liste({ lignes, pilotage: "champ", champ, flottante: true, nom: source.nom, message, surActiver: (ligneId) => choisir(lignes.find((l) => l.id === ligneId)) });
    hote.id = id;
    hote.afficher();
    champ.setAttribute("aria-controls", hote.querySelector('[role="listbox"]')?.id ?? id);
    champ.setAttribute("aria-expanded", "true");
  }

  function mettreAJour(origine) {
    const m = mot();
    if (!m) {
      echap = null;
      if (courant) fermer();
      return;
    }
    if (echap !== null) {
      if (echap !== m.start) echap = null;
      else if (origine !== "input") return;
      else echap = null;
    }
    if (courant && courant.declencheur === m.declencheur && courant.start === m.start && courant.texte === m.texte) return;
    if (courant && courant.start !== m.start) retirer();
    courant = { declencheur: m.declencheur, start: m.start, texte: m.texte };
    const source = sources[m.declencheur];
    const mienne = ++sequence;
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      if (mienne === sequence && !hote) afficher(source, { message: "Chargement…" });
    }, 200);
    new Promise((r) => r(source.suggestions(m.texte)))
      .then(
        (r) => r,
        () => ({ message: "Liste indisponible pour l'instant." }),
      )
      .then((r) => {
        if (mienne !== sequence) return;
        clearTimeout(minuteur);
        afficher(source, r ?? []);
      });
  }

  function choisir(ligne) {
    const m = mot();
    if (!ligne || !m) return;
    const insere = `${ligne.valeur} `;
    champ.setRangeText(insere, m.start, m.curseur, "end");
    choix.push({ declencheur: m.declencheur, valeur: ligne.valeur, donnee: ligne.donnee });
    fermer();
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Les choix encore intacts dans le texte, chacun à sa place réelle (entourée d'espaces, du début ou de la fin).
  function retrouver() {
    const texte = champ.value;
    const pris = new Set();
    const trouves = [];
    for (const c of choix) {
      for (let i = texte.indexOf(c.valeur); i >= 0; i = texte.indexOf(c.valeur, i + 1)) {
        const fin = i + c.valeur.length;
        if (pris.has(i) || (i > 0 && !/\s/.test(texte[i - 1])) || (fin < texte.length && !/\s/.test(texte[fin]))) continue;
        pris.add(i);
        trouves.push({ ...c, start: i, end: fin, text: c.valeur });
        break;
      }
    }
    choix = choix.filter((c) => trouves.some((t) => t.declencheur === c.declencheur && t.valeur === c.valeur));
    return trouves.sort((a, b) => a.start - b.start);
  }

  function indexCourant() {
    const el = document.getElementById(champ.getAttribute("aria-activedescendant") ?? "");
    return [...(hote?.querySelectorAll('[role="option"]') ?? [])].indexOf(el);
  }

  // Un texte remplacé par le code (champ vidé après un envoi) n'émet pas `input` : les choix disparus sont retirés tout de suite.
  const propre = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(champ), "value");
  Object.defineProperty(champ, "value", {
    configurable: true,
    get: () => propre.get.call(champ),
    set(v) {
      propre.set.call(champ, v);
      retrouver();
    },
  });
  ecoute(champ, "input", () => {
    retrouver();
    mettreAJour("input");
  });
  ecoute(champ, "keyup", () => mettreAJour("curseur"));
  ecoute(champ, "click", () => mettreAJour("curseur"));
  ecoute(champ, "blur", () => fermer());
  ecoute(champ, "keydown", (e) => {
    if (!hote) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      echap = courant?.start ?? null;
      fermer();
    } else if (e.key === "Tab" && lignes.length && !e.shiftKey) {
      e.preventDefault();
      choisir(lignes[indexCourant()]);
    } else if (e.key === "Enter" && e.shiftKey) fermer();
  });

  return {
    joints: retrouver,
    retenirEntree: () => lignes.length > 0 && Boolean(hote),
    fermer,
    detruire() {
      fermer();
      arret.abort();
      delete champ.value;
    },
  };
}
