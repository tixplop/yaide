import { afterEach, expect, test, vi } from "vitest";
import { cadre } from "../ui/cadre.js";
import { vueEditeur } from "./editeur.js";

const faux = vi.hoisted(() => ({ vues: [], journal: [] }));
vi.mock("./claude.js", () => ({
  vueClaude: (opts) => {
    const corps = document.createElement("div");
    const saisie = document.createElement("textarea");
    corps.append(saisie);
    const v = { ...opts, corps, focus: vi.fn(() => saisie.focus()), ajuster: vi.fn(), detruire: vi.fn(() => faux.journal.push(`detruire ${opts.id}`)) };
    faux.vues.push(v);
    return v;
  },
}));
vi.mock("./opencode.js", () => ({ vueOpencode: () => ({ corps: document.createElement("div"), focus() {}, detruire() {} }) }));
vi.mock("./agent.js", () => ({ vueAgent: () => ({ corps: document.createElement("div"), focuser() {}, majListe() {}, relireReglages() {}, detruire() {} }) }));
vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

Range.prototype.getClientRects ??= () => [];
Range.prototype.getBoundingClientRect ??= () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
HTMLCanvasElement.prototype.getContext = () => null;
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute("open");
};

let editeurs = [];
afterEach(() => {
  for (const e of editeurs) e.detruire();
  editeurs = [];
  faux.vues.length = 0;
  faux.journal.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function monter(chemins = []) {
  const surActif = vi.fn();
  const surCourant = vi.fn();
  let c = null;
  const e = vueEditeur({ dire: vi.fn(), surActif, surCourant, surGroupes: (arbre, courant) => c?.definirGroupes(arbre, courant) });
  editeurs.push(e);
  c = cadre({ principal: { groupes: e.groupes() } });
  document.body.append(c);
  e.lecture(false); // la restauration est terminée
  for (const chemin of chemins) e.ouvrir({ chemin, contenu: `contenu ${chemin}`, version: "1" });
  return { e, c, surActif, surCourant };
}
const barres = () => [...document.querySelectorAll("[role=tablist]")];
const noms = (barre) => [...barre.querySelectorAll("[role=tab]")].map((t) => t.querySelector(".onglet-nom").textContent);
const actifs = () => barres().map((b) => b.querySelector("[aria-selected=true]")?.querySelector(".onglet-nom").textContent);
const groupesDom = () => [...document.querySelectorAll(".cadre-groupe")];
const onglet = (nom) => [...document.querySelectorAll("[role=tab]")].find((t) => t.querySelector(".onglet-nom").textContent === nom);
const zoneDe = (e, chemin) => [...document.querySelectorAll(".zone-code")].find((z) => z.vue.contentDOM.getAttribute("aria-label") === `Éditeur ${chemin}`);
const dernier = (f) => f.mock.calls.at(-1)[0];

test("REQ079_AC1_AC2_quatre_cotes", () => {
  const attendu = {
    droite: ["ligne", ["main.rs"], ["README.md"]],
    gauche: ["ligne", ["README.md"], ["main.rs"]],
    haut: ["colonne", ["README.md"], ["main.rs"]],
    bas: ["colonne", ["main.rs"], ["README.md"]],
  };
  for (const [zone, [sens, premier, second]] of Object.entries(attendu)) {
    const { e } = monter(["main.rs", "README.md"]);
    e.deplacer("README.md", "g1", zone);
    const decoupe = document.querySelector(".cadre-decoupe");
    expect(decoupe.dataset.sens).toBe(sens);
    expect(barres().map(noms)).toEqual([premier, second]);
    // README.md est seul dans son groupe et actif ; main.rs est actif dans le sien.
    expect(actifs().sort()).toEqual(["README.md", "main.rs"]);
    // Les deux textes sont visibles.
    expect(zoneDe(e, "README.md").hidden).toBe(false);
    expect(zoneDe(e, "main.rs").hidden).toBe(false);
    editeurs.pop().detruire();
    document.body.replaceChildren();
  }
});

test("REQ079_AC4_ajout_a_droite_et_onglet_actif", () => {
  const { e } = monter(["a.txt", "b.txt", "c.txt"]);
  e.deplacer("c.txt", "g1", "droite");
  expect(barres().map(noms)).toEqual([["a.txt", "b.txt"], ["c.txt"]]);
  // a.txt part vers le centre du groupe de droite : à droite de c.txt, actif ; b.txt reste actif à gauche (c'était l'onglet voisin).
  e.deplacer("b.txt", "g2", "centre");
  expect(barres().map(noms)).toEqual([["a.txt"], ["c.txt", "b.txt"]]);
  expect(actifs()).toEqual(["a.txt", "b.txt"]);
  // L'onglet actif du groupe de départ suit AC-014-7 : celui de droite, sinon celui de gauche.
  const { e: e2 } = monter(["x.txt", "y.txt", "z.txt"]);
  e2.deplacer("z.txt", "g1", "droite");
  e2.deplacer("y.txt", "g2", "centre");
  expect(actifs().slice(-2)).toEqual(["x.txt", "y.txt"]);
});

test("REQ079_AC5_dernier_onglet", () => {
  const { e, c } = monter(["a.txt", "b.txt"]);
  e.deplacer("b.txt", "g1", "droite");
  expect(c.querySelector(".cadre-decoupe")).not.toBeNull();
  // Le seul onglet de droite se ferme : le groupe disparaît, son voisin prend toute la place.
  onglet("b.txt").closest(".onglet-cellule").querySelector(".onglet-fermer").click();
  expect(c.querySelector(".cadre-decoupe")).toBeNull();
  expect(groupesDom().length).toBe(1);
  expect(barres().length).toBe(1);
  expect(barres()[0].getAttribute("aria-label")).toBe("Fichiers ouverts");
  // Le dernier onglet du dernier groupe se ferme : un groupe reste, avec « Aucun fichier ouvert. ».
  onglet("a.txt").closest(".onglet-cellule").querySelector(".onglet-fermer").click();
  expect(groupesDom().length).toBe(1);
  expect(c.textContent).toContain("Aucun fichier ouvert.");
  // Un onglet qui part d'un groupe en le vidant le retire aussi.
  const m = monter(["p.txt", "q.txt"]);
  m.e.deplacer("q.txt", "g1", "droite");
  m.e.deplacer("q.txt", "g1", "centre");
  expect(m.c.querySelector(".cadre-decoupe")).toBeNull();
  expect(barres().map(noms).at(-1)).toEqual(["p.txt", "q.txt"]);
});

test("REQ079_AC7_texte_point_historique_apercu_question_conserves", async () => {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    appels.push({ url: decodeURIComponent(url), methode: init?.method, corps: init?.body });
    return { ok: true, status: 200, json: async () => ({ version: "2" }) };
  }));
  const { e } = monter(["autre.txt", "notes.md"]);
  const zone = zoneDe(e, "notes.md");
  zone.vue.dispatch({ changes: { from: 0, insert: "X" } });
  zone.vue.dispatch({ changes: { from: 0, insert: "Y" } });
  // Aperçu activé.
  document.querySelector('[aria-label="Aperçu"]').click();
  expect(document.querySelector('[aria-label="Aperçu"]').getAttribute("aria-pressed")).toBe("true");
  e.deplacer("notes.md", "g1", "droite");
  expect(zoneDe(e, "notes.md")).toBe(zone);
  expect(zone.vue.state.doc.toString()).toBe("YXcontenu notes.md");
  // Le point de modification suit l'onglet dans son nouveau groupe.
  expect(onglet("notes.md").dataset.modifie).toBe("true");
  expect(onglet("autre.txt").dataset.modifie).toBeUndefined();
  expect(document.querySelector('[aria-label="Aperçu"]').getAttribute("aria-pressed")).toBe("true");
  // Historique : annuler défait la dernière frappe.
  const { undo } = await import("@codemirror/commands");
  undo(zone.vue);
  expect(zone.vue.state.doc.toString()).toBe("contenu notes.md");
  zone.vue.dispatch({ changes: { from: 0, insert: "Z" } });
  // Ctrl+S écrit le bon fichier.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(appels.some((a) => a.methode === "PUT")).toBe(true));
  const put = appels.find((a) => a.methode === "PUT");
  expect(put.url).toContain("chemin=notes.md");
  expect(put.corps).toBe("Zcontenu notes.md");
});


