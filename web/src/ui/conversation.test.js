import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { conversation } from "./conversation.js";
import { indication } from "./indication.js";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const p of ["scrollHeight", "clientHeight", "scrollTop"]) delete HTMLElement.prototype[p];
});

const outil = (o = {}) => ({ type: "outil", id: "o1", nom: "bash", argument: "cargo test", etat: "echec", resultat: "FAILED", ...o });
const bouton = (c) => c.querySelector("button.ya-step");

test("REQ056_AC11_role_log_et_noms_vous_agent", () => {
  const c = conversation({
    entrees: [
      { type: "utilisateur", texte: "# pas du *markdown*" },
      { type: "agent", markdown: "Bonjour **toi**" },
      { type: "fin", texte: "Arrêté." },
      { type: "message", texte: "Interrompu : Yaide a été arrêté.", variante: "alerte" },
    ],
  });
  expect(c.getAttribute("role")).toBe("log");
  expect(c.getAttribute("aria-label")).toBe("Conversation");
  expect(c.tabIndex).toBe(0);
  const u = c.querySelector(".ya-chat-user");
  expect(u.textContent).toBe("Vous : # pas du *markdown*");
  expect(u.querySelector("strong")).toBeNull();
  const a = c.querySelector(".ya-chat-agent");
  expect(a.textContent.startsWith("Agent : ")).toBe(true);
  expect(a.querySelector("strong").textContent).toBe("toi");
  expect(c.querySelector(".ya-fin").textContent).toBe("Arrêté.");
  expect(c.querySelector(".message-alerte").textContent).toContain("Interrompu : Yaide a été arrêté.");
});

test("REQ056_AC5_AC11_appel_d_outil_nom_argument_etat_et_deplier", () => {
  const surDeplier = vi.fn();
  const c = conversation({ entrees: [outil({ argument: "cargo test" })], surDeplier });
  document.body.append(c);
  const b = bouton(c);
  expect(b.tagName).toBe("BUTTON");
  expect(b.getAttribute("aria-label")).toBe("bash cargo test, échec");
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(b.querySelector(".ya-step-arg").getAttribute("title")).toBe("cargo test");
  expect(b.querySelectorAll("svg").length).toBe(2);
  expect(b.querySelectorAll("svg[aria-hidden='true']").length).toBe(2);
  const zone = document.getElementById(b.getAttribute("aria-controls"));
  expect(zone.hidden).toBe(true);
  expect(zone.textContent).toBe("$ cargo test\nFAILED");

  b.click();
  expect(b.getAttribute("aria-expanded")).toBe("true");
  expect(zone.hidden).toBe(false);
  expect(surDeplier).toHaveBeenCalledWith("o1");
  b.click();
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(zone.hidden).toBe(true);
  // Entrée et Espace sur un <button> natif déclenchent un clic ; on vérifie qu'aucun gestionnaire de touche ne le double.
  b.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  b.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(surDeplier).toHaveBeenCalledTimes(2);
});

test("REQ056_AC5_noms_des_trois_etats_et_argument_sans_dollar_hors_bash", () => {
  const c = conversation({
    entrees: [
      outil({ id: "a", etat: "enCours", resultat: "" }),
      outil({ id: "b", nom: "read", argument: "src/args.rs", etat: "reussi", resultat: "ok" }),
    ],
  });
  const [b1, b2] = c.querySelectorAll("button.ya-step");
  expect(b1.getAttribute("aria-label")).toBe("bash cargo test, en cours");
  expect(c.querySelector("#" + b1.getAttribute("aria-controls")).textContent).toBe("$ cargo test\nEn cours…");
  expect(b2.getAttribute("aria-label")).toBe("read src/args.rs, réussi");
  expect(c.querySelector("#" + b2.getAttribute("aria-controls")).textContent).toBe("src/args.rs\nok");
});

test("REQ056_AC11_bash_code_non_nul_en_echec", () => {
  const c = conversation({
    entrees: [outil({ id: "a", etat: "echec" }), outil({ id: "b", etat: "reussi" }), outil({ id: "c", etat: "enCours" })],
  });
  const icones = [...c.querySelectorAll("button.ya-step")].map((b) => b.querySelector("svg").getAttribute("data-icone"));
  expect(icones).toEqual(["circle-x", "circle-check", "circle-dashed"]);
});

