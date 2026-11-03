import { afterEach, expect, test, vi } from "vitest";
import { vueGit } from "./git.js";

let vues = [];
afterEach(() => {
  for (const v of vues) v.detruire();
  vues = [];
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const json = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps });
const attendre = () => new Promise((r) => setTimeout(r, 0));

const ETAT = {
  branche: "main",
  detachee: false,
  branches: ["main", "travail"],
  changements: [
    { chemin: "src/main.rs", statut: "modifié", indexe: false },
    { chemin: "notes.md", statut: "indexé", indexe: true },
  ],
};

/** Monte la vue ; `reponses` : chemin d'API -> réponse (fonction ou valeur). */
async function monter(reponses = {}, options = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = url.split("?")[0];
    appels.push({ url, methode: opts.method ?? "GET", corps: opts.body });
    const r = reponses[chemin] ?? (chemin === "/api/git/etat" ? ETAT : null);
    const v = typeof r === "function" ? r() : r;
    if (v === null || v === undefined) return { ok: true, status: 204 };
    if (v.status) return json(v.corps, v.status);
    return json(v);
  }));
  const rappels = { dire: vi.fn(), surBranche: vi.fn(), surDiff: vi.fn(), fermerDiff: vi.fn(), ...options };
  const vue = vueGit(rappels);
  vues.push(vue);
  document.body.append(vue.corps, vue.pied);
  vue.montrer(true);
  await attendre();
  return { vue, appels, ...rappels };
}

const bouton = (vue, nom) => [...vue.pied.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom);

test("REQ022_AC6_chaque_ligne_affiche_son_statut_en_mots", async () => {
  const { vue } = await monter();
  const lignes = [...vue.corps.querySelectorAll("[role=option]")];
  expect(lignes.map((l) => l.querySelector(".liste-libelle").textContent)).toEqual(["src/main.rs", "notes.md"]);
  expect(lignes.map((l) => l.querySelector(".liste-secondaire").textContent)).toEqual(["modifié", "indexé"]);
});

test("REQ022_AC3_la_branche_est_donnee_a_la_barre_du_haut", async () => {
  const { surBranche } = await monter();
  expect(surBranche).toHaveBeenLastCalledWith({ branche: "main", detachee: false });
});

test("REQ022_AC4_hors_depot_seul_le_message_est_affiche", async () => {
  const { vue, surBranche } = await monter({ "/api/git/etat": { status: 409, corps: { cause: "pas-depot", message: "Ce dossier n'est pas un dépôt git." } } });
  expect(vue.corps.textContent).toBe("Ce dossier n'est pas un dépôt git.");
  expect(vue.pied.hidden).toBe(true);
  expect(surBranche).toHaveBeenLastCalledWith(null);
});

test("REQ022_AC5_aucun_changement_le_formulaire_reste", async () => {
  const { vue } = await monter({ "/api/git/etat": { ...ETAT, changements: [] } });
  expect(vue.corps.textContent).toContain("Aucun changement.");
  expect(vue.pied.hidden).toBe(false);
  expect(bouton(vue, "Commit")).toBeTruthy();
});

test("REQ022_AC1_clic_sur_une_ligne_ouvre_son_diff", async () => {
  const { vue, surDiff } = await monter({ "/api/git/diff": { binaire: false, trop_gros: false, diff: "-a\n+b\n" } });
  vue.corps.querySelector("[role=option]").click();
  await attendre();
  expect(surDiff).toHaveBeenCalledWith({ chemin: "src/main.rs", texte: "-a\n+b\n", avis: undefined });
});

test("REQ022_AC8_diff_binaire_et_trop_gros_donnent_un_avis", async () => {
  let diff = { binaire: true, trop_gros: false, diff: "" };
  const { vue, surDiff } = await monter({ "/api/git/diff": () => diff });
  vue.corps.querySelector("[role=option]").click();
  await attendre();
  expect(surDiff).toHaveBeenLastCalledWith(expect.objectContaining({ avis: "Fichier binaire : pas de diff." }));
  diff = { binaire: false, trop_gros: true, diff: "" };
  vue.corps.querySelector("[role=option]").click();
  await attendre();
  expect(surDiff).toHaveBeenLastCalledWith(expect.objectContaining({ avis: "Fichier trop gros pour afficher son diff." }));
});