test("REQ079_AC8_vue_non_recreee", () => {
  const { e } = monter(["a.txt"]);
  e.ouvrirClaude({ id: "s1" });
  const vue = faux.vues[0];
  const corps = vue.corps;
  const redim = vi.fn();
  const etats = [];
  vue.ajuster.mockClear();
  vue.ajuster.mockImplementation(() => etats.push(corps.isConnected && !corps.hidden));
  window.addEventListener("resize", redim);
  e.deplacer("\0claude:s1", "g1", "droite");
  window.removeEventListener("resize", redim);
  expect(faux.vues.length).toBe(1);
  expect(vue.detruire).not.toHaveBeenCalled();
  expect(corps.isConnected).toBe(true);
  expect(corps.hidden).toBe(false);
  // Une fois par l'affichage, puis par le déplacement : le dernier appel voit le terminal en place et visible.
  expect(etats.length).toBeGreaterThan(1);
  expect(etats.at(-1)).toBe(true);
  expect(redim).toHaveBeenCalled();
  expect(faux.journal).toEqual([]);
});

test("REQ079_AC9_deux_contenus_visibles", () => {
  const { e } = monter(["a.txt", "b.txt"]);
  e.ouvrirClaude({ id: "s1" });
  e.ouvrirClaude({ id: "s2" });
  e.deplacer("\0claude:s2", "g1", "droite");
  const [v1, v2] = faux.vues;
  expect(v1.corps.hidden).toBe(false);
  expect(v2.corps.hidden).toBe(false);
  expect(v1.corps.closest(".cadre-groupe")).not.toBe(v2.corps.closest(".cadre-groupe"));
});

