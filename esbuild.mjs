import { build } from "esbuild";
import { mkdirSync, copyFileSync, readdirSync } from "node:fs";

mkdirSync("web/dist", { recursive: true });
await build({
  entryPoints: ["web/src/main.js"],
  bundle: true,
  minify: true,
  outfile: "web/dist/main.js",
});
for (const f of ["tokens.css", "composants.css"]) copyFileSync(`web/src/ui/${f}`, `web/dist/${f}`);
copyFileSync("web/index.html", "web/dist/index.html");
copyFileSync("web/src/theme-initial.js", "web/dist/theme.js");
mkdirSync("web/dist/polices", { recursive: true });
for (const f of readdirSync("web/src/ui/polices")) copyFileSync(`web/src/ui/polices/${f}`, `web/dist/polices/${f}`);
