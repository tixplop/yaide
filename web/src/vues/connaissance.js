import { chercherConnaissance, enregistrerConfigConnaissance, lireConnaissance, lireFichiersConnaissance, supprimerConnaissance } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const PROVIDERS = [
  { valeur: "openai", texte: "OpenAI" },
  { valeur: "google", texte: "Google" },
  { valeur: "openrouter", texte: "OpenRouter" },
  { valeur: "litellm", texte: "LiteLLM" },
  { valeur: "ollama", texte: "Ollama" },
];
const AIDE_CONFIG = "Dans .yaide/connaissance/config.json, pour ce projet. Les fichiers ajoutés et les questions partent à ce provider, avec l'adresse et la clé de Providers LLM.";
const AIDE_MODELE = "Un modèle d'embedding de ce provider, par exemple nomic-embed-text.";
const AIDE_COLLECTIONS = "Une collection naît de son premier ajout : clic droit sur un fichier ou un dossier de l'arborescence, puis Ajouter à la base de connaissance…";
const TEXTE_VERROU = "Pour changer de provider ou de modèle, supprimez d'abord les collections : les vecteurs de deux modèles ne se comparent pas.";
const SECTIONS = [
  { id: "configuration", libelle: "Configuration" },
  { id: "collections", libelle: "Collections" },
  { id: "recherche", libelle: "Recherche" },
];

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const nombres = (c) => `${pluriel(c.fichiers, "fichier")} · ${pluriel(c.passages, "passage")}`;
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");
const paragraphe = (texte) => {
  const p = document.createElement("p");
  p.className = "ya-groupe-aide";
  p.textContent = texte;
  return p;
};
const enColonne = (...noeuds) => {
  const f = document.createElement("div");
  f.className = "ya-fiche";
  f.append(...noeuds);
  return f;
};

/**
 * REQ-103, REQ-105, V-013. Dialogue « Base de connaissance » : sections Configuration, Collections et Recherche (REQ-106).
 * `ouvrir({ configurer, surFermeture })` lit l'état de la base ; `configurer` choisit « Configuration » ; `surFermeture` remplace le retour du focus
 * au bouton (le dialogue vient d'ailleurs). `surEtat(ouvert)` suit l'ouverture.
 * `ouvrirFichier({ chemin, ligne }, avantOuverture)` ouvre un passage dans l'éditeur : rend le texte du refus, ou rien.
 * Question, collection et passages restent en mémoire jusqu'au rechargement de la page.
 */
