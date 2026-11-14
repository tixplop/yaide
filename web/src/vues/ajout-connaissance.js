import { ajouterConnaissance, lireConnaissance, mettreAJourConnaissance } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue } from "../ui/dialogue.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const NOUVELLE = "";
const MESSAGE_TAILLE = "Entre 200 et 8\u00a0000 caractères.";
const MESSAGE_RECOUVREMENT = "Entre 0 et 10 lignes.";
const AIDE_DECOUPAGE = "Le découpage ne change plus une fois la collection créée.";
const STRATEGIES = [
  { valeur: "taille_fixe", texte: "Taille fixe", phrase: "Lignes entières, jusqu'à la taille maximale." },
  { valeur: "paragraphes", texte: "Paragraphes", phrase: "Paragraphes entiers, jusqu'à la taille maximale." },
  { valeur: "sections_markdown", texte: "Sections Markdown", phrase: "Une section par titre dans les fichiers Markdown ; les autres fichiers en taille fixe." },
];
/** Entier écrit en chiffres seulement (après `trim`), ou `undefined`. */
const nombreEntier = (texte) => (/^\d+$/.test(texte.trim()) ? Number(texte.trim()) : undefined);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Phrase du dialogue : les chemins dans l'ordre de l'arbre. */
export function phraseAjout(noms) {
  if (noms.length === 1) return `Ajouter ${noms[0]} à une collection.`;
  if (noms.length === 2) return `Ajouter ${noms[0]} et ${noms[1]} à une collection.`;
  const autres = noms.length - 2;
  return `Ajouter ${noms[0]}, ${noms[1]} et ${autres} ${autres > 1 ? "autres éléments" : "autre élément"} à une collection.`;
}

/** Texte d'erreur du nom d'une collection, ou `undefined` s'il est valide. */
function erreurNom(nom) {
  if (nom === "") return "Donnez un nom à la collection.";
  if (nom.length > 40) return "40 caractères au plus.";
  if (!/^[A-Za-z0-9_-]+$/.test(nom)) return "Lettres sans accent, chiffres, - et _ seulement.";
  return undefined;
}

/** Relit `GET /api/connaissance` chaque seconde jusqu'à la fin de l'ajout ou de la mise à jour `numero`, puis le dit par `dire`. */
function suivre({ numero, dire, actif }) {
  const tour = async () => {
    if (!actif()) return;
    const r = await lireConnaissance();
    if (!actif()) return;
    const a = r.ajout;
    if (!r.coupure && r.collections && (!a || a.numero !== numero)) return;
    if (a?.numero === numero && a.etat === "fini" && a.genre === "mise_a_jour") {
      return dire({ texte: `Mise à jour terminée : ${pluriel(a.ajoutes, "fichier")} mis à jour.`, variante: "succes", fermable: true });
    }
    if (a?.numero === numero && a.etat === "arrete" && a.genre === "mise_a_jour") {
      const texte = `La mise à jour s'est arrêtée. ${a.cause} Les fichiers déjà traités restent à jour.`;
      return dire({ texte, detail: a.detail ?? undefined, variante: "erreur", fermable: true });
    }
    if (a?.numero === numero && a.etat === "fini") {
      const texte = `Ajout à ${a.collection} terminé : ${pluriel(a.ajoutes, "fichier")} ${a.ajoutes > 1 ? "ajoutés" : "ajouté"}, ${a.ignores} ${a.ignores > 1 ? "ignorés" : "ignoré"}.`;
      return dire({ texte, variante: "succes", fermable: true });
    }
    if (a?.numero === numero && a.etat === "arrete") {
      const texte = `L'ajout à ${a.collection} s'est arrêté. ${a.cause} Les fichiers déjà traités restent dans la collection.`;
      return dire({ texte, detail: a.detail ?? undefined, variante: "erreur", fermable: true });
    }
    setTimeout(tour, 1000);
  };
  setTimeout(tour, 1000);
}

/**
 * Dialogue « Ajouter à la base de connaissance » (V-003, REQ-104).
 * `noms` : les chemins tels qu'ils s'affichent (un dossier finit par `/`) ; `chemins` : ceux que reçoit le serveur, dans le même ordre.
 * `dire` : bandeaux ; `surConfigurer({ surFermeture })` : ouvre la configuration de la base ; `surRetour()` : rend le focus à la ligne visée.
 */
