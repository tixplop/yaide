import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as oc from "../opencode.js";
import texte from "../opencode-captures/texte.json";
import interruption from "../opencode-captures/interruption.json";
import refus from "../opencode-captures/refus.json";
import sousagent from "../opencode-captures/sousagent.json";
import { vueOpencode } from "./opencode.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

let vues = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const v of vues) v.detruire();
  vues = [];
  vi.useRealTimers();
  document.body.replaceChildren();
});

const MODELES = [
  { cle: "anthropic/s", id: "s", providerID: "anthropic", texte: "Claude Sonnet 4.5 · anthropic", variantes: ["low", "high"] },
  { cle: "openrouter/s", id: "s", providerID: "openrouter", texte: "Claude Sonnet 4.5 · openrouter", variantes: [] },
];
const CHOIX = { etat: "pret", modeles: MODELES, efforts: ["low", "high"], courant: { cle: "anthropic/s", id: "s", providerID: "anthropic", variante: null } };
const liste = (nom) => [...document.querySelectorAll("select")].find((s) => s.labels[0]?.textContent === nom);
const textes = (select) => [...select.options].map((o) => o.textContent);

/** Faux `opencode.js` : un modèle de session que les tests modifient, puis `changer()` le notifie à la vue. */
function fauxOc(depart = {}) {
  const etat = {
    modele: { id: "s1", entrees: [], enCours: false, enAttente: false, fille: false, agent: "", titre: "", disparue: false, coupure: false, ...depart.modele },
    demandes: depart.demandes ?? [],
    rappels: new Set(),
    desabonnements: 0,
    reponses: [],
    resultat: { donnees: null },
    choix: depart.choix ?? CHOIX,
    appelsChoix: [],
    resultatChoix: { donnees: null },
  };
  const oc = {
    abonner: vi.fn((id, rappel) => {
      etat.rappels.add(rappel);
      return () => {
        etat.rappels.delete(rappel);
        etat.desabonnements++;
      };
    }),
    pret: vi.fn(() => Promise.resolve()),
    modeleSession: () => etat.modele,
    attentes: () => etat.demandes,
    repondreAutorisation: vi.fn(async (sid, id, decision) => {
      etat.reponses.push({ sid, id, decision });
      return suite(etat, id);
    }),
    repondreQuestion: vi.fn(async (sid, id, reponse) => {
      etat.reponses.push({ sid, id, reponse });
      return suite(etat, id);
    }),
    choixModele: vi.fn(() => etat.choix),
    choisirModele: vi.fn(async (sid, cle, variante) => {
      etat.appelsChoix.push({ sid, cle, variante });
      return etat.resultatChoix;
    }),
    ignorerQuestion: vi.fn(async (sid, id) => {
      etat.reponses.push({ sid, id, ignore: true });
      return suite(etat, id);
    }),
  };
  etat.changer = () => [...etat.rappels].forEach((r) => r());
  return { oc, etat };
}

function suite(etat, id) {
  if ("erreur" in etat.resultat || "coupure" in etat.resultat) return etat.resultat;
  etat.demandes = etat.demandes.filter((d) => d.id !== id);
  etat.changer();
  return etat.resultat;
}

async function monter({ modele, demandes, choix, sousAgent = false, api, surOuvrir = vi.fn(), surQuestion = vi.fn() } = {}) {
  const { oc, etat } = fauxOc({ modele, demandes, choix });
  const apiFausse = api ?? { envoyer: vi.fn(async () => ({ donnees: null })), interrompre: vi.fn(async () => ({ donnees: null })) };
  const vue = vueOpencode({ sessionId: "s1", sousAgent, surOuvrir, surQuestion, oc, api: apiFausse });
  vues.push(vue);
  document.body.append(vue.corps);
  await vi.advanceTimersByTimeAsync(0);
  return { vue, oc, etat, api: apiFausse, surOuvrir, surQuestion };
}

const champ = () => document.querySelector("textarea");
const btn = (nom) => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom || b.textContent === nom);
const user = (cle, texte) => ({ cle, type: "utilisateur", texte });
const agent = (cle, markdown) => ({ cle, type: "agent", markdown });
const taper = (texte) => {
  champ().value = texte;
  champ().dispatchEvent(new Event("input", { bubbles: true }));
};
const entree = (options = {}) => champ().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options }));

