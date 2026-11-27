import { fermerShell, listeShells, lireEnvironnements, ouvrirShell } from "../api.js";
import { lignes as lignesDuJournal, purger as purgerJournal, suivre as suivreJournal } from "../journal.js";
import { ecrire, lire } from "../stockage.js";
import { bouton } from "../ui/bouton.js";
import { dialogue } from "../ui/dialogue.js";
import { journal } from "../ui/journal.js";
import { menu, menuDuRail } from "../ui/menu.js";
import { message } from "../ui/message.js";
import { placeVisee } from "../disposition.js";
import { imageDeGlisse, suivreFocusPression } from "./depot-onglets.js";
import { fermerInfoBulleDans } from "../ui/info-bulle.js";
import { TYPE_SHELL, onglets } from "../ui/onglets.js";
import { terminal } from "../ui/terminal.js";

export const PAUSE_REPRISE = 1000;
const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const codage = new TextEncoder();

/**
 * REQ-202. Nom de l'environnement par défaut, lu au moment du lancement ; `undefined` s'il n'y en a aucun ou si la lecture échoue
 * (fichier illisible, coupure) : le lancement se fait alors sans environnement.
 */
export async function environnementParDefaut() {
  const r = await lireEnvironnements();
  return Array.isArray(r.environnements) ? r.environnements.find((e) => e.defaut === true)?.nom : undefined;
}

/**
 * Commandes du menu « avec un environnement » (REQ-183), relues à chaque ouverture : un groupe avec les noms par ordre alphabétique,
 * ou la seule commande désactivée qui dit pourquoi il n'y en a pas. `choisir(nom)` lance l'ouverture.
 */
export function commandesEnvironnements(choisir) {
  return async () => {
    const r = await lireEnvironnements();
    if (r.coupure) return [[{ libelle: TEXTE_COUPURE, desactive: true }]];
    if (!Array.isArray(r.environnements)) return [[{ libelle: "Environnements illisibles. Ouvrez Ctrl+P, puis > Environnements.", desactive: true }]];
    if (r.environnements.length === 0) return [[{ libelle: "Aucun environnement. Créez-en un avec Ctrl+P, puis > Environnements.", desactive: true }]];
    const noms = r.environnements.map((e) => e.nom).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
    return [noms.map((nom) => ({ libelle: nom, surChoix: () => choisir(nom) }))];
  };
}

/**
 * Branche `flux` sur la WebSocket du shell `id` ; les messages vont au flux.
 * `surOuverture()` et `surFermeture(evenement)` sont appelés par la connexion. Rend la WebSocket.
 */
