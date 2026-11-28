import { expect, test, beforeEach, vi, afterEach } from "vitest";
import { icone } from "./icones.js";
import { zoneCode } from "./zone-code.js";

Range.prototype.getClientRects ??= () => [];
Range.prototype.getBoundingClientRect ??= () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });

const DOC = "Yaide un\nyaide deux\nYaide trois\n";
beforeEach(() => (document.body.innerHTML = ""));
afterEach(() => vi.useRealTimers());

function monter(contenu = DOC, options = {}) {
  const z = zoneCode({ contenu, langage: "markdown", nom: "README.md", recherche: { nom: "README.md" }, ...options });
  document.body.append(z);
  return z;
}
const panneau = (z) => z.querySelector('[role="search"]');
const champ = (z) => panneau(z).querySelector("input");
const bt = (z, nom) => panneau(z).querySelector(`button[aria-label="${nom}"]`);
const compteur = (z) => panneau(z).querySelector(".ya-recherche-compteur").textContent;
const statut = (z) => panneau(z).querySelector('[role="status"]').textContent;
const occurrences = (z) => [...z.querySelectorAll(".ya-occurrence")];
const taper = (z, t) => {
  champ(z).value = t;
  champ(z).dispatchEvent(new Event("input", { bubbles: true }));
};
const touche = (cible, key, init = {}) => cible.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
const sel = (z) => {
  const s = z.vue.state.selection.main;
  return [s.from, s.to];
};

test("REQ159_AC2_compte_et_surligne_a_chaque_saisie", () => {
  const z = monter();
  z.recherche.ouvrir();
  taper(z, "yaide");
  expect(compteur(z)).toBe("3");
  expect(occurrences(z)).toHaveLength(3);
  taper(z, "yaid");
  expect(compteur(z)).toBe("3");
  taper(z, "zzz");
  expect(compteur(z)).toBe("0");
  expect(occurrences(z)).toHaveLength(0);
});

test("REQ159_AC3_zero_rouge_et_champ_vide", () => {
  const z = monter();
  z.recherche.ouvrir();
  taper(z, "zzz");
  expect(panneau(z).querySelector(".ya-occ").classList.contains("ya-occ-zero")).toBe(true);
  taper(z, "yaide");
  expect(panneau(z).querySelector(".ya-occ").classList.contains("ya-occ-zero")).toBe(false);
  taper(z, "");
  expect(compteur(z)).toBe("");
  expect(occurrences(z)).toHaveLength(0);
});

test("REQ159_AC4_f3_parcourt_sans_prendre_le_focus", () => {
  const z = monter();
  z.recherche.ouvrir();
  taper(z, "yaide");
  const debuts = [0, 9, 20];
  touche(champ(z), "F3");
  expect(sel(z)).toEqual([0, 5]);
  touche(champ(z), "F3");
  touche(champ(z), "F3");
  expect(sel(z)).toEqual([debuts[2], debuts[2] + 5]);
  touche(champ(z), "F3");
  expect(sel(z)).toEqual([0, 5]);
  bt(z, "Occurrence précédente").click();
  expect(sel(z)).toEqual([20, 25]);
  bt(z, "Occurrence suivante").click();
  expect(sel(z)).toEqual([0, 5]);
  expect(document.activeElement).toBe(champ(z));
  // dans l'éditeur, la suivante part du curseur
  z.vue.dispatch({ selection: { anchor: 6 } });
  touche(z.vue.contentDOM, "F3");
  expect(sel(z)).toEqual([9, 14]);
  touche(z.vue.contentDOM, "F3", { shiftKey: true });
  expect(sel(z)).toEqual([0, 5]);
});

test("REQ159_AC6_le_compte_suit_le_document", () => {
  const z = monter();
  z.recherche.ouvrir();
  taper(z, "yaide");
  z.vue.dispatch({ changes: { from: z.vue.state.doc.length, insert: "Yaide" } });
  expect(compteur(z)).toBe("4");
  expect(occurrences(z)).toHaveLength(4);
});

