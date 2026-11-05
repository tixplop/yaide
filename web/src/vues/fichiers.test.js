import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { vueFichiers } from "./fichiers.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

let vues = [];
afterEach(() => {
  for (const v of vues) v.detruire();
  vues = [];
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const attendre = () => new Promise((r) => setTimeout(r, 0));
const f = (nom) => ({ nom, dossier: false });
const d = (nom) => ({ nom, dossier: true });

/** `disque` : chemin de dossier -> entrées (ou réponse d'erreur `{ status, corps }`) ; modifiable par le test. */
async function monter(disque, options = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const chemin = decodeURIComponent(new URL(url, "http://x").searchParams.get("chemin") ?? "");
    appels.push(url);
    if (typeof disque.attente === "function") await disque.attente();
    const v = disque[chemin];
    if (disque.coupure) throw new TypeError("réseau");
    if (v?.status) return { ok: false, status: v.status, json: async () => v.corps };
    return { ok: true, status: 200, json: async () => ({ entrees: v }) };
  }));
  const rappels = { dire: vi.fn(), ...options };
  const vue = vueFichiers(rappels);
  vues.push(vue);
  document.body.append(vue.entete, vue.corps);
  await attendre();
  return { vue, appels, ...rappels };
}

const lignes = (vue) => [...vue.corps.querySelectorAll("[data-chemin]")];
const noms = (vue) => lignes(vue).map((e) => e.dataset.chemin);
const ligne = (vue, chemin) => lignes(vue).find((e) => e.dataset.chemin === chemin);
const bouton = (vue, nom) => [...vue.entete.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom);

test("REQ045_AC1_une_ligne_ajoutee_ou_retiree_apparait_ou_disparait_dossier_deplie_compris", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("main.rs")] };
  const { vue } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  expect(noms(vue)).toEqual(["src", "src/main.rs", "a.txt"]);
  disque[""] = [d("src"), f("a.txt"), f("nouveau.txt")];
  disque.src = [f("main.rs"), f("lib.rs")];
  await vue.relire();
  expect(noms(vue)).toEqual(["src", "src/main.rs", "src/lib.rs", "a.txt", "nouveau.txt"]);
  disque[""] = [d("src"), f("a.txt")];
  disque.src = [f("lib.rs")];
  await vue.relire();
  expect(noms(vue)).toEqual(["src", "src/lib.rs", "a.txt"]);
});

test("REQ045_AC1_un_dossier_deplie_supprime_ailleurs_est_retire_sans_message", async () => {
  const disque = { "": [d("src")], src: [f("main.rs")] };
  const { vue, dire } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  disque[""] = [];
  disque.src = { status: 404, corps: { cause: "introuvable", message: "Introuvable." } };
  disque[""] = [f("b.txt")];
  await vue.relire();
  expect(noms(vue)).toEqual(["b.txt"]);
  expect(dire).not.toHaveBeenCalled();
});

