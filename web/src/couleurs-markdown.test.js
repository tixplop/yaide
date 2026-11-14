import { afterEach, expect, test, vi } from "vitest";
import { analyser, charger, feuille } from "./couleurs-markdown.js";

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
