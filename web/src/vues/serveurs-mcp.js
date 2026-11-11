import { enregistrerServeurMcp, lireServeursMcp, supprimerServeurMcp } from "../api.js";
import { bouton } from "../ui/bouton.js";
import { champ } from "../ui/champ.js";
import { dialogue, fiche } from "../ui/dialogue.js";
import { indication } from "../ui/indication.js";
import { liste } from "../ui/liste.js";
import { message } from "../ui/message.js";

const TEXTE_COUPURE = "Connexion perdue. Réessayez au retour.";
const TEXTE_ILLISIBLE = ".yaide/mcp.json est illisible. Corrigez-le dans l'éditeur, puis rouvrez Serveurs MCP.";
const AIDE = "Dans .yaide/mcp.json, pour les agents de Yaide. Claude Code et opencode ont leur propre configuration.";
const sansPoint = (t) => String(t ?? "erreur").replace(/\.$/, "");
const lignes = (texte) => texte.split(/\r?\n/).filter((l) => l.trim() !== "");

/**
 * REQ-096, V-012. Dialogue « Serveurs MCP » : `ouvrir()` relit `.yaide/mcp.json` et montre la liste ; ajouter,
 * modifier ou supprimer un serveur écrit aussitôt le fichier. `surEtat(ouvert)` suit l'ouverture du dialogue.
 * Rien n'est validé ici : les refus viennent du serveur.
 */
