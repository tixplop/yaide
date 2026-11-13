import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { vueConnaissance } from "./connaissance.js";

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
const CONFIG = { provider: "ollama", modele: "nomic-embed-text" };
const NOTES = { nom: "notes", fichiers: 2, passages: 7 };
const API = { nom: "api", fichiers: 1, passages: 1 };
const etat = (collections = [], config = CONFIG, extra = {}) => rep({ config, erreur: null, collections, ajout: null, ...extra });

// Faux serveur : `routes` donne, pour chaque requête (méthode + url), la réponse ou une fonction ; la première lecture est `initial`.
function monter(initial, routes = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const appel = { url: String(url), methode: options.method ?? "GET", corps: options.body ? JSON.parse(options.body) : undefined };
    appels.push(appel);
    const cle = `${appel.methode} ${appel.url}`;
    const r = cle in routes ? routes[cle] : initial;
    if (r === "coupure") throw new TypeError("réseau");
    return typeof r === "function" ? r(appel) : r;
  }));
  const ouvreur = document.createElement("button");
  document.body.append(ouvreur);
  ouvreur.focus();
  const etats = [];
  const v = vueConnaissance({ surEtat: (o) => etats.push(o) });
  return { v, appels, ouvreur, etats };
}
const dlg = () => [...document.querySelectorAll("dialog")].at(-1);
const bouts = (racine = document) => [...racine.querySelectorAll("button")];
const parNom = (nom) => bouts().find((b) => b.getAttribute("aria-label") === nom || b.textContent === nom);
const champDe = (libelle) => [...document.querySelectorAll("label")].find((l) => l.textContent === libelle).control;
const onglet = (nom) => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === nom);
const touche = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const echap = () => dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
const ecritures = (appels) => appels.filter((a) => a.methode !== "GET");
const panneau = (nom) => document.getElementById(onglet(nom).getAttribute("aria-controls"));

