import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { readFileSync } from "node:fs";
import { history, undo, redo, undoDepth } from "@codemirror/commands";
import { afterEach, expect, test, vi } from "vitest";
import { apercu } from "./apercu.js";
import { zoneCode } from "./zone-code.js";
import { diagrammesHybride, bornesCellule, texteSaisie, sourceApres, validerSaisie, fondsRegles, decorationsHybride, hybride, lienA, tableauxHybride, insererColonne, insererLigne, supprimerColonne, supprimerLigne, zonesAides } from "./hybride.js";

// Le curseur est en fin de document : une dernière ligne « fin » le tient loin des lignes testées.
function deco(texte, { curseur, plages } = {}) {
  const doc = `${texte}\nfin`;
  const etat = EditorState.create({ doc, selection: { anchor: curseur ?? doc.length }, extensions: [markdown({ base: markdownLanguage })] });
  return { etat, liste: decorationsHybride(etat, plages), doc };
}
const masques = (r) => r.liste.filter((d) => d.masque).map((d) => r.doc.slice(d.debut, d.fin));
const visibles = (r) => r.liste.filter((d) => d.classe === "cm-hy-marque").map((d) => r.doc.slice(d.debut, d.fin));
const stylees = (r, classe) => r.liste.filter((d) => d.classe === classe && !d.ligne).map((d) => r.doc.slice(d.debut, d.fin));
const lignes = (r, classe) => r.liste.filter((d) => d.ligne && d.classe === classe).map((d) => r.doc.slice(d.debut, r.doc.indexOf("\n", d.debut)));

test("REQ062_AC2_titres_taille_par_niveau_et_marques_masquees", () => {
  const r = deco("# Un\n## Deux\n### Trois\n###### Six");
  expect(lignes(r, "cm-hy-titre1")).toEqual(["# Un"]);
  expect(lignes(r, "cm-hy-titre2")).toEqual(["## Deux"]);
  expect(lignes(r, "cm-hy-titre3")).toEqual(["### Trois"]);
  expect(lignes(r, "cm-hy-titre6")).toEqual(["###### Six"]);
  expect(masques(r)).toEqual(["# ", "## ", "### ", "###### "]);
});

test("REQ062_AC2_titre_souligne_garde_la_ligne_de_soulignement_en_muted", () => {
  const r = deco("Titre\n=====\n\nSous\n----");
  expect(lignes(r, "cm-hy-titre1")).toEqual(["Titre"]);
  expect(lignes(r, "cm-hy-titre2")).toEqual(["Sous"]);
  expect(masques(r)).toEqual([]);
  expect(visibles(r)).toEqual(["=====", "----"]);
});

test("REQ062_AC3_gras_italique_barre_cumulables_marques_masquees", () => {
  const r = deco("a **gras** b *ital* c ~~barre~~ d ***tout***");
  expect(stylees(r, "cm-hy-gras")).toContain("gras");
  expect(stylees(r, "cm-hy-italique")).toContain("ital");
  expect(stylees(r, "cm-hy-barre")).toEqual(["barre"]);
  expect(stylees(r, "cm-hy-gras").some((t) => t.includes("tout"))).toBe(true);
  expect(stylees(r, "cm-hy-italique").some((t) => t.includes("tout"))).toBe(true);
  expect(masques(r).filter((m) => m === "**").length).toBeGreaterThanOrEqual(4);
  expect(masques(r)).toContain("~~");
  expect(masques(r)).toContain("*");
});

test("REQ062_AC3_code_en_ligne_style_sur_le_seul_code", () => {
  const r = deco("un `code` ici");
  expect(stylees(r, "cm-hy-code")).toEqual(["code"]);
  expect(masques(r)).toEqual(["`", "`"]);
});

test("REQ062_AC4_lien_texte_style_marques_et_adresse_masquees_sans_href", () => {
  const r = deco("voir [le site](https://exemple.fr) ici");
  expect(stylees(r, "cm-hy-lien")).toEqual(["le site"]);
  expect(masques(r)).toEqual(["[", "](https://exemple.fr)"]);
  // Le lien n'est qu'un style : ni élément <a>, ni href, ni title.
  const parent = document.createElement("div");
  const vue = new EditorView({ doc: r.doc, selection: { anchor: r.doc.length }, parent, extensions: [markdown({ base: markdownLanguage }), hybride()] });
  expect(parent.querySelector(".cm-hy-lien").textContent).toBe("le site");
  expect(parent.querySelector("a, [href], [title]")).toBeNull();
  vue.destroy();
});

test("REQ062_AC4_adresse_seule_a_l_aspect_du_lien_sans_marque_masquee", () => {
  const r = deco("va sur https://exemple.fr ou <https://autre.fr> ok");
  expect(stylees(r, "cm-hy-lien")).toEqual(["https://exemple.fr", "<https://autre.fr>"]);
  expect(masques(r)).toEqual([]);
});

test("REQ062_AC4_marques_visibles_en_muted_sur_la_ligne_du_curseur_seulement", () => {
  const texte = "a **gras** et [lien](http://x.fr)\nb **gras**";
  const sur1 = deco(texte, { curseur: 3 });
  expect(masques(sur1).length).toBe(2); // la seconde ligne reste mise en forme
  expect(visibles(sur1)).toEqual(["**", "**", "[", "](http://x.fr)"]);
  expect(stylees(sur1, "cm-hy-lien")).toEqual(["lien"]);
  const sur2 = deco(texte, { curseur: texte.length - 2 });
  expect(visibles(sur2)).toEqual(["**", "**"]);
  expect(masques(sur2)).toEqual(["**", "**", "[", "](http://x.fr)"]);
});

test("REQ062_AC4_une_selection_sur_plusieurs_lignes_montre_les_marques_de_toutes_ses_lignes", () => {
  const doc = "# a\n# b\n# c\nfin";
  const etat = EditorState.create({ doc, selection: { anchor: 2, head: 6 }, extensions: [markdown({ base: markdownLanguage })] });
  const liste = decorationsHybride(etat);
  expect(liste.filter((d) => d.masque).map((d) => doc.slice(d.debut, d.fin))).toEqual(["# "]);
  expect(liste.filter((d) => d.classe === "cm-hy-marque").map((d) => doc.slice(d.debut, d.fin))).toEqual(["# ", "# "]);
});

test("REQ062_AC5_citation_listes_et_separateur", () => {
  const r = deco("> cite\n> > imbriquée\n\n- un\n* deux\n+ trois\n1. num\n\n---");
  expect(lignes(r, "cm-hy-citation")).toEqual(["> cite", "> > imbriquée"]);
  const masquesTxt = masques(r);
  expect(masquesTxt).toContain("> ");
  const puces = r.liste.filter((d) => d.widget === "puce").map((d) => r.doc.slice(d.debut, d.fin));
  expect(puces).toEqual(["-", "*", "+"]);
  expect(r.liste.filter((d) => d.widget === "trait").map((d) => r.doc.slice(d.debut, d.fin))).toEqual(["---"]);
  // Liste numérotée : le numéro reste.
  expect(r.liste.some((d) => r.doc.slice(d.debut, d.fin) === "1.")).toBe(false);
});

test("REQ062_AC5_puce_et_trait_redeviennent_du_texte_sur_la_ligne_du_curseur", () => {
  const r = deco("- un\n---x\n\n---", { curseur: 1 });
  expect(r.liste.filter((d) => d.widget === "puce")).toEqual([]);
  expect(visibles(r)).toContain("-");
});

test("REQ062_AC6_bloc_clos_toutes_les_lignes_decorees_et_cloture_visible", () => {
  const r = deco("avant\n```js\nconst a = 1;\nb();\n```\naprès");
  expect(lignes(r, "cm-hy-bloc-code")).toEqual(["```js", "const a = 1;", "b();", "```"]);
  expect(masques(r)).toEqual(["```js", "```"]); // AC-062-6 modifié par AC-063-9 : curseur ailleurs, clôtures masquées
  expect(visibles(r)).toEqual([]);
  const sur = deco("avant\n```js\nconst a = 1;\nb();\n```\naprès", { curseur: 14 });
  expect(masques(sur)).toEqual([]);
  expect(visibles(sur)).toEqual(["```js", "```"]);
});

test("REQ062_AC6_bloc_indente_et_bloc_non_ferme", () => {
  const indente = deco("texte\n\n    code un\n    code deux\n\nsuite");
  expect(lignes(indente, "cm-hy-bloc-code")).toEqual(["    code un", "    code deux"]);
  expect(masques(indente)).toEqual([]);
  const ouvert = deco("```\nsans fin", { curseur: 0 });
  expect(visibles(ouvert)).toEqual(["```"]);
  const ouvertLoin = deco("a\n\n```\nsans fin", { curseur: 0 });
  expect(lignes(ouvert, "cm-hy-bloc-code").length).toBeGreaterThanOrEqual(2);
  expect(masques(ouvert)).toEqual([]);
  expect(masques(ouvertLoin)).toEqual(["```"]);
});

test("REQ062_AC7_tableau_image_html_aucune_marque_masquee", () => {
  const r = deco("| a | b |\n|---|---|\n| 1 | 2 |\n\n![alt](http://x/i.png)\n\n<script>alert(1)</script>\n\ntexte <img src=x onerror=alert(1)> fin\n\n- [ ] tâche\n\nnote[^1] et \\*échappé\\*");
  expect(lignes(r, "cm-hy-mono")).toEqual(["| a | b |", "|---|---|", "| 1 | 2 |", "<script>alert(1)</script>"]);
  expect(r.liste.filter((d) => d.masque)).toEqual([]);
  expect(r.liste.filter((d) => d.widget).map((d) => r.doc.slice(d.debut, d.fin))).toEqual(["-"]);
  // Rien n'est créé hors du texte : seuls des styles et des ornements, sans lien.
  expect(stylees(r, "cm-hy-lien")).toEqual([]);
  expect(r.liste.every((d) => d.masque || d.widget || d.classe?.startsWith("cm-hy-"))).toBe(true);
});

