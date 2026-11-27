import { copierChemin, copierVersWindows, creerChemin, ecrireFichier, gitIndexer, importerChemin, lireConnaissance, lireFichier, listerDossier, renommerChemin, supprimerChemin } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { menu } from "../ui/menu.js";
import { message } from "../ui/message.js";
import { estImage } from "../onglets-fichiers.js";
import { REFUS_LECTURE, lireElements } from "./explorateur.js";
import { avecExtensionJdiag, ecrireJdiag } from "../jdiag.js";
import { estMac } from "../references.js";
import * as worktree from "../worktree.js";
import { mettreAJourFichiers, ouvrirAjoutConnaissance } from "./ajout-connaissance.js";
import { ouvrirSoumissionAgent } from "./soumission-agent.js";

// Préfixe impossible dans un chemin relatif : marque les lignes qui ne sont pas des fichiers.
const FACTICE = "\0";
const nomDe = (chemin) => chemin.split("/").pop();
const dossierDe = (chemin) => chemin.split("/").slice(0, -1).join("/");
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const CLE_SUIVI = "yaide-suivre-fichier";
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
 * V-003. `dire({ texte, variante, detail })` affiche un toast.
 * `projet` : nom affiché dans l'en-tête. `estDepot()` dit si le dossier est un dépôt git ; `surCommit()` mène au message de commit.
 * `lireEtat()` demande la lecture de l'état git, qui revient par `definirStatuts(Map | null)` (voir `statuts.js`).
 * `agents` : la fonction `agents` est active (commande « Ajouter à la base de connaissance… ») ; `surConfigurer({ surFermeture })` ouvre la configuration de la base ;
 * `surSoumettre({ equipe, message })` (commande « Soumettre à un agent… ») rend `{ coupure: true }` ou `{ ouvrir() }`.
 * Rappels : `surOuvrir({ chemin, contenu, version })`, `surRenomme({ de, vers })`, `surSupprime({ chemin, dossier })`, `surLecture(oui)` (début et fin d'une lecture).
 * Rend `{ corps, entete (à poser dans `panneau.entete`, à masquer avec le panneau), rafraichir(), relire() (silencieuse), definirStatuts(statuts), definirCourant(chemin | null), detruire() }`.
 */
export function vueFichiers({ dire, projet = "", lireEtat = async () => {}, estDepot = () => false, surCommit = () => {}, surOuvrir = () => {}, surRenomme = () => {}, surSupprime = () => {}, surLecture = () => {}, agents = false, surConfigurer = () => {}, surSoumettre = async () => ({}), surTeleversement = () => {} }) {
  const corps = document.createElement("div");
  corps.className = "fichiers";
  const entete = document.createElement("div"); // ligne « Worktree » (REQ-086) puis ligne du projet
  entete.className = "fichiers-tete";
  const zoneWorktree = document.createElement("div");
  zoneWorktree.hidden = true;
  const ligneProjet = document.createElement("div");
  ligneProjet.className = "fichiers-entete";
  entete.append(zoneWorktree, ligneProjet);
  const zoneArbre = document.createElement("div");
  zoneArbre.className = "fichiers-arbre";
  corps.append(zoneArbre);

  // Chaque worktree garde les dossiers qu'on y a dépliés, jusqu'au rechargement de la page.
  const ouvertsParWorktree = new Map();
  let vu = worktree.choisi(); // le choix que montre l'arbre
  let ouverts = new Set();
  ouvertsParWorktree.set(vu, ouverts);
  let dossiers = new Map(); // chemin depuis le projet -> { etat: "charge" | "ok" | "erreur", entrees, raison, lent } ; la racine est `vu`
  const types = new Map(); // chemin -> vrai si dossier
  let selection = []; // chemins sélectionnés, dans l'ordre de l'arbre
  let ancre = null; // départ de Maj+clic
  let derniere = null; // dernière ligne cliquée
  let table = new Map(); // chemin -> { collections, echec } : les fichiers de la base de connaissance (REQ-112), vide si les agents sont désactivés
  let statuts = null; // Map chemin -> { lettre, mot }, ou null hors d'un dépôt
  let courant = null; // chemin du fichier de l'onglet actif
  let detruit = false;
  let generation = 0; // incrémenté par chaque lecture bruyante : une relecture qui la croise est jetée
  let enGlisse = false; // un glissé est en cours : rien ne redessine l'arbre, la ligne saisie doit rester dans le document
  let deplacement = false; // des déplacements sont en cours
  let aRedessiner = false;
  let relireEnAttente = false;
  let messageDepot = null; // toast du dernier dépôt
  let messageCopie = null; // toast du dernier collage
  let appelWindows = 0; // numéro du dernier « Copier » vers Windows : la réponse d'un appel remplacé est ignorée
  let messageWindows = null; // toast d'échec de la copie vers Windows
  let copies = []; // chemins copiés (REQ-125), dans l'ordre de l'arbre, sans enfant d'un dossier aussi copié
  let collage = false; // un collage est en cours
  const mac = estMac();

  const bFichier = bouton({ icone: "file-plus", variante: "discret", nomAccessible: "Nouveau fichier" });
  const bDossier = bouton({ icone: "folder-plus", variante: "discret", nomAccessible: "Nouveau dossier" });
  const bRenommer = bouton({ icone: "pencil", variante: "discret", nomAccessible: "Renommer", infoBulle: "Renommer ou déplacer", raccourci: "F2" });
  const bSupprimer = bouton({ icone: "trash", variante: "discret", nomAccessible: "Supprimer", raccourci: "Suppr", touche: "Delete" });
  const bCopier = bouton({ icone: "copy", variante: "discret", nomAccessible: "Copier", raccourci: mac ? "Cmd+C" : "Ctrl+C", touche: mac ? "Meta+C" : "Control+C" });
  const bColler = bouton({ icone: "clipboard-paste", variante: "discret", nomAccessible: "Coller", raccourci: mac ? "Cmd+V" : "Ctrl+V", touche: mac ? "Meta+V" : "Control+V" });
  let suivre = localStorage.getItem(CLE_SUIVI) === "1"; // REQ-203 : l'état du bouton, gardé dans le navigateur
  const bSuivre = bouton({ icone: "locate-fixed", variante: "discret", nomAccessible: "Suivre le fichier actif", presse: suivre });
  const nomProjet = document.createElement("span");
  nomProjet.className = "fichiers-projet";
  nomProjet.textContent = projet;
  nomProjet.title = projet;
  ligneProjet.append(nomProjet, bFichier.enveloppe, bDossier.enveloppe, bRenommer.enveloppe, bSupprimer.enveloppe, bCopier.enveloppe, bColler.enveloppe, bSuivre.enveloppe);

  /** La ligne sélectionnée s'il n'y en a qu'une, sinon `null`. */
  const seule = () => (selection.length === 1 ? selection[0] : null);
  const choisir = (chemin) => {
    selection = chemin === null ? [] : [chemin];
    ancre = derniere = chemin;
    majBoutons();
  };

  /** REQ-203 : bouton enfoncé, le fichier actif devient la seule ligne sélectionnée, ses dossiers parents sont dépliés, la ligne est amenée dans la vue. Le focus ne bouge pas. */
  async function suivreCourant() {
    const chemin = courant;
    if (!suivre || chemin === null || (vu === "" ? chemin.startsWith("../") : !chemin.startsWith(`${vu}/`))) return;
    const parts = chemin.split("/");
    const parents = [];
    for (let i = (vu === "" ? 0 : vu.split("/").length) + 1; i < parts.length; i++) parents.push(parts.slice(0, i).join("/"));
    for (const p of parents) ouverts.add(p);
    await Promise.all(parents.filter((p) => !dossiers.get(p)?.entrees).map(charger));
    if (detruit || !suivre || courant !== chemin) return;
    choisir(chemin);
    afficher();
    ligneDe(chemin)?.scrollIntoView({ block: "nearest" });
  }
  bSuivre.addEventListener("click", () => {
    suivre = !suivre;
    bSuivre.setAttribute("aria-pressed", String(suivre));
    localStorage.setItem(CLE_SUIVI, suivre ? "1" : "0");
    suivreCourant();
  });

  function majBoutons() {
    bRenommer.disabled = bSupprimer.disabled = seule() === null;
    bCopier.disabled = selection.length === 0;
    bColler.disabled = copies.length === 0;
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
        ...(!e.dossier && table.has(id) ? { base: table.get(id) } : {}),
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
    if (enGlisse || deplacement) {
      aRedessiner = true;
      return;
    }
    const avait = focaliser || zoneArbre.contains(document.activeElement);
    const focalisee = focaliser ? undefined : document.activeElement?.closest?.("[data-chemin]")?.dataset.chemin;
    const defile = zoneArbre.closest(".cadre-panneau-corps") ?? zoneArbre; // le conteneur qui défile
    const defilement = defile.scrollTop;
    const base = dossiers.get(vu);
    if (!base || base.etat === "charge") {
      // Après un changement de worktree, l'ancien arbre reste affiché jusqu'à « Chargement… » (200 ms).
      if (!base || base.lent || zoneArbre.childElementCount === 0) zoneArbre.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
      return;
    }
    if (base.etat === "erreur") {
      return zoneArbre.replaceChildren(message({ texte: `Impossible de lire ce dossier : ${base.raison}.`, variante: "erreur" }));
    }
    if (base.entrees.length === 0) {
      const nouveau = bouton({ libelle: "Nouveau fichier" });
      nouveau.addEventListener("click", () => ouvrirCreation(false));
      return zoneArbre.replaceChildren(indication({ texte: "Dossier vide.", action: nouveau }));
    }
    const l = lignes(vu, 0, []);
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
      surDepot: deposer,
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
    const sac = dossiers;
    const avant = dossiers.get(chemin);
    if (!avant?.entrees) {
      const d = { etat: "charge", lent: false };
      dossiers.set(chemin, d);
      setTimeout(() => {
        if (d.etat === "charge" && sac.get(chemin) === d) {
          d.lent = true;
          afficher();
        }
      }, 200);
    }
    const r = await listerDossier(chemin);
    if (detruit || sac !== dossiers) return;
    if (r.entrees) dossiers.set(chemin, { etat: "ok", entrees: r.entrees });
    else if (r.cause === "introuvable" && chemin !== vu) {
      ouverts.delete(chemin);
      dossiers.delete(chemin);
    } else if (!(r.coupure && avant?.entrees)) dossiers.set(chemin, { etat: "erreur", raison: raisonDe(r) });
    return r;
  }

  /** Relit les fichiers de la base avec l'arbre ; une coupure ou un refus gardent la dernière table, sans message. */
  async function lireBase() {
    if (!agents) return;
    const r = await lireConnaissance();
    if (detruit || r.coupure || r.cause) return;
    table = new Map(Object.entries(r.fichiers ?? {}));
  }

  async function rafraichir() {
    await Promise.all([vu, ...ouverts].map(charger).concat(lireEtat(), lireBase()));
    afficher();
  }

  const sansBase = (ligne) => ({ ...ligne, base: undefined });

  /** Relecture silencieuse (toutes les 3 s) des dossiers déjà lus : ni message, ni « Chargement… », rien de redessiné sans changement. */
  async function relire() {
    if (!dossiers.get(vu)?.entrees) return;
    if (enGlisse || deplacement) {
      relireEnAttente = true;
      return;
    }
    const g = generation;
    const sac = dossiers;
    const cibles = [vu, ...ouverts].filter((c) => dossiers.get(c)?.entrees);
    const [reponses] = await Promise.all([Promise.all(cibles.map((c) => listerDossier(c))), lireBase()]);
    if (detruit || g !== generation || sac !== dossiers) return;
    const avant = lignes(vu, 0, []);
    const cleAvant = JSON.stringify(avant.map(sansBase));
    cibles.forEach((c, i) => {
      const r = reponses[i];
      if (r.entrees) dossiers.set(c, { etat: "ok", entrees: r.entrees });
      else if (r.cause === "introuvable" && c !== vu) {
        ouverts.delete(c);
        dossiers.delete(c);
      }
    });
    const apres = lignes(vu, 0, []);
    if (JSON.stringify(apres.map(sansBase)) === cleAvant) {
      // Seule la marque a pu changer : elle est posée sans redessiner les lignes (AC-112-4).
      zoneArbre.firstElementChild?.mettreAJourBase?.(apres);
      return;
    }
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
    if (estImage(chemin)) {
      await surOuvrir({ chemin, geste });
      return surLecture(false);
    }
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
    if (sansSelection || pointeur || enGlisse || selection.length > 0) return;
    const chemin = e.target.closest?.("[data-chemin]")?.dataset.chemin;
    if (chemin === undefined) return;
    choisir(chemin);
    afficher(); // la liste peint la sélection ; le focus reste sur la ligne
  });
  // En capture : avant l'écouteur de la liste, qui donne le focus à la ligne saisie.
  zoneArbre.addEventListener(
    "dragstart",
    (e) => {
      if (!e.target.closest?.("[draggable=true]")) return;
      if (deplacement) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      enGlisse = true;
    },
    true,
  );
  zoneArbre.addEventListener("dragend", () => {
    enGlisse = false;
    if (deplacement) return;
    if (aRedessiner) {
      aRedessiner = false;
      afficher();
    }
    if (relireEnAttente) {
      relireEnAttente = false;
      relire();
    }
  });
  // Ctrl+V : des fichiers dans le presse-papiers du système sont importés, sinon la liste de Yaide est collée (REQ-180, REQ-125).
  zoneArbre.addEventListener("paste", (e) => {
    const chemin = e.target.closest?.("[data-chemin]")?.dataset.chemin;
    if (chemin === undefined) return;
    const cible = types.get(chemin) ? chemin : dossierDe(chemin);
    const fichiers = [...(e.clipboardData?.files ?? [])];
    if (fichiers.length > 0 && memesNoms(fichiers.map((x) => x.name), copies.map(nomDe))) {
      // ce sont les fichiers que « Copier » a mis dans le presse-papiers de Windows (REQ-181)
      e.preventDefault();
      coller(cible);
    } else if (fichiers.length > 0) {
      e.preventDefault();
      if (collage) return;
      lireElements(e.clipboardData.items).then((elements) => collerExplorateur(cible, elements));
    } else if (copies.length > 0) {
      e.preventDefault();
      coller(cible);
    }
  });
  zoneArbre.addEventListener("keydown", (e) => {
    const chemin = e.target.closest?.("[data-chemin]")?.dataset.chemin;
    if (chemin === undefined) return;
    const touche = e.key.toLowerCase();
    if ((mac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && (touche === "c" || touche === "v")) {
      if (touche === "c") {
        e.preventDefault();
        copier();
      }
      return; // Ctrl+V : l'événement `paste` décide (REQ-180)
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
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

  // ---- Glisser-déposer ----

  /** Un dépôt : `aDeplacer` dans l'ordre de l'arbre, `cible` le dossier ("" = racine), `saisie` la ligne saisie. */
  async function deposer(aDeplacer, dossierCible = "", saisie) {
    const cible = dossierCible || vu; // la racine de l'arbre est celle du worktree choisi
    generation++;
    enGlisse = false;
    deplacement = true;
    messageDepot?.remove();
    messageDepot = null;
    const apres = new Map(); // ligne déplacée -> son chemin d'après
    const refus = [];
    let coupure = false;
    try {
      for (const de of aDeplacer) {
        const vers = cible ? `${cible}/${nomDe(de)}` : nomDe(de);
        if (vers === de) continue;
        const r = await renommerChemin(de, vers);
        if (detruit) return;
        if (r.coupure) {
          coupure = true;
          break;
        }
        if (r.cause) {
          const raison = r.cause === "existe" ? `ce nom est déjà pris ${cible !== vu ? `dans ${worktree.dansWorktree(cible)}/` : "à la racine du projet"}` : sansPoint(r.message);
          refus.push({ nom: `${nomDe(de)}${types.get(de) ? "/" : ""}`, raison, existe: r.cause === "existe" });
          continue;
        }
        suivreOuverts(de, vers);
        apres.set(de, vers);
        surRenomme({ de, vers });
      }
    } finally {
      deplacement = false;
      aRedessiner = false;
      relireEnAttente = false;
    }
    selection = aDeplacer.map((de) => apres.get(de) ?? de);
    const premiere = apres.size > 0 ? apres.values().next().value : saisie;
    ancre = derniere = premiere;
    majBoutons();
    if (apres.size > 0 && cible !== vu) ouverts.add(cible);
    if (coupure) messageDepot = dire({ texte: TEXTE_COUPURE, variante: "alerte", fermable: true }) ?? null;
    else if (refus.length === 1) {
      const [{ nom, raison, existe }] = refus;
      messageDepot = dire({ texte: `${nom} n'a pas été déplacé : ${raison}.${existe ? " Renommez-le, puis réessayez." : ""}`, variante: "erreur", fermable: true }) ?? null;
    } else if (refus.length > 1) {
      messageDepot = dire({ texte: `${refus.length} éléments n'ont pas été déplacés.`, detail: refus.map((x) => `${x.nom} : ${x.raison}`).join("\n"), variante: "erreur", fermable: true }) ?? null;
    }
    await rafraichir();
    if (detruit) return;
    afficher(true);
    ligneDe(premiere)?.scrollIntoView({ block: "nearest" });
  }

  // ---- Copier, coller (REQ-125) ----

  /** Retient les lignes sélectionnées : les enfants d'un dossier aussi copié sont écartés. */
  function copier() {
    if (selection.length === 0) return;
    copies = selection.filter((c) => !selection.some((p) => p !== c && types.get(p) && c.startsWith(`${p}/`)));
    majBoutons();
    versWindows();
  }

  const memesNoms = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

  /** Met la liste retenue dans le presse-papiers de Windows (WSL seulement, REQ-181), sans que « Copier » l'attende. */
  async function versWindows() {
    const numero = ++appelWindows;
    const r = await copierVersWindows(copies);
    if (detruit || numero !== appelWindows || r.coupure) return;
    messageWindows?.remove();
    messageWindows = null;
    if (!r.cause) return;
    const msg = { texte: `Copie vers l'explorateur de Windows impossible : ${sansPoint(r.message)}. Copiez de nouveau.`, variante: "erreur", fermable: true, cause: "presse-papiers-windows" };
    if (r.detail) msg.detail = r.detail;
    messageWindows = dire(msg) ?? null;
  }

  /** Fin d'un collage : messages de refus, sélection des éléments du premier niveau, focus sur le premier. */
  async function finirCollage(cible, creees, refus, coupure) {
    if (coupure) messageCopie = dire({ texte: TEXTE_COUPURE, variante: "alerte", fermable: true }) ?? null;
    else if (refus.length === 1) messageCopie = dire({ texte: `${refus[0].nom} n'a pas été copié : ${refus[0].raison}.`, variante: "erreur", fermable: true }) ?? null;
    else if (refus.length > 1) messageCopie = dire({ texte: `${refus.length} éléments n'ont pas été copiés.`, detail: refus.map((x) => `${x.nom} : ${x.raison}`).join("\n"), variante: "erreur", fermable: true }) ?? null;
    if (creees.length > 0) {
      if (cible !== vu) ouverts.add(cible);
      selection = creees;
      ancre = derniere = creees[0];
      majBoutons();
    }
    await rafraichir();
    if (detruit || creees.length === 0) return;
    afficher(true);
    ligneDe(creees[0])?.scrollIntoView({ block: "nearest" });
  }

  const raisonServeur = (r) => sansPoint(r.message).replace(/^./, (c) => c.toLowerCase());

  /** Colle dans le dossier `cible` : un élément à la fois, les refus sont réunis dans un seul message. */
  async function coller(cible) {
    if (collage || copies.length === 0) return;
    collage = true;
    generation++;
    messageCopie?.remove();
    messageCopie = null;
    const creees = [];
    const refus = [];
    let coupure = false;
    try {
      for (const de of [...copies]) {
        const r = await copierChemin(de, cible);
        if (detruit) return;
        if (r.coupure) {
          coupure = true;
          break;
        }
        if (r.cause) {
          const raison = r.cause === "introuvable" ? "il n'existe plus" : raisonServeur(r);
          refus.push({ nom: `${nomDe(de)}${types.get(de) ? "/" : ""}`, raison });
          continue;
        }
        creees.push(r.chemin);
      }
    } finally {
      collage = false;
    }
    await finirCollage(cible, creees, refus, coupure);
  }

  /** Importe `el` (arbre lu par `lireElements`) dans `dans`. `origine` : son chemin d'origine. Rend `true` si coupure. */
  async function importerElement(dans, el, origine, creees, refus, tv) {
    const chemin = `${origine}${el.nom}${el.dossier ? "/" : ""}`;
    if (el.refus) {
      refus.push({ nom: chemin, raison: el.refus });
      return false;
    }
    let octets;
    if (!el.dossier) {
      try {
        octets = await el.fichier.arrayBuffer();
      } catch {
        refus.push({ nom: chemin, raison: REFUS_LECTURE });
        tv.envoye(el.fichier.size);
        return false;
      }
    }
    tv.demarrer();
    const r = await importerChemin(dans, el.nom, el.dossier ? "dossier" : "fichier", octets, tv.progression);
    if (detruit || r.coupure) return true;
    tv.envoye(octets?.byteLength ?? 0);
    if (r.cause) {
      refus.push({ nom: chemin, raison: raisonServeur(r) });
      return false;
    }
    creees?.push(r.chemin);
    for (const enfant of el.enfants ?? []) {
      if (await importerElement(r.chemin, enfant, chemin, null, refus, tv)) return true;
    }
    return false;
  }

  /** Total des octets des fichiers lisibles de l'arbre `elements`. */
  const totalOctets = (elements) => elements.reduce((n, el) => n + (el.refus ? 0 : el.dossier ? totalOctets(el.enfants ?? []) : el.fichier.size), 0);

  /** Suivi de la jauge (REQ-185) : pourcentage des octets envoyés, arrondi à l'inférieur, jamais en recul. */
  function suiviTeleversement(total) {
    let base = 0;
    let pct = -1;
    const montrer = (octets) => {
      const n = total === 0 ? 0 : Math.floor((Math.min(octets, total) * 100) / total);
      if (n > pct) {
        pct = n;
        surTeleversement(n);
      }
    };
    return {
      demarrer: () => montrer(base),
      progression: (partis) => montrer(base + partis),
      envoye: (octets) => {
        base += octets;
        if (pct >= 0) montrer(base);
      },
    };
  }

  /** Colle dans `cible` les éléments copiés dans l'explorateur du bureau (REQ-180). */
  async function collerExplorateur(cible, elements) {
    if (collage) return;
    collage = true;
    generation++;
    messageCopie?.remove();
    messageCopie = null;
    const creees = [];
    const refus = [];
    let coupure = false;
    const tv = suiviTeleversement(totalOctets(elements));
    try {
      for (const el of elements) {
        if (await importerElement(cible, el, "", creees, refus, tv)) {
          coupure = true;
          break;
        }
      }
    } finally {
      collage = false;
      surTeleversement(undefined);
    }
    if (detruit) return;
    await finirCollage(cible, creees, refus, coupure);
  }

  /** Le dossier visé par les boutons « Nouveau fichier » et « Coller » : celui de la dernière ligne cliquée. */
  function dossierDuBouton() {
    if (selection.length > 0 && derniere !== null) return types.get(derniere) ? derniere : dossierDe(derniere);
    return vu;
  }

  // ---- Menu ----

  /** `id` : la ligne visée, ou `undefined` pour la partie vide. */
  function surMenu(id, position) {
    const vide = id === undefined;
    const dossier = !vide && Boolean(types.get(id));
    // Une ligne d'une sélection de plusieurs la garde entière (AC-049-3).
    const plusieurs = !vide && selection.length > 1 && selection.includes(id);
    if (!vide && !plusieurs) choisir(id);
    const base = vide ? vu : dossier ? id : dossierDe(id);
    const depot = estDepot();
    const commit = { libelle: "Commit", surChoix: surCommit };
    menu({
      nom: vide ? "Actions sur le projet" : `Actions sur ${worktree.dansWorktree(id)}${dossier ? "/" : ""}`,
      position,
      groupes: [
        [
          { libelle: "Nouveau fichier", surChoix: () => ouvrirCreation(false, base) },
          { libelle: "Nouveau dossier", surChoix: () => ouvrirCreation(true, base) },
          { libelle: "Nouveau whiteboard", surChoix: () => ouvrirWhiteboard(base) },
        ],
        vide
          ? [{ libelle: "Coller", touche: mac ? "Cmd+V" : "Ctrl+V", desactive: copies.length === 0, surChoix: () => coller(base) }]
          : [
              { libelle: "Copier", touche: mac ? "Cmd+C" : "Ctrl+C", surChoix: copier },
              { libelle: "Coller", touche: mac ? "Cmd+V" : "Ctrl+V", desactive: copies.length === 0, surChoix: () => coller(base) },
            ],
        vide
          ? []
          : [
              { libelle: "Renommer", touche: "F2", desactive: plusieurs, surChoix: ouvrirRenommage },
              { libelle: "Supprimer", touche: "Suppr", desactive: plusieurs, surChoix: ouvrirSuppression },
            ],
        depot ? (vide ? [commit] : [{ libelle: "Indexer", desactive: plusieurs, surChoix: () => indexer(id, dossier) }, commit]) : [],
        agents && !vide
          ? [
              { libelle: "Ajouter à la base de connaissance…", surChoix: () => ajouterALaBase(id, plusieurs) },
              { libelle: "Mettre à jour dans la base de connaissance", desactive: !dansLaBase(plusieurs ? selection : [id]), surChoix: () => mettreAJourALaBase(id, plusieurs) },
              { libelle: "Soumettre à un agent…", surChoix: () => soumettreAUnAgent(id, plusieurs) },
            ]
          : [],
      ],
      surFermeture: () => {
        if (!vide) ligneDe(id)?.focus();
      },
    });
  }

  /** Les chemins à ajouter : toute la sélection (dans l'ordre de l'arbre) ou la seule ligne visée. */
  function ajouterALaBase(id, plusieurs) {
    const chemins = plusieurs ? [...selection] : [id];
    ouvrirAjoutConnaissance({
      chemins,
      noms: chemins.map((c) => `${worktree.dansWorktree(c)}${types.get(c) ? "/" : ""}`),
      dire,
      surConfigurer,
      actif: () => !detruit,
      surRetour: () => {
        if (!detruit) (ligneDe(id) ?? zoneArbre.querySelector("[role=treeitem][tabindex='0']"))?.focus();
      },
    });
  }

  function soumettreAUnAgent(id, plusieurs) {
    const chemins = plusieurs ? [...selection] : [id];
    ouvrirSoumissionAgent({
      noms: chemins.map((c) => `${worktree.dansWorktree(c)}${types.get(c) ? "/" : ""}`),
      chemins: chemins.map((c) => `${c}${types.get(c) ? "/" : ""}`),
      surSoumettre,
      actif: () => !detruit,
      surRetour: () => {
        if (!detruit) (ligneDe(id) ?? zoneArbre.querySelector("[role=treeitem][tabindex='0']"))?.focus();
      },
    });
  }

  /** Vrai si l'un des chemins visés est un fichier de la base, ou un dossier qui en contient un. */
  function dansLaBase(chemins) {
    return chemins.some((c) => (types.get(c) ? [...table.keys()].some((k) => k.startsWith(`${c}/`)) : table.has(c)));
  }

  function mettreAJourALaBase(id, plusieurs) {
    const chemins = plusieurs ? [...selection] : [id];
    mettreAJourFichiers({
      chemins,
      noms: chemins.map((c) => `${worktree.dansWorktree(c)}${types.get(c) ? "/" : ""}`),
      dire,
      actif: () => !detruit,
      surRetour: () => (ligneDe(id) ?? zoneArbre.querySelector("[role=treeitem][tabindex='0']"))?.focus(),
    });
  }

  async function indexer(chemin, dossier) {
    const r = await gitIndexer(chemin);
    if (detruit) return;
    if (r.coupure) dire({ texte: TEXTE_COUPURE, variante: "alerte", fermable: true });
    else if (r.cause) dire({ texte: "Git a refusé.", detail: r.message, variante: "erreur", fermable: true });
    else {
      dire({ texte: `${worktree.dansWorktree(chemin)}${dossier ? "/" : ""} est indexé.`, variante: "succes", fermable: true });
      await lireEtat();
      if (detruit) return;
    }
    ligneDe(chemin)?.focus();
  }

  // ---- Dialogues ----

  function montrerChemin(chemin) {
    const parts = worktree.dansWorktree(chemin).split("/");
    for (let i = 1; i < parts.length; i++) ouverts.add(worktree.depuisWorktree(parts.slice(0, i).join("/")));
  }

  /** Texte d'erreur si le chemin tapé (depuis le dossier du worktree choisi) en sort, sinon `undefined`. */
  function sortDuWorktree(chemin) {
    if (vu === "") return undefined;
    let profondeur = 0;
    for (const segment of chemin.split("/")) {
      if (segment === "..") profondeur--;
      else if (segment !== "" && segment !== ".") profondeur++;
      if (profondeur < 0) return `Ce chemin sort du worktree ${worktree.nomChoisi()}.`;
    }
    return undefined;
  }

  /** Dialogue à un champ « chemin ». `envoyer(chemin)` rend `{}` si réussi, sinon l'erreur du serveur. */
  function formulaire({ titre, libelle, valeur, libelleBouton, selectionNom, aide, envoyer }) {
    const zone = document.createElement("div");
    const nouveauChamp = (erreur) => {
      const c = champ({ libelle, valeur: erreur ? erreur.valeur : valeur, aide, erreur: erreur?.texte });
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
    const dlg = dialogue({ titre, contenu: [zone], actions: [annuler, ok], focusInitial: saisie, surAnnuler: abandonner });
    annuler.addEventListener("click", abandonner);
    ok.addEventListener("click", valider);

    // La ligne d'origine a pu être redessinée pendant le dialogue : le focus revient par l'arbre.
    function abandonner() {
      dlg.fermer({ rendreFocus: !origineArbre });
      if (origineArbre) afficher(true);
    }
    function refuser(texte, v) {
      saisie = nouveauChamp({ texte, valeur: v });
      saisie.focus();
    }
    async function valider() {
      const v = nettoyer(saisie.value);
      if (!v) return refuser("Indiquez un chemin.", saisie.value);
      const sortie = sortDuWorktree(v);
      if (sortie) return refuser(sortie, saisie.value);
      dlg.enCours(true);
      const r = await envoyer(worktree.depuisWorktree(v), dlg);
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
    const base = depuisMenu ?? dossierDuBouton();
    const rel = worktree.dansWorktree(base);
    formulaire({
      titre: dossier ? "Nouveau dossier" : "Nouveau fichier",
      libelle: "Chemin",
      valeur: rel ? `${rel}/` : "",
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

  function ouvrirWhiteboard(depuisMenu) {
    origineArbre = false;
    const rel = worktree.dansWorktree(depuisMenu);
    formulaire({
      titre: "Nouveau whiteboard",
      libelle: "Chemin",
      valeur: rel ? `${rel}/` : "",
      libelleBouton: "Créer",
      aide: "L'extension .jdiag s'ajoute si elle manque.",
      async envoyer(brut, dlg) {
        const chemin = avecExtensionJdiag(brut);
        const r = await creerChemin(chemin, "fichier");
        if (r.coupure || r.cause) return r;
        // Une coupure ici laisse un fichier vide, qui s'ouvre comme un whiteboard vide.
        await ecrireFichier(chemin, ecrireJdiag({ boxes: [], links: [] }));
        montrerChemin(chemin);
        dlg.fermer({ rendreFocus: false });
        await rafraichir();
        ouvrirFichier(chemin);
        return { fait: true };
      },
    });
  }

  /** Les dossiers dépliés sous `de` suivent leur dossier déplacé. */
  function suivreOuverts(de, vers) {
    for (const o of [...ouverts]) {
      if (o === de || o.startsWith(`${de}/`)) {
        ouverts.delete(o);
        ouverts.add(vers + o.slice(de.length));
      }
    }
  }

  function ouvrirRenommage() {
    const de = seule();
    if (de === null) return;
    origineArbre = zoneArbre.contains(document.activeElement);
    formulaire({
      titre: "Renommer ou déplacer",
      libelle: "Nouveau chemin",
      valeur: worktree.dansWorktree(de),
      libelleBouton: "Valider",
      selectionNom: true,
      async envoyer(vers, dlg) {
        if (vers === de) {
          dlg.fermer();
          return { fait: true };
        }
        const r = await renommerChemin(de, vers);
        if (r.coupure || r.cause) return r;
        suivreOuverts(de, vers);
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

  // ---- Worktree (REQ-086) ----

  function afficherWorktree() {
    const liste = worktree.lister();
    const raison = worktree.occupe();
    zoneWorktree.hidden = liste.length < 2;
    const cle = JSON.stringify([liste, worktree.choisi(), raison]);
    if (cle === cleWorktree) return;
    cleWorktree = cle;
    if (liste.length < 2) return zoneWorktree.replaceChildren();
    const avait = zoneWorktree.contains(document.activeElement);
    const c = champ({
      libelle: "Worktree",
      type: "liste",
      presentation: "barre",
      ligne: true,
      options: liste.map((w) => ({ valeur: w.chemin, texte: worktree.texte(w) })),
      valeur: worktree.choisi(),
      desactive: Boolean(raison),
      raison,
    });
    const select = c.querySelector("select");
    select.addEventListener("change", () => worktree.choisir(select.value));
    zoneWorktree.replaceChildren(c);
    if (avait) select.focus({ preventScroll: true });
  }
  let cleWorktree = null;

  function nommerProjet() {
    const nom = vu === "" ? projet : (worktree.nomChoisi() ?? nomDe(vu));
    nomProjet.textContent = nom;
    nomProjet.title = nom;
  }

  const desabonner = worktree.abonner(({ disparu }) => {
    if (detruit) return;
    const f = document.activeElement;
    const surListeOuArbre = zoneWorktree.contains(f) || zoneArbre.contains(f); // avant que la liste soit refaite
    afficherWorktree();
    if (worktree.choisi() === vu) return;
    const focusPerdu = disparu && surListeOuArbre;
    vu = worktree.choisi();
    if (!ouvertsParWorktree.has(vu)) ouvertsParWorktree.set(vu, new Set());
    ouverts = ouvertsParWorktree.get(vu);
    dossiers = new Map();
    types.clear();
    selection = [];
    ancre = derniere = null;
    generation++;
    majBoutons();
    nommerProjet();
    rafraichir().then(() => {
      if (detruit || !focusPerdu) return;
      (zoneArbre.querySelector("[role=treeitem][tabindex='0']") ?? bFichier).focus();
    });
  });

  bFichier.addEventListener("click", () => ouvrirCreation(false));
  bDossier.addEventListener("click", () => ouvrirCreation(true));
  bRenommer.addEventListener("click", ouvrirRenommage);
  bSupprimer.addEventListener("click", ouvrirSuppression);
  bCopier.addEventListener("click", copier);
  bColler.addEventListener("click", () => coller(dossierDuBouton()));
  majBoutons();
  nommerProjet();
  afficherWorktree();
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
      suivreCourant();
    },
    detruire() {
      detruit = true;
      desabonner();
    },
  };
}