test("REQ045_AC5_AC6_sans_changement_memes_elements_sans_Chargement_et_focus_garde", async () => {
  const disque = { "": [f("a.txt"), f("b.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "b.txt").focus();
  const avant = lignes(vue);
  await vue.relire();
  expect(lignes(vue).every((e, i) => e === avant[i])).toBe(true);
  expect(document.activeElement).toBe(avant[1]);
  expect(vue.corps.textContent).not.toContain("Chargement");
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

test("REQ045_AC5_avec_changement_focus_selection_et_defilement_sont_gardes", async () => {
  const disque = { "": [f("a.txt"), f("b.txt")] };
  const { vue } = await monter(disque);
  const zone = vue.corps.querySelector(".fichiers-arbre");
  zone.scrollTop = 40;
  ligne(vue, "b.txt").focus();
  disque[""] = [f("a.txt"), f("b.txt"), f("c.txt")];
  await vue.relire();
  expect(noms(vue)).toEqual(["a.txt", "b.txt", "c.txt"]);
  expect(document.activeElement).toBe(ligne(vue, "b.txt"));
  expect(ligne(vue, "b.txt").getAttribute("aria-selected")).toBe("true");
  expect(zone.scrollTop).toBe(40);
  expect(vue.corps.textContent).not.toContain("Chargement");
});

test("REQ045_AC7_un_menu_ouvert_reste_ouvert_pendant_une_relecture", async () => {
  const disque = { "": [f("a.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "a.txt").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  const menu = document.querySelector("[role=menu]");
  expect(menu).not.toBeNull();
  const focus = document.activeElement;
  disque[""] = [f("a.txt"), f("z.txt")];
  await vue.relire();
  expect(document.querySelector("[role=menu]")).toBe(menu);
  expect(document.activeElement).toBe(focus);
});

test("REQ045_AC8_la_ligne_selectionnee_retiree_n_est_plus_selectionnee_le_focus_va_a_la_precedente", async () => {
  const disque = { "": [f("a.txt"), f("b.txt"), f("c.txt")] };
  const { vue, dire } = await monter(disque);
  ligne(vue, "b.txt").focus();
  disque[""] = [f("a.txt"), f("c.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  expect(bouton(vue, "Supprimer").disabled).toBe(true);
  expect(dire).not.toHaveBeenCalled();
});

test("REQ045_AC8_la_premiere_ligne_retiree_avec_le_focus_le_donne_a_Nouveau_fichier", async () => {
  const disque = { "": [f("a.txt"), f("b.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "a.txt").focus();
  disque[""] = [f("b.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(bouton(vue, "Nouveau fichier"));
});

test("REQ045_AC8_dernier_fichier_retire_dossier_vide_et_selection_perdue", async () => {
  const disque = { "": [f("a.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "a.txt").focus();
  disque[""] = [];
  await vue.relire();
  expect(vue.corps.textContent).toContain("Dossier vide.");
  expect(bouton(vue, "Supprimer").disabled).toBe(true);
});

test("REQ045_AC8_une_ligne_cachee_par_le_repli_garde_sa_selection", async () => {
  const disque = { "": [d("src")], src: [f("main.rs")] };
  const { vue } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  ligne(vue, "src/main.rs").focus(); // sélectionne main.rs
  ligne(vue, "src").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); // replie src sans changer la sélection
  expect(noms(vue)).toEqual(["src"]);
  expect(bouton(vue, "Renommer").disabled).toBe(false);
  disque[""] = [d("src"), f("z.txt")];
  await vue.relire();
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

test("REQ045_AC8_le_focus_reste_sur_la_ligne_voisine_apres_un_redessin_suivant", async () => {
  const disque = { "": [f("a.txt"), f("b.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "b.txt").focus();
  disque[""] = [f("a.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
  vue.definirStatuts(new Map([["a.txt", { lettre: "M", mot: "modifié" }]]));
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
  disque[""] = [f("a.txt"), f("c.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  // Une ligne focalisée sans sélection qui disparaît passe aussi le focus à la précédente.
  ligne(vue, "c.txt").focus();
  disque[""] = [f("a.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
});

test("REQ045_AC7_un_dialogue_ouvert_garde_son_texte_et_son_focus_pendant_une_relecture", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute("open", "");
  };
  const disque = { "": [f("a.txt")] };
  const { vue } = await monter(disque);
  bouton(vue, "Nouveau fichier").click();
  const saisie = document.querySelector("dialog input");
  saisie.value = "dossier/neuf.txt";
  saisie.focus();
  disque[""] = [f("a.txt"), f("b.txt")];
  await vue.relire();
  expect(document.querySelector("dialog input")).toBe(saisie);
  expect(saisie.value).toBe("dossier/neuf.txt");
  expect(document.activeElement).toBe(saisie);
});

test("REQ045_AC9_AC10_coupure_ou_refus_ne_changent_rien_et_ne_disent_rien", async () => {
  const disque = { "": [f("a.txt")] };
  const { vue, dire } = await monter(disque);
  const avant = lignes(vue);
  disque.coupure = true;
  await vue.relire();
  delete disque.coupure;
  disque[""] = { status: 403, corps: { cause: "interdit", message: "Non." } };
  await vue.relire();
  expect(lignes(vue)[0]).toBe(avant[0]);
  expect(dire).not.toHaveBeenCalled();
  disque[""] = [f("a.txt"), f("b.txt")];
  await vue.relire();
  expect(noms(vue)).toEqual(["a.txt", "b.txt"]);
});

test("REQ045_generation_une_relecture_croisee_avec_un_rafraichissement_est_jetee", async () => {
  const disque = { "": [f("a.txt")] };
  const { vue } = await monter(disque);
  let liberer;
  const retenue = new Promise((r) => (liberer = r));
  disque.attente = () => retenue;
  const lancee = vue.relire();
  await attendre();
  disque[""] = [f("a.txt"), f("cree.txt")];
  delete disque.attente;
  await vue.rafraichir();
  expect(noms(vue)).toEqual(["a.txt", "cree.txt"]);
  disque[""] = [f("a.txt")]; // lecture ancienne, rendue après la création
  liberer();
  await lancee;
  expect(noms(vue)).toEqual(["a.txt", "cree.txt"]);
});

// ---- REQ-049 : plusieurs lignes ----

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute("open");
};
const ctrl = (vue, chemin) => ligne(vue, chemin).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
const choisies = (vue) => lignes(vue).filter((e) => e.getAttribute("aria-selected") === "true").map((e) => e.dataset.chemin);
const touche = (vue, chemin, key) => ligne(vue, chemin).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

test("REQ009_AC5_REQ049_AC4_boutons_et_touches_inactifs_a_plusieurs", async () => {
  const { vue, surOuvrir } = await monter({ "": [f("a.txt"), f("b.txt")] }, { surOuvrir: vi.fn() });
  ctrl(vue, "a.txt");
  expect(bouton(vue, "Renommer").disabled).toBe(false);
  ctrl(vue, "b.txt");
  expect(choisies(vue)).toEqual(["a.txt", "b.txt"]);
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  expect(bouton(vue, "Supprimer").disabled).toBe(true);
  touche(vue, "b.txt", "F2");
  touche(vue, "b.txt", "Delete");
  expect(document.querySelector("dialog[open]")).toBeNull();
  expect(surOuvrir).not.toHaveBeenCalled();
});

test("REQ049_AC1_ctrl_clic_n_ouvre_rien_ne_deplie_rien", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("m.rs")] };
  const { vue, appels, surOuvrir } = await monter(disque, { surOuvrir: vi.fn() });
  const avant = appels.length;
  ctrl(vue, "a.txt");
  ctrl(vue, "src");
  await attendre();
  expect(choisies(vue)).toEqual(["src", "a.txt"]);
  expect(appels.length).toBe(avant);
  expect(surOuvrir).not.toHaveBeenCalled();
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("false");
  ctrl(vue, "a.txt"); // sur une ligne choisie : elle sort
  expect(choisies(vue)).toEqual(["src"]);
  expect(vue.corps.querySelector("[role=tree]").getAttribute("aria-multiselectable")).toBe("true");
});

test("REQ049_AC3_clic_droit_ramene_a_une_ligne_partie_vide_ne_change_rien", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt"), f("c.txt")] });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ctrl(vue, "c.txt");
  const zone = vue.corps.querySelector(".fichiers-arbre");
  zone.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  expect(document.querySelector("[role=menu]").getAttribute("aria-label")).toBe("Actions sur le projet");
  expect(choisies(vue)).toEqual(["a.txt", "b.txt", "c.txt"]);
  ligne(vue, "b.txt").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  expect(choisies(vue)).toEqual(["b.txt"]);
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

test("REQ049_AC3_clic_simple_ramene_a_une_ligne", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt")] });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ligne(vue, "a.txt").click();
  expect(choisies(vue)).toEqual(["a.txt"]);
});

test("REQ049_AC5_nouveau_fichier_d_apres_la_derniere_ligne", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("m.rs")] };
  const { vue } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  ctrl(vue, "a.txt");
  ctrl(vue, "src/m.rs");
  bouton(vue, "Nouveau fichier").click();
  expect(document.querySelector("dialog input").value).toBe("src/");
  [...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Annuler").click();
  ctrl(vue, "src/m.rs"); // la ligne sort, mais reste la dernière cliquée
  expect(choisies(vue)).toEqual(["src", "a.txt"]);
  bouton(vue, "Nouveau dossier").click();
  expect(document.querySelector("dialog input").value).toBe("src/");
});

test("REQ049_AC6_relecture_garde_la_selection_et_retire_la_disparue", async () => {
  const disque = { "": [f("a.txt"), f("b.txt"), f("c.txt")] };
  const { vue } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ctrl(vue, "c.txt");
  disque[""] = [f("a.txt"), f("c.txt"), f("z.txt")];
  await vue.relire();
  expect(choisies(vue)).toEqual(["a.txt", "c.txt"]);
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  disque[""] = [f("c.txt"), f("z.txt")];
  await vue.relire();
  expect(choisies(vue)).toEqual(["c.txt"]);
  expect(bouton(vue, "Renommer").disabled).toBe(false);
  disque[""] = [f("z.txt")];
  await vue.relire();
  expect(choisies(vue)).toEqual([]);
  expect(bouton(vue, "Renommer").disabled).toBe(true);
});

test("REQ049_AC9_AC10_f2_vise_la_ligne_selectionnee_pas_le_focus", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt"), f("c.txt")] });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ctrl(vue, "b.txt");
  const b = ligne(vue, "b.txt");
  expect(b.getAttribute("aria-selected")).toBe("false");
  expect(document.activeElement).toBe(b);
  touche(vue, "b.txt", "F2");
  expect(document.querySelector("dialog input").value).toBe("a.txt");
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

test("REQ049_AC10_sans_selection_f2_et_suppr_ne_font_rien_entree_active", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("m.rs")] };
  const { vue } = await monter(disque);
  expect(choisies(vue)).toEqual([]);
  touche(vue, "a.txt", "F2");
  touche(vue, "a.txt", "Delete");
  expect(document.querySelector("dialog[open]")).toBeNull();
  touche(vue, "src", "Enter");
  await attendre();
  expect(choisies(vue)).toEqual(["src"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("true");
});

test("REQ049_AC11_ligne_masquee_par_gauche_sort", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("m.rs")] };
  const { vue } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  ctrl(vue, "src"); // src sort de la sélection
  ctrl(vue, "src/m.rs");
  ctrl(vue, "a.txt");
  expect(choisies(vue)).toEqual(["src/m.rs", "a.txt"]);
  touche(vue, "src", "ArrowLeft");
  expect(noms(vue)).toEqual(["src", "a.txt"]);
  expect(choisies(vue)).toEqual(["a.txt"]);
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

test("REQ049_presser_sans_relacher_garde_la_selection", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt"), f("c.txt")] });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ligne(vue, "c.txt").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  ligne(vue, "c.txt").focus(); // le navigateur donne le focus dès le mousedown
  expect(choisies(vue)).toEqual(["a.txt", "b.txt"]);
});

test("REQ049_focus_du_pointeur_ne_selectionne_pas_mais_tab_selectionne_si_rien_ne_l_est", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt")] });
  ligne(vue, "a.txt").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  ligne(vue, "a.txt").focus();
  expect(choisies(vue)).toEqual([]);
  await attendre();
  ligne(vue, "b.txt").focus();
  expect(choisies(vue)).toEqual(["b.txt"]);
});
