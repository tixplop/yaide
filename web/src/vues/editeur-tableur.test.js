import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { vueEditeur } from "./editeur.js";
import { cadre } from "../ui/cadre.js";
import { themeTableur } from "../ui/theme.js";

vi.mock("./claude.js", () => ({ vueClaude: () => ({ corps: document.createElement("div"), focus() {}, ajuster() {}, detruire() {} }) }));
vi.mock("./opencode.js", () => ({ vueOpencode: () => ({ corps: document.createElement("div"), focus() {}, detruire() {} }) }));
vi.mock("./agent.js", () => ({ vueAgent: () => ({ corps: document.createElement("div"), focuser() {}, majListe() {}, relireReglages() {}, detruire() {} }) }));
vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

Range.prototype.getClientRects ??= () => [];
Range.prototype.getBoundingClientRect ??= () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });

const CLIENTS = 'nom,ville,note\nAlice,Paris,12\n"Bob, fils",Lyon,"dit ""oui"""\nChloé,Nantes\n';

let editeurs = [];
let serveur;
function fauxServeur(fichiers) {
  serveur = { fichiers: { ...fichiers }, versions: Object.fromEntries(Object.keys(fichiers).map((c) => [c, "1"])), ecritures: [] };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const u = new URL(String(url), "http://x");
    const chemin = u.searchParams.get("chemin");
    if (u.pathname === "/api/fichiers/versions") return { ok: true, status: 200, json: async () => ({ ...serveur.versions }) };
    if (init?.method === "PUT") {
      serveur.ecritures.push([chemin, init.body]);
      serveur.fichiers[chemin] = init.body;
      serveur.versions[chemin] = String(Number(serveur.versions[chemin]) + 1);
      return { ok: true, status: 200, json: async () => ({ version: serveur.versions[chemin] }) };
    }
    return { ok: true, status: 200, headers: new Headers({ "x-version": serveur.versions[chemin] }), text: async () => serveur.fichiers[chemin] };
  }));
}
function monter() {
  const surActif = vi.fn();
  const e = vueEditeur({ dire: vi.fn(), surActif });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.question, e.code);
  e.lecture(false);
  return { e, surActif };
}
const ouvrir = (e, chemin, contenu) => e.ouvrir({ chemin, contenu, version: "1" });

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
});
afterEach(() => {
  for (const e of editeurs) e.detruire();
  editeurs = [];
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const hybride = () => document.querySelector('button[aria-label="Mode hybride"]');
const zoneActive = () => document.querySelector(".zone-code:not([hidden])");
const vue = () => zoneActive().vue;
const texte = () => vue().state.doc.toString();
const grille = () => zoneActive().querySelector(".ya-tableur:not([hidden])");
const cellules = () => [...grille().querySelectorAll("th, td")].map((c) => c.textContent);
const cellule = (r, c) => grille().querySelector("table").rows[r].cells[c];
const alerte = () => document.querySelector("[role=alert].ya-alerte-tableur");
const point = (nom) => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.includes(nom)).dataset.modifie;
const clic = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const touche = (el, key, opts = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
const saisir = (c, valeur) => {
  clic(c);
  const span = grille().querySelector("[role=textbox]");
  span.textContent = valeur;
  touche(span, "Enter");
};
const inserer = (pos, t) => vue().dispatch({ changes: { from: pos, insert: t }, selection: { anchor: pos + t.length } });
const microtaches = () => new Promise((r) => setTimeout(r, 0));

test("REQ157_AC1_AC14_ouverture_en_grille_bouton_sur_csv_seulement_diff_sans_grille", () => {
  const { e, surActif } = monter();
  ouvrir(e, "main.rs", "fn main() {}");
  expect(hybride()).toBeNull();
  ouvrir(e, "Données.CSV", CLIENTS);
  expect(hybride().getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector("button[aria-label=Aperçu]")).toBeNull();
  expect(cellules()).toEqual(["nom", "ville", "note", "Alice", "Paris", "12", "Bob, fils", "Lyon", 'dit "oui"', "Chloé", "Nantes", ""]);
  expect(grille().querySelector("table").rows).toHaveLength(4);
  expect(zoneActive().querySelector(".zone-code-editeur").hidden).toBe(true);
  expect(point("Données.CSV")).toBeUndefined();
  expect(document.activeElement).toBe(cellule(0, 0));
  // Ctrl+Z sans effet, barre d'état sans position ni langage
  touche(cellule(0, 0), "z", { ctrlKey: true });
  expect(texte()).toBe(CLIENTS);
  expect(surActif).toHaveBeenLastCalledWith({ position: undefined, langage: undefined });
  e.ouvrirDiff({ chemin: "Données.CSV", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  expect(hybride()).toBeNull();
  expect(document.querySelector(".zone-code-diff .ya-tableur")).toBeNull();
});

test("REQ157_AC2_AC14_bascule_texte_puis_grille_et_etat_rouvert", () => {
  const { surActif, e } = monter();
  ouvrir(e, "clients.csv", CLIENTS);
  hybride().focus();
  hybride().click();
  expect(hybride().getAttribute("aria-pressed")).toBe("false");
  expect(zoneActive().querySelector(".zone-code-editeur").hidden).toBe(false);
  expect(zoneActive().querySelector(".ya-tableur").hidden).toBe(true);
  expect(texte()).toBe(CLIENTS);
  expect(document.activeElement).toBe(hybride());
  expect(surActif).toHaveBeenLastCalledWith({ position: "Ln 1, Col 1", langage: "Texte" });
  hybride().click();
  expect(hybride().getAttribute("aria-pressed")).toBe("true");
  expect(grille()).not.toBeNull();
  expect(document.activeElement).toBe(hybride());
});

test("REQ157_AC2_mode_eteint_garde_dans_la_liste_et_onglet_rouvert_en_grille", async () => {
  vi.resetModules();
  const garder = vi.fn();
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder, retrouver: async () => ({ liste: [{ chemin: "clients.csv", hybride: false }], actif: "clients.csv", disposition: { arbre: { id: "g1", actif: "clients.csv" }, courant: "g1" } }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => CLIENTS })));
  try {
  const { vueEditeur: neuf } = await import("./editeur.js");
  const e = neuf({ dire: vi.fn() });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.question, e.code);
  await e.restaurer();
  expect(hybride().getAttribute("aria-pressed")).toBe("false");
  expect(grille()).toBeNull();
  expect(zoneActive().querySelector(".zone-code-editeur").hidden).toBe(false);
  hybride().click();
  expect(grille()).not.toBeNull();
  await vi.waitFor(() => expect(garder).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ chemin: "clients.csv", hybride: true })]), "clients.csv", expect.anything()));
  // mode éteint de nouveau : gardé dans la liste
  hybride().click();
  await vi.waitFor(() => expect(garder).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ chemin: "clients.csv", hybride: false })]), "clients.csv", expect.anything()));
  } finally {
    vi.doUnmock("../onglets-fichiers.js");
    vi.resetModules();
  }
});

