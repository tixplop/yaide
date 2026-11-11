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

const AGENT = (markdown) => ({ type: "agent", markdown });

test("REQ077_AC4_liens_partout_conversation", () => {
  const c = conversation({ entrees: [AGENT("[doc](https://exemple.org/a)")] });
  expect(c.querySelector(".ya-chat-agent a").target).toBe("_blank");
});

test("REQ077_AC8_AC17_lien_garde_le_focus_pendant_l_arrivee", () => {
  const c = conversation({ entrees: [AGENT("Voir [doc](https://exemple.org/a)")] });
  document.body.append(c);
  c.querySelector("a").focus();
  c.mettreAJour([AGENT("Voir [doc](https://exemple.org/a) et la suite")]);
  expect(document.activeElement.tagName).toBe("A");
  expect(document.activeElement.getAttribute("href")).toBe("https://exemple.org/a");
  expect(document.activeElement.textContent).toBe("doc");
  expect(c.contains(document.activeElement)).toBe(true);
});

test("REQ077_AC17_lien_disparu_focus_sur_la_conversation", () => {
  const c = conversation({ entrees: [AGENT("Voir [doc](https://exemple.org/a)")] });
  document.body.append(c);
  c.querySelector("a").focus();
  c.mettreAJour([AGENT("Autre texte")]);
  expect(document.activeElement).toBe(c);
});

test("REQ077_AC8_focus_ailleurs_ne_bouge_pas", () => {
  const c = conversation({ entrees: [AGENT("Voir [doc](https://exemple.org/a)")] });
  const champ = document.createElement("input");
  document.body.append(c, champ);
  champ.focus();
  c.mettreAJour([AGENT("Voir [doc](https://exemple.org/a) suite")]);
  expect(document.activeElement).toBe(champ);
});

test("REQ077_AC18_bloc_coupe_reste_un_pre_et_message_hors_du_pre", () => {
  const c = conversation({ entrees: [AGENT("```rust\nfn main() {"), { type: "fin", texte: "Arrêté." }] });
  const pre = c.querySelector(".ya-chat-agent pre");
  expect(pre.textContent).toContain("fn main() {");
  const fin = c.querySelector(".ya-fin");
  expect(fin.textContent).toBe("Arrêté.");
  expect(pre.contains(fin)).toBe(false);
});

test("REQ077_AC19_message_utilisateur_tel_quel", () => {
  const c = conversation({ entrees: [{ type: "utilisateur", texte: "**mot** | a | b |" }] });
  const u = c.querySelector(".ya-chat-user");
  expect(u.querySelector("strong")).toBeNull();
  expect(u.querySelector("table")).toBeNull();
  expect(u.textContent).toBe("Vous : **mot** | a | b |");
});

test("REQ077_AC20_elements_natifs_sans_role_ni_tabindex", () => {
  const md = "| a |\n|---|\n| b |\n\n> c\n\n- d\n\n1. e\n\n---\n\n```\nf\n```";
  const c = conversation({ entrees: [AGENT(md)] });
  const a = c.querySelector(".ya-chat-agent");
  for (const s of ["table", "th", "td", "blockquote", "ul", "ol", "li", "hr", "pre"]) {
    const el = a.querySelector(s);
    expect(el, s).not.toBeNull();
    expect(el.hasAttribute("role"), s).toBe(false);
    expect(el.hasAttribute("tabindex"), s).toBe(false);
  }
});

const raison = (o = {}) => ({ type: "raisonnement", id: "r1", markdown: "Je lis **README**.", ...o });
const bRaison = (c) => c.querySelector("button.ya-raison");

