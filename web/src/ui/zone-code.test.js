import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { zoneCode } from "./zone-code.js";
import { langagePourFichier, IDENTIFIANTS } from "./langages.js";
import { rendreMarkdown } from "./apercu.js";
import { changerTheme } from "./theme.js";

// jsdom n'a pas de mise en page : CodeMirror mesure avec ces deux méthodes.
Range.prototype.getClientRects ??= () => [];
Range.prototype.getBoundingClientRect ??= () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });

const css = readFileSync("web/src/ui/composants.css", "utf8");

const EXEMPLES = {
  "main.rs": ["rust", 'fn main() { let x = 1; }'],
  "a.js": ["javascript", "const x = 1;"],
  "a.ts": ["javascript", "const x: number = 1;"],
  "a.tsx": ["javascript", "const x = <div/>;"],
  "a.py": ["python", "def f():\n  return 1"],
  "a.go": ["go", "package main\nfunc main() {}"],
  "a.c": ["cpp", "int main() { return 0; }"],
  "a.cpp": ["cpp", "int main() { return 0; }"],
  "a.html": ["html", "<p class=\"a\">x</p>"],
  "a.css": ["css", "a { color: red; }"],
  "a.json": ["json", '{"a": 1}'],
  "a.yaml": ["yaml", "a: 1\nb: [x]"],
  "a.yml": ["yaml", "a: 1"],
  "a.toml": ["toml", 'a = "x"\n[t]\nb = 1'],
  "a.md": ["markdown", "# Titre\n\ntexte"],
  "a.sh": ["shell", 'echo "x" | grep y'],
};

test.each(Object.entries(EXEMPLES))("REQ011_AC2_%s_reconnu_et_colore", (fichier, [id, texte]) => {
  expect(langagePourFichier(fichier)).toBe(id);
  const z = zoneCode({ contenu: texte, langage: id, nom: fichier });
  document.body.append(z);
  ensureSyntaxTree(z.vue.state, z.vue.state.doc.length, 5000);
  z.vue.dispatch({}); // force le rendu avec l'arbre complet
  const mots = z.querySelectorAll(".cm-line span");
  expect(mots.length).toBeGreaterThan(0);
  z.detruire();
});

test("REQ011_AC2_les_douze_langages_sont_couverts", () => {
  expect(IDENTIFIANTS.sort()).toEqual(["cpp", "css", "go", "html", "json", "javascript", "markdown", "python", "rust", "shell", "toml", "yaml"].sort());
});

