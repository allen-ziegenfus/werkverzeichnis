/**
 * Einstellungen → Felder der Werke (#256, #321): umbenennen, neu, archivieren,
 * doppelter Name, Höchstzahl, unbrauchbare gespeicherte Liste.
 */
import { test, expect, daten } from "./vorlage.mjs";

const SEITE = "/verwaltung/einstellungen/";
const speichern = page => page.getByRole("button", { name: "Speichern", exact: true });
// Speichern bleibt aktiv; fertig ist es, wenn die Leiste „Gespeichert“ meldet.
const gespeichert = page => expect(page.getByRole("status")).toContainText("Gespeichert", { timeout: 10_000 });
const felder = async page => (await daten(page))["artists/k"].felder;

test("Umbenennen ändert nur den Namen, der Schlüssel bleibt", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE);
  await page.getByLabel("Name des Felds Zustand").fill("Zustand");
  await speichern(page).click();
  await gespeichert(page);
  const f = (await felder(page)).find(f => f.schluessel === "Zustand");
  expect(f.name).toBe("Zustand");
  const d = await daten(page);
  const eintrag = d[`artists/k/einstellungsverlauf/${d["artists/k"].lastChange}`];
  expect(eintrag.by).toBe("testperson@example.org");
  expect(eintrag.nachher.felder.find(f => f.schluessel === "Zustand").name).toBe("Zustand");
});

test("Neues Feld bekommt einen Schlüssel aus dem Namen", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE);
  await page.getByPlaceholder("Name des neuen Felds").fill("Signatur unten");
  await page.getByRole("button", { name: "+ Feld" }).click();
  await expect(page.getByLabel("Name des Felds Signaturunten")).toHaveValue("Signatur unten");
  await speichern(page).click();
  await gespeichert(page);
  // Neue Felder sind erst intern, bis jemand sie auf die Website stellt.
  expect((await felder(page)).at(-1)).toEqual({ schluessel: "Signaturunten", name: "Signatur unten",
    lang: false, oeffentlich: false, archiviert: false });
});

test("Archivieren: aus dem Formular, Werte bleiben", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE);
  await page.getByLabel("Name des Felds Technik").locator("xpath=ancestor::li[1]").getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByLabel("Name des Felds Technik")).toHaveCount(0);
  await speichern(page).click();
  await gespeichert(page);
  expect((await felder(page)).find(f => f.schluessel === "Technik").archiviert).toBe(true);
  // Werte am Werk bleiben.
  expect((await daten(page))["artists/k/works/fivi1"].Technik).toBe("16 mm, s/w, 12 min");
});

test("Doppelter Name sperrt Speichern", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE);
  await page.getByLabel("Name des Felds Jahr").fill("maße");
  await expect(page.getByText(/Den Namen „Maße“ gibt es zweimal|Den Namen „maße“ gibt es zweimal/).first()).toBeVisible();
  await expect(speichern(page)).toBeDisabled();
});

test("Höchstens 100 Felder", async ({ verwaltung }) => {
  const page = await verwaltung(SEITE, {
    daten: d => {
      const f = d["artists/k"].felder;
      for (let i = f.length; i < 100; i++) f.push({ schluessel: `Feld${i}`, name: `Feld ${i}`, lang: false, oeffentlich: true, archiviert: false });
    },
  });
  await page.getByPlaceholder("Name des neuen Felds").fill("Noch eins");
  await expect(page.getByRole("button", { name: "+ Feld" })).toBeDisabled();
});

test("Unbrauchbare gespeicherte Liste: Standardfelder, und Speichern lässt sie stehen", async ({ verwaltung }) => {
  const kaputt = [{ schluessel: "Jahr", name: "" }];
  const page = await verwaltung(SEITE, { daten: d => { d["artists/k"].felder = kaputt; } });
  // Angezeigt werden die Standardfelder (z. B. „Signatur“, das die Testdaten-Liste nicht hat).
  await expect(page.getByLabel("Name des Felds Signatur")).toBeVisible();
  await page.getByLabel("Copyright").fill("Erika Beispiel, Testdaten");
  await speichern(page).click();
  await gespeichert(page);
  const k = (await daten(page))["artists/k"];
  expect(k.copyright).toBe("Erika Beispiel, Testdaten");
  expect(k.felder).toEqual(kaputt);
});
