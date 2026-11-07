import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { terminal } from "./terminal.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());
const jeton = (nom) => document.documentElement.style.getPropertyValue(nom).trim();

// jsdom n'a pas matchMedia, dont xterm a besoin.
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

HTMLCanvasElement.prototype.getContext = () => null;

class FauxFlux extends EventTarget {
  envoyes = [];
  send(d) {
    this.envoyes.push(d);
  }
  recevoir(d) {
    this.dispatchEvent(new MessageEvent("message", { data: d }));
  }
}

function monter(options = {}) {
  const flux = new FauxFlux();
  const t = terminal({ flux, nom: "Shell 1", ...options });
  document.body.append(t);
  return { flux, t };
}
const clavier = (t, init) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  t.querySelector("textarea").dispatchEvent(e);
  return e;
};

test("REQ019_AC4_ctrl_s_et_ctrl_p_sont_envoyes_au_shell", () => {
  const { flux, t } = monter();
  clavier(t, { key: "s", code: "KeyS", keyCode: 83, ctrlKey: true });
  clavier(t, { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true });
  expect(flux.envoyes).toEqual(["\x13", "\x10"]);
});

test("REQ019_AC7_ctrl_maj_f_n_envoie_rien_et_remonte_au_document", () => {
  const { flux, t } = monter();
  const vus = vi.fn();
  document.addEventListener("keydown", vus);
  const e = clavier(t, { key: "F", code: "KeyF", keyCode: 70, ctrlKey: true, shiftKey: true });
  document.removeEventListener("keydown", vus);
  expect(flux.envoyes).toEqual([]);
  expect(vus).toHaveBeenCalled();
  expect(e.defaultPrevented).toBe(false);
  // une simple lettre passe bien
  clavier(t, { key: "f", code: "KeyF", keyCode: 70 });
  t.term.input("x");
  expect(flux.envoyes).toContain("x");
});

test("REQ019_AC5_zone_nommee_shell_n_et_focus_programmatique", () => {
  const { t } = monter({ nom: "Shell 2" });
  expect(t.querySelector(".terminal-zone").getAttribute("aria-label")).toBe("Shell 2");
  t.focus();
  expect(document.activeElement).toBe(t.querySelector("textarea"));
});

test("REQ019_AC1_sortie_du_flux_affichee_et_frappe_envoyee", async () => {
  const { flux, t } = monter();
  expect(flux.binaryType).toBe("arraybuffer");
  flux.recevoir("bonjour");
  flux.recevoir(new TextEncoder().encode(" monde").buffer);
  await new Promise((r) => t.term.write("", r));
  const ligne = t.term.buffer.active.getLine(0).translateToString(true);
  expect(ligne).toBe("bonjour monde");
  t.term.input("ls\r");
  expect(flux.envoyes).toEqual(["ls\r"]);
});

const TABLE = {
  background: "--bg-000", foreground: "--ink", cursor: "--accent-fg", cursorAccent: "--bg-000", selectionBackground: "--selection",
  black: "--bg-400", brightBlack: "--ink-faint", red: "--git-deleted", brightRed: "--syn-string", green: "--git-added", brightGreen: "--syn-number",
  yellow: "--git-modified", brightYellow: "--syn-function", blue: "--accent-fg", brightBlue: "--syn-variable",
  magenta: "--git-conflict", brightMagenta: "--syn-control", cyan: "--git-untracked", brightCyan: "--syn-type", white: "--ink-muted", brightWhite: "--ink",
};

test("REQ036_AC5_theme_sorti_des_tokens_avec_tableau_ansi", () => {
  const { t } = monter();
  const th = t.term.options.theme;
  for (const [cle, token] of Object.entries(TABLE)) expect([cle, th[cle]]).toEqual([cle, jeton(token)]);
  expect(t.term.options.cursorBlink).toBe(false);
  expect(t.term.options.cursorStyle).toBe("block");
  expect(t.term.options.fontFamily).toBe(jeton("--font-mono"));
  expect(t.term.options.fontSize).toBe(12.5);
  expect(t.term.options.lineHeight).toBe(1);
});

test("REQ038_AC2_changer_de_theme_repose_le_theme_sans_toucher_a_l_affichage", async () => {
  const { flux, t } = monter();
  flux.recevoir("bonjour");
  await new Promise((r) => t.term.write("", r));
  const avant = t.term.options.theme.background;
  document.documentElement.style.setProperty("--bg-000", "#123456");
  document.dispatchEvent(new CustomEvent("yaide-theme", { detail: "light" }));
  expect(t.term.options.theme.background).toBe("#123456");
  expect(avant).not.toBe("#123456");
  expect(t.term.buffer.active.getLine(0).translateToString(true)).toBe("bonjour");
  t.detruire();
  const apres = t.term.options.theme;
  document.documentElement.style.setProperty("--bg-000", "#654321");
  document.dispatchEvent(new CustomEvent("yaide-theme", { detail: "dark" }));
  expect(t.term.options.theme).toBe(apres); // l'écouteur est retiré
  document.documentElement.style.setProperty("--bg-000", avant);
});