test("REQ023_AC6_bouton_plus_selon_indexe_nom_accessible_et_touche_I", async () => {
  // Statut « indexé » mais indexe faux, et l'inverse : seul `indexe` décide.
  const etat = { ...ETAT, changements: [{ chemin: "a.txt", statut: "indexé", indexe: false }, { chemin: "b.txt", statut: "renommé", indexe: true }] };
  const { vue, appels } = await monter({ "/api/git/etat": etat });
  const [a, b] = vue.corps.querySelectorAll("[role=option]");
  expect(b.querySelector("button")).toBeNull();
  const plus = a.querySelector("button");
  expect(plus.getAttribute("aria-label")).toBe("Indexer a.txt");
  expect(a.getAttribute("aria-keyshortcuts")).toBe("I");
  expect(plus.textContent).toBe("");
  expect(plus.querySelector("svg").getAttribute("data-icone")).toBe("circle-plus");
  expect(plus.classList.contains("bouton-icone-creer")).toBe(true);
  expect(a.querySelector(".liste-secondaire").style.getPropertyValue("--couleur-secondaire")).toBe("var(--succes)");
  expect(b.querySelector(".liste-secondaire").style.getPropertyValue("--couleur-secondaire")).toBe("var(--statut-renomme)");
  vi.useFakeTimers();
  plus.parentElement.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(400);
  expect(document.querySelector("[role=tooltip]").textContent).toBe("Indexer (I)");
  plus.parentElement.dispatchEvent(new Event("pointerleave"));
  vi.useRealTimers();
  a.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
  await attendre();
  expect(appels.some((x) => x.methode === "POST" && x.url === "/api/git/indexer?chemin=a.txt")).toBe(true);
});

test("REQ023_AC5_sans_message_le_champ_prend_le_focus_avec_une_alerte", async () => {
  const { vue } = await monter({ "/api/git/commit": { status: 400, corps: { cause: "message-vide", message: "Écrivez un message de commit." } } });
  bouton(vue, "Commit").click();
  await attendre();
  const alerte = vue.pied.querySelector("[role=alert]");
  expect(alerte.textContent).toBe("Écrivez un message de commit.");
  expect(document.activeElement).toBe(vue.pied.querySelector("textarea"));
});

test("REQ023_AC5_sans_fichier_indexe_message_en_alerte", async () => {
  const texte = "Aucun fichier indexé. Indexez au moins un fichier.";
  const { vue } = await monter({ "/api/git/commit": { status: 409, corps: { cause: "aucun-indexe", message: texte } } });
  vue.pied.querySelector("textarea").value = "x";
  bouton(vue, "Commit").click();
  await attendre();
  expect(vue.pied.querySelector("[role=alert]").textContent).toBe(texte);
});

test("REQ023_AC4_echec_de_git_au_commit_montre_le_message_de_git", async () => {
  const { vue } = await monter({ "/api/git/commit": { status: 409, corps: { cause: "git", message: "Author identity unknown" } } });
  vue.pied.querySelector("textarea").value = "x";
  bouton(vue, "Commit").click();
  await attendre();
  const alerte = vue.pied.querySelector("[role=alert]");
  expect(alerte.textContent).toContain("Git a refusé.");
  expect(alerte.querySelector("pre").textContent).toBe("Author identity unknown");
});

test("REQ023_AC7_ctrl_entree_lance_le_commit_vide_le_champ_et_annonce", async () => {
  const { vue, appels } = await monter();
  const champ = vue.pied.querySelector("textarea");
  champ.value = "Corrige";
  champ.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  await attendre();
  expect(appels.find((x) => x.url === "/api/git/commit").corps).toBe("Corrige");
  expect(vue.pied.querySelector("textarea").value).toBe("");
  expect(vue.pied.textContent).toContain("Commit créé.");
});

test("REQ023_AC8_un_fichier_qui_quitte_la_liste_ferme_son_diff", async () => {
  let etat = ETAT;
  const fermerDiff = vi.fn();
  const { vue } = await monter({ "/api/git/etat": () => etat }, { diffOuvert: () => "src/main.rs", fermerDiff });
  expect(fermerDiff).not.toHaveBeenCalled();
  etat = { ...ETAT, changements: [ETAT.changements[1]] };
  await vue.rafraichir();
  expect(fermerDiff).toHaveBeenCalledTimes(1);
});

test("REQ024_AC3_select_branche_liste_les_branches_et_part_au_choix", async () => {
  const { vue, appels } = await monter();
  const select = vue.corps.querySelector("select");
  expect(vue.corps.querySelector("label").textContent).toBe("Branche");
  expect([...select.options].map((o) => o.value)).toEqual(["main", "travail"]);
  select.value = "travail";
  select.dispatchEvent(new Event("change"));
  await attendre();
  expect(appels.some((x) => x.methode === "POST" && x.url === "/api/git/branche?nom=travail")).toBe(true);
});

