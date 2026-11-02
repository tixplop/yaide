import { readFileSync } from "node:fs";
import { beforeAll, expect, test, vi } from "vitest";
import { bouton } from "./bouton.js";
import { dialogue } from "./dialogue.js";

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

test("REQ028_AC10_position_haut_sans_titre_visible_nom_par_aria_label", () => {
  const { d } = monter({ titre: "Ouvrir un fichier", position: "haut" });
  const el = d.element;
  expect(el.classList.contains("dialogue-haut")).toBe(true);
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
});

test("REQ028_AC3_style_dialogue_tokens", () => {
  expect(regle(".dialogue")).toContain("background: var(--surface-haute)");
  expect(regle(".dialogue")).toContain("border-radius: var(--rayon-dialogue)");
  expect(regle(".dialogue")).toContain("box-shadow: var(--ombre-dialogue)");
  expect(regle(".dialogue")).toContain("width: var(--largeur-dialogue)");
  expect(regle(".dialogue::backdrop")).toContain("background: var(--voile)");
  expect(regle(".dialogue-haut")).toContain("width: var(--largeur-ouverture)");
});

test("REQ028_AC3_dialogue_haut_a_15_pour_cent_et_actions_a_droite", () => {
  expect(regle(".dialogue-haut")).toContain("margin-top: 15vh");
  expect(regle(".dialogue-actions")).toContain("justify-content: flex-end");
  expect(regle(".dialogue-titre")).toContain("font: var(--texte-sous-titre) var(--police-ui)");
  expect(regle(".dialogue-titre")).toContain("font-weight: var(--graisse-forte)");
});
