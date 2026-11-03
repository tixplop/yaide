import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { depotExemple, lancerYaide, ouvrirYaide } from "./aides.js";

const MUSL = path.resolve("target/x86_64-unknown-linux-musl/release/yaide");

let yaide;
test.afterEach(async () => {
  await yaide?.arreter();
});

/** Copie le seul binaire musl dans un dossier vide de `.test-data/` et lance Yaide depuis là. */
async function lancerLivre(dossier) {
  expect(fs.existsSync(MUSL), "binaire musl absent : lancer `build` d'abord").toBe(true);
  const vide = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "livraison-"));
  const binaire = path.join(vide, "yaide");
  fs.copyFileSync(MUSL, binaire);
  fs.chmodSync(binaire, 0o755);
  expect(fs.readdirSync(vide)).toEqual(["yaide"]);
  yaide = await lancerYaide({ shell: "/bin/sh", dossier, binaire });
  return yaide;
}

const residente = (pid) => Number(/VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))[1]);

test("REQ029_AC1_binaire_seul_sert_toute_l_interface_et_poignee_de_main_tls", async ({ page }) => {
  await lancerLivre(depotExemple());
  const socket = await new Promise((ok, ko) => {
    const s = tls.connect({ host: "127.0.0.1", port: yaide.port, rejectUnauthorized: false }, () => ok(s));
    s.once("error", ko);
  });
  expect(["TLSv1.2", "TLSv1.3"]).toContain(socket.getProtocol());
  expect(socket.getPeerCertificate().subject).toBeTruthy();
  expect(socket.authorized).toBe(false); // certificat auto-signé
  socket.destroy();
  await ouvrirYaide(page, yaide.origine);
  for (const nom of ["Fichiers", "Recherche", "Git"]) await expect(page.getByRole("tab", { name: nom, exact: true })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Fichiers" })).toBeVisible();
  await page.getByRole("treeitem", { name: "src", exact: true }).click();
  await page.getByRole("treeitem", { name: "main.rs", exact: true }).click();
  await expect(page.getByLabel("Éditeur main.rs").locator(".cm-line").first()).toContainText("fn main");
  await page.locator(".terminal:visible .xterm-helper-textarea").focus();
  await page.keyboard.type("echo livre_$((6*7))");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal:visible .xterm-rows")).toContainText("livre_42");
});

test("REQ029_AC2_AC3_deux_shells_memoire_sous_50_Mo_et_aucune_requete_hors_origine", async ({ page }) => {
  const dossier = depotExemple();
  fs.writeFileSync(path.join(dossier, "README.md"), "# Titre\n\n![distante](https://exemple.invalid/image.png)\n\n[lien](https://exemple.invalid/)\n");
  await lancerLivre(dossier);
  const requetes = [];
  page.on("request", (r) => requetes.push(r.url()));
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("button", { name: "Nouveau shell" }).click();
  await expect(page.getByRole("tab", { name: "shell 2" })).toBeVisible();
  await expect(page.locator(".terminal:visible .terminal-attente")).toBeHidden();
  // Usage de l'interface : fichiers, aperçu markdown avec image distante, recherche, git.
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  const apercu = page.getByRole("region", { name: "Aperçu" });
  await expect(apercu.getByRole("heading", { name: "Titre" })).toBeVisible();
  await expect(apercu.locator("img")).toHaveCount(0);
  await page.getByRole("tab", { name: "Recherche" }).click();
  await page.getByRole("textbox", { name: "Rechercher" }).fill("fn main");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Résultats de la recherche" }).getByRole("option")).toHaveCount(1);
  await page.getByRole("tab", { name: "Git" }).click();
  await expect(page.getByRole("heading", { name: "Git" })).toBeVisible();
  await page.waitForTimeout(1500);
  const horsOrigine = requetes.filter((u) => !u.startsWith(yaide.origine + "/") && !u.startsWith("data:") && !u.startsWith("blob:") && !u.startsWith("about:"));
  expect(horsOrigine).toEqual([]);
  expect(requetes.length).toBeGreaterThan(0);
  // Mémoire résidente au repos, deux shells ouverts.
  const ko = residente(yaide.pid);
  expect(ko, `${ko} ko résidents`).toBeLessThan(50 * 1024);
});

test("REQ031_AC3_afficher_les_icones_ne_declenche_aucune_requete", async ({ page }) => {
  await lancerLivre(depotExemple());
  const requetes = [];
  page.on("request", (r) => requetes.push(r));
  await ouvrirYaide(page, yaide.origine);
  await page.getByRole("tab", { name: "Git" }).click();
  await expect(page.getByRole("button", { name: "Commit" })).toBeVisible();
  await page.getByRole("tab", { name: "Fichiers", exact: true }).click();
  await expect(page.locator('.fichiers-pied [aria-label="Supprimer"] svg[data-icone="trash-2"]')).toBeVisible();
  // Seules les requêtes attendues : le document, les fichiers de l'interface, l'API et ses flux.
  const inattendues = requetes.filter((r) => {
    const u = new URL(r.url());
    if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return false;
    if (u.origin !== yaide.origine) return true;
    if (["image", "font", "media"].includes(r.resourceType())) return true;
    return !(r.resourceType() === "document" || /^\/(assets\/|api\/)/.test(u.pathname) || /\.(js|css)$/.test(u.pathname) || u.pathname === "/");
  });
  expect(inattendues.map((r) => `${r.resourceType()} ${r.url()}`)).toEqual([]);
});
