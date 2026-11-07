import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { filtrer, vueOuverture } from "./ouverture.js";

// jsdom n'implémente pas <dialog> modal : on simule ouverture et fermeture.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test("REQ027_AC1_filtre_sans_casse_dans_le_chemin", () => {
  const r = filtrer(["src/main.rs", "README.md", "src/lib.rs"], "MAIN");
  expect(r.map((x) => x.chemin)).toEqual(["src/main.rs"]);
  expect(r[0]).toMatchObject({ debut: 4, fin: 8 });
});

test("REQ027_AC2_read_propose_readme", () => {
  expect(filtrer(["src/main.rs", "README.md"], "read").map((x) => x.chemin)).toEqual(["README.md"]);
});

test("REQ027_AC5_texte_vide_ou_sans_correspondance", () => {
  expect(filtrer(["a.rs"], "")).toEqual([]);
  expect(filtrer(["a.rs"], "zzz")).toEqual([]);
});

test("REQ027_AC8_nom_avant_dossier_puis_plus_court", () => {
  const r = filtrer(["docs/main/notes.txt", "src/main.rs", "a/b/c/main.rs"], "main");
  expect(r.map((x) => x.chemin)).toEqual(["src/main.rs", "a/b/c/main.rs", "docs/main/notes.txt"]);
  expect(r[2]).toMatchObject({ debut: 5, fin: 9 });
});

test("REQ027_limite_de_50_resultats", () => {
  const chemins = Array.from({ length: 80 }, (_, i) => `f${i}.rs`);
  expect(filtrer(chemins, "f")).toHaveLength(50);
});

function simuler(reponse) {
  vi.stubGlobal("fetch", vi.fn(async () => reponse));
}
const json = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps });
const attendre = () => new Promise((r) => setTimeout(r, 0));
const taper = (entree, texte) => {
  entree.value = texte;
  entree.dispatchEvent(new Event("input", { bubbles: true }));
};
const touche = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

async function ouvrir(options = {}) {
  const surOuvrir = vi.fn();
  const dire = vi.fn();
  const surLecture = vi.fn();
  const v = vueOuverture({ dire, surOuvrir, surLecture, ...options });
  const declencheur = document.createElement("button");
  document.body.append(declencheur);
  declencheur.focus();
  v.ouvrir();
  await attendre();
  return { v, surOuvrir, dire, declencheur, entree: document.querySelector("dialog input") };
}

test("REQ027_AC5_focus_dans_le_champ_et_aide_a_vide", async () => {
  simuler(json({ chemins: ["a.rs"] }));
  const { entree, v } = await ouvrir();
  const dlg = document.querySelector("dialog");
  expect(dlg.getAttribute("aria-label")).toBe("Ouvrir un fichier");
  expect(document.activeElement).toBe(entree);
  expect(dlg.textContent).toContain("Tapez une partie du chemin.");
  v.detruire();
});

test("REQ036_AC9_ouverture_en_palette_caracteres_trouves_en_gras", async () => {
  simuler(json({ chemins: ["src/main.rs"] }));
  const { entree, v } = await ouvrir();
  const dlg = document.querySelector("dialog");
  expect(dlg.classList.contains("ya-palette")).toBe(true);
  taper(entree, "MAIN");
  expect(dlg.querySelector("[role=option] b.liste-trouve").textContent).toBe("main");
  expect(dlg.querySelector("[role=option]").classList.contains("liste-courante")).toBe(true);
  v.detruire();
});

test("REQ027_AC5_aucun_fichier_trouve", async () => {
  simuler(json({ chemins: ["a.rs"] }));
  const { entree, v } = await ouvrir();
  taper(entree, "zzz");
  expect(document.querySelector("dialog").textContent).toContain("Aucun fichier trouvé.");
  v.detruire();
});

test("REQ027_AC6_ligne_courante_et_navigation", async () => {
  simuler(json({ chemins: ["src/main.rs", "src/main2.rs"] }));
  const { entree, v } = await ouvrir();
  taper(entree, "main");
  const lignes = [...document.querySelectorAll("dialog [role=option]")];
  expect(lignes).toHaveLength(2);
  expect(entree.getAttribute("aria-activedescendant")).toBe(lignes[0].id);
  touche(entree, "ArrowDown");
  expect(entree.getAttribute("aria-activedescendant")).toBe(lignes[1].id);
  touche(entree, "ArrowUp");
  expect(entree.getAttribute("aria-activedescendant")).toBe(lignes[0].id);
  v.detruire();
});

test("REQ027_AC1_entree_ouvre_le_fichier_courant", async () => {
  const fetch = vi.fn(async (url) =>
    url.startsWith("/api/chemins")
      ? json({ chemins: ["README.md", "src/main.rs"] })
      : { ok: true, status: 200, text: async () => "fn main() {}", headers: new Headers({ "x-version": "v1" }) },
  );
  vi.stubGlobal("fetch", fetch);
  const { entree, surOuvrir, v } = await ouvrir();
  taper(entree, "main");
  touche(entree, "Enter");
  await attendre();
  await attendre();
  expect(fetch).toHaveBeenCalledWith("/api/fichier?chemin=src%2Fmain.rs", expect.anything());
  expect(surOuvrir).toHaveBeenCalledWith({ chemin: "src/main.rs", contenu: "fn main() {}", version: "v1" });
  expect(document.querySelector("dialog")).toBeNull();
  v.detruire();
});

