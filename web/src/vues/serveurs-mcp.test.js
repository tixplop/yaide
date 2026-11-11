import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { vueServeursMcp } from "./serveurs-mcp.js";

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

const DOCS = { nom: "docs", command: "mcp-docs", url: null, args: ["--port", "0"], env: [["TOKEN", "abc"]] };
const ECHO = { nom: "echo", command: "node", url: null, args: [], env: [] };
const NOTION = { nom: "notion", command: null, url: "https://mcp.notion.com/mcp", args: [], env: [] };
const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps });

// Faux serveur : `reponses` donne la réponse (ou une fonction) de chaque requête, dans l'ordre ; sinon la liste.
function monter(initial, reponses = []) {
  const appels = [];
  const file = [...reponses];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const appel = { url: String(url), methode: options.method ?? "GET", corps: options.body ? JSON.parse(options.body) : undefined };
    appels.push(appel);
    const r = appels.length === 1 ? initial : file.shift();
    if (r === "coupure") throw new TypeError("réseau");
    return typeof r === "function" ? r(appel) : r;
  }));
  const ouvreur = document.createElement("button");
  document.body.append(ouvreur);
  ouvreur.focus();
  const etats = [];
  const v = vueServeursMcp({ surEtat: (o) => etats.push(o) });
  return { v, appels, ouvreur, etats };
}
const FICHIER = "/home/marie/.config/yaide/mcp.json";
const liste = (...s) => rep({ fichier: FICHIER, serveurs: s });
const dlg = () => [...document.querySelectorAll("dialog")].at(-1);
const bouts = (racine = document) => [...racine.querySelectorAll("button")];
const parNom = (nom) => bouts().find((b) => b.getAttribute("aria-label") === nom || b.textContent === nom);
const champDe = (libelle) => [...document.querySelectorAll("label")].find((l) => l.textContent === libelle).control;
const touche = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const echap = () => dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
const ecritures = (appels) => appels.filter((a) => a.methode !== "GET");
async function ouvrir(m) {
  await m.v.ouvrir();
}

