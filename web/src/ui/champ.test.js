import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { champ } from "./champ.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((x) => x.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};

test("REQ028_AC3_champ_texte_libelle_lie_et_sans_correcteur", () => {
  const c = champ({ libelle: "Nom", valeur: "abc" });
  const input = c.querySelector("input");
  expect(input.value).toBe("abc");
  expect(input.spellcheck).toBe(false);
  expect(c.querySelector("label").htmlFor).toBe(input.id);
  expect(c.querySelector("label").textContent).toBe("Nom");
});

test("REQ028_AC3_champ_types", () => {
  const mdp = champ({ libelle: "Mot de passe", type: "motDePasse" }).querySelector("input");
  expect(mdp.type).toBe("password");
  expect(mdp.getAttribute("autocomplete")).toBe("current-password");
  const ml = champ({ libelle: "Message", type: "multiligne" }).querySelector("textarea");
  expect(ml.rows).toBe(2);
  expect(ml.spellcheck).toBe(false);
  const l = champ({ libelle: "Branche", type: "liste", options: ["main", "dev"], valeur: "dev" }).querySelector("select");
  expect([...l.options].map((o) => o.value)).toEqual(["main", "dev"]);
  expect(l.value).toBe("dev");
  expect(() => champ({ libelle: "x", type: "autre" })).toThrow(/type/);
});

test("REQ028_AC3_champ_aide_et_erreur_reliees", () => {
  const c = champ({ libelle: "Nom", aide: "Un mot", erreur: "Obligatoire" });
  const input = c.querySelector("input");
  const aide = c.querySelector(".champ-aide");
  const err = c.querySelector(".champ-erreur");
  expect(aide.textContent).toBe("Un mot");
  expect(err.textContent).toBe("Obligatoire");
  expect(err.getAttribute("role")).toBe("alert");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const ids = input.getAttribute("aria-describedby").split(" ");
  expect(ids).toEqual([aide.id, err.id]);
});

test("REQ028_AC3_champ_sans_aide_ni_erreur", () => {
  const input = champ({ libelle: "Nom" }).querySelector("input");
  expect(input.hasAttribute("aria-describedby")).toBe(false);
  expect(input.hasAttribute("aria-invalid")).toBe(false);
});

test("REQ028_AC3_champ_libelle_masque_et_desactive", () => {
  const c = champ({ libelle: "Rechercher", libelleMasque: true, desactive: true });
  expect(c.querySelector("label").classList.contains("masque")).toBe(true);
  expect(c.querySelector("input").disabled).toBe(true);
});

test("REQ028_AC3_champ_ids_uniques", () => {
  const a = champ({ libelle: "A" }).querySelector("input").id;
  const b = champ({ libelle: "B" }).querySelector("input").id;
  expect(a).not.toBe(b);
});

test("REQ028_AC3_champ_liste_sans_valeur_selectionne_la_premiere_option", () => {
  const l = champ({ libelle: "Branche", type: "liste", options: ["main", "dev"] }).querySelector("select");
  expect(l.selectedIndex).toBe(0);
  expect(l.value).toBe("main");
});

test("REQ036_AC1_champ_a_les_classes_du_design_system", () => {
  expect(champ({ libelle: "Nom" }).querySelector("input").classList.contains("ya-input")).toBe(true);
  const ml = champ({ libelle: "Message", type: "multiligne" }).querySelector("textarea");
  expect(ml.classList.contains("ya-input") && ml.classList.contains("ya-textarea")).toBe(true);
  expect(champ({ libelle: "Branche", type: "liste", options: ["a"] }).querySelector("select").classList.contains("ya-input")).toBe(true);
});

test("REQ033_AC14_indication_devient_le_placeholder_en_ink_muted", () => {
  expect(champ({ libelle: "Nom", indication: "ex. notes.txt" }).querySelector("input").placeholder).toBe("ex. notes.txt");
  expect(champ({ libelle: "Nom" }).querySelector("input").placeholder).toBe("");
  expect(regle(".ya-input::placeholder")).toContain("color: var(--ink-muted)");
});

