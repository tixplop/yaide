import { afterEach, expect, test, vi } from "vitest";
import { vueAgents } from "./agents.js";

const prochaines = vi.hoisted(() => vi.fn(async () => ({ dates: [] })));
vi.mock("../api.js", async (orig) => ({ ...(await orig()), prochainesFoisCron: prochaines }));

afterEach(() => document.body.replaceChildren());

const attendre = () => new Promise((r) => setTimeout(r, 0));
const taper = (el, texte) => {
  el.value = texte;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const PROFILS = [
  { id: "p1", nom: "sonnet", defaut: true },
  { id: "p2", nom: "rapide", defaut: false },
];
const RELECTEUR = { dossier: "relecteur", nom: "Relecteur", avatar: "🦉", couleur: "vert", profil: "p1" };
const TESTEUR = { dossier: "testeur", nom: "Testeur", avatar: "", couleur: "orange" };

/** Fausse `api` : l'état est tenu ici, comme le ferait le serveur. */
function fausseApi(initiaux = [], { erreurs = [], profils = PROFILS } = {}) {
  const etat = { agents: structuredClone(initiaux), erreurs, profils, envoyes: [] };
  return {
    etat,
    listerAgents: vi.fn(async () => ({ agents: structuredClone(etat.agents), erreurs: etat.erreurs })),
    reglagesAgent: vi.fn(async () => ({ providers: [], profils: structuredClone(etat.profils), erreur: null })),
    enregistrerAgent: vi.fn(async (saisie) => {
      etat.envoyes.push(saisie);
      const dossier = saisie.dossier ?? saisie.nom.toLowerCase();
      const agent = { ...saisie, dossier };
      const i = etat.agents.findIndex((a) => a.dossier === dossier);
      if (i >= 0) etat.agents[i] = agent;
      else etat.agents.push(agent);
      etat.agents.sort((a, b) => a.nom.toLowerCase().localeCompare(b.nom.toLowerCase()));
      return agent;
    }),
  };
}

async function ouvrir(initiaux, options, extra = {}) {
  const api = options?.api ?? fausseApi(initiaux, options);
  const surFichier = vi.fn();
  const surDemarrer = vi.fn();
  const vue = vueAgents({ api, surFichier, surDemarrer, ...extra });
  document.body.append(vue.corps);
  await vue.afficher();
  await attendre();
  const c = vue.corps;
  const bouton = (nom) => [...c.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom || b.textContent === nom);
  const champ = (libelle) => {
    const l = [...c.querySelectorAll("label")].find((x) => x.textContent === libelle);
    return l && c.querySelector(`#${l.htmlFor}`);
  };
  const cases = () => [...c.querySelectorAll("input[type=checkbox]")];
  const erreurDe = (el) => c.querySelector(`#${el.getAttribute("aria-describedby").split(" ").find((i) => i.endsWith("-erreur"))}`)?.textContent;
  return { api, vue, c, bouton, champ, cases, erreurDe, surFichier, surDemarrer };
}

test("REQ064_AC1_AC11_liste_alphabetique_avatar_nom_modifier", async () => {
  const { c, cases, bouton } = await ouvrir([RELECTEUR, TESTEUR]);
  expect(c.querySelector(".ya-agents-compte").textContent).toBe("2 agents");
  expect(cases().map((x) => x.labels[0].textContent)).toEqual(["🦉Relecteur", "TTesteur"]);
  const ligne = cases()[0].closest(".ya-check-row");
  expect(ligne.querySelector(".ya-avatar").getAttribute("aria-hidden")).toBe("true");
  expect(ligne.querySelector(".ya-avatar").style.getPropertyValue("--c")).toBe("var(--agent-vert)");
  expect(ligne.querySelector("button").getAttribute("aria-label")).toBe("Modifier Relecteur");
  expect(bouton("Modifier Testeur")).toBeTruthy();
  expect(bouton("Nouvel agent")).toBeTruthy();
  expect(c.querySelector("h2")).toBeNull();
  // Un clic sur le nom coche la case.
  cases()[1].closest("label").querySelector(".nom").click();
  expect(cases()[1].checked).toBe(true);
  // Un agent seul : « 1 agent ».
  const un = await ouvrir([RELECTEUR]);
  expect(un.c.querySelector(".ya-agents-compte").textContent).toBe("1 agent");
});

test("REQ064_AC2_AC12_aucun_agent_focus_sur_nouvel_agent", async () => {
  const { c, bouton, cases } = await ouvrir([]);
  expect(c.textContent).toContain("Aucun agent.");
  expect(cases()).toHaveLength(0);
  expect(c.querySelector(".ya-agents-pied")).toBeNull();
  const b = c.querySelector(".indication button");
  expect(b.textContent).toBe("Nouvel agent");
  expect(document.activeElement).toBe(b);
  expect(bouton("Nouvel agent")).toBeTruthy();
});

test("REQ064_AC12_ordre_de_tab_de_la_liste", async () => {
  const { c, cases } = await ouvrir([RELECTEUR, TESTEUR]);
  expect(document.activeElement).toBe(cases()[0]);
  const noms = () => [...c.querySelectorAll("button, input")].map((e) => e.getAttribute("aria-label") ?? e.labels?.[0]?.textContent ?? e.textContent);
  expect(noms()).toEqual(["Nouvel agent", "🦉Relecteur", "Modifier Relecteur", "TTesteur", "Modifier Testeur", "Démarrer une conversation"]);
  expect(c.querySelector(".ya-agents-pied button").disabled).toBe(true);
  cases()[0].click();
  expect(c.querySelector(".ya-agents-pied button").disabled).toBe(false);
});

test("REQ064_AC13_fiche_nouvel_agent", async () => {
  const { c, bouton, champ } = await ouvrir([RELECTEUR]);
  bouton("Nouvel agent").click();
  expect(c.querySelector(".ya-agents-barre").textContent).toBe("Nouvel agent");
  expect(bouton("Retour aux agents")).toBeTruthy();
  expect(document.activeElement).toBe(champ("Nom"));
  expect(champ("Nom").value).toBe("");
  expect(champ("Avatar").value).toBe("");
  expect([...c.querySelectorAll("fieldset input")].map((r) => [r.getAttribute("aria-label"), r.checked])).toEqual([
    ["Violet", true], ["Vert", false], ["Orange", false], ["Rose", false], ["Sarcelle", false], ["Gris", false],
  ]);
  expect(champ("Profil").value).toBe("Profil par défaut");
  expect(bouton("AGENTS.md").disabled).toBe(true);
  expect(bouton("PERSONA.md").disabled).toBe(true);
  expect(bouton("MEMOIRE.md").disabled).toBe(true);
  expect(c.textContent).toContain("Enregistrez l'agent pour créer ses fichiers.");
  expect(bouton("Enregistrer")).toBeTruthy();
});

test("REQ064_AC14_cree_puis_enregistre", async () => {
  const { api, c, bouton, champ } = await ouvrir([]);
  bouton("Nouvel agent").click();
  taper(champ("Nom"), "Relecteur");
  champ("Nom").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await attendre();
  expect(api.etat.envoyes).toEqual([{ nom: "Relecteur", avatar: "", couleur: "violet" }]);
  const msg = c.querySelector(".message");
  expect(msg.textContent).toBe("Agent « Relecteur » créé.");
  expect(msg.getAttribute("role")).toBe("status");
  expect(c.querySelector(".ya-agents-barre .agents-nom").textContent).toBe("Relecteur");
  expect(c.querySelector(".ya-agents-barre .ya-avatar").textContent).toBe("R");
  expect(bouton("AGENTS.md").disabled).toBe(false);
  expect(bouton("PERSONA.md").disabled).toBe(false);
  expect(c.textContent).toContain("S'ouvrent dans l'éditeur.");
  expect(document.activeElement).toBe(champ("Nom"));
  // Le clic sur « Enregistrer » garde le focus sur le bouton, et dit « enregistré ».
  taper(champ("Nom"), "Relecteur 2");
  bouton("Enregistrer").focus();
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.envoyes[1]).toEqual({ dossier: "relecteur", nom: "Relecteur 2", avatar: "", couleur: "violet" });
  expect(c.querySelector(".message").textContent).toBe("Agent « Relecteur 2 » enregistré.");
  expect(document.activeElement).toBe(bouton("Enregistrer"));
});

