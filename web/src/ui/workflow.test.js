import { expect, test, vi } from "vitest";
import { workflow } from "./workflow.js";

const noeud = (id, type, titre, x, y) => ({ id, type, titre, x, y, reglages: {} });
const base = () => ({
  nom: "Revue des notes",
  publie: false,
  noeuds: [noeud("n1", "dossier", "Fichiers d'un dossier 1", 0, 0), noeud("n2", "shell", "Commande shell 1", 300, 0), noeud("n3", "agent", "Agent 1", 300, 100)],
  liens: [{ de: "n1", vers: "n2" }],
});
const pointeur = (type, x, y, cible) => {
  const e = Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 });
  cible.dispatchEvent(e);
  return e;
};
const touche = (cible, key, init = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  cible.dispatchEvent(e);
  return e;
};
function monter(options = {}) {
  const surChangement = vi.fn();
  const surChoix = vi.fn();
  const surEntree = vi.fn();
  const w = workflow({ nom: "Revue des notes", document: base(), surChangement, surChoix, surEntree, ...options });
  document.body.replaceChildren(w);
  const s = w.querySelector(".ya-wf-surface");
  s.setPointerCapture = vi.fn();
  const el = (id) => w.querySelector(`.ya-noeud[data-id="${id}"]`);
  return { w, s, el, surChangement, surChoix, surEntree };
}

test("REQ191_AC3_glisser_un_nœud_les_liens_le_suivent", () => {
  const { s, el, w, surChangement } = monter();
  const d0 = w.querySelector(".ya-wf-lien").getAttribute("d");
  expect(w.querySelectorAll(".ya-noeud")).toHaveLength(3);
  expect(el("n1").classList.contains("ya-noeud-declencheur")).toBe(true);
  expect(el("n1").querySelector(".ya-noeud-entree")).toBeNull();
  pointeur("pointerdown", 50, 20, el("n1"));
  pointeur("pointermove", 90, 60, s);
  expect(el("n1").style.left).toBe("40px");
  expect(el("n1").style.top).toBe("40px");
  expect(w.querySelector(".ya-wf-lien").getAttribute("d")).not.toBe(d0);
  expect(surChangement).not.toHaveBeenCalled();
  pointeur("pointerup", 90, 60, s);
  expect(surChangement).toHaveBeenCalledTimes(1);
  expect(surChangement.mock.calls[0][0].noeuds[0]).toMatchObject({ id: "n1", x: 40, y: 40 });
});

test("REQ191_AC3_glisser_une_sortie_remplace_lentree_refuse_boucle_deux_liens", () => {
  const { s, el, surChangement } = monter();
  // n1 -> n3 : n1 a maintenant deux liens sortants
  pointeur("pointerdown", 241, 28, el("n1").querySelector(".ya-noeud-sortie"));
  pointeur("pointermove", 350, 130, s);
  expect(el("n3").classList.contains("ya-noeud-cible")).toBe(true);
  expect(s.querySelector(".ya-wf-trace")).not.toBeNull();
  pointeur("pointerup", 350, 130, s);
  expect(surChangement.mock.calls[0][0].liens).toEqual([{ de: "n1", vers: "n2" }, { de: "n1", vers: "n3" }]);
  // n3 -> n2 remplace le lien depuis n1 ; lâché sur la moitié gauche du point d'entrée (x = m.x - 4)
  pointeur("pointerdown", 541, 128, s.querySelector('.ya-noeud[data-id="n3"] .ya-noeud-sortie'));
  pointeur("pointermove", 296, 28, s);
  expect(el("n2").classList.contains("ya-noeud-cible")).toBe(true);
  pointeur("pointerup", 296, 28, s);
  expect(surChangement.mock.calls[1][0].liens).toEqual([{ de: "n1", vers: "n3" }, { de: "n3", vers: "n2" }]);
  // n2 -> n1 (déclencheur) et n2 -> n3 (boucle) : aucun lien créé
  const avant = surChangement.mock.calls.length;
  pointeur("pointerdown", 541, 28, el("n2").querySelector(".ya-noeud-sortie"));
  pointeur("pointermove", 100, 28, s);
  expect(el("n1").classList.contains("ya-noeud-cible")).toBe(false);
  expect(el("n1").classList.contains("ya-noeud-refuse")).toBe(true);
  pointeur("pointerup", 100, 28, s);
  pointeur("pointerdown", 541, 28, el("n2").querySelector(".ya-noeud-sortie"));
  pointeur("pointermove", 400, 130, s);
  expect(el("n3").classList.contains("ya-noeud-cible")).toBe(false);
  expect(el("n3").classList.contains("ya-noeud-refuse")).toBe(true);
  pointeur("pointerup", 400, 130, s);
  expect(surChangement.mock.calls.length).toBe(avant);
  expect(el("n3").classList.contains("ya-noeud-refuse")).toBe(false);
});

