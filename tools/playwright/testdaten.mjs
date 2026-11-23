/**
 * Firestore-Dokumente für die Playwright-Tests der Verwaltung (#321), aus
 * denselben Testdaten wie der Bau (tools/testdaten/katalog.json): Pfad →
 * Daten, mit Zeiten als { __ms }. Die Künstler:in heißt in den Attrappen
 * immer „k“ (firebase_firestore.js), angemeldet ist testperson@example.org
 * als Admin.
 */
import fs from "node:fs";

export const ICH = "testperson@example.org";
export const FRUEHER = { __ms: Date.UTC(2026, 9, 1, 12) };

export function testdaten() {
  const katalog = JSON.parse(fs.readFileSync(new URL("../testdaten/katalog.json", import.meta.url), "utf8"));
  const d = {
    "artists/k": { ...katalog.kuenstler, roles: { [ICH]: "admin" }, updatedAt: FRUEHER },
  };
  for (const { slug, ...g } of katalog.werkgruppen) {
    d[`artists/k/werkgruppen/${slug}`] = { kurztitel: null, ...g, updatedAt: FRUEHER };
  }
  for (const { slug, ...w } of katalog.werke) {
    d[`artists/k/works/${slug}`] = { ...w, updatedAt: FRUEHER };
  }
  for (const { slug, ...s } of katalog.seiten) {
    d[`artists/k/seiten/${slug}`] = { ...s, updatedAt: FRUEHER };
  }
  // Webversionen (#378: nur Bilder mit Webversion können Titelbild sein): pfade → medien wie gcf/process.js.
  for (const [id, m] of Object.entries(katalog.medien)) d[`artists/k/medien/${id}`] = m;
  for (const [pfad, id] of Object.entries(katalog.dateien)) d[`artists/k/pfade/${encodeURIComponent(pfad)}`] = { medium: id };
  return d;
}
