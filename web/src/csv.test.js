import { expect, test } from "vitest";
import { celluleA, changerCellule, debutChamp, insererColonne, insererRangee, lireCsv, supprimerColonne, supprimerRangee } from "./csv.js";

const CLIENTS = 'nom,ville,note\nAlice,Paris,12\n"Bob, fils",Lyon,"dit ""oui"""\nChloé,Nantes\n';
const appliquer = (texte, m) => texte.slice(0, m.from) + m.insert + texte.slice(m.to);
const textes = (l) => l.rangees.map((r) => r.champs.map((c) => c.texte));
const changer = (texte, r, c, v) => appliquer(texte, changerCellule(lireCsv(texte), r, c, v));

test("REQ157_AC1_clients_donne_4_rangees_de_3_cellules", () => {
  const l = lireCsv(CLIENTS);
  expect(l.rangees).toHaveLength(4);
  expect(l.rangees.map((r) => r.champs.length)).toEqual([3, 3, 3, 3]);
  expect(textes(l)[2]).toEqual(["Bob, fils", "Lyon", 'dit "oui"']);
  expect(textes(l)[3]).toEqual(["Chloé", "Nantes", ""]);
  expect(l.rangees[2].champs[0].guillemets).toBe(true);
  expect(l.rangees[1].champs[0]).toMatchObject({ texte: "Alice", de: 15, a: 20, guillemets: false });
});

test("REQ157_AC3_une_cellule_modifiee_change_seule", () => {
  const m = changerCellule(lireCsv(CLIENTS), 1, 2, "15");
  expect(m).toEqual({ from: 27, to: 29, insert: "15" });
  expect(appliquer(CLIENTS, m)).toBe(CLIENTS.replace("Paris,12", "Paris,15"));
});

test("REQ157_AC4_guillemets_selon_la_valeur", () => {
  expect(changer(CLIENTS, 2, 0, "Bob")).toBe(CLIENTS.replace('"Bob, fils"', '"Bob"'));
  expect(changer(CLIENTS, 1, 1, "a,b")).toContain('Alice,"a,b",12');
  expect(changer(CLIENTS, 1, 1, 'dit "non"')).toContain('Alice,"dit ""non""",12');
  expect(changer(CLIENTS, 1, 1, " x")).toContain('Alice," x",12');
  expect(changer(CLIENTS, 1, 1, "x ")).toContain('Alice,"x ",12');
  expect(changer(CLIENTS, 1, 1, "x")).toContain("Alice,x,12");
  expect(textes(lireCsv(changer(CLIENTS, 1, 1, "a,b")))[1]).toEqual(["Alice", "a,b", "12"]);
});

test("REQ157_AC5_une_cellule_qui_manque_ajoute_les_separateurs", () => {
  expect(changer(CLIENTS, 3, 2, "x")).toBe(CLIENTS.replace("Chloé,Nantes", "Chloé,Nantes,x"));
  expect(changer("a\nb,c,d\n", 0, 2, "z")).toBe("a,,z\nb,c,d\n");
});

test("REQ157_AC6_separateur_point_virgule_fin_de_ligne_et_fichier_vide", () => {
  const notes = "nom;ville\nAlice;Paris,Lyon\n";
  const l = lireCsv(notes);
  expect(l.separateur).toBe(";");
  expect(textes(l)[1]).toEqual(["Alice", "Paris,Lyon"]);
  expect(changer(notes, 1, 1, "a;b")).toBe('nom;ville\nAlice;"a;b"\n');
  expect(changer(notes, 1, 1, "a,b")).toBe("nom;ville\nAlice;a,b\n");
  const crlf = "a,b\r\nc,d\r\n";
  expect(lireCsv(crlf).finLigne).toBe("\r\n");
  expect(changer(crlf, 1, 0, "z")).toBe("a,b\r\nz,d\r\n");
  const aj = appliquer(crlf, insererRangee(lireCsv(crlf), 2));
  expect(aj).toBe("a,b\r\nc,d\r\n,\r\n");
  expect(aj.replace(/\r\n/g, "")).not.toContain("\n");
  expect(textes(lireCsv(""))).toEqual([[""]]);
  expect(lireCsv("").finLigne).toBe("\n");
  expect(changer("", 0, 0, "a")).toBe("a");
});

test("REQ157_AC6_fin_de_ligne_de_la_premiere_ligne_avec_fins_melangees", () => {
  const t = "a,b\r\nc,d\ne,f\r\n";
  const l = lireCsv(t);
  expect(l.finLigne).toBe("\r\n");
  expect(appliquer(t, insererRangee(l, 0))).toBe(",\r\n" + t);
  const t2 = "a,b\nc,d\r\n";
  expect(lireCsv(t2).finLigne).toBe("\n");
  expect(textes(lireCsv(t2))).toEqual([["a", "b"], ["c", "d"]]);
  expect(appliquer(t2, insererRangee(lireCsv(t2), 0))).toBe(",\n" + t2);
});

