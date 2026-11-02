import { connexion } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { message } from "../ui/message.js";

const TEXTES = {
  vide: "Saisissez le mot de passe.",
  incorrect: "Mot de passe incorrect.",
  trop: "Trop d'essais. Attendez une minute.",
  injoignable: "Serveur injoignable. Réessayez.",
  erreur: "Une erreur est survenue. Réessayez.",
};

/** V-001. `surSucces` est appelé une fois connecté. */
export function vueConnexion({ nom, chemin, expiree = false, surSucces }) {
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
    titre.textContent = nom;
    const p = document.createElement("p");
    p.className = "connexion-chemin";
    p.title = chemin;
    const bdo = document.createElement("bdo");
    bdo.dir = "ltr";
    bdo.textContent = chemin;
    p.append(bdo);
    const contenu = [titre, p];
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
  racine.focaliser = () => focaliser();
  return racine;
}
