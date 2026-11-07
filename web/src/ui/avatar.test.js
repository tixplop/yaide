import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { avatar, compterCaracteres, premiereLettre } from "./avatar.js";

const css = readFileSync("web/src/ui/composants.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
const regle = (sel) => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1].split(",").map((x) => x.trim()).includes(sel)) return m[2].replace(/\s+/g, " ");
  throw new Error(`règle absente : ${sel}`);
};

test("REQ065_AC8_avatar_20_px_premiere_lettre_et_emoji", () => {
  const a = avatar({ nom: "relecteur", couleur: "vert" });
  expect(a.textContent).toBe("R");
  expect(a.getAttribute("aria-hidden")).toBe("true");
  expect(a.style.getPropertyValue("--c")).toBe("var(--agent-vert)");
  expect(a.classList.contains("emoji")).toBe(false);
  expect(avatar({ nom: "x" }).style.getPropertyValue("--c")).toBe("var(--agent-violet)");
  expect(avatar({ nom: "Testeur", avatar: "QA" }).textContent).toBe("QA");
  const e = avatar({ nom: "Relecteur", avatar: "🦉" });
  expect(e.textContent).toBe("🦉");
  expect(e.classList.contains("emoji")).toBe(true);
  expect(premiereLettre("écrivain")).toBe("É");
  expect(premiereLettre("🦉 chouette")).toBe("🦉");
  expect(premiereLettre("   ")).toBe("");
  expect(regle(".ya-avatar")).toContain("width: 20px");
  expect(regle(".ya-avatar")).toContain("color: var(--on-accent)");
  expect(regle(".ya-avatar")).toContain("font: 600 11px/1 var(--font-sans)");
  expect(regle(".ya-avatar.emoji")).toContain("font-size: 13px");
  expect(() => avatar({ nom: "x", couleur: "bleu" })).toThrow(/couleur/);
  expect(() => avatar({ nom: "" })).toThrow(/nom/);
});

test("deux_caracteres_par_graphemes", () => {
  expect(compterCaracteres("🦉")).toBe(1);
  expect(compterCaracteres("QA")).toBe(2);
  expect(compterCaracteres("QA!")).toBe(3);
  expect(compterCaracteres("👩‍💻")).toBe(1);
  expect(compterCaracteres("")).toBe(0);
});