test("REQ157_AC2_onglet_ferme_puis_rouvert_repart_en_grille", () => {
  const { e } = monter();
  ouvrir(e, "clients.csv", CLIENTS);
  hybride().click();
  expect(grille()).toBeNull();
  e.detruire();
  editeurs = [];
  document.body.replaceChildren();
  const { e: e2 } = monter();
  ouvrir(e2, "clients.csv", CLIENTS);
  expect(hybride().getAttribute("aria-pressed")).toBe("true");
  expect(grille()).not.toBeNull();
});

test("REQ157_AC9_AC16_guillemet_non_ferme_texte_message_une_mutation_puis_retour_de_la_grille", async () => {
  const { e } = monter();
  const casse = 'nom,ville\nAlice,Paris\n"Bob, fils,Lyon\n';
  ouvrir(e, "casse.csv", casse);
  expect(alerte().textContent).toBe("Tableur indisponible : guillemet non fermé à la ligne 3.");
  expect(alerte().parentNode).toBe(e.question);
  expect(hybride().getAttribute("aria-pressed")).toBe("true");
  expect(grille()).toBeNull();
  expect(zoneActive().querySelector(".zone-code-editeur").hidden).toBe(false);
  expect(texte()).toBe(casse);
  expect(document.activeElement).toBe(vue().contentDOM);
  // frappe sans fermer le guillemet : le texte du message n'est pas réécrit
  const mutations = [];
  new MutationObserver((m) => mutations.push(...m)).observe(alerte(), { childList: true, characterData: true, subtree: true });
  inserer(0, "x");
  inserer(1, "y");
  await microtaches();
  expect(mutations).toHaveLength(0);
  expect(alerte().textContent).toContain("ligne 3");
  expect(document.activeElement).toBe(vue().contentDOM);
  // le guillemet tapé après « fils » : la grille revient, « Bob, fils » active avec le focus
  const apres = texte().indexOf("fils") + 4;
  vue().focus();
  inserer(apres, '"');
  await microtaches();
  expect(grille()).not.toBeNull();
  expect(alerte().textContent).toBe("");
  expect(cellule(2, 0).textContent).toBe("Bob, fils");
  expect(cellule(2, 0).getAttribute("tabindex")).toBe("0");
});

