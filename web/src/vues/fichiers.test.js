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
    if (typeof disque.attente === "function") await disque.attente(url);
    if (url.includes("/api/fichiers/renommer")) {
      const p = new URL(url, "http://x").searchParams;
      if (disque.coupure) throw new TypeError("réseau");
      const r = disque.renommer?.(p.get("de"), p.get("vers"));
      if (r) return { ok: false, status: r.status, json: async () => r.corps };
      return { ok: true, status: 200, json: async () => ({}) };
    }
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

// ---- REQ-050 : glisser-déposer ----

Element.prototype.scrollIntoView ??= function () {};

function fauxTransfert() {
  return { donnees: {}, effectAllowed: "", dropEffect: "", setData(t, v) { this.donnees[t] = v; }, setDragImage: vi.fn() };
}
function evt(type, cible) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = fauxTransfert();
  cible.dispatchEvent(e);
  return e;
}
/** Glisse la ligne `de` (avec la sélection si elle en fait partie) et dépose sur `sur` (un chemin, ou null pour la partie vide). */
async function glisser(vue, de, sur, { finir = true } = {}) {
  const e = evt("dragstart", ligne(vue, de));
  if (e.defaultPrevented) return e;
  evt("drop", sur === null ? vue.corps.querySelector("[role=tree]") : ligne(vue, sur));
  await attendre();
  await attendre();
  if (finir) evt("dragend", ligne(vue, de) ?? vue.corps.querySelector("[role=tree]"));
  return e;
}
/** Disque qui sait déplacer : le renommage met à jour les listes. */
function disqueMobile(initial) {
  const disque = { ...initial };
  disque.renommer = (de, vers) => {
    const dd = de.split("/").slice(0, -1).join("/");
    const vd = vers.split("/").slice(0, -1).join("/");
    const entree = disque[dd].find((x) => x.nom === de.split("/").pop());
    if (disque[vd].some((x) => x.nom === vers.split("/").pop())) return { status: 409, corps: { cause: "existe", message: "Ce nom est déjà pris. Choisissez-en un autre." } };
    disque[dd] = disque[dd].filter((x) => x !== entree);
    disque[vd] = [...disque[vd], { ...entree, nom: vers.split("/").pop() }].sort((x, y) => Number(y.dossier) - Number(x.dossier) || x.nom.localeCompare(y.nom));
    if (entree.dossier) {
      for (const k of Object.keys(disque)) if (k === de || k.startsWith(`${de}/`)) { disque[vers + k.slice(de.length)] = disque[k]; delete disque[k]; }
    }
  };
  return disque;
}
const appelsRenommer = (appels) => appels.filter((u) => u.includes("renommer")).map((u) => { const p = new URL(u, "http://x").searchParams; return `${p.get("de")}>${p.get("vers")}`; });

test("REQ050_AC1_deplace_deplie_selectionne", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt")], src: [f("main.rs")] });
  const { vue, dire, surRenomme } = await monter(disque, { surRenomme: vi.fn() });
  await glisser(vue, "a.txt", "src");
  expect(noms(vue)).toEqual(["src", "src/a.txt", "src/main.rs"]);
  expect(choisies(vue)).toEqual(["src/a.txt"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("true");
  expect(surRenomme).toHaveBeenCalledWith({ de: "a.txt", vers: "src/a.txt" });
  expect(dire).not.toHaveBeenCalled();
});

test("REQ050_AC2_AC3_selection_apres_depot", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt"), f("c.txt")], src: [] });
  const { vue } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "b.txt", "src");
  expect(choisies(vue)).toEqual(["src/a.txt", "src/b.txt"]);
  expect(noms(vue)).toEqual(["src", "src/a.txt", "src/b.txt", "c.txt"]);
  ctrl(vue, "c.txt");
  ctrl(vue, "src/a.txt");
  ligne(vue, "c.txt").click();
  await glisser(vue, "c.txt", "src");
  expect(choisies(vue)).toEqual(["src/c.txt"]);
  expect(noms(vue)).toContain("src/a.txt");
});

test("REQ050_AC4_racine", async () => {
  const disque = disqueMobile({ "": [d("src"), f("b.txt")], src: [f("a.txt")] });
  const { vue, appels } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  await glisser(vue, "src/a.txt", null);
  expect(appelsRenommer(appels)).toEqual(["src/a.txt>a.txt"]);
  expect(noms(vue)).toEqual(["src", "a.txt", "b.txt"]);
  expect(choisies(vue)).toEqual(["a.txt"]);
});