test("REQ079_AC9_taper_dans_l_un_ne_change_pas_l_autre", () => {
  const { e } = monter(["a.txt", "b.txt"]);
  e.deplacer("b.txt", "g1", "bas");
  zoneDe(e, "a.txt").vue.dispatch({ changes: { from: 0, insert: "X" } });
  expect(zoneDe(e, "b.txt").vue.state.doc.toString()).toBe("contenu b.txt");
  expect(zoneDe(e, "a.txt").hidden).toBe(false);
  expect(zoneDe(e, "b.txt").hidden).toBe(false);
});

test("REQ079_AC10_barre_etat_et_ctrl_s_du_groupe_courant", async () => {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    appels.push({ url: decodeURIComponent(url), methode: init?.method });
    return { ok: true, status: 200, json: async () => ({ version: "2" }) };
  }));
  const { e, surActif, surCourant } = monter(["a.rs", "b.txt"]);
  e.deplacer("b.txt", "g1", "droite");
  expect(dernier(surCourant)).toBe("b.txt");
  const [g1] = groupesDom();
  expect(barres().map((b) => b.dataset.courant)).toEqual(["false", undefined]);
  // Un pointerdown dans le groupe de gauche le rend courant, sans refaire la barre.
  const barreAvant = barres()[0];
  g1.querySelector(".zone-code").dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(dernier(surCourant)).toBe("a.rs");
  expect(dernier(surActif).langage).toBe("Rust");
  expect(barres().map((b) => b.dataset.courant)).toEqual([undefined, "false"]);
  expect(barres()[0]).toBe(barreAvant);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(appels.some((a) => a.methode === "PUT")).toBe(true));
  expect(appels.filter((a) => a.methode === "PUT").map((a) => a.url)).toEqual([expect.stringContaining("chemin=a.rs")]);
  // Le focus dans le groupe de droite le rend courant.
  document.activeElement.blur();
  zoneDe(e, "b.txt").vue.focus();
  expect(dernier(surCourant)).toBe("b.txt");
});

