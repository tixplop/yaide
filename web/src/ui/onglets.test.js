import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { onglets } from "./onglets.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};

const rail = () =>
  onglets({
    orientation: "verticale",
    actif: "f",
    onglets: [
      { id: "f", libelle: "F", nomAccessible: "Fichiers" },
      { id: "r", libelle: "R", nomAccessible: "Recherche" },
      { id: "g", libelle: "G", nomAccessible: "Git" },
    ],
  });
const tab = (r, i) => r.querySelectorAll('[role="tab"]')[i];
const touche = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

test("REQ028_AC4_rail_tablist_vertical_noms_et_aria_selected", () => {
  const r = rail();
  document.body.append(r);
  expect(r.getAttribute("role")).toBe("tablist");
  expect(r.getAttribute("aria-orientation")).toBe("vertical");
  const t = r.querySelectorAll('[role="tab"]');
  expect([...t].map((x) => x.textContent)).toEqual(["F", "R", "G"]);
  expect([...t].map((x) => x.getAttribute("aria-label"))).toEqual(["Fichiers", "Recherche", "Git"]);
  expect([...t].map((x) => x.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
});

test("REQ028_AC4_horizontale_par_defaut", () => {
  const r = onglets({ onglets: [{ id: "a", libelle: "a.rs" }], actif: "a" });
  expect(r.getAttribute("aria-orientation")).toBe("horizontal");
  expect(tab(r, 0).hasAttribute("aria-label")).toBe(true);
  expect(tab(r, 0).getAttribute("aria-label")).toBe("a.rs");
});

test("REQ028_AC7_un_seul_arret_de_tabulation_sur_l_onglet_actif", () => {
  const r = rail();
  expect([...r.querySelectorAll('[role="tab"]')].map((x) => x.tabIndex)).toEqual([0, -1, -1]);
});

test("REQ028_AC4_fleches_changent_l_onglet_et_le_focus_suit", () => {
  const surChoix = vi.fn();
  const r = onglets({
    orientation: "verticale",
    actif: "f",
    surChoix,
    onglets: [{ id: "f", libelle: "F" }, { id: "r", libelle: "R" }, { id: "g", libelle: "G" }],
  });
  document.body.append(r);
  tab(r, 0).focus();
  touche(tab(r, 0), "ArrowDown");
  expect(surChoix).toHaveBeenLastCalledWith("r");
  expect(document.activeElement).toBe(tab(r, 1));
  expect(tab(r, 1).getAttribute("aria-selected")).toBe("true");
  expect(tab(r, 0).getAttribute("aria-selected")).toBe("false");
  touche(tab(r, 1), "End");
  expect(document.activeElement).toBe(tab(r, 2));
  touche(tab(r, 2), "ArrowDown");
  expect(document.activeElement).toBe(tab(r, 0));
  touche(tab(r, 0), "ArrowUp");
  expect(document.activeElement).toBe(tab(r, 2));
  touche(tab(r, 2), "Home");
  expect(document.activeElement).toBe(tab(r, 0));
  expect(surChoix).toHaveBeenLastCalledWith("f");
});

test("REQ028_AC4_horizontale_utilise_gauche_droite", () => {
  const r = onglets({ actif: "a", onglets: [{ id: "a", libelle: "a" }, { id: "b", libelle: "b" }] });
  document.body.append(r);
  tab(r, 0).focus();
  touche(tab(r, 0), "ArrowDown");
  expect(document.activeElement).toBe(tab(r, 0));
  touche(tab(r, 0), "ArrowRight");
  expect(document.activeElement).toBe(tab(r, 1));
});

test("REQ028_AC4_clic_choisit", () => {
  const surChoix = vi.fn();
  const r = onglets({ actif: "a", surChoix, onglets: [{ id: "a", libelle: "a" }, { id: "b", libelle: "b" }] });
  tab(r, 1).click();
  expect(surChoix).toHaveBeenCalledWith("b");
  expect(tab(r, 1).getAttribute("aria-selected")).toBe("true");
});

test("REQ028_AC4_modifie_et_question_dans_le_nom_accessible", () => {
  const r = onglets({
    actif: "a",
    onglets: [
      { id: "a", libelle: "a.rs", modifie: true },
      { id: "b", libelle: "b.rs", question: true },
      { id: "c", libelle: "c.rs", modifie: true, question: true },
    ],
  });
  expect(tab(r, 0).hasAttribute("data-modifie")).toBe(true);
  expect(tab(r, 0).textContent).not.toContain("●");
  expect(tab(r, 1).hasAttribute("data-modifie")).toBe(false);
  expect(tab(r, 0).getAttribute("aria-label")).toBe("a.rs, non sauvegardé");
  expect(tab(r, 1).textContent).toContain("!");
  expect(tab(r, 1).querySelector(".onglet-question")).not.toBeNull();
  expect(tab(r, 1).getAttribute("aria-label")).toBe("b.rs, question en attente");
  expect(tab(r, 2).getAttribute("aria-label")).toBe("c.rs, non sauvegardé, question en attente");
});

test("REQ028_AC4_fermeture_par_bouton_et_par_suppr", () => {
  const surFermer = vi.fn();
  const r = onglets({ actif: "a", surFermer, onglets: [{ id: "a", libelle: "a.rs", fermable: true }, { id: "b", libelle: "b.rs" }] });
  const x = r.querySelector(".onglet-fermer");
  expect(x.getAttribute("aria-label")).toBe("Fermer a.rs");
  expect(x.tabIndex).toBe(-1);
  expect(r.querySelectorAll(".onglet-fermer").length).toBe(1);
  x.click();
  expect(surFermer).toHaveBeenCalledWith("a", "croix");
  surFermer.mockClear();
  touche(tab(r, 0), "Delete");
  expect(surFermer).toHaveBeenCalledWith("a", "touche");
  surFermer.mockClear();
  touche(tab(r, 1), "Delete");
  expect(surFermer).not.toHaveBeenCalled();
});

test("REQ028_AC8_actions_de_droite_apres_les_onglets", () => {
  const apercu = document.createElement("button");
  const r = onglets({ actif: "a", onglets: [{ id: "a", libelle: "a" }], actionsDroite: [apercu] });
  expect(r.contains(apercu)).toBe(true);
  expect(r.querySelector(".onglets-droite").contains(apercu)).toBe(true);
});

test("REQ028_AC4_choisir_depuis_l_exterieur_et_erreurs", () => {
  const r = rail();
  r.choisir("g");
  expect(tab(r, 2).getAttribute("aria-selected")).toBe("true");
  expect(tab(r, 2).tabIndex).toBe(0);
  expect(() => onglets({ orientation: "diagonale", onglets: [] })).toThrow(/orientation/);
  expect(() => onglets({ onglets: [{ id: "a" }] })).toThrow(/libelle/);
});

test("REQ028_AC3_style_onglets_accent_pour_l_actif_et_le_focus", () => {
  expect(regle(".onglet:focus-visible")).toContain("outline: var(--trait-fort) solid var(--accent-fg)");
  expect(regle(".onglet")).toContain("color: var(--ink-muted)");
  expect(regle(".onglet:hover")).toContain("color: var(--ink)");
  expect(regle(".onglet-question")).toContain("color: var(--warning)");
  expect(regle(".onglet-question")).toContain("font-weight: var(--graisse-forte)");
});

test("REQ028_AC4_l_onglet_actif_est_rendu_visible_par_choisir", () => {
  const spy = vi.fn();
  const orig = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = spy;
  try {
    const r = rail();
    document.body.append(r);
    spy.mockClear();
    r.choisir("g");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.contexts[0]).toBe(tab(r, 2));
  } finally {
    Element.prototype.scrollIntoView = orig;
  }
});

test("REQ036_AC7_fichiers_barre_bg_100_actif_bg_200_filet_accent_en_haut_croix_au_survol", () => {
  expect(regle(".ya-tabs")).toContain("height: var(--size-tab)");
  expect(regle(".ya-tabs")).toContain("background: var(--bg-100)");
  expect(regle(".ya-tabs")).toContain("overflow-x: auto");
  expect(regle(".ya-tabs")).toContain("scrollbar-width: none");
  const actif = regle(".ya-tabs .onglet-cellule:has(> .onglet[aria-selected=\"true\"])");
  expect(actif).toContain("background: var(--bg-200)");
  expect(actif).toContain("inset 0 var(--trait-fort) 0 var(--accent-fg)");
  expect(regle(".ya-tabs .onglet-cellule .bouton-enveloppe")).toContain("opacity: 0");
  expect(regle(".ya-tabs .onglet-cellule:hover .bouton-enveloppe")).toContain("opacity: 1");
});

test("REQ013_AC4_le_point_est_un_pseudo_element_de_7_px_qui_prend_la_place_de_la_croix", () => {
  const point = regle(".ya-tabs .onglet-cellule:has(> .onglet[data-modifie])::after");
  expect(point).toContain("width: 7px");
  expect(point).toContain("height: 7px");
  expect(point).toContain("background: var(--ink-muted)");
  expect(regle(".ya-tabs .onglet-cellule:has(> .onglet[data-modifie]) .bouton-enveloppe")).toContain("opacity: 0");
  expect(regle(".ya-tabs .onglet-cellule:has(> .onglet[data-modifie]):hover .bouton-enveloppe")).toContain("opacity: 1");
  expect(regle(".ya-tabs .onglet-cellule:has(> .onglet[data-modifie]):has(> .bouton-enveloppe):hover::after")).toContain("display: none");
});

test("REQ013_AC7_le_point_n_entre_pas_dans_le_nom_de_la_fermeture", () => {
  const r = onglets({ actif: "a", onglets: [{ id: "a", libelle: "main.rs", modifie: true, fermable: true }] });
  expect(r.querySelector(".onglet-fermer").getAttribute("aria-label")).toBe("Fermer main.rs");
  expect(tab(r, 0).getAttribute("aria-label")).toBe("main.rs, non sauvegardé");
});

test("REQ039_AC8_nom_accessible_statut_puis_non_sauvegarde_puis_question", () => {
  const r = onglets({
    actif: "a",
    onglets: [
      { id: "a", libelle: "main.rs", statut: "M", modifie: true },
      { id: "b", libelle: "b.rs", statut: "A" },
      { id: "c", libelle: "c.rs", statut: "U", modifie: true, question: true },
    ],
  });
  expect(tab(r, 0).getAttribute("aria-label")).toBe("main.rs, modifié, non sauvegardé");
  expect(tab(r, 1).getAttribute("aria-label")).toBe("b.rs, ajouté");
  expect(tab(r, 2).getAttribute("aria-label")).toBe("c.rs, nouveau, non sauvegardé, question en attente");
  expect(tab(r, 0).querySelector(".onglet-nom").className).toContain("onglet-statut-M");
  expect(regle(".onglet-statut-M")).toContain("color: var(--git-modified)");
  expect(regle(".onglet-statut-A")).toContain("color: var(--git-added)");
  expect(regle(".onglet-statut-U")).toContain("color: var(--git-untracked)");
  expect(() => onglets({ onglets: [{ id: "a", libelle: "a", statut: "D" }] })).toThrow(/statut/);
});

test("REQ036_AC7_presentations_fichiers_shells_rail", () => {
  const f = onglets({ presentation: "fichiers", actif: "a", onglets: [{ id: "a", libelle: "a.rs", icone: "file-code" }] });
  expect(f.classList.contains("ya-tabs")).toBe(true);
  expect(f.getAttribute("aria-orientation")).toBe("horizontal");
  expect(tab(f, 0).querySelector("svg").getAttribute("data-icone")).toBe("file-code");
  expect(tab(f, 0).textContent).toBe("a.rs");
  const s = onglets({ presentation: "shells", actif: "a", onglets: [{ id: "a", libelle: "Shell 1", icone: "terminal" }] });
  expect(s.classList.contains("ya-term-tabs")).toBe(true);
  expect(tab(s, 0).textContent).toBe("Shell 1");
  const r = onglets({ presentation: "rail", actif: "a", onglets: [{ id: "a", icone: "files", nomAccessible: "Fichiers" }] });
  expect(r.classList.contains("ya-activity")).toBe(true);
  expect(r.getAttribute("aria-orientation")).toBe("vertical");
  expect(() => onglets({ presentation: "x", onglets: [] })).toThrow(/presentation/);
  expect(regle(".ya-term-tabs")).toContain("height: 30px");
  expect(regle(".ya-term-tabs")).toContain("background: var(--bg-000)");
  expect(regle(".ya-term-tabs .onglet")).toContain("height: 22px");
  expect(regle(".ya-term-tabs .onglet-cellule:has(> .onglet[aria-selected=\"true\"])")).toContain("background: var(--bg-300)");
  expect(regle(".ya-term-tabs .onglet[aria-selected=\"true\"]")).not.toContain("background");
  expect(regle(".ya-activity")).toContain("width: var(--size-activity)");
  expect(regle(".ya-activity")).toContain("background: var(--bg-000)");
  // Le filet du rail est celui du cadre (un seul).
  expect(regle(".ya-activity")).not.toContain("border");
  expect(regle(".ya-activity .onglet")).toContain("height: var(--size-activity)");
  expect(regle(".ya-activity .onglet")).toContain("color: var(--ink-faint)");
  expect(regle(".ya-activity .onglet[aria-selected=\"true\"]")).toContain("inset var(--trait-fort) 0 0 var(--accent-fg)");
});

test("REQ036_AC3_barre_en_border_box_et_tailles_d_icones_et_de_texte", () => {
  expect(regle(".onglets")).toContain("box-sizing: border-box");
  expect(regle(".ya-activity .onglet")).not.toContain("width");
  expect(regle(".ya-tabs .onglet svg")).toContain("width: 15px");
  expect(regle(".ya-term-tabs")).toContain("font-size: 12px");
  expect(regle(".ya-term-tabs .onglet svg")).toContain("width: 14px");
});

test("REQ036_AC7_le_rail_porte_un_compteur_accent_hors_du_nom_accessible", () => {
  const r = onglets({ presentation: "rail", actif: "g", onglets: [{ id: "g", icone: "branch", nomAccessible: "Git", compteur: 3 }, { id: "f", icone: "files", nomAccessible: "Fichiers", compteur: 0 }] });
  const c = tab(r, 0).querySelector(".ya-badge");
  expect(c.textContent).toBe("3");
  expect(c.classList.contains("ya-badge-accent")).toBe(true);
  expect(c.getAttribute("aria-hidden")).toBe("true");
  expect(tab(r, 0).getAttribute("aria-label")).toBe("Git");
  expect(tab(r, 1).querySelector(".ya-badge").hidden).toBe(true);
  expect(() => onglets({ onglets: [{ id: "a", libelle: "a", compteur: -1 }] })).toThrow(/compteur/);
});

const railIcones = () =>
  onglets({
    orientation: "verticale",
    actif: "f",
    onglets: [
      { id: "f", icone: "files", nomAccessible: "Fichiers", raccourci: "F" },
      { id: "r", icone: "search", nomAccessible: "Recherche", raccourci: "R" },
    ],
  });

test("REQ031_AC1_rail_a_icones_sans_texte_noms_et_info_bulle", () => {
  vi.useFakeTimers();
  const r = railIcones();
  document.body.append(r);
  const t = r.querySelectorAll('[role="tab"]');
  expect([...t].map((x) => x.textContent)).toEqual(["", ""]);
  expect([...t].map((x) => x.querySelector("svg").getAttribute("data-icone"))).toEqual(["files", "search"]);
  expect([...t].map((x) => x.getAttribute("aria-label"))).toEqual(["Fichiers", "Recherche"]);
  expect(t[0].getAttribute("aria-keyshortcuts")).toBe("F");
  expect(t[0].hasAttribute("title")).toBe(false);
  t[0].dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Fichiers (F)");
  vi.useRealTimers();
});

test("REQ031_AC1_fermeture_d_onglet_par_icone_x_sans_texte", () => {
  const r = onglets({ actif: "a", onglets: [{ id: "a", libelle: "main.rs", fermable: true, titre: "src/main.rs" }] });
  const x = r.querySelector(".onglet-fermer");
  expect(x.textContent).toBe("");
  expect(x.querySelector("svg").getAttribute("data-icone")).toBe("x");
  expect(x.getAttribute("aria-label")).toBe("Fermer main.rs");
  expect(x.hasAttribute("title")).toBe(false);
  expect(tab(r, 0).title).toBe("src/main.rs");
});

test("REQ031_AC4_onglet_a_icone_exige_un_nom_accessible", () => {
  expect(() => onglets({ onglets: [{ id: "a", icone: "files" }] })).toThrow(/nomAccessible/);
  expect(() => onglets({ onglets: [{ id: "a" }] })).toThrow(/libelle/);
});

test("REQ041_AC1_shells_fermables_une_croix_par_onglet_a_opacite_1", () => {
  const surFermer = vi.fn();
  const surChoix = vi.fn();
  const r = onglets({ presentation: "shells", actif: "1", surFermer, surChoix, onglets: [{ id: "1", libelle: "shell 1", icone: "terminal", fermable: true }, { id: "2", libelle: "shell 2", icone: "terminal", fermable: true }] });
  const croix = r.querySelectorAll(".onglet-fermer");
  expect(croix.length).toBe(2);
  expect(croix[1].getAttribute("aria-label")).toBe("Fermer shell 2");
  expect(croix[1].tabIndex).toBe(-1);
  croix[1].click();
  expect(surFermer).toHaveBeenCalledWith("2", "croix");
  expect(surChoix).not.toHaveBeenCalled();
  expect(tab(r, 0).getAttribute("aria-selected")).toBe("true");
  touche(tab(r, 0), "Delete");
  expect(surFermer).toHaveBeenCalledWith("1", "touche");
  expect(regle(".ya-term-tabs .onglet-cellule .bouton-enveloppe")).toContain("opacity: 1");
  expect(regle(".ya-term-tabs")).toContain("flex: none");
  expect(regle(".ya-term-tabs")).toContain("scrollbar-width: none");
  expect(regle(".ya-term-tabs .onglet-cellule")).toContain("height: 22px");
  expect(regle(".ya-term-tabs .onglet-cellule")).toContain("padding-right");
  expect(regle(".ya-term-tabs")).toContain("overflow-x: auto");
  expect(regle(".ya-term-tabs .onglet-cellule:hover .onglet")).toContain("color: var(--ink)");
  expect(regle(".ya-term-tabs .onglet:focus-visible")).toContain("outline: none");
  expect(regle(".ya-term-tabs .onglet")).toContain("padding: 0 var(--space-1) 0 var(--space-2)");
  expect(regle(".ya-term-tabs .onglet-cellule:has(> .onglet:focus-visible)")).toContain("outline: var(--trait-fort) solid var(--accent-fg)");
});

const fichiers = (extra = {}) =>
  onglets({
    actif: "a",
    actionsDroite: [Object.assign(document.createElement("button"), { textContent: "Aperçu" })],
    onglets: [
      { id: "a", libelle: "a.rs", fermable: true },
      { id: "b", libelle: "b.rs", fermable: true, modifie: true },
    ],
    ...extra,
  });
const clicDroit = (el) => {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 12, clientY: 34 });
  el.dispatchEvent(e);
  return e;
};

