import { expect, test } from "vitest";
import { depuisProjet } from "./references.js";

const P = "/home/u/code/projet";

test("REQ087_AC3_AC4_conversion_relatif_et_point_slash", () => {
  expect(depuisProjet("src/main.rs", P)).toBe("src/main.rs");
  expect(depuisProjet("./src/main.rs", P)).toBe("src/main.rs");
  expect(depuisProjet("src/./a/../main.rs", P)).toBe("src/main.rs");
  expect(depuisProjet("../essai/src/main.rs", P)).toBe("../essai/src/main.rs");
});

test("REQ087_AC3_AC4_conversion_absolu", () => {
  expect(depuisProjet(`${P}/src/main.rs`, P)).toBe("src/main.rs");
  expect(depuisProjet("/home/u/code/essai/src/main.rs", P)).toBe("../essai/src/main.rs");
  expect(depuisProjet("/etc/hosts", P)).toBe("../../../../etc/hosts");
  expect(depuisProjet(P, P)).toBeUndefined();
});

test("REQ087_AC5_chemins_vides_ou_sans_fichier", () => {
  expect(depuisProjet("", P)).toBeUndefined();
  expect(depuisProjet("./", P)).toBeUndefined();
  expect(depuisProjet("a/..", P)).toBeUndefined();
});
