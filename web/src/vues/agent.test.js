import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { formaterTokens, vueAgent } from "./agent.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

let vues = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const v of vues) v.detruire();
  vues = [];
  vi.useRealTimers();
  document.body.replaceChildren();
});

const SONNET = { id: "p1", nom: "sonnet", provider: "anthropic", modele: "claude", fenetre: 200000, defaut: true };
const RAPIDE = { id: "p2", nom: "rapide", provider: "openai", modele: "mini", defaut: false };

/** `lectures` : réponses successives de `lireConversation`. */
async function monter({ profils = [SONNET, RAPIDE], lectures = [], envoi = { conversation: "c1" }, ouvrirProfils = vi.fn() } = {}) {
  const api = {
    reglagesAgent: vi.fn(async () => ({ providers: [], profils })),
    envoyerMessage: vi.fn(async () => envoi),
    lireConversation: vi.fn(async () => lectures.shift() ?? { entrees: [], enCours: false, total: 0, tokens: 0 }),
    arreterConversation: vi.fn(async () => ({})),
  };
  const vue = vueAgent({ api, ouvrirProfils });
  vues.push(vue);
  document.body.append(vue.corps);
  vue.montrer(true);
  vue.focuser();
  await vi.advanceTimersByTimeAsync(0);
  return { vue, api, ouvrirProfils };
}

const champ = (vue) => vue.corps.querySelector("textarea");
const envoyer = (vue) => vue.corps.querySelector("[aria-label=Envoyer]");
const arreter = (vue) => vue.corps.querySelector("[aria-label=Arrêter]");
const compteur = (vue) => vue.corps.querySelector(".agent-compteur");
const taper = (vue, texte) => {
  champ(vue).value = texte;
  champ(vue).dispatchEvent(new Event("input", { bubbles: true }));
};
const touche = (el, key, options = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
const tick = (ms = 500) => vi.advanceTimersByTimeAsync(ms);
const fil = (vue) => vue.corps.querySelector("[role=log]");

test("REQ056_AC1_ouverture_focus_dans_le_champ", async () => {
  const { vue } = await monter();
  expect(document.activeElement).toBe(champ(vue));
  expect(champ(vue).labels[0].textContent).toBe("Message à l'agent");
  expect(champ(vue).placeholder).toBe("Message (Entrée pour envoyer)");
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Nouvelle conversation");
  expect(vue.corps.querySelector("[role=log]").textContent).toContain("Écrivez un message pour commencer.");
  expect([...vue.corps.querySelectorAll(".agent-entete button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Nouvelle conversation", "Conversations"]);
});

test("REQ056_AC2_AC10_entree_maj_entree_vide_et_boutons", async () => {
  const { vue, api } = await monter({ lectures: [{ entrees: [], enCours: true, total: 1, tokens: 0 }] });
  expect(envoyer(vue).disabled).toBe(true);
  expect(arreter(vue).closest(".bouton-enveloppe").hidden).toBe(true);
  taper(vue, "   ");
  expect(envoyer(vue).disabled).toBe(true);
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).not.toHaveBeenCalled();
  taper(vue, "bonjour");
  expect(envoyer(vue).disabled).toBe(false);
  // Maj+Entrée n'envoie pas : le navigateur ajoute la ligne.
  const maj = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
  champ(vue).dispatchEvent(maj);
  expect(maj.defaultPrevented).toBe(false);
  await tick(0);
  expect(api.envoyerMessage).not.toHaveBeenCalled();
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenCalledWith({ conversation: null, profil: "p1", texte: "bonjour" });
  // Le message entre dans le fil, le champ se vide et garde le focus.
  expect(fil(vue).textContent).toContain("bonjour");
  expect(champ(vue).value).toBe("");
  expect(document.activeElement).toBe(champ(vue));
  // Pendant le tour : « Envoyer » désactivé, « Arrêter » affiché.
  taper(vue, "suite");
  expect(envoyer(vue).disabled).toBe(true);
  expect(arreter(vue).closest(".bouton-enveloppe").hidden).toBe(false);
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenCalledTimes(1);
  arreter(vue).click();
  expect(api.arreterConversation).toHaveBeenCalledWith("c1");
});

test("REQ056_AC10_Envoyer_a_le_bouton_Envoyer_et_l_info_bulle", async () => {
  const { vue, api } = await monter({ lectures: [{ entrees: [], enCours: true, total: 1, tokens: 0 }] });
  const bulle = async (b) => {
    b.closest(".bouton-enveloppe").dispatchEvent(new MouseEvent("pointerenter"));
    await tick(500);
    return [...document.querySelectorAll("[role=tooltip]")].map((e) => e.textContent);
  };
  expect(await bulle(envoyer(vue))).toContain("Envoyer (Entrée)");
  taper(vue, "salut");
  envoyer(vue).click();
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(champ(vue));
  expect(await bulle(arreter(vue))).toContain("Arrêter");
});

test("REQ056_AC3_profil_de_la_conversation_et_defaut_pour_une_nouvelle", async () => {
  const { vue, api } = await monter({ lectures: [{ entrees: [], enCours: false, total: 1, tokens: 0 }] });
  const liste = vue.corps.querySelector("select");
  expect(liste.labels[0].textContent).toBe("Profil");
  expect([...liste.options].map((o) => o.textContent)).toEqual(["sonnet", "rapide"]);
  expect(liste.value).toBe("sonnet");
  liste.value = "rapide";
  liste.dispatchEvent(new Event("change", { bubbles: true }));
  taper(vue, "un");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage.mock.calls[0][0]).toMatchObject({ profil: "p2", conversation: null });
  await tick(500);
  taper(vue, "deux");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage.mock.calls[1][0]).toMatchObject({ profil: "p2", conversation: "c1" });
  vue.corps.querySelector("[aria-label='Nouvelle conversation']").click();
  expect(vue.corps.querySelector("select").value).toBe("sonnet");
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Nouvelle conversation");
  expect(fil(vue).textContent).toContain("Écrivez un message pour commencer.");
  expect(document.activeElement).toBe(champ(vue));
});

