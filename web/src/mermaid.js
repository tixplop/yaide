import mermaid from "mermaid";
import { mesurer } from "./mermaid-mesure.js";
import { versWhiteboard } from "./mermaid-dessin.js";

// Chargé à part, au premier diagramme (DEC-086, DEC-087).
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "default",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  fontFamily: "system-ui, sans-serif",
});

let rang = 0;

/** Dessine `texte` : `{ svg, largeur, hauteur }`, ou `null` si mermaid ne le lit pas. */
async function dessiner(texte) {
  const id = `yaide-mermaid-${++rang}`;
  try {
    const { svg } = await mermaid.render(id, texte);
    const vue = /<svg\b[^>]*?\bviewBox="([^"]+)"/.exec(svg);
    if (!vue) return null;
    const [, , l, h] = vue[1].trim().split(/[\s,]+/).map(Number);
    if (!(l > 0 && h > 0)) return null;
    const largeur = Math.ceil(l);
    const hauteur = Math.ceil(h);
    const fin = svg.indexOf(">", svg.indexOf("<svg"));
    const balise = svg
      .slice(0, fin)
      .replace(/\s(?:width|height)="[^"]*"/g, "")
      .replace(/\sstyle="[^"]*"/, "")
      // `click` produit des `xlink:href` sans leur espace de noms : sans lui, l'image ne se charge pas.
      .replace("<svg", `<svg width="${largeur}" height="${hauteur}"${svg.includes("xlink:") && !/xmlns:xlink=/.test(svg) ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ""}`);
    return { svg: balise + svg.slice(fin), largeur, hauteur };
  } catch {
    return null;
  } finally {
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/** SVG de mermaid → `{ doc }` (boîtes et flèches libres) ou `{ refus }`. */
function traduireSvg(svg) {
  const { primitives, origine } = mesurer(svg);
  const r = versWhiteboard(primitives, origine);
  if (r.refus) return r;
  return { doc: { version: 1, boxes: r.boxes, links: [], arrows: r.arrows } };
}

/** Texte mermaid → `{ doc }` ou `{ refus }`. */
async function traduire(texte) {
  const d = await dessiner(texte);
  return d ? traduireSvg(d.svg) : { refus: "mermaid ne sait pas le lire." };
}

window.yaideMermaid = { dessiner, traduire, traduireSvg };
