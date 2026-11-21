// Organigramme mermaid → document whiteboard (REQ-154, DEC-103). Fonction pure, sans dépendance.
import { TAILLES } from "./jdiag.js";

const AUTRES_TYPES = new Set([
  "sequenceDiagram", "classDiagram", "stateDiagram", "stateDiagram-v2", "erDiagram", "journey", "gantt", "pie",
  "quadrantChart", "requirementDiagram", "gitGraph", "C4Context", "mindmap", "timeline", "sankey-beta",
  "xychart-beta", "block-beta", "packet-beta", "architecture-beta", "kanban", "radar-beta",
]);
const IGNOREES = /^(subgraph|direction|classDef|class|style|linkStyle|click|accTitle|accDescr)(\s|$)/;
// Ouvrante, fermante, forme : les plus longues ouvrantes d'abord.
const FORMES = [
  ["(((", ")))", "rectangle"], ["((", "))", "ellipse"], ["([", "])", "rounded"], ["(", ")", "rounded"],
  ["[(", ")]", "database"], ["[[", "]]", "rectangle"], ["[/", "/]", "rectangle"], ["[/", "\\]", "rectangle"],
  ["[\\", "\\]", "rectangle"], ["[\\", "/]", "rectangle"], ["[", "]", "rectangle"], ["{{", "}}", "rectangle"],
  ["{", "}", "diamond"], [">", "]", "note"],
];
const ID = /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*/;
const TETE = "(>|o|x)?";

class Refus extends Error {}

// Sépare une ligne sur les `;` hors guillemets.
function instructions(ligne) {
  const sortie = [];
  let courant = "";
  let guillemets = false;
  for (const c of ligne) {
    if (c === '"') guillemets = !guillemets;
    if (c === ";" && !guillemets) {
      sortie.push(courant);
      courant = "";
    } else courant += c;
  }
  sortie.push(courant);
  return sortie.map((i) => i.trim()).filter((i) => i !== "");
}

function nettoyer(texte) {
  let t = texte.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return t.replace(/<br\s*\/?>/gi, "\n");
}

