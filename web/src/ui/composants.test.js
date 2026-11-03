import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("web/src/ui/composants.css", "utf8");

test("REQ028_AC7_focus_visible_a_contour_accent_sur_boutons_et_champs", () => {
  expect(css).toMatch(/\.ya-btn:focus-visible[^{]*{[^}]*outline:\s*2px solid var\(--accent-fg\)/);
  expect(css).toMatch(/\.ya-input:focus-visible\s*{[^}]*outline:\s*1px solid var\(--accent-fg\)/);
});

test("REQ028_AC3_composants_n_utilisent_que_des_tokens", () => {
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  // Les règles `ya-` reprennent les tailles de bundle.css (design-system.md, Typographie) ; les autres passent par les tokens.
  const hors = css.replace(/\/\*[^]*?\*\//g, "").replace(/[^{}]*\bya-[^{}]*\{[^}]*\}/g, "");
  expect(hors).not.toMatch(/\d+px/);
  expect(css).not.toMatch(/transition|animation/);
});

// Corps de la règle dont le sélecteur (liste exacte) est donné.
function regle(selecteur) {
  for (const m of css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (sels.includes(selecteur)) return m[2];
  }
  throw new Error(`règle absente : ${selecteur}`);
}
const a = (sel, decl) => expect(regle(sel).replace(/\s+/g, " ")).toContain(decl);

test("REQ036_AC1_bouton_reprend_les_regles_ya_de_bundle_css", () => {
  a(".ya-btn", "height: var(--size-control)");
  a(".ya-btn", "border-radius: var(--radius-sm)");
  a(".ya-btn", "border: 1px solid var(--line-strong)");
  a(".ya-btn", "background: var(--bg-300)");
  a(".ya-btn", "color: var(--ink)");
  a(".ya-btn", "font-family: var(--font-sans)");
  a(".ya-btn-primary", "background: var(--accent)");
  a(".ya-btn-primary", "color: var(--on-accent)");
  a(".ya-btn-danger", "color: var(--danger)");
  a(".ya-btn[disabled]", "opacity: .45");
  expect(css).not.toMatch(/^\.bouton-(principal|danger|secondaire|discret)\b/m);
});

test("REQ028_AC3_champ_etats", () => {
  a(".ya-input", "background: var(--bg-300)");
  a(".ya-input", "border: 1px solid var(--line-strong)");
  a(".ya-input", "color: var(--ink)");
  a(".ya-input", "height: var(--size-control)");
  a(".ya-input", "border-radius: var(--radius-sm)");
  a(".ya-textarea", "min-height: 56px");
  a(".ya-textarea", "resize: vertical");
  a(".ya-input:disabled", "opacity: .45");
  a(".ya-input:focus-visible", "outline-offset: 0");
  a(".ya-input:focus-visible", "border-color: var(--accent-fg)");
  a('.ya-input[aria-invalid="true"]', "border-color: var(--danger)");
  a(".champ-erreur", "color: var(--danger)");
  a(".champ-erreur", "font: var(--texte-petit) var(--font-sans)");
  a(".champ-aide", "color: var(--ink-muted)");
  a(".champ-aide", "font: var(--texte-petit) var(--font-sans)");
});

test("REQ028_AC3_message_detail_defile_en_police_mono", () => {
  a(".message-detail", "max-height: var(--hauteur-detail)");
  a(".message-detail", "overflow: auto");
  a(".message-detail", "var(--font-mono)");
});

test("REQ028_AC3_indication_style_et_masquage", () => {
  a(".indication", "color: var(--texte-attenue)");
  a(".indication", "font: var(--texte-base) var(--police-ui)");
  a(".indication", "padding: var(--esp-3)");
  a(".indication[hidden]", "display: none");
});

test("REQ038_AC5_le_champ_suit_le_theme_de_la_page", () => {
  // Aucune règle du champ ne fige color-scheme : la liste native et les barres de défilement suivent <html>.
  expect(css.replace(/\/\*[^]*?\*\//g, "")).not.toMatch(/color-scheme/);
  const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
  expect(tokens).toMatch(/\[data-theme="dark"\]\s*{\s*color-scheme:\s*dark;/);
  expect(tokens).toMatch(/\[data-theme="light"\]\s*{\s*color-scheme:\s*light;/);
});