test("REQ064_AC5_AC15_erreurs_par_champ_focus_dans_nom_rien_envoye", async () => {
  const { api, bouton, champ, erreurDe } = await ouvrir([RELECTEUR]);
  bouton("Nouvel agent").click();
  taper(champ("Avatar"), "QA!");
  bouton("Enregistrer").click();
  await attendre();
  expect(erreurDe(champ("Nom"))).toBe("Donnez un nom à l'agent.");
  expect(erreurDe(champ("Avatar"))).toBe("Avatar : deux caractères au plus.");
  expect(champ("Nom").getAttribute("aria-invalid")).toBe("true");
  expect(champ("Avatar").getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(champ("Nom"));
  taper(champ("Nom"), "  relecteur ");
  bouton("Enregistrer").click();
  await attendre();
  expect(erreurDe(champ("Nom"))).toBe("Ce nom est déjà pris. Choisissez-en un autre.");
  expect(erreurDe(champ("Avatar"))).toBe("Avatar : deux caractères au plus.");
  expect(champ("Nom").value).toBe("  relecteur ");
  expect(api.enregistrerAgent).not.toHaveBeenCalled();
});

test("REQ064_AC5_refus_du_serveur_et_coupure", async () => {
  const api = fausseApi([]);
  const { bouton, champ, c } = await ouvrir(null, { api });
  bouton("Nouvel agent").click();
  taper(champ("Nom"), "Revue");
  api.enregistrerAgent.mockResolvedValueOnce({ cause: "invalide", message: "valeur refusée (profil)", champs: ["profil"] });
  bouton("Enregistrer").click();
  await attendre();
  expect(c.querySelector(".message").textContent).toBe("Enregistrement impossible : valeur refusée (profil).");
  expect(c.querySelector(".message").getAttribute("role")).toBe("alert");
  api.enregistrerAgent.mockResolvedValueOnce({ coupure: true });
  bouton("Enregistrer").click();
  await attendre();
  expect(c.querySelector(".message").textContent).toBe("Connexion perdue. Réessayez au retour.");
});

test("REQ064_AC16_retour_sans_question_focus_sur_modifier", async () => {
  const { api, c, bouton, champ, cases } = await ouvrir([RELECTEUR, TESTEUR]);
  cases()[1].click();
  bouton("Modifier Relecteur").click();
  expect(champ("Nom").value).toBe("Relecteur");
  expect(c.querySelector(".ya-agents-barre .agents-nom").textContent).toBe("Relecteur");
  expect(document.activeElement).toBe(champ("Nom"));
  taper(champ("Nom"), "Autre");
  bouton("Retour aux agents").click();
  await attendre();
  expect(document.querySelector("dialog")).toBeNull();
  expect(api.enregistrerAgent).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(bouton("Modifier Relecteur"));
  expect(cases()[0].labels[0].textContent).toContain("Relecteur");
  // Les cases cochées restent cochées, fiche comprise.
  expect(cases().map((x) => x.checked)).toEqual([false, true]);
  // Nouvel agent abandonné : le focus est sur « Nouvel agent » de la barre.
  bouton("Nouvel agent").click();
  bouton("Retour aux agents").click();
  await attendre();
  expect(document.activeElement).toBe(bouton("Nouvel agent"));
  // Agent disparu : le focus va sur la première case.
  bouton("Modifier Testeur").click();
  api.etat.agents = api.etat.agents.filter((a) => a.dossier !== "testeur");
  bouton("Retour aux agents").click();
  await attendre();
  expect(document.activeElement).toBe(cases()[0]);
  expect(c.querySelector(".ya-agents-compte").textContent).toBe("1 agent");
});

test("REQ064_AC16_nouvel_agent_enregistre_puis_retour_sur_son_modifier", async () => {
  const { bouton, champ } = await ouvrir([RELECTEUR]);
  bouton("Nouvel agent").click();
  taper(champ("Nom"), "Testeur");
  bouton("Enregistrer").click();
  await attendre();
  bouton("Retour aux agents").click();
  await attendre();
  expect(document.activeElement).toBe(bouton("Modifier Testeur"));
});

test("REQ064_AC17_agent_json_illisible", async () => {
  const chemin = ".yaide/agents/revue/agent.json";
  const { c, cases } = await ouvrir([RELECTEUR, TESTEUR], { erreurs: [chemin, ".yaide/agents/autre/agent.json"] });
  const alertes = [...c.querySelectorAll("[role=alert]")];
  expect(alertes.map((a) => a.textContent)).toEqual([
    `${chemin} est illisible. Corrigez-le, puis rouvrez Agents.`,
    ".yaide/agents/autre/agent.json est illisible. Corrigez-le, puis rouvrez Agents.",
  ]);
  expect(cases()).toHaveLength(2);
  expect(cases().every((x) => !x.checked)).toBe(true);
  expect(document.activeElement).toBe(cases()[0]);
  expect(c.textContent).toContain("Cochez un ou plusieurs agents.");
  // Aucun agent lisible : le message est au-dessus de « Aucun agent. ».
  const vide = await ouvrir([], { erreurs: [chemin] });
  const kids = [...vide.c.children].map((e) => e.className.split(" ")[0]);
  expect(kids.indexOf("message")).toBeGreaterThan(-1);
  expect(kids.indexOf("message")).toBeLessThan(kids.indexOf("indication"));
});

test("REQ065_AC2_AC8_avatar_vide_emoji_qa_et_trois_refuse", async () => {
  const { c, bouton, champ } = await ouvrir([]);
  bouton("Nouvel agent").click();
  const apercu = () => c.querySelector(".agents-ligne-avatar .ya-avatar");
  expect(apercu().textContent).toBe("");
  taper(champ("Nom"), "Testeur");
  expect(apercu().textContent).toBe("T");
  taper(champ("Avatar"), "🦉");
  expect(apercu().textContent).toBe("🦉");
  taper(champ("Avatar"), "QA");
  expect(apercu().textContent).toBe("QA");
  taper(champ("Avatar"), "QA!");
  expect(apercu().textContent).toBe("T");
  expect(c.textContent).toContain("Un ou deux caractères. Vide : la première lettre du nom.");
  c.querySelector("input[aria-label=Orange]").click();
  expect(apercu().style.getPropertyValue("--c")).toBe("var(--agent-orange)");
  // Un avatar « QA » est accepté et envoyé.
  taper(champ("Avatar"), "QA");
  bouton("Enregistrer").click();
  await attendre();
  expect(c.querySelector(".message").textContent).toBe("Agent « Testeur » créé.");
});

test("REQ065_AC5_AC9_profil_par_defaut_et_ordre_des_profils", async () => {
  const sansProfil = { ...RELECTEUR, profil: "supprime" };
  const { c, bouton, champ, api } = await ouvrir([RELECTEUR, sansProfil && { ...TESTEUR, profil: "p2" }, { dossier: "x", nom: "Zed", avatar: "", couleur: "gris", profil: "supprime" }]);
  bouton("Modifier Relecteur").click();
  expect([...champ("Profil").options].map((o) => o.textContent)).toEqual(["Profil par défaut", "sonnet", "rapide"]);
  expect(champ("Profil").value).toBe("sonnet");
  bouton("Retour aux agents").click();
  await attendre();
  bouton("Modifier Testeur").click();
  expect(champ("Profil").value).toBe("rapide");
  bouton("Retour aux agents").click();
  await attendre();
  bouton("Modifier Zed").click();
  expect(champ("Profil").value).toBe("Profil par défaut");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.envoyes[0]).toEqual({ dossier: "x", nom: "Zed", avatar: "", couleur: "gris" });
  // Choisir un profil l'envoie.
  champ("Profil").value = "rapide";
  champ("Profil").dispatchEvent(new Event("change", { bubbles: true }));
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.envoyes[1].profil).toBe("p2");
  expect(c.querySelector(".message").textContent).toBe("Agent « Zed » enregistré.");
});

