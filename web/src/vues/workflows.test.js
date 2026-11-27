import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { vueWorkflows } from "./workflows.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps });
const A = { nom: "A", fichier: "a", publie: false };
const B = { nom: "b", fichier: "b", publie: true };
const cours = () => ({ nom: "Revue des notes", fichier: "revue-des-notes", publie: true, enCours: "n2" });

// Faux serveur : `liste` répond à la lecture, `reponses` aux écritures dans l'ordre (ou une fonction par appel).
function monter({ liste = rep({ workflows: [], erreurs: [] }), reponses = [], modifie = () => false } = {}) {
  const appels = [];
  const file = [...reponses];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const appel = { url: String(url), methode: options.method ?? "GET", corps: options.body ? JSON.parse(options.body) : undefined };
    appels.push(appel);
    if (appel.methode === "GET") return liste;
    const r = file.shift();
    if (r === "coupure") throw new TypeError("réseau");
    return typeof r === "function" ? r(appel) : r;
  }));
  const ouvreur = document.createElement("button");
  document.body.append(ouvreur);
  ouvreur.focus();
  const etats = [];
  const ouverts = [];
  const publies = [];
  const v = vueWorkflows({ surEtat: (o) => etats.push(o), ouvrirWorkflow: (f) => ouverts.push(f), workflowModifie: modifie, etatWorkflow: (f, p) => publies.push([f, p]) });
  return { v, appels, ouvreur, etats, ouverts, publies };
}
const dlg = () => [...document.querySelectorAll("dialog")].at(-1);
const bouts = (racine = document) => [...racine.querySelectorAll("button")];
const nomDe = (b) => b.getAttribute("aria-label") ?? b.textContent;
const parNom = (nom) => bouts().find((b) => nomDe(b) === nom);
const champNom = () => [...document.querySelectorAll("label")].find((l) => l.textContent === "Nom").control;
const echap = () => dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
const ecritures = (appels) => appels.filter((a) => a.methode !== "GET");
const attendre = () => new Promise((r) => setTimeout(r, 0));
const lignes = () => [...dlg().querySelectorAll("li.ya-objet")].map((li) => [li.querySelector(".ya-objet-nom").textContent, li.querySelector(".ya-objet-etat").textContent]);

test("REQ190_AC2_AC8_sans_workflow_le_dialogue_dit_Aucun_workflow_et_ne_cree_rien", async () => {
  const m = monter();
  await m.v.ouvrir();
  const d = dlg();
  expect(document.getElementById(d.getAttribute("aria-labelledby")).textContent).toBe("Workflows");
  expect(document.getElementById(d.getAttribute("aria-describedby")).textContent).toBe("Dans .yaide/workflows/ du projet. Un workflow publié est actif : dépubliez-le pour le modifier.");
  expect(d.textContent).toContain("Aucun workflow.");
  expect(d.querySelector("ul")).toBeNull();
  expect(bouts(d).map(nomDe)).toEqual(["Fermer", "Nouveau workflow"]);
  expect(document.activeElement).toBe(parNom("Nouveau workflow"));
  expect(m.appels).toEqual([{ url: "/api/workflows", methode: "GET", corps: undefined }]);
  expect(m.etats).toEqual([true]);
});

test("REQ190_AC7_Fermer_et_Echap_ferment_et_rendent_le_focus_au_bouton", async () => {
  const m = monter();
  await m.v.ouvrir();
  parNom("Fermer").click();
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(m.ouvreur);
  m.ouvreur.focus();
  await m.v.ouvrir();
  echap();
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(m.ouvreur);
  expect(m.etats).toEqual([true, false, true, false]);
});

test("REQ190_AC5_AC8_liste_par_ordre_alphabetique_sans_casse_boutons_noms_et_focus", async () => {
  const m = monter({ liste: rep({ workflows: [B, A], erreurs: [] }) });
  await m.v.ouvrir();
  const d = dlg();
  expect(d.querySelector("ul").getAttribute("aria-label")).toBe("Workflows");
  expect(lignes()).toEqual([["A", "Brouillon"], ["b", "Publié"]]);
  expect(bouts(d).map(nomDe)).toEqual(["Modifier A", "Publier A", "Suivre b", "Dépublier b", "Fermer", "Nouveau workflow"]);
  expect(bouts(d).slice(0, 4).map((b) => b.textContent)).toEqual(["Modifier", "Publier", "Suivre", "Dépublier"]);
  expect(parNom("Modifier b")).toBeUndefined();
  expect(document.activeElement).toBe(parNom("Modifier A"));
  parNom("Modifier A").click();
  expect(document.querySelector("dialog")).toBeNull();
  expect(m.ouverts).toEqual(["a"]);
  expect(ecritures(m.appels)).toEqual([]);
});

