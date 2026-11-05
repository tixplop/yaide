import { creerChemin, gitIndexer, lireFichier, listerDossier, renommerChemin, supprimerChemin } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { menu } from "../ui/menu.js";
import { message } from "../ui/message.js";

// Préfixe impossible dans un chemin relatif : marque les lignes qui ne sont pas des fichiers.
const FACTICE = "\0";
const nomDe = (chemin) => chemin.split("/").pop();
const dossierDe = (chemin) => chemin.split("/").slice(0, -1).join("/");
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const sansPoint = (texte) => texte.replace(/\.$/, "");
const nettoyer = (chemin) => chemin.trim().replace(/\/+$/, "");

function raisonDe(r) {
  return r.coupure ? "le serveur ne répond pas" : sansPoint(r.message);
}

/** Texte d'erreur du champ d'un dialogue pour une réponse du serveur. */
function texteErreur(r) {
  if (r.coupure) return TEXTE_COUPURE;
  if (r.cause === "existe" || r.cause === "interdit") return r.message;
  return `Action impossible : ${raisonDe(r)}.`;
}

/**
 * V-003. `dire({ texte, variante, fermable })` affiche un bandeau.
 * `projet` : nom affiché dans l'en-tête. `estDepot()` dit si le dossier est un dépôt git ; `surCommit()` mène au message de commit.
 * `lireEtat()` demande la lecture de l'état git, qui revient par `definirStatuts(Map | null)` (voir `statuts.js`).
 * Rappels : `surOuvrir({ chemin, contenu, version })`, `surRenomme({ de, vers })`, `surSupprime({ chemin, dossier })`, `surLecture(oui)` (début et fin d'une lecture).
 * Rend `{ corps, entete (à poser dans `panneau.entete`, à masquer avec le panneau), rafraichir(), relire() (silencieuse), definirStatuts(statuts), definirCourant(chemin | null), detruire() }`.
 */
