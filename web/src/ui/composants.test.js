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

test("REQ072_AC22_regles_de_la_ligne_de_sous_agent", () => {
  a(".ya-sous", "height: var(--size-control)");
  a(".ya-sous", "display: flex");
  a(".ya-sous-agent", "font: 600 12px var(--font-mono)");
  a(".ya-sous-agent", "flex: none");
  a(".ya-sous-titre", "flex: 1");
  a(".ya-sous-titre", "min-width: 0");
  a(".ya-sous-titre", "text-overflow: ellipsis");
  a(".ya-sous-titre", "white-space: nowrap");
  a(".ya-sous-titre", "color: var(--ink-muted)");
  a(".ya-sous-etat", "flex: none");
  // 2 px des appels d'outil voisins, comme entre deux appels d'outil
  a(".ya-chat > .ya-steps + .ya-sous", "margin-top: -10px");
  a(".ya-chat > .ya-sous + .ya-steps", "margin-top: -10px");
  a(".ya-tour-corps > .ya-sous + .ya-sous", "margin-top: -10px");
});

test("REQ072_AC26_regles_du_message_a_champs", () => {
  a(".message-avec-champs", "background: none");
  a(".message-avec-champs", "border-left-color: var(--info)");
  a(".message-champs", "display: grid");
  a(".message-champs", "grid-template-columns: repeat(2, minmax(0, 1fr))");
  a(".message-champs", "gap: var(--space-2) var(--space-3)");
  // une seule colonne sous 480 px (30rem) de large
  expect(css).toMatch(/@container \(max-width: 30rem\)\s*{\s*\.message-champs\s*{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  a(".ya-champs [hidden]", "display: none");
});

test("REQ072_AC24_regles_des_demandes_en_attente", () => {
  a(".ya-attentes", "flex-direction: column");
  a(".ya-attentes", "gap: var(--space-2)");
  a(".ya-lien", "color: var(--info)");
  a(".ya-lien", "text-decoration: underline");
});

test("REQ072_AC19_session_cachee_n_est_pas_affichee_malgre_display_flex", () => {
  expect(css).toMatch(/\.session\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
});

test("REQ078_AC13_regles_largeur_session_sur_agent_corps", () => {
  a(".cadre-code .agent-corps", "background: var(--bg-200)");
  a(".cadre-code .agent-corps", "var(--largeur-session)");
  a(".cadre-code .agent-corps", "var(--space-3)");
  a(".cadre-code .agent-corps[hidden]", "display: none");
  a(".cadre-code .agent-fil", "background: none");
  expect(regle(".cadre-code .agent-fil")).not.toMatch(/overflow/);
  for (const s of [".cadre-code .agent-entete", ".cadre-code .ya-agents", ".cadre-code .agent-fil", ".cadre-code .agent-saisie"]) a(s, "padding-inline: var(--marge)");
  // Les filets restent sur les parties pleine largeur : le centrage ne passe que par le remplissage.
  expect(regle(".cadre-code .agent-entete")).not.toMatch(/max-width|margin/);
  expect(regle(".cadre-code .agent-saisie")).not.toMatch(/max-width|margin/);
  // Les règles de la colonne restent jusqu'à T-142.
  a(".agent-corps", "height: 100%");
});

test("REQ113_motif_plusieurs_champs_grille_de_deux_colonnes_egales_en_tokens", () => {
  a(".ya-formulaire", "flex-direction: column");
  a(".ya-formulaire", "gap: var(--space-3)");
  a(".ya-formulaire-grille", "display: grid");
  a(".ya-formulaire-grille", "grid-template-columns: repeat(2, minmax(0, 1fr))");
  a(".ya-formulaire-grille", "gap: var(--space-3)");
  a(".ya-formulaire-grille", "align-items: start");
  a(".ya-formulaire-aide", "color: var(--ink-muted)");
  a(".ya-formulaire [hidden]", "display: none");
});

test("REQ114_motif_petit_formulaire_dans_une_fiche_grille_1fr_1fr_auto_en_tokens", () => {
  a(".ya-fiche-recherche", "display: grid");
  a(".ya-fiche-recherche", "grid-template-columns: 1fr 1fr auto");
  a(".ya-fiche-recherche", "gap: var(--space-3)");
  a(".ya-fiche-recherche", "align-items: start");
  a(".ya-fiche-recherche > .ya-btn", "margin-top: 20px");
  a(".ya-fiche-soustitre", "font: 600 13px/20px var(--font-sans)");
});

// REQ-115, C-008 « Couleurs réglées » : colonne « Correspondances » du design system.
// [clé, propriété, propriété CSS, valeur d'aujourd'hui de l'aperçu, valeur d'aujourd'hui du mode hybride, sélecteur de l'aperçu, sélecteur du mode hybride]
const CORRESPONDANCES = [
  ...[1, 2, 3, 4, 5, 6].map((n) => [`titre${n}`, "couleur", "color", "var(--ink)", "var(--ink)", `.zone-code-apercu h${n}`, `.cm-line.cm-hy-titre${n}`]),
  ["texte", "couleur", "color", "var(--ink)", "var(--ink)", ".zone-code-apercu :is(p, li):not(blockquote *, table *)", ".cm-hybride .cm-line"],
  ["gras", "couleur", "color", "inherit", "inherit", ".zone-code-apercu strong", ".cm-hy-gras"],
  ["italique", "couleur", "color", "inherit", "inherit", ".zone-code-apercu em", ".cm-hy-italique"],
  ["barre", "couleur", "color", "inherit", "inherit", ".zone-code-apercu del", ".cm-hy-barre"],
  ["lien", "couleur", "color", "var(--info)", "var(--info)", ".zone-code-apercu a", ".cm-hy-lien"],
  ["code", "couleur", "color", "inherit", "var(--ink)", ".zone-code-apercu code", ".cm-hy-code"],
  ["code", "fond", "background", "var(--apercu-fond)", "var(--code-fond)", ".zone-code-apercu code", ".cm-hy-code"],
  ["bloc_code", "couleur", "color", "var(--ink)", "var(--ink)", ".zone-code-apercu pre", ".cm-line.cm-hy-bloc-code"],
  ["bloc_code", "fond", "background", "var(--apercu-fond)", "var(--code-fond)", ".zone-code-apercu pre", ".cm-line.cm-hy-bloc-code"],
  ["citation", "couleur", "color", "var(--ink)", "var(--ink)", ".zone-code-apercu blockquote", ".cm-line.cm-hy-citation"],
  ["citation", "fond", "background", "var(--msg-info)", "var(--msg-info)", ".zone-code-apercu blockquote", ".cm-line.cm-hy-citation"],
  ["citation", "bordure", "border-left", "var(--info)", "var(--info)", ".zone-code-apercu blockquote", ".cm-line.cm-hy-citation"],
  ["entete_tableau", "couleur", "color", "var(--ink)", "var(--ink)", ".zone-code-apercu th", ".cm-hy-tableau th"],
  ["entete_tableau", "fond", "background", "var(--apercu-entete)", "var(--apercu-entete)", ".zone-code-apercu th", ".cm-hy-tableau th"],
  ["tableau", "couleur", "color", "var(--ink)", "var(--ink)", ".zone-code-apercu td", ".cm-hy-tableau td"],
  ["tableau", "fond", "background", "var(--apercu-fond)", "var(--apercu-fond)", ".zone-code-apercu tbody tr:nth-child(even) td", ".cm-hy-tableau tbody tr:nth-child(even) td"],
  ["tableau", "bordure", "border", "var(--line-strong)", "var(--line-strong)", ".zone-code-apercu td", ".cm-hy-tableau td"],
  ["puce", "couleur", "color", "inherit", "var(--ink-muted)", ".zone-code-apercu ul > li::marker", ".cm-hy-puce"],
  ["separateur", "couleur", "border-top", "var(--line-strong)", "var(--line-strong)", ".zone-code-apercu hr", ".cm-hy-trait"],
];

// Tous les corps des règles dont la liste de sélecteurs contient exactement `selecteur`.
function corps(selecteur) {
  let sortie = "";
  for (const m of css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(/,(?![^(]*\))/).some((s) => s.trim() === selecteur)) sortie += m[2].replace(/\s+/g, " ");
  }
  return sortie;
}

test("REQ115_AC4_apercu_et_mode_hybride_lisent_les_variables_md_avec_la_valeur_d_aujourd_hui", () => {
  for (const [cle, prop, , apercu, hybride, selApercu, selHybride] of CORRESPONDANCES) {
    const variable = `--md-${cle.replaceAll("_", "-")}-${prop}`;
    expect(corps(selApercu), `${selApercu} ${variable}`).toContain(`var(${variable}, ${apercu})`);
    expect(corps(selHybride), `${selHybride} ${variable}`).toContain(`var(${variable}, ${hybride})`);
  }
});

test("REQ115_AC4_spans_de_coloration_des_titres_et_liens_du_mode_hybride_heritent_la_couleur_reglee", () => {
  const m = css.match(/:is\(([^)]*)\) span:not\(([^)]*)\) \{ color: inherit; \}/);
  expect(m).not.toBeNull();
  for (let i = 1; i <= 6; i++) expect(m[1]).toContain(`.cm-line.cm-hy-titre${i}`);
  expect(m[1]).toContain(".cm-hy-lien");
  for (const c of [".cm-hy-marque", ".cm-hy-code", ".cm-hy-lien"]) expect(m[2]).toContain(c);
});

test("REQ115_AC9_aucune_regle_des_reponses_de_l_agent_ne_lit_une_variable_md", () => {
  const sansCommentaires = css.replace(/\/\*[^]*?\*\//g, "");
  let vues = 0;
  for (const m of sansCommentaires.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!m[1].includes(".ya-chat-agent")) continue;
    vues++;
    expect(m[2], m[1].trim()).not.toContain("--md-");
  }
  expect(vues).toBeGreaterThan(10);
  // Aucune règle commune : un sélecteur qui vise les deux est écrit deux fois.
  for (const m of sansCommentaires.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[2].includes("--md-")) expect(m[1], m[1].trim()).not.toContain("ya-chat");
  }
});

