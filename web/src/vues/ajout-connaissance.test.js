import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mettreAJourFichiers, ouvrirAjoutConnaissance, phraseAjout } from "./ajout-connaissance.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute("open");
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const reponse = (status, corps) => ({ ok: status < 300, status, json: async () => corps });
const CONFIG = { provider: "openai", modele: "text-embedding-3-small" };

/** `etat` : réponse de GET ; `ajouter` : réponse de POST ; `suivi` : file de réponses des relectures. */
function faux({ etat = { config: CONFIG, collections: [], ajout: null }, ajouter = reponse(202, { numero: 1, collection: "notes", total: 3 }), suivi = [] } = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    appels.push({ url, init });
    if (init?.method === "POST") return ajouter;
    if (appels.filter((a) => !a.init?.method).length > 1 && suivi.length) return reponse(200, suivi.shift());
    return reponse(200, etat);
  }));
  return appels;
}

async function ouvrir(options = {}) {
  const dire = vi.fn();
  const surConfigurer = vi.fn();
  const surRetour = vi.fn();
  await ouvrirAjoutConnaissance({ noms: ["docs/"], chemins: ["docs"], dire, surConfigurer, surRetour, ...options });
  return { dire, surConfigurer, surRetour };
}
const dlg = () => document.querySelector("dialog");
const bouton = (nom) => [...dlg().querySelectorAll("button")].find((b) => b.textContent === nom);
const champNom = () => dlg().querySelector("input");
const saisir = (valeur) => {
  champNom().value = valeur;
  champNom().dispatchEvent(new Event("input", { bubbles: true }));
};
const post = (appels) => appels.filter((a) => a.init?.method === "POST").map((a) => JSON.parse(a.init.body));

test("REQ104_AC13_phrase_des_chemins_un_deux_trois_et_plus", () => {
  expect(phraseAjout(["docs/"])).toBe("Ajouter docs/ à une collection.");
  expect(phraseAjout(["CHANGELOG.md", "README.md"])).toBe("Ajouter CHANGELOG.md et README.md à une collection.");
  expect(phraseAjout(["a", "b", "c"])).toBe("Ajouter a, b et 1 autre élément à une collection.");
  expect(phraseAjout(["a", "b", "c", "d", "e"])).toBe("Ajouter a, b et 3 autres éléments à une collection.");
});

test("REQ104_AC13_dialogue_nomme_decrit_par_sa_phrase_avec_annuler_et_ajouter", async () => {
  faux();
  await ouvrir({ noms: ["CHANGELOG.md", "README.md"], chemins: ["CHANGELOG.md", "README.md"] });
  expect(dlg().getAttribute("role") ?? "dialog").toBe("dialog");
  expect(dlg().querySelector(".dialogue-titre").textContent).toBe("Ajouter à la base de connaissance");
  expect(document.getElementById(dlg().getAttribute("aria-describedby")).textContent).toBe("Ajouter CHANGELOG.md et README.md à une collection.");
  expect([...dlg().querySelectorAll(".dialogue-actions button")].map((b) => b.textContent)).toEqual(["Annuler", "Ajouter"]);
});

test("REQ104_AC14_liste_des_collections_triee_puis_nouvelle_collection_sans_deplacer_le_focus", async () => {
  faux({ etat: { config: CONFIG, collections: [{ nom: "notes" }, { nom: "api" }], ajout: null } });
  await ouvrir();
  const select = dlg().querySelector("select");
  expect(dlg().querySelector("label").textContent).toBe("Collection");
  expect([...select.options].map((o) => o.textContent)).toEqual(["api", "notes", "Nouvelle collection…"]);
  expect(select.value).toBe("api");
  expect(document.activeElement).toBe(select);
  expect(champNom().closest("div[hidden]")).not.toBeNull();
  select.value = "";
  select.dispatchEvent(new Event("change"));
  expect(champNom().closest("div[hidden]")).toBeNull();
  expect(dlg().textContent).toContain("Nom de la nouvelle collection");
  expect(document.activeElement).toBe(select);
});

test("REQ104_AC14_sans_collection_seul_le_champ_du_nom_avec_le_focus", async () => {
  faux();
  await ouvrir();
  expect(dlg().querySelector("select")).toBeNull();
  expect(document.activeElement).toBe(champNom());
  expect(dlg().querySelector("label").textContent).toBe("Nom de la nouvelle collection");
  expect(dlg().textContent).toContain("40 caractères au plus : lettres sans accent, chiffres, - et _.");
});

