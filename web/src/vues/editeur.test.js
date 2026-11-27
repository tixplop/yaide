import { undo } from "@codemirror/commands";
import { language } from "@codemirror/language";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { vueEditeur } from "./editeur.js";
import { lire } from "../stockage.js";
import { nomLangage } from "../ui/langages.js";
import { choisi } from "../worktree.js";
import { cadre } from "../ui/cadre.js";

vi.mock("../ui/diagramme.js", () => ({
  chargerMermaid: () => Promise.resolve({ dessiner: async (t) => (t.startsWith("graph") ? { svg: "<svg/>", largeur: 1, hauteur: 1 } : null) }),
  adresseDiagramme: (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
}));

// Faux vueClaude : un corps avec un champ de saisie, et le journal des appels dans l'ordre.
const faux = vi.hoisted(() => ({ vues: [], oc: [], ag: [], journal: [] }));
vi.mock("./claude.js", () => ({
  vueClaude: (opts) => {
    const corps = document.createElement("div");
    const saisie = document.createElement("textarea");
    corps.append(saisie);
    const v = {
      ...opts,
      corps,
      focus: vi.fn(() => saisie.focus()),
      ajuster: vi.fn(),
      detruire: vi.fn(() => faux.journal.push(`detruire ${opts.id}`)),
    };
    faux.vues.push(v);
    return v;
  },
}));
// Faux vueOpencode : un corps avec un champ « Message à opencode » (session) ou une conversation (sous-agent).
vi.mock("./opencode.js", () => ({
  vueOpencode: (opts) => {
    const corps = document.createElement("div");
    const cible = document.createElement(opts.sousAgent ? "div" : "textarea");
    if (opts.sousAgent) cible.tabIndex = 0;
    corps.append(cible);
    const v = {
      ...opts,
      corps,
      cible,
      focus: vi.fn(() => cible.focus()),
      detruire: vi.fn(() => faux.journal.push(`detruire oc:${opts.sessionId}`)),
    };
    faux.oc.push(v);
    if (faux.marqueAuDepart) opts.surQuestion?.(true); // une demande attend déjà à la création de la vue
    return v;
  },
}));
// Faux vueAgent : un corps avec le champ « Message à l'agent », et les options reçues.
vi.mock("./agent.js", () => ({
  vueAgent: (opts) => {
    const corps = document.createElement("div");
    const champ = document.createElement("textarea");
    corps.append(champ);
    const v = {
      ...opts,
      corps,
      champ,
      focuser: vi.fn(() => champ.focus()),
      majListe: vi.fn(),
      relireReglages: vi.fn(),
      detruire: vi.fn(() => faux.journal.push("detruire agent")),
    };
    faux.ag.push(v);
    return v;
  },
}));
vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

// jsdom n'a pas de mise en page : CodeMirror mesure avec ces deux méthodes.
Range.prototype.getClientRects ??= () => [];
Range.prototype.getBoundingClientRect ??= () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });

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
  expect(["main.rs", "a.ts", "a.js", "x.py", "a.go", "a.c", "a.cpp", "a.html", "a.css", "a.json", "a.yml", "a.toml", "a.md", "a.sh", "a.zzz", "Makefile", "A.java", "a.kt", "a.cs", "a.swift", "a.rb", "a.lua", "a.sql", "a.xml", "a.svg", "a.ini", "a.env", "a.patch", "Dockerfile", "index.php"].map(nomLangage)).toEqual([
    "Rust", "TypeScript", "JavaScript", "Python", "Go", "C", "C++", "HTML", "CSS", "JSON", "YAML", "TOML", "Markdown", "Shell", "Texte", "Texte",
    "Java", "Kotlin", "C#", "Swift", "Ruby", "Lua", "SQL", "XML", "XML", "INI", "INI", "Diff", "Dockerfile", "Texte",
  ]);
});

test("REQ011_AC10_le_langage_suit_le_renommage_sans_perdre_le_texte", () => {
  const { e, surActif } = monter();
  e.ouvrir({ chemin: "notes.txt", contenu: "fn main() {}", version: "1" });
  const zone = e.code.querySelector(".zone-code");
  zone.vue.dispatch({ changes: { from: 0, insert: "// " } });
  expect(languageDe(zone)).toBeNull();
  e.renomme({ de: "notes.txt", vers: "notes.rs" });
  expect(e.code.querySelector(".zone-code")).toBe(zone);
  expect(zone.contenu()).toBe("// fn main() {}");
  expect(onglets()[0].dataset.modifie).toBe("true");
  expect(languageDe(zone)).toBe("rust");
  expect(dernier(surActif).langage).toBe("Rust");
  e.renomme({ de: "notes.rs", vers: "notes.txt" });
  expect(languageDe(zone)).toBeNull();
  expect(dernier(surActif).langage).toBe("Texte");
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
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  boutonApercu().click();
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  e.ouvrir({ chemin: "a.html", contenu: "x", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  e.ouvrir({ chemin: "b.html", contenu: "y", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
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

// ---- REQ-061 : menu des onglets et série de fermetures ----

const onglets = () => [...document.querySelectorAll("[role=tab]")];
const nomsOnglets = () => onglets().map((t) => t.querySelector(".onglet-nom").textContent);
const onglet = (nom) => onglets().find((t) => t.querySelector(".onglet-nom").textContent === nom);
const actifNom = () => onglets().find((t) => t.getAttribute("aria-selected") === "true")?.querySelector(".onglet-nom").textContent;
const menuOuvert = () => document.querySelector("[role=menu]");
const commandesMenu = () => [...document.querySelectorAll("[role=menuitem]")].map((c) => c.textContent);
const clicDroit = (t, x = 10, y = 20) => t.closest(".onglet-cellule").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
const choisirCommande = (libelle) => [...document.querySelectorAll("[role=menuitem]")].find((c) => c.textContent === libelle).click();
const dialogueOuvert = () => document.querySelector("dialog");
const clicBouton = (libelle) => [...document.querySelectorAll("dialog button")].find((b) => b.textContent === libelle).click();
const modifier = (e, chemin) => {
  const zone = [...e.code.querySelectorAll(".zone-code")].find((z) => z.vue.contentDOM.getAttribute("aria-label") === `Éditeur ${chemin}`);
  zone.vue.dispatch({ changes: { from: 0, insert: "X" } });
};
function trois() {
  const m = monter();
  for (const c of ["main.rs", "README.md", "a.txt"]) m.e.ouvrir({ chemin: c, contenu: "abc", version: "1" });
  return m;
}
function ecritures(echec = false) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "PUT") {
      appels.push(decodeURIComponent(url).match(/chemin=([^&]*)/)[1]);
      if (echec) return { ok: false, status: 500, json: async () => ({ cause: "autre", message: "Disque plein." }), text: async () => "Disque plein." };
    }
    return { ok: true, status: 200, json: async () => ({ version: "2" }) };
  }));
  return appels;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("REQ061_AC1_AC11_clic_droit_ouvre_le_menu_nomme_dans_l_ordre_et_active_l_onglet", () => {
  const { e } = trois();
  expect(onglets().every((t) => t.getAttribute("aria-haspopup") === "menu")).toBe(true);
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 20 });
  onglet("README.md").closest(".onglet-cellule").dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(actifNom()).toBe("README.md");
  expect(menuOuvert().getAttribute("aria-label")).toBe("Actions sur README.md");
  expect(commandesMenu()).toEqual(["Fermer les autres onglets", "Fermer tous les onglets"]);
  expect(document.activeElement.textContent).toBe("Fermer les autres onglets");
  expect(e.fil.textContent).toBe("README.md");
});

test("REQ061_AC11_Echap_ferme_le_menu_sans_rien_faire_et_rend_le_focus_a_l_onglet", () => {
  trois();
  clicDroit(onglet("README.md"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(menuOuvert()).toBeNull();
  expect(nomsOnglets()).toEqual(["main.rs", "README.md", "a.txt"]);
  expect(document.activeElement).toBe(onglet("README.md"));
});

test("REQ061_AC2_un_seul_onglet_seul_Fermer_tous", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "1" });
  clicDroit(onglet("main.rs"));
  expect(menuOuvert().getAttribute("aria-label")).toBe("Actions sur main.rs");
  expect(commandesMenu()).toEqual(["Fermer tous les onglets"]);
});

test("REQ061_AC3_fermer_les_autres_garde_l_onglet_vise_actif", async () => {
  trois();
  clicDroit(onglet("README.md"));
  choisirCommande("Fermer les autres onglets");
  await vi.waitFor(() => expect(nomsOnglets()).toEqual(["README.md"]));
  expect(nomsOnglets()).toEqual(["README.md"]);
  expect(actifNom()).toBe("README.md");
  expect(menuOuvert()).toBeNull();
});

test("REQ061_AC4_AC12_fermer_tous_sans_modification_affiche_aucun_fichier_et_focus_sur_ouvrir", async () => {
  const { e } = trois();
  e.lecture(false);
  clicDroit(onglet("a.txt"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(onglets().length).toBe(0));
  expect(onglets().length).toBe(0);
  expect(e.code.textContent).toContain("Aucun fichier ouvert.");
  expect(document.activeElement.textContent).toBe("Ouvrir un fichier");
});

test("REQ061_AC5_AC13_le_diff_est_ferme_par_les_deux_commandes_et_garde_seul_sur_lui_meme", async () => {
  const { e } = trois();
  e.ouvrirDiff({ chemin: "src/main.rs", texte: "+a" });
  clicDroit(onglet("main.rs (diff)"));
  expect(menuOuvert().getAttribute("aria-label")).toBe("Actions sur main.rs (diff)");
  choisirCommande("Fermer les autres onglets");
  await vi.waitFor(() => expect(nomsOnglets()).toEqual(["main.rs (diff)"]));
  expect(nomsOnglets()).toEqual(["main.rs (diff)"]);
  expect(actifNom()).toBe("main.rs (diff)");
  e.fermerDiff();
  e.ouvrir({ chemin: "b.txt", contenu: "x", version: "1" });
  e.ouvrirDiff({ chemin: "src/main.rs", texte: "+a" });
  clicDroit(onglet("b.txt"));
  choisirCommande("Fermer les autres onglets");
  await vi.waitFor(() => expect(nomsOnglets()).toEqual(["b.txt"]));
  expect(nomsOnglets()).toEqual(["b.txt"]);
  e.ouvrirDiff({ chemin: "src/main.rs", texte: "+a" });
  clicDroit(onglet("b.txt"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(onglets().length).toBe(0));
  expect(onglets().length).toBe(0);
});

test("REQ061_AC6_AC12_serie_sans_modification_d_abord_puis_dialogue_par_onglet_modifie_actif", async () => {
  const appels = ecritures();
  const { e } = trois();
  modifier(e, "main.rs");
  modifier(e, "a.txt");
  clicDroit(onglet("README.md"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(dialogueOuvert()?.textContent).toContain("Sauvegarder main.rs ?"));
  expect(nomsOnglets()).toEqual(["main.rs", "a.txt"]);
  expect(dialogueOuvert().textContent).toContain("Sauvegarder main.rs ?");
  expect(actifNom()).toBe("main.rs");
  expect(document.querySelectorAll("dialog").length).toBe(1);
  clicBouton("Sauvegarder");
  await vi.waitFor(() => expect(dialogueOuvert()?.textContent).toContain("Sauvegarder a.txt ?"));
  expect(appels).toEqual(["main.rs"]);
  expect(nomsOnglets()).toEqual(["a.txt"]);
  expect(dialogueOuvert().textContent).toContain("Sauvegarder a.txt ?");
  expect(actifNom()).toBe("a.txt");
  clicBouton("Abandonner");
  await vi.waitFor(() => expect(onglets().length).toBe(0));
  expect(appels).toEqual(["main.rs"]);
  expect(onglets().length).toBe(0);
  expect(dialogueOuvert()).toBeNull();
});

test("REQ061_AC7_AC12_annuler_arrete_la_serie_et_l_onglet_reste_actif_avec_son_texte", async () => {
  const { e } = trois();
  modifier(e, "main.rs");
  modifier(e, "a.txt");
  clicDroit(onglet("README.md"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(dialogueOuvert()).not.toBeNull());
  clicBouton("Annuler");
  await vi.waitFor(() => expect(dialogueOuvert()).toBeNull());
  expect(dialogueOuvert()).toBeNull();
  expect(nomsOnglets()).toEqual(["main.rs", "a.txt"]);
  expect(actifNom()).toBe("main.rs");
  expect(onglet("main.rs").dataset.modifie).toBe("true");
  expect(onglet("a.txt").dataset.modifie).toBe("true");
  expect(e.code.querySelector(".zone-code:not([hidden])").vue.state.doc.toString()).toBe("Xabc");
  expect(document.activeElement).toBe(e.code.querySelector(".zone-code:not([hidden])").vue.contentDOM);
});

test("REQ061_AC7_Echap_dans_le_dialogue_vaut_annuler", async () => {
  const { e } = trois();
  modifier(e, "main.rs");
  clicDroit(onglet("a.txt"));
  choisirCommande("Fermer les autres onglets");
  await vi.waitFor(() => expect(dialogueOuvert()).not.toBeNull());
  dialogueOuvert().dispatchEvent(new Event("cancel", { cancelable: true }));
  await vi.waitFor(() => expect(dialogueOuvert()).toBeNull());
  expect(nomsOnglets()).toEqual(["main.rs", "a.txt"]);
  expect(actifNom()).toBe("main.rs");
});

test("REQ061_AC14_ecriture_impossible_bandeau_onglet_garde_son_point_et_la_serie_s_arrete", async () => {
  const appels = ecritures(true);
  const dire = vi.fn();
  const e = vueEditeur({ dire });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  for (const c of ["main.rs", "a.txt"]) e.ouvrir({ chemin: c, contenu: "abc", version: "1" });
  modifier(e, "main.rs");
  modifier(e, "a.txt");
  clicDroit(onglet("a.txt"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(dialogueOuvert()).not.toBeNull());
  clicBouton("Sauvegarder");
  await vi.waitFor(() => expect(dire).toHaveBeenCalled());
  expect(appels).toEqual(["main.rs"]);
  expect(dire).toHaveBeenCalledOnce();
  const texte = dire.mock.calls[0][0].texte;
  expect(texte.startsWith("Sauvegarde impossible pour main.rs : ")).toBe(true);
  expect(texte.endsWith("Vos modifications sont gardées.")).toBe(true);
  expect(dialogueOuvert()).toBeNull();
  expect(nomsOnglets()).toEqual(["main.rs", "a.txt"]);
  expect(onglet("main.rs").dataset.modifie).toBe("true");
  expect(actifNom()).toBe("main.rs");
});

test("REQ061_AC8_onglet_avec_question_reste_ouvert_sans_dialogue_et_la_serie_continue", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST") return { ok: true, status: 200, json: async () => ({ "a.txt": "9" }) };
    return { ok: true, status: 200, headers: new Headers({ "x-version": "9" }), text: async () => "autre" };
  }));
  const { e } = trois();
  await e.restaurer();
  modifier(e, "main.rs");
  modifier(e, "a.txt");
  await e.relireDisque();
  expect(onglet("a.txt").getAttribute("aria-label")).toContain("question en attente");
  clicDroit(onglet("README.md"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(dialogueOuvert()).not.toBeNull());
  expect(nomsOnglets()).toEqual(["main.rs", "a.txt"]);
  expect(dialogueOuvert().textContent).toContain("Sauvegarder main.rs ?");
  clicBouton("Abandonner");
  await vi.waitFor(() => expect(nomsOnglets()).toEqual(["a.txt"]));
  expect(nomsOnglets()).toEqual(["a.txt"]);
  expect(dialogueOuvert()).toBeNull();
  expect(actifNom()).toBe("a.txt");
  expect(e.question.textContent).toContain("a.txt a changé sur le disque");
});

test("REQ061_AC10_Maj_F10_ouvre_le_menu_sous_l_onglet_et_les_commandes_marchent_au_clavier", async () => {
  trois();
  const t = onglet("README.md");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return this.getAttribute("role") === "tab" ? { left: 50, right: 150, top: 0, bottom: 30, width: 100, height: 30 } : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  });
  t.focus();
  t.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
  const m = menuOuvert();
  expect(m.getAttribute("aria-label")).toBe("Actions sur README.md");
  expect(m.style.top).toBe("34px");
  expect(m.style.left).toBe("50px");
  expect(actifNom()).toBe("README.md");
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  expect(document.activeElement.textContent).toBe("Fermer tous les onglets");
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(onglets().length).toBe(0));
  expect(onglets().length).toBe(0);
});

test("REQ061_AC13_pas_de_menu_sur_la_partie_vide_de_la_barre", () => {
  trois();
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  document.querySelector(".onglets").dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(false);
  expect(menuOuvert()).toBeNull();
});

test("REQ061_AC9_liste_gardee_relue_apres_la_serie", async () => {
  vi.resetModules();
  const garder = vi.fn();
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder, retrouver: async () => ({ liste: [], actif: null, disposition: { arbre: { id: "g1", actif: null }, courant: "g1" } }) }));
  const { vueEditeur: neuf } = await import("./editeur.js");
  const e = neuf({ dire: vi.fn() });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  vi.useFakeTimers();
  await e.restaurer();
  for (const c of ["main.rs", "README.md", "a.txt"]) e.ouvrir({ chemin: c, contenu: "abc", version: "1" });
  clicDroit(onglet("README.md"));
  choisirCommande("Fermer les autres onglets");
  await vi.advanceTimersByTimeAsync(250);
  vi.useRealTimers();
  expect(garder).toHaveBeenLastCalledWith([expect.objectContaining({ chemin: "README.md" })], "README.md", expect.anything());
  vi.doUnmock("../onglets-fichiers.js");
  vi.resetModules();
});

const boutonHybride = () => document.querySelector('button[aria-label="Mode hybride"]');