test("REQ011_AC1_rust_colore_avec_les_tokens", () => {
  const z = zoneCode({ contenu: 'fn main() { let s = "a"; }', langage: "rust", nom: "main.rs" });
  document.body.append(z);
  ensureSyntaxTree(z.vue.state, z.vue.state.doc.length, 5000);
  z.vue.dispatch({});
  const cls = new Set([...z.querySelectorAll(".cm-line span")].map((s) => s.className).filter(Boolean));
  expect(cls.size).toBeGreaterThanOrEqual(2);
  const styles = [...document.querySelectorAll("style")].map((s) => s.textContent).join("");
  expect(styles).toContain("var(--syn-keyword)");
  expect(styles).toContain("var(--syn-string)");
  expect(styles).toContain("background-color: var(--bg-200)");
  expect(styles).toMatch(/\.cm-activeLine\s*{background-color: var\(--ligne-active\)/);
  expect(styles).toMatch(/cm-cursorLayer\s*{animation: none !important/);
  z.detruire();
});

test("REQ011_AC3_extension_inconnue_en_texte_simple_sans_erreur", () => {
  for (const n of ["notes.xyz", "Makefile", "", ".gitignore2", "archive.tar.gz"]) expect(langagePourFichier(n)).toBeNull();
  const z = zoneCode({ contenu: "du texte", nom: "notes.xyz" });
  document.body.append(z);
  expect(z.contenu()).toBe("du texte");
  expect(z.querySelectorAll(".cm-line span").length).toBe(0);
  z.detruire();
});

test("REQ011_AC2_extension_insensible_a_la_casse_et_langage_inconnu_refuse", () => {
  expect(langagePourFichier("MAIN.RS")).toBe("rust");
  expect(() => zoneCode({ langage: "cobol" })).toThrow(/langage inconnu/);
  expect(() => zoneCode({ mode: "autre" })).toThrow(/mode inconnu/);
});

test("REQ011_AC7_tab_indente_et_echap_tab_sort", () => {
  const z = zoneCode({ contenu: "x", langage: "rust" });
  document.body.append(z);
  // indentWithTab est dans la keymap : Tab insère une indentation.
  const c = z.querySelector(".cm-content");
  c.focus();
  z.vue.dispatch({ selection: { anchor: 0 } });
  c.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", keyCode: 9, bubbles: true }));
  expect(z.contenu()).not.toBe("x");
  expect(z.contenu().endsWith("x")).toBe(true);
  z.detruire();
});

test("REQ011_AC1_nom_accessible_editeur_et_diff", () => {
  const e = zoneCode({ contenu: "", nom: "main.rs" });
  expect(e.querySelector(".cm-content").getAttribute("aria-label")).toBe("Éditeur main.rs");
  const d = zoneCode({ contenu: "+a", nom: "main.rs", mode: "diff" });
  expect(d.querySelector(".cm-content").getAttribute("aria-label")).toBe("Diff main.rs");
});

test("REQ011_AC4_le_texte_non_sauvegarde_est_signale_et_conserve", () => {
  const surChangement = vi.fn();
  const z = zoneCode({ contenu: "ab", surChangement });
  z.vue.dispatch({ changes: { from: 2, insert: "c" } });
  expect(surChangement).toHaveBeenCalledWith("abc");
  expect(z.contenu()).toBe("abc");
});

test("REQ012_AC1_apercu_suit_la_frappe", () => {
  const z = zoneCode({ contenu: "", langage: "markdown", nom: "README.md" });
  document.body.append(z);
  expect(z.querySelector(".zone-code-apercu")).toBeNull();
  z.definirApercu(true);
  const ap = z.querySelector(".zone-code-apercu");
  expect(ap.getAttribute("aria-label")).toBe("Aperçu");
  z.vue.dispatch({ changes: { from: 0, insert: "# Titre" } });
  expect(ap.querySelector("h1").textContent).toBe("Titre");
  z.definirApercu(false);
  expect(z.querySelector(".zone-code-apercu")).toBeNull();
});

test("REQ012_AC1_apercu_initial_rend_le_contenu", () => {
  const z = zoneCode({ contenu: "## Sous", langage: "markdown", apercu: true });
  expect(z.querySelector(".zone-code-apercu h2").textContent).toBe("Sous");
});

test("REQ012_AC2_html_brut_et_liens_dangereux_non_interpretes", () => {
  const h = rendreMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[l](javascript:alert(1))');
  const d = document.createElement("div");
  d.innerHTML = h;
  expect(d.querySelector("script")).toBeNull();
  expect(d.querySelector("img")).toBeNull();
  expect(d.querySelector("[onerror]")).toBeNull();
  expect(d.querySelector("a")).toBeNull();
  expect(d.textContent).toContain("<script>");
});

test("REQ012_AC1_image_remplacee_par_son_texte", () => {
  const d = document.createElement("div");
  d.innerHTML = rendreMarkdown("![un chat](http://x/y.png) et ![<b>](z.png)");
  expect(d.querySelector("img")).toBeNull();
  expect(d.textContent).toContain("un chat et <b>");
  expect(d.querySelector("b")).toBeNull();
});

test("REQ012_AC1_liens_et_code_rendus", () => {
  const d = document.createElement("div");
  d.innerHTML = rendreMarkdown("[a](https://x.org) `c`");
  expect(d.querySelector("a").getAttribute("href")).toBe("https://x.org");
  expect(d.querySelector("code").textContent).toBe("c");
});

test("REQ011_AC1_diff_lecture_seule_lignes_colorees_prefixe_conserve", () => {
  const z = zoneCode({ contenu: "+ajout\n-retrait\n contexte", mode: "diff", langage: "rust", nom: "a.rs" });
  document.body.append(z);
  const lignes = [...z.querySelectorAll(".cm-line")];
  expect(lignes[0].classList.contains("cm-ligne-ajout")).toBe(true);
  expect(lignes[0].textContent).toBe("+ajout");
  expect(lignes[1].classList.contains("cm-ligne-retrait")).toBe(true);
  expect(lignes[1].textContent).toBe("-retrait");
  expect(lignes[2].className).not.toMatch(/ligne-(ajout|retrait)/);
  expect(z.vue.state.readOnly).toBe(true);
  expect(z.querySelectorAll(".cm-line span").length).toBe(0); // pas de coloration du langage
  z.detruire();
});

test("REQ011_AC1_ligne_place_le_curseur_et_est_bornee", () => {
  const txt = "a\nb\nc\nd";
  expect(zoneCode({ contenu: txt, ligne: 3 }).vue.state.selection.main.head).toBe(4);
  expect(zoneCode({ contenu: txt, ligne: 99 }).vue.state.selection.main.head).toBe(6);
  expect(zoneCode({ contenu: txt, ligne: 0 }).vue.state.selection.main.head).toBe(0);
});

test("REQ011_AC1_style_zone_de_code_par_tokens_seulement", () => {
  const bloc = css.slice(css.indexOf(".zone-code {"));
  expect(bloc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(bloc).not.toMatch(/\d+px/);
  expect(bloc).toMatch(/\.zone-code:focus-within\s*{[^}]*outline:\s*var\(--trait\) solid var\(--accent-fg\)/);
  expect(bloc).toMatch(/\.zone-code-apercu a(?:,[^{]*)?\s*{[^}]*text-decoration:\s*underline/);
});

test("REQ017_AC1_remplacer_garde_le_curseur_sur_la_meme_ligne_bornee_au_nouveau_texte", () => {
  const z = zoneCode({ contenu: "a\nbcd\ne\nf\ng" });
  z.vue.dispatch({ selection: { anchor: 5 } }); // position 5 : ligne 2, colonne 3
  z.remplacer("1\n2345\n6\n7");
  const l = z.vue.state.doc.lineAt(z.vue.state.selection.main.head);
  expect([l.number, z.vue.state.selection.main.head - l.from]).toEqual([2, 3]);
  z.vue.dispatch({ selection: { anchor: z.vue.state.doc.length } }); // dernière ligne
  z.remplacer("x\ny");
  expect(z.vue.state.doc.lineAt(z.vue.state.selection.main.head).number).toBe(2);
  z.remplacer("");
  expect(z.vue.state.selection.main.head).toBe(0);
});

const styles = () => [...document.querySelectorAll("style")].map((x) => x.textContent).join("");

test("REQ036_AC4_theme_cm_police_13_5_ligne_21_curseur_2px", () => {
  const z = zoneCode({ contenu: "x" });
  document.body.append(z);
  const st = styles();
  expect(st).toContain("font-size: 13.5px");
  expect(st).toContain("line-height: 21px");
  expect(st).toMatch(/\.cm-cursor[^{]*{border-left: 2px solid var\(--accent-fg\)/);
  expect(st).toContain("var(--ink-faint)");
  z.detruire();
});

test("REQ036_AC4_changer_de_theme_ne_reconstruit_pas_l_editeur_et_garde_le_texte", () => {
  const z = zoneCode({ contenu: "texte", langage: "rust" });
  document.body.append(z);
  const vue = z.vue;
  const content = z.querySelector(".cm-content");
  z.vue.dispatch({ changes: { from: 5, insert: " saisi" } });
  expect(vue.state.facet(EditorView.darkTheme)).toBe(true);
  changerTheme("light");
  expect(z.vue).toBe(vue);
  expect(z.querySelector(".cm-content")).toBe(content);
  expect(vue.state.facet(EditorView.darkTheme)).toBe(false);
  expect(z.contenu()).toBe("texte saisi");
  changerTheme("dark");
  expect(vue.state.facet(EditorView.darkTheme)).toBe(true);
  z.detruire();
  changerTheme("light");
  expect(vue.state.facet(EditorView.darkTheme)).toBe(true); // l'écouteur est retiré
  changerTheme("dark");
});

test("REQ037_AC5_sur_position_recoit_ligne_et_colonne", () => {
  const surPosition = vi.fn();
  const z = zoneCode({ contenu: "ab\ncde", surPosition });
  expect(surPosition).toHaveBeenLastCalledWith(1, 1);
  z.vue.dispatch({ selection: { anchor: 5 } });
  expect(surPosition).toHaveBeenLastCalledWith(2, 3);
  z.vue.dispatch({ changes: { from: 5, insert: "xy" } });
  expect(surPosition).toHaveBeenLastCalledWith(2, 3);
  z.vue.dispatch({ selection: { anchor: 7 } });
  expect(surPosition).toHaveBeenLastCalledWith(2, 5);
  z.detruire();
});

test("REQ036_AC4_diff_entete_de_bloc_en_ink_muted", () => {
  const z = zoneCode({ contenu: "@@ -1 +1 @@\n+a\n-b", mode: "diff" });
  document.body.append(z);
  const l = [...z.querySelectorAll(".cm-line")];
  expect(l[0].classList.contains("cm-ligne-entete")).toBe(true);
  expect(l[1].classList.contains("cm-ligne-ajout")).toBe(true);
  expect(styles()).toMatch(/\.cm-ligne-entete\s*{color: var\(--ink-muted\)/);
  z.detruire();
});

// T-054 : coloration des blocs de code de l'aperçu.
function htmlDe(md) {
  const d = document.createElement("div");
  d.innerHTML = rendreMarkdown(md);
  return d;
}

test("REQ044_AC1_le_texte_du_bloc_est_celui_de_la_source_et_fn_est_colore", () => {
  const source = "fn main() {\n\n    let a = 1; // <b>\n}\n";
  const d = htmlDe("```rust\n" + source + "```");
  expect(d.querySelector("pre").textContent).toBe(source);
  const fn = [...d.querySelectorAll("pre span")].find((s) => s.textContent === "fn");
  expect(fn).toBeTruthy();
  expect(d.querySelector("pre b")).toBeNull();
});

const EXEMPLES_APERCU = {
  rust: ["rust", "rs", "fn main() {}"],
  javascript: ["javascript", "js", "const a = 1;"],
  typescript: ["typescript", "ts", "const a: number = 1;"],
  python: ["python", "py", "def f(): return 1"],
  go: ["go", "go", "func main() {}"],
  c: ["c", "h", "int main() { return 0; }"],
  cpp: ["c++", "cpp", "class A { int x; };"],
  html: ["html", "htm", '<a href="x">y</a>'],
  css: ["css", "css", "a { color: red; }"],
  json: ["json", "json", '{"a": 1}'],
  yaml: ["yaml", "yml", "a: 1\nb: [x]"],
  toml: ["toml", "toml", 'a = 1\n[t]\nb = "x"'],
  markdown: ["markdown", "md", "# Titre\n\n*x*"],
  shell: ["shell", "sh", 'echo "a" | grep a'],
  bash: ["bash", "bash", "if true; then echo 1; fi"],
};

for (const [langue, [nom, ext, code]] of Object.entries(EXEMPLES_APERCU)) {
  test(`REQ044_AC2_${langue}_colore_par_son_nom_et_par_une_extension`, () => {
    for (const mot of [nom, ext, nom.toUpperCase()]) {
      const d = htmlDe("```" + mot + "\n" + code + "\n```");
      expect(d.querySelectorAll("pre span").length, mot).toBeGreaterThan(0);
      expect(d.querySelector("pre").textContent).toBe(code + "\n");
    }
  });
}

test("REQ044_AC3_sans_langage_ou_langage_inconnu_aucune_couleur_et_texte_exact", () => {
  for (const ouverture of ["```", "```inconnu", "```a.rs"]) {
    const d = htmlDe(ouverture + "\nfn main() { <i>x</i> }\n```");
    expect(d.querySelectorAll("pre span").length, ouverture).toBe(0);
    expect(d.querySelector("pre").textContent).toBe("fn main() { <i>x</i> }\n");
    expect(d.querySelector("pre i")).toBeNull();
  }
});

test("REQ044_AC4_script_et_img_dans_un_bloc_restent_du_texte", () => {
  for (const mot of ["html", "rust", "inconnu"]) {
    const d = htmlDe("```" + mot + '\n<script>alert(1)</script><img src=x onerror="alert(1)">\n```');
    expect(d.querySelector("script"), mot).toBeNull();
    expect(d.querySelector("img"), mot).toBeNull();
    expect(d.querySelector("[onerror]"), mot).toBeNull();
    expect(d.querySelector("pre").textContent).toContain('<script>alert(1)</script><img src=x onerror="alert(1)">');
  }
});

test("REQ044_le_code_en_ligne_n_est_pas_colore", () => {
  const d = htmlDe("voir `fn main() {}` ici");
  expect(d.querySelector("code").textContent).toBe("fn main() {}");
  expect(d.querySelectorAll("code span").length).toBe(0);
});

test("REQ058_AC8_apercu_html_est_un_iframe_et_markdown_un_div", () => {
  const h = zoneCode({ contenu: "<h1>T</h1>", langage: "html", apercu: true, adresseApercu: async () => "/apercu/j/a.html" });
  expect(h.querySelector("iframe.zone-code-cadre").title).toBe("Aperçu");
  expect(h.querySelector(".zone-code-apercu")).toBeNull();
  const m = zoneCode({ contenu: "# T", langage: "markdown", apercu: true });
  expect(m.querySelector(".zone-code-apercu").tagName).toBe("DIV");
  expect(m.querySelector("iframe")).toBeNull();
});

const MD = "# Titre\n\nun **gras** et [lien](https://x.org)\n\n## Suite\n\n- puce";
const estHybride = (z) => z.vue.dom.classList.contains("cm-hybride");

test("REQ062_AC8_definirHybride_pose_puis_retire_sans_toucher_au_texte", () => {
  const surChangement = vi.fn();
  const z = zoneCode({ contenu: MD, langage: "markdown", nom: "a.md", surChangement });
  document.body.append(z);
  expect(estHybride(z)).toBe(false);
  expect(z.vue.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
  z.definirHybride(true);
  expect(estHybride(z)).toBe(true);
  expect(z.vue.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
  z.definirHybride(false);
  expect(estHybride(z)).toBe(false);
  expect(z.vue.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
  expect(z.contenu()).toBe(MD);
  expect(surChangement).not.toHaveBeenCalled();
  z.detruire();
  z.remove();
});

test("REQ062_AC8_option_hybride_et_historique_conserve_apres_bascule", async () => {
  const { undo } = await import("@codemirror/commands");
  const z = zoneCode({ contenu: "a", langage: "markdown", hybride: true });
  document.body.append(z);
  expect(estHybride(z)).toBe(true);
  z.vue.dispatch({ changes: { from: 1, insert: "b" }, selection: { anchor: 2 }, userEvent: "input.type" });
  z.definirHybride(false);
  expect(z.contenu()).toBe("ab");
  expect(z.vue.state.selection.main.head).toBe(2);
  expect(undo(z.vue)).toBe(true);
  expect(z.contenu()).toBe("a");
  z.detruire();
  z.remove();
});

test("REQ062_AC11_hybride_et_apercu_a_jour_a_la_frappe", () => {
  const z = zoneCode({ contenu: "# Un", langage: "markdown", hybride: true, apercu: true });
  document.body.append(z);
  z.vue.dispatch({ changes: { from: 4, insert: "\n\n## Deux" } });
  expect(z.querySelector(".zone-code-apercu h2").textContent).toBe("Deux");
  expect(z.vue.dom.querySelector(".cm-hy-titre2")).not.toBeNull();
  z.definirApercu(false);
  expect(estHybride(z)).toBe(true);
  z.detruire();
  z.remove();
});

test("REQ062_AC1_ignore_hors_markdown_et_en_diff", () => {
  const r = zoneCode({ contenu: "fn main() {}", langage: "rust", hybride: true });
  r.definirHybride(true);
  expect(estHybride(r)).toBe(false);
  const d = zoneCode({ contenu: "+# a", mode: "diff", langage: "markdown", hybride: true });
  d.definirHybride(true);
  expect(estHybride(d)).toBe(false);
  expect(d.vue.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
  r.detruire();
  d.detruire();
});

test("REQ062_AC18_numero_de_titre_a_la_hauteur_du_titre", () => {
  const z = zoneCode({ contenu: "# T\n\ntexte\n\n## S\n\nfin", langage: "markdown", hybride: true });
  document.body.append(z);
  ensureSyntaxTree(z.vue.state, z.vue.state.doc.length, 5000);
  z.vue.dispatch({});
  const classe = (n) => [...z.vue.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].find((e) => e.textContent === String(n)).className;
  expect(classe(1)).toContain("cm-hy-numero-titre1");
  expect(classe(5)).toContain("cm-hy-numero-titre2");
  expect(classe(3)).not.toContain("cm-hy-numero-titre");
  expect(classe(7)).not.toContain("cm-hy-numero-titre");
  z.definirHybride(false);
  expect(z.vue.dom.querySelector(".cm-hy-numero-titre1")).toBeNull();
  z.detruire();
  z.remove();
});

test("REQ063_AC8_numero_du_tableau_seul_avec_sa_classe_puis_celui_de_la_ligne_suivante", () => {
  const z = zoneCode({ contenu: "# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nfin", langage: "markdown", hybride: true });
  document.body.append(z);
  ensureSyntaxTree(z.vue.state, z.vue.state.doc.length, 5000);
  z.vue.dispatch({});
  const nums = () => [...z.vue.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].filter((e) => /^\d+$/.test(e.textContent));
  const texte = nums().map((e) => e.textContent);
  expect(texte).toContain("3");
  expect(texte).not.toContain("4");
  expect(texte).not.toContain("5");
  expect(texte).toContain("6");
  expect(nums().find((e) => e.textContent === "3").className).toContain("cm-hy-numero-tableau");
  expect(nums().find((e) => e.textContent === "6").className).not.toContain("cm-hy-numero-tableau");
  z.vue.dispatch({ selection: { anchor: z.vue.state.doc.line(3).from } });
  expect(z.vue.dom.querySelector(".cm-hy-numero-tableau")).toBeNull();
  z.detruire();
  z.remove();
});

// Suivre un lien en mode hybride (REQ-101)
const DOC_LIENS = "# Début\n\n[Tests](#lancer-les-tests) [web](https://exemple.org/a) [f](docs/x.md#L3) [absent](#absent)\n\n" + "ligne\n".repeat(30) + "## Lancer les tests !\n\nfin";
function ctrlClic(z, pos, cible) {
  z.vue.posAtCoords = () => pos;
  cible.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
}

test("REQ101_AC4_ancre_du_meme_document_curseur_au_debut_du_titre_focus_gardé", () => {
  const z = zoneCode({ contenu: DOC_LIENS, langage: "markdown", hybride: true, nom: "a.md" });
  document.body.append(z);
  const ligneTitre = DOC_LIENS.slice(0, DOC_LIENS.indexOf("## Lancer")).split("\n").length;
  ctrlClic(z, DOC_LIENS.indexOf("Tests") + 1, z.vue.contentDOM);
  const sel = z.vue.state.selection.main;
  expect(sel.empty).toBe(true);
  expect(z.vue.state.doc.lineAt(sel.head)).toMatchObject({ number: ligneTitre, from: sel.head });
  expect(z.vue.hasFocus).toBe(true);
  // Ancre absente : rien ne bouge.
  ctrlClic(z, DOC_LIENS.indexOf("absent]") + 1, z.vue.contentDOM);
  expect(z.vue.state.selection.main.head).toBe(sel.head);
  z.detruire();
  z.remove();
});

test("REQ101_AC5_web_s_ouvre_avec_noopener_sans_toucher_au_texte_clic_simple_n_ouvre_rien", () => {
  const ouvrir = vi.spyOn(window, "open").mockImplementation(() => null);
  const z = zoneCode({ contenu: DOC_LIENS, langage: "markdown", hybride: true, nom: "a.md" });
  document.body.append(z);
  const pos = DOC_LIENS.indexOf("web]");
  z.vue.posAtCoords = () => pos;
  z.vue.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  expect(ouvrir).not.toHaveBeenCalled();
  ctrlClic(z, pos, z.vue.contentDOM);
  expect(ouvrir).toHaveBeenCalledTimes(1);
  expect(ouvrir).toHaveBeenCalledWith("https://exemple.org/a", "_blank", "noopener,noreferrer");
  expect(z.contenu()).toBe(DOC_LIENS);
  z.detruire();
  z.remove();
  ouvrir.mockRestore();
});

test("REQ101_AC3_fichier_passe_par_surLien_et_survol_par_surSurvolLien", () => {
  const surLien = vi.fn();
  const surSurvolLien = vi.fn();
  const z = zoneCode({ contenu: DOC_LIENS, langage: "markdown", hybride: true, nom: "a.md", surLien, surSurvolLien });
  document.body.append(z);
  const pos = DOC_LIENS.indexOf("[f]") + 1;
  ctrlClic(z, pos, z.vue.contentDOM);
  expect(surLien).toHaveBeenCalledWith({ adresse: "docs/x.md#L3", element: z.vue.contentDOM });
  z.vue.contentDOM.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  expect(surSurvolLien).toHaveBeenLastCalledWith({ geste: "Ctrl+clic", suite: "pour ouvrir docs/x.md" });
  z.detruire();
  z.remove();
});

test("REQ101_AC2_mode_hybride_eteint_rien_ne_se_suit", () => {
  const surLien = vi.fn();
  const z = zoneCode({ contenu: DOC_LIENS, langage: "markdown", nom: "a.md", surLien });
  document.body.append(z);
  ctrlClic(z, DOC_LIENS.indexOf("[f]") + 1, z.vue.contentDOM);
  expect(surLien).not.toHaveBeenCalled();
  z.definirHybride(true);
  ctrlClic(z, DOC_LIENS.indexOf("[f]") + 1, z.vue.contentDOM);
  expect(surLien).toHaveBeenCalledTimes(1);
  z.definirHybride(false);
  ctrlClic(z, DOC_LIENS.indexOf("[f]") + 1, z.vue.contentDOM);
  expect(surLien).toHaveBeenCalledTimes(1);
  z.detruire();
  z.remove();
});