test("REQ055_AC11_l_agent_travaille_apres_200_ms_puis_disparait", () => {
  const c = conversation({ entrees: [{ type: "utilisateur", texte: "a" }], enAttente: true });
  const att = c.querySelector(".indication");
  expect(att.textContent).toBe("L'agent travaille…");
  expect(att.getAttribute("role")).toBe("status");
  expect(att.hidden).toBe(true);
  vi.advanceTimersByTime(200);
  expect(att.hidden).toBe(false);
  expect(c.lastElementChild).toBe(att);
  c.mettreAJour([{ type: "utilisateur", texte: "a" }, { type: "agent", markdown: "b" }], true);
  expect(c.lastElementChild).toBe(att);
  expect(c.children.length).toBe(3);
  c.mettreAJour([{ type: "utilisateur", texte: "a" }, { type: "agent", markdown: "b" }], false);
  expect(c.querySelector(".indication")).toBeNull();
});

test("REQ055_AC14_arrete_et_interrompu", () => {
  const c = conversation({
    entrees: [
      outil({ etat: "echec", resultat: "Arrêté" }),
      { type: "fin", texte: "Arrêté." },
      { type: "message", texte: "Interrompu : Yaide a été arrêté.", variante: "alerte" },
    ],
  });
  expect(c.querySelector("button.ya-step").getAttribute("aria-label")).toContain("échec");
  expect(c.querySelector(".ya-fin").textContent).toBe("Arrêté.");
  expect(c.querySelector("[role=alert]").textContent).toBe("Interrompu : Yaide a été arrêté.");
});

test("REQ029_AC3_image_distante_remplacee_par_son_texte", () => {
  const c = conversation({ entrees: [{ type: "agent", markdown: "Voir ![le schéma](https://exemple.test/a.png) ici" }] });
  expect(c.querySelector("img")).toBeNull();
  expect(c.innerHTML).not.toContain("exemple.test");
  expect(c.querySelector(".ya-chat-agent").textContent).toContain("Voir le schéma ici");
});

test("REQ056_AC16_mise_a_jour_garde_focus_et_depliage", () => {
  const c = conversation({ entrees: [{ type: "utilisateur", texte: "a" }, outil({ etat: "enCours", resultat: "" })] });
  document.body.append(c);
  const b = bouton(c);
  b.click();
  b.focus();
  expect(document.activeElement).toBe(b);
  c.mettreAJour(
    [{ type: "utilisateur", texte: "a" }, outil({ etat: "echec", resultat: "boum" }), { type: "agent", markdown: "fini" }],
    false,
  );
  expect(bouton(c)).toBe(b);
  expect(document.activeElement).toBe(b);
  expect(b.getAttribute("aria-expanded")).toBe("true");
  expect(b.getAttribute("aria-label")).toBe("bash cargo test, échec");
  expect(b.querySelector("svg").getAttribute("data-icone")).toBe("circle-x");
  expect(c.querySelector("#" + b.getAttribute("aria-controls")).textContent).toBe("$ cargo test\nboum");
  expect(c.querySelector(".ya-chat-agent").textContent).toContain("fini");
  expect(c.querySelectorAll(".ya-chat-user").length).toBe(1);
});

test("REQ056_AC16_rien_ne_prend_le_focus", () => {
  const c = conversation({ entrees: [outil()], enAttente: true });
  document.body.append(c);
  c.mettreAJour([outil(), { type: "agent", markdown: "x" }], true);
  expect(document.activeElement).toBe(document.body);
});

function simulerDefilement({ haut, hauteur, visible }) {
  let top = haut;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => hauteur.v });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => visible });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", { configurable: true, get: () => top, set: (v) => { top = v; } });
  return () => top;
}