test("REQ062_AC1_AC14_bouton_hybride_avant_apercu_sur_markdown_seulement", () => {
  const { e } = monter();
  for (const chemin of ["README.md", "notes.markdown", "NOTES.MD", "index.html", "src/main.rs"]) {
    e.ouvrir({ chemin, contenu: "x", version: "1" });
    expect(boutonHybride() !== null, chemin).toBe(/\.(md|markdown|html)$/i.test(chemin));
    expect(boutonApercu() !== null, chemin).toBe(/\.(md|markdown|html)$/i.test(chemin));
  }
  e.ouvrir({ chemin: "README.md", contenu: "x", version: "1" });
  expect(boutonHybride().compareDocumentPosition(boutonApercu()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  e.ouvrirDiff({ chemin: "README.md", texte: "+a" });
  expect(boutonHybride()).toBeNull();
  expect(boutonApercu()).toBeNull();
});

test("REQ062_AC14_REQ058_AC21_hybride_precede_apercu_sur_html", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "index.html", contenu: "x", version: "1" });
  expect(boutonHybride().compareDocumentPosition(boutonApercu()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("REQ058_AC21_AC22_AC25_REQ062_AC12_html_page_seule_puis_boutons_exclusifs_focus_conserve", () => {
  const { e } = monter();
  for (const chemin of ["index.html", "page.htm"]) {
    e.ouvrir({ chemin, contenu: "<p>x</p>", version: "1" });
    expect(boutonApercu().getAttribute("aria-pressed"), chemin).toBe("true");
    expect(boutonHybride().getAttribute("aria-pressed"), chemin).toBe("false");
  }
  const sansPoint = () => {
    const t = document.querySelector('[role=tab][aria-label^="page.htm"]');
    expect(t.getAttribute("aria-label")).not.toContain("non sauvegardé");
    expect(t.dataset.modifie).not.toBe("true");
    expect(document.querySelector('[role="alert"], .bandeau')).toBeNull();
  };
  boutonHybride().focus();
  boutonHybride().click();
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  expect(document.activeElement).toBe(boutonHybride());
  sansPoint();
  boutonApercu().focus();
  boutonApercu().click();
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("false");
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(boutonApercu());
  sansPoint();
  boutonApercu().click();
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("false");
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  sansPoint();
});

test("REQ058_AC24_html_rechargee_revient_dans_son_mode", async () => {
  vi.resetModules();
  const gardee = [{ chemin: "index.html", hybride: true, apercu: false }, { chemin: "page.htm", apercu: true, hybride: false }];
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder: vi.fn(), retrouver: async () => ({ liste: gardee, actif: "index.html", disposition: { arbre: { id: "g1", actif: "index.html" }, courant: "g1" } }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => "<p>t</p>", json: async () => ({ jeton: "jj" }) })));
  const { vueEditeur: neuf } = await import("./editeur.js");
  const e = neuf({ dire: vi.fn() });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  await e.restaurer();
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  let zone = e.code.querySelector(".zone-code:not([hidden])");
  expect(zone.classList.contains("zone-code-avec-apercu")).toBe(true);
  expect(zone.classList.contains("zone-code-page-seule")).toBe(false);
  expect(zone.querySelector(".cm-editor").closest("[hidden]")).toBeNull();
  e.ouvrir({ chemin: "page.htm", contenu: "<p>t</p>", version: "1" });
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("false");
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  zone = e.code.querySelector(".zone-code:not([hidden])");
  expect(zone.classList.contains("zone-code-page-seule")).toBe(true);
  expect(zone.classList.contains("zone-code-avec-apercu")).toBe(false);
  vi.doUnmock("../onglets-fichiers.js");
  vi.resetModules();
});

test("REQ062_AC12_aria_pressed_propre_a_chaque_onglet_focus_conserve", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "a.md", contenu: "# x", version: "1" });
  e.ouvrir({ chemin: "b.md", contenu: "# y", version: "1" });
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
  boutonHybride().focus();
  boutonHybride().click();
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("false");
  expect(document.activeElement).toBe(boutonHybride());
  expect(e.code.querySelector(".zone-code:not([hidden])").vue.dom.classList.contains("cm-hybride")).toBe(false);
  e.ouvrir({ chemin: "a.md", contenu: "# x", version: "1" });
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
  e.ouvrir({ chemin: "b.md", contenu: "# y", version: "1" });
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("false");
  boutonHybride().click();
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
});

test("REQ062_AC10_liste_gardee_relue_avec_le_mode_hybride", async () => {
  vi.resetModules();
  const garder = vi.fn();
  const gardee = [{ chemin: "README.md", hybride: true }, { chemin: "notes.md" }];
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder, retrouver: async () => ({ liste: gardee, actif: "README.md", disposition: { arbre: { id: "g1", actif: "README.md" }, courant: "g1" } }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => "# t" })));
  const { vueEditeur: neuf } = await import("./editeur.js");
  const e = neuf({ dire: vi.fn() });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  vi.useFakeTimers();
  await e.restaurer();
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
  e.ouvrir({ chemin: "notes.md", contenu: "# t", version: "1" });
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("false");
  boutonHybride().click();
  await vi.advanceTimersByTimeAsync(250);
  vi.useRealTimers();
  expect(garder).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ chemin: "README.md", hybride: true }), expect.objectContaining({ chemin: "notes.md", hybride: true })]), "notes.md", expect.anything());
  vi.doUnmock("../onglets-fichiers.js");
  vi.resetModules();
});

test("REQ062_AC10_le_mode_reste_apres_un_changement_sur_le_disque", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST") return { ok: true, status: 200, json: async () => ({ "README.md": "2" }) };
    return { ok: true, status: 200, headers: new Headers({ "x-version": "2" }), text: async () => "# nouveau" };
  }));
  const { e } = monter();
  await e.restaurer();
  e.ouvrir({ chemin: "README.md", contenu: "# ancien", version: "1" });
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
  await e.relireDisque();
  const vue = e.code.querySelector(".zone-code").vue;
  await vi.waitFor(() => expect(vue.state.doc.toString()).toBe("# nouveau"));
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
  expect(vue.dom.classList.contains("cm-hybride")).toBe(true);
});

const e_actif = () => document.querySelector(".zone-code:not([hidden])");

test("REQ083_AC1_markdown_ouvert_en_mode_hybride", () => {
  const { e } = monter();
  for (const chemin of ["README.md", "notes.markdown"]) {
    e.ouvrir({ chemin, contenu: "# t", version: "1" });
    expect(e_actif().vue.dom.classList.contains("cm-hybride"), chemin).toBe(true);
    expect(boutonHybride().getAttribute("aria-pressed"), chemin).toBe("true");
    expect(boutonApercu().getAttribute("aria-pressed"), chemin).toBe("false");
  }
});

test("REQ083_AC2_html_ouvert_avec_l_apercu", () => {
  const { e } = monter();
  for (const chemin of ["index.html", "page.htm"]) {
    e.ouvrir({ chemin, contenu: "<p>x</p>", version: "1" });
    expect(boutonApercu().getAttribute("aria-pressed"), chemin).toBe("true");
    expect(boutonHybride().getAttribute("aria-pressed"), chemin).toBe("false");
    expect(document.querySelector('iframe[title="Aperçu"]'), chemin).not.toBeNull();
  }
});

test("REQ083_AC3_autres_fichiers_inchanges", () => {
  const { e } = monter();
  for (const chemin of ["main.rs", "style.css"]) {
    e.ouvrir({ chemin, contenu: "x", version: "1" });
    expect(e_actif().vue.dom.classList.contains("cm-hybride"), chemin).toBe(false);
    expect(boutonHybride(), chemin).toBeNull();
    expect(boutonApercu(), chemin).toBeNull();
    expect(document.querySelector('iframe[title="Aperçu"]'), chemin).toBeNull();
  }
});

test("REQ083_AC4_ferme_puis_rouvert_reprend_le_defaut", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "README.md", contenu: "# t", version: "1" });
  boutonHybride().click();
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("false");
  croix("README.md").click();
  e.ouvrir({ chemin: "README.md", contenu: "# t", version: "1" });
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
  e.ouvrir({ chemin: "notes.md", contenu: "# n", version: "1" });
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("true");
  e.ouvrir({ chemin: "index.html", contenu: "x", version: "1" });
  boutonApercu().click();
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  croix("index.html").click();
  e.ouvrir({ chemin: "index.html", contenu: "x", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
});

test("REQ083_AC5_restaure_et_deja_ouvert_gardent_leur_etat", async () => {
  vi.resetModules();
  const gardee = [{ chemin: "README.md", hybride: false }, { chemin: "index.html", apercu: false }];
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder: vi.fn(), retrouver: async () => ({ liste: gardee, actif: "README.md", disposition: { arbre: { id: "g1", actif: "README.md" }, courant: "g1" } }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => "# t" })));
  const { vueEditeur: neuf } = await import("./editeur.js");
  const e = neuf({ dire: vi.fn() });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  await e.restaurer();
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("false");
  e.ouvrir({ chemin: "README.md", contenu: "# t", version: "1" });
  expect(boutonHybride().getAttribute("aria-pressed")).toBe("false");
  e.ouvrir({ chemin: "index.html", contenu: "# t", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  vi.doUnmock("../onglets-fichiers.js");
  vi.resetModules();
});

// ---- Onglets Claude (REQ-068) ----

function monterClaude(options = {}, restaurer = false) {
  faux.vues.length = 0;
  faux.journal.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "DELETE") {
      faux.journal.push(`fermer ${decodeURIComponent(url).split("/").pop()}`);
      return { ok: true, status: 204 };
    }
    if (String(url).includes("/api/shells")) return { ok: true, status: 200, json: async () => ({ instance: "i1", shells: [] }) };
    return { ok: true, status: 200, headers: new Headers({ "x-version": "1" }), json: async () => ({ version: "2" }), text: async () => "abc" };
  }));
  const surActif = vi.fn();
  const surCourant = vi.fn();
  const dire = vi.fn();
  const e = vueEditeur({ dire, surActif, surCourant, chemin: "~/code/projet", ...options });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  if (!restaurer) e.lecture(false); // pas de restauration : la lecture initiale est finie
  return { e, surActif, surCourant, dire };
}
const croix = (nom) => document.querySelector(`button[aria-label="Fermer ${nom}"]`);
const touche = (cible, key) => cible.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const fermes = () => faux.journal.filter((j) => j.startsWith("fermer"));

test("REQ068_AC2_AC13_ouvre_claude_1_puis_claude_2_actif_focus", async () => {
  const { e } = monterClaude();
  e.ouvrir({ chemin: "src/main.rs", contenu: "x", version: "1" });
  e.ouvrirClaude({ id: "s1" });
  expect(nomsOnglets()).toEqual(["main.rs", "Claude 1"]);
  expect(actifNom()).toBe("Claude 1");
  const t = onglet("Claude 1");
  expect(t.title).toBe("Claude Code dans ~/code/projet");
  expect(t.getAttribute("aria-label")).toBe("Claude 1");
  expect(t.querySelector("svg[data-icone=asterisk]")).not.toBeNull();
  expect(t.dataset.modifie).toBeUndefined();
  expect(croix("Claude 1")).not.toBeNull();
  expect(faux.vues[0].nom).toBe("Claude 1");
  expect(faux.vues[0].id).toBe("s1");
  expect(document.activeElement).toBe(faux.vues[0].corps.querySelector("textarea"));
  expect(faux.vues[0].corps.hidden).toBe(false);
  e.ouvrirClaude({ id: "s2" });
  expect(nomsOnglets()).toEqual(["main.rs", "Claude 1", "Claude 2"]);
  expect(actifNom()).toBe("Claude 2");
  expect(faux.vues[0].corps.hidden).toBe(true);
  expect(document.activeElement).toBe(faux.vues[1].corps.querySelector("textarea"));
  // Changer d'onglet garde le terminal tel quel : même vue, pas détruite.
  onglet("Claude 1").click();
  expect(faux.vues[0].corps.hidden).toBe(false);
  expect(faux.vues[0].detruire).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(faux.vues[0].corps.querySelector("textarea"));
});

test("REQ068_AC13_plus_petit_numero_libre", () => {
  const { e } = monterClaude();
  e.ouvrirClaude({ id: "a" });
  e.ouvrirClaude({ id: "b" });
  e.ouvrirClaude({ id: "c" });
  croix("Claude 2").click();
  e.ouvrirClaude({ id: "d" });
  expect(nomsOnglets()).toEqual(["Claude 1", "Claude 3", "Claude 2"]);
  croix("Claude 1").click();
  e.ouvrirClaude({ id: "e" });
  expect(nomsOnglets()).toEqual(["Claude 3", "Claude 2", "Claude 1"]);
});

test("REQ068_AC14_sans_fil_d_ariane_ni_boutons_ni_position", async () => {
  const { e, surActif, surCourant } = monterClaude();
  e.ouvrir({ chemin: "README.md", contenu: "# a", version: "1" });
  expect(boutonHybride()).not.toBeNull();
  expect(e.fil.hidden).toBe(false);
  e.ouvrirClaude({ id: "s1" });
  expect(e.fil.hidden).toBe(true);
  expect(boutonHybride()).toBeNull();
  expect(boutonApercu()).toBeNull();
  expect(dernier(surActif)).toEqual({});
  expect(dernier(surCourant)).toBeNull();
  expect(e.code.querySelector(".zone-code").hidden).toBe(true);
  // Le terminal prend la place de l'éditeur, dans la zone de code.
  expect(faux.vues[0].corps.parentNode).toBe(e.code);
  onglet("README.md").click();
  await Promise.resolve();
  expect(e.fil.hidden).toBe(false);
  expect(dernier(surActif).langage).toBe("Markdown");
});

test("REQ068_AC8_croix_suppr_et_menu_ferment_et_arretent", () => {
  const { e } = monterClaude();
  e.ouvrirClaude({ id: "a" });
  e.ouvrirClaude({ id: "b" });
  e.ouvrirClaude({ id: "c" });
  croix("Claude 1").click();
  // La vue se détruit avant l'arrêt de la session : aucune fermeture n'arrive à surFin.
  expect(faux.journal).toEqual(["detruire a", "fermer a"]);
  touche(onglet("Claude 2"), "Delete");
  expect(faux.journal.slice(2)).toEqual(["detruire b", "fermer b"]);
  expect(nomsOnglets()).toEqual(["Claude 3"]);
  clicDroit(onglet("Claude 3"));
  expect(menuOuvert().getAttribute("aria-label")).toBe("Actions sur Claude 3");
  choisirCommande("Fermer tous les onglets");
  expect(faux.journal.slice(4)).toEqual(["detruire c", "fermer c"]);
  expect(onglets().length).toBe(0);
  expect(e.code.textContent).toContain("Aucun fichier ouvert.");
});

test("REQ068_AC19_fermer_tous_claude_d_abord_puis_sauvegarder", async () => {
  const { e } = monterClaude();
  e.ouvrir({ chemin: "main.rs", contenu: "abc", version: "1" });
  modifier(e, "main.rs");
  e.ouvrirClaude({ id: "a" });
  e.ouvrirClaude({ id: "b" });
  clicDroit(onglet("Claude 1"));
  expect(menuOuvert().getAttribute("aria-label")).toBe("Actions sur Claude 1");
  choisirCommande("Fermer tous les onglets");
  // Les sessions s'arrêtent sans question, avant le dialogue du fichier modifié.
  expect(fermes()).toEqual(["fermer a", "fermer b"]);
  await vi.waitFor(() => expect(dialogueOuvert()?.textContent).toContain("Sauvegarder main.rs ?"));
  expect(nomsOnglets()).toEqual(["main.rs"]);
});

test("REQ068_AC16_fin_code_0_focus_selon_l_onglet_suivant", () => {
  const { e, dire } = monterClaude();
  e.ouvrir({ chemin: "main.rs", contenu: "abc", version: "1" });
  e.ouvrirClaude({ id: "a" });
  e.ouvrirClaude({ id: "b" });
  // Focus dans le terminal de Claude 2 (actif), qui finit : Claude 1 devient actif, son terminal prend le focus.
  faux.vues[1].surFin({ code: 0 });
  expect(nomsOnglets()).toEqual(["main.rs", "Claude 1"]);
  expect(document.activeElement).toBe(faux.vues[0].corps.querySelector("textarea"));
  // Puis Claude 1 finit : l'éditeur de main.rs reçoit le focus.
  faux.vues[0].surFin({ code: 0 });
  expect(nomsOnglets()).toEqual(["main.rs"]);
  expect(document.activeElement.getAttribute("aria-label")).toBe("Éditeur main.rs");
  // Aucun fichier ensuite : « Ouvrir un fichier ».
  e.ouvrirClaude({ id: "c" });
  croix("main.rs").click();
  faux.vues.at(-1).focus();
  faux.vues.at(-1).surFin({ code: 0 });
  expect(onglets().length).toBe(0);
  expect(document.activeElement.textContent).toBe("Ouvrir un fichier");
  // Le focus ailleurs : il ne bouge pas.
  e.ouvrir({ chemin: "a.txt", contenu: "x", version: "1" });
  e.ouvrirClaude({ id: "d" });
  const ailleurs = document.createElement("button");
  document.body.append(ailleurs);
  ailleurs.focus();
  faux.vues.at(-1).surFin({ code: 0 });
  expect(document.activeElement).toBe(ailleurs);
  expect(nomsOnglets()).toEqual(["a.txt"]);
  expect(fermes()).toEqual([]);
  expect(dire).not.toHaveBeenCalled();
});

test("REQ068_AC15_code_non_nul_l_onglet_reste_ouvert", () => {
  const { e } = monterClaude();
  e.ouvrirClaude({ id: "a" });
  faux.vues[0].surFin({ code: 1 });
  expect(nomsOnglets()).toEqual(["Claude 1"]);
  croix("Claude 1").click();
  expect(fermes()).toEqual(["fermer a"]);
});

test("REQ068_AC9_session_disparue_onglet_retire_sans_message", () => {
  const { e, dire } = monterClaude();
  e.ouvrir({ chemin: "main.rs", contenu: "abc", version: "1" });
  e.ouvrirClaude({ id: "a" });
  faux.vues[0].surFin({ disparue: true });
  expect(nomsOnglets()).toEqual(["main.rs"]);
  expect(dire).not.toHaveBeenCalled();
  expect(fermes()).toEqual([]);
});

function gardes(liste, actif) {
  lire.mockResolvedValueOnce({ liste, actif });
}
const fichierGarde = (chemin) => ({ groupe: "g1", chemin, apercu: false, hybride: false });
const claudeGarde = (id, numero, instance = "i1") => ({ groupe: "g1", claude: true, id, numero, instance });

test("REQ068_AC17_rechargement_focus_sur_l_onglet", async () => {
  gardes([fichierGarde("main.rs"), claudeGarde("a", 1)], "\0claude:a");
  const { e } = monterClaude({}, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["main.rs", "Claude 1"]);
  expect(actifNom()).toBe("Claude 1");
  expect(document.activeElement).toBe(onglet("Claude 1"));
  expect(faux.vues[0].focus).not.toHaveBeenCalled();
  // Entrée sur l'onglet (un clic pour un bouton) met le focus dans le terminal.
  onglet("Claude 1").click();
  expect(document.activeElement).toBe(faux.vues[0].corps.querySelector("textarea"));
});

test("REQ068_AC9_instance_changee_onglet_retire", async () => {
  gardes([fichierGarde("main.rs"), claudeGarde("a", 1, "ancienne")], "\0claude:a");
  const { e } = monterClaude({}, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["main.rs"]);
  expect(faux.vues.length).toBe(0);
  expect(actifNom()).toBe("main.rs");
});

test("REQ018_fichiers_et_claude_restaures_dans_l_ordre", async () => {
  gardes([fichierGarde("a.txt"), claudeGarde("x", 2), fichierGarde("b.txt"), claudeGarde("y", 1)], "b.txt");
  const { e } = monterClaude({}, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["a.txt", "Claude 2", "b.txt", "Claude 1"]);
  expect(actifNom()).toBe("b.txt");
  expect(faux.vues.map((v) => [v.id, v.nom])).toEqual([["x", "Claude 2"], ["y", "Claude 1"]]);
  // Un prochain onglet prend le numéro libre ; la liste gardée garde id, numéro et instance.
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  e.ouvrirClaude({ id: "z" });
  await vi.waitFor(() => expect(ecrire).toHaveBeenCalled());
  expect(nomsOnglets().at(-1)).toBe("Claude 3");
  const [, valeur] = ecrire.mock.calls.at(-1);
  expect(valeur.liste).toEqual([
    expect.objectContaining({ chemin: "a.txt" }),
    { groupe: "g1", claude: true, id: "x", numero: 2, instance: "i1" },
    expect.objectContaining({ chemin: "b.txt" }),
    { groupe: "g1", claude: true, id: "y", numero: 1, instance: "i1" },
    { groupe: "g1", claude: true, id: "z", numero: 3, instance: "i1" },
  ]);
  expect(valeur.actif).toBe("\0claude:z");
});

