/**
 * Bilder eines Werks ordnen und entfernen (#262): gleich gespeichert, mit
 * Verlaufseintrag, zurücknehmbar; gesperrt, solange das Formular ungespeichert ist.
 */
import { test, expect, daten } from "./vorlage.mjs";

const OB2 = "/verwaltung/werke/?werk=ob2-a-b";
const bild = (page, name) => page.locator("section", { has: page.locator("#werk-bilder") }).locator("li", { hasText: name });
const bilder = async page => (await daten(page))["artists/k/works/ob2-a-b"].images;

test("Nach vorn schieben: neue Reihenfolge mit Verlaufseintrag, das erste ist das Vorschaubild", async ({ verwaltung }) => {
  const page = await verwaltung(OB2);
  await expect(page.getByRole("button", { name: "ob2a.jpg nach vorn" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "ob2b.jpg nach hinten" })).toBeDisabled();
  await page.getByRole("button", { name: "ob2b.jpg nach vorn" }).click();
  await expect(page.getByText("Reihenfolge gespeichert.")).toBeVisible();
  expect(await bilder(page)).toEqual(["artists/test/ob2b.jpg", "artists/test/ob2a.jpg"]);
  const d = await daten(page);
  const werk = d["artists/k/works/ob2-a-b"];
  expect(d[`artists/k/history/${werk.lastChange}`].changes).toEqual({
    images: { from: ["artists/test/ob2a.jpg", "artists/test/ob2b.jpg"], to: ["artists/test/ob2b.jpg", "artists/test/ob2a.jpg"] },
  });
  // Das Vorschaubild steht unter dem jetzt ersten Bild.
  await expect(bild(page, "ob2b.jpg")).toContainText("Vorschaubild");
  await expect(bild(page, "ob2a.jpg")).not.toContainText("Vorschaubild");
});

test("Entfernen fragt, entfernt mit Verlaufseintrag und lässt sich zurücknehmen", async ({ verwaltung }) => {
  const page = await verwaltung(OB2);
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "ob2a.jpg entfernen" }).click();
  await expect(page.getByText("„ob2a.jpg“ entfernt")).toBeVisible();
  expect(await bilder(page)).toEqual(["artists/test/ob2b.jpg"]);

  // Im Verlauf: der Eintrag „Bilder“ des Entfernens, zurücknehmen.
  page.on("dialog", d => d.accept());
  await page.getByRole("button", { name: "zurücknehmen" }).first().click();
  await expect.poll(() => bilder(page)).toEqual(["artists/test/ob2a.jpg", "artists/test/ob2b.jpg"]);
});

test("Abgelehnte Rückfrage entfernt nichts; ungespeicherte Änderungen sperren die Knöpfe", async ({ verwaltung }) => {
  const page = await verwaltung(OB2);
  page.once("dialog", d => d.dismiss());
  await page.getByRole("button", { name: "ob2a.jpg entfernen" }).click();
  await page.getByLabel("Jahr", { exact: true }).fill("1975");
  await expect(page.getByRole("button", { name: "ob2a.jpg entfernen" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "ob2b.jpg nach vorn" })).toBeDisabled();
  // Nichts geschrieben (kein Eintrag, keine Meldung), auch nicht verspätet.
  await expect(page.getByText(/entfernt;/)).toHaveCount(0);
  const werk = (await daten(page))["artists/k/works/ob2-a-b"];
  expect(werk.images).toHaveLength(2);
  expect(werk.lastChange).toBeUndefined();
});