export function vueServeursMcp({ surEtat = () => {} } = {}) {
  let dlg = null;
  let generation = 0;
  let serveurs = [];
  let enregistrement = false;

  function fermer(rendreFocus = true) {
    if (!dlg) return;
    generation++;
    dlg.fermer({ rendreFocus });
    dlg = null;
    surEtat(false);
  }

  const poserActions = (...b) => dlg.element.querySelector(".dialogue-actions").replaceChildren(...b);
  const boutonDe = (nomAccessible) => [...dlg.element.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nomAccessible);
  const messageEchec = (r, perdu) =>
    r.coupure
      ? message({ texte: TEXTE_COUPURE, variante: "erreur" })
      : r.cause === "illisible"
        ? message({ texte: TEXTE_ILLISIBLE, variante: "erreur", detail: r.detail })
        : message({ texte: `${perdu} : ${sansPoint(r.message)}.`, variante: "erreur" });

  // Lecture impossible ou fichier illisible : ni liste ni ajout, seul « Fermer » avec le focus.
  function afficherEchecLecture(r) {
    const f = bouton({ libelle: "Fermer" });
    f.addEventListener("click", () => fermer());
    dlg.remplacer([messageEchec(r, "Impossible de lire .yaide/mcp.json")]);
    dlg.definirResultat();
    poserActions(f);
    f.focus();
  }

  // `focus` : serveur dont « Modifier » prend le focus ; absent ou inconnu → le premier, sinon « Ajouter un serveur ».
  function afficherListe({ resultat, focus, focusSuppression, focusAjout = false } = {}) {
    const f = bouton({ libelle: "Fermer" });
    const ajouter = bouton({ libelle: "Ajouter un serveur", variante: "principal" });
    f.addEventListener("click", () => fermer());
    ajouter.addEventListener("click", () => afficherFiche({ valeurs: { nom: "", command: "", args: "", env: "" } }));
    const contenu =
      serveurs.length === 0
        ? indication({ texte: "Aucun serveur MCP." })
        : liste({
            variante: "objets",
            nom: "Serveurs MCP",
            lignes: serveurs.map((s) => ({
              id: s.nom,
              libelle: s.nom,
              dossier: s.command ? [s.command, ...(s.args ?? [])].join(" ") : (s.url ?? ""),
              policeCode: true,
              actions: [
                { icone: "sliders-horizontal", nomAccessible: `Modifier ${s.nom}`, infoBulle: "Modifier", surClic: ouvrirFiche },
                { icone: "trash", nomAccessible: `Supprimer ${s.nom}`, infoBulle: "Supprimer", surClic: demanderSuppression },
              ],
            })),
          });
    dlg.remplacer([contenu]);
    dlg.definirResultat(resultat);
    poserActions(f, ajouter);
    const cible =
      (focusAjout && ajouter) ||
      (focusSuppression !== undefined && boutonDe(`Supprimer ${focusSuppression}`)) ||
      (focus !== undefined && boutonDe(`Modifier ${focus}`)) ||
      (serveurs[0] && boutonDe(`Modifier ${serveurs[0].nom}`)) ||
      ajouter;
    cible.focus();
  }

  function ouvrirFiche(nom) {
    const s = serveurs.find((x) => x.nom === nom);
    if (!s) return;
    afficherFiche({
      ancien: s.nom,
      url: !s.command && s.url ? s.url : undefined,
      valeurs: { nom: s.nom, command: s.command ?? "", args: (s.args ?? []).join("\n"), env: (s.env ?? []).map(([n, v]) => `${n}=${v}`).join("\n") },
    });
  }

  // `erreurs` : refus du serveur par champ (`nom`, `command`, `env`), le focus va dans le premier champ refusé.
  function afficherFiche({ ancien, url, valeurs, erreurs = {} }) {
    const cNom = champ({ libelle: "Nom", valeur: valeurs.nom, erreur: erreurs.nom });
    const cCommande = champ({ libelle: "Commande", valeur: valeurs.command, erreur: erreurs.command });
    const cArgs = champ({ libelle: "Arguments", type: "multiligne", sansRetour: true, valeur: valeurs.args, aide: "Un argument par ligne." });
    const cEnv = champ({ libelle: "Variables", type: "multiligne", sansRetour: true, valeur: valeurs.env, aide: "Une par ligne : NOM=valeur. Elles sont écrites en clair dans .yaide/mcp.json.", erreur: erreurs.env });
    const saisies = { nom: cNom.querySelector("input"), command: cCommande.querySelector("input"), args: cArgs.querySelector("textarea"), env: cEnv.querySelector("textarea") };
    const info = url
      ? message({ texte: `Yaide ne prend pas en charge l'adresse ${url}. Utilisez la commande npx, avec les arguments mcp-remote et cette adresse.`, variante: "info" })
      : undefined;
    const contenu = fiche({ titre: ancien ?? "Nouveau serveur", message: info, champs: [cNom, cCommande, cArgs, cEnv] });
    const annuler = bouton({ libelle: "Annuler" });
    const enregistrer = bouton({ libelle: "Enregistrer", variante: "principal" });

    async function valider() {
      if (enregistrement || !dlg) return;
      enregistrement = true;
      const mienne = generation;
      const saisie = { nom: saisies.nom.value, command: saisies.command.value, args: saisies.args.value, env: saisies.env.value };
      const avecFocus = document.activeElement === enregistrer;
      const enCours = bouton({ libelle: "Enregistrer", libelleEnCours: "Enregistrement…", variante: "principal" });
      enregistrer.replaceWith(enCours);
      annuler.disabled = true;
      dlg.definirResultat();
      const r = await enregistrerServeurMcp({
        ...(ancien !== undefined ? { ancien } : {}),
        nom: saisie.nom,
        command: saisie.command,
        args: lignes(saisie.args),
        env: lignes(saisie.env),
      });
      enregistrement = false;
      if (!dlg || mienne !== generation) return;
      if (Array.isArray(r.serveurs)) {
        serveurs = r.serveurs;
        const nom = saisie.nom.trim();
        return afficherListe({ resultat: message({ texte: `Serveur ${nom} enregistré. Il servira au prochain message à un agent.`, variante: "succes" }), focus: nom });
      }
      if (r.erreurs) return afficherFiche({ ancien, url, valeurs: saisie, erreurs: r.erreurs });
      enCours.replaceWith(enregistrer);
      annuler.disabled = false;
      dlg.definirResultat(messageEchec(r, "Enregistrement impossible"));
      if (avecFocus) enregistrer.focus();
    }

    annuler.addEventListener("click", () => afficherListe({ focus: ancien, focusAjout: ancien === undefined }));
    enregistrer.addEventListener("click", valider);
    // Entrée dans « Nom » ou « Commande » enregistre ; dans une zone de plusieurs lignes, elle ajoute une ligne.
    contenu.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target.matches("input")) {
        ev.preventDefault();
        valider();
      }
    });
    dlg.remplacer([contenu]);
    dlg.definirResultat();
    poserActions(annuler, enregistrer);
    (["nom", "command", "env"].map((k) => erreurs[k] && saisies[k]).find(Boolean) ?? saisies.nom).focus();
  }

  function demanderSuppression(nom) {
    if (!dlg) return;
    dlg.definirResultat();
    const phrase = document.createElement("p");
    phrase.textContent = "Sa configuration sera perdue.";
    const annuler = bouton({ libelle: "Annuler" });
    const ok = bouton({ libelle: "Supprimer", variante: "danger" });
    const mienne = generation;
    const conf = dialogue({
      titre: `Supprimer le serveur ${nom} ?`,
      contenu: [phrase],
      actions: [annuler, ok],
      focusInitial: annuler,
      surAnnuler: () => abandonner(),
    });
    const abandonner = () => {
      conf.fermer({ rendreFocus: false });
      boutonDe(`Supprimer ${nom}`)?.focus();
    };
    annuler.addEventListener("click", abandonner);
    ok.addEventListener("click", async () => {
      conf.enCours(true);
      const r = await supprimerServeurMcp(nom);
      conf.fermer({ rendreFocus: false });
      if (!dlg || mienne !== generation) return;
      if (Array.isArray(r.serveurs)) {
        const rang = serveurs.findIndex((s) => s.nom === nom);
        const voisin = serveurs[rang + 1] ?? serveurs[rang - 1];
        serveurs = r.serveurs;
        return afficherListe({ resultat: message({ texte: `Serveur ${nom} supprimé.`, variante: "succes" }), focus: voisin?.nom });
      }
      afficherListe({ resultat: messageEchec(r, "Suppression impossible"), focusSuppression: nom });
    });
    conf.ouvrir();
  }

  async function ouvrir() {
    if (dlg) return;
    const mienne = ++generation;
    const aide = document.createElement("p");
    aide.className = "ya-groupe-aide ya-aide-liste";
    aide.textContent = AIDE;
    const f = bouton({ libelle: "Fermer" });
    f.addEventListener("click", () => fermer());
    dlg = dialogue({
      titre: "Serveurs MCP",
      aide,
      position: "reglages",
      contenu: [indication({ texte: "Chargement…", variante: "chargement" })],
      actions: [f, bouton({ libelle: "Ajouter un serveur", variante: "principal", desactive: true })],
      focusInitial: f,
      surAnnuler: () => fermer(),
    });
    dlg.ouvrir();
    surEtat(true);
    // Pendant le chargement, le focus est sur le dialogue.
    dlg.element.tabIndex = -1;
    dlg.element.focus();
    const r = await lireServeursMcp();
    if (!dlg || mienne !== generation) return;
    if (Array.isArray(r.serveurs)) {
      serveurs = r.serveurs;
      return afficherListe();
    }
    afficherEchecLecture(r);
  }

  return { ouvrir };
}
