import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { boiteOutils } from "./tableau-outils.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const DEPART = () => ({ outil: "choisir", forme: "rectangle", couleur: "default", opacite: 100, taille: "normal", trace: "direct", bouts: "end", trait: "solid", epaisseur: "thin" });
const NOMS = ["Choisir", "Sélection", "Rectangle", "Rectangle arrondi", "Cercle", "Losange", "Note", "Texte", "Symboles", "Lien", "Flèche", "Par défaut", "Bleu", "Vert", "Jaune", "Orange", "Rouge", "Violet", "100 %", "75 %", "50 %", "25 %", "0 %", "Petit", "Normal", "Grand", "Très grand", "Gras", "Italique", "Souligné", "Barré", "Texte par défaut", "Texte bleu", "Texte vert", "Texte jaune", "Texte orange", "Texte rouge", "Texte violet", "À gauche", "Au centre", "À droite", "En haut", "Au milieu", "En bas", "Droit", "Coudé", "Courbe", "À l'arrivée", "Aucune", "Au départ", "Aux deux bouts", "Plein", "Tirets", "Pointillés", "Fin", "Moyen", "Épais", "Premier plan", "Arrière-plan"];
const GROUPES = ["Outil", "Forme", "Relier", "Couleur", "Opacité", "Taille du texte", "Style du texte", "Couleur du texte", "Alignement du texte", "Position verticale du texte", "Tracé", "Extrémités", "Trait", "Épaisseur", "Plan"];
const RANGS = [11, 7, 9, 11, 6, 7, 8];
const DEBUTS = [0, 11, 18, 27, 38, 44, 51];