test("REQ062_AC7_html_dans_le_dom_reste_du_texte", () => {
  const parent = document.createElement("div");
  const doc = "<img src=x onerror=alert(1)>\n\n<script>window.pwn = 1</script>\n\nfin";
  const vue = new EditorView({ doc, parent, extensions: [markdown({ base: markdownLanguage }), hybride()] });
  expect(parent.querySelector("img, script")).toBeNull();
  expect(window.pwn).toBeUndefined();
  vue.destroy();
});

test("REQ062_AC16_marques_en_muted_sur_la_ligne_du_curseur_le_gras_est_garde", () => {
  const r = deco("a **gras** b", { curseur: 2 });
  expect(visibles(r)).toEqual(["**", "**"]);
  expect(masques(r)).toEqual([]);
  expect(stylees(r, "cm-hy-gras")).toEqual(["gras"]);
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  const regle = css.match(/\.cm-hy-marque\s*\{([^}]*)\}/)[1];
  expect(regle).toContain("var(--ink-muted)");
  expect(regle).toMatch(/font-weight:\s*400/);
  expect(regle).toMatch(/font-style:\s*normal/);
});

test("REQ062_markdown_incomplet_ne_leve_rien", () => {
  for (const t of ["**gras sans fin", "`code", "[lien](", "> ", "# ", "```\nbloc", "~~x", "[a](b", "| a |\n|--"]) {
    const r = deco(t);
    expect(r.liste.every((d) => d.debut <= d.fin && d.fin <= r.doc.length)).toBe(true);
  }
  const r = deco("**gras sans fin");
  expect(stylees(r, "cm-hy-gras")).toEqual([]);
  expect(masques(r)).toEqual([]);
});

test("REQ062_seules_les_plages_visibles_sont_decorees", () => {
  const doc = "# un\n# deux\n# trois\nfin";
  const etat = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage })] });
  const liste = decorationsHybride(etat, [{ from: 5, to: 11 }]);
  expect(liste.filter((d) => d.ligne).map((d) => doc.slice(d.debut, d.debut + 6))).toEqual(["# deux"]);
});

test("REQ062_extension_dans_un_editeur_recalcule_au_changement_de_selection", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const vue = new EditorView({ doc: "# Titre\nfin", selection: { anchor: 10 }, parent, extensions: [markdown({ base: markdownLanguage }), hybride()] });
  expect(vue.dom.classList.contains("cm-hybride")).toBe(true);
  expect(vue.contentDOM.textContent).toBe("Titrefin");
  vue.dispatch({ selection: { anchor: 2 } });
  expect(vue.contentDOM.textContent).toBe("# Titrefin");
  vue.dispatch({ changes: { from: 8, insert: "- a\n" } });
  expect(vue.state.doc.toString()).toBe("# Titre\n- a\nfin");
  vue.destroy();
  parent.remove();
});

test("REQ062_widgets_aria_hidden", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const vue = new EditorView({ doc: "- a\n\n---\n\nfin", selection: { anchor: 12 }, parent, extensions: [markdown({ base: markdownLanguage }), hybride()] });
  const w = [...vue.contentDOM.querySelectorAll(".cm-hy-puce, .cm-hy-trait")];
  expect(w.length).toBe(2);
  for (const e of w) expect(e.getAttribute("aria-hidden")).toBe("true");
  vue.destroy();
  parent.remove();
});

test("REQ062_AC6_fn_dans_un_bloc_rust_est_un_mot_cle_colore", async () => {
  const { supportLangage } = await import("./langages.js");
  const { syntaxTree } = await import("@codemirror/language");
  const { tags, highlightTree } = await import("@lezer/highlight");
  const doc = "```rust\nfn main() {}\n```\n";
  const etat = EditorState.create({ doc, extensions: [supportLangage("markdown")] });
  const mots = [];
  highlightTree(syntaxTree(etat), { style: (t) => (t.includes(tags.keyword) || t.includes(tags.definitionKeyword) ? "kw" : null) }, (de, a, c) => {
    if (c) mots.push(doc.slice(de, a));
  });
  expect(mots).toContain("fn");
});

const TABLE = "| Nom | Valeur |\n|---|:---:|\n| `--fort` | **non** |\n| lien | [Yaide](https://exemple.org) |";
function monter(doc, anchor) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const vue = new EditorView({ doc, selection: { anchor: anchor ?? doc.length }, parent, extensions: [markdown({ base: markdownLanguage }), hybride()] });
  return { vue, parent, fin: () => (vue.destroy(), parent.remove()) };
}

test("REQ063_AC1_tableau_de_4_rangees_sans_pipe_ni_tiret", () => {
  const m = monter(`avant\n\n${TABLE}\n| trois | 3 |\n\nfin`);
  const tables = m.parent.querySelectorAll(".cm-hy-tableau table");
  expect(tables.length).toBe(1);
  expect(tables[0].querySelectorAll("tr").length).toBe(4);
  expect(m.vue.contentDOM.textContent).not.toMatch(/\||---/);
  m.fin();
});

