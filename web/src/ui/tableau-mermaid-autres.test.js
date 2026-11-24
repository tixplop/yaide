import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tableau } from "./tableau.js";
import { zoneToasts } from "./toasts.js";

const chargerMock = vi.hoisted(() => vi.fn());
vi.mock("./diagramme.js", async (orig) => ({ ...(await orig()), chargerMermaid: chargerMock }));

const css = (await import("node:fs")).readFileSync("web/src/ui/composants.css", "utf8");
const DOC = () => ({
  version: 1,
  model: "Flux d'avant",
  boxes: [
    { id: "b1", x: 40, y: 80, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 300, y: 80, width: 160, height: 80, text: "Fin" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
  arrows: [{ id: "a1", x1: 100, y1: 300, x2: 300, y2: 300 }],
});
const SEQ = "sequenceDiagram\n  A->>B: Bonjour\r\n  B-->>A: Salut";
const SEQ_N = "sequenceDiagram\n  A->>B: Bonjour\n  B-->>A: Salut";
const traduit = (nb = 2, nf = 2) => ({
  doc: {
    version: 1,
    boxes: Array.from({ length: nb }, (_, i) => ({ id: `b${i + 1}`, x: 40 + i * 100, y: 40, width: 80, height: 40, text: `T${i}` })),
    links: [],
    arrows: Array.from({ length: nf }, (_, i) => ({ id: `a${i + 1}`, x1: 40, y1: 100 + i * 10, x2: 200, y2: 100 + i * 10 })),
  },
});

let t;
let changements;
let vues;
let style = null;
function monter(doc = DOC()) {
  changements = [];
  vues = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 });
  t = tableau({ nom: "plan.jdiag", document: doc, vue: { x: 0, y: 0, zoom: 1 }, surChangement: (d) => changements.push(d), surVue: (v) => vues.push(v) });
  document.body.append(t.element);
}
beforeEach(() => {
  document.body.innerHTML = "";
  vi.stubGlobal("requestAnimationFrame", (f) => (f(), 0));
  document.body.append(zoneToasts());
  chargerMock.mockReset();
});
afterEach(() => {
  style?.remove();
  style = null;
  t?.detruire();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const surface = () => t.element.querySelector("[role=application]");
const texteToasts = () => [...document.querySelectorAll(".ya-toast .message-texte")].map((e) => e.textContent).join("");
const statut = () => t.element.querySelector("[role=status]");
const touche = (key, opts = {}) => surface().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
const coller = (texte) => {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  e.clipboardData = { getData: () => texte, setData: vi.fn() };
  surface().dispatchEvent(e);
};
const collerSeul = (texte) => {
  touche("v", { ctrlKey: true, shiftKey: true });
  coller(texte);
};
const attendre = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};
const dernier = () => changements.at(-1);
const avec = (res) => chargerMock.mockResolvedValue({ traduire: vi.fn(async () => res) });

test("REQ154_AC14_AC23_ctrl_v_remplace_tout_et_ctrl_z_ctrl_y", async () => {
  avec(traduit(6, 4));
  monter();
  surface().focus();
  coller(SEQ);
  await attendre();
  expect(t.element.querySelector('[data-id="a1"]')).not.toBeNull();
  expect(t.element.querySelector('[data-id="l1"]')).toBeNull();
  expect(t.element.querySelectorAll("g.boite").length).toBe(6);
  expect(dernier().model).toBe(SEQ_N);
  expect(dernier().links).toEqual([]);
  expect(surface().hasAttribute("aria-activedescendant")).toBe(false);
  expect(document.activeElement).toBe(surface());
  expect(vues.length).toBeGreaterThan(0);
  expect(vues.at(-1).zoom).toBeLessThanOrEqual(1);
  expect(statut().textContent).toBe("Diagramme mermaid collé : 6 boîtes, 4 flèches libres.");
  touche("z", { ctrlKey: true });
  expect(dernier()).toEqual(DOC());
  touche("y", { ctrlKey: true });
  expect(dernier().boxes.length).toBe(6);
});

test("REQ154_AC18_AC23_ctrl_maj_v_garde_le_modele", async () => {
  avec(traduit(1, 1));
  monter();
  surface().focus();
  collerSeul(SEQ);
  await attendre();
  expect(dernier().model).toBe("Flux d'avant");
  expect(dernier().boxes.length).toBe(1);
  expect(statut().textContent).toBe("Diagramme mermaid collé : 1 boîte, 1 flèche libre.");
  t.detruire();
  document.body.innerHTML = "";
  const sans = DOC();
  delete sans.model;
  avec(traduit(2, 0));
  monter(sans);
  surface().focus();
  collerSeul(SEQ);
  await attendre();
  expect("model" in dernier()).toBe(false);
  expect(statut().textContent).toBe("Diagramme mermaid collé : 2 boîtes, aucune flèche libre.");
});

test("REQ154_AC19_chargement_rejete_rien_ne_change_puis_reessai", async () => {
  chargerMock.mockRejectedValueOnce(new Error("x"));
  monter();
  surface().focus();
  coller(SEQ);
  await attendre();
  expect(changements.length).toBe(0);
  expect(texteToasts()).toBe("Diagramme mermaid non collé : la bibliothèque mermaid n'a pas pu être chargée.");
  expect(surface().classList.contains("ya-attente")).toBe(false);
  coller("graph TD\nA --> B");
  await attendre();
  expect(dernier().boxes.length).toBe(2);
  expect(chargerMock).toHaveBeenCalledTimes(1);
  avec(traduit(2, 1));
  coller(SEQ);
  await attendre();
  expect(dernier().model).toBe(SEQ_N);
  expect(texteToasts()).toBe("");
});

test("REQ154_AC20_attente_curseur_progress_et_resultat_apres_attente", async () => {
  style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  let fin;
  chargerMock.mockReturnValue(new Promise((r) => (fin = r)));
  monter();
  surface().focus();
  const avant = statut().textContent;
  coller(SEQ);
  const vuesAvant = vues.length;
  expect(surface().classList.contains("ya-attente")).toBe(true);
  expect(getComputedStyle(surface()).cursor).toBe("progress");
  expect(getComputedStyle(t.element.querySelector('[data-id="b1"]')).cursor).toBe("progress");
  expect(getComputedStyle(t.element.querySelector(".ya-tableau-outils button")).cursor).not.toBe("progress");
  expect(texteToasts()).toBe("");
  expect(statut().textContent).toBe(avant);
  t.element.querySelector('[data-id="b1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(surface().getAttribute("aria-activedescendant")).not.toBeNull();
  t.element.querySelector(".ya-tableau-outils button").focus();
  expect(document.activeElement).not.toBe(surface());
  fin({ traduire: async () => traduit(3, 1) });
  await attendre();
  expect(surface().classList.contains("ya-attente")).toBe(false);
  expect(dernier().boxes.length).toBe(3);
  expect(surface().hasAttribute("aria-activedescendant")).toBe(false);
  expect(document.activeElement).toBe(surface());
  expect(texteToasts()).toBe("");
  expect(vues.length).toBeGreaterThan(vuesAvant);
  expect(vues.at(-1).zoom).toBeLessThanOrEqual(1);
});

test("REQ154_AC20_onglet_detruit_pendant_l_attente", async () => {
  let fin;
  chargerMock.mockReturnValue(new Promise((r) => (fin = r)));
  monter();
  surface().focus();
  coller(SEQ);
  t.detruire();
  fin({ traduire: async () => traduit() });
  await attendre();
  expect(changements.length).toBe(0);
  expect(texteToasts()).toBe("");
});

test("REQ154_AC21_AC6_refus_de_mermaid_message_exact", async () => {
  for (const [refus, attendu] of [
    ["mermaid ne sait pas le lire.", "Diagramme mermaid non collé : mermaid ne sait pas le lire."],
    ["il n'a rien à dessiner.", "Diagramme mermaid non collé : il n'a rien à dessiner."],
  ]) {
    avec({ refus });
    monter();
    surface().focus();
    coller(SEQ);
    await attendre();
    expect(texteToasts()).toBe(attendu);
    expect(changements.length).toBe(0);
    expect(vues).toHaveLength(0);
    expect(document.activeElement).toBe(surface());
    expect(document.body.textContent).not.toContain("seuls les organigrammes");
    surface().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(texteToasts()).toBe("");
    collerSeul(SEQ);
    await attendre();
    expect(texteToasts()).toBe(attendu);
    t.detruire();
    document.body.innerHTML = "";
    document.body.append(zoneToasts());
  }
});
