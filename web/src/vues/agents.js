import * as apiReelle from "../api.js";
import { COULEURS, avatar, compterCaracteres } from "../ui/avatar.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { menu } from "../ui/menu.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const PAR_DEFAUT = "Profil par défaut";
const ERREURS = {
  nom: "Donnez un nom à l'agent.",
  nomPris: "Ce nom est déjà pris. Choisissez-en un autre.",
  avatar: "Avatar : deux caractères au plus.",
};
const ERREUR_CHEMIN = "Donnez un chemin dans le projet.";
const ERREUR_COMMANDE = "Donnez le texte de la commande.";
const ERREUR_CRON = "Donnez une expression cron à cinq champs, par exemple 0 9 * * 1-5.";
// Types de déclencheur (REQ-163) : `type` écrit dans `agent.json`, titre, réglage, aide.
const TYPES = [
  { type: "fichier", titre: "Fichier", reglage: "chemin", aide: "Depuis la racine du projet." },
  { type: "dossier", titre: "Dossier", reglage: "chemin", aide: "Depuis la racine du projet, sous-dossiers compris. « . » : tout le projet." },
  { type: "commit", titre: "Commit", aide: "À chaque commit du dépôt." },
  { type: "commande", titre: "Commande shell", reglage: "texte", aide: "Une commande d'un shell de Yaide qui contient ce texte. Les majuscules comptent." },
  { type: "configuration", titre: "Configuration de Yaide", aide: "À chaque changement des providers, des profils, des serveurs MCP ou des préférences." },
  { type: "planification", titre: "Planification", reglage: "cron", aide: "Expression cron : minute, heure, jour du mois, mois, jour de la semaine, à l'heure de la machine de Yaide." },
];
// Champs d'une expression cron : bornes, et noms anglais acceptés (REQ-174).
const NOMS_MOIS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NOMS_JOURS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const CHAMPS_CRON = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, noms: NOMS_MOIS, decalage: 1 },
  { min: 0, max: 7, noms: NOMS_JOURS, decalage: 0 },
];

/** Une expression cron à cinq champs : `*`, listes, intervalles, pas, noms anglais. */
function cronValide(expression) {
  const champs = expression.trim().split(/\s+/);
  if (champs.length !== 5) return false;
  return champs.every((champ, i) => {
    const { min, max, noms, decalage } = CHAMPS_CRON[i];
    const valeur = (v) => {
      const n = noms?.indexOf(v.toLowerCase());
      if (n >= 0) return n + decalage;
      return /^\d+$/.test(v) ? Number(v) : NaN;
    };
    return champ.split(",").every((element) => {
      const [plage, pas, trop] = element.split("/");
      if (trop !== undefined || (pas !== undefined && !/^[1-9]\d*$/.test(pas))) return false;
      if (plage === "*") return true;
      const [a, b, autre] = plage.split("-");
      if (autre !== undefined || a === "") return false;
      const debut = valeur(a);
      const fin = b === undefined ? debut : valeur(b);
      return debut >= min && fin <= max && debut <= fin;
    });
  });
}
const AIDE_DECLENCHEURS = "À chaque évènement, l'agent le reçoit dans une nouvelle conversation.";

/** Un chemin relatif, non vide, qui ne sort pas du projet (`.` : tout le projet). */
function cheminDuProjet(chemin) {
  const c = chemin.trim();
  if (!c || c.startsWith("/") || c.includes("\0")) return false;
  let profondeur = 0;
  for (const segment of c.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") profondeur--;
    else profondeur++;
    if (profondeur < 0) return false;
  }
  return true;
}
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");
const plusieurs = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Rond de C-016 ; un nom vide donne un rond vide. */
const rond = (texte, nom, couleur) => avatar({ avatar: texte, nom: nom.trim() || " ", couleur: COULEURS.includes(couleur) ? couleur : "violet" });

/**
 * V-010. `api` : `listerAgents`, `enregistrerAgent`, `reglagesAgent`.
 * `surFichier(chemin)` ouvre un fichier dans l'éditeur ; `surDemarrer(agents)` reçoit les agents cochés, dans l'ordre de la liste.
 * Rend `{ corps, afficher(), detruire() }`.
 */
