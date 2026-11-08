import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as oc from "./opencode.js";
import * as api from "./api.js";
import texte from "./opencode-captures/texte.json";
import outils from "./opencode-captures/outils.json";
import sousagent from "./opencode-captures/sousagent.json";
import question from "./opencode-captures/question.json";
import formulaire from "./opencode-captures/formulaire.json";
import interruption from "./opencode-captures/interruption.json";
import refus from "./opencode-captures/refus.json";

// Faux EventSource : les tests lui font rejouer les événements relevés sur opencode 2.2.5.
class FauxEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.fermee = false;
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
    this.fermee = true;
    this.readyState = 2;
  }
}

const reponse = (statut, corps) => ({ json: async () => corps, ok: statut >= 200 && statut < 300, status: statut, text: async () => (corps === undefined ? "" : typeof corps === "string" ? corps : JSON.stringify(corps)) });

/** Faux serveur opencode (derrière le relais de Yaide) : sert les captures, enregistre les requêtes qui écrivent. */
function monde(capture, { historique, autorisations = {}, formulaires = {} } = {}) {
  const etat = {
    historique: historique ?? Object.fromEntries(Object.entries(capture.messages).map(([sid, m]) => [sid, m.data])),
    autorisations,
    formulaires,
    ecritures: [],
    coupure: false,
    statut: null,
  };
  const sessionsConnues = [capture.session.data, ...capture.sessionsFilles];
  const fetch = vi.fn(async (url, options = {}) => {
    if (etat.coupure) throw new TypeError("coupure");
    if (etat.statut) return reponse(etat.statut.code, etat.statut.corps);
    const methode = options.method ?? "GET";
    const u = url.replace("/api/opencode/api", "");
    if (methode !== "GET") {
      etat.ecritures.push({ methode, url: u, corps: options.body ? JSON.parse(options.body) : null });
      return reponse(204);
    }
    let m;
    if ((m = /^\/session\/([^/?]+)\/message/.exec(u))) return etat.historique[m[1]] ? reponse(200, { data: etat.historique[m[1]], cursor: {} }) : reponse(404, { _tag: "SessionNotFoundError" });
    if ((m = /^\/session\/([^/?]+)\/permission$/.exec(u))) return reponse(200, { data: etat.autorisations[m[1]] ?? [] });
    if ((m = /^\/session\/([^/?]+)\/form$/.exec(u))) return reponse(200, { data: etat.formulaires[m[1]] ?? [] });
    if ((m = /^\/session\?parentID=(.+)$/.exec(u))) return reponse(200, { data: capture.sessionsFilles.filter((f) => f.parentID === decodeURIComponent(m[1])) });
    if ((m = /^\/session\/([^/?]+)$/.exec(u))) {
      const s = sessionsConnues.find((x) => x.id === m[1]);
      return s ? reponse(200, { data: s }) : reponse(404, { _tag: "SessionNotFoundError" });
    }
    return reponse(500, "route inconnue : " + u);
  });
  vi.stubGlobal("fetch", fetch);
  return etat;
}

const source = () => FauxEventSource.instances.at(-1);

/** Ouvre la session `id` et rend son flux, une fois l'historique relu. */
async function suivre(id) {
  const rappel = vi.fn();
  const fin = oc.abonner(id, rappel);
  source().ouvrir();
  await oc.pret(id);
  return { rappel, fin, es: source() };
}

const evenementsDe = (capture, dernier) => capture.evenements.slice(0, dernier === undefined ? undefined : dernier);
const indexDe = (capture, type, filtre = () => true) => capture.evenements.findIndex((e) => e.type === type && filtre(e));
const rejouer = (es, evenements) => evenements.forEach((e) => es.emettre(e));

beforeEach(() => {
  FauxEventSource.instances = [];
  vi.stubGlobal("EventSource", FauxEventSource);
});

afterEach(() => {
  oc.reinitialiser();
  vi.unstubAllGlobals();
});