test("REQ068_AC8_coupure_la_croix_laisse_l_onglet_et_ne_ferme_aucune_session", async () => {
  const { e, dire } = monterClaude();
  e.ouvrir({ chemin: "main.rs", contenu: "abc", version: "1" });
  e.ouvrirClaude({ id: "a" });
  e.definirEtat("coupe");
  croix("Claude 1").click();
  touche(onglet("Claude 1"), "Delete");
  expect(nomsOnglets()).toEqual(["main.rs", "Claude 1"]);
  expect(dire).toHaveBeenCalledWith(expect.objectContaining({ texte: "Connexion perdue. Réessayez au retour." }));
  clicDroit(onglet("Claude 1"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(nomsOnglets()).toEqual(["Claude 1"]));
  expect(faux.journal.filter((j) => j.startsWith("fermer") || j.startsWith("detruire"))).toEqual([]);
  e.definirEtat("connecte");
  croix("Claude 1").click();
  expect(faux.journal).toEqual(["detruire a", "fermer a"]);
});

test("REQ070_AC6_onglets_claude_gardes_caches_puis_rendus", async () => {
  vi.resetModules();
  const garder = vi.fn();
  const gardee = [
    { claude: true, id: "t0", numero: 1, instance: "i1" },
    { claude: true, id: "t1", numero: 2, instance: "i1" },
    { chemin: "a.txt" },
    { claude: true, id: "s1", numero: 3, instance: "i1" },
    { claude: true, id: "s2", numero: 4, instance: "i1" },
    { chemin: "b.txt" },
  ];
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder, retrouver: async () => ({ liste: gardee, actif: "a.txt", disposition: { arbre: { id: "g1", actif: "a.txt" }, courant: "g1" } }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => "x" })));
  const { vueEditeur: neuf } = await import("./editeur.js");
  const e = neuf({ dire: vi.fn(), claude: false });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  vi.useFakeTimers();
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["a.txt", "b.txt"]);
  expect(fetch.mock.calls.some(([u]) => String(u).includes("/api/shells"))).toBe(false);
  e.ouvrir({ chemin: "c.txt", contenu: "y", version: "1" });
  await vi.advanceTimersByTimeAsync(250);
  vi.useRealTimers();
  const dernier = garder.mock.calls.at(-1)[0];
  expect(dernier.map((g) => g.chemin ?? `claude:${g.id}`)).toEqual(["claude:t0", "claude:t1", "a.txt", "claude:s1", "claude:s2", "b.txt", "c.txt"]);
  vi.doUnmock("../onglets-fichiers.js");
  vi.resetModules();
});

test("REQ070_AC17_claude_desactive_l_onglet_actif_est_le_fichier_et_le_focus_est_dans_son_editeur", async () => {
  vi.resetModules();
  const gardee = [{ chemin: "main.rs" }, { claude: true, id: "t0", numero: 1, instance: "i1" }];
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder: vi.fn(), retrouver: async () => ({ liste: gardee, actif: "t0", disposition: { arbre: { id: "g1", actif: "t0" }, courant: "g1" } }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => "x" })));
  const { vueEditeur: neuf } = await import("./editeur.js");
  const e = neuf({ dire: vi.fn(), claude: false });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["main.rs"]);
  expect(document.querySelector("[role=tab][aria-selected=true]").textContent).toContain("main.rs");
  expect(document.activeElement.closest(".cm-editor")).not.toBeNull();
  vi.doUnmock("../onglets-fichiers.js");
  vi.resetModules();
});

test("REQ018_brouillon_garde_identique_au_disque_n_est_ni_modifie_ni_en_conflit", async () => {
  vi.resetModules();
  const gardee = [{ chemin: "a.txt", texte: "sur le disque", base: "ancien", version: "1" }];
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder: vi.fn(), retrouver: async () => ({ liste: gardee, actif: "a.txt", disposition: { arbre: { id: "g1", actif: "a.txt" }, courant: "g1" } }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "x-version": "2" }), text: async () => "sur le disque" })));
  const { vueEditeur: neuf } = await import("./editeur.js");
  const e = neuf({ dire: vi.fn() });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  await e.restaurer();
  expect(onglet("a.txt").getAttribute("aria-label")).toBe("a.txt");
  expect(document.body.textContent).not.toContain("Quelle version garder ?");
  vi.doUnmock("../onglets-fichiers.js");
  vi.resetModules();
});

// ---- Onglets opencode (REQ-072) ----

const ocGarde = (id, numero) => ({ groupe: "g1", opencode: true, id, numero });
const saGarde = (id, agent, titre) => ({ groupe: "g1", opencode: true, id, agent, titre });

function monterOc(options = {}, restaurer = false) {
  faux.oc.length = 0;
  return monterClaude(options, restaurer);
}

test("REQ072_AC3_AC18_ouvre_opencode_1_puis_2_actif_focus", () => {
  const { e } = monterOc();
  e.ouvrir({ chemin: "src/main.rs", contenu: "x", version: "1" });
  e.ouvrirOpencode({ sessionId: "s1" });
  expect(nomsOnglets()).toEqual(["main.rs", "opencode 1"]);
  expect(actifNom()).toBe("opencode 1");
  const t = onglet("opencode 1");
  expect(t.title).toBe("opencode dans ~/code/projet");
  expect(t.getAttribute("aria-label")).toBe("opencode 1");
  expect(t.querySelector("svg[data-icone=code-xml]")).not.toBeNull();
  expect(faux.oc[0].sessionId).toBe("s1");
  expect(faux.oc[0].sousAgent).toBeFalsy();
  expect(document.activeElement).toBe(faux.oc[0].cible);
  expect(faux.oc[0].corps.hidden).toBe(false);
  e.ouvrirOpencode({ sessionId: "s2" });
  expect(nomsOnglets()).toEqual(["main.rs", "opencode 1", "opencode 2"]);
  expect(actifNom()).toBe("opencode 2");
  expect(faux.oc[0].corps.hidden).toBe(true);
  expect(document.activeElement).toBe(faux.oc[1].cible);
  onglet("opencode 1").click();
  expect(faux.oc[0].corps.hidden).toBe(false);
  expect(faux.oc[0].detruire).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(faux.oc[0].cible);
});

test("REQ072_AC18_plus_petit_numero_libre", () => {
  const { e } = monterOc();
  e.ouvrirClaude({ id: "c" });
  e.ouvrirOpencode({ sessionId: "a" });
  e.ouvrirOpencode({ sessionId: "b" });
  e.ouvrirOpencode({ sessionId: "c" });
  croix("opencode 1").click();
  e.ouvrirOpencode({ sessionId: "d" });
  expect(nomsOnglets()).toEqual(["Claude 1", "opencode 2", "opencode 3", "opencode 1"]);
});

test("REQ072_AC19_sans_fil_d_ariane_ni_boutons_ni_position", () => {
  const { e, surActif, surCourant } = monterOc();
  e.ouvrir({ chemin: "notes.md", contenu: "# x", version: "1" });
  expect(document.querySelector("[aria-label='Mode hybride']")).not.toBeNull();
  e.ouvrirOpencode({ sessionId: "s1" });
  expect(e.fil.hidden).toBe(true);
  expect(document.querySelector("[aria-label='Mode hybride']")).toBeNull();
  expect(document.querySelector("[aria-label='Aperçu']")).toBeNull();
  expect(dernier(surActif)).toEqual({});
  expect(dernier(surCourant)).toBeNull();
});

test("REQ072_AC7_sous_agent_nouvel_onglet_puis_reactive", () => {
  const { e } = monterOc();
  e.ouvrir({ chemin: "a.txt", contenu: "x", version: "1" });
  e.ouvrirOpencode({ sessionId: "s1" });
  e.ouvrir({ chemin: "b.txt", contenu: "x", version: "1" });
  onglet("opencode 1").click();
  faux.oc[0].surOuvrir({ id: "sa1", agent: "explore", titre: "Chercher les usages" });
  expect(nomsOnglets()).toEqual(["a.txt", "opencode 1", "explore", "b.txt"]);
  expect(actifNom()).toBe("explore");
  const t = onglet("explore");
  expect(t.title).toBe("Chercher les usages");
  expect(t.getAttribute("aria-label")).toBe("explore, sous-agent : Chercher les usages");
  expect(faux.oc[1].sousAgent).toBe(true);
  expect(faux.oc[1].sessionId).toBe("sa1");
  expect(document.activeElement).toBe(faux.oc[1].cible);
  // Second « Ouvrir » : l'onglet est activé, sans second onglet.
  onglet("opencode 1").click();
  faux.oc[0].surOuvrir({ id: "sa1", agent: "explore", titre: "Chercher les usages" });
  expect(nomsOnglets()).toEqual(["a.txt", "opencode 1", "explore", "b.txt"]);
  expect(actifNom()).toBe("explore");
  expect(faux.oc.length).toBe(2);
  // Un sous-agent du sous-agent s'ouvre de même.
  faux.oc[1].surOuvrir({ id: "sa2", agent: "general", titre: "Lire" });
  expect(nomsOnglets()).toEqual(["a.txt", "opencode 1", "explore", "general", "b.txt"]);
});

test("REQ072_AC24_marque_question_suit_la_vue", () => {
  const { e } = monterOc();
  e.ouvrirOpencode({ sessionId: "s1" });
  faux.oc[0].surOuvrir({ id: "sa1", agent: "explore", titre: "T" });
  faux.oc[0].surQuestion(true);
  faux.oc[1].surQuestion(true);
  expect(onglet("opencode 1").getAttribute("aria-label")).toBe("opencode 1, question en attente");
  expect(onglet("opencode 1").textContent).toContain("!");
  expect(onglet("explore").getAttribute("aria-label")).toBe("explore, sous-agent : T, question en attente");
  faux.oc[0].surQuestion(false);
  faux.oc[1].surQuestion(false);
  expect(onglet("opencode 1").getAttribute("aria-label")).toBe("opencode 1");
  expect(onglet("opencode 1").textContent).not.toContain("!");
  expect(onglet("explore").getAttribute("aria-label")).toBe("explore, sous-agent : T");
});

test("REQ072_AC24_marque_d_une_demande_deja_la_a_l_ouverture_de_l_onglet", () => {
  const { e } = monterOc();
  faux.marqueAuDepart = true;
  try {
    e.ouvrirOpencode({ sessionId: "s1" });
  } finally {
    faux.marqueAuDepart = false;
  }
  expect(onglet("opencode 1").getAttribute("aria-label")).toBe("opencode 1, question en attente");
});

test("REQ072_AC11_fermer_sans_question_ni_appel", () => {
  const { e } = monterOc();
  e.ouvrirOpencode({ sessionId: "a" });
  e.ouvrirOpencode({ sessionId: "b" });
  e.ouvrirOpencode({ sessionId: "c" });
  faux.oc[0].surQuestion(true);
  croix("opencode 1").click();
  expect(nomsOnglets()).toEqual(["opencode 2", "opencode 3"]);
  expect(document.querySelector("[role=dialog], dialog[open]")).toBeNull();
  touche(onglet("opencode 2"), "Delete");
  expect(nomsOnglets()).toEqual(["opencode 3"]);
  clicDroit(onglet("opencode 3"));
  choisirCommande("Fermer tous les onglets");
  expect(nomsOnglets()).toEqual([]);
  expect(faux.journal).toEqual(["detruire oc:a", "detruire oc:b", "detruire oc:c"]);
  expect(fetch).not.toHaveBeenCalled();
});

