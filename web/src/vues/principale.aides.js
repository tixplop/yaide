import { readFileSync } from "node:fs";
import { afterEach, vi } from "vitest";
import { ecrire, lire } from "../stockage.js";
import { vuePrincipale } from "./principale.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

// jsdom n'a pas <dialog>.showModal : les tests s'appuyaient sur le simulacre laissé par un test précédent du fichier unique.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

// `demarrer` (shells.js) relit les shells toutes les secondes tant que le serveur ne répond pas, même après `detruire` : une vue
// détruite appelait alors le `fetch` simulé du test suivant. On garde les pauses d'une seconde et on les annule en fin de test.
const setTimeoutReel = globalThis.setTimeout;
const pauses = new Set();
globalThis.setTimeout = (fn, delai, ...args) => {
  const id = setTimeoutReel(fn, delai, ...args);
  if (delai === 1000) pauses.add(id);
  return id;
};

export let vues = [];

afterEach(() => {
  for (const id of pauses) clearTimeout(id);
  pauses.clear();
  for (const v of vues) v.detruire();
  vues = [];
  vi.unstubAllGlobals();
  vi.mocked(lire).mockImplementation(async () => undefined);
  vi.mocked(ecrire).mockClear();
  document.body.replaceChildren();
});

export function monter(options = {}) {
  const surDeconnexion = vi.fn();
  const vue = vuePrincipale({ chemin: "/home/x/projet", surDeconnexion, ...options });
  document.body.append(vue);
  vues.push(vue);
  return { vue, surDeconnexion };
}

export const attendre = () => new Promise((r) => setTimeout(r, 0));

export const poignees = (vue) => ({ panneau: vue.querySelector("[aria-label='Largeur du panneau']"), shells: vue.querySelector("[aria-label='Hauteur des shells']") });

// ---- T-045 : réduire un shell ----

// jsdom n'a pas matchMedia, dont xterm a besoin.
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

HTMLCanvasElement.prototype.getContext = () => null;

export class FauxWebSocket {
  static tous = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.envoyes = [];
    FauxWebSocket.tous.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send(m) {
    this.envoyes.push(m);
  }
  close() {}
}

export const tailles = (id) => FauxWebSocket.tous.filter((w) => w.url.endsWith(`/shells/${id}/ws`)).flatMap((w) => w.envoyes.filter((m) => typeof m === "string" && m.startsWith("taille")));

export function simulerShells({ ids, instance = "i1", precedent }) {
  FauxWebSocket.tous = [];
  vi.stubGlobal("WebSocket", FauxWebSocket);
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = url.split("?")[0];
    appels.push(`${opts.method ?? "GET"} ${chemin}`);
    const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps, text: async () => "" });
    if (chemin === "/api/shells" && opts.method === "POST") return rep({ id: 9 }, 201);
    if (chemin === "/api/shells") return rep({ instance, shells: ids });
    if (chemin === "/api/fichiers") return rep({ entrees: [] });
    if (chemin === "/api/session") return rep({}, 204);
    if (chemin === "/api/git/etat") return rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    return rep({}, 409);
  }));
  vi.mocked(lire).mockImplementation(async (cle) => (cle === "serveur" ? precedent : undefined));
  return appels;
}

export const bout = (vue, nom) => vue.querySelector(`.cadre-rail-commandes [aria-label='${nom}']`);

export const onglets = (vue) => [...vue.querySelectorAll(".shells [role=tab]")].map((t) => t.textContent);

export const actifDe = (vue) => vue.querySelector(".shells [role=tab][aria-selected=true]")?.textContent;

export const zone = (vue) => vue.querySelector(".cadre-shells");

export const terminer = (id) => FauxWebSocket.tous.find((w) => w.url.endsWith(`/shells/${id}/ws`)).onclose({ code: 1000 });

// ---- T-037 : statuts git dans l'arbre, le rail et l'en-tête ----

export const ENTREES = [
  { nom: "src", dossier: true, ignore: false },
  { nom: "main.rs", dossier: false, ignore: false },
  { nom: "gris.log", dossier: false, ignore: true },
];

export function simulerServeur(etat) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const chemin = url.split("?")[0];
    appels.push(url);
    const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps });
    if (chemin === "/api/fichiers") return rep({ entrees: url.includes("chemin=src") ? [{ nom: "a.rs", dossier: false, ignore: false }] : ENTREES });
    if (chemin === "/api/shells") return { ok: false, status: 503, json: async () => ({}) };
    if (chemin === "/api/fichier") return { ok: true, status: 200, text: async () => "fn main() {}", headers: { get: () => "1" } };
    if (chemin === "/api/git/etat") return etat ? rep(etat) : rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    return { ok: true, status: 204, json: async () => ({}) };
  }));
  return appels;
}

export const ETAT_GIT = (changements) => ({ branche: "main", detachee: false, branches: ["main"], changements });

export const ligne = (vue, nom) => [...vue.querySelectorAll(".fichiers [role=treeitem]")].find((l) => l.querySelector(".liste-libelle").textContent === nom);

// ---- T-056 : aucun shell au départ, compteur sur « Nouveau shell » ----

