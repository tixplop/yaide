import { creerChemin, lireFichier, listerDossier, renommerChemin, supprimerChemin } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";

// Préfixe impossible dans un chemin relatif : marque les lignes qui ne sont pas des fichiers.
const FACTICE = "\0";
const nomDe = (chemin) => chemin.split("/").pop();
const dossierDe = (chemin) => chemin.split("/").slice(0, -1).join("/");
const sansPoint = (texte) => texte.replace(/\.$/, "");
const nettoyer = (chemin) => chemin.trim().replace(/\/+$/, "");

function raisonDe(r) {
  return r.coupure ? "le serveur ne répond pas" : sansPoint(r.message);
}

/** Texte d'erreur du champ d'un dialogue pour une réponse du serveur. */
function texteErreur(r) {
  if (r.cause === "existe" || r.cause === "interdit") return r.message;
  return `Action impossible : ${raisonDe(r)}.`;
}

/**
 * V-003. `dire({ texte, variante, fermable })` affiche un bandeau.
 * Rappels : `surOuvrir({ chemin, contenu, version })`, `surRenomme({ de, vers })`, `surSupprime({ chemin, dossier })`.
 * Rend `{ corps, pied, rafraichir(), detruire() }`.
 */
export function vueFichiers({ dire, surOuvrir = () => {}, surRenomme = () => {}, surSupprime = () => {} }) {
  const corps = document.createElement("div");
  corps.className = "fichiers";
  const pied = document.createElement("div");
  pied.className = "fichiers-pied";

  const ouverts = new Set();
  const dossiers = new Map(); // chemin -> { etat: "charge" | "ok" | "erreur", entrees, raison, lent }
  const types = new Map(); // chemin -> vrai si dossier
  let selection = null;
  let detruit = false;

  const bFichier = bouton({ libelle: "+ Fichier", variante: "discret" });
  const bDossier = bouton({ libelle: "+ Dossier", variante: "discret" });
  const bRenommer = bouton({ libelle: "Renommer", variante: "discret", titre: "Renommer ou déplacer (F2)" });
  const bSupprimer = bouton({ libelle: "Supprimer", variante: "discret", titre: "Supprimer (Suppr)" });
  pied.append(bFichier, bDossier, bRenommer, bSupprimer);

  function majBoutons() {
    bRenommer.disabled = bSupprimer.disabled = selection === null;
  }

  // ---- Arbre ----

  function lignes(chemin, niveau, sortie) {
    const d = dossiers.get(chemin);
    for (const e of d.entrees) {
      const id = chemin ? `${chemin}/${e.nom}` : e.nom;
      types.set(id, e.dossier);
      const ouvert = e.dossier && ouverts.has(id);
      sortie.push({ id, libelle: e.nom, niveau, attenuee: e.ignore, enfants: e.dossier, ouvert });
      if (!ouvert) continue;
      const sous = dossiers.get(id);
      if (sous?.entrees) lignes(id, niveau + 1, sortie);
      if (sous?.etat === "charge" && sous.lent) sortie.push({ id: `${FACTICE}${id}`, libelle: "Chargement…", niveau: niveau + 1 });
      if (sous?.etat === "erreur") sortie.push({ id: `${FACTICE}${id}`, libelle: `Impossible de lire ce dossier : ${sous.raison}.`, niveau: niveau + 1 });
    }
    return sortie;
  }

  function afficher(focaliser = false) {
    if (detruit) return;
    const avait = focaliser || corps.contains(document.activeElement);
    const racine = dossiers.get("");
    if (!racine || racine.etat === "charge") return corps.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
    if (racine.etat === "erreur") {
      return corps.replaceChildren(message({ texte: `Impossible de lire ce dossier : ${racine.raison}.`, variante: "erreur" }));
    }
    if (racine.entrees.length === 0) {
      const nouveau = bouton({ libelle: "Nouveau fichier" });
      nouveau.addEventListener("click", () => ouvrirCreation(false));
      return corps.replaceChildren(indication({ texte: "Dossier vide.", action: nouveau }));
    }
    const l = lignes("", 0, []);
    const arbre = liste({
      variante: "arbre",
      lignes: l,
      selection: selection ?? undefined,
      surActiver: activer,
      surBasculer: (id, ouvrir) => (ouvrir ? deplier(id) : replier(id)),
    });
    arbre.setAttribute("aria-label", "Fichiers");
    l.forEach((ligne, i) => {
      if (!ligne.id.startsWith(FACTICE)) arbre.children[i].dataset.chemin = ligne.id;
    });
    corps.replaceChildren(arbre);
    if (avait && selection !== null) ligneDe(selection)?.focus();
  }

  const ligneDe = (chemin) => [...corps.querySelectorAll("[data-chemin]")].find((e) => e.dataset.chemin === chemin);

  async function charger(chemin) {
    const avant = dossiers.get(chemin);
    if (!avant?.entrees) {
      const d = { etat: "charge", lent: false };
      dossiers.set(chemin, d);
      setTimeout(() => {
        if (d.etat === "charge" && dossiers.get(chemin) === d) {
          d.lent = true;
          afficher();
        }
      }, 200);
    }
    const r = await listerDossier(chemin);
    if (detruit) return;
    if (r.entrees) dossiers.set(chemin, { etat: "ok", entrees: r.entrees });
    else if (r.cause === "introuvable" && chemin !== "") {
      ouverts.delete(chemin);
      dossiers.delete(chemin);
    } else dossiers.set(chemin, { etat: "erreur", raison: raisonDe(r) });
  }

  async function rafraichir() {
    await Promise.all(["", ...ouverts].map(charger));
    afficher();
  }

  async function deplier(id) {
    ouverts.add(id);
    await charger(id);
    afficher();
  }

  function replier(id) {
    ouverts.delete(id);
    afficher();
  }

  function activer(id) {
    if (id.startsWith(FACTICE)) return;
    selection = id;
    majBoutons();
    if (!types.get(id)) return ouvrirFichier(id);
    if (!ouverts.has(id) || dossiers.get(id)?.etat === "erreur") deplier(id);
    else replier(id);
  }

  async function ouvrirFichier(chemin) {
    const nom = nomDe(chemin);
    const r = await lireFichier(chemin);
    if (detruit) return;
    if (r.contenu !== undefined) return surOuvrir({ chemin, contenu: r.contenu, version: r.version });
    let texte;
    if (r.cause === "binaire" || r.cause === "non-utf8") texte = `${nom} est un fichier binaire. Yaide ne l'ouvre pas.`;
    else if (r.cause === "trop-gros") texte = `${nom} dépasse 5 Mo. Yaide ne l'ouvre pas.`;
    else texte = `Impossible d'ouvrir ${nom} : ${raisonDe(r)}.`;
    dire({ texte, variante: "alerte", fermable: true });
  }

  corps.addEventListener("focusin", (e) => {
    const chemin = e.target.closest?.("[data-chemin]")?.dataset.chemin;
    if (chemin === undefined) return;
    selection = chemin;
    majBoutons();
  });
  corps.addEventListener("keydown", (e) => {
    const chemin = e.target.closest?.("[data-chemin]")?.dataset.chemin;
    if (chemin === undefined || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "F2") {
      e.preventDefault();
      ouvrirRenommage();
    } else if (e.key === "Delete") {
      e.preventDefault();
      ouvrirSuppression();
    }
  });

  // ---- Dialogues ----

  function montrerChemin(chemin) {
    const parts = chemin.split("/");
    for (let i = 1; i < parts.length; i++) ouverts.add(parts.slice(0, i).join("/"));
  }

  /** Dialogue à un champ « chemin ». `envoyer(chemin)` rend `{}` si réussi, sinon l'erreur du serveur. */
  function formulaire({ titre, libelle, valeur, libelleBouton, selectionNom, envoyer }) {
    const zone = document.createElement("div");
    const nouveauChamp = (erreur) => {
      const c = champ({ libelle, valeur: erreur ? erreur.valeur : valeur, erreur: erreur?.texte });
      zone.replaceChildren(c);
      const saisie = c.querySelector("input");
      saisie.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          valider();
        }
      });
      return saisie;
    };
    let saisie = nouveauChamp();
    const annuler = bouton({ libelle: "Annuler" });
    const ok = bouton({ libelle: libelleBouton, variante: "principal" });
    const dlg = dialogue({ titre, contenu: [zone], actions: [annuler, ok], focusInitial: saisie, surAnnuler: () => dlg.fermer() });
    annuler.addEventListener("click", () => dlg.fermer());
    ok.addEventListener("click", valider);

    function refuser(texte, v) {
      saisie = nouveauChamp({ texte, valeur: v });
      saisie.focus();
    }
    async function valider() {
      const v = nettoyer(saisie.value);
      if (!v) return refuser("Indiquez un chemin.", saisie.value);
      dlg.enCours(true);
      const r = await envoyer(v, dlg);
      if (detruit) return;
      dlg.enCours(false);
      if (r.fait) return;
      refuser(texteErreur(r), saisie.value);
    }
    dlg.ouvrir();
    saisie.value = valeur;
    if (selectionNom) {
      const debut = valeur.lastIndexOf("/") + 1;
      const point = valeur.lastIndexOf(".");
      saisie.setSelectionRange(debut, point > debut ? point : valeur.length);
    } else saisie.setSelectionRange(valeur.length, valeur.length);
  }

  async function terminer(chemin, dlg, { ouvrir = false } = {}) {
    montrerChemin(chemin);
    selection = chemin;
    majBoutons();
    dlg.fermer({ rendreFocus: !ouvrir });
    await rafraichir();
    if (!ouvrir && origineArbre) afficher(true);
  }
  let origineArbre = false;

  function ouvrirCreation(dossier) {
    origineArbre = false;
    let base = "";
    if (selection !== null) base = types.get(selection) ? selection : dossierDe(selection);
    formulaire({
      titre: dossier ? "Nouveau dossier" : "Nouveau fichier",
      libelle: "Chemin",
      valeur: base ? `${base}/` : "",
      libelleBouton: "Créer",
      async envoyer(chemin, dlg) {
        const r = await creerChemin(chemin, dossier ? "dossier" : "fichier");
        if (r.coupure || r.cause) return r;
        await terminer(chemin, dlg, { ouvrir: !dossier });
        if (!dossier) ouvrirFichier(chemin);
        return { fait: true };
      },
    });
  }

  function ouvrirRenommage() {
    if (selection === null) return;
    origineArbre = corps.contains(document.activeElement);
    const de = selection;
    formulaire({
      titre: "Renommer ou déplacer",
      libelle: "Nouveau chemin",
      valeur: de,
      libelleBouton: "Valider",
      selectionNom: true,
      async envoyer(vers, dlg) {
        if (vers === de) {
          dlg.fermer();
          return { fait: true };
        }
        const r = await renommerChemin(de, vers);
        if (r.coupure || r.cause) return r;
        for (const o of [...ouverts]) {
          if (o === de || o.startsWith(`${de}/`)) {
            ouverts.delete(o);
            ouverts.add(vers + o.slice(de.length));
          }
        }
        await terminer(vers, dlg);
        surRenomme({ de, vers });
        return { fait: true };
      },
    });
  }

  function ouvrirSuppression() {
    if (selection === null) return;
    const chemin = selection;
    const dossier = Boolean(types.get(chemin));
    const zone = document.createElement("div");
    const phrase = document.createElement("p");
    phrase.textContent = dossier
      ? "Le dossier et tout son contenu seront effacés. Cette action est définitive."
      : "Cette action est définitive.";
    zone.append(phrase);
    const annuler = bouton({ libelle: "Annuler" });
    const ok = bouton({ libelle: "Supprimer", variante: "danger" });
    const dlg = dialogue({
      titre: dossier ? `Supprimer le dossier ${nomDe(chemin)}/ ?` : `Supprimer ${nomDe(chemin)} ?`,
      contenu: [zone],
      actions: [annuler, ok],
      focusInitial: annuler,
      surAnnuler: () => dlg.fermer(),
    });
    annuler.addEventListener("click", () => dlg.fermer());
    ok.addEventListener("click", async () => {
      dlg.enCours(true);
      const r = await supprimerChemin(chemin);
      if (detruit) return;
      dlg.enCours(false);
      if (r.coupure || r.cause) {
        zone.replaceChildren(phrase, message({ texte: texteErreur(r), variante: "erreur" }));
        return;
      }
      for (const o of [...ouverts]) if (o === chemin || o.startsWith(`${chemin}/`)) ouverts.delete(o);
      selection = null;
      majBoutons();
      dlg.fermer();
      await rafraichir();
      (corps.querySelector("[role=treeitem][tabindex='0']") ?? pied.querySelector("button")).focus();
      surSupprime({ chemin, dossier });
    });
    dlg.ouvrir();
  }

  bFichier.addEventListener("click", () => ouvrirCreation(false));
  bDossier.addEventListener("click", () => ouvrirCreation(true));
  bRenommer.addEventListener("click", ouvrirRenommage);
  bSupprimer.addEventListener("click", ouvrirSuppression);
  majBoutons();
  rafraichir();

  return {
    corps,
    pied,
    rafraichir,
    detruire() {
      detruit = true;
    },
  };
}