test("REQ159_AC7_fermer_retire_tout_et_garde_la_selection", () => {
  const z = monter();
  z.recherche.ouvrir();
  taper(z, "yaide");
  touche(champ(z), "F3");
  bt(z, "Fermer la recherche").click();
  expect(panneau(z)).toBeNull();
  expect(occurrences(z)).toHaveLength(0);
  expect(z.vue.hasFocus || document.activeElement === z.vue.contentDOM).toBe(true);
  expect(sel(z)).toEqual([0, 5]);
  expect(z.contenu()).toBe(DOC);
});

test("REQ159_AC9_structure_et_noms", () => {
  const z = monter();
  z.recherche.ouvrir();
  const p = panneau(z);
  expect(p.getAttribute("aria-label")).toBe("Rechercher dans README.md");
  expect(p.compareDocumentPosition(z.querySelector(".cm-scroller")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const c = champ(z);
  expect(p.querySelector(`label[for="${c.id}"]`).textContent).toBe("Rechercher dans le fichier");
  expect(c.placeholder).toBe("Rechercher");
  expect(c.getAttribute("autocomplete")).toBe("off");
  const boutons = [...p.querySelectorAll("button")].slice(2);
  expect(boutons.map((b) => b.getAttribute("aria-label"))).toEqual(["Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  expect(boutons.map((b) => b.querySelector("svg").outerHTML)).toEqual(["chevron-up", "chevron-down", "x"].map((n) => icone(n).outerHTML));
  vi.useFakeTimers();
  const attendus = ["Occurrence précédente (Maj+F3)", "Occurrence suivante (F3)", "Fermer la recherche (Échap)"];
  boutons.forEach((b, i) => {
    b.parentElement.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(500);
    const bulle = document.querySelector(".info-bulle");
    expect(bulle.textContent).toBe(attendus[i]);
    expect(bulle.getAttribute("role")).toBe("tooltip");
    b.parentElement.dispatchEvent(new Event("pointerleave"));
  });
  const ordre = [...p.querySelectorAll("input, .ya-recherche-compteur, button")].map((e) => e.tagName + (e.className.includes("compteur") ? "C" : ""));
  expect(ordre).toEqual(["INPUT", "BUTTON", "BUTTON", "SPANC", "BUTTON", "BUTTON", "BUTTON"]);
});

test("REQ159_AC10_boutons_inactifs_et_zone_status", () => {
  const z = monter();
  z.recherche.ouvrir();
  expect(bt(z, "Occurrence suivante").getAttribute("aria-disabled")).toBe("true");
  expect(statut(z)).toBe("");
  for (const nom of ["Occurrence précédente", "Occurrence suivante"]) {
    expect(bt(z, nom).disabled).toBe(false);
    bt(z, nom).focus();
    expect(document.activeElement).toBe(bt(z, nom));
  }
  const vide = sel(z);
  bt(z, "Occurrence suivante").click();
  touche(champ(z), "F3");
  touche(z.vue.contentDOM, "F3");
  expect(sel(z)).toEqual(vide);
  expect(compteur(z)).toBe("");
  taper(z, "zzz");
  expect(bt(z, "Occurrence précédente").getAttribute("aria-disabled")).toBe("true");
  expect(statut(z)).toBe("Aucune occurrence");
  const avant = sel(z);
  bt(z, "Occurrence suivante").click();
  touche(champ(z), "F3");
  expect(sel(z)).toEqual(avant);
  expect(compteur(z)).toBe("0");
  expect(bt(z, "Occurrence précédente").disabled).toBe(false);
  taper(z, "yaide");
  expect(bt(z, "Occurrence suivante").hasAttribute("aria-disabled")).toBe(false);
  expect(statut(z)).toBe("3 occurrences");
  taper(z, "trois");
  expect(statut(z)).toBe("1 occurrence");
});

test("REQ159_AC11_occurrence_courante", () => {
  const z = monter();
  z.recherche.ouvrir();
  taper(z, "yaide");
  touche(champ(z), "F3");
  expect(compteur(z)).toBe("1 sur 3");
  expect(statut(z)).toBe("Occurrence 1 sur 3");
  expect(z.querySelectorAll(".ya-occurrence-courante")).toHaveLength(1);
  z.vue.dispatch({ selection: { anchor: 7 } });
  expect(z.querySelectorAll(".ya-occurrence-courante")).toHaveLength(0);
  expect(compteur(z)).toBe("3");
});

test("REQ159_AC12_clavier", () => {
  const z = monter();
  z.recherche.ouvrir();
  expect(document.activeElement).toBe(champ(z));
  taper(z, "yaide");
  touche(champ(z), "Enter");
  expect(sel(z)).toEqual([0, 5]);
  touche(champ(z), "Enter");
  expect(sel(z)).toEqual([9, 14]);
  touche(champ(z), "Enter", { shiftKey: true });
  expect(sel(z)).toEqual([0, 5]);
  touche(champ(z), "F3", { shiftKey: true });
  expect(sel(z)).toEqual([20, 25]);
  // Ctrl+F depuis la croix
  bt(z, "Fermer la recherche").focus();
  const ev = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
  bt(z, "Fermer la recherche").dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(champ(z));
  expect([champ(z).selectionStart, champ(z).selectionEnd]).toEqual([0, 5]);
  // Ordre de Tab : champ, précédente, suivante, fermer, puis l'éditeur
  const tabulables = [...panneau(z).querySelectorAll("input, button")];
  expect(tabulables.every((e) => e.tabIndex === 0)).toBe(true);
  expect(tabulables.map((e) => e.getAttribute("aria-label") ?? e.tagName)).toEqual(["INPUT", "Respecter la casse", "Expression régulière", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  expect(tabulables.some((e) => e.getAttribute("tabindex") === "-1")).toBe(false);
  const contenu = z.vue.contentDOM;
  expect(contenu.getAttribute("tabindex")).not.toBe("-1");
  expect(contenu.getAttribute("contenteditable")).toBe("true");
  expect(tabulables.at(-1).compareDocumentPosition(contenu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Entrée sur un bouton n'est pas détournée vers l'occurrence suivante
  const avantEntree = sel(z);
  const entree = touche(bt(z, "Occurrence suivante"), "Enter");
  expect(entree).toBe(true);
  expect(sel(z)).toEqual(avantEntree);
  // Échap dans le champ ferme ; dans l'éditeur, non
  z.recherche.ouvrir();
  touche(z.vue.contentDOM, "Escape");
  expect(panneau(z)).not.toBeNull();
  touche(champ(z), "Escape");
  expect(panneau(z)).toBeNull();
});

test("REQ159_etat_reprendre_et_sans_option", () => {
  const z = monter();
  z.recherche.reprendre({ texte: "yaide", ouvert: true });
  expect(compteur(z)).toBe("3");
  expect(champ(z).value).toBe("yaide");
  expect(z.recherche.etat()).toEqual({ texte: "yaide", ouvert: true });
  const nue = zoneCode({ contenu: DOC, langage: "markdown", nom: "a.md" });
  expect(nue.recherche).toBeUndefined();
});

test("REQ159_AC12_entree_sur_la_croix_ferme_le_panneau", () => {
  const z = monter();
  z.recherche.ouvrir();
  taper(z, "yaide");
  const croix = bt(z, "Fermer la recherche");
  croix.focus();
  // Entrée sur un bouton natif déclenche son clic : le panneau ne la détourne pas.
  const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  croix.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(false);
  expect(sel(z)).toEqual([0, 0]);
  croix.click();
  expect(panneau(z)).toBeNull();
});
