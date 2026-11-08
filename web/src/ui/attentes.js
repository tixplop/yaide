import { bouton } from "./bouton.js";
import { champ } from "./champ.js";
import { message } from "./message.js";

// C-015 `attentes` : les demandes d'opencode qui attendent une réponse, dans l'ordre d'arrivée.
// `surAutorisation(id, decision)`, `surReponse(id, reponse)` et `surIgnorer(id)` rendent le résultat de `opencode.js`
// (`{ donnees }`, `{ disparue }`, `{ coupure }` ou `{ erreur }`). Une réponse réussie ne retire pas la demande :
// `mettreAJour(demandes)` le fait, quand l'appelant a la nouvelle liste.

const DECISIONS = [
  { cle: "once", libelle: "Autoriser une fois" },
  { cle: "always", libelle: "Toujours autoriser" },
  { cle: "reject", libelle: "Refuser" },
];
const NOMBRE = /^[-+]?(\d+\.?\d*|\.\d+)$/;
const ENTIER = /^[-+]?\d+$/;

const borne = (v) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

// --- Champs d'une question -----------------------------------------------------------------------

const valeurDeDepart = (f) => {
  if (f.type === "boolean") return Boolean(f.default);
  if (f.type === "multiselect") return [...(f.default ?? [])];
  return f.default === undefined ? "" : String(f.default);
};

function construireChamp(f, brut, erreur) {
  const libelle = `${f.title || f.key}${f.required ? " (obligatoire)" : ""}`;
  const aide = f.description;
  let el;
  if (f.type === "boolean") {
    el = champ({ libelle, type: "case", valeur: brut, aide, erreur });
  } else if (f.type === "multiselect") {
    el = document.createElement("fieldset");
    el.className = "champ";
    const legende = document.createElement("legend");
    legende.className = "champ-libelle";
    legende.textContent = libelle;
    const cases = document.createElement("div");
    cases.className = "ya-cases";
    for (const o of f.options ?? []) {
      const c = champ({ libelle: o.label ?? o.value, type: "case", valeur: brut.includes(o.value) });
      c.querySelector("input").value = o.value;
      cases.append(c);
    }
    el.append(legende, cases);
    if (aide) el.append(texteChamp("champ-aide", aide));
    if (erreur) {
      for (const i of el.querySelectorAll("input")) i.setAttribute("aria-invalid", "true");
      const e = texteChamp("champ-erreur", erreur);
      e.setAttribute("role", "alert");
      el.append(e);
    }
  } else if (f.type === "external") {
    el = document.createElement("div");
    el.className = "champ";
    const texte = f.title || f.url;
    if (urlWeb(f.url)) {
      const lien = document.createElement("a");
      lien.className = "ya-lien";
      lien.href = f.url;
      lien.target = "_blank";
      lien.rel = "noopener noreferrer";
      lien.textContent = texte;
      el.append(lien);
    } else {
      // Ni javascript: ni data: : l'adresse reste du texte.
      el.append(texteChamp("champ-libelle", f.url));
    }
    el.append(texteChamp("champ-aide", "S'ouvre dans un nouvel onglet du navigateur."));
  } else if (f.type === "string" && f.options?.length) {
    const valeurs = f.options.map((o) => o.value);
    el = champ({ libelle, type: "liste", options: f.required ? valeurs : ["", ...valeurs], valeur: brut, aide, erreur });
    for (const opt of el.querySelectorAll("option")) {
      const o = f.options.find((x) => x.value === opt.value);
      if (o) opt.textContent = o.label;
    }
  } else {
    const clavier = f.type === "number" ? "decimal" : f.type === "integer" ? "numerique" : undefined;
    el = champ({ libelle, valeur: brut, indication: f.placeholder, clavier, aide, erreur });
  }
  el.dataset.cle = f.key;
  return el;
}