test("Während ein Bild verschoben wird, sind die Felder nur lesbar (#262)", async ({ verwaltung }) => {
  // Langsame Transaktion: Das Schreiben dauert, das Formular darf dabei nichts annehmen.
  const page = await verwaltung(OB2);
  await page.evaluate(() => { window.__transaktionVerzoegern = 1500; });
  await page.getByRole("button", { name: "ob2b.jpg nach vorn" }).click();
  await expect(page.getByLabel("Jahr", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByText("Reihenfolge gespeichert.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("Jahr", { exact: true })).not.toHaveAttribute("readonly", "");
});

test("Verschieben auf dem Stand des Servers: ein woanders angehängtes Bild bleibt", async ({ verwaltung }) => {
  const page = await verwaltung(OB2);
  await expect(page.getByRole("button", { name: "ob2b.jpg nach vorn" })).toBeVisible();   // Werk offen, Daten geladen
  await page.evaluate(() => window.__daten["artists/k/works/ob2-a-b"].images.push("artists/test/ob2c.jpg"));
  await page.getByRole("button", { name: "ob2b.jpg nach vorn" }).click();
  await expect(page.getByText("Reihenfolge gespeichert.")).toBeVisible();
  expect(await bilder(page)).toEqual(["artists/test/ob2b.jpg", "artists/test/ob2a.jpg", "artists/test/ob2c.jpg"]);
});

test("Woanders schon entfernt: kein leerer Verlaufseintrag", async ({ verwaltung }) => {
  const page = await verwaltung(OB2);
  await expect(page.getByRole("button", { name: "ob2b.jpg nach vorn" })).toBeVisible();   // Werk offen, Daten geladen
  await page.evaluate(() => { window.__daten["artists/k/works/ob2-a-b"].images = ["artists/test/ob2b.jpg"]; });
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "ob2a.jpg entfernen" }).click();
  await expect(page.getByText("Nichts geändert")).toBeVisible();
  const d = await daten(page);
  expect(d["artists/k/works/ob2-a-b"].lastChange).toBeUndefined();
  expect(Object.keys(d).filter(k => k.startsWith("artists/k/history/"))).toHaveLength(0);
});

test("Titelbild einer Werkgruppe: die Rückfrage sagt es", async ({ verwaltung }) => {
  const page = await verwaltung(OB2, { daten: d => { d["artists/k/werkgruppen/objekte"].cover = "artists/test/ob2a.jpg"; } });
  let frage;
  page.once("dialog", d => { frage = d.message(); d.dismiss(); });
  await page.getByRole("button", { name: "ob2a.jpg entfernen" }).click();
  await expect.poll(() => frage).toContain("Titelbild der Werkgruppe „Objekte“");
});

test("Die neue Reihenfolge steht sofort da, noch während gespeichert wird", async ({ verwaltung }) => {
  const page = await verwaltung(OB2);
  await expect(page.getByRole("button", { name: "ob2b.jpg nach vorn" })).toBeVisible();
  await page.evaluate(() => { window.__transaktionVerzoegern = 2000; });
  await page.getByRole("button", { name: "ob2b.jpg nach vorn" }).click();
  const namen = () => page.locator("section", { has: page.locator("#werk-bilder") }).locator("li .break-all").allTextContents();
  await expect.poll(namen, { timeout: 1000 }).toEqual(["ob2b.jpg", "ob2a.jpg"]);
  await expect(page.getByText("Reihenfolge gespeichert.")).toHaveCount(0);   // noch nicht gespeichert
  await expect(page.getByText("Reihenfolge gespeichert.")).toBeVisible({ timeout: 10_000 });
  expect(await namen()).toEqual(["ob2b.jpg", "ob2a.jpg"]);
});

test("Scheitert das Speichern, gilt wieder die gespeicherte Reihenfolge", async ({ verwaltung }) => {
  const page = await verwaltung(OB2);
  await expect(page.getByRole("button", { name: "ob2b.jpg nach vorn" })).toBeVisible();
  await page.evaluate(() => { window.__einmalScheitern = true; });
  await page.getByRole("button", { name: "ob2b.jpg nach vorn" }).click();
  await expect(page.getByText("Netz weg (Testdaten)")).toBeVisible();
  const namen = () => page.locator("section", { has: page.locator("#werk-bilder") }).locator("li .break-all").allTextContents();
  await expect.poll(namen).toEqual(["ob2a.jpg", "ob2b.jpg"]);
});

test("Ein Bild auf ein anderes ziehen ordnet um, ohne hochzuladen (#372)", async ({ verwaltung }) => {
  const page = await verwaltung(OB2);
  await expect(page.getByRole("button", { name: "ob2b.jpg nach vorn" })).toBeVisible();
  await bild(page, "ob2b.jpg").dragTo(bild(page, "ob2a.jpg"));
  await expect(page.getByText("Reihenfolge gespeichert.")).toBeVisible();
  expect(await bilder(page)).toEqual(["artists/test/ob2b.jpg", "artists/test/ob2a.jpg"]);
  // Zurück nach hinten ziehen: hinter das Ziel.
  await bild(page, "ob2b.jpg").dragTo(bild(page, "ob2a.jpg"));
  await expect.poll(() => bilder(page)).toEqual(["artists/test/ob2a.jpg", "artists/test/ob2b.jpg"]);
  const d = await daten(page);
  expect(Object.keys(d).filter(k => k.includes("/uploads/"))).toEqual([]);
  await expect(page.getByText(/Hochgeladen/)).toHaveCount(0);
});

test("Als Titelbild der Werkgruppe: gespeichert mit Eintrag im Werkgruppenverlauf (#378)", async ({ verwaltung }) => {
  const page = await verwaltung(OB2);
  await page.getByRole("button", { name: "ob2b.jpg als Titelbild der Werkgruppe" }).click();
  await expect(page.getByText(/ist jetzt das Titelbild der Werkgruppe „Objekte“/)).toBeVisible();
  await expect(bild(page, "ob2b.jpg")).toContainText("Titelbild der Werkgruppe");
  await expect(page.getByRole("button", { name: "ob2b.jpg ist das Titelbild der Werkgruppe" })).toBeDisabled();
  const d = await daten(page);
  const g = d["artists/k/werkgruppen/objekte"];
  expect(g.cover).toBe("artists/test/ob2b.jpg");
  expect(d[`artists/k/werkgruppenverlauf/${g.lastChange}`]).toMatchObject({
    werkgruppe: "objekte", by: "testperson@example.org",
    vorher: { cover: "artists/test/objekte.jpg" }, nachher: { cover: "artists/test/ob2b.jpg", titel: "Objekte" },
  });
});

test("Ohne werkgruppen.bearbeiten (Rolle editor) kein Knopf fürs Titelbild", async ({ verwaltung }) => {
  const page = await verwaltung(OB2, { daten: d => { d["artists/k"].roles = { "testperson@example.org": "editor" }; } });
  await expect(page.getByRole("button", { name: "ob2b.jpg nach vorn" })).toBeVisible();
  await expect(page.getByRole("button", { name: /als Titelbild/ })).toHaveCount(0);
});
