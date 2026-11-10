import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("web/src/ui/tokens.css", "utf8");
const composants = readFileSync("web/src/ui/composants.css", "utf8");

// Règles du fichier : { selecteurs, decl }.
const regles = [];
for (const m of css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const decl = {};
  for (const d of m[2].matchAll(/(--[a-z0-9-]+|color-scheme):\s*([^;]+);/g)) decl[d[1]] = d[2].trim();
  regles.push({ selecteurs: m[1].split(",").map((s) => s.trim()), decl });
}
// Déclarations qui s'appliquent à <html data-theme=...> : :root d'abord, puis le thème.
function jetons(theme) {
  const t = {};
  for (const sel of [":root", `[data-theme="${theme}"]`]) {
    for (const r of regles) if (r.selecteurs.includes(sel)) Object.assign(t, r.decl);
  }
  return t;
}
const T = { dark: jetons("dark"), light: jetons("light") };

// Couleur { r, g, b, a } (r, g, b de 0 à 255) d'une valeur CSS du fichier.
function couleur(theme, valeur) {
  const v = valeur.trim();
  let m;
  if ((m = v.match(/^var\((--[a-z0-9-]+)\)$/))) return couleur(theme, T[theme][m[1]]);
  if ((m = v.match(/^#([0-9a-f]{6})$/i))) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4), 16), a: 1 };
  if ((m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/))) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  if ((m = v.match(/^color-mix\(in srgb,\s*(var\(--[a-z0-9-]+\))\s+(\d+)%,\s*transparent\)$/))) {
    const c = couleur(theme, m[1]);
    return { ...c, a: c.a * (m[2] / 100) };
  }
  throw new Error(`valeur de couleur inconnue : ${v}`);
}
const jeton = (theme, nom) => couleur(theme, T[theme][nom]);
// Pose une couleur (avec alpha) sur un fond opaque.
function poser(c, fond) {
  const m = (x, y) => x * c.a + y * (1 - c.a);
  return { r: m(c.r, fond.r), g: m(c.g, fond.g), b: m(c.b, fond.b), a: 1 };
}
const ratioOpaque = (fond) => !(fond.startsWith("--msg-") || ["--selection", "--find-match", "--ligne-active", "--accent-soft", "--diff-ajout", "--diff-retrait"].includes(fond));
function lum(c) {
  const [r, g, b] = [c.r, c.g, c.b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Contraste WCAG arrondi vers le bas à 0,1.
function contraste(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.floor(((x + 0.05) / (y + 0.05)) * 10 + 1e-9) / 10;
}
// Contraste du jeton `texte` posé sur `fond` (jeton, éventuellement avec alpha, posé sur `sous`).
function ratio(theme, texte, fond, sous) {
  let f = jeton(theme, fond);
  if (f.a < 1) f = poser(f, jeton(theme, sous ?? "--bg-200"));
  let c = jeton(theme, texte);
  if (c.a < 1) c = poser(c, f);
  return contraste(c, f);
}

const THEMES = ["dark", "light"];
// Le tableau a été mesuré dans le navigateur, qui arrondit chaque mélange à 8 bits : une paire à alpha peut
// s'écarter de 0,1 du calcul exact. Les paires opaques sont comparées sans écart.
function egalA(r, attendu, msg) {
  expect(Math.abs(r - attendu), `${msg} : ${r} au lieu de ${attendu}`).toBeLessThanOrEqual(0.1000001);
}

// AC-036-1 : valeurs de design-system.md, thème par thème.
const couleurs = {
  "--bg-000": ["#181818", "#f0f0f0"],
  "--bg-100": ["#1b1b1c", "#f8f8f8"],
  "--bg-200": ["#1f1f1f", "#ffffff"],
  "--bg-300": ["#2a2a2b", "#ffffff"],
  "--bg-400": ["#37373d", "#e4e6f1"],
  "--hover": ["#2a2d2e", "#f0f0f3"],
  "--list-focus": ["#04395e", "#dcebfa"],
  "--line": ["#2b2b2b", "#e5e5e5"],
  "--line-strong": ["#737373", "#8a8a8a"],
  "--ink": ["#cccccc", "#1f1f1f"],
  "--ink-muted": ["#a0a0a0", "#5c5c5c"],
  "--ink-faint": ["#8b8b8b", "#6e6e6e"],
  "--accent": ["#0078d4", "#005fb8"],
  "--accent-fg": ["#4daafc", "#005fb8"],
  "--on-accent": ["#ffffff", "#ffffff"],
  "--accent-soft": ["rgba(0,120,212,.20)", "rgba(0,95,184,.12)"],
  "--selection": ["rgba(38,79,120,.85)", "rgba(173,214,255,.85)"],
  "--find-match": ["rgba(230,160,40,.33)", "rgba(240,170,40,.40)"],
  "--git-added": ["#81b88b", "#2a7034"],
  "--git-modified": ["#e2c08d", "#865300"],
  "--git-deleted": ["#f07a6a", "#b0261c"],
  "--git-untracked": ["#4ec9b0", "#0a6c60"],
  "--git-conflict": ["#d18bd6", "#8a3ea0"],
  "--syn-keyword": ["#5aa2e0", "#0b3fd6"],
  "--syn-control": ["#c98fcf", "#9b2fa0"],
  "--syn-string": ["#d39a7c", "#a31515"],
  "--syn-function": ["#dcdcaa", "#6d5520"],
  "--syn-number": ["#b5cea8", "#08704a"],
  "--syn-type": ["#4ec9b0", "#1f6f8b"],
  "--syn-variable": ["#9cdcfe", "#0a3c86"],
  "--syn-comment": ["#7ba862", "#336d1b"],
};
const alias = { "--git-ignored": "--ink-faint", "--danger": "--git-deleted", "--warning": "--git-modified", "--info": "--accent-fg", "--syn-punctuation": "--ink", "--apercu-fond": "--hover", "--apercu-entete": "--bg-400" };

test("REQ036_AC1_chaque_couleur_du_tableau_a_sa_valeur_dans_les_deux_themes", () => {
  THEMES.forEach((theme, i) => {
    for (const [nom, valeurs] of Object.entries(couleurs)) {
      expect(T[theme][nom], `${nom} (${theme})`).toBeDefined();
      expect(jeton(theme, nom), `${nom} (${theme})`).toEqual(couleur(theme, valeurs[i]));
    }
    for (const [nom, cible] of Object.entries(alias)) expect(T[theme][nom], `${nom} (${theme})`).toBe(`var(${cible})`);
  });
});

test("REQ036_AC1_ombres_melanges_voile_et_formes", () => {
  expect(T.dark["--shadow-popover"]).toBe("0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px #454545");
  expect(T.light["--shadow-popover"]).toBe("0 4px 16px rgba(0,0,0,0.16), 0 0 0 1px #d4d4d4");
  for (const theme of THEMES) {
    const t = T[theme];
    expect(t["--msg-info"]).toBe("color-mix(in srgb, var(--info) 14%, transparent)");
    expect(t["--msg-succes"]).toBe("color-mix(in srgb, var(--git-added) 14%, transparent)");
    expect(t["--msg-alerte"]).toBe("color-mix(in srgb, var(--warning) 14%, transparent)");
    expect(t["--msg-erreur"]).toBe("color-mix(in srgb, var(--danger) 14%, transparent)");
    expect(t["--diff-ajout"]).toBe("color-mix(in srgb, var(--git-added) 14%, transparent)");
    expect(t["--diff-retrait"]).toBe("color-mix(in srgb, var(--git-deleted) 14%, transparent)");
    expect(t["--ligne-active"]).toBe("color-mix(in srgb, var(--ink) 4%, transparent)");
    expect(t["--voile"]).toBe("rgb(0 0 0 / .4)");
    expect(t["--space-1"]).toBe("4px");
    expect(t["--space-2"]).toBe("8px");
    expect(t["--space-3"]).toBe("12px");
    expect(t["--space-4"]).toBe("16px");
    expect(t["--space-6"]).toBe("24px");
    expect(t["--space-8"]).toBe("32px");
    expect(t["--radius-sm"]).toBe("4px");
    expect(t["--radius-md"]).toBe("6px");
    expect(t["--largeur-menu-min"]).toBe("220px");
    expect(t["--radius-xs"]).toBe("2px");
    expect(t["--radius-lg"]).toBe("10px");
    expect(t["--size-row"]).toBe("22px");
    expect(t["--size-control"]).toBe("26px");
    expect(t["--size-tab"]).toBe("35px");
    expect(t["--size-titlebar"]).toBe("35px");
    expect(t["--size-status"]).toBe("22px");
    expect(t["--size-activity"]).toBe("48px");
    expect(t["--size-indent"]).toBe("8px");
    expect(t["--largeur-palette"]).toBe("600px");
    expect(t["--font-sans"]).toBe('"Segoe WPC", "Segoe UI", system-ui, -apple-system, "Ubuntu", "Inter", sans-serif');
    expect(t["--font-mono"]).toBe('"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace');
  }
});

test("REQ038_AC5_chaque_theme_pose_son_color_scheme", () => {
  expect(T.dark["color-scheme"]).toBe("dark");
  expect(T.light["color-scheme"]).toBe("light");
});

test("REQ033_AC8_les_trois_fonds_de_zone_sont_distincts_dans_les_deux_themes", () => {
  for (const theme of THEMES) {
    const fonds = ["--bg-000", "--bg-100", "--bg-200"].map((n) => T[theme][n]);
    expect(new Set(fonds).size, theme).toBe(3);
  }
});

const ANCIENS = [
  "fond", "fond-rail", "fond-shells", "surface", "surface-haute", "texte", "texte-attenue", "texte-sur-couleur", "bordure", "bordure-champ",
  "accent-survol", "succes", "alerte", "erreur", "erreur-survol", "statut-modifie", "statut-nouveau", "statut-renomme", "statut-conflit",
  "message-info", "message-succes", "message-alerte", "message-erreur", "icone-naviguer", "icone-distant", "icone-dossier",
  "code-mot-cle", "code-chaine", "code-nombre", "code-fonction", "code-type", "police-ui", "police-code", "ombre-dialogue",
  "graisse-normale", "esp-1", "esp-2", "esp-3", "esp-4", "esp-5", "esp-6", "rayon-petit", "rayon-dialogue", "hauteur-onglet", "hauteur-controle", "largeur-ouverture",
];

// Fichiers .css et .js de web/src, tests exclus.
function sources(dossier = "web/src") {
  const fichiers = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = `${dossier}/${e.name}`;
    if (e.isDirectory()) fichiers.push(...sources(chemin));
    else if (/\.(css|js)$/.test(e.name) && !/\.test\.js$/.test(e.name)) fichiers.push(chemin);
  }
  return fichiers;
}

test("REQ036_AC1_aucun_ancien_nom_de_token_dans_web_src", () => {
  const motif = new RegExp(`--(${ANCIENS.join("|")})(?![a-z0-9-])`);
  for (const f of [...sources(), "web/index.html"]) expect(readFileSync(f, "utf8"), f).not.toMatch(motif);
  expect(css).not.toMatch(/Transition/);
});

test("REQ036_AC1_aucune_couleur_en_dur_hors_de_tokens_css", () => {
  for (const f of sources().filter((f) => !f.endsWith("ui/tokens.css") && !f.includes("/polices/"))) {
    const texte = readFileSync(f, "utf8").replace(/\/\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(texte, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![-\w])/);
    expect(texte, f).not.toMatch(/\brgba?\(|\bhsla?\(/);
  }
});

test("REQ036_AC2_le_css_livre_n_a_ni_import_ni_autre_origine", () => {
  for (const f of [css, composants]) {
    expect(f).not.toMatch(/@import/);
    expect(f).not.toMatch(/https?:\/\/|\/\/[a-z]/i);
  }
  for (const m of composants.matchAll(/url\(([^)]*)\)/g)) expect(m[1]).toMatch(/^"\/polices\/JetBrainsMono-[A-Za-z]+\.woff2"$/);
  expect(css).not.toMatch(/url\(|transition|animation/);
});

test("REQ036_AC11_font_face_des_trois_fichiers_en_swap_dans_composants_css", () => {
  const faces = [...composants.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  expect(faces).toHaveLength(3);
  for (const f of faces) {
    expect(f).toContain('font-family: "JetBrains Mono"');
    expect(f).toContain("font-display: swap");
  }
  const joint = faces.join("\n");
  expect(joint).toContain("JetBrainsMono-Regular.woff2");
  expect(joint).toContain("JetBrainsMono-Italic.woff2");
  expect(joint).toContain("JetBrainsMono-SemiBold.woff2");
  expect(joint).toMatch(/font-style: italic/);
  expect(joint).toMatch(/font-weight: 600/);
});

// AC-033-6 : tableaux « Contrastes » de design-system.md, « sombre / clair ». null = paire non utilisée.
const fonds = ["--bg-000", "--bg-100", "--bg-200", "--bg-300", "--bg-400", "--hover", "--list-focus"];
const texte = {
  "--ink": [[11, 14.4], [10.7, 15.5], [10.2, 16.4], [8.9, 16.4], [7.3, 13.2], [8.6, 14.4], [7.4, 13.5]],
  "--ink-muted": [[6.7, 5.8], [6.5, 6.2], [6.3, 6.6], [5.4, 6.6], [4.5, 5.3], [5.3, 5.8], [4.5, 5.5]],
  "--ink-faint": [null, [5, 4.8], [4.8, 5], null, null, null, null],
  "--git-ignored": [null, [5, 4.8], [4.8, 5], null, null, null, null],
  "--accent-fg": [null, null, null, [5.7, 6.3], null, null, [4.8, 5.1]],
  "--git-added": [null, [7.5, 5.7], [7.1, 6], null, [5.1, 4.8], [6, 5.3], [5.2, 4.9]],
  "--git-modified": [[10.2, 5.6], [9.9, 6], [9.5, 6.4], null, [6.8, 5.1], [8, 5.6], [6.9, 5.3]],
  "--warning": [[10.2, 5.6], [9.9, 6], [9.5, 6.4], null, [6.8, 5.1], [8, 5.6], [6.9, 5.3]],
  "--git-deleted": [[6.5, 5.8], [6.3, 6.2], [6, 6.6], [5.2, 6.6], null, [5, 5.8], null],
  "--danger": [[6.5, 5.8], [6.3, 6.2], [6, 6.6], [5.2, 6.6], null, [5, 5.8], null],
  "--git-untracked": [null, [8.4, 5.9], [8, 6.3], null, [5.8, 5], [6.8, 5.5], [5.8, 5.2]],
  "--git-conflict": [null, [6.8, 6], [6.5, 6.4], null, [4.7, 5.1], [5.5, 5.6], [4.7, 5.2]],
};

test("REQ033_AC6_contrastes_du_texte_sur_les_fonds_dans_les_deux_themes", () => {
  for (const [nom, ligne] of Object.entries(texte)) {
    ligne.forEach((paire, i) => {
      if (!paire) return;
      THEMES.forEach((theme, k) => {
        const r = ratio(theme, nom, fonds[i]);
        expect(r, `${nom} sur ${fonds[i]} (${theme})`).toBe(paire[k]);
        expect(r, `${nom} sur ${fonds[i]} (${theme})`).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});

test("REQ033_AC6_contrastes_des_paires_de_texte_a_alpha_et_melanges", () => {
  const msg = ["--msg-info", "--msg-succes", "--msg-alerte", "--msg-erreur"];
  THEMES.forEach((theme, k) => {
    const verifie = (texte, fond, sous, attendu) => {
      const r = ratio(theme, texte, fond, sous);
      if (ratioOpaque(fond)) expect(r, `${texte} sur ${fond} (${theme})`).toBe(attendu);
      else egalA(r, attendu, `${texte} sur ${fond}/${sous} (${theme})`);
      expect(r).toBeGreaterThanOrEqual(4.5);
    };
    verifie("--on-accent", "--accent", null, [4.5, 6.3][k]);
    // Survol du bouton principal : accent assombri (brightness .88).
    const a = jeton(theme, "--accent");
    const sombre = { r: a.r * 0.88, g: a.g * 0.88, b: a.b * 0.88, a: 1 };
    expect(contraste(jeton(theme, "--on-accent"), sombre), "bouton survolé").toBe([5.5, 7.5][k]);
    verifie("--bg-000", "--warning", null, [10.2, 5.6][k]);
    const sur200 = [[8.1, 7.9, 7.5, 8.3], [13.2, 13.4, 13.4, 13]][k];
    const sur100 = [[8.4, 8.3, 7.9, 8.6], [12.5, 12.7, 12.6, 12.2]][k];
    msg.forEach((m, i) => {
      verifie("--ink", m, "--bg-200", sur200[i]);
      verifie("--ink", m, "--bg-100", sur100[i]);
    });
    verifie("--ink", "--msg-erreur", "--bg-300", [7.1, 13][k]);
    verifie("--ink", "--diff-ajout", "--bg-200", [7.9, 13.4][k]);
    verifie("--ink", "--diff-retrait", "--bg-200", [8.3, 13][k]);
    verifie("--ink", "--selection", "--bg-200", [5.9, 11.5][k]);
    verifie("--ink", "--selection", "--bg-000", [6, 11.3][k]);
    verifie("--ink", "--find-match", "--bg-100", [5.4, 12][k]);
    verifie("--ink", "--ligne-active", "--bg-200", [9.5, 15.2][k]);
  });
});

test("REQ033_AC6_contrastes_des_couleurs_du_code", () => {
  const code = {
    "--syn-keyword": [[6, 7.7], [5.6, 7.2]],
    "--syn-control": [[6.5, 6.3], [6, 5.8]],
    "--syn-string": [[6.8, 7.8], [6.3, 7.2]],
    "--syn-function": [[11.6, 7], [10.8, 6.5]],
    "--syn-number": [[9.7, 6.1], [9, 5.6]],
    "--syn-type": [[8, 5.6], [7.5, 5.2]],
    "--syn-variable": [[11, 10.4], [10.2, 9.6]],
    "--syn-comment": [[5.9, 6.2], [5.5, 5.8]],
  };
  for (const [nom, [fond, active]] of Object.entries(code)) {
    THEMES.forEach((theme, k) => {
      expect(ratio(theme, nom, "--bg-200"), `${nom} sur --bg-200 (${theme})`).toBe(fond[k]);
      // La ligne active est posée sur le fond de l'éditeur : on pose le texte sur ce résultat.
      const ligne = poser(jeton(theme, "--ligne-active"), jeton(theme, "--bg-200"));
      egalA(contraste(jeton(theme, nom), ligne), active[k], `${nom} sur la ligne active (${theme})`);
      expect(fond[k]).toBeGreaterThanOrEqual(4.5);
      expect(active[k]).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test("REQ033_AC6_contrastes_des_icones_contours_et_poignee", () => {
  const msg = ["--msg-info", "--msg-succes", "--msg-alerte", "--msg-erreur"];
  THEMES.forEach((theme, k) => {
    const egal = (nom, fond, sous, attendu) => {
      const r = ratio(theme, nom, fond, sous);
      if (ratioOpaque(fond)) expect(r, `${nom} sur ${fond} (${theme})`).toBe(attendu);
      else egalA(r, attendu, `${nom} sur ${fond}/${sous} (${theme})`);
      expect(r).toBeGreaterThanOrEqual(3);
    };
    egal("--ink-faint", "--bg-000", null, [5.2, 4.4][k]);
    ["--bg-000", "--bg-100", "--bg-200"].forEach((f, i) => egal("--ink-muted", f, null, [[6.7, 6.5, 6.3], [5.8, 6.2, 6.6]][k][i]));
    egal("--ink-muted", "--bg-300", null, [5.4, 6.6][k]);
    egal("--ink", "--bg-400", null, [7.3, 13.2][k]);
    const minMsg = Math.min(...msg.map((m) => ratio(theme, "--ink-muted", m, "--bg-200")));
    expect(minMsg, `--ink-muted sur --msg-* (${theme})`).toBeGreaterThanOrEqual([4.6, 5.2][k]);
    const minFocus = Math.min(...fonds.slice(0, 5).concat(fonds.slice(5)).map((f) => ratio(theme, "--accent-fg", f)));
    expect(minFocus, `--accent-fg (${theme})`).toBeGreaterThanOrEqual([4.7, 5][k]);
    ["--bg-000", "--bg-100", "--bg-300"].forEach((f, i) => egal("--accent-fg", "--accent-soft", f, [[5.8, 5.7, 4.8], [4.6, 4.9, 5.2]][k][i]));
    ["--bg-000", "--bg-100", "--bg-200", "--bg-300"].forEach((f, i) => egal("--line-strong", f, null, [[3.7, 3.6, 3.4, 3], [3, 3.2, 3.4, 3.4]][k][i]));
  });
});

// AC-042-4, AC-043-2, AC-043-3, AC-043-4, AC-044-7 : contrastes de l'aperçu markdown (design-system.md).
test("REQ042_AC4_REQ043_AC2_contrastes_du_texte_de_l_apercu", () => {
  const fonds = ["--bg-200", "--apercu-fond", "--apercu-entete", "--msg-info"];
  const attendu = {
    "--ink": [[10.2, 8.6, 7.3, 8.1], [16.4, 14.4, 13.2, 13.2]],
    "--info": [[6.6, 5.5, 4.7, 5.2], [6.3, 5.5, 5, 5]],
  };
  THEMES.forEach((theme, k) => {
    for (const [texte, valeurs] of Object.entries(attendu)) {
      fonds.forEach((fond, i) => {
        const r = ratio(theme, texte, fond);
        egalA(r, valeurs[k][i], `${texte} sur ${fond} (${theme})`);
        expect(r, `${texte} sur ${fond} (${theme})`).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});

test("REQ044_AC7_contrastes_des_couleurs_du_code_de_l_apercu", () => {
  const attendu = {
    "--syn-keyword": [5, 6.8], "--syn-control": [5.4, 5.5], "--syn-string": [5.7, 6.9], "--syn-function": [9.8, 6.2],
    "--syn-number": [8.1, 5.3], "--syn-type": [6.8, 4.9], "--syn-variable": [9.3, 9.2], "--syn-comment": [5, 5.5], "--syn-punctuation": [8.6, 14.4],
  };
  THEMES.forEach((theme, k) => {
    for (const [nom, valeurs] of Object.entries(attendu)) {
      const r = ratio(theme, nom, "--apercu-fond");
      expect(r, `${nom} (${theme})`).toBe(valeurs[k]);
      expect(r).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test("REQ042_AC4_REQ043_AC3_contrastes_des_traits_de_l_apercu", () => {
  THEMES.forEach((theme, k) => {
    const ls = ratio(theme, "--line-strong", "--bg-200");
    expect(ls, `bordure de tableau (${theme})`).toBe(3.4);
    const filet = ratio(theme, "--info", "--bg-200");
    expect(filet, `filet sur l'aperçu (${theme})`).toBe([6.6, 6.3][k]);
    const surNote = ratio(theme, "--info", "--msg-info");
    egalA(surNote, [5.2, 5][k], `filet sur la note (${theme})`);
    for (const fond of ["--msg-info", "--apercu-fond", "--apercu-entete"]) {
      expect(ratio(theme, "--accent-fg", fond), `focus sur ${fond} (${theme})`).toBeGreaterThanOrEqual(3);
    }
    for (const r of [ls, filet, surNote]) expect(r).toBeGreaterThanOrEqual(3);
  });
});

// design-proposal.md, REQ-056 : icônes d'état d'un appel d'outil, message dans un dialogue, contour de la liste des réglages.
test("REQ056_contrastes_des_icones_d_etat_du_message_de_dialogue_et_du_contour_des_reglages", () => {
  THEMES.forEach((theme, k) => {
    expect(ratio(theme, "--git-added", "--bg-100"), `réussi (${theme})`).toBe([7.5, 5.7][k]);
    expect(ratio(theme, "--danger", "--bg-100"), `échec (${theme})`).toBe([6.3, 6.2][k]);
    expect(ratio(theme, "--ink-muted", "--bg-100"), `en cours (${theme})`).toBe([6.5, 6.2][k]);
    expect(ratio(theme, "--ink-muted", "--hover"), `en cours au survol (${theme})`).toBeGreaterThanOrEqual(5);
    egalA(ratio(theme, "--ink", "--msg-succes", "--bg-300"), [6.8, 13.4][k], `texte sur le message de réussite (${theme})`);
    expect(ratio(theme, "--line-strong", "--bg-300"), `contour des réglages (${theme})`).toBe([3, 3.4][k]);
  });
});

test("REQ058_AC8_noir_du_navigateur_sur_apercu_page_atteint_4_5", () => {
  for (const theme of ["dark", "light"]) {
    expect(jeton(theme, "--apercu-page")).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(contraste({ r: 0, g: 0, b: 0, a: 1 }, jeton(theme, "--apercu-page")), theme).toBeGreaterThanOrEqual(4.5);
  }
});

test("REQ059_AC5_tokens_de_largeur_de_l_agent", () => {
  const css = readFileSync("web/src/ui/tokens.css", "utf8");
  expect(css).toMatch(/--largeur-agent:\s*360px;/);
  expect(css).toMatch(/--largeur-agent-min:\s*240px;/);
  expect(css).toMatch(/--largeur-agent-max:\s*720px;/);
});

test("REQ059_AC1_contrastes_de_la_commande_du_rail_droit_sur_le_fond_du_rail", () => {
  for (const theme of THEMES) {
    expect(ratio(theme, "--ink-faint", "--bg-000", null), `--ink-faint (${theme})`).toBeGreaterThanOrEqual(3);
    expect(ratio(theme, "--ink", "--bg-000", null), `--ink (${theme})`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, "--accent-fg", "--bg-000", null), `--accent-fg (${theme})`).toBeGreaterThanOrEqual(3);
  }
});

// AC-062-13 : table « Mode hybride » de design-system.md. Couches posées de bas en haut sur --bg-200 ;
// « ligne active » : --ligne-active posé en plus.
test("REQ062_AC13_code_fond_translucide_dans_les_deux_themes", () => {
  for (const theme of THEMES) expect(T[theme]["--code-fond"], theme).toBe("color-mix(in srgb, var(--ink) 6%, transparent)");
  expect(jeton("dark", "--code-fond")).toMatchObject({ r: 204, a: 0.06 });
});

test("REQ062_AC13_paires_du_mode_hybride_atteignent_leur_seuil_avec_et_sans_ligne_active", () => {
  THEMES.forEach((theme) => {
    const fondDe = (couches, active) => {
      let f = jeton(theme, "--bg-200");
      for (const c of couches) f = poser(jeton(theme, c), f);
      return active ? poser(jeton(theme, "--ligne-active"), f) : f;
    };
    const paires = [
      // [texte, couches, seuil, aussi sur ligne active]
      ["--ink", [], 4.5, true],
      ["--ink", ["--code-fond"], 4.5, true],
      ["--ink", ["--msg-info"], 4.5, true],
      ["--ink", ["--msg-info", "--code-fond"], 4.5, false],
      ["--ink", ["--code-fond", "--selection"], 4.5, false],
      ["--ink-muted", [], 4.5, true],
      ["--ink-muted", ["--code-fond"], 4.5, true],
      ["--ink-muted", ["--msg-info"], 4.5, true],
      ["--info", [], 4.5, true],
      ["--info", ["--msg-info"], 4.5, true],
      ["--info", ["--code-fond"], 4.5, false],
      ["--line-strong", [], 3, true],
      ["--info", [], 3, true],
      ["--info", ["--msg-info"], 3, true],
      ...["keyword", "control", "string", "function", "number", "type"].map((n) => [`--syn-${n}`, ["--code-fond"], 4.5, true]),
    ];
    for (const [texte, couches, seuil, active] of paires) {
      for (const sur of active ? [false, true] : [false]) {
        const r = contraste(jeton(theme, texte), fondDe(couches, sur));
        expect(r, `${texte} sur ${couches.join("+") || "--bg-200"}${sur ? " + ligne active" : ""} (${theme})`).toBeGreaterThanOrEqual(seuil);
      }
    }
  });
});

test("REQ065_AC6_on_accent_sur_les_six_couleurs_deux_themes", () => {
  const valeurs = { "--agent-violet": "#7b4fbf", "--agent-vert": "#2e7d32", "--agent-orange": "#b0501c", "--agent-rose": "#c2185b", "--agent-sarcelle": "#00796b", "--agent-gris": "#5f6368" };
  const attendu = { "--agent-violet": 5.6, "--agent-vert": 5.1, "--agent-orange": 5.2, "--agent-rose": 5.8, "--agent-sarcelle": 5.3, "--agent-gris": 6 };
  for (const theme of THEMES) {
    for (const [nom, v] of Object.entries(valeurs)) {
      expect(T[theme][nom], `${nom} (${theme})`).toBe(v);
      const r = contraste(jeton(theme, "--on-accent"), jeton(theme, nom));
      expect(r, `--on-accent sur ${nom} (${theme})`).toBeGreaterThanOrEqual(4.5);
      expect(r, `--on-accent sur ${nom} (${theme})`).toBe(attendu[nom]);
    }
  }
});

test("REQ071_contrastes_du_texte_sur_les_messages_alerte_et_succes_poses_sur_bg_300", () => {
  for (const theme of THEMES) {
    for (const msg of ["--msg-alerte", "--msg-succes"]) expect(ratio(theme, "--ink", msg, "--bg-300"), `${msg} (${theme})`).toBeGreaterThanOrEqual(4.5);
  }
});

test("REQ072_AC21_token_largeur_session", () => {
  expect(css).toMatch(/--largeur-session:\s*1200px;/);
});

// Tableau « Session opencode » de design-system.md : [texte, fond, sous, seuil, [sombre, clair]].
test("REQ072_contrastes_de_la_session_opencode_dans_les_deux_themes", () => {
  const paires = [
    ["--ink", "--msg-alerte", "--bg-200", 4.5, [7.4, 13.4]],
    ["--accent-fg", "--msg-alerte", "--bg-200", 3, [4.8, 5.1]],
    ["--ink-muted", "--bg-200", null, 4.5, [6.3, 6.6]],
    ["--danger", "--bg-200", null, 4.5, [6, 6.6]],
    ["--info", "--bg-200", null, 4.5, [6.6, 6.3]],
    ["--warning", "--bg-200", null, 4.5, [9.5, 6.4]],
    ["--warning", "--bg-100", null, 4.5, [9.9, 6]],
    ["--ink", "--msg-erreur", "--bg-200", 4.5, [8.2, 13]],
    ["--line-strong", "--bg-200", null, 3, [3.4, 3.4]],
  ];
  for (const [texte, fond, sous, seuil, mesures] of paires) {
    THEMES.forEach((theme, i) => {
      const r = ratio(theme, texte, fond, sous);
      const nom = `${texte} sur ${fond} (${theme})`;
      expect(r, nom).toBeGreaterThanOrEqual(seuil);
      egalA(r, mesures[i], nom);
    });
  }
});

// Tableau « Réponses de la conversation » de design-system.md (AC-077-12, AC-077-22) :
// [texte, fond, seuil, [sombre, clair] sur --bg-200, [sombre, clair] sur --bg-100]. `fond` null : le fond de la conversation.
test("REQ077_AC12_AC22_contrastes_des_reponses_sur_bg_200_et_bg_100", () => {
  const paires = [
    ["--ink", null, 4.5, [10.2, 16.4], [10.7, 15.5]],
    ["--ink", "--apercu-entete", 4.5, [7.3, 13.2], [7.3, 13.2]],
    ["--ink", "--apercu-fond", 4.5, [8.6, 14.4], [8.6, 14.4]],
    ["--ink", "--msg-info", 4.5, [8.1, 13.2], [8.4, 12.5]],
    ["--info", null, 4.5, [6.6, 6.3], [6.9, 5.9]],
    ["--info", "--apercu-entete", 4.5, [4.7, 5], [4.7, 5]],
    ["--info", "--apercu-fond", 4.5, [5.5, 5.5], [5.5, 5.5]],
    ["--info", "--msg-info", 4.5, [5.2, 5], [5.5, 4.8]],
    ["--line-strong", null, 3, [3.4, 3.4], [3.6, 3.2]],
    ["--ink-muted", null, 3, [6.3, 6.6], [6.5, 6.2]],
    ["--ink-muted", "--msg-info", 3, [4.9, 5.3], [5.2, 5.1]],
  ];
  THEMES.forEach((theme, i) => {
    ["--bg-200", "--bg-100"].forEach((conv, j) => {
      for (const [texte, fond, seuil, ...mesures] of paires) {
        const r = fond ? ratio(theme, texte, fond, conv) : ratio(theme, texte, conv);
        const nom = `${texte} sur ${fond ?? conv} posé sur ${conv} (${theme})`;
        expect(r, nom).toBeGreaterThanOrEqual(seuil);
        egalA(r, mesures[j][i], nom);
      }
    });
  });
});

// REQ-079 : guides et aperçu de dépôt d'un onglet (design-system.md, « Guides et aperçu de dépôt d'un onglet »).
test("REQ079_contrastes_des_guides_et_de_l_apercu_de_depot_dans_les_deux_themes", () => {
  THEMES.forEach((theme, k) => {
    const exact = (nom, fond, attendu, seuil = 3) => {
      const r = ratio(theme, nom, fond);
      expect(r, `${nom} sur ${fond} (${theme})`).toBe(attendu);
      expect(r).toBeGreaterThanOrEqual(seuil);
    };
    const melange = (nom, sous, attendu, seuil) => {
      const r = ratio(theme, nom, "--accent-soft", sous);
      egalA(r, attendu, `${nom} sur --accent-soft/${sous} (${theme})`);
      expect(r).toBeGreaterThanOrEqual(seuil);
    };
    exact("--accent-fg", "--bg-300", [5.7, 6.3][k]);
    exact("--accent-fg", "--bg-200", [6.6, 6.3][k]);
    exact("--accent-fg", "--bg-000", [7.1, 5.5][k]);
    // Sur la page blanche d'un aperçu HTML, le bleu sombre seul n'atteint pas 3 : le filet intérieur --bg-000 prend le relais.
    expect(ratio(theme, "--accent-fg", "--apercu-page")).toBe([2.4, 6.3][k]);
    if (k === 0) exact("--bg-000", "--apercu-page", 17.7);
    melange("--ink", "--bg-200", [8.3, 13.7][k], 4.5);
    melange("--ink", "--bg-000", [9, 12.1][k], 4.5);
    melange("--ink-muted", "--bg-200", [5.1, 5.5][k], 4.5);
    melange("--ink-muted", "--bg-100", [5.3, 5.2][k], 4.5);
    melange("--accent-fg", "--bg-200", [5.4, 5.2][k], 3);
    melange("--accent-fg", "--bg-000", [5.8, 4.6][k], 3);
  });
});

// REQ-080 : poignée entre les groupes (design-system.md, « Poignée entre les groupes »).
test("REQ080_contrastes_de_la_poignee_entre_les_groupes_dans_les_deux_themes", () => {
  THEMES.forEach((theme, k) => {
    const exact = (nom, fond, attendu) => {
      const r = ratio(theme, nom, fond);
      expect(r, `${nom} sur ${fond} (${theme})`).toBe(attendu);
      expect(r).toBeGreaterThanOrEqual(3);
    };
    exact("--accent-fg", "--bg-200", [6.6, 6.3][k]);
    exact("--accent-fg", "--bg-000", [7.1, 5.5][k]);
    expect(ratio(theme, "--accent-fg", "--apercu-page")).toBe([2.4, 6.3][k]);
    if (k === 0) exact("--bg-000", "--apercu-page", 17.7);
  });
});

// Contrastes du raisonnement (C-015 `raisonnement`, design-system.md) : [texte, fond, [sombre, clair]].
test("REQ084_AC6_contrastes_du_raisonnement_dans_les_deux_themes", () => {
  const paires = [
    ["--ink-muted", "--bg-200", 4.5, [6.3, 6.6]],
    ["--ink-muted", "--hover", 4.5, [5.3, 5.8]],
    ["--accent-fg", "--bg-200", 4.5, [6.6, 6.3]],
    ["--line-strong", "--bg-200", 3, [3.4, 3.4]],
  ];
  for (const [texte, fond, seuil, mesures] of paires) {
    THEMES.forEach((theme, i) => {
      const r = ratio(theme, texte, fond);
      const nom = `${texte} sur ${fond} (${theme})`;
      expect(r, nom).toBeGreaterThanOrEqual(seuil);
      egalA(r, mesures[i], nom);
    });
  }
});

// design-system.md, C-002 `liste` en `barre`, ligne « Worktree » (REQ-086) : contrastes sur --bg-100.
test("REQ086_AC13_contrastes_de_la_ligne_worktree_sur_bg_100", () => {
  const paires = [
    ["--ink-muted", [6.58, 6.29]],
    ["--line-strong", [3.62, 3.25]],
    ["--accent-fg", [6.94, 5.93]],
  ];
  for (const [texte, mesures] of paires) {
    THEMES.forEach((theme, i) => {
      const r = ratio(theme, texte, "--bg-100");
      egalA(r, mesures[i], `${texte} sur --bg-100 (${theme})`);
    });
  }
});
