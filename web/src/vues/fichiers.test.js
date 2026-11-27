import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { vueFichiers } from "./fichiers.js";

const tokens = readFileSync("web/src/ui/tokens.css", "utf8");
for (const [, nom, val] of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) document.documentElement.style.setProperty(nom, val.trim());

let vues = [];
afterEach(async () => {
  for (const v of vues) v.detruire();
  vues = [];
  const w = await import("../worktree.js");
  w.mettreAJour([]);
  w.choisir("");
  w.occuper();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

// jsdom n'a pas `Blob.arrayBuffer` : les navigateurs l'ont
Blob.prototype.arrayBuffer ??= function () {
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onload = () => ok(lecteur.result);
    lecteur.onerror = () => ko(lecteur.error);
    lecteur.readAsArrayBuffer(this);
  });
};

const attendre = () => new Promise((r) => setTimeout(r, 0));
const f = (nom) => ({ nom, dossier: false });
const d = (nom) => ({ nom, dossier: true });

/** `disque` : chemin de dossier -> entrées (ou réponse d'erreur `{ status, corps }`) ; modifiable par le test. */
async function monter(disque, options = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).startsWith("/api/connaissance")) {
      appels.push(url);
      if (init?.method === "POST") appels.push(JSON.parse(init.body));
      if (disque.baCoupure) throw new TypeError("réseau");
      if (disque.baRefus) return { ok: false, status: 500, json: async () => ({ cause: "interne", message: "x" }) };
      const corps = init?.method === "POST" ? { numero: 7, total: 1 } : { config: { provider: "openai", modele: "m" }, collections: [], ajout: null, fichiers: disque.base ?? {} };
      return { ok: true, status: init?.method === "POST" ? 202 : 200, json: async () => corps };
    }
    const chemin = decodeURIComponent(new URL(url, "http://x").searchParams.get("chemin") ?? "");
    appels.push(url);
    if (typeof disque.attente === "function") await disque.attente(url);
    if (url.includes("/api/fichiers/copier")) {
      const p = new URL(url, "http://x").searchParams;
      if (disque.coupure) throw new TypeError("réseau");
      const r = disque.copier?.(p.get("de"), p.get("dans"));
      if (r?.status) return { ok: false, status: r.status, json: async () => r.corps };
      const nom = p.get("de").split("/").pop();
      const cible = disque[p.get("dans")];
      const source = disque[p.get("de").split("/").slice(0, -1).join("/")]?.find((e) => e.nom === nom);
      if (Array.isArray(cible) && source && !cible.some((e) => e.nom === nom)) cible.push(source);
      return { ok: true, status: 200, json: async () => ({ chemin: p.get("dans") ? `${p.get("dans")}/${nom}` : nom }) };
    }
    if (url.includes("/api/fichiers/importer")) {
      const p = new URL(url, "http://x").searchParams;
      if (disque.coupure) throw new TypeError("réseau");
      const [dans, nom, type] = [p.get("dans"), p.get("nom"), p.get("type")];
      const r = disque.importer?.(dans, nom, type);
      if (r?.status) return { ok: false, status: r.status, json: async () => r.corps };
      const existants = Array.isArray(disque[dans]) ? disque[dans] : [];
      const libre = existants.some((e) => e.nom === nom) ? `${nom} copie` : nom;
      const chemin = dans ? `${dans}/${libre}` : libre;
      disque.importes = [...(disque.importes ?? []), `${type}:${chemin}:${init?.body ? init.body.byteLength : 0}`];
      if (Array.isArray(disque[dans])) disque[dans].push(type === "dossier" ? d(libre) : f(libre));
      if (type === "dossier") disque[chemin] = [];
      return { ok: true, status: 201, json: async () => ({ chemin }) };
    }
    if (url.includes("/api/fichiers/renommer")) {
      const p = new URL(url, "http://x").searchParams;
      if (disque.coupure) throw new TypeError("réseau");
      const r = disque.renommer?.(p.get("de"), p.get("vers"));
      if (r) return { ok: false, status: r.status, json: async () => r.corps };
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.includes("/api/fichiers/presse-papiers-windows")) {
      if (disque.coupure) throw new TypeError("réseau");
      const chemins = JSON.parse(init.body).chemins;
      disque.windowsAppels = [...(disque.windowsAppels ?? []), chemins];
      const r = await disque.windows?.(chemins);
      if (r?.status) return { ok: false, status: r.status, json: async () => r.corps };
      return { ok: true, status: 200, json: async () => ({ wsl: r?.wsl ?? true }) };
    }
    const v = disque[chemin];
    if (disque.coupure) throw new TypeError("réseau");
    if (v?.status) return { ok: false, status: v.status, json: async () => v.corps };
    return { ok: true, status: 200, json: async () => ({ entrees: v }) };
  }));
  // Faux XMLHttpRequest : émet des `progress` (jusqu'à `disque.parts` fois) puis passe par le faux `fetch` ci-dessus.
  vi.stubGlobal("XMLHttpRequest", class {
    upload = new EventTarget();
    #ecoutes = {};
    open(methode, url) {
      this.methode = methode;
      this.url = url;
    }
    addEventListener(type, f) {
      (this.#ecoutes[type] ??= []).push(f);
    }
    #emettre(type) {
      for (const f of this.#ecoutes[type] ?? []) f({});
    }
    send(corps) {
      (async () => {
        const total = corps?.byteLength ?? 0;
        const parts = disque.parts ?? 1;
        for (let i = 1; i <= parts; i++) {
          const e = new Event("progress");
          e.loaded = Math.floor((total * i) / parts);
          this.upload.dispatchEvent(e);
          await attendre();
          disque.surPart?.(this.url, i);
        }
        let r;
        try {
          r = await fetch(this.url, { method: this.methode, body: corps ?? undefined });
        } catch {
          return this.#emettre("error");
        }
        this.status = r.status;
        this.responseText = JSON.stringify(await r.json());
        this.#emettre("load");
      })();
    }
  });
  const rappels = { dire: vi.fn(), ...options };
  const vue = vueFichiers(rappels);
  vues.push(vue);
  document.body.append(vue.entete, vue.corps);
  await attendre();
  return { vue, appels, ...rappels };
}

const lignes = (vue) => [...vue.corps.querySelectorAll("[data-chemin]")];
const noms = (vue) => lignes(vue).map((e) => e.dataset.chemin);
const ligne = (vue, chemin) => lignes(vue).find((e) => e.dataset.chemin === chemin);
const bouton = (vue, nom) => [...vue.entete.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nom);

test("REQ045_AC1_une_ligne_ajoutee_ou_retiree_apparait_ou_disparait_dossier_deplie_compris", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("main.rs")] };
  const { vue } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  expect(noms(vue)).toEqual(["src", "src/main.rs", "a.txt"]);
  disque[""] = [d("src"), f("a.txt"), f("nouveau.txt")];
  disque.src = [f("main.rs"), f("lib.rs")];
  await vue.relire();
  expect(noms(vue)).toEqual(["src", "src/main.rs", "src/lib.rs", "a.txt", "nouveau.txt"]);
  disque[""] = [d("src"), f("a.txt")];
  disque.src = [f("lib.rs")];
  await vue.relire();
  expect(noms(vue)).toEqual(["src", "src/lib.rs", "a.txt"]);
});

test("REQ045_AC1_un_dossier_deplie_supprime_ailleurs_est_retire_sans_message", async () => {
  const disque = { "": [d("src")], src: [f("main.rs")] };
  const { vue, dire } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  disque[""] = [];
  disque.src = { status: 404, corps: { cause: "introuvable", message: "Introuvable." } };
  disque[""] = [f("b.txt")];
  await vue.relire();
  expect(noms(vue)).toEqual(["b.txt"]);
  expect(dire).not.toHaveBeenCalled();
});

