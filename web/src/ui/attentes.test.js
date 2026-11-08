import { beforeEach, expect, test, vi } from "vitest";
import { attentes } from "./attentes.js";
import { attentes as depuisConversation } from "./conversation.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

const vider = () => new Promise((r) => setTimeout(r, 0));
const monter = (demandes, rappels = {}) => {
  const r = attentes({ demandes, ...rappels });
  document.body.append(r);
  return r;
};
const autorisation = (o = {}) => ({ type: "autorisation", id: "per_1", action: "shell", ressources: ["cargo test parse_args"], ...o });
const question = (champs, o = {}) => ({ type: "question", id: "frm_1", titre: "Préparer la release", champs, ...o });
const boutons = (el) => [...el.querySelectorAll("button")];
const parNom = (el, nom) => boutons(el).find((b) => b.textContent === nom);
const saisir = (input, valeur) => {
  input.value = valeur;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

test("REQ072_AC24_autorisation_textes_ordre_role_alert_sans_focus", () => {
  const r = monter([autorisation(), autorisation({ id: "per_2", sousAgent: "explore", action: "read", ressources: ["a.rs", "b.rs"] })]);
  expect(depuisConversation).toBe(attentes);
  expect(r.getAttribute("role")).toBe("region");
  expect(r.getAttribute("aria-label")).toBe("Demandes d'opencode");
  const [a, b] = r.querySelectorAll(".message");
  expect(a.getAttribute("role")).toBe("alert");
  expect(a.classList.contains("message-alerte")).toBe(true);
  expect(a.querySelector(".message-texte").textContent).toBe("opencode demande une autorisation : shell.");
  expect(b.querySelector(".message-texte").textContent).toBe("Le sous-agent explore demande une autorisation : read.");
  expect(a.querySelector(".message-detail").textContent).toBe("cargo test parse_args");
  expect(b.querySelector(".message-detail").textContent).toBe("a.rs\nb.rs");
  expect(boutons(a).map((x) => x.textContent)).toEqual(["Autoriser une fois", "Toujours autoriser", "Refuser"]);
  for (const x of boutons(a)) expect(x.className).toContain("bouton-secondaire");
  expect(document.activeElement).toBe(document.body);
});

test("REQ072_AC24_les_demandes_gardent_l_ordre_d_arrivee_et_leur_saisie", () => {
  const r = monter([autorisation({ id: "a" }), question([{ key: "v", type: "string" }], { id: "b" })]);
  saisir(r.querySelector("input"), "1.2");
  r.mettreAJour([autorisation({ id: "a" }), question([{ key: "v", type: "string" }], { id: "b" }), autorisation({ id: "c" })]);
  expect([...r.children].length).toBe(3);
  expect(r.querySelector("input").value).toBe("1.2");
  r.mettreAJour([autorisation({ id: "c" }), question([{ key: "v", type: "string" }], { id: "b" })]);
  expect(r.children).toHaveLength(2);
  expect(r.children[0].querySelector(".message-alerte")).not.toBeNull();
  expect(r.querySelector("input").value).toBe("1.2");
});

test("REQ072_AC24_chaque_bouton_repond_avec_sa_decision", async () => {
  for (const [nom, decision] of [["Autoriser une fois", "once"], ["Toujours autoriser", "always"], ["Refuser", "reject"]]) {
    document.body.innerHTML = "";
    const surAutorisation = vi.fn().mockResolvedValue({ donnees: null });
    const r = monter([autorisation()], { surAutorisation });
    parNom(r, nom).click();
    await vider();
    expect(surAutorisation).toHaveBeenCalledWith("per_1", decision);
  }
});

const TOUS = [
  { key: "version", title: "Version", description: "Numéro à publier.", required: true, type: "string", placeholder: "1.2.3" },
  { key: "canal", title: "Canal", type: "string", default: "beta", options: [{ value: "stable", label: "Stable" }, { value: "beta", label: "Bêta" }] },
  { key: "taille", title: "Taille", type: "integer", minimum: 1, maximum: 10 },
  { key: "ratio", type: "number", default: 1.5 },
  { key: "notes", title: "Notes publiées", type: "boolean", default: true },
  { key: "cibles", title: "Cibles", type: "multiselect", options: [{ value: "linux", label: "Linux" }, { value: "macos", label: "macOS" }], default: ["macos"] },
  { key: "doc", type: "external", url: "https://example.com/doc", title: "Documentation" },
  { key: "secret", type: "string", hidden: true },
];

test("REQ072_AC9_question_un_champ_par_type", () => {
  const r = monter([question(TOUS)]);
  const f = r.querySelector("form");
  expect(f.getAttribute("role")).toBe("group");
  expect(f.getAttribute("aria-label")).toBe("opencode pose une question : Préparer la release.");
  expect(f.querySelector(".message-texte").textContent).toBe("opencode pose une question : Préparer la release.");
  const champs = [...f.querySelector(".message-champs").children];
  expect(champs).toHaveLength(7); // le champ caché n'y est pas
  const [version, canal, taille, ratio, notes, cibles, doc] = champs;
  expect(version.querySelector("label").textContent).toBe("Version (obligatoire)");
  expect(version.querySelector("input").placeholder).toBe("1.2.3");
  expect(version.querySelector(".champ-aide").textContent).toBe("Numéro à publier.");
  // string à options : option vide absente si requis, présente sinon ; valeur de départ = default
  expect([...canal.querySelectorAll("option")].map((o) => [o.value, o.textContent])).toEqual([["", ""], ["stable", "Stable"], ["beta", "Bêta"]]);
  expect(canal.querySelector("select").value).toBe("beta");
  expect(canal.querySelector("label").textContent).toBe("Canal");
  expect(taille.querySelector("input").getAttribute("inputmode")).toBe("numeric");
  expect(ratio.querySelector("label").textContent).toBe("ratio");
  expect(ratio.querySelector("input").getAttribute("inputmode")).toBe("decimal");
  expect(ratio.querySelector("input").value).toBe("1.5");
  expect(notes.querySelector("input").type).toBe("checkbox");
  expect(notes.querySelector("input").checked).toBe(true);
  expect(cibles.tagName).toBe("FIELDSET");
  expect(cibles.querySelector("legend").textContent).toBe("Cibles");
  expect([...cibles.querySelectorAll("input")].map((i) => [i.type, i.value, i.checked])).toEqual([["checkbox", "linux", false], ["checkbox", "macos", true]]);
  const lien = doc.querySelector("a");
  expect(lien.textContent).toBe("Documentation");
  expect(lien.getAttribute("href")).toBe("https://example.com/doc");
  expect(lien.target).toBe("_blank");
  expect(lien.rel).toBe("noopener noreferrer");
  expect(doc.querySelector(".champ-aide").textContent).toBe("S'ouvre dans un nouvel onglet du navigateur.");
  expect(boutons(f).map((b) => b.textContent)).toEqual(["Ignorer", "Répondre"]);
  expect(document.activeElement).toBe(document.body);
});

test("REQ072_AC9_liste_requise_sans_option_vide_et_lien_sans_titre", () => {
  const r = monter([question([{ key: "c", type: "string", required: true, options: [{ value: "a", label: "A" }] }, { key: "u", type: "external", url: "https://x.test/" }])]);
  expect([...r.querySelectorAll("option")].map((o) => o.value)).toEqual(["a"]);
  expect(r.querySelector("a").textContent).toBe("https://x.test/");
});

test("REQ072_AC9_champ_dont_le_when_n_est_pas_rempli_est_masque_puis_montre", () => {
  const r = monter([
    question([
      { key: "mode", type: "string", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" },
      { key: "detail", title: "Détail", type: "string", when: [{ key: "mode", op: "eq", value: "b" }] },
      { key: "autre", title: "Autre", type: "string", when: [{ key: "mode", op: "neq", value: "b" }] },
    ]),
  ]);
  const [, detail, autre] = r.querySelector(".message-champs").children;
  expect([detail.hidden, autre.hidden]).toEqual([true, false]);
  const s = r.querySelector("select");
  s.value = "b";
  s.dispatchEvent(new Event("change", { bubbles: true }));
  expect([detail.hidden, autre.hidden]).toEqual([false, true]);
});

test("REQ072_AC26_validation_messages_et_focus", async () => {
  const surReponse = vi.fn();
  const champs = [
    { key: "version", title: "Version", required: true, type: "string", minLength: 3, maxLength: 5 },
    { key: "n", title: "N", type: "number" },
    { key: "i", title: "I", type: "integer" },
    { key: "t", title: "T", type: "integer", minimum: 1, maximum: 10 },
    { key: "cibles", type: "multiselect", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }], minItems: 2, maxItems: 2 },
  ];
  const r = monter([question(champs)], { surReponse });
  const lancer = () => {
    parNom(r, "Répondre").click();
    return vider();
  };
  const erreurs = () => [...r.querySelectorAll(".champ-erreur")].map((e) => e.textContent);
  const entrees = () => [...r.querySelectorAll("input[type=text]")];

  await lancer();
  expect(erreurs()).toEqual(["Ce champ est obligatoire."]);
  const v = r.querySelector("input");
  expect(v.getAttribute("aria-invalid")).toBe("true");
  expect(v.getAttribute("aria-describedby")).toBeTruthy();
  expect(document.activeElement).toBe(v);
  expect(surReponse).not.toHaveBeenCalled();
  expect(parNom(r, "Répondre").disabled).toBe(false);

  saisir(entrees()[0], "ab");
  await lancer();
  expect(erreurs()).toEqual(["Ce champ attend au moins 3 caractères."]);
  expect(entrees()[0].value).toBe("ab"); // saisie gardée

  saisir(entrees()[0], "abcdef");
  saisir(entrees()[1], "abc");
  saisir(entrees()[2], "1.5");
  saisir(entrees()[3], "11");
  r.querySelector("input[type=checkbox]").click();
  await lancer();
  expect(erreurs()).toEqual(["Ce champ attend au plus 5 caractères.", "Saisissez un nombre.", "Saisissez un nombre entier.", "Saisissez un nombre entre 1 et 10.", "Choisissez au moins 2 options."]);
  expect(document.activeElement).toBe(entrees()[0]);
  expect(r.querySelectorAll("[aria-invalid=true]")).toHaveLength(7); // 4 champs + les 3 cases

  const cases = r.querySelectorAll("fieldset input");
  cases[1].click();
  cases[2].click();
  await lancer();
  expect(erreurs()).toContain("Choisissez au plus 2 options.");
  expect(surReponse).not.toHaveBeenCalled();

  // Corrigé : plus d'erreur, la réponse part avec les types attendus.
  r.querySelectorAll("fieldset input")[2].click(); // le champ a été reconstruit avec son erreur
  saisir(entrees()[0], "1.2.3");
  saisir(entrees()[1], "2,5");
  saisir(entrees()[2], "3");
  saisir(entrees()[3], "4");
  surReponse.mockResolvedValue({ donnees: null });
  await lancer();
  expect(erreurs()).toEqual([]);
  expect(r.querySelectorAll("[aria-invalid]")).toHaveLength(0);
  expect(surReponse).toHaveBeenCalledWith("frm_1", { version: "1.2.3", n: 2.5, i: 3, t: 4, cibles: ["a", "b"] });
});

