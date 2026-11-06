import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { ouvrirProfils } from "./profils.js";

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
const taper = (el, texte) => {
  el.value = texte;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const choisirOption = (sel, texte) => {
  sel.value = texte;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
};

const PROVIDERS = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["google", "Google"],
  ["openrouter", "OpenRouter"],
  ["litellm", "LiteLLM"],
  ["ollama", "Ollama"],
].map(([id, nom]) => ({ id, nom, adresse: "http://x", cle: false, cleObligatoire: false }));

/** Fausse `api` : l'état est tenu ici, comme le ferait le serveur (T-066). */
function fausseApi(initiaux = [], { refus } = {}) {
  let n = 0;
  const etat = { profils: initiaux.map((p) => ({ id: `p${++n}`, defaut: false, ...p })), appels: [] };
  const vue = () => ({ providers: PROVIDERS, profils: structuredClone(etat.profils), erreur: null });
  const normaliser = (defaut) => {
    if (defaut) etat.profils.forEach((p) => (p.defaut = p.id === defaut));
    if (etat.profils.length && !etat.profils.some((p) => p.defaut)) etat.profils[0].defaut = true;
  };
  return {
    etat,
    reglagesAgent: vi.fn(async () => vue()),
    enregistrerProfil: vi.fn(async (corps) => {
      etat.appels.push(corps);
      if (refus) return { cause: "invalide", message: refus };
      const id = corps.id ?? `p${++n}`;
      const p = { ...corps, id };
      const i = etat.profils.findIndex((x) => x.id === id);
      if (i >= 0) etat.profils[i] = p;
      else etat.profils.push(p);
      normaliser(p.defaut ? id : null);
      return vue();
    }),
    supprimerProfil: vi.fn(async (id) => {
      etat.profils = etat.profils.filter((p) => p.id !== id);
      normaliser(null);
      return vue();
    }),
  };
}

async function ouvrir(initiaux, options, extra = {}) {
  const api = fausseApi(initiaux, options);
  const surFermeture = vi.fn();
  const retour = vi.fn();
  const p = ouvrirProfils({ api, surFermeture, retour, ...extra });
  await attendre();
  const dlg = document.querySelector("dialog");
  const bouton = (nom) => [...document.querySelectorAll("button")].find((b) => b.textContent === nom);
  const champ = (libelle) => {
    const l = [...dlg.querySelectorAll("label")].find((x) => x.textContent === libelle);
    return l && dlg.querySelector(`#${l.htmlFor}`);
  };
  const lignes = () => [...dlg.querySelectorAll("[role=option]")];
  const texteLigne = (i) => lignes()[i].textContent;
  return { api, p, dlg, bouton, champ, lignes, texteLigne, surFermeture, retour };
}

const SONNET = { nom: "sonnet", provider: "anthropic", modele: "claude-sonnet-4-5", fenetre: 200000, defaut: true };
const RAPIDE = { nom: "rapide", provider: "openrouter", modele: "google/gemini-2.5-flash", effort: "faible" };

test("REQ053_AC6_champs_et_ligne_par_defaut", async () => {
  const { dlg, champ, texteLigne, lignes } = await ouvrir([SONNET, RAPIDE]);
  expect(dlg.querySelector("h2").textContent).toBe("Profils de modèle");
  for (const l of ["Nom", "Provider", "Modèle", "Effort", "Température", "Sortie max. (tokens)", "Fenêtre de contexte (tokens)", "Profil par défaut"]) expect(champ(l), l).toBeTruthy();
  expect([...champ("Effort").options].map((o) => o.textContent)).toEqual(["Par défaut", "Faible", "Moyen", "Élevé"]);
  expect(dlg.querySelector("[role=listbox]").getAttribute("aria-label")).toBe("Profils");
  expect(lignes()).toHaveLength(2);
  expect(texteLigne(0)).toContain("sonnet");
  expect(texteLigne(0)).toContain("Anthropic · claude-sonnet-4-5");
  expect(texteLigne(0).endsWith("par défaut")).toBe(true);
  expect(texteLigne(1)).not.toContain("par défaut");
  expect(lignes()[0].getAttribute("aria-selected")).toBe("true");
  expect(champ("Nom").value).toBe("sonnet");
  expect(dlg.contains(document.activeElement)).toBe(true);
  expect(document.activeElement.getAttribute("role")).toBe("option");
  expect(dlg.textContent).toContain("Un champ vide n'est pas envoyé au provider.");
  expect(champ("Profil par défaut").checked).toBe(true);
  expect(champ("Profil par défaut").disabled).toBe(true);
  expect(dlg.textContent).toContain("Cochez cette case sur un autre profil pour le remplacer.");
});

