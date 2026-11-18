// Texte d'une boîte ou d'un lien avec les styles d'une partie du texte (REQ-146).
import { normaliserSpans } from "../jdiag.js";

const COULEURS = { blue: "bleu", green: "vert", yellow: "jaune", orange: "orange", red: "rouge", purple: "violet" };

function partie(p, texte) {
  const s = document.createElement("span");
  if (p.bold) s.style.fontWeight = "700";
  if (p.italic) s.style.fontStyle = "italic";
  const deco = [p.underline && "underline", p.strike && "line-through"].filter(Boolean).join(" ");
  if (deco) s.style.textDecoration = deco;
  if (p.color && COULEURS[p.color]) s.style.color = `var(--boite-${COULEURS[p.color]}-trait)`;
  s.textContent = texte;
  return s;
}

// Remplit `conteneur` du texte `text`, découpé aux positions en caractères Unicode de `spans`.
export function rendreTexte(conteneur, text, spans = []) {
  conteneur.replaceChildren();
  const signes = Array.from(text ?? "");
  let pos = 0;
  const jusqua = (fin) => {
    if (fin > pos) conteneur.append(document.createTextNode(signes.slice(pos, fin).join("")));
    pos = Math.max(pos, fin);
  };
  for (const p of spans ?? []) {
    jusqua(p.start);
    conteneur.append(partie(p, signes.slice(p.start, p.end).join("")));
    pos = p.end;
  }
  jusqua(signes.length);
}

// Remplit la zone du texte d'une boîte : un seul bloc `div`, pour que les parties restent sur leurs lignes dans la zone flex.
export function rendreZone(zone, text, spans = []) {
  const bloc = document.createElement("div");
  rendreTexte(bloc, text, spans);
  zone.replaceChildren(bloc);
}

const STYLES = ["bold", "italic", "underline", "strike"];
const VAR_COULEUR = Object.fromEntries(Object.entries(COULEURS).map(([en, fr]) => [`var(--boite-${fr}-trait)`, en]));
const compter = (texte) => Array.from(texte).length;

// Styles d'un nœud du DOM de la saisie, hérités de ses ancêtres jusqu'à `conteneur`.
function stylesDe(noeud, conteneur) {
  const r = {};
  for (let e = noeud.parentNode; e && e !== conteneur; e = e.parentNode) {
    const st = e.style;
    if (!st) continue;
    if (r.bold === undefined && st.fontWeight) r.bold = st.fontWeight === "bold" || Number(st.fontWeight) >= 600;
    if (r.italic === undefined && st.fontStyle) r.italic = st.fontStyle === "italic";
    const deco = st.textDecoration || st.textDecorationLine || "";
    if (deco) {
      r.underline ||= deco.includes("underline");
      r.strike ||= deco.includes("line-through");
    }
    if (r.color === undefined && st.color) r.color = VAR_COULEUR[st.color.replace(/\s+/g, "")] ?? "default";
  }
  return r;
}

// Parcourt les feuilles de `conteneur` dans l'ordre : `f(noeud, texte)` pour un texte, `f(noeud, "\n")` pour un `br`.
function feuilles(conteneur, f) {
  const visiter = (el) => {
    for (const c of el.childNodes) {
      if (c.nodeType === 3) f(c, c.data);
      else if (c.nodeName === "BR") f(c, "\n");
      else if (c.nodeType === 1) visiter(c);
    }
  };
  visiter(conteneur);
}

// Le DOM de la saisie → `{ text, spans }`.
export function lireTexte(conteneur) {
  let text = "";
  let pos = 0;
  const brut = [];
  feuilles(conteneur, (noeud, t) => {
    const n = compter(t);
    const st = noeud.nodeType === 3 ? stylesDe(noeud, conteneur) : {};
    const p = { start: pos, end: pos + n };
    for (const cle of STYLES) if (st[cle]) p[cle] = true;
    if (st.color && st.color !== "default") p.color = st.color;
    if (n > 0 && Object.keys(p).length > 2) brut.push(p);
    text += t;
    pos += n;
  });
  return { text, spans: normaliserSpans(text, brut) ?? [] };
}

// Position en caractères d'un point (`noeud`, `decalage`) du DOM de la saisie.
function position(conteneur, noeud, decalage) {
  let n = 0;
  let trouve = false;
  const visiter = (el) => {
    const enfants = [...el.childNodes];
    for (let i = 0; i <= enfants.length; i++) {
      if (el === noeud && i === decalage) {
        trouve = true;
        return;
      }
      const c = enfants[i];
      if (!c) return;
      if (c.nodeType === 3) {
        if (c === noeud) {
          n += compter(c.data.slice(0, decalage));
          trouve = true;
          return;
        }
        n += compter(c.data);
      } else if (c.nodeName === "BR") n += 1;
      else if (c.nodeType === 1) {
        visiter(c);
        if (trouve) return;
      }
    }
  };
  visiter(conteneur);
  return n;
}

