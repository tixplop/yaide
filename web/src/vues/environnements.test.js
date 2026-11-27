import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { vueEnvironnements } from "./environnements.js";

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

const FICHIER = "/home/marie/.config/yaide/environnements.json";
const LOCAL = { nom: "local", variables: {} };
const PROD = { nom: "prod", variables: { ANTHROPIC_BASE_URL: "https://x.test/v1", ANTHROPIC_AUTH_TOKEN: "sk-secret" } };
const DEV = { nom: "dev", variables: { A: "1" } };
const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps });
const liste = (...e) => rep({ fichier: FICHIER, environnements: e });

// Faux serveur : la première requête (la lecture) reçoit `initial`, les suivantes `reponses` dans l'ordre.
function monter(initial, reponses = []) {
  const appels = [];
  const file = [...reponses];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    appels.push({ url: String(url), methode: options.method ?? "GET", corps: options.body ? JSON.parse(options.body) : undefined });
    const r = appels.length === 1 ? initial : file.shift();
    if (r === "coupure") throw new TypeError("réseau");
    return typeof r === "function" ? r() : r;
  }));
  const ouvreur = document.createElement("button");
  document.body.append(ouvreur);
  ouvreur.focus();
  const fermetures = [];
  const v = vueEnvironnements({ surFermeture: () => fermetures.push(true) });
  return { v, appels, ouvreur, fermetures };
}
const dlg = () => [...document.querySelectorAll("dialog")].at(-1);
const bouts = (racine = document) => [...racine.querySelectorAll("button")];
const parNom = (nom) => bouts().find((b) => b.getAttribute("aria-label") === nom || b.textContent === nom);
const champDe = (libelle) => [...document.querySelectorAll("label")].find((l) => l.textContent === libelle).control;
const touche = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const echap = () => dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
const ecritures = (appels) => appels.filter((a) => a.methode !== "GET");
const texteDe = (id) => document.getElementById(id).textContent;

test("REQ182_AC1_AC13_AC10_vide_aide_focus_sur_ajouter_et_rien_d_ecrit", async () => {
  const m = monter(liste());
  await m.v.ouvrir();
  const d = dlg();
  expect(m.appels).toEqual([{ url: "/api/environnements", methode: "GET", corps: undefined }]);
  expect(texteDe(d.getAttribute("aria-labelledby"))).toBe("Environnements");
  expect(d.textContent).toContain("Aucun environnement.");
  expect(d.querySelector("ul")).toBeNull();
  expect(texteDe(d.getAttribute("aria-describedby"))).toBe(
    `Dans ${FICHIER}, pour tous vos projets. Clic droit sur «\u00a0Nouveau shell\u00a0», «\u00a0Claude\u00a0» ou «\u00a0opencode\u00a0» pour lancer avec un environnement.`,
  );
  expect(document.activeElement).toBe(parNom("Ajouter un environnement"));
  parNom("Ajouter un environnement").click();
  echap();
  expect(ecritures(m.appels)).toEqual([]);
  expect(m.appels).toHaveLength(1);
});

