import { icone as dessiner } from "./icones.js";
import { compteur as creerCompteur } from "./compteur.js";
import { infoBulle as creerInfoBulle } from "./info-bulle.js";

const VARIANTES = ["principal", "secondaire", "discret", "danger"];
const TAILLES = ["normale", "ligne", "onglet", "barre", "disque"];

// Bouton « Logs » de la barre d'état (REQ-187) : une icône, un nom et une info-bulle par état.
const ETATS_LOGS = {
  rien: { icone: "info", nom: "Logs : rien à signaler" },
  avertissements: { icone: "triangle-alert-plein", nom: "Logs : avertissements" },
  erreurs: { icone: "circle-alert-plein", nom: "Logs : erreurs" },
};

const COULEUR_PASTILLE = /^#[0-9a-fA-F]{3,8}$/;
const classes = new Map();
let feuilleP = null;

// Une classe par jeu de trois couleurs `{ sombre, clair }`, posée une fois dans une feuille partagée.
function classePastilles(liste) {
  for (const p of liste) if (!COULEUR_PASTILLE.test(p?.sombre ?? "") || !COULEUR_PASTILLE.test(p?.clair ?? "")) throw new Error("bouton : pastilles attend trois { sombre, clair } en #rgb ou #rrggbb");
  const cle = liste.map((p) => `${p.sombre}${p.clair}`).join("");
  if (!classes.has(cle)) {
    const nom = `ya-pastilles-${classes.size}`;
    const dec = (t) => liste.map((p, i) => `--pastille-${i + 1}: ${p[t]};`).join(" ");
    if (!feuilleP) {
      const el = document.createElement("style");
      document.head.append(el);
      feuilleP = el.sheet;
    }
    feuilleP.insertRule(`.${nom} { ${dec("sombre")} }`, feuilleP.cssRules.length);
    feuilleP.insertRule(`[data-theme="light"] .${nom} { ${dec("clair")} }`, feuilleP.cssRules.length);
    classes.set(cle, nom);
  }
  return classes.get(cle);
}