test("REQ063_AC2_gras_code_et_lien_sans_marques_ni_href", () => {
  const m = monter(`${TABLE}\n\nfin`);
  const t = m.parent.querySelector(".cm-hy-tableau");
  expect(t.querySelector("strong").textContent).toBe("non");
  expect(t.querySelector("code").textContent).toBe("--fort");
  const a = t.querySelector("a");
  expect(a.textContent).toBe("Yaide");
  expect(a.hasAttribute("href")).toBe(false);
  expect(a.hasAttribute("title")).toBe(false);
  expect(t.textContent).not.toMatch(/\*\*|`|exemple\.org/);
  m.fin();
});

test("REQ063_AC3_image_et_html_restent_du_texte", () => {
  const m = monter("| a | b |\n|---|---|\n| ![x](https://exemple.org/x.png) | <img src=x onerror=alert(1)> |\n\nfin");
  const t = m.parent.querySelector(".cm-hy-tableau");
  expect(t.querySelector("img")).toBeNull();
  const cellules = t.querySelectorAll("td");
  expect(cellules[0].textContent).toBe("x");
  expect(cellules[1].textContent).toBe("<img src=x onerror=alert(1)>");
  expect(m.parent.querySelector("[href], [title]")).toBeNull();
  m.fin();
});

const SRC = "| a | b \\| c |  |\n|---|---|---|\n|  x | y | z |";

test("REQ153_AC2_bornesCellule_texte_seul_espaces_gardes_cellule_vide_et_pipe_echappe", () => {
  expect(bornesCellule(SRC, 0, 0)).toEqual({ debut: 2, fin: 3 });
  expect(SRC.slice(bornesCellule(SRC, 0, 1).debut, bornesCellule(SRC, 0, 1).fin)).toBe("b \\| c");
  const l3 = SRC.indexOf("|  x");
  expect(bornesCellule(SRC, 1, 0)).toEqual({ debut: l3 + 3, fin: l3 + 4 });
  expect(bornesCellule(SRC, 0, 2)).toEqual({ debut: SRC.indexOf("|  |") + 2, fin: SRC.indexOf("|  |") + 2 });
  expect(bornesCellule(SRC, 9, 0)).toBeNull();
  expect(bornesCellule(SRC, 0, 7)).toBeNull();
  expect(texteSaisie(SRC, 0, 1)).toBe("b | c");
  expect(sourceApres(SRC, 1, 1, "oui")).toBe(SRC.replace("| y |", "| oui |"));
  expect(sourceApres(SRC, 0, 2, "v")).toBe(SRC.replace("|  |", "| v |"));
  expect(sourceApres(SRC, 1, 2, "")).toBe(SRC.replace("| z |", "|  |"));
  expect(sourceApres("a | b\n--|--\nc | d", 1, 1, " e ")).toBe("a | b\n--|--\nc | e");
});

test("REQ153_AC4_pipe_tape_devient_pipe_echappe_meme_nombre_de_colonnes", () => {
  const src = "| a | b |\n|---|---|\n| 1 | 2 |";
  const apres = sourceApres(src, 1, 0, "a|b");
  expect(apres).toBe("| a | b |\n|---|---|\n| a\\|b | 2 |");
  expect(texteSaisie(apres, 1, 0)).toBe("a|b");
});

// Vue avec historique, curseur ligne 1 (« avant »), tableau rendu.
const TAB = "| Option | Défaut | Effet |\n|---|---|---|\n| `--nom` | non | Salue en **capitales**. |\n| `--fort` | non | Plus fort |";
const DOCT = `avant\n\n${TAB}\n\nfin`;
function monterH(doc = DOCT, anchor = 0, options = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const vue = new EditorView({ doc, selection: { anchor }, parent, extensions: [markdown({ base: markdownLanguage }), history(), hybride(options)] });
  const cellules = () => [...parent.querySelectorAll(".cm-hy-tableau td, .cm-hy-tableau th")];
  const clic = (cellule, init = {}) => {
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init });
    cellule.dispatchEvent(e);
    return e;
  };
  const saisie = () => parent.querySelector(".ya-cellule-saisie");
  const touche = (cible, key, init = {}) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    cible.dispatchEvent(e);
    return e;
  };
  const taper = (texte) => {
    saisie().textContent = texte;
  };
  const attendre = () => new Promise((r) => setTimeout(r));
  return { vue, parent, cellules, clic, saisie, touche, taper, attendre, fin: () => (vue.destroy(), parent.remove()) };
}

test("REQ153_AC1_clic_ouvre_une_saisie_dans_le_tableau_sans_toucher_a_l_editeur", async () => {
  const m = monterH();
  const sel = m.vue.state.selection.main.head;
  const e = m.clic(m.cellules()[4]); // rangée 1, colonne 1 : « non »
  expect(e.defaultPrevented).toBe(true);
  expect(m.parent.querySelectorAll(".ya-cellule-saisie").length).toBe(1);
  const s = m.saisie();
  expect(s.getAttribute("role")).toBe("textbox");
  expect(s.getAttribute("aria-multiline")).toBe("false");
  expect(s.getAttribute("contenteditable")).toBe("plaintext-only");
  expect(s.getAttribute("aria-label")).toBe("Défaut, rangée 1");
  expect(document.activeElement).toBe(s);
  expect(m.parent.querySelector(".cm-hy-tableau")).not.toBeNull();
  expect(m.vue.state.selection.main.head).toBe(sel);
  // Une frappe dans la saisie ne change ni le document ni la sélection avant la validation.
  s.textContent = "oui";
  s.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(m.vue.state.doc.toString()).toBe(DOCT);
  expect(m.vue.state.selection.main.head).toBe(sel);
  expect(m.parent.querySelector(".cm-hy-tableau")).not.toBeNull();
  // Une seule saisie : un clic dans une autre cellule valide la première.
  m.clic(m.cellules()[5]);
  await m.attendre();
  expect(m.parent.querySelectorAll(".ya-cellule-saisie").length).toBe(1);
  expect(m.vue.state.doc.toString()).toContain("| `--nom` | oui |");
  m.fin();
});

test("REQ153_AC1_noms_en_tete_et_colonne_sous_en_tete_vide", async () => {
  const m = monterH("avant\n\n|  | B |\n|---|---|\n| 1 | 2 |\n\nfin");
  m.clic(m.cellules()[1]); // th « B »
  expect(m.saisie().getAttribute("aria-label")).toBe("En-tête de la colonne 2");
  m.clic(m.cellules()[2]); // td colonne 1 sous un en-tête vide
  await m.attendre();
  expect(m.saisie().getAttribute("aria-label")).toBe("Colonne 1, rangée 1");
  m.fin();
});

test("REQ153_AC2_entree_ecrit_une_seule_transaction_et_le_tableau_montre_oui", () => {
  const m = monterH();
  let transactions = 0;
  const origine = m.vue.dispatch.bind(m.vue);
  m.vue.dispatch = (...a) => (transactions++, origine(...a));
  m.clic(m.cellules()[4]);
  m.taper("oui");
  m.touche(m.saisie(), "Enter");
  expect(transactions).toBe(1);
  expect(m.vue.state.doc.toString()).toBe(DOCT.replace("| `--nom` | non |", "| `--nom` | oui |"));
  expect(m.cellules()[4].textContent).toBe("oui");
  expect(m.saisie()).toBeNull();
  expect(m.vue.state.selection.main.head).toBe(0);
  m.fin();
});

test("REQ153_AC3_saisie_montre_les_marques_et_entree_sans_changement_n_ecrit_rien", () => {
  const m = monterH();
  m.clic(m.cellules()[5]);
  expect(m.saisie().textContent).toBe("Salue en **capitales**.");
  expect(m.cellules()[4].querySelector("code, strong")).toBeNull();
  expect(m.cellules()[3].querySelector("code").textContent).toBe("--nom");
  expect(m.cellules()[5].querySelector("strong")).toBeNull();
  let transactions = 0;
  const origine = m.vue.dispatch.bind(m.vue);
  m.vue.dispatch = (...a) => (transactions++, origine(...a));
  const profondeur = undoDepth(m.vue.state);
  m.touche(m.saisie(), "Enter");
  expect(transactions).toBe(0);
  expect(undoDepth(m.vue.state)).toBe(profondeur);
  expect(m.saisie()).toBeNull();
  expect(m.cellules()[5].querySelector("strong").textContent).toBe("capitales");
  m.fin();
});

test("REQ153_AC4_pipe_tape_est_echappe_dans_la_source_puis_montre_sans_antislash", () => {
  const m = monterH();
  m.clic(m.cellules()[4]);
  m.taper("a|b");
  m.touche(m.saisie(), "Enter");
  const doc = m.vue.state.doc.toString();
  expect(doc).toContain("| `--nom` | a\\|b | Salue");
  expect(doc.split("\n").find((l) => l.includes("--nom")).match(/(?<!\\)\|/g).length).toBe(4);
  m.clic(m.cellules()[4]);
  expect(m.saisie().textContent).toBe("a|b");
  m.fin();
});

test("REQ153_AC5_echap_abandonne_et_blur_vers_la_ligne_1_valide", () => {
  const m = monterH();
  m.clic(m.cellules()[4]);
  m.taper("oui");
  m.touche(m.saisie(), "Escape");
  expect(m.vue.state.doc.toString()).toBe(DOCT);
  expect(m.saisie()).toBeNull();
  expect(m.cellules()[4].textContent).toBe("non");
  m.clic(m.cellules()[4]);
  m.taper("oui");
  m.vue.contentDOM.focus(); // le focus part vers le texte : blur
  expect(m.vue.state.doc.toString()).toContain("| `--nom` | oui |");
  expect(m.saisie()).toBeNull();
  m.fin();
});

test("REQ153_AC6_tab_et_maj_tab_passent_de_cellule_en_cellule_le_dernier_valide", async () => {
  const m = monterH();
  const sel = m.vue.state.selection.main.head;
  m.clic(m.cellules()[5]); // rangée 1, dernière colonne
  m.taper("X");
  m.touche(m.saisie(), "Tab");
  await m.attendre();
  expect(m.vue.state.doc.toString()).toContain("| X |");
  expect(m.saisie().getAttribute("aria-label")).toBe("Option, rangée 2");
  expect(m.saisie().textContent).toBe("`--fort`");
  m.touche(m.saisie(), "Tab", { shiftKey: true });
  await m.attendre();
  expect(m.saisie().getAttribute("aria-label")).toBe("Effet, rangée 1");
  expect(m.saisie().textContent).toBe("X");
  // Dernier Tab : on va jusqu'à la fin, la dernière validation rend le focus au texte.
  m.clic(m.cellules()[m.cellules().length - 1]);
  await m.attendre();
  m.taper("Fin");
  m.touche(m.saisie(), "Tab");
  await m.attendre();
  expect(m.saisie()).toBeNull();
  expect(m.vue.state.doc.toString()).toContain("| Fin |");
  expect(document.activeElement).toBe(m.vue.contentDOM);
  expect(m.vue.state.selection.main.head).toBe(sel);
  m.fin();
});

test("REQ153_AC7_ctrl_s_valide_avant_que_l_evenement_atteigne_document", () => {
  const m = monterH();
  let vu = null;
  const ecoute = () => (vu = m.vue.state.doc.toString());
  document.addEventListener("keydown", ecoute);
  m.clic(m.cellules()[4]);
  m.taper("oui");
  m.touche(m.saisie(), "s", { ctrlKey: true });
  document.removeEventListener("keydown", ecoute);
  expect(vu).toContain("| `--nom` | oui |");
  m.fin();
});

test("REQ153_AC7_les_autres_touches_de_la_saisie_n_atteignent_pas_document", () => {
  const m = monterH();
  let atteint = 0;
  const ecoute = () => atteint++;
  document.addEventListener("keydown", ecoute);
  m.clic(m.cellules()[4]);
  m.touche(m.saisie(), "a");
  m.touche(m.saisie(), "z", { ctrlKey: true });
  m.touche(m.saisie(), "Enter");
  document.removeEventListener("keydown", ecoute);
  expect(atteint).toBe(0);
  m.fin();
});

test("REQ153_AC12_annuler_et_refaire_une_saisie_validee_a_l_octet_pres", () => {
  const m = monterH();
  m.clic(m.cellules()[4]);
  m.taper("oui");
  m.touche(m.saisie(), "Enter");
  const apres = m.vue.state.doc.toString();
  expect(apres).not.toBe(DOCT);
  undo(m.vue);
  expect(m.vue.state.doc.toString()).toBe(DOCT);
  expect(m.parent.querySelector(".cm-hy-tableau")).not.toBeNull();
  redo(m.vue);
  expect(m.vue.state.doc.toString()).toBe(apres);
  // Deux saisies à la suite sont deux pas d'annulation.
  m.clic(m.cellules()[4]);
  m.taper("peut-être");
  m.touche(m.saisie(), "Enter");
  undo(m.vue);
  expect(m.vue.state.doc.toString()).toBe(apres);
  m.fin();
});

test("REQ153_AC13_ctrl_clic_suit_le_lien_sans_saisie_et_mode_eteint_aucune_cellule_modifiable", () => {
  const surLien = vi.fn();
  const doc = "| a | b |\n|---|---|\n| [Y](docs/x.md) | 2 |\n\nfin";
  const m = monterLiens(doc, { surLien, anchor: doc.length });
  m.evt("mousedown", m.parent.querySelector(".cm-hy-tableau a"), { ctrlKey: true });
  expect(surLien).toHaveBeenCalledWith("docs/x.md");
  expect(m.parent.querySelector(".ya-cellule-saisie")).toBeNull();
  m.evt("mousedown", m.parent.querySelector(".cm-hy-tableau td:last-child"), { ctrlKey: true });
  expect(m.parent.querySelector(".ya-cellule-saisie")).toBeNull();
  m.fin();
  // Mode éteint, puis aperçu : aucune cellule n'est modifiable.
  const allume = zoneCode({ contenu: DOCT.replace(TAB, T3), langage: "markdown", hybride: true });
  document.body.append(allume);
  expect(allume.querySelector(".cm-hy-tableau .ya-tableau-aides")).not.toBeNull();
  allume.remove();
  for (const options of [{ hybride: false }, { hybride: false, apercu: true }]) {
    const z = zoneCode({ contenu: doc, langage: "markdown", ...options });
    document.body.append(z);
    expect(z.querySelector(".cm-hy-tableau")).toBeNull();
    for (const td of z.querySelectorAll("td, th")) td.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    if (options.apercu) expect(z.querySelectorAll("td").length).toBeGreaterThan(0);
    expect(z.querySelector(".ya-cellule-saisie")).toBeNull();
    expect(z.querySelector("[contenteditable=plaintext-only]")).toBeNull();
    z.detruire();
    z.remove();
  }
});

test("REQ153_AC1_curseur_au_clic_sans_marques_a_la_fin_avec_marques", () => {
  const m = monterH();
  document.caretPositionFromPoint = () => ({ offsetNode: document.__noeud, offset: 2 });
  document.__noeud = m.cellules()[3].firstChild.firstChild; // « --nom » dans le code
  m.clic(m.cellules()[3], { clientX: 5, clientY: 5 });
  const sel = document.getSelection();
  expect(m.saisie().textContent).toBe("`--nom`"); // des marques : à la fin
  expect(sel.anchorOffset).toBe(7);
  m.touche(m.saisie(), "Escape");
  document.__noeud = m.cellules()[4].firstChild; // « non »
  m.clic(m.cellules()[4], { clientX: 5, clientY: 5 });
  expect(m.saisie().textContent).toBe("non");
  expect(sel.anchorNode).toBe(m.saisie().firstChild);
  expect(sel.anchorOffset).toBe(2);
  delete document.caretPositionFromPoint;
  m.fin();
});

test("REQ153_AC13_validerSaisie_ecrit_la_saisie_ouverte", () => {
  const m = monterH();
  validerSaisie(m.vue); // aucune saisie : rien
  m.clic(m.cellules()[4]);
  m.taper("oui");
  validerSaisie(m.vue);
  expect(m.vue.state.doc.toString()).toContain("| `--nom` | oui |");
  expect(m.saisie()).toBeNull();
  m.fin();
});
test("REQ063_AC2_tableauxHybride_donne_debut_fin_source_hors_des_lignes_touchees", () => {
  const doc = `avant\n\n${TABLE}\n\nfin\n\n| x |\n|---|\n| y |`;
  const etat = (anchor, head) => EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ base: markdownLanguage })] });
  const debut = doc.indexOf("| Nom");
  const liste = tableauxHybride(etat(0));
  expect(liste.length).toBe(2);
  expect(liste[0]).toEqual({ debut, fin: debut + TABLE.length, source: TABLE });
  expect(tableauxHybride(etat(debut + 3)).map((t) => t.source)).toEqual(["| x |\n|---|\n| y |"]);
  expect(tableauxHybride(etat(0, doc.length))).toEqual([]);
});

test("REQ063_AC6_selection_ailleurs_rendu_et_ctrl_a_texte", () => {
  const doc = `avant\n\n${TABLE}\n\nfin`;
  const m = monter(doc, doc.indexOf("| Nom") + 2);
  expect(m.parent.querySelector(".cm-hy-tableau")).toBeNull();
  m.vue.dispatch({ selection: { anchor: 1 } });
  expect(m.parent.querySelector(".cm-hy-tableau")).not.toBeNull();
  m.vue.dispatch({ selection: { anchor: 0, head: doc.length } });
  expect(m.parent.querySelector(".cm-hy-tableau")).toBeNull();
  m.fin();
});

test("REQ063_AC7_la_frappe_puis_la_sortie_montrent_le_nouveau_texte", () => {
  const doc = `avant\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nfin`;
  const m = monter(doc, doc.indexOf("| 1") + 2);
  m.vue.dispatch({ changes: { from: doc.indexOf("1"), to: doc.indexOf("1") + 1, insert: "neuf" } });
  m.vue.dispatch({ selection: { anchor: 1 } });
  expect([...m.parent.querySelectorAll(".cm-hy-tableau td")].map((c) => c.textContent)).toEqual(["neuf", "2"]);
  m.fin();
});

test("REQ063_AC8_le_document_est_inchange", () => {
  const doc = `avant\n\n${TABLE}\n\n\`\`\`rust\nfn a() {}\n\`\`\`\nfin`;
  const m = monter(doc);
  expect(m.vue.state.doc.toString()).toBe(doc);
  m.fin();
});

const BLOC = "a\nb\n```rust\nfn a() {}\n```\nfin";
test("REQ063_AC9_cloture_masquee_la_ligne_garde_sa_decoration_et_son_numero", () => {
  const m = monter(BLOC);
  const lignes = [...m.parent.querySelectorAll(".cm-line")];
  expect(lignes.length).toBe(6);
  expect(lignes[2].textContent).toBe("");
  expect(lignes[4].textContent).toBe("");
  expect(lignes[2].classList.contains("cm-hy-bloc-code")).toBe(true);
  expect(lignes[4].classList.contains("cm-hy-bloc-code")).toBe(true);
  expect(lignes[3].textContent).toBe("fn a() {}");
  m.fin();
});

test("REQ063_AC10_curseur_sur_une_ligne_du_bloc_ou_sur_la_cloture_les_montre", () => {
  for (const pos of [BLOC.indexOf("fn") + 1, BLOC.indexOf("```rust") + 1]) {
    const m = monter(BLOC, pos);
    const lignes = [...m.parent.querySelectorAll(".cm-line")];
    expect(lignes[2].textContent).toBe("```rust");
    expect(lignes[4].textContent).toBe("```");
    expect(lignes[2].querySelector(".cm-hy-marque")).not.toBeNull();
    m.fin();
  }
});

test("REQ063_AC11_bloc_non_ferme_sa_seule_cloture_et_bloc_indente_inchange", () => {
  const r = deco("a\n```\nsans fin", { curseur: 0 });
  expect(masques(r)).toEqual(["```"]);
  const m = monter("a\n\n    code\n\nfin");
  expect([...m.parent.querySelectorAll(".cm-line")].map((l) => l.textContent)).toEqual(["a", "", "    code", "", "fin"]);
  m.fin();
});

test("REQ063_AC12_table_th_td_sans_tabindex", () => {
  const m = monter(`${TABLE}\n\nfin`);
  const t = m.parent.querySelector(".cm-hy-tableau");
  expect(t.getAttribute("contenteditable")).toBe("false");
  expect(t.querySelectorAll("table, th, td").length).toBeGreaterThan(3);
  expect(m.parent.querySelector(".cm-hy-tableau [tabindex]")).toBeNull();
  m.fin();
});

test("REQ063_AC3_les_regles_du_tableau_de_l_apercu_servent_au_tableau_rendu", () => {
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  for (const sel of ["table", "th, .zone-code-apercu td", "tbody tr:nth-child(even) td"]) expect(css).toMatch(new RegExp(`\\.zone-code-apercu ${sel.replace(/[()]/g, "\\$&")}[^{]*\\.cm-hy-tableau`));
  expect(css).toMatch(/\.cm-hy-tableau \{[^}]*cursor: text/);
});

// Ctrl+clic et survol des liens (REQ-101)
function monterLiens(doc, { anchor, ...options } = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const vue = new EditorView({ doc, selection: { anchor: anchor ?? doc.length }, parent, extensions: [markdown({ base: markdownLanguage }), hybride(options)] });
  const sur = (pos) => {
    vue.posAtCoords = () => pos;
  };
  const evt = (type, cible, init = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
    cible.dispatchEvent(e);
    return e;
  };
  return { vue, parent, sur, evt, fin: () => (vue.destroy(), parent.remove()) };
}
const DOC = "a\n\nun [Lire](../README.md) ici\n\nfin de ligne assez longue pour curseur";

test("REQ101_AC2_lienA_link_autolink_adresse_seule_et_rien_pour_reference_image", () => {
  const doc = "[Lire](../README.md) <https://a.fr> https://b.fr [x][r] ![i](c.png) [^1]\n\n[r]: d.md";
  const etat = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  expect(lienA(etat, 3)).toEqual({ de: 0, a: 20, adresse: "../README.md" });
  expect(lienA(etat, 25).adresse).toBe("https://a.fr");
  expect(lienA(etat, 38).adresse).toBe("https://b.fr");
  for (const mot of ["[x][r]", "![i](c.png)", "[^1]", "c.png"]) expect(lienA(etat, doc.indexOf(mot) + 1)).toBeUndefined();
  expect(lienA(etat, 20)).toBeUndefined();
});

test("REQ101_AC10_suivable_sur_tout_le_lien_ligne_du_curseur_comprise_sauf_adresses_refusees", () => {
  const doc = "[Lire](../README.md)\n\n[x](javascript:alert(1)) [y][r] ![i](c.png)\n\n[Z](https://a.fr)";
  const m = monterLiens(doc, { anchor: 0 });
  const marques = [...m.parent.querySelectorAll(".cm-hy-suivable")].map((e) => e.textContent);
  expect(marques).toEqual(["[Lire](../README.md)", "Z"]);
  m.fin();
});

test("REQ101_AC2_AC13_ctrl_clic_suit_sans_curseur_ajoute_ni_deplacement_clic_simple_n_ouvre_rien", () => {
  const surLien = vi.fn();
  const m = monterLiens(DOC, { surLien, anchor: DOC.length });
  const tete = m.vue.state.selection.main.head;
  const cible = m.parent.querySelector(".cm-hy-lien");
  m.sur(DOC.indexOf("Lire") + 1);
  const e = m.evt("mousedown", cible, { ctrlKey: true });
  expect(e.defaultPrevented).toBe(true);
  expect(surLien).toHaveBeenCalledTimes(1);
  expect(surLien).toHaveBeenCalledWith("../README.md");
  expect(m.vue.state.selection.ranges.length).toBe(1);
  expect(m.vue.state.selection.main.head).toBe(tete);
  expect(m.parent.querySelector(".cm-hy-lien").textContent).toBe("Lire");
  // Ligne du curseur : le lien reste suivi.
  m.vue.dispatch({ selection: { anchor: DOC.indexOf("Lire") + 2 } });
  m.sur(DOC.indexOf("](") + 1);
  m.evt("mousedown", m.vue.contentDOM, { ctrlKey: true });
  expect(surLien).toHaveBeenCalledTimes(2);
  expect(m.vue.state.selection.ranges.length).toBe(1);
  expect(m.vue.state.selection.main.head).toBe(DOC.indexOf("Lire") + 2);
  // Clic simple : rien.
  m.evt("mousedown", cible);
  expect(surLien).toHaveBeenCalledTimes(2);
  m.fin();
});

test("REQ101_AC8_ctrl_clic_sur_adresse_refusee_reference_image_ou_texte_n_appelle_rien", () => {
  const doc = "[x](javascript:alert(1)) [y][r] ![i](c.png) texte\n\nfin";
  const surLien = vi.fn();
  // jsdom n'a pas de rectangles de sélection : le clic ordinaire de CodeMirror en a besoin.
  Range.prototype.getClientRects ??= () => [];
  const m = monterLiens(doc, { surLien, anchor: doc.length });
  for (const mot of ["x]", "y]", "i]"]) {
    m.sur(doc.indexOf(mot));
    m.evt("mousedown", m.vue.contentDOM, { ctrlKey: true });
  }
  expect(surLien).not.toHaveBeenCalled();
  // Sur un lien refusé, la sélection ne bouge pas non plus.
  m.sur(doc.indexOf("x]"));
  expect(m.evt("mousedown", m.vue.contentDOM, { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(m.parent.querySelector(".cm-hy-suivable")).toBeNull();
  m.fin();
});

test("REQ101_AC2_AC13_tableau_rendu_ctrl_clic_suit_le_lien_et_reste_rendu", () => {
  const surLien = vi.fn();
  const doc = "| a | b |\n|---|---|\n| [Y](docs/x.md) | [Z](javascript:alert(1)) |\n\nfin";
  const m = monterLiens(doc, { surLien, anchor: doc.length });
  const [a] = m.parent.querySelectorAll(".cm-hy-tableau a");
  expect(a.dataset.lien).toBe("docs/x.md");
  expect(a.classList.contains("cm-hy-suivable")).toBe(true);
  expect(a.hasAttribute("href")).toBe(false);
  expect(a.hasAttribute("title")).toBe(false);
  const tete = m.vue.state.selection.main.head;
  const e = m.evt("mousedown", a, { ctrlKey: true });
  expect(e.defaultPrevented).toBe(true);
  expect(surLien).toHaveBeenCalledWith("docs/x.md");
  expect(m.vue.state.selection.main.head).toBe(tete);
  expect(m.parent.querySelector(".cm-hy-tableau")).not.toBeNull();
  // Clic simple : la cellule passe en saisie, aucun lien suivi, la sélection ne bouge pas.
  m.evt("mousedown", a);
  expect(surLien).toHaveBeenCalledTimes(1);
  expect(m.vue.state.selection.main.head).toBe(tete);
  m.fin();
});

test("REQ101_AC10_ya_ctrl_pose_et_retire_par_clavier_souris_blur_et_depart", () => {
  const m = monterLiens(DOC);
  const ctrl = () => m.vue.dom.classList.contains("ya-ctrl");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
  expect(ctrl()).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
  expect(ctrl()).toBe(false);
  m.vue.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", bubbles: true }));
  expect(ctrl()).toBe(true);
  window.dispatchEvent(new Event("blur"));
  expect(ctrl()).toBe(false);
  m.sur(0);
  m.evt("mousemove", m.vue.contentDOM, { ctrlKey: true });
  expect(ctrl()).toBe(true);
  m.evt("mousemove", m.vue.contentDOM);
  expect(ctrl()).toBe(false);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
  expect(ctrl()).toBe(false);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
  m.vue.dom.dispatchEvent(new MouseEvent("mouseleave"));
  expect(ctrl()).toBe(false);
  m.fin();
});

test("REQ101_AC11_survol_texte_pour_les_trois_sortes_et_null_hors_lien_ou_refuse", () => {
  const doc = "[Lire](../README.md) [T](#lancer-les-tests) [doc](https://exemple.org/a) [x](javascript:alert(1)) mot\n\nfin";
  const surSurvol = vi.fn();
  const m = monterLiens(doc, { surSurvol, anchor: doc.length });
  const survoler = (mot) => {
    m.sur(doc.indexOf(mot));
    m.evt("mousemove", m.vue.contentDOM);
    return surSurvol.mock.lastCall[0];
  };
  expect(survoler("Lire")).toEqual({ geste: "Ctrl+clic", suite: "pour ouvrir ../README.md" });
  expect(survoler("T]")).toEqual({ geste: "Ctrl+clic", suite: "pour aller à #lancer-les-tests" });
  expect(survoler("doc]")).toEqual({ geste: "Ctrl+clic", suite: "pour ouvrir https://exemple.org/a dans un nouvel onglet" });
  expect(survoler("x]")).toBeNull();
  expect(survoler("mot")).toBeNull();
  survoler("Lire");
  m.vue.dom.dispatchEvent(new MouseEvent("mouseleave"));
  expect(surSurvol.mock.lastCall[0]).toBeNull();
  survoler("Lire");
  window.dispatchEvent(new Event("blur"));
  expect(surSurvol.mock.lastCall[0]).toBeNull();
  m.fin();
});

test("REQ101_AC10_AC11_sur_macOS_cmd_clic_et_meta", () => {
  // estMac est lu à la création : on simule la plateforme.
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  try {
    Range.prototype.getClientRects ??= () => [];
    const surSurvol = vi.fn();
    const surLien = vi.fn();
    const m = monterLiens(DOC, { surSurvol, surLien });
    m.sur(DOC.indexOf("Lire"));
    m.evt("mousemove", m.vue.contentDOM, { metaKey: true });
    expect(surSurvol).toHaveBeenLastCalledWith({ geste: "Cmd+clic", suite: "pour ouvrir ../README.md" });
    expect(m.vue.dom.classList.contains("ya-ctrl")).toBe(true);
    m.evt("mousedown", m.vue.contentDOM, { ctrlKey: true });
    expect(surLien).not.toHaveBeenCalled();
    m.evt("mousedown", m.vue.contentDOM, { metaKey: true });
    expect(surLien).toHaveBeenCalledWith("../README.md");
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    expect(m.vue.dom.classList.contains("ya-ctrl")).toBe(false);
    m.fin();
  } finally {
    vi.unstubAllGlobals();
  }
});

// Sélection sur un fond réglé (REQ-115) : une marque `ya-sel-fond` par plage sélectionnée, sans style.
function selection(texte, de, a, fonds = ["code", "bloc-code", "citation"]) {
  fondsRegles(fonds);
  const etat = EditorState.create({ doc: texte, selection: { anchor: de, head: a }, extensions: [markdown({ base: markdownLanguage })] });
  return decorationsHybride(etat)
    .filter((d) => d.classe?.startsWith("ya-sel-fond"))
    .map((d) => [d.classe, texte.slice(d.debut, d.fin)]);
}

test("REQ115_AC12_selection_dans_un_bloc_de_code_marque_ya_sel_fond_bloc_code", () => {
  const texte = "```rust\nfn main() {}\n```\nfin";
  const de = texte.indexOf("fn main");
  expect(selection(texte, de, de + 7)).toEqual([["ya-sel-fond ya-sel-fond-bloc-code", "fn main"]]);
});

test("REQ115_AC12_selection_dans_une_citation_marque_ya_sel_fond_citation", () => {
  const texte = "> une citation\n\nfin";
  expect(selection(texte, 2, 5)).toEqual([["ya-sel-fond ya-sel-fond-citation", "une"]]);
});

test("REQ115_AC12_selection_dans_un_code_en_ligne_marque_ya_sel_fond_code", () => {
  const texte = "un `code` ici";
  expect(selection(texte, 4, 8)).toEqual([["ya-sel-fond ya-sel-fond-code", "code"]]);
});

test("REQ115_AC12_selection_hors_de_ces_elements_ou_vide_sans_marque", () => {
  const texte = "un `code` ici\n\n> citation\n\nfin";
  expect(selection(texte, 0, 3)).toEqual([]);
  expect(selection(texte, 5, 5)).toEqual([]);
  expect(selection("# Titre\n\nfin", 2, 7)).toEqual([]);
});

test("REQ115_AC12_sans_fond_regle_aucune_marque_ya_sel_fond", () => {
  const texte = "```rust\nfn main() {}\n```\n\n> une citation\n\nun `code` ici";
  expect(selection(texte, 0, texte.length, [])).toEqual([]);
  const bloc = selection(texte, 0, texte.length, ["bloc-code"]);
  expect(bloc.length).toBeGreaterThan(0);
  expect(bloc.every(([c]) => c.endsWith("bloc-code"))).toBe(true);
  fondsRegles([]);
});

test("REQ115_AC12_composants_css_ne_donne_aucun_style_a_ya_sel_fond", () => {
  expect(readFileSync("web/src/ui/composants.css", "utf8")).not.toContain("ya-sel-fond");
});


// --- Diagrammes mermaid rendus (REQ-152) ---
const chargerMock = vi.hoisted(() => vi.fn());
vi.mock("./diagramme.js", async (orig) => ({ ...(await orig()), chargerMermaid: chargerMock }));

const BLOC_D = "```mermaid\ngraph TD; A[Début] --> B[Fin]\n```";
const DOCD = `avant\n\n${BLOC_D}\n\nfin`;
const texteSvg = (img) => decodeURIComponent(img.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
let dessinerMock;
let vuesD = [];
function mermaidFactice() {
  dessinerMock = vi.fn(async (t) => ({ svg: `<svg>${t}</svg>`, largeur: 120, hauteur: 80 }));
  return { dessiner: dessinerMock };
}
async function monterD(doc, { anchor, mermaid = mermaidFactice(), extensions = [hybride()], attendre = true, sansMarkdown = false } = {}) {
  vi.useFakeTimers();
  chargerMock.mockReset().mockResolvedValue(mermaid);
  const parent = document.createElement("div");
  document.body.append(parent);
  const vue = new EditorView({ doc, selection: { anchor: anchor ?? doc.length }, parent, extensions: [...(sansMarkdown ? [] : [markdown({ base: markdownLanguage })]), ...extensions] });
  vuesD.push({ vue, parent });
  if (attendre) await vi.advanceTimersByTimeAsync(150);
  return { vue, parent, imgs: () => [...parent.querySelectorAll(".ya-diagramme img")] };
}
afterEach(() => {
  for (const { vue, parent } of vuesD) (vue.destroy(), parent.remove());
  vuesD = [];
  vi.useRealTimers();
});

test("REQ152_AC1_img_a_la_place_des_lignes_du_bloc_sans_texte_ni_cloture", async () => {
  const m = await monterD(DOCD);
  expect(m.imgs().length).toBe(1);
  expect(texteSvg(m.imgs()[0])).toContain("A[Début] --> B[Fin]");
  const texte = m.vue.contentDOM.textContent;
  expect(texte).not.toContain("graph TD");
  expect(texte).not.toContain("```");
  expect(diagrammesHybride(m.vue.state)).toEqual([{ debut: DOCD.indexOf("```"), fin: DOCD.indexOf("\n\nfin"), texte: "graph TD; A[Début] --> B[Fin]\n" }]);
});

test("REQ152_AC2_curseur_sur_une_ligne_du_bloc_ou_ctrl_a_donne_le_bloc_de_code_ailleurs_l_img", async () => {
  const m = await monterD(DOCD);
  const debut = DOCD.indexOf("```");
  for (const pos of [debut, DOCD.indexOf("graph"), DOCD.indexOf("```", debut + 3) + 3]) {
    m.vue.dispatch({ selection: { anchor: pos } });
    expect(m.imgs().length).toBe(0);
    expect(m.vue.contentDOM.textContent).toContain("graph TD");
  }
  m.vue.dispatch({ selection: { anchor: 0 } });
  expect(m.imgs().length).toBe(1);
  m.vue.dispatch({ selection: { anchor: 0, head: DOCD.length } });
  expect(m.imgs().length).toBe(0);
  expect(m.vue.contentDOM.textContent).toContain("graph TD");
  m.vue.dispatch({ selection: { anchor: DOCD.length } });
  expect(m.imgs().length).toBe(1);
});

test("REQ152_AC3_texte_modifie_puis_curseur_hors_du_bloc_donne_le_nouveau_dessin_sans_ecriture_meme_sans_reseau", async () => {
  const fetchMock = vi.fn(() => Promise.reject(new Error("coupé")));
  vi.stubGlobal("fetch", fetchMock);
  const m = await monterD(DOCD, { anchor: DOCD.indexOf("graph") });
  expect(m.imgs().length).toBe(0);
  const fin = DOCD.indexOf("\n```", DOCD.indexOf("graph"));
  m.vue.dispatch({ changes: { from: fin, insert: "\nB --> C[Suite]" } });
  expect(m.imgs().length).toBe(0);
  m.vue.dispatch({ selection: { anchor: 0 } });
  await vi.advanceTimersByTimeAsync(150);
  expect(m.imgs().length).toBe(1);
  expect(texteSvg(m.imgs()[0])).toContain("Suite");
  expect(dessinerMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(m.vue.state.doc.toString()).toContain("B --> C[Suite]\n```");
  vi.unstubAllGlobals();
});

test("REQ152_AC4_bloc_illisible_reste_un_bloc_de_code_sans_message", async () => {
  const doc = "avant\n\n```mermaid\ngraph TD; A[Début -->\n```\n\nfin";
  const m = await monterD(doc, { mermaid: { dessiner: vi.fn(async () => null) } });
  expect(m.imgs().length).toBe(0);
  expect(m.vue.state.doc.toString()).toBe(doc);
  const texte = m.vue.contentDOM.textContent;
  expect(texte).toContain("graph TD; A[Début -->");
  expect(texte).not.toMatch(/erreur|Chargement|Syntax/i);
  expect(m.parent.querySelector(".ya-diagramme")).toBeNull();
});

test("REQ152_AC5_mousedown_sur_l_img_place_le_curseur_apres_la_ligne_mermaid_et_repasse_en_texte", async () => {
  const m = await monterD(DOCD);
  const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  m.imgs()[0].dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(m.vue.state.selection.main.head).toBe(DOCD.indexOf("graph"));
  expect(m.imgs().length).toBe(0);
  expect(m.vue.contentDOM.textContent).toContain("graph TD");
});

test("REQ152_AC6_aucun_lien_script_ni_foreignObject_dans_le_widget_et_le_clic_n_ouvre_rien", async () => {
  const ouvrir = vi.spyOn(window, "open").mockImplementation(() => null);
  const m = await monterD(DOCD);
  const widget = m.parent.querySelector(".ya-diagramme");
  expect(widget.querySelector("a, script, foreignObject")).toBeNull();
  expect(widget.children.length).toBe(1);
  m.imgs()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(ouvrir).not.toHaveBeenCalled();
  ouvrir.mockRestore();
});

test("REQ152_AC7_deux_img_dans_l_ordre_et_bloc_rust_colore", async () => {
  const doc = "```mermaid\ngraph TD; A --> B\n```\n\n```rust\nfn main() {}\n```\n\n```mermaid\ngraph LR; C --> D\n```\n\nfin";
  const m = await monterD(doc);
  const imgs = m.imgs();
  expect(imgs.length).toBe(2);
  expect(texteSvg(imgs[0])).toContain("graph TD");
  expect(texteSvg(imgs[1])).toContain("graph LR");
  expect(m.vue.contentDOM.textContent).toContain("fn main()");
  expect(m.vue.contentDOM.textContent).not.toContain("graph");
  // `fn` du bloc rust porte la couleur des mots-clés (AC-062-6), dans l'éditeur monté.
  const { supportLangage } = await import("./langages.js");
  const { couleurs } = await import("./couleurs-code.js");
  const { syntaxHighlighting } = await import("@codemirror/language");
  const r = await monterD(doc, { sansMarkdown: true, extensions: [supportLangage("markdown"), syntaxHighlighting(couleurs), hybride()] });
  const fn = [...r.parent.querySelectorAll(".cm-line span")].find((e) => e.textContent === "fn");
  expect(fn).toBeTruthy();
  const classes = fn.className.split(/\s+/).filter(Boolean);
  const regles = [...document.querySelectorAll("style")].map((e) => e.textContent).join("\n");
  expect(classes.some((c) => new RegExp(`\\.${c}[^{]*\\{[^}]*var\\(--syn-keyword\\)`).test(regles))).toBe(true);
});

test("REQ152_AC8_mode_eteint_sans_img_doc_et_annulation_intacts_puis_aperçu_et_hybride_un_seul_dessin", async () => {
  const eteint = await monterD(DOCD, { extensions: [history()] });
  expect(eteint.imgs().length).toBe(0);
  expect(eteint.vue.state.doc.toString()).toBe(DOCD);
  eteint.vue.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
  undo(eteint.vue);
  expect(eteint.vue.state.doc.toString()).toBe(DOCD);
  expect(eteint.vue.contentDOM.textContent).toContain("graph TD");

  const neuf = DOCD.replace("Fin", "Fin partagée"); // texte neuf : jamais dessiné par un test précédent
  const mermaid = mermaidFactice();
  const m = await monterD(neuf, { mermaid, extensions: [history(), hybride()] });
  expect(m.imgs().length).toBe(1);
  expect(dessinerMock).toHaveBeenCalledTimes(1);
  expect(m.vue.state.doc.toString()).toBe(neuf);
  m.vue.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
  undo(m.vue);
  expect(m.vue.state.doc.toString()).toBe(neuf);
  const ap = apercu({ document: "a.md" });
  document.body.append(ap);
  ap.maj(neuf);
  await vi.advanceTimersByTimeAsync(150);
  expect(ap.querySelectorAll(".ya-diagramme img").length).toBe(1);
  expect(m.imgs().length).toBe(1);
  expect(dessinerMock).toHaveBeenCalledTimes(1);
  ap.remove();
});

test("REQ152_AC12_img_nommee_Diagramme_non_glissable_sans_title_ni_tabindex_rien_de_focusable", async () => {
  const m = await monterD(DOCD);
  const img = m.imgs()[0];
  expect(img.getAttribute("alt")).toBe("Diagramme");
  expect(img.getAttribute("draggable")).toBe("false");
  expect(img.hasAttribute("title")).toBe(false);
  expect(img.hasAttribute("tabindex")).toBe(false);
  const widget = m.parent.querySelector(".ya-diagramme");
  expect(widget.hasAttribute("tabindex")).toBe(false);
  expect(widget.querySelectorAll("a, button, input, select, textarea, [tabindex]").length).toBe(0);
});

test("REQ152_AC13_chargement_en_attente_bloc_de_code_sans_message_puis_img_sans_action_et_nouvel_essai_apres_echec", async () => {
  const doc = DOCD.replace("Fin", "Fin lente"); // texte neuf : la table des dessins vit autant que le module
  vi.useFakeTimers();
  let ouvrir;
  const mermaid = mermaidFactice();
  const m = await monterD(doc, { mermaid, attendre: false });
  chargerMock.mockReset().mockReturnValue(new Promise((r) => (ouvrir = r)));
  m.vue.dispatch({ selection: { anchor: doc.indexOf("graph") } });
  m.vue.dispatch({ selection: { anchor: 0 } });
  await vi.advanceTimersByTimeAsync(2000);
  expect(m.imgs().length).toBe(0);
  expect(m.vue.contentDOM.textContent).toContain("graph TD");
  expect(m.vue.contentDOM.textContent).not.toMatch(/Chargement/);
  ouvrir(mermaid);
  await vi.advanceTimersByTimeAsync(10);
  expect(m.imgs().length).toBe(1);

  // Échec puis nouvel essai : l'img revient à 1,5 s sans autre action.
  const n = await monterD("```mermaid\ngraph LR; Z --> Y\n```\n\nfin", { attendre: false });
  chargerMock.mockReset().mockRejectedValueOnce(new Error("coupé")).mockResolvedValue(mermaid);
  n.vue.dispatch({ selection: { anchor: 0 } });
  n.vue.dispatch({ selection: { anchor: n.vue.state.doc.length } });
  await vi.advanceTimersByTimeAsync(150);
  expect(n.imgs().length).toBe(0);
  await vi.advanceTimersByTimeAsync(1600);
  expect(n.imgs().length).toBe(1);
});

// ---- Aides du tableau (REQ-153, T-353) ----
const T3 = "| Option | Défaut | Effet |\n|---|:---:|---|\n| `--nom` | non | Salue |\n| `--fort` | non | Plus fort |";

test("REQ153_AC8_insertion_de_colonne_au_debut_au_milieu_a_la_fin_reste_a_l_octet_pres", () => {
  expect(insererColonne(T3, 0)).toBe("| | Option | Défaut | Effet |\n| --- |---|:---:|---|\n| | `--nom` | non | Salue |\n| | `--fort` | non | Plus fort |");
  expect(insererColonne(T3, 1)).toBe("| Option | | Défaut | Effet |\n|---| --- |:---:|---|\n| `--nom` | | non | Salue |\n| `--fort` | | non | Plus fort |");
  expect(insererColonne(T3, 3)).toBe("| Option | Défaut | Effet | |\n|---|:---:|---| --- |\n| `--nom` | non | Salue | |\n| `--fort` | non | Plus fort | |");
  // Sans `|` de tête ni de queue.
  expect(insererColonne("a | b\n--|--\n1 | 2", 0)).toBe("| | a | b\n| --- | --|--\n| | 1 | 2");
  expect(insererColonne("a | b\n--|--\n1 | 2", 2)).toBe("a | b | |\n--|-- | --- |\n1 | 2 | |");
  // Une rangée plus courte que l'en-tête reste telle quelle au-delà de sa fin.
  expect(insererColonne("| a | b |\n|---|---|\n| 1 |", 2)).toBe("| a | b | |\n|---|---| --- |\n| 1 |");
});

test("REQ153_AC9_insertion_de_ligne_sous_l_en_tete_entre_deux_rangees_a_la_fin", () => {
  const [en, sep, a, b] = T3.split("\n");
  expect(insererLigne(T3, 0)).toBe([en, sep, "| | | |", a, b].join("\n"));
  expect(insererLigne(T3, 1)).toBe([en, sep, a, "| | | |", b].join("\n"));
  expect(insererLigne(T3, 2)).toBe([en, sep, a, b, "| | | |"].join("\n"));
});

test("REQ153_AC10_colonne_retiree_de_chaque_ligne_reste_a_l_octet_pres", () => {
  expect(supprimerColonne(T3, 0)).toBe("| Défaut | Effet |\n|:---:|---|\n| non | Salue |\n| non | Plus fort |");
  expect(supprimerColonne(T3, 1)).toBe("| Option | Effet |\n|---|---|\n| `--nom` | Salue |\n| `--fort` | Plus fort |");
  expect(supprimerColonne(T3, 2)).toBe("| Option | Défaut |\n|---|:---:|\n| `--nom` | non |\n| `--fort` | non |");
  expect(supprimerColonne("a | b\n--|--\n1 | 2", 1)).toBe("| a |\n| -- |\n| 1 |");
  expect(supprimerColonne("| a \\| x | b |\n|---|---|\n| 1 | 2 |", 0)).toBe("| b |\n|---|\n| 2 |");
});

test("REQ153_AC11_ligne_retiree", () => {
  const [en, sep, a, b] = T3.split("\n");
  expect(supprimerLigne(T3, 1)).toBe([en, sep, b].join("\n"));
  expect(supprimerLigne(T3, 2)).toBe([en, sep, a].join("\n"));
  expect(supprimerLigne(T3, 0)).toBe(T3);
  expect(supprimerLigne(T3, 3)).toBe(T3);
});

// 3 colonnes de 100 px à partir de x = 100, en-tête de y = 50 à 80, puis rangées de 30 px.
const GRILLE = [0, 1, 2].map((r) => [0, 1, 2].map((c) => ({ left: 100 + c * 100, right: 200 + c * 100, top: 50 + r * 30, bottom: 80 + r * 30 })));
const zone = (x, y, extra = {}) => zonesAides({ lignes: GRILLE, pointeur: { x, y }, gauche: 110, ...extra });

test("REQ153_AC8_AC9_AC10_AC11_zones_des_disques_sous_le_pointeur", () => {
  // Bordure entre deux colonnes : sur toute la hauteur, centré sur la bordure, à l'ordonnée du pointeur ; 4 px.
  expect(zone(203, 100)).toMatchObject({ sorte: "inserer-colonne", indice: 1, x: 200, y: 100, filet: { x: 200, top: 50, bottom: 140 } });
  expect(zone(205, 100)?.sorte).not.toBe("inserer-colonne");
  // Bords gauche et droit : seulement à la hauteur de l'en-tête ; décalé pour la gouttière.
  expect(zone(101, 60)).toMatchObject({ sorte: "inserer-colonne", indice: 0, x: 110, y: 60 });
  expect(zone(399, 60)).toMatchObject({ sorte: "inserer-colonne", indice: 3, x: 400 });
  expect(zone(101, 100)).toMatchObject({ sorte: "supprimer-ligne" });
  // Bordure entre deux rangées : abscisse du pointeur, bornée à 8 px des bords ; sous l'en-tête et bord bas, jamais le bord haut.
  expect(zone(250, 82)).toMatchObject({ sorte: "inserer-ligne", indice: 0, x: 250, y: 80, filet: { y: 80, left: 100, right: 400 } });
  expect(zone(103, 82)).toMatchObject({ sorte: "inserer-ligne", x: 108 });
  expect(zone(250, 109)).toMatchObject({ sorte: "inserer-ligne", indice: 1, y: 110 });
  expect(zone(250, 139)).toMatchObject({ sorte: "inserer-ligne", indice: 2, y: 140 });
  expect(zone(250, 142)).toMatchObject({ sorte: "inserer-ligne", indice: 2, y: 140 });
  expect(zone(250, 48)).toBeNull();
  expect(zone(250, 51)?.sorte).toBe("supprimer-colonne");
  // Deux bordures : la plus proche ; à égalité, la verticale.
  expect(zone(202, 83).sorte).toBe("inserer-colonne");
  expect(zone(203, 82)).toMatchObject({ sorte: "inserer-ligne" });
  expect(zone(203, 83)).toMatchObject({ sorte: "inserer-colonne" });
  // En-tête : « Supprimer la colonne », milieu de la colonne, bord haut, cadre de la colonne entière.
  expect(zone(250, 65)).toMatchObject({ sorte: "supprimer-colonne", indice: 1, x: 250, y: 50, cadre: { left: 200, right: 300, top: 50, bottom: 140 } });
  // Rangée du corps : « Supprimer la ligne », bord droit ; 4 px à droite du bord compris.
  expect(zone(250, 95)).toMatchObject({ sorte: "supprimer-ligne", indice: 1, x: 400, y: 95, cadre: { left: 100, right: 400, top: 80, bottom: 110 } });
  expect(zone(250, 95 + 0)).toMatchObject({ indice: 1 });
  expect(zone(404, 95)?.sorte).toBe("supprimer-ligne");
  expect(zone(406, 95)).toBeNull();
  // Une seule colonne : pas de « Supprimer la colonne ». En-tête : pas de « Supprimer la ligne ».
  const seule = [[{ left: 100, right: 200, top: 50, bottom: 80 }], [{ left: 100, right: 200, top: 80, bottom: 110 }]];
  expect(zonesAides({ lignes: seule, pointeur: { x: 150, y: 65 } })).toBeNull();
  expect(zone(250, 65).sorte).not.toBe("supprimer-ligne");
  // Hors du tableau.
  expect(zone(50, 60)).toBeNull();
  // Le disque sous le pointeur est gardé, immobile.
  const d = zone(203, 100);
  expect(zone(208, 108, { courant: d })).toBe(d);
  expect(zone(240, 100, { courant: d })).not.toBe(d);
});

function monterAides(doc = DOCT.replace(TAB, T3)) {
  const m = monterH(doc);
  const actuel = () => m.parent.querySelector(".cm-hy-tableau");
  const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
  const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.classList?.contains("cm-hy-tableau")) return rect(90, 40, 410, 130);
    if (this.matches?.("td, th")) {
      const r = this.parentElement.rowIndex;
      const c = this.cellIndex;
      return rect(100 + c * 100, 50 + r * 30, 200 + c * 100, 80 + r * 30);
    }
    return rect(0, 0, 0, 0);
  });
  const survol = (x, y, init = {}) => actuel().dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y, ...init }));
  const disque = () => actuel().querySelector(".ya-tableau-aides .ya-icon-btn-disque");
  return { ...m, get tableau() { return actuel(); }, survol, disque, fin: () => (spy.mockRestore(), m.fin()) };
}