test("REQ056_AC4_AC13_aucun_profil_et_creer_un_profil", async () => {
  const profils = [];
  const ouvrirProfils = vi.fn();
  const { vue, api } = await monter({ profils, ouvrirProfils });
  expect(fil(vue).textContent).toContain("Aucun profil. Créez-en un avec Ctrl+P, puis > Profils de modèle.");
  const liste = vue.corps.querySelector("select");
  expect(liste.disabled).toBe(true);
  expect(liste.value).toBe("Aucun profil");
  taper(vue, "message");
  expect(envoyer(vue).disabled).toBe(true);
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).not.toHaveBeenCalled();
  const creer = [...fil(vue).querySelectorAll("button")].find((b) => b.textContent === "Créer un profil");
  creer.click();
  expect(ouvrirProfils).toHaveBeenCalledTimes(1);
  const { retour } = ouvrirProfils.mock.calls[0][0];
  // Fermé sans profil : le focus revient sur « Créer un profil ».
  retour(false);
  await tick(0);
  expect(document.activeElement.textContent).toBe("Créer un profil");
  expect(fil(vue).contains(document.activeElement)).toBe(true);
  // Fermé avec un profil : les réglages sont relus, le focus va dans le champ.
  profils.push({ ...SONNET });
  retour(true);
  await tick(0);
  expect(document.activeElement).toBe(champ(vue));
  expect(vue.corps.querySelector("select").value).toBe("sonnet");
  expect(fil(vue).textContent).toContain("Écrivez un message pour commencer.");
  expect(compteur(vue).textContent).toBe("0 / 200 k");
});

