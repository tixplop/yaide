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