test("REQ103_AC2_AC9_non_configuree_ouvre_Configuration_focus_Provider_sans_ecriture", async () => {
  const m = monter(etat([], null));
  await m.v.ouvrir();
  const d = dlg();
  expect(d.getAttribute("role") ?? "dialog").toBe("dialog");
  expect(document.getElementById(d.getAttribute("aria-labelledby")).textContent).toBe("Base de connaissance");
  const tl = d.querySelector("[role=tablist]");
  expect(tl.getAttribute("aria-label")).toBe("Base de connaissance");
  const tabs = [...tl.querySelectorAll("[role=tab]")];
  expect(tabs.map((t) => t.textContent)).toEqual(["Configuration", "Collections", "Recherche"]);
  for (const t of tabs) expect(document.getElementById(t.getAttribute("aria-controls")).getAttribute("role")).toBe("tabpanel");
  expect(onglet("Configuration").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(champDe("Provider"));
  expect([...champDe("Provider").options].map((o) => o.textContent)).toEqual(["OpenAI", "Google", "OpenRouter", "LiteLLM", "Ollama"]);
  expect(champDe("Modèle").value).toBe("");
  expect(m.appels.map((a) => a.url)).toEqual(["/api/connaissance"]);
  const hauteur = d.className;
  touche(onglet("Configuration"), "ArrowRight");
  expect(d.className).toBe(hauteur);
  expect(m.etats).toEqual([true]);
  echap();
  expect(ecritures(m.appels)).toEqual([]);
  expect(m.etats).toEqual([true, false]);
  expect(document.activeElement).toBe(m.ouvreur);
});

test("REQ103_AC9_configuree_ouvre_Recherche_et_les_fleches_changent_de_section_en_bouclant", async () => {
  const m = monter(etat([NOTES]));
  await m.v.ouvrir();
  expect(onglet("Recherche").getAttribute("aria-selected")).toBe("true");
  expect(panneau("Recherche").hidden).toBe(false);
  expect(panneau("Configuration").hidden).toBe(true);
  expect(document.activeElement).toBe(onglet("Recherche"));
  touche(onglet("Recherche"), "ArrowRight");
  expect(onglet("Configuration").getAttribute("aria-selected")).toBe("true");
  touche(onglet("Configuration"), "ArrowLeft");
  expect(onglet("Recherche").getAttribute("aria-selected")).toBe("true");
  touche(onglet("Recherche"), "Home");
  expect(onglet("Configuration").getAttribute("aria-selected")).toBe("true");
  touche(onglet("Configuration"), "End");
  expect(onglet("Recherche").getAttribute("aria-selected")).toBe("true");
  expect(panneau("Recherche").children.length).toBe(0);
});

test("REQ103_AC9_configurer_force_la_section_Configuration_et_le_retour_de_focus_va_a_surFermeture", async () => {
  const m = monter(etat([], CONFIG));
  const retour = vi.fn();
  await m.v.ouvrir({ configurer: true, surFermeture: retour });
  expect(onglet("Configuration").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(champDe("Provider"));
  expect(champDe("Provider").value).toBe("ollama");
  expect(champDe("Modèle").value).toBe("nomic-embed-text");
  m.ouvreur.focus();
  parNom("Fermer").click();
  expect(retour).toHaveBeenCalledTimes(1);
  expect(dlg()).toBeUndefined();
  expect(document.activeElement).toBe(m.ouvreur);
});

test("REQ103_AC4_AC10_modele_vide_refuse_sous_le_champ_role_alert_aria_invalid_focus_rien_ecrit", async () => {
  const m = monter(etat([], null));
  await m.v.ouvrir();
  expect(document.querySelector("p.ya-groupe-aide").textContent).toBe(
    "Dans .yaide/connaissance/config.json, pour ce projet. Les fichiers ajoutés et les questions partent à ce provider, avec l'adresse et la clé de Providers LLM.",
  );
  expect(champDe("Modèle").parentElement.textContent).toContain("Un modèle d'embedding de ce provider, par exemple nomic-embed-text.");
  champDe("Modèle").value = "   ";
  champDe("Modèle").dispatchEvent(new Event("input", { bubbles: true }));
  parNom("Enregistrer").click();
  const champ = champDe("Modèle");
  const alerte = champ.parentElement.querySelector("[role=alert]");
  expect(alerte.textContent).toBe("Donnez le nom du modèle.");
  expect(champ.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(champ);
  expect(ecritures(m.appels)).toEqual([]);
});

test("REQ103_AC10_enregistrer_par_bouton_ou_Entree_ecrit_et_dit_Configuration_enregistree_focus_reste", async () => {
  let fin;
  const attente = new Promise((r) => (fin = r));
  const m = monter(etat([], null), { "PUT /api/connaissance/config": () => attente.then(() => etat([], CONFIG)) });
  await m.v.ouvrir();
  champDe("Provider").value = "ollama";
  champDe("Provider").dispatchEvent(new Event("change", { bubbles: true }));
  champDe("Modèle").value = " nomic-embed-text ";
  champDe("Modèle").dispatchEvent(new Event("input", { bubbles: true }));
  const bouton = parNom("Enregistrer");
  bouton.focus();
  bouton.click();
  expect(parNom("Enregistrement…").disabled).toBe(true);
  expect(ecritures(m.appels)).toEqual([{ url: "/api/connaissance/config", methode: "PUT", corps: { provider: "ollama", modele: "nomic-embed-text" } }]);
  fin();
  await vi.waitFor(() => expect(document.querySelector(".dialogue-resultat [role=status]")?.textContent).toBe("Configuration enregistrée."));
  expect(document.activeElement).toBe(parNom("Enregistrer"));
  expect(champDe("Modèle").value).toBe("nomic-embed-text");
  // Entrée dans « Modèle » vaut « Enregistrer ».
  champDe("Modèle").focus();
  touche(champDe("Modèle"), "Enter");
  await vi.waitFor(() => expect(ecritures(m.appels)).toHaveLength(2));
  await vi.waitFor(() => expect(parNom("Enregistrer")).toBeDefined());
  await vi.waitFor(() => expect(document.activeElement).toBe(champDe("Modèle")));
});

test("REQ103_AC10_echec_d_enregistrement_et_coupure_en_message_erreur", async () => {
  const m = monter(etat([], null), {
    "PUT /api/connaissance/config": rep({ cause: "ecriture", message: "Permission denied." }, 500),
  });
  await m.v.ouvrir();
  champDe("Modèle").value = "x";
  champDe("Modèle").dispatchEvent(new Event("input", { bubbles: true }));
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(document.querySelector(".dialogue-resultat [role=alert]")?.textContent).toBe("Enregistrement impossible : Permission denied."));
  const c = monter(etat([], null), { "PUT /api/connaissance/config": "coupure" });
  document.body.replaceChildren();
  await c.v.ouvrir();
  champDe("Modèle").value = "x";
  champDe("Modèle").dispatchEvent(new Event("input", { bubbles: true }));
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(document.querySelector(".dialogue-resultat [role=alert]")?.textContent).toBe("Connexion perdue. Réessayez au retour."));
});

test("REQ103_AC5_AC11_une_collection_verrouille_les_champs_message_et_pas_d_Enregistrer_puis_deverrouille", async () => {
  const m = monter(etat([NOTES]), {});
  await m.v.ouvrir();
  touche(onglet("Recherche"), "Home");
  expect(champDe("Provider").disabled).toBe(true);
  expect(champDe("Modèle").disabled).toBe(true);
  expect(panneau("Configuration").textContent).toContain(
    "Pour changer de provider ou de modèle, supprimez d'abord les collections : les vecteurs de deux modèles ne se comparent pas.",
  );
  expect(parNom("Enregistrer")).toBeUndefined();
  expect(bouts(dlg().querySelector(".dialogue-actions")).map((b) => b.textContent)).toEqual(["Fermer"]);
  // Supprimer la dernière collection : les champs redeviennent modifiables.
  m.appels.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => (o.method === "DELETE" ? etat([]) : etat([NOTES]))));
  touche(onglet("Configuration"), "ArrowRight");
  parNom("Supprimer notes").click();
  parNom("Supprimer").click();
  await vi.waitFor(() => expect(document.querySelector(".dialogue-resultat")?.textContent).toBe("Collection notes supprimée."));
  touche(onglet("Collections"), "ArrowLeft");
  expect(champDe("Provider").disabled).toBe(false);
  expect(champDe("Modèle").disabled).toBe(false);
  expect(parNom("Enregistrer")).toBeDefined();
});

