import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { icone } from "./icones.js";
import { infoBulle } from "./info-bulle.js";
import { iconeDe, liste } from "./liste.js";

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

test("REQ028_AC3_dossier_police_code_et_ignore", () => {
  const l = liste({
    lignes: [{ id: "a", libelle: "a.rs", dossier: "src", policeCode: true }, { id: "b", libelle: "b.log", ignore: true }],
  });
  const [a, b] = items(l);
  expect(a.querySelector(".liste-parent").textContent).toBe("src");
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
  expect(icones(src)).toEqual(["chevron", "folder"]);
  expect(icones(doc)).toEqual(["chevron", "folder"]);
  expect(icones(a)).toEqual(["file"]);
  expect(src.textContent).toBe("src");
  expect(a.getAttribute("aria-level")).toBe("2");
  expect(a.style.getPropertyValue("--niveau")).toBe("1");
  expect(regle(".ya-tree .liste-ligne")).toContain("calc(6px + var(--niveau, 0) * var(--size-indent))");
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
  expect(a.textContent).not.toContain(">");
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
  expect(regle(".liste-ligne:focus-visible")).toContain("outline: var(--trait) solid var(--accent-fg)");
  expect(regle(".liste-ligne:focus-visible")).toContain("background: var(--list-focus)");
  expect(regle(".liste-ligne")).toContain("height: var(--size-row)");
  expect(regle(".liste-ligne")).toContain("text-overflow: ellipsis");
  expect(regle(".liste-ligne:hover")).toContain("background: var(--hover)");
  expect(regle('.liste-ligne[aria-selected="true"]')).toContain("background: var(--bg-400)");
  expect(regle('.liste:focus-within .liste-ligne[aria-selected="true"]')).toContain("background: var(--list-focus)");
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
  expect(regle(".liste-courante")).toContain("background: var(--list-focus)");
  expect(regle(".liste-courante")).toContain("outline: var(--trait) solid var(--accent-fg)");
  expect(regle(".liste-groupe")).toContain("font: var(--texte-petit) var(--font-sans)");
  expect(css).not.toMatch(/font-size:\s*var\(--texte/);
});

test("REQ033_AC5_arbre_dossier_fichier_et_ignore_ont_leurs_icones_et_couleurs", () => {
  const l = arbre({ lignes: [
    { id: "d", libelle: "d", enfants: true, ouvert: false },
    { id: "f", libelle: "f" },
    { id: "i", libelle: "i", ignore: true },
  ] });
  const [d, f, i] = items(l);
  expect(d.querySelector(".liste-icone").classList.contains("liste-dossier")).toBe(true);
  expect(f.querySelector(".liste-icone").classList.contains("liste-fichier")).toBe(true);
  expect(f.querySelector(".liste-chevron svg")).toBeNull();
  expect(i.classList.contains("liste-attenuee")).toBe(true);
  expect(regle(".liste-dossier")).toContain("color: var(--ink-muted)");
  expect(regle(".liste-fichier")).toContain("var(--ink-muted)");
  expect(regle(".liste-attenuee")).toContain("font-style: italic");
});

test("T039_les_options_secondaire_et_attenuee_n_existent_plus", () => {
  const l = liste({ lignes: [{ id: "a", libelle: "a", secondaire: "x", attenuee: true }] });
  expect(l.querySelector(".liste-secondaire")).toBeNull();
  expect(items(l)[0].classList.contains("liste-attenuee")).toBe(false);
  expect(css).not.toContain("liste-secondaire");
});

test("REQ037_AC8_groupe_de_resultats_icone_nom_dossier_et_compteur", () => {
  const l = liste({ lignes: [{ id: "g", libelle: "main.rs", dossier: "src", icone: "file-code", compteur: 2, groupe: true }, { id: "a", libelle: "fn main", numero: 4, trouve: [0, 7] }] });
  const g = l.querySelector(".liste-groupe");
  expect(g.querySelector(".liste-icone svg")).not.toBeNull();
  expect(g.querySelector(".liste-groupe-nom").textContent).toBe("main.rs");
  expect(g.querySelector(".liste-parent").textContent).toBe("src");
  expect(g.querySelector(".ya-badge").textContent).toBe("2");
  expect(items(l)).toHaveLength(1);
  expect(g.hasAttribute("tabindex")).toBe(false);
  const hit = items(l)[0];
  expect(hit.classList.contains("ya-hit")).toBe(true);
  expect(hit.querySelector("mark").textContent).toBe("fn main");
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
  const l = arbre({ lignes: [{ id: "n", libelle: "node_modules", enfants: true, ouvert: false, ignore: true }, { id: "s", libelle: "src", enfants: true, ouvert: false }] });
  const [n, s] = items(l);
  expect(n.classList.contains("liste-attenuee")).toBe(true);
  expect(n.querySelector(".liste-icone svg").getAttribute("data-icone")).toBe("folder");
  expect(s.classList.contains("liste-attenuee")).toBe(false);
  expect(regle(".liste-attenuee .liste-icone")).toContain("color: var(--git-ignored)");
  expect(regle(".liste-attenuee")).toContain("color: var(--git-ignored)");
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

test("REQ049_AC3_clic_droit_et_touche_Menu_sur_une_ligne_de_la_selection_la_gardent_entiere", () => {
  const surMenu = vi.fn();
  const l = liste({ variante: "arbre", multiple: true, lignes: lignesMenu, selection: ["a", "b"], surMenu });
  document.body.append(l);
  const [a, b] = items(l);
  clicDroit(b);
  expect(surMenu).toHaveBeenLastCalledWith("b", expect.anything());
  expect([a, b].map((x) => x.getAttribute("aria-selected"))).toEqual(["true", "true"]);
  expect(document.activeElement).toBe(b);
  a.getBoundingClientRect = () => ({ left: 0, bottom: 48 });
  a.querySelector(".liste-libelle").getBoundingClientRect = () => ({ left: 40 });
  a.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }));
  expect([a, b].map((x) => x.getAttribute("aria-selected"))).toEqual(["true", "true"]);
  expect(document.activeElement).toBe(a);
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

// C-006 : nouvelles options.
const nom = (e) => e.getAttribute("aria-label");

test("REQ039_AC8_lettre_de_statut_masquee_et_nom_accessible_avec_l_etat", () => {
  const l = liste({ variante: "arbre", lignes: [
    { id: "a", libelle: "a.rs", statut: "M" },
    { id: "b", libelle: "b.rs", statut: "A" },
    { id: "c", libelle: "c.rs", statut: "U" },
    { id: "d", libelle: "d.rs", statut: "D" },
    { id: "e", libelle: "e.rs", statut: "R" },
    { id: "f", libelle: "f.rs", statut: "C" },
    { id: "g", libelle: "g.rs", ignore: true },
    { id: "h", libelle: "h.rs" },
  ] });
  const it = items(l);
  expect(it.slice(0, 7).map(nom)).toEqual(["a.rs, modifié", "b.rs, ajouté", "c.rs, nouveau", "d.rs, supprimé", "e.rs, renommé", "f.rs, conflit", "g.rs, ignoré par git"]);
  expect(it[7].hasAttribute("aria-label")).toBe(false);
  const lettre = it[0].querySelector(".liste-statut");
  expect(lettre.textContent).toBe("M");
  expect(lettre.getAttribute("aria-hidden")).toBe("true");
  expect(it[6].classList.contains("liste-attenuee")).toBe(true);
  expect(() => liste({ lignes: [{ id: "a", libelle: "a", statut: "Z" }] })).toThrow(/statut/);
});

test("REQ039_AC8_couleurs_des_lettres_et_ligne_D_barree", () => {
  expect(regle(".liste-statut-A")).toContain("color: var(--git-added)");
  expect(regle(".liste-statut-M")).toContain("color: var(--git-modified)");
  expect(regle(".liste-statut-R")).toContain("color: var(--git-modified)");
  expect(regle(".liste-statut-D")).toContain("color: var(--git-deleted)");
  expect(regle(".liste-statut-U")).toContain("color: var(--git-untracked)");
  expect(regle(".liste-statut-C")).toContain("color: var(--git-conflict)");
  expect(regle(".liste-statut-D .liste-libelle")).toContain("text-decoration: line-through");
  expect(regle(".ya-tree .liste-statut")).toContain("width: 14px");
  expect(regle(".ya-tree .liste-statut")).toContain("font-family: var(--font-mono)");
});

test("C006_contraste_ligne_D_selectionnee_ignoree_survolee_et_marque_sur_bg_100", () => {
  expect(regle('.liste-statut-D[aria-selected="true"]')).toContain("color: var(--ink)");
  expect(regle(".liste-statut-D:focus-visible")).toContain("color: var(--ink)");
  expect(regle(".liste-statut-D .liste-libelle")).toContain("line-through");
  expect(regle(".liste-attenuee")).toContain("font-style: italic");
  expect(regle(".liste-attenuee:hover")).toContain("color: var(--ink-muted)");
  expect(regle('.liste-attenuee[aria-selected="true"]')).toContain("color: var(--ink-muted)");
  expect(regle('.ya-hit[aria-selected="true"] mark')).toContain("var(--bg-100)");
  expect(regle('.ya-hit[aria-selected="true"] .liste-numero')).toContain("color: var(--ink-muted)");
});

test("REQ039_AC8_statutDossier_point_masque_colore_sans_lettre_ni_barre", () => {
  const l = liste({ variante: "arbre", lignes: [{ id: "s", libelle: "src", enfants: true, ouvert: false, statutDossier: "M" }, { id: "t", libelle: "tmp", enfants: true, ouvert: false, statutDossier: "D" }] });
  const [s, t] = items(l);
  expect(s.querySelector(".liste-statut")).toBeNull();
  expect(s.querySelector(".liste-point").getAttribute("aria-hidden")).toBe("true");
  expect(nom(s)).toBe("src, modifié");
  expect(nom(t)).toBe("tmp, supprimé");
  expect(regle(".liste-sdossier-M")).toContain("color: var(--git-modified)");
  expect(regle(".liste-sdossier-D")).toContain("color: var(--git-deleted)");
  expect(regle(".ya-tree .liste-point")).toContain("width: 7px");
  expect(css).not.toMatch(/\.liste-sdossier-D[^{]*\.liste-libelle[^{]*{[^}]*line-through/);
  expect(() => liste({ lignes: [{ id: "a", libelle: "a", statutDossier: "R" }] })).toThrow(/statutDossier/);
});

test("C006_courant_dossier_parent_et_icone_choisie", () => {
  const l = liste({ lignes: [
    { id: "a", libelle: "main.rs", dossier: "src", courant: true, icone: "file-code", couleurIcone: "git-modified" },
    { id: "b", libelle: "lib.rs" },
  ] });
  const [a, b] = items(l);
  expect(a.getAttribute("aria-current")).toBe("true");
  expect(b.hasAttribute("aria-current")).toBe(false);
  expect(a.querySelector(".liste-parent").textContent).toBe("src");
  expect(b.querySelector(".liste-parent")).toBeNull();
  expect(a.querySelector(".liste-icone svg").getAttribute("data-icone")).toBe("file-code");
  expect(a.querySelector(".liste-icone").style.getPropertyValue("--couleur-icone")).toBe("var(--git-modified)");
  expect(regle('.liste-ligne[aria-current="true"]')).toContain("inset var(--trait-fort) 0 0 var(--accent-fg)");
  expect(() => liste({ lignes: [{ id: "a", libelle: "a", icone: "file", couleurIcone: "x; y" }] })).toThrow(/couleurIcone/);
});

test("C006_compteur_sur_une_ligne_groupe", () => {
  const l = liste({ lignes: [{ id: "g", libelle: "Modifications", groupe: true, compteur: 3 }, { id: "a", libelle: "a.rs" }] });
  const g = l.querySelector(".liste-groupe");
  expect(g.textContent).toBe("Modifications3");
  expect(g.querySelector(".ya-badge").textContent).toBe("3");
  expect(l.querySelector('[role="option"] .ya-badge')).toBeNull();
});

test("C006_lettre_de_statut_11_px_graisse_600", () => {
  expect(regle(".ya-tree .liste-statut")).toContain("font-size: 11px");
  expect(regle(".ya-tree .liste-statut")).toContain("font-weight: 600");
});

test("C006_resultat_de_recherche_numero_texte_mono_et_mark", () => {
  const l = liste({ lignes: [{ id: "r", libelle: "let main = 1;", numero: 12, trouve: [4, 8] }] });
  const [r] = items(l);
  expect(r.classList.contains("ya-hit")).toBe(true);
  expect(r.querySelector(".liste-numero").textContent).toBe("12");
  expect(r.querySelector("mark").textContent).toBe("main");
  expect(regle(".ya-hit")).toContain("padding-left: 24px");
  expect(regle(".ya-hit mark")).toContain("background: var(--find-match)");
  expect(regle(".ya-hit .liste-numero")).toContain("font-size: 11px");
  expect(regle(".ya-hit .liste-libelle")).toContain("font-family: var(--font-mono)");
});

test("C006_iconeDe_suit_la_table_du_design_system", () => {
  const t = (n) => iconeDe(n);
  for (const n of ["a.js", "a.JSX", "a.ts", "a.tsx"]) expect(t(n)).toEqual({ icone: "file-code", couleur: "accent-fg" });
  expect(t("a.css")).toEqual({ icone: "file-code", couleur: "git-modified" });
  expect(t("a.html")).toEqual({ icone: "file-code", couleur: "syn-keyword" });
  expect(t("a.HTM")).toEqual({ icone: "file-code", couleur: "syn-keyword" });
  for (const n of ["a.rs", "a.py", "a.go", "a.c", "a.h", "a.cpp", "a.sh"]) expect(t(n)).toEqual({ icone: "file-code", couleur: "ink-muted" });
  expect(t("README.md")).toEqual({ icone: "md", couleur: "ink-muted" });
  expect(t("a.markdown")).toEqual({ icone: "md", couleur: "ink-muted" });
  expect(t("package.json")).toEqual({ icone: "file", couleur: "syn-number" });
  for (const n of ["Makefile", ".gitignore", "a.txt", "archive.tar.gz", "a."]) expect(t(n)).toEqual({ icone: "file", couleur: "ink-muted" });
});

test("REQ022_AC6_ligne_indexee_ajoute_indexe_au_nom_accessible_et_l_info_bulle_est_libre", () => {
  const l = liste({ lignes: [{ id: "a", libelle: "a.rs", statut: "M", indexe: true, infoBulle: "src/a.rs, modifié, indexé" }, { id: "b", libelle: "b.rs", statut: "M" }] });
  const [a, b] = items(l);
  expect(nom(a)).toBe("a.rs, modifié, indexé");
  expect(a.title).toBe("src/a.rs, modifié, indexé");
  expect(nom(b)).toBe("b.rs, modifié");
  expect(b.title).toBe("b.rs");
});

const arbre5 = [
  { id: "a", libelle: "a.txt" },
  { id: "b", libelle: "b.txt", statut: "M" },
  { id: "c", libelle: "c.txt" },
  { id: "d", libelle: "d.txt" },
  { id: "e", libelle: "e.txt", sansMenu: true },
];
const multi = (extra = {}) => {
  const surSelection = vi.fn();
  const surActiver = vi.fn();
  const l = liste({ variante: "arbre", multiple: true, lignes: arbre5, surActiver, surSelection, ...extra });
  document.body.replaceChildren(l);
  return { l, surSelection, surActiver, el: items(l) };
};
const clic = (el, opts = {}) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...opts }));
const sel = (l) => items(l).filter((x) => x.getAttribute("aria-selected") === "true").map((x) => x.querySelector(".liste-libelle").textContent);

test("REQ049_AC1_ctrl_et_cmd_ajoutent_et_retirent_sans_activer", () => {
  const { l, surSelection, surActiver, el } = multi({ selection: ["a"] });
  clic(el[2], { ctrlKey: true });
  expect(sel(l)).toEqual(["a.txt", "c.txt"]);
  expect(surSelection).toHaveBeenLastCalledWith(["a", "c"], { ancre: "c", derniere: "c" });
  clic(el[1], { metaKey: true });
  expect(sel(l)).toEqual(["a.txt", "b.txt", "c.txt"]);
  clic(el[1], { metaKey: true });
  expect(sel(l)).toEqual(["a.txt", "c.txt"]);
  expect(surSelection).toHaveBeenLastCalledWith(["a", "c"], { ancre: "b", derniere: "b" });
  expect(surActiver).not.toHaveBeenCalled();
});

test("REQ049_AC2_maj_prend_la_plage_depuis_l_ancre", () => {
  const { l, surSelection, surActiver, el } = multi();
  clic(el[0]);
  clic(el[3], { shiftKey: true });
  expect(sel(l)).toEqual(["a.txt", "b.txt", "c.txt", "d.txt"]);
  expect(surSelection).toHaveBeenLastCalledWith(["a", "b", "c", "d"], { ancre: "a", derniere: "d" });
  expect(surActiver).toHaveBeenCalledTimes(1);
  clic(el[2]);
  clic(el[0], { shiftKey: true });
  expect(sel(l)).toEqual(["a.txt", "b.txt", "c.txt"]);
  // Après recréation, l'ancre revient par l'option.
  const r = multi({ selection: ["c"], ancre: "c" });
  clic(r.el[1], { shiftKey: true });
  expect(sel(r.l)).toEqual(["b.txt", "c.txt"]);
  expect(r.surSelection).toHaveBeenLastCalledWith(["b", "c"], { ancre: "c", derniere: "b" });
});

test("REQ049_AC3_clic_simple_et_fleches_ramenent_a_une_ligne", () => {
  const { l, surSelection, surActiver, el } = multi({ selection: ["a", "b", "c"] });
  clic(el[1]);
  expect(sel(l)).toEqual(["b.txt"]);
  expect(surActiver).toHaveBeenCalledWith("b");
  expect(surSelection).toHaveBeenLastCalledWith(["b"], { ancre: "b", derniere: "b" });
  const m = multi({ selection: ["a", "b", "c"] });
  m.el[1].focus();
  touche(m.el[1], "ArrowDown");
  expect(sel(m.l)).toEqual(["c.txt"]);
  expect(m.surSelection).toHaveBeenLastCalledWith(["c"], { ancre: "c", derniere: "c" });
  const n = multi({ selection: ["a", "b", "c"] });
  n.el[1].focus();
  touche(n.el[1], "ArrowUp");
  expect(sel(n.l)).toEqual(["a.txt"]);
  const o = multi({ selection: ["a", "b", "c"] });
  o.el[2].focus();
  touche(o.el[2], "Enter");
  expect(sel(o.l)).toEqual(["c.txt"]);
  expect(o.surActiver).toHaveBeenCalledWith("c");
});

test("REQ049_AC7_AC8_aria_et_coche_a_partir_de_deux", () => {
  const { l, el } = multi({ selection: ["a"] });
  expect(l.getAttribute("aria-multiselectable")).toBe("true");
  expect(el.map((x) => x.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"]);
  expect(l.querySelector(".liste-coche")).toBeNull();
  clic(el[1], { ctrlKey: true });
  const coches = [...l.querySelectorAll(".liste-coche")];
  expect(coches.length).toBe(2);
  expect(coches[0].getAttribute("aria-hidden")).toBe("true");
  expect(coches[0].querySelector("svg").getAttribute("data-icone")).toBe("check");
  expect(coches[0].querySelector("svg").getAttribute("width")).toBe("12");
  // La coche précède la lettre de statut.
  expect(el[1].querySelector(".liste-coche").nextElementSibling.className).toBe("liste-statut");
  // Ligne à point : la coche précède le point, dans l'ordre d'affichage aussi.
  const p = liste({ variante: "arbre", multiple: true, selection: ["d", "x"], lignes: [{ id: "d", libelle: "dir", enfants: true, statutDossier: "M" }, { id: "x", libelle: "x" }] });
  document.body.replaceChildren(p);
  expect(items(p)[0].querySelector(".liste-coche").nextElementSibling.className).toBe("liste-point");
  expect(regle(".ya-tree .liste-coche + .liste-point")).toContain("order: 2");
  clic(el[1], { ctrlKey: true });
  expect(l.querySelector(".liste-coche")).toBeNull();
  expect(items(liste({ variante: "arbre", lignes: arbre5 })).every((x) => x.getAttribute("aria-selected") === "false")).toBe(true);
});

test("REQ049_AC7_ligne_sans_menu_jamais_selectionnee", () => {
  const { l, surSelection, el } = multi({ selection: ["a", "e"] });
  expect(sel(l)).toEqual(["a.txt"]);
  clic(el[4], { ctrlKey: true });
  clic(el[4], { shiftKey: true });
  expect(sel(l)).toEqual(["a.txt"]);
  expect(surSelection).not.toHaveBeenCalled();
  clic(el[0]);
  clic(el[4]);
  expect(sel(l)).toEqual(["a.txt"]);
});

test("REQ049_AC9_focus_suit_le_ctrl_clic_et_regles_css", () => {
  const { l, el } = multi({ selection: ["a", "b", "c"] });
  clic(el[1], { ctrlKey: true });
  expect(document.activeElement).toBe(el[1]);
  expect(el[1].getAttribute("aria-selected")).toBe("false");
  expect(el.map((x) => x.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
  el[3].focus();
  expect(el.map((x) => x.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
  expect(sel(l)).toEqual(["a.txt", "c.txt"]);
  expect(regle('.liste[aria-multiselectable="true"] .liste-ligne')).toContain("user-select: none");
  expect(regle('.liste[aria-multiselectable="true"]:focus-within .liste-ligne[aria-selected="true"]:not(:focus)')).toContain("outline: none");
  expect(regle('.liste[aria-multiselectable="true"] .liste-ligne:focus')).toContain("outline: var(--trait) solid var(--accent-fg)");
  expect(regle('.liste[aria-multiselectable="true"] .liste-ligne:focus:not([aria-selected="true"])')).toContain("background: none");
  expect(regle(".ya-tree .liste-coche")).toContain("width: 14px");
  expect(regle(".ya-tree .liste-coche svg")).toContain("width: 12px");
});

const dossiers = [
  { id: "d", libelle: "dir", enfants: true, ouvert: true },
  { id: "d/x", libelle: "x", niveau: 1 },
  { id: "d/y", libelle: "y", niveau: 1 },
  { id: "z", libelle: "z" },
];

test("REQ049_AC11_debut_fin_et_gauche_ramenent_droite_garde", () => {
  const surBasculer = vi.fn();
  const surSelection = vi.fn();
  const l = liste({ variante: "arbre", multiple: true, lignes: dossiers, selection: ["d", "d/x", "z"], surBasculer, surSelection });
  document.body.replaceChildren(l);
  const el = items(l);
  el[1].focus();
  touche(el[1], "Home");
  expect(sel(l)).toEqual(["dir"]);
  touche(el[0], "End");
  expect(sel(l)).toEqual(["z"]);
  const m = liste({ variante: "arbre", multiple: true, lignes: dossiers, selection: ["d/x", "z"], surSelection });
  document.body.replaceChildren(m);
  items(m)[1].focus();
  touche(items(m)[1], "ArrowLeft");
  expect(sel(m)).toEqual(["dir"]);
  expect(surSelection).toHaveBeenLastCalledWith(["d"], { ancre: "d", derniere: "d" });
  // Droite garde ; Gauche qui replie garde les autres et retire les lignes masquées.
  const n = liste({ variante: "arbre", multiple: true, lignes: dossiers, selection: ["d", "d/x", "z"], surBasculer, surSelection });
  document.body.replaceChildren(n);
  items(n)[0].focus();
  touche(items(n)[0], "ArrowRight");
  expect(sel(n)).toEqual(["dir", "x", "z"]);
  touche(items(n)[0], "ArrowLeft");
  expect(surBasculer).toHaveBeenLastCalledWith("d", false);
  expect(sel(n)).toEqual(["dir", "z"]);
  expect(surSelection).toHaveBeenLastCalledWith(["d", "z"], { ancre: "d", derniere: "d" });
});

test("sans_multiple_selection_reste_un_id", () => {
  const l = liste({ variante: "arbre", lignes: arbre5, selection: "b" });
  expect(l.hasAttribute("aria-multiselectable")).toBe(false);
  expect(items(l).map((x) => x.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false", "false"]);
  expect(() => liste({ lignes: lignes3, multiple: true })).toThrow(/arbre/);
});

test("REQ049_AC3_clic_droit_menu_et_maj_f10_sur_une_ligne_hors_selection_ramenent_a_une_ligne", () => {
  const cas = {
    "clic droit": (el) => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 5, clientY: 6 })),
    Menu: (el) => touche(el, "ContextMenu"),
    "Maj+F10": (el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true })),
  };
  for (const [nom, geste] of Object.entries(cas)) {
    const surMenu = vi.fn();
    const { l, surSelection, el } = multi({ selection: ["a", "b", "c"], surMenu });
    el[3].focus();
    geste(el[3]);
    expect(sel(l), nom).toEqual(["d.txt"]);
    expect(surSelection, nom).toHaveBeenLastCalledWith(["d"], { ancre: "d", derniere: "d" });
    expect(surMenu, nom).toHaveBeenCalledTimes(1);
    expect(surMenu.mock.calls[0][0], nom).toBe("d");
  }
});

// Glisser-déposer : jsdom n'a pas de dataTransfer, on en pose un faux.
function fauxTransfert() {
  return { donnees: {}, effectAllowed: "", dropEffect: "", setData(t, v) { this.donnees[t] = v; }, setDragImage: vi.fn() };
}
function evt(type, cible, extra = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = extra.dt ?? fauxTransfert();
  if ("relatedTarget" in extra) Object.defineProperty(e, "relatedTarget", { value: extra.relatedTarget });
  cible.dispatchEvent(e);
  return e;
}
const lignesDepot = [
  { id: "src", libelle: "src", enfants: true, ouvert: true },
  { id: "src/a.txt", libelle: "a.txt", niveau: 1 },
  { id: "src/lib", libelle: "lib", niveau: 1, enfants: true, ouvert: true },
  { id: "src/lib/x.txt", libelle: "x.txt", niveau: 2 },
  { id: "doc", libelle: "doc", enfants: true, ouvert: true },
  { id: "chg", libelle: "Chargement…", niveau: 1, sansMenu: true },
  { id: "b.txt", libelle: "b.txt" },
  { id: "c.txt", libelle: "c.txt" },
];
function depot(options = {}, lignes = lignesDepot) {
  const surDepot = vi.fn();
  const surSelection = vi.fn();
  const surActiver = vi.fn();
  const surBasculer = vi.fn();
  const l = liste({ variante: "arbre", multiple: true, lignes, surDepot, surSelection, surActiver, surBasculer, ...options });
  document.body.append(l);
  const ligne = (id) => items(l)[lignes.filter((x) => !x.groupe).findIndex((x) => x.id === id)];
  return { l, surDepot, surSelection, surActiver, surBasculer, ligne };
}
const marques = (l) => items(l).filter((e) => e.hasAttribute("data-depot")).map((e) => e.querySelector(".liste-libelle").textContent);
const contenus = (l) => items(l).filter((e) => e.hasAttribute("data-depot-contenu")).map((e) => e.querySelector(".liste-libelle").textContent);

test("REQ050_AC14_AC17_draggable_type_unique_sans_text_plain", () => {
  const { l, ligne, surActiver, surBasculer } = depot();
  expect(items(l).map((e) => e.getAttribute("draggable"))).toEqual(["true", "true", "true", "true", "true", null, "true", "true"]);
  for (const id of ["b.txt", "src"]) {
    evt("dragstart", ligne(id));
    evt("dragover", ligne("doc"));
    evt("drop", ligne("doc"));
    evt("dragend", ligne(id));
  }
  expect(surActiver).not.toHaveBeenCalled();
  expect(surBasculer).not.toHaveBeenCalled();
  const dt = fauxTransfert();
  evt("dragstart", ligne("b.txt"), { dt });
  expect(dt.effectAllowed).toBe("move");
  expect(Object.keys(dt.donnees)).toEqual(["application/x-yaide-lignes"]);
  expect(dt.setDragImage).toHaveBeenCalledTimes(1);
  expect(dt.setDragImage.mock.calls[0][1]).toBe(12);
  expect(dt.setDragImage.mock.calls[0][2]).toBe(12);
  evt("dragend", ligne("b.txt"));
  expect(liste({ variante: "arbre", lignes: lignesDepot }).querySelector("[draggable]")).toBeNull();
});

test("REQ050_AC17_image_nom_ou_nombre", () => {
  const { l, ligne } = depot({ selection: ["src", "src/a.txt"] });
  const dt = fauxTransfert();
  evt("dragstart", ligne("src"), { dt });
  const image = dt.setDragImage.mock.calls[0][0];
  expect(image.textContent).toBe("src");
  expect(image.getAttribute("aria-hidden")).toBe("true");
  expect(image.isConnected).toBe(true);
  evt("dragend", ligne("src"));
  expect(image.isConnected).toBe(false);
  const d2 = depot({ selection: ["b.txt", "c.txt", "doc"] });
  const dt2 = fauxTransfert();
  evt("dragstart", d2.ligne("b.txt"), { dt: dt2 });
  expect(dt2.setDragImage.mock.calls[0][0].textContent).toBe("3 éléments");
  evt("dragend", d2.ligne("b.txt"));
  l.remove();
  d2.l.remove();
});

test("REQ050_AC4_cible_dossier_fichier_racine", () => {
  const { l, surDepot, ligne } = depot();
  evt("dragstart", ligne("b.txt"));
  const sur = (el) => {
    const o = evt("dragover", el);
    expect(o.defaultPrevented).toBe(true);
    evt("drop", el);
  };
  // Les écouteurs sont retirés au dépôt : on relance le glissé à chaque fois.
  sur(ligne("doc"));
  expect(surDepot).toHaveBeenLastCalledWith(["b.txt"], "doc", "b.txt");
  evt("dragstart", ligne("b.txt"));
  sur(ligne("src/a.txt"));
  expect(surDepot).toHaveBeenLastCalledWith(["b.txt"], "src", "b.txt");
  evt("dragstart", ligne("src/a.txt"));
  sur(ligne("c.txt"));
  expect(surDepot).toHaveBeenLastCalledWith(["src/a.txt"], undefined, "src/a.txt");
  evt("dragstart", ligne("src/a.txt"));
  sur(l);
  expect(surDepot).toHaveBeenLastCalledWith(["src/a.txt"], undefined, "src/a.txt");
});

test("REQ050_AC18_marques_dossier_replie_racine", () => {
  const { l, ligne } = depot();
  evt("dragstart", ligne("b.txt"));
  evt("dragover", ligne("src/a.txt"));
  expect(marques(l)).toEqual(["src"]);
  expect(contenus(l)).toEqual(["a.txt", "lib", "x.txt"]);
  expect(l.hasAttribute("data-depot")).toBe(false);
  evt("dragover", ligne("doc"));
  expect(marques(l)).toEqual(["doc"]);
  expect(contenus(l)).toEqual(["Chargement…"]);
  evt("dragend", ligne("b.txt"));
  evt("dragstart", ligne("src/a.txt"));
  evt("dragover", l);
  expect(l.hasAttribute("data-depot")).toBe(true);
  expect(marques(l)).toEqual([]);
  evt("dragover", ligne("c.txt"));
  expect(l.hasAttribute("data-depot")).toBe(true);
  expect(contenus(l)).toEqual([]);
  evt("dragend", ligne("src/a.txt"));
  const d = depot({}, [{ id: "a.txt", libelle: "a.txt" }, { id: "b.txt", libelle: "b.txt" }, { id: "d", libelle: "d", enfants: true }, { id: "z.txt", libelle: "z.txt" }]);
  evt("dragstart", d.ligne("a.txt"));
  evt("dragover", d.ligne("d"));
  expect(marques(d.l)).toEqual(["d"]);
  expect(contenus(d.l)).toEqual([]);
  expect(d.ligne("d").getAttribute("aria-expanded")).toBe("false");
  evt("dragend", d.ligne("a.txt"));
});

test("REQ050_AC18_marques_refaites_seulement_si_la_cible_change", () => {
  const { l, ligne } = depot();
  evt("dragstart", ligne("b.txt"));
  evt("dragover", ligne("doc"));
  ligne("doc").removeAttribute("data-depot");
  evt("dragover", ligne("doc"));
  expect(marques(l)).toEqual([]);
  evt("dragend", ligne("b.txt"));
});

test("REQ050_AC8_AC19_cibles_refusees_sans_preventDefault", () => {
  const { l, surDepot, ligne } = depot();
  const dehors = document.createElement("div");
  const ecouteur = vi.fn();
  dehors.addEventListener("dragover", ecouteur);
  document.body.append(dehors);
  // Le dossier lui-même, un sous-dossier : refus.
  evt("dragstart", ligne("src"));
  for (const el of [ligne("src"), ligne("src/lib"), ligne("src/lib/x.txt"), ligne("chg"), dehors]) {
    const o = evt("dragover", el);
    expect(o.defaultPrevented).toBe(false);
    expect(marques(l)).toEqual([]);
    expect(l.hasAttribute("data-depot")).toBe(false);
    evt("drop", el);
  }
  expect(ecouteur).not.toHaveBeenCalled();
  expect(surDepot).not.toHaveBeenCalled();
  evt("dragend", ligne("src"));
  // Le dossier actuel : refus (a.txt est déjà dans src, b.txt à la racine).
  evt("dragstart", ligne("src/a.txt"));
  expect(evt("dragover", ligne("src/lib")).defaultPrevented).toBe(true);
  expect(evt("dragover", ligne("src")).defaultPrevented).toBe(false);
  expect(evt("dragover", ligne("src/lib/x.txt")).defaultPrevented).toBe(true);
  evt("dragend", ligne("src/a.txt"));
  evt("dragstart", ligne("b.txt"));
  expect(evt("dragover", ligne("c.txt")).defaultPrevented).toBe(false);
  expect(evt("dragover", l).defaultPrevented).toBe(false);
  evt("dragend", ligne("b.txt"));
  dehors.remove();
});

test("REQ050_AC15_marques_retirees_a_la_sortie_et_a_dragend", () => {
  const { l, ligne } = depot();
  evt("dragstart", ligne("b.txt"));
  evt("dragover", ligne("doc"));
  evt("dragleave", ligne("doc"), { relatedTarget: ligne("src") });
  expect(marques(l)).toEqual(["doc"]);
  evt("dragleave", ligne("doc"), { relatedTarget: null });
  expect(marques(l)).toEqual([]);
  evt("dragover", ligne("doc"));
  expect(marques(l)).toEqual(["doc"]);
  evt("dragend", ligne("b.txt"));
  expect(marques(l)).toEqual([]);
  evt("dragstart", ligne("b.txt"));
  evt("dragover", ligne("src/a.txt"));
  expect(marques(l)).toEqual(["src"]);
  evt("drop", ligne("src/a.txt"));
  expect(marques(l)).toEqual([]);
  expect(contenus(l)).toEqual([]);
});

test("REQ050_AC2_AC3_lignes_a_deplacer", () => {
  const { surDepot, ligne, l } = depot({ selection: ["b.txt", "c.txt"] });
  evt("dragstart", ligne("c.txt"));
  evt("drop", ligne("doc"));
  expect(surDepot).toHaveBeenLastCalledWith(["b.txt", "c.txt"], "doc", "c.txt");
  evt("dragstart", ligne("src/a.txt"));
  evt("drop", ligne("doc"));
  expect(surDepot).toHaveBeenLastCalledWith(["src/a.txt"], "doc", "src/a.txt");
  l.remove();
});

test("REQ050_AC9_ligne_contenue_retiree", () => {
  const { surDepot, ligne } = depot({ selection: ["src", "src/a.txt", "src/lib/x.txt", "b.txt"] });
  evt("dragstart", ligne("src/a.txt"));
  evt("drop", ligne("doc"));
  expect(surDepot).toHaveBeenCalledWith(["src", "b.txt"], "doc", "src/a.txt");
});

test("REQ050_AC20_dragend_sans_depot_garde_la_selection", () => {
  const { l, surDepot, surSelection, ligne } = depot({ selection: ["b.txt", "c.txt", "src"] });
  evt("dragstart", ligne("doc"));
  expect(document.activeElement).toBe(ligne("doc"));
  evt("dragend", ligne("doc"));
  expect(surDepot).not.toHaveBeenCalled();
  expect(surSelection).not.toHaveBeenCalled();
  expect(items(l).filter((e) => e.getAttribute("aria-selected") === "true").map((e) => e.textContent)).toEqual(["src", "b.txt", "c.txt"]);
});

test("REQ050_ecouteurs_de_document_retires_a_dragend", () => {
  const ajouts = vi.spyOn(document, "addEventListener");
  const retraits = vi.spyOn(document, "removeEventListener");
  const { ligne } = depot();
  evt("dragstart", ligne("b.txt"));
  const poses = ajouts.mock.calls.filter(([t, , c]) => ["dragenter", "dragover", "drop"].includes(t) && c === true);
  expect(poses.map(([t]) => t).sort()).toEqual(["dragenter", "dragover", "drop"]);
  evt("dragend", ligne("b.txt"));
  for (const [t, f] of poses) expect(retraits).toHaveBeenCalledWith(t, f, true);
  ajouts.mockRestore();
  retraits.mockRestore();
});

test("REQ050_surDepot_demande_la_variante_arbre", () => {
  expect(() => liste({ lignes: lignes3, surDepot: () => {} })).toThrow(/surDepot/);
});

test("REQ050_AC17_dragstart_ferme_l_info_bulle_ouverte", () => {
  vi.useFakeTimers();
  const { ligne } = depot();
  const a = document.createElement("button");
  document.body.append(a);
  infoBulle({ texte: "Renommer", ancre: a });
  a.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  const ouverte = () => [...document.querySelectorAll('[role="tooltip"]')].filter((e) => e.dataset.ouverte === "true");
  expect(ouverte()).toHaveLength(1);
  evt("dragstart", ligne("b.txt"));
  expect(ouverte()).toHaveLength(0);
  evt("dragend", ligne("b.txt"));
  vi.useRealTimers();
});

test("REQ050_AC17_image_plusieurs_lignes_porte_l_icone_files", () => {
  const { ligne } = depot({ selection: ["b.txt", "c.txt"] });
  const dt = fauxTransfert();
  evt("dragstart", ligne("b.txt"), { dt });
  const image = dt.setDragImage.mock.calls[0][0];
  expect(image.querySelector("svg").innerHTML).toBe(icone("files").innerHTML);
  evt("dragend", ligne("b.txt"));
});

test("REQ050_AC15_AC18_css_cible_de_depot_image_et_partie_vide", () => {
  const cibleLigne = regle(".ya-tree .liste-ligne[data-depot]:not(#depot)");
  expect(cibleLigne).toContain("background: var(--accent-soft)");
  expect(cibleLigne).toContain("outline: var(--trait) solid var(--accent-fg)");
  expect(cibleLigne).toContain("outline-offset: calc(-1 * var(--trait))");
  expect(regle(".ya-tree .liste-ligne[data-depot-contenu]:not(#depot)")).toBe(" background: var(--accent-soft); ");
  const racine = regle(".ya-tree[data-depot]:not(#depot)");
  expect(racine).toContain("background: var(--accent-soft)");
  expect(racine).toContain("outline: var(--trait) solid var(--accent-fg)");
  expect(regle(".ya-tree[data-depot]:not(#depot) .liste-ligne")).toContain("background: none");
  expect(regle(".ya-tree[data-depot]:not(#depot) .liste-attenuee")).toContain("color: var(--ink-muted)");
  expect(regle(".liste-attenuee[data-depot]:not(#depot)")).toContain("color: var(--ink-muted)");
  const image = regle(".ya-glisse");
  for (const d of ["max-width: 240px", "background: var(--bg-300)", "box-shadow: var(--shadow-popover)", "border-radius: var(--radius-md)", "font-size: 12.5px", "line-height: 18px", "padding: 3px 8px"]) expect(image).toContain(d);
  expect(regle(".fichiers-arbre")).toContain("flex-direction: column");
  const arbre = regle(".fichiers-arbre > .ya-tree");
  expect(arbre).toContain("flex: 1 0 auto");
  expect(arbre).toContain("padding-bottom: var(--size-row)");
});

test("REQ052_AC1_fin_calee_et_non_coupee", () => {
  const l = liste({ lignes: [{ id: "a", libelle: "OpenAI", dossier: "https://api.openai.com/v1 · gpt", fin: "Clé enregistrée" }, { id: "b", libelle: "Local", fin: "Aucune clé" }], selection: "a" });
  const [a, b] = items(l);
  const fin = a.querySelector(".liste-fin");
  expect(fin.textContent).toBe("Clé enregistrée");
  expect(a.lastElementChild).toBe(fin);
  expect(b.querySelector(".liste-fin").textContent).toBe("Aucune clé");
  expect(a.querySelector(".liste-parent").textContent).toBe("https://api.openai.com/v1 · gpt");
  // Le nom accessible reste le libellé : la fin est lue après lui.
  expect(a.textContent).toBe("OpenAIhttps://api.openai.com/v1 · gptClé enregistrée");
  expect(items(liste({ lignes: lignes3 }))[0].querySelector(".liste-fin")).toBeNull();
  const r = regle(".ya-fin");
  expect(r).toContain("flex: none");
  expect(r).toContain("margin-left: auto");
  expect(r).toContain("color: var(--ink-muted)");
  expect(r).toContain("font-size: 11.5px");
  expect(r).toContain("white-space: nowrap");
  expect(r).not.toContain("overflow");
  expect(regle(".ya-reglages .ya-row")).toContain("border: 1px solid var(--line-strong)");
  expect(regle(".ya-reglages .ya-row")).toContain("border-radius: var(--radius-sm)");
  expect(regle(".ya-reglages .ya-row .liste-libelle")).toContain("min-width: 84px");
  expect(regle(".ya-reglages .ya-row .liste-parent")).toContain("text-overflow: ellipsis");
});

// --- Ligne avec date, liste de suggestions flottante (REQ-088 à REQ-091) ---
const dix = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, libelle: `ligne ${i}` }));
const unChamp = (rect = { left: 40, right: 340, top: 400, bottom: 430, width: 300, height: 30 }) => {
  const c = document.createElement("textarea");
  c.getBoundingClientRect = () => rect;
  document.body.append(c);
  return c;
};
const flottante = (champ, opts = {}) => liste({ lignes: dix, pilotage: "champ", champ, flottante: true, nom: "Commandes", ...opts });

test("REQ088_AC13_ligne_avec_date_libelle_coupe_entier_en_title_fin_jamais_coupee", () => {
  const l = liste({ lignes: [{ id: "s", libelle: "Un titre de session beaucoup trop long pour la ligne", fin: "14:32" }] });
  const ligne = items(l)[0];
  const lib = ligne.querySelector(".liste-libelle");
  expect(lib.textContent).toBe("Un titre de session beaucoup trop long pour la ligne");
  expect(lib.title).toBe("Un titre de session beaucoup trop long pour la ligne");
  expect(ligne.querySelector(".liste-fin").textContent).toBe("14:32");
  expect([...ligne.children].map((c) => c.className.split(" ")[0])).toEqual(["liste-libelle", "liste-fin"]);
  expect(regle(".liste-libelle")).toContain("text-overflow: ellipsis");
  expect(regle(".ya-palette-sans-champ .liste-libelle")).toContain("min-width: 0");
  expect(regle(".ya-palette-sans-champ .ya-fin")).toContain("padding-left: 16px");
  expect(regle(".ya-palette-sans-champ .ya-fin")).toContain("flex: none");
  expect(regle(".ya-palette-sans-champ .ya-fin")).toContain("white-space: nowrap");
  expect(regle(".ya-palette-sans-champ .liste-ligne")).toContain("font-size: 13px");
});

test("REQ088_AC14_focus_sur_la_liste_debut_fin_et_clic", () => {
  const surActiver = vi.fn();
  const l = liste({ lignes: dix, focusSurListe: true, nom: "Sessions opencode", surActiver });
  document.body.append(l);
  expect(l.tabIndex).toBe(0);
  expect(l.getAttribute("aria-label")).toBe("Sessions opencode");
  expect(l.getAttribute("aria-activedescendant")).toBe(items(l)[0].id);
  touche(l, "End");
  expect(l.getAttribute("aria-activedescendant")).toBe(items(l)[11].id);
  expect(items(l)[11].classList.contains("liste-courante")).toBe(true);
  touche(l, "Home");
  expect(l.getAttribute("aria-activedescendant")).toBe(items(l)[0].id);
  touche(l, "ArrowDown");
  touche(l, "Enter");
  expect(surActiver).toHaveBeenLastCalledWith("l1");
  const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
  items(l)[3].dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  items(l)[3].click();
  expect(surActiver).toHaveBeenLastCalledWith("l3");
  expect(items(l).map((x) => x.tabIndex)).toEqual(Array(12).fill(-1));
  expect(() => liste({ lignes: dix, focusSurListe: true, variante: "arbre" })).toThrow(/focusSurListe/);
  l.remove();
});

test("REQ089_AC11_hote_popover_nomme_huit_lignes_visibles_et_courante_visible", () => {
  const champ = unChamp();
  const h = flottante(champ);
  expect(h.tagName).toBe("DIV");
  expect(h.getAttribute("popover")).toBe("manual");
  const lb = h.querySelector('[role="listbox"]');
  expect(lb.getAttribute("aria-label")).toBe("Commandes");
  expect(lb.id).not.toBe("");
  expect(items(h)).toHaveLength(12);
  expect(regle(".ya-flottante .liste")).toContain("max-height: 200px");
  expect(regle(".ya-flottante .liste")).toContain("overflow-y: auto");
  expect(regle(".ya-flottante .liste-ligne")).toContain("height: 24px");
  expect(regle(".ya-flottante")).toContain("padding: var(--space-1)");
  expect(regle(".ya-flottante")).toContain("background: var(--bg-300)");
  expect(regle(".ya-flottante")).toContain("max-width: var(--largeur-palette)");
  // La courante reste visible.
  const defile = vi.fn();
  for (const o of items(h)) o.scrollIntoView = defile;
  h.afficher();
  touche(champ, "ArrowDown");
  expect(defile).toHaveBeenCalledWith({ block: "nearest" });
  // Au-dessus du champ, à 4 px.
  expect(h.style.left).toBe("40px");
  expect(h.style.width).toBe("300px");
  expect(h.style.bottom).toBe(`${innerHeight - 400 + 4}px`);
  h.masquer();
  expect(h.isConnected).toBe(false);
  // Pas la place de 3 lignes au-dessus : dessous, à 4 px.
  const bas = flottante(unChamp({ left: 10, right: 110, top: 50, bottom: 80, width: 100, height: 30 }));
  bas.afficher();
  expect(bas.style.top).toBe("84px");
  bas.masquer();
  expect(() => liste({ lignes: dix, flottante: true, nom: "x" })).toThrow(/champ/);
  expect(() => liste({ lignes: dix, flottante: true, nom: "x", pilotage: "champ", champ, variante: "arbre" })).toThrow(/flottante/);
  expect(() => liste({ lignes: dix, flottante: true, pilotage: "champ", champ })).toThrow(/nom/);
});

test("REQ089_AC12_premiere_courante_haut_et_bas_sans_boucler", () => {
  const champ = unChamp();
  const h = flottante(champ);
  document.body.append(h);
  expect(champ.getAttribute("aria-activedescendant")).toBe(items(h)[0].id);
  touche(champ, "ArrowUp");
  expect(champ.getAttribute("aria-activedescendant")).toBe(items(h)[0].id);
  for (let i = 0; i < 20; i++) touche(champ, "ArrowDown");
  expect(champ.getAttribute("aria-activedescendant")).toBe(items(h)[11].id);
  // Home et Fin restent au champ de texte.
  touche(champ, "Home");
  expect(champ.getAttribute("aria-activedescendant")).toBe(items(h)[11].id);
  // Une nouvelle liste rend la première courante.
  const h2 = flottante(champ, { lignes: dix.slice(2) });
  document.body.append(h2);
  expect(champ.getAttribute("aria-activedescendant")).toBe(items(h2)[0].id);
  expect(items(h2)[0].classList.contains("liste-courante")).toBe(true);
  h.remove();
  h2.remove();
});

test("REQ089_AC14_message_en_role_status_a_la_place_des_lignes", () => {
  const champ = unChamp();
  const h = flottante(champ, { lignes: [], message: "Chargement…" });
  const m = h.querySelector('[role="status"]');
  expect(m.textContent).toBe("Chargement…");
  expect(h.querySelector('[role="listbox"]')).toBeNull();
  expect(champ.hasAttribute("aria-activedescendant")).toBe(false);
  expect(regle(".ya-liste-message")).toContain("height: 24px");
  expect(regle(".ya-liste-message")).toContain("color: var(--ink-muted)");
  // Des lignes l'emportent sur le message.
  expect(flottante(champ, { message: "x" }).querySelector('[role="status"]')).toBeNull();
  expect(() => liste({ lignes: [], message: "x" })).toThrow(/message/);
});

test("REQ089_AC15_pointerdown_choisit_sans_voler_le_focus", () => {
  const champ = unChamp();
  const surActiver = vi.fn();
  const h = flottante(champ, { surActiver });
  document.body.append(h);
  champ.focus();
  const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
  items(h)[2].dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  expect(surActiver).toHaveBeenCalledTimes(1);
  expect(surActiver).toHaveBeenCalledWith("l2");
  items(h)[2].click();
  expect(surActiver).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(champ);
  h.remove();
});

test("REQ090_AC10_icone_du_type_et_dossier_dans_la_liste_flottante", () => {
  const champ = unChamp();
  const h = flottante(champ, { lignes: [
    { id: "d", libelle: "src/", icone: "folder", couleurIcone: "ink-muted" },
    { id: "f", libelle: "main.rs", icone: iconeDe("main.rs").icone, couleurIcone: iconeDe("main.rs").couleur },
  ] });
  const [d, f] = items(h);
  expect(d.querySelector(".liste-icone svg").getAttribute("data-icone")).toBe("folder");
  expect(f.querySelector(".liste-icone svg").getAttribute("data-icone")).toBe("file-code");
  expect(f.querySelector(".liste-icone").style.getPropertyValue("--couleur-icone")).toBe("var(--ink-muted)");
  expect(regle(".ya-flottante .liste-icone svg")).toContain("width: 15px");
  expect(regle(".ya-flottante .liste-icone")).toContain("margin-right: 6px");
});

test("REQ091_AC7_description_sur_une_ligne_entiere_en_title_libelle_a_moitie_au_plus", () => {
  const champ = unChamp();
  const h = flottante(champ, { lignes: [{ id: "s", libelle: "revue-code", dossier: "Relire un diff\nen détail" }, { id: "t", libelle: "seul" }] });
  const [s, t] = items(h);
  const d = s.querySelector(".liste-parent");
  expect(d.textContent).toBe("Relire un diff\nen détail");
  expect(d.title).toBe("Relire un diff\nen détail");
  expect(s.querySelector(".liste-libelle").title).toBe("revue-code");
  expect(s.classList.contains("liste-decrite")).toBe(true);
  expect(t.classList.contains("liste-decrite")).toBe(false);
  expect(regle(".ya-flottante .liste-decrite .liste-libelle")).toContain("max-width: 50%");
  expect(regle(".ya-flottante .liste-parent")).toContain("text-overflow: ellipsis");
  expect(regle(".ya-flottante .liste-parent")).toContain("white-space: nowrap");
  expect(regle(".ya-flottante .liste-parent")).toContain("margin-left: 12px");
  expect(regle(".ya-flottante .liste-parent")).toContain("color: var(--ink-muted)");
});

const actionsMcp = (surClic) => (nom) => [
  { icone: "sliders-horizontal", nomAccessible: `Modifier ${nom}`, infoBulle: `Modifier ${nom}`, surClic },
  { icone: "trash", nomAccessible: `Supprimer ${nom}`, infoBulle: `Supprimer ${nom}`, surClic },
];

test("REQ096_AC17_objets_ul_nomme_une_li_par_ligne_deux_boutons_arrets_de_tab_coupes_en_title", () => {
  const surClic = vi.fn();
  const longue = "mcp-documentation-interne-de-l-equipe";
  const l = liste({
    variante: "objets",
    nom: "Serveurs MCP",
    lignes: [
      { id: "docs", libelle: "docs", dossier: "mcp-docs --port 0", policeCode: true, actions: actionsMcp(surClic)("docs") },
      { id: "long", libelle: longue, dossier: "/home/marie/outils/serveurs-mcp/documentation/serveur.js", policeCode: true, actions: actionsMcp(surClic)("long") },
    ],
  });
  document.body.append(l);
  expect(l.tagName).toBe("UL");
  expect(l.getAttribute("aria-label")).toBe("Serveurs MCP");
  expect(l.hasAttribute("role")).toBe(false);
  const lis = [...l.children];
  expect(lis.map((x) => x.tagName)).toEqual(["LI", "LI"]);
  expect(lis[0].textContent).toBe("docsmcp-docs --port 0");
  expect(lis[0].querySelector(".ya-objet-texte").classList.contains("liste-code")).toBe(true);
  expect(lis[1].querySelector(".ya-objet-nom").title).toBe(longue);
  expect(lis[1].querySelector(".ya-objet-texte").title).toContain("/home/marie");
  const boutons = [...lis[0].querySelectorAll("button")];
  expect(boutons.map((b) => b.getAttribute("aria-label"))).toEqual(["Modifier docs", "Supprimer docs"]);
  expect(boutons.map((b) => b.tabIndex)).toEqual([0, 0]);
  expect(l.querySelectorAll("button")).toHaveLength(4);
  boutons[1].click();
  expect(surClic).toHaveBeenCalledWith("docs");
  // CSS : contour de la liste, défilement propre, coupure par « … », ligne de 28 px au survol --bg-400.
  expect(regle(".ya-objets")).toContain("border: 1px solid var(--line-strong)");
  expect(regle(".ya-objets")).toContain("overflow-y: auto");
  expect(regle(".ya-objets")).toContain("min-height: 92px");
  expect(regle(".ya-objet")).toContain("height: 28px");
  expect(regle(".ya-objet:hover")).toContain("background: var(--bg-400)");
  expect(regle(".ya-objet-nom")).toContain("max-width: 35%");
  expect(regle(".ya-objet-nom")).toContain("min-width: 96px");
  expect(regle(".ya-objet-nom")).toContain("text-overflow: ellipsis");
  expect(regle(".ya-objet-texte")).toContain("text-overflow: ellipsis");
  expect(regle(".ya-objet-actions")).toContain("gap: 2px");
});

test("REQ096_AC17_objets_le_bouton_qui_prend_le_focus_est_amene_dans_la_vue", () => {
  const l = liste({ variante: "objets", nom: "Serveurs MCP", lignes: [{ id: "a", libelle: "a", actions: actionsMcp(() => {})("a") }] });
  document.body.append(l);
  const b = l.querySelector("button");
  b.scrollIntoView = vi.fn();
  b.focus();
  expect(b.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  expect(() => liste({ variante: "objets", lignes: [] })).toThrow(/nom/);
});

test("REQ096_AC17_contrastes_de_la_liste_objets_et_de_la_commande_du_rail", () => {
  const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
  const jetonsDe = (theme) => {
    const t = {};
    for (const m of tokens.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!m[1].split(",").map((s) => s.trim()).some((s) => s === ":root" || s === `[data-theme="${theme}"]`)) continue;
      for (const d of m[2].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) t[d[1]] = d[2].trim();
    }
    return t;
  };
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const attendus = [
    ["--ink", "--bg-300", [8.92, 16.48]],
    ["--ink-muted", "--bg-300", [5.48, 6.68]],
    ["--ink-muted", "--bg-400", [4.52, 5.37]],
    ["--line-strong", "--bg-300", [3.02, 3.45]],
    ["--accent-fg", "--bg-300", [5.78, 6.3]],
    ["--accent-fg", "--bg-400", [4.76, 5.07]],
    ["--ink-faint", "--bg-000", [5.21, 4.47]],
    ["--ink", "--bg-400", [7.36, 13.25]],
    ["--accent-fg", "--bg-000", [7.16, 5.53]],
  ];
  ["dark", "light"].forEach((theme, k) => {
    const t = jetonsDe(theme);
    for (const [texte, fond, ratios] of attendus) {
      const [x, y] = [lum(t[texte]), lum(t[fond])].sort((a, b) => b - a);
      const r = (x + 0.05) / (y + 0.05);
      expect(Math.abs(r - ratios[k]), `${texte} sur ${fond} (${theme}) : ${r}`).toBeLessThan(0.02);
    }
  });
});

// C-006 `objets` sans `actions` et `passages` (V-013, REQ-105, REQ-106).
test("REQ105_AC8_objets_sans_actions_lecture_seule_un_arret_de_tab_la_liste", () => {
  const long = "docs/une-documentation-tres-longue/avec/des/dossiers/imbriques/guide-utilisateur.md";
  const l = liste({ variante: "objets", nom: "Fichiers de notes", lignes: [{ id: "a", libelle: "docs/a.md", policeCode: true }, { id: "b", libelle: long, policeCode: true }] });
  document.body.append(l);
  expect(l.tagName).toBe("UL");
  expect(l.getAttribute("aria-label")).toBe("Fichiers de notes");
  expect(l.tabIndex).toBe(0);
  expect(l.querySelectorAll("button")).toHaveLength(0);
  expect([...l.children].map((x) => x.textContent)).toEqual(["docs/a.md", long]);
  expect(l.children[1].querySelector(".ya-objet-nom").title).toBe(long);
  expect(l.classList.contains("ya-objets-lecture")).toBe(true);
  expect(l.children[0].querySelector(".ya-objet-nom").classList.contains("liste-code")).toBe(true);
  const r = regle(".ya-objets-lecture .ya-objet");
  expect(r).toContain("height: var(--size-row)");
  expect(r).toContain("font-size: 12px");
  expect(regle(".ya-objets-lecture .ya-objet:hover")).toContain("background: transparent");
  expect(regle(".ya-objets-lecture:focus-visible")).toContain("outline: var(--trait-fort) solid var(--accent-fg)");
  expect(regle(".ya-objets-lecture:focus-visible")).toContain("outline-offset: calc(-1 * var(--trait-fort))");
  expect(regle(".ya-objets-lecture .ya-objet-nom")).toContain("max-width: none");
});

test("REQ105_AC6_objets_avec_actions_gardent_leur_liste_sans_arret_de_tab", () => {
  const l = liste({ variante: "objets", nom: "Collections", lignes: [{ id: "n", libelle: "notes", dossier: "2 fichiers · 7 passages", actions: [{ icone: "list", nomAccessible: "Fichiers de notes" }] }] });
  expect(l.hasAttribute("tabindex")).toBe(false);
  expect(l.classList.contains("ya-objets-lecture")).toBe(false);
  expect(l.querySelector(".ya-objet-texte").textContent).toBe("2 fichiers · 7 passages");
  expect(l.querySelector(".ya-objet-texte").classList.contains("liste-code")).toBe(false);
});

const passage = (o = {}) => ({ chemin: "docs/guide.md", debut: 12, fin: 40, collection: "notes", score: 0.82, texte: "# Titre\n  indenté\nfin", ...o });

test("REQ106_AC7_passages_ol_nommee_un_li_par_passage_dans_l_ordre_lien_title_score_pre", () => {
  const surLien = vi.fn();
  const l = liste({ variante: "passages", nom: "Passages", surLien, lignes: [passage(), passage({ chemin: "src/a.rs", debut: 1, fin: 3, collection: "api", score: 0.5, texte: "fn a() {}" })] });
  document.body.append(l);
  expect(l.tagName).toBe("OL");
  expect(l.getAttribute("aria-label")).toBe("Passages");
  expect(l.hasAttribute("role")).toBe(false);
  const lis = [...l.children];
  expect(lis.map((x) => x.tagName)).toEqual(["LI", "LI"]);
  const a = lis[0].querySelector("a");
  expect(a.textContent).toBe("docs/guide.md:12-40");
  expect(a.title).toBe("Ouvrir docs/guide.md à la ligne 12 dans l'éditeur.");
  expect(a.hasAttribute("href")).toBe(true);
  expect(a.hasAttribute("target")).toBe(false);
  expect(a.getAttribute("href").startsWith("#")).toBe(true);
  expect(lis[0].querySelector(".ya-passage-score").textContent).toBe("notes · score 0,82");
  expect(lis[1].querySelector(".ya-passage-score").textContent).toBe("api · score 0,50");
  const pre = lis[0].querySelector("pre");
  expect(pre.textContent).toBe("# Titre\n  indenté\nfin");
  expect(l.querySelectorAll("a")).toHaveLength(2);
  expect(l.querySelectorAll("li > :is(button, input, [tabindex])")).toHaveLength(0);
});

test("REQ106_AC7_passages_clic_sur_le_lien_appelle_surLien_sans_navigation", () => {
  const surLien = vi.fn();
  const donnees = passage();
  const l = liste({ variante: "passages", nom: "Passages", surLien, lignes: [donnees] });
  document.body.append(l);
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  l.querySelector("a").dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(surLien).toHaveBeenCalledWith(donnees);
});

test("REQ106_AC7_passages_score_a_deux_decimales_virgule_et_entrees_invalides", () => {
  const l = liste({ variante: "passages", nom: "Passages", lignes: [passage({ score: 1 }), passage({ score: 0.126 })] });
  expect([...l.querySelectorAll(".ya-passage-score")].map((x) => x.textContent)).toEqual(["notes · score 1,00", "notes · score 0,13"]);
  expect(() => liste({ variante: "passages", lignes: [] })).toThrow(/nom/);
  expect(() => liste({ variante: "passages", nom: "P", lignes: [{ ...passage(), chemin: "" }] })).toThrow(/chemin/);
  expect(() => liste({ variante: "passages", nom: "P", lignes: [{ ...passage(), score: "x" }] })).toThrow(/score/);
});

test("REQ106_AC7_passages_style_lien_info_pre_mono_cadre_retours_gardes", () => {
  expect(regle(".ya-passages")).toContain("gap: 12px");
  expect(regle(".ya-passage-lien")).toContain("color: var(--info)");
  expect(regle(".ya-passage-lien")).toContain("text-decoration: underline");
  expect(regle(".ya-passage-lien")).toContain("text-overflow: ellipsis");
  expect(regle(".ya-passage-lien:focus-visible")).toContain("outline: var(--trait-fort) solid var(--accent-fg)");
  expect(regle(".ya-passage-lien:focus-visible")).toContain("outline-offset: var(--trait)");
  expect(regle(".ya-passage-score")).toContain("color: var(--ink-muted)");
  expect(regle(".ya-passage-score")).toContain("flex: none");
  const p = regle(".ya-passage pre");
  expect(p).toContain("margin: var(--space-1) 0 0");
  for (const t of ["var(--font-mono)", "var(--ink)", "var(--bg-100)", "var(--line)", "var(--radius-sm)", "white-space: pre-wrap", "overflow-wrap: anywhere", "12px/18px"]) expect(p).toContain(t);
});

// REQ-112 : marque de la base de connaissance dans l'arbre (C-006 `base`).
const avecBase = (base, extra = {}) => liste({ variante: "arbre", multiple: true, lignes: [{ id: "d", libelle: "docs", enfants: true, ouvert: true, base: { collections: ["x"], echec: null } }, { id: "d/guide.md", libelle: "guide.md", niveau: 1, base, ...extra }, { id: "n.md", libelle: "n.md" }] });
const OK = { collections: ["api-docs", "notes"], echec: null };

test("REQ112_base_absente_ni_marque_ni_colonne", () => {
  const l = avecBase(undefined, { statut: "M" });
  const [, f, n] = items(l);
  expect(f.querySelector(".liste-base")).toBeNull();
  expect(n.querySelector(".liste-statut")).toBeNull();
  expect(f.getAttribute("aria-label")).toBe("guide.md, modifié");
});

test("REQ112_base_marque_book_open_info_bulle_et_nom_accessible_apres_le_statut", () => {
  vi.useFakeTimers();
  const l = avecBase(OK, { statut: "M" });
  document.body.append(l);
  const [d, f] = items(l);
  const m = f.querySelector(".liste-base");
  expect(m.getAttribute("aria-hidden")).toBe("true");
  expect(m.querySelector("svg").dataset.icone).toBe("book-open");
  expect(m.querySelector("svg").getAttribute("stroke-width")).toBe("1.8");
  expect(f.getAttribute("aria-label")).toBe("guide.md, modifié, dans la base de connaissance");
  expect(m.tabIndex).toBe(-1);
  m.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(500);
  expect(document.querySelector('[role="tooltip"][data-ouverte="true"]').textContent).toBe("Dans la base de connaissance : api-docs, notes");
  m.dispatchEvent(new Event("pointerleave"));
  // Un dossier n'a jamais de marque.
  expect(d.querySelector(".liste-base")).toBeNull();
  vi.useRealTimers();
});

test("REQ112_base_en_echec_book_alert_danger_info_bulle_et_nom_accessible", () => {
  vi.useFakeTimers();
  const l = avecBase({ collections: ["notes"], echec: "Disque plein." });
  document.body.append(l);
  const f = items(l)[1];
  const m = f.querySelector(".liste-base");
  expect(m.classList.contains("liste-base-echec")).toBe(true);
  expect(m.querySelector("svg").dataset.icone).toBe("book-alert");
  expect(f.getAttribute("aria-label")).toBe("guide.md, dans la base de connaissance, mise à jour impossible");
  m.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(500);
  expect(document.querySelector('[role="tooltip"][data-ouverte="true"]').textContent).toBe("Mise à jour dans la base de connaissance impossible : Disque plein.");
  m.dispatchEvent(new Event("pointerleave"));
  vi.useRealTimers();
});

test("REQ112_base_colonne_de_la_lettre_reservee_sans_lettre_et_marque_avant_la_coche", () => {
  const l = avecBase(OK);
  document.body.append(l);
  const f = items(l)[1];
  const kids = [...f.children].map((c) => c.className);
  expect(kids.indexOf("liste-base")).toBeLessThan(kids.findIndex((c) => c.startsWith("liste-statut")));
  expect(f.querySelector(".liste-statut").getAttribute("aria-hidden")).toBe("true");
  expect(f.querySelector(".liste-statut").textContent).toBe("");
  items(l)[1].click();
  items(l)[2].dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true }));
  items(l)[0].dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true }));
  const noms = [...items(l)[1].children].map((c) => c.className.split(" ")[0]);
  expect(noms.indexOf("liste-base")).toBeLessThan(noms.indexOf("liste-coche"));
  expect(noms.indexOf("liste-coche")).toBeLessThan(noms.indexOf("liste-statut"));
  const css = regle(".ya-tree .liste-base");
  expect(css).toContain("width: 14px");
  expect(css).toContain("color: var(--ink-muted)");
  expect(regle(".ya-tree .liste-base-echec")).toContain("color: var(--danger)");
});

