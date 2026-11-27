import { expect, test, vi } from "vitest";
import { workflow } from "./workflow.js";

const vide = () => ({ nom: "Revue des notes", publie: false, noeuds: [], liens: [] });
const noeud = (id, type, titre, x, y, reglages = {}) => ({ id, type, titre, x, y, reglages });
const AGENTS = [{ dossier: "agents/relecteur", nom: "Relecteur" }, { dossier: "agents/redacteur", nom: "Rédacteur" }];

// Monte l'éditeur ; chaque document produit est rendu au composant, comme le fait l'onglet.
function monter(document_ = vide(), options = {}) {
  const docs = [];
  let w;
  const surChangement = (d) => {
    docs.push(d);
    w.maj({ document: d });
  };
  w = workflow({ nom: "Revue des notes", document: document_, agents: AGENTS, surChangement, ...options });
  document.body.replaceChildren(w);
  const p = w.querySelector("aside");
  const type = (nom) => [...p.querySelectorAll(".ya-wf-type")].find((b) => b.getAttribute("aria-label") === nom);
  const champ = (cle) => p.querySelector(`[data-champ="${cle}"]`);
  const libelles = () => [...p.querySelectorAll("label.champ-libelle, legend")].map((l) => l.textContent);
  const saisir = (cle, valeur) => {
    const c = champ(cle);
    c.value = valeur;
    c.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const choisir = (el) => el.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }), { pointerId: 1 }));
  return { w, p, docs, type, champ, libelles, saisir, choisir, surface: w.querySelector(".ya-wf-surface") };
}
const touche = (cible, key) => cible.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

