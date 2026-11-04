import { expect, test } from "vitest";
import { statutsDe } from "./statuts.js";

const c = (chemin, lettre) => ({ chemin, lettre });

test("REQ039_AC1_lettre_et_mot_de_chaque_statut", () => {
  const s = statutsDe([c("a", "M"), c("b", "U"), c("c", "A"), c("d", "D"), c("e", "C"), c("f", "R")]);
  expect(s.get("a")).toEqual({ lettre: "M", mot: "modifié" });
  expect(s.get("b")).toEqual({ lettre: "U", mot: "nouveau" });
  expect(s.get("c")).toEqual({ lettre: "A", mot: "ajouté" });
  expect(s.get("d")).toEqual({ lettre: "D", mot: "supprimé" });
  expect(s.get("e")).toEqual({ lettre: "C", mot: "conflit" });
  expect(s.get("f")).toEqual({ lettre: "R", mot: "renommé" });
});

test("REQ039_AC2_un_dossier_prend_le_statut_le_plus_fort", () => {
  const s = statutsDe([c("src/a/x.rs", "U"), c("src/a/y.rs", "A"), c("src/b.rs", "M")]);
  expect(s.get("src/a").lettre).toBe("A");
  expect(s.get("src").lettre).toBe("M");
  const t = statutsDe([c("d/u", "U"), c("d/m", "M"), c("d/x", "D"), c("d/c", "C")]);
  expect(t.get("d")).toEqual({ lettre: "C", mot: "conflit" });
  expect(statutsDe([c("d/u", "U"), c("d/m", "M"), c("d/x", "D")]).get("d").lettre).toBe("D");
  expect(statutsDe([c("d/u", "U"), c("d/m", "M")]).get("d").lettre).toBe("M");
});

test("REQ039_AC9_renomme_compte_comme_modifie_pour_un_dossier", () => {
  const s = statutsDe([c("d/n", "R"), c("d/u", "U")]);
  expect(s.get("d")).toEqual({ lettre: "M", mot: "modifié" });
  expect(s.get("d/n").lettre).toBe("R");
});

test("REQ039_un_fichier_supprime_compte_pour_ses_dossiers", () => {
  const s = statutsDe([c("src/vieux.rs", "D")]);
  expect(s.get("src")).toEqual({ lettre: "D", mot: "supprimé" });
});

test("REQ039_AC4_aucun_changement_ou_pas_de_depot_ne_donne_rien", () => {
  expect(statutsDe([]).size).toBe(0);
});
