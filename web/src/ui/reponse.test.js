import { expect, test } from "vitest";
import { rendreMarkdown, rendreReponse } from "./apercu.js";

const dom = (texte) => {
  const d = document.createElement("div");
  d.innerHTML = rendreReponse(texte);
  return d;
};
const URL_ = "https://exemple.org/a";

test("REQ077_AC4_liens_partout", () => {
  const d = dom(`[doc](${URL_}) fin\n\n| a |\n|---|\n| [doc](${URL_}) |\n\n> [doc](${URL_})\n\n- [doc](${URL_})`);
  const liens = [...d.querySelectorAll("a")];
  expect(liens).toHaveLength(4);
  for (const a of liens) expect(a.getAttribute("href")).toBe(URL_);
  for (const p of ["p", "td", "blockquote", "li"]) expect(d.querySelector(`${p} a`)).not.toBeNull();
});

test("REQ077_AC7_styles_de_couleur_poses_une_seule_fois", () => {
  rendreReponse("```rust\nfn main() {}\n```");
  rendreReponse("```rust\nfn main() {}\n```");
  const styles = document.head.querySelectorAll("style");
  expect(styles).toHaveLength(1);
  expect(styles[0].textContent).toContain("--syn-keyword");
  expect(dom("```rust\nfn main() {}\n```").querySelector("pre span").textContent).toBe("fn");
});

test("REQ077_AC7_bloc_sans_langage_texte_exact", () => {
  const pre = dom("```\nfn <a> & b\n```").querySelector("pre");
  expect(pre.querySelector("span")).toBeNull();
  expect(pre.textContent).toBe("fn <a> & b\n");
});

test("REQ077_AC21_note_sur_une_ligne_et_sur_deux", () => {
  for (const src of ["> [!NOTE] Il faut Rust 1.80", "> [!NOTE]\n> Il faut Rust 1.80"]) {
    const b = dom(src).querySelector("blockquote.ya-note");
    expect(b.querySelector("p.ya-note-titre").textContent).toBe("Note");
    expect(b.textContent.replace(/\s+/g, " ").trim()).toBe("Note Il faut Rust 1.80");
    expect(b.textContent).not.toContain("[!NOTE]");
  }
  expect(dom("> [!NOTE]").querySelectorAll("blockquote.ya-note p")).toHaveLength(1);
});

test("REQ077_AC21_warning_reste_citation", () => {
  const d = dom("> [!WARNING] Attention");
  expect(d.querySelector("blockquote").classList.contains("ya-note")).toBe(false);
  expect(d.querySelector("blockquote").textContent.trim()).toBe("[!WARNING] Attention");
});

test("REQ077_AC21_marque_dans_le_code_reste_du_code", () => {
  const d = dom("> `[!NOTE]` x\n\n```\n[!NOTE] y\n```");
  expect(d.querySelector(".ya-note")).toBeNull();
  expect(d.querySelector("blockquote code").textContent).toBe("[!NOTE]");
  expect(d.querySelector("pre").textContent).toBe("[!NOTE] y\n");
});

test("REQ077_AC23_cases", () => {
  const d = dom("- [ ] à faire\n- [x] fait\n- [X] fait\n- [ab] texte\n\n1. [ ] num");
  const [a, b, c, e] = [...d.querySelectorAll("ul > li")];
  expect(a.querySelector("input").checked).toBe(false);
  expect(b.querySelector("input").checked).toBe(true);
  expect(c.querySelector("input").checked).toBe(true);
  expect(a.querySelector("input").disabled).toBe(true);
  expect(a.textContent).toBe("à faire");
  expect(b.textContent).toBe("fait");
  expect(a.classList.contains("ya-tache")).toBe(true);
  expect(e.textContent).toBe("[ab] texte");
  expect(e.querySelector("input")).toBeNull();
  expect(d.querySelector("ol li").textContent).toBe("[ ] num");
  expect(d.querySelector("ol input")).toBeNull();
  // liste lâche
  const l = dom("- [ ] un\n\n- [x] deux");
  expect(l.querySelectorAll("li input")).toHaveLength(2);
  expect(l.querySelector("li p").textContent).toBe("un");
  // sous-liste
  const s = dom("- a\n  - [x] b");
  expect(s.querySelector("ul ul li input").checked).toBe(true);
  expect(s.querySelector("ul ul li").textContent).toBe("b");
});

