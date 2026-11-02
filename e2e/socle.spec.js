import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function portLibre() {
  return new Promise((res) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

test("REQ029_AC3_la_page_se_charge_sans_requete_vers_une_autre_origine", async ({ page }) => {
  const port = await portLibre();
  const dossier = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "socle-"));
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(dossier, "cfg") };
  spawnSync("target/debug/yaide", ["passwd"], { input: "mdp\n", env });
  const proc = spawn("target/debug/yaide", [dossier, "--port", String(port)], { stdio: "ignore", env });
  try {
    const origine = `https://127.0.0.1:${port}`;
    const externes = [];
    page.on("request", (r) => {
      if (!r.url().startsWith(origine)) externes.push(r.url());
    });
    for (let i = 0; i < 50; i++) {
      try {
        await page.goto(origine + "/");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await expect(page.locator("#app h1")).toHaveText("Yaide");
    expect(externes).toEqual([]);
  } finally {
    proc.kill();
  }
});