describe("vue opencode", () => {
  it("REQ072_AC20_vide_texte_indicatif_maj_entree", async () => {
    const { api } = await monter();
    expect(document.body.textContent).toContain("Écrivez un message pour commencer.");
    expect(champ().getAttribute("placeholder")).toBe("Message (Entrée pour envoyer)");
    expect(document.querySelector("textarea").closest("label, .champ").textContent).toContain("Message à opencode");
    expect(btn("Profil")).toBeUndefined();
    taper("bonjour");
    const maj = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    champ().dispatchEvent(maj);
    expect(maj.defaultPrevented).toBe(false);
    expect(api.envoyer).not.toHaveBeenCalled();
    entree();
    expect(api.envoyer).toHaveBeenCalledWith("s1", "bonjour");
  });

  it("REQ072_AC4_envoi_et_reponse_au_fil", async () => {
    const { etat, api } = await monter();
    taper("Lis le README");
    btn("Envoyer").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.envoyer).toHaveBeenCalledWith("s1", "Lis le README");
    expect(champ().value).toBe("");
    // Le message et la réponse arrivent par le modèle, au fil de l'eau.
    etat.modele.entrees = [user("m1", "Lis le README"), agent("t1", "Le **début**")];
    etat.changer();
    const fil = document.querySelector("[role=log]");
    expect(fil.getAttribute("aria-label")).toBe("Conversation");
    expect(fil.textContent).toContain("Lis le README");
    expect(fil.querySelector("strong").textContent).toBe("début");
    etat.modele.entrees[1] = agent("t1", "Le **début** et la fin");
    etat.changer();
    expect(fil.textContent).toContain("et la fin");
    expect(document.body.textContent).not.toContain("Écrivez un message pour commencer.");
  });

  it("REQ072_AC6_arreter_puis_arrete_et_envoi_revient", async () => {
    const { etat, api } = await monter({ modele: { enCours: true, entrees: [user("m1", "go")] } });
    expect(btn("Arrêter").closest("[hidden]")).toBeNull();
    taper("suite");
    expect(btn("Envoyer").disabled).toBe(true);
    expect(champ().disabled).toBe(false);
    btn("Arrêter").focus();
    btn("Arrêter").click();
    expect(api.interrompre).toHaveBeenCalledWith("s1");
    etat.modele.enCours = false;
    etat.modele.entrees = [user("m1", "go"), { cle: "fin:m1", type: "fin", texte: "Arrêté." }];
    etat.changer();
    expect(document.querySelector("[role=log]").textContent).toContain("Arrêté.");
    expect(btn("Arrêter").closest("[hidden]")).not.toBeNull();
    expect(btn("Envoyer").disabled).toBe(false);
    expect(document.activeElement).toBe(champ());
  });

  it("REQ072_AC12_AC27_tour_en_echec_puis_nouveau_message", async () => {
    const { etat, api } = await monter({ modele: { enCours: true, entrees: [user("m1", "go")] } });
    etat.modele.enCours = false;
    etat.modele.entrees.push({ cle: "err:m1", type: "message", texte: "Le tour a échoué. Vous pouvez envoyer un autre message.", detail: "Model not found: x/y" });
    etat.changer();
    const alerte = document.querySelector("[role=log] [role=alert]");
    expect(alerte.textContent).toContain("Le tour a échoué. Vous pouvez envoyer un autre message.");
    expect(alerte.querySelector("pre").textContent).toBe("Model not found: x/y");
    expect(btn("Arrêter").closest("[hidden]")).not.toBeNull();
    taper("autre");
    expect(btn("Envoyer").disabled).toBe(false);
    btn("Envoyer").click();
    expect(api.envoyer).toHaveBeenCalledWith("s1", "autre");
  });

  it("REQ072_AC27_envoi_refuse_coupure_et_serveur_absent", async () => {
    const api = { envoyer: vi.fn(async () => ({ coupure: true })), interrompre: vi.fn() };
    const { etat } = await monter({ api });
    taper("garde-moi");
    btn("Envoyer").click();
    await vi.advanceTimersByTimeAsync(0);
    const alerte = () => document.querySelector(".session-bas [role=alert]");
    expect(alerte().textContent).toContain("Connexion perdue. Réessayez au retour.");
    expect(alerte().nextElementSibling.contains(champ())).toBe(true);
    expect(champ().value).toBe("garde-moi");
    expect(etat.modele.entrees).toEqual([]);
    expect(document.querySelector("[role=log]").textContent).not.toContain("garde-moi");

    api.envoyer.mockResolvedValueOnce({ erreur: "port 4096 occupé" });
    btn("Envoyer").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll(".session-bas [role=alert]")).toHaveLength(1);
    expect(alerte().textContent).toContain("opencode ne répond pas : port 4096 occupé. Réessayez.");
    expect(champ().value).toBe("garde-moi");

    // Fermable, puis disparaît à l'envoi accepté.
    btn("Fermer").click();
    expect(alerte()).toBeNull();
    btn("Envoyer").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(alerte()).not.toBeNull();
    api.envoyer.mockResolvedValueOnce({ donnees: null });
    btn("Envoyer").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(alerte()).toBeNull();
    expect(champ().value).toBe("");
  });

  it("REQ072_AC23_sous_agent_sans_champ_avec_note", async () => {
    const { oc } = await monter({ sousAgent: true, modele: { fille: true, agent: "explore", entrees: [{ ...user("m1", "Cherche les tests"), consigne: true }, agent("t1", "Trouvé") ] } });
    expect(champ()).toBeNull();
    expect(btn("Arrêter")).toBeUndefined();
    expect(btn("Envoyer")).toBeUndefined();
    expect(document.body.textContent).toContain("Ce sous-agent est conduit par l'agent qui l'a lancé.");
    expect(document.querySelector("[role=log]").textContent).toContain("explore : ");
    expect(oc.abonner).toHaveBeenCalled();
  });

  it("REQ072_AC23_ouvrir_un_sous_agent_depuis_le_fil", async () => {
    const ligne = { cle: "o1", type: "sousAgent", id: "s2", agent: "explore", titre: "Cherche", etat: "enCours" };
    const { surOuvrir } = await monter({ modele: { entrees: [user("m1", "x"), ligne] } });
    btn("Ouvrir explore").click();
    expect(surOuvrir).toHaveBeenCalledWith({ id: "s2", agent: "explore", titre: "Cherche" });
  });

  describe("demandes", () => {
    const autorisation = { type: "autorisation", id: "p1", sessionId: "s1", action: "bash", ressources: ["cargo test parse_args"] };

    it("REQ072_AC25_reponse_retire_la_demande_et_rend_le_focus", async () => {
      const { etat, surQuestion, oc } = await monter({ demandes: [autorisation] });
      expect(surQuestion).toHaveBeenLastCalledWith(true);
      const alerte = document.querySelector(".ya-attentes [role=alert]");
      expect(alerte.textContent).toContain("opencode demande une autorisation : bash.");
      expect(document.activeElement).not.toBe(btn("Autoriser une fois"));
      btn("Autoriser une fois").focus();
      btn("Autoriser une fois").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(oc.repondreAutorisation).toHaveBeenCalledWith("s1", "p1", "once");
      expect(etat.demandes).toEqual([]);
      expect(document.querySelector(".ya-attentes")).toBeNull();
      expect(surQuestion).toHaveBeenLastCalledWith(false);
      expect(document.activeElement).toBe(champ());
    });

    it("REQ072_AC25_reponse_dans_un_sous_agent_focus_sur_la_conversation", async () => {
      const dem = { ...autorisation, sousAgent: "explore" };
      await monter({ sousAgent: true, modele: { fille: true, agent: "explore" }, demandes: [dem] });
      expect(document.querySelector(".ya-attentes").textContent).toContain("Le sous-agent explore demande une autorisation : bash.");
      btn("Refuser").focus();
      btn("Refuser").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(document.activeElement).toBe(document.querySelector("[role=log]"));
    });

    it("REQ072_AC25_reponse_impossible_garde_la_demande_et_le_focus_ailleurs", async () => {
      const { etat } = await monter({ demandes: [autorisation] });
      etat.resultat = { erreur: "expirée" };
      btn("Refuser").focus();
      btn("Refuser").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(document.querySelector(".ya-attentes").textContent).toContain("Réponse impossible : expirée.");
      expect(document.activeElement).not.toBe(champ());
    });

    it("REQ072_AC25_question_ignorer_utilise_la_session_de_la_demande", async () => {
      const q = { type: "question", id: "f1", sessionId: "s2", titre: "Préparer la release", champs: [{ key: "version", title: "Version", type: "string", required: true }] };
      const { oc } = await monter({ demandes: [q] });
      expect(document.body.textContent).toContain("opencode pose une question : Préparer la release.");
      btn("Répondre").click();
      expect(document.body.textContent).toContain("Ce champ est obligatoire.");
      expect(oc.repondreQuestion).not.toHaveBeenCalled();
      btn("Ignorer").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(oc.ignorerQuestion).toHaveBeenCalledWith("s2", "f1");
    });
  });

  it("REQ072_AC29_ordre_de_tab", async () => {
    const entrees = [
      user("m1", "go"),
      { cle: "o1", type: "outil", id: "o1", nom: "read", argument: "a.rs", etat: "reussi", resultat: "x" },
      { cle: "o2", type: "sousAgent", id: "s2", agent: "explore", titre: "T", etat: "enCours" },
    ];
    await monter({ modele: { enCours: true, entrees }, demandes: [{ type: "autorisation", id: "p1", sessionId: "s1", action: "bash", ressources: [] }] });
    const ordre = [...document.querySelectorAll("button, textarea, select, [tabindex='0']")].filter((e) => !e.disabled && !e.hidden && !e.closest("[hidden]")).map((e) => e.getAttribute("role") === "log" ? "journal" : e.tagName === "SELECT" ? "select" : e.getAttribute("aria-label") || e.textContent.trim() || e.tagName.toLowerCase());
    const attendu = ["journal", "Autoriser une fois", "Toujours autoriser", "Refuser", "textarea", "select", "select", "Arrêter"];
    const sansFil = ordre.filter((x) => attendu.includes(x));
    expect(sansFil).toEqual(attendu);
    // Les outils et « Ouvrir » sont dans la conversation, avant les demandes ; « Envoyer » désactivé n'est pas un arrêt.
    const log = document.querySelector("[role=log]");
    expect(log.querySelector("button[aria-label='Ouvrir explore']")).not.toBeNull();
    expect(btn("Envoyer").disabled).toBe(true);
    const position = (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(position(log, document.querySelector(".ya-attentes"))).toBeTruthy();
    expect(position(document.querySelector(".ya-attentes"), champ())).toBeTruthy();
    expect(position(champ(), btn("Arrêter"))).toBeTruthy();
  });

  it("REQ074_AC14_listes_sous_le_champ_et_ordre_de_tab", async () => {
    await monter({ modele: { enCours: true } });
    const m = liste("Modèle");
    const e = liste("Effort");
    expect(m.labels[0].htmlFor).toBe(m.id);
    expect(textes(m)).toEqual(["Claude Sonnet 4.5 · anthropic", "Claude Sonnet 4.5 · openrouter"]);
    expect(textes(e)).toEqual(["Par défaut", "low", "high"]);
    expect(e.value).toBe("");
    const ordre = [...document.querySelectorAll("button, textarea, select")].filter((x) => !x.disabled && !x.closest("[hidden]"));
    expect(ordre.map((x) => x.tagName === "BUTTON" ? x.getAttribute("aria-label") : x.tagName)).toEqual(["TEXTAREA", "SELECT", "SELECT", "Arrêter"]);
    const pos = (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(pos(champ(), m)).toBeTruthy();
    expect(pos(e, btn("Arrêter"))).toBeTruthy();
    expect(pos(btn("Arrêter"), btn("Envoyer"))).toBeTruthy();
  });

  it("REQ074_AC13_sous_agent_ni_listes_ni_appel", async () => {
    const { oc } = await monter({ sousAgent: true });
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(oc.choixModele).not.toHaveBeenCalled();
    expect(oc.choisirModele).not.toHaveBeenCalled();
  });

  it("REQ074_AC4_choix_modele_appelle_sans_variante", async () => {
    const { etat } = await monter();
    taper("mon texte");
    const m = liste("Modèle");
    m.focus();
    m.value = "openrouter/s";
    m.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(etat.appelsChoix).toEqual([{ sid: "s1", cle: "openrouter/s", variante: null }]);
    expect(document.activeElement).toBe(m);
    expect(champ().value).toBe("mon texte");
  });

  it("REQ074_AC6_choix_effort_appelle_avec_variante", async () => {
    const { etat } = await monter();
    const e = liste("Effort");
    e.value = "high";
    e.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    e.value = "";
    e.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(etat.appelsChoix).toEqual([
      { sid: "s1", cle: "anthropic/s", variante: "high" },
      { sid: "s1", cle: "anthropic/s", variante: null },
    ]);
  });

  it("REQ074_AC9_choix_pendant_un_tour_arreter_reste", async () => {
    const { etat, api } = await monter({ modele: { enCours: true } });
    expect(liste("Modèle").disabled).toBe(false);
    expect(liste("Effort").disabled).toBe(false);
    const m = liste("Modèle");
    m.value = "openrouter/s";
    m.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(etat.appelsChoix).toHaveLength(1);
    expect(api.interrompre).not.toHaveBeenCalled();
    expect(btn("Arrêter").closest("[hidden]")).toBeNull();
  });

  it("REQ074_AC10_AC17_refus_message_focus_et_retour_de_valeur", async () => {
    const { etat } = await monter();
    taper("mon texte");
    etat.resultatChoix = { coupure: true };
    const e = liste("Effort");
    e.focus();
    e.value = "high";
    e.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    const alerte = document.querySelector(".session-bas [role=alert]");
    expect(alerte.textContent).toContain("Connexion perdue. Réessayez au retour.");
    expect(alerte.nextElementSibling.contains(champ())).toBe(true);
    expect(document.activeElement).toBe(e);
    expect(e.value).toBe("");
    expect(champ().value).toBe("mon texte");
    etat.resultatChoix = { erreur: "port occupé" };
    e.value = "low";
    e.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll(".session-bas [role=alert]")).toHaveLength(1);
    expect(document.querySelector(".session-bas [role=alert]").textContent).toContain("opencode ne répond pas : port occupé. Réessayez.");
    btn("Fermer").click();
    expect(document.querySelector(".session-bas [role=alert]")).toBeNull();
  });

  it("REQ074_AC10_choix_sur_session_disparue", async () => {
    const { etat } = await monter();
    etat.resultatChoix = { disparue: true };
    const m = liste("Modèle");
    m.value = "openrouter/s";
    m.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.body.textContent).toContain("Cette session n'existe plus dans opencode.");
    expect(champ()).toBeNull();
  });

  it("REQ074_AC17_message_disparait_au_choix_accepte", async () => {
    const { etat } = await monter();
    etat.resultatChoix = { coupure: true };
    const m = liste("Modèle");
    m.value = "openrouter/s";
    m.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector(".session-bas [role=alert]")).not.toBeNull();
    etat.resultatChoix = { donnees: null };
    m.value = "anthropic/s";
    m.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector(".session-bas [role=alert]")).toBeNull();
  });

  it("REQ074_AC16_chargement_illisible_sans_variante_titres", async () => {
    const { etat } = await monter({ choix: { etat: "chargement", modeles: [], efforts: [], courant: null } });
    expect(textes(liste("Modèle"))).toEqual(["Chargement…"]);
    expect(liste("Modèle").disabled && liste("Effort").disabled).toBe(true);
    etat.choix = { etat: "illisible", modeles: [], efforts: [], courant: null };
    etat.changer();
    expect(textes(liste("Modèle"))).toEqual(["Indisponible"]);
    expect(liste("Modèle").title).toBe("Liste indisponible pour l'instant.");
    expect(liste("Effort").title).toBe("Liste indisponible pour l'instant.");
    etat.choix = { etat: "illisible", modeles: MODELES, efforts: ["low", "high"], courant: { ...CHOIX.courant, variante: "high" } };
    etat.changer();
    expect(liste("Modèle").value).toBe("anthropic/s");
    expect(liste("Effort").value).toBe("high");
    expect(liste("Effort").disabled).toBe(true);
    etat.choix = { ...CHOIX, modeles: MODELES, efforts: [], courant: { ...MODELES[1], variante: null } };
    etat.changer();
    expect(liste("Effort").disabled).toBe(true);
    expect(liste("Effort").title).toBe("Ce modèle n'a pas d'effort à choisir.");
    expect(liste("Modèle").title).toBe("Claude Sonnet 4.5 · openrouter");
    etat.choix = CHOIX;
    etat.changer();
    expect(liste("Modèle").title).toBe("Claude Sonnet 4.5 · anthropic");
    expect(liste("Effort").disabled).toBe(false);
    expect(liste("Effort").title).toBe("Par défaut");
    etat.choix = { ...CHOIX, courant: { ...CHOIX.courant, variante: "high" } };
    etat.changer();
    expect(liste("Effort").title).toBe("high");
  });

  it("REQ074_AC17_message_reste_pendant_l_attente_puis_part_a_l_acceptation", async () => {
    const { etat, oc } = await monter();
    etat.resultatChoix = { coupure: true };
    const m = liste("Modèle");
    m.value = "openrouter/s";
    m.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    let fin;
    oc.choisirModele.mockImplementationOnce(() => new Promise((r) => (fin = r)));
    m.value = "anthropic/s";
    m.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector(".session-bas [role=alert]")).not.toBeNull();
    fin({ donnees: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector(".session-bas [role=alert]")).toBeNull();
  });

  it("REQ074_AC11_aucun_modele_envoi_possible", async () => {
    const { api } = await monter({ choix: { etat: "aucun", modeles: [], efforts: [], courant: null } });
    expect(textes(liste("Modèle"))).toEqual(["Aucun modèle"]);
    expect(textes(liste("Effort"))).toEqual(["Par défaut"]);
    expect(liste("Modèle").disabled && liste("Effort").disabled).toBe(true);
    taper("bonjour");
    btn("Envoyer").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.envoyer).toHaveBeenCalledWith("s1", "bonjour");
  });

  it("REQ074_AC7_redessin_sans_deplacer_le_focus", async () => {
    const { etat } = await monter();
    const m = liste("Modèle");
    m.focus();
    etat.choix = { ...CHOIX, courant: { ...MODELES[1], variante: null }, efforts: [] };
    etat.changer();
    expect(liste("Modèle").value).toBe("openrouter/s");
    expect(document.activeElement).toBe(m);
    expect(champ().value).toBe("");
  });

  it("REQ074_options_inchangees_liste_non_refaite", async () => {
    const { etat } = await monter();
    const avant = liste("Modèle").options[0];
    etat.changer();
    expect(liste("Modèle").options[0]).toBe(avant);
  });

  it("REQ074_effort_desactive_rend_le_focus_a_modele", async () => {
    const { etat } = await monter();
    liste("Effort").focus();
    etat.choix = { ...CHOIX, courant: { ...MODELES[1], variante: null }, efforts: [] };
    etat.changer();
    expect(liste("Effort").disabled).toBe(true);
    expect(document.activeElement).toBe(liste("Modèle"));
  });

  it("REQ072_session_disparue_message", async () => {
    const { etat } = await monter({ modele: { disparue: true } });
    expect(document.querySelector("[role=alert]").textContent).toContain("Cette session n'existe plus dans opencode. Fermez cet onglet.");
    expect(champ()).toBeNull();
    expect(btn("Envoyer")).toBeUndefined();
    expect(etat.rappels.size).toBe(1);
  });

  it("REQ072_chargement_apres_200_ms_puis_conversation", async () => {
    const { oc } = fauxOc();
    let fin;
    oc.pret = () => new Promise((r) => (fin = r));
    const vue = vueOpencode({ sessionId: "s1", oc, api: {} });
    vues.push(vue);
    document.body.append(vue.corps);
    const chargement = () => document.querySelector("[aria-busy=true]");
    expect(chargement().hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(chargement().hidden).toBe(false);
    expect(chargement().textContent).toBe("Chargement…");
    fin();
    await vi.advanceTimersByTimeAsync(0);
    expect(chargement()).toBeNull();
    expect(document.querySelector("[role=log]")).not.toBeNull();
  });

  it("REQ072_AC19_role_log_nom_et_focus_immobile", async () => {
    const { etat, vue } = await monter({ modele: { entrees: [user("m1", "go")] } });
    expect(document.querySelector("[role=log]").getAttribute("aria-label")).toBe("Conversation");
    expect(champ().closest(".champ").textContent).toContain("Message à opencode");
    // Rien ne prend le focus de soi-même.
    expect(document.activeElement).toBe(document.body);
    etat.modele.entrees.push(agent("t1", "étape"));
    etat.modele.enCours = true;
    etat.changer();
    expect(document.activeElement).toBe(document.body);
    // Défilement : le fil descend s'il était en bas, pas sinon.
    const fil = document.querySelector("[role=log]");
    Object.defineProperty(fil, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(fil, "scrollHeight", { value: 1000, configurable: true });
    fil.scrollTop = 900;
    etat.modele.entrees.push(agent("t2", "bas"));
    etat.changer();
    expect(fil.scrollTop).toBe(1000);
    fil.scrollTop = 100;
    etat.modele.entrees.push(agent("t3", "haut"));
    etat.changer();
    expect(fil.scrollTop).toBe(100);
    // focus() : le champ pour une session.
    vue.focus();
    expect(document.activeElement).toBe(champ());
  });

  it("REQ072_AC28_focus_sur_la_conversation_d_un_sous_agent", async () => {
    const { vue } = await monter({ sousAgent: true, modele: { fille: true, agent: "explore" } });
    vue.focus();
    expect(document.activeElement).toBe(document.querySelector("[role=log]"));
  });

  it("REQ072_AC27_texte_tape_pendant_l_envoi_est_garde", async () => {
    let fin;
    const api = { envoyer: vi.fn(() => new Promise((r) => (fin = r))), interrompre: vi.fn() };
    await monter({ api });
    taper("premier");
    btn("Envoyer").click();
    taper("premier et suite");
    fin({ donnees: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(champ().value).toBe("premier et suite");
  });

  it("REQ072_session_disparue_a_l_envoi_remplace_la_conversation", async () => {
    const api = { envoyer: vi.fn(async () => ({ disparue: true })), interrompre: vi.fn() };
    await monter({ api, modele: { entrees: [user("m1", "avant")] } });
    taper("salut");
    btn("Envoyer").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("[role=alert]").textContent).toContain("Cette session n'existe plus dans opencode. Fermez cet onglet.");
    expect(document.querySelector("[role=log]")).toBeNull();
    expect(champ()).toBeNull();
  });

  it("REQ072_AC21_saisie_en_colonne_boutons_a_droite", () => {
    const css = readFileSync("web/src/ui/composants.css", "utf8");
    expect(css).toMatch(/\.session-saisie \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*gap: var\(--space-2\);/);
    expect(css).toMatch(/\.session-saisie \.agent-barre \{[^}]*justify-content: flex-end;/);
  });

  it("REQ072_detruire_desabonne", async () => {
    const { vue, etat } = await monter();
    vue.detruire();
    expect(etat.desabonnements).toBe(1);
    expect(etat.rappels.size).toBe(0);
  });
});

// --- Le vrai `opencode.js` et le vrai `api.js`, nourris par les captures d'opencode 2.2.5 -----------------

class FauxEventSource {
  static instances = [];
  constructor() {
    this.readyState = 0;
    FauxEventSource.instances.push(this);
  }
  ouvrir() {
    this.readyState = 1;
    this.onopen?.();
  }
  emettre(ev) {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }
  close() {
    this.readyState = 2;
  }
}

const reponseHttp = (statut, corps) => ({ json: async () => corps, ok: statut >= 200 && statut < 300, status: statut, text: async () => (corps === undefined ? "" : JSON.stringify(corps)) });

/** Faux serveur opencode (derrière le relais de Yaide) : sert la capture, note les requêtes qui écrivent. */
function monde(capture) {
  const ecritures = [];
  const connues = [capture.session.data, ...capture.sessionsFilles];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options = {}) => {
      const u = url.replace("/api/opencode/api", "");
      if ((options.method ?? "GET") !== "GET") {
        ecritures.push({ methode: options.method, url: u, corps: options.body ? JSON.parse(options.body) : null });
        return reponseHttp(204);
      }
      let m;
      if (/^\/session\/[^/?]+\/message/.test(u)) return reponseHttp(200, { data: [], cursor: {} });
      if (/^\/session\/[^/?]+\/(permission|form)$/.test(u)) return reponseHttp(200, { data: [] });
      if ((m = /^\/session\?parentID=(.+)$/.exec(u))) return reponseHttp(200, { data: capture.sessionsFilles.filter((f) => f.parentID === decodeURIComponent(m[1])) });
      if ((m = /^\/session\/([^/?]+)$/.exec(u))) return connues.some((x) => x.id === m[1]) ? reponseHttp(200, { data: connues.find((x) => x.id === m[1]) }) : reponseHttp(404, {});
      return reponseHttp(500, "route inconnue : " + u);
    }),
  );
  return ecritures;
}

