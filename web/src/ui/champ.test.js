import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { champ, MODELES_CRON } from "./champ.js";

const prochaines = vi.hoisted(() => vi.fn());
vi.mock("../api.js", async (orig) => ({ ...(await orig()), prochainesFoisCron: prochaines }));

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

function codeCouleur(extra = {}) {
  const c = champ({ libelle: "Citation, fond", type: "codeCouleur", ...extra });
  document.body.append(c);
  return { c, pastille: c.querySelector('input[type="color"]'), saisie: c.querySelector('input[type="text"]') };
}
function taper(saisie, v) {
  saisie.value = v;
  saisie.dispatchEvent(new Event("input", { bubbles: true }));
}

test("REQ117_AC15_codeCouleur_pastille_hors_tab_puis_champ_nomme", () => {
  const { c, pastille, saisie } = codeCouleur();
  const entrees = [...c.querySelectorAll("input")];
  expect(entrees).toEqual([pastille, saisie]);
  expect(pastille.tabIndex).toBe(-1);
  expect(pastille.getAttribute("aria-label")).toBe("Choisir : Citation, fond");
  expect(saisie.getAttribute("aria-label")).toBe("Citation, fond");
  expect(saisie.placeholder).toBe("par défaut");
  expect(saisie.spellcheck).toBe(false);
  expect(saisie.getAttribute("autocomplete")).toBe("off");
  expect(pastille.classList.contains("vide")).toBe(true);
  expect(c.querySelector("[role=alert]")).toBeNull();
});

test("REQ117_AC15_codeCouleur_la_pastille_ecrit_rrggbb_minuscules_dans_le_champ", () => {
  const { pastille, saisie } = codeCouleur();
  pastille.value = "#ff8800";
  pastille.dispatchEvent(new Event("input", { bubbles: true }));
  expect(saisie.value).toBe("#ff8800");
  expect(pastille.classList.contains("vide")).toBe(false);
});

test("REQ117_AC15_codeCouleur_la_frappe_colore_la_pastille_sans_verifier", () => {
  const { c, pastille, saisie } = codeCouleur();
  taper(saisie, "#F80");
  expect(pastille.classList.contains("vide")).toBe(false);
  expect(pastille.value).toBe("#ff8800");
  taper(saisie, "vert");
  expect(pastille.classList.contains("vide")).toBe(true);
  taper(saisie, "#AABBCC");
  expect(pastille.value).toBe("#aabbcc");
  taper(saisie, "");
  expect(pastille.classList.contains("vide")).toBe(true);
  expect(saisie.hasAttribute("aria-invalid")).toBe(false);
  expect(c.querySelector("[role=alert]")).toBeNull();
  expect(codeCouleur({ valeur: "#f80" }).pastille.value).toBe("#ff8800");
});

test("REQ117_AC15_codeCouleur_erreur_et_desactive", () => {
  const { c, saisie } = codeCouleur({ erreur: "Tapez une couleur #rgb ou #rrggbb, ou laissez vide." });
  const msg = c.messageErreur;
  expect(c.contains(msg)).toBe(false);
  expect(msg.getAttribute("role")).toBe("alert");
  expect(msg.classList.contains("ya-grille-erreur")).toBe(true);
  expect(msg.textContent).toBe("Tapez une couleur #rgb ou #rrggbb, ou laissez vide.");
  expect(saisie.getAttribute("aria-invalid")).toBe("true");
  expect(saisie.getAttribute("aria-describedby")).toBe(msg.id);
  const d = codeCouleur({ desactive: true });
  expect(d.pastille.disabled).toBe(true);
  expect(d.saisie.disabled).toBe(true);
});

const OPENCODE = '{\n  "mcp": {\n    "servers": {\n      "yaide": {\n        "type": "remote",\n        "url": "http://127.0.0.1:9443/mcp",\n        "oauth": false\n      }\n    }\n  }\n}';

