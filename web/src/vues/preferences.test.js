import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { ouvrirPreferences } from "./preferences.js";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const attendre = () => new Promise((r) => setTimeout(r, 0));

/** Faux serveur : `lecture` rend la réponse à un GET, `ecriture` à un PUT ; `ecritures` garde les corps écrits. */
function faux({ lecture, ecriture } = {}) {
  const etat = { ecritures: [], lectures: 0, fichier: lecture };
  const fetch = vi.fn(async (url, opts = {}) => {
    if (String(url).startsWith("/api/fichier?chemin=")) {
      if (opts.method === "PUT") {
        if (ecriture) return ecriture(opts);
        etat.ecritures.push(opts.body);
        etat.fichier = opts.body;
        return { ok: true, status: 200, json: async () => ({ version: "v2" }) };
      }
      etat.lectures++;
      if (typeof etat.fichier === "string") return { ok: true, status: 200, text: async () => etat.fichier, headers: { get: () => "v1" } };
      if (etat.fichier instanceof Error) throw etat.fichier;
      if (etat.fichier) return etat.fichier;
      return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "Fichier introuvable." }) };
    }
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "x" }) };
  });
  vi.stubGlobal("fetch", fetch);
  return etat;
}

const dlg = () => document.querySelector("dialog");
const select = (nom) => [...dlg().querySelectorAll("select")].find((s) => s.labels[0].textContent === nom);
const caseA = (nom) => [...dlg().querySelectorAll("input[type=checkbox]")].find((s) => s.labels[0].textContent === nom);
const bouton = (nom) => [...dlg().querySelectorAll("button")].find((b) => b.textContent === nom);
const choisir = (s, texte) => {
  s.value = texte;
  s.dispatchEvent(new Event("change", { bubbles: true }));
};
const cocher = (c) => c.click();
const OK = "Préférences enregistrées. Rechargez la page pour les appliquer.";

async function ouvrir(options = {}) {
  const p = ouvrirPreferences(options);
  await attendre();
  await attendre();
  return p;
}

test("REQ071_AC1_sans_fichier_valeurs_par_defaut_sans_ecriture", async () => {
  const etat = faux();
  await ouvrir();
  for (const n of ["Panneau de gauche", "Zone des shells", "Colonne de l'agent"]) expect(select(n).value).toBe("Comme la dernière fois");
  for (const n of ["Recherche", "Git", "Shells", "Agents", "Claude"]) expect(caseA(n).checked).toBe(true);
  expect(dlg().querySelector("[role=alert]")).toBeNull();
  expect(etat.ecritures).toEqual([]);
  expect(fetch.mock.calls.every(([, o]) => (o?.method ?? "GET") === "GET")).toBe(true);
});

test("REQ071_AC2_AC6_valeurs_lues_sur_le_disque_a_chaque_ouverture", async () => {
  const etat = faux({ lecture: '{ "replis": { "panneau": true, "agent": false }, "fonctions": { "git": false } }' });
  let p = await ouvrir();
  expect(select("Panneau de gauche").value).toBe("Replié");
  expect(select("Colonne de l'agent").value).toBe("Déplié");
  expect(select("Zone des shells").value).toBe("Comme la dernière fois");
  expect(["Recherche", "Git", "Shells", "Agents", "Claude"].filter((n) => !caseA(n).checked)).toEqual(["Git"]);
  p.fermer();
  etat.fichier = '{ "fonctions": { "claude": false } }';
  p = await ouvrir();
  expect(select("Panneau de gauche").value).toBe("Comme la dernière fois");
  expect(caseA("Git").checked).toBe(true);
  expect(caseA("Claude").checked).toBe(false);
  expect(etat.lectures).toBe(2);
});

