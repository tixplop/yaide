import { enregistrerConfigConnaissance, lireConnaissance, lireFichiersConnaissance, supprimerConnaissance } from "../api.js";
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
 * REQ-103, REQ-105, V-013. Dialogue « Base de connaissance » : sections Configuration, Collections et Recherche (celle-ci vide, T-234).
 * `ouvrir({ configurer, surFermeture })` lit l'état de la base ; `configurer` choisit « Configuration » ; `surFermeture` remplace le retour du focus
 * au bouton (le dialogue vient d'ailleurs). `surEtat(ouvert)` suit l'ouverture.
 */
export function vueConnaissance({ surEtat = () => {} } = {}) {
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
  const fermer = bouton({ libelle: "Fermer" });
  const enregistrer = bouton({ libelle: "Enregistrer", variante: "principal" });

  function arreter() {
    if (!dlg) return;
    generation++;
    clearTimeout(minuteur);
    const d = dlg;
    const apres = retour;
    dlg = null;
    retour = null;
    d.fermer({ rendreFocus: !apres });
    surEtat(false);
    apres?.();
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
    section = configurer || !r.config ? "configuration" : "recherche";
    barre = onglets({ presentation: "sections", nomBarre: "Base de connaissance", onglets: SECTIONS, actif: section, surChoix: choisir, panneaux });
    hote.append(barre);
    rendreConfiguration();
    rendreCollections();
    dlg.remplacer(SECTIONS.map((s) => panneaux[s.id]), ongletDe(section));
    barre.choisir(section);
    enregistrer.onclick = valider;
    majActions();
    suivre();
    if (section === "configuration") panneaux.configuration.querySelector("select").focus();
    else ongletDe(section).focus();
  }

  return { ouvrir };
}
