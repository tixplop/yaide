import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";

const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 100, y: 100, width: 160, height: 80, text: "Début\ndu flux" },
    { id: "b2", x: 400, y: 100, width: 160, height: 80, text: "Lire la config" },
    { id: "b3", x: 100, y: 300, width: 160, height: 80, text: "" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
});
const VIDE = () => ({ version: 1, boxes: [], links: [] });

let t;
let changements;
let vues;
function monter(doc = DOC(), vue = { x: 0, y: 0, zoom: 1 }) {
  changements = [];
  vues = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue, surChangement: (d) => changements.push(d), surVue: (v) => vues.push(v) });
  document.body.append(t.element);
  return t;
}
beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  t?.detruire();
  vi.restoreAllMocks();
});

const surface = () => t.element.querySelector("[role=application]");
const obj = (id) => t.element.querySelector(`[data-id="${id}"]`);
const rect = (id) => obj(id).querySelector("rect");
const touche = (cible, key, opts = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  cible.dispatchEvent(e);
  return e;
};
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const dernier = () => changements.at(-1);
const choisieId = () => surface().getAttribute("aria-activedescendant");

test("REQ129_AC2_ajouter_une_boite_au_centre_de_la_vue_en_saisie_au_dessus_des_autres", () => {
  monter(VIDE());
  t.ajouterBoite();
  expect(dernier().boxes).toEqual([{ id: "b1", x: 320, y: 260, width: 160, height: 80, text: "" }]);
  const zone = t.element.querySelector("[role=textbox]");
  expect(zone.getAttribute("contenteditable")).toBe("plaintext-only");
  expect(document.activeElement).toBe(zone);

  // Une boîte occupe déjà le centre : la nouvelle est la dernière dessinée, donc au-dessus.
  monter({ ...VIDE(), boxes: [{ id: "b1", x: 320, y: 260, width: 160, height: 80, text: "Là" }] });
  t.ajouterBoite();
  const ids = [...t.element.querySelectorAll("g.boite")].map((g) => g.getAttribute("data-id"));
  expect(ids).toEqual(["b1", "b2"]);
  expect(dernier().boxes[1]).toMatchObject({ id: "b2", x: 320, y: 260 });
  expect(obj("b2").classList.contains("saisie")).toBe(true);
});

test("REQ129_AC3_entree_va_a_la_ligne_et_le_texte_est_dans_le_document", () => {
  monter();
  clic(rect("b2"));
  touche(surface(), "Enter");
  const zone = t.element.querySelector("[role=textbox]");
  expect(document.activeElement).toBe(zone);
  expect(zone.textContent).toBe("Lire la config");
  expect(touche(zone, "Enter").defaultPrevented).toBe(false);
  zone.textContent = "Début\ndu flux";
  zone.dispatchEvent(new Event("input", { bubbles: true }));
  expect(dernier().boxes[1].text).toBe("Début\ndu flux");
  expect(obj("b2").getAttribute("aria-label")).toBe("Début du flux");
  // Clic ailleurs : la saisie finit, le texte reste.
  clic(t.element.querySelector("svg"));
  expect(t.element.querySelector("[role=textbox]")).toBeNull();
  expect(obj("b2").querySelector(".ya-tableau-texte").textContent).toBe("Début\ndu flux");
  expect(changements.length).toBe(1);
});

test("REQ129_AC4_fleche_bas_deplace_la_boite_choisie_de_10_px", () => {
  monter();
  clic(rect("b3"));
  const e = touche(surface(), "ArrowDown");
  expect(e.defaultPrevented).toBe(true);
  expect(dernier().boxes[2]).toMatchObject({ id: "b3", x: 100, y: 310 });
  touche(surface(), "ArrowLeft");
  expect(dernier().boxes[2]).toMatchObject({ x: 90, y: 310 });
  expect(rect("b3").getAttribute("y")).toBe("310");
});

