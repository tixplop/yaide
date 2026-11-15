import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { analyser } from "../couleurs-markdown.js";
import { PALETTES, pastillesDe } from "./palettes.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
function bg200(theme) {
  let v;
  for (const m of tokens.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (sels.includes(":root") || sels.includes(`[data-theme="${theme}"]`)) v = m[2].match(/--bg-200:\s*(#[0-9a-f]{6})/)?.[1] ?? v;
  }
  return v;
}
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("REQ117_AC8_quatre_palettes_dans_l_ordre_avec_les_valeurs_du_tableau", () => {
  expect(PALETTES.map((p) => p.nom)).toEqual(["Ardoise", "Sépia", "Forêt", "Contrasté"]);
  const [ardoise, , , contraste4] = PALETTES;
  expect(ardoise.sombre.titre1).toEqual({ couleur: "#8ab4f8" });
  expect(ardoise.clair.titre1).toEqual({ couleur: "#1d4f91" });
  for (const e of ["titre3", "titre4", "titre5", "titre6"]) expect(ardoise.sombre[e]).toEqual({ couleur: "#c2d6f5" });
  expect(ardoise.sombre.citation).toEqual({ couleur: "#c5cede", fond: "#222a35", bordure: "#5b8bd0" });
  expect(PALETTES[1].clair.tableau).toEqual({ couleur: "#3d3226", fond: "#faf5ec", bordure: "#a08a6c" });
  expect(PALETTES[2].sombre.puce).toEqual({ couleur: "#6fb488" });
  expect(contraste4.clair.citation).toEqual({ couleur: "#000000", fond: "#fff8d6", bordure: "#8a6d00" });
  expect(contraste4.sombre.separateur).toEqual({ couleur: "#bdbdbd" });
});

test("REQ117_AC8_aucune_palette_ne_regle_italique_ni_barre_et_toutes_sont_valides", () => {
  for (const p of PALETTES) {
    for (const theme of ["sombre", "clair"]) {
      expect(p[theme]).not.toHaveProperty("italique");
      expect(p[theme]).not.toHaveProperty("barre");
    }
    const analyse = analyser(JSON.stringify({ sombre: p.sombre, clair: p.clair }));
    expect(analyse.illisible).toBeUndefined();
    expect(analyse.sombre.titre1.couleur).toBe(p.sombre.titre1.couleur);
  }
});

test("REQ117_AC8_contrastes_WCAG_des_palettes_dans_les_deux_themes", () => {
  for (const p of PALETTES) {
    for (const [theme, attribut] of [["sombre", "dark"], ["clair", "light"]]) {
      const page = bg200(attribut);
      expect(page, `--bg-200 ${attribut}`).toMatch(/^#[0-9a-f]{6}$/);
      const fonds = Object.values(p[theme]).flatMap((props) => (props.fond ? [props.fond] : []));
      for (const [element, props] of Object.entries(p[theme])) {
        for (const [propriete, valeur] of Object.entries(props)) {
          const nom = `${p.nom} ${theme} ${element}.${propriete}`;
          if (propriete === "couleur" && element !== "separateur") {
            expect(contraste(valeur, page), nom).toBeGreaterThanOrEqual(4.5);
            for (const f of fonds) expect(contraste(valeur, f), `${nom} sur ${f}`).toBeGreaterThanOrEqual(4.5);
          } else if (propriete === "bordure" || element === "separateur") {
            expect(contraste(valeur, page), nom).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  }
});

test("REQ117_AC13_pastillesDe_prend_titre1_lien_et_bordure_de_citation_pour_chaque_theme", () => {
  expect(pastillesDe(PALETTES[0])).toEqual([
    { sombre: "#8ab4f8", clair: "#1d4f91" },
    { sombre: "#7cc4ff", clair: "#0b57d0" },
    { sombre: "#5b8bd0", clair: "#5b7fb5" },
  ]);
});

// Tableau de C-008 : [élément.propriété, Ardoise, Sépia, Forêt, Contrasté], chacun « sombre/clair ».
const TABLEAU = [
  ["titre1.couleur","#8ab4f8/#1d4f91","#f0b070/#8a3d00","#7ed6a0/#1b6b3a","#ffffff/#000000"],
  ["titre2.couleur","#a8c7fa/#2b5a9a","#e6c08a/#7a4a12","#a0d8b0/#2a6a42","#ffffff/#000000"],
  ["titre3 à titre6.couleur","#c2d6f5/#3a5f8a","#d9c4a0/#6b4c2a","#b8d8c0/#355f45","#ffffff/#000000"],
  ["texte.couleur","#d0d6e0/#2a3240","#ddd2c0/#3d3226","#d0dcd4/#233229","#f0f0f0/#111111"],
  ["gras.couleur","#e8ecf2/#111827","#f2e6d2/#2a2018","#e6f0e8/#14211a","#ffffff/#000000"],
  ["lien.couleur","#7cc4ff/#0b57d0","#ffb86b/#9a4a00","#7fd1c0/#0b6b5e","#8cc8ff/#0040a0"],
  ["code.couleur","#c5d3e8/#2a3a55","#e8c9a0/#6b3a12","#b5e0c0/#1f5a36","#ffe08a/#7a1f00"],
  ["code.fond","#252b33/#eef2f8","#2b2620/#f6efe4","#212b25/#edf6ef","#000000/#f2f2f2"],
  ["bloc_code.couleur","#d0d6e0/#2a3240","#ddd2c0/#3d3226","#d0dcd4/#233229","#f0f0f0/#111111"],
  ["bloc_code.fond","#232830/#f0f3f8","#28241f/#f7f1e7","#202924/#eff5f0","#000000/#f2f2f2"],
  ["citation.couleur","#c5cede/#2a3a55","#d9cbb5/#4a3a28","#c5d6ca/#2a4434","#ffffff/#000000"],
  ["citation.fond","#222a35/#eef3fb","#2c2620/#f8f0e2","#212c25/#edf5ee","#000000/#fff8d6"],
  ["citation.bordure","#5b8bd0/#5b7fb5","#b07a3c/#b07a3c","#4f9a6a/#4f8f63","#ffd24d/#8a6d00"],
  ["entete_tableau.couleur","#e8ecf2/#1a2433","#f2e6d2/#2a2018","#e6f0e8/#14211a","#ffffff/#000000"],
  ["entete_tableau.fond","#2a313c/#e3e9f2","#332c24/#efe4d2","#27332b/#e0ece3","#000000/#e6e6e6"],
  ["tableau.couleur","#d0d6e0/#2a3240","#ddd2c0/#3d3226","#d0dcd4/#233229","#f0f0f0/#111111"],
  ["tableau.fond","#232830/#f4f6fa","#27231e/#faf5ec","#222b25/#f3f8f4","#141414/#f5f5f5"],
  ["tableau.bordure","#5f6f86/#7d8ca2","#84705a/#a08a6c","#557a62/#74927e","#bdbdbd/#555555"],
  ["puce.couleur","#7f9cc6/#4a6890","#c89a60/#7d5420","#6fb488/#2f6743","#ffd24d/#000000"],
  ["separateur.couleur","#5f6f86/#7d8ca2","#84705a/#a08a6c","#557a62/#74927e","#bdbdbd/#555555"],
];

test("REQ117_AC8_toutes_les_valeurs_du_tableau_de_C008", () => {
  expect(TABLEAU).toHaveLength(20);
  for (const [cle, ...valeurs] of TABLEAU) {
    const [element, propriete] = cle.split(".");
    const elements = element === "titre3 à titre6" ? ["titre3", "titre4", "titre5", "titre6"] : [element];
    valeurs.forEach((v, i) => {
      const [sombre, clair] = v.split("/");
      for (const e of elements) {
        expect(PALETTES[i].sombre[e][propriete], `${PALETTES[i].nom} sombre ${e}.${propriete}`).toBe(sombre);
        expect(PALETTES[i].clair[e][propriete], `${PALETTES[i].nom} clair ${e}.${propriete}`).toBe(clair);
      }
    });
  }
  // Rien d'autre que ces valeurs.
  for (const p of PALETTES) for (const theme of ["sombre", "clair"]) {
    expect(Object.values(p[theme]).reduce((n, o) => n + Object.keys(o).length, 0)).toBe(23);
  }
});
