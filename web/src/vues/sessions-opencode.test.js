import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { quand } from "./agent.js";
import { vueSessionsOpencode } from "./sessions-opencode.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const rep = (corps, status = 200) => ({ ok: status < 400, status, text: async () => (typeof corps === "string" ? corps : JSON.stringify(corps)) });
const S = (id, title, updated, busy = updated) => ({ id, title, time: { updated, ...(busy === null ? {} : { busy }) } });
function monter(reponse, options = {}) {
  const urls = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    urls.push(String(url));
    return typeof reponse === "function" ? reponse() : reponse;
  }));
  const surChoix = vi.fn();
  const bouton = document.createElement("button");
  document.body.append(bouton);
  bouton.focus();
  const etats = [];
  const v = vueSessionsOpencode({ chemin: "/home/x/projet", surChoix, surEtat: (o) => etats.push(o), ...options });
  return { v, urls, surChoix, bouton, etats };
}
const dlg = () => document.querySelector("dialog");
const lignes = () => [...document.querySelectorAll("[role=option]")];
const touche = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const maintenant = Date.now();

test("REQ088_AC2_AC8_requete_filtres_ordre_et_relecture", async () => {
  const { v, urls } = monter(rep({ data: [S("a", "Ancienne", maintenant - 3e6), S("v", "Vide", maintenant, null), S("n", "Récente", maintenant - 1e3)] }));
  await v.ouvrir();
  await vi.waitFor(() => expect(lignes()).toHaveLength(2));
  expect(urls[0]).toBe("/api/opencode/api/session?directory=%2Fhome%2Fx%2Fprojet&parentID=null&order=desc");
  expect(lignes().map((l) => l.querySelector(".liste-libelle").textContent)).toEqual(["Récente", "Ancienne"]);
  document.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true }));
  await vi.waitFor(() => expect(dlg()).toBeNull());
  await v.ouvrir();
  await vi.waitFor(() => expect(lignes()).toHaveLength(2));
  expect(urls).toHaveLength(2);
});

test("REQ088_AC13_dialogue_listbox_focus_activedescendant_titre_et_date", async () => {
  const { v } = monter(rep({ data: [S("a", "Un titre très long ".repeat(10), maintenant), S("b", undefined, maintenant - 5e9)] }));
  await v.ouvrir();
  await vi.waitFor(() => expect(lignes()).toHaveLength(2));
  expect(dlg().getAttribute("aria-label")).toBe("Sessions opencode");
  const l = document.querySelector("[role=listbox]");
  expect(l.getAttribute("aria-label")).toBe("Sessions opencode");
  expect(document.activeElement).toBe(l);
  expect(l.getAttribute("aria-activedescendant")).toBe(lignes()[0].id);
  expect(lignes()[0].querySelector(".liste-libelle").title).toBe("Un titre très long ".repeat(10));
  expect(lignes()[0].querySelector(".ya-fin").textContent).toBe(quand(maintenant));
  expect(lignes()[1].querySelector(".liste-libelle").textContent).toBe("Sans titre");
  expect(lignes()[0].textContent).toContain(quand(maintenant));
});

test("REQ088_AC13_formats_de_date", () => {
  const ref = new Date(2026, 10, 11, 16, 0);
  const ms = (a, m, j, h = 14, mi = 32) => new Date(a, m, j, h, mi).getTime();
  expect(quand(ms(2026, 10, 11), ref, true)).toBe("14:32");
  expect(quand(ms(2026, 10, 10), ref, true)).toBe("hier");
  expect(quand(ms(2026, 10, 4), ref, true)).toBe("4 nov.");
  expect(quand(ms(2025, 11, 12), ref, true)).toBe("12 déc. 2025");
  expect(quand(ms(2025, 11, 12), ref)).toBe("12 déc.");
});

test("REQ088_AC4_AC11_AC14_clavier_entree_clic_et_choix", async () => {
  const { v, surChoix } = monter(rep({ data: [S("a", "A", 3), S("b", "B", 2), S("c", "C", 1)] }));
  await v.ouvrir();
  await vi.waitFor(() => expect(lignes()).toHaveLength(3));
  const l = document.querySelector("[role=listbox]");
  touche(l, "ArrowDown");
  expect(l.getAttribute("aria-activedescendant")).toBe(lignes()[1].id);
  touche(l, "End");
  expect(l.getAttribute("aria-activedescendant")).toBe(lignes()[2].id);
  touche(l, "Home");
  expect(l.getAttribute("aria-activedescendant")).toBe(lignes()[0].id);
  touche(l, "ArrowDown");
  touche(l, "Enter");
  expect(surChoix).toHaveBeenCalledWith({ id: "b", titre: "B" });
  expect(dlg()).toBeNull();
  await v.ouvrir();
  await vi.waitFor(() => expect(lignes()).toHaveLength(3));
  lignes()[2].click();
  expect(surChoix).toHaveBeenLastCalledWith({ id: "c", titre: "C" });
});

test("REQ088_AC11_AC15_echap_et_clic_dehors_ferment_et_rendent_le_focus", async () => {
  const { v, bouton, surChoix, etats } = monter(rep({ data: [S("a", "A", 1)] }));
  await v.ouvrir();
  await vi.waitFor(() => expect(lignes()).toHaveLength(1));
  dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(dlg()).toBeNull();
  expect(document.activeElement).toBe(bouton);
  await v.ouvrir();
  await vi.waitFor(() => expect(lignes()).toHaveLength(1));
  const d = dlg();
  d.getBoundingClientRect = () => ({ left: 100, right: 200, top: 100, bottom: 200 });
  d.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10 }));
  expect(dlg()).toBeNull();
  expect(document.activeElement).toBe(bouton);
  expect(surChoix).not.toHaveBeenCalled();
  expect(etats).toEqual([true, false, true, false]);
});

test("REQ088_AC9_AC15_vide_et_chargement_apres_200_ms", async () => {
  vi.useFakeTimers();
  let liberer;
  const { v } = monter(() => new Promise((r) => (liberer = () => r(rep({ data: [S("v", "Vide", 1, null)] })))));
  const p = v.ouvrir();
  const charge = () => document.querySelector("[aria-busy=true]");
  expect(charge().hidden).toBe(true);
  vi.advanceTimersByTime(250);
  expect(charge().hidden).toBe(false);
  expect(charge().textContent).toBe("Chargement…");
  expect(document.activeElement).toBe(dlg());
  liberer();
  await p;
  await vi.waitFor(() => expect(dlg().textContent).toBe("Aucune session opencode dans ce projet."));
  expect(dlg().querySelector("[role=status]")).not.toBeNull();
  expect(document.activeElement).toBe(dlg());
});

test("REQ088_AC10_AC15_erreur_et_coupure_en_alerte_sans_choix", async () => {
  const a = monter(rep({ message: "opencode a quitté." }, 503));
  await a.v.ouvrir();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]")).not.toBeNull());
  expect(dlg().textContent).toBe("Impossible de lister les sessions opencode : opencode a quitté.");
  dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(dlg()).toBeNull();
  expect(a.surChoix).not.toHaveBeenCalled();
  const b = monter(rep("pas du json"));
  await b.v.ouvrir();
  await vi.waitFor(() => expect(dlg().textContent).toContain("Impossible de lister les sessions opencode : réponse illisible."));
  dlg().dispatchEvent(new Event("cancel", { cancelable: true }));
  const c = monter(null);
  await c.v.ouvrir();
  await vi.waitFor(() => expect(dlg().querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour."));
});