test("REQ036_AC12_la_mesure_attend_la_police_puis_se_refait", async () => {
  let charge;
  const ecoute = [];
  const fonts = { load: vi.fn(() => new Promise((r) => (charge = r))), addEventListener: (_, f) => ecoute.push(f) };
  Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
  try {
    const surTaille = vi.fn();
    const { t } = monter({ surTaille });
    expect(fonts.load).toHaveBeenCalledWith('12.5px "JetBrains Mono"');
    const zone = t.querySelector(".terminal-zone");
    Object.defineProperty(zone, "clientWidth", { value: 800 });
    Object.defineProperty(zone, "clientHeight", { value: 400 });
    const cellule = (width, height) => Object.assign(t.term._core._renderService.dimensions.css.cell, { width, height });
    cellule(8, 18);
    t.ajuster();
    expect(surTaille).not.toHaveBeenCalled(); // police pas encore là
    charge();
    await new Promise((r) => setTimeout(r));
    expect(surTaille).toHaveBeenCalledWith(100, 22);
    surTaille.mockClear();
    cellule(10, 18);
    ecoute[0](); // la police arrive plus tard : nouvelle mesure
    expect(surTaille).toHaveBeenCalledWith(80, 22);
  } finally {
    delete document.fonts;
  }
});

test("REQ019_AC6_attente_visible_et_saisie_coupee_hors_connexion", () => {
  const { flux, t } = monter({ connecte: false });
  const att = t.querySelector(".terminal-attente");
  expect(att.textContent).toBe("(en attente de la connexion)");
  expect(att.hidden).toBe(false);
  expect(t.term.options.disableStdin).toBe(true);
  t.term.input("a");
  expect(flux.envoyes).toEqual([]);
  t.definirConnecte(true);
  expect(att.hidden).toBe(true);
  expect(t.term.options.disableStdin).toBe(false);
});

test("REQ019_AC1_flux_requis", () => {
  expect(() => terminal({})).toThrow("flux requis");
  expect(() => terminal({ flux: new FauxFlux() })).toThrow("nom requis");
});

test("REQ028_AC7_focus_du_terminal_a_contour_accent", () => {
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  expect(css).toMatch(/\.terminal-zone:focus-within\s*{[^}]*outline:\s*var\(--trait\) solid var\(--accent-fg\)/);
});

test("REQ033_AC8_fond_de_la_zone_des_shells", () => {
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  expect(css).toMatch(/\.terminal-zone\s*{[^}]*background:\s*var\(--bg-000\)/);
  expect(css).toMatch(/\.terminal\s*{[^}]*background:\s*var\(--bg-000\)/);
});

test("REQ032_AC3_ajustement_au_plus_toutes_les_100_ms_puis_un_dernier", () => {
  vi.useFakeTimers();
  let rappel;
  vi.stubGlobal("ResizeObserver", class { constructor(f) { rappel = f; } observe() {} disconnect() {} });
  try {
    const { t } = monter();
    t.ajuster = vi.fn();
    for (let i = 0; i < 5; i++) rappel();
    expect(t.ajuster).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(99);
    rappel();
    expect(t.ajuster).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(t.ajuster).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(t.ajuster).toHaveBeenCalledTimes(2);
    rappel();
    expect(t.ajuster).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

test("REQ032_AC3_la_nouvelle_taille_est_transmise_au_shell", () => {
  const surTaille = vi.fn();
  const { t } = monter({ surTaille });
  t.term.resize(100, 30);
  expect(surTaille).toHaveBeenCalledWith(100, 30);
});

test("REQ068_AC14_terminal_aria_label_du_nom_et_contour_au_focus", () => {
  const { t } = monter({ nom: "Claude 1" });
  expect(t.querySelector(".terminal-zone").getAttribute("aria-label")).toBe("Claude 1");
  const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
  expect(css).toMatch(/\.terminal-zone:focus-within\s*\{[^}]*outline: var\(--trait\) solid var\(--accent-fg\)/);
});

test("REQ068_AC15_terminal_arrete_n_envoie_plus_rien", async () => {
  const { flux, t } = monter({ nom: "Claude 1" });
  flux.recevoir("dernière sortie");
  t.term.input("a");
  expect(flux.envoyes).toEqual(["a"]);
  await new Promise((r) => t.term.write("", r));
  t.definirArrete({ code: 1 });
  expect(t.term.options.disableStdin).toBe(true);
  expect(t.term.options.cursorBlink).toBe(false);
  expect(t.querySelector(".terminal-zone").classList.contains("terminal-arrete")).toBe(true);
  t.term.input("b");
  expect(flux.envoyes).toEqual(["a"]);
  await new Promise((r) => t.term.write("", r));
  // L'affichage est gardé.
  expect(t.term.buffer.active.getLine(0).translateToString(true)).toContain("dernière sortie");
  // Une reconnexion ne rouvre pas la saisie.
  t.definirConnecte(true);
  expect(t.term.options.disableStdin).toBe(true);
});

test("REQ068_AC15_terminal_arrete_des_la_creation", () => {
  const { t } = monter({ arrete: { code: 2 } });
  expect(t.term.options.disableStdin).toBe(true);
});