test("REQ104_AC6_AC15_nom_refuse_dans_la_page_rien_n_est_envoye", async () => {
  const appels = faux();
  await ouvrir();
  for (const [valeur, texte] of [["", "Donnez un nom à la collection."], ["a".repeat(41), "40 caractères au plus."], ["api docs", "Lettres sans accent, chiffres, - et _ seulement."]]) {
    saisir(valeur);
    bouton("Ajouter").click();
    await vi.advanceTimersByTimeAsync(0);
    const alerte = dlg().querySelector("[role=alert]");
    expect(alerte.textContent).toBe(texte);
    expect(champNom().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(champNom());
    expect(champNom().value).toBe(valeur);
  }
  expect(dlg()).not.toBeNull();
  expect(post(appels)).toEqual([]);
});

test("REQ104_AC6_nom_saisi_avec_la_casse_envoye_tel_quel_Entree_vaut_Ajouter", async () => {
  const appels = faux();
  await ouvrir();
  saisir("Notes");
  champNom().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(0);
  expect(post(appels)).toEqual([{ collection: "Notes", chemins: ["docs"] }]);
});

test("REQ104_AC7_AC16_base_non_configuree_sans_champ_configurer_ferme_et_ouvre_la_configuration", async () => {
  const appels = faux({ etat: { config: null, erreur: null, collections: [], ajout: null } });
  const { surConfigurer, surRetour } = await ouvrir();
  expect(document.getElementById(dlg().getAttribute("aria-describedby")).textContent).toBe("La base de connaissance n'est pas configurée. Choisissez d'abord un provider et un modèle.");
  expect(dlg().querySelector("input, select")).toBeNull();
  expect([...dlg().querySelectorAll(".dialogue-actions button")].map((b) => b.textContent)).toEqual(["Annuler", "Configurer la base"]);
  expect(document.activeElement).toBe(bouton("Configurer la base"));
  bouton("Configurer la base").click();
  expect(dlg()).toBeNull();
  expect(surConfigurer).toHaveBeenCalledTimes(1);
  expect(surConfigurer.mock.calls[0][0].surFermeture).toBe(surRetour);
  expect(post(appels)).toEqual([]);
});

test("REQ104_AC7_refus_du_serveur_au_dessus_des_boutons_le_dialogue_reste_ouvert_focus_sur_Ajouter", async () => {
  const appels = faux({ ajouter: reponse(409, { cause: "cle", message: "Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM." }) });
  const { dire } = await ouvrir();
  saisir("notes");
  bouton("Ajouter").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(dlg().querySelector(".dialogue-resultat [role=alert]").textContent).toBe("Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM.");
  expect(document.activeElement).toBe(bouton("Ajouter"));
  expect(dire).not.toHaveBeenCalled();
  expect(post(appels)).toHaveLength(1);
});

test("REQ104_AC17_ajout_deja_en_cours_et_coupure_restent_dans_le_dialogue", async () => {
  faux({ ajouter: reponse(409, { cause: "encours", message: "Un ajout est déjà en cours. Attendez sa fin, puis réessayez." }) });
  await ouvrir();
  saisir("notes");
  bouton("Ajouter").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(dlg().querySelector(".dialogue-resultat").textContent).toContain("Un ajout est déjà en cours. Attendez sa fin, puis réessayez.");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("réseau"); }));
  bouton("Ajouter").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(dlg().querySelector(".dialogue-resultat").textContent).toContain("Connexion perdue. Réessayez au retour.");
});

