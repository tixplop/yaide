import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { bouton } from "./bouton.js";
import { cadre } from "./cadre.js";

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
  expect(css).not.toMatch(/animation/);
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
  a(".indication", "color: var(--ink-muted)");
  a(".indication", "font: var(--texte-base) var(--font-sans)");
  a(".indication", "padding: var(--space-2)");
  a(".indication[hidden]", "display: none");
});

test("REQ068_AC21_claude_hidden_masque_le_terminal", () => {
  a(".claude[hidden]", "display: none");
});

test("REQ038_AC5_le_champ_suit_le_theme_de_la_page", () => {
  // Aucune règle du champ ne fige color-scheme : la liste native et les barres de défilement suivent <html>.
  expect(css.replace(/\/\*[^]*?\*\//g, "")).not.toMatch(/color-scheme/);
  const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
  expect(tokens).toMatch(/\[data-theme="dark"\]\s*{\s*color-scheme:\s*dark;/);
  expect(tokens).toMatch(/\[data-theme="light"\]\s*{\s*color-scheme:\s*light;/);
});

test("REQ036_AC13_seul_le_chevron_de_l_arbre_a_une_transition_coupee_par_reduced_motion", () => {
  const sans = css.replace(/\/\*[^]*?\*\//g, "");
  const lignes = sans.split("\n").filter((l) => /transition/.test(l));
  // Le chevron de l'arbre et celui d'un appel d'outil (C-015) : 2 lignes chacun.
  expect(lignes).toHaveLength(6);
  expect(lignes[0]).toMatch(/^\.liste-chevron svg \{[^}]*transition: transform \.12s;/);
  expect(lignes[1]).toMatch(/^@media \(prefers-reduced-motion: reduce\) \{ \.liste-chevron svg \{ transition: none; \} \}/);
  a('[aria-expanded="true"] > .liste-chevron svg', "transform: rotate(90deg)");
  expect(lignes[4]).toMatch(/^\.ya-step-chev \{[^}]*transition: transform 120ms;/);
  expect(lignes[5]).toMatch(/^@media \(prefers-reduced-motion: reduce\) \{ \.ya-step-chev \{ transition: none; \} \}/);
});

test("REQ036_AC13_chaque_transition_de_xterm_css_est_annulee", () => {
  const xterm = readFileSync("node_modules/@xterm/xterm/css/xterm.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
  const transitions = [...xterm.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /transition/.test(m[2])).map((m) => m[1].trim().replace(/\s*>\s*/g, ">"));
  expect(transitions.length).toBeGreaterThan(0);
  for (const sel of transitions) expect(regle(sel), sel).toMatch(/transition: none/);
});

test("REQ070_les_8_px_de_claude_seulement_quand_il_suit_une_autre_commande", () => {
  expect(css).toMatch(/\.cadre-rail-droit \.bouton-enveloppe:nth-child\(n\+3\)\s*{[^}]*margin-top: var\(--space-2\)/);
  const commande = (nom) => bouton({ icone: "bot", nomAccessible: nom }).enveloppe;
  const seul = cadre({ fonctions: { agents: false }, railDroit: { commandes: [] } });
  const claude = commande("Claude");
  seul.ajouterCommandeDroite(claude);
  expect(claude.matches(".cadre-rail-droit .bouton-enveloppe:nth-child(n+3)")).toBe(false);
  const agent = commande("Agent");
  const agents = commande("Agents");
  const claude2 = commande("Claude");
  cadre({ railDroit: { commandes: [agent, agents, claude2] } });
  expect(claude2.matches(".cadre-rail-droit .bouton-enveloppe:nth-child(n+3)")).toBe(true);
  expect(agents.matches(".cadre-rail-droit .bouton-enveloppe:nth-child(n+3)")).toBe(false);
});

test("REQ071_regles_du_groupe_de_reglages", () => {
  const sans = css.replace(/\/\*[^]*?\*\//g, "");
  const r = (sel) => sans.match(new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))[1].replace(/\s+/g, " ");
  expect(r(".ya-reglages fieldset")).toContain("border: 0");
  expect(r(".ya-reglages fieldset")).toContain("margin: 0");
  expect(r(".ya-reglages fieldset")).toContain("gap: var(--space-2)");
  expect(r(".ya-reglages legend")).toContain("600 13px/20px");
  expect(r(".ya-reglages legend")).toContain("color: var(--ink)");
  expect(r(".ya-reglages legend")).toContain("margin-bottom: var(--space-2)");
  expect(r(".ya-reglages .ya-groupe-ligne")).toContain("column-gap: var(--space-6)");
  expect(r(".ya-reglages .ya-groupe-ligne")).toContain("flex-wrap: wrap");
  expect(r(".ya-reglages .ya-groupe-aide")).toContain("font: var(--texte-petit)");
  expect(r(".ya-reglages .ya-groupe-aide")).toContain("color: var(--ink-muted)");
});
