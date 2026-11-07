import { afterEach, expect, test, vi } from "vitest";
import { analyser, charger, lire, serialiser } from "./reglages-interface.js";

afterEach(() => vi.unstubAllGlobals());

const TOUT = { recherche: true, git: true, shells: true, agents: true, claude: true };

test("REQ069_AC8_analyser_refuse_json_casse_vide_non_objet_cle_inconnue_valeur_non_booleenne", () => {
  const mauvais = [
    "{",
    "",
    "[]",
    "null",
    '"x"',
    "3",
    '{"gti":{}}',
    '{"replis":[]}',
    '{"replis":null}',
    '{"fonctions":true}',
    '{"replis":{"menu":true}}',
    '{"fonctions":{"gti":false}}',
    '{"replis":{"panneau":"oui"}}',
    '{"replis":{"panneau":1}}',
    '{"fonctions":{"git":null}}',
    '{"replis":{"panneau":true},"autre":1}',
  ];
  for (const texte of mauvais) expect(analyser(texte), texte).toEqual({ illisible: true });
});

test("REQ069_analyser_garde_les_cles_presentes", () => {
  expect(analyser("{}")).toEqual({ replis: {}, fonctions: TOUT });
  expect(analyser('{"replis":{"panneau":false,"shells":true},"fonctions":{"git":false}}')).toEqual({
    replis: { panneau: false, shells: true },
    fonctions: { ...TOUT, git: false },
  });
});

test("REQ069_AC1_charger_sans_fichier_reglages_vides_sans_ecriture", async () => {
  const vide = { replis: {}, fonctions: TOUT };
  for (const reponse of [
    { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "absent" }) },
    { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "x" }) },
    null,
  ]) {
    const fetch = vi.fn(async () => {
      if (!reponse) throw new TypeError("coupure");
      return reponse;
    });
    vi.stubGlobal("fetch", fetch);
    expect(await charger()).toEqual(vide);
    for (const [, opts] of fetch.mock.calls) expect(opts?.method ?? "GET").toBe("GET");
  }
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"replis":{"agent":false}}', headers: { get: () => "v1" } })));
  expect(await charger()).toEqual({ replis: { agent: false }, fonctions: TOUT });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "", headers: { get: () => "v1" } })));
  expect(await charger()).toEqual({ illisible: true });
});

test("REQ071_AC3_AC4_serialiser_fichier_minimal_indente", () => {
  expect(serialiser({ replis: {}, fonctions: TOUT })).toBe("{}\n");
  expect(serialiser({ replis: { panneau: true }, fonctions: { ...TOUT, shells: false } })).toBe(
    '{\n  "replis": {\n    "panneau": true\n  },\n  "fonctions": {\n    "shells": false\n  }\n}\n',
  );
  expect(serialiser({ replis: { agent: false, shells: true }, fonctions: TOUT })).toBe('{\n  "replis": {\n    "agent": false,\n    "shells": true\n  }\n}\n');
  expect(serialiser({ replis: {}, fonctions: { ...TOUT, git: false } })).toBe('{\n  "fonctions": {\n    "git": false\n  }\n}\n');
});

test("REQ071_lire_distingue_absent_illisible_coupure_et_autre_erreur", async () => {
  const repondre = (reponse) =>
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!reponse) throw new TypeError("coupure");
      return reponse;
    }));
  repondre({ ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "absent" }) });
  expect(await lire()).toEqual({ replis: {}, fonctions: TOUT });
  repondre(null);
  expect(await lire()).toEqual({ coupure: true });
  repondre({ ok: false, status: 500, json: async () => ({ cause: "erreur", message: "Disque plein." }) });
  expect(await lire()).toEqual({ raison: "Disque plein" });
  repondre({ ok: true, status: 200, text: async () => "{", headers: { get: () => "v1" } });
  expect(await lire()).toEqual({ illisible: true });
  repondre({ ok: true, status: 200, text: async () => '{"fonctions":{"git":false}}', headers: { get: () => "v1" } });
  expect(await lire()).toEqual({ replis: {}, fonctions: { ...TOUT, git: false } });
});