test("REQ157_AC16_annuler_ramene_le_texte_le_message_et_le_focus_dans_l_editeur", async () => {
  const { e } = monter();
  const casse = 'a,b\n"c,d\n';
  ouvrir(e, "c.csv", casse);
  expect(alerte().getAttribute("role")).toBe("alert");
  vue().focus();
  inserer(casse.indexOf("d") - 1, '"');
  await microtaches();
  expect(grille()).not.toBeNull();
  expect(alerte().textContent).toBe("");
  expect(document.activeElement).toBe(cellule(1, 0));
  touche(cellule(1, 0), "z", { ctrlKey: true });
  await microtaches();
  expect(grille()).toBeNull();
  expect(texte()).toBe(casse);
  expect(alerte().textContent).toBe("Tableur indisponible : guillemet non fermé à la ligne 2.");
  expect(document.activeElement).toBe(vue().contentDOM);
});

test("REQ157_AC9_plus_de_2000_lignes_texte_2000_lignes_grille", () => {
  const { e } = monter();
  ouvrir(e, "grand.csv", "a\n".repeat(2001));
  expect(alerte().textContent).toBe("Tableur indisponible : plus de 2 000 lignes.");
  expect(grille()).toBeNull();
  ouvrir(e, "limite.csv", "a\n".repeat(2000));
  expect(grille()).not.toBeNull();
  expect(alerte().textContent).toBe("");
});

test("REQ157_AC17_bascule_garde_la_cellule_et_la_position_du_texte", () => {
  const { e, surActif } = monter();
  ouvrir(e, "clients.csv", CLIENTS);
  clic(cellule(1, 1)); // « Paris » : active et en saisie
  touche(grille().querySelector("[role=textbox]"), "Escape");
  hybride().focus();
  hybride().click();
  expect(vue().state.selection.main.head).toBe(CLIENTS.indexOf("Paris"));
  expect(surActif).toHaveBeenLastCalledWith({ position: "Ln 2, Col 7", langage: "Texte" });
  expect(document.activeElement).toBe(hybride());
  // curseur en « Ln 3, Col 13 » : dans `Lyon`
  const lyon = CLIENTS.indexOf("Lyon");
  vue().dispatch({ selection: { anchor: lyon - 1 } });
  vue().dispatch({ selection: { anchor: lyon + 1 } });
  hybride().click();
  expect(cellule(2, 1).getAttribute("tabindex")).toBe("0");
  expect(cellule(2, 1).textContent).toBe("Lyon");
  expect(document.activeElement).toBe(hybride());
});

test("REQ157_AC10_AC3_ctrl_s_valide_la_saisie_ecrit_le_texte_et_l_activation_sans_saisie_ne_change_rien", async () => {
  fauxServeur({ "clients.csv": CLIENTS });
  const { e } = monter();
  ouvrir(e, "clients.csv", CLIENTS);
  hybride().click();
  hybride().click();
  expect(texte()).toBe(CLIENTS);
  expect(point("clients.csv")).toBeUndefined();
  clic(cellule(1, 2));
  const span = grille().querySelector("[role=textbox]");
  span.textContent = "15";
  span.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(serveur.ecritures).toHaveLength(1));
  expect(serveur.ecritures[0]).toEqual(["clients.csv", CLIENTS.replace("12", "15")]);
  expect(cellule(1, 2).textContent).toBe("15");
  await vi.waitFor(() => expect(point("clients.csv")).toBeUndefined());
});