describe("modèle d'une session opencode", () => {
  it("REQ072_AC4_texte_complete_au_fil_des_deltas", async () => {
    const id = texte.racine;
    monde(texte, { historique: { [id]: [] } });
    const { es, rappel } = await suivre(id);
    const premier = indexDe(texte, "session.text.delta");
    rejouer(es, evenementsDe(texte, premier + 1));
    // Un texte partiel est visible avant la fin du tour, après le message de l'utilisateur.
    let m = oc.modeleSession(id);
    expect(m.entrees.map((e) => e.type)).toEqual(["utilisateur", "agent"]);
    expect(m.entrees[0].texte).toContain("Dis bonjour.");
    expect(m.entrees[1].markdown).toBe("Voici une **réponse** en plusieurs ");
    expect(m.enCours).toBe(true);
    expect(rappel).toHaveBeenCalled();
    // La suite complète le texte ; le raisonnement n'apparaît pas.
    rejouer(es, texte.evenements.slice(premier + 1));
    m = oc.modeleSession(id);
    const final = texte.messages[id].data.find((x) => x.type === "assistant").content.find((c) => c.type === "text").text;
    expect(m.entrees.map((e) => e.type)).toEqual(["utilisateur", "agent"]);
    expect(m.entrees[1].markdown).toBe(final);
    expect(JSON.stringify(m.entrees)).not.toContain("réfléchis");
    expect(m.enCours).toBe(false);
  });

  it("REQ072_AC4_deltas_sans_fin_s_ajoutent_sans_doublon", async () => {
    const id = texte.racine;
    monde(texte, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    const delta = (t) => ({ type: "session.text.delta", data: { sessionID: id, assistantMessageID: "msg_a", ordinal: 0, delta: t } });
    rejouer(es, [delta("Un "), delta("deux "), delta("trois")]);
    expect(oc.modeleSession(id).entrees.map((e) => e.markdown)).toEqual(["Un deux trois"]);
  });

  it("REQ072_AC5_outils_argument_principal_et_etats", async () => {
    const id = outils.racine;
    monde(outils, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    const dossier = outils.session.data.location.directory;
    const appel = indexDe(outils, "session.tool.called", (e) => e.data.id === "call_outils_3");
    rejouer(es, evenementsDe(outils, appel + 1));
    // L'appel de la commande attend l'autorisation : en cours.
    let entrees = oc.modeleSession(id).entrees;
    const lit = entrees.find((e) => e.id === "call_outils_0");
    expect(lit).toMatchObject({ type: "outil", nom: "read", argument: "LISEZMOI.md", etat: "reussi" });
    expect(lit.resultat).toContain("Un texte de capture.");
    expect(entrees.map((e) => e.argument).join("")).not.toContain(dossier);
    expect(entrees.find((e) => e.id === "call_outils_1")).toMatchObject({ nom: "read", argument: "absent.md", etat: "echec" });
    expect(entrees.find((e) => e.id === "call_outils_1").resultat).toContain("File not found");
    expect(entrees.find((e) => e.id === "call_outils_2")).toMatchObject({ nom: "write", argument: "NOTES.md", etat: "reussi" });
    expect(entrees.find((e) => e.id === "call_outils_3")).toMatchObject({ nom: "shell", argument: "echo bonjour", etat: "enCours" });
    expect(oc.modeleSession(id).enAttente).toBe(false);
    rejouer(es, outils.evenements.slice(appel + 1));
    entrees = oc.modeleSession(id).entrees;
    expect(entrees.find((e) => e.id === "call_outils_3")).toMatchObject({ etat: "reussi", resultat: expect.stringContaining("bonjour") });
    expect(entrees.at(-1)).toMatchObject({ type: "agent", markdown: "Terminé." });
    // Le texte écrit avant l'appel garde sa place.
    expect(entrees.slice(0, 3).map((e) => e.type)).toEqual(["utilisateur", "agent", "outil"]);
  });

  it("REQ072_AC5_argument_principal_selon_l_outil", async () => {
    const id = texte.racine;
    monde(texte, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    const dossier = texte.session.data.location.directory;
    const appels = [
      ["shell", { command: "ls -la" }, "ls -la"],
      ["edit", { path: `${dossier}/src/a.js` }, "src/a.js"],
      ["write", { path: `${dossier}/b.txt` }, "b.txt"],
      ["grep", { pattern: "foo" }, "foo"],
      ["glob", { pattern: "*.md" }, "*.md"],
      ["webfetch", { url: "https://example.com" }, "https://example.com"],
      ["websearch", { query: "x" }, ""],
    ];
    appels.forEach(([nom, entree], i) => {
      es.emettre({ type: "session.tool.input.started", data: { sessionID: id, assistantMessageID: "msg_x", id: `c${i}`, name: nom } });
      es.emettre({ type: "session.tool.called", data: { sessionID: id, assistantMessageID: "msg_x", id: `c${i}`, input: entree } });
    });
    expect(oc.modeleSession(id).entrees.map((e) => e.argument)).toEqual(appels.map((a) => a[2]));
  });

  it("REQ072_AC6_interruption_fin_arrete", async () => {
    const id = interruption.racine;
    monde(interruption, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    const fin = indexDe(interruption, "session.execution.interrupted");
    rejouer(es, evenementsDe(interruption, fin));
    let m = oc.modeleSession(id);
    expect(m.enCours).toBe(true);
    expect(m.entrees.at(-1).type).toBe("agent");
    rejouer(es, interruption.evenements.slice(fin));
    m = oc.modeleSession(id);
    expect(m.enCours).toBe(false);
    expect(m.entrees.at(-1)).toMatchObject({ type: "fin", texte: "Arrêté." });
    // Pas de message d'erreur pour un tour interrompu.
    expect(m.entrees.some((e) => e.type === "message")).toBe(false);
  });

  it("REQ072_AC6_interruption_relue_dans_l_historique", async () => {
    const id = interruption.racine;
    monde(interruption);
    await suivre(id);
    const m = oc.modeleSession(id);
    expect(m.enCours).toBe(false);
    expect(m.entrees.map((e) => e.type)).toEqual(["utilisateur", "agent", "fin"]);
  });

  it("REQ072_AC7_task_devient_sous_agent_mis_a_jour", async () => {
    const id = sousagent.racine;
    const enfant = sousagent.sessionsFilles[0].id;
    monde(sousagent, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    const reponduAutorisation = indexDe(sousagent, "permission.replied");
    rejouer(es, evenementsDe(sousagent, reponduAutorisation + 1));
    let sous = oc.modeleSession(id).entrees.find((e) => e.type === "sousAgent");
    expect(sous).toEqual(expect.objectContaining({ id: enfant, agent: "explore", titre: "Explorer le dépôt", etat: "enCours" }));
    expect(oc.modeleSession(id).entrees.some((e) => e.type === "outil" && e.nom === "subagent")).toBe(false);
    rejouer(es, sousagent.evenements.slice(reponduAutorisation + 1));
    sous = oc.modeleSession(id).entrees.find((e) => e.type === "sousAgent");
    expect(sous.etat).toBe("termine");
  });

  it("REQ072_AC7_etats_echec_et_interrompu_d_un_sous_agent", async () => {
    const id = sousagent.racine;
    const enfant = sousagent.sessionsFilles[0].id;
    for (const [type, attendu] of [["session.execution.interrupted", "interrompu"], ["session.execution.failed", "echec"]]) {
      monde(sousagent, { historique: { [id]: [] } });
      const { es, fin } = await suivre(id);
      const coupe = indexDe(sousagent, "permission.replied");
      rejouer(es, evenementsDe(sousagent, coupe + 1));
      es.emettre({ type, data: { sessionID: enfant, error: { type: "x", message: "m" } } });
      expect(oc.modeleSession(id).entrees.find((e) => e.type === "sousAgent").etat).toBe(attendu);
      fin();
      oc.reinitialiser();
    }
  });

  it("REQ072_AC7_conversation_du_sous_agent_avec_consigne", async () => {
    const enfant = sousagent.sessionsFilles[0].id;
    monde(sousagent);
    await suivre(enfant);
    const m = oc.modeleSession(enfant);
    expect(m.fille).toBe(true);
    expect(m.agent).toBe("explore");
    expect(m.titre).toBe("Explorer le dépôt");
    expect(m.entrees[0]).toMatchObject({ type: "utilisateur", consigne: true });
    expect(m.entrees.some((e) => e.type === "outil" && e.nom === "shell" && e.argument === "cargo test parse_args")).toBe(true);
    // Le premier message d'une session racine n'est pas une consigne.
    oc.reinitialiser();
    monde(sousagent);
    await suivre(sousagent.racine);
    expect(oc.modeleSession(sousagent.racine).entrees[0].consigne).toBe(false);
  });

  it("REQ072_AC8_autorisation_d_un_sous_agent_dans_la_racine", async () => {
    const id = sousagent.racine;
    const enfant = sousagent.sessionsFilles[0].id;
    const etat = monde(sousagent, { historique: { [id]: [] } });
    const racine = await suivre(id);
    const filleSuivie = await suivre(enfant);
    const demande = indexDe(sousagent, "permission.asked");
    rejouer(racine.es, evenementsDe(sousagent, demande + 1));
    const attendu = { type: "autorisation", sessionId: enfant, action: "shell", ressources: ["cargo test parse_args"] };
    expect(oc.attentes(id)).toEqual([expect.objectContaining({ ...attendu, sousAgent: "explore" })]);
    // Dans l'onglet du sous-agent, sa propre demande porte aussi son nom d'agent.
    expect(oc.attentes(enfant)).toEqual([expect.objectContaining({ ...attendu, sousAgent: "explore" })]);
    expect(racine.rappel).toHaveBeenCalled();
    expect(filleSuivie.rappel).toHaveBeenCalled();
    // Une réponse donnée la retire partout et l'envoie à opencode.
    const idDemande = oc.attentes(id)[0].id;
    racine.rappel.mockClear();
    const r = await oc.repondreAutorisation(enfant, idDemande, "always");
    expect(r.donnees).toBeNull();
    expect(etat.ecritures).toEqual([{ methode: "POST", url: `/session/${enfant}/permission/${idDemande}/reply`, corps: { decision: "always" } }]);
    expect(oc.attentes(id)).toEqual([]);
    expect(oc.attentes(enfant)).toEqual([]);
    expect(racine.rappel).toHaveBeenCalled();
  });

  it("REQ072_AC8_evenement_regle_retire_la_demande", async () => {
    const id = sousagent.racine;
    monde(sousagent, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    rejouer(es, evenementsDe(sousagent, indexDe(sousagent, "permission.asked") + 1));
    expect(oc.attentes(id)).toHaveLength(1);
    rejouer(es, [sousagent.evenements[indexDe(sousagent, "permission.replied")]]);
    expect(oc.attentes(id)).toEqual([]);
  });

  it("REQ072_AC8_refus_et_une_fois_envoient_la_decision", async () => {
    const id = sousagent.racine;
    const etat = monde(sousagent, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    rejouer(es, evenementsDe(sousagent, indexDe(sousagent, "permission.asked") + 1));
    const d = oc.attentes(id)[0];
    await oc.repondreAutorisation(d.sessionId, d.id, "reject");
    expect(etat.ecritures[0].corps).toEqual({ decision: "reject" });
  });

  it("REQ072_AC9_question_champs_et_reponse", async () => {
    const id = question.racine;
    const etat = monde(question, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    rejouer(es, evenementsDe(question, indexDe(question, "form.created") + 1));
    const [q] = oc.attentes(id);
    expect(q).toMatchObject({ type: "question", titre: "Questions", sessionId: id });
    expect(q.champs.map((c) => [c.key, c.type, c.title])).toEqual([["q0", "string", "Version"], ["q1", "multiselect", "Plateformes"]]);
    expect(q.champs[0].options.map((o) => o.value)).toEqual(["1.0", "2.0"]);
    await oc.repondreQuestion(id, q.id, { q0: "1.0", q1: ["linux"] });
    expect(etat.ecritures).toEqual([{ methode: "POST", url: `/session/${id}/form/${q.id}/reply`, corps: { answer: { q0: "1.0", q1: ["linux"] } } }]);
    expect(oc.attentes(id)).toEqual([]);
  });

  it("REQ072_AC9_formulaire_a_tous_les_types_de_champs_ignorer", async () => {
    const id = formulaire.racine;
    const [f1, f2] = formulaire.attentes.map((a) => a.formulaire);
    const etat = monde(formulaire, { historique: { [id]: [] }, formulaires: { [id]: [f1, f2] } });
    await suivre(id);
    const attentes = oc.attentes(id);
    expect(attentes.map((a) => a.titre)).toEqual(["Préparer la release", "Ignorée"]);
    expect(attentes[0].champs.map((c) => c.type)).toEqual(["string", "string", "integer", "number", "boolean", "multiselect", "external"]);
    expect(attentes[0].champs[0]).toMatchObject({ key: "version", required: true, placeholder: "1.2.3" });
    expect(attentes[0].champs[6].url).toBe("https://example.com/doc");
    await oc.ignorerQuestion(id, f2.id);
    expect(etat.ecritures).toEqual([{ methode: "DELETE", url: `/session/${id}/form/${f2.id}`, corps: null }]);
    expect(oc.attentes(id).map((a) => a.id)).toEqual([f1.id]);
    // L'événement qui règle la question l'ôte aussi.
    source().emettre({ type: "form.replied", data: { id: f1.id, sessionID: id, answer: {} } });
    expect(oc.attentes(id)).toEqual([]);
  });

  it("REQ072_AC9_reponse_refusee_garde_la_demande", async () => {
    const id = formulaire.racine;
    const f = formulaire.attentes[0].formulaire;
    const etat = monde(formulaire, { historique: { [id]: [] }, formulaires: { [id]: [f] } });
    await suivre(id);
    vi.stubGlobal("fetch", vi.fn(async () => reponse(400, { _tag: "FormInvalidAnswerError", message: "Champ invalide" })));
    const r = await oc.repondreQuestion(id, f.id, {});
    expect(r).toEqual({ erreur: "Champ invalide" });
    expect(oc.attentes(id)).toHaveLength(1);
    expect(etat.ecritures).toEqual([]);
  });

  it("REQ072_AC10_reconnexion_sans_doublon_ni_trou", async () => {
    const id = outils.racine;
    // Parcours sans coupure : la référence.
    monde(outils, { historique: { [id]: [] } });
    let { es } = await suivre(id);
    rejouer(es, outils.evenements);
    const reference = oc.modeleSession(id).entrees;
    oc.reinitialiser();
    FauxEventSource.instances = [];

    // Parcours coupé en plein tour : les événements du milieu sont perdus, ceux du début rejoués après la relecture.
    const etat = monde(outils, { historique: { [id]: [] } });
    ({ es } = await suivre(id));
    const coupure = indexDe(outils, "session.tool.success");
    rejouer(es, evenementsDe(outils, coupure + 1));
    const perdus = indexDe(outils, "session.tool.called", (e) => e.data.id === "call_outils_3");
    // Au retour, l'historique est plus avancé que ce que la page a reçu.
    etat.historique[id] = outils.messages[id].data.filter((m) => m.type !== "idle").slice(0, -1);
    es.ouvrir();
    // Des événements arrivent pendant la relecture, dont certains déjà dans l'historique.
    rejouer(es, outils.evenements.slice(coupure - 3, coupure + 2));
    await oc.pret(id);
    rejouer(es, outils.evenements.slice(perdus + 4));
    const apres = oc.modeleSession(id).entrees;
    const cles = apres.map((e) => e.cle);
    expect(new Set(cles).size).toBe(cles.length);
    expect(apres.map((e) => ({ ...e }))).toEqual(reference.map((e) => ({ ...e })));
    expect(es.url).toBe("/api/opencode/api/event");
    expect(FauxEventSource.instances).toHaveLength(1);
  });

  it("REQ072_AC10_texte_en_cours_relu_sans_doublon", async () => {
    const id = texte.racine;
    const etat = monde(texte, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    const deltas = texte.evenements.filter((e) => e.type === "session.text.delta");
    const debut = indexDe(texte, "session.text.delta");
    rejouer(es, evenementsDe(texte, debut + 1));
    // L'historique, relu au retour, contient déjà le premier morceau et le deuxième.
    const assistant = texte.messages[id].data.find((m) => m.type === "assistant");
    const partiel = { ...assistant, time: { created: 1 }, content: [{ type: "text", text: deltas[0].data.delta + deltas[1].data.delta }] };
    etat.historique[id] = [texte.messages[id].data[0], partiel];
    es.ouvrir();
    rejouer(es, [deltas[0], deltas[1]]); // arrivent pendant la relecture, déjà comptés dans l'historique
    await oc.pret(id);
    expect(oc.modeleSession(id).entrees.at(-1).markdown).toBe(deltas[0].data.delta + deltas[1].data.delta);
    rejouer(es, texte.evenements.slice(texte.evenements.indexOf(deltas[1]) + 1));
    expect(oc.modeleSession(id).entrees.at(-1).markdown).toBe(assistant.content.find((c) => c.type === "text").text);
  });

  it("REQ072_AC10_morceau_apres_la_relecture_qui_repete_la_fin_du_texte", async () => {
    const id = texte.racine;
    const etat = monde(texte, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    const delta = (t) => ({ type: "session.text.delta", data: { sessionID: id, assistantMessageID: "msg_a", ordinal: 0, delta: t } });
    rejouer(es, [{ type: "session.text.started", data: { sessionID: id, assistantMessageID: "msg_a", ordinal: 0 } }, delta("la "), delta("la ")]);
    etat.historique[id] = [{ id: "msg_a", type: "assistant", time: { created: 1 }, content: [{ type: "text", text: "la la " }] }];
    es.ouvrir();
    rejouer(es, [delta("la "), delta("la ")]); // déjà dans l'historique
    await oc.pret(id);
    expect(oc.modeleSession(id).entrees.at(-1).markdown).toBe("la la ");
    rejouer(es, [delta("la ")]); // nouveau, après la relecture : il s'ajoute même s'il répète la fin
    expect(oc.modeleSession(id).entrees.at(-1).markdown).toBe("la la la ");
  });

  it("REQ072_AC10_un_seul_flux_partage_par_les_onglets", async () => {
    monde(sousagent);
    const a = oc.abonner(sousagent.racine, () => {});
    const b = oc.abonner(sousagent.sessionsFilles[0].id, () => {});
    expect(FauxEventSource.instances).toHaveLength(1);
    expect(source().url).toBe("/api/opencode/api/event");
    a();
    expect(source().fermee).toBe(false);
    b();
    expect(source().fermee).toBe(true);
  });

  it("REQ072_AC10_demandes_en_attente_relues_a_la_connexion", async () => {
    const id = sousagent.racine;
    const enfant = sousagent.sessionsFilles[0].id;
    const demande = sousagent.attentes[0].autorisation;
    const etat = monde(sousagent, { autorisations: { [enfant]: [demande] } });
    await suivre(id);
    expect(oc.attentes(id)).toEqual([expect.objectContaining({ id: demande.id, sousAgent: "explore" })]);
    // Réglée pendant la coupure : elle disparaît à la reconnexion.
    etat.autorisations = {};
    source().ouvrir();
    await oc.pret(id);
    expect(oc.attentes(id)).toEqual([]);
  });

  it("REQ072_AC12_tour_en_echec_message_et_detail", async () => {
    const id = refus.racine;
    monde(refus, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    rejouer(es, refus.evenements);
    const m = oc.modeleSession(id);
    expect(m.enCours).toBe(false);
    const erreurs = m.entrees.filter((e) => e.type === "message");
    expect(erreurs).toEqual([expect.objectContaining({ texte: "Le tour a échoué. Vous pouvez envoyer un autre message.", detail: "Clé d'API invalide (faux provider)" })]);
  });

  it("REQ072_AC12_tour_en_echec_relu_dans_l_historique", async () => {
    const id = refus.racine;
    monde(refus);
    await suivre(id);
    const erreurs = oc.modeleSession(id).entrees.filter((e) => e.type === "message");
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0].detail).toBe("Clé d'API invalide (faux provider)");
  });

  it("REQ072_AC20_en_attente_du_modele", async () => {
    const id = outils.racine;
    monde(outils, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    const attendu = (m) => m.enAttente;
    rejouer(es, evenementsDe(outils, indexDe(outils, "session.execution.started") + 1));
    expect(attendu(oc.modeleSession(id))).toBe(true);
    const texteCommence = indexDe(outils, "session.text.started");
    rejouer(es, outils.evenements.slice(indexDe(outils, "session.execution.started") + 1, texteCommence + 1));
    expect(attendu(oc.modeleSession(id))).toBe(false);
    rejouer(es, outils.evenements.slice(texteCommence + 1));
    expect(attendu(oc.modeleSession(id))).toBe(false);
  });

  it("REQ072_AC4_envoi_affiche_le_message_de_l_utilisateur", async () => {
    const id = texte.racine;
    monde(texte, { historique: { [id]: [] } });
    const { es } = await suivre(id);
    rejouer(es, evenementsDe(texte, indexDe(texte, "session.inbox.enqueued") + 1));
    expect(oc.modeleSession(id).entrees).toEqual([expect.objectContaining({ type: "utilisateur", texte: expect.stringContaining("Dis bonjour."), consigne: false })]);
  });
});

describe("appels de api.js", () => {
  it("REQ072_AC3_creer_session_dans_le_projet", async () => {
    const f = vi.fn(async () => reponse(200, { data: { id: "ses_1", location: { directory: "/projet" } } }));
    vi.stubGlobal("fetch", f);
    const r = await api.creerSession("/projet");
    expect(r.donnees.data.id).toBe("ses_1");
    const [url, options] = f.mock.calls[0];
    expect(url).toBe("/api/opencode/api/session");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ location: { directory: "/projet" } });
  });

  it("REQ072_AC4_envoyer_et_interrompre_visent_la_session", async () => {
    const f = vi.fn(async () => reponse(200, { data: {} }));
    vi.stubGlobal("fetch", f);
    await api.envoyer("ses_1", "bonjour");
    await api.interrompre("ses_1");
    expect(f.mock.calls[0][0]).toBe("/api/opencode/api/session/ses_1/prompt");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ text: "bonjour" });
    expect(f.mock.calls[1][0]).toBe("/api/opencode/api/session/ses_1/interrupt");
    expect(f.mock.calls[1][1].method).toBe("POST");
  });

  it("REQ072_coupure_503_et_session_disparue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("coupure"); }));
    expect(await api.session("ses_1")).toEqual({ coupure: true });
    expect(await api.creerSession("/p")).toEqual({ coupure: true });
    vi.stubGlobal("fetch", vi.fn(async () => reponse(503, "Impossible de lancer opencode : échec\n")));
    expect(await api.session("ses_1")).toEqual({ erreur: "Impossible de lancer opencode : échec" });
    vi.stubGlobal("fetch", vi.fn(async () => reponse(404, { _tag: "SessionNotFoundError" })));
    expect(await api.messages("ses_1")).toEqual({ disparue: true });
    // La session disparue se voit aussi dans le modèle.
    vi.stubGlobal("EventSource", FauxEventSource);
    oc.abonner("ses_perdue", () => {});
    source().ouvrir();
    await oc.pret("ses_perdue");
    expect(oc.modeleSession("ses_perdue").disparue).toBe(true);
  });

  it("REQ072_coupure_au_chargement_du_modele_puis_retour", async () => {
    const id = texte.racine;
    const etat = monde(texte);
    etat.coupure = true;
    oc.abonner(id, () => {});
    source().ouvrir();
    await oc.pret(id);
    expect(oc.modeleSession(id)).toMatchObject({ coupure: true, entrees: [] });
    etat.coupure = false;
    source().ouvrir();
    await oc.pret(id);
    expect(oc.modeleSession(id).coupure).toBe(false);
    expect(oc.modeleSession(id).entrees.length).toBeGreaterThan(0);
  });

  it("REQ072_opencode_disponible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponse(200, { disponible: true })));
    expect(await api.opencodeDisponible()).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => reponse(200, { disponible: false })));
    expect(await api.opencodeDisponible()).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("x"); }));
    expect(await api.opencodeDisponible()).toBe(false);
  });

  it("REQ072_AC10_flux_ferme_par_le_serveur_relance_apres_attente", async () => {
    vi.useFakeTimers();
    try {
      monde(texte);
      oc.abonner(texte.racine, () => {});
      const premier = source();
      premier.readyState = 2;
      premier.onerror();
      expect(FauxEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(2100);
      expect(FauxEventSource.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