let b;
let choix;
let echaps;
let actions;
function monter(valeurs = DEPART()) {
  choix = [];
  echaps = 0;
  actions = [];
  // Sept rangs de hauteur 28 ; chaque bouton est à sa place dans son rang et son groupe (8 px entre groupes, 2 entre boutons).
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    const i = this.dataset?.indice;
    if (i === undefined) return { x: 0, y: 0, left: 0, top: 0, width: 24, height: 24, right: 24, bottom: 24 };
    const n = Number(i);
    const rang = DEBUTS.filter((d) => d <= n).length - 1;
    const groupe = [...this.closest(".ya-tableau-outils-groupe").parentElement.children].indexOf(this.closest(".ya-tableau-outils-groupe"));
    const left = (n - DEBUTS[rang]) * 26 + groupe * 6;
    return { x: left, y: rang * 28, left, top: rang * 28, width: 24, height: 24, right: left + 24, bottom: rang * 28 + 24 };
  });
  b = boiteOutils({ valeurs, surChoix: (c, v) => choix.push([c, v]), surAction: (a) => actions.push(a), surEchap: () => echaps++ });
  document.body.append(b.element);
  return b;
}
const boutons = () => [...b.element.querySelectorAll("button")];
const par = (nom) => boutons().find((x) => x.getAttribute("aria-label") === nom);
const touche = (cible, key) => cible.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("REQ133_AC7_barre_nommee_boutons_presses_et_info_bulles", () => {
  monter();
  const el = b.element;
  expect(el.getAttribute("role")).toBe("toolbar");
  expect(el.getAttribute("aria-label")).toBe("Outils du whiteboard");
  expect(el.classList.contains("ya-tableau-outils")).toBe(true);
  expect(boutons().every((x) => x.classList.contains("ya-icon-btn"))).toBe(true);
  expect(boutons().filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Choisir", "Par défaut", "100 %", "Normal", "Droit", "À l'arrivée", "Plein", "Fin"]);
  // « Plan » : deux actions, sans aria-pressed.
  expect(boutons().slice(-2).map((x) => x.hasAttribute("aria-pressed"))).toEqual([false, false]);
  // Un style appelle surChoix.
  par("Tirets").click();
  expect(choix).toEqual([["trait", "dashed"]]);
  expect(par("Tirets").getAttribute("aria-pressed")).toBe("true");
  expect(par("Plein").getAttribute("aria-pressed")).toBe("false");
});

test("REQ133_AC8_noms_groupes_et_info_bulles_dans_l_ordre", () => {
  monter();
  expect(boutons().map((x) => x.getAttribute("aria-label"))).toEqual(NOMS);
  const groupes = [...b.element.querySelectorAll('[role="group"]')];
  expect(groupes.map((g) => g.getAttribute("aria-label"))).toEqual(GROUPES);
  expect(groupes.map((g) => g.querySelectorAll("button").length)).toEqual([2, 7, 2, 7, 5, 4, 4, 7, 3, 3, 3, 4, 3, 3, 2]);
  vi.useFakeTimers();
  const texte = (nom) => {
    par(nom).enveloppe.dispatchEvent(new MouseEvent("pointerenter"));
    vi.advanceTimersByTime(400);
    const t = document.querySelector("[role=tooltip]")?.textContent;
    par(nom).enveloppe.dispatchEvent(new MouseEvent("pointerleave"));
    return t;
  };
  expect(texte("Cercle")).toBe("Cercle");
  expect(texte("Vert")).toBe("Couleur : Vert");
  expect(texte("Coudé")).toBe("Tracé : Coudé");
  expect(texte("Aucune")).toBe("Extrémités : Aucune");
  expect(texte("Tirets")).toBe("Trait : Tirets");
  expect(texte("50 %")).toBe("Opacité : 50 %");
  expect(texte("Épais")).toBe("Épaisseur : Épais");
  expect(texte("Premier plan")).toBe("Premier plan");
  expect(texte("À gauche")).toBe("Alignement du texte : À gauche");
  expect(texte("En bas")).toBe("Position verticale du texte : En bas");
  vi.useRealTimers();
  // Les sept rangs ; une pastille au lieu d'une icône pour les couleurs.
  const rangs = [...b.element.children];
  expect(rangs.map((r) => r.querySelectorAll("button").length)).toEqual(RANGS);
  expect(par("Vert").querySelector(".ya-pastille-couleur")).not.toBeNull();
  expect(par("Vert").querySelector("svg")).toBeNull();
  expect(par("Cercle").querySelector("svg")).not.toBeNull();
  // Un seul pressé parmi Outil, Forme et Relier.
  expect(boutons().slice(0, 11).filter((x) => x.getAttribute("aria-pressed") === "true").length).toBe(1);
  par("Cercle").click();
  expect(boutons().slice(0, 11).filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Cercle"]);
  // CSS : à 12 px du bas et de la gauche, sans valeur brute hors tokens.
  const regle = css.match(/\.ya-tableau-outils\s*\{([^}]*)\}/)[1];
  expect(regle).toMatch(/position:\s*absolute/);
  expect(regle).toMatch(/left:\s*var\(--space-3\)/);
  expect(regle).toMatch(/bottom:\s*var\(--space-3\)/);
  expect(regle).toMatch(/background:\s*var\(--bg-300\)/);
  expect(regle).toMatch(/border-radius:\s*var\(--radius-md\)/);
  expect(regle).toMatch(/box-shadow:\s*var\(--shadow-popover\)/);
  expect(regle).toMatch(/max-height:\s*calc\(100% - 24px\)/);
  expect(regle).toMatch(/overflow-y:\s*auto/);
});

test("REQ133_AC9_un_arret_de_tab_et_fleches", () => {
  monter();
  expect(boutons().filter((x) => x.tabIndex === 0).map((x) => x.getAttribute("aria-label"))).toEqual(["Choisir"]);
  par("Choisir").focus();
  touche(par("Choisir"), "ArrowRight");
  expect(document.activeElement).toBe(par("Sélection"));
  touche(par("Sélection"), "ArrowLeft");
  expect(document.activeElement).toBe(par("Choisir"));
  // Gauche au début : pas de boucle.
  touche(par("Choisir"), "ArrowLeft");
  expect(document.activeElement).toBe(par("Choisir"));
  // Droite en fin de rang : le rang suivant.
  par("Flèche").focus();
  touche(par("Flèche"), "ArrowRight");
  expect(document.activeElement).toBe(par("Par défaut"));
  touche(par("Par défaut"), "ArrowLeft");
  expect(document.activeElement).toBe(par("Flèche"));
  // Bas : le bouton le plus proche en largeur du rang suivant.
  par("Choisir").focus();
  touche(par("Choisir"), "ArrowDown");
  expect(document.activeElement).toBe(par("Par défaut"));
  touche(par("Par défaut"), "ArrowDown");
  expect(document.activeElement).toBe(par("100 %"));
  touche(par("100 %"), "ArrowUp");
  expect(document.activeElement).toBe(par("Par défaut"));
  // Bas depuis « Grand » : « Texte jaune » du rang 4 ; depuis « Normal » : « Texte vert ».
  par("Grand").focus();
  touche(par("Grand"), "ArrowDown");
  expect(document.activeElement).toBe(par("Texte jaune"));
  par("Normal").focus();
  touche(par("Normal"), "ArrowDown");
  expect(document.activeElement).toBe(par("Texte vert"));
  // Rang 5 (REQ-150) : Gras ↔ À gauche ↔ Droit, Barré ↔ En haut ↔ À l'arrivée, Texte vert → En bas, Aux deux bouts, Haut → En bas.
  par("Gras").focus();
  touche(par("Gras"), "ArrowDown");
  expect(document.activeElement).toBe(par("À gauche"));
  touche(par("À gauche"), "ArrowUp");
  expect(document.activeElement).toBe(par("Gras"));
  par("À gauche").focus();
  touche(par("À gauche"), "ArrowDown");
  expect(document.activeElement).toBe(par("Droit"));
  par("Barré").focus();
  touche(par("Barré"), "ArrowDown");
  expect(document.activeElement).toBe(par("En haut"));
  touche(par("En haut"), "ArrowDown");
  expect(document.activeElement).toBe(par("À l'arrivée"));
  touche(par("À l'arrivée"), "ArrowUp");
  expect(document.activeElement).toBe(par("En haut"));
  par("Texte vert").focus();
  touche(par("Texte vert"), "ArrowDown");
  expect(document.activeElement).toBe(par("En bas"));
  par("Texte rouge").focus();
  touche(par("Texte rouge"), "ArrowDown");
  expect(document.activeElement).toBe(par("En bas"));
  par("Aux deux bouts").focus();
  touche(par("Aux deux bouts"), "ArrowUp");
  expect(document.activeElement).toBe(par("En bas"));
  par("Aux deux bouts").focus();
  touche(par("Aux deux bouts"), "ArrowDown");
  expect(document.activeElement).toBe(par("Premier plan"));
  par("Par défaut").focus();
  // Un seul arrêt de Tab : le dernier bouton qui a eu le focus.
  expect(boutons().filter((x) => x.tabIndex === 0).map((x) => x.getAttribute("aria-label"))).toEqual(["Par défaut"]);
  touche(par("Par défaut"), "End");
  expect(document.activeElement).toBe(par("Arrière-plan"));
  touche(par("Arrière-plan"), "ArrowDown");
  expect(document.activeElement).toBe(par("Arrière-plan"));
  touche(par("Arrière-plan"), "Home");
  expect(document.activeElement).toBe(par("Choisir"));
  // Entrée presse sans déplacer le focus ; Échap appelle surEchap.
  par("Courbe").focus();
  par("Courbe").click();
  expect(document.activeElement).toBe(par("Courbe"));
  expect(choix).toEqual([["trace", "curved"]]);
  touche(par("Courbe"), "Escape");
  expect(echaps).toBe(1);
  // Un clic sur un outil pose le focus.
  const bouton = par("Losange");
  bouton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(document.activeElement).toBe(bouton);
  expect(bouton.tabIndex).toBe(0);
});

test("REQ133_AC10_courant_et_presse_apres_un_choix_de_forme", () => {
  monter();
  const courants = () => boutons().filter((x) => x.getAttribute("aria-current") === "true").map((x) => x.getAttribute("aria-label"));
  expect(courants()).toEqual(["Rectangle"]);
  par("Cercle").click();
  expect(choix).toEqual([["outil", "ellipse"]]);
  expect(par("Cercle").getAttribute("aria-pressed")).toBe("true");
  expect(courants()).toEqual(["Cercle"]);
  // Cercle posé : l'appelant remet l'outil à « Choisir », la forme courante reste.
  b.definir({ ...DEPART(), forme: "ellipse", outil: "choisir" });
  expect(par("Choisir").getAttribute("aria-pressed")).toBe("true");
  expect(par("Cercle").getAttribute("aria-pressed")).toBe("false");
  expect(courants()).toEqual(["Cercle"]);
  // Valeurs d'un objet choisi.
  b.definir({ ...DEPART(), couleur: "green", trace: "orthogonal", bouts: "none", trait: "dotted" });
  const presses = boutons().filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"));
  expect(presses).toEqual(["Choisir", "Vert", "100 %", "Normal", "Coudé", "Aucune", "Pointillés", "Fin"]);
  expect(css).toMatch(/\.ya-tableau-outils \.ya-icon-btn\[aria-current="true"\]::after/);
});

test("REQ133_AC11_pas_de_defilement_horizontal_a_304px", () => {
  const regle = css.match(/\.ya-tableau-outils\s*\{([^}]*)\}/)[1];
  expect(regle).toMatch(/overflow-x:\s*hidden/);
  expect(regle).toMatch(/width:\s*304px/);
});

