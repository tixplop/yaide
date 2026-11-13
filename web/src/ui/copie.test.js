import { afterEach, expect, test } from "vitest";
import { copierEnTexteSimple } from "./copie.js";
import { rendreMarkdown, rendreReponse } from "./apercu.js";
import { champ } from "./champ.js";

copierEnTexteSimple();

const MD = "# Titre\n\nUn mot en **gras** et un [lien](https://exemple.org).\n\n| a | b |\n|---|---|\n| cellule1 | cellule2 |\n";
const REPONSE = "Voici du **gras** :\n\n- un\n- deux\n\n```js\nfunction f() {\n  return 1;\n}\n```\n";

afterEach(() => {
  document.body.replaceChildren();
  getSelection().removeAllRanges();
});

// Copie la sélection : renvoie les setData notés et l'événement.
function copier(cible, { avant = false } = {}) {
  const appels = [];
  const e = new Event("copy", { bubbles: true, cancelable: true });
  e.clipboardData = { setData: (t, v) => appels.push([t, v]) };
  if (avant) e.preventDefault();
  cible.dispatchEvent(e);
  return { appels, e };
}
function tout(noeud) {
  document.body.append(noeud);
  const r = document.createRange();
  r.selectNodeContents(noeud);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
}
const vue = (html) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
};

test("REQ102_AC7_apercu_markdown_copie_en_texte_simple", () => {
  const d = vue(rendreMarkdown(MD));
  tout(d);
  const { appels, e } = copier(d);
  expect(appels).toHaveLength(1);
  expect(appels[0][0]).toBe("text/plain");
  const t = appels[0][1];
  expect(t).toContain("Titre");
  expect(t).toContain("Un mot en gras et un lien.");
  expect(t).toContain("cellule1");
  expect(t).toContain("cellule2");
  for (const m of ["#", "**", "[", "](", "exemple.org"]) expect(t).not.toContain(m);
  expect(e.defaultPrevented).toBe(true);
});

test("REQ102_AC8_reponse_agent_et_opencode_en_texte_simple_code_intact", () => {
  // La conversation de l'agent (C-015) et celle d'opencode rendent leurs réponses avec rendreReponse.
  for (let i = 0; i < 2; i++) {
    const d = vue(rendreReponse(REPONSE));
    tout(d);
    const { appels, e } = copier(d);
    expect(appels).toHaveLength(1);
    expect(appels[0][0]).toBe("text/plain");
    const t = appels[0][1];
    expect(t).toContain("Voici du gras :");
    expect(t).toContain("un");
    expect(t).toContain("deux");
    expect(t).not.toContain("**");
    expect(t).not.toContain("```");
    expect(t).toContain("function f() {\n  return 1;\n}");
    expect(e.defaultPrevented).toBe(true);
    document.body.replaceChildren();
  }
});

test("REQ102_AC7_evenement_deja_traite_cible_textarea_ou_selection_vide_sans_setData", () => {
  const d = vue("<p>texte</p>");
  tout(d);
  expect(copier(d, { avant: true }).appels).toHaveLength(0);
  const ta = document.createElement("textarea");
  d.append(ta);
  expect(copier(ta).appels).toHaveLength(0);
  const inp = document.createElement("input");
  d.append(inp);
  expect(copier(inp).appels).toHaveLength(0);
  getSelection().removeAllRanges();
  const r = copier(d);
  expect(r.appels).toHaveLength(0);
  expect(r.e.defaultPrevented).toBe(false);
});

test("REQ102_AC11_champs_de_saisie_sont_textarea_ou_input", () => {
  const multi = champ({ libelle: "Message", type: "multiligne" });
  const simple = champ({ libelle: "Rechercher" });
  expect(multi.querySelector("textarea")).not.toBeNull();
  expect(simple.querySelector("input")).not.toBeNull();
});
