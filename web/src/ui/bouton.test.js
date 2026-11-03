import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { bouton } from "./bouton.js";

test("REQ028_AC3_bouton_secondaire_par_defaut_et_variantes", () => {
  const b = bouton({ libelle: "Annuler" });
  expect(b.tagName).toBe("BUTTON");
  expect(b.type).toBe("button");
  expect(b.textContent).toBe("Annuler");
  expect(b.classList.contains("bouton-secondaire")).toBe(true);
  expect(b.classList.contains("ya-btn")).toBe(true);
  expect(b.classList.contains("ya-btn-primary") || b.classList.contains("ya-btn-danger")).toBe(false);
  expect(bouton({ libelle: "OK", variante: "principal" }).classList.contains("ya-btn-primary")).toBe(true);
  expect(bouton({ libelle: "Supprimer", variante: "danger" }).classList.contains("ya-btn-danger")).toBe(true);
  expect(bouton({ libelle: "x", variante: "discret" }).classList.contains("bouton-discret")).toBe(true);
});

test("REQ028_AC3_bouton_nom_accessible_et_desactive", () => {
  const b = bouton({ libelle: "+", nomAccessible: "Nouveau shell", desactive: true });
  expect(b.getAttribute("aria-label")).toBe("Nouveau shell");
  expect(b.hasAttribute("title")).toBe(false);
  expect(b.disabled).toBe(true);
});

test("REQ028_AC3_bouton_en_cours_est_desactive_et_occupe", () => {
  const b = bouton({ libelle: "Enregistrer", libelleEnCours: "Enregistrement…" });
  expect(b.textContent).toBe("Enregistrement…");
  expect(b.disabled).toBe(true);
  expect(b.getAttribute("aria-busy")).toBe("true");
  expect(bouton({ libelle: "Enregistrer" }).hasAttribute("aria-busy")).toBe(false);
});

test("REQ028_AC3_bouton_refuse_variante_inconnue_et_libelle_vide", () => {
  expect(() => bouton({ libelle: "a", variante: "rose" })).toThrow(/variante/);
  expect(() => bouton({ libelle: "" })).toThrow(/libelle/);
});

test("REQ028_AC3_bouton_signe_seul_exige_un_nom_accessible", () => {
  expect(() => bouton({ libelle: "×" })).toThrow(/nomAccessible/);
});

test("REQ028_AC3_bouton_submit_dans_un_formulaire", () => {
  expect(bouton({ libelle: "Valider", submit: true }).type).toBe("submit");
});

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((x) => x.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};

