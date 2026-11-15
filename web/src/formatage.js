
// Vrai pour les langages que `formater` sait mettre en forme.
export function formatable(langage) {
  return langage === "json" || langage === "xml";
}

// Rend { texte } ou { erreur: "json" | "xml" } ; seuls les blancs entre éléments changent.
export function formater(texte, langage) {
  if (langage === "json") return formaterJson(texte);
  if (langage === "xml") return formaterXml(texte);
  throw new Error(`formatage non pris en charge pour « ${langage} »`);
}

const PAS = "  ";

function formaterJson(texte) {
  try {
    JSON.parse(texte);
  } catch {
    return { erreur: "json" };
  }
  const jetons = texte.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:"]+/g);
  let sortie = "";
  let profondeur = 0;
  const ligne = () => "\n" + PAS.repeat(profondeur);
  for (let i = 0; i < jetons.length; i++) {
    const j = jetons[i];
    if (j === "{" || j === "[") {
      const fin = j === "{" ? "}" : "]";
      if (jetons[i + 1] === fin) {
        sortie += j + fin;
        i++;
      } else {
        profondeur++;
        sortie += j + ligne();
      }
    } else if (j === "}" || j === "]") {
      profondeur--;
      sortie += ligne() + j;
    } else if (j === ",") sortie += "," + ligne();
    else if (j === ":") sortie += ": ";
    else sortie += j;
  }
  return { texte: sortie + "\n" };
}

function fin(src, i, marque) {
  return src.indexOf(marque, i) + marque.length;
}

// Fin d'une balise ou d'un DOCTYPE : premier `>` hors guillemets et hors crochets.
function finBalise(src, i) {
  let q = null;
  let crochets = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "[") crochets++;
    else if (c === "]") crochets--;
    else if (c === ">" && crochets === 0) return k + 1;
  }
  return src.length;
}

function formaterXml(texte) {
  const doc = new DOMParser().parseFromString(texte, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return { erreur: "xml" };

  const racine = { enfants: [] };
  const pile = [racine];
  let i = 0;
  while (i < texte.length) {
    const parent = pile[pile.length - 1];
    let fini;
    let type;
    if (texte.startsWith("<!--", i)) [type, fini] = ["feuille", fin(texte, i, "-->")];
    else if (texte.startsWith("<![CDATA[", i)) [type, fini] = ["texte", fin(texte, i, "]]>")];
    else if (texte.startsWith("<?", i)) [type, fini] = ["feuille", fin(texte, i, "?>")];
    else if (texte.startsWith("<!", i)) [type, fini] = ["feuille", finBalise(texte, i)];
    else if (texte.startsWith("</", i)) {
      fini = finBalise(texte, i);
      const el = pile.pop();
      el.fermeture = i;
      el.fin = fini;
      i = fini;
      continue;
    } else if (texte[i] === "<") {
      fini = finBalise(texte, i);
      const ouverture = texte.slice(i, fini);
      if (ouverture.endsWith("/>")) {
        parent.enfants.push({ type: "feuille", debut: i, fin: fini });
      } else {
        const el = { type: "element", debut: i, ouvertureFin: fini, enfants: [] };
        parent.enfants.push(el);
        pile.push(el);
      }
      i = fini;
      continue;
    } else {
      const suivant = texte.indexOf("<", i);
      fini = suivant < 0 ? texte.length : suivant;
      type = texte.slice(i, fini).trim() === "" ? "blanc" : "texte";
    }
    if (type !== "blanc") parent.enfants.push({ type, debut: i, fin: fini });
    i = fini;
  }

  const lignes = [];
  const ecrire = (n, p) => {
    const marge = PAS.repeat(p);
    const brut = (a, b) => marge + texte.slice(a, b);
    if (n.type !== "element") return lignes.push(brut(n.debut, n.fin));
    const simple = n.enfants.length === 0 || n.enfants.some((e) => e.type === "texte");
    if (simple) return lignes.push(brut(n.debut, n.fin));
    lignes.push(brut(n.debut, n.ouvertureFin));
    for (const e of n.enfants) ecrire(e, p + 1);
    lignes.push(brut(n.fermeture, n.fin));
  };
  for (const n of racine.enfants) ecrire(n, 0);
  return { texte: lignes.join("\n") + "\n" };
}