test("REQ045_AC5_AC6_sans_changement_memes_elements_sans_Chargement_et_focus_garde", async () => {
  const disque = { "": [f("a.txt"), f("b.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "b.txt").focus();
  const avant = lignes(vue);
  await vue.relire();
  expect(lignes(vue).every((e, i) => e === avant[i])).toBe(true);
  expect(document.activeElement).toBe(avant[1]);
  expect(vue.corps.textContent).not.toContain("Chargement");
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

test("REQ045_AC5_avec_changement_focus_selection_et_defilement_sont_gardes", async () => {
  const disque = { "": [f("a.txt"), f("b.txt")] };
  const { vue } = await monter(disque);
  const zone = vue.corps.querySelector(".fichiers-arbre");
  zone.scrollTop = 40;
  ligne(vue, "b.txt").focus();
  disque[""] = [f("a.txt"), f("b.txt"), f("c.txt")];
  await vue.relire();
  expect(noms(vue)).toEqual(["a.txt", "b.txt", "c.txt"]);
  expect(document.activeElement).toBe(ligne(vue, "b.txt"));
  expect(ligne(vue, "b.txt").getAttribute("aria-selected")).toBe("true");
  expect(zone.scrollTop).toBe(40);
  expect(vue.corps.textContent).not.toContain("Chargement");
});

test("REQ045_AC7_un_menu_ouvert_reste_ouvert_pendant_une_relecture", async () => {
  const disque = { "": [f("a.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "a.txt").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  const menu = document.querySelector("[role=menu]");
  expect(menu).not.toBeNull();
  const focus = document.activeElement;
  disque[""] = [f("a.txt"), f("z.txt")];
  await vue.relire();
  expect(document.querySelector("[role=menu]")).toBe(menu);
  expect(document.activeElement).toBe(focus);
});

test("REQ045_AC8_la_ligne_selectionnee_retiree_n_est_plus_selectionnee_le_focus_va_a_la_precedente", async () => {
  const disque = { "": [f("a.txt"), f("b.txt"), f("c.txt")] };
  const { vue, dire } = await monter(disque);
  ligne(vue, "b.txt").focus();
  disque[""] = [f("a.txt"), f("c.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  expect(bouton(vue, "Supprimer").disabled).toBe(true);
  expect(dire).not.toHaveBeenCalled();
});

test("REQ045_AC8_la_premiere_ligne_retiree_avec_le_focus_le_donne_a_Nouveau_fichier", async () => {
  const disque = { "": [f("a.txt"), f("b.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "a.txt").focus();
  disque[""] = [f("b.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(bouton(vue, "Nouveau fichier"));
});

test("REQ045_AC8_dernier_fichier_retire_dossier_vide_et_selection_perdue", async () => {
  const disque = { "": [f("a.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "a.txt").focus();
  disque[""] = [];
  await vue.relire();
  expect(vue.corps.textContent).toContain("Dossier vide.");
  expect(bouton(vue, "Supprimer").disabled).toBe(true);
});

test("REQ045_AC8_une_ligne_cachee_par_le_repli_garde_sa_selection", async () => {
  const disque = { "": [d("src")], src: [f("main.rs")] };
  const { vue } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  ligne(vue, "src/main.rs").focus(); // sélectionne main.rs
  ligne(vue, "src").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); // replie src sans changer la sélection
  expect(noms(vue)).toEqual(["src"]);
  expect(bouton(vue, "Renommer").disabled).toBe(false);
  disque[""] = [d("src"), f("z.txt")];
  await vue.relire();
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

test("REQ045_AC8_le_focus_reste_sur_la_ligne_voisine_apres_un_redessin_suivant", async () => {
  const disque = { "": [f("a.txt"), f("b.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "b.txt").focus();
  disque[""] = [f("a.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
  vue.definirStatuts(new Map([["a.txt", { lettre: "M", mot: "modifié" }]]));
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
  disque[""] = [f("a.txt"), f("c.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  // Une ligne focalisée sans sélection qui disparaît passe aussi le focus à la précédente.
  ligne(vue, "c.txt").focus();
  disque[""] = [f("a.txt")];
  await vue.relire();
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
});

test("REQ045_AC7_un_dialogue_ouvert_garde_son_texte_et_son_focus_pendant_une_relecture", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute("open", "");
  };
  const disque = { "": [f("a.txt")] };
  const { vue } = await monter(disque);
  bouton(vue, "Nouveau fichier").click();
  const saisie = document.querySelector("dialog input");
  saisie.value = "dossier/neuf.txt";
  saisie.focus();
  disque[""] = [f("a.txt"), f("b.txt")];
  await vue.relire();
  expect(document.querySelector("dialog input")).toBe(saisie);
  expect(saisie.value).toBe("dossier/neuf.txt");
  expect(document.activeElement).toBe(saisie);
});

test("REQ045_AC9_AC10_coupure_ou_refus_ne_changent_rien_et_ne_disent_rien", async () => {
  const disque = { "": [f("a.txt")] };
  const { vue, dire } = await monter(disque);
  const avant = lignes(vue);
  disque.coupure = true;
  await vue.relire();
  delete disque.coupure;
  disque[""] = { status: 403, corps: { cause: "interdit", message: "Non." } };
  await vue.relire();
  expect(lignes(vue)[0]).toBe(avant[0]);
  expect(dire).not.toHaveBeenCalled();
  disque[""] = [f("a.txt"), f("b.txt")];
  await vue.relire();
  expect(noms(vue)).toEqual(["a.txt", "b.txt"]);
});

test("REQ045_generation_une_relecture_croisee_avec_un_rafraichissement_est_jetee", async () => {
  const disque = { "": [f("a.txt")] };
  const { vue } = await monter(disque);
  let liberer;
  const retenue = new Promise((r) => (liberer = r));
  disque.attente = () => retenue;
  const lancee = vue.relire();
  await attendre();
  disque[""] = [f("a.txt"), f("cree.txt")];
  delete disque.attente;
  await vue.rafraichir();
  expect(noms(vue)).toEqual(["a.txt", "cree.txt"]);
  disque[""] = [f("a.txt")]; // lecture ancienne, rendue après la création
  liberer();
  await lancee;
  expect(noms(vue)).toEqual(["a.txt", "cree.txt"]);
});

// ---- REQ-049 : plusieurs lignes ----

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute("open");
};
const ctrl = (vue, chemin) => ligne(vue, chemin).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
const choisies = (vue) => lignes(vue).filter((e) => e.getAttribute("aria-selected") === "true").map((e) => e.dataset.chemin);
const touche = (vue, chemin, key) => ligne(vue, chemin).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

test("REQ009_AC5_REQ049_AC4_boutons_et_touches_inactifs_a_plusieurs", async () => {
  const { vue, surOuvrir } = await monter({ "": [f("a.txt"), f("b.txt")] }, { surOuvrir: vi.fn() });
  ctrl(vue, "a.txt");
  expect(bouton(vue, "Renommer").disabled).toBe(false);
  ctrl(vue, "b.txt");
  expect(choisies(vue)).toEqual(["a.txt", "b.txt"]);
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  expect(bouton(vue, "Supprimer").disabled).toBe(true);
  touche(vue, "b.txt", "F2");
  touche(vue, "b.txt", "Delete");
  expect(document.querySelector("dialog[open]")).toBeNull();
  expect(surOuvrir).not.toHaveBeenCalled();
});

test("REQ049_AC1_ctrl_clic_n_ouvre_rien_ne_deplie_rien", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("m.rs")] };
  const { vue, appels, surOuvrir } = await monter(disque, { surOuvrir: vi.fn() });
  const avant = appels.length;
  ctrl(vue, "a.txt");
  ctrl(vue, "src");
  await attendre();
  expect(choisies(vue)).toEqual(["src", "a.txt"]);
  expect(appels.length).toBe(avant);
  expect(surOuvrir).not.toHaveBeenCalled();
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("false");
  ctrl(vue, "a.txt"); // sur une ligne choisie : elle sort
  expect(choisies(vue)).toEqual(["src"]);
  expect(vue.corps.querySelector("[role=tree]").getAttribute("aria-multiselectable")).toBe("true");
});

test("REQ049_AC3_clic_droit_ramene_a_une_ligne_partie_vide_ne_change_rien", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt"), f("c.txt")] });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ctrl(vue, "c.txt");
  const zone = vue.corps.querySelector(".fichiers-arbre");
  zone.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  expect(document.querySelector("[role=menu]").getAttribute("aria-label")).toBe("Actions sur le projet");
  expect(choisies(vue)).toEqual(["a.txt", "b.txt", "c.txt"]);
  ligne(vue, "b.txt").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  expect(choisies(vue)).toEqual(["a.txt", "b.txt", "c.txt"]); // une ligne de la sélection la garde
  expect(document.querySelector("[role=menu]").getAttribute("aria-label")).toBe("Actions sur b.txt");
  ctrl(vue, "b.txt");
  ctrl(vue, "c.txt");
  ligne(vue, "c.txt").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  expect(choisies(vue)).toEqual(["c.txt"]); // ligne hors sélection : elle seule
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

const menuSur = (vue, chemin, touche) => {
  if (touche) ligne(vue, chemin).dispatchEvent(new KeyboardEvent("keydown", { key: touche, shiftKey: touche === "F10", bubbles: true, cancelable: true }));
  else ligne(vue, chemin).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  return document.querySelector("[role=menu]");
};
const commande = (menu, debut) => [...menu.querySelectorAll("[role=menuitem]")].find((i) => i.textContent.startsWith(debut));

test("REQ034_AC1_AC14_REQ104_AC1_REQ049_AC13_menu_a_quatre_groupes_dont_la_base_de_connaissance", async () => {
  const { vue } = await monter({ "": [f("a.txt")] }, { estDepot: () => true, agents: true });
  const m = menuSur(vue, "a.txt");
  expect([...m.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)).toEqual(["Nouveau fichier", "Nouveau dossier", "Nouveau whiteboard", "CopierCtrl+C", "CollerCtrl+V", "RenommerF2", "SupprimerSuppr", "Indexer", "Commit", "Ajouter à la base de connaissance…", "Mettre à jour dans la base de connaissance", "Soumettre à un agent…"]);
  expect(m.querySelectorAll("[role=separator]").length).toBe(4);
  expect(m.querySelectorAll("[aria-disabled]").length).toBe(2); // Coller : rien de copié ; Mettre à jour : aucun fichier de la base
});

test("REQ034_AC21_hors_depot_deux_separateurs_avec_la_base", async () => {
  const { vue } = await monter({ "": [f("a.txt")] }, { estDepot: () => false, agents: true });
  const m = menuSur(vue, "a.txt");
  expect([...m.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)).toEqual(["Nouveau fichier", "Nouveau dossier", "Nouveau whiteboard", "CopierCtrl+C", "CollerCtrl+V", "RenommerF2", "SupprimerSuppr", "Ajouter à la base de connaissance…", "Mettre à jour dans la base de connaissance", "Soumettre à un agent…"]);
  expect(m.querySelectorAll("[role=separator]").length).toBe(3);
});

test("REQ103_AC1_REQ104_AC12_commande_absente_sans_agents_et_dans_la_partie_vide", async () => {
  const sans = await monter({ "": [f("a.txt")] }, { estDepot: () => true });
  const m = menuSur(sans.vue, "a.txt");
  expect(commande(m, "Ajouter")).toBeUndefined();
  expect(commande(m, "Mettre à jour")).toBeUndefined();
  expect(m.querySelectorAll("[role=separator]").length).toBe(3);
  document.body.replaceChildren();
  const avec = await monter({ "": [f("a.txt")] }, { estDepot: () => true, agents: true });
  avec.vue.corps.querySelector(".fichiers-arbre").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  const vide = document.querySelector("[role=menu]");
  expect(vide.getAttribute("aria-label")).toBe("Actions sur le projet");
  expect(commande(vide, "Ajouter")).toBeUndefined();
  expect(commande(vide, "Mettre à jour")).toBeUndefined();
});

test("REQ049_AC3_AC4_AC13_AC14_selection_gardee_commandes_desactivees_et_touche_Menu", async () => {
  const { vue } = await monter({ "": [f("CHANGELOG.md"), f("README.md")] }, { estDepot: () => true, agents: true });
  ctrl(vue, "CHANGELOG.md");
  ctrl(vue, "README.md");
  const m = menuSur(vue, "CHANGELOG.md");
  expect(m.getAttribute("aria-label")).toBe("Actions sur CHANGELOG.md");
  expect(choisies(vue)).toEqual(["CHANGELOG.md", "README.md"]);
  for (const nom of ["Renommer", "Supprimer", "Indexer"]) expect(commande(m, nom).getAttribute("aria-disabled")).toBe("true");
  for (const nom of ["Nouveau fichier", "Commit", "Ajouter"]) expect(commande(m, nom).hasAttribute("aria-disabled")).toBe(false);
  commande(m, "Renommer").click();
  expect(document.querySelector("[role=menu]")).toBe(m); // le clic sur une commande désactivée ne ferme rien
  expect(document.querySelector("dialog")).toBeNull();
  m.querySelector("[role=menuitem]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.activeElement).toBe(ligne(vue, "CHANGELOG.md")); // le focus revient sur la ligne visée
  // Maj+F10 sur une ligne sortie de la sélection : elle devient la seule.
  ctrl(vue, "README.md");
  expect(choisies(vue)).toEqual(["CHANGELOG.md"]);
  const m2 = menuSur(vue, "README.md", "F10");
  expect(choisies(vue)).toEqual(["README.md"]);
  expect(m2.getAttribute("aria-label")).toBe("Actions sur README.md");
  const m3 = (document.activeElement.blur(), menuSur(vue, "README.md", "ContextMenu"));
  expect(commande(m3, "Renommer").hasAttribute("aria-disabled")).toBe(false);
});

test("REQ049_AC13_touche_Menu_sur_une_ligne_de_la_selection_garde_tout", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt")] }, { estDepot: () => true, agents: true });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  const m = menuSur(vue, "b.txt", "ContextMenu");
  expect(choisies(vue)).toEqual(["a.txt", "b.txt"]);
  expect(m.getAttribute("aria-label")).toBe("Actions sur b.txt");
});

test("REQ104_AC1_AC13_commande_ouvre_le_dialogue_pour_les_lignes_de_la_selection_dans_l_ordre_de_l_arbre", async () => {
  const { vue } = await monter({ "": [d("docs"), f("a.txt"), f("b.txt")] }, { agents: true });
  const base = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => (String(url).startsWith("/api/connaissance") ? { ok: true, status: 200, json: async () => ({ config: { provider: "openai", modele: "m" }, collections: [{ nom: "notes" }], ajout: null }) } : base(url, init))));
  ctrl(vue, "b.txt");
  ctrl(vue, "docs");
  const m = menuSur(vue, "b.txt");
  commande(m, "Ajouter").click();
  await attendre();
  const dlg = document.querySelector("dialog[role=dialog], dialog");
  expect(dlg.querySelector(".dialogue-titre").textContent).toBe("Ajouter à la base de connaissance");
  expect(document.getElementById(dlg.getAttribute("aria-describedby")).textContent).toBe("Ajouter docs/ et b.txt à une collection.");
});


/** Faux `/api/agent/agents` par-dessus le faux serveur de fichiers. */
function avecAgents() {
  const base = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => (String(url) === "/api/agent/agents" ? { ok: true, status: 200, json: async () => ({ agents: [], erreurs: [] }) } : base(url, init))));
}
const soumettre = async (m) => {
  commande(m, "Soumettre").click();
  await attendre();
  [...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Soumettre").click();
  await attendre();
};

test("REQ126_AC6_commande_absente_sans_agents_et_dans_la_partie_vide", async () => {
  const sans = await monter({ "": [f("a.txt")] }, { estDepot: () => true });
  expect(commande(menuSur(sans.vue, "a.txt"), "Soumettre")).toBeUndefined();
  document.body.replaceChildren();
  const avec = await monter({ "": [f("a.txt")] }, { agents: true });
  avec.vue.corps.querySelector(".fichiers-arbre").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  expect(commande(document.querySelector("[role=menu]"), "Soumettre")).toBeUndefined();
});

test("REQ126_AC1_AC4_commande_derniere_jamais_desactivee_et_messages_selon_la_selection", async () => {
  const surSoumettre = vi.fn(async () => ({}));
  const { vue } = await monter({ "": [d("docs"), f("a.md"), f("b.md")] }, { agents: true, surSoumettre });
  avecAgents();
  const m0 = menuSur(vue, "a.md");
  const items = [...m0.querySelectorAll("[role=menuitem]")];
  expect(items.at(-1).textContent).toBe("Soumettre à un agent…");
  expect(items.at(-1).hasAttribute("aria-disabled")).toBe(false);
  m0.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await soumettre(menuSur(vue, "a.md"));
  expect(surSoumettre).toHaveBeenLastCalledWith({ equipe: undefined, message: "Consulte `a.md`." });
  ctrl(vue, "a.md");
  ctrl(vue, "b.md");
  await soumettre(menuSur(vue, "b.md"));
  expect(surSoumettre).toHaveBeenLastCalledWith({ equipe: undefined, message: "Consulte `a.md` et `b.md`." });
  ctrl(vue, "docs");
  await soumettre(menuSur(vue, "docs"));
  expect(surSoumettre).toHaveBeenLastCalledWith({ equipe: undefined, message: "Consulte `docs/`, `a.md` et `b.md`." });
  // Ligne visée hors de la sélection : elle seule.
  ctrl(vue, "docs");
  ctrl(vue, "a.md");
  expect(choisies(vue)).toEqual(["b.md"]);
  await soumettre(menuSur(vue, "a.md"));
  expect(surSoumettre).toHaveBeenLastCalledWith({ equipe: undefined, message: "Consulte `a.md`." });
  // Annuler : le focus revient sur la ligne visée.
  commande(menuSur(vue, "b.md"), "Soumettre").click();
  await attendre();
  [...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Annuler").click();
  expect(document.activeElement).toBe(ligne(vue, "b.md"));
});

test("REQ126_AC5_worktree_phrase_depuis_le_worktree_et_message_depuis_le_projet", async () => {
  const surSoumettre = vi.fn(async () => ({}));
  const disque = { "": [], "../essai": [d("docs"), f("a.md")] };
  const w = await import("../worktree.js");
  w.mettreAJour([PROJET, ESSAI]);
  w.choisir("../essai");
  const { vue } = await monter(disque, { agents: true, surSoumettre });
  avecAgents();
  commande(menuSur(vue, "../essai/docs"), "Soumettre").click();
  await attendre();
  expect(document.getElementById(document.querySelector("dialog").getAttribute("aria-describedby")).textContent).toBe("Soumettre docs/ à un agent.");
  [...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Soumettre").click();
  await attendre();
  expect(surSoumettre).toHaveBeenLastCalledWith({ equipe: undefined, message: "Consulte `../essai/docs/`." });
});

test("REQ049_AC3_clic_simple_ramene_a_une_ligne", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt")] });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ligne(vue, "a.txt").click();
  expect(choisies(vue)).toEqual(["a.txt"]);
});

test("REQ049_AC5_nouveau_fichier_d_apres_la_derniere_ligne", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("m.rs")] };
  const { vue } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  ctrl(vue, "a.txt");
  ctrl(vue, "src/m.rs");
  bouton(vue, "Nouveau fichier").click();
  expect(document.querySelector("dialog input").value).toBe("src/");
  [...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Annuler").click();
  ctrl(vue, "src/m.rs"); // la ligne sort, mais reste la dernière cliquée
  expect(choisies(vue)).toEqual(["src", "a.txt"]);
  bouton(vue, "Nouveau dossier").click();
  expect(document.querySelector("dialog input").value).toBe("src/");
});

test("REQ049_AC6_relecture_garde_la_selection_et_retire_la_disparue", async () => {
  const disque = { "": [f("a.txt"), f("b.txt"), f("c.txt")] };
  const { vue } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ctrl(vue, "c.txt");
  disque[""] = [f("a.txt"), f("c.txt"), f("z.txt")];
  await vue.relire();
  expect(choisies(vue)).toEqual(["a.txt", "c.txt"]);
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  disque[""] = [f("c.txt"), f("z.txt")];
  await vue.relire();
  expect(choisies(vue)).toEqual(["c.txt"]);
  expect(bouton(vue, "Renommer").disabled).toBe(false);
  disque[""] = [f("z.txt")];
  await vue.relire();
  expect(choisies(vue)).toEqual([]);
  expect(bouton(vue, "Renommer").disabled).toBe(true);
});

test("REQ049_AC9_AC10_f2_vise_la_ligne_selectionnee_pas_le_focus", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt"), f("c.txt")] });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ctrl(vue, "b.txt");
  const b = ligne(vue, "b.txt");
  expect(b.getAttribute("aria-selected")).toBe("false");
  expect(document.activeElement).toBe(b);
  touche(vue, "b.txt", "F2");
  expect(document.querySelector("dialog input").value).toBe("a.txt");
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

test("REQ049_AC10_sans_selection_f2_et_suppr_ne_font_rien_entree_active", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("m.rs")] };
  const { vue } = await monter(disque);
  expect(choisies(vue)).toEqual([]);
  touche(vue, "a.txt", "F2");
  touche(vue, "a.txt", "Delete");
  expect(document.querySelector("dialog[open]")).toBeNull();
  touche(vue, "src", "Enter");
  await attendre();
  expect(choisies(vue)).toEqual(["src"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("true");
});

test("REQ049_AC11_ligne_masquee_par_gauche_sort", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("m.rs")] };
  const { vue } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  ctrl(vue, "src"); // src sort de la sélection
  ctrl(vue, "src/m.rs");
  ctrl(vue, "a.txt");
  expect(choisies(vue)).toEqual(["src/m.rs", "a.txt"]);
  touche(vue, "src", "ArrowLeft");
  expect(noms(vue)).toEqual(["src", "a.txt"]);
  expect(choisies(vue)).toEqual(["a.txt"]);
  expect(bouton(vue, "Renommer").disabled).toBe(false);
});

test("REQ049_presser_sans_relacher_garde_la_selection", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt"), f("c.txt")] });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ligne(vue, "c.txt").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  ligne(vue, "c.txt").focus(); // le navigateur donne le focus dès le mousedown
  expect(choisies(vue)).toEqual(["a.txt", "b.txt"]);
});

test("REQ049_focus_du_pointeur_ne_selectionne_pas_mais_tab_selectionne_si_rien_ne_l_est", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt")] });
  ligne(vue, "a.txt").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  ligne(vue, "a.txt").focus();
  expect(choisies(vue)).toEqual([]);
  await attendre();
  ligne(vue, "b.txt").focus();
  expect(choisies(vue)).toEqual(["b.txt"]);
});

// ---- REQ-050 : glisser-déposer ----

Element.prototype.scrollIntoView ??= function () {};

function fauxTransfert() {
  return { donnees: {}, effectAllowed: "", dropEffect: "", setData(t, v) { this.donnees[t] = v; }, setDragImage: vi.fn() };
}
function evt(type, cible) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = fauxTransfert();
  cible.dispatchEvent(e);
  return e;
}
/** Glisse la ligne `de` (avec la sélection si elle en fait partie) et dépose sur `sur` (un chemin, ou null pour la partie vide). */
async function glisser(vue, de, sur, { finir = true } = {}) {
  const e = evt("dragstart", ligne(vue, de));
  if (e.defaultPrevented) return e;
  evt("drop", sur === null ? vue.corps.querySelector("[role=tree]") : ligne(vue, sur));
  await attendre();
  await attendre();
  if (finir) evt("dragend", ligne(vue, de) ?? vue.corps.querySelector("[role=tree]"));
  return e;
}
/** Disque qui sait déplacer : le renommage met à jour les listes. */
function disqueMobile(initial) {
  const disque = { ...initial };
  disque.renommer = (de, vers) => {
    const dd = de.split("/").slice(0, -1).join("/");
    const vd = vers.split("/").slice(0, -1).join("/");
    const entree = disque[dd].find((x) => x.nom === de.split("/").pop());
    if (disque[vd].some((x) => x.nom === vers.split("/").pop())) return { status: 409, corps: { cause: "existe", message: "Ce nom est déjà pris. Choisissez-en un autre." } };
    disque[dd] = disque[dd].filter((x) => x !== entree);
    disque[vd] = [...disque[vd], { ...entree, nom: vers.split("/").pop() }].sort((x, y) => Number(y.dossier) - Number(x.dossier) || x.nom.localeCompare(y.nom));
    if (entree.dossier) {
      for (const k of Object.keys(disque)) if (k === de || k.startsWith(`${de}/`)) { disque[vers + k.slice(de.length)] = disque[k]; delete disque[k]; }
    }
  };
  return disque;
}
const appelsRenommer = (appels) => appels.filter((u) => u.includes("renommer")).map((u) => { const p = new URL(u, "http://x").searchParams; return `${p.get("de")}>${p.get("vers")}`; });

test("REQ050_AC1_deplace_deplie_selectionne", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt")], src: [f("main.rs")] });
  const { vue, dire, surRenomme } = await monter(disque, { surRenomme: vi.fn() });
  await glisser(vue, "a.txt", "src");
  expect(noms(vue)).toEqual(["src", "src/a.txt", "src/main.rs"]);
  expect(choisies(vue)).toEqual(["src/a.txt"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("true");
  expect(surRenomme).toHaveBeenCalledWith({ de: "a.txt", vers: "src/a.txt" });
  expect(dire).not.toHaveBeenCalled();
});

test("REQ050_AC2_AC3_selection_apres_depot", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt"), f("c.txt")], src: [] });
  const { vue } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "b.txt", "src");
  expect(choisies(vue)).toEqual(["src/a.txt", "src/b.txt"]);
  expect(noms(vue)).toEqual(["src", "src/a.txt", "src/b.txt", "c.txt"]);
  ctrl(vue, "c.txt");
  ctrl(vue, "src/a.txt");
  ligne(vue, "c.txt").click();
  await glisser(vue, "c.txt", "src");
  expect(choisies(vue)).toEqual(["src/c.txt"]);
  expect(noms(vue)).toContain("src/a.txt");
});

test("REQ050_AC4_racine", async () => {
  const disque = disqueMobile({ "": [d("src"), f("b.txt")], src: [f("a.txt")] });
  const { vue, appels } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  await glisser(vue, "src/a.txt", null);
  expect(appelsRenommer(appels)).toEqual(["src/a.txt>a.txt"]);
  expect(noms(vue)).toEqual(["src", "a.txt", "b.txt"]);
  expect(choisies(vue)).toEqual(["a.txt"]);
});

test("REQ050_AC5_dossier_garde_ses_sous_dossiers_deplies", async () => {
  const disque = disqueMobile({ "": [d("lib"), d("src")], lib: [d("sous")], "lib/sous": [f("x.txt")], src: [] });
  const { vue } = await monter(disque);
  ligne(vue, "lib").click();
  await attendre();
  ligne(vue, "lib/sous").click();
  await attendre();
  expect(noms(vue)).toEqual(["lib", "lib/sous", "lib/sous/x.txt", "src"]);
  await glisser(vue, "lib", "src");
  expect(noms(vue)).toEqual(["src", "src/lib", "src/lib/sous", "src/lib/sous/x.txt"]);
});

test("REQ050_AC6_surRenomme_pour_chaque_ligne", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue, surRenomme } = await monter(disque, { surRenomme: vi.fn() });
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "a.txt", "src");
  expect(surRenomme.mock.calls.map((c) => c[0])).toEqual([{ de: "a.txt", vers: "src/a.txt" }, { de: "b.txt", vers: "src/b.txt" }]);
});

test("REQ050_AC7_ligne_deja_dans_le_dossier_sans_appel", async () => {
  const disque = disqueMobile({ "": [d("src"), f("b.txt")], src: [f("a.txt")] });
  const { vue, appels, dire } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  ctrl(vue, "src");
  ctrl(vue, "src/a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "b.txt", "src");
  expect(appelsRenommer(appels)).toEqual(["b.txt>src/b.txt"]);
  expect(dire).not.toHaveBeenCalled();
  expect(choisies(vue)).toEqual(["src/a.txt", "src/b.txt"]);
});

test("REQ050_AC10_AC21_refus_une_ligne_message_exact", async () => {
  const disque = disqueMobile({ "": [d("src"), d("lib"), f("a.txt"), f("b.txt")], src: [f("a.txt")], lib: [] });
  const { vue, dire } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "a.txt", "src");
  expect(dire).toHaveBeenCalledTimes(1);
  expect(dire.mock.calls[0][0]).toMatchObject({ texte: "a.txt n'a pas été déplacé : ce nom est déjà pris dans src/. Renommez-le, puis réessayez.", variante: "erreur", fermable: true });
  expect(dire.mock.calls[0][0].detail).toBeUndefined();
  expect(choisies(vue).sort()).toEqual(["a.txt", "src/b.txt"]);
  expect(document.activeElement.dataset.chemin).toBe("src/b.txt");
  // dossier refusé vers la racine
  disque.lib = [d("src")];
  disque["lib/src"] = [];
  ligne(vue, "lib").click();
  await attendre();
  dire.mockClear();
  await glisser(vue, "lib/src", null);
  expect(dire.mock.calls[0][0].texte).toBe("src/ n'a pas été déplacé : ce nom est déjà pris à la racine du projet. Renommez-le, puis réessayez.");
  // autre raison
  disque.renommer = () => ({ status: 403, corps: { cause: "interdit", message: "Ce dossier est protégé." } });
  dire.mockClear();
  await glisser(vue, "src/b.txt", "lib");
  expect(dire.mock.calls[0][0].texte).toBe("b.txt n'a pas été déplacé : Ce dossier est protégé.");
});

test("REQ050_AC21_refus_plusieurs_lignes_detail", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [f("a.txt"), f("b.txt")] });
  const { vue, dire } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  ligne(vue, "b.txt").focus();
  await glisser(vue, "b.txt", "src");
  expect(dire.mock.calls[0][0]).toMatchObject({
    texte: "2 éléments n'ont pas été déplacés.",
    detail: "a.txt : ce nom est déjà pris dans src/\nb.txt : ce nom est déjà pris dans src/",
    variante: "erreur",
    fermable: true,
  });
  expect(choisies(vue)).toEqual(["a.txt", "b.txt"]);
  expect(document.activeElement.dataset.chemin).toBe("b.txt");
});

test("REQ050_AC11_coupure_arrete_la_boucle", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue, appels, dire } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  disque.coupure = true;
  await glisser(vue, "a.txt", "src");
  expect(appelsRenommer(appels)).toEqual(["a.txt>src/a.txt"]);
  expect(dire).toHaveBeenCalledTimes(1);
  expect(dire.mock.calls[0][0]).toMatchObject({ texte: "Connexion perdue. Réessayez au retour.", variante: "alerte" });
  expect(noms(vue)).toEqual(["src", "a.txt", "b.txt"]);
});

test("REQ050_AC13_pas_de_redessin_pendant_le_glisse_puis_mise_a_jour", async () => {
  const disque = disqueMobile({ "": [f("a.txt"), f("b.txt")] });
  const { vue } = await monter(disque);
  const avant = lignes(vue);
  evt("dragstart", ligne(vue, "a.txt"));
  disque[""] = [f("a.txt"), f("b.txt"), f("nouveau.txt")];
  await vue.relire();
  vue.definirCourant("b.txt");
  expect(lignes(vue)).toEqual(avant);
  expect(avant[0].isConnected).toBe(true);
  evt("dragend", avant[0]);
  await attendre();
  await attendre();
  expect(noms(vue)).toEqual(["a.txt", "b.txt", "nouveau.txt"]);
});

test("REQ050_AC20_focusin_pendant_le_glisse_ne_selectionne_rien", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt")] });
  evt("dragstart", ligne(vue, "a.txt")); // la liste donne le focus à la ligne saisie
  expect(document.activeElement.dataset.chemin).toBe("a.txt");
  evt("dragend", ligne(vue, "a.txt"));
  await attendre();
  expect(choisies(vue)).toEqual([]);
  expect(document.activeElement.dataset.chemin).toBe("a.txt");
});

test("REQ050_AC16_focus_sur_la_premiere_deplacee", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  await glisser(vue, "b.txt", "src");
  expect(document.activeElement.dataset.chemin).toBe("src/a.txt");
});

