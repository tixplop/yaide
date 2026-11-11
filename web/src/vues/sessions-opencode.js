import { sessionsOpencode } from "../api.js";
import { dialogue } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";
import { quand } from "./agent.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";

/**
 * REQ-088. Dialogue « Sessions opencode » : `ouvrir()` relit les sessions racines du projet qui ont eu un tour,
 * la plus récente d'abord. Choisir une ligne ferme le dialogue et appelle `surChoix({ id, titre })` ; Échap ou un clic
 * dehors le ferme et rend le focus au bouton. `surEtat(ouvert)` suit l'ouverture du dialogue.
 */
export function vueSessionsOpencode({ chemin, surChoix, surEtat = () => {} }) {
  let dlg = null;
  let generation = 0;
  let detruite = false;

  function fermer(rendreFocus = true) {
    if (!dlg) return;
    generation++;
    dlg.fermer({ rendreFocus });
    dlg = null;
    surEtat(false);
  }

  async function ouvrir() {
    if (detruite || dlg) return;
    const mienne = ++generation;
    dlg = dialogue({ titre: "Sessions opencode", position: "palette", sansChamp: true, contenu: [indication({ texte: "Chargement…", variante: "chargement" })], surAnnuler: () => fermer() });
    dlg.ouvrir();
    surEtat(true);
    const r = await sessionsOpencode(chemin);
    if (detruite || mienne !== generation) return;
    if (r.coupure) return dlg.remplacer([message({ texte: TEXTE_COUPURE, variante: "erreur" })]);
    if (r.erreur !== undefined || !Array.isArray(r.donnees?.data)) {
      return dlg.remplacer([message({ texte: `Impossible de lister les sessions opencode : ${String(r.erreur ?? "réponse illisible").replace(/\.$/, "")}.`, variante: "erreur" })]);
    }
    const sessions = r.donnees.data
      .filter((s) => s.time?.busy !== undefined && s.time.busy !== null)
      .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0));
    if (sessions.length === 0) return dlg.remplacer([indication({ texte: "Aucune session opencode dans ce projet." })]);
    const titres = new Map(sessions.map((s) => [s.id, s.title || "Sans titre"]));
    const maintenant = new Date();
    const l = liste({
      nom: "Sessions opencode",
      focusSurListe: true,
      lignes: sessions.map((s) => ({ id: s.id, libelle: titres.get(s.id), fin: quand(s.time.updated ?? s.time.busy, maintenant, true) })),
      surActiver: (id) => {
        const titre = titres.get(id);
        fermer(false);
        surChoix({ id, titre });
      },
    });
    dlg.remplacer([l], l);
  }

  return {
    ouvrir,
    detruire() {
      detruite = true;
      if (dlg) fermer(false);
    },
  };
}
