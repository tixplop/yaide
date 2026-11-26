import { expect, test } from "vitest";
import { ajouter, cadrer, apresDe, delier, deplacer, lier, montrer, noeudsPermisApres, phraseDuChoix, retirer, zoomer } from "./workflow.js";

const vide = { nom: "Revue", publie: false, noeuds: [], liens: [] };

function trois() {
  let d = ajouter(vide, "dossier").doc;
  d = ajouter(d, "shell", { apres: "n1" }).doc;
  d = ajouter(d, "agent").doc;
  return d;
}

test("REQ191_AC2_ajout_titre_plus_petit_numero_libre_et_place", () => {
  const a = ajouter(vide, "dossier");
  expect(a.doc.noeuds[0]).toMatchObject({ id: "n1", titre: "Fichiers d'un dossier 1", x: 40, y: 40 });
  const b = ajouter(a.doc, "shell", { apres: "n1" });
  expect(b.doc.noeuds[1]).toMatchObject({ titre: "Commande shell 1", x: 40 + 240 + 64, y: 40 });
  expect(b.doc.liens).toEqual([{ de: "n1", vers: "n2" }]);
  // le numéro 1 est libre à nouveau : il est repris
  const c = ajouter(retirer(b.doc, "n2"), "shell");
  expect(c.doc.noeuds[1].titre).toBe("Commande shell 1");
  expect(c.doc.noeuds[1]).toMatchObject({ x: 40, y: 40 + 56 + 32 });
  // place prise : 88 px plus bas
  const d = ajouter(b.doc, "agent", { apres: "n1" });
  expect(d.doc.noeuds[2]).toMatchObject({ x: 344, y: 128 });
  expect(() => ajouter(vide, "inconnu")).toThrow(/type/);
  // un déclencheur n'est jamais relié
  expect(ajouter(b.doc, "planification", { apres: "n1" }).doc.liens).toHaveLength(1);
});

test("REQ191_AC3_lien_remplace_entree_refuse_boucle_et_sorties_multiples", () => {
  let d = trois(); // n1 déclencheur, n2 après n1, n3 libre
  d = lier(d, "n2", "n3");
  expect(d.liens).toEqual([{ de: "n1", vers: "n2" }, { de: "n2", vers: "n3" }]);
  // B avait un lien depuis C : il est retiré
  d = lier(d, "n1", "n3");
  expect(apresDe(d, "n3")).toBe("n1");
  expect(d.liens).toHaveLength(2);
  // A -> B existe : B -> A refusé ; boucle plus longue refusée ; entrée d'un déclencheur refusée
  expect(lier(d, "n2", "n1")).toBe(d);
  d = lier(d, "n2", "n3");
  expect(lier(d, "n3", "n2")).toBe(d);
  expect(lier(d, "n2", "n2")).toBe(d);
  // une sortie vers deux actions
  const e = lier(trois(), "n1", "n3");
  expect(e.liens.filter((l) => l.de === "n1")).toHaveLength(2);
});

test("REQ191_AC4_apres_aucun_retrait_et_nœuds_permis", () => {
  const d = lier(trois(), "n2", "n3");
  expect(delier(d, "n3").liens).toEqual([{ de: "n1", vers: "n2" }]);
  expect(noeudsPermisApres(d, "n2").map((n) => n.id)).toEqual(["n1"]);
  expect(noeudsPermisApres(d, "n3").map((n) => n.id)).toEqual(["n1", "n2"]);
  const r = retirer(d, "n2");
  expect(r.noeuds.map((n) => n.id)).toEqual(["n1", "n3"]);
  expect(r.liens).toEqual([]);
});

test("REQ191_AC9_phrase_deplacement_zoom_et_vue", () => {
  const d = trois();
  expect(phraseDuChoix(d, "n2")).toBe("Commande shell 1, action, après Fichiers d'un dossier 1.");
  expect(phraseDuChoix(d, "n1")).toBe("Fichiers d'un dossier 1, déclencheur.");
  expect(phraseDuChoix(d, "n3")).toBe("Agent 1, action, après aucun nœud.");
  expect(deplacer(d, "n1", 60, 70).noeuds[0]).toMatchObject({ x: 60, y: 70 });
  let v = { x: 0, y: 0, zoom: 1 };
  for (let i = 0; i < 30; i++) v = zoomer(v, 1, 100, 100);
  expect(v.zoom).toBe(2);
  for (let i = 0; i < 30; i++) v = zoomer(v, -1);
  expect(v.zoom).toBe(0.25);
  const z = zoomer({ x: 0, y: 0, zoom: 1 }, 1, 100, 100);
  expect(z.zoom).toBe(1.1);
  expect(z.x).toBeCloseTo(-10);
  expect(z.y).toBeCloseTo(-10);
  expect(montrer({ x: 0, y: 0, zoom: 1 }, { x: 600, y: 10 }, 500, 400)).toEqual({ x: -(600 + 240 - 500 + 24), y: 14, zoom: 1 });
});

test("REQ191_AC7_tout_afficher_cadre_tous_les_noeuds_sans_depasser_100_pour_cent", () => {
  const n = (id, x, y) => ({ id, type: "shell", titre: id, x, y, reglages: {} });
  expect(cadrer({ noeuds: [], liens: [] }, 800, 400)).toEqual({ x: 0, y: 0, zoom: 1 });
  // Un seul nœud (240 × 56) : zoom 1, centré.
  expect(cadrer({ noeuds: [n("a", 100, 100)], liens: [] }, 800, 400)).toEqual({ x: 280 - 100, y: 172 - 100, zoom: 1 });
  // Deux nœuds éloignés : 1240 de large → (800 - 48) / 1240.
  const v = cadrer({ noeuds: [n("a", 0, 0), n("b", 1000, 0)], liens: [] }, 800, 400);
  expect(v.zoom).toBeCloseTo(752 / 1240, 5);
  expect(v.x).toBeCloseTo((800 - 1240 * v.zoom) / 2, 5);
});
