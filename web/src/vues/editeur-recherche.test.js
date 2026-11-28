import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { vueEditeur } from "./editeur.js";
import { cadre } from "../ui/cadre.js";

vi.mock("./claude.js", () => ({ vueClaude: () => ({ corps: document.createElement("div"), focus() {}, ajuster() {}, detruire() {} }) }));
vi.mock("./opencode.js", () => ({ vueOpencode: () => ({ corps: document.createElement("div"), focus() {}, detruire() {} }) }));
vi.mock("./agent.js", () => ({ vueAgent: () => ({ corps: document.createElement("div"), focuser() {}, majListe() {}, relireReglages() {}, detruire() {} }) }));
const magasin = vi.hoisted(() => new Map());
vi.mock("../stockage.js", () => ({ lire: vi.fn(async (cle) => magasin.get(cle)), ecrire: vi.fn(async (cle, v) => void magasin.set(cle, v)) }));

Range.prototype.getClientRects ??= () => [];
Range.prototype.getBoundingClientRect ??= () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });

const CLIENTS = 'nom,ville,note\nAlice,Paris,12\n"Bob, fils",Lyon,"dit ""oui"""\nChloé,Nantes\n';
const README = "Yaide ici\nun yaide là\net YAIDE";
let editeurs = [];
function monter(fichiers = { "README.md": README, "main.rs": "fn main() {}\n", "clients.csv": CLIENTS }) {
  let c = null;
  const e = vueEditeur({ dire: vi.fn(), surGroupes: (arbre, courant) => c?.definirGroupes(arbre, courant) });
  editeurs.push(e);
  c = cadre({ principal: { groupes: e.groupes() } });
  document.body.append(c);
  e.lecture(false);
  for (const [chemin, contenu] of Object.entries(fichiers)) e.ouvrir({ chemin, contenu, version: "1" });
  return e;
}
beforeEach(() => {
  localStorage.clear();
  magasin.clear();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
});
afterEach(() => {
  for (const e of editeurs) e.detruire();
  editeurs = [];
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const zoneDe = (chemin) => [...document.querySelectorAll(".zone-code")].find((z) => z.vue.contentDOM.getAttribute("aria-label") === `Éditeur ${chemin}`);
const panneau = (chemin) => zoneDe(chemin).querySelector(".ya-recherche-fichier");
const onglet = (nom) => [...document.querySelectorAll("[role=tab]")].find((t) => t.querySelector(".onglet-nom").textContent === nom);
const attendre = () => new Promise((ok) => setTimeout(ok, 0));
const aller = (e, chemin) => e.ouvrir({ chemin, contenu: "", version: "1" });
function ctrlF(cible, init = {}) {
  const ev = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true, ...init });
  cible.dispatchEvent(ev);
  return ev;
}
const noms = (p) => [...p.children].map((x) => x.className || x.getAttribute("role") || x.tagName);

