import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { indication } from "./indication.js";
import { bouton } from "./bouton.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("REQ028_AC3_indication_vide_avec_action", () => {
  const i = indication({ texte: "Aucun fichier", action: bouton({ libelle: "Créer" }) });
  expect(i.getAttribute("role")).toBe("status");
  expect(i.textContent).toContain("Aucun fichier");
  expect(i.querySelector("button").textContent).toBe("Créer");
  expect(i.hidden).toBe(false);
  expect(i.hasAttribute("aria-busy")).toBe(false);
});

test("REQ028_AC3_indication_chargement_apparait_apres_200_ms", () => {
  const i = indication({ texte: "Chargement…", variante: "chargement" });
  expect(i.hidden).toBe(true);
  expect(i.getAttribute("aria-busy")).toBe("true");
  vi.advanceTimersByTime(199);
  expect(i.hidden).toBe(true);
  vi.advanceTimersByTime(1);
  expect(i.hidden).toBe(false);
});

test("REQ028_AC3_indication_variante_inconnue_refusee", () => {
  expect(() => indication({ texte: "a", variante: "x" })).toThrow(/variante/);
  expect(() => indication({ texte: "" })).toThrow(/texte/);
});
