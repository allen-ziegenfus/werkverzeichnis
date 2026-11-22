/**
 * Werk-Editor (#321): Formular aus der Feldliste (#257), Speichern mit
 * Verlaufseintrag, gesicherter Entwurf nach Neuladen (#316), Kopf und
 * Werkleiste beim Scrollen (#260).
 */
import { test, expect, daten } from "./vorlage.mjs";

const OB1 = "/verwaltung/werke/?werk=ob1";

test("Formular folgt der Feldliste: Namen, Reihenfolge, intern, ohne archivierte", async ({ verwaltung }) => {
  const page = await verwaltung(OB1);
  await expect(page.getByLabel("Titel", { exact: true })).toHaveValue("Kiste mit Deckel");
  const namen = await page.locator("form label, main label.block").evaluateAll(ls =>
    ls.map(l => l.firstChild?.textContent?.trim().replace(/intern$/, "") ?? "").filter(Boolean));
  // Inv. Nr. und Titel, dann die nicht archivierten Felder der Liste in ihrer Reihenfolge.
  expect(namen).not.toContain("Foto");   // archiviert
  expect(namen.slice(0, 11)).toEqual(["InvNr", "Titel", "Art", "Jahr", "Maße", "Provenienz", "Material",
    "Technik", "Beschreibung", "Erhaltung", "Standort"]);
  await expect(page.getByText("Foto", { exact: true })).toHaveCount(0);   // archiviert
  await expect(page.locator("label", { hasText: "Material" })).toContainText("intern");
  await expect(page.locator("label", { hasText: "Jahr" })).not.toContainText("intern");
});

test("Speichern schreibt die Änderung mit Verlaufseintrag; archivierte Werte bleiben", async ({ verwaltung }) => {
  const page = await verwaltung(OB1);
  const jahr = page.getByLabel("Jahr", { exact: true });
  await jahr.fill("1971");
  await page.getByRole("button", { name: "Speichern" }).last().click();
  await expect(page.getByRole("button", { name: "Speichern" }).last()).toBeDisabled();

  const d = await daten(page);
  const werk = d["artists/k/works/ob1"];
  expect(werk.Jahr).toBe("1971");
  expect(werk.Foto).toBe("archiviert, steht nicht auf der Website");
  const eintrag = d[`artists/k/history/${werk.lastChange}`];
  expect(eintrag).toMatchObject({ work: "ob1", by: "testperson@example.org", changes: { Jahr: { from: "1970", to: "1971" } } });
  expect(Object.keys(eintrag.changes)).toEqual(["Jahr"]);
  await expect(page.getByText("Noch keine Änderungen.")).toHaveCount(0);
});

for (const [titel, schalter] of [
  ["Entwurf nach Neuladen angeboten", {}],
  ["Entwurf auch, wenn die Feldliste spät kommt (#316)", { __kuenstlerVerzoegern: 1500 }],
]) {
  test(titel, async ({ verwaltung }) => {
    const page = await verwaltung(OB1, { schalter });
    await page.getByLabel("Maße", { exact: true }).fill("21 x 30 x 10 cm");
    // Der Entwurf wird verzögert gesichert.
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => localStorage.getItem(k).includes("21 x 30")).length)).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByText(/Ungespeicherter Entwurf vom/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Wiederherstellen" }).click();
    await expect(page.getByLabel("Maße", { exact: true })).toHaveValue("21 x 30 x 10 cm");
    // Gespeichert ist noch nichts.
    expect((await daten(page))["artists/k/works/ob1"]["Maße"]).toBe("20 x 30 x 10 cm");
  });
}

test("Kopf und Werkleiste bleiben beim Scrollen oben (#260)", async ({ verwaltung }) => {
  const page = await verwaltung(OB1);
  await page.setViewportSize({ width: 1200, height: 500 });
  await expect(page.getByText("OB1 · Kiste mit Deckel")).toBeVisible();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  // Die Leiste mit Inv. Nr. und Titel steht noch im Bild, unter dem Kopf der Verwaltung (nicht dahinter).
  const leiste = await page.getByText("OB1 · Kiste mit Deckel").boundingBox();
  const kopf = await page.locator("header").first().boundingBox();
  expect(kopf.y).toBeLessThanOrEqual(0);
  expect(leiste.y).toBeGreaterThanOrEqual(kopf.y + kopf.height - 1);
  expect(leiste.y).toBeLessThan(kopf.y + kopf.height + 100);
  await expect(page.getByRole("link", { name: "Werke", exact: true }).first()).toBeInViewport();
});