test("REQ133_AC1_valeurs_de_depart_et_plan_inactif", () => {
  monter();
  expect(boutons().filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Choisir", "Par défaut", "100 %", "Normal", "Droit", "À l'arrivée", "Plein", "Fin"]);
  expect(par("Rectangle").getAttribute("aria-current")).toBe("true");
  expect(par("Premier plan").getAttribute("aria-disabled")).toBe("true");
  expect(par("Arrière-plan").getAttribute("aria-disabled")).toBe("true");
  b.definir({ ...DEPART(), opacite: 50, taille: "large", epaisseur: "thick" }, { planActif: true });
  expect(boutons().filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"))).toEqual(["Choisir", "Par défaut", "50 %", "Grand", "Droit", "À l'arrivée", "Plein", "Épais"]);
  expect(par("Premier plan").hasAttribute("aria-disabled")).toBe(false);
});

test("REQ139_AC4_style_sans_focus_a_la_souris_et_info_bulle", () => {
  monter();
  const bas = (nom) => par(nom).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  expect(bas("Grand")).toBe(false);
  expect(bas("Premier plan")).toBe(false);
  expect(bas("Rouge")).toBe(false);
  // Un outil prend le focus.
  expect(bas("Cercle")).toBe(true);
  par("Grand").click();
  expect(document.activeElement).not.toBe(par("Grand"));
  expect(choix).toEqual([["taille", "large"]]);
  expect(par("Grand").getAttribute("aria-pressed")).toBe("true");
  vi.useFakeTimers();
  par("Grand").enveloppe.dispatchEvent(new MouseEvent("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Taille du texte : Grand");
});

test("REQ141_AC4_plan_inactif_garde_focus_et_info_bulle_actif_appelle_surAction", () => {
  monter();
  par("Premier plan").focus();
  expect(document.activeElement).toBe(par("Premier plan"));
  par("Premier plan").click();
  par("Arrière-plan").click();
  expect(actions).toEqual([]);
  vi.useFakeTimers();
  par("Arrière-plan").enveloppe.dispatchEvent(new MouseEvent("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Arrière-plan");
  vi.useRealTimers();
  b.definir(DEPART(), { planActif: true });
  par("Premier plan").click();
  par("Arrière-plan").click();
  expect(actions).toEqual(["premier", "arriere"]);
  expect(choix).toEqual([]);
  b.definir(DEPART(), { planActif: false });
  expect(par("Premier plan").getAttribute("aria-disabled")).toBe("true");
});

const TEXTE = ["Gras", "Italique", "Souligné", "Barré", "Texte par défaut", "Texte bleu", "Texte vert", "Texte jaune", "Texte orange", "Texte rouge", "Texte violet"];
const infoBulle = (nom) => {
  vi.useFakeTimers();
  par(nom).enveloppe.dispatchEvent(new MouseEvent("pointerenter"));
  vi.advanceTimersByTime(400);
  const t = document.querySelector("[role=tooltip]")?.textContent;
  par(nom).enveloppe.dispatchEvent(new MouseEvent("pointerleave"));
  vi.useRealTimers();
  return t;
};

test("REQ133_AC8_AC12_REQ146_AC10_info_bulles_du_texte_non_mac_et_mac", async () => {
  monter();
  expect(infoBulle("Gras")).toBe("Gras (Ctrl+B)");
  expect(infoBulle("Italique")).toBe("Italique (Ctrl+I)");
  expect(infoBulle("Souligné")).toBe("Souligné (Ctrl+U)");
  expect(infoBulle("Barré")).toBe("Barré");
  expect(infoBulle("Texte rouge")).toBe("Couleur du texte : Rouge");
  expect(infoBulle("Texte par défaut")).toBe("Couleur du texte : Par défaut");
  document.body.replaceChildren();
  const ua = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  monter();
  expect(infoBulle("Gras")).toBe("Gras (Cmd+B)");
  expect(infoBulle("Souligné")).toBe("Souligné (Cmd+U)");
  expect(infoBulle("Barré")).toBe("Barré");
  ua.mockRestore();
});

test("REQ133_AC13_AC14_sept_rangs_barre_de_304px_et_pas_de_scroll_horizontal", () => {
  monter();
  expect([...b.element.children].map((r) => r.querySelectorAll("button").length)).toEqual(RANGS);
  const regle = css.match(/\.ya-tableau-outils\s*\{([^}]*)\}/)[1];
  expect(regle).toMatch(/width:\s*304px/);
  expect(regle).toMatch(/overflow-y:\s*auto/);
  expect(regle).toMatch(/max-height:\s*calc\(100% - 24px\)/);
  // Rang 1 : onze boutons de 24 px, 8 écarts de 2 px dans les groupes, 2 écarts de 8 px entre groupes, marges de 4 px : 304.
  expect(4 + 11 * 24 + 8 * 2 + 2 * 8 + 4).toBe(304);
  expect(304 + 12).toBeLessThanOrEqual(320);
  // REQ133_AC14 : sept rangs de 24 px, 6 écarts de 4 px, marges de 4 px : 200 de haut.
  expect(css).toMatch(/\.ya-tableau-outils \{[^}]*padding: 4px; display: flex; flex-direction: column; gap: 4px;/);
  expect(b.element.children).toHaveLength(7);
  expect(css).toMatch(/\.ya-tableau-outils-rang \{ display: flex; gap: 8px; \}/);
});

test("REQ146_AC8_texte_inactif_onze_boutons_aria_disabled_et_clic_sans_effet", () => {
  monter();
  const textes = [];
  b = null;
  document.body.replaceChildren();
  b = boiteOutils({ valeurs: DEPART(), surChoix: (c, v) => choix.push([c, v]), surTexte: (...a) => textes.push(a) });
  document.body.append(b.element);
  for (const n of TEXTE) {
    expect(par(n).getAttribute("aria-disabled"), n).toBe("true");
    expect(par(n).getAttribute("aria-pressed"), n).toBe("false");
    par(n).focus();
    expect(document.activeElement).toBe(par(n));
    par(n).click();
  }
  expect(textes).toEqual([]);
  expect(choix).toEqual([]);
  expect(css).toMatch(/\.ya-icon-btn\[aria-disabled="true"\]:not\(\[aria-busy="true"\]\) > svg \{ opacity: \.45/);
  // Actif : bascules indépendantes, une seule couleur.
  b.definir(DEPART(), { texte: { actif: true, styles: ["bold", "underline"], couleur: "red" } });
  const presses = () => boutons().filter((x) => TEXTE.includes(x.getAttribute("aria-label")) && x.getAttribute("aria-pressed") === "true").map((x) => x.getAttribute("aria-label"));
  expect(presses()).toEqual(["Gras", "Souligné", "Texte rouge"]);
  for (const n of TEXTE) expect(par(n).hasAttribute("aria-disabled"), n).toBe(false);
  // Plusieurs couleurs : aucune pressée.
  b.definir(DEPART(), { texte: { actif: true, styles: [], couleur: null } });
  expect(presses()).toEqual([]);
  b.definir(DEPART(), { texte: { actif: true, styles: ["strike", "italic", "bold"], couleur: "default" } });
  expect(presses()).toEqual(["Gras", "Italique", "Barré", "Texte par défaut"]);
  // Un clic actif appelle surTexte, pas surChoix, et ne change pas l'état tant que `definir` ne le dit pas.
  par("Gras").click();
  par("Barré").click();
  par("Texte vert").click();
  par("Texte par défaut").click();
  expect(textes).toEqual([["bold"], ["strike"], ["color", "green"], ["color", "default"]]);
  expect(choix).toEqual([]);
  expect(presses()).toEqual(["Gras", "Italique", "Barré", "Texte par défaut"]);
  // Les autres appels de `definir` gardent l'état du texte.
  b.definir({ ...DEPART(), couleur: "red" }, { planActif: true });
  expect(presses()).toEqual(["Gras", "Italique", "Barré", "Texte par défaut"]);
  // Inactif de nouveau.
  b.definir(DEPART(), { texte: { actif: false } });
  expect(par("Gras").getAttribute("aria-disabled")).toBe("true");
  expect(presses()).toEqual([]);
  // mousedown sans défaut : la saisie garde le focus.
  for (const n of TEXTE) expect(par(n).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })), n).toBe(false);
});

test("REQ146_AC10_barre_de_couleur_des_boutons_de_couleur_du_texte", () => {
  monter();
  expect(par("Texte vert").classList.contains("ya-texte-vert")).toBe(true);
  expect(par("Texte par défaut").classList.contains("ya-texte-defaut")).toBe(true);
  expect(par("Texte vert").querySelector("svg").dataset.icone).toBe("couleur-texte");
  expect(par("Texte vert").querySelector(".ya-barre-texte")).not.toBeNull();
  expect(css).toMatch(/\.ya-texte-vert \{ --barre-texte: var\(--boite-vert-trait\)/);
  expect(css).toMatch(/\.ya-texte-defaut \{ --barre-texte: var\(--ink\)/);
  expect(css).toMatch(/\.ya-barre-texte \{ fill: var\(--barre-texte/);
  for (const c of ["bleu", "jaune", "orange", "rouge", "violet"]) expect(css).toContain(`--barre-texte: var(--boite-${c}-trait)`);
});

const ouvert = () => document.querySelector("dialog[open]");
// jsdom n'implémente pas <dialog> modal : on simule ouverture et fermeture.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
const echap = () => ouvert().dispatchEvent(new Event("cancel", { cancelable: true }));

const NOMS_SYMBOLES = ["Base de données", "Tuyau", "Personne", "Groupe de personnes", "Sécurisé", "Non sécurisé", "Validé", "Échec", "Réseau", "Wi-Fi", "Ethernet", "Serveur", "Nuage", "Ordinateur", "Téléphone", "Fichier", "Courriel", "Réglages", "Alerte", "Pare-feu"];

test("REQ149_AC1_AC10_symboles_ouvre_le_dialogue_aux_vingt_cases_et_echap_ne_change_rien", () => {
  monter();
  const s = par("Symboles");
  expect(s.getAttribute("aria-haspopup")).toBe("dialog");
  expect(s.hasAttribute("aria-expanded")).toBe(false);
  expect(s.querySelector("svg")).not.toBeNull();
  s.click();
  const d = ouvert();
  expect(d.querySelector("h2").textContent).toBe("Symboles");
  expect(document.getElementById(d.getAttribute("aria-describedby")).textContent).toBe("Choisissez un symbole, puis cliquez sur le whiteboard pour le poser.");
  const options = [...d.querySelectorAll('[role="option"]')];
  expect(options.map((o) => o.textContent)).toEqual(NOMS_SYMBOLES);
  expect(choix).toEqual([]);
  expect(par("Choisir").getAttribute("aria-pressed")).toBe("true");
  echap();
  expect(ouvert()).toBeNull();
  expect(choix).toEqual([]);
  expect(document.activeElement).toBe(s);
  expect(par("Choisir").getAttribute("aria-pressed")).toBe("true");
});

test("REQ149_AC2_AC10_choisir_un_symbole_en_fait_l_outil_presse_courant_et_l_info_bulle", () => {
  monter();
  vi.useFakeTimers();
  const bulle = () => {
    par("Symboles").enveloppe.dispatchEvent(new MouseEvent("pointerenter"));
    vi.advanceTimersByTime(400);
    const t = document.querySelector("[role=tooltip]")?.textContent;
    par("Symboles").enveloppe.dispatchEvent(new MouseEvent("pointerleave"));
    return t;
  };
  expect(bulle()).toBe("Symboles");
  par("Symboles").click();
  [...ouvert().querySelectorAll('[role="option"]')].find((o) => o.textContent === "Serveur").click();
  expect(choix).toEqual([["outil", "server"]]);
  expect(ouvert()).toBeNull();
  expect(document.activeElement).toBe(par("Symboles"));
  const courants = () => boutons().filter((x) => x.getAttribute("aria-current") === "true").map((x) => x.getAttribute("aria-label"));
  expect(par("Symboles").getAttribute("aria-pressed")).toBe("true");
  expect(courants()).toEqual(["Symboles"]);
  expect(par("Rectangle").getAttribute("aria-pressed")).toBe("false");
  expect(bulle()).toBe("Symboles : Serveur");
  // Après la pose : l'appelant remet « Choisir », « Symboles » reste courant.
  b.definir({ ...DEPART(), forme: "server", outil: "choisir" });
  expect(par("Choisir").getAttribute("aria-pressed")).toBe("true");
  expect(par("Symboles").getAttribute("aria-pressed")).toBe("false");
  expect(courants()).toEqual(["Symboles"]);
});

test("REQ149_AC8_deuxieme_ouverture_focus_sur_le_symbole_courant_aria_selected", () => {
  monter();
  par("Symboles").click();
  expect(document.activeElement.textContent).toBe("Base de données");
  [...ouvert().querySelectorAll('[role="option"]')].find((o) => o.textContent === "Nuage").click();
  par("Symboles").click();
  const options = [...ouvert().querySelectorAll('[role="option"]')];
  expect(document.activeElement.textContent).toBe("Nuage");
  expect(options.filter((o) => o.getAttribute("aria-selected") === "true").map((o) => o.textContent)).toEqual(["Nuage"]);
  echap();
});

test("REQ133_AC12_AC13_rang_1_a_onze_boutons_bas_et_haut_depuis_le_rang_1", () => {
  monter();
  const rang1 = [...b.element.children][0];
  expect(rang1.querySelectorAll("button").length).toBe(11);
  par("Symboles").focus();
  touche(par("Symboles"), "ArrowDown");
  expect(document.activeElement).toBe(par("Violet"));
  touche(document.activeElement, "ArrowUp");
  expect(document.activeElement).toBe(par("Note"));
});
