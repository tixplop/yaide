import { expect, test, beforeEach, vi, afterEach } from "vitest";
import { panneauRecherche, chercherTexte, marquerOccurrences, retirerMarques, remplacerTexte } from "./panneau-recherche.js";

beforeEach(() => (document.body.innerHTML = ""));
afterEach(() => vi.useRealTimers());

function monter() {
  const appels = [];
  const p = panneauRecherche({
    nom: "clients.csv",
    surTexte: (t) => appels.push(["texte", t]),
    surSuivante: () => appels.push("suivante"),
    surPrecedente: () => appels.push("precedente"),
    surFermer: () => appels.push("fermer"),
    surOptions: (o) => appels.push(["options", o]),
    surRemplacer: (t) => appels.push(["remplacer", t]),
    surToutRemplacer: (t) => appels.push(["tout", t]),
  });
  document.body.append(p.element);
  return { p, appels };
}
const touche = (cible, key, init = {}) => cible.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));

test("REQ160_AC9_structure_noms_et_ordre", () => {
  const { p } = monter();
  const el = p.element;
  expect(el.getAttribute("role")).toBe("search");
  expect(el.getAttribute("aria-label")).toBe("Rechercher dans clients.csv");
  const champ = el.querySelector("input");
  expect(champ.getAttribute("aria-label") ?? el.querySelector("label")?.textContent).toBe("Rechercher dans le fichier");
  expect(champ.getAttribute("placeholder")).toBe("Rechercher");
  const ordre = [...el.querySelectorAll("input, .ya-recherche-compteur, button")].map((n) => n.tagName === "INPUT" ? "champ" : n.className.includes("compteur") ? "compteur" : n.getAttribute("aria-label"));
  expect(ordre).toEqual(["champ", "Respecter la casse", "Expression régulière", "compteur", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  const raccourcis = [...el.querySelectorAll("button")].map((b) => b.getAttribute("aria-keyshortcuts"));
  expect(raccourcis).toEqual([null, null, "Shift+F3", "F3", "Escape"]);
  vi.useFakeTimers();
  const attendus = ["Respecter la casse", "Expression régulière", "Occurrence précédente (Maj+F3)", "Occurrence suivante (F3)", "Fermer la recherche (Échap)"];
  [...el.querySelectorAll("button")].forEach((b, i) => {
    b.parentElement.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(500);
    expect(document.querySelector(".info-bulle").textContent).toBe(attendus[i]);
    b.parentElement.dispatchEvent(new Event("pointerleave"));
  });
});

test("REQ160_AC9_etats_aria_disabled_compteur_et_zone_status", () => {
  const { p } = monter();
  const el = p.element;
  const fleches = [...el.querySelectorAll('button[aria-label^="Occurrence"]')];
  const statut = el.querySelector('[role="status"]');
  p.afficher(0, undefined);
  expect(fleches.every((b) => b.getAttribute("aria-disabled") === "true")).toBe(true);
  expect(statut.textContent).toBe("");
  el.querySelector("input").value = "a";
  p.afficher(3, undefined);
  expect(fleches.some((b) => b.hasAttribute("aria-disabled"))).toBe(false);
  expect(statut.textContent).toBe("3 occurrences");
  expect(el.querySelector(".ya-recherche-compteur").textContent).toBe("3");
  p.afficher(3, 1);
  expect(statut.textContent).toBe("Occurrence 1 sur 3");
  expect(el.querySelector(".ya-recherche-compteur").textContent).toBe("1 sur 3");
  p.afficher(1, undefined);
  expect(statut.textContent).toBe("1 occurrence");
  p.afficher(0, undefined);
  expect(statut.textContent).toBe("Aucune occurrence");
  expect(fleches.every((b) => b.getAttribute("aria-disabled") === "true")).toBe(true);
  p.definirTexte("");
  p.afficher(0);
  expect(el.querySelector(".ya-recherche-compteur").textContent).toBe("");
  expect(p.texte()).toBe("");
});

test("REQ160_AC9_touches_et_boutons_appellent_les_rappels", () => {
  const { p, appels } = monter();
  const champ = p.element.querySelector("input");
  champ.value = "ab";
  champ.dispatchEvent(new Event("input", { bubbles: true }));
  expect(appels.pop()).toEqual(["texte", "ab"]);
  p.afficher(2);
  touche(champ, "Enter");
  touche(champ, "Enter", { shiftKey: true });
  touche(champ, "F3");
  touche(champ, "F3", { shiftKey: true });
  expect(appels).toEqual(["suivante", "precedente", "suivante", "precedente"]);
  appels.length = 0;
  p.element.querySelector('button[aria-label="Occurrence suivante"]').click();
  p.element.querySelector('button[aria-label="Occurrence précédente"]').click();
  p.element.querySelector('button[aria-label="Fermer la recherche"]').click();
  touche(champ, "Escape");
  expect(appels).toEqual(["suivante", "precedente", "fermer", "fermer"]);
});

test("REQ160_AC9_ouvrir_met_le_focus_et_selectionne_le_texte", () => {
  const { p } = monter();
  p.definirTexte("abc");
  p.ouvrir();
  const champ = p.element.querySelector("input");
  expect(document.activeElement).toBe(champ);
  expect([champ.selectionStart, champ.selectionEnd]).toEqual([0, 3]);
  expect(p.texte()).toBe("abc");
});

test("REQ160_AC2_chercher_texte_sans_casse_sans_chevauchement", () => {
  expect(chercherTexte("Alice", "a")).toEqual([[0, 1]]);
  expect(chercherTexte("Paris", "A")).toEqual([[1, 2]]);
  expect(chercherTexte("aaaa", "aa")).toEqual([[0, 2], [2, 4]]);
  expect(chercherTexte("Alice", "")).toEqual([]);
  expect(chercherTexte("Alice", "zzz")).toEqual([]);
});

test("REQ161_AC2_marquer_une_marque_par_noeud_styles_gardes_et_retrait", () => {
  const el = document.createElement("div");
  el.innerHTML = "<b>Ser</b><i>veur</i> web";
  document.body.append(el);
  const avant = el.innerHTML;
  marquerOccurrences(el, "serveur");
  const marques = [...el.querySelectorAll("mark.ya-occurrence")];
  expect(marques.map((m) => m.textContent)).toEqual(["Ser", "veur"]);
  expect(marques[0].parentElement.tagName).toBe("B");
  expect(marques[1].parentElement.tagName).toBe("I");
  expect(el.textContent).toBe("Serveur web");
  expect(el.querySelector(".ya-occurrence-courante")).toBeNull();
  retirerMarques(el);
  expect(el.innerHTML).toBe(avant);
  marquerOccurrences(el, "Serveur", { courante: true });
  expect(el.querySelectorAll("mark.ya-occurrence-courante")).toHaveLength(2);
  retirerMarques(el);
  expect(el.innerHTML).toBe(avant);
  marquerOccurrences(el, "e");
  expect(el.querySelectorAll("mark")).toHaveLength(3);
  retirerMarques(el);
  expect(el.innerHTML).toBe(avant);
});

const champRemplacer = (p) => [...p.element.querySelectorAll("input")].find((i) => i.labels[0]?.textContent === "Remplacer par") ?? null;
const bascules = (p) => [...p.element.querySelectorAll("button[aria-pressed]")];
const infobulle = (b) => {
  b.parentElement.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(500);
  const t = document.querySelector(".info-bulle").textContent;
  b.parentElement.dispatchEvent(new Event("pointerleave"));
  return t;
};

test("REQ206_AC7_bascules_noms_aria_pressed_info_bulles_focus_et_rappel", () => {
  const { p, appels } = monter();
  const [casse, regex] = bascules(p);
  expect(casse.getAttribute("aria-label")).toBe("Respecter la casse");
  expect(regex.getAttribute("aria-label")).toBe("Expression régulière");
  expect([casse, regex].map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
  expect(p.options()).toEqual({ casse: false, regex: false });
  vi.useFakeTimers();
  expect([casse, regex].map(infobulle)).toEqual(["Respecter la casse", "Expression régulière"]);
  vi.useRealTimers();
  casse.focus();
  casse.click();
  expect(casse.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(casse);
  expect(appels.pop()).toEqual(["options", { casse: true, regex: false }]);
  regex.click();
  expect(appels.pop()).toEqual(["options", { casse: true, regex: true }]);
  casse.click();
  expect(appels.pop()).toEqual(["options", { casse: false, regex: true }]);
  expect(casse.getAttribute("aria-pressed")).toBe("false");
  expect(p.options()).toEqual({ casse: false, regex: true });
});

test("REQ206_AC7_REQ159_AC12_REQ160_AC9_ordre_de_tab_des_cinq_boutons", () => {
  const { p } = monter();
  const tabulables = [...p.element.querySelectorAll("input, button")].map((n) => (n.tagName === "INPUT" ? "champ" : n.getAttribute("aria-label")));
  expect(tabulables).toEqual(["champ", "Respecter la casse", "Expression régulière", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  expect([...p.element.querySelectorAll("input, button")].every((n) => n.tabIndex === 0)).toBe(true);
});

test("REQ206_AC3_REQ206_AC8_expression_invalide_champ_compteur_fleches_et_status", () => {
  const { p } = monter();
  const el = p.element;
  const champ = el.querySelector("input");
  champ.value = "(";
  p.afficher(0, undefined, { invalide: true });
  expect(champ.getAttribute("aria-invalid")).toBe("true");
  expect(el.querySelector(".ya-recherche-compteur").textContent).toBe("Invalide");
  expect(el.querySelector(".ya-occ-invalide")).not.toBeNull();
  expect(el.querySelector('[role="status"]').textContent).toBe("Expression régulière invalide");
  expect([...el.querySelectorAll('button[aria-label^="Occurrence"]')].every((b) => b.getAttribute("aria-disabled") === "true")).toBe(true);
  champ.value = "(Y)";
  p.afficher(3, undefined);
  expect(champ.hasAttribute("aria-invalid")).toBe(false);
  expect(el.querySelector(".ya-recherche-compteur").textContent).toBe("3");
  expect(el.querySelector(".ya-occ-invalide")).toBeNull();
  expect(el.querySelector('[role="status"]').textContent).toBe("3 occurrences");
});

test("REQ206_AC1_chercher_texte_casse", () => {
  expect(chercherTexte("Yaide yaide", "Yaide", { casse: true })).toEqual([[0, 5]]);
  expect(chercherTexte("Yaide yaide", "Yaide")).toEqual([[0, 5], [6, 11]]);
});

test("REQ206_AC2_chercher_texte_regex_sans_partie_vide_et_debut_du_texte_donne", () => {
  expect(chercherTexte("Yaide 1", "^yaide", { regex: true })).toEqual([[0, 5]]);
  expect(chercherTexte("le yaide", "^yaide", { regex: true })).toEqual([]);
  expect(chercherTexte("Ya.de 3", "Ya.de \\d", { regex: true })).toEqual([[0, 7]]);
  expect(chercherTexte("Yaide 1", "^yaide", { regex: true, casse: true })).toEqual([]);
  expect(chercherTexte("abc", "z*", { regex: true })).toEqual([]);
  expect(chercherTexte("abc", "^", { regex: true })).toEqual([]);
  expect(chercherTexte("zzazz", "z*", { regex: true })).toEqual([[0, 2], [3, 5]]);
  expect(chercherTexte("Paris", "s$", { regex: true })).toEqual([[4, 5]]);
});

test("REQ206_AC3_chercher_texte_expression_invalide_nulle_sans_exception_relache_litteral", () => {
  expect(chercherTexte("a (b", "(", { regex: true })).toBeNull();
  expect(chercherTexte("a (b", "(")).toEqual([[2, 3]]);
  expect(chercherTexte("a (b", "(", { regex: false, casse: true })).toEqual([[2, 3]]);
  const el = document.createElement("div");
  el.textContent = "a (b";
  marquerOccurrences(el, "(", { regex: true });
  expect(el.querySelectorAll("mark")).toHaveLength(0);
  marquerOccurrences(el, "(", {});
  expect(el.querySelectorAll("mark")).toHaveLength(1);
});

test("REQ206_AC1_AC2_marquer_occurrences_avec_options", () => {
  const el = document.createElement("div");
  el.innerHTML = "<b>Ser</b><i>veur</i> web";
  marquerOccurrences(el, "^ser.eur", { regex: true });
  expect([...el.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Ser", "veur"]);
  retirerMarques(el);
  marquerOccurrences(el, "serveur", { casse: true });
  expect(el.querySelectorAll("mark")).toHaveLength(0);
});

test("REQ207_AC5_AC6_remplacer_texte_sur_le_texte_d_avant_et_dollars", () => {
  const rempl = (t, c, r, o = {}) => remplacerTexte(t, chercherTexte(t, c, o), c, r, o);
  expect(rempl("banana", "a", "aa")).toBe("baanaanaa");
  expect(rempl("alice@ex et bob@ex", "(\\w+)@(\\w+)", "$2 chez $1", { regex: true })).toBe("ex chez alice et ex chez bob");
  expect(rempl("alice@ex et bob@ex", "(\\w+)@(\\w+)", "$&!", { regex: true })).toBe("alice@ex! et bob@ex!");
  expect(rempl("alice@ex et bob@ex", "@", "$1")).toBe("alice$1ex et bob$1ex");
  expect(rempl("a b", "a", "$$", { regex: true })).toBe("$ b");
  expect(rempl("Yaide yaide", "yaide", "")).toBe(" ");
  expect(rempl("Yaide yaide", "yaide", "Z", { casse: true })).toBe("Yaide Z");
  expect(rempl("ab", "^a", "X", { regex: true })).toBe("Xb");
  expect(rempl("rien", "zzz", "X")).toBe("rien");
});

test("REQ207_AC11_champ_remplacer_noms_info_bulles_tab_et_entree", () => {
  const { p, appels } = monter();
  const el = p.element;
  expect(p.remplacement()).toBeNull();
  expect(champRemplacer(p)).toBeNull();
  p.montrerRemplacement();
  const champ = champRemplacer(p);
  expect(champ.getAttribute("placeholder")).toBe("Remplacer");
  expect(document.activeElement).toBe(champ);
  expect(p.remplacement()).toBe("");
  champ.value = "Zed";
  expect(p.remplacement()).toBe("Zed");
  p.montrerRemplacement();
  expect([champ.selectionStart, champ.selectionEnd]).toEqual([0, 3]);
  expect(el.querySelectorAll("input")).toHaveLength(2);
  const ordre = [...el.querySelectorAll("input, button")].map((n) => (n.tagName === "INPUT" ? n.labels[0].textContent : n.getAttribute("aria-label")));
  expect(ordre.slice(ordre.indexOf("Fermer la recherche"))).toEqual(["Fermer la recherche", "Remplacer par", "Remplacer", "Tout remplacer"]);
  const [un, tout] = [el.querySelector('button[aria-label="Remplacer"]'), el.querySelector('button[aria-label="Tout remplacer"]')];
  vi.useFakeTimers();
  expect([un, tout].map(infobulle)).toEqual(["Remplacer (Entrée)", "Tout remplacer"]);
  vi.useRealTimers();
  el.querySelector("input").value = "yaide";
  p.afficher(3, undefined);
  touche(champ, "Enter");
  expect(appels.pop()).toEqual(["remplacer", "Zed"]);
  un.click();
  expect(appels.pop()).toEqual(["remplacer", "Zed"]);
  tout.click();
  expect(appels.pop()).toEqual(["tout", "Zed"]);
  touche(champ, "Enter", { shiftKey: true });
  expect(appels).toEqual([]);
  const statut = el.querySelector('[role="status"]');
  p.annoncerRemplacees(3);
  expect(statut.textContent).toBe("3 occurrences remplacées");
  p.annoncerRemplacees(1);
  expect(statut.textContent).toBe("1 occurrence remplacée");
  p.afficher(2, undefined);
  expect(statut.textContent).toBe("2 occurrences");
});

test("REQ207_AC9_remplacer_inactif_sans_occurrence_champ_vide_ou_expression_invalide", () => {
  const { p, appels } = monter();
  p.montrerRemplacement();
  const [un, tout] = [p.element.querySelector('button[aria-label="Remplacer"]'), p.element.querySelector('button[aria-label="Tout remplacer"]')];
  const champ = p.element.querySelector("input");
  const inactifs = () => [un, tout].map((b) => b.getAttribute("aria-disabled"));
  p.afficher(0);
  expect(inactifs()).toEqual(["true", "true"]);
  champ.value = "zzz";
  p.afficher(0);
  expect(inactifs()).toEqual(["true", "true"]);
  champ.value = "(";
  p.afficher(0, undefined, { invalide: true });
  expect(inactifs()).toEqual(["true", "true"]);
  un.click();
  tout.click();
  touche(champRemplacer(p), "Enter");
  expect(appels).toEqual([]);
  champ.value = "a";
  p.afficher(2);
  expect(inactifs()).toEqual([null, null]);
});

test("REQ159_AC1_REQ160_AC1_REQ161_AC1_ordre_champ_bascules_compteur_fleches_croix", () => {
  const { p } = monter();
  p.element.querySelector("input").value = "a";
  p.afficher(2);
  const ordre = [...p.element.querySelectorAll("input, button, .ya-recherche-compteur")].map((n) => (n.tagName === "INPUT" ? "champ" : n.tagName === "SPAN" ? "compteur" : n.getAttribute("aria-label")));
  expect(ordre).toEqual(["champ", "Respecter la casse", "Expression régulière", "compteur", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
});