test("REQ153_AC8_clic_sur_le_disque_insere_une_colonne_en_une_transaction_et_ouvre_l_en_tete", async () => {
  const m = monterAides();
  m.survol(203, 60);
  expect(m.disque().getAttribute("aria-label")).toBe("Insérer une colonne");
  expect(m.parent.querySelectorAll(".ya-tableau-aides .ya-icon-btn-disque").length).toBe(1);
  expect(m.disque().style.left).toBe("110px");
  expect(m.disque().style.top).toBe("20px");
  const filet = m.tableau.querySelector(".ya-tableau-filet-v");
  expect(filet.style.left).toBe("109px");
  expect(filet.style.height).toBe("90px");
  let transactions = 0;
  const origine = m.vue.dispatch.bind(m.vue);
  m.vue.dispatch = (...a) => (transactions++, origine(...a));
  const sel = m.vue.state.selection.main.head;
  m.disque().click();
  await m.attendre();
  expect(transactions).toBe(1);
  expect(m.vue.state.doc.toString()).toBe(DOCT.replace(TAB, insererColonne(T3, 1)));
  expect(m.vue.state.selection.main.head).toBe(sel);
  expect(m.parent.querySelectorAll(".cm-hy-tableau th").length).toBe(4);
  expect(m.saisie().getAttribute("aria-label")).toBe("En-tête de la colonne 2");
  m.fin();
});

