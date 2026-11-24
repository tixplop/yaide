import { test, expect, vi, afterEach } from "vitest";
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

// --- Diagrammes mermaid (REQ-122) ---
const dessinerMock = vi.hoisted(() => vi.fn());
const chargerMock = vi.hoisted(() => vi.fn());
vi.mock("./diagramme.js", async (orig) => ({ ...(await orig()), chargerMermaid: chargerMock }));

const dess = (nom) => ({ svg: `<svg>${nom}</svg>`, largeur: 120, hauteur: 80 });
const texteSvg = (img) => decodeURIComponent(img.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
const FLUX = "avant\n\n```mermaid\ngraph TD; A --> B\n```\n\n```rust\nfn main() {}\n```\n\n```mermaid\ngraph LR; C --> D\n```\n";

async function creerDiag(texte = FLUX) {
  vi.useFakeTimers();
  dessinerMock.mockReset().mockImplementation(async (t) => dess(t.split("\n")[0]));
  chargerMock.mockReset().mockResolvedValue({ dessiner: dessinerMock });
  const el = apercu({ document: "a.md" });
  document.body.append(el);
  el.maj(texte);
  return el;
}
const passer = (ms = 150) => vi.advanceTimersByTimeAsync(ms);
afterEach(() => vi.useRealTimers());

test("REQ122_AC1_AC5_AC10_img_a_la_place_du_bloc_dans_l_ordre_bloc_rust_colore", async () => {
  const el = await creerDiag();
  expect(el.querySelectorAll("pre[data-diagramme]").length).toBe(2); // tant que mermaid charge : pre, rien d'autre
  expect(el.textContent).not.toMatch(/Chargement/);
  await passer();
  const imgs = [...el.querySelectorAll(".ya-diagramme img")];
  expect(imgs.length).toBe(2);
  expect(texteSvg(imgs[0])).toContain("graph TD; A --> B");
  expect(texteSvg(imgs[1])).toContain("graph LR; C --> D");
  expect(el.textContent).not.toContain("graph TD");
  expect(el.querySelector("pre code.language-rust")).not.toBeNull();
  expect(el.querySelector("pre span[class]")).not.toBeNull();
  const img = imgs[0];
  expect(img.getAttribute("alt")).toBe("Diagramme");
  expect(img.getAttribute("draggable")).toBe("false");
  expect(img.getAttribute("width")).toBe("120");
  expect(img.getAttribute("height")).toBe("80");
  expect(img.hasAttribute("tabindex")).toBe(false);
  expect(el.querySelectorAll(".ya-diagramme a, .ya-diagramme [tabindex]").length).toBe(0);
});

test("REQ122_AC3_nouveau_dessin_apres_la_frappe_src_au_load_et_taper_ailleurs_ne_redessine_pas", async () => {
  const el = await creerDiag();
  await passer();
  const img = el.querySelector(".ya-diagramme img");
  const avant = img.src;
  dessinerMock.mockClear();
  el.maj(FLUX.replace("avant", "autre"));
  await passer();
  expect(dessinerMock).not.toHaveBeenCalled();
  expect(el.querySelector(".ya-diagramme img")).toBe(img);
  let charge;
  const Vrai = globalThis.Image;
  globalThis.Image = class { set src(v) { charge = this; } };
  el.maj(FLUX.replace("A --> B", "A --> Z"));
  expect(el.querySelector(".ya-diagramme img")).toBe(img); // ancien dessin gardé pendant la frappe
  await passer(99);
  expect(dessinerMock).not.toHaveBeenCalled();
  await passer(2);
  expect(dessinerMock).toHaveBeenCalledTimes(1);
  expect(img.src).toBe(avant); // pas encore chargé
  globalThis.Image = Vrai;
  charge.onload();
  expect(texteSvg(img)).toContain("A --> Z");
});

test("REQ122_AC3_nouveau_dessin_contenant_Suite_pendant_une_coupure_sans_aucune_requete", async () => {
  const el = await creerDiag();
  await passer();
  const img = el.querySelector(".ya-diagramme img");
  const fetchVrai = globalThis.fetch;
  const Vrai = globalThis.Image;
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("coupure")));
  globalThis.Image = class { set src(v) { setTimeout(() => this.onload()); } };
  try {
    el.maj(FLUX.replace("A --> B", "S --> A[Suite]"));
    await passer();
    expect(texteSvg(img)).toContain("Suite");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = fetchVrai;
    globalThis.Image = Vrai;
  }
});

test("REQ122_AC4_null_garde_le_dessin_et_bloc_jamais_lu_reste_en_pre", async () => {
  const el = await creerDiag();
  await passer();
  const img = el.querySelector(".ya-diagramme img");
  const avant = img.src;
  const texteAvant = el.textContent;
  dessinerMock.mockClear();
  dessinerMock.mockImplementation(async (t) => (t.includes("A -->\n") ? null : dess(t.split("\n")[0])));
  el.maj(FLUX.replace("A --> B", "A -->"));
  await passer();
  expect(dessinerMock).toHaveBeenCalledWith("graph TD; A -->\n");
  expect(el.querySelector(".ya-diagramme img")).toBe(img);
  expect(img.src).toBe(avant);
  expect(el.querySelector("pre[data-diagramme]")).toBeNull();
  expect(el.textContent).toBe(texteAvant);
  // le texte redevient lisible : le dessin suit de nouveau
  const Vrai = globalThis.Image;
  globalThis.Image = class { set src(v) { setTimeout(() => this.onload()); } };
  try {
    el.maj(FLUX.replace("A --> B", "A --> Q"));
    await passer();
  } finally {
    globalThis.Image = Vrai;
  }
  expect(texteSvg(img)).toContain("A --> Q");
  const el2 = await creerDiag("```mermaid\nn'importe quoi\n```\n");
  dessinerMock.mockImplementation(async () => null);
  await passer();
  expect(el2.querySelector("img")).toBeNull();
  expect(el2.textContent).toBe("n'importe quoi\n\n");
  expect(el2.querySelector("pre").className).toBe("");
  expect(el2.querySelector("code").className).toBe("");
});