test("REQ084_AC6_REQ085_AC8_raisonnement_replie_deplie_au_clic_entree_espace_focus_gardé", () => {
  const surDeplier = vi.fn();
  const c = conversation({ entrees: [raison()], surDeplier });
  document.body.append(c);
  const b = bRaison(c);
  const zone = c.querySelector(".ya-raison-zone");
  expect(b.textContent).toBe("Raisonnement");
  expect(b.querySelector("svg").getAttribute("data-icone")).toBe("brain");
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(b.getAttribute("aria-controls")).toBe(zone.id);
  expect(zone.hidden).toBe(true);
  expect(zone.classList.contains("ya-chat-agent")).toBe(true);
  expect(zone.querySelector("strong").textContent).toBe("README");
  b.focus();
  b.click();
  expect(b.getAttribute("aria-expanded")).toBe("true");
  expect(zone.hidden).toBe(false);
  expect(surDeplier).toHaveBeenCalledWith("r1");
  expect(document.activeElement).toBe(b);
  b.click();
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(zone.hidden).toBe(true);
  expect(document.activeElement).toBe(b);
  // Entrée et Espace sur un <button> natif produisent un clic : le bouton est natif et de type button.
  expect(b.tagName).toBe("BUTTON");
  expect(b.type).toBe("button");
});

test("REQ084_AC7_nouveau_rendu_garde_l_etat_deplie_le_focus_et_celui_d_un_lien", () => {
  const c = conversation({ entrees: [raison({ markdown: "voir [a](https://x.test/a)" })] });
  document.body.append(c);
  let b = bRaison(c);
  b.click();
  c.mettreAJour([raison({ markdown: "voir [a](https://x.test/a) puis plus" })]);
  expect(bRaison(c)).toBe(b);
  expect(b.getAttribute("aria-expanded")).toBe("true");
  expect(c.querySelector(".ya-raison-zone").textContent).toContain("puis plus");
  b.focus();
  c.mettreAJour([raison({ markdown: "voir [a](https://x.test/a) puis plus encore" })]);
  expect(document.activeElement).toBe(b);
  c.querySelector(".ya-raison-zone a").focus();
  c.mettreAJour([raison({ markdown: "voir [a](https://x.test/a) puis plus encore et encore" })]);
  expect(document.activeElement).toBe(c.querySelector(".ya-raison-zone a"));
});

