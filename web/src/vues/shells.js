import { fermerShell, listeShells, ouvrirShell } from "../api.js";
import { ecrire, lire } from "../stockage.js";
import { bouton } from "../ui/bouton.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
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
 * `commandes` : les boutons « Nouveau shell » et « Fermer le shell », que la vue principale place dans le rail.
 * Méthodes : `definirEtat("connecte" | "coupe")`, `detruire()`.
 */
export function vueShells({ dire }) {
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
  let ouvrirVide = null;

  const boutonNouveau = bouton({ icone: "square-terminal", couleurIcone: "creer", variante: "discret", nomAccessible: "Nouveau shell", positionInfoBulle: "droite" });
  const boutonFermer = bouton({ icone: "square-x", couleurIcone: "supprimer", variante: "discret", nomAccessible: "Fermer le shell", positionInfoBulle: "droite", desactive: true });
  boutonNouveau.addEventListener("click", () => nouveau());
  boutonFermer.addEventListener("click", () => demanderFermeture());
  racine.commandes = [boutonNouveau.enveloppe, boutonFermer.enveloppe];

  const sauver = () => ecrire("serveur", { instance, nombre: shells.size });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  function majConnecte(s) {
    s.terminal.definirConnecte(s.ouvert && etat !== "coupe");
  }

  function activer(id, focaliser = false) {
    actif = id;
    onglet?.choisir(String(id));
    for (const s of shells.values()) s.terminal.hidden = s.id !== id;
    const s = shells.get(id);
    s?.terminal.ajuster();
    if (focaliser) s?.terminal.focus();
  }

  function afficher() {
    boutonFermer.disabled = shells.size === 0;
    if (shells.size === 0) {
      onglet = null;
      const ouvrir = bouton({ libelle: "Ouvrir un shell" });
      ouvrirVide = ouvrir;
      ouvrir.addEventListener("click", nouveau);
      entete.replaceChildren();
      corps.replaceChildren(indication({ texte: "Aucun shell ouvert.", action: ouvrir }));
      return;
    }
    if (!shells.has(actif)) actif = [...shells.keys()][0];
    onglet = onglets({
      onglets: [...shells.keys()].map((id) => ({ id: String(id), libelle: `shell ${id}` })),
      actif: String(actif),
      surChoix: (id) => activer(Number(id), true),
    });
    onglet.setAttribute("aria-label", "Shells");
    entete.replaceChildren(onglet);
    // Les terminaux déjà présents restent en place : le focus ne bouge pas.
    const terminaux = [...shells.values()].map((s) => s.terminal);
    for (const enfant of [...corps.children]) if (!terminaux.includes(enfant)) enfant.remove();
    for (const t of terminaux) if (t.parentNode !== corps) corps.append(t);
    activer(actif);
  }

  function retirer(id) {
    const s = shells.get(id);
    if (!s) return;
    // L'onglet de droite prend la place, sinon celui de gauche.
    if (actif === id) {
      const ids = [...shells.keys()];
      actif = ids[ids.indexOf(id) + 1] ?? ids[ids.indexOf(id) - 1];
    }
    const avaitLeFocus = s.terminal.contains(document.activeElement);
    shells.delete(id);
    s.terminal.detruire();
    afficher();
    sauver();
    if (avaitLeFocus) (shells.size === 0 ? ouvrirVide : shells.get(actif).terminal).focus();
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
      if (shells.size === 0) ouvrirVide?.focus();
      else shells.get(actif)?.terminal.focus();
    });
    dlg.ouvrir();
  }

  function redemarre(liste) {
    const fermes = shells.size;
    instance = liste.instance;
    for (const s of shells.values()) {
      s.ws.onclose = null;
      s.ws.close();
      s.terminal.detruire();
    }
    shells.clear();
    afficher();
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
      ws.send(`taille ${s.terminal.term.cols} ${s.terminal.term.rows}`);
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

  function ajouter(id) {
    const s = { id, ws: null, ouvert: false };
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
    for (const id of liste.shells) ajouter(id);
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
    for (const s of shells.values()) {
      if (s.ws) s.ws.onclose = null;
      s.ws?.close();
      s.terminal.detruire();
    }
  };
  demarrer();
  return racine;
}