// ---- T-057 : relecture toutes les 3 s ----

/** Serveur simulé pour la relecture : compte les appels git et arbre ; `etat.coupe` coupe la session. */

export function simulerRelecture() {
  const s = { coupe: false, git: 0, arbre: 0, retenir: null, casse: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (url === "/api/session") {
        if (s.coupe) throw new TypeError("coupure");
        return { status: 204 };
      }
      if (url === "/api/git/etat") {
        s.git += 1;
        if (s.retenir) await s.retenir;
        if (s.casse) return { ok: true, status: 200, json: async () => { throw new SyntaxError("JSON illisible"); } };
        return { ok: true, status: 200, json: async () => ({ branche: "main", detachee: false, branches: ["main"], changements: [] }) };
      }
      if (url.startsWith("/api/fichiers?")) {
        s.arbre += 1;
        return { ok: true, status: 200, json: async () => ({ entrees: [{ nom: "a.txt", dossier: false }] }) };
      }
      return { ok: false, status: 500, text: async () => "", json: async () => ({ message: "" }) };
    }),
  );
  return s;
}

export async function avecHorloge(corps) {
  vi.useFakeTimers();
  try {
    await corps();
  } finally {
    vi.useRealTimers();
  }
}

// ---- T-058 : replier le panneau et la zone des shells ----

export const barreTitre = (vue, nom) => vue.querySelector(`header [aria-label='${nom}']`);

export const icone = (b) => b.querySelector("svg").getAttribute("data-icone");

export const aside = (vue) => vue.querySelector("aside");

// ---- T-060 : replier le panneau depuis son en-tête ----

export const repliDuPanneau = (vue) => [...aside(vue).querySelectorAll("button")].find((b) => !b.closest("[hidden]"));

export const resultatsVides = () => {
  const base = vi.mocked(fetch);
  vi.stubGlobal("fetch", vi.fn(async (url, ...r) => (url.startsWith("/api/recherche") ? { ok: true, status: 200, json: async () => ({ resultats: [], limite: false }) } : base(url, ...r))));
};

export function paletteCommandes(texte) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true }));
  const entree = document.querySelector("dialog input");
  entree.value = texte;
  entree.dispatchEvent(new Event("input", { bubbles: true }));
  return entree;
}

export const nomsCommandes = () => [...document.querySelectorAll("dialog [role=option] .liste-libelle")].map((l) => l.textContent);

export const agentCol = (vue) => vue.querySelector("aside.cadre-agent");

export const boutonAgentDe = (vue) => vue.querySelector(".cadre-rail-droit [aria-label=Agent]");

export const boutonAgentsDe = (vue) => vue.querySelector(".cadre-rail-droit [aria-label=Agents]");

export const champAgent = (vue) => vue.querySelector(".agent-corps textarea");

export const clavier = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

export const largeur = (n) => vi.stubGlobal("innerWidth", n);

// ---------- T-100 : « Agents » et la colonne à deux vues ----------

export const AGENTS = [{ dossier: "relecteur", nom: "Relecteur", avatar: "", couleur: "vert" }];

export const jsonOk = (corps) => ({ ok: true, status: 200, json: async () => corps });

/** Faux serveur : agents, réglages, et fichiers (`fichiers` : chemin -> contenu). */

export function fauxServeur({ fichiers = {}, agents = AGENTS } = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    appels.push(`${opts.method ?? "GET"} ${decodeURIComponent(u)}`);
    if (u === "/api/agent/agents") return jsonOk({ agents, erreurs: [] });
    if (u === "/api/agent/reglages") return jsonOk({ providers: [], profils: [] });
    if (u.startsWith("/api/fichier?chemin=")) {
      const c = decodeURIComponent(u.split("chemin=")[1]);
      if (c in fichiers) return { ok: true, status: 200, text: async () => fichiers[c], headers: { get: () => "v1" } };
      return { ok: false, status: 404, json: async () => ({ cause: "introuvable", message: "Fichier introuvable." }) };
    }
    if (u.startsWith("/api/fichiers/creer")) {
      const c = decodeURIComponent(u.split("chemin=")[1].split("&")[0]);
      fichiers[c] = "";
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: false, status: 500, json: async () => ({ cause: "erreur", message: "erreur 500" }) };
  }));
  return appels;
}

export const corpsAgents = (vue) => vue.querySelector(".agents-corps");

export const titreColonne = (vue) => agentCol(vue).querySelector("h2").textContent;

// ---- T-106 : « Claude » dans le rail droit ----