test("REQ052_AC9_secret_password_autocomplete_off_vide", () => {
  const c = champ({ libelle: "Clé d'API", type: "secret", valeur: "sk-prerempli" });
  const input = c.querySelector("input");
  expect(input.type).toBe("password");
  expect(input.getAttribute("autocomplete")).toBe("off");
  expect(input.value).toBe("");
  expect(input.spellcheck).toBe(false);
  expect(c.querySelector("label").htmlFor).toBe(input.id);
});

test("REQ053_AC6_case_native_libelle_et_valeur", () => {
  const c = champ({ libelle: "Recherche web", type: "case", valeur: true, aide: "Utilise DuckDuckGo" });
  const input = c.querySelector("input");
  expect(input.type).toBe("checkbox");
  expect(input.checked).toBe(true);
  expect(champ({ libelle: "x", type: "case" }).querySelector("input").checked).toBe(false);
  const label = c.querySelector("label");
  expect(label.htmlFor).toBe(input.id);
  expect(label.textContent).toBe("Recherche web");
  // Libellé à droite de la case, aide dessous.
  const enfants = [...c.children];
  expect(enfants.indexOf(input)).toBeLessThan(enfants.indexOf(label));
  expect(enfants.at(-1).textContent).toBe("Utilise DuckDuckGo");
  expect(input.getAttribute("aria-describedby")).toBe(enfants.at(-1).id);
  expect(regle(".ya-case")).toContain("accent-color: var(--accent)");
  expect(regle(".ya-case input")).toContain("width: 14px");
  expect(regle(".ya-case input:focus-visible")).toContain("outline: 2px solid var(--accent-fg)");
  expect(regle(".ya-case input:focus-visible")).toContain("outline-offset: 1px");
});

test("REQ053_clavier_decimal_et_numerique_sans_type_number", () => {
  const dec = champ({ libelle: "Température", clavier: "decimal" }).querySelector("input");
  expect(dec.getAttribute("inputmode")).toBe("decimal");
  expect(dec.type).toBe("text");
  const num = champ({ libelle: "Tokens", clavier: "numerique" }).querySelector("input");
  expect(num.getAttribute("inputmode")).toBe("numeric");
  expect(num.type).toBe("text");
  expect(champ({ libelle: "Nom" }).querySelector("input").hasAttribute("inputmode")).toBe(false);
  expect(() => champ({ libelle: "x", clavier: "autre" })).toThrow(/clavier/);
});

test("REQ064_AC11_case_en_ligne_nom_accessible_avatar_masque_action_apres", async () => {
  const { avatar } = await import("./avatar.js");
  const { bouton } = await import("./bouton.js");
  const av = avatar({ nom: "Relecteur", avatar: "🦉", couleur: "vert" });
  const modifier = bouton({ icone: "sliders-horizontal", nomAccessible: "Modifier Relecteur", taille: "normale" });
  const c = champ({ libelle: "Relecteur", type: "case", presentation: "ligne", avant: av, action: modifier.enveloppe });
  document.body.append(c);
  const input = c.querySelector("input");
  const label = c.querySelector("label");
  expect(input.type).toBe("checkbox");
  expect(label.contains(input)).toBe(true);
  // Ordre : case, avatar, nom ; l'action est hors du label, après lui.
  expect([...label.children].map((e) => e.className)).toEqual(["", "ya-avatar emoji", "nom"]);
  expect(label.querySelector(".nom").textContent).toBe("Relecteur");
  expect(label.querySelector(".nom").title).toBe("Relecteur");
  expect(av.getAttribute("aria-hidden")).toBe("true");
  expect(label.contains(modifier)).toBe(false);
  expect(c.lastElementChild).toBe(modifier.enveloppe);
  expect(c.querySelector(".champ-aide, .champ-erreur")).toBeNull();
  expect(regle(".ya-check-row")).toContain("height: 28px");
  expect(regle(".ya-check-row")).toContain("padding: 0 var(--space-1) 0 var(--space-3)");
  expect(regle(".ya-check-row:hover")).toContain("background: var(--hover)");
  expect(regle(".ya-check-row .nom")).toContain("text-overflow: ellipsis");
  expect(champ({ libelle: "x", type: "case", presentation: "ligne", valeur: true }).querySelector("input").checked).toBe(true);
  expect(() => champ({ libelle: "x", type: "case", presentation: "large" })).toThrow(/presentation/);
  c.remove();
});