test("REQ071_AC7_AC14_illisible_defauts_alerte_et_remplacement", async () => {
  const etat = faux({ lecture: '{ "gti": {} }' });
  const surFermeture = vi.fn();
  let p = await ouvrir({ surFermeture });
  const alerte = dlg().querySelector("[role=alert]");
  expect(alerte.textContent).toBe(".yaide/interface.json est illisible. « Enregistrer » le remplacera par ces réglages.");
  expect(dlg().querySelector(".dialogue-contenu").firstElementChild.contains(alerte)).toBe(true);
  expect(select("Panneau de gauche").value).toBe("Comme la dernière fois");
  expect(caseA("Git").checked).toBe(true);
  expect(document.activeElement).toBe(select("Panneau de gauche"));
  p.fermer();
  expect(etat.ecritures).toEqual([]);
  expect(surFermeture).toHaveBeenCalledTimes(1);
  p = await ouvrir();
  bouton("Enregistrer").click();
  await attendre();
  expect(etat.ecritures).toEqual(["{}\n"]);
  expect(dlg().querySelector("[role=alert]")).toBeNull();
  expect(dlg().querySelector("[role=status]").textContent).toBe(OK);
});

test("REQ071_AC9_AC16_coupure_a_l_enregistrement_saisie_gardee", async () => {
  const etat = faux({ lecture: "{ nope", ecriture: async () => { throw new TypeError("coupure"); } });
  await ouvrir();
  caseA("Git").click();
  choisir(select("Zone des shells"), "Replié");
  const avant = bouton("Enregistrer");
  avant.focus();
  avant.click();
  await attendre();
  await attendre();
  const alertes = [...dlg().querySelectorAll("[role=alert]")].map((a) => a.textContent);
  expect(alertes).toEqual([expect.stringContaining("illisible"), "Connexion perdue. Réessayez au retour."]);
  // Le message est sous les cases.
  const msg = dlg().querySelectorAll("[role=alert]")[1];
  const derniereCase = caseA("Claude");
  expect(derniereCase.compareDocumentPosition(msg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(caseA("Git").checked).toBe(false);
  expect(select("Zone des shells").value).toBe("Replié");
  expect(etat.ecritures).toEqual([]);
  expect(document.activeElement).toBe(bouton("Enregistrer"));
  expect(bouton("Enregistrer").disabled).toBe(false);
  expect(bouton("Fermer").disabled).toBe(false);
});

test("REQ071_AC9_echec_serveur_dit_la_raison", async () => {
  faux({ ecriture: async () => ({ ok: false, status: 403, json: async () => ({ cause: "interdit", message: "Écriture refusée." }) }) });
  await ouvrir();
  bouton("Enregistrer").click();
  await attendre();
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Enregistrement impossible : Écriture refusée.");
});

test("REQ071_AC17_coupure_a_l_ouverture", async () => {
  faux({ lecture: new TypeError("coupure") });
  await ouvrir();
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(dlg().querySelector("select, input[type=checkbox], fieldset")).toBeNull();
  expect(bouton("Enregistrer").disabled).toBe(true);
  expect(document.activeElement).toBe(bouton("Fermer"));
  document.body.replaceChildren();
  faux({ lecture: { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "Disque plein." }) } });
  await ouvrir();
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Impossible de lire .yaide/interface.json : Disque plein.");
  expect(bouton("Enregistrer").disabled).toBe(true);
  expect(document.activeElement).toBe(bouton("Fermer"));
});

