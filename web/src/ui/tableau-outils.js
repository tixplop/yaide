import { bouton } from "./bouton.js";

// Rangs, groupes et boutons de la boîte à outils (C-018). `cle` : la valeur de `valeurs` que le groupe règle.
const RANGS = [
  [
    { nom: "Outil", cle: "outil", boutons: [["Choisir", "choisir", "mouse-pointer-2"]] },
    {
      nom: "Forme",
      cle: "outil",
      forme: true,
      boutons: [
        ["Rectangle", "rectangle", "forme-rectangle"],
        ["Rectangle arrondi", "rounded", "forme-arrondi"],
        ["Cercle", "ellipse", "circle"],
        ["Losange", "diamond", "diamond"],
        ["Note", "note", "forme-note"],
        ["Texte", "text", "baseline"],
      ],
    },
    {
      nom: "Relier",
      cle: "outil",
      boutons: [
        ["Lien", "lien", "workflow"],
        ["Flèche", "fleche", "move-up-right"],
      ],
    },
  ],
  [
    {
      nom: "Couleur",
      cle: "couleur",
      bulle: "Couleur",
      boutons: [
        ["Par défaut", "default"],
        ["Bleu", "blue"],
        ["Vert", "green"],
        ["Jaune", "yellow"],
        ["Orange", "orange"],
        ["Rouge", "red"],
        ["Violet", "purple"],
      ],
    },
  ],
  [
    {
      nom: "Tracé",
      cle: "trace",
      bulle: "Tracé",
      boutons: [
        ["Droit", "direct", "trace-droit"],
        ["Coudé", "orthogonal", "trace-coude"],
        ["Courbe", "curved", "trace-courbe"],
      ],
    },
    {
      nom: "Extrémités",
      cle: "bouts",
      bulle: "Extrémités",
      boutons: [
        ["À l'arrivée", "end", "bout-arrivee"],
        ["Aucune", "none", "bout-aucun"],
        ["Au départ", "start", "bout-depart"],
        ["Aux deux bouts", "both", "bout-deux"],
      ],
    },
    {
      nom: "Trait",
      cle: "trait",
      bulle: "Trait",
      boutons: [
        ["Plein", "solid", "trait-plein"],
        ["Tirets", "dashed", "trait-tirets"],
        ["Pointillés", "dotted", "trait-points"],
      ],
    },
  ],
];

const COULEURS_CSS = { default: "defaut", blue: "bleu", green: "vert", yellow: "jaune", orange: "orange", red: "rouge", purple: "violet" };

// Boîte à outils d'un whiteboard : `surChoix(cle, valeur)` à chaque bouton pressé, `surEchap()` sur Échap.
// `definir(valeurs)` montre les valeurs d'un objet choisi ou les choix courants.
export function boiteOutils({ valeurs, surChoix, surEchap }) {
  const etat = { ...valeurs };
  const racine = document.createElement("div");
  racine.className = "ya-tableau-outils";
  racine.setAttribute("role", "toolbar");
  racine.setAttribute("aria-label", "Outils du whiteboard");
  const liste = [];

  for (const groupes of RANGS) {
    const rang = document.createElement("div");
    rang.className = "ya-tableau-outils-rang";
    for (const g of groupes) {
      const el = document.createElement("div");
      el.className = "ya-tableau-outils-groupe";
      el.setAttribute("role", "group");
      el.setAttribute("aria-label", g.nom);
      for (const [nom, valeur, icone] of g.boutons) {
        const b = bouton({ icone: icone ?? "circle", nomAccessible: nom, infoBulle: g.bulle ? `${g.bulle} : ${nom}` : nom, positionInfoBulle: "dessus", presse: false });
        b.dataset.indice = String(liste.length);
        if (!icone) {
          const pastille = document.createElement("span");
          pastille.className = `ya-pastille-couleur ya-pastille-${COULEURS_CSS[valeur]}`;
          pastille.setAttribute("aria-hidden", "true");
          b.querySelector("svg").replaceWith(pastille);
        }
        b.tabIndex = liste.length === 0 ? 0 : -1;
        b.addEventListener("click", () => {
          // Un clic pose le focus (Safari ne le fait pas pour un bouton).
          b.focus();
          etat[g.cle] = valeur;
          if (g.forme) etat.forme = valeur;
          afficher();
          surChoix?.(g.cle, valeur);
        });
        b.addEventListener("focus", () => {
          for (const x of liste) x.b.tabIndex = x.b === b ? 0 : -1;
        });
        liste.push({ b, g, valeur });
        el.append(b.enveloppe);
      }
      rang.append(el);
    }
    racine.append(rang);
  }

  function afficher() {
    for (const { b, g, valeur } of liste) {
      b.setAttribute("aria-pressed", String(etat[g.cle] === valeur));
      if (g.forme) {
        if (etat.forme === valeur) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      }
    }
  }
  afficher();

  // Bouton du rang voisin dont le centre est le plus proche, en largeur.
  function voisinVertical(i, sens) {
    const centre = (b) => {
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top };
    };
    const ici = centre(liste[i].b);
    const rangs = [...new Set(liste.map((x) => centre(x.b).y))].sort((a, b) => a - b);
    const cible = rangs[rangs.indexOf(ici.y) + sens];
    if (cible === undefined) return i;
    let meilleur = i;
    let ecart = Infinity;
    liste.forEach((x, j) => {
      const c = centre(x.b);
      if (c.y === cible && Math.abs(c.x - ici.x) < ecart) {
        ecart = Math.abs(c.x - ici.x);
        meilleur = j;
      }
    });
    return meilleur;
  }

  racine.addEventListener("keydown", (e) => {
    const i = liste.findIndex((x) => x.b === document.activeElement);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    let j = null;
    if (e.key === "ArrowRight") j = Math.min(i + 1, liste.length - 1);
    else if (e.key === "ArrowLeft") j = Math.max(i - 1, 0);
    else if (e.key === "ArrowDown") j = voisinVertical(i, 1);
    else if (e.key === "ArrowUp") j = voisinVertical(i, -1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = liste.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      surEchap?.();
      return;
    } else return;
    e.preventDefault();
    liste[j].b.focus();
  });

  return {
    element: racine,
    definir(v) {
      Object.assign(etat, v);
      afficher();
    },
  };
}