export function simulerClaude({ disponible = true, ouverture = { status: 201, corps: { id: 7 } }, coupure = false } = {}) {
  FauxWebSocket.tous = [];
  vi.stubGlobal("WebSocket", FauxWebSocket);
  const appels = [];
  const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps, text: async () => (typeof corps === "string" ? corps : "") });
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = String(url).split("?")[0];
    appels.push(`${opts.method ?? "GET"} ${chemin}`);
    if (chemin === "/api/claude" && opts.method === "POST") return coupure ? null : rep(ouverture.corps, ouverture.status);
    if (chemin === "/api/claude") return rep({ disponible });
    if (chemin === "/api/shells") return rep({ instance: "i1", shells: [] });
    if (chemin === "/api/fichiers") return rep({ entrees: [{ nom: "main.rs", dossier: false, ignore: false }] });
    if (chemin === "/api/fichier") return { ok: true, status: 200, text: async () => "fn main() {}", headers: { get: () => "1" } };
    if (chemin === "/api/git/etat") return rep({ cause: "pas-depot", message: "pas un dépôt" }, 409);
    if (chemin === "/api/agent/agents") return rep({ agents: [], erreurs: [] });
    if (chemin === "/api/agent/reglages") return rep({ providers: [], profils: [] });
    return rep({}, 409);
  }));
  vi.mocked(lire).mockImplementation(async () => undefined);
  return appels;
}

export const boutonClaudeDe = (vue) => vue.querySelector(".cadre-rail-droit [aria-label=Claude]");

export const ongletsClaude = (vue) => [...vue.querySelectorAll("[role=tab]")].filter((t) => t.getAttribute("aria-label")?.startsWith("Claude "));

// ---- T-114 : fonctions désactivées (REQ-070) ----

/** Serveur simulé qui note chaque requête (méthode et chemin). */

export function simulerTout({ claude = true } = {}) {
  FauxWebSocket.tous = [];
  vi.stubGlobal("WebSocket", FauxWebSocket);
  const appels = [];
  const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps, text: async () => "" });
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = String(url).split("?")[0];
    appels.push(`${opts.method ?? "GET"} ${chemin}`);
    if (chemin === "/api/claude") return rep({ disponible: claude });
    if (chemin === "/api/shells") return rep({ instance: "i1", shells: [1] });
    if (chemin === "/api/fichiers") return rep({ entrees: [{ nom: "a.txt", dossier: false }] });
    if (chemin === "/api/session") return rep({}, 204);
    if (chemin === "/api/git/etat") return rep({ branche: "main", detachee: false, branches: ["main"], changements: [{ chemin: "a.txt", lettre: "M", indexe: false }] });
    if (chemin === "/api/agent/agents") return rep({ agents: [], erreurs: [] });
    if (chemin === "/api/agent/reglages") return rep({ providers: [], profils: [] });
    return rep({}, 409);
  }));
  vi.mocked(lire).mockImplementation(async () => undefined);
  return appels;
}

export const nomsRail = (vue) => [...vue.querySelectorAll("[role=tab]")].filter((t) => t.closest(".cadre-rail")).map((t) => t.getAttribute("aria-label"));

export const sans = (appels, debut) => appels.filter((a) => a.includes(debut));

// ---- T-126 : « opencode » dans le rail droit ----

/** Serveur simulé : détection d'opencode, création de session (`creation` : { status, corps } ou fonction, `null` = coupure). */

export function simulerOpencode({ opencode = true, claude = true, creation } = {}) {
  let n = 0;
  if (creation === undefined) creation = () => ({ status: 200, corps: { data: { id: `ses_${++n}` } } });
  FauxWebSocket.tous = [];
  vi.stubGlobal("WebSocket", FauxWebSocket);
  vi.stubGlobal("EventSource", class { close() {} });
  const appels = [];
  const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps, text: async () => (typeof corps === "string" ? corps : JSON.stringify(corps)) });
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const chemin = String(url).split("?")[0];
    appels.push(`${opts.method ?? "GET"} ${chemin}${opts.body ? ` ${opts.body}` : ""}`);
    if (chemin === "/api/opencode") return rep({ disponible: opencode });
    if (chemin === "/api/opencode/api/session" && opts.method === "POST") {
      const c = typeof creation === "function" ? await creation() : creation;
      return c === null ? null : rep(c.corps, c.status);
    }
    if (chemin === "/api/claude") return rep({ disponible: claude });
    if (chemin === "/api/shells") return rep({ instance: "i1", shells: [] });
    if (chemin === "/api/fichiers") return rep({ entrees: [{ nom: "main.rs", dossier: false, ignore: false }] });
    if (chemin === "/api/fichier") return { ok: true, status: 200, text: async () => "fn main() {}", headers: { get: () => "1" } };
    if (chemin === "/api/git/etat") return rep({ branche: "main", detachee: false, branches: ["main"], changements: [] });
    if (chemin === "/api/agent/agents") return rep({ agents: [], erreurs: [] });
    if (chemin === "/api/agent/reglages") return rep({ providers: [], profils: [] });
    return rep({}, 409);
  }));
  vi.mocked(lire).mockImplementation(async () => undefined);
  return appels;
}

export const boutonOcDe = (vue) => vue.querySelector(".cadre-rail-droit [aria-label=opencode]");

export const ongletsOc = (vue) => [...vue.querySelectorAll("[role=tab]")].filter((t) => t.getAttribute("aria-label")?.startsWith("opencode "));

export const nomDuChamp = (el) => el?.getAttribute("aria-label") ?? el?.labels?.[0]?.textContent;

export const nomsRailDroit = (vue) => [...vue.querySelectorAll(".cadre-rail-droit button")].map((b) => b.getAttribute("aria-label"));