test("REQ027_AC3_AC7_echap_ferme_sans_ouvrir_et_rend_le_focus", async () => {
  simuler(json({ chemins: ["a.rs"] }));
  const { entree, surOuvrir, declencheur, v } = await ouvrir();
  taper(entree, "a");
  document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(document.querySelector("dialog")).toBeNull();
  expect(surOuvrir).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(declencheur);
  v.detruire();
});

test("REQ027_AC1_ctrl_p_ouvre_et_pas_dans_un_shell", async () => {
  simuler(json({ chemins: [] }));
  const v = vueOuverture({ dire: vi.fn(), surOuvrir: vi.fn() });
  const terminal = document.createElement("div");
  terminal.className = "terminal";
  document.body.append(terminal);
  const ctrlP = (cible) => cible.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true }));
  ctrlP(terminal);
  expect(document.querySelector("dialog")).toBeNull();
  ctrlP(document.body);
  expect(document.querySelector("dialog")).not.toBeNull();
  v.detruire();
});

test("REQ027_erreur_de_lecture_de_la_liste", async () => {
  simuler(json({ cause: "erreur", message: "disque cassé." }, 500));
  const { v } = await ouvrir();
  expect(document.querySelector("dialog").textContent).toContain("Impossible de lire les fichiers : disque cassé.");
  v.detruire();
});

test("REQ027_fichier_binaire_ferme_le_dialogue_et_dit_pourquoi", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => (url.startsWith("/api/chemins") ? json({ chemins: ["notes.bin"] }) : json({ cause: "binaire", message: "x" }, 415))),
  );
  const { entree, dire, v } = await ouvrir();
  taper(entree, "notes");
  touche(entree, "Enter");
  await attendre();
  await attendre();
  expect(dire).toHaveBeenCalledWith(expect.objectContaining({ texte: "notes.bin est un fichier binaire. Yaide ne l'ouvre pas." }));
  expect(document.querySelector("dialog")).toBeNull();
  v.detruire();
});

test("REQ008_AC7_ouverture_transmet_le_geste_de_la_lecture", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) =>
    url.startsWith("/api/chemins")
      ? json({ chemins: ["src/main.rs"] })
      : { ok: true, status: 200, text: async () => "x", headers: new Headers({ "x-version": "v1" }) },
  ));
  const surLecture = vi.fn((oui) => (oui ? 7 : undefined));
  const { entree, surOuvrir, v } = await ouvrir({ surLecture });
  taper(entree, "main");
  touche(entree, "Enter");
  await attendre();
  await attendre();
  expect(surOuvrir).toHaveBeenCalledWith({ chemin: "src/main.rs", contenu: "x", version: "v1", geste: 7 });
  v.detruire();
});

test("REQ054_AC1_chevron_liste_les_commandes_sans_fichier", async () => {
  simuler(json({ chemins: ["src/main.rs"] }));
  const { entree, v } = await ouvrir();
  taper(entree, ">");
  const lignes = [...document.querySelectorAll("dialog [role=option]")];
  expect(lignes.map((l) => l.querySelector(".liste-libelle").textContent)).toEqual(["Providers LLM", "Profils de modèle"]);
  expect(document.querySelector("dialog").textContent).not.toContain("main.rs");
  v.detruire();
});

test("REQ054_AC2_AC6_entree_ouvre_le_dialogue", async () => {
  simuler(json({ chemins: ["src/main.rs"] }));
  const surCommande = vi.fn();
  const { entree, declencheur, v } = await ouvrir({ surCommande });
  taper(entree, ">prof");
  touche(entree, "Enter");
  expect(surCommande).toHaveBeenCalledWith("profils", declencheur);
  expect(document.querySelector("dialog")).toBeNull();
  v.ouvrir();
  const e2 = document.querySelector("dialog input");
  taper(e2, ">PROV");
  // Clic sur la ligne : même effet que Entrée.
  document.querySelector("dialog [role=option]").click();
  expect(surCommande).toHaveBeenLastCalledWith("providers", expect.anything());
  expect(document.querySelector("dialog")).toBeNull();
  v.detruire();
});

test("REQ054_AC5_gras_aucune_commande_et_fleches", async () => {
  simuler(json({ chemins: ["src/main.rs"] }));
  const surCommande = vi.fn();
  const { entree, v } = await ouvrir({ surCommande });
  taper(entree, ">pro");
  const lignes = [...document.querySelectorAll("dialog [role=option]")];
  expect(lignes).toHaveLength(2);
  expect(lignes[0].querySelector("b.liste-trouve").textContent).toBe("Pro");
  expect(lignes[0].querySelector(".liste-icone, .liste-parent")).toBeNull();
  expect(entree.getAttribute("aria-activedescendant")).toBe(lignes[0].id);
  touche(entree, "ArrowDown");
  expect(entree.getAttribute("aria-activedescendant")).toBe(lignes[1].id);
  touche(entree, "Enter");
  expect(surCommande).toHaveBeenCalledWith("profils", expect.anything());
  v.ouvrir();
  taper(document.querySelector("dialog input"), ">xyz");
  expect(document.querySelector("dialog").textContent).toContain("Aucune commande trouvée.");
  expect(document.querySelector("dialog [role=option]")).toBeNull();
  v.detruire();
});

test("REQ070_AC5_ouverture_sans_commandes", async () => {
  simuler(json({ chemins: ["src/main.rs"] }));
  const { entree } = await ouvrir({ commandes: [] });
  taper(entree, ">");
  expect(document.querySelector("dialog").textContent).toContain("Aucune commande trouvée.");
  taper(entree, "main");
  expect(document.querySelector("dialog [role=listbox]").textContent).toContain("src/main.rs");
});
