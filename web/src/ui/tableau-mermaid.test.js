import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";
import { zoneToasts } from "./toasts.js";

const DOC = () => ({
  version: 1,
  boxes: [
    { id: "b1", x: 40, y: 80, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 300, y: 80, width: 160, height: 80, text: "Fin" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
  arrows: [{ id: "a1", x1: 100, y1: 300, x2: 300, y2: 300 }],
});
const GRAPH = "graph TD\n  A[Début] --> B{Choix}\n  B -->|oui| C(Fin)\n  B -.-> D((Autre))";
const REFUS = "Diagramme mermaid non collé : la ligne 3 n'est pas comprise.";
const ILLISIBLE = "graph TD\nA --> B\nA@{ shape: rect }";

let t;
let changements;
let vues;
function monter(doc = DOC()) {
  changements = [];
  vues = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue: { x: 0, y: 0, zoom: 1 }, surChangement: (d) => changements.push(d), surVue: (v) => vues.push(v) });
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
const texteToasts = () => [...document.querySelectorAll(".ya-toast .message-texte")].map((e) => e.textContent).join("");
const statut = () => t.element.querySelector("[role=status]");
const obj = (id) => t.element.querySelector(`[data-id="${id}"]`);
const touche = (key, opts = {}, cible = surface()) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  cible.dispatchEvent(e);
  return e;
};
const evenement = (type, texte, cible = surface()) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const donnees = { texte };
  e.clipboardData = { getData: () => donnees.texte ?? "", setData: vi.fn((_, v) => (donnees.copie = v)), donnees };
  cible.dispatchEvent(e);
  return e;
};
const coller = (texte, cible) => evenement("paste", texte, cible);
const attendre = () => new Promise((r) => setTimeout(r, 0));

test("REQ154_AC1_AC13_collage_remplace_le_dessin_affiche_tout_et_annonce", async () => {
  monter();
  surface().focus();
  touche("Tab");
  expect(surface().getAttribute("aria-activedescendant")).not.toBeNull();
  const e = coller(GRAPH);
  expect(e.defaultPrevented).toBe(true);
  const d = changements.at(-1);
  expect(d.boxes).toEqual([
    { id: "b1", x: 160, y: 50, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 160, y: 220, width: 160, height: 100, text: "Choix", shape: "diamond" },
    { id: "b3", x: 40, y: 410, width: 160, height: 80, text: "Fin", shape: "rounded" },
    { id: "b4", x: 310, y: 400, width: 100, height: 100, text: "Autre", shape: "ellipse" },
  ]);
  expect(d.links).toEqual([
    { id: "l1", from: "b1", to: "b2" },
    { id: "l2", from: "b2", to: "b3", text: "oui" },
    { id: "l3", from: "b2", to: "b4", line: "dashed" },
  ]);
  expect(d.model).toBe(GRAPH);
  expect(d.arrows).toEqual([]);
  expect(changements).toHaveLength(1);
  expect(surface().hasAttribute("aria-activedescendant")).toBe(false);
  expect(t.element.querySelectorAll("g.choisie")).toHaveLength(0);
  expect(vues.length).toBeGreaterThan(0);
  expect(vues.at(-1).zoom).toBeLessThanOrEqual(1);
  expect(document.activeElement).toBe(surface());
  await attendre();
  expect(statut().textContent).toBe("Diagramme mermaid collé : 4 boîtes, 3 liens.");
  expect(texteToasts()).toBe("");
  coller("graph TD; A");
  await attendre();
  expect(statut().textContent).toBe("Diagramme mermaid collé : 1 boîte, aucun lien.");
  coller("graph TD; A --> B");
  await attendre();
  expect(statut().textContent).toBe("Diagramme mermaid collé : 2 boîtes, 1 lien.");
  touche("z", { ctrlKey: true });
  await attendre();
  expect(statut().textContent).toBe("Modification annulée.");
});

test("REQ154_AC11_AC21_le_refus_est_un_toast_erreur_avec_fermer_cause_whiteboard_et_aucune_zone_alert", () => {
  monter();
  surface().focus();
  expect(t.element.querySelector("[role=alert]")).toBeNull();
  expect(document.querySelector(".ya-toast")).toBeNull();
  coller(ILLISIBLE);
  const toast = document.querySelector(".ya-toast");
  expect(toast.getAttribute("role")).toBe("alert");
  expect(toast.classList.contains("message-erreur")).toBe(true);
  expect(toast.dataset.cause).toMatch(/^whiteboard:/);
  expect(toast.querySelector(".message-texte").textContent).toBe(REFUS);
  expect(toast.querySelectorAll("button")).toHaveLength(1);
  expect(toast.querySelector("button").getAttribute("aria-label")).toBe("Fermer");
  expect(t.element.querySelector("[role=alert]")).toBeNull();
  expect(t.element.contains(toast)).toBe(false);
  expect(document.activeElement).toBe(surface());
});

