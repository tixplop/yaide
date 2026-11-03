import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { liste } from "./liste.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};
const touche = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const lignes3 = [{ id: "a", libelle: "alpha" }, { id: "b", libelle: "beta" }, { id: "c", libelle: "gamma" }];
const items = (l) => [...l.querySelectorAll('[role="option"],[role="treeitem"]')];

test("REQ028_AC3_plate_listbox_et_options_un_seul_arret", () => {
  const l = liste({ lignes: lignes3, selection: "b" });
  expect(l.getAttribute("role")).toBe("listbox");
  expect(items(l).map((x) => x.textContent)).toEqual(["alpha", "beta", "gamma"]);
  expect(items(l).map((x) => x.tabIndex)).toEqual([-1, 0, -1]);
  expect(items(l).map((x) => x.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  expect(items(l)[0].title).toBe("alpha");
});

test("REQ028_AC3_sans_selection_la_premiere_ligne_est_l_arret", () => {
  expect(items(liste({ lignes: lignes3 })).map((x) => x.tabIndex)).toEqual([0, -1, -1]);
});

test("REQ028_AC3_fleches_debut_fin_et_entree", () => {
  const surActiver = vi.fn();
  const l = liste({ lignes: lignes3, surActiver });
  document.body.append(l);
  const [a, b, c] = items(l);
  a.focus();
  touche(a, "ArrowDown");
  expect(document.activeElement).toBe(b);
  expect(b.tabIndex).toBe(0);
  expect(a.tabIndex).toBe(-1);
  touche(b, "End");
  expect(document.activeElement).toBe(c);
  touche(c, "ArrowDown");
  expect(document.activeElement).toBe(c);
  touche(c, "Home");
  expect(document.activeElement).toBe(a);
  touche(a, "ArrowUp");
  expect(document.activeElement).toBe(a);
  touche(b, "Enter");
  expect(surActiver).toHaveBeenCalledWith("b");
  items(l)[2].click();
  expect(surActiver).toHaveBeenCalledWith("c");
});

test("REQ028_AC3_groupes_non_selectionnables", () => {
  const l = liste({ lignes: [{ id: "g", libelle: "Modifiés", groupe: true }, { id: "a", libelle: "a.rs" }, { id: "b", libelle: "b.rs" }] });
  document.body.append(l);
  expect(items(l).length).toBe(2);
  expect(l.querySelector(".liste-groupe").textContent).toBe("Modifiés");
  items(l)[0].focus();
  touche(items(l)[0], "ArrowUp");
  expect(document.activeElement).toBe(items(l)[0]);
});

test("REQ028_AC3_secondaire_police_code_et_attenuee", () => {
  const l = liste({
    lignes: [{ id: "a", libelle: "a.rs", secondaire: "src", policeCode: true }, { id: "b", libelle: "b.log", attenuee: true }],
  });
  const [a, b] = items(l);
  expect(a.querySelector(".liste-secondaire").textContent).toBe("src");
  expect(a.classList.contains("liste-code")).toBe(true);
  expect(b.classList.contains("liste-attenuee")).toBe(true);
  expect(b.getAttribute("aria-label")).toBe("b.log, ignoré par git");
  expect(a.hasAttribute("aria-label")).toBe(false);
});

test("REQ028_AC3_action_de_ligne_bouton_discret_hors_tabulation", () => {
  const surClic = vi.fn();
  const l = liste({
    lignes: [{ id: "a", libelle: "a.rs", actionLigne: { libelle: "+", nomAccessible: "Indexer a.rs", touche: "S", surClic } }],
  });
  const li = items(l)[0];
  const b = li.querySelector("button");
  expect(b.classList.contains("bouton-discret")).toBe(true);
  expect(b.tabIndex).toBe(-1);
  expect(li.getAttribute("aria-keyshortcuts")).toBe("S");
  expect(li.firstElementChild).toBe(b);
  b.click();
  expect(surClic).toHaveBeenCalledWith("a");
});

const arbre = (extra = {}) =>
  liste({
    variante: "arbre",
    lignes: [
      { id: "src", libelle: "src", niveau: 0, enfants: true, ouvert: true },
      { id: "src/a.rs", libelle: "a.rs", niveau: 1 },
      { id: "doc", libelle: "doc", niveau: 0, enfants: true, ouvert: false },
    ],
    ...extra,
  });

test("REQ028_AC3_arbre_treeitem_expanded_marques_et_retrait", () => {
  const l = arbre();
  const [src, a, doc] = items(l);
  expect(l.getAttribute("role")).toBe("tree");
  expect(src.getAttribute("role")).toBe("treeitem");
  expect(src.getAttribute("aria-expanded")).toBe("true");
  expect(doc.getAttribute("aria-expanded")).toBe("false");
  expect(a.hasAttribute("aria-expanded")).toBe(false);
  const icones = (e) => [...e.querySelectorAll("svg")].map((x) => x.getAttribute("data-icone"));
  expect(icones(src)).toEqual(["chevron-down", "folder"]);
  expect(icones(doc)).toEqual(["chevron-right", "folder"]);
  expect(icones(a)).toEqual(["file"]);
  expect(src.textContent).toBe("src");
  expect(a.getAttribute("aria-level")).toBe("2");
  expect(a.style.getPropertyValue("--niveau")).toBe("1");
  expect(regle(".liste-ligne")).toContain("var(--niveau, 0) * var(--esp-4)");
});

test("REQ028_AC3_arbre_droite_ouvre_gauche_ferme_ou_remonte", () => {
  const surBasculer = vi.fn();
  const l = arbre({ surBasculer });
  document.body.append(l);
  const [src, a, doc] = items(l);
  touche(doc, "ArrowRight");
  expect(surBasculer).toHaveBeenLastCalledWith("doc", true);
  touche(doc, "ArrowLeft");
  expect(surBasculer).toHaveBeenCalledTimes(1);
  touche(src, "ArrowLeft");
  expect(surBasculer).toHaveBeenLastCalledWith("src", false);
  touche(src, "ArrowRight");
  expect(surBasculer).toHaveBeenCalledTimes(2);
  a.focus();
  touche(a, "ArrowLeft");
  expect(document.activeElement).toBe(src);
});

test("REQ028_AC3_pilotage_champ_activedescendant", () => {
  const champ = document.createElement("input");
  document.body.append(champ);
  const surActiver = vi.fn();
  const l = liste({ lignes: lignes3, pilotage: "champ", champ, selection: "a", surActiver });
  document.body.append(l);
  const [a, b] = items(l);
  expect(champ.getAttribute("aria-activedescendant")).toBe(a.id);
  expect(a.id).not.toBe("");
  expect(items(l).every((x) => x.tabIndex === -1)).toBe(true);
  expect(a.textContent.startsWith(">")).toBe(true);
  expect(b.textContent.startsWith(">")).toBe(false);
  champ.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(champ.getAttribute("aria-activedescendant")).toBe(b.id);
  expect(b.classList.contains("liste-courante")).toBe(true);
  expect(a.classList.contains("liste-courante")).toBe(false);
  expect(document.activeElement).not.toBe(b);
  champ.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(surActiver).toHaveBeenCalledWith("b");
});

test("REQ028_AC3_liste_erreurs", () => {
  expect(() => liste({ variante: "x", lignes: [] })).toThrow(/variante/);
  expect(() => liste({ pilotage: "champ", lignes: [] })).toThrow(/champ/);
  expect(() => liste({ lignes: [{ id: "a" }] })).toThrow(/libelle/);
  expect(items(liste({ lignes: [] })).length).toBe(0);
});

test("REQ028_AC7_style_liste_focus_accent_et_ellipse", () => {
  expect(regle(".liste-ligne:focus-visible")).toContain("outline: var(--trait-fort) solid var(--accent-fg)");
  expect(regle(".liste-ligne")).toContain("height: var(--hauteur-ligne)");
  expect(regle(".liste-ligne")).toContain("text-overflow: ellipsis");
  expect(regle('.liste-ligne[aria-selected="true"]')).toContain("var(--surface-haute)");
  expect(regle(".liste-attenuee")).toContain("font-style: italic");
});

test("REQ028_AC9_sans_selection_aucune_ligne_n_est_selectionnee_en_mode_focus", () => {
  const l = liste({ lignes: lignes3 });
  document.body.append(l);
  expect(items(l).map((x) => x.getAttribute("aria-selected"))).toEqual(["false", "false", "false"]);
  expect(items(l)[0].tabIndex).toBe(0);
  touche(items(l)[0], "ArrowDown");
  expect(items(l).map((x) => x.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
});

test("REQ028_AC23_touche_de_l_action_de_ligne_declenche_l_action", () => {
  const surClic = vi.fn();
  const l = liste({
    lignes: [{ id: "a", libelle: "a" }, { id: "b", libelle: "b", actionLigne: { libelle: "+", nomAccessible: "Indexer", touche: "S", surClic } }],
  });
  document.body.append(l);
  touche(items(l)[0], "s");
  expect(surClic).not.toHaveBeenCalled();
  touche(items(l)[1], "s");
  expect(surClic).toHaveBeenCalledWith("b");
});

test("REQ028_AC3_deux_listes_sur_le_meme_champ_seule_la_connectee_reagit", () => {
  const champ = document.createElement("input");
  document.body.append(champ);
  const ancien = vi.fn();
  const recent = vi.fn();
  const l1 = liste({ lignes: lignes3, pilotage: "champ", champ, surActiver: ancien });
  document.body.append(l1);
  l1.remove();
  const l2 = liste({ lignes: lignes3, pilotage: "champ", champ, surActiver: recent });
  document.body.append(l2);
  champ.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(recent).toHaveBeenCalledTimes(1);
  expect(ancien).not.toHaveBeenCalled();
});

test("REQ028_AC3_style_courante_et_polices_valides", () => {
  expect(regle(".liste-courante")).toContain("border-left: var(--trait-fort) solid var(--accent-fg)");
  expect(regle(".liste-groupe")).toContain("font: var(--texte-petit) var(--police-ui)");
  expect(css).not.toMatch(/font-size:\s*var\(--texte/);
});

test("REQ033_AC5_arbre_dossier_fichier_et_ignore_ont_leurs_icones_et_couleurs", () => {
  const l = arbre({ lignes: [
    { id: "d", libelle: "d", enfants: true, ouvert: false },
    { id: "f", libelle: "f" },
    { id: "i", libelle: "i", attenuee: true },
  ] });
  const [d, f, i] = items(l);
  expect(d.querySelector(".liste-icone").classList.contains("liste-dossier")).toBe(true);
  expect(f.querySelector(".liste-icone").classList.contains("liste-fichier")).toBe(true);
  expect(f.querySelector(".liste-chevron svg")).toBeNull();
  expect(i.classList.contains("liste-attenuee")).toBe(true);
  expect(regle(".liste-dossier")).toContain("color: var(--icone-dossier)");
  expect(regle(".liste-fichier")).toContain("color: var(--texte-attenue)");
  expect(regle(".liste-attenuee")).toContain("font-style: italic");
});

test("REQ033_AC2_secondaire_prend_sa_couleur_et_sa_graisse", () => {
  const l = liste({ lignes: [{ id: "a", libelle: "a", secondaire: "indexé", couleurSecondaire: "succes", secondaireFort: true }, { id: "b", libelle: "b", secondaire: "nouveau" }] });
  const [a, b] = [...l.querySelectorAll(".liste-secondaire")];
  expect(a.style.getPropertyValue("--couleur-secondaire")).toBe("var(--succes)");
  expect(a.classList.contains("liste-secondaire-fort")).toBe(true);
  expect(b.style.getPropertyValue("--couleur-secondaire")).toBe("");
  expect(regle(".liste-secondaire")).toContain("color: var(--couleur-secondaire, var(--texte-attenue))");
  expect(regle(".liste-secondaire-fort")).toContain("font-weight: var(--graisse-forte)");
  expect(() => liste({ lignes: [{ id: "a", libelle: "a", secondaire: "x", couleurSecondaire: "red; x" }] })).toThrow(/couleurSecondaire/);
});

test("REQ031_AC1_action_de_ligne_a_icone_sans_texte_avec_info_bulle", () => {
  const surClic = vi.fn();
  const l = liste({ lignes: [{ id: "a", libelle: "a.rs", actionLigne: { icone: "plus", nomAccessible: "Indexer a.rs", infoBulle: "Indexer", touche: "I", surClic } }] });
  document.body.append(l);
  const b = l.querySelector("button");
  expect(b.textContent).toBe("");
  expect(b.getAttribute("aria-label")).toBe("Indexer a.rs");
  expect(b.tabIndex).toBe(-1);
  expect(b.classList.contains("ya-icon-btn-ligne")).toBe(true);
  expect(b.parentElement.classList.contains("bouton-enveloppe")).toBe(true);
  b.click();
  expect(surClic).toHaveBeenCalledWith("a");
});

test("REQ033_AC12_dossier_ignore_a_son_icone_et_son_nom_en_texte_attenue", () => {
  const l = arbre({ lignes: [{ id: "n", libelle: "node_modules", enfants: true, ouvert: false, attenuee: true }, { id: "s", libelle: "src", enfants: true, ouvert: false }] });
  const [n, s] = items(l);
  expect(n.classList.contains("liste-attenuee")).toBe(true);
  expect(n.querySelector(".liste-icone svg").getAttribute("data-icone")).toBe("folder");
  expect(s.classList.contains("liste-attenuee")).toBe(false);
  expect(regle(".liste-attenuee .liste-icone")).toContain("color: var(--texte-attenue)");
  expect(regle(".liste-attenuee")).toContain("color: var(--texte-attenue)");
  // Le sélecteur de l'icône ignorée bat celui du dossier (même règle, plus spécifique).
  expect(css.indexOf(".liste-attenuee .liste-icone")).toBeGreaterThan(css.indexOf(".liste-dossier {"));
});

test("REQ023_AC6_clic_sur_une_action_de_ligne_desactivee_n_active_pas_la_ligne", () => {
  const surActiver = vi.fn();
  const l = liste({ lignes: [{ id: "a", libelle: "a.rs", actionLigne: { icone: "plus", nomAccessible: "Indexer a.rs", surClic: vi.fn() } }], surActiver });
  document.body.append(l);
  const b = l.querySelector("button");
  b.disabled = true;
  // pointer-events: none renvoie le clic à l'enveloppe, puis à la ligne.
  b.parentElement.click();
  expect(surActiver).not.toHaveBeenCalled();
  l.querySelector(".liste-libelle").click();
  expect(surActiver).toHaveBeenCalledWith("a");
});

function avecMenu(lignes, surMenu) {
  const l = liste({ variante: "arbre", lignes, surMenu });
  document.body.append(l);
  return l;
}
const clicDroit = (el, x = 10, y = 20) => {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
  el.dispatchEvent(e);
  return e;
};
const lignesMenu = [{ id: "a", libelle: "a.rs" }, { id: "b", libelle: "b.rs" }, { id: "c", libelle: "c.rs", sansMenu: true }];

test("REQ034_AC1_clic_droit_marque_la_ligne_la_focalise_et_appelle_surMenu_sans_menu_du_navigateur", () => {
  const surMenu = vi.fn();
  const surActiver = vi.fn();
  const l = liste({ variante: "arbre", lignes: lignesMenu, surMenu, surActiver });
  document.body.append(l);
  const [, b] = items(l);
  const e = clicDroit(b, 33, 44);
  expect(e.defaultPrevented).toBe(true);
  expect(surMenu).toHaveBeenCalledTimes(1);
  expect(surMenu).toHaveBeenCalledWith("b", { x: 33, y: 44 });
  expect(b.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(b);
  expect(surActiver).not.toHaveBeenCalled();
});

test("REQ034_AC14_lignes_avec_aria_haspopup_menu_sauf_sansMenu", () => {
  const l = avecMenu(lignesMenu, vi.fn());
  expect(items(l).map((x) => x.getAttribute("aria-haspopup"))).toEqual(["menu", "menu", null]);
});

test("REQ034_AC1_ligne_sansMenu_laisse_remonter_l_evenement_a_son_parent", () => {
  const surMenu = vi.fn();
  const l = avecMenu(lignesMenu, surMenu);
  const parent = vi.fn();
  document.body.addEventListener("contextmenu", parent, { once: true });
  const e = clicDroit(items(l)[2]);
  expect(parent).toHaveBeenCalledTimes(1);
  expect(surMenu).not.toHaveBeenCalledWith("c", expect.anything());
  expect(e.defaultPrevented).toBe(true);
});

test("REQ034_AC2_clic_droit_dans_la_partie_vide_appelle_surMenu_sans_ligne", () => {
  const surMenu = vi.fn();
  const l = avecMenu(lignesMenu, surMenu);
  const e = clicDroit(l, 5, 6);
  expect(e.defaultPrevented).toBe(true);
  expect(surMenu).toHaveBeenCalledTimes(1);
  expect(surMenu).toHaveBeenCalledWith(undefined, { x: 5, y: 6 });
});

test("REQ034_AC11_touches_Menu_et_Maj_F10_ouvrent_sous_le_nom_de_la_ligne", () => {
  for (const init of [{ key: "ContextMenu" }, { key: "F10", shiftKey: true }]) {
    const surMenu = vi.fn();
    const l = avecMenu(lignesMenu, surMenu);
    const [a] = items(l);
    a.getBoundingClientRect = () => ({ left: 0, bottom: 48 });
    a.querySelector(".liste-libelle").getBoundingClientRect = () => ({ left: 40 });
    a.focus();
    const e = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    a.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(surMenu).toHaveBeenCalledWith("a", { x: 40, y: 48 });
    expect(a.getAttribute("aria-selected")).toBe("true");
    l.remove();
  }
});

test("REQ034_AC11_F10_sans_Maj_et_ligne_sansMenu_n_ouvrent_rien", () => {
  const surMenu = vi.fn();
  const l = avecMenu(lignesMenu, surMenu);
  touche(items(l)[0], "F10");
  items(l)[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }));
  expect(surMenu).not.toHaveBeenCalled();
});

test("REQ034_AC11_une_seule_ouverture_si_contextmenu_suit_la_touche", () => {
  const surMenu = vi.fn();
  const l = avecMenu(lignesMenu, surMenu);
  const [a] = items(l);
  a.focus();
  a.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }));
  a.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0 }));
  expect(surMenu).toHaveBeenCalledTimes(1);
  // Un vrai clic droit (bouton 2) juste après la touche compte.
  clicDroit(a);
  expect(surMenu).toHaveBeenCalledTimes(2);
});

test("REQ034_AC1_menu_sans_surMenu_ou_en_variante_plate", () => {
  const l = liste({ variante: "arbre", lignes: lignesMenu });
  expect(items(l).map((x) => x.getAttribute("aria-haspopup"))).toEqual([null, null, null]);
  const e = clicDroit(items(l)[0]);
  expect(e.defaultPrevented).toBe(false);
  expect(() => liste({ lignes: lignesMenu, surMenu: vi.fn() })).toThrow(/arbre/);
});