test("REQ072_AC11_fermer_tous_avec_onglets_opencode", async () => {
  const { e } = monterOc();
  e.ouvrir({ chemin: "a.txt", contenu: "x", version: "1" });
  e.ouvrirOpencode({ sessionId: "a" });
  e.ouvrirOpencode({ sessionId: "b" });
  e.definirEtat("coupe");
  clicDroit(onglet("opencode 2"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(nomsOnglets()).toEqual([]));
  expect(fermes()).toEqual([]);
});

test("REQ072_AC10_AC28_restaures_et_focus_au_chargement", async () => {
  gardes([ocGarde("a", 1), saGarde("sa", "explore", "Chercher")], "\0oc:a");
  const { e } = monterOc({}, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["opencode 1", "explore"]);
  expect(actifNom()).toBe("opencode 1");
  expect(faux.oc.map((v) => [v.sessionId, Boolean(v.sousAgent)])).toEqual([["a", false], ["sa", true]]);
  expect(document.activeElement).toBe(faux.oc[0].cible);
  expect(onglet("explore").getAttribute("aria-label")).toBe("explore, sous-agent : Chercher");
  expect(onglet("explore").title).toBe("Chercher");
  onglet("explore").click();
  expect(document.activeElement).toBe(faux.oc[1].cible);
  // Aucune vérification d'instance ni lecture de fichier.
  expect(fetch).not.toHaveBeenCalled();
});

test("REQ028_AC23_ctrl_s_ne_fait_rien_sur_opencode", () => {
  const { e } = monterOc();
  e.ouvrirOpencode({ sessionId: "a" });
  const ev = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
  faux.oc[0].cible.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

test("REQ018_fichiers_claude_et_opencode_restaures_dans_l_ordre", async () => {
  gardes([fichierGarde("a.txt"), ocGarde("x", 2), claudeGarde("c", 1), saGarde("sa", "explore", "T"), fichierGarde("b.txt")], "b.txt");
  const { e } = monterOc({}, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["a.txt", "opencode 2", "Claude 1", "explore", "b.txt"]);
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  e.ouvrirOpencode({ sessionId: "z" });
  await vi.waitFor(() => expect(ecrire).toHaveBeenCalled());
  expect(nomsOnglets().at(-1)).toBe("opencode 1");
  const [, valeur] = ecrire.mock.calls.at(-1);
  expect(valeur.liste).toEqual([
    expect.objectContaining({ chemin: "a.txt" }),
    { groupe: "g1", opencode: true, id: "x", numero: 2 },
    { groupe: "g1", claude: true, id: "c", numero: 1, instance: "i1" },
    { groupe: "g1", opencode: true, id: "sa", agent: "explore", titre: "T" },
    expect.objectContaining({ chemin: "b.txt" }),
    { groupe: "g1", opencode: true, id: "z", numero: 1 },
  ]);
  expect(valeur.actif).toBe("\0oc:z");
});

test("REQ018_onglet_claude_cache_garde_sa_place_apres_un_onglet_opencode", async () => {
  gardes([fichierGarde("a.txt"), ocGarde("x", 1), claudeGarde("c", 1), fichierGarde("b.txt")], "a.txt");
  const { e } = monterOc({ claude: false }, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["a.txt", "opencode 1", "b.txt"]);
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  e.ouvrirOpencode({ sessionId: "z" });
  await vi.waitFor(() => expect(ecrire).toHaveBeenCalled());
  const [, valeur] = ecrire.mock.calls.at(-1);
  expect(valeur.liste.map((g) => g.chemin ?? g.id)).toEqual(["a.txt", "x", "c", "b.txt", "z"]);
});

// ---- Onglets Agent (REQ-078) ----

const agGarde = (numero, conversation = null) => ({ groupe: "g1", conversationAgent: true, numero, conversation });
function monterAg(options = {}, restaurer = false) {
  faux.ag.length = 0;
  faux.oc.length = 0;
  return monterClaude(options, restaurer);
}
async function derniereGarde() {
  const { ecrire } = await import("../stockage.js");
  await vi.waitFor(() => expect(ecrire).toHaveBeenCalled());
  return ecrire.mock.calls.at(-1)[1];
}

test("REQ078_AC2_onglet_vide_rien_enregistre", async () => {
  gardes([], null);
  const { e } = monterAg({}, true);
  await e.restaurer();
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  e.ouvrirAgent({ equipe: [{ dossier: "a", nom: "A" }] });
  expect(faux.ag[0].equipe).toEqual([{ dossier: "a", nom: "A" }]);
  expect(faux.ag[0].conversation).toBeUndefined();
  const g = await derniereGarde();
  expect(g.liste).toEqual([{ groupe: "g1", conversationAgent: true, numero: 1, conversation: null }]);
  expect(g.actif).toBe("\0agent:1");
  expect(fetch).not.toHaveBeenCalled();
});

test("REQ126_AC2_ouvrirAgent_passe_le_message_a_la_vue", async () => {
  gardes([], null);
  const { e } = monterAg({}, true);
  await e.restaurer();
  e.ouvrirAgent({ equipe: [{ dossier: "a", nom: "A" }], message: "Consulte `a.md`." });
  expect(faux.ag[0].message).toBe("Consulte `a.md`.");
  e.ouvrirAgent();
  expect(faux.ag[1].message).toBeUndefined();
});

test("REQ078_AC5_conversation_deja_ouverte_active_son_onglet", () => {
  const { e } = monterAg();
  e.ouvrirAgent();
  e.ouvrirAgent();
  faux.ag[0].surConversation("c1");
  expect(actifNom()).toBe("Agent 2");
  expect(faux.ag[1].surDejaOuverte("c1")).toBe(true);
  expect(actifNom()).toBe("Agent 1");
  expect(document.activeElement).toBe(faux.ag[0].champ);
  expect(faux.ag[1].surDejaOuverte("autre")).toBe(false);
  expect(actifNom()).toBe("Agent 1");
  expect(nomsOnglets()).toEqual(["Agent 1", "Agent 2"]);
});

test("REQ078_AC5_autre_conversation_dans_l_onglet_courant", async () => {
  gardes([], null);
  const { e } = monterAg({}, true);
  await e.restaurer();
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  e.ouvrirAgent();
  e.ouvrirAgent();
  faux.ag[0].surConversation("c1");
  faux.ag[1].surConversation("c2");
  const g = await derniereGarde();
  expect(g.liste).toEqual([agGarde(1, "c1"), agGarde(2, "c2")]);
  expect(actifNom()).toBe("Agent 2");
});

test("REQ078_AC6_retour_avec_conversation_et_vide", async () => {
  gardes([agGarde(1, "c1"), agGarde(2)], "\0agent:2");
  const { e } = monterAg({}, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["Agent 1", "Agent 2"]);
  expect(actifNom()).toBe("Agent 2");
  expect(faux.ag[0].conversation).toBe("c1");
  expect(faux.ag[0].equipe).toBeUndefined();
  expect(faux.ag[1].conversation).toBeUndefined();
  expect(faux.ag[1].equipe).toBeUndefined();
  expect(document.activeElement).toBe(faux.ag[1].champ);
});

test("REQ078_AC6_conversation_disparue_onglet_vide", async () => {
  gardes([agGarde(1, "c1")], "\0agent:1");
  const { e } = monterAg({}, true);
  await e.restaurer();
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  faux.ag[0].surConversation(null);
  const g = await derniereGarde();
  expect(g.liste).toEqual([agGarde(1, null)]);
  expect(nomsOnglets()).toEqual(["Agent 1"]);
});

test("REQ078_AC7_fermer_sans_question_ni_requete", async () => {
  const { e } = monterAg();
  e.ouvrirAgent();
  e.ouvrirAgent();
  e.ouvrirAgent();
  faux.ag[0].surConversation("c1");
  fetch.mockClear();
  croix("Agent 1").click();
  expect(nomsOnglets()).toEqual(["Agent 2", "Agent 3"]);
  expect(faux.ag[0].detruire).toHaveBeenCalled();
  e.definirEtat("coupe");
  croix("Agent 2").click();
  expect(nomsOnglets()).toEqual(["Agent 3"]);
  expect(dialogueOuvert()).toBeNull();
  clicDroit(onglet("Agent 3"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(nomsOnglets()).toEqual([]));
  expect(fetch).not.toHaveBeenCalled();
  expect(faux.journal.filter((j) => j.startsWith("fermer"))).toEqual([]);
});

test("REQ078_AC8_profils_relus_dans_tous_les_onglets", () => {
  const { e } = monterAg();
  e.ouvrirAgent();
  e.ouvrirAgent();
  e.relireReglagesAgents();
  expect(faux.ag[0].relireReglages).toHaveBeenCalledTimes(1);
  expect(faux.ag[1].relireReglages).toHaveBeenCalledTimes(1);
});

test("REQ078_AC9_onglet_cache_revient_a_sa_place", async () => {
  gardes([fichierGarde("a.txt"), agGarde(1, "c1"), fichierGarde("b.txt")], "a.txt");
  const { e } = monterAg({ agents: false }, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["a.txt", "b.txt"]);
  expect(faux.ag).toHaveLength(0);
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  e.ouvrir({ chemin: "z.txt", contenu: "x", version: "1" });
  const g = await derniereGarde();
  expect(g.liste.map((x) => x.chemin ?? x.numero)).toEqual(["a.txt", 1, "b.txt", "z.txt"]);
  expect(g.liste[1]).toEqual(agGarde(1, "c1"));
});

test("REQ078_AC9_onglet_affiche_compte_comme_precedent", async () => {
  gardes([agGarde(1, "c1"), claudeGarde("c", 1), fichierGarde("b.txt")], "b.txt");
  const { e } = monterAg({ claude: false }, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["Agent 1", "b.txt"]);
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  e.ouvrirAgent();
  const g = await derniereGarde();
  expect(g.liste.map((x) => x.chemin ?? x.id ?? `agent${x.numero}`)).toEqual(["agent1", "c", "b.txt", "agent2"]);
});

test("REQ078_AC9_onglet_cache_apres_un_onglet_claude_affiche_reste_apres_lui", async () => {
  gardes([claudeGarde("c", 1), agGarde(1, "c1"), fichierGarde("b.txt")], "b.txt");
  const { e } = monterAg({ agents: false }, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["Claude 1", "b.txt"]);
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  e.ouvrir({ chemin: "z.txt", contenu: "x", version: "1" });
  const g = await derniereGarde();
  expect(g.liste.map((x) => x.chemin ?? x.id ?? `agent${x.numero}`)).toEqual(["c", "agent1", "b.txt", "z.txt"]);
});

test("REQ078_AC20_focus_apres_fermeture_d_un_onglet_agent", () => {
  const { e } = monterAg();
  e.ouvrirAgent();
  e.ouvrirAgent();
  // Croix d'un onglet inactif : rien ne change.
  const actifAvant = document.activeElement;
  croix("Agent 1").click();
  expect(actifNom()).toBe("Agent 2");
  expect(document.activeElement).toBe(actifAvant);
  e.ouvrirAgent();
  expect(nomsOnglets()).toEqual(["Agent 2", "Agent 1"]);
  // Suppr sur l'onglet actif, le dernier : l'avant-dernier devient actif, le focus dans son champ.
  onglet("Agent 1").focus();
  touche(onglet("Agent 1"), "Delete");
  expect(actifNom()).toBe("Agent 2");
  expect(document.activeElement).toBe(faux.ag[1].champ);
  // Dernier onglet fermé.
  onglet("Agent 2").focus();
  touche(onglet("Agent 2"), "Delete");
  expect(nomsOnglets()).toEqual([]);
  expect(document.activeElement.textContent).toBe("Ouvrir un fichier");
});

test("REQ078_AC11_noms_et_plus_petit_numero_libre", () => {
  const { e } = monterAg();
  e.ouvrir({ chemin: "src/main.rs", contenu: "x", version: "1" });
  e.ouvrirAgent();
  e.ouvrirAgent();
  e.ouvrirAgent();
  expect(nomsOnglets()).toEqual(["main.rs", "Agent 1", "Agent 2", "Agent 3"]);
  const t = onglet("Agent 1");
  expect(t.title).toBe("Agent dans ~/code/projet");
  expect(t.getAttribute("aria-label")).toBe("Agent 1");
  expect(t.querySelector("svg[data-icone=bot]")).not.toBeNull();
  expect(t.querySelector(".onglet-statut-M, .onglet-modifie")).toBeNull();
  expect(croix("Agent 1")).not.toBeNull();
  const region = faux.ag[0].corps;
  expect(region.getAttribute("role")).toBe("region");
  expect(region.getAttribute("aria-label")).toBe("Agent 1");
  croix("Agent 1").click();
  e.ouvrirAgent();
  expect(nomsOnglets()).toEqual(["main.rs", "Agent 2", "Agent 3", "Agent 1"]);
  expect(actifNom()).toBe("Agent 1");
});

test("REQ078_AC12_ni_fil_ni_hybride_ni_apercu", () => {
  const { e, surActif, surCourant } = monterAg();
  e.ouvrir({ chemin: "notes.md", contenu: "# x", version: "1" });
  expect(document.querySelector("[aria-label='Aperçu']")).not.toBeNull();
  e.ouvrirAgent();
  expect(e.fil.hidden).toBe(true);
  expect(document.querySelector("[aria-label='Mode hybride']")).toBeNull();
  expect(document.querySelector("[aria-label='Aperçu']")).toBeNull();
  expect(dernier(surActif)).toEqual({});
  expect(dernier(surCourant)).toBeNull();
});

test("REQ078_AC14_focus_rechargement_et_clic", async () => {
  gardes([agGarde(1, "c1"), agGarde(2)], "\0agent:1");
  const { e } = monterAg({}, true);
  await e.restaurer();
  expect(document.activeElement).toBe(faux.ag[0].champ);
  onglet("Agent 2").click();
  expect(document.activeElement).toBe(faux.ag[1].champ);
  onglet("Agent 1").click();
  expect(document.activeElement).toBe(faux.ag[0].champ);
});

test("REQ078_liste_conversations_relue_au_retour_sur_l_onglet", () => {
  const { e } = monterAg();
  e.ouvrirAgent();
  e.ouvrirAgent();
  faux.ag[0].majListe.mockClear();
  onglet("Agent 1").click();
  expect(faux.ag[0].majListe).toHaveBeenCalledTimes(1);
  expect(faux.ag[0].majListe.mock.invocationCallOrder[0]).toBeLessThan(faux.ag[0].focuser.mock.invocationCallOrder.at(-1));
  expect(faux.ag[1].majListe).toHaveBeenCalledTimes(1); // à son ouverture
});

test("REQ078_sous_agent_opencode_reste_un_onglet_opencode", async () => {
  gardes([ocGarde("s", 1), saGarde("sa", "explore", "Chercher"), agGarde(1)], "\0oc:sa");
  const { e } = monterAg({}, true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["opencode 1", "explore", "Agent 1"]);
  expect(faux.oc).toHaveLength(2);
  expect(faux.ag).toHaveLength(1);
  expect(onglet("explore").getAttribute("aria-label")).toBe("explore, sous-agent : Chercher");
  e.ouvrirAgent();
  const g = await derniereGarde();
  expect(g.liste).toEqual([ocGarde("s", 1), saGarde("sa", "explore", "Chercher"), agGarde(1), agGarde(2)]);
});

test("REQ088_AC4_AC5_session_rouverte_onglet_titre_puis_meme_onglet", () => {
  const { e } = monterOc();
  e.ouvrirOpencode({ sessionId: "s1", titre: "Corriger parse_args" });
  e.ouvrirOpencode({ sessionId: "s2" });
  expect(nomsOnglets()).toEqual(["opencode 1", "opencode 2"]);
  expect(onglet("opencode 1").title).toBe("Corriger parse_args");
  expect(onglet("opencode 2").title).toBe("opencode dans ~/code/projet");
  e.ouvrirOpencode({ sessionId: "s1", titre: "Autre" });
  expect(nomsOnglets()).toEqual(["opencode 1", "opencode 2"]);
  expect(actifNom()).toBe("opencode 1");
  expect(onglet("opencode 1").title).toBe("Corriger parse_args");
  expect(document.activeElement).toBe(faux.oc[0].cible);
  expect(faux.oc).toHaveLength(2);
});

test("REQ088_AC7_titre_garde_restaure_et_fermeture_sans_requete", async () => {
  gardes([], null);
  const { e } = monterOc({}, true);
  await e.restaurer();
  const { ecrire } = await import("../stockage.js");
  ecrire.mockClear();
  e.ouvrirOpencode({ sessionId: "s1", titre: "Corriger parse_args" });
  const g = await derniereGarde();
  expect(g.liste).toEqual([{ ...ocGarde("s1", 1), titre: "Corriger parse_args" }]);
  fetch.mockClear();
  croix("opencode 1").click();
  expect(fetch).not.toHaveBeenCalled();
  e.detruire();
  document.body.replaceChildren();
  gardes([{ ...ocGarde("s1", 1), titre: "Corriger parse_args" }], "\0oc:s1");
  const { e: e2 } = monterOc({}, true);
  await e2.restaurer();
  expect(onglet("opencode 1").title).toBe("Corriger parse_args");
});

// ---- REQ-086 : fichier d'un autre worktree ----

test("REQ086_AC4_onglet_d_un_autre_worktree_fil_sans_points_info_bulle_lettre_et_ecriture", async () => {
  const appels = ecritures();
  const { e } = monter();
  e.ouvrir({ chemin: "src/main.rs", contenu: "fn a() {}", version: "1" });
  e.ouvrir({ chemin: "../essai/src/main.rs", contenu: "fn b() {}", version: "1" });
  expect(e.fil.textContent).toBe("essaisrcmain.rs");
  expect(e.fil.querySelectorAll("svg[data-icone=chevron]").length).toBe(2);
  const tabs = [...e.barre.querySelectorAll("[role=tab]")];
  expect(tabs.map((t) => t.title || t.querySelector("[title]")?.title)).toEqual(["src/main.rs", "../essai/src/main.rs"]);
  // Statut du worktree choisi : seul l'onglet de ce worktree prend la lettre.
  e.definirStatuts(new Map([["../essai/src/main.rs", { lettre: "M", mot: "modifié" }]]));
  const labels = [...e.barre.querySelectorAll("[role=tab]")].map((t) => t.getAttribute("aria-label"));
  expect(labels[0]).not.toContain("modifié");
  expect(labels[1]).toContain("modifié");
  // L'onglet modifié reste ouvert et Ctrl+S écrit vers ../essai/…
  e.code.querySelector(".zone-code:not([hidden])").vue.dispatch({ changes: { from: 0, insert: "X" } });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  expect(appels).toEqual(["../essai/src/main.rs"]);
});

// ---- Ouvrir le fichier cité (REQ-087) ----

const PROJET = "/home/u/code/projet";
function fauxFichiers(fichiers) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const chemin = decodeURIComponent(new URL(String(url), "http://x").searchParams.get("chemin"));
    const f = fichiers[chemin];
    if (f === "coupure") throw new TypeError("réseau");
    if (f?.cause) return { ok: false, status: 400, json: async () => f };
    if (f === undefined) return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "Fichier introuvable." }) };
    return { ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => f };
  }));
}
const lienFichier = () => {
  const a = document.createElement("a");
  a.href = "src/x";
  document.body.append(a);
  a.focus();
  return a;
};

test("REQ087_AC1_AC2_AC10_clic_dans_l_onglet_Agent_ouvre_le_fichier_a_la_ligne_focus_dans_l_editeur", async () => {
  const { e } = monterAg({ chemin: PROJET });
  fauxFichiers({ "src/main.rs": "a\nb\nc\nd\n", "src/court.rs": "x\ny" });
  e.ouvrirAgent();
  await faux.ag[0].ouvrirReference({ chemin: "src/main.rs", ligne: 3 }, lienFichier());
  expect(nomsOnglets()).toEqual(["Agent 1", "main.rs"]);
  expect(actifNom()).toBe("main.rs");
  const vue = e.code.querySelector(".zone-code").vue;
  expect(document.activeElement).toBe(vue.contentDOM);
  expect(vue.state.selection.main.head).toBe(vue.state.doc.line(3).from);
  await faux.ag[0].ouvrirReference({ chemin: "src/court.rs", ligne: 99 }, lienFichier());
  const v2 = e.code.querySelector(".zone-code:not([hidden])")?.vue ?? e.code.querySelector(".zone-code").vue;
  expect(actifNom()).toBe("court.rs");
  expect(v2.state.selection.main.head).toBe(v2.state.doc.line(2).from);
});

test("REQ087_AC3_onglet_deja_ouvert_active_sans_relire_et_garde_les_modifications", async () => {
  const { e } = monterAg({ chemin: PROJET });
  fauxFichiers({ "src/main.rs": "disque\nb\nc\n" });
  e.ouvrirAgent();
  e.ouvrir({ chemin: "src/main.rs", contenu: "disque\nb\nc\n", version: "1" });
  const vue = e.code.querySelector(".zone-code").vue;
  vue.dispatch({ changes: { from: 0, insert: "brouillon " } });
  e.ouvrirAgent();
  fetch.mockClear();
  await faux.ag[1].ouvrirReference({ chemin: "src/main.rs", ligne: 2 }, lienFichier());
  expect(fetch).not.toHaveBeenCalled();
  expect(nomsOnglets().filter((n) => n === "main.rs")).toHaveLength(1);
  expect(actifNom()).toBe("main.rs");
  expect(vue.state.doc.toString()).toBe("brouillon disque\nb\nc\n");
  expect(vue.state.doc.lineAt(vue.state.selection.main.head).number).toBe(2);
});

test("REQ087_AC4_chemin_absolu_dans_un_worktree_ouvre_l_onglet_relatif_au_projet", async () => {
  const { e } = monterAg({ chemin: PROJET });
  fauxFichiers({ "../essai/src/main.rs": "w\n" });
  e.ouvrirAgent();
  await faux.ag[0].ouvrirReference({ chemin: "/home/u/code/essai/src/main.rs", ligne: 1 }, lienFichier());
  expect(String(fetch.mock.calls[0][0])).toContain(encodeURIComponent("../essai/src/main.rs"));
  expect(actifNom()).toBe("main.rs");
  expect(onglet("main.rs").title).toBe("../essai/src/main.rs");
  expect(choisi()).toBe("");
});

test("REQ087_AC5_AC11_chaque_refus_dit_son_texte_un_seul_message_focus_sur_le_lien", async () => {
  const { e, dire } = monterAg({ chemin: PROJET });
  const retire = vi.fn();
  dire.mockImplementation(() => ({ remove: retire }));
  fauxFichiers({
    "web/src": { cause: "invalide", message: "C'est un dossier." },
    "img/outil.dat": { cause: "binaire", message: "C'est un fichier binaire." },
    "logs/gros.log": { cause: "trop-gros", message: "Trop gros." },
    "../../../../etc/hosts": { cause: "interdit", message: "Ce chemin sort du projet." },
    "src/lourd.rs": { cause: "erreur", message: "Lecture impossible." },
    "../autre/x.rs": { cause: "interdit", message: "Ce chemin sort du projet." },
    "src/rien.rs": "coupure",
  });
  e.ouvrirAgent();
  const attendus = [
    ["src/absent.rs", "src/absent.rs n'existe pas."],
    ["web/src", "web/src est un dossier. Yaide ne l'ouvre pas."],
    ["img/outil.dat", "img/outil.dat est un fichier binaire. Yaide ne l'ouvre pas."],
    ["logs/gros.log", "logs/gros.log dépasse 5 Mo. Yaide ne l'ouvre pas."],
    ["/etc/hosts", "/etc/hosts est hors du projet et de ses worktrees. Yaide ne l'ouvre pas."],
    ["src/lourd.rs", "Impossible d'ouvrir src/lourd.rs : Lecture impossible."],
    ["../autre/x.rs", "../autre/x.rs est hors du projet et de ses worktrees. Yaide ne l'ouvre pas."],
    ["src/rien.rs", "Connexion perdue. Réessayez au retour."],
  ];
  for (const [i, [ecrit, texte]] of attendus.entries()) {
    const lien = lienFichier();
    await faux.ag[0].ouvrirReference({ chemin: ecrit }, lien);
    expect(dire).toHaveBeenLastCalledWith({ texte, variante: "alerte", fermable: true });
    expect(retire).toHaveBeenCalledTimes(i); // le message précédent part
    expect(document.activeElement).toBe(lien);
  }
  expect(nomsOnglets()).toEqual(["Agent 1"]);
});

test("REQ087_AC7_session_opencode_et_sous_agent_ouvrent_dans_leur_groupe_et_gardent_leur_fil", async () => {
  const { e } = monterAg({ chemin: PROJET });
  fauxFichiers({ "src/main.rs": "a\nb\n" });
  e.ouvrirOpencode({ sessionId: "s1" });
  faux.oc[0].surOuvrir({ id: "sa1", agent: "explore", titre: "T" });
  await faux.oc[1].ouvrirReference({ chemin: "src/main.rs", ligne: 2 }, lienFichier());
  expect(nomsOnglets()).toEqual(["opencode 1", "explore", "main.rs"]);
  expect(actifNom()).toBe("main.rs");
  await faux.oc[0].ouvrirReference({ chemin: "src/main.rs" }, lienFichier());
  expect(nomsOnglets().filter((n) => n === "main.rs")).toHaveLength(1);
  expect(faux.oc[0].detruire).not.toHaveBeenCalled();
});

test("REQ087_AC1_le_fichier_s_ouvre_dans_le_groupe_de_la_conversation_pas_dans_le_groupe_courant", async () => {
  let c = null;
  const { e } = monterAg({ chemin: PROJET, surGroupes: (arbre, courant) => c?.definirGroupes(arbre, courant) });
  c = cadre({ principal: { groupes: e.groupes() } });
  document.body.append(c);
  fauxFichiers({ "src/main.rs": "a\nb\n" });
  e.ouvrir({ chemin: "autre.txt", contenu: "x", version: "1" });
  e.ouvrirAgent();
  e.deplacer("autre.txt", "g1", "droite"); // g2 : autre.txt, courant
  await Promise.resolve();
  const noms = () => [...document.querySelectorAll("[role=tablist]")].map((b) => [...b.querySelectorAll("[role=tab] .onglet-nom")].map((t) => t.textContent));
  expect(noms()).toEqual([["Agent 1"], ["autre.txt"]]);
  await faux.ag[0].ouvrirReference({ chemin: "src/main.rs", ligne: 1 }, lienFichier());
  expect(noms()).toEqual([["Agent 1", "main.rs"], ["autre.txt"]]);
});

test("REQ058_AC1_AC14_AC18_AC20_sauvegarde_recharge_les_apercus_html_de_la_page", async () => {
  let jeton = "jj";
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).includes("/api/apercu")) return { ok: true, status: 200, json: async () => ({ jeton }) };
    return { ok: true, status: 200, json: async () => ({ version: "2" }) };
  }));
  try {
  const { e } = monter();
  e.ouvrir({ chemin: "site/index.html", contenu: "<p>a</p>", version: "1" });
  e.ouvrir({ chemin: "site/style.css", contenu: "p{}", version: "1" });
  const cadreHtml = () => document.querySelector('iframe[title="Aperçu"]');
  await new Promise((r) => setTimeout(r, 20));
  expect(cadreHtml().getAttribute("src")).toBe("/apercu/jj/site/index.html");
  cadreHtml().setAttribute("src", "about:blank");
  // la frappe ne recharge pas
  e.code.querySelector(".zone-code:not([hidden])").vue.dispatch({ changes: { from: 0, insert: "X" } });
  await new Promise((r) => setTimeout(r, 20));
  expect(cadreHtml().getAttribute("src")).toBe("about:blank");
  // la sauvegarde d'un autre fichier recharge la page
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 40));
  expect(cadreHtml().getAttribute("src")).toBe("/apercu/jj/site/index.html");
  // pendant une coupure : pas de rechargement, puis rechargement au retour
  cadreHtml().setAttribute("src", "about:blank");
  e.definirEtat("coupe");
  document.querySelector('iframe[title="Aperçu"]').closest(".zone-code").vue.dispatch({ changes: { from: 0, insert: "Y" } });
  e.ouvrir({ chemin: "site/style.css", contenu: "p{}", version: "1" });
  e.code.querySelector(".zone-code:not([hidden])").vue.dispatch({ changes: { from: 0, insert: "Z" } });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 40));
  expect(cadreHtml().getAttribute("src")).toBe("about:blank");
  // au retour : un autre jeton, la sauvegarde en attente s'écrit et la page se recharge avec le nouveau jeton
  jeton = "kk";
  e.definirEtat("connecte");
  await new Promise((r) => setTimeout(r, 60));
  expect(cadreHtml().getAttribute("src")).toBe("/apercu/kk/site/index.html");
  } finally {
    vi.unstubAllGlobals();
  }
});

