import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("web/src/ui/composants.css", "utf8");

test("REQ028_AC7_focus_visible_a_contour_accent_sur_boutons_et_champs", () => {
  expect(css).toMatch(/\.bouton:focus-visible\s*{[^}]*outline:\s*var\(--trait-fort\) solid var\(--accent-fg\)/);
  expect(css).toMatch(/\.champ-saisie:focus-visible\s*{[^}]*outline:\s*var\(--trait-fort\) solid var\(--accent-fg\)/);
});

test("REQ028_AC3_composants_n_utilisent_que_des_tokens", () => {
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(css).not.toMatch(/\d+px/);
  expect(css).not.toMatch(/transition|animation/);
});

test("REQ028_AC3_bouton_principal_en_accent_et_police_ui", () => {
  expect(css).toMatch(/\.bouton-principal\s*{[^}]*background:\s*var\(--accent\)/);
  expect(css).toMatch(/font-family:\s*var\(--police-ui\)/);
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

test("REQ028_AC3_bouton_variantes", () => {
  a(".bouton", "height: var(--hauteur-controle)");
  a(".bouton", "border-radius: var(--rayon-petit)");
  a(".bouton", "font: var(--texte-base) var(--police-ui)");
  a(".bouton-principal", "background: var(--accent)");
  a(".bouton-principal", "color: var(--texte-sur-couleur)");
  a(".bouton-danger", "background: var(--erreur)");
  a(".bouton-danger", "color: var(--texte-sur-couleur)");
  a(".bouton-secondaire", "background: transparent");
  a(".bouton-secondaire", "border-color: var(--bordure-champ)");
  a(".bouton-secondaire", "color: var(--texte)");
  a(".bouton-discret", "background: transparent");
  a(".bouton-discret", "color: var(--texte-attenue)");
});

test("REQ028_AC3_bouton_survol_actif_et_desactive", () => {
  a(".bouton-principal:hover", "background: var(--accent-survol)");
  a(".bouton-principal:active", "background: var(--accent-survol)");
  a(".bouton-danger:hover", "background: var(--erreur-survol)");
  a(".bouton-danger:active", "background: var(--erreur-survol)");
  a(".bouton-secondaire:hover", "background: var(--surface-haute)");
  a(".bouton-secondaire:hover", "color: var(--texte)");
  a(".bouton-discret:hover", "background: var(--surface-haute)");
  a(".bouton-secondaire:active", "background: var(--surface-haute)");
  a(".bouton-discret:active", "color: var(--texte)");
  a(".bouton:active", "inset 0 0 0 var(--trait) currentColor");
  a(".bouton:disabled", "background: transparent");
  a(".bouton:disabled", "border-color: var(--bordure)");
  a(".bouton:disabled", "color: var(--texte-attenue)");
});

test("REQ028_AC3_champ_etats", () => {
  a(".champ-saisie", "background: var(--fond)");
  a(".champ-saisie", "border: var(--trait) solid var(--bordure-champ)");
  a(".champ-saisie", "color: var(--texte)");
  a(".champ-saisie", "min-height: var(--hauteur-controle)");
  a(".champ-saisie", "border-radius: var(--rayon-petit)");
  a(".champ-saisie", "color-scheme: dark");
  a(".champ-saisie:disabled", "border-color: var(--bordure)");
  a(".champ-saisie:disabled", "color: var(--texte-attenue)");
  a('.champ-saisie[aria-invalid="true"]', "border-color: var(--erreur)");
  a(".champ-erreur", "color: var(--erreur)");
  a(".champ-erreur", "font: var(--texte-petit) var(--police-ui)");
  a(".champ-aide", "color: var(--texte-attenue)");
  a(".champ-aide", "font: var(--texte-petit) var(--police-ui)");
});

test("REQ028_AC3_message_variantes_et_detail", () => {
  a(".message", "background: var(--surface-haute)");
  a(".message", "color: var(--texte)");
  a(".message", "border-left: var(--trait-fort) solid var(--texte-attenue)");
  a(".message", "font: var(--texte-base) var(--police-ui)");
  a(".message-succes", "border-left-color: var(--succes)");
  a(".message-alerte", "border-left-color: var(--alerte)");
  a(".message-erreur", "border-left-color: var(--erreur)");
  a(".message-fort", "background: var(--alerte)");
  a(".message-fort", "color: var(--texte-sur-couleur)");
  a(".message-detail", "max-height: var(--hauteur-detail)");
  a(".message-detail", "overflow: auto");
  a(".message-detail", "font-family: var(--police-code)");
});

test("REQ028_AC3_indication_style_et_masquage", () => {
  a(".indication", "color: var(--texte-attenue)");
  a(".indication", "font: var(--texte-base) var(--police-ui)");
  a(".indication", "padding: var(--esp-3)");
  a(".indication[hidden]", "display: none");
});

test("REQ033_AC3_et_AC10_fond_des_messages_selon_la_variante", () => {
  a(".message-info", "background: var(--message-info)");
  a(".message-succes", "background: var(--message-succes)");
  a(".message-alerte", "background: var(--message-alerte)");
  a(".message-erreur", "background: var(--message-erreur)");
  expect(css.indexOf(".message-fort {")).toBeGreaterThan(css.indexOf(".message-erreur {"));
});
