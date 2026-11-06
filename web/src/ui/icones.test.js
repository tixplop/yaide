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
