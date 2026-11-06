import { build } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

// N'écrit un fichier que si son contenu change, pour ne pas relancer cargo.
function ecrire(chemin, contenu) {
  const buf = Buffer.from(contenu);
  if (existsSync(chemin) && readFileSync(chemin).equals(buf)) return;
  writeFileSync(chemin, buf);
}
function copier(src, dest) {
  ecrire(dest, readFileSync(src));
}

mkdirSync("web/dist/polices", { recursive: true });
const r = await build({
  entryPoints: ["web/src/main.js"],
  bundle: true,
  minify: true,
  outfile: "web/dist/main.js",
  write: false,
});
for (const f of r.outputFiles) ecrire(f.path, f.contents);
for (const f of ["tokens.css", "composants.css"]) copier(`web/src/ui/${f}`, `web/dist/${f}`);
copier("web/index.html", "web/dist/index.html");
copier("web/src/theme-initial.js", "web/dist/theme.js");
for (const f of readdirSync("web/src/ui/polices")) copier(`web/src/ui/polices/${f}`, `web/dist/polices/${f}`);
