import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { ouvrirConfiguration } from "./configuration.js";
import { PALETTES } from "../ui/palettes.js";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  Element.prototype.scrollIntoView ??= function () {};
});

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
});

const attendre = () => new Promise((r) => setTimeout(r, 0));

/** Faux serveur : `markdown` est le fichier `.yaide/markdown.json` (texte, `Error` ou réponse brute). */
function faux({ markdown } = {}) {
  const etat = { ecritures: [], requetes: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, opts = {}) => {
      etat.requetes.push([String(url), opts.method ?? "GET"]);
      if (opts.method === "PUT") etat.ecritures.push(opts.body);
      if (String(url).includes("markdown.json") && !opts.method) {
        if (typeof markdown === "string") return { ok: true, status: 200, text: async () => markdown, headers: { get: () => "v1" } };
        if (markdown instanceof Error) throw markdown;
      }
      return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "Fichier introuvable." }) };
    }),
  );
  return etat;
}

const dlg = () => document.querySelector("dialog");
const onglet = (nom) => [...dlg().querySelectorAll("[role=tab]")].find((t) => t.textContent === nom);
const bouton = (nom) => [...dlg().querySelectorAll("button")].find((b) => b.textContent === nom);
const saisie = (nom) => dlg().querySelector(`input[type=text][aria-label="${nom}"]`);
const tous = () => [...dlg().querySelectorAll("input[type=text][aria-label]")];
const themes = () => [...dlg().querySelectorAll("select")].find((s) => s.labels[0].textContent === "Couleurs du thème");
const taper = (nom, v) => {
  const s = saisie(nom);
  s.value = v;
  s.dispatchEvent(new Event("input", { bubbles: true }));
};
const choisirTheme = (nom) => {
  themes().value = nom;
  themes().dispatchEvent(new Event("change", { bubbles: true }));
};
async function ouvrir() {
  const p = ouvrirConfiguration();
  await attendre();
  await attendre();
  onglet("Couleurs markdown").click();
  return p;
}

const ELEMENTS_CLES = {
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`Titre ${i}`, `titre${i}`])),
  Texte: "texte", Gras: "gras", Italique: "italique", Barré: "barre", Lien: "lien", "Code en ligne": "code",
  "Bloc de code": "bloc_code", Citation: "citation", "En-tête de tableau": "entete_tableau", "Cellules de tableau": "tableau",
  Puce: "puce", Séparateur: "separateur",
};
const PROP = { couleur: "couleur", fond: "fond", bordure: "bordure" };
const FICHIER =
  '{ "sombre": { "titre1": { "couleur": "#ff8800" }, "citation": { "fond": "#202830", "bordure": "#4488FF" } }, "clair": { "titre1": { "couleur": "#a40" } } }';

test("REQ117_AC1_sans_fichier_25_champs_vides_dans_les_deux_themes_sans_ecriture", async () => {
  const etat = faux();
  await ouvrir();
  expect(tous()).toHaveLength(25);
  expect(tous().every((s) => s.value === "")).toBe(true);
  choisirTheme("Clair");
  expect(tous().every((s) => s.value === "")).toBe(true);
  expect(etat.requetes.every(([, m]) => m === "GET")).toBe(true);
});

test("REQ117_AC2_valeurs_du_fichier_par_theme_normalisees", async () => {
  faux({ markdown: FICHIER });
  await ouvrir();
  const remplis = () => tous().filter((s) => s.value).map((s) => `${s.getAttribute("aria-label")}=${s.value}`);
  expect(remplis()).toEqual(["Titre 1, couleur=#ff8800", "Citation, fond=#202830", "Citation, bordure=#4488ff"]);
  choisirTheme("Clair");
  expect(remplis()).toEqual(["Titre 1, couleur=#aa4400"]);
});