// ---- Suivre un lien d'un document (REQ-101) ----

const GUIDE = "titre\n\n[Lire](../README.md)\n\n[l. 3](../src/main.rs#L3)\n\n[ancre](autre.md#lancer-les-tests)\n\n[absent](absent.md)\n";
function monterDocument(fichiers, contenu = GUIDE) {
  fauxFichiers(fichiers);
  const surLien = vi.fn();
  const dire = vi.fn(() => ({ remove: vi.fn() }));
  const e = vueEditeur({ dire, surLien, chemin: PROJET });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  e.ouvrir({ chemin: "docs/guide.md", contenu, version: "1" });
  const zone = () => e.code.querySelector(".zone-code");
  const sur = (z, texte, type, init) => {
    ensureSyntaxTree(z.vue.state, z.vue.state.doc.length, 5000);
    z.vue.posAtCoords = () => z.vue.state.doc.toString().indexOf(`[${texte}]`) + 1;
    z.vue.contentDOM.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  };
  const lien = (texte, type = "mousemove", init = {}) => sur(zone(), texte, type, init);
  const suivre = (texte, z = zone()) => sur(z, texte, "mousedown", { ctrlKey: true });
  return { e, surLien, dire, zone, lien, suivre };
}
const toutes = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

test("REQ101_AC1_AC9_Ctrl_clic_ouvre_le_fichier_en_hybride_sans_relire_ni_perdre_les_modifications", async () => {
  const { e, zone, suivre } = monterDocument({ "README.md": "# Lisez-moi\n" });
  const vueGuide = zone().vue;
  vueGuide.dispatch({ changes: { from: 0, insert: "X" } });
  suivre("Lire");
  await vi.waitFor(() => expect(nomsOnglets()).toEqual(["guide.md", "README.md"]));
  expect(actifNom()).toBe("README.md");
  const lu = e.code.querySelectorAll(".zone-code")[1];
  expect(lu.vue.state.doc.toString()).toBe("# Lisez-moi\n");
  expect(lu.vue.dom.classList.contains("cm-hybride")).toBe(true);
  expect(document.activeElement).toBe(lu.vue.contentDOM);
  expect(vueGuide.state.doc.toString().startsWith("X")).toBe(true);
  // Déjà ouvert : activé, sans relecture et sans second onglet.
  fetch.mockClear();
  onglet("guide.md").click();
  zone().vue.focus();
  suivre("Lire", e.code.querySelectorAll(".zone-code")[0]);
  await toutes();
  expect(fetch).not.toHaveBeenCalled();
  expect(nomsOnglets()).toEqual(["guide.md", "README.md"]);
  expect(actifNom()).toBe("README.md");
});

test("REQ101_AC3_AC9_ligne_du_lien_puis_onglet_deja_ouvert_garde_ses_modifications", async () => {
  const { e, zone, suivre } = monterDocument({ "src/main.rs": "a\nb\nc\nd\n" });
  suivre("l. 3");
  await vi.waitFor(() => expect(actifNom()).toBe("main.rs"));
  const rs = e.code.querySelectorAll(".zone-code")[1].vue;
  expect(rs.state.doc.lineAt(rs.state.selection.main.head).number).toBe(3);
  expect(document.activeElement).toBe(rs.contentDOM);
  rs.dispatch({ changes: { from: 0, insert: "Z" } });
  onglet("guide.md").click();
  fetch.mockClear();
  zone().vue.dispatch({ selection: { anchor: 0 } });
  suivre("l. 3");
  await toutes();
  expect(fetch).not.toHaveBeenCalled();
  expect(nomsOnglets()).toEqual(["guide.md", "main.rs"]);
  expect(actifNom()).toBe("main.rs");
  expect(rs.state.doc.toString().startsWith("Z")).toBe(true);
});

test("REQ101_AC3_chemin_absolu_et_file_menent_au_meme_fichier", async () => {
  const { suivre } = monterDocument(
    { "src/main.rs": "a\nb\n" },
    `[x](${PROJET}/src/main.rs)\n\n[y](file://${PROJET}/src/main.rs)\n\nfin\n`,
  );
  suivre("x");
  await vi.waitFor(() => expect(actifNom()).toBe("main.rs"));
  onglet("guide.md").click();
  suivre("y");
  await toutes();
  expect(nomsOnglets()).toEqual(["guide.md", "main.rs"]);
});

test("REQ101_AC6_AC9_refus_avec_le_chemin_ecrit_un_seul_message_focus_dans_l_editeur", async () => {
  const { dire, zone, suivre } = monterDocument({});
  suivre("absent");
  await vi.waitFor(() => expect(dire).toHaveBeenCalledTimes(1));
  expect(dire).toHaveBeenLastCalledWith({ texte: "absent.md n'existe pas.", variante: "alerte", fermable: true });
  expect(nomsOnglets()).toEqual(["guide.md"]);
  expect(document.activeElement).toBe(zone().vue.contentDOM);
});

test("REQ101_AC6_dossier_hors_projet_binaire_et_coupure_disent_leur_texte", async () => {
  const contenu = "[a](../web)\n\n[b](../../autre/x.md)\n\n[c](../img/outil.dat)\n\n[d](../rien.md)\n\nfin\n";
  const { dire, zone, suivre } = monterDocument(
    { web: { cause: "invalide", message: "C'est un dossier." }, "../autre/x.md": { cause: "interdit", message: "Ce chemin sort du projet." }, "img/outil.dat": { cause: "binaire", message: "Binaire." }, "rien.md": "coupure" },
    contenu,
  );
  const attendus = [
    ["a", "../web est un dossier. Yaide ne l'ouvre pas."],
    ["b", "../../autre/x.md est hors du projet et de ses worktrees. Yaide ne l'ouvre pas."],
    ["c", "../img/outil.dat est un fichier binaire. Yaide ne l'ouvre pas."],
    ["d", "Connexion perdue. Réessayez au retour."],
  ];
  for (const [lien, texte] of attendus) {
    suivre(lien);
    await vi.waitFor(() => expect(dire).toHaveBeenLastCalledWith({ texte, variante: "alerte", fermable: true }));
    expect(document.activeElement).toBe(zone().vue.contentDOM);
  }
  expect(nomsOnglets()).toEqual(["guide.md"]);
});

test("REQ101_AC7_document_d_un_worktree_ouvre_le_fichier_du_worktree", async () => {
  fauxFichiers({ "../essai/README.md": "essai\n" });
  const e = vueEditeur({ dire: vi.fn(), chemin: PROJET });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  e.ouvrir({ chemin: "../essai/docs/guide.md", contenu: "[Lire](../README.md)\n\nfin\n", version: "1" });
  const z = e.code.querySelector(".zone-code");
  ensureSyntaxTree(z.vue.state, z.vue.state.doc.length, 5000);
  z.vue.posAtCoords = () => 3;
  z.vue.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
  await vi.waitFor(() => expect(onglet("README.md")).toBeTruthy());
  expect(onglet("README.md").title || onglet("README.md").querySelector("[title]")?.title).toBe("../essai/README.md");
  expect(e.code.querySelectorAll(".zone-code")[1].vue.state.doc.toString()).toBe("essai\n");
});

test("REQ101_AC4_ancre_d_un_autre_fichier_va_a_la_ligne_du_titre_ou_a_la_ligne_1", async () => {
  const { e, suivre } = monterDocument({ "docs/autre.md": "# A\n\ntexte\n\n## Lancer les tests !\nfin\n" });
  suivre("ancre");
  await vi.waitFor(() => expect(actifNom()).toBe("autre.md"));
  const v = e.code.querySelectorAll(".zone-code")[1].vue;
  expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(5);
  expect(document.activeElement).toBe(v.contentDOM);
  // Titre absent : le fichier s'ouvre en haut.
  const { e: e2, suivre: suivre2 } = monterDocument({ "docs/autre.md": "# A\n\ntexte\n" });
  suivre2("ancre");
  await vi.waitFor(() => expect(e2.code.querySelectorAll(".zone-code").length).toBe(2));
  const v2 = e2.code.querySelectorAll(".zone-code")[1].vue;
  expect(v2.state.doc.lineAt(v2.state.selection.main.head).number).toBe(1);
});

test("REQ101_AC11_survol_d_un_lien_de_l_onglet_actif_dit_le_geste_puis_se_retire", async () => {
  const { e, surLien, zone, lien } = monterDocument({ "README.md": "x" });
  lien("Lire", "mousemove", { ctrlKey: true });
  expect(surLien).toHaveBeenLastCalledWith({ geste: "Ctrl+clic", suite: "pour ouvrir ../README.md" });
  zone().vue.dom.dispatchEvent(new MouseEvent("mouseleave"));
  expect(surLien).toHaveBeenLastCalledWith(null);
  // Changer d'onglet retire l'indication.
  lien("Lire");
  expect(surLien).toHaveBeenLastCalledWith({ geste: "Ctrl+clic", suite: "pour ouvrir ../README.md" });
  e.ouvrir({ chemin: "autre.txt", contenu: "x", version: "1" });
  expect(surLien).toHaveBeenLastCalledWith(null);
  // Un onglet masqué ne dit rien, et le quitter retire l'indication.
  onglet("guide.md").click();
  lien("Lire");
  const appels = surLien.mock.calls.length;
  onglet("autre.txt").click();
  await toutes();
  expect(surLien.mock.calls.length).toBe(appels + 1);
  expect(surLien).toHaveBeenLastCalledWith(null);
  lien("Lire");
  expect(surLien.mock.calls.length).toBe(appels + 1);
});

test("REQ101_AC1_le_lien_se_resout_depuis_le_chemin_renomme_du_document", async () => {
  const { e, suivre } = monterDocument({ "lib/README.md": "x\n" }, "[Lire](../README.md)\n\nfin\n");
  e.renomme({ de: "docs", vers: "lib/docs" });
  suivre("Lire");
  await vi.waitFor(() => expect(actifNom()).toBe("README.md"));
  expect(onglet("README.md").title || onglet("README.md").querySelector("[title]")?.title).toBe("lib/README.md");
});

function monterApercu(fichiers, contenu) {
  fauxFichiers(fichiers);
  const dire = vi.fn(() => ({ remove: vi.fn() }));
  const e = vueEditeur({ dire, chemin: PROJET });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  e.ouvrir({ chemin: "docs/guide.md", contenu, version: "1" });
  const z = e.code.querySelector(".zone-code");
  z.definirApercu(true);
  const a = (adresse) => z.querySelector(`a[data-lien="${adresse}"]`);
  return { e, z, dire, a };
}

test("REQ101_AC1_AC9_clic_dans_l_apercu_ouvre_README_en_hybride_focus_dans_l_editeur_modifications_gardees", async () => {
  const { e, z, a } = monterApercu({ "README.md": "# R\n" }, "[Lire](../README.md)\n");
  z.vue.dispatch({ changes: { from: 0, insert: "X" } });
  a("../README.md").click();
  await vi.waitFor(() => expect(actifNom()).toBe("README.md"));
  const lu = e.code.querySelectorAll(".zone-code")[1];
  expect(lu.vue.dom.classList.contains("cm-hybride")).toBe(true);
  expect(document.activeElement).toBe(lu.vue.contentDOM);
  expect(z.vue.state.doc.toString().startsWith("X")).toBe(true);
});

test("REQ101_AC6_refus_depuis_l_apercu_un_seul_message_focus_sur_le_lien", async () => {
  const { dire, a } = monterApercu({}, "[x](absent.md)\n");
  const lien = a("absent.md");
  lien.focus();
  lien.click();
  await vi.waitFor(() => expect(dire).toHaveBeenCalledTimes(1));
  expect(dire).toHaveBeenCalledWith({ texte: "absent.md n'existe pas.", variante: "alerte", fermable: true });
  expect(document.activeElement).toBe(lien);
});

test("REQ101_AC6_lien_detache_pendant_la_lecture_le_focus_va_dans_l_editeur_du_document", async () => {
  const { z, dire, a } = monterApercu({}, "[x](absent.md)\n");
  const lien = a("absent.md");
  lien.click();
  z.definirApercu(true);
  z.vue.dispatch({ changes: { from: 0, insert: "" } });
  lien.remove();
  await vi.waitFor(() => expect(dire).toHaveBeenCalledTimes(1));
  expect(document.activeElement).toBe(z.vue.contentDOM);
});

test("REQ101_AC9_sans_ligne_ni_titre_trouve_on_va_a_la_ligne_1_meme_onglet_deja_ouvert", async () => {
  const { e, suivre } = monterDocument({ "docs/autre.md": "a\nb\nc\n" }, "[ancre](autre.md#absent)\n\n[plain](autre.md)\n\nfin\n");
  suivre("plain");
  await vi.waitFor(() => expect(actifNom()).toBe("autre.md"));
  const v = e.code.querySelectorAll(".zone-code")[1].vue;
  v.dispatch({ selection: { anchor: v.state.doc.line(3).from } });
  onglet("guide.md").click();
  suivre("ancre");
  await vi.waitFor(() => expect(actifNom()).toBe("autre.md"));
  expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(1);
  v.dispatch({ selection: { anchor: v.state.doc.line(3).from } });
  onglet("guide.md").click();
  suivre("plain");
  await vi.waitFor(() => expect(actifNom()).toBe("autre.md"));
  expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(1);
});

test("REQ106_AC3_ouvrirCitee_ouvre_a_la_ligne_apres_avantOuverture_ou_rend_le_refus_sans_rien_ouvrir", async () => {
  const { e } = monterAg({ chemin: PROJET });
  fauxFichiers({ "docs/a.md": "l1\nl2\nl3\nl4\n" });
  const avant = vi.fn();
  expect(await e.ouvrirCitee({ chemin: "docs/ancien.md", ligne: 2 }, avant)).toBe("docs/ancien.md n'existe pas.");
  expect(avant).not.toHaveBeenCalled();
  expect(nomsOnglets()).toEqual([]);
  expect(await e.ouvrirCitee({ chemin: "docs/a.md", ligne: 3 }, avant)).toBeUndefined();
  expect(avant).toHaveBeenCalledTimes(1);
  expect(actifNom()).toBe("a.md");
  const vue = e.code.querySelector(".zone-code").vue;
  expect(vue.state.selection.main.head).toBe(vue.state.doc.line(3).from);
});

function languageDe(zone) {
  return zone.vue.state.facet(language)?.name ?? null;
}

// ---- T-250 : preuve descendue de editeur.spec.js ----

test("REQ012_AC2_le_html_du_markdown_ne_s_execute_pas", () => {
  const { z } = monterApercu({}, '<script>window.piege=1</script>\n<img src=x onerror="window.piege=2">\n');
  const apercu = z.querySelector("[aria-label=Aperçu]");
  expect(apercu).not.toBeNull();
  expect(apercu.textContent).toContain("<script>");
  expect(apercu.querySelectorAll("script, img").length).toBe(0);
  expect(window.piege).toBeUndefined();
});

// ---- REQ-118 : formater le document ----

function monterFormatage(dire = vi.fn()) {
  const e = vueEditeur({ dire });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  return e;
}
const texteActif = () => e_actif().vue.state.doc.toString();
const JSON_UNE_LIGNE = '{"b":1,"a":[1,2,{}],"c":{"d":null},"e":[]}';
const JSON_FORMATE = '{\n  "b": 1,\n  "a": [\n    1,\n    2,\n    {}\n  ],\n  "c": {\n    "d": null\n  },\n  "e": []\n}\n';

test("REQ118_AC1_AC5_AC7_formate_en_une_modification_curseur_au_debut_et_focus_dans_l_editeur", () => {
  const e = monterFormatage();
  e.ouvrir({ chemin: "a.json", contenu: JSON_UNE_LIGNE, version: "1" });
  expect(e.peutFormater()).toBe(true);
  e_actif().vue.dispatch({ selection: { anchor: 5 } });
  document.body.focus();
  e.formater();
  expect(texteActif()).toBe(JSON_FORMATE);
  expect(onglet("a.json").closest("[role=tab]").dataset.modifie).toBe("true");
  expect(e_actif().vue.state.selection.main.head).toBe(0);
  expect(document.activeElement).toBe(e_actif().vue.contentDOM);
  // Ctrl+Z défait tout d'un coup.
  undo(e_actif().vue);
  expect(texteActif()).toBe(JSON_UNE_LIGNE);
});

test("REQ118_AC7_texte_deja_formate_ne_change_rien_et_l_onglet_reste_propre", () => {
  const e = monterFormatage();
  e.ouvrir({ chemin: "a.json", contenu: JSON_FORMATE, version: "1" });
  e.formater();
  expect(texteActif()).toBe(JSON_FORMATE);
  expect(onglet("a.json").closest("[role=tab]").dataset.modifie).toBeUndefined();
});

test("REQ118_AC4_svg_est_proposable_et_se_formate", () => {
  const e = monterFormatage();
  e.ouvrir({ chemin: "icone.svg", contenu: '<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="1"/></g></svg>', version: "1" });
  expect(e.peutFormater()).toBe(true);
  e.formater();
  expect(texteActif()).toBe('<svg xmlns="http://www.w3.org/2000/svg">\n  <g>\n    <rect width="1"/>\n  </g>\n</svg>\n');
});

test("REQ118_AC6_le_formatage_porte_sur_le_texte_affiche_non_enregistre", () => {
  const e = monterFormatage();
  e.ouvrir({ chemin: "a.json", contenu: '{"a":1}', version: "1" });
  const vue = e_actif().vue;
  vue.dispatch({ changes: { from: 6, insert: ',"z":2' } });
  e.formater();
  expect(texteActif()).toBe('{\n  "a": 1,\n  "z": 2\n}\n');
});

test("REQ118_AC8_AC12_refus_dit_le_message_garde_texte_et_point_puis_le_bandeau_part_au_succes", () => {
  const bandeaux = [];
  const dire = vi.fn((o) => {
    const m = document.createElement("div");
    m.textContent = o.texte;
    bandeaux.push(m);
    document.body.append(m);
    return m;
  });
  const e = monterFormatage(dire);
  e.ouvrir({ chemin: "a.json", contenu: '{"a":1,}', version: "1" });
  e_actif().vue.dispatch({ selection: { anchor: 4 } });
  e.formater();
  expect(texteActif()).toBe('{"a":1,}');
  expect(e_actif().vue.state.selection.main.head).toBe(4);
  expect(onglet("a.json").closest("[role=tab]").dataset.modifie).toBeUndefined();
  expect(dire).toHaveBeenLastCalledWith({ texte: "Formatage impossible : ce JSON n'est pas valide.", variante: "alerte", fermable: true });
  expect(document.activeElement).toBe(e_actif().vue.contentDOM);
  e.formater(); // un nouveau refus remplace le bandeau
  expect(bandeaux.filter((b) => b.isConnected)).toHaveLength(1);
  e_actif().vue.dispatch({ changes: { from: 0, to: 8, insert: '{"a":1}' } });
  e.formater();
  expect(bandeaux.filter((b) => b.isConnected)).toHaveLength(0);
  e.ouvrir({ chemin: "a.xml", contenu: "<a><b></a>", version: "1" });
  e.formater();
  expect(dire).toHaveBeenLastCalledWith({ texte: "Formatage impossible : ce XML n'est pas valide.", variante: "alerte", fermable: true });
});

