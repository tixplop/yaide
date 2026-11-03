import { icone as dessiner } from "./icones.js";
import { infoBulle as creerInfoBulle } from "./info-bulle.js";

const VARIANTES = ["principal", "secondaire", "discret", "danger"];
const COULEURS = ["naviguer", "creer", "supprimer", "distant"];

export function bouton({
  libelle,
  icone,
  couleurIcone = "naviguer",
  variante = "secondaire",
  nomAccessible,
  infoBulle,
  raccourci,
  touche = raccourci,
  presse,
  desactive = false,
  libelleEnCours,
  submit = false,
}) {
  if (!libelle && !icone) throw new Error("bouton : libelle requis");
  if (!VARIANTES.includes(variante)) throw new Error(`bouton : variante inconnue « ${variante} »`);
  if (!COULEURS.includes(couleurIcone)) throw new Error(`bouton : couleurIcone inconnue « ${couleurIcone} »`);
  if (icone && libelle) throw new Error("bouton : icone et libelle s'excluent");
  if (!libelle && !nomAccessible) throw new Error("bouton : nomAccessible requis sans libelle");
  if (libelle && !/[\p{L}\p{N}]/u.test(libelle) && !nomAccessible) throw new Error("bouton : nomAccessible requis pour un libellé qui n'est qu'un signe");
  const b = document.createElement("button");
  b.type = submit ? "submit" : "button";
  b.className = `bouton bouton-${variante}`;
  if (nomAccessible) b.setAttribute("aria-label", nomAccessible);
  if (touche) b.setAttribute("aria-keyshortcuts", touche);
  if (presse !== undefined) b.setAttribute("aria-pressed", String(Boolean(presse)));
  b.disabled = desactive;

  if (icone) {
    b.classList.add("bouton-icone", `bouton-icone-${couleurIcone}`);
    b.append(dessiner(icone));
  }
  if (libelle) b.textContent = libelle;
  if (libelleEnCours) {
    if (icone) {
      const t = document.createElement("span");
      t.className = "bouton-en-cours";
      t.textContent = libelleEnCours;
      b.append(t);
    } else b.textContent = libelleEnCours;
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
    creerInfoBulle({ texte: raccourci ? `${nom} (${raccourci})` : nom, ancre: b, enveloppe });
    b.enveloppe = enveloppe;
  }
  return b;
}