test("REQ182_AC6_AC13_AC10_liste_des_noms_sans_valeurs_boutons_et_focus", async () => {
  const m = monter(liste(LOCAL, PROD));
  await m.v.ouvrir();
  const d = dlg();
  const ul = d.querySelector("ul");
  expect(ul.getAttribute("aria-label")).toBe("Environnements");
  const li = [...ul.querySelectorAll("li")];
  expect(li.map((l) => l.querySelector(".ya-objet-nom").textContent)).toEqual(["local", "prod"]);
  expect(li[0].querySelector(".ya-objet-texte").textContent).toBe("Aucune variable");
  expect(li[0].querySelector(".ya-objet-texte").classList.contains("liste-code")).toBe(false);
  expect(li[1].querySelector(".ya-objet-texte").textContent).toBe("ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN");
  expect(li[1].querySelector(".ya-objet-texte").classList.contains("liste-code")).toBe(true);
  expect(d.textContent).not.toContain("sk-secret");
  expect(d.textContent).not.toContain("https://x.test/v1");
  expect(bouts(d).map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Modifier local", "Supprimer local", "Modifier prod", "Supprimer prod", "Fermer", "Ajouter un environnement"]);
  expect(document.activeElement).toBe(parNom("Modifier local"));
});

test("REQ182_AC10_echap_et_fermer_ferment_sans_ecrire_et_appellent_surFermeture", async () => {
  const m = monter(liste(PROD), [liste(PROD), liste(PROD)]);
  await m.v.ouvrir();
  echap();
  expect(dlg()).toBeUndefined();
  await m.v.ouvrir();
  parNom("Modifier prod").click();
  echap();
  expect(dlg()).toBeUndefined();
  await m.v.ouvrir();
  parNom("Fermer").click();
  expect(m.fermetures).toHaveLength(3);
  expect(ecritures(m.appels)).toEqual([]);
});

test("REQ182_AC13_fiche_nouvelle_et_fiche_remplie_puis_annuler_sans_ecrire", async () => {
  const m = monter(liste(PROD));
  await m.v.ouvrir();
  parNom("Ajouter un environnement").click();
  expect(dlg().querySelector(".ya-fiche-titre").textContent).toBe("Nouvel environnement");
  expect(document.activeElement).toBe(champDe("Nom"));
  parNom("Annuler").click();
  expect(document.activeElement).toBe(parNom("Ajouter un environnement"));
  parNom("Modifier prod").click();
  expect(dlg().querySelector(".ya-fiche-titre").textContent).toBe("prod");
  expect(champDe("Nom").value).toBe("prod");
  expect(champDe("Variables").value).toBe("ANTHROPIC_BASE_URL=https://x.test/v1\nANTHROPIC_AUTH_TOKEN=sk-secret");
  expect(document.activeElement).toBe(champDe("Nom"));
  parNom("Annuler").click();
  expect(document.activeElement).toBe(parNom("Modifier prod"));
  expect(m.appels).toHaveLength(1);
});

test("REQ182_AC11_champ_variables_aide_wrap_off", async () => {
  const m = monter(liste());
  await m.v.ouvrir();
  parNom("Ajouter un environnement").click();
  const v = champDe("Variables");
  expect(v.getAttribute("wrap")).toBe("off");
  expect(texteDe(v.getAttribute("aria-describedby"))).toBe("Une par ligne : NOM=valeur. Elles sont écrites en clair dans ce fichier.");
  expect(m.appels).toHaveLength(1);
});

test("REQ182_AC2_AC12_enregistrer_envoie_les_deux_variables_ligne_vide_ignoree_message_et_focus", async () => {
  const prod = { nom: "prod", variables: { ANTHROPIC_BASE_URL: "https://x.test/v1", JETON: "a=b" } };
  const m = monter(liste(), [liste(prod)]);
  await m.v.ouvrir();
  parNom("Ajouter un environnement").click();
  champDe("Nom").value = "prod";
  champDe("Variables").value = "ANTHROPIC_BASE_URL=https://x.test/v1\n\nJETON=a=b";
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=status]")).not.toBeNull());
  expect(m.appels[1]).toEqual({
    url: "/api/environnements",
    methode: "PUT",
    corps: { nom: "prod", variables: { ANTHROPIC_BASE_URL: "https://x.test/v1", JETON: "a=b" } },
  });
  expect(dlg().querySelector("[role=status]").textContent).toBe("Environnement prod enregistré. Il servira au prochain lancement.");
  expect(dlg().querySelector("ul li .ya-objet-nom").textContent).toBe("prod");
  expect(document.activeElement).toBe(parNom("Modifier prod"));
});

test("REQ182_AC3_modifier_envoie_ancien_et_les_variables_restantes", async () => {
  const m = monter(liste(PROD), [liste({ nom: "production", variables: { ANTHROPIC_BASE_URL: "https://x.test/v1" } })]);
  await m.v.ouvrir();
  parNom("Modifier prod").click();
  champDe("Nom").value = "production";
  champDe("Variables").value = "ANTHROPIC_BASE_URL=https://x.test/v1";
  touche(champDe("Nom"), "Enter");
  await vi.waitFor(() => expect(dlg().querySelector("[role=status]")).not.toBeNull());
  expect(m.appels[1].corps).toEqual({ ancien: "prod", nom: "production", variables: { ANTHROPIC_BASE_URL: "https://x.test/v1" } });
  expect(document.activeElement).toBe(parNom("Modifier production"));
});