test("REQ112_mise_a_jour_de_base_seule_garde_les_lignes_le_focus_et_la_selection", () => {
  const l = avecBase(undefined);
  document.body.append(l);
  const avant = items(l);
  avant[1].click();
  avant[1].focus();
  l.scrollTop = 40;
  l.mettreAJourBase([{ id: "d", libelle: "docs", enfants: true }, { id: "d/guide.md", libelle: "guide.md", base: OK }, { id: "n.md", libelle: "n.md" }]);
  expect(l.scrollTop).toBe(40);
  expect(items(l)).toEqual(avant);
  expect(items(l).every((e, i) => e === avant[i])).toBe(true);
  expect(document.activeElement).toBe(avant[1]);
  expect(avant[1].getAttribute("aria-selected")).toBe("true");
  expect(avant[1].querySelector(".liste-base")).not.toBeNull();
  l.mettreAJourBase([{ id: "d/guide.md", libelle: "guide.md", base: { collections: ["notes"], echec: "Trop gros." } }]);
  expect(avant[1].querySelector("svg[data-icone='book-alert']")).not.toBeNull();
  expect(avant[1].querySelectorAll(".liste-base").length).toBe(1);
  expect(l.scrollTop).toBe(40);
  l.mettreAJourBase([{ id: "d/guide.md", libelle: "guide.md" }]);
  expect(avant[1].querySelector(".liste-base")).toBeNull();
  expect(avant[1].querySelector(".liste-statut")).toBeNull();
  expect(avant[1].hasAttribute("aria-label")).toBe(false);
  expect(l.scrollTop).toBe(40);
  expect(document.activeElement).toBe(avant[1]);
});
