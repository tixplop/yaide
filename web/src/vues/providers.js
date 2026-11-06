import * as apiReelle from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");

/**
 * V-008, motif « Réglages en dialogue ». `api` : `reglagesAgent`, `enregistrerProvider`, `supprimerCle`.
 * `surFermeture` est appelé à la fermeture (Fermer, Échap) ; le focus est alors à l'appelant.
 * Rend `{ fermer, element }`.
 */
export function ouvrirProviders({ api = apiReelle, surFermeture = () => {} } = {}) {
  let reglages = null;
  let choisi = "openai";
  let ferme = false;
  let resultat = null; // { texte, variante }
  let erreurAdresse = false;
  const saisies = new Map(); // id -> { adresse?, cle? }, jusqu'à la fermeture

  const zoneListe = document.createElement("div");
  const zoneForm = document.createElement("div");
  zoneForm.className = "dialogue-contenu";
  const chargement = indication({ texte: "Chargement…", variante: "chargement" });

  const fermerB = bouton({ libelle: "Fermer" });
  const enregistrerB = bouton({ libelle: "Enregistrer", variante: "principal", desactive: true });
  let adresseIn = null;
  let cleIn = null;
  let supprimerB = null;

  function fermer() {
    if (ferme) return;
    ferme = true;
    dlg.fermer({ rendreFocus: false });
    surFermeture();
  }
  fermerB.addEventListener("click", fermer);
  enregistrerB.addEventListener("click", enregistrer);

  const courant = () => reglages.providers.find((p) => p.id === choisi);

  function activeCle() {
    const a = document.activeElement;
    if (a === adresseIn) return "adresse";
    if (a === cleIn) return "cle";
    if (a === supprimerB) return "supprimer";
    return null;
  }
  function poserFocus(cle) {
    const cible = { adresse: adresseIn, cle: cleIn, supprimer: supprimerB }[cle];
    if (cible && !cible.disabled) cible.focus();
  }

  function dessinerListe() {
    const l = liste({
      lignes: reglages.providers.map((p) => ({ id: p.id, libelle: p.nom, dossier: p.adresse, fin: p.cle ? "Clé enregistrée" : "Aucune clé" })),
      selection: choisi,
      surSelection: ([id]) => choisir(id),
      surActiver: (id) => {
        choisir(id);
        adresseIn.focus();
      },
    });
    l.setAttribute("aria-label", "Providers");
    zoneListe.replaceChildren(l);
  }

  function dessinerFormulaire() {
    const p = courant();
    const brouillon = saisies.get(p.id) ?? {};
    const aide = p.cle
      ? "Clé enregistrée. Saisissez-en une autre pour la remplacer."
      : `Aucune clé. ${p.cleObligatoire ? "Obligatoire" : "Facultative"} pour ${p.nom}.`;
    const nom = document.createElement("h2");
    nom.className = "reglages-nom";
    nom.textContent = p.nom;
    const a = champ({ libelle: "Adresse", valeur: brouillon.adresse ?? p.adresse, erreur: erreurAdresse ? "L'adresse doit commencer par http:// ou https://." : undefined });
    const k = champ({ libelle: "Clé d'API", type: "secret", aide });
    adresseIn = a.querySelector("input");
    cleIn = k.querySelector("input");
    cleIn.value = brouillon.cle ?? "";
    supprimerB = bouton({ libelle: "Supprimer la clé", desactive: !p.cle });
    const ligne = document.createElement("div");
    ligne.className = "champ-ligne";
    cleIn.replaceWith(ligne);
    ligne.append(cleIn, supprimerB);
    const noter = (cle) => (e) => {
      saisies.set(p.id, { ...saisies.get(p.id), [cle]: e.target.value });
      if (resultat) {
        resultat = null;
        zoneForm.querySelector(".message")?.remove();
      }
    };
    adresseIn.addEventListener("input", noter("adresse"));
    cleIn.addEventListener("input", noter("cle"));
    for (const el of [adresseIn, cleIn]) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          enregistrer();
        }
      });
    }
    supprimerB.addEventListener("click", supprimer);
    zoneForm.replaceChildren(nom, a, k);
    if (resultat) zoneForm.append(message({ texte: resultat.texte, variante: resultat.variante }));
  }

  function choisir(id) {
    if (id === choisi) return;
    choisi = id;
    resultat = null;
    erreurAdresse = false;
    dessinerFormulaire();
  }

  function rendre() {
    if (chargement.isConnected) chargement.replaceWith(zoneListe, zoneForm);
    dessinerListe();
    dessinerFormulaire();
  }

  async function relire() {
    const r = await api.reglagesAgent();
    if (!ferme && r.providers) reglages = r;
    return r;
  }

  function echec(r) {
    resultat = { texte: r.coupure ? TEXTE_COUPURE : `Enregistrement impossible : ${sansPoint(r.message)}.`, variante: "erreur" };
  }

  async function enregistrer() {
    if (!reglages) return;
    const p = courant();
    const focus = activeCle();
    const r = await api.enregistrerProvider(p.id, { adresse: adresseIn.value, cle: cleIn.value });
    if (ferme) return;
    if (r.champ === "adresse") {
      erreurAdresse = true;
      resultat = null;
      dessinerFormulaire();
      return adresseIn.focus();
    }
    erreurAdresse = false;
    if (r.coupure || r.cause) echec(r);
    else {
      saisies.delete(p.id);
      resultat = { texte: `${p.nom} enregistré.`, variante: "succes" };
      await relire();
      if (ferme) return;
    }
    rendre();
    poserFocus(focus);
  }

  async function supprimer() {
    const p = courant();
    const r = await api.supprimerCle(p.id);
    if (ferme) return;
    if (r.coupure || r.cause) echec(r);
    else {
      resultat = { texte: "Clé supprimée.", variante: "succes" };
      await relire();
      if (ferme) return;
    }
    rendre();
    cleIn.focus();
  }

  const dlg = dialogue({
    titre: "Providers LLM",
    contenu: [chargement],
    actions: [fermerB, enregistrerB],
    focusInitial: fermerB,
    position: "reglages",
    surAnnuler: fermer,
  });
  dlg.ouvrir();

  relire().then((r) => {
    if (ferme) return;
    if (!r.providers) {
      const raison = r.coupure ? TEXTE_COUPURE : `Impossible de lire les réglages : ${sansPoint(r.message)}.`;
      chargement.replaceWith(message({ texte: raison, variante: "erreur" }));
      return;
    }
    enregistrerB.disabled = false;
    rendre();
    zoneListe.querySelector("[tabindex='0']")?.focus();
  });

  return { fermer, element: dlg.element };
}
