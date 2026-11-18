import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { NOMS, icone } from "./icones.js";

const attendues = [
  "files", "search", "branch", "terminal", "square-x", "log-out", "sun", "file-plus", "folder-plus", "pencil", "trash", "eye",
  "x", "plus", "check", "arrow-down", "arrow-up", "folder", "file", "file-code", "md", "chevron",
];
const retirees = ["git-branch", "circle-plus", "square-terminal", "trash-2", "arrow-down-to-line", "arrow-up-from-line", "git-commit-horizontal"];

test("REQ031_AC1_toutes_les_icones_du_design_system_existent", () => {
  for (const n of attendues) expect(NOMS, n).toContain(n);
  for (const n of retirees) expect(NOMS, n).not.toContain(n);
});

test("REQ036_AC6_trait_de_1_6_et_dessins_du_design_system", () => {
  for (const n of NOMS) expect(icone(n).getAttribute("stroke-width"), n).toBe("1.6");
  expect(icone("trash").innerHTML).toContain("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3");
  expect(icone("check").innerHTML).toContain("m5 12.5 4.5 4.5L19 7.5");
  // Lucide, avec leur notice : log-out, pencil, square-x.
  expect(icone("pencil").innerHTML).toContain("M21.174 6.812");
});

test("REQ036_AC6_icone_de_14_px_dans_une_action_de_ligne_et_13_px_dans_la_fermeture_d_un_onglet", () => {
  const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
  const regle = (sel) => css.match(new RegExp(`${sel.replace(/[.-]/g, "\\$&")}\\s*\\{([^}]*)\\}`))[1].replace(/\s+/g, " ");
  expect(regle(".ya-icon-btn-ligne svg")).toContain("width: 14px");
  expect(regle(".ya-icon-btn-ligne svg")).toContain("height: 14px");
  expect(regle(".ya-icon-btn-onglet svg")).toContain("width: 13px");
  expect(regle(".ya-icon-btn-onglet svg")).toContain("height: 13px");
  expect(css).not.toContain(".onglet-fermer svg");
});

// Exception à AC-031-2 : « Thème clair » et « Thème clair du whiteboard » gardent toutes deux `sun` (REQ-143, DEC-093) ; le test compare des noms d'icônes, `sun` y figure une fois.
test("REQ031_AC2_deux_commandes_n_ont_jamais_la_meme_icone", () => {
  const formes = NOMS.map((n) => icone(n).innerHTML);
  expect(new Set(formes).size).toBe(NOMS.length);
  for (const f of formes) expect(f.length).toBeGreaterThan(0);
});