test("REQ096_AC2_AC18_AC19_AC14_liste_dans_l_ordre_focus_et_dialogue", async () => {
  const m = monter(liste(DOCS, ECHO));
  await ouvrir(m);
  const d = dlg();
  expect(m.appels[0].url).toBe("/api/agent/mcp");
  expect(d.getAttribute("aria-labelledby")).toBeTruthy();
  expect(document.getElementById(d.getAttribute("aria-labelledby")).textContent).toBe("Serveurs MCP");
  expect(document.getElementById(d.getAttribute("aria-describedby")).textContent).toBe(
    "Dans /home/marie/.config/yaide/mcp.json, pour les agents de Yaide dans tous vos projets. Claude Code et opencode ont leur propre configuration.",
  );
  const ul = d.querySelector("ul");
  expect(ul.getAttribute("aria-label")).toBe("Serveurs MCP");
  const li = [...ul.querySelectorAll("li")];
  expect(li.map((l) => l.querySelector(".ya-objet-nom").textContent)).toEqual(["docs", "echo"]);
  const cmd = li[0].querySelector(".ya-objet-texte");
  expect(cmd.textContent).toBe("mcp-docs --port 0");
  expect(cmd.classList.contains("liste-code")).toBe(true);
  expect(bouts(d).map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Modifier docs", "Supprimer docs", "Modifier echo", "Supprimer echo", "Fermer", "Ajouter un serveur"]);
  expect(document.activeElement).toBe(parNom("Modifier docs"));
  expect(m.etats).toEqual([true]);
  expect(ecritures(m.appels)).toEqual([]);
});

test("REQ096_AC14_echap_et_fermer_ferment_sans_ecrire_et_rendent_le_focus", async () => {
  const m = monter(liste(DOCS), [liste(DOCS), liste(DOCS)]);
  await ouvrir(m);
  echap();
  expect(dlg()).toBeUndefined();
  expect(document.activeElement).toBe(m.ouvreur);
  await ouvrir(m);
  parNom("Modifier docs").click();
  echap();
  expect(dlg()).toBeUndefined();
  expect(document.activeElement).toBe(m.ouvreur);
  await ouvrir(m);
  parNom("Fermer").click();
  expect(document.activeElement).toBe(m.ouvreur);
  expect(m.etats).toEqual([true, false, true, false, true, false]);
  expect(ecritures(m.appels)).toEqual([]);
});

test("REQ096_AC3_vide_focus_sur_ajouter_et_aucune_ecriture", async () => {
  const m = monter(liste());
  await ouvrir(m);
  expect(dlg().textContent).toContain("Aucun serveur MCP.");
  expect(dlg().querySelector("ul")).toBeNull();
  expect(document.activeElement).toBe(parNom("Ajouter un serveur"));
  parNom("Ajouter un serveur").click();
  echap();
  expect(m.appels).toHaveLength(1);
});

test("REQ096_AC4_AC5_AC20_AC16_fiche_remplie_corps_du_put_et_retour_a_la_liste", async () => {
  const notes = { nom: "notes", command: "npx", url: null, args: ["-y", "@m/server-memory"], env: [["MEMORY_FILE_PATH", "/tmp/notes.json"]] };
  const m = monter(liste(DOCS), [liste(DOCS, notes), liste(DOCS, notes)]);
  await ouvrir(m);
  parNom("Ajouter un serveur").click();
  expect(dlg().querySelector(".ya-fiche-titre").textContent).toBe("Nouveau serveur");
  expect(["Nom", "Commande", "Arguments", "Variables"].map((l) => champDe(l).value)).toEqual(["", "", "", ""]);
  expect(champDe("Arguments").wrap).toBe("off");
  expect(champDe("Variables").wrap).toBe("off");
  expect(document.getElementById(champDe("Arguments").getAttribute("aria-describedby")).textContent).toBe("Un argument par ligne.");
  expect(document.getElementById(champDe("Variables").getAttribute("aria-describedby")).textContent).toBe("Une par ligne : NOM=valeur. Elles sont écrites en clair dans /home/marie/.config/yaide/mcp.json.");
  expect(document.activeElement).toBe(champDe("Nom"));
  expect(bouts(dlg()).map((b) => b.textContent)).toEqual(["Annuler", "Enregistrer"]);
  champDe("Nom").value = "notes";
  champDe("Commande").value = "npx";
  champDe("Arguments").value = "-y\n\n@m/server-memory\n";
  champDe("Variables").value = "MEMORY_FILE_PATH=/tmp/notes.json\n";
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(dlg().querySelector("ul")).not.toBeNull());
  expect(m.appels[1]).toEqual({
    url: "/api/agent/mcp/serveurs",
    methode: "PUT",
    corps: { nom: "notes", command: "npx", args: ["-y", "@m/server-memory"], env: ["MEMORY_FILE_PATH=/tmp/notes.json"] },
  });
  const statut = dlg().querySelector(".dialogue-resultat [role=status]");
  expect(statut.textContent).toBe("Serveur notes enregistré. Il servira au prochain message à un agent.");
  expect(document.activeElement).toBe(parNom("Modifier notes"));
  expect(dlg().querySelectorAll("li")).toHaveLength(2);

  // Modifier : fiche remplie, titre = nom, corps avec `ancien`.
  parNom("Modifier docs").click();
  expect(dlg().querySelector(".ya-fiche-titre").textContent).toBe("docs");
  expect(["Nom", "Commande", "Arguments", "Variables"].map((l) => champDe(l).value)).toEqual(["docs", "mcp-docs", "--port\n0", "TOKEN=abc"]);
  expect(document.activeElement).toBe(champDe("Nom"));
  expect(dlg().querySelector(".dialogue-resultat")?.hidden ?? true).toBe(true);
  champDe("Nom").value = "docs2";
  champDe("Commande").value = "mcp-docs2";
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(dlg().querySelector("ul")).not.toBeNull());
  expect(m.appels[2].corps).toEqual({ ancien: "docs", nom: "docs2", command: "mcp-docs2", args: ["--port", "0"], env: ["TOKEN=abc"] });
});