test("REQ066_AC6_fichiers_ouvrent_et_la_fiche_reste", async () => {
  const { c, bouton, champ, surFichier } = await ouvrir([RELECTEUR]);
  bouton("Modifier Relecteur").click();
  expect(c.textContent).toContain("S'ouvrent dans l'éditeur.");
  taper(champ("Nom"), "Nom tapé");
  bouton("PERSONA.md").click();
  bouton("AGENTS.md").click();
  expect(surFichier.mock.calls).toEqual([[".yaide/agents/relecteur/PERSONA.md"], [".yaide/agents/relecteur/AGENTS.md"]]);
  expect(champ("Nom").value).toBe("Nom tapé");
  expect(c.querySelector(".ya-agents-barre .agents-nom").textContent).toBe("Relecteur");
});

test("REQ067_AC2_AC14_cases_aide_et_demarrer_desactive", async () => {
  const { c, cases } = await ouvrir([RELECTEUR, TESTEUR]);
  const aide = () => c.querySelector(".ya-agents-aide").textContent;
  const demarrer = () => c.querySelector(".ya-agents-pied button");
  expect(aide()).toBe("Cochez un ou plusieurs agents.");
  expect(demarrer().textContent).toBe("Démarrer une conversation");
  expect(demarrer().disabled).toBe(true);
  cases()[0].click();
  expect(aide()).toBe("1 agent coché.");
  expect(demarrer().disabled).toBe(false);
  cases()[1].click();
  expect(aide()).toBe("2 agents cochés.");
  cases()[0].click();
  cases()[1].click();
  expect(aide()).toBe("Cochez un ou plusieurs agents.");
  expect(demarrer().disabled).toBe(true);
});

