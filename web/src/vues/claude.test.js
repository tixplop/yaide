import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { listeShells } from "../api.js";
import { vueClaude } from "./claude.js";

const TEXTE = "Claude Code s'est arrêté (code 1). Corrigez l'erreur ci-dessous, puis relancez Claude.";

vi.mock("../api.js", () => ({ listeShells: vi.fn(async () => ({ instance: "i", shells: [] })) }));

// Terminal factice : l'API de C-009 que la vue utilise, sans xterm.
const terminaux = [];
vi.mock("../ui/terminal.js", () => ({
  terminal: ({ flux, nom, connecte, surTaille }) => {
    const racine = document.createElement("div");
    const t = {
      racine,
      flux,
      nom,
      surTaille,
      connecte,
      arrete: false,
      attente: !connecte,
      ecrit: [],
    };
    racine.term = { cols: 80, rows: 24, reset: vi.fn() };
    flux.addEventListener("message", (e) => t.ecrit.push(e.data));
    racine.focus = vi.fn();
    // Une mesure à 100 × 30 : le terminal transmet sa taille quand elle change.
    racine.ajuster = () => {
      racine.term.cols = 100;
      racine.term.rows = 30;
      surTaille(100, 30);
    };
    racine.definirConnecte = (oui) => {
      t.connecte = oui;
      t.attente = !oui && !t.arrete;
    };
    racine.definirArrete = () => {
      t.arrete = true;
      t.attente = false;
    };
    racine.detruire = vi.fn();
    terminaux.push(t);
    return racine;
  },
}));

class FauxWebSocket {
  static tous = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.envoyes = [];
    FauxWebSocket.tous.push(this);
  }
  ouvrir() {
    this.readyState = 1;
    this.onopen();
  }
  send(m) {
    this.envoyes.push(m);
  }
  close() {}
}
const dernier = () => FauxWebSocket.tous.at(-1);

let vues = [];
beforeEach(() => {
  vi.useFakeTimers();
  FauxWebSocket.tous = [];
  terminaux.length = 0;
  vi.stubGlobal("WebSocket", FauxWebSocket);
  vi.mocked(listeShells).mockImplementation(async () => ({ instance: "i", shells: [] }));
});
afterEach(() => {
  for (const v of vues) v.detruire();
  vues = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function monter() {
  const surFin = vi.fn();
  const vue = vueClaude({ id: 7, nom: "Claude 1", surFin });
  document.body.append(vue.corps);
  vues.push(vue);
  return { vue, surFin };
}

test("REQ068_AC3_sortie_affichee_et_frappe_envoyee", () => {
  monter();
  const ws = dernier();
  expect(ws.url).toMatch(/^wss?:\/\/.+\/api\/shells\/7\/ws$/);
  expect(terminaux[0].nom).toBe("Claude 1");
  ws.ouvrir();
  ws.onmessage({ data: "bonjour" });
  expect(terminaux[0].ecrit).toEqual(["bonjour"]);
  terminaux[0].flux.send("ls\r");
  const envoye = ws.envoyes.find((m) => typeof m !== "string");
  expect(new TextDecoder().decode(envoye)).toBe("ls\r");
});

test("REQ068_AC15_code_1_message_et_terminal_arrete", () => {
  const { vue, surFin } = monter();
  dernier().ouvrir();
  dernier().onclose({ code: 1000, reason: "code=1" });
  const alerte = vue.corps.querySelector("[role=alert]");
  expect(alerte.textContent).toBe(TEXTE);
  expect(alerte.compareDocumentPosition(terminaux[0].racine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(terminaux[0].arrete).toBe(true);
  expect(surFin).toHaveBeenCalledWith({ code: 1 });
  // Pas de reprise : un code d'échec est définitif.
  vi.advanceTimersByTime(5000);
  expect(FauxWebSocket.tous).toHaveLength(1);
});

test("REQ068_AC15_code_0_fin_sans_message", () => {
  const { vue, surFin } = monter();
  dernier().ouvrir();
  dernier().onclose({ code: 1000, reason: "code=0" });
  expect(vue.corps.querySelector("[role=alert]")).toBeNull();
  expect(surFin).toHaveBeenCalledWith({ code: 0 });
  expect(terminaux[0].arrete).toBe(false);
});

test("REQ068_AC18_attente_de_la_connexion_puis_reprise", async () => {
  const { surFin } = monter();
  dernier().ouvrir();
  expect(terminaux[0].attente).toBe(false);
  dernier().onclose({ code: 1006, reason: "" });
  expect(terminaux[0].attente).toBe(true);
  // Serveur injoignable : on attend.
  vi.mocked(listeShells).mockResolvedValue(null);
  await vi.advanceTimersByTimeAsync(3000);
  expect(FauxWebSocket.tous).toHaveLength(1);
  vi.mocked(listeShells).mockResolvedValue({ instance: "i", shells: [] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(FauxWebSocket.tous).toHaveLength(2);
  dernier().ouvrir();
  expect(terminaux[0].attente).toBe(false);
  expect(terminaux[0].connecte).toBe(true);
  expect(surFin).not.toHaveBeenCalled();
});

test("REQ068_AC18_1001_on_attend_le_retour", async () => {
  const { surFin } = monter();
  dernier().ouvrir();
  dernier().onclose({ code: 1001, reason: "" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(FauxWebSocket.tous).toHaveLength(2);
  expect(surFin).not.toHaveBeenCalled();
});

test("REQ068_AC9_session_disparue_apres_redemarrage", async () => {
  const { vue, surFin } = monter();
  dernier().ouvrir();
  dernier().onclose({ code: 1001, reason: "" });
  await vi.advanceTimersByTimeAsync(1000);
  // Yaide a redémarré : le serveur répond, mais refuse la connexion (404).
  dernier().onclose({ code: 1006, reason: "" });
  expect(surFin).toHaveBeenCalledWith({ disparue: true });
  expect(surFin).toHaveBeenCalledTimes(1);
  expect(vue.corps.querySelector("[role=alert]")).toBeNull();
  await vi.advanceTimersByTimeAsync(5000);
  expect(FauxWebSocket.tous).toHaveLength(2);
});

test("REQ068_AC6_taille_transmise_apres_ajuster", () => {
  const { vue } = monter();
  const ws = dernier();
  ws.ouvrir();
  expect(ws.envoyes).toEqual(["taille 80 24"]);
  vue.ajuster();
  expect(ws.envoyes.at(-1)).toBe("taille 100 30");
  vue.focus();
  expect(terminaux[0].racine.focus).toHaveBeenCalled();
});

test("detruire_ferme_sans_reprise", async () => {
  const { vue, surFin } = monter();
  dernier().ouvrir();
  vue.detruire();
  await vi.advanceTimersByTimeAsync(5000);
  expect(FauxWebSocket.tous).toHaveLength(1);
  expect(surFin).not.toHaveBeenCalled();
});