test("REQ050_AC22_reussite_retire_le_message_precedent", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [f("a.txt")] });
  const bandeau = [];
  const dire = vi.fn(({ texte }) => {
    const m = document.createElement("div");
    m.textContent = texte;
    document.body.append(m);
    bandeau.push(m);
    return m;
  });
  const { vue } = await monter(disque, { dire });
  await glisser(vue, "a.txt", "src");
  expect(bandeau[0].isConnected).toBe(true);
  await glisser(vue, "b.txt", "src");
  expect(bandeau[0].isConnected).toBe(false);
  expect(dire).toHaveBeenCalledTimes(1);
});

test("REQ050_pas_de_glisse_pendant_les_deplacements", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue } = await monter(disque);
  let liberer;
  disque.attente = () => new Promise((r) => (liberer = r));
  evt("dragstart", ligne(vue, "a.txt"));
  const rendu = ligne(vue, "a.txt");
  evt("drop", ligne(vue, "src"));
  await attendre();
  const e = evt("dragstart", ligne(vue, "b.txt"));
  expect(e.defaultPrevented).toBe(true);
  disque.attente = null;
  liberer();
  await attendre();
  await attendre();
  expect(rendu).toBeTruthy();
  expect(e.defaultPrevented).toBe(true);
});

test("REQ050_relecture_croisee_jetee", async () => {
  const disque = disqueMobile({ "": [d("src"), f("a.txt"), f("b.txt")], src: [] });
  const { vue } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  let libererRelecture;
  let libererB;
  let relecturePrise = false;
  // La relecture lit l'arbre quand a.txt est déjà déplacé et que b.txt est en cours de déplacement.
  disque.attente = async (url) => {
    if (url.includes("/api/fichiers/renommer")) {
      if (url.includes("de=b.txt")) await new Promise((r) => (libererB = r));
    } else if (!relecturePrise) {
      relecturePrise = true;
      await new Promise((r) => (libererRelecture = r));
    }
  };
  const relecture = vue.relire();
  await attendre();
  evt("dragstart", ligne(vue, "a.txt"));
  evt("drop", ligne(vue, "src"));
  await attendre();
  await attendre();
  libererRelecture();
  await relecture;
  // Jetée : le focus n'a pas quitté a.txt, et rien n'est retiré de la sélection.
  expect(document.activeElement.dataset.chemin).toBe("a.txt");
  disque.attente = null;
  libererB();
  await attendre();
  await attendre();
  expect(choisies(vue)).toEqual(["src/a.txt", "src/b.txt"]);
  expect(document.activeElement.dataset.chemin).toBe("src/a.txt");
});