test("REQ061_AC11_aria_haspopup_avec_surMenu_seulement_et_pas_sur_shells", () => {
  const avec = fichiers({ surMenu: () => {} });
  expect([...avec.querySelectorAll('[role="tab"]')].every((t) => t.getAttribute("aria-haspopup") === "menu")).toBe(true);
  expect(tab(fichiers(), 0).hasAttribute("aria-haspopup")).toBe(false);
  const sh = onglets({ presentation: "shells", surMenu: () => {}, actif: "a", onglets: [{ id: "a", libelle: "sh" }] });
  expect(tab(sh, 0).hasAttribute("aria-haspopup")).toBe(false);
  expect(clicDroit(tab(sh, 0)).defaultPrevented).toBe(false);
});

test("REQ061_AC13_clic_droit_sur_onglet_croix_et_point_appelle_surMenu", () => {
  const surMenu = vi.fn();
  const r = fichiers({ surMenu });
  // Le point est un pseudo-élément de l'onglet : l'événement vise l'onglet.
  for (const cible of [tab(r, 1), r.querySelectorAll(".onglet-fermer")[1]]) {
    expect(clicDroit(cible).defaultPrevented).toBe(true);
    expect(surMenu).toHaveBeenLastCalledWith("b", { x: 12, y: 34 });
  }
  expect(surMenu).toHaveBeenCalledTimes(2);
});