test("REQ118_AC9_pas_de_formatage_pour_markdown_rust_diff_ni_sans_onglet", () => {
  const e = monterFormatage();
  expect(e.peutFormater()).toBe(false);
  e.ouvrir({ chemin: "notes.md", contenu: "# t", version: "1" });
  expect(e.peutFormater()).toBe(false);
  e.ouvrir({ chemin: "main.rs", contenu: "fn main() {}", version: "1" });
  expect(e.peutFormater()).toBe(false);
  e.ouvrir({ chemin: "a.json", contenu: "{}", version: "1" });
  expect(e.peutFormater()).toBe(true);
  e.ouvrirDiff({ chemin: "a.json", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  expect(e.peutFormater()).toBe(false);
  e.ouvrirClaude({ id: "c" });
  expect(e.peutFormater()).toBe(false);
  e.ouvrirOpencode({ sessionId: "o", titre: "t" });
  expect(e.peutFormater()).toBe(false);
});

test("REQ177_AC6_pas_d_export_sans_onglet_texte_ni_pour_diff_claude_opencode_agent", () => {
  const e = monterFormatage();
  expect(e.peutExporter()).toBe(false);
  e.ouvrir({ chemin: "notes.md", contenu: "# t", version: "1" });
  expect(e.peutExporter()).toBe(true);
  e.ouvrir({ chemin: "main.rs", contenu: "fn main() {}", version: "1" });
  expect(e.peutExporter()).toBe(true);
  e.ouvrirDiff({ chemin: "a.json", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  expect(e.peutExporter()).toBe(false);
  e.ouvrirClaude({ id: "c" });
  expect(e.peutExporter()).toBe(false);
  e.ouvrirOpencode({ sessionId: "o", titre: "t" });
  expect(e.peutExporter()).toBe(false);
  e.ouvrirAgent({ equipe: "eq", message: "m" });
  expect(e.peutExporter()).toBe(false);
});

// ---- Onglet d'image (REQ-120) ----

const sondesImg = [];
function fauxImages(fichiers = {}) {
  sondesImg.length = 0;
  vi.stubGlobal("Image", class {
    constructor() {
      sondesImg.push(this);
    }
  });
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u === "/api/apercu") return { ok: true, status: 200, json: async () => ({ jeton: "jt" }) };
    const chemin = decodeURIComponent(new URL(u, "http://x").searchParams.get("chemin") ?? "");
    return { ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => fichiers[chemin] ?? "x" };
  }));
}
const zoneImage = () => document.querySelector(".ya-image:not([hidden])");
const NEUF = ["img/logo.png", "photo.jpg", "photo.jpeg", "anim.gif", "image.webp", "image.avif", "image.bmp", "favicon.ico", "PHOTO.JPG"];

test("REQ120_AC1_AC3_AC10_AC11_image_ouverte_sans_lecture_zone_C017_fil_et_barre_d_etat", async () => {
  fauxImages();
  const { e, surActif } = monter();
  for (const [i, chemin] of NEUF.entries()) {
    await e.ouvrir({ chemin });
    if (i === 0) {
      sondesImg.at(-1).onload();
      expect(zoneImage().querySelector("img").getAttribute("src")).toMatch(/^\/apercu\/[^/]+\/img\/logo\.png$/);
      expect(document.activeElement).toBe(zoneImage());
      expect(zoneImage().querySelector("img").alt).toBe("logo.png");
    }
    const z = zoneImage();
    expect(z, chemin).not.toBeNull();
    expect(z.getAttribute("role")).toBe("region");
    expect(z.getAttribute("aria-label")).toBe(chemin.split("/").pop());
    expect(z.getAttribute("tabindex")).toBe("-1");
    expect(actifNom()).toBe(chemin.split("/").pop());
    expect(e.code.querySelector(".zone-code")).toBeNull();
    expect(document.querySelector("[role=alert]")).toBeNull();
    expect(document.querySelector(".ya-message")).toBeNull();
  }
  expect(fetch.mock.calls.every(([u]) => String(u) === "/api/apercu")).toBe(true); // aucune lecture du fichier
  await e.ouvrir({ chemin: "img/logo.png" });
  expect(e.fil.textContent).toBe("imglogo.png");
  expect(e.fil.querySelectorAll("svg[data-icone=chevron]").length).toBe(1);
  expect(dernier(surActif)).toEqual({ position: undefined, langage: undefined });
  expect(document.querySelector(".onglets-droite")).toBeNull();
  expect(onglet("logo.png").dataset.modifie).toBeUndefined();
});

test("REQ120_AC2_AC11_deja_ouvert_pas_de_doublon_et_entree_sur_l_onglet_donne_le_focus_a_la_zone", async () => {
  fauxImages();
  const { e } = monter();
  await e.ouvrir({ chemin: "img/logo.png" });
  e.ouvrir({ chemin: "a.txt", contenu: "x", version: "1" });
  expect(zoneImage()).toBeNull();
  await e.ouvrir({ chemin: "img/logo.png" });
  expect(nomsOnglets()).toEqual(["logo.png", "a.txt"]);
  expect(actifNom()).toBe("logo.png");
  expect(document.querySelectorAll(".ya-image")).toHaveLength(1);
  onglet("a.txt").click();
  await Promise.resolve();
  onglet("logo.png").focus();
  onglet("logo.png").click(); // Entrée sur un bouton de onglet = clic
  await Promise.resolve();
  expect(document.activeElement).toBe(zoneImage());
  expect(zoneImage().matches("[tabindex='-1']")).toBe(true);
});

test("REQ120_AC5_ctrl_s_n_ecrit_rien_et_pas_de_formatage", async () => {
  fauxImages();
  const { e } = monter();
  await e.ouvrir({ chemin: "logo.png" });
  fetch.mockClear();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  expect(fetch).not.toHaveBeenCalled();
  expect(e.peutFormater()).toBe(false);
  expect(e.peutExporter()).toBe(false);
  expect(document.querySelector('button[aria-label="Aperçu"], button[aria-label="Mode hybride"]')).toBeNull();
});

test("REQ120_AC7_AC13_image_illisible_dit_ne_peut_pas_etre_affiche_sans_bandeau", async () => {
  fauxImages();
  const dire = vi.fn();
  const e = vueEditeur({ dire });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  await e.ouvrir({ chemin: "casse.png" });
  sondesImg.at(-1).onerror();
  const m = zoneImage().querySelector("[role=status]");
  expect(m.textContent).toBe("casse.png ne peut pas être affiché.");
  expect(zoneImage().querySelector("img")).toBeNull();
  expect(dire).not.toHaveBeenCalled();
});

test("REQ087_AC12_REQ101_AC16_ouvrirCitee_et_lien_de_document_ouvrent_l_onglet_d_image_sans_lecture", async () => {
  fauxImages();
  const { e } = monter();
  expect(await e.ouvrirCitee({ chemin: "img/logo.png", ligne: 3 })).toBeUndefined();
  expect(actifNom()).toBe("logo.png");
  expect(zoneImage()).not.toBeNull();
  expect(fetch.mock.calls.every(([u]) => String(u) === "/api/apercu")).toBe(true);
  await e.ouvrirCitee({ chemin: "img/logo.png" });
  expect(nomsOnglets()).toEqual(["logo.png"]);
});

test("REQ087_AC12_lien_de_conversation_vers_une_image", async () => {
  fauxImages();
  const { e } = monterAg({ chemin: PROJET });
  e.ouvrirAgent();
  await faux.ag[0].ouvrirReference({ chemin: "img/logo.png", ligne: 3 }, lienFichier());
  expect(actifNom()).toBe("logo.png");
  expect(zoneImage()).not.toBeNull();
  await faux.ag[0].ouvrirReference({ chemin: "img/logo.png" }, lienFichier());
  expect(nomsOnglets().filter((n) => n === "logo.png")).toHaveLength(1);
  expect(e).toBeDefined();
});

test("REQ101_AC16_clic_dans_l_apercu_et_Ctrl_clic_en_hybride_ouvrent_l_onglet_d_image_sans_lecture", async () => {
  for (const adresse of ["../img/logo.png", "../img/logo.png#haut"]) {
    vi.stubGlobal("Image", class {});
    const { e, z, a } = monterApercu({}, `[logo](${adresse})\n`);
    fetch.mockClear();
    a(adresse).click();
    await vi.waitFor(() => expect(actifNom()).toBe("logo.png"));
    expect(zoneImage()).not.toBeNull();
    expect(e.code.querySelectorAll(".zone-code")).toHaveLength(1);
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith("/api/fichier"))).toBe(false);
    expect(z.vue).toBeDefined();
    editeurs.pop().detruire();
    document.body.replaceChildren();
  }
  vi.stubGlobal("Image", class {});
  const { e, suivre } = monterDocument({}, "[logo](../img/logo.png#haut)\n");
  fetch.mockClear();
  suivre("logo");
  await vi.waitFor(() => expect(actifNom()).toBe("logo.png"));
  expect(zoneImage()).not.toBeNull();
  expect(fetch.mock.calls.some(([u]) => String(u).startsWith("/api/fichier"))).toBe(false);
  expect(nomsOnglets()).toEqual(["guide.md", "logo.png"]);
  expect(e).toBeDefined();
});

// Réponses de la route des versions pour les tests d'image : `versions.v` change d'un appel à l'autre.
function fauxVersions(versions) {
  const base = fetch.getMockImplementation();
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url) === "/api/fichiers/versions") return { ok: true, status: 200, json: async () => ({ ...versions.v }) };
    return base(url, init);
  }));
}
const srcImage = () => zoneImage().querySelector("img")?.getAttribute("src");

test("REQ120_AC6_AC13_AC14_version_changee_nouvelle_source_supprime_puis_recree", async () => {
  fauxImages();
  const versions = { v: { "img/logo.png": "1" } };
  fauxVersions(versions);
  const { e } = monter();
  e.lecture(false);
  await e.restaurer();
  await e.ouvrir({ chemin: "img/logo.png" });
  sondesImg.at(-1).onload();
  const avant = srcImage();
  await e.relireDisque(); // première version vue : rien ne change
  const n = sondesImg.length;
  expect(n).toBe(1);
  versions.v = { "img/logo.png": "2" };
  await e.relireDisque();
  expect(sondesImg).toHaveLength(2);
  expect(sondesImg.at(-1).src).toBe(`${avant}?v=2`); // adresse propre à la version : le navigateur ne ressert pas l'ancienne image de sa mémoire
  // AC-14 : l'ancienne image reste jusqu'au load, jamais « Chargement… »
  expect(zoneImage().querySelector("img")).not.toBeNull();
  expect(zoneImage().querySelector(".indication")).toBeNull();
  sondesImg.at(-1).onload();
  // supprimée hors de Yaide
  versions.v = { "img/logo.png": null };
  await e.relireDisque();
  expect(zoneImage()).not.toBeNull();
  expect(zoneImage().querySelector("img")).toBeNull();
  const m = e.question.querySelector("[role=alert]");
  expect(m.textContent).toBe("Fichier supprimé du disque.");
  expect(e.question.textContent).not.toContain("Ctrl+S le recrée.");
  expect(m.querySelector("button")).toBeNull();
  expect(onglet("logo.png").dataset.modifie).toBeUndefined();
  // recréée : l'image revient, le message part
  versions.v = { "img/logo.png": "3" };
  await e.relireDisque();
  sondesImg.at(-1).onload();
  expect(zoneImage().querySelector("img")).not.toBeNull();
  expect(e.question.querySelector("[role=alert]")).toBeNull();
});

test("REQ120_AC8_retour_recree_l_onglet_sans_lecture_puis_le_renommage_suit", async () => {
  fauxImages();
  gardes([fichierGarde("img/logo.png"), fichierGarde("src/main.rs")], "img/logo.png");
  const { e } = monter();
  e.lecture(true);
  await e.restaurer();
  expect(nomsOnglets()).toEqual(["logo.png", "main.rs"]);
  expect(actifNom()).toBe("logo.png");
  expect(fetch.mock.calls.some(([u]) => String(u).includes("img%2Flogo.png"))).toBe(false); // jamais lue comme texte
  sondesImg.at(-1).onload();
  expect(zoneImage().querySelector("img")).not.toBeNull();
  e.renomme({ de: "img/logo.png", vers: "img/marque.png" });
  await vi.waitFor(() => expect(sondesImg.at(-1).src).toMatch(/\/img\/marque\.png$/));
  sondesImg.at(-1).onload();
  expect(actifNom()).toBe("marque.png");
  expect(zoneImage().getAttribute("aria-label")).toBe("marque.png");
  expect(zoneImage().querySelector("img").alt).toBe("marque.png");
  expect(srcImage()).toMatch(/\/img\/marque\.png$/);
  expect(e.fil.textContent).toBe("imgmarque.png");
});

test("REQ120_AC15_ouverture_pendant_une_coupure_zone_vide_puis_image_au_retour", async () => {
  fauxImages();
  const base = fetch.getMockImplementation();
  vi.stubGlobal("fetch", vi.fn(async (url, init) => (String(url) === "/api/apercu" ? { ok: false, status: 503 } : base(url, init))));
  const { e } = monter();
  e.lecture(false);
  e.definirEtat("connecte"); // vide le jeton gardé par un test précédent
  e.definirEtat("coupe");
  await e.ouvrir({ chemin: "img/logo.png" });
  expect(nomsOnglets()).toEqual(["logo.png"]);
  expect(zoneImage()).not.toBeNull();
  sondesImg.at(-1)?.onerror?.();
  expect(zoneImage().textContent).toBe("");
  expect(document.querySelector("[role=status]")).toBeNull();
  vi.stubGlobal("fetch", vi.fn(base));
  const avantRetour = sondesImg.length;
  e.definirEtat("connecte");
  await vi.waitFor(() => expect(sondesImg.at(-1).src).toMatch(/^\/apercu\/jt\/img\/logo\.png$/));
  for (const sonde of sondesImg.slice(avantRetour - 1, -1)) sonde.onerror?.(); // l'ancienne adresse vide échoue : sans effet
  expect(zoneImage().textContent).not.toContain("ne peut pas être affiché");
  sondesImg.at(-1).onload();
  expect(zoneImage().querySelector("img")).not.toBeNull();
});

// ---- Aperçu SVG (REQ-121) ----
test("REQ121_AC1_AC7_AC8_svg_ouvert_avec_apercu_seul_bouton_focus_editeur_barre_d_etat", () => {
  const { e, surActif } = monter();
  e.ouvrir({ chemin: "logo.svg", contenu: '<svg xmlns="http://www.w3.org/2000/svg"/>', version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  const ap = document.querySelector('.ya-image[aria-label="Aperçu"]');
  expect(ap).not.toBeNull();
  expect(ap.hasAttribute("tabindex")).toBe(false);
  expect(ap.querySelector("[tabindex],button,a,input")).toBeNull();
  expect(document.querySelector('button[aria-label="Mode hybride"]')).toBeNull();
  expect(document.activeElement).toBe(e.code.querySelector(".cm-content"));
  expect(dernier(surActif)).toEqual({ position: "Ln 1, Col 1", langage: "XML" });
});

test("REQ121_AC5_masquer_propre_a_l_onglet_et_retour_a_l_ouverture", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "logo.svg", contenu: "<svg/>", version: "1" });
  boutonApercu().click();
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  expect(document.querySelector(".ya-image")).toBeNull();
  e.ouvrir({ chemin: "b.svg", contenu: "<svg/>", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  croix("logo.svg").click();
  e.ouvrir({ chemin: "logo.svg", contenu: "<svg/>", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
});

test("REQ121_AC5_apercu_masque_garde_au_rechargement", async () => {
  vi.resetModules();
  const gardee = [{ chemin: "logo.svg", apercu: false }];
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder: vi.fn(), retrouver: async () => ({ liste: gardee, actif: "logo.svg", disposition: { arbre: { id: "g1", actif: "logo.svg" }, courant: "g1" } }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => "<svg/>" })));
  try {
  const { vueEditeur: neuf } = await import("./editeur.js");
  const e = neuf({ dire: vi.fn() });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  await e.restaurer();
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  expect(document.querySelector(".ya-image")).toBeNull();
  } finally {
    vi.doUnmock("../onglets-fichiers.js");
    vi.resetModules();
  }
});

test("REQ083_AC3_rust_reste_sans_apercu_a_l_ouverture", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "main.rs", contenu: "fn main() {}", version: "1" });
  expect(boutonApercu()).toBeNull();
  expect(document.querySelector(".ya-image, iframe")).toBeNull();
});

