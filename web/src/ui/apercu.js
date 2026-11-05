import MarkdownIt from "markdown-it";
import { highlightCode } from "@lezer/highlight";
import { couleurs } from "./couleurs-code.js";
import { langagePourMot, supportLangage } from "./langages.js";

// Un seul analyseur par langage : l'aperçu se refait à chaque frappe, et `supportLangage` crée un StreamLanguage à chaque appel.
const analyseurs = new Map();
function analyseur(id) {
  if (!analyseurs.has(id)) {
    const s = supportLangage(id);
    analyseurs.set(id, (s.language ?? s).parser); // TOML et shell rendent un StreamLanguage, sans `.language`
  }
  return analyseurs.get(id);
}

// "" : markdown-it échappe le texte lui-même et le laisse sans couleur.
function colorer(code, mot) {
  const id = langagePourMot(mot);
  if (!id) return "";
  let html = "";
  highlightCode(code, analyseur(id).parse(code), couleurs,
    (texte, classes) => {
      const sur = md.utils.escapeHtml(texte);
      html += classes ? `<span class="${classes}">${sur}</span>` : sur;
    },
    () => { html += "\n"; });
  return html;
}

const md = new MarkdownIt({ html: false, linkify: false, highlight: colorer });
// Une image n'est jamais chargée : son texte de remplacement la remplace.
md.renderer.rules.image = (tokens, i) => md.utils.escapeHtml(tokens[i].content);

// Le HTML brut est échappé (html: false) et les liens javascript: sont refusés par markdown-it.
export function rendreMarkdown(texte) {
  return md.render(String(texte ?? ""));
}

export function apercu() {
  const el = document.createElement("div");
  el.className = "zone-code-apercu";
  el.setAttribute("aria-label", "Aperçu");
  el.setAttribute("role", "region");
  el.tabIndex = -1; // une zone qui défile ne doit pas être un arrêt de tabulation

  el.maj = (texte) => {
    el.innerHTML = rendreMarkdown(texte);
  };
  return el;
}
