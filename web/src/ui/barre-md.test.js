import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { zoneCode } from "./zone-code.js";

const plateforme = vi.hoisted(() => ({ mac: false }));
vi.mock("../references.js", async (original) => ({ ...(await original()), estMac: () => plateforme.mac }));

Range.prototype.getClientRects ??= () => [];

const NOMS = ["Titre", "Gras", "Italique", "Souligné", "Barré", "Code en ligne", "Lien", "Image", "Citation", "Liste à puces", "Liste numérotée", "Bloc de code", "Tableau", "Séparateur"];

function zone(options = {}) {
  const z = zoneCode({ contenu: "un mot ici", langage: "markdown", nom: "README.md", hybride: true, ...options });
  document.body.append(z);
  return z;
}
const barre = (z) => z.querySelector("[role=toolbar]");
const boutons = (z) => [...barre(z).querySelectorAll("button")];
const bt = (z, nom) => boutons(z).find((b) => b.getAttribute("aria-label") === nom);
const texte = (z) => z.vue.state.doc.toString();
const choisi = (z) => z.vue.state.sliceDoc(z.vue.state.selection.main.from, z.vue.state.selection.main.to);
const touche = (cible, key, options = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  cible.dispatchEvent(e);
  return e;
};
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  plateforme.mac = false;
});

test("REQ170_AC1_barre_posee_et_retiree_avec_le_mode_hybride_sans_reconstruire_l_editeur", () => {
  const z = zone();
  const vue = z.vue;
  const cm = vue.dom;
  expect(barre(z)).not.toBeNull();
  z.definirHybride(false);
  expect(barre(z)).toBeNull();
  z.definirHybride(true);
  expect(barre(z)).not.toBeNull();
  expect(z.vue).toBe(vue);
  expect(vue.dom).toBe(cm);
  expect(cm.isConnected).toBe(true);
  // La barre précède l'éditeur dans le DOM.
  expect(barre(z).compareDocumentPosition(cm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const eteint = zone({ hybride: false });
  expect(barre(eteint)).toBeNull();
  for (const [nom, langage, contenu] of [["main.rs", "rust", "fn main() {}"], ["index.html", "html", "<p>a</p>"], ["donnees.csv", undefined, "a,b\n1,2\n"]]) {
    const autre = zoneCode({ contenu, langage, nom, hybride: true, adresseApercu: async () => null });
    document.body.append(autre);
    expect(barre(autre)).toBeNull();
  }
  const diff = zoneCode({ contenu: "@@ -1 +1 @@\n-a\n+b", mode: "diff", nom: "README.md", langage: "markdown", hybride: true });
  document.body.append(diff);
  expect(barre(diff)).toBeNull();
});

test("REQ170_AC2_clic_applique_l_action_garde_le_focus_et_la_selection_et_mousedown_sans_defaut", () => {
  const z = zone();
  const v = z.vue;
  for (const [nom, attendu] of [["Gras", "un **mot** ici"], ["Italique", "un *mot* ici"], ["Souligné", "un <u>mot</u> ici"], ["Barré", "un ~~mot~~ ici"], ["Code en ligne", "un `mot` ici"]]) {
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "un mot ici" }, selection: { anchor: 3, head: 6 } });
    v.focus();
    const md = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bt(z, nom).dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);
    bt(z, nom).click();
    expect(texte(z)).toBe(attendu);
    expect(choisi(z)).toBe("mot");
    expect(v.hasFocus).toBe(true);
  }
  const fond = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  barre(z).dispatchEvent(fond);
  expect(fond.defaultPrevented).toBe(true);
});

test("REQ170_AC9_une_action_de_la_barre_se_defait_d_un_seul_annuler", async () => {
  const { undo } = await import("@codemirror/commands");
  const z = zone();
  z.vue.dispatch({ selection: { anchor: 3, head: 6 } });
  bt(z, "Tableau").click();
  expect(texte(z)).toContain("| Colonne 1 | Colonne 2 |");
  undo(z.vue);
  expect(texte(z)).toBe("un mot ici");
});