test("REQ189_AC11_champ_copie_groupe_nomme_pre_sans_tabindex_bouton_nomme_et_decrit", () => {
  const surCopie = vi.fn();
  const c = champ({ libelle: "Configuration pour opencode", type: "copie", valeur: OPENCODE, aide: "À ajouter au fichier opencode.json du projet.", nomCopier: "Copier la configuration pour opencode", surCopie });
  document.body.append(c);
  expect(c.getAttribute("role")).toBe("group");
  expect(document.getElementById(c.getAttribute("aria-labelledby")).textContent).toBe("Configuration pour opencode");
  const pre = c.querySelector("pre");
  expect(pre.textContent).toBe(OPENCODE);
  expect(pre.textContent.split("\n")).toHaveLength(11);
  expect(pre.hasAttribute("tabindex")).toBe(false);
  expect(pre.hasAttribute("readonly")).toBe(false);
  expect(c.querySelector("input, textarea")).toBeNull();
  const b = c.querySelector("button");
  expect(b.getAttribute("aria-label")).toBe("Copier la configuration pour opencode");
  expect(b.textContent).toBe("Copier");
  expect(document.getElementById(b.getAttribute("aria-describedby")).textContent).toBe("À ajouter au fichier opencode.json du projet.");
  b.click();
  expect(surCopie).toHaveBeenCalledWith(OPENCODE);
  expect(b.textContent).toBe("Copier");
  c.remove();
});

test("REQ189_AC11_champ_copie_exige_nomCopier_commencant_par_Copier_et_surCopie", () => {
  const base = { libelle: "L", type: "copie", valeur: "x", aide: "a", nomCopier: "Copier x", surCopie() {} };
  expect(() => champ({ ...base, nomCopier: undefined })).toThrow(/nomCopier/);
  expect(() => champ({ ...base, nomCopier: "Prendre x" })).toThrow(/nomCopier/);
  expect(() => champ({ ...base, surCopie: undefined })).toThrow(/surCopie/);
});

test("REQ189_AC11_style_copie_par_tokens_et_contrastes_dans_les_deux_themes", () => {
  const pre = regle(".ya-copie-texte");
  expect(pre).toContain("font: 12px/18px var(--font-mono)");
  expect(pre).toContain("background: var(--bg-100)");
  expect(pre).toContain("border: 1px solid var(--line)");
  expect(pre).toContain("border-radius: var(--radius-sm)");
  expect(pre).toContain("margin: 0");
  expect(pre).toContain("padding: 6px var(--space-2)");
  expect(pre).toContain("white-space: pre");
  expect(pre).toContain("overflow-x: auto");
  expect(regle(".ya-copie-tete")).toContain("min-height: var(--size-control)");
  expect(regle(".ya-copie-libelle")).toContain("font: 600 13px/20px var(--font-sans)");
  expect(regle(".ya-copie-libelle")).toContain("color: var(--ink)");
  expect(regle(".ya-copie")).toContain("gap: var(--space-1)");
  const tk = readFileSync("web/src/ui/tokens.css", "utf8");
  const jetons = (bloc) => Object.fromEntries([...bloc.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const sombre = jetons(tk.slice(tk.indexOf(":root"), tk.indexOf('[data-theme="light"]')));
  const clair = { ...sombre, ...jetons(tk.slice(tk.indexOf('[data-theme="light"]'))) };
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const t of [sombre, clair]) {
    expect(ratio(t.ink, t["bg-100"])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.ink, t["bg-300"])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t["ink-muted"], t["bg-300"])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t["line-strong"], t["bg-300"])).toBeGreaterThanOrEqual(3);
    expect(ratio(t["accent-fg"], t["bg-300"])).toBeGreaterThanOrEqual(3);
  }
});

// REQ-204 : type `cron`.
const cron = (opts = {}) => {
  const c = champ({ libelle: "Expression cron", type: "cron", aide: "Cinq champs.", ...opts });
  document.body.append(c);
  return c;
};
const modeles = (c) => c.querySelector("button");
const zone = (c) => c.querySelector("[aria-live]");
const saisirCron = (c, v) => {
  const i = c.querySelector("input");
  i.value = v;
  i.dispatchEvent(new Event("input", { bubbles: true }));
};
const attendre = (ms) => vi.advanceTimersByTimeAsync(ms);
const souris = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

