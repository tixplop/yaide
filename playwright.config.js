import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60000,
  outputDir: ".test-data/playwright",
  use: { ignoreHTTPSErrors: true },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" }, testMatch: ["agent.spec.js", "parcours.spec.js", "raccourcis.spec.js", "socle.spec.js"] },
  ],
});
