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

// Table texte → dessin, partagée par l'aperçu et le mode hybride (REQ-152) : un texte n'est dessiné qu'une fois
// par instance de mermaid. `resultat` : `{ svg, largeur, hauteur }`, `null` (illisible) ou `undefined` (pas encore).
const dessins = new Map();

/** Dessin déjà connu de `texte` : `{ svg, largeur, hauteur }`, `null` s'il ne se lit pas, `undefined` s'il n'a pas été fait. */
export function dessinConnu(texte) {
  return dessins.get(texte)?.resultat;
}

/** Dessine `texte` avec `mermaid` (résultat de `chargerMermaid`), au plus une fois par texte. Ne rejette jamais. */
export function dessinerTexte(mermaid, texte) {
  const connu = dessins.get(texte);
  if (connu?.mermaid === mermaid) return connu.promesse;
  const entree = { mermaid, resultat: undefined, promesse: null };
  entree.promesse = Promise.resolve()
    .then(() => mermaid.dessiner(texte))
    .catch(() => null)
    .then((d) => {
      entree.resultat = d ?? null;
      return entree.resultat;
    });
  dessins.set(texte, entree);
  return entree.promesse;
}
