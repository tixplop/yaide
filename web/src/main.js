import { info, sessionValide } from "./api.js";
import { vueConnexion } from "./vues/connexion.js";
import { vuePrincipale } from "./vues/principale.js";

export function titre() {
  return "Yaide";
}

async function demarrer(app) {
  const projet = (await info()) ?? { nom: "Yaide", chemin: "" };
  let courante = null;
  const montrer = (vue) => {
    courante?.detruire?.();
    courante = vue;
    app.replaceChildren(vue);
    vue.focaliser?.();
  };
  const connexion = (expiree) => {
    document.title = "Yaide";
    montrer(vueConnexion({ nom: projet.nom, chemin: projet.chemin, expiree, surSucces: principale }));
  };
  const principale = () =>
    montrer(vuePrincipale({ chemin: projet.chemin, surDeconnexion: () => connexion(false), surExpiree: () => connexion(true) }));
  if (await sessionValide()) principale();
  else connexion(false);
}

const app = document.getElementById("app");
if (app) demarrer(app);
