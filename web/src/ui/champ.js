const TYPES = ["texte", "motDePasse", "secret", "multiligne", "liste", "case"];
const CLAVIERS = { numerique: "numeric", decimal: "decimal" };
let compteur = 0;

export function champ({ libelle, type = "texte", valeur = "", options = [], indication, aide, erreur, libelleMasque = false, desactive = false, clavier }) {
  if (!libelle) throw new Error("champ : libelle requis");
  if (!TYPES.includes(type)) throw new Error(`champ : type inconnu « ${type} »`);
  if (clavier !== undefined && !(clavier in CLAVIERS)) throw new Error(`champ : clavier inconnu « ${clavier} »`);
  const n = ++compteur;
  const racine = document.createElement("div");
  racine.className = type === "case" ? "champ ya-case" : "champ";

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
  if (aide) {
    const a = document.createElement("div");
    a.className = "champ-aide";
    a.id = `champ-${n}-aide`;
    a.textContent = aide;
    decrit.push(a.id);
    racine.append(a);
  }
  if (erreur) {
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
