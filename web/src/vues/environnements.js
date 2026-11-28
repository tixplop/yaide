import { enregistrerEnvironnement, lireEnvironnements, marquerEnvironnementDefaut, supprimerEnvironnement } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue, fiche } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const ERREUR_NOM_VIDE = "Donnez un nom à l'environnement.";
const ERREUR_NOM_PRIS = "Ce nom est déjà pris. Choisissez-en un autre.";
const ERREUR_VARIABLES = "Variables : une par ligne, sous la forme NOM=valeur (lettres, chiffres et _ dans le nom).";
const NOM_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const texteIllisible = (f) => `${f} est illisible. Corrigez-le, puis rouvrez Environnements.`;
const texteAide = (f) =>
  `Dans ${f}, pour tous vos projets. Clic droit sur «\u00a0Nouveau shell\u00a0», «\u00a0Claude\u00a0» ou «\u00a0opencode\u00a0» pour lancer avec un environnement.`;
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");
const sansCasse = (t) => t.toLowerCase();

/** Lignes `NOM=valeur` → `{ variables }` (la valeur est tout ce qui suit le premier `=`), ou `{ refus: true }`. */
function lireVariables(texte) {
  const variables = {};
  for (const ligne of texte.split(/\r?\n/)) {
    if (ligne.trim() === "") continue;
    const i = ligne.indexOf("=");
    if (i < 0 || !NOM_VARIABLE.test(ligne.slice(0, i))) return { refus: true };
    variables[ligne.slice(0, i)] = ligne.slice(i + 1);
  }
  return { variables };
}

/**
 * REQ-182, V-014. Dialogue « Environnements » : `ouvrir()` relit `environnements.json` du dossier de configuration de l'utilisateur
 * et montre la liste ; ajouter, modifier ou supprimer un environnement écrit aussitôt le fichier.
 * `surFermeture()` est appelé après la fermeture (Fermer, Échap).
 */
