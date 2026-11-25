import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { decorationsHybride } from "./ui/hybride.js";
import { afterEach, expect, test, vi } from "vitest";
import { analyser, appliquer, charger, feuille, lire, serialiser } from "./couleurs-markdown.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.adoptedStyleSheets = [];
});

const faux = (contenu) => vi.fn(async () => (contenu === null ? { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "absent" }) } : { ok: true, status: 200, text: async () => contenu, headers: { get: () => "v1" } }));

test("REQ115_AC7_analyser_refuse_json_casse_non_objet_theme_element_propriete_ou_valeur_invalide", () => {
  const mauvais = [
    "{",
    "",
    "[]",
    '"x"',
    "12",
    "null",
    '{"sepia":{}}',
    '{"sombre":[]}',
    '{"sombre":{"titre7":{"couleur":"#ff0000"}}}',
    '{"sombre":{"titre1":{"fond":"#ff0000"}}}',
    '{"sombre":{"titre1":[]}}',
    '{"sombre":{"titre1":{"couleur":"red"}}}',
    '{"sombre":{"titre1":{"couleur":"#ff00"}}}',
    '{"sombre":{"titre1":{"couleur":"#ff0000; background: url(http://exemple.org/x.png)"}}}',
    '{"sombre":{"titre1":{"couleur":12}}}',
    '{"sombre":{"titre1":{"couleur":"#ff0000"}},"clair":{"titre1":{"couleur":"red"}}}',
    '{"sombre":{"constructor":{}}}',
  ];
  for (const m of mauvais) expect(analyser(m), m).toEqual({ illisible: true });
});

test("REQ115_AC7_analyser_accepte_vide_parties_absentes_et_normalise_les_couleurs", () => {
  expect(analyser("{}")).toEqual({ sombre: {}, clair: {} });
  expect(analyser('{"clair":{}}')).toEqual({ sombre: {}, clair: {} });
  expect(analyser('{"sombre":{"titre1":{"couleur":"#abc"},"citation":{"fond":"#AABBCC"}}}')).toEqual({
    sombre: { titre1: { couleur: "#aabbcc" }, citation: { fond: "#aabbcc" } },
    clair: {},
  });
});

test("REQ115_AC4_feuille_une_variable_par_element_et_propriete_sous_chaque_theme", () => {
  const sombre = {};
  const clair = {};
  const permis = {
    texte: ["couleur"], gras: ["couleur"], italique: ["couleur"], barre: ["couleur"], lien: ["couleur"], puce: ["couleur"], separateur: ["couleur"],
    code: ["couleur", "fond"], bloc_code: ["couleur", "fond"], entete_tableau: ["couleur", "fond"],
    citation: ["couleur", "fond", "bordure"], tableau: ["couleur", "fond", "bordure"],
  };
  for (let i = 1; i <= 6; i++) permis[`titre${i}`] = ["couleur"];
  for (const [e, ps] of Object.entries(permis)) {
    sombre[e] = Object.fromEntries(ps.map((p) => [p, "#111"]));
    clair[e] = Object.fromEntries(ps.map((p) => [p, "#222222"]));
  }
  const texte = feuille(analyser(JSON.stringify({ sombre, clair })));
  const [regleSombre, regleClair] = [/\[data-theme="dark"\] \{([^}]*)\}/.exec(texte)[1], /\[data-theme="light"\] \{([^}]*)\}/.exec(texte)[1]];
  for (const [e, ps] of Object.entries(permis)) {
    for (const p of ps) {
      const nom = `--md-${e.replaceAll("_", "-")}-${p}`;
      expect(regleSombre).toContain(`${nom}: #111111;`);
      expect(regleClair).toContain(`${nom}: #222222;`);
    }
  }
});