test("REQ070_AC1_menu_arbre_sans_git", async () => {
  const { vue } = await monter({ "": [f("a.txt")] }, { estDepot: () => false });
  ligne(vue, "a.txt").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  const libelles = [...document.querySelectorAll("[role=menu] [role=menuitem]")].map((e) => e.textContent);
  expect(libelles.length).toBeGreaterThan(0);
  expect(libelles.some((l) => l.startsWith("Indexer") || l.startsWith("Commit"))).toBe(false);
  expect(libelles.some((l) => l.startsWith("Renommer"))).toBe(true);
});

// ---- REQ-086 : worktree choisi ----

const PROJET = { chemin: "", nom: "yaide", branche: "main", detachee: false };
const ESSAI = { chemin: "../essai", nom: "essai", branche: "essai", detachee: false };

async function montrerWorktree(disque, liste = [PROJET, ESSAI], choix = "../essai") {
  const w = await import("../worktree.js");
  w.mettreAJour(liste);
  w.choisir(choix);
  const m = await monter(disque, { projet: "yaide", surOuvrir: vi.fn(), estDepot: () => true });
  const requetes = [];
  const brut = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requetes.push(`${init?.method ?? "GET"} ${decodeURIComponent(url)}`);
    return brut(url, init);
  }));
  return { ...m, w, requetes };
}
const dialogue = () => document.querySelector("dialog");
const saisir = (valeur) => {
  const s = dialogue().querySelector("input");
  s.value = valeur;
  s.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
};

test("REQ086_AC2_AC3_ligne_worktree_liee_arbre_relu_sans_selection_dossiers_propres_a_chaque_worktree", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("main.rs")], "../essai": [d("lib"), f("e.txt")], "../essai/lib": [f("x.rs")] };
  const w = await import("../worktree.js");
  w.mettreAJour([PROJET, ESSAI]);
  const { vue } = await monter(disque, { projet: "yaide" });
  const select = vue.entete.querySelector("select");
  expect([...select.options].map((o) => o.textContent)).toEqual(["yaide (main)", "essai (essai)"]);
  expect(vue.entete.querySelector("label").textContent).toBe("Worktree");
  expect(vue.entete.querySelector(".fichiers-projet").textContent).toBe("yaide");
  ligne(vue, "src").click();
  await attendre();
  expect(noms(vue)).toEqual(["src", "src/main.rs", "a.txt"]);
  // Choisir ici : le choix est celui de worktree.js (donc de la vue Git).
  select.focus();
  select.value = "../essai";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await attendre();
  expect(w.choisi()).toBe("../essai");
  expect(noms(vue)).toEqual(["../essai/lib", "../essai/e.txt"]);
  expect(vue.entete.querySelector(".fichiers-projet").textContent).toBe("essai");
  expect(vue.corps.querySelector("[aria-selected=true]")).toBeNull();
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  expect(document.activeElement).toBe(vue.entete.querySelector("select"));
  ligne(vue, "../essai/lib").click();
  await attendre();
  expect(noms(vue)).toEqual(["../essai/lib", "../essai/lib/x.rs", "../essai/e.txt"]);
  // L'inverse : un choix posé ailleurs (vue Git) met la liste et l'arbre à jour, et chaque worktree retrouve ses dossiers.
  w.choisir("");
  await attendre();
  expect(vue.entete.querySelector("select").value).toBe("");
  expect(noms(vue)).toEqual(["src", "src/main.rs", "a.txt"]);
  w.choisir("../essai");
  await attendre();
  expect(noms(vue)).toEqual(["../essai/lib", "../essai/lib/x.rs", "../essai/e.txt"]);
  // Disparition : retour au projet, dossiers dépliés d'avant, ligne masquée, focus sur la première ligne.
  vue.entete.querySelector("select").focus();
  w.mettreAJour([PROJET]);
  await attendre();
  await attendre();
  expect(w.choisi()).toBe("");
  expect(noms(vue)).toEqual(["src", "src/main.rs", "a.txt"]);
  expect(vue.entete.querySelector("select")).toBeNull();
  expect(document.activeElement).toBe(lignes(vue)[0]);
});

test("REQ086_AC2_ligne_masquee_avec_un_seul_worktree_et_chargement_apres_200_ms", async () => {
  const w = await import("../worktree.js");
  w.mettreAJour([PROJET]);
  const disque = { "": [f("a.txt")], "../essai": [f("e.txt")] };
  const { vue } = await monter(disque);
  expect(vue.entete.querySelector("select")).toBeNull();
  w.mettreAJour([PROJET, ESSAI]);
  expect(vue.entete.querySelector("select")).not.toBeNull();
  let libere;
  disque.attente = (url) => (url.includes("chemin=..%2Fessai") ? new Promise((r) => (libere = r)) : undefined);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  w.choisir("../essai");
  await vi.advanceTimersByTimeAsync(199);
  expect(vue.corps.textContent).not.toContain("Chargement…");
  expect(noms(vue)).toEqual(["a.txt"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(vue.corps.textContent).toContain("Chargement…");
  vi.useRealTimers();
  libere();
  await attendre();
  expect(noms(vue)).toEqual(["../essai/e.txt"]);
});

test("REQ086_AC4_ouverture_depuis_l_arbre_chemin_depuis_le_projet_et_statut_par_chemin", async () => {
  const disque = { "../essai": [d("src")], "../essai/src": [f("main.rs")] };
  const { vue, surOuvrir } = await montrerWorktree(disque);
  vue.definirStatuts(new Map([["../essai/src/main.rs", { lettre: "M", mot: "modifié" }]]));
  ligne(vue, "../essai/src").click();
  await attendre();
  expect(ligne(vue, "../essai/src/main.rs").querySelector(".liste-statut").textContent).toBe("M");
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    appels.push(url);
    return { ok: true, status: 200, text: async () => "fn main() {}", headers: { get: () => "1" } };
  }));
  ligne(vue, "../essai/src/main.rs").click();
  await attendre();
  expect(surOuvrir).toHaveBeenCalledWith(expect.objectContaining({ chemin: "../essai/src/main.rs", contenu: "fn main() {}" }));
  expect(appels[0]).toContain("chemin=..%2Fessai%2Fsrc%2Fmain.rs");
});

test("REQ086_AC5_creation_chemins_depuis_le_worktree_et_sortie_refusee_sans_requete", async () => {
  const disque = { "../essai": [d("src")], "../essai/src": [f("main.rs")] };
  const { vue, requetes } = await montrerWorktree(disque);
  bouton(vue, "Nouveau fichier").click();
  expect(dialogue().querySelector("input").value).toBe("");
  const avant = requetes.length;
  saisir("../projet/notes.md");
  await attendre();
  expect(dialogue().textContent).toContain("Ce chemin sort du worktree essai.");
  saisir("src/../../projet/notes.md");
  await attendre();
  expect(dialogue().textContent).toContain("Ce chemin sort du worktree essai.");
  expect(requetes.length).toBe(avant);
  saisir("src/a.txt");
  await attendre();
  await attendre();
  expect(requetes.some((r) => r.startsWith("POST /api/fichiers/creer?chemin=../essai/src/a.txt&type=fichier"))).toBe(true);
});

test("REQ086_AC5_renommer_supprimer_deplacer_indexer_avec_le_chemin_complet_et_messages_depuis_le_worktree", async () => {
  const disque = { "../essai": [d("src"), f("b.txt")], "../essai/src": [f("main.rs")] };
  const { vue, requetes, dire } = await montrerWorktree(disque);
  ligne(vue, "../essai/src").click();
  await attendre();
  ligne(vue, "../essai/src/main.rs").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  const menu = document.querySelector("[role=menu]");
  expect(menu.getAttribute("aria-label")).toBe("Actions sur src/main.rs");
  [...menu.querySelectorAll("[role=menuitem]")].find((i) => i.textContent.startsWith("Indexer")).click();
  await attendre();
  await attendre();
  expect(requetes.some((r) => r.startsWith("POST /api/git/indexer?chemin=../essai/src/main.rs"))).toBe(true);
  expect(dire).toHaveBeenCalledWith(expect.objectContaining({ texte: "src/main.rs est indexé." }));
  // Renommer : le dialogue montre le chemin depuis le worktree.
  ligne(vue, "../essai/src/main.rs").click();
  bouton(vue, "Renommer").click();
  expect(dialogue().querySelector("input").value).toBe("src/main.rs");
  saisir("src/lib.rs");
  await attendre();
  await attendre();
  expect(requetes.some((r) => r.includes("/api/fichiers/renommer?de=../essai/src/main.rs&vers=../essai/src/lib.rs"))).toBe(true);
  // Glisser b.txt dans src.
  await glisser(vue, "../essai/b.txt", "../essai/src");
  expect(requetes.some((r) => r.includes("renommer?de=../essai/b.txt&vers=../essai/src/b.txt"))).toBe(true);
  // Supprimer.
  ligne(vue, "../essai/src").click();
  bouton(vue, "Supprimer").click();
  [...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Supprimer").click();
  await attendre();
  await attendre();
  expect(requetes.some((r) => r.startsWith("DELETE /api/fichier?chemin=../essai/src"))).toBe(true);
});

test("REQ086_AC10_worktree_range_hors_du_projet_a_plusieurs_niveaux", async () => {
  const profond = { chemin: "../../essai/app", nom: "app", branche: "essai", detachee: false };
  const disque = { "../../essai/app": [f("x.rs")] };
  const { vue, requetes } = await montrerWorktree(disque, [PROJET, profond], "../../essai/app");
  expect(noms(vue)).toEqual(["../../essai/app/x.rs"]);
  expect(vue.entete.querySelector(".fichiers-projet").textContent).toBe("app");
  bouton(vue, "Nouveau fichier").click();
  saisir("n.rs");
  await attendre();
  await attendre();
  expect(requetes.some((r) => r.includes("creer?chemin=../../essai/app/n.rs"))).toBe(true);
  bouton(vue, "Nouveau fichier").click();
  saisir("../x");
  await attendre();
  expect(dialogue().textContent).toContain("Ce chemin sort du worktree app.");
});

test("REQ086_AC17_pendant_un_pull_la_liste_est_desactivee_avec_sa_raison", async () => {
  const { vue, w } = await montrerWorktree({ "": [f("a.txt")], "../essai": [] }, [PROJET, ESSAI], "");
  vue.entete.querySelector("select").focus();
  w.occuper("Attendez la fin du pull.");
  const apres = vue.entete.querySelector("select");
  expect(apres.disabled).toBe(true);
  expect(apres.title).toBe("Attendez la fin du pull.");
});

test("REQ104_AC17_le_focus_revient_sur_la_ligne_visee_apres_Annuler_et_apres_un_ajout_accepte", async () => {
  const { vue } = await monter({ "": [f("a.txt"), f("b.txt")] }, { agents: true });
  const base = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST" && String(url).startsWith("/api/connaissance")) return { ok: true, status: 202, json: async () => ({ numero: 1, collection: "notes", total: 1 }) };
    if (String(url).startsWith("/api/connaissance")) return { ok: true, status: 200, json: async () => ({ config: { provider: "openai", modele: "m" }, collections: [], ajout: null }) };
    return base(url, init);
  }));
  const ouvrirDialogue = async () => {
    commande(menuSur(vue, "b.txt"), "Ajouter").click();
    await attendre();
    return document.querySelector("dialog");
  };
  let dlg = await ouvrirDialogue();
  [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Annuler").click();
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(ligne(vue, "b.txt"));
  dlg = await ouvrirDialogue();
  dlg.querySelector("input").value = "notes";
  [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Ajouter").click();
  await attendre();
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(ligne(vue, "b.txt"));
});

// ---- REQ-111, REQ-112 : fichiers de la base de connaissance ----
const marque = (vue, chemin) => ligne(vue, chemin).querySelector(".liste-base");

test("REQ112_AC1_AC3_AC5_les_fichiers_de_la_base_portent_la_marque_pas_les_autres_ni_les_dossiers", async () => {
  const disque = {
    "": [d("docs"), f("n.md")],
    docs: [f("a.md"), f("c.md")],
    base: { "docs/a.md": { collections: ["notes", "api"], echec: null }, "n.md": { collections: ["notes"], echec: "OpenAI a refusé la requête (401)." } },
  };
  const { vue } = await monter(disque, { agents: true });
  ligne(vue, "docs").click();
  await attendre();
  await vue.relire();
  expect(marque(vue, "docs/a.md")).not.toBeNull();
  expect(marque(vue, "docs/c.md")).toBeNull();
  expect(marque(vue, "docs")).toBeNull();
  expect(ligne(vue, "docs/a.md").getAttribute("aria-label") ?? ligne(vue, "docs/a.md").textContent).toContain("a.md");
  expect(marque(vue, "n.md").className).toContain("liste-base-echec");
  expect(marque(vue, "n.md").getAttribute("aria-hidden")).toBe("true");
});

test("REQ112_AC1_agents_desactives_aucune_marque_et_aucune_lecture_de_la_base", async () => {
  const disque = { "": [f("a.md")], base: { "a.md": { collections: ["notes"], echec: null } } };
  const { vue, appels } = await monter(disque);
  await vue.relire();
  expect(marque(vue, "a.md")).toBeNull();
  expect(appels.some((u) => String(u).startsWith("/api/connaissance"))).toBe(false);
});

test("REQ112_AC1_base_non_configuree_aucune_marque", async () => {
  const { vue } = await monter({ "": [f("a.md")], base: {} }, { agents: true });
  await vue.relire();
  expect(marque(vue, "a.md")).toBeNull();
});

test("REQ112_AC2_la_marque_apparait_et_disparait_a_la_relecture_sans_redessiner_les_lignes", async () => {
  const disque = { "": [f("a.md"), f("b.md")] };
  const { vue } = await monter(disque, { agents: true });
  await attendre();
  ligne(vue, "a.md").focus();
  const avant = ligne(vue, "a.md");
  disque.base = { "b.md": { collections: ["notes"], echec: null } };
  await vue.relire();
  expect(marque(vue, "b.md")).not.toBeNull();
  expect(ligne(vue, "a.md")).toBe(avant);
  expect(document.activeElement).toBe(avant);
  disque.base = {};
  await vue.relire();
  expect(marque(vue, "b.md")).toBeNull();
  expect(ligne(vue, "a.md")).toBe(avant);
});

