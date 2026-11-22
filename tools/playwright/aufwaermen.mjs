/**
 * Vor den Tests (globalSetup, #321): jede getestete Seite einmal laden. Mit
 * frischem Cache (im PR immer) bündelt Vite die Abhängigkeiten erst beim
 * ersten Aufruf und lädt dabei neu; ein Test, der genau dann lädt, sah eine
 * Fehlermeldung von Vite statt der Seite.
 */
import { chromium } from "@playwright/test";

const SEITEN = ["/verwaltung/werke/?werk=ob1", "/verwaltung/einstellungen/", "/verwaltung/import/"];

export default async function aufwaermen(config) {
  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (let runde = 0; runde < 2; runde++) {
      for (const s of SEITEN) {
        // Genau hier kann Vite neu laden und die Navigation abbrechen; das ist der Zweck, kein Fehler.
        try {
          await page.goto(baseURL + s);
          await page.waitForLoadState("networkidle");
        } catch (e) {
          console.log(`Aufwärmen ${s}: ${e.message.split("\n")[0]}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
}