test("REQ071_AC10_AC12_AC13_role_nom_ordre_et_focus", async () => {
  faux();
  const p = ouvrirPreferences();
  const d = dlg();
  expect(d.textContent).toContain("Chargement…");
  expect(bouton("Enregistrer").disabled).toBe(true);
  await attendre();
  await attendre();
  expect(d.getAttribute("aria-labelledby")).toBeTruthy();
  expect(document.getElementById(d.getAttribute("aria-labelledby")).textContent).toBe("Préférences d'interface");
  expect(d.querySelector("h2").textContent).toBe("Préférences d'interface");
  expect(document.getElementById(d.getAttribute("aria-describedby")).textContent).toBe("Dans .yaide/interface.json. Appliquées au prochain chargement de la page.");
  const fieldsets = d.querySelectorAll("fieldset");
  expect([...fieldsets].map((f) => f.querySelector("legend").textContent)).toEqual(["À l'ouverture de la page", "Fonctions"]);
  expect([...fieldsets[0].querySelectorAll("select")].map((s) => s.labels[0].textContent)).toEqual(["Panneau de gauche", "Zone des shells", "Colonne de l'agent"]);
  for (const s of fieldsets[0].querySelectorAll("select")) expect([...s.options].map((o) => o.textContent)).toEqual(["Comme la dernière fois", "Déplié", "Replié"]);
  expect([...fieldsets[1].querySelectorAll("input")].map((i) => i.labels[0].textContent)).toEqual(["Recherche", "Git", "Shells", "Agents", "Claude"]);
  expect(document.getElementById(fieldsets[1].getAttribute("aria-describedby")).textContent).toBe("Une fonction décochée disparaît de l'interface. Rien n'est effacé.");
  expect([...d.querySelectorAll(".dialogue-actions button")].map((b) => b.textContent)).toEqual(["Fermer", "Enregistrer"]);
  expect(d.querySelectorAll(":disabled")).toHaveLength(0);
  expect(document.activeElement).toBe(select("Panneau de gauche"));
  // Entrée n'enregistre pas.
  const entree = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  caseA("Git").dispatchEvent(entree);
  expect(entree.defaultPrevented).toBe(true);
  expect(fetch.mock.calls.every(([, o]) => (o?.method ?? "GET") === "GET")).toBe(true);
  // Échap ferme sans écrire.
  const surAnnuler = new Event("cancel", { cancelable: true });
  d.dispatchEvent(surAnnuler);
  expect(document.querySelector("dialog")).toBeNull();
  p.fermer();
});

test("REQ071_AC3_enregistre_le_fichier_minimal_pendant_l_ecriture_boutons_gardes", async () => {
  let fin;
  const etat = faux({
    ecriture: (opts) => new Promise((r) => { fin = () => r({ ok: true, status: 200, json: async () => ({ version: "v2" }) }); etat.ecritures.push(opts.body); }),
  });
  await ouvrir();
  cocher(caseA("Shells"));
  choisir(select("Panneau de gauche"), "Replié");
  bouton("Enregistrer").click();
  await attendre();
  expect(bouton("Enregistrement…").disabled).toBe(true);
  expect(bouton("Fermer").disabled).toBe(true);
  expect(etat.ecritures).toEqual(['{\n  "replis": {\n    "panneau": true\n  },\n  "fonctions": {\n    "shells": false\n  }\n}\n']);
  fin();
  await attendre();
  expect(bouton("Enregistrer").disabled).toBe(false);
  expect(bouton("Fermer").disabled).toBe(false);
});

test("REQ071_AC11_AC15_reussite_focus_et_message_retire", async () => {
  const etat = faux({ lecture: "{ cassé" });
  await ouvrir();
  const b = bouton("Enregistrer");
  b.focus();
  b.click();
  await attendre();
  await attendre();
  const statut = dlg().querySelector("[role=status]");
  expect(statut.textContent).toBe(OK);
  expect(dlg().querySelector("[role=alert]")).toBeNull();
  expect(document.activeElement).toBe(bouton("Enregistrer"));
  expect(dlg().isConnected && dlg().hasAttribute("open")).toBe(true);
  expect(etat.ecritures).toEqual(["{}\n"]);
  // Un changement de case, puis de choix, retire le message.
  caseA("Git").click();
  expect(dlg().querySelector("[role=status]")).toBeNull();
  bouton("Enregistrer").click();
  await attendre();
  await attendre();
  expect(dlg().querySelector("[role=status]")).not.toBeNull();
  choisir(select("Colonne de l'agent"), "Déplié");
  expect(dlg().querySelector("[role=status]")).toBeNull();
});