test("REQ159_AC1_ctrl_f_ouvre_le_panneau_sur_un_markdown_seulement", async () => {
  const e = monter();
  aller(e, "README.md");
  const z = zoneDe("README.md");
  z.vue.focus();
  const ev = ctrlF(z.vue.contentDOM);
  expect(ev.defaultPrevented).toBe(true);
  const p = panneau("README.md");
  expect(p.getAttribute("role")).toBe("search");
  expect(document.activeElement).toBe(p.querySelector("input"));
  // champ, compteur, flèche haut, flèche bas, croix, dans cet ordre
  const ordre = [...p.querySelectorAll("input, .ya-recherche-compteur, button")].map((x) => x.tagName === "INPUT" ? "champ" : x.className.includes("compteur") ? "compteur" : x.getAttribute("aria-label"));
  expect(ordre).toEqual(["champ", "Respecter la casse", "Expression régulière", "compteur", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  // Ctrl+F panneau ouvert : focus et texte sélectionné
  const saisie = p.querySelector("input");
  saisie.value = "yaide";
  saisie.dispatchEvent(new Event("input", { bubbles: true }));
  z.vue.focus();
  ctrlF(z.vue.contentDOM);
  expect(document.activeElement).toBe(saisie);
  expect(saisie.selectionStart).toBe(0);
  expect(saisie.selectionEnd).toBe(5);
  expect(p.querySelectorAll(".ya-occurrence")).toHaveLength(0); // décorations dans le contenu, pas dans le panneau
  expect(z.querySelectorAll(".ya-occurrence")).toHaveLength(3);

  // Ailleurs, la recherche du navigateur reste.
  aller(e, "main.rs");
  zoneDe("main.rs").vue.focus();
  const rs = ctrlF(zoneDe("main.rs").vue.contentDOM);
  expect(rs.defaultPrevented).toBe(false);
  expect(panneau("main.rs")).toBeNull();
  e.ouvrirDiff({ chemin: "README.md", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  const diff = document.querySelector(".zone-code:not([hidden])");
  const d = ctrlF(diff.vue.contentDOM);
  expect(d.defaultPrevented).toBe(false);
  expect(diff.querySelector(".ya-recherche-fichier")).toBeNull();
});

test("REQ159_AC1_cmd_f_sur_macos", () => {
  vi.spyOn(globalThis.navigator, "platform", "get").mockReturnValue("MacIntel");
  const e = monter({ "README.md": README });
  aller(e, "README.md");
  const z = zoneDe("README.md");
  expect(ctrlF(z.vue.contentDOM).defaultPrevented).toBe(false);
  expect(ctrlF(z.vue.contentDOM, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
  expect(panneau("README.md")).not.toBeNull();
});

test("REQ159_AC7_la_croix_ne_marque_pas_l_onglet_modifie", async () => {
  const e = monter({ "README.md": README });
  aller(e, "README.md");
  const z = zoneDe("README.md");
  ctrlF(z.vue.contentDOM);
  const p = panneau("README.md");
  p.querySelector("input").value = "yaide";
  p.querySelector("input").dispatchEvent(new Event("input", { bubbles: true }));
  p.querySelector('button[aria-label="Fermer la recherche"]').click();
  await attendre();
  expect(panneau("README.md")).toBeNull();
  expect(onglet("README.md").dataset.modifie).toBeUndefined();
  expect(z.contenu()).toBe(README);
});

const stubFichiers = () =>
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = new URL(String(url), "http://x");
    if (u.pathname === "/api/fichiers/versions") return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, headers: new Headers({ "x-version": "1" }), text: async () => README };
  }));

test("REQ159_AC15_le_panneau_suit_son_onglet_et_pas_le_rechargement", async () => {
  stubFichiers();
  const e = monter({});
  await e.restaurer(); // l'éditeur garde sa liste à partir de là
  for (const [chemin, contenu] of Object.entries({ "README.md": README, "main.rs": "fn main() {}\n" })) e.ouvrir({ chemin, contenu, version: "1" });
  aller(e, "README.md");
  const z = zoneDe("README.md");
  ctrlF(z.vue.contentDOM);
  const saisie = () => panneau("README.md").querySelector("input");
  saisie().value = "yaide";
  saisie().dispatchEvent(new Event("input", { bubbles: true }));
  aller(e, "main.rs");
  aller(e, "README.md");
  await attendre();
  expect(saisie().value).toBe("yaide");
  expect(z.querySelectorAll(".ya-occurrence")).toHaveLength(3);
  // « Mode hybride » et « Aperçu » basculés : le panneau reste.
  document.querySelector('button[aria-label="Mode hybride"]').click();
  document.querySelector('button[aria-label="Aperçu"]').click();
  await attendre();
  expect(saisie().value).toBe("yaide");
  expect(z.querySelectorAll(".ya-occurrence")).toHaveLength(3);
  expect(noms(panneau("README.md").parentNode)).toContain("ya-recherche-fichier");
  // Un autre groupe a son propre panneau.
  e.ouvrir({ chemin: "AUTRE.md", contenu: "yaide", version: "1" });
  e.deplacer("AUTRE.md", "g1", "droite");
  const autre = zoneDe("AUTRE.md");
  expect(autre.querySelector(".ya-recherche-fichier")).toBeNull();
  ctrlF(autre.vue.contentDOM);
  expect(autre.querySelector(".ya-recherche-fichier input").value).toBe("");
  expect(saisie().value).toBe("yaide");
  // Rechargement : la liste est écrite (200 ms), un nouvel éditeur la relit : README.md revient sans panneau.
  await new Promise((ok) => setTimeout(ok, 300));
  expect(magasin.size).toBeGreaterThan(0);
  e.detruire();
  document.body.replaceChildren();
  let c2 = null;
  const e2 = vueEditeur({ dire: vi.fn(), surGroupes: (arbre, courant) => c2?.definirGroupes(arbre, courant) });
  editeurs.push(e2);
  c2 = cadre({ principal: { groupes: e2.groupes() } });
  document.body.append(c2);
  await e2.restaurer();
  expect(zoneDe("README.md")).toBeTruthy();
  expect(document.querySelector(".ya-recherche-fichier")).toBeNull();
});

function ctrlH(cible, init = {}) {
  const ev = new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true, cancelable: true, ...init });
  cible.dispatchEvent(ev);
  return ev;
}
const lignes = (p) => [...p.querySelectorAll("input, button")].map((x) => x.getAttribute("aria-label") ?? x.tagName);
const champs = (chemin) => panneau(chemin).querySelectorAll("input");
const saisir = (input, t) => {
  input.value = t;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const REMPLACER = ["INPUT", "Respecter la casse", "Expression régulière", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche", "INPUT", "Remplacer", "Tout remplacer"];

test("REQ207_AC1_ctrl_h_ouvre_avec_remplacement_sur_tout_fichier_texte_et_pas_sur_diff_ni_page_seule", () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
  const e = monter({ "README.md": README, "main.rs": "fn main() {}\n", "index.html": "<p>yaide</p>" });
  for (const chemin of ["README.md", "main.rs"]) {
    aller(e, chemin);
    const z = zoneDe(chemin);
    z.vue.focus();
    const ev = ctrlH(z.vue.contentDOM);
    expect(ev.defaultPrevented).toBe(true);
    expect(panneau(chemin).getAttribute("aria-label")).toBe(`Rechercher dans ${chemin}`);
    expect(document.activeElement).toBe(champs(chemin)[0]);
    expect(lignes(panneau(chemin))).toEqual(REMPLACER);
    expect(champs(chemin)[1].getAttribute("aria-label") ?? champs(chemin)[1].labels?.[0]?.textContent).toBe("Remplacer par");
    expect(champs(chemin)[1].placeholder).toBe("Remplacer");
  }
  // index.html : page seule à l'ouverture, rien ; éditeur affiché, la recherche s'ouvre.
  aller(e, "index.html");
  const page = zoneDe("index.html").lastElementChild;
  expect(page.classList.contains("cm-editor")).toBe(false);
  expect(ctrlH(page).defaultPrevented).toBe(false);
  expect(panneau("index.html")).toBeNull();
  expect(zoneDe("index.html").querySelector(".ya-recherche-fichier")).toBeNull();
  document.querySelector('button[aria-label="Mode hybride"]').click();
  const html = zoneDe("index.html");
  expect(ctrlH(html.vue.contentDOM).defaultPrevented).toBe(true);
  expect(lignes(panneau("index.html"))).toEqual(REMPLACER);
  // Diff : rien.
  e.ouvrirDiff({ chemin: "main.rs", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  const diff = document.querySelector(".zone-code:not([hidden])");
  expect(ctrlH(diff.vue.contentDOM).defaultPrevented).toBe(false);
  expect(diff.querySelector(".ya-recherche-fichier")).toBeNull();
  // Aperçu de README.md : le focus n'est pas dans l'éditeur, rien.
  aller(e, "README.md");
  panneau("README.md").querySelector('button[aria-label="Fermer la recherche"]').click();
  document.querySelector('button[aria-label="Aperçu"]').click();
  const apercu = zoneDe("README.md").lastElementChild;
  expect(apercu.classList.contains("cm-editor")).toBe(false);
  expect(zoneDe("README.md").vue.dom.contains(apercu)).toBe(false);
  expect(ctrlH(apercu).defaultPrevented).toBe(false);
  expect(panneau("README.md")).toBeNull();
});

test("REQ207_AC2_REQ159_AC1_ctrl_h_sur_panneau_ouvert_ctrl_f_garde_la_ligne_et_rien_sur_main_rs", () => {
  const e = monter({ "README.md": README, "main.rs": "fn main() {}\n" });
  aller(e, "README.md");
  const z = zoneDe("README.md");
  ctrlF(z.vue.contentDOM);
  saisir(champs("README.md")[0], "yaide");
  expect(lignes(panneau("README.md")).length).toBe(6);
  ctrlH(z.vue.contentDOM);
  expect(lignes(panneau("README.md"))).toEqual(REMPLACER);
  expect(champs("README.md")[0].value).toBe("yaide");
  expect(panneau("README.md").querySelector(".ya-recherche-compteur").textContent).toBe("3");
  expect(document.activeElement).toBe(champs("README.md")[1]);
  ctrlF(champs("README.md")[1]);
  expect(document.activeElement).toBe(champs("README.md")[0]);
  expect(lignes(panneau("README.md"))).toEqual(REMPLACER);
  panneau("README.md").querySelector('button[aria-label="Fermer la recherche"]').click();
  ctrlF(z.vue.contentDOM);
  expect(lignes(panneau("README.md")).length).toBe(6);
  // main.rs : Ctrl+F n'ouvre rien fenêtre fermée, mais revient au champ fenêtre ouverte par Ctrl+H.
  aller(e, "main.rs");
  const rs = zoneDe("main.rs");
  expect(ctrlF(rs.vue.contentDOM).defaultPrevented).toBe(false);
  expect(panneau("main.rs")).toBeNull();
  ctrlH(rs.vue.contentDOM);
  champs("main.rs")[1].focus();
  expect(ctrlF(rs.vue.contentDOM).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(champs("main.rs")[0]);
  expect(lignes(panneau("main.rs"))).toEqual(REMPLACER);
});

test("REQ206_AC6_REQ207_AC10_bascules_et_ligne_gardees_au_changement_d_onglet_fermees_au_rechargement", async () => {
  stubFichiers();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const e = monter({});
  await e.restaurer();
  for (const [chemin, contenu] of Object.entries({ "README.md": README, "main.rs": "fn main() {}\n" })) e.ouvrir({ chemin, contenu, version: "1" });
  aller(e, "README.md");
  const z = zoneDe("README.md");
  ctrlH(z.vue.contentDOM);
  saisir(champs("README.md")[0], "Yaide");
  saisir(champs("README.md")[1], "Zed");
  panneau("README.md").querySelector('button[aria-label="Respecter la casse"]').click();
  aller(e, "main.rs");
  aller(e, "README.md");
  expect(champs("README.md")[1].value).toBe("Zed");
  expect(champs("README.md")[0].value).toBe("Yaide");
  expect(panneau("README.md").querySelector('button[aria-label="Respecter la casse"]').getAttribute("aria-pressed")).toBe("true");
  expect(panneau("README.md").querySelector(".ya-recherche-compteur").textContent).toBe("1");
  // Échap puis Ctrl+F : bascules relâchées, champ vide, pas de ligne de remplacement.
  champs("README.md")[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  ctrlF(z.vue.contentDOM);
  expect(panneau("README.md").querySelector('button[aria-label="Respecter la casse"]').getAttribute("aria-pressed")).toBe("false");
  expect(champs("README.md")[0].value).toBe("");
  expect(champs("README.md")).toHaveLength(1);
  // Rechargement : fenêtre fermée.
  ctrlH(z.vue.contentDOM);
  await vi.advanceTimersByTimeAsync(300);
  e.detruire();
  document.body.replaceChildren();
  let c2 = null;
  const e2 = vueEditeur({ dire: vi.fn(), surGroupes: (arbre, courant) => c2?.definirGroupes(arbre, courant) });
  editeurs.push(e2);
  c2 = cadre({ principal: { groupes: e2.groupes() } });
  document.body.append(c2);
  await e2.restaurer();
  expect(zoneDe("README.md")).toBeTruthy();
  expect(document.querySelector(".ya-recherche-fichier")).toBeNull();
  vi.useRealTimers();
});

test("REQ207_AC3_remplacer_donne_son_point_a_l_onglet", () => {
  const e = monter({ "README.md": README });
  aller(e, "README.md");
  ctrlH(zoneDe("README.md").vue.contentDOM);
  saisir(champs("README.md")[0], "yaide");
  saisir(champs("README.md")[1], "Zed");
  expect(onglet("README.md").dataset.modifie).toBeUndefined();
  panneau("README.md").querySelector('button[aria-label="Remplacer"]').click();
  expect(onglet("README.md").dataset.modifie).toBe("true");
});

test("REQ207_AC4_tout_remplacer_marque_l_onglet_et_ctrl_s_ecrit_le_fichier_a_l_octet_pres", async () => {
  const puts = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "PUT") puts.push(init.body);
    return { ok: true, status: 200, headers: new Headers({ "x-version": "2" }), json: async () => ({ version: "2" }), text: async () => "" };
  }));
  const e = monter({ "README.md": README });
  aller(e, "README.md");
  const z = zoneDe("README.md");
  ctrlH(z.vue.contentDOM);
  saisir(champs("README.md")[0], "yaide");
  saisir(champs("README.md")[1], "Zed");
  expect(onglet("README.md").dataset.modifie).toBeUndefined();
  panneau("README.md").querySelector('button[aria-label="Tout remplacer"]').click();
  expect(z.contenu()).toBe("Zed ici\nun Zed là\net Zed");
  expect(onglet("README.md").dataset.modifie).toBe("true");
  expect(puts).toHaveLength(0);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(puts).toEqual(["Zed ici\nun Zed là\net Zed"]));
});

