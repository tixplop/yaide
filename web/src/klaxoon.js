// Copie d'une sélection de whiteboard au format Klaxoon (REQ-155, DEC-104) : fonction pure, sans DOM ni réseau.
import modele from "./klaxoon-modele.json";

const echapper = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const echapperAttribut = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const base64Utf8 = (s) => {
  let binaire = "";
  for (const o of new TextEncoder().encode(s)) binaire += String.fromCharCode(o);
  return btoa(binaire);
};

// Côtés du lien : horizontal si |dx| >= |dy|, d'après les centres des deux boîtes.
function cotes(de, vers) {
  const dx = vers.x + vers.width / 2 - (de.x + de.width / 2);
  const dy = vers.y + vers.height / 2 - (de.y + de.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

// `{ texte, html, boites, liens }` pour les objets `ids` de `doc`, ou `null` sans boîte choisie.
export function versKlaxoon(doc, ids, uuid = () => crypto.randomUUID()) {
  const choisis = new Set(ids);
  const boites = doc.boxes.filter((b) => choisis.has(b.id));
  if (boites.length === 0) return null;
  const liens = doc.links.filter((l) => choisis.has(l.from) && choisis.has(l.to) && boites.some((b) => b.id === l.from) && boites.some((b) => b.id === l.to));
  const tete = uuid();
  const source = uuid();
  const parents = new Map();
  const entrees = [];
  const contenus = [];
  boites.forEach((b, i) => {
    const data = structuredClone(modele.postit);
    const contenu = b.text.split("\n").map((l) => `<p>${echapper(l)}</p>`).join("");
    parents.set(b.id, uuid());
    data.coords = { left: b.x, top: b.y };
    data.zIndex = i + 1;
    data.contentHtml = contenu;
    data.parent = parents.get(b.id);
    data.sourceActivityUuid = source;
    contenus.push(contenu);
    entrees.push({ type: "postit", data });
  });
  for (const l of liens) {
    const data = structuredClone(modele.link);
    data.objectIds = [parents.get(l.from), parents.get(l.to)];
    data.objectAnchors = cotes(boites.find((b) => b.id === l.from), boites.find((b) => b.id === l.to));
    data.parent = uuid();
    data.sourceActivityUuid = source;
    entrees.push({ type: "link", data });
  }
  const html = `<div data-board="${echapperAttribut(tete + base64Utf8(JSON.stringify(entrees)))}">${contenus.join("<br>")}</div>`;
  return { texte: boites.map((b) => b.text).join("\n"), html, boites: boites.length, liens: liens.length };
}
