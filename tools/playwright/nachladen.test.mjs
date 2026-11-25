/**
 * Bereich nicht geladen (#140): erst ein zweiter Versuch nach einer Pause, dann
 * einmal Neuladen (#107), danach die Fehlermeldung. Jeder Fehlschlag steht in der Konsole.
 */
import { test, expect } from "./vorlage.mjs";

const MODUL = /\/src\/components\/Werkgruppen\.jsx(\?|$)/;

function warnungen(page) {
  const w = [];
  page.on("console", m => m.type() === "warning" && m.text().includes("nicht geladen") && w.push(m.text()));
  return w;
}

test("Ein Fehlschlag: zweiter Versuch lädt den Bereich, ohne Neuladen", async ({ page, verwaltung }) => {
  const w = warnungen(page);
  let versuche = 0;
  const zeiten = [];
  await page.route(MODUL, r => { zeiten.push(Date.now()); return ++versuche === 1 ? r.abort() : r.continue(); });
  let neuGeladen = 0;
  page.on("load", () => neuGeladen++);
  await verwaltung("/verwaltung/werkgruppen/");
  await expect(page.getByRole("row", { name: /Objekte/ })).toBeVisible();
  expect(versuche).toBe(2);
  expect(zeiten[1] - zeiten[0]).toBeGreaterThanOrEqual(900);   // erst nach der Pause
  expect(neuGeladen).toBe(1);
  expect(w).toHaveLength(1);
  expect(w[0]).toMatch(/Bereich \/verwaltung\/werkgruppen\/ nicht geladen \(\d{4}-.*\), noch ein Versuch/);
});

test("Scheitert immer: einmal neu laden, dann die Fehlermeldung mit „Neu laden“", async ({ page, verwaltung }) => {
  const w = warnungen(page);
  await page.route(MODUL, r => r.abort());
  let neuGeladen = 0;
  page.on("load", () => neuGeladen++);
  await verwaltung("/verwaltung/werkgruppen/", { erlaubteFehler: [/Failed to fetch dynamically imported module|Importing a module script failed/] });
  await expect(page.getByText("Dieser Bereich konnte nicht geladen werden")).toBeVisible();
  await expect(page.getByRole("button", { name: "Neu laden" })).toBeVisible();
  expect(neuGeladen).toBe(2);
  expect(w.map(t => t.match(/\), ([^:]+):/)[1])).toEqual([
    "noch ein Versuch", "lade die Seite neu", "noch ein Versuch", "aufgegeben, schon neu geladen",
  ]);
});
