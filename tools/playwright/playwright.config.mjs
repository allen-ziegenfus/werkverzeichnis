/**
 * Playwright-Tests der Verwaltung (#321), gegen den Dev-Server mit
 * nachgestellten Firebase-Modulen (vorlage.mjs). Vorher die Daten der Website
 * aus den Testdaten bauen (für Kopf und Menü):
 *
 *   TESTDATEN=tools/testdaten/katalog.json yarn data
 *   yarn test:verwaltung
 *
 * Screenshots jedes Tests unter tools/playwright/ergebnisse/ (im PR als Artefakt).
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = 4398;

export default defineConfig({
  testDir: ".",
  testMatch: "*.test.mjs",
  outputDir: "ergebnisse",
  globalSetup: "./aufwaermen.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { outputFolder: "bericht", open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: "on",
    trace: "retain-on-failure",
    locale: "de-DE",
  },
  projects: [
    { name: "breit", use: { ...devices["Desktop Chrome"], viewport: { width: 1200, height: 900 } } },
  ],
  webServer: {
    command: `npx astro dev --port ${PORT}`,
    cwd: "../..",
    url: `http://localhost:${PORT}/verwaltung/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PUBLIC_KUENSTLER: "k" },
  },
});