test("REQ190_AC6_fichier_illisible_en_alerte_et_les_autres_workflows_listes", async () => {
  const m = monter({ liste: rep({ workflows: [A], erreurs: [".yaide/workflows/x.json est illisible. Corrigez-le, puis rouvrez Workflows."] }) });
  await m.v.ouvrir();
  const alerte = dlg().querySelector("[role=alert]");
  expect(alerte.textContent).toBe(".yaide/workflows/x.json est illisible. Corrigez-le, puis rouvrez Workflows.");
  expect(lignes()).toEqual([["A", "Brouillon"]]);
});

test("REQ190_AC9_Nouveau_workflow_fiche_focus_dans_Nom_et_Annuler_rend_la_liste", async () => {
  const m = monter({ liste: rep({ workflows: [A], erreurs: [] }) });
  await m.v.ouvrir();
  parNom("Nouveau workflow").click();
  const d = dlg();
  expect(d.querySelector("h2.ya-fiche-titre").textContent).toBe("Nouveau workflow");
  expect(d.querySelector("ul")).toBeNull();
  expect(document.activeElement).toBe(champNom());
  expect(champNom().getAttribute("aria-describedby")).toBeTruthy();
  expect(document.getElementById(champNom().getAttribute("aria-describedby")).textContent).toBe("Il donne le nom du fichier dans .yaide/workflows/, et ne change plus.");
  expect(document.getElementById(d.getAttribute("aria-describedby")).textContent).toContain("Dans .yaide/workflows/ du projet.");
  expect(bouts(d).map(nomDe)).toEqual(["Annuler", "Créer"]);
  parNom("Annuler").click();
  expect(dlg().querySelector("ul")).not.toBeNull();
  expect(document.activeElement).toBe(parNom("Nouveau workflow"));
});

test("REQ190_AC3_AC9_Creer_ecrit_par_la_route_ferme_et_ouvre_l_onglet", async () => {
  const m = monter({ reponses: [rep({ nom: "Revue des notes", fichier: "revue-des-notes", publie: false, noeuds: [], liens: [] })] });
  await m.v.ouvrir();
  parNom("Nouveau workflow").click();
  champNom().value = "Revue des notes";
  parNom("Créer").click();
  await vi.waitFor(() => expect(document.querySelector("dialog")).toBeNull());
  expect(ecritures(m.appels)).toEqual([{ url: "/api/workflows", methode: "POST", corps: { nom: "Revue des notes" } }]);
  expect(m.ouverts).toEqual(["revue-des-notes"]);
  expect(m.etats.at(-1)).toBe(false);
});

test("REQ190_AC4_AC9_nom_refuse_message_sous_le_champ_focus_dans_le_champ_rien_ouvert", async () => {
  const m = monter({ reponses: [rep({ message: "Donnez un nom au workflow." }, 400), rep({ message: "Ce nom est déjà pris. Choisissez-en un autre." }, 400)] });
  await m.v.ouvrir();
  parNom("Nouveau workflow").click();
  parNom("Créer").click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]")).not.toBeNull());
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Donnez un nom au workflow.");
  expect(champNom().getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(champNom());
  champNom().value = "A";
  champNom().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]").textContent).toBe("Ce nom est déjà pris. Choisissez-en un autre."));
  expect(champNom().value).toBe("A");
  expect(document.activeElement).toBe(champNom());
  expect(m.ouverts).toEqual([]);
});

test("REQ190_connexion_perdue_pendant_la_creation_message_et_rien_ne_change", async () => {
  const m = monter({ reponses: ["coupure"] });
  await m.v.ouvrir();
  parNom("Nouveau workflow").click();
  champNom().value = "x";
  parNom("Créer").click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]")).not.toBeNull());
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(m.ouverts).toEqual([]);
  expect(parNom("Créer").disabled).toBe(false);
});

