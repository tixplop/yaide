import { creerWorkflow, depublierWorkflow, listerWorkflows, publierWorkflow } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue, fiche } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const TEXTE_AIDE = "Dans .yaide/workflows/ du projet. Un workflow publié est actif : dépubliez-le pour le modifier.";
const AIDE_NOM = "Il donne le nom du fichier dans .yaide/workflows/, et ne change plus.";
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");
const parNom = (a, b) => a.nom.toLowerCase().localeCompare(b.nom.toLowerCase());

/**
 * REQ-190, REQ-192, V-016. Dialogue « Workflows » : `ouvrir()` relit la liste à chaque ouverture. `surEtat(ouvert)` suit l'ouverture du dialogue ;
 * `ouvrirWorkflow(fichier)` ouvre l'onglet d'un workflow ; `workflowModifie(fichier)` dit si son onglet a des modifications non enregistrées ;
 * `etatWorkflow(fichier, publie)` prévient l'onglet ouvert d'une publication ou d'une dépublication. Les refus de saisie et de vérification viennent du serveur.
 */
export function vueWorkflows({ surEtat = () => {}, ouvrirWorkflow, workflowModifie, etatWorkflow }) {
  let dlg = null;
  let generation = 0;
  let workflows = [];
  let erreurs = [];
  let creation = false;
  let ul = null;
  let bas = [];

  function fermer({ rendreFocus = true } = {}) {
    if (!dlg) return;
    generation++;
    dlg.fermer({ rendreFocus });
    dlg = null;
    surEtat(false);
  }

  const poserActions = (...b) => dlg.element.querySelector(".dialogue-actions").replaceChildren(...b);
  const messageCoupure = () => message({ texte: TEXTE_COUPURE, variante: "erreur" });

  function lignesActions(w) {
    return w.publie
      ? [{ id: "bascule", libelle: "Dépublier", libelleEnCours: "Dépublication…", surClic: () => basculer(w.fichier) }]
      : [
          { id: "modifier", libelle: "Modifier", surClic: () => modifier(w.fichier) },
          { id: "bascule", libelle: "Publier", libelleEnCours: "Publication…", surClic: () => basculer(w.fichier) },
        ];
  }

  // Le focus va au premier bouton de la première ligne, sinon (ou avec `focusNouveau`) à « Nouveau workflow ».
  function afficherListe({ focusNouveau = false } = {}) {
    const f = bouton({ libelle: "Fermer" });
    const nouveau = bouton({ libelle: "Nouveau workflow", variante: "principal" });
    f.addEventListener("click", () => fermer());
    nouveau.addEventListener("click", afficherFiche);
    const contenu = erreurs.map((texte) => message({ texte, variante: "erreur" }));
    if (workflows.length === 0) contenu.push(indication({ texte: "Aucun workflow." }));
    else {
      ul = liste({
        variante: "objets",
        nom: "Workflows",
        lignes: workflows.map((w) => ({ id: w.fichier, libelle: w.nom, etat: w.publie ? "Publié" : "Brouillon", actions: lignesActions(w) })),
      });
      contenu.push(ul);
    }
    dlg.remplacer(contenu);
    dlg.definirResultat();
    poserActions(f, nouveau);
    bas = [f, nouveau];
    const premier = workflows.length > 0 && !focusNouveau ? ul.querySelector("button") : null;
    (premier ?? nouveau).focus();
  }

  function modifier(fichier) {
    fermer({ rendreFocus: false });
    ouvrirWorkflow(fichier);
  }

  async function basculer(fichier) {
    const w = workflows.find((x) => x.fichier === fichier);
    if (!w || !dlg) return;
    const mienne = generation;
    const publier = !w.publie;
    dlg.definirResultat();
    if (publier && workflowModifie(fichier)) {
      return dlg.definirResultat(message({ texte: `${w.nom} n'est pas publié :`, points: ["Enregistrez d'abord le workflow."], variante: "erreur" }));
    }
    ul.enCours(fichier, "bascule");
    for (const b of bas) b.disabled = true;
    const r = await (publier ? publierWorkflow(fichier) : depublierWorkflow(fichier));
    if (!dlg || mienne !== generation) return;
    ul.enCours(fichier);
    for (const b of bas) b.disabled = false;
    const b = [...ul.children].find((li) => li.dataset.id === fichier).querySelector("[data-action=bascule]");
    if (r.coupure) dlg.definirResultat(messageCoupure());
    else if (r.problemes) dlg.definirResultat(message({ texte: `${w.nom} n'est pas publié :`, points: r.problemes, variante: "erreur" }));
    else if (r.refus || r.cause) dlg.definirResultat(message({ texte: `${publier ? "Publication" : "Dépublication"} impossible : ${sansPoint(r.refus ?? r.message)}.`, variante: "erreur" }));
    else {
      w.publie = publier;
      ul.majLigne(fichier, { etat: publier ? "Publié" : "Brouillon", actions: lignesActions(w) });
      etatWorkflow(fichier, publier);
      dlg.definirResultat(message({ texte: publier ? `${w.nom} est publié. Son déclencheur écoute.` : `${w.nom} est un brouillon. Rien ne le lance plus.`, variante: "succes" }));
    }
    b.focus();
  }

  function afficherFiche({ valeur = "", erreur } = {}) {
    const cNom = champ({ libelle: "Nom", valeur, aide: AIDE_NOM, erreur });
    const saisie = cNom.querySelector("input");
    const contenu = fiche({ titre: "Nouveau workflow", champs: [cNom] });
    cNom.classList.add("ya-fiche-large");
    const annuler = bouton({ libelle: "Annuler" });
    const creer = bouton({ libelle: "Créer", variante: "principal" });

    async function valider() {
      if (creation || !dlg) return;
      creation = true;
      const mienne = generation;
      const nom = saisie.value;
      const enCours = bouton({ libelle: "Créer", libelleEnCours: "Création…", variante: "principal" });
      creer.replaceWith(enCours);
      annuler.disabled = true;
      dlg.definirResultat();
      const r = await creerWorkflow(nom);
      creation = false;
      if (!dlg || mienne !== generation) return;
      if (typeof r.fichier === "string") {
        fermer({ rendreFocus: false });
        return ouvrirWorkflow(r.fichier);
      }
      if (r.refus) return afficherFiche({ valeur: nom, erreur: r.refus });
      enCours.replaceWith(creer);
      annuler.disabled = false;
      dlg.definirResultat(r.coupure ? messageCoupure() : message({ texte: `Création impossible : ${sansPoint(r.message)}.`, variante: "erreur" }));
      saisie.focus();
    }

    annuler.addEventListener("click", () => afficherListe({ focusNouveau: true }));
    creer.addEventListener("click", valider);
    contenu.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target.matches("input")) {
        ev.preventDefault();
        valider();
      }
    });
    dlg.remplacer([contenu]);
    dlg.definirResultat();
    poserActions(annuler, creer);
    saisie.focus();
  }

  async function ouvrir() {
    if (dlg) return;
    const mienne = ++generation;
    const aide = document.createElement("p");
    aide.className = "ya-groupe-aide ya-aide-liste";
    aide.textContent = TEXTE_AIDE;
    const f = bouton({ libelle: "Fermer" });
    f.addEventListener("click", () => fermer());
    dlg = dialogue({
      titre: "Workflows",
      position: "reglages",
      aide,
      contenu: [indication({ texte: "Chargement…", variante: "chargement" })],
      actions: [f, bouton({ libelle: "Nouveau workflow", variante: "principal", desactive: true })],
      focusInitial: f,
      surAnnuler: () => fermer(),
    });
    dlg.ouvrir();
    surEtat(true);
    // Pendant le chargement, le focus est sur le dialogue.
    dlg.element.tabIndex = -1;
    dlg.element.focus();
    const r = await listerWorkflows();
    if (!dlg || mienne !== generation) return;
    if (r.workflows) {
      workflows = [...r.workflows].sort(parNom);
      erreurs = r.erreurs;
      return afficherListe();
    }
    // Lecture impossible : seul « Fermer », avec le focus.
    dlg.remplacer([r.coupure ? messageCoupure() : message({ texte: `Impossible de lire les workflows : ${sansPoint(r.message)}.`, variante: "erreur" })]);
    poserActions(f);
    f.focus();
  }

  return { ouvrir };
}