test("REQ084_AC7_une_etape_qui_arrive_ne_change_ni_l_etat_ni_le_focus_du_raisonnement", () => {
  const c = conversation({ entrees: [raison()] });
  document.body.append(c);
  const b = bRaison(c);
  b.click();
  b.focus();
  c.mettreAJour([raison(), outil()]);
  expect(bRaison(c)).toBe(b);
  expect(b.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(b);
  expect(c.querySelector(".ya-raison-zone").textContent.startsWith("Agent")).toBe(false);
});

test("REQ084_AC6_raisonnement_vide_n_affiche_rien_et_le_focus_va_sur_la_conversation", () => {
  const c = conversation({ entrees: [raison({ markdown: " \n " }), { type: "agent", markdown: "fin" }] });
  document.body.append(c);
  expect(bRaison(c)).toBeNull();
  expect(c.querySelector(".ya-raison-zone")).toBeNull();
  const vide = c.firstElementChild;
  expect(vide.hidden).toBe(true);
  expect(vide.classList.contains("ya-steps")).toBe(false);
  expect(readFileSync("web/src/ui/composants.css", "utf8")).toMatch(/\.ya-steps\[hidden\] \{ display: none; \}/);
  c.mettreAJour([raison({ markdown: "idée" }), { type: "agent", markdown: "fin" }]);
  expect(bRaison(c)).not.toBeNull();
  bRaison(c).focus();
  c.mettreAJour([raison({ markdown: "  " }), { type: "agent", markdown: "fin" }]);
  expect(bRaison(c)).toBeNull();
  expect(document.activeElement).toBe(c);
});

test("REQ085_AC8_ordre_de_tab_bouton_dans_le_fil_puis_liens_de_la_zone_depliee", () => {
  const c = conversation({
    entrees: [outil(), raison({ markdown: "[l1](https://x.test/1) [l2](https://x.test/2)" }), { type: "agent", markdown: "[l3](https://x.test/3)" }],
  });
  document.body.append(c);
  bRaison(c).click();
  const noeuds = [...c.querySelectorAll("button, a[href]")];
  expect(noeuds.map((n) => n.tagName + n.textContent.slice(0, 5))).toEqual(["BUTTONbashc", "BUTTONRaiso", "Al1", "Al2", "Al3"]);
  expect(noeuds.every((n) => n.tabIndex >= 0)).toBe(true);
});

test("REQ085_AC8_dans_un_groupe_d_agent_le_raisonnement_longe_le_filet_de_2px", () => {
  const c = conversation({ entrees: [raison({ auteur: rel }), outil({ auteur: rel }), { type: "agent", markdown: "x", auteur: rel }] });
  const corps = c.querySelector("[role=group] .ya-tour-corps");
  expect(corps.firstElementChild.querySelector("button.ya-raison")).not.toBeNull();
  expect(c.querySelectorAll("[role=group]").length).toBe(1);
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  expect(css).toMatch(/\.ya-tour-corps \{[^}]*border-left: 2px solid var\(--c\)/);
  expect(css).toMatch(/\.ya-tour-corps > \.ya-steps \+ \.ya-steps \{ margin-top: -10px; \}/);
  expect(corps.children[0].className).toBe("ya-steps");
  expect(corps.children[1].className).toBe("ya-steps");
});

const FICHIER = (ouvrir) => {
  const c = conversation({ entrees: [AGENT("Voir [le code](src/main.rs:3) ici")], surOuvrirFichier: ouvrir });
  document.body.append(c);
  return c;
};

test("REQ087_AC8_AC9_clic_et_modificateurs_ouvrent_sans_suivre_le_lien", () => {
  const ouvrir = vi.fn();
  const a = FICHIER(ouvrir).querySelector("a.ya-fichier");
  for (const init of [{}, { ctrlKey: true }, { shiftKey: true }]) {
    const e = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
    a.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  }
  expect(ouvrir).toHaveBeenCalledTimes(3);
  expect(ouvrir).toHaveBeenLastCalledWith({ chemin: "src/main.rs", ligne: 3 });
});

test("REQ087_AC10_clic_du_milieu_et_lien_sans_ligne", () => {
  const ouvrir = vi.fn();
  const c = conversation({ entrees: [AGENT("[x](src/a.rs)")], surOuvrirFichier: ouvrir });
  document.body.append(c);
  const droit = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 });
  c.querySelector("a").dispatchEvent(droit);
  expect(droit.defaultPrevented).toBe(false);
  expect(ouvrir).not.toHaveBeenCalled();
  const e = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
  c.querySelector("a").dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(ouvrir).toHaveBeenCalledWith({ chemin: "src/a.rs", ligne: undefined });
});

test("REQ087_AC8_lien_web_non_intercepte_et_tab_atteint_le_lien_fichier", () => {
  const ouvrir = vi.fn();
  const c = conversation({ entrees: [AGENT("[w](https://exemple.org/a) et [f](src/a.rs)")], surOuvrirFichier: ouvrir });
  document.body.append(c);
  const [w, f] = c.querySelectorAll("a");
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  w.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
  expect(ouvrir).not.toHaveBeenCalled();
  expect(f.tabIndex).toBe(0);
  expect([...c.querySelectorAll("a[href]")]).toContain(f);
  f.click(); // Entrée sur un lien déclenche ce click natif
  expect(ouvrir).toHaveBeenCalledTimes(1);
});

test("REQ087_AC9_focus_garde_sur_un_lien_fichier_pendant_l_arrivee", () => {
  const c = FICHIER(vi.fn());
  c.querySelector("a").focus();
  c.mettreAJour([AGENT("Voir [le code](src/main.rs:3) ici et la suite")]);
  expect(document.activeElement.classList.contains("ya-fichier")).toBe(true);
  expect(document.activeElement.textContent).toBe("le code");
});