test("REQ157_AC3_saisie_valide_point_sur_l_onglet_annuler_refaire_et_disque_qui_suit", async () => {
  fauxServeur({ "clients.csv": CLIENTS });
  const { e } = monter();
  await e.restaurer();
  ouvrir(e, "clients.csv", CLIENTS);
  saisir(cellule(1, 2), "15");
  expect(cellule(1, 2).textContent).toBe("15");
  expect(texte()).toBe(CLIENTS.replace("12", "15"));
  expect(point("clients.csv")).toBe("true");
  expect(serveur.ecritures).toEqual([]);
  undo(vue());
  expect(texte()).toBe(CLIENTS);
  expect(grille()).not.toBeNull();
  expect(cellule(1, 2).textContent).toBe("12");
  // changement sur le disque, sans modification : la grille suit, la cellule active est gardée
  clic(cellule(2, 1));
  touche(grille().querySelector("[role=textbox]"), "Escape");
  touche(cellule(2, 1), "ArrowDown");
  expect(cellule(3, 1).getAttribute("tabindex")).toBe("0");
  serveur.fichiers["clients.csv"] = CLIENTS.replace("Lyon", "Nice");
  serveur.versions["clients.csv"] = "2";
  await e.relireDisque();
  await vi.waitFor(() => expect(cellule(2, 1).textContent).toBe("Nice"));
  expect(cellule(3, 1).getAttribute("tabindex")).toBe("0");
  expect(point("clients.csv")).toBeUndefined();
});

test("REQ062_AC1_AC14_REQ083_AC1_non_regression_markdown_et_code_sans_tableur", () => {
  const { e } = monter();
  ouvrir(e, "a.md", "# t");
  expect(hybride().getAttribute("aria-pressed")).toBe("true");
  expect(zoneActive().vue.dom.classList.contains("cm-hybride")).toBe(true);
  expect(zoneActive().querySelector(".ya-tableur")).toBeNull();
  expect(document.querySelector(".ya-alerte-tableur")).toBeNull();
  ouvrir(e, "main.rs", "fn main() {}");
  expect(hybride()).toBeNull();
  expect(zoneActive().querySelector(".ya-tableur")).toBeNull();
});

test("REQ157_AC3_AC9_tableur_indisponible_au_retour_du_disque_texte_curseur_au_debut", async () => {
  fauxServeur({ "c.csv": "a,b\nc,d\n" });
  const { e } = monter();
  await e.restaurer();
  ouvrir(e, "c.csv", "a,b\nc,d\n");
  serveur.fichiers["c.csv"] = 'a,b\n"c,d\n';
  serveur.versions["c.csv"] = "2";
  await e.relireDisque();
  await vi.waitFor(() => expect(grille()).toBeNull());
  expect(alerte().textContent).toBe("Tableur indisponible : guillemet non fermé à la ligne 2.");
  await microtaches();
  expect(vue().state.selection.main.head).toBe(0);
});

const THEME = "Thème clair du tableur";
const bThemeBrut = () => document.querySelector(`button[aria-label="${THEME}"]`);
// Le bouton n'est « proposé » que quand son enveloppe est visible.
const bTheme = () => (bThemeBrut()?.closest(".bouton-enveloppe").hidden ? null : bThemeBrut());
const zonesTableur = () => [...document.querySelectorAll(".ya-tableur")];

test("REQ158_AC1_clic_grille_en_clair_seule_sans_point_cellule_gardée_aria_pressed_second_clic", () => {
  document.documentElement.setAttribute("data-theme", "dark");
  const { e } = monter();
  ouvrir(e, "clients.csv", CLIENTS);
  touche(cellule(0, 0), "ArrowDown");
  touche(grille().querySelector("[tabindex='0']"), "ArrowRight");
  const active = grille().querySelector(".ya-cellule-active");
  expect(grille().dataset.theme).toBeUndefined();
  expect(bTheme().getAttribute("aria-pressed")).toBe("false");
  clic(bTheme());
  expect(grille().dataset.theme).toBe("light");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(point("clients.csv")).toBeUndefined();
  expect(serveur.ecritures).toEqual([]);
  expect(texte()).toBe(CLIENTS);
  expect(grille().querySelector(".ya-cellule-active")).toBe(active);
  expect(bTheme().getAttribute("aria-pressed")).toBe("true");
  clic(bTheme());
  expect(grille().dataset.theme).toBe("dark");
  expect(bTheme().getAttribute("aria-pressed")).toBe("false");
});