test("REQ182_AC4_AC12_AC14_suppression_annuler_echap_puis_confirmer_texte_et_focus_suivant", async () => {
  const m = monter(liste(DEV, PROD), [liste(PROD), liste(), liste(PROD)]);
  await m.v.ouvrir();
  parNom("Supprimer dev").click();
  const conf = dlg();
  expect(texteDe(conf.getAttribute("aria-labelledby"))).toBe("Supprimer l'environnement dev ?");
  expect(conf.textContent).toContain("Ses variables seront perdues. Ce qui est déjà lancé avec lui les garde.");
  expect(bouts(conf).map((b) => b.textContent)).toEqual(["Annuler", "Supprimer"]);
  expect(document.activeElement).toBe(bouts(conf)[0]);
  bouts(conf)[0].click();
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(document.activeElement).toBe(parNom("Supprimer dev"));
  parNom("Supprimer dev").click();
  echap();
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(document.activeElement).toBe(parNom("Supprimer dev"));
  expect(m.appels).toHaveLength(1);
  parNom("Supprimer dev").click();
  bouts(dlg())[1].click();
  await vi.waitFor(() => expect(document.querySelectorAll("dialog")).toHaveLength(1));
  expect(m.appels[1]).toEqual({ url: "/api/environnements/dev", methode: "DELETE", corps: undefined });
  expect(dlg().querySelector("[role=status]").textContent).toBe("Environnement dev supprimé.");
  expect(document.activeElement).toBe(parNom("Modifier prod"));
  // Le dernier : « Aucun environnement. » et focus sur « Ajouter un environnement ».
  parNom("Supprimer prod").click();
  bouts(dlg())[1].click();
  await vi.waitFor(() => expect(dlg().textContent).toContain("Aucun environnement."));
  expect(document.activeElement).toBe(parNom("Ajouter un environnement"));
});

test("REQ182_AC14_suppression_du_dernier_de_la_liste_donne_le_focus_au_precedent", async () => {
  const m = monter(liste(DEV, PROD), [liste(DEV)]);
  await m.v.ouvrir();
  parNom("Supprimer prod").click();
  bouts(dlg())[1].click();
  await vi.waitFor(() => expect(document.activeElement).toBe(parNom("Modifier dev")));
  expect(m.appels).toHaveLength(2);
});

test("REQ182_AC5_AC11_nom_vide_ou_variable_sans_egal_refuses_tous_a_la_fois_sans_requete", async () => {
  const m = monter(liste(PROD));
  await m.v.ouvrir();
  parNom("Ajouter un environnement").click();
  champDe("Nom").value = "  ";
  champDe("Variables").value = "SANS_EGAL";
  parNom("Enregistrer").click();
  const alertes = [...dlg().querySelectorAll("[role=alert]")].map((a) => a.textContent);
  expect(alertes).toEqual(["Donnez un nom à l'environnement.", "Variables : une par ligne, sous la forme NOM=valeur (lettres, chiffres et _ dans le nom)."]);
  expect(champDe("Nom").getAttribute("aria-invalid")).toBe("true");
  expect(champDe("Variables").getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(champDe("Nom"));
  expect(m.appels).toHaveLength(1);
});

test("REQ182_AC5_nom_de_variable_refuse_et_focus_dans_variables", async () => {
  for (const mauvaise of ["1A=x", "A B=x", "=x"]) {
    document.body.replaceChildren();
    const m = monter(liste(PROD));
    await m.v.ouvrir();
    parNom("Ajouter un environnement").click();
    champDe("Nom").value = "autre";
    champDe("Variables").value = `OK=1\n${mauvaise}`;
    parNom("Enregistrer").click();
    expect(dlg().querySelector("[role=alert]").textContent).toContain("Variables : une par ligne");
    expect(document.activeElement).toBe(champDe("Variables"));
    expect(m.appels).toHaveLength(1);
  }
});

test("REQ182_AC5_nom_deja_pris_sans_tenir_compte_de_la_casse_sauf_pour_soi_meme", async () => {
  const m = monter(liste(PROD), [liste(PROD)]);
  await m.v.ouvrir();
  parNom("Ajouter un environnement").click();
  champDe("Nom").value = "Prod";
  parNom("Enregistrer").click();
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Ce nom est déjà pris. Choisissez-en un autre.");
  expect(m.appels).toHaveLength(1);
  parNom("Annuler").click();
  // Modifier prod en `PROD` n'est pas un doublon : c'est lui-même.
  parNom("Modifier prod").click();
  champDe("Nom").value = "PROD";
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(m.appels).toHaveLength(2));
});

