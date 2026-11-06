import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { ouvrirProviders } from "./providers.js";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(() => document.body.replaceChildren());

const attendre = () => new Promise((r) => setTimeout(r, 0));
const touche = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const taper = (el, texte) => {
  el.value = texte;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const DEFAUTS = [
  ["openai", "OpenAI", "https://api.openai.com/v1", true],
  ["anthropic", "Anthropic", "https://api.anthropic.com", true],
  ["google", "Google", "https://generativelanguage.googleapis.com/v1beta/openai", true],
  ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1", true],
  ["litellm", "LiteLLM", "http://localhost:4000", false],
  ["ollama", "Ollama", "http://localhost:11434/v1", false],
];

/** Fausse `api` : l'état est tenu ici, comme le ferait le serveur. */
function fausseApi({ cles = [], refus = false, coupure = false } = {}) {
  const etat = { adresses: {}, cles: new Set(cles), appels: [] };
  const vue = () => ({
    providers: DEFAUTS.map(([id, nom, adresse, cleObligatoire]) => ({ id, nom, adresse: etat.adresses[id] ?? adresse, cle: etat.cles.has(id), cleObligatoire })),
    profils: [],
  });
  return {
    etat,
    reglagesAgent: vi.fn(async () => vue()),
    enregistrerProvider: vi.fn(async (id, corps) => {
      etat.appels.push([id, corps]);
      if (coupure) return { coupure: true };
      if (refus || !/^https?:\/\//.test(corps.adresse)) return { champ: "adresse" };
      etat.adresses[id] = corps.adresse;
      if (corps.cle) etat.cles.add(id);
      return {};
    }),
    supprimerCle: vi.fn(async (id) => {
      etat.cles.delete(id);
      return {};
    }),
  };
}

async function ouvrir(options) {
  const api = fausseApi(options);
  const surFermeture = vi.fn();
  const p = ouvrirProviders({ api, surFermeture });
  await attendre();
  const dlg = document.querySelector("dialog");
  const champs = () => ({
    adresse: dlg.querySelector("input[type=text]"),
    cle: dlg.querySelector("input[type=password]"),
    supprimer: [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Supprimer la clé"),
    enregistrer: [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Enregistrer"),
    fermer: [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Fermer"),
  });
  const lignes = () => [...dlg.querySelectorAll("[role=option]")];
  return { api, p, dlg, champs, lignes, surFermeture };
}

test("REQ052_AC1_AC8_six_providers_openai_choisi_focus_liste", async () => {
  const { dlg, lignes, champs } = await ouvrir({ cles: ["anthropic"] });
  expect(dlg.getAttribute("aria-labelledby")).toBeTruthy();
  expect(dlg.querySelector("h2").textContent).toBe("Providers LLM");
  expect(lignes().map((l) => l.querySelector(".liste-libelle").textContent)).toEqual(["OpenAI", "Anthropic", "Google", "OpenRouter", "LiteLLM", "Ollama"]);
  expect(lignes()[0].textContent).toContain("https://api.openai.com/v1");
  expect(lignes()[0].textContent).toContain("Aucune clé");
  expect(lignes()[1].textContent).toContain("Clé enregistrée");
  expect(lignes()[0].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(lignes()[0]);
  expect(dlg.querySelector("h2.reglages-nom").textContent).toBe("OpenAI");
  touche(document.activeElement, "ArrowDown");
  expect(dlg.querySelector("h2.reglages-nom").textContent).toBe("Anthropic");
  expect(champs().adresse.value).toBe("https://api.anthropic.com");
  expect(document.activeElement).toBe(lignes()[1]);
  touche(document.activeElement, "Enter");
  expect(document.activeElement).toBe(champs().adresse);
});

test("REQ052_AC9_aides_obligatoire_facultative_enregistree", async () => {
  const { dlg, lignes, champs } = await ouvrir({ cles: ["google"] });
  const aide = () => dlg.querySelector(".champ-aide").textContent;
  expect(champs().cle.getAttribute("autocomplete")).toBe("off");
  expect(champs().cle.value).toBe("");
  expect(aide()).toBe("Aucune clé. Obligatoire pour OpenAI.");
  lignes()[2].click();
  expect(aide()).toBe("Clé enregistrée. Saisissez-en une autre pour la remplacer.");
  lignes()[5].click();
  expect(aide()).toBe("Aucune clé. Facultative pour Ollama.");
});

test("REQ052_AC10_enregistrer_garde_ouvert_et_dit_enregistre", async () => {
  const { api, dlg, lignes, champs, surFermeture } = await ouvrir();
  lignes()[1].click();
  taper(champs().cle, "sk-ant");
  champs().enregistrer.focus();
  champs().enregistrer.click();
  await attendre();
  expect(api.etat.appels).toEqual([["anthropic", { adresse: "https://api.anthropic.com", cle: "sk-ant" }]]);
  const m = dlg.querySelector("[role=status].message");
  expect(m.textContent).toBe("Anthropic enregistré.");
  expect(dlg.querySelector(".champ-aide").textContent).toContain("Clé enregistrée.");
  expect(lignes()[1].textContent).toContain("Clé enregistrée");
  expect(champs().cle.value).toBe("");
  expect(dlg.open).toBe(true);
  expect(surFermeture).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(champs().enregistrer);
  // Entrée dans un champ enregistre aussi, et la frappe suivante efface le message.
  taper(champs().cle, "x");
  expect(dlg.querySelector(".message")).toBeNull();
  champs().cle.focus();
  touche(champs().cle, "Enter");
  await attendre();
  expect(api.etat.appels).toHaveLength(2);
  expect(document.activeElement).toBe(champs().cle);
});

test("REQ052_AC5_AC10_adresse_refusee_aria_invalid_focus", async () => {
  const { api, dlg, champs } = await ouvrir();
  taper(champs().adresse, "localhost:11434");
  champs().enregistrer.click();
  await attendre();
  expect(champs().adresse.getAttribute("aria-invalid")).toBe("true");
  expect(dlg.querySelector(".champ-erreur").textContent).toBe("L'adresse doit commencer par http:// ou https://.");
  expect(document.activeElement).toBe(champs().adresse);
  expect(champs().adresse.value).toBe("localhost:11434");
  expect(api.etat.adresses).toEqual({});
  expect(dlg.querySelector(".message")).toBeNull();
});

test("REQ052_AC4_AC11_supprimer_la_cle_desactive_et_focus", async () => {
  const { api, dlg, lignes, champs } = await ouvrir({ cles: ["openai"] });
  expect(champs().supprimer.disabled).toBe(false);
  champs().supprimer.click();
  await attendre();
  expect(api.supprimerCle).toHaveBeenCalledWith("openai");
  expect(dlg.querySelector("[role=status].message").textContent).toBe("Clé supprimée.");
  expect(lignes()[0].textContent).toContain("Aucune clé");
  expect(champs().supprimer.disabled).toBe(true);
  expect(document.activeElement).toBe(champs().cle);
});

test("REQ052_AC12_saisie_gardee_d_un_provider_a_l_autre_et_perdue_a_la_fermeture", async () => {
  const { api, lignes, champs, surFermeture } = await ouvrir();
  taper(champs().adresse, "http://autre.test");
  taper(champs().cle, "sk-brouillon");
  lignes()[3].click();
  expect(champs().adresse.value).toBe("https://openrouter.ai/api/v1");
  lignes()[0].click();
  expect(champs().adresse.value).toBe("http://autre.test");
  expect(champs().cle.value).toBe("sk-brouillon");
  champs().fermer.click();
  expect(surFermeture).toHaveBeenCalledTimes(1);
  expect(document.querySelector("dialog")).toBeNull();
  const api2 = fausseApi();
  ouvrirProviders({ api: api2 });
  await attendre();
  expect(document.querySelector("input[type=text]").value).toBe("https://api.openai.com/v1");
  expect(document.querySelector("input[type=password]").value).toBe("");
  // Échap ferme aussi.
  document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(document.querySelector("dialog")).toBeNull();
  expect(api.enregistrerProvider).not.toHaveBeenCalled();
});

test("REQ052_coupure_dit_connexion_perdue", async () => {
  const { dlg, champs } = await ouvrir({ coupure: true });
  champs().enregistrer.click();
  await attendre();
  expect(dlg.querySelector("[role=alert].message").textContent).toBe("Connexion perdue. Réessayez au retour.");
});

test("REQ052_coupure_au_chargement_dit_connexion_perdue", async () => {
  const api = { reglagesAgent: vi.fn(async () => ({ coupure: true })) };
  ouvrirProviders({ api });
  await attendre();
  expect(document.querySelector("dialog [role=alert].message").textContent).toBe("Connexion perdue. Réessayez au retour.");
});
