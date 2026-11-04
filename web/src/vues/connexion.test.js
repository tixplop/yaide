import { afterEach, expect, test, vi } from "vitest";
import { vueConnexion } from "./connexion.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function monter(options = {}) {
  const surSucces = vi.fn();
  const vue = vueConnexion({ chemin: "/p/projet", surSucces, ...options });
  document.body.append(vue);
  return { vue, surSucces };
}

const reponse = (status) => vi.fn(async () => ({ status }));
const envoyer = async (vue, texte) => {
  vue.querySelector("input").value = texte;
  vue.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
};

test("REQ004_AC5_affiche_le_nom_et_le_chemin", () => {
  const { vue } = monter();
  expect(vue.querySelector("h1").textContent).toBe("yaide");
  expect(vue.querySelector(".connexion-chemin").textContent).toBe("/p/projet");
  expect(vue.querySelector(".connexion-chemin").title).toBe("/p/projet");
});

test("REQ004_AC5_AC10_symbole_masque_aux_lecteurs_d_ecran_et_ni_barre_ni_rail_ni_etat", () => {
  const { vue } = monter();
  const svg = vue.querySelector("svg");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("width")).toBe("40");
  expect(vue.querySelectorAll("h1").length).toBe(1);
  expect(vue.querySelector("header, nav, aside, footer, [role=tablist]")).toBeNull();
});

test("REQ004_AC1_succes_appelle_surSucces", async () => {
  vi.stubGlobal("fetch", reponse(204));
  const { vue, surSucces } = monter();
  await envoyer(vue, "mdp");
  expect(surSucces).toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith("/api/connexion", expect.objectContaining({ method: "POST", body: "mdp" }));
});

test("REQ004_AC2_mauvais_mot_de_passe_message_et_focus_selection", async () => {
  vi.stubGlobal("fetch", reponse(401));
  const { vue, surSucces } = monter();
  await envoyer(vue, "faux");
  expect(surSucces).not.toHaveBeenCalled();
  const alerte = vue.querySelector("[role=alert]");
  expect(alerte.textContent).toBe("Mot de passe incorrect.");
  const champ = vue.querySelector("input");
  expect(champ.getAttribute("aria-invalid")).toBe("true");
  expect(champ.getAttribute("aria-describedby")).toBe(alerte.id);
  expect(document.activeElement).toBe(champ);
  expect(champ.selectionEnd - champ.selectionStart).toBe(4);
});

test("REQ004_AC8_trop_d_essais", async () => {
  vi.stubGlobal("fetch", reponse(429));
  const { vue } = monter();
  await envoyer(vue, "x");
  expect(vue.querySelector("[role=alert]").textContent).toBe("Trop d'essais. Attendez une minute.");
});

test("REQ004_AC9_champ_vide_sans_requete", async () => {
  vi.stubGlobal("fetch", reponse(204));
  const { vue } = monter();
  await envoyer(vue, "");
  expect(fetch).not.toHaveBeenCalled();
  expect(vue.querySelector("[role=alert]").textContent).toBe("Saisissez le mot de passe.");
});

test("REQ004_serveur_injoignable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("réseau"); }));
  const { vue } = monter();
  await envoyer(vue, "x");
  expect(vue.querySelector("[role=alert]").textContent).toBe("Serveur injoignable. Réessayez.");
});

test("REQ004_AC6_le_bouton_Se_connecter_est_un_submit_et_le_champ_est_password", () => {
  const { vue } = monter();
  expect(vue.querySelector("button").type).toBe("submit");
  expect(vue.querySelector("button").textContent).toBe("Se connecter");
  expect(vue.querySelector("input").type).toBe("password");
  expect(vue.querySelector("label").textContent).toBe("Mot de passe");
  vue.focaliser();
  expect(document.activeElement).toBe(vue.querySelector("input"));
});

test("REQ005_AC7_session_expiree_affiche_le_message", () => {
  const { vue } = monter({ expiree: true });
  expect(vue.querySelector("[role=status]").textContent).toBe("Session expirée. Reconnectez-vous.");
});

test("REQ004_chargement_bouton_Connexion_desactive_pendant_l_attente", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const { vue } = monter();
  await envoyer(vue, "mdp");
  const b = vue.querySelector("button");
  expect(b.textContent).toBe("Connexion…");
  expect(b.disabled).toBe(true);
  expect(b.getAttribute("aria-busy")).toBe("true");
});