test("REQ153_AC9_clic_sur_le_disque_insere_une_ligne_et_ouvre_sa_premiere_cellule", async () => {
  const m = monterAides();
  m.survol(250, 81);
  expect(m.disque().getAttribute("aria-label")).toBe("Insérer une ligne");
  expect(m.tableau.querySelector(".ya-tableau-filet-h")).not.toBeNull();
  m.disque().click();
  await m.attendre();
  expect(m.vue.state.doc.toString()).toBe(DOCT.replace(TAB, insererLigne(T3, 0)));
  expect(m.parent.querySelectorAll(".cm-hy-tableau tr").length).toBe(4);
  expect(m.saisie().getAttribute("aria-label")).toBe("Option, rangée 1");
  expect(m.saisie().closest("tr").rowIndex).toBe(1);
  m.fin();
});

test("REQ153_AC10_AC11_suppression_de_colonne_et_de_ligne_cadre_rouge_focus_au_texte", async () => {
  const m = monterAides();
  m.survol(250, 65);
  expect(m.disque().getAttribute("aria-label")).toBe("Supprimer la colonne");
  expect(m.tableau.querySelector(".ya-tableau-cadre")).toBeNull();
  m.disque().dispatchEvent(new MouseEvent("mouseenter"));
  const cadre = m.tableau.querySelector(".ya-tableau-cadre");
  expect([cadre.style.left, cadre.style.width, cadre.style.height]).toEqual(["110px", "100px", "90px"]);
  m.disque().dispatchEvent(new MouseEvent("mouseleave"));
  expect(m.tableau.querySelector(".ya-tableau-cadre")).toBeNull();
  m.disque().click();
  expect(m.vue.state.doc.toString()).toBe(DOCT.replace(TAB, supprimerColonne(T3, 1)));
  expect(m.parent.querySelectorAll(".cm-hy-tableau th").length).toBe(2);
  expect(m.parent.querySelector(".ya-tableau-aides .ya-icon-btn-disque")).toBeNull();
  expect(m.vue.hasFocus || document.activeElement === m.vue.contentDOM).toBe(true);
  m.survol(150, 125);
  expect(m.disque().getAttribute("aria-label")).toBe("Supprimer la ligne");
  m.disque().click();
  expect(m.vue.state.doc.toString()).toBe(DOCT.replace(TAB, supprimerLigne(supprimerColonne(T3, 1), 2)));
  expect(m.parent.querySelectorAll(".cm-hy-tableau tr").length).toBe(2);
  m.fin();
});