test("REQ067_AC14_clic_sur_le_nom_coche", () => {
  const c = champ({ libelle: "Relecteur", type: "case", presentation: "ligne" });
  document.body.append(c);
  const input = c.querySelector("input");
  expect(input.checked).toBe(false);
  c.querySelector(".nom").click();
  expect(input.checked).toBe(true);
  c.querySelector(".nom").click();
  expect(input.checked).toBe(false);
  c.remove();
});

test("REQ065_AC7_couleur_six_radios_un_arret_droite_et_coche", () => {
  const c = champ({ libelle: "Couleur", type: "couleur", valeur: "rose" });
  expect(c.tagName).toBe("FIELDSET");
  expect(c.querySelector("legend").textContent).toBe("Couleur");
  const radios = [...c.querySelectorAll("input[type=radio]")];
  expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["Violet", "Vert", "Orange", "Rose", "Sarcelle", "Gris"]);
  expect(radios.map((r) => r.value)).toEqual(["violet", "vert", "orange", "rose", "sarcelle", "gris"]);
  // Même nom : groupe natif, un seul arrêt de Tab (la couleur choisie).
  expect(new Set(radios.map((r) => r.name)).size).toBe(1);
  expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(["rose"]);
  expect(radios[3].nextElementSibling.querySelector("svg[data-icone=check]").getAttribute("width")).toBe("12");
  expect(radios[3].nextElementSibling.style.getPropertyValue("--c")).toBe("var(--agent-rose)");
  expect(regle(".ya-swatch")).toContain("width: 24px");
  expect(regle(".ya-swatch span")).toContain("width: 20px");
  expect(regle(".ya-swatch svg")).toContain("display: none");
  expect(regle(".ya-swatch input:checked + span svg")).toContain("display: block");
  expect(regle(".ya-swatch:hover span")).toContain("1px var(--ink)");
  expect(regle(".ya-swatch:has(input:focus-visible)")).toContain("outline: 2px solid var(--accent-fg)");
  expect(regle(".ya-swatches")).toContain("gap: var(--space-1)");
  radios[1].click();
  expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(["vert"]);
  // Par défaut : violet. Une couleur inconnue est refusée.
  expect(champ({ libelle: "Couleur", type: "couleur" }).querySelector("input:checked").value).toBe("violet");
  expect(() => champ({ libelle: "Couleur", type: "couleur", valeur: "bleu" })).toThrow(/couleur/);
});

test("REQ074_AC14_barre_libelle_visible_et_lie", () => {
  const r = champ({ libelle: "Modèle", type: "liste", presentation: "barre", options: ["a", "b"], valeur: "b", aide: "x", erreur: "y" });
  const label = r.querySelector("label");
  const select = r.querySelector("select");
  expect(r.classList.contains("ya-barre")).toBe(true);
  expect(r.firstElementChild).toBe(label);
  expect(label.htmlFor).toBe(select.id);
  expect(label.textContent).toBe("Modèle");
  expect(label.classList.contains("masque")).toBe(false);
  expect(r.querySelector(".champ-aide, .champ-erreur")).toBeNull();
  expect(select.hasAttribute("aria-describedby")).toBe(false);
  expect(select.value).toBe("b");
});

test("REQ074_barre_refusee_hors_liste", () => {
  for (const type of ["texte", "motDePasse", "secret", "multiligne", "case", "couleur"]) {
    expect(() => champ({ libelle: "X", type, presentation: "barre" })).toThrow(/barre/);
  }
});

test("REQ074_barre_desactivee_select_disabled", () => {
  const r = champ({ libelle: "Effort", type: "liste", presentation: "barre", options: ["a"], desactive: true });
  expect(r.querySelector("select").disabled).toBe(true);
});