test("REQ067_demarrer_rend_les_agents_dans_l_ordre", async () => {
  const { vue, c, cases, surDemarrer } = await ouvrir([RELECTEUR, TESTEUR]);
  cases()[1].click();
  cases()[0].click();
  c.querySelector(".ya-agents-pied button").click();
  expect(surDemarrer).toHaveBeenCalledTimes(1);
  expect(surDemarrer.mock.calls[0][0].map((a) => a.dossier)).toEqual(["relecteur", "testeur"]);
  // Un nouvel affichage décoche tout.
  await vue.afficher();
  await attendre();
  expect(cases().every((x) => !x.checked)).toBe(true);
});

// ---------- Déclencheurs (REQ-163) ----------

const AIDES = {
  Fichier: "Depuis la racine du projet.",
  Dossier: "Depuis la racine du projet, sous-dossiers compris. « . » : tout le projet.",
  Commit: "À chaque commit du dépôt.",
  "Commande shell": "Une commande d'un shell de Yaide qui contient ce texte. Les majuscules comptent.",
  "Configuration de Yaide": "À chaque changement des providers, des profils, des serveurs MCP ou des préférences.",
  Planification: "Expression cron : minute, heure, jour du mois, mois, jour de la semaine, à l'heure de la machine de Yaide.",
};
const REFUS_CRON = "Donnez une expression cron à cinq champs, par exemple 0 9 * * 1-5.";

