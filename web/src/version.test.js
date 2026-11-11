import { afterEach, expect, test, vi } from "vitest";
import { suivreVersion } from "./version.js";

afterEach(() => vi.unstubAllGlobals());

function lancer(lecture) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => lecture })));
  const vus = [];
  const suivi = suivreVersion({ surChangement: (e) => vus.push(e) });
  return { vus, suivi };
}
const attendre = () => new Promise((r) => setTimeout(r, 0));

test("REQ092_AC4_comparaison_des_trois_nombres", async () => {
  for (const [derniere, etat] of [["0.9.2", "disponible"], ["0.10.0", "disponible"], ["1.0.0", "disponible"], ["0.9.1", "aucune"], ["0.8.9", "aucune"], ["illisible", "aucune"]]) {
    const { vus, suivi } = lancer({ version: "0.9.1", derniere, maj: "aucune", installee: null });
    await attendre();
    expect(vus.at(-1).maj.etat, derniere).toBe(etat);
    suivi.detruire();
  }
});

test("REQ092_AC3_les_versions_s_affichent_avec_leur_v", async () => {
  const { vus, suivi } = lancer({ version: "0.9.1", derniere: "0.9.2", maj: "aucune", installee: null });
  await attendre();
  expect(vus.at(-1)).toEqual({ version: "v0.9.1", maj: { etat: "disponible", derniere: "v0.9.2" } });
  suivi.detruire();
});
