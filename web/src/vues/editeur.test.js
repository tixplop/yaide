import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { vueEditeur } from "./editeur.js";
import { nomLangage } from "../ui/langages.js";

// jsdom n'a pas de mise en page : CodeMirror mesure avec ces deux méthodes.
Range.prototype.getClientRects ??= () => [];
Range.prototype.getBoundingClientRect ??= () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });

let editeurs = [];
afterEach(() => {
  for (const e of editeurs) e.detruire();
  editeurs = [];
  document.body.replaceChildren();
});

function monter() {
  const surActif = vi.fn();
  const e = vueEditeur({ dire: vi.fn(), surActif });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  return { e, surActif };
}
const dernier = (f) => f.mock.calls.at(-1)[0];

test("REQ037_AC4_AC11_barre_d_etat_position_et_langage_de_l_onglet_actif", () => {
  const { e, surActif } = monter();
  expect(dernier(surActif)).toBeNull();
  e.ouvrir({ chemin: "src/main.rs", contenu: "fn main() {\n    let x = 1;\n}\n", version: "1" });
  expect(dernier(surActif)).toEqual({ position: "Ln 1, Col 1", langage: "Rust" });
  e.ouvrir({ chemin: "notes.xyz", contenu: "abc", version: "1" });
  expect(dernier(surActif)).toEqual({ position: "Ln 1, Col 1", langage: "Texte" });
});

test("REQ037_AC4_la_position_suit_le_curseur", () => {
  const { e, surActif } = monter();
  e.ouvrir({ chemin: "a.js", contenu: "const a = 1;\nconst b = 2;\n", version: "1" });
  const vue = e.code.querySelector(".zone-code").vue;
  vue.dispatch({ selection: { anchor: 19 } });
  expect(dernier(surActif).position).toBe("Ln 2, Col 7");
  expect(dernier(surActif).langage).toBe("JavaScript");
});

