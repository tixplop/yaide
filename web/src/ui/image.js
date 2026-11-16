import { indication } from "./indication.js";

const ZONES = ["onglet", "apercu"];

// C-017 : une image entière dans sa zone, en lecture seule.
/** `chargement: false` : sans `src`, l'image naît à l'état « absente » et n'affiche jamais « Chargement… » (aperçu d'un dessin calculé). */
export function image({ src, nom: nomInitial, zone = "onglet", coupe = false, chargement = true }) {
  if (!src && chargement) throw new Error("image : src requis");
  if (!nomInitial) throw new Error("image : nom requis");
  let nom = nomInitial;
  if (!ZONES.includes(zone)) throw new Error(`image : zone inconnue « ${zone} »`);
  const element = document.createElement("div");
  element.className = "ya-image";
  if (zone === "onglet") {
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", nom);
    element.tabIndex = -1;
  } else {
    element.setAttribute("aria-label", "Aperçu");
  }
  let img = null;
  let courante = "";
  let jeton = 0;
  let premier = chargement; // aucune image encore affichée : « Chargement… » permis
  let enCoupure = coupe;
  let echec = false; // une erreur pendant la coupure : on reprend au retour

  const viderMessage = () => element.querySelectorAll(".indication").forEach((m) => m.remove());
  const retirerImage = () => {
    img?.remove();
    img = null;
  };

  function charger(adresse) {
    courante = adresse;
    echec = false;
    const mon = ++jeton;
    if (premier && !img && !enCoupure) {
      viderMessage();
      const m = indication({ texte: "Chargement…", variante: "chargement" });
      element.append(m);
    }
    const sonde = new Image();
    sonde.onload = () => {
      if (mon !== jeton) return;
      premier = false;
      viderMessage();
      if (!img) {
        img = document.createElement("img");
        img.alt = nom;
        img.setAttribute("draggable", "false");
        element.append(img);
      }
      img.setAttribute("src", adresse);
    };
    sonde.onerror = () => {
      if (mon !== jeton) return;
      viderMessage();
      if (enCoupure) {
        echec = true;
        return;
      }
      if (zone === "onglet") {
        retirerImage();
        element.append(indication({ texte: `${nom} ne peut pas être affiché.` }));
      }
    };
    sonde.src = adresse;
  }

  if (src) charger(src);

  return {
    element,
    focus: () => element.focus(),
    changerSource: (adresse) => charger(adresse),
    /** Le fichier a changé de nom : nom accessible (onglet), `alt` et message d'erreur suivent. */
    renommer(nouveau) {
      if (!nouveau) throw new Error("image : nom requis");
      nom = nouveau;
      if (zone === "onglet") element.setAttribute("aria-label", nom);
      if (img) img.alt = nom;
      const m = element.querySelector(".indication[role=status]:not([aria-busy])");
      if (m) m.querySelector("span").textContent = `${nom} ne peut pas être affiché.`;
    },
    definirEtat(etat) {
      if (etat !== "absente") throw new Error(`image : état inconnu « ${etat} »`);
      jeton++;
      viderMessage();
      retirerImage();
    },
    definirCoupe(oui) {
      const reprise = enCoupure && !oui && echec;
      enCoupure = Boolean(oui);
      if (enCoupure && !img) viderMessage();
      if (reprise) charger(courante);
    },
  };
}
