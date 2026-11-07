import * as apiReelle from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { amenerDansLaVue, dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");
const EFFORTS = [
  ["", "Par défaut"],
  ["faible", "Faible"],
  ["moyen", "Moyen"],
  ["eleve", "Élevé"],
];
const ERREURS = {
  nom: "Donnez un nom au profil.",
  nomPris: "Ce nom est déjà pris. Choisissez-en un autre.",
  modele: "Indiquez le modèle.",
  sortieMax: "Sortie max. : un entier positif, ou vide.",
  fenetre: "Fenêtre de contexte : un entier positif, ou vide.",
  temperature: "Température : un nombre de 0 à 2, ou vide.",
};
// Ordre des champs dans le formulaire : le premier en erreur prend le focus.
const ORDRE = ["nom", "modele", "temperature", "sortieMax", "fenetre"];

const entierPositif = (t) => /^\d+$/.test(t) && Number.isSafeInteger(Number(t)) && Number(t) > 0;
const decimal = (t) => (/^(\d+([.,]\d*)?|[.,]\d+)$/.test(t) ? Number(t.replace(",", ".")) : NaN);

/**
 * V-009, motif « Réglages en dialogue ». `api` : `reglagesAgent`, `enregistrerProfil`, `supprimerProfil`.
 * `surFermeture` est appelé à la fermeture (Fermer, Échap). `retour(avecProfil)` aussi, juste avant :
 * ouvert depuis « Créer un profil », l'appelant y place le focus (champ du message, ou « Créer un profil »).
 * Rend `{ fermer, element }`.
 */
export function ouvrirProfils({ api = apiReelle, surFermeture = () => {}, retour } = {}) {
  let reglages = null;
  let choisi = null;
  let ferme = false;
  let resultat = null; // { texte, variante }
  let erreurs = {};
  let enCours = false;
  let nouveau = false; // une ligne « Nouveau profil » non enregistrée
  const brouillons = new Map(); // id (ou "nouveau") -> saisies, jusqu'à la fermeture

  const zoneBarre = document.createElement("div");
  zoneBarre.className = "profils-actions";
  const zoneListe = document.createElement("div");
  zoneListe.className = "profils-liste";
  const zoneForm = document.createElement("div");
  zoneForm.className = "dialogue-contenu";
  const chargement = indication({ texte: "Chargement…", variante: "chargement" });

  const nouveauB = bouton({ libelle: "Nouveau profil" });
  const supprimerB = bouton({ libelle: "Supprimer", variante: "danger" });
  const fermerB = bouton({ libelle: "Fermer" });
  const enregistrerB = bouton({ libelle: "Enregistrer", variante: "principal", desactive: true });
  zoneBarre.append(nouveauB, supprimerB);
  zoneBarre.hidden = true;
  let entrees = {};

  const profils = () => reglages.profils;
  const nomProvider = (id) => reglages.providers.find((p) => p.id === id)?.nom ?? id;
  const profilDe = (id) => profils().find((p) => p.id === id);
  const aucun = () => profils().length === 0;
  const lignes = () => [...profils().map((p) => p.id), ...(nouveau ? ["nouveau"] : [])];

  function fermer() {
    if (ferme) return;
    ferme = true;
    dlg.fermer({ rendreFocus: false });
    retour?.(Boolean(reglages) && !aucun());
    surFermeture();
  }
  fermerB.addEventListener("click", fermer);
  enregistrerB.addEventListener("click", enregistrer);
  nouveauB.addEventListener("click", () => {
    ajouterNouveau();
    entrees.nom.focus();
  });
  supprimerB.addEventListener("click", supprimer);

  function brouillon(id) {
    if (!brouillons.has(id)) {
      const p = profilDe(id);
      brouillons.set(id, {
        nom: p.nom,
        provider: p.provider,
        modele: p.modele,
        effort: p.effort ?? "",
        temperature: p.temperature === undefined || p.temperature === null ? "" : String(p.temperature),
        sortieMax: p.sortieMax == null ? "" : String(p.sortieMax),
        fenetre: p.fenetre == null ? "" : String(p.fenetre),
        defaut: p.defaut,
      });
    }
    return brouillons.get(id);
  }

  function ajouterNouveau() {
    if (!nouveau) {
      nouveau = true;
      brouillons.set("nouveau", { nom: "", provider: "openai", modele: "", effort: "", temperature: "", sortieMax: "", fenetre: "", defaut: false });
    }
    choisir("nouveau", { force: true });
  }

  function dessinerListe() {
    const l = liste({
      lignes: lignes().map((id) => {
        if (id === "nouveau") return { id, libelle: "Nouveau profil" };
        const p = profilDe(id);
        return { id, libelle: p.nom, dossier: `${nomProvider(p.provider)} · ${p.modele}`, fin: p.defaut ? "par défaut" : undefined };
      }),
      selection: choisi,
      surSelection: ([id]) => choisir(id),
      surActiver: (id) => {
        choisir(id);
        entrees.nom.focus();
      },
    });
    l.setAttribute("aria-label", "Profils");
    zoneListe.replaceChildren(l);
  }

  function dessinerFormulaire() {
    const b = brouillon(choisi);
    const saisi = choisi === "nouveau" ? null : profilDe(choisi);
    const premier = choisi === "nouveau" && aucun();
    const defautFixe = premier || Boolean(saisi?.defaut);
    if (defautFixe) b.defaut = true;
    const anthropic = () => (b.provider === "anthropic" ? "8192" : undefined);

    const cNom = champ({ libelle: "Nom", valeur: b.nom, erreur: erreurs.nom });
    const cProvider = champ({ libelle: "Provider", type: "liste", options: reglages.providers.map((p) => p.nom), valeur: nomProvider(b.provider) });
    const cModele = champ({ libelle: "Modèle", valeur: b.modele, erreur: erreurs.modele });
    cModele.classList.add("champs-large");
    const cEffort = champ({ libelle: "Effort", type: "liste", options: EFFORTS.map((e) => e[1]), valeur: EFFORTS.find((e) => e[0] === b.effort)?.[1] });
    const cTemp = champ({ libelle: "Température", valeur: b.temperature, indication: "0 à 2", clavier: "decimal", erreur: erreurs.temperature });
    const cSortie = champ({ libelle: "Sortie max. (tokens)", valeur: b.sortieMax, indication: anthropic(), clavier: "numerique", erreur: erreurs.sortieMax });
    const cFenetre = champ({ libelle: "Fenêtre de contexte (tokens)", valeur: b.fenetre, clavier: "numerique", erreur: erreurs.fenetre });
    const aide = document.createElement("div");
    aide.className = "champ-aide champs-large";
    aide.textContent = "Un champ vide n'est pas envoyé au provider.";
    const cDefaut = champ({
      libelle: "Profil par défaut",
      type: "case",
      valeur: b.defaut,
      desactive: defautFixe,
      aide: premier ? "Le premier profil est le profil par défaut." : defautFixe ? "Cochez cette case sur un autre profil pour le remplacer." : undefined,
    });
    cDefaut.classList.add("champs-large");

    const sel = (c) => c.querySelector("input, select");
    entrees = { nom: sel(cNom), provider: sel(cProvider), modele: sel(cModele), effort: sel(cEffort), temperature: sel(cTemp), sortieMax: sel(cSortie), fenetre: sel(cFenetre), defaut: sel(cDefaut) };
    const noter = (cle, lire) => () => {
      b[cle] = lire();
      if (cle === "provider") entrees.sortieMax.placeholder = anthropic() ?? "";
      if (resultat) {
        resultat = null;
        zoneForm.querySelector(".message")?.remove();
      }
    };
    for (const cle of ["nom", "modele", "temperature", "sortieMax", "fenetre"]) {
      entrees[cle].addEventListener("input", noter(cle, () => entrees[cle].value));
      entrees[cle].addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          enregistrer();
        }
      });
    }
    entrees.provider.addEventListener("change", noter("provider", () => reglages.providers.find((p) => p.nom === entrees.provider.value).id));
    entrees.effort.addEventListener("change", noter("effort", () => EFFORTS.find((e) => e[1] === entrees.effort.value)[0]));
    entrees.defaut.addEventListener("change", noter("defaut", () => entrees.defaut.checked));

    const grille = document.createElement("div");
    grille.className = "champs-grille";
    grille.append(cNom, cProvider, cModele, cEffort, cTemp, cSortie, cFenetre, aide, cDefaut);
    zoneForm.replaceChildren(grille);
    if (resultat) {
      const m = message({ texte: resultat.texte, variante: resultat.variante });
      zoneForm.append(m);
      amenerDansLaVue(m);
    }
    supprimerB.disabled = premier;
  }

  function choisir(id, { force = false } = {}) {
    if (id === choisi && !force) return;
    choisi = id;
    resultat = null;
    erreurs = {};
    dessinerListe();
    dessinerFormulaire();
  }

  function rendre() {
    if (chargement.isConnected) chargement.replaceWith(zoneBarre, zoneListe, zoneForm);
    zoneBarre.hidden = false;
    dessinerListe();
    dessinerFormulaire();
  }

  function echec(r) {
    resultat = { texte: r.coupure ? TEXTE_COUPURE : `Enregistrement impossible : ${sansPoint(r.message)}.`, variante: "erreur" };
  }

  function verifier(b) {
    const e = {};
    const nom = b.nom.trim();
    if (!nom) e.nom = ERREURS.nom;
    else if (profils().some((p) => p.id !== choisi && p.nom.toLowerCase() === nom.toLowerCase())) e.nom = ERREURS.nomPris;
    if (!b.modele.trim()) e.modele = ERREURS.modele;
    const t = b.temperature.trim();
    if (t && !(decimal(t) >= 0 && decimal(t) <= 2)) e.temperature = ERREURS.temperature;
    const s = b.sortieMax.trim();
    if (s && !entierPositif(s)) e.sortieMax = ERREURS.sortieMax;
    const f = b.fenetre.trim();
    if (f && !entierPositif(f)) e.fenetre = ERREURS.fenetre;
    return e;
  }

  async function enregistrer() {
    if (!reglages || enCours) return;
    const b = brouillon(choisi);
    erreurs = verifier(b);
    resultat = null;
    const premierEnErreur = ORDRE.find((c) => erreurs[c]);
    if (premierEnErreur) {
      dessinerFormulaire();
      entrees[premierEnErreur].focus();
      return;
    }
    const corps = { nom: b.nom.trim(), provider: b.provider, modele: b.modele.trim(), defaut: b.defaut };
    if (choisi !== "nouveau") corps.id = choisi;
    if (b.effort) corps.effort = b.effort;
    if (b.temperature.trim()) corps.temperature = decimal(b.temperature.trim());
    if (b.sortieMax.trim()) corps.sortieMax = Number(b.sortieMax);
    if (b.fenetre.trim()) corps.fenetre = Number(b.fenetre);
    const actif = Object.keys(entrees).find((c) => entrees[c] === document.activeElement);
    enCours = true;
    const r = await api.enregistrerProfil(corps);
    enCours = false;
    if (ferme) return;
    if (r.coupure || r.cause || !r.profils) echec(r);
    else {
      reglages = r;
      const saved = r.profils.find((p) => p.nom === corps.nom) ?? r.profils.find((p) => p.nom.toLowerCase() === corps.nom.toLowerCase());
      brouillons.delete(choisi);
      if (choisi === "nouveau") nouveau = false;
      recopierDefaut();
      choisi = saved?.id ?? r.profils[0]?.id;
      resultat = { texte: `Profil « ${corps.nom} » enregistré.`, variante: "succes" };
    }
    rendre();
    if (actif) entrees[actif].focus();
  }

  // Le défaut est celui du serveur : un brouillon d'un autre profil ne le garde pas périmé.
  function recopierDefaut() {
    for (const [id, b] of brouillons) if (id !== "nouveau" && profilDe(id)) b.defaut = profilDe(id).defaut;
  }

  function retirerNouveau() {
    const avant = lignes();
    nouveau = false;
    brouillons.delete("nouveau");
    const apres = lignes();
    if (apres.length === 0) return ajouterNouveau();
    choisi = apres[Math.min(avant.indexOf("nouveau"), apres.length - 1)];
    resultat = null;
    erreurs = {};
    dessinerListe();
    dessinerFormulaire();
    zoneListe.querySelector("[tabindex='0']")?.focus();
  }

  function supprimer() {
    if (!reglages) return;
    if (choisi === "nouveau") return retirerNouveau();
    const p = profilDe(choisi);
    const phrase = document.createElement("p");
    phrase.textContent = "Les conversations qui l'utilisent prendront le profil par défaut.";
    const zone = document.createElement("div");
    zone.append(phrase);
    const annuler = bouton({ libelle: "Annuler" });
    const ok = bouton({ libelle: "Supprimer", variante: "danger" });
    const conf = dialogue({
      titre: `Supprimer le profil « ${p.nom} » ?`,
      contenu: [zone],
      actions: [annuler, ok],
      focusInitial: annuler,
      surAnnuler: () => conf.fermer(),
    });
    annuler.addEventListener("click", () => conf.fermer());
    ok.addEventListener("click", async () => {
      conf.enCours(true);
      const r = await api.supprimerProfil(p.id);
      if (ferme) return;
      conf.enCours(false);
      if (r.coupure || r.cause || !r.profils) {
        zone.replaceChildren(phrase, message({ texte: r.coupure ? TEXTE_COUPURE : `Suppression impossible : ${sansPoint(r.message)}.`, variante: "erreur" }));
        return;
      }
      const avant = lignes();
      reglages = r;
      brouillons.delete(p.id);
      recopierDefaut();
      const apres = lignes();
      conf.fermer({ rendreFocus: false });
      if (apres.length === 0) return ajouterNouveau(), entrees.nom.focus();
      const i = avant.indexOf(p.id);
      choisi = apres[Math.min(i, apres.length - 1)];
      resultat = null;
      erreurs = {};
      dessinerListe();
      dessinerFormulaire();
      zoneListe.querySelector("[tabindex='0']")?.focus();
    });
    conf.ouvrir();
  }

  const dlg = dialogue({
    titre: "Profils de modèle",
    contenu: [chargement],
    actions: [fermerB, enregistrerB],
    focusInitial: fermerB,
    position: "reglages",
    surAnnuler: fermer,
  });
  dlg.ouvrir();

  api.reglagesAgent().then((r) => {
    if (ferme) return;
    if (!r.profils) {
      const raison = r.coupure ? TEXTE_COUPURE : `Impossible de lire les réglages : ${sansPoint(r.message)}.`;
      chargement.replaceWith(message({ texte: raison, variante: "erreur" }));
      return;
    }
    reglages = r;
    enregistrerB.disabled = false;
    if (aucun()) {
      ajouterNouveau();
      rendre();
      entrees.nom.focus();
    } else {
      choisi = (r.profils.find((p) => p.defaut) ?? r.profils[0]).id;
      rendre();
      zoneListe.querySelector("[tabindex='0']")?.focus();
    }
  });

  return { fermer, element: dlg.element };
}
