import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", pool: "vmThreads", testTimeout: 10000, include: ["web/src/**/*.test.js"] },
});
