import { icone } from "./icones.js";
import { COULEURS } from "./avatar.js";

const TYPES = ["texte", "motDePasse", "secret", "multiligne", "liste", "case", "couleur"];
const PRESENTATIONS = ["normale", "ligne", "barre"];
const NOMS_COULEURS = { violet: "Violet", vert: "Vert", orange: "Orange", rose: "Rose", sarcelle: "Sarcelle", gris: "Gris" };
const CLAVIERS = { numerique: "numeric", decimal: "decimal" };
let compteur = 0;

export function champ({ libelle, type = "texte", valeur = "", options = [], indication, aide, erreur, libelleMasque = false, desactive = false, clavier, presentation = "normale", avant, action }) {
  if (!libelle) throw new Error("champ : libelle requis");
  if (!TYPES.includes(type)) throw new Error(`champ : type inconnu « ${type} »`);
  if (clavier !== undefined && !(clavier in CLAVIERS)) throw new Error(`champ : clavier inconnu « ${clavier} »`);
  if (!PRESENTATIONS.includes(presentation)) throw new Error(`champ : presentation inconnue « ${presentation} »`);
  if (presentation === "barre" && type !== "liste") throw new Error("champ : la presentation « barre » n'existe que pour une liste");
  const n = ++compteur;
  if (type === "couleur") return champCouleur(libelle, valeur || "violet", n, desactive);
  if (type === "case" && presentation === "ligne") return caseEnLigne({ libelle, valeur, avant, action, desactive, n });
  const racine = document.createElement("div");
  racine.className = type === "case" ? "champ ya-case" : presentation === "barre" ? "champ ya-barre" : "champ";

  const label = document.createElement("label");
  label.className = libelleMasque ? "champ-libelle masque" : "champ-libelle";
  label.htmlFor = `champ-${n}`;
  label.textContent = libelle;

  let saisie;
  if (type === "multiligne") {
    saisie = document.createElement("textarea");
    saisie.rows = 2;
    saisie.value = valeur;
  } else if (type === "liste") {
    saisie = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = opt.textContent = o;
      saisie.append(opt);
    }
    if (valeur) saisie.value = valeur;
  } else if (type === "case") {
    saisie = document.createElement("input");
    saisie.type = "checkbox";
    saisie.checked = Boolean(valeur);
  } else {
    saisie = document.createElement("input");
    saisie.type = type === "texte" ? "text" : "password";
    if (type === "motDePasse") saisie.setAttribute("autocomplete", "current-password");
    // Une clé d'API n'est jamais préremplie.
    if (type === "secret") saisie.setAttribute("autocomplete", "off");
    else saisie.value = valeur;
    if (type === "texte" && clavier) saisie.setAttribute("inputmode", CLAVIERS[clavier]);
  }
  if (type === "texte" || type === "secret" || type === "multiligne") saisie.spellcheck = false;
  if (indication && type !== "liste" && type !== "case") saisie.placeholder = indication;
  saisie.id = `champ-${n}`;
  if (type !== "case") saisie.className = type === "multiligne" ? "champ-saisie ya-input ya-textarea" : "champ-saisie ya-input";
  saisie.disabled = desactive;

  const decrit = [];
  if (type === "case") racine.append(saisie, label);
  else racine.append(label, saisie);
  if (aide && presentation !== "barre") {
    const a = document.createElement("div");
    a.className = "champ-aide";
    a.id = `champ-${n}-aide`;
    a.textContent = aide;
    decrit.push(a.id);
    racine.append(a);
  }
  if (erreur && presentation !== "barre") {
    const e = document.createElement("div");
    e.className = "champ-erreur";
    e.id = `champ-${n}-erreur`;
    e.setAttribute("role", "alert");
    e.textContent = erreur;
    decrit.push(e.id);
    saisie.setAttribute("aria-invalid", "true");
    racine.append(e);
  }
  if (decrit.length) saisie.setAttribute("aria-describedby", decrit.join(" "));
  return racine;
}

// C-002, `case` en `ligne` : le libellé prend toute la ligne, `avant` (avatar masqué) puis le texte ; `action` reste à droite.
function caseEnLigne({ libelle, valeur, avant, action, desactive, n }) {
  const racine = document.createElement("div");
  racine.className = "ya-check-row";
  const label = document.createElement("label");
  const saisie = document.createElement("input");
  saisie.type = "checkbox";
  saisie.id = `champ-${n}`;
  saisie.checked = Boolean(valeur);
  saisie.disabled = desactive;
  const nom = document.createElement("span");
  nom.className = "nom";
  nom.textContent = libelle;
  nom.title = libelle;
  label.append(saisie, ...(avant ? [avant] : []), nom);
  racine.append(label, ...(action ? [action] : []));
  return racine;
}

// C-002, `couleur` : groupe radio natif, un seul arrêt de Tab ; la coche est dans le rond de la couleur choisie.
function champCouleur(libelle, valeur, n, desactive) {
  if (!COULEURS.includes(valeur)) throw new Error(`champ : couleur inconnue « ${valeur} »`);
  const racine = document.createElement("fieldset");
  racine.className = "champ champ-couleur";
  const legende = document.createElement("legend");
  legende.className = "champ-libelle";
  legende.textContent = libelle;
  const rangee = document.createElement("div");
  rangee.className = "ya-swatches";
  for (const c of COULEURS) {
    const label = document.createElement("label");
    label.className = "ya-swatch";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `champ-${n}-couleur`;
    radio.value = c;
    radio.checked = c === valeur;
    radio.disabled = desactive;
    radio.setAttribute("aria-label", NOMS_COULEURS[c]);
    const rond = document.createElement("span");
    rond.style.setProperty("--c", `var(--agent-${c})`);
    rond.append(icone("check", 12));
    label.append(radio, rond);
    rangee.append(label);
  }
  racine.append(legende, rangee);
  return racine;
}