test("REQ050_AC5_dossier_garde_ses_sous_dossiers_deplies", async () => {
  const disque = disqueMobile({ "": [d("lib"), d("src")], lib: [d("sous")], "lib/sous": [f("x.txt")], src: [] });
  const { vue } = await monter(disque);
  ligne(vue, "lib").click();
  await attendre();
  ligne(vue, "lib/sous").click();
  await attendre();
  expect(noms(vue)).toEqual(["lib", "lib/sous", "lib/sous/x.txt", "src"]);
  await glisser(vue, "lib", "src");
  expect(noms(vue)).toEqual(["src", "src/lib", "src/lib/sous", "src/lib/sous/x.txt"]);
});

test("REQ050_AC6_surRenomme_pour_chaque_ligne", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue, surRenomme } = await monter(disque, { surRenomme: vi.fn() });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "a.txt", "src");
  expect(surRenomme.mock.calls.map((c) => c[0])).toEqual([{ de: "a.txt", vers: "src/a.txt" }, { de: "b.txt", vers: "src/b.txt" }]);
});

test("REQ050_AC7_ligne_deja_dans_le_dossier_sans_appel", async () => {
  const disque = disqueMobile({ "": [d("src"), f("b.txt")], src: [f("a.txt")] });
  const { vue, appels, dire } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  ctrl(vue, "src");
  ctrl(vue, "src/a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "b.txt", "src");
  expect(appelsRenommer(appels)).toEqual(["b.txt>src/b.txt"]);
  expect(dire).not.toHaveBeenCalled();
  expect(choisies(vue)).toEqual(["src/a.txt", "src/b.txt"]);
});

test("REQ050_AC10_AC21_refus_une_ligne_message_exact", async () => {
  const disque = disqueMobile({ "": [d("src"), d("lib"), f("a.txt"), f("b.txt")], src: [f("a.txt")], lib: [] });
  const { vue, dire } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "a.txt", "src");
  expect(dire).toHaveBeenCalledTimes(1);
  expect(dire.mock.calls[0][0]).toMatchObject({ texte: "a.txt n'a pas été déplacé : ce nom est déjà pris dans src/. Renommez-le, puis réessayez.", variante: "erreur", fermable: true });
  expect(dire.mock.calls[0][0].detail).toBeUndefined();
  expect(choisies(vue).sort()).toEqual(["a.txt", "src/b.txt"]);
  expect(document.activeElement.dataset.chemin).toBe("src/b.txt");
  // dossier refusé vers la racine
  disque.lib = [d("src")];
  disque["lib/src"] = [];
  ligne(vue, "lib").click();
  await attendre();
  dire.mockClear();
  await glisser(vue, "lib/src", null);
  expect(dire.mock.calls[0][0].texte).toBe("src/ n'a pas été déplacé : ce nom est déjà pris à la racine du projet. Renommez-le, puis réessayez.");
  // autre raison
  disque.renommer = () => ({ status: 403, corps: { cause: "interdit", message: "Ce dossier est protégé." } });
  dire.mockClear();
  await glisser(vue, "src/b.txt", "lib");
  expect(dire.mock.calls[0][0].texte).toBe("b.txt n'a pas été déplacé : Ce dossier est protégé.");
});

test("REQ050_AC21_refus_plusieurs_lignes_detail", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [f("a.txt"), f("b.txt")] });
  const { vue, dire } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ligne(vue, "b.txt").focus();
  await glisser(vue, "b.txt", "src");
  expect(dire.mock.calls[0][0]).toMatchObject({
    texte: "2 éléments n'ont pas été déplacés.",
    detail: "a.txt : ce nom est déjà pris dans src/\nb.txt : ce nom est déjà pris dans src/",
    variante: "erreur",
    fermable: true,
  });
  expect(choisies(vue)).toEqual(["a.txt", "b.txt"]);
  expect(document.activeElement.dataset.chemin).toBe("b.txt");
});

test("REQ050_AC11_coupure_arrete_la_boucle", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue, appels, dire } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  disque.coupure = true;
  await glisser(vue, "a.txt", "src");
  expect(appelsRenommer(appels)).toEqual(["a.txt>src/a.txt"]);
  expect(dire).toHaveBeenCalledTimes(1);
  expect(dire.mock.calls[0][0]).toMatchObject({ texte: "Connexion perdue. Réessayez au retour.", variante: "alerte" });
  expect(noms(vue)).toEqual(["src", "a.txt", "b.txt"]);
});