export function bouton({
  libelle,
  icone,
  variante = "secondaire",
  nomAccessible,
  infoBulle,
  positionInfoBulle,
  raccourci,
  touche = raccourci,
  presse,
  desactive = false,
  libelleEnCours,
  submit = false,
  taille = "normale",
  ouvreMenu = false,
  ouvreDialogue = false,
  compteur,
  actif,
  pastilles,
  inactif = false,
  menuContextuel,
  etat,
}) {
  if (etat !== undefined) {
    if (!Object.hasOwn(ETATS_LOGS, etat)) throw new Error(`bouton : état inconnu « ${etat} »`);
    if (libelle || icone) throw new Error("bouton : etat ne se combine ni avec libelle ni avec icone");
    icone = ETATS_LOGS[etat].icone;
    nomAccessible = ETATS_LOGS[etat].nom;
    infoBulle = undefined;
    taille = "ligne";
    positionInfoBulle = "dessus";
  }
  if (menuContextuel !== undefined && (typeof menuContextuel !== "function" || !icone || libelle)) throw new Error("bouton : menuContextuel demande une fonction et une commande à icône");
  if (!libelle && !icone) throw new Error("bouton : libelle requis");
  if (!VARIANTES.includes(variante)) throw new Error(`bouton : variante inconnue « ${variante} »`);
  if (!TAILLES.includes(taille)) throw new Error(`bouton : taille inconnue « ${taille} »`);
  if (!libelle && !nomAccessible) throw new Error("bouton : nomAccessible requis sans libelle");
  if (libelle && !/[\p{L}\p{N}]/u.test(libelle) && !nomAccessible) throw new Error("bouton : nomAccessible requis pour un libellé qui n'est qu'un signe");
  if (taille === "disque" && (!icone || libelle || variante !== "secondaire" || desactive)) throw new Error("bouton : la taille disque demande une icône secondaire, sans libellé, jamais désactivée");
  if (taille === "disque" && positionInfoBulle !== undefined && !["dessus", "droite"].includes(positionInfoBulle)) throw new Error("bouton : la taille disque place son info-bulle dessus ou à droite");
  if (taille === "barre" && (!libelle || icone || variante !== "secondaire")) throw new Error("bouton : la taille barre demande un libellé secondaire, sans icône");
  if (pastilles && (!libelle || icone || variante !== "secondaire" || pastilles.length !== 3)) throw new Error("bouton : pastilles demande un libellé secondaire, sans icône, et trois couleurs");
  const b = document.createElement("button");
  b.type = submit ? "submit" : "button";
  // `bouton` et `bouton-*` sont des repères ; le style vient des classes `ya-`.
  b.className = `bouton bouton-${variante}`;
  const aIcone = icone && !libelle && variante !== "principal";
  if (aIcone) b.classList.add("ya-icon-btn");
  else b.classList.add("ya-btn");
  if (variante === "principal") b.classList.add("ya-btn-primary");
  if (variante === "danger") b.classList.add("ya-btn-danger");
  if (taille === "barre") b.classList.add("ya-btn-barre");
  if (aIcone && taille !== "normale") b.classList.add(`ya-icon-btn-${taille}`);
  if (taille === "disque") {
    // Aide d'un tableau rendu : jamais un arrêt de Tab, et le focus ne quitte pas l'éditeur ou la cellule.
    b.tabIndex = -1;
    b.addEventListener("mousedown", (ev) => ev.preventDefault());
  }
  if (nomAccessible) b.setAttribute("aria-label", nomAccessible);
  if (touche) b.setAttribute("aria-keyshortcuts", touche);
  if (presse !== undefined) b.setAttribute("aria-pressed", String(Boolean(presse)));
  b.disabled = desactive;

  if (ouvreMenu) {
    b.setAttribute("aria-haspopup", "menu");
    b.setAttribute("aria-expanded", "false");
  }
  // Commande du rail avec menu au clic droit : `contextmenu`, Menu et Maj+F10 appellent `menuContextuel`, jamais le menu du navigateur.
  // En cours (`aria-busy`), rien ne s'ouvre. Le menu pose lui-même `aria-expanded`.
  if (menuContextuel) {
    b.setAttribute("aria-haspopup", "menu");
    b.setAttribute("aria-expanded", "false");
    const ouvrir = (ev) => {
      ev.preventDefault();
      if (b.getAttribute("aria-busy") !== "true") menuContextuel();
    };
    b.addEventListener("contextmenu", ouvrir);
    b.addEventListener("keydown", (ev) => {
      if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) ouvrir(ev);
    });
  }
  // Commande qui ouvre un dialogue : `definirOuvert` suit son état (fond `--bg-400`, icône `--ink`).
  if (ouvreDialogue) b.setAttribute("aria-haspopup", "dialog");
  // Commande du rail droit : `data-actif` porte le filet ; ni aria-pressed ni aria-expanded.
  b.definirActif = (oui) => b.toggleAttribute("data-actif", Boolean(oui));
  if (actif !== undefined) b.definirActif(actif);
  // Lancement en cours (commande « opencode ») : le bouton reste actif et garde le focus.
  b.definirOccupe = (oui) => (oui ? b.setAttribute("aria-busy", "true") : b.removeAttribute("aria-busy"));
  b.definirOuvert = (oui) => b.setAttribute("aria-expanded", String(Boolean(oui)));
  let badge = null;
  b.definirCompteur = (n) => {
    if (!badge) {
      badge = creerCompteur({ valeur: n });
      badge.setAttribute("aria-hidden", "true");
      b.append(badge);
    } else {
      badge.textContent = String(n);
      badge.hidden = n === 0;
    }
  };
  // Garde le contour de `:focus-visible` quand le focus est donné par code après un clic.
  b.poserFocus = () => {
    b.classList.add("ya-focus-garde");
    b.addEventListener("blur", () => b.classList.remove("ya-focus-garde"), { once: true });
    b.focus();
  };
  if (compteur !== undefined) b.definirCompteur(compteur);

  if (pastilles) {
    // Trois ronds masqués avant le libellé ; leurs couleurs suivent `data-theme` par une classe, sans attribut `style`.
    b.classList.add("ya-btn-pastilles", classePastilles(pastilles));
    for (let i = 0; i < 3; i++) {
      const rond = document.createElement("span");
      rond.className = "ya-pastille-ronde";
      rond.setAttribute("aria-hidden", "true");
      b.append(rond);
    }
  }
  if (icone) {
    b.classList.add("bouton-icone");
    b.append(dessiner(icone, etat === undefined ? 16 : 14));
  }
  // Logs : la couleur et la forme suivent l'état ; le nom, la forme et l'info-bulle changent d'un coup, sans annonce ni focus déplacé.
  if (etat !== undefined) {
    b.classList.add("ya-logs");
    b.dataset.etat = etat;
  }
  // Commande inactive d'une barre d'outils : `aria-disabled` sans `disabled`, le bouton garde focus et info-bulle ;
  // le clic et Entrée n'ont aucun effet (la capture passe avant les écouteurs de l'appelant).
  b.definirInactif = (oui) => (oui ? b.setAttribute("aria-disabled", "true") : b.removeAttribute("aria-disabled"));
  if (inactif) b.definirInactif(true);
  b.addEventListener("click", (ev) => {
    if (taille !== "barre" && b.getAttribute("aria-disabled") === "true" && !b.hasAttribute("aria-busy")) ev.stopImmediatePropagation();
  });
  if (taille === "barre") {
    // Taille « barre » : le bouton reste actif pour garder le focus ; en cours, `aria-disabled` et un clic sans effet.
    b.addEventListener("click", (ev) => {
      if (b.getAttribute("aria-disabled") === "true") ev.stopImmediatePropagation();
    });
    b.definirEnCours = (oui) => {
      b.textContent = oui && libelleEnCours ? libelleEnCours : libelle;
      b.classList.toggle("bouton-en-cours", Boolean(oui));
      if (oui) {
        b.setAttribute("aria-busy", "true");
        b.setAttribute("aria-disabled", "true");
      } else {
        b.removeAttribute("aria-busy");
        b.removeAttribute("aria-disabled");
      }
    };
    b.definirEnCours(Boolean(libelleEnCours));
  } else if (libelle && !libelleEnCours) b.append(libelle);
  if (libelleEnCours && taille !== "barre") {
    const t = document.createElement("span");
    t.className = "bouton-en-cours";
    t.textContent = libelleEnCours;
    b.append(t);
    b.disabled = true;
    b.setAttribute("aria-busy", "true");
  }

  // Une commande à icône seule n'a que son info-bulle (C-012) : le bouton désactivé n'émet pas
  // d'événements dans tous les navigateurs, l'appelant insère donc l'enveloppe à sa place.
  let bulle = null;
  if (icone) {
    const nom = infoBulle ?? nomAccessible ?? libelle;
    const enveloppe = document.createElement("span");
    enveloppe.className = "bouton-enveloppe";
    enveloppe.append(b);
    // Menu ouvert, pas d'info-bulle : cet écouteur passe avant celui de l'info-bulle.
    if (menuContextuel) enveloppe.addEventListener("pointerenter", (ev) => b.getAttribute("aria-expanded") === "true" && ev.stopImmediatePropagation(), true);
    bulle = creerInfoBulle({ texte: raccourci ? `${nom} (${raccourci})` : nom, ancre: b, enveloppe, position: positionInfoBulle ?? (taille === "disque" ? "dessus" : undefined) });
    b.enveloppe = enveloppe;
  }
  // Change le texte de l'info-bulle d'un bouton à icône, sans toucher à son nom accessible.
  b.definirInfoBulle = (texte) => bulle?.definirTexte(texte);
  // Change la commande d'un bouton à icône : nom accessible, dessin et texte de la bulle. Jamais d'`aria-pressed`.
  b.definirCommande = ({ nomAccessible: nom, icone: dessin }) => {
    if (!bulle) throw new Error("bouton : definirCommande demande un bouton à icône");
    if (!nom || !dessin) throw new Error("bouton : nomAccessible et icone requis");
    b.setAttribute("aria-label", nom);
    b.querySelector("svg").replaceWith(dessiner(dessin));
    bulle.definirTexte(raccourci ? `${nom} (${raccourci})` : nom);
  };
  b.definirEtat = (nouveau) => {
    if (etat === undefined) throw new Error("bouton : definirEtat demande un bouton logs");
    if (!Object.hasOwn(ETATS_LOGS, nouveau)) throw new Error(`bouton : état inconnu « ${nouveau} »`);
    const { icone: dessin, nom } = ETATS_LOGS[nouveau];
    b.dataset.etat = nouveau;
    b.setAttribute("aria-label", nom);
    b.querySelector("svg").replaceWith(dessiner(dessin, 14));
    bulle.definirTexte(nom);
  };
  return b;
}