test("REQ191_AC1_AC7_le_panneau_liste_les_types_en_deux_groupes_decrits", () => {
  const { p, w } = monter();
  expect(p.tagName).toBe("ASIDE");
  expect(p.getAttribute("aria-labelledby")).toBe(p.querySelector("h2").id);
  expect(p.querySelector("h2").textContent).toBe("Nœuds");
  expect(p.querySelector(".ya-wf-aide").textContent).toBe("Cliquez sur un type pour l'ajouter, ou glissez-le sur la surface. Chaque action reçoit la sortie du nœud d'avant.");
  const groupes = [...p.querySelectorAll('[role="group"]')];
  expect(groupes.map((g) => document.getElementById(g.getAttribute("aria-labelledby")).textContent)).toEqual(["Déclencheurs", "Actions"]);
  expect([...groupes[0].querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Fichiers d'un dossier", "Planification", "Appel par un agent"]);
  expect([...groupes[1].querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Agent", "Commande shell", "Session Claude", "Fichier", "Trace"]);
  for (const b of p.querySelectorAll("button")) {
    expect(b.draggable).toBe(true);
    expect(b.querySelector("svg")).not.toBeNull();
    expect(document.getElementById(b.getAttribute("aria-describedby")).textContent.length).toBeGreaterThan(10);
  }
  expect(document.getElementById(p.querySelector("button").getAttribute("aria-describedby")).textContent).toBe("Un fichier y est créé, modifié ou supprimé.");
  expect(w.querySelector(".ya-wf-vide").textContent).toBe("Ajoutez un déclencheur depuis le panneau Nœuds.");
});

test("REQ191_AC2_clic_sur_les_types_produit_le_document_avec_positions_et_lien_relu_identique", () => {
  const m = monter();
  m.type("Fichiers d'un dossier").click();
  expect(m.w.querySelector(".ya-noeud-choisi .ya-noeud-titre").textContent).toBe("Fichiers d'un dossier 1");
  expect(m.p.querySelector(".ya-wf-noeud-type").textContent).toBe("Fichiers d'un dossier");
  expect(m.p.querySelector(".ya-wf-type:not(.ya-wf-type-court)")).toBeNull();
  [...m.p.querySelectorAll(".ya-wf-type-court")].find((b) => b.getAttribute("aria-label") === "Commande shell").click();
  const d = m.docs.at(-1);
  expect(d.noeuds).toEqual([
    { id: "n1", type: "dossier", titre: "Fichiers d'un dossier 1", x: 40, y: 40, reglages: { dossier: "", evenements: ["cree", "modifie", "supprime"] } },
    { id: "n2", type: "shell", titre: "Commande shell 1", x: 344, y: 40, reglages: {} },
  ]);
  expect(d.liens).toEqual([{ de: "n1", vers: "n2" }]);
  expect(m.champ("apres").selectedOptions[0].textContent).toBe("Fichiers d'un dossier 1");
  // un document relu rend la même surface et le même panneau
  const relu = monter(JSON.parse(JSON.stringify(d)), {});
  relu.choisir(relu.w.querySelector('.ya-noeud[data-id="n2"]'));
  expect(relu.w.querySelector(".ya-wf-surface").innerHTML).toBe(m.w.querySelector(".ya-wf-surface").innerHTML);
  expect(relu.p.innerHTML.replace(/champ-\d+|ya-wf-\w+-\d+[\w-]*/g, "")).toBe(m.p.innerHTML.replace(/champ-\d+|ya-wf-\w+-\d+[\w-]*/g, ""));
});

test("REQ191_AC2_glisser_un_type_le_pose_centre_sur_le_pointeur", () => {
  const m = monter();
  const dt = { getData: (t) => (t === "application/x-yaide-noeud" ? "planification" : ""), types: ["application/x-yaide-noeud"] };
  const dragover = Object.assign(new Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer: dt });
  m.surface.dispatchEvent(dragover);
  expect(dragover.defaultPrevented).toBe(true);
  m.surface.dispatchEvent(Object.assign(new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }), { dataTransfer: dt }));
  expect(m.docs[0].noeuds[0]).toMatchObject({ type: "planification", x: 180, y: 172 });
  const debut = Object.assign(new Event("dragstart", { bubbles: true, cancelable: true }), { dataTransfer: { setData: vi.fn() } });
  m.w.maj({ choix: null });
  m.type("Agent").dispatchEvent(debut);
  expect(debut.dataTransfer.setData).toHaveBeenCalledWith("application/x-yaide-noeud", "agent");
});

test("REQ191_AC4_apres_aucun_retire_le_lien_retirer_le_noeud_et_echap_rendent_les_types", () => {
  const doc = { ...vide(), noeuds: [noeud("n1", "dossier", "D", 0, 0), noeud("n2", "shell", "S", 300, 0), noeud("n3", "agent", "A", 600, 0)], liens: [{ de: "n1", vers: "n2" }, { de: "n2", vers: "n3" }] };
  const m = monter(doc);
  m.choisir(m.w.querySelector('.ya-noeud[data-id="n2"]'));
  expect([...m.champ("apres").options].map((o) => o.textContent)).toEqual(["Aucun", "D"]); // pas A : boucle
  m.champ("apres").value = "";
  m.champ("apres").dispatchEvent(new Event("change", { bubbles: true }));
  expect(m.docs.at(-1).liens).toEqual([{ de: "n2", vers: "n3" }]);
  // Retirer le nœud fait comme Suppr, et le focus va sur la surface
  const retirer = m.p.querySelector(".ya-wf-retirer");
  expect(retirer.getAttribute("aria-label")).toBe("Retirer le nœud");
  expect(retirer.getAttribute("aria-keyshortcuts")).toBe("Delete");
  retirer.click();
  expect(m.docs.at(-1).noeuds.map((n) => n.id)).toEqual(["n1", "n3"]);
  expect(m.docs.at(-1).liens).toEqual([]);
  expect(m.type("Agent")).toBeDefined();
  expect(document.activeElement).toBe(m.surface);
  // Échap dans un champ du panneau : plus de choix, focus sur la surface
  m.choisir(m.w.querySelector('.ya-noeud[data-id="n3"]'));
  m.champ("titre").focus();
  touche(m.champ("titre"), "Escape");
  expect(m.w.querySelector(".ya-noeud-choisi")).toBeNull();
  expect(m.type("Agent")).toBeDefined();
  expect(document.activeElement).toBe(m.surface);
});

test("REQ191_AC8_nœud_choisi_reglages_ajout_apres_et_focus_dans_le_premier_champ", () => {
  const m = monter();
  const attendu = { "Fichiers d'un dossier": "dossier", Planification: "cron", "Appel par un agent": "titre", Agent: "agent", "Commande shell": "commande", "Session Claude": "demande", Fichier: "operation", Trace: "message" };
  for (const [nom, cle] of Object.entries(attendu)) {
    m.w.maj({ document: vide(), choix: null });
    m.type(nom).click();
    expect(document.activeElement.dataset.champ, nom).toBe(cle);
  }
  // un déclencheur choisi : titre, champs, pas d'« Après », ajout après lui
  m.w.maj({ document: vide(), choix: null });
  m.type("Planification").click();
  expect(m.libelles()).toEqual(["Titre", "Expression cron"]);
  expect(m.champ("apres")).toBeNull();
  expect(m.p.querySelectorAll('[role="group"] button')).toHaveLength(5);
  m.champ("titre").focus();
  m.saisir("titre", "Chaque matin");
  expect(m.docs.at(-1).noeuds[0].titre).toBe("Chaque matin");
  expect(document.activeElement.dataset.champ).toBe("titre"); // la frappe garde son focus
  // une action choisie : « Après », puis « Ajouter une action après » avec les quatre actions
  expect(m.type("Planification")).toBeUndefined(); // les types ont laissé la place aux réglages
  [...m.p.querySelectorAll(".ya-wf-type-court")].find((b) => b.getAttribute("aria-label") === "Session Claude").click();
  expect(m.libelles()).toEqual(["Titre", "Demande", "Après"]);
  const g = m.p.querySelector('[role="group"]');
  expect(document.getElementById(g.getAttribute("aria-labelledby")).textContent).toBe("Ajouter une action après");
  expect([...g.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Agent", "Commande shell", "Session Claude", "Fichier", "Trace"]);
  expect(g.querySelector("button").hasAttribute("aria-describedby")).toBe(false);
  expect(m.docs.at(-1).liens).toEqual([{ de: "n1", vers: "n2" }]);
  expect([...m.champ("apres").options].map((o) => o.textContent)).toEqual(["Aucun", "Chaque matin"]);
});

test("REQ191_AC9_entree_sur_la_surface_met_le_focus_dans_titre", () => {
  const m = monter({ ...vide(), noeuds: [noeud("n1", "shell", "S", 0, 0)] });
  touche(m.surface, "Tab");
  touche(m.surface, "Enter");
  expect(document.activeElement).toBe(m.champ("titre"));
});

test("REQ193_AC6_reglages_des_declencheurs_aides_et_aucun_apres", () => {
  const m = monter();
  m.type("Fichiers d'un dossier").click();
  expect(m.libelles()).toEqual(["Titre", "Dossier", "Évènements", "Créé", "Modifié", "Supprimé"]);
  expect(m.p.querySelector(".champ-aide").textContent).toBe("Depuis la racine du projet, sous-dossiers compris. « . » : tout le projet.");
  const cases = [...m.p.querySelectorAll('input[type="checkbox"]')];
  expect(cases.map((c) => c.checked)).toEqual([true, true, true]);
  expect(m.p.querySelector("fieldset legend").textContent).toBe("Évènements");
  m.saisir("dossier", "notes");
  cases[1].checked = false;
  cases[1].dispatchEvent(new Event("change", { bubbles: true }));
  expect(m.docs.at(-1).noeuds[0].reglages).toEqual({ dossier: "notes", evenements: ["cree", "supprime"] });
  expect(m.champ("apres")).toBeNull();
  expect(m.w.querySelector(".ya-noeud-entree")).toBeNull();
  m.w.maj({ document: vide(), choix: null });
  m.type("Planification").click();
  expect(m.p.querySelector(".champ-aide").textContent).toBe("Expression cron : minute, heure, jour du mois, mois, jour de la semaine, à l'heure de la machine de Yaide.");
  m.saisir("cron", "0 9 * * 1-5");
  expect(m.docs.at(-1).noeuds[0].reglages).toEqual({ cron: "0 9 * * 1-5" });
  m.w.maj({ document: vide(), choix: null });
  m.type("Appel par un agent").click();
  expect(m.libelles()).toEqual(["Titre"]);
  expect(m.p.querySelector(".ya-wf-aide").textContent).toBe("Un agent le lance avec l'outil run_workflow. Son texte devient l'entrée.");
});

test("REQ195_AC7_AC8_champs_des_actions_libelles_et_aides_reliees", () => {
  const m = monter();
  const aides = () => [...m.p.querySelectorAll(".champ")].map((c) => [c.querySelector("label")?.textContent, c.querySelector(".champ-aide")?.textContent]);
  m.type("Agent").click();
  expect(m.libelles()).toEqual(["Titre", "Agent", "Message", "Après"]);
  expect([...m.champ("agent").options].map((o) => o.textContent)).toEqual(["Choisir un agent", "Relecteur", "Rédacteur"]);
  expect(aides()).toContainEqual(["Agent", "Une nouvelle conversation, avec cet agent seul."]);
  expect(aides()).toContainEqual(["Message", "{{entree}} y est remplacé par l'entrée. La sortie est la dernière réponse de l'agent."]);
  expect([...m.champ("apres").options].map((o) => o.textContent)).toEqual(["Aucun"]);
  m.champ("agent").value = "agents/relecteur";
  m.champ("agent").dispatchEvent(new Event("change", { bubbles: true }));
  m.saisir("message", "Relis : {{entree}}");
  expect(m.docs.at(-1).noeuds[0].reglages).toEqual({ agent: "agents/relecteur", nom: "Relecteur", message: "Relis : {{entree}}" });
  for (const c of m.p.querySelectorAll("[data-champ]")) {
    const aide = c.getAttribute("aria-describedby");
    if (c.dataset.champ !== "titre" && c.dataset.champ !== "apres") expect(document.getElementById(aide).className).toBe("champ-aide");
  }
  m.w.maj({ document: vide(), choix: null });
  m.type("Commande shell").click();
  expect(aides()).toContainEqual(["Commande", "Lancée dans la racine du projet. L'entrée est dans $YAIDE_ENTREE. La sortie est ce qu'elle affiche."]);
  expect(m.champ("commande").tagName).toBe("TEXTAREA");
  m.w.maj({ document: vide(), choix: null });
  m.type("Session Claude").click();
  expect(aides()).toContainEqual(["Demande", "{{entree}} y est remplacé par l'entrée. Claude Code suit vos réglages et refuse ce qui demande une autorisation."]);
});

test("REQ195_AC7_AC8_fichier_montre_contenu_ou_destination_selon_loperation", () => {
  const m = monter();
  m.type("Fichier").click();
  expect([...m.champ("operation").options].map((o) => o.textContent)).toEqual(["Lire", "Écrire", "Copier", "Déplacer", "Supprimer"]);
  expect(m.champ("operation").value).toBe("lire");
  expect(m.libelles()).toEqual(["Titre", "Opération", "Chemin", "Après"]);
  const op = (v) => {
    m.champ("operation").value = v;
    m.champ("operation").dispatchEvent(new Event("change", { bubbles: true }));
  };
  m.saisir("chemin", "out/a.txt");
  expect(m.p.querySelector(".champ-aide").textContent).toBe("Depuis la racine du projet. {{entree}} y est remplacé par l'entrée.");
  op("ecrire");
  expect(m.libelles()).toEqual(["Titre", "Opération", "Chemin", "Contenu", "Après"]);
  expect(document.activeElement).toBe(m.champ("operation")); // la liste garde le focus
  expect(m.p.querySelectorAll(".champ-aide")[1].textContent).toBe("{{entree}} y est remplacé par l'entrée. Le fichier est créé ou remplacé.");
  m.saisir("contenu", "{{entree}}");
  op("copier");
  expect(m.libelles()).toEqual(["Titre", "Opération", "Chemin", "Destination", "Après"]);
  expect(m.docs.at(-1).noeuds[0].reglages).toEqual({ operation: "copier", chemin: "out/a.txt" }); // contenu masqué : non enregistré
  expect(m.p.querySelectorAll(".champ-aide")[1].textContent).toBe("Depuis la racine du projet. Remplacée si elle existe. {{entree}} y est remplacé par l'entrée.");
  m.saisir("destination", "b.txt");
  op("deplacer");
  expect(m.champ("destination").value).toBe("b.txt");
  op("supprimer");
  expect(m.libelles()).toEqual(["Titre", "Opération", "Chemin", "Après"]);
  op("ecrire");
  expect(m.champ("contenu").value).toBe("{{entree}}"); // gardé tant que l'onglet est ouvert
  expect(m.docs.at(-1).noeuds[0].reglages).toEqual({ operation: "ecrire", chemin: "out/a.txt", contenu: "{{entree}}" });
});

test("REQ195_AC8_agent_supprime_garde_son_nom_dans_la_liste", () => {
  const doc = { ...vide(), noeuds: [noeud("n1", "agent", "Agent 1", 0, 0, { agent: "agents/relecteur", nom: "Relecteur", message: "x" })] };
  const m = monter(doc, { agents: [] });
  m.choisir(m.w.querySelector(".ya-noeud"));
  expect(m.champ("agent").selectedOptions[0].textContent).toBe("Relecteur (supprimé)");
  expect(m.champ("agent").value).toBe("agents/relecteur");
});

test("REQ192_AC3_AC8_lecture_seule_types_et_champs_non_modifiables", () => {
  const doc = { ...vide(), publie: true, noeuds: [noeud("n1", "dossier", "D", 0, 0, { dossier: "notes", evenements: ["cree"] }), noeud("n2", "fichier", "F", 300, 0, { operation: "ecrire", chemin: "a", contenu: "c" })], liens: [{ de: "n1", vers: "n2" }] };
  const m = monter(doc, { lectureSeule: true });
  const bandeau = m.w.querySelector(".ya-wf-lecture-message");
  expect(bandeau.hidden).toBe(false);
  expect(bandeau.textContent).toContain("Workflow publié : dépubliez-le pour le modifier.");
  expect(bandeau.querySelector('[role="status"]').textContent).toBe("Workflow publié : dépubliez-le pour le modifier.");
  for (const b of m.p.querySelectorAll(".ya-wf-type")) {
    expect(b.getAttribute("aria-disabled")).toBe("true");
    b.click();
  }
  const debut = Object.assign(new Event("dragstart", { bubbles: true, cancelable: true }), { dataTransfer: { setData: vi.fn() } });
  m.p.querySelector(".ya-wf-type").dispatchEvent(debut);
  expect(debut.defaultPrevented).toBe(true);
  expect(m.docs).toHaveLength(0);
  m.choisir(m.w.querySelector('.ya-noeud[data-id="n2"]'));
  expect(m.w.querySelector(".ya-noeud-choisi")).not.toBeNull();
  for (const cle of ["titre", "chemin", "contenu"]) expect(m.champ(cle).readOnly, cle).toBe(true);
  expect(m.champ("operation").disabled).toBe(true);
  expect(m.champ("apres").disabled).toBe(true);
  expect(m.p.querySelector(".ya-wf-retirer").getAttribute("aria-disabled")).toBe("true");
  for (const b of m.p.querySelectorAll(".ya-wf-type-court")) expect(b.getAttribute("aria-disabled")).toBe("true");
  m.p.querySelector(".ya-wf-retirer").click();
  m.p.querySelector(".ya-wf-type-court").click();
  expect(m.docs).toHaveLength(0);
  m.choisir(m.w.querySelector('.ya-noeud[data-id="n1"]'));
  expect(m.p.querySelector('input[type="checkbox"]').disabled).toBe(true);
  // dépublié : modifiable sans rechargement, le choix reste
  m.w.maj({ lectureSeule: false });
  expect(bandeau.hidden).toBe(true);
  expect(m.champ("dossier").readOnly).toBe(false);
  expect(m.w.querySelector(".ya-noeud-choisi")).not.toBeNull();
});

test("REQ195_AC10_trace_apres_fichier_phrase_message_multiligne_aide_reliee_puis_apres", () => {
  const m = monter();
  const actions = m.p.querySelectorAll('[role="group"]')[1];
  const noms = [...actions.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  expect(noms.indexOf("Trace")).toBe(noms.indexOf("Fichier") + 1);
  expect(noms.at(-1)).toBe("Trace");
  expect(document.getElementById(m.type("Trace").getAttribute("aria-describedby")).textContent).toBe("Écrit un message dans le journal des logs de Yaide.");
  m.type("Trace").click();
  expect(m.libelles()).toEqual(["Titre", "Message", "Après"]);
  expect(m.champ("message").tagName).toBe("TEXTAREA");
  const aide = document.getElementById(m.champ("message").getAttribute("aria-describedby"));
  expect(aide.className).toBe("champ-aide");
  expect(aide.textContent).toBe("{{entree}} y est remplacé par l'entrée. Le message s'écrit dans le journal des logs de Yaide. La sortie est l'entrée reçue.");
  m.saisir("message", "Reçu : {{entree}}");
  expect(m.docs.at(-1).noeuds[0]).toMatchObject({ type: "trace", titre: "Trace 1", reglages: { message: "Reçu : {{entree}}" } });
});

test("REQ195_AC11_trace_a_son_icone_partout_est_reliee_apres_le_choix_et_prend_le_focus_dans_message", () => {
  const m = monter();
  const icone = (el) => el.querySelector("svg").getAttribute("data-icone");
  expect(icone(m.type("Trace"))).toBe("scroll-text");
  m.type("Fichiers d'un dossier").click();
  const court = [...m.p.querySelectorAll(".ya-wf-type-court")].find((b) => b.getAttribute("aria-label") === "Trace");
  expect(icone(court)).toBe("scroll-text");
  court.click();
  expect(icone(m.p.querySelector(".ya-wf-noeud-type"))).toBe("scroll-text");
  expect(m.p.querySelector(".ya-wf-noeud-type").textContent).toBe("Trace");
  expect(icone(m.w.querySelector(".ya-noeud-choisi"))).toBe("scroll-text");
  expect(m.docs.at(-1).liens).toEqual([{ de: "n1", vers: "n2" }]);
  expect(document.activeElement).toBe(m.champ("message"));
});
