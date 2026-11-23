/**
 * Werkgruppen: eigenes Titelbild hochladen (#380), gespeichert mit Eintrag im
 * Werkgruppenverlauf; das Original liegt unter werkgruppen/, nicht an einem Werk.
 */
import { test, expect, daten } from "./vorlage.mjs";

const SEITE = "/verwaltung/werkgruppen/";
const JPEG = { name: "Neues Titelbild.jpg", mimeType: "image/jpeg", buffer: Buffer.from("kein echtes jpeg") };
const objekte = page => page.getByRole("row", { name: /Objekte/ });

async function hochladenErlauben(page) {
  const puts = [];
  await page.route(/\/__upload\//, r => { puts.push(r.request().method()); r.fulfill({ status: 200, body: "" }); });
  return puts;
}

test("Titelbild hochladen: Pfad unter werkgruppen/, cover gesetzt mit Verlaufseintrag", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE);
  const puts = await hochladenErlauben(page);
  await expect(objekte(page).locator("img")).toHaveCount(1);   // das bisherige Titelbild
  await page.getByLabel("Titelbild von Objekte hochladen").setInputFiles(JPEG);
  await expect(page.getByText("Titelbild von „Objekte“ gespeichert.")).toBeVisible();
  expect(puts).toEqual(["PUT"]);

  const d = await daten(page);
  const neu = "artists/k/werkgruppen/objekte/test-neues-titelbild.jpg";
  const g = d["artists/k/werkgruppen/objekte"];
  expect(g.cover).toBe(neu);
  expect(d[`artists/k/werkgruppenverlauf/${g.lastChange}`]).toMatchObject({
    werkgruppe: "objekte", vorher: { cover: "artists/test/objekte.jpg" }, nachher: { cover: neu },
  });
  const anfrage = Object.entries(d).find(([k]) => k.includes("/uploads/"))[1];
  expect(anfrage.werkgruppe).toBe("objekte");
  expect(anfrage).not.toHaveProperty("werk");
  // Die anderen Werkgruppen bleiben, wie sie sind.
  expect(d["artists/k/werkgruppen/filme-und-video"].cover).toBe("artists/test/film.jpg");
});

test("Ein PDF ist kein Titelbild: abgelehnt, nichts hochgeladen", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE);
  const puts = await hochladenErlauben(page);
  await page.getByLabel("Titelbild von Objekte hochladen")
    .setInputFiles({ name: "katalog.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  await expect(page.getByText("Ein Titelbild muss ein Bild sein")).toBeVisible();
  expect(puts).toEqual([]);
  const d = await daten(page);
  expect(d["artists/k/werkgruppen/objekte"].cover).toBe("artists/test/objekte.jpg");
  expect(Object.keys(d).filter(k => k.includes("/uploads/"))).toEqual([]);
});

test("Hochgeladen, aber Speichern scheitert: noch einmal speichern, ohne neu hochzuladen", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE, { schalter: { __einmalScheitern: true } });
  const puts = await hochladenErlauben(page);
  await page.getByLabel("Titelbild von Objekte hochladen").setInputFiles(JPEG);
  await expect(page.getByText("Hochgeladen, aber nicht als Titelbild")).toBeVisible();
  await expect(page.getByLabel("Titelbild von Objekte hochladen")).toBeDisabled();
  await page.getByRole("button", { name: "Noch einmal speichern" }).click();
  await expect(page.getByText("Titelbild von „Objekte“ gespeichert.")).toBeVisible();
  expect(puts).toEqual(["PUT"]);
  expect((await daten(page))["artists/k/werkgruppen/objekte"].cover)
    .toBe("artists/k/werkgruppen/objekte/test-neues-titelbild.jpg");
  await expect(objekte(page).locator("img")).toHaveCount(0);   // neue Datei: noch keine Webversionen
});

test("Nicht gespeichertes Titelbild verwerfen gibt das Hochladen wieder frei", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE, { schalter: { __einmalScheitern: true } });
  await hochladenErlauben(page);
  await page.getByLabel("Titelbild von Objekte hochladen").setInputFiles(JPEG);
  await page.getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByText("Hochgeladen, aber nicht als Titelbild")).toHaveCount(0);
  await expect(page.getByLabel("Titelbild von Objekte hochladen")).toBeEnabled();
  expect((await daten(page))["artists/k/werkgruppen/objekte"].cover).toBe("artists/test/objekte.jpg");
});
