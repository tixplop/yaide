import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { NOMS, icone } from "./icones.js";

const attendues = [
  "files", "search", "git-branch", "log-out", "file-plus", "folder-plus", "plus", "circle-plus", "pencil", "trash-2",
  "eye", "x", "arrow-down-to-line", "arrow-up-from-line", "git-commit-horizontal", "folder", "file", "chevron-right", "chevron-down", "square-terminal", "square-x",
];

test("REQ031_AC1_toutes_les_icones_du_design_system_existent", () => {
  for (const n of attendues) expect(NOMS, n).toContain(n);
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