test("REQ170_AC10_role_nom_quatorze_boutons_ordre_info_bulles_et_raccourcis", () => {
  const z = zone();
  const b = barre(z);
  expect(b.getAttribute("aria-label")).toBe("Mise en forme");
  expect(b.getAttribute("aria-controls")).toBe(z.vue.contentDOM.id);
  expect(z.vue.contentDOM.id).not.toBe("");
  expect(b.querySelectorAll(".ya-barre-md-groupe").length).toBe(4);
  expect([...b.querySelectorAll(".ya-barre-md-groupe")].map((g) => g.querySelectorAll("button").length)).toEqual([1, 7, 4, 2]);
  expect(boutons(z).map((x) => x.getAttribute("aria-label"))).toEqual(NOMS);
  expect(bt(z, "Gras").getAttribute("aria-keyshortcuts")).toBe("Control+B");
  expect(bt(z, "Italique").getAttribute("aria-keyshortcuts")).toBe("Control+I");
  expect(bt(z, "Souligné").getAttribute("aria-keyshortcuts")).toBe("Control+U");
  expect(bt(z, "Barré").hasAttribute("aria-keyshortcuts")).toBe(false);
  for (const x of boutons(z)) for (const a of ["aria-pressed", "aria-disabled", "disabled"]) expect(x.hasAttribute(a)).toBe(false);
});

// Texte des info-bulles : survol d'un bouton, délai de l'info-bulle.
test("REQ170_AC10_AC16_info_bulle_avec_raccourci_au_dessus_du_bouton", () => {
  vi.useFakeTimers();
  const z = zone();
  // Le bouton est à 100 px du haut, la bulle fait 24 px de haut : au-dessus, son haut est à 76 px.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    const bulle = this.getAttribute?.("role") === "tooltip";
    return bulle ? { left: 0, top: 0, right: 90, bottom: 24, width: 90, height: 24 } : { left: 200, top: 100, right: 224, bottom: 124, width: 24, height: 24 };
  });
  const survoler = (nom) => {
    bt(z, nom).enveloppe.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(400);
    return [...document.querySelectorAll('[role="tooltip"]')].find((t) => t.dataset.ouverte === "true");
  };
  expect((survoler("Gras")).textContent).toBe("Gras (Ctrl+B)");
  bt(z, "Gras").enveloppe.dispatchEvent(new Event("pointerleave"));
  expect((survoler("Italique")).textContent).toBe("Italique (Ctrl+I)");
  bt(z, "Italique").enveloppe.dispatchEvent(new Event("pointerleave"));
  expect((survoler("Souligné")).textContent).toBe("Souligné (Ctrl+U)");
  bt(z, "Souligné").enveloppe.dispatchEvent(new Event("pointerleave"));
  const lien = survoler("Lien");
  expect(lien.textContent).toBe("Lien");
  bt(z, "Lien").enveloppe.dispatchEvent(new Event("pointerleave"));
  expect(survoler("Image").textContent).toBe("Image");
  expect(bt(z, "Image").hasAttribute("aria-keyshortcuts")).toBe(false);
  // C-012 `dessus` : le bas de la bulle (76 + 24) ne descend pas sous le haut du bouton (100).
  expect(parseFloat(lien.style.top) + 24).toBeLessThanOrEqual(100);
});

test("REQ170_AC10_sur_macos_info_bulles_cmd_et_keyshortcuts_meta", () => {
  vi.useFakeTimers();
  plateforme.mac = true;
  const z = zone();
  expect(bt(z, "Gras").getAttribute("aria-keyshortcuts")).toBe("Meta+B");
  expect(bt(z, "Italique").getAttribute("aria-keyshortcuts")).toBe("Meta+I");
  expect(bt(z, "Souligné").getAttribute("aria-keyshortcuts")).toBe("Meta+U");
  bt(z, "Gras").enveloppe.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  const bulle = [...document.querySelectorAll('[role="tooltip"]')].find((t) => t.dataset.ouverte === "true");
  expect(bulle.textContent).toBe("Gras (Cmd+B)");
});