// Nœud au début de `s` → { id, forme, texte, reste } (forme et texte `null` sans forme), ou `null`.
function lireNoeud(s) {
  const m = ID.exec(s);
  if (!m) return null;
  const id = m[0];
  let reste = s.slice(id.length);
  let forme = null;
  let texte = null;
  for (const [ouvre, ferme, nom] of FORMES) {
    if (!reste.startsWith(ouvre)) continue;
    const corps = reste.slice(ouvre.length);
    let fin;
    if (corps.trimStart().startsWith('"')) {
      const debut = corps.indexOf('"');
      const quote = corps.indexOf('"', debut + 1);
      if (quote < 0 || !corps.slice(quote + 1).trimStart().startsWith(ferme)) continue;
      fin = corps.indexOf(ferme, quote + 1);
    } else fin = corps.indexOf(ferme);
    if (fin < 0) continue;
    texte = nettoyer(corps.slice(0, fin));
    forme = nom;
    reste = corps.slice(fin + ferme.length);
    break;
  }
  if (forme === null && /^[([{]/.test(reste)) throw new Refus();
  const classe = /^:::[A-Za-z0-9_-]+/.exec(reste);
  if (classe) reste = reste.slice(classe[0].length);
  return { id, forme, texte, reste };
}

// Lien au début de `s` → { reste, invisible } ou { reste, ends, line, weight, text }, ou `null`.
function lireLien(s) {
  if (s.startsWith("~~~")) return { invisible: true, reste: s.replace(/^~+/, "") };
  let m;
  let gauche = "";
  let droite;
  let line = "solid";
  let weight = "medium";
  let texte = "";
  let reste;
  if ((m = new RegExp(`^--\\s+(.+?)\\s+-{2,}${TETE}`).exec(s))) {
    [, texte, droite] = m;
  } else if ((m = new RegExp(`^-\\.\\s+(.+?)\\s+\\.+-${TETE}`).exec(s))) {
    [, texte, droite] = m;
    line = "dashed";
  } else if ((m = new RegExp(`^==\\s+(.+?)\\s+={2,}${TETE}`).exec(s))) {
    [, texte, droite] = m;
    weight = "thick";
  } else {
    const t = /^(<|o|x)?(-{2,}|-\.+-|={2,})(>|o|x)?/.exec(s);
    if (!t) return null;
    m = t;
    [, gauche, , droite] = t;
    if (t[2].startsWith("-.")) line = "dashed";
    if (t[2].startsWith("=")) weight = "thick";
    if (gauche && !droite) return null;
  }
  reste = s.slice(m[0].length);
  const barres = /^\s*\|([^|]*)\|/.exec(reste);
  if (barres) {
    texte = nettoyer(barres[1]);
    reste = reste.slice(barres[0].length);
  } else texte = nettoyer(texte);
  const ends = gauche && droite ? "both" : droite ? "end" : "none";
  return { reste, ends, line, weight, text: texte };
}

export function depuisMermaid(texte) {
  if (typeof texte !== "string") return null;
  const brutes = texte.split(/\r?\n/);
  let debut = 0;
  let fin = brutes.length;
  const vide = (l) => l.trim() === "";
  while (debut < fin && vide(brutes[debut])) debut++;
  while (fin > debut && vide(brutes[fin - 1])) fin--;
  if (debut >= fin) return null;
  if (fin - debut >= 2 && brutes[debut].trim() === "```mermaid" && brutes[fin - 1].trim() === "```") {
    debut++;
    fin--;
  }
  while (debut < fin && vide(brutes[debut])) debut++;
  while (fin > debut && vide(brutes[fin - 1])) fin--;
  const lignes = [];
  for (let i = debut; i < fin; i++) {
    const t = brutes[i].trim();
    if (t !== "" && !t.startsWith("%%")) lignes.push({ n: i + 1, t });
  }
  if (lignes.length === 0) return null;
  const mot = /^[^\s;]+/.exec(lignes[0].t)[0];
  if (AUTRES_TYPES.has(mot)) return { refus: "seuls les organigrammes (graph, flowchart) sont pris en charge." };
  if (mot !== "graph" && mot !== "flowchart") return null;
  const model = brutes.slice(debut, fin).join("\n");

  const noeuds = new Map();
  const liens = [];
  let direction = "TD";
  let n = 0;
  try {
    const noeud = (id, forme, texteNoeud) => {
      let o = noeuds.get(id);
      if (!o) noeuds.set(id, (o = { id, forme: "rectangle", texte: id }));
      if (forme !== null) {
        o.forme = forme;
        o.texte = texteNoeud === "" ? id : texteNoeud;
      }
    };
    lignes.forEach((ligne, k) => {
      n = ligne.n;
      const parties = instructions(ligne.t);
      parties.forEach((p, j) => {
        if (k === 0 && j === 0) {
          const m = /^(?:graph|flowchart)(?:\s+(TD|TB|BT|LR|RL))?$/.exec(p);
          if (!m) throw new Refus();
          direction = m[1] === "TB" || !m[1] ? "TD" : m[1];
          return;
        }
        if (IGNOREES.test(p) || p === "end") return;
        let reste = p;
        let precedents = null;
        let lien = null;
        for (;;) {
          const groupe = [];
          for (;;) {
            const nd = lireNoeud(reste);
            if (!nd) throw new Refus();
            noeud(nd.id, nd.forme, nd.texte);
            groupe.push(nd.id);
            reste = nd.reste.trimStart();
            if (!reste.startsWith("&")) break;
            reste = reste.slice(1).trimStart();
          }
          if (precedents && lien && !lien.invisible) {
            for (const de of precedents) {
              for (const vers of groupe) {
                if (de === vers || liens.some((l) => l.from === de && l.to === vers)) continue;
                liens.push({ from: de, to: vers, ends: lien.ends, line: lien.line, weight: lien.weight, text: lien.text });
              }
            }
          }
          if (reste === "") break;
          lien = lireLien(reste);
          if (!lien) throw new Refus();
          reste = lien.reste.trimStart();
          precedents = groupe;
        }
      });
    });
  } catch (e) {
    if (e instanceof Refus) return { refus: `la ligne ${n} n'est pas comprise.` };
    throw e;
  }
  if (noeuds.size === 0) return { refus: "il n'a aucun nœud." };

  // Rangs : plus long chemin, sans les liens qui ferment un cycle.
  const ordre = [...noeuds.keys()];
  const sortants = new Map(ordre.map((id) => [id, []]));
  for (const l of liens) sortants.get(l.from).push(l);
  const retour = new Set();
  const etat = new Map();
  const parcourir = (id) => {
    etat.set(id, 1);
    for (const l of sortants.get(id)) {
      const e = etat.get(l.to);
      if (e === 1) retour.add(l);
      else if (e === undefined) parcourir(l.to);
    }
    etat.set(id, 2);
  };
  for (const id of ordre) if (!etat.has(id)) parcourir(id);
  const entrants = new Map(ordre.map((id) => [id, []]));
  for (const l of liens) if (!retour.has(l)) entrants.get(l.to).push(l.from);
  const rangs = new Map();
  const rang = (id) => {
    if (!rangs.has(id)) rangs.set(id, entrants.get(id).reduce((m, p) => Math.max(m, rang(p) + 1), 0));
    return rangs.get(id);
  };
  ordre.forEach(rang);
  const nbRangs = Math.max(...rangs.values()) + 1;
  const parRang = Array.from({ length: nbRangs }, () => []);
  for (const id of ordre) parRang[rangs.get(id)].push(id);
  const K = Math.max(...parRang.map((r) => r.length));
  const inverse = direction === "BT" || direction === "RL";
  const horizontal = direction === "LR" || direction === "RL";

  const boxes = ordre.map((id, i) => {
    const o = noeuds.get(id);
    const [width, height] = TAILLES[o.forme];
    const r = rangs.get(id);
    const k = parRang[r].length;
    const rp = inverse ? nbRangs - 1 - r : r;
    const pos = parRang[r].indexOf(id) + (K - k) / 2;
    const [cx, cy] = horizontal ? [120 + 240 * rp, 90 + 180 * pos] : [120 + 240 * pos, 90 + 180 * rp];
    const boite = { id: `b${i + 1}`, x: cx - width / 2, y: cy - height / 2, width, height, text: o.texte };
    if (o.forme !== "rectangle") boite.shape = o.forme;
    return boite;
  });
  const idBoite = new Map(ordre.map((id, i) => [id, `b${i + 1}`]));
  const links = liens.map((l, i) => {
    const lien = { id: `l${i + 1}`, from: idBoite.get(l.from), to: idBoite.get(l.to) };
    if (l.ends !== "end") lien.ends = l.ends;
    if (l.line !== "solid") lien.line = l.line;
    if (l.weight !== "medium") lien.weight = l.weight;
    if (l.text !== "") lien.text = l.text;
    return lien;
  });
  return { doc: { version: 1, model, boxes, links, arrows: [] } };
}
