import { idLibre } from "../jdiag.js";
import { connecteurProche, connecteursAffiches } from "./tableau-calculs.js";
// Calculs purs sur le document d'un whiteboard (C-018) : plan des objets.

// Passe les objets de `ids` au-dessus (« premier ») ou au-dessous (« arriere ») de tous les objets de leur sorte.
// L'ordre relatif des objets déplacés est gardé ; si rien ne bouge, c'est le même document qui est rendu.
export function auPlan(doc, ids, sens) {
  if (sens !== "premier" && sens !== "arriere") throw new Error("auPlan : « premier » ou « arriere » attendu");
  let change = false;
  const liste = (objets) => {
    const deplaces = objets.filter((o) => ids.includes(o.id));
    const autres = objets.filter((o) => !ids.includes(o.id));
    const nouvelle = sens === "premier" ? [...autres, ...deplaces] : [...deplaces, ...autres];
    if (nouvelle.some((o, i) => o !== objets[i])) change = true;
    return nouvelle;
  };
  const boxes = liste(doc.boxes);
  const links = liste(doc.links);
  const arrows = doc.arrows ? liste(doc.arrows) : undefined;
  if (!change) return doc;
  return { ...doc, boxes, links, ...(arrows ? { arrows } : {}) };
}

// Ce que Ctrl+C garde : les boîtes et flèches libres de `ids`, et les liens dont les deux boîtes sont dans `ids`.
// Rien de tel (par exemple un lien seul) : `null`.
export function copier(doc, ids) {
  const boxes = doc.boxes.filter((b) => ids.includes(b.id));
  const arrows = (doc.arrows ?? []).filter((f) => ids.includes(f.id));
  if (boxes.length === 0 && arrows.length === 0) return null;
  const links = doc.links.filter((l) => ids.includes(l.from) && ids.includes(l.to) && boxes.some((b) => b.id === l.from) && boxes.some((b) => b.id === l.to));
  return structuredClone({ boxes, links, arrows });
}

// Ajoute la copie au document, décalée de 20 × n px, au premier plan, avec de nouveaux `id`.
// Rend le document et les `id` collés.
export function coller(doc, copie, n) {
  const d = 20 * n;
  let courant = { ...doc, boxes: [...doc.boxes], links: [...doc.links], arrows: [...(doc.arrows ?? [])] };
  const nouveaux = new Map();
  const ids = [];
  for (const b of copie.boxes) {
    const id = idLibre("b", courant);
    nouveaux.set(b.id, id);
    ids.push(id);
    courant.boxes.push({ ...structuredClone(b), id, x: b.x + d, y: b.y + d });
  }
  for (const l of copie.links) {
    const id = idLibre("l", courant);
    ids.push(id);
    courant.links.push({ ...structuredClone(l), id, from: nouveaux.get(l.from), to: nouveaux.get(l.to) });
  }
  for (const f of copie.arrows) {
    const id = idLibre("a", courant);
    ids.push(id);
    courant.arrows.push({ ...structuredClone(f), id, x1: f.x1 + d, y1: f.y1 + d, x2: f.x2 + d, y2: f.y2 + d });
  }
  return { doc: courant, ids };
}

// Rattache le départ (`bout` = "depart") ou l'arrivée (`"arrivee"`) du lien `idLien` au côté `cote` de la boîte `idBoite`.
// Le lien garde son `id`, son style et le côté de l'autre bout ; sans côté, l'autre bout prend celui dont le milieu est le
// plus proche du connecteur atteint. Rend le même document s'il n'y a rien à changer, ou si c'est refusé : boîte de l'autre
// bout, ou lien qui existe déjà dans ce sens.
export function rattacher(doc, idLien, bout, idBoite, cote) {
  if (bout !== "depart" && bout !== "arrivee") throw new Error("rattacher : « depart » ou « arrivee » attendu");
  const lien = doc.links.find((l) => l.id === idLien);
  const boite = doc.boxes.find((b) => b.id === idBoite);
  if (!lien || !boite || !connecteursAffiches(boite, Infinity)[cote]) return doc;
  const depart = bout === "depart";
  const idAutre = depart ? lien.to : lien.from;
  if (idBoite === idAutre) return doc;
  const from = depart ? idBoite : lien.from;
  const to = depart ? lien.to : idBoite;
  if (doc.links.some((l) => l.id !== idLien && l.from === from && l.to === to)) return doc;
  const autre = doc.boxes.find((b) => b.id === idAutre);
  const coteAutre = lien.fromSide && lien.toSide ? (depart ? lien.toSide : lien.fromSide) : connecteurProche(autre, connecteursAffiches(boite, Infinity)[cote]);
  const fromSide = depart ? cote : coteAutre;
  const toSide = depart ? coteAutre : cote;
  if (from === lien.from && to === lien.to && fromSide === lien.fromSide && toSide === lien.toSide) return doc;
  return { ...doc, links: doc.links.map((l) => (l.id === idLien ? { ...l, from, to, fromSide, toSide } : l)) };
}