test("REQ053_AC7_AC2_erreurs_par_champ_focus_au_premier_rien_envoye", async () => {
  const { api, dlg, bouton, champ } = await ouvrir([SONNET]);
  bouton("Nouveau profil").click();
  taper(champ("Nom"), "SONNET");
  taper(champ("Modèle"), "");
  taper(champ("Température"), "3");
  taper(champ("Sortie max. (tokens)"), "-4");
  taper(champ("Fenêtre de contexte (tokens)"), "1,5");
  bouton("Enregistrer").click();
  await attendre();
  const msg = (l) => dlg.querySelector(`#${champ(l).getAttribute("aria-describedby")}`)?.textContent;
  expect(msg("Nom")).toBe("Ce nom est déjà pris. Choisissez-en un autre.");
  expect(msg("Modèle")).toBe("Indiquez le modèle.");
  expect(msg("Température")).toBe("Température : un nombre de 0 à 2, ou vide.");
  expect(msg("Sortie max. (tokens)")).toBe("Sortie max. : un entier positif, ou vide.");
  expect(msg("Fenêtre de contexte (tokens)")).toBe("Fenêtre de contexte : un entier positif, ou vide.");
  for (const l of ["Nom", "Modèle", "Température", "Sortie max. (tokens)", "Fenêtre de contexte (tokens)"]) expect(champ(l).getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(champ("Nom"));
  expect(api.enregistrerProfil).not.toHaveBeenCalled();
  taper(champ("Nom"), "");
  bouton("Enregistrer").click();
  await attendre();
  expect(msg("Nom")).toBe("Donnez un nom au profil.");
  taper(champ("Nom"), "ok");
  bouton("Enregistrer").click();
  await attendre();
  expect(document.activeElement).toBe(champ("Modèle"));
  expect(api.enregistrerProfil).not.toHaveBeenCalled();
});

test("REQ053_AC8_premier_profil", async () => {
  const { dlg, lignes, champ, bouton, api } = await ouvrir([]);
  expect(lignes()).toHaveLength(1);
  expect(lignes()[0].textContent).toContain("Nouveau profil");
  expect(document.activeElement).toBe(champ("Nom"));
  expect(champ("Profil par défaut").checked).toBe(true);
  expect(champ("Profil par défaut").disabled).toBe(true);
  expect(dlg.textContent).toContain("Le premier profil est le profil par défaut.");
  taper(champ("Nom"), "sonnet");
  taper(champ("Modèle"), "m");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.appels[0].defaut).toBe(true);
  expect(dlg.textContent).toContain("Profil « sonnet » enregistré.");
  expect(lignes()).toHaveLength(1);
  expect(lignes()[0].textContent).toContain("par défaut");
});

test("REQ053_AC3_cocher_defaut_le_retire_a_l_autre", async () => {
  const { api, lignes, champ, bouton, texteLigne } = await ouvrir([SONNET, RAPIDE]);
  bouton("Nouveau profil").click();
  expect(lignes()).toHaveLength(3);
  bouton("Nouveau profil").click(); // une seule ligne non enregistrée
  expect(lignes()).toHaveLength(3);
  lignes()[1].click();
  expect(champ("Profil par défaut").disabled).toBe(false);
  expect(champ("Profil par défaut").checked).toBe(false);
  champ("Profil par défaut").click();
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.profils.map((p) => p.defaut)).toEqual([false, true]);
  expect(texteLigne(0)).not.toContain("par défaut");
  expect(texteLigne(1).endsWith("par défaut")).toBe(true);
});

test("REQ053_AC3_revenir_sur_l_ancien_defaut_le_montre_decoche", async () => {
  const { api, lignes, champ, bouton } = await ouvrir([SONNET, RAPIDE]);
  lignes()[0].click(); // brouillon de « sonnet » créé à l'affichage
  lignes()[1].click();
  champ("Profil par défaut").click();
  bouton("Enregistrer").click();
  await attendre();
  lignes()[0].click();
  expect(champ("Profil par défaut").checked).toBe(false);
  expect(champ("Profil par défaut").disabled).toBe(false);
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.appels.at(-1).defaut).toBe(false);
  expect(api.etat.profils.map((p) => p.defaut)).toEqual([false, true]);
});

test("REQ053_AC1_enregistrer_un_profil_garde_la_ligne_nouveau_profil", async () => {
  const { lignes, champ, bouton } = await ouvrir([SONNET]);
  bouton("Nouveau profil").click();
  taper(champ("Nom"), "brouillon");
  lignes()[0].click();
  taper(champ("Modèle"), "autre");
  bouton("Enregistrer").click();
  await attendre();
  expect(lignes()).toHaveLength(2);
  lignes()[1].click();
  expect(champ("Nom").value).toBe("brouillon");
});

test("REQ053_AC1_le_focus_reste_dans_le_champ_apres_entree", async () => {
  const a = await ouvrir([SONNET]);
  a.champ("Modèle").focus();
  a.champ("Modèle").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await attendre();
  expect(a.dlg.textContent).toContain("enregistré");
  expect(document.activeElement).toBe(a.champ("Modèle"));
  document.body.replaceChildren();
  const b = await ouvrir([SONNET], { refus: "x" });
  b.champ("Nom").focus();
  b.champ("Nom").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await attendre();
  expect(b.dlg.textContent).toContain("Enregistrement impossible");
  expect(document.activeElement).toBe(b.champ("Nom"));
});

