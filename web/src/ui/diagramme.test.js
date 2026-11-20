import { beforeEach, expect, test, vi } from "vitest";

let m;
beforeEach(async () => {
  vi.resetModules();
  document.head.innerHTML = "";
  m = await import("./diagramme.js");
});
const scripts = () => document.querySelectorAll('script[src="/mermaid.js"]');

test("REQ122_chargerMermaid_un_seul_script_et_promesse_partagee", async () => {
  const a = m.chargerMermaid();
  const b = m.chargerMermaid();
  expect(a).toBe(b);
  expect(scripts().length).toBe(1);
  window.yaideMermaid = { dessiner: 1 };
  scripts()[0].onload();
  expect(await a).toBe(window.yaideMermaid);
  expect(m.chargerMermaid()).toBe(a);
  expect(scripts().length).toBe(1);
});

test("REQ122_chargerMermaid_nouvel_essai_apres_une_erreur", async () => {
  const a = m.chargerMermaid();
  scripts()[0].onerror();
  await expect(a).rejects.toThrow();
  expect(scripts().length).toBe(0);
  const b = m.chargerMermaid();
  expect(b).not.toBe(a);
  expect(scripts().length).toBe(1);
  window.yaideMermaid = {};
  scripts()[0].onload();
  await b;
});

test("REQ122_adresseDiagramme_data_url_encodee", () => {
  const svg = '<svg a="1">é #</svg>';
  const a = m.adresseDiagramme(svg);
  expect(a.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
  expect(decodeURIComponent(a.slice(a.indexOf(",") + 1))).toBe(svg);
  expect(a).not.toContain("<");
});

test("REQ152_dessinerTexte_un_seul_appel_par_texte_et_dessinConnu", async () => {
  const dessiner = vi.fn(async (t) => (t === "mauvais" ? null : { svg: "<svg/>", largeur: 1, hauteur: 2 }));
  const mermaid = { dessiner };
  expect(m.dessinConnu("a")).toBeUndefined();
  const [x, y] = await Promise.all([m.dessinerTexte(mermaid, "a"), m.dessinerTexte(mermaid, "a")]);
  expect(x).toBe(y);
  expect(dessiner).toHaveBeenCalledTimes(1);
  expect(m.dessinConnu("a")).toEqual({ svg: "<svg/>", largeur: 1, hauteur: 2 });
  expect(await m.dessinerTexte(mermaid, "mauvais")).toBeNull();
  expect(m.dessinConnu("mauvais")).toBeNull();
  expect(await m.dessinerTexte({ dessiner: async () => { throw new Error("x"); } }, "b")).toBeNull();
});