test("REQ204_AC8_modeles_liste_unique_bouton_et_menu_au_clavier", async () => {
  vi.useFakeTimers();
  prochaines.mockResolvedValue({ dates: [] });
  try {
    const c = cron();
    const b = modeles(c);
    expect(MODELES_CRON.map((m) => m.expression)).toEqual(["*/15 * * * *", "0 * * * *", "0 9 * * *", "0 9 * * 1-5", "0 9 * * 1", "0 9 1 * *"]);
    expect(b.textContent).toContain("Modèles");
    expect(b.getAttribute("aria-label")).toBe("Modèles d'expression cron");
    expect(b.getAttribute("aria-haspopup")).toBe("menu");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(c.querySelector("input").nextElementSibling).toBe(b);
    souris(b);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    const m = document.querySelector('[role="menu"]');
    expect(m.getAttribute("aria-label")).toBe("Modèles d'expression cron");
    expect(b.getAttribute("aria-controls")).toBe(m.id);
    const items = [...m.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.getAttribute("aria-label"))).toEqual([
      "Toutes les 15 minutes, */15 * * * *",
      "Toutes les heures, 0 * * * *",
      "Chaque jour à 9 h, 0 9 * * *",
      "Du lundi au vendredi à 9 h, 0 9 * * 1-5",
      "Chaque lundi à 9 h, 0 9 * * 1",
      "Le 1er du mois à 9 h, 0 9 1 * *",
    ]);
    expect(document.activeElement).toBe(items[0]);
    // Échap ferme et rend le focus à « Modèles »
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute("aria-expanded")).toBe("false");
    // Tab aussi
    souris(b);
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(b);
    // un choix au clavier : champ rempli, input émis, focus dans le champ, curseur à la fin
    const vu = vi.fn();
    c.addEventListener("input", vu);
    souris(b);
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const i = c.querySelector("input");
    expect(i.value).toBe("0 * * * *");
    expect(vu).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(i);
    expect([i.selectionStart, i.selectionEnd]).toEqual([9, 9]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    // la requête part aussitôt, sans attendre 300 ms
    await attendre(0);
    expect(prochaines).toHaveBeenLastCalledWith("0 * * * *");
  } finally {
    vi.useRealTimers();
    document.body.replaceChildren();
  }
});

test("REQ204_AC8_lecture_seule_modeles_aria_disabled_sans_ouverture", async () => {
  vi.useFakeTimers();
  prochaines.mockResolvedValue({ dates: [] });
  try {
    const c = cron({ lectureSeule: true, valeur: "0 9 * * 1" });
    const b = modeles(c);
    expect(c.querySelector("input").readOnly).toBe(true);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.disabled).toBe(false);
    souris(b);
    b.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(b.getAttribute("aria-expanded")).toBe("false");
    // les prochaines fois s'affichent quand même
    await attendre(0);
    expect(prochaines).toHaveBeenCalledWith("0 9 * * 1");
  } finally {
    vi.useRealTimers();
    document.body.replaceChildren();
  }
});

test("REQ204_AC9_trois_dates_en_francais_liste_aria_describedby_apres_laide", async () => {
  vi.useFakeTimers();
  prochaines.mockResolvedValue({ dates: ["2026-11-30T09:00", "2026-12-01T09:00", "2026-12-02T09:00"] });
  vi.setSystemTime(new Date(2026, 10, 30, 8, 59, 59));
  try {
    const c = cron({ valeur: "0 9 * * 1-5" });
    await attendre(0);
    const z = zone(c);
    expect(z.getAttribute("aria-live")).toBe("polite");
    expect(z.textContent.startsWith("Prochaines fois :")).toBe(true);
    expect([...z.querySelectorAll("ul > li")].map((li) => li.textContent)).toEqual(["lundi 30 novembre 2026, 09:00", "mardi 1er décembre 2026, 09:00", "mercredi 2 décembre 2026, 09:00"]);
    expect(z.querySelector(".ya-cron-jour").textContent).toBe("lundi 30 novembre 2026,");
    expect(z.querySelector(".ya-cron-heure").textContent).toBe("09:00");
    const i = c.querySelector("input");
    expect(i.getAttribute("aria-describedby")).toBe(`${c.querySelector(".champ-aide").id} ${z.id}`);
    expect(i.hasAttribute("aria-invalid")).toBe(false);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    // les dates sont redemandées quand la première est passée
    prochaines.mockClear();
    await attendre(1400);
    expect(prochaines).not.toHaveBeenCalled();
    await attendre(200);
    expect(prochaines).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    document.body.replaceChildren();
  }
});

