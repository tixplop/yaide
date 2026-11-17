import { listerAgents } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue } from "../ui/dialogue.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const PAR_DEFAUT = "";

/** Phrase du dialogue : les noms dans l'ordre de l'arbre. */
export function phraseSoumission(noms) {
  if (noms.length === 1) return `Soumettre ${noms[0]} à un agent.`;
  if (noms.length === 2) return `Soumettre ${noms[0]} et ${noms[1]} à un agent.`;
  const autres = noms.length - 2;
  return `Soumettre ${noms[0]}, ${noms[1]} et ${autres} ${autres > 1 ? "autres éléments" : "autre élément"} à un agent.`;
}

/** Premier message de la conversation : « Consulte `a.md`, `b.md` et `docs/`. » */
export function messageConsulte(chemins) {
  const cites = chemins.map((c) => `\`${c}\``);
  const liste = cites.length === 1 ? cites[0] : `${cites.slice(0, -1).join(", ")} et ${cites.at(-1)}`;
  return `Consulte ${liste}.`;
}

/**
 * Dialogue « Soumettre à un agent » (V-003, REQ-126).
 * `noms` : les chemins tels qu'ils s'affichent ; `chemins` : ceux qui partent du projet, un dossier finissant par `/`, dans le même ordre.
 * `surSoumettre({ equipe, message })` rend `{ coupure: true }`, ou `{ ouvrir() }` appelé une fois le dialogue fermé ; `surRetour()` rend le focus à la ligne visée.
 */
export async function ouvrirSoumissionAgent({ noms, chemins, surSoumettre, surRetour, actif = () => true }) {
  const lus = await listerAgents();
  if (!actif()) return;
  const agents = [...(lus.agents ?? [])].sort((a, b) => a.nom.localeCompare(b.nom, undefined, { sensitivity: "base" }));
  const liste = champ({ libelle: "Agent", type: "liste", options: [{ valeur: PAR_DEFAUT, texte: "Agent (profil par défaut)" }, ...agents.map((a) => ({ valeur: a.dossier, texte: a.nom }))] });
  const select = liste.querySelector("select");
  const aide = document.createElement("p");
  aide.textContent = phraseSoumission(noms);
  const annuler = bouton({ libelle: "Annuler" });
  const ok = bouton({ libelle: "Soumettre", variante: "principal" });
  let envoi = false;
  const abandonner = () => {
    if (envoi) return; // Échap pendant l'envoi : sans effet, comme « Annuler » désactivé
    dlg.fermer({ rendreFocus: false });
    surRetour();
  };
  const dlg = dialogue({ titre: "Soumettre à un agent", aide, contenu: [liste], actions: [annuler, ok], focusInitial: select, surAnnuler: abandonner });
  annuler.addEventListener("click", abandonner);
  select.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });

  async function soumettre() {
    const choisi = agents.find((a) => a.dossier === select.value);
    envoi = true;
    dlg.definirResultat(null);
    dlg.enCours(true);
    select.disabled = true;
    ok.textContent = "Envoi…";
    ok.definirOccupe(true);
    const r = await surSoumettre({ equipe: choisi ? [choisi] : undefined, message: messageConsulte(chemins) });
    envoi = false;
    ok.textContent = "Soumettre";
    ok.definirOccupe(false);
    dlg.enCours(false);
    select.disabled = false;
    if (r?.coupure) {
      dlg.definirResultat(message({ texte: TEXTE_COUPURE, variante: "erreur" }));
      return ok.focus();
    }
    dlg.fermer({ rendreFocus: false });
    r?.ouvrir?.();
  }
  ok.addEventListener("click", soumettre);
  dlg.ouvrir();
}
