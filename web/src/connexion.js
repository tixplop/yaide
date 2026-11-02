const INTERVALLE = 1500;
const DELAI = 2000;

/**
 * Interroge /api/session (DEC-019) et publie l'état : "connecte", "coupe" ou "expiree".
 * `surEtat` est appelé au premier résultat puis à chaque changement. Renvoie la fonction d'arrêt.
 */
export function surveiller({ surEtat }) {
  let actif = true;
  let etat = null;
  let minuterie;

  async function sonder() {
    let nouveau = "coupe";
    const controle = new AbortController();
    const abandon = setTimeout(() => controle.abort(), DELAI);
    try {
      const r = await fetch("/api/session", { credentials: "same-origin", signal: controle.signal });
      if (r.status === 204) nouveau = "connecte";
      else if (r.status === 401) nouveau = "expiree";
    } catch {
      // Pas de réponse : coupure.
    }
    clearTimeout(abandon);
    if (!actif) return;
    if (nouveau !== etat) {
      etat = nouveau;
      surEtat(etat);
    }
    if (etat !== "expiree") minuterie = setTimeout(sonder, INTERVALLE);
  }

  sonder();
  return () => {
    actif = false;
    clearTimeout(minuterie);
  };
}
