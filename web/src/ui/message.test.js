import { expect, test } from "vitest";
import { message } from "./message.js";
import { bouton } from "./bouton.js";

test("REQ028_AC3_message_roles_selon_variante", () => {
  expect(message({ texte: "a" }).getAttribute("role")).toBe("status");
  expect(message({ texte: "a", variante: "succes" }).getAttribute("role")).toBe("status");
  expect(message({ texte: "a", variante: "alerte" }).getAttribute("role")).toBe("alert");
  const e = message({ texte: "Échec", variante: "erreur" });
  expect(e.getAttribute("role")).toBe("alert");
  expect(e.classList.contains("message-erreur")).toBe(true);
  expect(e.textContent).toContain("Échec");
});

test("REQ028_AC3_message_detail_actions_et_fermeture", () => {
  const m = message({ texte: "Q ?", variante: "alerte", detail: "sortie brute", actions: [bouton({ libelle: "Oui" })], fermable: true });
  document.body.append(m);
  expect(m.querySelector(".message-detail").textContent).toBe("sortie brute");
  expect(m.querySelector(".message-actions button").textContent).toBe("Oui");
  const f = m.querySelector("button[aria-label='Fermer']");
  expect(f.textContent).toBe("");
  expect(f.querySelector("svg").getAttribute("data-icone")).toBe("x");
  expect(f.hasAttribute("title")).toBe(false);
  f.click();
  expect(document.body.contains(m)).toBe(false);
});

test("REQ028_AC3_message_fort_sans_action", () => {
  const m = message({ texte: "Coupure", variante: "alerte", fort: true, actions: [bouton({ libelle: "Oui" })], fermable: true });
  expect(m.classList.contains("message-fort")).toBe(true);
  expect(m.querySelector("button")).toBeNull();
});

test("REQ028_AC3_message_sans_detail_et_variante_inconnue", () => {
  expect(message({ texte: "a" }).querySelector(".message-detail")).toBeNull();
  expect(() => message({ texte: "a", variante: "x" })).toThrow(/variante/);
  expect(() => message({ texte: "" })).toThrow(/texte/);
});
