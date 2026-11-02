import { ecrireFichier, lireFichier } from "../api.js";
import { decider, texteAttente } from "../brouillons.js";
import { apresFermeture, estSous, garder, libelles, nomDe, retrouver, suivreRenommage } from "../onglets-fichiers.js";
import { bouton } from "../ui/bouton.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { langagePourFichier } from "../ui/langages.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { zoneCode } from "../ui/zone-code.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const DELAI_DETECTION = 4000;
const estMarkdown = (chemin) => /\.(md|markdown)$/i.test(chemin);

/**
 * Éditeur de V-002. `dire({ texte, variante, fermable })` affiche un bandeau ; `ouvrirRapide()` ouvre V-006.
 * `surAttente(texte)` : phrase des sauvegardes attendant le retour de la connexion (vide s'il n'y en a plus).
 * Rend `{ barre, code, lecture(oui), definirEtat(etat), ouvrir(…), renomme(…), supprime(…), restaurer(), detruire() }`.
 */
export function vueEditeur({ dire, ouvrirRapide = () => {}, surAttente = () => {} }) {
  const barre = document.createElement("div");
  const code = document.createElement("div");
  code.className = "editeur-code";

  const liste = []; // { chemin, zone, disque, version, apercu, modifie }
  let actif = null;
  let pret = false;
  let lectures = 1; // la restauration compte comme une lecture en cours
  let detruit = false;
  let minuteur = null;
  let coupe = false;
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
      liste.map((o) => ({ chemin: o.chemin, apercu: o.apercu, texte: o.modifie ? o.zone.contenu() : undefined, attente: attente.has(o) })),
      actif,
    );
  }

  function direAttente() {
    surAttente(texteAttente([...attente].map((o) => nomDe(o.chemin))));
  }

  // ---- Affichage ----

  function afficher() {
    if (detruit) return;
    const avaitLeFocus = barre.contains(document.activeElement);
    const o = trouver(actif);
    if (!o && lectures > 0) {
      barre.replaceChildren();
      code.replaceChildren(indication({ texte: "Chargement…", variante: "chargement" }));
      return;
    }
    if (!o) {
      const b = bouton({ libelle: "Ouvrir un fichier" });
      b.addEventListener("click", ouvrirRapide);
      barre.replaceChildren();
      code.replaceChildren(indication({ texte: "Aucun fichier ouvert.", action: b }));
      return;
    }
    const noms = libelles(liste.map((x) => x.chemin));
    let actionsDroite = [];
    if (estMarkdown(o.chemin)) {
      const ap = bouton({ libelle: "Aperçu", variante: "discret" });
      ap.setAttribute("aria-pressed", String(o.apercu));
      ap.addEventListener("click", () => {
        o.apercu = !o.apercu;
        o.zone.definirApercu(o.apercu);
        ap.setAttribute("aria-pressed", String(o.apercu));
        garderListe();
      });
      actionsDroite = [ap];
    }
    const ongl = onglets({
      onglets: liste.map((x, i) => ({
        id: x.chemin,
        libelle: noms[i].libelle,
        detail: noms[i].detail,
        titre: x.chemin,
        modifie: x.modifie,
        fermable: true,
      })),
      actif,
      actionsDroite,
      surChoix: choisir,
      surFermer: fermer,
    });
    ongl.setAttribute("aria-label", "Fichiers ouverts");
    barre.replaceChildren(ongl);
    ongl.choisir(actif);
    if (avaitLeFocus) ongl.querySelector("[role=tab][aria-selected=true]")?.focus();
    for (const x of liste) {
      if (x.zone.parentNode !== code) code.append(x.zone);
      x.zone.hidden = x !== o;
    }
    for (const enfant of [...code.children]) if (!liste.some((x) => x.zone === enfant)) enfant.remove();
    if (lectures > 0) code.prepend(indication({ texte: "Chargement…", variante: "chargement" }));
  }

  // Choix d'un onglet : la barre est refaite après le rappel, qui peut encore donner le focus à l'ancien onglet.
  function choisir(chemin) {
    actif = chemin;
    for (const o of liste) o.zone.hidden = o.chemin !== chemin;
    trouver(chemin)?.zone.vue.focus();
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

  function ouvrir({ chemin, contenu, version }) {
    if (!trouver(chemin)) creer({ chemin, contenu, version });
    actif = chemin;
    afficher();
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
    if (actif === chemin) actif = suivant;
    afficher();
    garderListe();
  }

  // ---- Sauvegarde et fermeture ----

  /** Écrit l'onglet. Rend `null` si c'est fait (ou déjà en cours), sinon le texte de l'échec. */
  async function sauvegarder(o) {
    // Une écriture en cours finit d'abord : la suivante part avec la version qu'elle rend.
    while (o.ecriture) await o.ecriture;
    const texte = o.zone.contenu();
    o.ecriture = ecrireFichier(o.chemin, texte, o.version);
    const r = await o.ecriture;
    o.ecriture = null;
    if (detruit) return "";
    if (r.coupure) return TEXTE_COUPURE;
    if (r.cause) return `Sauvegarde impossible pour ${nomDe(o.chemin)} : ${r.message.replace(/\.$/, "")}. Vos modifications sont gardées.`;
    o.disque = texte;
    o.version = r.version;
    o.modifie = o.zone.contenu() !== texte;
    o.alerte?.remove();
    o.alerte = null;
    afficher();
    garderListe();
    return null;
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
    for (const o of a) sauvegarderEtDire(o);
  }

  async function sauvegarderEtDire(o) {
    const echec = await sauvegarder(o);
    if (!echec) return;
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

  function fermer(chemin) {
    const o = trouver(chemin);
    if (!o) return;
    if (!o.modifie) return retirer(chemin);
    const annuler = bouton({ libelle: "Annuler" });
    const abandonner = bouton({ libelle: "Abandonner" });
    const ok = bouton({ libelle: "Sauvegarder", variante: "principal" });
    const zone = document.createElement("div");
    const texte = document.createElement("p");
    texte.textContent = "Ce fichier a des modifications non sauvegardées.";
    zone.append(texte);
    const dlg = dialogue({
      titre: `Sauvegarder ${nomDe(chemin)} ?`,
      contenu: [zone],
      actions: [annuler, abandonner, ok],
      focusInitial: ok,
      surAnnuler: () => dlg.fermer(),
    });
    annuler.addEventListener("click", () => dlg.fermer());
    abandonner.addEventListener("click", () => {
      dlg.fermer({ rendreFocus: false });
      retirer(chemin);
    });
    ok.addEventListener("click", async () => {
      dlg.enCours(true);
      const echec = await sauvegarder(o);
      if (detruit) return;
      if (echec) {
        dlg.enCours(false);
        zone.replaceChildren(texte, message({ texte: echec, variante: "alerte" }));
        return;
      }
      dlg.fermer({ rendreFocus: false });
      retirer(chemin);
    });
    dlg.ouvrir();
  }

  // Ctrl+S, partout sauf dans un shell : le dialogue du navigateur ne s'ouvre jamais.
  const surTouche = (e) => {
    const s = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "s";
    if (!s || e.target.closest?.(".terminal")) return;
    e.preventDefault();
    if (document.querySelector("[role=dialog], dialog[open]")) return;
    const o = trouver(actif);
    if (!o) return;
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
    gardes.liste.forEach((g, i) => {
      if (trouver(g.chemin)) return;
      const r = lus[i];
      const decision = decider(g, r);
      const apercu = Boolean(g.apercu);
      let o;
      if (decision === "creer") o = creer({ chemin: g.chemin, contenu: r.contenu, version: r.version, texte: g.texte, apercu });
      else if (decision === "recreer") o = creer({ chemin: g.chemin, contenu: "", texte: g.texte, apercu });
      if (o && g.attente) attente.add(o);
    });
    direAttente();
    if (!trouver(actif)) actif = trouver(gardes.actif) ? gardes.actif : (liste[0]?.chemin ?? null);
    pret = true;
    afficher();
    garderListe();
    if (!coupe) executerAttente();
    if (actif && document.activeElement === document.body) trouver(actif).zone.vue.focus();
  }

  afficher();
  return {
    barre,
    code,
    /** Une lecture de fichier commence (`oui`) ou se termine. */
    lecture(oui) {
      lectures = Math.max(0, lectures + (oui ? 1 : -1));
      afficher();
    },
    /** "connecte" ou "coupe" : au retour, les Ctrl+S mis en attente s'exécutent. */
    definirEtat(etat) {
      coupe = etat === "coupe";
      if (coupe) return;
      executerAttente();
    },
    ouvrir,
    renomme,
    supprime,
    restaurer,
    detruire() {
      detruit = true;
      clearTimeout(minuteur);
      if (pret) ecrireGarde(); // le texte tapé dans les dernières 200 ms n'est pas perdu
      document.removeEventListener("keydown", surTouche);
      for (const o of liste) o.zone.detruire();
    },
  };
}