test("REQ191_AC4_suppr_retire_le_nœud_et_ses_liens_echap_deselectionne", () => {
  const { s, el, w, surChangement, surChoix } = monter();
  pointeur("pointerdown", 350, 20, el("n2"));
  expect(el("n2").classList.contains("ya-noeud-choisi")).toBe(true);
  expect(surChoix).toHaveBeenLastCalledWith("n2");
  touche(s, "Delete");
  const d = surChangement.mock.calls[0][0];
  expect(d.noeuds.map((n) => n.id)).toEqual(["n1", "n3"]);
  expect(d.liens).toEqual([]);
  expect(w.querySelector(".ya-noeud-choisi")).toBeNull();
  expect(surChoix).toHaveBeenLastCalledWith(null);
  w.maj({ document: d });
  expect(w.querySelectorAll(".ya-noeud")).toHaveLength(2);
  expect(w.querySelectorAll(".ya-wf-lien")).toHaveLength(0);
  pointeur("pointerdown", 350, 120, el("n3"));
  touche(s, "Escape");
  expect(w.querySelector(".ya-noeud-choisi")).toBeNull();
  expect(surChoix).toHaveBeenLastCalledWith(null);
  expect(document.activeElement).toBe(s);
});

test("REQ192_AC3_lecture_seule_rien_ne_change_la_vue_et_le_choix_restent", () => {
  const { s, el, w, surChangement, surChoix } = monter({ lectureSeule: true });
  pointeur("pointerdown", 50, 20, el("n1"));
  pointeur("pointermove", 90, 60, s);
  pointeur("pointerup", 90, 60, s);
  expect(el("n1").style.left).toBe("0px");
  expect(el("n1").classList.contains("ya-noeud-choisi")).toBe(true);
  expect(surChoix).toHaveBeenCalledWith("n1");
  touche(s, "Delete");
  touche(s, "ArrowRight");
  pointeur("pointerdown", 541, 28, el("n2").querySelector(".ya-noeud-sortie"));
  pointeur("pointermove", 400, 130, s);
  pointeur("pointerup", 400, 130, s);
  expect(surChangement).not.toHaveBeenCalled();
  expect(w.querySelectorAll(".ya-noeud")).toHaveLength(3);
  // la vue se déplace encore
  const surVue = vi.fn();
  const m = monter({ lectureSeule: true, surVue });
  pointeur("pointerdown", 500, 500, m.s);
  pointeur("pointermove", 530, 520, m.s);
  pointeur("pointerup", 530, 520, m.s);
  expect(surVue).toHaveBeenLastCalledWith({ x: 30, y: 20, zoom: 1 });
  // Tab et Entrée gardent leur effet
  touche(m.s, "Tab");
  expect(m.surChoix).toHaveBeenLastCalledWith("n1");
  touche(m.s, "Enter");
  expect(m.surEntree).toHaveBeenCalledWith("n1");
  // publié puis dépublié : l'onglet redevient modifiable sans rechargement
  m.w.maj({ lectureSeule: false });
  touche(m.s, "ArrowRight");
  expect(m.surChangement.mock.calls[0][0].noeuds[0].x).toBe(20);
});

test("REQ191_AC9_clavier_tab_etat_entree_echap_fleches", () => {
  const { s, w, surChangement, surChoix, surEntree } = monter();
  expect(s.tabIndex).toBe(0);
  expect(s.getAttribute("aria-label")).toBe("Surface du workflow Revue des notes");
  const statut = w.querySelector('.ya-wf-statut');
  expect(touche(s, "Tab").defaultPrevented).toBe(true);
  expect(statut.textContent).toBe("Fichiers d'un dossier 1, déclencheur.");
  touche(s, "Tab");
  expect(statut.textContent).toBe("Commande shell 1, action, après Fichiers d'un dossier 1.");
  touche(s, "Tab");
  expect(statut.textContent).toBe("Agent 1, action, après aucun nœud.");
  expect(touche(s, "Tab").defaultPrevented).toBe(false); // après le dernier : on sort
  touche(s, "Tab", { shiftKey: true });
  expect(surChoix).toHaveBeenLastCalledWith("n2");
  touche(s, "Tab", { shiftKey: true });
  expect(statut.textContent).toBe("Fichiers d'un dossier 1, déclencheur.");
  expect(touche(s, "Tab", { shiftKey: true }).defaultPrevented).toBe(false); // avant le premier : on sort
  touche(s, "Tab");
  touche(s, "Enter");
  expect(surEntree).toHaveBeenCalledWith("n2");
  touche(s, "ArrowDown");
  touche(s, "ArrowLeft");
  expect(surChangement.mock.calls[0][0].noeuds[1]).toMatchObject({ x: 300, y: 20 });
  expect(surChangement.mock.calls[1][0].noeuds[1]).toMatchObject({ x: 280, y: 20 });
  touche(s, "Escape");
  expect(statut.textContent).toBe("");
  expect(document.activeElement).toBe(s);
  // Ctrl+molette : zoom par crans, de 25 à 200 %
  const surVue = vi.fn();
  const m = monter({ surVue });
  m.s.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -1, bubbles: true, cancelable: true }));
  expect(surVue.mock.calls[0][0].zoom).toBe(1.1);
});

test("REQ191_AC1_AC7_sans_nœud_la_surface_dit_dajouter_un_declencheur", () => {
  const w = workflow({ nom: "X", document: { nom: "X", publie: false, noeuds: [], liens: [] }, surChangement: vi.fn() });
  expect(w.querySelector(".ya-wf-vide").hidden).toBe(false);
  expect(w.querySelector(".ya-wf-vide").textContent).toBe("Ajoutez un déclencheur depuis le panneau Nœuds.");
});
