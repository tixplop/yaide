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
  expect(tab(r, 0).textContent).toContain("●");
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
  expect(surFermer).toHaveBeenCalledWith("a");
  surFermer.mockClear();
  touche(tab(r, 0), "Delete");
  expect(surFermer).toHaveBeenCalledWith("a");
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
  expect(regle('.onglet[aria-selected="true"]')).toContain("color: var(--texte)");
  expect(regle('.onglet[aria-selected="true"]')).toContain("var(--trait-fort) solid var(--accent-fg)");
  expect(regle(".onglet:focus-visible")).toContain("outline: var(--trait-fort) solid var(--accent-fg)");
  expect(regle(".onglet")).toContain("color: var(--texte-attenue)");
  expect(regle(".onglet:hover")).toContain("background: var(--surface-haute)");
  expect(regle(".onglet-question")).toContain("color: var(--alerte)");
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

test("REQ028_AC3_variantes_rail_et_horizontale", () => {
  expect(regle(".onglets-verticale .onglet")).toContain("width: var(--largeur-rail)");
  expect(regle(".onglets-verticale .onglet")).toContain("height: var(--largeur-rail)");
  expect(regle(".onglets-verticale .onglet")).toContain("font-weight: var(--graisse-forte)");
  expect(regle('.onglets-verticale .onglet[aria-selected="true"]')).toContain("border-left: var(--trait-fort) solid var(--accent-fg)");
  expect(regle(".onglets-horizontale")).toContain("height: var(--hauteur-onglet)");
  expect(regle(".onglets-horizontale")).toContain("overflow-x: auto");
  expect(regle('.onglet[aria-selected="true"]')).toContain("font-weight: var(--graisse-forte)");
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

test("REQ033_AC8_rail_fond_et_onglet_actif_aux_couleurs_du_design_system", () => {
  expect(regle(".onglets-verticale")).toContain("background: var(--fond-rail)");
  expect(regle(".onglets-verticale .onglet")).toContain("color: var(--icone-naviguer)");
  expect(regle('.onglets-verticale .onglet[aria-selected="true"]')).toContain("background: var(--surface)");
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