test("REQ056_AC16_defile_seulement_s_il_etait_en_bas", () => {
  const hauteur = { v: 1000 };
  const haut = simulerDefilement({ haut: 0, hauteur, visible: 200 });
  const c = conversation({ entrees: [{ type: "agent", markdown: "a" }] });
  expect(haut()).toBe(1000); // en bas à la création

  // À 24 px près : encore en bas.
  hauteur.v = 1100;
  const t = simulerDefilement({ haut: 1100 - 200 - 24, hauteur, visible: 200 });
  c.mettreAJour([{ type: "agent", markdown: "a" }, { type: "agent", markdown: "b" }], false);
  expect(t()).toBe(1100);

  // Remonté de 25 px : rien ne bouge.
  hauteur.v = 1200;
  const t2 = simulerDefilement({ haut: 1100 - 200 - 25, hauteur, visible: 200 });
  const avant = t2();
  c.mettreAJour([{ type: "agent", markdown: "a" }, { type: "agent", markdown: "b" }, { type: "agent", markdown: "c" }], false);
  expect(t2()).toBe(avant);
});

test("REQ056_AC11_vide_affiche_indication_puis_disparait", () => {
  const vide = indication({ texte: "Aucun message" });
  const c = conversation({ entrees: [], vide });
  expect(c.textContent).toContain("Aucun message");
  c.mettreAJour([{ type: "utilisateur", texte: "a" }], false);
  expect(c.textContent).not.toContain("Aucun message");
});

const rel = { nom: "Relecteur", avatar: "R", couleur: "vert" };
const aut = { nom: "Auteur", avatar: "", couleur: "rose" };
const groupes = (c) => [...c.querySelectorAll("[role=group]")];

test("REQ067_AC16_groupe_par_tour_role_group_nom_et_filet", () => {
  const c = conversation({
    entrees: [
      { type: "agent", markdown: "a", auteur: rel },
      outil({ id: "o1", auteur: rel }),
      { type: "fin", texte: "Arrêté.", auteur: rel },
      { type: "agent", markdown: "b", auteur: aut },
    ],
  });
  const g = groupes(c);
  expect(g.length).toBe(2);
  expect(g[0].getAttribute("aria-label")).toBe("Relecteur");
  expect(g[0].querySelector(".ya-tour-tete").textContent).toBe("RRelecteur");
  expect(g[0].querySelector(".ya-tour-tete .ya-avatar")).not.toBeNull();
  const corps = g[0].querySelector(".ya-tour-corps");
  expect(corps.style.getPropertyValue("--c")).toBe("var(--agent-vert)");
  expect(corps.children.length).toBe(3);
  expect(corps.querySelector("button.ya-step")).not.toBeNull();
  expect(g[1].getAttribute("aria-label")).toBe("Auteur");
  expect(g[1].querySelector(".ya-tour-corps").style.getPropertyValue("--c")).toBe("var(--agent-rose)");
});

test("REQ067_AC6_nom_de_l_agent_dans_le_nom_accessible_de_la_reponse", () => {
  const c = conversation({ entrees: [{ type: "agent", markdown: "Bonjour", auteur: rel }] });
  const a = c.querySelector(".ya-chat-agent");
  expect(a.textContent.startsWith("Relecteur : ")).toBe(true);
  expect(a.textContent).not.toContain("Agent : ");
  expect(a.firstElementChild.className).toBe("ya-sr");
});

test("REQ067_AC16_nouveau_groupe_apres_un_message_de_l_utilisateur", () => {
  const c = conversation({
    entrees: [
      { type: "agent", markdown: "a", auteur: rel },
      { type: "utilisateur", texte: "encore" },
      { type: "agent", markdown: "b", auteur: rel },
    ],
  });
  expect(groupes(c).length).toBe(2);
  expect(c.children[1].className).toBe("ya-chat-user");
});

