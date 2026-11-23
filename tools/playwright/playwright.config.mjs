/**
 * Playwright-Tests der Verwaltung (#321), gegen den Dev-Server mit
 * nachgestellten Firebase-Modulen (vorlage.mjs). Vorher die Daten der Website
 * aus den Testdaten bauen (für Kopf und Menü):
 *
 *   TESTDATEN=tools/testdaten/katalog.json yarn data
 *   yarn test:verwaltung
 *
 * Screenshots jedes Tests unter node_modules/.cache/playwright/ (im PR als
 * Artefakt): Dort beobachtet Vite nichts; im Projekt brachten die Spuren der
 * laufenden Tests den Dev-Server zum Absturz (ENOENT im Datei-Beobachter).
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = 4398;

export default defineConfig({
  testDir: ".",
  testMatch: "*.test.mjs",
  outputDir: "../../node_modules/.cache/playwright/ergebnisse",
  globalSetup: "./aufwaermen.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { outputFolder: "../../node_modules/.cache/playwright/bericht", open: "never" }]] : "list",
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
    // SITE: Seiten der Website (auch die 404-Seite) brauchen sie; im PR gibt es keine .env.
    env: { PUBLIC_KUENSTLER: "k", SITE: "https://example.org" },
  },
});
