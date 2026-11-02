import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false });
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
