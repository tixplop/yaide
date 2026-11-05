import { readFileSync } from "node:fs";
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
    { chemin: "src/main.rs", statut: "modifié", indexe: false, lettre: "M" },
    { chemin: "notes.md", statut: "indexé", indexe: true, lettre: "A" },
  ],
};

/** Monte la vue ; `reponses` : chemin d'API -> réponse (fonction ou valeur). */
async function monter(reponses = {}, options = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = url.split("?")[0];
    appels.push({ url, methode: opts.method ?? "GET", corps: opts.body });
    const r = reponses[chemin] ?? (chemin === "/api/git/etat" ? ETAT : null);
    const v = await (typeof r === "function" ? r() : r);
    if (v === null || v === undefined) return { ok: true, status: 204 };
    if (v.status) return json(v.corps, v.status);
    return json(v);
  }));
  const rappels = { dire: vi.fn(), surBranche: vi.fn(), surDiff: vi.fn(), fermerDiff: vi.fn(), ...options };
  const vue = vueGit(rappels);
  vues.push(vue);
  document.body.append(vue.corps);
  vue.montrer(true);
  await attendre();
  return { vue, appels, ...rappels };
}

const bouton = (vue, nom) => [...vue.corps.querySelectorAll(".git-formulaire button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent.replace("…", "")) === nom);
const formulaire = (vue) => vue.corps.querySelector(".git-formulaire");

test("REQ022_AC6_AC10_chaque_ligne_affiche_nom_dossier_lettre_et_mot_accessible", async () => {
  const { vue } = await monter();
  const lignes = [...vue.corps.querySelectorAll("[role=option]")];
  expect(lignes.map((l) => l.querySelector(".liste-libelle").textContent)).toEqual(["notes.md", "main.rs"]);
  expect(lignes.map((l) => l.querySelector(".liste-parent")?.textContent)).toEqual([undefined, "src"]);
  expect(lignes.map((l) => l.querySelector(".liste-statut").textContent)).toEqual(["A", "M"]);
  expect(lignes.map((l) => l.getAttribute("aria-label"))).toEqual(["notes.md, ajouté, indexé", "main.rs, modifié"]);
  expect(lignes.map((l) => l.title)).toEqual(["notes.md, ajouté, indexé", "src/main.rs, modifié"]);
  expect(lignes[1].querySelector("svg[data-icone]")).toBeTruthy();
});

test("REQ022_AC9_AC11_deux_sections_avec_compteur_dans_une_seule_liste_a_un_seul_arret_de_tabulation", async () => {
  const { vue } = await monter();
  expect([...vue.corps.querySelectorAll(".liste-groupe")].map((g) => g.textContent)).toEqual(["Modifications indexées1", "Modifications1"]);
  expect(vue.corps.querySelectorAll("[role=listbox]")).toHaveLength(1);
  expect(vue.corps.querySelectorAll("[role=option][tabindex='0']")).toHaveLength(1);
  const lignes = [...vue.corps.querySelectorAll("[role=option]")];
  lignes[0].focus();
  lignes[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(document.activeElement).toBe(lignes[1]);
  // De haut en bas : branche, message, Commit, puis la liste.
  const ordre = [...vue.corps.querySelectorAll("select, textarea, .git-commit button, [role=listbox]")].map((e) => e.tagName.toLowerCase() + (e.getAttribute("role") ?? ""));
  expect(ordre).toEqual(["select", "textarea", "button", "divlistbox"]);
});

test("REQ022_AC9_une_section_vide_n_est_pas_affichee", async () => {
  const { vue } = await monter({ "/api/git/etat": { ...ETAT, changements: [ETAT.changements[0]] } });
  expect([...vue.corps.querySelectorAll(".liste-groupe")].map((g) => g.textContent)).toEqual(["Modifications1"]);
});

test("REQ022_AC13_a_la_racine_aucun_dossier_parent", async () => {
  const { vue } = await monter({ "/api/git/etat": { ...ETAT, changements: [{ chemin: "a.txt", statut: "nouveau", indexe: false, lettre: "U" }] } });
  expect(vue.corps.querySelector(".liste-parent")).toBeNull();
});

test("REQ022_AC3_la_branche_est_donnee_a_la_barre_du_haut", async () => {
  const { surBranche } = await monter();
  expect(surBranche).toHaveBeenLastCalledWith({ branche: "main", detachee: false });
});

test("REQ022_AC4_hors_depot_seul_le_message_est_affiche", async () => {
  const { vue, surBranche } = await monter({ "/api/git/etat": { status: 409, corps: { cause: "pas-depot", message: "Ce dossier n'est pas un dépôt git." } } });
  expect(vue.corps.querySelector(".git-liste").textContent).toBe("Ce dossier n'est pas un dépôt git.");
  expect(formulaire(vue).hidden).toBe(true);
  expect(surBranche).toHaveBeenLastCalledWith(null);
});

test("REQ022_AC5_aucun_changement_le_formulaire_reste", async () => {
  const { vue } = await monter({ "/api/git/etat": { ...ETAT, changements: [] } });
  expect(vue.corps.textContent).toContain("Aucun changement.");
  expect(formulaire(vue).hidden).toBe(false);
  expect(bouton(vue, "Commit")).toBeTruthy();
});

test("REQ022_AC1_clic_sur_une_ligne_ouvre_son_diff", async () => {
  const { vue, surDiff } = await monter({ "/api/git/diff": { binaire: false, trop_gros: false, diff: "-a\n+b\n" } });
  vue.corps.querySelector("[data-chemin='src/main.rs']").click();
  await attendre();
  expect(surDiff).toHaveBeenCalledWith({ chemin: "src/main.rs", texte: "-a\n+b\n", avis: undefined });
});

test("REQ022_AC8_diff_binaire_et_trop_gros_donnent_un_avis", async () => {
  let diff = { binaire: true, trop_gros: false, diff: "" };
  const { vue, surDiff } = await monter({ "/api/git/diff": () => diff });
  vue.corps.querySelector("[data-chemin='src/main.rs']").click();
  await attendre();
  expect(surDiff).toHaveBeenLastCalledWith(expect.objectContaining({ avis: "Fichier binaire : pas de diff." }));
  diff = { binaire: false, trop_gros: true, diff: "" };
  vue.corps.querySelector("[data-chemin='src/main.rs']").click();
  await attendre();
  expect(surDiff).toHaveBeenLastCalledWith(expect.objectContaining({ avis: "Fichier trop gros pour afficher son diff." }));
});

test("REQ023_AC6_bouton_plus_selon_indexe_nom_accessible_et_touche_I", async () => {
  // Statut « indexé » mais indexe faux, et l'inverse : seul `indexe` décide.
  const etat = { ...ETAT, changements: [{ chemin: "a.txt", statut: "indexé", indexe: false, lettre: "M" }, { chemin: "b.txt", statut: "renommé", indexe: true, lettre: "R" }] };
  const { vue, appels } = await monter({ "/api/git/etat": etat });
  const [b, a] = vue.corps.querySelectorAll("[role=option]");
  expect(b.querySelector("button")).toBeNull();
  const plus = a.querySelector("button");
  expect(plus.getAttribute("aria-label")).toBe("Indexer a.txt");
  expect(a.getAttribute("aria-keyshortcuts")).toBe("I");
  expect(plus.textContent).toBe("");
  expect(plus.querySelector("svg").getAttribute("data-icone")).toBe("plus");
  expect(plus.classList.contains("ya-icon-btn-ligne")).toBe(true);
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
  const alerte = vue.corps.querySelector("[role=alert]");
  expect(alerte.textContent).toBe("Écrivez un message de commit.");
  expect(document.activeElement).toBe(vue.corps.querySelector("textarea"));
});

test("REQ023_AC5_sans_fichier_indexe_message_en_alerte", async () => {
  const texte = "Aucun fichier indexé. Indexez au moins un fichier.";
  const { vue } = await monter({ "/api/git/commit": { status: 409, corps: { cause: "aucun-indexe", message: texte } } });
  vue.corps.querySelector("textarea").value = "x";
  bouton(vue, "Commit").click();
  await attendre();
  expect(vue.corps.querySelector("[role=alert]").textContent).toBe(texte);
});

test("REQ023_AC4_echec_de_git_au_commit_montre_le_message_de_git", async () => {
  const { vue } = await monter({ "/api/git/commit": { status: 409, corps: { cause: "git", message: "Author identity unknown" } } });
  vue.corps.querySelector("textarea").value = "x";
  bouton(vue, "Commit").click();
  await attendre();
  const alerte = vue.corps.querySelector("[role=alert]");
  expect(alerte.textContent).toContain("Git a refusé.");
  expect(alerte.querySelector("pre").textContent).toBe("Author identity unknown");
});

test("REQ023_AC7_ctrl_entree_lance_le_commit_vide_le_champ_et_annonce", async () => {
  const { vue, appels } = await monter();
  const champ = vue.corps.querySelector("textarea");
  champ.value = "Corrige";
  champ.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  await attendre();
  expect(appels.find((x) => x.url === "/api/git/commit").corps).toBe("Corrige");
  expect(vue.corps.querySelector("textarea").value).toBe("");
  expect(vue.corps.textContent).toContain("Commit créé.");
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
  expect(vue.corps.querySelector("[role=alert] pre").textContent).toBe("local changes would be overwritten");
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
  expect(vue.corps.textContent).toContain("Pull terminé.");
  expect(bouton(vue, "Pull").disabled).toBe(false);
});

test("REQ025_AC5_echec_du_push_renvoie_vers_le_shell_avec_le_message_de_git", async () => {
  const { vue } = await monter({ "/api/git/push": { status: 409, corps: { cause: "git", message: "Permission denied" } } });
  bouton(vue, "Push").click();
  await attendre();
  await attendre();
  const alerte = vue.corps.querySelector("[role=alert]");
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
  expect(vue.corps.querySelector("[role=alert]")).not.toBeNull();
  const champ = vue.corps.querySelector("textarea");
  champ.value = "Brouillon";
  champ.focus();
  reponse = null;
  bouton(vue, "Pull").click();
  await attendre();
  await attendre();
  expect(vue.corps.querySelector("[role=alert]")).toBeNull();
  expect(vue.corps.querySelector("textarea").value).toBe("Brouillon");
  expect(document.activeElement).toBe(vue.corps.querySelector("textarea"));
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
  const ligne = vue.corps.querySelector("[data-chemin='src/main.rs']");
  ligne.focus();
  ligne.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await attendre();
  await attendre();
  expect(vue.corps.querySelector("[data-chemin='src/main.rs']").getAttribute("aria-selected")).toBe("true");
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
  const ligne = vue.corps.querySelector("[data-chemin='src/main.rs']");
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

test("REQ031_AC1_AC5_commit_garde_son_texte_pull_et_push_sont_des_icones_avec_leur_info_bulle", async () => {
  const { vue } = await monter();
  for (const [nom, texte, info] of [["Commit", "Commit", "Commit (Ctrl+Entrée)"], ["Pull", "", "Pull"], ["Push", "", "Push"]]) {
    const b = bouton(vue, nom);
    expect(b.textContent).toBe(texte);
    expect(b.querySelector("svg")).toBeTruthy();
    expect(b.hasAttribute("title")).toBe(false);
    b.focus();
    expect(document.querySelector("[role=tooltip]").textContent).toBe(info);
    b.blur();
  }
});

test("REQ033_AC2_AC9_chaque_lettre_de_statut_a_sa_classe_et_une_seule_lettre_est_affichee", async () => {
  const lettres = ["M", "U", "D", "R", "C", "A"];
  const etat = { ...ETAT, changements: lettres.map((lettre) => ({ chemin: `${lettre}.txt`, statut: "x", indexe: lettre === "A", lettre })) };
  const { vue } = await monter({ "/api/git/etat": etat });
  const lignes = [...vue.corps.querySelectorAll("[role=option]")];
  expect(lignes.map((l) => l.querySelector(".liste-statut").textContent).sort()).toEqual([...lettres].sort());
  for (const l of lignes) expect(l.classList.contains(`liste-statut-${l.querySelector(".liste-statut").textContent}`)).toBe(true);
});

test("REQ031_AC4_raccourcis_aria_valides_pour_commit", async () => {
  const { vue } = await monter();
  expect(bouton(vue, "Commit").getAttribute("aria-keyshortcuts")).toBe("Control+Enter");
});

test("REQ034_AC8_estDepot_et_focuserMessage_gardent_le_texte_et_le_focus_apres_rafraichir", async () => {
  const { vue } = await monter();
  expect(vue.estDepot()).toBe(true);
  vue.corps.querySelector("textarea").value = "déjà écrit";
  vue.focuserMessage();
  expect(document.activeElement).toBe(vue.corps.querySelector("textarea"));
  await vue.rafraichir();
  expect(document.activeElement).toBe(vue.corps.querySelector("textarea"));
  expect(vue.corps.querySelector("textarea").value).toBe("déjà écrit");
});

test("REQ034_AC9_estDepot_est_faux_hors_depot", async () => {
  const { vue } = await monter({ "/api/git/etat": { status: 409, corps: { cause: "pas-depot", message: "Ce dossier n'est pas un dépôt git." } } });
  expect(vue.estDepot()).toBe(false);
});

test("REQ023_AC10_le_champ_message_a_son_texte_indicatif_et_son_libelle_masque", async () => {
  const { vue } = await monter();
  const saisie = vue.corps.querySelector("textarea");
  expect(saisie.placeholder).toBe("Message (Ctrl+Entrée)");
  const libelle = vue.corps.querySelector(`label[for="${saisie.id}"]`);
  expect(libelle.textContent).toBe("Message");
  expect(libelle.classList.contains("masque")).toBe(true);
});

test("REQ023_AC11_les_messages_restent_sous_commit_et_avant_la_liste", async () => {
  const texte = "Aucun fichier indexé. Indexez au moins un fichier.";
  const { vue } = await monter({ "/api/git/commit": { status: 409, corps: { cause: "aucun-indexe", message: texte } } });
  vue.corps.querySelector("textarea").value = "x";
  bouton(vue, "Commit").click();
  await attendre();
  const alerte = vue.corps.querySelector("[role=alert]");
  expect(alerte.textContent).toBe(texte);
  const suit = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(suit(vue.corps.querySelector(".git-commit"), alerte)).toBe(true);
  expect(suit(alerte, vue.corps.querySelector(".git-liste"))).toBe(true);
});

test("REQ022_AC9_en_tete_de_section_en_11_px_sur_16_px", () => {
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  const m = css.match(/\.git-corps \.ya-row \.liste-groupe \{([^}]*)\}/);
  expect(m[1]).toContain("font-size: 11px");
  expect(m[1]).toContain("line-height: 16px");
  expect(m[1]).not.toContain("line-height: normal");
});

// ---- Relecture silencieuse (REQ-045) ----

const ETAT2 = { ...ETAT, changements: [...ETAT.changements, { chemin: "zeta.txt", statut: "nouveau", indexe: false, lettre: "U" }] };

test("REQ045_AC5_la_relecture_garde_le_focus_sur_Pull_Commit_et_le_champ_Message", async () => {
  let courant = ETAT;
  const { vue } = await monter({ "/api/git/etat": () => courant });
  const saisie = vue.corps.querySelector("textarea");
  saisie.value = "brouillon";
  saisie.focus();
  saisie.setSelectionRange(2, 4);
  courant = ETAT2;
  await vue.relire();
  expect(vue.corps.querySelectorAll("[role=option]")).toHaveLength(3);
  expect(document.activeElement).toBe(saisie);
  expect(saisie.value).toBe("brouillon");
  expect([saisie.selectionStart, saisie.selectionEnd]).toEqual([2, 4]);
  bouton(vue, "Pull").focus();
  courant = ETAT;
  await vue.relire();
  expect(vue.corps.querySelectorAll("[role=option]")).toHaveLength(2);
  expect(document.activeElement).toBe(bouton(vue, "Pull"));
  courant = { ...ETAT2, branche: "travail" };
  const avant = bouton(vue, "Pull");
  await vue.relire();
  expect(document.activeElement).not.toBe(avant);
  expect(document.activeElement).toBe(bouton(vue, "Pull"));
  bouton(vue, "Commit").focus();
  courant = ETAT;
  await vue.relire();
  expect(document.activeElement).toBe(bouton(vue, "Commit"));
});

test("REQ045_AC5_la_ligne_qui_a_le_focus_le_garde_et_la_disparue_passe_a_la_precedente", async () => {
  let courant = ETAT2;
  const { vue } = await monter({ "/api/git/etat": () => courant });
  const ligne = (n) => [...vue.corps.querySelectorAll("[role=option]")].find((e) => e.dataset.chemin === n);
  ligne("src/main.rs").focus();
  courant = { ...ETAT2, changements: [...ETAT2.changements].reverse() };
  await vue.relire();
  expect(document.activeElement).toBe(ligne("src/main.rs"));
  courant = { ...ETAT2, changements: ETAT2.changements.filter((c) => c.chemin !== "src/main.rs") };
  await vue.relire();
  expect(document.activeElement).toBe(ligne("zeta.txt"));
});

test("REQ045_AC6_sans_changement_rien_n_est_redessine_et_la_liste_Branche_reste_ouverte", async () => {
  const { vue, appels } = await monter();
  const lignes = [...vue.corps.querySelectorAll("[role=option]")];
  const select = vue.corps.querySelector("select");
  select.focus();
  const n = appels.length;
  await vue.relire();
  await vue.relire();
  expect(appels.length).toBe(n + 2);
  expect([...vue.corps.querySelectorAll("[role=option]")].every((e, i) => e === lignes[i])).toBe(true);
  expect(vue.corps.querySelector("select")).toBe(select);
  expect(document.activeElement).toBe(select);
  expect(vue.corps.textContent).not.toContain("Chargement");
});

test("REQ045_AC9_AC10_coupure_ou_refus_git_laissent_l_affichage_et_ne_disent_rien", async () => {
  let reponse = ETAT;
  const { vue, dire } = await monter({ "/api/git/etat": () => reponse });
  const avant = vue.corps.innerHTML;
  reponse = { status: 409, corps: { cause: "git", message: "boum" } };
  await vue.relire();
  expect(vue.corps.innerHTML).toBe(avant);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("réseau"); }));
  await vue.relire();
  expect(vue.corps.innerHTML).toBe(avant);
  expect(dire).not.toHaveBeenCalled();
});

test("REQ045_AC4_un_dossier_qui_devient_un_depot_remplace_le_message", async () => {
  let reponse = { status: 409, corps: { cause: "pas-depot", message: "x" } };
  const { vue } = await monter({ "/api/git/etat": () => reponse });
  expect(vue.corps.textContent).toContain("Ce dossier n'est pas un dépôt git.");
  reponse = ETAT;
  await vue.relire();
  expect(vue.corps.textContent).not.toContain("pas un dépôt");
  expect(vue.corps.querySelector("select").value).toBe("main");
});

test("REQ045_AC2_AC3_la_relecture_apporte_statuts_et_branche_aux_rappels", async () => {
  let reponse = ETAT;
  const surEtat = vi.fn();
  const { vue, surBranche } = await monter({ "/api/git/etat": () => reponse }, { surEtat });
  reponse = { ...ETAT2, branche: "essai", branches: ["main", "essai"] };
  await vue.relire();
  expect(surBranche).toHaveBeenLastCalledWith({ branche: "essai", detachee: false });
  expect(surEtat.mock.lastCall[0].changements).toHaveLength(3);
});

test("REQ045_relecture_jetee_si_une_action_a_incremente_sequence", async () => {
  let reponse = ETAT;
  let retenue = null;
  const { vue } = await monter({ "/api/git/etat": () => (retenue ? retenue.then(() => ETAT) : reponse) });
  let liberer;
  retenue = new Promise((r) => (liberer = r));
  const lancee = vue.relire(); // reçoit l'ancien état, après la fin de l'action
  reponse = ETAT2;
  retenue = null;
  await vue.rafraichir(); // une action incrémente `sequence` et affiche le nouvel état
  expect(vue.corps.querySelectorAll("[role=option]")).toHaveLength(3);
  liberer();
  await lancee;
  expect(vue.corps.querySelectorAll("[role=option]")).toHaveLength(3);
});

test("REQ045_relecture_jetee_si_occupe_pendant_un_Pull_ou_levee_pendant_la_lecture", async () => {
  let reponse = ETAT;
  let retenue = null;
  let finPull;
  const { vue, appels } = await monter({
    "/api/git/etat": () => (retenue ? retenue.then(() => ETAT) : reponse),
    "/api/git/pull": () => new Promise((r) => (finPull = () => r({ status: 204 }))),
  });
  bouton(vue, "Pull").click(); // occupe
  await attendre();
  reponse = ETAT2;
  const n = appels.length;
  await vue.relire();
  expect(appels.length).toBe(n);
  expect(vue.corps.querySelectorAll("[role=option]")).toHaveLength(2);
  finPull();
  await attendre();
  await attendre();
  expect(vue.corps.querySelectorAll("[role=option]")).toHaveLength(3);
  // Une relecture en cours quand une action commence est jetée.
  reponse = { ...ETAT2, changements: ETAT2.changements.slice(0, 1) };
  let liberer;
  retenue = new Promise((r) => (liberer = r));
  const lancee = vue.relire();
  bouton(vue, "Pull").click();
  await attendre();
  liberer();
  await lancee;
  expect(vue.corps.querySelectorAll("[role=option]")).toHaveLength(3);
  finPull();
});

test("REQ045_AC10_apres_un_refus_la_relecture_suivante_met_l_affichage_a_jour", async () => {
  let reponse = ETAT;
  const { vue } = await monter({ "/api/git/etat": () => reponse });
  reponse = { status: 409, corps: { cause: "git", message: "boum" } };
  await vue.relire();
  expect(vue.corps.querySelectorAll("[role=option]")).toHaveLength(2);
  reponse = ETAT2;
  await vue.relire();
  expect(vue.corps.querySelectorAll("[role=option]")).toHaveLength(3);
});
