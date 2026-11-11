import { readFileSync } from "node:fs";
import { beforeAll, expect, test, vi } from "vitest";
import { bouton } from "./bouton.js";
import { amenerDansLaVue, dialogue, groupe } from "./dialogue.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};

// jsdom n'implémente pas <dialog> modal : on simule ouverture et fermeture.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
    this.dataset.modal = "oui";
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function monter(opts = {}) {
  const declencheur = bouton({ libelle: "Ouvrir" });
  document.body.append(declencheur);
  declencheur.focus();
  const annuler = bouton({ libelle: "Annuler" });
  const ok = bouton({ libelle: "Supprimer", variante: "danger" });
  const surAnnuler = vi.fn();
  const d = dialogue({ titre: "Supprimer le shell", contenu: ["Supprimer le shell 2 ?"], actions: [annuler, ok], focusInitial: annuler, surAnnuler, ...opts });
  return { d, declencheur, annuler, ok, surAnnuler };
}

test("REQ028_AC10_ouvre_en_modal_avec_titre_nomme_et_focus_initial", () => {
  const { d, annuler } = monter();
  d.ouvrir();
  const el = d.element;
  expect(el.tagName).toBe("DIALOG");
  expect(el.dataset.modal).toBe("oui");
  expect(el.isConnected).toBe(true);
  const h = el.querySelector("h2");
  expect(h.textContent).toBe("Supprimer le shell");
  expect(el.getAttribute("aria-labelledby")).toBe(h.id);
  expect(el.textContent).toContain("Supprimer le shell 2 ?");
  expect(document.activeElement).toBe(annuler);
});

test("REQ028_AC10_actions_alignees_dans_l_ordre", () => {
  const { d, annuler, ok } = monter();
  const pied = d.element.querySelector(".dialogue-actions");
  expect([...pied.children]).toEqual([annuler, ok]);
});

test("REQ028_AC10_le_focus_revient_a_l_element_d_origine", () => {
  const { d, declencheur, annuler } = monter();
  d.ouvrir();
  expect(document.activeElement).toBe(annuler);
  d.fermer();
  expect(d.element.hasAttribute("open")).toBe(false);
  expect(document.activeElement).toBe(declencheur);
  expect(d.element.isConnected).toBe(false);
});

test("REQ028_AC10_fermer_sans_rendre_le_focus_quand_l_action_ouvre_un_fichier", () => {
  const { d, declencheur, annuler } = monter();
  d.ouvrir();
  d.fermer({ rendreFocus: false });
  expect(document.activeElement).not.toBe(declencheur);
  expect(annuler.isConnected).toBe(false);
});

test("REQ028_AC10_echap_appelle_sur_annuler_sans_fermer", () => {
  const { d, surAnnuler } = monter();
  d.ouvrir();
  const ev = new Event("cancel", { cancelable: true });
  d.element.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(surAnnuler).toHaveBeenCalledTimes(1);
  expect(d.element.hasAttribute("open")).toBe(true);
});

test("REQ028_AC10_en_cours_desactive_les_actions", () => {
  const { d, annuler, ok } = monter();
  d.enCours(true);
  expect(annuler.disabled && ok.disabled).toBe(true);
  d.enCours(false);
  expect(annuler.disabled || ok.disabled).toBe(false);
});

test("REQ028_AC10_position_palette_sans_titre_visible_nom_par_aria_label", () => {
  const { d } = monter({ titre: "Ouvrir un fichier", position: "palette" });
  const el = d.element;
  expect(el.classList.contains("ya-palette")).toBe(true);
  expect(el.getAttribute("aria-label")).toBe("Ouvrir un fichier");
  expect(el.querySelector("h2")).toBeNull();
  expect(el.hasAttribute("aria-labelledby")).toBe(false);
});

test("REQ028_AC10_dialogue_erreurs", () => {
  const f = bouton({ libelle: "ok" });
  expect(() => dialogue({ contenu: [], focusInitial: f, surAnnuler() {} })).toThrow(/titre/);
  expect(() => dialogue({ titre: "t", contenu: [], surAnnuler() {} })).toThrow(/focusInitial/);
  expect(() => dialogue({ titre: "t", contenu: [], focusInitial: f })).toThrow(/surAnnuler/);
  expect(() => dialogue({ titre: "t", contenu: [], focusInitial: f, surAnnuler() {}, position: "bas" })).toThrow(/position/);
  expect(() => dialogue({ titre: "t", contenu: [], focusInitial: f, surAnnuler() {}, position: "haut" })).toThrow(/position/);
});

