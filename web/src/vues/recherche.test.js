import { afterEach, expect, test, vi } from "vitest";
import { vueRecherche } from "./recherche.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const json = (corps) => ({ ok: true, status: 200, json: async () => corps });
const attendre = () => new Promise((r) => setTimeout(r, 0));

async function chercher(corps) {
  vi.stubGlobal("fetch", vi.fn(async () => json(corps)));
  const v = vueRecherche({ dire: vi.fn() });
  document.body.append(v.corps);
  v.montrer(true);
  const entree = v.corps.querySelector("input");
  entree.value = "main";
  entree.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await attendre();
  await attendre();
  return v;
}
const hit = (chemin, ligne, texte = "fn main() {", debut = 0, fin = 7) => ({ chemin, ligne, texte, debut, fin });

test("REQ037_AC13_resume_au_singulier", async () => {
  const v = await chercher({ resultats: [hit("src/main.rs", 4)], limite: false });
  expect(v.corps.querySelector(".recherche-resume").textContent).toBe("1 résultat dans 1 fichier");
  v.detruire();
});

test("REQ037_AC13_resume_au_pluriel", async () => {
  const v = await chercher({ resultats: [hit("src/main.rs", 4), hit("src/main.rs", 19), hit("src/lib.rs", 8)], limite: false });
  expect(v.corps.querySelector(".recherche-resume").textContent).toBe("3 résultats dans 2 fichiers");
  v.detruire();
});

test("REQ037_AC13_au_dela_de_500_le_message_remplace_le_resume", async () => {
  const v = await chercher({ resultats: [hit("a.rs", 1)], limite: true });
  expect(v.corps.querySelector(".recherche-resume")).toBeNull();
  expect(v.corps.textContent).toContain("500 premiers résultats. Précisez votre recherche.");
  v.detruire();
});

test("REQ037_AC8_groupe_nom_dossier_compteur_et_partie_trouvee_en_mark", async () => {
  const v = await chercher({ resultats: [hit("src/main.rs", 4), hit("src/main.rs", 19, "#[test] fn main_x", 8, 15)], limite: false });
  const g = v.corps.querySelector(".liste-groupe");
  expect(g.querySelector(".liste-groupe-nom").textContent).toBe("main.rs");
  expect(g.querySelector(".liste-parent").textContent).toBe("src");
  expect(g.querySelector(".ya-badge").textContent).toBe("2");
  const marques = [...v.corps.querySelectorAll("mark")].map((m) => m.textContent);
  expect(marques).toEqual(["fn main", "fn main"]);
  v.detruire();
});

test("REQ037_AC8_fichier_a_la_racine_sans_dossier", async () => {
  const v = await chercher({ resultats: [hit("README.md", 1)], limite: false });
  const g = v.corps.querySelector(".liste-groupe");
  expect(g.querySelector(".liste-groupe-nom").textContent).toBe("README.md");
  expect(g.querySelector(".liste-parent")).toBeNull();
  v.detruire();
});

test("REQ037_AC8_le_texte_du_fichier_n_est_jamais_du_html", async () => {
  const v = await chercher({ resultats: [hit("a.html", 1, "<img src=x onerror=alert(1)>", 1, 4)], limite: false });
  expect(v.corps.querySelector("img")).toBeNull();
  expect(v.corps.querySelector(".liste-libelle").textContent).toBe("<img src=x onerror=alert(1)>");
  v.detruire();
});