test("REQ115_AC4_feuille_fond_de_bloc_code_citation_ou_code_donne_la_selection_sous_ce_theme_seulement", () => {
  const texte = feuille(analyser('{"sombre":{"bloc_code":{"fond":"#101820"},"citation":{"fond":"#202830"},"code":{"fond":"#303840"},"tableau":{"fond":"#404850"}}}'));
  for (const e of ["bloc-code", "citation", "code"]) expect(texte).toContain(`[data-theme="dark"] .ya-sel-fond-${e} { background: var(--selection); }`);
  expect(texte).not.toContain("ya-sel-fond-tableau");
  expect(texte).not.toContain("light");
  expect(feuille(analyser('{"sombre":{"citation":{"couleur":"#202830"}}}'))).not.toContain("ya-sel-fond");
});

test("REQ115_AC4_feuille_ne_contient_que_des_declarations_de_couleur_normalisees", () => {
  const texte = feuille(analyser('{"clair":{"titre1":{"couleur":"#abc"}}}'));
  expect(texte).toBe('[data-theme="light"] { --md-titre1-couleur: #aabbcc; }');
});

test("REQ115_AC1_charger_sans_fichier_ou_vide_ajoute_aucune_feuille_et_n_ecrit_pas", async () => {
  for (const contenu of [null, "{}", '{"sombre":{}}', "{", "[]"]) {
    const fetch = faux(contenu);
    vi.stubGlobal("fetch", fetch);
    await charger();
    expect(document.adoptedStyleSheets, String(contenu)).toHaveLength(0);
    for (const [url, opts] of fetch.mock.calls) {
      expect(opts?.method ?? "GET").toBe("GET");
      expect(String(url)).toContain("/api/fichier?");
    }
  }
});

test("REQ115_AC7_charger_signale_un_fichier_illisible_sans_feuille", async () => {
  vi.stubGlobal("fetch", faux('{"sombre":{"titre1":{"couleur":"red"}}}'));
  expect(await charger()).toEqual({ illisible: true });
  expect(document.adoptedStyleSheets).toHaveLength(0);
});

class FausseFeuille {
  replaceSync(texte) {
    this.texte = texte;
  }
}

test("REQ115_AC4_charger_ajoute_une_feuille_construite_pour_un_fichier_lisible", async () => {
  vi.stubGlobal("CSSStyleSheet", FausseFeuille);
  vi.stubGlobal("fetch", faux('{"sombre":{"titre1":{"couleur":"#ff8800"}}}'));
  expect(await charger()).toEqual({ illisible: false });
  expect(document.adoptedStyleSheets).toHaveLength(1);
  expect(document.adoptedStyleSheets[0].texte).toContain("--md-titre1-couleur: #ff8800");
});

test("REQ115_AC12_charger_ne_marque_la_selection_que_pour_les_fonds_regles", async () => {
  vi.stubGlobal("CSSStyleSheet", FausseFeuille);
  const marques = () => {
    const texte = "```rust\nfn main() {}\n```\n\n> une citation";
    const etat = EditorState.create({ doc: texte, selection: { anchor: 0, head: texte.length }, extensions: [markdown({ base: markdownLanguage })] });
    return [...new Set(decorationsHybride(etat).filter((d) => d.classe?.startsWith("ya-sel-fond")).map((d) => d.classe))];
  };
  vi.stubGlobal("fetch", faux('{"sombre":{"titre1":{"couleur":"#ff8800"}}}'));
  await charger();
  expect(marques()).toEqual([]);
  vi.stubGlobal("fetch", faux('{"clair":{"bloc_code":{"fond":"#101820"}}}'));
  await charger();
  expect(marques()).toEqual(["ya-sel-fond ya-sel-fond-bloc-code"]);
});

const TEXTE_AC3 = '{\n  "sombre": {\n    "titre1": {\n      "couleur": "#ff8800"\n    }\n  },\n  "clair": {\n    "bloc_code": {\n      "fond": "#101820"\n    }\n  }\n}\n';

