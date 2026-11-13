import { test, expect, vi } from "vitest";
import { apercu } from "./apercu.js";
import { zoneCode } from "./zone-code.js";

const TEXTE = [
  "[Lire](../README.md) [l. 3](../src/main.rs#L3) [doc](https://exemple.org/a) [Tests](#lancer-les-tests) [absent](#absent)",
  "",
  "[x](javascript:alert(1)) [y][ref]",
  "",
  "## Lancer les tests !",
  "",
  "[Suite](https://exemple.org/b)",
].join("\n");

function creer(surLien = vi.fn()) {
  const el = apercu({ document: "docs/guide.md", surLien });
  document.body.append(el);
  el.maj(TEXTE);
  return { el, surLien };
}
const lien = (el, texte) => [...el.querySelectorAll("a")].find((a) => a.textContent === texte);

test("REQ101_AC15_title_target_rel_href_data-lien_des_sortes", () => {
  const { el } = creer();
  const f = lien(el, "Lire");
  expect(f.getAttribute("title")).toBe("Ouvrir ../README.md dans l'éditeur.");
  expect(f.getAttribute("href")).toBe("../README.md");
  expect(f.getAttribute("data-lien")).toBe("../README.md");
  expect(f.hasAttribute("target")).toBe(false);
  expect(lien(el, "l. 3").getAttribute("title")).toBe("Ouvrir ../src/main.rs à la ligne 3 dans l'éditeur.");
  const w = lien(el, "doc");
  expect(w.getAttribute("title")).toBe("S'ouvre dans un nouvel onglet du navigateur.");
  expect(w.getAttribute("target")).toBe("_blank");
  expect(w.getAttribute("rel")).toBe("noopener noreferrer");
  expect(w.getAttribute("data-lien")).toBe("https://exemple.org/a");
  const a = lien(el, "Tests");
  expect(a.hasAttribute("title")).toBe(false);
  expect(a.getAttribute("href")).toBe("#lancer-les-tests");
  expect(a.getAttribute("data-lien")).toBe("#lancer-les-tests");
});

test("REQ101_AC1_clic_ctrl_maj_milieu_sur_un_fichier_appelle_surLien_une_fois", () => {
  const { el, surLien } = creer();
  const a = lien(el, "Lire");
  const essais = [
    ["click", {}],
    ["click", { ctrlKey: true }],
    ["click", { shiftKey: true }],
    ["auxclick", { button: 1 }],
  ];
  essais.forEach(([type, init], n) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    a.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(surLien).toHaveBeenCalledTimes(n + 1);
    expect(surLien).toHaveBeenLastCalledWith({ adresse: "../README.md", element: a });
  });
});

test("REQ101_AC5_lien_web_laisse_au_navigateur", () => {
  const { el, surLien } = creer();
  for (const type of ["click", "auxclick"]) {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: type === "auxclick" ? 1 : 0 });
    lien(el, "doc").dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  }
  expect(surLien).not.toHaveBeenCalled();
});

test("REQ101_AC4_AC14_ancre_met_le_focus_sur_le_titre", () => {
  const { el, surLien } = creer();
  const h = el.querySelector("h2");
  h.scrollIntoView = vi.fn();
  const a = lien(el, "Tests");
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(h);
  expect(h.textContent).toBe("Lancer les tests !");
  expect(h.getAttribute("tabindex")).toBe("-1");
  expect(h.hasAttribute("id")).toBe(false);
  expect(h.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  expect(surLien).not.toHaveBeenCalled();
  // le tabindex reste, et Tab suivant va (ordre DOM) au premier lien après le titre
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(h.getAttribute("tabindex")).toBe("-1");
  const apres = [...el.querySelectorAll("a, h2[tabindex]")];
  expect(apres[apres.indexOf(h) + 1]).toBe(lien(el, "Suite"));
});

test("REQ101_AC4_ancre_absente_ne_bouge_rien", () => {
  const { el, surLien } = creer();
  const a = lien(el, "absent");
  a.focus();
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(e);
  expect(document.activeElement).toBe(a);
  expect(e.defaultPrevented).toBe(true);
  expect(surLien).not.toHaveBeenCalled();
});

test("REQ101_AC1_auxclick_autre_que_le_milieu_est_ignore", () => {
  const { el, surLien } = creer();
  const e = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 });
  lien(el, "Lire").dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
  expect(surLien).not.toHaveBeenCalled();
});

test("REQ101_AC8_javascript_et_reference_sans_definition_ne_font_pas_de_lien", () => {
  const { el, surLien } = creer();
  expect([...el.querySelectorAll("a")].some((a) => /javascript:/i.test(a.getAttribute("href") ?? ""))).toBe(false);
  expect(lien(el, "y")).toBeUndefined();
  expect(surLien).not.toHaveBeenCalled();
});

test("REQ101_AC1_AC14_zoneCode_branche_l_apercu_et_laisse_le_curseur", () => {
  const surLien = vi.fn();
  const z = zoneCode({ contenu: TEXTE, langage: "markdown", apercu: true, document: "docs/guide.md", surLien });
  document.body.append(z);
  z.vue.dispatch({ selection: { anchor: 5 } });
  const a = lien(z, "Lire");
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(surLien).toHaveBeenCalledWith({ adresse: "../README.md", element: a });
  lien(z, "Tests").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(z.querySelector("h2"));
  expect(z.vue.state.selection.main.head).toBe(5);
});