export function vueAgents({ api = apiReelle, surFichier = () => {}, surDemarrer = () => {} } = {}) {
  const corps = document.createElement("div");
  corps.className = "agents-corps";

  let agents = [];
  let profils = [];
  const coches = new Set(); // dossiers cochés
  let generation = 0; // change à chaque chargement ou ouverture de fiche : une réponse en retard est ignorée
  let fiche = null;
  let detruite = false;
  let compteurDeclencheurs = 0;

  // ---------- Liste ----------

  /** Relit les agents et les profils, dessine la liste, puis `placerFocus(refs)`. */
  async function charger(placerFocus) {
    const g = ++generation;
    corps.setAttribute("aria-busy", "true");
    corps.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
    const [la, re] = await Promise.all([api.listerAgents(), api.reglagesAgent()]);
    if (g !== generation || detruite) return;
    corps.removeAttribute("aria-busy");
    profils = re.profils ?? [];
    let lecture = null;
    let illisibles = [];
    if (la.agents) {
      agents = la.agents;
      illisibles = la.erreurs ?? [];
    } else {
      agents = [];
      lecture = la.coupure ? TEXTE_COUPURE : `Impossible de lire les agents : ${sansPoint(la.message)}.`;
    }
    for (const d of [...coches]) if (!agents.some((a) => a.dossier === d)) coches.delete(d);
    placerFocus(dessinerListe(illisibles, lecture));
  }

  function dessinerListe(illisibles, lecture) {
    const refs = { modifier: new Map(), cases: [] };
    const barre = document.createElement("div");
    barre.className = "ya-agents-barre";
    const total = document.createElement("div");
    const compte = document.createElement("span");
    compte.className = "ya-agents-compte";
    compte.textContent = agents.length ? plusieurs(agents.length, "agent") : "";
    total.append(compte);
    const nouveau = bouton({ icone: "user-plus", nomAccessible: "Nouvel agent", infoBulle: "Nouvel agent", positionInfoBulle: "gauche" });
    nouveau.addEventListener("click", () => ouvrirFiche(null));
    barre.append(total, nouveau.enveloppe);
    refs.nouveau = nouveau;

    const messages = [...illisibles.map((c) => `${c} est illisible. Corrigez-le, puis rouvrez Agents.`), ...(lecture ? [lecture] : [])];
    const alertes = messages.map((texte) => message({ texte, variante: "erreur" }));

    if (!agents.length && !lecture) {
      const aucun = bouton({ libelle: "Nouvel agent" });
      aucun.addEventListener("click", () => ouvrirFiche(null));
      const vide = indication({ texte: "Aucun agent.", action: aucun });
      vide.classList.add("agents-vide");
      refs.aucun = aucun;
      corps.replaceChildren(barre, ...alertes, vide);
      return refs;
    }
    if (!agents.length) {
      corps.replaceChildren(barre, ...alertes);
      return refs;
    }

    const liste = document.createElement("div");
    liste.className = "agents-liste";
    const pied = document.createElement("div");
    pied.className = "ya-agents-pied";
    const aide = document.createElement("span");
    aide.className = "ya-agents-aide";
    const demarrer = bouton({ libelle: "Démarrer une conversation", variante: "principal" });
    demarrer.addEventListener("click", () => surDemarrer(agents.filter((a) => coches.has(a.dossier))));
    pied.append(aide, demarrer);
    const majPied = () => {
      const n = coches.size;
      aide.textContent = n === 0 ? "Cochez un ou plusieurs agents." : n === 1 ? "1 agent coché." : `${n} agents cochés.`;
      demarrer.disabled = n === 0;
    };
    majPied();

    liste.append(...alertes);
    for (const a of agents) {
      const modifier = bouton({ icone: "sliders-horizontal", nomAccessible: `Modifier ${a.nom}`, infoBulle: "Modifier", positionInfoBulle: "gauche" });
      modifier.addEventListener("click", () => ouvrirFiche(a));
      const ligne = champ({ libelle: a.nom, type: "case", presentation: "ligne", valeur: coches.has(a.dossier), avant: rond(a.avatar, a.nom, a.couleur), action: modifier.enveloppe });
      const caseEl = ligne.querySelector("input");
      caseEl.addEventListener("change", () => {
        if (caseEl.checked) coches.add(a.dossier);
        else coches.delete(a.dossier);
        majPied();
      });
      refs.cases.push(caseEl);
      refs.modifier.set(a.dossier, modifier);
      liste.append(ligne);
    }
    corps.replaceChildren(barre, liste, pied);
    return refs;
  }

  const focusInitial = (refs) => (refs.cases[0] ?? refs.aucun ?? refs.nouveau).focus();

  /** `focus` faux : la liste est relue sans prendre le focus (colonne dépliée au chargement). */
  async function afficher({ focus = true } = {}) {
    coches.clear();
    fiche = null;
    await charger(focus ? focusInitial : () => {});
  }

  // ---------- Fiche ----------

  function ouvrirFiche(a) {
    generation++;
    corps.removeAttribute("aria-busy");
    fiche = {
      dossier: a?.dossier ?? null,
      enregistre: a ? { nom: a.nom, avatar: a.avatar, couleur: a.couleur } : null,
      nom: a?.nom ?? "",
      avatar: a?.avatar ?? "",
      couleur: a && COULEURS.includes(a.couleur) ? a.couleur : "violet",
      profil: a && profils.some((p) => p.id === a.profil) ? a.profil : "",
      erreurs: {},
      resultat: null,
      enCours: false,
      entrees: {},
      declencheurs: (a?.declencheurs ?? []).flatMap((d) => {
        const t = TYPES.find((x) => x.type === d.type);
        return t ? [{ id: `d${++compteurDeclencheurs}`, type: t.type, valeur: d[t.reglage] ?? "" }] : [];
      }),
      barre: document.createElement("div"),
      formulaire: document.createElement("div"),
    };
    fiche.barre.className = "ya-agents-barre";
    fiche.formulaire.className = "agents-fiche";
    const pied = document.createElement("div");
    pied.className = "ya-agents-pied";
    fiche.enregistrer = bouton({ libelle: "Enregistrer", variante: "principal" });
    fiche.enregistrer.addEventListener("click", enregistrer);
    pied.append(fiche.enregistrer);
    corps.replaceChildren(fiche.barre, fiche.formulaire, pied);
    dessinerFiche();
    fiche.entrees.nom.focus();
  }

  function dessinerBarre() {
    const retour = bouton({ icone: "arrow-left", nomAccessible: "Retour aux agents", infoBulle: "Retour aux agents", positionInfoBulle: "gauche" });
    retour.addEventListener("click", retourListe);
    retour.enveloppe.classList.add("ya-agents-retour");
    const qui = document.createElement("div");
    const nom = document.createElement("span");
    nom.className = "agents-nom";
    if (fiche.enregistre) {
      nom.textContent = nom.title = fiche.enregistre.nom;
      qui.append(retour.enveloppe, rond(fiche.enregistre.avatar, fiche.enregistre.nom, fiche.enregistre.couleur), nom);
    } else {
      nom.textContent = "Nouvel agent";
      qui.append(retour.enveloppe, nom);
    }
    fiche.barre.replaceChildren(qui);
  }

  function dessinerFiche() {
    const f = fiche;
    dessinerBarre();
    const sel = (c) => c.querySelector("input, select");
    const effacerResultat = () => {
      if (f.resultat) {
        f.resultat = null;
        f.formulaire.querySelector(".message")?.remove();
      }
    };
    const entrer = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        enregistrer();
      }
    };

    const cNom = champ({ libelle: "Nom", valeur: f.nom, erreur: f.erreurs.nom });
    const cAvatar = champ({ libelle: "Avatar", valeur: f.avatar, erreur: f.erreurs.avatar, aide: f.erreurs.avatar ? undefined : "Un ou deux caractères. Vide : la première lettre du nom." });
    const cCouleur = champ({ libelle: "Couleur", type: "couleur", valeur: f.couleur });
    const cProfil = champ({
      libelle: "Profil",
      type: "liste",
      options: [PAR_DEFAUT, ...profils.map((p) => p.nom)],
      valeur: profils.find((p) => p.id === f.profil)?.nom ?? PAR_DEFAUT,
    });
    const nomEl = sel(cNom);
    const avatarEl = sel(cAvatar);
    const profilEl = sel(cProfil);
    f.entrees = { nom: nomEl, avatar: avatarEl, couleur: cCouleur.querySelector("input:checked"), profil: profilEl };

    // L'aperçu précède le champ « Avatar » ; il suit la frappe, un avatar refusé y devient la première lettre du nom.
    let apercu = null;
    const ligneAvatar = document.createElement("div");
    ligneAvatar.className = "agents-ligne-avatar";
    const majApercu = () => {
      const texte = f.avatar.trim();
      const neuf = rond(compterCaracteres(texte) > 2 ? "" : texte, f.nom, f.couleur);
      if (apercu) apercu.replaceWith(neuf);
      apercu = neuf;
    };
    avatarEl.replaceWith(ligneAvatar);
    majApercu();
    ligneAvatar.append(apercu, avatarEl);
    cAvatar.insertBefore(ligneAvatar, cAvatar.querySelector(".champ-aide, .champ-erreur"));

    nomEl.addEventListener("input", () => {
      f.nom = nomEl.value;
      majApercu();
      effacerResultat();
    });
    avatarEl.addEventListener("input", () => {
      f.avatar = avatarEl.value;
      majApercu();
      effacerResultat();
    });
    nomEl.addEventListener("keydown", entrer);
    avatarEl.addEventListener("keydown", entrer);
    for (const radio of cCouleur.querySelectorAll("input")) {
      radio.addEventListener("change", () => {
        f.couleur = radio.value;
        f.entrees.couleur = radio;
        majApercu();
        effacerResultat();
      });
    }
    profilEl.addEventListener("change", () => {
      f.profil = profils.find((p) => p.nom === profilEl.value)?.id ?? "";
      effacerResultat();
    });

    const cFichiers = document.createElement("div");
    cFichiers.className = "champ";
    const legende = document.createElement("span");
    legende.className = "champ-libelle";
    legende.textContent = "Fichiers";
    const boutons = document.createElement("div");
    boutons.className = "agents-fichiers";
    for (const nom of ["AGENTS.md", "PERSONA.md", "MEMOIRE.md"]) {
      const b = bouton({ libelle: nom, icone: "md", desactive: !f.dossier });
      b.addEventListener("click", () => surFichier(`.yaide/agents/${f.dossier}/${nom}`));
      boutons.append(b.enveloppe ?? b);
    }
    const aide = document.createElement("div");
    aide.className = "champ-aide";
    aide.textContent = f.dossier ? "S'ouvrent dans l'éditeur." : "Enregistrez l'agent pour créer ses fichiers.";
    cFichiers.append(legende, boutons, aide);

    f.formulaire.replaceChildren(cNom, cAvatar, cCouleur, cProfil, cFichiers, sectionDeclencheurs(f, entrer, effacerResultat));
    if (f.resultat) f.formulaire.append(message({ texte: f.resultat.texte, variante: f.resultat.variante }));
  }

  /** Le `fieldset` « Déclencheurs » : aide, liste d'éléments, bouton qui ouvre le menu des six types. */
  function sectionDeclencheurs(f, entrer, effacerResultat) {
    const section = document.createElement("fieldset");
    section.className = "agents-declencheurs";
    const legende = document.createElement("legend");
    legende.className = "champ-libelle";
    legende.textContent = "Déclencheurs";
    const aide = document.createElement("div");
    aide.className = "champ-aide";
    aide.id = `agents-declencheurs-aide-${++compteurDeclencheurs}`;
    aide.textContent = AIDE_DECLENCHEURS;
    section.setAttribute("aria-describedby", aide.id);
    const ajouter = bouton({ libelle: "Ajouter un déclencheur", icone: "plus", ouvreMenu: true });
    const type = (d) => TYPES.find((t) => t.type === d.type);
    const ligne = (d) => ({
      id: d.id,
      titre: type(d).titre,
      champ: type(d).reglage ? { valeur: d.valeur, type: type(d).reglage === "cron" ? "cron" : undefined } : undefined,
      aide: type(d).aide,
      erreur: f.erreurs.declencheurs?.[d.id],
    });
    const racine = liste({
      variante: "elements",
      nom: "Déclencheurs",
      nomElement: "Déclencheur",
      vide: "Aucun déclencheur.",
      apres: ajouter,
      lignes: f.declencheurs.map(ligne),
      surSaisie: (id, valeur) => {
        f.declencheurs.find((d) => d.id === id).valeur = valeur;
        effacerResultat();
      },
      surRetrait: (id) => {
        f.declencheurs = f.declencheurs.filter((d) => d.id !== id);
        delete f.erreurs.declencheurs?.[id];
        effacerResultat();
      },
    });
    racine.addEventListener("keydown", (e) => e.target.tagName === "INPUT" && entrer(e));
    ajouter.addEventListener("click", () => {
      menu({
        nom: "Ajouter un déclencheur",
        ancre: ajouter,
        groupes: [
          TYPES.map((t) => ({
            libelle: t.titre,
            surChoix: () => {
              const d = { id: `d${++compteurDeclencheurs}`, type: t.type, valeur: "" };
              f.declencheurs.push(d);
              effacerResultat();
              racine.ajouter(ligne(d));
            },
          })),
        ],
        surFermeture: () => {},
      });
    });
    section.append(legende, aide, racine, ajouter.enveloppe ?? ajouter);
    return section;
  }

  function verifier() {
    const e = {};
    const nom = fiche.nom.trim();
    if (!nom) e.nom = ERREURS.nom;
    else if (agents.some((a) => a.dossier !== fiche.dossier && a.nom.trim().toLowerCase() === nom.toLowerCase())) e.nom = ERREURS.nomPris;
    if (compterCaracteres(fiche.avatar.trim()) > 2) e.avatar = ERREURS.avatar;
    for (const d of fiche.declencheurs) {
      const reglage = TYPES.find((t) => t.type === d.type).reglage;
      const refus =
        reglage === "chemin" ? !cheminDuProjet(d.valeur) && ERREUR_CHEMIN
        : reglage === "texte" ? !d.valeur.trim() && ERREUR_COMMANDE
        : reglage === "cron" && !cronValide(d.valeur) && ERREUR_CRON;
      if (refus) (e.declencheurs ??= {})[d.id] = refus;
    }
    return e;
  }

  async function enregistrer() {
    const f = fiche;
    if (!f || f.enCours) return;
    f.erreurs = verifier();
    f.resultat = null;
    const premier = ["nom", "avatar"].find((c) => f.erreurs[c]);
    const premierDeclencheur = f.declencheurs.find((d) => f.erreurs.declencheurs?.[d.id]);
    if (premier || premierDeclencheur) {
      dessinerFiche();
      (premier ? f.entrees[premier] : f.formulaire.querySelector(`[data-id="${premierDeclencheur.id}"] input`)).focus();
      return;
    }
    const saisie = { nom: f.nom.trim(), avatar: f.avatar.trim(), couleur: f.couleur };
    if (f.dossier) saisie.dossier = f.dossier;
    if (f.profil) saisie.profil = f.profil;
    if (f.declencheurs.length) {
      saisie.declencheurs = f.declencheurs.map((d) => {
        const reglage = TYPES.find((t) => t.type === d.type).reglage;
        return reglage ? { type: d.type, [reglage]: reglage === "texte" ? d.valeur : d.valeur.trim() } : { type: d.type };
      });
    }
    const actif = Object.keys(f.entrees).find((c) => f.entrees[c] === document.activeElement);
    const idActif = document.activeElement?.closest?.("[data-id]")?.dataset.id;
    f.enCours = true;
    const r = await api.enregistrerAgent(saisie);
    f.enCours = false;
    if (fiche !== f || detruite) return;
    if (r.dossier) {
      const cree = !f.dossier;
      agents = [...agents.filter((a) => a.dossier !== r.dossier), r].sort((a, b) => a.nom.toLowerCase().localeCompare(b.nom.toLowerCase()));
      f.dossier = r.dossier;
      f.nom = r.nom;
      f.avatar = r.avatar;
      f.enregistre = { nom: r.nom, avatar: r.avatar, couleur: r.couleur };
      f.resultat = { texte: `Agent « ${r.nom} » ${cree ? "créé" : "enregistré"}.`, variante: "succes" };
    } else if (r.champs?.length && r.champs.every((c) => c === "nom" || c === "avatar")) {
      for (const c of r.champs) f.erreurs[c] = c === "nom" ? ERREURS.nomPris : ERREURS.avatar;
    } else {
      f.resultat = { texte: r.coupure ? TEXTE_COUPURE : `Enregistrement impossible : ${sansPoint(r.message)}.`, variante: "erreur" };
    }
    dessinerFiche();
    const erreur = ["nom", "avatar"].find((c) => f.erreurs[c]);
    if (erreur) f.entrees[erreur].focus();
    else if (actif) f.entrees[actif].focus();
    else if (idActif) f.formulaire.querySelector(`[data-id="${idActif}"] input`)?.focus();
  }

  function retourListe() {
    const dossier = fiche.dossier;
    fiche = null;
    charger((refs) => {
      const cible = dossier ? refs.modifier.get(dossier) : refs.nouveau;
      (cible ?? refs.cases[0] ?? refs.aucun ?? refs.nouveau).focus();
    });
  }

  function detruire() {
    detruite = true;
    generation++;
    corps.remove();
  }

  return { corps, afficher, detruire };
}
