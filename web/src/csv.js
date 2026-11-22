// Lecture et écriture des fichiers CSV (REQ-157) : fonctions pures sur le texte.
// Chaque modification ne touche que les octets concernés du texte source.

// Au-delà de 2 000 rangées le tableur n'est pas affiché (REQ-157) : la page reste fluide, sans grille partielle.
const MAX_RANGEES = 2000;

function separateurDe(texte) {
  let virgules = 0;
  let pointsVirgules = 0;
  let dansGuillemets = false;
  for (const c of texte) {
    if (c === '"') dansGuillemets = !dansGuillemets;
    else if (c === "\n" && !dansGuillemets) break;
    else if (!dansGuillemets && c === ",") virgules++;
    else if (!dansGuillemets && c === ";") pointsVirgules++;
  }
  return pointsVirgules > virgules ? ";" : ",";
}

const ligneDe = (texte, pos) => texte.slice(0, pos).split("\n").length;
const longueurFin = (texte, i) => (texte[i] === "\n" ? 1 : texte[i] === "\r" && texte[i + 1] === "\n" ? 2 : 0);

// Lit le texte : { separateur, finLigne, colonnes, texte, rangees } ou { refus }.
// Une rangée : { de, a (fin du contenu), suite (début de la rangée suivante), champs }, complétée jusqu'à
// `colonnes` champs. Un champ : { texte (affiché), de, a, guillemets, manque }.
export function lireCsv(texte) {
  const separateur = separateurDe(texte);
  const rangees = [];
  let i = 0;
  do {
    if (rangees.length >= MAX_RANGEES) return { refus: "plus de 2 000 lignes." };
    const rangee = { de: i, champs: [] };
    for (;;) {
      const de = i;
      const guillemets = texte[i] === '"';
      let valeur = "";
      if (guillemets) {
        let j = i + 1;
        for (;;) {
          const k = texte.indexOf('"', j);
          if (k < 0) return { refus: `guillemet non fermé à la ligne ${ligneDe(texte, de)}.` };
          valeur += texte.slice(j, k);
          if (texte[k + 1] === '"') {
            valeur += '"';
            j = k + 2;
          } else {
            i = k + 1;
            break;
          }
        }
      }
      const reste = i;
      while (i < texte.length && texte[i] !== separateur && !longueurFin(texte, i)) i++;
      valeur += texte.slice(reste, i);
      rangee.champs.push({ texte: valeur, de, a: i, guillemets, manque: false });
      if (texte[i] === separateur) {
        i++;
        continue;
      }
      break;
    }
    rangee.a = i;
    i += longueurFin(texte, i);
    rangee.suite = i;
    rangees.push(rangee);
  } while (i < texte.length);
  const colonnes = Math.max(...rangees.map((r) => r.champs.length));
  for (const r of rangees) while (r.champs.length < colonnes) r.champs.push({ texte: "", de: r.a, a: r.a, guillemets: false, manque: true });
  const premiere = rangees[0];
  const finLigne = texte.slice(premiere.a, premiere.suite) || "\n";
  return { separateur, finLigne, colonnes, texte, rangees };
}

function encoder(valeur, separateur, entreGuillemets) {
  const besoin = entreGuillemets || valeur.includes(separateur) || /["\r\n]/.test(valeur) || /^\s|\s$/.test(valeur);
  return besoin ? `"${valeur.replaceAll('"', '""')}"` : valeur;
}

// Une seule modification { from, to, insert } qui couvre de la première à la dernière zone touchée.
function modification(lecture, edits) {
  if (!edits.length) return { from: 0, to: 0, insert: "" };
  const tri = [...edits].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const from = tri[0][0];
  const to = Math.max(...tri.map((e) => e[1]));
  let insert = "";
  let pos = from;
  for (const [de, a, ajout] of tri) {
    insert += lecture.texte.slice(pos, de) + ajout;
    pos = a;
  }
  return { from, to, insert: insert + lecture.texte.slice(pos, to) };
}

// Les champs qui manquent sont de fin de rangée : on y ajoute les séparateurs nécessaires.
export function changerCellule(lecture, r, c, valeur) {
  const rangee = lecture.rangees[r];
  const champ = rangee.champs[c];
  if (!champ.manque) return modification(lecture, [[champ.de, champ.a, encoder(valeur, lecture.separateur, champ.guillemets)]]);
  const reels = rangee.champs.filter((f) => !f.manque).length;
  const separateurs = lecture.separateur.repeat(c - reels + 1);
  return modification(lecture, [[rangee.a, rangee.a, separateurs + encoder(valeur, lecture.separateur, false)]]);
}

// Insère une colonne vide avant la colonne k (k = colonnes : après la dernière).
export function insererColonne(lecture, k) {
  const edits = [];
  for (const rangee of lecture.rangees) {
    const reels = rangee.champs.filter((f) => !f.manque).length;
    if (reels > k) edits.push([rangee.champs[k].de, rangee.champs[k].de, lecture.separateur]);
    else if (reels === k && k === lecture.colonnes) edits.push([rangee.a, rangee.a, lecture.separateur]);
  }
  return modification(lecture, edits);
}

export function supprimerColonne(lecture, k) {
  const edits = [];
  for (const { champs } of lecture.rangees) {
    const reels = champs.filter((f) => !f.manque);
    if (reels.length <= k) continue;
    if (k < reels.length - 1) edits.push([reels[k].de, reels[k + 1].de, ""]);
    else if (k > 0) edits.push([reels[k - 1].a, reels[k].a, ""]);
    else edits.push([reels[0].de, reels[0].a, ""]);
  }
  return modification(lecture, edits);
}

// Insère une rangée vide avant la rangée p (p = nombre de rangées : après la dernière).
export function insererRangee(lecture, p) {
  const { texte, finLigne } = lecture;
  const vide = lecture.separateur.repeat(lecture.colonnes - 1);
  if (texte === "") return { from: 0, to: 0, insert: finLigne + finLigne };
  if (p < lecture.rangees.length) {
    const de = lecture.rangees[p].de;
    return { from: de, to: de, insert: vide + finLigne };
  }
  const finale = texte.endsWith("\n");
  // Une rangée vide d'une seule colonne a besoin de son propre saut de ligne pour être comptée.
  const termine = finale || lecture.colonnes === 1;
  return { from: texte.length, to: texte.length, insert: (finale ? "" : finLigne) + vide + (termine ? finLigne : "") };
}

export function supprimerRangee(lecture, p) {
  const r = lecture.rangees[p];
  if (r.suite === r.a && p > 0) return { from: lecture.rangees[p - 1].a, to: r.a, insert: "" };
  return { from: r.de, to: r.suite, insert: "" };
}

// Position du début du champ dans le texte (la fin de la rangée pour un champ qui manque).
export function debutChamp(lecture, r, c) {
  return lecture.rangees[r].champs[c].de;
}

// Rangée et colonne du champ qui contient la position.
export function celluleA(lecture, pos) {
  let r = 0;
  lecture.rangees.forEach((rangee, i) => {
    if (rangee.de <= pos) r = i;
  });
  let c = 0;
  lecture.rangees[r].champs.forEach((champ, i) => {
    if (!champ.manque && champ.de <= pos) c = i;
  });
  return { r, c };
}