test("REQ086_AC13_ligne_de_panneau_select_nomme_Worktree_et_options_valeur_texte", () => {
  const r = champ({ libelle: "Worktree", type: "liste", presentation: "barre", ligne: true, options: [{ valeur: "", texte: "yaide (main)" }, { valeur: "../essai", texte: "essai (essai)" }], valeur: "../essai" });
  const select = r.querySelector("select");
  expect(r.classList.contains("ya-barre")).toBe(true);
  expect(r.classList.contains("ya-ligne")).toBe(true);
  expect(select.labels[0].textContent).toBe("Worktree");
  expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([["", "yaide (main)"], ["../essai", "essai (essai)"]]);
  expect(select.value).toBe("../essai");
  expect(select.title).toBe("essai (essai)");
});

test("REQ086_AC13_ligne_texte_long_title_entier_et_desactivee_avec_raison", () => {
  const long = "x".repeat(60) + " (main)";
  const r = champ({ libelle: "Worktree", type: "liste", presentation: "barre", ligne: true, options: [{ valeur: "", texte: long }] });
  expect(r.querySelector("select").title).toBe(long);
  const d = champ({ libelle: "Worktree", type: "liste", presentation: "barre", ligne: true, options: ["a"], desactive: true, raison: "Attendez la fin du push." });
  expect(d.querySelector("select").disabled).toBe(true);
  expect(d.querySelector("select").title).toBe("Attendez la fin du push.");
});

test("REQ086_AC13_ligne_refusee_hors_barre", () => {
  expect(() => champ({ libelle: "X", type: "liste", ligne: true })).toThrow(/ligne/);
});

test("REQ086_AC13_ligne_css_28px_marges_12px_opacite", () => {
  expect(css).toMatch(/\.ya-barre\.ya-ligne\s*\{[^}]*height:\s*28px[^}]*padding-inline:\s*var\(--space-3\)/);
  expect(css).toMatch(/\.ya-barre\.ya-ligne:has\(select:disabled\)[^}]*opacity:\s*\.45/);
});

test("REQ086_AC13_ligne_titre_recalcule_apres_mise_a_jour_en_place", () => {
  const r = champ({ libelle: "Worktree", type: "liste", presentation: "barre", ligne: true, options: [{ valeur: "", texte: "a (main)" }, { valeur: "b", texte: "b (b)" }], raison: "Attendez la fin du pull." });
  const s = r.querySelector("select");
  s.value = "b";
  r.actualiserTitre();
  expect(s.title).toBe("b (b)");
  s.disabled = true;
  r.actualiserTitre();
  expect(s.title).toBe("Attendez la fin du pull.");
  s.disabled = false;
  r.actualiserTitre();
  expect(s.title).toBe("b (b)");
  s.disabled = true;
  r.actualiserTitre("Attendez la fin du push.");
  expect(s.title).toBe("Attendez la fin du push.");
});

test("REQ086_AC13_ligne_focus_accent_et_select_natif_sans_clavier_maison", () => {
  const r = champ({ libelle: "Worktree", type: "liste", presentation: "barre", ligne: true, options: ["a", "b"] });
  const s = r.querySelector("select");
  expect(s.tagName).toBe("SELECT");
  expect(s.classList.contains("ya-input")).toBe(true);
  expect(css).toMatch(/\.ya-input:focus-visible\s*\{[^}]*outline:\s*1px solid var\(--accent-fg\)/);
  const src = readFileSync("web/src/ui/champ.js", "utf8");
  expect(src).not.toMatch(/keydown|keyup|keypress/);
});