test("REQ031_AC4_icone_masquee_aux_lecteurs_d_ecran_et_taille", () => {
  const s = icone("eye", 20);
  expect(s.getAttribute("aria-hidden")).toBe("true");
  expect(s.getAttribute("data-icone")).toBe("eye");
  expect(s.getAttribute("width")).toBe("20");
  expect(s.getAttribute("stroke")).toBe("currentColor");
  expect(s.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(icone("eye").getAttribute("width")).toBe("16");
  expect(s.querySelector("circle, path")).not.toBeNull();
});

test("REQ031_AC3_nom_inconnu_refuse", () => {
  expect(() => icone("inconnue")).toThrow(/inconnu/);
  expect(() => icone("constructor")).toThrow(/inconnu/);
});

test("REQ031_AC3_aucune_reference_reseau_dans_le_module", () => {
  const src = readFileSync("web/src/ui/icones.js", "utf8").replace(/\/\*![\s\S]*?\*\//, "").replace("http://www.w3.org/2000/svg", "");
  expect(src).not.toMatch(/https?:|fetch\(|href=/);
});

test("REQ031_AC3_esbuild_garde_les_notices_ISC_et_MIT_dans_le_bundle", () => {
  const dossier = resolve(process.env.TMPDIR ?? ".test-data", "icones");
  mkdirSync(dossier, { recursive: true });
  writeFileSync(resolve(dossier, "entree.js"), `import { icone } from ${JSON.stringify(resolve("web/src/ui/icones.js"))};\ndocument.body.append(icone("x"));`);
  // esbuild refuse de se charger sous jsdom : on le lance dans un processus Node.
  const script = `import { build } from "esbuild"; await build({ entryPoints: [process.argv[1]], bundle: true, minify: true, outfile: process.argv[2] });`;
  execFileSync("node", ["--input-type=module", "-e", script, resolve(dossier, "entree.js"), resolve(dossier, "sortie.js")]);
  const sortie = readFileSync(resolve(dossier, "sortie.js"), "utf8");
  expect(sortie).toContain("ISC License");
  expect(sortie).toContain("Copyright (c) 2026 Lucide Icons and Contributors");
  expect(sortie).toContain("Permission to use, copy, modify, and/or distribute this software for any");
  expect(sortie).toContain("The MIT License (MIT)");
  expect(sortie).toContain("Copyright (c) 2013-present Cole Bemis");
  expect(sortie).toContain("Permission is hereby granted, free of charge, to any person obtaining a copy");
});

test("REQ040_AC15_icones_minimize_2_et_layers_du_sprite_de_la_maquette", () => {
  expect(NOMS).toContain("minimize-2");
  expect(NOMS).toContain("layers");
  expect(icone("minimize-2").innerHTML).toContain('d="m14 10 7-7"');
  expect(icone("layers").innerHTML).toContain("M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08");
});

test("REQ046_AC16_icones_de_repli_du_sprite_de_la_maquette", () => {
  const dessins = {
    "panel-left-close": 'd="m16 15-3-3 3-3"',
    "panel-left-open": 'd="m14 9 3 3-3 3"',
    "panel-bottom-close": 'd="m15 8-3 3-3-3"',
    "panel-bottom-open": 'd="m9 10 3-3 3 3"',
  };
  for (const [n, d] of Object.entries(dessins)) {
    expect(NOMS, n).toContain(n);
    expect(icone(n).innerHTML, n).toContain(d);
  }
  const entete = readFileSync("web/src/ui/icones.js", "utf8").slice(0, 6000);
  for (const n of Object.keys(dessins)) expect(entete, n).toContain(n);
  // Une icône par commande (AC-031-2).
  const html = Object.keys(dessins).map((n) => icone(n).innerHTML);
  expect(new Set(html).size).toBe(4);
});

test("REQ056_les_huit_icones_de_l_agent_existent_au_trait_lucide", () => {
  for (const n of ["bot", "message-square-plus", "history", "send-horizontal", "circle-stop", "circle-dashed", "circle-check", "circle-x"]) {
    expect(NOMS, n).toContain(n);
    const s = icone(n, 14);
    expect(s.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(s.getAttribute("stroke-width")).toBe("1.6");
    expect(s.getAttribute("aria-hidden")).toBe("true");
    expect(s.getAttribute("width")).toBe("14");
    expect(s.innerHTML.length, n).toBeGreaterThan(20);
  }
  // Deux commandes différentes n'ont jamais la même icône (AC-031-2).
  expect(new Set(NOMS.map((n) => icone(n).innerHTML)).size).toBe(NOMS.length);
});

test("REQ059_AC1_panel_right_close_au_trait_lucide_et_sans_doublon", () => {
  expect(NOMS).toContain("panel-right-close");
  const s = icone("panel-right-close", 16);
  expect(s.getAttribute("stroke-width")).toBe("1.6");
  expect(s.innerHTML).toContain('d="M15 3v18"');
  expect(s.innerHTML).toContain('d="m8 9 3 3-3 3"');
  expect(readFileSync("web/src/ui/icones.js", "utf8").slice(0, 6000)).toContain("panel-right-close");
  expect(new Set(NOMS.map((n) => icone(n).innerHTML)).size).toBe(NOMS.length);
});

test("REQ062_icone_type_au_trait_lucide_et_sans_doublon", () => {
  expect(NOMS).toContain("type");
  const s = icone("type", 16);
  expect(s.getAttribute("stroke-width")).toBe("1.6");
  expect(s.getAttribute("aria-hidden")).toBe("true");
  expect(s.innerHTML).toContain('d="M12 4v16"');
  expect(readFileSync("web/src/ui/icones.js", "utf8").slice(0, 6000)).toContain("type");
  expect(new Set(NOMS.map((n) => icone(n).innerHTML)).size).toBe(NOMS.length);
});

test("REQ064_les_quatre_icones_des_agents_existent_au_trait_lucide", () => {
  for (const n of ["users", "user-plus", "sliders-horizontal", "arrow-left"]) {
    expect(NOMS, n).toContain(n);
    const s = icone(n, 20);
    expect(s.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(s.getAttribute("stroke-width")).toBe("1.6");
    expect(s.getAttribute("aria-hidden")).toBe("true");
    expect(s.innerHTML.length).toBeGreaterThan(20);
  }
});

test("asterisk_unique", () => {
  expect(NOMS).toContain("asterisk");
  const dessin = icone("asterisk").innerHTML;
  expect(dessin).toContain("M12 4v16");
  expect(dessin).toContain("M18.93 8 5.07 16");
  expect(dessin).toContain("m5.07 8 13.86 8");
  expect(NOMS.filter((n) => n !== "asterisk").map((n) => icone(n).innerHTML)).not.toContain(dessin);
});

test("code_xml_et_circle_minus_uniques", () => {
  const attendu = {
    "code-xml": ['m18 16 4-4-4-4', 'm6 8-4 4 4 4', 'm14.5 4-5 16'],
    "circle-minus": ['<circle cx="12" cy="12" r="10"', 'M8 12h8'],
  };
  for (const [nom, morceaux] of Object.entries(attendu)) {
    expect(NOMS).toContain(nom);
    const s = icone(nom, 20);
    expect(s.getAttribute("stroke-width")).toBe("1.6");
    for (const m of morceaux) expect(s.innerHTML).toContain(m);
    expect(NOMS.filter((n) => n !== nom).map((n) => icone(n).innerHTML)).not.toContain(s.innerHTML);
  }
});

test("zones_de_depot_cinq_icones_uniques", () => {
  const zones = ["zone-gauche", "zone-droite", "zone-haut", "zone-bas", "zone-centre"];
  for (const n of zones) {
    expect(NOMS).toContain(n);
    const s = icone(n);
    expect(s.getAttribute("stroke-width")).toBe("1.6");
    expect(s.innerHTML).toContain('width="18"');
    expect(s.innerHTML).toContain('fill="currentColor"');
  }
  expect(new Set(zones.map((n) => icone(n).innerHTML)).size).toBe(5);
});

test("REQ084_icone_brain_au_trait_lucide_et_sans_doublon", () => {
  expect(NOMS).toContain("brain");
  const s = icone("brain", 14);
  expect(s.getAttribute("stroke-width")).toBe("1.6");
  expect(s.innerHTML).toContain('d="M12 18V5"');
  expect(s.innerHTML).toContain('d="M6.003 5.125a4 4 0 0 0-2.526 5.77"');
  expect(readFileSync("web/src/ui/icones.js", "utf8").slice(0, 6000)).toContain("brain");
  expect(new Set(NOMS.map((n) => icone(n).innerHTML)).size).toBe(NOMS.length);
});

test("REQ088_AC12_messages_square_au_trait_lucide_et_distincte_des_autres", () => {
  expect(NOMS).toContain("messages-square");
  const s = icone("messages-square", 20);
  expect(s.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(s.getAttribute("stroke-width")).toBe("1.6");
  expect(s.getAttribute("aria-hidden")).toBe("true");
  expect(s.innerHTML).toContain('d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"');
  expect(s.innerHTML).toContain('d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"');
  expect(readFileSync("web/src/ui/icones.js", "utf8").slice(0, 6000)).toContain("messages-square");
  expect(icone("messages-square").innerHTML).not.toBe(icone("history").innerHTML);
  expect(new Set(NOMS.map((n) => icone(n).innerHTML)).size).toBe(NOMS.length);
});

test("REQ092_AC1_icone_circle_arrow_up_au_trait_lucide", () => {
  expect(NOMS).toContain("circle-arrow-up");
  const s = icone("circle-arrow-up", 13);
  expect(s.getAttribute("stroke-width")).toBe("1.6");
  expect(s.getAttribute("width")).toBe("13");
  expect(s.innerHTML).toContain("m16 12-4-4-4 4");
  expect(readFileSync("web/src/ui/icones.js", "utf8").slice(0, 6000)).toContain("circle-arrow-up");
});

test("REQ096_AC12_icone_server_deux_serveurs_empiles_au_trait_lucide", () => {
  expect(NOMS.filter((n) => n === "server")).toHaveLength(1);
  const s = icone("server");
  expect(s.getAttribute("stroke-width")).toBe("1.6");
  expect(s.querySelectorAll("rect")).toHaveLength(2);
  expect(s.innerHTML).toContain('width="20" height="8" rx="2"');
  expect(s.innerHTML).toContain("M6 6h.01");
  expect(s.innerHTML).toContain("M6 18h.01");
});

test("REQ101_AC11_icone_link_au_trait_des_autres", () => {
  expect(NOMS).toContain("link");
  expect(icone("link", 13).getAttribute("width")).toBe("13");
  expect(icone("link").innerHTML).toContain("M10 13a5 5 0 0 0 7.54.54l3-3");
});

test("REQ103_AC8_icones_book_open_et_list_au_dessin_lucide_distinctes", () => {
  const dessins = {
    "book-open": ["M12 7v14", "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"],
    list: ["M3 6h.01", "M3 12h.01", "M3 18h.01", "M8 6h13", "M8 12h13", "M8 18h13"],
  };
  for (const [n, ds] of Object.entries(dessins)) {
    expect(NOMS, n).toContain(n);
    const s = icone(n, 20);
    expect(s.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(s.getAttribute("stroke-width")).toBe("1.6");
    expect(s.getAttribute("aria-hidden")).toBe("true");
    for (const d of ds) expect(s.innerHTML, n).toContain(d);
  }
});

test("REQ112_icone_book_alert_au_dessin_lucide_distincte_de_book_open", () => {
  expect(NOMS).toContain("book-alert");
  const s = icone("book-alert", 13);
  expect(s.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(s.getAttribute("aria-hidden")).toBe("true");
  for (const d of ["M12 13h.01", "M12 6v3", "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"]) expect(s.innerHTML).toContain(d);
  expect(s.innerHTML).not.toBe(icone("book-open", 13).innerHTML);
});

test("REQ125_icones_copy_et_clipboard_paste", () => {
  for (const n of ["copy", "clipboard-paste"]) {
    expect(NOMS).toContain(n);
    expect(icone(n).getAttribute("aria-hidden")).toBe("true");
    expect(icone(n).getAttribute("stroke-width")).toBe("1.6");
  }
});

test("REQ131_icones_square_plus_zoom_out_zoom_in_et_scan", () => {
  const dessins = {
    "square-plus": ["M8 12h8", "M12 8v8"],
    "zoom-out": ['<circle cx="11" cy="11" r="8"', 'x1="8" x2="14" y1="11" y2="11"'],
    "zoom-in": ['x1="11" x2="11" y1="8" y2="14"', 'x1="8" x2="14" y1="11" y2="11"'],
    scan: ["M3 7V5a2 2 0 0 1 2-2h2", "M7 21H5a2 2 0 0 1-2-2v-2"],
  };
  for (const [n, parties] of Object.entries(dessins)) {
    expect(NOMS).toContain(n);
    const s = icone(n);
    expect(s.getAttribute("aria-hidden")).toBe("true");
    expect(s.getAttribute("stroke-width")).toBe("1.6");
    for (const p of parties) expect(s.innerHTML, n).toContain(p);
  }
  const src = readFileSync("web/src/ui/icones.js", "utf8");
  expect(src).toMatch(/Icônes Lucide \(ISC\) utilisées ici : [^\n]*square-plus, zoom-out, zoom-in, scan, bold, italic, underline, strikethrough\./);
});

test("REQ133_icones_de_la_boite_a_outils_rendues_et_masquees", () => {
  const dessins = {
    "mouse-pointer-2": ["M4.037 4.688"],
    circle: ['<circle cx="12" cy="12" r="8.5"'],
    diamond: ["M12 3 21 12 12 21 3 12z"],
    baseline: ["M4 20h16", "m6 16 6-12 6 12", "M8 12h8"],
    workflow: ['<rect width="8" height="8" x="3" y="3" rx="2"', "M7 11v4a2 2 0 0 0 2 2h4"],
    "move-up-right": ["M13 5h6v6", "M19 5 5 19"],
    "forme-rectangle": ['<rect x="3" y="6" width="18" height="12" rx="1"'],
    "forme-arrondi": ['<rect x="3" y="6" width="18" height="12" rx="5"'],
    "forme-note": ["M3 5h12l6 6v8H3z", "M15 5v6h6"],
    "trace-droit": ["M6.5 17.5 17.5 6.5", '<circle cx="5" cy="19" r="1.6"', '<circle cx="19" cy="5" r="1.6"'],
    "trace-coude": ["M6.6 19H12V5h5.4", '<circle cx="19" cy="5" r="1.6"'],
    "trace-courbe": ["M6.6 19C14 19 10 5 17.4 5", '<circle cx="5" cy="19" r="1.6"'],
    "bout-arrivee": ["M4 12h15", "m14 7 5 5-5 5"],
    "bout-aucun": ["M6.6 12h10.8", '<circle cx="5" cy="12" r="1.6"', '<circle cx="19" cy="12" r="1.6"'],
    "bout-depart": ["M5 12h15", "m10 7-5 5 5 5"],
    "bout-deux": ["M4 12h16", "m8 8-4 4 4 4", "m16 8 4 4-4 4"],
    "trait-plein": ['d="M3 12h18"', 'stroke-width="2"'],
    "trait-tirets": ["M3 12h4M10 12h4M17 12h4", 'stroke-linecap="butt"'],
    "trait-points": ["M4 12h.01M8 12h.01M12 12h.01M16 12h.01M20 12h.01", 'stroke-width="2.6"'],
  };
  expect(Object.keys(dessins)).toHaveLength(19);
  for (const [n, parties] of Object.entries(dessins)) {
    expect(NOMS).toContain(n);
    const s = icone(n);
    expect(s.getAttribute("aria-hidden"), n).toBe("true");
    expect(s.getAttribute("stroke-width"), n).toBe("1.6");
    for (const p of parties) expect(s.innerHTML, n).toContain(p);
  }
  const src = readFileSync("web/src/ui/icones.js", "utf8");
  expect(src).toMatch(/Icônes Lucide \(ISC\) utilisées ici : [^\n]*mouse-pointer-2, circle, diamond, baseline, workflow, move-up-right, square-plus/);
});

test("REQ133_REQ138_REQ140_REQ141_quinze_icones_de_la_boite_a_outils_rendues_et_masquees", () => {
  const nouvelles = [
    "square-dashed", "bring-to-front", "send-to-back", "opacite-100", "opacite-75", "opacite-50", "opacite-25", "opacite-0",
    "taille-petit", "taille-normal", "taille-grand", "taille-tres-grand", "epaisseur-fin", "epaisseur-moyen", "epaisseur-epais",
  ];
  expect(nouvelles).toHaveLength(15);
  for (const n of nouvelles) {
    expect(NOMS, n).toContain(n);
    const s = icone(n);
    expect(s.getAttribute("aria-hidden"), n).toBe("true");
    expect(s.getAttribute("data-icone"), n).toBe(n);
    expect(s.querySelector("path, rect"), n).not.toBeNull();
  }
  const tete = readFileSync("web/src/ui/icones.js", "utf8").split("*/")[0];
  for (const n of nouvelles) expect(tete, n).toContain(n);
});

test("REQ146_AC10_AC031_2_icones_du_style_du_texte_distinctes_de_baseline_et_taille_normal", () => {
  const dessins = {
    bold: ["M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"],
    italic: ["M19 4h-9", "M14 20H5", "M15 4 9 20"],
    underline: ["M6 4v6a6 6 0 0 0 12 0V4", "M4 20h16"],
    strikethrough: ["M16 4H9a3 3 0 0 0-2.83 4", "M14 12a4 4 0 0 1 0 8H6", "M4 12h16"],
    "couleur-texte": ["m7 15 5-11 5 11", "M8.8 11h6.4", '<rect class="ya-barre-texte" x="4" y="18" width="16" height="3.5" rx="1" stroke="none"'],
  };
  for (const [n, parties] of Object.entries(dessins)) {
    expect(NOMS).toContain(n);
    for (const p of parties) expect(icone(n).innerHTML, n).toContain(p);
  }
  const formes = [...Object.keys(dessins), "baseline", "taille-normal"].map((n) => icone(n).innerHTML);
  expect(new Set(formes).size).toBe(7);
  const tete = readFileSync("web/src/ui/icones.js", "utf8").split("*/")[0];
  for (const n of Object.keys(dessins)) expect(tete, n).toContain(n);
});
