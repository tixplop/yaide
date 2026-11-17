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