test("REQ053_AC9_AC4_confirmation_puis_defaut_au_premier_restant", async () => {
  const { api, dlg, lignes, bouton, texteLigne } = await ouvrir([SONNET, RAPIDE, { nom: "autre", provider: "openai", modele: "g" }]);
  bouton("Supprimer").click();
  const conf = [...document.querySelectorAll("dialog")].at(-1);
  expect(conf).not.toBe(dlg);
  expect(conf.querySelector("h2").textContent).toBe("Supprimer le profil « sonnet » ?");
  expect(conf.textContent).toContain("Les conversations qui l'utilisent prendront le profil par défaut.");
  expect(document.activeElement.textContent).toBe("Annuler");
  conf.dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(api.supprimerProfil).not.toHaveBeenCalled();
  bouton("Supprimer").click();
  [...document.querySelectorAll("dialog")].at(-1).querySelector(".ya-btn-danger").click();
  await attendre();
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(lignes()).toHaveLength(2);
  expect(texteLigne(0).endsWith("par défaut")).toBe(true);
  expect(lignes()[0].getAttribute("aria-selected")).toBe("true");
  expect(dlg.contains(document.activeElement)).toBe(true);
  expect(document.activeElement.getAttribute("role")).toBe("option");
});

test("REQ053_AC9_ligne_non_enregistree_se_retire_sans_question", async () => {
  const { api, lignes, bouton } = await ouvrir([SONNET]);
  bouton("Nouveau profil").click();
  bouton("Supprimer").click();
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(lignes()).toHaveLength(1);
  expect(api.supprimerProfil).not.toHaveBeenCalled();
});

test("REQ053_AC10_8192_pour_anthropic_et_virgule", async () => {
  const { api, champ, bouton } = await ouvrir([RAPIDE]);
  bouton("Nouveau profil").click();
  expect(champ("Sortie max. (tokens)").placeholder).toBe("");
  expect(champ("Température").placeholder).toBe("0 à 2");
  choisirOption(champ("Provider"), "Anthropic");
  expect(champ("Sortie max. (tokens)").placeholder).toBe("8192");
  taper(champ("Nom"), "t");
  taper(champ("Modèle"), "m");
  taper(champ("Température"), "0,7");
  choisirOption(champ("Effort"), "Élevé");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.appels[0]).toMatchObject({ nom: "t", provider: "anthropic", modele: "m", temperature: 0.7, effort: "eleve" });
  expect(api.etat.appels[0]).not.toHaveProperty("sortieMax");
  taper(champ("Température"), "0.7");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.appels[1].temperature).toBe(0.7);
});

test("REQ053_AC1_creer_modifier_supprimer_par_l_api", async () => {
  const { api, dlg, champ, bouton, lignes, p } = await ouvrir([SONNET]);
  bouton("Nouveau profil").click();
  taper(champ("Nom"), "rapide");
  choisirOption(champ("Provider"), "OpenRouter");
  taper(champ("Modèle"), "g/f");
  taper(champ("Fenêtre de contexte (tokens)"), "1048576");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.appels[0]).toEqual({ nom: "rapide", provider: "openrouter", modele: "g/f", fenetre: 1048576, defaut: false });
  expect(lignes()).toHaveLength(2);
  expect(champ("Nom").value).toBe("rapide");
  taper(champ("Modèle"), "g/f2");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.appels[1]).toMatchObject({ id: "p2", modele: "g/f2" });
  expect(lignes()[1].textContent).toContain("OpenRouter · g/f2");
  bouton("Supprimer").click();
  [...document.querySelectorAll("dialog")].at(-1).querySelector(".ya-btn-danger").click();
  await attendre();
  expect(api.supprimerProfil).toHaveBeenCalledWith("p2");
  expect(lignes()).toHaveLength(1);
  p.fermer();
  expect(dlg.isConnected).toBe(false);
});

test("REQ053_AC2_400_inattendu_du_serveur", async () => {
  const b = await ouvrir([], { refus: "provider inconnu" });
  taper(b.champ("Nom"), "x");
  taper(b.champ("Modèle"), "m");
  b.bouton("Enregistrer").click();
  await attendre();
  expect(b.dlg.textContent).toContain("Enregistrement impossible : provider inconnu.");
});

test("REQ054_AC6_sans_profil_focus_dans_nom", async () => {
  const a = await ouvrir([]);
  expect(document.activeElement).toBe(a.champ("Nom"));
  a.bouton("Fermer").click();
  expect(a.retour).toHaveBeenCalledWith(false);
  expect(a.surFermeture).toHaveBeenCalledTimes(1);
  document.body.replaceChildren();
  const b = await ouvrir([SONNET]);
  b.dlg.dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(b.retour).toHaveBeenCalledWith(true);
  expect(b.surFermeture).toHaveBeenCalledTimes(1);
});