test("REQ072_AC26_la_reponse_omet_les_vides_et_les_champs_masques", async () => {
  const surReponse = vi.fn().mockResolvedValue({ donnees: null });
  const r = monter(
    [
      question([
        { key: "a", type: "string" },
        { key: "canal", type: "string", options: [{ value: "x", label: "X" }] },
        { key: "ok", type: "boolean" },
        { key: "doc", type: "external", url: "https://e.test/" },
        { key: "m", type: "string", when: [{ key: "ok", op: "eq", value: true }], required: true },
        { key: "h", type: "string", hidden: true, required: true },
      ]),
    ],
    { surReponse },
  );
  parNom(r, "Répondre").click();
  await vider();
  expect(surReponse).toHaveBeenCalledWith("frm_1", { ok: false, doc: true });
});

test("REQ072_AC26_entree_n_envoie_pas", async () => {
  const surReponse = vi.fn();
  const r = monter([question([{ key: "a", type: "string" }])], { surReponse });
  const input = r.querySelector("input");
  input.focus();
  const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  r.querySelector("form").requestSubmit?.();
  await vider();
  expect(ev.defaultPrevented).toBe(true);
  expect(surReponse).not.toHaveBeenCalled();
});

test("REQ072_ignorer_appelle_surIgnorer_sans_validation", async () => {
  const surIgnorer = vi.fn().mockResolvedValue({ donnees: null });
  const r = monter([question([{ key: "a", type: "string", required: true }])], { surIgnorer });
  parNom(r, "Ignorer").click();
  await vider();
  expect(surIgnorer).toHaveBeenCalledWith("frm_1");
  expect(r.querySelector(".champ-erreur")).toBeNull();
});

