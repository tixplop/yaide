import { icone } from "./icones.js";
import { COULEURS } from "./avatar.js";
import { bouton } from "./bouton.js";
import { menu } from "./menu.js";
import { prochainesFoisCron } from "../api.js";

const TYPES = ["texte", "motDePasse", "secret", "multiligne", "liste", "case", "couleur", "codeCouleur", "copie", "cron"];
const PRESENTATIONS = ["normale", "ligne", "barre"];
const NOMS_COULEURS = { violet: "Violet", vert: "Vert", orange: "Orange", rose: "Rose", sarcelle: "Sarcelle", gris: "Gris" };
const CLAVIERS = { numerique: "numeric", decimal: "decimal" };
let compteur = 0;

// REQ-204 : les modèles d'expression cron, dans cet ordre (une liste unique, DEC-130).
export const MODELES_CRON = [
  { libelle: "Toutes les 15 minutes", expression: "*/15 * * * *" },
  { libelle: "Toutes les heures", expression: "0 * * * *" },
  { libelle: "Chaque jour à 9 h", expression: "0 9 * * *" },
  { libelle: "Du lundi au vendredi à 9 h", expression: "0 9 * * 1-5" },
  { libelle: "Chaque lundi à 9 h", expression: "0 9 * * 1" },
  { libelle: "Le 1er du mois à 9 h", expression: "0 9 1 * *" },
];
const DELAI_FRAPPE_CRON = 300;
const DELAI_REESSAI_CRON = 5000;
const JOUR_CRON = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function champ({ libelle, type = "texte", valeur = "", options = [], indication, aide, erreur, libelleMasque = false, desactive = false, lectureSeule = false, clavier, presentation = "normale", avant, action, ligne = false, raison, sansRetour = false, nomCopier, surCopie }) {
  if (!libelle) throw new Error("champ : libelle requis");
  if (!TYPES.includes(type)) throw new Error(`champ : type inconnu « ${type} »`);
  if (clavier !== undefined && !(clavier in CLAVIERS)) throw new Error(`champ : clavier inconnu « ${clavier} »`);
  if (!PRESENTATIONS.includes(presentation)) throw new Error(`champ : presentation inconnue « ${presentation} »`);
  if (presentation === "barre" && type !== "liste") throw new Error("champ : la presentation « barre » n'existe que pour une liste");
  if (ligne && presentation !== "barre") throw new Error("champ : « ligne » n'existe que pour la presentation « barre »");
  if (sansRetour && type !== "multiligne") throw new Error("champ : sansRetour demande le type « multiligne »");
  if (action && !(type === "liste" && presentation === "barre") && !(type === "case" && presentation === "ligne")) throw new Error("champ : action n'existe que pour une liste en presentation « barre » ou une case en « ligne »");
  const n = ++compteur;
  if (type === "copie") return champCopie({ libelle, valeur, aide, nomCopier, surCopie, n });
  if (type === "codeCouleur") return champCodeCouleur({ libelle, valeur, erreur, desactive, n });
  if (type === "couleur") return champCouleur(libelle, valeur || "violet", n, desactive);
  if (type === "case" && presentation === "ligne") return caseEnLigne({ libelle, valeur, avant, action, desactive, n });
  const racine = document.createElement("div");
  racine.className = type === "case" ? "champ ya-case" : presentation === "barre" ? (ligne ? "champ ya-barre ya-ligne" : "champ ya-barre") : "champ";

  const label = document.createElement("label");
  label.className = libelleMasque ? "champ-libelle masque" : "champ-libelle";
  label.htmlFor = `champ-${n}`;
  label.textContent = libelle;

  let saisie;
  if (type === "multiligne") {
    saisie = document.createElement("textarea");
    saisie.rows = sansRetour ? 3 : 2;
    // Une valeur par ligne : une ligne trop longue défile en largeur au lieu de passer à la ligne.
    if (sansRetour) saisie.wrap = "off";
    saisie.value = valeur;
  } else if (type === "liste") {
    saisie = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      // Une option est un texte, ou `{ valeur, texte }`.
      opt.value = typeof o === "string" ? o : o.valeur;
      opt.textContent = typeof o === "string" ? o : o.texte;
      saisie.append(opt);
    }
    if (valeur) saisie.value = valeur;
  } else if (type === "case") {
    saisie = document.createElement("input");
    saisie.type = "checkbox";
    saisie.checked = Boolean(valeur);
  } else {
    saisie = document.createElement("input");
    saisie.type = type === "texte" || type === "cron" ? "text" : "password";
    if (type === "motDePasse") saisie.setAttribute("autocomplete", "current-password");
    // Une clé d'API n'est jamais préremplie.
    if (type === "secret") saisie.setAttribute("autocomplete", "off");
    else saisie.value = valeur;
    if (type === "texte" && clavier) saisie.setAttribute("inputmode", CLAVIERS[clavier]);
  }
  if (type === "texte" || type === "secret" || type === "multiligne" || type === "cron") saisie.spellcheck = false;
  if (type === "cron") saisie.setAttribute("autocomplete", "off");
  if (lectureSeule && (type === "texte" || type === "multiligne" || type === "cron")) saisie.readOnly = true;
  if (indication && type !== "liste" && type !== "case") saisie.placeholder = indication;
  saisie.id = `champ-${n}`;
  if (type !== "case") saisie.className = type === "multiligne" ? "champ-saisie ya-input ya-textarea" : "champ-saisie ya-input";
  saisie.disabled = desactive;
  if (ligne) {
    // Texte coupé par « … » : `title` donne le texte entier, ou la raison de la désactivation.
    // Après une mise à jour en place (valeur, `disabled`, nouvelle raison), la vue appelle `racine.actualiserTitre(raison)`.
    let derniere = raison;
    racine.actualiserTitre = (r = derniere) => {
      derniere = r;
      saisie.title = saisie.disabled && r ? r : (saisie.selectedOptions[0]?.textContent ?? "");
    };
    racine.actualiserTitre();
    saisie.addEventListener("change", () => racine.actualiserTitre());
  }

  const decrit = [];
  let aideEl;
  let cron;
  if (type === "cron") {
    cron = ligneCron(saisie, n, lectureSeule, desactive);
    racine.append(label, cron.ligne);
  } else if (type === "case") racine.append(saisie, label);
  else racine.append(label, saisie);
  if (aide && presentation !== "barre") {
    const a = document.createElement("div");
    a.className = "champ-aide";
    a.id = `champ-${n}-aide`;
    a.textContent = aide;
    decrit.push(a.id);
    aideEl = a;
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
  // Le message d'erreur vient entre le champ et l'aide.
  if (aideEl) racine.append(aideEl);
  if (cron) {
    racine.append(cron.zone);
    decrit.push(cron.zone.id);
  }
  if (decrit.length) saisie.setAttribute("aria-describedby", decrit.join(" "));
  // Le bouton de l'action suit la liste ; il est désactivé avec elle, sinon il garde son propre état.
  if (action) {
    if (desactive) for (const b of action.querySelectorAll("button")) b.disabled = true;
    racine.append(action);
  }
  return racine;
}

