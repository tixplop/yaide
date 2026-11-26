import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { vueServeurMcpYaide } from "./serveur-mcp-yaide.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const ADRESSE = "http://127.0.0.1:9443/mcp";
const COMMANDE = `claude mcp add --transport http yaide ${ADRESSE}`;
const OPENCODE = `{
  "mcp": {
    "servers": {
      "yaide": {
        "type": "remote",
        "url": "${ADRESSE}",
        "oauth": false
      }
    }
  }
}`;
const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps });

function monter(reponse, { clipboard } = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    appels.push({ url: String(url), methode: options.method ?? "GET" });
    if (reponse === "coupure") throw new TypeError("réseau");
    return typeof reponse === "function" ? reponse() : reponse;
  }));
  const copies = [];
  vi.stubGlobal("navigator", {
    clipboard: clipboard ?? { writeText: async (t) => void copies.push(t) },
  });
  const ouvreur = document.createElement("button");
  document.body.append(ouvreur);
  ouvreur.focus();
  const fermetures = [];
  const v = vueServeurMcpYaide({ surFermeture: () => fermetures.push(true) });
  return { v, appels, copies, ouvreur, fermetures };
}
const dlg = () => document.querySelector("dialog");
const parNom = (nom) => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom || b.textContent === nom);
const echap = () => dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
const texteDe = (id) => document.getElementById(id).textContent;
const IMAGE = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));

test("REQ189_AC10_dialog_modal_nomme_echap_ferme_et_rend_le_focus", async () => {
  const m = monter(rep({ adresse: ADRESSE }));
  await m.v.ouvrir();
  const d = dlg();
  expect(d.tagName).toBe("DIALOG");
  expect(d.hasAttribute("open")).toBe(true);
  expect(texteDe(d.getAttribute("aria-labelledby"))).toBe("Serveur MCP de Yaide");
  expect(m.appels).toEqual([{ url: "/api/serveur-mcp", methode: "GET" }]);
  echap();
  expect(dlg()).toBeNull();
  expect(m.fermetures).toHaveLength(1);
  // Le rappel de fermeture rend le focus à l'élément d'avant Ctrl+P (principale.js) ; ici, la fermeture est signalée une fois.
  await m.v.ouvrir();
  expect(m.appels).toHaveLength(2);
  parNom("Fermer").click();
  expect(dlg()).toBeNull();
  expect(m.fermetures).toHaveLength(2);
});