test("REQ067_AC17_travaille_dans_le_groupe_de_l_agent_puis_du_suivant", () => {
  const u = { type: "utilisateur", texte: "a" };
  const c = conversation({ entrees: [u], enAttente: rel });
  let g = groupes(c);
  expect(g.length).toBe(1);
  const att = g[0].querySelector(".indication");
  expect(att.textContent).toBe("Relecteur travaille…");
  expect(att.getAttribute("role")).toBe("status");
  expect(att.hidden).toBe(true);
  vi.advanceTimersByTime(200);
  expect(att.hidden).toBe(false);
  expect(g[0].querySelector(".ya-tour-corps").lastElementChild).toBe(att);

  const e1 = { type: "agent", markdown: "x", auteur: rel };
  c.mettreAJour([u, e1], rel);
  g = groupes(c);
  expect(g.length).toBe(1);
  expect(g[0].querySelector(".ya-tour-corps").children.length).toBe(2);
  expect(g[0].querySelector(".indication")).toBe(att);

  c.mettreAJour([u, e1], aut);
  g = groupes(c);
  expect(g.length).toBe(2);
  expect(g[0].querySelector(".indication")).toBeNull();
  expect(g[1].querySelector(".indication").textContent).toBe("Auteur travaille…");

  c.mettreAJour([u, e1, { type: "agent", markdown: "y", auteur: aut }], false);
  g = groupes(c);
  expect(g.length).toBe(2);
  expect(c.querySelector(".indication")).toBeNull();

  c.mettreAJour([u, e1, { type: "agent", markdown: "y", auteur: aut }], rel);
  expect(groupes(c).length).toBe(3);
  c.mettreAJour([u, e1, { type: "agent", markdown: "y", auteur: aut }], false);
  expect(groupes(c).length).toBe(2);
});

test("REQ067_message_d_erreur_hors_du_filet", () => {
  const c = conversation({
    entrees: [
      { type: "agent", markdown: "a", auteur: rel },
      { type: "message", texte: "Le provider a échoué.", variante: "alerte" },
    ],
  });
  const m = c.querySelector("[role=alert]");
  expect(m.closest(".ya-tour")).toBeNull();
  expect(m.parentElement).toBe(c);
  expect(groupes(c)[0].nextElementSibling.contains(m) || groupes(c)[0].nextElementSibling === m).toBe(true);
});

test("REQ067_mise_a_jour_garde_focus_et_groupe", () => {
  const c = conversation({ entrees: [{ type: "utilisateur", texte: "a" }, outil({ etat: "enCours", resultat: "", auteur: rel })] });
  document.body.append(c);
  const b = bouton(c);
  b.focus();
  const g0 = groupes(c)[0];
  c.mettreAJour(
    [{ type: "utilisateur", texte: "a" }, outil({ etat: "reussi", resultat: "ok", auteur: rel }), { type: "agent", markdown: "fini", auteur: rel }],
    false,
  );
  expect(bouton(c)).toBe(b);
  expect(document.activeElement).toBe(b);
  expect(b.getAttribute("aria-label")).toBe("bash cargo test, réussi");
  expect(groupes(c)).toEqual([g0]);
  expect(g0.querySelector(".ya-tour-corps").children.length).toBe(2);
  expect(g0.textContent).toContain("Relecteur : fini");
});

const sous = (o = {}) => ({ type: "sousAgent", id: "ses_f1", agent: "explore", titre: "Lister les appels de parse_args", etat: "enCours", ...o });

test("REQ072_AC22_ligne_sous_agent_role_noms_et_etats", () => {
  const ouvert = vi.fn();
  const c = conversation({
    entrees: [sous(), sous({ id: "s2", etat: "termine" }), sous({ id: "s3", agent: "general", etat: "echec" }), sous({ id: "s4", etat: "interrompu" })],
    surOuvrir: ouvert,
    nom: "opencode",
  });
  const lignes = [...c.querySelectorAll(".ya-sous")];
  expect(lignes.map((l) => l.getAttribute("role"))).toEqual(["group", "group", "group", "group"]);
  expect(lignes.map((l) => l.getAttribute("aria-label"))).toEqual([
    "Sous-agent explore, en cours",
    "Sous-agent explore, terminé",
    "Sous-agent general, échec",
    "Sous-agent explore, interrompu",
  ]);
  expect(lignes.map((l) => l.querySelector(".ya-sous-etat").textContent)).toEqual(["en cours", "terminé", "échec", "interrompu"]);
  expect(lignes.map((l) => l.querySelector("svg").getAttribute("data-icone"))).toEqual(["circle-dashed", "circle-check", "circle-x", "circle-minus"]);
  expect(lignes[1].querySelector("svg").getAttribute("class")).toContain("ok");
  expect(lignes[2].querySelector("svg").getAttribute("class")).toContain("ko");
  const ouvrir = lignes[0].querySelector("button");
  expect(ouvrir.getAttribute("aria-label")).toBe("Ouvrir explore");
  expect(ouvrir.textContent).toBe("Ouvrir");
  expect(ouvrir.className).toContain("bouton-secondaire");
  ouvrir.click();
  expect(ouvert).toHaveBeenCalledWith("ses_f1");
  // La ligne n'est pas un bouton : un seul bouton par ligne.
  expect(lignes[0].querySelectorAll("button")).toHaveLength(1);
});

