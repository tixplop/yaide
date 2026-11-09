import { expect, test, vi } from "vitest";
import { apresFermeture, estSous, garder, libelles, plusPetitNumeroLibre, retrouver, suivreRenommage } from "./onglets-fichiers.js";
import { ecrire, lire } from "./stockage.js";

vi.mock("./stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

test("REQ011_AC8_le_dossier_parent_suit_le_nom_quand_deux_noms_sont_identiques", () => {
  expect(libelles(["src/main.rs", "tests/main.rs", "README.md"])).toEqual([
    { libelle: "main.rs", detail: "src" },
    { libelle: "main.rs", detail: "tests" },
    { libelle: "README.md", detail: undefined },
  ]);
  expect(libelles(["main.rs", "src/main.rs"]).map((l) => l.detail)).toEqual([undefined, "src"]);
  expect(libelles(["src/main.rs"])[0].detail).toBeUndefined();
});
test("REQ014_AC7_apres_fermeture_la_droite_sinon_la_gauche", () => {
  expect(apresFermeture(["a", "b", "c"], "a")).toBe("b");
  expect(apresFermeture(["a", "b", "c"], "b")).toBe("c");
  expect(apresFermeture(["a", "b", "c"], "c")).toBe("b");
  expect(apresFermeture(["a"], "a")).toBe(null);
});

test("REQ009_AC2_un_onglet_suit_le_renommage_du_fichier_ou_de_son_dossier", () => {
  expect(suivreRenommage("a.txt", "a.txt", "b.txt")).toBe("b.txt");
  expect(suivreRenommage("src/a.rs", "src", "lib")).toBe("lib/a.rs");
  expect(suivreRenommage("srcx/a.rs", "src", "lib")).toBe("srcx/a.rs");
});

test("REQ010_AC3_un_chemin_sous_un_dossier_supprime_est_reconnu", () => {
  expect(estSous("src/a.rs", "src")).toBe(true);
  expect(estSous("src", "src")).toBe(true);
  expect(estSous("srcx/a.rs", "src")).toBe(false);
});

test("REQ068_AC13_plus_petit_numero_libre_parmi_les_numeros_pris", () => {
  expect(plusPetitNumeroLibre([])).toBe(1);
  expect(plusPetitNumeroLibre([1, 2])).toBe(3);
  expect(plusPetitNumeroLibre([2, 3])).toBe(1);
  expect(plusPetitNumeroLibre([1, 3])).toBe(2);
});

test("REQ079_AC18_garde_et_retrouve_la_disposition", async () => {
  const disposition = { arbre: { sens: "ligne", a: { id: "g1", actif: "a" }, b: { id: "g2", actif: null } }, courant: "g2" };
  garder([{ chemin: "a", groupe: "g1" }], "a", disposition);
  expect(ecrire).toHaveBeenLastCalledWith("onglets", { liste: [{ chemin: "a", groupe: "g1" }], actif: "a", disposition });
  lire.mockResolvedValueOnce({ liste: [{ chemin: "a", groupe: "g1" }], actif: "a", disposition });
  expect(await retrouver()).toEqual({ liste: [{ chemin: "a", groupe: "g1" }], actif: "a", disposition });
  // Groupe courant inconnu : le premier groupe.
  lire.mockResolvedValueOnce({ liste: [], actif: null, disposition: { ...disposition, courant: "g7" } });
  expect((await retrouver()).disposition.courant).toBe("g1");
});

test("REQ079_AC18_ancien_format_et_disposition_abimee", async () => {
  const seul = { arbre: { id: "g1", actif: "b" }, courant: "g1" };
  lire.mockResolvedValueOnce({ liste: [{ chemin: "b" }], actif: "b" });
  expect(await retrouver()).toEqual({ liste: [{ chemin: "b" }], actif: "b", disposition: seul });
  for (const abimee of [{ arbre: { sens: "ligne", a: { id: "g1", actif: null } }, courant: "g1" }, { arbre: { id: "g1", actif: null, x: 1 }, courant: "g1" }, "n'importe quoi", null]) {
    lire.mockResolvedValueOnce({ liste: [{ chemin: "b" }], actif: "b", disposition: abimee });
    expect((await retrouver()).disposition).toEqual(seul);
  }
  lire.mockResolvedValueOnce(undefined);
  expect(await retrouver()).toEqual({ liste: [], actif: null, disposition: { arbre: { id: "g1", actif: null }, courant: "g1" } });
});
