// Export en PDF, partie navigateur (REQ-177, DEC-115) : charge `/pdf.js`, rassemble les images et les diagrammes du markdown,
// appelle `export-pdf.js`, télécharge le fichier, et dit l'attente ou l'échec par des toasts.
import { adresseApercu, jetonApercu, listerChemins } from "./api.js";
import { lire as lireCouleurs } from "./couleurs-markdown.js";
import { definitionMarkdown, definitionTexte, nomPdf } from "./export-pdf.js";
import { resoudreImage } from "./images-md.js";
import { jetonsMarkdown } from "./ui/apercu.js";
import { adresseDiagramme, chargerMermaid, dessinerTexte } from "./ui/diagramme.js";
import { afficher, retirer } from "./ui/toasts.js";

const COUPURE = "connexion perdue";
const ATTENTE = 1000;
const ECHELLE_DIAGRAMME = 2;

const coupure = () => new Error(COUPURE);
const estMarkdown = (chemin) => /\.(md|markdown)$/i.test(chemin);

let chargement = null;
function chargerPdf() {
  if (window.yaidePdf) return Promise.resolve(window.yaidePdf);
  if (chargement) return chargement;
  chargement = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/pdf.js";
    s.onload = () => resolve(window.yaidePdf);
    s.onerror = () => {
      s.remove();
      chargement = null;
      reject(coupure());
    };
    document.head.append(s);
  });
  return chargement;
}

// Valeurs claires des tokens, lues sur un élément en thème clair : le thème de Yaide ne change pas.
function tokensClairs() {
  const el = document.createElement("div");
  el.dataset.theme = "light";
  el.hidden = true;
  document.body.append(el);
  const style = getComputedStyle(el);
  const lire = (nom) => style.getPropertyValue(nom).trim();
  const valeurs = {
    ink: lire("--ink"),
    info: lire("--info"),
    apercuPage: lire("--apercu-page"),
    lineStrong: lire("--line-strong"),
    apercuFond: lire("--hover"), // `--apercu-fond` et `--apercu-entete` sont posés sur `:root` : ils gardent la valeur du thème courant
    apercuEntete: lire("--bg-400"),
  };
  el.remove();
  return valeurs;
}

// La CSP de Yaide n'autorise les images que de la page et en `data:` : pas d'adresse `blob:`.
const enAdresse = (blob) =>
  new Promise((resolve) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(lecteur.result);
    lecteur.readAsDataURL(blob);
  });

function chargerImage(adresse) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = adresse;
  });
}

// Image décodée → PNG `data:` ; `echelle` agrandit le dessin sans changer la taille annoncée.
function enPng(img, largeur, hauteur, echelle = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(largeur * echelle);
  canvas.height = Math.ceil(hauteur * echelle);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return { png: canvas.toDataURL("image/png"), largeur, hauteur };
}

function parcourir(jetons, visiter) {
  for (const t of jetons) {
    visiter(t);
    if (t.children) parcourir(t.children, visiter);
  }
}

// Images `![[nom]]` et diagrammes mermaid du document : `{ [clé]: { png, largeur, hauteur } }`. Ceux qui manquent ou ne se lisent pas restent du texte.
async function rassembler(chemin, texte) {
  const images = {};
  const noms = new Set();
  const dessins = new Set();
  parcourir(jetonsMarkdown(texte), (t) => {
    if (t.type === "image_md") noms.add(t.content);
    else if (t.type === "fence" && t.info.trim().split(/\s+/)[0] === "mermaid") dessins.add(t.content);
  });
  if (noms.size) {
    const [liste, jeton] = await Promise.all([listerChemins(), jetonApercu()]);
    if (liste.coupure || !jeton) throw coupure();
    if (!liste.chemins) throw new Error((liste.message ?? "erreur").replace(/\.$/, ""));
    for (const nom of noms) {
      const fichier = resoudreImage(nom, chemin, liste.chemins);
      if (!fichier) continue;
      let r;
      try {
        r = await fetch(adresseApercu(jeton, fichier), { credentials: "same-origin" });
      } catch {
        throw coupure();
      }
      if (!r.ok) continue;
      const img = await chargerImage(await enAdresse(await r.blob()));
      if (img) images[nom] = enPng(img, img.naturalWidth || 300, img.naturalHeight || 150);
    }
  }
  if (dessins.size) {
    let mermaid;
    try {
      mermaid = await chargerMermaid();
    } catch {
      throw coupure();
    }
    for (const source of dessins) {
      const d = await dessinerTexte(mermaid, source);
      const img = d && (await chargerImage(adresseDiagramme(d.svg)));
      if (img) images[source] = enPng(img, d.largeur, d.hauteur, ECHELLE_DIAGRAMME);
    }
  }
  return images;
}

async function definition(chemin, texte) {
  const nom = chemin.split("/").pop();
  const couleurs = tokensClairs();
  if (!estMarkdown(chemin)) return definitionTexte(texte, nom, couleurs.ink);
  const reglages = await lireCouleurs();
  if (reglages.coupure) throw coupure();
  const images = await rassembler(chemin, texte);
  return definitionMarkdown(texte, nom, { couleurs: { ...couleurs, reglees: reglages.clair ?? {} }, images });
}

function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

let enCours = false;

/**
 * Exporte `{ chemin, texte, focus }` (voir `pourExport` de l'éditeur) : un seul export à la fois, aucun message s'il réussit,
 * le toast « Export de … en PDF… » au bout d'une seconde, le toast d'échec sinon. Le focus revient dans l'éditeur.
 */
export async function exporterEnPdf(cible) {
  if (!cible || enCours) return;
  enCours = true;
  const { chemin, texte } = cible;
  const nom = chemin.split("/").pop();
  cible.focus();
  const minuteur = setTimeout(() => afficher({ texte: `Export de ${nom} en PDF…`, variante: "info", cause: "export", permanent: true }), ATTENTE);
  try {
    const pdf = await chargerPdf();
    const blob = await pdf.produire(await definition(chemin, texte), nom);
    telecharger(blob, nomPdf(chemin));
    clearTimeout(minuteur);
    retirer("export");
  } catch (e) {
    clearTimeout(minuteur);
    retirer("export");
    // `pdf.js` préfixe le nom de l'onglet à ses erreurs : le toast ne le montre pas.
    const raison = String(e?.message ?? "erreur").replace(`${nom} : `, "").replace(/\.$/, "");
    const texteErreur = raison === COUPURE ? "Export en PDF impossible : connexion perdue. Réessayez au retour." : `Export en PDF impossible : ${raison}. Réessayez.`;
    afficher({ texte: texteErreur, variante: "erreur", cause: "export" });
  } finally {
    enCours = false;
  }
}