test("REQ153_AC10_AC11_pas_de_suppression_de_colonne_seule_ni_de_ligne_ni_d_insertion_au_dessus_de_l_en_tete", () => {
  const m = monterAides("avant\n\n| a |\n|---|\n| 1 |\n\nfin");
  m.tableau.getBoundingClientRect(); // grille de 3 colonnes : seule la première existe ici
  m.survol(150, 65);
  expect(m.disque()).toBeNull();
  m.survol(150, 51);
  expect(m.disque()).toBeNull();
  m.fin();
});

test("REQ153_AC12_deux_actions_puis_undo_undo_redo_redo", async () => {
  const m = monterAides();
  m.survol(203, 60);
  m.disque().click();
  await m.attendre();
  m.touche(m.saisie(), "Escape");
  m.survol(250, 65);
  m.disque().click();
  const [apres1, apres2] = [DOCT.replace(TAB, insererColonne(T3, 1)), m.vue.state.doc.toString()];
  expect(apres2).not.toBe(apres1);
  undo(m.vue);
  expect(m.vue.state.doc.toString()).toBe(apres1);
  undo(m.vue);
  expect(m.vue.state.doc.toString()).toBe(DOCT.replace(TAB, T3));
  expect(m.parent.querySelector(".cm-hy-tableau")).not.toBeNull();
  redo(m.vue);
  redo(m.vue);
  expect(m.vue.state.doc.toString()).toBe(apres2);
  m.fin();
});

