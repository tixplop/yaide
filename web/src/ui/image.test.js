import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { image } from "./image.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
function regle(sel) {
  const re = new RegExp(`(?:^|\\})\\s*${sel.replace(/[.[\]()]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1]).join(";");
}

let sondes;
const ImageOrigine = globalThis.Image;
beforeEach(() => {
  vi.useFakeTimers();
  sondes = [];
  globalThis.Image = class {
    constructor() {
      sondes.push(this);
    }
  };
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.Image = ImageOrigine;
});
const charge = (s) => s.onload();
const echoue = (s) => s.onerror();
const monter = (z) => document.body.append(z.element) || z;

test("REQ120_AC1_etat_chargement_rien_avant_200_ms_puis_message_une_seule_fois", () => {
  const z = image({ src: "/a.png", nom: "logo.png" });
  const msg = () => z.element.querySelector(".indication");
  expect(z.element.querySelector("img")).toBeNull();
  vi.advanceTimersByTime(199);
  expect(!msg() || msg().hidden).toBe(true);
  vi.advanceTimersByTime(1);
  expect(msg().hidden).toBe(false);
  expect(msg().textContent).toBe("Chargement…");
  expect(msg().getAttribute("role")).toBe("status");
  charge(sondes[0]);
  expect(z.element.querySelector(".indication")).toBeNull();
  expect(z.element.querySelector("img").getAttribute("src")).toBe("/a.png");
  z.changerSource("/b.png");
  vi.advanceTimersByTime(1000);
  expect(z.element.querySelector(".indication")).toBeNull();
});

test("REQ120_AC1_chargement_charge_avant_200_ms_aucun_message", () => {
  const z = image({ src: "/a.png", nom: "logo.png" });
  vi.advanceTimersByTime(100);
  charge(sondes[0]);
  vi.advanceTimersByTime(1000);
  expect(z.element.textContent).toBe("");
});

test("REQ120_AC14_rechargement_garde_l_ancienne_jusqu_au_load", () => {
  const z = image({ src: "/a.png", nom: "logo.png" });
  charge(sondes[0]);
  z.changerSource("/b.png");
  expect(sondes[1].src).toBe("/b.png");
  expect(z.element.querySelector("img").getAttribute("src")).toBe("/a.png");
  vi.advanceTimersByTime(1000);
  expect(z.element.querySelector(".indication")).toBeNull();
  charge(sondes[1]);
  expect(z.element.querySelectorAll("img").length).toBe(1);
  expect(z.element.querySelector("img").getAttribute("src")).toBe("/b.png");
});

test("REQ120_AC14_reponse_ancienne_ignoree", () => {
  const z = image({ src: "/a.png", nom: "logo.png" });
  charge(sondes[0]);
  z.changerSource("/b.png");
  z.changerSource("/c.png");
  charge(sondes[1]);
  expect(z.element.querySelector("img").getAttribute("src")).toBe("/a.png");
  charge(sondes[2]);
  expect(z.element.querySelector("img").getAttribute("src")).toBe("/c.png");
});

test("REQ120_AC7_illisible_en_onglet_message_et_retour_a_l_image", () => {
  const z = image({ src: "/casse.png", nom: "casse.png" });
  echoue(sondes[0]);
  const msg = z.element.querySelector(".indication");
  expect(msg.textContent).toBe("casse.png ne peut pas être affiché.");
  expect(msg.getAttribute("role")).toBe("status");
  expect(msg.hidden).toBe(false);
  expect(z.element.querySelector("img")).toBeNull();
  z.changerSource("/ok.png");
  charge(sondes[1]);
  expect(z.element.querySelector(".indication")).toBeNull();
  expect(z.element.querySelector("img")).not.toBeNull();
});

test("REQ121_AC3_illisible_en_apercu_le_dernier_dessin_reste_sans_texte", () => {
  const z = image({ src: "/a.svg", nom: "logo.svg", zone: "apercu" });
  charge(sondes[0]);
  z.changerSource("/b.svg");
  echoue(sondes[1]);
  expect(z.element.querySelector("img").getAttribute("src")).toBe("/a.svg");
  expect(z.element.textContent).toBe("");
  const v = image({ src: "/v.svg", nom: "vide.svg", zone: "apercu" });
  echoue(sondes[2]);
  expect(v.element.textContent).toBe("");
  expect(v.element.querySelector("img")).toBeNull();
});

test("REQ120_AC6_absente_zone_vide_et_retour", () => {
  const z = image({ src: "/a.png", nom: "logo.png" });
  charge(sondes[0]);
  z.definirEtat("absente");
  expect(z.element.children.length).toBe(0);
  z.changerSource("/a.png");
  charge(sondes[1]);
  expect(z.element.querySelector("img")).not.toBeNull();
});

test("REQ120_AC15_coupure_une_erreur_ne_donne_ni_message_ni_chargement_et_reprend_au_retour", () => {
  const z = image({ src: "/a.png", nom: "logo.png" });
  z.definirCoupe(true);
  vi.advanceTimersByTime(1000);
  expect(z.element.textContent).toBe("");
  echoue(sondes[0]);
  expect(z.element.textContent).toBe("");
  expect(z.element.querySelector("img")).toBeNull();
  z.definirCoupe(false);
  expect(sondes.length).toBe(2);
  expect(sondes[1].src).toBe("/a.png");
  charge(sondes[1]);
  expect(z.element.querySelector("img").getAttribute("src")).toBe("/a.png");
  expect(z.element.textContent).toBe("");
});

test("REQ120_AC14_coupure_l_image_affichee_reste", () => {
  const z = image({ src: "/a.png", nom: "logo.png" });
  charge(sondes[0]);
  z.definirCoupe(true);
  z.changerSource("/b.png");
  echoue(sondes[1]);
  expect(z.element.querySelector("img").getAttribute("src")).toBe("/a.png");
  expect(z.element.querySelector(".indication")).toBeNull();
  z.definirCoupe(false);
  charge(sondes[2]);
  expect(z.element.querySelector("img").getAttribute("src")).toBe("/b.png");
});

test("REQ120_AC10_accessibilite_onglet", () => {
  const z = image({ src: "/a.png", nom: "logo.png" });
  charge(sondes[0]);
  const e = z.element;
  expect(e.className).toBe("ya-image");
  expect(e.getAttribute("role")).toBe("region");
  expect(e.getAttribute("aria-label")).toBe("logo.png");
  expect(e.getAttribute("tabindex")).toBe("-1");
  const img = e.querySelector("img");
  expect(img.alt).toBe("logo.png");
  expect(img.getAttribute("draggable")).toBe("false");
  monter(z);
  z.focus();
  expect(document.activeElement).toBe(e);
  e.remove();
});

test("REQ121_AC8_accessibilite_apercu", () => {
  const z = image({ src: "data:image/svg+xml;charset=utf-8,x", nom: "logo.svg", zone: "apercu" });
  charge(sondes[0]);
  const e = z.element;
  expect(e.getAttribute("aria-label")).toBe("Aperçu");
  expect(e.hasAttribute("tabindex")).toBe(false);
  expect(e.hasAttribute("role")).toBe(false);
  expect(e.querySelector("img").alt).toBe("logo.svg");
  expect(e.querySelector("[tabindex],button,a,input")).toBeNull();
});

test("REQ120_AC10_entrees_invalides", () => {
  expect(() => image({ src: "/a.png" })).toThrow(/nom/);
  expect(() => image({ nom: "a.png" })).toThrow(/src/);
  expect(() => image({ src: "/a", nom: "a", zone: "x" })).toThrow(/zone/);
});

test("REQ120_AC4_REQ121_AC6_AC9_regles_css_de_ya_image", () => {
  const z = regle(".ya-image");
  expect(z).toContain("flex: 1");
  expect(z).toContain("min-width: 0");
  expect(z).toContain("min-height: 0");
  expect(z).toContain("background: var(--bg-200)");
  expect(z).toContain("padding: var(--space-4)");
  expect(z).toContain("display: flex");
  expect(z).toContain("overflow: hidden");
  const i = regle(".ya-image img");
  expect(i).toContain("max-width: 100%");
  expect(i).toContain("max-height: 100%");
  expect(i).toContain("background: var(--apercu-page)");
  expect(i).toContain("display: block");
  const f = regle(".ya-image:focus-visible");
  expect(f).toContain("outline: var(--trait) solid var(--accent-fg)");
  expect(f).toContain("outline-offset: calc(-1 * var(--trait))");
});