test("REQ129_AC6_suppr_efface_la_boite_et_ses_fleches_seulement", () => {
  const doc = DOC();
  doc.links.push({ id: "l2", from: "b3", to: "b1" }, { id: "l3", from: "b2", to: "b3" });
  monter(doc);
  clic(rect("b1"));
  touche(surface(), "Delete");
  expect(dernier().boxes.map((b) => b.id)).toEqual(["b2", "b3"]);
  expect(dernier().links.map((l) => l.id)).toEqual(["l3"]);
  expect(obj("b1")).toBeNull();
  expect(obj("l1")).toBeNull();
  expect(obj("l3")).not.toBeNull();
  expect(choisieId()).toBeNull();
});

test("REQ129_AC7_un_clic_choisit_une_seule_boite_et_le_vide_n_en_choisit_aucune", () => {
  monter();
  clic(rect("b1"));
  expect(choisieId()).toBe(obj("b1").id);
  clic(rect("b2"));
  expect(choisieId()).toBe(obj("b2").id);
  expect(t.element.querySelectorAll("g.boite.choisie").length).toBe(1);
  clic(t.element.querySelector("svg"));
  expect(choisieId()).toBeNull();
  expect(t.element.querySelectorAll(".choisie").length).toBe(0);
});

test("REQ129_AC8_contour_et_poignees_de_la_boite_choisie_suppr_et_ctrl_s_dans_la_saisie", () => {
  monter();
  expect(t.element.querySelector(".poignees")).toBeNull();
  clic(rect("b1"));
  expect(obj("b1").classList.contains("choisie")).toBe(true);
  expect(obj("b2").classList.contains("choisie")).toBe(false);
  const poignees = t.element.querySelectorAll(".poignees");
  expect(poignees.length).toBe(1);
  expect(poignees[0].getAttribute("aria-hidden")).toBe("true");
  expect(poignees[0].querySelector('[data-poignee="taille"]')).not.toBeNull();
  // Plus de poignée de liaison : les connecteurs la remplacent (REQ-130).
  expect(t.element.querySelector('[data-poignee="liaison"]')).toBeNull();

  touche(surface(), "Enter");
  expect(t.element.querySelector(".poignees")).toBeNull();
  expect(obj("b1").classList.contains("saisie")).toBe(true);
  const zone = t.element.querySelector("[role=textbox]");
  const supp = touche(zone, "Delete");
  expect(supp.defaultPrevented).toBe(false);
  expect(changements.length).toBe(0);
  expect(obj("b1")).not.toBeNull();
  // Ctrl+S n'est pas arrêté : il remonte à la page.
  const vu = vi.fn();
  document.body.addEventListener("keydown", vu);
  const ctrlS = touche(zone, "s", { ctrlKey: true });
  document.body.removeEventListener("keydown", vu);
  expect(ctrlS.defaultPrevented).toBe(false);
  expect(vu).toHaveBeenCalledTimes(1);
  expect(t.element.querySelector("[role=textbox]")).toBe(zone);
});

test("REQ130_AC4_clic_sur_la_fleche_la_choisit_et_suppr_l_efface", () => {
  monter();
  clic(rect("b1"));
  clic(obj("l1").querySelector(".prise"));
  expect(choisieId()).toBe(obj("l1").id);
  expect(t.element.querySelectorAll("g.boite.choisie").length).toBe(0);
  touche(surface(), "Delete");
  expect(dernier().links).toEqual([]);
  expect(dernier().boxes.length).toBe(3);
  expect(obj("l1")).toBeNull();
});

test("REQ130_AC5_la_fleche_choisie_a_la_classe_qui_la_peint_en_accent", () => {
  monter();
  clic(obj("l1").querySelector(".prise"));
  expect(obj("l1").classList.contains("choisie")).toBe(true);
  expect(obj("b1").classList.contains("choisie")).toBe(false);
});

