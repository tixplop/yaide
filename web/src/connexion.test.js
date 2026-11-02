import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { surveiller } from "./connexion.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function lancer(reponses) {
  const etats = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, { signal }) => {
      const r = reponses.shift();
      if (r === "silence") return new Promise((_ok, ko) => signal.addEventListener("abort", () => ko(new Error("délai"))));
      if (r === "echec") return Promise.reject(new Error("réseau"));
      return Promise.resolve({ status: r });
    }),
  );
  const arreter = surveiller({ surEtat: (e) => etats.push(e) });
  return { etats, arreter };
}

test("REQ015_AC1_une_session_valide_donne_connecte_et_un_changement_seulement_est_publie", async () => {
  const { etats, arreter } = lancer([204, 204, "echec", "echec", 204]);
  await vi.advanceTimersByTimeAsync(1500 * 4 + 10);
  expect(etats).toEqual(["connecte", "coupe", "connecte"]);
  arreter();
});

test("REQ015_AC1_pas_de_reponse_en_2_s_est_une_coupure_detectee_en_moins_de_5_s", async () => {
  const { etats, arreter } = lancer(["silence"]);
  await vi.advanceTimersByTimeAsync(2010);
  expect(etats).toEqual(["coupe"]);
  arreter();
});

test("REQ005_AC7_un_401_donne_session_expiree_et_l_interrogation_s_arrete", async () => {
  const { etats } = lancer([204, 401, 204]);
  await vi.advanceTimersByTimeAsync(10000);
  expect(etats).toEqual(["connecte", "expiree"]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("REQ015_arreter_stoppe_l_interrogation", async () => {
  const { arreter } = lancer([204, 204, 204]);
  await vi.advanceTimersByTimeAsync(10);
  arreter();
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
});
