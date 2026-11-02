const TYPES = ["texte", "motDePasse", "multiligne", "liste"];
let compteur = 0;

export function champ({ libelle, type = "texte", valeur = "", options = [], aide, erreur, libelleMasque = false, desactive = false }) {
  if (!libelle) throw new Error("champ : libelle requis");
  if (!TYPES.includes(type)) throw new Error(`champ : type inconnu « ${type} »`);
  const n = ++compteur;
  const racine = document.createElement("div");
  racine.className = "champ";

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
  } else {
    saisie = document.createElement("input");
    saisie.type = type === "motDePasse" ? "password" : "text";
    if (type === "motDePasse") saisie.setAttribute("autocomplete", "current-password");
    saisie.value = valeur;
  }
  if (type === "texte" || type === "multiligne") saisie.spellcheck = false;
  saisie.id = `champ-${n}`;
  saisie.className = "champ-saisie";
  saisie.disabled = desactive;

  const decrit = [];
  racine.append(label, saisie);
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
