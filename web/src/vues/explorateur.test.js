import { expect, test } from "vitest";
import { REFUS_CONTENU, REFUS_LECTURE, lireElements } from "./explorateur.js";

const fichier = (nom, octets = "x") => ({ isDirectory: false, name: nom, file: (ok) => ok(new File([octets], nom)) });
const illisible = (nom) => ({ isDirectory: false, name: nom, file: (_, ko) => ko(new Error("refus")) });
/** Un dossier dont `readEntries` rend les enfants par lots de `taille`, puis une liste vide. */
const dossier = (nom, enfants, taille = 2) => {
  let reste = [...enfants];
  return { isDirectory: true, name: nom, createReader: () => ({ readEntries: (ok) => ok(reste.splice(0, taille)) }) };
};
const item = (entree, direct = null) => ({ kind: "file", webkitGetAsEntry: () => entree, getAsFile: () => direct });

test("REQ180_AC2_dossier_sous_dossier_dossier_vide_et_readEntries_en_plusieurs_lots", async () => {
  const photos = dossier("photos", [fichier("a.jpg"), dossier("2024", [fichier("b.jpg"), fichier("c.jpg"), fichier("d.jpg")]), dossier("vide", []), fichier("e.jpg")]);
  const [el] = await lireElements([item(photos)]);
  expect(el.nom).toBe("photos");
  expect(el.dossier).toBe(true);
  expect(el.enfants.map((x) => x.nom)).toEqual(["a.jpg", "2024", "vide", "e.jpg"]);
  expect(el.enfants[1].enfants.map((x) => x.nom)).toEqual(["b.jpg", "c.jpg", "d.jpg"]);
  expect(el.enfants[2]).toEqual({ nom: "vide", dossier: true, enfants: [] });
  expect(el.enfants[0].fichier.name).toBe("a.jpg");
});

test("REQ180_AC2_les_entrees_sont_prises_avant_le_premier_await_et_un_element_sans_entree_passe_par_getAsFile", async () => {
  const appels = [];
  const it = (nom) => ({ kind: "file", webkitGetAsEntry: () => (appels.push(nom), fichier(nom)), getAsFile: () => null });
  const sansEntree = { kind: "file", webkitGetAsEntry: () => null, getAsFile: () => new File(["z"], "z.txt") };
  const texte = { kind: "string", webkitGetAsEntry: () => { throw new Error("ignoré"); } };
  const promesse = lireElements([it("a"), it("b"), sansEntree, texte]);
  expect(appels).toEqual(["a", "b"]); // avant toute attente
  const els = await promesse;
  expect(els.map((x) => x.nom)).toEqual(["a", "b", "z.txt"]);
});

test("REQ180_AC5_fichier_illisible_et_dossier_sans_contenu_sont_refuses_les_autres_passent", async () => {
  const sansContenu = { isDirectory: true, name: "d", createReader: () => ({ readEntries: (_, ko) => ko(new Error("refus")) }) };
  const els = await lireElements([item(illisible("x.txt")), item(sansContenu), item(fichier("ok.txt")), item(null, null)]);
  expect(els[0]).toEqual({ nom: "x.txt", dossier: false, refus: REFUS_LECTURE });
  expect(els[1]).toEqual({ nom: "d", dossier: true, refus: REFUS_CONTENU });
  expect(els[2].fichier.name).toBe("ok.txt");
  expect(els).toHaveLength(3); // l'élément sans entrée ni fichier est ignoré
});