test("REQ117_AC11_AC13_ordre_aide_palettes_noms_et_champs_absents", async () => {
  faux();
  await ouvrir();
  const panneau = document.getElementById("configuration-aide-couleurs").parentElement;
  const fils = [...panneau.children].map((e) => e.className || e.tagName);
  expect(panneau.firstElementChild.textContent).toBe(
    "Dans .yaide/markdown.json. Appliquées dès l'enregistrement à l'aperçu et au mode hybride. Un champ vide garde le style par défaut.",
  );
  expect(fils.indexOf("ya-groupe")).toBeLessThan(fils.indexOf("ya-grille-couleurs"));
  const f = panneau.querySelector("fieldset");
  expect(f.querySelector("legend").textContent).toBe("Palettes suggérées");
  expect([...f.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Par défaut", "Ardoise", "Sépia", "Forêt", "Contrasté"]);
  expect(document.getElementById(f.getAttribute("aria-describedby")).textContent).toBe(
    "Une palette remplit les champs des deux thèmes. Rien n'est écrit avant « Enregistrer ».",
  );
  const noms = tous().map((s) => s.getAttribute("aria-label"));
  expect(noms[0]).toBe("Titre 1, couleur");
  expect(noms.at(-1)).toBe("Séparateur, couleur");
  expect(noms).toContain("Citation, bordure");
  expect(noms).toContain("Cellules de tableau, bordure");
  expect(noms).not.toContain("Code en ligne, bordure");
  expect(noms).not.toContain("Titre 1, fond");
  expect(tous()[0].placeholder).toBe("par défaut");
  expect(dlg().querySelector('input[type=color][aria-label="Choisir : Citation, fond"]').tabIndex).toBe(-1);
  // Ordre du DOM focalisable : palettes, liste, champs ligne par ligne, puis Fermer et Enregistrer.
  const ordre = [...dlg().querySelectorAll("button, select, input")].filter((e) => e.tabIndex >= 0 && !e.closest("[hidden]") && !e.closest(".ya-sections-hote"));
  const libelle = (e) => (e.tagName === "SELECT" ? e.labels[0].textContent : (e.getAttribute("aria-label") ?? e.textContent));
  expect(ordre.map(libelle)).toEqual(["Par défaut", "Ardoise", "Sépia", "Forêt", "Contrasté", "Couleurs du thème", ...noms, "Fermer", "Enregistrer"]);
  expect([...themes().options].map((o) => o.textContent)).toEqual(["Sombre", "Clair"]);
  for (const bp of [...f.querySelectorAll("button")].slice(1)) {
    const ronds = bp.querySelectorAll(".ya-pastille-ronde");
    expect(ronds).toHaveLength(3);
    expect([...ronds].every((r) => r.getAttribute("aria-hidden") === "true")).toBe(true);
  }
});

test("REQ117_AC14_theme_affiche_et_jeux_gardes", async () => {
  faux();
  await ouvrir();
  expect(themes().value).toBe("Sombre");
  taper("Titre 1, couleur", "#f80");
  choisirTheme("Clair");
  expect(saisie("Titre 1, couleur").value).toBe("");
  taper("Titre 1, couleur", "#a40");
  choisirTheme("Sombre");
  expect(saisie("Titre 1, couleur").value).toBe("#f80");
  choisirTheme("Clair");
  expect(saisie("Titre 1, couleur").value).toBe("#a40");
  document.body.replaceChildren();
  document.documentElement.setAttribute("data-theme", "light");
  await ouvrir();
  expect(themes().value).toBe("Clair");
});

test("REQ117_AC6_AC7_AC16_palette_remplit_les_deux_themes_statut_focus_sans_ecriture", async () => {
  const etat = faux();
  await ouvrir();
  const b = bouton("Ardoise");
  b.focus();
  b.click();
  const ardoise = PALETTES[0];
  const verifier = (t) => {
    for (const s of tous()) {
      const [element, prop] = s.getAttribute("aria-label").split(", ");
      const cle = ELEMENTS_CLES[element];
      expect(s.value, `${t} ${element} ${prop}`).toBe(ardoise[t][cle]?.[PROP[prop]] ?? "");
    }
  };
  verifier("sombre");
  choisirTheme("Clair");
  verifier("clair");
  const st = dlg().querySelector(".dialogue-resultat [role=status]");
  expect(st.textContent).toBe("Palette Ardoise posée dans les champs. Enregistrez pour l'appliquer.");
  expect(document.activeElement).toBe(b);
  expect(dlg().querySelector("[aria-pressed]")).toBeNull();
  bouton("Par défaut").click();
  expect(tous().every((s) => s.value === "")).toBe(true);
  expect(dlg().querySelector(".dialogue-resultat [role=status]").textContent).toBe("Champs vidés. Enregistrez pour revenir au style par défaut.");
  choisirTheme("Sombre");
  expect(tous().every((s) => s.value === "")).toBe(true);
  expect(etat.ecritures).toEqual([]);
});

test("REQ117_AC9_AC12_fichier_illisible_champs_vides_alerte_sans_focus", async () => {
  faux({ markdown: "{ cassé" });
  await ouvrir();
  expect(tous().every((s) => s.value === "")).toBe(true);
  const a = dlg().querySelector("[role=alert]");
  expect(a.textContent).toBe(".yaide/markdown.json est illisible. « Enregistrer » le remplacera par ces réglages.");
  expect(dlg().contains(document.activeElement) && a.contains(document.activeElement)).toBe(false);
  expect(document.activeElement).not.toBe(saisie("Titre 1, couleur"));
});

test("REQ117_AC10_coupure_a_l_ouverture_message_a_la_place_et_enregistrer_desactive_ici_seulement", async () => {
  faux({ markdown: new TypeError("réseau") });
  await ouvrir();
  expect(tous()).toHaveLength(0);
  const panneau = document.getElementById("configuration-aide-couleurs").parentElement;
  expect(panneau.querySelector("fieldset")).toBeNull();
  expect([...panneau.children].map((e) => e.textContent)).toEqual([expect.stringContaining("Dans .yaide/markdown.json"), "", "Connexion perdue. Réessayez au retour."]);
  expect(panneau.querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(bouton("Enregistrer").disabled).toBe(true);
  onglet("Interface").click();
  expect(bouton("Enregistrer").disabled).toBe(false);
});

test("REQ116_AC1_AC7_ouverture_sur_interface_fleche_droite_puis_tab_et_aides_reliees", async () => {
  faux();
  const p = ouvrirConfiguration();
  await attendre();
  await attendre();
  expect(onglet("Interface").getAttribute("aria-selected")).toBe("true");
  onglet("Interface").focus();
  onglet("Interface").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(onglet("Couleurs markdown").getAttribute("aria-selected")).toBe("true");
  for (const t of ["Interface", "Couleurs markdown"]) {
    const panneau = document.getElementById(onglet(t).getAttribute("aria-controls"));
    expect(document.getElementById(panneau.getAttribute("aria-describedby"))).not.toBeNull();
  }
  expect(p.element).toBe(dlg());
});