test("REQ096_AC20_annuler_revient_a_la_liste_sans_requete_et_rend_le_focus", async () => {
  const m = monter(liste(DOCS, ECHO));
  await ouvrir(m);
  parNom("Modifier echo").click();
  parNom("Annuler").click();
  expect(document.activeElement).toBe(parNom("Modifier echo"));
  parNom("Ajouter un serveur").click();
  parNom("Annuler").click();
  expect(document.activeElement).toBe(parNom("Ajouter un serveur"));
  expect(m.appels).toHaveLength(1);
});

test("REQ096_AC21_entree_dans_nom_ou_commande_enregistre_pas_dans_les_zones", async () => {
  const m = monter(liste(), [liste(ECHO)]);
  await ouvrir(m);
  parNom("Ajouter un serveur").click();
  touche(champDe("Arguments"), "Enter");
  touche(champDe("Variables"), "Enter");
  expect(m.appels).toHaveLength(1);
  champDe("Nom").value = "echo";
  champDe("Commande").value = "node";
  touche(champDe("Commande"), "Enter");
  await vi.waitFor(() => expect(m.appels).toHaveLength(2));
  expect(m.appels[1].corps.nom).toBe("echo");
});

test("REQ096_AC6_AC22_confirmation_annuler_echap_puis_supprimer_et_focus_suivant", async () => {
  const m = monter(liste(DOCS, ECHO), [liste(ECHO), liste(), liste(ECHO, DOCS)]);
  await ouvrir(m);
  parNom("Supprimer docs").click();
  const conf = dlg();
  expect(conf.getAttribute("aria-labelledby") && document.getElementById(conf.getAttribute("aria-labelledby")).textContent).toBe("Supprimer le serveur docs ?");
  expect(conf.textContent).toContain("Sa configuration sera perdue.");
  expect(document.activeElement).toBe(bouts(conf)[0]);
  expect(bouts(conf).map((b) => b.textContent)).toEqual(["Annuler", "Supprimer"]);
  bouts(conf)[0].click();
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(document.activeElement).toBe(parNom("Supprimer docs"));
  parNom("Supprimer docs").click();
  echap();
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(document.activeElement).toBe(parNom("Supprimer docs"));
  expect(m.appels).toHaveLength(1);
  // Supprimer le premier : focus sur le suivant.
  parNom("Supprimer docs").click();
  bouts(dlg())[1].click();
  await vi.waitFor(() => expect(document.querySelectorAll("dialog")).toHaveLength(1));
  expect(m.appels[1]).toEqual({ url: "/api/agent/mcp/serveurs/docs", methode: "DELETE", corps: undefined });
  expect(dlg().querySelector("[role=status]").textContent).toBe("Serveur docs supprimé.");
  expect(document.activeElement).toBe(parNom("Modifier echo"));
  // Supprimer le dernier : « Aucun serveur MCP. » et focus sur « Ajouter un serveur ».
  parNom("Supprimer echo").click();
  bouts(dlg())[1].click();
  await vi.waitFor(() => expect(dlg().textContent).toContain("Aucun serveur MCP."));
  expect(dlg().textContent).toContain("Serveur echo supprimé.");
  expect(document.activeElement).toBe(parNom("Ajouter un serveur"));
});

test("REQ096_AC6_suppression_du_dernier_de_la_liste_donne_le_focus_au_precedent", async () => {
  const m = monter(liste(DOCS, ECHO), [liste(DOCS)]);
  await ouvrir(m);
  parNom("Supprimer echo").click();
  bouts(dlg())[1].click();
  await vi.waitFor(() => expect(document.activeElement).toBe(parNom("Modifier docs")));
});

test("REQ096_AC6_echec_de_suppression_dans_la_liste_focus_sur_supprimer", async () => {
  const m = monter(liste(DOCS), ["coupure"]);
  await ouvrir(m);
  parNom("Supprimer docs").click();
  bouts(dlg())[1].click();
  await vi.waitFor(() => expect(document.querySelectorAll("dialog")).toHaveLength(1));
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(document.activeElement).toBe(parNom("Supprimer docs"));
});

