import { deconnexion } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { cadre } from "../ui/cadre.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { surveiller } from "../connexion.js";
import { vueEditeur } from "./editeur.js";
import { vueFichiers } from "./fichiers.js";
import { vueShells } from "./shells.js";

const PANNEAUX = [
  { id: "fichiers", libelle: "F", nomAccessible: "Fichiers", touche: "f", titre: "Fichiers" },
  { id: "recherche", libelle: "R", nomAccessible: "Recherche", touche: "r", titre: "Recherche" },
  { id: "git", libelle: "G", nomAccessible: "Git", touche: "g", titre: "Git" },
];

function nomDuDossier(chemin) {
  return chemin.split("/").filter(Boolean).pop() ?? chemin;
}

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";

/** V-002. `surDeconnexion` est appelé une fois la session fermée, `surExpiree` si elle expire. */
export function vuePrincipale({ chemin, surDeconnexion, surExpiree = surDeconnexion }) {
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
    if (etat !== "coupe" && (await deconnexion())) surDeconnexion();
    else dire({ texte: TEXTE_COUPURE, variante: "alerte" });
  });
  droite.append(sortir);

  // Bandeaux : la coupure d'abord, puis un seul message à la fois.
  const bandeaux = document.createElement("div");
  const places = { coupure: null, message: null };
  const montrerBandeau = (nom, element) => {
    places[nom]?.remove();
    places[nom] = element;
    if (element) bandeaux.append(element);
  };
  let etat = "connecte";
  function dire({ texte, variante, fermable = false }) {
    const m = message({ texte, variante, fermable });
    montrerBandeau("message", m);
    return m;
  }

  const shells = vueShells({ dire });
  const editeur = vueEditeur({ dire });
  const fichiers = vueFichiers({ dire, surOuvrir: editeur.ouvrir, surRenomme: editeur.renomme, surSupprime: editeur.supprime, surLecture: editeur.lecture });
  editeur.restaurer();

  const rail = onglets({
    orientation: "verticale",
    onglets: PANNEAUX.map(({ id, libelle, nomAccessible }) => ({ id, libelle, nomAccessible })),
    actif: "fichiers",
    surChoix: afficherPanneau,
  });

  const racine = cadre({
    barreHaut: [nom, lieu, droite],
    rail,
    panneau: { titre: "Fichiers", corps: fichiers.corps, pied: fichiers.pied },
    principal: { bandeaux, ongletsFichiers: editeur.barre, code: editeur.code, shells },
  });
  const titre = racine.querySelector(".cadre-panneau-titre");
  const corps = racine.querySelector(".cadre-panneau-corps");
  corps.tabIndex = -1;

  function afficherPanneau(id) {
    const p = PANNEAUX.find((x) => x.id === id);
    titre.textContent = p.titre;
    corps.setAttribute("aria-label", p.titre);
    const visible = id === "fichiers";
    if (visible && fichiers.corps.hidden) fichiers.rafraichir();
    fichiers.corps.hidden = fichiers.pied.hidden = !visible;
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

  // Ctrl+Maj+F, partout (même dans un shell) : le focus passe sur le bouton actif du rail.
  const surTouche = (e) => {
    const f = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "f";
    if (!f || document.querySelector("[role=dialog], dialog[open]")) return;
    e.preventDefault();
    rail.querySelector("[role=tab][aria-selected=true]")?.focus();
  };
  document.addEventListener("keydown", surTouche);

  const arreter = surveiller({
    surEtat(nouvel) {
      if (nouvel === "expiree") return surExpiree();
      etat = nouvel;
      shells.definirEtat(nouvel);
      if (nouvel === "coupe") {
        montrerBandeau("coupure", message({ texte: "Connexion perdue. Modifications gardées.", variante: "alerte", fort: true }));
      } else {
        montrerBandeau("coupure", null);
        if (places.message?.textContent.includes(TEXTE_COUPURE)) montrerBandeau("message", null);
      }
    },
  });

  racine.detruire = () => {
    arreter();
    document.removeEventListener("keydown", surTouche);
    shells.detruire();
    editeur.detruire();
    fichiers.detruire();
  };
  return racine;
}