test("REQ122_AC4_coupure_avant_le_chargement_pre_puis_dessin_au_retour", async () => {
  const el = await creerDiag("```mermaid\ngraph TD; A --> B\n```\n");
  chargerMock.mockRejectedValueOnce(new Error("coupé"));
  el.maj("```mermaid\ngraph TD; A --> B\n```\n");
  await passer();
  expect(el.querySelector("pre[data-diagramme]")).not.toBeNull();
  await passer(1600);
  expect(el.querySelector(".ya-diagramme img")).not.toBeNull();
});

test("REQ122_AC6_clic_sur_l_img_ne_navigue_pas", async () => {
  const surLien = vi.fn();
  const el = await creerDiag();
  el.remove();
  const el2 = apercu({ document: "a.md", surLien });
  document.body.append(el2);
  el2.maj(FLUX);
  await passer();
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  el2.querySelector(".ya-diagramme img").dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
  expect(surLien).not.toHaveBeenCalled();
  expect(el2.querySelectorAll(".ya-diagramme a").length).toBe(0);
});

test("REQ169_AC6_apercu_souligne_u_et_echappe_les_autres_balises", () => {
  const el = apercu({ document: "a.md" });
  document.body.append(el);
  el.maj("un <u>mot</u> et **<u>gras</u>**, `<u>code</u>`, <b>x</b> <script>y</script> <u>seul \\<u>a\\</u> &lt;u&gt;b&lt;/u&gt;");
  const u = [...el.querySelectorAll("u")].map((n) => n.textContent);
  expect(u).toEqual(["mot", "gras"]);
  expect(el.querySelector("b, script")).toBeNull();
  expect(el.textContent).toContain("<b>x</b>");
  expect(el.textContent).toContain("<script>y</script>");
  expect(el.textContent).toContain("<u>seul");
  expect(el.textContent).toContain("<u>a</u> <u>b</u>");
  expect(el.querySelector("code").textContent).toBe("<u>code</u>");
});

const cases = (el) => [...el.querySelectorAll("input[type=checkbox]")];

test("REQ171_AC1_AC8_cases_actives_sans_crochets_et_texte_restant", () => {
  const el = apercu({ document: "a.md" });
  document.body.append(el);
  el.maj("- [ ] à faire\n- [x] fait\n\n1. [ ] num\n\n- [ab] autre\n\n```\n- [ ] code\n```\n");
  const c = cases(el);
  expect(c.length).toBe(2);
  expect(c.map((i) => [i.disabled, i.checked, i.hasAttribute("tabindex")])).toEqual([[false, false, false], [false, true, false]]);
  expect(c.map((i) => i.getAttribute("aria-label"))).toEqual(["à faire", "fait"]);
  const li = [...el.querySelectorAll("li.ya-tache")].map((l) => l.textContent.trim());
  expect(li).toEqual(["à faire", "fait"]);
  expect(el.textContent).toContain("1. [ ] num".replace("1. ", "")); // « [ ] num » reste du texte
  expect(el.textContent).toContain("[ab] autre");
  expect(el.textContent).toContain("- [ ] code");
});

test("REQ171_AC3_AC8_ligne_source_imbriquee_citation_et_nom_sans_sous_liste", () => {
  const surCase = vi.fn();
  const el = apercu({ document: "a.md", surCase });
  document.body.append(el);
  el.maj("- [ ] a\n  - [x] b\n\n> - [ ] c\n");
  const c = cases(el);
  expect(c.map((i) => i.dataset.ligne)).toEqual(["0", "1", "3"]);
  expect(c[0].getAttribute("aria-label")).toBe("a");
  c[2].click();
  expect(surCase).toHaveBeenCalledWith(3);
  c[1].click();
  expect(surCase).toHaveBeenLastCalledWith(1);
});

test("REQ171_AC8_focus_rendu_a_la_case_de_meme_rang_apres_le_rendu", () => {
  const el = apercu({ document: "a.md", surCase: () => el.maj("- [ ] a\n- [x] b\n") });
  document.body.append(el);
  el.maj("- [ ] a\n- [ ] b\n");
  cases(el)[1].click();
  expect(document.activeElement).toBe(cases(el)[1]);
  expect(cases(el)[1].checked).toBe(true);
});

test("REQ044_AC11_tab_seulement_liens_et_cases", () => {
  const el = apercu({ document: "a.md" });
  document.body.append(el);
  el.maj("[l](https://x.org)\n\n- [ ] a\n\n```\ncode\n```\n\n| a |\n|---|\n| b |\n");
  const arrets = [...el.querySelectorAll("a, input, pre, table, [tabindex]")].filter((n) => n.tabIndex >= 0);
  expect(arrets.map((n) => n.tagName)).toEqual(["A", "INPUT"]);
});
