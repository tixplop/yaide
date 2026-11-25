import { expect, test, vi } from "vitest";
import { lire } from "../stockage.js";
import { monter, attendre, FauxWebSocket, bout, onglets, boutonClaudeDe, ongletsClaude, clavier } from "./principale.aides.js";

vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

/**
 * Serveur simulé : `etat.envs` (liste de noms), `etat.lecture` (`"illisible"`, `"coupure"` ou rien), `etat.ouverture` (statut et texte du POST).
 * Rend `{ appels, etat }` ; `appels` note chaque requête, avec son corps pour les POST.
 */
function simuler({ envs = [], lecture, claude = true, ouverture = { status: 201 } } = {}) {
  FauxWebSocket.tous = [];
  vi.stubGlobal("WebSocket", FauxWebSocket);
  const etat = { envs, lecture, ouverture };
  const appels = [];
  const rep = (corps, status = 200, texte = "") => ({ ok: status < 400, status, json: async () => corps, text: async () => texte });
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = String(url).split("?")[0];
    appels.push(opts.body ? `${opts.method} ${chemin} ${opts.body}` : `${opts.method ?? "GET"} ${chemin}`);
    if (chemin === "/api/environnements") {
      if (etat.lecture === "coupure") return null;
      if (etat.lecture === "illisible") return rep({ fichier: "environnements.json", cause: "illisible", message: "illisible" }, 500);
      return rep({ fichier: "environnements.json", environnements: etat.envs.map((nom) => ({ nom, variables: {} })) });
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