test("REQ153_AC12_saisie_ouverte_validee_avant_l_action_deux_pas_d_annulation", async () => {
  const m = monterAides();
  m.clic(m.cellules()[4]);
  m.taper("oui");
  m.survol(250, 81);
  m.disque().click();
  await m.attendre();
  const doc = m.vue.state.doc.toString();
  expect(doc).toContain("| `--nom` | oui | Salue |");
  expect(doc).toContain("| | | |");
  undo(m.vue);
  expect(m.vue.state.doc.toString()).toContain("| `--nom` | oui | Salue |");
  expect(m.vue.state.doc.toString()).not.toContain("| | | |");
  undo(m.vue);
  expect(m.vue.state.doc.toString()).toBe(DOCT.replace(TAB, T3));
  m.fin();
});

test("REQ153_AC13_aucun_disque_mode_eteint_et_ctrl_enfonce", () => {
  const m = monterAides();
  m.survol(203, 60);
  expect(m.disque()).not.toBeNull();
  m.survol(203, 60, { ctrlKey: true });
  expect(m.disque()).toBeNull();
  m.survol(203, 60);
  expect(m.disque()).not.toBeNull();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
  expect(m.disque()).toBeNull();
  m.fin();
  // Témoin : allumé, le tableau rendu porte son calque ; éteint, puis aperçu : aucun calque, aucun disque.
  const allume = zoneCode({ contenu: DOCT.replace(TAB, T3), langage: "markdown", hybride: true });
  document.body.append(allume);
  expect(allume.querySelector(".cm-hy-tableau .ya-tableau-aides")).not.toBeNull();
  allume.remove();
  for (const options of [{ hybride: false }, { hybride: false, apercu: true }]) {
    const z = zoneCode({ contenu: DOCT.replace(TAB, T3), langage: "markdown", ...options });
    document.body.append(z);
    z.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 203, clientY: 60 }));
    expect(z.querySelector(".cm-hy-tableau, .ya-tableau-aides, .ya-icon-btn-disque")).toBeNull();
    z.remove();
  }
});