// ---- REQ-160 : recherche dans un fichier CSV ----
const hybride = () => document.querySelector('button[aria-label="Mode hybride"]');
const panneauCsv = () => document.querySelector(".ya-tableur-conteneur > .ya-recherche-fichier");
const saisieCsv = () => panneauCsv().querySelector("input");
function chercherCsv(texte) {
  saisieCsv().value = texte;
  saisieCsv().dispatchEvent(new Event("input", { bubbles: true }));
}
const compteCsv = () => panneauCsv().querySelector(".ya-recherche-compteur").textContent.replace(/\s+/g, " ").trim();

test("REQ160_AC1_ctrl_f_sur_la_grille_ouvre_le_panneau_du_tableur_et_pas_sur_un_diff", () => {
  const e = monter();
  aller(e, "clients.csv");
  const z = zoneDe("clients.csv");
  const td = z.querySelector("td");
  td.focus();
  const ev = ctrlF(td);
  expect(ev.defaultPrevented).toBe(true);
  expect(panneauCsv()).not.toBeNull();
  expect(panneauCsv().nextElementSibling).toBe(z.querySelector(".ya-tableur"));
  expect(document.activeElement).toBe(saisieCsv());
  expect(z.querySelector(".zone-code-editeur .ya-recherche-fichier")).toBeNull();
  e.ouvrirDiff({ chemin: "clients.csv", texte: "@@ -1 +1 @@\n-a\n+b\n" });
  const diff = document.querySelector(".zone-code:not([hidden])");
  expect(ctrlF(diff.vue.contentDOM).defaultPrevented).toBe(false);
});

