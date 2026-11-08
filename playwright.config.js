import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60000,
  fullyParallel: true,
  outputDir: ".test-data/playwright",
  use: { ignoreHTTPSErrors: true },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" }, testMatch: ["parcours.spec.js", "raccourcis.spec.js", "socle.spec.js"],
      grep: /socle\.spec\.js|REQ030_AC1_parcours_[123]_|REQ019_AC[47]_/ },
  ],
});