test("REQ192_AC1_AC5_AC7_publier_puis_depublier_etat_messages_boutons_focus_et_onglet", async () => {
  const m = monter({
    liste: rep({ workflows: [{ ...A, nom: "Revue des notes", fichier: "revue-des-notes" }], erreurs: [] }),
    reponses: [rep({ nom: "Revue des notes", fichier: "revue-des-notes", publie: true }), rep({ nom: "Revue des notes", fichier: "revue-des-notes", publie: false })],
  });
  await m.v.ouvrir();
  const bascule = parNom("Publier Revue des notes");
  bascule.focus();
  bascule.click();
  expect(bascule.textContent).toBe("Publication…");
  expect(parNom("Modifier Revue des notes").disabled).toBe(true);
  expect(parNom("Nouveau workflow").disabled).toBe(true);
  await vi.waitFor(() => expect(dlg().querySelector("[role=status]")).not.toBeNull());
  expect(ecritures(m.appels)).toEqual([{ url: "/api/workflows/revue-des-notes/publier", methode: "POST", corps: undefined }]);
  expect(dlg().querySelector("[role=status]").textContent).toBe("Revue des notes est publié. Son déclencheur écoute.");
  expect(lignes()).toEqual([["Revue des notes", "Publié"]]);
  expect(parNom("Modifier Revue des notes")).toBeUndefined();
  expect(parNom("Dépublier Revue des notes")).toBe(bascule);
  expect(bascule.textContent).toBe("Dépublier");
  expect(document.activeElement).toBe(bascule);
  expect(m.publies).toEqual([["revue-des-notes", true]]);
  expect(parNom("Nouveau workflow").disabled).toBe(false);

  bascule.click();
  expect(bascule.textContent).toBe("Dépublication…");
  await vi.waitFor(() => expect(dlg().querySelector("[role=status]").textContent).toBe("Revue des notes est un brouillon. Rien ne le lance plus."));
  expect(ecritures(m.appels).at(-1).url).toBe("/api/workflows/revue-des-notes/depublier");
  expect(lignes()).toEqual([["Revue des notes", "Brouillon"]]);
  expect(parNom("Modifier Revue des notes")).toBeDefined();
  expect(parNom("Publier Revue des notes")).toBe(bascule);
  expect(document.activeElement).toBe(bascule);
  expect(m.publies).toEqual([["revue-des-notes", true], ["revue-des-notes", false]]);
});

test("REQ192_AC2_AC7_refus_liste_les_problemes_la_ligne_reste_Brouillon_le_focus_sur_Publier", async () => {
  const problemes = ["Ajoutez un déclencheur.", "« Commande shell 1 » : donnez la commande."];
  const m = monter({ liste: rep({ workflows: [{ ...A, nom: "Revue des notes", fichier: "revue-des-notes" }], erreurs: [] }), reponses: [rep({ messages: problemes }, 422)] });
  await m.v.ouvrir();
  const publier = parNom("Publier Revue des notes");
  publier.focus();
  publier.click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]")).not.toBeNull());
  const alerte = dlg().querySelector("[role=alert]");
  expect(alerte.textContent).toContain("Revue des notes n'est pas publié :");
  expect([...alerte.querySelectorAll("ul > li")].map((l) => l.textContent)).toEqual(problemes);
  expect(lignes()).toEqual([["Revue des notes", "Brouillon"]]);
  expect(publier.textContent).toBe("Publier");
  expect(document.activeElement).toBe(publier);
  expect(m.publies).toEqual([]);
  expect(parNom("Nouveau workflow").disabled).toBe(false);
});

test("REQ192_AC4_onglet_modifie_et_non_enregistre_refus_sans_rien_publier", async () => {
  const m = monter({ liste: rep({ workflows: [A], erreurs: [] }), modifie: (f) => f === "a" });
  await m.v.ouvrir();
  const publier = parNom("Publier A");
  publier.focus();
  publier.click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]")).not.toBeNull());
  const alerte = dlg().querySelector("[role=alert]");
  expect(alerte.textContent).toContain("A n'est pas publié :");
  expect([...alerte.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["Enregistrez d'abord le workflow."]);
  expect(ecritures(m.appels)).toEqual([]);
  expect(lignes()).toEqual([["A", "Brouillon"]]);
  expect(document.activeElement).toBe(publier);
});

test("REQ192_connexion_perdue_pendant_la_publication_rien_ne_change", async () => {
  const m = monter({ liste: rep({ workflows: [A], erreurs: [] }), reponses: ["coupure"] });
  await m.v.ouvrir();
  const publier = parNom("Publier A");
  publier.focus();
  publier.click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]")).not.toBeNull());
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(lignes()).toEqual([["A", "Brouillon"]]);
  expect(m.publies).toEqual([]);
  await attendre();
  expect(document.activeElement).toBe(publier);
});

const arretOk = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
const arretRefus = () => ({ ok: false, status: 409, json: async () => ({}), text: async () => "Revue des notes n'a pas d'exécution en cours." });

test("REQ197_AC4_AC7_REQ198_AC5_publie_en_cours_trois_boutons_et_Suivre_ferme_et_ouvre_l_onglet", async () => {
  const m = monter({ liste: rep({ workflows: [cours(), { ...A, enCours: null }], erreurs: [] }) });
  await m.v.ouvrir();
  expect(lignes()).toEqual([["A", "Brouillon"], ["Revue des notes", "Publié, en cours"]]);
  const ligne = [...dlg().querySelectorAll("li.ya-objet")][1];
  expect(bouts(ligne).map(nomDe)).toEqual(["Suivre Revue des notes", "Arrêter Revue des notes", "Dépublier Revue des notes"]);
  expect(bouts(ligne).map((b) => b.textContent)).toEqual(["Suivre", "Arrêter", "Dépublier"]);
  parNom("Suivre Revue des notes").click();
  expect(document.querySelector("dialog")).toBeNull();
  expect(m.ouverts).toEqual(["revue-des-notes"]);
});