test("REQ096_AC7_AC15_refus_sous_chaque_champ_focus_premier_et_enregistrement_en_cours", async () => {
  let liberer;
  const attente = () => new Promise((r) => (liberer = () => r(rep({ erreurs: { nom: "Donnez un nom au serveur.", command: "Donnez la commande qui lance le serveur.", env: "Variables : une par ligne, sous la forme NOM=valeur." } }, 422))));
  const m = monter(liste(), [attente]);
  await ouvrir(m);
  parNom("Ajouter un serveur").click();
  champDe("Variables").value = "x";
  parNom("Enregistrer").click();
  expect(bouts(dlg()).map((b) => [b.textContent, b.disabled])).toEqual([["Annuler", true], ["Enregistrement…", true]]);
  liberer();
  await vi.waitFor(() => expect(dlg().querySelectorAll(".champ-erreur")).toHaveLength(3));
  const e = [...dlg().querySelectorAll(".champ-erreur")];
  expect(e.map((x) => [x.getAttribute("role"), x.textContent])).toEqual([
    ["alert", "Donnez un nom au serveur."],
    ["alert", "Donnez la commande qui lance le serveur."],
    ["alert", "Variables : une par ligne, sous la forme NOM=valeur."],
  ]);
  expect(["Nom", "Commande", "Variables"].map((l) => champDe(l).getAttribute("aria-invalid"))).toEqual(["true", "true", "true"]);
  expect(champDe("Arguments").getAttribute("aria-invalid")).toBeNull();
  expect(champDe("Variables").value).toBe("x");
  expect(document.activeElement).toBe(champDe("Nom"));
  expect(bouts(dlg()).map((b) => [b.textContent, b.disabled])).toEqual([["Annuler", false], ["Enregistrer", false]]);
});

test("REQ096_AC7_focus_dans_le_premier_champ_refuse_quand_ce_n_est_pas_le_nom", async () => {
  const m = monter(liste(), [rep({ erreurs: { command: "Donnez la commande qui lance le serveur.", env: "Variables : une par ligne, sous la forme NOM=valeur." } }, 422)]);
  await ouvrir(m);
  parNom("Ajouter un serveur").click();
  champDe("Nom").value = "a";
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(document.activeElement).toBe(champDe("Commande")));
  expect(champDe("Nom").getAttribute("aria-invalid")).toBeNull();
});

test("REQ096_AC9_illisible_a_l_ouverture_seul_fermer_avec_le_focus", async () => {
  const m = monter(rep({ fichier: FICHIER, cause: "illisible", message: "x", detail: "expected value at line 1 column 2" }, 409));
  await ouvrir(m);
  const a = dlg().querySelector("[role=alert]");
  expect(a.querySelector(".message-texte").textContent).toBe(FICHIER + " est illisible. Corrigez-le, puis rouvrez Serveurs MCP.");
  expect(a.querySelector(".message-detail").textContent).toBe("expected value at line 1 column 2");
  expect(document.getElementById(dlg().getAttribute("aria-describedby")).textContent).toBe("Dans "+FICHIER+", pour les agents de Yaide dans tous vos projets. Claude Code et opencode ont leur propre configuration.");
  expect(bouts(dlg()).map((b) => b.textContent)).toEqual(["Fermer"]);
  expect(document.activeElement).toBe(parNom("Fermer"));
  expect(dlg().querySelector("ul")).toBeNull();
});