test("REQ031_AC1_bouton_a_icone_sans_texte_ni_title_avec_nom_accessible", () => {
  const b = bouton({ icone: "trash", nomAccessible: "Supprimer" });
  expect(b.textContent).toBe("");
  expect(b.querySelector("svg").getAttribute("data-icone")).toBe("trash");
  expect(b.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
  expect(b.getAttribute("aria-label")).toBe("Supprimer");
  expect(b.hasAttribute("title")).toBe(false);
  expect(b.classList.contains("ya-icon-btn")).toBe(true);
  expect(b.classList.contains("ya-btn")).toBe(false);
  expect(b.enveloppe.tagName).toBe("SPAN");
  expect(b.enveloppe.firstChild).toBe(b);
});

test("REQ031_AC1_bouton_sans_icone_ni_libelle_ou_sans_nom_est_refuse", () => {
  expect(() => bouton({ icone: "x" })).toThrow(/nomAccessible/);
  expect(() => bouton({ nomAccessible: "a" })).toThrow(/libelle/);
  expect(() => bouton({ icone: "x", nomAccessible: "a", taille: "enorme" })).toThrow(/taille/);
  expect(() => bouton({ icone: "inconnue", nomAccessible: "a" })).toThrow(/inconnu/);
});

test("REQ031_AC5_info_bulle_nom_et_raccourci_au_survol_et_au_focus", () => {
  vi.useFakeTimers();
  const b = bouton({ icone: "pencil", nomAccessible: "Renommer", infoBulle: "Renommer ou déplacer", raccourci: "F2" });
  document.body.append(b.enveloppe);
  expect(b.getAttribute("aria-keyshortcuts")).toBe("F2");
  b.enveloppe.dispatchEvent(new Event("pointerenter"));
  expect(document.querySelector("[role=tooltip]")).toBeNull();
  vi.advanceTimersByTime(400);
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Renommer ou déplacer (F2)");
  b.enveloppe.dispatchEvent(new Event("pointerleave"));
  const c = bouton({ icone: "plus", nomAccessible: "Nouveau shell" });
  document.body.append(c.enveloppe);
  c.enveloppe.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Nouveau shell");
  c.enveloppe.dispatchEvent(new Event("pointerleave"));
  vi.useRealTimers();
  // Au focus clavier, la bulle apparaît tout de suite, sans attendre 400 ms.
  const d = bouton({ icone: "eye", nomAccessible: "Aperçu", raccourci: "Ctrl+K" });
  document.body.append(d.enveloppe);
  d.focus();
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Aperçu (Ctrl+K)");
  d.blur();
  expect(document.querySelector("[role=tooltip]")).toBeNull();
});

test("REQ031_AC9_bouton_desactive_garde_son_info_bulle_sur_l_enveloppe", () => {
  vi.useFakeTimers();
  const b = bouton({ icone: "pencil", nomAccessible: "Renommer", raccourci: "F2", desactive: true });
  document.body.append(b.enveloppe);
  expect(b.disabled).toBe(true);
  b.enveloppe.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Renommer (F2)");
  expect(regle(".bouton-enveloppe > :disabled")).toContain("pointer-events: none");
  vi.useRealTimers();
});

test("REQ031_AC1_icone_et_libelle_s_excluent", () => {
  expect(() => bouton({ icone: "x", libelle: "Fermer" })).toThrow(/s'excluent/);
});

test("REQ031_AC4_touche_distincte_du_texte_de_l_info_bulle", () => {
  const b = bouton({ icone: "trash", nomAccessible: "Supprimer", raccourci: "Suppr", touche: "Delete" });
  expect(b.getAttribute("aria-keyshortcuts")).toBe("Delete");
});

test("REQ035_AC11_info_bulle_a_droite_sur_demande_et_dessous_par_defaut", () => {
  vi.useFakeTimers();
  const rect = { left: 0, right: 30, top: 100, bottom: 130, width: 30, height: 30 };
  const bulle = (position) => {
    const b = bouton({ icone: "square-x", nomAccessible: "Fermer le shell", positionInfoBulle: position });
    document.body.append(b.enveloppe);
    b.enveloppe.getBoundingClientRect = () => rect;
    b.enveloppe.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(400);
    const t = document.querySelector("[role=tooltip]");
    const pos = [t.style.left, t.style.top];
    b.enveloppe.dispatchEvent(new Event("pointerleave"));
    return pos;
  };
  expect(bulle("droite")).toEqual(["30px", "115px"]);
  expect(bulle(undefined)).toEqual(["15px", "130px"]);
  vi.useRealTimers();
});

test("REQ033_AC11_bouton_sans_role_de_couleur", () => {
  const b = bouton({ icone: "trash", nomAccessible: "Supprimer", couleurIcone: "supprimer" });
  expect([...b.classList].some((c) => c.startsWith("bouton-icone-"))).toBe(false);
  expect(regle(".ya-icon-btn")).toContain("color: var(--ink-muted)");
  expect(regle(".ya-icon-btn:hover")).toContain("color: var(--ink)");
  expect(regle(".ya-icon-btn[disabled]")).toContain("opacity: .45");
});

test("REQ033_AC11_bouton_presse_en_accent_sur_fond_accent_doux", () => {
  expect(bouton({ libelle: "Aperçu" }).hasAttribute("aria-pressed")).toBe(false);
  expect(bouton({ icone: "eye", nomAccessible: "Aperçu", presse: true }).getAttribute("aria-pressed")).toBe("true");
  expect(bouton({ icone: "eye", nomAccessible: "Aperçu", presse: false }).getAttribute("aria-pressed")).toBe("false");
  const r = regle('.ya-icon-btn[aria-pressed="true"]');
  expect(r).toContain("color: var(--accent-fg)");
  expect(r).toContain("background: var(--accent-soft)");
  expect(r).toContain("inset 0 0 0 1px var(--accent-fg)");
});

test("REQ031_AC6_tailles_normale_ligne_et_onglet", () => {
  const classes = (taille) => [...bouton({ icone: "x", nomAccessible: "Fermer", taille }).classList];
  expect(classes("normale")).not.toContain("ya-icon-btn-ligne");
  expect(classes("ligne")).toContain("ya-icon-btn-ligne");
  expect(classes("onglet")).toContain("ya-icon-btn-onglet");
  expect(regle(".ya-icon-btn")).toContain("width: 24px");
  expect(regle(".ya-icon-btn")).toContain("height: 24px");
  expect(regle(".ya-icon-btn-ligne")).toContain("width: 20px");
  expect(regle(".ya-icon-btn-onglet")).toContain("width: 18px");
  expect(regle(".ya-btn")).toContain("height: var(--size-control)");
});

test("REQ036_AC14_survols_du_principal_et_du_danger", () => {
  expect(regle(".ya-btn-primary:hover")).toContain("filter: brightness(.88)");
  expect(regle(".ya-btn-danger:hover")).toContain("background: var(--bg-300)");
  expect(regle(".ya-btn-danger:hover")).toContain("border-color: var(--danger)");
  expect(regle(".ya-btn:hover")).toContain("background: var(--bg-400)");
  expect(regle(".ya-icon-btn:hover")).toContain("background: var(--bg-400)");
  expect(regle(".ya-btn:active")).toContain("inset 0 0 0 1px currentColor");
  expect(regle(".ya-btn:focus-visible")).toContain("outline: 2px solid var(--accent-fg)");
  expect(regle(".ya-btn:focus-visible")).toContain("outline-offset: -2px");
});

test("REQ031_AC7_bouton_a_icone_en_cours_affiche_l_icone_et_le_texte_sans_attenuation", () => {
  const b = bouton({ icone: "arrow-down", nomAccessible: "Pull", libelleEnCours: "Pull en cours…" });
  expect(b.disabled).toBe(true);
  expect(b.getAttribute("aria-busy")).toBe("true");
  expect(b.querySelector("svg")).not.toBeNull();
  expect(b.querySelector(".bouton-en-cours").textContent).toBe("Pull en cours…");
  expect(b.getAttribute("aria-label")).toBe("Pull");
  expect(regle(".bouton-en-cours")).toContain("color: var(--ink-muted)");
  expect(regle('.ya-icon-btn[aria-busy="true"]')).toContain("opacity: 1");
  expect(regle('.ya-icon-btn[aria-busy="true"]')).toContain("cursor: progress");
  expect(css.indexOf('.ya-icon-btn[aria-busy="true"]')).toBeGreaterThan(css.indexOf(".ya-icon-btn[disabled]"));
  const large = regle(".ya-icon-btn:has(.bouton-en-cours)");
  expect(large).toContain("width: auto");
  expect(large).toContain("gap: 4px");
  expect(large).toContain("padding: 0 6px");
});

test("REQ031_AC1_bouton_principal_a_icone_garde_son_fond_et_le_texte_sur_accent", () => {
  const b = bouton({ icone: "check", nomAccessible: "Commit", variante: "principal" });
  expect(b.classList.contains("ya-btn") && b.classList.contains("ya-btn-primary")).toBe(true);
  expect(b.classList.contains("ya-icon-btn")).toBe(false);
  expect(regle(".ya-btn-primary")).toContain("background: var(--accent)");
  expect(regle(".ya-btn-primary")).toContain("color: var(--on-accent)");
});

test("REQ031_AC7_bouton_principal_en_cours_reste_lisible_sur_son_fond_d_accent", () => {
  const b = bouton({ icone: "check", nomAccessible: "Commit", variante: "principal", libelleEnCours: "Commit en cours…" });
  expect(b.disabled).toBe(true);
  expect(b.getAttribute("aria-busy")).toBe("true");
  expect(b.querySelector(".bouton-en-cours").textContent).toBe("Commit en cours…");
  expect(regle(".ya-btn-primary .bouton-en-cours")).toContain("color: var(--on-accent)");
  expect(css.indexOf(".ya-btn-primary .bouton-en-cours")).toBeGreaterThan(css.indexOf(".bouton-en-cours {"));
});

test("REQ031_AC7_bouton_desactive_ne_reagit_pas_mais_le_bouton_en_cours_montre_son_curseur", () => {
  expect(regle(".ya-btn[disabled]")).toContain("pointer-events: none");
  expect(regle(".ya-icon-btn[disabled]")).toContain("pointer-events: none");
  // « Se connecter » en cours : le curseur « progress » reste visible.
  expect(regle('.ya-btn[aria-busy="true"]')).toContain("pointer-events: auto");
  expect(regle('.ya-btn[aria-busy="true"]')).toContain("cursor: progress");
  expect(css.indexOf('.ya-btn[aria-busy="true"]')).toBeGreaterThan(css.indexOf(".ya-btn[disabled]"));
  // Un bouton à icône est sous son enveloppe (C-012) : c'est elle qui porte le curseur.
  expect(regle(".bouton-enveloppe > :disabled")).toContain("pointer-events: none");
  expect(regle('.bouton-enveloppe:has([aria-busy="true"])')).toContain("cursor: progress");
});
