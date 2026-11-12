import { test, expect, vi } from "vitest";
import { apercuHtml } from "./apercu-html.js";

const attendre = () => new Promise((r) => setTimeout(r, 0));
const creer = (adresse = async () => "/apercu/j/index.html") => {
  const f = apercuHtml({ adresse });
  document.body.append(f);
  return f;
};

test("REQ058_AC8_attributs_du_cadre", async () => {
  const f = creer();
  expect(f.tagName).toBe("IFRAME");
  expect(f.className).toBe("zone-code-cadre");
  expect(f.title).toBe("Aperçu");
  expect(f.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
  expect(f.hasAttribute("srcdoc")).toBe(false);
  await attendre();
  expect(f.getAttribute("src")).toBe("/apercu/j/index.html");
  f.retirer();
});

test("REQ058_AC1_recharge_apres_sauvegarde_pas_pendant_la_frappe_ni_la_coupure", async () => {
  let n = 0;
  const f = creer(async () => `/apercu/j/index.html?${++n}`);
  await attendre();
  expect(f.getAttribute("src")).toBe("/apercu/j/index.html?1");
  f.maj("<p>tape");
  await attendre();
  expect(f.getAttribute("src")).toBe("/apercu/j/index.html?1");
  f.recharger();
  await attendre();
  expect(f.getAttribute("src")).toBe("/apercu/j/index.html?2");
  f.definirCoupe(true);
  f.recharger();
  await attendre();
  expect(f.getAttribute("src")).toBe("/apercu/j/index.html?2");
  f.definirCoupe(false);
  await attendre();
  expect(f.getAttribute("src")).toBe("/apercu/j/index.html?3");
  f.retirer();
});

test("REQ058_AC9_AC14_position_renvoyee_apres_le_chargement_message_etranger_ignore", async () => {
  const f = creer();
  await attendre();
  const envoi = vi.fn();
  Object.defineProperty(f, "contentWindow", { value: { postMessage: envoi }, configurable: true });
  window.dispatchEvent(new MessageEvent("message", { data: { yaide: "defilement", x: 3, y: 40 }, source: f.contentWindow }));
  window.dispatchEvent(new MessageEvent("message", { data: { yaide: "defilement", x: 9, y: 99 }, source: window }));
  f.dispatchEvent(new Event("load"));
  expect(envoi).toHaveBeenCalledWith({ yaide: "defiler", x: 3, y: 40 }, "*");
  f.retirer();
  window.dispatchEvent(new MessageEvent("message", { data: { yaide: "defilement", x: 5, y: 5 }, source: f.contentWindow }));
  f.dispatchEvent(new Event("load"));
  expect(envoi).toHaveBeenLastCalledWith({ yaide: "defiler", x: 3, y: 40 }, "*");
});
