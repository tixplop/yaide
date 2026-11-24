import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";
import { zoneToasts } from "./toasts.js";
import { centrerObjet } from "./tableau-calculs.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
// plan.jdiag : « Serveur web » (40, 40), « Base de données » (400, 40), le lien « appelle le serveur », « Cache serveur » (40, 300), une flèche libre.
const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 40, y: 40, width: 160, height: 80, text: "Serveur web" },
    { id: "b2", x: 400, y: 40, width: 160, height: 80, text: "Base de données" },
    { id: "b3", x: 40, y: 300, width: 160, height: 80, text: "Cache serveur" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2", text: "appelle le serveur" }],
  arrows: [{ id: "a1", x1: 300, y1: 300, x2: 400, y2: 300 }],
  model: "graph TD; serveur --> base",
});
const OUTILS = { x: 12, y: 400, width: 304, height: 188 };

let t;
let changements;
let vues;
function monter(doc = DOC(), vue = { x: 0, y: 0, zoom: 1 }, outils = OUTILS) {
  changements = [];
  vues = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    const r = this.classList?.contains("ya-tableau-outils") ? outils : { x: 0, y: 0, width: 800, height: 600 };
    return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
  });
  t = tableau({ nom: "plan.jdiag", document: doc, vue, surChangement: (d) => changements.push(d), surVue: (v) => vues.push(v) });
  document.body.append(t.element);
  return t;
}
beforeEach(() => {
  document.body.innerHTML = "";
  vi.stubGlobal("requestAnimationFrame", (f) => (f(), 0));
  document.body.append(zoneToasts());
});
afterEach(() => {
  t?.detruire();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const surface = () => t.element.querySelector("[role=application]");
const panneau = () => t.element.querySelector("[role=search]");
const champ = () => panneau().querySelector("input");
const compte = () => panneau().querySelector(".ya-recherche-compteur").textContent;
const marques = () => [...t.element.querySelectorAll("mark.ya-occurrence")];
const courantes = () => marques().filter((m) => m.classList.contains("ya-occurrence-courante"));
const choisies = () => [...t.element.querySelectorAll("g.choisie")].map((g) => g.getAttribute("data-id"));
const touche = (cible, key, opts = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  cible.dispatchEvent(e);
  return e;
};
const chercher = (texte) => {
  champ().value = texte;
  champ().dispatchEvent(new Event("input", { bubbles: true }));
};
const f3 = (opts) => touche(champ(), "F3", opts);
const ouvrir = (texte) => {
  t.recherche.ouvrir();
  if (texte !== undefined) chercher(texte);
};
const dernierVue = () => vues.at(-1);

test("REQ161_AC2_AC11_compte_les_boites_et_liens_surligne_les_parties_sans_le_modele_ni_la_casse", () => {
  monter();
  ouvrir("serveur");
  expect(compte()).toBe("3");
  expect(marques().map((m) => m.textContent)).toEqual(["Serveur", "serveur", "serveur"]);
  expect(marques().map((m) => m.closest("[data-id]").getAttribute("data-id"))).toEqual(["b1", "b3", "l1"]);
  expect(panneau().querySelector("[role=status]").textContent).toBe("3 occurrences");
  chercher("zzz");
  expect(compte()).toBe("0");
  expect(panneau().querySelector(".ya-occ-zero")).not.toBeNull();
  expect(marques()).toHaveLength(0);
  chercher("");
  expect(compte()).toBe("");
  expect(marques()).toHaveLength(0);
  // `Ser` en gras puis `veur` en italique : une boîte, deux marques, une dans chaque partie.
  const d = DOC();
  d.boxes[1].text = "Serveur";
  d.boxes[1].spans = [
    { start: 0, end: 3, bold: true },
    { start: 3, end: 7, italic: true },
  ];
  t.definirDocument(d);
  chercher("serveur");
  expect(compte()).toBe("4");
  const dedans = marques().filter((m) => m.closest("[data-id]").getAttribute("data-id") === "b2");
  expect(dedans.map((m) => m.textContent)).toEqual(["Ser", "veur"]);
  expect(dedans[0].parentElement.style.fontWeight).toBe("700");
  expect(dedans[1].parentElement.style.fontStyle).toBe("italic");
  // Boîte en saisie : aucune marque ; Échap : elle revient.
  surface().focus();
  t.element.querySelector('[data-id="b2"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  expect(t.element.querySelector("[role=textbox]")).not.toBeNull();
  expect(marques().filter((m) => m.closest("[data-id]").getAttribute("data-id") === "b2")).toHaveLength(0);
  touche(t.element.querySelector("[role=textbox]"), "Escape");
  expect(marques().filter((m) => m.closest("[data-id]").getAttribute("data-id") === "b2")).toHaveLength(2);
  expect(changements).toHaveLength(0);
});

test("REQ161_AC11_une_partie_rouge_trouvee_garde_la_couleur_du_texte_du_theme_par_la_marque", () => {
  const d = DOC();
  d.boxes[0] = { ...d.boxes[0], text: "Serveur", shape: "text", spans: [{ start: 0, end: 7, color: "red" }] };
  monter(d);
  ouvrir("serveur");
  const m = marques()[0];
  expect(m.parentElement.style.color).toBe("var(--boite-rouge-trait)");
  expect(css).toMatch(/mark\.ya-occurrence\s*\{[^}]*color:\s*var\(--ink\)/);
});

test("REQ161_AC3_F3_choisit_l_objet_seul_dans_l_ordre_et_le_focus_reste_dans_le_champ", () => {
  monter();
  ouvrir("serveur");
  f3();
  expect(choisies()).toEqual(["b1"]);
  expect(compte()).toBe("1 sur 3");
  expect(document.activeElement).toBe(champ());
  expect(panneau().querySelector("[role=status]").textContent).toBe("Occurrence 1 sur 3");
  f3();
  expect(choisies()).toEqual(["l1"]);
  f3();
  expect(choisies()).toEqual(["b3"]);
  f3();
  expect(choisies()).toEqual(["b1"]);
  panneau().querySelector('button[aria-label="Occurrence précédente"]').click();
  expect(choisies()).toEqual(["b3"]);
  f3({ shiftKey: true });
  expect(choisies()).toEqual(["l1"]);
  expect(changements).toHaveLength(0);
});

test("REQ161_AC3_depuis_un_objet_sans_texte_cherche_la_suivante_apres_lui_et_F3_marche_depuis_la_surface", () => {
  monter();
  ouvrir("serveur");
  surface().focus();
  // « Base de données » (à 400, 40) est choisie : la suivante est le lien (milieu à y = 80), la précédente « Serveur web ».
  t.element.querySelector('[data-id="b2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(choisies()).toEqual(["b2"]);
  const ev = touche(surface(), "F3");
  expect(ev.defaultPrevented).toBe(true);
  expect(choisies()).toEqual(["l1"]);
  t.element.querySelector('[data-id="b2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  touche(surface(), "F3", { shiftKey: true });
  expect(choisies()).toEqual(["b1"]);
  // depuis la boîte à outils
  touche(t.element.querySelector("[role=toolbar] button"), "F3");
  expect(choisies()).toEqual(["l1"]);
});

test("REQ161_AC4_Echap_ferme_efface_les_marques_rend_le_focus_et_ne_change_rien", () => {
  monter();
  ouvrir("serveur");
  f3();
  f3();
  f3();
  const e = touche(champ(), "Escape");
  expect(e.defaultPrevented).toBe(true);
  expect(panneau()).toBeNull();
  expect(marques()).toHaveLength(0);
  expect(document.activeElement).toBe(surface());
  expect(choisies()).toEqual(["b3"]);
  expect(changements).toHaveLength(0);
  touche(surface(), "z", { ctrlKey: true });
  expect(changements).toHaveLength(0);
  expect(changements).toHaveLength(0);
});

test("REQ161_AC5_la_vue_centre_une_occurrence_hors_de_la_zone_sans_changer_le_zoom", () => {
  monter(DOC(), { x: 0, y: 0, zoom: 2 });
  ouvrir("serveur");
  f3();
  expect(vues).toHaveLength(0); // « Serveur web » est entière dans la zone, hors du haut et de la boîte à outils
  f3(); // le lien aussi est entier dans la zone
  expect(vues).toHaveLength(0);
  f3(); // « Cache serveur » : y de 300 à 380, soit 600 à 760 à l'écran
  expect(vues).toHaveLength(1);
  expect(dernierVue()).toEqual({ x: 40 + 80 - 800 / 2 / 2, y: 300 + 40 - 600 / 2 / 2, zoom: 2 });
  expect(changements).toHaveLength(0);
});

test("REQ161_AC13_une_occurrence_sous_la_boite_a_outils_ou_sous_le_panneau_est_centree_zoom_inchange", () => {
  const d = DOC();
  d.boxes[2].y = 420; // sous la boîte à outils (x 12 à 316, y 400 à 588)
  monter(d);
  ouvrir("cache");
  f3();
  expect(dernierVue()).toEqual({ x: 120 - 400, y: 460 - 300, zoom: 1 });
  // Sous le panneau (les 42 px du haut) : « Serveur web » en y = 20.
  const e = DOC();
  e.boxes[0].y = 20;
  monter(e);
  ouvrir("serveur web");
  f3();
  expect(dernierVue()).toEqual({ x: 120 - 400, y: 60 - 300, zoom: 1 });
});

test("REQ161_AC13_le_refus_d_un_collage_est_un_toast_hors_de_la_zone_et_la_fenetre_de_recherche_reste_ouverte_a_sa_place", () => {
  monter();
  ouvrir("serveur");
  const e = new Event("paste", { bubbles: true, cancelable: true });
  e.clipboardData = { getData: () => "graph TD\nA --> B\nA@{ shape: rect }", setData() {} };
  surface().dispatchEvent(e);
  const toast = document.querySelector(".ya-toast");
  expect(toast.querySelector(".message-texte").textContent).toContain("Diagramme mermaid non collé");
  expect(t.element.contains(toast)).toBe(false);
  expect(t.element.querySelector("[role=alert]")).toBeNull();
  expect(panneau()).not.toBeNull();
  expect(t.element.firstElementChild).toBe(panneau().closest(".ya-recherche") ?? panneau());
  expect(champ().value).toBe("serveur");
  expect(compte()).not.toBe("");
});

test("REQ161_AC6_le_compteur_suit_les_ajouts_l_annulation_et_les_suppressions", () => {
  monter();
  ouvrir("serveur");
  expect(compte()).toBe("3");
  t.ajouterBoite();
  const zone = t.element.querySelector("[role=textbox]");
  zone.textContent = "serveur 2";
  zone.dispatchEvent(new Event("input", { bubbles: true }));
  expect(compte()).toBe("4"); // même pendant la saisie
  touche(zone, "Escape");
  expect(compte()).toBe("4");
  expect(marques()).toHaveLength(4);
  touche(surface(), "z", { ctrlKey: true });
  expect(compte()).toBe("3");
  // « Cache serveur » choisie par F3 puis supprimée.
  touche(surface(), "Escape"); // la boîte ajoutée, vide, reste choisie
  f3();
  f3();
  f3();
  expect(choisies()).toEqual(["b3"]);
  touche(surface(), "Delete");
  expect(compte()).toBe("2");
  expect(marques()).toHaveLength(2);
});

test("REQ161_AC12_seule_la_marque_de_l_occurrence_courante_a_la_classe_jusqu_au_clic_ailleurs", () => {
  monter();
  ouvrir("serveur");
  f3();
  f3();
  expect(courantes().map((m) => m.closest("[data-id]").getAttribute("data-id"))).toEqual(["l1"]);
  expect(courantes()).toHaveLength(1);
  t.element.querySelector(".ya-tableau-surface svg").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(courantes()).toHaveLength(0);
  expect(compte()).toBe("3");
});

test("REQ161_AC7_Ctrl_F_pendant_une_saisie_la_finit_le_panneau_s_ouvre_avec_le_focus_dans_le_champ", () => {
  monter();
  t.ajouterBoite();
  expect(t.element.querySelector("[role=textbox]")).not.toBeNull();
  t.recherche.ouvrir();
  expect(t.element.querySelector("[role=textbox]")).toBeNull();
  expect(document.activeElement).toBe(champ());
  chercher("serveur");
  expect(compte()).toBe("3");
  expect(marques()).toHaveLength(3);
});

test("REQ161_AC8_le_panneau_est_le_premier_enfant_nomme_et_Tab_passe_par_trois_boutons_puis_la_surface", () => {
  monter();
  ouvrir();
  expect(t.element.firstElementChild).toBe(panneau());
  expect(panneau().getAttribute("aria-label")).toBe("Rechercher dans plan.jdiag");
  t.definirNom("autre.jdiag");
  expect(panneau().getAttribute("aria-label")).toBe("Rechercher dans autre.jdiag");
  const ordre = [...panneau().querySelectorAll("input, button")].map((e) => e.getAttribute("aria-label") ?? e.tagName);
  expect(ordre.slice(1)).toEqual(["Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  const focalisables = [...t.element.querySelectorAll("input, button, [tabindex='0']")].filter((e) => !e.hasAttribute("disabled"));
  const dernierBouton = panneau().querySelector('button[aria-label="Fermer la recherche"]');
  expect(focalisables[focalisables.indexOf(dernierBouton) + 1]).toBe(surface());
});

test("REQ161_AC1_une_recherche_sans_document_lisible_ne_s_ouvre_pas", () => {
  monter(null);
  t.recherche.ouvrir();
  expect(panneau()).toBeNull();
});

test("REQ161_AC5_centrerObjet_laisse_la_vue_si_l_objet_est_entier_et_hors_des_outils", () => {
  const vue = { x: 0, y: 0, zoom: 1 };
  const taille = { largeur: 800, hauteur: 600 };
  const o = { x: 100, y: 100, width: 100, height: 50 };
  expect(centrerObjet(vue, taille, o, { haut: 42, outils: null })).toBe(vue);
  expect(centrerObjet(vue, taille, { ...o, y: 41 }, { haut: 42 })).toEqual({ x: 150 - 400, y: 66 - 300, zoom: 1 });
  expect(centrerObjet(vue, taille, o, { outils: { x: 150, y: 120, width: 300, height: 100 } })).not.toBe(vue);
  expect(centrerObjet(vue, taille, { ...o, x: 760 }, {})).toEqual({ x: 810 - 400, y: 125 - 300, zoom: 1 });
});

test("REQ161_AC12_un_changement_du_document_efface_l_occurrence_courante", () => {
  monter();
  ouvrir("serveur");
  f3();
  expect(courantes()).toHaveLength(1);
  t.definirDocument(DOC());
  expect(courantes()).toHaveLength(0);
  expect(compte()).toBe("3");
  f3();
  f3(); // « Cache serveur », qui peut être déplacée
  expect(courantes()).toHaveLength(1);
  touche(surface(), "ArrowRight"); // déplace « Cache serveur » : un changement du document
  expect(courantes()).toHaveLength(0);
  expect(compte()).toBe("3");
});
