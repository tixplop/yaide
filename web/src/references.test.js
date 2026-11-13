import { expect, test, vi } from "vitest";
import { depuisProjet, estMac, identifiantTitre, lienDeDocument, ligneDuTitre } from "./references.js";

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

const L = (a, doc = "docs/guide.md") => lienDeDocument(a, doc, P);

test("REQ101_AC3_fichier_relatif_absolu_file_et_ligne", () => {
  expect(L("../src/main.rs#L3")).toEqual({ sorte: "fichier", ecrit: "../src/main.rs", chemin: "src/main.rs", ligne: 3, ancre: null });
  expect(L("../src/main.rs:3")).toMatchObject({ chemin: "src/main.rs", ligne: 3, ecrit: "../src/main.rs" });
  expect(L("../src/main.rs:3:7")).toMatchObject({ chemin: "src/main.rs", ligne: 3 });
  expect(L("../src/main.rs#L3-L9")).toMatchObject({ ligne: 3, ancre: null });
  expect(L(`${P}/src/main.rs`)).toMatchObject({ chemin: "src/main.rs", ligne: null });
  expect(L(`file://${P}/src/main.rs`)).toMatchObject({ chemin: "src/main.rs", ecrit: `${P}/src/main.rs` });
  expect(L("a%20b.md")).toMatchObject({ chemin: "docs/a b.md", ecrit: "a b.md" });
  expect(L("main.rs:3")).toMatchObject({ sorte: "fichier", chemin: "docs/main.rs", ligne: 3 });
  expect(L("../README.md", "guide.md")).toMatchObject({ chemin: "../README.md" });
});

test("REQ101_AC7_depuis_un_worktree", () => {
  expect(L("../README.md", "../essai/docs/guide.md")).toMatchObject({ chemin: "../essai/README.md" });
});

test("REQ101_AC6_hors_projet_et_dossier_gardent_leur_chemin", () => {
  expect(L("../../autre/x.md").chemin).toBe("../autre/x.md");
  expect(L("../web")).toMatchObject({ sorte: "fichier", chemin: "web", ecrit: "../web" });
  expect(L("..", "guide.md").chemin).toBe("..");
  expect(L(".", "guide.md").chemin).toBeUndefined();
});

test("REQ101_AC4_ancre_du_document_ou_d_un_fichier", () => {
  expect(L("#lancer-les-tests")).toEqual({ sorte: "ancre", ancre: "lancer-les-tests" });
  expect(L("#%C3%A9t%C3%A9")).toEqual({ sorte: "ancre", ancre: "été" });
  expect(L("guide.md#lancer-les-tests")).toMatchObject({ sorte: "fichier", chemin: "docs/guide.md", ancre: "lancer-les-tests", ligne: null });
});

test("REQ101_AC5_AC8_web_et_adresses_refusees", () => {
  expect(L("https://exemple.org/a")).toEqual({ sorte: "web", adresse: "https://exemple.org/a" });
  expect(L("http://x.fr")).toMatchObject({ sorte: "web" });
  expect(L("mailto:a@b.fr")).toMatchObject({ sorte: "web" });
  for (const a of ["javascript:alert(1)", "data:text/html,x", "ftp://x", "", "  ", "#", undefined]) expect(L(a)).toBeNull();
});

test("REQ101_AC4_identifiant_de_titre_comme_github", () => {
  expect(identifiantTitre("Lancer les tests !")).toBe("lancer-les-tests");
  expect(identifiantTitre("Été à l'école_2 - ok")).toBe("été-à-lécole_2---ok");
  expect(identifiantTitre("**Gras** `code` [lien](http://x) fin")).toBe("gras-code-lien-fin");
});

test("REQ101_AC4_ligne_du_titre_atx_setext_hors_code", () => {
  const md = "# A\n\n```\n## Lancer les tests\n```\n\nLancer les tests\n----\n\n## Lancer les tests ##\n";
  expect(ligneDuTitre(md, "lancer-les-tests")).toBe(7);
  expect(ligneDuTitre("a\n## Lancer les tests !\nb", "lancer-les-tests")).toBe(2);
  expect(ligneDuTitre("```\n## T\n```\n~~~\n# T\n~~~", "t")).toBeNull();
  expect(ligneDuTitre("# A\n", "absent")).toBeNull();
  expect(ligneDuTitre("texte\n\n---\n", "texte")).toBeNull();
});

test("REQ101_AC10_estMac_d_apres_la_plateforme", () => {
  try {
    const cas = [
      [{ platform: "MacIntel" }, true],
      [{ platform: "Linux x86_64" }, false],
      [{ platform: "", userAgentData: { platform: "macOS" } }, true],
      [{ platform: "MacIntel", userAgentData: { platform: "macOS" } }, true],
      [{ platform: "", userAgentData: { platform: "Mac" } }, true],
      [{ platform: "Win32", userAgentData: { platform: "Windows" } }, false],
    ];
    for (const [nav, attendu] of cas) {
      vi.stubGlobal("navigator", nav);
      expect(estMac()).toBe(attendu);
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