test("REQ204_AC5_AC9_illisible_aucune_vide_et_echec_sans_alerte", async () => {
  vi.useFakeTimers();
  prochaines.mockReset();
  try {
    const c = cron();
    await attendre(0);
    // champ vide : zone vide, aucune requête
    expect(zone(c).textContent).toBe("");
    expect(prochaines).not.toHaveBeenCalled();
    saisirCron(c, "   ");
    await attendre(400);
    expect(prochaines).not.toHaveBeenCalled();
    // 300 ms après la dernière frappe seulement
    prochaines.mockResolvedValue({ illisible: true });
    saisirCron(c, "61 * * * *");
    await attendre(299);
    expect(prochaines).not.toHaveBeenCalled();
    await attendre(1);
    expect(prochaines).toHaveBeenCalledWith("61 * * * *");
    expect(zone(c).textContent).toBe("Expression incomplète ou illisible.");
    expect(c.querySelector(".champ-aide").textContent).toBe("Cinq champs.");
    prochaines.mockResolvedValue({ aucune: true });
    saisirCron(c, "0 0 30 2 *");
    await attendre(300);
    expect(zone(c).textContent).toBe("Aucune date prévue.");
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(c.querySelector("input").hasAttribute("aria-invalid")).toBe(false);
    // champ vidé : plus rien
    saisirCron(c, "");
    expect(zone(c).textContent).toBe("");
    // échec de la requête, puis retour de la connexion sans nouvelle frappe
    prochaines.mockResolvedValue({ indisponible: true });
    saisirCron(c, "0 9 * * *");
    await attendre(300);
    expect(zone(c).textContent).toBe("Prochaines fois indisponibles pour le moment.");
    expect(c.querySelector('[role="alert"]')).toBeNull();
    prochaines.mockResolvedValue({ dates: ["2026-11-30T09:00"] });
    await attendre(5100);
    expect(zone(c).textContent).toBe("Prochaines fois :lundi 30 novembre 2026, 09:00");
  } finally {
    vi.useRealTimers();
    document.body.replaceChildren();
  }
});

test("REQ204_AC9_seule_la_derniere_reponse_sapplique", async () => {
  vi.useFakeTimers();
  prochaines.mockReset();
  try {
    const c = cron();
    let rendre;
    prochaines.mockImplementationOnce(() => new Promise((r) => (rendre = r)));
    saisirCron(c, "0 * * * *");
    await attendre(300);
    prochaines.mockResolvedValueOnce({ aucune: true });
    saisirCron(c, "0 0 30 2 *");
    await attendre(300);
    expect(zone(c).textContent).toBe("Aucune date prévue.");
    rendre({ illisible: true });
    await attendre(0);
    expect(zone(c).textContent).toBe("Aucune date prévue.");
  } finally {
    vi.useRealTimers();
    document.body.replaceChildren();
  }
});

test("REQ204_AC7_erreur_de_refus_prend_la_place_de_laide_et_la_zone_reste_citee", async () => {
  vi.useFakeTimers();
  prochaines.mockResolvedValue({ dates: [] });
  try {
    const c = cron({ erreur: "Expression refusée.", aide: undefined, valeur: "x" });
    const i = c.querySelector("input");
    expect(i.getAttribute("aria-invalid")).toBe("true");
    expect(i.getAttribute("aria-describedby")).toBe(`${c.querySelector(".champ-erreur").id} ${zone(c).id}`);
  } finally {
    vi.useRealTimers();
    document.body.replaceChildren();
  }
});

test("REQ204_AC9_premiere_date_lointaine_ne_boucle_pas_sur_les_requetes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 2, 10, 0, 0));
  prochaines.mockReset();
  prochaines.mockResolvedValue({ dates: ["2026-12-27T09:00"] });
  try {
    cron({ valeur: "0 9 1 * *" });
    await attendre(0);
    expect(prochaines).toHaveBeenCalledTimes(1);
    await attendre(1000);
    expect(prochaines).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    document.body.replaceChildren();
  }
});
