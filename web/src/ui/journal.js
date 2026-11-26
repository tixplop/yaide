import { bouton } from "./bouton.js";
import { champ } from "./champ.js";
import { icone } from "./icones.js";
import { indication } from "./indication.js";

// Console des logs (C-010, REQ-188) : filtres, tableau, états vides, défilement.
const SEVERITES = {
  information: { mot: "Information", icone: "info" },
  avertissement: { mot: "Avertissement", icone: "triangle-alert-plein" },
  erreur: { mot: "Erreur", icone: "circle-alert-plein" },
};
const OPTIONS = [{ valeur: "toutes", texte: "Toutes" }, ...Object.entries(SEVERITES).map(([valeur, s]) => ({ valeur, texte: s.mot }))];
const deuxChiffres = (n) => String(n).padStart(2, "0");

function heureLocale(ms) {
  const d = new Date(ms);
  return `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}:${deuxChiffres(d.getSeconds())}`;
}

// `lignes` : `{ numero, heure (ms), severite, message, detail? }`, la plus récente en dernier.
// `purger` : appelée au clic sur « Purger les logs » ; l'appelant vide ensuite le composant avec `remplacer([])`.
export function journal({ lignes = [], purger } = {}) {
  if (typeof purger !== "function") throw new Error("journal : purger requis");
  let toutes = [...lignes];
  const racine = document.createElement("div");
  racine.className = "ya-journal";

  const liste = champ({ libelle: "Sévérité", type: "liste", options: OPTIONS, presentation: "barre" });
  const filtre = champ({ libelle: "Filtrer", libelleMasque: true, indication: "Filtrer" });
  const select = liste.querySelector("select");
  const saisie = filtre.querySelector("input");
  liste.classList.add("ya-journal-severite");
  filtre.classList.add("ya-journal-filtre");
  const btnPurger = bouton({ libelle: "Purger les logs" });
  btnPurger.classList.add("ya-journal-purger");
  btnPurger.addEventListener("click", () => purger());

  const barre = document.createElement("div");
  barre.className = "ya-journal-barre";
  barre.append(liste, filtre, btnPurger);

  const zone = document.createElement("div");
  zone.className = "ya-journal-zone";
  zone.tabIndex = 0;
  zone.setAttribute("role", "region");
  zone.setAttribute("aria-label", "Logs");
  racine.append(barre, zone);

  const enBas = () => zone.scrollHeight - zone.scrollTop - zone.clientHeight <= 1;
  const descendre = () => {
    zone.scrollTop = zone.scrollHeight;
  };

  const passe = (l) => {
    if (select.value !== "toutes" && l.severite !== select.value) return false;
    const t = saisie.value.toLocaleLowerCase();
    return !t || l.message.toLocaleLowerCase().includes(t) || (l.detail ?? "").toLocaleLowerCase().includes(t);
  };

  const table = document.createElement("table");
  table.className = "ya-journal-table";
  const cols = document.createElement("colgroup");
  for (const c of ["heure", "sev", "message"]) {
    const col = document.createElement("col");
    col.className = `ya-journal-col-${c}`;
    cols.append(col);
  }
  const tete = document.createElement("thead");
  const trTete = document.createElement("tr");
  for (const t of ["Heure", "Sévérité", "Message"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = t;
    trTete.append(th);
  }
  tete.append(trTete);
  const corps = document.createElement("tbody");
  table.append(cols, tete, corps);
  zone.append(table);

  function rangee(l) {
    const s = SEVERITES[l.severite] ?? SEVERITES.information;
    const tr = document.createElement("tr");
    const h = document.createElement("td");
    h.className = "ya-journal-heure";
    h.textContent = heureLocale(l.heure);
    const sv = document.createElement("td");
    sv.className = `ya-journal-sev ya-journal-sev-${l.severite}`;
    const mot = document.createElement("span");
    mot.textContent = s.mot;
    sv.append(icone(s.icone, 14), mot);
    const m = document.createElement("td");
    m.className = "ya-journal-message";
    const texte = document.createElement("span");
    texte.textContent = l.message;
    m.append(texte);
    if (l.detail) {
      const pre = document.createElement("pre");
      pre.textContent = l.detail;
      m.append(pre);
    }
    tr.append(h, sv, m);
    return tr;
  }

  // Sous les en-têtes, toujours dessinés : les lignes, ou le texte du vide.
  function dessiner() {
    const visibles = toutes.filter(passe);
    if (visibles.length) return corps.replaceChildren(...visibles.map(rangee));
    const tr = document.createElement("tr");
    tr.className = "ya-journal-vide";
    const td = document.createElement("td");
    td.colSpan = 3;
    td.append(indication({ texte: toutes.length ? "Aucun log ne correspond aux filtres." : "Aucun log." }));
    tr.append(td);
    corps.replaceChildren(tr);
  }

  function ajouter(ligne) {
    toutes.push(ligne);
    if (!passe(ligne)) return;
    const suit = enBas();
    if (corps.querySelector(".ya-journal-vide")) dessiner();
    else corps.append(rangee(ligne));
    if (suit) descendre();
  }

  function remplacer(nouvelles) {
    toutes = [...nouvelles];
    dessiner();
    descendre();
  }

  function filtrer() {
    dessiner();
    descendre();
  }
  select.addEventListener("change", filtrer);
  saisie.addEventListener("input", filtrer);

  racine.ajouter = ajouter;
  racine.remplacer = remplacer;
  // Hors du DOM la zone n'a pas de hauteur : le cadre appelle `descendre` une fois le composant monté.
  racine.descendre = descendre;
  racine.focusFiltre = () => saisie.focus();
  dessiner();
  requestAnimationFrame(descendre);
  return racine;
}
