import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mem = vi.hoisted(() => ({ gardes: { liste: [], actif: null }, ecrit: [] }));
vi.mock("./onglets-fichiers.js", async (original) => ({
  ...(await original()),
  retrouver: async () => mem.gardes,
  garder: async (liste, actif) => void mem.ecrit.push({ liste, actif }),
}));

const { decider, texteAttente } = await import("./brouillons.js");
const { vueEditeur } = await import("./vues/editeur.js");

let vues = [];
beforeEach(() => {
  vi.useFakeTimers();
  mem.gardes = { liste: [], actif: null };
  mem.ecrit = [];
});
afterEach(() => {
  for (const v of vues) v.detruire();
  vues = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function monter(options = {}) {
  const dire = vi.fn(() => document.createElement("div"));
  const surAttente = vi.fn();
  const e = vueEditeur({ dire, surAttente, ...options });
  document.body.append(e.barre, e.code);
  vues.push(e);
  return { e, dire, surAttente };
}
const taper = (e, texte) => {
  const zone = [...e.code.children].find((z) => !z.hidden && z.vue);
  zone.vue.dispatch({ changes: { from: zone.vue.state.doc.length, insert: texte } });
};
const ctrlS = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
const reponse = (corps, version = "v1") => ({ ok: true, status: 200, text: async () => corps, json: async () => ({ version }), headers: { get: () => version } });
const ecritures = (fetchMock) => fetchMock.mock.calls.filter(([, o]) => o?.method === "PUT").length; // hors vérifications du disque
const introuvable = { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "Introuvable." }) };

test("REQ016_decider_ne_reessaie_que_sur_une_coupure", () => {
  expect(decider({ texte: "x" }, { contenu: "a" })).toBe("creer");
  expect(decider({ texte: "x" }, { cause: "introuvable" })).toBe("recreer");
  expect(decider({}, { cause: "introuvable" })).toBe("ecarter");
  expect(decider({ texte: "x" }, { cause: "trop-gros" })).toBe("recreer");
  expect(decider({}, { cause: "binaire" })).toBe("ecarter");
  expect(decider({ texte: "x" }, { coupure: true })).toBe("reessayer");
  expect(decider({}, { coupure: true })).toBe("reessayer");
});

test("REQ015_AC7_phrase_d_attente_pour_un_fichier_et_pour_plusieurs", () => {
  expect(texteAttente([])).toBe("");
  expect(texteAttente(["main.rs"])).toBe("main.rs sera sauvegardé au retour.");
  expect(texteAttente(["a", "b"])).toBe("2 fichiers seront sauvegardés au retour.");
});

test("REQ016_AC1_le_texte_tape_est_garde_en_moins_d_une_seconde", async () => {
  const { e } = monter();
  await e.restaurer();
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "v1" });
  taper(e, "bc");
  await vi.advanceTimersByTimeAsync(900);
  const derniere = mem.ecrit.at(-1);
  expect(derniere.liste).toEqual([{ chemin: "main.rs", apercu: false, texte: "abc", base: "a", version: "v1", attente: false }]);
});

test("REQ005_AC8_REQ016_AC2_le_texte_tape_juste_avant_la_deconnexion_est_garde", async () => {
  const { e } = monter();
  await e.restaurer();
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "v1" });
  await vi.advanceTimersByTimeAsync(500);
  mem.ecrit = [];
  taper(e, "z");
  e.detruire();
  expect(mem.ecrit.at(-1).liste[0].texte).toBe("az");
});

test("REQ016_AC1_une_coupure_a_la_restauration_ne_perd_ni_onglet_ni_texte", async () => {
  mem.gardes = { liste: [{ chemin: "main.rs", apercu: false, texte: "abc" }, { chemin: "b.txt", apercu: false }], actif: "main.rs" };
  let appels = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      appels++;
      if (appels <= 2) throw new Error("coupure");
      return reponse(url.includes("main.rs") ? "ab" : "b");
    }),
  );
  const { e } = monter();
  e.restaurer();
  await vi.advanceTimersByTimeAsync(100);
  expect(e.barre.textContent).not.toContain("main.rs");
  await vi.advanceTimersByTimeAsync(5000);
  const onglets = [...e.barre.querySelectorAll("[role=tab]")].map((t) => t.getAttribute("aria-label"));
  expect(onglets).toEqual(["main.rs, non sauvegardé", "b.txt"]);
  expect(e.code.querySelector(".cm-content").textContent).toContain("abc");
});