export function vueFichiers({ dire, projet = "", lireEtat = async () => {}, estDepot = () => false, surCommit = () => {}, surOuvrir = () => {}, surRenomme = () => {}, surSupprime = () => {}, surLecture = () => {} }) {
  const corps = document.createElement("div");
  corps.className = "fichiers";
  const entete = document.createElement("div");
  entete.className = "fichiers-entete";
  const zoneArbre = document.createElement("div");
  zoneArbre.className = "fichiers-arbre";
  corps.append(zoneArbre);

  const ouverts = new Set();
  const dossiers = new Map(); // chemin -> { etat: "charge" | "ok" | "erreur", entrees, raison, lent }
  const types = new Map(); // chemin -> vrai si dossier
  let selection = []; // chemins sélectionnés, dans l'ordre de l'arbre
  let ancre = null; // départ de Maj+clic
  let derniere = null; // dernière ligne cliquée
  let statuts = null; // Map chemin -> { lettre, mot }, ou null hors d'un dépôt
  let courant = null; // chemin du fichier de l'onglet actif
  let detruit = false;
  let generation = 0; // incrémenté par chaque lecture bruyante : une relecture qui la croise est jetée

  const bFichier = bouton({ icone: "file-plus", variante: "discret", nomAccessible: "Nouveau fichier" });
  const bDossier = bouton({ icone: "folder-plus", variante: "discret", nomAccessible: "Nouveau dossier" });
  const bRenommer = bouton({ icone: "pencil", variante: "discret", nomAccessible: "Renommer", infoBulle: "Renommer ou déplacer", raccourci: "F2" });
  const bSupprimer = bouton({ icone: "trash", variante: "discret", nomAccessible: "Supprimer", raccourci: "Suppr", touche: "Delete" });
  const nomProjet = document.createElement("span");
  nomProjet.className = "fichiers-projet";
  nomProjet.textContent = projet;
  nomProjet.title = projet;
  entete.append(nomProjet, bFichier.enveloppe, bDossier.enveloppe, bRenommer.enveloppe, bSupprimer.enveloppe);

  /** La ligne sélectionnée s'il n'y en a qu'une, sinon `null`. */
  const seule = () => (selection.length === 1 ? selection[0] : null);
  const choisir = (chemin) => {
    selection = chemin === null ? [] : [chemin];
    ancre = derniere = chemin;
    majBoutons();
  };

  function majBoutons() {
    bRenommer.disabled = bSupprimer.disabled = seule() === null;
  }

  // ---- Arbre ----

  function lignes(chemin, niveau, sortie) {
    const d = dossiers.get(chemin);
    for (const e of d.entrees) {
      const id = chemin ? `${chemin}/${e.nom}` : e.nom;
      types.set(id, e.dossier);
      const ouvert = e.dossier && ouverts.has(id);
      const st = e.ignore ? undefined : statuts?.get(id);
      sortie.push({
        id,
        libelle: e.nom,
        niveau,
        ignore: e.ignore,
        enfants: e.dossier,
        ouvert,
        courant: id === courant,
        ...(st ? (e.dossier ? { statutDossier: st.lettre } : { statut: st.lettre }) : {}),
      });
      if (!ouvert) continue;
      const sous = dossiers.get(id);
      if (sous?.entrees) lignes(id, niveau + 1, sortie);
      if (sous?.etat === "charge" && sous.lent) sortie.push({ id: `${FACTICE}${id}`, libelle: "Chargement…", niveau: niveau + 1, sansMenu: true });
      if (sous?.etat === "erreur") sortie.push({ id: `${FACTICE}${id}`, libelle: `Impossible de lire ce dossier : ${sous.raison}.`, niveau: niveau + 1, sansMenu: true });
    }
    return sortie;
  }

  // La liste est recréée à chaque affichage : un dossier dont l'état a changé repart de l'angle d'avant pour que la transition du chevron joue.
  let dossiersAffiches = new Map();
  function animerChevrons(arbre) {
    const maintenant = new Map();
    for (const e of arbre.querySelectorAll("[aria-expanded][data-chemin]")) {
      const ouvert = e.getAttribute("aria-expanded") === "true";
      maintenant.set(e.dataset.chemin, ouvert);
      const avant = dossiersAffiches.get(e.dataset.chemin);
      const svg = e.querySelector(".liste-chevron svg");
      if (avant === undefined || avant === ouvert) continue;
      svg.style.transform = `rotate(${avant ? 90 : 0}deg)`;
      svg.getBoundingClientRect();
      svg.style.transform = "";
    }
    dossiersAffiches = maintenant;
  }

  function afficher(focaliser = false) {
    if (detruit) return;
    const avait = focaliser || zoneArbre.contains(document.activeElement);
    const focalisee = focaliser ? undefined : document.activeElement?.closest?.("[data-chemin]")?.dataset.chemin;
    const defile = zoneArbre.closest(".cadre-panneau-corps") ?? zoneArbre; // le conteneur qui défile
    const defilement = defile.scrollTop;
    const racine = dossiers.get("");
    if (!racine || racine.etat === "charge") return zoneArbre.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
    if (racine.etat === "erreur") {
      return zoneArbre.replaceChildren(message({ texte: `Impossible de lire ce dossier : ${racine.raison}.`, variante: "erreur" }));
    }
    if (racine.entrees.length === 0) {
      const nouveau = bouton({ libelle: "Nouveau fichier" });
      nouveau.addEventListener("click", () => ouvrirCreation(false));
      return zoneArbre.replaceChildren(indication({ texte: "Dossier vide.", action: nouveau }));
    }
    const l = lignes("", 0, []);
    const arbre = liste({
      variante: "arbre",
      lignes: l,
      multiple: true,
      selection,
      courante: focalisee ?? derniere ?? undefined,
      ancre: ancre ?? undefined,
      surSelection: (ids, { ancre: a, derniere: dn }) => {
        selection = ids;
        ancre = a;
        derniere = dn;
        majBoutons();
      },
      surActiver: activer,
      surBasculer: (id, ouvrir) => (ouvrir ? deplier(id) : replier(id)),
      surMenu,
    });
    arbre.setAttribute("aria-label", "Fichiers");
    l.forEach((ligne, i) => {
      if (!ligne.id.startsWith(FACTICE)) arbre.children[i].dataset.chemin = ligne.id;
    });
    zoneArbre.replaceChildren(arbre);
    animerChevrons(arbre);
    defile.scrollTop = defilement;
    // Le focus reste sur la ligne qui l'avait, même non sélectionnée (après AC-045-8).
    const cible = (focalisee !== undefined && ligneDe(focalisee)) || (derniere !== null ? ligneDe(derniere) : null);
    if (avait && cible) {
      sansSelection = true;
      cible.focus({ preventScroll: true });
      sansSelection = false;
    }
  }

  const ligneDe = (chemin) => [...zoneArbre.querySelectorAll("[data-chemin]")].find((e) => e.dataset.chemin === chemin);

  async function charger(chemin) {
    generation++;
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
    } else if (!(r.coupure && avant?.entrees)) dossiers.set(chemin, { etat: "erreur", raison: raisonDe(r) });
    return r;
  }

  async function rafraichir() {
    await Promise.all(["", ...ouverts].map(charger).concat(lireEtat()));
    afficher();
  }

  /** Relecture silencieuse (toutes les 3 s) des dossiers déjà lus : ni message, ni « Chargement… », rien de redessiné sans changement. */
  async function relire() {
    if (!dossiers.get("")?.entrees) return;
    const g = generation;
    const cibles = ["", ...ouverts].filter((c) => dossiers.get(c)?.entrees);
    const reponses = await Promise.all(cibles.map((c) => listerDossier(c)));
    if (detruit || g !== generation) return;
    const avant = lignes("", 0, []);
    const cleAvant = JSON.stringify(avant);
    cibles.forEach((c, i) => {
      const r = reponses[i];
      if (r.entrees) dossiers.set(c, { etat: "ok", entrees: r.entrees });
      else if (r.cause === "introuvable" && c !== "") {
        ouverts.delete(c);
        dossiers.delete(c);
      }
    });
    const apres = lignes("", 0, []);
    if (JSON.stringify(apres) === cleAvant) return;
    const ids = new Set(apres.map((l) => l.id));
    const focalisee = zoneArbre.contains(document.activeElement) ? document.activeElement.closest?.("[data-chemin]")?.dataset.chemin : undefined;
    const disparue = (id) => id !== null && id !== undefined && !ids.has(id) && avant.some((l) => l.id === id);
    let suivant = null;
    if (disparue(focalisee)) {
      const rang = avant.findIndex((l) => l.id === focalisee);
      suivant = avant.slice(0, rang).reverse().find((l) => ids.has(l.id) && !l.id.startsWith(FACTICE))?.id ?? "";
    }
    if (selection.some(disparue) || disparue(derniere)) {
      selection = selection.filter((id) => !disparue(id));
      if (disparue(derniere)) derniere = null;
      if (disparue(ancre)) ancre = null;
      majBoutons();
    }
    afficher();
    if (suivant === null) return;
    // Le focus passe sur la ligne voisine sans la sélectionner : AC-045-8 veut « plus de ligne sélectionnée ».
    sansSelection = true;
    (suivant === "" ? bFichier : (ligneDe(suivant) ?? bFichier)).focus({ preventScroll: true });
    sansSelection = false;
  }

  async function deplier(id) {
    ouverts.add(id);
    lireEtat(); // l'arbre ne dépend pas de git : les statuts arrivent quand l'état est lu
    const r = await charger(id);
    if (r?.coupure && !detruit) {
      ouverts.delete(id);
      dossiers.delete(id);
      dire({ texte: TEXTE_COUPURE, variante: "alerte", fermable: true });
    }
    afficher();
  }

  function replier(id) {
    ouverts.delete(id);
    const sous = (c) => c.startsWith(`${id}/`);
    if (selection.some(sous)) {
      selection = selection.filter((c) => !sous(c));
      if (derniere !== null && sous(derniere)) derniere = null;
      if (ancre !== null && sous(ancre)) ancre = null;
      majBoutons();
    }
    afficher();
  }

  function activer(id) {
    if (id.startsWith(FACTICE)) return;
    choisir(id);
    if (!types.get(id)) return ouvrirFichier(id);
    if (!ouverts.has(id) || dossiers.get(id)?.etat === "erreur") deplier(id);
    else replier(id);
  }

  async function ouvrirFichier(chemin) {
    const nom = nomDe(chemin);
    const geste = surLecture(true);
    const r = await lireFichier(chemin);
    if (detruit) return;
    if (r.contenu !== undefined) {
      surOuvrir({ chemin, contenu: r.contenu, version: r.version, geste });
      return surLecture(false);
    }
    let texte;
    if (r.cause === "binaire" || r.cause === "non-utf8") texte = `${nom} est un fichier binaire. Yaide ne l'ouvre pas.`;
    else if (r.cause === "trop-gros") texte = `${nom} dépasse 5 Mo. Yaide ne l'ouvre pas.`;
    else if (r.coupure) texte = TEXTE_COUPURE;
    else texte = `Impossible d'ouvrir ${nom} : ${raisonDe(r)}.`;
    dire({ texte, variante: "alerte", fermable: true });
    surLecture(false);
  }

  let sansSelection = false;
  // Le navigateur donne le focus dès le mousedown : le pointeur ne doit pas écraser la sélection avant le clic.
  let pointeur = false;
  zoneArbre.addEventListener(
    "mousedown",
    () => {
      pointeur = true;
      setTimeout(() => (pointeur = false), 0);
    },
    true,
  );
  zoneArbre.addEventListener("focusin", (e) => {
    if (sansSelection || pointeur || selection.length > 0) return;
    const chemin = e.target.closest?.("[data-chemin]")?.dataset.chemin;
    if (chemin === undefined) return;
    choisir(chemin);
    afficher(); // la liste peint la sélection ; le focus reste sur la ligne
  });
  zoneArbre.addEventListener("keydown", (e) => {
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

  // Partie vide : tout ce qui n'est pas une ligne (le dessous de la liste a déjà son écouteur, les lignes aussi).
  zoneArbre.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    surMenu(undefined, { x: e.clientX, y: e.clientY });
  });
  // Le clic droit dans la partie vide ne donne pas le focus au panneau.
  zoneArbre.addEventListener("mousedown", (e) => {
    if (e.button === 2 && !e.target.closest?.("[data-chemin]")) e.preventDefault();
  });

  // ---- Menu ----

  /** `id` : la ligne visée, ou `undefined` pour la partie vide. */
  function surMenu(id, position) {
    const vide = id === undefined;
    const dossier = !vide && Boolean(types.get(id));
    if (!vide) choisir(id);
    const base = vide ? "" : dossier ? id : dossierDe(id);
    const depot = estDepot();
    const commit = { libelle: "Commit", surChoix: surCommit };
    menu({
      nom: vide ? "Actions sur le projet" : `Actions sur ${id}${dossier ? "/" : ""}`,
      position,
      groupes: [
        [
          { libelle: "Nouveau fichier", surChoix: () => ouvrirCreation(false, base) },
          { libelle: "Nouveau dossier", surChoix: () => ouvrirCreation(true, base) },
        ],
        vide
          ? []
          : [
              { libelle: "Renommer", touche: "F2", surChoix: ouvrirRenommage },
              { libelle: "Supprimer", touche: "Suppr", surChoix: ouvrirSuppression },
            ],
        depot ? (vide ? [commit] : [{ libelle: "Indexer", surChoix: () => indexer(id, dossier) }, commit]) : [],
      ],
      surFermeture: () => {
        if (!vide) ligneDe(id)?.focus();
      },
    });
  }

  async function indexer(chemin, dossier) {
    const r = await gitIndexer(chemin);
    if (detruit) return;
    if (r.coupure) dire({ texte: TEXTE_COUPURE, variante: "alerte", fermable: true });
    else if (r.cause) dire({ texte: "Git a refusé.", detail: r.message, variante: "erreur", fermable: true });
    else {
      dire({ texte: `${chemin}${dossier ? "/" : ""} est indexé.`, variante: "succes", fermable: true });
      await lireEtat();
      if (detruit) return;
    }
    ligneDe(chemin)?.focus();
  }

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
    choisir(chemin);
    dlg.fermer({ rendreFocus: !ouvrir });
    await rafraichir();
    if (!ouvrir && origineArbre) afficher(true);
  }
  let origineArbre = false;

  function ouvrirCreation(dossier, depuisMenu) {
    origineArbre = false;
    let base = depuisMenu ?? "";
    if (depuisMenu === undefined && selection.length > 0 && derniere !== null) base = types.get(derniere) ? derniere : dossierDe(derniere);
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
    const de = seule();
    if (de === null) return;
    origineArbre = zoneArbre.contains(document.activeElement);
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
    const chemin = seule();
    if (chemin === null) return;
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
      choisir(null);
      dlg.fermer();
      await rafraichir();
      (zoneArbre.querySelector("[role=treeitem][tabindex='0']") ?? entete.querySelector("button")).focus();
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
    entete,
    rafraichir,
    relire,
    /** Pose les statuts git et redessine l'arbre, sans relire le disque. */
    definirStatuts(nouveaux) {
      const cle = (m) => JSON.stringify(m && [...m]);
      if (cle(nouveaux) === cle(statuts)) return;
      statuts = nouveaux;
      afficher();
    },
    /** Fichier de l'onglet actif, ou `null`. */
    definirCourant(chemin) {
      if (chemin === courant) return;
      courant = chemin;
      afficher();
    },
    detruire() {
      detruit = true;
    },
  };
}
