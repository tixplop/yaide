// Dessin SVG de mermaid → primitives mesurées dans le navigateur (REQ-154, DEC-107). Les primitives sont celles de `mermaid-dessin.js`.

const IGNORES = new Set(["defs", "marker", "style", "title", "desc", "metadata", "clippath", "mask", "pattern", "symbol", "script"]);

const nombre = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const appliquer = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
const echelle = (m) => [Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)];
const coin = (m, x, y, l, h) => {
  const pts = [appliquer(m, x, y), appliquer(m, x + l, y), appliquer(m, x, y + h), appliquer(m, x + l, y + h)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), largeur: Math.max(...xs) - Math.min(...xs), hauteur: Math.max(...ys) - Math.min(...ys) };
};

function style(el) {
  const s = getComputedStyle(el);
  const couleur = (v) => (!v || v === "none" || v.startsWith("url(") ? null : v);
  return {
    fond: couleur(s.fill),
    opaciteFond: nombre(s.fillOpacity || "1") * nombre(s.opacity || "1"),
    contour: couleur(s.stroke),
    tirets: !!s.strokeDasharray && s.strokeDasharray !== "none" && /[1-9]/.test(s.strokeDasharray),
    epaisseur: nombre(s.strokeWidth),
    debut: !!s.markerStart && s.markerStart !== "none",
    fin: !!s.markerEnd && s.markerEnd !== "none",
  };
}

function points(el) {
  return (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number).reduce((acc, v, i, t) => (i % 2 ? acc : [...acc, [v, t[i + 1]]]), []);
}

/** `svg` (texte) → `{ primitives, origine }`. Le dessin est posé hors écran le temps de la mesure. */
export function mesurer(svg) {
  const conteneur = document.createElement("div");
  conteneur.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:2000px";
  conteneur.innerHTML = svg;
  document.body.appendChild(conteneur);
  try {
    const racine = conteneur.querySelector("svg");
    if (!racine) return { primitives: [], origine: [0, 0] };
    // `visibility` s'hérite : sans ceci, tout le dessin serait « caché » par son conteneur.
    racine.style.visibility = "visible";
    const inverse = racine.getScreenCTM().inverse();
    const primitives = [];
    const parcourir = (el) => {
      for (const e of el.children) {
        const nom = e.localName.toLowerCase();
        if (IGNORES.has(nom)) continue;
        const s = getComputedStyle(e);
        if (s.display === "none") continue;
        const visible = s.visibility !== "hidden" && s.visibility !== "collapse";
        const ctm = e.getScreenCTM?.();
        if (nom === "g" || nom === "svg" || nom === "a" || nom === "switch") {
          parcourir(e);
          continue;
        }
        if (!ctm || !visible) continue;
        const m = inverse.multiply(ctm);
        const base = style(e);
        const [ex, ey] = echelle(m);
        if (nom === "rect") {
          const [x, y, l, h] = ["x", "y", "width", "height"].map((a) => nombre(e.getAttribute(a)));
          const rx = nombre(e.getAttribute("rx") || e.getAttribute("ry"));
          if (!(l > 0 && h > 0)) continue; // un rectangle sans surface ne se dessine pas
          primitives.push({ type: "rect", ...coin(m, x, y, l, h), arrondi: rx * Math.min(ex, ey), ...base });
        } else if (nom === "circle" || nom === "ellipse") {
          const r = nom === "circle" ? [nombre(e.getAttribute("r")), nombre(e.getAttribute("r"))] : [nombre(e.getAttribute("rx")), nombre(e.getAttribute("ry"))];
          const [cx, cy] = appliquer(m, nombre(e.getAttribute("cx")), nombre(e.getAttribute("cy")));
          primitives.push({ type: "ellipse", cx, cy, rx: r[0] * ex, ry: r[1] * ey, ...base });
        } else if (nom === "polygon") {
          primitives.push({ type: "polygone", points: points(e).map(([x, y]) => appliquer(m, x, y)), ...base });
        } else if (nom === "polyline") {
          primitives.push({ type: "ligne", points: points(e).map(([x, y]) => appliquer(m, x, y)), ...base });
        } else if (nom === "line") {
          const [a, b, c, d] = ["x1", "y1", "x2", "y2"].map((k) => nombre(e.getAttribute(k)));
          primitives.push({ type: "ligne", points: [appliquer(m, a, b), appliquer(m, c, d)], ...base });
        } else if (nom === "path") {
          primitives.push({ type: "chemin", d: e.getAttribute("d") ?? "", matrice: [m.a, m.b, m.c, m.d, m.e, m.f], ...base });
        } else if (nom === "text" || nom === "foreignobject") {
          const texte = e.textContent ?? "";
          if (texte.trim() === "") continue;
          const b = e.getBBox();
          const tspans = [...e.querySelectorAll("tspan")].filter((t) => t.parentNode === e);
          const lignes = nom === "text" && tspans.length > 0 ? tspans.map((t) => t.textContent) : texte.split("\n");
          primitives.push({ type: "texte", ...coin(m, b.x, b.y, b.width, b.height), lignes, ...base });
        }
      }
    };
    parcourir(racine);
    const vue = racine.viewBox.baseVal;
    return { primitives, origine: [vue?.x ?? 0, vue?.y ?? 0] };
  } finally {
    conteneur.remove();
  }
}