function urlWeb(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function texteChamp(classe, texte) {
  const d = document.createElement("div");
  d.className = classe;
  d.textContent = texte;
  return d;
}

function lire(f, el) {
  if (f.type === "multiselect") return [...el.querySelectorAll("input:checked")].map((i) => i.value);
  if (f.type === "boolean") return el.querySelector("input").checked;
  if (f.type === "external") return true;
  return el.querySelector("input, select").value;
}

function conforme(w, brut) {
  const egal = Array.isArray(brut) ? brut.includes(String(w.value)) : String(brut) === String(w.value);
  return w.op === "neq" ? !egal : egal;
}

// Rend `{ erreur }` ou `{ omis }` ou `{ valeur }`.
function valider(f, brut) {
  const obligatoire = { erreur: "Ce champ est obligatoire." };
  switch (f.type) {
    case "boolean":
      return { valeur: brut };
    case "external":
      return { valeur: true };
    case "multiselect": {
      if (!brut.length) return f.required ? obligatoire : { omis: true };
      if (f.minItems !== undefined && brut.length < f.minItems) return { erreur: `Choisissez au moins ${pluriel(f.minItems, "option")}.` };
      if (f.maxItems !== undefined && brut.length > f.maxItems) return { erreur: `Choisissez au plus ${pluriel(f.maxItems, "option")}.` };
      return { valeur: brut };
    }
    case "number":
    case "integer": {
      const s = brut.trim().replace(",", ".");
      if (!s) return f.required ? obligatoire : { omis: true };
      if (!(f.type === "integer" ? ENTIER : NOMBRE).test(s)) return { erreur: f.type === "integer" ? "Saisissez un nombre entier." : "Saisissez un nombre." };
      const n = Number(s);
      const min = borne(f.minimum);
      const max = borne(f.maximum);
      if (min !== undefined && max !== undefined && (n < min || n > max)) return { erreur: `Saisissez un nombre entre ${min} et ${max}.` };
      if (min !== undefined && n < min) return { erreur: `Saisissez un nombre d'au moins ${min}.` };
      if (max !== undefined && n > max) return { erreur: `Saisissez un nombre d'au plus ${max}.` };
      return { valeur: n };
    }
    default: {
      if (!brut.trim()) return f.required ? obligatoire : { omis: true };
      if (f.minLength !== undefined && brut.length < f.minLength) return { erreur: `Ce champ attend au moins ${pluriel(f.minLength, "caractère")}.` };
      if (f.maxLength !== undefined && brut.length > f.maxLength) return { erreur: `Ce champ attend au plus ${pluriel(f.maxLength, "caractère")}.` };
      return { valeur: brut };
    }
  }
}

// --- Une demande ---------------------------------------------------------------------------------

// Les boutons d'une demande : `enCours` est la clé du bouton « Envoi… », les autres sont désactivés.
function boutons(zone, defs, enCours, surClic) {
  zone.replaceChildren(
    ...defs.map((d) => {
      const b = bouton({ libelle: d.libelle, variante: "secondaire", libelleEnCours: enCours === d.cle ? "Envoi…" : undefined, desactive: enCours !== null });
      b.addEventListener("click", () => surClic(d.cle));
      return b;
    }),
  );
}

// Envoie une réponse : le bouton passe en cours ; en cas d'échec, l'erreur s'affiche sous les boutons.
function pilote(racine, zone, defs, agir, avant) {
  let erreur = null;
  const clic = async (cle) => {
    erreur?.remove();
    erreur = null;
    if (avant?.(cle) === false) return;
    boutons(zone, defs, cle, clic);
    let r;
    try {
      r = await agir(cle);
    } catch (e) {
      r = { erreur: e?.message || "erreur inconnue" };
    }
    if (!r?.coupure && !r?.erreur) return; // réussi : l'appelant retire la demande
    boutons(zone, defs, null, clic);
    erreur = message({ variante: "erreur", texte: r.coupure ? "Connexion perdue. Réessayez au retour." : `Réponse impossible : ${r.erreur}.` });
    racine.append(erreur);
  };
  boutons(zone, defs, null, clic);
  return clic;
}

function zoneActions() {
  const z = document.createElement("div");
  z.className = "message-actions";
  return z;
}

function creerAutorisation(d, rappels) {
  const racine = document.createElement("div");
  racine.className = "ya-attente";
  const qui = d.sousAgent === undefined ? "opencode" : `Le sous-agent${d.sousAgent ? ` ${d.sousAgent}` : ""}`;
  const m = message({ variante: "alerte", texte: `${qui} demande une autorisation : ${d.action}.`, detail: (d.ressources ?? []).join("\n") || undefined });
  const zone = zoneActions();
  m.append(zone);
  racine.append(m);
  pilote(racine, zone, DECISIONS, (cle) => rappels.surAutorisation?.(d.id, cle));
  return { noeud: racine };
}

function creerQuestion(d, rappels) {
  const racine = document.createElement("div");
  racine.className = "ya-attente";
  const champs = (d.champs ?? [])
    .filter((f) => !f.hidden)
    .map((f) => ({ f, brut: valeurDeDepart(f), erreur: null, el: null, cache: false }));
  for (const c of champs) c.el = construireChamp(c.f, c.brut, null);

  // Un champ caché garde sa valeur de départ pour les conditions `when`.
  const caches = (d.champs ?? []).filter((f) => f.hidden);
  const brutes = () => ({ ...Object.fromEntries(caches.map((f) => [f.key, valeurDeDepart(f)])), ...Object.fromEntries(champs.map((c) => [c.f.key, lire(c.f, c.el)])) });
  const majVisibilite = () => {
    const valeurs = brutes();
    for (const c of champs) {
      c.cache = !(c.f.when ?? []).every((w) => conforme(w, valeurs[w.key] ?? ""));
      c.el.hidden = c.cache;
    }
  };

  const defs = [
    { cle: "ignorer", libelle: "Ignorer" },
    { cle: "repondre", libelle: "Répondre" },
  ];
  const m = message({ variante: "info", texte: `opencode pose une question : ${d.titre}.`, champs: champs.map((c) => c.el) });
  const zone = zoneActions();
  m.append(zone);
  racine.append(m);
  majVisibilite();
  m.addEventListener("input", majVisibilite);
  m.addEventListener("change", majVisibilite);

  // Pose ou retire l'erreur d'un champ en le reconstruisant avec sa saisie.
  const poserErreur = (c, erreur) => {
    if (c.erreur === erreur) return;
    const neuf = construireChamp(c.f, lire(c.f, c.el), erreur);
    neuf.hidden = c.cache;
    c.el.replaceWith(neuf);
    c.el = neuf;
    c.erreur = erreur;
  };

  const repondre = () => {
    const reponse = {};
    let premier = null;
    for (const c of champs) {
      const r = c.cache ? { omis: true } : valider(c.f, lire(c.f, c.el));
      poserErreur(c, r.erreur ?? null);
      if (r.erreur) premier ??= c;
      else if (!r.omis) reponse[c.f.key] = r.valeur;
    }
    if (premier) {
      premier.el.querySelector("input, select")?.focus();
      return null;
    }
    return reponse;
  };

  let reponse = null;
  pilote(
    racine,
    zone,
    defs,
    (cle) => (cle === "ignorer" ? rappels.surIgnorer?.(d.id) : rappels.surReponse?.(d.id, reponse)),
    (cle) => {
      if (cle === "ignorer") return true;
      reponse = repondre();
      return reponse !== null;
    },
  );
  return { noeud: racine };
}

export function attentes({ demandes = [], surAutorisation, surReponse, surIgnorer } = {}) {
  const region = document.createElement("div");
  region.className = "ya-attentes";
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", "Demandes d'opencode");
  const rappels = { surAutorisation, surReponse, surIgnorer };
  const entrees = new Map();

  region.mettreAJour = (liste) => {
    const ids = new Set(liste.map((d) => d.id));
    for (const [id, e] of entrees) {
      if (!ids.has(id)) {
        e.noeud.remove();
        entrees.delete(id);
      }
    }
    liste.forEach((d, i) => {
      let e = entrees.get(d.id);
      if (!e) {
        e = d.type === "question" ? creerQuestion(d, rappels) : creerAutorisation(d, rappels);
        entrees.set(d.id, e);
      }
      if (region.children[i] !== e.noeud) region.insertBefore(e.noeud, region.children[i] ?? null);
    });
  };
  region.mettreAJour(demandes);
  return region;
}