test("REQ061_AC10_Menu_et_Maj_F10_appellent_surMenu_sans_position_une_seule_fois", () => {
  const surMenu = vi.fn();
  const r = fichiers({ surMenu });
  for (const [key, shiftKey] of [["ContextMenu", false], ["F10", true]]) {
    surMenu.mockClear();
    const e = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    tab(r, 0).dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(surMenu).toHaveBeenCalledExactlyOnceWith("a", null);
    // contextmenu envoyé par le navigateur après la touche : ignoré
    tab(r, 0).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0 }));
    expect(surMenu).toHaveBeenCalledTimes(1);
  }
  const e = new KeyboardEvent("keydown", { key: "F10", bubbles: true, cancelable: true });
  tab(r, 0).dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
});

test("REQ061_AC13_partie_vide_et_actionsDroite_laissent_le_menu_du_navigateur", () => {
  const surMenu = vi.fn();
  const r = fichiers({ surMenu });
  document.body.append(r);
  expect(clicDroit(r).defaultPrevented).toBe(false);
  expect(clicDroit(r.querySelector(".onglets-droite button")).defaultPrevented).toBe(false);
  expect(surMenu).not.toHaveBeenCalled();
});

test("REQ068_AC13_onglet_claude_icone_croix_title_sans_statut", () => {
  const r = onglets({
    actif: "claude-1",
    onglets: [
      { id: "a", libelle: "a.rs", fermable: true },
      { id: "claude-1", libelle: "Claude 1", icone: "asterisk", titre: "Claude Code dans ~/code/projet", fermable: true },
    ],
  });
  const t = tab(r, 1);
  expect(t.querySelector("svg").getAttribute("data-icone")).toBe("asterisk");
  expect(t.textContent).toBe("Claude 1");
  expect(t.title).toBe("Claude Code dans ~/code/projet");
  expect(t.getAttribute("aria-label")).toBe("Claude 1");
  expect(t.getAttribute("aria-selected")).toBe("true");
  expect(t.hasAttribute("data-modifie")).toBe(false);
  expect(t.querySelector(".onglet-question")).toBeNull();
  expect(t.querySelector(".onglet-nom").className).toBe("onglet-nom");
  expect(r.querySelectorAll(".onglet-cellule")[1].querySelector('[aria-label="Fermer Claude 1"]')).not.toBeNull();
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  expect(css).toMatch(/\.ya-tabs \.onglet svg\s*\{[^}]*width: 15px/);
});