export function vueEnvironnements({ surFermeture = () => {} } = {}) {
  let dlg = null;
  let generation = 0;
  let environnements = [];
  let enregistrement = false;
  let fichier = null;
  let ecritureCase = false;

  function fermer() {
    if (!dlg || ecritureCase) return;
    generation++;
    dlg.fermer({ rendreFocus: false });
    dlg = null;
    surFermeture();
  }

  const poserActions = (...b) => dlg.element.querySelector(".dialogue-actions").replaceChildren(...b);
  const boutonDe = (nomAccessible) => [...dlg.element.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nomAccessible);
  const retenirFichier = (r) => {
    if (typeof r.fichier === "string") fichier = r.fichier;
  };
  const poserAide = () => {
    if (!fichier) return;
    const aide = document.createElement("p");
    aide.className = "ya-groupe-aide ya-aide-liste";
    aide.textContent = texteAide(fichier);
    dlg.definirAide(aide);
  };
  const messageEchec = (r, perdu) =>
    r.coupure
      ? message({ texte: TEXTE_COUPURE, variante: "erreur" })
      : r.cause === "illisible"
        ? message({ texte: texteIllisible(fichier), variante: "erreur", detail: r.detail })
        : message({ texte: `${perdu} : ${sansPoint(r.message)}.`, variante: "erreur" });

  // Lecture impossible ou fichier illisible : ni liste ni ajout, seul « Fermer » avec le focus.
  function afficherEchecLecture(r) {
    const f = bouton({ libelle: "Fermer" });
    f.addEventListener("click", fermer);
    dlg.remplacer([messageEchec(r, `Impossible de lire ${fichier}`)]);
    dlg.definirResultat();
    poserActions(f);
    f.focus();
  }

  // `focus` : environnement dont « Modifier » prend le focus ; absent ou inconnu → le premier, sinon « Ajouter un environnement ».
  function afficherListe({ resultat, focus, focusSuppression, focusCase, focusAjout = false } = {}) {
    const f = bouton({ libelle: "Fermer" });
    const ajouter = bouton({ libelle: "Ajouter un environnement", variante: "principal" });
    f.addEventListener("click", fermer);
    ajouter.addEventListener("click", () => afficherFiche({ valeurs: { nom: "", variables: "", defaut: false } }));
    let ul = null;
    // REQ-202 : la case change aussitôt (l'ancienne est décochée), puis écrit ; un échec rejette, la liste rend les cases.
    async function surCase(nom, cochee) {
      dlg.definirResultat();
      const ancienne = cochee ? environnements.find((e) => e.defaut && e.nom !== nom)?.nom : undefined;
      if (ancienne !== undefined) ul.cocher(ancienne, false);
      const r = await marquerEnvironnementDefaut(nom, cochee);
      retenirFichier(r);
      if (Array.isArray(r.environnements)) {
        environnements = r.environnements;
        return afficherListe({
          resultat: message({ texte: cochee ? `Environnement par défaut : ${nom}. Il servira au prochain lancement.` : "Aucun environnement par défaut.", variante: "succes" }),
          focusCase: nom,
        });
      }
      if (r.cause === "inconnu") {
        const rang = environnements.findIndex((e) => e.nom === nom);
        const voisin = environnements[rang + 1] ?? environnements[rang - 1];
        const relue = await lireEnvironnements();
        retenirFichier(relue);
        if (!Array.isArray(relue.environnements)) return afficherEchecLecture(relue);
        environnements = relue.environnements;
        return afficherListe({ resultat: message({ texte: `L'environnement ${nom} n'existe plus.`, variante: "erreur" }), focusCase: voisin?.nom, focusAjout: !voisin });
      }
      if (ancienne !== undefined) ul.cocher(ancienne, true);
      dlg.definirResultat(
        r.coupure
          ? message({ texte: TEXTE_COUPURE, variante: "erreur" })
          : r.cause === "illisible"
            ? message({ texte: texteIllisible(fichier), variante: "erreur" })
            : message({ texte: `Enregistrement impossible : ${sansPoint(r.message)}.`, variante: "erreur" }),
      );
      throw new Error("écriture refusée");
    }
    const contenu =
      environnements.length === 0
        ? indication({ texte: "Aucun environnement." })
        : (ul = liste({
            variante: "objets",
            nom: "Environnements",
            surCase,
            surEcriture: (vrai) => {
              ecritureCase = vrai;
              f.disabled = vrai;
              ajouter.disabled = vrai;
            },
            lignes: environnements.map((e) => {
              const noms = Object.keys(e.variables ?? {});
              return {
                id: e.nom,
                libelle: e.nom,
                dossier: noms.length ? noms.join(", ") : "Aucune variable",
                case: { libelle: "par défaut", cochee: e.defaut === true },
                policeCode: noms.length > 0,
                actions: [
                  { icone: "sliders-horizontal", nomAccessible: `Modifier ${e.nom}`, infoBulle: "Modifier", surClic: ouvrirFiche },
                  { icone: "trash", nomAccessible: `Supprimer ${e.nom}`, infoBulle: "Supprimer", surClic: demanderSuppression },
                ],
              };
            }),
          }));
    dlg.remplacer([contenu]);
    dlg.definirResultat(resultat);
    poserActions(f, ajouter);
    const cible =
      (focusAjout && ajouter) ||
      (focusCase !== undefined && [...ul.children].find((li) => li.dataset.id === focusCase)?.querySelector(".ya-objet-case input")) ||
      (focusSuppression !== undefined && boutonDe(`Supprimer ${focusSuppression}`)) ||
      (focus !== undefined && boutonDe(`Modifier ${focus}`)) ||
      (environnements[0] && boutonDe(`Modifier ${environnements[0].nom}`)) ||
      ajouter;
    cible.focus();
  }

  function ouvrirFiche(nom) {
    const e = environnements.find((x) => x.nom === nom);
    if (!e) return;
    afficherFiche({
      ancien: e.nom,
      valeurs: { nom: e.nom, variables: Object.entries(e.variables ?? {}).map(([n, v]) => `${n}=${v}`).join("\n"), defaut: e.defaut === true },
    });
  }

  // `erreurs` : refus par champ (`nom`, `variables`), le focus va dans le premier champ refusé.
  function afficherFiche({ ancien, valeurs, erreurs = {} }) {
    const cNom = champ({ libelle: "Nom", valeur: valeurs.nom, erreur: erreurs.nom });
    const cVariables = champ({
      libelle: "Variables",
      type: "multiligne",
      sansRetour: true,
      valeur: valeurs.variables,
      aide: "Une par ligne : NOM=valeur. Elles sont écrites en clair dans ce fichier.",
      erreur: erreurs.variables,
    });
    const cDefaut = champ({
      libelle: "Environnement par défaut",
      type: "case",
      valeur: valeurs.defaut,
      aide: "Sert quand vous lancez un shell, Claude ou opencode sans choisir d'environnement.",
    });
    cDefaut.classList.add("ya-fiche-large");
    const saisies = { nom: cNom.querySelector("input"), variables: cVariables.querySelector("textarea"), defaut: cDefaut.querySelector("input") };
    const contenu = fiche({ titre: ancien ?? "Nouvel environnement", champs: [cNom, cVariables, cDefaut] });
    const annuler = bouton({ libelle: "Annuler" });
    const enregistrer = bouton({ libelle: "Enregistrer", variante: "principal" });

    async function valider() {
      if (enregistrement || !dlg) return;
      const saisie = { nom: saisies.nom.value, variables: saisies.variables.value, defaut: saisies.defaut.checked };
      const nom = saisie.nom.trim();
      const lues = lireVariables(saisie.variables);
      const refus = {};
      if (nom === "") refus.nom = ERREUR_NOM_VIDE;
      else if (environnements.some((e) => e.nom !== ancien && sansCasse(e.nom) === sansCasse(nom))) refus.nom = ERREUR_NOM_PRIS;
      if (lues.refus) refus.variables = ERREUR_VARIABLES;
      if (refus.nom || refus.variables) return afficherFiche({ ancien, valeurs: saisie, erreurs: refus });
      enregistrement = true;
      const mienne = generation;
      const avecFocus = document.activeElement === enregistrer;
      const enCours = bouton({ libelle: "Enregistrer", libelleEnCours: "Enregistrement…", variante: "principal" });
      enregistrer.replaceWith(enCours);
      annuler.disabled = true;
      dlg.definirResultat();
      const r = await enregistrerEnvironnement({ ...(ancien !== undefined ? { ancien } : {}), nom, variables: lues.variables, ...(saisie.defaut ? { defaut: true } : {}) });
      enregistrement = false;
      if (!dlg || mienne !== generation) return;
      retenirFichier(r);
      if (Array.isArray(r.environnements)) {
        environnements = r.environnements;
        return afficherListe({
          resultat: message({ texte: `Environnement ${nom} enregistré. Il servira au prochain lancement.`, variante: "succes" }),
          focus: nom,
        });
      }
      if (r.champ === "nom" || r.champ === "variables") return afficherFiche({ ancien, valeurs: saisie, erreurs: { [r.champ]: r.message } });
      enCours.replaceWith(enregistrer);
      annuler.disabled = false;
      dlg.definirResultat(messageEchec(r, "Enregistrement impossible"));
      if (avecFocus) enregistrer.focus();
    }

    annuler.addEventListener("click", () => afficherListe({ focus: ancien, focusAjout: ancien === undefined }));
    enregistrer.addEventListener("click", valider);
    // Entrée dans « Nom » enregistre ; dans « Variables », elle ajoute une ligne.
    contenu.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target.matches("input[type=text]")) {
        ev.preventDefault();
        valider();
      }
    });
    dlg.remplacer([contenu]);
    dlg.definirResultat();
    poserActions(annuler, enregistrer);
    (["nom", "variables"].map((k) => erreurs[k] && saisies[k]).find(Boolean) ?? saisies.nom).focus();
  }

  function demanderSuppression(nom) {
    if (!dlg) return;
    dlg.definirResultat();
    const phrase = document.createElement("p");
    phrase.textContent = "Ses variables seront perdues. Ce qui est déjà lancé avec lui les garde.";
    if (environnements.find((e) => e.nom === nom)?.defaut) phrase.textContent += " Il n'y aura plus d'environnement par défaut.";
    const annuler = bouton({ libelle: "Annuler" });
    const ok = bouton({ libelle: "Supprimer", variante: "danger" });
    const mienne = generation;
    const conf = dialogue({
      titre: `Supprimer l'environnement ${nom} ?`,
      contenu: [phrase],
      actions: [annuler, ok],
      focusInitial: annuler,
      surAnnuler: () => abandonner(),
    });
    const abandonner = () => {
      conf.fermer({ rendreFocus: false });
      boutonDe(`Supprimer ${nom}`)?.focus();
    };
    annuler.addEventListener("click", abandonner);
    ok.addEventListener("click", async () => {
      conf.enCours(true);
      const r = await supprimerEnvironnement(nom);
      conf.fermer({ rendreFocus: false });
      if (!dlg || mienne !== generation) return;
      retenirFichier(r);
      if (Array.isArray(r.environnements)) {
        const rang = environnements.findIndex((e) => e.nom === nom);
        const voisin = environnements[rang + 1] ?? environnements[rang - 1];
        environnements = r.environnements;
        return afficherListe({ resultat: message({ texte: `Environnement ${nom} supprimé.`, variante: "succes" }), focus: voisin?.nom });
      }
      afficherListe({ resultat: messageEchec(r, "Suppression impossible"), focusSuppression: nom });
    });
    conf.ouvrir();
  }

  async function ouvrir() {
    if (dlg) return;
    const mienne = ++generation;
    fichier = null;
    const f = bouton({ libelle: "Fermer" });
    f.addEventListener("click", fermer);
    dlg = dialogue({
      titre: "Environnements",
      position: "reglages",
      contenu: [indication({ texte: "Chargement…", variante: "chargement" })],
      actions: [f, bouton({ libelle: "Ajouter un environnement", variante: "principal", desactive: true })],
      focusInitial: f,
      surAnnuler: fermer,
    });
    ecritureCase = false;
    dlg.ouvrir();
    // Pendant le chargement, le focus est sur le dialogue.
    dlg.element.tabIndex = -1;
    dlg.element.focus();
    const r = await lireEnvironnements();
    if (!dlg || mienne !== generation) return;
    retenirFichier(r);
    poserAide();
    if (Array.isArray(r.environnements)) {
      environnements = r.environnements;
      return afficherListe();
    }
    afficherEchecLecture(r);
  }

  return { ouvrir };
}
