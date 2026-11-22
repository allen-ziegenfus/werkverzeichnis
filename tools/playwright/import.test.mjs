/**
 * Import (#239, #348–#350, #364): CSV lesen, Spalten zuordnen, prüfen,
 * schreiben mit Verlauf, Konflikt seit dem Prüfen.
 */
import { test, expect, daten } from "./vorlage.mjs";

const SEITE = "/verwaltung/import/";

// Testdaten: OB1 mit leerem Jahr (überschreibt nichts, also unverändert), OB3 mit
// leerem Titel (bleibt), OB10 ohne Jahr (kein leeres Feld am neuen Werk), OB2 A/B
// liegt unter einer Kennung, die nicht zur Inv. Nr. passt (Altbestand: „ob2-a-b“,
// slugify gibt „ob2-ab“), OB3 geändert, OB10 neu, FIVI1 steht in einer anderen
// Werkgruppe, OB11 doppelt, OB12 mit unbekannter Werkgruppe. „Gruppe“ heißt keine Spalte der Feldliste,
// die Werkgruppe kommt aus ihr.
// Darüber eine Titelzeile: Die Kopfzeile muss erraten werden (Zeile 2).
const CSV = [
  "Werkverzeichnis (Testdaten),,,,",
  "Inv. Nr.,Titel,Jahr,Technik,Gruppe",
  "OB1,Kiste mit Deckel,,,Objekte",
  "OB2 A/B,Zwei Teile,,,Objekte",
  "OB3,,1981,,Objekte",
  "OB10,Neues Objekt,,Holz,Objekte",
  "FIVI1,Ein Film,,,Objekte",
  "OB11,Doppelt,,,Objekte",
  "ob11,Doppelt auch,,,Objekte",
  "OB12,Unbekannt,,,Malerei",
].join("\n");

async function laden(page, csv = CSV, zeilen = 8) {
  await page.locator('input[type="file"]').setInputFiles({ name: "test.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(`test.csv: ${zeilen} ${zeilen === 1 ? "Zeile" : "Zeilen"}, 5 Spalten`)).toBeVisible();
}
const gruppe = (page, titel) => page.locator("details").filter({ has: page.locator("summary", { hasText: titel }) });

test("Zuordnung nach Namen, Werkgruppe aus der Spalte", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE);
  await laden(page);
  // Kopfzeile erraten (Titelzeile darüber übersprungen), Vorschau mit den Werten darunter.
  await expect(page.getByLabel("Spaltennamen in")).toHaveValue("1");
  const vorschau = page.getByRole("region", { name: "Vorschau der Tabelle" });
  await expect(vorschau.locator("tbody tr").first()).toContainText("OB1");
  await expect(vorschau).toContainText("Neues Objekt");
  await expect(page.getByLabel(/Spalte A „Inv\. Nr\.“/)).toHaveValue("InvNr");
  await expect(page.getByLabel(/Spalte B „Titel“/)).toHaveValue("Titel");
  await expect(page.getByLabel(/Spalte C „Jahr“/)).toHaveValue("Jahr");
  await expect(page.getByLabel(/Spalte D „Technik“/)).toHaveValue("Technik");
  await expect(page.getByLabel(/Spalte E „Gruppe“/)).toHaveValue("");
  // „Malerei“ passt zu keiner Werkgruppe, darum keine Spalte vorgeschlagen; von Hand wählen.
  await page.getByRole("radio", { name: /Aus der Spalte/ }).check();
  await page.getByLabel("Spalte mit der Werkgruppe").selectOption({ label: "E: Gruppe" });
  await expect(page.getByText("„Malerei“ (1 Zeile)")).toBeVisible();
});

