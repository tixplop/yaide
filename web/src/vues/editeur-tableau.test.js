import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { lire } from "../stockage.js";
import { ecrireJdiag } from "../jdiag.js";
import { themeWhiteboard } from "../ui/theme.js";
import { vueEditeur } from "./editeur.js";
import { cadre } from "../ui/cadre.js";

vi.mock("./claude.js", () => ({ vueClaude: () => ({ corps: document.createElement("div"), focus() {}, ajuster() {}, detruire() {} }) }));
vi.mock("./opencode.js", () => ({ vueOpencode: () => ({ corps: document.createElement("div"), focus() {}, detruire() {} }) }));
const faux = vi.hoisted(() => ({ ag: [] }));
vi.mock("./agent.js", () => ({
  vueAgent: (opts) => {
    const v = { ...opts, corps: document.createElement("div"), focuser() {}, majListe() {}, relireReglages() {}, detruire() {} };
    faux.ag.push(v);
    return v;
  },
}));
vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

Range.prototype.getClientRects ??= () => [];
Range.prototype.getBoundingClientRect ??= () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute("open");
};

const DOC = {
  version: 1,
  boxes: [
    { id: "b1", x: 100, y: 100, width: 160, height: 80, text: "Début" },
    { id: "b2", x: 400, y: 100, width: 160, height: 80, text: "Fin" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2" }],
};
const TEXTE = ecrireJdiag(DOC);

let editeurs = [];
let serveur;
/** Faux serveur de fichiers : `fichiers` (chemin -> texte), `versions`, `ecritures` (chemin, corps). */
function fauxServeur(fichiers) {
  serveur = { fichiers: { ...fichiers }, versions: Object.fromEntries(Object.keys(fichiers).map((c) => [c, "1"])), ecritures: [] };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const u = new URL(String(url), "http://x");
    const chemin = u.searchParams.get("chemin");
    if (u.pathname === "/api/fichiers/versions") return { ok: true, status: 200, json: async () => ({ ...serveur.versions }) };
    if (init?.method === "PUT") {
      serveur.ecritures.push([chemin, init.body]);
      serveur.fichiers[chemin] = init.body;
      serveur.versions[chemin] = String(Number(serveur.versions[chemin] ?? "0") + 1);
      return { ok: true, status: 200, json: async () => ({ version: serveur.versions[chemin] }) };
    }
    if (!(chemin in serveur.fichiers)) return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "Introuvable." }) };
    return { ok: true, status: 200, headers: new Headers({ "x-version": serveur.versions[chemin] }), text: async () => serveur.fichiers[chemin] };
  }));
}
/** Ajoute des fichiers au faux serveur courant. */
function fauxServeur2(fichiers) {
  for (const [c, t] of Object.entries(fichiers)) {
    serveur.fichiers[c] = t;
    serveur.versions[c] = "1";
  }
}
/** Un fichier changé « sur le disque » par un autre outil. */
function changerSurDisque(chemin, texte) {
  serveur.fichiers[chemin] = texte;
  serveur.versions[chemin] = String(Number(serveur.versions[chemin]) + 1);
}