test("REQ189_AC11_contenu_dans_l_ordre_sans_jeton", async () => {
  const m = monter(rep({ adresse: ADRESSE }));
  await m.v.ouvrir();
  const d = dlg();
  expect(texteDe(d.getAttribute("aria-describedby"))).toBe(
    "Claude Code, opencode et les autres harnais agissent sur ce projet par ce serveur, avec les outils des agents. Sans mot de passe : tout programme de cet ordinateur peut s'en servir.",
  );
  const corps = d.querySelector(".dialogue-contenu");
  const adresse = corps.querySelector(".ya-adresse");
  expect(adresse.querySelector(".ya-adresse-libelle").textContent).toBe("Adresse");
  expect(adresse.querySelector(".ya-adresse-valeur").textContent).toBe(ADRESSE);
  const groupes = [...d.querySelectorAll("[role=group]")];
  expect(groupes.map((g) => texteDe(g.getAttribute("aria-labelledby")))).toEqual(["Commande pour Claude Code", "Configuration pour opencode"]);
  expect(groupes[0].querySelector("pre").textContent).toBe(COMMANDE);
  expect(groupes[0].querySelector(".champ-aide").textContent).toBe("À lancer dans un terminal, dans le dossier du projet.");
  expect(groupes[1].querySelector("pre").textContent).toBe(OPENCODE);
  expect(groupes[1].querySelector("pre").textContent.split("\n")).toHaveLength(11);
  expect(groupes[1].querySelector(".champ-aide").textContent).toBe("À ajouter au fichier opencode.json du projet.");
  // Ordre : aide, adresse, commande, opencode.
  expect(adresse.compareDocumentPosition(groupes[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(groupes[0].compareDocumentPosition(groupes[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Une seule action en bas.
  expect([...d.querySelectorAll(".dialogue-actions button")].map((b) => b.textContent)).toEqual(["Fermer"]);
  expect(d.textContent).not.toMatch(/Authorization|Bearer|jeton/i);
});

test("REQ189_AC12_focus_sur_copier_la_commande_et_ordre_de_tabulation", async () => {
  const m = monter(rep({ adresse: ADRESSE }));
  await m.v.ouvrir();
  expect(document.activeElement).toBe(parNom("Copier la commande pour Claude Code"));
  expect(parNom("Copier la commande pour Claude Code").textContent).toBe("Copier");
  // Ordre des arrêts de Tab dans le dialogue modal (le navigateur enferme le focus).
  const arrets = [...dlg().querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent);
  expect(arrets).toEqual(["Copier la commande pour Claude Code", "Copier la configuration pour opencode", "Fermer"]);
  expect(dlg().querySelectorAll("[tabindex]:not([tabindex='-1'])")).toHaveLength(0);
});

test("REQ189_AC13_copie_reussie_message_status_focus_et_libelle_gardes", async () => {
  const m = monter(rep({ adresse: ADRESSE }));
  await m.v.ouvrir();
  const b1 = parNom("Copier la commande pour Claude Code");
  b1.focus();
  b1.click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=status]")?.textContent).toBe("Commande pour Claude Code copiée."));
  expect(m.copies).toEqual([COMMANDE]);
  expect(document.activeElement).toBe(b1);
  expect(b1.textContent).toBe("Copier");
  const b2 = parNom("Copier la configuration pour opencode");
  b2.focus();
  b2.click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=status]")?.textContent).toBe("Configuration pour opencode copiée."));
  expect(m.copies).toEqual([COMMANDE, OPENCODE]);
  expect(document.activeElement).toBe(b2);
  expect(b2.textContent).toBe("Copier");
  // Le même message est vidé puis reposé : le nœud change.
  const avant = dlg().querySelector("[role=status]");
  b2.click();
  await new Promise((ok) => setTimeout(ok, 0));
  expect(dlg().querySelector("[role=status]")).toBeNull();
  await vi.waitFor(() => expect(dlg().querySelector("[role=status]")).not.toBe(null));
  expect(dlg().querySelector("[role=status]")).not.toBe(avant);
});

test("REQ189_AC13_presse_papiers_refuse_alerte_et_rien_de_copie", async () => {
  const m = monter(rep({ adresse: ADRESSE }), { clipboard: { writeText: async () => { throw new DOMException("refus", "NotAllowedError"); } } });
  await m.v.ouvrir();
  const b = parNom("Copier la commande pour Claude Code");
  b.click();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]")).not.toBe(null));
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Copie impossible : le navigateur a refusé l'accès au presse-papiers. Sélectionnez le texte, puis Ctrl+C.");
  expect(dlg().querySelector("[role=status]")).toBeNull();
  expect(document.activeElement).toBe(b);
  await IMAGE();
});

test("REQ189_AC14_serveur_indisponible_alerte_seule_decrit_le_dialogue_focus_sur_fermer", async () => {
  const m = monter(rep({ indisponible: { de: 9443, a: 9453 } }));
  await m.v.ouvrir();
  const d = dlg();
  const alerte = d.querySelector("[role=alert]");
  expect(alerte.textContent).toBe("Serveur MCP indisponible : les ports 9443 à 9453 sont occupés. Libérez l'un d'eux, puis relancez Yaide.");
  expect(d.getAttribute("aria-describedby")).toBe(alerte.id);
  expect(document.activeElement).toBe(parNom("Fermer"));
  expect(d.textContent).not.toContain("Adresse");
  expect([...d.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Fermer"]);
  expect(d.querySelector("pre")).toBeNull();
});

test("REQ189_AC10_lecture_impossible_et_coupure_comme_indisponible", async () => {
  const a = monter(rep({ cause: "erreur", message: "erreur 500" }, 500));
  await a.v.ouvrir();
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Impossible de lire l'adresse du serveur MCP : erreur 500. Rouvrez ce panneau pour réessayer.");
  expect(document.activeElement).toBe(parNom("Fermer"));
  parNom("Fermer").click();
  document.body.replaceChildren();
  const b = monter("coupure");
  await b.v.ouvrir();
  expect(dlg().querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(document.activeElement).toBe(parNom("Fermer"));
});

test("REQ189_AC10_chargement_focus_sur_le_dialogue_puis_sur_copier", async () => {
  let fin;
  const m = monter(() => new Promise((ok) => (fin = ok)));
  const p = m.v.ouvrir();
  expect(document.activeElement).toBe(dlg());
  expect(dlg().getAttribute("tabindex")).toBe("-1");
  expect(dlg().textContent).toContain("Chargement…");
  fin(rep({ adresse: ADRESSE }));
  await p;
  expect(document.activeElement).toBe(parNom("Copier la commande pour Claude Code"));
});
