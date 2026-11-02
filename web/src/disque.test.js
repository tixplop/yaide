import { expect, test } from "vitest";
import { decisionDisque } from "./disque.js";

const ouvert = (modifie) => ({ disque: "a", version: "1-1", modifie });
const lu = (contenu, version = "2-2") => ({ contenu, version });

test("REQ017_AC1_fichier_sans_modification_change_sur_le_disque_est_recharge", () => {
  expect(decisionDisque(ouvert(false), lu("b"))).toBe("recharger");
});
test("REQ017_AC2_fichier_modifie_change_sur_le_disque_demande_la_version_a_garder", () => {
  expect(decisionDisque(ouvert(true), lu("b"))).toBe("demander");
});
test("REQ017_AC5_AC6_AC8_changement_pendant_une_coupure_ou_dans_un_autre_onglet_suit_la_meme_regle", () => {
  expect(decisionDisque(ouvert(true), lu("autre", "9-9"))).toBe("demander");
  expect(decisionDisque(ouvert(false), lu("autre", "9-9"))).toBe("recharger");
});
test("REQ017_AC1_un_changement_de_date_sans_changement_de_contenu_est_adopte_sans_question", () => {
  expect(decisionDisque(ouvert(true), lu("a"))).toBe("adopter");
  expect(decisionDisque(ouvert(false), lu("a"))).toBe("adopter");
});
test("REQ017_AC1_meme_version_ne_fait_rien", () => {
  expect(decisionDisque(ouvert(true), lu("a", "1-1"))).toBe("rien");
  expect(decisionDisque(ouvert(true), lu("b", "1-1"))).toBe("rien");
});
test("REQ017_AC9_fichier_disparu_est_signale", () => {
  expect(decisionDisque(ouvert(true), { cause: "introuvable", message: "Fichier introuvable." })).toBe("supprime");
  expect(decisionDisque(ouvert(false), { cause: "introuvable", message: "Fichier introuvable." })).toBe("supprime");
});
test("REQ017_AC5_une_lecture_sans_reponse_ou_refusee_ne_change_rien", () => {
  expect(decisionDisque(ouvert(true), { coupure: true })).toBe("rien");
  expect(decisionDisque(ouvert(true), { cause: "binaire", message: "x" })).toBe("rien");
});
