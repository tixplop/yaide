import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { saisieMessage } from "../vues/agent.js";
import { completion } from "./completion.js";

const lignesDe = (...noms) => noms.map((n) => ({ id: n, libelle: n, valeur: n, donnee: { n } }));
const attendre = () => new Promise((r) => setTimeout(r, 0));
let champ;

beforeEach(() => {
  champ = document.createElement("textarea");
  champ.getBoundingClientRect = () => ({ left: 10, right: 310, top: 400, bottom: 430, width: 300, height: 30 });
  document.body.append(champ);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const sources = (suggestions = { "/": async () => lignesDe("/review", "/init"), "@": async () => lignesDe("@src/main.rs", "@src/"), $: async () => lignesDe("$opencode") }) => ({
  "/": { nom: "Commandes", suggestions: suggestions["/"] ?? (async () => []) },
  "@": { nom: "Fichiers et dossiers", suggestions: suggestions["@"] ?? (async () => []) },
  $: { nom: "Skills", suggestions: suggestions.$ ?? (async () => []) },
});
const taper = async (texte, curseur = texte.length) => {
  champ.value = texte;
  champ.setSelectionRange(curseur, curseur);
  champ.dispatchEvent(new Event("input", { bubbles: true }));
  await attendre();
};
const touche = (key, extra = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  champ.dispatchEvent(e);
  return e;
};
const liste = () => document.querySelector(".ya-flottante");
const options = () => [...document.querySelectorAll('.ya-flottante [role="option"]')];

test("REQ089_AC2_slash_seulement_en_premier_caractere", async () => {
  completion({ champ, sources: sources() });
  await taper("voir src/");
  expect(liste()).toBeNull();
  await taper("a /b");
  expect(liste()).toBeNull();
  await taper("/");
  expect(options().map((o) => o.textContent)).toEqual(["/review", "/init"]);
});

test("REQ090_AC1_arobase_au_debut_apres_espace_ou_retour_ligne_pas_dans_un_mot", async () => {
  completion({ champ, sources: sources() });
  await taper("moi@exemple.org");
  expect(liste()).toBeNull();
  for (const t of ["@", "lis @", "lis\n@"]) {
    await taper(t);
    expect(options().length).toBe(2);
  }
  await taper("lis @", 5);
});

test("REQ091_AC1_dollar_au_debut_apres_espace_pas_apres_un_chiffre", async () => {
  completion({ champ, sources: sources() });
  await taper("5$");
  expect(liste()).toBeNull();
  await taper("$");
  expect(options().map((o) => o.textContent)).toEqual(["$opencode"]);
  await taper("a\n$o");
  expect(options().length).toBe(1);
});

test("REQ089_AC3_clavier_choix_clic_et_echap", async () => {
  const c = completion({ champ, sources: sources() });
  await taper("/re");
  expect(options()[0].classList.contains("liste-courante")).toBe(true);
  touche("ArrowDown");
  expect(options()[1].classList.contains("liste-courante")).toBe(true);
  touche("ArrowDown");
  expect(options()[1].classList.contains("liste-courante")).toBe(true);
  touche("ArrowUp");
  const entree = touche("Enter");
  expect(entree.defaultPrevented).toBe(true);
  expect(champ.value).toBe("/review ");
  expect(champ.selectionStart).toBe(8);
  expect(liste()).toBeNull();
  expect(c.joints()).toEqual([{ declencheur: "/", valeur: "/review", donnee: { n: "/review" }, start: 0, end: 7, text: "/review" }]);
  // Tab
  await taper("/re");
  touche("ArrowDown");
  const tab = touche("Tab");
  expect(tab.defaultPrevented).toBe(true);
  expect(champ.value).toBe("/init ");
  // Clic
  await taper("/re");
  const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
  options()[1].dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  expect(champ.value).toBe("/init ");
  expect(liste()).toBeNull();
  expect(champ.selectionStart).toBe(6);
  // Échap
  await taper("/re");
  const surParent = vi.fn();
  document.body.addEventListener("keydown", surParent);
  const echap = touche("Escape");
  expect(surParent).not.toHaveBeenCalled();
  document.body.removeEventListener("keydown", surParent);
  expect(echap.defaultPrevented).toBe(true);
  expect(champ.value).toBe("/re");
  expect(liste()).toBeNull();
  // Rouverte au caractère suivant dans ce mot
  await taper("/rev");
  expect(options().length).toBe(2);
});

test("REQ089_AC4_fermeture_espace_curseur_declencheur_efface_et_blur", async () => {
  completion({ champ, sources: sources() });
  await taper("/re");
  await taper("/re ");
  expect(liste()).toBeNull();
  await taper("/re");
  champ.setSelectionRange(0, 0);
  champ.dispatchEvent(new KeyboardEvent("keyup", { key: "Home", bubbles: true }));
  expect(liste()).toBeNull();
  await taper("/re");
  await taper("re");
  expect(liste()).toBeNull();
  await taper("/re");
  champ.dispatchEvent(new FocusEvent("blur"));
  expect(liste()).toBeNull();
  expect(champ.getAttribute("aria-expanded")).toBe("false");
});

test("REQ089_AC10_aria_du_champ", async () => {
  completion({ champ, sources: sources() });
  expect(champ.getAttribute("aria-autocomplete")).toBe("list");
  expect(champ.getAttribute("aria-expanded")).toBe("false");
  expect(champ.hasAttribute("aria-activedescendant")).toBe(false);
  await taper("/");
  const lb = liste().querySelector('[role="listbox"]');
  expect(lb.getAttribute("aria-label")).toBe("Commandes");
  expect(champ.getAttribute("aria-expanded")).toBe("true");
  expect(champ.getAttribute("aria-controls")).toBe(lb.id);
  expect(champ.getAttribute("aria-activedescendant")).toBe(options()[0].id);
  touche("Escape");
  expect(champ.getAttribute("aria-expanded")).toBe("false");
  expect(champ.hasAttribute("aria-activedescendant")).toBe(false);
});

test("REQ089_AC13_tab_echap_maj_entree_et_sans_suggestion", async () => {
  const c = completion({ champ, sources: sources({ "/": async () => ({ message: "Aucune commande." }) }) });
  await taper("/");
  expect(c.retenirEntree()).toBe(false);
  expect(touche("Tab").defaultPrevented).toBe(false);
  expect(touche("Enter").defaultPrevented).toBe(false);
  expect(touche("Escape").defaultPrevented).toBe(true);
  expect(liste()).toBeNull();

});

test("REQ089_AC13_maj_entree_ferme_la_liste_et_entree_n_envoie_pas", async () => {
  const surEnvoi = vi.fn();
  let c;
  const { texteSaisi } = saisieMessage({ libelle: "Message", surEnvoi, retenirEntree: () => c.retenirEntree() });
  document.body.append(texteSaisi);
  texteSaisi.getBoundingClientRect = champ.getBoundingClientRect;
  c = completion({ champ: texteSaisi, sources: sources() });
  texteSaisi.value = "/re";
  texteSaisi.setSelectionRange(3, 3);
  texteSaisi.dispatchEvent(new Event("input", { bubbles: true }));
  await attendre();
  expect(c.retenirEntree()).toBe(true);
  texteSaisi.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  expect(surEnvoi).not.toHaveBeenCalled();
  expect(texteSaisi.value).toBe("/review ");
  // Liste fermée : Entrée envoie.
  texteSaisi.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  expect(surEnvoi).toHaveBeenCalledTimes(1);
  // Maj+Entrée ferme
  texteSaisi.value = "/re";
  texteSaisi.setSelectionRange(3, 3);
  texteSaisi.dispatchEvent(new Event("input", { bubbles: true }));
  await attendre();
  expect(liste()).not.toBeNull();
  texteSaisi.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
  expect(liste()).toBeNull();
  expect(surEnvoi).toHaveBeenCalledTimes(1);
});

test("REQ089_AC14_chargement_apres_200_ms_seulement", async () => {
  vi.useFakeTimers();
  let resoudre;
  completion({ champ, sources: sources({ "/": () => new Promise((r) => (resoudre = r)) }) });
  champ.value = "/";
  champ.setSelectionRange(1, 1);
  champ.dispatchEvent(new Event("input", { bubbles: true }));
  vi.advanceTimersByTime(199);
  expect(liste()).toBeNull();
  expect(champ.getAttribute("aria-expanded")).toBe("false");
  vi.advanceTimersByTime(2);
  const m = liste().querySelector('[role="status"]');
  expect(m.textContent).toBe("Chargement…");
  expect(champ.getAttribute("aria-expanded")).toBe("true");
  expect(champ.hasAttribute("aria-activedescendant")).toBe(false);
  resoudre(lignesDe("/review"));
  await vi.advanceTimersByTimeAsync(0);
  expect(options().length).toBe(1);
  expect(liste().querySelector('[role="status"]')).toBeNull();
});

test("REQ089_AC14_messages_et_liste_indisponible_en_status", async () => {
  completion({ champ, sources: sources({ "/": async () => ({ message: "Aucune commande ne correspond." }), "@": async () => { throw new Error("x"); } }) });
  await taper("/zz");
  expect(liste().querySelector('[role="status"]').textContent).toBe("Aucune commande ne correspond.");
  await taper("@a");
  expect(liste().querySelector('[role="status"]').textContent).toBe("Liste indisponible pour l'instant.");
  expect(champ.getAttribute("aria-expanded")).toBe("true");
});

test("REQ090_AC5_choix_efface_ou_modifie_n_est_plus_joint", async () => {
  const c = completion({ champ, sources: sources() });
  await taper("Lis @s");
  touche("Enter");
  expect(champ.value).toBe("Lis @src/main.rs ");
  expect(c.joints().map((j) => [j.declencheur, j.valeur, j.start, j.end, j.text])).toEqual([["@", "@src/main.rs", 4, 16, "@src/main.rs"]]);
  // Texte avant modifié : la place est recalculée.
  champ.value = "Alors lis @src/main.rs ";
  expect(c.joints()[0].start).toBe(10);
  // Modifié
  await taper("Lis @src/main.rsx ");
  expect(c.joints()).toEqual([]);
  await taper("Lis @src/main.rs ");
  expect(c.joints()).toEqual([]);
  // Tapé à la main
  const c2 = completion({ champ: document.body.appendChild(document.createElement("textarea")), sources: sources() });
  expect(c2.joints()).toEqual([]);
});

test("REQ090_AC5_REQ091_AC4_champ_vide_par_le_code_puis_retape_a_la_main", async () => {
  const c = completion({ champ, sources: sources() });
  await taper("$o");
  touche("Enter");
  await taper("$opencode @s");
  touche("Enter");
  expect(c.joints().length).toBe(2);
  champ.value = "";
  await taper("$opencode @src/main.rs ");
  expect(c.joints()).toEqual([]);
});

test("REQ091_AC4_skill_efface_modifie_ou_tape_a_la_main_pas_joint", async () => {
  const c = completion({ champ, sources: sources() });
  await taper("$o");
  touche("Enter");
  expect(c.joints().map((j) => j.text)).toEqual(["$opencode"]);
  await taper("$opencod ");
  expect(c.joints()).toEqual([]);
  await taper("$opencode comment ?");
  expect(c.joints()).toEqual([]);
});

test("REQ090_AC7_reponse_depassee_ignoree", async () => {
  const attentes = {};
  completion({ champ, sources: sources({ "@": (t) => new Promise((r) => (attentes[t] = r)) }) });
  await taper("@m");
  await taper("@ma");
  attentes.ma(lignesDe("@tard-ma"));
  await attendre();
  attentes.m(lignesDe("@vieux-m"));
  await attendre();
  expect(options().map((o) => o.textContent)).toEqual(["@tard-ma"]);
});

test("REQ090_AC11_nouvelle_recherche_garde_les_lignes_sans_chargement", async () => {
  vi.useFakeTimers();
  const attentes = {};
  completion({ champ, sources: sources({ "@": (t) => new Promise((r) => (attentes[t] = r)) }) });
  const saisir = (t) => {
    champ.value = t;
    champ.setSelectionRange(t.length, t.length);
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  };
  saisir("@ma");
  attentes.ma(lignesDe("@main.rs"));
  await vi.advanceTimersByTimeAsync(0);
  saisir("@mai");
  await vi.advanceTimersByTimeAsync(500);
  expect(options().map((o) => o.textContent)).toEqual(["@main.rs"]);
  expect(liste().querySelector('[role="status"]')).toBeNull();
  attentes.mai(lignesDe("@main.rs", "@mail.js"));
  await vi.advanceTimersByTimeAsync(0);
  expect(options().length).toBe(2);
});
