import { bouton } from "./bouton.js";
import { estMac } from "../references.js";
import { dialogueChoix } from "./dialogue.js";
import { FORMES_PLEINES, SYMBOLES } from "../jdiag.js";
import { estFormePleine, estSymbole } from "./tableau-calculs.js";

// Rangs, groupes et boutons de la boîte à outils (C-018). `cle` : la valeur de `valeurs` que le groupe règle.
const RANGS = [
  [
    { nom: "Outil", cle: "outil", boutons: [
        ["Choisir", "choisir", "mouse-pointer-2"],
        ["Sélection", "selection", "square-dashed"],
      ],
    },
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
        ["Symboles", "symboles", "shapes"],
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
      nom: "Opacité",
      cle: "opacite",
      bulle: "Opacité",
      boutons: [
        ["100 %", 100, "opacite-100"],
        ["75 %", 75, "opacite-75"],
        ["50 %", 50, "opacite-50"],
        ["25 %", 25, "opacite-25"],
        ["0 %", 0, "opacite-0"],
      ],
    },
    {
      nom: "Taille du texte",
      cle: "taille",
      bulle: "Taille du texte",
      boutons: [
        ["Petit", "small", "taille-petit"],
        ["Normal", "normal", "taille-normal"],
        ["Grand", "large", "taille-grand"],
        ["Très grand", "xlarge", "taille-tres-grand"],
      ],
    },
  ],
  [
    {
      nom: "Style du texte",
      cle: "style",
      texte: true,
      boutons: [
        ["Gras", "bold", "bold", "Ctrl+B"],
        ["Italique", "italic", "italic", "Ctrl+I"],
        ["Souligné", "underline", "underline", "Ctrl+U"],
        ["Barré", "strike", "strikethrough"],
      ],
    },
    {
      nom: "Couleur du texte",
      cle: "couleurTexte",
      texte: true,
      bulle: "Couleur du texte",
      boutons: [
        ["Texte par défaut", "default", "couleur-texte", null, "Par défaut"],
        ["Texte bleu", "blue", "couleur-texte", null, "Bleu"],
        ["Texte vert", "green", "couleur-texte", null, "Vert"],
        ["Texte jaune", "yellow", "couleur-texte", null, "Jaune"],
        ["Texte orange", "orange", "couleur-texte", null, "Orange"],
        ["Texte rouge", "red", "couleur-texte", null, "Rouge"],
        ["Texte violet", "purple", "couleur-texte", null, "Violet"],
      ],
    },
  ],
  [
    {
      nom: "Alignement du texte",
      cle: "align",
      position: true,
      bulle: "Alignement du texte",
      boutons: [
        ["À gauche", "left", "text-align-start"],
        ["Au centre", "center", "text-align-center"],
        ["À droite", "right", "text-align-end"],
      ],
    },
    {
      nom: "Position verticale du texte",
      cle: "valign",
      position: true,
      bulle: "Position verticale du texte",
      boutons: [
        ["En haut", "top", "position-haut"],
        ["Au milieu", "middle", "position-milieu"],
        ["En bas", "bottom", "position-bas"],
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
  ],
  [
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
    {
      nom: "Épaisseur",
      cle: "epaisseur",
      bulle: "Épaisseur",
      boutons: [
        ["Fin", "thin", "epaisseur-fin"],
        ["Moyen", "medium", "epaisseur-moyen"],
        ["Épais", "thick", "epaisseur-epais"],
      ],
    },
    {
      nom: "Plan",
      action: true,
      boutons: [
        ["Premier plan", "premier", "bring-to-front"],
        ["Arrière-plan", "arriere", "send-to-back"],
      ],
    },
  ],
];

const COULEURS_CSS = { default: "defaut", blue: "bleu", green: "vert", yellow: "jaune", orange: "orange", red: "rouge", purple: "violet" };

// Boîte à outils d'un whiteboard : `surChoix(cle, valeur)` à chaque bouton pressé, `surAction("premier" | "arriere")`
// pour « Plan », `surTexte("bold" | "italic" | "underline" | "strike")` ou `surTexte("color", couleur)` pour le style
// et la couleur du texte, `surEchap()` sur Échap. `definir(valeurs, { planActif, texte })` montre les valeurs d'un objet
// choisi ou les choix courants, active ou non « Plan », et donne l'état du texte visé :
// `texte = { actif, styles: ["bold", …], couleur: "red" | null }` (inactif : les onze boutons du texte sont inactifs).
// `surPosition("align" | "valign", valeur)` pour le rang 5 ; `position = { actif, align, valign }` (valeur commune ou `null`).
export function boiteOutils({ valeurs, surChoix, surAction, surTexte, surPosition, surEchap }) {
  const etat = { ...valeurs };
  const racine = document.createElement("div");
  racine.className = "ya-tableau-outils";
  racine.setAttribute("role", "toolbar");
  racine.setAttribute("aria-label", "Outils du whiteboard");
  const liste = [];
  let planActif = false;
  let texte = { actif: false, styles: [], couleur: null };
  let position = { actif: false, align: null, valign: null };
  const ctrl = estMac() ? "Cmd" : "Ctrl";

  for (const groupes of RANGS) {
    const rang = document.createElement("div");
    rang.className = "ya-tableau-outils-rang";
    for (const g of groupes) {
      const el = document.createElement("div");
      el.className = "ya-tableau-outils-groupe";
      el.setAttribute("role", "group");
      el.setAttribute("aria-label", g.nom);
      for (const [nom, valeur, icone, raccourci, court] of g.boutons) {
        const b = bouton({
          icone: icone ?? "circle",
          nomAccessible: nom,
          infoBulle: g.bulle ? `${g.bulle} : ${court ?? nom}` : nom,
          raccourci: raccourci ? `${ctrl}+${raccourci.slice(-1)}` : undefined,
          positionInfoBulle: "dessus",
          presse: g.action ? undefined : false,
        });
        if (g.cle === "couleurTexte") b.classList.add(`ya-texte-${COULEURS_CSS[valeur]}`);
        b.dataset.indice = String(liste.length);
        if (valeur === "symboles") {
          b.setAttribute("aria-haspopup", "dialog");
        }
        if (!icone) {
          const pastille = document.createElement("span");
          pastille.className = `ya-pastille-couleur ya-pastille-${COULEURS_CSS[valeur]}`;
          pastille.setAttribute("aria-hidden", "true");
          b.querySelector("svg").replaceWith(pastille);
        }
        b.tabIndex = liste.length === 0 ? 0 : -1;
        // Style et plan : pas de focus à la souris, pour ne pas finir une saisie. Un outil le prend.
        if (g.action || g.cle !== "outil") b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => {
          if (valeur === "symboles") {
            b.focus();
            ouvrirSymboles();
            return;
          }
          if (g.action) {
            surAction?.(valeur);
            return;
          }
          // Position du texte : une modification des boîtes visées, pas un choix pour les suivantes.
          if (g.position) {
            surPosition?.(g.cle, valeur);
            return;
          }
          // Style et couleur du texte : pas un choix pour les objets suivants.
          if (g.texte) {
            surTexte?.(g.cle === "style" ? valeur : "color", ...(g.cle === "style" ? [] : [valeur]));
            return;
          }
          // Un clic sur un outil pose le focus (Safari ne le fait pas pour un bouton).
          if (g.cle === "outil") b.focus();
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


  const dansSymboles = (shape) => estSymbole({ shape }) || estFormePleine({ shape });

  // Le dialogue « Symboles » : choisir un symbole en fait l'outil actif et la forme courante.
  function ouvrirSymboles() {
    const d = dialogueChoix({
      titre: "Symboles",
      aide: "Choisissez un symbole, puis cliquez sur le whiteboard pour le poser.",
      nom: "Symboles disponibles",
      groupes: [
        SYMBOLES.map((s) => ({ id: s.shape, libelle: s.nom, icone: `symbole-${s.shape}` })),
        FORMES_PLEINES.map((s) => ({ id: s.shape, libelle: s.nom, icone: s.shape === "dot" ? "forme-point" : "forme-barre" })),
      ],
      selection: dansSymboles(etat.forme) ? etat.forme : undefined,
      surChoix: (shape) => {
        etat.outil = shape;
        etat.forme = shape;
        afficher();
        surChoix?.("outil", shape);
      },
    });
    d.ouvrir();
  }

  function afficher() {
    for (const { b, g, valeur } of liste) {
      if (valeur === "symboles") {
        b.setAttribute("aria-pressed", String(dansSymboles(etat.outil)));
        if (dansSymboles(etat.forme)) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
        const nom = [...SYMBOLES, ...FORMES_PLEINES].find((s) => s.shape === etat.forme)?.nom;
        b.definirInfoBulle(nom ? `Symboles : ${nom}` : "Symboles");
        continue;
      }
      if (g.action) {
        b.definirInactif(!planActif);
        continue;
      }
      if (g.position) {
        b.definirInactif(!position.actif);
        b.setAttribute("aria-pressed", String(position.actif && position[g.cle] === valeur));
        continue;
      }
      if (g.texte) {
        b.definirInactif(!texte.actif);
        const presse = g.cle === "style" ? texte.styles.includes(valeur) : texte.couleur === valeur;
        b.setAttribute("aria-pressed", String(texte.actif && presse));
        continue;
      }
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
    definir(v, options = {}) {
      Object.assign(etat, v);
      if (options.planActif !== undefined) planActif = options.planActif;
      if (options.texte !== undefined) texte = { actif: Boolean(options.texte.actif), styles: options.texte.styles ?? [], couleur: options.texte.couleur ?? null };
      if (options.position !== undefined) position = { actif: Boolean(options.position.actif), align: options.position.align ?? null, valign: options.position.valign ?? null };
      afficher();
    },
  };
}
