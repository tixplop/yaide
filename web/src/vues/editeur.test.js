import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { vueEditeur } from "./editeur.js";
import { nomLangage } from "../ui/langages.js";

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
  vi.doMock("../onglets-fichiers.js", async (orig) => ({ ...(await orig()), garder, retrouver: async () => ({ liste: [], actif: null }) }));
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
  expect(garder).toHaveBeenLastCalledWith([expect.objectContaining({ chemin: "README.md" })], "README.md");
  vi.doUnmock("../onglets-fichiers.js");
  vi.resetModules();
});