test("REQ112_AC4_relecture_sans_changement_aucune_ligne_redessinee_coupure_et_refus_gardent_la_marque", async () => {
  const disque = { "": [f("a.md")], base: { "a.md": { collections: ["notes"], echec: null } } };
  const { vue, dire } = await monter(disque, { agents: true });
  await vue.relire();
  const l = ligne(vue, "a.md");
  await vue.relire();
  expect(ligne(vue, "a.md")).toBe(l);
  disque.baCoupure = true;
  await vue.relire();
  expect(marque(vue, "a.md")).not.toBeNull();
  disque.baCoupure = false;
  disque.baRefus = true;
  await vue.relire();
  expect(marque(vue, "a.md")).not.toBeNull();
  expect(dire).not.toHaveBeenCalled();
});

test("REQ111_AC3_commande_desactivee_sans_fichier_de_la_base_active_pour_fichier_dossier_et_selection", async () => {
  const disque = {
    "": [d("docs"), d("vide"), f("a.md"), f("b.md")],
    docs: [f("x.md")],
    vide: [f("y.md")],
    base: { "docs/x.md": { collections: ["notes"], echec: null }, "a.md": { collections: ["notes"], echec: null } },
  };
  const { vue } = await monter(disque, { agents: true });
  await vue.relire();
  const etat = (chemin) => commande(menuSur(vue, chemin), "Mettre à jour").getAttribute("aria-disabled");
  expect(etat("a.md")).toBeNull();
  expect(etat("docs")).toBeNull();
  document.body.querySelector("[role=menu]")?.remove();
  expect(etat("b.md")).toBe("true");
  expect(etat("vide")).toBe("true");
  ctrl(vue, "b.md");
  ctrl(vue, "a.md");
  expect(etat("b.md")).toBeNull();
});

test("REQ111_AC5_la_commande_envoie_les_chemins_dit_le_debut_et_rend_le_focus_a_la_ligne", async () => {
  const disque = {
    "": [d("docs"), f("a.md")],
    docs: [f("x.md")],
    base: { "docs/x.md": { collections: ["notes"], echec: null }, "a.md": { collections: ["notes"], echec: null } },
  };
  const { vue, appels, dire } = await monter(disque, { agents: true });
  await vue.relire();
  commande(menuSur(vue, "docs"), "Mettre à jour").click();
  await attendre();
  await attendre();
  expect(appels).toContainEqual({ chemins: ["docs"] });
  expect(dire.mock.calls.at(-1)[0]).toMatchObject({ texte: "Mise à jour de docs/ dans la base de connaissance…", variante: "info", fermable: true });
  expect(document.querySelector("dialog[open]")).toBeNull();
  expect(document.activeElement).toBe(ligne(vue, "docs"));
  ctrl(vue, "a.md"); // « docs » est déjà sélectionné par le menu précédent
  commande(menuSur(vue, "a.md"), "Mettre à jour").click();
  await attendre();
  await attendre();
  expect(appels).toContainEqual({ chemins: ["docs", "a.md"] });
  expect(dire.mock.calls.at(-1)[0].texte).toBe("Mise à jour de 2 éléments dans la base de connaissance…");
});

// ---- T-250 : preuves descendues de coupure.spec.js ----

test("REQ015_AC8_pendant_la_coupure_deplier_un_dossier_est_refuse", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("main.rs")] };
  const { vue, dire } = await monter(disque);
  disque.coupure = true;
  ligne(vue, "src").click();
  await attendre();
  await attendre();
  expect(dire).toHaveBeenCalledTimes(1);
  expect(dire.mock.calls[0][0]).toMatchObject({ texte: "Connexion perdue. Réessayez au retour.", variante: "alerte" });
  expect(noms(vue)).toEqual(["src", "a.txt"]);
  delete disque.coupure;
});

test("REQ015_AC8_pendant_la_coupure_creer_renommer_supprimer_disent_de_reessayer", async () => {
  const REFUS = "Connexion perdue. Réessayez au retour.";
  const alerte = () => dialogue().querySelector("[role=alert]")?.textContent ?? "";
  const disque = { "": [f("README.md")] };
  const { vue, appels } = await monter(disque);
  ligne(vue, "README.md").click();
  disque.coupure = true;
  appels.length = 0;
  const annuler = () => [...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Annuler").click();
  bouton(vue, "Nouveau fichier").click();
  saisir("neuf.txt");
  await attendre();
  await attendre();
  expect(alerte()).toBe(REFUS);
  annuler();
  bouton(vue, "Renommer").click();
  saisir("autre.md");
  await attendre();
  await attendre();
  expect(alerte()).toBe(REFUS);
  annuler();
  bouton(vue, "Supprimer").click();
  [...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Supprimer").click();
  await attendre();
  await attendre();
  expect(alerte()).toBe(REFUS);
  expect(noms(vue)).toEqual(["README.md"]);
});

test("REQ034_AC2_projet_vide_dans_un_depot_propose_aussi_commit", async () => {
  const { vue } = await monter({ "": [] }, { estDepot: () => true });
  expect(vue.corps.textContent).toContain("Dossier vide.");
  vue.corps.querySelector(".fichiers-arbre").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  const m = document.querySelector("[role=menu]");
  expect(m.getAttribute("aria-label")).toBe("Actions sur le projet");
  expect([...m.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)).toEqual(["Nouveau fichier", "Nouveau dossier", "Nouveau whiteboard", "CollerCtrl+V", "Commit"]);
  expect(m.querySelectorAll("[role=separator]").length).toBe(2);
});

test("REQ034_AC6_indexer_un_dossier_dit_que_le_dossier_est_indexe", async () => {
  const { vue, appels, dire } = await monter({ "": [d("Zeta")] }, { estDepot: () => true });
  commande(menuSur(vue, "Zeta"), "Indexer").click();
  await attendre();
  await attendre();
  expect(appels.some((a) => String(a).startsWith("/api/git/indexer?chemin=Zeta"))).toBe(true);
  expect(dire).toHaveBeenCalledWith(expect.objectContaining({ texte: "Zeta/ est indexé.", variante: "succes" }));
});

test("REQ034_AC13_indexer_pendant_une_coupure_dit_connexion_perdue", async () => {
  const disque = { "": [f("a.txt")] };
  const { vue, dire } = await monter(disque, { estDepot: () => true });
  const m = menuSur(vue, "a.txt");
  disque.coupure = true;
  commande(m, "Indexer").click();
  await attendre();
  await attendre();
  expect(dire).toHaveBeenCalledTimes(1);
  expect(dire.mock.calls[0][0]).toMatchObject({ texte: "Connexion perdue. Réessayez au retour.", variante: "alerte" });
});

test("REQ008_AC1_REQ120_AC1_une_image_s_ouvre_sans_lecture_du_fichier", async () => {
  const surOuvrir = vi.fn(async () => {});
  const surLecture = vi.fn(() => 5);
  const { vue, appels } = await monter({ "": [d("img"), f("PHOTO.JPG")], img: [f("logo.png"), f("icone.svg")] }, { surOuvrir, surLecture });
  const avant = appels.length;
  ligne(vue, "PHOTO.JPG").click();
  await attendre();
  expect(surOuvrir).toHaveBeenCalledWith({ chemin: "PHOTO.JPG", geste: 5 });
  expect(appels.slice(avant).some((u) => String(u).includes("/api/fichier?"))).toBe(false);
  expect(surLecture).toHaveBeenLastCalledWith(false);
  expect(vue.corps.ownerDocument.querySelector("[role=alert]")).toBeNull();
});

// ---- REQ-125 : copier et coller ----

const frappe = (vue, chemin, key, opts = { ctrlKey: true }) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  ligne(vue, chemin).dispatchEvent(e);
  // le navigateur enchaîne le Ctrl+V (Cmd+V sur macOS) par un événement `paste`, sauf si le clavier l'a retenu
  const mac = /Mac/.test(navigator.platform);
  if (key === "v" && !e.defaultPrevented && (mac ? opts.metaKey : opts.ctrlKey)) collerSysteme(vue, chemin, []);
  return e;
};
/** Un événement `paste` sur la ligne, avec ces éléments dans le presse-papiers du système. */
const collerSysteme = (vue, chemin, elements) => {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  const files = elements.map((x) => x.getAsFile?.()).filter(Boolean);
  Object.defineProperty(e, "clipboardData", { value: { files, items: elements } });
  ligne(vue, chemin).dispatchEvent(e);
  return e;
};
const elFichier = (nom, octets = "x") => ({ kind: "file", getAsFile: () => new File([octets], nom), webkitGetAsEntry: () => ({ isDirectory: false, name: nom, file: (ok) => ok(new File([octets], nom)) }) });
const elDossier = (nom, enfants) => ({ kind: "file", getAsFile: () => new File([], nom), webkitGetAsEntry: () => entreeDossier(nom, enfants) });
const entreeDossier = (nom, enfants) => {
  let lu = false;
  return { isDirectory: true, name: nom, createReader: () => ({ readEntries: (ok) => { ok(lu ? [] : enfants); lu = true; } }) };
};
const entreeFichier = (nom, octets = "x") => ({ isDirectory: false, name: nom, file: (ok) => ok(new File([octets], nom)) });
const entreeIllisible = (nom) => ({ isDirectory: false, name: nom, file: (_, ko) => ko(new Error("refus")) });
const appelsCopier = (appels) => appels.filter((u) => typeof u === "string" && u.includes("/api/fichiers/copier")).map((u) => { const p = new URL(u, "http://x").searchParams; return `${p.get("de")}>${p.get("dans")}`; });
const bulle = async (b) => {
  b.parentElement.dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(document.querySelector("[role=tooltip]")).not.toBeNull());
  const texte = document.querySelector("[role=tooltip]").textContent;
  b.parentElement.dispatchEvent(new Event("pointerleave"));
  return texte;
};
const FILES = () => ({ "": [d("doc"), d("src"), f("a.txt"), f("b.txt")], doc: [], src: [] });

test("REQ125_AC1_AC15_copier_du_menu_puis_coller_du_menu_du_dossier", async () => {
  const disque = FILES();
  const { vue, appels, dire } = await monter(disque);
  disque.copier = () => {
    disque.src = [f("a.txt")];
  };
  ctrl(vue, "a.txt");
  const m = menuSur(vue, "a.txt");
  expect(commande(m, "Coller").getAttribute("aria-disabled")).toBe("true");
  commande(m, "Copier").click();
  expect(document.querySelector("[role=menu]")).toBeNull();
  expect(document.activeElement).toBe(ligne(vue, "a.txt")); // REQ125_AC15
  expect(bouton(vue, "Coller").disabled).toBe(false);
  expect(dire).not.toHaveBeenCalled();
  const m2 = menuSur(vue, "src");
  expect(commande(m2, "Coller").hasAttribute("aria-disabled")).toBe(false);
  commande(m2, "Coller").click();
  await vi.waitFor(() => expect(noms(vue)).toContain("src/a.txt"));
  expect(appelsCopier(appels)).toEqual(["a.txt>src"]);
  expect(choisies(vue)).toEqual(["src/a.txt"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("true");
  expect(ligne(vue, "a.txt")).toBeDefined();
  expect(dire).not.toHaveBeenCalled();
});

test("REQ125_AC2_AC16_boutons_et_raccourcis_clavier", async () => {
  const disque = FILES();
  const { vue, appels, dire } = await monter(disque);
  expect(bouton(vue, "Copier").disabled).toBe(true);
  expect(bouton(vue, "Coller").disabled).toBe(true);
  expect(bouton(vue, "Copier").getAttribute("aria-keyshortcuts")).toBe("Control+C");
  expect(bouton(vue, "Coller").getAttribute("aria-keyshortcuts")).toBe("Control+V");
  expect(await bulle(bouton(vue, "Copier"))).toBe("Copier (Ctrl+C)"); // désactivé, il garde son info-bulle
  expect(await bulle(bouton(vue, "Coller"))).toBe("Coller (Ctrl+V)");
  ctrl(vue, "a.txt");
  bouton(vue, "Copier").focus();
  bouton(vue, "Copier").click();
  expect(document.activeElement).toBe(bouton(vue, "Copier")); // REQ125_AC15 : le focus reste sur le bouton
  expect(dire).not.toHaveBeenCalled();
  expect(bouton(vue, "Coller").disabled).toBe(false);
  ligne(vue, "src").click();
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/a.txt"]));
  ligne(vue, "b.txt").click();
  expect(frappe(vue, "b.txt", "c").defaultPrevented).toBe(true);
  frappe(vue, "src", "v");
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["a.txt>src", "b.txt>src"]));
});

test("REQ125_AC2_AC16_macos_simule_Cmd_copie_et_Ctrl_ne_fait_rien", async () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const { vue, appels } = await monter(FILES());
  expect(bouton(vue, "Copier").getAttribute("aria-keyshortcuts")).toBe("Meta+C");
  expect(bouton(vue, "Coller").getAttribute("aria-keyshortcuts")).toBe("Meta+V");
  expect(await bulle(bouton(vue, "Copier"))).toBe("Copier (Cmd+C)");
  expect(await bulle(bouton(vue, "Coller"))).toBe("Coller (Cmd+V)");
  ctrl(vue, "a.txt");
  frappe(vue, "a.txt", "c", { ctrlKey: true });
  frappe(vue, "src", "v", { ctrlKey: true });
  expect(bouton(vue, "Coller").disabled).toBe(true);
  frappe(vue, "a.txt", "c", { metaKey: true });
  expect(bouton(vue, "Coller").disabled).toBe(false);
  frappe(vue, "src", "v", { metaKey: true });
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["a.txt>src"]));
  const m = menuSur(vue, "a.txt");
  expect(commande(m, "Copier").textContent).toBe("CopierCmd+C");
});

