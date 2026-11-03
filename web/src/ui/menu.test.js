import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { liste } from "./liste.js";
import { menu, placer } from "./menu.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};

let ouverts = [];
afterEach(() => {
  for (const m of ouverts) m.fermer();
  ouverts = [];
  // Un pointerdown nettoie un intercepteur de clic resté en place.
  evt(document.body, "pointerdown");
  document.body.replaceChildren();
});

// jsdom n'a pas PointerEvent : on pose `button` sur un Event ordinaire.
function evt(cible, type, { button = 0, ...autres } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperties(e, { button: { value: button }, clientX: { value: 0 }, clientY: { value: 0 } });
  Object.assign(e, autres);
  cible.dispatchEvent(e);
  return e;
}
const cle = (cible, key, init = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  cible.dispatchEvent(e);
  return e;
};

function ouvrir({ surChoix = vi.fn(), surFermeture = vi.fn(), groupes } = {}) {
  const m = menu({
    nom: "Actions sur src/main.rs",
    position: { x: 10, y: 10 },
    surFermeture,
    groupes: groupes ?? [
      [{ libelle: "Nouveau fichier", icone: "file-plus", couleurIcone: "creer", surChoix: () => surChoix("nf") }, { libelle: "Nouveau dossier", icone: "folder-plus", couleurIcone: "creer", surChoix: () => surChoix("nd") }],
      [{ libelle: "Renommer", icone: "pencil", touche: "F2", surChoix: () => surChoix("r") }, { libelle: "Supprimer", icone: "trash-2", couleurIcone: "supprimer", touche: "Suppr", surChoix: () => surChoix("s") }],
      [],
      [{ libelle: "Commit", icone: "git-commit-horizontal", surChoix: () => surChoix("c") }],
    ],
  });
  ouverts.push(m);
  return { m, surChoix, surFermeture, items: [...m.racine.querySelectorAll('[role="menuitem"]')] };
}

test("REQ034_AC14_structure_role_menu_nom_commandes_icone_masquee_separateurs", () => {
  const { m, items } = ouvrir();
  expect(m.racine.getAttribute("role")).toBe("menu");
  expect(m.racine.getAttribute("aria-label")).toBe("Actions sur src/main.rs");
  expect(m.racine.getAttribute("popover")).toBe("manual");
  expect(items.map((i) => i.querySelector(".menu-libelle").textContent)).toEqual(["Nouveau fichier", "Nouveau dossier", "Renommer", "Supprimer", "Commit"]);
  expect(items.every((i) => i.tabIndex === -1 && i.querySelector("svg").getAttribute("aria-hidden") === "true")).toBe(true);
  // Trois groupes pleins, un groupe vide : deux séparateurs seulement, aux bons endroits.
  expect([...m.racine.children].map((c) => c.getAttribute("role"))).toEqual(["menuitem", "menuitem", "separator", "menuitem", "menuitem", "separator", "menuitem"]);
  const touches = [...m.racine.querySelectorAll(".menu-touche")];
  expect(touches.map((t) => t.textContent)).toEqual(["F2", "Suppr"]);
  expect(touches.every((t) => t.getAttribute("aria-hidden") === "true")).toBe(true);
  expect(items[0].querySelector(".menu-icone").className).toContain("bouton-icone-creer");
  expect(items[3].querySelector(".menu-icone").className).toContain("bouton-icone-supprimer");
  expect(items[4].querySelector(".menu-icone").className).toContain("bouton-icone-naviguer");
  expect(document.body.contains(m.racine)).toBe(true);
});

test("REQ034_AC14_style_par_tokens", () => {
  const r = regle(".menu");
  for (const t of ["var(--surface)", "var(--largeur-menu-min)", "var(--rayon-petit)", "var(--ombre-dialogue)", "var(--bordure-champ)"]) expect(r).toContain(t);
  expect(regle(".menu-commande")).toContain("height: var(--hauteur-ligne)");
  expect(regle(".menu-commande")).toContain("padding: 0 var(--esp-3)");
  expect(regle(".menu-commande")).not.toContain("margin");
  expect(regle(".menu-commande:hover")).toContain("background: var(--surface-haute)");
  expect(regle(".menu-commande:focus-visible")).toContain("var(--trait-fort) solid var(--accent-fg)");
  expect(regle(".menu-touche")).toContain("color: var(--texte-attenue)");
});

test("REQ034_AC11_le_focus_va_sur_la_premiere_commande_fleches_en_boucle_debut_fin", () => {
  const { m, items } = ouvrir();
  expect(document.activeElement).toBe(items[0]);
  cle(items[0], "ArrowUp");
  expect(document.activeElement).toBe(items[4]);
  cle(items[4], "ArrowDown");
  expect(document.activeElement).toBe(items[0]);
  cle(items[0], "ArrowDown");
  expect(document.activeElement).toBe(items[1]);
  cle(items[1], "End");
  expect(document.activeElement).toBe(items[4]);
  cle(items[4], "Home");
  expect(document.activeElement).toBe(items[0]);
  expect(m.racine.isConnected).toBe(true);
});