test("REQ016_AC1_un_fichier_disparu_garde_son_onglet_quand_il_a_du_texte", async () => {
  mem.gardes = { liste: [{ chemin: "main.rs", apercu: false, texte: "abc" }, { chemin: "vide.txt", apercu: false }], actif: "main.rs" };
  vi.stubGlobal("fetch", vi.fn(async () => introuvable));
  const { e } = monter();
  await e.restaurer();
  const onglets = [...e.barre.querySelectorAll("[role=tab]")].map((t) => t.getAttribute("aria-label"));
  expect(onglets).toEqual(["main.rs, non sauvegardé"]);
  expect(e.code.querySelector(".cm-content").textContent).toContain("abc");
});

test("REQ017_AC5_un_brouillon_restaure_garde_sa_version_de_base_et_pose_la_question_si_le_disque_a_change", async () => {
  mem.gardes = { liste: [{ chemin: "main.rs", apercu: false, texte: "abc", base: "a", version: "v1" }], actif: "main.rs" };
  const fetchMock = vi.fn(async () => reponse("disque", "v2"));
  vi.stubGlobal("fetch", fetchMock);
  const { e } = monter();
  await e.restaurer();
  expect(e.question.querySelector("[role=alert]").textContent).toContain("main.rs a changé sur le disque. Quelle version garder ?");
  expect(e.barre.querySelector("[role=tab]").getAttribute("aria-label")).toBe("main.rs, non sauvegardé, question en attente");
  expect(e.code.querySelector(".cm-content").textContent).toContain("abc");
  expect(ecritures(fetchMock)).toBe(0);
});

test("REQ017_AC5_le_sondage_du_disque_repart_apres_un_corps_illisible_ou_une_absence_de_reponse", async () => {
  let n = 0;
  const fetchMock = vi.fn((url, o) => {
    if (!String(url).includes("/versions")) return Promise.resolve(reponse("a", "v1"));
    n++;
    if (n === 1) return Promise.resolve({ ok: true, json: async () => Promise.reject(new Error("corps coupé")) });
    if (n === 2) return new Promise((_, ko) => o.signal.addEventListener("abort", () => ko(new Error("délai"))));
    return Promise.resolve({ ok: true, json: async () => ({ "main.rs": null }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { e } = monter();
  await e.restaurer();
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "v1" });
  await vi.advanceTimersByTimeAsync(1600); // corps illisible
  await vi.advanceTimersByTimeAsync(1600 + 2100); // pas de réponse : abandon après 2 s
  await vi.advanceTimersByTimeAsync(1600);
  expect(n).toBeGreaterThanOrEqual(3);
  expect(e.question.textContent).toContain("Fichier supprimé du disque.");
});

test("REQ015_AC5_AC7_ctrl_s_en_coupure_attend_le_retour_puis_ecrit_et_retire_le_point", async () => {
  const fetchMock = vi.fn(async () => reponse("", "v2"));
  vi.stubGlobal("fetch", fetchMock);
  const { e, surAttente, dire } = monter();
  await vi.advanceTimersByTimeAsync(0);
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "v1" });
  taper(e, "b");
  e.definirEtat("coupe");
  ctrlS();
  await vi.advanceTimersByTimeAsync(10);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(dire).not.toHaveBeenCalled();
  expect(surAttente).toHaveBeenLastCalledWith("main.rs sera sauvegardé au retour.");
  expect(e.barre.querySelector("[role=tab]").getAttribute("aria-label")).toContain("non sauvegardé");
  e.definirEtat("connecte");
  await vi.advanceTimersByTimeAsync(10);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
  expect(fetchMock.mock.calls[0][1].body).toBe("ab");
  expect(surAttente).toHaveBeenLastCalledWith("");
  expect(e.barre.querySelector("[role=tab]").getAttribute("aria-label")).not.toContain("non sauvegardé");
});

test("REQ015_AC7_deux_fichiers_en_attente_et_AC4_sans_ctrl_s_rien_n_est_ecrit", async () => {
  const fetchMock = vi.fn(async () => reponse("", "v2"));
  vi.stubGlobal("fetch", fetchMock);
  const { e, surAttente } = monter();
  await vi.advanceTimersByTimeAsync(0);
  e.ouvrir({ chemin: "a.rs", contenu: "a", version: "v1" });
  e.ouvrir({ chemin: "b.rs", contenu: "b", version: "v1" });
  e.definirEtat("coupe");
  taper(e, "x");
  e.definirEtat("connecte");
  await vi.advanceTimersByTimeAsync(10);
  expect(fetchMock).not.toHaveBeenCalled();
  e.definirEtat("coupe");
  ctrlS();
  e.ouvrir({ chemin: "a.rs" });
  ctrlS();
  expect(surAttente).toHaveBeenLastCalledWith("2 fichiers seront sauvegardés au retour.");
});

test("REQ016_un_onglet_trop_gros_n_empeche_pas_les_autres_de_revenir_ni_les_brouillons", async () => {
  mem.gardes = { liste: [{ chemin: "gros.txt", apercu: false }, { chemin: "b.txt", apercu: false }], actif: "b.txt" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => (url.includes("gros") ? { ok: false, status: 413, json: async () => ({ cause: "trop-gros", message: "Trop gros." }) } : reponse("b"))),
  );
  const { e } = monter();
  await e.restaurer();
  expect([...e.barre.querySelectorAll("[role=tab]")].map((t) => t.getAttribute("aria-label"))).toEqual(["b.txt"]);
  taper(e, "z");
  await vi.advanceTimersByTimeAsync(300);
  expect(mem.ecrit.at(-1).liste[0].texte).toBe("bz");
});