test("REQ125_AC5_AC18_plusieurs_lignes_enfant_d_un_dossier_ecarte_focus_sur_la_premiere", async () => {
  const disque = { "": [d("doc"), d("src"), f("a.txt"), f("b.txt")], doc: [], src: [f("x.txt")] };
  const { vue, appels } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  bouton(vue, "Copier").click();
  ligne(vue, "src").click();
  await attendre();
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["a.txt>src", "b.txt>src"]));
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/a.txt", "src/b.txt"]));
  expect(document.activeElement).toBe(ligne(vue, "src/a.txt"));
  // AC-049-4 : « Copier » du menu de b.txt, puis Ctrl+C, copient aussi les deux lignes.
  for (const geste of ["menu", "clavier"]) {
    appels.length = 0;
    ligne(vue, "a.txt").click();
    ctrl(vue, "b.txt");
    if (geste === "menu") commande(menuSur(vue, "b.txt"), "Copier").click();
    else frappe(vue, "b.txt", "c");
    ligne(vue, "doc").click();
    bouton(vue, "Coller").click();
    await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["a.txt>doc", "b.txt>doc"]));
    await vi.waitFor(() => expect(choisies(vue)).toEqual(["doc/a.txt", "doc/b.txt"]));
    disque.doc = [];
  }
  appels.length = 0;
  ligne(vue, "src/a.txt").click();
  ctrl(vue, "src/b.txt");
  ctrl(vue, "src"); // le dossier et ses deux enfants sont sélectionnés
  expect(choisies(vue)).toEqual(["src", "src/a.txt", "src/b.txt"]);
  bouton(vue, "Copier").click();
  ligne(vue, "doc").click();
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["src>doc"]));
});

test("REQ125_AC6_AC13_AC17_AC18_refus_un_seul_message_la_selection_ne_change_pas", async () => {
  const disque = FILES();
  const { vue, dire } = await monter(disque);
  disque.copier = () => ({ status: 400, corps: { cause: "invalide", message: "Un dossier ne peut pas être copié dans lui-même." } });
  ligne(vue, "src").click();
  bouton(vue, "Copier").click();
  bouton(vue, "Coller").focus();
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(dire).toHaveBeenCalled());
  expect(dire).toHaveBeenCalledWith({ texte: "src/ n'a pas été copié : un dossier ne peut pas être copié dans lui-même.", variante: "erreur", fermable: true });
  expect(choisies(vue)).toEqual(["src"]);
  expect(document.activeElement).toBe(bouton(vue, "Coller")); // REQ125_AC18 : le focus reste sur le bouton
  ligne(vue, "src").focus();
  frappe(vue, "src", "v");
  await vi.waitFor(() => expect(dire).toHaveBeenCalledTimes(2));
  await attendre();
  expect(choisies(vue)).toEqual(["src"]);
  expect(document.activeElement).toBe(ligne(vue, "src")); // REQ125_AC18 : le focus est sur la ligne visée
  expect(noms(vue)).not.toContain("src/src");
});

test("REQ125_AC7_AC8_AC13_element_disparu_les_autres_sont_copies_le_message_nomme_le_fichier", async () => {
  const disque = FILES();
  const retire = vi.fn();
  const { vue, dire, appels } = await monter(disque, { dire: vi.fn(() => ({ remove: retire })) });
  disque.copier = (de) => (de === "a.txt" ? { status: 404, corps: { cause: "introuvable", message: "Introuvable." } } : undefined);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  bouton(vue, "Copier").click();
  ligne(vue, "src").click();
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(dire).toHaveBeenCalled());
  expect(appelsCopier(appels)).toEqual(["a.txt>src", "b.txt>src"]);
  expect(dire).toHaveBeenCalledWith({ texte: "a.txt n'a pas été copié : il n'existe plus.", variante: "erreur", fermable: true });
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/b.txt"]));
  // Le contenu est lu par le serveur au collage : la vue n'écrit rien (REQ125_AC7).
  expect(appels.some((u) => typeof u === "string" && u.startsWith("/api/fichier?"))).toBe(false);
  disque.copier = () => ({ status: 403, corps: { cause: "interdit", message: "Ce dossier est protégé." } });
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(retire).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(dire).toHaveBeenCalledTimes(2));
  expect(dire.mock.calls[1][0]).toEqual({ texte: "2 éléments n'ont pas été copiés.", detail: "a.txt : ce dossier est protégé\nb.txt : ce dossier est protégé", variante: "erreur", fermable: true });
  disque.copier = () => undefined;
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(retire).toHaveBeenCalledTimes(2));
  expect(dire).toHaveBeenCalledTimes(2); // un collage réussi n'affiche rien
});

test("REQ125_AC9_coupure_arret_liste_gardee_collage_au_retour", async () => {
  const disque = FILES();
  const { vue, dire, appels } = await monter(disque);
  ctrl(vue, "a.txt");
  ctrl(vue, "b.txt");
  bouton(vue, "Copier").click();
  ligne(vue, "src").click();
  disque.coupure = true;
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(dire).toHaveBeenCalledWith({ texte: "Connexion perdue. Réessayez au retour.", variante: "alerte", fermable: true }));
  expect(appelsCopier(appels)).toEqual(["a.txt>src"]); // arrêt à la première coupure
  expect(bouton(vue, "Coller").disabled).toBe(false);
  disque.coupure = false;
  appels.length = 0;
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["a.txt>src", "b.txt>src"]));
});

test("REQ125_AC10_AC11_rien_de_copie_ni_presse_papiers_ni_base_ni_ouverture", async () => {
  const lire = vi.fn();
  const ecrire = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { readText: lire, writeText: ecrire } });
  const surOuvrir = vi.fn();
  const disque = FILES();
  disque.windows = () => ({ wsl: false }); // hors de WSL (REQ181_AC5)
  const { vue, appels, dire } = await monter(disque, { surOuvrir, agents: true, estDepot: () => true });
  ligne(vue, "src").click();
  frappe(vue, "src", "v"); // rien de copié
  expect(appelsCopier(appels)).toEqual([]);
  expect(bouton(vue, "Coller").disabled).toBe(true);
  ligne(vue, "a.txt").click();
  frappe(vue, "a.txt", "c");
  frappe(vue, "src", "v");
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["a.txt>src"]));
  expect(lire).not.toHaveBeenCalled();
  expect(ecrire).not.toHaveBeenCalled();
  expect(surOuvrir).not.toHaveBeenCalled();
  expect(appels.some((u) => typeof u === "string" && u.includes("/api/git/indexer"))).toBe(false);
  expect(appels.some((u) => typeof u === "object")).toBe(false); // aucun POST vers la base de connaissance
  expect(dire).not.toHaveBeenCalled();
  document.body.replaceChildren();
  const neuve = await monter(FILES());
  expect(bouton(neuve.vue, "Coller").disabled).toBe(true);
});

test("REQ125_AC14_Ctrl_C_hors_de_l_arbre_et_sans_selection_ne_font_rien", async () => {
  const { vue, appels } = await monter(FILES());
  const saisie = document.createElement("input");
  document.body.append(saisie);
  saisie.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true }));
  expect(bouton(vue, "Coller").disabled).toBe(true);
  frappe(vue, "a.txt", "c"); // aucune ligne sélectionnée
  expect(bouton(vue, "Coller").disabled).toBe(true);
  ctrl(vue, "a.txt");
  ligne(vue, "b.txt").focus();
  frappe(vue, "b.txt", "c");
  expect(document.activeElement).toBe(ligne(vue, "b.txt")); // le focus reste sur la ligne
  expect(choisies(vue)).toEqual(["a.txt"]); // la sélection ne change pas
  expect(document.querySelector("dialog")).toBeNull();
  expect(appelsCopier(appels)).toEqual([]);
});

const menuDe = (cible) => {
  cible.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  return document.querySelector("[role=menu]");
};
const commandeMenu = (m, nom) => [...m.querySelectorAll("[role=menuitem]")].find((i) => i.textContent === nom);

async function montrerWhiteboard(disque, options = {}) {
  const ecritures = [];
  const { vue, appels, ...reste } = await monter(disque, { surOuvrir: vi.fn(), ...options });
  const base = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "PUT" && String(url).startsWith("/api/fichier?")) {
      ecritures.push({ url: String(url), corps: init.body });
      return { ok: true, status: 200, json: async () => ({ version: "v1" }) };
    }
    if (String(url).startsWith("/api/fichier?") && !init?.method) return { ok: true, status: 200, text: async () => "", headers: new Headers() };
    if (init?.method === "POST" && String(url).startsWith("/api/fichiers/creer") && !disque.coupure && !disque.refus) {
      const chemin = decodeURIComponent(new URL(url, "http://x").searchParams.get("chemin"));
      const i = chemin.lastIndexOf("/");
      disque[chemin.slice(0, Math.max(i, 0))]?.push(f(chemin.slice(i + 1)));
    }
    if (disque.refus && String(url).startsWith("/api/fichiers/creer")) return { ok: false, status: 409, json: async () => ({ cause: "existe", message: "Ce nom est déjà pris. Choisissez-en un autre." }) };
    return base(url, init);
  }));
  return { vue, appels, ecritures, ...reste };
}

const VIDE = '{\n  "version": 1,\n  "boxes": [],\n  "links": []\n}\n';

test("REQ127_AC1_AC6_AC7_nouveau_whiteboard_ecrit_le_fichier_vide_et_l_ouvre_sans_changer_la_selection", async () => {
  const { vue, appels, ecritures, surOuvrir } = await montrerWhiteboard({ "": [d("docs")], docs: [f("a.md")] });
  ligne(vue, "docs").click();
  await attendre();
  ligne(vue, "docs/a.md").click();
  await attendre();
  commandeMenu(menuDe(ligne(vue, "docs/a.md")), "Nouveau whiteboard").click();
  const dlg = dialogue();
  expect(dlg.querySelector(`#${dlg.getAttribute("aria-labelledby")}`).textContent).toBe("Nouveau whiteboard");
  const saisie = dlg.querySelector("input");
  expect(saisie.value).toBe("docs/");
  expect(document.activeElement).toBe(saisie);
  expect(saisie.selectionStart).toBe(5);
  expect(dlg.querySelector("label").textContent).toBe("Chemin");
  const aide = dlg.querySelector(".champ-aide");
  expect(aide.textContent).toBe("L'extension .jdiag s'ajoute si elle manque.");
  expect(saisie.getAttribute("aria-describedby")).toContain(aide.id);
  expect([...dlg.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Annuler", "Créer"]);
  saisir("docs/plan");
  await attendre();
  await attendre();
  await attendre();
  expect(appels).toContain("/api/fichiers/creer?chemin=docs%2Fplan.jdiag&type=fichier");
  expect(ecritures.length).toBe(1);
  expect(decodeURIComponent(ecritures[0].url)).toContain("chemin=docs/plan.jdiag");
  expect(ecritures[0].corps).toBe(VIDE);
  expect(dialogue()).toBeNull();
  expect(ligne(vue, "docs/plan.jdiag")).toBeDefined();
  expect(surOuvrir).toHaveBeenCalledWith(expect.objectContaining({ chemin: "docs/plan.jdiag" }));
  expect(ligne(vue, "docs/a.md").getAttribute("aria-selected")).toBe("true");
  expect(vue.corps.querySelectorAll("[aria-selected=true]").length).toBe(1);
});

test("REQ127_AC6_Annuler_et_Echap_ne_creent_rien_et_rendent_le_focus_a_la_ligne", async () => {
  const { vue, appels, ecritures } = await montrerWhiteboard({ "": [d("docs")], docs: [f("a.md")] });
  ligne(vue, "docs").click();
  await attendre();
  for (const fermer of ["Annuler", "Echap"]) {
    commandeMenu(menuDe(ligne(vue, "docs/a.md")), "Nouveau whiteboard").click();
    expect(dialogue()).not.toBeNull();
    if (fermer === "Annuler") [...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Annuler").click();
    else dialogue().dispatchEvent(new Event("cancel", { cancelable: true }));
    await attendre();
    expect(dialogue()?.open ?? false).toBe(false);
    expect(document.activeElement).toBe(ligne(vue, "docs/a.md"));
  }
  expect(appels.some((u) => String(u).includes("/creer"))).toBe(false);
  expect(ecritures.length).toBe(0);
});

test("REQ127_AC2_partie_vide_champ_vide_et_extension_ajoutee_sans_casse", async () => {
  const { vue, ecritures } = await montrerWhiteboard({ "": [f("a.md")] });
  const chemins = [];
  for (const [saisi, attendu] of [["schema.jdiag", "schema.jdiag"], ["Schema.JDIAG", "Schema.JDIAG"], ["notes.v2", "notes.v2.jdiag"]]) {
    commandeMenu(menuDe(vue.corps.querySelector(".fichiers-arbre")), "Nouveau whiteboard").click();
    expect(dialogue().querySelector("input").value).toBe("");
    saisir(saisi);
    await attendre();
    await attendre();
    await attendre();
    chemins.push([attendu, decodeURIComponent(ecritures.at(-1).url).split("chemin=")[1]]);
  }
  for (const [attendu, recu] of chemins) expect(recu).toBe(attendu);
});

test("REQ127_AC3_AC7_nom_pris_refuse_dialogue_ouvert_et_rien_ecrit", async () => {
  const disque = { "": [d("docs")], docs: [f("plan.jdiag")] };
  const { vue, ecritures } = await montrerWhiteboard(disque);
  ligne(vue, "docs").click();
  await attendre();
  commandeMenu(menuDe(ligne(vue, "docs/plan.jdiag")), "Nouveau whiteboard").click();
  disque.refus = true;
  saisir("docs/plan");
  await attendre();
  await attendre();
  const dlg = dialogue();
  expect(dlg).not.toBeNull();
  expect(ecritures.length).toBe(0);
  const saisie = dlg.querySelector("input");
  expect(saisie.value).toBe("docs/plan");
  expect(document.activeElement).toBe(saisie);
  expect(saisie.getAttribute("aria-invalid")).toBe("true");
  const alerte = dlg.querySelector("[role=alert]");
  expect(alerte.textContent).toBe("Ce nom est déjà pris. Choisissez-en un autre.");
  expect(alerte.compareDocumentPosition(dlg.querySelector(".champ-aide")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("REQ127_AC4_worktree_essai_cree_dans_le_worktree", async () => {
  const ecritures = [];
  const { vue } = await montrerWorktree({ "../essai": [f("x.rs")] });
  const base = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "PUT") {
      ecritures.push(decodeURIComponent(String(url)));
      return { ok: true, status: 200, json: async () => ({ version: "v" }) };
    }
    return base(url, init);
  }));
  commandeMenu(menuDe(vue.corps.querySelector(".fichiers-arbre")), "Nouveau whiteboard").click();
  expect(dialogue().querySelector("input").value).toBe("");
  saisir("plan");
  await attendre();
  await attendre();
  await attendre();
  expect(ecritures.some((u) => u.includes("chemin=../essai/plan.jdiag"))).toBe(true);
});

test("REQ127_AC5_coupure_dit_de_reessayer_rien_cree_puis_Entree_au_retour_cree", async () => {
  const disque = { "": [f("a.md")] };
  const { vue, ecritures } = await montrerWhiteboard(disque);
  disque.coupure = true;
  commandeMenu(menuDe(vue.corps.querySelector(".fichiers-arbre")), "Nouveau whiteboard").click();
  saisir("plan");
  await attendre();
  await attendre();
  const dlg = dialogue();
  expect(dlg.querySelector("[role=alert]").textContent).toBe("Connexion perdue. Réessayez au retour.");
  expect(ecritures.length).toBe(0);
  disque.coupure = false;
  dlg.querySelector("input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await attendre();
  await attendre();
  await attendre();
  expect(ecritures.length).toBe(1);
});

// ---- REQ-180 : coller depuis l'explorateur ----

test("REQ180_AC1_AC7_AC4_fichiers_du_systeme_importes_dans_src_selectionnes_et_focus_sur_le_premier", async () => {
  const disque = { "": [d("src"), f("README.md")], src: [] };
  const surOuvrir = vi.fn();
  const { vue, appels, dire } = await monter(disque, { surOuvrir, estDepot: () => true });
  ctrl(vue, "README.md");
  frappe(vue, "README.md", "c");
  ligne(vue, "src").focus();
  const e = collerSysteme(vue, "src", [elFichier("a.txt", "abc"), elFichier("logo.png", "\u0001\u0002")]);
  expect(e.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/a.txt", "src/logo.png"]));
  expect(disque.importes).toEqual(["fichier:src/a.txt:3", "fichier:src/logo.png:2"]);
  expect(appelsCopier(appels)).toEqual([]); // la liste de Yaide n'est pas collée (REQ180_AC4)
  expect(document.activeElement).toBe(ligne(vue, "src/a.txt"));
  expect(dire).not.toHaveBeenCalled();
  expect(surOuvrir).not.toHaveBeenCalled(); // REQ180_AC7
  expect(appels.some((u) => typeof u === "string" && u.includes("/api/git/indexer"))).toBe(false);
  expect(appels.some((u) => typeof u === "object")).toBe(false);
  expect(bouton(vue, "Coller").disabled).toBe(false); // REQ180_AC12 : la liste reste
});

test("REQ180_AC2_dossier_et_son_contenu_dans_le_dossier_neuf_focus_sur_photos", async () => {
  const disque = { "": [d("photos"), f("README.md")], photos: [] };
  const { vue } = await monter(disque);
  const photos = elDossier("photos", [entreeFichier("a.jpg", "12"), entreeDossier("2024", [entreeFichier("b.jpg", "123")]), entreeDossier("vide", [])]);
  ligne(vue, "README.md").focus();
  collerSysteme(vue, "README.md", [photos]);
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["photos copie"]));
  expect(disque.importes).toEqual(["dossier:photos copie:0", "fichier:photos copie/a.jpg:2", "dossier:photos copie/2024:0", "fichier:photos copie/2024/b.jpg:3", "dossier:photos copie/vide:0"]);
  expect(document.activeElement).toBe(ligne(vue, "photos copie"));
});

test("REQ180_AC4_texte_seul_colle_la_liste_de_Yaide_et_bouton_et_menu_collent_la_liste", async () => {
  const disque = { "": [d("src"), f("b.txt")], src: [] };
  const { vue, appels } = await monter(disque);
  ctrl(vue, "b.txt");
  expect(frappe(vue, "b.txt", "c").defaultPrevented).toBe(true);
  const clavier = frappe(vue, "src", "v"); // `paste` sans fichier
  expect(clavier.defaultPrevented).toBe(false); // le clavier laisse passer le `paste`
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/b.txt"]));
  ligne(vue, "src").click();
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["b.txt>src", "b.txt>src"]));
  await attendre();
  commande(menuSur(vue, "src"), "Coller").click(); // le menu colle la liste de Yaide
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["b.txt>src", "b.txt>src", "b.txt>src"]));
  expect(disque.importes).toBeUndefined();
});