test("REQ077_AC23_clic_sans_effet", () => {
  const d = dom("- [ ] a");
  document.body.append(d);
  const i = d.querySelector("input");
  i.click();
  expect(i.checked).toBe(false);
});

test("REQ077_AC24_nom_accessible", () => {
  const d = dom("- [ ] a\n- [x] b");
  const [a, b] = d.querySelectorAll("input");
  expect(a.getAttribute("aria-label")).toBe("À faire");
  expect(b.getAttribute("aria-label")).toBe("Fait");
});

test("REQ077_AC25_adresses", () => {
  const liens = (s) => [...dom(s).querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent]);
  expect(liens("Voir https://exemple.org/a.")).toEqual([[URL_, URL_]]);
  expect(dom("Voir https://exemple.org/a.").querySelector("p").textContent).toBe("Voir https://exemple.org/a.");
  expect(liens("Voir http://exemple.org/a")).toEqual([["http://exemple.org/a", "http://exemple.org/a"]]);
  expect(liens("| a |\n|---|\n| https://exemple.org/a |")).toHaveLength(1);
  expect(liens("> https://exemple.org/a")).toHaveLength(1);
  expect(liens("- https://exemple.org/a")).toHaveLength(1);
  expect(liens("`https://exemple.org/a`")).toEqual([]);
  expect(liens("```\nhttps://exemple.org/a\n```")).toEqual([]);
  expect(liens("[texte](https://exemple.org/b)")).toEqual([["https://exemple.org/b", "texte"]]);
  expect(liens("exemple.org et moi@exemple.org")).toEqual([]);
  expect(liens("ftp://exemple.org/x")).toEqual([]);
  expect(liens("//x.org")).toEqual([]);
  expect(liens("mailto:moi@exemple.org")).toEqual([]);
});

test("REQ077_AC26_AC27_attributs_de_chaque_lien", () => {
  const d = dom(`[doc](${URL_}) ${URL_} [rel](/a/b) [titre](${URL_} "mon titre")`);
  const liens = [...d.querySelectorAll("a")];
  expect(liens).toHaveLength(4);
  for (const a of liens) {
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("title")).toBe("S'ouvre dans un nouvel onglet du navigateur.");
  }
});

test("REQ077_html_brut_et_javascript_refuses", () => {
  const d = dom("<script>alert(1)</script> <b>x</b> [m](javascript:alert(1))");
  expect(d.querySelector("script")).toBeNull();
  expect(d.querySelector("b")).toBeNull();
  expect(d.querySelector("a")).toBeNull();
  expect(d.textContent).toContain("<script>");
});

test("REQ077_image_remplacee_par_son_texte", () => {
  const d = dom("![chat](https://exemple.org/c.png)");
  expect(d.querySelector("img")).toBeNull();
  expect(d.textContent.trim()).toBe("chat");
});

test("REQ077_apercu_inchange", () => {
  const h = document.createElement("div");
  h.innerHTML = rendreMarkdown("> [!NOTE] x\n\n- [ ] a\n\nhttps://exemple.org/a");
  expect(h.querySelector(".ya-note")).toBeNull();
  expect(h.querySelector("blockquote").textContent.trim()).toBe("[!NOTE] x");
  expect(h.querySelector("li").textContent).toBe("[ ] a");
  expect(h.querySelector("input")).toBeNull();
  expect(h.querySelector("a")).toBeNull();
});