test("REQ079_AC10_presser_un_onglet_ne_change_pas_le_groupe_courant_le_clic_oui", async () => {
  const { e, surCourant } = monter(["a.rs", "b.txt", "c.txt"]);
  e.deplacer("c.txt", "g1", "droite");
  // Courant : le groupe de droite (c.txt). Presser l'onglet a.rs puis son focus ne change rien.
  const t = onglet("a.rs");
  t.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  t.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(dernier(surCourant)).toBe("c.txt");
  expect(barres().map((b) => b.dataset.courant)).toEqual(["false", undefined]);
  // Le clic, lui, change le groupe courant.
  t.click();
  await Promise.resolve();
  expect(dernier(surCourant)).toBe("a.rs");
  expect(barres().map((b) => b.dataset.courant)).toEqual([undefined, "false"]);
  // Le focus clavier d'un onglet, sans pression, le change aussi.
  onglet("c.txt").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(dernier(surCourant)).toBe("c.txt");
});

test("REQ079_AC11_nouvel_onglet_et_clic_arbre_sans_doublon", () => {
  const { e } = monter(["a.txt", "b.txt"]);
  e.deplacer("b.txt", "g1", "droite");
  // Courant : droite. Tout nouvel onglet s'y ouvre.
  e.ouvrir({ chemin: "c.txt", contenu: "c", version: "1" });
  e.ouvrirClaude({ id: "s1" });
  e.ouvrirAgent({});
  e.ouvrirOpencode({ sessionId: "oc1" });
  expect(barres().map(noms)).toEqual([["a.txt"], ["b.txt", "c.txt", "Claude 1", "Agent 1", "opencode 1"]]);
  // Clic dans l'arborescence sur un fichier ouvert dans l'autre groupe : il s'y active, ce groupe devient courant, sans doublon.
  e.ouvrir({ chemin: "a.txt", contenu: "a", version: "1" });
  expect(barres().map(noms)).toEqual([["a.txt"], ["b.txt", "c.txt", "Claude 1", "Agent 1", "opencode 1"]]);
  expect(barres().map((b) => b.dataset.courant)).toEqual([undefined, "false"]);
  e.ouvrir({ chemin: "z.txt", contenu: "z", version: "1" });
  expect(barres().map(noms)[0]).toEqual(["a.txt", "z.txt"]);
  // Le diff s'ouvre dans le groupe courant.
  e.ouvrirDiff({ chemin: "a.txt", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  expect(noms(barres()[0])[0]).toBe("a.txt (diff)");
});

test("REQ079_AC13_fleches_et_suppr_dans_leur_barre", () => {
  const { e } = monter(["a.txt", "b.txt", "c.txt", "d.txt"]);
  e.deplacer("c.txt", "g1", "droite");
  e.deplacer("d.txt", "g2", "centre");
  expect(barres().map(noms)).toEqual([["a.txt", "b.txt"], ["c.txt", "d.txt"]]);
  const touche = (t, key) => t.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  // Droite dans la barre de droite : reste dans cette barre.
  touche(onglet("d.txt"), "ArrowRight");
  expect(actifs()[1]).toBe("c.txt");
  expect(actifs()[0]).toBe("b.txt");
  // Suppr ferme l'onglet de sa barre, sans toucher à l'autre groupe.
  touche(onglet("c.txt"), "Delete");
  expect(barres().map(noms)).toEqual([["a.txt", "b.txt"], ["d.txt"]]);
  expect(actifs()).toEqual(["b.txt", "d.txt"]);
});

test("REQ079_AC13_fermer_dans_un_groupe_non_courant_ne_change_pas_l_autre", () => {
  const { e } = monter(["a.txt", "b.txt", "c.txt"]);
  e.deplacer("c.txt", "g1", "droite");
  e.deplacer("b.txt", "g2", "centre");
  // Courant : droite (c.txt, b.txt ; actif b.txt). On ferme a.txt, seul onglet de gauche, via sa croix.
  onglet("a.txt").closest(".onglet-cellule").querySelector(".onglet-fermer").click();
  expect(barres().map(noms)).toEqual([["c.txt", "b.txt"]]);
  expect(actifs()).toEqual(["b.txt"]);
});

test("REQ079_AC25_focus_apres_depot", () => {
  const { e, surCourant } = monter(["a.txt", "b.txt", "c.txt"]);
  e.deplacer("c.txt", "g1", "droite");
  e.deplacer("a.txt", "g2", "centre");
  expect(dernier(surCourant)).toBe("a.txt");
  expect(zoneDe(e, "a.txt").contains(document.activeElement)).toBe(true);
  expect(onglet("a.txt").closest(".cadre-groupe")).toBe(zoneDe(e, "a.txt").closest(".cadre-groupe"));
});

test("REQ079_fermeture_du_groupe_courant_focus_dans_l_onglet_actif_du_voisin", () => {
  const { e } = monter(["a.txt", "b.txt"]);
  e.deplacer("b.txt", "g1", "droite");
  onglet("b.txt").focus();
  onglet("b.txt").closest(".onglet-cellule").querySelector(".onglet-fermer").click();
  expect(groupesDom().length).toBe(1);
  expect(onglet("a.txt").closest(".cadre-groupe")).not.toBeNull();
  expect(zoneDe(e, "a.txt").hidden).toBe(false);
  expect(zoneDe(e, "a.txt").contains(document.activeElement)).toBe(true);
});

test("REQ079_groupe_qui_disparait_le_focus_de_l_autre_groupe_reste", () => {
  // Un navigateur fait perdre le focus à un élément qui change de place.
  const origine = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...args) {
    const actif = document.activeElement;
    const deplace = args.some((a) => a instanceof Element && a.contains(actif));
    origine.apply(this, args);
    if (deplace) actif.blur();
  };
  try {
    focusConserve();
  } finally {
    Element.prototype.replaceChildren = origine;
  }
});

function focusConserve() {
  const { e } = monter(["a.txt", "b.txt", "c.txt"]);
  e.deplacer("c.txt", "g1", "droite");
  e.deplacer("b.txt", "g2", "bas");
  // Trois groupes ; le focus est dans b.txt (en bas à droite). On retire c.txt (seul onglet de son groupe) : b.txt garde le focus.
  zoneDe(e, "b.txt").vue.focus();
  e.supprime({ chemin: "c.txt" }); // fichier supprimé dans l'arbre : aucun focus rendu par la fermeture
  expect(barres().length).toBe(2);
  expect(zoneDe(e, "b.txt").contains(document.activeElement)).toBe(true);
}

test("REQ079_AC4_diff_actif_deplace_le_groupe_de_depart_garde_un_onglet_actif", () => {
  const { e } = monter(["a.txt", "b.txt"]);
  e.ouvrirDiff({ chemin: "a.txt", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  e.deplacer("\0diff", "g1", "droite");
  expect(barres().map(noms)).toEqual([["a.txt", "b.txt"], ["a.txt (diff)"]]);
  expect(actifs()[0]).toBe("b.txt");
  expect(document.body.textContent).not.toContain("Aucun fichier ouvert.");
});

test("REQ079_fichier_modifie_ferme_par_le_dialogue_le_focus_va_au_voisin", async () => {
  const { e } = monter(["a.txt", "b.txt"]);
  e.deplacer("b.txt", "g1", "droite");
  zoneDe(e, "b.txt").vue.dispatch({ changes: { from: 0, insert: "X" } });
  onglet("b.txt").closest(".onglet-cellule").querySelector(".onglet-fermer").click();
  [...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Abandonner").click();
  await vi.waitFor(() => expect(barres().length).toBe(1));
  await vi.waitFor(() => expect(zoneDe(e, "a.txt").contains(document.activeElement)).toBe(true));
});

test("REQ079_AC27_noms_et_ordre_des_barres", () => {
  const { e } = monter(["a.txt", "b.txt", "c.txt"]);
  expect(barres().map((b) => b.getAttribute("aria-label"))).toEqual(["Fichiers ouverts"]);
  e.deplacer("c.txt", "g1", "droite");
  e.deplacer("b.txt", "g2", "bas");
  // Ordre de l'arbre en profondeur : g1, puis g2 (c.txt), puis g3 (b.txt).
  expect(barres().map((b) => b.getAttribute("aria-label"))).toEqual(["Fichiers ouverts, groupe 1", "Fichiers ouverts, groupe 2", "Fichiers ouverts, groupe 3"]);
  expect(barres().map(noms)).toEqual([["a.txt"], ["c.txt"], ["b.txt"]]);
  // Un groupe disparaît : les rangs suivent.
  onglet("c.txt").closest(".onglet-cellule").querySelector(".onglet-fermer").click();
  expect(barres().map((b) => b.getAttribute("aria-label"))).toEqual(["Fichiers ouverts, groupe 1", "Fichiers ouverts, groupe 2"]);
});

test("REQ079_AC6_deplacer_refuse_dans_son_propre_groupe", () => {
  const { e } = monter(["a.txt", "b.txt"]);
  e.deplacer("a.txt", "g1", "centre");
  expect(barres().map(noms)).toEqual([["a.txt", "b.txt"]]);
  const seul = monter(["x.txt"]);
  seul.e.deplacer("x.txt", "g1", "droite");
  expect(seul.c.querySelectorAll(".cadre-groupe").length).toBe(1);
});

test("REQ079_defilement_conserve", () => {
  // Un navigateur remet le défilement à zéro quand un élément change de place.
  const origines = {};
  for (const m of ["append", "replaceChildren", "prepend"]) {
    origines[m] = Element.prototype[m];
    Element.prototype[m] = function (...args) {
      origines[m].apply(this, args);
      for (const a of args) if (a instanceof Element) for (const x of [a, ...a.querySelectorAll("*")]) x.scrollTop = 0;
    };
  }
  try {
    const { e } = monter(["a.txt", "b.txt", "c.txt"]);
    e.deplacer("c.txt", "g1", "droite");
    const defilant = zoneDe(e, "a.txt").querySelector(".cm-scroller");
    const autre = zoneDe(e, "c.txt").querySelector(".cm-scroller");
    defilant.scrollTop = 120;
    autre.scrollTop = 40;
    // La vue déplacée (b.txt n'est pas visible : on déplace a.txt, actif de son groupe) et les groupes réordonnés défilent encore.
    e.deplacer("a.txt", "g2", "gauche");
    expect(defilant.scrollTop).toBe(120);
    expect(autre.scrollTop).toBe(40);
  } finally {
    for (const [m, f] of Object.entries(origines)) Element.prototype[m] = f;
  }
});

test("REQ079_AC7_question_en_attente_conservee", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST") return { ok: true, status: 200, json: async () => ({ "a.txt": "9" }) };
    return { ok: true, status: 200, headers: new Headers({ "x-version": "9" }), text: async () => "autre" };
  }));
  const { e } = monter(["a.txt", "b.txt"]);
  await e.restaurer();
  zoneDe(e, "a.txt").vue.dispatch({ changes: { from: 0, insert: "X" } });
  await e.relireDisque();
  expect(onglet("a.txt").getAttribute("aria-label")).toContain("question en attente");
  e.deplacer("a.txt", "g1", "droite");
  expect(onglet("a.txt").getAttribute("aria-label")).toContain("question en attente");
  // La question suit son onglet dans le groupe d'arrivée.
  const questions = [...document.querySelectorAll(".cadre-question")];
  expect(questions[0].textContent).toBe("");
  expect(questions[1].textContent).toContain("a.txt a changé sur le disque");
});
