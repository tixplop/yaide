import { listerChemins, lireFichier } from "../api.js";
import { champ } from "../ui/champ.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";

const MAX = 50;
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const nomDe = (chemin) => chemin.split("/").pop();

const minuscules = (texte) => Array.from(texte, (c) => Array.from(c.toLowerCase())[0] ?? c);
function position(foin, aiguille, depuis = 0) {
  for (let i = depuis; i + aiguille.length <= foin.length; i++) {
    if (aiguille.every((c, j) => foin[i + j] === c)) return i;
  }
  return -1;
}

/**
 * Chemins qui contiennent `texte` (sans tenir compte de la casse), 50 au plus.
 * Le nom du fichier passe avant le dossier, puis le chemin le plus court, puis l'ordre alphabétique.
 * Rend `[{ chemin, debut, fin }]`, la partie trouvée en caractères Unicode.
 */
export function filtrer(chemins, texte) {
  const cherche = minuscules(texte);
  if (cherche.length === 0) return [];
  const trouves = [];
  for (const chemin of chemins) {
    const bas = minuscules(chemin);
    const debutNom = bas.lastIndexOf("/") + 1;
    const dansNom = position(bas.slice(debutNom), cherche);
    const debut = dansNom >= 0 ? debutNom + dansNom : position(bas, cherche);
    if (debut < 0) continue;
    trouves.push({ chemin, debut, fin: debut + cherche.length, nom: dansNom >= 0, taille: bas.length });
  }
  trouves.sort((a, b) => Number(b.nom) - Number(a.nom) || a.taille - b.taille || (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0));
  return trouves.slice(0, MAX).map(({ chemin, debut, fin }) => ({ chemin, debut, fin }));
}

/**
 * V-006. Ctrl+P (sauf dans un shell) ou `ouvrir()` affiche le dialogue.
 * Rappels : `surOuvrir({ chemin, contenu, version, geste })`, `geste = surLecture(true)`, `surLecture(false)`.
 */
export function vueOuverture({ dire, surOuvrir = () => {}, surLecture = () => {} }) {
  let detruit = false;
  let dlg = null;

  function ouvrir() {
    if (detruit || dlg) return;
    const saisie = champ({ libelle: "Chemin du fichier", libelleMasque: true });
    const entree = saisie.querySelector("input");
    const zone = document.createElement("div");
    let etat = { type: "chargement" };
    let chemins = [];

    function fermer(rendreFocus = true) {
      dlg.fermer({ rendreFocus });
      dlg = null;
    }

    function afficher() {
      if (!dlg) return;
      entree.removeAttribute("aria-activedescendant");
      if (etat.type === "chargement") return zone.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
      if (etat.type === "erreur") return zone.replaceChildren(message({ texte: `Impossible de lire les fichiers : ${etat.raison}.`, variante: "erreur" }));
      if (entree.value === "") return zone.replaceChildren(indication({ texte: "Tapez une partie du chemin." }));
      const trouves = filtrer(chemins, entree.value);
      if (trouves.length === 0) return zone.replaceChildren(indication({ texte: "Aucun fichier trouvé." }));
      const l = liste({
        lignes: trouves.map((t) => ({ id: t.chemin, libelle: t.chemin, trouve: [t.debut, t.fin] })),
        pilotage: "champ",
        champ: entree,
        surActiver: ouvrirFichier,
      });
      l.setAttribute("aria-label", "Fichiers proposés");
      l.classList.add("ouverture-liste");
      zone.replaceChildren(l);
    }

    async function ouvrirFichier(chemin) {
      const nom = nomDe(chemin);
      const geste = surLecture(true);
      const r = await lireFichier(chemin);
      if (detruit) return;
      if (r.contenu !== undefined) {
        if (dlg) fermer(false);
        surOuvrir({ chemin, contenu: r.contenu, version: r.version, geste });
        return surLecture(false);
      }
      let texte;
      if (r.cause === "binaire" || r.cause === "non-utf8") texte = `${nom} est un fichier binaire. Yaide ne l'ouvre pas.`;
      else if (r.cause === "trop-gros") texte = `${nom} dépasse 5 Mo. Yaide ne l'ouvre pas.`;
      else if (r.coupure) texte = TEXTE_COUPURE;
      else texte = `Impossible d'ouvrir ${nom} : ${(r.message ?? "erreur").replace(/\.$/, "")}.`;
      if (dlg) fermer();
      dire({ texte, variante: "alerte", fermable: true });
      surLecture(false);
    }

    entree.addEventListener("input", afficher);
    dlg = dialogue({
      titre: "Ouvrir un fichier",
      contenu: [saisie, zone],
      focusInitial: entree,
      position: "palette",
      surAnnuler: () => fermer(),
    });
    afficher();
    dlg.ouvrir();

    listerChemins().then((r) => {
      if (detruit || !dlg) return;
      if (r.chemins) {
        chemins = r.chemins;
        etat = { type: "pret" };
      } else etat = { type: "erreur", raison: r.coupure ? "connexion perdue" : (r.message ?? "erreur").replace(/\.$/, "") };
      afficher();
    });
  }

  const surTouche = (e) => {
    const p = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "p";
    if (!p || e.target.closest?.(".terminal")) return;
    e.preventDefault();
    if (document.querySelector("[role=dialog], dialog[open]")) return;
    ouvrir();
  };
  document.addEventListener("keydown", surTouche);

  return {
    ouvrir,
    detruire() {
      detruit = true;
      document.removeEventListener("keydown", surTouche);
      if (dlg) dlg.fermer({ rendreFocus: false });
      dlg = null;
    },
  };
}
