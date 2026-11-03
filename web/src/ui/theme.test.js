import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { changerTheme, themeCourant } from "./theme.js";

const initial = readFileSync("web/src/theme-initial.js", "utf8");
const lancerInitial = () => new Function(initial)();

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

test("REQ038_AC1_sans_choix_gardé_le_thème_initial_est_sombre", () => {
  lancerInitial();
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(themeCourant()).toBe("dark");
});

test("REQ038_AC3_le_thème_gardé_est_posé_au_chargement", () => {
  localStorage.setItem("yaide-theme", "light");
  lancerInitial();
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(themeCourant()).toBe("light");
});

test("REQ038_AC3_une_valeur_inconnue_gardée_donne_le_thème_sombre", () => {
  localStorage.setItem("yaide-theme", "rose");
  lancerInitial();
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("REQ038_AC2_changer_de_thème_écrit_la_clé_pose_l_attribut_et_envoie_l_événement", () => {
  const recu = vi.fn();
  document.addEventListener("yaide-theme", recu);
  changerTheme("light");
  expect(localStorage.getItem("yaide-theme")).toBe("light");
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(themeCourant()).toBe("light");
  expect(recu).toHaveBeenCalledTimes(1);
  expect(recu.mock.calls[0][0].detail).toBe("light");
  changerTheme("dark");
  expect(themeCourant()).toBe("dark");
  expect(recu).toHaveBeenCalledTimes(2);
  document.removeEventListener("yaide-theme", recu);
});

test("REQ038_AC2_un_thème_inconnu_est_refusé_sans_rien_changer", () => {
  changerTheme("dark");
  expect(() => changerTheme("rose")).toThrow("thème inconnu");
  expect(localStorage.getItem("yaide-theme")).toBe("dark");
  expect(themeCourant()).toBe("dark");
});

test("REQ038_AC3_theme_js_est_chargé_en_bloquant_avant_les_feuilles", () => {
  const html = readFileSync("web/index.html", "utf8");
  const tete = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  expect(tete).toMatch(/<script src="\/theme\.js"><\/script>/);
  expect(tete.indexOf("/theme.js")).toBeLessThan(tete.indexOf('rel="stylesheet"'));
  expect(html).toContain('<body class="ya">');
  expect(html).toContain("<title>yaide</title>");
  expect(html).toContain('rel="icon" href="data:image/svg+xml,');
});