export async function ouvrirAjoutConnaissance({ noms, chemins, dire, surConfigurer, surRetour, actif = () => true }) {
  const etat = await lireConnaissance();
  if (etat.coupure) {
    dire({ texte: TEXTE_COUPURE, variante: "alerte", fermable: true });
    return surRetour();
  }
  if (etat.cause) {
    dire({ texte: etat.message, variante: "erreur", fermable: true });
    return surRetour();
  }
  const configuree = Boolean(etat.config) || Boolean(etat.erreur);
  const aide = document.createElement("p");
  const annuler = bouton({ libelle: "Annuler" });
  let dlg;
  const abandonner = () => {
    dlg.fermer({ rendreFocus: false });
    surRetour();
  };

  if (!configuree) {
    aide.textContent = "La base de connaissance n'est pas configurée. Choisissez d'abord un provider et un modèle.";
    const configurer = bouton({ libelle: "Configurer la base", variante: "principal" });
    dlg = dialogue({ titre: "Ajouter à la base de connaissance", aide, actions: [annuler, configurer], focusInitial: configurer, surAnnuler: abandonner });
    annuler.addEventListener("click", abandonner);
    configurer.addEventListener("click", () => {
      dlg.fermer({ rendreFocus: false });
      surConfigurer({ surFermeture: surRetour });
    });
    return dlg.ouvrir();
  }

  aide.textContent = phraseAjout(noms);
  const existantes = (etat.collections ?? []).map((c) => c.nom).sort((a, b) => a.localeCompare(b));
  const zone = document.createElement("div");
  zone.className = "ya-formulaire";
  let liste = null;
  if (existantes.length > 0) {
    liste = champ({ libelle: "Collection", type: "liste", options: [...existantes, { valeur: NOUVELLE, texte: "Nouvelle collection…" }] });
    zone.append(liste);
  }
  const select = liste?.querySelector("select");
  // Nom et découpage : pour une nouvelle collection seulement.
  const zoneNom = document.createElement("div");
  zoneNom.className = "ya-formulaire";
  zone.append(zoneNom);
  const reglages = { strategie: "taille_fixe", taille: "2000", recouvrement: "0" };
  let saisie;
  let saisieTaille;
  let saisieRecouvrement;
  const grille = document.createElement("div");
  grille.className = "ya-formulaire-grille";
  const blocNom = document.createElement("div");
  const blocStrategie = document.createElement("div");
  const aideDecoupage = document.createElement("p");
  aideDecoupage.className = "ya-formulaire-aide";
  aideDecoupage.id = "ajout-decoupage-aide";
  aideDecoupage.textContent = AIDE_DECOUPAGE;
  zoneNom.append(blocNom, blocStrategie, grille, aideDecoupage);
  const nouveauChamp = (valeur, erreur) => {
    blocNom.replaceChildren(champ({ libelle: "Nom de la nouvelle collection", valeur, aide: "40 caractères au plus : lettres sans accent, chiffres, - et _.", erreur }));
    saisie = blocNom.querySelector("input");
    saisie.addEventListener("keydown", surEntree);
  };
  const champsReglages = (erreurs = {}) => {
    const taille = champ({ libelle: "Taille maximale (caractères)", valeur: reglages.taille, clavier: "numerique", erreur: erreurs.taille });
    const recouvrement = champ({ libelle: "Recouvrement (lignes)", valeur: reglages.recouvrement, clavier: "numerique", erreur: erreurs.recouvrement });
    recouvrement.hidden = reglages.strategie !== "taille_fixe";
    grille.replaceChildren(taille, recouvrement);
    saisieTaille = taille.querySelector("input");
    saisieRecouvrement = recouvrement.querySelector("input");
    for (const [i, cle] of [[saisieTaille, "taille"], [saisieRecouvrement, "recouvrement"]]) {
      i.addEventListener("input", () => (reglages[cle] = i.value));
      i.addEventListener("keydown", surEntree);
    }
  };
  const strategie = champ({ libelle: "Découpage", type: "liste", options: STRATEGIES.map(({ valeur, texte }) => ({ valeur, texte })), valeur: reglages.strategie, aide: STRATEGIES[0].phrase });
  blocStrategie.append(strategie);
  const selStrategie = strategie.querySelector("select");
  const phrase = strategie.querySelector(".champ-aide");
  selStrategie.setAttribute("aria-describedby", `${phrase.id} ${aideDecoupage.id}`);
  selStrategie.addEventListener("change", () => {
    reglages.strategie = selStrategie.value;
    phrase.textContent = STRATEGIES.find((x) => x.valeur === selStrategie.value).phrase;
    grille.children[1].hidden = selStrategie.value !== "taille_fixe";
  });
  const nouvelle = () => !select || select.value === NOUVELLE;
  const majNom = () => (zoneNom.hidden = !nouvelle());
  function surEntree(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    valider();
  }
  nouveauChamp("");
  champsReglages();
  select?.addEventListener("change", majNom);
  select?.addEventListener("keydown", surEntree);
  majNom();

  const ok = bouton({ libelle: "Ajouter", variante: "principal" });
  dlg = dialogue({ titre: "Ajouter à la base de connaissance", aide, contenu: [zone], actions: [annuler, ok], focusInitial: select ?? saisie, surAnnuler: abandonner });
  annuler.addEventListener("click", abandonner);
  ok.addEventListener("click", valider);

  /** Toutes les erreurs ensemble, chacune sous son champ ; le focus va au premier : nom, taille, recouvrement. */
  function afficherErreurs(erreurs) {
    nouveauChamp(saisie.value, erreurs.nom);
    champsReglages(erreurs);
    const premier = erreurs.nom ? saisie : erreurs.taille ? saisieTaille : saisieRecouvrement;
    premier.focus();
  }

  async function valider() {
    const nom = select && !nouvelle() ? select.value : saisie.value.trim();
    let decoupage;
    if (nouvelle()) {
      const erreurs = { nom: erreurNom(nom) };
      const taille = nombreEntier(reglages.taille);
      if (taille === undefined || taille < 200 || taille > 8000) erreurs.taille = MESSAGE_TAILLE;
      const recouvrement = nombreEntier(reglages.recouvrement);
      const avecRecouvrement = reglages.strategie === "taille_fixe";
      if (avecRecouvrement && (recouvrement === undefined || recouvrement > 10)) erreurs.recouvrement = MESSAGE_RECOUVREMENT;
      if (erreurs.nom || erreurs.taille || erreurs.recouvrement) return afficherErreurs(erreurs);
      decoupage = { strategie: reglages.strategie, taille, ...(avecRecouvrement ? { recouvrement } : {}) };
    }
    dlg.definirResultat(null);
    dlg.enCours(true);
    ok.textContent = "Ajout…";
    const r = await ajouterConnaissance(nom, chemins, decoupage);
    ok.textContent = "Ajouter";
    dlg.enCours(false);
    if (r.cause === "taille" || r.cause === "recouvrement") return afficherErreurs({ [r.cause]: r.message });
    if (r.coupure || r.cause) {
      dlg.definirResultat(message({ texte: r.coupure ? TEXTE_COUPURE : r.message, variante: "erreur" }));
      return ok.focus();
    }
    dlg.fermer({ rendreFocus: false });
    surRetour();
    const debut = noms.length === 1 ? noms[0] : `${noms.length} éléments`;
    dire({ texte: `Ajout de ${debut} à ${r.collection}…`, variante: "info", fermable: true });
    suivre({ numero: r.numero, dire, actif });
  }
  dlg.ouvrir();
}

/**
 * « Mettre à jour dans la base de connaissance » (REQ-111) : pas de dialogue, la mise à jour part aussitôt.
 * `noms` et `chemins` comme pour l'ajout ; `surRetour()` rend le focus à la ligne visée, sans que les messages le déplacent.
 */
export async function mettreAJourFichiers({ noms, chemins, dire, surRetour, actif = () => true }) {
  const r = await mettreAJourConnaissance(chemins);
  if (!actif()) return;
  surRetour();
  if (r.coupure || r.cause) return dire({ texte: r.coupure ? TEXTE_COUPURE : r.message, variante: r.coupure ? "alerte" : "erreur", fermable: true });
  const debut = noms.length === 1 ? noms[0] : `${noms.length} éléments`;
  dire({ texte: `Mise à jour de ${debut} dans la base de connaissance…`, variante: "info", fermable: true });
  suivre({ numero: r.numero, dire, actif });
}
