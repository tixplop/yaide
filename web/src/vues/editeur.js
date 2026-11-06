import { ecrireFichier, lireFichier, versionsFichiers } from "../api.js";
import { decider, texteAttente } from "../brouillons.js";
import { decisionDisque } from "../disque.js";
import { apresFermeture, estSous, garder, libelles, nomDe, retrouver, suivreRenommage } from "../onglets-fichiers.js";
import { bouton } from "../ui/bouton.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { icone } from "../ui/icones.js";
import { langagePourFichier, nomLangage } from "../ui/langages.js";
import { menu } from "../ui/menu.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { zoneCode } from "../ui/zone-code.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const DELAI_DETECTION = 4000;
const INTERVALLE_DISQUE = 1500;
const SANS_SUITE = "sans suite";
const DIFF = "\0diff"; // identifiant de l'onglet de diff, qui n'est pas un fichier ouvert
const TEXTE_SUPPRIME = "Fichier supprimé du disque. Ctrl+S le recrée.";
const avecApercu = (chemin) => /\.(md|markdown|html|htm)$/i.test(chemin);

/**
 * Éditeur de V-002. `dire({ texte, variante, fermable })` affiche un bandeau ; `ouvrirRapide()` ouvre V-006.
 * `surAttente(texte)` : phrase des sauvegardes attendant le retour de la connexion (vide s'il n'y en a plus).
 * `surActif({ position, langage })` : l'onglet actif et sa position pour la barre d'état (`null` sans onglet ; sur un diff, la position seule).
 * `surSauvegarde()` : une sauvegarde a réussi (l'état git a pu changer).
 * `surCourant(chemin | null)` : le fichier de l'onglet actif (`null` sans onglet ou sur un diff).
 * Rend `{ definirStatuts(statuts), barre, fil, code, lecture(oui), definirEtat(etat), ouvrir(…), renomme(…), supprime(…), restaurer(), detruire() }`.
 */