test("REQ024_AC2_branche_refusee_message_de_git_et_branche_inchangee", async () => {
  const { vue } = await monter({ "/api/git/branche": { status: 409, corps: { cause: "git", message: "local changes would be overwritten" } } });
  const select = vue.corps.querySelector("select");
  select.value = "travail";
  select.dispatchEvent(new Event("change"));
  await attendre();
  await attendre();
  expect(vue.pied.querySelector("[role=alert] pre").textContent).toBe("local changes would be overwritten");
  expect(vue.corps.querySelector("select").value).toBe("main");
});

test("REQ022_AC3_tete_detachee_option_desactivee_en_tete", async () => {
  const { vue, surBranche } = await monter({ "/api/git/etat": { ...ETAT, detachee: true, branche: "abc1234" } });
  const premiere = vue.corps.querySelector("select").options[0];
  expect(premiere.textContent).toBe("(détachée)");
  expect(premiere.disabled).toBe(true);
  expect(surBranche).toHaveBeenLastCalledWith({ branche: "abc1234", detachee: true });
});

test("REQ025_AC4_pendant_le_pull_bouton_occupe_et_autres_actions_desactivees_puis_termine", async () => {
  let fin;
  const { vue } = await monter({ "/api/git/pull": () => new Promise((r) => (fin = r)) });
  bouton(vue, "Pull").click();
  const pull = bouton(vue, "Pull");
  expect(pull.textContent).toBe("Pull…");
  expect(pull.querySelector("svg")).toBeTruthy();
  expect(pull.getAttribute("aria-busy")).toBe("true");
  expect(pull.disabled).toBe(true);
  expect(bouton(vue, "Push").disabled).toBe(true);
  expect(bouton(vue, "Commit").disabled).toBe(true);
  fin(null);
  await attendre();
  await attendre();
  expect(vue.pied.textContent).toContain("Pull terminé.");
  expect(bouton(vue, "Pull").disabled).toBe(false);
});

test("REQ025_AC5_echec_du_push_renvoie_vers_le_shell_avec_le_message_de_git", async () => {
  const { vue } = await monter({ "/api/git/push": { status: 409, corps: { cause: "git", message: "Permission denied" } } });
  bouton(vue, "Push").click();
  await attendre();
  await attendre();
  const alerte = vue.pied.querySelector("[role=alert]");
  expect(alerte.querySelector(".message-texte").textContent).toBe("Git a refusé. Réglez cela dans le shell.");
  expect(alerte.querySelector("pre").textContent).toBe("Permission denied");
});

test("REQ025_AC4_pendant_une_action_les_plus_et_le_select_sont_desactives", async () => {
  let fin;
  const etat = { ...ETAT, changements: [{ chemin: "a.txt", statut: "modifié", indexe: false }] };
  const { vue } = await monter({ "/api/git/etat": etat, "/api/git/push": () => new Promise((r) => (fin = r)) });
  bouton(vue, "Push").click();
  expect(vue.corps.querySelector("select").disabled).toBe(true);
  expect(vue.corps.querySelector("[role=option] button").disabled).toBe(true);
  fin(null);
  await attendre();
  await attendre();
  expect(vue.corps.querySelector("select").disabled).toBe(false);
  expect(vue.corps.querySelector("[role=option] button").disabled).toBe(false);
});

test("REQ023_AC5_l_alerte_du_champ_message_disparait_a_l_action_suivante_en_gardant_valeur_et_focus", async () => {
  let reponse = { status: 400, corps: { cause: "message-vide", message: "Écrivez un message de commit." } };
  const { vue } = await monter({ "/api/git/commit": () => reponse });
  bouton(vue, "Commit").click();
  await attendre();
  await attendre();
  expect(vue.pied.querySelector("[role=alert]")).not.toBeNull();
  const champ = vue.pied.querySelector("textarea");
  champ.value = "Brouillon";
  champ.focus();
  reponse = null;
  bouton(vue, "Pull").click();
  await attendre();
  await attendre();
  expect(vue.pied.querySelector("[role=alert]")).toBeNull();
  expect(vue.pied.querySelector("textarea").value).toBe("Brouillon");
  expect(document.activeElement).toBe(vue.pied.querySelector("textarea"));
});

test("REQ025_AC4_le_focus_clavier_reste_sur_le_controle_apres_l_action", async () => {
  const { vue } = await monter();
  for (const nom of ["Commit", "Pull", "Push"]) {
    bouton(vue, nom).focus();
    bouton(vue, nom).click();
    await attendre();
    await attendre();
    expect(document.activeElement).toBe(bouton(vue, nom));
  }
  vue.corps.querySelector("select").focus();
  vue.corps.querySelector("select").value = "travail";
  vue.corps.querySelector("select").dispatchEvent(new Event("change"));
  await attendre();
  await attendre();
  expect(document.activeElement).toBe(vue.corps.querySelector("select"));
});