test("REQ056_AC5_etapes_relues_une_a_une_et_etat_d_un_outil_mis_a_jour", async () => {
  const outil = (etat, resultat) => ({ type: "outil", id: "o1", nom: "bash", argument: "cargo test", etat, resultat });
  const { vue, api } = await monter({
    lectures: [
      { titre: "bonjour", entrees: [{ type: "utilisateur", texte: "bonjour" }, outil("enCours")], enCours: true, total: 2, tokens: 10 },
      { titre: "bonjour", entrees: [outil("echec", "Code de sortie : 101"), { type: "agent", markdown: "Voilà." }], enCours: true, total: 3, tokens: 10 },
      { titre: "bonjour", entrees: [{ type: "agent", markdown: "Voilà." }], enCours: false, total: 3, tokens: 14000 },
    ],
  });
  taper(vue, "bonjour");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.lireConversation).not.toHaveBeenCalled();
  await tick(499);
  expect(api.lireConversation).not.toHaveBeenCalled();
  await tick(1);
  expect(api.lireConversation).toHaveBeenLastCalledWith("c1", 0);
  expect(fil(vue).querySelectorAll(".ya-step").length).toBe(1);
  expect(fil(vue).querySelector(".ya-step").getAttribute("aria-label")).toBe("bash cargo test, en cours");
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("bonjour");
  await tick(500);
  // La dernière entrée connue est relue : l'outil change d'état sans doublon.
  expect(api.lireConversation).toHaveBeenLastCalledWith("c1", 1);
  expect(fil(vue).querySelectorAll(".ya-step").length).toBe(1);
  expect(fil(vue).querySelector(".ya-step").getAttribute("aria-label")).toBe("bash cargo test, échec");
  expect(fil(vue).textContent).toContain("Voilà.");
  expect(envoyer(vue).disabled).toBe(true);
  await tick(500);
  expect(api.lireConversation).toHaveBeenLastCalledWith("c1", 2);
  expect(fil(vue).textContent.match(/Voilà\./g).length).toBe(1);
  // Fin du tour : plus de relecture, « Arrêter » disparaît, le compteur est à jour.
  expect(arreter(vue).closest(".bouton-enveloppe").hidden).toBe(true);
  expect(compteur(vue).textContent).toBe("14 k / 200 k");
  const appels = api.lireConversation.mock.calls.length;
  await tick(2000);
  expect(api.lireConversation).toHaveBeenCalledTimes(appels);
});

test("REQ055_AC8_relecture_reprend_apres_une_coupure", async () => {
  const { vue, api } = await monter({
    lectures: [
      { coupure: true },
      { cause: "erreur", message: "erreur 500" },
      { entrees: [{ type: "utilisateur", texte: "x" }, { type: "agent", markdown: "Retour." }], enCours: false, total: 2, tokens: 5 },
    ],
  });
  taper(vue, "x");
  touche(champ(vue), "Enter");
  await tick(0);
  await tick(500);
  await tick(500);
  expect(api.lireConversation).toHaveBeenCalledTimes(2);
  expect(envoyer(vue).disabled).toBe(true);
  await tick(500);
  expect(api.lireConversation).toHaveBeenCalledTimes(3);
  expect(fil(vue).textContent).toContain("Retour.");
  expect(arreter(vue).closest(".bouton-enveloppe").hidden).toBe(true);
});

test("REQ056_AC8_AC15_compteur_850_12k_1_5M_et_absent", async () => {
  expect(["0", 850, 999, 1000, 12345, 200000, 999999, 1000000, 1500000, 1990000].map((n) => formaterTokens(Number(n)))).toEqual(["0", "850", "999", "1 k", "12 k", "200 k", "999 k", "1 M", "1,5 M", "1,9 M"]);
  const petit = { ...SONNET, fenetre: 850 };
  const grand = { ...RAPIDE, fenetre: 1500000 };
  const { vue } = await monter({ profils: [petit, grand, { ...RAPIDE, id: "p3", nom: "sans", fenetre: undefined }] });
  expect(compteur(vue).textContent).toBe("0 / 850");
  expect(compteur(vue).getAttribute("aria-label")).toBe("Contexte : 0 tokens sur 850");
  const liste = vue.corps.querySelector("select");
  liste.value = "rapide";
  liste.dispatchEvent(new Event("change", { bubbles: true }));
  expect(compteur(vue).textContent).toBe("0 / 1,5 M");
  liste.value = "sans";
  liste.dispatchEvent(new Event("change", { bubbles: true }));
  expect(compteur(vue).hidden).toBe(true);
});

test("REQ056_AC10_focus_d_arreter_va_dans_le_champ_a_la_fin", async () => {
  const { vue } = await monter({ lectures: [{ entrees: [{ type: "agent", markdown: "Fini." }], enCours: false, total: 2, tokens: 1 }] });
  taper(vue, "go");
  touche(champ(vue), "Enter");
  await tick(0);
  arreter(vue).focus();
  expect(document.activeElement).toBe(arreter(vue));
  await tick(500);
  expect(document.activeElement).toBe(champ(vue));
  expect(arreter(vue).closest(".bouton-enveloppe").hidden).toBe(true);
});