test("REQ115_AC1_AC4_code_en_ligne_du_mode_hybride_prend_la_couleur_qui_l_entoure_dans_lien_titre_citation", () => {
  const sel = ":is(.cm-hy-lien, .cm-line.cm-hy-titre1, .cm-line.cm-hy-titre2, .cm-line.cm-hy-titre3, .cm-line.cm-hy-titre4, .cm-line.cm-hy-titre5, .cm-line.cm-hy-titre6, .cm-line.cm-hy-citation) .cm-hy-code";
  expect(corps(sel)).toContain("color: var(--md-code-couleur, inherit)");
});

test("REQ117_motif_grille_de_couleurs", () => {
  expect(regle(".ya-grille-couleurs")).toMatch(/grid-template-columns:\s*1fr 124px 124px 124px/);
  const entete = regle(".ya-grille-entete");
  expect(entete).toMatch(/position:\s*sticky/);
  expect(entete).toMatch(/background:\s*var\(--bg-300\)/);
  expect(entete).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
  const erreur = regle(".ya-grille-erreur");
  expect(erreur).toMatch(/color:\s*var\(--danger\)/);
  expect(erreur).toMatch(/font-size:\s*12px/);
  expect(erreur).toMatch(/line-height:\s*16px/);
});

test("REQ122_AC8_AC9_regles_css_de_ya_diagramme", () => {
  expect(css).toMatch(/\.ya-diagramme \{ margin: var\(--space-3\) 0; \}/);
  const img = /\.ya-diagramme img \{([^}]*)\}/.exec(css)[1];
  for (const d of ["display: block", "max-width: 100%", "height: auto", "border-radius: var(--radius-sm)", "background: var(--apercu-page)"]) expect(img).toContain(d);
});