test("REQ103_AC12_fichier_illisible_message_detail_ni_onglets_ni_champs_seul_Fermer_avec_le_focus", async () => {
  const m = monter(etat([], null, { erreur: "/p/.yaide/connaissance/config.json est illisible : expected value at line 1 column 1" }));
  await m.v.ouvrir();
  const a = document.querySelector("[role=alert]");
  expect(a.textContent).toContain(".yaide/connaissance/config.json est illisible. Corrigez-le, puis rouvrez Base de connaissance.");
  expect(a.textContent).toContain("expected value at line 1 column 1");
  expect(document.querySelector("[role=tablist]")).toBeNull();
  expect(document.querySelector("input, select")).toBeNull();
  expect(bouts(dlg()).map((b) => b.textContent)).toEqual(["Fermer"]);
  expect(document.activeElement).toBe(parNom("Fermer"));
  expect(ecritures(m.appels)).toEqual([]);
});

test("REQ103_lecture_impossible_et_coupure_comme_l_etat_illisible", async () => {
  const a = monter(rep({ cause: "lecture", message: "Permission denied." }, 500));
  await a.v.ouvrir();
  expect(document.querySelector("[role=alert]").textContent).toBe("Impossible de lire .yaide/connaissance/ : Permission denied.");
  expect(document.activeElement).toBe(parNom("Fermer"));
  document.body.replaceChildren();
  const b = monter("coupure");
  await b.v.ouvrir();
  expect(document.querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(document.querySelector("[role=tablist]")).toBeNull();
});

test("REQ103_chargement_apres_200_ms", async () => {
  vi.useFakeTimers();
  let fin;
  const m = monter(new Promise((r) => (fin = r)));
  const p = m.v.ouvrir();
  const ind = () => document.querySelector(".indication");
  expect(ind().hidden).toBe(true);
  vi.advanceTimersByTime(200);
  expect(ind().hidden).toBe(false);
  expect(ind().textContent).toBe("Chargement…");
  fin(etat([], null));
  await p;
  expect(document.querySelector("[role=tablist]")).not.toBeNull();
});

test("REQ105_AC1_AC6_collections_par_ordre_alphabetique_avec_nombres_et_boutons", async () => {
  const m = monter(etat([API, NOTES]));
  await m.v.ouvrir();
  touche(onglet("Recherche"), "ArrowRight");
  touche(onglet("Configuration"), "ArrowRight");
  const ul = panneau("Collections").querySelector("ul");
  expect(ul.getAttribute("aria-label")).toBe("Collections");
  const lignes = [...ul.querySelectorAll("li")];
  expect(lignes.map((l) => l.querySelector(".ya-objet-nom").textContent)).toEqual(["api", "notes"]);
  expect(lignes.map((l) => l.querySelector(".ya-objet-texte").textContent)).toEqual(["1 fichier · 1 passage", "2 fichiers · 7 passages"]);
  expect(bouts(lignes[1]).map((b) => b.getAttribute("aria-label"))).toEqual(["Fichiers de notes", "Supprimer notes"]);
  expect(panneau("Collections").textContent).toContain("Une collection naît de son premier ajout : clic droit sur un fichier ou un dossier de l'arborescence, puis Ajouter à la base de connaissance…");
});

test("REQ105_AC3_AC7_aucune_collection_dit_comment_en_ajouter", async () => {
  const m = monter(etat([]));
  await m.v.ouvrir();
  touche(onglet("Recherche"), "ArrowRight");
  touche(onglet("Configuration"), "ArrowRight");
  const p = panneau("Collections");
  expect(p.querySelector(".indication").textContent).toBe("Aucune collection.");
  expect(p.querySelector("ul")).toBeNull();
  expect(p.textContent).toContain("Une collection naît de son premier ajout");
});

test("REQ105_AC2_AC8_fichiers_d_une_collection_par_chemin_focus_sur_Retour_puis_sur_Fichiers_de", async () => {
  const m = monter(etat([API, NOTES]), {
    "GET /api/connaissance/collections/notes": rep({ nom: "notes", fichiers: ["docs/a.md", "docs/b.md"] }),
  });
  await m.v.ouvrir();
  touche(onglet("Recherche"), "ArrowRight");
  touche(onglet("Configuration"), "ArrowRight");
  parNom("Fichiers de notes").click();
  await vi.waitFor(() => expect(parNom("Retour aux collections")).toBeDefined());
  expect(document.activeElement).toBe(parNom("Retour aux collections"));
  const p = panneau("Collections");
  expect(p.querySelector("h2").textContent).toBe("notes");
  expect(p.textContent).toContain("2 fichiers · 7 passages");
  const ul = p.querySelector("ul");
  expect(ul.getAttribute("aria-label")).toBe("Fichiers de notes");
  expect(ul.getAttribute("tabindex")).toBe("0");
  expect([...ul.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["docs/a.md", "docs/b.md"]);
  parNom("Retour aux collections").click();
  expect(p.querySelector("ul").getAttribute("aria-label")).toBe("Collections");
  expect(document.activeElement).toBe(parNom("Fichiers de notes"));
});

test("REQ105_AC4_AC9_suppression_confirmee_focus_sur_la_suivante_puis_annulee_focus_sur_Supprimer", async () => {
  const m = monter(etat([API, NOTES]), {
    "DELETE /api/connaissance/collections/api": etat([NOTES]),
  });
  await m.v.ouvrir();
  touche(onglet("Recherche"), "ArrowRight");
  touche(onglet("Configuration"), "ArrowRight");
  // Annuler : rien ne change, le focus revient sur « Supprimer api ».
  parNom("Supprimer api").click();
  const conf = dlg();
  expect(document.getElementById(conf.getAttribute("aria-labelledby")).textContent).toBe("Supprimer la collection api ?");
  expect(conf.textContent).toContain("Ses 1 fichier et 1 passage quittent la base. Les fichiers du projet ne changent pas.");
  expect(document.activeElement).toBe(parNom("Annuler"));
  parNom("Annuler").click();
  expect(document.activeElement).toBe(parNom("Supprimer api"));
  expect(ecritures(m.appels)).toEqual([]);
  // Confirmer.
  parNom("Supprimer api").click();
  parNom("Supprimer").click();
  expect(parNom("Suppression…")).toBeDefined();
  await vi.waitFor(() => expect(document.querySelector(".dialogue-resultat [role=status]")?.textContent).toBe("Collection api supprimée."));
  expect(ecritures(m.appels)).toEqual([{ url: "/api/connaissance/collections/api", methode: "DELETE", corps: undefined }]);
  expect([...panneau("Collections").querySelectorAll("li .ya-objet-nom")].map((n) => n.textContent)).toEqual(["notes"]);
  expect(document.activeElement).toBe(parNom("Fichiers de notes"));
});

test("REQ105_AC4_AC9_derniere_collection_supprimee_focus_sur_la_section_Collections", async () => {
  const m = monter(etat([NOTES]), { "DELETE /api/connaissance/collections/notes": etat([]) });
  await m.v.ouvrir();
  touche(onglet("Recherche"), "ArrowRight");
  touche(onglet("Configuration"), "ArrowRight");
  parNom("Supprimer notes").click();
  parNom("Supprimer").click();
  await vi.waitFor(() => expect(document.querySelector(".dialogue-resultat")?.textContent).toBe("Collection notes supprimée."));
  expect(document.activeElement).toBe(onglet("Collections"));
});

test("REQ105_AC4_AC9_suppression_pendant_un_ajout_refusee_sans_confirmation_focus_reste", async () => {
  const enCours = { ...NOTES, ajout: { faits: 12, total: 40 } };
  const m = monter(etat([enCours]));
  await m.v.ouvrir();
  touche(onglet("Recherche"), "ArrowRight");
  touche(onglet("Configuration"), "ArrowRight");
  parNom("Supprimer notes").focus();
  parNom("Supprimer notes").click();
  expect(document.querySelector(".dialogue-resultat [role=alert]").textContent).toBe("L'ajout à notes est en cours. Attendez sa fin pour supprimer la collection.");
  expect(document.querySelectorAll("dialog").length).toBe(1);
  expect(document.activeElement).toBe(parNom("Supprimer notes"));
  expect(ecritures(m.appels)).toEqual([]);
});

test("REQ105_AC4_refus_du_serveur_encours_a_la_confirmation_et_echec_de_suppression", async () => {
  const m = monter(etat([NOTES]), {
    "DELETE /api/connaissance/collections/notes": rep({ cause: "encours", message: "L'ajout à notes est en cours. Attendez sa fin pour supprimer la collection." }, 409),
  });
  await m.v.ouvrir();
  touche(onglet("Recherche"), "ArrowRight");
  touche(onglet("Configuration"), "ArrowRight");
  parNom("Supprimer notes").click();
  parNom("Supprimer").click();
  await vi.waitFor(() => expect(document.querySelector(".dialogue-resultat [role=alert]")?.textContent).toContain("L'ajout à notes est en cours."));
  expect(document.activeElement).toBe(parNom("Supprimer notes"));
  expect(document.querySelectorAll("dialog").length).toBe(1);
});

test("REQ105_AC5_AC6_ajout_en_cours_relu_chaque_seconde_sans_deplacer_le_focus_puis_nombres_finaux", async () => {
  vi.useFakeTimers();
  const suite = [
    etat([{ ...NOTES, fichiers: 0, passages: 0, ajout: { faits: 12, total: 40 } }]),
    etat([{ ...NOTES, fichiers: 0, passages: 0, ajout: { faits: 20, total: 40 } }]),
    etat([{ nom: "notes", fichiers: 40, passages: 96 }]),
  ];
  const m = monter(suite[0], {});
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    m.appels.push({ url: String(url), methode: o.method ?? "GET" });
    return suite[Math.min(n++, 2)];
  }));
  await m.v.ouvrir();
  touche(onglet("Recherche"), "ArrowRight");
  touche(onglet("Configuration"), "ArrowRight");
  const texte = () => panneau("Collections").querySelector(".ya-objet-texte").textContent;
  expect(texte()).toBe("Ajout : 12 / 40 fichiers");
  parNom("Fichiers de notes").focus();
  await vi.advanceTimersByTimeAsync(1000);
  expect(texte()).toBe("Ajout : 20 / 40 fichiers");
  expect(document.activeElement).toBe(parNom("Fichiers de notes"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(texte()).toBe("40 fichiers · 96 passages");
  expect(document.activeElement).toBe(parNom("Fichiers de notes"));
  const lectures = n;
  await vi.advanceTimersByTimeAsync(3000);
  expect(n).toBe(lectures);
});

test("REQ105_la_relecture_s_arrete_a_la_fermeture", async () => {
  vi.useFakeTimers();
  const enCours = etat([{ ...NOTES, ajout: { faits: 1, total: 2 } }]);
  const m = monter(enCours);
  await m.v.ouvrir();
  echap();
  const avant = m.appels.length;
  await vi.advanceTimersByTimeAsync(3000);
  expect(m.appels.length).toBe(avant);
});

test("REQ105_AC6_relecture_pendant_un_ajout_laisse_le_focus_sur_la_liste_des_fichiers", async () => {
  vi.useFakeTimers();
  const a = (faits) => etat([{ ...NOTES, ajout: { faits, total: 40 } }]);
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).includes("/collections/")) return rep({ nom: "notes", fichiers: ["a.md"] });
    return a(12 + n++);
  }));
  const v = vueConnaissance();
  await v.ouvrir();
  touche(onglet("Recherche"), "ArrowRight");
  touche(onglet("Configuration"), "ArrowRight");
  parNom("Fichiers de notes").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(parNom("Retour aux collections"));
  const ul = panneau("Collections").querySelector("ul");
  ul.focus();
  await vi.advanceTimersByTimeAsync(1000);
  expect(document.activeElement.getAttribute("aria-label")).toBe("Fichiers de notes");
  expect(document.activeElement.tagName).toBe("UL");
});
