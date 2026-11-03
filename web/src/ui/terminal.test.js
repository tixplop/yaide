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
  const t = terminal({ flux, numero: 1, ...options });
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
  const { t } = monter({ numero: 2 });
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

test("REQ028_AC3_theme_sorti_des_tokens_avec_tableau_ansi", () => {
  const { t } = monter();
  const th = t.term.options.theme;
  expect(th.background).toBe(jeton("--fond-shells"));
  expect(th.foreground).toBe(jeton("--texte"));
  expect(th.selectionBackground).toBe(jeton("--selection"));
  expect([th.black, th.brightBlack]).toEqual([jeton("--bordure"), jeton("--bordure-champ")]);
  expect([th.red, th.green, th.yellow, th.blue, th.magenta, th.cyan, th.white]).toEqual(
    ["--erreur", "--succes", "--alerte", "--accent", "--code-mot-cle", "--code-fonction", "--texte-attenue"].map(jeton),
  );
  expect([th.brightRed, th.brightGreen, th.brightYellow, th.brightBlue, th.brightMagenta, th.brightCyan, th.brightWhite]).toEqual(
    ["--erreur", "--succes", "--alerte", "--accent", "--code-mot-cle", "--code-fonction", "--texte"].map(jeton),
  );
  expect(t.term.options.cursorBlink).toBe(false);
  expect(t.term.options.fontFamily).toBe(jeton("--police-code"));
  expect(t.term.options.fontSize).toBe(14);
  expect(t.term.options.lineHeight).toBeCloseTo(20 / 14);
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
});

test("REQ028_AC7_focus_du_terminal_a_contour_accent", () => {
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  expect(css).toMatch(/\.terminal-zone:focus-within\s*{[^}]*outline:\s*var\(--trait\) solid var\(--accent-fg\)/);
});

test("REQ033_AC8_fond_de_la_zone_des_shells", () => {
  const css = readFileSync("web/src/ui/composants.css", "utf8");
  expect(css).toMatch(/\.terminal-zone\s*{[^}]*background:\s*var\(--fond-shells\)/);
  expect(css).toMatch(/\.terminal\s*{[^}]*background:\s*var\(--fond-shells\)/);
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