async function ficheRelecteur(agent = RELECTEUR) {
  const o = await ouvrir([agent]);
  o.bouton("Modifier Relecteur").click();
  const ajouter = o.bouton("Ajouter un déclencheur");
  const choisir = (type) => {
    ajouter.focus();
    ajouter.click();
    [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((m) => m.textContent === type).click();
  };
  const retirer = (n) => o.bouton(`Retirer le déclencheur ${n}`);
  return { ...o, ajouter, choisir, retirer };
}

test("REQ163_AC6_section_menu_des_six_types_et_echap", async () => {
  const { c, ajouter } = await ficheRelecteur();
  const section = [...c.querySelectorAll("fieldset")].find((f) => f.querySelector("legend")?.textContent === "Déclencheurs");
  expect(section.previousElementSibling.textContent).toContain("Fichiers");
  expect(document.getElementById(section.getAttribute("aria-describedby")).textContent).toBe("À chaque évènement, l'agent le reçoit dans une nouvelle conversation.");
  expect(section.querySelector('[role="status"]').textContent).toBe("Aucun déclencheur.");
  expect(ajouter.getAttribute("aria-haspopup")).toBe("menu");
  expect(ajouter.getAttribute("aria-expanded")).toBe("false");
  ajouter.focus();
  ajouter.click();
  const m = document.querySelector('[role="menu"]');
  expect(m.getAttribute("aria-label")).toBe("Ajouter un déclencheur");
  expect([...m.querySelectorAll('[role="menuitem"]')].map((x) => x.textContent)).toEqual(Object.keys(AIDES));
  expect(document.activeElement.textContent).toBe("Fichier");
  expect(ajouter.getAttribute("aria-expanded")).toBe("true");
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(c.querySelector("ol")).toBeNull();
  expect(document.activeElement).toBe(ajouter);
  expect(ajouter.getAttribute("aria-expanded")).toBe("false");
});

test("REQ163_AC7_titre_champ_nomme_aide_par_type_et_rien_d_ecrit", async () => {
  const { api, c, choisir, retirer } = await ficheRelecteur();
  choisir("Dossier");
  expect(c.querySelector('[role="status"]')).toBeNull();
  const ol = c.querySelector('ol[aria-label="Déclencheurs"]');
  const champ1 = ol.querySelector("input");
  expect(ol.children[0].querySelector(".ya-element-titre").textContent).toContain("Dossier");
  expect(champ1.labels[0].textContent).toBe("Déclencheur 1 : Dossier");
  expect(champ1.value).toBe("");
  expect(document.activeElement).toBe(champ1);
  expect(document.getElementById(champ1.getAttribute("aria-describedby")).textContent).toBe(AIDES.Dossier);
  choisir("Commit");
  expect(ol.children).toHaveLength(2);
  expect(ol.children[1].querySelector("input")).toBeNull();
  expect(ol.children[1].textContent).toContain("À chaque commit du dépôt.");
  expect(document.activeElement).toBe(retirer(2));
  for (const type of ["Fichier", "Commande shell", "Configuration de Yaide"]) {
    choisir(type);
    const li = ol.lastElementChild;
    expect(li.querySelector(".ya-element-aide, .champ-aide").textContent).toBe(AIDES[type]);
  }
  expect(api.enregistrerAgent).not.toHaveBeenCalled();
});

test("REQ163_AC1_cinq_types_enregistres_dans_l_ordre_de_la_fiche", async () => {
  const { api, c, choisir, bouton } = await ficheRelecteur();
  const champs = () => [...c.querySelectorAll("ol input")];
  choisir("Fichier");
  taper(champs().at(-1), "docs/a.md");
  choisir("Dossier");
  taper(champs().at(-1), "src");
  choisir("Commit");
  choisir("Commande shell");
  taper(champs().at(-1), "cargo test");
  choisir("Configuration de Yaide");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.envoyes[0].declencheurs).toEqual([
    { type: "fichier", chemin: "docs/a.md" },
    { type: "dossier", chemin: "src" },
    { type: "commit" },
    { type: "commande", texte: "cargo test" },
    { type: "configuration" },
  ]);
  expect(c.querySelector(".message").textContent).toBe("Agent « Relecteur » enregistré.");
  expect(c.querySelectorAll("ol > li")).toHaveLength(5);
  // Rouverte, la fiche montre les cinq déclencheurs.
  bouton("Retour aux agents").click();
  await attendre();
  bouton("Modifier Relecteur").click();
  expect([...c.querySelectorAll("ol .ya-element-titre")].map((t) => t.textContent.replace(/^Déclencheur \d : /, ""))).toEqual(["Fichier", "Dossier", "Commit", "Commande shell", "Configuration de Yaide"]);
  expect(champs().map((i) => i.value)).toEqual(["docs/a.md", "src", "cargo test"]);
});

