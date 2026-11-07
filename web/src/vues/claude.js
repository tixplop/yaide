import { listeShells } from "../api.js";
import { message } from "../ui/message.js";
import { terminal } from "../ui/terminal.js";
import { PAUSE_REPRISE, brancherFlux, fluxVers } from "./shells.js";

const TEXTE_ARRET = "Claude Code s'est arrêté (code 1). Corrigez l'erreur ci-dessous, puis relancez Claude.";

/**
 * Session Claude : le terminal `nom` branché sur la session `id`. `corps` contient le terminal et, quand Claude Code s'arrête en échec, le message.
 * `surFin({ code })` : Claude Code a fini (0 : l'onglet se ferme ; autre : le terminal reste arrêté) ;
 * `surFin({ disparue: true })` : la session n'existe plus (Yaide a redémarré).
 */
export function vueClaude({ id, nom, surFin }) {
  const corps = document.createElement("div");
  corps.className = "claude";
  const s = { ws: null, ouvert: false };
  s.flux = fluxVers(s);
  const term = terminal({
    flux: s.flux,
    nom,
    connecte: false,
    surTaille: (c, l) => s.ws?.readyState === 1 && s.ws.send(`taille ${c} ${l}`),
  });
  corps.append(term);
  let fini = false;
  let detruit = false;
  let rebranchement = false;

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const envoyerTaille = () => s.ws?.readyState === 1 && s.ws.send(`taille ${term.term.cols} ${term.term.rows}`);

  function terminee(raison) {
    fini = true;
    const code = Number(/^code=(\d+)$/.exec(raison)?.[1] ?? 1);
    if (code === 0) return surFin({ code: 0 });
    const alerte = message({ texte: TEXTE_ARRET, variante: "erreur" });
    corps.prepend(alerte);
    term.definirArrete();
    surFin({ code });
  }

  // Après une coupure : on attend que le serveur réponde, puis on se rebranche.
  async function reprendre() {
    while (!detruit && !fini) {
      await pause(PAUSE_REPRISE);
      if (detruit || !(await listeShells())) continue;
      rebranchement = true;
      return brancher();
    }
  }

  function brancher() {
    let ouvertCetteFois = false;
    s.ws = brancherFlux(id, s.flux, {
      surOuverture: () => {
        ouvertCetteFois = s.ouvert = true;
        rebranchement = false;
        // Le serveur renvoie l'affichage récent : on repart d'un terminal vide.
        term.term.reset();
        envoyerTaille();
        term.definirConnecte(true);
      },
      surFermeture: (e) => {
        s.ouvert = false;
        term.definirConnecte(false);
        if (detruit || fini) return;
        if (e.code === 1000) return terminee(e.reason);
        // Le serveur répond mais refuse la connexion : la session n'existe plus.
        if (rebranchement && !ouvertCetteFois) {
          fini = true;
          return surFin({ disparue: true });
        }
        reprendre();
      },
    });
  }

  const vue = {
    corps,
    focus: () => term.focus(),
    ajuster: () => term.ajuster(),
    detruire() {
      detruit = true;
      if (s.ws) s.ws.onclose = null;
      s.ws?.close();
      term.detruire();
    },
  };
  brancher();
  return vue;
}