const indexDe = (capture, type) => capture.evenements.findIndex((e) => e.type === type);
const rejouer = (evenements) => evenements.forEach((e) => FauxEventSource.instances.at(-1).emettre(e));

/** Monte la vraie vue sur la capture, flux ouvert et historique relu. */
async function monterCapture(capture) {
  FauxEventSource.instances = [];
  vi.stubGlobal("EventSource", FauxEventSource);
  const ecritures = monde(capture);
  const id = capture.racine;
  const vue = vueOpencode({ sessionId: id });
  vues.push(vue);
  document.body.append(vue.corps);
  FauxEventSource.instances.at(-1).ouvrir();
  await oc.pret(id);
  await vi.advanceTimersByTimeAsync(0);
  return { id, ecritures };
}

describe("vue opencode sur les captures", () => {
  afterEach(() => {
    for (const v of vues) v.detruire();
    vues = [];
    oc.reinitialiser();
    vi.unstubAllGlobals();
  });

  it("REQ072_AC4_envoi_et_reponse_au_fil_captures", async () => {
    const { id, ecritures } = await monterCapture(texte);
    taper("Dis bonjour.");
    btn("Envoyer").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(ecritures).toEqual([{ methode: "POST", url: `/session/${id}/prompt`, corps: { text: "Dis bonjour." } }]);
    const delta = indexDe(texte, "session.text.delta");
    rejouer(texte.evenements.slice(0, delta + 1));
    const fil = document.querySelector("[role=log]");
    expect(fil.textContent).toContain("Dis bonjour.");
    expect(fil.querySelector(".ya-chat-agent").textContent).toContain("Voici une réponse en plusieurs");
    const partiel = fil.querySelector(".ya-chat-agent").textContent;
    expect(btn("Envoyer").disabled).toBe(true);
    rejouer(texte.evenements.slice(delta + 1));
    expect(fil.querySelector(".ya-chat-agent strong").textContent).toBe("réponse");
    expect(fil.querySelector(".ya-chat-agent").textContent.length).toBeGreaterThan(partiel.length);
    expect(fil.textContent).not.toContain("réfléchis");
  });

  it("REQ072_AC6_arreter_puis_arrete_captures", async () => {
    const { id, ecritures } = await monterCapture(interruption);
    const fin = indexDe(interruption, "session.execution.interrupted");
    rejouer(interruption.evenements.slice(0, fin));
    expect(btn("Arrêter").closest("[hidden]")).toBeNull();
    btn("Arrêter").focus();
    btn("Arrêter").click();
    expect(ecritures).toEqual([{ methode: "POST", url: `/session/${id}/interrupt`, corps: null }]);
    rejouer(interruption.evenements.slice(fin));
    expect(document.querySelector("[role=log]").textContent).toContain("Arrêté.");
    expect(btn("Arrêter").closest("[hidden]")).not.toBeNull();
    expect(document.activeElement).toBe(champ());
    taper("encore");
    expect(btn("Envoyer").disabled).toBe(false);
  });

  it("REQ072_AC12_tour_en_echec_puis_nouveau_message_captures", async () => {
    const { id, ecritures } = await monterCapture(refus);
    rejouer(refus.evenements);
    const alerte = document.querySelector("[role=log] [role=alert]");
    expect(alerte.textContent).toContain("Le tour a échoué. Vous pouvez envoyer un autre message.");
    expect(alerte.querySelector("pre").textContent).toBe("Clé d'API invalide (faux provider)");
    taper("autre message");
    btn("Envoyer").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(ecritures).toEqual([{ methode: "POST", url: `/session/${id}/prompt`, corps: { text: "autre message" } }]);
  });

  it("REQ072_AC25_reponse_retire_la_demande_et_rend_le_focus_captures", async () => {
    const surQuestion = vi.fn();
    FauxEventSource.instances = [];
    vi.stubGlobal("EventSource", FauxEventSource);
    const ecritures = monde(sousagent);
    const id = sousagent.racine;
    const vue = vueOpencode({ sessionId: id, surQuestion });
    vues.push(vue);
    document.body.append(vue.corps);
    FauxEventSource.instances.at(-1).ouvrir();
    await oc.pret(id);
    await vi.advanceTimersByTimeAsync(0);
    rejouer(sousagent.evenements.slice(0, indexDe(sousagent, "permission.asked") + 1));
    const demande = document.querySelector(".ya-attentes [role=alert]");
    expect(demande.textContent).toContain("Le sous-agent explore demande une autorisation : shell.");
    expect(demande.textContent).toContain("cargo test parse_args");
    expect(surQuestion).toHaveBeenLastCalledWith(true);
    btn("Toujours autoriser").focus();
    btn("Toujours autoriser").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(ecritures).toHaveLength(1);
    expect(ecritures[0].corps).toEqual({ decision: "always" });
    expect(document.querySelector(".ya-attentes")).toBeNull();
    expect(surQuestion).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(champ());
  });
});
