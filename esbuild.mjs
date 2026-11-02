import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";

mkdirSync("web/dist", { recursive: true });
await build({
  entryPoints: ["web/src/main.js"],
  bundle: true,
  minify: true,
  outfile: "web/dist/main.js",
});
for (const f of ["tokens.css", "composants.css"]) copyFileSync(`web/src/ui/${f}`, `web/dist/${f}`);
copyFileSync("web/index.html", "web/dist/index.html");
