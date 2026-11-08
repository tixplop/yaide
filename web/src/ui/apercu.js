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

function creerMarkdown(options) {
  const m = new MarkdownIt({ html: false, highlight: colorer, ...options });
  // Une image n'est jamais chargée : son texte de remplacement la remplace.
  m.renderer.rules.image = (tokens, i) => m.utils.escapeHtml(tokens[i].content);
  return m;
}

const md = creerMarkdown({ linkify: false });

// Le HTML brut est échappé (html: false) et les liens javascript: sont refusés par markdown-it.
export function rendreMarkdown(texte) {
  return md.render(String(texte ?? ""));
}

const mdReponse = creerMarkdown({ linkify: true });
// Seules les adresses http:// et https:// deviennent des liens.
mdReponse.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false }).add("ftp:", null).add("mailto:", null).add("//", null);

// Chaque lien d'une réponse s'ouvre dans un nouvel onglet.
mdReponse.renderer.rules.link_open = (tokens, i, options, _env, self) => {
  const t = tokens[i];
  t.attrSet("target", "_blank");
  t.attrSet("rel", "noopener noreferrer");
  t.attrSet("title", "S'ouvre dans un nouvel onglet du navigateur.");
  return self.renderToken(tokens, i, options);
};

const MARQUE_NOTE = /^\[!NOTE\](?:[ \t]+|$)/;
const MARQUE_CASE = /^\[( |x|X)\][ \t]+/;

// Retire la marque du début du premier enfant `text` ; renvoie la correspondance, ou null.
function retirerMarque(inline, motif) {
  const premier = inline.children[0];
  if (premier?.type !== "text") return null;
  const m = motif.exec(premier.content);
  if (!m) return null;
  premier.content = premier.content.slice(m[0].length);
  if (!premier.content) inline.children.shift();
  return m;
}

mdReponse.core.ruler.after("inline", "reponse", (state) => {
  const tokens = state.tokens;
  const piles = [];
  const html = (type, content) => {
    const t = new state.Token(type, "", 0);
    t.content = content;
    return t;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "bullet_list_open") piles.push("b");
    else if (t.type === "ordered_list_open") piles.push("o");
    else if (t.type === "bullet_list_close" || t.type === "ordered_list_close") piles.pop();
    else if (t.type === "blockquote_open" && tokens[i + 1]?.type === "paragraph_open" && tokens[i + 2]?.type === "inline") {
      const inline = tokens[i + 2];
      if (!retirerMarque(inline, MARQUE_NOTE)) continue;
      if (inline.children[0]?.type === "softbreak") inline.children.shift();
      t.attrJoin("class", "ya-note");
      if (!inline.children.length) tokens.splice(i + 1, 3); // paragraphe vide : retiré
      tokens.splice(i + 1, 0, html("html_block", '<p class="ya-note-titre">Note</p>\n'));
    } else if (t.type === "list_item_open" && piles.at(-1) === "b" && tokens[i + 1]?.type === "paragraph_open" && tokens[i + 2]?.type === "inline") {
      const m = retirerMarque(tokens[i + 2], MARQUE_CASE);
      if (!m) continue;
      t.attrJoin("class", "ya-tache");
      const fait = m[1] !== " ";
      tokens[i + 2].children.unshift(html("html_inline", `<input type="checkbox" disabled${fait ? " checked" : ""} aria-label="${fait ? "Fait" : "À faire"}">`));
    }
  }
});

let stylesPoses = false;
function poserCouleurs() {
  if (stylesPoses) return;
  stylesPoses = true;
  const style = document.createElement("style");
  style.textContent = couleurs.module.getRules();
  document.head.append(style);
}

export function rendreReponse(texte) {
  poserCouleurs();
  return mdReponse.render(String(texte ?? ""));
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