test("REQ036_AC1_style_dialogue_centre_tokens", () => {
  expect(regle(".dialogue")).toContain("background: var(--bg-300)");
  expect(regle(".dialogue")).toContain("border-radius: var(--radius-lg)");
  expect(regle(".dialogue")).toContain("box-shadow: var(--shadow-popover)");
  expect(regle(".dialogue")).toContain("width: var(--largeur-dialogue)");
  expect(regle(".dialogue")).toContain("margin: 18vh auto 0");
  expect(regle(".dialogue")).toContain("padding: var(--space-4)");
  expect(regle(".dialogue::backdrop")).toContain("background: var(--voile)");
  expect(regle(".ya-dialog-title")).toContain("font-size: 14px");
  expect(regle(".ya-dialog-title")).toContain("line-height: 20px");
  expect(regle(".ya-dialog-title")).toContain("font-weight: var(--graisse-forte)");
  expect(regle(".dialogue-actions")).toContain("justify-content: flex-end");
  const { d } = monter();
  expect(d.element.querySelector("h2").classList.contains("ya-dialog-title")).toBe(true);
});

test("REQ028_AC3_dialogue_actions_a_droite_et_plus_de_position_haut", () => {
  expect(css).not.toMatch(/dialogue-haut|largeur-ouverture/);
  expect(regle(".dialogue-actions")).toContain("justify-content: flex-end");
});

test("C007_palette_sous_la_barre_de_titre_sans_titre_visible_voile_transparent", () => {
  const { d } = monter({ titre: "Ouvrir un fichier", position: "palette" });
  const el = d.element;
  expect(el.classList.contains("ya-palette")).toBe(true);
  expect(el.getAttribute("aria-label")).toBe("Ouvrir un fichier");
  expect(el.querySelector("h2")).toBeNull();
  expect(regle(".ya-palette")).toContain("width: var(--largeur-palette)");
  expect(regle(".ya-palette")).toContain("margin: calc(var(--size-titlebar) + 4px) auto 0");
  expect(regle(".ya-palette")).toContain("padding: 6px");
  expect(regle(".ya-palette")).toContain("border-radius: var(--radius-md)");
  expect(regle(".ya-palette::backdrop")).toContain("background: transparent");
  expect(regle(".ya-palette .liste-ligne")).toContain("height: 24px");
  expect(regle(".ya-palette .liste-ligne")).toContain("border-radius: var(--radius-xs)");
  expect(regle(".ya-palette .liste-trouve")).toContain("color: var(--accent-fg)");
  expect(regle(".ya-palette .liste-trouve")).toContain("font-weight: var(--graisse-forte)");
});

test("REQ054_reglages_contenu_defile_actions_visibles", () => {
  const { d } = monter({ position: "reglages", titre: "Providers LLM" });
  d.ouvrir();
  const el = d.element;
  expect(el.className).toContain("ya-reglages");
  const h = el.querySelector("h2");
  expect(h.textContent).toBe("Providers LLM");
  expect(el.getAttribute("aria-labelledby")).toBe(h.id);
  // Titre, contenu, actions : trois enfants directs, dans cet ordre.
  expect([...el.children].map((e) => e.className.split(" ")[0])).toEqual(["dialogue-titre", "dialogue-contenu", "dialogue-actions"]);
  const r = regle(".ya-reglages");
  expect(r).toContain("width: var(--largeur-palette)");
  expect(r).toContain("max-height: calc(100vh - 2 * var(--space-4))");
  expect(r).toContain("display: flex");
  expect(r).toContain("flex-direction: column");
  expect(r).toContain("margin: auto");
  expect(regle(".ya-reglages .dialogue-contenu")).toContain("overflow-y: auto");
  expect(regle(".ya-reglages .dialogue-contenu")).toContain("gap: 12px");
  expect(regle(".ya-reglages .dialogue-actions")).toContain("flex: none");
  expect(regle(".ya-reglages::backdrop")).toContain("background: var(--voile)");
  expect(() => monter({ position: "autre" })).toThrow(/position/);
});

test("REQ053_AC9_echap_ne_ferme_que_la_confirmation", () => {
  const reglages = monter({ position: "reglages", titre: "Providers LLM" });
  reglages.d.ouvrir();
  const confirmation = monter({ titre: "Supprimer le provider" });
  confirmation.d.ouvrir();
  // Le navigateur envoie `cancel` au seul dialogue modal du dessus.
  confirmation.d.element.dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(confirmation.surAnnuler).toHaveBeenCalledTimes(1);
  expect(reglages.surAnnuler).not.toHaveBeenCalled();
  confirmation.d.fermer();
  expect(reglages.d.element.isConnected).toBe(true);
  expect(reglages.d.element.hasAttribute("open")).toBe(true);
});

