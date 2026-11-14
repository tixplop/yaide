import { expect, test, vi } from "vitest";

const ordre = [];
const principale = vi.fn((options) => {
  ordre.push("vue");
  const el = document.createElement("div");
  el.options = options;
  return el;
});

vi.mock("./api.js", () => ({ info: async () => ({ chemin: "/p" }), sessionValide: async () => true }));
vi.mock("./vues/connexion.js", () => ({ vueConnexion: () => document.createElement("div") }));
vi.mock("./reglages-interface.js", () => ({ charger: async () => (ordre.push("interface"), { illisible: false }) }));
vi.mock("./couleurs-markdown.js", () => ({ charger: async () => (ordre.push("couleurs"), { illisible: true }) }));
vi.mock("./vues/principale.js", () => ({ vuePrincipale: (o) => principale(o) }));
vi.mock("./ui/copie.js", () => ({ copierEnTexteSimple: () => {} }));

test("REQ115_AC8_les_couleurs_sont_lues_une_fois_avant_la_vue_principale", async () => {
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  await import("./main.js");
  await vi.waitFor(() => expect(principale).toHaveBeenCalledTimes(1));
  expect(ordre.filter((e) => e === "couleurs")).toHaveLength(1);
  expect(ordre.indexOf("couleurs")).toBeLessThan(ordre.indexOf("vue"));
  expect(ordre.indexOf("interface")).toBeLessThan(ordre.indexOf("vue"));
  expect(principale.mock.calls[0][0].couleursIllisibles).toBe(true);
});
