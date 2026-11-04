import { fermerShell, listeShells, ouvrirShell } from "../api.js";
import { ecrire, lire } from "../stockage.js";
import { bouton } from "../ui/bouton.js";
import { dialogue } from "../ui/dialogue.js";
import { menu } from "../ui/menu.js";
import { message } from "../ui/message.js";
import { onglets } from "../ui/onglets.js";
import { terminal } from "../ui/terminal.js";

const PAUSE_REPRISE = 1000;
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const codage = new TextEncoder();

function texteArret(n) {
  return n > 1 ? `Yaide a été arrêté. ${n} shells ont été fermés.` : "Yaide a été arrêté. 1 shell a été fermé.";
}

/**
 * Zone des shells de V-002. `dire({ texte, variante, fermable })` affiche un message dans les bandeaux.
 * `surZone(oui)` : la zone a au moins un shell visible, ou n'en a aucun.
 * `commandes` : les quatre boutons de C-010, que la vue principale place dans le rail.
 * Méthodes : `definirEtat("connecte" | "coupe")`, `detruire()`.
 */
export function vueShells({ dire, surZone = () => {} }) {
  const racine = document.createElement("div");
  racine.className = "shells";
  const entete = document.createElement("div");
  const corps = document.createElement("div");
  corps.className = "shells-corps";
  racine.append(entete, corps);

  const shells = new Map();
  let actif = null;
  let instance = null;
  let etat = "connecte";
  let detruit = false;
  let onglet = null;
  let menuReduits = null;

  const boutonNouveau = bouton({ icone: "terminal", variante: "discret", nomAccessible: "Nouveau shell", positionInfoBulle: "droite" });
  const boutonReduire = bouton({ icone: "minimize-2", variante: "discret", nomAccessible: "Réduire le shell", positionInfoBulle: "droite", desactive: true });
  const boutonReduits = bouton({ icone: "layers", variante: "discret", nomAccessible: "Shells réduits", positionInfoBulle: "droite", desactive: true, ouvreMenu: true });
  const boutonFermer = bouton({ icone: "square-x", variante: "discret", nomAccessible: "Fermer le shell", positionInfoBulle: "droite", desactive: true });
  boutonNouveau.addEventListener("click", () => nouveau());
  boutonReduire.addEventListener("click", () => reduire());
  boutonReduits.addEventListener("click", () => ouvrirMenu());
  boutonFermer.addEventListener("click", () => demanderFermeture());
  racine.commandes = [boutonNouveau.enveloppe, boutonReduire.enveloppe, boutonReduits.enveloppe, boutonFermer.enveloppe];

  const parNumero = (liste) => liste.sort((a, b) => a.id - b.id);
  const visibles = () => parNumero([...shells.values()].filter((s) => !s.reduit));
  const reduits = () => parNumero([...shells.values()].filter((s) => s.reduit));
  // Le voisin d'un shell visible : celui de droite, sinon celui de gauche.
  function voisin(id) {
    const v = visibles();
    const i = v.findIndex((s) => s.id === id);
    return (v[i + 1] ?? v[i - 1])?.id ?? null;
  }

  const sauver = () => ecrire("serveur", { instance, nombre: shells.size, reduits: reduits().map((s) => s.id) });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  function majConnecte(s) {
    s.terminal.definirConnecte(s.ouvert && etat !== "coupe");
  }

  const envoyerTaille = (s) => s.ws?.readyState === 1 && s.ws.send(`taille ${s.terminal.term.cols} ${s.terminal.term.rows}`);

  function activer(id, focaliser = false) {
    actif = id;
    onglet?.choisir(String(id));
    for (const s of shells.values()) s.terminal.hidden = s.id !== id;
    const s = shells.get(id);
    s?.terminal.ajuster();
    if (focaliser) s?.terminal.focus();
  }

  function afficher() {
    const vis = visibles();
    const nombreReduits = reduits().length;
    boutonReduire.disabled = boutonFermer.disabled = vis.length === 0;
    boutonReduits.disabled = nombreReduits === 0;
    if (nombreReduits > 0 || boutonReduits.querySelector(".ya-badge")) boutonReduits.definirCompteur(nombreReduits);
    // La zone revient avant toute mesure de terminal.
    surZone(vis.length > 0);
    const terminaux = [...shells.values()].map((s) => s.terminal);
    for (const enfant of [...corps.children]) if (!terminaux.includes(enfant)) enfant.remove();
    for (const t of terminaux) if (t.parentNode !== corps) corps.append(t);
    if (vis.length === 0) {
      actif = null;
      onglet = null;
      entete.replaceChildren();
      for (const s of shells.values()) s.terminal.hidden = true;
      return;
    }
    if (!vis.some((s) => s.id === actif)) actif = vis[0].id;
    onglet = onglets({
      onglets: vis.map((s) => ({ id: String(s.id), libelle: `shell ${s.id}` })),
      actif: String(actif),
      surChoix: (id) => activer(Number(id), true),
    });
    onglet.setAttribute("aria-label", "Shells");
    entete.replaceChildren(onglet);
    activer(actif);
  }

  // Focus quand la zone disparaît, ou qu'un bouton du rail vient d'être grisé : « Shells réduits » s'il en reste un, sinon « Nouveau shell ».
  const noterFocus = () => {
    const e = document.activeElement;
    const dedans = racine.contains(e) || e?.getAttribute?.("aria-label") === "Hauteur des shells";
    return { e, dedans, menu: Boolean(menuReduits?.racine.contains(e)) };
  };
  function replacerFocus(note) {
    const grise = note.e instanceof HTMLButtonElement && note.e.disabled;
    const sansZone = visibles().length === 0 && note.dedans;
    if (!grise && !sansZone && !(note.menu && boutonReduits.disabled)) return;
    focusSansZone();
  }
  function focusSansZone() {
    (boutonReduits.disabled ? boutonNouveau : boutonReduits).poserFocus();
  }

  function reduire() {
    const s = shells.get(actif);
    if (!s) return;
    const note = noterFocus();
    const suivant = voisin(s.id);
    s.reduit = true;
    actif = suivant;
    afficher();
    sauver();
    if (suivant !== null) shells.get(suivant).terminal.focus();
    else replacerFocus(note);
  }

  function reveler(id) {
    const s = shells.get(id);
    if (!s?.reduit) return;
    s.reduit = false;
    actif = id;
    afficher();
    // `onResize` ne part pas si la mesure égale la valeur par défaut : on envoie toujours la taille.
    envoyerTaille(s);
    s.terminal.focus();
    sauver();
  }

  function ouvrirMenu() {
    const liste = reduits();
    if (liste.length === 0) return;
    boutonReduits.focus();
    const r = boutonReduits.getBoundingClientRect();
    menuReduits = menu({
      nom: "Shells réduits",
      position: { x: r.right + 4, y: r.top },
      groupes: [liste.map((s) => ({ libelle: `shell ${s.id}`, surChoix: () => reveler(s.id) }))],
      surFermeture: () => {
        menuReduits = null;
        boutonReduits.definirOuvert(false);
      },
    });
    boutonReduits.definirOuvert(true);
  }

  function retirer(id) {
    const s = shells.get(id);
    if (!s) return;
    const note = noterFocus();
    const avaitLeFocus = s.terminal.contains(document.activeElement);
    if (!s.reduit && actif === id) actif = voisin(id);
    const surOnglet = entete.contains(note.e);
    shells.delete(id);
    s.terminal.detruire();
    afficher();
    menuReduits?.retirer(`shell ${id}`);
    sauver();
    if (avaitLeFocus && actif !== null) shells.get(actif).terminal.focus();
    else if (surOnglet && actif !== null) onglet.querySelector("[role=tab][aria-selected=true]")?.focus();
    else replacerFocus(note);
  }

  function demanderFermeture() {
    if (etat === "coupe") return dire({ texte: TEXTE_COUPURE, variante: "alerte" });
    const id = actif;
    if (!shells.has(id)) return;
    const phrase = document.createElement("p");
    phrase.textContent = "Les programmes qui y tournent seront arrêtés. Cette action est définitive.";
    const zone = document.createElement("div");
    zone.append(phrase);
    const annuler = bouton({ libelle: "Annuler" });
    const ok = bouton({ libelle: "Fermer", variante: "danger" });
    const annulation = () => {
      dlg.fermer({ rendreFocus: false });
      boutonFermer.focus();
    };
    const dlg = dialogue({ titre: `Fermer shell ${id} ?`, contenu: [zone], actions: [annuler, ok], focusInitial: annuler, surAnnuler: annulation });
    annuler.addEventListener("click", annulation);
    ok.addEventListener("click", async () => {
      dlg.enCours(true);
      const r = await fermerShell(id);
      if (detruit) return;
      dlg.enCours(false);
      const texte = r.coupure ? TEXTE_COUPURE : r.erreur ? `Impossible de fermer ce shell : ${r.erreur}.` : null;
      if (texte) {
        zone.replaceChildren(phrase, message({ texte, variante: r.coupure ? "alerte" : "erreur" }));
        return;
      }
      dlg.fermer({ rendreFocus: false });
      const s = shells.get(id);
      if (s) {
        // La fermeture de la connexion qui suit n'est pas une coupure : pas de reprise.
        s.ws.onclose = null;
        s.ws.close();
        retirer(id);
      }
      if (actif !== null) shells.get(actif).terminal.focus();
      else focusSansZone();
    });
    dlg.ouvrir();
  }

  function redemarre(liste) {
    const fermes = shells.size;
    const note = noterFocus();
    menuReduits?.fermer();
    instance = liste.instance;
    for (const s of shells.values()) {
      s.ws.onclose = null;
      s.ws.close();
      s.terminal.detruire();
    }
    shells.clear();
    afficher();
    replacerFocus(note);
    if (fermes > 0) dire({ texte: texteArret(fermes), variante: "info", fermable: true });
    sauver();
  }

  async function reprendre(s) {
    while (!detruit && shells.get(s.id) === s) {
      await pause(PAUSE_REPRISE);
      const liste = await listeShells();
      if (!liste || detruit) continue;
      if (liste.instance !== instance) return redemarre(liste);
      if (!liste.shells.includes(s.id)) return retirer(s.id);
      return brancher(s);
    }
  }

  function brancher(s) {
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/shells/${s.id}/ws`);
    ws.binaryType = "arraybuffer";
    s.ws = ws;
    ws.onopen = () => {
      s.ouvert = true;
      // Le serveur renvoie l'affichage récent : on repart d'un terminal vide.
      s.terminal.term.reset();
      // Un shell réduit n'a jamais été mesuré : sa taille ne part qu'à son réaffichage.
      if (!s.reduit) envoyerTaille(s);
      majConnecte(s);
    };
    ws.onmessage = (e) => s.flux.dispatchEvent(new MessageEvent("message", { data: e.data }));
    ws.onclose = (e) => {
      s.ouvert = false;
      majConnecte(s);
      if (detruit) return;
      if (e.code === 1000) retirer(s.id);
      else reprendre(s);
    };
  }

  function ajouter(id, reduit = false) {
    const s = { id, reduit, ws: null, ouvert: false };
    s.flux = Object.assign(new EventTarget(), {
      send(donnees) {
        if (s.ws?.readyState === 1) s.ws.send(typeof donnees === "string" ? codage.encode(donnees) : donnees);
      },
    });
    s.terminal = terminal({
      flux: s.flux,
      numero: id,
      connecte: false,
      surTaille: (c, l) => s.ws?.readyState === 1 && s.ws.send(`taille ${c} ${l}`),
    });
    shells.set(id, s);
    brancher(s);
  }

  async function nouveau() {
    if (etat === "coupe") return dire({ texte: TEXTE_COUPURE, variante: "alerte" });
    const r = await ouvrirShell();
    if (r.coupure) return dire({ texte: TEXTE_COUPURE, variante: "alerte" });
    if (r.erreur) return dire({ texte: `Impossible d'ouvrir un shell : ${r.erreur}.`, variante: "erreur" });
    // Sans shell ouvert, Yaide a pu redémarrer sans que la page le sache : on relit l'instance.
    if (shells.size === 0) instance = (await listeShells())?.instance ?? instance;
    ajouter(r.id);
    afficher();
    activer(r.id, true);
    sauver();
  }

  async function demarrer() {
    let liste;
    while (!(liste = await listeShells())) {
      if (detruit) return;
      await pause(PAUSE_REPRISE);
    }
    const precedent = await lire("serveur");
    if (detruit) return;
    if (precedent && precedent.instance !== liste.instance && precedent.nombre > 0) {
      dire({ texte: texteArret(precedent.nombre), variante: "info", fermable: true });
    }
    instance = liste.instance;
    // Les numéros repartent après un redémarrage : les réduits ne se reprennent que pour la même instance.
    const gardes = precedent?.instance === liste.instance ? (precedent.reduits ?? []) : [];
    for (const id of liste.shells) ajouter(id, gardes.includes(id));
    if (shells.size === 0) {
      const r = await ouvrirShell();
      if (detruit) return;
      if (r.id) ajouter(r.id);
      else if (r.erreur) dire({ texte: `Impossible d'ouvrir un shell : ${r.erreur}.`, variante: "erreur" });
    }
    afficher();
    sauver();
  }

  racine.definirEtat = (nouvel) => {
    etat = nouvel;
    for (const s of shells.values()) majConnecte(s);
  };
  racine.detruire = () => {
    detruit = true;
    menuReduits?.fermer();
    for (const s of shells.values()) {
      if (s.ws) s.ws.onclose = null;
      s.ws?.close();
      s.terminal.detruire();
    }
  };
  demarrer();
  return racine;
}
