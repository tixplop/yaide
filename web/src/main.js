import { info, sessionValide } from "./api.js";
import { vueConnexion } from "./vues/connexion.js";
import { charger } from "./reglages-interface.js";
import { charger as chargerCouleurs } from "./couleurs-markdown.js";
import { vuePrincipale } from "./vues/principale.js";
import { copierEnTexteSimple } from "./ui/copie.js";

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
  const connexion = (expiree, fin) => {
    document.title = "yaide";
    montrer(vueConnexion({ chemin: projet.chemin, expiree, fin, surSucces: principale }));
  };
  const principale = async () => {
    const [reglages, couleurs] = await Promise.all([charger(), chargerCouleurs()]);
    montrer(vuePrincipale({ chemin: projet.chemin, reglages, couleursIllisibles: couleurs.illisible, surDeconnexion: (fin) => connexion(false, fin), surExpiree: () => connexion(true) }));
  };
  if (await sessionValide()) principale();
  else connexion(false);
}

const app = document.getElementById("app");
if (app) {
  copierEnTexteSimple();
  demarrer(app);
}