test("REQ037_AC11_sur_un_diff_seule_la_position_s_affiche", () => {
  const { e, surActif } = monter();
  e.ouvrirDiff({ chemin: "src/main.rs", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  const a = dernier(surActif);
  expect(a.position).toBe("Ln 1, Col 1");
  expect(a.langage).toBeUndefined();
  expect([...document.querySelector(".ya-crumbs").children].map((x) => x.textContent)).toContain("main.rs");
});

test("REQ037_AC5_fil_d_ariane_segments_chevrons_nom_en_dernier_et_absent_sans_fichier", () => {
  const { e } = monter();
  expect(e.fil.hidden).toBe(true);
  e.ouvrir({ chemin: "src/vues/main.rs", contenu: "x", version: "1" });
  expect(e.fil.hidden).toBe(false);
  expect(e.fil.textContent).toBe("srcvuesmain.rs");
  expect(e.fil.querySelectorAll("svg[data-icone=chevron]").length).toBe(2);
  expect(e.fil.lastElementChild.className).toBe("ya-crumbs-nom");
  expect(e.fil.querySelector("button, a, [tabindex]")).toBeNull();
  expect(readFileSync("web/src/ui/composants.css", "utf8")).toMatch(/\.ya-crumbs-nom\s*\{[^}]*color: var\(--ink\)/);
});

test("REQ037_AC11_nom_de_langage_par_extension", () => {
  expect(["main.rs", "a.ts", "a.js", "x.py", "a.go", "a.c", "a.cpp", "a.html", "a.css", "a.json", "a.yml", "a.toml", "a.md", "a.sh", "a.zzz", "Makefile"].map(nomLangage)).toEqual([
    "Rust", "TypeScript", "JavaScript", "Python", "Go", "C", "C++", "HTML", "CSS", "JSON", "YAML", "TOML", "Markdown", "Shell", "Texte", "Texte",
  ]);
});

test("REQ022_AC7_un_second_diff_remplace_le_premier_et_publie_son_fichier", () => {
  const { e, surActif } = monter();
  e.ouvrirDiff({ chemin: "src/main.rs", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  e.ouvrirDiff({ chemin: "neuf.txt", texte: "@@ -0,0 +1 @@\n+tout neuf\n" });
  expect(e.fil.textContent).toBe("neuf.txt");
  expect(dernier(surActif)).toEqual({ position: "Ln 1, Col 1", langage: undefined });
  expect(e.barre.querySelectorAll("[role=tab]").length).toBe(1);
});

test("REQ039_AC5_AC8_le_nom_de_l_onglet_prend_la_couleur_et_le_mot_de_son_statut", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "1" });
  e.ouvrir({ chemin: "notes.txt", contenu: "b", version: "1" });
  e.definirStatuts(new Map([["main.rs", { lettre: "M", mot: "modifié" }], ["notes.txt", { lettre: "D", mot: "supprimé" }]]));
  const onglet = (nom) => [...e.barre.querySelectorAll("[role=tab]")].find((t) => t.getAttribute("aria-label").startsWith(nom));
  expect(onglet("main.rs").getAttribute("aria-label")).toBe("main.rs, modifié");
  expect(onglet("main.rs").querySelector(".onglet-statut-M")).not.toBeNull();
  // Seuls M, A et U comptent pour un onglet.
  expect(onglet("notes.txt").getAttribute("aria-label")).toBe("notes.txt");
  e.definirStatuts(new Map([["main.rs", { lettre: "U", mot: "nouveau" }]]));
  expect(onglet("main.rs").getAttribute("aria-label")).toBe("main.rs, nouveau");
  e.definirStatuts(new Map());
  expect(onglet("main.rs").getAttribute("aria-label")).toBe("main.rs");
});

const boutonApercu = () => document.querySelector('button[aria-label="Aperçu"]');

test("REQ058_AC6_bouton_apercu_sur_html_et_htm_pas_sur_css_ni_rs", () => {
  const { e } = monter();
  for (const chemin of ["index.html", "page.htm", "NOTES.HTML", "style.css", "src/main.rs"]) {
    e.ouvrir({ chemin, contenu: "x", version: "1" });
    expect(boutonApercu() !== null, chemin).toBe(!/\.(css|rs)$/.test(chemin));
  }
});

test("REQ058_AC7_aria_pressed_propre_a_chaque_onglet_sur_html", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "a.html", contenu: "x", version: "1" });
  e.ouvrir({ chemin: "b.html", contenu: "y", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  boutonApercu().click();
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  e.ouvrir({ chemin: "a.html", contenu: "x", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  e.ouvrir({ chemin: "b.html", contenu: "y", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
});

test("REQ039_AC7_le_chemin_de_l_onglet_actif_est_donne_pour_l_arbre", () => {
  const surCourant = vi.fn();
  const e = vueEditeur({ dire: vi.fn(), surCourant });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  expect(surCourant).toHaveBeenLastCalledWith(null);
  e.ouvrir({ chemin: "src/main.rs", contenu: "a", version: "1" });
  expect(surCourant).toHaveBeenLastCalledWith("src/main.rs");
  e.ouvrirDiff({ chemin: "src/main.rs", texte: "+a" });
  expect(surCourant).toHaveBeenLastCalledWith(null);
});

test("REQ050_AC6_onglet_deplace_garde_son_texte_et_ctrl_s_ecrit_au_nouveau_chemin", async () => {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    appels.push({ url, methode: init?.method, corps: init?.body });
    return { ok: true, status: 200, json: async () => ({ version: "2" }) };
  }));
  const { e } = monter();
  e.ouvrir({ chemin: "a.txt", contenu: "abc", version: "1" });
  const vue = e.code.querySelector(".zone-code").vue;
  vue.dispatch({ changes: { from: 3, insert: "def" } });
  e.renomme({ de: "a.txt", vers: "src/a.txt" });
  expect(e.fil.textContent).toBe("srca.txt");
  expect(e.code.querySelector(".zone-code").vue.state.doc.toString()).toBe("abcdef");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  const put = appels.find((a) => a.methode === "PUT");
  expect(decodeURIComponent(put.url)).toContain("chemin=src/a.txt");
  expect(put.corps).toBe("abcdef");
  vi.unstubAllGlobals();
});