test("REQ104_AC8_AC17_ajout_accepte_ferme_rend_le_focus_dit_le_debut_puis_la_fin", async () => {
  const fini = { numero: 1, collection: "notes", etat: "fini", faits: 15, total: 15, ajoutes: 14, ignores: 1, cause: null, detail: null };
  const appels = faux({ suivi: [{ config: CONFIG, collections: [], ajout: { ...fini, etat: "en_cours", ajoutes: 3 } }, { config: CONFIG, collections: [], ajout: fini }] });
  const { dire, surRetour } = await ouvrir();
  saisir("notes");
  bouton("Ajouter").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(dlg()).toBeNull();
  expect(surRetour).toHaveBeenCalledTimes(1);
  expect(post(appels)).toEqual([{ collection: "notes", chemins: ["docs"] }]);
  expect(dire).toHaveBeenCalledTimes(1);
  expect(dire).toHaveBeenLastCalledWith({ texte: "Ajout de docs/ à notes…", variante: "info", fermable: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(dire).toHaveBeenCalledTimes(1); // toujours en cours
  await vi.advanceTimersByTimeAsync(1000);
  expect(dire).toHaveBeenLastCalledWith({ texte: "Ajout à notes terminé : 14 fichiers ajoutés, 1 ignoré.", variante: "succes", fermable: true });
  const avant = appels.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(appels.length).toBe(avant); // la relecture s'arrête avec l'ajout
});

test("REQ104_AC17_plusieurs_lignes_message_de_debut_et_singulier_de_fin", async () => {
  const fini = { numero: 1, collection: "notes", etat: "fini", faits: 2, total: 2, ajoutes: 1, ignores: 0, cause: null, detail: null };
  faux({ ajouter: reponse(202, { numero: 1, collection: "notes", total: 2 }), suivi: [{ config: CONFIG, collections: [], ajout: fini }] });
  const { dire } = await ouvrir({ noms: ["a.md", "b.md"], chemins: ["a.md", "b.md"] });
  saisir("notes");
  bouton("Ajouter").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(dire.mock.calls[0][0].texte).toBe("Ajout de 2 éléments à notes…");
  await vi.advanceTimersByTimeAsync(1000);
  expect(dire.mock.calls[1][0].texte).toBe("Ajout à notes terminé : 1 fichier ajouté, 0 ignoré.");
});

test("REQ104_AC9_AC17_arret_du_provider_message_alerte_avec_la_reponse_en_detail", async () => {
  const arrete = { numero: 1, collection: "notes", etat: "arrete", faits: 1, total: 4, ajoutes: 1, ignores: 0, cause: "OpenAI a refusé la requête (401).", detail: '{"error":"bad key"}' };
  faux({ suivi: [{ config: CONFIG, collections: [], ajout: arrete }] });
  const { dire } = await ouvrir();
  saisir("notes");
  bouton("Ajouter").click();
  await vi.advanceTimersByTimeAsync(1000);
  expect(dire).toHaveBeenLastCalledWith({
    texte: "L'ajout à notes s'est arrêté. OpenAI a refusé la requête (401). Les fichiers déjà traités restent dans la collection.",
    detail: '{"error":"bad key"}',
    variante: "erreur",
    fermable: true,
  });
});

test("REQ104_AC17_Annuler_et_Echap_rendent_le_focus_sans_rien_envoyer", async () => {
  const appels = faux();
  const { surRetour } = await ouvrir();
  bouton("Annuler").click();
  expect(dlg()).toBeNull();
  expect(surRetour).toHaveBeenCalledTimes(1);
  await ouvrirAjoutConnaissance({ noms: ["docs/"], chemins: ["docs"], dire: vi.fn(), surConfigurer: vi.fn(), surRetour });
  dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(dlg()).toBeNull();
  expect(surRetour).toHaveBeenCalledTimes(2);
  expect(post(appels)).toEqual([]);
});

test("REQ104_AC17_pendant_l_envoi_Ajout_en_cours_et_Annuler_desactive", async () => {
  let fin;
  const appels = faux();
  const base = fetch;
  vi.stubGlobal("fetch", vi.fn((url, init) => (init?.method === "POST" ? new Promise((r) => (fin = () => r(reponse(202, { numero: 1, collection: "notes", total: 1 })))) : base(url, init))));
  await ouvrir();
  saisir("notes");
  const ajouter = bouton("Ajouter");
  ajouter.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(ajouter.textContent).toBe("Ajout…");
  expect(ajouter.disabled).toBe(true);
  expect(bouton("Annuler").disabled).toBe(true);
  fin();
  await vi.advanceTimersByTimeAsync(0);
  expect(dlg()).toBeNull();
  expect(appels.length).toBeGreaterThan(0);
});

test("REQ104_AC7_refus_de_la_lecture_de_la_base_affiche_ce_refus_au_lieu_de_non_configuree", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reponse(500, { cause: "lecture", message: "Lecture impossible." })));
  const { dire, surRetour } = await ouvrir();
  expect(dlg()).toBeNull();
  expect(dire).toHaveBeenCalledWith({ texte: "Lecture impossible.", variante: "erreur", fermable: true });
  expect(surRetour).toHaveBeenCalledTimes(1);
});