test("REQ121_AC2_AC3_frappe_point_de_modification_sans_ecriture_et_dessin_retabli", () => {
  const origine = globalThis.Image;
  const sondes = [];
  globalThis.Image = class {
    constructor() {
      sondes.push(this);
    }
  };
  const fetchEspion = vi.fn();
  vi.stubGlobal("fetch", fetchEspion);
  try {
    const donnees = (t) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(t)}`;
    const rouge = '<svg xmlns="http://www.w3.org/2000/svg"><circle fill="red" r="5"/></svg>';
    const { e } = monter();
    e.ouvrir({ chemin: "logo.svg", contenu: rouge, version: "1" });
    sondes[0].onload();
    const vue = e.code.querySelector(".zone-code").vue;
    const i = rouge.indexOf("red");
    vue.dispatch({ changes: { from: i, to: i + 3, insert: "blue" } });
    const bleu = rouge.replace("red", "blue");
    sondes.at(-1).onload();
    expect(document.querySelector(".ya-image img").getAttribute("src")).toBe(donnees(bleu));
    expect(document.querySelector('[role=tab][aria-label^="logo.svg"]').dataset.modifie).toBe("true");
    expect(fetchEspion).not.toHaveBeenCalled();
    const fin = vue.state.doc.length;
    vue.dispatch({ changes: { from: fin - 6, to: fin } });
    sondes.at(-1).onerror();
    expect(document.querySelector(".ya-image img").getAttribute("src")).toBe(donnees(bleu));
    vue.dispatch({ changes: { from: vue.state.doc.length, insert: "</svg>" } });
    sondes.at(-1).onload();
    expect(document.querySelector(".ya-image img").getAttribute("src")).toBe(donnees(bleu));
    expect(fetchEspion).not.toHaveBeenCalled();
  } finally {
    globalThis.Image = origine;
  }
});

// ---- Aperçu mermaid (REQ-123) ----
test("REQ123_AC1_AC7_mmd_ouvert_avec_apercu_seul_bouton_focus_editeur_barre_d_etat", () => {
  const { e, surActif } = monter();
  e.ouvrir({ chemin: "FLUX.MMD", contenu: "graph TD; A-->B", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  const ap = document.querySelector('.ya-image[aria-label="Aperçu"]');
  expect(ap).not.toBeNull();
  expect(ap.hasAttribute("tabindex")).toBe(false);
  expect(ap.querySelector("[tabindex],button,a,input")).toBeNull();
  expect(document.querySelector('button[aria-label="Mode hybride"]')).toBeNull();
  expect(document.activeElement).toBe(e.code.querySelector(".cm-content"));
  expect(dernier(surActif)).toEqual({ position: "Ln 1, Col 1", langage: "Texte" });
});

test("REQ123_AC1_AC6_083_AC3_seuls_les_mmd_s_ouvrent_avec_apercu", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "notes.txt", contenu: "x", version: "1" });
  e.ouvrir({ chemin: "main.rs", contenu: "fn main() {}", version: "1" });
  e.ouvrir({ chemin: "style.css", contenu: "a {}", version: "1" });
  expect(boutonApercu()).toBeNull();
  expect(document.querySelector(".ya-image")).toBeNull();
});

test("REQ123_AC2_frappe_dans_un_mmd_point_de_modification_sans_ecriture", () => {
  const fetchEspion = vi.fn();
  vi.stubGlobal("fetch", fetchEspion);
  const { e } = monter();
  e.ouvrir({ chemin: "flux.mmd", contenu: "graph TD; A-->B", version: "1" });
  e.code.querySelector(".zone-code").vue.dispatch({ changes: { from: 0, insert: " " } });
  expect(document.querySelector('[role=tab][aria-label^="flux.mmd"]').dataset.modifie).toBe("true");
  expect(fetchEspion).not.toHaveBeenCalled();
});

test("REQ123_AC5_masquer_propre_a_l_onglet_et_retour_a_l_ouverture", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "flux.mmd", contenu: "graph TD; A-->B", version: "1" });
  boutonApercu().click();
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
  expect(document.querySelector(".ya-image")).toBeNull();
  e.ouvrir({ chemin: "b.mmd", contenu: "graph TD; A-->B", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  croix("flux.mmd").click();
  e.ouvrir({ chemin: "flux.mmd", contenu: "graph TD; A-->B", version: "1" });
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
});

test("REQ123_AC5_apercu_masque_garde_au_rechargement", async () => {
  vi.resetModules();
  const gardee = [{ chemin: "flux.mmd", apercu: false }];
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder: vi.fn(), retrouver: async () => ({ liste: gardee, actif: "flux.mmd", disposition: { arbre: { id: "g1", actif: "flux.mmd" }, courant: "g1" } }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => "graph TD; A-->B" })));
  try {
    const { vueEditeur: neuf } = await import("./editeur.js");
    const e = neuf({ dire: vi.fn() });
    editeurs.push(e);
    document.body.append(e.fil, e.barre, e.code);
    await e.restaurer();
    expect(boutonApercu().getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".ya-image")).toBeNull();
  } finally {
    vi.doUnmock("../onglets-fichiers.js");
    vi.resetModules();
  }
});

// ---- REQ-124 : surCtrlS après une sauvegarde qui change le fichier ----
const pointsAuAppel = [];
function monterCtrlS() {
  // AC-124-4 et AC-124-7 : le point de l'onglet a disparu quand surCtrlS est appelé.
  const surCtrlS = vi.fn(() => {
    pointsAuAppel.push(onglet("a.md").dataset.modifie);
  });
  const e = vueEditeur({ dire: vi.fn(), surCtrlS });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  e.ouvrir({ chemin: "docs/a.md", contenu: "abc", version: "1" });
  return { e, surCtrlS };
}
const ctrlS = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));

test("REQ124_AC2_ctrl_s_sans_modification_n_appelle_pas_surCtrlS", async () => {
  const appels = ecritures();
  const { surCtrlS } = monterCtrlS();
  ctrlS();
  await vi.waitFor(() => expect(appels).toEqual(["docs/a.md"]));
  await new Promise((r) => setTimeout(r, 20));
  expect(surCtrlS).not.toHaveBeenCalled();
});

test("REQ124_AC1_ctrl_s_apres_modification_appelle_surCtrlS_une_fois_avec_le_chemin_apres_l_ecriture", async () => {
  const appels = ecritures();
  pointsAuAppel.length = 0;
  const { e, surCtrlS } = monterCtrlS();
  modifier(e, "a.md");
  expect(onglet("a.md").dataset.modifie).toBe("true");
  ctrlS();
  await vi.waitFor(() => expect(surCtrlS).toHaveBeenCalledTimes(1));
  expect(surCtrlS).toHaveBeenCalledWith("docs/a.md");
  expect(appels).toEqual(["docs/a.md"]);
  expect(pointsAuAppel).toEqual([undefined]);
});

test("REQ124_AC2_sauvegarde_en_echec_n_appelle_pas_surCtrlS", async () => {
  const appels = ecritures(true);
  const { e, surCtrlS } = monterCtrlS();
  modifier(e, "a.md");
  ctrlS();
  await vi.waitFor(() => expect(appels).toEqual(["docs/a.md"]));
  await new Promise((r) => setTimeout(r, 20));
  expect(surCtrlS).not.toHaveBeenCalled();
});

test("REQ124_AC2_sauvegarder_du_dialogue_de_fermeture_n_appelle_pas_surCtrlS", async () => {
  const appels = ecritures();
  const { e, surCtrlS } = monterCtrlS();
  modifier(e, "a.md");
  clicDroit(onglet("a.md"));
  choisirCommande("Fermer tous les onglets");
  await vi.waitFor(() => expect(dialogueOuvert()?.textContent).toContain("Sauvegarder a.md ?"));
  clicBouton("Sauvegarder");
  await vi.waitFor(() => expect(onglets().length).toBe(0));
  expect(appels).toEqual(["docs/a.md"]);
  expect(surCtrlS).not.toHaveBeenCalled();
});

test("REQ124_AC5_ctrl_s_pendant_une_coupure_appelle_surCtrlS_une_fois_au_retour_apres_l_ecriture", async () => {
  const appels = ecritures();
  const { e, surCtrlS } = monterCtrlS();
  modifier(e, "a.md");
  e.definirEtat("coupe");
  ctrlS();
  await new Promise((r) => setTimeout(r, 20));
  expect(appels).toEqual([]);
  expect(surCtrlS).not.toHaveBeenCalled();
  e.definirEtat("connecte");
  await vi.waitFor(() => expect(surCtrlS).toHaveBeenCalledTimes(1));
  expect(appels).toEqual(["docs/a.md"]);
  expect(surCtrlS).toHaveBeenCalledWith("docs/a.md");
});

function menuOuvertHorsEditeur() {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  const commande = document.createElement("button");
  commande.setAttribute("role", "menuitem");
  menu.append(commande);
  document.body.append(menu);
  commande.focus();
  return commande;
}

test("REQ008_AC9_menu_de_l_arborescence_ouvert_pendant_la_lecture_garde_le_focus_onglet_ajoute_et_actif", () => {
  const { e } = monter();
  const commande = menuOuvertHorsEditeur();
  const geste = e.lecture(true);
  e.ouvrir({ chemin: "a.txt", contenu: "a", version: "1", geste });
  expect(nomsOnglets()).toEqual(["a.txt"]);
  expect(actifNom()).toBe("a.txt");
  expect(document.activeElement).toBe(commande);
});

test("REQ008_AC9_avec_un_onglet_actif_avant_le_menu_garde_le_focus", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "README.md", contenu: "r", version: "1" });
  const commande = menuOuvertHorsEditeur();
  const geste = e.lecture(true);
  e.ouvrir({ chemin: "a.txt", contenu: "a", version: "1", geste });
  expect(nomsOnglets()).toEqual(["README.md", "a.txt"]);
  expect(actifNom()).toBe("a.txt");
  expect(document.activeElement).toBe(commande);
});

test("REQ008_AC6_sans_menu_le_focus_va_dans_l_editeur", () => {
  const { e } = monter();
  const geste = e.lecture(true);
  e.ouvrir({ chemin: "a.txt", contenu: "a", version: "1", geste });
  expect(e.code.contains(document.activeElement)).toBe(true);
});

test("REQ083_AC10_mmd_sans_bouton_hybride_et_ouverture_sans_modification", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "flux.mmd", contenu: "graph TD; A-->B", version: "1" });
  expect(boutonHybride()).toBeNull();
  expect(boutonApercu().getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('[role=tab][aria-label^="flux.mmd"]').dataset.modifie).not.toBe("true");
});

test("REQ083_AC9_html_ouvert_texte_inchange_onglet_sans_point", () => {
  const { e } = monter();
  e.ouvrir({ chemin: "index.html", contenu: "<p>x</p>", version: "1" });
  expect(e.code.querySelector(".zone-code").vue.state.doc.toString()).toBe("<p>x</p>");
  expect(document.querySelector('[role=tab][aria-label^="index.html"]').dataset.modifie).not.toBe("true");
  expect(document.activeElement.getAttribute("role")).toBe("tab");
});

test("REQ058_AC11_REQ083_AC6_html_focus_sur_l_onglet_actif_pas_dans_le_cadre_ctrl_p_ouvre_l_ouverture_rapide", async () => {
  const { vueOuverture } = await import("./ouverture.js");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ chemins: ["index.html"] }), headers: new Headers() })));
  const ouv = vueOuverture({ dire: vi.fn() });
  const { e } = monter();
  e.ouvrir({ chemin: "index.html", contenu: "<p>x</p>", version: "1" });
  const onglet = document.querySelector('[role=tab][aria-label^="index.html"]');
  expect(document.activeElement).toBe(onglet);
  expect(onglet.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement.tagName).not.toBe("IFRAME");
  expect(document.querySelector("[role=dialog], dialog[open]")).toBeNull();
  onglet.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true }));
  expect(document.querySelector("[role=dialog], dialog[open]")).not.toBeNull();
  ouv.detruire();
});

// ---- Whiteboard dans un document markdown (REQ-179) ----

test("REQ179_AC1_AC3_AC10_whiteboard_lu_par_la_route_de_l_apercu_balise_en_texte_jusque_la_dessin_ensuite", async () => {
  const creees = [];
  vi.stubGlobal("Image", class {
    constructor() {
      const img = document.createElement("img");
      creees.push(img);
      return img;
    }
  });
  const PLAN = JSON.stringify({ version: 1, boxes: [{ id: "a", x: 0, y: 0, width: 100, height: 60, shape: "rectangle", color: "default", text: "Début" }], links: [], arrows: [] });
  const VIDE = JSON.stringify({ version: 1, boxes: [], links: [], arrows: [] });
  let rendre;
  const attente = new Promise((r) => (rendre = r));
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u === "/api/apercu") return { ok: true, status: 200, json: async () => ({ jeton: "jt" }) };
    if (u === "/api/chemins") return { ok: true, status: 200, json: async () => ({ chemins: ["docs/guide.md", "docs/plan.jdiag", "docs/vide.jdiag"] }) };
    if (u === "/apercu/jt/docs/plan.jdiag") {
      await attente;
      return { ok: true, status: 200, text: async () => PLAN };
    }
    if (u === "/apercu/jt/docs/vide.jdiag") return { ok: true, status: 200, text: async () => VIDE };
    return { ok: false, status: 404, headers: new Headers() };
  }));
  const e = vueEditeur({ dire: vi.fn(), chemin: PROJET });
  editeurs.push(e);
  document.body.append(e.fil, e.barre, e.code);
  e.ouvrir({ chemin: "docs/guide.md", contenu: "![[plan.jdiag]]\n\n![[vide.jdiag]]\n\n![[absent.jdiag]]\n", version: "1" });
  const z = e.code.querySelector(".zone-code");
  z.definirApercu(true);
  const apercu = () => z.querySelector(".zone-code-apercu");
  await vi.waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u) === "/apercu/jt/docs/vide.jdiag")).toBe(true));
  await toutes();
  // Lecture de plan.jdiag en attente : la balise reste du texte, sans marque ni image.
  expect(apercu().textContent).toContain("![[plan.jdiag]]");
  expect(apercu().querySelector("img")).toBeNull();
  rendre();
  await vi.waitFor(() => expect(creees.length).toBe(1));
  creees[0].dispatchEvent(new Event("load"));
  const img = apercu().querySelector("img.ya-image-md");
  expect(img.alt).toBe("plan.jdiag");
  expect(decodeURIComponent(img.getAttribute("src"))).toContain('width="132"');
  expect(apercu().querySelectorAll("img").length).toBe(1);
  // Sans objet, absent : le texte exact de la balise, sans message.
  expect(apercu().textContent).toContain("![[vide.jdiag]]");
  expect(apercu().textContent).toContain("![[absent.jdiag]]");
  expect(apercu().textContent).not.toContain("![[plan.jdiag]]");
  expect(document.querySelector("[role=alert]")).toBeNull();
});

test("REQ184_AC3_AC4_onglet_avec_environnement_garde_son_nom_et_le_donne_a_ses_sous_agents_apres_rechargement", async () => {
  const { e } = monterOc({}, true);
  await e.restaurer();
  e.ouvrirOpencode({ sessionId: "s1", environnement: "prod" });
  expect(faux.oc[0].environnement).toBe("prod");
  e.ouvrirOpencode({ sessionId: "s2" });
  expect(faux.oc[1].environnement).toBeUndefined();
  faux.oc[0].surOuvrir({ id: "sa1", agent: "explore", titre: "Chercher" });
  expect(faux.oc[2].environnement).toBe("prod");
  faux.oc[1].surOuvrir({ id: "sa2", agent: "general", titre: "Lire" });
  expect(faux.oc[3].environnement).toBeUndefined();
  const g = await derniereGarde();
  const parId = (l) => Object.fromEntries(l.map((x) => [x.id, x]));
  expect(parId(g.liste)).toEqual(parId([
    { ...ocGarde("s1", 1), environnement: "prod" },
    { ...saGarde("sa1", "explore", "Chercher"), environnement: "prod" },
    ocGarde("s2", 2),
    saGarde("sa2", "general", "Lire"),
  ]));
  // Rechargement : les onglets repartent avec leur environnement.
  gardes(g.liste, "\0oc:s1");
  const { e: e2 } = monterOc({}, true);
  await e2.restaurer();
  expect(Object.fromEntries(faux.oc.map((v) => [v.sessionId, v.environnement]))).toEqual({ s1: "prod", sa1: "prod", s2: undefined, sa2: undefined });
});

// ---- Onglet d'un workflow (REQ-191, REQ-192) ----

const WF = (extra = {}) => ({ nom: "Revue des notes", publie: false, noeuds: [], liens: [], fichier: "revue", ...extra });
// Faux serveur des workflows : `etat.wf` est lu par GET, `etat.puts` garde les corps reçus, `etat.reponsePut` le statut du PUT.
function serveurWf(wf = WF()) {
  const etat = { wf, puts: [], gets: 0, reponsePut: 200, lectures: 0, enCours: null, posts: [], reponses: {} };
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const u = String(url);
    if (u === "/api/workflows/revue" && !options.method) {
      etat.gets++;
      return { ok: true, status: 200, json: async () => etat.wf };
    }
    if (u === "/api/workflows/revue" && options.method === "PUT") {
      if (etat.reponsePut === "coupure") throw new Error("hors ligne");
      if (etat.reponsePut === 400) return { ok: false, status: 400, json: async () => ({ message: "Workflow invalide." }), headers: new Headers() };
      etat.puts.push(JSON.parse(options.body));
      return { ok: etat.reponsePut === 200, status: etat.reponsePut, json: async () => etat.wf, headers: new Headers() };
    }
    if (u === "/api/workflows/revue/execution") {
      etat.lectures++;
      if (etat.coupureExecution) throw new Error("hors ligne");
      return { ok: true, status: 200, json: async () => ({ publie: etat.wf.publie, enCours: etat.enCours ?? null }) };
    }
    const action = /^\/api\/workflows\/revue\/(publier|depublier|arreter)$/.exec(u)?.[1];
    if (action && options.method === "POST") {
      etat.posts.push(action);
      const r = etat.reponses[action] ?? { status: 200, corps: {} };
      if (r === "coupure") throw new Error("hors ligne");
      if (r.status === 200 && action !== "arreter") etat.wf.publie = action === "publier";
      return { ok: r.status === 200, status: r.status, json: async () => r.corps, text: async () => r.texte ?? "", headers: new Headers() };
    }
    return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
  }));
  return etat;
}
async function monterWf(wf) {
  const serveur = serveurWf(wf);
  const { e } = monter();
  document.body.append(e.question);
  await e.restaurer();
  await e.ouvrirWorkflow("revue");
  return { e, serveur };
}
const typeWf = (nom) => document.querySelector(`.ya-wf-type[aria-label="${nom}"]`);
const surfaceWf = () => document.querySelector(".ya-wf-surface");

test("REQ191_AC2_deux_types_ajoutes_relies_puis_ctrl_s_enregistre_par_la_route_des_workflows_et_l_onglet_rouvert_les_montre", async () => {
  const { serveur } = await monterWf();
  typeWf("Fichiers d'un dossier").click();
  expect(document.querySelector(".ya-noeud-choisi .ya-noeud-titre").textContent).toBe("Fichiers d'un dossier 1");
  typeWf("Commande shell").click();
  expect(document.querySelectorAll(".ya-noeud").length).toBe(2);
  expect(document.querySelectorAll("path.ya-wf-lien").length).toBe(1);
  expect(document.querySelector('[data-champ="apres"]').value).toBe("n1");
  expect(onglet("Revue des notes").dataset.modifie).toBe("true");
  ctrlS();
  await vi.waitFor(() => expect(serveur.puts.length).toBe(1));
  const [envoi] = serveur.puts;
  expect(envoi.noeuds.map((n) => [n.type, n.titre])).toEqual([["dossier", "Fichiers d'un dossier 1"], ["shell", "Commande shell 1"]]);
  expect(envoi.noeuds[0].reglages.evenements).toBeDefined();
  expect(envoi.liens).toEqual([{ de: "n1", vers: "n2" }]);
  await vi.waitFor(() => expect(onglet("Revue des notes").dataset.modifie).toBeUndefined());
  // Aucun appel à la route des fichiers.
  expect(fetch.mock.calls.some(([u]) => String(u).startsWith("/api/fichier"))).toBe(false);
  // Yaide relancé : l'onglet gardé est relu par la route des workflows et montre les nœuds aux mêmes places.
  const g = await derniereGarde();
  expect(g.liste[0]).toMatchObject({ chemin: ".yaide/workflows/revue.json", workflow: "revue" });
  serveur.wf = WF({ noeuds: envoi.noeuds, liens: envoi.liens });
  gardes(g.liste, g.actif);
  document.body.replaceChildren();
  const { e: e2 } = monter();
  await e2.restaurer();
  expect(document.querySelectorAll(".ya-noeud").length).toBe(2);
  expect([...document.querySelectorAll(".ya-noeud")].map((n) => [n.style.left, n.style.top])).toEqual(envoi.noeuds.map((n) => [`${n.x}px`, `${n.y}px`]));
});

test("REQ191_AC5_modification_non_enregistree_point_sur_l_onglet_question_a_la_fermeture_abandonner_n_ecrit_rien", async () => {
  const { e, serveur } = await monterWf();
  expect(onglet("Revue des notes").dataset.modifie).toBeUndefined();
  typeWf("Planification").click();
  expect(onglet("Revue des notes").dataset.modifie).toBe("true");
  e.barre.querySelector('[aria-label^="Fermer"]').click();
  expect(document.querySelector("dialog").textContent).toContain("Sauvegarder Revue des notes ?");
  clicBouton("Abandonner");
  expect(onglets().length).toBe(0);
  expect(serveur.puts).toEqual([]);
});

test("REQ191_AC7_onglet_icone_nom_info_bulle_sans_fil_barre_de_zoom_et_panneau_nommé", async () => {
  const { e } = await monterWf();
  const t = onglets()[0];
  expect(t.querySelector(".onglet-nom").textContent).toBe("Revue des notes");
  expect(t.querySelector("svg[data-icone=waypoints]")).not.toBeNull();
  expect(t.closest(".onglet-cellule").title || t.title).toBe("Workflow .yaide/workflows/revue.json");
  expect(e.fil.hidden).toBe(true);
  const boutons = [...e.barre.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).filter((n) => /Zoom|Tout/.test(n));
  expect(boutons).toEqual(["Zoom arrière", "Zoom avant", "Tout afficher"]);
  const zoom = e.barre.querySelector(".ya-tableau-zoom");
  expect(zoom.getAttribute("role")).toBe("status");
  expect(zoom.textContent).toBe("100 %");
  e.barre.querySelector('button[aria-label="Zoom avant"]').click();
  expect(zoom.textContent).toBe("110 %");
  e.barre.querySelector('button[aria-label="Tout afficher"]').click();
  const aside = document.querySelector("aside");
  expect(document.getElementById(aside.getAttribute("aria-labelledby")).textContent).toBe("Nœuds");
  expect(surfaceWf().getAttribute("aria-label")).toBe("Surface du workflow Revue des notes");
  expect(document.querySelector(".ya-wf-vide").textContent).toBe("Ajoutez un déclencheur depuis le panneau Nœuds.");
  // Le premier type prend le focus d'un workflow vide.
  expect(document.activeElement).toBe(typeWf("Fichiers d'un dossier"));
});

test("REQ192_AC3_workflow_publie_message_types_desactives_rien_ne_change_et_le_serveur_refuse_409", async () => {
  const noeud = { id: "n1", type: "dossier", titre: "Fichiers d'un dossier 1", x: 0, y: 0, reglages: { dossier: ".", evenements: ["cree"] } };
  const { serveur } = await monterWf(WF({ publie: true, noeuds: [noeud] }));
  expect(document.querySelector(".ya-wf-lecture-message").textContent).toContain("Workflow publié : dépubliez-le pour le modifier.");
  expect(typeWf("Commande shell").getAttribute("aria-disabled")).toBe("true");
  typeWf("Commande shell").click();
  expect(document.querySelectorAll(".ya-noeud").length).toBe(1);
  document.querySelector(".ya-noeud").dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }), { pointerId: 1 }));
  surfaceWf().dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
  expect(document.querySelectorAll(".ya-noeud").length).toBe(1);
  expect(document.querySelector('[data-champ="titre"]').readOnly).toBe(true);
  ctrlS();
  await toutes();
  expect(serveur.puts).toEqual([]);
});

test("REQ192_AC3_enregistrement_refuse_409_ou_coupure_dit_pourquoi_et_garde_le_point", async () => {
  const { serveur } = await monterWf();
  typeWf("Planification").click();
  serveur.reponsePut = 409;
  ctrlS();
  await vi.waitFor(() => expect(document.querySelector("[role=alert]")?.textContent).toBe("Enregistrement impossible : ce workflow est publié. Dépubliez-le, puis réessayez."));
  expect(onglet("Revue des notes").dataset.modifie).toBe("true");
  serveur.reponsePut = 400;
  ctrlS();
  await vi.waitFor(() => expect(document.querySelector("[role=alert]")?.textContent).toBe("Enregistrement impossible : Workflow invalide."));
  expect(onglet("Revue des notes").dataset.modifie).toBe("true");
  serveur.reponsePut = "coupure";
  ctrlS();
  await vi.waitFor(() => expect(document.querySelector("[role=alert]")?.textContent).toBe("Enregistrement impossible : connexion perdue. Réessayez au retour."));
  expect(onglet("Revue des notes").dataset.modifie).toBe("true");
});

test("REQ192_AC5_depublie_pendant_que_l_onglet_est_ouvert_il_redevient_modifiable_sans_rechargement_choix_gardé", async () => {
  const noeud = { id: "n1", type: "dossier", titre: "Fichiers d'un dossier 1", x: 0, y: 0, reglages: { dossier: ".", evenements: ["cree"] } };
  const { e, serveur } = await monterWf(WF({ publie: true, noeuds: [noeud] }));
  document.querySelector(".ya-noeud").dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }), { pointerId: 1 }));
  expect(document.querySelector('[data-champ="titre"]').readOnly).toBe(true);
  expect(e.workflowModifie("revue")).toBe(false);
  e.etatWorkflow("revue", false);
  expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(true);
  expect(document.querySelector('[data-champ="titre"]').readOnly).toBe(false);
  expect(document.querySelector(".ya-noeud-choisi")).not.toBeNull();
  expect(typeWf("Commande shell").getAttribute("aria-disabled")).toBeNull(); // « Ajouter une action après » est de nouveau permis
  expect(serveur.gets).toBe(1);
  // Publié de nouveau : retour en lecture seule, toujours sans relecture.
  e.etatWorkflow("revue", true);
  expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(false);
  expect(document.querySelector('[data-champ="titre"]').readOnly).toBe(true);
  expect(typeWf("Commande shell").getAttribute("aria-disabled")).toBe("true");
  expect(serveur.gets).toBe(1);
});

test("REQ191_AC7_workflow_illisible_dit_pourquoi_sans_barre_d_outils_ni_ctrl_s", async () => {
  const puts = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    if (options.method === "PUT") puts.push(url);
    return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
  }));
  const { e } = monter();
  await e.ouvrirWorkflow("casse");
  expect(document.querySelector(".ya-wf-illisible").textContent).toBe(".yaide/workflows/casse.json n'est pas lisible. Corrigez-le, puis rouvrez Workflows.");
  expect(document.querySelector(".ya-wf-surface, aside")).toBeNull();
  expect(e.barre.querySelector('button[aria-label="Zoom avant"]')).toBeNull();
  ctrlS();
  await toutes();
  expect(puts).toEqual([]);
});

// ---- Onglet d'un workflow : suivi, Publier, Dépublier, Arrêter (REQ-192, REQ-197, REQ-199) ----

const NOEUD_SHELL = { id: "n2", type: "shell", titre: "Commande shell 1", x: 300, y: 0, reglages: { commande: "sleep 3" } };
const NOEUD_DOSSIER = { id: "n1", type: "dossier", titre: "Fichiers d'un dossier 1", x: 0, y: 0, reglages: { dossier: "notes", evenements: ["cree"] } };
const WF_VALIDE = (extra = {}) => WF({ noeuds: [NOEUD_DOSSIER, NOEUD_SHELL], liens: [{ de: "n1", vers: "n2" }], ...extra });
const boutonWf = (nom) => [...document.querySelectorAll(".onglets-droite > button")].find((b) => b.textContent === nom) ?? null;
const ligneEtat = () => document.querySelector(".ya-wf-etat");
const unSeconde = async () => {
  await vi.advanceTimersByTimeAsync(1000);
};

describe("onglet d'un workflow publié ou brouillon", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
  afterEach(() => vi.useRealTimers());

  test("REQ197_AC2_REQ197_AC6_onglet_publie_lit_l_execution_chaque_seconde_ligne_d_etat_et_noeud_marque_puis_retour_a_l_attente", async () => {
    const { serveur } = await monterWf(WF_VALIDE({ publie: true }));
    expect(ligneEtat().textContent).toBe("En attente d'un évènement.");
    expect(ligneEtat().getAttribute("role")).toBe("status");
    expect(document.querySelector(".ya-wf-lecture-message .message-texte").getAttribute("role")).toBe("status");
    expect(document.querySelector(".ya-noeud-etiquette")).toBeNull();
    expect(boutonWf("Arrêter")).toBeNull();
    expect(serveur.lectures).toBe(0);
    await unSeconde();
    expect(serveur.lectures).toBe(1);
    serveur.enCours = "n2";
    await unSeconde();
    expect(serveur.lectures).toBe(2);
    expect(ligneEtat().textContent).toBe("En cours : Commande shell 1.");
    expect(ligneEtat().title).toBe("En cours : Commande shell 1.");
    expect(document.querySelectorAll(".ya-noeud-etiquette").length).toBe(1);
    expect(document.querySelector(".ya-noeud-etiquette").textContent).toBe("En cours");
    expect(document.querySelector(".ya-noeud-etiquette").getAttribute("aria-hidden")).toBe("true");
    expect(boutonWf("Arrêter")).not.toBeNull();
    // Le texte du bandeau ne change pas tant que le nœud en cours ne change pas.
    const mut = [];
    const obs = new MutationObserver((l) => mut.push(...l));
    obs.observe(ligneEtat(), { childList: true, characterData: true, subtree: true });
    await unSeconde();
    await Promise.resolve();
    expect(mut).toEqual([]);
    obs.disconnect();
    serveur.enCours = null;
    await unSeconde();
    expect(ligneEtat().textContent).toBe("En attente d'un évènement.");
    expect(document.querySelector(".ya-noeud-etiquette")).toBeNull();
    expect(boutonWf("Arrêter")).toBeNull();
  });

  test("REQ197_AC2_un_brouillon_ne_lit_jamais_l_execution_et_la_fermeture_arrete_les_lectures", async () => {
    const { e, serveur } = await monterWf(WF_VALIDE());
    await vi.advanceTimersByTimeAsync(3000);
    expect(serveur.lectures).toBe(0);
    expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(true);
    e.etatWorkflow("revue", true);
    await unSeconde();
    expect(serveur.lectures).toBe(1);
    e.detruire();
    await vi.advanceTimersByTimeAsync(3000);
    expect(serveur.lectures).toBe(1);
  });

  test("REQ197_AC3_publier_depuis_le_dialogue_passe_l_onglet_en_suivi_sans_rechargement_choix_gardé_puis_depublier_arrete_les_lectures", async () => {
    const { e, serveur } = await monterWf(WF_VALIDE());
    document.querySelector(".ya-noeud").dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }), { pointerId: 1 }));
    expect(document.querySelector(".ya-noeud-choisi")).not.toBeNull();
    document.querySelector('button[aria-label="Zoom avant"]').click();
    const avant = { zoom: document.querySelector(".ya-tableau-zoom").textContent, noeud: document.querySelector(".ya-noeud").getAttribute("style") };
    expect(avant.zoom).not.toBe("100 %");
    e.etatWorkflow("revue", true);
    expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(false);
    expect(ligneEtat().textContent).toBe("En attente d'un évènement.");
    expect(document.querySelector(".ya-noeud-choisi")).not.toBeNull();
    expect({ zoom: document.querySelector(".ya-tableau-zoom").textContent, noeud: document.querySelector(".ya-noeud").getAttribute("style") }).toEqual(avant);
    expect(serveur.gets).toBe(1);
    await unSeconde();
    expect(serveur.lectures).toBe(1);
    serveur.enCours = "n2";
    await unSeconde();
    expect(ligneEtat().textContent).toBe("En cours : Commande shell 1.");
    e.etatWorkflow("revue", false);
    expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(true);
    expect(document.querySelector(".ya-noeud-etiquette")).toBeNull();
    expect(boutonWf("Arrêter")).toBeNull();
    expect(boutonWf("Publier")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(serveur.lectures).toBe(2);
  });

  test("REQ199_AC1_REQ199_AC5_publier_depuis_l_onglet_passe_en_suivi_message_status_et_focus_sur_depublier", async () => {
    const { serveur } = await monterWf(WF_VALIDE());
    const publier = boutonWf("Publier");
    expect(publier).not.toBeNull();
    publier.focus();
    publier.click();
    expect(publier.textContent).toBe("Publication…");
    expect(publier.getAttribute("aria-busy")).toBe("true");
    await vi.advanceTimersByTimeAsync(0);
    await toutes();
    expect(serveur.posts).toEqual(["publier"]);
    const msg = document.querySelector(".ya-wf-lecture-message + .message");
    expect(msg.textContent).toContain("Revue des notes est publié. Son déclencheur écoute.");
    expect(msg.getAttribute("role")).toBe("status");
    expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(false);
    expect(ligneEtat().textContent).toBe("En attente d'un évènement.");
    expect(boutonWf("Publier")).toBeNull();
    expect(boutonWf("Dépublier")).toBe(publier);
    expect(document.activeElement).toBe(publier);
    expect(serveur.gets).toBe(1);
  });

  test("REQ199_AC2_publier_refuse_enregistrez_d_abord_ou_ajoutez_un_declencheur_rien_n_est_publié", async () => {
    const { serveur } = await monterWf();
    typeWf("Planification").click(); // modifié, non enregistré
    expect(onglet("Revue des notes").dataset.modifie).toBe("true");
    boutonWf("Publier").focus();
    boutonWf("Publier").click();
    await toutes();
    const msg = document.querySelector("[role=alert]");
    expect(msg.textContent).toContain("Revue des notes n'est pas publié :");
    expect([...msg.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["Enregistrez d'abord le workflow."]);
    expect(serveur.posts).toEqual([]);
    expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(true);
    expect(document.activeElement).toBe(boutonWf("Publier"));
    // Enregistré, mais sans déclencheur valide : le refus du serveur, ses points.
    serveur.reponses.publier = { status: 422, corps: { messages: ["Ajoutez un déclencheur."] } };
    ctrlS();
    await vi.waitFor(() => expect(onglet("Revue des notes").dataset.modifie).toBeUndefined());
    expect(document.querySelector("[role=alert]")).toBeNull(); // Ctrl+S ôte le message
    boutonWf("Publier").click();
    await toutes();
    expect(serveur.posts).toEqual(["publier"]);
    const m2 = document.querySelector("[role=alert]");
    expect(m2.textContent).toContain("Revue des notes n'est pas publié :");
    expect([...m2.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["Ajoutez un déclencheur."]);
    expect(serveur.wf.publie).toBe(false);
    expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(true);
    expect(boutonWf("Publier")).not.toBeNull();
    expect(typeWf("Commande shell").getAttribute("aria-disabled")).toBeNull();
  });

  test("REQ199_AC3_depublier_depuis_l_onglet_en_suivi_le_rend_modifiable_sans_rechargement_et_le_bouton_redevient_publier", async () => {
    const { serveur } = await monterWf(WF_VALIDE({ publie: true }));
    boutonWf("Dépublier").focus();
    boutonWf("Dépublier").click();
    expect(boutonWf("Dépublication…")).not.toBeNull();
    await toutes();
    expect(serveur.posts).toEqual(["depublier"]);
    expect(document.querySelector(".ya-wf-lecture-message + .message").textContent).toContain("Revue des notes est un brouillon. Rien ne le lance plus.");
    expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(true);
    expect(boutonWf("Publier")).not.toBeNull();
    expect(document.activeElement).toBe(boutonWf("Publier"));
    expect(typeWf("Commande shell").getAttribute("aria-disabled")).toBeNull();
    expect(serveur.gets).toBe(1);
  });

  test("REQ199_AC4_REQ197_AC2_arreter_paraît_pendant_une_execution_arrete_et_part_le_focus_sur_depublier", async () => {
    const { serveur } = await monterWf(WF_VALIDE({ publie: true }));
    expect(boutonWf("Arrêter")).toBeNull();
    serveur.enCours = "n2";
    await unSeconde();
    const arreter = boutonWf("Arrêter");
    expect([...document.querySelectorAll(".onglets-droite > button")].slice(0, 2).map((b) => b.textContent)).toEqual(["Arrêter", "Dépublier"]);
    arreter.focus();
    arreter.click();
    expect(arreter.textContent).toBe("Arrêt…");
    expect(boutonWf("Dépublier").disabled).toBe(true);
    serveur.enCours = null;
    await toutes();
    expect(serveur.posts).toEqual(["arreter"]);
    expect(document.querySelector(".ya-wf-lecture-message + .message").textContent).toContain("Revue des notes est arrêté. Son déclencheur écoute toujours.");
    expect(boutonWf("Arrêter")).toBeNull();
    expect(boutonWf("Dépublier").disabled).toBe(false);
    expect(document.activeElement).toBe(boutonWf("Dépublier"));
    expect(ligneEtat().textContent).toBe("En attente d'un évènement.");
    expect(document.querySelector(".ya-noeud-etiquette")).toBeNull();
  });

  test("REQ199_AC5_REQ199_AC6_arret_sans_execution_alerte_croix_fermer_rend_le_focus_a_la_surface_un_seul_message_et_coupure", async () => {
    const { serveur } = await monterWf(WF_VALIDE({ publie: true }));
    serveur.enCours = "n2";
    await unSeconde();
    serveur.reponses.arreter = { status: 409, texte: "Revue des notes n'a pas d'exécution en cours." };
    boutonWf("Arrêter").focus();
    boutonWf("Arrêter").click();
    await toutes();
    const alerte = document.querySelector(".ya-wf-lecture-message + .message");
    expect(alerte.getAttribute("role")).toBe("alert");
    expect(alerte.textContent).toContain("Revue des notes n'a pas d'exécution en cours.");
    expect(boutonWf("Arrêter")).toBeNull();
    expect(document.activeElement).toBe(boutonWf("Dépublier"));
    // Un seul message à la fois : le suivant remplace celui-ci.
    serveur.reponses.depublier = "coupure";
    boutonWf("Dépublier").click();
    await toutes();
    expect(document.querySelectorAll(".ya-wf-lecture-message ~ .message").length).toBe(1);
    expect(document.querySelector(".ya-wf-lecture-message + .message").textContent).toContain("Connexion perdue. Réessayez au retour.");
    expect(boutonWf("Dépublier")).not.toBeNull(); // rien ne change
    expect(document.querySelector(".ya-wf-lecture-message").hidden).toBe(false);
    // « Fermer » met le focus sur la surface.
    const fermer = document.querySelector(".ya-wf-lecture-message + .message button");
    expect(fermer.getAttribute("aria-label")).toBe("Fermer");
    fermer.click();
    expect(document.querySelector(".ya-wf-lecture-message + .message")).toBeNull();
    expect(document.activeElement).toBe(surfaceWf());
  });

  test("REQ199_AC6_exécution_finie_pendant_que_arreter_a_le_focus_il_part_et_le_focus_va_sur_depublier", async () => {
    const { serveur } = await monterWf(WF_VALIDE({ publie: true }));
    serveur.enCours = "n2";
    await unSeconde();
    boutonWf("Arrêter").focus();
    expect(document.activeElement).toBe(boutonWf("Arrêter"));
    serveur.enCours = null;
    await unSeconde();
    expect(boutonWf("Arrêter")).toBeNull();
    expect(document.activeElement).toBe(boutonWf("Dépublier"));
  });

  test("REQ199_AC6_les_boutons_sont_a_droite_des_onglets_avant_le_zoom", async () => {
    const { serveur } = await monterWf(WF_VALIDE({ publie: true }));
    serveur.enCours = "n2";
    await unSeconde();
    const noms = [...document.querySelectorAll(".onglets-droite > *")].map((x) => x.textContent || x.querySelector("button")?.getAttribute("aria-label"));
    expect(noms.slice(0, 2)).toEqual(["Arrêter", "Dépublier"]);
    expect(noms.indexOf("Zoom arrière")).toBe(2);
    expect(document.querySelector(".onglets-droite").textContent).toContain("Dépublier");
    // Refus d'arrêter par une erreur du serveur : message d'échec, le bouton garde son rôle.
    serveur.reponses.arreter = { status: 500, texte: "boum" };
    boutonWf("Arrêter").click();
    await toutes();
    expect(document.querySelector(".ya-wf-lecture-message + .message").textContent).toContain("Arrêt impossible : boum.");
    expect(boutonWf("Arrêter")).not.toBeNull();
  });
});
