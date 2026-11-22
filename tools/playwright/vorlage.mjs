/**
 * Gemeinsamer Aufbau der Tests (#321): eine Seite mit nachgestellten
 * Firebase-Modulen. Die Verwaltung lädt Firebase im Dev-Server als
 * vorgebündelte Module (node_modules/.vite/deps/firebase_*.js); die werden
 * per route() durch die Attrappen in attrappen/ ersetzt.
 *
 *   test("…", async ({ verwaltung }) => { const page = await verwaltung("/verwaltung/werke/", { daten => … }); })
 *
 * `daten` ändert die Testdaten vor dem Laden (Pfad → Dokument); `schalter`
 * setzt window.__… für Fehlerfälle (siehe attrappen/firebase_firestore.js).
 * Im Browser stehen die Daten danach unter window.__daten.
 */
import fs from "node:fs";
import { test as basis, expect } from "@playwright/test";
import { testdaten } from "./testdaten.mjs";

const attrappe = name => fs.readFileSync(new URL(`attrappen/${name}`, import.meta.url), "utf8");
const ATTRAPPEN = [
  [/\/firebase_auth\.js/, attrappe("firebase_auth.js")],
  [/\/firebase_firestore_lite\.js/, attrappe("firebase_firestore_lite.js")],
  [/\/firebase_firestore\.js/, attrappe("firebase_firestore.js")],
];

export const test = basis.extend({
  verwaltung: async ({ page }, use) => {
    const fehler = [];
    page.on("pageerror", e => fehler.push(`${e.message}\n${e.stack?.split("\n").slice(0, 4).join("\n")}`));
    for (const [muster, quelltext] of ATTRAPPEN) {
      await page.route(muster, r => r.fulfill({ contentType: "text/javascript", body: quelltext }));
    }
    await use(async (pfad, { daten, schalter = {} } = {}) => {
      const d = testdaten();
      daten?.(d);
      await page.addInitScript(([d, schalter]) => {
        // Fehlerseiten (Server weg) haben keinen sessionStorage; dort nichts tun.
        try { sessionStorage; } catch { return; }
        // Nur beim ersten Laden: Ein Neuladen behält, was der Test geschrieben hat (window.__daten).
        if (!sessionStorage.getItem("testdaten")) sessionStorage.setItem("testdaten", JSON.stringify(d));
        window.__testdaten = JSON.parse(sessionStorage.getItem("testdaten"));
        window.addEventListener("beforeunload", () => window.__daten && sessionStorage.setItem("testdaten", JSON.stringify(window.__daten,
          (k, v) => v && typeof v.toMillis === "function" ? { __ms: v.toMillis() } : v)));
        Object.assign(window, schalter);
      }, [d, schalter]);
      await page.goto(pfad);
      return page;
    });
    expect(fehler, "Fehler im Browser").toEqual([]);
  },
});

export { expect };

/** Die Daten im Browser (window.__daten), Zeiten als Millisekunden. */
export const daten = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__daten,
  (k, v) => v && typeof v.toMillis === "function" ? v.toMillis() : v)));