test("REQ022_AC7_entree_sur_une_ligne_ouvre_le_diff_et_la_marque_selectionnee", async () => {
  let ouvert = null;
  const { vue } = await monter(
    { "/api/git/diff": { binaire: false, trop_gros: false, diff: "+x\n" } },
    { diffOuvert: () => ouvert, surDiff: ({ chemin }) => (ouvert = chemin) },
  );
  const ligne = vue.corps.querySelector("[role=option]");
  ligne.focus();
  ligne.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await attendre();
  await attendre();
  expect(vue.corps.querySelector("[role=option]").getAttribute("aria-selected")).toBe("true");
});

test("REQ025_AC4_le_focus_parti_ailleurs_pendant_l_action_n_est_pas_repris", async () => {
  let fin;
  const { vue } = await monter({ "/api/git/pull": () => new Promise((r) => (fin = r)) });
  const dehors = document.createElement("button");
  document.body.append(dehors);
  bouton(vue, "Pull").focus();
  bouton(vue, "Pull").click();
  dehors.focus();
  fin(null);
  await attendre();
  await attendre();
  expect(document.activeElement).toBe(dehors);
});

test("REQ025_AC4_le_focus_reste_sur_la_branche_quand_une_ligne_est_ouverte", async () => {
  const { vue } = await monter({ "/api/git/diff": { binaire: false, trop_gros: false, diff: "+x\n" } });
  const ligne = vue.corps.querySelector("[role=option]");
  ligne.focus();
  ligne.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await attendre();
  await attendre();
  const select = vue.corps.querySelector("select");
  select.focus();
  select.value = "travail";
  select.dispatchEvent(new Event("change"));
  await attendre();
  await attendre();
  expect(document.activeElement).toBe(vue.corps.querySelector("select"));
});

test("REQ031_AC1_commit_pull_push_sont_des_icones_sans_texte_avec_leur_info_bulle", async () => {
  const { vue } = await monter();
  for (const [nom, info] of [["Commit", "Commit (Ctrl+Entrée)"], ["Pull", "Pull"], ["Push", "Push"]]) {
    const b = bouton(vue, nom);
    expect(b.textContent).toBe("");
    expect(b.querySelector("svg")).toBeTruthy();
    expect(b.hasAttribute("title")).toBe(false);
    b.focus();
    expect(document.querySelector("[role=tooltip]").textContent).toBe(info);
    b.blur();
  }
});

test("REQ033_AC2_AC9_chaque_statut_a_son_token_et_conflit_est_en_graisse_forte", async () => {
  const statuts = ["modifié", "nouveau", "supprimé", "renommé", "conflit", "indexé"];
  const etat = { ...ETAT, changements: statuts.map((statut) => ({ chemin: `${statut}.txt`, statut, indexe: statut === "indexé" })) };
  const { vue } = await monter({ "/api/git/etat": etat });
  const mots = [...vue.corps.querySelectorAll(".liste-secondaire")];
  expect(mots.map((m) => m.textContent)).toEqual(statuts);
  expect(mots.map((m) => m.style.getPropertyValue("--couleur-secondaire"))).toEqual(
    ["statut-modifie", "statut-nouveau", "erreur", "statut-renomme", "statut-conflit", "succes"].map((t) => `var(--${t})`),
  );
  expect(mots.map((m) => m.classList.contains("liste-secondaire-fort"))).toEqual([false, false, false, false, true, false]);
});

test("REQ031_AC4_raccourcis_aria_valides_pour_commit", async () => {
  const { vue } = await monter();
  expect(bouton(vue, "Commit").getAttribute("aria-keyshortcuts")).toBe("Control+Enter");
});

test("REQ034_AC8_estDepot_et_focuserMessage_gardent_le_texte_et_le_focus_apres_rafraichir", async () => {
  const { vue } = await monter();
  expect(vue.estDepot()).toBe(true);
  vue.pied.querySelector("textarea").value = "déjà écrit";
  vue.focuserMessage();
  expect(document.activeElement).toBe(vue.pied.querySelector("textarea"));
  await vue.rafraichir();
  expect(document.activeElement).toBe(vue.pied.querySelector("textarea"));
  expect(vue.pied.querySelector("textarea").value).toBe("déjà écrit");
});

test("REQ034_AC9_estDepot_est_faux_hors_depot", async () => {
  const { vue } = await monter({ "/api/git/etat": { status: 409, corps: { cause: "pas-depot", message: "Ce dossier n'est pas un dépôt git." } } });
  expect(vue.estDepot()).toBe(false);
});
