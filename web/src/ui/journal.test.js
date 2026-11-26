import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { journal } from "./journal.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((x) => x.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};

const t0 = new Date(2026, 0, 5, 10, 21, 30).getTime();
const L = (numero, severite, message, detail) => ({ numero, heure: t0 + numero * 1000, severite, message, detail });
const TROIS = [L(0, "information", "Information"), L(1, "avertissement", "Avertissement"), L(2, "erreur", "Erreur")];

function monter(lignes = TROIS) {
  const purger = vi.fn();
  const j = journal({ lignes, purger });
  document.body.replaceChildren(j);
  return { j, purger, zone: j.querySelector(".ya-journal-zone"), liste: j.querySelector("select"), filtre: j.querySelector("input") };
}
const messages = (j) => [...j.querySelectorAll("tbody tr:not(.ya-journal-vide)")].map((tr) => tr.querySelector(".ya-journal-message span").textContent);
const saisir = (el, v) => {
  el.value = v;
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};
function metriques(zone, { scrollHeight, clientHeight }) {
  Object.defineProperty(zone, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(zone, "clientHeight", { configurable: true, value: clientHeight });
}

beforeEach(() => document.body.replaceChildren());

test("REQ188_AC4_trois_rangees_colonnes_ordre_et_detail_sous_le_message", () => {
  const { j } = monter([...TROIS, L(3, "erreur", "git a refusé", "fatal: pas de remote")]);
  expect([...j.querySelectorAll("th")].map((t) => t.textContent)).toEqual(["Heure", "Sévérité", "Message"]);
  expect(messages(j)).toEqual(["Information", "Avertissement", "Erreur", "git a refusé"]);
  const derniere = j.querySelectorAll("tbody tr")[3].querySelector(".ya-journal-message");
  expect(derniere.querySelector("span").textContent).toBe("git a refusé");
  expect(derniere.querySelector("pre").textContent).toBe("fatal: pas de remote");
  expect(j.querySelectorAll("tbody tr")[0].querySelector("pre")).toBeNull();
});

test("REQ188_AC5_filtres_severite_texte_combines_et_vides", () => {
  const { j, liste, filtre, zone } = monter([L(0, "erreur", "échec dans src/main.rs"), L(1, "erreur", "autre"), L(2, "information", "lu MAIN.RS", "x"), L(3, "avertissement", "w", "détail main.rs")]);
  saisir(liste, "erreur");
  expect(messages(j)).toEqual(["échec dans src/main.rs", "autre"]);
  saisir(liste, "toutes");
  saisir(filtre, "MAIN.RS");
  expect(messages(j)).toEqual(["échec dans src/main.rs", "lu MAIN.RS", "w"]);
  saisir(liste, "erreur");
  expect(messages(j)).toEqual(["échec dans src/main.rs"]);
  saisir(filtre, "zzz");
  expect([...j.querySelectorAll("thead th")].map((t) => t.textContent)).toEqual(["Heure", "Sévérité", "Message"]);
  expect(zone.querySelector("tbody").textContent).toBe("Aucun log ne correspond aux filtres.");
  expect(messages(j)).toEqual([]);
  const vide = monter([]);
  expect([...vide.j.querySelectorAll("thead th")].map((t) => t.textContent)).toEqual(["Heure", "Sévérité", "Message"]);
  expect(vide.zone.querySelector("tbody").textContent).toBe("Aucun log.");
});

test("REQ188_AC7_ligne_ajoutee_en_bas_suit_si_en_bas_sinon_ne_bouge_pas_et_sans_focus", () => {
  const { j, zone, filtre } = monter();
  filtre.focus();
  metriques(zone, { scrollHeight: 500, clientHeight: 100 });
  zone.scrollTop = 400;
  j.ajouter(L(5, "information", "nouvelle"));
  expect(messages(j).at(-1)).toBe("nouvelle");
  expect(zone.scrollTop).toBe(500);
  zone.scrollTop = 100;
  j.ajouter(L(6, "information", "encore"));
  expect(messages(j).at(-1)).toBe("encore");
  expect(zone.scrollTop).toBe(100);
  expect(document.activeElement).toBe(filtre);
  saisir(j.querySelector("select"), "erreur");
  j.ajouter(L(7, "information", "masquée"));
  expect(messages(j)).toEqual(["Erreur"]);
  // Depuis le vide, la première ligne apparaît.
  const v = monter([]);
  v.j.ajouter(L(0, "erreur", "première"));
  expect(messages(v.j)).toEqual(["première"]);
});

test("REQ188_AC9_AC11_table_en_tetes_noms_accessibles_ordre_de_tab_et_region", () => {
  const { j, zone } = monter();
  for (const th of j.querySelectorAll("th")) expect(th.getAttribute("scope")).toBe("col");
  const select = j.querySelector("select");
  const filtre = j.querySelector("input");
  expect(j.querySelector(`label[for="${select.id}"]`).textContent).toBe("Sévérité");
  expect(j.querySelector(`label[for="${filtre.id}"]`).textContent).toBe("Filtrer");
  expect(j.querySelector(`label[for="${filtre.id}"]`).classList.contains("masque")).toBe(true);
  expect(filtre.placeholder).toBe("Filtrer");
  expect([...select.options].map((o) => o.textContent)).toEqual(["Toutes", "Information", "Avertissement", "Erreur"]);
  expect(select.value).toBe("toutes");
  const arrets = [...j.querySelectorAll("select, input, button, [tabindex='0']")];
  expect(arrets[0]).toBe(select);
  expect(arrets[1]).toBe(filtre);
  expect(arrets[2].textContent).toBe("Purger les logs");
  expect(arrets[3]).toBe(zone);
  expect(zone.getAttribute("role")).toBe("region");
  expect(zone.getAttribute("aria-label")).toBe("Logs");
  expect(zone.tabIndex).toBe(0);
  expect(regle(".ya-journal-zone")).toContain("overflow-y: auto");
  expect(regle(".ya-journal-zone:focus-visible")).toContain("outline: var(--trait) solid var(--accent-fg)");
});

test("REQ188_AC11_heure_locale_et_bouton_purger_a_texte_visible", () => {
  const { j, purger } = monter([L(0, "information", "a")]);
  expect(j.querySelector(".ya-journal-heure").textContent).toBe("10:21:30");
  const b = j.querySelector("button");
  expect(b.textContent).toBe("Purger les logs");
  b.click();
  expect(purger).toHaveBeenCalledTimes(1);
  expect(() => journal({ lignes: [] })).toThrow(/purger/);
});

test("REQ188_AC10_mise_en_page_en_tetes_collés_message_long_mot_de_severite_et_contrastes", () => {
  const long = "x".repeat(300);
  const { j } = monter([L(0, "erreur", long), L(1, "avertissement", "w"), L(2, "information", "i")]);
  expect(j.querySelector("tbody tr .ya-journal-message span").textContent).toHaveLength(300);
  expect([...j.querySelectorAll(".ya-journal-sev span")].map((s) => s.textContent)).toEqual(["Erreur", "Avertissement", "Information"]);
  expect(j.querySelector(".ya-journal-sev svg").getAttribute("aria-hidden")).toBe("true");
  expect(regle(".ya-journal-zone")).toContain("overflow-x: hidden");
  expect(regle(".ya-journal-table")).toContain("table-layout: fixed");
  expect(regle(".ya-journal-table th")).toMatch(/position: sticky; top: 0/);
  expect(regle(".ya-journal-table td")).toContain("overflow-wrap: anywhere");
  expect(regle(".ya-journal-message pre")).toContain("white-space: pre-wrap");
  expect(regle(".ya-journal")).toContain("height: 100%");
  const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
  const lum = (hex) => {
    const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const debut of [':root, [data-theme="dark"]', '[data-theme="light"]']) {
    const i = tokens.indexOf(debut);
    const b = tokens.slice(i, tokens.indexOf("}", i));
    const val = (nom) => new RegExp(`${nom}:\\s*([^;]+);`).exec(b)[1].trim();
    for (const texte of ["--ink", "--ink-muted"]) {
      const [l1, l2] = [lum(val(texte)), lum(val("--bg-000"))].sort((p, q) => q - p);
      expect((l1 + 0.05) / (l2 + 0.05), `${debut} ${texte}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("REQ188_AC12_vide_prioritaire_focus_sur_purger_et_vue_en_bas_apres_filtre", () => {
  const { j, zone, liste, purger } = monter([]);
  saisir(liste, "erreur");
  expect(zone.querySelector("tbody").textContent).toBe("Aucun log.");
  expect(zone.querySelectorAll("th")).toHaveLength(3);
  const b = j.querySelector("button");
  b.focus();
  purger.mockImplementation(() => j.remplacer([]));
  b.click();
  expect(document.activeElement).toBe(b);
  const p = monter();
  metriques(p.zone, { scrollHeight: 800, clientHeight: 100 });
  p.zone.scrollTop = 0;
  saisir(p.liste, "toutes");
  expect(p.zone.scrollTop).toBe(800);
  p.zone.scrollTop = 0;
  saisir(p.filtre, "e");
  expect(p.zone.scrollTop).toBe(800);
});

test("REQ188_AC4_vue_en_bas_a_l_ouverture_une_fois_monte", () => {
  const rappels = [];
  vi.stubGlobal("requestAnimationFrame", (f) => rappels.push(f));
  try {
    const { j, zone } = monter();
    metriques(zone, { scrollHeight: 900, clientHeight: 100 });
    expect(zone.scrollTop).toBe(0);
    rappels.forEach((f) => f());
    expect(zone.scrollTop).toBe(900);
    zone.scrollTop = 0;
    j.descendre();
    expect(zone.scrollTop).toBe(900);
  } finally {
    vi.unstubAllGlobals();
  }
});
