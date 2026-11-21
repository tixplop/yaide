import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
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
const REFUS = "Diagramme mermaid non collé : seuls les organigrammes (graph, flowchart) sont pris en charge.";

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
});
afterEach(() => {
  t?.detruire();
  vi.restoreAllMocks();
});

const surface = () => t.element.querySelector("[role=application]");
const alerte = () => t.element.querySelector("[role=alert]");
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
  expect(alerte().textContent).toBe("");
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

test("REQ154_AC11_la_zone_alert_existe_vide_et_cachee_apres_la_surface_et_le_refus_la_remplit", () => {
  monter();
  expect(alerte().textContent).toBe("");
  expect(alerte().matches(":empty")).toBe(true);
  expect(css).toMatch(/\.ya-message-flottante:empty\s*\{\s*display:\s*none/);
  expect(surface().compareDocumentPosition(alerte()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  coller("sequenceDiagram\n  A->>B: Bonjour");
  expect(alerte().textContent).toBe(REFUS);
  expect(alerte().matches(":empty")).toBe(false);
  expect(alerte().classList.contains("ya-message-flottante")).toBe(true);
  expect(alerte().classList.contains("message-erreur")).toBe(true);
});

test("REQ154_AC6_AC10_refus_ne_change_rien_garde_le_focus_et_part_au_geste_suivant", () => {
  monter();
  surface().focus();
  const e = coller("sequenceDiagram\n  A->>B: Bonjour");
  expect(e.defaultPrevented).toBe(true);
  expect(changements).toHaveLength(0);
  expect(vues).toHaveLength(0);
  expect(document.activeElement).toBe(surface());
  expect(alerte().textContent).toBe(REFUS);
  // un nouveau refus remplace le message
  coller("graph TD\n  A -->");
  expect(alerte().textContent).toBe("Diagramme mermaid non collé : la ligne 2 n'est pas comprise.");
  coller("graph TD");
  expect(alerte().textContent).toBe("Diagramme mermaid non collé : il n'a aucun nœud.");
  expect(changements).toHaveLength(0);
  touche("z", { ctrlKey: true });
  expect(changements).toHaveLength(0);
  // chaque geste efface le message
  const gestes = [
    () => surface().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
    () => surface().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 10 })),
    () => touche("Escape"),
    () => touche("ArrowLeft"),
    () => t.element.querySelector("[role=toolbar]").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
  ];
  for (const geste of gestes) {
    coller("sequenceDiagram");
    expect(alerte().textContent).not.toBe("");
    geste();
    expect(alerte().textContent).toBe("");
  }
  // même refus deux fois de suite : le Ctrl+V vide la zone, le collage la réécrit
  coller("sequenceDiagram");
  touche("v", { ctrlKey: true });
  expect(alerte().textContent).toBe("");
  coller("sequenceDiagram");
  expect(alerte().textContent).toBe(REFUS);
});

test("REQ154_AC10_le_message_reste_sans_geste_et_part_quand_le_fichier_devient_illisible", async () => {
  monter();
  coller("sequenceDiagram");
  await attendre();
  expect(alerte().textContent).toBe(REFUS);
  t.element.remove();
  document.body.append(t.element);
  expect(alerte().textContent).toBe(REFUS);
  t.definirDocument(null);
  expect(t.element.querySelector("[role=alert]")).toBeNull();
  t.definirDocument(DOC());
  expect(alerte().textContent).toBe("");
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