test("REQ016_AC1_une_frappe_continue_est_ecrite_en_moins_d_une_seconde", async () => {
  const { e } = monter();
  await e.restaurer();
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "v1" });
  mem.ecrit = [];
  for (let i = 0; i < 9; i++) {
    taper(e, "x");
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(mem.ecrit.length).toBeGreaterThan(0);
  expect(mem.ecrit.at(-1).liste[0].texte).toMatch(/^ax+$/);
});

test("REQ015_AC5_ctrl_s_avant_la_detection_de_la_coupure_est_relance_apres_le_delai", async () => {
  let appels = 0;
  const fetchMock = vi.fn(async () => {
    if (++appels === 1) throw new Error("coupure");
    return reponse("", "v2");
  });
  vi.stubGlobal("fetch", fetchMock);
  const { e, dire, surAttente } = monter();
  await e.restaurer();
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "v1" });
  taper(e, "b");
  ctrlS();
  await vi.advanceTimersByTimeAsync(10);
  expect(dire).not.toHaveBeenCalled();
  expect(surAttente).toHaveBeenLastCalledWith("main.rs sera sauvegardé au retour.");
  await vi.advanceTimersByTimeAsync(4100);
  expect(ecritures(fetchMock)).toBe(2);
  expect(e.barre.querySelector("[role=tab]").getAttribute("aria-label")).not.toContain("non sauvegardé");
});

test("REQ015_AC5_la_connexion_retombe_pendant_l_execution_au_retour_le_ctrl_s_reste_en_attente", async () => {
  let appels = 0;
  const fetchMock = vi.fn(async () => {
    if (++appels === 1) throw new Error("coupure");
    return reponse("", "v2");
  });
  vi.stubGlobal("fetch", fetchMock);
  const { e, surAttente } = monter();
  await e.restaurer();
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "v1" });
  taper(e, "b");
  e.definirEtat("coupe");
  ctrlS();
  e.definirEtat("connecte");
  await vi.advanceTimersByTimeAsync(10);
  expect(surAttente).toHaveBeenLastCalledWith("main.rs sera sauvegardé au retour.");
  e.definirEtat("coupe");
  e.definirEtat("connecte");
  await vi.advanceTimersByTimeAsync(10);
  expect(ecritures(fetchMock)).toBe(2);
  expect(surAttente).toHaveBeenLastCalledWith("");
});

test("DEC019_le_ctrl_s_en_attente_est_garde_puis_execute_apres_un_rechargement", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reponse("a")));
  const { e } = monter();
  await e.restaurer();
  e.ouvrir({ chemin: "main.rs", contenu: "a", version: "v1" });
  taper(e, "b");
  e.definirEtat("coupe");
  ctrlS();
  await vi.advanceTimersByTimeAsync(300);
  const garde = mem.ecrit.at(-1).liste[0];
  expect(garde).toEqual({ chemin: "main.rs", apercu: false, texte: "ab", base: "a", version: "v1", attente: true });

  mem.gardes = { liste: [garde], actif: "main.rs" };
  const put = vi.fn(async () => reponse("", "v2"));
  vi.stubGlobal("fetch", vi.fn(async (url, o) => (o?.method === "PUT" ? put(url, o) : reponse("a"))));
  const { e: e2, surAttente } = monter();
  await e2.restaurer();
  await vi.advanceTimersByTimeAsync(10);
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0][1].body).toBe("ab");
  expect(surAttente).toHaveBeenLastCalledWith("");
});
