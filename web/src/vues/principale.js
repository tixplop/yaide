import { deconnexion } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { cadre } from "../ui/cadre.js";
import { borner, limites } from "../ui/poignee.js";
import { ecrire, lire } from "../stockage.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { surveiller } from "../connexion.js";
import { vueEditeur } from "./editeur.js";
import { vueFichiers } from "./fichiers.js";
import { vueGit } from "./git.js";
import { vueOuverture } from "./ouverture.js";
import { vueRecherche } from "./recherche.js";
import { vueShells } from "./shells.js";

const PANNEAUX = [
  { id: "fichiers", icone: "files", raccourci: "F", nomAccessible: "Fichiers", touche: "f", titre: "Fichiers" },
  { id: "recherche", icone: "search", raccourci: "R", nomAccessible: "Recherche", touche: "r", titre: "Recherche" },
  { id: "git", icone: "branch", raccourci: "G", nomAccessible: "Git", touche: "g", titre: "Git" },
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
  const sortir = bouton({ icone: "log-out", nomAccessible: "Déconnexion" });
  sortir.addEventListener("click", async () => {
    if (etat !== "coupe" && (await deconnexion())) surDeconnexion();
    else dire({ texte: TEXTE_COUPURE, variante: "alerte" });
  });
  const branche = document.createElement("span");
  branche.className = "barre-branche";
  branche.hidden = true;
  droite.append(branche, sortir.enveloppe);

  // Bandeaux : la coupure d'abord, puis un seul message à la fois.
  const bandeaux = document.createElement("div");
  const places = { coupure: null, message: null };
  const montrerBandeau = (nom, element) => {
    places[nom]?.remove();
    places[nom] = element;
    if (element) bandeaux.append(element);
  };
  let etat = "connecte";
  let attenteTexte = "";
  function montrerCoupure() {
    if (etat !== "coupe") return montrerBandeau("coupure", null);
    const texte = ["Connexion perdue. Modifications gardées.", attenteTexte].filter(Boolean).join(" ");
    montrerBandeau("coupure", message({ texte, variante: "alerte", fort: true }));
  }
  function dire({ texte, variante, detail, fermable = false }) {
    const m = message({ texte, variante, detail, fermable });
    montrerBandeau("message", m);
    return m;
  }

  const shells = vueShells({ dire });
  const editeur = vueEditeur({ dire, ouvrirRapide: () => ouverture.ouvrir(), surAttente: (t) => { attenteTexte = t; montrerCoupure(); } });
  const ouverture = vueOuverture({ dire, surOuvrir: editeur.ouvrir, surLecture: editeur.lecture });
  const fichiers = vueFichiers({
    dire,
    estDepot: () => git.estDepot(),
    surCommit: () => {
      rail.choisir("git");
      afficherPanneau("git");
      git.focuserMessage();
    }, surOuvrir: editeur.ouvrir, surRenomme: editeur.renomme, surSupprime: editeur.supprime, surLecture: editeur.lecture,
  });
  const recherche = vueRecherche({ dire, surOuvrir: editeur.ouvrir, surLecture: editeur.lecture });
  const git = vueGit({
    dire,
    surBranche: (b) => {
      branche.hidden = !b;
      if (b) branche.textContent = `branche: ${b.detachee ? "détachée" : b.branche}`;
    },
    surDiff: editeur.ouvrirDiff,
    diffOuvert: editeur.diffOuvert,
    fermerDiff: editeur.fermerDiff,
    surDisque: editeur.relireDisque,
  });
  editeur.restaurer();

  const rail = onglets({
    orientation: "verticale",
    onglets: PANNEAUX.map(({ id, icone, nomAccessible, raccourci }) => ({ id, icone, nomAccessible, raccourci })),
    actif: "fichiers",
    surChoix: afficherPanneau,
  });

  const choisies = {};
  let detruite = false;
  const racine = cadre({
    barreHaut: [nom, lieu, droite],
    rail: { onglets: rail, commandes: shells.commandes },
    panneau: { titre: "Fichiers", corps: [fichiers.corps, recherche.corps, git.corps], pied: [fichiers.pied, git.pied] },
    principal: { bandeaux, ongletsFichiers: editeur.barre, questionOnglet: editeur.question, code: editeur.code, shells },
    surChangement: (zone, taille) => {
      choisies[zone] = taille;
      racine.definirTailles({ [zone]: taille });
    },
    surFin: () => ecrire("tailles", { ...choisies }),
  });

  // Poignées : limites recalculées à chaque changement de la fenêtre, des bandeaux ou de la question d'onglet.
  // La taille choisie ne change que par un glissé ou une flèche ; la taille affichée est la choisie, bornée.
  function recalculer() {
    if (detruite) return;
    const hauteurs = [bandeaux, editeur.question].reduce((s, e) => s + e.offsetHeight, 0);
    const lim = limites({ L: window.innerWidth, H: window.innerHeight, bandeaux: hauteurs });
    const bornees = {};
    for (const zone of ["panneau", "shells"]) {
      racine.poignees[zone].definir(lim[zone]);
      if (choisies[zone] !== undefined) bornees[zone] = borner(choisies[zone], lim[zone]);
    }
    racine.definirTailles(bornees);
    racine.mesurer();
  }
  window.addEventListener("resize", recalculer);
  const observateur = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(recalculer);
  observateur?.observe(bandeaux);
  observateur?.observe(editeur.question);
  // La vue n'est dans la page qu'après sa création : on mesure juste après le montage.
  queueMicrotask(recalculer);
  lire("tailles").then((gardees) => {
    for (const zone of ["panneau", "shells"]) {
      const t = gardees?.[zone];
      if (choisies[zone] === undefined && Number.isFinite(t)) choisies[zone] = t;
    }
    recalculer();
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
    recherche.montrer(id === "recherche");
    git.montrer(id === "git");
  }
  afficherPanneau("fichiers");

  // Clic sur un onglet du rail : le focus entre dans le panneau.
  rail.addEventListener("click", (e) => {
    const onglet = e.target.closest("[role=tab]");
    if (!onglet) return;
    corps.focus();
    if (onglet.getAttribute("aria-label") === "Recherche") recherche.focuser();
  });
  // Focus sur le rail : F, R et G affichent le panneau et y mettent le focus.
  // Les deux boutons de commande du rail comptent aussi : la garde est posée sur toute la colonne.
  racine.querySelector(".cadre-rail").addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !e.target.closest("[role=tab], .cadre-rail-commandes button")) return;
    const p = PANNEAUX.find((x) => x.touche === e.key.toLowerCase());
    if (!p) return;
    rail.choisir(p.id);
    afficherPanneau(p.id);
    corps.focus();
    if (p.id === "recherche") recherche.focuser();
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
      montrerCoupure();
      editeur.definirEtat(nouvel);
      if (nouvel !== "coupe") {
        if (places.message?.textContent.includes(TEXTE_COUPURE)) montrerBandeau("message", null);
      }
    },
  });

  racine.detruire = () => {
    arreter();
    detruite = true;
    window.removeEventListener("resize", recalculer);
    observateur?.disconnect();
    document.removeEventListener("keydown", surTouche);
    shells.detruire();
    editeur.detruire();
    fichiers.detruire();
    git.detruire();
    recherche.detruire();
    ouverture.detruire();
  };
  return racine;
}