test("REQ095_AC13_outil_mcp_serveur_nom_arguments_et_zone", () => {
  const c = conversation({
    entrees: [outil({ id: "m1", serveur: "echo", nom: "dire", argument: '{"texte":"bonjour"}', etat: "reussi", resultat: "bonjour" })],
  });
  document.body.append(c);
  const b = bouton(c);
  expect(b.querySelector(".ya-step-serveur").textContent).toBe("echo");
  expect(b.querySelector(".ya-step-sep").textContent).toBe("›");
  expect(b.querySelector(".ya-step-outil").textContent).toBe("dire");
  expect(b.querySelector(".ya-step-arg").textContent).toBe('{"texte":"bonjour"}');
  expect(b.getAttribute("aria-label")).toBe('echo dire {"texte":"bonjour"}, réussi');
  expect(b.title).toBe('echo › dire {"texte":"bonjour"}');
  expect(b.querySelector(".ya-step-arg").title).toBe("");
  expect(b.querySelectorAll("svg").length).toBe(2);
  expect(b.querySelector("svg").getAttribute("class")).toContain("ok");
  const zone = document.getElementById(b.getAttribute("aria-controls"));
  expect(zone.hidden).toBe(true);
  expect(zone.textContent).toBe('{\n  "texte": "bonjour"\n}bonjour');
  expect(zone.querySelector(".ya-step-mcp-res").textContent).toBe("bonjour");
  b.focus();
  b.click();
  expect(b.getAttribute("aria-expanded")).toBe("true");
  expect(zone.hidden).toBe(false);
  expect(document.activeElement).toBe(b);
  expect(c.textContent).not.toContain("mcp__");
});

test("REQ095_AC13_arguments_vides_et_echec", () => {
  const c = conversation({ entrees: [outil({ serveur: "echo", nom: "dire", argument: "{}", etat: "echec", resultat: "boum" })] });
  const b = bouton(c);
  expect(b.querySelector(".ya-step-arg").textContent).toBe("");
  expect(b.getAttribute("aria-label")).toBe("echo dire, échec");
  expect(b.querySelector("svg").getAttribute("class")).toContain("ko");
});

test("REQ095_AC14_alerte_sans_croix_role_alert_detail_sans_focus", () => {
  const c = conversation({
    entrees: [{ type: "message", variante: "alerte", texte: "Le serveur MCP docs n'a pas démarré : la commande mcp-docs est introuvable.", detail: "/p/.yaide/mcp.json" }],
  });
  document.body.append(c);
  const m = c.querySelector(".message-alerte");
  expect(m.getAttribute("role")).toBe("alert");
  expect(m.querySelector("button")).toBeNull();
  expect(m.querySelector(".message-detail").textContent).toBe("/p/.yaide/mcp.json");
  expect(c.contains(document.activeElement) && document.activeElement !== document.body).toBe(false);
});

test("REQ095_AC13_outil_mcp_en_cours_puis_reussi", () => {
  const e = { serveur: "echo", nom: "dire", argument: '{"a":1}', id: "m2" };
  const c = conversation({ entrees: [outil({ ...e, etat: "enCours", resultat: "" })] });
  document.body.append(c);
  const b = bouton(c);
  expect(b.querySelector("svg").getAttribute("data-icone")).toBe("circle-dashed");
  expect(b.getAttribute("aria-label")).toBe('echo dire {"a":1}, en cours');
  const zone = document.getElementById(b.getAttribute("aria-controls"));
  expect(zone.querySelector(".ya-step-mcp-res").textContent).toBe("En cours…");
  c.mettreAJour([outil({ ...e, etat: "reussi", resultat: "fait" })]);
  expect(b.querySelector("svg").getAttribute("class")).toContain("ok");
  expect(b.getAttribute("aria-label")).toBe('echo dire {"a":1}, réussi');
  expect(zone.querySelector(".ya-step-mcp-res").textContent).toBe("fait");
});
