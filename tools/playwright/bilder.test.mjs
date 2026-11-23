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
  expect(await bilder(page)).toHaveLength(2);
  await page.getByLabel("Jahr", { exact: true }).fill("1975");
  await expect(page.getByRole("button", { name: "ob2a.jpg entfernen" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "ob2b.jpg nach vorn" })).toBeDisabled();
});