test("REQ050_AC13_pas_de_redessin_pendant_le_glisse_puis_mise_a_jour", async () => {
  const disque = disqueMobile({ "": [f("a.txt"), f("b.txt")] });
  const { vue } = await monter(disque);
  const avant = lignes(vue);
  evt("dragstart", ligne(vue, "a.txt"));
  disque[""] = [f("a.txt"), f("b.txt"), f("nouveau.txt")];
  await vue.relire();
  vue.definirCourant("b.txt");
  expect(lignes(vue)).toEqual(avant);
  expect(avant[0].isConnected).toBe(true);
  evt("dragend", avant[0]);
  await attendre();
  await attendre();
  expect(noms(vue)).toEqual(["a.txt", "b.txt", "nouveau.txt"]);
});

test("REQ050_AC20_focusin_pendant_le_glisse_ne_selectionne_rien", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt")] });
  evt("dragstart", ligne(vue, "a.txt")); // la liste donne le focus à la ligne saisie
  expect(document.activeElement.dataset.chemin).toBe("a.txt");
  evt("dragend", ligne(vue, "a.txt"));
  await attendre();
  expect(choisies(vue)).toEqual([]);
  expect(document.activeElement.dataset.chemin).toBe("a.txt");
});

test("REQ050_AC16_focus_sur_la_premiere_deplacee", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "b.txt", "src");
  expect(document.activeElement.dataset.chemin).toBe("src/a.txt");
});

test("REQ050_AC22_reussite_retire_le_message_precedent", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [f("a.txt")] });
  const bandeau = [];
  const dire = vi.fn(({ texte }) => {
    const m = document.createElement("div");
    m.textContent = texte;
    document.body.append(m);
    bandeau.push(m);
    return m;
  });
  const { vue } = await monter(disque, { dire });
  await glisser(vue, "a.txt", "src");
  expect(bandeau[0].isConnected).toBe(true);
  await glisser(vue, "b.txt", "src");
  expect(bandeau[0].isConnected).toBe(false);
  expect(dire).toHaveBeenCalledTimes(1);
});

test("REQ050_pas_de_glisse_pendant_les_deplacements", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue } = await monter(disque);
  let liberer;
  disque.attente = () => new Promise((r) => (liberer = r));
  evt("dragstart", ligne(vue, "a.txt"));
  const rendu = ligne(vue, "a.txt");
  evt("drop", ligne(vue, "src"));
  await attendre();
  const e = evt("dragstart", ligne(vue, "b.txt"));
  expect(e.defaultPrevented).toBe(true);
  disque.attente = null;
  liberer();
  await attendre();
  await attendre();
  expect(rendu).toBeTruthy();
  expect(e.defaultPrevented).toBe(true);
});

test("REQ050_relecture_croisee_jetee", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  let libererRelecture;
  let libererB;
  let relecturePrise = false;
  // La relecture lit l'arbre quand a.txt est déjà déplacé et que b.txt est en cours de déplacement.
  disque.attente = async (url) => {
    if (url.includes("/api/fichiers/renommer")) {
      if (url.includes("de=b.txt")) await new Promise((r) => (libererB = r));
    } else if (!relecturePrise) {
      relecturePrise = true;
      await new Promise((r) => (libererRelecture = r));
    }
  };
  const relecture = vue.relire();
  await attendre();
  evt("dragstart", ligne(vue, "a.txt"));
  evt("drop", ligne(vue, "src"));
  await attendre();
  await attendre();
  libererRelecture();
  await relecture;
  // Jetée : le focus n'a pas quitté a.txt, et rien n'est retiré de la sélection.
  expect(document.activeElement.dataset.chemin).toBe("a.txt");
  disque.attente = null;
  libererB();
  await attendre();
  await attendre();
  expect(choisies(vue)).toEqual(["src/a.txt", "src/b.txt"]);
  expect(document.activeElement.dataset.chemin).toBe("src/a.txt");
});

test("REQ070_AC1_menu_arbre_sans_git", async () => {
  const { vue } = await monter({ "": [f("a.txt")] }, { estDepot: () => false });
  ligne(vue, "a.txt").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  const libelles = [...document.querySelectorAll("[role=menu] [role=menuitem]")].map((e) => e.textContent);
  expect(libelles.length).toBeGreaterThan(0);
  expect(libelles.some((l) => l.startsWith("Indexer") || l.startsWith("Commit"))).toBe(false);
  expect(libelles.some((l) => l.startsWith("Renommer"))).toBe(true);
});
