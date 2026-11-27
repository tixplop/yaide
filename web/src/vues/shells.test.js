import { expect, test, vi } from "vitest";
import { journaliser, lignes as lignesDuJournal } from "../journal.js";
import { lire } from "../stockage.js";
import { monter, attendre, actifDe, FauxWebSocket, bout, onglets, boutonClaudeDe, ongletsClaude, clavier } from "./principale.aides.js";

vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

/**
 * Serveur simulé : `etat.envs` (liste de noms), `etat.lecture` (`"illisible"`, `"coupure"` ou rien), `etat.ouverture` (statut et texte du POST).
 * Rend `{ appels, etat }` ; `appels` note chaque requête, avec son corps pour les POST.
 */
function simuler({ envs = [], lecture, claude = true, ouverture = { status: 201 } } = {}) {
  FauxWebSocket.tous = [];
  vi.stubGlobal("WebSocket", FauxWebSocket);
  const etat = { envs, lecture, ouverture, defaut: undefined };
  const appels = [];
  const rep = (corps, status = 200, texte = "") => ({ ok: status < 400, status, json: async () => corps, text: async () => texte });
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = String(url).split("?")[0];
    appels.push(opts.body ? `${opts.method} ${chemin} ${opts.body}` : `${opts.method ?? "GET"} ${chemin}`);
    if (chemin === "/api/environnements") {
      if (etat.lecture === "coupure") return null;
      if (etat.lecture === "illisible") return rep({ fichier: "environnements.json", cause: "illisible", message: "illisible" }, 500);
      return rep({ fichier: "environnements.json", environnements: etat.envs.map((nom) => ({ nom, variables: {}, ...(nom === etat.defaut ? { defaut: true } : {}) })) });
    }
    if (opts.method === "POST" && (chemin === "/api/shells" || chemin === "/api/claude")) {
      if (etat.ouverture.status === null) return null;
      return rep({ id: chemin === "/api/shells" ? 1 : 7 }, etat.ouverture.status, etat.ouverture.texte);
    }
    if (chemin === "/api/claude") return rep({ disponible: claude });
    if (chemin === "/api/shells") return rep({ instance: "i1", shells: [] });
    if (chemin === "/api/session") return rep({}, 204);
    if (chemin === "/api/fichiers") return rep({ entrees: [] });
    if (chemin === "/api/git/etat") return rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    if (chemin === "/api/agent/agents") return rep({ agents: [], erreurs: [] });
    if (chemin === "/api/agent/reglages") return rep({ providers: [], profils: [] });
    return rep({}, 409);
  }));
  vi.mocked(lire).mockImplementation(async () => undefined);
  return { appels, etat };
}

const menu = () => document.querySelector("[role=menu]");
const commandes = () => [...document.querySelectorAll("[role=menuitem]")];
const noms = () => commandes().map((c) => c.textContent);
const clicDroit = (b) => b.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
const echap = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
const ouvrirCar = async (b) => {
  clicDroit(b);
  await vi.waitFor(() => expect(menu()).not.toBeNull());
};

