import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { debutCellule, decorationsHybride, hybride, tableauxHybride } from "./hybride.js";

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

test("REQ063_AC4_debutCellule_cellules_pipe_echappe_et_cellule_vide", () => {
  const src = "| a | b \\| c |  |\n|---|---|---|\n|  x | y | z |";
  expect(debutCellule(src, 0, 0)).toBe(2);
  expect(debutCellule(src, 0, 1)).toBe(6);
  expect(src.slice(debutCellule(src, 0, 1))).toMatch(/^b \\\|/);
  expect(src.slice(debutCellule(src, 0, 2), debutCellule(src, 0, 2) + 1)).toBe("|"); // cellule vide : sur le séparateur
  const l3 = src.indexOf("|  x");
  expect(debutCellule(src, 1, 0)).toBe(l3 + 3);
  expect(src[debutCellule(src, 1, 2)]).toBe("z");
  expect(debutCellule("a | b\n--|--\nc | d", 1, 1)).toBe("a | b\n--|--\nc | ".length);
  expect(debutCellule(src, 9, 0)).toBe(0);
});

test("REQ063_AC4_mousedown_sur_une_cellule_place_le_curseur_et_repasse_en_texte", () => {
  const doc = `avant\n\n${TABLE}\n\nfin`;
  const m = monter(doc);
  const cellules = m.parent.querySelectorAll(".cm-hy-tableau td");
  const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  cellules[1].dispatchEvent(e); // rangée 1, colonne 1 : « **non** »
  expect(e.defaultPrevented).toBe(true);
  expect(m.vue.state.selection.main.head).toBe(doc.indexOf("**non**"));
  expect(m.parent.querySelector(".cm-hy-tableau")).toBeNull();
  expect(m.vue.contentDOM.textContent).toContain("| `--fort` | **non** |");
  m.fin();
});

test("REQ063_AC4_clic_hors_cellule_va_au_debut_du_tableau", () => {
  const doc = `avant\n\n${TABLE}\n\nfin`;
  const m = monter(doc);
  m.parent.querySelector(".cm-hy-tableau").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  expect(m.vue.state.selection.main.head).toBe(doc.indexOf("| Nom"));
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