const dateCron = (texte) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(texte);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
};

// « lundi 30 novembre 2026, 09:00 » : le jour « 1 » s'écrit « 1er », le jour et l'heure ne se coupent pas.
function elementDate(texte) {
  const d = dateCron(texte);
  if (!d) return null;
  const jour = JOUR_CRON.formatToParts(d).map((p) => (p.type === "day" && p.value === "1" ? "1er" : p.value)).join("");
  const li = document.createElement("li");
  const a = document.createElement("span");
  a.className = "ya-cron-jour";
  a.textContent = `${jour},`;
  const b = document.createElement("span");
  b.className = "ya-cron-heure";
  b.textContent = texte.slice(11);
  li.append(a, " ", b);
  return li;
}

// C-002, `cron` : le champ, « Modèles » et la zone des prochaines fois (REQ-204). Rien n'est une erreur : la zone dit, le refus reste celui de l'enregistrement.
function ligneCron(saisie, n, lectureSeule, desactive) {
  const ligne = document.createElement("div");
  ligne.className = "ya-cron-ligne";
  const modeles = bouton({ libelle: "Modèles", icone: "clock", variante: "secondaire", nomAccessible: "Modèles d'expression cron", ouvreMenu: true, desactive });
  if (lectureSeule) modeles.setAttribute("aria-disabled", "true");
  ligne.append(saisie, modeles);
  const zone = document.createElement("div");
  zone.className = "ya-cron-zone";
  zone.id = `champ-${n}-cron`;
  zone.setAttribute("aria-live", "polite");

  modeles.addEventListener("click", () => {
    if (lectureSeule || modeles.getAttribute("aria-expanded") === "true") return;
    modeles.focus();
    const ouvert = menu({
      nom: "Modèles d'expression cron",
      ancre: modeles,
      alignement: "droite",
      groupes: [
        MODELES_CRON.map((m) => ({
          libelle: m.libelle,
          detail: m.expression,
          surChoix: () => {
            saisie.value = m.expression;
            saisie.dispatchEvent(new Event("input", { bubbles: true }));
            saisie.focus();
            saisie.setSelectionRange(m.expression.length, m.expression.length);
            demander(0);
          },
        })),
      ],
      surFermeture: () => {},
    });
    ouvert.racine.id = `champ-${n}-modeles`;
    modeles.setAttribute("aria-controls", ouvert.racine.id);
  });

  let numero = 0;
  let minuteur = null;
  const arreter = () => {
    clearTimeout(minuteur);
    minuteur = null;
  };
  const dire = (texte) => {
    const p = document.createElement("div");
    p.className = "ya-cron-message";
    p.textContent = texte;
    zone.replaceChildren(p);
  };
  function afficher(r) {
    arreter();
    let reessai = null;
    if (r.dates?.length) {
      const entete = document.createElement("div");
      entete.className = "ya-cron-entete";
      entete.textContent = "Prochaines fois :";
      const ul = document.createElement("ul");
      ul.className = "ya-cron-dates";
      ul.append(...r.dates.map(elementDate).filter(Boolean));
      zone.replaceChildren(entete, ul);
      // Redemandées quand la première date est passée.
      const premiere = dateCron(r.dates[0]);
      // Un délai de setTimeout au-delà de 2^31 - 1 ms part aussitôt : on borne à une heure.
      if (premiere) reessai = Math.min(Math.max(1000, premiere.getTime() - Date.now() + 500), 3600000);
    } else if (r.illisible) dire("Expression incomplète ou illisible.");
    else if (r.aucune || r.dates) dire("Aucune date prévue.");
    else {
      dire("Prochaines fois indisponibles pour le moment.");
      reessai = DELAI_REESSAI_CRON;
    }
    if (reessai !== null) minuteur = setTimeout(() => (saisie.isConnected ? demander(0) : null), reessai);
  }
  // Seule la réponse à la dernière requête s'affiche ; la zone garde son contenu jusqu'à elle.
  function demander(delai) {
    arreter();
    const expression = saisie.value.trim();
    numero++;
    if (!expression) {
      zone.replaceChildren();
      return;
    }
    const mien = numero;
    minuteur = setTimeout(async () => {
      minuteur = null;
      const r = await prochainesFoisCron(expression);
      if (mien === numero) afficher(r);
    }, delai);
  }
  saisie.addEventListener("input", () => demander(DELAI_FRAPPE_CRON));
  demander(0);
  return { ligne, zone };
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

const CODE_COULEUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// C-002, `codeCouleur` : pastille native pour la souris (hors Tab), puis le champ texte. Rien n'est vérifié pendant la frappe.
function champCodeCouleur({ libelle, valeur, erreur, desactive, n }) {
  const racine = document.createElement("div");
  racine.className = "champ champ-code-couleur";
  const rangee = document.createElement("div");
  rangee.className = "ya-code-couleur";
  const pastille = document.createElement("input");
  pastille.type = "color";
  pastille.className = "ya-pastille";
  pastille.tabIndex = -1;
  pastille.setAttribute("aria-label", `Choisir : ${libelle}`);
  const saisie = document.createElement("input");
  saisie.type = "text";
  saisie.id = `champ-${n}`;
  saisie.className = "ya-input ya-code-couleur-saisie";
  saisie.placeholder = "par défaut";
  saisie.spellcheck = false;
  saisie.setAttribute("autocomplete", "off");
  saisie.setAttribute("aria-label", libelle);
  saisie.value = valeur;
  const suivre = () => {
    const v = saisie.value;
    const valide = CODE_COULEUR.test(v);
    if (valide) pastille.value = v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase() : v.toLowerCase();
    pastille.classList.toggle("vide", !valide);
  };
  saisie.addEventListener("input", suivre);
  pastille.addEventListener("input", () => {
    saisie.value = pastille.value.toLowerCase();
    saisie.dispatchEvent(new Event("input", { bubbles: true }));
  });
  suivre();
  pastille.disabled = desactive;
  saisie.disabled = desactive;
  rangee.append(pastille, saisie);
  racine.append(rangee);
  if (erreur) {
    const e = document.createElement("div");
    e.className = "ya-grille-erreur";
    e.id = `champ-${n}-erreur`;
    e.setAttribute("role", "alert");
    e.textContent = erreur;
    saisie.setAttribute("aria-invalid", "true");
    saisie.setAttribute("aria-describedby", e.id);
    // Le message va sous la ligne de la grille : l'appelant le place (`racine.messageErreur`).
    racine.messageErreur = e;
  }
  return racine;
}

// C-002, `copie` : un texte prêt à copier en lecture seule (`<pre>`, sans tabindex) et son bouton « Copier ».
function champCopie({ libelle, valeur, aide, nomCopier, surCopie, n }) {
  if (!nomCopier?.startsWith("Copier")) throw new Error("champ : copie demande nomCopier, qui commence par « Copier »");
  if (typeof surCopie !== "function") throw new Error("champ : copie demande surCopie");
  const racine = document.createElement("div");
  racine.className = "champ ya-copie";
  racine.setAttribute("role", "group");
  racine.setAttribute("aria-labelledby", `champ-${n}-libelle`);
  const tete = document.createElement("div");
  tete.className = "ya-copie-tete";
  const nom = document.createElement("span");
  nom.className = "ya-copie-libelle";
  nom.id = `champ-${n}-libelle`;
  nom.textContent = libelle;
  const copier = bouton({ libelle: "Copier", variante: "secondaire", nomAccessible: nomCopier });
  copier.addEventListener("click", () => surCopie(valeur));
  tete.append(nom, copier);
  const pre = document.createElement("pre");
  pre.className = "ya-copie-texte";
  pre.textContent = valeur;
  racine.append(tete, pre);
  if (aide) {
    const a = document.createElement("div");
    a.className = "champ-aide";
    a.id = `champ-${n}-aide`;
    a.textContent = aide;
    copier.setAttribute("aria-describedby", a.id);
    racine.append(a);
  }
  return racine;
}
