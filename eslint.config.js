import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["web/dist/"] },
  js.configs.recommended,
  { files: ["web/**/*.js", "e2e/**/*.js"], languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser, ...globals.node } } },
];
