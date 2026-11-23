/**
 * Werke: Werkgruppen als Liste, Brotkrumen (#282).
 */
import { test, expect } from "./vorlage.mjs";

const liste = page => page.getByRole("list", { name: "Werkgruppen" });
const krumen = page => page.getByRole("navigation", { name: "Brotkrumen" });

test("Liste der Werkgruppen mit Zahl der Werke, Klick zeigt die Werke", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/");
  await expect(liste(page).getByRole("button")).toHaveCount(2);
  // Objekte: OB1, OB2 A/B, OB3 und das ausgeblendete OB4.
  await expect(liste(page).getByRole("button", { name: /Objekte/ })).toContainText("4 Werke");
  await expect(liste(page).getByRole("button", { name: /Film- und Videoarbeiten/ })).toContainText("1 Werk");
  await liste(page).getByRole("button", { name: /Objekte/ }).click();
  await expect(page.getByText("Kiste mit Deckel")).toBeVisible();
  await expect(liste(page)).toHaveCount(0);
  await expect(krumen(page)).toHaveText(/Werke\s*›\s*Objekte/);
});

test("Brotkrumen führen je eine Ebene zurück; Zurück im Browser ebenso", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/");
  await liste(page).getByRole("button", { name: /Objekte/ }).click();
  await page.getByText("OB1", { exact: true }).click();
  await expect(krumen(page)).toHaveText(/Werke\s*›\s*Objekte\s*›\s*OB1/);
  await krumen(page).getByRole("button", { name: "Objekte" }).click();
  await expect(page).toHaveURL(/\?gruppe=objekte$/);
  await expect(page.getByText("Kiste mit Deckel")).toBeVisible();
  await krumen(page).getByRole("button", { name: "Werke" }).click();
  await expect(page).toHaveURL(/\/verwaltung\/werke\/$/);
  await expect(liste(page)).toBeVisible();

  // Die Werkgruppe zu wählen ist ein Schritt: Zurück führt wieder zur Werkgruppe, dann zur Liste.
  await page.goBack();
  await expect(page).toHaveURL(/\?gruppe=objekte$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?werk=ob1$/);
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/\/verwaltung\/werke\/$/);
  await expect(liste(page)).toBeVisible();
});

test("Ungespeichertes: Brotkrume „Werke“ fragt, Abbrechen bleibt im Werk", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/?werk=ob1");
  await page.getByLabel("Jahr", { exact: true }).fill("1999");
  page.once("dialog", d => d.dismiss());
  await krumen(page).getByRole("button", { name: "Werke" }).click();
  await expect(page.getByLabel("Jahr", { exact: true })).toHaveValue("1999");
  await expect(page).toHaveURL(/\?werk=ob1$/);
});

test("Nach dem Anlegen eines Werks stimmt die Zahl in der Liste", async ({ verwaltung }) => {
  const page = await verwaltung("/verwaltung/werke/");
  await expect(liste(page).getByRole("button", { name: /Objekte/ })).toContainText("4 Werke");
  await liste(page).getByRole("button", { name: /Objekte/ }).click();
  await page.getByRole("button", { name: "+ Neues Werk" }).first().click();
  await page.getByLabel(/Inv\. Nr\./).first().fill("OB9");
  await page.getByRole("button", { name: /anlegen/i }).first().click();
  await expect(page.getByText(/Angelegt \(OB9\)/)).toBeVisible();
  await krumen(page).getByRole("button", { name: "Werke" }).click();
  await expect(liste(page).getByRole("button", { name: /Objekte/ })).toContainText("5 Werke");
});