export function vueEditeur({ dire, ouvrirRapide = () => {}, surAttente = () => {}, surActif = () => {}, surCourant = () => {}, surSauvegarde = () => {} }) {
  const barre = document.createElement("div");
  const fil = document.createElement("div");
  fil.className = "ya-crumbs";
  fil.hidden = true;
  const code = document.createElement("div");
  code.className = "editeur-code";
  const questionOnglet = document.createElement("div");

  const liste = []; // { chemin, zone, disque (texte de base), version (de base), apercu, modifie, question, supprime, avis }
  let actif = null;
  let diff = null; // { chemin, el } : l'onglet de diff, au plus un, jamais gardé
  let avantDiff = null; // onglet actif quand le diff s'est ouvert
  let pret = false;
  let dernierGeste = 0; // numéro du dernier geste de l'utilisateur : le dernier l'emporte sur une lecture plus ancienne
  let lectures = 1; // la restauration compte comme une lecture en cours
  let detruit = false;
  let minuteur = null;
  let minuteurDisque = null;
  let sondageEnCours = false;
  let coupe = false;
  let statuts = new Map(); // chemin -> { lettre, mot } : statuts git (REQ-039)
  const attente = new Set(); // onglets dont Ctrl+S attend le retour de la connexion

  const trouver = (chemin) => liste.find((o) => o.chemin === chemin);

  function garderListe() {
    if (!pret) return;
    if (minuteur) return; // un minuteur en cours n'est pas réarmé : une frappe continue est écrite en moins d'une seconde
    minuteur = setTimeout(() => {
      minuteur = null;
      ecrireGarde();
    }, 200);
  }

  function ecrireGarde() {
    garder(
      liste.map((o) => ({ chemin: o.chemin, apercu: o.apercu, texte: o.modifie ? o.zone.contenu() : undefined, base: o.modifie ? o.disque : undefined, version: o.modifie ? o.version : undefined, attente: attente.has(o) })),
      actif === DIFF ? (liste[0]?.chemin ?? null) : actif,
    );
  }

  function direAttente() {
    surAttente(texteAttente([...attente].map((o) => nomDe(o.chemin))));
  }

  // ---- Affichage ----

  // Fil d'Ariane (texte sans action) et barre d'état : le fichier actif, ou rien.
  function publier(o) {
    if (!o) {
      fil.hidden = true;
      fil.replaceChildren();
      surCourant(null);
      return surActif(null);
    }
    const segments = o.chemin.split("/");
    fil.replaceChildren(
      ...segments.flatMap((nom, i) => {
        const e = document.createElement("span");
        e.className = i === segments.length - 1 ? "ya-crumbs-nom" : "ya-crumbs-segment";
        e.textContent = nom;
        return i === 0 ? [e] : [icone("chevron", 12), e];
      }),
    );
    fil.hidden = false;
    const etat = (o === diff ? diff.el : o.zone).vue?.state;
    let position;
    if (etat) {
      const tete = etat.selection.main.head;
      const l = etat.doc.lineAt(tete);
      position = `Ln ${l.number}, Col ${tete - l.from + 1}`;
    }
    surCourant(o === diff ? null : o.chemin);
    surActif({ position, langage: o === diff ? undefined : nomLangage(nomDe(o.chemin)) });
  }

  // Seuls M, A et U colorent un onglet.
  const statutOnglet = (chemin) => {
    const l = statuts.get(chemin)?.lettre;
    return l === "M" || l === "A" || l === "U" ? l : undefined;
  };

  function afficher() {
    if (detruit) return;
    const avaitLeFocus = barre.contains(document.activeElement);
    const o = actif === DIFF ? diff : trouver(actif);
    if (!o && lectures > 0) {
      barre.replaceChildren();
      questionOnglet.replaceChildren();
      code.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
      return publier(null);
    }
    if (!o) {
      const b = bouton({ libelle: "Ouvrir un fichier" });
      b.addEventListener("click", ouvrirRapide);
      barre.replaceChildren();
      questionOnglet.replaceChildren();
      code.replaceChildren(indication({ texte: "Aucun fichier ouvert.", action: b }));
      return publier(null);
    }
    const noms = libelles(liste.map((x) => x.chemin));
    let actionsDroite = [];
    if (o !== diff && avecApercu(o.chemin)) {
      const ap = bouton({ icone: "eye", variante: "discret", nomAccessible: "Aperçu", presse: o.apercu });
      ap.addEventListener("click", () => {
        o.apercu = !o.apercu;
        o.zone.definirApercu(o.apercu);
        ap.setAttribute("aria-pressed", String(o.apercu));
        garderListe();
      });
      actionsDroite = [ap.enveloppe];
    }
    const ongl = onglets({
      onglets: [...(diff ? [{ id: DIFF, libelle: `${nomDe(diff.chemin)} (diff)`, titre: diff.chemin, fermable: true }] : []), ...liste.map((x, i) => ({
        id: x.chemin,
        libelle: noms[i].libelle,
        detail: noms[i].detail,
        titre: x.chemin,
        modifie: x.modifie,
        statut: statutOnglet(x.chemin),
        question: Boolean(x.question),
        fermable: true,
      }))],
      actif,
      actionsDroite,
      surChoix: choisir,
      surFermer: fermer,
      surMenu: ouvrirMenu,
    });
    ongl.setAttribute("aria-label", "Fichiers ouverts");
    barre.replaceChildren(ongl);
    ongl.choisir(actif);
    if (avaitLeFocus) ongl.querySelector("[role=tab][aria-selected=true]")?.focus();
    const avis = o.avis ?? null;
    if (questionOnglet.firstChild !== avis) questionOnglet.replaceChildren(...(avis ? [avis] : []));
    const zones = [...liste.map((x) => [x, x.zone]), ...(diff ? [[diff, diff.el]] : [])];
    for (const [x, z] of zones) {
      if (z.parentNode !== code) code.append(z);
      z.hidden = x !== o;
    }
    for (const enfant of [...code.children]) if (!zones.some(([, z]) => z === enfant)) enfant.remove();
    if (lectures > 0) code.prepend(indication({ texte: "Chargement…", variante: "chargement" }));
    publier(o);
  }

  // Choix d'un onglet : la barre est refaite après le rappel, qui peut encore donner le focus à l'ancien onglet.
  function choisir(chemin) {
    dernierGeste++;
    actif = chemin;
    for (const o of liste) o.zone.hidden = o.chemin !== chemin;
    (chemin === DIFF ? diff?.el : trouver(chemin)?.zone)?.vue?.focus();
    queueMicrotask(afficher);
    garderListe();
  }

  // ---- Ouvrir, renommer, supprimer ----

  function creer({ chemin, contenu, version, texte, apercu = false }) {
    const o = { chemin, disque: contenu, version, apercu, modifie: false };
    o.zone = zoneCode({
      contenu: texte ?? contenu,
      langage: langagePourFichier(nomDe(chemin)) ?? undefined,
      nom: nomDe(chemin),
      apercu,
      surPosition() {
        if (trouver(actif) === o) publier(o);
      },
      surChangement(t) {
        const m = t !== o.disque;
        if (m === o.modifie) return garderListe();
        o.modifie = m;
        afficher();
        garderListe();
      },
    });
    o.modifie = o.zone.contenu() !== contenu;
    liste.push(o);
    return o;
  }

  /** `geste` : valeur rendue par `lecture(true)`. Sans valeur, l'ouverture est elle-même un geste. */
  function ouvrir({ chemin, contenu, version, ligne, geste = ++dernierGeste }) {
    if (!trouver(chemin)) creer({ chemin, contenu, version });
    if (geste !== dernierGeste && (actif === DIFF || trouver(actif))) {
      // Un geste plus récent a choisi un autre onglet : le fichier s'ouvre en arrière-plan.
      afficher();
      garderListe();
      return;
    }
    actif = chemin;
    afficher();
    if (Number.isInteger(ligne)) trouver(chemin).zone.aller(ligne);
    trouver(chemin).zone.vue.focus();
    garderListe();
  }

  function renomme({ de, vers }) {
    for (const o of liste) {
      const nouveau = suivreRenommage(o.chemin, de, vers);
      if (nouveau === o.chemin) continue;
      if (actif === o.chemin) actif = nouveau;
      o.chemin = nouveau;
      o.zone.vue.contentDOM.setAttribute("aria-label", `Éditeur ${nomDe(nouveau)}`);
    }
    afficher();
    garderListe();
  }

  function supprime({ chemin }) {
    for (const o of liste.filter((x) => estSous(x.chemin, chemin))) retirer(o.chemin);
  }

  function retirer(chemin) {
    const ids = liste.map((o) => o.chemin);
    const i = liste.findIndex((o) => o.chemin === chemin);
    if (i < 0) return;
    const suivant = apresFermeture(ids, chemin);
    if (attente.delete(liste[i])) direAttente();
    liste[i].zone.detruire();
    liste[i].zone.remove();
    liste.splice(i, 1);
    if (actif === chemin) actif = suivant ?? (diff ? DIFF : null);
    afficher();
    garderListe();
  }

  // ---- Onglet de diff (V-005) ----

  /** Ouvre le diff de `chemin` dans l'onglet de diff, qui remplace le précédent. `avis` : texte à montrer au lieu du diff. */
  function ouvrirDiff({ chemin, texte, avis }) {
    dernierGeste++;
    if (actif !== DIFF) avantDiff = actif;
    diff?.el.detruire?.();
    diff?.el.remove();
    // La zone peut signaler sa position pendant sa création : `el` n'existe pas encore, on se repère au chemin.
    const el = avis ? indication({ texte: avis }) : zoneCode({ contenu: texte, mode: "diff", nom: nomDe(chemin), surPosition: () => actif === DIFF && diff?.chemin === chemin && publier(diff) });
    diff = { chemin, el };
    actif = DIFF;
    afficher();
    el.vue?.focus();
  }

  function fermerDiff() {
    if (!diff) return;
    diff.el.detruire?.();
    diff.el.remove();
    diff = null;
    if (actif === DIFF) actif = trouver(avantDiff) ? avantDiff : (liste[0]?.chemin ?? null);
    afficher();
    garderListe();
  }

  // ---- Sauvegarde et fermeture ----

  async function ecrire(o, texte) {
    o.ecriture = ecrireFichier(o.chemin, texte, o.version);
    const r = await o.ecriture;
    // La version de base change avant la fin de l'écriture : une sauvegarde qui attendait part avec la bonne.
    if (!r.cause && !r.coupure) changerBase(o, texte, r.version);
    o.ecriture = null;
    return r;
  }

  /**
   * Écrit l'onglet. Rend `null` si c'est fait, `SANS_SUITE` si une question attend ou si le fichier a été rechargé
   * (rien n'est écrit), sinon le texte de l'échec.
   */
  async function sauvegarder(o) {
    // Une écriture en cours finit d'abord : la suivante part avec la version qu'elle rend.
    while (o.ecriture) await o.ecriture;
    if (o.question) return SANS_SUITE;
    const texte = o.zone.contenu();
    let r = await ecrire(o, texte);
    if (r.cause === "conflit" && !detruit) {
      // Le disque a changé depuis la version de base : jamais d'écrasement sans question.
      const lecture = await lireFichier(o.chemin);
      if (detruit) return "";
      if (lecture.coupure) return TEXTE_COUPURE;
      const d = decisionDisque(o, lecture);
      if (d === "adopter") {
        changerBase(o, lecture.contenu, lecture.version);
        r = await ecrire(o, texte);
      } else if (d === "recharger" || d === "demander") {
        appliquer(o, lecture, d);
        return SANS_SUITE;
      }
    }
    if (detruit) return "";
    if (r.coupure) return TEXTE_COUPURE;
    if (r.cause) return `Sauvegarde impossible pour ${nomDe(o.chemin)} : ${r.message.replace(/\.$/, "")}. Vos modifications sont gardées.`;
    effacerAvis(o);
    surSauvegarde();
    o.modifie = o.zone.contenu() !== texte;
    o.alerte?.remove();
    o.alerte = null;
    afficher();
    garderListe();
    return null;
  }

  // ---- Changements sur le disque (REQ-017) ----

  function changerBase(o, contenu, version) {
    o.disque = contenu;
    o.version = version;
    o.rev = (o.rev ?? 0) + 1;
  }

  function effacerAvis(o) {
    o.avis = null;
    o.question = null;
    o.supprime = false;
  }

  function poserQuestion(o, lecture) {
    if (o.question) {
      o.question.version = lecture.version;
      o.question.contenu = lecture.contenu;
      return;
    }
    o.supprime = false;
    const garderMa = bouton({ libelle: "Garder ma version", variante: "secondaire" });
    const prendre = bouton({ libelle: "Prendre celle du disque", variante: "secondaire" });
    const q = { version: lecture.version, contenu: lecture.contenu, garder: garderMa };
    o.question = q;
    o.avis = message({ texte: `${nomDe(o.chemin)} a changé sur le disque. Quelle version garder ?`, variante: "alerte", actions: [garderMa, prendre] });
    garderMa.addEventListener("click", () => {
      changerBase(o, q.contenu, q.version);
      o.modifie = o.zone.contenu() !== o.disque;
      effacerAvis(o);
      afficher();
      garderListe();
      o.zone.vue.focus();
    });
    prendre.addEventListener("click", () => {
      changerBase(o, q.contenu, q.version);
      effacerAvis(o);
      o.zone.remplacer(q.contenu);
      o.modifie = false;
      afficher();
      garderListe();
      o.zone.vue.focus();
    });
    afficher();
  }

  function appliquer(o, lecture, decision) {
    if (decision === "adopter") {
      changerBase(o, lecture.contenu, lecture.version);
      effacerAvis(o);
    } else if (decision === "recharger") {
      changerBase(o, lecture.contenu, lecture.version);
      effacerAvis(o);
      o.zone.remplacer(lecture.contenu);
      o.modifie = false;
    } else if (decision === "demander") {
      return poserQuestion(o, lecture);
    } else if (decision === "supprime") {
      if (o.supprime) return;
      effacerAvis(o);
      o.supprime = true;
      o.avis = message({ texte: TEXTE_SUPPRIME, variante: "alerte" });
    } else return;
    afficher();
    garderListe();
  }

  /** L'onglet de la question devient actif et le focus va sur « Garder ma version ». */
  function montrerQuestion(o) {
    actif = o.chemin;
    afficher();
    o.question.garder.focus();
    garderListe();
  }

  async function verifierDisque() {
    if (coupe || !pret || detruit || sondageEnCours || liste.length === 0) return;
    sondageEnCours = true;
    try {
      const instantane = new Map(liste.map((o) => [o, o.rev]));
      const versions = await versionsFichiers(liste.map((o) => o.chemin));
      if (!versions || detruit) return;
      const inchange = (o) => liste.includes(o) && o.rev === instantane.get(o) && !o.ecriture;
      for (const o of instantane.keys()) {
        if (detruit) return;
        if (!inchange(o)) continue;
        const v = versions[o.chemin];
        if (v === undefined) continue;
        if (v === null) {
          appliquer(o, null, "supprime");
          continue;
        }
        if (o.supprime) {
          effacerAvis(o);
          afficher();
        }
        if (v === o.version || v === o.question?.version) continue;
        const lecture = await lireFichier(o.chemin);
        if (detruit || !inchange(o)) continue;
        appliquer(o, lecture, decisionDisque(o, lecture));
      }
    } finally {
      sondageEnCours = false;
    }
  }

  function planifierDisque() {
    minuteurDisque = setTimeout(async () => {
      await verifierDisque();
      if (!detruit) planifierDisque();
    }, INTERVALLE_DISQUE);
  }

  function mettreEnAttente(o) {
    attente.add(o);
    direAttente();
    garderListe();
  }

  /** Lance les Ctrl+S en attente. */
  function executerAttente() {
    const a = [...attente];
    attente.clear();
    direAttente();
    garderListe(); // « Ctrl+S en attente » ne reste pas gardé
    for (const o of a) sauvegarderEtDire(o);
  }

  async function sauvegarderEtDire(o) {
    const echec = await sauvegarder(o);
    if (!echec) return;
    if (echec === SANS_SUITE) return garderListe(); // refus du serveur : la question remplace le Ctrl+S
    if (echec === TEXTE_COUPURE) {
      mettreEnAttente(o);
      // La coupure n'est pas encore détectée (ou le retour a été trop bref) : sans changement d'état, personne ne relancerait.
      setTimeout(() => {
        if (!detruit && !coupe && attente.has(o)) executerAttente();
      }, DELAI_DETECTION);
      return;
    }
    o.alerte?.remove();
    o.alerte = dire({ texte: echec, variante: "alerte", fermable: true });
  }

  const fermer = (chemin) => {
    fermerOnglet(chemin, false);
  };

  /**
   * Ferme un onglet, avec le dialogue de REQ-014 s'il est modifié. Rend une promesse de l'issue :
   * `fermé`, `annulé` ou `échec` (dans une série, une sauvegarde impossible ferme le dialogue et affiche un bandeau).
   */
  function fermerOnglet(chemin, serie) {
    if (chemin === DIFF) {
      fermerDiff();
      return Promise.resolve("fermé");
    }
    const o = trouver(chemin);
    if (!o) return Promise.resolve("fermé");
    if (o.question) {
      montrerQuestion(o);
      return Promise.resolve("annulé");
    }
    if (!o.modifie) {
      retirer(chemin);
      return Promise.resolve("fermé");
    }
    return new Promise((resolve) => {
      const annuler = bouton({ libelle: "Annuler" });
      const abandonner = bouton({ libelle: "Abandonner" });
      const ok = bouton({ libelle: "Sauvegarder", variante: "principal" });
      const zone = document.createElement("div");
      const texte = document.createElement("p");
      texte.textContent = "Ce fichier a des modifications non sauvegardées.";
      zone.append(texte);
      const annulerTout = () => {
        dlg.fermer();
        resolve("annulé");
      };
      const dlg = dialogue({
        titre: `Sauvegarder ${nomDe(chemin)} ?`,
        contenu: [zone],
        actions: [annuler, abandonner, ok],
        focusInitial: ok,
        surAnnuler: annulerTout,
      });
      annuler.addEventListener("click", annulerTout);
      abandonner.addEventListener("click", () => {
        dlg.fermer({ rendreFocus: false });
        retirer(chemin);
        resolve("fermé");
      });
      ok.addEventListener("click", async () => {
        dlg.enCours(true);
        const echec = await sauvegarder(o);
        if (detruit) return;
        if (echec === SANS_SUITE) {
          dlg.fermer({ rendreFocus: false });
          if (o.question) montrerQuestion(o);
          return resolve("annulé");
        }
        if (echec && serie) {
          dlg.fermer({ rendreFocus: false });
          o.alerte?.remove();
          o.alerte = dire({ texte: echec, variante: "alerte", fermable: true });
          return resolve("échec");
        }
        if (echec) {
          dlg.enCours(false);
          zone.replaceChildren(texte, message({ texte: echec, variante: "alerte" }));
          return;
        }
        dlg.fermer({ rendreFocus: false });
        retirer(chemin);
        resolve("fermé");
      });
      dlg.ouvrir();
    });
  }

  // ---- Menu des onglets et série de fermetures (REQ-061) ----

  const ordre = () => [...(diff ? [DIFF] : []), ...liste.map((o) => o.chemin)];
  const existe = (id) => (id === DIFF ? Boolean(diff) : Boolean(trouver(id)));

  /** Ferme `ids` : d'abord les onglets sans modification, sans question ; puis chaque onglet modifié, un dialogue à la fois. */
  async function fermerSerie(ids, vise) {
    for (const id of ids) {
      if (id === DIFF) fermerDiff();
      else if (trouver(id) && !trouver(id).modifie && !trouver(id).question) retirer(id);
    }
    let arret = null;
    for (const id of ids) {
      const o = id === DIFF ? null : trouver(id);
      if (!o || o.question) continue;
      actif = id;
      afficher();
      if ((await fermerOnglet(id, true)) !== "fermé") {
        arret = id;
        break;
      }
      if (detruit) return;
    }
    if (detruit) return;
    const reste = ordre();
    actif = arret && existe(arret) ? arret : existe(vise) ? vise : (reste[0] ?? null);
    afficher();
    garderListe();
    if (actif === null) code.querySelector("button")?.focus();
    else (actif === DIFF ? diff.el : trouver(actif).zone).vue?.focus();
  }

  function ouvrirMenu(id, position) {
    if (!existe(id)) return;
    dernierGeste++;
    actif = id;
    afficher();
    const onglet = barre.querySelector("[role=tab][aria-selected=true]");
    onglet?.focus();
    const noms = libelles(liste.map((x) => x.chemin));
    const libelle = id === DIFF ? `${nomDe(diff.chemin)} (diff)` : noms[liste.findIndex((x) => x.chemin === id)].libelle;
    const tous = ordre();
    const commandes = [];
    if (tous.length >= 2) commandes.push({ libelle: "Fermer les autres onglets", surChoix: () => fermerSerie(tous.filter((x) => x !== id), id) });
    commandes.push({ libelle: "Fermer tous les onglets", surChoix: () => fermerSerie(tous, id) });
    menu({ nom: `Actions sur ${libelle}`, groupes: [commandes], ...(position ? { position } : { ancre: onglet }), surFermeture: () => {} });
  }

  // Ctrl+S, partout sauf dans un shell : le dialogue du navigateur ne s'ouvre jamais.
  const surTouche = (e) => {
    const s = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "s";
    if (!s || e.target.closest?.(".terminal")) return;
    e.preventDefault();
    if (document.querySelector("[role=dialog], dialog[open]")) return;
    const o = trouver(actif);
    if (!o) return;
    if (o.question) return montrerQuestion(o);
    if (coupe) mettreEnAttente(o);
    else sauvegarderEtDire(o);
  };
  document.addEventListener("keydown", surTouche);

  // ---- Retour : onglets gardés ----

  const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

  /** Lit le fichier d'un onglet gardé ; tant que le serveur ne répond pas, on réessaie : rien n'est effacé. */
  async function lireGarde(g) {
    for (;;) {
      const lecture = await lireFichier(g.chemin);
      if (detruit || decider(g, lecture) !== "reessayer") return lecture;
      await attendre(1500);
    }
  }

  async function restaurer() {
    const gardes = await retrouver();
    const lus = await Promise.all(gardes.liste.map(lireGarde));
    if (detruit) return;
    lectures--;
    const aVerifier = [];
    gardes.liste.forEach((g, i) => {
      if (trouver(g.chemin)) return;
      const r = lus[i];
      const decision = decider(g, r);
      const apercu = Boolean(g.apercu);
      let o;
      if (decision === "creer") {
        // Un brouillon garde sa version de base : si le disque a changé pendant l'absence, la question est posée.
        const brouillon = typeof g.texte === "string" && typeof g.base === "string" && typeof g.version === "string";
        o = creer({ chemin: g.chemin, contenu: brouillon ? g.base : r.contenu, version: brouillon ? g.version : r.version, texte: g.texte, apercu });
      } else if (decision === "recreer") o = creer({ chemin: g.chemin, contenu: "", texte: g.texte, apercu });
      if (o) aVerifier.push([o, r]);
      if (o && g.attente) attente.add(o);
    });
    direAttente();
    if (actif !== DIFF && !trouver(actif)) actif = trouver(gardes.actif) ? gardes.actif : (liste[0]?.chemin ?? null);
    pret = true;
    for (const [o, r] of aVerifier) appliquer(o, r, decisionDisque(o, r));
    afficher();
    garderListe();
    if (!coupe) executerAttente();
    planifierDisque();
    if (actif && document.activeElement === document.body) trouver(actif)?.zone.vue.focus();
  }

  afficher();
  return {
    barre,
    fil,
    code,
    /** Zone de la question de l'onglet actif (C-003 dans `questionOnglet`). */
    question: questionOnglet,
    /** Une lecture de fichier commence (`oui`, rend son numéro de geste) ou se termine. */
    lecture(oui) {
      lectures = Math.max(0, lectures + (oui ? 1 : -1));
      afficher();
      if (oui) return ++dernierGeste;
    },
    /** "connecte" ou "coupe" : au retour, les Ctrl+S mis en attente s'exécutent. */
    definirEtat(etat) {
      coupe = etat === "coupe";
      if (coupe) return;
      executerAttente();
      verifierDisque();
    },
    /** Pose les statuts git (`Map` chemin -> `{ lettre, mot }`) ; la barre n'est refaite que si un onglet change. */
    definirStatuts(nouveaux) {
      const avant = liste.map((o) => statutOnglet(o.chemin)).join();
      statuts = nouveaux;
      if (liste.map((o) => statutOnglet(o.chemin)).join() !== avant) afficher();
    },
    ouvrir,
    ouvrirDiff,
    fermerDiff,
    /** Chemin du fichier dont le diff est ouvert, ou null. */
    diffOuvert: () => diff?.chemin ?? null,
    /** Relit le disque tout de suite (après un changement de branche ou un pull). */
    relireDisque: verifierDisque,
    renomme,
    supprime,
    restaurer,
    detruire() {
      detruit = true;
      clearTimeout(minuteur);
      clearTimeout(minuteurDisque);
      if (pret) ecrireGarde(); // le texte tapé dans les dernières 200 ms n'est pas perdu
      document.removeEventListener("keydown", surTouche);
      for (const o of liste) o.zone.detruire();
      diff?.el.detruire?.();
    },
  };
}
