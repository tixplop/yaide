import { installerVersion, lireVersion } from "./api.js";

const INTERVALLE = 60000;

const nombres = (v) => String(v).replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
function plusRecente(a, b) {
  const [x, y] = [nombres(a), nombres(b)];
  if ([...x, ...y].some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}
const etiquette = (v) => `v${String(v).replace(/^v/, "")}`;

/**
 * Lit l'état de la version au départ, puis chaque minute. `surChangement({ version, maj })` reçoit
 * l'état à afficher (forme de `barreEtat` du cadre). Une lecture sans réponse ne change rien.
 */
export function suivreVersion({ surChangement }) {
  let serveur = null;
  let derniereConnue = null;
  let installation = false; // un clic de cette page est en cours
  let echec = null;
  let installee = null; // issue d'une installation réussie depuis cette page
  let generation = 0;
  let detruit = false;

  function calculer() {
    if (!serveur) return { version: undefined, maj: { etat: "aucune" } };
    const version = serveur.version ? etiquette(serveur.version) : undefined;
    if (serveur.derniere && plusRecente(serveur.derniere, serveur.version)) derniereConnue = serveur.derniere;
    const apres = installee ?? (serveur.maj === "installee" ? (serveur.installee ?? derniereConnue) : null);
    if (apres) return { version, maj: { etat: "installee", derniere: etiquette(apres) } };
    const derniere = derniereConnue && etiquette(derniereConnue);
    if (!derniere) return { version, maj: { etat: "aucune" } };
    if (installation || serveur.maj === "encours") return { version, maj: { etat: "encours", derniere } };
    if (echec !== null) return { version, maj: { etat: "echec", derniere, raison: echec } };
    if (serveur.derniere && plusRecente(serveur.derniere, serveur.version)) return { version, maj: { etat: "disponible", derniere } };
    return { version, maj: { etat: "aucune" } };
  }
  const pousser = () => {
    if (!detruit) surChangement(calculer());
  };

  async function lire() {
    const depart = generation;
    const r = await lireVersion();
    if (detruit || !r || depart !== generation) return;
    serveur = r;
    pousser();
  }

  async function installer() {
    if (installation || calculer().maj.etat === "encours" || calculer().maj.etat === "installee") return;
    installation = true;
    echec = null;
    pousser();
    const r = await installerVersion();
    installation = false;
    generation++;
    if (detruit) return;
    if (r.ok) installee = derniereConnue ?? serveur?.installee ?? null;
    else if (r.echec !== undefined) echec = r.echec;
    pousser();
    // Après une coupure, l'état réel (installation peut-être finie) vient de la lecture suivante.
    if (r.coupure) lire();
  }

  lire();
  const minuteur = setInterval(lire, INTERVALLE);
  return {
    installer,
    detruire() {
      detruit = true;
      clearInterval(minuteur);
    },
  };
}
