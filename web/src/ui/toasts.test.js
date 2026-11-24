import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { afficher, changerTexte, retirer, zoneToasts } from "./toasts.js";

let zone;
let repli;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  repli = vi.fn();
  zone = zoneToasts({ repli });
  document.body.append(zone);
});
afterEach(() => vi.useRealTimers());

const image = () => vi.advanceTimersByTime(20);
const toasts = () => [...zone.querySelectorAll(".ya-toast")];
const textes = () => (image(), toasts()).map((t) => t.querySelector(".message-texte").textContent);
const fermer = (t) => t.querySelector("button[aria-label='Fermer']");

test("REQ172_AC3_info_et_succes_partent_apres_6_s_et_l_erreur_reste", () => {
  afficher({ texte: "src/main.rs est indexé.", variante: "succes" });
  afficher({ texte: "Info", variante: "info" });
  afficher({ texte: "Lien refusé", variante: "erreur" });
  afficher({ texte: "Alerte", variante: "alerte" });
  vi.advanceTimersByTime(5900);
  expect(toasts()).toHaveLength(4);
  vi.advanceTimersByTime(200);
  expect(textes()).toEqual(["Lien refusé", "Alerte"]);
  vi.advanceTimersByTime(60000);
  expect(textes()).toEqual(["Lien refusé", "Alerte"]);
  fermer(toasts()[0]).click();
  expect(textes()).toEqual(["Alerte"]);
});

test("REQ172_AC3_pointeur_ou_focus_arretent_le_delai_qui_repart_pour_6_s", () => {
  afficher({ texte: "Indexé", variante: "succes" });
  const t = toasts()[0];
  vi.advanceTimersByTime(3000);
  t.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(30000);
  expect(toasts()).toHaveLength(1);
  fermer(t).focus();
  t.dispatchEvent(new Event("pointerleave"));
  vi.advanceTimersByTime(30000);
  expect(toasts()).toHaveLength(1);
  fermer(t).blur();
  vi.advanceTimersByTime(5900);
  expect(toasts()).toHaveLength(1);
  vi.advanceTimersByTime(200);
  expect(toasts()).toHaveLength(0);
});

test("REQ172_AC4_le_cinquieme_retire_le_plus_ancien_et_le_meme_texte_ne_s_ajoute_pas", () => {
  for (const n of ["a", "b", "c", "d", "e"]) afficher({ texte: n, variante: "erreur" });
  expect(textes()).toEqual(["b", "c", "d", "e"]);
  afficher({ texte: "e", variante: "erreur" });
  expect(textes()).toEqual(["b", "c", "d", "e"]);
});

test("REQ172_AC4_meme_texte_le_delai_repart", () => {
  afficher({ texte: "Indexé", variante: "succes" });
  vi.advanceTimersByTime(4000);
  afficher({ texte: "Indexé", variante: "succes" });
  expect(toasts()).toHaveLength(1);
  vi.advanceTimersByTime(4000);
  expect(toasts()).toHaveLength(1);
  vi.advanceTimersByTime(2100);
  expect(toasts()).toHaveLength(0);
});

test("REQ172_AC10_la_coupure_reste_avec_les_trois_erreurs_les_plus_recentes", () => {
  afficher({ texte: "Connexion perdue. Modifications gardées.", variante: "alerte", fort: true, cause: "connexion" });
  for (const n of ["a", "b", "c", "d"]) afficher({ texte: n, variante: "erreur" });
  expect(textes()).toEqual(["Connexion perdue. Modifications gardées.", "b", "c", "d"]);
  const fort = toasts()[0];
  expect(fort.getAttribute("role")).toBe("alert");
  expect(fort.querySelector("button")).toBeNull();
  changerTexte("connexion", "Connexion perdue. Modifications gardées. main.rs sera sauvegardé au retour.");
  expect(toasts()[0]).toBe(fort);
  expect(fort.textContent).toMatch(/main\.rs sera sauvegardé au retour\.$/);
  retirer("connexion");
  expect(textes()).toEqual(["b", "c", "d"]);
});