test("REQ183_AC1_AC7_AC10_AC11_menu_de_nouveau_shell_ordre_relu_ancrage_et_focus", async () => {
  const { appels, etat } = simuler({ envs: ["beta", "Alpha", "gamma"] });
  const { vue } = monter();
  const b = bout(vue, "Nouveau shell");
  expect(b.getAttribute("aria-haspopup")).toBe("menu");
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(b.getAttribute("aria-label")).toBe("Nouveau shell");
  const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  b.dispatchEvent(evt);
  expect(evt.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  expect(menu().getAttribute("aria-label")).toBe("Nouveau shell avec un environnement");
  expect(noms()).toEqual(["Alpha", "beta", "gamma"]);
  expect(document.activeElement).toBe(commandes()[0]);
  expect(b.getAttribute("aria-expanded")).toBe("true");
  expect(menu().classList.contains("ya-menu-rail")).toBe(true);
  // Rien n'est lancé tant qu'aucun environnement n'est choisi.
  expect(appels.some((a) => a.startsWith("POST"))).toBe(false);
  echap();
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(b);
  // Relu à chaque ouverture.
  etat.envs.push("delta");
  await ouvrirCar(b);
  expect(noms()).toEqual(["Alpha", "beta", "delta", "gamma"]);
});

test("REQ183_AC1_AC12_choix_d_un_environnement_ouvre_le_shell_comme_le_clic_et_le_clic_simple_n_en_passe_pas", async () => {
  const { appels } = simuler({ envs: ["dev", "prod"] });
  const { vue } = monter();
  const b = bout(vue, "Nouveau shell");
  b.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  expect(noms()).toEqual(["dev", "prod"]);
  commandes()[1].click();
  await vi.waitFor(() => expect(onglets(vue)).toEqual(["shell 1"]));
  expect(appels).toContain('POST /api/shells {"environnement":"prod"}');
  expect(menu()).toBeNull();
  expect(vue.querySelector(".shells [role=tab][aria-selected=true]")).not.toBeNull();
  expect(b.querySelector(".ya-badge").textContent).toBe("1");
  await vi.waitFor(() => expect(document.activeElement).toBe(vue.querySelector(".shells .terminal:not([hidden]) textarea")));
  b.click();
  await vi.waitFor(() => expect(appels.filter((a) => a.startsWith("POST /api/shells")).length).toBe(2));
  expect(appels).toContain("POST /api/shells");
});

test("REQ183_AC2_AC7_AC12_menu_de_claude_ancre_a_gauche_et_session_ouverte_avec_l_environnement", async () => {
  const { appels } = simuler({ envs: ["prod", "dev"] });
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  const b = boutonClaudeDe(vue);
  expect(b.getAttribute("aria-haspopup")).toBe("menu");
  expect(b.getAttribute("aria-expanded")).toBe("false");
  clavier(b, "ContextMenu");
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  expect(menu().getAttribute("aria-label")).toBe("Nouvelle session Claude avec un environnement");
  expect(noms()).toEqual(["dev", "prod"]);
  expect(b.getAttribute("aria-expanded")).toBe("true");
  commandes()[1].click();
  await vi.waitFor(() => expect(ongletsClaude(vue).length).toBe(1));
  expect(appels).toContain('POST /api/claude {"environnement":"prod"}');
  expect(ongletsClaude(vue)[0].getAttribute("aria-label")).toBe("Claude 1");
  expect(ongletsClaude(vue)[0].getAttribute("aria-selected")).toBe("true");
  await vi.waitFor(() => expect(document.activeElement).toBe(vue.querySelector(".claude textarea")));
  b.click();
  await vi.waitFor(() => expect(ongletsClaude(vue).length).toBe(2));
  expect(appels).toContain("POST /api/claude");
});

test("REQ183_AC5_AC12_environnement_supprime_bandeau_aucun_onglet_et_focus_sur_le_bouton", async () => {
  const { appels } = simuler({ envs: ["prod"], ouverture: { status: 404, texte: "l'environnement prod n'existe plus\n" } });
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  const sh = bout(vue, "Nouveau shell");
  await ouvrirCar(sh);
  commandes()[0].click();
  await vi.waitFor(() => expect(vue.textContent).toContain("Impossible d'ouvrir un shell : l'environnement prod n'existe plus."));
  expect(onglets(vue)).toEqual([]);
  expect(document.activeElement).toBe(sh);
  const cl = boutonClaudeDe(vue);
  await ouvrirCar(cl);
  commandes()[0].click();
  await vi.waitFor(() => expect(vue.textContent).toContain("Impossible d'ouvrir une session Claude : l'environnement prod n'existe plus."));
  expect(ongletsClaude(vue).length).toBe(0);
  expect(document.activeElement).toBe(cl);
  expect(appels).toContain('POST /api/claude {"environnement":"prod"}');
});

test("REQ183_AC6_sans_bouton_pas_de_menu", async () => {
  simuler({ claude: false });
  const { vue } = monter({ reglages: { fonctions: { shells: false } } });
  await attendre();
  await attendre();
  expect(bout(vue, "Nouveau shell")).toBeNull();
  expect(boutonClaudeDe(vue)).toBeNull();
  expect(vue.querySelector("[aria-haspopup=menu][aria-label=Claude]")).toBeNull();
  expect(menu()).toBeNull();
});

test("REQ183_AC8_aucun_environnement_et_fichier_illisible_une_seule_commande_desactivee", async () => {
  const { etat, appels } = simuler({ envs: [] });
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  const b = bout(vue, "Nouveau shell");
  await ouvrirCar(b);
  expect(noms()).toEqual(["Aucun environnement. Créez-en un avec Ctrl+P, puis > Environnements."]);
  expect(commandes()[0].getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(commandes()[0]);
  commandes()[0].click();
  await attendre();
  expect(menu()).not.toBeNull();
  expect(onglets(vue)).toEqual([]);
  expect(appels.some((a) => a.startsWith("POST"))).toBe(false);
  echap();
  etat.lecture = "illisible";
  await ouvrirCar(boutonClaudeDe(vue));
  expect(noms()).toEqual(["Environnements illisibles. Ouvrez Ctrl+P, puis > Environnements."]);
  expect(commandes()[0].getAttribute("aria-disabled")).toBe("true");
});

test("REQ183_AC9_AC11_coupure_a_l_ouverture_du_menu_et_au_choix", async () => {
  const { etat, appels } = simuler({ envs: ["prod"], lecture: "coupure" });
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  const b = bout(vue, "Nouveau shell");
  await ouvrirCar(b);
  expect(noms()).toEqual(["Connexion perdue. Réessayez au retour."]);
  expect(commandes()[0].getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(commandes()[0]);
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await attendre();
  expect(onglets(vue)).toEqual([]);
  expect(appels.some((a) => a.startsWith("POST"))).toBe(false);
  echap();
  // Coupure au choix, menu ouvert avant.
  etat.lecture = undefined;
  etat.ouverture = { status: null };
  const cl = boutonClaudeDe(vue);
  await ouvrirCar(cl);
  commandes()[0].click();
  await vi.waitFor(() => expect(vue.textContent).toContain("Connexion perdue. Réessayez au retour."));
  expect(ongletsClaude(vue).length).toBe(0);
  expect(document.activeElement).toBe(cl);
});

// ---- T-447 : onglet « Logs » dans la zone des shells (REQ-187, REQ-188) ----

const boutonLogs = (vue) => vue.querySelector("footer button.ya-logs");
const zoneVisible = (vue) => vue.querySelector(".cadre-shells") !== null && !vue.querySelector(".cadre-shells").hidden;
const filtrer = () => document.activeElement?.getAttribute("placeholder") === "Filtrer";
const fermer = (vue) => vue.querySelector("[aria-label='Fermer Logs']");
const ouvrirShell = async (vue) => {
  bout(vue, "Nouveau shell").click();
  await vi.waitFor(() => expect(onglets(vue).some((n) => n.startsWith("shell"))).toBe(true));
};

test("REQ188_AC1_REQ187_AC2_clic_sur_Logs_ouvre_la_zone_deplie_et_ne_double_jamais_l_onglet", async () => {
  simuler();
  const { vue } = monter();
  await attendre();
  await attendre();
  expect(zoneVisible(vue)).toBe(false);
  boutonLogs(vue).click();
  expect(zoneVisible(vue)).toBe(true);
  expect(onglets(vue)).toEqual(["Logs"]);
  expect(actifDe(vue)).toBe("Logs");
  expect(filtrer()).toBe(true);
  // Un shell s'insère avant « Logs » et devient actif.
  await ouvrirShell(vue);
  expect(onglets(vue)).toEqual(["shell 1", "Logs"]);
  expect(actifDe(vue)).toBe("shell 1");
  // « Logs » redevient actif, jamais deux onglets.
  boutonLogs(vue).click();
  boutonLogs(vue).click();
  expect(onglets(vue)).toEqual(["shell 1", "Logs"]);
  expect(actifDe(vue)).toBe("Logs");
  expect(filtrer()).toBe(true);
  // Zone repliée : elle se déplie.
  vue.querySelector("header [aria-label='Replier les shells']").click();
  expect(zoneVisible(vue)).toBe(false);
  boutonLogs(vue).click();
  expect(zoneVisible(vue)).toBe(true);
  expect(actifDe(vue)).toBe("Logs");
});

test("REQ188_AC3_Logs_actif_grise_Reduire_et_Fermer_et_un_clic_sur_le_shell_les_rend", async () => {
  simuler();
  const { vue } = monter();
  await attendre();
  await ouvrirShell(vue);
  expect(bout(vue, "Réduire le shell").disabled).toBe(false);
  boutonLogs(vue).click();
  expect(bout(vue, "Réduire le shell").disabled).toBe(true);
  expect(bout(vue, "Fermer le shell").disabled).toBe(true);
  expect(bout(vue, "Nouveau shell").disabled).toBe(false);
  vue.querySelector(".shells [role=tab]").click();
  expect(actifDe(vue)).toBe("shell 1");
  expect(bout(vue, "Réduire le shell").disabled).toBe(false);
  expect(bout(vue, "Fermer le shell").disabled).toBe(false);
});

test("REQ188_AC2_AC12_fermer_Logs_seul_fait_disparaitre_la_zone_et_le_focus_va_sur_le_bouton_Logs", async () => {
  simuler();
  const { vue } = monter();
  await attendre();
  // Une ligne au journal avant : la fermeture n'y touche pas.
  journaliser({ severite: "erreur", message: "ligne gardée" });
  const lignesAvant = lignesDuJournal().length;
  boutonLogs(vue).click();
  expect(vue.querySelectorAll(".ya-journal tbody tr").length).toBe(lignesAvant);
  fermer(vue).click();
  expect(document.querySelector("dialog[open], [role=dialog]")).toBeNull();
  expect(zoneVisible(vue)).toBe(false);
  expect(document.activeElement).toBe(boutonLogs(vue));
  expect(boutonLogs(vue).classList.contains("ya-focus-garde")).toBe(true);
  expect(lignesDuJournal().length).toBe(lignesAvant);
  // Rouvert : un seul onglet, la ligne est là, et Suppr le ferme de même sans rien changer.
  boutonLogs(vue).click();
  expect(onglets(vue)).toEqual(["Logs"]);
  expect(vue.querySelector(".ya-journal tbody").textContent).toContain("ligne gardée");
  clavier(vue.querySelector(".shells [role=tab][aria-selected=true]"), "Delete");
  expect(zoneVisible(vue)).toBe(false);
  expect(document.activeElement).toBe(boutonLogs(vue));
  expect(lignesDuJournal().length).toBe(lignesAvant);
  boutonLogs(vue).click();
  expect(vue.querySelector(".ya-journal tbody").textContent).toContain("ligne gardée");
});

test("REQ188_AC2_fermer_Logs_avec_un_shell_visible_rend_la_main_au_shell_et_a_son_terminal", async () => {
  simuler();
  const { vue } = monter();
  await attendre();
  await ouvrirShell(vue);
  boutonLogs(vue).click();
  fermer(vue).click();
  expect(document.querySelector("dialog[open], [role=dialog]")).toBeNull();
  expect(onglets(vue)).toEqual(["shell 1"]);
  expect(actifDe(vue)).toBe("shell 1");
  expect(zoneVisible(vue)).toBe(true);
  await vi.waitFor(() => expect(document.activeElement).toBe(vue.querySelector(".shells .terminal:not([hidden]) textarea")));
});

test("REQ188_AC8_sans_la_fonction_shells_le_bouton_ouvre_la_zone_avec_le_seul_onglet_Logs_puis_elle_part", async () => {
  simuler();
  const { vue } = monter({ reglages: { fonctions: { shells: false } } });
  await attendre();
  expect(vue.querySelector(".cadre-shells")).toBeNull();
  boutonLogs(vue).click();
  expect(zoneVisible(vue)).toBe(true);
  expect(onglets(vue)).toEqual(["Logs"]);
  expect(vue.querySelector("header [aria-label='Replier les shells']")).toBeNull();
  expect(vue.querySelector(".cadre-rail-commandes")).toBeNull();
  fermer(vue).click();
  expect(vue.querySelector(".cadre-shells")).toBeNull();
  expect(document.activeElement).toBe(boutonLogs(vue));
});

test("REQ188_AC8_apres_un_rechargement_l_onglet_Logs_est_ferme", async () => {
  simuler();
  const un = monter();
  await attendre();
  boutonLogs(un.vue).click();
  expect(onglets(un.vue)).toEqual(["Logs"]);
  un.vue.detruire();
  un.vue.remove();
  const deux = monter();
  await attendre();
  expect(onglets(deux.vue)).toEqual([]);
  expect(zoneVisible(deux.vue)).toBe(false);
});

// ---- REQ-202 : environnement par défaut ----

test("REQ202_AC3_AC5_AC6_AC8_clic_simple_lit_l_environnement_par_defaut_au_lancement_le_menu_l_emporte", async () => {
  const { appels, etat } = simuler({ envs: ["dev", "prod"] });
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  const b = bout(vue, "Nouveau shell");
  // Défini après le montage (autre instance) : lu au clic.
  etat.defaut = "prod";
  b.click();
  await vi.waitFor(() => expect(onglets(vue)).toEqual(["shell 1"]));
  expect(appels).toContain('POST /api/shells {"environnement":"prod"}');
  expect(vue.querySelector(".shells [role=tab][aria-selected=true]")).not.toBeNull();
  expect(b.querySelector(".ya-badge").textContent).toBe("1");
  await vi.waitFor(() => expect(document.activeElement).toBe(vue.querySelector(".shells .terminal:not([hidden]) textarea")));
  // Claude : même chemin.
  boutonClaudeDe(vue).click();
  await vi.waitFor(() => expect(ongletsClaude(vue).length).toBe(1));
  expect(appels).toContain('POST /api/claude {"environnement":"prod"}');
  expect(ongletsClaude(vue)[0].getAttribute("aria-label")).toBe("Claude 1");
  // « dev » choisi dans le menu l'emporte.
  await ouvrirCar(b);
  commandes()[0].click();
  await vi.waitFor(() => expect(appels).toContain('POST /api/shells {"environnement":"dev"}'));
  // Case décochée : le clic simple suivant lance sans environnement ; le shell déjà ouvert n'est pas touché.
  etat.defaut = undefined;
  b.click();
  await vi.waitFor(() => expect(appels.filter((a) => a === "POST /api/shells")).toHaveLength(1));
});

test("REQ202_AC5_fichier_illisible_ou_coupure_le_clic_simple_lance_sans_environnement_et_sans_message", async () => {
  const { appels, etat } = simuler({ envs: ["prod"] });
  etat.defaut = "prod";
  etat.lecture = "illisible";
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  bout(vue, "Nouveau shell").click();
  await vi.waitFor(() => expect(onglets(vue)).toEqual(["shell 1"]));
  expect(appels).toContain("POST /api/shells");
  expect(vue.textContent).not.toContain("illisible");
  expect(vue.textContent).not.toContain("Impossible");
  expect([...document.querySelectorAll("[role=alert]")].map((a) => a.textContent.trim()).filter(Boolean)).toEqual([]);
  etat.lecture = "coupure";
  boutonClaudeDe(vue).click();
  await vi.waitFor(() => expect(ongletsClaude(vue).length).toBe(1));
  expect(appels).toContain("POST /api/claude");
});

test("REQ202_AC10_avec_un_environnement_par_defaut_noms_info_bulles_et_menus_du_rail_sont_inchangés_et_sans_marque", async () => {
  const { etat } = simuler({ envs: ["dev", "prod"] });
  etat.defaut = "prod";
  const { vue } = monter();
  await vi.waitFor(() => expect(boutonClaudeDe(vue)).not.toBeNull());
  const sh = bout(vue, "Nouveau shell");
  const cl = boutonClaudeDe(vue);
  expect(sh.getAttribute("aria-label")).toBe("Nouveau shell");
  expect(cl.getAttribute("aria-label")).toBe("Claude");
  sh.parentElement.dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(document.querySelector("[role=tooltip]")?.textContent).toBe("Nouveau shell"));
  cl.parentElement.dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(document.querySelector("[role=tooltip]")?.textContent).toBe("Nouvelle session Claude"));
  for (const b of [sh, cl]) {
    await ouvrirCar(b);
    expect(noms()).toEqual(["dev", "prod"]);
    expect(commandes().some((c) => c.querySelector("svg") || c.hasAttribute("aria-checked") || c.textContent.includes("défaut"))).toBe(false);
    echap();
  }
});
