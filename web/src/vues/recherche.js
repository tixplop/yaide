import { chercherTexte, lireFichier } from "../api.js";
import { champ } from "../ui/champ.js";
import { indication } from "../ui/indication.js";
import { iconeDe, liste } from "../ui/liste.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const nomDe = (chemin) => chemin.split("/").pop();

/**
 * V-004. Rappels : `surOuvrir({ chemin, contenu, version, ligne })`, `surLecture(oui)`.
 * Rend `{ corps, montrer(oui), focuser(), detruire() }`.
 */
export function vueRecherche({ dire, surOuvrir = () => {}, surLecture = () => {} }) {
  const corps = document.createElement("div");
  corps.className = "recherche-corps";
  corps.hidden = true;

  const saisie = champ({ libelle: "Rechercher", libelleMasque: true });
  const entree = saisie.querySelector("input");
  const zone = document.createElement("div");
  corps.append(saisie, zone);

  let sequence = 0;
  let detruit = false;
  let etat = { type: "initial" };

  function afficher() {
    if (detruit) return;
    const { type } = etat;
    if (type === "initial") return zone.replaceChildren(indication({ texte: "Entrée pour chercher." }));
    if (type === "chargement") return zone.replaceChildren(indication({ texte: "Recherche en cours…", variante: "chargement" }));
    if (type === "erreur") return zone.replaceChildren(message({ texte: `La recherche a échoué : ${etat.raison}.`, variante: "erreur" }));
    if (etat.resultats.length === 0) return zone.replaceChildren(indication({ texte: "Aucun résultat" }));

    const lignes = [];
    let courant = null;
    for (const r of etat.resultats) {
      if (r.chemin !== courant) {
        courant = r.chemin;
        const nom = nomDe(r.chemin);
        const { icone, couleur } = iconeDe(nom);
        const dossier = r.chemin.includes("/") ? r.chemin.slice(0, r.chemin.lastIndexOf("/")) : undefined;
        const compteur = etat.resultats.filter((x) => x.chemin === r.chemin).length;
        lignes.push({ id: `g:${r.chemin}`, libelle: nom, dossier, icone, couleurIcone: couleur, compteur, groupe: true });
      }
      lignes.push({
        id: `${r.chemin}:${r.ligne}`,
        libelle: r.texte,
        numero: r.ligne,
        trouve: [r.debut, r.fin],
        policeCode: true,
        donnees: r,
      });
    }
    const l = liste({
      lignes,
      surActiver: (id) => ouvrir(etat.resultats.find((r) => `${r.chemin}:${r.ligne}` === id)),
    });
    l.setAttribute("aria-label", "Résultats de la recherche");
    const enfants = [];
    if (etat.limite) enfants.push(message({ texte: "500 premiers résultats. Précisez votre recherche." }));
    else {
      const resume = document.createElement("p");
      resume.className = "recherche-resume";
      const n = etat.resultats.length;
      const f = new Set(etat.resultats.map((r) => r.chemin)).size;
      resume.textContent = `${n} résultat${n > 1 ? "s" : ""} dans ${f} fichier${f > 1 ? "s" : ""}`;
      enfants.push(resume);
    }
    enfants.push(l);
    zone.replaceChildren(...enfants);
  }

  async function chercher() {
    const texte = entree.value;
    if (texte === "") return;
    const n = ++sequence;
    etat = { type: "chargement" };
    afficher();
    const r = await chercherTexte(texte);
    if (detruit || n !== sequence) return;
    if (r.coupure) etat = { type: "erreur", raison: "connexion perdue" };
    else if (r.cause) etat = { type: "erreur", raison: r.message.replace(/\.$/, "") };
    else etat = { type: "resultats", resultats: r.resultats, limite: r.limite };
    afficher();
  }

  async function ouvrir({ chemin, ligne }) {
    const nom = nomDe(chemin);
    const geste = surLecture(true);
    const r = await lireFichier(chemin);
    if (detruit) return;
    if (r.contenu !== undefined) {
      surOuvrir({ chemin, contenu: r.contenu, version: r.version, ligne, geste });
      return surLecture(false);
    }
    let texte;
    if (r.cause === "binaire" || r.cause === "non-utf8") texte = `${nom} est un fichier binaire. Yaide ne l'ouvre pas.`;
    else if (r.cause === "trop-gros") texte = `${nom} dépasse 5 Mo. Yaide ne l'ouvre pas.`;
    else if (r.coupure) texte = TEXTE_COUPURE;
    else texte = `Impossible d'ouvrir ${nom} : ${(r.message ?? "erreur").replace(/\.$/, "")}.`;
    dire({ texte, variante: "alerte", fermable: true });
    surLecture(false);
  }

  entree.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.key === "Enter") {
      e.preventDefault();
      chercher();
    } else if (e.key === "ArrowDown") {
      const premier = zone.querySelector("[role=option]");
      if (!premier) return;
      e.preventDefault();
      premier.focus();
    }
  });

  afficher();
  return {
    corps,
    montrer(oui) {
      corps.hidden = !oui;
    },
    focuser() {
      entree.focus();
    },
    detruire() {
      detruit = true;
    },
  };
}