test("REQ096_AC9_illisible_a_l_enregistrement_garde_la_saisie", async () => {
  const m = monter(liste(), [rep({ fichier: FICHIER, cause: "illisible", message: "x", detail: "boum" }, 409)]);
  await ouvrir(m);
  parNom("Ajouter un serveur").click();
  champDe("Nom").value = "a";
  champDe("Commande").value = "b";
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(dlg().querySelector(".dialogue-resultat [role=alert]")).not.toBeNull());
  expect(dlg().querySelector(".dialogue-resultat .message-texte").textContent).toBe(FICHIER + " est illisible. Corrigez-le, puis rouvrez Serveurs MCP.");
  expect(dlg().querySelector(".dialogue-resultat .message-detail").textContent).toBe("boum");
  expect(champDe("Nom").value).toBe("a");
  expect(champDe("Commande").value).toBe("b");
  expect(bouts(dlg()).map((b) => b.textContent)).toEqual(["Annuler", "Enregistrer"]);
});

test("REQ096_AC10_AC24_serveur_a_adresse_info_et_commande_vide", async () => {
  const m = monter(liste(NOTION));
  await ouvrir(m);
  expect(dlg().querySelector(".ya-objet-texte").textContent).toBe("https://mcp.notion.com/mcp");
  parNom("Modifier notion").click();
  const info = dlg().querySelector(".ya-fiche [role=status]");
  expect(info.textContent).toBe("Yaide ne prend pas en charge l'adresse https://mcp.notion.com/mcp. Utilisez la commande npx, avec les arguments mcp-remote et cette adresse.");
  expect(info.compareDocumentPosition(champDe("Nom")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(champDe("Commande").value).toBe("");
});

test("REQ096_AC25_coupure_a_l_ecriture_garde_la_saisie", async () => {
  const m = monter(liste(), ["coupure"]);
  await ouvrir(m);
  parNom("Ajouter un serveur").click();
  champDe("Nom").value = "a";
  champDe("Commande").value = "b";
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(dlg().querySelector(".dialogue-resultat [role=alert]")).not.toBeNull());
  expect(dlg().querySelector(".dialogue-resultat [role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect([champDe("Nom").value, champDe("Commande").value]).toEqual(["a", "b"]);
  expect(parNom("Enregistrer").disabled).toBe(false);
});

test("REQ096_AC25_echec_du_serveur_donne_enregistrement_impossible", async () => {
  const m = monter(liste(), [rep({ cause: "ecriture", message: "Permission denied." }, 500)]);
  await ouvrir(m);
  parNom("Ajouter un serveur").click();
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(dlg().querySelector(".dialogue-resultat [role=alert]")).not.toBeNull());
  expect(dlg().querySelector(".dialogue-resultat [role=alert]").textContent).toBe("Enregistrement impossible : Permission denied.");
});

test("REQ096_etats_chargement_apres_200_ms_et_lecture_impossible", async () => {
  vi.useFakeTimers();
  let liberer;
  const m = monter(() => new Promise((r) => (liberer = () => r(liste(DOCS)))));
  const p = m.v.ouvrir();
  const charge = () => dlg().querySelector("[aria-busy=true]");
  expect(charge().hidden).toBe(true);
  vi.advanceTimersByTime(250);
  expect(charge().hidden).toBe(false);
  expect(charge().textContent).toBe("Chargement…");
  expect(parNom("Ajouter un serveur").disabled).toBe(true);
  expect(document.activeElement).toBe(dlg());
  liberer();
  await p;
  expect(document.activeElement).toBe(parNom("Modifier docs"));
  document.body.replaceChildren();
  vi.useRealTimers();

  const a = monter("coupure");
  await ouvrir(a);
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(dlg().querySelector(".ya-aide-liste")).toBeNull();
  expect(dlg().hasAttribute("aria-describedby")).toBe(false);
  expect(bouts(dlg()).map((b) => b.textContent)).toEqual(["Fermer"]);
  document.body.replaceChildren();
  const b = monter(rep({ fichier: FICHIER, cause: "lecture", message: "Permission denied." }, 500));
  await ouvrir(b);
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Impossible de lire " + FICHIER + " : Permission denied.");
  expect(document.getElementById(dlg().getAttribute("aria-describedby")).textContent).toBe("Dans "+FICHIER+", pour les agents de Yaide dans tous vos projets. Claude Code et opencode ont leur propre configuration.");
  expect(document.activeElement).toBe(parNom("Fermer"));
});