export function vueConnaissance({ surEtat = () => {}, ouvrirFichier = async () => {} } = {}) {
  let dlg = null;
  let generation = 0;
  let etat = null;
  let retour = null;
  let minuteur = null;
  let barre = null;
  let section = "configuration";
  let fichiersDe = null; // collection dont la section « Collections » montre les fichiers
  let signature = "";
  let erreurModele;
  let saisie = { provider: "openai", modele: "" };
  let panneaux = {};
  let enregistrement = false;
  const memoire = { question: "", collection: "", passages: null };
  let recherche = null; // éléments de la section « Recherche » affichée
  let rechercheEnCours = false;
  const fermer = bouton({ libelle: "Fermer" });
  const enregistrer = bouton({ libelle: "Enregistrer", variante: "principal" });

  function arreter({ rendreFocus = true } = {}) {
    if (!dlg) return;
    generation++;
    clearTimeout(minuteur);
    const d = dlg;
    const apres = retour;
    dlg = null;
    retour = null;
    d.fermer({ rendreFocus: rendreFocus && !apres });
    surEtat(false);
    if (rendreFocus) apres?.();
  }

  const verrou = () => etat.collections.length > 0;
  const poserActions = (...b) => dlg.element.querySelector(".dialogue-actions").replaceChildren(...b);
  const majActions = () => poserActions(...(section === "configuration" && !verrou() ? [fermer, enregistrer] : [fermer]));
  const boutonDe = (nom) => [...dlg.element.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom);
  const ongletDe = (id) => barre.querySelector(`[role=tab][id$="-onglet-${id}"]`);
  const messageEchec = (r, perdu) => (r.coupure ? message({ texte: TEXTE_COUPURE, variante: "erreur" }) : message({ texte: `${perdu} : ${sansPoint(r.message)}.`, variante: "erreur" }));

  // Lecture impossible ou fichier illisible : ni sections ni champs, seul « Fermer » avec le focus.
  function afficherEchecLecture(r) {
    let m;
    if (r.coupure) m = message({ texte: TEXTE_COUPURE, variante: "erreur" });
    else if (r.cause) m = message({ texte: `Impossible de lire .yaide/connaissance/ : ${sansPoint(r.message)}.`, variante: "erreur" });
    else {
      const [, brut] = /config\.json est illisible : ([\s\S]*)$/.exec(r.erreur) ?? [];
      m =
        brut !== undefined
          ? message({ texte: ".yaide/connaissance/config.json est illisible. Corrigez-le, puis rouvrez Base de connaissance.", variante: "erreur", detail: brut })
          : message({ texte: `Impossible de lire .yaide/connaissance/ : ${sansPoint(r.erreur)}.`, variante: "erreur" });
    }
    dlg.element.classList.remove("ya-reglages-sections");
    dlg.element.querySelector(":scope > .ya-sections-hote")?.remove();
    dlg.remplacer([m]);
    poserActions(fermer);
    fermer.focus();
  }

  // ---- Configuration ----

  function rendreConfiguration({ focus = false } = {}) {
    const verrouille = verrou();
    const cProvider = champ({ libelle: "Provider", type: "liste", options: PROVIDERS, valeur: saisie.provider, desactive: verrouille });
    const cModele = champ({ libelle: "Modèle", valeur: saisie.modele, aide: AIDE_MODELE, desactive: verrouille, erreur: erreurModele });
    const grille = document.createElement("div");
    grille.className = "ya-fiche-champs";
    grille.append(cProvider, cModele);
    const selProvider = cProvider.querySelector("select");
    const inModele = cModele.querySelector("input");
    selProvider.addEventListener("change", () => (saisie.provider = selProvider.value));
    inModele.addEventListener("input", () => (saisie.modele = inModele.value));
    inModele.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        valider();
      }
    });
    panneaux.configuration.replaceChildren(
      enColonne(paragraphe(AIDE_CONFIG), ...(verrouille ? [message({ texte: TEXTE_VERROU, variante: "info" })] : []), grille),
    );
    if (focus) (erreurModele ? inModele : selProvider).focus();
    return { selProvider, inModele };
  }

  async function valider() {
    if (enregistrement || !dlg || verrou()) return;
    const modele = saisie.modele.trim();
    dlg.definirResultat();
    if (modele === "") {
      erreurModele = "Donnez le nom du modèle.";
      rendreConfiguration({ focus: true });
      return;
    }
    erreurModele = undefined;
    enregistrement = true;
    const mienne = generation;
    const avecFocus = document.activeElement === enregistrer;
    const dansModele = document.activeElement === panneaux.configuration.querySelector("input");
    const enCours = bouton({ libelle: "Enregistrer", libelleEnCours: "Enregistrement…", variante: "principal" });
    enregistrer.replaceWith(enCours);
    const r = await enregistrerConfigConnaissance(saisie.provider, modele);
    enregistrement = false;
    if (!dlg || mienne !== generation) return;
    enCours.replaceWith(enregistrer);
    if (Array.isArray(r.collections)) {
      etat = r;
      saisie = { provider: r.config?.provider ?? saisie.provider, modele: r.config?.modele ?? modele };
      const { inModele } = rendreConfiguration();
      rendreRecherche();
      if (dansModele) inModele.focus();
      dlg.definirResultat(message({ texte: "Configuration enregistrée.", variante: "succes" }));
    } else dlg.definirResultat(messageEchec(r, "Enregistrement impossible"));
    if (avecFocus) enregistrer.focus();
  }

  // ---- Collections ----

  function rendreCollections({ focus } = {}) {
    if (fichiersDe) return rendreFichiers(focus);
    const contenu = etat.collections.length
      ? liste({
          variante: "objets",
          nom: "Collections",
          lignes: etat.collections.map((c) => ({
            id: c.nom,
            libelle: c.nom,
            dossier: c.ajout ? `Ajout : ${c.ajout.faits} / ${pluriel(c.ajout.total, "fichier")}` : nombres(c),
            actions: [
              { icone: "list", nomAccessible: `Fichiers de ${c.nom}`, infoBulle: "Voir les fichiers", surClic: ouvrirFichiers },
              { icone: "trash", nomAccessible: `Supprimer ${c.nom}`, infoBulle: "Supprimer", surClic: demanderSuppression },
            ],
          })),
        })
      : indication({ texte: "Aucune collection." });
    panneaux.collections.replaceChildren(enColonne(paragraphe(AIDE_COLLECTIONS), contenu));
    if (focus) (focus.startsWith("Fichiers de ") || focus.startsWith("Supprimer ") ? boutonDe(focus) : null)?.focus();
  }

  async function ouvrirFichiers(nom) {
    const mienne = generation;
    dlg.definirResultat();
    const r = await lireFichiersConnaissance(nom);
    if (!dlg || mienne !== generation) return;
    if (!Array.isArray(r.fichiers)) return dlg.definirResultat(messageEchec(r, "Impossible de lire la collection"));
    fichiersDe = { nom, fichiers: r.fichiers };
    rendreFichiers("retour");
  }

  function rendreFichiers(focus) {
    const c = etat.collections.find((x) => x.nom === fichiersDe.nom);
    if (!c) {
      fichiersDe = null;
      return rendreCollections();
    }
    const retourListe = bouton({ icone: "arrow-left", nomAccessible: "Retour aux collections", infoBulle: "Retour aux collections", positionInfoBulle: "gauche" });
    retourListe.enveloppe.classList.add("ya-agents-retour");
    retourListe.addEventListener("click", () => {
      fichiersDe = null;
      dlg.definirResultat();
      rendreCollections({ focus: `Fichiers de ${c.nom}` });
    });
    const titre = document.createElement("h2");
    titre.className = "ya-fiche-titre";
    titre.textContent = c.nom;
    const compte = document.createElement("span");
    compte.className = "ya-agents-compte";
    compte.textContent = nombres(c);
    const qui = document.createElement("div");
    qui.append(retourListe.enveloppe, titre, compte);
    const entete = document.createElement("div");
    entete.className = "ya-agents-barre";
    entete.append(qui);
    panneaux.collections.replaceChildren(
      enColonne(entete, liste({ variante: "objets", nom: `Fichiers de ${c.nom}`, lignes: fichiersDe.fichiers.map((f) => ({ id: f, libelle: f })) })),
    );
    // « retour » : entrée dans la vue ; sinon (relecture) le focus revient à l'élément de même nom.
    const cible = focus === "retour" ? retourListe : focus ? [...panneaux.collections.querySelectorAll("[aria-label]")].find((e) => e.getAttribute("aria-label") === focus) : null;
    cible?.focus();
  }

  function demanderSuppression(nom) {
    if (!dlg) return;
    dlg.definirResultat();
    const c = etat.collections.find((x) => x.nom === nom);
    if (!c) return;
    if (c.ajout) return refuserEnCours(nom, `L'ajout à ${nom} est en cours. Attendez sa fin pour supprimer la collection.`);
    const phrase = document.createElement("p");
    phrase.textContent = `Ses ${pluriel(c.fichiers, "fichier")} et ${pluriel(c.passages, "passage")} quittent la base. Les fichiers du projet ne changent pas.`;
    const annuler = bouton({ libelle: "Annuler" });
    const ok = bouton({ libelle: "Supprimer", variante: "danger" });
    const mienne = generation;
    const conf = dialogue({ titre: `Supprimer la collection ${nom} ?`, contenu: [phrase], actions: [annuler, ok], focusInitial: annuler, surAnnuler: abandonner });
    function abandonner() {
      conf.fermer({ rendreFocus: false });
      boutonDe(`Supprimer ${nom}`)?.focus();
    }
    annuler.addEventListener("click", abandonner);
    ok.addEventListener("click", async () => {
      const enCours = bouton({ libelle: "Supprimer", libelleEnCours: "Suppression…", variante: "danger" });
      ok.replaceWith(enCours);
      annuler.disabled = true;
      const r = await supprimerConnaissance(nom);
      conf.fermer({ rendreFocus: false });
      if (!dlg || mienne !== generation) return;
      if (Array.isArray(r.collections)) {
        const rang = etat.collections.findIndex((x) => x.nom === nom);
        const voisin = etat.collections[rang + 1] ?? etat.collections[rang - 1];
        etat = r;
        suivre();
        rendreCollections({ focus: voisin ? `Fichiers de ${voisin.nom}` : undefined });
        if (!voisin) ongletDe("collections").focus();
        majConfiguration();
        dlg.definirResultat(message({ texte: `Collection ${nom} supprimée.`, variante: "succes" }));
        return;
      }
      if (r.cause === "encours") return refuserEnCours(nom, r.message);
      dlg.definirResultat(messageEchec(r, "Suppression impossible"));
      boutonDe(`Supprimer ${nom}`)?.focus();
    });
    conf.ouvrir();
  }

  function refuserEnCours(nom, texte) {
    dlg.definirResultat(message({ texte, variante: "erreur" }));
    boutonDe(`Supprimer ${nom}`)?.focus();
  }

  // Le verrou a pu changer (dernière collection supprimée, premier ajout terminé) : les champs suivent.
  function majConfiguration() {
    rendreConfiguration();
    rendreRecherche();
    majActions();
  }

  // Relit la base chaque seconde tant qu'un ajout est en cours ; rien ne bouge si rien n'a changé.
  function suivre() {
    clearTimeout(minuteur);
    signature = JSON.stringify(etat.collections);
    if (!etat.collections.some((c) => c.ajout)) return;
    const mienne = generation;
    minuteur = setTimeout(async () => {
      const r = await lireConnaissance();
      if (!dlg || mienne !== generation) return;
      if (Array.isArray(r.collections)) {
        const avant = verrou();
        const nouvelle = JSON.stringify(r.collections);
        etat = r;
        if (nouvelle !== signature) {
          const actif = document.activeElement;
          const nomActif = panneaux.collections.contains(actif) ? actif.getAttribute("aria-label") : null;
          rendreCollections({ focus: nomActif ?? undefined });
          if (avant !== verrou()) majConfiguration();
        }
      }
      suivre();
    }, 1000);
  }

  // ---- Recherche ----

  function rendreRecherche({ focus = false } = {}) {
    recherche = null;
    const p = panneaux.recherche;
    if (!etat.config) {
      const configurer = bouton({ libelle: "Configurer la base" });
      configurer.addEventListener("click", () => {
        barre.choisir("configuration");
        panneaux.configuration.querySelector("select").focus();
      });
      p.replaceChildren(indication({ texte: "La base n'est pas configurée.", action: configurer }));
      return;
    }
    if (etat.collections.length === 0) {
      p.replaceChildren(indication({ texte: "Aucune collection. Ajoutez d'abord des fichiers depuis l'arborescence." }));
      return;
    }
    if (memoire.collection && !etat.collections.some((c) => c.nom === memoire.collection)) memoire.collection = "";
    const noms = etat.collections.map((c) => c.nom).sort();
    const cQuestion = champ({ libelle: "Question", valeur: memoire.question });
    const cCollection = champ({ libelle: "Collection", type: "liste", options: [{ valeur: "", texte: "Toutes les collections" }, ...noms.map((n) => ({ valeur: n, texte: n }))], valeur: memoire.collection });
    const question = cQuestion.querySelector("input");
    const choix = cCollection.querySelector("select");
    const form = document.createElement("div");
    form.className = "ya-recherche-form";
    const resultats = document.createElement("div");
    resultats.className = "ya-recherche-resultats";
    const fabriquer = () => {
      const b = bouton(
        rechercheEnCours
          ? { libelle: "Rechercher", libelleEnCours: "Recherche…", variante: "principal" }
          : { libelle: "Rechercher", variante: "principal", desactive: question.value.trim() === "" },
      );
      b.addEventListener("click", chercher);
      return b;
    };
    let lancer = fabriquer();
    form.append(cQuestion, cCollection, lancer);
    recherche = { question, resultats };
    const majBouton = () => {
      const avecFocus = document.activeElement === lancer;
      const neuf = fabriquer();
      lancer.replaceWith(neuf);
      lancer = neuf;
      if (avecFocus) neuf.focus();
    };
    recherche.majBouton = majBouton;
    question.addEventListener("input", () => {
      memoire.question = question.value;
      lancer.disabled = rechercheEnCours || question.value.trim() === "";
    });
    question.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      chercher();
    });
    choix.addEventListener("change", () => (memoire.collection = choix.value));
    p.replaceChildren(form, resultats);
    rendrePassages();
    if (focus) question.focus();
  }

  function rendrePassages(refus) {
    if (!recherche) return;
    const { resultats } = recherche;
    resultats.replaceChildren();
    if (refus) resultats.append(refus);
    const trouves = memoire.passages;
    if (!trouves) return;
    const resume = document.createElement("p");
    resume.className = "ya-recherche-resume";
    resume.setAttribute("role", "status");
    resume.textContent = trouves.length === 0 ? "Aucun passage." : `${pluriel(trouves.length, "passage")}, du plus proche au moins proche.`;
    resultats.prepend(resume);
    if (trouves.length) resultats.append(liste({ variante: "passages", nom: "Passages", lignes: trouves, surLien: ouvrirPassage }));
  }

  async function chercher() {
    if (rechercheEnCours || !recherche) return;
    const question = recherche.question.value.trim();
    if (question === "") return;
    const mienne = generation;
    rechercheEnCours = true;
    recherche.majBouton();
    const r = await chercherConnaissance(question, memoire.collection || undefined);
    rechercheEnCours = false;
    recherche?.majBouton();
    if (!dlg || mienne !== generation) return;
    if (Array.isArray(r.passages)) {
      memoire.passages = r.passages;
      rendrePassages();
      return;
    }
    memoire.passages = null;
    rendrePassages(
      r.coupure
        ? message({ texte: TEXTE_COUPURE, variante: "erreur" })
        : message({ texte: `${sansPoint(r.message)}.`, variante: "erreur", ...(r.detail ? { detail: r.detail } : {}) }),
    );
  }

  async function ouvrirPassage(p) {
    const lien = document.activeElement;
    const mienne = generation;
    const refus = await ouvrirFichier({ chemin: p.chemin, ligne: p.debut }, () => {
      if (dlg && mienne === generation) arreter({ rendreFocus: false });
    });
    if (!refus) return;
    if (!dlg || mienne !== generation || !recherche) return;
    rendrePassages(message({ texte: refus, variante: "erreur" }));
    // Les liens ont été refaits : le focus revient au lien du même passage.
    const liens = [...recherche.resultats.querySelectorAll(".ya-passage-lien")];
    const rang = (memoire.passages ?? []).indexOf(p);
    (liens[rang] ?? lien)?.focus();
  }

  // ---- Dialogue ----

  function choisir(id) {
    section = id;
    dlg.definirResultat();
    majActions();
  }

  async function ouvrir({ configurer = false, surFermeture } = {}) {
    if (dlg) return;
    const mienne = ++generation;
    retour = surFermeture ?? null;
    etat = null;
    fichiersDe = null;
    erreurModele = undefined;
    saisie = { provider: "openai", modele: "" };
    panneaux = {};
    const hote = document.createElement("div");
    hote.className = "ya-sections-hote";
    fermer.onclick = () => arreter();
    dlg = dialogue({
      titre: "Base de connaissance",
      position: "reglages",
      sections: hote,
      contenu: [indication({ texte: "Chargement…", variante: "chargement" })],
      actions: [fermer],
      focusInitial: fermer,
      surAnnuler: () => arreter(),
    });
    dlg.ouvrir();
    surEtat(true);
    // Pendant le chargement, le focus est sur le dialogue.
    dlg.element.tabIndex = -1;
    dlg.element.focus();
    const r = await lireConnaissance();
    if (!dlg || mienne !== generation) return;
    if (r.coupure || r.cause || r.erreur || !Array.isArray(r.collections)) return afficherEchecLecture(r);
    etat = r;
    if (r.config) saisie = { provider: r.config.provider, modele: r.config.modele };
    for (const s of SECTIONS) panneaux[s.id] = document.createElement("div");
    panneaux.recherche.className = "ya-recherche";
    section = configurer || !r.config ? "configuration" : "recherche";
    barre = onglets({ presentation: "sections", nomBarre: "Base de connaissance", onglets: SECTIONS, actif: section, surChoix: choisir, panneaux });
    hote.append(barre);
    rendreConfiguration();
    rendreCollections();
    rendreRecherche();
    dlg.remplacer(SECTIONS.map((s) => panneaux[s.id]), ongletDe(section));
    barre.choisir(section);
    enregistrer.onclick = valider;
    majActions();
    suivre();
    if (section === "configuration") panneaux.configuration.querySelector("select").focus();
    else if (recherche) recherche.question.focus();
    else ongletDe(section).focus();
  }

  return { ouvrir };
}
