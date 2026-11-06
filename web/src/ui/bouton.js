import { icone as dessiner } from "./icones.js";
import { compteur as creerCompteur } from "./compteur.js";
import { infoBulle as creerInfoBulle } from "./info-bulle.js";

const VARIANTES = ["principal", "secondaire", "discret", "danger"];
const TAILLES = ["normale", "ligne", "onglet"];

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
  compteur,
  deplie,
}) {
  if (!libelle && !icone) throw new Error("bouton : libelle requis");
  if (!VARIANTES.includes(variante)) throw new Error(`bouton : variante inconnue « ${variante} »`);
  if (!TAILLES.includes(taille)) throw new Error(`bouton : taille inconnue « ${taille} »`);
  if (!libelle && !nomAccessible) throw new Error("bouton : nomAccessible requis sans libelle");
  if (libelle && !/[\p{L}\p{N}]/u.test(libelle) && !nomAccessible) throw new Error("bouton : nomAccessible requis pour un libellé qui n'est qu'un signe");
  const b = document.createElement("button");
  b.type = submit ? "submit" : "button";
  // `bouton` et `bouton-*` sont des repères ; le style vient des classes `ya-`.
  b.className = `bouton bouton-${variante}`;
  const aIcone = icone && !libelle && variante !== "principal";
  if (aIcone) b.classList.add("ya-icon-btn");
  else b.classList.add("ya-btn");
  if (variante === "principal") b.classList.add("ya-btn-primary");
  if (variante === "danger") b.classList.add("ya-btn-danger");
  if (aIcone && taille !== "normale") b.classList.add(`ya-icon-btn-${taille}`);
  if (nomAccessible) b.setAttribute("aria-label", nomAccessible);
  if (touche) b.setAttribute("aria-keyshortcuts", touche);
  if (presse !== undefined) b.setAttribute("aria-pressed", String(Boolean(presse)));
  b.disabled = desactive;

  if (ouvreMenu) {
    b.setAttribute("aria-haspopup", "menu");
    b.setAttribute("aria-expanded", "false");
  }
  // Commande du rail droit : `data-deplie` porte le filet ; ni aria-pressed ni aria-expanded.
  b.definirDeplie = (oui) => b.toggleAttribute("data-deplie", Boolean(oui));
  if (deplie !== undefined) b.definirDeplie(deplie);
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

  if (icone) {
    b.classList.add("bouton-icone");
    b.append(dessiner(icone));
  }
  if (libelle && !libelleEnCours) b.append(libelle);
  if (libelleEnCours) {
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
    bulle = creerInfoBulle({ texte: raccourci ? `${nom} (${raccourci})` : nom, ancre: b, enveloppe, position: positionInfoBulle });
    b.enveloppe = enveloppe;
  }
  // Change la commande d'un bouton à icône : nom accessible, dessin et texte de la bulle. Jamais d'`aria-pressed`.
  b.definirCommande = ({ nomAccessible: nom, icone: dessin }) => {
    if (!bulle) throw new Error("bouton : definirCommande demande un bouton à icône");
    if (!nom || !dessin) throw new Error("bouton : nomAccessible et icone requis");
    b.setAttribute("aria-label", nom);
    b.querySelector("svg").replaceWith(dessiner(dessin));
    bulle.definirTexte(raccourci ? `${nom} (${raccourci})` : nom);
  };
  return b;
}
