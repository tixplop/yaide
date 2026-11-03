import { icone as dessiner } from "./icones.js";
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
}) {
  if (!libelle && !icone) throw new Error("bouton : libelle requis");
  if (!VARIANTES.includes(variante)) throw new Error(`bouton : variante inconnue « ${variante} »`);
  if (!TAILLES.includes(taille)) throw new Error(`bouton : taille inconnue « ${taille} »`);
  if (icone && libelle) throw new Error("bouton : icone et libelle s'excluent");
  if (!libelle && !nomAccessible) throw new Error("bouton : nomAccessible requis sans libelle");
  if (libelle && !/[\p{L}\p{N}]/u.test(libelle) && !nomAccessible) throw new Error("bouton : nomAccessible requis pour un libellé qui n'est qu'un signe");
  const b = document.createElement("button");
  b.type = submit ? "submit" : "button";
  // `bouton` et `bouton-*` sont des repères ; le style vient des classes `ya-`.
  b.className = `bouton bouton-${variante}`;
  const aIcone = icone && variante !== "principal";
  if (aIcone) b.classList.add("ya-icon-btn");
  else b.classList.add("ya-btn");
  if (variante === "principal") b.classList.add("ya-btn-primary");
  if (variante === "danger") b.classList.add("ya-btn-danger");
  if (aIcone && taille !== "normale") b.classList.add(`ya-icon-btn-${taille}`);
  if (nomAccessible) b.setAttribute("aria-label", nomAccessible);
  if (touche) b.setAttribute("aria-keyshortcuts", touche);
  if (presse !== undefined) b.setAttribute("aria-pressed", String(Boolean(presse)));
  b.disabled = desactive;

  if (icone) {
    b.classList.add("bouton-icone");
    b.append(dessiner(icone));
  }
  if (libelle) b.textContent = libelle;
  if (libelleEnCours) {
    const t = document.createElement("span");
    t.className = "bouton-en-cours";
    t.textContent = libelleEnCours;
    if (!icone) b.textContent = "";
    b.append(t);
    b.disabled = true;
    b.setAttribute("aria-busy", "true");
  }

  // Une commande à icône seule n'a que son info-bulle (C-012) : le bouton désactivé n'émet pas
  // d'événements dans tous les navigateurs, l'appelant insère donc l'enveloppe à sa place.
  if (icone) {
    const nom = infoBulle ?? nomAccessible;
    const enveloppe = document.createElement("span");
    enveloppe.className = "bouton-enveloppe";
    enveloppe.append(b);
    creerInfoBulle({ texte: raccourci ? `${nom} (${raccourci})` : nom, ancre: b, enveloppe, position: positionInfoBulle });
    b.enveloppe = enveloppe;
  }
  return b;
}