test("C001_principal_focus_hors_du_bouton_et_contraste", () => {
  a(".ya-btn:focus-visible", "outline: 2px solid var(--accent-fg)");
  a(".ya-btn:focus-visible", "outline-offset: -2px");
  a(".ya-btn-primary:focus-visible", "outline-offset: 2px");
  a(".ya-btn-primary.ya-focus-garde", "outline-offset: 2px");
  const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
  const bloc = (debut) => {
    const i = tokens.indexOf(debut);
    return tokens.slice(i, tokens.indexOf("}", i));
  };
  const lum = (hex) => {
    const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const debut of [':root, [data-theme="dark"]', '[data-theme="light"]']) {
    const b = bloc(debut);
    const fg = /--accent-fg:\s*(#[0-9a-f]{6})/i.exec(b)[1];
    const fond = /--bg-300:\s*(#[0-9a-f]{6})/i.exec(b)[1];
    const [l1, l2] = [lum(fg), lum(fond)].sort((x, y) => y - x);
    expect((l1 + 0.05) / (l2 + 0.05)).toBeGreaterThanOrEqual(3);
  }
});

test("C018_regles_css_du_whiteboard", () => {
  a(".ya-tableau", "background: var(--bg-200)");
  a(".ya-tableau", "overflow: hidden");
  a(".ya-tableau:focus-within", "outline: var(--trait) solid var(--accent-fg)");
  a(".ya-tableau:focus-within", "outline-offset: calc(-1 * var(--trait))");
  a(".ya-tableau-surface svg *", "vector-effect: non-scaling-stroke");
  a(".ya-tableau .boite", "--boite-fond: var(--boite-defaut-fond)");
  a(".ya-tableau .boite", "--boite-trait: var(--boite-defaut-trait)");
  a(".ya-tableau .boite .forme", "fill: var(--boite-fond)");
  a(".ya-tableau .boite .forme", "stroke: var(--boite-trait)");
  a(".ya-tableau .boite:hover .forme", "stroke-width: max(2px, var(--e))");
  a(".ya-tableau .boite.choisie .forme", "stroke: var(--accent-fg)");
  a(".ya-tableau .boite.cible .surcouche", "fill: var(--accent-soft)");
  a(".ya-tableau-texte", "white-space: pre-wrap");
  a(".ya-tableau-texte", "overflow: hidden");
  a(".ya-tableau-texte", "overflow-wrap: anywhere");
  a(".ya-tableau-texte", "justify-content: safe center");
  a(".ya-tableau-texte", "padding: 6px 8px");
  a(".ya-tableau-texte[contenteditable]", "caret-color: var(--accent-fg)");
  expect(css).toMatch(/\.ya-tableau :is\(\.lien, \.fleche\):hover \.trait \{ stroke: var\(--ink\); \}/);
  expect(css).toMatch(/\.ya-tableau :is\(\.lien, \.fleche\)\.choisie \.trait \{ stroke: var\(--accent-fg\)/);
  a(".ya-tableau .fleche.provisoire .trait", "stroke-dasharray: 4 4");
});

test("REQ153_cellule_en_saisie_et_calque_des_aides_suivent_le_design_system", () => {
  const cel = regle(".cm-hy-tableau td:has(> .ya-cellule-saisie)").replace(/\s+/g, " ");
  for (const d of ["outline: var(--trait-fort) solid var(--accent-fg)", "outline-offset: calc(-1 * var(--trait-fort))", "min-width: var(--space-8)"]) expect(cel).toContain(d);
  const c = regle(".ya-cellule-saisie").replace(/\s+/g, " ");
  for (const d of ["display: block", "font: inherit", "color: inherit", "white-space: pre-wrap", "overflow-wrap: anywhere", "caret-color: var(--accent-fg)", "outline: none"]) expect(c).toContain(d);
  expect(c).not.toContain("min-width");
  a(".cm-hy-tableau", "box-sizing: border-box");
  a(".ya-tableau-filet-v", "width: var(--trait-fort)");
  a(".ya-tableau-filet-h", "height: var(--trait-fort)");
  a(".ya-cellule-saisie::selection", "background: var(--selection)");
  const calque = regle(".ya-tableau-aides").replace(/\s+/g, " ");
  expect(calque).toContain("position: absolute");
  expect(calque).not.toContain("z-index");
  expect(css).not.toMatch(/\.ya-tableau-(aides|filet|cadre)[^{]*\{[^}]*z-index/);
  a(".cm-hy-tableau", "position: relative");
  a(".ya-tableau-filet", "background: var(--accent-fg)");
  a(".ya-tableau-cadre", "box-shadow: inset 0 0 0 var(--trait-fort) var(--danger)");
  a(".ya-tableau-cadre", "pointer-events: none");
  a(".ya-tableau-filet", "pointer-events: none");
  expect(regle(".cm-hy-tableau")).toContain("calc(100% - var(--space-3))");
});

test("REQ153_AC14_contrastes_des_disques_du_filet_et_du_cadre_dans_les_deux_themes", () => {
  const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
  const bloc = (debut) => {
    const i = tokens.indexOf(debut);
    return tokens.slice(i, tokens.indexOf("}", i));
  };
  const lum = (hex) => {
    const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const debut of [':root, [data-theme="dark"]', '[data-theme="light"]']) {
    const b = bloc(debut);
    const val = (nom) => {
      const v = new RegExp(`${nom}:\\s*([^;]+);`).exec(b)[1].trim();
      const alias = /^var\((--[a-z-]+)\)$/.exec(v);
      return alias ? val(alias[1]) : v;
    };
    const rapport = (x, y) => {
      const [l1, l2] = [lum(val(x)), lum(val(y))].sort((p, q) => q - p);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    for (const fond of ["--bg-300", "--bg-400"]) {
      expect(rapport("--ink-muted", fond), `${debut} ink-muted/${fond}`).toBeGreaterThanOrEqual(4.5);
      expect(rapport("--ink", fond), `${debut} ink/${fond}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(rapport("--line-strong", "--bg-100"), `${debut} contour`).toBeGreaterThanOrEqual(3);
    expect(rapport("--accent-fg", "--bg-100"), `${debut} filet`).toBeGreaterThanOrEqual(3);
    expect(rapport("--danger", "--bg-100"), `${debut} cadre`).toBeGreaterThanOrEqual(3);
  }
});

test("REQ154_AC10_message_flottant_css_position_fond_filet_et_sans_pointeur", () => {
  a(".ya-message-flottante", "position: absolute");
  a(".ya-message-flottante", "top: var(--space-3)");
  a(".ya-message-flottante", "left: var(--space-3)");
  a(".ya-message-flottante", "right: var(--space-3)");
  a(".ya-message-flottante", "margin: 0 auto");
  a(".ya-message-flottante", "width: fit-content");
  a(".ya-message-flottante", "max-width: 720px");
  a(".ya-message-flottante", "background: linear-gradient(var(--msg-erreur), var(--msg-erreur)), var(--bg-300)");
  a(".ya-message-flottante", "box-shadow: inset 2px 0 0 var(--danger), var(--shadow-popover)");
  a(".ya-message-flottante", "border-radius: var(--radius-md)");
  a(".ya-message-flottante", "padding: 8px 12px");
  a(".ya-message-flottante", "font-size: 13px");
  a(".ya-message-flottante", "line-height: 20px");
  a(".ya-message-flottante", "color: var(--ink)");
  a(".ya-message-flottante", "pointer-events: none");
});

test("REQ154_AC10_contrastes_du_message_flottant_dans_les_deux_themes", () => {
  const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
  const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const lum = (c) => {
    const l = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  const rapport = (x, y) => {
    const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  for (const debut of [':root, [data-theme="dark"]', '[data-theme="light"]']) {
    const i = tokens.indexOf(debut);
    const b = tokens.slice(i, tokens.indexOf("}", i));
    const val = (nom) => {
      const v = new RegExp(`${nom}:\\s*([^;]+);`).exec(b)[1].trim();
      const alias = /^var\((--[a-z-]+)\)$/.exec(v);
      return alias ? val(alias[1]) : v;
    };
    const danger = rgb(val("--danger"));
    const fond = rgb(val("--bg-300"));
    const pct = Number(/--msg-erreur:\s*color-mix\(in srgb, var\(--danger\) (\d+)%/.exec(tokens)[1]) / 100;
    const pose = danger.map((v, k) => v * pct + fond[k] * (1 - pct));
    expect(rapport(rgb(val("--ink")), pose), `${debut} ink`).toBeGreaterThanOrEqual(4.5);
    expect(rapport(danger, pose), `${debut} filet`).toBeGreaterThanOrEqual(3);
  }
});
