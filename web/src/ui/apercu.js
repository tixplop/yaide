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

// Adresse avec schéma (`http:`, `mailto:`…) ; `main.rs:42` n'en est pas un (le « schéma » est suivi d'un chiffre).
const SCHEMA = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

function decoder(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Lien vers un fichier : adresse sans schéma (hors `#ancre` et `//`), ou `file://`. Renvoie { chemin, ligne } ou null.
function fichierDeLien(href) {
  if (!href || href.startsWith("#") || href.startsWith("//")) return null;
  const file = /^file:/i.test(href);
  if (!file && SCHEMA.test(href)) return null;
  let ecrit = decoder(file ? href.replace(/^file:(\/\/)?/i, "") : href);
  let ligne = null;
  const m = /(?:#L(\d+)(?:-L?\d+)?|:(\d+)(?::\d+)?)$/.exec(ecrit);
  if (m) {
    ligne = Number(m[1] ?? m[2]);
    ecrit = ecrit.slice(0, m.index);
  }
  return ecrit ? { chemin: ecrit, ligne } : null;
}

// markdown-it refuse `file:` : ici c'est une adresse de fichier du projet. javascript:, vbscript: et data: restent refusés.
const validerLien = mdReponse.validateLink;
mdReponse.validateLink = (url) => /^file:/i.test(url.trim()) || validerLien(url);

// Un lien web s'ouvre dans un nouvel onglet ; un lien vers un fichier est ouvert par la page (data-chemin, data-ligne).
mdReponse.renderer.rules.link_open = (tokens, i, options, _env, self) => {
  const t = tokens[i];
  const f = fichierDeLien(t.attrGet("href"));
  if (f) {
    t.attrJoin("class", "ya-fichier");
    t.attrSet("data-chemin", f.chemin);
    if (f.ligne !== null) t.attrSet("data-ligne", String(f.ligne));
    t.attrSet("title", f.ligne !== null ? `Ouvrir ${f.chemin} à la ligne ${f.ligne} dans l'éditeur.` : `Ouvrir ${f.chemin} dans l'éditeur.`);
  } else {
    t.attrSet("target", "_blank");
    t.attrSet("rel", "noopener noreferrer");
    t.attrSet("title", "S'ouvre dans un nouvel onglet du navigateur.");
  }
  return self.renderToken(tokens, i, options);
};

// Chemin avec au moins un `/`, dernier segment `nom.ext` (extension commençant par une lettre), numéro de ligne facultatif.
const SEG = "[\\w.~@%+-]";
const REF = `(\\/?(?:${SEG}+\\/)+[\\w~@%+-]${SEG}*\\.[A-Za-z][\\w-]*)(?::(\\d+)(?::\\d+)?|#L(\\d+)(?:-L?\\d+)?)?(?![\\w/~@%+-]|\\.\\w)`;
const REF_DANS_TEXTE = new RegExp(`(?<![\\w/.~@%+:-])${REF}`, "g");
const REF_SEULE = new RegExp(`^${REF}$`);

function hrefFichier(chemin, ligne) {
  return encodeURI(chemin) + (ligne ? `#L${ligne}` : "");
}

mdReponse.core.ruler.after("text_join", "fichiers", (state) => {
  const lien = (type, chemin, ligne) => {
    const t = new state.Token(type, "a", type === "link_open" ? 1 : -1);
    if (type === "link_open") t.attrs = [["href", hrefFichier(chemin, ligne)]];
    return t;
  };
  for (const bloc of state.tokens) {
    if (bloc.type !== "inline" || !bloc.children) continue;
    const sortie = [];
    let profondeur = 0;
    for (const c of bloc.children) {
      if (c.type === "link_open") profondeur++;
      else if (c.type === "link_close") profondeur--;
      if (profondeur > 0) {
        sortie.push(c);
      } else if (c.type === "text") {
        let fin = 0;
        for (const m of c.content.matchAll(REF_DANS_TEXTE)) {
          if (m.index > fin) {
            const av = new state.Token("text", "", 0);
            av.content = c.content.slice(fin, m.index);
            sortie.push(av);
          }
          const tx = new state.Token("text", "", 0);
          tx.content = m[0];
          sortie.push(lien("link_open", m[1], m[2] ?? m[3]), tx, lien("link_close"));
          fin = m.index + m[0].length;
        }
        if (fin === 0) {
          sortie.push(c);
        } else if (fin < c.content.length) {
          const ap = new state.Token("text", "", 0);
          ap.content = c.content.slice(fin);
          sortie.push(ap);
        }
      } else if (c.type === "code_inline" && REF_SEULE.test(c.content)) {
        const m = REF_SEULE.exec(c.content);
        sortie.push(lien("link_open", m[1], m[2] ?? m[3]), c, lien("link_close"));
      } else {
        sortie.push(c);
      }
    }
    bloc.children = sortie;
  }
});

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
