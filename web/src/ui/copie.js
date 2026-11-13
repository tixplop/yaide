// Copie en texte simple : une sélection dans une vue mise en forme ne met jamais de HTML dans le presse-papiers.
export function copierEnTexteSimple(doc = document) {
  doc.addEventListener("copy", (e) => {
    if (e.defaultPrevented) return;
    const cible = e.target;
    if (cible?.tagName === "INPUT" || cible?.tagName === "TEXTAREA") return;
    const texte = (doc.defaultView ?? window).getSelection().toString();
    if (!texte || !e.clipboardData) return;
    e.clipboardData.setData("text/plain", texte);
    e.preventDefault();
  });
}
