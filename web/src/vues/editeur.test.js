import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { vueEditeur } from "./editeur.js";
import { lire } from "../stockage.js";
import { nomLangage } from "../ui/langages.js";

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
    expect(boutonHybride() !== null, chemin).toBe(/\.(md|markdown)$/i.test(chemin));
    expect(boutonApercu() !== null, chemin).toBe(/\.(md|markdown|html)$/i.test(chemin));
  }
  e.ouvrir({ chemin: "README.md", contenu: "x", version: "1" });
  expect(boutonHybride().compareDocumentPosition(boutonApercu()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  e.ouvrirDiff({ chemin: "README.md", texte: "+a" });
  expect(boutonHybride()).toBeNull();
  expect(boutonApercu()).toBeNull();
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
