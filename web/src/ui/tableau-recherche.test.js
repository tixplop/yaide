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
  expect(ordre.slice(1)).toEqual(["Respecter la casse", "Expression régulière", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
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

const bouton = (nom) => panneau().querySelector(`button[aria-label="${nom}"]`);
const champRemplacer = () => panneau().querySelectorAll("input")[1] ?? null;
const texteDe = (id) => t.element.querySelector(`[data-id="${id}"]`).textContent;
const remplacer = (texte) => {
  champRemplacer().value = texte;
  champRemplacer().dispatchEvent(new Event("input", { bubbles: true }));
};
const dernier = () => changements.at(-1);
const boiteDoc = (d, id) => d.boxes.find((b) => b.id === id);

test("REQ206_AC5_casse_et_expression_reguliere_s_appliquent_au_texte_de_chaque_boite_et_lien", () => {
  monter();
  ouvrir("Serveur");
  expect(compte()).toBe("3");
  bouton("Respecter la casse").click();
  expect(bouton("Respecter la casse").getAttribute("aria-pressed")).toBe("true");
  expect(compte()).toBe("1");
  expect(marques().map((m) => m.textContent)).toEqual(["Serveur"]);
  bouton("Respecter la casse").click();
  bouton("Expression régulière").click();
  chercher("serveur$");
  expect(compte()).toBe("2");
  expect(marques().map((m) => m.closest("[data-id]").getAttribute("data-id"))).toEqual(["b3", "l1"]);
  // `Ser` en gras puis `veur` en italique : le texte est cherché sans ses styles.
  const d = DOC();
  d.boxes[1].text = "Serveur";
  d.boxes[1].spans = [
    { start: 0, end: 3, bold: true },
    { start: 3, end: 7, italic: true },
  ];
  t.definirDocument(d);
  chercher("^ser.eur");
  expect(compte()).toBe("2");
  expect(marques().filter((m) => m.closest("[data-id]").getAttribute("data-id") === "b2").map((m) => m.textContent)).toEqual(["Ser", "veur"]);
  // Expression invalide : rien, « Invalide ».
  chercher("(");
  expect(compte()).toBe("Invalide");
  expect(champ().getAttribute("aria-invalid")).toBe("true");
  expect(marques()).toHaveLength(0);
  expect(panneau().querySelector("[role=status]").textContent).toBe("Expression régulière invalide");
  // Partie trouvée vide : pas une occurrence.
  chercher("z*");
  expect(compte()).toBe("0");
  // Fermée puis rouverte : boutons relâchés.
  touche(champ(), "Escape");
  ouvrir();
  expect(bouton("Expression régulière").getAttribute("aria-pressed")).toBe("false");
  expect(changements).toHaveLength(0);
});

test("REQ207_AC8_Tout_remplacer_change_les_boites_et_les_liens_en_un_pas_sans_toucher_au_modele", () => {
  monter();
  ouvrir("serveur");
  t.recherche.ouvrir({ remplacement: true });
  remplacer("service");
  bouton("Tout remplacer").click();
  const d = dernier();
  expect(changements).toHaveLength(1);
  expect(d.boxes.map((b) => b.text)).toEqual(["service web", "Base de données", "Cache service"]);
  expect(d.links[0].text).toBe("appelle le service");
  expect(d.model).toBe("graph TD; serveur --> base");
  expect(panneau().querySelector("[role=status]").textContent).toBe("3 occurrences remplacées");
  expect(compte()).toBe("0");
  expect(texteDe("b1")).toBe("service web");
  // Un Ctrl+Z rend les trois textes.
  touche(surface(), "z", { ctrlKey: true });
  expect(dernier().boxes[0].text).toBe("Serveur web");
  expect(dernier().boxes[2].text).toBe("Cache serveur");
  expect(dernier().links[0].text).toBe("appelle le serveur");
  expect(compte()).toBe("3");
});

test("REQ207_AC8_le_texte_mis_a_la_place_prend_les_styles_du_premier_caractere_remplace", () => {
  const d = DOC();
  d.boxes[1].text = "Serveur";
  d.boxes[1].spans = [
    { start: 0, end: 3, bold: true },
    { start: 3, end: 7, italic: true },
  ];
  monter(d);
  ouvrir("serveur");
  t.recherche.ouvrir({ remplacement: true });
  remplacer("service");
  bouton("Tout remplacer").click();
  expect(boiteDoc(dernier(), "b2")).toMatchObject({ text: "service", spans: [{ start: 0, end: 7, bold: true }] });
  // Avec une expression régulière, `$1` reprend un groupe ; avec des caractères hors du plan de base, les styles suivent.
  const e = DOC();
  e.boxes[0].text = "😀 ab cd";
  e.boxes[0].spans = [{ start: 2, end: 4, bold: true }];
  monter(e);
  ouvrir("");
  bouton("Expression régulière").click();
  chercher("(a)b");
  t.recherche.ouvrir({ remplacement: true });
  remplacer("$1$1!");
  bouton("Tout remplacer").click();
  expect(boiteDoc(dernier(), "b1")).toMatchObject({ text: "😀 aa! cd", spans: [{ start: 2, end: 5, bold: true }] });
});

test("REQ207_AC8_Remplacer_sur_le_lien_remplace_son_etiquette_et_choisit_l_occurrence_suivante", () => {
  monter();
  ouvrir("serveur");
  t.recherche.ouvrir({ remplacement: true });
  remplacer("service");
  f3(); // « Serveur web »
  f3(); // le lien
  expect(choisies()).toEqual(["l1"]);
  bouton("Remplacer").click();
  expect(dernier().links[0].text).toBe("appelle le service");
  expect(dernier().boxes[0].text).toBe("Serveur web");
  expect(choisies()).toEqual(["b3"]);
  expect(compte()).toBe("2 sur 2");
  expect(courantes()).toHaveLength(1);
  expect(changements).toHaveLength(1);
  // Entrée dans « Remplacer » : « Cache serveur », puis la première.
  touche(champRemplacer(), "Enter");
  expect(dernier().boxes[2].text).toBe("Cache service");
  expect(choisies()).toEqual(["b1"]);
  expect(document.activeElement).toBe(champRemplacer());
  // Sans courante, « Remplacer » prend celle que F3 choisirait.
  touche(surface(), "Escape");
  t.element.querySelector(".ya-tableau-surface svg").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  bouton("Remplacer").click();
  expect(dernier().boxes[0].text).toBe("service web");
  expect(dernier().model).toBe("graph TD; serveur --> base");
});

test("REQ207_AC9_rien_a_remplacer_les_boutons_sont_inactifs_et_le_clic_ne_change_rien", () => {
  monter();
  t.recherche.ouvrir({ remplacement: true });
  expect(bouton("Remplacer").getAttribute("aria-disabled")).toBe("true");
  expect(bouton("Tout remplacer").getAttribute("aria-disabled")).toBe("true");
  chercher("zzz");
  bouton("Tout remplacer").click();
  bouton("Remplacer").click();
  bouton("Expression régulière").click();
  chercher("(");
  expect(bouton("Remplacer").getAttribute("aria-disabled")).toBe("true");
  bouton("Tout remplacer").click();
  expect(changements).toHaveLength(0);
});

test("REQ207_AC1_Ctrl_H_ouvre_avec_la_ligne_de_remplacement_finit_la_saisie_et_ne_fait_rien_sur_un_whiteboard_illisible", () => {
  monter();
  t.ajouterBoite();
  expect(t.element.querySelector("[role=textbox]")).not.toBeNull();
  t.recherche.ouvrir({ remplacement: true });
  expect(t.element.querySelector("[role=textbox]")).toBeNull();
  expect(champ().value).toBe("");
  expect(champRemplacer().value).toBe("");
  expect(document.activeElement).toBe(champ());
  expect(bouton("Remplacer")).not.toBeNull();
  // Déjà ouverte : le texte cherché reste, le focus va dans « Remplacer ».
  chercher("serveur");
  t.recherche.ouvrir({ remplacement: true });
  expect(champ().value).toBe("serveur");
  expect(document.activeElement).toBe(champRemplacer());
  expect(t.recherche.etat()).toMatchObject({ ouvert: true, texte: "serveur", remplacement: "" });
  // Fermée par Échap, rouverte par Ctrl+F : sans la ligne.
  touche(champRemplacer(), "Escape");
  ouvrir();
  expect(champRemplacer()).toBeNull();
  // Illisible : rien.
  monter(null);
  t.recherche.ouvrir({ remplacement: true });
  expect(panneau()).toBeNull();
});

test("REQ161_AC1_la_fenetre_a_le_champ_les_deux_bascules_le_compteur_les_fleches_et_la_croix_dans_cet_ordre", () => {
  monter();
  ouvrir("serveur");
  const enfants = [...panneau().children];
  expect(enfants[0].querySelector("input")).toBe(champ());
  const commandes = [...enfants[1].children].map((e) => e.querySelector("button")?.getAttribute("aria-label") ?? e.className);
  expect(commandes).toEqual(["Respecter la casse", "Expression régulière", "ya-recherche-compteur", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  expect(document.activeElement).toBe(champ());
});

test("REQ161_AC8_Tab_passe_par_les_cinq_boutons_puis_les_champs_de_remplacement_puis_la_surface", () => {
  monter();
  t.recherche.ouvrir({ remplacement: true });
  const ordre = [...panneau().querySelectorAll("input, button")].map((e) => e.getAttribute("aria-label") ?? e.labels[0].textContent);
  expect(ordre).toEqual(["Rechercher dans le fichier", "Respecter la casse", "Expression régulière", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche", "Remplacer par", "Remplacer", "Tout remplacer"]);
  const focalisables = [...t.element.querySelectorAll("input, button, [tabindex='0']")];
  expect(focalisables[focalisables.indexOf(bouton("Tout remplacer")) + 1]).toBe(surface());
});
