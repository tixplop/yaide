// Palettes suggérées de « Couleurs markdown » (C-008, REQ-117). Source unique des valeurs, hors des tokens de l'interface :
// elles ne servent qu'à remplir les champs. Ligne : [élément, propriété, [Ardoise, Sépia, Forêt, Contrasté]], chacune [sombre, clair].
const LIGNES = [
  ["titre1", "couleur", [["#8ab4f8", "#1d4f91"], ["#f0b070", "#8a3d00"], ["#7ed6a0", "#1b6b3a"], ["#ffffff", "#000000"]]],
  ["titre2", "couleur", [["#a8c7fa", "#2b5a9a"], ["#e6c08a", "#7a4a12"], ["#a0d8b0", "#2a6a42"], ["#ffffff", "#000000"]]],
  ["titre3 à titre6", "couleur", [["#c2d6f5", "#3a5f8a"], ["#d9c4a0", "#6b4c2a"], ["#b8d8c0", "#355f45"], ["#ffffff", "#000000"]]],
  ["texte", "couleur", [["#d0d6e0", "#2a3240"], ["#ddd2c0", "#3d3226"], ["#d0dcd4", "#233229"], ["#f0f0f0", "#111111"]]],
  ["gras", "couleur", [["#e8ecf2", "#111827"], ["#f2e6d2", "#2a2018"], ["#e6f0e8", "#14211a"], ["#ffffff", "#000000"]]],
  ["lien", "couleur", [["#7cc4ff", "#0b57d0"], ["#ffb86b", "#9a4a00"], ["#7fd1c0", "#0b6b5e"], ["#8cc8ff", "#0040a0"]]],
  ["code", "couleur", [["#c5d3e8", "#2a3a55"], ["#e8c9a0", "#6b3a12"], ["#b5e0c0", "#1f5a36"], ["#ffe08a", "#7a1f00"]]],
  ["code", "fond", [["#252b33", "#eef2f8"], ["#2b2620", "#f6efe4"], ["#212b25", "#edf6ef"], ["#000000", "#f2f2f2"]]],
  ["bloc_code", "couleur", [["#d0d6e0", "#2a3240"], ["#ddd2c0", "#3d3226"], ["#d0dcd4", "#233229"], ["#f0f0f0", "#111111"]]],
  ["bloc_code", "fond", [["#232830", "#f0f3f8"], ["#28241f", "#f7f1e7"], ["#202924", "#eff5f0"], ["#000000", "#f2f2f2"]]],
  ["citation", "couleur", [["#c5cede", "#2a3a55"], ["#d9cbb5", "#4a3a28"], ["#c5d6ca", "#2a4434"], ["#ffffff", "#000000"]]],
  ["citation", "fond", [["#222a35", "#eef3fb"], ["#2c2620", "#f8f0e2"], ["#212c25", "#edf5ee"], ["#000000", "#fff8d6"]]],
  ["citation", "bordure", [["#5b8bd0", "#5b7fb5"], ["#b07a3c", "#b07a3c"], ["#4f9a6a", "#4f8f63"], ["#ffd24d", "#8a6d00"]]],
  ["entete_tableau", "couleur", [["#e8ecf2", "#1a2433"], ["#f2e6d2", "#2a2018"], ["#e6f0e8", "#14211a"], ["#ffffff", "#000000"]]],
  ["entete_tableau", "fond", [["#2a313c", "#e3e9f2"], ["#332c24", "#efe4d2"], ["#27332b", "#e0ece3"], ["#000000", "#e6e6e6"]]],
  ["tableau", "couleur", [["#d0d6e0", "#2a3240"], ["#ddd2c0", "#3d3226"], ["#d0dcd4", "#233229"], ["#f0f0f0", "#111111"]]],
  ["tableau", "fond", [["#232830", "#f4f6fa"], ["#27231e", "#faf5ec"], ["#222b25", "#f3f8f4"], ["#141414", "#f5f5f5"]]],
  ["tableau", "bordure", [["#5f6f86", "#7d8ca2"], ["#84705a", "#a08a6c"], ["#557a62", "#74927e"], ["#bdbdbd", "#555555"]]],
  ["puce", "couleur", [["#7f9cc6", "#4a6890"], ["#c89a60", "#7d5420"], ["#6fb488", "#2f6743"], ["#ffd24d", "#000000"]]],
  ["separateur", "couleur", [["#5f6f86", "#7d8ca2"], ["#84705a", "#a08a6c"], ["#557a62", "#74927e"], ["#bdbdbd", "#555555"]]],
];

const NOMS = ["Ardoise", "Sépia", "Forêt", "Contrasté"];

function construire(indice) {
  const palette = { nom: NOMS[indice], sombre: {}, clair: {} };
  LIGNES.forEach(([element, propriete, valeurs]) => {
    const elements = element === "titre3 à titre6" ? ["titre3", "titre4", "titre5", "titre6"] : [element];
    ["sombre", "clair"].forEach((theme, t) => {
      for (const e of elements) (palette[theme][e] ??= {})[propriete] = valeurs[indice][t];
    });
  });
  return palette;
}

export const PALETTES = NOMS.map((_, i) => construire(i));

/** Les trois pastilles d'un bouton de palette : `titre1`, `lien` et bordure de `citation`, pour chaque thème. */
export function pastillesDe(palette) {
  const prendre = (theme) => [palette[theme].titre1.couleur, palette[theme].lien.couleur, palette[theme].citation.bordure];
  const s = prendre("sombre");
  const c = prendre("clair");
  return s.map((sombre, i) => ({ sombre, clair: c[i] }));
}