test("REQ163_AC2_retrait_enregistre_et_retour_n_ecrit_rien", async () => {
  const agent = { ...RELECTEUR, declencheurs: [{ type: "fichier", chemin: "a" }, { type: "commit" }, { type: "dossier", chemin: "b" }] };
  const { api, c, retirer, bouton } = await ficheRelecteur(agent);
  retirer(2).click();
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.envoyes[0].declencheurs).toEqual([{ type: "fichier", chemin: "a" }, { type: "dossier", chemin: "b" }]);
  retirer(1).click();
  retirer(1).click();
  bouton("Enregistrer").click();
  await attendre();
  expect("declencheurs" in api.etat.envoyes[1]).toBe(false);
  // Retour sans enregistrer : aucune écriture de plus.
  expect(c.querySelector('[role="status"]').textContent).toBe("Aucun déclencheur.");
  const avant = api.etat.envoyes.length;
  bouton("Retour aux agents").click();
  await attendre();
  expect(api.etat.envoyes).toHaveLength(avant);
});

test("REQ163_AC8_retrait_renumerote_focus_et_ordre_de_tab", async () => {
  const agent = {
    ...RELECTEUR,
    declencheurs: [{ type: "fichier", chemin: "a" }, { type: "commit" }, { type: "dossier", chemin: "b" }],
  };
  const { c, retirer, ajouter, bouton } = await ficheRelecteur(agent);
  const section = c.querySelector("fieldset.agents-declencheurs");
  const tabs = [...section.querySelectorAll("button, input")].map((e) => e.getAttribute("aria-label") ?? (e.tagName === "INPUT" ? e.value : e.textContent));
  expect(tabs).toEqual(["Retirer le déclencheur 1", "a", "Retirer le déclencheur 2", "Retirer le déclencheur 3", "b", "Ajouter un déclencheur"]);
  const ordre = [...c.querySelectorAll("button, input")];
  expect(ordre.indexOf(ajouter)).toBeLessThan(ordre.indexOf(bouton("Enregistrer")));
  retirer(2).click();
  expect(c.querySelectorAll("ol > li")).toHaveLength(2);
  expect(document.activeElement).toBe(retirer(2));
  expect(c.querySelectorAll("ol input")[1].labels[0].textContent).toBe("Déclencheur 2 : Dossier");
  retirer(2).click();
  expect(document.activeElement).toBe(retirer(1));
  retirer(1).click();
  expect(c.querySelector('[role="status"]').textContent).toBe("Aucun déclencheur.");
  expect(document.activeElement).toBe(ajouter);
  expect(bouton("Enregistrer")).toBeTruthy();
});