test("Prüfen und schreiben: Übersicht, Verlauf, leere Zellen überschreiben nichts", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE);
  await laden(page);
  await page.getByRole("radio", { name: /Aus der Spalte/ }).check();
  await page.getByLabel("Spalte mit der Werkgruppe").selectOption({ label: "E: Gruppe" });
  await page.getByRole("button", { name: "Prüfen" }).click();

  await expect(gruppe(page, "Fehler")).toContainText("Fehler: 5");
  await expect(gruppe(page, "Fehler")).toContainText("Diese Inv. Nr. hat schon das Werk mit der Kennung „ob2-a-b“");
  await expect(gruppe(page, "Fehler")).toContainText("Dieselbe Inv. Nr. in den Zeilen 8, 9");
  await expect(gruppe(page, "Fehler")).toContainText("Keine Werkgruppe „Malerei“");
  await expect(gruppe(page, "Fehler")).toContainText("Das Werk steht in der Werkgruppe „Film- und Videoarbeiten“, nicht „Objekte“");
  await expect(gruppe(page, "Neu")).toContainText("Neu: 1");
  await expect(gruppe(page, "Geändert")).toContainText("Geändert: 1");
  await expect(gruppe(page, "Geändert")).toContainText("OB3");
  await expect(gruppe(page, "Geändert")).toContainText(/Jahr:\s*1980, 1985\s*→\s*1981/);
  await expect(gruppe(page, "Unverändert")).toContainText("Unverändert: 1");

  await page.getByRole("button", { name: "1 Werk anlegen und 1 ändern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Fertig." })).toContainText("1 angelegt, 1 geändert");

  const d = await daten(page);
  const neu = d["artists/k/works/ob10"];
  expect(neu).toMatchObject({ InvNr: "OB10", Titel: "Neues Objekt", Technik: "Holz", werkgruppe: "objekte" });
  expect(neu).not.toHaveProperty("Jahr");
  expect(d[`artists/k/history/${neu.lastChange}`]).toMatchObject({ work: "ob10", by: "testperson@example.org",
    changes: { InvNr: { from: null, to: "OB10" }, Technik: { from: null, to: "Holz" } } });
  const ob3 = d["artists/k/works/ob3"];
  expect(ob3).toMatchObject({ Jahr: "1981", Titel: "Ohne Bild" });
  expect(d[`artists/k/history/${ob3.lastChange}`].changes).toEqual({ Jahr: { from: "1980, 1985", to: "1981" } });
  // Leeres Jahr in der Tabelle: bleibt; unveränderte und fehlerhafte Zeilen: nicht geschrieben.
  expect(d["artists/k/works/ob1"]).toMatchObject({ Jahr: "1970" });
  expect(d["artists/k/works/ob1"].lastChange).toBeUndefined();
  expect(d["artists/k/works/ob2-a-b"].lastChange).toBeUndefined();
  expect(d["artists/k/works/ob2-ab"]).toBeUndefined();
  expect(d["artists/k/works/fivi1"].lastChange).toBeUndefined();
  expect(d["artists/k/works/ob11"]).toBeUndefined();
  expect(d["artists/k/works/ob12"]).toBeUndefined();
  expect(Object.keys(d).filter(k => k.startsWith("artists/k/history/"))).toHaveLength(2);
});

test("Seit dem Prüfen woanders geändert: übersprungen und gemeldet", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE);
  await laden(page, "Inv. Nr.,Titel,Jahr,Technik,Gruppe\nOB3,Ohne Bild,1981,,Objekte\nOB10,Neues Objekt,2001,Holz,Objekte", 2);
  await page.getByRole("button", { name: "Prüfen" }).click();
  await expect(gruppe(page, "Geändert")).toContainText("Geändert: 1");
  // Jemand anderes speichert OB3 in der Zwischenzeit.
  await page.evaluate(() => {
    const ms = Date.now();
    Object.assign(window.__daten["artists/k/works/ob3"], { Titel: "Woanders geändert",
      updatedAt: { toMillis: () => ms, toDate: () => new Date(ms), seconds: ms / 1000 } });
  });
  await page.getByRole("button", { name: "1 Werk anlegen und 1 ändern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Fertig." })).toContainText("1 angelegt, 0 geändert, 1 nicht übernommen");
  await expect(page.getByText(/Zeile 2 \(OB3\): Inzwischen geändert/)).toBeVisible();
  const d = await daten(page);
  expect(d["artists/k/works/ob3"]).toMatchObject({ Titel: "Woanders geändert", Jahr: "1980, 1985" });
  expect(d["artists/k/works/ob10"].InvNr).toBe("OB10");
});
