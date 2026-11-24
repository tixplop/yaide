import MarkdownIt from "markdown-it";
import { highlightCode } from "@lezer/highlight";
import { couleurs } from "./couleurs-code.js";
import { lienDeDocument, identifiantTitre } from "../references.js";
import { langagePourMot, supportLangage } from "./langages.js";
import { chargerMermaid, adresseDiagramme, dessinerTexte } from "./diagramme.js";

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

// Seules balises HTML rendues (REQ-169) : `<u>` et `</u>` appariées, dans un même paragraphe, deviennent un souligné.
md.core.ruler.before("text_join", "souligne", (etat) => {
  for (const bloc of etat.tokens) {
    if (bloc.type !== "inline") continue;
    const evenements = [];
    bloc.children.forEach((t, i) => {
      if (t.type !== "text") return;
      for (const m of t.content.matchAll(/<(\/?)u>/g)) evenements.push({ i, index: m.index, ferme: !!m[1], pris: false });
    });
    let ouvert = null;
    for (const e of evenements) {
      if (!e.ferme) ouvert = e;
      else if (ouvert) { ouvert.pris = e.pris = true; ouvert = null; }
    }
    if (!evenements.some((e) => e.pris)) continue;
    const enfants = [];
    bloc.children.forEach((t, i) => {
      const ici = evenements.filter((e) => e.i === i && e.pris);
      if (!ici.length) return enfants.push(t);
      let pos = 0;
      const texte = (contenu) => {
        if (!contenu) return;
        const x = new etat.Token("text", "", 0);
        x.content = contenu;
        enfants.push(x);
      };
      for (const e of ici) {
        texte(t.content.slice(pos, e.index));
        enfants.push(new etat.Token(e.ferme ? "u_close" : "u_open", "u", e.ferme ? -1 : 1));
        pos = e.index + (e.ferme ? 4 : 3);
      }
      texte(t.content.slice(pos));
    });
    bloc.children = enfants;
  }
});

// Bloc ```mermaid : `pre` sans langage, marqué de son rang ; l'aperçu le remplace par le dessin (REQ-122).
const fenceDefaut = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, i, options, env, self) => {
  const t = tokens[i];
  if (t.info.trim().split(/\s+/)[0] !== "mermaid") return fenceDefaut(tokens, i, options, env, self);
  env.rang = (env.rang ?? -1) + 1;
  return `<pre data-diagramme="${env.rang}"><code>${md.utils.escapeHtml(t.content)}</code></pre>\n`;
};

// Lien de l'aperçu : fichier (ouvert par la page), web (nouvel onglet) ou ancre (titre du même document).
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  const t = tokens[i];
  const adresse = t.attrGet("href");
  const lien = lienDeDocument(adresse, env?.document);
  if (lien) {
    t.attrSet("data-lien", adresse);
    if (lien.sorte === "fichier") {
      t.attrSet("title", lien.ligne ? `Ouvrir ${lien.ecrit} à la ligne ${lien.ligne} dans l'éditeur.` : `Ouvrir ${lien.ecrit} dans l'éditeur.`);
    } else if (lien.sorte === "web") {
      t.attrSet("target", "_blank");
      t.attrSet("rel", "noopener noreferrer");
      t.attrSet("title", "S'ouvre dans un nouvel onglet du navigateur.");
    }
  }
  return self.renderToken(tokens, i, options);
};

