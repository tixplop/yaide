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
