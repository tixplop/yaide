import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { bouton } from "./bouton.js";

test("REQ028_AC3_bouton_secondaire_par_defaut_et_variantes", () => {
  const b = bouton({ libelle: "Annuler" });
  expect(b.tagName).toBe("BUTTON");
  expect(b.type).toBe("button");
  expect(b.textContent).toBe("Annuler");
  expect(b.classList.contains("bouton-secondaire")).toBe(true);
  expect(bouton({ libelle: "OK", variante: "principal" }).classList.contains("bouton-principal")).toBe(true);
  expect(bouton({ libelle: "Supprimer", variante: "danger" }).classList.contains("bouton-danger")).toBe(true);
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
  const b = bouton({ icone: "trash-2", couleurIcone: "supprimer", nomAccessible: "Supprimer" });
  expect(b.textContent).toBe("");
  expect(b.querySelector("svg").getAttribute("data-icone")).toBe("trash-2");
  expect(b.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
  expect(b.getAttribute("aria-label")).toBe("Supprimer");
  expect(b.hasAttribute("title")).toBe(false);
  expect(b.classList.contains("bouton-icone-supprimer")).toBe(true);
  expect(b.enveloppe.tagName).toBe("SPAN");
  expect(b.enveloppe.firstChild).toBe(b);
});

test("REQ031_AC1_bouton_sans_icone_ni_libelle_ou_sans_nom_est_refuse", () => {
  expect(() => bouton({ icone: "x" })).toThrow(/nomAccessible/);
  expect(() => bouton({ nomAccessible: "a" })).toThrow(/libelle/);
  expect(() => bouton({ icone: "x", nomAccessible: "a", couleurIcone: "rose" })).toThrow(/couleurIcone/);
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

test("REQ031_AC7_bouton_a_icone_en_cours_affiche_l_icone_et_le_texte", () => {
  const b = bouton({ icone: "arrow-down-to-line", couleurIcone: "distant", nomAccessible: "Pull", libelleEnCours: "Pull en cours…" });
  expect(b.disabled).toBe(true);
  expect(b.getAttribute("aria-busy")).toBe("true");
  expect(b.querySelector("svg")).not.toBeNull();
  expect(b.querySelector(".bouton-en-cours").textContent).toBe("Pull en cours…");
  expect(b.getAttribute("aria-label")).toBe("Pull");
  expect(regle(".bouton-en-cours")).toContain("color: var(--texte-attenue)");
  // Le bouton en cours est désactivé : sa règle de rôle doit aussi couvrir :disabled et battre la règle générique.
  for (const c of ["naviguer", "creer", "supprimer", "distant"]) expect(css).toContain(`.bouton-icone-${c}:disabled`);
  expect(regle(".bouton-icone-distant:disabled")).toContain("color: var(--icone-distant)");
});

test("REQ031_AC1_bouton_principal_a_icone_garde_la_couleur_du_texte_sur_accent", () => {
  const b = bouton({ icone: "git-commit-horizontal", nomAccessible: "Commit", variante: "principal" });
  expect(b.classList.contains("bouton-principal") && b.classList.contains("bouton-icone")).toBe(true);
  for (const sel of [".bouton-principal.bouton-icone", ".bouton-principal.bouton-icone:hover", ".bouton-principal.bouton-icone:active"]) expect(regle(sel)).toContain("color: var(--texte-sur-couleur)");
  // La règle vient après celles des rôles, de même spécificité au survol.
  expect(css.indexOf(".bouton-principal.bouton-icone,")).toBeGreaterThan(css.indexOf(".bouton-icone-distant,"));
});

test("REQ031_AC1_icone_et_libelle_s_excluent", () => {
  expect(() => bouton({ icone: "x", libelle: "Fermer" })).toThrow(/s'excluent/);
});

test("REQ031_AC1_presse_pose_aria_pressed_seulement_si_donne", () => {
  expect(bouton({ libelle: "Aperçu" }).hasAttribute("aria-pressed")).toBe(false);
  expect(bouton({ icone: "eye", nomAccessible: "Aperçu", presse: true }).getAttribute("aria-pressed")).toBe("true");
  expect(bouton({ icone: "eye", nomAccessible: "Aperçu", presse: false }).getAttribute("aria-pressed")).toBe("false");
  expect(regle('.bouton[aria-pressed="true"]')).toContain("background: var(--surface-haute)");
});

test("REQ033_AC11_couleurs_des_icones_par_role_et_desactive", () => {
  expect(regle(".bouton-icone-creer")).toContain("color: var(--succes)");
  expect(regle(".bouton-icone-supprimer")).toContain("color: var(--erreur)");
  expect(regle(".bouton-icone-distant")).toContain("color: var(--icone-distant)");
  expect(regle(".bouton-icone-naviguer")).toContain("color: var(--icone-naviguer)");
  expect(regle(".bouton-icone-creer:hover")).toContain("color: var(--succes)");
  expect(regle(".bouton-icone:not(:has(.bouton-en-cours)):disabled")).toContain("color: var(--bordure-champ)");
});

test("REQ031_AC6_bouton_a_icone_mesure_24_px", () => {
  expect(regle(".bouton-icone:not(:has(.bouton-en-cours))")).toContain("width: var(--hauteur-controle)");
  expect(regle(".bouton")).toContain("height: var(--hauteur-controle)");
});

test("REQ031_AC7_bouton_principal_a_icone_en_cours_reste_visible_sur_fond_transparent", () => {
  const b = bouton({ icone: "git-commit-horizontal", nomAccessible: "Commit", variante: "principal", libelleEnCours: "Commit en cours…" });
  expect(b.disabled).toBe(true);
  expect(b.querySelector(".bouton-en-cours")).not.toBeNull();
  expect(regle(".bouton-principal.bouton-icone:has(.bouton-en-cours):disabled")).toContain("color: var(--icone-naviguer)");
  expect(css.indexOf(".bouton-principal.bouton-icone:has(.bouton-en-cours):disabled")).toBeGreaterThan(css.indexOf(".bouton-principal.bouton-icone,"));
});

test("REQ031_AC4_touche_distincte_du_texte_de_l_info_bulle", () => {
  const b = bouton({ icone: "trash-2", nomAccessible: "Supprimer", raccourci: "Suppr", touche: "Delete" });
  expect(b.getAttribute("aria-keyshortcuts")).toBe("Delete");
});
