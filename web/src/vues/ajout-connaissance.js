import { ajouterConnaissance, lireConnaissance } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue } from "../ui/dialogue.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const NOUVELLE = "";
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

/** Relit `GET /api/connaissance` chaque seconde jusqu'à la fin de l'ajout `numero`, puis le dit par `dire`. */
function suivre({ numero, dire, actif }) {
  const tour = async () => {
    if (!actif()) return;
    const r = await lireConnaissance();
    if (!actif()) return;
    const a = r.ajout;
    if (!r.coupure && r.collections && (!a || a.numero !== numero)) return;
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
  let liste = null;
  if (existantes.length > 0) {
    liste = champ({ libelle: "Collection", type: "liste", options: [...existantes, { valeur: NOUVELLE, texte: "Nouvelle collection…" }] });
    zone.append(liste);
  }
  const select = liste?.querySelector("select");
  const zoneNom = document.createElement("div");
  zone.append(zoneNom);
  let saisie;
  const nouveauChamp = (valeur, erreur) => {
    zoneNom.replaceChildren(champ({ libelle: "Nom de la nouvelle collection", valeur, aide: "40 caractères au plus : lettres sans accent, chiffres, - et _.", erreur }));
    saisie = zoneNom.querySelector("input");
    saisie.addEventListener("keydown", surEntree);
  };
  const nouvelle = () => !select || select.value === NOUVELLE;
  const majNom = () => (zoneNom.hidden = !nouvelle());
  function surEntree(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    valider();
  }
  nouveauChamp("");
  select?.addEventListener("change", majNom);
  select?.addEventListener("keydown", surEntree);
  majNom();

  const ok = bouton({ libelle: "Ajouter", variante: "principal" });
  dlg = dialogue({ titre: "Ajouter à la base de connaissance", aide, contenu: [zone], actions: [annuler, ok], focusInitial: select ?? saisie, surAnnuler: abandonner });
  annuler.addEventListener("click", abandonner);
  ok.addEventListener("click", valider);

  async function valider() {
    const nom = select && !nouvelle() ? select.value : saisie.value.trim();
    if (nouvelle()) {
      const erreur = erreurNom(nom);
      if (erreur) {
        nouveauChamp(saisie.value, erreur);
        return saisie.focus();
      }
    }
    dlg.definirResultat(null);
    dlg.enCours(true);
    ok.textContent = "Ajout…";
    const r = await ajouterConnaissance(nom, chemins);
    ok.textContent = "Ajouter";
    dlg.enCours(false);
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