test("REQ154_AC6_AC10_AC12_refus_ne_change_rien_garde_le_focus_et_part_au_geste_suivant", () => {
  monter();
  surface().focus();
  const e = coller(ILLISIBLE);
  expect(e.defaultPrevented).toBe(true);
  expect(changements).toHaveLength(0);
  expect(vues).toHaveLength(0);
  expect(document.activeElement).toBe(surface());
  expect(texteToasts()).toBe(REFUS);
  // un nouveau refus remplace le message
  coller("graph TD\n  A -->");
  expect(texteToasts()).toBe("Diagramme mermaid non collé : la ligne 2 n'est pas comprise.");
  coller("graph TD");
  expect(texteToasts()).toBe("Diagramme mermaid non collé : il n'a aucun nœud.");
  expect(changements).toHaveLength(0);
  touche("z", { ctrlKey: true });
  expect(changements).toHaveLength(0);
  // chaque geste efface le message
  const gestes = [
    () => surface().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
    () => surface().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 10 })),
    () => touche("Escape"),
    () => touche("ArrowLeft"),
    () => touche("Tab"),
    () => t.element.querySelector("[role=toolbar]").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
  ];
  for (const geste of gestes) {
    coller(ILLISIBLE);
    expect(texteToasts()).not.toBe("");
    geste();
    expect(texteToasts()).toBe("");
  }
  // même refus deux fois de suite : le Ctrl+V vide la zone, le collage la réécrit
  coller(ILLISIBLE);
  touche("v", { ctrlKey: true });
  expect(texteToasts()).toBe("");
  coller(ILLISIBLE);
  coller(ILLISIBLE);
  expect(document.querySelectorAll(".ya-toast")).toHaveLength(1);
  expect(texteToasts()).toBe(REFUS);
});

test("REQ154_AC10_le_message_reste_sans_geste_et_part_quand_le_fichier_devient_illisible", async () => {
  monter();
  coller(ILLISIBLE);
  await attendre();
  expect(texteToasts()).toBe(REFUS);
  t.element.remove();
  document.body.append(t.element);
  expect(texteToasts()).toBe(REFUS);
  t.definirDocument(null);
  expect(texteToasts()).toBe("");
  t.definirDocument(DOC());
  coller(ILLISIBLE);
  t.detruire();
  expect(texteToasts()).toBe("");
});

test("REQ154_AC7_AC137_11_autre_texte_colle_la_copie_ou_rien_et_la_saisie_garde_son_paste", () => {
  monter();
  // sans copie : rien (et pas de recréation)
  coller("Bonjour");
  expect(changements).toHaveLength(0);
  touche("Tab");
  touche("c", { ctrlKey: true });
  const keydownV = touche("v", { ctrlKey: true });
  expect(keydownV.defaultPrevented).toBe(false);
  expect(changements).toHaveLength(0);
  const e = coller("Bonjour");
  expect(e.defaultPrevented).toBe(true);
  expect(changements.at(-1).boxes.map((b) => [b.id, b.x])).toEqual([["b1", 40], ["b2", 300], ["b3", 60]]);
  // copie faite dans un autre whiteboard
  const premier = t;
  const autre = tableau({ nom: "b.jdiag", document: DOC(), vue: { x: 0, y: 0, zoom: 1 }, surChangement: () => {} });
  document.body.append(autre.element);
  const sa = autre.element.querySelector("[role=application]");
  touche("Tab", {}, sa);
  touche("c", { ctrlKey: true }, sa);
  autre.detruire();
  t = premier;
  const avantAutre = changements.length;
  coller("Bonjour");
  expect(changements).toHaveLength(avantAutre + 1);
  expect(changements.at(-1).boxes.at(-1)).toMatchObject({ text: "Début" });
  // saisie en cours : le collage va à la saisie
  touche("Enter");
  const zone = t.element.querySelector("[role=textbox]");
  const n = changements.length;
  const p = coller(GRAPH, zone);
  expect(p.defaultPrevented).toBe(false);
  expect(changements).toHaveLength(n);
  expect(changements.at(-1).boxes).toHaveLength(4);
});

test("REQ154_AC7_fichier_illisible_ctrl_v_ne_fait_rien", () => {
  monter();
  const s = surface();
  t.definirDocument(null);
  const e = coller(GRAPH, s);
  expect(e.defaultPrevented).toBe(false);
  expect(changements).toHaveLength(0);
});

