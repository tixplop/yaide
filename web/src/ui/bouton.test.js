import { expect, test } from "vitest";
import { bouton } from "./bouton.js";

test("REQ028_AC3_bouton_secondaire_par_defaut_et_variantes", () => {
  const b = bouton({ libelle: "Annuler" });
  expect(b.tagName).toBe("BUTTON");
  expect(b.type).toBe("button");
  expect(b.textContent).toBe("Annuler");
  expect(b.classList.contains("bouton-secondaire")).toBe(true);
  expect(bouton({ libelle: "OK", variante: "principal" }).classList.contains("bouton-principal")).toBe(true);
  expect(bouton({ libelle: "Supprimer", variante: "danger" }).classList.contains("bouton-danger")).toBe(true);
  expect(bouton({ libelle: "x", variante: "discret" }).classList.contains("bouton-discret")).toBe(true);
});

test("REQ028_AC3_bouton_titre_nom_accessible_et_desactive", () => {
  const b = bouton({ libelle: "+", nomAccessible: "Nouveau shell", titre: "Nouveau shell", desactive: true });
  expect(b.getAttribute("aria-label")).toBe("Nouveau shell");
  expect(b.title).toBe("Nouveau shell");
  expect(b.disabled).toBe(true);
});

test("REQ028_AC3_bouton_en_cours_est_desactive_et_occupe", () => {
  const b = bouton({ libelle: "Enregistrer", libelleEnCours: "Enregistrement…" });
  expect(b.textContent).toBe("Enregistrement…");
  expect(b.disabled).toBe(true);
  expect(b.getAttribute("aria-busy")).toBe("true");
  expect(bouton({ libelle: "Enregistrer" }).hasAttribute("aria-busy")).toBe(false);
});

test("REQ028_AC3_bouton_refuse_variante_inconnue_et_libelle_vide", () => {
  expect(() => bouton({ libelle: "a", variante: "rose" })).toThrow(/variante/);
  expect(() => bouton({ libelle: "" })).toThrow(/libelle/);
});

test("REQ028_AC3_bouton_signe_seul_exige_un_nom_accessible", () => {
  expect(() => bouton({ libelle: "×" })).toThrow(/nomAccessible/);
});

test("REQ028_AC3_bouton_submit_dans_un_formulaire", () => {
  expect(bouton({ libelle: "Valider", submit: true }).type).toBe("submit");
});