// Le HTML brut est échappé (html: false) et les liens javascript: sont refusés par markdown-it.
// `document` : chemin du fichier affiché, pour résoudre les liens relatifs.
export function rendreMarkdown(texte, { document } = {}) {
  return md.render(String(texte ?? ""), { document });
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

// Aperçu : mêmes cases, actives, avec la ligne source de l'élément (REQ-171).
md.core.ruler.after("inline", "cases", (state) => {
  const tokens = state.tokens;
  const piles = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "bullet_list_open") piles.push("b");
    else if (t.type === "ordered_list_open") piles.push("o");
    else if (t.type === "bullet_list_close" || t.type === "ordered_list_close") piles.pop();
    else if (t.type === "list_item_open" && piles.at(-1) === "b" && tokens[i + 1]?.type === "paragraph_open" && tokens[i + 2]?.type === "inline") {
      const inline = tokens[i + 2];
      const m = retirerMarque(inline, MARQUE_CASE);
      if (!m) continue;
      t.attrJoin("class", "ya-tache");
      const x = new state.Token("html_inline", "", 0);
      x.content = `<input type="checkbox" class="ya-coche" data-ligne="${inline.map[0]}"${m[1] !== " " ? " checked" : ""}>`;
      inline.children.unshift(x);
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

export function apercu({ document: cheminDocument, surLien, surCase } = {}) {
  const el = document.createElement("div");
  el.className = "zone-code-apercu";
  el.setAttribute("aria-label", "Aperçu");
  el.setAttribute("role", "region");
  el.tabIndex = -1; // une zone qui défile ne doit pas être un arrêt de tabulation

  let courant = cheminDocument;

  // Dernier dessin valide par rang : { texte, div, img }. `actuels` : texte courant de chaque bloc.
  const dessins = new Map();
  let actuels = new Map();
  const enCours = new Map();
  const tentes = new Map();
  let minuteur = null;

  const creerDiagramme = (d) => {
    const div = document.createElement("div");
    div.className = "ya-diagramme";
    const img = document.createElement("img");
    img.alt = "Diagramme";
    img.draggable = false;
    img.width = d.largeur;
    img.height = d.hauteur;
    img.src = adresseDiagramme(d.svg);
    div.append(img);
    return { div, img };
  };

  // Remplace chaque `pre` dont un dessin (à jour ou ancien) existe pour son rang.
  const poser = () => {
    for (const pre of el.querySelectorAll("pre[data-diagramme]")) {
      const dessin = dessins.get(Number(pre.dataset.diagramme));
      if (dessin) pre.replaceWith(dessin.div);
    }
  };

  const dessiner = async () => {
    const aFaire = [...actuels].filter(([r, t]) => dessins.get(r)?.texte !== t && enCours.get(r) !== t && tentes.get(r) !== t);
    if (!aFaire.length) return;
    let mermaid;
    try {
      mermaid = await chargerMermaid();
    } catch {
      clearTimeout(minuteur);
      minuteur = setTimeout(dessiner, 1500); // coupure : nouvel essai au rythme de lecture du serveur
      return;
    }
    await Promise.all(aFaire.map(async ([rang, texte]) => {
      enCours.set(rang, texte);
      const d = await dessinerTexte(mermaid, texte);
      enCours.delete(rang);
      if (actuels.get(rang) !== texte) return;
      tentes.set(rang, texte);
      if (!d) return; // illisible : le dernier dessin reste
      const dessin = dessins.get(rang);
      if (!dessin) {
        dessins.set(rang, { texte, ...creerDiagramme(d) });
        return;
      }
      const src = adresseDiagramme(d.svg);
      const neuve = new Image();
      neuve.onload = () => {
        if (actuels.get(rang) !== texte) return;
        dessin.img.width = d.largeur;
        dessin.img.height = d.hauteur;
        dessin.img.src = src;
        dessin.texte = texte;
      };
      neuve.src = src;
    }));
    poser();
  };

  function planifier() {
    clearTimeout(minuteur);
    minuteur = setTimeout(dessiner, 100);
  }

  el.maj = (texte, document = courant) => {
    courant = document;
    el.innerHTML = rendreMarkdown(texte, { document });
    for (const c of el.querySelectorAll("input.ya-coche")) {
      const li = c.closest("li").cloneNode(true);
      li.querySelectorAll("ul, ol").forEach((l) => l.remove());
      c.setAttribute("aria-label", li.textContent.trim());
    }
    actuels = new Map([...el.querySelectorAll("pre[data-diagramme]")].map((p) => [Number(p.dataset.diagramme), p.textContent]));
    for (const r of [...dessins.keys()]) if (!actuels.has(r)) dessins.delete(r);
    poser();
    if (actuels.size) planifier();
  };

  // Clic, Ctrl/Maj+clic, Entrée (clic natif) et clic du milieu.
  const suivre = (e) => {
    const a = e.target.closest?.("a");
    if (!a || !el.contains(a)) return;
    const adresse = a.getAttribute("data-lien");
    const lien = adresse === null ? null : lienDeDocument(adresse, courant);
    if (!lien || lien.sorte === "web") return;
    e.preventDefault();
    if (lien.sorte === "fichier") {
      surLien?.({ adresse, element: a });
      return;
    }
    const titre = [...el.querySelectorAll("h1, h2, h3, h4, h5, h6")].find((h) => identifiantTitre(h.textContent) === lien.ancre);
    if (!titre) return;
    titre.setAttribute("tabindex", "-1");
    titre.scrollIntoView?.({ block: "start" });
    titre.focus();
  };
  el.addEventListener("click", (e) => {
    const c = e.target.closest?.("input.ya-coche");
    if (!c || !el.contains(c)) return suivre(e);
    if (!surCase) return e.preventDefault(); // sans rappel, la case ne se coche pas à l'écran
    const rang = [...el.querySelectorAll("input.ya-coche")].indexOf(c);
    surCase(Number(c.dataset.ligne));
    el.querySelectorAll("input.ya-coche")[rang]?.focus(); // le nouveau rendu a remplacé la case
  });
  el.addEventListener("auxclick", (e) => {
    if (e.button === 1) suivre(e);
  });
  return el;
}
