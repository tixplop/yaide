import { connexion } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { symbole } from "../ui/cadre.js";
import { dialogue } from "../ui/dialogue.js";
import { champ } from "../ui/champ.js";
import { message } from "../ui/message.js";

const TEXTES = {
  vide: "Saisissez le mot de passe.",
  incorrect: "Mot de passe incorrect.",
  trop: "Trop d'essais. Attendez une minute.",
  injoignable: "Serveur injoignable. Réessayez.",
  erreur: "Une erreur est survenue. Réessayez.",
};

const FINS = {
  deconnexion: { titre: "Vous êtes déconnecté." },
  arret: { titre: "Yaide est arrêté. Vous êtes déconnecté.", aide: "Relancez Yaide, puis reconnectez-vous ici." },
};

/** V-001. `surSucces` est appelé une fois connecté. `fin` (`deconnexion` ou `arret`) ouvre le dialogue de fin de session (REQ-162). */
export function vueConnexion({ chemin, expiree = false, fin, surSucces }) {
  const racine = document.createElement("div");
  racine.className = "connexion";
  const form = document.createElement("form");
  form.className = "connexion-form";
  form.noValidate = true;
  racine.append(form);

  function saisie() {
    return form.querySelector("input");
  }

  function afficher({ erreur, enCours = false, valeur = "" }) {
    const titre = document.createElement("h1");
    titre.className = "connexion-titre";
    titre.textContent = "yaide";
    const marque = document.createElement("div");
    marque.className = "connexion-symbole";
    marque.append(symbole(40));
    const p = document.createElement("p");
    p.className = "connexion-chemin";
    p.title = chemin;
    const bdo = document.createElement("bdo");
    bdo.dir = "ltr";
    bdo.textContent = chemin;
    p.append(bdo);
    const contenu = [marque, titre, p];
    if (expiree) contenu.push(message({ texte: "Session expirée. Reconnectez-vous." }));
    contenu.push(
      champ({ libelle: "Mot de passe", type: "motDePasse", valeur, erreur, desactive: enCours }),
      bouton({ libelle: "Se connecter", variante: "principal", submit: true, libelleEnCours: enCours ? "Connexion…" : undefined }),
    );
    form.replaceChildren(...contenu);
  }

  function focaliser(selectionner = false) {
    const s = saisie();
    s?.focus();
    if (selectionner) s?.select();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const valeur = saisie().value;
    if (!valeur) {
      afficher({ erreur: TEXTES.vide });
      focaliser();
      return;
    }
    afficher({ enCours: true, valeur });
    const resultat = await connexion(valeur);
    if (resultat === "ok") {
      surSucces();
      return;
    }
    afficher({ erreur: TEXTES[resultat], valeur });
    focaliser(true);
  });

  afficher({});
  let fenetre = null;
  if (FINS[fin]) {
    const fermer = bouton({ libelle: "Fermer", variante: "secondaire" });
    const aide = FINS[fin].aide ? Object.assign(document.createElement("p"), { textContent: FINS[fin].aide }) : undefined;
    fenetre = dialogue({
      titre: FINS[fin].titre,
      position: "milieu",
      aide,
      actions: [fermer],
      focusInitial: fermer,
      focusFermeture: { focus: () => focaliser() },
      surAnnuler: () => fenetre.fermer(),
    });
    fermer.addEventListener("click", () => fenetre.fermer());
  }
  let dejaOuvert = false;
  racine.focaliser = () => {
    if (fenetre && !dejaOuvert) {
      dejaOuvert = true;
      fenetre.ouvrir();
      return;
    }
    focaliser();
  };
  racine.detruire = () => {
    if (fenetre?.element.isConnected) fenetre.fermer({ rendreFocus: false });
  };
  return racine;
}
