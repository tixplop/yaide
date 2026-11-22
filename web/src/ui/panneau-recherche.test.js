import { expect, test, beforeEach, vi, afterEach } from "vitest";
import { panneauRecherche, chercherTexte, marquerOccurrences, retirerMarques } from "./panneau-recherche.js";

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
  expect(ordre).toEqual(["champ", "compteur", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  const raccourcis = [...el.querySelectorAll("button")].map((b) => b.getAttribute("aria-keyshortcuts"));
  expect(raccourcis).toEqual(["Shift+F3", "F3", "Escape"]);
  vi.useFakeTimers();
  const attendus = ["Occurrence précédente (Maj+F3)", "Occurrence suivante (F3)", "Fermer la recherche (Échap)"];
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