test("REQ137_AC11_ctrl_c_n_empeche_pas_copy_qui_ecrit_les_textes_puis_les_textes_mermaid_copies_se_collent_en_objets", () => {
  monter();
  surface().focus();
  const cx = touche("a", { ctrlKey: true });
  expect(cx.defaultPrevented).toBe(true);
  const c = touche("c", { ctrlKey: true });
  expect(c.defaultPrevented).toBe(false);
  const copie = evenement("copy");
  expect(copie.defaultPrevented).toBe(true);
  expect(copie.clipboardData.setData).toHaveBeenCalledWith("text/plain", "Début\nFin");
  // le texte copié est celui du presse-papiers : les objets sont collés, sans recréation
  coller("Début\nFin");
  expect(changements).toHaveLength(1);
  expect(changements.at(-1).boxes.map((b) => b.text)).toEqual(["Début", "Fin", "Début", "Fin"]);
  expect(changements.at(-1).model).toBeUndefined();
});

test("REQ137_AC11_boites_aux_textes_mermaid_copiees_puis_collees_sont_des_objets", () => {
  monter({ version: 1, boxes: [{ id: "b1", x: 0, y: 0, width: 160, height: 80, text: "graph TD" }, { id: "b2", x: 300, y: 0, width: 160, height: 80, text: "A --> B" }], links: [], arrows: [] });
  surface().focus();
  touche("a", { ctrlKey: true });
  touche("c", { ctrlKey: true });
  const copie = evenement("copy");
  expect(copie.clipboardData.setData).toHaveBeenCalledWith("text/plain", "graph TD\nA --> B");
  coller("graph TD\nA --> B");
  expect(changements.at(-1).boxes.map((b) => b.text)).toEqual(["graph TD", "A --> B", "graph TD", "A --> B"]);
  expect(changements.at(-1).model).toBeUndefined();
});

test("REQ137_AC11_copy_sans_boite_ecrit_un_texte_vide_et_en_saisie_laisse_faire_le_navigateur", () => {
  monter();
  touche("c", { ctrlKey: true });
  const c = evenement("copy");
  expect(c.clipboardData.setData).toHaveBeenCalledWith("text/plain", "");
  touche("Tab");
  touche("Enter");
  const p = evenement("copy", undefined, t.element.querySelector("[role=textbox]"));
  expect(p.defaultPrevented).toBe(false);
  expect(obj("b1")).not.toBeNull();
});

const MODELE = "Flux : Début → Fin.\nUne seule étape.";
const maj = (key = "v", opts = {}, cible) => touche(key, { ctrlKey: true, shiftKey: true, ...opts }, cible);

test("REQ154_AC18_AC23_ctrl_maj_v_recree_le_dessin_garde_le_modele_et_s_annule_en_un_pas", async () => {
  monter({ ...DOC(), model: MODELE });
  surface().focus();
  const k = maj();
  expect(k.defaultPrevented).toBe(false);
  coller("graph TD\nA --> B");
  const d = changements.at(-1);
  expect(d.boxes.map((b) => [b.id, b.x, b.y, b.text])).toEqual([["b1", 40, 50, "A"], ["b2", 40, 230, "B"]]);
  expect(d.links).toEqual([{ id: "l1", from: "b1", to: "b2" }]);
  expect(d.model).toBe(MODELE);
  expect(surface().hasAttribute("aria-activedescendant")).toBe(false);
  expect(document.activeElement).toBe(surface());
  expect(vues.at(-1).zoom).toBeLessThanOrEqual(1);
  expect(texteToasts()).toBe("");
  await attendre();
  expect(statut().textContent).toBe("Diagramme mermaid collé : 2 boîtes, 1 lien.");
  touche("z", { ctrlKey: true });
  expect(changements.at(-1)).toEqual({ ...DOC(), model: MODELE });
  // Le drapeau est consommé : un Ctrl+V ordinaire reprend le modèle collé.
  touche("v", { ctrlKey: true });
  coller("graph TD\nA --> B");
  expect(changements.at(-1).model).toBe("graph TD\nA --> B");
});

test("REQ154_AC18_sans_modele_pas_de_cle_et_autre_touche_baisse_le_drapeau", () => {
  monter();
  maj();
  coller("graph TD\nA --> B");
  expect("model" in changements.at(-1)).toBe(false);
  expect(changements.at(-1).boxes).toHaveLength(2);
  // Autre touche entre le keydown et le paste : le drapeau est baissé.
  t.detruire();
  document.body.innerHTML = "";
  monter({ ...DOC(), model: MODELE });
  maj();
  touche("a");
  coller("graph TD\nA --> B");
  expect(changements.at(-1).model).toBe("graph TD\nA --> B");
});

test("REQ154_AC18_autre_texte_colle_la_copie_et_la_saisie_garde_son_paste", () => {
  monter();
  touche("Tab");
  touche("c", { ctrlKey: true });
  maj();
  coller("Bonjour");
  expect(changements.at(-1).boxes.at(-1)).toMatchObject({ id: "b3", text: "Début" });
  touche("Enter");
  const zone = t.element.querySelector("[role=textbox]");
  const n = changements.length;
  maj("v", {}, zone);
  const p = coller(GRAPH, zone);
  expect(p.defaultPrevented).toBe(false);
  expect(changements).toHaveLength(n);
});
