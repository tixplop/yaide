import { gitBranche, gitCommit, gitDiff, gitEtat, gitIndexer, gitPull, gitPush } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const nomDe = (chemin) => chemin.split("/").pop();

const COULEUR_STATUT = { modifié: "statut-modifie", nouveau: "statut-nouveau", supprimé: "erreur", renommé: "statut-renomme", conflit: "statut-conflit", indexé: "succes" };

/**
 * V-005. Rappels : `surBranche({ branche, detachee } | null)`, `surDiff({ chemin, texte, avis })`,
 * `diffOuvert()` (chemin du diff ouvert ou null), `fermerDiff()`, `surDisque()` (le disque a peut-être changé).
 * Rend `{ corps, pied, rafraichir(), montrer(oui), detruire() }`.
 */
export function vueGit({ dire, surBranche = () => {}, surDiff = () => {}, diffOuvert = () => null, fermerDiff = () => {}, surDisque = () => {} }) {
  const corps = document.createElement("div");
  corps.className = "git-corps";
  const pied = document.createElement("div");
  pied.className = "git-pied";
  pied.hidden = true;
  corps.hidden = true;
  let visible = false;

  let etat = null; // dernier état lu du serveur
  let refus = null; // { pasDepot } ou { texte, detail } quand rien n'a pu être lu
  let selection = null;
  let enCours = null; // "Commit", "Pull" ou "Push" pendant une action
  let occupe = false;
  let sequence = 0;
  let refocaliser = null; // focus voulu par l'action en cours, à la place du contrôle d'origine
  let detruit = false;

  const zoneMessage = document.createElement("div");
  const actions = document.createElement("div");
  actions.className = "git-actions";
  let champMessage = nouveauChamp("");
  pied.append(champMessage, zoneMessage, actions);

  const saisie = () => champMessage.querySelector("textarea");

  function nouveauChamp(valeur, erreur) {
    const c = champ({ libelle: "Message", type: "multiligne", valeur, erreur });
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
      else refus = { texte: TEXTE_COUPURE };
    } else if (r.cause === "pas-depot") {
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
    afficher();
  }

  // ---- Affichage ----

  const ligneDe = (chemin) => [...corps.querySelectorAll("[data-chemin]")].find((e) => e.dataset.chemin === chemin);

  function afficher() {
    if (detruit) return;
    const avait = corps.querySelector("[role=listbox]")?.contains(document.activeElement);
    pied.hidden = !visible || !etat;
    if (!etat) {
      if (!refus) return corps.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
      if (refus.pasDepot) return corps.replaceChildren(indication({ texte: "Ce dossier n'est pas un dépôt git." }));
      return corps.replaceChildren(message({ texte: refus.texte, detail: refus.detail, variante: "erreur" }));
    }
    const options = etat.branches;
    const b = champ({ libelle: "Branche", type: "liste", options, valeur: etat.detachee ? "" : etat.branche });
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

    const titre = document.createElement("h3");
    titre.className = "git-titre";
    titre.textContent = "Changements";

    let contenu;
    if (etat.changements.length === 0) contenu = indication({ texte: "Aucun changement." });
    else {
      const lignes = etat.changements.map((c) => ({
        id: c.chemin,
        libelle: c.chemin,
        secondaire: c.statut,
        couleurSecondaire: COULEUR_STATUT[c.statut],
        secondaireFort: c.statut === "conflit",
        actionLigne: c.indexe ? undefined : { icone: "plus", nomAccessible: `Indexer ${nomDe(c.chemin)}`, infoBulle: "Indexer", touche: "I", surClic: indexer },
      }));
      contenu = liste({ lignes, selection: diffOuvert() ?? selection ?? undefined, surActiver: ouvrirDiff });
      contenu.setAttribute("aria-label", "Changements");
      etat.changements.forEach((c, i) => {
        contenu.children[i].dataset.chemin = c.chemin;
        if (occupe) for (const plus of contenu.children[i].querySelectorAll("button")) plus.disabled = true;
      });
    }
    corps.replaceChildren(b, titre, contenu);
    if (avait && selection !== null) ligneDe(selection)?.focus();
    afficherActions();
  }

  function afficherActions() {
    const faire = (nom, variante, icone, raccourci, touche, clic) => {
      const b = bouton({ icone, variante, nomAccessible: nom, raccourci, touche, desactive: occupe, ...(enCours === nom ? { libelleEnCours: `${nom}…` } : {}) });
      b.addEventListener("click", clic);
      return b.enveloppe;
    };
    actions.replaceChildren(
      faire("Commit", "principal", "check", "Ctrl+Entrée", "Control+Enter", valider),
      faire("Pull", "secondaire", "arrow-down", undefined, undefined, () => synchroniser("Pull", gitPull)),
      faire("Push", "secondaire", "arrow-up", undefined, undefined, () => synchroniser("Push", gitPush)),
    );
  }

  /** Fonction qui redonne le focus au contrôle qui l'a maintenant, même s'il est refait entre-temps. */
  function retenirFocus() {
    const f = document.activeElement;
    // Les enfants de `actions` sont des enveloppes : on compte et on focalise les boutons qu'elles contiennent.
    const rang = [...actions.querySelectorAll("button")].indexOf(f);
    if (rang >= 0) return () => actions.querySelectorAll("button")[rang]?.focus();
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
      const r = await appel();
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
    pied,
    rafraichir,
    /** Vrai si un état a été lu : le dossier est un dépôt. */
    estDepot: () => etat !== null,
    /** Met le focus dans « Message » ; le texte déjà écrit reste. */
    focuserMessage: () => saisie().focus(),
    /** Affiche ou cache le panneau ; l'afficher relit l'état. */
    montrer(oui) {
      visible = oui;
      corps.hidden = !oui;
      pied.hidden = !oui || !etat;
      if (oui) rafraichir();
    },
    detruire() {
      detruit = true;
    },
  };
}