test("REQ180_AC5_AC9_AC11_refus_nomme_le_chemin_d_origine_et_le_dossier_cree_est_selectionne", async () => {
  const disque = { "": [d("photos"), d("src")], photos: [], src: [d("photos")] };
  const { vue, dire } = await monter(disque);
  ligne(vue, "src").focus();
  collerSysteme(vue, "src", [elDossier("photos", [entreeFichier("a.jpg"), entreeDossier("2024", [entreeIllisible("b.jpg")])])]);
  await vi.waitFor(() => expect(dire).toHaveBeenCalled());
  expect(dire).toHaveBeenCalledWith({ texte: "photos/2024/b.jpg n'a pas été copié : il n'a pas pu être lu.", variante: "erreur", fermable: true });
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/photos copie"]));
  expect(document.activeElement).toBe(ligne(vue, "src/photos copie"));
  expect(disque.importes).toContain("dossier:src/photos copie:0");
  dire.mockClear();
  const sansContenu = { kind: "file", getAsFile: () => new File([], "photos"), webkitGetAsEntry: () => ({ isDirectory: true, name: "photos", createReader: () => ({ readEntries: (_, ko) => ko(new Error("refus")) }) }) };
  collerSysteme(vue, "src", [sansContenu]);
  await vi.waitFor(() => expect(dire).toHaveBeenCalledWith({ texte: "photos/ n'a pas été copié : le navigateur n'a pas donné son contenu.", variante: "erreur", fermable: true }));
  dire.mockClear();
  collerSysteme(vue, "src", [elFichier("ok.txt"), elDossier("p", [entreeIllisible("x.jpg"), entreeIllisible("y.jpg")])]);
  await vi.waitFor(() => expect(dire).toHaveBeenCalledWith({ texte: "2 éléments n'ont pas été copiés.", detail: "p/x.jpg : il n'a pas pu être lu\np/y.jpg : il n'a pas pu être lu", variante: "erreur", fermable: true }));
  expect(disque.importes).toContain("fichier:src/ok.txt:1");
});

test("REQ180_AC5_AC12_collage_entierement_refuse_ne_change_ni_la_selection_ni_le_focus", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [] };
  disque.importer = () => ({ status: 403, corps: { cause: "interdit", message: "Ce dossier est protégé." } });
  const { vue, dire } = await monter(disque);
  ligne(vue, "a.txt").click();
  ligne(vue, "src").focus();
  collerSysteme(vue, "src", [elFichier("n.txt")]);
  await vi.waitFor(() => expect(dire).toHaveBeenCalledWith({ texte: "n.txt n'a pas été copié : ce dossier est protégé.", variante: "erreur", fermable: true }));
  await attendre();
  expect(choisies(vue)).toEqual(["a.txt"]);
  expect(document.activeElement).toBe(ligne(vue, "src"));
  expect(bouton(vue, "Coller").disabled).toBe(true);
  expect(commande(menuSur(vue, "src"), "Coller").getAttribute("aria-disabled")).toBe("true");
});

test("REQ180_AC6_coupure_pendant_le_collage_message_et_rien_d_autre_n_est_cree", async () => {
  const disque = { "": [d("src")], src: [] };
  const { vue, dire } = await monter(disque);
  ligne(vue, "src").focus();
  disque.attente = (u) => {
    if (u.includes("nom=b.txt")) disque.coupure = true;
  };
  collerSysteme(vue, "src", [elFichier("a.txt"), elFichier("b.txt"), elFichier("c.txt")]);
  await vi.waitFor(() => expect(dire).toHaveBeenCalledWith({ texte: "Connexion perdue. Réessayez au retour.", variante: "alerte", fermable: true }));
  expect(disque.importes).toEqual(["fichier:src/a.txt:1"]); // ce qui est copié reste, rien d'autre n'est créé
});

test("REQ180_AC9_un_collage_reussi_retire_le_message_precedent", async () => {
  const disque = { "": [d("src")], src: [] };
  const retirer = vi.fn();
  const { vue, dire } = await monter(disque, { dire: vi.fn(() => ({ remove: retirer })) });
  ligne(vue, "src").focus();
  collerSysteme(vue, "src", [elDossier("p", [entreeIllisible("x.jpg")])]);
  await vi.waitFor(() => expect(dire).toHaveBeenCalledTimes(1));
  await attendre();
  collerSysteme(vue, "src", [elFichier("ok.txt")]);
  await vi.waitFor(() => expect(retirer).toHaveBeenCalled());
  expect(dire).toHaveBeenCalledTimes(1);
});

test("REQ180_AC10_hors_de_l_arbre_rien_n_est_cree_et_un_second_collage_attend_la_fin_du_premier", async () => {
  const disque = { "": [d("src")], src: [] };
  const { vue } = await monter(disque);
  const champ = document.createElement("input");
  document.body.append(champ);
  const e = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", { value: { files: [new File(["x"], "a.txt")], items: [elFichier("a.txt")] } });
  champ.dispatchEvent(e);
  await attendre();
  expect(e.defaultPrevented).toBe(false);
  expect(disque.importes).toBeUndefined();
  let liberer;
  disque.attente = (u) => (u.includes("/importer") ? new Promise((r) => (liberer = r)) : undefined);
  ligne(vue, "src").focus();
  collerSysteme(vue, "src", [elFichier("a.txt")]);
  await vi.waitFor(() => expect(liberer).toBeDefined());
  collerSysteme(vue, "src", [elFichier("b.txt")]);
  await attendre();
  disque.attente = undefined;
  liberer();
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/a.txt"]));
  expect(disque.importes).toEqual(["fichier:src/a.txt:1"]);
});

// ---- REQ-185 : jauge du téléversement ----

const grosFichier = (nom, octets) => elFichier(nom, "x".repeat(octets));

test("REQ185_AC1_AC4_jauge_de_0_a_100_sans_reculer_et_retiree_avant_la_selection", async () => {
  const disque = { "": [d("src")], src: [], parts: 4 };
  const surTeleversement = vi.fn();
  const { vue } = await monter(disque, { surTeleversement });
  ligne(vue, "src").focus();
  disque.surPart = (url, i) => {
    if (url.includes("nom=a.bin") && i === 2) expect(surTeleversement.mock.calls.at(-1)[0]).toBe(37); // 1,5 Mo sur 4 : 37 %
  };
  collerSysteme(vue, "src", [grosFichier("a.bin", 300), grosFichier("b.bin", 100)]);
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/a.bin", "src/b.bin"]));
  const valeurs = surTeleversement.mock.calls.map((c) => c[0]);
  expect(valeurs[0]).toBe(0);
  expect(valeurs.at(-2)).toBe(100);
  expect(valeurs.at(-1)).toBeUndefined();
  const nombres = valeurs.slice(0, -1);
  expect(nombres).toEqual([...nombres].sort((x, y) => x - y)); // jamais en recul
  expect(disque.importes).toEqual([`fichier:src/a.bin:300`, `fichier:src/b.bin:100`]); // REQ185_AC4 : octets identiques
});

test("REQ185_AC1_jauge_a_mi_chemin_du_premier_fichier_entre_30_et_45_pour_cent", async () => {
  const disque = { "": [d("src")], src: [], parts: 2 };
  const surTeleversement = vi.fn();
  const { vue } = await monter(disque, { surTeleversement });
  ligne(vue, "src").focus();
  collerSysteme(vue, "src", [grosFichier("a.bin", 300), grosFichier("b.bin", 100)]);
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/a.bin", "src/b.bin"]));
  expect(surTeleversement.mock.calls.map((c) => c[0])).toEqual([0, 37, 75, 87, 100, undefined]);
});

test("REQ185_AC2_sans_collage_depuis_l_explorateur_ni_copie_ni_deplacement_la_jauge_n_est_jamais_posee", async () => {
  const disque = disqueMobile({ "": [d("src"), f("b.txt"), f("a.txt")], src: [] });
  const surTeleversement = vi.fn();
  const { vue, appels } = await monter(disque, { surTeleversement });
  expect(surTeleversement).not.toHaveBeenCalled(); // avant tout collage
  ctrl(vue, "b.txt");
  frappe(vue, "b.txt", "c");
  ligne(vue, "src").click();
  bouton(vue, "Coller").click();
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["b.txt>src"]));
  await attendre();
  expect(surTeleversement).not.toHaveBeenCalled(); // copie de REQ-125
  await glisser(vue, "a.txt", "src"); // déplacement de REQ-050
  expect(choisies(vue)).toEqual(["src/a.txt"]);
  expect(surTeleversement).not.toHaveBeenCalled();
});

test("REQ185_AC3_fichier_illisible_ou_refuse_compte_comme_envoye_la_jauge_finit_a_100_puis_disparait", async () => {
  const disque = { "": [d("src")], src: [], parts: 2 };
  disque.importer = (_, nom) => (nom === "refuse.bin" ? { status: 403, corps: { cause: "interdit", message: "Ce dossier est protégé." } } : undefined);
  const surTeleversement = vi.fn();
  const { vue, dire } = await monter(disque, { surTeleversement });
  ligne(vue, "src").focus();
  collerSysteme(vue, "src", [grosFichier("refuse.bin", 100), elDossier("p", [entreeIllisible("x.jpg"), entreeFichier("ok.bin", "y".repeat(100))])]);
  await vi.waitFor(() => expect(dire).toHaveBeenCalled());
  const valeurs = surTeleversement.mock.calls.map((c) => c[0]);
  expect(valeurs.at(-1)).toBeUndefined();
  expect(valeurs.at(-2)).toBe(100);
  const nombres = valeurs.slice(0, -1);
  expect(nombres).toEqual([...nombres].sort((x, y) => x - y));
  expect(dire.mock.calls[0][0].detail).toBe("refuse.bin : ce dossier est protégé\np/x.jpg : il n'a pas pu être lu");
});

