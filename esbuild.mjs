import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";

mkdirSync("web/dist", { recursive: true });
await build({
  entryPoints: ["web/src/main.js"],
  bundle: true,
  minify: true,
  outfile: "web/dist/main.js",
});
copyFileSync("web/index.html", "web/dist/index.html");
