export function apercuHtml({ adresse }) {
  const el = document.createElement("iframe");
  el.className = "zone-code-cadre";
  el.title = "Aperçu";
  el.setAttribute("sandbox", "allow-scripts allow-forms");
  el.coupe = false;
  let x = 0;
  let y = 0;
  let enAttente = false;

  const surMessage = (e) => {
    if (e.source !== el.contentWindow || e.data?.yaide !== "defilement") return;
    x = Number(e.data.x) || 0;
    y = Number(e.data.y) || 0;
  };
  window.addEventListener("message", surMessage);
  el.addEventListener("load", () => {
    el.contentWindow?.postMessage({ yaide: "defiler", x, y }, "*");
  });

  async function charger() {
    const a = await adresse();
    if (a) el.src = a;
  }
  el.recharger = () => {
    if (el.coupe) {
      enAttente = true;
      return;
    }
    charger();
  };
  el.definirCoupe = (oui) => {
    el.coupe = Boolean(oui);
    if (!el.coupe && enAttente) {
      enAttente = false;
      charger();
    }
  };
  el.maj = () => {}; // la frappe ne touche pas l'aperçu HTML
  el.retirer = () => {
    window.removeEventListener("message", surMessage);
    el.remove();
  };
  charger();
  return el;
}
