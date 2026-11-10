import { beforeEach, expect, test, vi } from "vitest";

const LISTE = [
  { chemin: "", nom: "yaide", branche: "main", detachee: false },
  { chemin: "../essai", nom: "essai", branche: "essai", detachee: false },
  { chemin: ".claude/worktrees/x", nom: "x", branche: "", detachee: true },
];
let w;
beforeEach(async () => {
  vi.resetModules();
  w = await import("./worktree.js");
});

test("REQ086_AC2_AC3_choix_partage_entre_deux_abonnes", () => {
  w.mettreAJour(LISTE);
  const a = vi.fn();
  const b = vi.fn();
  w.abonner(a);
  w.abonner(b);
  expect(w.choisi()).toBe("");
  w.choisir("../essai");
  expect(w.choisi()).toBe("../essai");
  expect(w.nomChoisi()).toBe("essai");
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
  w.choisir("");
  expect(w.nomChoisi()).toBe("yaide");
  expect(b).toHaveBeenCalledTimes(2);
});

test("REQ086_AC2_desabonner_et_pas_de_notification_sans_changement", () => {
  const a = vi.fn();
  const off = w.abonner(a);
  w.choisir("");
  expect(a).not.toHaveBeenCalled();
  off();
  w.choisir("../essai");
  expect(a).not.toHaveBeenCalled();
});

test("REQ086_AC3_retour_au_projet_quand_le_choisi_disparait", () => {
  w.mettreAJour(LISTE);
  w.choisir("../essai");
  const a = vi.fn();
  w.abonner(a);
  w.mettreAJour([LISTE[0]]);
  expect(w.choisi()).toBe("");
  expect(a).toHaveBeenCalledWith({ disparu: "essai" });
  expect(w.lister()).toEqual([LISTE[0]]);
});

test("REQ086_AC3_liste_mise_a_jour_sans_perte_du_choisi_notifie_sans_disparu", () => {
  w.mettreAJour(LISTE);
  w.choisir("../essai");
  const a = vi.fn();
  w.abonner(a);
  w.mettreAJour(LISTE.slice(0, 2));
  expect(w.choisi()).toBe("../essai");
  expect(a).toHaveBeenCalledWith({ disparu: undefined });
});

test("REQ086_AC1_texte_nom_et_branche_ou_detachee", () => {
  expect(w.texte(LISTE[1])).toBe("essai (essai)");
  expect(w.texte(LISTE[2])).toBe("x (détachée)");
});

test("REQ086_AC13_conversions_de_chemins", () => {
  w.mettreAJour(LISTE);
  expect(w.dansWorktree("src/a.rs")).toBe("src/a.rs");
  expect(w.depuisWorktree("src/a.rs")).toBe("src/a.rs");
  w.choisir("../essai");
  expect(w.dansWorktree("../essai/src/main.rs")).toBe("src/main.rs");
  expect(w.dansWorktree("../essai")).toBe("");
  expect(w.depuisWorktree("src/main.rs")).toBe("../essai/src/main.rs");
  expect(w.depuisWorktree("")).toBe("../essai");
  w.choisir(".claude/worktrees/x");
  expect(w.dansWorktree(".claude/worktrees/x/a.rs")).toBe("a.rs");
  expect(w.depuisWorktree("a.rs")).toBe(".claude/worktrees/x/a.rs");
});

test("REQ086_AC9_rien_dans_le_stockage_et_etat_neuf_sur_projet", () => {
  const sets = vi.spyOn(Storage.prototype, "setItem");
  w.mettreAJour(LISTE);
  w.choisir("../essai");
  expect(sets).not.toHaveBeenCalled();
  expect(localStorage.length + sessionStorage.length).toBe(0);
  vi.resetModules();
  return import("./worktree.js").then((n) => expect(n.choisi()).toBe(""));
});

test("REQ086_occupe_notifie", () => {
  const a = vi.fn();
  w.abonner(a);
  expect(w.occupe()).toBeUndefined();
  w.occuper("Attendez la fin du push.");
  expect(w.occupe()).toBe("Attendez la fin du push.");
  w.occuper();
  expect(w.occupe()).toBeUndefined();
  expect(a).toHaveBeenCalledTimes(2);
});

function simuler() {
  const f = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", f);
  return f;
}
const url = (f, i = 0) => f.mock.calls[i][0];

test("REQ086_AC3_api_git_ajoute_worktree_quand_choisi", async () => {
  const api = await import("./api.js");
  w = await import("./worktree.js");
  w.mettreAJour(LISTE);
  w.choisir("../essai");
  const f = simuler();
  await api.gitEtat();
  await api.gitDiff("a b.rs");
  await api.gitIndexer("a.rs");
  await api.gitCommit("m");
  await api.gitBranche("x");
  await api.gitPull();
  await api.gitPush();
  expect([0, 1, 2, 3, 4, 5, 6].map((i) => url(f, i))).toEqual([
    "/api/git/etat?worktree=..%2Fessai",
    "/api/git/diff?chemin=a%20b.rs&worktree=..%2Fessai",
    "/api/git/indexer?chemin=a.rs&worktree=..%2Fessai",
    "/api/git/commit?worktree=..%2Fessai",
    "/api/git/branche?nom=x&worktree=..%2Fessai",
    "/api/git/pull?worktree=..%2Fessai",
    "/api/git/push?worktree=..%2Fessai",
  ]);
});

test("REQ086_AC3_api_git_sans_worktree_quand_projet_et_cause_worktree", async () => {
  const api = await import("./api.js");
  const f = simuler();
  await api.gitEtat();
  await api.gitDiff("a.rs");
  await api.gitCommit("m");
  expect([0, 1, 2].map((i) => url(f, i))).toEqual(["/api/git/etat", "/api/git/diff?chemin=a.rs", "/api/git/commit"]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response('{"cause":"worktree","message":"Ce worktree n\'existe plus."}', { status: 400 })));
  expect((await api.gitEtat()).cause).toBe("worktree");
});

test("REQ086_AC11_api_recherche_chemins_et_fichiers_sans_worktree", async () => {
  const api = await import("./api.js");
  w = await import("./worktree.js");
  w.mettreAJour(LISTE);
  w.choisir("../essai");
  const f = simuler();
  await api.listerChemins();
  await api.chercherTexte("x");
  await api.listerDossier("../essai");
  for (const [u] of f.mock.calls) expect(u).not.toContain("worktree=");
});
