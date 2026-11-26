import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { envoyerEnAttente, gravite, journaliser, lignes, purger, reinitialiser, relire, suivre, suivreErreursPage } from "./journal.js";
import { afficher, zoneToasts } from "./ui/toasts.js";

// Serveur simulé : `s.coupe` fait échouer tout appel, `s.lignes` est le journal du serveur.
let s;
const envois = () => s.appels.filter((a) => a.methode === "POST");
beforeEach(() => {
  reinitialiser();
  document.body.replaceChildren(zoneToasts());
  s = { coupe: false, purge: 1, lignes: [], suivant: 1, appels: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, opts = {}) => {
      const methode = opts.method ?? "GET";
      if (s.coupe) throw new TypeError("coupure");
      s.appels.push({ methode, url, corps: opts.body });
      const rep = (corps) => ({ ok: true, status: 200, json: async () => corps });
      if (methode === "POST") {
        for (const l of JSON.parse(opts.body).lignes) s.lignes.push({ numero: s.suivant++, ...l });
        return rep({});
      }
      if (methode === "DELETE") {
        s.lignes = [];
        s.purge += 1;
        return rep({});
      }
      const apres = Number(new URL(url, "http://x").searchParams.get("apres"));
      return rep({ purge: s.purge, lignes: s.lignes.filter((l) => l.numero > apres) });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

test("REQ187_AC1_la_gravite_suit_la_ligne_la_plus_grave_et_revient_apres_la_purge", async () => {
  expect(gravite()).toBe("rien");
  journaliser({ severite: "information", message: "ok" });
  expect(gravite()).toBe("rien");
  journaliser({ severite: "avertissement", message: "attention" });
  expect(gravite()).toBe("avertissements");
  s.lignes.push({ numero: 99, heure: 5, severite: "Erreur", message: "du serveur" });
  await relire();
  expect(gravite()).toBe("erreurs");
  expect(await purger()).toBe(true);
  expect(gravite()).toBe("rien");
  expect(lignes()).toEqual([]);
});

test("REQ186_AC1_une_ligne_de_la_page_est_montree_aussitot_puis_revient_du_serveur_sans_doublon", async () => {
  const evenements = [];
  suivre((e) => evenements.push(e));
  journaliser({ severite: "erreur", message: "Lien refusé", detail: "sortie" });
  expect(lignes()).toHaveLength(1);
  expect(lignes()[0]).toMatchObject({ severite: "erreur", message: "Lien refusé", detail: "sortie" });
  expect(evenements).toHaveLength(1);
  await vi.waitFor(() => expect(envois()).toHaveLength(1));
  expect(JSON.parse(envois()[0].corps).lignes[0]).toMatchObject({ severite: "Erreur", message: "Lien refusé", detail: "sortie" });
  await relire();
  expect(lignes()).toHaveLength(1);
  expect(lignes()[0].numero).toBe(1);
  expect(evenements).toHaveLength(1);
});

test("REQ186_AC1_une_ligne_d_une_autre_page_arrive_a_la_relecture_apres_la_derniere_vue", async () => {
  const evenements = [];
  suivre((e) => evenements.push(e));
  s.lignes.push({ numero: 1, heure: 10, severite: "Information", message: "démarrage" });
  await relire();
  s.lignes.push({ numero: 2, heure: 20, severite: "Avertissement", message: "autre page" });
  await relire();
  expect(s.appels.map((a) => a.url)).toEqual(["/api/journal?apres=0", "/api/journal?apres=1"]);
  expect(lignes().map((l) => [l.severite, l.message])).toEqual([["information", "démarrage"], ["avertissement", "autre page"]]);
  expect(evenements.map((e) => e.type)).toEqual(["ajout", "ajout"]);
});

test("REQ186_AC2_pendant_une_coupure_la_ligne_est_montree_et_envoyee_une_fois_au_retour_avec_son_heure", async () => {
  s.coupe = true;
  journaliser({ severite: "avertissement", message: "Connexion perdue. Modifications gardées.", heure: 1234 });
  await envoyerEnAttente();
  expect(lignes()).toHaveLength(1);
  expect(gravite()).toBe("avertissements");
  s.coupe = false;
  await envoyerEnAttente();
  await envoyerEnAttente();
  expect(envois()).toHaveLength(1);
  expect(JSON.parse(envois()[0].corps).lignes).toEqual([{ heure: 1234, severite: "Avertissement", message: "Connexion perdue. Modifications gardées." }]);
  await relire();
  expect(lignes()).toHaveLength(1);
});

test("REQ188_AC6_la_purge_d_une_autre_page_vide_celle_ci_a_sa_relecture_et_garde_ses_lignes_non_envoyees", async () => {
  s.lignes.push({ numero: 1, heure: 10, severite: "Erreur", message: "ancienne" });
  await relire();
  expect(gravite()).toBe("erreurs");
  const evenements = [];
  suivre((e) => evenements.push(e));
  s.lignes = [];
  s.purge += 1;
  s.coupe = true;
  journaliser({ severite: "information", message: "gardée" });
  s.coupe = false;
  s.lignes.push({ numero: 1, heure: 30, severite: "Information", message: "nouvelle" });
  await relire();
  expect(lignes().map((l) => l.message)).toEqual(["nouvelle", "gardée"]);
  expect(gravite()).toBe("rien");
  expect(evenements.at(-1).type).toBe("remplace");
});

test("REQ188_AC6_purge_pendant_une_coupure_toast_connexion_perdue_et_rien_n_est_purge", async () => {
  s.lignes.push({ numero: 1, heure: 10, severite: "Erreur", message: "ancienne" });
  await relire();
  s.coupe = true;
  expect(await purger()).toBe(false);
  expect(gravite()).toBe("erreurs");
  expect(lignes().some((l) => l.message === "ancienne")).toBe(true);
  await vi.waitFor(() => expect([...document.querySelectorAll(".ya-toast")].some((t) => t.textContent.includes("Connexion perdue. Réessayez au retour."))).toBe(true));
});

test("REQ186_AC6_AC9_une_erreur_javascript_non_rattrapee_devient_une_ligne_erreur_au_texte_prevu", () => {
  const cible = new EventTarget();
  suivreErreursPage(cible);
  const e = new Event("error");
  Object.assign(e, { message: "Uncaught x", error: new Error("x est indéfini"), filename: "http://h/app.js", lineno: 42 });
  cible.dispatchEvent(e);
  const r = new Event("unhandledrejection");
  r.reason = new Error("refus");
  r.reason.stack = "Error: refus\n    at f (http://h/main.js:7:3)";
  cible.dispatchEvent(r);
  expect(lignes().map((l) => [l.severite, l.message])).toEqual([
    ["erreur", "Erreur JavaScript : x est indéfini (http://h/app.js, ligne 42)."],
    ["erreur", "Erreur JavaScript : refus (http://h/main.js, ligne 7)."],
  ]);
});

test("REQ186_AC1_un_toast_ecrit_une_ligne_et_l_option_journal_faux_l_evite", () => {
  afficher({ texte: "Lien refusé", variante: "erreur" });
  afficher({ texte: "Relecteur démarre : fichier `a.md` modifié.", variante: "info", journal: false });
  expect(lignes().map((l) => [l.severite, l.message])).toEqual([["erreur", "Lien refusé"]]);
});

test("REQ186_AC1_AC2_la_relecture_qui_revient_avant_la_fin_de_l_envoi_ne_double_pas_la_ligne", async () => {
  const post = fetch;
  let finir;
  const retenu = new Promise((r) => (finir = r));
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const rep = await post(url, opts);
    if (opts.method === "POST") await retenu;
    return rep;
  }));
  journaliser({ severite: "erreur", message: "Lien refusé", heure: 77 });
  await vi.waitFor(() => expect(s.lignes).toHaveLength(1));
  await relire();
  expect(lignes()).toHaveLength(1);
  finir();
  await envoyerEnAttente();
  await relire();
  expect(lignes()).toHaveLength(1);
  expect(envois()).toHaveLength(1);
});