test("REQ160_AC6_AC8_texte_en_mode_hybride_eteint_fermeture_au_basculement_et_panneau_garde_par_onglet", async () => {
  stubFichiers();
  const e = monter({});
  await e.restaurer(); // l'éditeur garde sa liste à partir de là
  for (const [chemin, contenu] of Object.entries({ "README.md": README, "clients.csv": CLIENTS })) e.ouvrir({ chemin, contenu, version: "1" });
  aller(e, "clients.csv");
  let z = zoneDe("clients.csv");
  // Mode hybride éteint : la recherche de REQ-159 sur le texte du fichier.
  hybride().click();
  ctrlF(z.vue.contentDOM);
  expect(z.querySelector(".zone-code-editeur .ya-recherche-fichier")).not.toBeNull();
  expect(panneauCsv()).toBeNull();
  z.querySelector(".ya-recherche-fichier input").value = '""';
  z.querySelector(".ya-recherche-fichier input").dispatchEvent(new Event("input", { bubbles: true }));
  expect(z.querySelectorAll(".ya-occurrence")).toHaveLength(2);
  // Retour à la grille : plus de panneau, rien de surligné, focus sur le bouton.
  hybride().focus();
  hybride().click();
  expect(document.querySelector(".ya-recherche-fichier")).toBeNull();
  ctrlF(z.querySelector("td"));
  chercherCsv('""');
  expect(compteCsv()).toBe("0");
  chercherCsv("a");
  expect(compteCsv()).toBe("3");
  hybride().focus();
  hybride().click();
  expect(document.querySelector(".ya-recherche-fichier")).toBeNull();
  expect(z.querySelectorAll("mark.ya-occurrence")).toHaveLength(0);
  expect(document.activeElement).toBe(hybride());
  hybride().click();
  z = zoneDe("clients.csv");
  // Une saisie en cours : Ctrl+F la valide dans le document, puis ouvre le panneau.
  const td = z.querySelectorAll("td")[2];
  td.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const span = z.querySelector(".ya-cellule-saisie");
  span.textContent = "Laval";
  const ev = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
  span.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(z.contenu()).toContain("Alice,Paris,Laval");
  chercherCsv("a");
  expect(compteCsv()).toBe("4");
  // Autre onglet puis retour : le panneau, `a` et son surlignage sont là.
  aller(e, "README.md");
  aller(e, "clients.csv");
  expect(saisieCsv().value).toBe("a");
  expect(z.querySelectorAll("mark.ya-occurrence").length).toBe(5);
  // Rechargement : la liste est écrite (200 ms), un nouvel éditeur la relit : clients.csv revient sans panneau ni surlignage.
  await new Promise((ok) => setTimeout(ok, 300));
  expect(magasin.size).toBeGreaterThan(0);
  e.detruire();
  document.body.replaceChildren();
  let c2 = null;
  const e2 = vueEditeur({ dire: vi.fn(), surGroupes: (arbre, courant) => c2?.definirGroupes(arbre, courant) });
  editeurs.push(e2);
  c2 = cadre({ principal: { groupes: e2.groupes() } });
  document.body.append(c2);
  await e2.restaurer();
  expect(zoneDe("clients.csv")).toBeTruthy();
  expect(document.querySelector(".ya-recherche-fichier")).toBeNull();
  expect(document.querySelector("mark.ya-occurrence")).toBeNull();
});

