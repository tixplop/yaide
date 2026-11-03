import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("web/src/ui/tokens.css", "utf8");
const t = {};
for (const m of css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) t[m[1]] = m[2].trim();

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(t[a]), lum(t[b])].sort((p, q) => q - p);
  return Math.floor(((x + 0.05) / (y + 0.05)) * 10) / 10;
}

const sur = ["--fond", "--surface", "--surface-haute"];
const tableau = [
  ["--texte", 4.5, [14.3, 13.0, 11.5]],
  ["--texte-attenue", 4.5, [7.4, 6.7, 5.9]],
  ["--bordure-champ", 3, [4.8, 4.3, 3.8]],
  ["--accent", 3, [6.6, 6.0, 5.2]],
  ["--succes", 4.5, [8.4, 7.7, 6.8]],
  ["--alerte", 4.5, [9.2, 8.3, 7.4]],
  ["--erreur", 4.5, [7.1, 6.4, 5.7]],
];
const colores = [
  ["--texte-sur-couleur", "--accent", 6.6],
  ["--texte-sur-couleur", "--accent-survol", 8.1],
  ["--texte-sur-couleur", "--erreur", 7.1],
  ["--texte-sur-couleur", "--erreur-survol", 8.8],
  ["--texte-sur-couleur", "--alerte", 9.2],
  ["--texte", "--selection", 7.1],
  ["--texte", "--diff-ajout", 10.8],
  ["--texte", "--diff-retrait", 11.8],
];
const code = { "--code-mot-cle": 7.4, "--code-chaine": 9.7, "--code-nombre": 8.4, "--code-fonction": 9.0, "--code-type": 10.8 };

test("REQ028_AC3_contrastes_texte_et_interface_sur_les_trois_surfaces", () => {
  for (const [nom, seuil, attendus] of tableau) {
    sur.forEach((fond, i) => {
      const r = ratio(nom, fond);
      expect(r, `${nom} sur ${fond}`).toBeGreaterThanOrEqual(seuil);
      expect(r, `${nom} sur ${fond}`).toBe(attendus[i]);
    });
  }
});

test("REQ028_AC3_contrastes_texte_sur_fond_colore", () => {
  for (const [a, b, attendu] of colores) {
    const r = ratio(a, b);
    expect(r, `${a} sur ${b}`).toBeGreaterThanOrEqual(4.5);
    expect(r, `${a} sur ${b}`).toBe(attendu);
  }
});

test("REQ028_AC3_contrastes_des_couleurs_du_code_sur_le_fond", () => {
  for (const [nom, attendu] of Object.entries(code)) {
    expect(ratio(nom, "--fond"), nom).toBeGreaterThanOrEqual(4.5);
    expect(ratio(nom, "--fond"), nom).toBe(attendu);
  }
});

test("REQ028_AC3_theme_sombre_seul_accent_bleu_polices_et_mesures", () => {
  expect(t["--fond"]).toBe("#14171C");
  expect(css).toContain("color-scheme: dark");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(t["--accent"].slice(i, i + 2), 16));
  expect(b).toBeGreaterThan(r);
  expect(b).toBeGreaterThan(g);
  expect(t["--police-ui"]).toMatch(/sans-serif$/);
  expect(t["--police-code"]).toMatch(/monospace$/);
  expect(t["--hauteur-controle"]).toBe("24px");
  expect(t["--trait-fort"]).toBe("2px");
  expect(css).not.toMatch(/@import|url\(|transition|animation/);
});

const messages = ["--message-info", "--message-succes", "--message-alerte", "--message-erreur"];
const statuts = ["--statut-modifie", "--statut-nouveau", "--statut-renomme", "--statut-conflit"];
const hautes = ["--surface", "--surface-haute"];

function verifie(nom, fonds, seuil) {
  for (const fond of fonds) expect(ratio(nom, fond), `${nom} sur ${fond}`).toBeGreaterThanOrEqual(seuil);
}

test("REQ033_AC6_contrastes_texte_des_paires_nouvelles", () => {
  for (const texte of ["--texte", "--texte-attenue"]) verifie(texte, ["--fond-rail", "--fond-shells", ...messages], 4.5);
  for (const c of [...statuts, "--succes", "--erreur"]) verifie(c, hautes, 4.5);
});

test("REQ033_AC6_contrastes_icone_et_poignee_des_paires_nouvelles", () => {
  verifie("--icone-naviguer", ["--fond-rail", ...hautes, ...messages], 3);
  verifie("--icone-distant", hautes, 3);
  verifie("--icone-dossier", hautes, 3);
  for (const c of ["--succes", "--erreur", "--bordure-champ"]) verifie(c, hautes, 3);
  verifie("--texte-attenue", ["--surface-haute"], 3);
  verifie("--bordure-champ", messages, 3);
});

test("REQ033_AC6_valeurs_du_tableau_des_contrastes_nouveaux", () => {
  expect(ratio("--texte", "--fond-rail")).toBe(15.5);
  expect(ratio("--texte", "--fond-shells")).toBe(14.1);
  expect(ratio("--statut-conflit", "--surface")).toBe(8.0);
  expect(ratio("--icone-naviguer", "--message-erreur")).toBe(8.5);
  expect(ratio("--bordure-champ", "--message-succes")).toBe(3.3);
});

test("REQ033_AC8_fonds_distincts_et_tokens_de_dimension_nouveaux", () => {
  const fonds = ["--fond-rail", "--surface", "--fond", "--fond-shells"].map((n) => t[n]);
  expect(new Set(fonds).size).toBe(4);
  expect(t["--epaisseur-poignee"]).toBe("8px");
  expect(t["--pas-poignee"]).toBe("16px");
  expect(t["--taille-icone"]).toBe("16px");
  expect(t["--taille-icone-rail"]).toBe("20px");
  expect(t["--taille-icone-petite"]).toBe("14px");
  expect(t["--largeur-panneau-min"]).toBe("160px");
  expect(t["--largeur-panneau-max"]).toBe("480px");
  expect(t["--largeur-editeur-min"]).toBe("320px");
  expect(t["--hauteur-shells-min"]).toBe("120px");
  expect(t["--hauteur-editeur-min"]).toBe("120px");
});
