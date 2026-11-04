import { info, sessionValide } from "./api.js";
import { vueConnexion } from "./vues/connexion.js";
import { vuePrincipale } from "./vues/principale.js";

export function titre() {
  return "yaide";
}

async function demarrer(app) {
  const projet = (await info()) ?? { chemin: "" };
  let courante = null;
  const montrer = (vue) => {
    courante?.detruire?.();
    courante = vue;
    app.replaceChildren(vue);
    vue.focaliser?.();
  };
  const connexion = (expiree) => {
    document.title = "yaide";
    montrer(vueConnexion({ chemin: projet.chemin, expiree, surSucces: principale }));
  };
  const principale = () =>
    montrer(vuePrincipale({ chemin: projet.chemin, surDeconnexion: () => connexion(false), surExpiree: () => connexion(true) }));
  if (await sessionValide()) principale();
  else connexion(false);
}

const app = document.getElementById("app");
if (app) demarrer(app);
