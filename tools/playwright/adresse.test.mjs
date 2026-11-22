/**
 * Adresse je Werk (#281): Öffnen setzt ?werk=, die Liste ?gruppe=; Neuladen
 * bleibt, Zurück/Vor wechselt, Ungespeichertes fragt.
 */
import { test, expect } from "./vorlage.mjs";

const titel = page => page.getByText(/^OB\d+ · /);

test("Werkgruppe und Werk in der Adresse, Neuladen bleibt im Werk", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/");
  await page.locator("select").first().selectOption({ label: "Objekte" });
  await expect(page).toHaveURL(/\/verwaltung\/werke\/\?gruppe=objekte$/);
  await page.getByText("Kiste mit Deckel").first().click();
  await expect(page).toHaveURL(/\?werk=ob1$/);
  await page.reload();
  await expect(titel(page)).toHaveText("OB1 · Kiste mit Deckel");
  await expect(page).toHaveURL(/\?werk=ob1$/);
});

test("Zurück und Vor wechseln zwischen Liste und Werk, auch über Werkgruppen", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/?gruppe=objekte");
  await page.getByText("Kiste mit Deckel").first().click();
  await expect(titel(page)).toHaveText("OB1 · Kiste mit Deckel");
  await page.getByRole("button", { name: /Zurück zur Liste/ }).click();
  await expect(page).toHaveURL(/\?gruppe=objekte$/);
  await page.getByText("Ohne Bild").first().click();
  await expect(titel(page)).toHaveText("OB3 · Ohne Bild");

  await page.goBack();
  await expect(page).toHaveURL(/\?gruppe=objekte$/);
  await expect(page.getByText("Kiste mit Deckel")).toBeVisible();
  await page.goBack();
  await expect(titel(page)).toHaveText("OB1 · Kiste mit Deckel");
  await page.goForward();
  await page.goForward();
  await expect(titel(page)).toHaveText("OB3 · Ohne Bild");

  // Ein Werk einer anderen Werkgruppe aus der Adresse (wie ein geschickter Link), dann zurück.
  await page.goto("/verwaltung/werke/?werk=fivi1");
  await expect(page.getByText("FiVi1 · Ein Film")).toBeVisible();
  await expect(page.locator("select").first()).toHaveValue("filme-und-video");
});

test("Zurück mit ungespeicherten Änderungen fragt; Abbrechen bleibt im Werk", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/?gruppe=objekte");
  await page.getByText("Kiste mit Deckel").first().click();
  await page.getByLabel("Jahr", { exact: true }).fill("1999");
  let gefragt = 0;
  page.once("dialog", d => { gefragt++; d.dismiss(); });
  await page.goBack();
  await expect.poll(() => gefragt).toBe(1);
  await expect(titel(page)).toHaveText("OB1 · Kiste mit Deckel");
  await expect(page.getByLabel("Jahr", { exact: true })).toHaveValue("1999");
  await expect(page).toHaveURL(/\?werk=ob1$/);

  page.once("dialog", d => { gefragt++; d.accept(); });
  await page.goBack();
  await expect.poll(() => gefragt).toBe(2);
  await expect(page).toHaveURL(/\?gruppe=objekte$/);
  await expect(page.getByText("Kiste mit Deckel")).toBeVisible();
});
