import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ecrire, lire } from "../stockage.js";
import { formaterTokens, vueAgent } from "./agent.js";

vi.mock("../stockage.js", () => ({ lire: vi.fn(async () => undefined), ecrire: vi.fn(async () => undefined) }));

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

let vues = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(lire).mockReset().mockResolvedValue(undefined);
  vi.mocked(ecrire).mockClear();
});
afterEach(() => {
  for (const v of vues) v.detruire();
  vues = [];
  vi.useRealTimers();
  document.body.replaceChildren();
});

const SONNET = { id: "p1", nom: "sonnet", provider: "anthropic", modele: "claude", fenetre: 200000, defaut: true };
const RAPIDE = { id: "p2", nom: "rapide", provider: "openai", modele: "mini", defaut: false };

/** `lectures` : réponses successives de `lireConversation`. */
async function monter({ profils = [SONNET, RAPIDE], lectures = [], envoi = { conversation: "c1" }, ouvrirProfils = vi.fn(), erreur = null, conversations = [] } = {}) {
  const api = {
    reglagesAgent: vi.fn(async () => ({ providers: [], profils, erreur })),
    listeConversations: vi.fn(async () => conversations),
    envoyerMessage: vi.fn(async () => envoi),
    lireConversation: vi.fn(async () => lectures.shift() ?? { entrees: [], enCours: false, total: 0, tokens: 0 }),
    arreterConversation: vi.fn(async () => ({})),
  };
  const vue = vueAgent({ api, ouvrirProfils });
  vues.push(vue);
  document.body.append(vue.corps);
  vue.deplier();
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

test("REQ056_AC5_la_reponse_de_l_agent_du_serveur_en_texte_est_rendue", async () => {
  const { vue } = await monter({ lectures: [{ entrees: [{ type: "utilisateur", texte: "go" }, { type: "agent", texte: "Réponse forte." }], enCours: false, total: 1, tokens: 1 }] });
  taper(vue, "go");
  touche(champ(vue), "Enter");
  await tick(0);
  await tick(500);
  expect(fil(vue).querySelector(".ya-chat-agent").textContent).toContain("Réponse forte.");
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

const alertes = (el) => [...el.querySelectorAll("[role=alert]")];
const refus = (vue) => alertes(vue.corps).find((a) => !fil(vue).contains(a));

test("REQ055_AC6_AC13_sans_cle_refus_au_dessus_du_champ_texte_garde", async () => {
  const { vue, api } = await monter({ envoi: { refus: "sans-cle", provider: "OpenAI" } });
  taper(vue, "Lance toute la suite de tests.");
  touche(champ(vue), "Enter");
  await tick(0);
  const a = refus(vue);
  expect(a.textContent).toContain("Aucune clé pour OpenAI. Ajoutez-la avec Ctrl+P, puis > Providers LLM.");
  expect(a.nextElementSibling).toBe(champ(vue).closest(".champ") ?? champ(vue).parentElement);
  expect(champ(vue).value).toBe("Lance toute la suite de tests.");
  expect(fil(vue).textContent).not.toContain("Lance toute");
  expect(fil(vue).textContent).toContain("Écrivez un message pour commencer.");
  expect(api.lireConversation).not.toHaveBeenCalled();
  expect(ecrire).not.toHaveBeenCalled();
  // La croix le ferme.
  a.querySelector("[aria-label=Fermer]").click();
  expect(refus(vue)).toBeUndefined();
  expect(document.activeElement).toBe(champ(vue));
  // Un refus, puis un envoi accepté : le message disparaît.
  touche(champ(vue), "Enter");
  await tick(0);
  expect(refus(vue)).toBeTruthy();
  api.envoyerMessage.mockResolvedValueOnce({ conversation: "c1" });
  touche(champ(vue), "Enter");
  await tick(0);
  expect(refus(vue)).toBeUndefined();
  expect(fil(vue).textContent).toContain("Lance toute");
});

test("REQ055_AC10_AC13_contexte_plein", async () => {
  const { vue, api } = await monter({ envoi: { refus: "contexte-plein" } });
  taper(vue, "suite");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(refus(vue).textContent).toContain("Contexte plein. Ouvrez une nouvelle conversation.");
  expect(champ(vue).value).toBe("suite");
  expect(fil(vue).textContent).not.toContain("suite");
  // Le changement de conversation le retire.
  vue.corps.querySelector("[aria-label='Nouvelle conversation']").click();
  expect(refus(vue)).toBeUndefined();
  // Coupure : texte dédié.
  api.envoyerMessage.mockResolvedValueOnce({ coupure: true });
  touche(champ(vue), "Enter");
  await tick(0);
  expect(refus(vue).textContent).toContain("Connexion perdue. Réessayez au retour.");
  expect(champ(vue).value).toBe("suite");
});

test("REQ055_AC7_AC14_arreter_puis_continuer", async () => {
  const outil = (etat) => ({ type: "outil", id: "o1", nom: "bash", argument: "sleep 60", etat, resultat: "" });
  const { vue, api } = await monter({
    lectures: [
      { entrees: [{ type: "utilisateur", texte: "go" }, outil("enCours")], enCours: true, total: 2, tokens: 0 },
      { entrees: [outil("echec"), { type: "fin", texte: "Arrêté." }], enCours: false, total: 2, tokens: 0 },
    ],
  });
  taper(vue, "go");
  touche(champ(vue), "Enter");
  await tick(0);
  await tick(501);
  expect(fil(vue).querySelector(".ya-step").getAttribute("aria-label")).toBe("bash sleep 60, en cours");
  arreter(vue).click();
  await tick(1);
  expect(api.arreterConversation).toHaveBeenCalledWith("c1");
  // La relecture suit tout de suite, sans attendre l'intervalle ; la vue n'écrit pas « Arrêté. » elle-même.
  expect(api.lireConversation).toHaveBeenCalledTimes(2);
  expect(fil(vue).querySelector(".ya-step").getAttribute("aria-label")).toBe("bash sleep 60, échec");
  expect(fil(vue).textContent).toContain("Arrêté.");
  expect(arreter(vue).closest(".bouton-enveloppe").hidden).toBe(true);
  taper(vue, "reprends");
  expect(envoyer(vue).disabled).toBe(false);
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenLastCalledWith({ conversation: "c1", profil: "p1", texte: "reprends" });
});

test("REQ055_AC5_AC12_erreur_du_provider_dans_le_fil_puis_renvoi", async () => {
  const { vue, api } = await monter({
    lectures: [
      {
        entrees: [{ type: "utilisateur", texte: "un" }, { type: "message", variante: "erreur", texte: "Anthropic a refusé la requête (429).", detail: "rate limited" }],
        enCours: false,
        total: 1,
        tokens: 0,
      },
    ],
  });
  taper(vue, "un");
  touche(champ(vue), "Enter");
  await tick(0);
  await tick(501);
  const a = alertes(fil(vue))[0];
  expect(a.textContent).toContain("Anthropic a refusé la requête (429).");
  expect(a.textContent).toContain("rate limited");
  expect(envoyer(vue).disabled).toBe(true);
  taper(vue, "deux");
  expect(envoyer(vue).disabled).toBe(false);
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenLastCalledWith({ conversation: "c1", profil: "p1", texte: "deux" });
});

test("REQ055_AC9_AC14_interrompu_affiche", async () => {
  vi.mocked(lire).mockResolvedValue({ conversation: "c7" });
  const { vue } = await monter({
    lectures: [
      {
        titre: "Mon test",
        profil: "p1",
        entrees: [
          { type: "utilisateur", texte: "go" },
          { type: "outil", id: "o1", nom: "bash", argument: "ls", etat: "echec", resultat: "" },
          { type: "message", variante: "alerte", texte: "Interrompu : Yaide a été arrêté." },
        ],
        enCours: false,
        total: 3,
        tokens: 0,
      },
    ],
  });
  expect(fil(vue).querySelectorAll(".ya-step").length).toBe(1);
  const a = alertes(fil(vue))[0];
  expect(a.textContent).toContain("Interrompu : Yaide a été arrêté.");
  expect(arreter(vue).closest(".bouton-enveloppe").hidden).toBe(true);
});

const CONVS = () => {
  const n = new Date(2026, 10, 6, 15, 0).getTime();
  return [
    { id: "a", titre: "Lance toute la suite de tests.", maj: new Date(2026, 10, 6, 14, 32).getTime() },
    { id: "b", titre: "Le test parse_args échoue. Trouve pourquoi et corr…", maj: n - 26 * 3600_000 },
    { id: "c", titre: "Explique le module de connexion.", maj: new Date(2026, 10, 4, 9, 0).getTime() },
  ];
};

test("REQ056_AC6_AC12_menu_conversations_ordre_dates_et_focus", async () => {
  vi.setSystemTime(new Date(2026, 10, 6, 15, 0));
  const vide = await monter();
  expect(vide.vue.corps.querySelector("[aria-label=Conversations]").disabled).toBe(true);
  vide.vue.detruire();
  const { vue, api } = await monter({
    conversations: CONVS(),
    lectures: [{ titre: "Le test parse_args", profil: "p2", entrees: [{ type: "utilisateur", texte: "ancien" }, { type: "agent", markdown: "Réponse." }], enCours: false, total: 2, tokens: 3000 }],
  });
  const bouton = vue.corps.querySelector("[aria-label=Conversations]");
  expect(bouton.disabled).toBe(false);
  bouton.click();
  await tick(0);
  const m = document.querySelector("[role=menu]");
  expect(m.getAttribute("aria-label")).toBe("Conversations");
  const lignes = [...m.querySelectorAll("[role=menuitem]")];
  expect(lignes.map((l) => l.querySelector(".menu-libelle").textContent)).toEqual(CONVS().map((c) => c.titre));
  expect(lignes.map((l) => l.querySelector(".menu-touche").textContent)).toEqual(["14:32", "hier", "4 nov."]);
  expect(document.activeElement).toBe(lignes[0]);
  touche(lignes[0], "ArrowDown");
  expect(document.activeElement).toBe(lignes[1]);
  touche(lignes[1], "Enter");
  await tick(0);
  expect(document.querySelector("[role=menu]")).toBeNull();
  expect(api.lireConversation).toHaveBeenCalledWith("b", 0);
  expect(fil(vue).textContent).toContain("ancien");
  expect(fil(vue).textContent).toContain("Réponse.");
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Le test parse_args");
  expect(vue.corps.querySelector("select").value).toBe("rapide");
  expect(document.activeElement).toBe(champ(vue));
  expect(ecrire).toHaveBeenCalledWith("agent", { conversation: "b" });
  // La suite du fil continue cette conversation.
  taper(vue, "suite");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenLastCalledWith({ conversation: "b", profil: "p2", texte: "suite" });
});

test("REQ056_AC12_titre_coupe_et_nouvelle_conversation", async () => {
  const long = `${"a".repeat(50)}…`;
  const { vue, api } = await monter({
    lectures: [{ titre: long, entrees: [{ type: "utilisateur", texte: "premier" }], enCours: true, total: 1, tokens: 0 }],
  });
  taper(vue, "premier");
  touche(champ(vue), "Enter");
  await tick(500);
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe(long);
  expect(fil(vue).textContent).toContain("premier");
  // Le tour continue sur le serveur : la vue ne le relit plus et repart d'un fil vide.
  vue.corps.querySelector("[aria-label='Nouvelle conversation']").click();
  const appels = api.lireConversation.mock.calls.length;
  await tick(2000);
  expect(api.lireConversation).toHaveBeenCalledTimes(appels);
  expect(fil(vue).textContent).not.toContain("premier");
  expect(fil(vue).textContent).toContain("Écrivez un message pour commencer.");
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Nouvelle conversation");
  expect(envoyer(vue).disabled).toBe(true);
  expect(ecrire).toHaveBeenLastCalledWith("agent", { conversation: null });
  taper(vue, "autre");
  expect(envoyer(vue).disabled).toBe(false);
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenLastCalledWith({ conversation: null, profil: "p1", texte: "autre" });
});

test("REQ056_AC7_rechargement_rouvre_la_derniere", async () => {
  vi.mocked(lire).mockResolvedValue({ conversation: "c9" });
  const { vue, api } = await monter({
    lectures: [
      { titre: "Reprise", profil: "p1", entrees: [{ type: "utilisateur", texte: "avant" }, { type: "agent", markdown: "En route." }], enCours: true, total: 2, tokens: 5 },
      { entrees: [{ type: "agent", markdown: "En route." }, { type: "agent", markdown: "Fini." }], enCours: false, total: 3, tokens: 9 },
    ],
  });
  expect(lire).toHaveBeenCalledWith("agent");
  expect(api.lireConversation).toHaveBeenCalledWith("c9", 0);
  expect(fil(vue).textContent).toContain("avant");
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Reprise");
  // Le tour continue : la relecture reprend, depuis la dernière entrée.
  expect(arreter(vue).closest(".bouton-enveloppe").hidden).toBe(false);
  await tick(500);
  expect(api.lireConversation).toHaveBeenLastCalledWith("c9", 1);
  expect(fil(vue).textContent).toContain("Fini.");
  expect(arreter(vue).closest(".bouton-enveloppe").hidden).toBe(true);
  // Un envoi mémorise la conversation.
  const autre = await monter();
  taper(autre.vue, "x");
  touche(champ(autre.vue), "Enter");
  await tick(0);
  expect(ecrire).toHaveBeenCalledWith("agent", { conversation: "c1" });
});

test("REQ056_AC7_conversation_disparue_oubliee", async () => {
  vi.mocked(lire).mockResolvedValue({ conversation: "perdue" });
  const { vue } = await monter({ lectures: [{ introuvable: true }] });
  expect(ecrire).toHaveBeenCalledWith("agent", { conversation: null });
  expect(fil(vue).textContent).toContain("Écrivez un message pour commencer.");
});

test("REQ051_AC4_reglages_illisibles_nomment_le_fichier", async () => {
  const { vue } = await monter({ profils: [], erreur: "/home/x/projet/.yaide/config.json est illisible : expected value at line 1" });
  const a = refus(vue);
  expect(a.textContent).toContain(".yaide/config.json est illisible. Corrigez-le ou enregistrez de nouveaux réglages.");
  expect(a.textContent).not.toContain("/home/x");
  expect(a.compareDocumentPosition(champ(vue)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("REQ056_AC14_ordre_de_tab", async () => {
  const nom = (e) => e.getAttribute("aria-label") ?? e.labels?.[0]?.textContent ?? e.textContent;
  const tabulables = (vue) => [...vue.corps.querySelectorAll("button, textarea, select, a[href], [tabindex='0']")].map(nom);
  // Avec une conversation : ses appels d'outils et ses liens suivent le fil.
  const a = await monter({
    conversations: CONVS(),
    lectures: [{ entrees: [{ type: "utilisateur", texte: "x" }, { type: "outil", id: "o", nom: "bash", argument: "ls", etat: "reussi", resultat: "" }, { type: "agent", markdown: "[lien](https://exemple.fr)" }], enCours: true, total: 2, tokens: 0 }],
  });
  taper(a.vue, "x");
  touche(champ(a.vue), "Enter");
  await tick(0);
  await tick(501);
  expect(tabulables(a.vue)).toEqual(["Nouvelle conversation", "Conversations", "Conversation", "bash ls, réussi", "lien", "Message à l'agent", "Profil", "Arrêter", "Envoyer"]);
  a.vue.detruire();
  // Avec un refus : la croix précède le champ.
  const b = await monter({ envoi: { refus: "contexte-plein" } });
  taper(b.vue, "x");
  touche(champ(b.vue), "Enter");
  await tick(0);
  expect(tabulables(b.vue)).toEqual(["Nouvelle conversation", "Conversations", "Conversation", "Fermer", "Message à l'agent", "Profil", "Arrêter", "Envoyer"]);
});

test("profil_supprime_prend_le_defaut", async () => {
  vi.mocked(lire).mockResolvedValue({ conversation: "c3" });
  const { vue } = await monter({
    lectures: [{ titre: "T", profil: "supprime", entrees: [{ type: "agent", markdown: "Bonjour." }], enCours: false, total: 1, tokens: 0 }],
  });
  expect(vue.corps.querySelector("select").value).toBe("sonnet");
  taper(vue, "suite");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(vue.corps.querySelector("select").value).toBe("sonnet");
});

// --- Conversation avec des agents (REQ-067) ---
const RELECTEUR = { dossier: "relecteur", nom: "Relecteur", avatar: "🦉", couleur: "vert", profil: "p1" };
const TESTEUR = { dossier: "testeur", nom: "Testeur", avatar: "", couleur: "orange", profil: "p2" };
const AGENTS = () => [RELECTEUR, TESTEUR];
const ligne = (vue) => vue.corps.querySelector("[aria-label='Agents de la conversation']");
const profilListe = (vue) => vue.corps.querySelector("select");
const FENETRE = { ...RAPIDE, fenetre: 1048576 };

test("REQ067_AC1_AC15_demarrer_ligne_des_agents_sans_profil_focus", async () => {
  const { vue } = await monter();
  expect(ligne(vue).hidden).toBe(true);
  expect(profilListe(vue)).not.toBeNull();
  vue.demarrerAvec(AGENTS());
  expect(ligne(vue).hidden).toBe(false);
  expect(ligne(vue).getAttribute("role")).toBe("list");
  expect([...ligne(vue).querySelectorAll("[role=listitem]")].map((i) => i.textContent)).toEqual(["🦉Relecteur", "TTesteur"]);
  expect(profilListe(vue)).toBeNull();
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Nouvelle conversation");
  expect(fil(vue).textContent).toContain("Écrivez un message pour commencer.");
  expect(document.activeElement).toBe(champ(vue));
  // Hors de l'en-tête : la ligne suit le titre.
  expect(vue.corps.querySelector(".agent-entete").nextElementSibling).toBe(ligne(vue));
});

test("REQ067_premier_envoi_porte_les_agents_puis_la_conversation", async () => {
  const { vue, api } = await monter({ lectures: [{ entrees: [], enCours: true, total: 1, tokens: 0 }] });
  vue.demarrerAvec(AGENTS());
  taper(vue, "Relisez");
  expect(envoyer(vue).disabled).toBe(false);
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenLastCalledWith({ agents: ["relecteur", "testeur"], texte: "Relisez" });
});

test("REQ067_second_envoi_porte_la_conversation_sans_profil", async () => {
  const { vue, api } = await monter();
  vue.demarrerAvec(AGENTS());
  taper(vue, "un");
  touche(champ(vue), "Enter");
  await tick(0);
  await tick(500);
  taper(vue, "deux");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenLastCalledWith({ conversation: "c1", texte: "deux" });
});

test("REQ067_AC6_AC17_auteurs_et_travaille_selon_actif", async () => {
  const { vue, api } = await monter({
    lectures: [
      { agents: AGENTS(), actif: "relecteur", entrees: [], enCours: true, total: 1, tokens: 0 },
      {
        agents: AGENTS(),
        actif: "testeur",
        entrees: [
          { type: "utilisateur", texte: "Relisez" },
          { type: "agent", texte: "Tout va bien.", auteur: "relecteur" },
        ],
        enCours: true,
        total: 3,
        tokens: 0,
      },
    ],
  });
  vue.demarrerAvec(AGENTS());
  taper(vue, "Relisez");
  touche(champ(vue), "Enter");
  await tick(0);
  // Avant la première lecture : le premier agent travaille, dans son groupe.
  let groupes = [...fil(vue).querySelectorAll("[role=group]")];
  expect(groupes.map((g) => g.getAttribute("aria-label"))).toEqual(["Relecteur"]);
  expect(groupes[0].querySelector("[role=status]").textContent).toBe("Relecteur travaille…");
  await tick(500);
  await tick(500);
  groupes = [...fil(vue).querySelectorAll("[role=group]")];
  expect(groupes.map((g) => g.getAttribute("aria-label"))).toEqual(["Relecteur", "Testeur"]);
  expect(groupes[0].querySelector("[role=status]")).toBeNull();
  expect(groupes[0].textContent).toContain("Relecteur : Tout va bien.");
  expect(groupes[0].querySelector(".ya-tour-corps").style.getPropertyValue("--c")).toBe("var(--agent-vert)");
  expect(groupes[1].querySelector("[role=status]").textContent).toBe("Testeur travaille…");
  expect(fil(vue).textContent).not.toContain("L'agent travaille");
  expect(api.lireConversation).toHaveBeenCalled();
});

test("REQ067_AC10_nouvelle_conversation_sans_agent_avec_profil", async () => {
  const { vue } = await monter();
  vue.demarrerAvec(AGENTS());
  expect(profilListe(vue)).toBeNull();
  vue.corps.querySelector("[aria-label='Nouvelle conversation']").click();
  expect(ligne(vue).hidden).toBe(true);
  expect(profilListe(vue)).not.toBeNull();
  expect(profilListe(vue).value).toBe("sonnet");
});

test("REQ067_AC11_AC12_reouverture_avec_la_copie_des_agents", async () => {
  vi.mocked(lire).mockResolvedValue({ conversation: "c9" });
  const copie = [{ ...RELECTEUR, couleur: "rose" }, TESTEUR];
  const { vue } = await monter({
    lectures: [
      {
        titre: "Relisez",
        agents: copie,
        actif: "testeur",
        entrees: [
          { type: "utilisateur", texte: "Relisez" },
          { type: "agent", texte: "Bien.", auteur: "relecteur" },
          { type: "outil", id: "o", nom: "bash", argument: "ls", etat: "reussi", resultat: "", auteur: "testeur" },
        ],
        enCours: true,
        total: 3,
        tokens: 0,
      },
    ],
  });
  expect(ligne(vue).hidden).toBe(false);
  expect(profilListe(vue)).toBeNull();
  expect(ligne(vue).querySelector(".ya-avatar").style.getPropertyValue("--c")).toBe("var(--agent-rose)");
  const groupes = [...fil(vue).querySelectorAll("[role=group]")];
  expect(groupes.map((g) => g.getAttribute("aria-label"))).toEqual(["Relecteur", "Testeur"]);
  expect(groupes[0].querySelector(".ya-tour-corps").style.getPropertyValue("--c")).toBe("var(--agent-rose)");
  expect(groupes[1].querySelector("[role=status]").textContent).toBe("Testeur travaille…");
  expect(groupes[1].querySelector("[aria-label='bash ls, réussi']")).not.toBeNull();
});

test("REQ067_AC18_compteur_du_dernier_agent", async () => {
  const { vue } = await monter({
    profils: [SONNET, FENETRE],
    lectures: [
      { agents: AGENTS(), actif: "testeur", entrees: [{ type: "agent", texte: "Bien.", auteur: "relecteur" }], enCours: true, total: 1, tokens: 12000 },
      { agents: AGENTS(), actif: null, entrees: [{ type: "agent", texte: "Bien.", auteur: "relecteur" }, { type: "agent", texte: "Ok.", auteur: "testeur" }], enCours: false, total: 2, tokens: 5000 },
    ],
  });
  vue.demarrerAvec(AGENTS());
  expect(compteur(vue).textContent).toBe("0 / 200 k");
  taper(vue, "x");
  touche(champ(vue), "Enter");
  await tick(0);
  await tick(500);
  expect(compteur(vue).textContent).toBe("12 k / 200 k");
  await tick(500);
  expect(compteur(vue).textContent).toBe("5 k / 1 M");
});

test("REQ067_AC18_pas_de_compteur_sans_fenetre", async () => {
  const { vue } = await monter({ profils: [{ ...SONNET, fenetre: undefined }, RAPIDE] });
  vue.demarrerAvec(AGENTS());
  expect(compteur(vue).hidden).toBe(true);
  // Profil supprimé : le profil par défaut.
  vue.demarrerAvec([{ ...RELECTEUR, profil: "disparu" }]);
  expect(compteur(vue).hidden).toBe(true);
});

test("REQ067_AC9_refus_sans_cle_au_nom_du_provider", async () => {
  const { vue } = await monter({ envoi: { refus: "sans-cle", provider: "Anthropic" } });
  vue.demarrerAvec(AGENTS());
  taper(vue, "x");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(vue.corps.querySelector("[role=alert]").textContent).toContain("Aucune clé pour Anthropic. Ajoutez-la avec Ctrl+P, puis > Providers LLM.");
  expect(champ(vue).value).toBe("x");
  expect(fil(vue).textContent).not.toContain("x");
});

test("REQ067_AC15_ordre_de_tab_sans_profil", async () => {
  const { vue } = await monter({ envoi: { refus: "contexte-plein" } });
  vue.demarrerAvec(AGENTS());
  const nom = (e) => e.getAttribute("aria-label") ?? e.labels?.[0]?.textContent ?? e.textContent;
  const tabulables = [...vue.corps.querySelectorAll("button, textarea, select, a[href], [tabindex='0']")].map(nom);
  expect(tabulables).toEqual(["Nouvelle conversation", "Conversations", "Conversation", "Message à l'agent", "Arrêter", "Envoyer"]);
});

// ---- Dans un onglet de l'éditeur (REQ-078) ----

/** Une vue d'onglet : réglages et liste lus à la création, rien dans le stockage. */
async function monterOnglet({ profils = [SONNET, RAPIDE], lectures = [], conversations = [], envoi = { conversation: "c1" }, ...options } = {}) {
  const api = {
    reglagesAgent: vi.fn(async () => ({ providers: [], profils, erreur: null })),
    listeConversations: vi.fn(async () => conversations),
    envoyerMessage: vi.fn(async () => envoi),
    lireConversation: vi.fn(async () => lectures.shift() ?? { entrees: [], enCours: false, total: 0, tokens: 0 }),
    arreterConversation: vi.fn(async () => ({})),
  };
  const surConversation = vi.fn();
  const vue = vueAgent({ api, ouvrirProfils: vi.fn(), surConversation, ...options });
  vues.push(vue);
  document.body.append(vue.corps);
  await vi.advanceTimersByTimeAsync(0);
  return { vue, api, surConversation };
}

test("REQ078_AC1_vue_vide_sans_conversation_chargee_ni_stockage", async () => {
  const { vue, api, surConversation } = await monterOnglet({ conversations: CONVS() });
  expect(api.lireConversation).not.toHaveBeenCalled();
  expect(vue.corps.querySelector("select").value).toBe("sonnet");
  expect(vue.corps.querySelector("[aria-label=Conversations]").disabled).toBe(false);
  expect(surConversation).not.toHaveBeenCalled();
  expect(lire).not.toHaveBeenCalled();
});

test("REQ078_AC2_premier_message_dit_la_conversation", async () => {
  const { vue, surConversation } = await monterOnglet({ lectures: [{ entrees: [], enCours: true, total: 1, tokens: 0 }] });
  taper(vue, "bonjour");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(surConversation).toHaveBeenCalledTimes(1);
  expect(surConversation).toHaveBeenCalledWith("c1");
  expect(ecrire).not.toHaveBeenCalled();
  vue.corps.querySelector("[aria-label='Nouvelle conversation']").click();
  expect(surConversation).toHaveBeenLastCalledWith(null);
  expect(ecrire).not.toHaveBeenCalled();
});

test("REQ078_AC6_conversation_chargee_a_la_creation_sans_la_redire", async () => {
  const { vue, api, surConversation } = await monterOnglet({
    conversation: "c9",
    lectures: [{ titre: "Reprise", profil: "p2", entrees: [{ type: "utilisateur", texte: "avant" }], enCours: false, total: 1, tokens: 5 }],
  });
  expect(api.lireConversation).toHaveBeenCalledWith("c9", 0);
  expect(fil(vue).textContent).toContain("avant");
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Reprise");
  expect(vue.corps.querySelector("select").value).toBe("rapide");
  expect(surConversation).not.toHaveBeenCalled();
  expect(ecrire).not.toHaveBeenCalled();
});

test("REQ078_AC6_conversation_disparue_onglet_vide", async () => {
  const { vue, surConversation } = await monterOnglet({ conversation: "perdue", lectures: [{ introuvable: true }] });
  expect(surConversation).toHaveBeenCalledWith(null);
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Nouvelle conversation");
});

test("REQ078_AC6_coupure_au_retour_reessaie", async () => {
  const { vue, api, surConversation } = await monterOnglet({ conversation: "c9", lectures: [{ coupure: true }, { titre: "Là", entrees: [], enCours: false, total: 0, tokens: 0 }] });
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Nouvelle conversation");
  await tick(1500);
  expect(api.lireConversation).toHaveBeenCalledTimes(2);
  expect(vue.corps.querySelector(".agent-titre").textContent).toBe("Là");
  expect(surConversation).not.toHaveBeenCalled();
});

test("REQ078_AC6_equipe_d_une_conversation_vide", async () => {
  const equipe = [{ dossier: "a", nom: "Alice", couleur: "violet" }];
  const { vue, api } = await monterOnglet({ equipe });
  expect(vue.corps.querySelector(".ya-agents").hidden).toBe(false);
  expect(vue.corps.querySelector(".ya-agents").textContent).toContain("Alice");
  expect(vue.corps.querySelector("select")).toBeNull();
  taper(vue, "salut");
  touche(champ(vue), "Enter");
  await tick(0);
  expect(api.envoyerMessage).toHaveBeenCalledWith({ agents: ["a"], texte: "salut" });
});

test("REQ078_AC5_menu_conversation_deja_ouverte_ne_charge_rien", async () => {
  const surDejaOuverte = vi.fn((id) => id === "a");
  const { vue, api, surConversation } = await monterOnglet({
    conversations: CONVS(),
    surDejaOuverte,
    lectures: [{ titre: "Le test parse_args", entrees: [{ type: "utilisateur", texte: "contenu de b" }], enCours: false, total: 1, tokens: 0 }],
  });
  const ouvrirMenu = async () => {
    vue.corps.querySelector("[aria-label=Conversations]").click();
    await tick(0);
    return [...document.querySelectorAll("[role=menuitem]")];
  };
  let lignes = await ouvrirMenu();
  touche(lignes[0], "Enter");
  await tick(0);
  expect(surDejaOuverte).toHaveBeenCalledWith("a");
  expect(api.lireConversation).not.toHaveBeenCalled();
  expect(fil(vue).textContent).toContain("Écrivez un message pour commencer.");
  // Une conversation dans aucun onglet s'affiche ici.
  lignes = await ouvrirMenu();
  touche(lignes[0], "ArrowDown");
  touche(lignes[1], "Enter");
  await tick(0);
  expect(api.lireConversation).toHaveBeenCalledWith("b", 0);
  expect(fil(vue).textContent).toContain("contenu de b");
  expect(surConversation).toHaveBeenCalledWith("b");
  expect(document.activeElement).toBe(champ(vue));
});

test("REQ078_AC6_coupure_puis_envoi_la_nouvelle_tentative_n_ecrase_rien", async () => {
  const { vue, api } = await monterOnglet({ conversation: "c9", lectures: [{ coupure: true }, { entrees: [], enCours: true, total: 1, tokens: 0 }] });
  expect(api.lireConversation).toHaveBeenCalledTimes(1);
  taper(vue, "salut");
  touche(champ(vue), "Enter");
  await tick(0);
  const avant = api.lireConversation.mock.calls.filter(([id]) => id === "c9").length;
  await tick(1500);
  expect(api.lireConversation.mock.calls.filter(([id]) => id === "c9")).toHaveLength(avant);
  expect(fil(vue).textContent).toContain("salut");
});

test("REQ078_AC22_choisir_la_conversation_de_l_onglet_ne_change_rien", async () => {
  const surDejaOuverte = vi.fn(() => false);
  const { vue, api, surConversation } = await monterOnglet({ conversation: "a", conversations: CONVS(), surDejaOuverte, lectures: [{ titre: "A", entrees: [], enCours: false, total: 0, tokens: 0 }] });
  champ(vue).blur();
  vue.corps.querySelector("[aria-label=Conversations]").click();
  await tick(0);
  touche(document.querySelectorAll("[role=menuitem]")[0], "Enter");
  await tick(0);
  expect(api.lireConversation).toHaveBeenCalledTimes(1);
  expect(surDejaOuverte).not.toHaveBeenCalled();
  expect(surConversation).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(champ(vue));
});