test("REQ072_envoi_en_cours_puis_echec_saisie_gardee", async () => {
  let fin;
  const surReponse = vi.fn(() => new Promise((res) => (fin = res)));
  const r = monter([question([{ key: "a", title: "A", type: "string" }])], { surReponse });
  saisir(r.querySelector("input"), "bonjour");
  parNom(r, "Répondre").click();
  await vider();
  const encours = boutons(r);
  expect(encours.map((b) => b.textContent)).toEqual(["Ignorer", "Envoi…"]);
  expect(encours.every((b) => b.disabled)).toBe(true);

  fin({ erreur: "formulaire expiré" });
  await vider();
  expect(boutons(r).map((b) => [b.textContent, b.disabled])).toEqual([["Ignorer", false], ["Répondre", false]]);
  const e = r.querySelector(".ya-attente > .message-erreur");
  expect(e.textContent).toBe("Réponse impossible : formulaire expiré.");
  // sous les boutons, hors du formulaire
  expect(r.querySelector("form").contains(e)).toBe(false);
  expect(r.querySelector("input").value).toBe("bonjour");

  surReponse.mockResolvedValueOnce({ coupure: true });
  parNom(r, "Répondre").click();
  await vider();
  expect(r.querySelectorAll(".ya-attente > .message-erreur")).toHaveLength(1);
  expect(r.querySelector(".ya-attente > .message-erreur").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(r.querySelector("input").value).toBe("bonjour");

  // Réussite : le bouton reste en cours, la demande disparaît à la mise à jour.
  surReponse.mockResolvedValueOnce({ donnees: null });
  parNom(r, "Répondre").click();
  await vider();
  expect(r.querySelector(".message-erreur")).toBeNull();
  expect(parNom(r, "Envoi…").disabled).toBe(true);
  r.mettreAJour([]);
  expect(r.children).toHaveLength(0);
});

test("REQ072_autorisation_envoi_en_cours_et_echec", async () => {
  const surAutorisation = vi.fn().mockResolvedValue({ erreur: "refusé" });
  const r = monter([autorisation()], { surAutorisation });
  parNom(r, "Refuser").click();
  expect(boutons(r).map((b) => [b.textContent, b.disabled])).toEqual([["Autoriser une fois", true], ["Toujours autoriser", true], ["Envoi…", true]]);
  await vider();
  expect(boutons(r).every((b) => !b.disabled)).toBe(true);
  expect(r.querySelector(".message-erreur").textContent).toBe("Réponse impossible : refusé.");
});

test("REQ072_AC9_lien_external_seulement_http_et_https", () => {
  const r = monter([question([
    { key: "a", type: "external", url: "javascript:alert(1)", title: "Pirate" },
    { key: "b", type: "external", url: "data:text/html,x", title: "Donnée" },
    { key: "c", type: "external", url: "http://e.test/", title: "Web" },
  ])]);
  expect([...r.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Web"]);
  expect(r.querySelector(".message-champs").textContent).toContain("javascript:alert(1)");
});

test("REQ072_AC26_ancienne_erreur_d_envoi_retiree_quand_la_validation_echoue", async () => {
  const surReponse = vi.fn().mockResolvedValue({ erreur: "x" });
  const r = monter([question([{ key: "a", type: "string", required: true }])], { surReponse });
  saisir(r.querySelector("input"), "v");
  parNom(r, "Répondre").click();
  await vider();
  expect(r.querySelector(".ya-attente > .message-erreur")).not.toBeNull();
  saisir(r.querySelector("input"), "");
  parNom(r, "Répondre").click();
  await vider();
  expect(r.querySelector(".ya-attente > .message-erreur")).toBeNull();
});

test("REQ072_AC9_when_vers_un_champ_cache_utilise_sa_valeur_de_depart", () => {
  const r = monter([question([
    { key: "h", type: "string", hidden: true, default: "oui" },
    { key: "d", title: "D", type: "string", when: [{ key: "h", op: "eq", value: "oui" }] },
  ])]);
  expect(r.querySelector(".message-champs").firstElementChild.hidden).toBe(false);
});