test("REQ192_AC7_publier_change_Modifier_en_Suivre_et_depublier_Suivre_en_Modifier", async () => {
  const m = monter({
    liste: rep({ workflows: [{ ...A, nom: "Revue des notes", fichier: "revue-des-notes" }], erreurs: [] }),
    reponses: [rep({ publie: true }), rep({ publie: false })],
  });
  await m.v.ouvrir();
  const bascule = parNom("Publier Revue des notes");
  bascule.click();
  await vi.waitFor(() => expect(parNom("Suivre Revue des notes")).toBeDefined());
  expect(parNom("Modifier Revue des notes")).toBeUndefined();
  bascule.click();
  await vi.waitFor(() => expect(parNom("Modifier Revue des notes")).toBeDefined());
  expect(parNom("Suivre Revue des notes")).toBeUndefined();
});

test("REQ198_AC5_AC6_Arreter_un_publie_Arret_boutons_desactives_message_et_focus_sur_Suivre", async () => {
  let finir;
  const m = monter({ liste: rep({ workflows: [cours()], erreurs: [] }), reponses: [() => new Promise((r) => (finir = () => r(arretOk())))] });
  await m.v.ouvrir();
  const arreter = parNom("Arrêter Revue des notes");
  arreter.focus();
  arreter.click();
  expect(arreter.textContent).toBe("Arrêt…");
  expect(parNom("Suivre Revue des notes").disabled).toBe(true);
  expect(parNom("Dépublier Revue des notes").disabled).toBe(true);
  expect(parNom("Fermer").disabled).toBe(true);
  expect(parNom("Nouveau workflow").disabled).toBe(true);
  finir();
  await vi.waitFor(() => expect(dlg().querySelector("[role=status]")).not.toBeNull());
  expect(ecritures(m.appels)).toEqual([{ url: "/api/workflows/revue-des-notes/arreter", methode: "POST", corps: undefined }]);
  expect(dlg().querySelector("[role=status]").textContent).toBe("Revue des notes est arrêté. Son déclencheur écoute toujours.");
  expect(lignes()).toEqual([["Revue des notes", "Publié"]]);
  expect(parNom("Arrêter Revue des notes")).toBeUndefined();
  expect(document.activeElement).toBe(parNom("Suivre Revue des notes"));
  expect(parNom("Fermer").disabled).toBe(false);
  expect(parNom("Nouveau workflow").disabled).toBe(false);
});

test("REQ198_AC5_Arreter_un_brouillon_en_cours_message_court_et_focus_sur_Modifier", async () => {
  const m = monter({ liste: rep({ workflows: [{ ...cours(), publie: false }], erreurs: [] }), reponses: [arretOk()] });
  await m.v.ouvrir();
  expect(lignes()).toEqual([["Revue des notes", "Brouillon, en cours"]]);
  expect(bouts(dlg()).slice(0, 3).map((b) => b.textContent)).toEqual(["Modifier", "Arrêter", "Publier"]);
  parNom("Arrêter Revue des notes").click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=status]")).not.toBeNull());
  expect(dlg().querySelector("[role=status]").textContent).toBe("Revue des notes est arrêté.");
  expect(lignes()).toEqual([["Revue des notes", "Brouillon"]]);
  expect(document.activeElement).toBe(parNom("Modifier Revue des notes"));
});

test("REQ198_AC5_AC6_Arreter_apres_la_fin_de_l_execution_alerte_la_ligne_est_relue_et_le_focus_au_premier_bouton", async () => {
  const m = monter({ liste: rep({ workflows: [cours()], erreurs: [] }), reponses: [arretRefus()] });
  await m.v.ouvrir();
  parNom("Arrêter Revue des notes").click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]")).not.toBeNull());
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Revue des notes n'a pas d'exécution en cours.");
  expect(lignes()).toEqual([["Revue des notes", "Publié"]]);
  expect(parNom("Arrêter Revue des notes")).toBeUndefined();
  expect(document.activeElement).toBe(parNom("Suivre Revue des notes"));
  expect(parNom("Nouveau workflow").disabled).toBe(false);
});

test("REQ197_AC7_depublier_pendant_l_execution_l_etat_reste_Brouillon_en_cours", async () => {
  const m = monter({ liste: rep({ workflows: [cours()], erreurs: [] }), reponses: [rep({ publie: false })] });
  await m.v.ouvrir();
  parNom("Dépublier Revue des notes").click();
  await vi.waitFor(() => expect(lignes()).toEqual([["Revue des notes", "Brouillon, en cours"]]));
  expect(bouts(dlg()).slice(0, 3).map((b) => b.textContent)).toEqual(["Modifier", "Arrêter", "Publier"]);
});