test("REQ172_AC5_zone_vide_role_texte_a_l_image_suivante_et_focus_inchange", () => {
  expect(zone.classList.contains("ya-toasts")).toBe(true);
  expect(zone.children).toHaveLength(0);
  const champ = document.createElement("input");
  document.body.append(champ);
  champ.focus();
  afficher({ texte: "Fait", variante: "succes" });
  afficher({ texte: "Mal", variante: "erreur" });
  const [a, b] = toasts();
  expect(a.getAttribute("role")).toBe("status");
  expect(b.getAttribute("role")).toBe("alert");
  expect(a.querySelector(".message-texte").textContent).toBe("");
  image();
  expect(textes()).toEqual(["Fait", "Mal"]);
  expect(document.activeElement).toBe(champ);
});

test("REQ172_AC5_fermer_donne_le_focus_au_suivant_sinon_au_precedent_sinon_au_repli", () => {
  for (const n of ["a", "b", "c"]) afficher({ texte: n, variante: "erreur" });
  image();
  const [a, b, c] = toasts();
  fermer(b).click();
  expect(document.activeElement).toBe(fermer(c));
  fermer(c).click();
  expect(document.activeElement).toBe(fermer(a));
  expect(repli).not.toHaveBeenCalled();
  fermer(a).click();
  expect(repli).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(document.body);
});

test("REQ172_AC5_toast_qui_a_le_focus_et_part_par_sa_cause_donne_le_focus_au_suivant", () => {
  afficher({ texte: "Mal", variante: "erreur", cause: "whiteboard:a" });
  afficher({ texte: "Autre", variante: "erreur" });
  const [a, b] = toasts();
  fermer(a).focus();
  retirer("whiteboard:a");
  expect(textes()).toEqual(["Autre"]);
  expect(document.activeElement).toBe(fermer(b));
});

test("REQ172_AC6_fermer_est_decrit_par_le_texte_et_la_zone_suit_le_footer_dans_l_ordre_de_tab", () => {
  afficher({ texte: "Un", variante: "erreur", detail: "sortie" });
  afficher({ texte: "Deux", variante: "erreur" });
  image();
  const [a, b] = toasts();
  expect(fermer(a).getAttribute("aria-describedby")).toBe(a.querySelector(".message-texte").id);
  expect(document.getElementById(fermer(b).getAttribute("aria-describedby")).textContent).toBe("Deux");
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("REQ172_AC4_retirer_par_cause_ne_touche_que_cette_cause", () => {
  afficher({ texte: "x", variante: "erreur", cause: "whiteboard:a" });
  afficher({ texte: "y", variante: "erreur", cause: "whiteboard:b" });
  afficher({ texte: "z", variante: "erreur" });
  retirer("whiteboard:a");
  expect(textes()).toEqual(["y", "z"]);
  retirer("inconnue");
  expect(textes()).toEqual(["y", "z"]);
});

test("REQ172_AC5_entrees_invalides", () => {
  expect(() => afficher({ texte: "", variante: "erreur" })).toThrow(/texte/);
  expect(() => afficher({ texte: "a", variante: "zzz" })).toThrow(/variante/);
  expect(() => changerTexte("rien", "t")).not.toThrow();
});

test("REQ172_AC4_remove_de_l_element_rendu_retire_le_toast_et_le_meme_message_revient_sans_compter_double", () => {
  const a = afficher({ texte: "A", variante: "erreur" });
  expect(afficher({ texte: "A", variante: "erreur" })).toBe(a);
  expect(textes()).toEqual(["A"]);
  a.remove();
  expect(toasts()).toHaveLength(0);
  afficher({ texte: "A", variante: "erreur" });
  expect(textes()).toEqual(["A"]);
  for (const t of ["B", "C", "D"]) afficher({ texte: t, variante: "erreur" });
  expect(textes()).toEqual(["A", "B", "C", "D"]);
});
