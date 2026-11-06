import { StreamLanguage } from "@codemirror/language";
import { rust } from "@codemirror/lang-rust";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";

// Langage d'un bloc clôturé (```rust) : sa coloration, ou null (markdown lui-même ou nom inconnu).
function langageDeBloc(info) {
  const id = langagePourMot(info);
  if (!id || id === "markdown") return null;
  const s = LANGAGES[id].support();
  return s.language ?? s;
}

// identifiant -> { extensions, support() }
const LANGAGES = {
  rust: { extensions: ["rs"], support: () => rust() },
  javascript: { extensions: ["js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts"], support: () => javascript({ jsx: true, typescript: true }) },
  python: { extensions: ["py", "pyw"], support: () => python() },
  go: { extensions: ["go"], support: () => go() },
  cpp: { extensions: ["c", "h", "cc", "cpp", "cxx", "hh", "hpp", "hxx"], support: () => cpp() },
  html: { extensions: ["html", "htm"], support: () => html() },
  css: { extensions: ["css"], support: () => css() },
  json: { extensions: ["json"], support: () => json() },
  yaml: { extensions: ["yaml", "yml"], support: () => yaml() },
  toml: { extensions: ["toml"], support: () => StreamLanguage.define(toml) },
  markdown: { extensions: ["md", "markdown"], support: () => markdown({ base: markdownLanguage, codeLanguages: langageDeBloc }) },
  shell: { extensions: ["sh", "bash", "zsh"], support: () => StreamLanguage.define(shell) },
};

export const IDENTIFIANTS = Object.keys(LANGAGES);

// Identifiant du langage d'après le nom du fichier, ou null (texte simple).
export function langagePourFichier(nom) {
  const point = String(nom ?? "").lastIndexOf(".");
  if (point < 0) return null;
  const ext = nom.slice(point + 1).toLowerCase();
  return IDENTIFIANTS.find((id) => LANGAGES[id].extensions.includes(ext)) ?? null;
}

// Extension CodeMirror du langage ; erreur si l'identifiant est inconnu.
export function supportLangage(id) {
  if (!LANGAGES[id]) throw new Error(`langage inconnu « ${id} »`);
  return LANGAGES[id].support();
}

// Nom affiché par extension, dans la barre d'état : un nom par langage.
const NOMS = {
  Rust: ["rs"],
  JavaScript: ["js", "mjs", "cjs", "jsx"],
  TypeScript: ["ts", "tsx", "mts", "cts"],
  Python: ["py", "pyw"],
  Go: ["go"],
  C: ["c", "h"],
  "C++": ["cc", "cpp", "cxx", "hh", "hpp", "hxx"],
  HTML: ["html", "htm"],
  CSS: ["css"],
  JSON: ["json"],
  YAML: ["yaml", "yml"],
  TOML: ["toml"],
  Markdown: ["md", "markdown"],
  Shell: ["sh", "bash", "zsh"],
};

// Nom du langage d'après le nom du fichier ; « Texte » pour les autres.
export function nomLangage(nom) {
  const point = String(nom ?? "").lastIndexOf(".");
  const ext = point < 0 ? "" : nom.slice(point + 1).toLowerCase();
  return Object.keys(NOMS).find((n) => NOMS[n].includes(ext)) ?? "Texte";
}

// Langage d'un bloc de code : un nom de la barre d'état ou une extension ; null sinon.
export function langagePourMot(mot) {
  const m = String(mot ?? "").toLowerCase();
  const nom = Object.keys(NOMS).find((n) => n.toLowerCase() === m);
  const ext = nom ? NOMS[nom][0] : m;
  return IDENTIFIANTS.find((id) => LANGAGES[id].extensions.includes(ext)) ?? null;
}
