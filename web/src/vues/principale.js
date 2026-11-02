import { deconnexion } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { cadre } from "../ui/cadre.js";
import { onglets } from "../ui/onglets.js";

const PANNEAUX = [
  { id: "fichiers", libelle: "F", nomAccessible: "Fichiers", touche: "f", titre: "Fichiers" },
  { id: "recherche", libelle: "R", nomAccessible: "Recherche", touche: "r", titre: "Recherche" },
  { id: "git", libelle: "G", nomAccessible: "Git", touche: "g", titre: "Git" },
];

function nomDuDossier(chemin) {
  return chemin.split("/").filter(Boolean).pop() ?? chemin;
}

/** V-002. `surDeconnexion` est appelé une fois la session fermée. */
export function vuePrincipale({ chemin, surDeconnexion }) {
  document.title = `${nomDuDossier(chemin)} — Yaide`;

  const nom = document.createElement("strong");
  nom.className = "barre-nom";
  nom.textContent = "Yaide";
  const lieu = document.createElement("span");
  lieu.className = "barre-chemin";
  lieu.textContent = chemin;
  lieu.title = chemin;
  const droite = document.createElement("div");
  droite.className = "barre-droite";
  const sortir = bouton({ libelle: "Déconnexion" });
  sortir.addEventListener("click", async () => {
    if (await deconnexion()) surDeconnexion();
  });
  droite.append(sortir);

  const rail = onglets({
    orientation: "verticale",
    onglets: PANNEAUX.map(({ id, libelle, nomAccessible }) => ({ id, libelle, nomAccessible })),
    actif: "fichiers",
    surChoix: afficherPanneau,
  });

  const racine = cadre({
    barreHaut: [nom, lieu, droite],
    rail,
    panneau: { titre: "Fichiers" },
  });
  const titre = racine.querySelector(".cadre-panneau-titre");
  const corps = racine.querySelector(".cadre-panneau-corps");
  corps.tabIndex = -1;

  function afficherPanneau(id) {
    const p = PANNEAUX.find((x) => x.id === id);
    titre.textContent = p.titre;
    corps.setAttribute("aria-label", p.titre);
  }
  afficherPanneau("fichiers");

  // Clic sur un onglet du rail : le focus entre dans le panneau.
  rail.addEventListener("click", (e) => {
    if (e.target.closest("[role=tab]")) corps.focus();
  });
  // Focus sur le rail : F, R et G affichent le panneau et y mettent le focus.
  rail.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !e.target.closest("[role=tab]")) return;
    const p = PANNEAUX.find((x) => x.touche === e.key.toLowerCase());
    if (!p) return;
    rail.choisir(p.id);
    afficherPanneau(p.id);
    corps.focus();
  });

  return racine;
}