test("REQ163_AC3_AC9_refus_sous_le_champ_alert_invalid_focus_et_rien_d_ecrit", async () => {
  const { api, c, choisir, bouton } = await ficheRelecteur();
  const champs = () => [...c.querySelectorAll("ol input")];
  choisir("Dossier");
  taper(champs()[0], "../x");
  choisir("Commande shell");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.enregistrerAgent).not.toHaveBeenCalled();
  const [dossier, commande] = champs();
  const message = (el) => document.getElementById(el.getAttribute("aria-describedby"));
  expect(message(dossier).textContent).toBe("Donnez un chemin dans le projet.");
  expect(message(commande).textContent).toBe("Donnez le texte de la commande.");
  expect(message(dossier).getAttribute("role")).toBe("alert");
  expect(dossier.getAttribute("aria-invalid")).toBe("true");
  expect(commande.getAttribute("aria-invalid")).toBe("true");
  expect(c.textContent).not.toContain("sous-dossiers compris");
  expect(document.activeElement).toBe(dossier);
  // Chemin vide et absolu : mêmes refus ; `.` et `a/../b` passent.
  for (const mauvais of ["", "/etc/passwd", "a/../../x"]) {
    taper(champs()[0], mauvais);
    taper(champs()[1], "cargo");
    bouton("Enregistrer").click();
    await attendre();
    expect(message(champs()[0]).textContent).toBe("Donnez un chemin dans le projet.");
  }
  taper(champs()[0], ".");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.envoyes[0].declencheurs).toEqual([{ type: "dossier", chemin: "." }, { type: "commande", texte: "cargo" }]);
});

test("REQ174_AC1_AC163_6_planification_derniere_du_menu_champ_nomme_focus_aide_et_saisie", async () => {
  const { api, c, ajouter, choisir, bouton } = await ficheRelecteur();
  ajouter.focus();
  ajouter.click();
  const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((x) => x.textContent);
  expect(items).toHaveLength(6);
  expect(items.at(-1)).toBe("Planification");
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  choisir("Planification");
  const ol = c.querySelector('ol[aria-label="Déclencheurs"]');
  const champ = ol.querySelector("input");
  expect(ol.children[0].querySelector(".ya-element-titre").textContent).toContain("Planification");
  expect(champ.labels[0].textContent).toBe("Déclencheur 1 : Planification");
  expect(champ.value).toBe("");
  expect(document.activeElement).toBe(champ);
  expect(document.getElementById(champ.getAttribute("aria-describedby").split(" ")[0]).textContent).toBe(AIDES.Planification);
  taper(champ, " 0 9 * * 1-5 ");
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.envoyes[0].declencheurs).toEqual([{ type: "planification", cron: "0 9 * * 1-5" }]);
});

