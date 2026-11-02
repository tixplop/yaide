import { ecrireFichier, lireFichier } from "../api.js";
import { apresFermeture, estSous, garder, libelles, nomDe, retrouver, suivreRenommage } from "../onglets-fichiers.js";
import { bouton } from "../ui/bouton.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { langagePourFichier } from "../ui/langages.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { zoneCode } from "../ui/zone-code.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const estMarkdown = (chemin) => /\.(md|markdown)$/i.test(chemin);

/**
 * Éditeur de V-002. `dire({ texte, variante, fermable })` affiche un bandeau ; `ouvrirRapide()` ouvre V-006.
 * Rend `{ barre, code, lecture(oui), ouvrir({ chemin, contenu, version }), renomme({ de, vers }), supprime({ chemin }), restaurer(), detruire() }`.
 */
export function vueEditeur({ dire, ouvrirRapide = () => {} }) {
  const barre = document.createElement("div");
  const code = document.createElement("div");
  code.className = "editeur-code";

  const liste = []; // { chemin, zone, disque, version, apercu, modifie }
  let actif = null;
  let pret = false;
  let lectures = 1; // la restauration compte comme une lecture en cours
  let detruit = false;
  let minuteur = null;

  const trouver = (chemin) => liste.find((o) => o.chemin === chemin);

  function garderListe() {
    if (!pret) return;
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      garder(
        liste.map((o) => ({ chemin: o.chemin, apercu: o.apercu, texte: o.modifie ? o.zone.contenu() : undefined })),
        actif,
      );
    }, 200);
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

  async function sauvegarderEtDire(o) {
    const echec = await sauvegarder(o);
    if (!echec) return;
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
    if (o) sauvegarderEtDire(o);
  };
  document.addEventListener("keydown", surTouche);

  // ---- Retour : onglets gardés ----

  async function restaurer() {
    const gardes = await retrouver();
    const lus = await Promise.all(gardes.liste.map((g) => lireFichier(g.chemin)));
    if (detruit) return;
    lectures--;
    gardes.liste.forEach((g, i) => {
      if (trouver(g.chemin)) return;
      const r = lus[i];
      if (r.contenu !== undefined) creer({ chemin: g.chemin, contenu: r.contenu, version: r.version, texte: g.texte, apercu: Boolean(g.apercu) });
      else if (r.cause === "introuvable" && typeof g.texte === "string") creer({ chemin: g.chemin, contenu: "", texte: g.texte, apercu: Boolean(g.apercu) });
    });
    if (!trouver(actif)) actif = trouver(gardes.actif) ? gardes.actif : (liste[0]?.chemin ?? null);
    pret = true;
    afficher();
    garderListe();
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
    ouvrir,
    renomme,
    supprime,
    restaurer,
    detruire() {
      detruit = true;
      clearTimeout(minuteur);
      document.removeEventListener("keydown", surTouche);
      for (const o of liste) o.zone.detruire();
    },
  };
}