// La sélection (ou un `Range`) → `{ debut, fin }` en caractères ; `null` si elle n'est pas dans `conteneur`.
export function decalages(conteneur, selection) {
  const r = selection?.rangeCount === undefined ? selection : selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!r || !conteneur.contains(r.startContainer) || !conteneur.contains(r.endContainer)) return null;
  const a = position(conteneur, r.startContainer, r.startOffset);
  const b = position(conteneur, r.endContainer, r.endOffset);
  return { debut: Math.min(a, b), fin: Math.max(a, b) };
}

// Le point du DOM de la saisie à la position `pos` : en fin d'une partie plutôt qu'au début de la suivante.
export function pointA(conteneur, pos) {
  let n = 0;
  let r = null;
  feuilles(conteneur, (noeud, t) => {
    if (r) return;
    const l = compter(t);
    if (pos <= n + l) {
      if (noeud.nodeType === 3) r = [noeud, Array.from(t).slice(0, pos - n).join("").length];
      else {
        const i = [...noeud.parentNode.childNodes].indexOf(noeud);
        r = [noeud.parentNode, pos - n === 0 ? i : i + 1];
      }
    }
    n += l;
  });
  const bloc = conteneur.lastElementChild;
  if (!r && bloc?.nodeName === "DIV") return [bloc, bloc.childNodes.length];
  return r ?? [conteneur, conteneur.childNodes.length];
}

// Un style par caractère, à partir de `spans`.
function parCaractere(text, spans) {
  const sorte = Array.from({ length: compter(text) }, () => ({}));
  for (const p of spans ?? []) for (let i = p.start; i < p.end && i < sorte.length; i++) sorte[i] = { ...p, start: undefined, end: undefined };
  return sorte;
}

// Un style par caractère → `spans` normalisés.
function depuisCaracteres(text, chars) {
  const brut = [];
  chars.forEach((c, i) => {
    const style = {};
    for (const cle of STYLES) if (c[cle]) style[cle] = true;
    if (c.color && c.color !== "default") style.color = c.color;
    if (Object.keys(style).length === 0) return;
    brut.push({ start: i, end: i + 1, ...style });
  });
  return normaliserSpans(text, brut) ?? [];
}

const borner = (text, debut, fin) => [Math.max(0, debut), Math.min(compter(text), fin)];

// Donne `style` (`valeur` vrai) ou l'ôte (faux) aux caractères [debut, fin) ; sans `valeur` : l'ôte si tous l'ont, sinon le donne.
export function basculer(text, spans, debut, fin, style, valeur) {
  const [d, f] = borner(text, debut, fin);
  if (f <= d) return spans;
  const chars = parCaractere(text, spans);
  const cible = valeur ?? !chars.slice(d, f).every((c) => c[style]);
  for (let i = d; i < f; i++) chars[i] = { ...chars[i], [style]: cible };
  return depuisCaracteres(text, chars);
}

// Donne `couleur` aux caractères [debut, fin) (« default » : la couleur de la boîte).
export function colorer(text, spans, debut, fin, couleur) {
  const [d, f] = borner(text, debut, fin);
  if (f <= d) return spans;
  const chars = parCaractere(text, spans);
  for (let i = d; i < f; i++) chars[i] = { ...chars[i], color: couleur };
  return depuisCaracteres(text, chars);
}

// Styles que tous les caractères de [debut, fin) ont, et leur couleur commune (« default » ou `null` si elles diffèrent).
// Plage vide : aucun style, « default ».
export function etatTexte(text, spans, debut, fin) {
  const [d, f] = borner(text, debut, fin);
  if (f <= d) return { styles: [], couleur: "default" };
  const chars = parCaractere(text, spans).slice(d, f);
  const couleur = chars[0].color ?? "default";
  return {
    styles: STYLES.filter((s) => chars.every((c) => c[s])),
    couleur: chars.every((c) => (c.color ?? "default") === couleur) ? couleur : null,
  };
}

// Remplace [debut, fin) par `ajout` ; le texte inséré prend les styles du caractère juste avant, sinon du caractère juste après.
export function inserer(text, spans, debut, fin, ajout) {
  const chars = parCaractere(text, spans);
  const style = chars[debut - 1] ?? chars[fin] ?? {};
  const neuf = Array.from(ajout).map(() => ({ ...style }));
  chars.splice(debut, Math.max(0, fin - debut), ...neuf);
  const signes = Array.from(text);
  signes.splice(debut, Math.max(0, fin - debut), ...Array.from(ajout));
  const t = signes.join("");
  return { text: t, spans: depuisCaracteres(t, chars) };
}