test("REQ185_AC3_coupure_pendant_le_collage_la_jauge_disparait_et_le_message_s_affiche", async () => {
  const disque = { "": [d("src")], src: [], parts: 2 };
  const surTeleversement = vi.fn();
  const { vue, dire } = await monter(disque, { surTeleversement });
  ligne(vue, "src").focus();
  disque.attente = (u) => {
    if (u.includes("nom=b.bin")) disque.coupure = true;
  };
  collerSysteme(vue, "src", [grosFichier("a.bin", 100), grosFichier("b.bin", 100)]);
  await vi.waitFor(() => expect(dire).toHaveBeenCalledWith({ texte: "Connexion perdue. Réessayez au retour.", variante: "alerte", fermable: true }));
  expect(surTeleversement.mock.calls.at(-1)[0]).toBeUndefined();
});

test("REQ185_AC3_collage_sans_octet_reste_a_0_jusqu_a_la_fin", async () => {
  const disque = { "": [d("src")], src: [] };
  const surTeleversement = vi.fn();
  const { vue } = await monter(disque, { surTeleversement });
  ligne(vue, "src").focus();
  collerSysteme(vue, "src", [elDossier("vide", [])]);
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/vide"]));
  expect(surTeleversement.mock.calls.map((c) => c[0])).toEqual([0, undefined]);
});

test("REQ185_AC5_la_jauge_ne_prend_pas_le_focus_ni_la_selection_de_l_arbre", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [], parts: 2 };
  const etats = {};
  const surTeleversement = vi.fn((n) => {
    etats[n === undefined ? "fin" : n === 0 ? "debut" : "milieu"] = { actif: document.activeElement?.dataset?.chemin, selection: choisies(vue) };
  });
  const { vue } = await monter(disque, { surTeleversement });
  ligne(vue, "a.txt").click();
  ligne(vue, "src").focus();
  const avant = { actif: "src", selection: ["a.txt"] };
  collerSysteme(vue, "src", [elFichier("n.txt")]);
  await vi.waitFor(() => expect(choisies(vue)).toEqual(["src/n.txt"]));
  expect(etats.debut).toEqual(avant); // apparition
  expect(etats.milieu).toEqual(avant);
  expect(etats.fin).toEqual(avant); // disparition
});

// ---- REQ-181 : « Copier » met aussi les lignes dans le presse-papiers de Windows ----

const ECHEC_WINDOWS = { status: 500, corps: { cause: "windows", message: "PowerShell a échoué", detail: "Accès refusé" } };

test("REQ181_AC2_Ctrl_C_bouton_et_menu_envoient_la_meme_liste_dossier_seul", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [f("x.txt")] };
  const { vue } = await monter(disque);
  ligne(vue, "src").click();
  await attendre();
  ligne(vue, "a.txt").click();
  ctrl(vue, "src/x.txt");
  frappe(vue, "a.txt", "c");
  await vi.waitFor(() => expect(disque.windowsAppels).toEqual([["src/x.txt", "a.txt"]]));
  ctrl(vue, "a.txt"); // retiré de la sélection
  ctrl(vue, "src");
  frappe(vue, "src", "c"); // src et src/x.txt sélectionnés : le dossier seul
  bouton(vue, "Copier").click();
  commande(menuSur(vue, "src"), "Copier").click();
  await vi.waitFor(() => expect(disque.windowsAppels.length).toBe(4));
  expect(disque.windowsAppels[1]).toEqual(["src"]);
  expect(disque.windowsAppels[2]).toEqual(disque.windowsAppels[1]);
  expect(disque.windowsAppels[3]).toEqual(disque.windowsAppels[1]);
});

test("REQ181_AC7_fichiers_du_presse_papiers_aux_memes_noms_collent_la_liste_sinon_import", async () => {
  const disque = { "": [d("src"), f("a.txt")], src: [] };
  const { vue, appels } = await monter(disque);
  ligne(vue, "a.txt").click();
  frappe(vue, "a.txt", "c");
  const e = collerSysteme(vue, "src", [elFichier("a.txt")]);
  expect(e.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(appelsCopier(appels)).toEqual(["a.txt>src"]));
  await attendre();
  expect(disque.importes).toBeUndefined();
  collerSysteme(vue, "src", [elFichier("z.txt")]);
  await vi.waitFor(() => expect(disque.importes).toEqual(["fichier:src/z.txt:1"]));
  expect(appelsCopier(appels)).toEqual(["a.txt>src"]);
});

test("REQ181_AC6_AC9_echec_liste_retenue_toasts_exacts_focus_et_selection_inchanges", async () => {
  const disque = { "": [f("a.txt"), f("b.txt")] };
  const { vue, dire } = await monter(disque);
  ctrl(vue, "a.txt");
  ligne(vue, "a.txt").focus();
  disque.windows = () => ({ status: 500, corps: { cause: "windows", message: "Windows n'a pas répondu", raison: "Windows n'a pas répondu", detail: "" } });
  frappe(vue, "a.txt", "c");
  await vi.waitFor(() => expect(dire).toHaveBeenCalledWith({ texte: "Copie vers l'explorateur de Windows impossible : Windows n'a pas répondu. Copiez de nouveau.", variante: "erreur", fermable: true, cause: "presse-papiers-windows" }));
  expect(bouton(vue, "Coller").disabled).toBe(false);
  disque.windows = () => ECHEC_WINDOWS;
  frappe(vue, "a.txt", "c");
  await vi.waitFor(() => expect(dire).toHaveBeenCalledWith({ texte: "Copie vers l'explorateur de Windows impossible : PowerShell a échoué. Copiez de nouveau.", variante: "erreur", fermable: true, cause: "presse-papiers-windows", detail: "Accès refusé" }));
  expect(choisies(vue)).toEqual(["a.txt"]);
  expect(document.activeElement).toBe(ligne(vue, "a.txt"));
  expect(dire).toHaveBeenCalledTimes(2);
});

test("REQ181_AC10_toast_retire_au_succes_un_seul_toast_appel_remplace_ignore_coupure_sans_essai", async () => {
  const disque = { "": [f("a.txt")] };
  const retire = vi.fn();
  const dire = vi.fn(() => ({ remove: retire }));
  const { vue } = await monter(disque, { dire });
  ctrl(vue, "a.txt");
  disque.windows = () => ECHEC_WINDOWS;
  frappe(vue, "a.txt", "c");
  await vi.waitFor(() => expect(dire).toHaveBeenCalledTimes(1));
  // second échec au même texte : l'ancien toast est retiré avant le nouveau, un seul reste
  frappe(vue, "a.txt", "c");
  await vi.waitFor(() => expect(dire).toHaveBeenCalledTimes(2));
  expect(retire).toHaveBeenCalledTimes(1);
  disque.windows = () => ({ wsl: true });
  frappe(vue, "a.txt", "c");
  await vi.waitFor(() => expect(retire).toHaveBeenCalledTimes(2));
  expect(dire).toHaveBeenCalledTimes(2);
  // premier appel en échec (lent), second réussi : aucun toast de plus
  let liberer;
  const attente = new Promise((r) => (liberer = r));
  let n = 0;
  disque.windows = async () => (++n === 1 ? (await attente, ECHEC_WINDOWS) : { wsl: true });
  frappe(vue, "a.txt", "c");
  frappe(vue, "a.txt", "c");
  await vi.waitFor(() => expect(disque.windowsAppels.length).toBe(5));
  liberer();
  await attendre();
  await attendre();
  expect(dire).toHaveBeenCalledTimes(2);
  // coupure : liste retenue, pas de message de plus, pas d'essai au retour
  disque.coupure = true;
  frappe(vue, "a.txt", "c");
  await attendre();
  await attendre();
  disque.coupure = false;
  await vue.relire();
  await attendre();
  expect(dire).toHaveBeenCalledTimes(2);
  expect(disque.windowsAppels.length).toBe(5);
  expect(bouton(vue, "Coller").disabled).toBe(false);
});

test("REQ181_AC8_le_README_decrit_l_essai_manuel_sous_Windows", () => {
  const readme = readFileSync("README.md", "utf8");
  expect(readme).toContain("Copier vers l'explorateur de Windows");
  expect(readme).toContain("photos/2024/b.jpg");
  expect(readme).toContain("photos/vide");
});

// ---- REQ-203 : « Suivre le fichier actif » ----

const DISQUE_SUIVI = () => ({ "": [d("src"), f("README.md"), f("lib.rs")], src: [f("main.rs")] });
const suivi = async (enfonce, disque = DISQUE_SUIVI(), options = {}) => {
  localStorage.clear();
  if (enfonce) localStorage.setItem("yaide-suivre-fichier", "1");
  const defile = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  const m = await monter(disque, options);
  return { ...m, defile, b: bouton(m.vue, "Suivre le fichier actif") };
};

test("REQ203_AC1_AC9_AC10_bouton_enfonce_suit_le_fichier_actif_sans_prendre_le_focus_et_dernier_bouton_de_l_entete", async () => {
  const { vue, defile, b } = await suivi(true);
  expect(b.getAttribute("aria-pressed")).toBe("true");
  expect(b.getAttribute("aria-label")).toBe("Suivre le fichier actif");
  expect([...vue.entete.querySelectorAll("button")].pop()).toBe(b);
  expect(b.querySelector("svg")).not.toBeNull();
  const editeur = document.createElement("textarea");
  document.body.append(editeur);
  editeur.focus();
  vue.definirCourant("src/main.rs");
  await attendre();
  expect(noms(vue)).toEqual(["src", "src/main.rs", "README.md", "lib.rs"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("true");
  expect(choisies(vue)).toEqual(["src/main.rs"]);
  expect(defile).toHaveBeenCalledWith({ block: "nearest" });
  expect(document.activeElement).toBe(editeur);
});

test("REQ203_AC3_seule_la_ligne_du_fichier_ouvert_reste_selectionnee", async () => {
  const { vue } = await suivi(true);
  ctrl(vue, "README.md");
  ctrl(vue, "src");
  expect(choisies(vue).length).toBe(2);
  vue.definirCourant("lib.rs");
  await attendre();
  expect(choisies(vue)).toEqual(["lib.rs"]);
});

test("REQ203_AC4_bouton_relache_ne_change_ni_selection_ni_dossiers", async () => {
  const { vue, b } = await suivi(false);
  expect(b.getAttribute("aria-pressed")).toBe("false");
  ctrl(vue, "README.md");
  vue.definirCourant("src/main.rs");
  await attendre();
  expect(choisies(vue)).toEqual(["README.md"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("false");
  expect(ligne(vue, "src/main.rs")).toBeUndefined();
});

test("REQ203_AC5_enfoncer_le_bouton_applique_le_fichier_courant_et_garde_le_focus_sur_le_bouton", async () => {
  const { vue, b, dire } = await suivi(false);
  vue.definirCourant("src/main.rs");
  await attendre();
  expect(choisies(vue)).toEqual([]);
  b.focus();
  b.click();
  await attendre();
  expect(b.getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.getItem("yaide-suivre-fichier")).toBe("1");
  expect(choisies(vue)).toEqual(["src/main.rs"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(b);
  expect(dire).not.toHaveBeenCalled();
});

test("REQ203_AC6_onglet_sans_fichier_ou_hors_de_l_arbre_ne_change_pas_la_selection", async () => {
  const { vue } = await suivi(true, { ...DISQUE_SUIVI(), "../essai": [f("e.rs")] });
  vue.definirCourant("lib.rs");
  await attendre();
  vue.definirCourant(null); // diff, Agent…
  await attendre();
  expect(choisies(vue)).toEqual(["lib.rs"]);
  const w = await import("../worktree.js");
  w.mettreAJour([{ chemin: "", nom: "yaide", branche: "main", detachee: false }, { chemin: "../essai", nom: "essai", branche: "essai", detachee: false }]);
  w.choisir("../essai");
  await attendre();
  await attendre();
  expect(noms(vue)).toEqual(["../essai/e.rs"]);
  ctrl(vue, "../essai/e.rs");
  expect(choisies(vue)).toEqual(["../essai/e.rs"]);
  vue.definirCourant("src/main.rs"); // hors du dossier que montre l'arbre
  await attendre();
  expect(choisies(vue)).toEqual(["../essai/e.rs"]);
});

test("REQ203_AC6_fichier_d_un_autre_worktree_quand_l_arbre_montre_le_projet_ne_change_rien", async () => {
  const { vue } = await suivi(true, { ...DISQUE_SUIVI(), "..": [d("essai")], "../essai": [f("e.rs")] });
  vue.definirCourant("../essai/e.rs");
  await attendre();
  expect(noms(vue)).toEqual(["src", "README.md", "lib.rs"]);
  expect(choisies(vue)).toEqual([]);
  expect(bouton(vue, "Renommer").disabled).toBe(true);
  expect(bouton(vue, "Supprimer").disabled).toBe(true);
});

test("REQ203_AC8_panneau_replie_la_selection_se_fait_quand_meme", async () => {
  const { vue } = await suivi(true);
  vue.corps.hidden = true;
  vue.entete.hidden = true;
  vue.definirCourant("src/main.rs");
  await attendre();
  vue.corps.hidden = false;
  expect(choisies(vue)).toEqual(["src/main.rs"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("true");
});

test("REQ203_AC11_Espace_puis_Entree_changent_l_etat_sans_toucher_l_arbre_ni_message", async () => {
  const { vue, b, dire } = await suivi(false);
  ctrl(vue, "README.md");
  b.focus();
  b.click(); // Espace sur un bouton : clic natif
  expect(b.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(b);
  b.click(); // Entrée
  expect(b.getAttribute("aria-pressed")).toBe("false");
  expect(localStorage.getItem("yaide-suivre-fichier")).toBe("0");
  expect(choisies(vue)).toEqual(["README.md"]);
  expect(ligne(vue, "src").getAttribute("aria-expanded")).toBe("false");
  expect(dire).not.toHaveBeenCalled();
});
