// Chargement de mermaid à la demande et adresse `data:` d'un dessin (DEC-087).
let promesse = null;

/** Ajoute une fois `<script src="/mermaid.js">` ; un échec remet la promesse à zéro pour réessayer. */
export function chargerMermaid() {
  if (promesse) return promesse;
  promesse = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/mermaid.js";
    s.onload = () => resolve(window.yaideMermaid);
    s.onerror = () => {
      s.remove();
      promesse = null;
      reject(new Error("mermaid.js n'a pas pu être chargé"));
    };
    document.head.append(s);
  });
  return promesse;
}

export function adresseDiagramme(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