test("REQ182_AC5_refus_du_serveur_sous_son_champ", async () => {
  const m = monter(liste(), [rep({ champ: "nom", message: "Ce nom est déjà pris. Choisissez-en un autre." }, 400)]);
  await m.v.ouvrir();
  parNom("Ajouter un environnement").click();
  champDe("Nom").value = "x";
  champDe("Variables").value = "A=1";
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]")).not.toBeNull());
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Ce nom est déjà pris. Choisissez-en un autre.");
  expect(champDe("Variables").value).toBe("A=1");
  expect(document.activeElement).toBe(champDe("Nom"));
});

test("REQ182_AC8_illisible_message_detail_et_seul_fermer", async () => {
  const m = monter(rep({ fichier: FICHIER, cause: "illisible", message: "x", detail: "expected value at line 1 column 1" }, 409));
  await m.v.ouvrir();
  const d = dlg();
  expect(d.textContent).toContain(`${FICHIER} est illisible. Corrigez-le, puis rouvrez Environnements.`);
  expect(d.textContent).toContain("expected value at line 1 column 1");
  expect(bouts(d).map((b) => b.textContent)).toEqual(["Fermer"]);
  expect(d.querySelector("ul")).toBeNull();
  expect(document.activeElement).toBe(parNom("Fermer"));
  expect(ecritures(m.appels)).toEqual([]);
});

test("REQ182_AC12_lecture_coupure_et_impossible_comme_l_illisible", async () => {
  const a = monter("coupure");
  await a.v.ouvrir();
  expect(dlg().textContent).toContain("Connexion perdue. Réessayez au retour.");
  expect(bouts(dlg()).map((b) => b.textContent)).toEqual(["Fermer"]);
  document.body.replaceChildren();
  const b = monter(rep({ fichier: FICHIER, cause: "ecriture", message: "Permission denied." }, 500));
  await b.v.ouvrir();
  expect(dlg().textContent).toContain(`Impossible de lire ${FICHIER} : Permission denied.`);
  expect(bouts(dlg()).map((x) => x.textContent)).toEqual(["Fermer"]);
});

test("REQ182_AC12_coupure_a_l_ecriture_garde_la_saisie_dans_la_fiche", async () => {
  const m = monter(liste(), ["coupure"]);
  await m.v.ouvrir();
  parNom("Ajouter un environnement").click();
  champDe("Nom").value = "a";
  champDe("Variables").value = "B=1";
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(dlg().querySelector(".dialogue-resultat [role=alert]")).not.toBeNull());
  expect(dlg().querySelector(".dialogue-resultat [role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect([champDe("Nom").value, champDe("Variables").value]).toEqual(["a", "B=1"]);
  expect(parNom("Enregistrer").disabled).toBe(false);
});

test("REQ182_AC12_echec_d_ecriture_et_d_une_suppression", async () => {
  const m = monter(liste(PROD), [rep({ cause: "ecriture", message: "Permission denied." }, 500), "coupure"]);
  await m.v.ouvrir();
  parNom("Modifier prod").click();
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(dlg().querySelector(".dialogue-resultat [role=alert]")).not.toBeNull());
  expect(dlg().querySelector(".dialogue-resultat [role=alert]").textContent).toBe("Enregistrement impossible : Permission denied.");
  parNom("Annuler").click();
  parNom("Supprimer prod").click();
  bouts(dlg())[1].click();
  await vi.waitFor(() => expect(document.querySelectorAll("dialog")).toHaveLength(1));
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(document.activeElement).toBe(parNom("Supprimer prod"));
});