test("REQ170_AC11_AC13_un_seul_arret_de_tab_fleches_debut_fin_sans_boucler", () => {
  const z = zone();
  const tab = () => boutons(z).filter((b) => b.tabIndex === 0).map((b) => b.getAttribute("aria-label"));
  expect(tab()).toEqual(["Titre"]);
  bt(z, "Titre").focus();
  touche(document.activeElement, "ArrowLeft");
  expect(document.activeElement).toBe(bt(z, "Titre"));
  touche(document.activeElement, "ArrowRight");
  expect(document.activeElement).toBe(bt(z, "Gras"));
  expect(tab()).toEqual(["Gras"]);
  touche(document.activeElement, "End");
  expect(document.activeElement).toBe(bt(z, "Séparateur"));
  touche(document.activeElement, "ArrowRight");
  expect(document.activeElement).toBe(bt(z, "Séparateur"));
  touche(document.activeElement, "Home");
  expect(document.activeElement).toBe(bt(z, "Titre"));
  touche(document.activeElement, "ArrowRight");
  touche(document.activeElement, "ArrowRight");
  touche(document.activeElement, "ArrowRight");
  touche(document.activeElement, "ArrowLeft");
  // Les flèches d'un groupe à l'autre suivent l'ordre des quatorze boutons.
  const ordre = [];
  touche(document.activeElement, "Home");
  for (let i = 0; i < 14; i++) {
    ordre.push(document.activeElement.getAttribute("aria-label"));
    touche(document.activeElement, "ArrowRight");
  }
  expect(ordre).toEqual(NOMS);
});

test("REQ170_AC11_entree_espace_appliquent_puis_focus_editeur_et_echap_rend_le_focus", () => {
  const z = zone();
  const v = z.vue;
  v.dispatch({ selection: { anchor: 3, head: 6 } });
  bt(z, "Gras").focus();
  const e = touche(bt(z, "Gras"), "Enter");
  expect(e.defaultPrevented).toBe(true);
  expect(texte(z)).toBe("un **mot** ici");
  expect(v.hasFocus).toBe(true);
  bt(z, "Barré").focus();
  touche(bt(z, "Barré"), " ");
  expect(texte(z)).toBe("un **~~mot~~** ici");
  expect(v.hasFocus).toBe(true);
  bt(z, "Lien").focus();
  const avant = texte(z);
  touche(bt(z, "Lien"), "Escape");
  expect(v.hasFocus).toBe(true);
  expect(texte(z)).toBe(avant);
});

test("REQ170_AC14_alt_f10_va_sur_titre_puis_le_dernier_bouton_utilise_selection_gardee", () => {
  const z = zone();
  const v = z.vue;
  v.dispatch({ selection: { anchor: 3, head: 6 } });
  v.focus();
  const e = touche(v.contentDOM, "F10", { altKey: true });
  expect(e.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(bt(z, "Titre"));
  expect(choisi(z)).toBe("mot");
  touche(document.activeElement, "End");
  touche(document.activeElement, "Escape");
  expect(v.hasFocus).toBe(true);
  expect(choisi(z)).toBe("mot");
  expect(texte(z)).toBe("un mot ici");
  touche(v.contentDOM, "F10", { altKey: true });
  expect(document.activeElement).toBe(bt(z, "Séparateur"));
  // Sans mode hybride, Alt+F10 ne fait rien.
  z.definirHybride(false);
  v.focus();
  expect(touche(v.contentDOM, "F10", { altKey: true }).defaultPrevented).toBe(false);
});

test("REQ170_AC12_contrastes_des_paires_de_la_barre_dans_les_deux_themes", () => {
  const css = readFileSync("web/src/ui/tokens.css", "utf8");
  const jetons = (bloc) => Object.fromEntries([...bloc.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const sombre = jetons(css.slice(css.indexOf(":root"), css.indexOf('[data-theme="light"]')));
  const clair = { ...sombre, ...jetons(css.slice(css.indexOf('[data-theme="light"]'))) };
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const t of [sombre, clair]) {
    expect(ratio(t["ink-muted"], t["bg-200"])).toBeGreaterThanOrEqual(3);
    expect(ratio(t.ink, t["bg-400"])).toBeGreaterThanOrEqual(3);
    expect(ratio(t["accent-fg"], t["bg-200"])).toBeGreaterThanOrEqual(3);
    expect(ratio(t.ink, t["bg-300"])).toBeGreaterThanOrEqual(4.5);
  }
  const composants = readFileSync("web/src/ui/composants.css", "utf8");
  expect(composants).toMatch(/\.ya-barre-md\s*{[^}]*flex-wrap:\s*wrap/);
  expect(composants).toMatch(/\.ya-barre-md\s*{[^}]*background:\s*var\(--bg-200\)/);
});