test("C018_tab_et_maj_tab_dans_l_ordre_du_fichier_noms_et_aria_activedescendant", () => {
  monter();
  const s = surface();
  expect(s.getAttribute("aria-roledescription")).toBe("whiteboard");
  expect(s.getAttribute("aria-label")).toBe("plan.jdiag");
  expect(s.tabIndex).toBe(0);
  expect(t.element.querySelector(`#${s.getAttribute("aria-describedby")}`).textContent).toMatch(/^Tab : objet suivant\./);
  expect(choisieId()).toBeNull();
  expect(touche(s, "Tab", { shiftKey: true }).defaultPrevented).toBe(false);

  const suite = [];
  for (let i = 0; i < 4; i++) {
    const e = touche(s, "Tab");
    suite.push([choisieId(), e.defaultPrevented]);
  }
  const id = (x) => obj(x).id;
  expect(suite).toEqual([[id("b1"), true], [id("b2"), true], [id("b3"), true], [id("l1"), true]]);
  // Sur le dernier : Tab quitte la surface, l'objet reste choisi.
  expect(touche(s, "Tab").defaultPrevented).toBe(false);
  expect(choisieId()).toBe(id("l1"));

  expect(obj("b1").getAttribute("aria-label")).toBe("Début du flux");
  expect(obj("b1").getAttribute("aria-roledescription")).toBe("boîte");
  expect(obj("b1").getAttribute("role")).toBe("group");
  expect(obj("b3").getAttribute("aria-label")).toBe("Boîte vide");
  expect(obj("l1").getAttribute("aria-label")).toBe("De Début du flux vers Lire la config");
  expect(obj("l1").getAttribute("aria-roledescription")).toBe("lien");

  // Maj+Tab remonte, puis sur le premier plus rien n'est choisi, le focus reste.
  expect(touche(s, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
  expect(choisieId()).toBe(id("b3"));
  touche(s, "Tab", { shiftKey: true });
  touche(s, "Tab", { shiftKey: true });
  expect(choisieId()).toBe(id("b1"));
  expect(touche(s, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
  expect(choisieId()).toBeNull();
  // Échap défait le choix.
  touche(s, "Tab");
  expect(touche(s, "Escape").defaultPrevented).toBe(true);
  expect(choisieId()).toBeNull();
});

test("C018_saisie_entree_echap_et_tab", () => {
  monter();
  clic(rect("b1"));
  touche(surface(), "Enter");
  const zone = t.element.querySelector("[role=textbox]");
  expect(zone.getAttribute("aria-multiline")).toBe("true");
  expect(zone.getAttribute("aria-label")).toBe("Texte de la boîte");
  touche(zone, "Escape");
  expect(t.element.querySelector("[role=textbox]")).toBeNull();
  expect(document.activeElement).toBe(surface());
  expect(choisieId()).toBe(obj("b1").id);
  expect(t.element.querySelector(".poignees")).not.toBeNull();
  // Tab dans la saisie : la finit puis passe à l'objet suivant.
  touche(surface(), "Enter");
  touche(t.element.querySelector("[role=textbox]"), "Tab");
  expect(t.element.querySelector("[role=textbox]")).toBeNull();
  expect(choisieId()).toBe(obj("b2").id);
});

test("C018_deux_fleches_de_sens_contraires_sont_decalees_de_8_px_l_une_de_l_autre", () => {
  const doc = DOC();
  doc.links.push({ id: "l2", from: "b2", to: "b1" });
  monter(doc);
  const y = (id) => Number(obj(id).querySelector(".trait").getAttribute("d").split(" ")[2]);
  expect(Math.abs(y("l1") - y("l2"))).toBe(8);
  expect(obj("l1").querySelector(".pointe")).not.toBeNull();
  expect(obj("l2").querySelector(".pointe")).not.toBeNull();
  clic(obj("l2").querySelector(".prise"));
  expect(t.element.querySelectorAll(".lien.choisie").length).toBe(1);
  expect(obj("l2").classList.contains("choisie")).toBe(true);
  // Une flèche seule n'est pas décalée : sur la droite des centres.
  monter();
  expect(obj("l1").querySelector(".trait").getAttribute("d")).toBe("M 260 140 L 400 140");
});

test("C018_pointe_au_bord_de_la_boite_d_arrivee_et_traits_a_taille_fixe", () => {
  monter();
  const pointe = obj("l1").querySelector(".pointe").getAttribute("points").split(" ")[0];
  expect(pointe).toBe("400,140");
  const g = t.element.querySelector("svg");
  expect(g.getAttribute("viewBox")).toBe("0 0 800 600");
  // À 200 %, la pointe garde 10 px à l'écran : 5 unités du dessin.
  monter(DOC(), { x: 0, y: 0, zoom: 2 });
  expect(t.element.querySelector("svg").getAttribute("viewBox")).toBe("0 0 400 300");
  const pts = obj("l1").querySelector(".pointe").getAttribute("points").split(" ").map((p) => p.split(",").map(Number));
  expect(pts[0]).toEqual([400, 140]);
  expect(pts[1][0]).toBe(395);
});

test("C018_etat_illisible_et_retour_au_dessin", () => {
  monter(null);
  const z = t.element;
  expect(z.getAttribute("role")).toBe("region");
  expect(z.getAttribute("aria-label")).toBe("plan.jdiag");
  expect(z.getAttribute("tabindex")).toBe("-1");
  expect(z.querySelector("[role=status]").textContent).toBe("plan.jdiag n'est pas un whiteboard lisible.");
  expect(z.textContent).toContain("Pour le corriger, renommez-le en .json : il s'ouvrira en texte.");
  expect(z.querySelector("[role=status]").textContent).not.toContain("Pour le corriger");
  expect(z.querySelector("[role=application]")).toBeNull();
  t.ajouterBoite();
  expect(changements.length).toBe(0);
  t.definirNom("casse.jdiag");
  expect(z.querySelector("[role=status]").textContent).toBe("casse.jdiag n'est pas un whiteboard lisible.");
  t.definirDocument(DOC());
  expect(z.querySelector("[role=application]").getAttribute("aria-label")).toBe("casse.jdiag");
  expect(z.getAttribute("role")).toBeNull();
  expect(obj("b1")).not.toBeNull();
});

test("C018_definir_document_garde_la_boite_choisie_qui_existe_encore_et_finit_la_saisie", () => {
  monter();
  clic(rect("b2"));
  touche(surface(), "Enter");
  const doc = DOC();
  doc.boxes[1].text = "Changée sur le disque";
  t.definirDocument(doc);
  expect(t.element.querySelector("[role=textbox]")).toBeNull();
  expect(choisieId()).toBe(obj("b2").id);
  expect(obj("b2").getAttribute("aria-label")).toBe("Changée sur le disque");
  expect(changements.length).toBe(0);
  t.definirDocument({ ...doc, boxes: doc.boxes.filter((b) => b.id !== "b2"), links: [] });
  expect(choisieId()).toBeNull();
});

test("C018_objet_choisi_ramene_dans_la_vue_et_changement_de_vue_sans_surChangement", () => {
  const doc = DOC();
  doc.boxes[1].x = 700;
  monter(doc);
  clic(rect("b2"));
  touche(surface(), "ArrowRight");
  touche(surface(), "ArrowRight");
  expect(changements.length).toBe(2);
  const v = vues.at(-1);
  expect(v.zoom).toBe(1);
  // La boîte (x 720 à 880) finit à 24 px du bord droit de la surface (800).
  expect(880 - v.x).toBe(800 - 24);
  touche(surface(), "Tab", { shiftKey: true });
  touche(surface(), "Tab");

  const avant = changements.length;
  t.zoomAvant();
  expect(vues.at(-1).zoom).toBe(1.25);
  t.zoomArriere();
  expect(vues.at(-1).zoom).toBe(1);
  t.toutAfficher();
  expect(changements.length).toBe(avant);
});

test("C018_un_clic_sur_une_boite_au_bord_ne_deplace_pas_la_vue", () => {
  const doc = DOC();
  doc.boxes[1].x = 700;
  monter(doc);
  clic(rect("b2"));
  expect(choisieId()).toBe(obj("b2").id);
  expect(vues.length).toBe(0);
  expect(t.element.querySelector("svg").getAttribute("viewBox")).toBe("0 0 800 600");
});

test("C018_un_clic_sur_une_poignee_garde_la_boite_choisie", () => {
  monter();
  clic(rect("b1"));
  clic(t.element.querySelector('[data-poignee="taille"]'));
  expect(choisieId()).toBe(obj("b1").id);
  surface().dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 270, clientY: 140 }));
  clic(t.element.querySelector("[data-connecteur=right]"));
  expect(choisieId()).toBe(obj("b1").id);
});
