import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { ouvrirConfiguration } from "./configuration.js";
import { PALETTES } from "../ui/palettes.js";
import { appliquer } from "../couleurs-markdown.js";

vi.mock("../couleurs-markdown.js", async (orig) => ({ ...(await orig()), appliquer: vi.fn() }));

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
function faux({ markdown, put } = {}) {
  const etat = { ecritures: [], requetes: [], urls: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, opts = {}) => {
      etat.requetes.push([String(url), opts.method ?? "GET"]);
      if (opts.method === "PUT") {
        etat.ecritures.push(opts.body);
        etat.urls.push(decodeURIComponent(String(url)));
        if (put) return put(opts);
        return { ok: true, status: 200, json: async () => ({ version: "v2" }) };
      }
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

const TEXTE_AC3 = '{\n  "sombre": {\n    "titre1": {\n      "couleur": "#ff8800"\n    }\n  },\n  "clair": {\n    "bloc_code": {\n      "fond": "#101820"\n    }\n  }\n}\n';
const resultat = () => dlg().querySelector(".dialogue-resultat [role=status], .dialogue-resultat [role=alert]");

test("REQ117_AC3_texte_exact_champs_relus_et_tout_vide_donne_accolades", async () => {
  const etat = faux({ markdown: '{ "sombre": { "titre1": { "couleur": "#abc" } } }' });
  await ouvrir();
  taper("Titre 1, couleur", "#f80");
  choisirTheme("Clair");
  taper("Bloc de code, fond", "#101820");
  bouton("Enregistrer").click();
  await attendre();
  expect(etat.ecritures).toEqual([TEXTE_AC3]);
  expect(etat.urls[0]).toContain(".yaide/markdown.json");
  choisirTheme("Sombre");
  expect(saisie("Titre 1, couleur").value).toBe("#f80");
  taper("Titre 1, couleur", "#F80");
  bouton("Enregistrer").click();
  await attendre();
  expect(etat.ecritures[1]).toBe(TEXTE_AC3);
  bouton("Par défaut").click();
  bouton("Enregistrer").click();
  await attendre();
  expect(etat.ecritures[2]).toBe("{}\n");
});

test("REQ117_AC4_AC17_refus_messages_alerte_focus_theme_et_palette_retire_les_erreurs", async () => {
  const etat = faux();
  await ouvrir();
  for (const v of ["red", "#ff00", "#ff0000; background: url(x)"]) {
    taper("Citation, bordure", v);
    bouton("Enregistrer").focus();
    bouton("Enregistrer").click();
    await attendre();
    expect(etat.ecritures).toEqual([]);
    const s = saisie("Citation, bordure");
    expect(s.getAttribute("aria-invalid")).toBe("true");
    const m = document.getElementById(s.getAttribute("aria-describedby"));
    expect(m.getAttribute("role")).toBe("alert");
    expect(m.textContent).toBe("Bordure : tapez une couleur #rgb ou #rrggbb, ou laissez vide.");
    expect(s.value).toBe(v);
    expect(document.activeElement).toBe(s);
  }
  taper("Titre 1, couleur", "vert");
  bouton("Enregistrer").click();
  await attendre();
  expect(document.getElementById(saisie("Titre 1, couleur").getAttribute("aria-describedby")).textContent).toBe("Tapez une couleur #rgb ou #rrggbb, ou laissez vide.");
  expect(document.activeElement).toBe(saisie("Titre 1, couleur"));
  // seule erreur en clair, sombre affiché
  bouton("Ardoise").click();
  expect(dlg().querySelector(".ya-grille-erreur")).toBeNull();
  expect(saisie("Titre 1, couleur").hasAttribute("aria-invalid")).toBe(false);
  choisirTheme("Clair");
  taper("Texte, couleur", "rouge");
  choisirTheme("Sombre");
  bouton("Enregistrer").click();
  await attendre();
  expect(themes().value).toBe("Clair");
  expect(document.activeElement).toBe(saisie("Texte, couleur"));
  expect(etat.ecritures).toEqual([]);
  // erreur en sombre et en clair, clair affiché : sombre d'abord
  choisirTheme("Sombre");
  taper("Gras, couleur", "x1");
  choisirTheme("Clair");
  expect(themes().value).toBe("Clair");
  bouton("Enregistrer").click();
  await attendre();
  expect(themes().value).toBe("Sombre");
  expect(document.activeElement).toBe(saisie("Gras, couleur"));
  // le message est sous la ligne « Citation » : juste avant le nom de l'élément suivant
  taper("Gras, couleur", "");
  choisirTheme("Clair");
  taper("Texte, couleur", "");
  choisirTheme("Sombre");
  taper("Citation, bordure", "red");
  bouton("Enregistrer").click();
  await attendre();
  const msg = document.getElementById(saisie("Citation, bordure").getAttribute("aria-describedby"));
  expect(msg.nextElementSibling.textContent).toBe("En-tête de tableau");
  // corrigé puis enregistré : plus d'alerte ni d'aria-invalid
  taper("Citation, bordure", "#f00");
  bouton("Enregistrer").click();
  await attendre();
  await attendre();
  expect(etat.ecritures).toHaveLength(1);
  expect(dlg().querySelector(".ya-grille-erreur")).toBeNull();
  expect(dlg().querySelector("[aria-invalid]")).toBeNull();
  expect(saisie("Citation, bordure").value).toBe("#f00");
});

test("REQ117_AC5_appliquer_apres_reussite_pas_apres_echec", async () => {
  appliquer.mockClear();
  faux({ put: () => ({ ok: false, status: 500, json: async () => ({ cause: "erreur", message: "Disque plein." }) }) });
  await ouvrir();
  taper("Titre 1, couleur", "#f80");
  bouton("Enregistrer").click();
  await attendre();
  expect(appliquer).not.toHaveBeenCalled();
  document.body.replaceChildren();
  faux();
  await ouvrir();
  taper("Titre 1, couleur", "#f80");
  bouton("Enregistrer").click();
  await attendre();
  expect(appliquer).toHaveBeenCalledWith({ sombre: { titre1: { couleur: "#ff8800" } }, clair: {} });
});

test("REQ117_AC6_AC7_palette_puis_champ_ecrit_fermer_n_ecrit_rien", async () => {
  const etat = faux();
  await ouvrir();
  bouton("Sépia").click();
  taper("Titre 2, couleur", "#123456");
  bouton("Enregistrer").click();
  await attendre();
  const ecrit = JSON.parse(etat.ecritures[0]);
  const sepia = PALETTES.find((p) => p.nom === "Sépia");
  expect(ecrit.sombre.titre2.couleur).toBe("#123456");
  expect(ecrit.sombre.titre1.couleur).toBe(sepia.sombre.titre1.couleur);
  expect(ecrit.clair.citation).toEqual(sepia.clair.citation);
  document.body.replaceChildren();
  const autre = faux();
  await ouvrir();
  taper("Titre 1, couleur", "#f80");
  bouton("Fermer").click();
  expect(autre.ecritures).toEqual([]);
});

test("REQ117_AC12_statut_focus_alerte_retiree_message_retire_et_etat_en_cours", async () => {
  let fin;
  const etat = faux({ markdown: "{ cassé", put: () => new Promise((r) => (fin = r)) });
  await ouvrir();
  expect(dlg().querySelector("[role=alert]")).not.toBeNull();
  taper("Titre 1, couleur", "#f80");
  const b = bouton("Enregistrer");
  b.focus();
  b.click();
  await attendre();
  expect(bouton("Enregistrement…") ?? [...dlg().querySelectorAll("button")].find((x) => x.textContent.includes("Enregistrement…"))).toBeDefined();
  expect(bouton("Fermer").disabled).toBe(true);
  expect(bouton("Ardoise").disabled).toBe(true);
  expect(saisie("Titre 1, couleur").disabled).toBe(true);
  fin({ ok: true, status: 200, json: async () => ({ version: "v2" }) });
  await attendre();
  await attendre();
  expect(resultat().textContent).toBe("Couleurs enregistrées.");
  expect(resultat().getAttribute("role")).toBe("status");
  expect(document.activeElement).toBe(bouton("Enregistrer"));
  expect(bouton("Fermer").disabled).toBe(false);
  expect(saisie("Titre 1, couleur").disabled).toBe(false);
  expect(dlg().querySelector("[role=alert]")).toBeNull();
  taper("Titre 1, couleur", "#abc");
  expect(resultat()).toBeFalsy();
  expect(etat.ecritures).toHaveLength(1);
  bouton("Ardoise").click();
  expect(resultat().textContent).toContain("Palette Ardoise");
});

test("REQ117_AC10_coupure_pendant_l_ecriture_garde_la_saisie_autre_echec_dit_la_raison", async () => {
  appliquer.mockClear();
  faux({ put: () => { throw new TypeError("réseau"); } });
  await ouvrir();
  taper("Titre 1, couleur", "#f80");
  bouton("Enregistrer").click();
  await attendre();
  await attendre();
  expect(resultat().textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(saisie("Titre 1, couleur").value).toBe("#f80");
  expect(appliquer).not.toHaveBeenCalled();
  document.body.replaceChildren();
  faux({ put: () => ({ ok: false, status: 500, json: async () => ({ cause: "erreur", message: "Disque plein." }) }) });
  await ouvrir();
  taper("Titre 1, couleur", "#f80");
  bouton("Enregistrer").click();
  await attendre();
  await attendre();
  expect(resultat().textContent).toBe("Enregistrement impossible : Disque plein.");
  expect(appliquer).not.toHaveBeenCalled();
});

test("REQ116_AC2_AC3_AC8_sections_gardent_leurs_saisies_chaque_enregistrer_son_fichier_echap_n_ecrit_rien", async () => {
  let fin;
  const etat = faux({ put: (o) => (o.body.includes("replis") ? new Promise((r) => (fin = r)) : { ok: true, status: 200, json: async () => ({ version: "v2" }) }) });
  await ouvrir();
  const selectI = () => [...dlg().querySelectorAll("select")].find((x) => x.labels[0].textContent === "Panneau de gauche");
  onglet("Interface").click();
  selectI().value = "Replié";
  selectI().dispatchEvent(new Event("change", { bubbles: true }));
  onglet("Couleurs markdown").click();
  taper("Titre 1, couleur", "#f80");
  onglet("Interface").click();
  expect(selectI().value).toBe("Replié");
  onglet("Couleurs markdown").click();
  expect(saisie("Titre 1, couleur").value).toBe("#f80");
  // Interface en cours d'écriture : celui des couleurs reste actif
  onglet("Interface").click();
  bouton("Enregistrer").click();
  await attendre();
  onglet("Couleurs markdown").click();
  expect(bouton("Enregistrer").disabled).toBe(false);
  bouton("Enregistrer").click();
  await attendre();
  await attendre();
  expect(etat.urls.map((u) => u.split("/").pop())).toEqual(["interface.json", "markdown.json"]);
  expect(resultat().textContent).toBe("Couleurs enregistrées.");
  fin({ ok: true, status: 200, json: async () => ({ version: "v2" }) });
  await attendre();
  await attendre();
  expect(resultat().textContent).toBe("Couleurs enregistrées.");
  onglet("Interface").click();
  expect(resultat()).toBeNull();
  dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(etat.ecritures).toHaveLength(2);
});
