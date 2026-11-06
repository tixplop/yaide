const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;

// La règle va après un éventuel <!DOCTYPE> pour ne pas changer le mode de rendu.
export function texteSrcdoc(texte) {
  const t = String(texte ?? "");
  const m = t.match(/^\s*<!doctype[^>]*>/i);
  const fin = m ? m[0].length : 0;
  return t.slice(0, fin) + CSP + t.slice(fin);
}

export function apercuHtml() {
  const el = document.createElement("iframe");
  el.className = "zone-code-cadre";
  el.title = "Aperçu";
  el.setAttribute("sandbox", "allow-same-origin");
  let x = 0;
  let y = 0;
  let charge = false; // une page en cours de chargement vaut 0 : on garde alors la dernière position connue

  el.addEventListener("load", () => {
    const fen = el.contentWindow;
    const doc = el.contentDocument;
    if (!fen || !doc) return;
    charge = true;
    fen.scrollTo(x, y);
    const annuler = (e) => {
      if (e.type === "submit" || (e.target.closest && e.target.closest("a[href], area[href]"))) e.preventDefault();
    };
    doc.addEventListener("click", annuler, true);
    doc.addEventListener("submit", annuler, true);
  });

  el.maj = (texte) => {
    if (charge && el.contentWindow) {
      x = el.contentWindow.scrollX;
      y = el.contentWindow.scrollY;
    }
    charge = false;
    el.srcdoc = texteSrcdoc(texte);
  };
  return el;
}