export function brancherFlux(id, flux, { surOuverture, surFermeture }) {
  const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/shells/${id}/ws`);
  ws.binaryType = "arraybuffer";
  ws.onopen = surOuverture;
  ws.onmessage = (e) => flux.dispatchEvent(new MessageEvent("message", { data: e.data }));
  ws.onclose = surFermeture;
  return ws;
}

/** Flux d'un terminal : `send` écrit sur la WebSocket courante de `s.ws`, si elle est ouverte. */
export function fluxVers(s) {
  return Object.assign(new EventTarget(), {
    send(donnees) {
      if (s.ws?.readyState === 1) s.ws.send(typeof donnees === "string" ? codage.encode(donnees) : donnees);
    },
  });
}

function texteArret(n) {
  return n > 1 ? `Yaide a été arrêté. ${n} shells ont été fermés.` : "Yaide a été arrêté. 1 shell a été fermé.";
}

/**
 * Zone des shells de V-002. `dire({ texte, variante, detail })` affiche un toast.
 * `surZone(oui, replie)` : la zone a au moins un shell visible ou l'onglet « Logs » (REQ-188), ou n'a ni l'un ni l'autre ; `replie` : elle est repliée.
 * `sansShells` : `fonctions.shells` faux, la zone ne montre que l'onglet « Logs » ; aucun shell n'est lu ni ouvert.
 * `surFermetureLogs()` : l'onglet « Logs » se ferme sans laisser de shell visible, le focus va sur le bouton « Logs » de la barre d'état.
 * `replieImpose` : `true` ou `false` remplace le repli gardé à la restauration.
 * `repli` : le bouton « Replier les shells », que la vue principale place dans la barre de titre.
 * `commandes` : les quatre boutons de C-010, que la vue principale place dans le rail.
 * Méthodes : `definirEtat("connecte" | "coupe")`, `detruire()`.
 */
export function vueShells({ dire, surZone = () => {}, replieImpose, sansShells = false, surFermetureLogs = () => {} }) {
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
  let replie = false;
  // Console des logs (REQ-188) : un onglet, toujours le dernier, jamais gardé. Le composant et ses filtres vivent autant que la page.
  let logsOuvert = false;
  let vueJournal = null;
  let arreterJournal = null;
  const EST_LOGS = "logs";
  // Ordre de la barre (REQ-201) : l'id de chaque shell, réduits compris, et « logs » s'il est ouvert. Seuls les shells sont gardés.
  let ordre = [];
  let glisse = null; // { id, image } pendant un glissé d'onglet

  const boutonNouveau = bouton({
    icone: "terminal",
    variante: "discret",
    nomAccessible: "Nouveau shell",
    positionInfoBulle: "droite",
    menuContextuel: () =>
      menuDuRail({
        nom: "Nouveau shell avec un environnement",
        commandes: commandesEnvironnements((nom) => nouveau(nom)),
        ancre: boutonNouveau,
        ancrage: "rail-gauche",
      }),
  });
  const boutonReduire = bouton({ icone: "minimize-2", variante: "discret", nomAccessible: "Réduire le shell", positionInfoBulle: "droite", desactive: true });
  const boutonReduits = bouton({ icone: "layers", variante: "discret", nomAccessible: "Shells réduits", positionInfoBulle: "droite", desactive: true, ouvreMenu: true });
  const boutonFermer = bouton({ icone: "square-x", variante: "discret", nomAccessible: "Fermer le shell", positionInfoBulle: "droite", desactive: true });
  const boutonRepli = bouton({ icone: "panel-bottom-close", nomAccessible: "Replier les shells", desactive: true });
  racine.repli = boutonRepli;
  boutonRepli.addEventListener("click", () => basculerRepli());
  boutonNouveau.addEventListener("click", async () => nouveau(await environnementParDefaut()));
  boutonReduire.addEventListener("click", () => reduire());
  boutonReduits.addEventListener("click", () => ouvrirMenu());
  boutonFermer.addEventListener("click", () => demanderFermeture(actif, "rail"));
  racine.commandes = [boutonNouveau.enveloppe, boutonReduire.enveloppe, boutonReduits.enveloppe, boutonFermer.enveloppe];

  const parNumero = (liste) => liste.sort((a, b) => a.id - b.id);
  // Les onglets de la barre, dans l'ordre choisi : shells visibles et « Logs » s'il est ouvert.
  const barre = () => ordre.filter((k) => (k === EST_LOGS ? logsOuvert : shells.has(k) && !shells.get(k).reduit));
  const visibles = () => barre().filter((k) => k !== EST_LOGS).map((k) => shells.get(k));
  const reduits = () => parNumero([...shells.values()].filter((s) => s.reduit));
  // Un nouveau shell va à la fin, juste avant « Logs » si celui-ci est le dernier onglet.
  function placer(id) {
    if (barre().at(-1) === EST_LOGS) ordre.splice(ordre.indexOf(EST_LOGS), 0, id);
    else ordre.push(id);
  }
  // Le voisin d'un shell visible : celui de droite, sinon celui de gauche.
  function voisin(id) {
    const v = visibles();
    const i = v.findIndex((s) => s.id === id);
    return (v[i + 1] ?? v[i - 1])?.id ?? null;
  }

  const sauver = () => !sansShells && ecrire("serveur", { instance, nombre: shells.size, reduits: reduits().map((s) => s.id), ordre: ordre.filter((k) => k !== EST_LOGS), replie });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  function majConnecte(s) {
    s.terminal.definirConnecte(s.ouvert && etat !== "coupe");
  }

  const envoyerTaille = (s) => s.ws?.readyState === 1 && s.ws.send(`taille ${s.terminal.term.cols} ${s.terminal.term.rows}`);

  // Les commandes du rail visent un shell : ni zone repliée, ni « Logs » actif.
  const majReduireFermer = () => {
    boutonReduire.disabled = boutonFermer.disabled = visibles().length === 0 || replie || actif === EST_LOGS;
  };

  function activer(id, focaliser = false) {
    actif = id;
    majReduireFermer();
    onglet?.choisir(String(id));
    for (const s of shells.values()) s.terminal.hidden = s.id !== id;
    const s = shells.get(id);
    if (vueJournal) vueJournal.hidden = id !== EST_LOGS;
    s?.terminal.ajuster();
    if (focaliser) focaliserActif();
  }

  function focaliserActif() {
    if (actif === EST_LOGS) vueJournal.focusFiltre();
    else shells.get(actif)?.terminal.focus();
  }

  function creerJournal() {
    vueJournal = journal({ lignes: lignesDuJournal(), purger: () => purgerJournal() });
    vueJournal.hidden = true;
    arreterJournal = suivreJournal((e) => (e.type === "ajout" ? vueJournal.ajouter(e.ligne) : vueJournal.remplacer(e.lignes)));
  }

  /** Bouton « Logs » : la zone apparaît ou se déplie, l'onglet s'ouvre s'il ne l'était pas et devient actif, le focus va dans « Filtrer ». */
  racine.ouvrirLogs = () => {
    if (detruit) return;
    if (!vueJournal) creerJournal();
    else if (!logsOuvert) vueJournal.remplacer(lignesDuJournal());
    if (!logsOuvert) ordre.push(EST_LOGS);
    logsOuvert = true;
    replie = false;
    actif = EST_LOGS;
    afficher();
    vueJournal.descendre();
    vueJournal.focusFiltre();
    sauver();
  };

  function fermerLogs() {
    if (!logsOuvert) return;
    const etaitActif = actif === EST_LOGS;
    const avaitLeFocus = vueJournal.contains(document.activeElement);
    logsOuvert = false;
    ordre = ordre.filter((k) => k !== EST_LOGS);
    if (etaitActif) actif = visibles().at(-1)?.id ?? null;
    afficher();
    sauver();
    if (visibles().length === 0) surFermetureLogs();
    else if (etaitActif || avaitLeFocus) focaliserActif();
  }

  function afficher() {
    const vis = visibles();
    const nombreReduits = reduits().length;
    const avecZone = vis.length > 0 || logsOuvert;
    if (!avecZone) replie = false;
    const valide = actif === EST_LOGS ? logsOuvert : vis.some((s) => s.id === actif);
    if (avecZone && !valide) actif = vis[0]?.id ?? EST_LOGS;
    boutonRepli.disabled = !avecZone;
    const nomRepli = replie ? "Déplier les shells" : "Replier les shells";
    if (boutonRepli.getAttribute("aria-label") !== nomRepli) {
      boutonRepli.definirCommande({ nomAccessible: nomRepli, icone: replie ? "panel-bottom-open" : "panel-bottom-close" });
    }
    majReduireFermer();
    boutonReduits.disabled = nombreReduits === 0;
    if (nombreReduits > 0 || boutonReduits.querySelector(".ya-badge")) boutonReduits.definirCompteur(nombreReduits);
    if (shells.size > 0 || boutonNouveau.querySelector(".ya-badge")) boutonNouveau.definirCompteur(shells.size);
    // La zone revient avant toute mesure de terminal.
    surZone(avecZone, replie);
    const gardes = [...[...shells.values()].map((s) => s.terminal), ...(vueJournal ? [vueJournal] : [])];
    for (const enfant of [...corps.children]) if (!gardes.includes(enfant)) enfant.remove();
    for (const t of gardes) if (t.parentNode !== corps) corps.append(t);
    if (!avecZone) {
      actif = null;
      onglet = null;
      entete.replaceChildren();
      if (vueJournal) vueJournal.hidden = true;
      for (const s of shells.values()) s.terminal.hidden = true;
      return;
    }
    onglet = onglets({
      presentation: "shells",
      onglets: barre().map((k) => (k === EST_LOGS ? { id: EST_LOGS, libelle: "Logs", icone: "list", fermable: true } : { id: String(k), libelle: `shell ${k}`, icone: "terminal", fermable: true })),
      actif: String(actif),
      surChoix: (id) => activer(id === EST_LOGS ? id : Number(id), true),
      surFermer: (id, origine) => (id === EST_LOGS ? fermerLogs() : demanderFermeture(Number(id), origine)),
      surGlisser: (id, ev) => debuterGlisse(id === EST_LOGS ? id : Number(id), ev),
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
    const sansZone = visibles().length === 0 && !logsOuvert && note.dedans;
    if (!grise && !sansZone && !(note.menu && boutonReduits.disabled)) return;
    focusSansZone();
  }
  function focusSansZone() {
    (boutonReduits.disabled ? boutonNouveau : boutonReduits).poserFocus();
  }

  function basculerRepli() {
    if (!replie) {
      replie = true;
      afficher();
      sauver();
      boutonRepli.poserFocus();
      return;
    }
    replie = false;
    afficher();
    const s = shells.get(actif);
    if (s) {
      // `onResize` ne part pas si la mesure égale la valeur par défaut : on envoie toujours la taille.
      envoyerTaille(s);
      s.terminal.focus();
    }
    sauver();
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
    replie = false;
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
    if (!s.reduit && actif === id) actif = voisin(id) ?? (logsOuvert ? EST_LOGS : null);
    const surOnglet = entete.contains(note.e);
    shells.delete(id);
    ordre = ordre.filter((k) => k !== id);
    s.terminal.detruire();
    afficher();
    menuReduits?.retirer(`shell ${id}`);
    sauver();
    if (avaitLeFocus && actif !== null) focaliserActif();
    else if (surOnglet && actif !== null) onglet.querySelector("[role=tab][aria-selected=true]")?.focus();
    else replacerFocus(note);
  }

  // Rend le focus selon l'origine de la demande, après une annulation ou une coupure.
  function rendreFocus(origine, coupure) {
    if (origine === "rail") {
      if (!coupure) boutonFermer.focus();
    } else if (origine === "croix") {
      if (actif !== null) focaliserActif();
      else focusSansZone();
    } else onglet?.querySelector("[role=tab][aria-selected=true]")?.focus();
  }

  function demanderFermeture(id = actif, origine = "rail") {
    if (etat === "coupe") {
      dire({ texte: TEXTE_COUPURE, variante: "alerte" });
      return rendreFocus(origine, true);
    }
    if (!shells.has(id)) return;
    const phrase = document.createElement("p");
    phrase.textContent = "Les programmes qui y tournent seront arrêtés. Cette action est définitive.";
    const zone = document.createElement("div");
    zone.append(phrase);
    const annuler = bouton({ libelle: "Annuler" });
    const ok = bouton({ libelle: "Fermer", variante: "danger" });
    const annulation = () => {
      dlg.fermer({ rendreFocus: false });
      rendreFocus(origine, false);
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
      if (actif !== null) focaliserActif();
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
    ordre = logsOuvert ? [EST_LOGS] : [];
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
    s.ws = brancherFlux(s.id, s.flux, {
      surOuverture: () => {
        s.ouvert = true;
        // Le serveur renvoie l'affichage récent : on repart d'un terminal vide.
        s.terminal.term.reset();
        // Un shell réduit n'a jamais été mesuré : sa taille ne part qu'à son réaffichage.
        if (!s.reduit) envoyerTaille(s);
        majConnecte(s);
      },
      surFermeture: (e) => {
        s.ouvert = false;
        majConnecte(s);
        if (detruit) return;
        if (e.code === 1000) retirer(s.id);
        else reprendre(s);
      },
    });
  }

  function ajouter(id, reduit = false) {
    const s = { id, reduit, ws: null, ouvert: false };
    s.flux = fluxVers(s);
    s.terminal = terminal({
      flux: s.flux,
      nom: `Shell ${id}`,
      connecte: false,
      surTaille: (c, l) => s.ws?.readyState === 1 && s.ws.send(`taille ${c} ${l}`),
    });
    shells.set(id, s);
    if (!ordre.includes(id)) placer(id);
    brancher(s);
  }

  async function nouveau(environnement) {
    if (etat === "coupe") return dire({ texte: TEXTE_COUPURE, variante: "alerte" });
    const r = await ouvrirShell(environnement);
    if (r.coupure) return dire({ texte: TEXTE_COUPURE, variante: "alerte" });
    if (r.erreur) return dire({ texte: `Impossible d'ouvrir un shell : ${r.erreur}.`, variante: "erreur" });
    // Sans shell ouvert, Yaide a pu redémarrer sans que la page le sache : on relit l'instance.
    if (shells.size === 0) instance = (await listeShells())?.instance ?? instance;
    ajouter(r.id);
    replie = false;
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
    replie = replieImpose ?? (precedent?.instance === liste.instance && Boolean(precedent.replie));
    const memeInstance = precedent?.instance === liste.instance;
    const gardes = memeInstance ? (precedent.reduits ?? []) : [];
    // Ordre gardé : un id inconnu est ignoré, un shell absent de la liste va à la fin.
    const connus = (memeInstance && Array.isArray(precedent.ordre) ? precedent.ordre : []).filter((k, i, l) => liste.shells.includes(k) && l.indexOf(k) === i);
    ordre = [...connus, ...(logsOuvert ? [EST_LOGS] : [])];
    for (const id of liste.shells) ajouter(id, gardes.includes(id));
    afficher();
    sauver();
  }

  // ---- Glissé d'un onglet de la barre (REQ-201, C-010 « Glissé d'un onglet de shell »)
  const focusPression = suivreFocusPression((cible) => entete.contains(cible));

  function debuterGlisse(id, ev) {
    const dt = ev.dataTransfer;
    if (!dt) return;
    finirGlisse();
    const image = imageDeGlisse(ev.currentTarget ?? ev.target);
    dt.setDragImage?.(image, 12, 12);
    fermerInfoBulleDans(document.body);
    focusPression.rendre();
    glisse = { id, image };
    for (const t of ["dragenter", "dragover"]) document.addEventListener(t, survolerGlisse, true);
    document.addEventListener("drop", deposerGlisse, true);
    document.addEventListener("dragend", finirGlisse, true);
  }

  // La place visée dans la barre, ou null : refus.
  function viserGlisse(ev) {
    if (!onglet || !entete.contains(ev.target)) return null;
    const cellules = [...onglet.querySelectorAll(".onglet-cellule")].map((c) => {
      const b = c.getBoundingClientRect();
      return { gauche: b.left, droite: b.right };
    });
    return placeVisee({ x: ev.clientX, cellules, rang: barre().indexOf(glisse.id) });
  }

  // Seule la barre des shells accepte ce type ; ailleurs, rien n'arrive à l'élément survolé.
  function survolerGlisse(ev) {
    if (!glisse || !ev.dataTransfer?.types.includes(TYPE_SHELL)) return;
    ev.stopPropagation();
    const place = viserGlisse(ev);
    onglet?.definirInsertion(place);
    if (place === null) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
  }

  function deposerGlisse(ev) {
    if (!glisse || !ev.dataTransfer?.types.includes(TYPE_SHELL)) return;
    ev.stopPropagation();
    const place = viserGlisse(ev);
    if (place === null) return;
    ev.preventDefault();
    const id = glisse.id;
    // Le dépôt refait la barre : `dragend` ne lui arriverait plus.
    finirGlisse();
    deplacer(id, place);
  }

  function finirGlisse() {
    if (!glisse) return;
    glisse.image.remove();
    glisse = null;
    for (const t of ["dragenter", "dragover"]) document.removeEventListener(t, survolerGlisse, true);
    document.removeEventListener("drop", deposerGlisse, true);
    document.removeEventListener("dragend", finirGlisse, true);
    onglet?.definirInsertion(null);
  }

  // `place` : de 0 à la longueur de la barre, avant la cellule visée ; les shells réduits gardent leur voisin.
  function deplacer(id, place) {
    const reste = barre().filter((k) => k !== id);
    const cible = place > barre().indexOf(id) ? place - 1 : place;
    ordre = ordre.filter((k) => k !== id);
    ordre.splice(cible < reste.length ? ordre.indexOf(reste[cible]) : ordre.indexOf(reste.at(-1)) + 1, 0, id);
    actif = id;
    afficher();
    activer(id, true);
    sauver();
  }

  racine.definirEtat = (nouvel) => {
    etat = nouvel;
    for (const s of shells.values()) majConnecte(s);
  };
  racine.detruire = () => {
    detruit = true;
    finirGlisse();
    focusPression.arreter();
    menuReduits?.fermer();
    arreterJournal?.();
    for (const s of shells.values()) {
      if (s.ws) s.ws.onclose = null;
      s.ws?.close();
      s.terminal.detruire();
    }
  };
  if (!sansShells) demarrer();
  return racine;
}