// ---- REQ-202 : case « Environnement par défaut » ----

const PROD_DEFAUT = { ...PROD, defaut: true };

test("REQ202_AC7_AC9_fiche_neuve_case_decochee_native_decrite_par_son_aide_et_ordre_de_tab", async () => {
  const m = monter(liste(PROD));
  await m.v.ouvrir();
  parNom("Ajouter un environnement").click();
  const c = champDe("Environnement par défaut");
  expect(c.type).toBe("checkbox");
  expect(c.checked).toBe(false);
  expect(c.disabled).toBe(false);
  expect(texteDe(c.getAttribute("aria-describedby"))).toBe("Sert quand vous lancez un shell, Claude ou opencode sans choisir d'environnement.");
  const ordre = [...dlg().querySelectorAll("input, textarea, button")].filter((e) => !e.disabled).map((e) => e.getAttribute("aria-label") ?? e.labels?.[0]?.textContent ?? e.textContent);
  expect(ordre.slice(0, 4)).toEqual(["Nom", "Variables", "Environnement par défaut", "Annuler"]);
  // Entrée sur la case ne fait rien ; Espace (clic natif) la coche.
  touche(c, "Enter");
  expect(m.appels).toHaveLength(1);
  c.click();
  expect(c.checked).toBe(true);
  c.click();
  expect(c.checked).toBe(false);
});

test("REQ202_AC1_AC9_modifier_l_environnement_par_defaut_case_cochee_active_et_enregistrement_envoie_defaut", async () => {
  const m = monter(liste(PROD_DEFAUT, DEV), [liste(PROD, { ...DEV, defaut: true })]);
  await m.v.ouvrir();
  parNom("Modifier prod").click();
  expect(champDe("Environnement par défaut").checked).toBe(true);
  expect(champDe("Environnement par défaut").disabled).toBe(false);
  parNom("Annuler").click();
  parNom("Modifier dev").click();
  const c = champDe("Environnement par défaut");
  expect(c.checked).toBe(false);
  c.click();
  parNom("Enregistrer").click();
  await vi.waitFor(() => expect(m.appels).toHaveLength(2));
  expect(m.appels[1].corps).toEqual({ ancien: "dev", nom: "dev", variables: { A: "1" }, defaut: true });
  await vi.waitFor(() => expect(document.querySelector("[role=status]")).not.toBeNull());
  expect([...document.querySelectorAll(".ya-objet-fin")].map((f) => f.closest("li").dataset.id)).toEqual(["dev"]);
});

test("REQ202_AC7_AC9_la_ligne_de_l_environnement_par_defaut_seule_finit_par_par_defaut", async () => {
  const m = monter(liste(PROD_DEFAUT, DEV));
  await m.v.ouvrir();
  const fins = [...document.querySelectorAll(".ya-objet-fin")];
  expect(fins.map((f) => f.textContent)).toEqual(["par défaut"]);
  expect(fins[0].closest("li").dataset.id).toBe("prod");
});

test("REQ202_AC10_suppression_de_l_environnement_par_defaut_ajoute_la_phrase_sinon_texte_inchange", async () => {
  const m = monter(liste(PROD_DEFAUT, DEV));
  await m.v.ouvrir();
  parNom("Supprimer prod").click();
  expect(dlg().textContent).toContain("Ses variables seront perdues. Ce qui est déjà lancé avec lui les garde. Il n'y aura plus d'environnement par défaut.");
  parNom("Annuler").click();
  parNom("Supprimer dev").click();
  const t = dlg().querySelector("p").textContent;
  expect(t).toBe("Ses variables seront perdues. Ce qui est déjà lancé avec lui les garde.");
});