function monter(options = {}) {
  const surActif = vi.fn();
  const e = vueEditeur({ dire: vi.fn(), surActif, ...options });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.question, e.code);
  e.lecture(false);
  return { e, surActif };
}
async function ouvrir(e, chemin) {
  const l = await (await fetch(`/api/fichier?chemin=${encodeURIComponent(chemin)}`)).text();
  await e.ouvrir({ chemin, contenu: l, version: serveur.versions[chemin] });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
});
afterEach(() => {
  for (const e of editeurs) e.detruire();
  editeurs = [];
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const onglets = () => [...document.querySelectorAll("[role=tab]")];
const nomsOnglets = () => onglets().map((t) => t.querySelector(".onglet-nom").textContent);
const onglet = (nom) => onglets().find((t) => t.querySelector(".onglet-nom").textContent === nom);
const surface = () => document.querySelector(".ya-tableau-zone:not([hidden]) [role=application]");
const zone = () => document.querySelector(".ya-tableau-zone:not([hidden])");
const textes = () => [...zone().querySelectorAll("[data-id] .ya-tableau-texte")].map((x) => x.textContent);
const touche = (cible, key) => cible.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const ctrlS = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
const bouton = (nom) => document.querySelector(`.onglets-droite button[aria-label="${nom}"]`);
const zoomAffiche = () => document.querySelector(".onglets-droite [role=status]")?.textContent;
// Descend la première boîte de 10 px : Tab la choisit, Bas la déplace.
const deplacerBoite = () => {
  touche(surface(), "Tab");
  touche(surface(), "ArrowDown");
};
const attendre = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test("REQ128_AC1_AC8_AC9_ouverture_par_ouvrir_ouvrirCitee_et_reference_sans_doublon", async () => {
  fauxServeur({ "docs/plan.jdiag": TEXTE, "PLAN.JDIAG": TEXTE, "a.txt": "x" });
  const { e, surActif } = monter();
  await ouvrir(e, "docs/plan.jdiag");
  expect(nomsOnglets()).toEqual(["plan.jdiag"]);
  expect(onglet("plan.jdiag").getAttribute("aria-selected")).toBe("true");
  expect(textes()).toEqual(["Début", "Fin"]);
  expect(zone().querySelectorAll("[aria-roledescription=lien]")).toHaveLength(1);
  expect(e.code.querySelector(".zone-code")).toBeNull();
  expect(document.querySelector("[role=alert], .ya-message")).toBeNull();
  // AC-128-8 et AC-128-9 : focus sur la surface, rôle, nom, fil d'Ariane, barre d'état.
  expect(document.activeElement).toBe(surface());
  expect(surface().getAttribute("aria-label")).toBe("plan.jdiag");
  expect(surface().getAttribute("role")).toBe("application");
  expect(surface().getAttribute("aria-roledescription")).toBe("whiteboard");
  expect(surface().tabIndex).toBe(0);
  expect([...e.fil.querySelectorAll("span")].map((s) => s.textContent)).toEqual(["docs", "plan.jdiag"]);
  expect(surActif.mock.calls.at(-1)[0]).toEqual({ position: undefined, langage: undefined });
  // Par ouvrirCitee : un autre fichier, puis le même sans doublon.
  await e.ouvrirCitee({ chemin: "PLAN.JDIAG" });
  expect(nomsOnglets()).toEqual(["plan.jdiag", "PLAN.JDIAG"]);
  expect(textes()).toEqual(["Début", "Fin"]);
  await e.ouvrirCitee({ chemin: "docs/plan.jdiag" });
  await e.ouvrirCitee({ chemin: "docs/plan.jdiag" });
  expect(nomsOnglets()).toEqual(["plan.jdiag", "PLAN.JDIAG"]);
  expect(onglet("plan.jdiag").getAttribute("aria-selected")).toBe("true");
  // Par une référence de conversation : deux fois, un seul onglet, les boîtes affichées.
  fauxServeur2({ "ref.jdiag": TEXTE });
  e.ouvrirAgent({ equipe: [] });
  await faux.ag.at(-1).ouvrirReference({ chemin: "ref.jdiag" });
  await faux.ag.at(-1).ouvrirReference({ chemin: "ref.jdiag" });
  expect(nomsOnglets().filter((n) => n === "ref.jdiag")).toHaveLength(1);
  expect(onglet("ref.jdiag").getAttribute("aria-selected")).toBe("true");
  expect(textes()).toEqual(["Début", "Fin"]);
  // Entrée sur l'onglet (un clic) : le focus va sur la surface.
  await ouvrir(e, "a.txt");
  expect(zone()).toBeNull();
  onglet("plan.jdiag").focus();
  onglet("plan.jdiag").click();
  await Promise.resolve();
  expect(document.activeElement).toBe(surface());
});

test("REQ128_AC2_AC7_un_changement_donne_le_point_et_ctrl_s_ecrit_le_format", async () => {
  fauxServeur({ "plan.jdiag": TEXTE });
  const { e } = monter();
  await ouvrir(e, "plan.jdiag");
  expect(onglet("plan.jdiag").dataset.modifie).toBeUndefined();
  // AC-128-7 : zoomer ne donne pas de point.
  bouton("Zoom avant").click();
  expect(onglet("plan.jdiag").dataset.modifie).toBeUndefined();
  deplacerBoite();
  expect(onglet("plan.jdiag").dataset.modifie).toBe("true");
  expect(serveur.ecritures).toEqual([]);
  ctrlS();
  await vi.waitFor(() => expect(serveur.ecritures).toHaveLength(1));
  const attendu = ecrireJdiag({ ...DOC, boxes: [{ ...DOC.boxes[0], y: 110 }, DOC.boxes[1]] });
  expect(serveur.ecritures[0]).toEqual(["plan.jdiag", attendu]);
  await vi.waitFor(() => expect(onglet("plan.jdiag").dataset.modifie).toBeUndefined());
});

test("REQ128_AC7_ni_apercu_ni_hybride_ni_formatage_et_pas_de_point_au_zoom", async () => {
  fauxServeur({ "plan.jdiag": TEXTE });
  const { e } = monter();
  await ouvrir(e, "plan.jdiag");
  expect(document.querySelector('button[aria-label="Aperçu"], button[aria-label="Mode hybride"]')).toBeNull();
  expect(e.peutFormater()).toBe(false);
  bouton("Tout afficher").click();
  bouton("Zoom arrière").click();
  expect(onglet("plan.jdiag").dataset.modifie).toBeUndefined();
});

test("REQ128_AC3_brouillon_restaure_avec_son_point_puis_abandon_rend_le_disque", async () => {
  fauxServeur({ "plan.jdiag": TEXTE });
  const brouillon = ecrireJdiag({ ...DOC, boxes: [...DOC.boxes, { id: "b3", x: 3000, y: 2000, width: 160, height: 80, text: "Neuf" }] });
  lire.mockResolvedValueOnce({ liste: [{ groupe: "g1", chemin: "plan.jdiag", texte: brouillon, base: TEXTE, version: "1" }], actif: "plan.jdiag" });
  const { e } = monter();
  await e.restaurer();
  expect(textes()).toEqual(["Début", "Fin", "Neuf"]);
  expect(onglet("plan.jdiag").dataset.modifie).toBe("true");
  // Ctrl+S écrit le brouillon, le point disparaît.
  ctrlS();
  await vi.waitFor(() => expect(serveur.ecritures).toEqual([["plan.jdiag", brouillon]]));
  await vi.waitFor(() => expect(onglet("plan.jdiag").dataset.modifie).toBeUndefined());
  deplacerBoite();
  expect(onglet("plan.jdiag").dataset.modifie).toBe("true");
  // AC-128-10 : à l'ouverture, toutes les boîtes visibles, 100 % au plus.
  expect(zoomAffiche()).toMatch(/^\d+\u00a0%$/);
  expect(Number.parseInt(zoomAffiche(), 10)).toBeLessThan(100);
  onglet("plan.jdiag").closest(".onglet-cellule").querySelector(".onglet-fermer").click();
  const abandonner = [...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Abandonner");
  expect(document.querySelector("dialog").textContent).toContain("Sauvegarder plan.jdiag ?");
  abandonner.click();
  expect(nomsOnglets()).toEqual([]);
  await ouvrir(e, "plan.jdiag");
  expect(textes()).toEqual(["Début", "Fin", "Neuf"]); // le disque : le brouillon écrit par Ctrl+S, sans le déplacement abandonné
  expect(serveur.ecritures).toHaveLength(1);
  expect(onglet("plan.jdiag").dataset.modifie).toBeUndefined();
});

test("REQ128_AC4_fichier_change_suit_sans_modification_et_pose_la_question_avec_modification", async () => {
  fauxServeur({ "a.jdiag": TEXTE, "b.jdiag": TEXTE });
  const { e } = monter();
  await e.restaurer();
  await ouvrir(e, "a.jdiag");
  const autre = ecrireJdiag({ ...DOC, boxes: [{ ...DOC.boxes[0], text: "Ailleurs" }], links: [] });
  changerSurDisque("a.jdiag", autre);
  await e.relireDisque();
  await vi.waitFor(() => expect(textes()).toEqual(["Ailleurs"]));
  expect(onglet("a.jdiag").dataset.modifie).toBeUndefined();
  // Avec une modification : la question, puis « Prendre celle du disque ».
  deplacerBoite();
  expect(onglet("a.jdiag").dataset.modifie).toBe("true");
  changerSurDisque("a.jdiag", TEXTE);
  await e.relireDisque();
  await vi.waitFor(() => expect(document.body.textContent).toContain("a.jdiag a changé sur le disque. Quelle version garder ?"));
  expect(textes()).toEqual(["Ailleurs"]);
  [...document.querySelectorAll("button")].find((b) => b.textContent === "Prendre celle du disque").click();
  expect(textes()).toEqual(["Début", "Fin"]);
  expect(onglet("a.jdiag").dataset.modifie).toBeUndefined();
});

test("REQ128_AC5_renommage_suivi_et_suppression_ferme_l_onglet", async () => {
  fauxServeur({ "plan.jdiag": TEXTE });
  const { e } = monter();
  await ouvrir(e, "plan.jdiag");
  e.renomme({ de: "plan.jdiag", vers: "docs/flux.jdiag" });
  expect(nomsOnglets()).toEqual(["flux.jdiag"]);
  expect(surface().getAttribute("aria-label")).toBe("flux.jdiag");
  expect(textes()).toEqual(["Début", "Fin"]);
  expect([...e.fil.querySelectorAll("span")].map((s) => s.textContent)).toEqual(["docs", "flux.jdiag"]);
  e.supprime({ chemin: "docs/flux.jdiag" });
  expect(nomsOnglets()).toEqual([]);
});

test("REQ128_AC6_AC8_AC9_vide_sans_point_et_ctrl_s_ecrit_le_format_complet", async () => {
  fauxServeur({ "vide.jdiag": "" });
  const { e } = monter();
  await ouvrir(e, "vide.jdiag");
  expect(surface()).not.toBeNull();
  expect(textes()).toEqual([]);
  expect(onglet("vide.jdiag").dataset.modifie).toBeUndefined();
  expect(document.querySelector("[role=alert], .ya-message")).toBeNull();
  ctrlS();
  await vi.waitFor(() => expect(serveur.ecritures).toEqual([["vide.jdiag", ecrireJdiag({ version: 1, boxes: [], links: [] })]]));
  await attendre();
  expect(onglet("vide.jdiag").dataset.modifie).toBeUndefined();
});

test("REQ128_AC6_AC8_AC9_illisible_message_sans_surface_ni_barre_ctrl_s_n_ecrit_rien_puis_relisible", async () => {
  fauxServeur({ "casse.jdiag": '{"boxes": 3}', "texte.jdiag": "pas du json" });
  const { e, surActif } = monter();
  await e.restaurer();
  await ouvrir(e, "casse.jdiag");
  expect(surface()).toBeNull();
  const z = zone();
  expect(z.getAttribute("role")).toBe("region");
  expect(z.getAttribute("aria-label")).toBe("casse.jdiag");
  expect(z.getAttribute("tabindex")).toBe("-1");
  const statut = z.querySelector("[role=status]");
  expect(statut.textContent).toBe("casse.jdiag n'est pas un whiteboard lisible.");
  expect(z.textContent).toContain("Pour le corriger, renommez-le en .json : il s'ouvrira en texte.");
  expect(statut.textContent).not.toContain("Pour le corriger");
  expect(document.activeElement).toBe(z);
  expect(document.querySelector(".onglets-droite")).toBeNull();
  expect(surActif.mock.calls.at(-1)[0]).toEqual({ position: undefined, langage: undefined });
  ctrlS();
  await attendre();
  expect(serveur.ecritures).toEqual([]);
  await ouvrir(e, "texte.jdiag");
  expect(zone().querySelector("[role=status]").textContent).toBe("texte.jdiag n'est pas un whiteboard lisible.");
  ctrlS();
  await attendre();
  expect(serveur.ecritures).toEqual([]);
  // Redevenu lisible sur le disque : le dessin s'affiche, avec sa barre d'outils.
  onglet("casse.jdiag").click();
  changerSurDisque("casse.jdiag", TEXTE);
  await e.relireDisque();
  await vi.waitFor(() => expect(textes()).toEqual(["Début", "Fin"]));
  expect(bouton("Ajouter une boîte")).not.toBeNull();
  expect(onglet("casse.jdiag").dataset.modifie).toBeUndefined();
});

test("REQ131_AC3_AC5_barre_d_outils_ordre_info_bulles_zoom_affiche_et_bornes", async () => {
  fauxServeur({ "plan.jdiag": ecrireJdiag({ version: 1, boxes: [], links: [] }), "a.txt": "x" });
  const { e } = monter();
  await ouvrir(e, "plan.jdiag");
  const droite = document.querySelector(".onglets-droite");
  expect([...droite.children].map((x) => x.querySelector("button")?.getAttribute("aria-label") ?? x.getAttribute("role"))).toEqual(["Ajouter une boîte", "Zoom arrière", "status", "Zoom avant", "Tout afficher", "Thème clair du whiteboard"]);
  expect([...droite.querySelectorAll("button")].every((b) => b.closest(".bouton-enveloppe"))).toBe(true);
  // Info-bulle de chaque bouton : son nom, sans touche.
  vi.useFakeTimers();
  for (const nom of ["Ajouter une boîte", "Zoom arrière", "Zoom avant", "Tout afficher", "Thème clair du whiteboard"]) {
    bouton(nom).closest(".bouton-enveloppe").dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(500);
    expect(document.querySelector(".info-bulle[data-ouverte]")?.textContent, nom).toBe(nom);
    bouton(nom).closest(".bouton-enveloppe").dispatchEvent(new Event("pointerleave"));
  }
  vi.useRealTimers();
  // Ordre de Tab : la surface suit « Tout afficher » et est un arrêt de Tab.
  expect(bouton("Tout afficher").compareDocumentPosition(surface()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(surface().tabIndex).toBe(0);
  expect([...droite.querySelectorAll("button")].every((b) => b.tabIndex === 0)).toBe(true);
  expect(zoomAffiche()).toBe("100\u00a0%");
  expect(droite.querySelector("[role=status]").tabIndex).toBe(-1);
  bouton("Zoom avant").click();
  expect(zoomAffiche()).toBe("125\u00a0%");
  bouton("Zoom arrière").click();
  expect(zoomAffiche()).toBe("100\u00a0%");
  for (let i = 0; i < 5; i++) bouton("Zoom avant").click();
  expect(zoomAffiche()).toBe("400\u00a0%");
  expect(bouton("Zoom avant").getAttribute("aria-disabled")).toBe("true");
  expect(bouton("Zoom avant").disabled).toBe(false);
  bouton("Zoom avant").focus();
  bouton("Zoom avant").click();
  expect(zoomAffiche()).toBe("400\u00a0%");
  expect(document.activeElement).toBe(bouton("Zoom avant"));
  expect(bouton("Zoom arrière").hasAttribute("aria-disabled")).toBe(false);
  for (let i = 0; i < 8; i++) bouton("Zoom arrière").click();
  expect(zoomAffiche()).toBe("25\u00a0%");
  expect(bouton("Zoom arrière").getAttribute("aria-disabled")).toBe("true");
  expect(bouton("Zoom avant").hasAttribute("aria-disabled")).toBe(false);
  // Ajouter une boîte : une boîte en saisie et un point.
  bouton("Ajouter une boîte").click();
  expect(textes()).toEqual([""]);
  expect(zone().querySelector("[contenteditable]")).not.toBeNull();
  expect(onglet("plan.jdiag").dataset.modifie).toBe("true");
  // Onglet qui n'est pas un whiteboard : aucun de ces éléments.
  await ouvrir(e, "a.txt");
  expect(document.querySelector(".onglets-droite [role=status]")).toBeNull();
  expect(bouton("Zoom avant")).toBeNull();
});

test("REQ133_AC6_les_choix_de_la_boite_a_outils_ne_sont_pas_gardes_au_rechargement", async () => {
  fauxServeur({ "plan.jdiag": TEXTE });
  let m = monter();
  await ouvrir(m.e, "plan.jdiag");
  const presse = (nom) => zone().querySelector(`[role=toolbar] button[aria-label="${nom}"]`).getAttribute("aria-pressed");
  zone().querySelector('[role=toolbar] button[aria-label="Coudé"]').click();
  zone().querySelector('[role=toolbar] button[aria-label="Cercle"]').click();
  expect([presse("Coudé"), presse("Cercle")]).toEqual(["true", "true"]);
  m.e.detruire();
  editeurs.pop();
  document.body.replaceChildren();
  m = monter();
  await ouvrir(m.e, "plan.jdiag");
  expect([presse("Droit"), presse("Choisir"), presse("Coudé"), presse("Cercle")]).toEqual(["true", "true", "false", "false"]);
});

const THEME = "Thème clair du whiteboard";
const zones = () => [...document.querySelectorAll(".ya-tableau-zone")];

test("REQ143_AC1_clic_zone_en_clair_html_inchange_sans_point_aria_pressed_second_clic", async () => {
  fauxServeur({ "plan.jdiag": TEXTE });
  document.documentElement.setAttribute("data-theme", "dark");
  const { e } = monter();
  await ouvrir(e, "plan.jdiag");
  expect(zone().dataset.theme).toBeUndefined();
  expect(bouton(THEME).getAttribute("aria-pressed")).toBe("false");
  bouton(THEME).click();
  expect(zone().dataset.theme).toBe("light");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(onglet("plan.jdiag").dataset.modifie).toBeUndefined();
  expect(bouton(THEME).getAttribute("aria-pressed")).toBe("true");
  expect(serveur.ecritures).toEqual([]);
  bouton(THEME).click();
  expect(zone().dataset.theme).toBe("dark");
  expect(bouton(THEME).getAttribute("aria-pressed")).toBe("false");
});

test("REQ143_AC2_deux_groupes_ensemble_theme_de_yaide_sans_effet_apres_choix_onglet_cree_avec_le_choix", async () => {
  fauxServeur({ "a.jdiag": TEXTE, "b.jdiag": TEXTE });
  let c = null;
  const { e } = monter({ surGroupes: (arbre, courant) => c?.definirGroupes(arbre, courant) });
  c = cadre({ principal: { groupes: e.groupes() } });
  document.body.append(c);
  await ouvrir(e, "a.jdiag");
  await ouvrir(e, "b.jdiag");
  e.deplacer("b.jdiag", "g1", "droite");
  expect(zones().length).toBe(2);
  bouton(THEME).click();
  expect(zones().map((z) => z.dataset.theme)).toEqual(["light", "light"]);
  expect(themeWhiteboard()).toBe("light");
  document.dispatchEvent(new CustomEvent("yaide-theme", { detail: "dark" }));
  expect(zones().map((z) => z.dataset.theme)).toEqual(["light", "light"]);
  fauxServeur2({ "c.jdiag": TEXTE });
  await ouvrir(e, "c.jdiag");
  expect(zones().map((z) => z.dataset.theme)).toEqual(["light", "light", "light"]);
  bouton(THEME).click();
  expect(zones().map((z) => z.dataset.theme)).toEqual(["dark", "dark", "dark"]);
});

test("REQ143_AC3_sans_choix_suit_le_theme_de_yaide", async () => {
  fauxServeur({ "plan.jdiag": TEXTE });
  document.documentElement.setAttribute("data-theme", "light");
  const { e } = monter();
  await ouvrir(e, "plan.jdiag");
  expect(bouton(THEME).getAttribute("aria-pressed")).toBe("true");
  document.documentElement.setAttribute("data-theme", "dark");
  document.dispatchEvent(new CustomEvent("yaide-theme", { detail: "dark" }));
  expect(bouton(THEME).getAttribute("aria-pressed")).toBe("false");
  expect(zone().dataset.theme).toBeUndefined();
  expect(themeWhiteboard()).toBeNull();
});

test("REQ143_AC4_nom_icone_info_bulle_tab_focus_gardé_et_pas_de_bouton_ailleurs", async () => {
  fauxServeur({ "plan.jdiag": TEXTE, "a.txt": "x", "casse.jdiag": "pas du json" });
  const { e } = monter();
  await ouvrir(e, "plan.jdiag");
  const b = bouton(THEME);
  expect(b.querySelector("svg")).not.toBeNull();
  expect(b.innerHTML).toContain('r="4"');
  expect(b.tabIndex).toBe(0);
  const boutons = [...document.querySelectorAll(".onglets-droite button")];
  expect(boutons.at(-2).getAttribute("aria-label")).toBe("Tout afficher");
  expect(boutons.at(-1)).toBe(b);
  vi.useFakeTimers();
  b.closest(".bouton-enveloppe").dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(500);
  expect(document.querySelector(".info-bulle[data-ouverte]")?.textContent).toBe(THEME);
  vi.useRealTimers();
  b.focus();
  b.click();
  expect(document.activeElement).toBe(bouton(THEME));
  await ouvrir(e, "a.txt");
  expect(bouton(THEME)).toBeNull();
  await ouvrir(e, "casse.jdiag");
  expect(bouton(THEME)).toBeNull();
});