test("REQ117_AC3_serialiser_texte_exact_ordre_et_omissions", () => {
  expect(serialiser({ clair: { bloc_code: { fond: "#101820" } }, sombre: { titre1: { couleur: "#f80" } } })).toBe(TEXTE_AC3);
  expect(serialiser({ sombre: { titre1: { couleur: "#F80" } } })).toContain('"#ff8800"');
  const dans = { sombre: { puce: { couleur: "#111111" }, citation: { bordure: "#222222", fond: "#333333", couleur: "#444444" }, titre2: { couleur: "#555555" }, titre1: { couleur: "" }, texte: {} } };
  const sortie = JSON.parse(serialiser(dans));
  expect(Object.keys(sortie.sombre)).toEqual(["titre2", "citation", "puce"]);
  expect(Object.keys(sortie.sombre.citation)).toEqual(["couleur", "fond", "bordure"]);
  expect(serialiser({ sombre: {}, clair: { titre1: { couleur: "" } } })).toBe("{}\n");
  expect(serialiser({ sombre: {}, clair: {} })).toBe("{}\n");
});

test("REQ117_AC1_AC9_AC10_lire_absent_illisible_coupure_raison", async () => {
  const fetch = faux(null);
  vi.stubGlobal("fetch", fetch);
  expect(await lire()).toEqual({ sombre: {}, clair: {} });
  expect(fetch.mock.calls.every(([, o]) => (o?.method ?? "GET") === "GET")).toBe(true);
  vi.stubGlobal("fetch", faux("{"));
  expect(await lire()).toEqual({ illisible: true });
  vi.stubGlobal("fetch", faux('{"clair":{"titre1":{"couleur":"#a40"}}}'));
  expect(await lire()).toEqual({ sombre: {}, clair: { titre1: { couleur: "#aa4400" } } });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  expect((await lire()).coupure).toBe(true);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ cause: "erreur", message: "Disque plein." }) })));
  expect(await lire()).toEqual({ raison: "Disque plein" });
});

test("REQ117_AC5_appliquer_remplace_la_feuille_et_suit_les_fonds_regles", async () => {
  vi.stubGlobal("CSSStyleSheet", FausseFeuille);
  vi.stubGlobal("fetch", faux('{"sombre":{"titre1":{"couleur":"#ff8800"}}}'));
  await charger();
  const premiere = document.adoptedStyleSheets[0];
  appliquer({ sombre: { titre1: { couleur: "#112233" } }, clair: {} });
  expect(document.adoptedStyleSheets).toHaveLength(1);
  expect(document.adoptedStyleSheets[0]).not.toBe(premiere);
  expect(document.adoptedStyleSheets[0].texte).toContain("#112233");
  const marques = () => {
    const texte = "> une citation";
    const etat = EditorState.create({ doc: texte, selection: { anchor: 0, head: texte.length }, extensions: [markdown({ base: markdownLanguage })] });
    return decorationsHybride(etat).filter((d) => d.classe?.startsWith("ya-sel-fond")).length;
  };
  appliquer({ sombre: { citation: { fond: "#202830" } }, clair: {} });
  expect(marques()).toBeGreaterThan(0);
  appliquer({ sombre: {}, clair: {} });
  expect(document.adoptedStyleSheets).toHaveLength(0);
  expect(marques()).toBe(0);
});

test("REQ115_AC13_la_puce_reglee_colore_la_puce_de_l_apercu_et_du_hybride_pas_le_numero", async () => {
  const { readFileSync } = await import("node:fs");
  vi.stubGlobal("CSSStyleSheet", FausseFeuille);
  vi.stubGlobal("fetch", faux('{"sombre":{"puce":{"couleur":"#ff8800"}}}'));
  await charger();
  expect(document.adoptedStyleSheets[0].texte).toContain("--md-puce-couleur: #ff8800");
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  expect(css).toContain(".zone-code-apercu ul > li::marker { color: var(--md-puce-couleur, var(--ink-muted)); }");
  expect(css).toContain(".cm-hy-puce { color: var(--md-puce-couleur, var(--ink-muted));");
  expect(css).not.toMatch(/ol > li::marker/);
});