test("REQ174_AC2_AC6_refus_a_la_place_de_l_aide_invalid_describedby_focus_et_rien_d_ecrit", async () => {
  const { api, c, choisir, bouton } = await ficheRelecteur();
  choisir("Planification");
  const champ = () => c.querySelector("ol input");
  for (const mauvais of ["toutes les heures", "61 * * * *", "* * *", "", "0 9 * * 1-5 2026", "*/0 * * * *"]) {
    taper(champ(), mauvais);
    bouton("Enregistrer").click();
    await attendre();
    const message = document.getElementById(champ().getAttribute("aria-describedby").split(" ")[0]);
    expect(message.textContent, mauvais).toBe(REFUS_CRON);
    expect(message.getAttribute("role")).toBe("alert");
    expect(champ().getAttribute("aria-invalid")).toBe("true");
    expect(c.textContent).not.toContain("Expression cron :");
    expect(document.activeElement).toBe(champ());
  }
  expect(api.enregistrerAgent).not.toHaveBeenCalled();
  for (const bon of ["*/10 9 1,15 jan mon-fri", "0 0 * * 7", "5 4 * * SUN"]) {
    taper(champ(), bon);
    bouton("Enregistrer").click();
    await attendre();
    expect(api.etat.envoyes.at(-1).declencheurs).toEqual([{ type: "planification", cron: bon }]);
  }
});

test("REQ204_AC3_modele_dans_la_fiche_remplit_le_champ_focus_prochaines_fois_et_enregistrement", async () => {
  prochaines.mockClear();
  prochaines.mockResolvedValue({ dates: ["2026-11-30T09:00", "2026-12-01T09:00", "2026-12-02T09:00"] });
  const { api, c, choisir, bouton } = await ficheRelecteur();
  choisir("Planification");
  const champ = c.querySelector("ol input");
  const modeles = bouton("Modèles d'expression cron");
  expect(modeles.textContent).toBe("Modèles");
  expect(modeles.getAttribute("aria-haspopup")).toBe("menu");
  modeles.click();
  const item = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((x) => x.getAttribute("aria-label") === "Du lundi au vendredi à 9 h, 0 9 * * 1-5");
  item.click();
  await attendre();
  await attendre();
  expect(champ.value).toBe("0 9 * * 1-5");
  expect(document.activeElement).toBe(champ);
  const zone = document.getElementById(champ.getAttribute("aria-describedby").split(" ").at(-1));
  expect(zone.getAttribute("aria-live")).toBe("polite");
  expect(zone.textContent).toContain("Prochaines fois :");
  expect([...zone.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["lundi 30 novembre 2026, 09:00", "mardi 1er décembre 2026, 09:00", "mercredi 2 décembre 2026, 09:00"]);
  expect(api.enregistrerAgent).not.toHaveBeenCalled();
  bouton("Enregistrer").click();
  await attendre();
  expect(api.etat.envoyes[0].declencheurs).toEqual([{ type: "planification", cron: "0 9 * * 1-5" }]);
});

test("REQ205_AC7_trois_fichiers_dans_l_ordre_et_memoire_ouvre_son_chemin", async () => {
  const { c, bouton, surFichier } = await ouvrir([RELECTEUR]);
  bouton("Modifier Relecteur").click();
  const noms = [...c.querySelectorAll(".agents-fichiers button")].map((b) => b.textContent.trim());
  expect(noms).toEqual(["AGENTS.md", "PERSONA.md", "MEMOIRE.md"]);
  const aide = [...c.querySelectorAll(".champ-aide")].find((a) => a.textContent === "S'ouvrent dans l'éditeur.");
  expect(aide.previousElementSibling.className).toBe("agents-fichiers");
  expect(bouton("MEMOIRE.md").disabled).toBe(false);
  expect(bouton("MEMOIRE.md").querySelector("svg")).not.toBeNull();
  bouton("MEMOIRE.md").click();
  expect(surFichier.mock.calls).toEqual([[".yaide/agents/relecteur/MEMOIRE.md"]]);
});
