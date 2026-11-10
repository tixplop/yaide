import { gitBranche, gitCommit, gitDiff, gitEtat, gitIndexer, gitPull, gitPush } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { icone } from "../ui/icones.js";
import { indication } from "../ui/indication.js";
import { iconeDe, liste, STATUTS } from "../ui/liste.js";
import { message } from "../ui/message.js";
import * as worktree from "../worktree.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const nomDe = (chemin) => chemin.split("/").pop();

const dossierDe = (chemin) => chemin.split("/").slice(0, -1).join("/");

/**
 * V-005. Rappels : `surBranche({ branche, detachee } | null)`, `surDiff({ chemin, texte, avis })`,
 * `diffOuvert()` (chemin du diff ouvert ou null), `fermerDiff()`, `surDisque()` (le disque a peut-être changé),
 * `surEtat(etat | null)` (à chaque lecture, panneau masqué ou non ; `null` hors d'un dépôt ou sans lecture possible).
 * Rend `{ corps, rafraichir(), relire() (silencieuse), montrer(oui), detruire() }`.
 */
export function vueGit({ dire, surBranche = () => {}, surDiff = () => {}, diffOuvert = () => null, fermerDiff = () => {}, surDisque = () => {}, surEtat = () => {} }) {
  const corps = document.createElement("div");
  corps.className = "git-corps";
  corps.hidden = true;

  let etat = null; // dernier état lu du serveur
  let refus = null; // { pasDepot } ou { texte, detail } quand rien n'a pu être lu
  let selection = null;
  let enCours = null; // "Commit", "Pull" ou "Push" pendant une action
  let occupe = false;
  let sequence = 0;
  let refocaliser = null; // focus voulu par l'action en cours, à la place du contrôle d'origine
  let detruit = false;
  let derniere = null; // clé de la dernière réponse appliquée, pour que la relecture ignore ce qui n'a pas changé
  let cleHaut = null; // clé de ce qui est affiché dans la ligne « Branche » et près de « Commit »

  // De haut en bas : branche avec Pull et Push, message, Commit, messages ; puis la liste, qui défile.
  const formulaire = document.createElement("div");
  formulaire.className = "git-formulaire";
  formulaire.hidden = true;
  const ligneBranche = document.createElement("div");
  ligneBranche.className = "git-branche";
  const zoneCommit = document.createElement("div");
  zoneCommit.className = "git-commit";
  const zoneMessage = document.createElement("div");
  const zoneListe = document.createElement("div");
  zoneListe.className = "git-liste";
  const zoneWorktree = document.createElement("div"); // ligne « Worktree » (REQ-086), seulement avec deux worktrees ou plus
  zoneWorktree.hidden = true;
  let cleWorktree = null;
  let choixVu = worktree.choisi();
  let focusPremiere = false; // le worktree choisi a disparu avec le focus dessus : il va sur la première ligne
  let champMessage = nouveauChamp("");
  formulaire.append(ligneBranche, champMessage, zoneCommit, zoneMessage);
  corps.append(zoneWorktree, formulaire, zoneListe);

  const saisie = () => champMessage.querySelector("textarea");

  function nouveauChamp(valeur, erreur) {
    const c = champ({ libelle: "Message", type: "multiligne", valeur, erreur, indication: "Message (Ctrl+Entrée)", libelleMasque: true });
    c.querySelector("textarea").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        valider();
      }
    });
    return c;
  }

  // ---- Lecture ----

  async function rafraichir() {
    const n = ++sequence;
    const r = await gitEtat();
    if (detruit || n !== sequence) return;
    if (r.coupure) {
      if (etat) dire({ texte: TEXTE_COUPURE, variante: "alerte", fermable: true });
      else {
        refus = { texte: TEXTE_COUPURE };
        derniere = null;
      }
      surBranche(etat ? { branche: etat.branche, detachee: etat.detachee } : null);
      surEtat(etat);
      afficher();
    } else appliquer(r);
  }

  /** Relecture silencieuse (toutes les 3 s) : ni message, ni « Chargement… », et rien n'est redessiné sans changement. */
  async function relire() {
    if (occupe) return;
    const n = sequence;
    const r = await gitEtat();
    if (detruit || occupe || n !== sequence || r.coupure || (r.cause && r.cause !== "pas-depot" && r.cause !== "worktree")) return;
    if (JSON.stringify(r) === derniere) return;
    appliquer(r);
  }

  /** Vrai si la liste a fait revenir le choix au projet : la relecture est déjà repartie. */
  function majWorktrees(liste) {
    const avant = worktree.choisi();
    worktree.mettreAJour(liste);
    return worktree.choisi() !== avant;
  }

  function appliquer(r) {
    // Worktree refusé : il a disparu entre deux relectures.
    if (r.cause === "worktree" && worktree.choisi() !== "") return void majWorktrees(worktree.lister().filter((w) => w.chemin !== worktree.choisi()));
    if (r.cause === "pas-depot" ? majWorktrees([]) : !r.cause && majWorktrees(r.worktrees ?? [])) return;
    derniere = JSON.stringify(r);
    if (r.cause === "pas-depot") {
      etat = null;
      refus = { pasDepot: true };
    } else if (r.cause) {
      etat = null;
      refus = { texte: "Git a refusé.", detail: r.message };
    } else {
      etat = r;
      refus = null;
      if (selection && !etat.changements.some((c) => c.chemin === selection)) selection = null;
      const ouvert = diffOuvert();
      if (ouvert && !etat.changements.some((c) => c.chemin === ouvert)) fermerDiff();
    }
    surBranche(etat ? { branche: etat.branche, detachee: etat.detachee } : null);
    surEtat(etat);
    afficher();
  }

  // ---- Affichage ----

  const ligneDe = (chemin) => [...corps.querySelectorAll("[data-chemin]")].find((e) => e.dataset.chemin === chemin);

  function ligneChangement(c) {
    const nom = nomDe(c.chemin);
    const rel = worktree.dansWorktree(c.chemin);
    const type = iconeDe(nom);
    const mot = `${STATUTS[c.lettre]}${c.indexe ? ", indexé" : ""}`;
    return {
      id: c.chemin,
      libelle: nom,
      dossier: dossierDe(rel) || undefined,
      icone: type.icone,
      couleurIcone: type.couleur,
      statut: c.lettre,
      indexe: c.indexe,
      infoBulle: `${rel}, ${mot}`,
      actionLigne: c.indexe ? undefined : { icone: "plus", nomAccessible: `Indexer ${nom}`, infoBulle: "Indexer", touche: "I", surClic: indexer },
    };
  }

  function afficherWorktree() {
    const liste = etat ? worktree.lister() : [];
    const raison = worktree.occupe();
    zoneWorktree.hidden = liste.length < 2;
    const cle = JSON.stringify([liste, worktree.choisi(), occupe, raison]);
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
      desactive: occupe || Boolean(raison),
      raison,
    });
    const select = c.querySelector("select");
    select.addEventListener("change", () => worktree.choisir(select.value));
    zoneWorktree.replaceChildren(c);
    if (avait) select.focus({ preventScroll: true });
  }

  const desabonner = worktree.abonner(({ disparu }) => {
    if (detruit) return;
    if (worktree.choisi() !== choixVu) {
      choixVu = worktree.choisi();
      const f = document.activeElement;
      if (disparu && (zoneWorktree.contains(f) || zoneListe.contains(f))) focusPremiere = true;
      selection = null;
      if (diffOuvert()) fermerDiff();
      zoneMessage.replaceChildren();
      rafraichir();
    }
    afficherWorktree();
  });

  function afficher() {
    if (detruit) return;
    afficherWorktree();
    const f = document.activeElement;
    const listeAvant = zoneListe.querySelector("[role=listbox]");
    const avait = listeAvant?.contains(f);
    const focusChemin = avait ? (f.closest("[data-chemin]")?.dataset.chemin ?? selection) : null;
    const ligneFocus = avait ? f.closest("[data-chemin]") : null;
    let precedente = ligneFocus?.previousElementSibling;
    while (precedente && !precedente.dataset.chemin) precedente = precedente.previousElementSibling;
    const voisine = precedente?.dataset.chemin;
    const defilement = zoneListe.scrollTop;
    formulaire.hidden = !etat;
    if (!etat) {
      cleHaut = null;
      if (!refus) return zoneListe.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
      if (refus.pasDepot) return zoneListe.replaceChildren(indication({ texte: "Ce dossier n'est pas un dépôt git." }));
      return zoneListe.replaceChildren(message({ texte: refus.texte, detail: refus.detail, variante: "erreur" }));
    }
    const cle = JSON.stringify([etat.branche, etat.branches, etat.detachee, occupe, enCours]);
    if (cle !== cleHaut) {
      cleHaut = cle;
      const label = ligneBranche.contains(f) ? f.getAttribute("aria-label") : null;
      const dansBranche = ligneBranche.contains(f);
      const dansCommit = zoneCommit.contains(f);
      const b = champ({ libelle: "Branche", libelleMasque: true, type: "liste", options: etat.branches, valeur: etat.detachee ? "" : etat.branche });
      const select = b.querySelector("select");
      if (etat.detachee) {
        const o = document.createElement("option");
        o.textContent = "(détachée)";
        o.value = "";
        o.disabled = true;
        select.prepend(o);
        select.value = "";
      }
      select.disabled = occupe;
      select.addEventListener("change", () => changerBranche(select.value));
      ligneBranche.replaceChildren(icone("branch", 14), b, ...boutonsSynchro());
      zoneCommit.replaceChildren(boutonAction("Commit", "principal", "check", "Ctrl+Entrée", "Control+Enter", valider));
      if (dansBranche) {
        const cible = label ? [...ligneBranche.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === label) : null;
        (cible ?? select).focus({ preventScroll: true });
      } else if (dansCommit) zoneCommit.querySelector("button")?.focus({ preventScroll: true });
    }

    let contenu;
    if (etat.changements.length === 0) contenu = indication({ texte: "Aucun changement." });
    else {
      const indexes = etat.changements.filter((c) => c.indexe);
      const autres = etat.changements.filter((c) => !c.indexe);
      const lignes = [];
      for (const [titre, groupe] of [["Modifications indexées", indexes], ["Modifications", autres]]) {
        if (groupe.length === 0) continue;
        lignes.push({ id: `groupe:${titre}`, libelle: titre, groupe: true, compteur: groupe.length }, ...groupe.map(ligneChangement));
      }
      contenu = liste({ lignes, selection: diffOuvert() ?? selection ?? undefined, surActiver: ouvrirDiff });
      contenu.setAttribute("aria-label", "Changements");
      // Les lignes suivent l'ordre des sections : indexées, puis les autres.
      const ordre = [...indexes, ...autres];
      contenu.querySelectorAll("[role=option]").forEach((e, i) => {
        e.dataset.chemin = ordre[i].chemin;
        if (occupe) for (const plus of e.querySelectorAll("button")) plus.disabled = true;
      });
    }
    zoneListe.replaceChildren(contenu);
    zoneListe.scrollTop = defilement;
    if (focusPremiere) {
      focusPremiere = false;
      (zoneListe.querySelector("[role=option]") ?? saisie()).focus({ preventScroll: true });
      return;
    }
    if (avait) {
      const cible = (focusChemin !== null && ligneDe(focusChemin)) || (ligneFocus && voisine !== undefined ? ligneDe(voisine) : null);
      if (cible) cible.focus({ preventScroll: true });
      else if (ligneFocus) saisie().focus({ preventScroll: true });
    }
  }

  function boutonAction(nom, variante, icone, raccourci, touche, clic) {
    const b = bouton({
      icone,
      variante,
      ...(variante === "principal" ? { libelle: nom } : { nomAccessible: nom }),
      raccourci,
      touche,
      desactive: occupe,
      ...(enCours === nom ? { libelleEnCours: `${nom}…` } : {}),
    });
    b.addEventListener("click", clic);
    return b.enveloppe;
  }

  const boutonsSynchro = () => [
    boutonAction("Pull", "secondaire", "arrow-down", undefined, undefined, () => synchroniser("Pull", gitPull)),
    boutonAction("Push", "secondaire", "arrow-up", undefined, undefined, () => synchroniser("Push", gitPush)),
  ];

  /** Fonction qui redonne le focus au contrôle qui l'a maintenant, même s'il est refait entre-temps. */
  function retenirFocus() {
    const f = document.activeElement;
    const rang = [...formulaire.querySelectorAll("button")].indexOf(f);
    if (rang >= 0) return () => formulaire.querySelectorAll("button")[rang]?.focus();
    if (f?.tagName === "SELECT" && corps.contains(f)) return () => corps.querySelector("select")?.focus();
    if (f === saisie()) return () => saisie().focus();
    return () => {};
  }

  // ---- Actions ----

  /** Message d'échec d'une action git : `detail` est le message de git, tel quel. */
  function echec(r, texte = "Git a refusé.") {
    if (r.coupure) return message({ texte: TEXTE_COUPURE, variante: "alerte" });
    return message({ texte, detail: r.message, variante: "erreur" });
  }

  async function avec(nom, action) {
    if (occupe) return;
    occupe = true;
    enCours = nom ?? null;
    const retour = retenirFocus();
    refocaliser = null;
    zoneMessage.replaceChildren();
    // Une alerte du champ « Message » ne survit pas à l'action suivante.
    champMessage.replaceWith((champMessage = nouveauChamp(saisie().value)));
    afficher();
    try {
      await action();
    } finally {
      occupe = false;
      enCours = null;
      if (!detruit) {
        await rafraichir();
        // Le focus n'est rendu que s'il est perdu : l'utilisateur a pu partir ailleurs pendant l'action.
        if (!document.activeElement || document.activeElement === document.body) (refocaliser ?? retour)();
      }
    }
  }

  async function ouvrirDiff(chemin) {
    selection = chemin;
    const r = await gitDiff(chemin);
    if (detruit) return;
    if (r.cause || r.coupure) return dire({ texte: r.coupure ? TEXTE_COUPURE : `Impossible d'afficher le diff : ${r.message}`, variante: "alerte", fermable: true });
    let avis;
    if (r.binaire) avis = "Fichier binaire : pas de diff.";
    else if (r.trop_gros) avis = "Fichier trop gros pour afficher son diff.";
    surDiff({ chemin, texte: r.diff, avis });
    afficher();
  }

  function indexer(chemin) {
    selection = chemin;
    return avec(null, async () => {
      const r = await gitIndexer(chemin);
      if (r.cause || r.coupure) zoneMessage.replaceChildren(echec(r));
    });
  }

  function valider() {
    return avec("Commit", async () => {
      const texte = saisie().value;
      const r = await gitCommit(texte);
      if (!r.cause && !r.coupure) {
        saisie().value = "";
        zoneMessage.replaceChildren(message({ texte: "Commit créé.", variante: "succes" }));
      } else if (r.cause === "message-vide") {
        champMessage.replaceWith((champMessage = nouveauChamp(saisie().value, r.message)));
        refocaliser = () => saisie().focus();
      } else if (r.cause === "aucun-indexe") zoneMessage.replaceChildren(message({ texte: r.message, variante: "erreur" }));
      else zoneMessage.replaceChildren(echec(r));
    });
  }

  function synchroniser(nom, appel) {
    return avec(nom, async () => {
      worktree.occuper(`Attendez la fin du ${nom === "Pull" ? "pull" : "push"}.`);
      let r;
      try {
        r = await appel();
      } finally {
        worktree.occuper();
      }
      if (r.cause || r.coupure) zoneMessage.replaceChildren(echec(r, "Git a refusé. Réglez cela dans le shell."));
      else zoneMessage.replaceChildren(message({ texte: `${nom} terminé.`, variante: "succes" }));
      surDisque();
    });
  }

  function changerBranche(nom) {
    return avec(null, async () => {
      const r = await gitBranche(nom);
      if (r.cause || r.coupure) zoneMessage.replaceChildren(echec(r));
      surDisque();
    });
  }

  afficher();
  rafraichir();
  return {
    corps,
    rafraichir,
    relire,
    /** Vrai si un état a été lu : le dossier est un dépôt. */
    estDepot: () => etat !== null,
    /** Met le focus dans « Message » ; le texte déjà écrit reste. */
    focuserMessage: () => saisie().focus(),
    /** Affiche ou cache le panneau ; l'afficher relit l'état. */
    montrer(oui) {
      corps.hidden = !oui;
      if (oui) rafraichir();
    },
    detruire() {
      detruit = true;
      desabonner();
    },
  };
}
