import { lireServeurMcp } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue, ligneAdresse } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const TEXTE_AIDE =
  "Claude Code, opencode et les autres harnais agissent sur ce projet par ce serveur, avec les outils des agents. Sans mot de passe : tout programme de cet ordinateur peut s'en servir.";
const TEXTE_REFUS = "Copie impossible : le navigateur a refusé l'accès au presse-papiers. Sélectionnez le texte, puis Ctrl+C.";
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");

/**
 * REQ-189, V-015. Panneau « Serveur MCP de Yaide » : `ouvrir()` lit l'adresse du serveur MCP de l'instance
 * et montre les deux textes à copier. `surFermeture()` est appelé après la fermeture (Fermer, Échap).
 */
export function vueServeurMcpYaide({ surFermeture = () => {} } = {}) {
  let dlg = null;
  let generation = 0;
  let image = 0;

  function fermer() {
    if (!dlg) return;
    generation++;
    dlg.fermer({ rendreFocus: false });
    dlg = null;
    surFermeture();
  }

  // Le même message est vidé, puis reposé à l'image suivante, pour être relu.
  function dire(texte, variante) {
    const mienne = ++image;
    dlg.definirResultat();
    requestAnimationFrame(() => {
      if (!dlg || mienne !== image) return;
      dlg.definirResultat(message({ texte, variante }));
    });
  }

  async function copier(valeur, confirmation) {
    try {
      await navigator.clipboard.writeText(valeur);
    } catch {
      return dire(TEXTE_REFUS, "erreur");
    }
    dire(confirmation, "succes");
  }

  // Indisponible ou lecture impossible : le message seul décrit le dialogue, « Fermer » a le focus.
  function afficherEchec(texte, fermerBouton) {
    const m = message({ texte, variante: "erreur" });
    m.id = "serveur-mcp-echec";
    dlg.element.setAttribute("aria-describedby", m.id);
    dlg.remplacer([m]);
    fermerBouton.focus();
  }

  function afficherAdresse(adresse) {
    const commande = `claude mcp add --transport http yaide ${adresse}`;
    const opencode = JSON.stringify({ mcp: { servers: { yaide: { type: "remote", url: adresse, oauth: false } } } }, null, 2);
    const cCommande = champ({
      libelle: "Commande pour Claude Code",
      type: "copie",
      valeur: commande,
      aide: "À lancer dans un terminal, dans le dossier du projet.",
      nomCopier: "Copier la commande pour Claude Code",
      surCopie: (v) => copier(v, "Commande pour Claude Code copiée."),
    });
    const cOpencode = champ({
      libelle: "Configuration pour opencode",
      type: "copie",
      valeur: opencode,
      aide: "À ajouter au fichier opencode.json du projet.",
      nomCopier: "Copier la configuration pour opencode",
      surCopie: (v) => copier(v, "Configuration pour opencode copiée."),
    });
    const aide = document.createElement("p");
    aide.className = "ya-groupe-aide";
    aide.textContent = TEXTE_AIDE;
    dlg.definirAide(aide);
    dlg.remplacer([ligneAdresse({ libelle: "Adresse", valeur: adresse }), cCommande, cOpencode]);
    cCommande.querySelector("button").focus();
  }

  async function ouvrir() {
    if (dlg) return;
    const mienne = ++generation;
    const f = bouton({ libelle: "Fermer" });
    f.addEventListener("click", fermer);
    dlg = dialogue({
      titre: "Serveur MCP de Yaide",
      position: "reglages",
      contenu: [indication({ texte: "Chargement…", variante: "chargement" })],
      actions: [f],
      focusInitial: f,
      surAnnuler: fermer,
    });
    dlg.ouvrir();
    // Pendant le chargement, le focus est sur le dialogue.
    dlg.element.tabIndex = -1;
    dlg.element.focus();
    const r = await lireServeurMcp();
    if (!dlg || mienne !== generation) return;
    if (typeof r.adresse === "string") return afficherAdresse(r.adresse);
    if (r.indisponible) {
      return afficherEchec(`Serveur MCP indisponible : les ports ${r.indisponible.de} à ${r.indisponible.a} sont occupés. Libérez l'un d'eux, puis relancez Yaide.`, f);
    }
    afficherEchec(r.coupure ? TEXTE_COUPURE : `Impossible de lire l'adresse du serveur MCP : ${sansPoint(r.message)}. Rouvrez ce panneau pour réessayer.`, f);
  }

  return { ouvrir };
}