test("REQ153_AC14_disques_hors_tab_partent_au_mouseleave_et_pendant_un_glisse", () => {
  const m = monterAides();
  m.survol(203, 60);
  expect(m.disque().tabIndex).toBe(-1);
  expect(m.tableau.contains(m.disque())).toBe(true);
  m.tableau.dispatchEvent(new MouseEvent("mouseleave"));
  expect(m.disque()).toBeNull();
  m.survol(203, 60);
  m.survol(203, 61, { buttons: 1 });
  expect(m.disque()).toBeNull();
  m.survol(203, 60);
  m.survol(250, 65);
  expect(m.parent.querySelectorAll(".ya-icon-btn-disque").length).toBe(1);
  expect(m.disque().getAttribute("aria-label")).toBe("Supprimer la colonne");
  expect(m.tableau.querySelector(".ya-tableau-filet")).toBeNull();
  m.fin();
});

test("REQ157_AC7_zones_des_aides_avec_l_option_tableur", () => {
  const t = (x, y, extra = {}) => zonesAides({ lignes: GRILLE, pointeur: { x, y }, tableur: true, ...extra });
  // Bord haut : insérer une ligne au-dessus de la première rangée (indice -1), à 4 px au plus ; sans l'option, rien.
  expect(t(250, 48)).toMatchObject({ sorte: "inserer-ligne", indice: -1, y: 50, filet: { y: 50, left: 100, right: 400 } });
  expect(t(250, 45)).toBeNull();
  expect(zone(250, 48)).toBeNull();
  // Première rangée : « Supprimer la colonne » dans ses cellules, « Supprimer la ligne » à 4 px à droite du bord.
  expect(t(250, 65)).toMatchObject({ sorte: "supprimer-colonne", indice: 1 });
  // Au bord droit, « Insérer une colonne » seulement côté intérieur.
  expect(t(398, 65)).toMatchObject({ sorte: "inserer-colonne", indice: 3 });
  // Bande extérieure ]bord, bord + 4 px] : « Supprimer la ligne », première rangée comprise.
  expect(t(404, 65)).toMatchObject({ sorte: "supprimer-ligne", indice: 0, x: 400, y: 65, cadre: { left: 100, right: 400, top: 50, bottom: 80 } });
  // Les autres rangées : « Supprimer la ligne », jamais « Supprimer la colonne ».
  expect(t(250, 95)).toMatchObject({ sorte: "supprimer-ligne", indice: 1 });
  // Une seule colonne : pas de « Supprimer la colonne » ; une seule rangée : pas de « Supprimer la ligne ».
  const colonne = [[{ left: 100, right: 200, top: 50, bottom: 80 }], [{ left: 100, right: 200, top: 80, bottom: 110 }]];
  expect(zonesAides({ lignes: colonne, pointeur: { x: 150, y: 65 }, tableur: true })).toMatchObject({ sorte: "supprimer-ligne", indice: 0, x: 200, y: 65, cadre: { top: 50, bottom: 80 } });
  expect(zonesAides({ lignes: colonne, pointeur: { x: 150, y: 95 }, tableur: true })).toMatchObject({ sorte: "supprimer-ligne", indice: 1 });
  const rangee = [GRILLE[0]];
  expect(zonesAides({ lignes: rangee, pointeur: { x: 250, y: 65 }, tableur: true })?.sorte).toBe("supprimer-colonne");
  expect(zonesAides({ lignes: rangee, pointeur: { x: 250, y: 95 }, tableur: true })).toBeNull();
  const une = [[{ left: 100, right: 200, top: 50, bottom: 80 }]];
  expect(zonesAides({ lignes: une, pointeur: { x: 150, y: 65 }, tableur: true })).toBeNull();
  // Sans l'option, REQ-153 inchangé : pas de « Supprimer la ligne » sur l'en-tête.
  expect(zone(404, 65)?.sorte).toBe("inserer-colonne"); // sans l'option : REQ-153 inchangé
  expect(zonesAides({ lignes: colonne, pointeur: { x: 150, y: 65 } })).toBeNull();
});

test("REQ169_AC6_souligne_balises_masquees_hors_du_curseur_et_en_muted_sur_la_ligne", () => {
  const hors = deco("un <u>mot</u> ici", { curseur: 18 });
  expect(stylees(hors, "cm-hy-souligne")).toEqual(["mot"]);
  expect(masques(hors)).toEqual(["<u>", "</u>"]);
  const sur = deco("un <u>mot</u> ici", { curseur: 5 });
  expect(stylees(sur, "cm-hy-souligne")).toEqual(["mot"]);
  expect(masques(sur)).toEqual([]);
  expect(visibles(sur)).toEqual(["<u>", "</u>"]);
});

test("REQ169_AC6_balise_u_sans_fermeture_et_autres_balises_restent_du_texte", () => {
  const r = deco("un <u>mot et <b>x</b>");
  expect(stylees(r, "cm-hy-souligne")).toEqual([]);
  expect(masques(r)).toEqual([]);
});