// ---- REQ-161 : recherche dans un whiteboard ----
const PLAN = JSON.stringify({
  version: 1,
  boxes: [
    { id: "b1", x: 40, y: 40, width: 160, height: 80, text: "Serveur web" },
    { id: "b2", x: 400, y: 40, width: 160, height: 80, text: "Base de données" },
    { id: "b3", x: 40, y: 300, width: 160, height: 80, text: "Cache serveur" },
  ],
  links: [{ id: "l1", from: "b1", to: "b2", text: "appelle le serveur" }],
});
const zoneWb = () => document.querySelector(".ya-tableau-zone:not([hidden])");
const panneauWb = () => zoneWb().querySelector("[role=search]");
const monterPlan = (fichiers = {}) => monter({ "plan.jdiag": PLAN, "README.md": README, ...fichiers });

test("REQ161_AC1_ctrl_f_sur_la_surface_ou_la_boite_a_outils_ouvre_le_panneau_et_pas_sur_un_whiteboard_illisible", () => {
  const e = monterPlan({ "casse.jdiag": "pas du json" });
  aller(e, "plan.jdiag");
  const z = zoneWb();
  const surface = z.querySelector("[role=application]");
  surface.focus();
  const ev = ctrlF(surface);
  expect(ev.defaultPrevented).toBe(true);
  expect(panneauWb().getAttribute("aria-label")).toBe("Rechercher dans plan.jdiag");
  expect(z.firstElementChild).toBe(panneauWb());
  expect(document.activeElement).toBe(panneauWb().querySelector("input"));
  expect([...panneauWb().querySelectorAll("input, button")].map((x) => x.getAttribute("aria-label") ?? x.className)).toEqual(["champ-saisie ya-input", "Respecter la casse", "Expression régulière", "Occurrence précédente", "Occurrence suivante", "Fermer la recherche"]);
  // Depuis la boîte à outils : de même, la fenêtre étant déjà là, le champ reprend le focus.
  panneauWb().querySelector('button[aria-label="Fermer la recherche"]').click();
  expect(panneauWb()).toBeNull();
  const outils = z.querySelector("[role=toolbar] button");
  outils.focus();
  expect(ctrlF(outils).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(panneauWb().querySelector("input"));
  // Whiteboard illisible : Ctrl+F ne change pas.
  aller(e, "casse.jdiag");
  const illisible = zoneWb();
  expect(illisible.querySelector("[role=application]")).toBeNull();
  expect(ctrlF(illisible).defaultPrevented).toBe(false);
  expect(illisible.querySelector("[role=search]")).toBeNull();
});

test("REQ207_AC1_ctrl_h_sur_la_surface_d_un_whiteboard_ouvre_la_ligne_de_remplacement_finit_la_saisie_et_ne_fait_rien_sur_un_illisible", () => {
  const e = monterPlan({ "casse.jdiag": "pas du json" });
  aller(e, "plan.jdiag");
  const z = zoneWb();
  const surface = z.querySelector("[role=application]");
  surface.focus();
  const ev = ctrlH(surface);
  expect(ev.defaultPrevented).toBe(true);
  expect(panneauWb().querySelectorAll("input")).toHaveLength(2);
  expect(panneauWb().querySelector('button[aria-label="Remplacer"]')).not.toBeNull();
  expect(panneauWb().querySelector('button[aria-label="Tout remplacer"]')).not.toBeNull();
  expect(document.activeElement).toBe(panneauWb().querySelector("input"));
  // Pendant la saisie d'une boîte : la saisie finit, la fenêtre s'ouvre.
  panneauWb().querySelector('button[aria-label="Fermer la recherche"]').click();
  surface.focus();
  z.querySelector('[data-id="b1"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  const saisie = z.querySelector("[role=textbox]");
  expect(saisie).not.toBeNull();
  expect(ctrlH(saisie).defaultPrevented).toBe(true);
  expect(z.querySelector("[role=textbox]")).toBeNull();
  expect(panneauWb().querySelectorAll("input")).toHaveLength(2);
  // Whiteboard illisible : rien.
  aller(e, "casse.jdiag");
  const illisible = zoneWb();
  expect(ctrlH(illisible).defaultPrevented).toBe(false);
  expect(illisible.querySelector("[role=search]")).toBeNull();
});

test("REQ161_AC7_ctrl_f_pendant_la_saisie_la_finit_le_panneau_survit_au_changement_d_onglet_pas_au_rechargement", async () => {
  stubFichiers();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const e = monter({});
  await e.restaurer();
  for (const [chemin, contenu] of Object.entries({ "plan.jdiag": PLAN, "README.md": README })) e.ouvrir({ chemin, contenu, version: "1" });
  aller(e, "plan.jdiag");
  const z = zoneWb();
  const surface = z.querySelector("[role=application]");
  surface.focus();
  z.querySelector('[data-id="b1"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  const saisie = z.querySelector("[role=textbox]");
  expect(saisie).not.toBeNull();
  const ev = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
  saisie.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(z.querySelector("[role=textbox]")).toBeNull();
  expect(panneauWb()).not.toBeNull();
  const champ = panneauWb().querySelector("input");
  champ.value = "serveur";
  champ.dispatchEvent(new Event("input", { bubbles: true }));
  expect(z.querySelectorAll("mark.ya-occurrence")).toHaveLength(3);
  // Autre onglet puis retour.
  aller(e, "README.md");
  expect(z.hidden).toBe(true);
  aller(e, "plan.jdiag");
  expect(panneauWb().querySelector("input").value).toBe("serveur");
  expect(panneauWb().querySelector(".ya-recherche-compteur").textContent).toBe("3");
  expect(z.querySelectorAll("mark.ya-occurrence")).toHaveLength(3);
  // Rechargement : la liste est relue, le panneau est fermé.
  vi.advanceTimersByTime(300);
  e.detruire();
  document.body.replaceChildren();
  let c2 = null;
  const e2 = vueEditeur({ dire: vi.fn(), surGroupes: (arbre, courant) => c2?.definirGroupes(arbre, courant) });
  editeurs.push(e2);
  c2 = cadre({ principal: { groupes: e2.groupes() } });
  document.body.append(c2);
  await e2.restaurer();
  expect(document.querySelector(".ya-tableau-zone")).not.toBeNull();
  expect(document.querySelector("[role=search]")).toBeNull();
  expect(document.querySelector("mark.ya-occurrence")).toBeNull();
  vi.useRealTimers();
});

test("REQ207_AC1_ctrl_h_sur_la_grille_ouvre_la_recherche_avec_la_ligne_de_remplacement", () => {
  const e = monter();
  aller(e, "clients.csv");
  const td = zoneDe("clients.csv").querySelector("td");
  td.focus();
  const ev = ctrlH(td);
  expect(ev.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(saisieCsv());
  expect(lignes(panneauCsv())).toEqual(REMPLACER);
});