test("REQ157_AC7_inserer_et_supprimer_colonnes_et_rangees", () => {
  const l = lireCsv(CLIENTS);
  expect(appliquer(CLIENTS, insererColonne(l, 1))).toBe('nom,,ville,note\nAlice,,Paris,12\n"Bob, fils",,Lyon,"dit ""oui"""\nChloé,,Nantes\n');
  expect(appliquer("a,b\nc\n", insererColonne(lireCsv("a,b\nc\n"), 2))).toBe("a,b,\nc\n");
  expect(appliquer(CLIENTS, insererRangee(l, 0))).toBe(",,\n" + CLIENTS);
  expect(appliquer(CLIENTS, supprimerRangee(l, 0))).toBe(CLIENTS.slice(CLIENTS.indexOf("\n") + 1));
  expect(appliquer(CLIENTS, supprimerColonne(l, 2))).toBe('nom,ville\nAlice,Paris\n"Bob, fils",Lyon\nChloé,Nantes\n');
  expect(appliquer(CLIENTS, supprimerColonne(l, 0))).toBe('ville,note\nParis,12\nLyon,"dit ""oui"""\nNantes\n');
  expect(appliquer("a\nb", supprimerRangee(lireCsv("a\nb"), 1))).toBe("a");
  expect(appliquer(CLIENTS, supprimerRangee(l, 3))).toBe(CLIENTS.replace("Chloé,Nantes\n", ""));
  expect(appliquer(CLIENTS, supprimerColonne(l, 1)).endsWith("\n")).toBe(true);
});

test("REQ157_AC7_une_seule_modification_de_la_premiere_a_la_derniere_zone", () => {
  const l = lireCsv(CLIENTS);
  const m = supprimerColonne(l, 2);
  // de la fin de « ville » de la 1re rangée à la fin de la dernière rangée touchée : le texte intermédiaire est repris tel quel
  expect(m.from).toBe(CLIENTS.indexOf(",note"));
  expect(m.to).toBe(CLIENTS.indexOf("\nChloé"));
  expect(m.insert).toBe('\nAlice,Paris\n"Bob, fils",Lyon');
  expect(appliquer(CLIENTS, m)).toBe('nom,ville\nAlice,Paris\n"Bob, fils",Lyon\nChloé,Nantes\n');
  const ins = insererColonne(l, 1);
  expect(ins.from).toBe(CLIENTS.indexOf("ville"));
});

test("REQ157_AC7_inserer_dans_fichier_a_une_colonne", () => {
  expect(appliquer("a\n", insererRangee(lireCsv("a\n"), 1))).toBe("a\n\n");
  expect(textes(lireCsv(appliquer("a", insererRangee(lireCsv("a"), 1))))).toEqual([["a"], [""]]);
  expect(appliquer("a,b", insererRangee(lireCsv("a,b"), 1))).toBe("a,b\n,");
  const vide = appliquer("", insererRangee(lireCsv(""), 0));
  expect(textes(lireCsv(vide))).toEqual([[""], [""]]);
});

test("REQ157_AC8_cellule_multiligne", () => {
  const t = 'a,b\n"ligne 1\nligne 2",x\n';
  const l = lireCsv(t);
  expect(l.rangees).toHaveLength(2);
  expect(textes(l)[1]).toEqual(["ligne 1\nligne 2", "x"]);
  expect(changer(t, 1, 1, "y")).toBe('a,b\n"ligne 1\nligne 2",y\n');
});

test("REQ157_AC9_refus_guillemet_non_ferme_et_trop_de_rangees", () => {
  expect(lireCsv('a,b\nc,d\n"Bob, fils,Lyon\n').refus).toBe("guillemet non fermé à la ligne 3.");
  const n = (k) => Array.from({ length: k }, (_, i) => `r${i},x`).join("\n") + "\n";
  expect(lireCsv(n(2001)).refus).toBe("plus de 2 000 lignes.");
  const ok = lireCsv(n(2000));
  expect(ok.refus).toBeUndefined();
  expect(ok.rangees).toHaveLength(2000);
});

test("REQ157_AC17_position_et_champ", () => {
  const l = lireCsv(CLIENTS);
  const lyon = CLIENTS.indexOf("Lyon");
  expect(celluleA(l, lyon)).toEqual({ r: 2, c: 1 });
  expect(celluleA(l, lyon + 2)).toEqual({ r: 2, c: 1 });
  expect(debutChamp(l, 1, 1)).toBe(CLIENTS.indexOf("Paris"));
  expect(celluleA(l, 0)).toEqual({ r: 0, c: 0 });
});