test("REQ034_AC11_Entree_et_Espace_activent_la_commande_au_clavier", () => {
  for (const touche of ["Enter", " "]) {
    const { items, surChoix } = ouvrir();
    cle(items[0], "ArrowDown");
    cle(items[1], touche);
    expect(surChoix).toHaveBeenCalledTimes(1);
    expect(surChoix).toHaveBeenCalledWith("nd");
  }
});

test("C013_une_commande_n_agit_qu_au_click_du_bouton_principal", () => {
  const { items, surChoix } = ouvrir();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "contextmenu", "auxclick"]) evt(items[2], type, { button: 2 });
  evt(items[2], "pointerdown");
  evt(items[2], "mouseup");
  evt(items[2], "click", { button: 2 });
  expect(surChoix).not.toHaveBeenCalled();
  evt(items[2], "click", { button: 0 });
  expect(surChoix).toHaveBeenCalledWith("r");
});

test("C013_le_menu_se_ferme_avant_surChoix_et_rend_d_abord_le_focus", () => {
  const origine = document.createElement("button");
  document.body.append(origine);
  origine.focus();
  const vus = [];
  const { m, items, surFermeture } = ouvrir({ surChoix: () => vus.push([m.racine.isConnected, document.activeElement === origine, surFermeture.mock.calls.length]) });
  expect(document.activeElement).toBe(items[0]);
  items[0].click();
  expect(vus).toEqual([[false, true, 1]]);
});

test("REQ034_AC10_Echap_Tab_perte_de_focus_et_redimensionnement_ferment_sans_rien_faire", () => {
  const origine = document.createElement("button");
  document.body.append(origine);
  const fermetures = [
    () => cle(document.activeElement, "Escape"),
    () => cle(document.activeElement, "Tab"),
    () => window.dispatchEvent(new Event("blur")),
    () => window.dispatchEvent(new Event("resize")),
  ];
  for (const fermer of fermetures) {
    origine.focus();
    const { m, surChoix, surFermeture } = ouvrir();
    fermer();
    expect(m.racine.isConnected).toBe(false);
    expect(surChoix).not.toHaveBeenCalled();
    expect(surFermeture).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(origine);
  }
});

test("REQ034_AC10_un_seul_menu_a_la_fois", () => {
  const a = ouvrir();
  const b = ouvrir();
  expect(a.m.racine.isConnected).toBe(false);
  expect(a.surFermeture).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll(".menu").length).toBe(1);
  expect(b.m.racine.isConnected).toBe(true);
});

test("REQ034_AC10_clic_ailleurs_ferme_sans_agir_dessous_et_sans_donner_le_focus", () => {
  const dessous = document.createElement("button");
  document.body.append(dessous);
  const recu = vi.fn();
  for (const t of ["pointerdown", "mousedown", "click"]) dessous.addEventListener(t, recu);
  const { m, surChoix, surFermeture } = ouvrir();
  const pd = evt(dessous, "pointerdown");
  expect(pd.defaultPrevented).toBe(true);
  expect(m.racine.isConnected).toBe(false);
  expect(surFermeture).toHaveBeenCalledTimes(1);
  const md = evt(dessous, "mousedown");
  expect(md.defaultPrevented).toBe(true);
  evt(dessous, "mouseup");
  const c = evt(dessous, "click");
  expect(c.defaultPrevented).toBe(true);
  expect(recu).not.toHaveBeenCalled();
  expect(surChoix).not.toHaveBeenCalled();
});

test("C013_l_intercepteur_de_click_est_retire_au_pointerdown_suivant", () => {
  const dessous = document.createElement("button");
  document.body.append(dessous);
  ouvrir();
  evt(dessous, "pointerdown");
  // Pas de click (glisser, par exemple) ; le clic suivant commence par un pointerdown.
  const recu = vi.fn();
  dessous.addEventListener("click", recu);
  evt(dessous, "pointerdown");
  evt(dessous, "click");
  expect(recu).toHaveBeenCalledTimes(1);
});

test("C013_l_intercepteur_n_avale_qu_un_seul_click", () => {
  const dessous = document.createElement("button");
  document.body.append(dessous);
  ouvrir();
  evt(dessous, "pointerdown");
  evt(dessous, "click");
  const recu = vi.fn();
  dessous.addEventListener("click", recu);
  evt(dessous, "click");
  expect(recu).toHaveBeenCalledTimes(1);
});

test("C013_clic_dans_le_menu_sur_un_separateur_ne_le_ferme_pas", () => {
  const { m } = ouvrir();
  evt(m.racine.querySelector('[role="separator"]'), "pointerdown");
  expect(m.racine.isConnected).toBe(true);
});

test("C013_mousedown_seul_ailleurs_est_aussi_arrete", () => {
  const dessous = document.createElement("button");
  document.body.append(dessous);
  const recu = vi.fn();
  dessous.addEventListener("mousedown", recu);
  const { m } = ouvrir();
  const md = evt(dessous, "mousedown");
  expect(md.defaultPrevented).toBe(true);
  expect(recu).not.toHaveBeenCalled();
  expect(m.racine.isConnected).toBe(false);
});