test("REQ096_AC15_multiligne_sans_retour_une_valeur_par_ligne_aide_et_erreur_reliees", () => {
  const c = champ({ libelle: "Arguments", type: "multiligne", sansRetour: true, valeur: "-y\npaquet", aide: "Un argument par ligne.", erreur: "Refusé" });
  const t = c.querySelector("textarea");
  expect(t.getAttribute("wrap")).toBe("off");
  expect(t.rows).toBe(3);
  expect(t.spellcheck).toBe(false);
  expect(t.value.split("\n")).toEqual(["-y", "paquet"]);
  expect(t.getAttribute("aria-invalid")).toBe("true");
  const ids = t.getAttribute("aria-describedby").split(" ");
  expect(ids.map((i) => c.querySelector(`#${i}`).textContent)).toEqual(["Un argument par ligne.", "Refusé"]);
  expect(c.querySelector(".champ-erreur").getAttribute("role")).toBe("alert");
  // Entrée ajoute une ligne : dans un dialogue, la touche n'est ni interceptée ni détournée (pas de validation).
  const dlg = document.createElement("dialog");
  dlg.append(c);
  document.body.append(dlg);
  t.focus();
  const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  t.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(false);
  dlg.remove();
  expect(regle(".ya-textarea")).toContain("resize: vertical");
  // Sans `sansRetour`, le champ garde son aspect et ne coupe pas son wrap.
  expect(champ({ libelle: "Notes", type: "multiligne" }).querySelector("textarea").hasAttribute("wrap")).toBe(false);
  expect(() => champ({ libelle: "Nom", sansRetour: true })).toThrow(/multiligne/);
});

async function listeAvecAction(opts = {}, boutonOpts = {}) {
  const { bouton } = await import("./bouton.js");
  const b = bouton({ icone: "trash", nomAccessible: "Supprimer le worktree", taille: "normale", ...boutonOpts });
  const c = champ({ libelle: "Worktree", type: "liste", options: ["a", "b"], presentation: "barre", ligne: true, action: b.enveloppe, ...opts });
  document.body.append(c);
  return { c, bt: c.querySelector("button"), select: c.querySelector("select") };
}

test("REQ099_AC10_liste_en_barre_action_apres_la_liste_dans_la_meme_ligne_arret_de_tab_apres_elle", async () => {
  const { c, bt, select } = await listeAvecAction();
  expect([...c.children].map((e) => e.tagName)).toEqual(["LABEL", "SELECT", "SPAN"]);
  expect(c.lastElementChild.contains(bt)).toBe(true);
  expect(bt.disabled).toBe(false);
  expect(select.compareDocumentPosition(bt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const sans = champ({ libelle: "Branche", type: "liste", options: ["a"], presentation: "barre" });
  const { bouton } = await import("./bouton.js");
  const b2 = bouton({ icone: "trash", nomAccessible: "Supprimer", taille: "normale" });
  const avec = champ({ libelle: "Branche", type: "liste", options: ["a"], presentation: "barre", action: b2.enveloppe });
  expect(sans.querySelector("button")).toBeNull();
  expect(avec.lastElementChild).toBe(b2.enveloppe);
  expect(() => champ({ libelle: "x", type: "texte", action: b2.enveloppe })).toThrow(/action/);
  expect(() => champ({ libelle: "x", type: "liste", options: ["a"], action: b2.enveloppe })).toThrow(/action/);
  expect(() => champ({ libelle: "x", type: "case", action: b2.enveloppe })).toThrow(/action/);
});

test("REQ099_AC11_bouton_a_son_propre_etat_desactive_et_suit_celui_de_la_liste", async () => {
  const seul = await listeAvecAction({}, { desactive: true });
  expect(seul.select.disabled).toBe(false);
  expect(seul.bt.disabled).toBe(true);
  const liste = await listeAvecAction({ desactive: true });
  expect(liste.select.disabled).toBe(true);
  expect(liste.bt.disabled).toBe(true);
  const actif = await listeAvecAction();
  expect(actif.bt.disabled).toBe(false);
});

test("REQ099_AC10_css_bouton_a_4_px_de_la_liste_sans_retrecir_et_attenuation_limitee_a_la_liste", () => {
  expect(regle(".ya-barre .bouton-enveloppe")).toContain("flex: none");
  expect(css).toMatch(/\.ya-barre:has\(select:disabled\) \.champ-libelle/);
  expect(css).toMatch(/\.ya-barre\.ya-ligne:has\(select:disabled\) \.ya-input/);
  expect(css).not.toMatch(/\.ya-barre:has\(:disabled\)/);
});