test("REQ072_AC22_ouvrir_donne_la_session_fille_connue_apres_la_creation_de_la_ligne", () => {
  const ouvert = vi.fn();
  const c = conversation({ entrees: [sous({ id: undefined })], surOuvrir: ouvert });
  c.mettreAJour([sous({ id: "ses_f9" })]);
  c.querySelector(".ya-sous button").click();
  expect(ouvert).toHaveBeenCalledWith("ses_f9");
});

test("REQ072_AC22_sous_agent_change_d_etat_sur_place", () => {
  const c = conversation({ entrees: [sous()] });
  document.body.append(c);
  const ouvrir = c.querySelector(".ya-sous button");
  ouvrir.focus();
  c.mettreAJour([sous({ etat: "termine", titre: "Nouveau titre" })]);
  expect(c.querySelectorAll(".ya-sous")).toHaveLength(1);
  const l = c.querySelector(".ya-sous");
  expect(l.getAttribute("aria-label")).toBe("Sous-agent explore, terminé");
  expect(l.querySelector(".ya-sous-etat").textContent).toBe("terminé");
  expect(l.querySelector(".ya-sous-titre").title).toBe("Nouveau titre");
  expect(l.querySelector("svg").getAttribute("data-icone")).toBe("circle-check");
  expect(l.querySelector("svg").getAttribute("class")).toContain("ok");
  expect(document.activeElement).toBe(ouvrir);
});

test("REQ072_AC22_sous_agent_a_320_px_titre_retreci", () => {
  const long = "Mettre à jour le CHANGELOG pour la version 0.4.0";
  const c = conversation({ entrees: [sous({ titre: long })] });
  const l = c.querySelector(".ya-sous");
  const titre = l.querySelector(".ya-sous-titre");
  expect(titre.textContent).toBe(long);
  expect(titre.title).toBe(long);
  // Seul le titre rétrécit : les autres éléments ne rétrécissent pas, le titre est coupé par « … ».
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  const corps = (sel) => css.match(new RegExp(`${sel.replace(".", "\\.")}\\s*{([^}]*)}`))[1];
  expect(corps(".ya-sous-titre")).toMatch(/min-width:\s*0/);
  expect(corps(".ya-sous-titre")).toMatch(/text-overflow:\s*ellipsis/);
  expect(corps(".ya-sous-titre")).toMatch(/flex:\s*1\b/);
  for (const s of [".ya-sous-agent", ".ya-sous-etat"]) expect(corps(s)).toMatch(/flex:\s*none/);
  expect(corps(".ya-sous")).toMatch(/height:\s*var\(--size-control\)/);
});

test("REQ072_AC23_consigne_et_nom_lus", () => {
  const c = conversation({
    nom: "explore",
    entrees: [
      { type: "utilisateur", texte: "Cherche parse_args", consigne: true },
      { type: "utilisateur", texte: "Un message normal" },
      { type: "agent", markdown: "Trouvé." },
    ],
  });
  const [a, b] = c.querySelectorAll(".ya-chat-user");
  expect(a.textContent).toBe("Consigne : Cherche parse_args");
  expect(b.textContent).toBe("Vous : Un message normal");
  expect(c.querySelector(".ya-chat-agent").textContent.startsWith("explore : ")).toBe(true);
});

test("REQ072_AC20_opencode_travaille", () => {
  const c = conversation({ nom: "opencode", entrees: [{ type: "agent", markdown: "Salut" }], enAttente: true });
  vi.advanceTimersByTime(300);
  expect(c.querySelector(".ya-chat-agent").textContent.startsWith("opencode : ")).toBe(true);
  expect(c.querySelector(".indication").textContent).toBe("opencode travaille…");
  const e = conversation({ nom: "explore", enAttente: true });
  expect(e.querySelector(".indication").textContent).toBe("explore travaille…");
  expect(conversation({ enAttente: true }).querySelector(".indication").textContent).toBe("L'agent travaille…");
});