test("REQ071_groupe_fieldset_legende_et_aide_reliee", () => {
  const a = bouton({ libelle: "A" });
  const g = groupe({ legende: "Fonctions", champs: [a], aide: "Aide du groupe", enLigne: true });
  expect(g.tagName).toBe("FIELDSET");
  expect(g.querySelector("legend").textContent).toBe("Fonctions");
  expect(g.contains(a)).toBe(true);
  const aide = g.querySelector(`#${g.getAttribute("aria-describedby")}`);
  expect(aide.textContent).toBe("Aide du groupe");
  expect(g.classList.contains("ya-groupe-ligne")).toBe(true);
  expect(groupe({ legende: "X", champs: [] }).hasAttribute("aria-describedby")).toBe(false);
});

test("REQ071_aide_du_dialogue_reliee_par_aria_describedby", () => {
  const aide = document.createElement("p");
  aide.textContent = "Aide";
  const { d } = monter({ aide });
  expect(d.element.getAttribute("aria-describedby")).toBe(aide.id);
  expect(d.element.contains(aide)).toBe(true);
  expect(monter().d.element.hasAttribute("aria-describedby")).toBe(false);
});

test("REQ071_message_amene_dans_la_vue_sans_bouger_le_focus", () => {
  const { d, annuler } = monter();
  d.ouvrir();
  const m = document.createElement("div");
  const faux = vi.fn();
  m.scrollIntoView = faux;
  d.element.append(m);
  amenerDansLaVue(m);
  expect(faux).toHaveBeenCalledWith({ block: "nearest" });
  expect(document.activeElement).toBe(annuler);
});

test("REQ088_AC13_palette_sans_champ_focus_sur_la_liste_puis_remplacement_et_clic_dehors", () => {
  const liste = document.createElement("div");
  liste.tabIndex = 0;
  const surAnnuler = vi.fn();
  const d = dialogue({ titre: "Sessions opencode", position: "palette", sansChamp: true, contenu: [liste], focusInitial: liste, surAnnuler });
  expect(d.element.className).toContain("ya-palette-sans-champ");
  d.ouvrir();
  expect(document.activeElement).toBe(liste);
  expect(regle(".ya-palette-sans-champ .liste")).toContain("max-height: 288px");
  d.fermer();

  // Sans liste (chargement, vide, erreur) : le focus est sur le dialogue, puis passe à la liste.
  const attente = document.createElement("p");
  attente.textContent = "Chargement…";
  const d2 = dialogue({ titre: "Sessions opencode", position: "palette", sansChamp: true, contenu: [attente], surAnnuler });
  expect(d2.element.getAttribute("tabindex")).toBe("-1");
  d2.ouvrir();
  expect(document.activeElement).toBe(d2.element);
  const arrivee = document.createElement("div");
  arrivee.tabIndex = 0;
  d2.remplacer([arrivee], arrivee);
  expect(d2.element.querySelector("p")).toBeNull();
  expect(document.activeElement).toBe(arrivee);
  // Une erreur ou un vide qui remplace : le focus revient sur le dialogue.
  const erreur = document.createElement("p");
  d2.remplacer([erreur]);
  expect(d2.element.contains(erreur)).toBe(true);
  expect(document.activeElement).toBe(d2.element);
  d2.remplacer([arrivee], arrivee);

  // Clic hors du dialogue = Échap ; clic dedans : rien.
  d2.element.getBoundingClientRect = () => ({ left: 100, right: 700, top: 40, bottom: 300 });
  d2.element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 100 }));
  expect(surAnnuler).toHaveBeenCalledTimes(1);
  d2.element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 105, clientY: 100 }));
  arrivee.click();
  expect(surAnnuler).toHaveBeenCalledTimes(1);
  d2.fermer();
});

test("REQ088_AC13_sans_champ_reserve_a_la_palette_et_focus_initial_requis_ailleurs", () => {
  expect(() => dialogue({ titre: "x", sansChamp: true, surAnnuler: () => {} })).toThrow(/palette/);
  expect(() => dialogue({ titre: "x", surAnnuler: () => {} })).toThrow(/focusInitial/);
});
