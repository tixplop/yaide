import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { messageConsulte, ouvrirSoumissionAgent, phraseSoumission } from "./soumission-agent.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute("open");
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const AGENTS = [
  { dossier: "zoe", nom: "Zoé" },
  { dossier: "relecteur", nom: "Relecteur" },
  { dossier: "testeur", nom: "testeur" },
];
const attendre = () => new Promise((r) => setTimeout(r, 0));

async function ouvrir({ agents = AGENTS, erreurs = [], surSoumettre = vi.fn(async () => ({})), chemins = ["docs/a.md"], noms = ["docs/a.md"] } = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ agents, erreurs }) })));
  const surRetour = vi.fn();
  await ouvrirSoumissionAgent({ noms, chemins, surSoumettre, surRetour });
  return { surSoumettre, surRetour };
}
const dlg = () => document.querySelector("dialog");
const select = () => dlg().querySelector("select");
const btn = (nom) => [...dlg().querySelectorAll("button")].find((b) => b.textContent === nom);

test("REQ126_AC11_phrases_et_messages", () => {
  expect(phraseSoumission(["docs/a.md"])).toBe("Soumettre docs/a.md à un agent.");
  expect(phraseSoumission(["CHANGELOG.md", "README.md"])).toBe("Soumettre CHANGELOG.md et README.md à un agent.");
  expect(phraseSoumission(["a", "b", "c", "d", "e"])).toBe("Soumettre a, b et 3 autres éléments à un agent.");
  expect(messageConsulte(["docs/a.md"])).toBe("Consulte `docs/a.md`.");
  expect(messageConsulte(["a.md", "b.md", "docs/"])).toBe("Consulte `a.md`, `b.md` et `docs/`.");
});

test("REQ126_AC1_AC11_AC13_dialogue_liste_ordre_focus_et_Entree_sans_effet", async () => {
  const { surSoumettre } = await ouvrir();
  expect(dlg().getAttribute("role") ?? "dialog").toBe("dialog");
  expect(dlg().querySelector(".dialogue-titre").textContent).toBe("Soumettre à un agent");
  expect(document.getElementById(dlg().getAttribute("aria-describedby")).textContent).toBe("Soumettre docs/a.md à un agent.");
  expect(select().labels[0].textContent).toBe("Agent");
  expect([...select().options].map((o) => o.textContent)).toEqual(["Agent (profil par défaut)", "Relecteur", "testeur", "Zoé"]);
  expect(select().value).toBe("");
  expect(document.activeElement).toBe(select());
  expect([...dlg().querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Annuler", "Soumettre"]);
  const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  select().dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(surSoumettre).not.toHaveBeenCalled();
  expect(dlg()).not.toBeNull();
});

test("REQ126_AC7_aucun_agent_ou_agent_illisible", async () => {
  await ouvrir({ agents: [] });
  expect([...select().options].map((o) => o.textContent)).toEqual(["Agent (profil par défaut)"]);
  document.body.replaceChildren();
  await ouvrir({ agents: [AGENTS[1]], erreurs: [{ dossier: "revue", message: "illisible" }] });
  expect([...select().options].map((o) => o.textContent)).toEqual(["Agent (profil par défaut)", "Relecteur"]);
});

test("REQ126_AC2_AC3_Soumettre_donne_le_message_et_l_equipe_puis_ferme_et_ouvre", async () => {
  const ouvrirOnglet = vi.fn();
  const { surSoumettre } = await ouvrir({ surSoumettre: vi.fn(async () => ({ ouvrir: ouvrirOnglet })) });
  btn("Soumettre").click();
  await attendre();
  expect(surSoumettre).toHaveBeenCalledWith({ equipe: undefined, message: "Consulte `docs/a.md`." });
  expect(dlg()).toBeNull();
  expect(ouvrirOnglet).toHaveBeenCalledTimes(1);
  await ouvrir({ surSoumettre });
  select().value = "relecteur";
  btn("Soumettre").click();
  await attendre();
  expect(surSoumettre).toHaveBeenLastCalledWith({ equipe: [AGENTS[1]], message: "Consulte `docs/a.md`." });
});

test("REQ126_AC9_Annuler_et_Echap_ferment_et_rendent_le_focus", async () => {
  const a = await ouvrir();
  btn("Annuler").click();
  expect(dlg()).toBeNull();
  expect(a.surRetour).toHaveBeenCalledTimes(1);
  const b = await ouvrir();
  dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(dlg()).toBeNull();
  expect(b.surRetour).toHaveBeenCalledTimes(1);
  expect(a.surSoumettre).not.toHaveBeenCalled();
});

test("REQ126_AC10_AC11_envoi_puis_coupure_dans_le_dialogue_puis_retour", async () => {
  let fin;
  const surSoumettre = vi.fn(() => new Promise((r) => (fin = r)));
  await ouvrir({ surSoumettre });
  select().value = "relecteur";
  btn("Soumettre").click();
  const ok = btn("Envoi…");
  expect(ok.getAttribute("aria-busy")).toBe("true");
  expect(btn("Annuler").disabled).toBe(true);
  expect(select().disabled).toBe(true);
  dlg().dispatchEvent(new Event("cancel", { cancelable: true })); // Échap pendant l'envoi : sans effet
  expect(dlg()).not.toBeNull();
  fin({ coupure: true });
  await attendre();
  const alerte = dlg().querySelector("[role=alert]");
  expect(alerte.textContent).toContain("Connexion perdue. Réessayez au retour.");
  expect(dlg().querySelector("select").compareDocumentPosition(alerte) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(alerte.compareDocumentPosition(btn("Annuler")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(btn("Soumettre").hasAttribute("aria-busy")).toBe(false);
  expect(select().value).toBe("relecteur");
  expect(select().disabled).toBe(false);
  expect(document.activeElement).toBe(btn("Soumettre"));
  surSoumettre.mockResolvedValueOnce({});
  btn("Soumettre").click();
  await attendre();
  expect(dlg()).toBeNull();
});

test("REQ126_AC9_Echap_pendant_l_envoi_n_ouvre_rien_de_plus_et_ne_ferme_pas", async () => {
  let fin;
  const ouvrirOnglet = vi.fn();
  const { surRetour } = await ouvrir({ surSoumettre: vi.fn(() => new Promise((r) => (fin = r))) });
  btn("Soumettre").click();
  dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(surRetour).not.toHaveBeenCalled();
  expect(dlg()).not.toBeNull();
  fin({ ouvrir: ouvrirOnglet });
  await attendre();
  expect(dlg()).toBeNull();
  expect(ouvrirOnglet).toHaveBeenCalledTimes(1);
});
