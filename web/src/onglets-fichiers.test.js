import { expect, test } from "vitest";
import { apresFermeture, estSous, libelles, plusPetitNumeroLibre, suivreRenommage } from "./onglets-fichiers.js";

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