test("REQ158_AC2_deux_groupes_ensemble_rechargement_yaide_sans_effet_whiteboard_distinct", () => {
  document.documentElement.setAttribute("data-theme", "dark");
  let c = null;
  const e = vueEditeur({ dire: vi.fn(), surActif: vi.fn(), surGroupes: (arbre, courant) => c?.definirGroupes(arbre, courant) });
  editeurs.push(e);
  c = cadre({ principal: { groupes: e.groupes() } });
  document.body.append(c);
  e.lecture(false);
  ouvrir(e, "a.csv", CLIENTS);
  ouvrir(e, "b.csv", CLIENTS);
  e.deplacer("b.csv", "g1", "droite");
  expect(zonesTableur()).toHaveLength(2);
  clic(bTheme());
  expect(zonesTableur().map((z) => z.dataset.theme)).toEqual(["light", "light"]);
  expect(localStorage.getItem("yaide-theme-tableur")).toBe("light");
  expect(localStorage.getItem("yaide-theme-whiteboard")).toBeNull();
  document.documentElement.setAttribute("data-theme", "light");
  document.dispatchEvent(new CustomEvent("yaide-theme", { detail: "light" }));
  document.documentElement.setAttribute("data-theme", "dark");
  document.dispatchEvent(new CustomEvent("yaide-theme", { detail: "dark" }));
  expect(zonesTableur().map((z) => z.dataset.theme)).toEqual(["light", "light"]);
  document.dispatchEvent(new CustomEvent("yaide-theme-whiteboard", { detail: "dark" }));
  expect(zonesTableur().map((z) => z.dataset.theme)).toEqual(["light", "light"]);
  clic(bTheme());
  expect(zonesTableur().map((z) => z.dataset.theme)).toEqual(["dark", "dark"]);
  clic(bTheme());
  // « rechargement » : une nouvelle vue relit le choix
  e.detruire();
  editeurs = [];
  document.body.replaceChildren();
  const { e: neuf } = monter();
  ouvrir(neuf, "c.csv", CLIENTS);
  expect(themeTableur()).toBe("light");
  expect(grille().dataset.theme).toBe("light");
});

test("REQ158_AC3_sans_choix_suit_le_theme_de_yaide", () => {
  document.documentElement.setAttribute("data-theme", "light");
  const { e } = monter();
  ouvrir(e, "clients.csv", CLIENTS);
  expect(bTheme().getAttribute("aria-pressed")).toBe("true");
  document.documentElement.setAttribute("data-theme", "dark");
  document.dispatchEvent(new CustomEvent("yaide-theme", { detail: "dark" }));
  expect(bTheme().getAttribute("aria-pressed")).toBe("false");
  expect(grille().dataset.theme).toBeUndefined();
  expect(themeTableur()).toBeNull();
});

test("REQ158_AC4_nom_icone_info_bulle_ordre_focus_gardé_absent_mode_eteint_indisponible_et_autre_onglet", () => {
  const { e } = monter();
  ouvrir(e, "clients.csv", CLIENTS);
  const b = bTheme();
  expect(b.innerHTML).toContain('r="4"');
  const boutons = [...document.querySelectorAll(".onglets-droite button")];
  expect(boutons.map((x) => x.getAttribute("aria-label"))).toEqual(["Mode hybride", THEME]);
  vi.useFakeTimers();
  b.closest(".bouton-enveloppe").dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(500);
  expect(document.querySelector(".info-bulle[data-ouverte]")?.textContent).toBe(THEME);
  vi.useRealTimers();
  b.focus();
  clic(b);
  expect(document.activeElement).toBe(bTheme());
  hybride().click();
  expect(bTheme()).toBeNull();
  hybride().click();
  expect(bTheme()).not.toBeNull();
  ouvrir(e, "casse.csv", 'a,"b\n');
  expect(alerte().textContent).toContain("Tableur indisponible");
  expect(bTheme()).toBeNull();
  ouvrir(e, "x.txt", "x");
  expect(bTheme()).toBeNull();
});

test("REQ158_AC4_bouton_revient_quand_le_texte_redevient_valide", () => {
  const { e } = monter();
  ouvrir(e, "clients.csv", CLIENTS);
  hybride().click();
  const fin = CLIENTS.length;
  inserer(fin, '"x');
  hybride().click();
  expect(alerte().textContent).toContain("Tableur indisponible");
  expect(bTheme()).toBeNull();
  vue().dispatch({ changes: { from: fin, to: fin + 2, insert: "" } });
  expect(bTheme()).not.toBeNull();
});
