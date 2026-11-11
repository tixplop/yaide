import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lancerYaide, ouvrirYaide, depotExemple, fauxGithub } from "./aides.js";

const NOM = "yaide-v0.9.2-x86_64-linux";

test("REQ092_REQ093_parcours_64_mise_a_jour", async ({ page }) => {
  test.setTimeout(60000);
  const racine = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "maj-"));
  const dossierBin = path.join(racine, "bin");
  const faux = path.join(racine, "faux");
  const releases = path.join(racine, "releases");
  for (const d of [dossierBin, faux, releases]) fs.mkdirSync(d, { recursive: true });
  const binaire = path.join(dossierBin, "yaide");
  fs.copyFileSync("target/debug/yaide", binaire);
  fs.chmodSync(binaire, 0o755);
  const avant = fs.readFileSync(binaire);

  // Release v0.9.2 : archive, et empreinte d'abord fausse.
  const src = path.join(racine, "src", NOM);
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "yaide"), "#!/bin/sh\necho nouveau\n");
  const archive = path.join(releases, `${NOM}.tar.gz`);
  expect(spawnSync("tar", ["-czf", archive, "-C", path.join(racine, "src"), NOM]).status).toBe(0);
  const ecrireEmpreinte = (somme) => fs.writeFileSync(`${archive}.sha256`, `${somme}  ${NOM}.tar.gz\n`);
  ecrireEmpreinte("0".repeat(64));

  // Faux `curl` : lit les fichiers de `releases`, note ses appels.
  fs.writeFileSync(
    path.join(faux, "curl"),
    `#!/bin/sh
echo "$*" >> "${racine}/appels"
out=""; fmt=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) fmt="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [ -n "$fmt" ]; then printf 'https://github.com/tixplop/yaide/releases/tag/v0.9.2'; exit 0; fi
f="${releases}/\${url##*/}"
[ -f "$f" ] || exit 22
cp "$f" "$out"
`,
    { mode: 0o755 },
  );

  // Faux GitHub : répond tout de suite v0.9.2.
  const github = await fauxGithub();
  const urlReleases = github.url;

  const yaide = await lancerYaide({ dossier: depotExemple(), binaire, releases: urlReleases, outils: faux });
  try {
    const autres = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (/^https?:$/.test(u.protocol) && u.origin !== yaide.origine) autres.push(r.url());
    });
    await page.setViewportSize({ width: 800, height: 480 });
    await ouvrirYaide(page, yaide.origine);
    const etat = page.locator(".cadre-etat");
    const statut = etat.getByRole("status");
    const bouton = etat.getByRole("button", { name: /Mettre à jour|Mise à jour…/ });

    // Étape 1 : notification et bouton (AC-092-3), sur une ligne sans défilement (AC-092-6).
    await expect(statut).toHaveText("v0.9.2 disponible");
    await expect(etat).toContainText("v0.6.0");
    await expect(bouton).toBeVisible();
    const mise_en_page = async () =>
      page.evaluate(() => {
        const e = document.querySelector(".cadre-etat");
        const r = e.getBoundingClientRect();
        const enfants = [...e.children].filter((x) => x.offsetParent);
        const rects = enfants.map((x) => x.getBoundingClientRect());
        const triees = [...rects].sort((a, b) => a.left - b.left);
        const superpose = triees.some((b, i) => i > 0 && b.left < triees[i - 1].right - 0.5);
        const hors = rects.some((b) => b.right > innerWidth + 0.5 || b.left < 0);
        const centres = rects.map((b) => b.top + b.height / 2);
        const lignes = Math.max(...centres) - Math.min(...centres) < 4 && rects.every((b) => b.top >= r.top - 1 && b.bottom <= r.bottom + 1) ? 1 : 2;
        const coupe = (sel) => {
          const x = e.querySelector(sel);
          return !x || x.scrollWidth > x.clientWidth;
        };
        const coupes = [".ya-status-maj .message", ".ya-status-maj button", ".ya-status-version"].filter(coupe);
        return { n: enfants.length, superpose, hors, lignes, coupes, defile: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
      });
    const m1 = await mise_en_page();
    expect(m1).toMatchObject({ superpose: false, hors: false, lignes: 1, coupes: [], defile: false });
    expect(m1.n).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: path.join(racine, "etape1.png") });

    // Tab depuis le dernier bouton du rail droit → « Mettre à jour », contour visible (AC-092-6).
    await page.locator(".cadre-rail-droit button").last().focus();
    await page.keyboard.press("Tab");
    await expect(bouton).toBeFocused();
    expect(await bouton.evaluate((e) => getComputedStyle(e).outlineStyle !== "none" && getComputedStyle(e).outlineWidth !== "0px")).toBe(true);

    // Étape 2 : premier essai, empreinte fausse (AC-093-3) ; le focus reste sur le bouton (AC-093-6).
    const shellsAvant = await page.evaluate(() => fetch("/api/shells").then((r) => r.json()));
    await page.keyboard.press("Enter");
    const alerte = etat.getByRole("alert");
    await expect(alerte).toHaveText("La mise à jour a échoué : l'empreinte SHA-256 ne correspond pas.");
    await expect(bouton).toBeFocused();
    await expect(bouton).toHaveText("Mettre à jour");
    expect(fs.readFileSync(binaire).equals(avant)).toBe(true);
    await expect(etat).toContainText("v0.6.0");
    await page.screenshot({ path: path.join(racine, "etape3.png") });

    // Étape 3 : empreinte juste, nouvel essai (AC-093-1, AC-093-6).
    ecrireEmpreinte(crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex"));
    await page.keyboard.press("Enter");
    const installee = etat.getByRole("status").filter({ hasText: "installée" });
    await expect(installee).toHaveText("v0.9.2 installée. Redémarrez Yaide pour l'utiliser.");
    await expect(installee.locator('[tabindex="-1"]')).toBeFocused();
    await expect(bouton).toHaveCount(0);
    await expect(etat).toContainText("v0.6.0");
    expect(fs.readFileSync(binaire).toString()).toBe("#!/bin/sh\necho nouveau\n");
    await page.screenshot({ path: path.join(racine, "etape5.png") });

    // Le serveur tourne encore et le shell ouvert est vivant (AC-093-1).
    const shellsApres = await page.evaluate(() => fetch("/api/shells").then((r) => r.json()));
    expect(shellsApres.shells.map((s) => s.id)).toEqual(shellsAvant.shells.map((s) => s.id));
    expect(shellsApres.shells.length).toBeGreaterThan(0);
    await page.locator(".terminal:visible .xterm-helper-textarea").focus();
    await page.keyboard.type("echo vivant$((20+22))");
    await page.keyboard.press("Enter");
    await expect(page.locator(".terminal:visible .xterm-rows")).toContainText("vivant42");

    // Étape 4 : rechargement → même message, sans bouton (AC-093-2).
    await page.reload();
    await expect(etat.getByRole("status").filter({ hasText: "installée" })).toHaveText("v0.9.2 installée. Redémarrez Yaide pour l'utiliser.");
    await expect(bouton).toHaveCount(0);
    await expect(etat).toContainText("v0.6.0");

    // Aucune requête vers une autre origine (AC-092-5).
    expect(autres).toEqual([]);
  } finally {
    await yaide.arreter();
    github.fermer();
  }
});