// Clic droit sur une autre ligne, menu ouvert : l'ordre des événements change selon le système.
const ORDRES = {
  linux: ["pointerdown", "contextmenu", "pointerup"],
  windows: ["pointerdown", "pointerup", "contextmenu"],
};
for (const [systeme, ordre] of Object.entries(ORDRES)) {
  test(`REQ034_AC1_clic_droit_ailleurs_ouvre_le_menu_de_l_autre_ligne_ordre_${systeme}`, () => {
    const surChoix = vi.fn();
    const ouvertures = [];
    const l = liste({
      variante: "arbre",
      lignes: [{ id: "a", libelle: "a.rs" }, { id: "b", libelle: "b.rs" }],
      surMenu: (id) => {
        const r = ouvrir({ surChoix, surFermeture: () => ouvertures.push(`ferme ${id}`), groupes: [[{ libelle: `Cmd ${id}`, surChoix: () => surChoix(id) }]] });
        ouvertures.push(`ouvre ${id}`);
        return r;
      },
    });
    document.body.append(l);
    const [a, b] = [...l.querySelectorAll('[role="treeitem"]')];
    const clicDroit = (cible) => {
      for (const t of ordre) {
        if (t === "contextmenu") cible.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
        else evt(cible, t, { button: 2 });
      }
      evt(cible, "auxclick", { button: 2 });
    };
    clicDroit(a);
    expect(document.querySelectorAll(".menu").length).toBe(1);
    clicDroit(b);
    const menus = document.querySelectorAll(".menu");
    expect(menus.length).toBe(1);
    expect(menus[0].getAttribute("aria-label")).toBe("Actions sur src/main.rs");
    expect(menus[0].textContent).toBe("Cmd b");
    expect(ouvertures).toEqual(["ouvre a", "ferme a", "ouvre b"]);
    expect(surChoix).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(menus[0].querySelector('[role="menuitem"]'));
  });
}

test("REQ034_AC12_clic_droit_hors_de_l_arbre_n_est_pas_arrete_et_ferme_le_menu", () => {
  const ailleurs = document.createElement("div");
  document.body.append(ailleurs);
  const { m } = ouvrir();
  const pd = evt(ailleurs, "pointerdown", { button: 2 });
  expect(pd.defaultPrevented).toBe(false);
  const md = evt(ailleurs, "mousedown", { button: 2 });
  expect(md.defaultPrevented).toBe(false);
  const cm = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  ailleurs.dispatchEvent(cm);
  expect(cm.defaultPrevented).toBe(false);
  expect(m.racine.isConnected).toBe(false);
});

test("C013_position_pure_dans_la_fenetre_a_800_sur_480", () => {
  const f = { largeur: 800, hauteur: 480 };
  const t = { largeur: 180, hauteur: 200 };
  expect(placer({ x: 100, y: 50 }, t, f)).toEqual({ left: 100, top: 50 });
  // Au bord droit : retourné à gauche du point.
  expect(placer({ x: 790, y: 50 }, t, f)).toEqual({ left: 610, top: 50 });
  // Au bord bas : retourné au-dessus du point.
  expect(placer({ x: 100, y: 470 }, t, f)).toEqual({ left: 100, top: 270 });
  // Coin bas droit.
  expect(placer({ x: 799, y: 479 }, t, f)).toEqual({ left: 619, top: 279 });
  // Entier dans la fenêtre même si le retournement sort à gauche ou en haut.
  expect(placer({ x: 100, y: 5 }, { largeur: 900, hauteur: 600 }, f)).toEqual({ left: 0, top: 0 });
  expect(placer({ x: 0, y: 0 }, t, f)).toEqual({ left: 0, top: 0 });
});

test("C013_le_menu_est_place_par_style_a_l_ouverture", () => {
  const { m } = ouvrir();
  expect(m.racine.style.left).toBe("10px");
  expect(m.racine.style.top).toBe("10px");
});

test("C013_entrees_invalides_refusees", () => {
  const ok = { nom: "n", position: { x: 1, y: 1 }, surFermeture: () => {}, groupes: [[{ libelle: "a" }]] };
  expect(() => menu({ ...ok, nom: "" })).toThrow(/nom/);
  expect(() => menu({ ...ok, surFermeture: undefined })).toThrow(/surFermeture/);
  expect(() => menu({ ...ok, position: undefined })).toThrow(/position/);
  expect(() => menu({ ...ok, groupes: [[{ libelle: "" }]] })).toThrow(/libelle/);
  expect(() => menu({ ...ok, groupes: [[{ libelle: "a", couleurIcone: "rouge" }]] })).toThrow(/couleurIcone/);
});

test("REQ034_AC11_contextmenu_sur_une_commande_n_ouvre_pas_le_menu_du_navigateur_ni_un_second_menu", () => {
  const { items } = ouvrir();
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0 });
  items[0].dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(document.querySelectorAll(".menu").length).toBe(1);
});