test("REQ104_AC8_la_relecture_s_arrete_quand_la_vue_est_detruite", async () => {
  const appels = faux({ suivi: [{ config: CONFIG, collections: [], ajout: { numero: 1, collection: "notes", etat: "en_cours" } }] });
  let actif = true;
  await ouvrirAjoutConnaissance({ noms: ["docs/"], chemins: ["docs"], dire: vi.fn(), surConfigurer: vi.fn(), surRetour: vi.fn(), actif: () => actif });
  saisir("notes");
  bouton("Ajouter").click();
  await vi.advanceTimersByTimeAsync(1000);
  actif = false;
  const avant = appels.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(appels.length).toBe(avant);
});

// ---- REQ-111 : mise à jour ----
async function mettreAJour(noms, ajouter, suivi = []) {
  const appels = faux({ etat: suiviMaj({ etat: "en_cours" }), ajouter, suivi });
  const dire = vi.fn();
  const surRetour = vi.fn();
  await mettreAJourFichiers({ noms, chemins: noms.map((n) => n.replace(/\/$/, "")), dire, surRetour });
  return { appels, dire, surRetour };
}
const ACCEPTE = reponse(202, { numero: 4, total: 2 });
const suiviMaj = (extra) => ({ config: CONFIG, collections: [], ajout: { numero: 4, genre: "mise_a_jour", collection: "", ...extra } });

test("REQ111_AC5_textes_de_debut_pour_un_fichier_un_dossier_et_deux_elements_sans_dialogue", async () => {
  for (const [noms, texte] of [
    [["docs/a.md"], "Mise à jour de docs/a.md dans la base de connaissance…"],
    [["docs/"], "Mise à jour de docs/ dans la base de connaissance…"],
    [["a.md", "docs/"], "Mise à jour de 2 éléments dans la base de connaissance…"],
  ]) {
    const { appels, dire, surRetour } = await mettreAJour(noms, ACCEPTE);
    expect(dire).toHaveBeenCalledWith({ texte, variante: "info", fermable: true });
    expect(post(appels)).toEqual([{ chemins: noms.map((n) => n.replace(/\/$/, "")) }]);
    expect(appels.find((a) => a.init?.method === "POST").url).toBe("/api/connaissance/mises-a-jour");
    expect(dlg()).toBeNull();
    expect(surRetour).toHaveBeenCalledTimes(1);
  }
});

test("REQ111_AC5_fin_au_singulier_et_au_pluriel", async () => {
  const un = await mettreAJour(["a.md"], ACCEPTE, [suiviMaj({ etat: "fini", ajoutes: 1 })]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(un.dire).toHaveBeenLastCalledWith({ texte: "Mise à jour terminée : 1 fichier mis à jour.", variante: "succes", fermable: true });
  const deux = await mettreAJour(["docs/"], ACCEPTE, [suiviMaj({ etat: "fini", ajoutes: 14 })]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(deux.dire).toHaveBeenLastCalledWith({ texte: "Mise à jour terminée : 14 fichiers mis à jour.", variante: "succes", fermable: true });
});

test("REQ111_AC4_AC5_arret_avec_la_cause_et_le_detail_du_provider", async () => {
  const { dire } = await mettreAJour(["a.md"], ACCEPTE, [suiviMaj({ etat: "arrete", cause: "OpenAI a refusé la requête (401).", detail: '{"error":"clé"}' })]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(dire).toHaveBeenLastCalledWith({
    texte: "La mise à jour s'est arrêtée. OpenAI a refusé la requête (401). Les fichiers déjà traités restent à jour.",
    detail: '{"error":"clé"}',
    variante: "erreur",
    fermable: true,
  });
});

test("REQ111_AC4_AC5_refus_aussitot_ajout_en_cours_et_coupure_focus_rendu", async () => {
  const refus = await mettreAJour(["a.md"], reponse(409, { cause: "encours", message: "Un ajout est déjà en cours. Attendez sa fin, puis réessayez." }));
  expect(refus.dire).toHaveBeenCalledTimes(1);
  expect(refus.dire).toHaveBeenCalledWith({ texte: "Un ajout est déjà en cours. Attendez sa fin, puis réessayez.", variante: "erreur", fermable: true });
  expect(refus.surRetour).toHaveBeenCalledTimes(1);
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new TypeError("réseau");
  }));
  const dire = vi.fn();
  await mettreAJourFichiers({ noms: ["a.md"], chemins: ["a.md"], dire, surRetour: vi.fn() });
  expect(dire).toHaveBeenCalledWith({ texte: "Connexion perdue. Réessayez au retour.", variante: "alerte", fermable: true });
});
